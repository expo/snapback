# Snapback 4: export-background's SIGKILL custody case times out under load

- Opened: 2026-10-07
- Area: `snapback4/packages/snapback4/test/export-background.test.mjs` (lane NZ's background native proof for `export:ios`) and the retention custody it exercises
- Source: the 0.4.14 Darwin publication dry run, attempt 3 (third cut, release 846dab815c, the M5)

## Observed

The dry run passed 323 of 324 client files and both serial model files. It failed one file:

- `export-background.test.mjs` took 1,426 s. Test 19, "blocked retention has bounded custody: before SIGKILL", failed with `testTimeoutFailure` after 90,000 ms.
- Its sibling custody cases passed but were slow: "before deadline" took 52.7 s, its compressor group draining in 29 s; "before supersede" took 32.7 s.
- The runner then reported `TEST_FILE_LEAK`: two node process groups, started at 03:38:57 local, were still alive after the cleanup deadline.

The same file passed in the 0.4.14 first cut's dry run and in lane NZ's Mac suites. Lane RX also recorded an intermittent export-test failure on Linux. The M5 carries heavy load from other sessions' simulators and builds. Attempt 4 reran the same release bytes.

## Why it matters

A publication dry run takes about 2.5 hours on the signing host. A load-sensitive 90 s bound in one custody case can sink a whole qualified release, and the timed-out case leaks its process groups.

## Expected

- Bound the custody case by state, not by wall time. Wait for the drained or superseded custody evidence with a bound that reflects the custody contract under load, and keep one generous outer timeout.
- Check that the SIGKILL path itself has no real slowness compared with the SIGTERM and supersede paths. If custody after SIGKILL is slow under load, say why.
- A timed-out case must reap the process groups it started, so the file cannot leak.

## Resolution — 2026-10-07, Lane FL

Closed. The custody cases now observe complete group/guardian exit and lease
release within the existing 30-second work plus 60-second drain contract, with
scheduling slack and one generous outer guard. CLI status, lock-busy refusal,
real deadline evidence and subsequent publication assertions remain. Abort-aware
waits and an awaited after-hook reap fixture custody even when Node times out.
The mock compressor members have a teardown-only self-group kill escape hatch.

The pre-driver cases now exercise the real Linux custody implementation on
eb1000, with a private wrapper fixture selecting background publication. All
20 loaded repetitions pass for SIGKILL, SIGTERM and supersede; SIGKILL shows no
additional delay. No product slowness or product change is established. This
is Linux evidence; Darwin QoS and the post-driver simulator cases were not run.

The native-drain-disabled negative control fails its bounded state check, and
a forced Node test timeout reaps both compressor members and native custody
without a file-runner leak. The five affected export files pass 80 tests with
33 existing platform skips. The separate read-evidence flake is also fixed and
passes 20 loaded runs plus exhaustive non-sequence field negative controls.

[Report, measurements, controls and reproduction scripts](../../snapback4/reports/20261007-fl-dry-run-flakes/REPORT.md).
No push or publication.

Round-5 follow-up: identity refusal no longer abandons an owned inspection
child; interpreter commands validate, and inspector compilation escalates
from TERM to KILL and reaps. The custody assertions and cleanup protocol stay
intact. The separate stderr-saturation recovery race now waits for a refusal
whose operation was absent before draining. The ticket remains closed;
[round-5 resolution and controls](../../snapback4/reports/20261007-fl-dry-run-flakes/round-5/REPORT.md)
record the additional fixes and platform limits.

Round 6 extends compiler cleanup from its driver to the whole private group,
then verifies that no living group member remains. Recorded-PID fault checks
remain immediate identity checks with a residual exit/reuse race; owned
children use retained handles. [Resolution and evidence](../../snapback4/reports/20261007-fl-dry-run-flakes/round-6/REPORT.md).
