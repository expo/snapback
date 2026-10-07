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
