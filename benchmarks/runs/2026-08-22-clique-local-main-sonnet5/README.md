# Clique local-main Claude Sonnet 5 — 2026-08-22

Author-requested diagnostic run of Clique M1–M8 on the latest local Snapback
source without publishing (the author had not published to npm in a while
and wanted a real read on current `main`). Two lanes, run serially with cold
(no shared memory) builder agents: the default Explicit profile, then the
Familiar profile.

- **Model:** Claude Sonnet 5 (this session's model), default reasoning
  effort, run as a Claude Code subagent (general-purpose) with full tool
  access — not Codex, unlike the prior local-main run (diaries 0104/0105).
- **Snapback:** clean-relative source commit
  `b70caf19eae1d4763224ebd182955e04430a67eb`; content-addressed local package
  tarballs (a pre-existing closure discovered already packed at this exact
  commit by concurrent same-day activity in the shared scratch directory,
  reused rather than re-packed) and the commit-local qualified debug
  runtime. Nothing was published.
- **Instrument:** the frozen Clique social-messenger brief
  (`benchmarks/briefs/social-messenger.md`, still DRAFT/pre-freeze) and its
  fixture pack (`benchmarks/fixtures/social-messenger/`, `instrumentPin`
  `social-messenger@0.3.2-m8`). Milestones M1–M8, built in plain numeric
  order (a disclosed deviation from the brief's own M8-before-M7 scored-run
  ordering, which is infrastructure for a different, formally-scored
  instance). **The fixture pack's starter/seed action logs only cover
  M1–M3** (`starter-m1.log`..`starter-m3.log`); both lanes discovered this
  independently and authored their own minimal seed content for M4+ where
  needed rather than stopping.
- **Lane setup:** `benchmarks/tools/lane-setup.mjs` could not be used to
  generate the standard `AGENTS.md`/`BENCHMARK-ORIENTATION.md`/
  `lane-report.json` packet for either lane, for two independent reasons
  discovered during prep: (1) the tool refuses milestones beyond M3 because
  the frozen fixture pack has no `starter-m4.log`+ artifacts to link, and
  (2) even restricted to M1–M3, it refuses to write `AGENTS.md` into a
  freshly `snapback new`-scaffolded app directory because the scaffold
  already wrote its own, non-matching `AGENTS.md`. Both lanes instead
  received a hand-written orientation packet directly in their launch
  prompt, pointing at the same frozen brief/fixtures/UI-kit/choreography
  artifacts under `benchmarks/` in this checkout. This is a real gap in the
  tooling at this brief's current (pre-freeze) state, not a workaround
  chosen for convenience.
- **Scope cuts, both lanes (disclosed in advance):** web-only proof; no iOS
  Simulator, EAS delivery, physical-device builds, or per-milestone iOS
  Hermes bundle exports, even though the brief mentions them. Android was
  already out of scope per the brief itself.
- **Evidence level: diagnostic/calibration only.** The current-source pin is
  not a published npm closure, N=1 per profile, and — unlike the prior
  Codex-based local-main run, which used the same frozen Playwright
  choreography for both lanes — **the two lanes here used different
  acceptance methodologies** (see Results). It is not claim-eligible and
  does not support magnitude or cross-lane efficiency claims.
- **Concurrent activity:** the shared scratch directory
  (`/Users/ccheever/clique-main-20260822/`) was already in use by at least
  two other same-day, independently-orchestrated diagnostic runs against the
  same commit (`benchmarks/runs/2026-08-22-clique-local-main-grok/`,
  `benchmarks/runs/2026-08-22-clique-local-main-0125/`) — this run's lanes
  (`explicit/`, `familiar/` subdirectories) did not read, modify, or
  coordinate with that other activity beyond reusing its already-built local
  package tarballs.

Raw lane directories (generated app, run-log, diary, essay, final report)
are retained outside git at `/Users/ccheever/clique-main-20260822/{explicit,
familiar}/` on the execution machine. Consolidated results are in
[record.md](./record.md); build experience is recorded in diaries 0107 and
0108. The most consequential single finding — a shipped, disclosed privacy
regression in the Familiar lane's messaging tables, with an open question
about its true root cause — is tracked in
`issues/shelved/20260822-membership-visibility-read-denial-needs-reverify.md`.
