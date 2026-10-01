# PRL round 1 — subscriber isolation and host turns

Read both complete round-0 reviews (`~/sb4-intent/reviews/prl-r0.astra.md` and
`prl-r0.grok.md`) and the original prompt/report. Fetched and merged
`origin/main` at `3572852132` before editing, in `ca985cb431`. Kept both journal
histories and all main changes, including RY's receipts implementation and WB's
test updates. The only merge conflict was the append-only journal.
[Environment](environment.json) records the identities and toolchain.

## Corrections and controls

The runtime change remains in two mechanisms: ready notification delivery and
capacity scheduling, in `client.ts` and `read-work.ts`. No full suite is run in
round 1, as requested for this scope.

| Review finding | Correction | Regression on round 0 |
| --- | --- | --- |
| Astra P2 / Grok Medium: throwing subscriber loses later callbacks and escapes the timer | Catch each captured callback separately and report the original exception with `console.error("snapback4 client listener:", error)`, matching `app-client.ts`. Continue same-watch and later-watch delivery. | Timer control throws out of the flush; drained control leaves the same-watch second listener at `1`. Both pass after the fix and check displayed replacements past the original deadline. |
| Astra P2: React Native receives 50 ms browser window | Select the notification window by DOM `document` presence. `window = global` without a document gets a zero-delay timer turn. | All three React Native configurations leave eight listeners at `1` after that turn: `postTask`, `MessageChannel`, and neither API. All pass after the fix. |
| Grok Low: rejected `postTask` freezes capacity | If rejected before callback entry and not cancelled, schedule the same turn on a cancellable timer. Its callback resets/re-arms capacity. Never grant new starts in the rejection microtask. | An always-rejecting scheduler remains at eight starts instead of sixteen. The fix reaches 24 in eight-start host turns, preserves eight active, cancels pending fallback work and resumes a new owner after clear. |

All **six new cases fail on round 0** in
[regressions-round0.log](raw/regressions-round0.log). The post-merge baseline
has byte-identical `client.ts` and `read-work.ts` Git blobs to `e3b44a5bc4`,
recorded in [environment.json](environment.json). The complete corrected
`per-row-work` file passes **25/25** in [per-row-work.log](raw/per-row-work.log).
One existing browser-boundary fixture now supplies a document along with its
window; its deadline assertions are unchanged.

The subscriber controls use raw `observe().subscribe` listeners. The timer
callback must not throw out to its caller, every other captured listener must
run, and the exact original exception must be logged once. Both async-timer and
immediate backlog-drained paths are checked. Existing live-owner and membership
checks remain in place; no read value is saved in the batch.

Grok's accepted late-host-timer observation remains disclosed: publishing a
replacement retires the old episode. A late timer can delay paint of that
replacement without prolonging an unanswered owner's queue-inclusive deadline.
There is no new deadline tolerance. React Native tests reproduce its globals;
they are not physical-device or Hermes qualification.

## Verification

The [affected inventory](affected-files.json) includes all 59 round-0 affected
files (RL retention/oracles, PQ per-row/capacity, PR authorization/audit routes,
LL live propagation/media) plus the delivery fault matrix. It uses eight file
slots and the existing full oracle counts, with no seed overrides.

All **1,529 affected tests pass**, with zero failures, cancellations or skips
([output](raw/affected.log)). This is 1,208 affected cases plus the complete
321-case delivery fault matrix. The original RL oracle seed counts remain.
The merged `per-row-react.test.mjs` file passes **20/20 consecutive runs**
(**140 cases**), under SL's **48 busy workers on CPUs 86–95**. All 48 workers
survived with recorded CPU time and were reaped by the wrapper. The cohort took
**1,174.8 seconds**; no source/artifact inputs changed, no retries or test-count
or seed overrides were used. [Repetition receipt](raw/loaded-20.json),
[load record](loaded-20.json), [per-run summaries](loaded-20.log), and
[qualification hashes](qualification.json) retain the evidence. The affected
suite and original-clock control overlapped the early whole-file runs.

Commands, from `snapback4/`, reuse round 0's unchanged runners:

```sh
python3 reports/20261001-prl-per-row-loading/run-load.py round1/loaded-20 48 -- python3 reports/20261001-prl-per-row-loading/repeat.py ../round1/raw/loaded-20 20 node --test --test-reporter=tap packages/snapback4/test/per-row-react.test.mjs
```

The original-clock control uses the same `repeat.py` with the name
`../round1/raw/real-clock-20`, under `taskset -c 86-95 target/prl-load/confine`,
with `--test-name-pattern='^1,000 per-row useQuery hooks:'`. Its source snapshot
and metadata record the unchanged historical fixture and the worker overlap.

The original real-clock online control passes **20/20**, under the same 48 SL
workers on CPUs 86–95, with zero changed inputs and no retries.
[Repetition receipt](raw/real-clock-20.json), [worker overlap evidence](real-clock-20.json),
and [per-run summaries](real-clock-20.log). All 48 workers remain alive with
the required affinity before and after this 103.7-second cohort.

The whole guide passes **110/110**, zero ignored:
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-lang --test guide`.
[Guide output](raw/guide.log), [Cargo build](raw/cargo-build.log),
[SDK build](raw/sdk-build.log), and [typecheck](raw/typecheck.log) all pass.

The merged browser test includes WB's frozen-clock online mock, which is
preserved. For round-0 comparability, an additional cohort executes the original
real-clock online test from `e3b44a5bc4` under the same 48 SL workers and ten-CPU
affinity. Its [source snapshot](real-clock-per-row-react.probe.mjs) is copied
temporarily into the test directory so its unchanged relative imports resolve,
then removed. No runtime or tracked test changes are made during either cohort.

The locked wasm build passes at **2,015,329 B raw / 605,001 B gzip**, below
main's inherited **605,225 B** budget, which this round does not change.
[Size and SHA-256](wasm.json), [build log](raw/wasm-build.log). The difference
from round 0's wasm is inherited from main; this TypeScript patch adds no wasm.

PR's [round-5 publication audit](../../20260930-pr-subscription-pressure/round5/PUBLICATION-AUDIT.md),
[round-6 replacement audit](../../20260930-pr-subscription-pressure/round6/PUBLICATION-AUDIT.md),
and [PRL round-0 route audit](../PUBLICATION-AUDIT.md) still describe the authority
paths: final publication, remembered-answer invalidation, detached handles,
reset/scope/expiry withdrawals and every invalidated owner's replacement work
are unchanged. Only positive callback error handling/host timing and a failed
capacity-task fallback change. LLP 3000.023 §10 records those rules.

Failures: the six deliberate round-0 negative controls are ours, expected and
retained. No affected test, build, typecheck or guide failures occurred.
The unfiltered staged whitespace check reports the verbatim TAP failure
formatter's spaces and Cargo's final blank line in two raw logs; these evidence
files remain unedited. The source/document whitespace check excludes raw logs
and passes.

The inherited loading-regression filesystem ticket is resolved under
`issues/closed/`; this report is linked as its resolution evidence. Final
reference and source/document whitespace checks pass ([reference output](raw/ref-check.log)).

Nothing is pushed or published. The local implementation commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
