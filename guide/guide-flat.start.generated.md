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
reviewed: 2026-08-15
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
- [expo-chat](./expo-chat.md) — full packet: Expo sessions-mode chat,
  `useSnapbackQuery` + `useSurface`.
- [crud-dashboard](./crud-dashboard.md) — stub: mental model first, then
  this template's proof command and edit targets.
- [media-feed](./media-feed.md) — stub: mental model first.
- [todo-contract](./todo-contract.md) — stub: mental model first.

Scaffolded apps carry their packet transcluded into `AGENTS.md` with a
digest comment — reading either copy counts once. The
[capability index](../capabilities.md) is the completeness registry with
explicit GAP rows: look terms up in it; do not linear-read it before the
first edit.

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
authorities: [llp/0259-agent-first-read-budget.rfc.md, llp/0299-supervised-listener-port-plan.spec.md, llp/0300-snapback-is-a-url.rfc.md, llp/0301-url-first-dev-lifecycle.spec.md, llp/0302-declared-dev-client-binding.spec.md, packages/snapback-cli/templates/expo-chat/snapback/schema.mjs, packages/snapback-cli/templates/expo-chat/App.tsx, packages/snapback-cli/templates/expo-chat/acceptance.mjs]
examples: [packages/snapback-cli/templates/expo-chat]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-25
reviewed-authorities-digest: sha256:560723c3d50af032b129a79451faf7bf891f34dc3de8504df6f7f09a4a568a4f
---

# Start packet: the `expo-chat` template

<!-- start-packet:begin expo-chat -->
This is the whole first read (LLP 0259 Rung A). Work from the edit targets;
open one more page only for a brief, `SNAPBACK_*` refusal, or failed `prove`,
via `snapback guide <query>`.

## The loop

Edit `snapback/schema.mjs` / `snapback/functions.mjs` / `snapback/seed.json`
→ `bun run generate` → `bun run dev` (backend + `.env.local`) and
`bun run dev:client` in a second terminal (`dev:supervised` = optional
one-command convenience; it never
launches a device or simulator — Expo Go, a dev client, or
`expo run:ios|android` is your job) → `bun run prove`.

Android emulator: paste printed `androidEmulatorUrl` (`10.0.2.2`) as
`EXPO_PUBLIC_SNAPBACK_URL`, then restart Metro; leave its managed-block line
commented. Remove leftover `SNAPBACK_DEV_CLIENT_PORT` /
`SNAPBACK_DEV_BOOTSTRAP_PORT`; plain dev refuses them with
`SNAPBACK_CLI_ARGUMENT_INVALID`.

Before changing proof, read `node_modules/@expo/snapback-acceptance/README.md`.

<!-- script-glossary:begin -->
## Script glossary

`prove`: only done-oracle; writes the authoritative aggregate `snapback verify`
receipt. `npm test`: raw acceptance debug path. `test:static`: no-server
coherence. `carry:headless`, `carry:web-browser`, `carry:native-simulator`:
observations after `prove`; `carry:self-check`: wiring only. Removed
`test:live` → `npm test`.
<!-- script-glossary:end -->

The native carrier owns simulator boot, drive, and screenshots. Self-started
Metro must not inherit `CI=1` (it disables watching).

## Edit targets (work files — listed, not charged to the first read)

- `snapback/schema.mjs` — sessions auth; user/conversation/membership/message/
  reaction tables; ephemeral `typing`.
- `snapback/functions.mjs` — inbox and thread live queries, `sendText` /
  `sendReply` / `react` mutations, and the bound `send` command.
- `snapback/seed.json` — seeded demo personas and conversations.
- `App.tsx` — generated `app` → `SnapbackExpoProvider`; native retained files;
  password entry via `useSnapbackCurrentPrincipal` / `useSnapbackAuth`.
- `src/screens/inbox-screen.tsx` / `src/screens/chat-screen.tsx` — the
  `useSnapbackQuery` inbox and `useSurface` thread (replies, reactions,
  typing, upload) from `@expo/snapback-expo`.
- `acceptance.mjs` + `snapback.verify.config.mjs` — the registered proof.

`snapback/generated/` is codegen-owned: regenerate, commit
`generated/artifacts.json`, never hand-edit outputs.
The `_generated/` spelling is a refused alias; use only `generated/`.

## Posture

- **Auth: sessions mode, guest-first plus ordinary password entry.** The
  app reaches anonymous `ready`; call `auth.enterAsGuest()` on the same
  `useSnapbackAuth()` owner before sends or image upload, or use ordinary
  password entry. Recovery codes surface once after signup or guest claim.
  URL-first dev mints no ambient session; multi-browser proofs sign up or sign
  in separately in each context instead of adopting the supervised mint.
- **Custody: `volatile-explicit`.** Native restart returns anonymous.
  Durable auth custody failures are platform-specific; follow the
  [acceptance remediation](../testing/acceptance.md#recover-when-durable-auth-custody-is-unavailable)
  for the exact diagnostic and repair.
- **Security caveat — client-supplied `senderId` is a demo convenience,
  never a boundary.** The seeded **TEST PERSONA** control passes the active
  persona's id as `senderId`/`userId` so demos work. In a real app, derive
  the sender from the adopted session on the server (`ctx.auth.userId`),
  drop the argument, and keep personas display-only.

## Safety traps (reconciled at landing)

1. Declare each function's `auth` explicitly in sessions mode: omitting it
   gets legacy `optional-user` widening plus the
   `SNAPBACK_AUTH_REQUIREMENT_IMPLICIT` advisory.
2. Inline args objects churn `useSnapbackQuery` — the subscription keys on
   args identity; hoist or memoize.
3. Structured stored fields (`v.array(...)`, `v.object({...})`) are typed
   but opaque (experimental): interiors are not queryable, and a nested
   `v.principal()` is a snapshot, not membership.
4. A changed seed identity never silently resets data: expect
   `SNAPBACK_SEED_MIGRATION_REQUIRED`, then migrate or reset-install.
5. Every `SNAPBACK_*` refusal names its rule and fix: read it, then run
   `snapback guide <CODE>` for the exact entry.

## Escalate

`snapback guide <query>` returns exact symbols, codes, and anchors. Use the
[capability index](../capabilities.md) as a lookup, not a first read. On trigger:
[react-expo clients](../clients/react-expo.md),
[surfaces](../clients/surfaces.md),
[sessions and principals](../auth/sessions-and-principals.md),
[assets](../backend/assets.md),
[ephemeral state](../realtime/ephemeral-state.md).

<!-- llp0259:stop-fence -->
**Stop sign.** Familiar `query()` / `useQuery` is experimental, non-default,
and outside this template. If a brief selects it, read the
[Familiar handler dialect](../backend/familiar-profile.md) before editing.
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

`prove`: only done-oracle; writes the authoritative `snapback verify` receipt.
`npm test`: acceptance debug path. `test:static`: no-server coherence.
`carry:*`: observations after `prove`; `carry:self-check`: wiring only.
<!-- script-glossary:end -->

Edit `snapback/{schema,functions}.mjs`, `seed.json`, `App.tsx`, and
`pagination.mjs` → `generate` → `dev` (backend + env) and `dev:client` (Metro)
in terminal 2 → `prove`; `dev:supervised` is optional. Android emulator: paste
printed `androidEmulatorUrl` (`10.0.2.2`) as `EXPO_PUBLIC_SNAPBACK_URL`, then
restart Metro. Remove leftover `SNAPBACK_DEV_CLIENT_PORT` /
`SNAPBACK_DEV_BOOTSTRAP_PORT`; plain dev refuses them with
`SNAPBACK_CLI_ARGUMENT_INVALID`. `publishEntry` owns upload/finalize/attach;
paginate on immutable `pageKey`. Escalate: `snapback guide <query>`.
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
