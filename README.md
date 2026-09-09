# Adaptive Equal Earth demo

<img width="1612" height="763" alt="Screenshot 2026-09-09 at 21 50 20" src="https://github.com/user-attachments/assets/e99e8e26-98b9-44a4-97f0-9de84e387d49" />


[Open the live demo](https://maplibre-gl-js-equal-earth.pages.dev/)

An experimental MapLibre GL JS build with adaptive Equal Earth, OpenFreeMap Liberty, hillshade, and terrain that rises smoothly after the map transitions to Mercator.

Use **World** for the Equal Earth overview and **Alps · 3D** to fly into the mountains. You can also zoom and move the map normally.

Equal Earth transitions to Mercator at zoom 6-7. Terrain grows from flat to full height at zoom 7-9. This prototype does not implement the proposed configurable projection transition API.

The repository contains the full MapLibre GL JS and style-spec source snapshots with the Equal Earth changes, plus the static demo and compiled runtime. The existing demo can be hosted without a build step, backend, or API key.

## Source and feature diff

- [MapLibre GL JS source](maplibre-gl-js/), including projection code, shaders, tests, and render fixtures.
- [Style-spec source](maplibre-style-spec/), including the Equal Earth documentation and validation tests.
- [Review the Equal Earth changes](https://github.com/birkskyum/maplibre-gl-js-equal-earth/compare/6e0ad2d990e3857f2a742b5957b2611f79f061d5...main).

The upstream source snapshots were imported in a separate baseline commit, followed by the feature changes. [source-info.json](source-info.json) records the original upstream commits. Each source directory retains its own license.

## Build from source

Use Node.js 26, as specified by the GL JS checkout. Run these commands from the repository root to build style-spec and link it into GL JS:

```sh
cd maplibre-style-spec
npm ci
npm run build
cd ../maplibre-gl-js
npm ci
rm -rf node_modules/@maplibre/maplibre-gl-style-spec
ln -s ../../../maplibre-style-spec node_modules/@maplibre/maplibre-gl-style-spec
npm run codegen
npm run build-dist
```

The removal above replaces the installed registry package with the sibling source checkout. The resulting runtime files are in `maplibre-gl-js/dist/`.

After building, run the GL JS render suite from `maplibre-gl-js/` with:

```sh
RENDER_TEST_CONCURRENCY=12 npm run test-render -- --run
```

## Hosting

The live demo is hosted on Cloudflare Pages. This GitHub repository stays private. Deployments use Direct Upload, so pushing a commit alone does not update the site.

After signing in with `npx wrangler login`, deploy with:

```sh
node deploy.mjs
```

The script uploads the demo HTML, compiled runtime, license, and build metadata. It stages those files in a temporary directory and removes it afterward.

To run locally, serve this directory over HTTP, for example with `python3 -m http.server 8080`, then visit `http://localhost:8080`.

## Updating the demo

Build the sources as described above. Copy `maplibre-gl-js/test/examples/display-an-equal-earth-map.html` to the root `index.html`, change its CSS and module imports to `./dist/maplibre-gl.css` and `./dist/maplibre-gl.mjs`, and copy `maplibre-gl.css`, `maplibre-gl.mjs`, `maplibre-gl-shared.mjs`, and `maplibre-gl-worker.mjs` from `maplibre-gl-js/dist/` to the root `dist/`. Keep `LICENSE.txt` alongside them.

## Credits

- Map rendering: [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js), with experimental Equal Earth changes.
- Map style and vector tiles: [OpenFreeMap](https://openfreemap.org/), using Liberty.
- Elevation tiles: [Mapterhorn](https://mapterhorn.com/).
- Map data attribution is shown in the map controls.

See [LICENSE.txt](LICENSE.txt) for the MapLibre distribution notices.
