# Clique on Snapback 4 — Astra-medium calibration on 0.2.22

**Status:** sixth Astra calibration of the agent-ergonomics program, on `snapback4@0.2.22` / `snapback4-expo@0.2.13`. The pins carry wave 6 (LLP 3000.007 §20.15), published from main `2b11da7d1` on 2026-09-15.

**Baseline.** The 0.2.21 calibration scored holistic 88 (0.2.19: 91):

| Category | 0.2.21 |
| --- | ---: |
| setup | 90 |
| data | 88 |
| auth | 91 |
| queries | 84 |
| writes | 92 |
| offline | 90 |
| media | 97 |
| background | 95 |
| client | 89 |
| diagnostics | 93 |
| scale | 85 |
| operations | 88 |

Grade O2 was 78 and O4 30. Record: `benchmarks/runs/2026-09-15-snapback4-clique-astra-0.2.21`.

**Instrument.** Same frozen instrument, scripts and templates as `~/clique-sb4-20260915-astra-cal5`, copied without lanes, scores or logs. Ports 49360–49379. Astra builder only (gpt-6-astra, medium).

**Noise.** N=1, same-family, cross-run: a gap of a few points is inside the noise.

**Addressed since 0.2.21**, from that record's friction-review.md:
- H2: `init --recipe feeds --prefix` installs beside an app's own tables, and the notes print that command.
- H1: the password minimum counts characters.
- H3/V1/V2: horizon guards stay visible, and `N_NO_HORIZON` never costs prediction.
- H7: `mutate(op, args, { id })`.
- V4: `clock advance` keeps live leases.
- V3: password-only guidance.

**Chain.** `calibration-0.2.22.sh`.
