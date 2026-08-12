# Snapback cap reveal

A 3D Expo cap that turns to its adjuster strap, where the snaps close into the
Snapback mark. Built as one self-contained HTML file so it can be served as a
static asset and embedded in the homepage without touching the site bundle.

```bash
node brand/cap/build.mjs      # -> website/public/cap/index.html
```

`cap.template.html` is the source; `build.mjs` inlines the three.js bundle and
the three images. Everything else — cap geometry, cloth shading, the strap, the
morph, and the camera — is generated at runtime from the parameters in `P`.

## URL modes

| Hash | Effect |
| --- | --- |
| *(none)* | Full studio: control rail, timeline scrubber, `Adjust` drawer, exports. |
| `#hero` | Chrome removed, plays once and holds the lockup. What the homepage embeds. |
| `#t=4.3` | Jump to a time in seconds and hold it — for grabbing stills. |
| `#theme=light` \| `#theme=dark` | Force a palette instead of following the viewer. |

`window.snapback` exposes `P`, the materials, lights, groups, `rebuildCap()` and
`seek()` for tuning from the browser console.

## Where the shapes come from

The Snapback mark is built from the exact coordinates in
[`../snapback-mark.svg`](../snapback-mark.svg), and the lockup proportions were
measured off [`../snapback-logo.png`](../snapback-logo.png): the wordmark is as
wide as the mark, 0.709x its height, sitting 0.113x above it.

The cap's proportions, and `assets/cloth-albedo.png`, were taken from
photographs of the actual Expo cap. The cloth tile is a 512px patch of the
bill's twill, divided by its own lighting gradient, notched to drop the
topstitch rows, and wrap-blended seamless; its normal and roughness maps are
derived from its luminance in the browser. The lint is real.

`assets/three.bundle.js` is three.js r180 plus `GLTFExporter`, bundled to an IIFE:

```bash
esbuild entry.js --bundle --format=iife --global-name=THREE --minify
```
