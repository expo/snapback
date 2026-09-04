I could not create `/Users/ccheever/projects/snapback-1012-impl/reviews/1013-r3-astra.md`: this session permits filesystem reads only. The review follows.

Reviewer: Codex, independent read-only review, 2026-09-04. No agents, tests, remote commands, or tree modifications. I could not verify the export’s SHA, E1’s implementation, simulator behavior, or publication status.

Below, `D` means `llp/1013-expo-arm.spec.md`; `src/`, `templates/`, and `build.mjs` are relative to `snapback2/packages/snapback2/`.

**1. Verdict: NOT READY**

**E2 may not start on revision (c) as written.** Its architecture is reasonable, but the native file lifecycle still violates the stated custody model unless the implementer supplies missing design, and the witness can pass without establishing its required claims. The reducer relocation also needs an explicit packaging/scaffolding change.

E1’s earlier transport and context blockers are addressed in the specification. The E1 corrections below should reach that lane.

**2. Blocking design errors**

1. **Carrier byte removals are insufficient to govern native files.**

   Decision 7 ties file eviction to `bytes.remove` and partition wipe (`D:145`). However, view-once bytes exist only in the session map (`src/store/byte-cache.ts:209`, `:278`); they have no durable byte entry to remove. Sealing writes `NO_BYTES` (`src/store/range-store.ts:662`), while runtime seal/close only clear the existing memory allowance (`src/offline.ts:299`, `:321`). Those operations cannot invalidate a previously returned native file URI automatically.

   SQLite commit and filesystem deletion also cannot be one transaction. A crash after eviction commits but before deletion leaves an orphan; an outstanding file write can recreate a file after wipe.

   Specify that files are derivatives, never evidence of permission: validate current partition, seal, viewed state, and lease before serving; invalidate mounted consumers; fence asynchronous writes against custody changes; sweep orphans on startup. Give session-only media a separate lifetime and startup cleanup, preserving only the active viewing instance. Alternatively, keep session media off disk. These are requirements of LLP 1012 §9 (`llp/1012-local-first-v1.spec.md:754`), not optional housekeeping.

2. **The simulator witness still lacks an executable proof contract.**

   A barrier after DML and before COMMIT establishes an **open transaction**, not interruption inside COMMIT. If its promise remains unresolved, asynchronous termination cannot make COMMIT run. Accepting the post-swap state merely because `simctl terminate` is asynchronous (`D:173`) can conceal a released or misplaced barrier.

   Keep the barrier unresolved through termination; socket closure must never resolve it successfully. Record the launched PID, establish exit, and reopen without reinstalling. Distinguish old/new markers across rows, answers, outbox, metadata, and bytes. The existing app list (`D:315`) cannot detect every mixture. A Node rollback proof is useful complementary evidence; it does not replace the native qualification required by `llp/1012-local-first-v1.spec.md:810`.

   Also persist the **data-transport cut before client construction on relaunch**. Today `forcedOffline` defaults false (`src/client.ts:165`), and initialization can resume (`:970`). Otherwise step 4 can replay or refill before inspection.

   Finally, assert an offline send **inside the never-opened thread query’s result as `predicted`**, as LLP 1012 requires (`:843`). A visible pending bubble is insufficient: `threadBubbles` manufactures one from the outbox even without a predicted query row (`templates/chat/react/src/chat/log.ts:103`). Decision 10 names the acceptance, but §7 does not execute it.

3. **The shared-reducer move breaks installed template assembly unless the lane changes it.**

   Decision 8 moves `log.ts` outside `react/` (`D:152`). The package copies only `snapback/` and `react/` (`build.mjs:142`); `init` then flattens `react/` into the generated project root (`snapback2/crates/snapback2/src/init.rs:112`). Neither copies `shared/`, and the relative import geometry changes during flattening.

   Specify both the shipped and scaffolded layouts, update their copy paths/imports, and assign Expo scaffolding explicitly. Merely adding `templates/chat/expo/` leaves `init --client` accepting only `react|none` (`init.rs:55`).

**3. Decisions table**

Revision (c) contains **13 decisions**, not ten.

| §2 | Assessment / change | Cost |
|---|---|---|
| 1. SQLite swap | Agree with state rewrite plus byte delta. Require byte UPSERTs; measure phone latency before diffing. | Low initially; potentially material serialization cost. |
| 2. Driver/executor | Agree. Preserve callback results, normalize missing rows, and isolate competing operations. | Small adapters plus native conformance. |
| 3. JSON keys | Agree. Encode reversibly; split internal keys at the first NUL only. | Small. |
| 4. Locks | Change: runtime ownership and transaction locking are different; remove guaranteed cross-process refusal. | Small wording change; real cross-process ownership costs more. |
| 5. SecureStore | Agree with legal keys. Validate `name`; define persistence failures and cache consistency; correct “2 KB limit.” | Small. |
| 6. Entries/context | Agree with `expo/fetch`, persona exclusion, and one emitted context. Specify supplied-client ownership and peer externalization. | Moderate integration. |
| 7. Byte bridge | Change per blocker 1; include byte-oriented session storage and video miss behavior. | Substantial native work. |
| 8. Expo template | Agree, with blocker 3 and explicit auth/tombstone/view-once wiring. | Moderate. |
| 9. Witness | Change per blocker 2; complete commands, observations, startup, and fault injection. | Moderate harness work. |
| 10. Twin acceptance | Agree; assert query output and prediction, separately from rendered bubbles. | Small. |
| 11. Bundle size | Agree with actual artifact inspection; distinguish bytecode totals from source-attribution estimates. | Small measurement work. |
| 12. Node journeys | Agree. Native qualification remains necessary; Expo web needs another carrier. | Scheduled simulator cost. |
| 13. Publication elsewhere | Agree; preserve the published-package qualification handoff. | Small coordination cost. |

**4. Material findings**

**Round-2 resolution audit.** Findings shared across reviewers are grouped:

- **Resolved in the text:** Astra B1’s streaming fetch and `as` exclusion; B2’s emitted context identity; the environment-placement portion of Astra B3/Muse B2; Grok F1/F2’s competing key layouts and impossible MIME column; missing-row normalization; SDK dependency lines; explicit clone-runtime dependency; Hermes export correction; package source maps; isolated witness subpath; persistent carrier-fault configuration; second enqueue; additional navigation/send/view commands; database location and shared-sidecar preservation.
- **Partially resolved:** Astra B3’s early control connection—`witnessControl(client,url)` still requires the client it supposedly precedes (`D:167`); use a connect-then-attach API or client factory. Muse B1/Grok’s kill concern gains the Node proof but retains blocker 2. Byte ingress is named, but session/file custody remains incomplete. Added witness verbs still omit explicit conformance execution, swap selection, and rendered observations.
- **Still open:** cross-process refusal, competing-connection conformance wording, byte UPSERTs, SecureStore error/cache semantics, supplied-client lifetime, optional/external native peers, packaging/scaffolding, auth/tombstone/view-once fixtures, persistent offline startup, backup policy, JSON round-trip edge cases, and measurement attribution.
- **Advice that should not be folded mechanically:** deleting shared WAL/SHM files is wrong; a universal Android CursorWindow limit was not established; WAL is not required for transaction atomicity; the requested `--simulator` replacement is itself incorrect. Confidence percentages, repeated publication text, and speculative Exact compatibility remain.

**Code-claim audit.** The carrier interface checks out (`src/store/range-store.ts:323`). IndexedDB clears/repopulates four state stores and applies byte deltas in the same transaction; its hook precedes transaction creation (`src/store/indexeddb.ts:190`). The file carrier is explicitly ordered writes plus startup sweeping, not transactional (`src/store/file.ts:43`).

The native export/peer description is substantially correct (`package.json:17`, `:45`), but “never touch the byte cache” is false: both native components call `useAssetUrl` (`src/react-native.tsx:25`, `:96`), which consults `cache.get` (`src/react.tsx:461`). Native components do not fill it or mark viewing. Explicit native exports also shadow the web component names; they are not two simultaneously exported implementations.

Injectable Web Locks and `${key}:principal` are confirmed (`src/store/indexeddb.ts:250`; `src/token-store.ts:19`). Runtime principal changes wipe, terminal expiry seals, and session bytes clear (`src/offline.ts:241`, `:299`). Those facts do not automatically extend to new files.

The four-entry unsplit build and absent source maps are confirmed (`build.mjs:29`). The recorded twin measurement is **19,747 gzip bytes**, with neutral/es2022 methodology (`snapback2/metrics/twin.jsonl:3`); I did not reproduce it. Hashing implements SHA-256 and UTF-8 directly (`snapback2/packages/evaluator/src/hash.ts:1`, `:70`). Clone usage is correctly acknowledged (`src/twin-hydrate.ts:95`).

**SQLite and ownership.** Expo’s async API, transaction-scoped executor, separate exclusive connection, plain `BEGIN`, and nullable `getFirstAsync` are confirmed by the [SDK 54 implementation](https://raw.githubusercontent.com/expo/expo/sdk-54/packages/expo-sqlite/src/SQLiteDatabase.ts). The adapter must capture `T` itself: Expo’s helper returns `Promise<void>`.

Two processes can both load S, then sequentially replace it from stale snapshots without `SQLITE_BUSY`. Therefore `D:113` and `D:401` still promise refusal that transaction locking cannot provide. Keep multiple processes unsupported without claiming detection. Serialize legitimate writes across partitions sharing the database.

Conformance’s “second executor blocks or fails” (`D:258`) must mean a **competing writer on another connection**; WAL readers may proceed. Require repeated-key byte UPSERT coverage: ordinary `INSERT` at `D:226` would violate the primary key on a second put.

WAL works on iOS; the default location is Documents/SQLite, confirmed by the [native implementation](https://raw.githubusercontent.com/expo/expo/sdk-54/packages/expo-sqlite/ios/SQLiteModule.swift). Requiring WAL is a support-policy choice, not an atomicity prerequisite. Count sidecars and materialized files; partition DELETE neither removes sidecars nor necessarily shrinks allocation. [SQLite WAL documentation](https://sqlite.org/wal.html)

**Platform specifics.** `Uint8Array` BLOB binding/readback is supported; base64 is unnecessary. Empty-BLOB and native round trips remain worthwhile. [SDK 54 SQLite API](https://docs.expo.dev/versions/v54.0.0/sdk/sqlite/)

SQLite’s default maximum string/BLOB length is one billion bytes, configurable. JS heap, copying, serialization, and duplicated media files can constrain this design much earlier; 256 MiB is not a total-storage bound. [SQLite limits](https://sqlite.org/limits.html)

SecureStore does **not** enforce a universal 2 KB ceiling; historical native failures motivate small values and error handling. The legal alphabet is correct, but interpolated `name` still needs validation. [SecureStore documentation](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/)

SDK 54 installs `structuredClone` and `TextDecoder`; Hermes provides `TextEncoder`. This is correctly an Expo-runtime dependency, not bare-Hermes portability. I could not verify `crypto.subtle` availability on the target device; the twin needs none. [Runtime initialization](https://raw.githubusercontent.com/expo/expo/sdk-54/packages/expo/src/winter/runtime.native.ts), [encoding APIs](https://docs.expo.dev/versions/v54.0.0/sdk/expo/#encoding-apis)

**Witness corrections and safer alternative.** `D:311` inherited bad advice: Expo uses `--device` for physical **and virtual** devices. Restore `--device <simulator-UDID>`. [Expo CLI](https://docs.expo.dev/more/expo-cli/#compiling)

The web witness does not inject a 503 “on the owner”: it replaces a completed response in client transport (`snapback2/scripts/witness-web.mjs:75`). Specify that mechanism or a host proxy. Its pre-transaction hook, 500 ms sleep, and obsolete hydrating assertion are not evidence to copy (`:241`, `:269`).

The uglier-but-safer instrument is a nonce-qualified file handshake outside SQLite: host arms; app completes DML and writes “reached”; the promise stays held; host SIGKILLs the PID recorded at launch, observes exit, and relaunches. Bound waits and reject stale markers. Never obtain the acknowledgement through queued store reads (`src/store/range-store.ts:1109`). Actual interruption inside COMMIT requires native/VFS instrumentation; neither socket nor file barrier proves that.

**Lane tripwires.** The seed contains personas, not login credentials (`templates/chat/snapback/seed.ts:4`). Define `login(alice)` accordingly. Carry over `onTombstone` (`templates/chat/react/src/main.tsx:11`) and a durable view-once fixture/predicate; the journey uses an explicit selected row (`templates/chat/snapback/tests/chat.test.ts:459`). No `purgeExpired` recipe exists in the inspected template; the web witness substitutes unsend. A cache-file existence assertion also does not establish successful image decoding/rendering.

**Bundle measurement.** Hermes export is correctly restored. [Expo Hermes documentation](https://docs.expo.dev/guides/using-hermes/) Source maps alone do not establish additive compressed-byte shares. Record actual HBC totals, then separately label source attribution from an analysis export; Expo documents `--source-maps --no-bytecode` for that purpose. [Bundle analysis](https://docs.expo.dev/guides/analyzing-bundles/)

**5. Minor**

The actual screen typecheck is `snapback2/packages/compiler/src/test-final-gates.ts:48`; it excludes `main.tsx` and filters diagnostics to named screens. Expand both coverage and filtering for the entrypoint/shared module.

Correct the Systems path to `snapback2/packages/snapback2/templates/chat`. Replace “another tab” on native (`src/client-offline.ts:83`). Define `SqliteParams`, preserve transaction results, and reconcile §14’s “sqlite file size” with §3’s broader accounting. Keep new checks inside the existing five-check/60-second budget (`rules/RULES.md:25`).

**6. What I would delete**

Delete confidence percentages, repeated publication paragraphs, speculative Exact schema compatibility, guaranteed cross-process refusal, “hooks do not change,” and the nonexistent `DatabaseSync.transaction()` warning. Node 24 documents no such method; explicit BEGIN/await/COMMIT suffices. [Node 24 SQLite API](https://raw.githubusercontent.com/nodejs/node/v24.0.0/doc/api/sqlite.md)

Replace revision-history prose with a short disposition record naming which review recommendations were accepted, rejected, or remain unresolved.