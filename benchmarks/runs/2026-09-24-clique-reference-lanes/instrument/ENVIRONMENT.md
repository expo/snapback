# Clique reference lanes — environment overlay (authoritative over the brief on environment facts only)

This run is **M1 → M2 → M3 → M4 → M5 → M6 → M8** of `social-messenger.md` in one
continuous session, in that order, **with nothing struck**: media (avatars,
image and video posts, photo and video messages, view-once photos, chat
background images, asset revocation), server-enforced expiry with no client
open, and the scheduled daily digest are all in scope exactly as the brief
specifies them. **M7 is a separate fresh session run later by the orchestrator
after grading; do not attempt it.** Where this file and the brief conflict on an
*environment* fact, this file wins; on a *product* fact the brief wins.

Nothing is `struck-by-environment` in this run. Every assertion in
`schema/social-messenger/assertions.json` is graded at the brief's bar; a
requirement the platform cannot meet is recorded as `capability-failure` with
the exact diagnostic, never omitted.

## Host

- macOS arm64, Apple M5 Max, 18 cores, 128 GB RAM. Three lanes (one per backend)
  share this machine in parallel for the whole wave; expect contention and
  record wall clocks honestly. Other processes may share it too.
- Node **24.18.0** is first on your PATH via an absolute toolchain directory
  (`~/.volta/tools/image/node/24.18.0/bin`). If a tool hangs at exit, use the
  absolute node. Bun 1.3.12 is available. **No docker.**
- Playwright chromium is not pre-installed; `npx playwright install chromium`
  inside your copied choreography directory installs it (network is available).
- iOS simulators exist (Xcode, iPhone runtimes). Android is out of scope.

## Instrument

`./instrument/` is a read-only snapshot of the repository's benchmark instrument
(commit in `../INSTRUMENT_COMMIT`): the brief `social-messenger.md`,
`CONTRACT.md`, `protocol.md`, `schema/` (assertion manifest with executor
classes; run-record schemas), `fixtures/` (personas, starter segments
`starter-m1.log`, `starter-m2.log`, `starter-m3.log`, `sample-50.log`, the
hash-pinned `scale.log`, window and digest configs, `media/`), `ui/` (the
frozen UI kit), `choreography/` (the two-client Playwright harness), `grader/`,
`metering/`, `observability/`.

**Do not write into `./instrument/`.** Copy `instrument/choreography` into your
lane directory before `npm install` there, and pass `--receipts` so receipts land
in your lane. Copy fixtures you need; never modify them.

## Seeds

Replay each starter segment through the app's own write path when its milestone
first needs it (M1: `starter-m1.log`; M2: `starter-m2.log`, media lines
included — the fixture assets are under `fixtures/media/`; M3:
`starter-m3.log`). The scale replay (`scale.log`) runs as the brief says:
adapter authored inside M6's budget, executed on its own recorded clock against
a **fresh** backend instance seeded with the starter log, verified against
`invariant-manifest-combined.json`, media actions included.

## Ports and processes

Use only the port range named in your prompt. Record every server PID you start
in `run-log.md` and kill only those PIDs at the end; never `pkill`, `killall`, or
any pattern kill — other work shares this machine.

## Green bar

A milestone is green only when (1) `npm run acceptance -- --milestone mN` passes
with a coverage manifest mapping every suite-required assertion of that milestone
(`instrument/schema/social-messenger/assertions.json`) to a test, and (2) the
matching two-client choreography segment passes for every check. Record `green`,
`capability-failure`, `aborted`, `blocked-by-M{n}`, or `not-run` per milestone
exactly as the brief defines them. Safety limit: **four hours of wall clock per
milestone**; on exhaustion record `capability-failure` and proceed to the next
non-blocked milestone. Two consecutive capability failures end the lane.

## Tokens

Token accounting is harness-native where the harness exposes it (codex or claude JSON events) and null otherwise. Do not estimate tokens
in prose.
