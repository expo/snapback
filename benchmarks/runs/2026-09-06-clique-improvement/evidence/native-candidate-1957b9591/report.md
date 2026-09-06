**PASS — narrow candidate Release Hermes iOS native live subscription witness.**

Candidate commit: `1957b95910044ffbb0292ad8a814da303a34dbdc`. Successful run: `candidate-live-b60e28337c124f32-r2`, **2026-09-06 09:58:56–09:59:06 UTC**. This is a source-bound candidate observation, not a published-package qualification, frozen 0.0.6 rerun, or M6 acceptance. The original native M6 result remains **FAILED** and its report/evidence are unchanged.

A running Release Hermes iOS application authenticated fixture Alice, proved her conversation membership, received all five existing fixture rows through ordinary `client.subscribe(api.chats.history, {conversation, c:null}, callback)`, then received a sixth row after one ordinary authenticated backend `chats.send`. The first five include the original three messages and both queued messages retained from the old run. Before/after native screenshots were visually reviewed.

- [Before send: five native rows](evidence/native-before-send.png)
- [After send: exact marker plus the same five rows](evidence/native-after-send.png)
- [Full native callback/status/transport log](evidence/native-observer.jsonl), [native run result](evidence/native-witness-result.json), [evidence validation](evidence/validation.json)
- [Authenticated backend precondition](evidence/api-precondition.json), [ordinary send and post-send history](evidence/api-send.json)

**Actual sequence**

| UTC timestamp | Observation |
|---|---|
| 09:58:58.035 | App PID **6410**, bundle `dev.clique.candidate.livesync.r2`, launched on designated simulator. |
| 2026-09-06T09:58:59.686Z | Native callback **16**: `state: capped`, `live: true`, server seq **21**, **5 rows**. |
| 2026-09-06T09:59:02.392Z–2026-09-06T09:59:02.400Z | Separate API helper authenticated as Alice and issued one `chats.send`; returned `committed`, seq **22**. |
| 2026-09-06T09:59:02.439Z | Native callback **17**: `state: capped`, `live: true`, seq **22**, **6 rows**, including the exact returned message ID. |
| 09:59:06 | PID **6410** was still the running app process. |

These are the complete two history callbacks in the successful observation, not selected successes from a longer callback sequence. The complete native log has 17 consecutive observer entries, one physical `/api/live` request, one authenticated history add through `/api/live/control`, and no native refusal or reconnect. `capped` is the actual SDK state; it was not rewritten to `complete`.

Conversation: `s2id-e189fc9ee08fef3149432845aaf0d980-0000000000004801`. Alice: `user:hDIg97OkRARe1bGeTyek4Q`. The native `chats.details` result proved her actual `admin` membership before subscribing. The native component made no one-shot history query before subscription. It used fresh app data and fresh SecureStore custody under the second candidate bundle identity.

Marker: `Native candidate live marker candidate-live-b60e28337c124f32-r2`. Committed ID: `s2id-e189fc9ee08fef3149432845aaf0d980-000000000001f001`. The marker was absent before sending, appears once in the server history, and appears in the later native callback. The send used the original published 0.0.6 client API helper against the copied original backend; it was not a native optimistic write.

**Runtime and hypothesis evidence**

The native runtime recorded `Hermes: true`, `__DEV__: false`, Hermes build `Release`, bytecode version **96**, and debugger disabled. The app contains a real Mach-O executable and Hermes bytecode, verified with `file`, `dwarfdump`, and `codesign`; [identity](evidence/native-app-identity.json), [file types](evidence/native-file-types.stdout), [UUIDs](evidence/native-uuid.stdout).

In that same native runtime, constructing the global React Native `Response` around an independent closed stream produced **no `.body`**. The real Expo `/api/live` response was `FetchResponse`, HTTP **200**, `text/event-stream`, with an actual `.body.getReader` function. The actual SharedSse control added `chats.history` with `receipt=1`; both live callbacks followed through the real owner and client. Together with the source-bound change from synthetic `new Response(body)` to the logical stream input, this supports the stated native compatibility hypothesis for this narrow case.

`createExpoClient` supplied its native SQLite carrier. The fetch option was a declared observing wrapper that invokes the installed `expo/fetch` unchanged, returns its same response, and neither reads stream chunks nor supplies data. It inspects the physical SSE body's getter; successful-run JSON controls are observed only for status and content type. No fetch/live response, SDK delivery, owner receipt, or row was mocked or fabricated. The standalone root displays callback rows directly. It does not render media or receipt ticks.

The actual app container's SQLite database was backed up read-only. Its [audit](evidence/native-sqlite-audit.json) passes SQLite integrity checking and contains six held message rows, including the marker, under Alice's partition. The native outbox is empty. This demonstrates use of native SQLite during the live witness, not cold-start or offline acceptance.

**Exact provenance and preserved identities**

The local ready file was observed before candidate runtime copying. The named worktree was clean at `1957b95910044ffbb0292ad8a814da303a34dbdc` before `node build.mjs`, remained clean afterward, and every recorded source hash was unchanged. The build ran **09:49:05.751–09:49:12.250 UTC**, exit 0. All **140 dist leaves** were copied into the isolated app. Transfer/install hashes match the build; only **12** package leaves differ from installed 0.0.6, all under `dist/`. All other installed packages are byte/symlink identical. Source-map contents for the client, Expo, React core, and native entries match the recorded source hashes.

- [Ready file](provenance/candidate-ready.json), [source/build/dist hashes](provenance/candidate-build.json), [exact commit patch](provenance/candidate-commit.patch), [source archive](provenance/candidate-source.tar)
- [Before/after installed package hashes](provenance/candidate-install.json), [full integrity result](evidence/integrity-result.json), [harness/native project diff](provenance/native-harness.diff), [instrumentation hashes](provenance/instrumentation.json)

The candidate source package metadata says **0.0.7**. The isolated installed package metadata and app lock still say **0.0.6**, preserved verbatim; only dist was overlaid. Neither label constitutes a publication claim. The source commit and artifact hashes identify the tested candidate. No npm upgrade, installation, publication, commit, or push was performed by this witness.

| Artifact | SHA-256 |
|---|---|
| Candidate `dist/client.mjs` | `47c10df4e48ca5976fbb7086d5e92638005df494d42e0eac8a68eeebaac5963a` |
| Candidate `dist/expo.mjs` | `e665065f32ebed810cc0be8f626f5e9a759eccf752e478251c1ff7df09732088` |
| Original installed client before overlay | `2a2e7e7c3ed65232b1d6c03bb933896ded12ea2332645d98aedc1e27c7fc2f80` |
| Candidate source `src/live.ts` | `e4796bc313f49affbcaed0ecc0e00cde792d4c2e9437ff732c833cb13491ff95` |
| Final native executable | `910489339a69b9ed7c9666e7fb4c2de439fa9ed8ec958964932a4d2263b6213b` |
| Final Hermes bundle | `73d83301bd84559230ba51aef1a8361d58f39ae9a7a3b244eae53f44150cdf5b` |
| Final Hermes framework | `cded3f9fff59eb5ab73e8575299ddf1f56c08b693ea1171469617b8a1118654a` |
| [Final native app archive](evidence/CliqueCandidateLiveSync.app.zip) | `78e8efac04b5f24d28cd1d137dc7a9f6406443f6314b7617b861a19da6d591e3` |
| Original published backend binary | `52d7de9c0c31c3e1cd4df59a3afb438d664f428b25bc68994952ece14ace4955` |
| Preserved original app lock | `5382638179bb43155d2bdd08cb1e8d4eb834fafa949cb98b43a4c746e4292c49` |

Work ran on M5 `ccheever@100.88.75.121`, using only **Clique-006-M6**, UDID **A0659883-FDEB-4ED2-B560-831A778226DA**, iOS 26.5. Build: Xcode 26.6 / `17F113`, Release simulator, RN 0.81.5, Expo 54.0.37, Hermes, Xcode-managed ad-hoc signing. [Environment](evidence/environment.json).

APFS copies supplied separate `build-app/`, `backend-app/`, and private DerivedData/cache under this external directory. The original backend binary and fixture store were copied before launch. The generated native project changed only the candidate bundle/keychain identity. An external Babel transform substitutes the standalone [witness root](harness/candidate-witness.jsx); all **71 frozen application files**, including package and lock, remain byte-identical. Repository source was not edited.

**Commands and reproducibility**

The retained [harness](harness/) and [command logs](evidence/commands.jsonl), [native command logs](evidence/native-commands.jsonl), and [process lifecycle](evidence/lifecycle.jsonl) record execution. Principal commands were:

```sh
# LOCAL, clean named candidate worktree snapback2/packages/snapback2
node build.mjs
# M5, copied backend-app; published wrapper and compiler untouched
node node_modules/snapback2/bin/snapback2.mjs dev --foreground --port 49606
# M5, copied build-app; private DerivedData and TMPDIR; Metro workers = 2
xcodebuild -workspace ios/Clique006M6.xcworkspace -scheme Clique006M6 \
  -configuration Release -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /Users/ccheever/clique-improvement/native/candidate-live-sync/DerivedData \
  -jobs 3 CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
# Explicit designated simulator only; see native-commands.jsonl for exact argv
xcrun simctl install A0659883-FDEB-4ED2-B560-831A778226DA <Release-app>
xcrun simctl launch <stdout/stderr-options> A0659883-FDEB-4ED2-B560-831A778226DA dev.clique.candidate.livesync.r2
node harness/api-witness.mjs send
```

**Preserved failures and limits**

The first build failed because cloned Swift module cache entries retained the original path. Its [failure log](evidence/xcodebuild-release.attempt1.log) is preserved; replacing only the candidate copy's module cache allowed the build to succeed. A setup probe initially used unsupported `--version`; the published CLI's `version` verb succeeded.

The first native observer also inspected `.body` on JSON control responses. Expo's getter starts streaming and perturbed the SDK's later `.json()` read, causing `JSON Parse error: Unexpected end of input` and empty partial callbacks. This was an invalid observer attempt, not a candidate qualification result. Its [entire evidence, source, video, and app](attempts/01-observer-json-side-effect/) are preserved. The [correction](harness/observer-correction.md) limited body observation to SSE and used a new native bundle identity. No SDK fix was applied by this witness.

The successful run's screen recorder refused the previous attempt's existing filename (exit **17**). There is **no video of the successful transition**. Native before/after screenshots and the full native/console logs establish it. [Supplemental final-state footage](evidence/candidate-final-state.mp4) was recorded later, after the marker arrived, and is labeled accordingly in the [recording boundary](evidence/recording-boundary.json). The old video is retained solely as failed-observer evidence.

Cleanup stopped recorded app PID **6410**, backend listener **91168**, and wrapper **91122**; earlier observer PID **75542** was separately stopped after preserving that attempt. Recording/build PIDs are logged. Only the designated simulator was shut down. Ports 49606/49607 have no listeners; reserved ports 49100–49103 were unused. All simulator states match the initial inventory. [Cleanup](evidence/cleanup.json).

Original report, original evidence, frozen source, installed package, lockfile, and original fixture database hashes all match their before snapshots. The result is confined to authenticated native history subscription plus one live backend change. No full M6 process-kill/offline/media run, premature-tick repair, publication, or broader acceptance claim was made.
