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
| muse | 2026-09-06 01:05Z | same | running |

Per-lane records (`record-<wave>-<backend>.json`, validated with
`benchmarks/tools/social-messenger/record-validator.mjs`), the grading reports,
and the M7 fresh-session records are added here as each wave completes; the
builder diaries live in each lane's `diary.md` and are summarized in the
repository diary for this run.
