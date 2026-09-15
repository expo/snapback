# Snapback 4 Clique — Astra-medium calibration on 0.2.16 (2026-09-15)

The third Astra-medium calibration of the LLP 3000.007 program, on
`snapback4@0.2.16` / `snapback4-expo@0.2.7` (§19 published as 0.2.15, §20
wave 2 and the published iOS simulator witness). Packet
`~/clique-sb4-20260915-astra-next` (a copy of the 0.2.12 packet's frozen
instrument, scripts and templates; ports 49360–49379; builder `gpt-6-astra`
medium; independent grade by a fresh Claude Opus 5 session; holistic score by
the same family). N=1, same-family and cross-run: a few points are noise.

## Result

- Builder: M1–M6 and M8 green, 5,240 s wall; the builder's own tally
  "confirmed snapback4 defects=0" (25 correction loops: 18 agent, 6
  environment, 1 ambiguous — the web navigation write).
- Grade (101 prior assertions): 84 pass, 1 fail (d-01, the documented online
  client's `session()` is missing — a Snapback documentation defect, lane W3e),
  16 not run (7 native: the run prompt says "simulator proofs are not
  required", so the builder did not use the published witness; 9 M7, excluded
  by protocol). O1 75, O2 55, O3 78, O4 10 (unchanged from 0.2.12).
- Holistic: 90 (0.2.12: 86).

| Category | 0.2.12 | 0.2.16 |
| --- | ---: | ---: |
| overall | 86 | 90 |
| setup_and_docs | 79 | 96 |
| data_modeling | 89 | 85 |
| authorization | 94 | 88 |
| queries_and_live | 80 | 91 |
| writes_and_transactions | 94 | 96 |
| offline_sync | 90 | 93 |
| media_assets | 97 | 97 |
| background_work | 88 | 91 |
| client_integration | 91 | 88 |
| diagnostics_dev_loop | 78 | 94 |
| scale_and_limits | 86 | 88 |
| operations | 87 | 88 |

The three categories the program targeted moved +17, +11 and +16. The drops
trace to named friction (`friction-review.md`): authorization and
data_modeling — the Following recipe had no source-event removal, so the
builder made per-reader entries public (F3, lanes W3b/W3b2), and aggregates
needed derived columns and backfills (F7/F8; maintains shipped in 0.2.17);
client_integration — a web write lost on immediate navigation (F1, lane W3a),
cold web launch needing application-shell caching, a SecureStore adapter.
Files: `astra/FINAL.md` (scores), `astra/grader-report.json`, the lane's
final report, essay and diary, `friction-review.md` (evidence-bound friction
extraction against the inventory), `packet-README.md`, `PACKAGE_PINS.json`.
