# Lane OS — round 8: delivery fault matrix integration

All **313 matrix checks pass**: 156 sites × transient/persistent faults, plus
the census. All 140 RG classifications, recipes and non-rejecting-wait flags
are preserved by site identity; the additional search decoder and query-only boundaries are optional.
The defect was stale census/recipe metadata after OS added a decoder await,
which shifted later numeric case indices. No production guard needed changing.
The affected search/delivery tests, 600-seed oracle and whole guide pass.
The unchanged wasm cap remains the only final qualification failure.

Prior reports remain [rounds 0–6](./ROUND6.md) and [round 7](./ROUND7.md), with
links onward to their original evidence. [Commands and results](./round8/COMMANDS.md),
[exact await delta](./round8/AWAIT-DELTA.md), [matrix results](./round8/matrix-qualified.json),
[search-site fault cases](./round8/SEARCH-SITES.md), and
[failure index](./round8/failure-index.json) carry this round's evidence.
Text logs are gzip-compressed without changing their contents.
No scripts/test.sh, tool installation, budget increase, push or publication.

## Untouched round-7 reproduction

Ran the matrix first at **c81476d5f**, before any source or manifest edit and
before merging main. It failed the source boundary census, then the decoder
and displaced recipes. The ordinary all-cases run stalled entering the
change-feed tail of the matrix; its raw output is retained as
`matrix-before.log.gz`. A rerun with Node's test timeout also stalled under
mocked timers (`matrix-before-bounded.log.gz`). Both were terminated by their
recorded PIDs. No other lane's process was touched.

To finish the census of failures, ran unchanged sites 0–135 together and sites
136–140 separately, each mode, with external 15-second bounds. The merged main
had no changes to these SDK source/matrix files: these split runs still use the
exact round-7 source. All 282 case combinations were attempted. Unique outcomes
were **253 passes, 28 assertion/recipe failures and one stalled persistent case**,
plus the failed census. The 0–135 group completed its case assertions but also
needed the external bound during teardown. These are diagnostic runs, not
qualification. `before-runs.json` records every exit including timeouts.

The failing original-tree case indices were:

- **116, 117, 118, 121, 122, 125, 129, 131, 132, 134:** both transient and
  persistent. These name the new decoder, original JSON response, legacy JSON,
  legacy retry fetch, restore witness, native state/install, hold revision/save,
  and clock persistence respectively.
- **133:** persistent clock fetch. Transient happened to pass despite being
  assigned the wrong optional recipe.
- **136:** persistent change-stream reader stalls; transient passes.
- **137 and 138:** both change-feed JSON and race cases fail.
- **139:** persistent FIFO iterator fails; transient happens to pass.
- **140:** both fallback media remove cases fail with no recipe.

Every failure is ours: OS had not reconciled its new awaits with RG's matrix.
No new production failure at clock, native install, hold metadata or restore is
inferred from a case running the wrong recipe. The final corrected matrix tests
those actual boundaries again under their original classifications.

Then fetched/merged main **ae265b730** in **54ca4b1d3**. The journal and LLP Revised
line conflicted; both parents' journal sequences and all complete revision notes
are retained. The merge brings EX's published guide/starter work; SDK source
merges unchanged. `merge-preservation.json` records the parent commits and the
subsequence audit. Round-7 reviews are left for the later commissioned round.

## Exact new, changed and moved awaits

The untouched delivery census grows **140 → 141**; final expanded coverage is **156**; the source-wide boundary changes only
`local.ts`, `request-wait.ts`, `local-query.ts`, and new `local-search.ts`.
`source-await-delta.json` inventories every added/changed await across those
files; `delivery-site-mapping.json` records every old/new index, line and ID.

| Site | Change | Classification and proof |
| --- | --- | --- |
| `local.ts:sendPost:postForCaller(…)#1`, index 9 | Adds the `decode` argument, line 535 → 537 | **Required**, unchanged: shared mutation transport can have an unknown response. It must retain custody and retry the same ID after recovery. Both original fault modes pass, including caller/lookup/event agreement after recovery. |
| `local.ts:sendPost:searchReplyIdentity(capture, json, generation, witnessRestore)#1`, index 12 | Replaces inline `witnessRestore(…)`, line 558 → 559 | **Optional**, query-only bookkeeping. Existing `sendPost` catch returns unavailable after rejection; both modes allow all healthy queued IDs to POST once. Removing that guard fails both modes. |
| `request-wait.ts:postForCaller:decode(response)#1`, new index 116 | Added await, line 18 | **Optional to delivery**, search-only decoder callback. New queryDecode transient/persistent cases inject below this await while a successful unobserved head and two admitted tails exist. The existing sendPost guard absorbs ordinary decoding failure; removing it fails both modes. |
| `request-wait.ts:postForCaller:response.json()#1` | Same line/expression; index 116 → 117 | **Required**, unchanged mutation outcome decoding. Same-ID recovery remains mandatory and passes. |
| Original indices 117–139 | Each shifts by +1; expressions unchanged | Every original recipe, required/optional classification and absorbs flag follows its site. The final search expansion moves the iterator/media appendix further to 154/155. This includes restore, native, local-sync, pending-writes, clock, changes, iterator and media fallback. |

There are also source-line moves earlier in local.ts. In total, **two existing
expressions change, 70 existing delivery entries move by line and/or index,
and 68 are completely unchanged**. The exact mapping table omits none of the
moved sites. No previously optional site becomes required. Required count stays
**48**; optional count becomes **108** (the decoder plus 15 query-path entries).

Required reads still mean unknown FIFO/custody cannot safely be skipped.
Required response reads retain the unknown mutation's ID/outcome ownership.
The matrix removes each fault and proves FIFO progress, one terminal event,
lookup agreement and same-ID collection with no new POST. Persistent required
failure may outlast the caller's 25-second wait; later same-ID collection returns
the terminal outcome. No successful outcome is invented to make a case pass.

The 11 initially outside-owner awaits are **two in local-query.route and nine in
local-search**. They are independent query evaluation, not prerequisites awaited
by delivery. All are now **inside the matrix**, with optional transient and
persistent cases. Expanding the whole route owner also includes its four
pre-existing awaits. No search await is waived or excluded, and no existing
owner is removed. [SEARCH-SITES.md](./round8/SEARCH-SITES.md) gives every exact ID,
reason, guard and fixture branch. The source-wide seal remains strict.

The test-only fixture launches public query calls alongside the healthy queued
sends and repeats the queries across eight five-second advances. It scripts only
the query host replies/state/meter receipts to reach the SDK branches; all
outbox/receipt calls still run on the real wasm device. Native fallback,
missing-program fallback, unknown local coverage, stream reading/cancellation,
identity, both state reads and every speculative-read fence are reached.
Cancellation injection extends response-method instrumentation to reader.cancel;
the original direct-failure allowlist and absorbs set remain unchanged.
Actual search-engine behavior is separately qualified by the 600 real-host seeds.

No new catch is added: existing query transport guards already prevent healthy
send starvation. SearchBound still reaches ordinarySearch's E_BOUND result;
ordinary failures make that query unavailable. Sync/reset invalidation schedules
`void rerun(watch)`; query evaluation is not inserted into the delivery network
chain. The rerun owner catches evaluation errors. A one-shot query retains its
own caller failure semantics. No authorization, disclosure or meter rule changes.

## Verification and controls

| Check | Result |
| --- | --- |
| Complete matrix after reconciliation | **313 passed**, 0 failed/cancelled/skipped; every fault site reached and injected |
| Search/process/wasm/mounted React and Pages | **161 passed** |
| Delivery audit, receipts, clock, pending, transport, restore and sync | **331 passed**, one pre-existing named skip requiring SNAPBACK4_LEGACY_BIN |
| Generated search oracle | **300/300 process + 300/300 wasm**, no failing seeds |
| Current-only server differential | **22 schedules / 194 identical pages per host**, inside the oracle |
| Affected Rust ordinary/membership/merge and device merge | **66 passed** |
| Whole guide, including merged EX work | **98 passed**, no skips |
| Wasm codec/families/server-only absence tests | **38 passed**; separate attribution checks pass |
| Native build, client build, typecheck | pass |
| Negative controls | **5/5 killed for the intended assertions** |
| Reference, whitespace, classification preservation, append-only journal | pass |
| Canonical wasm budget | **FAIL — ours, inherited**; 6,526 B above unchanged cap |

Oracle times: process **174.770 s**, wasm **127.520 s**. All prior categories
remain, including 50 ID reuses and 74 each of projection, invalid-input and
argument-change cases per host, alongside keyset, identity, scope, expiry,
reset and link schedules. This round does not rerun the full copied builder
store or native Expo; their earlier acceptance evidence remains historical.

The negative controls use isolated src/dist copies in this worktree's target:
remove the query decode guard; remove the query identity guard; add an
unclassified delivery await; add an unclassified helper await; add an await to
the search module. Every control fails with ERR_ASSERTION and its intended
message, not merely a process error. Production artifacts are never mutated.
An initial scope expansion used nonexistent client.once and failed all 30 new
cases on the existing reach/inject assertion. Corrected to public client.query;
all cases then pass. No assertion was weakened. The full RG historical 38-control campaign is not newly claimed; the original
140 site recipes and all liveness/FIFO/exactly-once/backoff assertions are retained.

## Acceptance matrix note

| Existing OS acceptance | Round-8 addition |
| --- | --- |
| One query, one invocation, consumed prefix, shared ledger, disclosure and lifecycle fences | All 161 named affected tests and 600 real-host seeds still pass. No product behavior changes. |
| Healthy queued sends remain independent of search | New decoder transient/persistent cases and changed identity-helper cases preserve FIFO, exactly one POST/event, caller/lookup agreement and bounded retries. Guard-removal controls fail. |
| Required custody recovers | All 48 RG-required boundaries retain classification and pass both fault modes/recovery assertions. |
| Census and scope | 156 classified matrix rows; all 140 old semantic recipes preserved; every new search await tested, with no waiver or exclusion. |
| Whole guide | 98/98 on the merged tree. |
| Wasm | Unchanged from round 7; local cap remains red and belongs to the supervisor. |

## Wasm

Canonical build: **2,039,451 B raw / 592,719 B GNU file-input gzip-9**.
**Delta from round 7: 0 raw / 0 gzip**; from round 6: 0 raw / −3 gzip.
Unchanged budget: **586,193 B**, over by **6,526 B**.
SHA-256 `7189290aff31e3e7cdf33141cf30d09235abb14d58ca65bceb8333784ca8444d`.
Rust 1.97.0, wasm-bindgen 0.2.127, no wasm-opt or tool installation.
This round changes no wasm input. Existing OS composition metadata, retained
filtering, shared ledger/state identity and reset counter account for the
inherited excess; no new per-feature gzip attribution is asserted.

## Every failure

- **Ours, integration:** the untouched matrix census and all 28 failing case
  combinations named above; one persistent change-feed case stalls, and the
  prefix diagnostic run stalls in teardown. Reindexing preserves the real
  fault recipes; final full matrix completes in 17.394 s within an external 60-second bound (exit 0; no cancellation).
- **Ours, new fixture:** its first 30 cases called nonexistent client.once and
  therefore failed the mandatory reach/injection assertion. Corrected to
  client.query; final 30 cases pass, including repeated persistent failures.
- **Ours, runner setup:** Node's test timeout did not bound the mocked-timer
  stall; terminated only recorded child/parent PIDs, then used external bounds.
  Those interrupted logs remain, including the prefix teardown timeout.
- **Ours, expected controls:** five deliberately mutated variants fail as
  specified in controls.json; neither these nor baseline failures count as passes.
- **Ours, inherited wasm budget:** the artifact builds, but build-wasm.sh exits 1
  at the unchanged cap. No other final qualification command fails.
- **Ours, operational setup:** initial report lookup omitted snapback4/; the
  first log-directory command doubled that prefix, preventing redirection;
  guessed source/LLP/old-ledger paths were absent; local skill symlinks were
  unpopulated. Corrected reads/paths, removed the empty accidental directory,
  and used an existing read-only skill copy. Some discovery greps returned no
  matches; inspecting absent schema.operations in the old chat fixture raised
  TypeError before the test-only query metadata was installed. The first
  ref-check wrapper ran from the wrong working directory and failed to open its
  log; the corrected audit passes. Staging found an extra EOF blank line in
  COMMANDS.md, removed before the passing final whitespace check. The merge's expected conflict exit was resolved with both histories.
- **Baseline failures: none observed. Environmental test failures: none observed.**

Round-7 review findings are not part of this repair or claimed resolved.
The existing RG allowlist/retry-strength follow-up remains open. One journal
entry and a scoped LLP implementation note accompany this report. Commit uses
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Push and publication are forbidden.
