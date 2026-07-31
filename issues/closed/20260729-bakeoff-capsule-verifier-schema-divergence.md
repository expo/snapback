# Bakeoff capsule verifier diverges from the frozen JSON Schema

**Status:** Closed  
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

## Resolution

**Date:** 2026-07-30

`demos/backend-bakeoff/scripts/run-capsule.mjs` now enforces the frozen
schema first and resolves declared paths:

- `verifyCapsule` validates every capsule against the frozen
  `protocol/run-capsule.v1.schema.json` before any semantic check, with a
  strict validator implementing exactly the draft 2020-12 keywords the frozen
  schema uses (`type`, `required`, `properties`, `additionalProperties: false`,
  `const`, `enum`, `minLength`). Schema violations fail the capsule on their
  own with per-field diagnostics (`schema: $...`) and short-circuit the
  semantic pass.
- The verifier hard-binds to the frozen schema file: the schema's sha256 is
  checked against the `freeze.v2.json` record before use, and the validator
  refuses to run against any schema keyword outside the implemented set. New
  capsule fields therefore require a dated protocol amendment (new frozen
  schema + verifier update + re-freeze), never an ad-hoc relaxation. Noted in
  `demos/backend-bakeoff/README.md` and in the script.
- Path-bearing fields (binding baseline/cleanup-plan paths, target and cleanup
  receipt paths, scenario and evidence-confidence evidence paths, inventory
  receipt path) must be empty when inapplicable or resolve to a retained
  regular file under the arm directory or the repository root; absolute paths,
  `..` traversal, and prose sentinels fail. The CLI passes the capsule's
  directory automatically.

**Verified:**

- `node --test scripts/run-capsule.test.mjs`: 13/13 pass, including new tests
  that (a) the historical root `notes`/`resultSummary`/`builderIncidents`
  fields fail schema-first with semantic checks suppressed, (b) a closed
  nested object (`arm`) rejects unknown fields, (c) a fully-materialized
  capsule passes with path checking on, (d) a non-file sentinel in
  `baselineReceiptPath` fails, and (e) `..` traversal fails.
- Reconstructed violation capsules (root extension fields; the Research Room /
  Convex baseline sentinel) fail the CLI end-to-end with exit 1.
- Full corpus: all 36 retained capsules (35 arms + the Linear/Firebase
  final-refresh handoff) pass `run-capsule.mjs verify` with schema-first and
  path resolution enabled.
- Scripts and README are freeze-manifest artifacts, so `npm run freeze`
  re-recorded digests prospectively; `npm test` (34 tests + verify-stage0)
  passes, and `./ref-check --verbose` is clean.
