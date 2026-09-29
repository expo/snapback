# Failure ledger

All failures listed below are attributed to this lane unless explicitly marked otherwise.

## Setup and before-change controls

- Read-only orientation misses: uninitialized `skills/llp-orient`, absent fleet file, absent candidate cache paths, one non-existent source filename and one empty foundation glob. The LLP submodule was initialized; this Linux host supplied all builds. No fleet credentials were read.
- One initial report-directory command used a repeated `snapback4/` prefix; removed the empty accidental directories and corrected the working directory. One diagnostic check ran outside the temporary app. One Python edit used the same wrong prefix and made no change. One partial-line apply_patch failed without changing files. A final await-boundary invocation used a nonexistent test filename; reran the named case from delivery-fault-matrix.test.mjs.
- Initial fixture runs failed because Quarry cursor parameters do not accept that default spelling and membership inserts require the existing group probe. Corrected the fixture.
- Initial oracle setup leaked the final server image into an early captured world and constructed an invalid empty sync page. Captured actual per-cut query/empty-sync envelopes instead.
- Initial browser setup lacked JSX runtime aliases, recreated query objects every render, and supplied a non-minted local mutation id. Corrected aliases, stable operations, initial peek and mutation options.
- **Baseline, expected controls:** before-change failures are product deficiencies under the newly commissioned contract, not environmental exemptions. See before-react.log and before-oracle.log and the matrix in REPORT.md. All 600 oracle seeds fail only no-loading; all ordering/visibility checks pass.

## Implementation and revised-contract checks

- guide.log: 97 pass / 1 fail, `every_card_introduces_the_feature_before_examples_and_reference_details`: the new introduction had three sentences. Fixed to two; guide-final.log passes 98/98.
- facade-bound-before.log: both retaining options failed the new held-A / changed-B episode test. Fixed by copying the earliest episode to the held answer; facade-bound-after.log passes.
- Initial retention expectations still required plain failures and default plain timeouts to withdraw, or allowed `keep: true` to ignore online evidence. Updated those assertions to the commissioned contract, preserving explicit withdrawals and resets.
- The initial local failure handling also suppressed valid remembered-answer recovery after expiry or on a new offline observation. This was an implementation regression, not a baseline exception. Corrected publication of already-admitted memory; expiry-final.log passes all 71 tests.
- The older authority-render fixture deliberately delayed `keep: true` authority checks beyond a second while requiring no loading under `/changes`. Both policies now share its existing default 5 ms delay. Long bounded reads have explicit withdrawal tests; plain reads have the 3 s render proof.
- The row-expiry typing fixture now holds episode wall time fixed while advancing its independently controlled server clock. It still verifies the original row deadline and non-renewal across member commits.

Initial affected run: every failing test (81; this lane, fixed or updated as above):

- online: kept typing survives member commits and expires during a held re-read
- wasm: kept typing survives member commits and expires during a held re-read
- process: kept typing survives member commits and expires during a held re-read
- createApp keep=true property: online, seed 23, 50ms authority
- createApp keep=true property: online, seed 44, 50ms authority
- createApp keep=true property: online, seed 445, 50ms authority
- createApp keep=true: useQuery and usePage preserve inputs through 20 replacements, loaded cursors and removal
- wasm keep=undefined: displayed expiry fences an older body while preserving newer memory (active)
- process keep=undefined: displayed expiry fences an older body while preserving newer memory (active)
- wasm keep=true: displayed expiry fences an older body while preserving newer memory (active)
- wasm keep=true: displayed expiry fences an older body while preserving newer memory (lingering)
- process keep=true: displayed expiry fences an older body while preserving newer memory (active)
- process keep=true: displayed expiry fences an older body while preserving newer memory (lingering)
- wasm keep: lingering remembered answer survives a device wakeup but expires on the server clock
- process keep: lingering remembered answer survives a device wakeup but expires on the server clock
- wasm keep: expired remembered answer never returns after rollback and released reads (active)
- wasm keep: expired remembered answer never returns after rollback and released reads (lingering)
- process keep: expired remembered answer never returns after rollback and released reads (active)
- process keep: expired remembered answer never returns after rollback and released reads (lingering)
- wasm keep: an older displayed deadline preserves a newer unexpired remembered answer
- process keep: an older displayed deadline preserves a newer unexpired remembered answer
- wasm: a closed raw local observation still latches its episode deadline
- process: a closed raw local observation still latches its episode deadline
- wasm keep: a failure re-read withdraws before the displayed deadline
- process keep: a failure re-read withdraws before the displayed deadline
- online keep: a failure re-read withdraws before the displayed deadline
- replacement completes and clears revalidation: keep=undefined, "B"
- replacement completes and clears revalidation: keep=undefined, null
- replacement completes and clears revalidation: keep=undefined, []
- replacement completes and clears revalidation: keep=undefined, {"denied":{"code":"HIDDEN","family":"rule","message":"hidden"}}
- hard withdrawals replace retained data: keep=undefined, throw
- hard withdrawals replace retained data: keep=undefined, transportOffline
- hard withdrawals replace retained data: keep=undefined, retryExhausted
- hard withdrawals replace retained data: keep=true, throw
- hard withdrawals replace retained data: keep=true, transportOffline
- hard withdrawals replace retained data: keep=true, retryExhausted
- one stable episode withdrawal at the deadline via snapshot, late success still lands
- one stable episode withdrawal at the deadline via peek, late success still lands
- one stable episode withdrawal at the deadline via timer, late success still lands
- successful fallback and held composition keep the same episode: keep=undefined
- facade and opening remount share source transportOffline, keep=undefined
- facade and opening remount share source transportOffline, keep=true
- facade inherits A's episode timestamp from the invalidation, through B and C authority
- an early episode timer rearms to the original deadline without accessor help
- facade withdrawal notifies once, including an opening remount, keep=undefined
- an episode due inside a grouped commit waits until the settled peer is revalidating
- online raw: offline withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- online raw: offline withdraws both peers before every callback, keep=true, peerKeep=true
- online raw: offline withdraws both peers before every callback, keep=false, peerKeep=undefined
- online raw: offline withdraws both peers before every callback, keep=undefined, peerKeep=false
- online raw: offline withdraws both peers before every callback, keep=false, peerKeep=true
- online raw: offline withdraws both peers before every callback, keep=true, peerKeep=false
- online guard: offline withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- online guard: offline withdraws both peers before every callback, keep=true, peerKeep=true
- online guard: offline withdraws both peers before every callback, keep=false, peerKeep=undefined
- online guard: offline withdraws both peers before every callback, keep=undefined, peerKeep=false
- online guard: offline withdraws both peers before every callback, keep=false, peerKeep=true
- online guard: offline withdraws both peers before every callback, keep=true, peerKeep=false
- online opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=undefined
- online opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=false
- online opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=true
- wasm raw: offline withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- wasm raw: offline withdraws both peers before every callback, keep=true, peerKeep=true
- wasm raw: offline withdraws both peers before every callback, keep=false, peerKeep=undefined
- wasm raw: offline withdraws both peers before every callback, keep=undefined, peerKeep=false
- wasm raw: offline withdraws both peers before every callback, keep=false, peerKeep=true
- wasm raw: offline withdraws both peers before every callback, keep=true, peerKeep=false
- wasm guard: offline withdraws both peers before every callback, keep=undefined, peerKeep=undefined
- wasm guard: offline withdraws both peers before every callback, keep=true, peerKeep=true
- wasm guard: offline withdraws both peers before every callback, keep=false, peerKeep=undefined
- wasm guard: offline withdraws both peers before every callback, keep=undefined, peerKeep=false
- wasm guard: offline withdraws both peers before every callback, keep=false, peerKeep=true
- wasm guard: offline withdraws both peers before every callback, keep=true, peerKeep=false
- wasm opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=undefined
- wasm opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=false
- wasm opening remount: offline withdraws both peers before every callback, keep=true, peerKeep=true
- schema discovery withdraws an overlapping invalidation: keep=true
- online link loss withdraws a live settled answer immediately, keep=undefined
- online link loss withdraws a live settled answer immediately, keep=true
- usePage checks first page deadline before cached return without timer delivery
- usePage checks second page deadline before cached return without timer delivery

The next affected run passed 908/912. Four additional old expectations in
`approval-lifecycle.test.mjs` still assumed a default plain timeout:

- closed facade follows same identity's revalidation, close before=false, default;
- closed facade follows same identity's revalidation, close before=true, default;
- closed captured episode enforces its deadline with an unbounded source copy, close before=false;
- the same captured-episode case, close before=true.

These are ours: the fixture now names bounded evidence explicitly and tests
both plain and bounded close paths for both retaining policies. The corrected
file passes 51/51 in approval-lifecycle-final.log.

Full-suite outcome and individual failures follow after completion.

## Further corrections found by the full run

- **Ours, implementation:** the failed-result branch skipped scheduling a future
  local wakeup when there was no retained data. `expiry retry chained permits`
  failed on process and wasm. Restore the existing scheduling whenever the watch
  is not keeping data. Both cases pass in `full-fixes.log`.
- **Ours, contract expectations:** the offline remembered-branch timer cases
  still waited for `revalidating` to clear on recovery from offline memory. The
  replacement stays marked while waiting for server revalidation. Both pass in
  `full-fixes.log`; value, identity, wakeup, publication count and expiry assertions
  remain in place.
- **Ours, test expectations:** twenty local-commit cases in `answer-withdrawal`
  required the removed default episode. They now distinguish local commit
  retention from later online evidence, preserve explicit unavailable results,
  and still verify the real removed rows and final null replacements. Two
  intermediate retry-exhaustion assertions also needed to account for the
  predicted mixed read's existing explicit unavailability; those failed in
  `withdrawal-final.log` and `withdrawal-final2.log`. All 42 tests now pass as
  part of `full-fixes.log`.
- **Ours, test expectations:** three W8R1a seam tests intended immediate
  withdrawal but relied on omission. They now request `keep: false` explicitly;
  `seams-final.log` passes 3/3. The new default render tests cover retention.
- **Ours, test expectations:** two delivery-approval episode fixtures now
  explicitly inject bounded evidence with `reload(true)`; both pass in
  `full-fixes.log` without changing collection/approval checks.
- **Ours, fixture checksum:** `every delivery await is explicitly classified`
  detected the changed text inside online `await watch.fetch(...)`'s acceptance
  callback (deadline scheduling excludes transport failure). There are still
  58 awaits in client.ts; no await added, removed or moved. Updated only that
  entry's hash in the existing boundary record; site recipes are unchanged.
  `delivery-boundary-final.log` passes.

## Additional full-run fixes

- **Ours, ordering recovery regression:** eight process/wasm presence cases exposed immediate freshness copying before ordered memory selection, plus failure classification hiding an explicit absent-memory replacement. Server-backed watches now retain while the original recovery procedure selects its result. Absent memory still replaces; no ordering mechanism or presence assertion changed. All presence cases pass in `ordering-fixes.log`.
- **Ours, test expectations:** two probe store-reset tests counted the preceding transport outage as if the probe had already detected replacement. Assertions now require an unbroken terminal denial from its first publication onward, while allowing only revalidating data before detection. Other reset paths keep the original every-notification withdrawal assertion.
- **Ours, test expectations:** two raw-handle episode fixtures now inject bounded evidence explicitly; the catch-path unit case expects retained data for plain transport failure. Explicit loading, denial and reset assertions remain.

## Exact full client failure titles

All 43 are **ours**, fixed in the scoped reruns recorded above; none is classified as baseline or environmental. Legacy titles below are copied verbatim from the log.

- `wasm: apply revocation, keep=undefined, held`
- `wasm: admit revocation, keep=undefined, held`
- `wasm: transfer revocation, keep=undefined, held`
- `wasm: apply revocation, keep=undefined, throw`
- `wasm: admit revocation, keep=undefined, throw`
- `wasm: transfer revocation, keep=undefined, throw`
- `wasm: apply revocation, keep=undefined, unavailable`
- `wasm: admit revocation, keep=undefined, unavailable`
- `wasm: transfer revocation, keep=undefined, unavailable`
- `wasm: admit revocation, keep=undefined, retryExhausted`
- `process: apply revocation, keep=undefined, held`
- `process: admit revocation, keep=undefined, held`
- `process: transfer revocation, keep=undefined, held`
- `process: apply revocation, keep=undefined, throw`
- `process: admit revocation, keep=undefined, throw`
- `process: transfer revocation, keep=undefined, throw`
- `process: apply revocation, keep=undefined, unavailable`
- `process: admit revocation, keep=undefined, unavailable`
- `process: transfer revocation, keep=undefined, unavailable`
- `process: admit revocation, keep=undefined, retryExhausted`
- `W8R1a online server-run observations retain nothing during a replacing fetch`
- `W8R1a native server-run observations retain nothing during a replacing fetch`
- `W8R1a web server-run observations retain nothing during a replacing fetch`
- `createApp online: episode expiry before approval never collects`
- `createApp local: episode expiry before approval never collects`
- `every delivery await is explicitly classified`
- `expiry retry chained permits wasm`
- `expiry retry remembered branch timer watch wasm`
- `expiry retry chained permits process`
- `expiry retry remembered branch timer watch process`
- `probe: replacement is terminal for all reads and writes`
- `probe: regression is terminal for all reads and writes`
- `wasm: an accepted background reply does not replace a newer answer another read remembered`
- `wasm: a refusal read at a later store cut outranks an answer remembered before it landed`
- `wasm: a read retried after its store changed takes a new place in the order`
- `wasm: an accepted background reply does not undo a newer read's deletion of an absent answer`
- `process: an accepted background reply does not replace a newer answer another read remembered`
- `process: a refusal read at a later store cut outranks an answer remembered before it landed`
- `process: a read retried after its store changed takes a new place in the order`
- `process: an accepted background reply does not undo a newer read's deletion of an absent answer`
- `closing a raw local handle stops its episode timer but keeps the deadline`
- `resubscribing a raw local handle rearms its original episode deadline`
- `one replacing fetch ends retention: failure`

Final staged whitespace check flagged test-runner padding in raw logs (**ours**, formatting only). Trailing spaces and extra blank EOF lines were normalized; test output, assertions and summary lines are unchanged.

## Full-script summary

Exactly once: `== 2 failure(s) in 1459 s`, exit 1. Failed stages: `cargo test` and `client tests`. The sole Rust failure is `every_card_introduces_the_feature_before_examples_and_reference_details` (**ours**, corrected two-sentence introduction; whole guide 98/98). The 43 exact client titles above are **ours** and pass after the recorded fixes. Baseline failures: **0**. Environmental failures: **0**. Client models: **79/79**. No second full run or green-full-suite claim.
