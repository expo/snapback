# A1 sweep: the React arm has no offline surface (freshness, retention, outbox invisible to hooks)

**Status:** Resolved
**Opened:** 2026-08-01
**Resolved:** 2026-08-01
**Systems:** Client integration, Sync
**Related:** LLP 0137 (A1 arm), LLP 0114, LLP 0129, demos/improvement-sweep/arms/a1-snapback-web/findings/0137-a1-f5-react-arm-no-offline-surface.json

`@expo/snapback-react` 0.1.7 exposes rows, status, and the connection axis,
but none of the offline facts the headless client carries: no per-query
`freshness` ('retained' vs 'current'), no `retention` fact, no outbox/queued
state. A React field notebook cannot render the documented honest freshness
state or a queued-changes badge from the first-party arm; the A1 shell wires
its freshness chip to connection status with a finding comment. Firebase
exposes `SnapshotMetadata.fromCache` per snapshot; InstantDB hooks are
offline-first natively (frozen Diary 0027).

Fix shape: project freshness/retention onto the query-hook result and add an
outbox hook (queued count + replay state) over the existing client facts,
with a packaged-closure cold-boot-offline hook test.

## Resolution (2026-08-01, 0137 between-arms fix lane)

Projection only — no new claims, all facts already existed on the headless
client:

- **Query hooks** (`packages/snapback-react/index.mjs`): every query
  snapshot now carries `freshness: 'unknown' | 'retained' | 'current'` and
  `retention` (the handle's refuse-with-clarity fact, surfaced verbatim).
  A retained (persisted) delivery publishes `status: 'refreshing'` — never
  `'ready'`, even on a live connection — without advancing the
  authoritative revision, so optimistic installs over a retained-only frame
  still refuse (`SNAPBACK_REACT_OPTIMISTIC_STORE_MISSING`) and layer
  retirement can never key on a retained frame. Authority blanking resets
  both facts.
- **Outbox**: `useSnapbackOutbox()` + `observeSnapbackOutbox()` project the
  client's own `outboxStatus()` counts (`supported/pending/failed/
  replaying`) with a `replay()` action over `replayQueuedMutations()`. The
  client gained the projection seam (`outboxStatus()`, `subscribeOutbox()`
  notified on every recorded outbox transition and around each drain) in
  `packages/snapback-client/index.mjs`. A client without the seam refuses
  (`SNAPBACK_REACT_OUTBOX_UNSUPPORTED`) instead of claiming an empty queue.
- **Declarations**: `LiveQueryRetention`, `freshness`/`retention`/
  `pendingIntentsAtSeed` on `LiveQueryHandle`, and `OutboxStatus` +
  methods in `packages/snapback-client/index.d.mts`; `SnapbackFreshness`,
  `SnapbackRetention`, per-variant `QueryState` facts, and the outbox
  hook/observer types in `packages/snapback-react/index.d.mts`.
  `bun run check:export-types` green (65 subpaths, runtime parity ok).
- **Tests**: `packages/snapback-react/offline.test.mjs` (cold-offline-boot
  retained render, retained-never-ready on a live socket, retention-fact
  projection, outbox hook counts/transitions/replay, capability refusal) —
  verified to fail on the pre-fix code; wired into the package test script.
  Client seam covered in `packages/snapback-client/outbox-store.test.mjs`.
  Full client + react suites green.
- **Guide**: `guide/clients/react.md` ("Bind a generated query" facts +
  new "Render offline facts honestly" section with a transcluded snippet)
  and the `clients.react` capability row.

The finding's freshness-chip-wired-to-connection workaround in the A1 shell
is obsolete: `useSnapbackQuery(...).freshness` is now the honest source.
