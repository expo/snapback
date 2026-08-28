# Server unit-test target does not compile on main

Status: open
Created: 2026-08-26
Systems: Server, Auth, Kernel, Test support
Related: `issues/closed/20260825-engine-unit-tests-do-not-compile-on-main.md`, LLP 0303

## Finding

While running the focused legitimate F272 width-materialization flows, the
`snapback-server` unit-test target failed before executing any selected test:

```sh
LD_LIBRARY_PATH=$PWD/vendor/ibex/linux/lib \
  cargo test -p snapback-server --lib \
  width_materialization_reservation_wins_before_logout -- --nocapture
```

Rustc reports two `E0624` errors in
`crates/snapback-server/src/server/tests.rs`:

- line 35746 calls private `LocalDatabase::create_agent_principal`;
- line 35756 calls private `LocalDatabase::issue_initial_agent_credential`.

The same visibility narrowing already blocks analogous engine test helpers and
is recorded in the related engine issue, but the server target and its two
call sites were not recorded there. Production libraries compile; this is a
test-target migration gap.

## Required repair

Migrate the server fixture through the ruled public/test-support producer that
replaces the raw principal-plus-credential composition. Do not restore either
raw kernel method to public or expose them through server/activation
`test-support`; LLP 0303 identifies the two-call composition as an authority
producer.

## Resolution — 2026-08-26

The two named errors can no longer occur: `crates/snapback-server/src/server/tests.rs` has **zero**
references to either `create_agent_principal` or `issue_initial_agent_credential`. The test callers
that tripped the narrowing were removed or migrated by intervening work.

Both methods remain `pub(crate)` (`storage/auth_agents.rs:73`,
`storage/auth_agent_credentials.rs:223`), which is correct — the narrowing was deliberate and is
retained. What changed is that the tests no longer reach past it.

**Scope of this verification, stated plainly:** this is source inspection, not compilation. I confirmed
the offending call sites are absent; I did not build the server unit-test target on `main`. Supporting
but indirect evidence: the `landingA` lane, based on `main`, carries a commit
`test: restore workspace all-target compilation` and reports `cargo check --all-targets --workspace`
green — which covers this target, though in a tree with its own additions.

If the target still fails for some other reason, that is a different defect and wants a fresh ticket
naming the actual errors rather than reopening this one.

Related: the sibling `E0599` build break that blocked this target for twenty commits is closed at
`issues/closed/20260826-main-did-not-compile-and-no-gate-caught-it.md`.
