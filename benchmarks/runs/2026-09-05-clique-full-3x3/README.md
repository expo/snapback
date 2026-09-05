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

**Snapback 2:** the published `snapback2@0.0.3` (npm; LLP 1017 landed as
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
| astra | — | snapback2, convex, supabase | pending |
| grok | — | same | pending |
| muse | — | same | pending |

Per-lane records (`record-<wave>-<backend>.json`, validated with
`benchmarks/tools/social-messenger/record-validator.mjs`), the grading reports,
and the M7 fresh-session records are added here as each wave completes; the
builder diaries live in each lane's `diary.md` and are summarized in the
repository diary for this run.
