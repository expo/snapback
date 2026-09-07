# Clique full run — environment overlay (authoritative over the brief on environment facts only)

This run is the **full run: M1–M8** of `social-messenger.md`, executed as the brief
prescribes — one continuous session runs **M1 → M2 → M3 → M4 → M5 → M6 → M8** in
that order; **M7 is a separate fresh session run later by the orchestrator after
grading. Do not attempt M7 in this session.** Nothing in the product spec is
struck. Where this file and the brief conflict on an *environment* fact, this file
wins; on a *product* fact, the brief wins.

## Host

- macOS arm64, Apple M1 Max, 10 cores, 64 GiB RAM (MacBookPro18,4), macOS 26.6. Other development and verification processes share this Office host; record actual contention and wall clocks.

- Node **24.18.0** is first on PATH via `/Users/ccheever/clique-improvement/revisions/cli-016-release-qualification/tools/node-24.18.0/bin`. Use the absolute node executable, not a Volta shim. Bun **1.3.12** is available via `/Users/ccheever/.bun/bin`. Set PATH per process; preserve global configuration.

- Playwright Chromium/headless shell availability: Chromium and headless-shell revision1234 executables are present in the shared cache (observed only; not launched during readiness). The copied choreography uses its own package install and may reuse that cache.
- **iOS simulators are available** (11 available devices at launch preparation). Use `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` per process; Xcode 26.6 was verified. Use headless simulator/Playwright operation, record only owned devices/PIDs, and do not open the Simulator GUI or alter other sessions. The per-milestone iOS Hermes bundle export remains in scope. M6/M8 simulator artifacts remain separate native artifacts to attempt; absence never blocks web authoring green, and never fake one.

- Other development and verification processes share this host. Record actual
  contention and wall clocks. Use only the assigned ports and owned PIDs.
- Android is out of scope (spot-check only, per the brief).

## Instrument

`./instrument/` is a read-only snapshot of the repository's benchmark instrument
(commit in `../../INSTRUMENT_COMMIT`): the brief `social-messenger.md`,
`CONTRACT.md`, `protocol.md`, `schema/` (assertion manifest with executor classes;
run-record schemas), `fixtures/` (personas, starter segments `starter-m1.log`,
`starter-m2.log`, `starter-m3.log`, `sample-50.log`, the hash-pinned `scale.log`,
window and digest configs, `media/`), `ui/` (the frozen UI kit), `choreography/`
(the two-client Playwright harness), `grader/`, `metering/`, `observability/`.

**Do not write into `./instrument/`.** Copy `instrument/choreography` into your
lane directory before `npm install` there, and pass `--receipts` so receipts land
in your lane. Copy fixtures you need; never modify them.

## Seeds

Replay each starter segment through the app's own write path when its milestone
first needs it (M1: `starter-m1.log`; M2: `starter-m2.log` — with media; M3:
`starter-m3.log`). `profile-set` lines carry avatar paths under `fixtures/media/`.
The scale replay (`scale.log`) runs as the brief says: adapter authored inside
M6's budget, executed on its own recorded clock against a **fresh** backend
instance seeded with the starter log, verified against
`invariant-manifest-combined.json`.

## Ports and processes

Use only the port range named in your prompt. Record every server PID you start
in `run-log.md` and kill only those PIDs at the end; never `pkill`, `killall`, or
any pattern kill — other lanes share this machine.

## Green bar

A milestone is green only when (1) `npm run acceptance -- --milestone mN` passes
with a coverage manifest mapping every suite-required assertion of that milestone
(`instrument/schema/social-messenger/assertions.json`) to a test, and (2) the
matching two-client choreography segment passes. Record `green`,
`capability-failure`, `aborted`, `blocked-by-M{n}`, or `not-run` per milestone
exactly as the brief defines them. Safety limit: **four hours of wall clock per
milestone**; on exhaustion record `capability-failure` and proceed to the next
non-blocked milestone. Two consecutive capability failures end the lane.

## Tokens

Token accounting is harness-native where the harness exposes it (codex JSON
events) and `null`/advisory otherwise (grok, muse). Do not estimate tokens in
prose.
