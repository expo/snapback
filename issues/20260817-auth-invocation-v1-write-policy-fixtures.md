# `auth_invocation_v1` write-policy fixtures mask two auth assertions after LLP 0264

**Status:** Open
**Filed:** 2026-08-17
**Systems:** Auth, Security/authorization, Testing
**Related:** LLP 0264, LLP 0214,
`issues/closed/20260817-rust-tests-gate-red-auth-invocation-v1.md`, `4fe648fd0`

## Finding

After repairing the integration target's missing `MutationPlan` field,
`CARGO_PROFILE_DEV_DEBUG=0 cargo test --test auth_invocation_v1` reports two
LLP 0264 integration failures:

- `nested_mutation_inherits_outer_authority_and_action_errors_stay_enveloped`
  expects the authenticated nested mutation to succeed, but its `records`
  table still has `visibility: None`; the allowed action now fails with
  `SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED`.
- `ordinary_handler_cannot_write_declared_identity_binding_table` expects
  `SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN`, but the first buffered handler write
  instead fails with `SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED` because the
  `identityBindings` table also has `visibility: None`.

The second failure aborts the test before its buffered batch assertion and the
five-form HostPlan loop run. The test therefore does not currently prove the
complete LLP 0214 identity-binding seal it names, even though the plan helper's
empty `owner_write_checks` value is correct: an identity-binding table is not
an owner-policy point-write carrier.

## Required repair

Adapt both fixtures to honest explicit table policies while preserving their
auth assertions. For the principal-bearing `records` fixture, prefer a real
owner policy, a `Principal` owner field, and host-stamped insertion rather than
using Phase 1a `public-read` migration behavior merely to make the test pass.
For the sealed identity-binding table, decide and document the honest read
policy and verify that specialized binding refusal has the intended precedence
for buffered and all five HostPlan generic forms.

Do not add an `OwnerWriteCheckV1` to the identity-binding plans: LLP 0264 D4
allows that carrier only for owner-policy `Patch`/`Delete`, and storage rejects
a check bound to any other step/policy.

## Acceptance

- The nested action still proves anonymous denial, zero denied effects,
  inherited authenticated authority, and a host-stamped owner.
- Buffered single and batch identity-binding writes, plus HostPlan
  `Insert`/`Patch`/`Delete`/`DeleteWhere`/`InsertEach`, all reach the exact
  specialized `SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN` assertion.
- No fixture assertion is weakened to accept `SNAPBACK_TABLE_WRITE_UNDECLARED_REFUSED`.
- The selected tests pass independently; the complete integration target may
  remain red only for separately ticketed failures.
