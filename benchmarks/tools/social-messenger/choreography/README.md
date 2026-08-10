# Social-messenger choreography harness

This directory contains the P2-hardened Playwright harness for Clique's
milestone choreography. It launches isolated Alice and Bob browser contexts
(plus Carol for M5), signs the personas in through the contract's `sm-auth-*` IDs, runs selected
`m1()` through `m6()` segments, and writes structured JSONL receipts.

The harness consumes only test IDs frozen in `../CONTRACT.md`. A runtime guard
rejects any other ID. It never turns missing automation surface into a pass.

## Setup and usage

The instrument intentionally has no lockfile before P3 freeze. A runner must
provision the pinned Playwright and AJV dependencies from `package.json` and the
selected Playwright browser.

```sh
cd benchmarks/tools/social-messenger/choreography
npm install
npx playwright install chromium

CHOREO_BASE_URL=http://127.0.0.1:5173 \
CHOREO_PASSWORD='fixture-password' \
volta run --node 24.18.0 node choreography.mjs m3 \
  --suite-status /absolute/path/suite-status.json
```

`npm test` starts a tiny two-persona calibration app, executes M1 through the
real two-context harness, validates every emitted receipt against
`receipts.schema.json`, and requires an honest segment green. It also exercises
the pure aggregation edge cases: optional skip, required skip, and implemented
failure.

The positional segment argument is optional and defaults to `all`. It accepts
`all`, one milestone (`m1` ... `m6`), or a comma-separated ordered subset such
as `m1,m3,m6`.

Every implemented CLI flag is:

- `--browser <chromium|firefox|webkit>` — browser engine; default `chromium`.
- `--headed` — show both browser windows; default is headless.
- `--receipts <path>` — JSONL destination; default is `receipts.jsonl` beside
  `choreography.mjs`. The file is truncated at the beginning of each run.
- `--suite-status <path>` — optional JSON object keyed by milestone. Each value
  is `{ "pass": boolean, "receipt": string|null }`. Missing suite status is
  `null` and can never make a milestone green. A passing value must carry a
  non-empty suite evidence pointer in `receipt`.
- `--adapter <path>` — optional lane navigation/fixture adapter. It carries
  route paths and fixture choices only; it cannot report outcomes or bypass
  browser observations. The built-in adapter uses `/profile/{handle}`,
  `/profile/edit`, `/settings`, and `/search` plus the committed fixture pack.
- `--simulator-status <path>` — optional separately recorded M6 simulator
  status: `{ "id":"ios-simulator-m6", "pass":true|false|null,
  "receipt":string|null, "reason":string|null }`. It is retained in the M6
  summary but does not gate web green; see `simulator.md`.
- `--timeout <ms>` — positive integer timeout for ordinary UI observations;
  default `10000`. The M3 2-second appearance and 5-second expiry ceilings are
  fixed by the brief and are not relaxed by this flag.
- `--help` — print usage without loading Playwright.

Exit code `0` means every selected segment has `green:true` (suite plus complete
required choreography). Exit code `1` means execution completed but at least one
segment was not green because a required check was skipped, an implemented
check failed, or suite evidence was absent/failing. Exit code `2` is
configuration or fatal harness failure.

## Environment variables

- `CHOREO_BASE_URL` — required lane web URL.
- `CHOREO_PASSWORD` — shared fixture password fallback for Alice, Bob, and Carol.
- `CHOREO_ALICE_PASSWORD`, `CHOREO_BOB_PASSWORD` — per-persona passwords;
  `CHOREO_CAROL_PASSWORD` is also required for M5 unless the shared fallback is
  set. Passwords have no CLI flags so
  they do not appear in the process command line.
- `CHOREO_ALICE_EMAIL`, `CHOREO_BOB_EMAIL`, `CHOREO_CAROL_EMAIL` — optional;
  defaults are the corresponding `@example.com` personas from `CONTRACT.md`.
- `CHOREO_BROWSER` — default for `--browser`.
- `CHOREO_RECEIPTS` — default for `--receipts`.
- `CHOREO_SUITE_STATUS` — default for `--suite-status`.
- `CHOREO_ADAPTER` — default for `--adapter`.
- `CHOREO_SIMULATOR_STATUS` — default for `--simulator-status`.
- `CHOREO_BROWSER_EXECUTABLE` — optional browser executable path for runners
  using a system Chromium/Chrome with the Playwright protocol package.
- `CHOREO_TIMEOUT_MS` — default for `--timeout`.

CLI values override their environment defaults. `--headed` has no environment
alias.

## Segment coverage after P2 hardening

Implemented checks make real UI observations and fail normally
when the lane does not satisfy them:

- M1: display-name/bio edits appear on the other client live; session survives
  reload; logout remains signed out across reload.
- M2: live text-post delivery, live like/unlike count, repost attribution and
  removal, and reply count/thread projection. Live checks run all three trials.
- M3: typing visibility within 2 seconds and expiry within 5 seconds, plus quoted
  excerpt and jump behavior. Both run best-of-three.
- M4: photo render, video playback, reaction set/replace/remove, edit visibility,
  and delete-for-everyone tombstones across the isolated Alice/Bob contexts.
- M5: group color/background synchronization to Carol, view-once first/second
  view behavior, warm-offline search, and shortened-window disappearing purge.
- M6 web: two offline messages expose pending state, reconnect, arrive exactly
  in order, and reach read receipts.

Remaining unsupported assertions are emitted as `status:"skipped"`, with
`pass:null`, a reason, and whether they are required. Required skips keep the
segment non-green; optional skips are visible but do not masquerade as failures:

- M2 image/video composition and deterministic profile navigation for follow.
- M2 author avatar/display-name observation.
- M2 followed-user repost surfacing, which depends on that missing profile
  navigation.
- M3 semantic sent/delivered/read tokens (the ID exists, but glyph/color
  inference is not an honest state-machine proof).
- M3 DM sender-avatar, group aggregate-receipt, and member-removal/history
  choreography that the ticket did not extend.

The hardening extends the coordination contract for semantic controls and adds
a frozen route/fixture adapter for the four places where navigation cannot be
inferred from a component test ID. The adapter is input-only; the browser still
performs and observes every check.

## Receipts and green aggregation

Each assertion prints one line beginning `STRUCTURED RECEIPT ` and appends the
raw JSON object to the JSONL file. Timing-sensitive assertions always retain all
three attempts. A per-segment summary follows its assertions.

See `receipts-format.md` for field meanings and `receipts.schema.json` for the
machine schema. Milestone green is fail-closed:

```text
green = suite.pass === true && choreography.pass === true
```

M6 web green is intentionally distinct from the simulator artifact after the
ticket's P2 ruling. `simulator.md` remains the native proof contract; its status
is recorded under `choreography.supplementalExternal` and scored as native/O4
evidence rather than silently making every web milestone unreachable.
