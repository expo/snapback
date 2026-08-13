# Expo → Snapback cap animation

An editable procedural Three.js cap—not a baked turntable. The crown, brim,
stitches, rear opening, closure snaps, camera, timing, and reveal are all built
in `main.js`. The canonical Snapback lockup is used for the final rear frame.

## Run it

```sh
cd brand/cap-animation
bun install
bun run dev
```

Open the local URL Vite prints. Drag to inspect, scrub the timeline, or export
the current model state as a binary glTF (`.glb`).

## Fast adjustments

The `ART_DIRECTION` object near the top of `main.js` controls:

- the opening and rear angles;
- front hold, turn, rear hold, morph, reveal, and return timing;
- cap and studio colors;
- cap scale and camera framing.

Geometry-specific measurements live beside `createCrown`, `createBrim`, and
`createRearIdentity`. The rear reveal intentionally has two layers: the physical
snap pieces move toward the toggle geometry first, then the exact canonical
Snapback artwork fades in for a crisp final lockup.

## Assets

- `assets/concept-front.png` is the generated visual-direction keyframe.
- `assets/concept-rear.png` is the corrected final rear keyframe: one canonical
  toggle mark integrated into the closure, with the wordmark above it.
- `assets/snapback-logo-dark.png` is copied from the repository's canonical
  brand lockup for a self-contained prototype.

The source cap photograph was used as a visual reference only and is not copied
into this folder.
