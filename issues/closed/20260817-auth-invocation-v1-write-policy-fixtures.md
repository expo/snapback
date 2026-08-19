# Identity-binding refusal loses precedence to generic write policy on the JS handler path

**Status:** Resolved
**Filed:** 2026-08-17
**Revised:** 2026-08-18 (recharacterized after dual review — this is a product
refusal-order question, **not** the fixture-drift issue the first draft
described; two independent reviewers flagged that framing as the defect)
**Resolved:** 2026-08-19 (author ruled for the policy-independent refusal order)
**Systems:** Auth, Security/authorization, Testing
**Related:** LLP 0264, LLP 0214 §5.9,
`issues/closed/20260817-rust-tests-gate-red-auth-invocation-v1.md`, `4fe648fd0`

## Two separate things, previously conflated

Repairing the `MutationPlan` compile hole made
`cargo test --test auth_invocation_v1` runnable again. It reports two LLP 0264
failures. The first draft of this ticket called both "fixture drift." Only one
of them is.

### 1. Genuine fixture drift (safe to fix as written)

`nested_mutation_inherits_outer_authority_and_action_errors_stay_enveloped`
expects an authenticated nested mutation to succeed, but its `records` table
still carries `visibility: None`, so after `4fe648fd0` the allowed action now
fails with `SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED`. The fixture predates the
staged migration window and should declare a policy.

Fix: give `records` an explicit policy per LLP 0264 D3 (`owner` + `String`,
omitting the authored owner). **Trap:** setting `owner` on `principal` without
also dropping `principal:` from `createBinding` yields
`SNAPBACK_AUTH_OWNER_INPUT_REFUSED`, not the code the sibling test asserts.

### 2. A refusal-order regression — do NOT "fix" this with a fixture edit

`ordinary_handler_cannot_write_declared_identity_binding_table` expects
`SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN` and instead gets
`SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED`.

The cause is ordering, not the fixture. The original report's pre-carve paths
were `crates/snapback/src/runtime.rs:3902` and
`crates/snapback/src/storage.rs:4674`. After the LLP 0276 workspace carve, the
JavaScript arms and their generic-policy preparation live in
`crates/snapback-engine/src/runtime/host_glue.rs`, while the durable buffered
seal lives in `crates/snapback-kernel/src/storage.rs`. The JavaScript path
returned the undeclared-table refusal before a write was buffered and therefore
before the durable identity-binding seal could fire.
LLP 0214 §5.9 specifies the specialized binding refusal as
**policy-independent**, so a generic policy outcome should not be able to
preempt it.

The HostPlan path already implements the intended order in
`snapback-kernel`'s `execute_mutation_plan_with_lifecycle_and_settlement_time`:
the binding seal runs during plan preflight, ahead of owner-policy validation.
So the two paths disagreed with each other, which is the clearest evidence that
this was a defect rather than a deliberate choice.

**Why a fixture edit is the wrong fix, and dangerous:** changing the fixture to
`public-read` makes the assertion pass while leaving the precedence inversion in
place — the test would then assert nothing about ordering. Switching it to an
`owner` policy masks it differently, with an owner-input refusal. Either way a
real authorization-ordering bug becomes invisible. Do not treat "add some
visibility until `BINDING_FORBIDDEN` appears" as proof of precedence.

## Resolution

The author ruled for the policy-independent ordering in LLP 0214 §5.9.

The kernel's existing identity-binding seal is now callable from the engine,
and the JavaScript generic-write target preparation runs in this order for
`ctx.db.insert`, `ctx.db.patch`, and `ctx.db.delete`:

1. identity-binding seal;
2. specialized permission-backing check; and
3. generic table write-policy resolution.

This matches HostPlan preflight. The integration fixture now pins every
JavaScript generic form and every HostPlan generic form, and covers binding
tables with undeclared, `public-read`, and `owner` policies. All receive
`SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN`.

The only changed refusal pairs are those in which the target is a declared
identity-binding table. `SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN` now wins over:

- `SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED`, because a binding declaration is
  sealed independently of the table's generic policy;
- `SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED` and
  `SNAPBACK_TABLE_WRITE_OWNER_IMMUTABLE`, because an ordinary writer may not
  reach owner-value validation on a sealed binding table;
- `SNAPBACK_AUTH_USER_MISSING`, because a missing owner principal cannot make
  an otherwise forbidden binding write admissible; and
- `SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED`, for the unusual intersection
  of identity-binding and non-membership `permissionBacking`, because the
  binding seal is the more specific, policy-independent prohibition.

These are all consequences of the same declared-table seal. Non-binding tables
retain their existing refusal order. The write-surface check, buffered-write
capacity check, and table-argument parsing remain earlier than target-policy
preparation, so their precedence is unchanged.

The genuine fixture drift was repaired separately in the same test: `records`
now declares `owner { field: "owner" }` over its admitted `String` field, and
`createRecord` omits authored owner input so the host stamps it. The nested
authenticated action succeeds and still produces an owner of `user_1`.

LLP 0264 D10 was amended in the follow-up fix round: its statement that owning
parse/schema failures always remain earlier contradicted both the repaired
JavaScript path and existing HostPlan preflight. D10 now places LLP 0214
§5.9's independent seal ahead of the policy-refusal list and records the
bounded schema-enumeration consequence explicitly.

## Verification

The two task-specific integration tests pass individually. The complete
`auth_invocation_v1` target reaches 4/5: its only failure is the separately
tracked `handler_projection_is_exact_null_prototype_and_deep_frozen`
`SNAPBACK_HANDLER_EXPORT_MISSING` issue, unrelated to either resolution here.

## Provenance

Found while repairing the `rust-tests` compile hole during LLP 0276 Phase 1
verification: the assertion had been unreachable for ~36 hours because the
target would not compile, so `4fe648fd0` landed this ordering change without the
test that covers it ever running. Recharacterized after two independent reviews
(codex gpt-5.6-sol, grok-4.6) both rejected the fixture-drift framing.
