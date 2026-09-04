Note: this session has filesystem writes disabled, so I could not create `/Users/ccheever/projects/snapback-1012-impl/reviews/1013-r1-muse.md`. The full review text (≤2,500 words) follows — paste it to that path verbatim.

---

# Blind design review — LLP 1013 revision (a) (Expo arm)

Reviewer: Muse. No agents, no tests, no tree modifications. All code citations are to `REPO=/Users/ccheever/projects/snapback-1012-impl/capsules/1013-r1` as frozen. "I could not verify" is stated where true.

## 1. Verdict: NOT READY

Three blocking design errors (§B1–B3). The carrier/entry/template plan is sound; the witness instrument (§7) as specified is not implementable, and one §7 acceptance has no delivery path in any lane.

## 2. Blocking design errors

**B1. The dev-only control channel as specified cannot be built.** §7 says the app runs "a WebSocket server on the simulator's loopback the harness connects to through `simctl`'s port forwarding," exported from the package as `witnessControl`. Two facts kill this: (a) React Native / Expo JS offers a WebSocket *client* only — there is no TCP-server socket in any named peer (`package.json` peers: `expo`, `expo-file-system`, `expo-video`, `react-native`; no native TCP module is added by the spec). An in-app listening server needs a native module the spec never names. (b) `simctl` has no port-forwarding facility — that is `adb reverse`. (iOS Simulator shares the host network, so none is needed, but the spec's mechanism does not exist.) The cited precedent also contradicts the claim: the web witness injects its barrier at *bundle time* (`snapback2/scripts/witness-web.mjs:86`, `beforeReplace`), with no in-app server. Fix: reverse the roles — the harness serves (HTTP/WS on host loopback, directly reachable from the Simulator), the app connects/polls as a client; or use the file-flag barrier the spec demotes to "alternative." `witnessControl` must not ship in the `expo` entry (see M7); if it exists, isolate it as `snapback2/witness-dev`.

**B2. §7 step 4's "ordinary image renders from the cache" has no delivery path.** Cached bytes surface as `Blob` (`store/byte-cache.ts:228-239`, `ByteCache.get`); `useAssetUrl` mints `blob:` URLs (`src/react.tsx:460-470`). The native `AssetImage` never touches that path — it loads the remote URI plus headers (`src/react-native.tsx:19-70`, esp. `:64-68`) and contains no `expo-file-system` cache-file bridge. No lane delivers the Blob→file-URI writer plus `file://` resolution that offline native rendering requires, yet E2's acceptance depends on it. Fix: scope the bridge into E1/E2 explicitly, or drop the assertion from §7.

**B3. The locking story contradicts itself, and "no second process" is false.** Decision 3 says "No file lock, no sqlite `BEGIN IMMEDIATE` dance," but §3 defines `transaction()` as "`BEGIN IMMEDIATE` … `COMMIT`, `ROLLBACK` on throw" (`1013-expo-arm.spec.md:152`). A lane following decision 3 builds a carrier without `IMMEDIATE` and earns `SQLITE_BUSY` flakes the moment two connections exist (a second `openDatabaseAsync` handle after a failed close, StrictMode double-mount, dev reload). And a second writer *can* exist: iOS app extensions sharing a container, Android multi-process, Xcode previews. The in-process lock table is still needed (the web precedent at `store/indexeddb.ts:241-264` handles the same-runtime case), but the driver must use the exclusive transaction it already promises. One-line reconciliation; blocking only because the spec as written instructs both.

## 3. Decisions table (§2)

| # | Decision | Agree / change | Cost |
|---|---|---|---|
| 1 | sqlite via expo-sqlite, one tx/swap, whole-state rewrite v1 | Agree on sqlite + one tx. **Change:** whole-state rewrite of a partition holding BLOBs will likely blow the swap-time budget at the Clique size (10k msgs/50 convos, §14); require the simulator swap-time gate *before* E2, with a keyed-diff fallback pre-designed | Small now; possibly days later |
| 2 | Five-method driver + `node:sqlite` test double | **Agree**, with: BLOB round-trip conformance on *both* drivers; pin exact `expo-sqlite` peer; note `DatabaseSync`-sync vs async-exclusive fidelity gap in the driver contract | Low |
| 3 | In-process lock only | **Change** per B3: keep the lock table *and* `withExclusiveTransactionAsync` for every `replace` | ~Zero |
| 4 | `expo-secure-store` token store | **Agree**, with: verify the ~2 KB/value limit, per-principal key layout, keychain accessibility setting, and in-memory caching (keychain round-trips are slow) | Low |
| 5 | `snapback2/expo` entry | **Agree**, minus `witnessControl` in the entry (B1); reconcile `./expo` with the existing `./react`+`react-native`-condition export (M7); keep the purity test | Low |
| 6 | Expo app + shared reducers | **Agree**; fix names: `conversations` not `inboxRows` (`templates/chat/react/src/chat/log.ts:17`), `searchHeld` (`log.ts:120`), pending keyed by `ids[0] ?? intent` (`log.ts:89,106`). Composer `ready`-gating already exists (`Composer.tsx:37`) | Trivial |
| 7 | Simulator witness via dev channel + `simctl terminate` at barrier | **Change** per B1 + §4 below: harness-serves/app-polls; barrier-holds-exclusive-tx with confirmed hit before terminate; mid-commit kill as scheduled experiment, not bar evidence. Deterministic core = throw-inside-tx rollback on both drivers + kill-at-rest/between-swaps | Small rework of §7 |
| 8 | Hermes bundle in `metrics/expo.jsonl` | **Agree**, with correction: `expo export --platform ios` does not itself emit Hermes bytecode (Hermes compile happens at prebuild/EAS); measure the real device/simulator artifact or label the export output honestly | Low |
| 9 | Journeys stay in Node; simulator only for witness | **Agree** | — |
| 10 | Publication out of scope, lanes keep package publishable | **Agree**; note the witness "by name" needs a pre-publish resolution story (dist/ link) | Trivial |

## 4. Material findings

**M1. Code-claim corrections (§1).** The actual backend interface returns state from `open` and `readBytes` is optional (`store/range-store.ts:323-331`); the richer `RangeStore` (seal/unseal/answer/commit/coverage/outbox, `:275-285`) is omitted from the doc's quote. The per-swap IndexedDB/file descriptions check out (`store/indexeddb.ts:190-213`; `store/file.ts:49-70`). `react-native.tsx` re-exports `./react.js` (`:8`) but its image is `react-native` `Image`, not expo-image (`:2,:64`) — "expo-image-style props" mislabels. "Nothing touches `window`/`document`/`node:` except the two carriers" is false: `src/react.tsx:506` reads `window.devicePixelRatio` (guarded, but it ships in the client). Twin size 19.7 KB checks out (`metrics/twin.jsonl` tail: 19,747 gzip at O2b-fix2; neutral/es2022 build in `build.mjs:30-43`).

**M2. The web "kill during commit" precedent does not exist.** `beforeReplace` is awaited *before* the readwrite transaction opens (`store/indexeddb.ts:195-196`; the auto-commit comment at `:146,:193` explains why it cannot be inside). So the web witness kills *between* swaps, never mid-transaction. §7's barrier "inside `replace`" must mean *inside the sqlite exclusive transaction* to prove anything new — a genuinely different (riskier) instrument than the cited precedent. Name that honestly.

**M3. The sqlite schema under-persists as written.** §3's `replace` text covers only meta/rows/answers/outbox + bytes, but the IndexedDB precedent persists watermarks, grants, overlay, bounds, programs, facts, viewed, clocks in `meta.state` (`store/indexeddb.ts:100-121`). The sqlite carrier must serialize the same `PersistedRangeState` remainder into `meta` (or named tables) — and `wipe` must clear all five tables *plus* `-wal`/`-shm` sidecars, or `wipe` followed by `open` resurrects data.

**M4. `PRAGMA journal_mode=WAL` failure mode is mis-specified.** That pragma returns a row (`delete` vs `wal`); it rarely throws. The carrier must compare the returned mode and refuse `E_OFFLINE_CARRIER` on mismatch, not catch an exception that never comes.

**M5. Unwritable-file ⇒ `E_OFFLINE_CARRIER` via chmod on the Simulator is flaky** (ownership vs mode bits, sidecar files, Data Protection states). Prefer a fault-injecting driver wrapper for that assertion; keep the chmod variant as scheduled-only.

**M6. expo-sqlite specifics** (no expo-sqlite code exists in this tree — all from platform knowledge, stated to be re-verified by the lane): async API (`openDatabaseAsync`, `withTransactionAsync`/`withExclusiveTransactionAsync`) — true, and exclusive is the right choice; BLOB `Uint8Array` bind/return — true on recent versions but the lane must run the round-trip on the *pinned* peer, with base64-TEXT fallback costed (+33%, encode time); WAL works on iOS but sidecars must travel with the db (backup, wipe, unwritable test); default location is the `SQLite/` dir under the document directory, so "under the app's document directory" needs one line of precision; no practical size limit at 10k messages — the limit is per-transaction memory, i.e. M1's rewrite concern, not SQLite.

**M7. Hermes/`crypto`/`structuredClone`/`TextEncoder`:** the good news the doc misses — the twin needs none of them. Hashing is pure TypeScript (`packages/evaluator/src/sha256.ts:1-3`, `hash.ts`, manual UTF-8, no `TextEncoder`, no `crypto.subtle` — the main thing I could verify here, and it is Hermes-safe by construction). `structuredClone` is used only on plain JSON-safe state (`store/range-store.ts:343`; payloads travel separately as `ByteDelta`), safe on the `react-native >= 0.75` floor — I could not verify Hermes's `structuredClone` version history from this tree, but the usage is the benign case. The lane's job is a purity test (no `node:`, no `crypto.subtle`, no `indexedDB` in phone entries), not a polyfill hunt.

## 5. Minor

- `check-expo-chat-template-typecheck.mjs` already exists in `scripts/` — cite it as the §6 gate precedent rather than implying new harness.
- `simctl terminate/launch` need bundle-id + device-udid handling and boot-state waits; record which in the script, not the spec (the "Xcode 26.6 / iPhone 17" host claim rots — I could not verify it from the tree; move to a runtime probe).
- Keep one barrier name across carriers (`beforeReplace`; §3's `beforeCommit` is a third spelling for the same hook).
- `expo-secure-store` accessibility constant choice (unlocked vs after-first-unlock) interacts with background resume; one line in E1.

## 6. What you would delete

1. **§12 (Exact 2 arm)** — speculative, a third of the operative spec's weight, and its "a day or two of plumbing" estimate is unfounded. File as a separate note when Exact 2 settles.
2. **§10 (Publication)** — duplicates decision 10 in one paragraph; fold its two operative sentences (exports map, peers, `node:`-unreachability) into the decision row.
3. **The confidence percentages (§2)** — false precision; the review's agree/change/cost replaces them.
4. **"No `BEGIN IMMEDIATE` dance," "through `simctl`'s port forwarding,"** and the Xcode/iPhone host facts — wrong, nonexistent, and perishable respectively.
5. **§8's twin-ceiling restatement** — §14 of LLP 1012 already owns the number; keep only the Hermes-informational sentence with the M-table correction.

Net: E1 (carrier + entry + Blob→file bridge + purity tests) is dispatchable after B3/M3 fixes; E2 (app + witness) needs §7 rewritten per B1/B2 first.
