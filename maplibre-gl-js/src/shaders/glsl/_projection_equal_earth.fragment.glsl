in highp float v_projection_tile_x;
in highp float v_projection_longitude;
in highp vec2 v_projection_tile_position;

/** Equal Earth tiles clip their native bounds here instead of using overlapping stencil meshes. */
void clipEqualEarth() {
    if (v_projection_tile_position.x < 0.0 || v_projection_tile_position.x >= 8192.0) discard;
    if (v_projection_tile_position.y < 0.0 && u_projection_tile_mercator_coords.y > 0.0) discard;
    if (v_projection_tile_position.y >= 8192.0 && u_projection_tile_mercator_coords.y + u_projection_tile_mercator_coords.w * 8192.0 < 1.0) discard;
    if (u_projection_origin.z == 0.0) return;
    highp float longitude = v_projection_longitude * u_projection_origin.z;
    if (longitude < -0.000001 || longitude > 3.141593653589793) discard;
}

void clipAntimeridian() {
    if (u_projection_clip_antimeridian != 0 && (v_projection_tile_x < 0.0 || v_projection_tile_x >= 8192.0)) discard;
}
