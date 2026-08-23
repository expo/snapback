# Clique full-run — familiar vs explicit, all milestones

Author-requested (2026-08-22) full-scope Clique run: both Snapback authoring
profiles, all milestones (M1–M6, M8 continuous; M7 fresh-session), published
Snapback 0.1.24, one lane per profile.

- **Model:** GPT-5.6 Sol, codex CLI 0.149.0, xhigh, unsandboxed.
- **Profiles:** default explicit; familiar (`snapback-familiar-ts-v1` via
  `codegen.policy.json`), both consumed only from published npm 0.1.24.
- **Instrument:** social-messenger `0.3.2-m8` (manifest-verified), full scope
  including the scale replay (167,157 actions) and M7 day-2 evolution.
- **Evidence level:** N=1 per profile — calibration/exploratory only, no
  magnitude or scored claim (LLP 0201 D5).
- **Execution:** lanes ran on the primary Apple Silicon machine. Explicit used
  ports 48100–48159; familiar 48160–48219; M7 explicit 48300–48359; M7 familiar
  48360–48419. A separate session's reduced lane ran concurrently on 48000+
  during the explicit build (same-machine wall caveat).
- **Adjudication:** every green claim verified against retained receipts
  (suite `pass: true` + choreography `green: true` per milestone; M7 is
  suite-only since the harness has no `m7` segment). This means web
  authoring-green, not complete product parity: the Familiar M8 digest
  recorded `scheduleDriven: false`, and the separate grader that owns that
  obligation was not run.

Raw lane directories, event streams, receipts, prompts, and reports are
retained outside git at `/Users/ccheever/clique-full-20260822/` on the
execution machine. Consolidated results: [record.md](./record.md). Build
experience: `diaries/0109-clique-full-explicit-vs-familiar.diary.md`.
