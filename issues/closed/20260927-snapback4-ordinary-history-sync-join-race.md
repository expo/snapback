# Snapback 4: ordinary-history assertion races a sync round begun before leave

Status: Closed
Date: 2026-09-27
Scope: Snapback 4 raw local sync / ordinary-history fixture
Found by: lane DC round 13 full-suite recovery

The process-tier `receipts screen and history after leave, remount and
offline/online reopen` case fails at
`snapback4/packages/snapback4/test/ordinary-history.test.mjs:226`: inbox still
contains the conversation immediately after leave and `await bob.sync()`.
The test passes in isolation on both the round-13 code and merge baseline
`6db10b223`. A controlled request ordering reproduces the same failure on both:
start sync, hold its already-rendered response, commit leave through bobHttp,
call sync again, then release the first response. `syncOnce` joins its existing
promise, so the second call need not fetch a page that includes the leave.

Reproduce from `snapback4/` on Node 24 after the package build:

```sh
node --import ./reports/20260927-dc-delivery-client/round13/history-sync-interleaving.mjs --test --test-reporter=tap --test-name-pattern='process: receipts screen and history' packages/snapback4/test/ordinary-history.test.mjs
node --import ./reports/20260927-dc-delivery-client/round13/baseline-history.mjs --import ./reports/20260927-dc-delivery-client/round13/history-sync-interleaving.mjs --test --test-reporter=tap --test-name-pattern='process: receipts screen and history' packages/snapback4/test/ordinary-history.test.mjs
```

The baseline loader transpiles the five changed pre-round client modules from
Git in memory; the interleaving loader holds a real server response without
changing the original inbox assertion. Neither edits source or built files.
The test file and the receipts card's Quarry are unchanged by round 13.
Evidence: `snapback4/reports/20260927-dc-delivery-client/round13/` logs named
`history-recovery-*` (ordinary runs pass) and `history-interleaving-*` (both
controls fail with the same retained inbox row).

Follow-up: decide whether explicit sync promises a round started after its
call, or whether this fixture must wait for observable inbox convergence.
Preserve retained screen/history behavior, authorization and all assertions
about eventual post-leave state. Round 13 leaves this independent behavior
unchanged and reports the full-suite failure as baseline.

## Resolution — 2026-09-28, lane SY

The author ruled that explicit `sync()` must wait for a round begun after its
call. The shared local TypeScript client now groups callers by the in-flight
round they encountered and awaits one shared follow-up, on every device host.
Background rounds retain ordinary coalescing; the follow-up owns the existing
offline result or rejection, including when the older round failed.

The original assertions are preserved. A committed fetch-injection case holds
an older real response across the server commit on both process and wasm,
and requires the revoked membership/home to be gone after explicit sync.
Both fail against the merged baseline and pass with the correction. Scheduler
cases check ten callers, subsequent callers, background wakes, offline fetch,
and device rejection. The original unforced cases are also repeated in
isolated processes. Full qualification and failure attribution are in the
[SY report](../../snapback4/reports/20260928-sy-sync-after-call/REPORT.md).
