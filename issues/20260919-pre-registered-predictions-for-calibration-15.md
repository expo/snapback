# Pre-registered predictions for calibration #15, written before wave 14 has built anything

**Filed** 2026-09-19, by the wave-13 lead (session snapback-9c) under the author's sign-off of 2026-09-19, before any wave-14
lane has produced a design
**Status** open — resolves when #15's score lands on the pin that carries the levers below
**Subject** LLP 3000.007 §20.24 (wave 14), §14 ruling 40's refined condition, §20.22.7

Calibration #14's pre-registration (`closed/20260918-pre-registered-prediction-for-calibration-14.md`) gapped on
`setup_and_docs` because its condition was a conjunction whose negation was not the other branch. This file uses **one
threshold per category with an explicit null band**, every number taken from the twelve-run fit (0.2.16 → 0.2.30, least
squares, extrapolated to run 13; `tools/cal-series.py` in the wave-13 program directory reproduces it) **before** the levers
exist. A holistic number tells nothing either way (sd 1.75; a wave moves it by less) and is not to be reported as though it did.

## The fitted lines at run 13, and the bands

| category | 12-run line at #15 | sd | confirms (≥ line + 1 sd) | null band | refutes (≤ line − 1 sd) |
|---|---:|---:|---:|---|---:|
| setup_and_docs | 87.9 | 2.8 | **≥ 91** | 86–90 | **≤ 85** |
| data_modeling | 82.7 | 2.5 | **≥ 86** | 81–85 | **≤ 80** |
| queries_and_live | 79.2 | 4.5 | **≥ 84** | 76–83 | **≤ 75** |
| diagnostics_dev_loop | 94.7 | 1.5 | ≥ 97 | 94–96 | ≤ 93 |
| overall | 88.3 | 1.75 | (not a criterion) | | |

## The three levers, each with the category it predicts and the pin it needs

**W14a — the prefix search's expansion bound** (capability; design lane → two-family blind review → build lane).
*Predicts:* `queries_and_live` ≥ 84 confirms, ≤ 75 refutes. *Mechanism criterion, which counts even when the category
does not move:* the grader's own probe of the bound (calibration #13's 45 distinct `kx*` words in one scope, 20 of 45 hits and
no cursor) returns either a continuation that reaches all 45 or a refusal that names the words consumed; #13's d-01 class is
absent from the defect list. *Void, not failed,* if the grader does not probe the bound (it did not in #14) — the mechanism
criterion is then carried by the lane's own test, and the category is read as null.

**W14b — the removal candidate: the README's orientation volume** (measurement + design lane → two-family blind review →
edit lane). *Predicts:* `setup_and_docs` ≥ 91 confirms, ≤ 85 refutes. *Mechanism criterion:* the lines a cold builder reads
fall — the bounds bar's `cardsRead` totals (1,872 / 4,797 / 2,772 on 0.2.29) and the calibration's knowledge-lookup line
counts — by the amount the design predicts, and the surface budget the design proposes is enforced by the docs check.
*Confound to name now:* a grader that deducts `data_modeling` or `queries_and_live` for a section it could not find — those
two categories must not fall below their null bands on the same run, or the removal moved the deduction rather than the volume.

**W14c — `data_modeling`, gone at directly for the first time** (no new lane: the lever is the maintained-columns program,
rulings 39 and 41 — MC1's build and W15c's value-index tie-break — whose target is exactly the scorers' recurring deduction:
"M8 required an explicit ranked table, hour-leading indexes, and validation probes" (#14), "an explicit ranking projection
for newest-first ties" (#13), "explicit merge lanes, scalar maintain semantics and optional-row handling" (#12)).
*Predicts:* `data_modeling` ≥ 86 confirms, ≤ 80 refutes. *Void, not failed,* if the pin #15 runs on does not carry MC1 and
W15c — then the prediction rolls to the next calibration unchanged.

## Rules of reading, stated in advance

- A lever that is not in #15's pin makes its prediction **void**, never failed or confirmed.
- The mechanism criteria are scored from the builder's and grader's evidence files by string search, as #14's were, before
  any category is read.
- Builder self-attribution is a floor on Snapback's share, not a count (six bounds-bar builders of eight self-attributed a
  packaging defect as their own error); the shapes are compared, not the attribution counts.
- The host confound (the provenance-scan stall of 2026-09-17/18) is checked in the packet's `logs/load.log` and the
  publish gate's record before any `scale_and_limits` reading is attributed to the pin.
- Nothing here commissions a publish: the pin #15 runs on is published only on the author's say-so.
