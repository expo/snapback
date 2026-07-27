# Codegen review manifest, ignored cache, and author summary

**Status:** Open  
**Impact:** 4  
**Urgency:** 4  
**Ease:** 2  
**Confidence:** 5  
**Severity:** P1  
**Systems:** Code generation, Artifacts, Packaging, Developer experience, CI  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** LLP 0010, LLP 0012, LLP 0037, LLP 0041; `packages/snapback-codegen`

Codegen emits a deterministic `artifacts.json`, but all projections still live
in one committed `generated/` tree. Signal Desk produced 58 files for 14
operations, dominating review. Successful output reports only the path and
input hash; degraded result types are individual warnings rather than an
author-oriented inventory with remediation.

## Desired resolution

- Define three explicit custody classes: one committed review manifest,
  consumer/CI-required committed projections, and regenerable ignored cache.
- Store cache content by complete input hash under
  `.snapback/codegen-cache/<inputsHash>/`; give every manifest entry a content
  digest, logical kind, custody, consumer, and regeneration rule.
- Resolve dev, release, app CLI, client bundling, Contract validation, and CI
  through the manifest. Missing/tampered cache regenerates or fails closed;
  stale fallback is never served.
- Preserve atomic complete-graph replacement and compatibility for existing
  committed generated layouts during migration.
- Emit deterministic human and JSON summaries: table count, operations by
  kind, live count, ephemeral count, custody/file counts, warnings, and
  degraded results with authored source/output links and exact remediation.
- Replace broad generated-tree diff checks with review-manifest diff plus cold
  cache regeneration/consumer verification.

## Acceptance

- Cold clone, empty cache, tampered cache, legacy layout, consumer-specific
  projection, generation failure, and release closure tests are deterministic.
- A hard failure leaves no partially serveable graph; successful identical
  reruns produce byte-identical review manifests and summaries.
- Ordinary app diffs retain only the manifest and policy-required projections;
  deleting the ignored cache does not change behavior after regeneration.
- Text and `--json` CLI modes preserve diagnostics, exit semantics, source
  spans, and direct remediation.
- Getting-started, authoring-loop, capability, and generated-artifact guide
  claims match the new custody policy.
