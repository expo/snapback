# Snapback 4: witness preparation cleanup misses its 5-second deadline on a busy Mac

- Opened: 2026-10-03
- Area: Snapback 4 CLI, `snapback4 witness` native preparation (`crates/snapback4/src/verbs/witness/{preparation,recovery}.rs`), behind `npm run export:ios`
- Source: the 0.4.12 Darwin publication dry run, attempt 8, on the M5 (`snapback4/reports/20261002-publication-0.4.12/attempt-8-publication-dry-run.log`)

## Observed

Attempt 8 failed one test, `== 1 failure(s) in 6613 s`. Every client phase passed.

```
verbs::witness::preparation::tests::recovery_volta_style_shim_drains_late_group_member --- FAILED
panicked at crates/snapback4/src/verbs/witness/preparation.rs:349:26:
called `Result::unwrap()` on an `Err` value: "E_WITNESS_PROCESS: native preparation watchdog cleanup did not finish; recovery required"
```

The same test, at the same source, passed in attempt 7 on the same host. The error comes from `PreparationProcess::cleanup()`: after closing the supervisor's stdin, it allows a fixed 5 seconds for the supervisor to exit.

## Likely cause (measured cost, unproven link)

On Darwin, `recovery::members(group)` runs `ps -axo pid=,pgid=,stat=` over the **whole system** on every poll, then calls `identity(pid)` for each member. The cleanup loops need two consecutive empty snapshots, 20 ms apart.

- The M5 runs about 5,300 processes. While attempt 9's build ran (load 113), one such `ps` took 0.13–0.47 s; the office M1 (about 1,150 processes) took 0.08–0.10 s.
- Enumeration cost therefore scales with the host's process count and load, not with the group's size. A few polls, plus the supervisor's own cleanup, can plausibly exceed a fixed 5-second window on a busy developer Mac.

This path is also the product path. `npm run export:ios`, which every Expo milestone runs since lane NX, prepares through `PreparationProcess`, so a busy builder Mac could see `E_WITNESS_PROCESS … recovery required` from an honest export.

## Proposed fix

1. On Darwin, enumerate the group directly instead of scanning every process: `sysctl` with `KERN_PROC_PGRP`, or libproc's `proc_listpgrppids`. Keep the birth/identity checks.
2. Make the cleanup deadline progress-based rather than a fixed 5 s from EOF: extend it while the supervisor or the group is still observably shrinking, with a generous hard cap, and keep `recovery required` for real stalls.
3. Add a regression that runs the late-member and cleanup tests while a helper holds several thousand idle processes, or while `ps` is slowed through a `PATH` shim on the enumeration command, and record the timings.

Confirm the cause on a Mac before changing the deadline. Do not raise the timeout alone.
