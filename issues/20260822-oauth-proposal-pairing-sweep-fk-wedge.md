# OAuth proposals are uncapped and their child FK can wedge the pairing sweep

Status: Open — live defect, independent of the fence program
Created: 2026-08-22
Related: issues/20260822-residual-findings-4-9-disposition.md (which wrongly accepted this)

Found while adversarially reviewing a design that had **accepted** OAuth authorization proposals as
harmless bounded debris. That acceptance was based on a code misread. The reality is worse than
debris.

## Two facts

**1. OAuth proposal creation is uncapped.**

Normal pairing mint sweeps stale rows, counts live rows where `consumed_at_ms IS NULL`, and caps
them at ten per minting user (`crates/snapback-kernel/src/storage/auth_grants.rs:208`).

OAuth proposal creation does **not** go through that path. It directly inserts a pairing row with
`consumed_at_ms = now`, performing neither the sweep nor the cap
(`crates/snapback-kernel/src/storage/auth_integrations.rs:821`). Because the row is born
"consumed", the live-row cap never sees it. Each request creates another row.

**2. The child FK can fail the whole sweep.**

The OAuth child references its pairing parent with `ON DELETE RESTRICT`
(`crates/snapback-kernel/src/storage/auth_integrations.rs:52`), while the generic sweep deletes
only the pairing parent (`crates/snapback-kernel/src/storage/auth_grants.rs:1427`). Foreign keys
are enabled (`crates/snapback-kernel/src/storage.rs:6448`), and no OAuth-child sweep was found.

So once an unapproved OAuth request expires, the generic pairing sweep can fail its **entire**
delete with an FK violation.

## Consequence

This is not clutter. A failing sweep can wedge pairing mint and grant-inbox operations — an
availability defect in the auth subsystem, reachable by ordinary use of the OAuth authorization
route.

INFERRED: whether a caller can drive this deliberately depends on how easily unapproved proposals
accumulate and expire. The uncapped insert makes accumulation cheap. Confirming needs a test that
creates proposals, expires them, and then exercises pairing mint and the grant inbox.

## Fix directions

1. Give OAuth proposals their own cap and sweep, or route them through the capped path.
2. Add an OAuth-child sweep, or change the FK so the parent delete cascades appropriately.
3. Make the generic sweep resilient: a single undeletable row should not fail the batch.

Item 3 is worth doing regardless — a cleanup path that can be wedged by one row is fragile
independent of this cause.

## Note on how this was missed

The disposition ticket accepted this artifact on the reasoning that pairing rows are "capped per
user". They are — but not on the path OAuth uses. This is a good example of an acceptance argument
that is correct about the mechanism it cites and wrong about whether that mechanism applies.
