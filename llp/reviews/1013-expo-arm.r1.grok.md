# Blind design review — LLP 1013 revision (a)

Reviewer: grok-4.6. Frozen export `e134089e5`. Document: `llp/1013-expo-arm.spec.md`. No tests, no clones, no agents. Claims checked against the named files.

## 1. Verdict

**NOT READY** — three blocking design errors. The carrier-as-sqlite-plug, the Expo entry, shared reducers, Node journeys, and “publication is not this spec’s” are the right shape. Do not dispatch E1/E2 until §3’s driver/schema contracts and §7’s kill channel are rewritten.

## 2. Blocking design errors

**1. §7Review written to [`reviews/1013-r1-grok.md`](/Users/ccheever/projects/snapback-1012-impl/reviews/1013-r1-grok.md) (2,031 words).

# Blind design review — LLP 1013 revision (a)

Reviewer: grok-4.6. Frozen export `e134089e5`. Document: `llp/1013-expo-arm.spec.md`. No tests, no clones, no agents. Claims checked against the named files.

## 1. Verdict

**NOT READY** — three blocking design errors. The carrier-as-sqlite-plug, the Expo entry, shared reducers, Node journeys, and “publication is not this spec’s” are the right shape. Do not dispatch E1/E2 until §3’s driver/schema contracts and §7’s kill channel are rewritten.

## 2. Blocking design errors

**1. §7 control channel cannot be built as specified.** Hermes/React Native has a WebSocket *client*, not a TCP/WebSocket *server*. Nothing in `react-native.tsx`, `native-modules.d.ts`, or the Expo peers (`package.json:46–51`) listens on a port. `xcrun simctl` has no `adb`-style port forward. iOS Simulator processes share the Mac network, so the working direction is the one Metro already uses: the **app connects out** to a harness socket on the host.

The web witness is the precedent, and it is the opposite shape: Playwright injects `window.__witnessBarrier` and `window.__snapback` (`snapback2/scripts/witness-web.mjs:75–86, 92–94, 270–273`). There is no in-page server.

If a lane implements §7 as written they will either invent a native module (out of scope) or stall.

**2. The Node sqlite driver as specified does not hold a transaction across `await`.** §3’s `transaction(body: () => Promise<T>)` plus “`nodeSqliteDriver` wraps `DatabaseSync` in resolved promises” composes with Node’s `DatabaseSync#transaction(fn)` as: `BEGIN`; `fn()` (returns a Promise); `COMMIT`; then the body runs. The atomic-swap test and the `beforeCommit` barrier would be fiction. The driver **must** `BEGIN IMMEDIATE`, `await body()`, then `COMMIT`/`ROLLBACK` itself. It must not call `DatabaseSync.transaction()` with an async callback. Decision 3’s “no BEGIN IMMEDIATE dance” is about cross-process locking; it must not delete the swap’s `BEGIN IMMEDIATE`.

**3. Copying IndexedDB projection keys into SQLite TEXT will truncate at NUL.** `canonicalAnswerKey` / `rowKey` use U+0000 (`range-store.ts:354–360`). IndexedDB stores those strings as keys (`indexeddb.ts:87–101, 198–201`). SQLite TEXT bound with `nByte = -1` (`strlen`) stops at the first NUL: every row of a table collapses onto one key. I could not verify expo-sqlite’s bind length from this tree; the C default is `-1`. §3 currently says “insert the projections exactly as the IndexedDB carrier projects them.” Require either (a) a driver contract + test that `table\0id` round-trips, or (b) encode keys (JSON, or two columns `(table, id)`). Do not copy IDB keys blindly.

## 3. Decisions table

| # | Decision | Verdict | Change / cost |
|---|---|---|---|
| 1 | sqlite, one txn per swap, whole-state v1 | **Change** | Use `withExclusiveTransactionAsync`, not `withTransactionAsync` (decision 1 vs §3 contradict). Non-exclusive async txns interleave. Whole-state v1: agree, measure at Clique 10k before diffing. Cost: exclusive serializes the connection; correct. WAL is *not* required for atomic COMMIT (see below). |
| 2 | five-method driver, `node:sqlite` tests, expo-sqlite peer | **Change** | Keep the split. Pin Node (≥22.13 / 24; `node:sqlite` is missing or flagged on 20, and `build.mjs:57` still targets `node20`). Fix blocking #2. Cost: CI/engine pin; no npm sqlite. |
| 3 | one writer per process, in-process lock, no file lock | **Change** | Right for this app. The table **must be a process-wide singleton** (one `Map`), passed in like `navigator.locks` (`indexeddb.ts:268–284, 241–264`). A per-factory `Map` makes StrictMode and a second `createClient` both succeed. A second *process* can exist (extensions); v1 can refuse to care, but do not write “cannot exist.” Cost: one module-level table; rewrite `E_OFFLINE_LOCK` (“another tab”, `client-offline.ts:82–84`) for a phone. |
| 4 | `expo-secure-store`; partition = principal | **Agree** | `AuthTokenStore` already allows Promises (`types.ts:230–238`). Do **not** copy `key:principal` (`token-store.ts:19–23`): expo-secure-store rejects `:` on Android and may on iOS. Use `[A-Za-z0-9._-]`. Cost: a layout helper, not a client-rule change. |
| 5 | `snapback2/expo` = RN exports + store + tokens + `createExpoClient` | **Change** | There is **no** `snapback2/react-native` export. Metro takes `snapback2/react` via the `"react-native"` condition (`package.json:17–24`). `export * from "snapback2/react-native"` will not resolve. Add `"./react-native"` and `"./expo"`, or re-export from `./react-native.js`. `createExpoClient` filling `offline.store` / `tokenStore` is right; still require `onTombstone` / `viewOnce` (web `main.tsx:9–17`). |
| 6 | Expo app beside web; shared reducers; no RN-web | **Agree** | Web screens are DOM (`Inbox.tsx:11–22`, `Composer.tsx:30–41`). Reducers live in `…/templates/chat/react/src/chat/log.ts` (`conversations`, not `inboxRows`; `threadBubbles:79`). Cost: two view layers. Also teach `snapback2 init`: `--client` is only `react` \| `none` (`crates/snapback2/src/init.rs:55–59`). |
| 7 | simulator witness, barrier in `replace`, `simctl terminate`, WS channel | **Change** | Barrier *inside* `replace` after DML, before COMMIT: **yes** (stronger than IDB’s `beforeReplace`, which is *before* the txn, `indexeddb.ts:193–196`). Channel and kill: see blocking #1 and §4 below. Cost: reverse the socket (or files); `kill -9` the pid. |
| 8 | Hermes bundle size in `metrics/expo.jsonl`; 30 KB stays on the neutral twin | **Agree** | Twin is 19,747 gzip, `--platform=neutral --target=es2022` (`metrics/twin.jsonl`; `build.mjs:41–42`). Do not gate the 30 KB ceiling on `.hbc`. |
| 9 | journeys stay Node; witness is the only simulator job | **Agree** | Matches LLP 1012 §10. Android/web Expo runs wait. |
| 10 | publication not this spec’s; leave the package publishable | **Agree** | `0.0.1`, no `./expo` export yet (`package.json:7–28`). |

## 4. Material findings

### Claims vs code

- **`RangeStoreBackend`** is `open / replace(state, bytes) / readBytes? / wipe / close` (`range-store.ts:323–331`). `readBytes` is optional; sqlite must implement it. `replace` is “one carrier transaction” in the comment; only IndexedDB actually is (`indexeddb.ts:188–213`). The file carrier is payloads → rename → removals plus a sweep (`file.ts:43–70`).
- **IndexedDB per swap:** one `readwrite` txn over `rows, answers, outbox, meta, bytes`. The four state stores are `clear` + `put` of `projections(state)` (`indexeddb.ts:95–121, 198–201`). **Bytes are delta-only**, never cleared (`indexeddb.ts:18–19, 203–207`). §1’s “clear + put of every projected store, bytes in the same transaction” is half-right. There is no shared `project()`; it is local `projections()`. Meta holds watermarks, grants, overlay, programs, facts, assets, viewed — not separate tables. Sqlite can keep that if `meta` is the same blob; the `bytes.type` column is a fork (IDB bytes are `{key, value: Uint8Array}` only). IDB is **one database per partition** (`indexeddb.ts:138–139`); sqlite’s one file + partition column is a real, good difference — wipe is `DELETE WHERE partition`, not `deleteDatabase`.
- **`react-native.tsx`** re-exports `./react.js` and adds `AssetImage` / `AssetVideo` (`react-native.tsx:8–19, 93–106`). Images are RN `Image` with header `source`, not `expo-image`. `expo-video` is real. `expo-file-system` is a peer because **uploads** import it (`assets.ts:168–178`), not because the RN components use it. Peers match `package.json:46–51` (`expo >=54`, `expo-file-system >=19`, `expo-video >=2`, `react-native >=0.75`).
- **Locks:** injectable `locks.request(name, { ifAvailable: true }, cb)` held until `close` (`indexeddb.ts:241–264`). File carrier: no lock (`file.ts:18–23`).
- **Token store:** `key` + `` `${key}:principal` `` (`token-store.ts:14–23`). Seal/wipe/partition-as-principal are client rules (`offline.ts:241–318`); do not reimplement.
- **Twin:** no `window`/`document`/`node:` in `twin.ts` / `offline.ts` / `client.ts`. `react.tsx:506` uses `window.devicePixelRatio` (web `AssetImage`). File carrier is the `node:` exception. Twin hashes are **portable JS SHA-256**, not `crypto.subtle` (`packages/evaluator/src/hash.ts:1–3`).

Landing `4f5eef21f`: I could not verify (no `.git`).

### Simulator witness (§7)

The **instrument** (a barrier inside the carrier `replace`, after writes, before COMMIT) is the right one. It is the sqlite analogue of `beforeRename` (`file.ts:61–62`), not of IDB `beforeReplace` (pre-txn). The web witness also does not wait for the barrier; it sets a never-resolving fn and `waitForTimeout(500)` then kills the profile (`witness-web.mjs:270–273`). That is racy. A signal *from* the app (“I am in `beforeCommit`”) then a kill is the upgrade.

**`simctl terminate` is not a deterministic mid-COMMIT kill.** I could not verify the signal from this tree. On the simulator it is a SpringBoard terminate (typically SIGKILL, not synchronous, not “the JS stack is frozen at this line”). `terminate` after a graceful unwind can let sqlite commit. The harness must (1) hold the JS promise so the native txn stays open, (2) resolve the **pid** (simulator apps are Mac processes), (3) `kill -9`. Then wait until the pid is gone before `simctl launch`.

**Uglier-but-safer alternative:** (A) **File barrier** in the app container: `simctl get_app_container … data`, app creates `at-barrier` and polls `hold`; harness sees the file and `kill -9`. No socket, no native server. (B) Prove atomicity in Node: `kill -9` of a `node:sqlite` process parked on `beforeCommit` (POSIX, same schema); on the simulator only kill **at rest** plus unwritable-dir. Weaker device story, honest evidence. Do not chmod only `snapback2.db` under WAL (the `-wal` file still writes); make the directory unwritable.

Copy the web witness **order**: enqueue *completes*, then hold a *later* `replace`. Killing the enqueue’s own `replace` rolls the queued row back; §7 step 4 as written can be read either way.

`npx expo run:ios --device <simulator>` is the physical-device flag. Simulators are `--simulator "iPhone 17"`. Host “Xcode 26.6 / iPhone 17”: I could not verify.

### expo-sqlite / Hermes facts

| Claim | Fact |
|---|---|
| Async API | **True** for the peer floor (`openDatabaseAsync`, `runAsync`, `getFirstAsync`/`getAllAsync`, `execAsync`, `withTransactionAsync`, `withExclusiveTransactionAsync`). Map `null` → `undefined`. |
| Transactions | **Exclusive is required** for an async body. `withTransactionAsync` is not isolated across awaits. |
| BLOBs | **True:** bind/return `Uint8Array`. Do not base64. Whole blobs enter JS (same as IDB). |
| WAL on iOS | **Supported.** `PRAGMA journal_mode=WAL` usually returns `wal`. **Atomicity of one COMMIT does not need WAL**; DELETE journal is atomic too. Do not refuse `E_OFFLINE_CARRIER` solely because WAL cannot be set. WAL ⇒ extra `-wal`/`-shm`; iCloud will back up Documents unless excluded. |
| File location | `openDatabaseAsync(name)` uses `SQLite.defaultDatabaseDirectory` (iOS: app Documents/`SQLite/`, not “the document directory” as a single file path). Witness path = `get_app_container` + that relative path. |
| Size | No iOS CursorWindow. Android’s ~2MB window will break large `getAll` later (out of this spec, but “second adapter” is not free). Clique 10k + image BLOBs + whole-state rewrite can jetsam the JS heap; that is the §14 measurement. |
| `structuredClone` | **True** at `react-native >=0.75` (`range-store.ts:342–344`). State is JSON-like; bytes stay out of `clone()`. |
| `TextEncoder` | Present at this RN floor; **the twin does not use it**. |
| `crypto.subtle` SHA-256 | **Generally absent on Hermes.** Irrelevant: hashes are `hash.ts`’s JS SHA-256. Do not add a subtle polyfill. |

JSON TEXT vs IDB structured clone: `JSON.stringify` drops `undefined` and turns `NaN`/`Infinity` into `null`. Prove a golden `PersistedRangeState` JSON round-trip on the Node driver before the simulator.

## 5. Minor

- Systems path `snapback2/templates/chat` is actually `snapback2/packages/snapback2/templates/chat/`.
- `inboxRows` is `conversations` (`log.ts:17`).
- Decision 2’s driver omits `close()`; §3 includes it.
- `expo-sqlite >=15` is a plausible async-API floor under `expo >=54`; I could not verify the SDK 54 exact version.
- §7 “witnessControl ships in the package”: export `snapback2/expo/witness` so production Metro does not keep it because `createExpoClient` imported it. `__DEV__ && EXPO_PUBLIC_SNAPBACK_WITNESS` is the right kill switch; Metro DCE’s `__DEV__`.
- `createExpoClient({ url })` with no `as` / token does not become alice; the web template is `as="alice"` (`main.tsx:19`). The witness must pass `as`.
- File `close()` is sync (`file.ts:89–91`); the interface already allows that.

## 6. What you would delete

- §12 Exact 2 arm (keep a five-line pointer; it is not a lane).
- Repeated publication (§2.10, §5 last line, §10).
- “a second process cannot exist.”
- “`PRAGMA journal_mode=WAL` fails ⇒ `E_OFFLINE_CARRIER`.”
- `bytes.type` if `state.assets` already holds mime (IDB does).
- “WebSocket server” / “simctl port forwarding.”
- `withTransactionAsync` in decision 1 (keep exclusive only).
- Host inventory “Xcode 26.6 / iPhone 17 today.”
- Per-decision confidence percents.
- “exactly as IndexedDB `clear`+`put`” for **bytes** (they are a delta).
- `export * from "snapback2/react-native"` until that path exists.

## Lane tripwires the document does not say

1. `init.rs` cannot scaffold Expo.
2. Omit `onTombstone` / `viewOnce` and expiry/view-once tests fail like the web app without `main.tsx:9–17`.
3. `E_OFFLINE_LOCK` rewrite is “another tab.”
4. Secure-store key charset (`:`).
5. Exclude the db from iCloud backup (`NSURLIsExcludedFromBackupKey`).
6. One sqlite *connection* for the process (two `openDatabaseAsync` on one file + two writers ⇒ `SQLITE_BUSY`).
7. `getFirstAsync` returns `null`, not `undefined`.
8. Fast Refresh / StrictMode: singleton locks + the provider’s deferred `close` (`react.tsx:87–123`) must still match.
9. Whole-state rewrite JSON-encodes every answer/receipt every swap; main-thread hitch on a phone is the real reason to measure before diffing.
10. The Expo driver is otherwise untested if only `node:sqlite` runs in package tests — add a BLOB + rollback smoke to the simulator run, not only the §10 list.
