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
  claim.
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
authorities: [llp/0259-agent-first-read-budget.rfc.md, packages/snapback-cli/templates/react/snapback/schema.mjs, packages/snapback-cli/templates/react/src/App.tsx]
examples: [packages/snapback-cli/templates/react]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:bb51fb7bff16d6c94335925cb0522657982e212144f54e5be6a224438bc6f82e
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
authorities: [llp/0259-agent-first-read-budget.rfc.md, packages/snapback-cli/templates/expo-chat/snapback/schema.mjs, packages/snapback-cli/templates/expo-chat/App.tsx]
examples: [packages/snapback-cli/templates/expo-chat]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:e07d541390899cfe56369a926f42311454acea946eea744cd20f36c8ec25de65
---

# Start packet: the `expo-chat` template

<!-- start-packet:begin expo-chat -->
This packet is the whole required first read for this app (LLP 0259
Rung A). Open the edit targets below and work; open one further Guide page
only via `snapback guide <query>` or on a trigger — the brief is outside
this packet, a structured `SNAPBACK_*` refusal, or a failed `prove`.

## The loop

Edit `snapback/schema.mjs` / `snapback/functions.mjs` / `snapback/seed.json`
→ `bun run generate` → `bun run dev` (supervises the Expo client; it never
launches a device or simulator — Expo Go, a dev client, or
`expo run:ios|android` is your job) → `bun run prove`.

`bun run prove` (`npm run prove` is equivalent) is the acceptance command:
it runs the registered live profile through `snapback verify` and writes
the receipt to `.snapback/verify-receipt.json`. Done = green receipt.
Carrier kits: `npm run carry:headless`, `npm run carry:web-browser`,
`npm run carry:native-simulator` (owns simulator boot, deep-link drive, and
screenshots); `npm run carry:self-check` validates without a server. If you
launch Metro yourself, do not inherit `CI=1` — a truthy `CI` disables file
watching and serves a stale bundle; prefer `bun run dev`.

## Edit targets (work files — listed, not charged to the first read)

- `snapback/schema.mjs` — sessions mode with guest, password, and email-code
  entry (`defineAuth` + `{ auth: { mode: 'sessions' } }`), tables for users,
  conversations, memberships, messages, reactions; ephemeral `typing`.
- `snapback/functions.mjs` — inbox and thread live queries, `sendText` /
  `sendReply` / `react` mutations, and the bound `send` command.
- `snapback/seed.json` — seeded demo personas and conversations.
- `App.tsx` — boot: `SnapbackExpoProvider` with the generated `app`
  descriptor; `registerExpoFileSystemRqsFiles` at the root gives retained
  offline rendering on native (web uses the browser persistence arm).
  `useSnapbackCurrentPrincipal` and `useSnapbackAuth` provide the ordinary
  password signup/sign-in/current-principal/sign-out journey.
- `src/screens/inbox-screen.tsx` / `src/screens/chat-screen.tsx` — the
  consumers: `useSnapbackQuery` for inbox rows; one `useSurface` handle
  drives the thread (live reads, replies, reactions, typing presence,
  image upload) from `@expo/snapback-expo`.
- `acceptance.mjs` + `snapback.verify.config.mjs` — the registered proof.

`snapback/generated/` is codegen-owned: regenerate, commit
`generated/artifacts.json`, never hand-edit outputs.

## Posture

- **Auth: sessions mode, guest-first plus ordinary password entry.** The
  generated application descriptor opts into the first-party auth path and
  reaches anonymous `ready` before entry. Recovery codes surface once after
  password signup. The supervised dev loop may also provide a guest session
  for authenticated sends and in-app image upload.
- **Custody: `volatile-explicit`.** Native durable custody is still pending
  Phase 2, so this disposable chat template says memory custody explicitly;
  it does not claim durable native custody or silently weaken a durable
  policy. Move to `durable-required` only after the native platform row ships.
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

`snapback guide <query>` returns exact symbols, diagnostic codes, and page
anchors — budgeted lookups do not count as extra pages. The
[capability index](../capabilities.md) is the completeness registry: look
up, do not linear-read. Deeper pages, only when triggered:
[react-expo clients](../clients/react-expo.md),
[surfaces](../clients/surfaces.md),
[sessions and principals](../auth/sessions-and-principals.md),
[assets](../backend/assets.md),
[ephemeral state](../realtime/ephemeral-state.md).

<!-- llp0259:stop-fence -->
**Stop signs.** Familiar `query()` / `useQuery` (the TypeScript `schema.ts`
profile) is an experimental, non-default surface — not
this template's path. Writing either without an explicit brief means you
left the golden path.
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

---

<!-- snapback-guide-source: guide/start/media-feed.md -->
---
title: Start stub — media-feed
id: start.media-feed
order: 6
audience: agent-first
capabilities: []
authorities: [llp/0259-agent-first-read-budget.rfc.md, packages/snapback-cli/templates/media-feed/snapback/schema.mjs]
examples: [packages/snapback-cli/templates/media-feed]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:f805ed361a34d8e055b4cf2e28c744733ae6c5c2162736f9c4bc3ddb23da9dde
---

# Start stub: the `media-feed` template

<!-- start-packet:begin media-feed -->
Mental model first: [Snapback in one screen](./mental-model.md) — that page
plus this stub is the whole first read (LLP 0259 Rung A).

- Loop: edit `snapback/schema.mjs` + `snapback/functions.mjs` +
  `snapback/seed.json` → `bun run generate` → `bun run dev` →
  `bun run prove` — the acceptance command (receipt:
  `.snapback/verify-receipt.json`); carrier kit:
  `npm run carry:native-simulator`.
- Edit targets: those three plus `App.tsx` and `pagination.mjs`;
  `snapback/generated/` is codegen-owned (commit
  `generated/artifacts.json`).
- Consumer: Expo + `useSnapbackQuery`; the `publishEntry` command owns
  upload → finalize → typed `assetRef` attach; sessions custody is
  required for app-side uploads (the supervised loop adopts it).
- Pagination keys on an immutable `pageKey`: the live head is whole-result
  replacement; older pages accumulate in component state, deduplicated by
  `_id`.
- Escalate one page at a time: `snapback guide <query>`.
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
