---
title: Start stub — media-feed
id: start.media-feed
order: 6
audience: agent-first
capabilities: []
authorities: [llp/0259-agent-first-read-budget.rfc.md, packages/snapback-cli/templates/media-feed/snapback/schema.mjs]
examples: [packages/snapback-cli/templates/media-feed]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:f805ed361a34d8e055b4cf2e28c744733ae6c5c2162736f9c4bc3ddb23da9dde
---

# Start stub: the `media-feed` template

<!-- start-packet:begin media-feed -->
Mental model first: [Snapback in one screen](./mental-model.md) — that page
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
