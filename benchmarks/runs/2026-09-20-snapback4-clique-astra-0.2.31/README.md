# Astra-medium Clique calibration #15 — `snapback4@0.2.31` / `snapback4-expo@0.2.22` (the pin after wave 14)

**Result: holistic 91.** Builder green (M1–M6 and M8; M7 not attempted, as the packet prescribes) with **zero
Snapback-attributed corrections** (the builder's own attribution, a floor on Snapback's share, not a count); grader 100 pass /
1 fail / 18 not-run of 119; one major defect, the application's, none Snapback's. The fifteenth Astra-medium calibration, the
thirteenth on the comparable instrument (0.2.16 onward), and **the first run scored against predictions pre-registered per
category with null bands before the wave built anything** (`issues/closed/20260919-pre-registered-predictions-for-calibration-15.md`).
Run by the wave-13/14 lead (session snapback-9c) on the author's say-so ("go ahead and publish 0.2.31 and run the clique
benchmark against it", 2026-09-20), immediately after 0.2.31 was published. **Fit the series; do not compare this run to #14
alone.**

## Packet

| | |
| --- | --- |
| Packet | cloned from calibration #14 (itself #13's and #12's): the same frozen instrument (179 files, `INSTRUMENT.sha256` and `INSTRUMENT_COMMIT` unchanged), the same prompt templates, three cold lanes; only `PACKAGE_PINS.json` and the version files differ (`scripts/verify.py`: "packet verified: 179 frozen instrument files, 3 cold lanes"). |
| Pins | `snapback4@0.2.31`, `snapback4-darwin-arm64@0.2.31`, `snapback4-expo@0.2.22` — published 09:10–09:28 UTC 2026-09-20 (bump `275d23c867`, ledger `cfc0f2855f`; the publish's full-suite gate 0 failures in 508 s, wasm 451,094 B under the 452,000 ratchet, docs budget 300/300); the launcher waited for the registry to serve both packages, then for the host's 1-minute load (11.7 at start; gate < 40). |
| Builder | `codex exec`, `gpt-6-astra`, reasoning effort medium; cold, from the published packages, their README, `guide` and `why`; 09:28:57–10:46:04 UTC (1 h 17 min, exit 0; #14's took 1 h 58 min); 35.4 M input tokens (34.7 M cached), 115 k output; scale replay 167,157 actions across 1,002 conversations accepted in 668 s. |
| Grader / scorer | the packet's independent grade (`claude-opus-5`, fresh session, the other family; 10:46–11:42 UTC) and the same-family holistic score (`gpt-6-astra`, 11:42–11:44); `summarize_grades.py` / `aggregate_scores.py` exit 1 on the single-lane packet ("no lifecycle end record: grok"), as in #14 — the astra lane's own summaries are complete. |
| Host | Apple M5 Max, 18 cores, macOS 26; shared. 1-minute load sampled every 60 s into `host-load.log`: 136 samples, min 7.0, median 12.0, max 46.5 (the grader tabulated 9–25 beside its timing measurements; nothing struck by environment). |
| Attributions recorded before any grader ran | in the packet's README: (1) the 32-word expansion bound is GONE for uniform scopes (W14a) and #13's d-01 shape must be absent; an admitted non-uniform scope keeps 32; (2) the README is 300 lines and the reference lives in the cards (W14b); (3) `N_PUBLIC_AGGREGATE_COPY` fires by provenance at `check` time (W15b); (4) the interim value-index tie-break (W15c) — MC1 absent, so `data_modeling`'s prediction is void; (5) the client-reliability milestone (Repair B) is in the pin; (6) the temp-directory leak fix; (7) the known open root-export class; (8) `doctor` shows more deferred→satisfied effects (ruling 32); (9) cold acquisition is not expensive. |
| Retained | `astra/FINAL.md`, `astra/grader-report.json`, `astra/m8-assertion-results.json`, the lane's `lane-FINAL.md`, `lane-final-report.md`, `lane-run-log.md`, `lane-diary.md`, `lane-essay.md`; `PACKAGE_PINS.json`; `host-load.log`. The packet itself (evidence, receipts, the grader's trace) stays at `~/clique-sb4-20260920-astra-cal15/`. |

## Result

| category | 0.2.29 | 0.2.30 | **0.2.31** | 12-run fitted line at this run | vs line | sd (12 runs) |
|---|---:|---:|---:|---:|---:|---:|
| setup_and_docs | 92 | 88 | **93** | 87.9 | +5.1 | 2.77 |
| data_modeling | 85 | 82 | **85** | 82.7 | +2.3 | 2.46 |
| authorization | 96 | 96 | **97** | 97.2 | −0.2 | 2.63 |
| queries_and_live | 78 | 85 | **89** | 79.2 | +9.8 | 4.45 |
| writes_and_transactions | 93 | 96 | **95** | 94.5 | +0.5 | 1.60 |
| offline_sync | 97 | 96 | **95** | 95.5 | −0.5 | 2.01 |
| media_assets | 96 | 98 | **98** | 96.3 | +1.7 | 0.97 |
| background_work | 94 | 87 | **90** | 90.1 | −0.1 | 3.10 |
| client_integration | 90 | 92 | **90** | 89.8 | +0.2 | 1.35 |
| diagnostics_dev_loop | 94 | 95 | **94** | 94.7 | −0.7 | 1.48 |
| scale_and_limits | 83 | 82 | **86** | 76.9 | +9.1 | 6.49 |
| operations | 89 | 88 | **87** | 86.4 | +0.6 | 2.07 |
| **overall** | **89** | **90** | **91** | 88.3 | +2.7 | 1.75 |

The "fitted line" is the least-squares line through the twelve earlier comparable runs (0.2.16 → 0.2.30), extrapolated to
this one — the basis the pre-registration's thresholds were taken from (`tools/cal-series.py` in the wave-13 program
directory reproduces it).

Grader: **100 pass, 1 fail, 18 not-run of 119** — M1 13/13, M2 27/27, M3 14/15, M4 12/12, M5 12/12, M6 6/13, M7 0/9,
M8 16/18; O1 78, O2 78, O3 null (no holdout probe set was committed for this wave; no probes invented), O4 35 (no simulator
artifacts). The eighteen not-run are the nine M7 assertions the packet forbids and the nine native-simulator artifacts (M6
`a01`..`a07`, M8 `a17`/`a18`; Hermes exports only) — the same absence #14's grader scored as nine *fails*; this grader labels
it *not-run*, so the pass count (101 → 100) is not comparable across the two graders' labels while the substance (one real
fail) is. Coverage spot-check: honest. Eleven timing records, one failed (`m3-a07`, the major defect below).

**Defects.** `d-01`, **major**, M3: the application's typing indicator fires one unthrottled `setTyping` mutation per
keystroke and stamps its expiry from the server's processing time, so the 5 s deadline is set by the last write to drain,
not the last keystroke — 4.9 s after the harness's 45-character burst, over the brief's ceiling on 6/6 attempts (the
builder's design: throttle the writes and stamp from the keystroke; the observation that one server write per keystroke per
typing user drains slowly under load is recorded, not attributed). `d-02`, minor, M6: the application's replay script cannot
re-run against an already-replayed backend (a deterministic write id meets `E_ID_REUSED` and dies on a raw stack — the
application's script; the refusal is the platform's correct one). `d-03`, minor: the application's `acceptance.mjs`
rewrites the suite-status file the harness needs. `d-04`, cosmetic: a fixture password as a demo default. `d-05`, cosmetic:
a test one screen away from its assertion's wording. None is Snapback's. **The search expansion bound was not probed by this
grader** (no `kx*`, no `words`, no cursor probe in the report or trace; `m5-a09` checks word-prefix, case-insensitive matching
only) — as #14's grader did not.

## The pre-registered predictions, scored

The file (`aef5659e48`, amended before the run in `27fb616549` — `data_modeling` void unless MC1 is in the pin — and
`76593742a3` — W14a as built) named one threshold per category with a null band, every number from the twelve-run fit, plus a
mechanism criterion per lever scored from the evidence files by string search before any category is read, and a confound.

| lever · category | threshold | score | reading |
|---|---|---:|---|
| **W14b — the README as a 300-line orientation · `setup_and_docs`** | ≥ 91 confirms · 86–90 null · ≤ 85 refutes | **93** | **CONFIRMED** — 5.1 above its fitted line (1.8 sd). *Mechanism, met:* the README a cold builder reads fell 1,999 → 300 lines (the design's −1,699, 85%); the guide output the builder saved as evidence grew 2,905 → 3,451 lines across 8 → 14 cards (the reference read on demand: `app`, `assets`, `expire`, `presence`, `search`, `sql`, `sync` beside the seven #14 read); README + saved guide together 4,904 → 3,751 (−24%); the docs budget is enforced (`scripts/docs-budget.mjs` in `test.sh`, 300/300 at the publish gate). *Confound, did not fire:* `data_modeling` 85 sits inside its null band and `queries_and_live` 89 above its threshold — the deduction did not move. The scorer's note is the first in three runs with no orientation-volume deduction: "Published feed, prediction, and job guides supported later milestones without internal source access … no misleading documentation established." |
| **W14a — the expansion bound · `queries_and_live`** | ≥ 84 confirms · 76–83 null · ≤ 75 refutes; *void if the grader does not probe the bound* | **89** | **NULL by the file's own rule** — the number clears the threshold (9.8 above its line, 2.2 sd) but the grader did not probe the bound, and the file says the category is then read as null and the mechanism criterion is carried by the lane's own test: the 45/200/1,000-word walks are red on main `6002c855aa` on all four hosts and green on the pin (`W14a-base-red.md`, the review record). The number stands on record; the lever's prediction rolls forward. |
| **W14c — `data_modeling`** | ≥ 86 · 81–85 · ≤ 80; *void unless MC1 is in the pin; W15c alone read at the tie-break's share (≥ 86, else null)* | **85** | **VOID** (MC1 is not in the pin); at the tie-break's share, null (85 < 86). 2.3 above its line, inside the null band. The scorer's deduction is the same shape as #12–#14's ("Quarry required learning reference bridges, helper rules, bounded scans, and residency proofs") — the target MC1 was commissioned for. Rolls to #16 unchanged. |
| the holistic | not a criterion | 91 | reported, not read as evidence |

## What the builder met (its own log; attribution is the builder's, a floor on Snapback's share, not a count)

Twenty-four correction entries: **agent-error 20, environment 2, ambiguous 2, snapback4-defect 0** — Expo Router and Metro
shells, choreography expectations, a suite racing the choreography, write-id format, a reaction query whose read was
incomplete until the conversation prefix pinned its membership rule (the same lesson #14's essay drew), and, after the green
UI proof, a scale-time digest that parked on `E_BOUND` at the 16 MiB heap ceiling on a whole-chat count — "a documented
envelope that the first application design violated," re-cut into period-indexed message chunks with per-message idempotency
markers, after which the digest completed 33,949 chunks / 580,996 writes and re-ran with zero writes. One storage refusal it
earned racing a CLI job against the host's adoption of a new time index (`E_STORE database locked`, retried) — the second
calibration in a row whose builder met that class (#14's raced an explicit backfill against a derived rebuild); it is
recorded here as a candidate ticket, not attributed. Knowledge lookups: the README in full (300 lines), the client reference's
client/React sections, and fourteen `guide`/`why` outputs saved as evidence (#14: the README in full at 1,999 lines, and eight).
It did not meet the search bound.

## The series, fitted (thirteen runs on the comparable instrument, 0.2.16 → 0.2.31)

    overall  [90, 91, 88, 91, 88, 88, 91, 90, 89, 85, 89, 90, 91]
             mean 89.31   sd 1.75   slope −0.05/run   total drift −0.59
             (twelve runs: −1.54 against sd 1.75; the holistic's drift is inside the noise)

| category | first → last | slope/run | drift | > 1 sd | at twelve runs |
|---|---|---:|---:|---|---|
| scale_and_limits | 88 → 86 | −0.59 | −7.05 | yes — carried by #12's 65 | −9.77 |
| queries_and_live | 91 → 89 | −0.44 | −5.27 | yes — softened again | −8.38 |
| data_modeling | 85 → 85 | −0.38 | −4.55 | yes | −5.00 |
| background_work | 91 → 90 | −0.32 | −3.82 | yes | −3.46 |
| **setup_and_docs** | 96 → 93 | −0.20 | **−2.44** | **no** — drift 2.44 against sd 2.76 | **−4.08 (yes)** |
| operations | 88 → 87 | −0.08 | −0.99 | no | −1.12 |
| offline_sync | 93 → 95 | +0.33 | +3.96 | yes | +3.81 |
| authorization | 88 → 97 | +0.37 | +4.48 | yes | +4.19 |

## What this run decides

Under ruling 40 — removal tested against one named candidate with a measurement, judged against the category's own fitted
drift — **the removal candidate's prediction is confirmed on its first run**: `setup_and_docs` 93 against a threshold of 91,
5.1 above a line that had been falling at −0.37/run, with the mechanism the design named (the README a cold builder reads
fell by the amount predicted, the cards read on demand grew less than that) and without the confound. One run is one run;
the series says the same thing more quietly: `setup_and_docs`' decline no longer clears one standard deviation (−2.44 against
2.76), the one category whose decline had *steepened* at #14. `queries_and_live` 89 is the second run in a row above its
line by more than two sd on a pin whose search bound was, again, not probed — the number is on record and the lever's
prediction is null by the rule the file set for itself; it is the lane's own four-host regression, red on main and green on
the pin, that carries the mechanism. `data_modeling` is void and rolls to #16 with MC1, still the category no lever has
reached: its scorer's deduction has the same wording as three runs ago. The holistic 91 is the series' high, and is not a
criterion.

The lead commissions nothing by this record: wave 14 was the author's sign-off, and its two levers are landed and scored. The
candidates the record surfaces for the author's next decision, in order of evidence: MC1 (the `data_modeling` lever, whose
prediction is already pre-registered and waiting for its pin); the CLI-versus-host store contention two builders in a row
paid (`E_STORE database locked`); and the search bound's grader-side probe, absent from two graders now, which the next
packet's holdout probe set can make explicit.
