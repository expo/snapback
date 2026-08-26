# Social-messenger instrument control and LLP 0281 W9 runbook

The commands below retain proof artifacts outside the repository. They do not
edit `benchmarks/instrument.manifest.json`; canonical digest reconciliation is
a separate orchestrator step.

W9 has separate evidence legs. The in-process HTML fixture proves instrument
mechanics only. It does not run Coterie and cannot satisfy any LLP 0266 D10
product obligation.

## Instrument fixture control journey

Provision the choreography dependencies and both pinned browser engines once
on the Linux browser host:

```sh
cd benchmarks/tools/social-messenger/choreography
npm install --no-package-lock
npx playwright install chromium firefox
```

Run the exact same fixture journey under both engines:

```sh
cd benchmarks/tools/social-messenger/choreography
volta run --node 24.18.0 node control-lane.mjs \
  --browser chromium \
  --out /tmp/social-messenger-w9/control-chromium

volta run --node 24.18.0 node control-lane.mjs \
  --browser firefox \
  --out /tmp/social-messenger-w9/control-firefox
```

Each command must exit zero and print one `CONTROL LANE PASS` line. The bound
`control-lane-receipt.json` must contain:

- `evidenceScope: "instrument-fixture-only"`;
- `journeys.m2m3.status: "green"`, with green M2 media and M3 DM, avatar,
  typing-v2, receipt, group-receipt, and group-lifecycle receipts;
- `journeys.m2m3.typingObservationBoundaryVersion: "v2"` and a
  `timingRetry` whose first attempt is `failed` and later attempt recovered;
- `journeys.m7.status: "green"`, Alice and Bob each settled on
  `m7-option-b`, and `awaitedSwitch: true`;
- forced statuses in this exact order: `green`, `failure`,
  `capability-failure`, `aborted`; their bound choreography outcome classes
  are respectively `null`, `application`, `platform`, and `instrument`; and
- a first-attempt and terminal-receipt timestamp for every journey/outcome,
  plus SHA-256 bindings to the raw choreography JSONL where applicable.

The aborted cell deliberately combines a suite-level `instrument` outcome
with an application-class assertion failure. Its final `instrument` class
therefore proves the suite-failure classifier branch; the generic fallback
would produce `application` and fail the control lane.

Preserve both output directories. A browser startup refusal is setup evidence,
not a control-lane outcome. These fixture receipts prove no W9 browser,
native-host, selector-tree, or Coterie behavior.

## Real Coterie two-context browser leg

This leg drives the actual `demos/coterie` Contract web application against
its Snapback provider. Use a fresh disposable Coterie database. In terminal 1,
from the repository root, start the backend and note the printed `serverUrl`:

```sh
scripts/bootstrap-ibex-runtime
SNAPBACK_RUNTIME_BINARY="$PWD/target/debug/snapback" \
  node packages/snapback-cli/cli.mjs dev demos/coterie/snapback \
  --ready-file demos/coterie/.data/snapback/w9.ready.json \
  --application-ready-file demos/coterie/.data/snapback/w9.application-ready.json \
  --db demos/coterie/.data/snapback/w9.sqlite3 --json
```

In terminal 2, install the M3 fixtures into that exact server, then launch the
real Coterie web app with the Snapback provider selected:

```sh
export COTERIE_SNAPBACK_URL=http://127.0.0.1:<printed-port>
node demos/coterie/snapback/seed-m3.mjs \
  --url "$COTERIE_SNAPBACK_URL" \
  --destructive-reset-confirmed

cd demos/coterie
COTERIE_PROVIDER=snapback \
COTERIE_SNAPBACK_URL="$COTERIE_SNAPBACK_URL" \
COTERIE_SNAPBACK_CUSTODY=memory \
bun run dev
```

In terminal 3, run the real-product journey. The default dev URL is shown
below; replace it if Vite selected another port:

```sh
cd benchmarks/tools/social-messenger/choreography
volta run --node 24.18.0 node w9-coterie-browser.mjs \
  --browser chromium \
  --base-url http://127.0.0.1:8083 \
  --out /tmp/social-messenger-w9/coterie-browser-chromium.json

volta run --node 24.18.0 node w9-coterie-browser.mjs \
  --browser firefox \
  --base-url http://127.0.0.1:8083 \
  --out /tmp/social-messenger-w9/coterie-browser-firefox.json
```

Each command must exit zero and print `W9 COTERIE BROWSER PASS`. A passing
receipt hash-binds the frozen selector authority and actual Coterie entry/feed
sources, records exactly two observed open contexts, and records a real delta:
Alice creates a uniquely marked post and Bob sees it live with marker count
`0 → >=1` and zero main-frame navigation/reload. The runner derives those
facts from the running product; it does not prefill a W9 proof boolean.

Preserve both receipts plus the Snapback and Vite launcher logs. A receipt from
the memory provider is invalid for this leg: separate browser contexts have
separate memory providers and the Bob observation must time out.

## Coterie shared-source/native preflight

Run the locally provable D10 checks before launching either native host:

```sh
node benchmarks/tools/social-messenger/choreography/w9-host-preflight.mjs \
  --out /tmp/social-messenger-w9/coterie-host-preflight.json
```

Expected output is `W9 HOST PREFLIGHT PASS`. The receipt hash-binds the frozen
`CONTRACT.md`, Coterie's native entry/route selector, and the static vocabulary
guard. It records passing provider freshness, `sm-*` vocabulary, native-entry
typecheck, platform splits, tests, and production web build. It deliberately
does not claim the real-product browser journey, either native-host run, or
the unchanged Clique/Coterie tree comparison.

## iOS simulator host

On a macOS host with the compatible Exact iOS simulator app available, use two
terminals. In terminal 1, from `demos/coterie`, launch the native bundle:

```sh
../../../exact/target/debug/exact run ios
```

If `exact` is already on `PATH`, `exact run ios` is equivalent. Keep the
process attached. Note the dev-server URL and agent token it prints. In
terminal 2, from the repository root, pass those exact values:

```sh
EXACT_DEV_URL=http://127.0.0.1:5173 \
EXACT_AGENT_TOKEN='<token printed by exact run ios>' \
node benchmarks/tools/social-messenger/choreography/w9-native-host.mjs \
  --platform ios \
  --out /tmp/social-messenger-w9/coterie-ios-native.json
```

Replace port `5173` if the launcher prints another URL. Expected output is
`W9 NATIVE HOST PASS`. The JSON receipt must identify one live, rendered iOS
target and its registration generation, retain the host load status and tree
digest, observe both frozen feed-tab IDs, and record successful semantic taps
Global → Following. Each tap must carry distinct before/after tree hashes;
merely retaining an already-present `sm-feed-item` is not a passing action.
Keep the Exact launcher console with the JSON receipt; together they are the
iOS bundle plus semantic-interaction artifact required by LLP 0266 D10.

## macOS Exact host

Repeat the same two-terminal procedure with a compatible macOS host:

```sh
cd demos/coterie
../../../exact/target/debug/exact run macos
```

```sh
EXACT_DEV_URL=http://127.0.0.1:5173 \
EXACT_AGENT_TOKEN='<token printed by exact run macos>' \
node benchmarks/tools/social-messenger/choreography/w9-native-host.mjs \
  --platform mac \
  --out /tmp/social-messenger-w9/coterie-macos-native.json
```

The expected receipt is the macOS analogue of the iOS receipt: one rendered
Exact target, a host status/tree digest, and the same Global → Following
interaction with a non-empty semantic tree delta after each tap. A host that
displays an embedded/default app instead of Coterie will fail on the frozen
`sm-feed-*` IDs and must not be counted.

## Unchanged Clique/Coterie `sm-*` tree — not yet implemented

No checker currently captures Clique's canonical `sm-*` tree, normalizes the
corresponding Coterie tree, and compares the two. There is therefore no command
or receipt that proves LLP 0266 D10's unchanged-tree obligation. Static
vocabulary checks prove allowed ID spelling and placement, not tree equality.
Do not substitute the host preflight or either browser fixture receipt.

## W9 closure state

Until retained receipts actually exist, the remaining unproven W9 obligations
are exactly:

1. two simultaneous browser contexts in the real Coterie product proving a
   multi-client live mutation and observation;
2. an iOS native bundle plus semantic interaction artifact with a post-action
   delta for each tap;
3. a compatible macOS Exact-host run with the same semantic interaction and
   post-action deltas; and
4. an unchanged normalized `sm-*` tree relative to Clique.

The first three now have explicit commands and expected receipts. The fourth
has no implementation, so W9 and LLP 0266 D10 remain unproven even if the
fixture, browser-product, preflight, and native commands all pass. Nothing in
this runbook authorizes a D10 claim before a real comparison receipt closes
that final obligation.
