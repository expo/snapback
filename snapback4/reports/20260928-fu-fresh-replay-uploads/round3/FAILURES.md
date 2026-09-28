# Round-3 failure ledger

Every final positive qualification is green. All observed reds are **ours**:
round-2 defects demonstrated by deliberate negative controls, deliberately
mutated code, or test-development/setup mistakes. There were **zero unrelated
baseline** and **zero environmental** failures. Previous rounds retain their
own full-suite results; this round did not run `scripts/test.sh`.

| Classification | Failure | Resolution |
| --- | --- | --- |
| Ours, round-2 defects; expected controls | Startup/deferred/clock-driven refresh replay, terminal/retryable-auth policy mismatch, malformed ephemeral replies. | Fixed; final public controls against round 2 reproduce these, plus the probe loop. Exact names below. |
| Ours, deliberate mutant; expected control | Constant jitter produces synchronized waits. | All eight concurrent public paths reject `delay * 1.125`. |
| Ours, test fixture | Initial concurrent upload test permitted the real two-upload admission cap to add a third attempt (expected two). | Second asset responses now return a deterministic nonretryable refusal, keeping the experiment about client jitter. |
| Ours, test fixture | Initial fake retry timers left a web mutation unresolved; the harness reported pending promise/event-loop completion. | Use real retry timers and wait for dispatch. A SIGINT was sent only to the recorded test runner during cleanup. |
| Ours, test assertion | The second pre-fix run asserted online mutation attempts immediately after its public pending result: observed `[1,1,1,1]`, expected `[2,2,2,2]`. | Wait for all second dispatches. Final negative control no longer reports this error; all positive concurrent tests pass. |
| Ours, round-2 defect; expected control | Public reconnect sends 16 probe requests approximately 0–2 ms apart after `Retry-After: 1`. | Add the shared refusal wait. Positive regression and transient/persistent wait faults pass. |
| Ours, test fixture | Initial probe mock returned synchronously and allowed the broken recovery loop to starve the test's timer; that run was stopped using its recorded runner/child/server PIDs. | Yield once with `setImmediate` to model real transport progress; the finalized pre-fix control fails with measured intervals rather than hanging. |
| Ours, artifact formatting | Staged whitespace check rejected three Markdown hard-break spaces in the verbatim Astra review. | Preserved the exact review losslessly as `astra-review.md.gz`; final staged check passes. |
| Ours, exploratory setup | Guessed nonexistent `src/http.ts`, a wrongly named LLP 3000.011.003.000 file, and `delivery-faults.test.mjs`. One documentation edit used repository-relative paths from `snapback4/` and failed before writing. | Located files with `rg`, reran reads/edits with the correct paths. Some broad read output was truncated and replaced by focused reads. No product conclusion relies on the failed reads. |

The log lists below include repetitions across pre-fix and finalized controls;
they are not counts of distinct defects. `failures.json` retains machine-readable
names. The interrupted initial probe capture contains no completed assertion.

## before-final.log.gz

- online: public ephemeral text preserves HTTP status and never replays
- online: public ephemeral null preserves HTTP status and never replays
- online: public ephemeral envelope preserves HTTP status and never replays
- online: public ephemeral success-envelope preserves HTTP status and never replays
- web: public ephemeral text preserves HTTP status and never replays
- web: public ephemeral null preserves HTTP status and never replays
- web: public ephemeral envelope preserves HTTP status and never replays
- web: public ephemeral success-envelope preserves HTTP status and never replays
- public constructor startup rotation reset retains its retry decision across clock updates
- public constructor startup rotation invalid retains its retry decision across clock updates
- public constructor startup rotation body retains its retry decision across clock updates
- public constructor startup rotation terminal retains its retry decision across clock updates
- public constructor startup rotation retryable-auth retains its retry decision across clock updates
- public deferred startup rotation reset retains its retry decision across clock updates
- public deferred startup rotation invalid retains its retry decision across clock updates
- public deferred startup rotation body retains its retry decision across clock updates
- public deferred startup rotation terminal retains its retry decision across clock updates
- public online startup rotation reset retains its retry decision across clock updates
- public online startup rotation invalid retains its retry decision across clock updates
- public online startup rotation body retains its retry decision across clock updates
- public online startup rotation terminal retains its retry decision across clock updates
- online: concurrent public mutation retries vary beyond Retry-After

## before.log.gz

- online: public ephemeral text preserves HTTP status and never replays
- online: public ephemeral null preserves HTTP status and never replays
- online: public ephemeral envelope preserves HTTP status and never replays
- online: public ephemeral success-envelope preserves HTTP status and never replays
- web: public ephemeral text preserves HTTP status and never replays
- web: public ephemeral null preserves HTTP status and never replays
- web: public ephemeral envelope preserves HTTP status and never replays
- web: public ephemeral success-envelope preserves HTTP status and never replays
- public constructor startup rotation reset retains its retry decision across clock updates
- public constructor startup rotation invalid retains its retry decision across clock updates
- public constructor startup rotation body retains its retry decision across clock updates
- public constructor startup rotation terminal retains its retry decision across clock updates
- public constructor startup rotation retryable-auth retains its retry decision across clock updates
- public deferred startup rotation reset retains its retry decision across clock updates
- public deferred startup rotation invalid retains its retry decision across clock updates
- public deferred startup rotation body retains its retry decision across clock updates
- public deferred startup rotation terminal retains its retry decision across clock updates
- public online startup rotation reset retains its retry decision across clock updates
- public online startup rotation invalid retains its retry decision across clock updates
- public online startup rotation body retains its retry decision across clock updates
- public online startup rotation terminal retains its retry decision across clock updates
- online: concurrent public upload retries vary beyond Retry-After
- packages/snapback4/test/overload.test.mjs

## constant-jitter-negative.log.gz

- online: concurrent public upload retries vary beyond Retry-After
- online: concurrent public asset retries vary beyond Retry-After
- online: concurrent public query retries vary beyond Retry-After
- online: concurrent public mutation retries vary beyond Retry-After
- web: concurrent public upload retries vary beyond Retry-After
- web: concurrent public asset retries vary beyond Retry-After
- web: concurrent public query retries vary beyond Retry-After
- web: concurrent public mutation retries vary beyond Retry-After

## probe-before-final.log.gz

- public web probe recovery paces overload while identity remains unverified

## probe-before.log.gz

- packages/snapback4/test/overload.test.mjs

## round2-negative.log.gz

- online: public ephemeral text preserves HTTP status and never replays
- online: public ephemeral null preserves HTTP status and never replays
- online: public ephemeral envelope preserves HTTP status and never replays
- online: public ephemeral success-envelope preserves HTTP status and never replays
- web: public ephemeral text preserves HTTP status and never replays
- web: public ephemeral null preserves HTTP status and never replays
- web: public ephemeral envelope preserves HTTP status and never replays
- web: public ephemeral success-envelope preserves HTTP status and never replays
- public constructor startup rotation reset retains its retry decision across clock updates
- public constructor startup rotation invalid retains its retry decision across clock updates
- public constructor startup rotation body retains its retry decision across clock updates
- public constructor startup rotation terminal retains its retry decision across clock updates
- public constructor startup rotation retryable-auth retains its retry decision across clock updates
- public deferred startup rotation reset retains its retry decision across clock updates
- public deferred startup rotation invalid retains its retry decision across clock updates
- public deferred startup rotation body retains its retry decision across clock updates
- public deferred startup rotation terminal retains its retry decision across clock updates
- public online startup rotation reset retains its retry decision across clock updates
- public online startup rotation invalid retains its retry decision across clock updates
- public online startup rotation body retains its retry decision across clock updates
- public online startup rotation terminal retains its retry decision across clock updates
- public web probe recovery paces overload while identity remains unverified
