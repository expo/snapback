# Bakeoff capsule verifier diverges from the frozen JSON Schema

**Status:** Open  
**Area:** LLP 0102 protocol tooling  
**Found by:** independent Stage 3 completion audit  
**Date:** 2026-07-29  
**Governing:** LLP 0102

## Problem

`demos/backend-bakeoff/scripts/run-capsule.mjs verify` accepted all 35
capsules, but strict JSON Schema draft 2020-12 validation rejected four:

- Linear / Convex and Linear / Snapback carried root `notes`;
- Partiful / Appwrite carried root `resultSummary`; and
- Research Room / Supabase carried root `builderIncidents`.

The frozen `run-capsule.v1.schema.json` sets root
`additionalProperties: false`. The custom verifier checks semantic invariants
but does not first enforce that schema. It also accepted a non-file sentinel in
Research Room / Convex's `baselineReceiptPath`, so an evidence-path traversal
could not resolve every declared path.

The coordinator removed only the redundant extension fields after verifying
their facts remained in retained receipts and the central evidence audit, and
replaced the fresh-target baseline sentinel with the protocol's ordinary empty
path. Scenario results, timings, confidence, cleanup, and product attribution
did not change. All 35 capsules now pass strict schema validation and every
declared evidence/cleanup/baseline path resolves.

## Required outcome

- The semantic verifier validates the frozen schema before its additional
  non-vacuity/evidence checks.
- Path-bearing fields are either empty when inapplicable or resolve to retained
  artifacts under the arm/repository path rules.
- Tests prove unknown root fields and non-file path sentinels fail.
- A protocol version amendment, not an ad hoc schema relaxation, is required
  before accepting new capsule fields.

## Evidence

- `demos/backend-bakeoff/protocol/run-capsule.v1.schema.json`
- `demos/backend-bakeoff/scripts/run-capsule.mjs`
- `demos/backend-bakeoff/reports/deep-round-report.md`
