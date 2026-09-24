layout(location = 0) in vec2 a_pos;

void main() {
    #ifdef EQUAL_EARTH
    gl_Position = projectTileMask(a_pos);
    #else
    gl_Position = projectTile(a_pos);
    #endif
}
