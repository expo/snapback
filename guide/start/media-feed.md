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

`prove`: only done-oracle; writes the `snapback verify` receipt. `npm test`:
acceptance debug. `test:static`: no-server. `carry:*`: post-proof observations.
<!-- script-glossary:end -->

Edit `snapback/{schema,functions}.mjs`, `seed.json`, `App.tsx`, and
`pagination.mjs` → `generate` → `dev` (backend + env) and `dev:client` (Metro)
in terminal 2 → `prove`; `dev:supervised` is optional. Android emulator: set
printed `androidEmulatorUrl` as `EXPO_PUBLIC_SNAPBACK_URL`; restart Metro.
Plain dev refuses stale `SNAPBACK_DEV_{CLIENT,BOOTSTRAP}_PORT` pins.
`publishEntry` owns upload/finalize/attach. Base64 video or data-URI media is
row data under the 32 KiB ceiling, not an upload. Paginate on immutable
`pageKey`; escalate with `snapback guide <query>`.
<!-- start-packet:end -->
