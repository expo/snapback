# F182's CLOSED ledger verdict was false under a stale-schema second-handle schedule

- Status: closed
- Created: 2026-08-26
- Area: agents-mode schema cache; row-attack acceptance ledger
- Related: LLP 0303 revision (s), LLP 0311,
  `issues/closed/20260825-f182-schema-cache-and-a-corpus-blind-spot.md`

## Finding

F182 was recorded `CLOSED` because a dependent crate could no longer compose the old partial
principal-creation and initial-credential APIs. That evidence removed a spelling, not the registration
effect. An executed alternate route reaches the same effect in both the production and additive
test-support feature cells.

The checked-in witness now performs this schedule:

1. open a `LocalDatabase` handle and publish a schema with agents mode `Open`;
2. open a second handle to the same database and publish agents mode `Disabled`;
3. call `register_agent_principal` through the first, stale handle; and
4. open a third handle and resolve the issued secret, asserting that the durable user, credential,
   and generation equal the issued values.

The registration call at `tests/fixtures/row-attacks/src/attacks/f182.rs:47` returned `Ok`, and the
third-handle durable readback at line 60 succeeded. No error code fired at the attack expression. Both
executions printed `observed: "OPEN"`:

```text
LD_LIBRARY_PATH=$PWD/vendor/ibex/linux/lib cargo run --quiet \
  --manifest-path tests/fixtures/row-attacks/Cargo.toml --bin f182
LD_LIBRARY_PATH=$PWD/vendor/ibex/linux/lib cargo run --quiet \
  --manifest-path tests/fixtures/row-attacks/Cargo.toml --features additive --bin f182
```

The row ledger and its executable contract now record F182 as `OPEN`. This audit deliberately does
not fix the schema-cache defect.

## Resolution (2026-08-26)

The audit's `OPEN` state was retained as a committed historical fail-first checkpoint before the
repair. Agent registration now loads the active schema manifest through the same connection after
`BEGIN IMMEDIATE`, so a stale handle cannot supply its cached agents mode to the committing effect.

Re-running this exact fixture in both production and additive-test-support now reaches the marked
attack expression and returns `SNAPBACK_AUTH_AGENT_REGISTRATION_DISABLED`. The fixture treats that
exact diagnostic as `CLOSED`; any other error is a harness failure. The alternate integration-class
registration route is covered independently and is refused by the same resource-derived policy.
