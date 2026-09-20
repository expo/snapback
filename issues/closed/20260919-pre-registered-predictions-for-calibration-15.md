# Pre-registered predictions for calibration #15, written before wave 14 has built anything

**Filed** 2026-09-19, by the wave-13 lead (session snapback-9c) under the author's sign-off of 2026-09-19, before any wave-14
lane has produced a design
**Status** resolved 2026-09-20 — calibration #15 on 0.2.31 scored (`benchmarks/runs/2026-09-20-snapback4-clique-astra-0.2.31/`); the outcome is at the end of this file
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
*As built (2026-09-20, `b0aa544ce7`):* a uniform scope's first-term expansion is bounded by the meter — the 45-word walk
completes 20/20/5 on the server, both device stores and wasm (red on main before, green after; 200 and 1,000 words walk too);
an admitted non-uniform scope keeps 32 words and public `cut: null` on the server. Of the mechanism criterion's two
branches, the continuation that reaches all 45 is the one built. The prediction above is unchanged.

**W14b — the removal candidate: the README's orientation volume** (measurement + design lane → two-family blind review →
edit lane). *Predicts:* `setup_and_docs` ≥ 91 confirms, ≤ 85 refutes. *Mechanism criterion:* the lines a cold builder reads
fall — the bounds bar's `cardsRead` totals (1,872 / 4,797 / 2,772 on 0.2.29) and the calibration's knowledge-lookup line
counts — by the amount the design predicts, and the surface budget the design proposes is enforced by the docs check.
*Confound to name now:* a grader that deducts `data_modeling` or `queries_and_live` for a section it could not find — those
two categories must not fall below their null bands on the same run, or the removal moved the deduction rather than the volume.
*As built (2026-09-20, `490ee9cfac`):* README 2,004 → 300 physical lines; cards 5,621 → 6,332; README + cards 7,625 → 6,632;
docs budget 300 (`metrics/docs-budget.json`, `scripts/docs-budget.mjs` in `scripts/test.sh`); the acceptance exercise
`test/first-account.test.mjs` green from the README alone. The prediction above is unchanged.

**W14c — `data_modeling`, gone at directly for the first time** (no new lane: the lever is the maintained-columns program,
rulings 39 and 41 — MC1's build and W15c's value-index tie-break — whose target is exactly the scorers' recurring deduction:
"M8 required an explicit ranked table, hour-leading indexes, and validation probes" (#14), "an explicit ranking projection
for newest-first ties" (#13), "explicit merge lanes, scalar maintain semantics and optional-row handling" (#12)).
*Predicts:* `data_modeling` ≥ 86 confirms, ≤ 80 refutes. *Void, not failed,* if the pin #15 runs on does not carry MC1 —
then the prediction rolls to the next calibration unchanged. If the pin carries W15c alone, the prediction is read at the
tie-break's share only: ≥ 86 confirms, anything else is null and nothing refutes (W15c removes one of the three deductions
the scorers name; MC1 removes the table itself). *Amended 2026-09-20 at W14b's landing, before #15 runs.*

## Rules of reading, stated in advance

- A lever that is not in #15's pin makes its prediction **void**, never failed or confirmed.
- The mechanism criteria are scored from the builder's and grader's evidence files by string search, as #14's were, before
  any category is read.
- Builder self-attribution is a floor on Snapback's share, not a count (six bounds-bar builders of eight self-attributed a
  packaging defect as their own error); the shapes are compared, not the attribution counts.
- The host confound (the provenance-scan stall of 2026-09-17/18) is checked in the packet's `logs/load.log` and the
  publish gate's record before any `scale_and_limits` reading is attributed to the pin.
- Nothing here commissions a publish: the pin #15 runs on is published only on the author's say-so.

## Outcome (2026-09-20, calibration #15 on 0.2.31 — `benchmarks/runs/2026-09-20-snapback4-clique-astra-0.2.31/`)

Read by the rules above, in the order they set (mechanism criteria by string search first, then the categories):

- **W14b — `setup_and_docs` 93 ≥ 91: CONFIRMED.** Mechanism met: the README a cold builder reads fell 1,999 → 300 lines (the
  design's −1,699); the guide output saved as evidence 2,905 → 3,451 lines across 8 → 14 cards; README + guide −24%; the docs
  budget enforced (`scripts/docs-budget.mjs` in `test.sh`). Confound absent: `data_modeling` 85 inside its null band,
  `queries_and_live` 89 above its threshold. 5.1 above the fitted line (1.8 sd).
- **W14a — `queries_and_live` 89 ≥ 84 by the number; NULL by this file's rule.** The grader did not probe the bound (no `kx*`,
  no `words`, no cursor probe in `grader-report.json` or `trace.md`), so the category is read as null and the mechanism is
  carried by the lane's own test: the 45/200/1,000-word walks red on main `6002c855aa` on the server, both device stores and
  wasm, green on the pin (the W14a review record). #13's d-01 shape is absent, trivially. The prediction rolls forward.
- **W14c — `data_modeling` 85: VOID** (MC1 is not in the pin); at W15c's share, 85 < 86 — null. Inside its null band, 2.3 above
  its line. Rolls to #16 unchanged.
- The holistic 91 is reported, not read. The host confound: load 7–47 (median 12) during the run, nothing struck by environment;
  the publish gate passed at load 10.7.
- The pin: snapback4 0.2.31 / darwin 0.2.31 / expo 0.2.22 (`275d23c867`, published 09:28Z); MC1 absent by the author's queue,
  not by omission.
