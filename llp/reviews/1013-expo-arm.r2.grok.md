# Blind design review — LLP 1013 revision (b)

Reviewer: grok-4.6. Frozen export `a9ed7b4b5` (no `.git`; I could not verify that SHA). Document: `llp/1013-expo-arm.spec.md`. No tests, clones, agents, or tree edits. Claims checked against the named files.

## 1. Verdict

**READY WITH CHANGES** — apply the list below, then E1 may start on §3–§5. Not **READY TO DISPATCH**: §3 and decision 3 still tell the lane two schemas, Wrote the review to [`reviews/1013-r2-grok.md`](/Users/ccheever/projects/snapback-1012-impl/reviews/1013-r2-grok.md) (2,489 words). Full text:

# Blind design review — LLP 1013 revision (b)

Reviewer: grok-4.6. Frozen export `a9ed7b4b5` (no `.git`; I could not verify that SHA). Document: `llp/1013-expo-arm.spec.md`. No tests, clones, agents, or tree edits. Claims checked against the named files.

## 1. Verdict

**READY WITH CHANGES** — apply the list below, then E1 may start on §3–§5. Not **READY TO DISPATCH**: §3 and decision 3 still tell the lane two schemas, and the `bytes` row cannot be inserted from `ByteDelta` as written. The architecture is the right one (sqlite through a driver, executor-scoped exclusive txn, JSON keys, split entries, Node journeys, publication elsewhere). Every round-1 blocker is folded; the fold introduced two E1 contradictions and left §7 under-instrumented (E2).

**Changes before E1**

1. One key layout: JSON of the tuple in the existing `key` column; delete decision 3’s `(kind, key)`.
2. Drop `bytes.type`, or state it is `state.assets[key].type` (`ByteDelta.put` has no type).
3. Driver `get` maps expo-sqlite `null` → `undefined`.
4. `build.mjs` externalizes `expo-sqlite` and `expo-secure-store` (same list as `expo-video` today).
5. `inProcessLocks` is one module-level `Map`; hold until the callback promise resolves (copy `indexeddb.ts:241–264`).
6. WAL pragma mismatch is recorded, not by itself `E_OFFLINE_CARRIER`. DELETE journal is atomic.
7. Strike `useAssetFile` / `witnessControl` from the §5 export list; those are E2.

## 2. Blocking design errors

None of the round-1 class remain (unimplementable channel, async `DatabaseSync.transaction`, NUL-truncated TEXT keys, missing executor, colon SecureStore keys, no `./react-native` subpath, provider cannot take a client, native media claimed with no bridge, “never opened” = `hydrating`).

Two **fold defects** that make §3–§5 not executable as written (they are why this is not READY TO DISPATCH):

**F1. Decision 3 and §3 specify different key layouts.** Decision 3: two columns `(kind, key)`. §3 SQL: `key TEXT NOT NULL`, `PRIMARY KEY (partition, key)`, no `kind`. §12 pins Exact 2 to “§3’s plain schema.” Pick the SQL.

**F2. `bytes.type TEXT NOT NULL` cannot be filled from `replace(state, bytes)`.** `ByteDelta.put` is `{ key, bytes }` (`snapback2/packages/snapback2/src/store/byte-cache.ts:23`, `:168`). MIME lives in `state.assets[key].type` (`:167`). IndexedDB stores `{ key, value: Uint8Array }` only (`store/indexeddb.ts:206`). Drop the column.

## 3. Decisions table

| # | Decision | Verdict | Change / cost |
|---|---|---|---|
| 1 | sqlite, exclusive txn, state rewrite + byte delta | **Agree** | `withExclusiveTransactionAsync` is the right Expo API. Whole-state v1, measure at Clique 10k before diffing. Cost: JS-thread hitch, not SQLite. Expo issues `BEGIN` (not `IMMEDIATE`) on the exclusive connection — wrap the API, do not nest `BEGIN IMMEDIATE` inside it. |
| 2 | driver + executor; Node owns BEGIN/COMMIT | **Agree** | Do not call `DatabaseSync.transaction()` with an async body. Pin the sqlite tests to Node 24 (`node:sqlite` is missing or flagged on 20; `build.mjs:57` still targets `node20`). |
| 3 | keys encoded, no NUL in sqlite | **Change** | JSON in `key` only. Cost: one encode/decode + the conformance rows already named. |
| 4 | one writer in-process; exclusive txn for a second process | **Agree** | Singleton `Map`, keyed by partition. Two processes unsupported, `SQLITE_BUSY` → `E_OFFLINE_CARRIER`. Rewrite `E_OFFLINE_LOCK` (“another tab”, `client-offline.ts:82–84`). |
| 5 | SecureStore, legal keys, 2 KB, cache, delete both | **Agree** | Tokens are 32-byte base64url (`identity.rs:427`), well under 2 KB. Accessibility: after-first-unlock, or a locked phone fails `load`. |
| 6 | `./react-native` + `./expo`; split core; `client` prop | **Agree** | Keep the `react-native` condition on `./react`. Purity test is the gate. `client` XOR construction options. |
| 7 | native byte bridge / `assetBytes` / `useAssetFile` | **Agree** (E2) | RN `Blob` cannot be built from a typed array. Do not leave `useAssetUrl` → `cache.get` → `new Blob([uint8])` (`byte-cache.ts:238`) on the native hit path. |
| 8 | Expo app beside web; shared reducers; no RN-web | **Agree** | Names in `templates/chat/react/src/chat/log.ts` already match. Pass `onTombstone` (web `main.tsx:9–16`) and a `viewOnce` predicate (web main has none; the journey does, `chat.test.ts:459`). `init.rs:55–59` is still `react \| none`. |
| 9 | host WS; app connects out; barrier before COMMIT | **Agree** on shape; **change** kill and verbs | Barrier after DML / before COMMIT: yes. `simctl terminate` is not a deterministic mid-COMMIT kill. Bake `EXPO_PUBLIC_*` at Metro bundle time, not at `simctl launch`. Four verbs cannot sign in, open a chat, send, or inject a 503. |
| 10 | never-opened chat through the twin | **Agree** | Matches LLP 1012 §12. Assert `partial`/`never-held` on a log that was never drained, separately. |
| 11 | Hermes bytecode of a Release build | **Agree** | The artifact is often `main.jsbundle` with HBC magic, not a `*.hbc` filename. Twin ceiling stays on the neutral bundle (`metrics/twin.jsonl`: 19,747 gzip). |
| 12 | journeys stay Node; witness is the simulator’s job | **Agree** | Conformance on Node in the gate; Expo driver inside the witness. |
| 13 | publication not this spec’s | **Agree** | `0.0.1`, no `./expo` yet (`package.json:7–28`). `dist/` link until then. |

## 4. Material findings

### Round-1 blockers vs (b)

| Source | Blocker | (b) |
|---|---|---|
| grok 1 / muse B1 / astra 6 | App-hosted WS + `simctl` port forward | **Resolved.** Host serves; app connects out. Simulator shares the Mac network; `adb reverse` is Android. |
| grok 2 | `DatabaseSync.transaction(async)` commits before the body | **Resolved.** Node driver `BEGIN IMMEDIATE`, `await body`, `COMMIT`/`ROLLBACK`. |
| grok 3 / astra 1 | NUL TEXT keys collapse rows | **Resolved** in intent; **F1** is the leftover spelling. JSON of `["messages","m\0x"]` stores no raw NUL. |
| astra 2 | no executor; exclusive vs not; statements on the outer handle | **Resolved.** `transaction(body: (tx) => …)`. Expo exclusive is a **separate connection** — any `driver.run` inside the body is not in that txn. Add a conformance row for that. |
| astra 3 / muse B2 | native `AssetImage`/`AssetVideo` are URL-only; RN Blob | **Resolved as E2** (decision 7). Still true of today’s code (`react-native.tsx:64–68, 84–89`; `byte-cache.ts:238, 288`). |
| astra 4 | no `./react-native` subpath; `export *` drags IndexedDB; no `client` prop | **Resolved.** Today: `package.json:17–24`, `react-native.tsx:8`, `react.tsx:14, 52–54, 103`. |
| astra 5 | `${key}:principal` (`token-store.ts:19`) | **Resolved.** |
| astra 7 | never-opened = `hydrating` (`witness-web.mjs:241–244`) | **Resolved** (decision 10). |
| muse B3 | “no BEGIN IMMEDIATE” vs §3; “no second process” | **Resolved** (decision 4). |

New from the fold: **F1, F2**; §5 lists E2 symbols; WAL still a hard open failure (muse’s compare-the-row was folded, grok’s “don’t refuse WAL” was not); §7 still says `--device <simulator>` (that flag is a physical device).

### Claims vs code (§1)

- **`RangeStoreBackend`**: `open / replace(state, bytes) / readBytes? / wipe / close` (`range-store.ts:323–331`). `readBytes` is optional; sqlite must implement it. Comment says one carrier transaction; only IndexedDB actually is (`indexeddb.ts:188–213`). File carrier: payloads → rename → removals plus sweep (`file.ts:43–70`).
- **IndexedDB per swap:** one `readwrite` txn over `rows, answers, outbox, meta, bytes`. Four state stores `clear` + `put` of `projections(state)` (`indexeddb.ts:95–121, 198–201`). Bytes are delta-only (`:18–19, 203–207`). Meta holds version, sealed, **clock** (not “clocks”), watermarks, grants, `currentGrant`, overlay, overlayMisses, bounds, programs, facts, superseded, **negative, rowSeq, assets**, viewed (`:102–119`). Shared `projection.ts` is the right extract; the round-trip test on `PersistedRangeState` is the contract. IDB is one database per partition (`:138–139`); one sqlite file + partition column is a real, good difference.
- **`react-native.tsx`**: `export *` from `react.js` then native `AssetImage` / `AssetVideo` (`:8–19, 93–106`). Image is RN `Image` with header `source`, not `expo-image`. `expo-file-system` is a peer because **uploads** import it (`assets.ts:168–178`), not because the RN components use it. Peers match `package.json:46–51`.
- **Locks:** injectable `locks.request(name, { ifAvailable: true }, cb)` held until `close` (`indexeddb.ts:241–264, 270`). File carrier: none (`file.ts:18–23`).
- **Token store:** `key` + `` `${key}:principal` `` (`token-store.ts:14–23`). Seal/wipe/partition-as-principal are client rules (`offline.ts:241–318`); do not reimplement.
- **Twin:** hashing is portable JS SHA-256 (`packages/evaluator/src/hash.ts:1–3, :70`) — no `TextEncoder`, no `crypto.subtle`. Twin **hydrate** does use `structuredClone` (`twin-hydrate.ts:95`), as do `range-store.ts:343` and `outbox.ts:231`. The parenthetical is true of hashing, not of the store.

Landing SHA: I could not verify (no `.git`).

### Simulator witness (§7)

The **instrument** — a barrier inside the exclusive transaction, after DML, before `COMMIT`, with a “reached” ack — is the right one. It is the sqlite analogue of `beforeRename` (`file.ts:61–62`), not of IDB `beforeReplace` (pre-txn, `indexeddb.ts:195–196`). The web witness sets a never-resolving fn and `waitForTimeout(500)` (`witness-web.mjs:270–273`); it does not hold a txn. The simulator witness is the first mid-commit kill in the tree if the ack is real.

**`simctl terminate` is not a deterministic kill inside sqlite’s COMMIT.** I could not verify the signal from this tree. Simulator terminate is SpringBoard/runningboard, typically not “freeze the JS stack at this line.” If JS is parked on the barrier promise, COMMIT has not been issued; process death closes the native connection and rolls back — **if the barrier does not resolve on WebSocket close**. Spec that: close/reject → `ROLLBACK`, never `COMMIT`. Then wait until the pid is gone before `simctl launch`.

For an abrupt kill: record the Mac pid of the simulator app and `kill -9`, then wait for exit. `simctl terminate` after a graceful unwind can let sqlite commit.

**Uglier-but-safer alternative:** (A) **File handshake** in the app container (`simctl get_app_container … data`): app writes `at-barrier`, polls `hold`; harness sees the file and `kill -9`. No socket. (B) Prove atomicity in Node: `kill -9` a `node:sqlite` child parked on `beforeCommit` (POSIX, same schema); on the simulator only kill **at rest** plus the fault-injecting driver. Weaker device story, honest evidence. Do not chmod only `snapback2.db` under WAL (the `-wal` file still writes).

Copy the web **order**: enqueue *completes*, then hold a *later* `replace`. Killing the enqueue’s own `replace` rolls the queued row back.

Four verbs (`offline`, `online`, `barrier`, `state`) cannot drive step 2, 7, or 8. Add UI automation or verbs for `as`, open-chat, send, view-asset, and the 503. Step 7 still asserts a second message without enqueueing one. Coverage/`state` cannot prove an image rendered. Persist the data-transport cut across relaunch, independently of the control channel.

`npx expo run:ios --device <simulator>` is the physical-device flag. Simulators are `--simulator "iPhone 16"`. `EXPO_PUBLIC_*` is inlined when Metro bundles, not when `simctl launch` sets env.

### expo-sqlite / Hermes (platform knowledge; none of this is in the tree)

| Claim | Fact |
|---|---|
| Async API | **True** at the peer floor: `openDatabaseAsync`, `runAsync`, `getFirstAsync`/`getAllAsync` (returns **`null`**, not `undefined`), `execAsync`, `withTransactionAsync`, `withExclusiveTransactionAsync`. |
| Transactions | **Exclusive is required** for an async body. `withTransactionAsync` is not isolated across awaits. Expo exclusive uses a **separate connection**; I could not verify from this tree whether it issues `BEGIN` or `BEGIN EXCLUSIVE` (astra r1 cited SDK 54 `BEGIN`). |
| BLOBs | **True:** bind/return `Uint8Array`. Do not base64. Whole blobs enter JS. Empty payload is the sharp case (some binders treat `[]` as NULL). |
| WAL on iOS | **Supported.** `PRAGMA journal_mode=WAL` returns a row; compare it. **Atomicity of one COMMIT does not need WAL.** WAL ⇒ `-wal`/`-shm`; iCloud backs up Documents unless excluded (`NSURLIsExcludedFromBackupKey`). |
| File location | `openDatabaseAsync(name)` → `SQLite.defaultDatabaseDirectory` (iOS: app Documents/`SQLite/`, not `Documents/snapback2.db`). Witness path = `get_app_container` + that relative path. |
| Size | SQLite `SQLITE_MAX_LENGTH` is 1e9. I could not verify that Android `CursorWindow` (~2 MB) applies to expo-sqlite’s bundled sqlite3 (it is not `android.database.sqlite`). Clique 10k + image BLOBs + whole-state JSON can still jetsam the JS heap; that is the §14 measurement. |
| `structuredClone` | Used on JSON-like state (`range-store.ts:343`). Expo SDK 54 winter polyfills it; claiming it is simply absent on Expo is false. I could not verify Hermes version history from this tree. |
| `TextEncoder` | Present at this RN floor; the twin hasher does not use it. |
| `crypto.subtle` SHA-256 | **Generally absent on Hermes.** Irrelevant: hashes are `hash.ts`. Do not add a subtle polyfill. |

JSON TEXT vs IDB structured clone: `JSON.stringify` drops `undefined` and turns `NaN`/`Infinity` into `null`. The named round-trip test is mandatory on the Node driver before the simulator.

expo-sqlite **web** is WASM and does not support exclusive transactions — a web run of the Expo app is not “a second `simctl` adapter” (conflicts with `rules/NOT-DOING.md:18–19` only as a later capability-bar item; leave it scheduled).

SSE needs `response.body.getReader()` (`sse.ts:47–48`). `createClient` defaults to `globalThis.fetch` (`client.ts:160`). `build.mjs:43` already externalizes `expo/fetch`; `createExpoClient` should pass it. I could not verify that Expo winter has already replaced global fetch before the first client construct.

### Lane tripwires the document does not say

1. `init.rs:55–59` cannot scaffold Expo; `build.mjs:142–146` copies only `react/`.
2. Omit `onTombstone` / `viewOnce` and expiry/view-once tests fail. Web `main.tsx` still has no `viewOnce`.
3. `E_OFFLINE_LOCK` rewrite is “another tab.”
4. One sqlite **connection** per process. Two `openDatabaseAsync` on one file + two exclusive writers ⇒ `SQLITE_BUSY`. Exclusive is database-wide, not per partition.
5. Fast Refresh / StrictMode: singleton locks + the provider’s deferred `close` (`react.tsx:87–123`) must still match. `createExpoClient()` in render leaks a lock-holding client.
6. Whole-state rewrite JSON-encodes every answer every swap; the phone hitch is why §14 exists.
7. `getFirstAsync` → `null`. Busy timeout: I could not verify expo-sqlite’s default; “fail loudly” may hang.
8. Exclude the db (and `-wal`/`-shm`) from iCloud backup.
9. Purity test must also externalize the new peers; bundling `expo-sqlite` into `dist/` will break Metro.
10. `useAssetUrl` in core still does `URL.createObjectURL` + `Blob` (`react.tsx:460–471`). E1 can land if nothing calls `ByteCache.get` with held bytes; E2 must not ship native screens on that path.
11. Witness `as="alice"`: `createExpoClient({ url })` is not a persona (`CreateClientOptions` in `types.ts:261–264`; web `main.tsx:19`).
12. Node 24 for `node:sqlite` vs gate `target: "node20"`.

## 5. Minor

- Systems path `snapback2/templates/chat` is `snapback2/packages/snapback2/templates/chat/`.
- §1 “clocks” → `clock`; name `negative`, `rowSeq`, `assets`, `superseded`, `currentGrant` or drop the list in favor of the shared projection.
- Composer copy: web shows “Queued; it sends when the connection returns” (`Composer.tsx:21`), not “queued until the next sync.”
- `expo-sqlite >= 15` is a plausible async-API floor under `expo >= 54`; I could not verify the SDK 54 exact version.
- Export `snapback2/expo/witness` (or dynamic `__DEV__` import) so production Metro DCE is not the only kill switch.
- File `close()` is sync (`file.ts:89–91`); the interface already allows that.
- Parameter style: keep `?` so both drivers bind the same SQL.
- Host “Xcode / iPhone” inventory: I could not verify; probe at runtime.

## 6. What you would delete

- §12 Exact 2 arm (keep a five-line trigger + “Rust carrier reads §3’s schema”).
- Repeated publication (§2.13, §10).
- Per-decision confidence percents.
- “the React hooks do not change” (they gain a `client` prop, a split, `assetBytes`, `useAssetFile`).
- `bytes.type` if `state.assets` already holds mime.
- WAL mismatch ⇒ `E_OFFLINE_CARRIER`.
- `npx expo run:ios --device <simulator>`.
- `useAssetFile` / `witnessControl` from the E1 export list.
- Decision 3’s `(kind, key)` spelling.

Net: fold succeeded on every r1 blocker. Close F1/F2 and the five E1 punch-list items, then dispatch E1. Do not dispatch E2 until §7 names a reached-then-`kill -9` (or file handshake) and the missing verbs.
