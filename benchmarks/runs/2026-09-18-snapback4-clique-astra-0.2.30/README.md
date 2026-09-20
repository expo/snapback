# Astra-medium Clique calibration #14 — `snapback4@0.2.30` / `snapback4-expo@0.2.21` (the pin after wave 13's rulings and the advice repairs)

**Result: holistic 90.** Builder green (M1–M6 and M8; M7 not attempted, as the packet prescribes) with **zero
Snapback-attributed corrections** (the builder's own attribution, which is a floor on Snapback's share, not a count of it —
six bounds-bar builders of eight self-attributed a packaging defect as their own error); grader 101 pass / 9 fail / 9 not-run
of 119; one major defect, the application's, none Snapback's. The fourteenth Astra-medium calibration, the twelfth on the comparable instrument (0.2.16 onward), and **the first
run that tests ruling 40's "advice first"** — its outcome was pre-registered before the score existed
(`issues/closed/20260918-pre-registered-prediction-for-calibration-14.md`) and is scored against that file below, not against
the number. Run by the wave-13 lead (session snapback-9c) on the author's say-so, immediately after 0.2.30 was published.
**Fit the series; do not compare this run to #13 alone.**

## Packet

| | |
| --- | --- |
| Packet | cloned from calibration #13 (itself #12's): the same frozen instrument (179 files, `INSTRUMENT.sha256` and `INSTRUMENT_COMMIT` unchanged), the same prompt templates, three cold lanes; only `PACKAGE_PINS.json` differs |
| Pins | `snapback4@0.2.30`, `snapback4-darwin-arm64@0.2.30`, `snapback4-expo@0.2.21` — published 18:11–18:16 UTC 2026-09-18 (bump `a397218e23`, ledger `0518ec9e76`); the launcher waited for the registry to serve both, then for the load gate |
| Builder | `codex exec`, `gpt-6-astra`, reasoning effort medium; cold, from the published packages, their README, `guide` and `why`; 18:19:48–20:18:33 UTC (1 h 58 min, exit 0); scale replay on its own clock 3,378 s excluding verification, 167,243 actions verified |
| Grader / scorer | the packet's independent grade (`claude-opus-5`, fresh session, the other family; 20:18–20:51 UTC) and same-family holistic score (`gpt-6-astra`, 20:51–20:53); `summarize_grades.py` / `aggregate_scores.py` exit 1 on a single-lane run — the series fit is `tools/cal-series.py` in the program directory |
| Host | Apple M5 Max, 18 cores, macOS 26; shared. Load at start 20.1 (gate < 40 passed at once); the 1-minute load during the run is in `host-load.log` (sampled every 60 s; 11–28 through the builder). The confound the pre-registration named — the provenance-scan stall that turned the publish's first gate red an hour earlier — had cleared by 18:03 (fresh launches back to 1 s) and no timing record in this grade was bound-limited |
| Attributions recorded before any grader ran | (1) the 32-word prefix-search expansion bound is UNCHANGED — a known limit; (2) `N_NO_HORIZON`'s advice is FIXED (W16H); (3) an oversized `/sync` page no longer wedges the device (`c60751e30f`); (4) wave 13's rulings 34/35/36 are in the pin; (5) ruling 32 makes `doctor` show more deferred→satisfied effects; (6) the device-horizon defect is fixed (W13g); (7) cold acquisition is not expensive; (8) the two agent-error classes #13 paid are questions about what the tool said; (9) no known reds at the pin — the publish's full-suite gate passed on `a397218e23` |
| Retained | `astra/FINAL.md`, `astra/grader-report.json`, `astra/m8-assertion-results.json`, the lane's `lane-FINAL.md`, `lane-final-report.md`, `lane-run-log.md`, `lane-diary.md`, `lane-essay.md`; `PACKAGE_PINS.json`; `host-load.log` |

## Result

| category | 0.2.28 | 0.2.29 | **0.2.30** | 11-run fitted line at this run | vs line |
|---|---:|---:|---:|---:|---:|
| setup_and_docs | 88 | 92 | **88** | 88.4 | −0.4 |
| data_modeling | 82 | 85 | **82** | 83.7 | −1.7 |
| authorization | 95 | 96 | **96** | 97.2 | −1.2 |
| queries_and_live | 81 | 78 | **85** | 77.9 | +7.1 |
| writes_and_transactions | 94 | 93 | **96** | 93.8 | +2.2 |
| offline_sync | 93 | 97 | **96** | 94.8 | +1.2 |
| media_assets | 95 | 96 | **98** | 95.7 | +2.3 |
| background_work | 91 | 94 | **87** | 91.9 | −4.9 |
| client_integration | 88 | 90 | **92** | 88.7 | +3.3 |
| diagnostics_dev_loop | 94 | 94 | **95** | 94.4 | +0.6 |
| scale_and_limits | 65 | 83 | **82** | 76.0 | +6.0 |
| operations | 85 | 89 | **88** | 85.9 | +2.1 |
| **overall** | **85** | **89** | **90** | 87.7 | +2.3 |

The "fitted line" is the least-squares line through the eleven earlier comparable runs, extrapolated to this one — the
comparison the pre-registration asked for.

Grader: **101 pass, 9 fail, 9 not-run of 119** (O1 80, O2 68, O3 85 provisional, O4 45). The nine fails are the same nine
as #13's: no iOS-simulator artifact for M6 and M8 (`m6-a01`..`a07`, `m8-a17`/`a18`; Hermes exports only), scored as absent
native evidence. The nine not-run are M7. Coverage spot-check: honest. Sixteen timing records, all passed, none
bound-limited beyond `m3-a07` at 4,311 ms of 5,000.

**Defects.** `d-01`, **major**, M3: the application's chat-settings member management reaches only the first 20 registered
profiles (its candidate list is `api.allPeople`, first 20 by id, no search or paging) and removing a member outside those 20
fails silently — the builder's, not Snapback's. `d-02`, minor, M8: the application's unread badge counts the viewer's own
messages from a second device and messages a peer deleted-for-everyone. `d-03`, minor, M5: **grouped global message search is
not newest-first** — groups come out in conversation-id order (`members[viewer] … by byPrincipal`), a chat holding the newest
hit listed after one whose hit was older, each group showing at most 3 hits with no per-chat continuation from the global
view. That is the shape of the search card's grouped one-cursor form (the membership index orders the page), and it is the
second search-shaped limitation two calibrations have named; the 32-word expansion bound (#13's d-01) was not probed by this
grader. `d-04`, cosmetic, M2: the post composer clears text typed while a previous post is sending.

## The pre-registered prediction, scored

The prediction (`52c74a223c`, filed during the builder phase) named its evidence in advance. **Confirms ruling 40:**
`diagnostics_dev_loop` and `setup_and_docs` at or above their fitted line; no increase in Snapback-attributed loops for the four
repaired shapes; strongest, the builder's evidence showing no `int has no fields` cluster, no `bool ?`/`!= null` repair, no
`server.ts` ESM restart loop. **Refutes:** those shapes still cost cycles, or `setup_and_docs` and `diagnostics` below their
line. **Tells nothing:** the holistic number.

| criterion | reading |
|---|---|
| `int has no fields` cluster (20 occurrences in #12's evidence) | **none** — 0 in the run log, final report, diary and every evidence file |
| `bool ?` / `!= null` repair (6 in #12) | **none** — the only `!= null` in the evidence are the guide cards' own text the builder saved |
| `server.ts` ESM restart loop (7 in #12) | **none** — no `Cannot use import statement outside a module`, no `.mts` rename |
| `N_NO_HORIZON` followed into a wrong index (1 in #12) | **not in the log** |
| Snapback-attributed correction loops | **0** (#13: 1; no increase) |
| `diagnostics_dev_loop` vs its fitted line | 95 vs 94.4 — **above** |
| `setup_and_docs` vs its fitted line | 88 vs 88.4 — **on the line** (0.4 is 0.14 of the category's sd 2.86): neither branch fired — as the file's author acknowledges, the condition did not partition the space (a conjunction whose negation is not the other branch); #15's prediction gets a threshold per category with an explicit null band |
| the holistic | 90 — reported, not read as evidence, as the file requires |

**Reading — two claims, kept apart.** *Mechanism, positive:* the four shapes the repairs targeted are gone from a two-hour
cold build whose predecessor paid 34 occurrences of them — 20 → 0 on `int has no fields`, 7 → 0 on the ESM restart loop,
6 → 0 on the `bool ?` repair, `N_NO_HORIZON` absent — and no Snapback-attributed loop replaced them. That is not noise.
*Magnitude, null:* `diagnostics` sits above its line and `setup_and_docs` sits on it; the repairs removed exactly the cost they
aimed at and that removal did not move `setup_and_docs`. The pre-registration's author, holding to the conclusion the file
pre-committed to (recorded here in their name, the derived-data session): "right about repair order, wrong about magnitude —
advice quality is worth doing because it is correct, a rewrite that recommends a silent bug is a defect whatever the score
does, but on this evidence it is not the lever holding the score down, and the surface-removal case is correspondingly
stronger than §20.23 argued." What this builder paid instead, from 22 saved `check` invocations: `upsert cannot
spell id; the key names the row` ×8, `require needs a refusal code: require <condition> else CODE` ×6, `len is not part of
Snapback 4` ×4, `feedFollows has no index byFollower` ×2, `assets have no field durationMs` ×2, and — the same correction
#13's builder paid — `likeCounts[.postId] is not a rule term` ×4. Each carried a rewrite; the essay: "The compiler usually
gave a precise replacement or a relevant guide card. That was helpful, but it was still a correction cycle caused by
transferring habits from other languages too casually … I benefited most when I treated diagnostics as explanations of the
model, rather than merely instructions for making the current line compile."

## What the builder met (its own log; attribution is the builder's, which is a floor on Snapback's share, not a count)

Sixteen correction episodes: **agent-error 13, environment 2, ambiguous 1, snapback4-defect 0.** The builder folded its
"initial dialect/compiler corrections (M4/M5/M8 and write-ID encoding)" into the run log rather than the table — the
corrections #13's builder listed one by one — and its table is application work: a router that kept duplicate profile ids, a
Metro watch that CI had disabled, a native asset resolver assumed on web, navigation-adapter fields, a Reply action inside
the wrong wrapper, a push oracle comparing an obsolete display name, a DM route that required an online mutation on cold
reopen (found by its own extra cold-reload proof), delivery receipts that scanned only the first inbox page (fixed with a
bounded per-principal query), and one storage refusal it earned by racing an explicit CLI backfill against the running host's
derived rebuild (`E_STORE: database is locked` — the builder stopped the host and backfilled offline). The two environment
events are the packet's (the read-only harness copy; a browser navigation interruption that passed on retry). It did not meet
the search bound in its own testing.

The essay, on completeness: "An index can find rows while still being unable to prove that a reader has seen the entire
authorized answer. A message-only reaction scan did not pin the conversation needed by its membership rule. Adding the
conversation prefix made the authorization scope explicit … These diagnostics encouraged a better design than silently
treating every returned array as exhaustive."

## The series, fitted (twelve runs on the comparable instrument, 0.2.16 → 0.2.30)

    overall  [90, 91, 88, 91, 88, 88, 91, 90, 89, 85, 89, 90]
             mean 89.18   sd 1.83   slope -0.18/run   total drift -1.82
             the drift no longer exceeds one standard deviation of the series (eleven runs: -2.27 against 1.81)

| category | first → last | slope/run | drift | > 1 sd |
|---|---|---:|---:|---|
| scale_and_limits | 88 → 82 | -1.16 | -11.6 | yes — carried by #12's 65 |
| queries_and_live | 91 → 85 | -0.72 | -7.2 | yes — softened from -10.4 |
| setup_and_docs | 96 → 88 | -0.54 | -5.4 | yes — steeper than at #13 (-3.6) |
| data_modeling | 85 → 82 | -0.53 | -5.3 | yes |
| background_work | 91 → 87 | -0.45 | -4.5 | yes |
| operations | 88 → 88 | -0.23 | -2.3 | yes |
| offline_sync | 93 → 96 | +0.25 | +2.6 | yes |
| authorization | 88 → 96 | +0.43 | +4.3 | yes |

## What this run decides

Under ruling 40's refined condition — judge `setup_and_docs` and `queries_and_live` against their own fitted drift, and
require a removal wave to name what it removes and predict the category it moves before it runs — the two categories read
opposite ways: `queries_and_live` 85 is seven points above its line on a pin that changed nothing in search (the grader
simply did not probe the bound this time), and `setup_and_docs` 88 is on a line that is still falling, now at −0.54/run, on
the first pin whose advice repairs a builder actually saw. The holistic decline no longer clears the series' noise; the
`setup_and_docs` and `data_modeling` declines still do — **the decline has localized**, and `data_modeling` at 82 with a drift
of −5.3 against its sd of 2.6 is arguably the sharper target now: the one category no wave in this programme has gone at
directly. The 32-word search bound's absence from this run is not evidence it stopped mattering — the grader did not probe
it; it was named twice on independent evidence and that stands.

The lead's recommendation to the author, commissioning nothing: wave 14 keeps the prefix search's expansion bound as its one
capability item (two calibrations and every bounds-bar builder name it; this grader's d-03 adds the grouped form's ordering
and its missing per-chat continuation beside it), and takes the pre-registration's own conclusion at its word — advice
quality was the right first repair and is not the lever on `setup_and_docs` — so the removal candidate is now the thing to
name and predict: the README's first screen and the cards a cold builder reads (this builder's twelve knowledge lookups went to
the README at lines 963 and 1001 and to `CLIENT-AND-OPERATIONS.md` at 550), with `setup_and_docs` as the category the
removal is predicted to move — and, beside it, `data_modeling` as the category to go at directly for the first time, with
its own pre-registered threshold and null band — measured by calibration #15 on the pin that carries it. The publish posture holds: 0.2.30 was
published on the author's say-so; the next pin waits for the author's next.
