# Clique rerun — Snapback 2 `0.0.21`, astra + grok — 2026-09-10

**Commissioned** as wave 3 (`runs`) of the RFC implementation program (LLP 1020 A8.4: "the
product journeys, cold, on the published package"; the elegance program's "Clique cold rerun"),
authorized by the author's "ok commit those then implement all of the RFCs" (2026-09-10).

**Scope:** `benchmarks/briefs/social-messenger.md` on **Snapback 2 only** — the continuous
session M1 → M2 → M3 → M4 → M5 → M6 → M8, grading (a fresh claude-opus-5 grader), the
fresh-session M7 (day-2 evolution on the populated store), then
`benchmarks/briefs/messaging-day2-evolution.md` as a fresh session on a copy of the finished app.
The instrument is the 2026-09-05 3×3 run's, unchanged (`INSTRUMENT_COMMIT`
`f40559f37722c79178be664a11f8a6485f1508fd`), so scores compare with that run; the scoring
template scores the single lane on the same absolute rubric (`prompts/score.template.md` in
the run root, single-lane variant). Run root: `~/clique-ri-20260910/`.

**Snapback 2:** the published `snapback2@0.0.21` (npm), never the source repository — LLP 1021
(effects in the loop) implemented, LLP 1020 Part A (day-two evolution, legible ceilings)
implemented, LLP 1019 D1–D3 (the `deliver` custody log) landed, the elegance program before them.

| Wave | Harness | Model / effort | Ports |
| --- | --- | --- | --- |
| astra | codex-cli `exec` | gpt-6-astra / medium | 52100–52119 (day-2 brief: 52200–52219) |
| grok | grok CLI | grok-4.6 / xhigh | 52400–52419 |

## astra

| Phase | Result |
| --- | --- |
| Continuous session M1–M6, M8 | every milestone green, 2.27 h wall (attempt 2; attempt 1 aborted M1 on a harness gap: the run root's `lib/json-schema.mjs` was not copied — `lanes/attempt1/README.md`) |
| Grading (claude-opus-5, fresh) | 100 / 116 in-scope assertions under the grader's own execution (M1 13/13, M2 27/27, M3 14/15, M4 12/12, M5 12/12, M6 6/13, M8 16/18; M7 unrun by design); O1 72, O2 84, O4 50 — `grading-astra-snapback2.json` |
| Score (astra family, same rubric as the 3×3) | **82 overall** (2026-09-05 on 0.0.4: 64; Convex 84, Supabase 77 that day) — `scores-astra.md` |
| M7 (fresh session, populated store) | GREEN in 19 m 4 s: required successor installed (optional → bounded fill job → required for the message count, `nullRows=0`), exact M6 snapshot comparison, polls with offline votes, all prior suites, iOS export — `m7-astra-final-report.md`, `m7-astra-diary.md` |
| Day-2 brief (fresh session, copy of the finished app) | 3 / 3 change requests PASS in 17 min: **0 forced resets, 0 drops, 0 fill jobs**; CR1 nullable `editedAt` on live data = 2 checks + 1 watcher install (126 s); CR2 member-only live pins = 1 check + 1 install (206 s); CR3 pure refactor = identical generation (397 s incl. a real 180 s expiry test) — `day2-astra-final-report.md`, `day2-astra-diary.md` |

**The A8.4 number (LLP 1020 Part B waits on it):** on 0.0.21 an additive day-two change costs
one `check` and one watcher-installed successor; a new required field costs optional → fill
job → required (three steps); no change dropped the database or forced a reset. The builders'
friction was elsewhere: the global-search closure budget refusing a page of 20 (CR1), the drain
being ascending-append-only so a mutable pin list needed a live query (CR2), and query-bound and
binder-type diagnostics during M7.

**Platform findings recorded by the astra runs** (tickets: `issues/20260910-snapback2-clique-0021-findings.md`):
the view-once descriptor omitted from durable snapshots; a maintained-aggregate disagreement on
durable queries (M8 returned zero aggregates despite receipt guards); a schedule/schema diagnostic;
group-route resolution over the first 20 memberships after repeated fixture creation.

## grok

_(appended when the wave completes: build, grading, score, M7)_

## Evidence level

N=1 per (model) cell; astra and grok lanes ran in parallel on one machine with the program's
other work (codex lanes, a host verify) beside them; token accounting harness-native for codex,
`null` for grok. Calibration against the 2026-09-05 table, not a claim-eligible magnitude (LLP 0201
D5).
