# Failure ledger

No unexpected failure below is exempted as baseline merely because a rerun
passed. Product and fixture regressions introduced while implementing this lane
are classified **ours**, including timing assumptions invalidated by the new queue.

## Product and test correction runs — ours

- The initial package build failed at local.ts's callbacks to localReadDeadlines
  and refreshSearchRoots: the queued scheduling function returned void where
  the helper type required Promise<void>. The helpers never awaited it; changed
  those callback types to void and rebuilt. Two build attempts encountered the
  same pair of diagnostics; no test ran behind the failed `&&`.
- `affected-first.log`: 503 tests, 500 pass, two fail, one timeout/cancelled.
  `Grok: 400 unrelated receipts do not visit all 400 online observations` failed
  its immediate gap-withdrawal notification assertion. `wasm: resubscription
  delivers saved row expiry without an accessor, keep=false` failed immediate
  loading. Moving reload/notification before the queued evaluation fixes both;
  their original assertions were retained.
- The third first-run failure was `Astra 5 browser wasm: builder profile gate
  survives another profile update and unrelated mutation` (30-second timeout).
  It deliberately used an empty sync to cause revalidation. Empty sync now does
  no known-query work. The fixture now writes the same public profile then
  syncs, preserving the real retention, route, draft, expiry and overlap checks.
- `affected-correction.log`: 201 tests, 200 pass / one fail. The rewritten browser
  fixture referenced API_URL twice, but its substitution replaces only the first.
  The added occurrence now uses options.url. `counts-third.log` then passes all
  eight tests, including both browser gates and the six count tests.
- `counts-first.log`: online initial mount counted 1,007 instead of 1,000 because
  the first authority cut retired seven already-started peers. The count fixture
  now warms that initial cut before mounting and counts the stable observation
  workload. Performance records keep real startup retry counts.
- `counts-second.log`: wasm fixture omitted Node's explicit wasm bytes and tried
  to fetch a file URL (unsupported); supplied local bytes. Process relevant
  apply counted 1,032 instead of 1,000, exposing duplicate apply/final-sync work;
  fixed warm apply to notify immediately and evaluate at the final touched-table
  drain, after the watermark is installed. Cold progressive apply remains.
- Source review found the initial/input guards needed to run before reload in
  the scheduling wrapper too. Restored those checks and added a real invalid
  argument owner to both device count cases. `counts-final.log` first exposed a
  test ordering error: process's empty-apply count included 171 peer evaluations
  still reconciling the preceding evaluated input denial. The test now waits for
  that reconciliation before zeroing its counter. `counts-final-corrected.log`:
  all six pass with unchanged N, exact work counts and timeouts.
- `affected-final.log`: 952 pass / zero failed or cancelled, including all 333
  delivery fault checks, retention/fence/expiry/ephemeral/property tests and
  overload tests. This precedes the final scheduling input/terminal guard
  correction; the final count and full-suite records qualify that correction.

## Measurements and intentional controls

- Original baseline online 1,000-page workload exceeded its 120-second write
  visibility deadline (`baseline-browser.jsonl`). Baseline point workload sent
  139,711 requests for a single relevant write. These are baseline performance
  reproductions, not green qualification. Fixed simple point/page cells finish.
- Isolated baseline controls: four expected assertion failures
  (`baseline-controls.log`): canonical key order does not share; online exceeds
  eight in flight; empty wasm apply executes 1,000 queries; empty process apply
  executes 1,000 queries. The isolated copy uses the original client/local/watch
  implementation and current unchanged device artifacts. No active SDK mutation.
- First ChatRail sequence: online N=500 and N=1,000 timed out at mount.
  Classified ours until fixed, not environmental. The exact N=500 shape passes
  on a fresh backend (`chat-diagnostic.jsonl`), but sequential cells reproduced
  the overload (`chat-online-sequence.jsonl`). `chat-sequence-trace.jsonl` traces
  6,008 schedules to the clock sweep in a diagnostic 10-second interval. Every
  clock-offset correction refreshed every observation, even without deadlines.
  The clock fix checks all deadlines but evaluates only due owners. The isolated
  fixed bundle (`chat-clock-fix.jsonl`) and final copied ChatRail matrix complete
  all sizes. `chat-prefill-*.jsonl` are diagnostic controls, not final timings.
- `clock-baseline-control.log`: the fifth intentional **baseline** failure. The
  original expiry sweep evaluates all 1,000 non-due owners; final test expects zero.

## Harness/setup corrections — ours unless stated otherwise

- Several read-only orientation lookups used guessed paths (`online.ts`,
  `react.ts`, `local-observations.ts`, server/http source names). Located the
  actual files with rg. The LLP skill symlink was initially unpopulated; the
  pinned `vendor/llp` submodule was initialized and its skill read.
- Fleet file at the documented Dropbox path is absent on this Linux host
  (environmental discovery limit). Existing local toolchains/browser were used;
  no shared tool installation.
- One shell command used repository-prefixed paths while already in snapback4;
  it could not create the benchmark runner or edit the provider name. Reissued
  from the correct directory. The browser uses SnapbackProvider.
- First process smoke omitted processDevice's required dir; supplied a directory
  within the fixture. Baseline-smoke record preserves that error.
- Initial browser CPU binding attempted a nonexistent removeExposedFunction,
  then subsequent cells could not register the binding again. baseline.jsonl
  preserves those harness errors; baseline-browser.jsonl reruns the browser
  matrix with one binding and a current CDP session. Successful original process
  baseline cells in baseline.jsonl remain usable.
- The copied Quarry fixture's leading `//` comment was refused with
  E_QUARRY_UNSUPPORTED; changed it to Quarry's `--` before measurement.
- First isolated-control setup guessed a package-local TypeScript path that Bun
  had hoisted. Resolved TypeScript through createRequire(package.json) and ran
  the four intended controls.

## Full suite — one invocation, all 23 client failures ours

Exact summary: `== 1 failure(s) in 1397 s`; exit 1; failed phase: `client tests`.
Its main client runner: 4,818 tests, 4,785 pass, 23 fail, 10 skipped. Separate
acquisition/server shards in the same invocation passed. The final serial model
phase passed 79/79. Rust, whole-guide, builds, budgets, guard, typechecks and
fixture phases passed. No second full run is claimed.

The ephemeral-capability test hung because a direct query stole the first-request
gate before the queued observation started. After 430 seconds I sent SIGTERM to
that single owned child so the suite could finish. Its exact test-level gate now
waits for the watch request before issuing the direct query. All other failure
names below are assertions reported by the completed invocation.

| Cases | Cause and correction |
|---|---|
| ephemeral-capability file | Wait for the queued watch to own its first-request gate. |
| expired-server-watch, seven cases | Timer instrumentation mistook the queue's zero-delay yield for expiry backoff. It now measures positive retry timers; the exact 25..1,000 ms progression, single flight and shutdown assertions remain. |
| expiry-retry-watch, six cases | Queue wrapper plus evaluator both emitted reload notifications. Reload remains synchronous in the wrapper; evaluator does not repeat it. |
| README examples | New TSX block needed imports, prop types and matching generated API fixture types. |
| private staging | Empty private applies no longer evaluate known owners. Test now requires zero reads/notifications while retaining published-identity, final publication and no-adoption assertions. |
| retained-history, four cases | Duplicate reload notifications published an extra loading/revalidating snapshot; corrected as above. |
| server-clock-regressions, three cases | Same duplicate mark notification; original count assertions retained. |

Exact names (each **ours**):


- packages/snapback4/test/ephemeral-capability.test.mjs
- expired server replies: recover, keep=undefined
- expired server replies: recover, keep=false
- expired server replies: recover, keep=true
- expired server replies: close watch, keep=false
- expired server replies: close client, keep=undefined
- expired server replies: close client, keep=false
- expired server replies: close client, keep=true
- expiry retry populated watch wasm
- expiry retry remembered branch watch wasm
- expiry retry remembered branch timer watch wasm
- expiry retry populated watch process
- expiry retry remembered branch watch process
- expiry retry remembered branch timer watch process
- README TypeScript examples compile and call every public function
- private commits rerun the published image without adopting the staged identity
- MQ expiry local watch left wasm: retained history and independent held coverage
- MQ local permit watch wasm: retained history and independent held coverage
- MQ expiry local watch left process: retained history and independent held coverage
- MQ local permit watch process: retained history and independent held coverage
- remembered wakeup retains data until its own server deadline (null, early=false)
- remembered wakeup retains data until its own server deadline (null, early=true)
- remembered wakeup retains data until its own server deadline (600, early=false)

## Post-suite correction runs — ours

- `full-failures-rerun.log`: 131/133. The private-staging fixture had not yet
  been updated. `MQ delete current process: retained history and independent
  held coverage` also timed out awaiting publication. Classified **ours**
  conservatively; no proven baseline/environmental exemption. It passed alone
  unchanged (`retained-delete-isolated.log`), and the entire retained-history
  file plus corrected private-staging tests passed 71/71
  (`retained-history-final.log`). Final broad qualification repeats both.
- `affected-post-clock.log`: 1,292/1,317, 25 failures. One was the gap notification
  regression (`Grok: 400 unrelated receipts do not visit all 400 online
  observations`): suppressing same-snapshot notifications suppressed a required
  already-withdrawn loading signal. Restored synchronous notifications; async
  evaluator still does not duplicate reload. The other 24 were fixtures using a
  non-due clock correction as an unconditional refetch trigger: all 18 adoption
  cases (online/wasm/process × default/keep=true × inspect/close/remount), and all
  six newer-replacement clock cases (wasm/process × default-active/keep-active/
  keep-lingering). No deadlines, withdrawal or stale-body assertions were removed.
- Adoption now uses the server's refresh interval; `keep-adoption-final.log`:
  20/20. Clock replacement starts the held watch through sync and uses a server
  refresh interval after the old reply. The first adjustment still waited for an
  incidental clock-triggered retry: `last-corrections.log` 101/107, the same six
  cases failed. A subsequent attempt used another sync, which legitimately
  applied B's unseen write and withdrew the answer: `keep-clock-final.log` 35/41,
  the same six cases failed. The final interval trigger avoids introducing that
  unrelated authority cut; `keep-clock-refresh-final.log` passes 41/41.
- A second path-prefixed edit command was run from inside snapback4 and failed
  before changing files. Reissued from the repository root; an incidental count
  run before the edit passed six old cases (`clock-counts.log`). The corrected
  count and private-staging run passes 10/10 (`clock-counts-final.log`).

Final combined qualification and any final failures are recorded in REPORT.md.
All original failures are preserved in the raw logs; no timeout or model sequence
count was relaxed. Diagnostic performance-only PQ_TIMEOUT runs are labelled and
are not qualification or production defaults.

## Final qualification and baseline disposition

- `qualified-tests.log`: 1,424/1,431. Six are the already-listed newer-replacement
  clock cases; that process loaded the intermediate fixture before its final
  refresh adjustment. `final-followups.log`: 55/55, comprising the final 41 clock
  cases, seven count cases and seven example tests. The seventh broad failure,
  `wasm: keep remount lifetime, isolation, last subscriber and sign-out`, timed
  out at `second key ready`. This is now **proven baseline**: the diagnostic
  current copy fails on iteration 5; the original SDK copy fails identically on
  iteration 4. The separate entire file passes 31/31, but the issue remains open.
  `baseline-proof.json` verifies exact original compiled bytes for all five
  restored modules. Ticket: `issues/20260929-snapback4-keep-remount-second-key.md`.
- The committed reproducer's first setup attempt omitted the isolated package's
  `#fetch` import mapping (`keep-reproducer-baseline.log`, **ours**, no product
  test executed). Copying package.json fixes it; the reusable script reproduces
  the same **baseline** timeout on iteration 1
  (`keep-reproducer-baseline-fixed.log`).
- Adding the measured mount times made the client card 132 lines, above its
  existing 130-line cap. `guide-qualified.log` and `guide-complete.log` each show
  97/98: `client::client_aliases_keep_typing_on_ephemeral` failed (**ours**).
  The attempted edit before the second run used a root-prefixed path from the
  Snapback 4 directory and did not apply. Removing two redundant example comments
  preserves the content and cap. `guide-complete-final.log`: 98/98.
- Read-only final source search included an unmatched nested src glob; the direct
  ChatRail source and run-log matches were returned and verified. No source or
  evidence file in the comparative was modified.

- The staged whitespace audit found Node assertion output with trailing spaces
  and guide logs with a final blank line (**ours**, evidence formatting). Log
  whitespace is normalized; test content and exact summary lines are preserved.
