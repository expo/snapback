# snapback2 client TS per-event serialize/sort/clone overhead

**Status:** Closed
**Priority:** P3 (batch; profile before fixing)
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `query-items.ts:97`; `offline.ts:273`; `metadata.ts:18`, `:74`; `client-observed.ts:63`, `:57`; `client-outbox.ts:479`

## What was reported (unmeasured — profile first)

- `query-items.ts:97` — `Object.values(outbox).sort` per `inputs()`, no
  memo: O(n log n) per call.
- `offline.ts:273` — rebuild/filter/sort of the full inbox per
  `itemEntries()`.
- `metadata.ts:18` — `JSON.parse(stringify())` per projected field;
  `:74` — `structuredClone` of whole state + `JSON.parse` per key per
  restore.
- `client-observed.ts:63` — `structuredClone` + 2× stable-serialize ≈
  O(3×page) per event, plus `:57` `freezeTree` full extra traversal.
- `client-outbox.ts:479` — sequential `await status()` + `queued()`.

## Suggested fix

- Memoize/sort-once, single `structuredClone`, `Promise.all` for the
  independent awaits — but only where profiling shows it matters.

## Acceptance

- Profiles for large-outbox / large-inbox / high-event-rate scenarios
  before and after; no behavior change, event-path cost down where it was
  hottest.

## Resolution (2026-09-12)

Profiled before changing code. ItemCapture sorts its immutable captured outbox once. Published query data already isolated/frozen is hashed once and reused before cloning an equal page; recursive freezing skips only objects previously deeply frozen by this publication path, never arbitrary caller-frozen inputs. Metadata serialization and unrelated awaits were left alone because the measured hot paths above were more material.

Paired three-round Bun1.3.12/macOS arm64 stress profile (shared host under concurrent load; median wall time):10k outbox repeated inputs0.981ms→<0.001ms;2000-row unchanged publish+reduce22.354ms→11.927ms;10k inbox plus10k ledger itemEntries sort-memo experiment2.863ms→1.409ms (experiment later discarded; see byte-budget decision below). Initial less-contended pre-change run was9.643ms/event; timings are informational, not a new performance gate. Inbox256 queued-row admission limit remains unchanged;10k is stress history input.

Validation: existing client items/history/inbox63 tests pass after rebuilding package; they cover immutable row identity, item evidence, replacement images, follower admission and history. Compiler/package type generation also passes. Weak caches do not retain abandoned publications.


Final byte-budget decision (2026-09-12): discard only the follower inbox/ledger sort memo, retaining its previous per-call sorting behavior and fresh entry objects. Keep the measured ItemCapture outbox sort-once and immutable publication/hash reuse improvements. The integrated parent baseline already occupied 89,999 of the 90,000 gzip-byte ceiling. Reusing the same typed EvalError throw path, removing redundant private merge checks behind the checked execute boundary, shortening the unknown-schema-field diagnostic without removing any field detail, and dropping the inbox memo reduce the integrated complete runtime from 90,222 to 89,981 bytes under Node24.18.0/esbuild0.25.9/gzip9. All five execution certificate checks remain. No new budget or gate is introduced.
