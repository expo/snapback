# LLP 1013: The Expo arm — the sqlite carrier, the simulator witness, and the chat template on a phone

**Type:** Spec
**Status:** Implemented (revision (f), 2026-09-05: E1 landed `aa2ec8d33`, E2 landed after two fix rounds and three blind-review rounds; the iOS simulator witness passes all ten steps on the host; native view-once playback uses the in-memory module (§2 decision 7); Android and the web run of the Expo app wait for the capability bar)
**Systems:** `snapback2/packages/snapback2` (the `expo` and `react-native` entries, the sqlite carrier and its two drivers, the native byte bridge, the witness client), `snapback2/templates/chat` (the Expo app), `snapback2/scripts` (the simulator witness harness), `snapback2/metrics`
**Author:** Claude Fable 5.1, at the author's direction ("do Expo arm next", 2026-09-04 afternoon)
**Date:** 2026-09-04
**Revised:** 2026-09-11 (Node database identity uses device/inode and a failed rollback closes the poisoned connection); 2026-09-07 (browser condition precedes native for Metro web, with matching declarations); 2026-09-05 (native in-memory view-once playback); 2026-09-05 (measured incremental state writes and split metadata; carrier atomicity preserved); 2026-09-04 (e — reconciled to lane E1 as landed: every sqlite driver carries a stable database identity (Node: the opened file identity; Expo: the default directory plus a plain basename, path-like names refused) and the lock is per database and partition (§2 decisions 2 and 4, §3, §4); `open()` of a store with rows but no meta default-fills the meta record on every carrier (§3); persisted and in-memory state share one JSON wire form — `undefined` dropped, `null` kept (§3); a `COMMIT` failure rolls back and never poisons the connection (§3); the process-wide lock symbol was renamed before publication (§4); the residuals are in `issues/20260904-snapback2-expo-carrier-followups.md`); 2026-09-04 (d — the round-3 fold, all E2-scoped: native files are derivatives never evidence of permission (validated against partition, seal, viewed state, and lease before serving; view-once media never on disk; orphans swept on startup; mounted consumers invalidated on custody change) and the native screens use the byte paths, never a Blob; the shared reducers are packaged and scaffolded (`shared/` beside `react/` and `expo/`, copied by `build.mjs`, placed by `init`); the simulator kill is a host `kill -9` of the app's pid with the barrier promise never resolving on socket close, the transport cut persisted in the container before relaunch, the client constructed only after the control connection, mixture asserted across every store, and the predicted send asserted inside the thread query's result); 2026-09-04 (c — the round-2 fold: keys are JSON in one `key` column and the byte table has no `type` column (the MIME lives in the state's asset record); Expo's exclusive transaction issues plain `BEGIN` on its own connection and the write lock follows the first DML, while the Node driver issues `BEGIN IMMEDIATE` itself; `createExpoClient` defaults `fetch` to `expo/fetch` so SSE streams, and never supplies a token store beside `as`; the hooks' context is one emitted module shared by every entry, verified against the built bundles; the witness client is a dev subpath, its URL is baked at Metro time and read in the template, the simulator kill proves an open-transaction window and the Node `kill -9` proves atomicity; `structuredClone` is Expo's runtime, not bare Hermes; `expo export` emits Hermes bytecode and the package build emits source maps for attribution; peers pinned to the SDK 54 lines); 2026-09-04 (b — every blocking error of the three round-1 reviews (`llp/reviews/1013-expo-arm.r1.*` once copied; the orchestrator's `reviews/1013-r1-{astra,grok,muse}.md`) folded: keys are encoded, the driver owns the transaction and passes an executor, the witness channel connects outward from the app, the native components get a byte bridge, the entry is a real subpath and the hooks are split from the carriers, the token keys are SecureStore-legal, the never-opened chat renders through the twin, the schema persists everything the IndexedDB carrier persists, bytes are written by delta not by rewrite, the Hermes size is measured on a real build) (f — 2026-09-05: E2 as landed — the witness record, the drain rule, decision 7 amended by the device, the fix-round deviations)
**Related:** LLP 1012 (local-first v1: the store, the outbox, the twin, §10's witness split by lane, §12's offline bar), LLP 1006 (assets; lane D's React Native components), LLP 1007 §4a (the loop bar and the capability bar), LLP 0329.016 (the dev loop), `rules/NOT-DOING.md` (client arms in order: React web, Expo, Exact 2), `benchmarks/briefs/social-messenger.md` (the capability bar: Expo on iOS, Android, and web)

## Summary

Every part of the local-first client that LLP 1012 built is platform-neutral TypeScript
except the store carrier, which was designed as a plug (IndexedDB on the web, files in Node),
and the two native asset components, which today hand a URL to the platform and never touch
the byte cache. The Expo arm is the third carrier plug (sqlite), a byte bridge so the native
components render from the cache and consume view-once at view time, a `snapback2/expo` entry
that assembles the client for a phone, the chat template's screens as native views on the
hooks and reducers the web screens already use, and the simulator witness LLP 1012 §10
scheduled for lane O4. The twin, the outbox, the resume protocol, the byte cache's rules, and
the React hooks do not change. The author ruled the order on 2026-09-04: the Expo arm now; the
Exact 2 arm when Exact 2 settles (§12). The offline bar and the capability bar both require
this arm; the loop bar's "starts only after" clause is waived for it as it was for the
offline program, under the author's principle of going straight to the ideal.

Three reviewers read revision (a) blind and agreed on the shape (sqlite through a driver, the
entry, shared reducers, journeys in Node, publication elsewhere) and on what was wrong in the
detail; this revision is the fold.

## 1. What exists, and what is missing

Exists on main (LLP 1012 landing 6 and after):

- `snapback2/react` with a `react-native` export condition (`package.json`): Metro resolves
  `snapback2/react` to `dist/react-native.mjs`, which re-exports `react.tsx` (the hooks, the
  provider, the web `AssetImage`/`AssetVideo`, and — a problem for a phone — the IndexedDB
  carrier) and adds native `AssetImage` (a `react-native` `Image` with the delivery URL and
  headers) and `AssetVideo` (`expo-video`'s `useVideoPlayer(url)`). Neither native component
  fills the byte cache or marks view-once. Peers: `expo >= 54`, `expo-file-system >= 19`,
  `expo-video >= 2`, `react-native >= 0.75`.
- The `RangeStoreBackend` interface (`store/range-store.ts`): `open(partition)` returning the
  persisted state, `replace(state, bytes)` as one carrier transaction, optional
  `readBytes(key)`, `wipe(partition)`, `close()`. The IndexedDB carrier projects the state
  into `rows`, `answers`, `outbox`, and a `meta` record that carries everything else
  (watermarks, grants, overlay and its misses, bounds, programs, facts, viewed, clocks,
  sealed, version), clears and re-puts those stores each swap, and applies the byte delta in
  the same transaction; its `beforeReplace` test hook runs *before* the transaction opens
  (IndexedDB auto-commits and cannot hold a transaction across an await). The Node file
  carrier is an ordered write plus a sweep on open.
- Keys inside the state use U+0000 as a separator (`table\0id`, `op\0args`).
- The byte cache hands bytes out as a `Blob` built from a `Uint8Array` and takes them in
  through `blob.arrayBuffer()`; `useAssetUrl` mints `blob:` URLs.
- The token store's principal lives under `${key}:principal`.
- Web Locks for the one-writer rule on the web (`E_OFFLINE_LOCK`); `navigator.locks` is
  injectable.
- The twin bundle at 19.7 KB gzip, built `--platform=neutral --target=es2022`; its hashing is
  pure TypeScript (no `TextEncoder`, no `crypto.subtle`). The store, the outbox, and the twin's
  hydrate use `structuredClone`; Expo SDK 54's runtime installs it (and `TextDecoder`, which
  SSE uses), so the Expo runtime must initialize before the client constructs — a fact for the
  entry, not a bare-Hermes portability claim.
- The package build bundles four entries without code splitting: `react` and `react-native`
  each contain their own copy of the hooks' `createContext`, so a provider from one and a hook
  from the other would not share a context. The build emits no source maps.

Missing:

- A carrier for React Native (no IndexedDB, no `node:fs`).
- A byte bridge: cached bytes rendered natively, view-once consumed at view time.
- A phone entry that does not drag the IndexedDB carrier in.
- The one-writer rule on a phone.
- The chat template's screens as native views.
- The simulator witness (LLP 1012 §10, "O4, simulator"), with a way to kill the process
  during a commit.
- The iOS bundle size in `metrics/`.

## 2. Decisions

Each with the recommendation and the orchestrator's confidence after the round-1 fold; the
author may veto any at the review.

1. **The carrier is sqlite through `expo-sqlite`, one exclusive transaction per swap.**
   `replace` runs inside `withExclusiveTransactionAsync`, which opens its own connection and
   issues a plain `BEGIN` (the write lock is taken by the first DML statement, so every
   statement in the body runs on that connection and the first write serializes concurrent
   writers), writes changed projected records and metadata fields for the partition, and
   applies the byte delta in the same transaction. Neither unchanged history nor bytes are
   rewritten for an outbox-only update. The initial implementation rewrote state wholesale;
   the 2026-09-05 review measurement in §14 justified incremental state writes.
2. **The carrier is written against a driver interface whose transaction passes an executor,
   and the driver owns the transaction.** `SqliteDriver.transaction(body: (tx) => Promise<T>)`
   — every statement inside the body runs on `tx`, never on the outer handle, because
   expo-sqlite's exclusive transaction is a separate connection. Two drivers:
   `expoSqliteDriver()` over `openDatabaseAsync` / `withExclusiveTransactionAsync`, and
   `nodeSqliteDriver()` over Node 24's built-in `node:sqlite` `DatabaseSync`, which issues
   `BEGIN IMMEDIATE`, awaits the body, then `COMMIT` (or `ROLLBACK` on throw, and `ROLLBACK`
   after a failed `COMMIT` so the connection is never left in-transaction) itself — it
   must not call `DatabaseSync.transaction()` with an async callback, which would commit
   before the body ran. If that rollback itself fails, the driver closes the possibly
   poisoned connection so the next queued turn reopens it, preserving the original failure.
   Both drivers normalize a missing row to `undefined` (`getFirstAsync`
   returns `null`). The Node driver is test-only (`node:sqlite` needs Node ≥ 22.13; the
   gate runs on 24). A driver conformance suite (BLOB round trip, key round trip, rollback on
   throw, a `beforeCommit` barrier inside the transaction) runs on both drivers: on the Node
   driver in the gate, on the Expo driver inside the witness app. (85%.)
3. **Keys are encoded; nothing NUL-separated reaches sqlite.** The projected row and answer
   keys are stored in one `key TEXT` column as the JSON encoding of the tuple
   (`["messages","m1"]`; `[op, canonical(args)]`), decoded on open; the round trip is in the
   conformance suite with several rows and several argument sets. (95%.)
4. **One writer per database and partition, and the exclusive transaction regardless.** Every
   driver carries a stable database identity (`SqliteDriver.identity`: the Node driver derives
   it from the opened file's device/inode pair so symlink, hardlink, and bind aliases share
   one lock; the Expo driver from the default directory plus a
   plain basename, and it refuses a path-like name so two spellings of one file cannot earn
   two locks; a custom driver without an identity is refused `E_OFFLINE_CARRIER`). The
   in-process lock table is a process-wide singleton `Map` keyed by identity and partition,
   passed in the way the web passes `navigator.locks`, so a second client on the same
   database and partition in the same runtime
   (StrictMode, an inline `offline` object, a dev reload that leaked a handle) refuses
   `E_OFFLINE_LOCK`. A second *process* can exist on a phone (an iOS extension sharing the
   container, Android multi-process): the carrier does not try to arbitrate it; the exclusive
   transaction makes a concurrent writer fail loudly (`SQLITE_BUSY` → `E_OFFLINE_CARRIER`)
   rather than interleave, and the spec records that two processes on one partition is
   unsupported in v1. (85%.)
5. **The token store is `expo-secure-store` with legal keys.** Keys are
   `snapback2.<name>.token` and `snapback2.<name>.principal` (`[A-Za-z0-9._-]` only); values
   stay under the store's 2 KB limit (a bearer token and a principal do); reads are cached in
   memory after the first keychain round-trip; deletion removes both keys. The partition is
   the principal, as on the web. Peers are pinned to the SDK 54 lines: `expo-sqlite ^16`,
   `expo-secure-store ^15`. (90%.)
6. **The entries are `snapback2/react-native` and `snapback2/expo`, and the hooks are split
   from the carriers.** `react.tsx` is split into `react-core.tsx` (the context, provider,
   hooks, and the platform-neutral pieces) and the web entry that re-exports it plus the web
   components and `indexedDbRangeStore`. `react-native.tsx` re-exports the core plus the
   native components; it is exported as a real subpath `./react-native` (the `react-native`
   condition on `./react` stays, pointing at the same file). The `browser` condition
   precedes `react-native` on `./react`, with matching web declarations, so Metro web
   selects the web entry even when a configuration asserts both conditions.
   SDK 54's default scopes `react-native` to iOS/Android and `browser` to web;
   native imports retain their native entry; imports without either condition use web.
   `snapback2/expo` re-exports
   `./react-native` and adds `expoSqliteStore()`, `expoSecureTokenStore()`, and
   `createExpoClient(options)`, which fills `offline.store`, `tokenStore` (never beside `as`,
   which `createClient` refuses), and `fetch` (`expo/fetch`, because React Native's default
   fetch does not stream and SSE reads `response.body`) when absent. The provider accepts an
   existing `client` prop beside its construction options, so an app can pass
   `createExpoClient()`'s result. **One context module:** `react-core` is emitted as its own
   entry (`dist/react-core.mjs`, exported as `./react-core`) and marked external from the
   `react`, `react-native`, and `expo` bundles by the same plugin that externalizes
   `./client`, so every entry imports the one context; a test imports the provider from the
   built `expo` entry and a hook from the built `react-native` entry and renders. A second
   test asserts the two native bundles contain no `node:` specifier and no `indexedDB`
   reference. (85%.)
7. **The native byte bridge: files are derivatives, never evidence.** The client gains
   byte-oriented read and write paths beside the Blob ones — `assetBytes(url) → { bytes, type }`
   and the cache's `putBytes` — and the native screens use only those (never `useAssetUrl` →
   `Blob` → `URL.createObjectURL`). `useAssetFile(asset, { width })` materializes cached bytes
   as a file under `<cache>/snapback2/<partition>/<byteKey>` and returns a `file://` URI, but a
   file is never consulted as permission: before serving, the hook re-validates the current
   partition, the seal state, the row's lease, and the viewed set through the cache (a file
   whose entry the carrier no longer holds is deleted, not served); the carrier's byte
   removals and a partition wipe delete files, a startup sweep removes orphans (a crash
   between the sqlite commit and the file delete leaves only garbage the sweep removes), an
   in-flight file write is fenced against a custody change, and a custody change invalidates
   mounted consumers (the hook re-runs and yields nothing). View-once media never touches
   disk: the session allowance stays in memory and the viewing instance renders it through a
   data URI or an in-memory source, so a kill leaves nothing to re-show. `AssetVideo` never
   prefetches a view-once clip, calls `markViewed` on play, and plays a cached ordinary clip
   from its file URI. The web components are unchanged. (80%.)
   *Native playback amendment, 2026-09-05 (author requested; implementer: Codex).*
   AVPlayer cannot open the former `data:video/mp4` source. `AssetVideo` now uses
   the bundled `SnapbackMemoryVideo` Expo view for view-once MP4s: iOS feeds
   `AVAssetResourceLoaderDelegate` byte ranges from `Data`; Android feeds
   `MediaPlayer` through `MediaDataSource`. Neither path has a file, URLSession,
   HTTP server, or persistent player cache. Ordinary videos retain `expo-video`.
   Play (or an explicit `autoPlay`) requests bytes; the existing durable viewed
   commit must succeed before any source reaches the player. Missing native
   code refuses before fetch/admission and tells the developer to rebuild the
   app. Expo autolinks the module from the package; Expo Go cannot supply it.
   Completion, unmount, backgrounding, and custody invalidation release native
   resources. Completion prevents replay by that component; a new component
   sees the durable viewed mark and renders no source. Decoder failure after
   admission remains fail-closed: it does not refund the viewing allowance.
   Native event objects are adapted to the public zero-argument playback
   callback. The viewing identity stays the mounted instance across layout.
   *Ordinary native-file amendment, 2026-09-07 (simulator finding; implementer:
   Codex).* AVFoundation will not identify the verified H.264 fixture at an
   extensionless cache path. Durable carrier keys remain extensionless; the
   native derivative maps only the five server-verified media types to fixed
   `.jpg`, `.png`, `.webp`, `.mp4`, or `.mov` suffixes. Unknown MIME values
   cannot contribute path text. Replacement and startup sweep both remove old
   extensionless or wrong-type derivatives. The simulator records warm and cold
   media failures independently so one playback fault does not suppress query,
   recovery, fault, replay, expiry, or driver evidence; any media fault still
   fails the overall witness.
8. **The chat template gets an Expo app beside its web app, and the shared reducers are
   packaged.** `templates/chat/expo/` with Inbox, Thread, Composer, and Search as React Native
   views on the same hooks; the reducers (`conversations`, `threadBubbles`, `searchHeld`, the
   pending-bubble keying by `ids[0] ?? intent`) move from `templates/chat/react/src/chat/log.ts`
   to `templates/chat/shared/log.ts`, imported by both apps as `../shared/log.js` (from
   `react/src/` and `expo/src/`). Today `build.mjs` copies only `snapback/` and `react/` into the
   package and `init` flattens `react/` into the project root, so the move is a packaging
   change: `build.mjs` copies `shared/` and `expo/` too; `init` scaffolds `react/` by default and
   `expo/` with `--client expo`, placing `shared/` where the relative imports resolve after
   flattening; the type-check gate checks both apps against the generated API. No
   `react-native-web`. (80%.)
9. **Two proofs: atomicity in Node, the app's list on the simulator; the app connects
   outward.** (A) *Atomicity* is proven where a kill is deterministic: a `node:sqlite` child
   process runs the sqlite carrier, parks on `beforeCommit` inside the transaction after the
   DML, and is `kill -9`'d by the test; the reopened store holds exactly the pre-swap state
   (rows and bytes), never a mix. This runs in the gate on the same sqlite semantics the
   phone uses. (B) *The simulator witness* proves the §10 list at app level. The harness
   (`scripts/witness-expo.mjs`) hosts a WebSocket server on a fixed port; the template's Expo
   app — not the package — reads `EXPO_PUBLIC_SNAPBACK_WITNESS` (inlined by Metro at bundle
   time, so the variable is set when the dev server or build starts, never at launch) and,
   only when set, connects through `witnessControl` from the dev subpath `snapback2/expo/witness`
   **before constructing the client**: the app's witness screen constructs the client on the
   harness's `construct` verb, after reading the persisted witness configuration in the app
   container (the transport cut, the fault injection) written by earlier verbs, so a relaunch
   comes up offline when the previous run cut the transport (`startOffline`), and a carrier
   that fails to open is still reportable. Verbs: `construct`, `construct(name)`,
   `open(conversationId)`, `send(body)`, `view(assetId)`, `offline`, `online`,
   `barrier(on|off)`, `fault(carrier|none)`, `state` (the store's coverage summary, the
   outbox, and the twin's answer for a named query). The 503 injection is on the owner from
   the harness, as the web witness does. The barrier is inside the carrier's transaction after
   the DML and before `COMMIT`; the app reports "barrier reached" and then awaits a release
   token that only an explicit `barrier(off)` supplies — a socket close never resolves it, so
   JS stays parked until the process dies. The kill is a host `kill -9` of the app's pid
   (`xcrun simctl launch` prints it; the harness records it) followed by a wait for exit;
   `simctl terminate` is not used for the mid-transaction kill. After relaunch the assertion
   is over every store (rows, answers, outbox, meta, bytes) with distinct pre- and post-swap
   markers: the pre-swap state exactly, never a mixture; the post-swap state is a run failure
   because the barrier held. A second kill is at rest. The never-opened chat's offline send is
   asserted **inside the thread query's result** as `predicted` through the `state` verb (the
   twin's answer), not through a rendered bubble, which the reducer would manufacture from the
   outbox regardless. The `chmod` variant of the unwritable-carrier check is scheduled-only.
   (85%.)
10. **The never-opened chat renders through the twin.** §10 of LLP 1012 predates the twin;
    the twin acceptance (LLP 1012 §12) requires a chat the viewer never opened to render
    offline from the drained log, and an offline send to appear inside it as predicted. The
    witness asserts that, and asserts `partial`/`never-held` separately for a query whose
    coverage is genuinely absent (a conversation whose log was never drained). (95%.)
11. **The iOS bundle is measured on a real build.** `expo export --platform ios` on SDK 54
    emits Hermes bytecode; the measurement inspects the emitted artifact (not a `.hbc`
    suffix assumption), records its size and gzip, and attributes the client's and the twin's
    share through source maps — which requires the package build to emit them
    (`build.mjs`: `sourcemap: true`, shipped beside `dist/`); it lands in
    `metrics/expo.jsonl` with the method. The twin's 30 KB ceiling (author ruling
    2026-09-04) is measured on the neutral bundle as today. (85%.)
12. **The journeys do not move to the phone.** `snapback2 test` and `as(name, { store: "file" })`
    remain the five-second loop; the carrier is proven in Node through the `node:sqlite`
    driver and the conformance suite; the simulator witness is the durability evidence and
    the only thing that runs on the simulator. Android and web runs of the Expo app are the
    capability bar's remaining platforms; the witness is written so a second platform is a
    second `simctl`/`adb` adapter. (85%.)
13. **Publication is not this spec's.** The offline bar wants a published package; `snapback2`
    is at 0.0.1 and unpublished. The loop program owns publication; this spec's lanes leave
    the package publishable, and the witness resolves the package through a `dist/` link
    until then.

## 3. The sqlite carrier

Schema, one database file per app (`snapback2.db` under the app's document directory), the
partition as a column so `wipe` is one `DELETE` per table:

```sql
CREATE TABLE IF NOT EXISTS state   (partition TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL);         -- metadata-format sentinel
CREATE TABLE IF NOT EXISTS metadata (partition TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (partition, key));
CREATE TABLE IF NOT EXISTS rows    (partition TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (partition, key));
CREATE TABLE IF NOT EXISTS answers (partition TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (partition, key));
CREATE TABLE IF NOT EXISTS outbox  (partition TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (partition, key));
CREATE TABLE IF NOT EXISTS bytes   (partition TEXT NOT NULL, key TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY (partition, key));
```

`key` is the JSON encoding of the tuple the state uses (decision 3); the byte table has no
type column because `ByteDelta.put` carries `{ key, bytes }` and the MIME type lives in the
state's asset record, as in the IndexedDB carrier. `state.value` is the constant empty
metadata-format and root-inventory sentinel also written in IndexedDB's `meta` store.
Every metadata root (watermarks, grants, overlay, bounds, programs, facts, viewed, and
future fields) has a `[field]` record containing its scalar value or constant container
shell; object/array children use `[field,key]`, including an explicit array-length child.
This prevents a clock update from rewriting all row sequence guards or the held program
while preserving JSON omission, null, sparse-array, and own-property semantics. The shared
projection in `store/projection.ts` keeps the carriers aligned; a test asserts every field
of `PersistedRangeState` survives a round trip on all three carriers.

The projection is one module (`store/projection.ts`) shared by the IndexedDB and sqlite
carriers; it defines the wire form of the state — undefined object fields dropped, `null`
kept, and undefined or missing array slots restored as `null` — and the store keeps its
in-memory state in that same form, so a warm store and a reopened one agree. A first write
uses the full projection to establish the root inventory; only a successfully committed
sentinel enables journal-bounded metadata updates. A store whose rows exist without a meta
record is opened with a default-filled meta on every carrier.

`replace(state, bytes, previous?)`: compute changed projections, then apply only their puts
and removals plus the byte delta inside `driver.transaction`; await `beforeCommit?.()`
before committing. The projection cache advances only after commit succeeds. The store
passes its immutable previous state, so shared unchanged history requires neither cloning
nor serialization for a custody-only swap; direct backend callers may omit that hint and
receive the same atomic result. Every statement runs on `tx`; on Expo the first DML takes
the write lock. `open(partition)`: read the five state tables back through the shared
un-projection; `undefined` when `state` has no row. `readBytes(key)`: one `SELECT`. A Node
rollback failure closes the possibly poisoned connection, and the next queued operation
reopens the same database without replacing the primary transaction error. `wipe`:
six `DELETE`s in one transaction. `close()`: close the database. On open the carrier runs
`PRAGMA journal_mode=WAL` and compares the returned mode (the pragma returns a row, it does
not throw); a mismatch, an unopenable file, or `SQLITE_BUSY` on the exclusive transaction
refuses `E_OFFLINE_CARRIER` with the driver's message; memory is never substituted (LLP 1012
§4). The database lives where expo-sqlite puts it (`Documents/SQLite/` on iOS); `wipe` deletes
rows, never the WAL/SHM sidecars (shared by every partition); the §14 size measurement counts
the database, its sidecars, and the byte-bridge files.

The driver:

```ts
export interface SqliteExecutor {
  run(sql: string, params?: SqliteParams): Promise<void>;
  get<T>(sql: string, params?: SqliteParams): Promise<T | undefined>;
  all<T>(sql: string, params?: SqliteParams): Promise<T[]>;
}
export interface SqliteDriver extends SqliteExecutor {
  exec(sql: string): Promise<void>;
  /** BEGIN IMMEDIATE (exclusive on Expo); the body runs on `tx`; COMMIT, or ROLLBACK on throw. */
  transaction<T>(body: (tx: SqliteExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
```

The conformance suite (`tests/sqlite-driver.conformance.ts`, run on the Node driver in the
gate and packaged for the witness app to run on the Expo driver): BLOB round trip of 1 byte, 1
MiB, and an empty payload; key round trip of `["messages","m\0x"]` and an argument set with
nested objects; rollback on throw leaves no row; a `beforeCommit` barrier that resolves late
holds the transaction open (a second executor blocks or fails with busy, never interleaves);
`journal_mode` reads back `wal` on Expo and whatever `node:sqlite` returns (recorded, not
required).

## 4. Locks, the token store, and the partition

`inProcessLocks()` implements the subset of the Web Locks interface the store uses
(`request` with `ifAvailable`) over one process-wide `Map`; the Expo entry passes it where
the web passes `navigator.locks`. `expoSecureTokenStore(name = "default")` implements the
token store over `expo-secure-store` with the keys of decision 5 and an in-memory cache.
Sealing on a terminal session refusal, wipe on sign-out or a principal change, and the byte
cache's session allowance bound to the partition all come from the runtime unchanged (LLP
1012 §4, §9); the file bridge's per-partition directory is wiped with the partition.

## 5. The entries

```ts
// snapback2/react-native
export * from "./react-core.js";           // context, provider (with a `client` prop), hooks
export { AssetImage, AssetVideo, useAssetFile } from "./react-native/components.js";
// snapback2/expo
export * from "./react-native.js";
export { expoSqliteStore, expoSecureTokenStore, createExpoClient } from "./expo/index.js";
// snapback2/expo/witness (dev only; never imported by the production entries)
export { witnessControl } from "./expo/witness.js";
```

`build.mjs` emits `react-core` as its own entry and externalizes it from `react`,
`react-native`, and `expo` (decision 6), bundles the rest like the other entries
(`--platform=neutral`), and emits source maps; a test asserts neither native bundle contains a
`node:` specifier or the string `indexedDB`, and another renders a provider from the built
`expo` entry with a hook from the built `react-native` entry. `package.json` gains the
`./react-core`, `./react-native`, `./expo`, and `./expo/witness` exports and the peers
`expo-sqlite ^16` and `expo-secure-store ^15`.

## 6. The chat template on a phone

`templates/chat/expo/`: an Expo app (`app.json`, `App.tsx`, `src/screens/{Inbox,Thread,
Search}.tsx`, `src/Composer.tsx`) on `createExpoClient({ url: process.env.EXPO_PUBLIC_SNAPBACK_URL })`
passed to the provider's `client` prop. The reducers move to `templates/chat/shared/log.ts`
and both apps import them; the type-check gate that already checks the web screens against
the generated API checks the Expo screens too. The Composer is disabled until
`useMutation(api.deliveries.post).ready` and shows a refusal's rewrite; past the fence it
shows "queued until the next sync" (LLP 1012 revision (i)). `AssetImage`/`AssetVideo` from
`snapback2/react-native` render the media through the byte bridge, view-once included.

## 7. The simulator witness

`scripts/witness-expo.mjs`, the §10 "O4, simulator" list as steps, each asserted:

1. Start the harness's WebSocket server on its fixed port and the owner on the host with the
   seed; build the template's Expo app for the simulator once with
   `EXPO_PUBLIC_SNAPBACK_WITNESS=ws://localhost:<port>` in the build's environment
   (`npx expo run:ios --simulator <name>`; the script records the build it used).
2. Launch; the app connects to the harness before constructing its client; `login(alice)`;
   drain the inbox; `open` three chats; `view` one ordinary image and one view-once photo.
3. `offline`; `send` two messages.
4. `barrier(on)`; trigger a swap; wait for "barrier reached"; `kill -9 <pid>` from the host
   and wait for exit; stop the owner; `simctl launch` (the persisted transport cut keeps the
   client offline); `construct`; assert through `state`: every store holds the pre-swap
   markers and none of the post-swap markers; the inbox, the three chats, and the two queued
   messages are there; a chat never opened online renders from the drained log through the
   twin and the queued send is `predicted` inside its thread result (decision 10); the
   ordinary image renders from its cache file; the view-once photo does not render and no
   file for it exists in the container.
5. Kill at rest (`kill -9` after a quiet second); relaunch with the owner still stopped: the
   same.
6. `fault(carrier)` over the socket (persisted in the app container); relaunch: the carrier
   refuses `E_OFFLINE_CARRIER` and the control connection still reports it; `fault(none)`.
7. Start the owner; inject a 503 after the commit of the first replay: exactly one row on the
   server; the bubble does not move; the second message commits in order.
8. Expire a message while offline through the recipe; resume: gone from the local search.
9. Run the driver conformance suite inside the app and read its result over the socket.
10. `online` (persisted); relaunch; the client reconnects and the queue drains in order.

**Witness record (2026-09-05).** Run 12 on macOS 26 / Xcode 26.6 / an iPhone 17 simulator
passes all ten steps at the landed revision (`snapback2/target/e2-witness-result.json`); run 9
had passed at the pre-fix-round revision. Rules the twelve runs established: the reopened
database is read through a pre-construct `stores` verb and compared with the pre-kill dump
before the app constructs anything that writes; the witness's markers are schema-valid rows
of real tables (the twin treats a row of an unknown table as corruption and answers
`hydrating`, the fail-closed answer this section wants); the retry after the injected 503 is
the supported explicit `outbox.drain()` after `outbox.settled()` observes the stop; the app
connects outward before construction, the project is refreshed from `dist/` (`shared/`
included) every run, and `node build.mjs` runs first or the previous revision runs; the
control server resets its stale socket when the harness kills the app; the `view` verb
compares file paths, not URI spellings (the bridge percent-encodes the partition). React
Native's `AbortSignal` has no `throwIfAborted`; every cancellation check goes through
`throwIfAborted(signal)` in `client-wire.ts`. The twin carries a debug seam,
`twinLastDecline()` (exported from `snapback2/expo/witness`), naming why it last declined;
never part of a result. Step 2's seeded H.264 clip proves the container scan and the v1
playback (decision 7); step 9's conformance names its body-ended probe honestly — a device
COMMIT failure stays unqualified (ticketed).

It runs on the schedule and files a bounded ticket when red; it does not block a push
(`rules/RULES.md`). The web witness is the precedent for the verbs; its kill is before the
transaction (IndexedDB cannot hold one across an await). The deterministic mid-commit kill is
decision 9's Node proof in the gate; step 4 here asserts "no torn state" at app level.

## 8. The bundle and its size

Decision 11: the Hermes bytecode of the template's release build, its size and gzip, and the
client's and twin's share by source map, in `metrics/expo.jsonl` with the method. The twin's
ceiling is measured on the neutral bundle exactly as `metrics/twin.jsonl` does today.

## 9. Tests and the fast loop

- Package tests: every carrier-parametrized test runs on the sqlite carrier through the Node
  driver; the driver conformance suite; the projection round trip on all three carriers; the
  in-process locks; the token store's key layout and cache (through a fake secure store that
  enforces the key alphabet and the value limit); the two native bundles' purity; the byte
  bridge on a fake file system (write, evict, wipe with the partition; `AssetVideo` marks
  viewed on play and never prefetches a view-once clip).
- The template's Expo screens are type-checked in the final gate beside the web screens.
- The journeys stay in Node; the witness is the simulator's only job.

## 10. Publication

Not this spec's. The lanes leave `snapback2` publishable: the two entries in the exports map,
peers declared, `node:` unreachable from the phone entries, and the witness resolving the
package through a `dist/` link until the loop program publishes.

## 11. Lanes and reviews

Implementer: codex `gpt-6-astra` at xhigh (author ruling 2026-09-04). Reviews per lane, blind:
codex astra read-only, grok 4.6 xhigh, Muse ultra. Fix rounds at most three.

- **E1 — the carrier, the drivers, the entries, the locks, the token store, the build:** §3,
  §4, §5 (the `react-core` chunk, source maps, `expo/fetch`), the projection module, the
  Node `kill -9` atomicity proof, §9's package tests except the byte bridge. Dispatched on
  revision (c); a third design round runs beside it and gates only E2.
- **E2 — the byte bridge and the native components, the template's Expo app and its
  packaging (`build.mjs`, `init`), the witness client and harness, the bundle measurement:**
  decisions 7–11, §6, §7, §8; one full witness run on the host's simulator in the report.
  Starts on E1's head on this revision (the third round's findings were all E2-scoped and are
  folded here; the E2 lane's own blind reviews judge the result).
- The Android adapter for the witness and the web run of the Expo app are the capability
  bar's and wait.

## 12. The Exact 2 arm (recorded for when it starts)

Held by the author's ruling of 2026-09-04 until Exact 2 settles. What that arm consumes, all
of it pinned today: `snapback2-core`'s `ClientStore` is the twin (this program proved the
TypeScript twin byte-identical to it on every golden and the corpus, so the Exact arm's local
evaluation is the engine itself); the wire (`DeliveryEnvelopeV1`, `POST /api/resume`, the
grant and the replay envelope, the trace shape; the Rust types in
`crates/snapback2/src/protocol.rs` and the goldens in `crates/snapback2-core/tests`); a sqlite
carrier in Rust reading §3's plain schema; the four eviction rules, the outbox ledger, and the
byte cache under the row lease. It does not need the React hooks, the twin bundle, or the
JavaScript carriers. The trigger to start: Exact 2 settling on sqlite, or a first Exact app
needing offline.

## 13. Diagnostics

No new code. `E_OFFLINE_CARRIER` carries the driver's message (unopenable file, journal mode
mismatch, busy on the exclusive transaction); `E_OFFLINE_LOCK` from the in-process table;
everything else is LLP 1012 §15.

## 14. Measurements to record

- store bytes on the phone, Clique at ten thousand messages across fifty conversations (the
  sqlite file size);
- swap time on the simulator at that size, including incremental state writes;
- cold replay time to first inbox paint on the simulator;
- the Hermes bundle's size and the client's and twin's share (§8);
- the witness's pass, dated, per platform: iOS simulator 2026-09-05 (run 12, all ten steps);
  Android full witness none; targeted memory-video playback, no-file and
  reopen-denial probe passed on API 36.1 (2026-09-05); web none.

**Desktop review workload (2026-09-05).** Hold 1,000 / 5,000 / 10,000 messages
with 500-character bodies in 50-row answers, then enqueue three small entries without
changing history. Before the fix the three 10,000-row updates took 195 / 204 / 209 ms
and the last inserted 10,204 records. After the fix every update inserts two records
(one outbox entry and the scalar header), with no history deletes or inserts. The
ordinary store path, passing its immutable previous state, took under 0.5 ms for every
sample at all three sizes. The original instrumentation wrapper, which omits that hint,
still took only 7 / 6 / 6 ms at 10,000 rows. Serialized state at that size fell from
13,326,555 to 6,934,932 bytes after replacing body fingerprints with digests. These are
desktop Node SQLite measurements, not physical flash-write volume or phone latency.

## 15. Not doing

Android and web runs of the Expo app (the capability bar's), multi-process arbitration on one
partition (unsupported in v1, refused loudly),
`react-native-web`, push, background fetch, and anything LLP 1012 §11 already lists.
The native memory-player repair in decision 7 is implemented; Android whole-app
qualification is separate from compiling or probing that player.
