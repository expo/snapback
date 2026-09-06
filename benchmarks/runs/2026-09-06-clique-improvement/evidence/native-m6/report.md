**Native M6 acceptance: FAILED. Authentic failure evidence retained.**

This is independent supplemental verification of the frozen Astra-medium Clique artifact using published `snapback2@0.0.6`. It does not change the builder’s web milestone result. The native app was built and exercised on M5; no browser or JavaScript export was substituted for a running iOS application.

The app signed in, but its native live queries never populated the original fixture history. Diagnostics recorded `E_NETWORK: SSE response has no body`. This blocked the required online sync and media-viewing preconditions. Separately, the app displayed blue read ticks before the server marked the messages delivered or read. Neither defect was repaired.

**Artifacts**

All linked files are beside this report under `evidence/`. The same files are retained on `ccheever@100.88.75.121` under `/Users/ccheever/clique-improvement/native/astra-006-m6/evidence/`.

- [Uninterrupted native recording — 197.02 seconds](evidence/m6-ios-screen.mp4)
- [Run manifest](evidence/m6-ios-run.json), [schema-compatible assertion receipts](evidence/m6-ios-receipts.jsonl), and [detailed observations with evidence hashes](evidence/m6-ios-observations.json)
- [Validation result](evidence/validation.json) and [external simulator status: false](evidence/simulator-status.json)
- [Full source, package, executable, framework, and environment identities](evidence/identity.json)
- [Recorded Release app](evidence/Clique006M6-observed.app.zip) and [Release app before diagnostic observation was added](evidence/Clique006M6-unobserved.app.zip)
- [Exact instrumentation diff](evidence/native-instrumentation.diff), [observer source](harness/native-observer.cjs), and [Babel transform](harness/babel-observed.config.cjs)
- [Process/backend lifecycle](evidence/lifecycle.jsonl), [native actions and accessibility observations](evidence/native-actions.jsonl), [fixture identity](evidence/fixture.json), and [cleanup receipt](evidence/cleanup.json)

Run ID: `7aba86ce-61b6-4d66-a81c-a9e0e01b9feb`. Recording interval: **2026-09-06 09:03:50–09:07:07 UTC**. The video begins on SpringBoard before the cold launch and continues through reconnect, API acknowledgements, and the final native screen. It was not edited or concatenated.

**Observed results**

| Assertion | Result | Evidence and boundary |
|---|---|---|
| Online sync precondition | **FAIL** | Real sign-in succeeded. Native inbox and fixture history remained empty despite three backend fixture messages. Existing subscriptions repeatedly reported the SSE-body error. |
| Cold process / stopped backend | **PASS** | Online app PID and backend listener were absent; TCP returned `ECONNREFUSED`; recording preceded cold launch. |
| Durable cold history | **NOT RECORDED** | Cold history was inspected and empty, but previously synced history could not be tested because online sync never completed. |
| Previously viewed ordinary image | **NOT RECORDED** | The original image never rendered online; no previously viewed-media restoration claim is possible. |
| Consumed view-once denial | **NOT RECORDED** | The native app never opened/consumed the fixture asset. Absence from an empty screen is not evidence of denial. |
| Cold search and result navigation | **NOT RECORDED** | The exact token was entered under “Offline — searching synced messages”; no result appeared. The token had never synced, so the stipulated search test and result navigation were blocked. |
| Two pending bubbles in compose order | **PASS** | Both exact bodies appeared once, first above second, with visible gray pending clock glyphs while the backend was stopped. |
| Exactly-once ordered flush | **PASS, with manual Sync now** | Backend restart alone had not flushed them at the bounded observation. The existing “Sync now” control flushed both intents once, in order, without restarting the app. This does not establish automatic reconnect behavior. |
| Normal receipt progression | **FAIL** | The first committed bubble showed blue read ticks while the server still reported `sent` for both messages. |
| Final UI/server read alignment | **PASS, narrow observation** | After Bob’s API acknowledgements, both native bubbles showed blue ticks and both server receipts were `read`. This does not repair the premature read indication. |

The structured count is **4 passed, 2 failed, 4 not recorded**. The final-state alignment receipt is supplemental. The run is explicitly **not a qualifying M6 pass**.

The most useful screenshots are [two offline pending messages](evidence/cold-two-pending.png), [premature native read ticks](evidence/reconnect-sync-now.png), [cold search without a result](evidence/cold-search-token.png), and [final read alignment](evidence/after-bob-read.png). The [server snapshot following the premature ticks](evidence/api-history-1788685596423.json) still reports `sent` for both messages. Bob then used ordinary authenticated `chats.history` and `chats.acknowledge` calls to advance delivery and read state. No Bob native screen is claimed.

The fixture conversation is **M6 Frozen 006**, ID `s2id-e189fc9ee08fef3149432845aaf0d980-0000000000004801`. Its search token is `m6nativequartz`; queued bodies are `M6 queue first 006` and `M6 queue second 006`. Their committed IDs end in `6801` and `6836`; server timestamps are `1788685592553` and `1788685592629`, respectively, 76 ms apart. Final history contains exactly one occurrence of each.

**Exact source and runtime identity**

The supplied archive SHA-256 matches exactly:

```text
014a913c309a6aecb64d76bcaed50a68db53ed1bb0fe17c9f26fdcd95e8cd55c
```

All **71 original files** remain byte-identical in the frozen extraction and M5 build copy, including `package.json` and `package-lock.json`. The [instrument integrity receipt](evidence/instrument-integrity.json) also verifies the copied UI against the permitted frozen instrument: UI version `0.3.2-m8`, receipt instrument `0.3.6-m8`.

| Identity | Recorded value |
|---|---|
| Host | `Charlies-MacBook-Pro-M5Max-Black.local`, `100.88.75.121`, Mac17,6, ARM64, 18 CPUs, 128 GiB RAM |
| Host OS / Xcode | macOS `26.6.2 (25G83)` / Xcode `26.6 (17F113)` |
| Simulator | New `Clique-006-M6`, iPhone 17 Pro, UDID `A0659883-FDEB-4ED2-B560-831A778226DA` |
| Runtime / build SDK | iOS `26.5 (23F77)` / simulator SDK `26.5 (23F81a)` |
| Bundle / version | `dev.clique.frozen006.m6`, version `0.0.6`, build `1` |
| Native configuration | Release, Hermes, React Native `0.81.5`, Expo `54.0.37`, new architecture |
| Toolchain | Node `25.9.0`; install npm `10.9.8`; CocoaPods `1.17.0` |
| ARM64 Mach-O UUID | `5F1C1775-752C-3460-B721-FD69DCAC772F` |
| App process | Online `42937`; cold `47893`, unchanged through reconnect/final observations |
| Backend | `http://127.0.0.1:49606`; original listener `92062`, restarted listener `70617` |

Key SHA-256 identities:

```text
Recorded app executable
6d8d9ec2221da23e53f77d5ef5fdc05120c8c9fdabd88da649e8fb6c10d0ac9a
Recorded Hermes bytecode bundle
10265434832053cfdddaf0beec3b7674e219220e5a1b08e3174b7bdc0401329b
Published snapback2 Darwin ARM64 binary
52d7de9c0c31c3e1cd4df59a3afb438d664f428b25bc68994952ece14ace4955
Video
1190c74783f692894f404dcbb668ed5e979d4c98b3d00ab530d035371af1fa81
Assertion JSONL
8bfe1d4614a3bffda675a085ef2036b5ecafdf22575ce3f32e00ad9c0239b62c
```

The manifest and identity inventory contain full hashes for both app archives, the Hermes framework, npm wrapper, installed Snapback files, original source, lockfile, and supporting evidence. Runtime observation independently confirmed `Hermes: true`.

**Setup changes and tooling resolutions**

Work used only the dedicated M5 directory. `frozen/` holds the archive extraction; `build-app/` is its isolated native build/backend copy; `harness/` contains all additions. The absent vendor UI, fixture assets/credentials, and receipt schema were copied from the permitted benchmark instrument. Alice/Bob setup and media uploads used the documented signup, profile, conversation, and message APIs; no direct database inserts were used.

The isolated backend command was `node node_modules/snapback2/bin/snapback2.mjs dev --foreground --port 49606`, run from M5’s dedicated `build-app/`, with state in its own `.snapback/`. Documented system configuration installed normal time windows and enabled replay notification suppression so no unrelated provider was contacted.

Host npm 11 rejected the archive lockfile over an optional Linux platform package. `npx --yes --package npm@10.9.8 npm ci` succeeded without changing the lockfile or upgrading packages. Expo prebuild generated the native project; its convenience edits to package files were restored verbatim. Babel resolved the already locked preset from Expo’s nested dependency. Release builds used **3 Xcode jobs and 2 Metro workers**, with load sampled during setup/build activity.

Unsigned simulator SecureStore access initially failed with a missing entitlement. Direct post-build signing then failed to launch. The final build uses Xcode-managed ad-hoc simulator signing with the retained [entitlements](harness/simulator.entitlements). Both failed setup attempts and successful build logs remain in `evidence/`.

The only transformations to bundled application logic are the isolated backend URL and wrapping the existing client with the retained observer. It records runtime capabilities, existing status notifications, and existing subscription callbacks to a diagnostic file. It creates no query, mutation, timer, replacement data store, fabricated response, or success receipt. The unobserved Release build already showed the same empty online screens. Diagnostic logging can affect timing; no performance benchmark claim is made.

Native interaction used a task-local `fb-idb` virtual environment and the installed companion on port `49607`. Screenshots/accessibility were captured from the explicit simulator; Apple Vision OCR binds message text and order. Bubble accessibility groups hide descendant receipt values, so glyph findings use reviewed native pixels, not an SDK-only screen assertion. A declared URL scheme provided navigation around the app’s obscured top controls; conversation content and search were still rendered by the frozen app.

M5’s existing ffprobe could not load its x265 library. Apple AVFoundation instead decoded **1,750 frames**, verified monotonic presentation timestamps, and exported representative frames. The original recording is variable-frame-rate; static-screen gaps are retained. [Video audit](evidence/video-audit.json) and its source are included.

**Failures, friction, and limits**

The SSE-body failure is directly observed. Its precise underlying cause was not patched or conclusively isolated. The published SDK’s retained [live transport source-map excerpt](evidence/published006-live.ts) constructs a response around a stream, making native response compatibility a concrete investigation point. Missing `ReadableStream` was ruled out by runtime observation.

The premature read indication is directly observed and consistent with [the frozen bubble logic](frozen/components/Chats.tsx:18): a truthy receipt-data array with no active sent/delivered entries selects `read`, including an empty partial result. The app also presents empty screens without surfacing live-query failures, and its top navigation overlaps the status bar/Dynamic Island. These are product findings, not harness repairs.

Cleanup stopped only recorded task-owned processes and shut down only `Clique-006-M6`. Its installed app, app data, backend fixture state, builds, and evidence are preserved. The two unrelated booted simulators remained booted. No current benchmark lane or remote `projects/snapback` working tree was read or changed; no commit, push, or npm publication occurred.

Artifact validation passed; native acceptance did not. The four blocked assertions remain explicit rather than inferred from web behavior, cached API results, or the successful queue component.
