# Astra-medium Clique calibration #13 — `snapback4@0.2.29` / `snapback4-expo@0.2.20` (the wave-13 pin)

**Result: holistic 89.** Builder green (M1–M6 and M8; M7 not attempted, as the packet prescribes); grader 101 pass / 9 fail /
9 not-run of 119; one major defect, the prefix search's 32-word expansion bound. The thirteenth Astra-medium calibration
and the eleventh on the comparable instrument (0.2.16 onward: the same frozen instrument, prompts, anchors and scorer
family). Run by the wave-13 lead (session snapback-9c) with the wave-12 lead's consent, after the bounds bar's "after" on
the same pin (`benchmarks/runs/2026-09-18-snapback4-boundsbar-after/`). **Fit the series; do not compare this run to #12
alone** — the correction the 0.2.28 record made to itself, and the test ruling 40 (LLP 3000.007 §14) set for this run in
advance.

## Packet

| | |
| --- | --- |
| Packet | cloned from calibration #12 (`~/clique-sb4-20260917-astra-cal12`): the same frozen instrument (179 files, `INSTRUMENT.sha256` and `INSTRUMENT_COMMIT` unchanged), the same prompt templates, three cold lanes; only `PACKAGE_PINS.json` differs |
| Pins | `snapback4@0.2.29`, `snapback4-darwin-arm64@0.2.29`, `snapback4-expo@0.2.20` — published 08:11–08:19 UTC 2026-09-18; verified from the registry by the derived-data session (`08292107c4`) |
| Builder | `codex exec`, `gpt-6-astra`, reasoning effort medium; cold, from the published packages, their README, `guide` and `why`; 08:59:12–11:01:54 UTC (2 h 2 min, exit 0); scale replay on its own clock 4,103 s, 167,243 actions acknowledged and verified at three checkpoints |
| Grader / scorer | the packet's independent grade (`claude-opus-5`, fresh session, the other family; 11:01–11:43 UTC) and same-family holistic score (`gpt-6-astra`, 11:43–11:45); `summarize_grades.py` / `aggregate_scores.py` exit 1 on a single-lane run (they expect the grok and muse lanes) — the series fit below is `tools/cal-series.py` in the program directory, which reproduces the 0.2.28 record's ten-run numbers exactly |
| Host | Apple M5 Max, 18 cores, macOS 26; shared. Load at start 18.7 (a load gate < 40 was armed and passed at once); during the builder the 1-minute load ran 18–81 (`host-load.log`, sampled every 60 s) — the peaks at 09:31 and 10:09 UTC are the wave-13 landings' test runs on this host (lanes W13I/W13J/W13K); the derived-data session held its full suite for the whole builder phase, the diet program was at rest |
| Attributions recorded before any grader ran | (1) ruling 32 (W15a, in this pin) makes `doctor` show more deferred→satisfied effects — the ruling working, not a regression; (2) the device-horizon P1 of #12's README is FIXED in this pin (W13g): a builder or grader that still sees skipped rows on a device feed reports a NEW defect; (3) cold acquisition is not expensive (43,721 rows / 6.7 MB, 0.4% of the corpus, `0f4ff08e98`) — a slow cold first feed points at the browser login-and-render path and host load; (4) `N_NO_HORIZON`'s rewrite string in this pin is still the OLD advice (fixed post-pin, W16H `a3ca6fab1e`, §20.23); (5) what wave 13 changed that a builder meets first (§20.22); (6) no known red on main at the pin |
| Retained | `astra/FINAL.md` (the holistic score with its rationale), `astra/grader-report.json` (the 101-assertion manifest's results, the defects, the O-dimension scores, timing records; the M8 subset's 18 are in `astra/m8-assertion-results.json`), the lane's `lane-FINAL.md`, `lane-final-report.md` (the correction table with evidence pointers), `lane-run-log.md`, `lane-diary.md`, `lane-essay.md`; `PACKAGE_PINS.json`; `host-load.log` |

## Result

| category | 0.2.27 | 0.2.28 | **0.2.29** | series mean (11) |
|---|---:|---:|---:|---:|
| setup_and_docs | 92 | 88 | **92** | 90.5 |
| data_modeling | 84 | 82 | **85** | 86.0 |
| authorization | 95 | 95 | **96** | 94.6 |
| queries_and_live | 83 | 81 | **78** | 84.1 |
| writes_and_transactions | 94 | 94 | **93** | 94.1 |
| offline_sync | 93 | 93 | **97** | 93.0 |
| media_assets | 96 | 95 | **96** | 96.6 |
| background_work | 86 | 91 | **94** | 92.6 |
| client_integration | 89 | 88 | **90** | 88.7 |
| diagnostics_dev_loop | 95 | 94 | **94** | 93.6 |
| scale_and_limits | 85 | 65 | **83** | 82.7 |
| operations | 84 | 85 | **89** | 87.0 |
| **overall** | **89** | **85** | **89** | **89.1** |

Grader: **101 pass, 9 fail, 9 not-run of 119** (the 101-assertion manifest: 85 / 7 / 9; the M8 subset: 16 / 2 / 0;
O1 75, O2 68, O3 85 provisional, O4 15, O5 band 75 provisional). The nine fails are one thing: no iOS-simulator
artifact for M6 and M8 (`m6-a01`..`a07`, `m8-a17`/`a18`; the lane produced Hermes exports and recorded the simulator
harness as `not-recorded`), scored as absent native evidence under the packet's rule that native passes are never
inferred from web behaviour. The nine not-run are M7, the fresh-session day-2 milestone the packet does not run.
Coverage spot-check: honest, no dishonest milestone. Defects: 1 major, 6 minor, 2 cosmetic.

**Defects.** `d-01`, **major**, M5: broad-prefix search is truncated — when a first term matches more than 32 distinct
words in a scope (the published expansion bound), in-chat, all-messages and people search return a partial page
(`complete:false, cut:"words"`) with no continuation; the grader's probe of 45 distinct `kx*` words got 20 hits and no
`next`. The lane had found the same at scale (`u09` → 20 of many, exact `u0900` complete), recorded it as a platform gap
and made the UI disclose incompleteness. This is the bound all three bounds-bar builders wrote into their reports as a
limit they had not met ("Word expansion still has the package's 32-word bound"); a grader met it at a realistic corpus.
`d-02`, minor, M2: the lane's documented acceptance entrypoint depends on run residue (the test seeds no >20-post
Following fixture) — the application's, not Snapback's.

**Timing.** Fourteen timing records, all passed, none bound-limited beyond `m3-a07` at 4,836 ms of 5,000. This grade
carried no cold-first-feed measurement of the kind that drove #12's `scale_and_limits` to 65 (its `coldFirstFeedMs` came
from an assertion this grader did not time); `scale_and_limits` 83 rests on the 167,243-action replay, the three
verified checkpoints and the search bound.

## What the builder met (its own log; attribution is the builder's, which is a floor on Snapback's share, not a count)

Correction events: **environment 4, agent-error 20, ambiguous 3, snapback4-defect 1.** The one Snapback-attributed
event is the word-expansion bound above. The environment events are the packet's own (a default Node 25 on PATH; the
frozen instrument's read-only copies; the choreography's fixture directory). The agent-error events are mostly
application work (a navigation race, a media picker that admitted Send early, a test that assumed a starter quote stayed
in the first fifty messages) — and five of them are **Quarry-language corrections**: a schedule written as `120s` where
the syntax takes m/h/d; aggregate arithmetic in a row rule (`E_QUARRY_UNKNOWN likeCounts[.postId] is not a rule term`);
a text key without its bound (`E_QUARRY_SYNTAX expected a number, got newline`); an ambiguous text key
(`E_QUARRY_AMBIGUOUS`, byId/byKey); and a ranked-wrapper type. Each was diagnosed with a location and a rewrite and cost
minutes; each was self-attributed as the builder's own error — the same self-attribution the bounds bar's builders showed
for the package's absent root export
(`issues/20260918-snapback4-no-root-export-six-bar-builders-of-eight-paid-a-loop-guessing-it.md`). Under ruling 40's
method ("what did the tool tell them, and could it have told them the repair"), the five were told; the search bound
was not — `cut:"words"` and no `next` carry no advice.

The builder's essay, unprompted on the point: "Quarry is a real language with its own rules, rather than a thin wrapper
around expressions I already know. A missing text bound, an ambiguous key, or an unsupported expression in a row rule can
stop compilation. I encountered each of those. The compiler usually supplied an actionable location and rewrite, which
made the correction inexpensive, but it did not eliminate the need to learn the language's distinctions." And on the
horizon note the packet warned about: the builder shipped full public post/like replication ("a larger cold store") and
never met `N_NO_HORIZON`'s bad advice — it is not in this run's log. Its scale probes on the full corpus: Following at
500 follows p50 3.7 ms against 3.6 ms at 5 follows and 3.5 ms for the celebrity follower; the busy chat's history 30 ms;
all-chat search 15 ms; people search 2.6 ms (`lane-final-report.md`).

## The series, fitted (eleven runs on the comparable instrument, 0.2.16 → 0.2.29)

    overall  [90, 91, 88, 91, 88, 88, 91, 90, 89, 85, 89]
             mean 89.09   sd 1.81   slope -0.23/run   total drift -2.27   (ten runs: -0.30/run, -2.67)
             the drift still exceeds one standard deviation of the series

| category | first → last | slope/run | drift | > 1 sd |
|---|---|---:|---:|---|
| queries_and_live | 91 → 78 | -1.04 | -10.4 | yes — 78 is the series low |
| scale_and_limits | 88 → 83 | -1.12 | -11.2 | yes — carried by #12's 65 |
| data_modeling | 85 → 85 | -0.39 | -3.9 | yes |
| setup_and_docs | 96 → 92 | -0.35 | -3.6 | yes |
| operations | 88 → 89 | -0.18 | -1.8 | no |
| offline_sync | 93 → 97 | +0.30 | +3.0 | yes — 97 is the series high |
| authorization | 88 → 96 | +0.43 | +4.3 | yes |

## What this run decides

Ruling 40 (LLP 3000.007 §14, ruled the same day, before this record) set the test: "a recovery toward 90 reads as the
decline having been noise, and a third consecutive fall at or below 85 earns the removal wave." **89 is the recovery;
the removal wave is not earned.** What the fitted line still says is recorded without being over-read: the drift is
beyond one standard deviation on a series whose sd is under two points, and the category that fell to its low did so on
one bound the tool names without advising. Beside it stands the bar's "after" on the same pin: every dead-end row went
to zero, the notes' sentences were narrated in their place, and the surface budget went the other way (+320 README
lines, +249 card lines) — the evidence ruling 40 itself says advice quality does not answer.

The lead's recommendation to the author, recorded in §20.22.7 and commissioning nothing: wave 14 takes the prefix
search's expansion bound as its one capability item — a continuation past 32 words, or a refusal that says which words —
applies ruling 40's method to what this builder was told, and tests removal against one named candidate with a
measurement rather than as a policy. The next calibration is on whatever pin carries that; 0.2.30 (rulings 34–36 and
W16H, all landed after this pin) is published after this record so the series stays attributable.
