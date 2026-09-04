I could not create `/Users/ccheever/projects/snapback-1012-impl/reviews/1013-r1-astra.md`: this session’s filesystem is read-only. The review is printed below.

Paths beginning `src/`, `templates/`, `tests/`, or `package.json` are relative to `snapback2/packages/snapback2/`.

**1. Verdict: NOT READY**

SQLite is the right carrier, but revision (a) contains blocking errors in key serialization, transaction ownership, native media integration, and package assembly. The witness also needs a corrected transport and acceptance criteria.

No tests were run. I could not verify recorded test passes, publication status, or simulator availability. The read-only `simctl help` attempt could not access CoreSimulator services.

**2. Blocking design errors**

1. **The projected keys cannot be bound directly as SQLite TEXT on the stated Expo baseline.** Row keys contain NUL between table and ID; answer keys contain NUL between operation and arguments (`src/store/range-store.ts:355`, `:359`). Expo SDK 54’s iOS implementation binds strings with length `-1` and reads them through `String(cString:)`, terminating at NUL. Consequently, `messages\0m1` and `messages\0m2` collapse to the same key; query arguments disappear too. This breaks §3’s “insert the projections exactly” instruction. Encode keys reversibly—JSON-stringifying the key suffices—and decode on loading. Include native round trips for multiple rows and multiple argument sets. [Expo SQLite iOS source](https://github.com/expo/expo/blob/sdk-54/packages/expo-sqlite/ios/SQLiteModule.swift#L544)

2. **The driver omits transaction-scoped execution.** Decision 1 says `withTransactionAsync`; §3 says `withExclusiveTransactionAsync`; the interface passes no executor into `body`. Expo’s exclusive method creates a separate connection: statements must execute through its supplied `txn`. Wrapping `body()` while its calls continue using the outer database does not put those writes in that transaction. Use `transaction(body: (tx: SqliteExecutor) => Promise<T>)`, with every statement and barrier bound to `tx`. Also reconcile `BEGIN IMMEDIATE`: Expo’s implementation issues `BEGIN`, contrary to the interface comment. [Expo transaction implementation](https://github.com/expo/expo/blob/sdk-54/packages/expo-sqlite/src/SQLiteDatabase.ts#L158)

3. **The native components do not implement the claimed offline media behavior.** Native `AssetImage` hands a network URI directly to React Native `Image`; `AssetVideo` hands its URI directly to `useVideoPlayer` (`src/react-native.tsx:64`, `:83`). Neither fills `assetCache` through `assetBlob`; video never calls `markViewed`. The corresponding web behavior exists at `src/react.tsx:534`, `:590`, and `:597`.

   Furthermore, `ByteCache.get()` constructs a Blob from a typed array (`src/store/byte-cache.ts:238`), which React Native 0.81’s Blob implementation explicitly rejects. `put()` requires `blob.arrayBuffer()` (`:288`). Thus “the byte cache … do[es] not change” is not a supported baseline. Specify the native byte-to-renderable-URI adapter, cache population, view-once consumption, and cleanup. [React Native Blob implementation](https://github.com/facebook/react-native/blob/v0.81.0/packages/react-native/Libraries/Blob/BlobManager.js#L58)

4. **The proposed entry cannot assemble the promised hook client.** There is no public `snapback2/react-native` subpath: `package.json:17` selects the native bundle through the `react-native` condition of `snapback2/react`. The §5 re-export therefore names an unexported path.

   Moreover, `react-native.tsx:8` re-exports `react.tsx`, which exports IndexedDB at `src/react.tsx:14`; “everything” re-exported and “no indexedDB reference” are incompatible. Split shared hooks/context from platform carriers and components.

   Finally, `SnapbackProvider` accepts construction options and creates its own client (`src/react.tsx:52`, `:103`); it cannot receive `createExpoClient()`’s result. Specify either an Expo provider with stable defaults or an explicit existing-client provider, preserving one shared context.

5. **SecureStore cannot use the browser key layout literally.** `browserTokenStore` stores the principal under `${key}:principal` (`src/token-store.ts:19`). SecureStore permits only alphanumerics, `.`, `-`, and `_`; the colon is invalid. Define valid, namespaced token/principal keys, including deletion behavior, and make the fake enforce the native restrictions. [SecureStore key restrictions](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/#securestoresetitemasynckey-value-options)

6. **The witness specifies an unavailable transport without providing its implementation.** §2 describes a WebSocket *to* the harness; §7 changes this into an app-hosted WebSocket server through “simctl’s port forwarding” (`llp/1013-expo-arm.spec.md:218`). React Native exposes a WebSocket client, not a server API. No server implementation or native dependency is specified. I could not verify the claimed `simctl` forwarding facility. Put the server on the host and connect outward from the app, or use the file handshake described below. [React Native WebSocket API](https://reactnative.dev/docs/network#websocket-support)

7. **The witness preserves an obsolete negative acceptance.** A never-opened but covered chat must render through the twin, with an offline send predicted into the query result (`llp/1012-local-first-v1.spec.md:843`). The existing journey explicitly tests this (`templates/chat/snapback/tests/chat.test.ts:631`). Revision (a) instead requires `hydrating`. Distinguish a covered, never-opened query from genuinely unavailable coverage; assert the applicable `partial/never-held` or hydrating outcome separately. “Never opened” alone is no longer sufficient.

**3. Decisions table**

| §2 decision | Assessment / change | Cost |
|---|---|---|
| 1. SQLite, transactional swaps, BLOBs | Agree. Encode keys, use a scoped transaction, retain whole-state rewrites initially. | Native serialization cases; potentially substantial swap latency. |
| 2. Shared driver and Node tests | Agree after adding a transaction executor and precise binding/result semantics. Node proves shared SQL logic, not Expo compatibility. | Small interface change; targeted native conformance assertions. |
| 3. In-process writer lock | Agree for an explicitly single-runtime app. Use a shared registry keyed by database identity plus partition; serialize database writes across partitions. | Small lifecycle/concurrency work. |
| 4. SecureStore | Agree; change key layout and define namespace and token/principal persistence ordering. | Small adapter; native failure cases. |
| 5. `snapback2/expo` | Agree; resolve exports, shared context, provider construction, native fetch, and byte adapters. | Material integration work beyond three re-exports. |
| 6. Sibling Expo template | Agree. Preserve shared reducers, but specify how shared files survive scaffolding and packaging. | Native screens, auth/media wiring, init/build changes. |
| 7. Simulator witness | Change transport and assertions; retain a barrier after DML and before COMMIT. | Harness protocol and native instrumentation. |
| 8. Bundle measurements | Agree. Pin SDK/Hermes and measurement method; label attribution estimates. | Modest measurement work. |
| 9. Node journeys; scheduled simulator | Agree. Include actual Expo-driver conformance in the witness. Native portability does not imply web portability. | More native assertions; no new blocking gate. |
| 10. Publication elsewhere | Agree on ownership; require an explicit handoff for published-package qualification. | Coordination and an artifact-backed witness run. |

**4. Material findings**

- **The barrier is appropriate for an interrupted transaction, not deterministic interruption inside SQLite’s COMMIT.** Await all transaction-scoped DML, emit a uniquely identified “reached” acknowledgement, then remain suspended before COMMIT. Kill only after that acknowledgement. Assert that the previously committed state survives and the interrupted swap’s distinct changes do not.

  `simctl terminate` alone cannot select an instruction inside SQLite’s commit. A pre-COMMIT barrier makes the outstanding-transaction window deterministic. For an unequivocally abrupt process kill, record the launched simulator-app PID and use SIGKILL against that PID; verify its exit before relaunch. An exact interruption inside SQLite commit I/O requires native instrumentation or a fault-injecting VFS.

- **The uglier-but-safer alternative is a file handshake.** Write an armed nonce into the app container; after DML, the hook writes a matching reached marker outside SQLite and awaits release. The host observes that marker, kills the recorded PID, and relaunches without reinstalling or clearing data. This survives control-socket failures and leaves inspectable evidence. Reject stale markers and bound waits. Neither transport may obtain its reached acknowledgement through `coverage()`: reads await the blocked store tail (`src/store/range-store.ts:1109`).

- **The browser witness is not a trustworthy implementation template without correction.** Its `beforeReplace` runs **before** opening the IndexedDB transaction (`src/store/indexeddb.ts:195`). The harness installs the barrier, sleeps 500 ms, then closes the context without a reached acknowledgement (`snapback2/scripts/witness-web.mjs:269`). Its comment that the transaction is held open is false. It also labels the twin pending (`:241`).

- **Specify missing witness actions and observations.** Four verbs cannot directly sign in, navigate, send, select a particular swap, or inject the post-commit 503. Step 7 asserts a second message without enqueueing one. Add UI automation or explicit harness actions. Inspect actual rendered identifiers and image load results, alongside store evidence; coverage alone cannot prove an image rendered. Persist the data-transport cut across relaunch, independently of the control channel.

- **Expo-specific facts:** the async SQLite APIs and `Uint8Array` BLOB binding/readback are real; base64 is unnecessary. WAL works on iOS. Expo SQLite web requires WASM, and exclusive transactions are unsupported there—so a web run is not merely another platform adapter and conflicts with `rules/NOT-DOING.md:72`. [Expo SQLite documentation](https://docs.expo.dev/versions/v54.0.0/sdk/sqlite/)

  The default iOS location is `Documents/SQLite/<name>`, not directly `Documents/<name>`. Resolve the actual container/path for the witness. [Expo directory implementation](https://github.com/expo/expo/blob/sdk-54/packages/expo-sqlite/ios/SQLiteModule.swift#L21)

  SQLite’s default maximum string/BLOB length is one billion bytes, subject to build/runtime limits. The 256 MiB cache ceiling is not a database-size or peak-memory ceiling. Measure large-rendition transfer and copying; device memory can become limiting first. [SQLite limits](https://www.sqlite.org/limits.html)

- **WAL requires more precise failure and size measurements.** Database files have `-wal` and `-shm` companions; changing only the main file’s permissions need not cause open failure. Use a demonstrated unopenable location or a failing write probe, then assert `E_OFFLINE_CARRIER`. Check WAL’s returned mode, not merely whether executing the pragma throws. Include sidecars in disk usage; DELETE does not imply file shrinkage. [SQLite WAL behavior](https://www.sqlite.org/wal.html)

- **Hermes is not the same environment as an initialized Expo runtime.** The store/outbox/twin use `structuredClone` (`src/store/range-store.ts:343`, `src/store/outbox.ts:231`, `src/twin-hydrate.ts:95`). Expo SDK 54 installs its polyfill; claiming it is simply unavailable on Expo would be wrong. Ensure the template initializes that runtime before client use. [Expo runtime initialization](https://github.com/expo/expo/blob/sdk-54/packages/expo/src/winter/runtime.native.ts)

  TextEncoder is supplied by Hermes on this baseline; Expo supplies TextDecoder. The twin’s SHA-256 already uses synchronous TypeScript and its own UTF-8 encoding (`snapback2/packages/evaluator/src/hash.ts:1`, `:70`), so it requires neither TextEncoder nor `crypto.subtle`. Do not add WebCrypto as a requirement. [Expo encoding documentation](https://docs.expo.dev/versions/v54.0.0/sdk/expo/#encoding-apis)

- **Default native transport must be specified.** The client defaults to global fetch (`src/client.ts:160`), while SSE requires `response.body.getReader()` (`src/sse.ts:47`). Select `expo/fetch` for the native entry’s streaming transport. Its SDK 54 `blob()` implementation itself documents incompatibility with React Native’s Blob constructor, reinforcing the need for an explicit byte adapter. [Expo FetchResponse source](https://github.com/expo/expo/blob/sdk-54/packages/expo/src/winter/fetch/FetchResponse.ts#L84)

- **Template assembly is omitted.** `init` currently supports `react|none` and copies the chosen React directory into the project root (`snapback2/crates/snapback2/src/init.rs:55`, `:112`); `build.mjs:142` copies only backend and React templates. Moving reducers to a sibling shared directory requires updating both operations. The template also needs the tombstone callback from `templates/chat/react/src/main.tsx:11` and an explicit view-once predicate. Its messages schema has no view-once marker (`templates/chat/snapback/schema.q:58`).

**5. Minor**

- The carrier inventory is mostly accurate: four state stores are cleared/repopulated; bytes are changed by delta in the same IndexedDB transaction (`src/store/indexeddb.ts:198`). File persistence uses ordered payload writes, rename, removals, and an open-time sweep (`src/store/file.ts:43`). `readBytes` is optional in the backend interface (`src/store/range-store.ts:328`).
- The reducer is `conversations`, not `inboxRows`; bubble identity uses the first pinned message ID, falling back to intent (`templates/chat/react/src/chat/log.ts:17`, `:106`). Images use React Native `ImageProps`, not expo-image props (`src/react-native.tsx:2`).
- Seal/wipe/session-cache behavior exists (`src/offline.ts:241`, `:299`, `:307`). Web Locks are injectable; Node simply lacks writer exclusion.
- The recorded twin measurement is 19,747 gzip bytes (`snapback2/metrics/twin.jsonl:3`). The shared screen typecheck exists (`snapback2/packages/compiler/src/test-final-gates.ts:48`). Neither record establishes Hermes correctness.
- `ByteDelta.put` has no MIME type (`src/store/byte-cache.ts:23`); remove the redundant SQL `type` column or explicitly derive it from `state.assets`.
- Declare new Expo peers optional, externalize them during bundling, and select SDK-compatible template versions.

**6. What you would delete**

Delete the confidence percentages, the assertion that a second process/runtime cannot exist, “the byte cache and React hooks do not change,” the invented simulator forwarding, and the unqualified “platform-neutral Expo” claim.

Delete §12’s speculative Exact file compatibility and “a day or two” estimate; retain only its deferred trigger and contract references. Delete redundant restatements of LLP 1012 and replace them with the native differences and concrete acceptance criteria above.