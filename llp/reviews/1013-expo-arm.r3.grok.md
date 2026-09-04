# Blind design review — LLP 1013 revision (c)

Reviewer: grok-4.6. Frozen export `REPO=/Users/ccheever/projects/snapback-1012-impl/capsules/1013-r3` (no `.git`; I could not verify SHA `94d39b323`). Document: `llp/1013-expo-arm.spec.md`. No tests, clones, agents, remote commands, or tree edits. Round-2 artifacts: `reviews/1013-r2-{astra,grok,muse}.md`.

## 1. Verdict

**READY WITH CHANGES** — fold the list below, then E2 may start. Not **READY TO DISPATCH**. Architecture is right; every round-1 blocker and the r2 E1 contradictions (F1/F2, `expo/fetch`, one emitted context, Metro-time URL, isolated `./expo/witness`, no `bytes.type`) are folded. NoWrote the review to [`reviews/1013-r3-grok.md`](/Users/ccheever/projects/snapback-1012-impl/reviews/1013-r3-grok.md) (2,438 words). Full text:

# Blind design review — LLP 1013 revision (c)

Reviewer: grok-4.6. Frozen export `REPO=/Users/ccheever/projects/snapback-1012-impl/capsules/1013-r3` (no `.git`; I could not verify SHA `94d39b323`). Document: `llp/1013-expo-arm.spec.md`. No tests, clones, agents, remote commands, or tree edits. Round-2 artifacts: `reviews/1013-r2-{astra,grok,muse}.md`.

## 1. Verdict

**READY WITH CHANGES** — fold the list below, then E2 may start. Not **READY TO DISPATCH**. Architecture is right; every round-1 blocker and the r2 E1 contradictions (F1/F2, `expo/fetch`, one emitted context, Metro-time URL, isolated `./expo/witness`, no `bytes.type`) are folded. No new carrier error. E2 is unfinished: §7 cannot prove what it asserts, and decision 7 still puts view-once bytes on disk the carrier will not index.

**E2 may not start on (c) as written.**

**Changes before E2**

1. After “barrier reached”, record the simulator app pid, `kill -9`, wait until gone, then `simctl launch`. The barrier must not resolve on WebSocket close (close/reject → `ROLLBACK`, never `COMMIT`). Drop “the pre-swap case is expected” unless that kill is in place. Keep Node `kill -9` as COMMIT-atomicity evidence.
2. Persist the transport cut (and the persona) in the same app-container file as `fault`, restored *before* `createClient`; or stop the owner in step 4. Enqueue must *complete*, then hold a *later* `replace`. Do not call `coverage()`/`state` while the barrier is held (`range-store.ts:1109` waits on the tail).
3. View-once bytes are session-only (`byte-cache.ts:203–208, :278–286`): never write them to the durable cache directory; first play uses a session temp that dies with the process; URI paths consult `viewed`, seal, and partition; sweep orphan files on open (`file.ts:93–105`).
4. Twin bar: `send` into the never-opened thread; assert `predicted` on that thread’s *query result*, not a pending bubble `threadBubbles` can synthesize from the outbox alone (`log.ts:103–108`).
5. Bake `EXPO_PUBLIC_SNAPBACK_URL` at the same Metro time as the witness URL (owner already up). `localhost` is the Mac on the iOS simulator; I could not verify a physical-device story from this tree.
6. Copy web `onTombstone` (`templates/chat/react/src/main.tsx:11–16`) and a `viewOnce` predicate (schema has no marker, `schema.q:58–66`; the journey keys by id, `chat.test.ts:459`). Composer copy is `Composer.tsx:21`, not “queued until the next sync.”
7. If E1 did not: `build.mjs` must externalize `expo-sqlite` and `expo-secure-store` (today: `expo-file-system`, `expo/fetch`, `expo-video`, `build.mjs:43`).

## 2. Blocking design errors

None of the round-1 / r2-E1 class remain in the carrier schema. Three E2-scoped defects make §6–§8 not executable as written:

**B1. `simctl terminate` plus “pre-swap is expected” is not a deterministic rollback proof.** Decision 9 splits Node `kill -9` (atomicity) from the simulator (app list) and admits terminate cannot freeze JS (`llp/1013-expo-arm.spec.md:173–176`), then still expects pre-swap (`:176`, §7 step 4 `:315–316`). I could not verify the signal from this tree. If COMMIT wins, a green run is post-swap and still “no mix”; if the lane asserts pre-swap, it flakes. The in-txn barrier after DML / before COMMIT *is* the right instrument (analogue of `beforeRename`, `file.ts:61–62`, not of IDB `beforeReplace`, which runs *before* the txn, `indexeddb.ts:195–196`). JS must stay parked until death; WS close must not resolve the barrier.

**B2. Step 4 relaunches with the owner still up and no persisted transport cut.** `fault` is persisted (`:177–178`); `offline` is not. `createClient` reconnects unless `startOffline` is set (`client.ts:165`), so relaunch drains the two queued sends and “the queued message are there” (`:316`) is not an offline-durability assertion. The web witness cold-starts with the owner cut (`witness-web.mjs:231–238`). Control-before-construct (`:168–169`) can restore the cut — the spec never says it does. §6 constructs `createExpoClient({ url })` immediately (`:296`), which fights “connect, then `login`, then construct.”

**B3. Decision 7’s file URI is a durable store for bytes the carrier may never have.** `ByteCache.get` returns `Blob`; `put` needs `blob.arrayBuffer()` (`byte-cache.ts:238, :288`). RN `Blob` cannot be built from a typed array — the byte paths are required. View-once payloads are *not* in `bytes.remove`; they live in the session map (`:203–208, :278–286`). Writing them under `<cache>/snapback2/<partition>/<byteKey>` plus “plays from the file URI when cached” (`:150–151`) leaves a leftover that step 4 (`:318`) will re-show unless every URI path consults `viewed` first (`client-assets.ts:43–46, :72–76`). File deletes cannot join the sqlite txn. Native screens must not stay on `useAssetUrl` → `Blob` → `URL.createObjectURL` (`react.tsx:460–471`).

## 3. Decisions table

§2 has **thirteen** decisions, not ten.

| # | Decision | Verdict | Change / cost |
|---|---|---|---|
| 1 | sqlite, exclusive txn, state rewrite + byte delta | **Agree** | Expo exclusive is a **separate connection** and issues plain `BEGIN`; first DML takes the write lock. Do not nest `BEGIN IMMEDIATE` inside it. Measure at Clique 10k before diffing. Cost: JS-thread hitch, not SQLite. |
| 2 | driver + executor; Node owns BEGIN/COMMIT | **Agree** | Pin sqlite tests to Node 24 (`node:sqlite` missing/flagged on 20; `build.mjs:57` still `target: "node20"`). Conformance “second executor blocks” = a **competing write on another connection** (WAL readers are concurrent). |
| 3 | JSON of the tuple in one `key` column | **Agree** | F1 is gone. Keep adversarial round-trips (NUL, quotes, unicode, empty id). |
| 4 | in-process singleton Map; exclusive txn for a second process | **Agree**, narrower busy claim | Concurrent writers → `SQLITE_BUSY` → `E_OFFLINE_CARRIER`. Two processes that **load S then commit sequentially** are lost-update, not busy — “unsupported in v1” is the policy. Rewrite `E_OFFLINE_LOCK` (“another tab”, `client-offline.ts:82–84`). Hold the lock until the callback promise resolves (copy `indexeddb.ts:241–264`). |
| 5 | SecureStore, legal keys, 2 KB, cache, delete both | **Agree** | Tokens are 32-byte base64url (`identity.rs:427`; 43 chars in tests). Accessibility: after-first-unlock, or a locked phone fails `load`. I could not verify a universal 2 KB cap from this tree. |
| 6 | `./react-native` + `./expo`; `react-core` chunk; `client` prop; `expo/fetch`; never `tokenStore` beside `as` | **Agree** | Mixed-import test against **built** entries is the gate. Keep the `react-native` condition on `./react`. `client` XOR construction options (`types.ts:261–264`). |
| 7 | native byte bridge / `assetBytes` / `useAssetFile` | **Change** per B3 | Do not wrap `assetBlob` (`client.ts:321–323` → `response.blob()` at `client-upload.ts:127`). Session-only media, startup sweep, seal invalidation. Cost: days of custody, not new architecture. |
| 8 | Expo app beside web; shared reducers; no RN-web | **Agree** | Names in `log.ts` match (`conversations:17`, `threadBubbles:79`, `searchHeld:120`, pending `ids[0] ?? intent` `:87–89`). Add `onTombstone` / `viewOnce`. `init.rs:55–59` is still `react \| none`; `build.mjs:142–146` copies only `react/`. |
| 9 | Node `kill -9` atomicity; simulator app list; outward WS; Metro-time URL | **Agree** on the split; **change** the simulator kill and relaunch per B1/B2 | Barrier after DML / before COMMIT: yes. Four-verb hole is folded. Cost: small harness change. Uglier-but-safer: file handshake in `simctl get_app_container … data` (`at-barrier` / `hold`), then `kill -9`. |
| 10 | never-opened chat through the twin | **Agree**; **change** the observation | Assert `predicted` on the query, and `partial`/`never-held` on a log that was never drained, separately. |
| 11 | Hermes bytecode of a Release/`expo export` build; package source maps | **Agree** | Inspect the artifact (often `main.jsbundle` with HBC magic, not `*.hbc`). Twin ceiling stays on the neutral bundle (`metrics/twin.jsonl` tail: 19,747 gzip). Today `build.mjs:29–45` emits no source maps. |
| 12 | journeys stay Node; witness is the simulator’s job | **Agree** | Expo web is not a second `simctl` adapter: exclusive txns are unsupported on expo-sqlite’s WASM web build; LLP 1012 §4 already forbids WASM. |
| 13 | publication not this spec’s | **Agree** | `0.0.1`, no `./expo` yet (`package.json:7–28`). `dist/` link until then. |

## 4. Material findings

### Round-2 vs (c)

| Source | Finding | (c) |
|---|---|---|
| grok F1 / muse / astra keys | `(kind,key)` vs §3 SQL | **Resolved.** One `key TEXT`, JSON of the tuple. |
| grok F2 / muse `bytes.type` | `bytes.type NOT NULL` | **Resolved.** MIME in `state.assets` (`byte-cache.ts:23, :167`; IDB `:206`). |
| astra B1 | `expo/fetch`; no token store beside `as` | **Resolved** (decision 6). `client.ts:155–160`; SSE needs `body.getReader()` (`sse.ts:47–48`). |
| astra B2 | duplicated `createContext` | **Resolved** (`react-core` entry + mixed-import test). Today: four entries, no splitting, `build.mjs:29–45`; context at `react.tsx:50`. |
| astra B3 / muse B2 | witness URL at launch; `--device`; in-memory fault | **Resolved** as Metro-time URL, `--simulator`, persisted `fault`, control before construct. |
| grok/muse B1 | `simctl terminate` not a mid-COMMIT kill | **Partial.** Node `kill -9` is the right evidence (now E1). Simulator still terminate + expected pre-swap → **B1**. |
| grok verbs / second enqueue | four verbs; no second send | **Resolved** in the verb list; step 3 sends two. Enqueue-then-later-swap still implicit → **B2**. |
| grok/astra/muse WAL | mismatch ≠ `E_OFFLINE_CARRIER` | **Unresolved.** §3 still refuses (`:231–233`); conformance says recorded, not required (`:259–260`). E1 already dispatched. |
| grok externalize new peers | `expo-sqlite` / `expo-secure-store` | **Unresolved** in the text. E2 Metro-breaks if E1 bundled them. |
| astra exclusive = `BEGIN` | not `BEGIN IMMEDIATE` on Expo | **Resolved** in decisions 1–2; leftover lie in the `SqliteDriver.transaction` comment (`:248`). |
| astra/muse byte custody | session files, crash sweep, seal | **Unresolved** → **B3**. |
| grok/astra template wiring | `onTombstone` / `viewOnce` / Composer / `init.rs` | **Unresolved** (E2). |
| astra `structuredClone` / HBC / source maps | false platform claims | **Resolved.** |
| muse `witnessControl` on `./expo` | production entry | **Resolved** (`./expo/witness`). |

No new E1 schema error. New E2 errors are B1–B3 (the fold narrowed the kill claim, then over-claimed it).

### Claims vs code (§1)

- **`RangeStoreBackend`**: `open / replace(state, bytes) / readBytes? / wipe / close` (`range-store.ts:323–331`). Only IndexedDB is actually one txn (`indexeddb.ts:188–213`). File: payloads → rename → removals plus sweep (`file.ts:43–70`).
- **IndexedDB per swap:** one `readwrite` txn; four state stores `clear` + `put` of `projections(state)` (`indexeddb.ts:95–121, :198–201`); bytes delta-only (`:18–19, :203–207`). Meta is **`clock`** (not “clocks”) plus watermarks, grants, `currentGrant`, overlay, overlayMisses, bounds, programs, facts, superseded, **negative, rowSeq, assets**, viewed (`:102–119`). IDB is one database per partition (`:138–139`); one sqlite file + partition column is a real difference. Shared `projection.ts` is the right extract.
- **`react-native.tsx`**: `export *` from `react.js` then native `AssetImage` / `AssetVideo` (`:8–19, :93–106`). RN `Image` with header `source`, not `expo-image`. `useAssetUrl` can consult the cache if `URL.createObjectURL` exists (`react.tsx:460–461`); native still does not fill the cache or `markViewed`. `expo-file-system` is a peer because **uploads** import it (`assets.ts:168–178`). Peers match `package.json:46–51`. No `./react-native` subpath yet (`package.json:17–24`).
- **Locks:** injectable `request(..., { ifAvailable: true }, cb)` held until `close` (`indexeddb.ts:241–264`). File carrier: none. **Token store:** `key` + `` `${key}:principal` `` (`token-store.ts:14–23`); seal/wipe are client rules (`offline.ts:241–318`). Provider has no `client` prop (`react.tsx:52–54, :83`).
- **Twin:** 19,747 gzip, `--platform=neutral --target=es2022` (`metrics/twin.jsonl`; `build.mjs:41–42`). Hashing is portable JS (`packages/evaluator/src/hash.ts:1–3, :70`). Hydrate/store/outbox **do** `structuredClone` (`twin-hydrate.ts:95`; `range-store.ts:343`; `outbox.ts:231`). The (c) parenthetical (Expo winter; initialize before construct) is true.

Landing SHA: I could not verify (no `.git`).

### Simulator witness (§7)

The **instrument** — a barrier inside the exclusive transaction, after DML, before `COMMIT`, with a “reached” ack — is the right one. The web witness sets a never-resolving fn and sleeps 500 ms (`witness-web.mjs:270–273`); it does not hold a txn. The Node child parked on `beforeCommit` is the first honest mid-commit kill in the tree.

**`simctl terminate` cannot kill inside sqlite’s COMMIT deterministically.** Process death rolls back only if the barrier does not resolve on WS close — (c) still does not say that. **Uglier-but-safer:** (A) pid + `kill -9` + wait; (B) file handshake in the app container (`at-barrier` / `hold`), then `kill -9`. Do not chmod only `snapback2.db` under WAL. Coverage/`state` cannot prove an image rendered. Web still asserts never-opened as `hydrating` (`witness-web.mjs:241–244`); do not copy that.

### expo-sqlite / Hermes (platform knowledge; none of this is in the tree)

Async API **true** at this floor (`openDatabaseAsync`, `runAsync`, `getFirstAsync`/`getAllAsync` returns **`null`** — folded, `withExclusiveTransactionAsync`). Exclusive is **required** for an async body; it uses a **separate connection** and, on SDK 54, issues plain `BEGIN` (astra r2; I could not verify from this tree) — outer-handle `run` is not in that txn. BLOBs: bind/return `Uint8Array`; empty payload is the sharp case (already in conformance). WAL on iOS **supported**; one COMMIT does not need it; sidecars are `-wal`/`-shm`; (c) correctly does not delete them on partition wipe. File location: Documents/`SQLite/` (folded). Size: `SQLITE_MAX_LENGTH` 1e9; Android `CursorWindow` (~2 MB) is `android.database.sqlite`, **not** expo-sqlite’s bundled sqlite3; Clique 10k + BLOBs + whole-state JSON can still jetsam JS — that is §14. `structuredClone`: Expo SDK 54 winter polyfills it (I could not verify Hermes history from this tree). `TextEncoder` present, unused by the hasher. `crypto.subtle` SHA-256 **generally absent on Hermes** and irrelevant (`hash.ts`). JSON TEXT drops `undefined` and nulls `NaN`/`Infinity`; the named round-trip test is mandatory on Node before the simulator.

### Lane tripwires the document does not say (E2 will hit)

1. `init.rs:55–59` cannot scaffold Expo; `build.mjs:142–146` copies only `react/`. Witness `templates/chat/expo/`, not `dist/templates`.
2. Web `Thread.tsx:36–38` renders `[photo]`/`[clip]` text. Expo screens must grow media UI the web template does not have; `viewOnce` is a client predicate, not a column.
3. `login(name)` is persona reconstruction (`as`), not `auth.login`. Provider identity includes `as` (`react.tsx:92`).
4. `byteKey` is `assetId` or `assetId.w${width}` (`byte-cache.ts:57–58`) — filesystem-safe; partition strings in the cache path may not be.
5. One sqlite connection per process; exclusive is database-wide. Two handles + two writers ⇒ `SQLITE_BUSY`.
6. StrictMode / Fast Refresh: singleton locks + deferred `close` (`react.tsx:87–123`). `createExpoClient()` in render leaks a lock-holding client. Whole-state JSON-encode is the §14 hitch.
7. I could not verify expo-sqlite’s busy-timeout default (“fail loudly” may hang). Exclude the db, `-wal`/`-shm`, and the byte-bridge directory from iCloud backup. Node 24 vs gate `target: "node20"`. I could not verify Xcode / iPhone inventory; probe at runtime.

## 5. Minor

- Systems path `snapback2/templates/chat` is `snapback2/packages/snapback2/templates/chat/`. §1 “clocks” → `clock`.
- `SqliteDriver.transaction` comment still says “BEGIN IMMEDIATE (exclusive on Expo)” (`:248`). Keep `?` so both drivers bind the same SQL. File `close()` may be sync (`file.ts:89–91`).
- `__DEV__`-guard the `snapback2/expo/witness` import. `expo-sqlite ^16` / `expo-secure-store ^15` is the SDK 54 line astra cited; I could not verify it from this tree.

## 6. What you would delete

- Per-decision confidence percents; repeated publication (§2.13, §10); §12 Exact 2 beyond a five-line trigger + “Rust carrier reads §3’s schema.”
- “the React hooks do not change”; WAL mismatch ⇒ `E_OFFLINE_CARRIER`; “the pre-swap case is expected” after `simctl terminate`; the `SqliteDriver` comment that Expo exclusive is `BEGIN IMMEDIATE`; Composer string “queued until the next sync.”

Net: (c) is a successful E1 fold and a partial E2 fold. Dispatch E2 only after B1–B3 and the seven-item punch list are in the spec. Do not treat a green `simctl terminate` run on (c)’s step 4 as LLP 1012 §10 durability evidence; that evidence is the Node `kill -9` child, already in E1.
