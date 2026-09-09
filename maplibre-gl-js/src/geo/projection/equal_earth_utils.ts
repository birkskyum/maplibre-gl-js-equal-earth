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
export function equalEarthTransition(zoom: number): number {
    return clamp(7 - zoom, 0, 1);
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
export function projectAdaptiveEqualEarth(lngLat: LngLat, transition: number): Point {
    const mercator = new Point((lngLat.lng + 180) / 360, mercatorYfromLat(clamp(lngLat.lat, -85.0511287798066, 85.0511287798066)));
    if (transition === 0) return mercator;
    return mercator.mult(1 - transition).add(projectEqualEarth(lngLat).mult(transition));
}

/**
 * Inverts the blended projection. Its Y depends only on latitude and is monotonic, so bisection
 * remains stable at the poles and throughout the transition; X is linear in longitude.
 * Points outside the north/south edges are clamped to the closest latitude.
 */
export function unprojectAdaptiveEqualEarth(point: Point, transition: number): LngLat {
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
