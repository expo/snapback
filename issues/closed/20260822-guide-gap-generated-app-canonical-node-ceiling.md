# guide-gap: generated `app` can exceed CanonicalClientValue 4096 nodes and refuse Expo boot

**Status:** Resolved
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Guide, React/Expo, Codegen, Client integration
**Date:** 2026-08-22
**Governing:** LLP 0061; CanonicalClientValueV1 contract
**Evidence:** Diary 0106 M3; Clique local-main Grok Explicit on
`b70caf19ea` (`SNAPBACK_REACT_ARGS_INVALID`, `app.api.queries` ~6,251
nodes, `maxNodes` 4096)

## Problem

`CanonicalClientValueV1` caps query-arg / React store identities at 4096
nodes. That ceiling also applies when the generated `app` object is passed
into the Expo provider. Clique M3 added enough generated queries that
canonicalizing `app.api.queries` refused boot with a blank “Clique
couldn’t start” web screen.

The 2026-08-01 react-package fixture fix
(`issues/closed/20260801-react-package-fixture-node-limit.md`) stopped
digesting **whole manifests** under the 4096 budget. It did not stop a
normal generated `app` export from crossing the same budget at provider
construction.

The start packet does not mention a node budget on the generated client
object. Generation succeeds; boot fails. The recovery the lane found was
deleting unused queries and folding `*Before` pagination members into
optional `before` args.

## Required change

- State the 4096-node ceiling on generated `app` / `api.queries` in the
  Expo start packet and the React/Expo client page, with the refusal code
  `SNAPBACK_REACT_ARGS_INVALID`.
- Prefer a generation-time or verify-time warning when the projected
  canonical node count of the client export exceeds the budget, instead of
  a white-screen boot.
- Document the cheap authoring moves: do not export unused table queries;
  collapse pagination variants into optional args.

## Acceptance

- A cold agent adding a third milestone of live queries either stays under
  the ceiling with a named recipe, or is refused at generate/verify with a
  fix that does not require reading `canonical-client-value.mjs`.

## Resolution

Resolved 2026-08-28. Codegen now uses the canonical client value owner's exact
traversal to measure the generated React/Expo function export. When the
projection exceeds 4,096 nodes, generation emits
`SNAPBACK_CODEGEN_REACT_EXPORT_NODE_BUDGET_EXCEEDED` with the measured count,
the ceiling, the downstream `SNAPBACK_REACT_ARGS_INVALID` refusal, and both
cheap authoring repairs. It remains a warning because the descriptor is valid
for non-React consumers even when the current React store-identity path cannot
admit the catalog.

The Expo start packet and React/Expo client guide now state the ceiling and
repair recipe. The capability aliases and a retrieval-eval case cover the
observed `app.api.queries`, generated-app node-budget, and blank-boot
vocabulary.
