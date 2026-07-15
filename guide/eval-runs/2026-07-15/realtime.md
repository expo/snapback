# Retrieval eval run — 2026-07-15 — intent 1 (realtime)

**Protocol:** guide/retrieval-eval.md (LLP 0061 §5).
**Fixture:** fresh Claude Fable 5 general-purpose subagent, cold context,
snapback checkout at f2f37e7, instructed only to read AGENTS.md first and
then plan "Add a live-updating list of items to an app built on Snapback"
(planning only, no writes).
**Run:** 10 tool uses total, initial run of the discovery wiring landed the
same day.

## Rubric

- **(a) Loads the relevant guide page(s) within ~15 tool uses: PASS.**
  Reading order: AGENTS.md → `guide/index.md` (tool use 2) →
  `guide/capabilities.md` (3) → `guide/realtime/live-queries.md` (4) →
  `guide/getting-started/your-first-backend.md` (5) →
  `guide/clients/react.md` (6) → demos listing → todo functions →
  `guide/testing/acceptance.md` → todo demo manifest.
- **(b) Plans with the paved technique: PASS.** `defineSchema` +
  `.sync()`, `defineJsLiveQuery` with `reads:`/`authScopeField:` (and the
  declarative twin correctly noted, including ordered-query
  replace-vs-delta per LLP 0008 §DK-3), `client.liveQuery` with
  `transport: 'stream'`, snapshot-on-handle applied immediately, one
  shared `connectionId`, idempotent `ensureApp`, harness + `startServer`
  with provenance for acceptance.
- **(c) Avoids the named anti-patterns: PASS.** Explicitly: "no manual
  re-query, no `setInterval` polling (explicit anti-pattern)"; identity
  "always from `ctx.auth.userId`, never client-asserted"; connection axis
  rendered honestly, "never collapsed to a boolean"; disposal with the
  StrictMode `disposed`-flag guard.

**Verdict: PASS.**

Remaining for the formal Phase 1 exit: intents 2 (ephemeral/cursors) and
3 (auth scoping) per the protocol.

## Agent final report (verbatim)

READING ORDER:
1. /Users/ccheever/projects/snapback/AGENTS.md
2. /Users/ccheever/projects/snapback/guide/index.md
3. /Users/ccheever/projects/snapback/guide/capabilities.md
4. /Users/ccheever/projects/snapback/guide/realtime/live-queries.md
5. /Users/ccheever/projects/snapback/guide/getting-started/your-first-backend.md
6. /Users/ccheever/projects/snapback/guide/clients/react.md
7. (Bash `ls`/`find` over /Users/ccheever/projects/snapback/demos and demos/todo — directory listing, not file reads)
8. /Users/ccheever/projects/snapback/demos/todo/snapback/functions.mjs
9. /Users/ccheever/projects/snapback/guide/testing/acceptance.md
10. /Users/ccheever/projects/snapback/demos/todo/demo.snapback.json

PLAN (abridged to the API-bearing skeleton; full plan retained in the
session transcript):

- Backend `demos/items/snapback/`: `schema.mjs` with
  `defineSchema({ items: defineTable({ text: v.string(), userId: v.string() }).index('by_user', ['userId']).sync() })`;
  `functions.mjs` with
  `listItems = defineJsLiveQuery({ args: {}, source: 'handlers.mjs', exportName: 'listItems', reads: ['items'], authScopeField: 'userId', result: v.object({ text: v.string(), userId: v.string() }) })`
  plus `addItem`/`removeItem` JS mutations; `handlers.mjs` on
  `globalThis.__snapbackHandlers` using `ctx.db` and `ctx.auth.userId`;
  deterministic `seed.json` proving scoping.
- Codegen: `node packages/snapback-codegen/index.mjs demos/items/snapback`,
  commit `generated/`.
- React surface: `new SnapbackClient(baseUrl)`; `client.health()` then
  idempotent `client.ensureApp({ schema, functions, seed })`;
  `client.liveQuery(api.listItems, { connectionId: CONNECTION, transport: 'stream', userId, onUpdate, onConnectionChange })`;
  apply `handle.rows` immediately; dispose in effect cleanup with a
  `disposed` flag; render the `connecting|live|stale|disconnected` axis
  honestly; mutations via `client.mutate(api.addItem, ...)` — "no manual
  re-query, no `setInterval` polling (explicit anti-pattern)".
- Acceptance `tests/acceptance/headless.mjs`: `createSuite` with
  `expectedChecks`, `startServer({ db: ':memory:', provenance: ... })`,
  cross-client delivery via `handle.poll()`, scoping assertion,
  `SNAPBACK_FUNCTION_NOT_LIVE` error-path check, handles disposed in
  `cleanups`.
- Process: `demo.snapback.json`, a new diary landed with the demo,
  `./ref-check --verbose`, corpus audit before landing.
