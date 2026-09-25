# Lane Z review round 2 — conditional removal, page budgets and query routing

2026-09-25 · LLP 3000.016 revision 12 · `sb4-intent/z-event-slots`.

## Z changes, file by file

| File (relative to `snapback4/`) | Change and evidence |
|---|---|
| `crates/snapback4-device/tests/event_slots_trace.rs` | Add a conditional removal of a live, held, floored original with a synced event count. Assert static prediction eligibility so the test reaches the runtime fence. The untaken branch predicts; the taken branch refuses without predicted rows, preserves the source and live slot, and creates no tombstone. Admission queues without prediction. An `online only` count permits the removal and tombstone. Export both cases for real wasm/native replay. |
| `crates/snapback4-core/tests/event_slot_snapshot.rs` | Run both mixed-kind directions and the no-full-kind case with page limits 1, 2, 3, 5 and 7. Add two public owned-table groups from declarations sharing their sources: an excluded prefix exhausts the first group, then the second receives exactly the remaining 1, 2, 3 or 5 units. Count decoded storage rows independently of emitted rows, across both groups, and check continuation progress. |
| `packages/snapback4/test/bounded-following.test.mjs` | Preserve both blind-review reproductions through real clients: an unrelated `held = posts['p3']` before an unknown branch, and a fully synced owned-event scan whose online-only filter rejects every locally held row. Both must publish `{ loading: true }` while a source/owned-event prediction fences recovery, with no server fallback. After the prediction is observed, the filtered query recovers the nonempty authoritative result. |
| `reports/20260925-event-slots-r2/mutate-regressions.py` | Independently apply the three requested mutants, require assertion failures, restore source in `finally`, and rerun the restored tests and trace producer. |
| `reports/20260925-event-slots-r2/*.log.gz` | Preserve targeted tests, real-host replay, before/after routing results, mutation evidence and full-suite results. |
| `JOURNAL.md` | Append this round's implementation, measurements and limits. |

## Mutation sensitivity

Run from `snapback4/` with the toolchain on `PATH` and no other build in the tree:

```sh
python3 reports/20260925-event-slots-r2/mutate-regressions.py
```

| Mutation | Result |
|---|---|
| Add `if !repost { return Ok(()); }` to `timeline_aggregate_fence` | Exit 101 in the isolated conditional-removal test: the live original incorrectly predicts. This run excludes all insert schedules. |
| Change only `used += work.max(1)` to `used += rows.len().max(1)` | Exit 101: the page decodes 16 owned rows for a budget of 14, across `feedPosts` and `otherPosts`, despite emitting no rows. |
| Change filtered `room` to `room.max(7)` | Exit 101: both mixed-residency tests decode 7 rows at budget 1; the two-group test also overscans its remaining budget. |
| Restore implementation | Four snapshot tests and both device tests pass; all 23 fault schedules regenerate. |

## Forms exercised

No new author syntax or diagnostics. The additional cases compile and run:

```quarry
mutation conditionalRemove(postId: posts, removeIt: bool):
  if removeIt:
    update posts[postId] { removed: true }
```

With `posts` floored and `view totals: count feedPosts by .actorId`, the true
branch queues without predicted rows; `totals online only` permits prediction.
The false branch predicts in both configurations.

```quarry
query conditionalEventsHeld():
  held = posts['p3']
  if exists eventSwitch['gate']:
    return feedPosts last 10 by .at
  return []

query filteredEvents():
  return feedPosts last 10 by .at where exists eventSwitch['gate']
```

With the gate `online only` and a pending own post, both queries must publish
loading. A local row touched elsewhere in the query cannot validate a branch
or filter decided with placeholder knowledge.

## Qualification and integration

Merged lane U round seven `633e566fc` in `77b9a358f`, including the preceding
round-six watch-expiry tests and evidence. The fenced-and-held exception and
query-wide `held` provenance are removed. Unknown event reads continue to mark
`speculative`; a fully synced kind's known point hit remains non-speculative.
There is no remaining event-specific `held` note to move after the filter.

Merge conflicts were limited to the append-only journal, point-read image
return, and adjacent client test additions. Both journal entries and both test
sets were preserved. The point-read resolution removes the obsolete marker
while retaining Z's internal transition image and stripped application image.
The imported U filtered-event assertion now expects the engine's withheld
result for Z's partial owned table; Z's separate fully synced event test
exercises the sticky-scan reproduction before/after the filter.

| Imported U file (under `snapback4/`) | Change |
|---|---|
| `crates/snapback4-core/src/engine/components.rs` | Remove query-wide held coverage/provenance. |
| `crates/snapback4-core/src/engine/read.rs` | Remove point and pre-filter scan held markers; preserve event-slot transition access during integration. |
| `crates/snapback4-device/src/call.rs` | Stop emitting the removed held provenance field. |
| `crates/snapback4-device/tests/components.rs` | Update component envelope expectations. |
| `crates/snapback4-device/tests/search_merge/round2.rs` | Update expansion coverage expectations. |
| `crates/snapback4-device/tests/uniform_word_expansion/mod.rs` | Remove assertions for obsolete held provenance. |
| `packages/snapback4/src/local-query.ts` | Remove the fenced-held exception; speculative refusals use placeholder recovery; preserve independently retained components. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Document the revised publication rules. |
| `packages/snapback4/test/bounded-following.test.mjs` | U's guarded refusal and unknown branch/filter cases; speculative profile loading versus non-speculative partial-page preservation. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Fenced speculative refusals and delayed server/composed replies crossing expiry. |
| `packages/snapback4/test/retained-history.test.mjs` | Preserve independently retained components on offline/failed recovery. |
| `packages/snapback4/test/page-authority.test.mjs` | Update coverage shape. |
| `packages/snapback4/test/residency.test.mjs` | Update unknown mixed-result publication expectations. |
| `packages/snapback4/test/word-expansion.test.mjs` | Update speculative filtered-projection publication expectations. |
| `packages/snapback4/test/fixtures/page-observation.mjs` | Strengthen expiry observations across browser/native views; timestamp observations against the actual authorization deadline. |
| `packages/snapback4/test/store-reset.test.mjs` | Wait for actual device store adoption instead of inspecting the last HTTP arrival. |
| `packages/snapback4/test/page-observation.test.mjs` | Require the strengthened expiry witness. |
| `reports/20260925-bounded-following-r6/` | Imported U's previously committed qualification report, mutation harness and compressed evidence. |

Z made no direct change to `local-query.ts` or `local.ts`.

Focused integrated qualification passes: two native device trace tests, six
real-client routing tests (both Z reproductions plus U's grouped cases, on both
hosts), and 46 event-slot replays. The latter contain 23 schedules, 271
dispatcher calls per host and four reopen boundaries per host. Native binary,
wasm and TypeScript package builds succeeded. The wasm artifact is **1,781,822
bytes raw / 498,394 bytes gzip**, below the unchanged 500,000-byte budget.

An initial full-suite invocation against the pre-U commit was deliberately
stopped with SIGTERM (exit 143) when U's commit became available, before the
client phase. It has no completed summary and is not a qualification result.
A second invocation at `77b9a358f` passed Rust in 622 seconds, then encountered
two transient failures in existing online-client tests:

- `a held global acknowledgement preserves retirement of a login minted after its dispatch`
- The same test `across a cleanup retry`.

Both passed immediately in isolation, unchanged (2/2, 3.282 seconds). These
paths do not use the device query router changed here. Classification:
**environmental/transient**, inferred from the unchanged online path and the
successful isolated reproduction; neither is in the recorded baseline. The
host reported load 105.48 over 96 CPUs and selected serial client files. No
timeout or assertion was weakened. The run was stopped with exit 143 to merge
U's test-only follow-up `f6dd23f3e` in `032b4a70a` and restart without the extra
CPU-affinity restriction. The cancellation's `parallel worker ended before
reporting` marker is harness interruption, not a product failure. Both interrupted
runs have no completed summary. Their logs are preserved.

The final full run tests `032b4a70a`, using:

```sh
SNAPBACK4_RUST_TEST_PROCESSES=8 CARGO_BUILD_JOBS=8 bash scripts/test.sh
```

Rust passed in 233 seconds; client tests passed in 198 seconds, including the
main run's 1,671 passes and ten existing skips. All 78 client models passed
in 252 seconds. Exact result, exit **0**:

```text
== 0 failure(s) in 696 s
```

**Failures in the completed full run: none** (introduced, baseline or
environmental). The interrupted runs, expected pre-merge routing failures and
intentional mutant failures above are recorded separately; none is hidden by
the final summary.

The two transient online-client cases can be rerun independently with:

```sh
node --test --test-name-pattern='a held global acknowledgement' packages/snapback4/test/app-global-attempts.test.mjs
```

Both also passed in the final full run, unchanged (271 ms and 374 ms).

Before U's fix, both client reproductions failed on both hosts (four expected
assertion failures), returning `{ data: [], complete: false, cut: null,
fresh: true, next: null }` instead of loading. These are the reviewed U routing
defects, not environmental failures. The independent event-slot replay passed:
23 schedules × wasm/native = 46 tests, with 271 dispatcher calls per host.

The inherited baseline log reports `== 1 failure(s) in 276 s` in its cargo phase.
No baseline exemption is claimed for these routing failures.

## Decisions and scope

The two snapshot groups are the public owned tables of two Following
declarations, keeping the design's canonical public owned-table residency.
Five intervening empty groups consume one unit apiece; the test accounts for
that work before asserting the second owned group's remaining budget.

No authorization, disclosure, durability, engine meter or event-slot design
change is needed for the Z tests. No source file exceeds 1,500 lines. Inventory
measurements were not rerun in this regression round; the earlier inventory
[report](../20260925-event-slots/REPORT.md) remains the measurement record. No push or publication.


## Completion

All three round-two requests are implemented and verified. No known open
implementation problem or stopped design part remains. No behavioral deviation
from the brief: U owns routing, and the imported U tests are adapted only for
Z's partial event-table withholding. The fully synced owned-event scan is
retained separately so the pre-filter sticky-row reproduction remains covered.

Commits before this evidence entry:

- `be8c1a663` — conditional removal, shared page budgets and mutation harness.
- `e793c879b` — both blind-review client reproductions, demonstrated red before U.
- `77b9a358f` — merge U's round-seven routing/provenance fix `633e566fc`.
- `032b4a70a` — merge U's test-boundary follow-up `f6dd23f3e`.
