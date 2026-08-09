# Social-messenger choreography harness

This directory contains the P1 two-client Playwright skeleton for Clique's
milestone choreography. It launches isolated Alice and Bob browser contexts,
signs both personas in through the contract's `sm-auth-*` IDs, runs selected
`m1()` through `m6()` segments, and writes structured JSONL receipts.

The harness consumes only test IDs frozen in `../CONTRACT.md`. A runtime guard
rejects any other ID. It never turns missing automation surface into a pass.

## Setup and usage

P1 intentionally has no installed dependencies or lockfile. A runner that wants
to execute it must provision the single pinned dependency from `package.json`
and the selected Playwright browser. No install was performed when this skeleton
was authored.

```sh
cd benchmarks/tools/social-messenger/choreography
npm install
npx playwright install chromium

CHOREO_BASE_URL=http://127.0.0.1:5173 \
CHOREO_PASSWORD='fixture-password' \
node choreography.mjs m3 --suite-status /absolute/path/suite-status.json
```

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
- `--timeout <ms>` — positive integer timeout for ordinary UI observations;
  default `10000`. The M3 2-second appearance and 5-second expiry ceilings are
  fixed by the brief and are not relaxed by this flag.
- `--help` — print usage without loading Playwright.

Exit code `0` means every selected segment has `green:true` (suite plus complete
choreography). Exit code `1` means execution completed but at least one segment
was not green, including `implemented:false` or missing external evidence. Exit
code `2` is configuration or fatal harness failure.

## Environment variables

- `CHOREO_BASE_URL` — required lane web URL.
- `CHOREO_PASSWORD` — shared fixture password fallback for Alice and Bob.
- `CHOREO_ALICE_PASSWORD`, `CHOREO_BOB_PASSWORD` — per-persona passwords;
  together they override the shared fallback. Passwords have no CLI flags so
  they do not appear in the process command line.
- `CHOREO_ALICE_EMAIL`, `CHOREO_BOB_EMAIL` — optional; defaults are
  `alice@example.com` and `bob@example.com` from `CONTRACT.md`.
- `CHOREO_BROWSER` — default for `--browser`.
- `CHOREO_RECEIPTS` — default for `--receipts`.
- `CHOREO_SUITE_STATUS` — default for `--suite-status`.
- `CHOREO_TIMEOUT_MS` — default for `--timeout`.

CLI values override their environment defaults. `--headed` has no environment
alias.

## Segment coverage in P1

The skeleton's implemented checks make real UI observations and fail normally
when the lane does not satisfy them:

- M2: live text-post delivery, live like/unlike count, repost attribution and
  removal, and reply count/thread projection. Live checks run all three trials.
- M3: typing visibility within 2 seconds and expiry within 5 seconds, plus quoted
  excerpt and jump behavior. Both run best-of-three.
- M6 web: two offline messages expose pending state, reconnect, arrive exactly
  in order, and reach read receipts.

The following are represented but intentionally `implemented:false` because P1's
frozen IDs do not yet expose enough deterministic semantics:

- M1 profile field editing/live visibility.
- M2 image/video composition and deterministic profile navigation for follow.
- M2 followed-user repost surfacing, which depends on that missing profile
  navigation.
- M3 semantic sent/delivered/read tokens (the ID exists, but glyph/color
  inference is not an honest state-machine proof).
- M4 media picking, emoji choice, edit, and delete-for-everyone.
- M5 settings navigation/value semantics, disappearing controls, and view-once
  controls.
- M6 iOS simulator evidence, specified in `simulator.md` for P2 implementation.

Pilot hardening must either extend the coordination contract or add a frozen
lane navigation/state adapter without inventing lane-specific selectors. It must
also exercise the skeleton against calibration builds before any result is
claim-eligible.

## Receipts and green aggregation

Each assertion prints one line beginning `STRUCTURED RECEIPT ` and appends the
raw JSON object to the JSONL file. Timing-sensitive assertions always retain all
three attempts. A per-segment summary follows its assertions.

See `receipts-format.md` for field meanings and `receipts.schema.json` for the
machine schema. Milestone green is fail-closed:

```text
green = suite.pass === true && choreography.pass === true
```

For M6, choreography pass additionally requires the external iOS-simulator
receipt. The P1 Node skeleton cannot emit M6 green by itself.
