import {ValidationError} from '../error/validation_error';
import {getType} from '../util/get_type';
import v8 from '../reference/v8.json' with {type: 'json'};
import {ProjectionSpecification, StyleSpecification} from '../types.g';
import {deepUnbundle, unbundle} from '../util/unbundle_jsonlint';

interface ValidateProjectionOptions {
    sourceName?: string;
    value: ProjectionSpecification;
    styleSpec: typeof v8;
    style: StyleSpecification;
    validateSpec: Function;
}

export function validateProjection(options: ValidateProjectionOptions) {
    const projection = options.value;
    const styleSpec = options.styleSpec;
    const projectionSpec = styleSpec.projection;
    const style = options.style;

    const rootType = getType(projection);
    if (projection === undefined) {
        return [];
    } else if (rootType !== 'object') {
        return [
            new ValidationError('projection', projection, `object expected, ${rootType} found`)
        ];
    }

    let errors = [];
    const type = unbundle(projection.type);
    const transition = deepUnbundle(projection.transition);
    for (const key in projection) {
        if (key === 'transition') {
            if (type !== 'equal-earth' || (transition !== false &&
                (!Array.isArray(transition) || transition.length !== 2 || !transition.every(Number.isFinite) || transition[0] >= transition[1]))) {
                errors.push(new ValidationError(key, transition, 'expected false or an increasing pair of finite zoom levels for Equal Earth'));
            }
            continue;
        }
        if (projectionSpec[key]) {
            errors = errors.concat(
                options.validateSpec({
                    key,
                    value: projection[key],
                    valueSpec: projectionSpec[key],
                    style,
                    styleSpec
                })
            );
        } else {
            errors = errors.concat([
                new ValidationError(key, projection[key], `unknown property "${key}"`)
            ]);
        }
    }

    if (projection.center !== undefined) {
        const center = deepUnbundle(projection.center);
        if (type !== 'equal-earth' || !Array.isArray(center) || center.length !== 2 ||
            !center.every(Number.isFinite) || Math.abs(center[0]) > 180 || Math.abs(center[1]) > 90 ||
            (transition !== false && center[1] !== 0)) {
            errors.push(new ValidationError('center', center, 'expected an Equal Earth origin in longitude/latitude bounds; adaptive origins must stay on the equator'));
        }
    }
    return errors;
}
