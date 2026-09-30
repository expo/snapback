# Snapback 4: intermittent orphan-binding response timeouts

Status: Closed — resolved 2026-09-30 by lane SL.
Date: 2026-09-29.

Lane AV's one `scripts/test.sh` run failed these existing
`web-admission-review.test.mjs` subtests at line 1114:

- `replacement after validation refuses the original orphan binding at the server (ordinary transport)`
- `replacement after validation refuses the original orphan binding at the server (exit transport)`

Both timed out waiting 5,000 ms for `/m/removeMember`; total case durations were
12,397.211 ms and 12,339.913 ms. The parent also counts as failed. AV changes
React's asset hook and docs; this fixture loads app/web/auth modules, no React
hook, and its product dependencies and wasm are unchanged from the starting
commit. Both cases pass unchanged when run alone:

```sh
SNAPBACK4_WEB_ADMISSION_FOCUS='replacement after validation' \
  node --test packages/snapback4/test/web-admission-review.test.mjs
```

Isolated result: 3 passed, 0 failed, including the parent, with both backend
audit totals zero and `E_STORE_REPLACED` returned. A previous instance of the
exit-transport timeout and passing baseline/candidate controls is recorded in
[Lane OK round 1](../../snapback4/reports/20260928-ok-owner-key-coverage/ROUND1.md#failure-ledger).
No timeout, assertion, or product code was changed to turn this green.

Investigate orphan provider release, adoption scheduling and response observation
under the ordinary concurrent suite. Do not infer product success from a longer
timeout alone. Evidence: [AV report](../../snapback4/reports/20260929-av-asset-resolution/REPORT.md),
its full-suite log and `admission-failures-rerun.log.gz`.

## Resolution — 2026-09-30

A controlled loaded replay shows the silent held change poll triggering the real
four-second silence watchdog. Its unplanned probe discovers replacement B before
the fixture releases the original orphan binding, so no removeMember request is
sent; another sixty seconds of waiting does not create it. The held stream now
emits whitespace heartbeats, preserving transport liveness without releasing the
held evidence. The original five-second response wait, both transports, refusal
and zero-audit assertions remain. The negative control fails before this fix;
the affected loaded checks and subsequent complete heavy/slow suites pass both
cases. See CASE-NOTES and TEST-CHANGES in the SL report.

This closes the orphan-response fixture premise only. The distinct historical
Mac browser-close stalls remain open in
[their investigation ticket](../20260929-snapback4-browser-close-stalls-under-publication-load.md).

[SL report](../../snapback4/reports/20260929-sl-suite-under-load/REPORT.md) includes raw baseline, negative-control and corrected-suite logs.
