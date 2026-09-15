# Clique on Snapback 4 — Astra-medium calibration on 0.2.19

**Status: Astra calibration lane on `snapback4@0.2.19` / `snapback4-expo@0.2.10`, the fourth calibration of the agent-ergonomics program (goal: remove the Snapback-attributable friction holding back the Astra-medium Clique scores).**

- **What shipped.** LLP 3000.007 §20 wave 3, landed on main `6856f48fc` on 2026-09-15 and published from that commit. The shipped scope and its descoped residuals are in §20.12.
- **Baseline.** It measures whether wave 3 moved the 0.2.16 calibration: holistic 90, with setup_and_docs 96, data_modeling 85, queries_and_live 91, authorization 88, client_integration 88 and diagnostics 94. That record is `benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.16`; its friction review is `~/projects/snapback-next-20260914/FRICTION-0.2.16.md`.
- **Instrument.** Same frozen instrument, scripts and templates as `~/clique-sb4-20260915-astra-next` (the 0.2.16 packet). It was copied without lanes, scores or logs.
- **Setup.** Ports 49360–49379; Astra builder only (gpt-6-astra, medium).
- **Caveat.** N=1, same-family and cross-run: a gap of a few points is inside the noise.

## Known residuals a builder can hit (not regressions)

- An unawaited `client.mutate()` followed by same-turn navigation can lose the write. The cards say to await it.
- A Following page cut by the meter is `complete: false` and can show an event removed since the last purge.

## Chain

`python3 scripts/render.py` → `python3 scripts/verify.py` → `run_phase.py builder astra` → `run_phase.py grade astra` → `summarize_grades.py` → `run_phase.py score astra` → `aggregate_scores.py`.
