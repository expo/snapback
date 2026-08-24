---
title: Start stub — media-feed
id: start.media-feed
order: 6
audience: agent-first
capabilities: []
authorities: [llp/0259-agent-first-read-budget.rfc.md, llp/0300-snapback-is-a-url.rfc.md, llp/0301-url-first-dev-lifecycle.spec.md, llp/0302-declared-dev-client-binding.spec.md, packages/snapback-cli/templates/media-feed/snapback/schema.mjs]
examples: [packages/snapback-cli/templates/media-feed]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-24
reviewed-authorities-digest: sha256:50a482a3bf66cda132be785279830df6706b1111daaa3fd029b82d9524e5cdc5
---

# Start stub: the `media-feed` template

<!-- start-packet:begin media-feed -->
Read [Snapback in one screen](./mental-model.md); with this stub it is the
whole first read.

<!-- script-glossary:begin -->
## Scripts

`prove`: only done-oracle; writes the authoritative `snapback verify` receipt.
`npm test`: acceptance debug path. `test:static`: no-server coherence.
`carry:*`: observations after `prove`; `carry:self-check`: wiring only.
<!-- script-glossary:end -->

Edit `snapback/{schema,functions}.mjs`, `seed.json`, `App.tsx`, and
`pagination.mjs` → `generate` → `dev` (backend + env) and `dev:client` (Metro)
in terminal 2 → `prove`; `dev:supervised` is optional. Android emulator: paste
printed `androidEmulatorUrl` (`10.0.2.2`) as `EXPO_PUBLIC_SNAPBACK_URL`, then
restart Metro. Remove leftover `SNAPBACK_DEV_CLIENT_PORT` /
`SNAPBACK_DEV_BOOTSTRAP_PORT`; plain dev refuses them with
`SNAPBACK_CLI_ARGUMENT_INVALID`. `publishEntry` owns upload/finalize/attach;
paginate on immutable `pageKey`. Escalate: `snapback guide <query>`.
<!-- start-packet:end -->
