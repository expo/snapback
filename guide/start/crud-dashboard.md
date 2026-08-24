---
title: Start stub — crud-dashboard
id: start.crud-dashboard
order: 5
audience: agent-first
capabilities: []
authorities: [llp/0259-agent-first-read-budget.rfc.md, llp/0300-snapback-is-a-url.rfc.md, llp/0301-url-first-dev-lifecycle.spec.md, llp/0302-declared-dev-client-binding.spec.md, packages/snapback-cli/templates/crud-dashboard/snapback/schema.mjs]
examples: [packages/snapback-cli/templates/crud-dashboard]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-24
reviewed-authorities-digest: sha256:fec37765ca46bdda9d4e8e1e59d2d88ba3af242da2629f088332fc38da5e13af
---

# Start stub: the `crud-dashboard` template

<!-- start-packet:begin crud-dashboard -->
Read [Snapback in one screen](./mental-model.md); with this stub it is the
whole first read.

<!-- script-glossary:begin -->
## Scripts

`prove`: only done-oracle; writes the authoritative `snapback verify` receipt.
`npm test`: acceptance debug path. `test:static`: no-server coherence.
`carry:*`: observations after `prove`; `carry:self-check`: wiring only.
<!-- script-glossary:end -->

Edit `snapback/{schema,functions}.mjs`, `seed.json`, `src/App.tsx` →
`generate` → `dev` (backend + env) and `dev:client` (Vite) in terminal 2 →
`prove`. Expo has optional `dev:supervised`; Android emulators manually paste
printed `androidEmulatorUrl` (`10.0.2.2`) and restart Metro. Remove leftover
`SNAPBACK_DEV_CLIENT_PORT` / `SNAPBACK_DEV_BOOTSTRAP_PORT`; plain dev refuses
them with `SNAPBACK_CLI_ARGUMENT_INVALID`. Generated files are owned. Keep
`projectDirectory` team-join uniqueness; demo-public mutations are not a
production auth pattern. Escalate: `snapback guide <query>`.
<!-- start-packet:end -->
