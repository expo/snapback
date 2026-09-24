# Client and operations

[Back to the package guide](./README.md).

For TypeScript actions use the generated `server()` wrapper described in
[server handlers](./SERVER.md); it enforces the application's precise handler
signatures. A custom runtime host can use the lower-level registry entry below
with that generated manifest and already checked handlers. It does not infer
application-specific argument/result types itself:

```ts
import { startServer, type ServerHandlers } from "snapback4/server";
import { manifest } from "../snapback/generated/server";

function hostCheckedHandlers(handlers: ServerHandlers, signal: AbortSignal) {
  return startServer(manifest, handlers, { signal });
}
```

## Offline web starter

`npx snapback4 init --web` copies the maintained Vite chat reference, including
its production app shell, account-bound saved route and write IDs. Default
`init` remains schema-only. Run `npm install`, `npx snapback4 check`, then
`npx snapback4 dev` and `npm run dev` in separate terminals. Build with
`VITE_SNAPBACK_URL=https://your-backend npm run build`; serve `dist/` over HTTPS.
Routes use `#room=<id>`.

The build ends with `snapback4 web-shell dist`. Navigations use the active
worker's cached HTML even online, so its HTML and lazy assets stay together
until a waiting build activates after the old tabs close. This command also works on
`expo export -p web` output: it precaches every file in a content-hashed cache,
registers `snapback4-sw.js` in every HTML file idempotently, and resolves exported
subpages (`/about/` to `about/index.html`, `/contact` to `contact.html`) online and
offline before falling back to the root `index.html`. Pass `--base /chat/` when serving a subpath;
use the same base in the bundler. For Vite run
`npx vite build --base=/chat/ && npx snapback4 web-shell dist --base /chat/`.
It waits for old tabs to close before switching builds. Development has no worker.
Keep all exported files nonpersonalized; this is a static export, not SSR.
Cross-origin requests and non-exported API/media requests pass through untouched.
The worker never caches network navigation responses. The starter explicitly uses
`localStorageSessionStore()` for page-restart continuity; any script on that
origin can read the token. Choose this persistence deliberately.

Held room navigation reads conversation and membership before rendering the
thread; unknown offline rooms remain uncertain. Write references are saved
before SDK dispatch and reopened with `usePendingWrite(op, id)`, without
resubmission. `markRead` demonstrates a nonpredicting queued write. Failed and
unknown receipts stay visible; a settled write does not imply a fresh read.
Sign-out hides the account, completes only after local credentials are removed,
and keeps its replica/outbox intact. A storage failure stays visible for retry.
See the generated README for residency tables, horizon choices and the
production offline-reopen journey; fixture residency remains
`test --residency --fixture <directory> --as <principal>`.

## 4. The client

`createApp` is the ordinary entry point. Construct it once outside React render.
Its auth is `restoring` while opening or clearing a session, then becomes `signed-out` or `signed-in` with `viewer`.
`ready` resolves after restoration; `auth.onChange` observes it. Signup, login and
guest return `SignIn`; refusals are `{ ok: false, why }`. Logout clears local
credentials and attempts server revocation; `logoutEverywhere` revokes every
session after server confirmation. `auth.why` exposes a restore/storage failure.

```tsx
import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { webDevice } from "snapback4/web";
import { AppProvider, useAuth } from "snapback4/react";
import { api } from "../snapback/generated/api";
const app = createApp({ url: "http://127.0.0.1:4400", device: webDevice(), sessionStore: localStorageSessionStore() });
function Account() {
  const auth = useAuth();
  return <button onClick={() => void (auth.state === "signed-in" ? auth.logout() : auth.guest())}>{auth.state}</button>;
}
function Root() { return AppProvider({ app, children: <Account /> }); }
async function send(conversationId: string) {
  await app.ready;
  return app.mutate(api.send, { conversationId, body: "Hello" });
}
```

Omit `device` for the online tier; pass `nativeDevice` or `processDevice()` for
other local hosts. `fetch` injects the transport. Omit `sessionStore` for memory
only; browsers explain that choice in the console. Web persistence is always
explicit. `app.client` changes on restore, sign-in, logout and account switch;
`AppProvider` supplies that client to all existing hooks and resets account-owned
component state. `useAuth()` returns the current state, viewer, failure and actions.
Call `app.close()` to stop a runtime while preserving its session for restart;
an in-flight rotation finishes and saves its replacement before close completes.
`app.auth.logout()` fences restoration and session writes immediately, deletes
local credentials without waiting for network requests, and revokes remotely
in the background.
When another app replaces the stored session during restoration, opening restarts
with that session. A stale restoration or rejected bearer cannot overwrite or
delete the other app's stored successor.
Logout also advances a persisted session epoch under the same lock as deletion.
If the marker write fails, logout still deletes the bearer and retries the marker
after freeing that space; a remaining storage error is returned and sets `auth.why`.
Sign-in and refresh work started in an earlier epoch cannot save a late bearer;
the app revokes that bearer and retires its client. Invalid or expired stored
sessions are cleaned up only if their exact bytes still match the read, without
remote revocation. A concurrent replacement restarts restoration.

Local writes use the existing device outbox. Online `app.mutate` (also
`app.client.mutate` and `useMutation` under `AppProvider`) records ID and arguments
before dispatch, retains uncertain writes through restart and sign-out, and
recovers them only under their original backend/account. Terminal receipts keep
no historical result; `client.write(id)` collects one. Session and journal keys
encode backend and principal segments as fixed-width hexadecimal; adapters pass
keys through unchanged. Journals also record their backend and owner, and each
pending intent records its owner. A damaged or foreign record is preserved under
a `.damaged.` side key, replaced with an empty journal, and reported in
`auth.why`. No saved intent from that record is replayed. If preservation fails,
sign-in still succeeds but writes stay blocked until storage is repaired.

This pre-release format does not automatically import earlier session keys or
ownerless app journals: the earlier SecureStore names were ambiguous. Those old
bytes remain untouched; sign in again after upgrading. Local device outboxes and
server data are unchanged.

Browser Web Locks serialize journal updates and session replacement/deletion
across tabs. A refused bearer clears only the same token still in storage; it
cannot delete a successor saved by another tab. Explicit logout revokes any
stored successor it clears. Custom stores shared across independent non-browser
processes need one active app writer because `SessionStore` has no atomic update
primitive. Storage errors remain errors; they never authorize an unstored send. A failed
startup keeps the client signed out. Logout retries failed credential deletion
even when a prior outbox save failed.

The lower-level clients remain available for development personas and hosts that
already manage their own session lifetime:

The generated `api` groups a module’s operations under `api.<module>`: `api.social.follow`, not `api.follow` (§1).

The local client routes queries using the compiled `runs` word. An observed
server-run query refreshes when a commit touches its tables; offline, its
observation is `loading`. A direct `query()` may return a remembered server
answer with `fresh: false` and `since`, or `denied: E_OFFLINE` when none exists.
It never uses an empty device page as a server answer.

```ts
import { createLocalClient } from "snapback4/local";   // the local-first tier
import { webDevice } from "snapback4/web";             // the device on the web
import { createClient, mintId } from "snapback4/client"; // the online tier (no store)
import { api } from "../snapback/generated/api";

async function openThread(conversationId: string) { // an existing conversation this viewer belongs to
  const online = createClient({ url: "http://127.0.0.1:4400", persona: "alice" });
  const client = await createLocalClient({ url: "http://127.0.0.1:4400", persona: "alice", device: webDevice() });
  if (client.link() === "online") await client.sync();
  const thread = await client.query(api.thread, { conversationId });
  const intentId = mintId(); // Keep this id with the intent for any retry.
  const write = await client.mutate(api.send, { conversationId, body: "hi" }, { id: intentId });
  const invitation = await client.act(api.invite, { email: "friend@example.com" }, { id: mintId() });
}
```

The local-first client opens the device — the Rust module, the same
interpreter the server runs: as wasm on the web (`webDevice()`, the
partition in memory and kept in IndexedDB behind each call), as the
native module on Expo (§7), as a process in Node (`processDevice({ dir, binary?, spawn?, writeFile? })` from
`snapback4/native`) — syncs the viewer's partition into it, runs every
query on it, queues every mutation durably and predicts its rows when local
facts permit, and follows the server's stream for the rest. The device keeps the compiled
backend too, so a device that starts with no network opens on what it
holds (`link()` is `"offline"`, reads carry `fresh: false` and `since`)
and catches up when the link returns. A device needs a kept backend to open
offline. Merely installing that backend does not acquire its partition: until
a snapshot and catch-up finish, partition-dependent reads fall back to the
server or return `E_OFFLINE`, and writes queue without invented predictions.
`client.acquired` and React's `useAcquired()` become true after the snapshot
and catch-up finish for the current store, including an empty partition.
They stay true offline and across an offline reopen, and become false when
store replacement or schema adoption invalidates acquisition. The online tier
has no local partition and reports false. `onAcquired` observes changes.
Await `client.sync()` when `client.link() === "online"` before exposing a
screen that needs offline prediction immediately; skip that wait on an offline
cold start. A sync interrupted by link loss or a refused partition can return
without acquisition, so the flag remains the authority.
Network fetch failures resolve `sync()` normally and set `link()` to `"offline"`;
the public method resolves without a value. A transient network failure must
not block opening. An opener's catch should close and rethrow only an unexpected
exception, while returning the client when sync ends without acquisition.
A successfully acquired empty partition is still known data. When upgrading a store that lacks acquisition metadata, one completed online
sync is required;
existing durable writes remain queued. Safe literal-default-only schema
widening keeps acquired images readable; a reset or newly added table requires
acquisition again.
A replaced backend store also requires acquisition again, even at the same
schema generation: sync's store identity discards old rows and held/left
history, keeps unsent writes without their predictions, and never replays a
write whose receipt is already known. The reset durably requires the new
store's backend to be adopted before acquisition can publish; a failed schema
fetch, offline reopen or restart preserves that requirement. Replacement
observation immediately drops freshness and invalidates remembered answers
and watches; outstanding reads from the previous store are retried.
Orphan tabs transfer unknown writes without predictions, retire receipts
known to belong to another store, and retain unresolved receipts with their
source identity until ownership can be compared. First identification of a
legacy acquired device also discards retained left-group history, even on
the same database; already-left groups cannot be reacquired. An identified
same-store snapshot preserves ordinary retained history. A legacy backwards
watermark counts as replacement only behind that request's own watermark,
while its acquisition capture is still current.
Reconnect verifies the backend identity before local answers become fresh;
an unchanged store resumes its long poll without another sync. A matching
`store_id` with a head below the device's published progress, private transfer
progress, or retained private image head is a restore or shrink:
`E_STORE_RESTORE` halts sync and refuses reads, including after an offline
reopen. The old watermark and outbox remain in place. Stop that client and use
a fresh device store and outbox for the restored backend; retry, refill or
backend adoption does not silently reacquire that identity. Authenticated probe,
change-feed and sync replies all reach the device's restore validator before
replay, freshness or adoption decisions. The validator uses the progress and
retained image head captured before each request. A later private advance
cannot erase that evidence or falsely turn an older healthy response into a
restore; obsolete healthy replies retry. Schema adoption also compares the
progress captured before fetching that schema, atomically with installation.
The JavaScript client requires a device module with this capture protocol. Each native owner binds its interpreter and loaded
module digest to the adopted store identity. Another owner's replacement
requires adoption and module reload before local reads or prediction resume.

On the web, a failed save rejects the call and discards its uncommitted in-memory
state. The next serialized call reopens the last persisted state; earlier
durable writes survive. When a replacement or adoption save succeeds, existing
answers and acquisition are invalidated even if later host recovery fails.
Successful publication likewise preserves its affected-watch reruns before
host recovery. Failed startup releases the store lock. Runtime bytes
become the offline entry only after initialization and cache persistence; if
that save fails, the same bytes may retry, while changing the initialized
runtime requires reloading the page. `snapback4 web-shell <dir>` supplies the static offline
HTML/JavaScript shell for exported apps.

The client owns the session, link, transport and read observation. Its options: `url`; `device`;
one of `persona` (development), `session` (from `snapback4/auth`, kept
and restored for this JavaScript runtime by default), or `guest: true`
(mint one when none is kept); `sessionStore`; `fetch`; `waitSeconds`. It
has `query(op, args) → Read`, `observe(op, args) → { getSnapshot(), subscribe(listener) →
unsubscribe, close() }` (a live read; React's `useSyncExternalStore`
shape), `mutate(op, args, options?) → Write`, `act(op, args, options?) → Act`, `link()`, `onLink`, `viewer()`,
`onViewer`, `onWrite`, `session()`, `onSession`, `refreshSession()`,
`logoutAll()`, `signOut()`, `sync()`,
`close()`. `onWrite` reports the terminal `sent` or `failed` outcome of a
write that first returned `pending`; it is a live-client notification, while
the durable outbox remains the authority across a restart. A restored or
provided session within 24 hours of
expiry rotates before the protected backend is fetched (temporary action sessions cannot refresh); a running client
schedules the same rotation. A successful rotation replaces the stored
session and the Authorization bearer before `onSession` receives it. Local
`signOut()` fences refresh and removes persisted credentials before completing;
remote logout is best effort and cannot hold that local boundary open. An
in-flight rotation may still return its successor for remote logout, but cannot
adopt or persist it after sign-out. An already-started session-store write must finish before deletion. Storage
failure rejects sign-out and may be retried; `close()` alone keeps credentials.
After
`signOut()` the client is closed and `session()` is null, as it is once
the server refuses the session: anything that keeps the token — a native
image header, a presence lease — takes it from `onSession` (`useSession`
in React) and stops when it is null, so nothing reads a token after
sign-out. `logoutAll()` does the same after the server confirms every
session for the principal was revoked; an offline refusal leaves this
session in place so the operation can be retried. The online client takes
`url` with `persona`, `session` or `token`, and has the same card except
`sync()`, which is device-only. It keeps its session in memory and rotates
near expiry; `refreshSession()` adopts the new bearer before `onSession`
receives it. A persona client's `session()` is null; a bare-token client's
is null until `refreshSession()` returns the session. Applications that
persist an online session keep its replacements from `onSession`.

**Node.** `dir` is required, and a blank string refuses the same way, before the opener is returned; stores live there and the directory is created on first open. `binary` uses `SNAPBACK4_BIN`, then the platform package (or a repository build); `spawn` and `writeFile` default to Node’s functions.

```ts
import { createLocalClient } from "snapback4/local";
import { processDevice } from "snapback4/native";
import { login } from "snapback4/auth";
const url = "http://127.0.0.1:4400";
const signedIn = await login(url, "alice@example.com", "a-long-password");
if (!signedIn.ok) throw new Error(signedIn.why.message);
const session = signedIn.session;
const client = await createLocalClient({ url, session, device: processDevice({ dir: ".snapback4/devices" }) });
if (client.link() === "online") await client.sync();
await client.close();
```

On the web, `mutate` waits for the outbox's IndexedDB commit, and `pagehide`
or becoming hidden sends only the oldest unconfirmed write with an authenticated
keepalive request, including a retry of that same head if an ordinary send
is in flight when the page exits. A blocked or oversized
head is never skipped. Requests share the browser's 64 KiB body budget; unsent or unconfirmed writes
stay durable for retry on reopen, with mutation-id dedupe preventing duplicates.
If an exit response has not finished after one second, ordinary flushing
retries that same durable head before advancing; an unknown outcome never
skips a write. `close()` stops waiting immediately without cancelling the
keepalive request.
An admission that finishes while the page is suspended rechecks the exit
transport after its commit; on reopen, a matching server store identity and
non-regressed head allow unknown writes to replay before the first sync finishes.
With an exclusive provider claim (a Web Lock for built-in IndexedDB), the web
device records the mutation id, operation,
arguments and minted row ids synchronously in localStorage, in call order,
before `mutate` returns its promise. Same-origin navigation can therefore leave before IndexedDB admission
commits: the next client admits those records before new writes, then sends
through the ordinary outbox with the original ids. A closed tab's records are
adopted by the next device that opens the store, under the same provider claim.
Adoption runs with that device's first sync, so a receipt from a closed tab
answers `client.write(id)` once that sync completes, not at the moment it opens.
Recovery and new admissions take submission numbers from the same device counter;
already-queued writes precede recovered orphan records. A matching orphan waiting
for backend adoption installs the destination's authenticated backend first. An
orphan missing its kept backend or store identity is skipped with its journal
intact until a later matching open can establish ownership; a broken orphan does
not prevent healthy stores from opening.
Recovered records stay bound to their original backend store identity; a
replacement retires them without sending them to the new backend.
The journal allows at most 32 records and 256 KiB of UTF-8 keys and values per
device store; a serialized record over 64 KiB is not journaled. Unavailable,
throwing or full localStorage, an unidentified backend store,
exceeded journal limits, or browser storage clearing leave unawaited navigation
best-effort: that write can still be lost before IndexedDB commits. A destination must open
a client to recover a record that never reached the outbox; keepalive remains
best-effort and sends only admitted writes.
For programmatic navigation, `await client.mutate(...)` before navigating
is the strongest durable boundary; handle a `failed` outcome before leaving.
`pending` means IndexedDB admission is durable and the server outcome still
needs confirmation. A write-specific admission refusal returns the ordinary failed
outcome and removes its journal record, replaces it with a non-executable
cancellation, or acknowledges it in IndexedDB. If both stores reject cancellation,
the recovery outcome is indeterminate: the executable record can survive and a
later matching recovery admits it for a server decision. A successful local
prediction is retained; a local refusal is not terminal during recovery, so that
record queues without a prediction. The returned refusal alone does not guarantee
preserved cancellation in that case.

On the web one tab is one device: a second tab on the same store opens
its own, and the writes a tab left queued when it closed are adopted by
the next device that opens the store. The built-in IndexedDB provider refuses
to open when the Web Locks API is unavailable, because two durable owners of
one name can overwrite each other's state. A custom `Persistence` must provide
an exclusive `claim(name, alternate)` operation used both for opening a device
and for nonblocking orphan recovery. An alternate claim must use the
`${name}:tab-*` namespace and requires `others(prefix)` plus `remove(name)` so
its durable work is discoverable and adoptable after release. A non-alternate
claim must return the exact requested name or `null`. `memoryPersistence()`
supplies a single-realm implementation for tests. `webDevice({ wasm })` takes the
wasm as a URL, a Response, bytes or a compiled module when a bundler
cannot resolve the default beside the module; `webDevice({ persist:
memoryPersistence() })` keeps nothing, for tests:

```ts
import { webDevice, indexedDbPersistence, memoryPersistence } from "snapback4/web";
const persistent = webDevice({ persist: indexedDbPersistence() });
const ephemeral = webDevice({ persist: memoryPersistence() });
```

While a change poll is active, **link loss is reported within 5 seconds**
on a running browser or native host: heartbeats arrive every 2 seconds,
and 4 seconds without response bytes marks the link `offline` and aborts
that poll. Native fetch hosts without response streams use polls of at
most 2 seconds with the same 4-second watchdog. Browser `offline` events
are an immediate hint; `online` events trigger the authenticated `/probe`
recovery check. The local client polls while open; the online tier polls
while it has observed reads. Suspended hosts cannot run timers or deliver
notifications until resumed. Closing a client removes timers and event
listeners. Custom fetch transports must honor abort and forward response
chunks promptly when exposing streams.

### The card

Every word a screen reads is on the card (`snapback4/contract`):

```ts
import type { Cursor, ReadMeter } from "snapback4/contract";
type Read<T> =
  | { data: T; complete: boolean; cut: "meter" | "words" | null; fresh: boolean; since?: number; next?: Cursor | null; meter?: ReadMeter }
  | { loading: true }
  | { denied: Refusal };
type Write<R> =
  | { state: "pending"; id: string; reason?: string }
  | { state: "sent"; id: string; seq: number; replayed?: false; result: R }
  | { state: "sent"; id: string; seq: number; replayed: true; result?: never }
  | { state: "failed"; id: string; why: Refusal };
type Refusal = { code: string; family: string; message: string; detail?: string; site?: string; rewrite?: string; guide?: string; rule?: string; retryable?: boolean };
type Link = "online" | "offline" | "signed-out";
```

To measure a real account's server read in development, use the online
client (the same session or bearer token works alongside a local client):

```ts
import { createClient } from "snapback4/client";
import { isReady } from "snapback4/contract";
import { api } from "../snapback/generated/api";
const client = createClient({ url: "http://127.0.0.1:4400", token: process.env.SNAPBACK_TOKEN! });
const read = await client.query(api.thread, { conversationId: "existing-conversation" });
if (isReady(read)) console.log(read.meter); // { examined, indexEntries, probes, steps, heapBytes, outputBytes, rowsWritten, cut }
await client.close();
```

`Read.meter` contains the engine's counters for that server answer, including
examined rows, index entries, rule probes (`probes`), steps, charged heap work
(`heapBytes`), output bytes and rows written. These are work counts, not latency
or process memory. Successful `query` and `observe` answers carry them; a
local fallback keeps its previous answer's counters only until the fetch settles. Local device
reads have no meter. Loopback `dev` includes the field by default; `meter: true`
and `x-snapback-meter: 1` on `POST /q/<op>` remain explicit forms. `serve` ignores the header and never
returns meters. They can reflect hidden work, so they are development-only.
For local-store inspection, `snapback4 run <op> '<json args>' --as <principal id>
--json` prints the same engine counters under `metered`, using their Rust names
(`rule_probes`, `heap_bytes`, etc.). `--as alice` resolves a declared persona to
`dev:alice`; any other value is a literal principal id, such as `user:...` from
the account's session or an application principal such as `member:42`.

`cut` is `"meter"`, `"words"` or `null` on every ready read, online and on
both device stores. An empty page with `cut: "meter"` means partial: retry
narrower, or continue if `next` exists; never "no matches". `"words"` means
the first search term exceeded 32 words in a scope: narrow it or use scoped
search. If both limits cut, `"meter"` wins.
Device reads and uniform server reads keep precise reasons.
Non-uniform server reads report `cut: null`: the reason is withheld, with `complete: false` still truthful.
`null` means "not disclosed here", not "not cut"; it also covers a horizon,
missing coverage or a page without continuation. For `complete: false` with
`cut: null`, render "Results may be incomplete", even when empty; never "no matches".
The precise reason remains in development-only `Read.meter.cut` (`"meter"`,
`"words"` or null, with `"meter"` winning); `serve` never returns that meter.
If the server cannot answer the query, declare `query … held:` to answer
from the device; the server refuses it with E_QUERY_HELD (see the search card).
A complete empty page has `cut: null` and `complete: true`.

A typing indicator or presence row with a short deadline needs a local
filter. This is an application table, separate from the server's `connected[p]`.
That server-decided connection signal has no `expiresAt`.
A row already returned stays in that answer until the next answer;
the server will not return it again after expiry, but does not push a removal
at that instant. Select `expiresAt` with the row (`guide reads` has a complete
typing table and query). Pass the ready typing rows to `showExpiringRows` and
render their principals as typing. It renders now and schedules a render at
each deadline, without waiting for a server answer.
The local client reschedules its watch at `Read.nextExpiry`; keep the render
filter so the row hides at its deadline rather than at the refetch.
Call the returned cleanup before replacing the answer or unmounting.
This example is for short-lived rows; JavaScript timer scheduling applies.

```ts
function showExpiringRows<T extends { expiresAt: number | null }>(rows: T[], render: (rows: T[]) => void) {
  const paint = () => render(rows.filter(row => row.expiresAt === null || row.expiresAt > Date.now()));
  paint(); const timers = rows.flatMap(row => row.expiresAt === null ? [] : [setTimeout(paint, Math.max(0, row.expiresAt - Date.now()))]);
  return () => timers.forEach(clearTimeout);
}
```

A read denied by a table's rule answers as an empty page, not a refusal,
and a client cannot tell it apart from an empty readable page — by design,
so that a hidden row cannot be probed. For access UI, use a membership query
the viewer may read, such as a conversation lookup readable by its members:
a member gets the conversation even when its message page is empty.
An explicit `require … else CODE` still refuses with the program's code.
Online observations retain nothing and discard responses older than observed commits in the same store.
A store identity change (`E_STORE_REPLACED`) or same-store sequence regression
(`E_STORE_RESTORE`) permanently denies this online client's reads and fails its
queued and in-flight writes without retry; whether those writes executed is unknown.
Create a new client to recover; `createApp` automatically closes, reopens and
publishes its online client on `E_STORE_REPLACED`, retaining the session if the
replacement store accepts it and retiring outstanding intents before reopening.
An admitted `createApp` write reports a terminal outcome only after its durable
retirement is saved; a failed save leaves the outcome `pending`, even during replacement.
Within a store, replayed mutation receipts never lower the read floor: their
historical commit sequence is separate from the current store head.
A stale response gets at most three refetches, after 25, 50 and 100 milliseconds;
exhaustion leaves `loading` until the next invalidation, and closing the last
observation owner cancels its retries.
A local observation may keep its previous answer with `fresh: false` and `since`
only during an unavailable device read's server fallback, ending at fetch
settlement or any local commit, reset, adoption, generation, account change or close.
An unavailable device read asks the server while online even with pending writes.

`complete` says this is everything the query can answer: false when the
meter cut the page, when a scan's read rule is not decided by its prefix
(`guide bounds`), when a page declared without a cursor had more rows than
it holds (declare `c: cursor ?` and page with `after c`; `check` notes
it), or when a local read passes the horizon. `fresh` says the device has
everything the server had at the last sync (`since` is the last sync's
time when it does not, and absent when the device has never finished
one); `next` is the cursor for the next page (pass it as the query's
`cursor ?` argument); a page with a cursor and more rows is `complete:
true` with `next`. A row this device wrote and the server has not yet
confirmed carries `pending: true`. A write is `pending` while the link is
down, while the server has not answered within four seconds, or when the
client closes with it in flight (it lands when the link returns, and the
row loses `pending` when it does), `sent` with the server's sequence, or
`failed` with the refusal and its predicted rows withdrawn; the online
client fails an in-flight write at `close()` with `E_CLOSED` instead,
since nothing queues it. `onWrite` emits that later terminal result once for
the same id, and `useMutation.last` follows it. `family` is `input`, `schema`, `auth`, `rule`
(your `require` codes, with `rule` naming the code), `constraint`,
`bound`, `op`, `asset`, `prediction`, `generation` or `store` from the
engine, and `link` or `client` from the client itself. `isReady`,
`isLoading`, `isDenied` narrow a `Read`.

A fresh `sent` outcome carries the server's typed `result`, including reused ids,
shaped objects and `null`. If that first reply was lost, the same-id retry returns
`sent` with `replayed: true` and no `result`: execution was confirmed, but historical
read authority is not retained. Check `write.state === "sent" && !write.replayed`
before using `write.result`. For a replay, read the current state through an
ordinary query if needed; do not issue a new mutation to recover the old result.
A queued write's eventual `onWrite` event and `useMutation.last` preserve the same
fresh-or-replayed outcome; `useMutation.run()` returns the outcome of its call.
Pending writes have no predicted result: their predicted rows carry `pending`.

Writes that do not predict show pending with `usePendingWrite(op)`. Its
`pending` flag starts at `run(args)` and stays true until `sent` or `failed`,
including the interval before admission returns an id. `last` is the Write;
`run` returns that call's outcome, like `useMutation`. A pre-acquisition write
that queues without a row reports `reason: "queued without a row: not acquired yet"`.
Other missing local evidence reports `reason: "queued without a row: local data does not justify prediction"`.
A predicted write has no such reason; predictions remain visible on rows.

```tsx
import { useAcquired, usePendingWrite } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function PendingSend({ conversationId, savedId }: { conversationId: string; savedId?: string }) {
  const acquired = useAcquired();
  const send = usePendingWrite(api.send, savedId);
  return <>
    <button disabled={send.pending} onClick={() => void send.run({ conversationId, body: "hi" })}>Send</button>
    {!acquired && <small>Local data is still acquiring.</small>}
    {send.pending && <small role="status">{send.last?.state === "pending" ? send.last.reason ?? "Sending…" : "Sending…"}</small>}
    {send.last?.state === "failed" && <small role="alert">{send.last.why.message}</small>}
  </>;
}
```

Keep the returned mutation `id` with the application's view state and pass it
as `usePendingWrite(op, savedId)` after reload. Recovery observes that id; it
never submits again. `await client.write(id)` also reads its latest outcome,
and `onWrite` receives later terminal changes. An unknown id returns
`undefined`, as does an evicted terminal id once it leaves the outbox. The
online client keeps at most 256 terminal outcomes in memory. The local client
reads terminal receipts directly from one device metadata record holding the
last 256 server outcomes; it reads pending writes from the current outbox,
so another native owner's settlement cannot leave a stale pending outcome.
Neither receipt reads nor repeated flushes refresh the window. Queued terminal
writes emit at most once per client: their event ids stay remembered until the
outbox entry leaves. Reopen keeps that receipt window:
recovered success has `replayed: true` and no historical result; recovered
failure keeps its code and family with the message `write refused: CODE`.
Refusals before durable admission, the online tier and mock remember outcomes
only for that client lifetime, up to 256 terminal outcomes. Before deleting an
adopted web tab's store, the host copies its value-free terminal receipts into
a shared window for the same server and viewer, bounded to 256 receipts in
recovery order. Existing shared ids keep their outcome and position. Every
opener and `client.write(id)` reads that window alongside its own device's
256 receipts; reads never copy or refresh it. A different tab winning adoption
cannot hide the receipt from a reload. Outboxes remain exclusively owned:
a held Web Lock is never taken; a queued background lock request wakes recovery
when its owner releases it, and closing cancels the wait. Unidentified journals
wait for a matching open or sync signal. Persistence failures get at most three
retries, after 1, 2 and 4 seconds; later opens or sync signals can try again.
Receipt lookups do not create the shared window before adoption. Browser storage
clearing or eviction from both receipt windows can still make an id unknown. Rebuild the Expo native binary with this client
version: acquisition is a device protocol field, and an older module refuses
startup with `E_DEVICE_VERSION`.

For replay adapters and retry-safe intents, pass a `mintId()` you stored with
the intent or fixture; arbitrary fixture strings still need an application ledger.
Pass it as `{ id }`; a retry returns the original outcome and never applies twice:
`client.mutate(op, args, { id })`. Online, web and native clients accept the
`mintId()` form: 26 uppercase Crockford base32 digits
(0123456789ABCDEFGHJKMNPQRSTVWXYZ), starting with 0–7. A malformed id returns
local `failed` with `E_WRITE_ID`. Mint once and keep it with the intent;
prediction mints separate row ids through `new_ids`. The caller id is the
mutation id in the outbox, `/m` request, receipt, `client.write(id)` and
`usePendingWrite(op, id)`.

A burst in one process keeps the observed millisecond and increments the
80-bit entropy field, so ordering does not manufacture future `minted_at`
values; clock rollback continues that logical millisecond. A new logical
millisecond is seeded with `crypto.getRandomValues` when the host supplies it.
Not every supported host does. The legacy no-crypto fallback remains for
compatibility and is not cryptographically secure; IDs are identities, not
capabilities.

A same-client retry while pending returns the same Write object; a settled
retry returns its retained receipt, without historical results. Reopen reuses
queued writes before predicting or admitting them. Already-open owners of one
device store compare and admit under its transaction: equal input keeps the
original entry and row ids, and conflicting input changes nothing during a send.
Different operation names or JSON arguments under the same id return local
`E_WRITE_ID_REUSE` when the input is known: unresolved submissions, this
client's last 256 terminal input
identities, or the recovered outbox. Object key order does not matter. The
refusal does not replace the original outcome or emit a terminal event for it.
A receipt recovered after reopen has no arguments to compare and returns the
original outcome. If neither outbox nor receipt knows the id, the server's
record, keyed by principal and mutation id, compares the sent operation and
canonical raw wire arguments. Identical retries replay; different operations
or arguments refuse `E_ID_REUSED`. Legacy receipts without a recorded binding
replay as before. Use a new id for a new intent. Each client remembers used ids for
its lifetime (ids only after the bounded input/receipt window); a known id
whose receipt was evicted and whose outbox entry is gone returns
`E_WRITE_RECEIPT_EXPIRED` instead of being admitted again. Reopen to ask the
server for that outcome. At-most-once belongs to the same backend store.
For a caller-supplied id with no local outcome, a prediction or validation refusal
queues without a row so the server can consult its replay record. The synchronous
journal preserves that replay eligibility across navigation. Without a replay
record, the server executes or refuses against its current state. Separate live
web tabs have separate outboxes; the server deduplicates their requests under
the same principal and id. Different principals may use the same id independently.

`webDevice()` stores wasm bytes by SHA-256 digest in IndexedDB and opens from
them without a network fetch on reload. It also persists the compiled backend
with the device rows, so a device that opened and synced online can reopen
offline. Custom wasm URLs should identify immutable module versions.

A sent replay receipt carries `replayed: true` and no result. Narrow with
`write.state === "sent" && !write.replayed` before using `write.result`;
query the current state when a replay needs a value. Both client tiers and
React mutation settlement preserve the receipt. `Client.signOut()` clears
local credentials and closes the client; remote session revocation is best effort.
Applications keeping an online session with `keepSession` also call
`forgetSession` on their own store (§6); the local client clears its managed store.

### React

```tsx
import { SnapbackProvider, useClient, useQuery, usePage, useMutation, useAction, useLink, useViewer, useSession, useAsset } from "snapback4/react";
import type { Client } from "snapback4/contract";
import { api } from "../snapback/generated/api";
import { Image, Text, View } from "react-native";
function Thread({ conversationId }: { conversationId: string }) {
  const inbox = useQuery(api.inbox, {});
  const { items, hasMore, loadMore, read } = usePage(api.thread, { conversationId });
  const send = useMutation(api.send); // send.run(args) → Write<R>; send.last follows settlement
  const invite = useAction(api.invite);
  const link = useLink(); // "online" | "offline" | "signed-out"
  const viewer = useViewer();
  const session = useSession(); // null once the local session ended
  const client = useClient();
  const photo = useAsset(items[0]?.photo?.id);
  return <View>
    <Text>{link}: {items.length} messages</Text>
    {photo.status === "ready" && <Image source={{ uri: photo.url }} style={{ width: 240, height: 180 }} />}
    {photo.status === "loading" && <Text>Loading photo…</Text>}
    {photo.status === "empty" && <Text>No photo</Text>}
    {photo.status === "denied" && <Text>{photo.why.message}</Text>}
    <Text onPress={() => void client.signOut()}>Sign out</Text>
  </View>;
}
export function App({ client, conversationId }: { client: Client; conversationId: string }) {
  return SnapbackProvider({ client, children: <Thread conversationId={conversationId} /> });
}
```

`useQuery` observes: it re-renders when a sync or a local prediction
touches the query's tables, and at the next visible `expire at` time even
when the device is offline. `usePage` follows `next` across pages; it
supplies the query's cursor argument itself, which must be named `c`
(`c: cursor ?`).

### Assets

```ts
import type { Client } from "snapback4/contract";
import { api } from "../snapback/generated/api";
async function sendPhoto(client: Client, conversationId: string, file: Blob) {
  const uploaded = await client.upload(file); // also accepts ArrayBuffer | Uint8Array
  if (uploaded.ok) await client.mutate(api.sendPhoto, { conversationId, photo: { id: uploaded.asset.id } });
}
```

The local-first client can retain ordinary viewed images and videos:

```ts
import { createLocalClient } from "snapback4/local";
import { webDevice } from "snapback4/web";
const client = await createLocalClient({
  url: "http://127.0.0.1:4400", guest: true, device: webDevice(),
  assets: { keep: "viewed", maxBytes: 64 * 1024 * 1024 },
});
if (client.link() === "online") await client.sync();
```

`keep: "none"` is the default and purges previously retained media on open.
`keep: "viewed"` retains successfully fetched ordinary assets, evicting the
least recently used to stay within `maxBytes` of payload bytes. Storage belongs
to this server, principal and device: IndexedDB on the web, files in Documents
with the Expo opener, and device metadata with the process opener. `client.asset`
and `useAsset` use retained bytes offline and revalidate every online fetch.
A home row leaving its partition, being deleted or cleared, or expiring purges
its bytes (including offline expiry); sign-out purges them too. Stream changes
are checked before sync completes, and reopening checks lifetimes before reads.
A `once` response never enters storage. This cache does not change the server's
`private, no-store` responses. `assetSource` supplies a network URI; use
`client.asset` or `useAsset` to use SDK retention, including native file URIs.
The Expo cache gives retained MP4 files a `.mp4` suffix for native playback;
older extensionless MP4 entries migrate within the same cache when read.
Rebuild the app with `snapback4-expo` 0.2.24 or later to include this host repair.

Passing `null` or `undefined` to `useAsset` returns `{ status: "empty" }`
without fetching. A client-side fetch or blob-URL failure returns a typed
`denied` state.

An `image <=N` or `video <=N` column holds an upload: the client sends
the bytes first (`upload` → `{ ok: true, asset: { id, type, bytes, width,
height, duration } }` or `{ ok: false, why }`; the server sniffs JPEG,
PNG, WebP and MP4 and refuses the rest with `E_ASSET_TYPE`, and anything
over the largest column's bound with `E_ASSET_TOO_LARGE`). Images must have
nonzero dimensions, at most 16,384 pixels per side and 40 million pixels
total; video must have a positive duration of at most one hour
(`E_ASSET_BOUNDS`). It then places
`{ id }` in the mutation. Inside the mutation the argument already
carries the facts the server established, and the row carries them. The local
client keeps its upload receipt, so `{ id }` also predicts after an offline
reopen. Missing receipts queue the write without prediction; argument-supplied
facts never substitute for a receipt.
Every fact key is present; `width` and `height` are null for video,
`duration` for images. Bind `duration = clip.duration`, then `require
duration != null else DURATION_UNKNOWN` before `require duration <=
60000 else TOO_LONG`. One asset, one home: your own upload, placed once
(`E_ASSET_UNKNOWN`, `E_ASSET_PLACED`). Serving is the home row's read
rule: `client.asset(id)` fetches the bytes under the viewer's credentials
and resolves `{ url, type, bytes, revoke }` — a blob URL, transient data URL or
retained file URI, and `revoke()` for when the screen is done — or `{ denied }` (`useAsset` in React
revokes on unmount; `client.assetSource(id)` gives `{ uri, headers }`
for native image and video views); a row that is deleted, whose column
is cleared, that expired, or that the viewer may not read answers
`E_ASSET_UNKNOWN`. A column declared `image <=N once` serves one view per
principal after placement, including the uploader; an unplaced owner preview
is exempt. The second is `E_ASSET_VIEWED`. Range is refused before consuming a
once view (`E_ASSET_RANGE`); ordinary unsatisfiable ranges return 416. Every
asset response is `private, no-store`, and at most two uploads write at once
outside the engine mutex. Uploads are online only; there is nothing to queue.

The SDK owns fetched response Blobs: it releases them after an ordinary retained
copy finishes, or when the transient handle is revoked. On React Native, byte
copying uses `FileReader` when `Blob.arrayBuffer` is absent, and transient
revocation also closes the native Blob. If the host cannot create an object URL,
`FileReader` makes an in-memory data URL from that same response, then the SDK
closes the Blob. Revoking that handle clears its URL; callers must drop any
copied data strings when closing the view, since those copies cannot be revoked.
Revoking a retained file handle leaves the ordinary cache's lifetime unchanged.
Once bytes never enter that cache. Native release does not promise immediate
memory zeroization or removal of decoder copies. Upload Blobs remain owned by
the caller.

### Sign-in (`snapback4/auth`)

`guest(url)`, `signup(url, email, password)`, `login(url, email,
password)` and `refreshSession(url, token)` return `{ ok: true, session
}` or `{ ok: false, why }` (each takes an optional final `fetch`). Refresh
atomically invalidates the presented token, so adopt the returned session;
the local client does this through its method and `onSession` lifecycle.
`logout(url, token)` ends one session; `logoutAll(url, token)` confirms
`{ ok: true, revoked }` after ending every session for the principal. A
session is `{ principal, kind, token, expiresAt }` (`kind` is `"guest"` or
`"user"` for built-in identity, or the application kind a service minted);
pass it to `createLocalClient({ url, session })` once and the client keeps
it in memory by default. Memory prevents another page script from reading
the bearer out of browser storage, and means a reload must sign in again or
receive the session from the application. For continuity, pass a
`sessionStore` with async `get`, `set`, `delete`; `expo-secure-store` fits,
with the key made filesystem-safe as in §7. `localStorageSessionStore()` is
an explicit web opt-in when persistence across reloads is worth making the
bearer readable to every script on the page. Ordinary guest and password
sessions last seven days. Signup requires at least 8 characters (Unicode scalar values)
and at most 1,024 UTF-8 bytes; login accepts at most 1,024 UTF-8 bytes.
Attempts and concurrent Argon2 work are bounded by the
host. On loopback, `dev` allows as many concurrent Argon2 slots as the host's
available cores, capped at 16 and never below 2; `serve` keeps two slots.
Full slots refuse with retryable `E_RATE_LIMIT`.
The schema opts in with `use identity` (guests and password accounts),
`use identity guests` or `use identity password`; without it the `/auth`
routes refuse with `E_AUTH`. `snapback4 dev` also admits personas;
`snapback4 serve` (a release) admits tokens only.

An email-and-password product declares `use identity password`; plain
`use identity` also mints guest sessions.

An application that authenticates its own accounts — a phone number it
verified, a member of its own directory — mints their sessions through a
service (below) and hands each token to that account's device, which then
talks to the server directly with `createLocalClient({ url, session })`;
the principal is the application's own name for the account
(`member:42`), outside the engine's namespaces.

Session helpers can also be used directly; choose memory or explicit browser persistence:

```ts
import { guest, signup, login, refreshSession, logout, logoutAll, memorySessionStore, localStorageSessionStore, sessionKey, keepSession, restoreSession, forgetSession } from "snapback4/auth";
const url = "http://127.0.0.1:4400", email = "alice@example.com", password = "a-long-password";
const store = memorySessionStore(); // or the explicit browser opt-in below
const persisted = localStorageSessionStore();
const key = sessionKey(url);
const visitor = await guest(url);
const registered = await signup(url, email, password);
const signedIn = await login(url, email, password);
if (signedIn.ok) {
  await keepSession(url, signedIn.session, store);
  const kept = await restoreSession(url, store);
  const rotated = await refreshSession(url, signedIn.session.token);
  if (rotated.ok) await logoutAll(url, rotated.session.token);
  await forgetSession(url, store);
}
if (visitor.ok) await logout(url, visitor.session.token);
```

#### Profile onboarding after sign-up

Check handle availability with a query before sign-up. The unique index is
still authoritative: another signup may claim the handle between that check
and the profile mutation. Write the profile in the first mutation after
sign-up, and keep the signed-in session if that write fails so the user can
choose another handle. On sign-in or reload, a profile query returning null
routes to the profile screen; loading and denied reads are separate states.
A session without a profile is onboarding, never an app stuck loading.

```quarry
use identity
table profiles:
  principal: principal
  handle: text 3..20 format handle
  unique principal
  unique handle
  public 'handles are discoverable before signup'
  insert <- .principal = viewer
  online only

query handleAvailable(handle: text 3..20 format handle):
  return not exists profiles[handle = handle]

query myProfile():
  return profiles[principal = viewer]

mutation createProfile(handle: text 3..20 format handle):
  insert profiles { principal: viewer, handle }
```

The availability query needs a guest session (`use identity` enables guests)
or an existing session. A password-only product uses `use identity password`
and checks availability after sign-up with that session.
Reuse the signed-in client on the profile screen:

```ts
import { createClient } from "snapback4/client";
import { guest, signup } from "snapback4/auth";
import type { Client } from "snapback4/contract";
import { api } from "../snapback/generated/api";
const url = "http://127.0.0.1:4400";

async function profileScreen(client: Client) {
  const profile = await client.query(api.myProfile, {});
  if ("loading" in profile) return "loading";
  if ("denied" in profile) return "error";
  return profile.data === null ? "profile" : "app";
}

async function register(email: string, password: string, handle: string) {
  const visitor = await guest(url);
  if (!visitor.ok) return { error: visitor.why.message };
  const beforeSignup = createClient({ url, session: visitor.session });
  const available = await beforeSignup.query(api.handleAvailable, { handle });
  await beforeSignup.close();
  if (!("data" in available) || !available.complete || !available.fresh) return { error: "Try checking the handle again" };
  if (!available.data) return { error: "Choose another handle" };
  const account = await signup(url, email, password);
  if (!account.ok) return { error: account.why.message };
  const client = createClient({ url, session: account.session });
  const write = await client.mutate(api.createProfile, { handle });
  // Keep client/session on failure; the profile screen retries createProfile, not signup.
  if (write.state === "failed") return { client, screen: "profile", error: write.why.message };
  if (write.state === "pending") return { client, screen: "profile", waiting: true };
  return { client, screen: await profileScreen(client) };
}
```

On a pending profile write, wait for its terminal outcome before submitting
again; after a failed write choose a new handle and retry `createProfile`.
Apply `profileScreen` to the client created from `login` too.

### Action results (`use server`)

`client.act(op, args)` returns `Act<R>`: `{ state: "done", id, result }`,
`{ state: "failed", id, why }`, or `{ state: "pending", id }`. A denial
before admission is `{ denied, id }`: offline is retryable `E_OFFLINE`.
The request is durable before the server waits up to 25 seconds; if its
handler has not settled, the wire answers HTTP 202 with retryable
`E_ACTION_PENDING`. Pass `{ id: previous.id }` as the third argument to
collect the recorded result; the server marks a replay `replayed: true`.
A lost transport response also returns pending because admission may
have succeeded. Actions never enter a device outbox or predict rows.
`{ waitSeconds: 0 }` only admits or collects; the maximum/default is 25.
`useAction(op)` returns `{ run, last, inFlight }`, mirroring `useMutation`.
`Act`, including its pre-admission denial, is a new card word needing the
author's ruling (LLP 2000.000 §8).

### Workers and services (`snapback4/worker`)

```ts
import { runWorker, mintSession, revokeSessions, listEffects, GiveUp } from "snapback4/worker";
const url = process.env.SNAPBACK_URL!, token = process.env.SNAPBACK_SERVICE_TOKEN!;
runWorker({ url, token, effects: { notify: async (payload, meta) => {
  const sent = await fetch("https://push.example.com/send", { method: "POST", headers: { "idempotency-key": meta.id }, body: JSON.stringify(payload) });
  if (!sent.ok) throw new GiveUp("Push provider refused the notification");
  return { providerId: meta.id };
} } });
const queued = await listEffects(url, token, "queued");
const session = await mintSession(url, token, "member:42", "member", 30);
await revokeSessions(url, token, "member:42");
```

The generated host, `startServer`, does not use `runWorker` for the effects the
schema declares. It runs the declaration-bound arm, `runGeneratedEffects`: one
fenced claim loop per declared effect, each claim carrying that declaration's
contract digest from the generated manifest, so a changed or missing declaration
stops the worker with `E_EFFECT_GENERATION` instead of running a stale handler.
`startServer` builds the registry from your handlers; the arm is shown here so
the contract is visible, not as something an app writes by hand:

```ts
import { runGeneratedEffects, type GeneratedEffectOutcome } from "snapback4/worker";
import { manifest } from "../snapback/generated/server";
const url = process.env.SNAPBACK_URL!, token = process.env.SNAPBACK_SERVICE_TOKEN!;
const generated = runGeneratedEffects({ url, token }, {
  notify: {
    declarationContract: manifest.effects.notify!.contract,
    execute: async (effect, meta): Promise<GeneratedEffectOutcome> => {
      const sent = await fetch("https://push.example.com/send", { method: "POST", headers: { "idempotency-key": meta.id }, body: JSON.stringify(effect.payload) });
      if (!sent.ok) return { kind: "active-error", error: "push provider refused the notification", retry: false };
      return { kind: "settle", result: { providerId: meta.id } };
    },
  },
});
await generated.done;
```

A service is a principal `service:<name>` with a bearer session of its
own: `snapback4 token --service pusher` prints it once (`--release <dir>`
for a deployment). The token and one newline are the whole of stdout, with
prose on stderr, so capture it with `TOKEN=$(npx snapback4 token --service pusher)`.
Stderr names the owning store: `.snapback4/store.sqlite` in the project, or
`<dir>/store.sqlite` for `--release <dir>`. Mint a token for each isolated audit
or proof store; tokens from another store do not authenticate there. After
starting persistent `dev` in that proof project's directory and waiting for
its first stdout line (the listening URL), mint the script's credential there:

```sh
npx snapback4 token --service audit > .snapback4/audit-token
# For a deployment instead:
npx snapback4 token --service audit --release ./proof-release > ./proof-audit-token
```

The service name must match the script's rule grants. `--fresh`/`--memory`
has no disk store for the token CLI to mint into; use persistent dev for these
scripts. Each new empty store needs its own mint step.
Rules admit it like any principal (`insert <- viewer =
'service:ranker'`); with its token a worker claims what the backend
`emit`s under a lease, performs it, and settles it — a thrown handler
retries with backoff, `GiveUp` fails it at once, the returned value is
kept beside the effect — and mints or revokes the sessions of the
accounts the application authenticates itself. `meta.id` is the
idempotency key a provider should see.
A read rule may grant `viewer = 'service:pusher'` beside its sync audience;
`check --residency --verbose` lists the service grants, which admit server reads without adding device partitions.

With `use server` in `schema.q`, the same worker handles `actions: { invite: async (args, meta) => result }`.
Its `meta.session` is client-ready: `createClient({ url, session: meta.session })`
runs reads and writes under the REQUEST's principal, never the worker's.
The session cannot refresh or enter worker/minting routes, and dies on
settlement or lease expiry. It lasts 60 seconds by default; set
`actionSessions: { invite: 120 }` and `lease: 120` per handler (the shorter
wins; maximum 900, capped by the admitting family's live expiry). A claim
fails terminally with `E_ACTION_AUTHORITY` when its admitting family expired
or was revoked, or its principal generation changed. Refresh preserves the
family; fresh sign-in does not. Result collection requires the original
authority, otherwise it returns `E_ACTION_UNKNOWN` without the result.
Thrown errors retry after 2 seconds, doubling to
5 minutes and at most 8 attempts; `GiveUp` fails at once. Action results
are JSON, bounded by the unchanged 1 MiB output ceiling. The worker only
claims supplied handler names; effects and actions wait independently.
Development clock advances extend a held action's lease and viewer session
by the same duration, capped by the admitting family's expiry; ordinary
sessions keep their expiry.

With `snapback/server.ts` (preferred) or the legacy `snapback/worker.ts`, `.mts`
or `.mjs`, `dev` starts Node 24 in an explicit environment rather than
inheriting the parent environment. The child receives only `PATH`, `HOME`,
`TMPDIR`, `LANG`, `LC_ALL`, `TZ`, `NODE_OPTIONS`, `SNAPBACK_URL`, every secret
name declared anywhere in the schema, and a per-child
`SNAPBACK_SERVICE_TOKEN`. Generated server handlers get a frozen
per-handler subset through `ctx.secrets`; the Node application remains trusted
and can inspect its process environment, as can a legacy worker. Only the
legacy development worker prints its service token once for compatibility;
generated server entries and `serve` never print it. Supervised stdout/stderr
redacts declared secret values and the service token across chunks. The host
restarts crashes with 250 ms to 5 s backoff and stops the child when dev exits.
`doctor` shows the worker file and request queue by state. In production,
`serve <release-dir> --worker <path>` supervises the entry (resolved from the
command's working directory) and runs it in the active release directory with
the same explicit environment. `doctor --release <dir>`
reports starts, restarts and crashes. `why <id> [--release dir]` prints work
metadata and payload sizes/digests; `--values` opts into stored payloads.
Mutation arguments and results are not recorded. Child sessions last at most
one day; the host replaces the child within that window and revokes the old
child's family at startup, including after SIGKILL. `dev --worker` is refused;
use the conventional `snapback/worker.ts`, `.mts` or `.mjs` path. `apps/chat/snapback/worker.ts` is the invitation example:
it mints a session for `member:<email>` and returns only `{ principal }`.

### The mock (`snapback4/mock`)

`createMockClient({ viewer, tables, ops })` is a client with the same
card over in-memory tables, for component tests: `ops` is `{ queries:
{ name: (tables, args, viewer) => value | page(rows, next) }, mutations:
{ "table.verb": (tables, args, viewer, mint) => ids | Refusal } }` — a
mutation named `t.verb` marks the rows of table `t` pending until
`settle()` commits it (`commitDelayMs` and an initial `link` are options);
`setLink("offline")` flips the link; `upload` accepts anything as a 1×1
PNG and `asset` is always denied.

```ts
import { createMockClient, mockId, page } from "snapback4/mock";
const id = mockId();
const client = createMockClient({ viewer: null, tables: { messages: new Map([[id, { id, body: "hello" }]]) },
  ops: { queries: { thread: (tables) => page([...tables.messages!.values()], null) }, mutations: {} },
});
```

## 5. Development

**Schema evolution.** New optional columns, required columns with literal
defaults, non-unique indexes, tables and operations adopt without ceremony.
Literal defaults materialize in older row images on the server and device,
including in new indexes, without rewriting rows or logging partition events.
Required columns without a literal default, tighter types, unique indexes
and stronger constraints need the existing rows to fit; `default now` and
`default viewer` on a new required column need an empty table. `check`
opens `.snapback4/store.sqlite` read-only when it exists, or the explicit
`--store <path>`, and prints each failed successor step as `E_ADOPT` at its
column, index or table, with a rewrite. `dev` refuses the same step on save
and keeps the previous generation. A green `check` against the dev store
means that store's current rows adopt the compiled schema; a later write
can change that result. Without a store, `check` only compiles. `data`
and `sql` show an old row with its literal default too (a device's
persistence export stays the raw stored image). Changing the
default of an existing required column rechecks the unique indexes and
caps over it, and a group that no longer fits is `E_ADOPT` like any other
step.

- **`snapback4 init [dir] [--online|--expo|--web]`** starts a project without overwriting existing files. An
  existing `package.json` keeps its metadata; required dependencies, devDependencies and scripts merge into it
  through an atomic replacement, so a failed package write leaves the original intact. A different value for
  the same required key refuses with the key and both values before any file is written. Run `npm install`
  again after merging a starter. The default writes the local-first todo schema and `.gitignore`; `--online`
  adds an online client, package.json and README. `--expo` copies the chat starter with its backend,
  invitation worker, screens, secure session store and native/online tier selection. Its toolchain matches the
  reference app: Expo **57.0.22**, React Native **0.86.3**, React **19.2.3**, expo-sqlite **57.0.3**,
  babel-preset-expo **57.0.11**. Keep Expo and its Babel preset on the same major; a mismatch can leave
  private fields in the bundle that Hermes cannot compile. The generated README gives the install and run
  commands. For Following, declare `maintain feed: timeline` before adding
  events or edges; `guide feeds` has the complete program.

- **`snapback4 dev [--port N] [--no-watch] [--fresh|--memory] [--replay] [--hold-effects] [--hold-schedules]
  [--clock-offset +25h]`** serves `snapback/*.q` on `127.0.0.1:4400`, recompiling and re-adopting on every
  save (the watcher polls every 400 ms; a save with problems keeps the previous generation serving and prints
  the diagnostics); the store lives in `.snapback4/store.sqlite` and persists across runs, and `--fresh`
  (alias `--memory`) uses one in memory that dies with the process (acceptance scripts start from nothing).
  The stderr banner prints `store: in memory — dies with this process` for either flag, or `store: <SQLite
  path>` for persistent dev. For dev and serve, readiness is the first stdout line: the listening URL, emitted
  after store and native-module setup. Wait for that line before requests; lifecycle logs use stderr. For a
  replay mode that must not emit notifications, run `snapback4 dev --replay`: new emits are never delivered.
  The startup banner says effects are suppressed and schedules held; `doctor` reports the persisted dev replay
  and schedule policy. The write's transaction keeps only a durable `suppressed` count, shown by `doctor`,
  with no queued payload. Mutations, explicitly run jobs, results and meters behave normally. Replay also
  holds schedule admission; restarting without it resumes at the next boundary and skips held periods,
  including when the schedule changed while held. Already queued jobs still run, with new emits suppressed.
  Effects queued before replay keep their ordinary lifecycle. `--hold-effects` only prevents worker claims:
  effects remain durable and become claimable after restarting without the flag. `--hold-schedules` only
  prevents schedule admission and skips held periods on restart. The holds are independent; choose `--replay`
  when new effects must never be delivered. Suppressed effects never become deliverable after any restart. The
  policy stays on the dev store for local `run` invocations until the next host start; restarting without
  `--replay` restores normal emission for new writes and preserves the count. With `--fresh`, the count dies
  with the in-memory store; `doctor` and local `run` inspect the separate on-disk store. `serve`, deployment
  and `--release` invocations refuse `--replay` with `E_REPLAY_DEV_ONLY`; production always emits normally.
  `dev` writes `api.ts` on start and on every adoption, and refuses a store that belongs to a deployment
  (`E_GENERATION`). Personas (`use personas ..`) sign requests from the same machine with the
  `x-snapback-persona: alice` header (the client's `persona: "alice"`), acting as `dev:alice`. For loopback
  identity requests, `dev` removes the per-peer and per-email minute counters and prints that fact and the
  host's Argon2 slot count once at startup: available cores, capped at 16, minimum 2. Connection/worker caps
  remain; `serve` keeps two Argon2 slots and the 30-per-peer and 10-per-email limits. `dev` and `serve` print
  the listening URL and one newline first on stdout; with an application worker, `dev` also prints its
  one-time token after that URL. Startup explanations, lifecycle messages and supervised worker logs go to
  stderr. Process exits carry a one-line stderr diagnostic with the verb, serving generation and reason:
  `SNAPBACK4_EXIT` for returned errors/stops, `SNAPBACK4_PANIC` for panics on any thread (including abort
  builds), `SNAPBACK4_SIGNAL` for signals, and `SNAPBACK4_THREAD_EXIT` if the watcher or maintenance thread
  stops. An unexpected background stop ends the server. Generation `0` means this process has not served yet.
  `SIGINT`, `SIGTERM` and `SIGHUP` report immediately; with an application worker they clean it up and exit
  `128 + signal`. Otherwise, and for fatal signals such as `SIGBUS`, termination is immediate with the OS
  signal status. `SIGKILL`, power loss and an unwritable stderr cannot be reported from inside the process.
  `snapback4 why SNAPBACK4_SIGNAL` explains the code.
- **Development clock:** `snapback4 dev --clock-offset +25h` starts 25 hours ahead; `snapback4 clock advance
  185s [--port N]` advances a running dev and waits for expiry sweeps and queued jobs, so an `every 2m`
  schedule and a three-minute expiry need no real wait. Missed periods fire once; held schedules stay held.
  Each job chunk keeps its normal meter and commit. The JSON response names `now`, `advancedMs` and `work`
  counts, including parked jobs. A maintenance error leaves time advanced and pending work retries on the
  normal tick; do not blindly repeat the advance. Durations are positive whole numbers with `ms`, `s`, `m`,
  `h`, `d` or `w`, optionally prefixed `+`; the startup offset alone may be negative. Mutations at `POST
  /m/<op>` stamp `now` from this dev clock. The dev clock keeps ticking monotonically and cannot advance
  backwards. Its offset resets on process restart; supply it again to continue a test. Rows stamped under an
  offset keep their times after restart; use a fresh store per offset test. Devices receive the ordinary sync
  deletion and row timestamps, and keep their own local clocks. `serve` refuses every clock control with
  `E_CLOCK_DEV_ONLY`; invalid or backward advances refuse `E_CLOCK_INPUT`. Scripts may call the same
  loopback-only dev endpoint, `POST /dev/clock/advance` with `{"duration":"+2m"}`. `guide clock` has the
  recipe.
- **Adoption health.** A refused dev adoption stays visible in `doctor` and its reason repeats on the first
  failing job or sweep. Writer-lock and generation failures retry without another save, including reopening
  after a CLI adoption. Identical background store and generation failures are then suppressed while that
  adoption failure is pending; recovery or a changed adoption failure reports the suppressed count and resets
  it. Changed reasons print at most twice per error code in each 60-second window; further changes count as
  suppressed too. `doctor` compares the live host generation with the store and uses the host's dev clock for
  deferred pushes. A `--no-watch` host needs a restart after another process adopts; a schema refusal needs a
  corrected save. A stopped host's deferred deadlines use wall time.
- **`POST /seed`** (dev only, same machine) takes `[{ "table": "t", "row": { "id": "..", .. } }, ..]`, writes
  the rows as the system principal in one commit (rules bypassed; validation, constraints, aggregates and sync
  apply) and answers `{ "seeded": N }`. For recorded-action replay that must not emit notifications, run
  `snapback4 dev --replay`: new effects are never delivered and schedules are held. `guide replay` explains
  the restart and explicit-job behaviour.
- **`snapback4 run <op> ['<json args>'] [--as <persona|principal-id>] [--now <milliseconds|+duration>]
  [--json]`** runs one operation against the local store (defaults to `dev:alice`; declared personas get the
  `dev:` prefix and other principal ids are used verbatim) and prints the result, the meter and, for a
  mutation, the partition events; a job runs whole as the system (`--as` is ignored) and prints its run.
  Before admission, store opening and schema adoption retry only SQLite BUSY/LOCKED for up to 15 seconds,
  reporting the operation and elapsed wait. `E_RUN_BUSY` stops without admitting the operation; other store
  errors keep their meaning. The deadline bounds contention retries; it cannot cancel an atomic activation
  already running or limit job execution time. A completed activation can persist even when the operation
  remains unadmitted after a timeout or source edit. Source changes during the wait refuse
  `E_RUN_SOURCE_CHANGED` before admission; check the source and invoke the intended operation again. Watching
  dev reopens after external CLI adoption; `--no-watch` must restart. If a writer outlasts the deadline,
  inspect `doctor` and the adoption log, wait for the writer or stop your dev host, run once, then restart
  dev. There is no retry after job or mutation admission. After an interrupted invocation, inspect its work
  before starting another one: a new job command creates a new run ID. `--now 1789352669447` pins the
  invocation to Unix milliseconds, so a post can be created in the past without a special seed; `--now +25h`
  uses wall time plus the duration. This pins queries, mutations and jobs equally; it does not change a
  running dev clock or fire schedules. Exit 1 on a refusal or a parked job, 2 on an engine error.
- **`snapback4 test [--residency [--verbose]] [--fixture dir] [--as persona]`** loads a fixture (one
  `<table>.jsonl` per table; a file for an unknown table is skipped) into a fresh store in memory (without a
  fixture, the project's dev store), runs every query as each persona with arguments derived from the data (a
  reference is the table's first row, a principal the persona, a text the shortest that fits, an int 0, a time
  now, a bool false, an enum its first variant, an optional or a cursor null), prints the meters beside the
  ceilings and the arguments it used, and names any query it could not run (an `id`, list, json, bytes, image
  or video argument cannot be derived). A query's own `require` refusing a derived argument (the persona is
  not in that group) is reported, not counted as a failure; run it with your arguments to see its meters.
  `--residency` instead prints a bounded cold-acquisition report: the eight largest table/persona pairs by row
  bytes, a summed remainder and totals. Add `--verbose` for all tables, residency facts, notes and query
  meters. Device-only `held` queries print `not run: <name> is held (device only)` once and are skipped,
  including with `--residency --verbose`: a server fixture is not the device's acquired partition. Exercise
  those queries through a local client. In tests, use `snapback4 clock advance <dur>` or `POST
  /dev/clock/advance`; each example line advances the running dev once.

  ```sh
  snapback4 clock advance 36s
  curl -X POST http://127.0.0.1:4400/dev/clock/advance -H 'Content-Type: application/json' -d '{"duration":"36s"}'
  ```

- **`snapback4 check [--cost|--residency|--fix|--json|--verbose]`** compiles, writes
  `snapback/generated/api.ts` (`Rows`, `Ops`, `api`), and prints diagnostics with their sites and rewrites;
  `--cost` adds each site's structural class, and `--residency --verbose` names where operations run.
  `--residency` measures the active dev store read-only, or add `--fixture dir` to measure current source on a
  fresh fixture; `--as persona` selects the viewer. It prints the same bounded acquisition report as test.
  With no dev store it prints facts and a fixture command, never a zero-row measurement. A parser recovery's
  empty-operation error is hidden when an earlier error in that same operation already explains it and its
  rewrite adds no repair. The summary counts the hidden cascades; `--verbose` shows them, and `--json` always
  retains every diagnostic. Independent errors stay visible. `--fix` applies only diagnostics explicitly
  marked `mechanical`: an ambiguous key's `by`, a cursor index's missing `id`, and exact canonical spelling
  rewrites, including `==` to `=` and `a?.b` to `a.b`: ordinary field access already propagates null, and
  removing only the `?` evaluates the base once even when it is a call or read. Before it edits, every
  compiled file must be unchanged on disk, and every compiled file is read again just before the write. This
  check is best effort: it refuses an edit it observes and names the file; a save in the instant before the
  write can still be overwritten. It prints one `fix:` line per change to stderr, re-reads the project,
  recompiles, and reports the remaining diagnostics normally (`--json` remains one JSON result on stdout;
  `--cost` prose goes to stderr when combined with `--json`). Unmarked design suggestions are left for the
  author. **`snapback4 types`** writes `api.ts` alone and prints its path plus one newline on stdout, with its
  status on stderr.
- **`snapback4 sql "<SELECT …>" [--release dir] [--limit N] [--json]`** inspects the developer's own store,
  **never rule-filtered**. It opens `.snapback4/store.sqlite` read-only alongside `dev`, or a deployment's
  store with `--release`; no schema adoption and no writer lock. Temporary views expose each application
  table's `id` and columns from the active compiled schema; a required column an old row lacks reads its
  literal default, and an absent optional column reads null. Scalar tags are unwrapped; compound values remain
  canonical tagged JSON. Only one `SELECT` or `WITH … SELECT` is allowed: writes refuse `E_SQL_READ_ONLY`, and
  internal tables (including raw `r`/`i` and SQLite metadata) refuse `E_SQL_INTERNAL`. The result is bounded
  to 200 rows by default and says when more exist. The table is stdout; the inspection header and
  row-count/truncation notice go to stderr. `--json` returns `columns`, positional `rows` (retaining every
  selected column), `limit`, `more`, `ruleFiltered: false`, and the same inspection header. For example:
  `snapback4 sql "SELECT conversationId, count(*) FROM messages GROUP BY conversationId"`.
- **`snapback4 device <store.sqlite> [backend.json]`** runs the native
  device over stdin/stdout, one JSON request and answer per line.
- **`snapback4 --help`** lists every verb and its flags; `deploy`, `rollback` and `serve` are described in §6.
- **`snapback4 token --service <name> [--days N] [--release <dir>]`** mints a service's bearer token into the
  project's store (or a deployment's) and prints it once. The token and one newline are the whole of stdout
  (even with `--json`), with prose on stderr, so capture it with `TOKEN=$(npx snapback4 token --service
  worker)`. Stderr names the owning store; each isolated store needs its own token (§4, Workers and services).
- **`snapback4 why <E_CODE | op | table>`** explains a refusal code, an operation's arguments, result and
  cost, or a table's rules, sync line, expire column and indexes; **`data <table> [--limit N]`** prints rows
  as one JSON object per stdout line (50 by default), with any truncation hint on stderr; **`doctor
  [--json]`** says what is in place: the store, its size, schedules and their last boundary, the last job
  runs, the effects by state and the failed ones; **`guide [keyword]`** lists cards and aliases, or prints one
  card: language, app, types, indexes, maintains, rules, sync, residency, prediction, evolution, expire,
  assets, reads, shapes, writes, programs, jobs, native, feeds, search, effects, actions, routes, services,
  presence, bounds, refusals, personas, witness (`guide <E_CODE>` explains a code); Natural words resolve too:
  `offline` → prediction, `pagination` → reads, `migration` → evolution, `sql` → personas, `push` → effects.
  An unknown word prints three nearest cards and the list on stdout, then exits 1. **`--version`** prints the
  binary's version, which equals the package's. Every flag may be spelled `--flag=value`.

### The wire

The client is the intended surface; the wire is plain JSON for anything else. The server card and compiled
metadata require a live principal. `GET /` is the server's card (`{ snapback4, generation, seq, ops: [{ name,
kind }], tables: [{ name, sync }] }`); `GET /api.ts` the generated TypeScript; `GET /schema` the compiled
backend; `GET /native.wasm` the native module when the backend has one. Authenticated `GET /probe` answers
HTTP 200 `{ ok: true, store_id, seq }`; clients require both the status and body before changing an offline
link back to online. The local client checks the identity and head before restoring freshness or resuming a
long poll. `POST /q/<op>` with `{ "args": {..} }` answers `{ data, complete, cut, seq, next, nextExpiry,
tables, viewer }` or `{ denied }`; `nextExpiry` is the earliest future expiry the visible read encountered, or
null. `POST /m/<op>` with `{ "id", "args", "newIds" }` answers `{ state: "sent", id, seq, result }` on fresh
success, `{ state: "sent", id, seq, replayed: true }` on replay, or `{ state: "failed", id, why, current? }`
(a client-minted `id` makes the write apply at most once). A replay adds `replayed: true` and omits both
`result` and `current`; a fresh `E_CONFLICT` may carry the live row in `current`. A job is refused over the
wire (`E_OP`). `POST /sync` takes JSON `{ from, limit, after, stream, pending, store_id? }` (defaults: `0`,
`2000`, `null`, `false`, `[]`, absent). With `from: 0` it returns the paged snapshot: `{ snapshot: true,
events: [{ table, kind, id, data }], watermark, more, next, generation, store_id, acknowledged }`. Continue
with `after: next`; `limit` is clamped to 1–10,000. `pending` holds at most 256 write IDs, each 1–128 UTF-8
bytes, and reports which queued writes the server applied. The request body is at most **262,144 bytes (256
KiB)**, including the cursor and JSON escaping; this accommodates all 256 maximum-length IDs even with
six-byte escapes. A larger body is HTTP 413 with `denied: E_INPUT`, including chunked bodies; malformed fields
are HTTP 400 with `E_INPUT`. With `from: W` or `stream: true` it returns the stream from a watermark: `{
snapshot: false, events: [{ seq, table, kind, id, data }], watermark, more, generation, store_id, acknowledged
}`. The optional `store_id` echoes the previous reply's database identity; a different identity invalidates
old snapshot cursors and partition evidence, even if the watermark is equal or higher, while a server restart
on the same database keeps its identity. An older server can omit this additive field; a backwards watermark
still requires reacquisition, and a device with no stored identity reacquires once when it first learns one.
There is no GET `/sync` route. `GET /changes?since=S&wait=N&store_id=ID` accepts the optional previous
identity, requires the same principal and answers `{ seq, tables, generation, store_id }` when a commit lands
or after N seconds (25 at most; 0 answers at once; at most 500 commits are summarised; beyond that, all tables
are invalidated). `seq` is the actual committed head, read in the same transaction as the identity and changed
tables. A different identity or a head below `since` answers immediately; a regressed head is returned as
`seq`. A matching identity still waits for a commit or the deadline. With `heartbeat=1`, an idle HTTP/1.1
response starts immediately and sends JSON whitespace every 2 seconds before the final JSON object. Proxies
must forward chunks without buffering. Once streaming starts, the status is 200; check the final object for
`denied`, including `E_AUTH` if the session ended while waiting. `POST /assets` (the file's bytes as the body,
64 MiB at most) answers `{ asset }`; `GET /assets/<id>` serves them (404 hidden or gone, 410 viewed; `Range`
works on ordinary assets, returns 416 when unsatisfiable, and is refused on view-once assets; every response
uses `Cache-Control: private, no-store`). `POST /auth/guest` (`{}`), `POST /auth/signup` and `/auth/login` (`{
"email", "password" }`) answer `{ "session": { principal, kind, token, expiresAt } }` or `{ "denied": Refusal
}`; `POST /auth/logout` atomically authenticates and closes the presented live refresh/recovery family, then
answers `{ "ok": true }`; a stale replaced bearer is 401 and cannot close or pretend to close its replacement.
`POST /auth/refresh` returns a replacement session and invalidates that bearer; `POST /auth/logout-all`
revokes every session for its principal and answers `{ "ok": true, "revoked": N }`. With a service token:
`POST /auth/session` (`{ "principal", "kind"?, "days"? }`) mints a session for an account the application
authenticated, `POST /auth/revoke` (`{ "principal" }`) ends every session of one and answers `{ "revoked" }`,
and an identity-verifying action may bind the mint to its current claim by also sending
`x-snapback-action-lease` plus `binding: { invocationId, intent: "identity-session/v1", replaceLostDelivery?:
true }`. A first bound call atomically creates one family. An ordinary replay refuses rather than returning a
stale token. Explicit lost-delivery recovery from the current live claim invalidates every token in that
family and returns one replacement with the original expiry; changed inputs or revoked, expired, logged-out,
settled, cancelled, stale, cross-worker, or cross-invocation authority refuse. Binding records retain the
family and input digest, never a raw token. The action's eventual protected result must contain the Session it
actually delivered. Either the `binding` key or any action-lease header selects this exact bound shape; a
missing, empty or duplicate counterpart refuses instead of legacy-minting. Only when both are absent does
legacy coercion remain: non-string `kind` defaults to `account`, non-integer `days` defaults to seven, and
integer days clamp to 1–3,650. Bound integer days retain that clamp and its missing optionals retain the same
defaults. `POST /effects/claim` (`{ "effect"?, "limit"?, "lease"?, "wait"? }`, the last two in seconds; `wait`
long-polls until something is due) answers `{ "effects": [{ id, effect, payload, attempt, seq, at }] }`, `POST
/effects/<id>/done` (`{ "result"? }`) and `POST /effects/<id>/failed` (`{ "error", "retry" }`) settle one
(`E_EFFECT_LEASE` when this worker does not hold it, 404 `E_EFFECT_UNKNOWN` when no such effect is queued),
and `GET /effects?state=queued` lists them; a user's token at any of these is 401 `E_AUTH`.

`POST /a/<name> { id, args }` is the viewer's action door (`?wait=0..25`).
Workers use `POST /actions/claim { action?, limit?, lease?, wait?, session? }`
and receive `{ requests: [{ id, action, args, principal, session, attempt, at }] }`.
They settle via `POST /actions/<id>/done { result }` or `/failed { error, retry }`,
with the service bearer and the claim's `session.token` in
`x-snapback-action-lease`. This fences an expired attempt even if its
successor uses the same service token (`E_ACTION_LEASE`). `runWorker`
sends it. A user token at these worker doors is 401 `E_AUTH`.

Authorization:
`x-snapback-persona` (dev, same machine, `[A-Za-z0-9_-]+`) or
`Authorization: Bearer <token>`; a bearer wins when both are sent. Status
codes: 401 with no or a dead credential, 404 `E_OP` for an unknown
operation or route, 400 `E_INPUT`/`E_OP` for a bad body or argument, 413
past the body ceiling (1 MiB for JSON, 16 MiB for `/seed`), 200 for a
program's own refusal (`{ denied }`; 503 when it is retryable), and a
response over 16 MiB is refused `E_BOUND`. `OPTIONS *` answers CORS for
`content-type`, `x-snapback-persona`, `authorization` and `range`. The
server sweeps expiry and fires schedules once a second, runs queued job
chunks each tick, and sweeps unplaced assets once a minute.

## 6. Release

`snapback4 dev` is development only — it admits loopback personas and an unauthenticated `/seed`; deploy with `snapback4 deploy` + `snapback4 serve`, which refuse both.

- **`snapback4 deploy <dir> [--allow-destructive]`** (from inside the
  project) compiles it, classifies the change against the current release
  (additive, a rule change, narrowing, destructive) and refuses a
  destructive one without the flag, writes the release under
  `<dir>/releases/N`, installs the schema into the directory's one store,
  points `current` at it (the store's own release pointer is
  authoritative; the file is a copy) and appends `releases.jsonl`. Every
  device re-derives its partition on the next sync; a write queued under
  the old schema that no longer fits is refused, typed.
- **`snapback4 rollback <dir> [--allow-destructive]`** moves `current`
  back, classifying the change the same way.
- **`snapback4 serve <dir> [--port N] [--bind H]`** runs the current
  release on the shared store on `127.0.0.1:4400`, tokens only (a persona
  is refused `E_AUTH`; so is `/seed`). A non-loopback literal bind requires
  `--i-understand-cleartext` and prints a warning because the socket is HTTP.
  Put a TLS proxy on the same host in front of the loopback listener: preserve
  `Authorization` and `Origin`, strip `x-snapback-persona`, restrict direct
  backend access, and rate-limit by the real client address. The binary does
  not trust forwarded address or scheme headers. It symlinks the release's
  store to the directory's, so the filesystem must support symlinks.

### Stopped backup and isolated restore

This procedure exercises recovery into a disposable, isolated deployment. Its recovery point is the database state after all writers stopped for the backup: committed changes after that point are absent. Record the backup time and active release/generation with the backup. This is not seamless production continuation or a zero-data-loss promise.

First stop the deployment's `snapback4 serve` process and wait for its exit; that stops its built-in scheduler and jobs. Stop external effect workers, worker supervisors and other CLI/database writers too. Keep them stopped through the copy. Do not copy only `store.sqlite` from a live server.

Use new destination paths with existing parent directories. On the supported Unix filesystem, copy the entire deployment, preserving symlinks and file permissions:

```sh
set -eu
# Set these to your existing deployment and two NEW destination directories.
deployment=/srv/myapp
backup=/srv/backups/myapp-stopped
restored=/srv/restore/myapp-isolated
test -d "$deployment"
test ! -e "$backup"
test ! -e "$restored"
cp -a "$deployment" "$backup"
cp -a "$backup" "$restored"
snapback4 serve "$restored" --bind 127.0.0.1 --port 0
```

The copy includes the database and any SQLite sidecars, `assets/`, immutable `releases/` (including any packaged native module), `current`, and `releases.jsonl`. Authentication, deduplication, job and effect records live in that database. Keep the backup itself unserved. Serving repairs the selected release's generated database symlink to the restored deployment; unexpected regular files at that link path refuse startup.

Use the printed isolated URL with a fresh device store and fresh outbox. Check current reads, backed-up identity access and an asset download. Do not attach a device store or pending outbox from the former server. Keep external effect workers disconnected from the restored endpoint. Serving automatically resumes built-in jobs and schedules: they can change the restored data or enqueue effects, so account for them when interpreting the recovered state. The automated exercise uses an actual parked job and a controlled schedule boundary to keep those records stable.

The release-activation test executes this `cp -a` sequence after owned processes exit, verifies sessions, deduplication, queued effects, a parked job, release/program identity and asset bytes, and reads the restored data through a fresh process device. The original remains present with post-backup writes, proving the restored server is independent. It also verifies a permitted schema widening, a refused destructive candidate, and rollback after a new restored write. Rollback selects earlier source; it does not rewind rows.

Production continuation needs an application-specific plan for old device watermarks and pending writes, identity/revocation changes since backup, unfinished or repeated jobs, and external effects that may already have happened. Restored operation IDs only prove deduplication represented in the backup; post-backup IDs and effect settlements may be missing. Reconcile those outcomes before reconnecting production clients or workers. External worker code, credentials and service configuration outside the deployment need separate recovery arrangements. SQLite uses WAL with `synchronous=NORMAL`; this stopped-process exercise does not establish physical-power-loss durability.

## 7. Expo

`npx snapback4 init --expo` writes `metro.config.js` and
`metro-wasm-transformer.cjs` (the config is `metro.config.cjs` in an existing
ESM package): wasm is a Metro asset, and the transformer
turns the web device's module-relative wasm URL into an asset dependency.
On web, `webDevice()` then finds the emitted wasm URL without a manual
`wasm` option, in development and in an Expo web export. Keep both generated
files when customizing Metro. The starter selects native or online on phones and `webDevice()` on web.
`npm run build:web` runs `expo export -p web && snapback4 web-shell dist`.
The resolver blockList excludes `.snapback4/` store trees (including SQLite
sidecars, assets and generated runtime files) while preserving Expo's existing
exclusions; keep this entry when customizing Metro.

The same client runs on React Native over the native module — the
`snapback4-expo` package, §7.1 — in a development or production build.
Expo Go loads no custom native code and no wasm under Hermes, so an app
there runs the online tier, with `createApp` keeping the session and pending writes. Session and journal keys already use an injective SecureStore-safe encoding;
pass them through unchanged, as the Expo starter does:

```ts
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { nativeAvailable, nativeDevice } from "snapback4-expo";
import { webDevice } from "snapback4/web";

const sessionStore = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  delete: (key: string) => SecureStore.deleteItemAsync(key),
};
export const url = process.env.EXPO_PUBLIC_SNAPBACK_URL ?? "http://127.0.0.1:4400";
export const tier = Platform.OS === "web" ? "web" : nativeAvailable() ? "native" : "online";
// Browser persistence is explicit: scripts on the page can read the token.
export const app = createApp({ url,
  sessionStore: Platform.OS === "web" ? localStorageSessionStore() : sessionStore,
  device: tier === "web" ? webDevice() : tier === "native" ? nativeDevice : undefined,
});
```

`snapback4/react` works unchanged. Pass `assets: { keep: "viewed", maxBytes }`
to retain ordinary media through `nativeDevice` in the application's Documents
directory. The module supplies file storage; the client package imports no Expo
API. Rebuild the native app to include these methods before enabling retention.

### The native module

The same interpreter the server runs, as a Rust module the host links —
Expo's Swift and Kotlin, Exact2's Apple and Linux hosts — owning the
partition in its own SQLite, applying the stream, keeping the outbox,
answering queries and predictions; the wasm the web runs is the same
module over memory. A host opens its device with `open(name, backend)`
and gives back one JSON call, `call({ op, ... })`, into the module
(`backend` is `GET /schema`'s JSON, or null to open on the one the
device kept, which is how a cold start with no network opens). For first
installation the client passes `{ initial_backend: backend }`: the module
opens any backend now present, or checks that the store is still empty inside
the installation transaction. Custom openers must forward that envelope
unchanged. An older module rejects it; rebuild the native app when updating
to this client. Generation changes use head validation and captured adoption
with the persisted restore evidence intact. The module speaks the same call over a C ABI
(`crates/snapback4-device/include/snapback4.h`: `sb4_open`, `sb4_call`,
`sb4_free`, `sb4_close`) and, for a Rust host, through
`snapback4_device::ffi::call`; `snapback4 device <store>` runs it as a
process, one JSON line each way, which is how the Node tests drive the
real module. Measured: 1.7 MB linked on iOS, SQLite included; 313 KB
gzip as wasm.

For Expo the module is the `snapback4-expo` package: `nativeDevice` is
the opener and `nativeAvailable()` says whether this build carries it,
so an app opens the Rust device in a development or production build and
the online tier in Expo Go, with nothing above the choice changing.

The client probes the device first and refuses with `E_DEVICE_VERSION`
when the device predates it: reloading JavaScript does not update a
native module; rebuild the development build.

### Proving it on an iOS simulator

`snapback4 witness ios` drives an installed Release app on macOS. It builds
nothing. Add `snapback4-expo/witness` to the app and rebuild its native module.
The helper is null on ordinary launches. Mount this runner beside the chat
screen, using the same local client and a conversation already seeded online:

```tsx
import { useEffect, useRef } from "react";
import { isReady, type Client, type Write } from "snapback4/contract";
import { witness } from "snapback4-expo/witness";
import { api } from "../snapback/generated/api";
export function WitnessRunner({ client, conversationId, onError }: {
  client: Client; conversationId: string; onError(error: unknown): void;
}) {
  const started = useRef(false);
  useEffect(() => {
    const w = witness();
    if (!w || started.current) return;
    started.current = true;
    const pause = () => new Promise(resolve => setTimeout(resolve, 100));
    const assert = (ok: unknown) => { if (!ok) throw Error("witness assertion failed"); };
    const run = async () => {
      if (w.segment === "prime") {
        await w.step("primed", async () => {
          const r = await client.query(api.thread, { conversationId });
          assert(isReady(r) && r.fresh && r.data.length > 0);
        });
        return;
      }
      await w.step("history", async () => {
        const r = await client.query(api.thread, { conversationId });
        assert(isReady(r) && !r.fresh && r.data.length > 0);
        await w.receipt({ history: r });
      });
      const sent: Extract<Write, { state: "sent" }>[] = [];
      const unsubscribe = client.onWrite(write => { if (write.state === "sent") sent.push(write); });
      try {
        const bodies = ["offline first", "offline second"], ids: string[] = [];
        await w.step("offline-done", async () => {
          for (const body of bodies) {
            const write = await client.mutate(api.send, { conversationId, body });
            assert(write.state === "pending"); ids.push(write.id);
          }
          const r = await client.query(api.thread, { conversationId });
          assert(isReady(r) && bodies.every(body => r.data.some(m => m.body === body && "pending" in m && m.pending)));
          await w.receipt({ pending: r, ids });
        });
        await w.waitFor("reconnect");
        await w.step("done", async () => {
          while (ids.some(id => !sent.some(write => write.id === id))) await pause();
          const writes = sent.filter(write => ids.includes(write.id));
          assert(writes.length === 2 && writes[0]?.id === ids[0] && writes[0]!.seq < writes[1]!.seq);
          await w.receipt({ writes });
        });
      } finally { unsubscribe(); }
    };
    void run().catch(onError);
  }, [client, conversationId, onError]);
  return null;
}
```

Keep the actual chat screen visible: its observed query renders the two
pending bubbles while the runner waits. An assertion must throw before its
step completes. Add your own media, search or read-receipt assertions in the
same way; the tool imposes no application receipt schema.

```sh
xcrun simctl list devices available --json
# Set UDID to your dedicated, booted simulator's identifier.
npx expo run:ios --configuration Release --device "$UDID"
# Run from the backend project, with the app built for this backend origin.
npx snapback4 witness ios --bundle-id com.example.chat --udid "$UDID" \
  --segment offline --artifacts artifacts/offline --port 4400 --prime
```

The driver owns `snapback4 dev --port 4400 --no-watch`; stop any manually
started backend first. A bound port is refused, never reclaimed. `--udid` is
required with more than one booted iOS simulator. Without it exactly one
available booted iOS simulator must exist. `--timeout 120` is the default
number of seconds per driver step. The app's configured origin must be
`http://127.0.0.1:<port>`; the kit does not change its client configuration.
A Release build embeds its JavaScript and needs no Metro server.
Quit the named app before starting: an already running instance is refused
with `E_WITNESS_APP`, and termination targets only the PID reported by the
driver's own launch, leaving a replacement instance running.

`--prime` first launches with `segment === "prime"`, waits for the completed
`primed` step, and terminates the app. It then stops the backend, verifies
connection refusal, starts video and logs, and cold-launches with the given
segment. Complete `offline-done`, await `waitFor("reconnect")`, then complete
`done`. `step(name, fn)` returns the function's result and records completion
only if it succeeds. Receipts inside a step carry `name:running`; failure
records `name:failed`. Steps are sequential. `receipt(object)` preserves the
object's fields and adds only `witness: { at, step }`; `witness` is reserved.
The helper serializes the app object before adding that envelope; custom
`toJSON` results must still be objects without `witness`.
`at` is an ISO timestamp. The helper appends and syncs each JSONL line in
Documents. The driver writes a run-specific reconnect file only after its
backend announces readiness again; container files require no simulator
network entitlement. Ordinary app launches cannot activate stale run files.

For the kill-and-relaunch variant, persist the two write IDs and bodies in
your app's storage. On the first offline launch complete `relaunch` after
asserting both are pending. On the second launch of the same segment read
the saved IDs and assert those exact pending rows survived, then complete
`offline-done`. Subscribe to `onWrite` on each launch before reconnect; wait
for both saved IDs to be `sent` in order, assert the visible rows, and complete
`done`. No extra sends belong on the second launch. Run that app scenario:

```sh
npx snapback4 witness ios --bundle-id com.example.chat --udid "$UDID" \
  --segment restart --artifacts artifacts/restart --port 4400 --prime --relaunch
```

Each run writes `<segment>-ios-screen.mp4` (uninterrupted native screen
recording), `<segment>-ios-receipts.jsonl` (the app's assertions and completed
steps), and `<segment>-ios-run.json` (simulator/runtime, installed Info.plist
build identifiers, backend command/origin/port, millisecond timestamps,
termination/relaunch events, byte counts, SHA-256 digests and exit status).
The device log and backend/capture logs accompany them. Missing or empty
artifacts, malformed receipts, failed steps, timeouts and backend failures
exit nonzero with an `E_WITNESS_*` diagnostic. Existing artifacts are never
overwritten; choose a fresh directory for a retry. Keep the manifest with
the exact video and receipt files it hashes.
A persistent `<segment>-ios-reserved` marker exclusively reserves all output
names; concurrent runs cannot share them, and backend/launch logs append
across restart and relaunch.
Every complete receipt is validated, including rows after a milestone and
again at collection; after `done`, only app receipts with the unchanged
`between-steps` state are accepted.

The manifest binds this execution's artifacts. It does not independently
verify the truth of application assertions, prove physical-device behavior,
simulate loss of every network connection, or establish media, search,
view-once exclusion or recipient `read` state unless your app asserts and
renders those observations. The deterministic simulator remains the main
engine harness; this witness covers native process, storage and UI boundaries.

## 8. Not in this release

Platform binaries other than darwin-arm64 (build from source with
`cargo build --release -p snapback4` and set `SNAPBACK4_BIN`), an Android
module, search beyond word prefixes (no stemming, relevance ranking,
phrase or mid-word matching), push delivery itself (a worker's, through
the effects above), an identity provider beyond guests, passwords,
services and the sessions a service mints, presence beyond the server's
own polls. If the package cannot express something, the diagnostic names
the term; record the gap and move on.
