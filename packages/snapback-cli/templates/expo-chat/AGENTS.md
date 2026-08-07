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
exercise the generated client or `snapback run` → `bun run test`.

This starter carries the conversation surface end to end: a `messages` table
with an image `assetRef` field, the `messageImageUpload` intent, live queries,
the `conversation` surface (reads + bound mutations + the `send` command +
typing presence), and an Expo chat screen driving all of it through
`useSurface`. Edit this working example rather than composing the wiring from
prose.

Use `snapback guide` for the served Guide, flat projection, and MCP entry
points. Load the relevant Guide page before using a feature area; do not infer
that a capability is missing until you have checked the capability index.
