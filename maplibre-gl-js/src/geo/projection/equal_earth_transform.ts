import Point from '@mapbox/point-geometry';
import {mat4, vec4} from 'gl-matrix';
import {MercatorTransform} from './mercator_transform.ts';
import {MercatorCoordinate} from '../mercator_coordinate.ts';
import {LngLat} from '../lng_lat.ts';
import {LngLatBounds} from '../lng_lat_bounds.ts';
import {equalEarthTransition, projectAdaptiveEqualEarth, projectEqualEarth, unprojectAdaptiveEqualEarth, rotateEqualEarth, unrotateEqualEarth, type EqualEarthParameters} from './equal_earth_utils.ts';
import {MercatorCoveringTilesDetailsProvider} from './mercator_covering_tiles_details_provider.ts';
import {Aabb} from '../../util/primitives/aabb.ts';
import {clamp} from '../../util/util.ts';
import {EXTENT} from '../../data/extent.ts';
import {UnwrappedTileID, OverscaledTileID} from '../../tile/tile_id.ts';

import type {TransformOptions} from '../transform_helper.ts';
import type {ITransform} from '../transform_interface.ts';
import type {Terrain} from '../../render/terrain.ts';
import type {CanonicalTileID} from '../../tile/tile_id.ts';
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

    constructor(options?: TransformOptions, readonly parameters: EqualEarthParameters = {}) {
        super(options);
        const mercatorConstrain = this.defaultConstrain;
        this.defaultConstrain = (center, zoom) => {
            if (equalEarthTransition(zoom, this.parameters.transition) === 0) return mercatorConstrain(center, zoom);
            const bounds = this.getMaxBounds();
            const longitudeOrigin = this.parameters.center?.[1] === 0 ? this.parameters.center[0] : 0;
            if (!bounds) center = this.locationInOriginWorld(center);
            return {
                center: new LngLat(
                    clamp(center.lng, bounds?.getWest() ?? longitudeOrigin - 180, bounds?.getEast() ?? longitudeOrigin + 180),
                    clamp(center.lat, bounds?.getSouth() ?? -90, bounds?.getNorth() ?? 90)
                ),
                zoom: clamp(zoom, this.minZoom, this.maxZoom)
            };
        };
    }

    get transitionState(): number { return equalEarthTransition(this.zoom, this.parameters.transition); }
    get renderWorldCopies(): boolean { return this.hasOrigin || (this.transitionState === 0 && super.renderWorldCopies); }
    get renderWorldCopiesSetting(): boolean { return super.renderWorldCopies; }
    get hasOrigin(): boolean { return this.transitionState > 0 && !!this.parameters.center; }

    /** Keeps the inherited planar camera finite when a fixed projection is centered on a pole. */
    protected get cameraCenter(): LngLat {
        return new LngLat(this.center.lng, clamp(this.center.lat, -85.0511287798066, 85.0511287798066));
    }

    /** Two longitude hemispheres keep the rotated projection's cut outside each rendered patch. */
    hemisphere(wrap: number): number { return this.hasOrigin ? ((wrap % 2 + 2) % 2 === 0 ? -1 : 1) : 0; }
    physicalWrap(wrap: number): number { return this.hasOrigin ? Math.floor(wrap / 2) : wrap; }

    /** Tests membership before rotation, where the hemisphere boundaries are straight meridians. */
    private inHemisphere(longitude: number, wrap: number): boolean {
        if (!this.hasOrigin) return true;
        const relative = (longitude - this.parameters.center[0]) * this.hemisphere(wrap);
        return relative >= 0 && relative < 180;
    }

    clone(): ITransform {
        const clone = new EqualEarthTransform(undefined, {
            transition: Array.isArray(this.parameters.transition) ? [...this.parameters.transition] : this.parameters.transition,
            center: this.parameters.center ? [...this.parameters.center] : undefined
        });
        clone.apply(this, false);
        return clone;
    }

    /** Small tiles use coordinates relative to their projected midpoint to retain GPU precision at street zooms. */
    private usesLocalCoordinates(tileID?: UnwrappedTileID): boolean {
        return this.transitionState === 1 && tileID?.canonical.z >= 12 && tileID.canonical.y > 0 && tileID.canonical.y < (1 << tileID.canonical.z) - 1;
    }

    private projectedTileCenter(tileID: UnwrappedTileID): Point {
        const scale = 1 << tileID.canonical.z;
        const location = new MercatorCoordinate(this.physicalWrap(tileID.wrap) + (tileID.canonical.x + 0.5) / scale,
            (tileID.canonical.y + 0.5) / scale).toLngLat();
        return projectAdaptiveEqualEarth(location, this.transitionState, this.parameters.center, this.hemisphere(tileID.wrap) * 90);
    }

    /** Coordinates in the Mercator camera's plane, including the center-preserving translation. */
    projectToCameraPlane(location: LngLat, reference: number = 0): Point {
        const transition = this.transitionState;
        const center = MercatorCoordinate.fromLngLat(this.cameraCenter);
        return projectAdaptiveEqualEarth(location, transition, this.parameters.center, reference)
            .sub(projectAdaptiveEqualEarth(this.center, transition, this.parameters.center))
            .add(new Point(center.x, center.y));
    }

    private unprojectFromCameraPlane(point: Point): LngLat {
        const center = MercatorCoordinate.fromLngLat(this.cameraCenter);
        return unprojectAdaptiveEqualEarth(point.sub(new Point(center.x, center.y))
            .add(projectAdaptiveEqualEarth(this.center, this.transitionState, this.parameters.center)), this.transitionState, this.parameters.center);
    }

    /** Keeps picking and camera anchors in the world copy containing an east/west-shifted origin. */
    private locationInOriginWorld(location: LngLat): LngLat {
        const origin = this.parameters.center;
        if (origin?.[1] !== 0) return location;
        return new LngLat(location.lng + 360 * Math.round((origin[0] - location.lng) / 360), location.lat);
    }

    coordinatePoint(coord: MercatorCoordinate, elevation: number = 0, pixelMatrix?: mat4): Point {
        if (!this.transitionState) return super.coordinatePoint(coord, elevation, pixelMatrix);
        const projected = this.projectToCameraPlane(this.locationInOriginWorld(coord.toLngLat()));
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
        const center = projectAdaptiveEqualEarth(this.locationInOriginWorld(location), this.transitionState, this.parameters.center).sub(new Point(a.x - b.x, a.y - b.y));
        this.setCenter(unprojectAdaptiveEqualEarth(center, this.transitionState, this.parameters.center));
    }

    getVisibleUnwrappedCoordinates(tileID: CanonicalTileID): UnwrappedTileID[] {
        if (this.hasOrigin) return [-2, -1, 0, 1, 2, 3].map(wrap => new UnwrappedTileID(wrap, tileID));
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
        if (this.hasOrigin) return perspective * 64;
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
        const origin = new Point(this.physicalWrap(tileID.wrap) + tileID.canonical.x / scale, tileID.canonical.y / scale);
        const location = new MercatorCoordinate(origin.x + x / EXTENT / scale, origin.y + y / EXTENT / scale).toLngLat();
        const reference = this.usesLocalCoordinates(tileID) ? this.projectedTileCenter(tileID) : origin;
        return projectAdaptiveEqualEarth(location, this.transitionState, this.parameters.center, this.hemisphere(tileID.wrap) * 90).sub(reference).mult(scale * EXTENT);
    }

    /** Applies the planar camera to glyphs that have already been laid out in Equal Earth coordinates. */
    projectPlanarTileCoordinates(x: number, y: number, tileID: UnwrappedTileID, elevation: number = 0): PointProjection {
        if (!this.transitionState) return super.projectTileCoordinates(x, y, tileID, elevation);
        const scale = 1 << tileID.canonical.z;
        const center = MercatorCoordinate.fromLngLat(this.cameraCenter);
        const projectedCenter = projectAdaptiveEqualEarth(this.center, this.transitionState, this.parameters.center);
        const origin = this.usesLocalCoordinates(tileID) ? this.projectedTileCenter(tileID)
            : new Point(this.physicalWrap(tileID.wrap) + tileID.canonical.x / scale, tileID.canonical.y / scale);
        const position = vec4.transformMat4(new Float64Array(4), [
            (origin.x + x / EXTENT / scale + center.x - projectedCenter.x) * this.worldSize,
            (origin.y + y / EXTENT / scale + center.y - projectedCenter.y) * this.worldSize,
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
            this.physicalWrap(tileID.wrap) + (tileID.canonical.x + x / EXTENT) / scale,
            (tileID.canonical.y + y / EXTENT) / scale
        ).toLngLat();
        const projected = this.projectToCameraPlane(location, this.hemisphere(tileID.wrap) * 90);
        const position = vec4.transformMat4(new Float64Array(4),
            [projected.x * this.worldSize, projected.y * this.worldSize, elevation, 1], this.modelViewProjectionMatrix);
        return {
            point: new Point(position[0] / position[3], position[1] / position[3]),
            signedDistanceFromCamera: position[3],
            isOccluded: !this.inHemisphere(location.lng, tileID.wrap)
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
        if (!this.hasOrigin && (location.lng < -180 || location.lng > 180)) return false;
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

    private equalEarthMatrix(tileID?: UnwrappedTileID): mat4 {
        const center = MercatorCoordinate.fromLngLat(this.cameraCenter);
        const equalCenter = projectEqualEarth(this.parameters.center ? rotateEqualEarth(this.center, this.parameters.center) : this.center);
        const matrix = new Float64Array(this.modelViewProjectionMatrix);
        mat4.translate(matrix, matrix, [(center.x - equalCenter.x) * this.worldSize, (center.y - equalCenter.y) * this.worldSize, 0]);
        mat4.scale(matrix, matrix, [this.worldSize, this.worldSize, 1]);
        if (!this.usesLocalCoordinates(tileID)) return matrix;
        const anchor = this.projectedTileCenter(tileID);
        mat4.translate(matrix, matrix, [anchor.x, anchor.y, 0]);
        const scale = 1 / ((1 << tileID.canonical.z) * EXTENT);
        return mat4.scale(matrix, matrix, [scale, scale, 1]);
    }

    getProjectionData(params: ProjectionDataParams): RendererProjectionData {
        const tile = params.overscaledTileID;
        const physicalTile = this.hasOrigin && tile ? new OverscaledTileID(tile.overscaledZ, this.physicalWrap(tile.wrap), tile.canonical.z, tile.canonical.x, tile.canonical.y) : tile;
        const mercator = super.getProjectionData({...params, overscaledTileID: physicalTile});
        if (!this.transitionState || params.applyGlobeMatrix === false) return mercator;
        return {
            ...mercator,
            tileMercatorCoords: [mercator.tileMercatorCoords[0] + (physicalTile?.wrap ?? 0), ...mercator.tileMercatorCoords.slice(1)] as [number, number, number, number],
            mainMatrix: new Float32Array(this.equalEarthMatrix(tile)),
            clippingPlane: [0, 0, 0, this.usesLocalCoordinates(tile) ? 1 : 0],
            projectionTransition: this.transitionState,
            clipAntimeridian: true,
            projectionOrigin: this.hasOrigin ? [this.parameters.center[0] * Math.PI / 180, this.parameters.center[1] * Math.PI / 180,
                this.hemisphere(tile?.wrap ?? 0), this.physicalWrap(tile?.wrap ?? 0)] : [0, 0, 0, 0]
        };
    }

    getProjectionDataForCustomLayer(applyGlobeMatrix: boolean = true): CustomLayerProjectionData {
        const mercator = super.getProjectionDataForCustomLayer(false);
        if (!this.transitionState || !applyGlobeMatrix) return mercator;
        return {
            ...mercator,
            mainMatrix: new Float64Array(this.equalEarthMatrix()),
            projectionTransition: this.transitionState,
            projectionOrigin: this.hasOrigin ? [this.parameters.center[0] * Math.PI / 180, this.parameters.center[1] * Math.PI / 180, 1, 0] : [0, 0, 0, 0]
        };
    }
}

/**
 * Bounds curved tiles in the camera plane. X is linear in longitude and its latitude extrema occur
 * on a tile edge or at the equator; Y is monotonic. Including these points gives conservative bounds.
 */
class EqualEarthCoveringTilesDetailsProvider extends MercatorCoveringTilesDetailsProvider {
    constructor(private readonly transform: EqualEarthTransform) { super(); }

    /** Polar caps extend the last Mercator row; loading every longitude at street detail adds no data there. */
    getTileZoom(tile: {x: number; y: number; z: number}, desiredZoom: number): number {
        const latitude = this.transform.center.lat;
        const cap = latitude > 85.0511287798066 ? tile.y === 0 : latitude < -85.0511287798066 && tile.y === (1 << tile.z) - 1;
        return cap ? Math.min(desiredZoom, 6) : desiredZoom;
    }

    getTileBoundingVolume(tileID: {x: number; y: number; z: number}, wrap: number, elevation: number, options: CoveringTilesOptionsInternal): Aabb {
        const mercator = super.getTileBoundingVolume(tileID, wrap, elevation, options);
        const scale = 1 << tileID.z;
        if (this.transform.hasOrigin) return this.rotatedBounds(tileID, wrap, mercator);
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

    /** Samples each hemisphere separately and includes rotated poles that can lie inside a tile. */
    private rotatedBounds(tile: {x: number; y: number; z: number}, wrap: number, mercator: Aabb): Aabb {
        const tr = this.transform;
        const scale = 1 << tile.z;
        const copy = tr.physicalWrap(wrap);
        const sign = tr.hemisphere(wrap);
        const origin = tr.parameters.center;
        const centerX = (origin[0] + 180) / 360;
        const west = Math.max(copy + tile.x / scale, centerX + (sign < 0 ? -0.5 : 0));
        const east = Math.min(copy + (tile.x + 1) / scale, centerX + (sign < 0 ? 0 : 0.5));
        if (west >= east) return new Aabb([1e6, 1e6, 0], [1e6, 1e6, 0]);
        const north = tile.y === 0 ? 90 : new MercatorCoordinate(0, tile.y / scale).toLngLat().lat;
        const south = tile.y === scale - 1 ? -90 : new MercatorCoordinate(0, (tile.y + 1) / scale).toLngLat().lat;
        const points: Point[] = [];
        for (let x = 0; x <= 8; x++) {
            for (let y = 0; y <= 8; y++) {
                points.push(tr.projectToCameraPlane(new LngLat((west + (east - west) * x / 8) * 360 - 180,
                    south + (north - south) * y / 8), sign * 90));
            }
        }
        for (const pole of [-90, 90]) {
            const location = unrotateEqualEarth(new LngLat(0, pole), origin);
            const lng = location.lng + Math.round(((west + east) * 180 - 180 - location.lng) / 360) * 360;
            if (lng < west * 360 - 180 || lng > east * 360 - 180 || location.lat < south || location.lat > north) continue;
            const shift = tr.projectToCameraPlane(new LngLat(...origin)).sub(new Point(0.5, 0.5));
            points.push(projectEqualEarth(new LngLat(0, pole)).add(shift), projectEqualEarth(new LngLat(sign * 180, pole)).add(shift));
        }
        const pad = (east - west + (north - south) / 360) / 8;
        return new Aabb([Math.min(...points.map(p => p.x)) - pad, Math.min(...points.map(p => p.y)) - pad, mercator.min[2]],
            [Math.max(...points.map(p => p.x)) + pad, Math.max(...points.map(p => p.y)) + pad, mercator.max[2]]);
    }

    allowWorldCopies(): boolean { return this.transform.hasOrigin; }
}
