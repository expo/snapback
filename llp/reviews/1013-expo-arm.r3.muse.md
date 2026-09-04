Note: this session has filesystem writes disabled, so I could not create `/Users/ccheever/projects/snapback-1012-impl/reviews/1013-r3-muse.md`. The full review (under 2,500 words) follows — paste it to that path verbatim.

---

# Blind design review — LLP 1013 revision (c), the Expo arm

Reviewer: Muse. No agents, no tests, no tree edits. `REPO=/Users/ccheever/projects/snapback-1012-impl/capsules/1013-r3` (no `.git`; 94d39b323 I could not verify). `path:line` is repo-relative unless absolute. "I could not verify" where true. Read: `llp/1013-expo-arm.spec.md`, `llp/1012-local-first-v1.spec.md`, `snapback2/packages/snapback2/src/store/{range-store.ts,indexeddb.ts,file.ts,byte-cache.ts}`, `src/react-native.tsx`, `src/offline.ts`, `src/client-offline.ts`, `package.json`, `build.mjs`, `scripts/witness-web.mjs`, `rules/NOT-DOING.md`, `rules/RULES.md`, `reviews/1013-r2-{muse,astra,grok,muse}.md` (r2-muse duplicates r2-Muse).

## 1. Verdict: READY WITH CHANGES (list) — E2 may start once changes applied

Revision (c) folds almost every round-2 finding correctly in design. No remaining error makes the architecture wrong. What remains is one blocking witness-instrument error carried into E2 scope (B1 below), plus E1-scope corrections E1 must take alongside its dispatched work. Do not count a green `simctl terminate` run as atomicity evidence until B1 is fixed. E2 (decision 7, §6–§8) may start on the changed §7; §6/§8 may start now.

## 2. Blocking design errors

**B1. `simctl terminate` at "barrier reached" still cannot prove a mid-commit kill, and the spec now admits it but keeps it as the instrument.** §7 step 4 (`llp/1013-expo-arm.spec.md:313-318`) waits for "barrier reached" then runs `simctl terminate`; decision 9 (`:172-176`) correctly states `terminate` is async SpringBoard kill and "cannot freeze the JS thread at a line," then weakens the assertion to "no torn state — either pre- or post-swap, pre-swap expected." That honesty does not fix determinism: the COMMIT may land before SIGKILL, the run looks green having exercised only the pre-swap path, and a suite that expects pre-swap passes without ever holding a transaction open. The deterministic proof is moved to Node `kill -9` (`:158-162`), which is the right gate evidence but not the same VFS/threading stack as the phone. Fix (as r2 unanimously said): resolve the simulator-app pid, `kill -9` the pid, wait for exit, then `simctl launch`; keep `terminate` as scheduled variant only. Also specify: socket close/reject while parked must ROLLBACK, never COMMIT. Cost: lines in `scripts/witness-expo.mjs`. I could not verify signal synchrony from this tree (no simulator/Expo sources vendored) — platform knowledge.

## 3. Decisions table (§2 has thirteen, not ten)

| # | Decision | Agree / change | Cost |
|---|---|---|---|
| 1 | sqlite, exclusive tx/swap, state rewrite + byte delta, §14 gate | Agree; keep keyed-diff fallback pre-designed | Small now |
| 2 | driver owns tx, executor arg; Node `BEGIN IMMEDIATE`/await/`COMMIT`; conformance both | Agree; record `DatabaseSync`-sync vs exclusive-async fidelity gap | Low |
| 3 | JSON tuple in one `key` column | Agree — F1 fixed; add adversarial samples (quotes, unicode, empty id, `m\0x`) | Trivial |
| 4 | singleton in-process locks + exclusive tx; 2nd process loud-unsupported | Agree; rewrite `E_OFFLINE_LOCK` "another tab" copy (`src/client-offline.ts:82-84` cited, I could not re-verify file) for phone | ~Zero |
| 5 | SecureStore legal keys, 2KB, cached, delete both; peers `expo-sqlite ^16`, `expo-secure-store ^15` | Agree; verify 2KB/accessibility vs pinned SDK — I could not verify from tree | Low |
| 6 | `./react-native` + `./expo`, `react-core` split, one context module externalized, `client` prop, `expo/fetch` default, purity test | Agree — correct fix for Astra-B1/B2. `build.mjs:29-45` today has no `react-core`, no sourcemap, no sqlite/securestore externals; E1 must land exactly what `:133-139,:285-291` says | Low |
| 7 | byte bridge (`assetBytes`/`putBytes`, `useAssetFile` file://, evict/wipe, view-once at view time) | Agree direction; **change:** specify view-once file custody (session-only bytes have no durable entry — `src/store/byte-cache.ts:278-286` — so `bytes.remove` cannot evict them) + crash sweep + seal invalidation. See §4 | Material (days, E2) |
| 8 | Expo app + shared reducers, no RN-web | Agree; add `init.rs --client`, `onTombstone`, `viewOnce` predicate wiring (I could not verify template paths from this capsule) | Medium |
| 9 | outward WS, in-tx barrier, Node kill + simulator no-torn-state, dev subpath, Metro-baked URL | **Change per B1** + name UI-automation/extra verbs + enqueue second message before 503 step | Small §7 rework |
| 10 | never-opened via twin + predicted send; `partial`/`never-held` separately | Agree; matches LLP 1012 §12 | Trivial |
| 11 | Hermes bytecode inspected (not suffix-assumed), source-map attribution, twin ceiling on neutral | Agree — correct fold; depends on E1 emitting maps | Low |
| 12 | journeys stay Node; simulator only witness | Agree | — |
| 13 | publication elsewhere; `dist/` link | Agree | Trivial |

## 4. Material findings

**Code-claim audit (§1): true as far as checked.** `RangeStoreBackend` (`src/store/range-store.ts:323-331`); IndexedDB clear+re-put per swap with delta-only bytes and pre-txn `beforeReplace` (`src/store/indexeddb.ts:190-213,:18-19,:195`); file ordered-write+sweep (`src/store/file.ts:43-70,:93-105`); NUL keys (`src/store/range-store.ts:354-360`); Blob in/out (`src/store/byte-cache.ts:228-239,:288`); `react-native` condition + peers (`package.json:17-24,:45-51`); native components URL-only, no cache (`src/react-native.tsx:19-70,:95-106`). I could not verify `src/client.ts`, `src/sse.ts`, `src/token-store.ts`, `src/react.tsx`, `metrics/twin.jsonl`, template `chat/log.ts` contents from reads in this session (files not opened); prior-review line citations for them are taken as reported, not re-verified.

**Round-2 fold audit:** F1 (two key layouts) resolved — §3 SQL (`:208-214`) is now one `key TEXT`, no `kind`. F2 (`bytes.type`) resolved — `:213,:216-218` drops the column, MIME in state's asset record, matching `ByteDelta.put {key,bytes}` (`byte-cache.ts:23`). Astra-B1 (fetch) resolved in design (`:129-131` defaults `expo/fetch`, never beside `as`). Astra-B2 (one context) resolved in design (`:133-139`). Astra-B3/Muse-B2 URL resolved (`:165-166,:309-311` set at build/Metro time, `--simulator` flag fixed). Fault persistence resolved in design (`:177-178` file in container). `structuredClone`/export/maps/peers folds correct in prose (`:56-60,:185-191`). Retained defect: WAL-mismatch still refuses `E_OFFLINE_CARRIER` (`:231-233`); one COMMIT is atomic under DELETE journal too — record mode, refuse only unopenable/unwritable. That is E1 scope (already dispatched — E1 takes it).

**Witness (§7) — instrument right, kill wrong, verbs thin.** Barrier inside carrier `replace` after DML before COMMIT is the right instrument (strictly stronger than web `beforeReplace` pre-txn, `indexeddb.ts:195`; `witness-web.mjs:270-273` sleeps 500ms with no reached-ack). Four verbs + `login/open/send/view/state` still cannot drive sign-in/drain/navigate/send/swap-selection/503/conformance without named UI-automation or extra verbs; step 7 needs the second enqueue the web harness has (`witness-web.mjs:257-262`); `state` cannot prove an image rendered. Uglier-but-safer alternative: file handshake in app container (`at-barrier`/`hold` files via `get_app_container`), host observes file then `kill -9` recorded pid; or Node `kill -9` as atomicity proof + simulator kills only at rest. Never derive "reached" via `coverage()` on the blocked tail.

**expo-sqlite/Hermes (platform knowledge; none vendored — I could not verify from tree):** async API (`openDatabaseAsync`/`withExclusiveTransactionAsync`) true, exclusive required; exclusive = separate connection + plain `BEGIN`, write lock on first DML — (c) states this correctly; `Uint8Array` BLOB bind/return true (empty payload is sharp case — keep in conformance; base64 fallback costed only); WAL on iOS supported, pragma returns row; file default `Documents/SQLite/` — (c) correct; size: no practical SQLite limit at 10k msgs (`SQLITE_MAX_LENGTH` 1e9), real bound is JS-heap copies — §14 measurement is the gate; `structuredClone` via Expo winter runtime (not bare Hermes) — (c) correct; `TextEncoder` present but twin needs none; `crypto.subtle` SHA-256 generally absent on Hermes but irrelevant (pure-TS hash — `hash.ts` I could not verify here).

**Lane tripwires not in doc:** one sqlite connection per process (two `openDatabaseAsync` + two writers ⇒ `SQLITE_BUSY`; exclusive is DB-wide not per-partition); `getFirstAsync` returns `null` not `undefined` (normalize); busy-timeout behavior unstated ("fail loudly" may hang); StrictMode/Fast-Refresh vs singleton locks + provider `close` (`createExpoClient()` in render leaks lock-holder); whole-state JSON-encode main-thread hitch (real §14 reason); iCloud-backup exclusion for db+wal+shm+bridge files; `wipe` must not delete shared wal/shm; JSON `undefined`/`NaN` vs IDB structured-clone in round trip; SecureStore accessibility vs background resume; Android CursorWindow/second-adapter non-free; expo-web needs different carrier (WASM excluded per LLP 1012 §4).

## 5. Minor

Unify `beforeReplace`/`beforeCommit` names; meta list still says "watermarks…" — cite shared `projection.ts` + round-trip instead of enumerating; `chmod`-only-db variant correctly scheduled (wal file still writes); `useAssetFile`/`witnessControl` correctly out of §5 production exports into `expo/witness` dev subpath; keep `react-native` condition pointing at same file.

## 6. What you would delete

Confidence percentages; §12 Exact-2 sqlite-compatibility speculation (keep trigger + schema pointer, five lines); §10/decision-13 publication triplication (fold to one); host Xcode/iPhone inventory (runtime probe); any residual "exclusive = `BEGIN IMMEDIATE`" phrasing (already mostly fixed); WAL-mismatch refusal.

Net: (c) folds every r2 finding except B1's kill and the WAL refusal. Fix B1 before the witness counts; E2 starts on that change.

