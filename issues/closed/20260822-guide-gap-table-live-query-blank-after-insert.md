# guide-gap: table live queries can go empty after a same-table insert

**Status:** Closed
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 4
**Systems:** Guide, Live queries, React/Expo, Codegen
**Date:** 2026-08-22
**Governing:** LLP 0008; LLP 0061
**Evidence:** Diary 0106 M2/M3; Clique local-main Grok Explicit on
`b70caf19ea`

## Problem

A handwritten table live query filtered by `eq('_id', …)` or by parent id
can publish **no rows** immediately after a successful insert into the same
table. The mutation settles, related counters can increment, and the
subscribed point/list query then renders empty (Clique: thread screen
stuck on “Loading thread…”; later, DM bubbles missing until the query
became JS).

JS live queries that re-run the handler on writes restored the rows. The
start packet and live-query Guide page do not say that table incremental
deltas and JS replace semantics diverge this way, or when to pick JS.

This is distinct from Familiar six-subscription contention
(`issues/20260820-familiar-live-subscription-contention.md`) and from the
closed owner-visibility-exit delta leak
(`issues/closed/20260812-live-delta-owner-visibility-exit-skipped.md`).

## Required change

- Document, with a failing-then-fixed example, that a table live query on
  `eq('_id')` / parent-id after a same-table insert may go empty, and that
  `defineJsLiveQuery` re-runs and keeps the row.
- Name the selection rule in the queries / live-queries pages and in
  `snapback guide` aliases (`blank after insert`, `Loading thread`,
  `live_delta empty`).
- If this is a matcher/delta defect rather than intended physics, fix the
  incrementalizer so a just-inserted matching row cannot disappear from an
  already-subscribed point query; keep the Guide warning until that fix
  ships.

## Acceptance

- A cold agent following the Guide for a point live query plus insert does
  not have to discover JS live queries by watching the UI go blank.
- A minimized reproduction either fails a product test (if defect) or is
  cited as the documented JS-vs-table recipe (if intended).

## Resolution (2026-08-25)

The minimized product cases do not reproduce an incrementalizer defect. A
real-socket test now establishes `_id` point and parent-list table
subscriptions before a second client inserts a matching row with a
replay-accepted client-chosen id. Both subscriptions receive `live_delta` Add
operations and retain the row. The engine-level test independently asserts the
two Adds and parity with fresh point/list snapshots. The matching-Insert
classifier that produces this result was already present at the evidence
commit `b70caf19ea`; a matching Insert has no path that can synthesize a
Remove or an empty replacement.

The surviving Diary/benchmark evidence is an application-level symptom, not a
wire probe, so it cannot identify which external boundary blanked the Clique
screen. The exact product reproduction rules out the table matcher/delta path:
the observed blank must have come from a different argument/identity,
mutation-settlement-versus-delivery timing, or the auth/connection/HMR
lifecycle also active in that run. Switching to `defineJsLiveQuery` changed
rerun and application-cache timing, but was not a necessary correctness
workaround for an exact one-table filter.

The Guide now states the declarative/relational/JS selection rule, guarantees
matching inserts for subscribed point and parent filters, distinguishes
canonical row ids from provisional optimistic ids, and tells callers to wait
for live delivery after mutation settlement. Capability aliases include
`blank after insert`, `Loading thread`, and `live_delta empty`; retrieval case
97 preserves all three symptom routes. Its fail-first run reported four
errors (no lexical route plus three missing guidance strings) before the Guide
change, then passed with `96 case(s), 5 rosetta record(s), 0 errors`.

Verification:

- `cargo test -p snapback-engine table_live_point_and_parent_filters_keep_matching_insert -- --nocapture` — `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 592 filtered out`.
- `bun demos/_kit/tests/live-delta-e2e.mjs` — `PASS live_delta end to end (LLP 0034 OQ1 / DK-3) — 4/4`.
- `node scripts/check-retrieval-eval.mjs` — `check-retrieval-eval: ok — 96 case(s), 5 rosetta record(s), 0 errors`.
- `node scripts/check-inventories.mjs` — `[check-inventories] PASS: 353 package tests; 29 scripts tests; 31 demos/31 catalog entries; 487 publication leaves; 157 guide pages/1871 snippets`.
- `./ref-check --verbose` — `ref-check: ok — 311 LLP docs, 6617 refs in 12411 files, 0 errors, 0 unchecked`.
- `node scripts/check-guide.mjs --snippets` — `[guide-check] ok — 2 passed, 0 failed, 0 skipped, 0 preconditions; 157 pages, 1871 snippets, 0 routes + 0 host-ops joined, 0 warnings`.
- `node scripts/check-guide.mjs` ran all scoped corpus, snippet, link,
  retrieval, manifest, and flat-projection checks successfully. Its full result
  was `FAILED — 21 passed, 1 failed, 0 skipped, 0 preconditions` solely because
  the untouched inherited benchmark record
  `benchmarks/runs/2026-08-23-r2-published-0125/cells/opus-clique-explicit/events/harness.stdout.jsonl`
  contains an unallowlisted raw-client asset accessor.
