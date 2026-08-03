# Close the workerd worker-port handoff race

**Status:** Open
**Systems:** local V8 twin, workerd invocation harness, acceptance tests
**Related:** LLP 0048; `src/workerd_exec.rs`; `tests/workerd_twin_v0.rs`

The exact-head Linux proof for the LLP 0132 vector-search landing exposed an
unrelated transient correctness failure in
`workerd_twin_v0::v8_mutation_commits_end_to_end`. Workerd failed to become
ready because its generated listener could not bind `127.0.0.1:44369`:
`Address already in use`. No workerd process retained that port after the
failure, and an immediate exact-test retry passed.

`run_handler_workerd` reserves an ephemeral worker port with a Rust
`TcpListener`, drops that reservation, and then spawns workerd to bind the same
number. The comment correctly identifies the remaining spawn-handoff TOCTOU
window. Parallel conformance tests can still reclaim the released port during
that window, turning a healthy handler invocation into
`SNAPBACK_V8_RUNNER_START_FAILED` after the ten-second readiness timeout.

This was observed on commit `983a9b8bb6fd65178229f07c91d1ed64fa17f3db` on
the `expo-build-1000` Linux verifier during a full normal-parallelism Cargo
run. The isolated retry command was:

```sh
cargo test --locked --test workerd_twin_v0 \
  v8_mutation_commits_end_to_end -- --exact --nocapture
```

It passed 1/1. The vector lane does not own the LLP 0048 runner and has not
changed or suppressed this behavior.

## Exit

- Workerd startup no longer depends on an unowned numeric port across the
  reservation-to-spawn handoff, or performs a bounded safe retry on a proven
  bind collision without replaying handler effects.
- A parallel-start acceptance test makes the collision path reproducible and
  stays green under the normal Cargo test runner.
- Startup diagnostics distinguish a bind collision from a generic readiness
  timeout without exposing invocation capabilities or private paths.
- The full `workerd_twin_v0` suite and repository Cargo proof pass at normal
  test parallelism on Linux.

## Resolution (2026-08-03)

Fixed by owned-port handoff, the first exit option: `run_handler_workerd`
now keeps the reservation `TcpListener` alive and hands its descriptor to
workerd via `--socket-fd=http=<fd>` (the workerd `serve` override for the
config's `http` socket), so startup never depends on an unowned numeric
port between reservation and spawn. `FD_CLOEXEC` is cleared in the forked
child only (`pre_exec`), so exactly the intended workerd inherits the
listener and concurrent spawns on other threads cannot leak the socket;
the parent drops its copy immediately after spawn so the port dies with
the invocation process. Non-unix hosts cannot pass a descriptor across
spawn portably and keep the previous drop-before-spawn behavior with the
narrow handoff window (documented in-line).

- `src/workerd_exec.rs` — owned handoff plus startup diagnostics:
  `startup_failure` now reports `startupFailureKind` of
  `portBindCollision` (proven `Address already in use` in the redacted
  stderr tail) vs `readinessTimeout`, same fail-closed
  `SNAPBACK_V8_RUNNER_START_FAILED` code, no capability or private-path
  exposure.
- `tests/workerd_twin_v0.rs` — new
  `v8_parallel_starts_do_not_collide_on_the_worker_port`: 8 simultaneous
  first-start invocations, each spawning its own workerd, all must come
  up under the normal parallel test runner.

Evidence (macOS, worktree at 0e43800c0 + this change): full
`cargo test --locked --test workerd_twin_v0` = 31/31 passed at normal
parallelism, including the new regression test; `--lib workerd` unit
tests 10/10. The Linux full-proof leg runs the same suite in CI. The
exact-test retry from the filing remains green.
