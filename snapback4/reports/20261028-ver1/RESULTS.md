# VER1 results

All eight complete sessions finished from empty directories with the package initially uninstalled. Every installed SDK file and native binary matched the pinned tarball, and every builder wrote its terminal report. Replay copies were deleted after measurement.

| Idea / model | Verify calls before → after | Total calls | Input M | Wall min |
|---|---:|---:|---:|---:|
| cpap equipment setups / codex | 4 → 5 | 31 → 30 | 1.63 → 1.50 | 9.35 → 8.97 |
| boat shrink wrapping / codex | 6 → 5 | 40 → 34 | 2.63 → 1.97 | 11.71 → 9.97 |
| spray foam insulation / muse | 26 → 35 | 101 → 120 | 10.52 → 13.29 | 13.70 → 21.88 |
| residential appraisal orders / muse | 19 → 26 | 97 → 101 | 10.08 → 10.33 | 14.57 → 15.07 |

| Requested bar | Observed | Result |
|---|---|---|
| Verify calls −30% or more | 55 → 71 (+29.1%); Codex 10 → 10, Muse 45 → 61 | MISS |
| Zero Codex install polls | Tool completion polls 8 → 4; explicit installer status/wait commands zero | MISS under the strict all-install-polls interpretation |
| No Muse foreground probe wait >15 s | Five after waits of 40.2–55.1 s; max 55.051 s | MISS |
| Installer survives caller-group kill 10/10 | All ten trials pass, including retained exit 17 | PASS |

No after builder invoked the emitted verify entry point. The unchanged first-read still lists separate check/acceptance/frontend/probe commands; TOK4 owns that content. The long Muse waits involved application changes to probe infrastructure: Spray Foam had no guard reference in its scripts, and Appraisal explicitly forced hold:true. Those observations explain why a working default guard does not establish the whole-session bar; they are not a reason to disable intentional hold or claim a performance win. These are four paired stochastic controls, not a new full bakeoff score.

The runtime replay packages bind f6a86a6cce / review snapshot 5220560b91. Later branch changes repair next-entry changelog wording and stale consumer/test fixtures; they do not change the runtime delta exercised by the replays. The before source is git archive 1c4c51b551, built in production profile. Both arms contain byte-identical wasm. See METHOD.md for exact brief/CLI, mirror and timing details.

## Packed behavior and installer decision

| Packed starter | Fresh frontend install, ms | Full verify, ms | Result |
|---|---:|---:|---|
| web | 10892 | 37248 | PASS, four phases / three-line summary |
| password | 10906 | 37635 | PASS, four phases / three-line summary |
| expo | 30093 | 43610 | PASS, four phases / three-line summary |

Foreground remains the default. Keep explicit deferred admission: real mirror installs take about 11–30 seconds even in these fresh-directory, warm-cache controls. Deferred mode has a new session/group, file-backed stdio, request-specific admission and pinned completion receipts. Tests kill the caller group immediately after command return, as Codex does.

The bare packed password probe returns idle in 10,961 ms, then refuses a repeat in 161 ms. The actual unmodified bakeoff/probe.mjs startServe helper holds an empty probe beyond 11.5 seconds through harn34’s hold environment. Failed startup, legacy receipts and held-check records have targeted regressions.

## Qualification and checks

See WORKSTREAM-REPORT.md for final receipt paths and exact check outcomes. Packed qualification attempts retain their first failures: changelog app-option attribution; inherited start/staging lookup; inherited README API-tour lookup. Fixtures now follow the already implemented start → workflow route and retain the dedicated security checklist. No first-read text, runtime security rules, native serve lifetime or version was changed.

Two inherited guide-budget assertions remain outside VER1: deploy-card compactness and the historical 30% compression target (12,811 words versus 12,810 allowed). Governing source/test hashes match 1c4c51b551. They remain explicit named exclusions in the scoped run and have a filesystem follow-up; thresholds were not raised.

Raw model traces and tarballs remain in private local evidence; committed summaries contain counts, digests and per-call categories, not credentials or app stores. All /tmp/ver1-replay copies and their owned leftover processes were removed.
