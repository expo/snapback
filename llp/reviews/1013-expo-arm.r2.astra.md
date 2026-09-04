I could not create `/Users/ccheever/projects/snapback-1012-impl/reviews/1013-r2-astra.md`: this session permits filesystem reads only. The review follows.

Paths beginning `src/`, `templates/`, or `build.mjs` are relative to `snapback2/packages/snapback2/`. No tests were run. I could not verify simulator behavior, recorded test passes, or publication status.

**1. Verdict: NOT READY**

I would not dispatch E1 on §3–§5 as written. The carrier direction is sound, but the factory omits the streaming transport and the bundling instructions undermine the promised shared React context. The witness also retains an unusable startup configuration mechanism.

**2. Blocking design errors**

1. **`createExpoClient` does not supply the transport required by live queries.** Decision 6 supplies only storage and token defaults (`llp/1013-expo-arm.spec.md:119`). The client therefore selects global fetch (`src/client.ts:160`), while SSE requires `response.body.getReader()` (`src/sse.ts:47`). React Native’s default fetch comes from `whatwg-fetch`; installing Expo’s stream globals does not turn that transport into streaming fetch. Default to `expo/fetch`, preserving an explicit override. Otherwise the proposed template cannot reliably drain its live inbox. [React Native fetch source](https://github.com/facebook/react-native/blob/v0.81.0/packages/react-native/Libraries/Network/fetch.js), [Expo streaming fetch](https://docs.expo.dev/versions/v54.0.0/sdk/expo/#expofetch-api).

   Also omit the default token store when `as` is supplied: `createClient` rejects that combination (`src/client.ts:155`).

2. **A shared source module does not produce one shared context under the prescribed build.** The spec says to bundle both entries “like the other entries” (`llp/1013-expo-arm.spec.md:248`). That build bundles multiple entries **without code splitting** (`build.mjs:29`). Each resulting bundle can contain its own `createContext` invocation (`src/react.tsx:50`). A provider imported from `snapback2/expo` and components imported from `snapback2/react-native`, as §6 permits, then use different contexts and throw at `src/react.tsx:130`.

   Preserve one emitted context module through external re-exports or shared chunks. Extend the client-externalization plugin, currently restricted to two source paths (`build.mjs:23`), when moving imports into `react-core.tsx`. Verify mixed imports against built package entries; source-level tests and string-purity checks cannot establish this.

3. **The witness URL is configured at the wrong boundary.** Decision 9 places the environment check inside the shipped package; step 2 sets `EXPO_PUBLIC_SNAPBACK_WITNESS` when launching the app (`llp/1013-expo-arm.spec.md:141`, `:271`). Expo substitutes these variables during bundling, excludes `node_modules`, and does not turn simulator process environment into JavaScript `process.env`. Read the URL in the template’s source and explicitly pass it into the witness client; set it before Metro bundles. [Expo environment-variable behavior](https://docs.expo.dev/guides/environment-variables/#how-variables-are-loaded).

   Similarly, an in-memory “fail the next open” wrapper disappears on relaunch (`:279`). Persist its configuration outside the carrier, or obtain host configuration **before** constructing/opening the client. The control connection must remain available when carrier initialization fails.

**3. Decisions table**

Revision (b) contains **13**, rather than ten, decisions.

| §2 | Assessment / change | Cost |
|---|---|---|
| 1. SQLite swap | Agree with state rewrite plus byte delta. Correct transaction semantics; measure before introducing diffs. | Low initially; potentially substantial phone latency. |
| 2. Driver interface | Agree. Define parameter types, missing-row normalization, transaction result propagation, and connection isolation. | Small adapter work; native conformance remains necessary. |
| 3. Encoded keys | Agree. Use one reversible encoding; reconcile `(kind,key)` prose with the actual schema. | Small. |
| 4. Writer locks | Change: distinguish runtime ownership from SQLite transaction locking; remove guaranteed cross-process refusal. | Small documentation change, or material work for actual ownership enforcement. |
| 5. SecureStore | Agree. Validate `name`, specify failed-write/cache behavior and partial token/principal persistence. | Small. |
| 6. Entries/provider | Change per blockers 1–2; define ownership and closing of supplied clients. | Moderate integration work. |
| 7. Byte bridge | Agree in principle; specify byte ingress, session-only media, crash cleanup, and seal invalidation. | Substantial native integration. |
| 8. Expo template | Agree; include packaging, scaffolding, auth, tombstone callback, and view-once fixture. | Moderate. |
| 9. Witness | Change per blocker 3 and the protocol requirements below. | Moderate harness work. |
| 10. Twin acceptance | Agree. Assert the query’s predicted result, not merely the reducer’s pending bubble. | Small additional observations. |
| 11. Bundle measurement | Change false export claim; identify actual bytecode artifact and attribution method. | Small. |
| 12. Node journeys | Agree. Native conformance complements Node evidence. Expo web needs a different carrier. | Scheduled native cost. |
| 13. Publication elsewhere | Agree, with an explicit published-package qualification handoff. | Small coordination cost. |

**4. Material findings**

**Round-one resolution audit.** Astra B1/B5/B7 are resolved in design: encoded keys, legal SecureStore keys, and corrected twin acceptance. Astra B2 and Grok B2’s transaction-ownership concern are substantially resolved by the executor and explicitly awaited Node transaction. Grok B3 is resolved by encoding. Astra B4 is only partially resolved: exports/provider changes are specified, but emitted context identity remains broken. Astra B3/Muse B2 are partially resolved: the bridge now has an owner, but its lifecycle is incomplete. Astra B6/Grok B1/Muse B1 have the correct socket direction, but startup remains broken. Muse B3’s “no transaction dance” contradiction is removed; transaction semantics and cross-process refusal are still misstated.

**SQLite isolation needs precise language.** SDK 54’s exclusive helper creates a separate connection and executes plain `BEGIN`, not `BEGIN IMMEDIATE` (`llp/1013-expo-arm.spec.md:77`, `:213`). Its scoped executor is correct; write locking follows the first DML. State that contract, or implement explicit immediate transactions on a dedicated connection. [SDK 54 transaction implementation](https://github.com/expo/expo/blob/sdk-54/packages/expo-sqlite/src/SQLiteDatabase.ts#L158).

A transaction lock does not enforce lifetime ownership: two processes can load state S, then sequentially commit different replacements based on S without any `SQLITE_BUSY`. Therefore “unsupported … refused loudly” (`:359`) is false. Keep the supported single-runtime scope explicit. Serialize writes across partitions sharing the same database; key the ownership registry by database identity plus partition.

The conformance assertion that a “second executor blocks or fails” (`:223`) must mean a **competing write on another connection**. WAL permits concurrent readers. Statements on the same Node connection can enter its existing transaction unless the driver excludes them. [SQLite WAL concurrency](https://sqlite.org/wal.html#concurrency).

**The simulator instrument is appropriate, with narrower claims.** Awaiting a barrier after transaction-scoped DML and before COMMIT establishes a deterministic **open-transaction** window. `simctl terminate` cannot deterministically interrupt an instruction inside COMMIT. I could not verify its exact termination signal. Record the launched application PID, send SIGKILL to that PID, observe exit, then relaunch without reinstalling.

Use distinct old/new markers across state, outbox, and bytes: previously acknowledged work survives; the interrupted swap’s changes are absent. Finish enqueueing before arming a later swap. A barrier that never reaches COMMIT tests rollback after process death; exact commit-I/O interruption requires native/VFS instrumentation.

The uglier-but-safer alternative remains a nonce-qualified **file handshake** outside SQLite: host arms; app completes DML, writes a reached marker, and remains suspended; host observes it and kills the recorded PID. Reject stale markers and bound waits. Socket disconnection must never release the transaction. Do not obtain the reached acknowledgement through `coverage()` or another queued store read: reads await the blocked tail (`src/store/range-store.ts:1109`).

Four verbs still cannot drive sign-in, navigation, sending, targeted swaps, fault injection, or conformance execution. Specify UI automation or additional commands and rendered observations. Persist the offline transport cut across relaunch **before client construction**. Step 7 still references a second message never enqueued. Assert `predicted` inside the never-opened thread’s query result: `threadBubbles` can synthesize pending bubbles from outbox entries alone (`templates/chat/react/src/chat/log.ts:103`).

The web precedent remains weaker: its hook precedes transaction creation (`src/store/indexeddb.ts:195`), and its harness sleeps 500 ms without a reached acknowledgement (`snapback2/scripts/witness-web.mjs:269`). It still expects the obsolete hydrating result (`:241`).

**The byte bridge needs a complete custody contract.** `assetBlob` belongs to the client, while `AssetCache.get` returns Blob (`src/client.ts:321`, `src/store/byte-cache.ts:42`). Define byte-oriented read **and write** paths; wrapping `assetBlob` will preserve the incompatibility. Existing writes require `blob.arrayBuffer()`, and the session allowance stores Blobs (`src/store/byte-cache.ts:209`, `:288`). Expo’s own `FetchResponse.blob()` documents the incompatible React Native Blob construction; consume `arrayBuffer()`/bytes directly. [SDK 54 FetchResponse](https://github.com/expo/expo/blob/sdk-54/packages/expo/src/winter/fetch/FetchResponse.ts#L84).

Ordinary materialized files must be derivative: check current partition, seal, viewed state, and lease before returning a URI; sweep orphan files after crashes; prevent an asynchronous write from resurrecting files after wipe. File deletion cannot share SQLite’s transaction. View-once session images have **no durable byte entry**, so `bytes.remove` cannot clean their files. Specify a separate session lifetime and startup sweep, or an in-memory/native rendering path. Preserve the active viewing instance without allowing cold-start reuse.

**Two folds introduced false platform claims.**

- “No `structuredClone` on the twin’s path” is false (`llp/1013-expo-arm.spec.md:57`): `src/twin-hydrate.ts:95` clones the halo; the store and outbox also clone (`src/store/range-store.ts:343`, `src/store/outbox.ts:231`). SDK 54 installs a structured-clone polyfill. Ensure Expo runtime initialization precedes use; this is not bare-Hermes portability. [Expo runtime initialization](https://github.com/expo/expo/blob/sdk-54/packages/expo/src/winter/runtime.native.ts).
- `expo export` **can emit Hermes bytecode**. SDK 54’s export implementation selects Hermes and requests bytecode; prebuild is not the compilation boundary (`llp/1013-expo-arm.spec.md:156`). Inspect the artifact rather than assuming a `.hbc` suffix. Source-map attribution also requires preserving package source maps; the current client build emits none (`build.mjs:29`). [SDK 54 export implementation](https://github.com/expo/expo/blob/sdk-54/packages/@expo/cli/src/export/exportApp.ts#L153).

The SHA-256 claim itself is correct: `snapback2/packages/evaluator/src/hash.ts:1` and `:70` implement hashing and UTF-8 directly. No WebCrypto dependency is needed. Hermes supplies TextEncoder on the SDK 54 baseline; Expo supplies TextDecoder, which SSE uses. [Expo encoding APIs](https://docs.expo.dev/versions/v54.0.0/sdk/expo/#encoding-apis).

**Other Expo facts and implementation traps.**

- Async SQLite and `Uint8Array` BLOB binding/readback are supported. Normalize `getFirstAsync`’s `null` to the driver’s `undefined`. SDK 54 uses SQLite **16.x** and SecureStore **15.x**; `>=15` is not a pin to that SDK. [SQLite API](https://docs.expo.dev/versions/v54.0.0/sdk/sqlite/), [SDK version map](https://github.com/expo/expo/blob/sdk-54/packages/expo/bundledNativeModules.json).
- The default iOS database location is `Documents/SQLite/`. WAL is supported. Measure database, WAL, SHM, and materialized media files; DELETE does not necessarily shrink allocation. Do not adopt round one’s suggestion to delete shared sidecars during partition wipe. [iOS implementation](https://github.com/expo/expo/blob/sdk-54/packages/expo-sqlite/ios/SQLiteModule.swift#L21), [WAL files](https://sqlite.org/wal.html).
- SQLite’s default maximum string/BLOB length is one billion bytes, subject to configured limits. Phone memory and repeated JS/native copies can constrain this workload first; 256 MiB bounds cached payloads, not total disk or peak memory. [SQLite limits](https://sqlite.org/limits.html).
- SecureStore has no universal enforced 2 KB limit; historical platform failures motivate keeping values small and handling errors. Its key alphabet is correctly fixed. [SecureStore documentation](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/).
- Moving reducers outside `react/` breaks current template assembly unless both `build.mjs:142` and `snapback2/crates/snapback2/src/init.rs:112` change. `init` accepts only `react|none` (`:55`). Include shared reducers and the entrypoint in typechecking.
- Carry over `onTombstone` (`templates/chat/react/src/main.tsx:11`) and define actual view-once data/predicate: the current message schema has no marker (`templates/chat/snapback/schema.q:58`). Expo web cannot merely reuse this SQLite driver: exclusive transactions are unsupported there and SQLite web requires WASM, which LLP 1012 §4 excludes.

**5. Minor**

The carrier interface, IndexedDB state rewrites plus byte deltas, file write ordering, injectable locks, browser principal key, runtime seal/wipe, reducer names, and recorded 19,747-byte gzip measurement check out (`src/store/range-store.ts:323`, `src/store/indexeddb.ts:198`, `src/store/file.ts:43`, `src/offline.ts:241`, `snapback2/metrics/twin.jsonl:3`).

“Never touch the byte cache” is too broad: native components call shared `useAssetUrl`, which consults it (`src/react.tsx:461`).

Remove `bytes.type` or derive it from `state.assets`: `ByteDelta.put` has no MIME field (`src/store/byte-cache.ts:23`). Require UPSERT semantics for repeated byte puts. Make new peers optional and externalized.

**6. What I would delete**

Delete confidence percentages, repeated publication paragraphs, speculative Exact file compatibility, unconditional cross-process refusal, and the two false Hermes claims.

Delete the `DatabaseSync.transaction()` warning: Node 24.0 documents no such method; retain the explicit BEGIN/await/COMMIT contract. [Node 24 API](https://github.com/nodejs/node/blob/v24.0.0/doc/api/sqlite.md).

Keep the document focused on native differences, ownership boundaries, and executable acceptance criteria.