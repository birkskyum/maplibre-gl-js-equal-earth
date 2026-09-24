#ifndef PROJECTION_UBO
uniform highp vec4 u_projection_tile_mercator_coords;
uniform highp vec4 u_projection_origin;
uniform highp vec4 u_projection_clipping_plane;
uniform highp float u_projection_transition;
uniform mat4 u_projection_fallback_matrix;
#endif

out highp float v_projection_tile_x;
out highp float v_projection_longitude;
out highp vec2 v_projection_tile_position;

mat2 equalEarthJacobian(vec2 pos);

/** Projects through hemisphere boundaries so fragment clipping does not leave gaps between triangles. */
vec2 equalEarthProject(vec2 mercator, vec2 rawPos) {
    float t = exp(PI - mercator.y * 2.0 * PI);
    float sinLatitude = (t * t - 1.0) / (t * t + 1.0);
    if (rawPos.y < -32767.5) sinLatitude = 1.0;
    if (rawPos.y > 32766.5) sinLatitude = -1.0;
    float longitude = (mercator.x - 0.5) * 2.0 * PI;
    if (u_projection_origin.z != 0.0) {
        longitude -= u_projection_origin.x;
        if (u_projection_origin.y != 0.0) {
            float cosine = sqrt(max(0.0, 1.0 - sinLatitude * sinLatitude));
            float x = cosine * cos(longitude);
            float y = cosine * sin(longitude);
            float rotatedX = x * cos(u_projection_origin.y) + sinLatitude * sin(u_projection_origin.y);
            sinLatitude = sinLatitude * cos(u_projection_origin.y) - x * sin(u_projection_origin.y);
            longitude = atan(y, rotatedX);
            longitude += 2.0 * PI * floor((u_projection_origin.z * 0.5 * PI - longitude) / (2.0 * PI) + 0.5);
        }
    }
    float theta = asin(0.8660254037844386 * clamp(sinLatitude, -1.0, 1.0));
    float theta2 = theta * theta;
    float theta6 = theta2 * theta2 * theta2;
    float derivative = 1.340264 - 0.243318 * theta2 + theta6 * (0.006251 + 0.034164 * theta2);
    float worldWidth = 2.0 * PI / (0.8660254037844386 * 1.340264);
    return vec2(
        0.5 + longitude * cos(theta) / (0.8660254037844386 * derivative * worldWidth),
        0.5 - theta * (1.340264 - 0.081106 * theta2 + theta6 * (0.000893 + 0.003796 * theta2)) / worldWidth
    );
}

vec4 projectEqualEarthTile(vec2 pos, vec2 rawPos, float elevation) {
    v_projection_tile_position = pos;
    vec2 mercator = u_projection_tile_mercator_coords.xy + u_projection_tile_mercator_coords.zw * pos;
    v_projection_tile_x = (mercator.x - u_projection_origin.w) * 8192.0;
    v_projection_longitude = (mercator.x - 0.5) * 2.0 * PI - u_projection_origin.x;
    if (u_projection_clipping_plane.w != 0.0) {
        return u_projection_matrix * vec4(equalEarthJacobian(vec2(4096.0)) * (pos - 4096.0), elevation, 1.0);
    }
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
    return projectEqualEarthTile(pos, pos, 0.0);
}

vec4 projectTile(vec2 pos, vec2 rawPos) {
    return projectEqualEarthTile(pos, rawPos, 0.0);
}

/** Keeps each mask grid inside its hemisphere so collapsed triangles cannot cover neighboring tiles. */
vec4 projectTileMask(vec2 pos) {
    if (u_projection_origin.z == 0.0) return projectTile(pos);
    float west = u_projection_origin.x / (2.0 * PI) + 0.5 + (u_projection_origin.z < 0.0 ? -0.5 : 0.0);
    vec2 bounds = (vec2(west, west + 0.5) - u_projection_tile_mercator_coords.x) / u_projection_tile_mercator_coords.z;
    bounds = clamp(bounds, 0.0, 8192.0);
    if (bounds.x >= bounds.y) return vec4(2.0, 2.0, 2.0, 1.0);
    pos.x = mix(bounds.x, bounds.y, pos.x / 8192.0);
    return projectTile(pos);
}

float equalEarthAnchorLongitude(vec2 pos) {
    float longitude = ((u_projection_tile_mercator_coords.x + u_projection_tile_mercator_coords.z * pos.x - 0.5) * 2.0 * PI - u_projection_origin.x) * u_projection_origin.z;
    if (longitude >= 0.0 && longitude < PI) longitude = clamp(longitude, 0.000002, PI - 0.000002);
    return longitude * u_projection_origin.z;
}

vec4 projectTileWithElevation(vec2 pos, float elevation) {
    vec4 projected = projectEqualEarthTile(pos, vec2(0.0), elevation);
    v_projection_longitude = equalEarthAnchorLongitude(pos);
    return projected;
}

vec4 projectTileFor3D(vec2 pos, float elevation) {
    return projectEqualEarthTile(pos, pos, elevation);
}

vec2 projectTileToPlane(vec2 pos) {
    v_projection_tile_position = pos;
    vec2 mercator = u_projection_tile_mercator_coords.xy + u_projection_tile_mercator_coords.zw * pos;
    v_projection_longitude = equalEarthAnchorLongitude(pos);
    if (u_projection_clipping_plane.w != 0.0) return equalEarthJacobian(vec2(4096.0)) * (pos - 4096.0);
    vec2 projected = mix(mercator, equalEarthProject(mercator, vec2(0.0)), u_projection_transition);
    return (projected - u_projection_tile_mercator_coords.xy) / u_projection_tile_mercator_coords.zw;
}

vec4 projectPlanarTile(vec2 pos, float elevation) {
    if (u_projection_clipping_plane.w != 0.0) return u_projection_matrix * vec4(pos, elevation, 1.0);
    vec2 projected = u_projection_tile_mercator_coords.xy + u_projection_tile_mercator_coords.zw * pos;
    return mix(u_projection_fallback_matrix * vec4(pos, elevation, 1.0),
        u_projection_matrix * vec4(projected, elevation, 1.0), u_projection_transition);
}

mat2 equalEarthJacobian(vec2 pos) {
    vec2 mercator = u_projection_tile_mercator_coords.xy + u_projection_tile_mercator_coords.zw * pos;
    float t = exp(PI - mercator.y * 2.0 * PI);
    float c = 2.0 * t / (t * t + 1.0);
    float s = (t * t - 1.0) / (t * t + 1.0);
    float longitude = (mercator.x - 0.5) * 2.0 * PI - u_projection_origin.x;
    float tilt = u_projection_origin.y;
    float x = c * cos(longitude) * cos(tilt) + s * sin(tilt);
    float y = c * sin(longitude);
    float z = s * cos(tilt) - c * cos(longitude) * sin(tilt);
    float cosine = sqrt(max(1e-12, x * x + y * y));
    float rotatedLongitude = tilt == 0.0 ? longitude : atan(y, x);
    if (tilt != 0.0) rotatedLongitude += 2.0 * PI * floor((u_projection_origin.z * 0.5 * PI - rotatedLongitude) / (2.0 * PI) + 0.5);
    vec2 longitudeDerivatives = vec2(
        (x * c * cos(longitude) + y * c * sin(longitude) * cos(tilt)) / (cosine * cosine),
        (x * -s * sin(longitude) - y * (-s * cos(longitude) * cos(tilt) + c * sin(tilt))) / (cosine * cosine));
    vec2 latitudeDerivatives = vec2(c * sin(longitude) * sin(tilt), c * cos(tilt) + s * cos(longitude) * sin(tilt)) / cosine;
    float theta = asin(0.8660254037844386 * clamp(z, -1.0, 1.0));
    float theta2 = theta * theta;
    float theta6 = theta2 * theta2 * theta2;
    float derivative = 1.340264 - 0.243318 * theta2 + theta6 * (0.006251 + 0.034164 * theta2);
    float secondDerivative = -0.486636 * theta + theta * theta2 * theta2 * (0.037506 + 0.273312 * theta2);
    float thetaLatitude = 0.8660254037844386 * cosine / cos(theta);
    float xLongitude = 1.340264 * cos(theta) / derivative / (2.0 * PI);
    float xLatitude = rotatedLongitude * 1.340264 * (-sin(theta) * derivative - cos(theta) * secondDerivative) / (derivative * derivative) * thetaLatitude / (2.0 * PI);
    float yLatitude = -derivative * thetaLatitude * 0.8660254037844386 * 1.340264 / (2.0 * PI);
    vec2 dx = (xLongitude * longitudeDerivatives + xLatitude * latitudeDerivatives) * vec2(2.0 * PI, -2.0 * PI * c);
    vec2 dy = yLatitude * latitudeDerivatives * vec2(2.0 * PI, -2.0 * PI * c);
    return mat2(mix(1.0, dx.x, u_projection_transition), dy.x * u_projection_transition,
        dx.y * u_projection_transition, mix(1.0, dy.y, u_projection_transition));
}

vec4 projectLineTile(vec2 pos, vec2 extrusion) {
    float magnitude = length(extrusion);
    if (magnitude == 0.0) return projectTile(pos);
    mat2 jacobian = equalEarthJacobian(pos);
    vec2 tangent = jacobian * vec2(extrusion.y, -extrusion.x);
    vec2 projectedExtrusion = normalize(vec2(-tangent.y, tangent.x)) * magnitude;
    vec2 tileExtrusion = inverse(jacobian) * projectedExtrusion;
    v_projection_tile_x = (u_projection_tile_mercator_coords.x - u_projection_origin.w + u_projection_tile_mercator_coords.z * (pos.x + tileExtrusion.x)) * 8192.0;
    vec4 projected = projectPlanarTile(projectTileToPlane(pos) + projectedExtrusion, 0.0);
    v_projection_tile_position = pos + tileExtrusion;
    return projected;
}
