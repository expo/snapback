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

- This starter is backend + headless client only — no UI ships. Want a UI
  out of the box? Scaffold `react` or `expo-chat` instead.
- Loop: edit `snapback/schema.mjs` + `snapback/functions.mjs` +
  `snapback/seed.json` → `bun run generate` → `bun run dev` →
  `bun run prove` — the acceptance command (receipt:
  `.snapback/verify-receipt.json`); carrier kit: `npm run carry:headless`.
- Consumer: the headless `SnapbackClient` — `client.query(api.listTodos,
  {})` and `client.mutate(api.createTodo, …)` as `acceptance.mjs` shows.
- Auth: dev mode; flip to `{ auth: { mode: 'sessions' } }` before users or
  uploads.
- `snapback/generated/` is codegen-owned (commit
  `generated/artifacts.json`).
- Escalate one page at a time: `snapback guide <query>`.
<!-- start-packet:end -->
