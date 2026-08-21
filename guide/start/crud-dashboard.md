---
title: Start stub — crud-dashboard
id: start.crud-dashboard
order: 5
audience: agent-first
capabilities: []
authorities: [llp/0259-agent-first-read-budget.rfc.md, packages/snapback-cli/templates/crud-dashboard/snapback/schema.mjs]
examples: [packages/snapback-cli/templates/crud-dashboard]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:b1f8201cab1348a01e401a2f12412ee36b6412cc13d389d089b33b61e5bbe396
---

# Start stub: the `crud-dashboard` template

<!-- start-packet:begin crud-dashboard -->
Mental model: [Snapback in one screen](./mental-model.md); with this stub it is
the whole first read.

<!-- script-glossary:begin -->
## Script glossary

`bun run prove`: ordinary completion and the only done-oracle—the authoritative
aggregate `snapback verify` receipt (acceptance evidence, not formal proof).
`npm test`: raw acceptance implementation that `prove` wraps (debugging).
`bun run test:static`: no-server source/generated coherence.
`bun run carry:headless`, `bun run carry:web-browser`: observation artifacts after accepting the `prove` receipt,
never proof authority. `bun run carry:self-check` checks carrier wiring only.
Migration: `test:live` was removed; use `npm test` for the same raw acceptance command.
<!-- script-glossary:end -->

Edit `snapback/{schema,functions}.mjs`, `seed.json`, `src/App.tsx` →
`generate` → `dev` → `prove`; generated files are codegen-owned. The consumer
uses `useSnapbackQuery` / `useSnapbackMutation`. Escalate with
`snapback guide <query>`.
<!-- start-packet:end -->
