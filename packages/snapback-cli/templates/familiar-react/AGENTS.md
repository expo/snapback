# Building this Snapback app

<!-- @ref LLP 0259#1-first-read-contract — the transcluded start packet is the whole required first read; escalate one page at a time, never a linear capability-index read. -->
<!-- start-packet:begin familiar-react digest=sha256:5a73631effa3749b742ef6c5633443bd77b2f7d4d97a813b31ad25d6d15f8adf -->
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
[capability index](/_snapback/guide/capabilities.md) is the completeness registry: look
up, do not linear-read. Deeper pages, only when triggered:
[your first backend](/_snapback/guide/getting-started/your-first-backend.md),
[the React client](/_snapback/guide/clients/react.md),
[queries](/_snapback/guide/backend/queries.md), [mutations](/_snapback/guide/backend/mutations.md).

<!-- llp0259:stop-fence -->
**Stop signs.** Familiar `query()` / `useQuery` (the TypeScript `schema.ts`
profile) is this template's explicit path. Adding Explicit
`schema.mjs` / `functions.mjs`, using the canonical multi-state hooks by
accident, or mixing profiles means you left this template's golden path.
<!-- /llp0259:stop-fence -->
<!-- start-packet:end -->

## Operate it

`snapback mcp` serves read-only Guide resources; `snapback mcp-control` adds
typed control tools with local admin authority. Preview setup with
`snapback agent setup --print <client> --server mcp-control`. With the dev
server running this packet is served at
`http://127.0.0.1:4287/_snapback/guide/start/familiar-react.md` (replace the
origin if startup selected another port); `snapback guide <query>` is the
budgeted lookup channel.

This app ships the `snapback-authoring` agent skill at
`.claude/skills/snapback-authoring/SKILL.md` (mirrored under `.agents/`,
`.cursor/`, and `.opencode/`); it repeats this packet-first contract.
