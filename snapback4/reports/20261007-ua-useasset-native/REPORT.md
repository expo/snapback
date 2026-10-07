# UA — ordinary native images and visible asset waits

## Round 1 — review corrections on eb1000, 2026-10-07

Base `079d3dd175dfa4eb8581b5640e8515bec0ad3333`, branch
`sb4-intent/ua-useasset-native`. Executed only in this lane on eb1000
(`expose-builder-pixel`), Node 24.13.1, Bun 1.3.14, Rust 1.97.0.
No other lane’s worktree or processes, and no other machine, were used. Local commit only; no push.
**No new iOS run:** the simulator observations below are round-0 evidence.
The operator's round-1 Release recheck remains outstanding.

Both round-0 reviews confirmed the native constructor restriction and the stock
Expo fix. This round closes the residual conversion-error boundary, replaces
the age-of-call diagnostic with progress-aware waits, and restores loading-literal
source compatibility. Governing context: LLP 3000 §7; LLP 3000.008.002.000 §6
(working set), LLP 3000.011.005.000 §8 and the current assets guide. No authority,
retention, one-view policy, persisted format or native ABI changes.

### Corrections

- Expo's public `blob()` calls its public `arrayBuffer()` and then converts the
  completed bytes. The SDK observes that completion on the owned response and
  restores the method when `blob()` settles. A body-read reset stays `E_OFFLINE`
  and uses the existing safe retry budget. A subsequent native conversion or
  buffer-constructor refusal is `E_CLIENT`, with one ordinary request and no
  offline transition. The exact RN constructor refusal is also recognized when
  the response is non-extensible. Unknown failures without a completed-body
  observation remain transport; this does not classify every `blob()` rejection
  as a host error. There is no global/prototype patch or second body read.
- `waiting.since` now marks the latest stage change or nonempty chunk;
  `diagnosticAt` advances and a prior diagnostic clears on progress. Streaming
  bodies expose `received` and, with valid Content-Length, `total` bytes. Empty
  chunks do not count. Opaque header/body waits use the existing buffered
  allowance, because five seconds cannot distinguish a healthy opaque transfer
  from a stall. Other stages diagnose five seconds of no observable progress.
- `AssetState` accepts `{ status: "loading" }` again. The hook still supplies
  `waiting`, but the public type makes it optional. Examples use optional access.
- Documented the remaining `local-assets.ts` byte-array Blob fallback as a
  browser-store path. Custom native stores must supply `uri`; Expo already does.

### Evidence and verification

The native helper now loads **installed Expo FetchResponse and createBlob** as
well as RN's production Blob implementation. Only native I/O/store operations
are injected. Cases cover successful native conversion, an actual duplicate-RN
constructor fallback (including a non-extensible response), native conversion
failure, and an `arrayBuffer()` reset, for ordinary and once downloads. They
check request counts, safe retryability, method restoration and Blob ownership.
Two process-device local-client tests additionally prove one request, E_CLIENT,
and no offline event for both conversion-failure paths.

Real HTTP bodies deliver chunks every 500 ms for six seconds to six mounted
hooks: ordinary/once × streamed body, streamless Blob and completion-only fetch.
All paint with no E_ASSET_WAIT; streaming byte counts and extended deadlines
are observed. A held session does diagnose after five seconds with no request;
resumption clears the diagnostic and starts the next stage's deadline, which
diagnoses independently if that stage stalls. Focus never bypasses custody.

| Check | Final outcome | Evidence |
| --- | --- | --- |
| Blob lifecycle, including real Expo paths | 49 passed | [targeted final](round1/corrections-final.log) |
| Six-second HTTP body / hook / image regression | 1 passed, six transfers | [targeted final](round1/corrections-final.log) |
| React | 66 passed | [targeted final](round1/corrections-final.log) |
| Read/asset type compatibility | 11 passed | [targeted final](round1/corrections-final.log) |
| Asset retry | 38 passed | [affected run](round1/affected-tests.log.gz) |
| Asset avatars, lists, pressure | 62 passed | [affected run](round1/affected-tests.log.gz) |
| Native smoke / media dependencies | 25 passed | [affected run](round1/affected-tests.log.gz) |
| Delivery-fault matrix and await census | 339 passed | [matrix](round1/delivery-fault.log) |
| Guide | 113 passed | [guide](round1/guide.log.gz) |
| Client typecheck / build | Passed | [typecheck](round1/typecheck.log), [build](round1/build-client.log) |
| Docs budget / reference audit | Passed | [budget](round1/docs-budget.log), [references](round1/ref-check.log) |

No skips in these runs. The first affected run had 248 passes and two failures
in new test expectations: the transport formatter preserves `ECONNRESET`, not
the error's prose. Corrected those assertions, added the non-extensible-response
cases, and reran all Blob, React, buffered HTTP and type cases: **127/127**.
The initial nonzero log is retained. The final targeted run also covers omitting
`received` on an opaque body instead of implying it has received zero bytes.
No new whole-suite result is claimed. The delivery census's sole changed module
is asset-download (9 → 10 awaits); the new await observes the existing blob
read, with no mutation delivery scope, fault site or recipe change.

From `snapback4/`, prerequisites were `bun install --frozen-lockfile`, a local
CLI build and `bash scripts/build-wasm.sh`, then client typecheck/build. Cargo
CLI/guide used eight jobs, dev/test debug information disabled, and
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. Tests used this lane's
`target/ua-round1` as TMPDIR. Commands:

```sh
node --test --test-concurrency=4 packages/snapback4/test/asset-{blob-lifecycle,retry,buffered,avatars,lists,pressure}.test.mjs packages/snapback4/test/{react,read-types,native-smoke,media-dependencies}.test.mjs
node --test --test-concurrency=3 packages/snapback4/test/{asset-blob-lifecycle,asset-buffered,react,read-types}.test.mjs
node --test packages/snapback4/test/delivery-fault-matrix.test.mjs
cargo test -p snapback4-lang --test guide
bun run --cwd packages/snapback4 typecheck
bun run --cwd packages/snapback4 build
node scripts/docs-budget.mjs
```

Linux wasm rebuilt only as a test prerequisite: **2,135,164 B raw / 645,264 B
gzip**, within the unchanged **645,564 B** cap; [build log](round1/build-wasm.log).
Round 1 changes no Rust engine/device input or persisted bytes.

## Round 0 — original diagnosis and simulator evidence

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

### Repeating the fixture — operator's round-1 recheck

The small [schema](repro/schema.q), [Expo app](repro/ExpoApp.tsx),
[web app](repro/WebApp.tsx), [dependency pins](repro/expo-package.json),
[proxy/seed recorder](repro/run-server.mjs), [browser probe](repro/web-probe.mjs),
and [baseline hook instrumentation](repro/published-instrumentation.patch) are
retained. These are reproduction inputs, not another application starter.
Regenerate the SDK APIs with `snapback4 check`; run the backend from the Expo
fixture with `snapback4 dev --port 0 --no-watch`, redirecting its output to
`target/ua/backend.log`. From `snapback4/`, run `node target/ua/run-server.mjs`;
copy its generated `config.json` to the Expo app's `ua-config.json`. Preserve
these relative fixture paths when copying the retained inputs. Use a fresh
fixture/backend store so signup and upload do not collide with round 0.

On the mini, in an operator-owned checkout containing this round's commit:

1. Generate `target/ua/expo` with `snapback4 init target/ua/expo --expo`.
   Install the retained dependency pins; replace the generated schema and App
   with `repro/schema.q` and `repro/ExpoApp.tsx`. Copy `repro/run-server.mjs`
   to `target/ua/run-server.mjs`. Retain the generated app entry/config and run
   `snapback4 check` inside the Expo fixture to regenerate its API.
2. Build this checkout's SDK JS (`bun run --cwd packages/snapback4 build` after
   the normal dependencies/wasm prerequisites), and copy **the complete dist**
   into the fixture's independently installed `node_modules/snapback4/dist`.
   Record the source commit and installed Expo/RN versions. Keep the published
   `snapback4-expo` 0.4.13 native framework. An old installed Release bundle will
   not pick up new dist until rebuilt.
3. Start the fixture backend and proxy/seed recorder as above. Copy config into
   the app root before bundling. Prebuild, install Pods and build Release below.
   Use a newly created simulator owned by this run, with its exact UDID in
   `UA_SIMULATOR`; do not reuse the deleted round-0 UDID.
4. Install/launch the Release app, record the trace and screenshot, and require
   one ordinary Range GET/206, ready with a native URI, an `image-load` callback,
   no E_OFFLINE and no offline link event. Record the built app/bundle hash.
   Repeat Debug only if desired; Release is the required recheck.

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

The retained fixture now reads optional `mode` from `ua-config.json` and labels
traces `release-r1-<mode>` or `debug-r1-<mode>`. Rebuild Release after changing
config/mode, and uninstall/reinstall the app between cases to clear its media
store. The proxy writes `mode` from `UA_MODE` (default `ordinary`); it can also
deliver successful asset bodies in twelve chunks with `UA_CHUNK_MS=500`.

| Operator case | Expected round-1 result |
| --- | --- |
| `ordinary` | One GET/206, ready and image-load; online throughout. |
| `ordinary` with `UA_CHUNK_MS=500` on the proxy | Six-second healthy transfer, no E_ASSET_WAIT, ready/image-load and one GET. Native opaque conversion exposes stage/known total, not fabricated received bytes. |
| `opaque-headers` | Fixture holds fetch for 6.2 s; `waiting.headers` stays visible without E_ASSET_WAIT, then one GET and image-load. This deliberately replaces round 0's age-based diagnostic expectation. |
| `stall-retention` | Fixture holds the first native `asset_home` call for 6.2 s. At five seconds E_ASSET_WAIT names retention; resumption clears it and produces ready/image-load without another GET. Use a fresh media store. |
| `constructor` | Fixture's blob method reads through arrayBuffer then attempts RN's unsupported buffer constructor. One GET, E_CLIENT with the constructor cause, no offline event, no image callback. |
| `conversion` | Fixture throws an injected local conversion error after a successful arrayBuffer read. One GET, E_CLIENT, no offline event. |

The two failure fixture modes inject at the public body/conversion boundary;
the Node regressions above execute Expo's **actual** duplicate-module fallback
and injected native-store conversion. Do not describe a fixture injection as
a second observed stock iOS defect. Return to `ordinary` for the final Release
success record. Stop only owned server PIDs and shut down/delete only the run's
owned simulator afterward. Round-1 operator results are not yet present here.

## Change and diagnostic contract

The downloader tests Blob buffer-construction capability once per constructor,
in addition to stream availability. Browser hosts keep progress-sensitive
stream reading. On RN, use the host's **public `Response.blob()`**, whose Expo
implementation performs the supported native conversion. That path receives
the existing size-based buffered allowance even though `.body` exists. Native
refusal bodies use `Response.json()`. Remaining stream assembly errors are
E_CLIENT and never mark the device offline. Blob ownership, late cancellation,
ordinary retention and once-view no-replay rules remain in force.

Every loading hook result contains (round-1 contract):

```ts
waiting: { stage, since, diagnosticAt, received?, total?, why? }
```

`stage` is a typed union: scheduled, client, session, media, refresh, queue,
headers, body, backoff, retention or display. `since` and `diagnosticAt` are
wall-clock milliseconds for its latest progress interval. Stage transitions or
nonempty received chunks restart the deadline and clear stale diagnostics.
Streams expose received bytes and a known total; opaque transfers do not invent
byte counts. With no observable progress for **5,000 ms**, the hook adds
`waiting.why.code = E_ASSET_WAIT`, with its stage in `site` and a readable
explanation. Opaque header/body waits instead use the existing size-based
transfer allowance. `waiting` is optional in the public AssetState type for
compatibility with pre-UA loading literals, though the hook supplies it.
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
