# Bakeoff wave 17 (day two): Snapback 4 vs Convex

Generated 2026-10-18T23:59:08.701Z. 100 lanes.

## Per backend

| | Snapback | Convex |
|---|---|---|
| lanes / finished / failed fast / timed out | 50 / 50 / 0 / 1 | 50 / 50 / 0 / 0 |
| check green (first / after reverify) | 50/50 / 50/50 | 50/50 / 50/50 |
| acceptance green | 50/50 / 50/50 | 50/50 / 50/50 |
| frontend proof ×2 green | 50/50 / 50/50 | 50/50 / 50/50 |
| probe:serve up (≥2 users/role) | 50/50 | 49/50 |
| day2:proof ×2 green (first run / both / after reverify) | 49/50 / 49/50 / 49/50 | 50/50 / 49/50 / 50/50 |
| day2-proof.json written | 50/50 | 50/50 |
| rollback + forward ok | 49/50 | 50/50 |
| data preserved (v2, rollback, forward, migrated values) | 49/50 | 50/50 |
| v2 rule enforced | 49/50 | 50/50 |
| v1 client after v2 deploy | works:29, degraded:20, broken:1 | works:34, degraded:16 |
| v1 client after rollback | works:47, degraded:2, broken:1 | works:45, degraded:5 |
| lines added since day one, median (all / backend / migration-named) | 563.5 / 33 / 0 (2 lanes) | 667.5 / 64.5 / 9 (27 lanes) |
| **all five green** | **49/50** (98%) | **49/50** (98%) |
| reverify red / flaky / env-red | 1 / 0 / 0 | 0 / 1 / 0 |
| wall minutes median / mean | 11.5 / 20.34 | 21.5 / 23.9 |
| agent minutes median / mean | 11.5 / 20.34 | 21.5 / 23.9 |
| friction minutes median / mean | 12 / 25.18 | 16.5 / 30.66 |
| friction entries median / mean | 5 / 5.4 | 7 / 7.88 |
| LOC backend / frontend / tests (median) | 377 / 470 / 670.5 | 270 / 897 / 630 |
| rating median / mean (n) | 8 / 8.06 (50) | 8 / 7.66 (50) |
| probed lanes | 50 (done:50) | 49 (done:49, serve-failed:1) |
| probe findings reported h/m/l | 15/27/3 | 24/37/5 |
| **confirmed** h/m/l (repro re-ran green) | **15/26/3** | **24/37/5** |
| lanes with a confirmed high | 10 | 14 |
| source edited during probe (lanes) | 0 | 0 |

## Compared with day one (the same lanes in the source wave)

| | Snapback day 1 | Snapback day 2 | Convex day 1 | Convex day 2 |
|---|---|---|---|---|
| wall minutes median | 14 | 11.5 | 15 | 21.5 |
| friction minutes median | 10 | 12 | 13.5 | 16.5 |
| friction entries median | 5 | 5 | 7 | 7 |
| rating mean | 8.18 | 8.06 | 8.02 | 7.66 |
| confirmed probe findings / lane | 0.44 | 0.88 | 0.68 | 1.35 |
| rating change vs day one, median / mean | | 0 / -0.12 | | 0 / -0.36 |

## Paired comparison — All pairs (50 pairs; win = Snapback better)

| metric | better | pairs | Snapback wins | Convex wins | ties | sign test p |
|---|---|---:|---:|---:|---:|---:|
| all five green: check, acceptance, frontend ×2, day2:proof ×2, probe:serve (after reverify) | higher | 50 | 1 | 1 | 48 | 1 |
| check | higher | 50 | 0 | 0 | 50 | – |
| acceptance | higher | 50 | 0 | 0 | 50 | – |
| frontend proof ×2 | higher | 50 | 0 | 0 | 50 | – |
| probe:serve up with ≥2 users/role | higher | 50 | 1 | 0 | 49 | 1 |
| day2:proof ×2 (after reverify) | higher | 50 | 0 | 1 | 49 | 1 |
| rollback + roll-forward ok (day2:proof green) | higher | 50 | 0 | 1 | 49 | 1 |
| data preserved through v2, rollback, forward | higher | 50 | 0 | 1 | 49 | 1 |
| v2 privacy rule enforced (day2:proof) | higher | 50 | 0 | 1 | 49 | 1 |
| v1 client after v2 deploy (works 2 / degraded 1 / broken 0) | higher | 50 | 4 | 10 | 36 | 0.1796 |
| v1 client after rollback (2/1/0) | higher | 50 | 3 | 1 | 46 | 0.625 |
| lines added since day one (descriptive) | lower | 50 | 34 | 16 | 0 | 0.0153 |
| backend lines added since day one (descriptive) | lower | 50 | 33 | 17 | 0 | 0.0328 |
| lines added in migration-named files (descriptive) | lower | 50 | 25 | 2 | 23 | 0 |
| rating change vs day one | higher | 50 | 17 | 7 | 26 | 0.0639 |
| wall minutes (first start → agent done, all attempts) | lower | 50 | 43 | 7 | 0 | 0 |
| agent minutes (sum of attempts) | lower | 50 | 43 | 7 | 0 | 0 |
| friction minutes (self-reported) | lower | 50 | 35 | 14 | 1 | 0.0038 |
| friction entries | lower | 50 | 38 | 10 | 2 | 0.0001 |
| rating /10 | higher | 50 | 20 | 3 | 27 | 0.0005 |
| lines of code, total (descriptive) | lower | 50 | 37 | 13 | 0 | 0.0009 |
| lines of backend code (descriptive) | lower | 50 | 21 | 29 | 0 | 0.3222 |
| confirmed high-severity probe findings | lower | 50 | 11 | 6 | 33 | 0.3323 |
| confirmed probe findings, all severities | lower | 50 | 18 | 9 | 23 | 0.1221 |
| confirmed findings weighted 3/2/1 | lower | 50 | 18 | 11 | 21 | 0.2649 |

## Paired comparison — Model-matched pairs (50 pairs; win = Snapback better)

| metric | better | pairs | Snapback wins | Convex wins | ties | sign test p |
|---|---|---:|---:|---:|---:|---:|
| all five green: check, acceptance, frontend ×2, day2:proof ×2, probe:serve (after reverify) | higher | 50 | 1 | 1 | 48 | 1 |
| check | higher | 50 | 0 | 0 | 50 | – |
| acceptance | higher | 50 | 0 | 0 | 50 | – |
| frontend proof ×2 | higher | 50 | 0 | 0 | 50 | – |
| probe:serve up with ≥2 users/role | higher | 50 | 1 | 0 | 49 | 1 |
| day2:proof ×2 (after reverify) | higher | 50 | 0 | 1 | 49 | 1 |
| rollback + roll-forward ok (day2:proof green) | higher | 50 | 0 | 1 | 49 | 1 |
| data preserved through v2, rollback, forward | higher | 50 | 0 | 1 | 49 | 1 |
| v2 privacy rule enforced (day2:proof) | higher | 50 | 0 | 1 | 49 | 1 |
| v1 client after v2 deploy (works 2 / degraded 1 / broken 0) | higher | 50 | 4 | 10 | 36 | 0.1796 |
| v1 client after rollback (2/1/0) | higher | 50 | 3 | 1 | 46 | 0.625 |
| lines added since day one (descriptive) | lower | 50 | 34 | 16 | 0 | 0.0153 |
| backend lines added since day one (descriptive) | lower | 50 | 33 | 17 | 0 | 0.0328 |
| lines added in migration-named files (descriptive) | lower | 50 | 25 | 2 | 23 | 0 |
| rating change vs day one | higher | 50 | 17 | 7 | 26 | 0.0639 |
| wall minutes (first start → agent done, all attempts) | lower | 50 | 43 | 7 | 0 | 0 |
| agent minutes (sum of attempts) | lower | 50 | 43 | 7 | 0 | 0 |
| friction minutes (self-reported) | lower | 50 | 35 | 14 | 1 | 0.0038 |
| friction entries | lower | 50 | 38 | 10 | 2 | 0.0001 |
| rating /10 | higher | 50 | 20 | 3 | 27 | 0.0005 |
| lines of code, total (descriptive) | lower | 50 | 37 | 13 | 0 | 0.0009 |
| lines of backend code (descriptive) | lower | 50 | 21 | 29 | 0 | 0.3222 |
| confirmed high-severity probe findings | lower | 50 | 11 | 6 | 33 | 0.3323 |
| confirmed probe findings, all severities | lower | 50 | 18 | 9 | 23 | 0.1221 |
| confirmed findings weighted 3/2/1 | lower | 50 | 18 | 11 | 21 | 0.2649 |

## Within snapback: model and frontend

| group | finished | all four green | wall median | friction min median | rating mean | confirmed findings/lane |
|---|---:|---:|---:|---:|---:|---:|
| muse | 20 | 19/20 | 31 | 45 | 8.1 | 1.9 |
| codex | 30 | 30/30 | 9 | 9.5 | 8.03 | 0.2 |
| react | 23 | 22/23 | 11 | 11 | 8.04 | 1.22 |
| expo | 27 | 27/27 | 12 | 13 | 8.07 | 0.59 |

Friction by area (snapback):

| area | entries | minutes | lanes |
|---|---:|---:|---:|
| testing | 71 | 239 | 39 |
| migration | 35 | 211 | 30 |
| hosting-deploy | 18 | 137 | 17 |
| rollback | 19 | 99 | 19 |
| frontend | 23 | 91 | 19 |
| client | 13 | 80 | 13 |
| authorization-rules | 11 | 65 | 11 |
| functions-api | 9 | 64 | 9 |
| auth | 8 | 63 | 8 |
| schema-data | 8 | 40 | 8 |
| other | 11 | 34 | 7 |
| cli | 5 | 31 | 5 |
| dev-server | 1 | 25 | 1 |
| diagnostics | 13 | 22 | 13 |
| install | 4 | 15 | 4 |
| codegen-types | 8 | 15 | 8 |
| docs | 6 | 14 | 6 |
| upgrade | 2 | 6 | 2 |
| scheduling-time | 3 | 5 | 2 |
| uploads | 2 | 3 | 2 |

## Within convex: model and frontend

| group | finished | all four green | wall median | friction min median | rating mean | confirmed findings/lane |
|---|---:|---:|---:|---:|---:|---:|
| muse | 20 | 20/20 | 32 | 61.5 | 7.4 | 2.85 |
| codex | 30 | 29/30 | 19 | 12 | 7.83 | 0.31 |
| react | 23 | 23/23 | 21 | 18 | 7.57 | 1.61 |
| expo | 27 | 26/27 | 22 | 16 | 7.74 | 1.12 |

Friction by area (convex):

| area | entries | minutes | lanes |
|---|---:|---:|---:|
| rollback | 99 | 416 | 44 |
| hosting-deploy | 33 | 228 | 26 |
| testing | 65 | 184 | 36 |
| cli | 62 | 153 | 38 |
| migration | 20 | 144 | 20 |
| diagnostics | 19 | 139 | 18 |
| functions-api | 10 | 61 | 10 |
| schema-data | 11 | 43 | 11 |
| other | 10 | 35 | 7 |
| auth | 9 | 34 | 9 |
| client | 7 | 28 | 7 |
| frontend | 13 | 20 | 12 |
| codegen-types | 7 | 18 | 7 |
| dev-server | 1 | 10 | 1 |
| upgrade | 6 | 9 | 6 |
| install | 6 | 5 | 6 |
| docs | 15 | 4 | 15 |
| authorization-rules | 1 | 2 | 1 |

Day-two notes: day2:proof is run twice by the harness against production; its day2-proof.json (deleted before each run) supplies rollback, data-preserved, v2-rule and v1-client fields, which count only when day2:proof itself exited 0 (v1-client results are recorded either way). "Lines added since day one" is a per-file multiset diff of non-blank lines against the source lane, ignoring new files identical to a source file (saved v1 copies); "migration-named" counts lines added in files whose path contains "migrat" and is a lower bound. Probe findings are against production v2, with the change request added to the spec.

Notes: minutes_lost are self-estimates (relative weights, not clock time). LOC counts non-blank lines; backend = snapback/ or convex/ (generated code excluded); tests = scripts/, tests, acceptance/proof files. A finding is *confirmed* when the harness re-ran its repro script against the still-running app and it exited 0.

