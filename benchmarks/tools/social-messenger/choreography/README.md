# Social-messenger choreography harness

This directory contains the P2-hardened Playwright harness for Clique's
milestone choreography, extended for M8 and fresh-session M7. It launches
isolated Alice and Bob browser contexts, adds Carol and Dave for group
lifecycle, and a second same-account Alice context for M8. It signs them in
through the contract's `sm-auth-*` IDs, runs selected segments, and writes
structured JSONL receipts.

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
  --suite-status /absolute/path/suite-status.json \
  --setup-identity /absolute/path/setup-identity.json
```

`npm test` starts a tiny calibration app, executes M1, fresh-session M7, and M8 through the real
multi-context harness, validates every emitted receipt against
`receipts.schema.json`, and requires honest segment greens. The app implements
an idempotent, changeable poll-vote backend as well as the M8 likes,
multi-device unread, live-message, and warm-offline queue surfaces instead of
short-circuiting browser observations. The M7 run retains application state
across all three attempts and the offline vote. A source guard keeps required
DM delivery separate from the conditional avatar branch. A second M8 run deliberately
serves stale Insights and must exit non-green. The test also exercises the pure
aggregation edge cases: optional skip, required skip, and implemented failure.

The positional segment argument is optional and defaults to `all`. It accepts
`all`, one milestone (`m1` ... `m8`), or a comma-separated ordered subset such
as `m1,m3,m8`. `all` runs the LLP 0201 continuous M1–M6/M8 session. M7 runs
only as the sole selected segment; mixing it with a continuous segment is a
startup refusal.

Scoring DAG: M3 requires M1 only; M3 does not require M2. Reduced-run
protocol: execute M1, then M2, then M3 in that order. Do not start M3 to
avoid an unfinished M2. A reduced run that skips M2 is non-conforming even
though M3's scoring prerequisite is only M1.

Every implemented CLI flag is:

- `--browser <chromium|firefox|webkit>` — browser engine; default `chromium`.
- `--headed` — show both browser windows; default is headless.
- `--receipts <path>` — JSONL destination; default is `receipts.jsonl` beside
  `choreography.mjs`. The file is truncated at the beginning of each run.
- `--observations <path>` — typed D0.6 assertion-attempt/wait stream; defaults
  to `<receipts>.observations.jsonl`. The metering manifest hash-binds this
  stream before it projects the choreography-owned browser-wait counts. Each
  attempt records only actual locator, predicate, or page-event settlement
  intervals; setup/action and other attempt wall are excluded.
- `--lane-run-id <id>` — required stable lane identity, shared with the
  metering manifest (`CHOREO_LANE_RUN_ID` is the environment form).
- `--suite-status <path>` — required JSON object keyed by milestone. Every
  selected segment must have `{ "pass": boolean, "receipt": string|null }`.
  The runner validates this complete linkage before credentials, Playwright,
  receipt creation, or browser startup. A passing value must carry a non-empty
  suite evidence pointer in `receipt`. Receipt paths are relative to the
  suite-status file, must remain under its directory, and are statted and
  SHA-256 digested before startup. The digest is retained in the segment
  summary so the meter can detect a change when it writes the record.
- `--setup-identity <path>` — required `social-messenger.setup-identity.v1`
  file. It binds the exact instrument pin, backend version, distinct qualified
  binary and wrapper claims/nonclaims, package/prepack closure, declared
  Node/Bun/npm/Playwright/browser toolchain, and host identity. Claimed
  executable artifacts are hash-verified before credentials, Playwright,
  receipt creation, or browser startup. Packed closure requires verified
  prepack and a digest for every packed artifact.
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
- `CHOREO_LANE_RUN_ID` — required stable lane identity unless
  `--lane-run-id` is supplied.
- `CHOREO_PASSWORD` — shared fixture password fallback for Alice, Bob, Carol, and Dave;
  Alice's M8 second context uses the same Alice credential.
- `CHOREO_ALICE_PASSWORD`, `CHOREO_BOB_PASSWORD` — per-persona passwords;
  `CHOREO_CAROL_PASSWORD` is required for M3/M5 and `CHOREO_DAVE_PASSWORD` for
  M3 unless the shared fallback is set. Passwords have no CLI flags so
  they do not appear in the process command line.
- `CHOREO_ALICE_EMAIL`, `CHOREO_BOB_EMAIL`, `CHOREO_CAROL_EMAIL`, and
  `CHOREO_DAVE_EMAIL` — optional;
  defaults are the corresponding `@example.com` personas from `CONTRACT.md`.
- `CHOREO_BROWSER` — default for `--browser`.
- `CHOREO_RECEIPTS` — default for `--receipts`.
- `CHOREO_OBSERVATIONS` — default for the typed assertion-wait sidecar.
- `CHOREO_SUITE_STATUS` — default for `--suite-status`.
- `CHOREO_SETUP_IDENTITY` — default for `--setup-identity`.
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

- M1: display-name/bio edits appear on the other client through the structural
  profile heading; contracted feed navigation is present; session survives
  reload; logout remains signed out across reload.
- M2: live text/image/video post delivery (including structural composition
  attachment/media observations), follow/unfollow Following projection, author
  identity on `sm-feed-item`, live like/unlike count, repost attribution
  and removal, follow-edge vs viewer-repost disambiguation on Following, and
  reply count/thread projection. Live checks run all three trials.
- M3: required bidirectional live DM text, exact sender-avatar identity only
  when the app renders the kit's optional node, typing action/render/expiry
  clocks stamped as boundary v2 and split at the last keystroke, exact sent/delivered/read receipt
  tokens, group aggregate receipts, add/promote/remove/leave plus removed-member
  history/live-cutoff after a later DM delivery-progress marker, and quoted excerpt/jump behavior. Live checks run
  best-of-three where timing-sensitive.
- M4: photo render, video playback, reaction set/replace/remove, edit visibility,
  and delete-for-everyone tombstones across the isolated Alice/Bob contexts.
- M5: group color/background synchronization to Carol, view-once first/second
  view behavior, warm-offline search, and shortened-window disappearing purge.
- M6 web: two offline messages expose pending state, reconnect, arrive exactly
  in order, and reach read receipts.
- M7 fresh session: another client observes an exact poll tally increment for
  three distinct retained actor/option pairs. Alice's option-A to option-B
  switch must also become observable as her selected option before the offline
  assertion begins; the fourth distinct offline vote then exposes a pending
  marker and reconciles exactly once.
- M8 web: Bob's like increments Alice's refreshed Insights total; a second
  Alice context receives a same-account message live; opening the conversation
  on Alice client 1 clears `sm-chats-unread` on client 2; and two warm-offline
  Alice clients each queue a message, reconnect in an observed server-arrival
  order, converge without duplicates, and reach normal read receipts.

The coordinated kit migration removes the recurring M2/M3 structural skip
catalog. Missing media, identity, receipt, poll, or membership semantics now
fail their owning application assertion, except that a sender-avatar node the
kit does not render in the default DM layout is an explicit optional skip. The
harness never falls back to glyph/color inference.

The hardening extends the coordination contract for semantic controls and adds
a frozen route/fixture adapter for the four places where navigation cannot be
inferred from a component test ID. The adapter is input-only; the browser still
performs and observes every check.

## Receipts and green aggregation

Raw receipts are appended only to the JSONL file. A failed assertion emits one
bounded `STRUCTURED CHOREOGRAPHY MISS` containing the classification, assertion
identity, compact attempt errors, and retained sidecar paths; agents must not
ingest the raw failed-receipt JSONL. Timing-sensitive assertions retain all
three attempts on disk. A compact `CHOREOGRAPHY OUTCOME` line classifies each
segment summary and startup refusal.

See `receipts-format.md` for field meanings and `receipts.schema.json` for the
machine schema. Milestone green is fail-closed:

```text
green = suite.pass === true && choreography.pass === true
```

Segment summaries also emit `nonGreenCause` (`null` when green; otherwise
`suite-failed` | `choreography-failed` | `required-unimplemented` |
`instrument`). The field remains optional on the schema since `0.3.1-m8` (default
`null`); the emitter always writes it. Prior `0.3.0-m8` receipts remain
governed by their matching schema revision. Lanes MUST copy that field into
the run record. Do not invent a second green label such as "functionally
green".

`outcomeClass` is the first-line red taxonomy: `application`, `platform`,
`setup`, or `instrument`. Suite red status must carry this class; assertion
errors default to application unless explicitly tagged. The segment summary
also embeds the validated structured setup and its source digest.

M6 and M8 web green are intentionally distinct from their simulator artifacts.
`simulator.md` remains the native proof contract; each matching status is
recorded under `choreography.supplementalExternal` and scored as native/O4
evidence rather than silently making web milestones unreachable.

## 0.3.3-m8 migration

`0.3.3-m8` is the coordinated observability bump. Runners MUST pass both
`--suite-status` (or `CHOREO_SUITE_STATUS`) and `--setup-identity` (or
`CHOREO_SETUP_IDENTITY`). The status file MUST contain
an entry for every selected segment. Missing or partial linkage exits `2`
before any browser or receipt starts; it is no longer represented as a late
`green:false` instrument result. Run records retain the input and suite
receipts in the additive `socialMessenger.suiteStatusLinkage` block.

The coordinated kit release is UI `0.3.2-m8`; choreography remains
`0.3.3-m8` for those retained records. It added exact actor/chat identity, media composition, receipt,
membership, profile-layout, and poll semantics; direct routes replace broad DM
and group text regexes. Failed best-of-three attempts reset all participating
pages and online state before retrying only that assertion. M7 stays a separate
fresh session, preserving LLP 0201's continuous M1–M6/M8 treatment unchanged.

The same instrument pin adds additive, hash-linked D0.6 milestone fields for
semantic actions, failure-to-recovery episodes, restart/reseed counts, browser
assertion waits, host load, and API interruptions. The run-record extension
stays at version `2` for old-record compatibility; those records carry
`instrumentVersion: "social-messenger@0.3.3-m8"` and carry each block as
either claimed or explicitly non-claimed. Browser waits have independent
`suite` and `choreography` owners: this executable claims only choreography,
while the production lane controller records actual suite settlement waits.
The W2 five-counter
native-usage channel is unchanged, while its meter now verifies and joins the
typed observation sidecars.

## 0.3.4-m8 migration

`0.3.4-m8` is the material typing-observation correction. Current assertion
receipts and assertion metadata stamp `typingObservationBoundaryVersion:v2`;
M3 summaries and run records repeat it. The schema accepts retained
`0.3.3-m8` lines under implicit boundary v1 but rejects a v2 stamp on that
version, and the meter/record validator rejects any old-version line in a
current receipt stream. Publications must compare or aggregate only within
one boundary version.

The same bump restores `dm-live-messages` as its own required assertion and
makes avatar identity conditional on the app actually mounting
`sm-convo-sender-avatar`. Removed-member cutoff waits for a subsequent direct
message to reach Dave before checking the still-open group view; there is no
fixed short sleep. M7 assigns Alice/option-A, Alice/option-B, and Bob/option-A
to its three retained live attempts, waits within `ctx.timeoutMs` until Alice's
option-B selection is observable before the offline assertion, then assigns
Bob/option-B to the offline path. Page-only retry resets therefore cannot let
the segment close green while the retained vote switch is still unsettled.

`0.3.2-m8` uses the unambiguous `sm-convo-quote-preview` selector as the sole
quoted-excerpt jump path after the Clique kit's matching `0.3.1-m8` migration.
`0.3.1-m8` preferred the preview selector with a reply-bubble-scoped legacy
`sm-convo-quote` fallback for `0.3.0`-era clients.

## 0.3.5-m8 migration

`0.3.5-m8` closes LLP 0317 N7 before a lane starts. The starter group now
contains Erin rather than Dave, leaving the choreography's declared
`addedMemberHandle: "dave"` genuinely addable. The choreography self-test reads
the frozen M3 starter segment and refuses if a future fixture revision puts the
declared add-member target back into the starter group. This changes fixture
state and instrument identity; retained 0.3.4 receipts remain historical and
must not be compared as if they used the repaired precondition.
`0.3.0-m8` added the M8 choreography surfaces.
