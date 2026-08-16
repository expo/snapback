# Building this Snapback app

<!-- @ref LLP 0259#1-first-read-contract — the transcluded start packet is the whole required first read; escalate one page at a time, never a linear capability-index read. -->
<!-- start-packet:begin media-feed digest=sha256:92fe4d7d97c203a257eb3747ce3020cf3b8ff1af51382a4ff49b3c1fe645b11a -->
Mental model first: [Snapback in one screen](/_snapback/guide/start/mental-model.md) — that page
plus this stub is the whole first read (LLP 0259 Rung A).

- Loop: edit `snapback/schema.mjs` + `snapback/functions.mjs` +
  `snapback/seed.json` → `bun run generate` → `bun run dev` →
  `bun run prove` — the acceptance command (receipt:
  `.snapback/verify-receipt.json`); carrier kit:
  `npm run carry:native-simulator`.
- Edit targets: those three plus `App.tsx` and `pagination.mjs`;
  `snapback/generated/` is codegen-owned (commit
  `generated/artifacts.json`).
- Consumer: Expo + `useSnapbackQuery`; the `publishEntry` command owns
  upload → finalize → typed `assetRef` attach; sessions custody is
  required for app-side uploads (the supervised loop adopts it).
- Pagination keys on an immutable `pageKey`: the live head is whole-result
  replacement; older pages accumulate in component state, deduplicated by
  `_id`.
- Escalate one page at a time: `snapback guide <query>`.
<!-- start-packet:end -->

## Operate it

`snapback mcp` serves read-only Guide resources; `snapback mcp-control` adds
typed control tools with local admin authority. Preview setup with
`snapback agent setup --print <client> --server mcp-control`. With the dev
server running this packet is served at
`http://127.0.0.1:4287/_snapback/guide/start/media-feed.md` (replace the
origin if startup selected another port); `snapback guide <query>` is the
budgeted lookup channel.

This app ships the `snapback-authoring` agent skill at
`.claude/skills/snapback-authoring/SKILL.md` (mirrored under `.agents/`,
`.cursor/`, and `.opencode/`); it repeats this packet-first contract.
