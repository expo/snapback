# Lane U round 7: speculative withholding and retained composition

2026-09-25. Based on `5ba0a6087`, on `sb4-intent/u-bounded-following`.
Read all four requested reviews: U-r6 Astra and Grok, Z-r1 Astra and Grok.
Implementation commit: `633e566fc`; boundary-witness correction: `f6dd23f3e`. This report supersedes round 6's
fenced-and-held exception. No push or publication.

## Numbered procedure and coverage

| Rule | Implementation and tests |
|---|---|
| 1. Session/incarnation | Unchanged checks after awaits and immediately before publication, including the local-commit authority fence. `query-publication-session.test.mjs` tests real-client sign-out/close during local execution, dispatch, transport, delivery and final publication. Router tests additionally interleave both refusals during delivery/publication and remembered recovery. |
| 2. Known complete local wins | Unchanged local-first routing, regardless of `runs`; narrow dependencies only for `unknown === false && complete === true`. Quarry/native and held/ordinary complete-branch controls, real known Following branches, untaken held card branches, and both 8,193-event scalar-cut cases still pass. |
| 3. Engine withholding | Unchanged engine unavailable/unexecutable decision, original-argument fallback, offline/prediction/held precedence, and loading after failed transport. Existing card, repost, inbox floor, meter prefix, native reset/install and meaningful native cursor tests remain. |
| 4. Available unknown values | Removed the query-wide held exception. Speculative data **and refusals** load while fenced; otherwise they recover unexpired memory or E_OFFLINE/watch loading. Non-speculative unknown results remain partial data, including pending rows. Independent retained components preserve their local composite value offline or after failed transport, with no whole-answer memory. New actual wasm/native tests run all three review reproductions; `withProfile` now loads under the fence while the non-speculative `partialWithProfile` keeps its predicted row. Actual wasm/process retained-point tests preserve 25 left-history rows beside a speculative right null. Direct routing tests cover legacy held metadata, speculative refusal recovery, and retained composition with/without a fence and failed transport. |
| 5. External answer landing | Existing session, fence, expiry and freshness gates remain. Four new delayed-response tests cross the deadline during transport or final publication, separately exercising server and composed candidates. The exact requested mutation restricting expiry rejection to remembered data fails all four tests. Existing late prediction, remembered-answer races, permit expiry, original-since and caughtUp/identityChecked tests remain. |

Every publication path in `local-query.ts`:

| Path | Fence evidence |
|---|---|
| Server data | `rule 5: prediction arriving at delivery/publication`; original/native cursor tests; new server deadline cases. |
| Remembered data | Recovery/publication prediction/sign-out/close interleavings; speculative refusal and legacy-held matrix. |
| Local unknown | New real guarded/conditionalEvents/filteredEvents probes load under the fence; non-speculative partialWithProfile keeps the prediction; retained compositions use component coverage. |
| E_OFFLINE | Placeholder-without-memory controls and remembered recovery/publication interleavings; a fenced speculative refusal loads instead. |
| Server refusal/loading | Existing composed E_BOUND/application-refusal/loading × fenced/unfenced tests; real wasm/process authoritative-bound controls. |
| Composed external data | Existing late-prediction composition controls; new delayed composed deadlines; independent retained components never enable whole-answer memory. |
| Local known data/refusal | Local-first complete-branch and known-meter-prefix controls; no server replacement. Session and freshness publication checks remain. |

## File by file

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `packages/snapback4/src/local-query.ts` | Keep the five rule numbers; delete the fenced/held exception and its sticky client state. Only component `retained` coverage can preserve speculative local composition; refusals cannot enter that data path. |
| `crates/snapback4-core/src/engine/components.rs` | Remove unused `held` provenance from query/component facts. Keep `speculative`, retained coverage, unknown facts and metering unchanged. |
| `crates/snapback4-core/src/engine/read.rs` | Remove point/scan held marks, including the pre-filter sticky mark. No row scan or authorization behavior changes. |
| `crates/snapback4-device/src/call.rs` | Stop emitting the unused held provenance field. Existing query-declaration `held`, partition held-state and retained history are unrelated and unchanged. |
| `crates/snapback4-device/tests/components.rs` | Remove held-bit expectations; retain speculative/retained, empty/scalar, both-store and exact meter-differential assertions. |
| `crates/snapback4-device/tests/search_merge/round2.rs` | Adjust exact component envelopes for the removed field. |
| `crates/snapback4-device/tests/uniform_word_expansion/mod.rs` | Remove held-bit assertions; keep the complete device-envelope meter-boundary oracle. |
| `packages/snapback4/test/bounded-following.test.mjs` | Execute guarded refusal, unrelated held point before conditionalEvents, and online-only eventSwitch scan filter on wasm/native. Replace the intentionally superseded withProfile expectation; add a non-speculative partial profile scan that preserves the predicted feed row online/offline. Remove unused native held-bit assertion. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Update old-device held/fenced expectations; add speculative refusal, retained/speculative composition and four delayed server/composed expiry cases. |
| `packages/snapback4/test/retained-history.test.mjs` | Actual wasm/process retained left-page + speculative right-point regression, offline and failed fallback; update exact coverage envelopes. |
| `packages/snapback4/test/residency.test.mjs` | Remove held-bit assertions while preserving real wrapped-presence/projected-row and permit-expiry coverage. |
| `packages/snapback4/test/page-authority.test.mjs` | Remove only the unused held-bit assertion; keep private-row and speculative/unknown assertions. |
| `packages/snapback4/test/fixtures/page-observation.mjs` | Timestamp publications and assert withdrawal at the actual injected expiry, rather than treating valid pre-deadline retention as expired data. Keep blocked-fetch, prediction, offline, React hooks and account-switch assertions. |
| `packages/snapback4/test/store-reset.test.mjs` | Wait for the device to adopt the replacement identity, rather than treating a query answered during reacquisition or the last HTTP arrival as proof of adoption. |
| `packages/snapback4/test/word-expansion.test.mjs` | Adjust the exact wasm meter-cut envelope to the removed field. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Three reference lines state speculative withholding, independent retained composition, and unchanged session/fence/expiry/freshness gates. |
| `reports/20260925-bounded-following-r7/mutations.py` | Reproducible expiry-only-memory, restored held exception and discarded retained-composition mutations, with unconditional module restoration. |
| `reports/20260925-bounded-following-r7/*.log.gz` | Qualification and mutation evidence. |
| `JOURNAL.md` | One dated append-only entry. |

## Forms exercised

No new spelling or refusal code. Existing forms are compiled and executed on both device tiers:

```quarry
query guarded():
  ignored = notes[id = 'n2']
  return audit[id = 'a1'] ! else NOT_FOUND
query conditionalEvents():
  held = posts['p3']
  if exists eventSwitch['gate']:
    return feedPosts last 10 by .at
  return []
query filteredEvents():
  return feedPosts last 10 by .at where exists eventSwitch['gate']
```

With audit/eventSwitch online-only and an intersecting unobserved prediction,
all three publish exactly loading. Warm server memory cannot bypass that fence.
The raw device refusal or empty page remains unknown/speculative.

```quarry
query retainedPoint():
  return {left: messages['left'] last 50 by byTime, right: messages['held-0']}
```

After leaving left, the retained 25-row page remains in the local composite,
with right null, offline and after transport failure. The server's earlier
whole answer cannot replace it. A non-speculative horizon scan beside a feed
similarly preserves predicted rows as partial data; no value-shape inference.

## Review disposition and explicit limits

- All three named U/Z publication reproductions and Astra's retained-composition
  gap are fixed. No value-level provenance was introduced. Removing the unused
  held fact is the optional simplification permitted by round 7; no production
  consumer remained after removal of the exception.
- **Grok U-r6's first Medium proposal is superseded by the explicit round-7
  instruction.** Restoring local speculative values merely because another read
  was held reopens `guarded`, `conditionalEvents` and the rejected-row filter.
  For example, notes[n2] succeeds, audit[a1] is an online-only speculative miss,
  and NOT_FOUND must not become authoritative. This round intentionally changes
  the prior withProfile/pending test to loading, and separately preserves the
  non-speculative partial-page case.
- **Stopped Grok U-r6's second Medium proposal (split row and authorization
  deadlines).** The accepted round-6/7 procedure rejects expired external data
  using nextExpiry, and the current wire carries no reason for that deadline.
  A client-only soft-expiry exception would weaken disclosure: let an online-only
  secret have no expiry and be readable through `exists permits[viewer]`, with
  that permit expiring at T. The remembered answer contains only the secret and
  nextExpiry=T. Keeping it after T discloses a row the server now denies. Neither
  a returned row's shape nor another still-live row proves the deadline was not
  an authorization witness. Grok proposes a separate engine signal; that changes the accepted deadline
  contract and needs the supervisor's design decision. It is not inferred or
  implemented here, and this report does not claim that finding fixed. The
  current conservative behavior withdraws an entire external page at its first
  known deadline, including still-live rows, until reevaluation can answer.
  Reproduction of that availability limitation: cache an online-only two-row
  page with nextExpiry=T, disconnect, query after T => E_OFFLINE; its watch loads.
  The real expiring-permit test and delayed-response tests prove why retaining
  an indistinguishable authorization-dependent answer is unsafe.
- Lane Z's event-slot snapshot/aggregate mutation findings belong to Z's code
  and are not present in this worktree; this round implements the shared client
  routing findings. No event-slot implementation was copied into U.
- No parser, admission, acquisition, storage-format, index, authorization,
  metering ceiling, package-version, history-window or scheduling-policy change.
  No increased timeouts, reduced model counts or new skipped tests.

## Qualification

Final full suite: **`== 0 failure(s) in 1528 s`**, exit 0.

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
taskset -c 0-15 env SNAPBACK4_RUST_TEST_PROCESSES=8 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 bash scripts/test.sh
```

Evidence: `test-final.log.gz`. Rust passed in **200 s**; all **1,653 client
tests passed, zero failed, ten existing skips**, in **1,085 s**; all **78 model
tests passed** in **232 s**. Both unchanged **5,000-sequence** session models
preserved I1–I13. Builds, docs/release guards, app/package typechecks and fixture
wrappers passed. The built-in serial-client mode includes the 34 acquisition/
server cases in the main client count instead of parallel shards. No test was
removed, newly skipped, reduced, or given a larger timeout. No final failures
and no baseline/environmental waiver.

Focused Rust: components 9 + search_merge 12 + uniform_word_expansion 10 =
31 passed, zero failures. Native CLI rebuilt. Router: 91 passed, zero failures.
Final reference audit: `ref-check: ok — 509 LLP docs, 9296 refs in 26157 files,
0 errors, 0 unchecked`. All edited source files stay below 1,500 lines.
Wasm: 1,769,867 bytes raw / 494,617 gzip, below the unchanged 496,000 budget
(1,383 bytes headroom; 1,081 gzip bytes less than round 6).

The requested `origin !== "local"` → `origin === "remembered"` mutation fails
all four new delayed server/composed expiry tests. Restoring held-based recovery
and discarding retained compositions also fail their focused regressions.
Mutation logs are committed; the built module is restored after each mutation.

Focused client compatibility run: 136 passed, one failure (ours): the wasm
word-expansion meter-boundary test still asserted the removed `held` field.
Removed that stale assertion and retained the complete remaining-envelope
comparison; the corrected word-expansion file passes 17/17. All new real-device
regressions passed in the original focused run.

Development command error (ours): the first Rust invocation named search_merge
and uniform_word_expansion as test targets; they are modules of `--test device`.
Cargo refused before running tests. Corrected commands above passed. The baseline
log ends `== 1 failure(s) in 276 s` (cargo test); it is not used as a waiver.

First full run: **`== 1 failure(s) in 992 s`**, exit 1: the client-test
phase (1,617 passes, two failures, ten existing skips). Rust passed in 489 s;
all 78 model tests passed in 315 s; all other phases and the 34 client shards
passed. Evidence: `test-first.log.gz`.

Full-run client failures (ours to resolve for qualification, no baseline or
environmental waiver):

- `web IndexedDB device withdraws expired inbox data in useQuery and usePage`:
  the round-6 fixture began rejecting all data before the injected deadline.
  The assertion could reject legitimate pre-expiry retention. Record
  each publication timestamp and check no data at/after the actual deadline;
  the real device and both React hooks must still load while recovery is blocked.
- `sync store identity survives a server restart; a live client detects an
  equal-watermark replacement`: a query can obtain B from the server before
  acquisition finishes; the last recorded HTTP reply is not necessarily the
  device's adopted identity. Wait for acquired device sync_state with the new
  store ID and still assert fresh/complete B rows, equal watermark, persisted
  restart identity and old-cursor protocol behavior. No timeouts increased.

Both corrected boundary files passed together (6 tests), followed by both
expiry cases on the final fixture (2 tests). The final fixture
also reserves its injected deadline before decoding the response, preventing
concurrent requests from arming different deadlines for one observation.

Second full run: **`== 1 failure(s) in 758 s`**, exit 1: three client
resource/deadline failures (1,616 passes, three failures, ten existing skips).
Both corrected first-run checks and all new regressions passed. Rust passed
in 320 s and all 78 models passed in 245 s. Evidence: `test-second.log.gz`.

The three second-run failures are **environmental contention**, corroborated
by unchanged isolated passes in `resource-check.log.gz`:

- `native: maximum pending ids (232), cursor batches and every terminal
  acknowledgement`: the 30-second drain wait expired in the concurrent run;
  isolation completed in 21.846 s with all 232 acknowledgements and terminal
  writes, across five cursors.
- `wasm action: rejected fetch after dispatch is pending; close=false`:
  fixture-server startup exceeded five seconds; unchanged isolation passed
  in 0.446 s.
- `failed persistence discards the device before either transport can send an
  undurable admission`: fixture-server readiness exceeded five seconds;
  unchanged isolation passed in 1.417 s.

The final complete run uses the suite's existing
`SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1` mode. It runs every client file,
including full acquisition/server files instead of their parallel shards,
and the unchanged 78 model tests. No timeout or test-count change and no
product workaround for resource contention. The serial client phase passed
1,653 tests with zero failures and the same ten existing skips, in 1,085 s.
All six 232/233/256 pending-id cases passed on both tiers; the native 232-id
case took 3.186 s in that run.

## Inventory continuity

This round changes routing and reply metadata, not acquisition. No new scale or
packed-IndexedDB measurement is claimed. The existing round-1 inventory remains:
171,330 → 98,543 rows; 35,901,571 → 15,092,169 raw row bytes; real cold Chromium
281,263.9 → 117,812.5 ms (2.387×). The original 5× target remains unmet; fully
synced events dominate (49,228 rows, 7,796,444 bytes). The full table and browser
measurement reproduction are in `../20260925-bounded-following-r1/REPORT.md`
and that directory's `measure.mjs`. No packed-storage claim is inferred.


Reproduce the focused checks from `snapback4/` after the normal dependency,
wasm and package builds:

```sh
cargo test -p snapback4-device --test components
cargo test -p snapback4-device --test device search_merge
cargo test -p snapback4-device --test device uniform_word_expansion
node --test packages/snapback4/test/prediction-routing.test.mjs
node --test --test-concurrency=1 packages/snapback4/test/bounded-following.test.mjs packages/snapback4/test/retained-history.test.mjs
python3 reports/20260925-bounded-following-r7/mutations.py
```
