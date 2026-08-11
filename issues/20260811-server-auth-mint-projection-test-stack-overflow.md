# main red: server::auth_mint_host_op projection test overflows default test stack

**Status:** Open
**Date:** 2026-08-11
**Systems:** server, host-ops, auth, testing
**Severity:** low (test-harness stack sensitivity; NOT a correctness or production bug)

`cargo test --lib 'server::tests::auth_mint_host_op_has_exact_projection_and_sessions_only_activation' -- --exact`
(no DYLD) aborts with `has overflowed its stack` / SIGABRT on default test
threads (~2MB). It is **not** infinite recursion: with
`RUST_MIN_STACK=134217728` (128MB) the same test **passes** (1/0). So the logic
is correct; the projection path is simply deep/stack-hungry and exceeds the 2MB
test-thread default. Production threads (tokio/main, ≥8MB) are unaffected.

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
