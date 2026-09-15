# Clique on Snapback 4 — Astra-medium calibration on 0.2.21

**Status: fifth Astra calibration of the agent-ergonomics program, on `snapback4@0.2.21` / `snapback4-expo@0.2.12`.**

- **Waves under test:** wave 4 (§20.13) and wave 5 (§20.14), published from main `2a4c8b8d1` on 2026-09-15.
- **Baseline:** the 0.2.19 calibration. Holistic 91; setup_and_docs 92, data_modeling 88, authorization 97, queries_and_live 89, writes 95, offline 92, media 98, background 93, client 90, diagnostics 95, scale 91, operations 89; grade O2 80, O4 40. Record: `benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.19`.
- **Instrument:** same frozen instrument, scripts and templates as `~/clique-sb4-20260915-astra-cal4`, copied without lanes, scores or logs.
- **Ports:** 49360–49379.
- **Lane:** Astra builder only (gpt-6-astra, medium).
- **Noise:** N=1, same-family, cross-run, so a gap of a few points is noise.

## Addressed since 0.2.19 (from friction-review.md)

- G1 navigation write loss: W4a.
- G2 replay suppression: `dev --replay`.
- G3 Following recipe: `init --recipe feeds`.
- G5 Trending: a predictable scheduled recipe.
- G6 acquisition: `client.acquired` and `usePendingWrite`.
- G4/G11 spellings.
- G7 calendar offsets.
- G10 presence under `clock advance`.
- M1/d-06 insert-arm truth.
- M4/M5 doc fixes.
- M8 Metro `blockList`.

## Chain

`calibration-0.2.21.sh`: builder → grade → summarize → score → aggregate.
