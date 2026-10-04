# FY watchdog fixture needs lifetime-bound fallback custody after watchdog death

Status: Open
Priority: P3
Date: 2026-10-04
Source: Astra round-1 review of `0982b0d5e2..6173f51c74`

The watchdog signal fixture's failure cleanup closes watchdog stdin and waits
for exit. If the watchdog has already died, neither action cleans any surviving
worker/helper. This is a fixture recovery gap; normal signal tests still require
both original descendant identities to die.

## Reproduction

The supplied review control captures the watchdog, worker and helper identities
and opens Linux pidfds before allowing fault injection. Replace the fixture's
`watchdog.kill(signal)` with `watchdog.kill('SIGKILL')`, then await its exit.
The descendant-death assertion fails, but the failed test exits in 0.164 seconds
with its original worker and helper still alive. The review controller uses its
retained pidfds to kill and reap them. A stopped-watchdog control instead resumes
the living watchdog, which then cleans the group successfully.

The supplied controller, loader and result are archived in
[FY Round 2 evidence](../snapback4/reports/20261004-fy-fixture-races/round2-evidence.log.gz).
This is review-provided evidence, not a new orphan-producing FY run.

## Why deferred

The watchdog creates a fresh worker group (`worker_spawn.rs`); an outer test
group does not contain it. The watchdog normally reserves its leader with
`waitid(WNOWAIT)` until the final group kill (`worker_process.rs`). Once that
owner dies, the test has only numeric identities. A birth check followed by
`kill(pid)` or `kill(-pgid)` still permits reuse between observation and signal.
Adding that fallback would weaken custody.

A sound follow-up should retain Linux pidfds before the fault, or arrange an
independent keeper that remains in the worker's group and signals its own
group. It must also cover Darwin, preserve real watchdog signal behavior,
refuse missing custody, and prove both bounded failure reporting and eventual
descendant cleanup after forced owner death. That needs additional lifecycle
plumbing beyond this round's small error-preservation change. No bare-PID/PGID
fallback was added, and the normal descendant-death assertions remain intact.
