# Adaptive Equal Earth demo

An experimental MapLibre GL JS build with adaptive Equal Earth, OpenFreeMap Liberty, hillshade, and terrain that rises smoothly after the map transitions to Mercator.

Use **World** for the Equal Earth overview and **Alps · 3D** to fly into the mountains. You can also zoom and move the map normally.

Equal Earth transitions to Mercator at zoom 6-7. Terrain grows from flat to full height at zoom 7-9. This prototype does not implement the proposed configurable projection transition API.

The repository contains a static demo and the compiled MapLibre runtime. The style-spec changes are included in the runtime bundle. No build step, backend, or API key is needed to host it.

## Hosting

For GitHub Pages, publish the root of the `main` branch. For Cloudflare Pages, use no framework, no build command, and `.` as the output directory.

To run locally, serve this directory over HTTP, for example with `python3 -m http.server 8080`, then visit `http://localhost:8080`.

## Updating the demo

Run `npm run build-dist` in the Equal Earth MapLibre GL JS feature checkout, with its sibling style-spec changes linked. Copy `test/examples/display-an-equal-earth-map.html` to `index.html`, change its CSS and module imports to `./dist/maplibre-gl.css` and `./dist/maplibre-gl.mjs`, and copy the four runtime files in `dist/`. Keep `LICENSE.txt` alongside them.

## Credits

- Map rendering: [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js), with experimental Equal Earth changes.
- Map style and vector tiles: [OpenFreeMap](https://openfreemap.org/), using Liberty.
- Elevation tiles: [Mapterhorn](https://mapterhorn.com/).
- Map data attribution is shown in the map controls.

See [LICENSE.txt](LICENSE.txt) for the MapLibre distribution notices.
