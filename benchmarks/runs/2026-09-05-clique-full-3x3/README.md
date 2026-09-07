# Clique full run — Snapback 2 vs Convex vs Supabase × three models — 2026-09-05

**Commissioned by** Charlie Cheever, 2026-09-05, in the LLP 1017 session: "run a
clique benchmark (full, end to end) with snapback2, convex, and supabase … use astra
medium and grok 4.6 xhigh and muse 3.1 ultra for the clique run (do the entire
program with each of the 3 models separately)".

**Scope:** the full run of `benchmarks/briefs/social-messenger.md` — the continuous
session M1 → M2 → M3 → M4 → M5 → M6 → M8, then grading, then the fresh-session M7 —
with no product skips. Environment facts are in the run root's
`instrument/ENVIRONMENT.md` overlay (macOS arm64 M5 Max; iOS simulators available;
no docker; three lanes share the machine per wave).

**Snapback 2:** the published `snapback2@0.0.4` (npm; LLP 1017 landed as
`c48328c11`), never the source repository. **Convex:** `convex@1.45.0`,
anonymous/local. **Supabase:** `@supabase/supabase-js@2.112.4` against the hosted
`clique-pilot` project with per-wave namespace prefixes.

**Models, one wave each, three parallel lanes per wave:**

| Wave | Harness | Model / effort | Substitution |
| --- | --- | --- | --- |
| astra | codex-cli 0.153.4 `exec` | gpt-6-astra / medium | — |
| grok | grok 1.0.13 | grok-4.6 / xhigh | — |
| muse | Muse Code 1.0.3 `exec` | muse-spark-1.3 / xhigh | the account's muse CLI has no 3.1 model (`muse-3.1*` ids refused) and its `ultra` effort is gated closed |

**Raw lanes** (outside git): `/Users/ccheever/clique-full-20260905/` — `README.md`,
`instrument/`, `prompts/`, `lanes/<wave>-<backend>/`, `logs/`, `scripts/`
(`render.py`, `launch.py`, `watch.py`), `INSTRUMENT_COMMIT`, `SNAPBACK2_VERSION`.

**Evidence level:** N=1 per (model, backend) cell; same-machine parallel within a
wave; token accounting harness-native for codex and `null` for grok and muse.
Calibration, not a claim-eligible magnitude (LLP 0201 D5).

## Status

| Wave | Started | Lanes | Outcome |
| --- | --- | --- | --- |
| astra | 2026-09-05 16:30Z | snapback2, convex, supabase | convex: M1–M6, M8 green in 94 min, record validated. snapback2: M3, M4, M8 green at execution time and M1, M2, M5, M6 green then downgraded by the builder to `aborted` after its own end-of-run regression pass; builder session cut at ~19:30Z and resumed in the same session (logged in its run log); 4.06 h including the continuation; record validated. supabase: M1–M6, M8 green in 111 min; scale replay settled 167,157 actions in 10,693 s on its own clock after the hosted Auth rate limit ended a first attempt; record validated. All three lanes cleaned up their servers. |
| grok | 2026-09-05 21:40Z | same | convex: M1–M6, M8 green by 23:38Z, scale replay verified (167,157 settled in 2,222 s), ended 01:03Z. snapback2: M1, M2 green; M3 suite passed but two-client choreography never green; M4–M8 suites only; replay unfinished; no run record; 3 h 2 min. supabase: M1 green at 42 min, then no choreography segment green again, M2–M8 `aborted`; no Hermes export (bundler emitted private class fields hermesc rejects); no run record. Machine load 45–112 throughout from other sessions' work, so this wave's wall clocks run three to four times the astra wave's. |
| muse | 2026-09-06 01:05Z (attempt 1) / 01:25Z (attempt 2) | same | attempt 1 lost all three lanes at ~01:20Z to a provider outage (`transport error … api.meta.ai … after 4–5 provider attempts`), 14–15 min in, orientation only; retained under the harness's `lanes/attempt1/`, counts for nothing. Attempt 2 relaunched fresh at 01:25:34Z. snapback2: **M1–M6, M8 all green** with choreography (M3 7/7 initial, 6 + 1 optional-skip on the final bundle), final regression all suites pass on the shipping bundle, scale replay PASS (167,157 actions, 0 failed, 1,047 s, checkpoints 10/50/final green), 8.25 h wall, ended 09:40Z; seven Hermes exports. supabase: M1–M6, M8 green by 10:45Z per its final report (suite receipts m1–m8 pass, choreography green throughout, iOS simulator segments not recorded), essay and diary written at ~11:14Z, but the closing steps (prefix drop, `end=` epoch) never happened because the CLI then looped on provider transport errors for 13 h; the harness stopped that CLI and its two `server.mjs` listeners by pid at 1788742400 and started a continued session (same model, xhigh) to finish only the closing steps. convex: M1 green at 30 min; acceptance receipts m1–m5 all pass and choreography m1–m5 receipts present, but the builder stopped logging after `M2-start`, wrote no diary past M1, and its CLI idled for 17 h answering the auto-resolver with `leaving it running` (100 times); the harness stopped it by pid at 1788742500 (its servers died with it) and started a continued session to reconstruct M2–M5 logs from receipts, build M6/M8, run the scale replay, and write the report. Both continuations are recorded in the lanes' run logs as harness lines. |

### Grading and M7 phase (started 2026-09-07 ~01:00Z)

Grading runs one fresh headless Claude session per lane (`claude -p`, model
`claude-opus-5`, the frozen grader prompt plus a wrapper recording this run's
deviations: no committed probe set for the wave, an uncalibrated grader family,
Claude as the other family for all three builders, timing checks best-of-3 with
machine load recorded). The astra wave's three graders started first; the
astra-snapback2 grader runs on substitute ports 49120–49139 because 49100–49102
are held by the separate `clique-improvement` grading of the 0.0.6 build on this
host (recorded as a deviation in that lane's trace). Grok and muse graders
follow as load allows; the fresh-session M7 leg runs after each lane is graded,
because M7 changes the artifact. Grading reports land here as
`grading-<wave>-<backend>.json` when validated.

Per-lane records (`record-<wave>-<backend>.json`, validated with
`benchmarks/tools/social-messenger/record-validator.mjs`), the grading reports,
and the M7 fresh-session records are added here as each wave completes; the
builder diaries live in each lane's `diary.md` and are summarized in the
repository diary for this run.

## Holistic baseline recovered 2026-09-06

The raw directory above is on the fleet's **M5 Max black**, not every checkout's
local host. The retained scorer outputs are now copied here as
[`holistic-scores.json`](./holistic-scores.json) and
[`holistic-scores.md`](./holistic-scores.md), with the exact
[`scorer prompt template`](./holistic-score-prompt.md). Each scorer read its own
model family's three builder narratives at xhigh; this is a narrative-based
holistic assessment, not independent acceptance grading.

| Builder family | Snapback 2 0.0.4 | Convex | Supabase |
| --- | ---: | ---: | ---: |
| Astra medium | 64 | 84 | 77 |
| Grok 4.6 xhigh | 57 | 78 | 47 |
| Muse Spark 1.3 xhigh | 78 | 82 | 62 |
| **mean** | **66** | **81** | **62** |

Muse scores were added 2026-09-07 ~02:00Z once its three lanes were complete (see
Status); its scorer read its own lanes' narratives at xhigh like the other two. Its three attempt-2 builder PIDs (92425, 92498, 92520) were verified
live on 2026-09-06; 92425 exited on its own after writing its report, and the
harness stopped 92498 and 92520 on 2026-09-07 ~00:40Z for the reasons in Status
and replaced each with a continued session. A fresh Muse 1.3 probe requesting ultra reported
`gate ultra_reasoning_effort is closed; using xhigh`, then failed because the
remote SSH session could not access locked Keychain credentials. Neither that
probe nor the existing xhigh sessions proves the requested ultra comparison.

The scores above precede the 0.0.6 fixes. A new isolated Astra-medium full build
against npm 0.0.6 began on the office M1 under
`/Users/ccheever/clique-improvement/lanes/astra-snapback2-006`; it receives only
the copied instrument and installed product. It is diagnostic until completed
and independently assessed; its different machine and harness must be disclosed
when comparing it with this baseline. No higher score or completed bar is claimed.
