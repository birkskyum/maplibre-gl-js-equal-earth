import {MercatorProjection} from './mercator_projection.ts';
import {shaders, type PreparedShader} from '../../shaders/shaders.ts';
import {SubdivisionGranularityExpression, SubdivisionGranularitySetting} from '../../render/subdivision_granularity_settings.ts';
import {createTileMeshWithBuffers} from '../../util/create_tile_mesh.ts';
import {equalEarthTransition} from './equal_earth_utils.ts';

import type {Projection, TileMeshUsage} from './projection.ts';
import type {Context} from '../../webgl/context.ts';
import type {CanonicalTileID} from '../../tile/tile_id.ts';
import type {Mesh} from '../../render/mesh.ts';
import type {EvaluationParameters} from '../../style/evaluation_parameters.ts';

/** Subdivision bounds curvature error for fills, lines and raster tiles at world-scale zooms. */
const granularity = new SubdivisionGranularitySetting({
    fill: new SubdivisionGranularityExpression(128, 2),
    line: new SubdivisionGranularityExpression(512, 0),
    tile: new SubdivisionGranularityExpression(128, 32),
    stencil: new SubdivisionGranularityExpression(128, 1),
    circle: 3
});

/** A planar, equal-area world map that transitions to Mercator between zoom levels 6 and 7. */
export class EqualEarthProjection implements Projection {
    private readonly mercator = new MercatorProjection();
    private readonly meshes = new Map<string, Mesh>();
    private transition = 1;

    get name(): 'equal-earth' { return 'equal-earth'; }
    get transitionState(): number { return this.transition; }
    get useSubdivision(): boolean { return this.transition > 0; }
    get shaderVariantName(): string { return this.useSubdivision ? 'equal-earth' : this.mercator.shaderVariantName; }
    get shaderDefine(): string { return this.useSubdivision ? '#define EQUAL_EARTH' : this.mercator.shaderDefine; }
    get shaderPreludeCode(): PreparedShader { return this.useSubdivision ? shaders.projectionEqualEarth : this.mercator.shaderPreludeCode; }
    get vertexShaderPreludeCode(): string { return this.shaderPreludeCode.vertexSource; }
    get subdivisionGranularity(): SubdivisionGranularitySetting { return granularity; }

    recalculate(parameters: EvaluationParameters): void {
        this.transition = equalEarthTransition(parameters.zoom);
    }

    hasTransition(): boolean { return false; }

    getMeshFromTileID(context: Context, tileID: CanonicalTileID, hasBorder: boolean, allowPoles: boolean, usage: TileMeshUsage): Mesh {
        const subdivisions = this.useSubdivision ? (usage === 'stencil' ? granularity.stencil : granularity.tile).getGranularityForZoomLevel(tileID.z) : 1;
        const border = this.useSubdivision && hasBorder;
        const north = this.useSubdivision && allowPoles && tileID.y === 0;
        const south = this.useSubdivision && allowPoles && tileID.y === (1 << tileID.z) - 1;
        const key = `${subdivisions}/${border}/${north}/${south}`;
        if (!this.meshes.has(key)) {
            this.meshes.set(key, createTileMeshWithBuffers(context, {
                granularity: subdivisions,
                generateBorders: border,
                extendToNorthPole: north,
                extendToSouthPole: south
            }));
        }
        return this.meshes.get(key);
    }

    destroy(): void {
        for (const mesh of this.meshes.values()) mesh.destroy();
        this.meshes.clear();
        this.mercator.destroy();
    }
}
