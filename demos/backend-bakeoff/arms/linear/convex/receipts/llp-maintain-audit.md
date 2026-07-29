# LLP maintenance audit — Linear / Convex

**Intent:** pre-pr
**Scope:** `demos/backend-bakeoff/arms/linear/convex/` only
**Date:** 2026-07-29
**Mode:** Propose-only; no LLP edits or status changes applied

## Result

- `./ref-check --verbose`: pass — 107 LLP documents, 2,210 references in
  3,753 files, zero errors and zero unchecked references.
- `node scripts/check-guide.mjs`: pass — 41 pages, 95 snippets, 69 routes plus
  19 host-ops joined. Its 23 freshness warnings predate and are outside this
  provider arm.
- The frozen capsule verifier passes for `linear/convex`.
- The arm is governed by accepted LLP 0102 and does not modify Snapback product
  code, shared protocol files, LLPs, issues, diaries, reports, or other arms.
- The implementation adds no `@ref` annotation: its Convex schema and
  TypeScript functions are provider-arm evidence, while the run capsule records
  LLP 0102 as the frozen protocol authority.
- The persistent-offline and hosted-deployment nonclaims are explicit in the
  capsule. The application-authored optional-field rollout and backfill is
  described as such and is not presented as a first-class Convex migration
  facility.
- No code/document drift, broken reference, tombstoned target, stale gloss,
  provenance error, status proposal, or reconciliation proposal was found in
  scope.

No changes are proposed by this audit.
