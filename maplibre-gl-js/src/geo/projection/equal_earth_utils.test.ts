import {describe, expect, test} from 'vitest';
import {LngLat} from '../lng_lat.ts';
import {projectAdaptiveEqualEarth, projectEqualEarth, unprojectAdaptiveEqualEarth, rotateEqualEarth, unrotateEqualEarth, equalEarthTransition} from './equal_earth_utils.ts';

describe('Equal Earth coordinates', () => {
    test('preserves the published world aspect ratio and equatorial width', () => {
        const west = projectEqualEarth(new LngLat(-180, 0));
        const east = projectEqualEarth(new LngLat(180, 0));
        const north = projectEqualEarth(new LngLat(0, 90));
        const south = projectEqualEarth(new LngLat(0, -90));
        expect(west.x).toBeCloseTo(0, 12);
        expect(east.x).toBeCloseTo(1, 12);
        expect(1 / (south.y - north.y)).toBeCloseTo(2.0546, 4);
        expect(projectEqualEarth(new LngLat(-180, 90)).x).toBeCloseTo(1 - projectEqualEarth(new LngLat(180, 90)).x, 12);
    });

    test('preserves area across latitudes', () => {
        const areas: number[] = [];
        const delta = 1e-4;
        for (const latitude of [0, 30, 60, 80]) {
            const origin = projectEqualEarth(new LngLat(30, latitude));
            const east = projectEqualEarth(new LngLat(30 + delta, latitude)).sub(origin);
            const north = projectEqualEarth(new LngLat(30, latitude + delta)).sub(origin);
            areas.push(Math.abs(east.x * north.y - east.y * north.x) / Math.cos(latitude * Math.PI / 180));
        }
        for (const area of areas) expect(area / areas[0]).toBeCloseTo(1, 4);
    });

    test('inverts Equal Earth and its Mercator transition', () => {
        for (const transition of [0, 0.01, 0.5, 1]) {
            for (const location of [new LngLat(0, 0), new LngLat(-179, -80), new LngLat(120, 55), new LngLat(180, 85)]) {
                const inverse = unprojectAdaptiveEqualEarth(projectAdaptiveEqualEarth(location, transition), transition);
                expect(inverse.lng).toBeCloseTo(location.lng, 9);
                expect(inverse.lat).toBeCloseTo(location.lat, 9);
            }
        }
    });
});

describe('Equal Earth modes and origins', () => {
    test('keeps fixed projections active at high zooms and respects an adaptive range', () => {
        expect(equalEarthTransition(22, false)).toBe(1);
        expect(equalEarthTransition(6.5)).toBe(0.5);
        expect(equalEarthTransition(9, [8, 10])).toBe(0.5);
        expect(equalEarthTransition(11, [8, 10])).toBe(0);
    });

    test('puts arbitrary origins at the center and inverts the spherical rotation', () => {
        for (const origin of [[120, 45], [-160, 0], [30, 90], [-70, -90]] as Array<[number, number]>) {
            const centered = rotateEqualEarth(new LngLat(...origin), origin);
            expect(centered.lng).toBeCloseTo(0, 9);
            expect(centered.lat).toBeCloseTo(0, 9);
            for (const location of [new LngLat(0, 0), new LngLat(170, 80), new LngLat(-179, -80)]) {
                const inverse = unrotateEqualEarth(rotateEqualEarth(location, origin), origin);
                expect(inverse.lng).toBeCloseTo(location.lng, 9);
                expect(inverse.lat).toBeCloseTo(location.lat, 9);
                const projected = projectAdaptiveEqualEarth(location, 1, origin);
                const restored = unprojectAdaptiveEqualEarth(projected, 1, origin);
                expect(restored.lng).toBeCloseTo(location.lng, 8);
                expect(restored.lat).toBeCloseTo(location.lat, 8);
            }
        }
    });

    test('inverts longitude-shifted adaptive projections throughout the transition', () => {
        for (const transition of [0, 0.01, 0.5, 0.99, 1]) {
            const origin: [number, number] = [150, 0];
            const location = new LngLat(179, 65);
            const projected = projectAdaptiveEqualEarth(location, transition, origin);
            const inverse = unprojectAdaptiveEqualEarth(projected, transition, origin);
            expect(inverse.lng).toBeCloseTo(location.lng, 9);
            expect(inverse.lat).toBeCloseTo(location.lat, 9);
        }
    });
});
