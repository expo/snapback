# Building this Snapback app

<!-- @ref LLP 0187#t4--build-the-out-of-repo-funnel-before-it-is-tested-for-real — every scaffold steers a first-time agent into the build-bound Guide. -->

Before implementing a feature, check the capability index first. With the dev
server running, open `http://127.0.0.1:4287/_snapback/guide/capabilities.md`,
run `snapback guide <query>`, or connect the read-only Guide with `snapback mcp`.

The golden path is: edit `snapback/schema.mjs` and
`snapback/functions.mjs` → `bun run generate` → `bun run dev` → exercise the
generated client → `bun run prove`.

`bun run prove` is **the acceptance command** (`npm run prove` is equivalent).
It delegates the registered live profile to `snapback verify` and writes the
LLP 0146 D2 receipt to `.snapback/verify-receipt.json`. `test:static` checks
scaffold coherence without a server; it is not a substitute for that receipt.

This starter's project directory is deliberately a relational query: projects
join teams through a uniquely indexed slug. Its detail is a separate live
query, and edits install a replayable optimistic projection over the directory.
Keep the explicit source/output visibility and joined uniqueness intact when
adapting it. Sessions is the schema default; the sample dataset and mutations
are public only so a new web scaffold works without app-specific sign-in UI.

Use `snapback guide relational`, `snapback guide live queries`, and
`snapback guide optimistic` before changing those surfaces. This app ships the
`snapback-authoring` agent skill under each supported agent discovery path;
load it before building.
