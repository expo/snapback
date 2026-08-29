---
title: Start packet — familiar-react
id: start.familiar-react
order: 3
audience: agent-first
capabilities: []
authorities: [llp/0252-convex-familiar-authoring-profile.rfc.md, llp/0253-familiar-profile-v1-api.spec.md, llp/0259-agent-first-read-budget.rfc.md, llp/0300-snapback-is-a-url.rfc.md, llp/0301-url-first-dev-lifecycle.spec.md, llp/0302-declared-dev-client-binding.spec.md, packages/snapback-cli/templates/familiar-react/snapback/schema.ts, packages/snapback-cli/templates/familiar-react/snapback/todos.ts, packages/snapback-cli/templates/familiar-react/src/App.tsx]
examples: [packages/snapback-cli/templates/familiar-react]
status: current
targets: [all]
maturity: shipped
authoring-profiles: [familiar]
reviewed: 2026-08-29
reviewed-authorities-digest: sha256:7c7cec8fdb76717e5a2d8a8409a8efa726e9b81282f1552baff0cf6bdbff0c44
---

# Start packet: the `familiar-react` template

<!-- start-packet:begin familiar-react -->
This packet is the first read (LLP 0259
Rung A). Open the edit targets below and work; open one further Guide page
only via `snapback guide <query>` or on a trigger — the brief is outside
this packet, a structured `SNAPBACK_*` refusal, or a failed `prove`.

## The loop

Edit `snapback/schema.ts` / `snapback/todos.ts` / `snapback/seed.json`
→ `bun run generate` → `bun run dev` (backend; writes `.env.local`) plus
`bun run dev:client` in a second terminal (Vite) → `bun run prove`.

Expo templates retain optional `dev:supervised`. Android emulator: paste
printed `androidEmulatorUrl` (`10.0.2.2`) as `EXPO_PUBLIC_SNAPBACK_URL`, then
restart Metro. Remove leftover `SNAPBACK_DEV_CLIENT_PORT` /
`SNAPBACK_DEV_BOOTSTRAP_PORT`; plain dev refuses them with
`SNAPBACK_CLI_ARGUMENT_INVALID`.

`bun run prove` (`npm run prove` is equivalent) is the acceptance command:
it runs the registered live profile through `snapback verify` and writes
the receipt to `.snapback/verify-receipt.json`. Done = green receipt.
Before extending or ejecting that runner, read
`node_modules/@expo/snapback-acceptance/README.md`; it is the supported
compatibility and ownership contract.

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

## Edit targets (work files — listed, not charged to the first read)

- `snapback/schema.ts` — generated-server `defineSchema` / `defineTable` /
  `defineAuth` / `v.*`; authoring profile `snapback-familiar-ts-v1`.
- `snapback/todos.ts` — Familiar `query` / `mutation` handlers; its exports
  generate `api.todos.list` and `api.todos.create` references.
- `snapback/contracts.ts` — reusable validators outside a function module.
- `snapback/seed.json` — the versioned seed fixture.
- `src/App.tsx` — the consumer: `useQuery`, `useMutation`, `useAuth`, and
  `useCurrentPrincipal` from `@expo/snapback-react/familiar`. The password
  form is the ordinary anonymous-ready entry, sign-in, principal, and sign-out
  example.
- `src/main.tsx` — boot: generated `app` + supervised Vite app binding →
  `createSnapbackAppClient` → `<SnapbackProvider appClient={...}>`. Leave it
  alone unless boot itself is the task.
- `acceptance.mjs` + `snapback.verify.config.mjs` — the registered proof.

`snapback/generated/` is codegen-owned: regenerate, commit
`generated/artifacts.json`, never hand-edit outputs.

## Posture

- **Auth: sessions mode, password entry, durable browser custody.** The
  generated application descriptor opts into the first-party auth path;
  IndexedDB plus Web Locks is required, with no memory fallback. Recovery
  codes surface once after signup. The todo example remains public so the
  provider reaches anonymous `ready` before entry.
- Declare each function's `auth` explicitly and scope private data
  server-side (`eq('ownerId', authUserId())`) — never trust a client-supplied
  owner argument.
- **Uploads: none wired here.** Flip to sessions first, then
  `snapback guide assets` for the one named page.

## Safety traps (reconciled at landing)

1. Query args bind by identity: an inline args object resubscribes every render
   — hoist it to module scope or use `useMemo` (`src/App.tsx` shows the pattern).
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
profile) is this template's explicit path. Adding Explicit
`schema.mjs` / `functions.mjs`, using the canonical multi-state hooks by
accident, or mixing profiles means you left this template's golden path.
<!-- /llp0259:stop-fence -->
<!-- start-packet:end -->
