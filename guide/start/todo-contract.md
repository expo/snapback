---
title: Start stub — todo-contract
id: start.todo-contract
order: 7
audience: agent-first
capabilities: []
authorities: [llp/0259-agent-first-read-budget.rfc.md, packages/snapback-cli/templates/todo-contract/snapback/schema.mjs]
examples: [packages/snapback-cli/templates/todo-contract]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:775cff52172764ba61fe9e51b068f63a7dd4afc72372ce48f546116b67e8ceba
---

# Start stub: the `todo-contract` template

<!-- start-packet:begin todo-contract -->
Mental model first: [Snapback in one screen](./mental-model.md) — that page
plus this stub is the whole first read (LLP 0259 Rung A).

<!-- script-glossary:begin -->
## Script glossary

`bun run prove`: ordinary completion and the only done-oracle—the authoritative
aggregate `snapback verify` receipt (acceptance evidence, not formal proof).
`npm test`: raw acceptance implementation that `prove` wraps (debugging).
`bun run test:static`: no-server source/generated coherence.
`bun run carry:headless`: observation artifacts after accepting the `prove` receipt,
never proof authority. `bun run carry:self-check` checks carrier wiring only.
Migration: `test:live` was removed; use `npm test` for the same raw acceptance command.
<!-- script-glossary:end -->

Backend + headless. Edit `snapback/{schema,functions}.mjs` and `seed.json`
→ `generate` → `dev` → `prove`; generated files are codegen-owned.
`SnapbackClient` is the consumer. Escalate with `snapback guide <query>`.
<!-- start-packet:end -->
