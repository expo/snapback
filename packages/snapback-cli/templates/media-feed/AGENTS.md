# Building this Snapback app

<!-- @ref LLP 0187#t4--build-the-out-of-repo-funnel-before-it-is-tested-for-real — every scaffold steers a first-time agent into the build-bound Guide. -->

Before implementing a feature, check the capability index first. With the dev
server running, open `http://127.0.0.1:4287/_snapback/guide/capabilities.md`,
run `snapback guide <query>`, or connect the read-only Guide with `snapback mcp`.

The golden path is: edit `snapback/schema.mjs` and
`snapback/functions.mjs` → `bun run generate` → `bun run dev` → exercise the
generated Expo app → `bun run prove`.

`bun run prove` is **the acceptance command** (`npm run prove` is equivalent).
It delegates the registered live profile to `snapback verify` and writes the
LLP 0146 D2 receipt to `.snapback/verify-receipt.json`. `test:static` checks
scaffold coherence without a server; it is not a substitute for that receipt.

Use the executable carrier kits instead of rebuilding proof environments:
`npm run carry:headless`, `npm run carry:web-browser`, or
`npm run carry:native-simulator`. The native command owns simulator boot,
literal dotted-key scheme approval through Python `plistlib`, optional Expo Go
installation (`-- --app-path /path/to/Expo-Go.app` when it is not installed),
first-run onboarding dismissal, deep-link drive, online/offline screenshots,
backend stop, relaunch, and cleanup. Artifacts live under
`.snapback/carriers/`; the kit starts with `prove` and adds no receipt format.
Use `npm run carry:self-check` for a no-server/no-simulator validation.

The publish command owns the complete upload → finalize → typed attach path.
`feedPhotoUpload` strips location metadata, materializes thumbnail and display
renditions, and deliberately chooses public-immutable delivery for a public
feed. `privatePhotoUpload` demonstrates the private-strict alternative; use it
with a separate compatible `assetRef` and sharing policy rather than changing
the delivery semantics of assets already uploaded. Sessions custody is
required for app-side uploads and the supervised Expo loop adopts it
automatically. The first and older pages are public, authority-independent live
queries, so their bounded snapshots are eligible for retained rendering.

Load `snapback guide assets`, `snapback guide live queries`, and
`snapback guide offline retention` before changing those surfaces. This app
ships the `snapback-authoring` agent skill under each supported agent discovery
path; load it before building.
