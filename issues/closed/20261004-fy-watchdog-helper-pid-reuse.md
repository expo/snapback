# Snapback 4: watchdog SIGTERM fixture confuses a helper PID with its identity

Status: Closed — resolved 2026-10-04
Reported by: Lane SU, assigned to FY
Date: 2026-10-04
Baseline: `ce9bef594a`; SU full suite at `2154dc163d` plus test-only Rust changes

After until(() => !alive(first.helper)) returns, a second bare-PID check can observe an unrelated replacement. The current alive probe also catches all inspection errors as death. until already rejects TEST_HANG on timeout; verify it explicitly.

SU observed this failure in the full eb1000 suite; the affected fixture was
byte-identical to main and passed its isolated retry. Keep the production
semantics and descendant-death assertions; do not mask a product defect.

## Resolution

All three watchdog signal variants capture the worker/helper PID and birth
identity while both are live, after a helper readiness handshake, and use the
existing fail-closed `identity`/`live` inspector. Zombies count as exited on
both hosts; another process reusing a PID cannot satisfy the original identity.
Both descendant-death assertions remain. Fixture cleanup closes the owned
watchdog pipe and awaits exit instead of using the generic stale-PID fallback.

The original `until` already rejects `TEST_HANG` with diagnostics, confirmed by
a timer-injection control. A zombie-to-reused-PID simulation explains how its
wait and the next bare-PID check can disagree. Injected inspection failure now
throws. SU's exact PID history was not recorded, so the original event cannot
be attributed retrospectively. No cleanup-order product defect was found.

Verification: each complete affected file passed 30/30 runs on eb1000 under
confined CPU load and 30/30 on the permitted Apartment mini. The complete
eb1000 suite passed with zero failures in 1,957 seconds. See the
[FY report](../../snapback4/reports/20261004-fy-fixture-races/REPORT.md)
for controls, source hashes, logs and limits. Test-only repair; nothing pushed.
