#ifndef PROJECTION_UBO
uniform highp vec4 u_projection_tile_mercator_coords;
uniform highp float u_projection_transition;
uniform mat4 u_projection_fallback_matrix;
#endif

out highp float v_projection_tile_x;

vec2 equalEarthProject(vec2 mercator, vec2 rawPos) {
    float t = exp(PI - mercator.y * 2.0 * PI);
    float sinLatitude = (t * t - 1.0) / (t * t + 1.0);
    if (rawPos.y < -32767.5) sinLatitude = 1.0;
    if (rawPos.y > 32766.5) sinLatitude = -1.0;
    float theta = asin(0.8660254037844386 * sinLatitude);
    float theta2 = theta * theta;
    float theta6 = theta2 * theta2 * theta2;
    float derivative = 1.340264 - 0.243318 * theta2 + theta6 * (0.006251 + 0.034164 * theta2);
    float worldWidth = 2.0 * PI / (0.8660254037844386 * 1.340264);
    return vec2(
        0.5 + (mercator.x - 0.5) * 2.0 * PI * cos(theta) / (0.8660254037844386 * derivative * worldWidth),
        0.5 - theta * (1.340264 - 0.081106 * theta2 + theta6 * (0.000893 + 0.003796 * theta2)) / worldWidth
    );
}

vec4 projectEqualEarthTile(vec2 pos, vec2 rawPos, float elevation) {
    vec2 mercator = u_projection_tile_mercator_coords.xy + u_projection_tile_mercator_coords.zw * pos;
    v_projection_tile_x = mercator.x * 8192.0;
    vec2 flatPos = pos;
    if (rawPos.y < -32767.5) {
        mercator.y = 0.0;
        flatPos.y = 0.0;
    }
    if (rawPos.y > 32766.5) {
        mercator.y = 1.0;
        flatPos.y = 8192.0;
    }
    vec4 projected = u_projection_matrix * vec4(equalEarthProject(mercator, rawPos), elevation, 1.0);
    vec4 fallback = u_projection_fallback_matrix * vec4(flatPos, elevation, 1.0);
    return mix(fallback, projected, u_projection_transition);
}

float projectLineThickness(float tileY) {
    return 1.0;
}

float projectCircleRadius(float tileY) {
    return 1.0;
}

vec4 projectTile(vec2 pos) {
    return projectEqualEarthTile(pos, vec2(0.0), 0.0);
}

vec4 projectTile(vec2 pos, vec2 rawPos) {
    return projectEqualEarthTile(pos, rawPos, 0.0);
}

vec4 projectTileWithElevation(vec2 pos, float elevation) {
    return projectEqualEarthTile(pos, vec2(0.0), elevation);
}

vec4 projectTileFor3D(vec2 pos, float elevation) {
    return projectEqualEarthTile(pos, pos, elevation);
}

vec2 projectTileToPlane(vec2 pos) {
    vec2 mercator = u_projection_tile_mercator_coords.xy + u_projection_tile_mercator_coords.zw * pos;
    vec2 projected = mix(mercator, equalEarthProject(mercator, vec2(0.0)), u_projection_transition);
    return (projected - u_projection_tile_mercator_coords.xy) / u_projection_tile_mercator_coords.zw;
}

vec4 projectPlanarTile(vec2 pos, float elevation) {
    vec2 projected = u_projection_tile_mercator_coords.xy + u_projection_tile_mercator_coords.zw * pos;
    return mix(u_projection_fallback_matrix * vec4(pos, elevation, 1.0),
        u_projection_matrix * vec4(projected, elevation, 1.0), u_projection_transition);
}

mat2 equalEarthJacobian(vec2 pos) {
    vec2 mercator = u_projection_tile_mercator_coords.xy + u_projection_tile_mercator_coords.zw * pos;
    float t = exp(PI - mercator.y * 2.0 * PI);
    float cosine = 2.0 * t / (t * t + 1.0);
    float theta = asin(0.8660254037844386 * (t * t - 1.0) / (t * t + 1.0));
    float theta2 = theta * theta;
    float theta6 = theta2 * theta2 * theta2;
    float derivative = 1.340264 - 0.243318 * theta2 + theta6 * (0.006251 + 0.034164 * theta2);
    float secondDerivative = -0.486636 * theta + theta * theta2 * theta2 * (0.037506 + 0.273312 * theta2);
    float thetaY = -2.0 * PI * 0.8660254037844386 * cosine * cosine / cos(theta);
    float xScale = 1.340264 * cos(theta) / derivative;
    float xShear = (mercator.x - 0.5) * 1.340264 * (-sin(theta) * derivative - cos(theta) * secondDerivative) / (derivative * derivative) * thetaY;
    float yScale = -derivative * thetaY * 0.8660254037844386 * 1.340264 / (2.0 * PI);
    return mat2(mix(1.0, xScale, u_projection_transition), 0.0,
        xShear * u_projection_transition, mix(1.0, yScale, u_projection_transition));
}

vec4 projectLineTile(vec2 pos, vec2 extrusion) {
    float magnitude = length(extrusion);
    if (magnitude == 0.0) return projectTile(pos);
    mat2 jacobian = equalEarthJacobian(pos);
    vec2 tangent = jacobian * vec2(extrusion.y, -extrusion.x);
    vec2 projectedExtrusion = normalize(vec2(-tangent.y, tangent.x)) * magnitude;
    vec2 tileExtrusion = inverse(jacobian) * projectedExtrusion;
    v_projection_tile_x = (u_projection_tile_mercator_coords.x + u_projection_tile_mercator_coords.z * (pos.x + tileExtrusion.x)) * 8192.0;
    return projectPlanarTile(projectTileToPlane(pos) + projectedExtrusion, 0.0);
}
