# Complete D3 and make admitted local query evaluation the default

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 1
**Confidence:** 5
**Systems:** React, Expo, Headless client, Local replicas, Query IR,
Completeness
**Date:** 2026-08-16
**Governing:** LLP 0190 §3.1 and Stages D3.3–D3.8, LLP 0209 §8, LLP 0270
**Related:** LLP 0053, LLP 0155 Move 2, LLP 0166 D4/D7;
`issues/20260815-local-first-defaults-audit.md`

## Problem

The JS client ships a bounded local evaluator, but it is not the requested
local-query default. `client.evaluateLocalResultTransform(reference, {
transformPlan })` requires an owner-issued
`result-transform-snapshot-v1` retention class and an explicit call
(`guide/sync/offline-and-retention.md` and
`packages/snapback-client/result-transform.d.mts`). It only filters, orders,
and limits the exact proof-verified retained result; it never runs the query's
source-row plan. React has no default hook integration, headless calls it
imperatively, and the stock Expo carrier is refused.

LLP 0190 already owns retained facts, local evaluation admission, freshness,
completeness, authority transitions, and the D3 execution stages. LLP 0209 §8
already defines the server/local seam: one IR, two evaluators, byte-identical
results and completeness labels or `unknown`; its current live deltas are not
replica-applicable until D3 supplies continuity, predecessor/base-version,
and gap-to-replace rules. This ticket must execute that ownership, not fork it.

## What default means

For each owner-admitted query/profile on a qualified carrier, the ordinary
React query hook and headless query API should consult the local
materialization first and publish an immediate answer whenever the owner proof
establishes the exact plan, arguments/window, authority partition, projection,
version, and completeness. Applications should not call a local-evaluator
variant or provide a transform plan.

Missing facts, mixed versions, unknown completeness, expired/revoked custody,
or an unadmitted node return `unknown`/hydrate/online fallback. They never
infer absence. D3 may begin with exact retained results and admitted closed
graphs, but each matrix cell must name that honest profile; “local query
evaluation” must not overstate a result-transform-only rung.

## Consequence classification

**Semantic consequences — not SAFE as a wiring-only flip.** This changes the
source and timing of rendered answers and introduces evaluator-divergence,
staleness, completeness, authorization-oracle, and replica-continuity risks.
LLP 0209's byte/completeness agreement corpus, LLP 0190's risk-class gates,
and LLP 0270's fail-closed default policy are release prerequisites.

## Acceptance

- The same frozen corpus runs through server and local evaluators and produces
  byte-identical canonical results, ordering, and completeness/refusal labels.
- React and headless ordinary query surfaces return admitted local answers
  without a hook/method variant; Expo joins only after its carrier qualifies.
- Missing edges, fields, absence/range proof, authority facts, or continuity
  return `unknown` and trigger bounded hydration/online fallback.
- Restart, delta gap, policy/revocation, lease expiry, logout, user switch,
  artifact rotation, and corrupt predecessor cases satisfy LLP 0190.
- Capability/guide rows distinguish exact-result transform, admitted graph,
  and replica-continuity rungs.
