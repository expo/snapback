# Server unit tests use private agent fixture operations

Status: open
Date: 2026-08-26
Systems: snapback-server, snapback-kernel, Testing
Related: issues/20260825-engine-unit-tests-do-not-compile-on-main.md

## The defect

The `snapback-server` unit-test cell does not compile on current `origin/main`.
`crates/snapback-server/src/server/tests.rs` calls two kernel operations that are now
crate-private:

```text
error[E0624]: method `create_agent_principal` is private
  --> crates/snapback-server/src/server/tests.rs:35767:12

error[E0624]: method `issue_initial_agent_credential` is private
  --> crates/snapback-server/src/server/tests.rs:35777:29
```

The definitions are `pub(crate)` in
`crates/snapback-kernel/src/storage/auth_agents.rs` and
`crates/snapback-kernel/src/storage/auth_agent_credentials.rs`, respectively.
The failing calls and their visibility are unchanged by the F082/F129 lane that
encountered them.

## Reproduction

From current `origin/main`:

```sh
cargo test --locked -p snapback-server effect_approval_reprepares_original_session_with_catalog_claims -- --nocapture
```

Compilation stops at the two `E0624` diagnostics before the selected test can run.

## What is needed

Migrate the server fixture to a supported authority-derived agent-registration
producer. Do not restore the raw kernel operations merely to make the test compile;
their removal is a security boundary.
