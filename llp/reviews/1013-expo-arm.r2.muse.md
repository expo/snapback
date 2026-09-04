Note: this session has filesystem writes disabled, so I could not create `/Users/ccheever/projects/snapback-1012-impl/reviews/1013-r2-muse.md`. The full review (under 2,500 words) follows — paste it to that path verbatim.

---

# Blind design review — LLP 1013 revision (b), the Expo arm

Reviewer: Muse. No agents, no tests, no tree modifications. Frozen export `REPO=/Users/ccheever/projects/snapback-1012-impl/capsules/1013-r2` (no `.git`; landing claim a9ed7b4b5 I could not verify). All `path:line` citations are repo-relative (`snapback2/packages/snapback2/...` unless noted). "I could not verify" is stated where true. Round-1 reviews read: `reviews/1013-r1-{muse,grok,astra}.md`.

## 1. Verdict: NOT READY

Revision (b) resolves every round-1 carrier/entry/key/transport blocker in substance (details in §2). What remains is narrower but still blocking: the §7 kill instrument as specified cannot prove what §7 claims, and the §7 URL-delivery mechanism as written does not reach a prebuilt simulator binary. E1 (§3–§5) could start after the small corrections in §4; E2 cannot as written. Two blocking design errors (B1, B2).

## 2. Blocking design errors

**B1. `simctl terminate` after "barrier reached" is still not a deterministic mid-commit kill, so a green step 4 does not prove atomicity.** The in-transaction barrier (decision 9; §7 step 4) is the right instrument — strictly stronger than the web precedent, whose `beforeReplace` runs *before* the transaction opens (`src/store/indexeddb.ts:195-196`; `witness-web.mjs:270-273` sleeps 500 ms with no reached-acknowledgement, and its "holds the transaction open" comment is false). But `xcrun simctl terminate` is an asynchronous SpringBoard terminate, not a synchronous freeze of the JS thread at the barrier line; delivery timing is unbounded, so the COMMIT may land before the SIGKILL does and the run still looks green. I could not verify signal synchrony from this tree (no simulator here); this is platform knowledge the lane must confirm. Fix, as both round-1 reviews said: hold the JS promise across the barrier, resolve the simulator-app pid, `kill -9` the pid, wait until the pid is gone, then `simctl launch`. Keep `terminate` only as a scheduled variant. Cost: a few lines in `scripts/witness-expo.mjs`.

**B2. `EXPO_PUBLIC_SNAPBACK_WITNESS` set at *launch* time cannot reach the app that was *built* once.** §7 builds once (`npx expo run:ios --device <simulator>`) then "launch[es] the app with `EXPO_PUBLIC_SNAPBACK_WITNESS=ws://...`". `EXPO_PUBLIC_*` values are inlined at bundle/Metro time, not read from the launch environment of a prebuilt binary, so the witness client never learns the harness URL and steps 3–9 stall. (Separately, `--device` is the physical-device flag; simulators take `--simulator` — the round-1 correction was not folded.) Fix: pin a fixed harness port and set the var at build/Metro-server time, or pass the URL at runtime (launch argument, deep link, or dev-server query) and read it with `Constants`/linking rather than `EXPO_PUBLIC_*`. I could not verify Expo env inlining from this tree (no Expo sources vendored); the lane confirms with a one-line sentinel probe. Cost: small.

## 3. Round-1 blockers: resolved or not, and new errors from the fold

Muse-B1 / Grok-#1 / Astra-#6 (in-app WS *server* + `simctl` port forwarding): **resolved**. Decision 9 reverses the channel — harness serves, app connects outward — and drops forwarding ("the simulator shares the host's network"). Correct direction.

Muse-B2 / Astra-#3 (no byte bridge; RN `Blob` rejection): **resolved in scope, gaps remain as §4 items**. Decision 7 adds `assetBytes` + `useAssetFile` file bridge, acknowledges the RN `Blob` constructor rejection (`src/store/byte-cache.ts:238` builds `new Blob([typed array])`; `put` needs `blob.arrayBuffer()`, `:288`), and assigns view-once consumption to view time. Remaining: `type`-column derivation and the view-once file path (§4).

Muse-B3 (lock self-contradiction; "no second process"): **resolved**. Decision 4 keeps the process-wide singleton lock table *and* the exclusive transaction, and reframes two processes as unsupported-but-loud (`SQLITE_BUSY` → `E_OFFLINE_CARRIER`) instead of impossible. Right.

Grok-#2 (Node driver committing before the async body runs): **resolved**. Decision 2 names the exact fix: `BEGIN IMMEDIATE`, await body, `COMMIT`/`ROLLBACK` itself; must not call `DatabaseSync.transaction()` with an async callback.

Grok-#3 / Astra-#1 (NUL-separated keys collapse in SQLite TEXT): **resolved**. Decision 3 encodes keys as JSON (`["messages","m1"]`), schema stores them in `(kind, key)`/`key` TEXT columns, conformance round-trips them. NUL never reaches sqlite.

Astra-#2 (no transaction-scoped executor): **resolved**. §3's `SqliteDriver.transaction(body: (tx) => Promise<T>)` with all statements on `tx` is exactly the required shape.

Astra-#4 (no `./react-native` subpath; IndexedDB re-exported; no `client` prop): **resolved in design**. Decision 6 adds real `./react-native` + `./expo` exports (today only the `react-native` *condition* on `./react` exists, `package.json:17-24`), splits `react-core.tsx` from carriers/components, adds the `client` prop (today `SnapbackProvider` takes `CreateClientOptions` and builds its own client, `src/react.tsx:52,83`), and keeps the purity test. True that `react-native.tsx:8` currently re-exports `./react.js` including `indexedDbRangeStore` (`src/react.tsx:14`) — the split is the correct fix.

Astra-#5 (`` `${key}:principal` `` illegal in SecureStore): **resolved**. Decision 5 uses `snapback2.<name>.token`/`.principal` (`[A-Za-z0-9._-]`), deletes both keys, caches reads. Matches the current `src/token-store.ts:19-23` colon layout it replaces.

Astra-#7 (never-opened chat asserted as `hydrating`): **resolved**. Decision 10 requires render-through-twin plus predicted send (LLP 1012 §12) and asserts `partial`/`never-held` separately for genuinely absent coverage. (Note the web witness still asserts the old `hydrating` line at `witness-web.mjs:241-244`; that staleness is the web harness's, not this spec's.)

**New errors the fold introduced or retained:** (a) WAL-mismatch refusal (§4, retained despite round-1 correction); (b) `bytes.type NOT NULL` with no derivation (`ByteDelta` carries `{key, bytes}` only, `src/store/byte-cache.ts:23`); (c) `witnessControl` exported from the production `./expo` entry (§5) instead of an isolated dev subpath; (d) B2's launch-time env; (e) §7 step 7's missing second enqueue (the web witness explicitly enqueues a second message, `witness-web.mjs:257-262`; the Expo steps never do, so "the second message commits in order" is unexecutable); (f) `--device <simulator>` flag carried over. None of (a)–(f) except B1/B2 is individually blocking; together they are E2's punch list.

## 4. Decisions table (§2 has thirteen decisions in (b), not ten)

| # | Decision | Agree / change | Cost |
|---|---|---|---|
| 1 | sqlite, exclusive tx/swap, state rewrite + byte delta | Agree; keep the §14 Clique swap-time gate with keyed-diff fallback pre-designed | Small now, maybe days later |
| 2 | driver owns tx, passes executor; Node driver manual BEGIN/COMMIT; conformance both drivers | Agree; pin exact `expo-sqlite` peer; record the `DatabaseSync`-sync vs exclusive-async fidelity gap in the driver contract | Low |
| 3 | JSON-encoded keys | Agree; add adversarial samples (commas, quotes, unicode, empty id) to the named round trip | Trivial |
| 4 | singleton in-process locks + exclusive tx; 2nd process loud, unsupported | Agree; rewrite `E_OFFLINE_LOCK` copy ("another tab", `src/client-offline.ts:82-84`) for a phone | ~Zero |
| 5 | SecureStore legal keys, 2 KB, cached reads | Agree; verify the 2 KB limit and the accessibility constant against the pinned SDK (I could not verify either from this tree) | Low |
| 6 | `./react-native` + `./expo`, core/carrier split, `client` prop, purity test | Agree, minus `witnessControl` in `./expo` — move to `snapback2/expo/witness` so production Metro drops it | Low |
| 7 | byte bridge (`assetBytes`, `useAssetFile` file://, evict/wipe, view-once at view time) | Agree in direction; **change:** derive `type` from `state.assets` (or drop the column — IDB stores `{key, value}` only, `src/store/indexeddb.ts:203-207`); specify how removals evict files and how a view-once clip plays when its bytes are session-only (`src/store/byte-cache.ts:278-286` never persist them) | Material (days) |
| 8 | Expo app + shared reducers from `chat/log.ts` | Agree (`conversations:17`, `threadBubbles:79`, `searchHeld:120`, pending keyed `ids[0] ?? intent`, `:87-89` — the names check out); add `init.rs --client` (`react\|none` only) and `main.tsx:11,19` (`onTombstone`, `as="alice"`) wiring to the lane | Medium |
| 9 | outward-connect witness, in-tx barrier, terminate at barrier, fault-wrapper, twin assertion | **Change** per B1/B2 + add the missing second enqueue + name the UI-automation (or extra verbs) for sign-in/navigate/send/swap-selection/503 | Small rework of §7 |
| 10 | never-opened renders via twin; partial separately | Agree | Trivial |
| 11 | Hermes `.hbc` measurement; twin ceiling on neutral | Agree — the `expo export`-emits-JS correction is correctly folded | Low |
| 12 | journeys stay in Node; simulator only for witness | Agree | — |
| 13 | publication out of scope; `dist/` link meanwhile | Agree; keep the "by name" resolution story one line longer | Trivial |

## 5. Material findings

**Code-claim audit (§1): mostly true, two caveats.** The `react-native` condition/peers/native-component claims verify (`package.json:17-24,46-51`; `src/react-native.tsx:19-70,95-106` never touch the cache). `RangeStoreBackend`, IndexedDB per-swap (`src/store/indexeddb.ts:190-213`, delta-only bytes `:18-19,203-207`, pre-txn `beforeReplace :195`), file-carrier ordered-write-plus-sweep (`src/store/file.ts:43-70,93-105`), NUL keys (`src/store/range-store.ts:354-360`), `Blob` in/out (`src/store/byte-cache.ts:228-239,288`), `${key}:principal` (`src/token-store.ts:19-23`), injectable locks (`src/store/indexeddb.ts:241-284`), twin 19,747 gzip (`metrics/twin.jsonl` tail) built neutral/es2022 (`build.mjs:41-42`), and pure-TS SHA-256 (`packages/evaluator/src/hash.ts:1`, own UTF-8, no `TextEncoder`/`crypto.subtle`) all check out. Caveats: (i) §1's meta-field list omits `negative`, `rowSeq`, `assets`, `currentGrant`, `superseded` (cf. `src/store/indexeddb.ts:100-121`) — §3's shared-projection + round-trip test covers it, fix the list; (ii) "no `structuredClone` on the twin's path" I could not verify from reads — `structuredClone` appears in `range-store.ts:343`, `store/outbox.ts:231`, `twin-hydrate.ts:95`; the lane's purity test should assert on the built twin bundle, not the source claim.

**WAL refusal is wrong.** §3 refuses `E_OFFLINE_CARRIER` on `journal_mode` mismatch, but the pragma returns a row rather than throwing, and one COMMIT's atomicity does not need WAL (DELETE journal is atomic too). Record the mode; refuse only on unopenable/unwritable. Also: sidecars (`-wal`/`-shm`) must join wipe/size/backup accounting, and the "document directory" needs one line of precision (default is `Documents/SQLite/<name>` — I could not verify from this tree).

**Four verbs cannot run §7.** `offline/online/barrier/state` (+fault wrapper) cannot sign in as alice, drain, open chats, send, select a swap, or inject the post-commit 503. Name the UI-automation or the extra verbs; copy the web witness's order (enqueue *completes*, then hold a *later* swap — killing the enqueue's own swap rolls the queued row back).

**Unmentioned lane work:** native streaming transport (`src/client.ts:160` defaults to global fetch; `src/sse.ts:47` needs `body.getReader()` — select `expo/fetch`, already external in `build.mjs:43`); single sqlite connection per process (two `openDatabaseAsync` handles + two writers ⇒ `SQLITE_BUSY`); `getFirstAsync` returns `null`, not `undefined`; StrictMode/Fast-Refresh vs singleton locks + provider `close`; whole-state JSON-encode main-thread hitch at Clique size (the real reason for the §14 measurement); db iCloud-backup exclusion; Android CursorWindow makes the "second adapter" non-free.

**expo-sqlite/Hermes specifics (all platform knowledge; none verifiable from this tree, which vendors no Expo code):** async API (`openDatabaseAsync`, `withExclusiveTransactionAsync`) true, and exclusive is the required choice; `Uint8Array` BLOB bind/return true on recent versions — still run the pinned-peer round trip, keep base64-TEXT as costed fallback only; WAL on iOS supported true; no practical size limit at 10k messages true (limit is per-transaction/JS-heap memory, not SQLite); `structuredClone` present at the `react-native >= 0.75` floor for the JSON-safe usage true; `TextEncoder` present true but unused by the twin; `crypto.subtle` SHA-256 generally absent on Hermes true but irrelevant (twin hashes in pure TS). "Exclusive = `BEGIN IMMEDIATE`" I could not verify verbatim — pin the exact SQL in the driver contract.

## 6. Minor

Unify the barrier name (`beforeReplace` vs §3's `beforeCommit`); cite the existing `check-expo-chat-template-typecheck.mjs` as the §6 gate precedent; move `simctl` bundle-id/udid handling and boot waits into the script; JSON round trip must cover `undefined`/`NaN` (stringify drops/nulls them) via the already-required golden; SecureStore accessibility vs background resume gets one line in E1.

## 7. What you would delete

Confidence percentages; §12's Exact-2 sqlite-compatibility speculation (keep the deferred trigger + contract pointers, five lines); the §10/decision-13 publication triplication (fold into one); the Xcode/iPhone host inventory (runtime probe, not spec); `--device <simulator>`; launch-time `EXPO_PUBLIC_*`; `witnessControl` from `./expo`; the `bytes.type` column unless derived; the WAL-mismatch refusal; any remaining "a second process cannot exist" phrasing (already mostly fixed).

Net: fold B1/B2 plus the §4 one-liners and E1 (§3–§5) is startable; E2 needs the rewritten §7 first.

