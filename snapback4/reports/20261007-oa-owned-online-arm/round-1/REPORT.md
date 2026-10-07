# OA round 1 — retain the originating arm through shared dispatch

Date: 2026-10-07. Base: `2447b74854199b55646920b6b09a040c302d046d`.
Branch: `sb4-intent/oa-owned-online-arm`. Work stayed in the OA worktree on
eb1000 (`expose-builder-pixel`). No push, publication or other worktree/process
mutation. The initial commission's 30 GB disk limit still applies.

## Review finding and governing context

The supplied Grok review was READY; Astra was NOT READY on one P1. Sources:
`~/sb4-intent/reviews/oa-r0.grok.md`, `oa-r0.astra.md`, and
`oa-r0.astra.evidence/{REVIEW.md,no-device-rotation.test.mjs}`. No new independent
review verdict is claimed here. The reproducer ran unchanged against this
worktree's built package with SNAPBACK4_REVIEW_ROOT pointing here: [before](review-reproducer-before.log)
has three failures and two controls passing; [final rerun](review-reproducer-final.log)
has all five passing. The reproduction prints no bearer values.

The three failures share one cause. In no-device apps, the public facade retired
but the raw client kept a signal already queued inside it. That call could use a
replacement credential, dispatch its captured retired credential after a storage
wait, or dispatch as the old account while auth was restoring. Merely refusing
the returned result is too late. The device-only transport closure had hidden
this gap from the original lifecycle tests.

The orient context is unchanged: [LLP 3000.013 §6](../../../../llp/3000.013-quarry-states-intent.rfc.md#6-a-paved-client)
governs exposed facades and private rollback custody; [LLP 3000.033 §§1.3–1.4](../../../../llp/3000.033-read-only-client-mode.rfc.md#14-the-sdk)
govern shared epochs, principal sign-out watermarks, read verification and fixed
read-session expiry. [§1.8](../../../../llp/3000.033-read-only-client-mode.rfc.md#18-app-owned-online-arm-oa-2026-10-07)
now describes the dispatch fix precisely. No persistent format, wire shape,
session policy, public contract or runtime ceiling changed.

## Implementation and guarantees

[online-arm-fence.ts](../../../packages/snapback4/src/online-arm-fence.ts) binds
private operation copies to the originating arm and credential predicate.
Neither the caller's generated operation nor its arguments are mutated. The
metadata lives in WeakMaps; no extra field, header or body member crosses HTTP.
The arm still exposes the same nine operations/metadata members and no bearer.

[app-online-arm.ts](../../../packages/snapback4/src/app-online-arm.ts) binds every
query, observation, signal and action before entering the guarded/raw clients.
The [ephemeral lane](../../../packages/snapback4/src/ephemeral.ts) retains this
fence on queued entries, checks it before renewal reuse or dispatch, and keeps
coalescing/reuse within one arm. [Observation keys](../../../packages/snapback4/src/observe-watch.ts)
also include arm identity: a replacement arm and the ordinary app client cannot
inherit a retired arm's queued observation. Sharing within one arm is retained;
retired lingering observations close instead of retaining work.

The [shared client](../../../packages/snapback4/src/client.ts) carries the fence
through refresh waits, query scheduling and auth/admission retries, then attaches
it privately to each RequestInit. [App custody](../../../packages/snapback4/src/app.ts)
rechecks it after awaiting shared authority and immediately before calling the
transport. There is no await between that final fence and dispatch. This applies
to device and no-device arm operations. The app's independent session maintenance
and ordinary client work keep their existing custody rules.

Already-dispatched calls retain their responses, including transport failures.
Retirement prevents further attempts; it does not reinterpret a committed
success or turn a lost reply into an auth refusal. Explicit logout still closes
the shared raw client: an already-started call may retain its E_CLOSED
cancellation outcome when close wins the authority gate. A local arm refusal is
not a rejection of the shared raw client's current credential, so it cannot
sign the app out. The existing private-device drain is unchanged. No-device
apps still use their own raw client; read-only apps gain no second verifier,
write machinery, refresh owner or device. The read-only fixed-expiry and shared
logout rules remain intact.

Typing keeps its four-second expiry on retirement. An explicit stop is safe on
ordinary unmount while the arm remains live. At retirement, admitting a stop
would require delaying the fence or granting use of a retired/replacement
credential, and generic app custody does not own the typing operation. No such
exception was added. The social guide, starter README, client reference and LLP
state this distinction explicitly; the typing algorithm and assertions are
unchanged.

## Verification

- Owned-arm coverage grows from 12 to 32 tests. Device and no-device variants
  cover held signal/action rotation, queued signals, account/logout/close late
  reads and observations, offline/reconnect, authority waits and failed opener
  rollback. The three exact review schedules are permanent regressions. Added
  controls cover dispatched transport failures, shared-refresh action waits, auth retries across rotation,
  renewal reuse and observation ownership. The runtime credential-surface test
  now runs in both tiers. The original bounded-drain control remains.
- [Final requested client suites](requested-client-tests-final.log): 27/27 files, 250 passed,
  zero failed, one labelled skip. Includes owned-arm, social starter/browser,
  ephemeral, typing, read-only and published-example tests. The skip is the
  published-binary downgrade control (SNAPBACK4_PREVIOUS_PUBLISHED_BIN unset);
  no persisted state changed. The earlier 248-pass run is also retained in
  [requested-client-tests.log](requested-client-tests.log).
- [Guide](guide.log): 113/113. [Final client typecheck](typecheck-final.log) and
  [package build](build-final.log) passed. Client card remains 112 lines / 1,200
  words; no guide budget increased.
- The existing await census changes only client.ts and ephemeral.ts hashes;
  counts stay 62 and 4. The new metadata module has zero awaits. The existing
  instrument records that these waits carry the fence through existing requests;
  no delivery I/O site, classification or fault recipe changed.

Because the fix touches the shared client, ephemeral lane and observation keys,
the full suite ran with default counts:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT \
CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 \
CARGO_INCREMENTAL=0 bash snapback4/scripts/test.sh
```

The [complete full-suite log](full-suite.log.gz) records 2,055 seconds:

- Rust: 308 binaries / 1,021 scheduled executions and workspace doctests;
  one CLI unit test failed as detailed below. All other executions passed.
- Client pool: 339/339 files passed; 6,630 tests passed, zero failures,
  55 labelled skips.
- Models: all 79 passed, with 5,000 session histories per tier and 3,000
  online-client sequences. No counts were reduced.
- CLI/wasm builds, documentation budgets, release guard, client package
  typecheck/build, chat check/typecheck, Expo typecheck and nine fixture-wrapper
  tests passed.

This is a completed full run plus a passing canonical affected rerun, **not a
single-green-run qualification receipt**. No OA failure remains.

Initial development failures are retained: strict optional-property
typing required the entry's arm field to admit undefined; an added retry test
initially instrumented Response.text instead of the JSON reader and timed out.
The no-device logout test initially expected E_AUTH even when raw close won.
An attempted normalization then rewrote dispatched transport failures: both
new preservation controls failed in [the diagnostic run](outcome-preservation-before.log).
That normalization was removed, preserving the original transport/cancellation
outcomes; the logout assertion allows the actual gate/close winner and still
requires zero dispatches. The final package rebuild finished during the full
suite's Rust phase, before any client-pool or model file started. The full
client pool therefore tests the corrected package; the complete requested
suite is also rerun in [requested-client-tests-final.log](requested-client-tests-final.log).

The full Rust run has one failure outside OA's changed code:
`stalled_resolver_sigint_is_bounded_journalled_and_drained` reported
`E_WITNESS_ARTIFACT` / `E_WITNESS_PROCESS: invalid /proc process group` during
evidence cleanup. Two manual module reruns passed that case but failed the
timeout fixture before its launcher appeared. Those commands accidentally used
Rust's default parallelism; the canonical suite explicitly runs this CLI unit
binary with one test thread. The complete [canonical rerun](witness-preparation-canonical.log)
uses `--test-threads=1` and passes all 16 cases. Both earlier reruns are retained
in [witness-preparation-rerun.log](witness-preparation-rerun.log) and
[witness-preparation-final.log](witness-preparation-final.log). No witness code,
fixture, timeout or assertion was changed. This rerun resolves verification of
that module; it does not erase the full run's original red.

## Resources and final checks

The rebuilt wasm is unchanged: 2,135,164 raw bytes / 645,264 gzip bytes against
the unchanged 645,564 budget. SHA-256:
`a4c6b4a8a7e76d81df9f424899f474863ce23cf232c0e4162861cc1333a3ec83`.
No engine/device/wasm build input changed. The [final worktree measurement](resources.txt)
is 15,663,124,286 bytes (15.7 GB), below 30 GB. The [reference audit](ref-check.log)
passes: 531 LLP documents, 10,508 references, zero errors and zero unchecked.
Text logs have trailing whitespace normalized; full-suite.log.gz preserves
the original output bytes. The original typing/starter test assertions and
Conversation/useTyping source files are unchanged in this round.
