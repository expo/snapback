# OAuth pairing FK wedge and table rebuild are deferred

Status: Open — proposal growth is bounded; the database-wide wedge and destructive-parent blockers remain
Created: 2026-08-23
Related: issues/closed/20260822-oauth-proposal-pairing-sweep-fk-wedge.md,
issues/20260823-oauth-proposal-bound-and-fk-wedge-design.md

## What is still broken

The wedge is **not fixed**. The pairing-request expiry sweep is global and has
no user predicate. One expired OAuth proposal from one user still makes the
`ON DELETE RESTRICT` child reject the sweep, so pairing-code mint,
pairing-code presentation, and the grant-request inbox fail for every user and
agent on the database.

The lifecycle radius is unchanged too. Any OAuth child, including an unexpired
or approved one, can still block agent-authority termination, application
reset, and Sessions-to-dev teardown when those paths delete its pairing parent.
This change contains no child-first workaround, FK-action change, table
rebuild, or migration.

## What the cap fixes

Ordinary pairing and OAuth proposal creation now share one transactional
count-and-insert primitive. It counts unexpired rows for the minting human with
`grant_id IS NULL`, so OAuth's deliberate `consumed_at_ms = now` cannot bypass
the ten-slot budget. Both production parent producers use that primitive, and
capacity refusal does not evict existing consent.

Creation is therefore bounded per human. The prior unbounded storage growth and
the ability to amplify the eventual denial of service with arbitrarily many
proposals from one authenticated user are closed. The cap does not make an
expired restricted child deletable and does not restore the wedged operations
listed above.

## Why the rebuild was deferred

Two independent reviews each reproduced a distinct silent data-loss path in
the proposed legacy `RESTRICT`-to-`CASCADE` rebuild. A migration that loses
data is worse than the defect it is intended to fix, so the schema change and
its complete migration path are deferred.

1. **Inbound foreign key omitted from the inventory.** Against `175772701`, a
   review fixture equivalent to the later
   `legacy_migration_refuses_inbound_foreign_key_without_data_loss` test at
   `3c25705f5:crates/snapback-kernel/src/storage/auth_integrations.rs:2822`
   created an external child and ran activation. The preservation assertion at
   `3c25705f5:crates/snapback-kernel/src/storage/auth_integrations.rs:2866`
   observed `left: 0, right: 1`: the rebuild completed while deleting the
   inbound child.
2. **TEMP-shadow escape in the added guard.** At
   `3c25705f5:crates/snapback-kernel/src/storage/auth_integrations.rs:404`, the
   guard prepares `pragma_foreign_key_list(?1)` and binds unqualified table
   names. SQLite resolves those names TEMP-first. A review reproduction created
   a same-named TEMP shadow without the inbound FK and retained the real child
   in `main`; the observed trace was `guard-sees=0` followed by
   `main-child-count=0`. The guard therefore approved the rebuild and the real
   child was silently deleted.

The inbound-FK/view/trigger preflight belongs only to that unsafe rebuild and
is not carried into the cap-only change.

## Open design question

"enumerate every hazard and refuse" has now failed twice, so the next attempt
should consider failing CLOSED on any unexpected schema object rather than
enumerating known ones.
