# Stale handle membership plan bypasses successor transition policy

**Status:** open
**Date:** 2026-08-26
**Area:** membership authority; schema freshness; transition admission
**Related:** LLP 0303, F182, `issues/shelved/20260826-stale-handle-schema-policy-sibling-survey.md`

## Finding

Family 3 **REACHES EFFECT**. `plan_membership_remove` clones `self.schema` at
`crates/snapback-kernel/src/storage/membership_plans.rs:696` and admits the removal against its
transition list at lines 710–739. The later `commit_membership_plan` does not re-derive transition
authority from the resource's active manifest.

## Executed two-handle composition

The ignored regression witness is
`storage::tests::membership_write_tests::stale_predecessor_manifest_reaches_membership_remove_effect`.
It ran this schedule against one SQLite file:

1. Open handle A and durably publish a membership manifest allowing a `host` to remove another
   `guest` or `cohost`.
2. Open handle B. Through A, bootstrap `alice` as host, invite `bob`, and let Bob become a guest.
3. Through B, durably publish a successor manifest with exactly the host-removes-other transition
   removed.
4. Confirm A retains the predecessor and B holds the restrictive successor.
5. As a control, ask B to plan Alice's removal of Bob. B refuses at this policy-use line with
   `SNAPBACK_MEMBERSHIP_TRANSITION_DENIED`.
6. Ask stale A to plan the identical removal, then commit A's returned plan.
7. Through B, read the exact Bob membership row.

Run:

```sh
cargo test -p snapback-kernel stale_predecessor_manifest_reaches_membership_remove_effect -- --ignored --nocapture
```

The observation fired at the witness's effect branch, currently
`crates/snapback-kernel/src/storage/tests.rs:15293`:

```text
FAMILY3_REACHES_EFFECT: use returned Ok(Some(MutationCommit { ... op: Delete ... })); publisher handle B observed row_present=false
```

No error or diagnostic code fired on stale A's plan or commit. The successor control's
`SNAPBACK_MEMBERSHIP_TRANSITION_DENIED` proves the policy difference was operative rather than
cosmetic. The exact durable effect was deletion of Bob's membership row.

## Scope

This ticket is measurement only and makes no fix. The schedule establishes remove-transition
admission; other family-3 operations (insert, role change, transfer, bootstrap, teardown, and
authority-profile variants) remain sibling surfaces rather than separately proven effects here.
