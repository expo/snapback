# The test-support surface is no longer a side quest: it blocks named rows

Status: open
Date: 2026-08-25
Systems: snapback-engine, snapback-kernel
Related: llp/0291-authority-forgery-surface.research.md,
  llp/0303-subject-authority-correlation-policy.decision.md,
  issues/shelved/20260825-the-critical-path-is-the-shared-surface-not-the-rows.md,
  issues/shelved/20260825-production-equivalent-is-not-a-clearing-rule.md

## What changed

The `test-support` surface has been described as this programme's critical path for a while, but
abstractly — "it makes rows un-landable". It is now concrete. Two adversarial reviews in the same cycle
rejected two *unrelated* row fixes for the same reason: a `test-support` accessor reaches the protected
effect without passing through the fix.

| Row | Fix judged | Blocking accessor | What it hands out |
|---|---|---|---|
| **F170** | correct at both integration producers | `snapback_engine::test_support::auth_database_mut` (`crates/snapback-engine/src/test_support.rs:73`) | the target's **mutable `LocalDatabase`**; `register_agent_principal_with_class` then takes **no lease at all** and writes the integration record plus credential |
| **F053** | correct, with the programme's best fail-first | `insert_session_tombstone_for_test` (`crates/snapback-kernel/src/storage/auth_catalog_ops.rs:5698`) | a caller-chosen `(token_hash, session_id, superseded_at_ms)`; planting a fresh bearer's hash as an in-grace tombstone makes it **resolve as the victim** |

Both were executed from dependent crates. Both changed durable state. In both cases the row's own fix
was independently confirmed correct — the accessor simply routes around it.

## Why this is a scheduling fact, not a code observation

A route audit already established that `auth_database_mut` has **no production justification**, with 6
direct and roughly 150 indirect cross-crate test call sites. So neither row can close by local effort:

- F170's lane cannot delete an accessor whose removal requires migrating ~150 call sites.
- F053's lane cannot make a kernel fixture writer private without the same surface work.

Patching locally would produce exactly the outcome this programme has been correcting all cycle — a fix
that passes its review and leaves the row open. **These rows are blocked on the surface lane, and should
be sequenced behind it rather than iterated in place.**

## LLP 0291 predicted one of them, and has now predicted two

`llp/0291-authority-forgery-surface.research.md:240` records that a chosen hash resolves a victim's live
session through supersession grace — F053's exact defect — and the document has been **Active since
2026-08-20**. It also enumerated R14–R16, the root that reopened nine rows.

That is twice that a finding costing a lane a full round was already written down. The corpus is not the
problem; reading it before staffing is. Orientation is a documented step in this repository's own
workflow, and skipping it has now cost two rounds on two separate rows.

## The rule this supports

`issues/shelved/20260825-production-equivalent-is-not-a-clearing-rule.md` established that an item is
production-equivalent only if a dependent cannot **compose** it with something production cannot reach.
Both accessors above pass the per-item test and fail the composition test: production does register
integrations, and production does write tombstones — but production never hands a dependent the mutable
database, or lets it choose the tombstone's identity.
