---
title: Start packet — react
id: start.react
order: 3
audience: agent-first
capabilities: []
authorities: [llp/0259-agent-first-read-budget.rfc.md, packages/snapback-cli/templates/react/snapback/schema.mjs, packages/snapback-cli/templates/react/src/App.tsx]
examples: [packages/snapback-cli/templates/react]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:8eec1a04daa7a5512264a00d40cf195b4eeb4653d3319607cf4d0abef7a1d85d
---

# Start packet: the `react` template

<!-- start-packet:begin react -->
This packet is the whole required first read for this app (LLP 0259
Rung A). Open the edit targets below and work; open one further Guide page
only via `snapback guide <query>` or on a trigger — the brief is outside
this packet, a structured `SNAPBACK_*` refusal, or a failed `prove`.

## The loop

Edit `snapback/schema.mjs` / `snapback/functions.mjs` / `snapback/seed.json`
→ `bun run generate` → `bun run dev` (one supervisor: managed server plus
Vite; it prints the admin console URL) → `bun run prove`.

`bun run prove` (`npm run prove` is equivalent) is the acceptance command:
it runs the registered live profile through `snapback verify` and writes
the receipt to `.snapback/verify-receipt.json`. Done = green receipt.
Carrier kits when you need a driven environment: `npm run carry:headless`,
`npm run carry:web-browser`; `npm run carry:self-check` validates without a
server.

## Edit targets (work files — listed, not charged to the first read)

- `snapback/schema.mjs` — `defineSchema`/`defineTable`/`v.*` with
  `.index(...)`/`.sync()`; authoring profile `snapback-explicit-v1`.
- `snapback/functions.mjs` — `defineLiveQuery` and `defineMutation` plans;
  `listTodos` and `createTodo` ship as working examples to copy.
- `snapback/seed.json` — the versioned seed fixture.
- `src/App.tsx` — the consumer: a hoisted `useSnapbackQueries` entries map
  plus `useSnapbackMutation` and `useSnapbackConnection` from
  `@expo/snapback-react`.
- `src/main.tsx` — boot: `SnapbackClient` → `prepareReactBinding` →
  `createSnapbackReactProvider` → `<SnapbackProvider>`. Leave it alone
  unless boot itself is the task.
- `acceptance.mjs` + `snapback.verify.config.mjs` — the registered proof.

`snapback/generated/` is codegen-owned: regenerate, commit
`generated/artifacts.json`, never hand-edit outputs.

## Posture

- **Auth: dev mode** (no `auth` block in the schema). Users or app-side
  uploads need sessions: add `{ auth: { mode: 'sessions' } }` **before**
  building that UI, declare each function's `auth` explicitly, and scope
  server-side (`eq('ownerId', authUserId())`) — never a client-supplied
  owner argument.
- **Uploads: none wired here.** Flip to sessions first, then
  `snapback guide assets` for the one named page.

## Safety traps (reconciled at landing)

1. Query args bind by identity: an inline entries map or args object
   resubscribes every render — hoist to module scope or `useMemo`
   (`src/App.tsx` shows the pattern).
2. A changed seed identity never silently resets data: expect
   `SNAPBACK_SEED_MIGRATION_REQUIRED`, then choose migration or an explicit
   reset-install.
3. Structured stored fields (`v.array(...)`, `v.object({...})`) are typed
   but opaque (experimental): interiors are not queryable or indexable, and
   a nested `v.principal()` is a snapshot, not membership. Model queryable
   state as rows and columns.
4. Every `SNAPBACK_*` refusal names its rule and fix: read it, then run
   `snapback guide <CODE>` for the exact entry.

## Escalate

`snapback guide <query>` returns exact symbols, diagnostic codes, and page
anchors — budgeted lookups do not count as extra pages. The
[capability index](../capabilities.md) is the completeness registry: look
up, do not linear-read. Deeper pages, only when triggered:
[your first backend](../getting-started/your-first-backend.md),
[the React client](../clients/react.md),
[queries](../backend/queries.md), [mutations](../backend/mutations.md).

<!-- llp0259:stop-fence -->
**Stop signs.** Familiar `query()` / `useQuery` (the TypeScript `schema.ts`
profile) and tiny-data `db.*` are experimental, non-default surfaces — not
this template's path. Writing either without an explicit brief means you
left the golden path.
<!-- /llp0259:stop-fence -->
<!-- start-packet:end -->
