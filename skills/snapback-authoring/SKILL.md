---
name: snapback-authoring
description: Build an application on Snapback — the scale-to-zero backend with server-authoritative data, live queries, ephemeral realtime, auth, and first-party React/Expo/Swift/headless clients. Use when asked to build an app with Snapback, add a Snapback backend, or modify an app that has a snapback/ directory or @expo/snapback-* dependencies — load before scaffolding, writing schema or functions, wiring clients, uploads, auth, or realtime. Also use when translating a Convex or Supabase design (useQuery, RLS, Storage, Presence, joins) onto Snapback.
---

# snapback-authoring

<!-- @ref LLP 0186#w2--context-injection-surface-owned-here — the published authoring skill this implements; the Rosetta block below is checked against guide/rosetta/records/*.json by scripts/check-rosetta.mjs -->

This skill is a map, not a second guide. It front-loads the golden path, the
traps that cost past builder agents the most loops, the done-oracle, and where
the real documentation lives. Every section points into the Snapback Guide —
follow the links for depth instead of composing from memory.

## Load the guide first

- **In a Snapback checkout:** read `guide/index.md`, then the
  [capability index](../../guide/capabilities.md) **before designing anything**
  — it lists everything Snapback has, with explicit GAP rows for what it
  doesn't, so you never build around a feature you didn't know existed and
  never assume one that is a named gap.
- **Against a running server (no checkout):** the same build-bound corpus is
  served at `GET /_snapback/guide` (manifest), individual pages below that
  prefix, `GET /llms.txt` (index, capability index first), and
  `GET /_snapback/guide/flat.md` (large single-request fallback).
- **MCP:** `snapback mcp` is the docs-only resource server (least authority —
  safe to wire anywhere); `snapback mcp-control` adds typed control tools with
  standing local-admin authority. Generate client config instead of guessing:
  `snapback agent setup --print claude|codex|cursor` (see `guide/index.md`,
  "Choose the MCP authority").

## The golden path

Details: [your first backend](../../guide/getting-started/your-first-backend.md)
and [the authoring loop](../../guide/getting-started/the-authoring-loop.md).
Local target; hosted targets make deliberately weaker claims
([auth/targets](../../guide/auth/targets.md)).

1. **Install and scaffold.** The `snapback` command ships in
   `@expo/snapback-cli`. Check the toolchain, then scaffold:
   `snapback doctor --json`, then `snapback new my-app --template react`,
   `cd my-app`, `bun install`.
2. **Schema.** Author `snapback/schema.mjs` with
   `defineSchema`/`defineTable`/`v.*`, chainable `.index(...)` and `.sync()`.
   You write `schema.mjs`, `functions.mjs`, and `seed.json`; codegen owns
   everything under `generated/`.
3. **Codegen.** `snapback generate snapback` (in this repo:
   `node packages/snapback-codegen/index.mjs <app>/snapback`). Commit
   `generated/artifacts.json` (the review manifest), never hand-edit outputs.
4. **Dev loop.** `bun run dev` runs the one supervisor
   (`snapback dev snapback --client . --client-command vite`): generate →
   start/attach server → load → client → watch. It infers `dev` vs `sessions`
   mode from the schema.
5. **First query.** Use the generated exact references with the first-party
   provider and `useSnapbackQuery` / `useSnapbackMutation`
   ([React client](../../guide/clients/react.md); Expo:
   [react-expo](../../guide/clients/react-expo.md), headless:
   [headless](../../guide/clients/headless.md)).
6. **First upload.** Generated upload intents, trusted SHA-256 finalization,
   typed `v.assetRef` attachment, under ordinary session custody — the Expo
   ImagePicker-to-Blob recipe is in [assets](../../guide/backend/assets.md).

## The done-oracle

`snapback verify` is the CLI-owned readiness composition — run it before
claiming an app works:

```sh
snapback runtime-qualify --persist
snapback verify ./snapback --config ./snapback.verify.config.mjs --receipt ./.snapback/verify-receipt.json --json
```

It composes generated-artifact identity, runtime readiness, schema/function
admission plus D1 coverage, target capabilities, and **registered** acceptance
profiles into one identity-bound receipt. It is a *partial* oracle: with no
registered profiles a fresh app can pass platform checks while the receipt
says `no-registered-acceptance-paths` — that is not a product-completeness
claim. Register real acceptance profiles with the headless-first discipline in
[acceptance testing](../../guide/testing/acceptance.md); the receipt contract
is in [verify](../../guide/testing/verify.md).

## Top traps (verified against main, 2026-08-07)

1. **No `v.array()` on table fields.** Stored arrays/unions are a named GAP
   (`backend.structured-stored-fields`, design-only). Use `v.json()` for
   array-shaped fields; the generate-time refusal names the fix.
2. **Declare function `auth` explicitly in sessions mode.** Omitting it gets
   the legacy `optional-user` widening plus the
   `SNAPBACK_AUTH_REQUIREMENT_IMPLICIT` advisory. Scoping is server-side:
   `eq('ownerId', authUserId())` in the function is the security boundary —
   never a client-supplied owner argument
   ([sessions and principals](../../guide/auth/sessions-and-principals.md)).
3. **Inline args objects churn `useSnapbackQuery`.** The descriptor memo keys
   on `args` identity, so `useSnapbackQuery(ref, { label })` tears down and
   re-establishes its subscription every render. Correct but wasteful —
   memoize or hoist the args object
   (`issues/20260806-usesnapbackquery-inline-args-resubscribe.md`).
4. **A changed `seedVersion` never silently resets data.** Restarts and watch
   reloads require the exact installed seed identity; a change reports
   `SNAPBACK_SEED_MIGRATION_REQUIRED` until you choose migration or an
   explicit destructive reset-install
   ([the authoring loop](../../guide/getting-started/the-authoring-loop.md)).
5. **Headless `liveQuery` defaults to manual-poll transport.** Pass
   `liveQuery({ transport: 'stream' })` for managed WebSocket push
   ([headless client](../../guide/clients/headless.md)).
6. **Strict asset delivery vs plain `<img>` on sessions servers.**
   `useSnapbackAssetImage.src` uses the strict-delivery URL unless the asset's
   delivery profile is `public-immutable`; a bare `<img>` cannot send the
   required protocol header, so the image renders empty. Choose the delivery
   profile deliberately ([assets](../../guide/backend/assets.md);
   `issues/20260806-asset-image-src-strict-url-sessions.md`).
7. **A doc-comment-only edit rotates function-bundle identity.** There is no
   successor migration yet, so it can cost a manual local-store rollover —
   batch comment churn with real edits
   (`issues/20260805-doc-comment-artifact-mismatch-no-successor-migration.md`).

When anything refuses, read the code before searching: every `SNAPBACK_*`
refusal an authoring agent can trigger is required to name the violated rule
and either the fix or a guide anchor
([diagnostics](../../guide/operating/diagnostics.md)). The shipped
[admin console](../../guide/operating/admin-console.md) (URL printed by
`snapback dev`) shows Data, Functions, Realtime, Errors, and Logs before you
reach for `curl`.

## Coming from Convex or Supabase

Worked, CI-verified translations live in
[coming-from-convex-and-supabase](../../guide/recipes/coming-from-convex-and-supabase.md).
The list below is a compact projection of the canonical journey records
(`guide/rosetta/records/*.json`); `scripts/check-rosetta.mjs` fails if it
drifts from them.

<!-- rosetta:begin -->
- `protected-live-crud` — **Protected live CRUD, end to end** (Convex useQuery, Supabase RLS): [guide/recipes/coming-from-convex-and-supabase.md#protected-live-crud](../../guide/recipes/coming-from-convex-and-supabase.md#protected-live-crud)
- `expo-media-upload` — **Upload and attach an Expo image under session custody** (Supabase Storage, Convex generateUploadUrl): [guide/recipes/coming-from-convex-and-supabase.md#expo-media-upload](../../guide/recipes/coming-from-convex-and-supabase.md#expo-media-upload)
- `relational-queries` — **Reading related data without hand-writing the wrong join** (Convex joins, Supabase joins): [guide/recipes/coming-from-convex-and-supabase.md#relational-queries](../../guide/recipes/coming-from-convex-and-supabase.md#relational-queries)
- `ephemeral-presence` — **Typing indicators and cursors: presence vs. broadcast** (Supabase Presence, Supabase Broadcast): [guide/recipes/coming-from-convex-and-supabase.md#ephemeral-presence](../../guide/recipes/coming-from-convex-and-supabase.md#ephemeral-presence)
- `reactive-queries` — **Reactive queries: useQuery vs. declare-then-subscribe** (Convex useQuery): [guide/recipes/coming-from-convex-and-supabase.md#reactive-queries](../../guide/recipes/coming-from-convex-and-supabase.md#reactive-queries)
<!-- rosetta:end -->

Each journey states where the translation is *not* equivalent instead of
forcing one; capability gaps are named as GAP rows, not papered over.

## While you build

- Keep the loop tight: edit → regenerate → acceptance → inspect
  ([the authoring loop](../../guide/getting-started/the-authoring-loop.md)).
- In this repository, record the build experience in a `diaries/` entry and
  file guide gaps as `issues/` tickets with `guide-gap` in the title (see
  `AGENTS.md`); outside it, skip this bullet.
