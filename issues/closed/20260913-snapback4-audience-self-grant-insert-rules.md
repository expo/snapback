# Snapback 4: check does not refuse self-granting audience insert rules

Status: Closed
Resolved: 2026-09-13
Priority: P2
Observed: 2026-09-13
Review finding: S10
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [security review](../../llp/reviews/3000-security-review-20260913.md)

## Problem and reproduction

`sync to memberships[.conversationId]` inverts the read rule `exists memberships[.conversationId, viewer]` and is sound only while a viewer cannot insert an arbitrary membership for themselves. `validate_sync` / `audience_binding` require the **read** rule to be exactly that probe. They do not look at the audience table's **insert** rule.

`insert <- .principal = viewer` on `memberships` compiles. Any signed-in principal can then insert `{conversationId: someoneElses, principal: viewer}` and the partition log will deliver that conversation's rows (last N) on the next snapshot/stream.

The chat schema is correct (`insert <- exists memberships[..., viewer, 'admin']`). The compiler will not save the next app.

## Acceptance

- `check` refuses an audience/target table whose insert rule lets the viewer write a row that names themselves as `principal` (or the sync `by` column) without an independent grant probe, **or** documents this as an authoring security card with a `why` diagnostic that fires as a note that fails CI in `check --strict` if that is the chosen bar.
- The chat schema stays green.
- Cover `insert if absent` and `upsert`.

## Implementation locations

- [crates/snapback4-core/src/schema.rs](../../snapback4/crates/snapback4-core/src/schema.rs) (`validate_sync`, `audience_binding`)
- [crates/snapback4-lang/src/bind/schema.rs](../../snapback4/crates/snapback4-lang/src/bind/schema.rs)

## Resolution — 2026-09-13

Schema checking requires an independent audience grant in every insert-rule branch and guards changes to audience group/recipient columns. Exists grants must probe the same audience table through a plain index with the actual recipient slot bound to viewer and matching group fields; a freshly created group is admitted only through its referenced primary key. Decoy tables and self-grants are refused before any insert, insert-if-absent, or upsert can execute. Existing chat and newly integrated guide/fixture schemas pass with guarded membership creation. Regressions cover disjunctions, retargeting, decoys, recipient position, and created-group keys.

Delivery validation and independent review for the current-main port are in
the [remediation record](../../llp/reviews/3000-security-remediation-20260913.md).
