# main red: server::auth_mint_host_op projection test overflows default test stack

**Status:** Open
**Date:** 2026-08-11
**Systems:** server, host-ops, auth, testing
**Severity:** medium (the test remains stack-sensitive; the same depth also
exposed a production runtime configuration bug, fixed in the release-candidate
follow-up that gives Tokio workers an explicit 8 MiB stack)

`cargo test --lib 'server::tests::auth_mint_host_op_has_exact_projection_and_sessions_only_activation' -- --exact`
(no DYLD) aborts with `has overflowed its stack` / SIGABRT on default test
threads (~2MB). It is **not** infinite recursion: with
`RUST_MIN_STACK=134217728` (128MB) the same test **passes** (1/0). So the logic
is correct; the projection path is simply deep/stack-hungry and exceeds the 2MB
test-thread default.

The original claim that production Tokio workers already had at least 8 MiB
was incorrect: the shipped `#[tokio::main]` runtime used Tokio's default worker
stack and the Expo supervised-dev session mint reproduced the same abort over
HTTP. The release-candidate fix constructs both native runtimes explicitly
with an 8 MiB worker stack; that real-server path passes at the new floor.
This ticket remains open for the isolated lib-test thread, which still uses
the test harness's smaller default stack.

Because it aborts the whole `server::` lib-test binary, it also masks the rest
of the `server::` suite's results.

Ownership: uncertain. The test was last moved by the 0199 server.rs split
(`d46fd6bb9`, not this program). The LLP 0213/0215 landings added rehearsal
host-ops and the budget projection to the host-op enumeration/projection this
test exercises (213-B/C/215 each touched server/host-op files; 214 touched
none), which plausibly grew the projected structure past the stack margin. A
clean A/B against the pre-landing commit (`0baf14164`) was inconclusive — that
commit's lib-test target does not compile in a current worktree.

Fix options:
1. Reduce recursion/stack depth in the auth mint host-op "exact projection"
   build/compare path (preferred if a single deep recursion or large stack
   frame is identified — that also shrinks every caller's stack use).
2. Run this test's body on a `std::thread::Builder::stack_size(...)` thread
   (localized, if the depth is inherent to the exact-projection comparison).

Workaround meanwhile: `RUST_MIN_STACK=134217728 cargo test --lib 'server::' `.

## Resolved (2026-08-11) — LANDED `1dc0b1277`

Root cause was neither infinite recursion nor an inherently deep comparison: the
shared auth host-op dispatcher generates a 20,400-byte async state machine,
embedded in 32,032- and 37,960-byte parent futures. Deep Axum/Tower polling
exhausted the default ~2MB test stack.

Fixed with option 1 (the ticket's preferred path), not the localized
bigger-test-stack fallback: `Box::pin` on the two large futures in
`src/server.rs` moves them off the poll stack. This shrinks stack use on the
**production** path too, not only under the test harness.

The ticket's claim about Tokio worker stacks is confirmed correct — both native
entry points (`src/main.rs`, `src/bin/snapback-local.rs`) do explicitly
configure 8 MiB worker stacks.

Verified outside the codex sandbox, no `DYLD_FRAMEWORK_PATH`, at the **default**
test stack with no `RUST_MIN_STACK` override:
`test result: ok. 1 passed; 0 failed` for the mint test, and the whole
`server::` binary now completes instead of aborting.
