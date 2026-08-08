# Building this Snapback app

<!-- @ref LLP 0187#t4--build-the-out-of-repo-funnel-before-it-is-tested-for-real — every scaffold steers a first-time agent into the build-bound Guide. -->

Before implementing a feature, check the capability index first. With the dev
server running, open
`http://127.0.0.1:4287/_snapback/guide/capabilities.md` (replace the origin if
the startup output selected another port), run `snapback guide <query>`, or
connect the read-only Guide with `snapback mcp`.

The golden path is: edit `snapback/schema.mjs` and
`snapback/functions.mjs` → `bun run generate` → `bun run dev` (supervises the
Expo client; plain `expo start` also works once a dev server is running) →
exercise the generated client or `snapback run` → `bun run prove`.

`bun run prove` is **the acceptance command** (`npm run prove` is equivalent).
It runs this starter's registered live profile through `snapback verify` and
writes the LLP 0146 D2 receipt to `.snapback/verify-receipt.json`. The
lower-level `test` and `test:static` scripts are profile/debugging inputs; do
not substitute them for the D2 receipt when claiming the app is ready.

Use the executable carrier kits instead of rebuilding proof environments:
`npm run carry:headless`, `npm run carry:web-browser`, or
`npm run carry:native-simulator`. The native command owns simulator boot,
literal dotted-key scheme approval through Python `plistlib`, optional Expo Go
installation (`-- --app-path /path/to/Expo-Go.app` when it is not installed),
first-run onboarding dismissal, deep-link drive, online/offline screenshots,
backend stop, relaunch, and cleanup. Artifacts live under
`.snapback/carriers/`; the kit starts with `prove` and adds no receipt format.
Use `npm run carry:self-check` for a no-server/no-simulator validation.

This starter carries a complete conversation surface end to end: explicit
memberships, direct-message and group inbox rows, reply pointers, reactions,
image `assetRef` delivery, typing presence, and one bound `send` command. The
inbox's **TEST PERSONA** control is deliberately labeled: it changes seeded
app-data identity for acceptance and demos, while a production app must derive
identity from adopted session authority. Edit this working example rather than
composing the wiring from prose. The starter runs in Sessions auth mode
(`auth: { mode: 'sessions' }` in `snapback/schema.mjs`), and the supervised dev
loop mints its session automatically; that is what makes authenticated sends
and in-app image upload work out of the box. The root
`registerExpoFileSystemRqsFiles` registration in `App.tsx` gives retained
offline rendering on native; web uses the browser persistence arm.

Use `snapback guide` for the served Guide, flat projection, and MCP entry
points. Load the relevant Guide page before using a feature area; do not infer
that a capability is missing until you have checked the capability index.

This app ships the `snapback-authoring` agent skill at
`.claude/skills/snapback-authoring/SKILL.md` (mirrored under `.agents/`,
`.cursor/`, and `.opencode/`); load it before building.
