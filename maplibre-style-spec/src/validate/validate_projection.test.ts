import {validateProjection} from './validate_projection';
import {validate} from './validate';
import v8 from '../reference/v8.json' with {type: 'json'};
import {ProjectionSpecification} from '../types.g';
import {describe, test, expect, it} from 'vitest';
import {validateStyle} from '../validate_style';

describe('Validate projection', () => {
    test('validates Equal Earth options in serialized JSON styles', () => {
        for (const projection of [{type: 'equal-earth', transition: false, center: [30, 90]},
            {type: 'equal-earth', transition: [6, 7], center: [120, 0]}]) {
            expect(validateStyle(JSON.stringify({version: 8, projection, sources: {}, layers: []}))).toEqual([]);
        }
    });

    it('Should pass when value is undefined', () => {
        const errors = validateProjection({
            validateSpec: validate,
            value: undefined,
            styleSpec: v8,
            style: {} as any
        });
        expect(errors).toHaveLength(0);
    });

    test('Should return error when value is not an object', () => {
        const errors = validateProjection({
            validateSpec: validate,
            value: '' as unknown as ProjectionSpecification,
            styleSpec: v8,
            style: {} as any
        });
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('object');
        expect(errors[0].message).toContain('expected');
    });

    test('Should return error in case of unknown property', () => {
        const errors = validateProjection({
            validateSpec: validate,
            value: {a: 1} as any,
            styleSpec: v8,
            style: {} as any
        });
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('a: unknown property \"a\"');
    });

    test('Should return errors according to spec violations', () => {
        const errors = validateProjection({
            validateSpec: validate,
            value: {type: 1 as any},
            styleSpec: v8,
            style: {} as any
        });
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toBe('type: projection expected, invalid type \"number\" found');
    });

    test('Should return error when value is null', () => {
        const errors = validateProjection({
            validateSpec: validate,
            value: null as any,
            styleSpec: v8,
            style: {} as any
        });
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('projection: object expected, null found');
    });

    test('Should pass step function', () => {
        const errors = validateProjection({
            validateSpec: validate,
            value: {type: ['step', ['zoom'], 'vertical-perspective', 10, 'mercator']},
            styleSpec: v8,
            style: {} as any
        });
        expect(errors).toHaveLength(0);
    });

    test.each(['mercator', 'globe', 'equal-earth'])('Should pass named projection %s', (type) => {
        const errors = validateProjection({
            validateSpec: validate,
            value: {type},
            styleSpec: v8,
            style: {} as any
        });
        expect(errors).toHaveLength(0);
    });

    test('Should pass if [proj, proj, number]', () => {
        const errors = validateProjection({
            validateSpec: validate,
            value: {type: ['mercator', 'mercator', 0.3]},
            styleSpec: v8,
            style: {} as any
        });
        expect(errors).toHaveLength(0);
    });

    test('should parse interpolate', () => {
        const errors = validateProjection({
            validateSpec: validate,
            value: {
                type: [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    0,
                    'mercator',
                    5,
                    'vertical-perspective'
                ]
            },
            styleSpec: v8,
            style: {} as any
        });
        expect(errors).toHaveLength(0);
    });
});

describe('experimental Equal Earth options', () => {
    test.each([
        {type: 'equal-earth', transition: false},
        {type: 'equal-earth', transition: [6, 7], center: [150, 0]},
        {type: 'equal-earth', transition: false, center: [30, 90]},
        {type: 'equal-earth', transition: false, center: [-180, -90]}
    ])('accepts supported options %j', projection => {
        expect(validateProjection({value: projection as ProjectionSpecification, validateSpec: validate, styleSpec: v8, style: {} as any})).toHaveLength(0);
    });

    test.each([
        {type: 'equal-earth', transition: true},
        {type: 'equal-earth', transition: [7, 6]},
        {type: 'equal-earth', transition: [6, Infinity]},
        {type: 'equal-earth', center: [0, 45]},
        {type: 'equal-earth', transition: false, center: [181, 0]},
        {type: 'equal-earth', transition: false, center: [0, NaN]},
        {type: 'globe', transition: false},
        {type: 'mercator', center: [0, 0]}
    ])('rejects unsupported options %j', projection => {
        expect(validateProjection({value: projection as ProjectionSpecification, validateSpec: validate, styleSpec: v8, style: {} as any}).length).toBeGreaterThan(0);
    });
});
