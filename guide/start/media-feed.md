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
Mental model: [Snapback in one screen](./mental-model.md); with this stub it is
the whole first read.

<!-- script-glossary:begin -->
## Scripts

`prove`: only done-oracle; writes the authoritative aggregate `snapback verify`
receipt (acceptance evidence, not formal proof). `npm test`: unwrapped
`acceptance.mjs` debug path. `test:static`: no-server coherence.
`bun run carry:headless`, `bun run carry:web-browser`, `bun run carry:native-simulator`: observations only after `prove`, never proof.
`carry:self-check`: wiring only.
<!-- script-glossary:end -->

Edit `snapback/{schema,functions}.mjs`, `seed.json`, `App.tsx`, and
`pagination.mjs` → `generate` → `dev` → `prove`. `publishEntry` owns
upload/finalize/attach; app uploads require sessions custody. Paginate on
immutable `pageKey`; dedupe accumulated pages by `_id`. Escalate:
`snapback guide <query>`.
<!-- start-packet:end -->
