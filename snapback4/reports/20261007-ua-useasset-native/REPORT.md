# UA — ordinary native images and visible asset waits

2026-10-07 · Apartment mini · branch `sb4-intent/ua-useasset-native` · base
`8e530ff2419387cb97ff841b4a2aa8b7828c7229` · local commit only, no push/publication.

## Outcome and cause

The generated Expo app reproduces the missing image on published 0.4.13 in
**both Release and Debug**. The web starter succeeds. With this change, all
three reach `useAsset.status = ready` and emit the image-load callback.

The native reproduction **does issue requests**. The hook's effect and deferred
dispatch run; the session is signed in, the link online and the message acquired.
The correct encoded `/assets/<id>` URI is requested with the bearer header and
`Range: bytes=0-`. The backend replies HTTP 206. Expo's response exposes a
ReadableStream, so the old downloader collects its Uint8Array chunks and calls
`new Blob(chunks)`. React Native's Blob constructor rejects them:

> Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported

That local exception became `E_OFFLINE`, exhausted the four safe range attempts,
and made the local client offline. Reconnect caused further attempts. A UI that
renders only `ready` hides the error and never mounts an Image, so no image-load
or image-error callback can occur. This is a host capability error after a
successful response, not a Release-only scheduler, URI or acquisition failure.

The frozen pilot was inspected **read-only**, limited to its supplied m6/m8 and
revision10 diagnosis paths. It records missing media callbacks and a missing
selector, but no hook-state or HTTP interception trace. Its exact failure is
therefore **not retroactively proven**. An absence of asset lines in its backend
log is not proof that no GET ran. The instrumented independent reproduction and
the production-Blob red/green control establish the defect repaired here.

## Reproduction and evidence

Host: macOS 27.0.1 / arm64, Xcode 27.0 (27A266a), iOS 27.0 simulator (24A434),
Node 24.18.0, Rust 1.97.0. All Xcode commands used
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. No remote machine,
`xcode-select` change or other session's simulator/process was used.

Created `sb4-ua-20261007-0130` with `xcrun simctl create`; UDID
`74ED8A85-6617-4D4D-884A-F33E3431A2B2`. Every simulator command targeted that
UDID. It was shut down and deleted after testing; see [cleanup](evidence/cleanup.txt).

Generated Expo and web starters into ignored `target/ua/expo` and
`target/ua/browser`. Minimized their schema to password auth, one owner-scoped
messages table, `send(photo)` and `history()`. Seeded the existing ordinary PNG
`packages/snapback4/test/fixtures/cal26-avatar.png` (729 bytes, 256×256) using
signup, upload and mutation. The image is ordinary, not a once grant. Each app
uses `createApp`, its platform device, `AppProvider`, `useQuery` and `useAsset`,
with `assets: { keep: 'viewed', maxBytes: 1000000 }`.

The native app independently installed **snapback4 0.4.13, snapback4-expo
0.4.13, Expo 57.0.22, RN 0.86.3 and React 19.2.3**. It uses the published
native framework. The fixed runs replace only the installed SDK's JS dist
with this checkout's compiled JS; the Release app was then rebuilt with its
embedded production Hermes bundle. No native ABI repair or Metro connection is
needed by Release. Debug loads the development bundle from Metro.

| Configuration | Published 0.4.13 | Fixed JS | Evidence |
| --- | --- | --- | --- |
| iOS Release, embedded bundle | Four 206 replies, Blob exception, E_OFFLINE; no image callback | One asset GET, 206, native file handle, image-load | [before](evidence/release.jsonl), [after](evidence/release-fixed.jsonl), [screenshot](evidence/release-fixed.png) |
| iOS Debug, Metro | Same constructor failure and error | One asset GET, 206, native file handle, image-load | [before](evidence/debug.jsonl), [after](evidence/debug-fixed.jsonl), [screenshot](evidence/debug-fixed.png) |
| Generated web starter, Chromium | Ready blob URL, image-load | Ready blob URL, image-load | [before](evidence/web.jsonl), [after](evidence/web-fixed.jsonl), [screenshot](evidence/web-fixed.png) |
| iOS Debug, fixed JS, injected 6.2-second fetch hold | — | `waiting.headers`, E_ASSET_WAIT at five seconds, then exactly one GET and image-load | [wait trace](evidence/debug-wait.jsonl) |

[Full trace](evidence/trace-full.jsonl.gz) and [event counts](evidence/trace-summary.json)
are retained. The individual JSONL files retain the first terminal attempt/first successful load, plus matching
proxy asset requests/responses. Baseline native sessions continued reconnecting
after these excerpts. Timestamps are receiver wall time, not performance claims.
Only header names, bearer presence and Range are recorded; no bearer values are
logged. Fixture account IDs, paths and the disposable loopback endpoint are
included to connect the observations. The Debug screenshot includes Expo's
first-run developer-menu overlay; the app's ready state and image are visible
behind it, and the image-load event supplies the independent render observation.

### Repeating the fixture

The small [schema](repro/schema.q), [Expo app](repro/ExpoApp.tsx),
[web app](repro/WebApp.tsx), [dependency pins](repro/expo-package.json),
[proxy/seed recorder](repro/run-server.mjs), [browser probe](repro/web-probe.mjs),
and [baseline hook instrumentation](repro/published-instrumentation.patch) are
retained. These are reproduction inputs, not another application starter.
Regenerate the SDK APIs with `snapback4 check`; run the backend from the Expo
fixture with `snapback4 dev --port 0 --no-watch`, redirecting its output to
`target/ua/backend.log`. From `snapback4/`, run `node target/ua/run-server.mjs`;
copy its generated `config.json` to the Expo app's `ua-config.json`. Preserve
these relative fixture paths when copying the retained inputs.

Prebuild with `expo prebuild -p ios --no-install`, install Pods, and build:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -workspace target/ua/expo/ios/SB4UA.xcworkspace -scheme SB4UA \
  -configuration Release -sdk iphonesimulator -destination id="$UA_SIMULATOR" \
  -derivedDataPath target/ua/DerivedData -jobs 3 \
  ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO
```

Install and launch only on a newly created simulator owned by that run. Repeat
with `-configuration Debug`. The retained [AppDelegate](repro/AppDelegate.swift)
automatically loads the Debug Metro endpoint, avoiding the dev launcher's
interactive prompt. Metro on this host listened on IPv6 loopback; the fixture's
[IPv4 forwarder](repro/metro-ipv4.mjs) bridges its `127.0.0.1:45190` listener to
`::1:45190`. The generated nested web app needed explicit React aliases/deduping
in its [Vite config](repro/vite.config.ts). Fixed web verification forced dependency
reoptimization after replacing the installed dist. These fixture setup repairs
are not product changes. Initial Release bundling also required placing the
config JSON inside Metro's app root. Successful build log sizes/hashes are in
[builds.json](evidence/builds.json); full temporary build logs remain under
`target/ua/` in this worktree.

For the held-fetch observation, change the Expo run label to `debug-wait` and
insert `await new Promise(resolve => setTimeout(resolve, 6200))` before calling
the original fetch for `/assets/` URLs. The app prints E_ASSET_WAIT while the
proxy has seen no asset GET. Restoring fetch completes the same request and
loads the image. Remove that fixture-only delay afterward.

## Change and diagnostic contract

The downloader tests Blob buffer-construction capability once per constructor,
in addition to stream availability. Browser hosts keep progress-sensitive
stream reading. On RN, use the host's **public `Response.blob()`**, whose Expo
implementation performs the supported native conversion. That path receives
the existing size-based buffered allowance even though `.body` exists. Native
refusal bodies use `Response.json()`. Remaining stream assembly errors are
E_CLIENT and never mark the device offline. Blob ownership, late cancellation,
ordinary retention and once-view no-replay rules remain in force.

Every loading hook result now contains:

```ts
waiting: { stage, since, diagnosticAt, why? }
```

`stage` is a typed union: scheduled, client, session, media, refresh, queue,
headers, body, backoff, retention or display. `since` and `diagnosticAt` are
wall-clock milliseconds for the current call. An outstanding call adds
`waiting.why.code = E_ASSET_WAIT` after **5,000 ms**, with its stage in `site`
and a readable explanation. Stage transitions do not restart that allowance.
The timer requires runnable JS; it cannot execute while the host suspends JS.

This is a bounded **diagnostic**, not a terminal failure or authorization to
repeat a possibly consumed view. Healthy slow/opaque transfers continue within
their existing budgets. A hung session store or media operation can remain
pending, but is explicitly named and diagnosed. Cleanup cancels the timer and
fences late handles. Synchronous custom asset methods become typed E_CLIENT
errors. Internal progress follows the actual method through the guarded app
facade, local client and online client; arbitrary custom wrappers honestly
report `client`. `Client.asset(id)` and its outcomes are unchanged.

Instrumentation checks the acquisition and session boundary rather than adding
a new prerequisite: there is no acquired-partition gate before an online asset
GET. The guarded app checks session custody; the local client reconciles media
authority, waits for active credential refresh, then downloads online or reads
retained media offline. URI construction strips request content type and carries
the current authorization header. None of these steps differ by build mode.

The assets card and client operations card now show waiting diagnostics, with a
rendering example. `guide E_ASSET_WAIT` explains the code. The native witness
receipt explicitly marks `assets.state = not-exercised`, and the witness card
requires both hook outcomes and native media callbacks to qualify rendering.
No static doctor inspection can establish a live hook's progress, so no doctor
success claim was added.

## Verification

- Production-Blob regression executes the installed RN Blob/BlobManager code
  with `__DEV__ = false`; only the native byte store is mocked. It tests ordinary
  and once assets, URI/auth headers, one successful body conversion, no replay
  and one release. A control using published 0.4.13's downloader fails both
  cases with the actual constructor refusal; see [red control](evidence/blob-regression-before.log.gz).
- Blob lifecycle tests: **39 passed**. Includes the native stream-visible but
  opaque-conversion size allowance and cleanup of a late Blob after cancellation.
- React tests: **66 passed**. The new held-session test observes zero requests,
  a five-second E_ASSET_WAIT, no focus bypass, one resumed request, a ready
  result and one cleanup. A synchronous custom-reader exception is also covered.
  Existing StrictMode, ownership, cooldown and recovery checks remain green.
- Affected asset/native/media tests: **160 passed, no skips**, before the final
  additional native buffered-body regression and smoke-receipt assertion;
  those final cases are also included in the full suite.
- Package typecheck/build, docs budget and reference audit passed. The final guide
  run passes **113 tests** after adding E_ASSET_WAIT definition/recovery pins and
  keeping the witness card within its existing 399-line budget. The reference
  audit scanned 530 LLPs and 10,455 refs with zero errors/unchecked refs.
- Full Mac suite completed in **2,673 seconds** with `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` and pinned Node 24.18.0:
  **5,159 Rust passes / 2 failures / 33 ignores**; **328/328 client files executed,
  6,527 tests passed / 1 failure / 10 skips**; **9 fixture tests passed**;
  **79/79 model tests passed**. All build, wasm, budget, release-guard and typecheck
  stages passed. The three failures were the two guide checks and stale await
  inventory described above; all are repaired, with final guide **113/113** and
  census **1/1** passing. Product/runtime inputs of the passing checks were
  unchanged by those documentation/inventory repairs.

From `snapback4/`, the full command was:

```sh
PATH=/Users/ccheever/.local/node24/bin:$PATH \
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh
```

The complete command's exit is **1** (two failed stages), preserved in the
[full log](evidence/full-suite.log.gz) and [qualification record](evidence/qualification.json).
No fresh all-green whole-script result is claimed. The final targeted reruns
close every failure; no assertion, timeout, work count or budget was weakened.

The delivery await census detected the changed asset-call expressions and the
new zero-await progress module. Reviewed all four changed awaits: they forward
an observer to existing asset I/O and cannot admit, dispatch or settle a mutation.
Updated the census with that classification; no delivery scope, fault site or
recipe changed. All 338 behavioral matrix cases passed in the full run, and the
[repaired census check](evidence/delivery-boundary-final.log) passes separately.

The affected logs are retained in [evidence](evidence/). New automated
regressions are in existing suite-discovered asset and React test files. The
real generated simulator builds above additionally exercise Expo fetch, native
storage, the published framework, Hermes and Image; the production-Blob unit
test alone does not claim to emulate that entire stack.

## Wasm and persisted bytes

The full script measures macOS wasm at **2,135,439 bytes raw / 645,163 gzip**,
SHA-256 `e04bf21b4f8f444891d512be57d90e6f67be63ccaa0e0fbc8a5dd6541aec2f2a`.
The cap remains **645,564 bytes**, giving macOS 401 bytes of headroom.
The same merged RX base's recorded Linux result is **2,135,164 raw / 645,264
gzip**, 300 bytes below that cap. See the [RX round-1 report](../20261006-rx-rule-hops/REPORT.md#round-1--legacy-identity-and-merged-qualification-2026-10-07).
**Both measurements fit the unchanged cap.** Linux is inherited evidence, not
a run by UA; the user restricted this lane to the mini. UA changes no core/device
Rust or wasm inputs, and does not raise the budget.

**Persisted device/database byte-format change: none.** No schema identity, encoding, storage
layout, native ABI or migration changes. Successful ordinary native reads can
now write the already-defined retained-media bytes that previously failed to
reach storage. No new persisted device field or user database rewrite is introduced.
Witness receipt JSON artifacts gain the explicit `assets.state: "not-exercised"`
marker and its reason; that is a diagnostic-output addition, not engine storage.
