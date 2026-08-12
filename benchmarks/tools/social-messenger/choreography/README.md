# Social-messenger choreography harness

This directory contains the P2-hardened Playwright harness for Clique's
milestone choreography, extended for M8. It launches isolated Alice and Bob
browser contexts, adds Carol for M5 and a second same-account Alice context for
M8, signs them in through the contract's `sm-auth-*` IDs, runs selected `m1()`
through `m6()` and `m8()` segments, and writes structured JSONL receipts.

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

`npm test` starts a tiny calibration app, executes M1 and M8 through the real
multi-context harness, validates every emitted receipt against
`receipts.schema.json`, and requires honest segment greens. The app implements
the M8 likes, multi-device unread, live-message, and warm-offline queue surfaces
instead of short-circuiting browser observations. A second M8 run deliberately
serves stale Insights and must exit non-green. The test also exercises the pure
aggregation edge cases: optional skip, required skip, and implemented failure.

The positional segment argument is optional and defaults to `all`. It accepts
`all`, one milestone (`m1` ... `m6` or `m8`), or a comma-separated ordered
subset such as `m1,m3,m8`. `all` runs M1–M6 followed by M8; M7 remains the
brief's separate fresh-session milestone and has no web choreography segment.

Scoring DAG: M3 requires M1 only; M3 does not require M2. Reduced-run
protocol: execute M1, then M2, then M3 in that order. Do not start M3 to
avoid an unfinished M2. A reduced run that skips M2 is non-conforming even
though M3's scoring prerequisite is only M1.

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
  `/profile/edit`, `/settings`, `/search`, and `/insights` plus the committed
  fixture pack. `routes.insights` may override the M8 Insights route.
- `--simulator-status <path>` — optional separately recorded M6/M8 simulator
  statuses. A single legacy status object is accepted, as is a bundle keyed by
  `m6` and/or `m8`; entries use `{ "id":"ios-simulator-m6"|
  "ios-simulator-m8", "pass":true|false|null, "receipt":string|null,
  "reason":string|null }`. Each entry is retained only in its matching summary
  and never gates web green; see `simulator.md`.
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
- `CHOREO_PASSWORD` — shared fixture password fallback for Alice, Bob, and Carol;
  Alice's M8 second context uses the same Alice credential.
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
- M2: live text-post delivery, follow/unfollow Following projection, author
  display name on `sm-feed-item`, live like/unlike count, repost attribution
  and removal, follow-edge vs viewer-repost disambiguation on Following, and
  reply count/thread projection. Live checks run all three trials.
- M3: live DM text on `sm-convo-bubble`, typing visibility within 2 seconds
  and expiry within 5 seconds, plus quoted excerpt and jump behavior. Live
  checks run best-of-three.
- M4: photo render, video playback, reaction set/replace/remove, edit visibility,
  and delete-for-everyone tombstones across the isolated Alice/Bob contexts.
- M5: group color/background synchronization to Carol, view-once first/second
  view behavior, warm-offline search, and shortened-window disappearing purge.
- M6 web: two offline messages expose pending state, reconnect, arrive exactly
  in order, and reach read receipts.
- M8 web: Bob's like increments Alice's refreshed Insights total; a second
  Alice context receives a same-account message live; opening the conversation
  on Alice client 1 clears `sm-chats-unread` on client 2; and two warm-offline
  Alice clients each queue a message, reconnect in an observed server-arrival
  order, converge without duplicates, and reach normal read receipts.

Remaining unsupported assertions are emitted as `status:"skipped"`, with
`pass:null`, a reason, and whether they are required. Required skips keep the
segment non-green; optional skips are visible but do not masquerade as failures:

- M2 image/video composition (no compose media-picker test ID).
- M2 feed-author avatar (no feed-avatar test ID; display name is required).
- M3 sender-avatar (no sender-avatar test ID; live DM text is required).
- M3 semantic sent/delivered/read tokens (`sm-convo-receipt` exists, but
  glyph/color inference is not an honest state-machine proof).
- M3 group aggregate-receipt and member-removal/history (no group-member
  lifecycle controls in the frozen contract).

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

Segment summaries also emit `nonGreenCause` (`null` when green; otherwise
`suite-failed` | `choreography-failed` | `required-unimplemented` |
`instrument`). The field is optional on the `0.3.0-m8` schema (default
`null`) so older receipts still validate; the emitter always writes it.
Lanes MUST copy that field into the run record. Do not invent a second
green label such as "functionally green".

M6 and M8 web green are intentionally distinct from their simulator artifacts.
`simulator.md` remains the native proof contract; each matching status is
recorded under `choreography.supplementalExternal` and scored as native/O4
evidence rather than silently making web milestones unreachable.
