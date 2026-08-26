# Diagnose-a-binding-identity-mismatch does not describe a same-owner successor

**Filed:** 2026-08-26
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-explicit`
**Systems:** Guide, React/Expo, Diagnostics
**Owner:** LLP 0310 P12 — straightforward guide ticket; independent of Track A recook
**Related:** `issues/20260825-successor-expo-receipt-stale.md`, LLP 0310 F1 / F5.3, LLP 0310.000 Track A

## Problem

`SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` after a *legal* additive successor
in the same `snapback dev` owner. Generated files named the new descriptor;
the running Expo extra still named the M1 descriptor. The served diagnose
page (`guide/clients/react-expo.md#diagnose-a-binding-identity-mismatch`)
says to restart only when the mismatch came from a different or stale
supervisor. This mismatch came from the *same* supervisor. The lane had no
documented non-destructive recovery and correctly refused `pkill`.

Track A (recook) is the product fix. This ticket is the page. Agents will
keep hitting the diagnostic until recook ships; the page must not send them
into a restart/`pkill` loop.

## Evidence

- `benchmarks/runs/2026-08-25-clique-grok-0127/cells/grok-clique-explicit/run-log.md`
  (1787658263 knowledge-lookup, 1787659000 defect)
- LLP 0310 P12

## Direction

On `#diagnose-a-binding-identity-mismatch`:

- Same-owner successor (backend `startup-successor-activated`, extra still
  names the predecessor) is a product bug, not a wrong-backend refusal.
- Do not tell agents to `pkill` or to restart as the paved recovery.
- Until Track A lands: owner restart against the same sqlite is a fallback,
  not the paved path. After Track A: point at
  `snapback.expo.binding-recooked.v1` and restart only on
  `recook-failed-successor-refused`.
- Foreign backend, stale supervisor, unmatched predecessor stay mismatch
  with no recook (LLP 0302 unchanged).

Retrieval case that `snapback guide SNAPBACK_APP_BINDING_IDENTITY_MISMATCH`
still lands here and now mentions same-owner successor.
