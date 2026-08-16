---
name: snapback-authoring
description: Build an application on Snapback — the scale-to-zero backend with server-authoritative data, live queries, ephemeral realtime, auth, and first-party React/Expo/Swift/headless clients. Use when asked to build an app with Snapback, add a Snapback backend, or modify an app that has a snapback/ directory or @expo/snapback-* dependencies — load before scaffolding, writing schema or functions, wiring clients, uploads, auth, or realtime. Also use when translating a Convex or Supabase design (useQuery, RLS, Storage, Presence, joins) onto Snapback.
---

# snapback-authoring

<!-- @ref LLP 0186#w2--context-injection-surface-owned-here — the published authoring skill this implements; the Rosetta block below is checked against guide/rosetta/records/*.json by scripts/check-rosetta.mjs -->
<!-- @ref LLP 0259#1-first-read-contract — packet-first steering diet: this skill plus one packet or stub is the whole required first read. -->

This skill is a map, not a second guide. The first read is deliberately
small; everything else is one budgeted lookup away.

## First read: the start packet, not the corpus

- **Scaffolded app:** the start packet transcluded into the app's
  `AGENTS.md` is the whole required first read. In a Snapback checkout the
  packets live at `guide/start/` ([index](../../guide/start/index.md));
  with no template selected, read
  [Snapback in one screen](../../guide/start/mental-model.md) (~3 KiB).
  Opening the packet's named edit-target files to work is not extra
  reading.
- **Escalate one page at a time:** one unresolved design question →
  `snapback guide <query>`, then open exactly the page it names. A further
  page only on a trigger: the brief is outside the packet, a structured
  `SNAPBACK_*` refusal, or a failed `prove`. Budgeted `snapback guide`
  lookups (exact symbols, diagnostic codes, section anchors) never count
  as pages.
- **The [capability index](../../guide/capabilities.md) is a registry, not
  a first read.** It lists everything Snapback has, with explicit GAP rows
  for what it doesn't. Grep it in a checkout or use `snapback guide
  <term>`; do not linear-read it before the first edit.
- **Served (no checkout):** `GET /llms.txt` at the server root, packets at
  `GET /_snapback/guide/start/<template>.md`, pages below
  `GET /_snapback/guide`.
- **MCP:** `snapback mcp` is the docs-only resource server (least
  authority — safe to wire anywhere); `snapback mcp-control` adds typed
  control tools with standing local-admin authority. Generate client
  config instead of guessing: `snapback agent setup --print
  claude|codex|cursor`.
- **Exact API symbols:** `snapback guide <ExactSymbolName>` against the
  generated build-bound reference; do not search package source for a
  declaration-exact signature.
- **Undocumented behavior:** read the owning package source, then file a
  `guide-gap` ticket — the reading diet never suppresses the honesty loop.

## The golden path (`snapback-explicit-v1`)

1. **Install and scaffold.** `npm install -g @expo/snapback-cli` (or
   `bun add -g @expo/snapback-cli`), `snapback doctor --json`, then
   `snapback new my-app --template react` (CRUD/admin: `crud-dashboard`;
   media/feed: `media-feed`; messaging: `expo-chat`), `cd my-app`,
   `bun install`.
2. **Schema.** Author `snapback/schema.mjs` with
   `defineSchema`/`defineTable`/`v.*`, chainable `.index(...)` and
   `.sync()`. You write `schema.mjs`, `functions.mjs`, and `seed.json`;
   codegen owns everything under `generated/`.
3. **Codegen.** `snapback generate snapback` (in this repo:
   `node packages/snapback-codegen/index.mjs <app>/snapback`). Commit
   `generated/artifacts.json`; never hand-edit outputs.
4. **Dev loop.** `bun run dev` runs the one supervisor: generate →
   start/attach server → load → client → watch. It infers `dev` vs
   `sessions` mode from the schema.
5. **First query.** Use the generated references with the first-party
   provider and the template's own consumer spelling —
   `useSnapbackQuery`, `useSnapbackQueries`, `useSnapbackMutation`, or a
   `useSurface` handle, exactly as the scaffold already does.
6. **First upload.** Generated upload intents, trusted SHA-256
   finalization, typed `v.assetRef` attachment, under session custody.
   App-side uploads require sessions mode: flip dev-mode schemas to
   `{ auth: { mode: 'sessions' } }` **before** building upload UI
   (`snapback guide assets` for the one named page).

## The done-oracle

`snapback verify` is the CLI-owned readiness composition — run it before
claiming an app works (every scaffold registers it as `bun run prove`):

```sh
snapback runtime-qualify --persist
snapback verify ./snapback --config ./snapback.verify.config.mjs --receipt ./.snapback/verify-receipt.json --json
```

It composes artifact identity, runtime readiness, admission coverage, and
**registered** acceptance profiles into one identity-bound receipt. It is
a *partial* oracle: with no registered profiles the receipt says
`no-registered-acceptance-paths` — that is not a product-completeness
claim; register real profiles (`snapback guide acceptance`).

## Top traps (reconciled 2026-08-15)

1. **Structured stored fields are typed but opaque** (experimental).
   `v.array(inner)` and `v.object({...})` store typed values, but
   interiors are not queryable or indexable, and a nested `v.principal()`
   is a snapshot, not membership. Model queryable state as rows/columns.
2. **Declare function `auth` explicitly in sessions mode.** Omitting it
   gets legacy `optional-user` widening plus the
   `SNAPBACK_AUTH_REQUIREMENT_IMPLICIT` advisory. Scoping is server-side:
   `eq('ownerId', authUserId())` in the function is the boundary — never a
   client-supplied owner argument.
3. **Inline args objects churn query hooks.** Subscriptions key on args
   identity, so an inline object tears down and resubscribes every render
   — hoist or memoize.
4. **A changed seed identity never silently resets data.** Expect
   `SNAPBACK_SEED_MIGRATION_REQUIRED`; choose migration or an explicit
   destructive reset-install.
5. **Headless `liveQuery` defaults to manual-poll transport.** Pass
   `liveQuery({ transport: 'stream' })` for managed WebSocket push.
6. **Strict asset delivery vs plain `<img>` on sessions servers.** A bare
   `<img>` cannot send the strict-delivery header
   (`SNAPBACK_REACT_ASSET_STRICT_DELIVERY_SESSIONS` warns); choose the
   delivery profile deliberately.
7. **Headless generated commands live at `app.commands.*`**, not on the
   `api` export — `createCommandClient(client).start(app.commands.<name>, …)`.
8. **Any authored-source edit rotates function-bundle identity** (even a
   doc comment). Managed `snapback dev` activates a complete valid
   successor automatically; invalid successors refuse.
9. **`snapback dev --expo` supervises but never launches a device or
   simulator** — launching (Expo Go, a dev client, `expo run:ios|android`)
   is the author's job.
10. **Do not inherit `CI=1` into a self-launched Metro/Expo.** A truthy
    `CI` disables file watching, so you serve a stale bundle. Prefer
    `snapback dev --expo`, or unset `CI`.
11. **A non-session (admin/inspection) client on a sessions-mode server
    needs both `authClientProtocol: 1` and `custody: 'anonymous-public'`**
    — each refusal names one half.

When anything refuses, read the code: every `SNAPBACK_*` refusal names the
violated rule and the fix or a guide anchor; `snapback guide <CODE>` is
the exact lookup. The admin console (URL printed by `snapback dev`) shows
Data, Functions, Realtime, Errors, and Logs before you reach for `curl`.

<!-- llp0259:stop-fence -->
**Stop signs.** Familiar `query()` / `useQuery` (the TypeScript
`schema.ts` profile) is an experimental, non-default surface. Writing either without an explicit brief means you left the
golden path — return to the generated references and the template's
`useSnapback*` consumer.
<!-- /llp0259:stop-fence -->

## Coming from Convex or Supabase

Worked, CI-verified translations live in
[coming-from-convex-and-supabase](../../guide/recipes/coming-from-convex-and-supabase.md).
The list below is a compact projection of the canonical journey records
(`guide/rosetta/records/*.json`); `scripts/check-rosetta.mjs` fails if it
drifts from them.

<!-- llp0259:stop-fence -->
<!-- rosetta:begin -->
- `protected-live-crud` — **Protected live CRUD, end to end** (Convex useQuery, Supabase RLS): [guide/recipes/coming-from-convex-and-supabase.md#protected-live-crud](../../guide/recipes/coming-from-convex-and-supabase.md#protected-live-crud)
- `expo-media-upload` — **Upload and attach an Expo image under session custody** (Supabase Storage, Convex generateUploadUrl): [guide/recipes/coming-from-convex-and-supabase.md#expo-media-upload](../../guide/recipes/coming-from-convex-and-supabase.md#expo-media-upload)
- `relational-queries` — **Reading related data without hand-writing the wrong join** (Convex joins, Supabase joins): [guide/recipes/coming-from-convex-and-supabase.md#relational-queries](../../guide/recipes/coming-from-convex-and-supabase.md#relational-queries)
- `ephemeral-presence` — **Typing indicators and cursors: presence vs. broadcast** (Supabase Presence, Supabase Broadcast): [guide/recipes/coming-from-convex-and-supabase.md#ephemeral-presence](../../guide/recipes/coming-from-convex-and-supabase.md#ephemeral-presence)
- `reactive-queries` — **Reactive queries: useQuery vs. declare-then-subscribe** (Convex useQuery): [guide/recipes/coming-from-convex-and-supabase.md#reactive-queries](../../guide/recipes/coming-from-convex-and-supabase.md#reactive-queries)
<!-- rosetta:end -->
<!-- /llp0259:stop-fence -->

Each journey states where the translation is *not* equivalent; capability
gaps are named as GAP rows, not papered over.

## While you build

- Keep the loop tight: edit → regenerate → acceptance → inspect; `bun run
  prove` is done.
- In this repository, record the build experience in a `diaries/` entry
  and file guide gaps as `issues/` tickets with `guide-gap` in the title
  (see `AGENTS.md`); outside it, skip this bullet.
