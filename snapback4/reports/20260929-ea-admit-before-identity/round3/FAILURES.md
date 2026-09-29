# EA round 3 failure ledger

Every development failure below is **ours**. None is assigned to baseline or
environment. Original logs remain; corrected reruns do not replace their results.
The full-suite section will contain the one requested `scripts/test.sh` result.

## Setup and build

- `build-1.log`: TS2345, generic mutation result inferred as `Write<unknown>`.
  Explicit `IdentityWait.run<R>`/submission typing fixes it; build-2 onward pass.
- A heredoc was invoked with a redundant `snapback4/` prefix from inside that
  directory. It wrote no tests. `identity-first.log` is the resulting empty-file
  harness pass and is **not** validation. The command was corrected;
  `identity-first-real.log` runs 20 actual tests, all passing.
- One malformed orchestration call failed JavaScript parsing before any command
  ran. No files or verification results were affected.

## Guide

- `guide.log`: 97/99. `definitions::w11_every_registered_code_quotes_its_definition`
  still pinned 30 seconds; updated to 15. `familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block`
  counted 12,818 words against the unchanged 12,810 bound.
- `guide-final.log` and `guide-complete.log`: 98/99; same word-budget failure.
  Shortening the client/refusal cards did not change the older card set that this
  gate measures. No fact, compiled example or ceiling was removed.
- `guide-verified.log`: 98/99; writes-card wording reduced the count to 12,811,
  still one word too many. Condensed that same sentence; `guide-pass.log` is 99/99.
- `git diff --check` found one trailing space in the edited E_ADMISSION card;
  removed. Subsequent source/document whitespace checks pass. The final staged
  check also flags whitespace emitted by Node on blank lines in raw failure
  logs, and a trailing blank line in the guide log. Those original tool logs
  are preserved; the final whitespace check excludes report `.log` files only.

## First affected run

`affected.log`: 256 tests; 242 pass, 11 fail, two cancelled, one existing skip.
The two cancellations are the obsolete recovery setups waiting twice for
unidentified calls. All 13 unsuccessful cases are listed below.

| Case | Cause and correction |
| --- | --- |
| W5R1x wasm: opener returns an offline unacquired client on network loss | Expected pre-identity acknowledgement. Assert visible unadmitted state, restore connectivity, then await successful submission. |
| W5R1x process: same | Same correction. |
| W5c wasm: pending writes recover by id through sent and failed, including settlement before reopen returns | Cancelled at the old 30-second test limit after two new 15-second waits. Ordinary recovery fixture now identifies first, then clears acquisition and goes offline. All success/refusal/replay assertions retained. |
| W5c process: same | Same correction. |
| settle pins E_STORE_REPLACED, then compacts its id across normal receipt churn and reopen | Receipt-retirement unit transport had neither identity nor a probe. Give that isolated transport its identified store; no retirement assertions relaxed. |
| settle pins E_STORE_RESTORE, then compacts its id across normal receipt churn and reopen | Same fixture correction. |
| retirement saturation fences new admissions durably; displaced sent id: false | Same fixture correction. |
| retirement saturation fences new admissions durably; displaced sent id: true | Same fixture correction. |
| a saturated journal recovers an already-admitted intent as pending while its delivery is held | Same fixture correction for its new post-saturation call. |
| an unidentified Node device defers both transports until its first store binding | The wait compared backend object identity, so reloading identical schema/programs falsely refused. Compare their content and generation; retain authenticated store and ordinary-boundary guards. |
| W11R1a: background outbox adoption keeps one sender and never takes a live owner | Removal of the deferred restore wake accidentally also removed the ordinary onOutbox wake. Restored `flushRecovered` in that callback. |
| close detaches a held first-store probe and preserves the pending intent for reopen | Old pre-identity custody expectation. New contract has no journal; assert closed refusal, no recovery and a successful new attempt. |
| server-clock-wire.test.mjs file load | Imported the deleted native custody wrapper. Removed only that wrapper-specific parameterization; native and web clock-floor cases remain. |

`navigation-focus.log` reproduced both navigation failures (0/2), with diagnostic
state. `navigation-fixed.log` passes 2/2 after both product fixes.
`acquisition-corrected.log` passes all four affected acquisition/recovery cases.

`affected-corrected.log`: 55/56. The adapted online close test assumed an empty
journal existed. An entirely unadmitted call correctly has no journal at all;
handle `null` in the assertion. `final-admission.log` passes 61/61, including the
corrected online close, all 26 new admission cases and the web startup suite.

## Requested full suite

The single invocation exited 1: `== 1 failure(s) in 1386 s`, `client tests`.
Every other stage passed, including all 79 full-count model tests. Its following unsuccessful cases are
**ours**, and their scoped reruns pass. Product code remained frozen. These
test files were edited only after the runner emitted their original results;
their original hashes are in `full-suite-original-fixtures.json`.

| Case | Cause and correction |
| --- | --- |
| generated Expo storage keeps a!b and a~b write custody separate | Offline fixture also disabled identification, so no custody was admitted. Keep the identity probe available while mutation delivery is offline. All key-isolation and recovery assertions remain. |
| generated Expo storage keeps a*b and a'b write custody separate | Same correction. |
| generated Expo storage keeps a(b and a)b write custody separate | Same correction. |
| generated Expo storage keeps user:01ABC and user_3A01ABC write custody separate | Same correction. |
| generated Expo storage keeps ab and 慢 write custody separate | Same correction. |
| recovery refuses an intent with a foreign recorded owner even at the correct safe key | Same fixture correction, preserving quarantine and no-disclosure assertions. |
| recovery quarantines a valid same-principal journal transplanted from another backend | Same fixture correction, preserving the original journal and all backend-isolation assertions. |
| logout clears credentials after journal failure, and credential deletion is retryable | Mock probe returned no store identity, masking the intended journal failure with an identity timeout. Give the probe an identity; all E_STORE/logout assertions remain. |
| logoutEverywhere clears credentials after journal failure, and credential deletion is retryable | Same correction. |
| a refused device adopt keeps the previous backend active in JavaScript | Cancelled at 5 seconds: unit device had no identity and could never admit. Give this ordinary-adoption fixture a store ID; retain the previous-backend prediction assertion. |
| every local prediction invalidates observations, including unrelated tables | Cancelled at 5 seconds: same unidentified mock. Give it a store ID; retain both observation invalidation assertions. |
| native: a write already sending when a snapshot starts is correlated after catch-up | Old close assertion expected pending after another owner durably proved execution. Retained round-2 close fix returns sent; now require replayed sent with a positive sequence. The separate wasm device still requires pending. |
| native: another client sending after sync capture cannot publish an uncorrelated page | Same stale close expectation after the later healthy sync correlates the write. Require replayed sent with a positive sequence; all stale-preflight, watermark, prediction and correlation assertions remain. |

`full-fixtures-corrected.log` passes all nine storage/logout cases.
`lifecycle-failure-focus.log` first reproduces the four lifecycle cases
(two failed, two cancelled). `lifecycle-corrected.log` passes nine, including
the corrected cases, the separate wasm case, and four delayed/lost-response
increment cases. No baseline or environmental cause is claimed.

The client stage finished with **4,797 tests: 4,764 pass, 20 fail, three
cancelled, ten existing skips**. The additional ten unsuccessful cases below
all come from `web-admission-review.test.mjs` and are also **ours**. Its source
instrumentation still matched the old `syncOnce()` signature rather than the
retained round-2 `syncOnce(reserve = false)`. No trace event could arrive, so
two checks spent 30 seconds each waiting; that consumed the parent budget,
which then closed the browser during later checks. The fixture now matches the
actual signature and asserts that the instrumentation needle exists. No
timeout, test count or behavioral assertion was weakened.

| Case | Original failure |
| --- | --- |
| sync acknowledgement replaces an aborted replacement refusal after A committed, including reopen | 30-second wait for missing sync instrumentation. |
| a refused _ops row never acknowledges success after its NOT_ADMIN response is lost | Same missing instrumentation. |
| a fresh orphan bound to A is retired before enqueue on B (exit transport) | Browser closed when the parent reached its 180-second limit. |
| a recovered orphan bound to A is retired before enqueue on B (ordinary transport) | Same parent-timeout cascade. |
| a recovered orphan bound to A is retired before enqueue on B (exit transport) | Same parent-timeout cascade. |
| a fresh orphan waits for an unidentified destination and delivers its original id after matching sync | Same parent-timeout cascade. |
| same-epoch logout tombstone refuses live admission | Same parent-timeout cascade. |
| same-epoch logout tombstone refuses live admission even with retained session fields | Same parent-timeout cascade. |
| a confirmed epoch mismatch fences existing observations while the change poll is held | Same parent-timeout cascade. |
| web admission review: recovery and transport respect the session boundary | Parent cancelled at 180 seconds after the two instrument waits. |

The complete corrected browser file passes **55/55** in
`web-review-corrected.log` (138.6 seconds, below the unchanged 180-second
parent timeout). Every failed/cancelled full-suite case has a passing corrected
scoped rerun. The full suite was not invoked a second time.

The inherited 60-second total-suite budget remains missed (baseline constraint
miss documented in prior rounds); it is not a separate script failure stage.
No product test failure is attributed to baseline or environment.
