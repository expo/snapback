# Server unit-test target does not compile on main

Status: open
Created: 2026-08-26
Systems: Server, Auth, Kernel, Test support
Related: `issues/20260825-engine-unit-tests-do-not-compile-on-main.md`, LLP 0303

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
