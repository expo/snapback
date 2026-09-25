# Lane U round 3: fence every answer publication

2026-09-25. Addresses Astra's High and Grok's Medium delta findings in
`~/sb4-intent/reviews/u-r2.astra.md` and `~/sb4-intent/reviews/u-r2.grok.md`,
against accepted LLP 3000.016 revision 5. Both reviews were read, and Grok's
completed review was checked again immediately before the full suite.
The supervisor's design documents are unchanged.

Implementation commits: `8ca2f5ecd`, `7a92c8a2d`, `2814adc8b`, `f1d837edb`, and
`148f2d1d3`.

## What changed, file by file

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `packages/snapback4/src/local-query.ts` | Extract read evaluation and add a shared final publication fence. Unknown Quarry outcomes retain static reads, including expanded helpers and rule probes. Only complete, known local execution can narrow that set. Ordinary locally produced partial answers keep their predictions; unknown Following keeps whole-query withholding. Native and unexecuted queries conservatively depend on every table. Compare those possibilities with predictable, unobserved outbox footprints. Check before dispatch and after response delivery as well as before final publication; preserve the local-commit revision fence after asynchronous checks. |
| `packages/snapback4/src/local-reads.ts` | Split predicted table/id footprints at the first slash: row IDs may contain more slashes. This prevents a source-only query from treating its pending write as unrelated. |
| `packages/snapback4/src/local.ts` | Supply live client state to the evaluator. Keep watch and one-shot incarnation/commit checks. The evaluator disables intermediate server publication by `ReadObservation.fetch`, so server, composed and remembered results all reach the common final gate. `local.ts` is now 1,400 lines rather than 1,499. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Sixteen tests for server shortcuts/delivery, remembered answers, transport failure, unknown local results, each E_OFFLINE route, established branch/disjoint-write controls, and native reset/install failure with ordinary and held queries. Lifecycle tests use the real client with controlled device/transport boundaries. |
| `packages/snapback4/test/bounded-following.test.mjs` | Add the unknown-condition reproduction, both direct and through a helper, on real wasm and native devices. Verify loading before acknowledgment and after acknowledgment until observation; then verify recovery includes the predicted post. Add exhausted-meter unique repost lookup on both tiers. Strengthen the native module test so continuation changes the returned rows. |
| `crates/snapback4-device/tests/following_meters.rs` | Cover horizoned `reposts[id]` and `reposts[viewer, postId]` with `examined: 0`, alongside the existing posts/output checks, on memory and SQLite. |
| `native-fixtures/following/src/lib.rs` | Scan two rows and pass the supplied continuation key into the real native `Ctx::scan`. Return its next key as fixture cursor data. Keep the actual original-card host read and oversized-output control. |
| `crates/snapback4-device/tests/native_following.rs` | Declare the fixture's native cursor as nullable bounded text, matching the SDK's application-owned continuation convention. Retain both stores' actual native unavailable/output tests. |
| `packages/snapback4/test/client-lifecycle.test.mjs` | Give the controlled pending-fallback case an actual static/runtime read table and intersecting footprint; preserve its existing local partial result expectation. |
| `packages/snapback4/test/following-routing.test.mjs` | Give the composed pending-entry fixture a posts footprint; an explicitly empty footprint is a no-op, not a row to replace. |
| `packages/snapback4/test/fixtures/page-observation.mjs` | Real browser/native inbox journey now demands withholding while resetRead is unobserved, including an older in-flight response. Establish offline state by failing the pending send. |
| `packages/snapback4/test/page-ready.test.mjs` | Keep the unrelated profile-write/inbox-fallback control; establish offline state by failing the pending transport because a server-only ping is fenced before execution. |
| `packages/snapback4/test/store-reset-review.test.mjs` | Reset with a pending prediction now requires loading instead of accepting a replacement server answer. |
| `packages/snapback4/test/sync-generation.test.mjs` | Four headless-generation cases now require loading instead of E_OFFLINE while their durable predicted rows remain unobserved; retain all adoption/evidence assertions. |
| `reports/20260925-bounded-following-r3/REPORT.md` | This report, routing audit, reproduction commands, qualification, and inherited measurement limits. |
| `reports/20260925-bounded-following-r3/*.log.gz` | Compressed final qualification, focused tests, reference audit, and intentional mutation evidence. |
| `JOURNAL.md` | One dated, append-only round-3 entry. |

## Every publication path

Read evaluation moved out of `local.ts`; its caller still performs the original
incarnation and local-commit checks before either `query()` returns or a watch
publishes. In addition, every route's result passes the evaluator's `publish`
gate. Known local results and ordinary locally produced partial results remain
publishable because they reflect local predictions. They cannot be replaced
by a server or remembered answer across the fence. Unknown Following results
retain whole-query withholding. Every external result checks the pending
footprint. Terminal authentication, closed-client, and restore refusals remain
refusals rather than cached answers.

| Publishing path formerly in `local.ts` | Fence and proving test |
|---|---|
| Server: not-current partition, absent native module, compiled `runs: server`, generic loading fallback, unknown refusal fallback, generic unknown fallback | The shared server function checks before dispatch and again after delivery; final publication checks again. `prediction publication fence: server shortcut`; `dispatch and delivery both check opaque native dependencies`; `native client reset…` and `native client install failure…` (ordinary and held); real `unknown conditions preserve static and helper dependencies` on both tiers. |
| Server: composed query's remote answer, remote answer reused after second observation, merged local/server object | These return through the same final gate. `Following becomes withheld on composed re-observation` covers server/offline/pending/transport-recovered interleavings; real `composed reads withhold the entire answer across the prediction fence` covers wasm/native. |
| Remembered: direct offline server-run recovery, server transport-failure recovery, missing guest shortcut | All final recovery results pass the gate; unavailable native guest routes through withholding and does not recover memory. `prediction publication fence: remembered` uses a populated cache and an unfenced recovery control; `transport failure cannot recover an answer after a prediction arrives`; both native install-failure cases. |
| Local unknown: partial/empty result or the second composed observation | Unknown outcomes retain static possibilities for fallback. Unknown Following checks the whole-query fence; ordinary locally produced prefixes retain their local prediction. `prediction publication fence: local unknown`; real direct/helper unknown-condition cases on both tiers; composed pending re-observation; `ordinary local prefixes retain predicted rows without remote replacement` and the unchanged real prediction-replay, retained authorization, and composed-history tests. |
| E_OFFLINE: unavailable partition, unknown local refusal while offline, remembered-cache miss, held fallback shortcut | All pass the same final gate. `prediction publication fence: E_OFFLINE reset`, `E_OFFLINE unknown refusal`, and `E_OFFLINE remembered miss`; held native reset/install tests. |
| Watch server-fetch publication and retained snapshot | Server fetches do not publish their result internally. Final watch delivery uses the common gate and the existing commit fence. Native reset tests subscribe to watches and check no server page without the prediction is published. Existing real `a response racing prediction admission is invalidated` tests remain in the full suite on both tiers. |
| Known local data, examined-meter prefix, pending backfill/cleanup partial result | These keep their existing local publication semantics. `established branches and disjoint writes remain answerable`, real untaken held branch tests, and `inbox floors use all routing branches and preserve meter prefixes` are controls. |

For unavailable Following, routing remains offline → pending predictable
unobserved entry → held → original server request. The same pending fence now
also covers ordinary queries whose possible reads intersect that prediction.
A server's returned dependency list cannot narrow the query's possibilities.

## Forms exercised

No syntax or refusal code was added. The existing conditional and helper forms
now obey the fence when an online-only condition is unknown:

```quarry
query conditionalFeed(c: cursor ?):
  if exists switches['gate']:
    return feed last 20 by .at after c { *, card: reposts[.actor, .post] }
  return []
```

The real tests fully sync posts, keep reposts and switches online-only, install
`gate` on the server, and predict `own/conditional`. The device returns an
unknown empty branch with only `switches` in its executed tables. Both tiers
publish exactly `{ loading: true }` with no server request until observation.
A source-only branch additionally proves that the slash-containing predicted ID
still intersects posts. The helper form calls `conditionalRows(c)` in that same branch and has the
same result. The established `want: false` held-query case still returns its
known complete `false` or `null` answer.

The existing native form uses an application-owned continuation argument:

```quarry
query native_cards(postId: posts, c: text <=2000 ?): native
```

The guest serializes the native scan's suffix key as bounded text and parses it
back for `Ctx::scan(..., after)`. The first page is `p3, p2`; the second page
must contain two different rows. Server fallback receives that original key.
An unobserved prediction still fences the second page; after observation a
fresh first-page read contains `own-native`. This replaces round 2's cursor
echo, which did not exercise pagination. Engine-issued Quarry cursors are a
separate existing form and are still tested by the Quarry page cases.

## Tests and negative controls

Focused routing: **17 passed, 0 failed** (13 initial publication/lifecycle cases plus
four existing composed interleavings). An additional footprint regression and the updated unknown-condition cases pass
in a 16-test focused run on both tiers; the strengthened real native module test passes. Rust memory
and SQLite tests: **4 passed, 0 failed** after restoring all mutations.

Three intentional mutations were each rejected on both stores:

| Mutation | Failing assertion |
|---|---|
| Only posts may mark a point miss before the examined charge | `following_meters_memory/sqlite`: `repostId` would publish a null card with `unknown: false` and `unavailable: false`. |
| Only `byId` may mark a point miss before the examined charge | `following_meters_memory/sqlite`: `repostPair` would publish the same null-card meter prefix. |
| `native_query.unavailable = false` | `native_following_memory/sqlite`: the old original's native outcome would fail to withhold. |

No mutant remains in the worktree. Neither source execution nor meter ceilings
changed in this round. The real wasm/native exhausted-meter test also performs
8,192 successful post probes before missing the unique repost pair.

Reproduce from `snapback4/`:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
bun install --frozen-lockfile
bun run --cwd packages/snapback4 build
cargo test -p snapback4-device --test following_meters --test native_following
node --test packages/snapback4/test/prediction-routing.test.mjs packages/snapback4/test/following-routing.test.mjs packages/snapback4/test/bounded-following.test.mjs
SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh
```

## Decisions and limits

No design deviation. Conservative engineering choices where execution cannot
prove independence: retain all static dependencies for any unknown or incomplete
Quarry outcome; treat native programs as potentially reading every table; treat
an absent legacy footprint as unknown. An explicitly empty footprint establishes
that no row was predicted, so there is no written-table intersection.
Only complete, known Quarry execution narrows possible dependencies. Actual
executed card reads still determine whether a locally answerable held branch
is unavailable. Helpers are expanded into the compiled Quarry body.

The full suite exposed an overbroad first implementation that also blocked
ordinary locally produced partial answers. That was corrected: the new rule
fences every external replacement, while preserving the existing local
horizon and retained-history prediction behavior. Following unknown results
still withhold as a whole. This preserves the original authorization and
local-read tests without weakening the external-answer fence.

The SDK's native scan uses application-owned keys, so the fixture's cursor is
bounded text containing its suffix-key JSON. This changes only the test fixture,
not public cursor encoding or the native SDK.

No new authoring form, diagnostic, guide change, storage layout, authorization
change, ceiling increase, package version, push, or publication. The web device
still has no native guest host: real Quarry tests run on web wasm and native
process devices; actual native guests run on native and both Rust stores.

No new acquisition measurement was needed for these routing-only changes.
The inherited 5× target remains unmet, and a packed-format measurement remains
unclaimed. For continuity, these are the **prior round-1 measurements**, not
new round-3 results:

| Table | Before rows | After rows | Before row bytes | After row bytes |
|---|---:|---:|---:|---:|
| posts | 50,228 | 1,000 | 13,496,683 | 299,000 |
| reposts | 1,004 | 1,000 | 161,640 | 161,000 |
| owned events | 49,228 | 49,228 | 7,796,444 | 7,796,444 |
| tombstones | 0 | 0 | 0 | 0 |
| follows | 5,921 | 5,921 | 852,624 | 852,624 |
| inbox | 24,555 | 1,000 | 7,938,537 | 327,458 |
| profiles | 1,008 | 1,008 | 357,825 | 357,825 |
| work | 63 | 63 | 22,132 | 22,132 |
| **Whole partition, including other tables** | **171,330** | **98,543** | **35,901,571** | **15,092,169** |

Cold Chromium acquisition: **281,263.9 → 117,812.5 ms (2.387×)**. Full owned
events dominate afterward. Even zeroing posts, reposts and inbox would leave
95,543 rows / 14,304,711 bytes, exceeding the 5× targets. The accepted sync rules
were preserved. The exact scale reproduction, inventory and packed-format
availability at measurement time are in the
[round-1 report](../20260925-bounded-following-r1/REPORT.md).

## Qualification and failures

Final full-suite invocation exits 0: **`== 0 failure(s) in 533 s`**.
Command: `SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh`, from
`snapback4/`. Every section passes: the complete Rust inventory, builds,
documentation budget, package/app checks, fixture wrappers, **1,519 client
passes with 10 existing skips**, the acquisition/server shards, and **78 model
passes** at their original counts/timeouts. Evidence: [test-final.log.gz](test-final.log.gz).
No test was removed or waived. There are no known unresolved routing failures.
The inherited scale and packed-format measurement limitations are documented
above.

The first completed invocation reported **`== 1 failure(s) in 539 s`**:
`client tests` failed with 16 cases. Rust, fixtures, app/package checks and all
78 model tests passed. All 16 failures belong to this change (none were
attributed to the baseline or environment):

| Cases | Count | Resolution |
|---|---:|---|
| `population growth cannot mint new IDs during prediction replay` (wasm/native) | 2 | Correct the overbroad gate so ordinary local partial answers still show predictions; keep the replay assertions unchanged. |
| `retained filters every watched read` (wasm-memory/native-sqlite) | 2 | Preserve locally produced retained partial results; keep authorization assertions unchanged. |
| `MQ prediction … retained history and independent held coverage` (wasm/process) | 2 | Preserve the wholly local composed partial answer when server replacement is fenced; keep its pending-row assertions unchanged. |
| `a current-token sign-out cannot reclassify a stale write refusal` | 1 | An explicitly empty footprint has no write intersection. The no-op no longer suppresses the authoritative sign-out probe; the security assertions remain unchanged. |
| `W13b fallback boundary: pending predictable write` | 1 | Correct the mock's missing read/write footprint; it still proves zero server requests and the original local partial answer. |
| Native and web `page-observation` journeys | 2 | Deliberately update obsolete expectations that a server answer may replace an unobserved resetRead. Now assert loading, no new request, and no stale in-flight publication. |
| `ready list reads survive account restoration…` | 1 | An unexecuted server-only ping cannot bypass the fence merely to detect offline. Fail the held pending transport to establish offline; preserve the unrelated-write fallback control. |
| `finding 2: changes observation drops freshness…` | 1 | Deliberately require loading at reset rather than permit a server replacement during the pending write. |
| `missing early watermark preserves … evidence` (two transfers × two tiers) | 4 | Deliberately require loading instead of E_OFFLINE before the pending prediction is observed; retain every durable-state assertion. |

Focused reruns after these corrections: **32 passed, 0 failed**, followed by
**8 passed, 0 failed**, including the real browser witness. Evidence is retained
alongside the failed full invocation. The final full invocation rebuilt and ran everything from the corrected commits.

An earlier full-suite invocation was deliberately stopped with SIGTERM (exit
143, no summary line) during the Rust phase after the audit found the table/id
separator edge case. Its completed build/typecheck/docs stages passed; it is
not claimed as qualification. The final invocation starts from the corrected,
committed code and rebuilds the package.

Reference audit: `ref-check: ok — 509 LLP docs, 9295 refs in 26148 files,
0 errors, 0 unchecked`. All changed source files are below 1,500 lines (`local.ts`: 1,400; extracted
`local-query.ts`: 186). Wasm remains **1,776,325 B raw / 495,299 B gzip**,
below the unchanged 496,000 B ceiling.

Development failures were ours and corrected before qualification: an
acknowledgment wait that left the new test offline; a wrong client watch method;
a malformed fixture URL containing a space that prevented native installation;
a typed posts ID used for a repost ID test; and a JSON continuation passed as
an engine-issued Quarry cursor rather than application-owned native text.
The three mutation runs failed intentionally as described above. No baseline
failure was waived. All completed full-suite failures are enumerated above and are preserved in
`test-first-complete.log.gz`; none is concealed by a focused rerun.
