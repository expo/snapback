# LLP 1013: The Expo arm — the sqlite carrier, the simulator witness, and the chat template on a phone

**Type:** Spec
**Status:** Draft (revision (a), for one blind review round before the lanes dispatch)
**Systems:** `snapback2/packages/snapback2` (the `expo` entry, the sqlite carrier, the React Native components, the witness harness), `snapback2/templates/chat` (the Expo app), `snapback2/scripts` (the simulator witness), `snapback2/metrics`
**Author:** Claude Fable 5.1, at the author's direction ("do Expo arm next", 2026-09-04 afternoon)
**Date:** 2026-09-04
**Revised:** —
**Related:** LLP 1012 (local-first v1: the store, the outbox, the twin, §10's witness split by lane, §12's offline bar), LLP 1006 (assets; lane D's React Native components), LLP 1007 §4a (the loop bar and the capability bar), LLP 0329.016 (the dev loop), `rules/NOT-DOING.md` (client arms in order: React web, Expo, Exact 2), `benchmarks/briefs/social-messenger.md` (the capability bar: Expo on iOS, Android, and web)

## Summary

Every part of the local-first client that LLP 1012 built is platform-neutral TypeScript
except one: the store carrier, which was designed as a plug (IndexedDB on the web, files in
Node). The Expo arm is that third plug plus the glue a phone needs: an `snapback2/expo` entry
that assembles the client with a sqlite carrier and a secure token store, the chat template's
screens as React Native views on the hooks that already exist, and the simulator witness LLP
1012 §10 scheduled for lane O4. The twin, the outbox, the resume protocol, the byte cache, and
the React hooks do not change. The author ruled the order on 2026-09-04: the Expo arm now; the
Exact 2 arm when Exact 2 settles (§12 records what it will consume). The offline bar and the
capability bar both require this arm; the loop bar's "starts only after" clause is waived
for it as it was for the offline program, under the author's principle of going straight to
the ideal.

## 1. What exists, and what is missing

Exists on main (landing 6 of LLP 1012, `4f5eef21f` and after):

- `snapback2/react-native` (`src/react-native.tsx`): re-exports every hook and the provider from
  `snapback2/react`, and adds `AssetImage` / `AssetVideo` on `expo-image`-style props and
  `expo-video` (LLP 1006 lane D). Peer dependencies `expo >= 54`, `expo-file-system >= 19`,
  `expo-video >= 2`, `react-native >= 0.75`.
- The `RangeStoreBackend` interface (`store/range-store.ts`): `open(partition)`,
  `replace(state, bytes)` as one carrier transaction, `readBytes(key)`, `wipe(partition)`,
  `close()`. Two carriers implement it: IndexedDB (one transaction per swap, `clear` + `put`
  of every projected store, bytes in the same transaction) and the Node file carrier (an
  ordered write plus a sweep on open). Both are proven by the same package tests on both
  carriers where custody differs.
- Web Locks for the one-writer rule on the web (`E_OFFLINE_LOCK`); `navigator.locks` is
  injectable, and the Node carrier has no second holder to refuse.
- The twin bundle at 19.7 KB gzip, built `--platform=neutral --target=es2022`; nothing in it
  or in the client touches `window`, `document`, or `node:` modules except the two carriers.

Missing:

- A carrier for React Native: no IndexedDB, no `node:fs`.
- A client entry for Expo: the store, the token store, and the byte cache assembled for a
  phone.
- The one-writer rule on a phone.
- The chat template's screens as React Native views (the web screens are DOM).
- The simulator witness (LLP 1012 §10, "O4, simulator"), with a way to kill the process
  during a `commit`.
- A per-milestone iOS Hermes bundle and its size in `metrics/`.

## 2. Decisions

Each with the recommendation and the orchestrator's confidence; the author may veto any at
the review.

1. **The carrier is sqlite through `expo-sqlite`, one transaction per swap.** `replace`
   writes the projected state (rows, answers, outbox, meta) and the byte payloads and removals
   inside one `withTransactionAsync`; `open` reads them back; `wipe` deletes the partition's
   rows. Bytes live as BLOB rows in the same database file, so a row and its bytes are one
   transaction and the process-kill witness has one thing to prove. Whole-state rewrite per
   swap in v1, exactly as the IndexedDB carrier does (`clear` + `put`); the §14 measurement
   decides whether a diffing write is needed. (sqlite: 90%; whole-state v1: 80%.)
2. **The carrier is written against a five-method driver interface, not against Expo.**
   `SqliteDriver { exec, run, get, all, transaction }` with two drivers: `expoSqliteDriver()`
   over `expo-sqlite`'s async API, and `nodeSqliteDriver()` over Node 24's built-in
   `node:sqlite` (`DatabaseSync`), used only by tests. The package tests that today run "both
   carriers where custody differs" run three; the simulator witness qualifies the Expo driver.
   No sqlite dependency is added to the package: `node:sqlite` is built in, `expo-sqlite` is a
   peer. (85%.)
3. **One writer per process.** A phone runs one JavaScript runtime per app process; there is
   no second tab. The Expo entry uses an in-process lock table keyed by partition: a second
   client on the same partition in the same runtime refuses `E_OFFLINE_LOCK` (the StrictMode
   and inline-`offline` cases the provider already handles), and a second *process* cannot
   exist. No file lock, no sqlite `BEGIN IMMEDIATE` dance. (85%.)
4. **The token store is `expo-secure-store`;** the partition is the principal, as on the web.
   The bearer flow, sealing on session expiry, and wipe on sign-out are the client's rules and
   do not change. (90%.)
5. **The entry is `snapback2/expo`:** everything `snapback2/react-native` exports, plus
   `expoSqliteStore()` (a `RangeStoreFactory`), `expoSecureTokenStore()`, and a
   `createExpoClient(options)` that fills `offline.store` and `tokenStore` when the app does
   not. `snapback2/react-native` stays for apps that bring their own carrier. (85%.)
6. **The chat template gets an Expo app beside its web app:** `templates/chat/expo/` with
   Inbox, Thread, Composer, and Search as React Native views on the same hooks and the same
   `log.ts` reducers as the web screens (the reducers move to a shared module, the views do
   not). No `react-native-web` layer: the web app stays DOM, the phone app is native views,
   and the shared code is the hooks and the reducers. (80%.)
7. **The witness is the §10 list on the iOS simulator, driven from the host.** The app
   exposes a dev-only control channel (a WebSocket to the harness, compiled in only under
   `__DEV__`, off by default) through which the harness sets a barrier inside the carrier's
   `replace` and reads the screen's state; the harness kills the app with `xcrun simctl
   terminate` at the barrier and at rest, relaunches with `simctl launch`, and asserts the
   §10 outcomes: the inbox, the three chats, and the queued message are there after a kill
   during a commit; a never-opened chat is `hydrating`; `E_OFFLINE_CARRIER` when the database
   file is made unwritable; exactly one row on the server after a 503 following the first
   replay's commit; a viewed view-once photo does not render after the kill and an ordinary
   viewed image does. It runs on the schedule (`rules/RULES.md`: nothing slower than sixty
   seconds blocks a push) as `scripts/witness-expo.mjs`, and files a bounded ticket when
   red. The host has Xcode 26.6 and iPhone 17 simulators today. (75%: the barrier through a
   dev channel is the one piece with no precedent in the tree; the alternative is a
   file-based barrier the app polls, which is uglier but has no socket.)
8. **The per-milestone iOS Hermes bundle** is `expo export --platform ios` of the template's
   Expo app; its gzip size and the client's and twin's share of it land in
   `metrics/expo.jsonl` with the method. The twin's 30 KB ceiling (author ruling
   2026-09-04) is measured on the neutral bundle as today; the Hermes bytecode size is a
   second, informational number. (85%.)
9. **The journeys do not move to the phone.** `snapback2 test` and `as(name, { store:
   "file" })` remain the five-second loop; the carrier's correctness is proven in Node through
   the `node:sqlite` driver; the simulator witness is the durability evidence and the only
   thing that runs on the simulator. Android and web are the capability bar's remaining
   platforms and are not in this spec's lanes: the carrier and the entry are platform-neutral
   Expo, and the witness is written so a second platform is a second `simctl`/`adb` adapter.
   (85%.)
10. **Publication is not this spec's.** The offline bar wants a published package; `snapback2`
    is at 0.0.1 and unpublished. The loop program owns publication; this spec's lanes leave
    the package publishable (the `expo` entry in the exports map, peers declared, no `node:`
    import reachable from the phone entry).

## 3. The sqlite carrier

Schema, one database file per app (`snapback2.db` under the app's document directory), the
partition as a column so `wipe` is one `DELETE` per table:

```sql
CREATE TABLE IF NOT EXISTS meta    (partition TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (partition, key));
CREATE TABLE IF NOT EXISTS rows    (partition TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (partition, key));
CREATE TABLE IF NOT EXISTS answers (partition TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (partition, key));
CREATE TABLE IF NOT EXISTS outbox  (partition TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (partition, key));
CREATE TABLE IF NOT EXISTS bytes   (partition TEXT NOT NULL, key TEXT NOT NULL, type TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY (partition, key));
```

`replace(state, bytes)`: one transaction: delete the partition's rows from `meta`, `rows`,
`answers`, `outbox`; insert the projections exactly as the IndexedDB carrier projects them
(the same `project()` function, moved to a shared module so the two carriers cannot drift);
insert `bytes.put`, delete `bytes.remove`. `open(partition)`: read the four tables back through
the same un-projection; `undefined` when `meta` has no row for the partition. `readBytes(key)`:
one `SELECT`. `close()`: close the database. A carrier that cannot open the file, or whose
`PRAGMA journal_mode=WAL` fails, refuses `E_OFFLINE_CARRIER` with the driver's message; memory
is never substituted (LLP 1012 §4).

The driver:

```ts
export interface SqliteDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqliteParams): Promise<void>;
  get<T>(sql: string, params?: SqliteParams): Promise<T | undefined>;
  all<T>(sql: string, params?: SqliteParams): Promise<T[]>;
  transaction<T>(body: () => Promise<T>): Promise<T>;   // BEGIN IMMEDIATE … COMMIT, ROLLBACK on throw
  close(): Promise<void>;
}
```

`expoSqliteDriver(name?)` wraps `openDatabaseAsync` and `withExclusiveTransactionAsync`;
`nodeSqliteDriver(path)` wraps `DatabaseSync` in resolved promises. The test suite's "both
carriers" loops become "every carrier": file, IndexedDB (through the fake), sqlite (through
`node:sqlite`). The atomic-swap test's `beforeRename` barrier has a sqlite twin: a
`beforeCommit` hook on the driver that the witness also uses (§7).

## 4. Locks, the token store, and the partition

`inProcessLocks()` implements the subset of the Web Locks interface the store uses (`request`
with `ifAvailable`) over a `Map<string, holder>`; the Expo entry passes it where the web passes
`navigator.locks`. `expoSecureTokenStore()` implements the token store over
`expo-secure-store` with the same key layout as `browserTokenStore`. Sealing on a terminal
session refusal, wipe on sign-out or a principal change, and the byte cache's session
allowance bound to the partition all come from the runtime unchanged (LLP 1012 §4, §9).

## 5. The `snapback2/expo` entry

```ts
export * from "snapback2/react-native";
export { expoSqliteStore, expoSecureTokenStore, createExpoClient } from "./expo/index.js";
// createExpoClient(options) = createClient({ ...options,
//   offline: { store: options.offline?.store ?? expoSqliteStore(), ...options.offline },
//   tokenStore: options.tokenStore ?? expoSecureTokenStore() })
```

`build.mjs` bundles it like the other entries (`--platform=neutral`), and a test asserts that
the bundle contains no `node:` specifier and no `indexedDB` reference. `package.json` gains the
`./expo` export and the peers `expo-sqlite >= 15` and `expo-secure-store >= 14`.

## 6. The chat template on a phone

`templates/chat/expo/`: an Expo app (`app.json`, `App.tsx`, `src/screens/{Inbox,Thread,
Search}.tsx`, `src/Composer.tsx`) on `createExpoClient({ url: process.env.EXPO_PUBLIC_SNAPBACK_URL })`.
The reducers the web screens use (`templates/chat/react/src/chat/log.ts`: `threadBubbles`,
`inboxRows`, the search over the held log, the pending-bubble keying by intent) move to
`templates/chat/shared/log.ts` and both apps import them; the type-check gate that already
checks the web screens against the generated API checks the Expo screens too. The Composer is
disabled until `useMutation(api.deliveries.post).ready` (LLP 1012 revision (h)) and shows a
refusal's rewrite. `AssetImage`/`AssetVideo` from `snapback2/react-native` render the media,
view-once included.

## 7. The simulator witness

`scripts/witness-expo.mjs`, the §10 "O4, simulator" list as steps, each asserted:

1. Build the template's Expo app for the simulator once (`npx expo run:ios --device
   <simulator>` or a prebuilt dev client; the script records which) and start the owner on the
   host with the seed.
2. Launch; sign in as alice; drain the inbox; open three chats; view one ordinary image and
   one view-once photo.
3. `offline()` through the control channel; enqueue one message.
4. Set the barrier inside `replace` (the driver's `beforeCommit`), trigger a swap, kill at the
   barrier (`simctl terminate`), relaunch: the inbox, the three chats, and the queued message
   are there; the never-opened chat is `hydrating`; the ordinary image renders from the cache;
   the view-once photo does not render.
5. Kill at rest; relaunch with the owner stopped: the same.
6. Make the database file unwritable; relaunch: `E_OFFLINE_CARRIER`; restore.
7. Start the owner; inject a 503 after the commit of the first replay: exactly one row on the
   server; the bubble does not move; the second message commits in order.
8. Expire a message while offline through the recipe; resume: gone from the local search.

The control channel: `snapback2/expo` exports `witnessControl(client, { port })`, which the
template's Expo app mounts only when `__DEV__ && process.env.EXPO_PUBLIC_SNAPBACK_WITNESS` is
set; it is a WebSocket server on the simulator's loopback the harness connects to through
`simctl`'s port forwarding, with four verbs: `offline`, `online`, `barrier(on|off)`, `state`
(the store's `coverage()` summary and the screens' rendered rows). It ships in the package
because the witness must run against the published package, but it is dead code unless the
env is set. The witness runs on the schedule and files a bounded ticket when red; it does not
block a push (`rules/RULES.md`).

## 8. The bundle and its size

`expo export --platform ios` of the template's Expo app after the witness passes; the Hermes
bytecode bundle's size, its gzip, and the client's and twin's contribution measured by
`--source-maps` land in `metrics/expo.jsonl`. The twin's 30 KB ceiling is measured on the
neutral bundle exactly as `metrics/twin.jsonl` does today.

## 9. Tests and the fast loop

- Package tests: every carrier-parametrized test runs on the sqlite carrier through
  `node:sqlite`; new tests for the driver (transaction rollback on throw, `beforeCommit`
  barrier, `E_OFFLINE_CARRIER` on an unopenable file), the in-process locks, the token
  store's key layout (through a fake secure store), and the bundle's purity.
- The template's Expo screens are type-checked in the final gate beside the web screens.
- The journeys stay in Node; the witness is the simulator's only job.

## 10. Publication

Not this spec's. The lanes leave `snapback2` publishable: the `expo` entry in the exports map,
peers declared, `node:` unreachable from the phone entries, and the witness script pointing at
the package by name so it can run against the published artifact when the loop program
publishes.

## 11. Lanes and reviews

Implementer: codex `gpt-6-astra` at xhigh (author ruling 2026-09-04). Reviews per lane, blind:
codex astra read-only, grok 4.6 xhigh, Muse ultra. Fix rounds at most three.

- **E1 — the carrier and the entry:** §3, §4, §5, §9's package tests. Lands first.
- **E2 — the template's Expo app and the witness harness:** §6, §7 (the harness and the control
  channel; one full run on the host's simulator in the report), §8. Starts on E1's head.
- The Android adapter for the witness and the web run of the Expo app are the capability
  bar's and wait.

## 12. The Exact 2 arm (recorded for when it starts)

Held by the author's ruling of 2026-09-04 until Exact 2 settles (it "is evolving"; sqlite
there is "less certain"). What that arm will consume, all of it pinned today:

- `snapback2-core`'s `ClientStore` is the twin: this program proved the TypeScript twin
  byte-identical to it on every golden and the corpus, so the Exact arm's local evaluation is
  the engine itself with no second semantics to write.
- The wire: `DeliveryEnvelopeV1`, `POST /api/resume`, the grant and the replay envelope, the
  trace shape (LLP 1012 §7–§8); the Rust types in `crates/snapback2/src/protocol.rs` and the
  goldens in `crates/snapback2-core/tests/offline_goldens` are the contract.
- The store: a sqlite carrier in Rust with the same projections (§3's schema is deliberately
  plain sqlite so a Rust implementation reads the same file), the four eviction rules, the
  outbox ledger, and the byte cache under the row lease.
- What it does not need: the React hooks, the twin bundle, the JavaScript carriers.

The trigger to start: Exact 2 settling on sqlite, or a first Exact app needing offline. A day
or two of plumbing at that point, not a program.

## 13. Diagnostics

No new code. `E_OFFLINE_CARRIER` carries the driver's message; `E_OFFLINE_LOCK` from the
in-process table; everything else is LLP 1012 §15.

## 14. Measurements to record

- store bytes on the phone, Clique at ten thousand messages across fifty conversations
  (`sqlite` file size; the §14 number LLP 1012 asked for, now on the carrier that ships);
- swap time on the simulator at that size (whole-state rewrite versus the diffing write
  decision 1 defers);
- cold replay time to first inbox paint on the simulator;
- the Hermes bundle's size and the client's and twin's share (§8);
- the witness's pass, dated, per platform.

## 15. Not doing

Android and web runs of the Expo app (the capability bar's), a file-lock or multi-process
story (a phone has one process), a diffing write (measured first), `react-native-web`, push,
background fetch, and anything LLP 1012 §11 already lists.
