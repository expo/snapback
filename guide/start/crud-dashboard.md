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
## Scripts

`prove`: only done-oracle; writes the authoritative aggregate `snapback verify`
receipt (acceptance evidence, not formal proof). `npm test`: unwrapped
`acceptance.mjs` debug path. `test:static`: no-server coherence.
`bun run carry:headless`, `bun run carry:web-browser`: observations only after `prove`, never proof.
`carry:self-check`: wiring only.
<!-- script-glossary:end -->

Edit `snapback/{schema,functions}.mjs`, `seed.json`, `src/App.tsx` →
`generate` → `dev` → `prove`; generated files are codegen-owned. The consumer
uses `useSnapbackQuery` / `useSnapbackMutation`. Keep `projectDirectory`'s
team-join uniqueness. Sample data/mutations are public for sign-in-free demos,
not a production auth pattern. Escalate: `snapback guide <query>`.
<!-- start-packet:end -->
