import {describe, expect, test, vi} from 'vitest';
import Point from '@mapbox/point-geometry';
import {LngLat} from '../lng_lat.ts';
import {LngLatBounds} from '../lng_lat_bounds.ts';
import {MercatorCoordinate} from '../mercator_coordinate.ts';
import {EqualEarthTransform} from './equal_earth_transform.ts';
import {MercatorTransform} from './mercator_transform.ts';
import {createProjectionFromName} from './projection_factory.ts';
import {EvaluationParameters} from '../../style/evaluation_parameters.ts';
import {EXTENT} from '../../data/extent.ts';
import {CanonicalTileID, OverscaledTileID} from '../../tile/tile_id.ts';
import {coveringTiles} from './covering_tiles.ts';
import {createRenderOptions} from '../../render/render_options.ts';
import {Context} from '../../webgl/context.ts';
import {createNullGL} from '../../util/test/null_gl.ts';

describe('adaptive Equal Earth', () => {
    test('selects the projection and changes to the Mercator renderer at zoom 7', () => {
        const {projection, transform, cameraHelper} = createProjectionFromName('equal-earth', undefined, {});
        expect(transform).toBeInstanceOf(EqualEarthTransform);
        expect(cameraHelper.useGlobeControls).toBe(false);
        expect(projection.name).toBe('equal-earth');
        for (const [zoom, transition] of [[0, 1], [6, 1], [6.5, 0.5], [7, 0], [15, 0]]) {
            projection.recalculate(new EvaluationParameters(zoom));
            expect(projection.transitionState).toBe(transition);
            expect(projection.shaderVariantName).toBe(transition ? 'equal-earth' : 'mercator');
            expect(projection.useSubdivision).toBe(transition > 0);
            expect(createRenderOptions(transform, projection, null).isRenderingGlobe).toBe(false);
        }
        projection.destroy();
    });

    test('preserves the center and round-trips screen coordinates with pitch, bearing and padding', () => {
        const transform = new EqualEarthTransform();
        transform.resize(800, 600);
        transform.setCenter(new LngLat(30, 40));
        transform.setPadding({left: 80, top: 30, right: 0, bottom: 0});
        transform.setBearing(25);
        transform.setPitch(40);
        transform.setRoll(10);
        for (const zoom of [0, 3, 6, 6.5, 7]) {
            transform.setZoom(zoom);
            expect(transform.locationToScreenPoint(transform.center).dist(transform.centerPoint)).toBeLessThan(1e-6);
            const location = new LngLat(31, 39);
            const inverse = transform.screenPointToLocation(transform.locationToScreenPoint(location));
            expect(inverse.lng).toBeCloseTo(location.lng, 7);
            expect(inverse.lat).toBeCloseTo(location.lat, 7);
        }
    });

    test('caches and releases meshes from both sides of the transition', () => {
        const {projection} = createProjectionFromName('equal-earth', undefined, {});
        const gl = createNullGL();
        const context = new Context(gl);
        const deleteBuffer = vi.spyOn(gl, 'deleteBuffer');
        const tile = new CanonicalTileID(0, 0, 0);
        const curvedMesh = projection.getMeshFromTileID(context, tile, true, true, 'raster');
        expect(projection.getMeshFromTileID(context, tile, true, true, 'raster')).toBe(curvedMesh);
        projection.recalculate(new EvaluationParameters(7));
        const flatMesh = projection.getMeshFromTileID(context, tile, true, true, 'raster');
        expect(flatMesh).not.toBe(curvedMesh);
        projection.destroy();
        expect(deleteBuffer).toHaveBeenCalledTimes(4);
    });

    test('keeps an anchored location under the cursor when panning and zooming', () => {
        const transform = new EqualEarthTransform();
        transform.resize(800, 600);
        transform.setZoom(6);
        transform.setCenter(new LngLat(20, 60));
        transform.setBearing(-35);
        transform.setPitch(30);
        const point = new Point(500, 380);
        const location = transform.screenPointToLocation(point);
        transform.setZoom(6.5);
        transform.setLocationAtPoint(location, point);
        expect(transform.locationToScreenPoint(location).dist(point)).toBeLessThan(1e-6);
    });

    test('projects symbols and picking using the same coordinates as the map', () => {
        const transform = new EqualEarthTransform();
        transform.resize(800, 600);
        transform.setZoom(2);
        transform.setCenter(new LngLat(20, 40));
        const location = new LngLat(10, 50);
        const coord = MercatorCoordinate.fromLngLat(location);
        const tile = new OverscaledTileID(0, 0, 0, 0, 0);
        const projected = transform.projectTileCoordinates(coord.x * EXTENT, coord.y * EXTENT, tile);
        const screen = new Point((projected.point.x + 1) * 400, (1 - projected.point.y) * 300);
        expect(screen.dist(transform.locationToScreenPoint(location))).toBeLessThan(1e-5);
        expect(transform.getFastPathSimpleProjectionMatrix(tile)).toBeNull();
        expect(transform.isPointOnMapSurface(screen)).toBe(true);
    });

    test('rejects the space outside the curved world outline', () => {
        const transform = new EqualEarthTransform();
        transform.resize(800, 600);
        expect(transform.isPointOnMapSurface(new Point(400, 300))).toBe(true);
        expect(transform.isPointOnMapSurface(new Point(10, 300))).toBe(false);
        expect(transform.isPointOnMapSurface(new Point(400, 10))).toBe(false);
    });

    test('keeps pitched text dimensions constant across latitudes and the transition', () => {
        const transform = new EqualEarthTransform();
        transform.resize(800, 600);
        const tile = new OverscaledTileID(0, 0, 0, 0, 0);
        for (const zoom of [1, 6.5, 7]) {
            transform.setZoom(zoom);
            for (const latitude of [0, 70, -80]) {
                const location = new LngLat(30, latitude);
                transform.setCenter(location);
                const coord = MercatorCoordinate.fromLngLat(location);
                const anchor = transform.projectTileCoordinatesToPlane(coord.x * EXTENT, coord.y * EXTENT, tile);
                const projectedAnchor = transform.projectPlanarTileCoordinates(anchor.x, anchor.y, tile).point;
                const tenPixels = 10 * EXTENT / transform.worldSize;
                const right = transform.projectPlanarTileCoordinates(anchor.x + tenPixels, anchor.y, tile).point;
                const down = transform.projectPlanarTileCoordinates(anchor.x, anchor.y + tenPixels, tile).point;
                expect(projectedAnchor.x).toBeCloseTo(0, 6);
                expect(projectedAnchor.y).toBeCloseTo(0, 6);
                expect((right.x - projectedAnchor.x) * 400).toBeCloseTo(10, 6);
                expect((projectedAnchor.y - down.y) * 300).toBeCloseTo(10, 6);
            }
        }
    });

    test('retains world-copy preferences through cloning and the transition', () => {
        const transform = new EqualEarthTransform();
        transform.resize(800, 600);
        expect(transform.renderWorldCopies).toBe(false);
        const clone = transform.clone();
        clone.setZoom(8);
        expect(clone.renderWorldCopies).toBe(true);
        transform.setRenderWorldCopies(false);
        const singleWorld = transform.clone();
        singleWorld.setZoom(8);
        expect(singleWorld.renderWorldCopies).toBe(false);
    });

    test('selects tiles containing visible high-latitude locations', () => {
        const transform = new EqualEarthTransform();
        transform.resize(800, 600);
        transform.setZoom(3);
        transform.setCenter(new LngLat(100, 65));
        const tiles = coveringTiles(transform, {tileSize: 512});
        expect(tiles.length).toBeGreaterThan(0);
        expect(tiles.every(tile => tile.wrap === 0)).toBe(true);
        for (const location of [new LngLat(80, 65), new LngLat(100, 70), new LngLat(120, 60)]) {
            const screen = transform.locationToScreenPoint(location);
            expect(screen.x).toBeGreaterThan(0);
            expect(screen.x).toBeLessThan(800);
            const coord = MercatorCoordinate.fromLngLat(location);
            expect(tiles.some(tile => tile.canonical.x === Math.floor(coord.x * 8) && tile.canonical.y === Math.floor(coord.y * 8))).toBe(true);
        }
    });

    test('matches Mercator projection and terrain data after the transition', () => {
        const transform = new EqualEarthTransform();
        transform.resize(800, 600);
        transform.setZoom(10);
        transform.setCenter(new LngLat(15, 65));
        transform.setPitch(45);
        const mercator = new MercatorTransform();
        mercator.apply(transform, false);
        const location = new LngLat(15.1, 65.1);
        expect(transform.locationToScreenPoint(location)).toEqual(mercator.locationToScreenPoint(location));
        const params = {overscaledTileID: new OverscaledTileID(10, 0, 10, 550, 260), applyGlobeMatrix: true};
        expect(transform.getProjectionData(params)).toEqual(mercator.getProjectionData(params));
    });

    test('fits the curved bounds with padding and bearing', () => {
        const {transform, cameraHelper} = createProjectionFromName('equal-earth', undefined, {});
        transform.resize(800, 600, true);
        const bounds = new LngLatBounds([-160, -70], [160, 75]);
        const padding = {top: 30, bottom: 40, left: 50, right: 60};
        const camera = cameraHelper.cameraForBoxAndBearing({maxZoom: 12, offset: [0, 0]}, padding, bounds, 30, transform);
        transform.setZoom(camera.zoom);
        transform.setCenter(camera.center);
        transform.setBearing(camera.bearing);
        for (const lng of [-160, 160]) {
            for (let lat = -70; lat <= 75; lat += 5) {
                const point = transform.locationToScreenPoint(new LngLat(lng, lat));
                expect(point.x).toBeGreaterThanOrEqual(padding.left - 0.1);
                expect(point.x).toBeLessThanOrEqual(800 - padding.right + 0.1);
                expect(point.y).toBeGreaterThanOrEqual(padding.top - 0.1);
                expect(point.y).toBeLessThanOrEqual(600 - padding.bottom + 0.1);
            }
        }
    });
});
