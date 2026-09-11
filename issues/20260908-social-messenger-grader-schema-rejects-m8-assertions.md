# Social messenger grader schema rejects the instrument’s M8 assertions

**Status:** Open

**Date:** 2026-09-08
**Area:** Clique benchmark reporting
**Source:** Preflight for the published Snapback2 0.0.19 cold diagnostic run

The frozen acceptance manifest includes `m8-a01` and the other M8 assertions,
but `benchmarks/tools/social-messenger/grader/grader-report.schema.json`
permits only `^m[1-7]-a[0-9]{2}$` under `assertionResults`, with
`additionalProperties: false`. A report cannot both include the in-scope M8
results and validate against that schema. This is an instrument reporting gap,
not a Snapback2 application failure.

Observed in the current repository and in the frozen `social-messenger@0.3.6-m8`
instrument snapshot used by the 2026-09-08 diagnostic run. A direct pattern
check rejects `m8-a01`; the acceptance manifest declares it.

## Next action

In the next instrument revision, admit all declared milestone assertion IDs
and add a manifest/schema consistency check covering M8. Follow the existing
instrument revision and custody process; do not alter a frozen running wave.
The current diagnostic run will preserve M8 outcomes in a companion record
and explicitly report the limitation instead of omitting them or claiming
schema validation for an invalid report.

Related: LLP 0201; `benchmarks/runs/2026-09-08-release-cold-headroom/README.md`.

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — current schema mismatch. **Triage priority:** P2.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

Current grader-report.schema.json still admits assertionResults keys only through ^m[1-7]-a[0-9]{2}$ while M8 remains part of the instrument. This is a reporting-schema defect, not an M8 application failure.

Source: benchmarks/tools/social-messenger/grader/grader-report.schema.json patternProperties. A fresh Node 24.18.0 control read this exact JSON and applied its patterns: `m7-a01: true`, `m8-a01: false`, `additionalProperties: false`. This is a pattern-admission control, not a complete report-validation run. Correct it only in a versioned instrument revision, validate all declared assertion IDs and preserve frozen reports. No historical invalid report is reclassified as schema-valid.
