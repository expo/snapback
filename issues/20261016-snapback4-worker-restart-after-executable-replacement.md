# Snapback4 worker restart fails after the running executable is replaced

Status: Open
Found: 2026-10-16 (SURF3 qualification)
Systems: Snapback4 worker supervisor, Linux executable lifecycle
Affects: inherited on baseline59fb4ead1b /0.4.29; not introduced by SURF3

`worker_process.rs:33` resolves `std::env::current_exe()` for a supervised worker
launch. On Linux, atomically replacing a running host's executable leaves its
`/proc/<host-pid>/exe` pointing to the original path with ` (deleted)` appended.
The next owned-worker restart tries that nonexistent path and repeatedly prints:

```text
snapback4 worker: cannot start: No such file or directory (os error 2)
```

Reproduced with a private copy of the current CLI: start a dev with an owned
worker; replace the copied CLI path atomically with identical bytes; terminate
only that host's owned worker. The host remains live but cannot restart its
worker. Scratch host/worker and files were cleaned up. The worker process source
and affected server-e2e test are unchanged from baseline.

This also explained the first full client pool's parked-action E2E timeout while
concurrent Cargo commands relinked the shared test CLI. With that executable
stable, the complete unchanged server-e2e file passed9/9. Qualification should
keep the tested executable stable, but that does not repair this runtime bug.

Acceptance: an executable replacement cannot wedge worker recovery, and the
worker/host version relationship stays deliberate. Add a real process regression
that atomically replaces an owned scratch executable and restarts only its owned
worker. Choose the worker version/lifetime contract before implementation;
blindly launching a different newly installed binary may introduce a host/worker
compatibility mismatch. Run affected process/path tests on Linux and Darwin.

Evidence and scope: [SURF3 report](../WORKSTREAM-REPORT.md), initial and repaired
server-e2e qualification. No production source workaround landed in SURF3.
