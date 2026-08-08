# guide-gap: agents cannot reliably select or interpret the demo portfolio

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Demos, examples, guide, inventory checks
**Date:** 2026-08-08
**Related:** LLP 0015, LLP 0016, LLP 0061, LLP 0186, LLP 0195, LLP 0196

## Summary

The inventory checker recognizes 25 metadata-declared demos, but there is no
maintained top-level catalog that lets an agent choose among them by client,
feature, maturity, proof level, or known gap. The root README names only a few
early demos.

Three catalogued demos have no local README:

- `demos/browser-local-first`;
- `demos/chirp`; and
- `demos/cursors-web`.

Several other READMEs are only 11–16 lines and do not consistently state the
run command, intended lesson, supported target, retained proof, or nonclaims.
The issue is the missing information contract, not a minimum line count.

The machine-readable manifests can also preserve historical claims without an
obvious time boundary. For example, the `todo`, `todo-v2`, and `graffiti`
manifests still call the React/Expo adapter a blocked v0 capability gap even
though first-party React/Expo bindings now ship. These demos may intentionally
be historical/floor witnesses, but the manifests do not make that status or
`asOf` boundary clear to an arriving author. `check-inventories.mjs` validates
presence and shape, not whether a manifest is current, frozen, or contradicted
by the capability registry.

## Ask

Generate or maintain an intent-indexed demo/example catalog from structured
metadata. Define a small documentation contract for catalogued demos: what the
example teaches, client/target, maturity, canonical run and proof commands,
expected evidence, and honest nonclaims. Give historical/frozen witnesses an
explicit `asOf`/status model instead of letting old GAP language look current.

This should feed the guide/public-doc work in LLP 0195 and the small canonical
template/recipe portfolio in LLP 0196, not create an unrelated gallery.

## Acceptance

- Every metadata-declared demo appears in a guide-reachable catalog with enough
  structured information for an agent to choose it without opening all 25.
- Every catalogued demo has either the minimum README contract or an explicit
  machine-readable waiver/frozen-witness reason.
- The three known README omissions are resolved.
- Historical manifests declare their time/status boundary; current manifests
  cannot contradict the capability index silently.
- The inventory check covers the catalog/documentation joins and has failure
  fixtures for an undocumented demo and an unqualified stale GAP claim.

