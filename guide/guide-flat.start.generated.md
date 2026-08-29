<!-- Generated start section flat projection by scripts/generate-guide-manifest.mjs. Never hand-edit. -->

---

<!-- snapback-guide-source: guide/start/index.md -->
---
title: Start packets
id: start.index
order: 1
audience: agent-first
capabilities: []
authorities: [llp/0259-agent-first-read-budget.rfc.md]
examples: []
status: current
targets: [all]
maturity: shipped
authoring-profiles: [explicit, familiar]
reviewed: 2026-08-29
reviewed-authorities-digest: sha256:bd97fffef93eb1f0ec657dc31bc3f48b358897c55b65120859abd274d06ddbaa
---

# Start packets

The budgeted first read for building an app on Snapback (LLP 0259 Rung A):
read your template's packet — or the shared mental model plus its stub —
open the packet's named edit targets, and escalate one page at a time with
`snapback guide <query>`.

- [Snapback in one screen](./mental-model.md) — the shared mental model
  (about 3 KiB); the fallback when no template is selected.
- [react](./react.md) — full packet: Vite web starter,
  `useSnapbackQueries`.
<!-- llp0259:stop-fence -->
- [familiar-react](./familiar-react.md) — full packet: Familiar TypeScript
  backend plus `useQuery` / `useMutation` in Vite.
<!-- /llp0259:stop-fence -->
- [expo-chat](./expo-chat.md) — full packet: Expo sessions-mode chat,
  `useSnapbackQuery` + `useSurface`.
- [crud-dashboard](./crud-dashboard.md) — stub: mental model first, then
  this template's proof command and edit targets.
- [media-feed](./media-feed.md) — stub: mental model first.
- [todo-contract](./todo-contract.md) — stub: mental model first.

If you arrived after a **mistaken unscoped `snapback@0.1.29` lookup**, the
published CLI package is `@expo/snapback-cli`; `create-snapback-app` is the
`npm create snapback-app` wrapper. If the **published CLI rejected unknown `expo-router` template**,
or you **assumed legacy `expo-router` major 7 for Expo 57**, do not repair the tuple by registry archaeology: run the installed
CLI's `snapback new --help`, choose one of the six template names above, and
let the scaffold write the aligned `@expo/snapback-*`, Expo, Metro, React, and
React Native pins. Package discovery is profile-neutral; choose
`familiar-react` when the application should begin in the Familiar profile.

Scaffolded apps carry their packet transcluded into `AGENTS.md` with a
digest comment — reading either copy counts once. The
[capability index](../capabilities.md) is the completeness registry with
explicit GAP rows: look terms up in it; do not linear-read it before the
first edit.

## From the chat template to a social product

If you searched for a **short, product-shaped path from that chat to the canonical social schema**:
there is no maintained end-to-end relational-social recipe today. Take this journey instead — profiles →
[app identity](../auth/app-identity-binding.md), graph →
[relational queries](../backend/relational-queries.md), feeds →
[chunked membership feeds](../recipes/chunked-semijoin-feed.md), roles →
[scoped roles](../auth/scoped-roles.md), media →
[assets](../backend/assets.md), offline →
[retention and replay](../sync/offline-and-retention.md), aggregates and
schedules → [bounded queries](../backend/queries.md) plus
[cron](../backend/cron.md).

The `expo-chat` template is Explicit, and Familiar is not covered by this
template. For Familiar, start at the
[Familiar handler dialect](../backend/familiar-profile.md) and keep the same
normalized data and authority boundaries in Familiar source.

---

<!-- snapback-guide-source: guide/start/mental-model.md -->
---
title: Snapback in one screen
id: start.mental-model
order: 2
audience: agent-first
capabilities: []
authorities: [llp/0259-agent-first-read-budget.rfc.md]
examples: []
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:bd97fffef93eb1f0ec657dc31bc3f48b358897c55b65120859abd274d06ddbaa
---

# Snapback in one screen

The shared mental model for building an app on Snapback. If the app came
from `snapback new`, read the template's [start packet](./index.md) instead
— it names the exact files and proof command; this page is the fallback
when no template is selected.

- **You write three files.** `snapback/schema.mjs`
  (`defineSchema`/`defineTable`/`v.*`, chainable `.index(...)` and
  `.sync()`), `snapback/functions.mjs` (named queries, live queries, and
  mutation plans), and `snapback/seed.json`. Codegen owns everything under
  `snapback/generated/`: regenerate, commit `generated/artifacts.json`,
  never hand-edit outputs.
- **The server is the security boundary.** Scope inside the function
  (`eq('ownerId', authUserId())`), never with a client-supplied owner
  argument.
- **A live query is a named, generated subscription.** Clients bind the
  generated reference; there is no ad-hoc query language on the wire.
- **Presence is ephemeral.** Typing indicators and cursors ride ephemeral
  state, not tables.
- **Sessions mode is for users and uploads.** `{ auth: { mode: 'sessions' } }`
  in the schema; app-side uploads require it, and each function's `auth`
  should then be declared explicitly.
- **The loop.** Edit → `bun run generate` → `bun run dev` →
  `bun run prove`. A green verify receipt is "done"; anything else is a
  claim. Here, “prove” means acceptance evidence, not formal proof. Before
  extending or ejecting its runner, read
  `node_modules/@expo/snapback-acceptance/README.md`, the compatibility and
  ownership contract.
- **When something refuses,** read the `SNAPBACK_*` code, then run
  `snapback guide <CODE>` for the exact rule and fix.

## Escalate one page at a time

1. Start from the template packet (or this page) and open the packet's
   named edit-target files to work.
2. One unresolved design question → `snapback guide <query>`; open exactly
   the page it names.
3. A further page only on a trigger: the brief is outside the packet, a
   structured `SNAPBACK_*` refusal, or a failed `prove`.

Budgeted `snapback guide` lookups never count as extra pages. The
[capability index](../capabilities.md) is the completeness registry with
explicit GAP rows: grep it or look terms up before assuming a feature is
missing — do not linear-read it.

<!-- llp0259:stop-fence -->
**Stop signs.** Familiar `query()` / `useQuery` (the TypeScript `schema.ts`
profile) is an experimental, non-default surface. If
you are writing either without an explicit brief, return to the generated
references and the `useSnapback*` hooks.
<!-- /llp0259:stop-fence -->

---

<!-- snapback-guide-source: guide/start/familiar-react.md -->
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

---

<!-- snapback-guide-source: guide/start/react.md -->
---
title: Start packet — react
id: start.react
order: 3
audience: agent-first
capabilities: []
authorities: [llp/0259-agent-first-read-budget.rfc.md, llp/0300-snapback-is-a-url.rfc.md, llp/0301-url-first-dev-lifecycle.spec.md, llp/0302-declared-dev-client-binding.spec.md, packages/snapback-cli/templates/react/snapback/schema.mjs, packages/snapback-cli/templates/react/src/App.tsx]
examples: [packages/snapback-cli/templates/react]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-24
reviewed-authorities-digest: sha256:9e2e713ea922a413fa77477b0bdefa8c205cc9b8e812528bd719eb71f58ab386
---

# Start packet: the `react` template

<!-- start-packet:begin react -->
This packet is the whole required first read for this app (LLP 0259
Rung A). Open the edit targets below and work; open one further Guide page
only via `snapback guide <query>` or on a trigger — the brief is outside
this packet, a structured `SNAPBACK_*` refusal, or a failed `prove`.

## The loop

Edit `snapback/schema.mjs` / `snapback/functions.mjs` / `snapback/seed.json`
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

- `snapback/schema.mjs` — `defineSchema`/`defineTable`/`v.*` with
  `.index(...)`/`.sync()`; authoring profile `snapback-explicit-v1`.
- `snapback/functions.mjs` — `defineLiveQuery` and `defineMutation` plans;
  `listTodos` and `createTodo` ship as working examples to copy.
- `snapback/seed.json` — the versioned seed fixture.
- `src/App.tsx` — the consumer: a hoisted `useSnapbackQueries` entries map
  plus `useSnapbackMutation`, `useSnapbackConnection`,
  `useSnapbackCurrentPrincipal`, and `useSnapbackAuth` from
  `@expo/snapback-react`. The password form is the ordinary anonymous-ready
  entry, sign-in, current-principal, and sign-out example.
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
profile) is an experimental, non-default surface — not
this template's path. Writing either without an explicit brief means you
left the golden path.
<!-- /llp0259:stop-fence -->
<!-- start-packet:end -->

---

<!-- snapback-guide-source: guide/start/expo-chat.md -->
---
title: Start packet — expo-chat
id: start.expo-chat
order: 4
audience: agent-first
capabilities: []
authorities: [llp/0109-versioned-seed-evolution.spec.md, llp/0114-first-class-react-and-query-groups.spec.md, llp/0259-agent-first-read-budget.rfc.md, llp/0297-client-canonicalization-budgets.research.md, llp/0299-supervised-listener-port-plan.spec.md, llp/0300-snapback-is-a-url.rfc.md, llp/0301-url-first-dev-lifecycle.spec.md, llp/0302-declared-dev-client-binding.spec.md, packages/snapback-client/canonical-client-value.mjs, packages/snapback-codegen/index.mjs, packages/snapback-cli/index.mjs, packages/snapback-cli/templates/expo-chat/snapback/schema.mjs, packages/snapback-cli/templates/expo-chat/App.tsx, packages/snapback-cli/templates/expo-chat/acceptance.mjs]
examples: [packages/snapback-cli/templates/expo-chat]
status: current
targets: [all]
maturity: shipped
authoring-profiles: [explicit]
reviewed: 2026-08-28
reviewed-authorities-digest: sha256:e69e107f77dade868bc324f906e1ae27c099ad2c9308570185961e2a742cc22b
---

# Start packet: the `expo-chat` template

<!-- start-packet:begin expo-chat -->
First read (LLP 0259 Rung A): use edit targets. Brief, `SNAPBACK_*` refusal,
or failed `prove` → open one `snapback guide <query>` result.

## The loop

Edit `snapback/schema.mjs` / `snapback/functions.mjs` / `snapback/seed.json`
→ `bun run generate` → `bun run dev` (backend + `.env.local`) plus
`bun run dev:client` separately → `bun run prove`.
`dev:supervised` is optional; it never launches a device or simulator — use
Expo Go, a dev client, or `expo run:ios|android`.

**Metro's inner port escaped 4287–4387:** use one `--port-range <lo>-<hi>`
that contains every owned listener, shared by Explicit and Familiar backends.

**Supervised Expo web wants stdin detached or the owner dies on pipe EOF:**
stdin EOF now closes only the optional command channel and leaves the
supervisor and its children live; launchers may use `/dev/null`.

Android emulator: set `androidEmulatorUrl` (`10.0.2.2`) as
`EXPO_PUBLIC_SNAPBACK_URL`, restart Metro, keep its managed-block line
commented. Remove stale client/bootstrap port variables; plain dev refuses
them with `SNAPBACK_CLI_ARGUMENT_INVALID`.

Proof: read `node_modules/@expo/snapback-acceptance/README.md`.

<!-- script-glossary:begin -->
## Script glossary

`prove`: done-oracle; writes the aggregate `snapback verify` receipt. `npm
test`: raw acceptance debug. `test:static`: no-server coherence. `carry:*`:
post-`prove` observations; `carry:self-check`: wiring only. Removed `test:live`
→ `npm test`.
<!-- script-glossary:end -->

Carrier owns simulator/screenshots. Do not pass `CI=1` to
Metro; it disables watching.

## Edit targets (listed, not charged)

- Backend: `snapback/{schema.mjs,functions.mjs,seed.json}`.
- Client: `App.tsx`, `src/screens/{inbox-screen,chat-screen}.tsx`.
- Proof: `acceptance.mjs`, `snapback.verify.config.mjs`.

`snapback/generated/` is codegen-owned: regenerate and commit
`generated/artifacts.json`; never hand-edit. The `_generated/` spelling is a
refused alias.

## Posture

- **Auth: sessions, guest-first, password, Apple/Google.** Web starts sessionless;
  native auto-adopts; `adoptSupervisedSession` flips either default. After
  `signUpWithPassword` / `signInWithPassword`, do not call an
  authenticated mutation in the same tick. Wait until the provider's
  authenticated dispatcher exists. Do not mount a profile editor that can save
  until `getMine` (or equivalent) has a row. Keep `HANDLE_TAKEN` / refuse UI
  outside a tree that unmounts on auth change.
- **Custody: `volatile-explicit`.** Native restart is anonymous.
  `durable-required` needs an admitted platform. Node `memory` refuses
  `durable-required` custody with `SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE`.
  See the [`expo-web` + `fake-indexeddb` acceptance helper — Recover when durable auth custody is unavailable](../testing/acceptance.md#recover-when-durable-auth-custody-is-unavailable).
- **Security:** **TEST PERSONA** `senderId`/`userId` is not a boundary. Real apps
  derive the sender from `ctx.auth.userId`; personas are display-only.

## Safety traps (reconciled at landing)

1. In sessions mode, declare each function's `auth`; omission gets legacy
   `optional-user` plus `SNAPBACK_AUTH_REQUIREMENT_IMPLICIT`.
2. Inline args objects churn `useSnapbackQuery` — the subscription keys on
   args identity; hoist or memoize.
3. `app.api.queries`: 4,096-node `CanonicalClientValueV1` ceiling.
   `snapback generate` warns; Expo boot can refuse with
   `SNAPBACK_REACT_ARGS_INVALID`. Do not export unused table queries; replace
   `*Before` variants with an optional `before` argument.
4. Structured interiors are not queryable; a nested principal is a snapshot,
   not membership. Base64/data-URI media is row data: 32 KiB value ceiling;
   use asset/media upload. See
   [Structured stored values](../getting-started/your-first-backend.md#structured-stored-values).
5. Changed seed identity — exact fresh reset and what it preserves:
   `snapback reset --dev-fresh --db
   "$PWD/.snapback/dev.sqlite3"`. It refuses custom, shared, or
   symlink-ambiguous paths and preserves source, generated artifacts, and
   unregistered `.snapback` files. Never raw-wipe the database.
6. A `SNAPBACK_*` refusal names its rule/fix; `snapback guide <CODE>` routes it.

## Escalate

`snapback guide <query>` finds symbols, codes, and anchors; the
[capability index](../capabilities.md) is lookup-only. Trigger pages:
[clients](../clients/react-expo.md), [surfaces](../clients/surfaces.md),
[auth](../auth/sessions-and-principals.md), [assets](../backend/assets.md),
[ephemeral state](../realtime/ephemeral-state.md).

> **If you searched for a “short, product-shaped path from that chat to the canonical social schema”:** see
> [From the chat template to a social product](./index.md#from-the-chat-template-to-a-social-product).

<!-- llp0259:stop-fence -->
**Stop sign.** Familiar `query()` / `useQuery` is experimental and outside
this template. If selected, read the
[Familiar handler dialect](../backend/familiar-profile.md).
<!-- /llp0259:stop-fence -->
<!-- start-packet:end -->

---

<!-- snapback-guide-source: guide/start/crud-dashboard.md -->
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

---

<!-- snapback-guide-source: guide/start/media-feed.md -->
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

---

<!-- snapback-guide-source: guide/start/todo-contract.md -->
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
## Scripts

`prove`: only done-oracle; writes the authoritative aggregate `snapback verify`
receipt (acceptance evidence, not formal proof). `npm test`: unwrapped
`acceptance.mjs` debug path. `test:static`: no-server coherence.
`bun run carry:headless`: observations only after `prove`, never proof.
`carry:self-check`: wiring only.
<!-- script-glossary:end -->

Backend + headless. Edit `snapback/{schema,functions}.mjs` and `seed.json`
→ `generate` → `dev` → `prove`; generated files are codegen-owned.
`SnapbackClient` is the consumer; no UI ships. Auth starts in dev mode: switch
to `{ auth: { mode: 'sessions' } }` before users/uploads. Escalate:
`snapback guide <query>`.
<!-- start-packet:end -->
