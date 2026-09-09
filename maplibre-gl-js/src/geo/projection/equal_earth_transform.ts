import Point from '@mapbox/point-geometry';
import {mat4, vec4} from 'gl-matrix';
import {MercatorTransform} from './mercator_transform.ts';
import {MercatorCoordinate} from '../mercator_coordinate.ts';
import {LngLat} from '../lng_lat.ts';
import {LngLatBounds} from '../lng_lat_bounds.ts';
import {equalEarthTransition, projectAdaptiveEqualEarth, projectEqualEarth, unprojectAdaptiveEqualEarth} from './equal_earth_utils.ts';
import {MercatorCoveringTilesDetailsProvider} from './mercator_covering_tiles_details_provider.ts';
import {Aabb} from '../../util/primitives/aabb.ts';
import {clamp} from '../../util/util.ts';
import {EXTENT} from '../../data/extent.ts';
import {UnwrappedTileID} from '../../tile/tile_id.ts';

import type {TransformOptions} from '../transform_helper.ts';
import type {IReadonlyTransform, ITransform} from '../transform_interface.ts';
import type {Terrain} from '../../render/terrain.ts';
import type {CanonicalTileID, OverscaledTileID} from '../../tile/tile_id.ts';
import type {PointProjection} from '../../symbol/projection.ts';
import type {CustomLayerProjectionData, ProjectionDataParams, RendererProjectionData} from './projection_data.ts';
import type {CoveringTilesOptionsInternal} from './covering_tiles.ts';
import type {CoveringTilesDetailsProvider} from './covering_tiles_details_provider.ts';

/**
 * Uses the planar Mercator camera with Equal Earth world coordinates. Translating the projected
 * world by the difference between the two projected centers keeps the selected location stationary
 * while zooming. CPU projection, inverse projection and tile bounds use the same blend as the shader.
 */
export class EqualEarthTransform extends MercatorTransform {
    private readonly equalEarthTiles = new EqualEarthCoveringTilesDetailsProvider(this);

    constructor(options?: TransformOptions) {
        super(options);
        const mercatorConstrain = this.defaultConstrain;
        this.defaultConstrain = (center, zoom) => {
            if (equalEarthTransition(zoom) === 0) return mercatorConstrain(center, zoom);
            const bounds = this.getMaxBounds();
            return {
                center: new LngLat(
                    clamp(center.lng, bounds?.getWest() ?? -180, bounds?.getEast() ?? 180),
                    clamp(center.lat, bounds?.getSouth() ?? -85.0511287798066, bounds?.getNorth() ?? 85.0511287798066)
                ),
                zoom: clamp(zoom, this.minZoom, this.maxZoom)
            };
        };
    }

    get transitionState(): number { return equalEarthTransition(this.zoom); }
    get renderWorldCopies(): boolean { return this.transitionState === 0 && super.renderWorldCopies; }

    clone(): ITransform {
        const clone = new EqualEarthTransform();
        clone.apply(this, false);
        return clone;
    }

    apply(that: IReadonlyTransform, constrain: boolean, forceOverrideZ?: boolean): void {
        super.apply(that, constrain, forceOverrideZ);
        if (that instanceof EqualEarthTransform) this.setRenderWorldCopies(that.mercatorWorldCopies);
    }

    private get mercatorWorldCopies(): boolean { return super.renderWorldCopies; }

    /** Coordinates in the Mercator camera's plane, including the center-preserving translation. */
    projectToCameraPlane(location: LngLat): Point {
        const transition = this.transitionState;
        const center = MercatorCoordinate.fromLngLat(this.center);
        return projectAdaptiveEqualEarth(location, transition)
            .sub(projectAdaptiveEqualEarth(this.center, transition))
            .add(new Point(center.x, center.y));
    }

    private unprojectFromCameraPlane(point: Point): LngLat {
        const center = MercatorCoordinate.fromLngLat(this.center);
        return unprojectAdaptiveEqualEarth(point.sub(new Point(center.x, center.y))
            .add(projectAdaptiveEqualEarth(this.center, this.transitionState)), this.transitionState);
    }

    coordinatePoint(coord: MercatorCoordinate, elevation: number = 0, pixelMatrix?: mat4): Point {
        if (!this.transitionState) return super.coordinatePoint(coord, elevation, pixelMatrix);
        const projected = this.projectToCameraPlane(coord.toLngLat());
        return super.coordinatePoint(new MercatorCoordinate(projected.x, projected.y), elevation, pixelMatrix);
    }

    screenPointToMercatorCoordinateAtZ(point: Point, z?: number): MercatorCoordinate {
        const planar = super.screenPointToMercatorCoordinateAtZ(point, z);
        if (!this.transitionState) return planar;
        const location = this.unprojectFromCameraPlane(new Point(planar.x, planar.y));
        const coord = MercatorCoordinate.fromLngLat(location);
        coord.z = planar.z;
        return coord;
    }

    /** Terrain picking uses the existing Mercator implementation after the adaptive transition. */
    screenTerrainPointToMercatorCoordinate(point: Point, terrain: Terrain): MercatorCoordinate | null {
        return this.transitionState ? null : super.screenTerrainPointToMercatorCoordinate(point, terrain);
    }

    setLocationAtPoint(location: LngLat, point: Point, elevation: number = this.elevation): void {
        if (!this.transitionState) return super.setLocationAtPoint(location, point, elevation);
        const a = super.screenPointToMercatorCoordinateAtZ(point, elevation - this.elevation);
        const b = super.screenPointToMercatorCoordinateAtZ(this.centerPoint, 0);
        const center = projectAdaptiveEqualEarth(location, this.transitionState).sub(new Point(a.x - b.x, a.y - b.y));
        this.setCenter(unprojectAdaptiveEqualEarth(center, this.transitionState));
    }

    getVisibleUnwrappedCoordinates(tileID: CanonicalTileID): UnwrappedTileID[] {
        return this.transitionState ? [new UnwrappedTileID(0, tileID)] : super.getVisibleUnwrappedCoordinates(tileID);
    }

    getCoveringTilesDetailsProvider(): CoveringTilesDetailsProvider {
        return this.transitionState ? this.equalEarthTiles : super.getCoveringTilesDetailsProvider();
    }

    getFastPathSimpleProjectionMatrix(tileID: OverscaledTileID): mat4 {
        return this.transitionState ? null : super.getFastPathSimpleProjectionMatrix(tileID);
    }

    /** Expands query candidates to account for pixel-sized strokes near the compressed Mercator edges. */
    maxPitchScaleFactor(): number {
        const perspective = super.maxPitchScaleFactor();
        if (!this.transitionState) return perspective;
        const delta = 1e-5;
        const edge = projectAdaptiveEqualEarth(new MercatorCoordinate(1, 0).toLngLat(), this.transitionState);
        const east = projectAdaptiveEqualEarth(new MercatorCoordinate(1 + delta, 0).toLngLat(), this.transitionState).sub(edge).div(delta);
        const south = projectAdaptiveEqualEarth(new MercatorCoordinate(1, delta).toLngLat(), this.transitionState).sub(edge).div(delta);
        const inverseScale = Math.max(1 / east.x + Math.abs(south.x / (east.x * south.y)), 1 / south.y);
        return perspective * Math.max(1, inverseScale);
    }

    /** Layout glyphs in the projected plane so their width and height do not inherit geographic distortion. */
    projectTileCoordinatesToPlane(x: number, y: number, tileID: UnwrappedTileID): Point {
        if (!this.transitionState) return new Point(x, y);
        const scale = 1 << tileID.canonical.z;
        const origin = new Point(tileID.wrap + tileID.canonical.x / scale, tileID.canonical.y / scale);
        const location = new MercatorCoordinate(origin.x + x / EXTENT / scale, origin.y + y / EXTENT / scale).toLngLat();
        return projectAdaptiveEqualEarth(location, this.transitionState).sub(origin).mult(scale * EXTENT);
    }

    /** Applies the planar camera to glyphs that have already been laid out in Equal Earth coordinates. */
    projectPlanarTileCoordinates(x: number, y: number, tileID: UnwrappedTileID, elevation: number = 0): PointProjection {
        if (!this.transitionState) return super.projectTileCoordinates(x, y, tileID, elevation);
        const scale = 1 << tileID.canonical.z;
        const center = MercatorCoordinate.fromLngLat(this.center);
        const projectedCenter = projectAdaptiveEqualEarth(this.center, this.transitionState);
        const position = vec4.transformMat4(new Float64Array(4), [
            (tileID.wrap + (tileID.canonical.x + x / EXTENT) / scale + center.x - projectedCenter.x) * this.worldSize,
            ((tileID.canonical.y + y / EXTENT) / scale + center.y - projectedCenter.y) * this.worldSize,
            elevation, 1
        ], this.modelViewProjectionMatrix);
        return {
            point: new Point(position[0] / position[3], position[1] / position[3]),
            signedDistanceFromCamera: position[3],
            isOccluded: false
        };
    }

    projectTileCoordinates(x: number, y: number, tileID: UnwrappedTileID, elevation: number = 0): PointProjection {
        if (!this.transitionState) return super.projectTileCoordinates(x, y, tileID, elevation);
        const scale = 1 << tileID.canonical.z;
        const location = new MercatorCoordinate(
            tileID.wrap + (tileID.canonical.x + x / EXTENT) / scale,
            (tileID.canonical.y + y / EXTENT) / scale
        ).toLngLat();
        const projected = this.projectToCameraPlane(location);
        const position = vec4.transformMat4(new Float64Array(4),
            [projected.x * this.worldSize, projected.y * this.worldSize, elevation, 1], this.modelViewProjectionMatrix);
        return {
            point: new Point(position[0] / position[3], position[1] / position[3]),
            signedDistanceFromCamera: position[3],
            isOccluded: false
        };
    }

    lngLatToCameraDepth(location: LngLat, elevation: number): number {
        if (!this.transitionState) return super.lngLatToCameraDepth(location, elevation);
        const projected = this.projectToCameraPlane(location);
        const position = vec4.transformMat4(new Float64Array(4),
            [projected.x * this.worldSize, projected.y * this.worldSize, elevation, 1], this.modelViewProjectionMatrix);
        return position[2] / position[3];
    }

    isPointOnMapSurface(point: Point, terrain?: Terrain): boolean {
        if (!this.transitionState) return super.isPointOnMapSurface(point, terrain);
        if (!super.isPointOnMapSurface(point)) return false;
        const location = this.screenPointToLocation(point);
        if (location.lng < -180 || location.lng > 180) return false;
        return this.locationToScreenPoint(location).dist(point) < 1e-3;
    }

    /** Samples the viewport edges because extrema of the curved meridians can lie between its corners. */
    getBounds(): LngLatBounds {
        if (!this.transitionState) return super.getBounds();
        const bounds = new LngLatBounds();
        for (let i = 0; i <= 32; i++) {
            const fraction = i / 32;
            for (const point of [new Point(this.width * fraction, 0), new Point(this.width * fraction, this.height),
                new Point(0, this.height * fraction), new Point(this.width, this.height * fraction)]) {
                const location = this.screenPointToLocation(point);
                bounds.extend(new LngLat(clamp(location.lng, -180, 180), location.lat));
            }
        }
        return bounds;
    }

    private equalEarthMatrix(): mat4 {
        const center = MercatorCoordinate.fromLngLat(this.center);
        const equalCenter = projectEqualEarth(this.center);
        const matrix = new Float64Array(this.modelViewProjectionMatrix);
        mat4.translate(matrix, matrix, [(center.x - equalCenter.x) * this.worldSize, (center.y - equalCenter.y) * this.worldSize, 0]);
        return mat4.scale(matrix, matrix, [this.worldSize, this.worldSize, 1]);
    }

    getProjectionData(params: ProjectionDataParams): RendererProjectionData {
        const mercator = super.getProjectionData(params);
        if (!this.transitionState || params.applyGlobeMatrix === false) return mercator;
        return {
            ...mercator,
            mainMatrix: new Float32Array(this.equalEarthMatrix()),
            projectionTransition: this.transitionState,
            clipAntimeridian: true
        };
    }

    getProjectionDataForCustomLayer(applyGlobeMatrix: boolean = true): CustomLayerProjectionData {
        const mercator = super.getProjectionDataForCustomLayer(false);
        if (!this.transitionState || !applyGlobeMatrix) return mercator;
        return {
            ...mercator,
            mainMatrix: new Float64Array(this.equalEarthMatrix()),
            projectionTransition: this.transitionState
        };
    }
}

/**
 * Bounds curved tiles in the camera plane. X is linear in longitude and its latitude extrema occur
 * on a tile edge or at the equator; Y is monotonic. Including these points gives conservative bounds.
 */
class EqualEarthCoveringTilesDetailsProvider extends MercatorCoveringTilesDetailsProvider {
    constructor(private readonly transform: EqualEarthTransform) { super(); }

    getTileBoundingVolume(tileID: {x: number; y: number; z: number}, wrap: number, elevation: number, options: CoveringTilesOptionsInternal): Aabb {
        const mercator = super.getTileBoundingVolume(tileID, wrap, elevation, options);
        const scale = 1 << tileID.z;
        const north = tileID.y === 0 ? 90 : new MercatorCoordinate(0, tileID.y / scale).toLngLat().lat;
        const south = tileID.y === scale - 1 ? -90 : new MercatorCoordinate(0, (tileID.y + 1) / scale).toLngLat().lat;
        const points: Point[] = [];
        for (const x of [tileID.x / scale, (tileID.x + 1) / scale]) {
            for (const lat of [south, north, clamp(0, south, north)]) {
                points.push(this.transform.projectToCameraPlane(new LngLat(x * 360 - 180, lat)));
            }
        }
        return new Aabb(
            [Math.min(...points.map(p => p.x)), Math.min(...points.map(p => p.y)), mercator.min[2]],
            [Math.max(...points.map(p => p.x)), Math.max(...points.map(p => p.y)), mercator.max[2]]
        );
    }

    allowWorldCopies(): boolean { return false; }
}
