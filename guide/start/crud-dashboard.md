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
Mental model first: [Snapback in one screen](./mental-model.md) — that page
plus this stub is the whole first read (LLP 0259 Rung A).

- Loop: edit `snapback/schema.mjs` + `snapback/functions.mjs` +
  `snapback/seed.json` → `bun run generate` → `bun run dev` →
  `bun run prove` — the acceptance command (receipt:
  `.snapback/verify-receipt.json`); carrier kit: `npm run carry:web-browser`.
- Edit targets: those three plus `src/App.tsx`; `snapback/generated/` is
  codegen-owned (commit `generated/artifacts.json`).
- Consumer: `useSnapbackQuery` / `useSnapbackMutation` (with a replayable
  `optimistic:` projection) from `@expo/snapback-react`;
  `projectDirectory` is a relational query joining projects to teams —
  keep its joined uniqueness intact.
- Sessions is the schema default; the sample data and mutations stay
  public so the scaffold works without sign-in UI.
- Escalate one page at a time: `snapback guide <query>`.
<!-- start-packet:end -->
