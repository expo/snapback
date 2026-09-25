# Lane U round 10: route expiry retries through the publication procedure

2026-09-25. Branch `sb4-intent/u-bounded-following`, based on `fb0a89ba4`.
Implementation: `aa8aaf6fc`. Read both U-r9 reviews, READY WITH CHANGES.
The shared Medium is fixed; Astra's Low pagination test gap is also covered.
No push or publication.

## What changed

The first local evaluation and the expiry reobservation share `routeLocal`,
the existing post-local half of `route`: known-complete local wins, followed
by withholding, blocked checks, server fallback, composition and memory
recovery. The final delivery fence now lives inside the publication loop, so
it applies equally to a retry's external answer. Only accepted server data is
remembered, after its final fence and deadline check.

A local candidate carries its engine deadline even when its value is withheld.
The expiry decision removes only expired remembered data; expiration of a
local or server candidate does not retire independent unexpired memory. The
existing composition and authoritative-refusal cache invalidations remain.
If a replacement is already due, a watch is dirtied and the value is withheld.
The expiry retry remains bounded to one. Ordinary composition still makes its
existing post-server local observation; the composition regression requires
three device calls total (initial, expiry retry, composition observation).

## Files

Paths are relative to snapback4/.

| File | Change |
|---|---|
| `packages/snapback4/src/local-query.ts` | Extract and reuse post-local routing; preserve local deadline metadata; run the final external-answer fence on each candidate; cache only accepted server answers and retire only expired memory at expiry. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Document that expiry retries follow fallback, composition and memory recovery. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Add 18 routing cases for unknown online retries, offline memory and expiry controls, blocked/failed fallback, composition, a late prediction and an expired server replacement. |
| `packages/snapback4/test/retained-history.test.mjs` | Add six real-device cases: one-shot and idle-watch expiryBranch on wasm/native, plus real cursor continuation on both. Block sync delivery so it cannot rescue the watch. |
| `reports/20260925-bounded-following-r10/mutations.py` | Six reproducible mutations, always restoring the built module. Optional arguments select mutation names. |
| `reports/20260925-bounded-following-r10/*.log.gz` | Focused, affected, mutation and full-suite evidence. |
| `JOURNAL.md` | One dated append-only entry. |

## The five rules and their tests

| Rule | Evidence |
|---|---|
| 1. Session/incarnation | Existing retry sign-out, close and incarnation tests, plus the real publication-session suite, remain passing. Every new routing await and final fence checks the session. |
| 2. Known complete local wins | Existing complete retry tests still avoid the server. expiryBranch starts with data false and complete true at T-1, then changes branches at T; that new outcome is routed independently. |
| 3. Engine withholding and blocked fallback | New retry cases exercise offline, pending prediction, held and transport failure. Existing speculative/unavailable retry tests retain their future wakeup. |
| 4. Partial/speculative outcomes | An online unknown partial or speculative retry takes fallback. Offline speculative retries recover unexpired memory with its original since/cursor; expired-memory controls refuse or load. A composed retry combines retained local rows with server rows. |
| 5. Delivery and expiry | Late predictions block a retry's server answer at final publication. Expired server replacements dirty the watch without deleting valid memory. Both devices prove idle-watch recovery after T and paginated continuation. |

No new language form or refusal code. The existing forms used by the real
regressions compile and run:

```quarry
query expiryBranch():
  if exists permits['permit']:
    return false
  return exists audits['a1']
query expiryPage(c: cursor ?):
  ignored = permits['permit']
  return messages['held'] after c last 5 by byTime
```

The permit is fully synced and expires at T; audits is online only. The first
engine evaluation is at T-1 and is delivered at T. The retry is speculative
and must reach the real server, which returns true. The watch receives true
without a sync, timer or unrelated invalidation. Both query and watch cases
require exactly two local calls and one server request. The real pagination
cases keep a non-null cursor after retry and read the next five held rows.

## Mutation checks

| Mutation | Result |
|---|---|
| Skip post-local routing after retry | 11 failures: fallback, memory and composition. |
| Republish initial.result for an online unknown retry, with the retry deadline | All four speculative/non-speculative query/watch cases fail. |
| Delete memory before reobservation | Four valid-memory cases fail; two expired-memory controls pass. |
| Drop the retry cursor | Both real wasm/native pagination cases fail. |
| Skip the retry's final delivery fence | Both late-prediction cases fail on the wrong published value. |
| Drop the deadline only when the local value is withheld | Both future-deadline cases fail. |

Failures are inspected assertions for the intended behavior. Mutation failures
are expected evidence. The built module is restored after each run, and the
full suite rebuilds it. The pagination mutation addresses Astra's additional
Low finding. Grok's republishing mutation cannot survive the online retry cases.

## Qualification and scope

Frozen dependency install and package build passed. The initial unchanged
router suite passed 114 tests. Focused run: 26 passed, zero failed. Affected
run: **210 passed, 0 failed, 0 skipped**, 63.504 s, across prediction-routing,
retained-history and query-publication-session. A four-case focused recheck
passed after putting behavioral assertions before call-count assertions.
No unmodified product test has failed during development.

The project llp-orient skill links are dangling and no installed copy was
found; orientation used the governing documents and review records directly.
The worktree's RFC copy is revision 2; the accepted origin/main RFC is revision
12, whose increment 5 belongs to lane Z. No source-residency work was imported
or changed in this routing-only round.

No design deviation. No engine, authorization, meter, schema, storage,
acquisition, public-contract or package-version changes. Source files remain
under 1,500 lines. No new skip, reduced sequence count, timeout increase, push
or publication. No inventory remeasurement: earlier lane-U measurements remain
historical, with their unmet 5x target explicitly recorded.

The whole-page remembered expiry limitation stays deferred at
`issues/20260925-snapback4-remembered-answer-row-expiry.md` on origin/main.
Reproduction: remember a page containing a permanent message and a typing row
expiring at T, then query offline at T. The remembered answer's own earliest
deadline withdraws the whole page. This round preserves independent memory
whose own deadline is still valid; it does not relax any expired-memory guard.

Full-suite command, from snapback4/ with the required toolchain on PATH:

```sh
taskset -c 0-15 env SNAPBACK4_RUST_TEST_PROCESSES=8 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 bash scripts/test.sh
```

The baseline tail is `== 1 failure(s) in 276 s` (cargo test); no waiver is used.
Final full-suite result, exit 0:

```text
== 0 failure(s) in 1555 s
```

Rust passed in 195 s. Client tests: **1,710 passed, 0 failed, 10 existing skips**,
1,112 s. All **78 model tests passed**, 233 s, including online and local
5,000-sequence I1–I13 sweeps. This round ran one full suite, with no failures
(ours, baseline or environmental) and no waiver. No suite was interrupted.

Reference audit: `ref-check: ok — 509 LLP docs, 9296 refs in 26163 files, 0 errors, 0 unchecked`.
