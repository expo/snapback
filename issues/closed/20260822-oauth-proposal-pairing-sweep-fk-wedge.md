# OAuth proposals were uncapped; their child FK still wedges the pairing sweep

Status: Closed
Created: 2026-08-22
Related: issues/20260822-residual-findings-4-9-disposition.md (which wrongly accepted this),
issues/20260823-oauth-pairing-fk-wedge-deferred.md

> **Partial mitigation (2026-08-23):** OAuth and ordinary pairing creation now
> share a ten-slot unresolved-consent cap. This closes unbounded per-user
> growth and denial-of-service amplification. The `ON DELETE RESTRICT` wedge
> described below is unchanged and remains open in the related deferred issue.

Found while adversarially reviewing a design that had **accepted** OAuth authorization proposals as
harmless bounded debris. That acceptance was based on a code misread. The reality is worse than
debris.

## Two facts

**1. OAuth proposal creation was uncapped (fixed 2026-08-23).**

Normal pairing mint sweeps stale rows, counts live rows where `consumed_at_ms IS NULL`, and caps
them at ten per minting user (`crates/snapback-kernel/src/storage/auth_grants.rs:208`).

OAuth proposal creation used to insert a pairing row directly with
`consumed_at_ms = now`, so the old live-row cap never saw it. It now shares the
transactional `grant_id IS NULL` admission predicate with ordinary pairing.

**2. The child FK can fail the whole sweep.**

The OAuth child references its pairing parent with `ON DELETE RESTRICT`
(`crates/snapback-kernel/src/storage/auth_integrations.rs:52`), while the generic sweep deletes
only the pairing parent (`crates/snapback-kernel/src/storage/auth_grants.rs:1427`). Foreign keys
are enabled (`crates/snapback-kernel/src/storage.rs:6448`), and no OAuth-child sweep was found.

So once an unapproved OAuth request expires, the generic pairing sweep can fail its **entire**
delete with an FK violation.

## Consequence

This is not clutter. A failing sweep still wedges pairing mint, pairing
presentation, and grant-inbox operations for the whole database, and any OAuth
child can still block destructive pairing-parent teardown.

The cap now limits one human to ten unresolved proposals, so that caller can no
longer amplify the defect without bound. One expired proposal remains enough
to trigger the global wedge.

## Fix directions

1. **Done:** route OAuth and ordinary pairing through one shared cap.
2. Add an OAuth-child sweep, or change the FK so the parent delete cascades appropriately.
3. Make the generic sweep resilient: a single undeletable row should not fail the batch.

Item 3 is worth doing regardless — a cleanup path that can be wedged by one row is fragile
independent of this cause.

## Note on how this was missed

The disposition ticket accepted this artifact on the reasoning that pairing rows are "capped per
user". They are — but not on the path OAuth uses. This is a good example of an acceptance argument
that is correct about the mechanism it cites and wrong about whether that mechanism applies.

## Resolution

Closed 2026-08-28. The uncapped OAuth-proposal creation half landed (shared ten-slot unresolved-consent cap). The remaining `ON DELETE RESTRICT` pairing-parent wedge is the whole of `issues/20260823-oauth-pairing-fk-wedge-deferred.md`; keeping both open duplicated the remainder.
