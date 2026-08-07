# LLP 0129 Phase 2a browser-IR coverage gate — second run, against the frozen designation

Date: 2026-08-07
Status: gate evidence run; not a phase-exit, capability, or Parity claim
Scope: LLP 0129 Phase 2a browser ladder, OQ9-designated exit gate
Runner: `tests/acceptance/browser-ir-coverage-v1.mjs` (`--retain` produced the sibling receipt)
Receipt: `browser-ir-coverage.2026-08-07.v2.json`
Predecessor: `browser-ir-coverage.2026-08-06.v1.{json,md}` (common-path axis INDETERMINATE — no frozen designation existed)

## What changed since the first run

The designated-browser-common-path mutation set is now **frozen** in
`handler-coverage.v1.json` (the placement Option B of
`wasm-assessment.2026-08-05.v1.md` §5 names). The designation act was
**delegated by the author to the orchestrating agent** on 2026-08-07
(`issues/closed/20260807-local-first-author-gate-packet.md` item 3; the
delegation is recorded verbatim in the artifact's provenance). The runner now
loads the designation, refuses on any drift (schema, corpus digest, partition
completeness — every corpus case must be designated or excluded with a
reason), and measures the previously INDETERMINATE axis. Nothing else was
tuned: corpus, evaluator closure, admission classifier, browser carrier, and
comparison policy are unchanged.

## Component results

| Component | Threshold | Result |
| --- | --- | --- |
| Semantic IR coverage of the frozen corpus | ≥90% | **12/13 = 92.3% — PASS** (carried from the pinned, dated assessment classification; not re-audited) |
| Exact LLP 0051 D5 results in a real browser | exact for all 37 pinned cases | **37/37 — PASS** (browser-vs-Node byte-identical after IndexedDB read-back; manifest-digest-chained to the Phase-1 Rust receipt) |
| Execution coverage of designated browser common-path mutations | 100% of the frozen 12-case designation | **11/12 — FAIL** |
| Whole gate | all of the above | **FAIL** — one named gap |

The single failing designated case is **`todo-v2-delete-todo`**, refused by
the shipped plan-shape admission with `SNAPBACK_PLAN_EFFECT_CEILING` (the M1
ceiling admits `Insert`/`Get`/`Guard`/`Patch`; `Delete` is not in it). The
case was inspected before freezing: its plan is exactly one `Delete` step
addressing a single row by `Arg` id with `ChangedCount` return — a plain
single-row delete, not a cascade or filtered delete. Its D5 replay itself
passes (the refusal is the expected conformance outcome); what fails is the
common-path axis's local-admission requirement.

This is the gate doing its job: the designation names single-row delete as an
everyday agent-app operation, and the measurement surfaces that the effect
ceiling refuses it. Follow-up ticketed:
`issues/20260807-single-row-delete-effect-ceiling.md` (should the ceiling
classification admit single-effect deletes?). No tuning was applied to make
the axis pass.

## Environment

Same carrier as the first run: Google Chrome 151.0.7922.76 (headless, raw CDP
over Node's WebSocket), esbuild-bundled shipping
`@expo/snapback-client/ir-evaluator` closure, per-case IndexedDB persist and
read-back, profile under literal `/tmp` per
`issues/20260806-chrome-indexeddb-profile-macos-tmpdir.md`. Cleanup deleted
the database, stopped the owned Chrome tree, and removed the profile. Run from
the uncommitted gate worktree by design; executed bytes are digest-bound in
the receipt.

## Nonclaims

- No phase exit or advancement: per LLP 0129's standing rule, advancement is
  author-presented; this artifact records the measurement (including the FAIL)
  for that presentation.
- No Parity, capability, store, settlement, or React-presentation claim.
- Semantic coverage is a carried, digest-pinned classification of the frozen
  corpus — this run adds no new audit of demo handler sources.
- The designation partitions the D5 conformance corpus; nothing here claims
  generated local artifacts exist for any specific demo mutation.

## Reproduce

```sh
node tests/acceptance/browser-ir-coverage-v1.mjs --dry-run   # corpus + designation + bundle only, no browser
node tests/acceptance/browser-ir-coverage-v1.mjs --retain    # full run, writes the dated receipt
```
