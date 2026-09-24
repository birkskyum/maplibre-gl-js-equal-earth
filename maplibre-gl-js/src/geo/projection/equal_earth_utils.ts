import Point from '@mapbox/point-geometry';
import {LngLat} from '../lng_lat.ts';
import {mercatorYfromLat, latFromMercatorY} from '../mercator_coordinate.ts';
import {clamp, degreesToRadians} from '../../util/util.ts';

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;

/** The equatorial width of Equal Earth on a unit sphere, used to preserve its aspect ratio. */
const WORLD_WIDTH = 2 * Math.PI / (M * A1);

/** Equal Earth is fully visible through zoom 6 and becomes Mercator at zoom 7. */
export function equalEarthTransition(zoom: number, range?: false | [number, number]): number {
    if (range === false) return 1;
    const [start, end] = range ?? [6, 7];
    return clamp((end - zoom) / (end - start), 0, 1);
}

/**
 * Projects spherical longitude and latitude to Equal Earth, normalized to an equatorial width of one.
 * Uses the polynomial published by Šavrič, Patterson and Jenny (2018), DOI: 10.1080/13658816.2018.1504949.
 * Both axes share a scale, preserving area and the projection's 2.0546:1 world aspect ratio.
 */
export function projectEqualEarth(lngLat: LngLat): Point {
    const theta = Math.asin(M * Math.sin(degreesToRadians(lngLat.lat)));
    const theta2 = theta * theta;
    const theta6 = theta2 * theta2 * theta2;
    const derivative = A1 + 3 * A2 * theta2 + theta6 * (7 * A3 + 9 * A4 * theta2);
    return new Point(
        0.5 + degreesToRadians(lngLat.lng) * Math.cos(theta) / (M * derivative * WORLD_WIDTH),
        0.5 - theta * (A1 + A2 * theta2 + theta6 * (A3 + A4 * theta2)) / WORLD_WIDTH
    );
}

/** Blends normalized Equal Earth and Mercator coordinates, without a camera-dependent translation. */
export function projectAdaptiveEqualEarth(lngLat: LngLat, transition: number, origin?: [number, number], reference: number = 0): Point {
    const mercator = new Point((lngLat.lng + 180) / 360, mercatorYfromLat(clamp(lngLat.lat, -85.0511287798066, 85.0511287798066)));
    if (transition === 0) return mercator;
    return mercator.mult(1 - transition).add(projectEqualEarth(origin ? rotateEqualEarth(lngLat, origin, reference) : lngLat).mult(transition));
}

/**
 * Inverts the blended projection. Its Y depends only on latitude and is monotonic, so bisection
 * remains stable at the poles and throughout the transition; X is linear in longitude.
 * Points outside the north/south edges are clamped to the closest latitude.
 */
export function unprojectAdaptiveEqualEarth(point: Point, transition: number, origin?: [number, number]): LngLat {
    if (origin) {
        const location = unprojectAdaptiveEqualEarth(point, transition);
        if (transition === 1) return unrotateEqualEarth(location, origin);
        const equalHalfWidth = projectEqualEarth(new LngLat(180, location.lat)).x - 0.5;
        const blendedHalfWidth = (1 - transition) * 0.5 + transition * equalHalfWidth;
        return new LngLat(location.lng + origin[0] * transition * equalHalfWidth / blendedHalfWidth, location.lat);
    }
    if (transition === 0) return new LngLat(point.x * 360 - 180, latFromMercatorY(point.y));
    let south = -90;
    let north = 90;
    for (let i = 0; i < 48; i++) {
        const latitude = (south + north) / 2;
        const y = projectAdaptiveEqualEarth(new LngLat(0, latitude), transition).y;
        if (y > point.y) south = latitude;
        else north = latitude;
    }
    const latitude = (south + north) / 2;
    const halfWidth = projectAdaptiveEqualEarth(new LngLat(180, latitude), transition).x - 0.5;
    return new LngLat((point.x - 0.5) * 180 / halfWidth, latitude);
}

/** Parameters shared by the Equal Earth renderer and its live camera transform. */
export type EqualEarthParameters = {transition?: false | [number, number]; center?: [number, number]};

/** Rotates the sphere so origin becomes longitude zero on the equator; reference chooses a continuous longitude branch. */
export function rotateEqualEarth(location: LngLat, origin: [number, number], reference: number = 0): LngLat {
    const longitude = degreesToRadians(location.lng - origin[0]);
    if (origin[1] === 0) return new LngLat(location.lng - origin[0], location.lat);
    const latitude = degreesToRadians(location.lat);
    const tilt = degreesToRadians(origin[1]);
    const x = Math.cos(latitude) * Math.cos(longitude);
    const y = Math.cos(latitude) * Math.sin(longitude);
    const z = Math.sin(latitude);
    const rotatedX = x * Math.cos(tilt) + z * Math.sin(tilt);
    const rotatedZ = z * Math.cos(tilt) - x * Math.sin(tilt);
    let lng = Math.atan2(y, rotatedX) * 180 / Math.PI;
    lng += 360 * Math.round((reference - lng) / 360);
    return new LngLat(lng, Math.asin(clamp(rotatedZ, -1, 1)) * 180 / Math.PI);
}

/** Inverts the spherical rotation, including origins at either geographic pole. */
export function unrotateEqualEarth(location: LngLat, origin: [number, number]): LngLat {
    if (origin[1] === 0) return new LngLat(location.lng + origin[0], location.lat);
    const longitude = degreesToRadians(location.lng);
    const latitude = degreesToRadians(location.lat);
    const tilt = degreesToRadians(origin[1]);
    const x = Math.cos(latitude) * Math.cos(longitude);
    const y = Math.cos(latitude) * Math.sin(longitude);
    const z = Math.sin(latitude);
    const originalX = x * Math.cos(tilt) - z * Math.sin(tilt);
    const originalZ = z * Math.cos(tilt) + x * Math.sin(tilt);
    const lng = origin[0] + Math.atan2(y, originalX) * 180 / Math.PI;
    return new LngLat(((lng + 180) % 360 + 360) % 360 - 180, Math.asin(clamp(originalZ, -1, 1)) * 180 / Math.PI);
}
