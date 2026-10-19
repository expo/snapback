# COLR workstream report

Status: in progress; no push or version bump.

## Orientation

Clean branch at 8b1b688190; `git log sb4-loop..HEAD` empty. Read wave-19 day-two
analysis (all sections), skimmed wave-18 security/fix evidence. Governing context:
LLP 3000 §§1–7 and LLP 2000.000 §§6–8 (authorization/meter/replica invariants),
LLP 3000.036 (rule language), LLP 3000.036.004 §12 (column intent), LLP 3000.015
(field ownership), LLP 3000.014 and .014.000 (captured/live parent authority),
LLP 3000.000.000 (retained columns), LLP 3000.001.000 (semantic capability fences).

## Decisions

Column policy is conjunctive with row authority. Omitted fields use existing
optional-field lowering. Server-witness cells must not be retained on devices
whose partitions cannot maintain those witnesses; automatic server fallback
keeps a single application query. Row-local policies can be replicated safely.
No invented partial-proof or offline availability claim.
DORM owns rollback narration, reverse projections, renames and forward catch-up.
SEC4 owns campaign quality and general security-note ranking.

## Changes and evidence

- Design amendment: LLP 3000.036 §22, reviews pending.
- Setup: passed (Bun, CLI build, wasm build, client build); log outside repository at ~/sb4-loop/colr-setup.log. Baseline wasm 727,013 B gzip, budget 727,513 B.
- 200-schema baseline: 200/200 check --json passed on copies; original hashes unchanged. Evidence reports/colr/survey-baseline.json.gz.
- First independent reviews: both NOT READY; immutable guessing, blind asset placement and omitted-to-readable prediction addressed in §§22.8–22.9. Revised review round running.
- Product implementation has not begun pending both READY.

## Remaining

Implementation, independent READY reviews, full qualification requested by the
workstream, five lane-copy comparisons, small commits and scratch cleanup.
