import Point from '@mapbox/point-geometry';
import {MercatorCameraHelper} from './mercator_camera_helper.ts';
import {equalEarthTransition, projectAdaptiveEqualEarth, unprojectAdaptiveEqualEarth} from './equal_earth_utils.ts';
import {LngLat} from '../lng_lat.ts';
import {clamp, degreesToRadians} from '../../util/util.ts';
import {cameraBoundsWarning, type CameraForBoxAndBearingHandlerResult} from './camera_helper.ts';

import type {CameraForBoundsOptions} from '../../ui/camera.ts';
import type {PaddingOptions} from '../edge_insets.ts';
import type {LngLatBounds} from '../lng_lat_bounds.ts';
import type {IReadonlyTransform} from '../transform_interface.ts';

/** Fits curved map bounds at the projection state of the destination zoom. */
export class EqualEarthCameraHelper extends MercatorCameraHelper {
    cameraForBoxAndBearing(options: CameraForBoundsOptions, padding: PaddingOptions, bounds: LngLatBounds, bearing: number, tr: IReadonlyTransform): CameraForBoxAndBearingHandlerResult {
        const width = tr.width - tr.padding.left - tr.padding.right - padding.left - padding.right;
        const height = tr.height - tr.padding.top - tr.padding.bottom - padding.top - padding.bottom;
        if (width <= 0 || height <= 0) {
            cameraBoundsWarning();
            return undefined;
        }
        const angle = degreesToRadians(bearing);
        let low = tr.minZoom;
        let high = Math.min(options.maxZoom, tr.maxZoom);
        for (let i = 0; i < 32; i++) {
            const zoom = (low + high) / 2;
            const {min, max} = projectedBounds(bounds, zoom, angle);
            const size = max.sub(min).mult(tr.tileSize * Math.pow(2, zoom));
            if (size.x <= width && size.y <= height) low = zoom;
            else high = zoom;
        }
        if (equalEarthTransition(low) === 0) return super.cameraForBoxAndBearing(options, padding, bounds, bearing, tr);
        const {min, max} = projectedBounds(bounds, low, angle);
        const offset = Point.convert(options.offset).add(new Point((padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2));
        const center = min.add(max).div(2).sub(offset.div(tr.tileSize * Math.pow(2, low))).rotate(angle);
        return {center: unprojectAdaptiveEqualEarth(center, equalEarthTransition(low)), zoom: low, bearing};
    }
}

/** Samples curved meridians, including the equator where the world is widest. */
function projectedBounds(bounds: LngLatBounds, zoom: number, angle: number): {min: Point; max: Point} {
    const min = new Point(Infinity, Infinity);
    const max = new Point(-Infinity, -Infinity);
    const transition = equalEarthTransition(zoom);
    const latitudes = [clamp(0, bounds.getSouth(), bounds.getNorth())];
    for (let i = 0; i <= 64; i++) latitudes.push(bounds.getSouth() + (bounds.getNorth() - bounds.getSouth()) * i / 64);
    for (const lng of [bounds.getWest(), bounds.getEast()]) {
        for (const lat of latitudes) {
            const point = projectAdaptiveEqualEarth(new LngLat(lng, lat), transition).rotate(-angle);
            min.x = Math.min(min.x, point.x);
            min.y = Math.min(min.y, point.y);
            max.x = Math.max(max.x, point.x);
            max.y = Math.max(max.y, point.y);
        }
    }
    return {min, max};
}
