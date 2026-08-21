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
## Script glossary

`bun run prove`: ordinary completion and the only done-oracle—the authoritative
aggregate `snapback verify` receipt (acceptance evidence, not formal proof).
`npm test`: raw acceptance implementation that `prove` wraps (debugging).
`bun run test:static`: no-server source/generated coherence.
`bun run carry:headless`, `bun run carry:web-browser`, `bun run carry:native-simulator`: observation artifacts after accepting the `prove` receipt,
never proof authority. `bun run carry:self-check` checks carrier wiring only.
Migration: `test:live` was removed; use `npm test` for the same raw acceptance command.
<!-- script-glossary:end -->

Edit `snapback/{schema,functions}.mjs`, `seed.json`, `App.tsx`, and
`pagination.mjs` → `generate` → `dev` → `prove`. `publishEntry` owns
upload/finalize/attach. Escalate with `snapback guide <query>`.
<!-- start-packet:end -->
