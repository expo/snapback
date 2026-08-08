# Building this Snapback app

<!-- @ref LLP 0187#t4--build-the-out-of-repo-funnel-before-it-is-tested-for-real — every scaffold steers a first-time agent into the build-bound Guide. -->

Before implementing a feature, check the capability index first. With the dev
server running, open
`http://127.0.0.1:4287/_snapback/guide/capabilities.md` (replace the origin if
the startup output selected another port), run `snapback guide <query>`, or
connect the read-only Guide with `snapback mcp`.

The golden path is: edit `snapback/schema.mjs` and
`snapback/functions.mjs` → `bun run generate` → `bun run dev` → exercise the
generated client or `snapback run` → `bun run prove`.

`bun run prove` is **the acceptance command** (`npm run prove` is equivalent).
It runs this starter's registered live profile through `snapback verify` and
writes the LLP 0146 D2 receipt to `.snapback/verify-receipt.json`. The
lower-level `test` and `test:static` scripts are profile/debugging inputs; do
not substitute them for the D2 receipt when claiming the app is ready.

Use the executable carrier kit instead of rebuilding a proof environment:
`npm run carry:headless`. It runs the registered `prove` command and writes
only a director log under `.snapback/carriers/headless/`; the LLP 0146 D2
receipt remains the proof authority. `npm run carry:self-check` validates the
kit without starting a server.

Use `snapback guide` for the served Guide, flat projection, and MCP entry
points. Load the relevant Guide page before using a feature area; do not infer
that a capability is missing until you have checked the capability index.

This app ships the `snapback-authoring` agent skill at
`.claude/skills/snapback-authoring/SKILL.md` (mirrored under `.agents/`,
`.cursor/`, and `.opencode/`); load it before building.
