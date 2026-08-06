# Calibration records

Per-release benchmark run records land here: one JSON file per lane run,
validating against `../schema/run-record.schema.json`, named
`YYYYMMDD-<brief>-<lane>-rNN.json` (rNN = repetition index), plus any
run diaries that don't belong in the top-level `diaries/` corpus.

This is the LLP 0186 W1 calibration phase: **the ratchet is
measurement-only until OQ1 (token metering mechanics) and OQ2 (ratchet
tolerance and cadence) are resolved** — a regression found here is a
report to be filed and investigated, never a release block. The first
instrumented run recorded here also ratifies the correction-loop
attribution rule drafted in `../protocol.md` and becomes the binding
baseline for LLP 0186's measurable outcomes.

No records yet: the directory was scaffolded ahead of the first
instrumented run, which should run the Snapback lane against the
published 0.1.9+ packages
(`issues/closed/20260803-first-npm-latest-promotion.md`).
