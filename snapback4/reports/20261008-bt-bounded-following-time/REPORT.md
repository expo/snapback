# BT — bounded Following time without weaker custody checks

**Round-1 correction:** Astra found that round 0's wait-entry assertion could
miss publication later in the hold, including an unchanged answer. The timings
and narrower bypass results below remain historical measurements; they did
not establish continuous withholding. [Round 1](round1/REPORT.md) adds checks
at the actual POST/apply release boundaries and permanent delayed-publication
controls, with fresh qualification and timings.

The change replaces unnecessary deadline waits with checks on the exact
in-flight one-shot, then releases the held write/sync and checks that call's
final answer. Two genuine 30-second exhaustion controls remain in
bounded-following, one on wasm and one on native, with their original
`E_QUERY_RETRY` assertions unchanged. There are no product changes.

Base `6b8ff187bbb1f6eb231db4105d1727580d95d0aa`; branch
`sb4-intent/bt-bounded-following-time`; all work stayed in this worktree on
eb1000. Nothing pushed or published. [Environment and artifact hashes](environment.json),
[commands and intermediate attempts](commands.txt).

## Measured results

| File | Tests | Before (s) | After 1 / 2 / 3 (s) | Median saved |
| --- | ---: | ---: | --- | ---: |
| `bounded-following.test.mjs` | 39 | 1219.176 | 314.008 / 314.052 / 314.261 | 905.124 s (74.2%) |
| `retained-history.test.mjs` | 78 | 192.570 | 68.683 / 68.989 / 69.031 | 123.581 s (64.2%) |
| `following-routing.test.mjs` | 4 | 33.195 | 4.143 / 4.133 / 4.132 | 29.062 s (87.5%) |
| `client-lifecycle.test.mjs` | 57 | 45.256 | 42.951 / 43.079 / 43.125 | 2.178 s (4.8%) |

Bounded-following falls from **20 min 19 s to 5 min 14 s**: a median saving of **15 min 5 s (74.2%)**.

[Every test's before and all three after times](TIMINGS.md),
[machine-readable timings](timings.json). Test counts are identical across each
file's before/after runs. Times include setup and cleanup; they are elapsed
host measurements, not a latency guarantee. The unchanged files were run
sequentially, as were the final repeated runs. Early exploratory, mutation,
regression and extra-file after-1 jobs overlapped the long bounded baseline;
they are identified in commands.txt. Other lanes could use this shared host.
No Darwin measurement is claimed.

The baseline used fresh builds from this worktree, not SN's retained timing.
The initial dependency invocation used the repository root; after the SDK
checker identified the wrong directory, both required commands were rerun in
`snapback4/`, printing **deps-ok**, before any build or test. Native, wasm and
SDK were built once. Wasm was 645,605 B gzip against the unchanged 646,180 B
budget. Product artifact hashes were rechecked before commit.

## Where the old 30 seconds went

LLP 3000.023 §11 now waits on dependent write custody without consuming a
publication round. These tests kept that custody held while awaiting a final
refusal, so the unchanged code correctly used its complete one-shot timer.
Offline controls return `E_OFFLINE` immediately; ordinary unavailable reads
without custody spend the four publication rounds instead.

| Case (both tiers unless stated) | Deadline queries / sequential intervals per tier | Why it waited; replacement |
| --- | ---: | --- |
| Owned-event fallback | 4 / 1 | Point, scan, conditional scan and held-branch reads depend on the predicted source slot. Check all four pending; release; verify all four final answers. |
| Rejected owned events | 1 / 1 | Unknown filter leaves a speculative scan fenced by an owned-event prediction. Preserve raw placeholder/provenance and no-request checks; verify the observed event. |
| Unrelated held reads / speculative refusals or empty pages | 4 / 1 | Guard, conditional events, filtered events and speculative projection cannot use a held prediction to validate unknown data/refusal. Preserve separate offline checks and raw evidence for each query; verify each online final answer against the server after release. |
| Static/helper dependencies | 4 / 2 | Three unknown branches wait before acknowledgement; a fresh helper read waits after acknowledgement but before apply. Original and fresh reads are checked independently at the second boundary and return the observed post. |
| Scalar cut before feed | 1 / 1 | The executed scalar subset cannot erase possible feed/posts dependencies. **Keep this full real deadline on each tier.** Original refusal/raw/no-fallback checks remain; add a monotonic duration check. |
| Speculative profile | 1 / 1 | A held page cannot authorize a speculative profile. Preserve partial prediction, disjoint remote profile and offline controls; release and check the original call's real profile and predicted post. |
| Composed read | 1 / 1 | The atomic answer cannot replace one predicted component with a server answer. Keep no-request and original final-row/transport controls; also compare the held call's final data. |
| Predicted post | 2 / 2 | Separate before-send and acknowledged-before-apply custody. Keep both boundaries, original and fresh calls, old and new cards, and server equality. |
| Online-only repost cards | 2 / 2 | Prediction fencing precedes server routing, including after acknowledgement. Preserve both phases, final rows and transport refusal. |
| Response racing admission | 1 / 1 | A response dispatched before prediction admission cannot replace the prediction. Wait for real custody on that original call, release, require the racing post and exact final server data. |
| Inbox floors | 3 / 3 | Predicted post before send, after acknowledgement, then a separate nonpredictable follow. Preserve all three holds, meter prefixes, cursor/coverage and no-request controls; verify final results after each release. |
| Native query module (one case) | 2 / 2 total | Native executed dependencies fence fallback before and after acknowledgement. Preserve guest/provenance/cursor checks and original post-observation query; compare both held calls with the server at the original cursor. |

Thus the old file had **50 deadline queries in 34 sequential timer intervals**;
concurrent groups already shared their 30 seconds after SN round 8. The changed
file retains **two real timer intervals**. The other 16 cases do not exhaust
a custody timer and remain unchanged in behavior. Test counts and all 20 timeout
declarations remain intact. Release/observation, transport retry and cleanup
costs remain, so removing 32 timer intervals is not a claim of exactly 960 seconds
saved from total wall time.

## Proof that withholding still matters

The new [custody observer](../../packages/snapback4/test/helpers/custody-read.mjs)
wraps the real `QueryCustody.wait`; it preserves the original receiver,
arguments, predicate, returned promise, wakeup and deadline. Async context
associates entry with the exact query invocation rather than a query-name slot.
Each assertion races wait entry against settlement, so a broken fence fails
instead of waiting for an event it bypassed. Fresh calls after acknowledgement
independently check the before-apply boundary; the earlier calls must also remain
pending there. No timed sleep supplies a success oracle.

[Mutation loader](custody-bypass.mjs), following SN round 8's pattern:

- Bypass all local custody: **26/26 selected tests fail** at the new unsettled
  assertion (21 bounded-following, two retained-history, two lifecycle, one routing).
- Bypass only successful-but-unobserved receipts: **9/9 selected tests fail** at
  before-apply checks, after admission checks pass.
- Bypass only `conditionalEventsHeld`, `speculativePage`, or
  `conditionalOriginal`, plus retained-history’s `homePage`: **8/8 selected
  tests fail**, covering each sibling on both tiers independently of the other
  blocked reads in its group. The `homePage` control runs after final timing
  measurements and catches premature settlement even though its gate payload
  is unchanged.
- The same loader with mutations disabled passes the complete changed files
  in the first repeated run.

All 43 expected failures are ordinary assertion failures with “settled while
custody was held,” not hangs, timeout failures, loader failures or fixture
startup errors. [Exact cases and assertions](mutation-results.json),
[admission log](bypass-admission.tap.gz), [receipt log](bypass-receipt.tap.gz).
The mutation exists only in module loading; neither source nor built SDK
files on disk are changed. No browser claim is needed for these Node test edits.

An AST assertion audit found 219 → 220 explicit `assert.*` sites in
bounded-following, in addition to the new helper's per-call assertions. Every
removed/rewritten site is an online held-read retry expectation (offline arms
are preserved explicitly). Site counts alone are not the proof: the per-case
mapping above and negative controls establish what is exercised.
[Assertion delta](assertion-delta.json), [scope, constraints and file audit](AUDIT.md).

## Other client files

Converted the two real-device speculative-event cases in `retained-history`,
the pending composed re-observation case in `following-routing`, and both
population-growth replay cases in `client-lifecycle`. The last already shortened
the timer to one second; the new check removes that global timer override and
requires the original read's two final authoritative rows. Retained history
keeps the distinction between a whole server answer (`home`) and a composed
answer preserving local history (`homePage`).

The [complete audit table](AUDIT.md#other-files-checked) lists every file inspected
and its disposition. Remaining deliberate deadlines include the one-shot
regressions, expiry/rollback recovery, permanently unavailable guest/partition
controls and a store-replacement control. The five focused reset/guest tests
passed unchanged in 151.086 seconds. These remaining timers are disclosed,
not counted as optimized. Ordinary cursor, authority, loading and offline
refusals are not converted into custody waits.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Fresh unchanged baselines | All four files pass: 39 / 78 / 4 / 57 | Before logs in [timings.json](timings.json) |
| Complete changed files, three runs each | **3 × 178 passes**, zero failures, cancellations or skips | [All per-test timings](TIMINGS.md), [queued commands/exits](rerun-exits.json) |
| One-shot, dependency and publication/session regressions | **378/378 pass** (354 top-level + 24 nested; count corrected in round 1) | [Log](one-shot-regressions.tap.gz) |
| Custody bypasses | **43 expected assertion failures**, zero unexpected passes | [Mutation results](mutation-results.json) |
| Unchanged reset/guest audit controls | **5/5 pass** | [Log](audit-reset-routing.tap.gz) |
| `./ref-check` and `git diff --check` | Pass | [Reference log](ref-check.log.gz) |
| Built native, wasm and SDK artifact hashes | All unchanged | [Hash comparison](artifact-check.log.gz) |

Reruns are repeated executions, not additional unique tests. The complete changed
file set has 178 tests; 26 of those cases receive the new withholding checks.

One exploratory added final-history assertion initially expected retained rows
from `home`, even though the existing fixture documents and asserts its lack of
a component plan. It was corrected to the already-established empty server
history for `home`, with retained rows still required for `homePage`; the original
raw/withholding assertions were never removed. Both cases then passed, followed
by the complete repeated file runs. The failing exploratory log is retained.

The change is limited to four client test files, their transparent helper,
report evidence and an append-only JOURNAL entry. No runtime, SDK, compiler,
device, contract, timer, ceiling, dependency or gate changes. No full publication
qualification or complete battery claim.
