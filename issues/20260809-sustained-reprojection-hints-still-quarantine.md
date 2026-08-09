# Sustained-load reprojection/backpressure hint frames still quarantine the boundary

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Systems:** Live queries, Auth, Client SDK
**Date:** 2026-08-09
**Related:** LLP 0200 §2.4/§2.6 (§6c Phase-2 record), LLP 0053
(dispositions — the `retain` producer row), bc26e015b (same-envelope
atomic application)

## Measured

After the Phase-2 same-envelope atomic application landed, the
six-observer burst arm shows ZERO `authorization_quarantine` callbacks on
ordinary data (was 24). The sustained arm dropped 135 → 42: every
delivery now commits exactly once, and the 42 residue is isolated
obligation-only frames (obligation without a same-envelope resolution)
that blank the boundary until the next delivery restores it — roughly 5–7
per observer per sustained window (`oq4` p2-sustained-on arm; pattern:
snapshot@V → quarantine@V → snapshot@V+Δ).

## Diagnosis (partial)

These are not authority transitions (none fire on this arm) and not the
overload-degrade conversion (1 per run). They are level-triggered
reprojection/backpressure hint frames for pending (un-ACKed or
revision-advanced) obligations under sustained load — the server
re-projects pending truth at delivery boundaries, and a projection whose
issued resolution no longer matches the merged obligation revision
arrives ticketless. The exact emitting path needs pinning
(`reproject_authorization_invalidations` vs the enqueue/ACK race).

## Ask

Either (a) reprojection carries the CURRENT issued resolution whenever
one satisfies the merged obligation, or (b) hint frames for scopes with
no pending shrink/error evidence ride LLP 0053's `retain` producer
("overflow/fan-out recovery with no pending auth-scoped shrink/error
obligation"). Both stay inside LLP 0053's closed enumeration; (a) is
likely the smaller change. Requalify with the p2-sustained-on arm; target
zero delivery-independent quarantines within capacity.
