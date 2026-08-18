# Identity-binding refusal loses precedence to generic write policy on the JS handler path

**Status:** Open
**Filed:** 2026-08-17
**Revised:** 2026-08-18 (recharacterized after dual review — this is a product
refusal-order question, **not** the fixture-drift issue the first draft
described; two independent reviewers flagged that framing as the defect)
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

Fix: give `records` an explicit policy per LLP 0264 D3 (`owner` + `Principal`,
omitting the authored owner). **Trap:** setting `owner` on `principal` without
also dropping `principal:` from `createBinding` yields
`SNAPBACK_AUTH_OWNER_INPUT_REFUSED`, not the code the sibling test asserts.

### 2. A refusal-order regression — do NOT "fix" this with a fixture edit

`ordinary_handler_cannot_write_declared_identity_binding_table` expects
`SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN` and instead gets
`SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED`.

The cause is ordering, not the fixture. On the JavaScript handler path,
`ctx.db.insert` resolves **generic** write policy at `src/runtime.rs:3902` and
returns the undeclared-table refusal *before* the write is buffered and
therefore before the identity-binding seal at `src/storage.rs:4674` can fire.
LLP 0214 §5.9 specifies the specialized binding refusal as
**policy-independent**, so a generic policy outcome should not be able to
preempt it.

The HostPlan path already implements the intended order: the binding seal runs
at `src/storage.rs:3038`, ahead of owner-check validation at
`src/storage.rs:3167`. So the two paths disagree with each other, which is the
clearest evidence that this is a defect rather than a deliberate choice.

**Why a fixture edit is the wrong fix, and dangerous:** changing the fixture to
`public-read` makes the assertion pass while leaving the precedence inversion in
place — the test would then assert nothing about ordering. Switching it to an
`owner` policy masks it differently, with an owner-input refusal. Either way a
real authorization-ordering bug becomes invisible. Do not treat "add some
visibility until `BINDING_FORBIDDEN` appears" as proof of precedence.

## Disposition — needs a ruling

Two defensible outcomes; pick one deliberately rather than by fixture:

- **(a) Fix the ordering (recommended).** Enforce the identity-binding seal
  before generic-policy resolution in all three handler write arms, matching the
  HostPlan path and LLP 0214 §5.9. Add precedence coverage across undeclared,
  non-owner, and owner policies so the ordering is pinned rather than incidental.
- **(b) Ratify the current behavior.** Classify identity-binding like LLP 0264
  D6 so the JS fence does not emit `UNDECLARED` for these tables, or amend
  LLP 0214 §5.9 to state that `UNDECLARED` is the intended code when visibility
  is omitted. If this path is chosen, the LLP must say so explicitly — today the
  spec and the code disagree.

## Provenance

Found while repairing the `rust-tests` compile hole during LLP 0276 Phase 1
verification: the assertion had been unreachable for ~36 hours because the
target would not compile, so `4fe648fd0` landed this ordering change without the
test that covers it ever running. Recharacterized after two independent reviews
(codex gpt-5.6-sol, grok-4.6) both rejected the fixture-drift framing.
