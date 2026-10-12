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

`npx snapback4 init --web` writes a one-screen Vite + React todos app on
`createApp` with `webDevice()`; `npx snapback4 init --web --template chat`
copies the maintained Vite chat reference, including its production app shell,
account-bound saved route and write IDs. Default `init` remains schema-only.
Run `npm install`, `npx snapback4 check`, then
`npx snapback4 dev` and `npm run dev` in separate terminals. Build with
`VITE_SNAPBACK_URL=https://your-backend npm run build`; serve `dist/` over HTTPS.
The chat's routes use `#room=<id>`.

The build ends with `snapback4 web-shell dist`. Navigations use the active
worker's cached HTML even online, so its HTML and lazy assets stay together
until a waiting build activates after the old tabs close. This command also works on
`expo export -p web` output: it precaches every file in a content-hashed cache,
registers `snapback4-sw.js` in every HTML file idempotently, and resolves exported
subpages (`/contact` and `/contact/` to `contact.html`, then `/about/` to
`about/index.html` when `about.html` is absent) online and offline before falling
back to the root `index.html`. Pass `--base /chat/` when serving a subpath;
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
For a keyed text/media send, use the intent-card recipe below; keep saved failure references scoped to this account and backend.
See the generated README for residency tables, horizon choices and the
production offline-reopen journey; fixture residency remains
`test --residency --fixture <directory> --as <principal>`.

## 4. The client

**Constructor compatibility:** ready `Read<T>` values now require `existence`. Readers keep `isReady`/`isLoading`/`isDenied`; custom clients and mocks must classify their published value as `present`, `absent` or `partial`. No wire field was added. See `guide client` for the rules and point-read narrowing.

`createApp` is the ordinary entry point. Construct it once outside React render.

| Program | Constructor |
|---|---|
| Node script, seed, test or worker | `createClient({ url, persona })` from `snapback4/client` in development; `createClient({ url, session })` after `signup`/`login` from `snapback4/auth` |
| Browser app, no synced table | `createApp({ url, sessionStore: localStorageSessionStore() })` under `AppProvider`: writes are journaled without a device, no wasm (below) |
| Browser app with synced tables | `createApp({ url, device: webDevice(), sessionStore })` under `AppProvider`; the device is about 650 KB gzip of wasm (below) |
| Expo app | `createApp({ url, device: nativeAvailable() ? nativeDevice : undefined, sessionStore })`; `webDevice()` on web |

**Browser writes need `createApp`.** A bare `createClient()` in a browser has
no synchronous write journal and refuses every mutation with `E_ADMISSION`;
reads still work. `createApp` journals each click before `mutate` returns: a
write survives a reload or a same-turn navigation, and the server runs it at
most once. When no table declares `sync`, it does this without a device (see
"Browser writes without a device"); synced tables need `webDevice()`.

**Budget for the device before choosing it.** `webDevice()` is the
whole local interpreter compiled to wasm: about 2.1 MB raw, 650 KB gzip (a
release budget caps the gzip size), plus a 24 KB worker, on top of the app's
JavaScript. A Vite production build emits it as its own asset, and the
device fetches it when it opens at restore or sign-in. It buys offline reads
and predictions over synced tables. With no synced table, omit it: the same
writing page measured 274,853 B raw (88,485 B gzip) of JavaScript and no wasm,
against 2,503,672 B (766,377 B gzip) with `webDevice()` (Vite production
builds of one page). A browser page that never writes
needs neither: every client reads, and `readOnly: true` silences the write
warning (`guide read-only`). An Expo app pays nothing on phones (the native
module, or Expo Go's online tier) and the same wasm on Expo web.

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
const app = createApp({ url: "http://127.0.0.1:4400", device: webDevice(), sessionStore: localStorageSessionStore(),
  assets: { keep: "viewed", maxBytes: 67108864 },
});
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
close finishes local work without waiting for a held network response. A known
rotation successor is saved; a later unkept successor is retired.
Its previously exposed client is revoked immediately. Already-started session
persistence finishes during cleanup; an unread rotation cannot delay close.
Close also ends queued auth network waits; background revocation still owns late acknowledgements.
`AppOptions` inherits the local client's application configuration. `assets` and
`waitSeconds` pass through on every local open, including restore and account
switch; both are ignored when `device` is omitted. `waitSeconds` sets the change
feed's long-poll duration (default 25 seconds). `assets` controls ordinary viewed
media retention as described below. Its `maxBytes` must be a nonnegative safe
integer. Invalid local asset configuration reports `E_CLIENT` at `app.assets`
through `ready`, sign-in results and `auth.why` before any session or network
work; correct the options and create the app again. Kept credentials remain intact.
Identity and sessions remain owned by
`app.auth` and its `sessionStore`; `persona`, `session` and `guest` are lower-level
client options, not app configuration.
`app.auth.logout()` signs this user out of the shared session storage. It
fences restoration and same-principal sign-ins already in flight, commits a
logout tombstone without waiting for network requests, and retires every
same-principal credential in that custody in the background: peer rotations,
pending successors and newer deliberate logins, whatever their epoch. A stale
Bob facade cannot delete or revoke Alice's later login. This rule is shared by
full and read-only apps; their separate storage namespaces remain isolated.
When another app replaces the stored session during restoration, opening restarts
with that session. A stale restoration or rejected bearer cannot overwrite or
delete the other app's stored successor.
### App-owned online access

A device app uses `app.online` for a server snapshot, live server observation,
ephemeral signal or action. `useOnline()` returns that arm under `AppProvider`:

```tsx
import { useOnline } from "snapback4/react";
import { createApp } from "snapback4/app";
import { api } from "../snapback/generated/api";
const app = createApp({ url: "http://127.0.0.1:4400" });
function TypingButton({ room }: { room: string }) {
  const online = useOnline();
  return <button onClick={() => void online.mutate(api.setTyping, { room })}>Typing</button>;
}
async function serverSnapshot() {
  const read = await app.online.query(api.inboxCards, {});
  return read; // Render with matchRead; guide social has a complete screen.
}
```

`online.query` returns the same settled Read as `client.query`; `online.observe`
uses the same observation/keep contract. These evaluate at the server without
waiting on replica acquisition or pending predictions. They do not merge local
predictions or promise unlimited completeness: server cuts, continuations and
refusals still apply. For Trending/Insights-style snapshots this avoids the
replica's bounded settlement attempt; ordinary device screens keep `useQuery`.
`TrendingSnapshot` in `guide social` renders every state with `matchRead` and
provides Refresh for another one-shot. Use `online.act` for actions (the device
client's existing `act` also goes to the server). Durable mutations belong to
`app.mutate`/`useMutation`, retaining the existing outbox and admission guarantees;
`online.mutate` accepts only generated ephemeral operations.

The `Online` type (`snapback4/app`) exposes `query`, `observe`, `mutate`, `act`,
`link`, `onLink`, `viewer`, `now` and `readOnly`. It exposes no bearer, Session,
asset headers, refresh, close or sign-out method, even at runtime. The app owns
retirement. Rotation replaces the arm; `useOnline` subscribes automatically,
and headless consumers can use `app.onOnlineChange`. Reacquire `app.online` after
a change; cached old handles refuse `E_AUTH`. Account change, sign-out and close
withdraw observations and fence new requests, including requests queued behind
an asynchronous authority check. In both device and no-device apps, each arm
operation retains its originating arm and credential fence through queues,
refresh waits and retries; the transport rechecks it after shared authority,
immediately before dispatch. It cannot borrow the replacement credential.
Observation and renewal sharing stays within an arm. An arm refusal does not
invalidate the app's current session. Dispatched signals/actions retain their outcome;
the private device arm drains for up to 30 seconds before closing. An action
whose response never arrives then returns pending with its original ID. It never logs out
the app. Cleanup during ordinary screen unmount can still send stopTyping;
cleanup after credential retirement cannot send, and the four-second typing
expiry covers it. The SDK fences immediately: it does not delay retirement for
a best-effort stop or send that stop as the next account.

While signed out, operations refuse `E_AUTH`. When disconnected, one-shots,
signals and actions refuse `E_OFFLINE` (a lost action response can instead be
`pending`, retaining its retry ID). Observations follow normal online retention
and reconnect; ephemeral reads retain no offline hints. Signals drop rather than
replay. A new query can probe reconnect; the one-shot screen retries explicitly.
Without a device the arm is a restricted facade over the app's existing client,
with no second client, credential verification or write journal. In read-only
mode its writes/actions refuse `E_READ_ONLY`, and the original verified read
session expires without any SDK refresh. Shared epochs, principal sign-out
watermarks and `.read` custody retain their existing semantics.

The app's session state machine maintains these invariants under the shared
session lock:

- **I1 — stored bearer protection.** A runtime never sends revocation for the
  currently stored bearer. Explicit logout first commits a logout tombstone,
  then revokes the displaced sessions in the background. Logout compares its last
  committed principal under the lock: it owns that principal's credentials in
  every epoch, including newer logins, and preserves a different principal.
- **I2 — failure atomicity.** Failed sign-in, guest, replacement, refresh or
  logout preserves the session bytes and epoch. The sole logout intermediate
  state is a tombstone; every reader recognizes it as signed out.
- **I3 — retirement custody.** A server-minted bearer stays with its live
  runtime, the stored session, or a durable revocation obligation. Displacement
  is journaled before commit; revocations drain only after that commit. An
  acknowledgement retires the journal entry, including after restart.
- **I4 — principal isolation.** Once a runtime observes a changed epoch, it
  fences every older scope, including a provisional opening's rollback
  candidate, before notifying observers. It never adopts a different account
  without opening that account's client and outbox.
- **I5 — committed epochs.** An epoch advances with a committed replacement
  or logout, never with a failed operation.
- **I6 — coherent public identity.** Published auth state, viewer and client
  agree, including inside client notifications. Signed out exposes no live
  client; signed in exposes an open client for that viewer. Closing the current
  `app.client` also closes the app's public view and preserves the kept session.
- **I7 — refused session exclusion.** A server refusal conditionally replaces
  the still-stored bearer, or its known consumed predecessor after a failed
  rotation save, with a logout tombstone. Later opens, online or
  offline, stay signed out without opening that replica. An existing client
  loses access as soon as it learns the refusal. Cleanup cannot delete a
  different stored credential. Read sessions never rotate in the SDK.
  A transient failed refusal commit is retried
  once under the session lock; any remaining storage error is reported.
- **I8 — revoked public handles.** Hiding an account permanently fences every
  exposed client facade and its observations before notifying subscribers.
  Captured clients can no longer start reads, writes or refreshes, expose credentials or
  control the app lifecycle. The local client's existing `sync()` helper is
  also inert after its facade is hidden. Held observations return a refusal and notify
  their subscribers. Raw credentials needed for retry remain private. A failed
  replacement may restore the prior account through a new facade; it cannot
  reactivate any handle that was already hidden. This governs future access
  through handles, not copies of data or credentials already returned to code.
  Calls dispatched before the fence retain their raw outcomes (I12); query data
  and observation snapshots still require the live view when delivered.
- **I9 — global revocation.** A successful `logoutEverywhere()` acknowledges
  removal of every session of its principal at the server's revocation point,
  including other tabs, external sibling sessions and committed rotations whose
  responses have not arrived. It never selects another principal's credential.
  A deliberate new sign-in after that server operation creates a new session;
  global logout is not a ban on future sign-ins. A stale tab cannot count
  revoking that later login as successful global logout.
- **I10 — attempt-scoped acknowledgement.** Global retirement freezes the
  credentials covered by each dispatch. Its acknowledgement removes only that
  snapshot, including on cleanup retry. Tokens attached later retain individual
  retirement custody; they may have been minted after the server's revocation.
- **I11 — global logout authority.** `logoutEverywhere()` cannot select an account
  epoch newer than its calling scope. It may adopt another tab's rotated
  bearer within the same epoch; a later login, even of the same principal, is
  fenced from the stale caller's authority. Selection reads the principal's
  inline and journaled global watermarks under the session lock, and checks the
  selected session's committed scope. The shared legacy counter alone cannot
  distinguish another principal's logout from this account's replacement.
  Ordinary `logout()` follows I1's principal-wide custody rule.
- **I12 — known dispatched outcomes.** Fencing refuses new calls. Close waits
  only for local cleanup, never for a held network response. A mutation or
  action whose response arrives before public `app.close()` completes keeps its own full outcome,
  including during receipt application or session cleanup; otherwise its caller receives `pending`
  with the original id. Close never invents a failure for an unknown outcome.
  Overlapping identical mutations share that outcome; different input still refuses id reuse.
  The request is not aborted: a later body is consumed and discarded. Durable
  mutation intent recovers on reopen with the same id; the server returns
  `replayed: true` for a prior execution. Raw online callers retain their id for
  retry themselves; actions collect their server record with the original id.
  Reads retain their disclosure guards.
- **I13 — one known outcome per id.** Within a live client, `mutate`, `write(id)`
  and `onWrite` agree on a known terminal state, id and sequence or refusal code.
  Failed receipt persistence never changes a known terminal outcome back to
  pending; subscribers still receive it. Online custody also reports the storage
  error through auth.why. The client
  retains a receipt summary in memory until persistence succeeds or the client
  is retired, independently of the lower client's bounded history. Lookup
  retries persistence. Online durable intent stays available for same-id replay only to the store
  that acknowledged it after restart. Receipt recovery still omits historical result values and refusal
  details; a hidden account cannot look up retained receipts.

The state-machine suite runs 5,000 seeded sequences on each of the online and
local tiers. The local tier uses the production Rust/Wasm device, outbox and
receipt storage; the server and session-store faults are modeled. It generates
both accepted mutations and authoritative nonretryable refusals, including
responses held across close or logout. Persistent online receipt-save outages,
lookups before and after repair, and completion notifications check I13. Separate Wasm and native tests exercise
the real server and local device with held mutation, action and read responses.

A single atomic `sessionStore.set` commits the session and its epoch together.
Client opening is provisional: failed device initialization or persistence
cannot discard the previous guest's only bearer. Restoration and rotation
retain their epoch; replacement of a live bearer increments it. Logout writes
an epoch-bearing tombstone, including when quota prevents creating another key.
The old separate epoch key remains readable for existing stores.

`logoutEverywhere()` blocks new rotations in its runtime and awaits one already
running there. Under the session lock it selects the stored bearer for its
principal and calling epoch, including a successor saved by another tab, or its
own known newer rotation whose save failed. A stored bearer in a newer epoch
causes an E_AUTH refusal and stays untouched, including a login of the same
principal. The atomic tombstone commits the bearer, principal
and generation of the global revocation together. Only then does the app publish
signed out and fence captured clients and observations. If that write fails,
the signed-in view and its existing client remain usable and `auth.why` reports
the failure (an independently superseded or refused account remains fenced).

The tombstone privately owns retry credentials across restart until
`/auth/logout-all` succeeds. A late successor from an older scope inherits the
same principal's global obligation; ordinary retirement cannot consume it first.
Replacement moves these obligations to the retirement journal. A global
acknowledgement retires the credentials known to its dispatched attempt and
leaves a completed generation watermark. Credentials attached while the response
is pending remain journaled for individual retirement; successful global logout
does not prove they were minted before that revocation. Another stale tab cannot
recreate the acknowledged obligation or globally revoke
a later login. Completed empty watermarks compact to the newest per principal;
pending obligations retain their retry credentials. A successful retry or
reopening drains durable work. Signed-out clients cannot use these credentials
for reads, writes or ordinary logout.

Retirement records are backend-bound revocation credentials, never sessions to
restore. Replay checks the current session under the same lock. Ordinary
retirement removes an entry after a logout acknowledgement or HTTP 401 E_AUTH;
global retirement requires a successful logout-all acknowledgement because
E_AUTH does not prove that the other sessions were revoked. A received global
acknowledgement remains owned by its runtime until local cleanup succeeds;
cleanup retries a transient failure, and close retries any retained cleanup.
Transport failures and other refusals leave retirement available for retry on
restoration, sign-in or logout. A failed comparison read keeps
custody and cannot authorize revocation. Damaged records are preserved and
reported through auth.why. Invalid-session garbage collection compares the exact
bytes it read and never remotely revokes a token.

These invariants assume an individual store write is atomic (a rejected write
leaves that key unchanged), cooperating runtimes use the shared lock, and the
store and network eventually recover. The server consumes a refresh token
before returning its successor. If all persistence and revocation attempts fail
and the process is forcibly killed, a newly minted, never-persisted successor
cannot be recovered by this client protocol. Lost server responses have the same
limit. Durable recovery of that case requires a server protocol that can recover
an issuance by request ID; createApp cannot manufacture that guarantee.
I7 likewise requires a durable refusal fence before the last informed runtime
is lost: if every tombstone write fails, then the process dies, a new offline
runtime cannot distinguish the old bytes from a valid offline session. The
informed runtime denies access and reports the storage failure; it cannot promise
offline exclusion after that loss. A lost global-revocation acknowledgement
followed by process loss can also leave an obligation whose consumed bearer
cannot prove the result on retry. That obligation is retained and the refusal
reported, rather than treating E_AUTH as a successful global logout. Stronger
crash guarantees require server-side issuance and revocation receipts.

Local writes use the existing device outbox. Online `app.mutate` (also
`app.client.mutate` and `useMutation` under `AppProvider`) records ID and arguments
before dispatch, retains uncertain writes through restart and sign-out, and
recovers them only under their original backend/account and dispatch store.
Fresh online intent probes for the current store before admission when this
runtime has not identified it, so a `dev --fresh` replacement does not retire a
new write as an old unbound intent. The returned identity is saved with the intent;
recovered intents keep their original binding. The server checks that
identity before execution or idempotency lookup. If storage cannot write the
durable intent together with its store identity, the intent is not admitted at all.
On reopen, a different store retires the intent with an unknown-outcome refusal.
An intent without an identity, even if not yet dispatched, replays only to the first store this journal
has seen; once it has seen a replacement, unbound old intents are retired.
A persisted terminal receipt never reposts. If its save failed, same-store replay
is allowed and the server's idempotency record prevents double execution. Terminal receipts keep
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
across tabs. Journal observers re-read on both a broadcast and the journal's
storage event: a broadcast can arrive before another tab sees a localStorage
commit. Neither notification carries trusted intent or replaces durable custody.
A refused bearer stops that runtime and conditionally tombstones its rejected
credential; it preserves a peer's different stored credential. Explicit logout
compares the owned principal, then commits a tombstone
before retiring every same-principal credential it displaces, whatever its epoch.
Read sessions never rotate in the SDK. Full-session refresh responses arriving
after logout are retired and never adopted. Custom stores shared across independent non-browser
processes need one active app writer because `SessionStore` has no atomic update
primitive. Storage errors remain errors; they never authorize an unstored send. A failed
startup keeps the client signed out. Logout retries failed credential deletion
even when a prior outbox save failed.

The lower-level clients remain available for development personas and hosts that
already manage their own session lifetime:

The generated `api` groups a module’s operations under `api.<module>`: `api.social.follow`, not `api.follow` (§1).

The shared local evaluator (one-shots and observations) runs locally first: known complete answers win regardless of `runs` and alone narrow possible dependencies. Engine provenance sends `speculative` only when true; an absent field means false, including in component coverage. It keeps unknown, non-speculative values as partial data; speculative values and refusals stay `loading` while fenced, otherwise recovering unexpired server memory with `fresh: false` and the original `since`, or `E_OFFLINE` (`loading` for watches).
Inside that evaluator, engine-unavailable reads (or reads the device cannot run) stay `loading` offline, while `held`, or while an intersecting prediction is unobserved; otherwise fallback uses the original arguments and preserves server refusals and loading. Composed reads never recover a remembered whole server answer. Retained components keep non-speculative local data offline or on transport failure; a speculative sibling withholds the whole composition because `Read<T>` has no component loading metadata.
One-shots settle these internal loading candidates under the [`query` contract](#the-card); observations can publish them. Every await and publication checks the session; every external answer rechecks the prediction fence, and all data rechecks expiry at publication, including local and retained data. A local reply that expires in flight is evaluated once more at the current time and follows the same fallback, composition and memory recovery procedure; if its replacement also expires, it stays loading and its watch reruns. Recovery preserves the next local wakeup separately from remembered data's server expiry. An elapsed local wakeup, whether during publication or from the watch timer, reruns its watch without withdrawing valid memory; only the remembered answer's own server deadline expires it, including during that rerun. Actual local-row deadlines still withdraw local or composed data. A retry needing the server clears the expired watch value during transport; a purely local retry publishes without a loading reset. Watches rerun at expiry, and local freshness requires an online, caught-up, identity-checked partition.

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
query on it, queues every durable mutation durably and predicts its rows when local
facts permit, and follows the server's stream for the rest. The device keeps the compiled
backend too, so a device that starts with no network opens on what it
holds (`link()` is `"offline"`, reads carry `fresh: false` and `since`)
and catches up when the link returns. A device needs a kept backend to open
offline. Merely installing that backend does not acquire its partition: until
a snapshot and catch-up finish, partition-dependent reads fall back to the
server or stay `loading`, and writes queue without invented predictions.
`client.acquired` and React's `useAcquired()` become true after the snapshot
and catch-up finish for the current store, including an empty partition.
`useAcquisition()` returns `{ acquired, rows, tables }`: `rows` counts snapshot
row images durably applied during this runtime's current acquisition, and
`tables` maps source table names to those counts. Counts reset when an
acquisition restarts or its store is replaced; a warm reopen can be acquired
with zero rows received in this runtime. These are progress counts, not estimates
of the total or permission to read a partly acquired partition.

Keep the UI usable while preparing offline access. Ordinary reads fall back to
the server until acquisition completes; `held` reads still require the device.
This component runs inside `<AppProvider app={app}>`:

```tsx
import { useAcquisition, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";

function Inbox() {
  const { acquired, rows, tables } = useAcquisition();
  const read = useQuery(api.inbox, {});
  return <>
    {!acquired && <p role="status">Preparing offline: {rows} rows across {Object.keys(tables).length} tables</p>}
    {"data" in read ? <ul>{read.data.map(room => <li key={room.conversationId}>{room.conversationId}</li>)}</ul>
      : <p>{"denied" in read ? read.denied.message : "Loading conversations…"}</p>}
  </>;
}
```

Acquisition stays true offline and across an offline reopen, and becomes false
when store replacement or schema adoption invalidates it. The online tier has
no local partition and reports false with zero progress. `onAcquired` observes
completion changes. Await `client.sync()` when `client.link() === "online"`
only for an operation that needs offline prediction immediately. A sync
interrupted by link loss or a refused partition can return without acquisition,
so `acquired` remains the authority.
`await client.sync()` waits for a round begun after the call (sharing one follow-up if a round is in flight), so a successful sync reflects server commits acknowledged before the call instead of an older response; offline and refusal results still apply.
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

New IndexedDB stores pack row images into 256 buckets per device row store.
Each bucket holds at most 512 entries and 256 KiB of UTF-8 JSON. On overflow,
additional rows use individual records; updating one row reads and rewrites at
most its bounded bucket plus that row. A row larger than the bucket cap stays
an individual record. There is no overflow list to scan or rewrite.
Each apply still writes its row changes, metadata, outbox and transfer markers
in one atomic transaction with `durability: "strict"`. No page or watermark
publishes before that transaction completes. Existing per-row stores remain
readable and writable. The earlier unbounded packed format is split once,
atomically during full device load, before mutations run.

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
has `query(op, args) → Promise<SettledRead>`, `observe(op, args) → { getSnapshot(), subscribe(listener) →
unsubscribe, close() }` (a live read; React's `useSyncExternalStore`
shape), `mutate(op, args, options?) → Write`, `act(op, args, options?) → Act`, `link()`, `onLink`, `viewer()`,
`onViewer`, `onWrite`, `session()`, `onSession`, `refreshSession()`,
`logoutAll()`, `signOut()`, `sync()`,
`close()`. `onWrite` reports the terminal `sent` or `failed` outcome of a
write that first returned `pending`; it is a live-client notification, while
the durable outbox remains the authority across a restart. A restored or
provided session within 24 hours of
expiry rotates before the protected backend is fetched (temporary action sessions cannot refresh); a running client
schedules the same rotation. Refresh retains validated server refusals and
transport causes; HTTP 200 without a valid session is `E_HTTP_RESPONSE`, not a
terminal authentication failure. A retryable `E_AUTH` keeps the session alive.
Refresh dispatch, startup and rescheduling retain the existing behavior: no
persisted rotation claim or unknown-outcome fence is installed. A lost reply
can therefore lead to reuse of a consumed bearer and a later sign-out. This
remains an open limitation requiring a separate session-refresh design.
Nonretryable `/changes` refusals stop polling and appear in observed reads;
the link remains reachable. Reopen after correcting the refusal. Unverified
probes wait after every unsuccessful attempt; refusal delays respect
`Retry-After`, including nonretryable replies, and malformed replies back off.

A successful rotation replaces the stored
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

**Read-only observers.** Sign in with `{ scope: "read" }`, or narrow a password/guest session without revoking its full credential. Use the returned credential with `readOnly: true`. Startup verifies server scope before queries or assets; `createApp` uses a separate `.read` session key. Read clients have no device or write queue, cannot consume once-media, and do not advance delivered/seen watermarks or presence. `refreshSession()` refuses `E_READ_ONLY_REFRESH` locally; the SDK never rotates read sessions, automatically or explicitly. At `expiresAt`, reads surface `E_AUTH`: sign in again or narrow a full session again. See `guide read-only` for the expiry cap and allowed routes.

```ts
import { createClient } from "snapback4/client";
import { login, narrowSession } from "snapback4/auth";
import { api } from "../snapback/generated/api";
const url = "http://127.0.0.1:4400";
const signedIn = await login(url, "bob@example.com", "a-long-password");
if (!signedIn.ok) throw new Error(signedIn.why.message);
const narrowed = await narrowSession(url, signedIn.session);
if (!narrowed.ok) throw new Error(narrowed.why.message);
const observer = createClient({ url, session: narrowed.session, readOnly: true });
await observer.query(api.history, { conversation: "conversation-id" });
await observer.signOut();
```

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
Recovery runs during client opening on the kept backend, before its first sync,
including offline. Orphans that require a backend adoption wait for that sync.
Recovery and new admissions take submission numbers from the same device counter;
already-queued writes precede recovered orphan records. A matching orphan waiting
for backend adoption installs the destination's authenticated backend first. An
orphan missing its kept backend or store identity is skipped with its journal
intact until a later matching open can establish ownership; a broken orphan does
not prevent healthy stores from opening.
Every journaled write stays bound to its original backend store identity until
it leaves the outbox, including a fresh click captured during startup validation.
A replacement retires these writes without sending them to the new backend.
Own-tab recovery, fresh admission, orphan adoption and both send paths share
the same store-binding check. Orphan adoption leaves a bound write in its source
store while the destination identity is unknown, and retires a mismatch before
enqueueing it. Matching adoption keeps the original mutation id.
Ordinary and keepalive mutation requests carry that original `store_id`; the
server refuses a replacement before execution or deduplication with terminal `E_STORE_REPLACED`.
An overlapping ordinary request owns its settlement: a keepalive refusal cannot
replace its known success or refusal. A known terminal outcome whose receipt save
failed is persisted before sync, another POST or replacement handling touches
that id; retry settles the original receipt locally. Otherwise the refusal receipt and outbox retirement commit
together, after rechecking terminal history and custody; a failed save retains the outbox.
An outbox acknowledgement resolves an earlier `E_STORE_REPLACED` (whose execution
outcome was unknown) as `sent`. Its matching sequence repairs that history row;
an authored refusal such as `NOT_ADMIN` is not overwritten.
Sync acknowledges only stored `sent` outcomes: an idempotency record for a
refusal does not prove success. Known authored refusals also take precedence
over acknowledgement evidence retained from an older server.
A local admission-storage error does not establish the server outcome; its
captured intent remains recoverable.
Under `createApp`, records also capture the session epoch and principal.
The browser's authoritative session lives in IndexedDB. Login, logout and
principal replacement mirror their value to localStorage, then await a strict
IndexedDB transaction commit before releasing the session lock. A failed mirror
write aborts that transaction; an aborted commit restores the previous mirror
where storage permits. Async session reads, locked device admission and recovery
use IndexedDB, never the mirror as authority. A logout or changed epoch/principal cancels
an unadmitted record; a live caller receives `E_AUTH`. After releasing the
admission lock, the app checks its scope and withdraws stale auth, viewer,
acquisition and existing observations even when the change poll is held. A subsequent sign-in
cannot revive that earlier click. Synchronous journaling still precedes waiting
for the lock, so a navigation while the session is unchanged keeps its intent.
Chromium can expose a stale localStorage mirror even after granting a Web Lock:
such a click can be captured, but its locked IndexedDB check refuses it before
outbox admission or transport. An already-visible logout refuses synchronously.
App ownership is attached before recovery, including with wrapped or asynchronous
session stores and device adapters that forward `{ ...core }` (including symbol
capabilities). A browser adapter dropping those capabilities fails opening with
`E_ADMISSION`. An unadmitted legacy record with no IndexedDB authority stamp, or an app record
whose authority cannot be read, is cancelled because its originating login cannot
be established; already committed outbox entries keep their custody.
Page-hide transport starts after the admission lock releases. Startup installs
it after validation permits sending, before waiting for ordinary replay or the
initial sync, including offline. Empty outboxes undergo the same validation;
new clicks journal during opening but neither transport sends before validation.
A refused probe, backend mismatch, restore refusal or
required backend adoption prevents early exit sending. An unreachable probe
leaves the kept store's offline custody intact. If the page became hidden during
the probe, registration makes one send attempt. A successful sync can establish
the backend needed to validate and install the sender afterward, including on a
later reconnect after an unsuccessful startup.

On upgrading from a browser session stored only in localStorage, sign in again:
the mirror alone cannot establish a coherent authority record. Before opening
a scope, the session lock protects migration of the greatest legacy mirror or
IndexedDB epoch into the authoritative epoch record and its mirror. This
preserves the old epoch fence while allowing the new sign-in to mutate. Migration
writes only when the legacy mirror advances the authoritative epoch. Reopening
an existing session does not require a separate epoch key or free localStorage
capacity; mirror repair is best-effort. A new mutation still refuses synchronously
if its journal cannot be written. Reads
repair speculative or stale session mirrors from IndexedDB, deleting the mirror
when authority is absent; they never import mirror credentials. Pre-upgrade
unadmitted journals are cancelled; committed outbox custody is preserved. The
default memory session store and native platform stores retain their behavior.
For a custom-prefixed localStorage adapter, pass a stable, unique namespace as
the second argument; omitting it fails closed with `E_CLIENT` instead of sharing
another adapter's account. Wrapping the returned store with `{ ...store }`
preserves its authority and synchronous reader. For example:

```ts
import { localStorageSessionStore } from "snapback4/auth";

const prefix = "work-account:";
const sessions = localStorageSessionStore({
  getItem: key => localStorage.getItem(prefix + key),
  setItem: (key, value) => localStorage.setItem(prefix + key, value),
  removeItem: key => localStorage.removeItem(prefix + key),
}, "work-account");
```

The journal allows at most 32 records and 256 KiB of UTF-8 keys and values per
device store, and at most 64 KiB per serialized record. A browser mutation that
cannot synchronously acquire custody refuses with `E_ADMISSION`, a site and a
rewrite. This includes unavailable, throwing or full localStorage, exceeded
journal limits, an unrestored session, and a
`createApp` with an asynchronous-only session store (a device-less app's other
refusals are listed under "Browser writes without a device").
The test-only `memoryPersistence()` provider also refuses browser mutations:
transferring custody to memory cannot preserve a write across page restarts.
No new intent is admitted in those cases. The returned promise is already
fulfilled with a failed write and exposes `state: "failed"`, `id` and `why`
in the calling stack. Before backend identification, the call instead allows
15 seconds of identity I/O without custody (see the pending-write section). Awaiting it uses the ordinary Write API:

```ts
import { createApp } from "snapback4/app";
import { webDevice } from "snapback4/web";
import { localStorageSessionStore } from "snapback4/auth";
import { api } from "../snapback/generated/api";

const app = createApp({ url: "http://127.0.0.1:4400", device: webDevice(), sessionStore: localStorageSessionStore() });
await app.ready;
const write = app.mutate(api.send, { conversationId: "c1", body: "hello" });
if (write.state === "failed") console.error(write.why?.message);
else {
  // The web journal owns the intent now; same-origin navigation is safe.
  const outcome = await write;
  if (outcome.state === "failed") console.error(outcome.why.message);
}
```

`createApp` checks the builtin session store's epoch synchronously before
entering web admission; its network paths retain their locked epoch checks.
An observed epoch mismatch refuses the call immediately, then checks under the
session lock. A confirmed mismatch also withdraws the old scope's observations;
a transient observation during a session commit does not retire that scope.
Restoration does not queue an intent for whichever account might sign in later.
Before store identification, the call waits in memory. After an ordinary
`E_ADMISSION` storage refusal, repair storage and retry the same id. A bare `createClient()` in a browser has no synchronous journal
and refuses mutations with `E_ADMISSION`, naming `createApp({ url, sessionStore: localStorageSessionStore() })`
when no table syncs and the device form otherwise. A non-`readOnly` bare `createClient()`, and a
device-less `createApp()` whose session store is not `localStorageSessionStore()`, say so once with
`console.warn` when they are built in a browser; the clients `createApp` opens for itself never warn.
Node and native online clients retain their existing behavior.
Clearing browser storage after admission can still erase its bytes.
A destination must open
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

#### Browser writes without a device

A browser `createApp` without `device` writes when the backend's schema
declares no `sync`, or when the app passes `writes: "online"`; it needs
`sessionStore: localStorageSessionStore()` and Web Locks. Opening reads
`GET /schema` once (skipped with `writes: "online"`) and identifies the store
beside it. Reads are the online client's (no replica, no offline reads, no
predictions); a write appears when the server confirms it.

```ts
import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { api } from "../snapback/generated/api";

const app = createApp({ url: "http://127.0.0.1:4400", sessionStore: localStorageSessionStore() });
await app.ready;
const write = app.mutate(api.send, { conversationId: "c1", body: "hello" });
if (write.state === "failed") console.error(write.why?.message); // refused in the calling stack
else console.log((await write).state); // journaled: survives navigation, sent once
```

Before `mutate` returns, the click is written to localStorage under its own
key (`snapback4-online-admission:…`, one key per capture, with the id,
operation, arguments, store identity and the session's epoch and principal),
bounded like the device journal: 32 records, 256 KiB, 64 KiB per record.
Unavailable, throwing or full localStorage or an exceeded bound refuses
`E_ADMISSION` synchronously; nothing was admitted or sent; retry the same id.
The app then commits the intent to its online journal in IndexedDB, under the
journal's and the session's Web Locks, after the same locked authority check
the device uses: a logout or account change before that commit cancels the
click with `E_AUTH`. A transfer marker in that commit keeps a surviving record
from being admitted twice, except after journal damage, a removal that never
reached storage, or more than 1,024 outstanding markers; even then the same id
goes to the same store and the server answers `replayed`. If the commit fails, the call resolves
`pending` ("journaled in this browser"), `write(id)` reports it pending, and the
app recovers it before its next admission and on a backoff timer.

On the next open of the same backend and account under the same session
store, in this tab or another, records left by a closed, crashed or reloaded
page are admitted once and sent with their original ids before new clicks; the
server answers an id it already ran with `replayed: true`. A live tab's records
are never adopted (each app holds a Web Lock while it runs). Records from an
ended session are cancelled with a console warning; records under another
session store namespace are left alone; a saturated journal keeps them and
reports `auth.why`. A schema that syncs refuses `E_ADMISSION` naming the
tables, `device: webDevice()` and `writes: "online"`; an unreachable `/schema`
at opening refuses `retryable: true` until it answers. Persona apps keep the
device requirement. Limits are the device journal's: clearing site data or an
operating-system crash before the browser flushes storage can lose a click.

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

### Ephemeral writes

Declare a short-lived table with `ephemeral 4s` for typing, or `ephemeral 30s`
for room viewing (`snapback4 guide ephemeral`). Its rows live only in server
memory and disappear on expiry, restart or schema adoption. Keep its read as
its own query beside your durable, device-held list: a query that reads an
ephemeral table needs the server.

Generated ephemeral mutations have type `Ephemeral<A, R>`.
`client.mutate(op, args)` and `app.mutate(op, args)` return `Signal<R>`:
`{ state: "sent", id, result }` or `{ state: "failed", id, why }`.
There is no `pending`, sequence, replay, prediction, outbox entry, admission
journal, `write(id)` receipt or `onWrite` event. The id correlates this call;
it does not deduplicate it. Ephemeral calls take no mutation options.
`useMutation(op)` keeps `{ run, last, inFlight }`, with a `Signal<R>` result;
`usePendingWrite` accepts only durable mutations. A durable mutation's outcome is
`Write<R>`, which can be `pending`; a helper for it takes `Write<R>`, not `Signal<R>`,
and `UseMutation<typeof api.op>` picks the right one for a prop.

Each client sends ephemeral calls in one ordered lane, one request at a time.
Only operations the compiler proves to be renewals (`renews: true`) coalesce:
an identical waiting operation and canonical JSON argument pair moves to the
end of the lane, and the replaced caller receives its replacement's outcome.
A request already in flight stays in place. Other operations, including
`stopTyping`, are sent once per call in order.

A renewal identical to the last successful send returns that result immediately
within its generated `renewMs` window, provided no other call was sent and none
is waiting. This check also runs at dequeue. `renewMs` is one quarter of the
shortest life the operation writes. A typing row therefore expires between
`0.75 × life` and `life` after the last call, plus delivery; use `ephemeral 4s`
or less for a five-second bound. The lane holds at most 256 waiting calls;
excess calls fail with retryable `E_RATE_LIMIT`.

Calls while offline, and calls waiting when the link drops, fail with
`E_OFFLINE`: they are dropped, never held or retried. A lost response can follow
execution; its failure is not proof that the server did nothing. Rate, capacity,
rule and generation refusals leave the link online. Only a transport failure
changes the link. Closing drops the lane and ends outstanding waits.

A watched query registers its generated `ephemeralReads` before its first
answer. Adoption reconciles all mounted interests with the new backend, including
removed reads. Clients send the three ephemeral poll parameters only when the
backend declares an ephemeral table; durable-only polling keeps its old wire.
An ephemeral backend advertises `X-Snapback-Ephemeral: 1` on ordinary
responses. The online tier then loads `/schema` for those facts and reissues
its discovery poll; durable-only clients make no extra schema request. Growing that interest reissues the held `/changes` poll. Ephemeral
table notifications rerun matching watches without a durable change or `/sync`.
Watches also refetch at `nextExpiry`; incomplete ephemeral answers refresh at a
fixed one-second cadence until complete or closed. No application expiry timer
is needed. Offline ephemeral reads have no retained data.

Query answers and polls carry an incarnation and epoch, separately from the
durable sequence. Each watch rejects older epochs. Accepting a new incarnation
advances the client's ephemeral request revision, invalidates outstanding
requests, and reruns every ephemeral watch and the poll. Responses tagged with
an older revision are discarded before considering their incarnation.

```tsx
import { useMutation, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
function Typing({ room }: { room: string }) {
  const typing = useQuery(api.typingIn, { room });
  const setTyping = useMutation(api.setTyping);
  const stopTyping = useMutation(api.stopTyping);
  return <>
    <input onChange={event => void (event.target.value ? setTyping.run({ room }) : stopTyping.run({ room }))} />
    {"data" in typing && typing.data.length > 0 && <span>Someone is typing</span>}
  </>;
}
```

For room viewing, call the generated renewal on mount and every ten seconds,
and its delete operation on unmount. Rules still decide every read and write;
renewing a row must satisfy its insert rule as well as its update rule.

### The card

Every word a screen reads is on the card (`snapback4/contract`):

```ts
import type { Cursor, ReadMeter, Ready } from "snapback4/contract";
type Read<T> =
  | Ready<T> // required existence: present | absent | partial, narrowed by result type
  | { loading: true }
  | { denied: Refusal };
type SettledRead<T> = Exclude<Read<T>, { loading: true }>; // await client.query(...)
type Write<R> =
  | { state: "pending"; id: string; reason?: string }
  | { state: "sent"; id: string; seq: number; replayed?: false; result: R }
  | { state: "sent"; id: string; seq: number; replayed: true; result?: never }
  | { state: "failed"; id: string; why: Refusal };
type Refusal = { code: string; family: string; message: string; detail?: string; site?: string; rewrite?: string; guide?: string; rule?: string; retryable?: boolean };
type Link = "online" | "offline" | "signed-out";
```

`matchRead` is the paved rendering form, exported from both `snapback4/contract`
and `snapback4/react`. One handler set covers points and pages. Pass `page.read`,
not `page.items`: an empty item list during loading proves nothing.

```tsx
import { matchRead, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function Membership({ conversationId }: { conversationId: string }) {
  const member = useQuery(api.myMembership, { conversationId });
  return <p>{matchRead(member, {
    loading: () => "Checking membership…",
    denied: why => why.message,
    absent: read => read.fresh && !read.revalidating ? "Not a member" : "Checking saved membership…",
    partial: () => "Membership not yet known",
    present: (data, read) => read.revalidating ? "Updating membership…" : "Member",
  })}</p>;
}
```

Every handler is required. An explicit `otherwise(read)` may replace omitted
`loading`, `absent` and `present` handlers; `denied` and `partial` must still be
provided. Explicit handlers take precedence. The fallback receives the union of
those three arms, even if some have explicit handlers. Use it only when the
omitted states intentionally share a decision, as in the composer below.
`present(data, read)` excludes top-level null; `partial(data, read)` preserves the
query's result type, including null. `denied(why, read)` receives the original
`Refusal`; `absent(read)` and `loading(read)` receive their narrowed read.
Every ready handler keeps `fresh`, `revalidating`, `complete`, `cut`, `next` and
`since`. Return types are inferred as the union of handler results. This is pure
dispatch over the current read, with no subscription, saved answer or authority.
A nonempty page can be `present` and incomplete; use `readPresentation(read)`
for independent incomplete/stale/revalidating notices. `existence` and the guards
remain useful for single checks. Settled reads use the same handlers (loading
cannot run), keeping reusable rendering functions identical to observed reads.

`client.query(op, args)` returns `Promise<SettledRead<R>>`. See `snapback4 guide client` for its settling rounds, total deadline, offline behavior and refusals. Ready may still be partial; `existence(await client.query(...))` never returns `"loading"`. Use `observe`/`useQuery` for later updates.

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
With the dev host stopped, `snapback4 run <op> '<json args>' --as <principal id>
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
missing coverage. For `complete: false` with
`cut: null`, render "Results may be incomplete", even when empty; never "no matches".
The precise reason remains in development-only `Read.meter.cut` (`"meter"`,
`"words"` or null, with `"meter"` winning); `serve` never returns that meter.
If the server cannot answer the query, declare `query … held:` to answer
from the device; the server refuses it with E_QUERY_HELD (see the search card).
A complete empty page has `cut: null` and `complete: true`.

Held device observations republish at `nextExpiry`, including offline, so render their
ready rows directly. Timers follow the row's deadline; a suspended page or a busy host
can delay the callback. For durable expiring tables, only server-answered reads need a render-deadline
filter while the next network answer is pending. Return `expiresAt` with each row
(`guide reads` has the durable expiring-row recipe). Ephemeral typing uses the
section above; its hidden deadline is handled by the client.

`client.now()` returns estimated server Unix milliseconds, monotonically. In React,
`useNow(deadline)` returns that time and re-renders at the deadline and when the estimate
changes. Pass the next future row deadline; `null` means no timer. Cleanup is automatic:

```ts
import { useClient, useNow } from "snapback4/react";
function useExpiringRows<T extends { expiresAt: number | null }>(rows: T[]) {
  const client = useClient();
  const deadline = Math.min(...rows.flatMap(row => row.expiresAt !== null && row.expiresAt > client.now() ? [row.expiresAt] : []));
  const now = useNow(Number.isFinite(deadline) ? deadline : null);
  return rows.filter(row => row.expiresAt === null || row.expiresAt > now);
}
```

Render the rows returned by `useExpiringRows(rows)`. A null expiry never expires.

A read denied by a table's rule answers as an empty page, not a refusal,
and a client cannot tell it apart from an empty readable page — by design,
so that a hidden row cannot be probed. For access UI, use a membership query
the viewer may read, such as a conversation lookup readable by its members:
a member gets the conversation even when its message page is empty.
An explicit `require … else CODE` still refuses with the program's code.
By default, mounted same-key observations retain their answer through plain
revalidation without a timeout, marked `revalidating: true`. Only change evidence that can revoke a row withdraws on failure or timeout; ordinary inserts and non-policy updates retain the answer until replaced. Unknown or older evidence remains bounded. Local replacement attempts get one second excluding capacity queue wait; online revocation evidence starts its second immediately, including queue wait. Applied local scope loss withdraws dependent audience groups immediately, even on staged pages; older replicas cannot restore them before publication. Retries never renew a budget. Use
`keep: false` for immediate withdrawal. All observations discard responses older than observed
commits in the same store.
A store identity change (`E_STORE_REPLACED`) or same-store sequence regression
(`E_STORE_RESTORE`) permanently denies this online client's reads and fails its
queued and in-flight writes without retry; whether those writes executed is unknown.
Create a new client to recover; `createApp` automatically closes, reopens and
publishes its online client on `E_STORE_REPLACED`, retaining the session if the
replacement store accepts it and retiring outstanding intents before reopening.
A retryable refresh failure without a successor body preserves that bearer
for the replacement probe; sign-out still attempts logout of the known token.
A known server outcome is reported even if saving its receipt fails. A store-change
refusal, which does not establish execution, reports terminal only after durable
retirement; a failed retirement save keeps that unknown outcome `pending`.
Terminal online clients expose `link() === "signed-out"` and refuse actions,
uploads, asset reads and refreshes too; late asset handles are revoked, unkept
refresh successors are revoked, and `assetSource` returns an empty source.
Cancellation ends the caller's wait, never an effectful request: refresh,
login, guest, mutations, actions and uploads still consume their replies;
unkept bearers are revoked and cancelled uploads remain unplaced.
Only queries, polls and asset fetches may abort their network requests.
A rejected transport or response body after mutation/action dispatch is an
unknown outcome (`pending` with the same id), never proof of failure. Node
clients use a private pinned Undici dispatcher to contain the macOS socket QoS
bug in Node 24.18's bundled transport. Browsers and native hosts use their host
fetch; an explicit `fetch` option remains caller-owned on every host.
Retirement pins newly failed receipts in the 256-body window, compacting older
store-failure receipts to ids before evicting the oldest sent receipts. Every
id displaced by retirement, including a sent id, enters the compact set. Those
compact ids never expire while the journal remains: retrying one returns
`E_WRITE_RECEIPT_EXPIRED` without dispatch, including after reopening.
The journal holds at most 4,096 compact retirement ids (about 116 KiB); if more
are needed, a durable flag blocks new admissions instead of forgetting an id.
Reconcile prior outcomes before explicitly replacing a saturated journal;
ordinary successful-write eviction keeps its existing policy and does not
consume this retirement-id allowance. Saturation blocks new admissions;
an already-admitted intent still recovers as `pending` until it settles.
Within a store, replayed mutation receipts never lower the read floor: their
historical commit sequence is separate from the current store head.
A stale response gets at most three refetches, after 25, 50 and 100 milliseconds;
exhaustion keeps a retaining watch marked `revalidating` unless possibly revoking change
evidence already bounded that answer. Closing the last observation owner cancels its retries.
A local server fallback joins the displayed answer's existing revalidation
episode. Successful transport does not withdraw it while device composition
continues; an accepted answer, an existing change episode cap, or a hard
withdrawal ends retention.
An unavailable device read asks the server only when online, not `held`, and free of unobserved predictions that could affect its reads.

`complete` means the query answered its declared request within known coverage and execution limits.
Filling `first N` or `last N` is complete, including a composed preview.
A cursorless page has no `next`; a cursor page may be complete with `next`.
Meter cuts, a read rule not decided by the scan's prefix (`guide bounds`),
and a local read past its horizon still make the answer incomplete.
`fresh` says the device has everything the server had at the last sync (`since` is the last sync's
time when it does not, and absent when the device has never finished
one); `next` is the cursor for the next page (pass it as the query's
`cursor ?` argument). A row this device wrote and the server has not yet
confirmed carries `pending: true`. A write is `pending` while unsettled, including
a return at custody, a down link, an expired wait, or when the
client closes before its response arrives. It is `sent` with the server's
sequence, or `failed` with the refusal and its predicted rows withdrawn.
`createApp` and local devices keep admitted uncertain intent for restart; the raw
online client on nonbrowser hosts returns `pending` too, but its caller must keep
the id for retry. Public browser online mutations refuse before dispatch as
described above. `onWrite` emits that later terminal result once for
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
`mutate(op, args, { waitSeconds: 0 })` (or a hook's `run(args, { waitSeconds: 0 })`)
returns at custody; omitted keeps the tier's default wait. Settlement still
reaches `onWrite`, `write(id)` and the latest call's `last`.

`await client.pendingWrites()` lists admitted, unsettled writes in submission
order, even when they have no predicted row. Each entry is
`{ id, op, args, state, reason?, predicted }`: `op` is the mutation name,
`args` is the submitted JSON, and `predicted` lists `table/id` names.
`queued` means dispatch has not begun; `sent` means dispatch began but the
outcome is unknown, including an interrupted send; `held` means a retryable
refusal holds the queue, with its code in `reason`. Only `queued` can carry a
prediction sentence in `reason`; `sent` has no reason and is not a receipt.
A bounded custody wait returning `pending` keeps the entry in its current outbox
state. Settlement removes the entry and still emits `onWrite`. Subscribe with
`client.onPendingWrites(notify)` and read again on notification; call the
returned function to unsubscribe. Admitted local and `createApp` custody survives
reload; the raw `createClient` queue is in memory only. Closed and signed-out
handles return `[]`. Legacy entries without dispatch metadata start queued
unless retained sequence evidence proves dispatch.
Notification failures do not undo a committed admission. A dispatch subscriber
that signs out or closes its client prevents transport from starting, including
pagehide keepalive; admitted intent retains its existing custody. If a local or
online hold cannot be saved, its owning client still lists `held` with the refusal
code until a newer persisted dispatch or hold, settlement, or a client lifetime
fence supersedes it. Other clients and reloads can only read the status that storage kept.

```tsx
import { usePendingWrites } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function PendingSends() {
  const sends = usePendingWrites(api.send); // omit the operation to list all writes
  return <>{sends.map(write => <p key={write.id}>{write.args.body}: {write.state}</p>)}</>;
}
```

### Intent cards through settlement

Use `usePendingItems` for a keyed text/media list. The application supplies the
resource predicate and both identities; a mutation ID is never a row ID. This
example assumes `sendById` and `sendMediaById` accept the message's explicit
`id`, `conversationId`, and text or photo respectively.

```tsx
import { usePage, usePendingItems } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function History({ conversationId }: { conversationId: string }) {
  const page = usePage(api.thread, { conversationId });
  const items = usePendingItems({ writes: [api.sendById, api.sendMediaById], rows: page.items,
    scope: w => w.args.conversationId === conversationId,
    rowKey: row => row.id, intentKey: w => w.args.id });
  return <>{items.map(item => item.kind === "row"
    ? <p key={item.key}>{item.row.body}</p>
    : <p key={item.key}>{"body" in item.write.args ? item.write.args.body : "Media message"} — {item.phase === "settling" ? "Sent; updating view" : item.phase}</p>)}</>;
}
```

Items are `{ kind: "row", key, row }` or `{ kind: "intent", key, write, phase,
receipt? }`. Supplied rows keep their order; unmatched intents follow in outbox
order. A visible predicted or confirmed row with the mapped key suppresses its
card. Withdrawing a prediction reveals the intent again; a confirmed row retires it.
No intent is put into query data, and its arguments provide no ordinal, recipient
count, delivery/seen
proof, permission, or asset handle. Media cards show text/type only; open media
from an authorized row using the existing asset API, including once media.

Phases: `saving` is waiting for identification, not admitted; `queued` is admitted
before dispatch; `unknown` is dispatched with an unknown outcome (also after
restart); `held` has a retryable refusal in `write.reason`; `settling` has a
success receipt but may have no visible row. Use the submitting mutation's
`inFlight` for saving before ordinary admission becomes visible. No-op writes
and deleted or out-of-page rows need not appear. There is no disappearance timer.

On process/wasm devices the view reads the same outbox and receipt history,
including successful entries omitted by `usePendingWrites`. It survives offline
restart and retires only when existing observed-write evidence retires custody,
or a terminal refusal arrives. A predicted row never retires an intent.
The online tier retains matching arguments only while a presentation hook is
mounted, including shared-journal intents settled by a peer. A confirmed matching
row retires its reference; prediction does not. Terminal retention is at most
256 entries and 1 MiB of serialized write payloads, evicting oldest settlement
first; pending journal rows cannot evict successes. Reads contain custody
payloads plus this bounded terminal pool. Arguments are copied once at the
receipt transition. Combined pending/settling items keep admission order.
Observed references cannot return during failed receipt-save retries; their
payload-free retirement markers last until custody or scope retirement. A payload
larger than 1 MiB is not retained after settlement. Previously returned intent references become `evicted`
when the bound drops them, and later cards omit them. A payload-free marker stays
in admission order while an older owned intent of that operation remains.
For `usePendingState`, this clears an older selection and returns `current`
unless a later non-evicted scoped match exists. With no arguments left to test
the resource predicate, this fallback applies conservatively to the operation.
Markers coalesce to the newest eviction per operation and release with the
older owned intents or scope. Eviction is not observation.
Unmounting releases unowned arguments. Late mounting recovers pending journal
entries, not terminal arguments already released. Nothing gains replay authority
or survives closing; durable journal retirement is unchanged. Save a scoped intent reference and use
`usePendingWrite(op, id)` for a failure card or post-restart receipt lookup;
after lookup finishes, no receipt means unknown, never permission to resend.
Account/backend/store retirement and close immediately hide the old view,
including during storage failure and delayed reads. This cannot revoke values
already copied by application code. Bearer refresh and schema/program-generation
resets reject old reads but preserve settling text for the same principal and
store. Rows remain the caller's live-read responsibility.

For set-state mutations, `usePendingState` replaces repeated filter/last-intent
selection over the same source:

```tsx
import { usePendingState } from "snapback4/react";
import { api } from "../snapback/generated/api";
import type { Read } from "snapback4/contract";
export function Like({ card, read }: { card: { id: string; liked: boolean } | undefined; read: Read<unknown> }) {
  const like = usePendingState(api.setLike, { scope: w => w.args.postId === card?.id,
    current: card?.liked, read, value: args => args.set });
  return <span>{like.value ? "Liked" : "Like"} {like.intent?.phase}</span>;
}
```

It selects the last matching admitted intent in FIFO order, never lexical ID
order; a saving call does not override admitted state. On the online tier a
successful intent retires when the authorized `read` supplying `current` covers
its receipt sequence, even if another writer changed the value. Equality alone
cannot establish observation. Omit `read` only when relying on local device
retirement or bounded online retention. Supply the actual read for this value,
not another page's read or a latched value. The selector changes no mutation, query, count, or authorization.

Writes that do not predict show pending with `usePendingWrite(op)`. Its
`pending` flag starts at `run(args)` and stays true until `sent` or `failed`,
including the interval before admission returns an id; it must not gate the
next send. Disable Send only with `inFlight`. `last` is the Write;
`run` returns that call's outcome, like `useMutation`. A pre-acquisition write
that queues without a row reports `reason: "queued without a row: not acquired yet"`.
Other missing local evidence reports `reason: "queued without a row: local data does not justify prediction"`.
A predicted write has no such reason; predictions remain visible on rows.
Writes require no acquisition gate after session readiness. Before identification,
`mutate()` allows 15 seconds of identity I/O, excluding prior admissions, including with
`waitSeconds: 0`. `usePendingWrites()` reports “waiting for backend identification;
not yet admitted”. This is memory only: reload loses the unadmitted call. Keep
an editable draft while the call is in flight. After identification, concurrent
calls enter ordinary admission in call order, with normal prediction and custody.
`E_ADMISSION_TIMEOUT` or `E_ADMISSION_STORE` means no admission or send: repair
the connection/current backend, review the draft and submit a new id. The same
mounted form can retry normally. `onWrite` reports terminal outcomes; already
admitted writes retain their ordinary durable recovery.

Identity revalidation shares the 15-second identification budget; waiting behind
an earlier ordinary admission is excluded; predecessor identity checks still
consume it. The first successful identification
pins each call's store and backend fingerprint. Refreshing the same backend from
`/schema` after an offline open preserves that identity: object-key and program
ordering, execution metadata and a missing native descriptor do not change its
schema or interpreter programs. Changing those contents does. A published store ID still
requiring adoption stays unready; temporary unreadiness resumes bounded polling. The final read must match those
pins, which the browser rechecks inside its serialized admission transaction:
an incompatible or unreadable identity returns `E_ADMISSION_STORE` through
`onWrite`, and stalled identity I/O returns `E_ADMISSION_TIMEOUT`. No custody or
POST exists at this boundary. After identity, a storage `E_ADMISSION` still
permits repairing storage and retrying the original ID, including when the
refusal arrived asynchronously through the waiting promise.

```tsx
import { useAcquired, usePendingWrite } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function PendingSend({ conversationId }: { conversationId: string }) {
  const acquired = useAcquired();
  const send = usePendingWrite(api.send);
  return <>
    <button disabled={send.inFlight} onClick={() => void send.run({ conversationId, body: "hi" }, { waitSeconds: 0 })}>Send</button>
    {!acquired && <small>Local data is still acquiring.</small>}
    {send.pending && <small role="status">{send.last?.state === "pending" ? send.last.reason ?? "Sending…" : "Sending…"}</small>}
    {send.last?.state === "failed" && <small role="alert">{send.last.why.message}</small>}
  </>;
}
```

For reload-safe outcomes, save `{ id: mintId(), args }` before submitting
with `{ id }`, in account-and-backend-scoped storage; observe it with
`usePendingWrite(op, savedId)` after reload. See `snapback4 guide client`. Recovery observes that id; it
never submits again. `await client.write(id)` also reads its latest outcome,
and `onWrite` receives later terminal changes. An unknown id returns
`undefined`, as does an evicted terminal id once it leaves the outbox: unknown,
never failed or a reason to resend automatically. The
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
recovery order. Verified terminal corrections replace shared `E_STORE_REPLACED`
in place; authored refusals and retention positions stay unchanged. Every
opener and `client.write(id)` reads that window alongside its own device's
256 receipts; reads never copy or refresh it. For an id with no outbox entry on
this device, `client.write(id)` recovers absent local history or corrects its own
`E_STORE_REPLACED` from the window. Every other local receipt answers first.
Lookup rechecks outbox custody after reading that window; an adopted entry is
answered from this device's own custody. Settlement reads only local history,
including when it has no receipt for the id. The opener reads shared ids solely
to route retries through lookup, without copying or settling their outcomes.
A different tab winning adoption
cannot hide the receipt from a reload. Outboxes remain exclusively owned:
a held Web Lock is never taken; a queued background lock request wakes recovery
when its owner releases it, and closing cancels the wait. Unidentified journals
wait for a matching open or sync signal. Persistence failures get at most three
retries, after 1, 2 and 4 seconds; later opens or sync signals can try again.
Receipt lookups do not create the shared window before adoption. Browser storage
clearing or eviction from both receipt windows can still make an id unknown. Rebuild the Expo native binary with this client
version: acquisition and qualified receipt outcomes are device protocol fields,
and an older module refuses startup with `E_DEVICE_VERSION`.

A sequence-only observation from an older device proves that the server decided,
not that it succeeded. Without a retained outcome, the upgraded client keeps it
pending and replays the same id against its original store to recover the recorded
success or refusal. New sync pages explicitly qualify successful acknowledgements;
only that evidence, or the original store's replay, can correct `E_STORE_REPLACED`.
Authored refusals such as `NOT_ADMIN` remain failures.
Both ordinary and page-hide replay post the retained receipt's original store
binding before any journal or current-device identity, including after replacement.

For replay adapters and retry-safe intents, pass a `mintId()` you stored with
the intent, or name a fixture's write with `idFrom(label)`: the same label gives
the same valid id on every client and host, so a replay needs no ledger.
For real password accounts, use the [headless account recipe](#seed-accounts-headlessly-node)
and a separate `createClient({ url, session })` per account. Signup and login work
in Node; a replay adapter needs no browser or token borrowed from a starter UI.
The example below signs in to an account created by that recipe. Use
`snapback4 dev --replay` when new effects must never be delivered and schedules must stay held.

```ts
import { login } from "snapback4/auth";
import { createClient, idFrom } from "snapback4/client";
import { api } from "../snapback/generated/api.ts";

async function replaySeed() {
  const url = process.env.SNAPBACK_URL ?? "http://127.0.0.1:4400";
  const password = process.env.SEED_PASSWORD;
  if (!password) throw Error("Set SEED_PASSWORD privately in the environment");
  const result = await login(url, "seed1@example.test", password);
  if (!result.ok) throw Error(result.why.message);
  const client = createClient({ url, session: result.session });
  try {
    // This account must already belong to c1. Replay returns the recorded outcome.
    const write = await client.mutate(api.send, { conversationId: "c1", body: "hello" }, { id: idFrom("seed:c1:hello") });
    if (write.state !== "sent") throw Error(write.state === "failed" ? write.why.message : "Seed write pending");
  } finally { await client.signOut(); }
}
```

A derived id sorts before every minted id, as if minted at the epoch, so a
fixture row named with `idFrom` never crowds a `by .id` window of real rows.
Pass an id as `{ id }`; a retry returns the original outcome and never applies twice:
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

`Client.signOut()` clears
local credentials and closes the client; remote session revocation is best effort.
Applications keeping an online session with `keepSession` also call
`forgetSession` on their own store (§6); the local client clears its managed store.

### Following history

Declare the Following view and card query from `guide feeds`; its generated
handle supports `useFollowing`. Online, each history page is a correct prefix
of the frozen author domain. The SDK owns preparation, replay, restarts, live
prepend and withdrawal. Post-bound backdated posts or new follows obstructing
the unscanned range report `stalled`; continuation finishes when that churn stops.

```tsx
import { useFollowing } from "snapback4/react";
import { api } from "../snapback/generated/api";
export function useFollowingCards() {
  return useFollowing(api.cards, { c: null });
}
```

Render `items` and `phase`; `preparing` is not an empty feed. Call `loadMore`
when `hasMore`. Show `omissions` for oversized cards and `code` for a refusal;
`retry` retries after repair. Offline, `inbox` retains the original read state
and `fact` says “older posts are not on this device”. Every mounted consumer
owns its session; four may coexist per viewer and declaration. Five idle
minutes, a server restart or changed authority restarts the revision explicitly.
This reader is server-only; the existing inbox query and its device copy window
are unchanged. See `guide feeds` for shaping and custody bounds.

### React

Start with `snapback4 guide client` for composers, stable routes, receipts and one-view photos.

```tsx
import { SnapbackProvider, useClient, useQuery, usePage, useMutation, useAction, useLink, useViewer, useSession, useAsset } from "snapback4/react";
import { existence, type Client } from "snapback4/contract";
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
    <Text>{link}: {"loading" in read ? "Loading…" : "denied" in read ? read.denied.message : `${items.length} messages`}</Text>
    {photo.status === "ready" && <Image source={{ uri: photo.url }} style={{ width: 240, height: 180 }} />}
    {photo.status === "loading" && <Text>Loading photo…</Text>}
    {"data" in read && photo.status === "empty" && <Text>No photo</Text>}
    {photo.status === "denied" && <Text>{photo.why.message}</Text>}
    <Text onPress={() => void client.signOut()}>Sign out</Text>
  </View>;
}
export function App({ client, conversationId }: { client: Client; conversationId: string }) {
  return SnapbackProvider({ client, children: <Thread conversationId={conversationId} /> });
}
```

#### The React entry at a glance

Every function `snapback4/react` exports, with its result. `op` is a generated `api.*` handle;
the `Use*` types name a hook's result for a prop. Hover any name for its full comment.

| Function | Returns |
| --- | --- |
| `AppProvider({ app })`, `SnapbackProvider({ client })` | the provider; `AppProvider` remounts its children when the account changes |
| `useAuth()` | `AuthSnapshot` plus `signup`, `login`, `guest`, `logout`, `logoutEverywhere`; `state === "signed-in"` narrows `viewer` |
| `useClient()`, `useOnline()` | the `Client`; the app's server arm `Online` (under `AppProvider`) |
| `useQuery(op, args, { keep, skip }?)` | `Read<R>` (`UseQuery<typeof op>`): narrow with `matchRead` or the guards; `skip: true` reads nothing (`loading`) |
| `usePage(op, args, { keep, skip }?)` | `{ items, hasMore, read, loadMore }` (`UsePage<typeof op>`, a `PageHook<R>`); `op` declares `c: cursor ?` |
| `useFollowing(op, args)` | Following history: the snapshot plus `loadMore`, `retry`, `refresh` (`guide feeds`) |
| `useMutation(op)` | `{ run(args, options?), last, inFlight }` (`UseMutation<typeof op>`): `Write<R>`, or `Signal<R>` for an ephemeral `op` |
| `usePendingWrite(op, id?)` | `useMutation`'s shape plus `pending` and `restoring`, for a saved mutation id |
| `usePendingWrites(op?)`, `usePendingItems(options)`, `usePendingState(op, options)` | admitted writes; rows merged with intent cards; the latest admitted set-state intent |
| `useAction(op)` | `{ run(args, options?), last, inFlight }` (`UseAction<typeof op>`) with `Act<R>` outcomes |
| `useViewer()`, `useSignedInViewer()` | `Principal \| null`; `Principal`, throwing `E_AUTH` outside a signed-in gate |
| `usePersonaApp(persona, open)` | the `App` for a development persona, or null: opens it with `open(persona)`, closes it on switch and unmount |
| `useLink()`, `useSession()`, `useNow(deadline?)` | `"online" \| "offline" \| "signed-out"`; `Session \| null`; server time in ms |
| `useAcquired()`, `useAcquisition()` | whether the device holds its first snapshot; acquisition progress |
| `useAsset(id)` | `AssetState`: `empty`, `loading`, `ready` (`url`, a file's `name`), `denied` or `error` (`why`) |
| `useSaveAsset()` | `{ save(id, name?), saving, why }`: a file saved on demand, through the browser's download |
| `useSeen(family, { scope, through, active })` | seen-progress snapshot plus `retry()` (`guide receipts`) |
| `useInspection(enabled?)` | development overlay samples, or null when disabled |
| `matchRead(read, handlers)` | the handlers' result for the read's state: `loading`, `denied`, `absent`, `partial`, `present`, or `otherwise`; `read` may be a `usePage` result |
| `otherwiseAll(fallback, overrides?)` | spread anywhere into `matchRead`'s handlers: `fallback(read)` for every state the call does not name, `denied` and `partial` included; named handlers win in any order |
| `isReady`, `isLoading`, `isDenied`, `isFailed`, `existence`, `readPresentation` | guards over any read (and `isFailed` over any `Outcome`, a hook, or `unknown`); the state name; notice flags |
| `sentResult(write)` | a write's fresh server result, or `undefined` while pending, after a failure, before the first run, or for a replayed receipt |

#### Narrowing reads and writes in TypeScript

`matchRead` takes no type arguments: the row type comes from the read, and the handlers'
return types become the result's union (`matchRead<Row[]>(…)` fails with "Expected 2 type
arguments"). `present` and `partial` receive `data`; `otherwise` receives the **read** (loading,
absent or present, even when one of those also has a handler), so narrow it with `isReady` before
touching `.data`. `denied` and `partial` stay explicit beside `otherwise`, so a list still
decides what an uncertain page shows; leaving one out fails with "Property 'denied' is missing
… `otherwise skips denied: add denied: why => …`". To send them to the same fallback, say so
with one spread: `matchRead(read, { ...otherwiseAll(() => "…"), present: rows => rows.length })`.
The fallback receives the read (`readPresentation(read).why` is a refusal) and runs only for the
states the call leaves unnamed: a `denied` or `partial` handler wins wherever it is written.
`otherwiseAll(fallback, { denied: why => …, loading: () => … })` carries handlers that need no
rows; they see the read as `Read<unknown>`, so `partial: rows => …` belongs in the call itself. A `Write` is `pending`, `sent` or `failed`, and a replayed
`sent` has no `result`: check `!write.replayed` (or `"result" in write`) before reading it, or
let `sentResult(write)` do both (below). The
online client can return `pending` too, while offline or with `waitSeconds: 0`. `close()` returns
a promise; an effect cleanup must return nothing, so write `() => { void client.close(); }`.
`UseQuery<typeof api.op>`, `UsePage<typeof api.op>`, `UseMutation<typeof api.op>` and
`UseAction<typeof api.op>` name each hook's result for a prop; every name here imports from
`snapback4/react`, and `Client` also from `snapback4/client`. A guard takes a page's `page.read`, never the page: `isDenied(page)` fails
with "`PageHook<…>` is not assignable to `Read<unknown>`"; `matchRead(page, …)` takes either.

```tsx
import { isFailed, sentResult, useMutation } from "snapback4/react";
import { api } from "../snapback/generated/api";
// Open the new profile once the server confirms it. sentResult is undefined while the write is
// pending (offline, or `waitSeconds: 0`), after a refusal, and for a replayed receipt.
export function CreateProfile({ open }: { open: (id: string) => void }) {
  const create = useMutation(api.createProfile);
  const submit = async (handle: string) => {
    const created = sentResult(await create.run({ handle }));
    if (created) open(created.id);
  };
  return <button onClick={() => void submit("alice")}>{isFailed(create.last) ? create.last.why.message : "Create"}</button>;
}
```

Name an operation's types from the generated `api`, never from its private `__result` field:
`RowOf<typeof api.thread>` is one row of a list or page query (a `usePage` item) or a point
query's non-null row, `ResultOf<typeof api.thread>` the whole result (the row array; for a
mutation, its `result`), and `ArgsOf<typeof api.send>` the argument object. `Rows["messages"]`
in the generated module is a table's row; a projected query's rows are not table rows and carry
no `id` unless the projection names one. `isReady`, `isLoading` and `isDenied` take any read,
so one guard covers reads of different queries: `[thread, me].find(isDenied)` or
`reads.some(isLoading)` types without annotating `Read<unknown>[]`. `isFailed` does the same for
outcomes, including a hook's `last` (undefined before the first run), and takes a mutation or
action hook itself, testing its `last`: `[add.last, remove.last].find(isFailed)?.why` and
`[add, remove].find(isFailed)?.last.why` both type. `Outcome` (any `Write`, `Signal` or `Act`)
types a shared status helper, and `isFailed` narrows an `unknown` too (an awaited
`Promise<unknown>`): `function FailText({ of }: { of: (Outcome | undefined)[] }) { return
of.find(isFailed)?.why.message ?? null; }`. `App`, `AppOptions` and
`AuthSnapshot` are also exported here for components that take the app; `createApp` itself
imports from `snapback4/app`. After `auth.state === "signed-in"`, `auth.viewer` is a
`Principal`, never null. Below that gate, `useSignedInViewer()` gives any component the same
`Principal`, never null: it reads the auth snapshot the gate narrowed (the client's viewer under
`SnapbackProvider`), and rendered with nobody signed in it throws `E_AUTH`, a missing gate.
`useViewer()` stays `Principal | null` for a component that also renders signed out. An optional argument (`status: text ?`) is typed `status?: string | null`: omitting it
and passing `null` mean the same. A `principal` argument takes the stored principal string, as
`auth.viewer` returns it (`dev:alice` for a development persona, also in fixtures and cases).

```tsx
import { isDenied, isFailed, isLoading, isReady, matchRead, otherwiseAll, readPresentation, useMutation, useQuery, type Outcome, type RowOf, type UseMutation, type Write } from "snapback4/react";
import { createClient, type Client } from "snapback4/client";
import { useEffect, useState } from "react";
import { api } from "../snapback/generated/api";
type Message = RowOf<typeof api.thread>;
function Bodies({ rows }: { rows: readonly Message[] }) { return <ul>{rows.map(row => <li key={row.id}>{row.body}</li>)}</ul>; }
export function Thread({ conversationId }: { conversationId: string }) {
  const read = useQuery(api.thread, { conversationId });
  const send = useMutation(api.send);
  return <>{matchRead(read, {
    denied: why => <p role="alert">{why.message}</p>,
    partial: rows => <><Bodies rows={rows} /><p>Results may be incomplete</p></>,
    present: rows => <Bodies rows={rows} />,
    otherwise: read => isReady(read) ? <p>No messages yet</p> : <p>Loading…</p>,
  })}<Composer conversationId={conversationId} send={send} /></>;
}
function Composer({ conversationId, send }: { conversationId: string; send: UseMutation<typeof api.send> }) {
  const [note, setNote] = useState("");
  const settle = (write: Write<{ id: string }>) => setNote(isFailed(write) ? write.why.message
    : write.state === "pending" ? "Sending…" : write.replayed ? "Already sent" : `Sent ${write.result.id}`);
  return <><button onClick={() => void send.run({ conversationId, body: "hi" }).then(settle)}>Send</button>{note}</>;
}
export function Header() {
  const me = useQuery(api.myProfile, {});
  if (isLoading(me)) return <p>Loading…</p>;
  if (isDenied(me)) return <p role="alert">{me.denied.message}</p>;
  return <p>{me.existence === "present" ? me.data.handle : "No profile"}</p>;
}
export function Notices({ conversationId }: { conversationId: string }) {
  const thread = useQuery(api.thread, { conversationId }), me = useQuery(api.myProfile, {});
  const send = useMutation(api.send), like = useMutation(api.setLike);
  const reads = [thread, me];
  const denied = reads.find(isDenied), failed = [send.last, like.last].find(isFailed);
  return <>{denied && <p role="alert">{denied.denied.message}</p>}
    {reads.some(isLoading) && <p>Loading…</p>}
    {failed && <p role="alert">Not saved: {failed.why.message}</p>}</>;
}
// One fallback for every state the call does not name, denial included; a status line for any outcome.
export function Count({ conversationId }: { conversationId: string }) {
  return <p>{matchRead(useQuery(api.thread, { conversationId }), { ...otherwiseAll(read => readPresentation(read).why?.message ?? "…"), present: rows => `${rows.length} messages` })}</p>;
}
export function FailText({ of }: { of: (Outcome | undefined)[] }) { return <p role="alert">{of.find(isFailed)?.why.message}</p>; }
export function useOwnClient(url: string, persona: string): Client | null {
  const [client, setClient] = useState<Client | null>(null);
  useEffect(() => {
    const opened = createClient({ url, persona });
    setClient(opened);
    return () => { void opened.close(); };
  }, [url, persona]);
  return client;
}
```

#### Lists and single values with `useQuery`

`usePage` is only for a query that declares `c: cursor ?` and reads `after c`; every other
query, including a short list, uses `useQuery`. Its result is the read itself, not
`{ data, status }`: `members.data` does not type-check until the read is narrowed, so render
it with `matchRead` (or `isReady` and `read.existence`). A list's `present` and `partial`
receive the rows, and `absent` is the proven-empty list. A scalar query (`bool`, `int`) is
the same read: `false` and `0` are `present` data, and `absent` means the query answered `null`.
`readPresentation(read)` gives the notice flags (`pending`, `incomplete`, `stale`,
`revalidating`, `why`) for a banner beside either; it never narrows `data`.

```tsx
import { matchRead, readPresentation, useAuth, usePage, useQuery, useSignedInViewer, type RowOf, type UsePage, type UseQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
type Member = RowOf<typeof api.members>;
function MemberList({ rows }: { rows: readonly Member[] }) { return <ul>{rows.map(row => <li key={row.id}>{row.id}</li>)}</ul>; }
export function Members({ conversationId }: { conversationId: string }) {
  const members = useQuery(api.members, { conversationId }), notice = readPresentation(members);
  return <>{matchRead(members, {
    loading: () => <p>Loading…</p>,
    denied: why => <p role="alert">{why.message}</p>,
    absent: () => <p>No members yet</p>,
    partial: rows => <MemberList rows={rows} />,
    present: rows => <MemberList rows={rows} />,
  })}{notice.incomplete && <p>Results may be incomplete</p>}{notice.stale && <p>Offline: showing saved results</p>}</>;
}
export function HandleCheck({ handle }: { handle: string }) {
  const free = useQuery(api.handleAvailable, { handle }), unread = useQuery(api.unreadCount, {});
  return <p>{matchRead(free, {
    denied: why => why.message, partial: () => "Checking…",
    present: available => available ? "Available" : "Taken",
    otherwise: () => "Checking…",
  })} · {matchRead(unread, { denied: () => "", partial: n => `${n}+ unread`, present: n => `${n} unread`, otherwise: () => "" })}</p>;
}
function ProfileLine({ me }: { me: UseQuery<typeof api.myProfile> }) {
  return <p>{matchRead(me, { denied: why => why.message, partial: () => "…", present: profile => profile.handle, otherwise: () => "No profile" })}</p>;
}
function MoreButton({ page }: { page: UsePage<typeof api.inbox> }) {
  return <button disabled={!page.hasMore} onClick={page.loadMore}>More ({page.items.length} shown)</button>;
}
function MyThreads() {
  const me = useSignedInViewer(), inbox = usePage(api.inbox, {}), profile = useQuery(api.myProfile, {});
  const mine = matchRead(profile, { denied: () => false, partial: () => false, present: row => row.principal === me, otherwise: () => false });
  return <>{mine && <ProfileLine me={profile} />}<MoreButton page={inbox} /></>;
}
export function Home() {
  const auth = useAuth();
  return auth.state === "signed-in" ? <MyThreads /> : <p>{auth.why?.message ?? "Sign in to continue"}</p>;
}
```

#### Status components and a form

Two shared components cover most screens' status lines: `ReadState` for any read that is not
showing rows (it takes `Read<unknown>`, so every query's read fits) and `WriteNote` for any
write, signal or action outcome (`Outcome`; a hook's `last` is undefined before its first run).
A read whose arguments do not exist yet takes `{ skip: true }` instead of a wrapper component:
it stays `loading` and opens nothing until `skip` turns off. One list-and-form screen with them:

```tsx
import { useState } from "react";
import { isFailed, matchRead, otherwiseAll, readPresentation, useMutation, usePage, type Outcome, type Read, type RowOf } from "snapback4/react";
import { api } from "../snapback/generated/api";
type Message = RowOf<typeof api.thread>;
/** Loading, refused, proven empty or possibly incomplete: one line for any read. */
export function ReadState({ read }: { read: Read<unknown> }) {
  const status = readPresentation(read);
  if (status.why) return <p role="alert">{status.why.message}</p>;
  if (status.pending) return <p role="status">Loading…</p>;
  return status.existence === "absent" ? <p>Nothing yet</p> : status.incomplete ? <p role="status">More may exist</p> : null;
}
/** The refusal of the latest write, signal or action outcome, if it failed. */
export function WriteNote({ last }: { last: Outcome | undefined }) {
  return isFailed(last) ? <p role="alert">{last.why.message}</p> : null;
}
export function Messages({ conversationId }: { conversationId: string | null }) {
  const page = usePage(api.thread, { conversationId: conversationId ?? "" }, { skip: !conversationId });
  const send = useMutation(api.send), like = useMutation(api.setLike);
  const [draft, setDraft] = useState("");
  const list = (rows: readonly Message[]) => <ul>{rows.map(row => <li key={row.id}>{row.body}
    <button onClick={() => void like.run({ postId: row.id, set: true })}>Like</button></li>)}</ul>;
  async function submit() {
    if (!conversationId || !draft) return;
    const write = await send.run({ conversationId, body: draft });
    if (!isFailed(write)) setDraft(""); // sent, or pending offline: the outbox owns it now
  }
  return <>
    {matchRead(page, { ...otherwiseAll(read => <ReadState read={read} />), present: list, partial: rows => <>{list(rows)}<ReadState read={page.read} /></> })}
    {page.hasMore && <button onClick={page.loadMore}>More</button>}
    <input value={draft} onChange={e => setDraft(e.target.value)} />
    <button disabled={!conversationId || !draft || send.inFlight} onClick={() => void submit()}>Send</button>
    <WriteNote last={[send.last, like.last].find(isFailed)} />
  </>;
}
```

#### Personas in a React UI

A development UI can act as a declared persona (`use personas alice, bob`) behind the same
`AppProvider`, `useAuth` and `app.mutate` it uses for accounts: `createApp({ url, persona: "bob",
device })` acts as `dev:bob` with no session. `app.auth.state` goes `restoring` → `signed-in`;
`login`, `signup`, `guest` and `logoutEverywhere` refuse `E_AUTH`; `logout()` stops the app and
leaves the persona's queued writes on its device for its next app. The url must be literal loopback
(`localhost`, `127.x`, `[::1]`), or `ready` resolves `{ ok: false }` with `E_AUTH` before any request
carries the header; `snapback4 dev` still checks the socket, `Host` and `Origin`, and `serve`
refuses personas, which the app also reports as `E_AUTH`. A persona app writes in a browser only with a
device (it has no session store for the device-less journal): without one, `app.mutate` refuses
`E_ADMISSION` and names `createApp({ url, persona, device: webDevice() })`. Switching persona replaces the app:
`usePersonaApp(persona, openApp)` opens one per persona and closes the old one on switch and
unmount (or close it in your own effect's cleanup). One tab is one device per store, and each persona has its own store.

A schema with `use personas` and no `use identity` has no account to sign into: the starter's
`auth.guest()` refuses `E_AUTH` there, so open a persona app instead of calling it. Each recipe
below is one file: `openApp` is the only constructor, and `Root` replaces `<AppProvider>`'s app
when the persona changes. Until `auth.state` is `signed-in` the new app is still opening; gate
navigation and writes on it rather than on the old app's screen.

On the web, `?as=bob` picks the persona and a picker rewrites it:

```tsx
import { AppProvider, useAuth, useQuery, type App } from "snapback4/react";
import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { webDevice } from "snapback4/web";
import { useEffect, useState } from "react";
import { api } from "../snapback/generated/api";

const url = "http://127.0.0.1:4400";
const personas = ["alice", "bob"];
const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
/** One app per persona: `?as=bob` acts as dev:bob on `snapback4 dev`; with no
 * persona, people sign in (drop that branch for a persona-only schema). */
export function openApp(persona: string | null): App {
  if (persona) return createApp({ url, persona, device: webDevice() });
  return createApp({ url, device: webDevice(), sessionStore: localStorageSessionStore() });
}
export function Root() {
  const [persona, setPersona] = useState(() => new URLSearchParams(location.search).get("as"));
  const [app, setApp] = useState<App | null>(null);
  useEffect(() => {
    const opened = openApp(persona);
    setApp(opened);
    return () => { void opened.close(); };
  }, [persona]);
  const choose = (next: string) => {
    const address = new URL(location.href);
    address.searchParams.set("as", next);
    history.replaceState(null, "", address);
    setPersona(next);
  };
  if (!app) return null;
  return <AppProvider app={app}>
    {loopback && <select aria-label="Persona" value={persona ?? ""} onChange={e => choose(e.target.value)}>
      <option value="" disabled>Sign in</option>{personas.map(name => <option key={name}>{name}</option>)}</select>}
    <Who />
  </AppProvider>;
}
function Who() {
  const auth = useAuth();
  const me = useQuery(api.myProfile, {});
  if (auth.state !== "signed-in") return <p>{auth.why?.message ?? "Opening…"}</p>;
  return <p>{auth.viewer}: {"data" in me && me.data ? me.data.handle : "no profile yet"}</p>;
}
```

A schema with `use personas` and no `use identity` has no sign-in at all, so `auth.guest()` refuses
`E_AUTH`: `snapback4 init --web` (or `--expo`) beside such a schema writes this
picker instead of the guest screen, and when the starter came first, `snapback4 init --adapt`
rewrites its unmodified guest screen into this picker. In React Native there is no `location`: keep the persona in
state, one app per persona as above (`nativeDevice` in development builds, none in Expo Go, where
the app is online-only):

The iOS simulator and Expo web reach `snapback4 dev` on the host's `127.0.0.1`; an Android
emulator's host alias `10.0.2.2` is not literal loopback, so run `adb reverse tcp:4400 tcp:4400` and
keep `127.0.0.1`. A physical phone cannot use personas: `dev` admits the header only from a loopback
socket.

```tsx
import { AppProvider, useAuth, usePersonaApp } from "snapback4/react";
import { createApp, type App } from "snapback4/app";
import { nativeAvailable, nativeDevice } from "snapback4-expo";
import { useState, type ReactNode } from "react";
import { Button, Text, View } from "react-native";

const url = "http://127.0.0.1:4400"; // the iOS simulator reaches this machine's loopback
const personas = ["alice", "bob"];
const openApp = (persona: string): App =>
  createApp({ url, persona, device: nativeAvailable() ? nativeDevice : undefined });
export function PersonaRoot({ children }: { children: ReactNode }) {
  const [persona, setPersona] = useState<string | null>(null);
  const app = usePersonaApp(persona, openApp); // null until the chosen persona's app exists
  if (!persona || !app) return <View>{personas.map(name =>
    <Button key={name} title={`Act as ${name}`} onPress={() => setPersona(name)} />)}</View>;
  return <AppProvider app={app}><Signed leave={() => setPersona(null)}>{children}</Signed></AppProvider>;
}
function Signed({ leave, children }: { leave: () => void; children: ReactNode }) {
  const auth = useAuth();
  if (auth.state === "signed-in") return children;
  return <View><Text>{auth.why?.message ?? "Opening…"}</Text><Button title="Choose a persona" onPress={leave} /></View>;
}
```

Without React, `createLocalClient({ url, persona, device })` and `createClient({ url, persona })`
take the same option; the online one reads in a browser but refuses durable writes there.

`useQuery` observes: it re-renders when a sync or a local prediction
touches the query's tables, and at the next visible `expire at` time even
when a local device is offline. A column named `expiresAt` alone does not
declare a lifetime: put `expire at .expiresAt` on its table. The online
client refetches at that deadline and needs a connection to evaluate it.
`usePage` follows `next` across pages; it
supplies the query's cursor argument itself, which must be named `c`
(`c: cursor ?`). For generated source-row pages it accumulates by row identity,
keeping the latest observed image at its first display position.

The social starter uses one ordinary `search` across conversations and one
pinned `searchChat`. A replica client combines current server hits and this
device's certified retained hits online, then searches acquired holdings offline.
An online-only client has only the current server domain. Declare conversation
and order columns immutable; keyset continuation follows `(at, id)` and is not
a snapshot. Refresh from page one for new matches before the cursor. Render
`usePage`'s `items`, `hasMore` and `loadMore`; show “Partial results” when
`readPresentation(page.read).incomplete` is true, including nonempty `present`
pages with incomplete coverage, a cut or a continuation. Staleness is separate.
Missing retained coverage and cuts remain incomplete, even empty.
See `snapback4 guide search` and `snapback4 new my-social --template social`.

Live reads keep the displayed answer during a re-read by default:

```tsx
import { useQuery, usePage } from "snapback4/react";
import { api } from "../snapback/generated/api";
function useThread(conversationId: string) {
  const inbox = useQuery(api.inbox, {});
  const thread = usePage(api.thread, { conversationId });
  return { inbox, thread };
}
```

<!-- @ref LLP 3000.023#12 — only possible revocation bounds a retained answer. -->
A mounted observation with an unchanged key keeps its answer marked
`revalidating: true` through explicit refetch, reconnect, slow reads, transport
failure and retry exhaustion. There is no plain-revalidation time limit.
Transport failure marks `fresh: false` and preserves the answer's `since` (or
uses its last confirmation time). No new public flag is needed. Local commits
(`apply`, `admit`, `settle`) re-read and replace directly from the replica.

Answers stay visible and `revalidating` until replaced unless change evidence
may revoke a row; then the existing one-second withdrawal bound applies.
Local commits, online mutation acknowledgements, durable and ephemeral `/changes`
and `/sync` publications use the same automatic classification. Inserts and
updates to columns outside read rules and policies revalidate without timeout,
including through failure and retry exhaustion. Deletes and tombstones, sweeps,
changes to read-rule/audience/membership/asset/expiry inputs, and unknown or
older evidence keep the bound. There is no application option to configure.
A possibly revoking change starts one non-renewable second for the displayed
answer, including when it is already revalidating. Failure withdraws immediately;
timeout withdraws to one stable `loading` snapshot, while a late accepted answer
can still replace it. Further refetches, change bursts and facade holds cannot
restart or erase the bound. Snapshots and peeks enforce it without timer delivery.
For local watches, a reported durable cut remains pending until sync publishes
it. An older replica read cannot settle that bound or reinstall withdrawn rows.
A whole server answer at or after the cut can replace the display while sync
waits; older replica answers remain ineligible until it catches up. Plain offline
ephemeral recovery keeps the answer through its original row expiry.

Scope metadata survives server fallback, retained composition and recovery memory.
Server narrowing uses literal/viewer/unshadowed argument audience prefixes over
all query branches, never hidden row keys. By-ID points without audience keys,
data-dependent selectors, recursive/native reads, unmapped derived dependencies,
ordinary mixed word-search coordination and legacy replies remain conservative
at the table boundary. Unpinned audience dimensions match every group.
Online `/changes` identifies touched tables and conservatively certifies row
authority preservation. A possibly revoking change can still exhaust its
one-second bound if all slots are occupied. Evidence rereads jump ordinary
queued work, within eight starts per turn/eight active, without preemption.

A `/changes` program-generation mismatch withdraws immediately, even at the
same sequence with no touched tables. Displayed answers, remembered answers
and pending evaluations belong to the retired program. The old replica stays
unavailable until adoption completes; failed sync does not restore its answers.
Quiet presence samples also respect a pending durable cut: an older sample
cannot clear the bound or restore a withdrawn answer.
An omitted notification table list bounds every watch on either client; an
explicit empty list keeps the usual dependency intersection.

| `keep` | Plain revalidation | Change evidence | Last subscriber leaves |
| --- | --- | --- | --- |
| omitted | Retains until replaced | 1 s; withdraws on failure | Closes |
| `false` | Withdraws immediately | Withdraws immediately | Closes |
| `true` | Retains until replaced | 1 s; withdraws on failure | Lingers 30 seconds |

The three options own separate watches, even for identical operations and
arguments. Pass them to `client.observe`, `useQuery` or `usePage`.
**Retention can show a revoked row during the re-read.** For actions, check
`isReady(read) && !read.revalidating`. Use `keep: false` for an export, copy or
playback that must withdraw as soon as the client processes the change.
`fresh` still describes server confirmation: a completed offline answer may
have `fresh: false` without being `revalidating`. Retention grants no authority.

`keep: true` keeps the same live observation for 30 seconds after its last
subscriber leaves, with normal reads, timers and change-feed interest. A new
subscriber with that option, operation, arguments, viewer and store joins it
and sees its current snapshot in the first committed render. This costs
observation memory and background work while unmounted. A subscriber joining
an already-active default watch also sees its current answer immediately.

App facades share one approval per raw watch. A peer's successful authority
check moves every live facade of that watch to the approved replacement.
Every retaining watch keeps the previous approved answer, marked `revalidating`, while the replacement
waits for its authority check. It inherits the same episode deadline by value
and tracks the held answer's own device and server deadlines through clock
corrections. A local reobservation wakeup does not expire remembered server
data. Every source withdrawal clears the shared approval and remount peeks
immediately, including a bounded re-read failure and a replacement's earlier expiry.
Opening remounts register for the watch before its raw owner or first approval exists and
receive notifications for approval, withdrawal and each distinct denial. An
opening keeps its last raw-owner association if that owner retires while its
check waits, so an opening refusal still reaches the attached slot exactly once.
This also applies when the opening first joined through a peer's notification.
While a raw owner is present, opening getters and notifications apply its current
loading or denial before returning or delivering, just as sourced getters do.
A live facade stays attached after a transient authority error, so a peer's later
approval reaches it too. Expiry and follower registrations release on rejection;
notification ownership ends only on close or a facade fence.
A refusal from the facade's current refresh invalidates authority checks already
in flight across all facades of that watch; a superseded refresh's result is ignored.
Only a check started after the refusal can recover it. Adopting an
already-delivered denial does not fence those new checks. A refusal completing
after its facade closes still clears the shared approval for live peers of its
associated raw owner. A closed opening cannot revoke a later owner it never joined. Opening
facades adopt a denial already delivered while they waited, without notifying
again. A denial unchanged since opening does not count as that delivery, even if
another refusal was normalized back to it; the opening refusal still fences
older checks. An older authority completion cannot publish a newer unchecked answer.
Grouped withdrawals change every affected raw snapshot and shared approval before
delivering read or link callbacks, including callbacks from lingering remounts.
Facade snapshots honor their source's loading or denial even before their own
subscription callback runs, including with `keep: false`; new data still needs
authority. For all three policies, a closed facade keeps consulting its detached
raw handle but never adopts a new identity. While its last identity is still the source's and its own row and episode
deadlines hold, it returns the source's current copy of that identity, including
its revalidating mark. It preserves the earliest episode it observed, whether
before or after close, even if a later copy omits the deadline. Its returned
copy fixes that deadline, including during a live peer's later queue pause. After that it returns one stable `loading` snapshot, or its denial, even
when the replacement has identical data. A closed facade has no listeners and
never notifies. Loading captured at close is already latched, without another
getter call. Once its loading snapshot latches, a later source denial does
not replace it; an explicit facade fence still revokes the entire handle.
Closing a standalone `keep: false` facade removes its raw owner
and cancels its subscriptions and timers. Shared approval and raw subscription delivery
announce the same withdrawal only once, including an authority refusal during
replacement or opening.
An episode expiring during a grouped commit notifies after every affected watch
has reloaded, so callbacks also see peers' revalidation marks.

For all three options, an expired candidate, refusal,
expiry, sign-out, credential or viewer change, store replacement or adoption,
`clear_rows`, `settle_exit`, ephemeral incarnation change, first schema
installation, or client close withdraws the answer immediately. A successful
server fallback keeps retaining while device composition finishes, subject to
any existing online-change episode. Expiry retry transport explicitly withdraws, including with `keep: true`.
Closing the client cancels row deadlines before publishing its stable denial. A
closed local observation records the client authority revision at detach. Any later
change notification, commit, publication, scope loss, refusal or reset discards
its saved answer before reuse, even for unrelated evidence. Getters never park
detached owners. Resubscription checks the device watermark and evaluates before
returning data; without later evidence it rearms the original row deadlines.
Only notifications intersecting the query's tables hold that reevaluation for
sync; unknown dependencies stay conservative. The metadata wait cancels with
the observation or its 30-second attempt lifetime. Notifications invalidate
intersecting remembered answers without needing a live owner. Empty advancing
notifications and every sync publication clear all remembered server answers:
replica footprints cannot certify unchanged online-only authorization, even when
nonempty. This includes recovery, staged applies and no-op sync. Mounted server,
composed and recovered answers revalidate through the existing bounded queue. Authorized
online-only/out-of-horizon fallback can therefore become unavailable offline
until a server query refills it; authorized replica rows remain available.
Quiet empty polls with no advance preserve authority and completed memory;
they carry no change evidence and must not exhaust bounded query retries. Disjoint local admissions,
settlements and known notification tables do too. Pending evaluations, detached answers and facade approvals all check one
monotonic authority revision. Every terminal refusal advances it; later successful
sync cannot restore an older response's authority. Credential rotation and
terminal refusals retire all remembered answers.
Lingering handles remain live and keep precise audience matching. Observed server expiry also
fences remembered answers, so clock rollback cannot recover the expired body,
while preserving newer answers whose server deadlines have not arrived.

`usePage` preserves valid earlier pages while a later page loads or withdraws.
Its combined read carries `revalidating` while any displayed page has that mark,
and checks page deadlines before returning a cached result. A first-page
withdrawal clears the displayed items; a later-page withdrawal removes that
suffix. A changed cursor replaces its old suffix.

`usePage` returns `items: []` while page one is loading: that is not an empty
answer. Keep effects out of rows and the header/composer above this boundary.
Use the screen below to show loading, refusal and incomplete answers. A ready
`absent` proves emptiness at the acquired watermark, including offline; nonempty
answers remain `present` even with incomplete coverage.

### A stable conversation screen

`readPresentation(read)` from `snapback4/contract` derives notice flags without
subscribing or saving data. `pending` means `loading`, not queued writes.
The partial-results notice follows `readPresentation(page.read).incomplete`.
`incomplete` covers ready partial answers, incomplete coverage, disclosed cuts
and continuations, including nonempty `present` pages. `stale` is `!fresh` on a
ready answer; `revalidating` is independent. `why` is the current refusal and
`since` the unchanged ready timestamp. Loading/denied carry no ready metadata.
Use `matchRead` on the original read to render narrowed data or decide an action;
there is no permission flag. Empty results are proven only by `existence === "absent"`, even offline.

This complete React/Expo screen uses the generated `thread`, `myMembership`
and `send` handles from the chat shape above. Put it under `AppProvider`.
The shell key includes backend, signed-in account and resource. Its draft stays
mounted through every read arm, while results come only from `usePage`'s current
items. A withdrawal removes protected results without removing the composer.
For a browser-only UI, substitute HTML controls for the React Native controls.

```tsx
import { useState } from "react";
import { Button, ScrollView, Text, TextInput, View } from "react-native";
import { matchRead, readPresentation, useAuth, useMutation, usePage, useQuery, type ReadPresentation } from "snapback4/react";
import { mintId } from "snapback4/client";
import { api } from "../snapback/generated/api";

export function ConversationScreen({ backend, conversationId }: { backend: string; conversationId: string }) {
  const auth = useAuth();
  if (auth.state !== "signed-in") return <Text>{auth.state === "restoring" ? "Restoring account…" : "Sign in"}</Text>;
  return <ConversationShell key={JSON.stringify([backend, auth.viewer, conversationId])} conversationId={conversationId} />;
}
function ConversationShell({ conversationId }: { conversationId: string }) {
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState<{ id: string; body: string } | null>(null);
  const send = useMutation(api.send);
  const member = useQuery(api.myMembership, { conversationId });
  const blocked = matchRead(member, { denied: () => true, absent: read => read.fresh && !read.revalidating, partial: () => false, otherwise: () => false });
  async function submit() {
    if (blocked || send.inFlight || !draft.trim()) return;
    const submission = { id: mintId(), body: draft };
    setSubmitted(submission);
    setDraft("");
    await send.run({ conversationId, body: submission.body }, { id: submission.id, waitSeconds: 0 });
  }
  return <View>
    <Text>Conversation</Text>
    <Results conversationId={conversationId} />
    <TextInput accessibilityLabel="Message" value={draft} onChangeText={setDraft} />
    <Button title="Send" disabled={blocked || send.inFlight || !draft.trim()} onPress={() => void submit()} />
    {send.last?.state === "failed" && submitted?.id === send.last.id && <View>
      <Text>{send.last.why.message}: {submitted.body}</Text>
      <Button title="Edit" onPress={() => { setDraft(current => current ? current + " " + submitted.body : submitted.body); setSubmitted(null); }} />
      <Button title="Dismiss" onPress={() => setSubmitted(null)} />
    </View>}
  </View>;
}
function Results({ conversationId }: { conversationId: string }) {
  const page = usePage(api.thread, { conversationId });
  return <ScrollView>
    {page.items.map(row => <Text key={row.id}>{row.body ?? "Photo"}</Text>)}
    <ReadNotice status={readPresentation(page.read)} />
    {page.hasMore && <Button title="More messages" onPress={page.loadMore} />}
  </ScrollView>;
}
function ReadNotice({ status }: { status: ReadPresentation }) {
  return <View accessibilityLiveRegion="polite">
    {status.pending && <Text>Loading…</Text>}
    {status.why && <Text>{status.why.message}</Text>}
    {status.existence === "absent" && <Text>No messages in the available snapshot</Text>}
    {status.incomplete && <Text>Results may be incomplete</Text>}
    {status.stale && <Text>As of {status.since === undefined ? "the last available answer" : new Date(status.since).toISOString()}</Text>}
    {status.revalidating && <Text>Updating…</Text>}
  </View>;
}
```

Submission clears the draft synchronously, before admission can wait. Keep the
submitted text with its write ID; identical text typed later is a new draft.
The latest submission's refusal offers Edit/Dismiss without replacing that draft.
Persist intents per account/backend for recovery after reload (see the composer
in `guide client`).

The notice labels are application choices. A continuation can coexist with rows
and “More messages”; `incomplete` does not mean loading or denial. Pending row
badges and queued intents use their existing APIs. Send follows the membership
rule in `guide offline-interactions`: deny only on refusal or fresh,
non-revalidating proven absence; the server still authorizes the mutation.
The shell saves no result, cursor, profile, membership or asset. Expiry, scope
loss and account/store/program/credential changes keep the SDK's exact fences.

### Bounded route-owned observations

The social starter ships a second, small screen in `src/BoundedConversation.tsx`
and its `src/PageLifetime.ts` owner marker. `snapback4 guide social` prints both
complete files. It uses existing observations and hooks; there is no `active`
observation option or inactive server `Read` arm. Mount the read-owning child
only while the route is foreground and focused. The executable example follows
the ordinary lifetime and cursor rules.

In the social starter's PinnedConversation, use
`import { BoundedConversation } from "../../src/BoundedConversation"`
and replace ConversationScreen with
`<BoundedConversation backend={url} conversation={conversation} active={focused && foreground} />`.
This uses that route's existing visibility listeners and generated schema.

The composer shell is keyed by backend, account, query arguments and client
instance. It owns submitted text and recovery while hidden: a refusal restores
text into an empty draft or offers Edit without replacing newer input.
Inside it, `LiveConversation` owns membership and the root history observation.
Unmounting that child closes its observations and every requested page/point
owner. The draft stays mounted. An account change while hidden still resets it.
The SDK still owns admitted writes; closing a route does not cancel custody.

The marker subscribes to the same default root watch as `usePage`. It saves only
`{epoch, ready}`, never a row or cursor. Every ready-to-unavailable transition
increments the epoch synchronously, even when React batches the withdrawal and
its replacement. Generation, credential and store resets therefore replace the
page/identity owner; they do not depend on a public generation number or a timer.
A generation reset keeps the draft but clears the requested page depth, window,
selected media IDs and point owners. Account/backend/argument changes also clear
the draft. Ordinary retaining revalidation does neither.

The working screen requests at most three 20-row pages and displays at most 20
identity slots at a time. Previous/Next rows moves that window. It derives IDs
from current `page.items` on each render, with no union of previously seen IDs.
Every slot gets its protected body from its own `messagePhoto` live read.
“Message unavailable” says nothing about existence; denied/loading/partial-empty
points show no protected text or media action. A removed ID releases its point
reader. `usePage` alone owns current cursors and replaces changed suffixes;
root withdrawal also resets the requested depth. These limits are application
choices, not larger engine allowances.

The optional photo viewer lives above the window, stores only the selected IDs,
and rechecks the row with `keep: false` before opening media. No cached body,
ordinal, asset metadata or placeholder authorizes an asset. For full send
recovery/receipts use the starter's existing journal and independent receipt
recipe; this small alternative demonstrates observation ownership.

The default policy closes at the last owner. `keep: true` still explicitly
requests 30-second live linger and costs background observations; this recipe
uses no linger. Removing one route leaves a same-key active sibling subscribed.
Use `inspect(client).totals` and query groups to measure both observations and
subscribers: the epoch marker adds a root subscriber, not another query watch.

### Assets

`client.upload` retries only an `E_RATE_LIMIT` refusal with `retryable: true`:
at most four attempts, with 250 ms, 500 ms and 1 s backoff. A `Retry-After`
delay (seconds or an HTTP date) is a minimum wait. Total retry waits are
limited to 10 s; a longer requested wait returns the refusal immediately
without retrying early. Other refusals and transport failures are returned
without retrying: a lost reply may follow a stored upload.
Buffer inputs, including buffers from another window, are snapshotted before
the first attempt. Only a view's selected byte range is sent. The owned copy
is sent directly on web and React Native. Closing or signing out refuses an
in-flight result. A changed bearer or a refresh still in
progress returns `E_AUTH` with a request to start the upload again. A completed
failed refresh that kept the same bearer preserves the upload result and
admission retries. An upload never returns an old session's success or replays
its bytes under the replacement bearer. The local client attempts receipt
removal before returning a session refusal. If storage refuses that cleanup,
`upload()` still returns `{ ok: false, why }` with the session refusal, and
`close()` waits for the cleanup attempt to finish.

```ts
import { existence, type Client } from "snapback4/contract";
import { api } from "../snapback/generated/api";
async function sendPhoto(client: Client, conversationId: string, file: Blob) {
  const uploaded = await client.upload(file); // also accepts ArrayBuffer | Uint8Array
  if (uploaded.ok) await client.mutate(api.sendPhoto, { conversationId, photo: { id: uploaded.asset.id } });
}
```

A `file` column takes a document. `upload(bytes, { file: {} })`
declares the File's own type and name (`{ file: { type, name } }` overrides);
the server checks the type against the bytes, so a spoofed or HTML upload is
`E_ASSET_TYPE`. A file downloads only as an attachment; `saveAsset` fetches it
on demand and saves it under its name (`useSaveAsset()` in React), and
`client.asset(id)` / `useAsset(id)` also report `name`:

```tsx
import type { Client } from "snapback4/contract";
import { saveAsset } from "snapback4/client";
import { useSaveAsset } from "snapback4/react";
import { api } from "../snapback/generated/api";
async function addReceipt(client: Client, picked: File) {
  const uploaded = await client.upload(picked, { file: {} }); // or { file: { type: "application/pdf", name: "receipt.pdf" } }
  if (!uploaded.ok) return uploaded.why.message;               // E_ASSET_TYPE: not a type the column accepts
  await client.mutate(api.addReceipt, { scan: { id: uploaded.asset.id } });
  return `${uploaded.asset.name} (${uploaded.asset.bytes} bytes)`;
}
async function downloadReceipt(client: Client, id: string) {
  const saved = await saveAsset(client, id); // the browser saves it under the file's name
  return saved.ok ? saved.name : saved.why.message;
}
function ReceiptLink({ scan }: { scan: { id: string; name?: string | null } }) {
  const { save, saving, why } = useSaveAsset();
  return <button disabled={saving} title={why?.message} onClick={() => void save(scan.id)}>{scan.name ?? "Receipt"}</button>;
}
```

An app with a device can retain ordinary viewed images and videos:

```ts
import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { webDevice } from "snapback4/web";
const app = createApp({
  url: "http://127.0.0.1:4400", device: webDevice(), sessionStore: localStorageSessionStore(),
  assets: { keep: "viewed", maxBytes: 64 * 1024 * 1024 },
});
await app.ready;
if (app.auth.state === "signed-out") await app.auth.guest();
```

`keep: "none"` is the default and purges previously retained media on open.
`keep: "viewed"` retains successfully fetched ordinary assets, evicting the
least recently used to stay within `maxBytes` of payload bytes (a nonnegative
safe integer; zero retains no bytes). Storage belongs
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

For one-view photos, own the handle above the list: `snapback4 guide client`'s viewer recipe.
Every hook loading result includes `waiting: { stage, since, diagnosticAt,
received?, total?, progress?, why?, interrupted? }`. `AssetState.waiting` is optional for compatibility
with older `{ status: "loading" }` literals; consumers use `asset.waiting?.stage`.
The stage names scheduling, session-store checks, media reconciliation, refresh,
queue, response headers/body, retry backoff, retention or display conversion.
Custom client methods report `client` rather than guessing their internals.
Stage changes or received bytes set `since` to the latest progress time, extend
`diagnosticAt` and clear an old diagnostic, except for backoff as described below. Streams expose `received` bytes and
`total` when Content-Length is known. Streaming bodies diagnose at 4,999 ms
without bytes, one millisecond before the unchanged five-second abort; other
stages use five seconds. The timer order does not require separate React commits:
on entering backoff, the hook captures any overdue preceding stage in
`waiting.interrupted`, including its `stage`, `since`, `diagnosticAt`, known byte
progress and `why`. `waiting.stage` names `backoff` and `waiting.why` carries that
explanation until backoff adds its own five-second notice. Capture uses the
clock even if the diagnostic callback has not fired, so busy-thread batching
cannot erase the explanation. The next attempt clears both notices and the
snapshot; terminal outcomes replace loading. Opaque headers/body waits set
`progress: "unknown"` and add `waiting.why` with code `E_ASSET_WAIT` after
fifteen seconds without a stage change, independently of their full buffered
transfer allowance. Fifteen seconds allows the measured healthy six-second
transfers to finish but bounds the unexplained wait; the message says progress
is unknown, rather than claiming the network stalled. Render that explanation; it is a
diagnostic, not a refusal of the asset or permission to fetch again. A healthy
long transfer may still finish. Recovery never bypasses a held session check
or consumes a second once view merely because this diagnostic appeared.
Timers and late outcomes belong to the hook's selection and are released on
unmount/account/id changes. JavaScript must be runnable for a timer to fire.

Expo may expose response streams alongside React Native's Blob, which rejects
buffer parts. The SDK probes Blob construction and uses the host's
`Response.blob()` when needed; this native body has the buffered size allowance.
A local assembly failure is `E_CLIENT`, never evidence of an offline link.
For Expo's public `blob()` path, the SDK observes completion of its
`arrayBuffer()` read through a separate receiver, without attaching properties
to the response or changing its prototype. Sealed/frozen Expo responses work;
buffer-capable browser hosts keep their native body-method receiver. A reset during the read stays transport;
a subsequent native conversion or constructor refusal is `E_CLIENT` with no
transport retry. Custom native media stores must supply `uri`, as Expo does;
the cache's byte-array Blob fallback is for browser hosts.
URI construction and authorization headers are shared across Debug/Release;
no acquired-partition gate precedes an online asset GET. The local client first
reconciles media authority and waits for an active credential refresh.

Passing `null` or `undefined` to `useAsset` returns `{ status: "empty" }`
without fetching. Transport and blob-URL failures return `status: "error"`
with `why.code` and `why.message`; authorization, revocation and consumed views
return `status: "denied"`. Display both explanations. Safe downloads make up to
four attempts with exponential backoff, jitter and Retry-After, and ten seconds
of backoff. After headers, a stream stalls after five seconds without bytes;
empty chunks do not count. Progressing streams have no total-duration deadline.
A buffered body allows one minute plus Content-Length at 32 KiB/s; unknown size
uses the server's 64 MiB maximum (35 min 8 s). Before fetch resolves, headers can
be hidden by buffering, so that same unknown-size allowance applies, including
to a host that never returns headers. Queue/backoff has a separate thirty-second
budget renewed only by bytes, excluding transfer time. Refusal bodies keep their
five-second bound. Retry-After survives stalled error bodies and credential rotation. Each client
admits six transfers. SDK wait deadlines and post-body storage/display failures
report E_CLIENT and do not mark the device offline. Ordinary construction
failures can recover on a later event; ambiguous once failures cannot. A queue
budget expiring during Retry-After preserves that refusal and minimum.
Completed bytes survive same-principal bearer rotation without another fetch;
local downloads starting during refresh wait for the new bearer. A full-file Range request makes ordinary retries non-consuming; a once asset refuses Range before its one
non-range transfer. An ambiguous once response is never automatically retried.
The hook retries safe errors on reconnect/refocus/visibility return, never ready
handles or terminal refusals. An early recovery event schedules one retry after
Retry-After (or after the in-flight outcome); unmount cancels it. It does not loop. Raw `client.asset` returns `{ denied }` after the
bound; call it again when connectivity returns. `assetSource` uses host fetching.
For sender avatars inside DM/group messages, `snapback4 guide media` shows the
complete `profileById(message.sender)` → `useAsset(profile.avatar.id)` recipe,
including profile loading and asset refusals. The profile remains the asset's
home; a conversation reference is no extra grant. Ordinary avatars may mount
independently in bubbles and feeds. A changed id or client hides the old handle
immediately; account switches replace the client. Raw sign-out returns `denied`
with `E_AUTH` for a non-null id; null remains empty. Viewer discovery alone
does not fetch again, nor does an offline link refetch a ready handle.

An `image <=N`, `video <=N` or `file <=N` column holds an upload (a file,
its type and filename are described above); the client sends
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

#### Seed accounts headlessly (Node)

`signup` and `login` below work in Node 24 with the same server password hashing,
rate limits and application rules as browser sign-in. Run `snapback4 guide auth`
for a runnable `seed.mjs`: declare `use identity password`, run `snapback4 check`,
then import `signup`/`login` from `snapback4/auth` and `createClient` from
`snapback4/client`. Signup returns the new account **and its live session**;
pass it to `createClient({ url, session: result.session })`, then use the generated
`api` for authorized writes. Open one client per user and call `signOut()` in
`finally` to close it and clear local credentials (remote logout is best effort).
Node 24 can import `./snapback/generated/api.ts` directly from an `.mjs` script.

The social starter (`snapback4 new <dir> --template social`) includes
`scripts/seed.mjs`. Set `SEED_PASSWORD` privately, choose `SEED_USERS=N`, and
run `node scripts/seed.mjs`; it creates N accounts and writes each one's profile.
`SEED_AUTH=login` reuses an existing set; duplicate signup refuses. Stop on
refusal, including `E_RATE_LIMIT`, rather than blindly retrying or assuming an
account exists. Keep passwords and bearer sessions out of logs; use HTTPS off
loopback. Ordinary SDK auth works in `dev` and `serve`; only development personas
and system-principal `/seed` bypass account signup. Neither creates a password
credential, and there is no `snapback4 auth create` command.

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
choose another handle. Use `useAuth().state` for the signed-in session and a
profile `useQuery` for onboarding: null means onboarding, denied means an error,
and initial loading means still undecided. Once ready, the mounted same-key
profile keeps its answer through plain revalidation. Render the current read;
no latched identity or route is needed to survive a slow refetch.

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
import { existence, type Client } from "snapback4/contract";
import { api } from "../snapback/generated/api";
const url = "http://127.0.0.1:4400";

async function profileScreen(client: Client) {
  const profile = await client.query(api.myProfile, {});
  const state = existence(profile);
  if (state === "partial") return "partial"; // show a retry action; this answer will not update
  if (state === "denied") return "error";
  return state === "absent" ? "profile" : "app";
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

### Workers and services (`snapback4/worker`)

Declare each worker as `snapback/workers/<service>.mjs` (or `.mts` or `.ts`).
Both dev and serve supervise it with an injected `service:<service>` token,
name-prefixed redacted logs, bounded restart backoff and shutdown with the host.
Each worker has a process group; its watchdog kills remaining group members on
worker exit or server death, including SIGKILL. Watchdogs retain store ownership
through group cleanup; Node processes never inherit that descriptor. Restarting
dev or serve waits up to five seconds for ownership, then reports E_STORE_BUSY
if it remains held. Leave the ownership sidecar in place. Failed token retirement keeps
the worker stopped until revocation commits, even after its declaration is removed.
A failed deletion fences the retired revision on dev and serve; peers renew
under the new revision. Ordinary queries and effect claims refuse old credentials.
Watchdog death makes the host kill its Node group before replacement; catchable
watchdog signals initiate bounded group cleanup. Failed new-declaration startup
retries after repair without another source edit.
The supervisor owns token rotation for both named and conventional workers.
`/auth/refresh` returns HTTP 403 `E_WORKER_REFRESH` for these families and leaves
the injected bearer live; keep using it. Manually minted seats remain refreshable,
including seats with the same service name.
#### Worker files, modules and runtime paths

`SNAPBACK_PROJECT_DIR` is the absolute project root for dev and the active
release root for serve. It equals the child's initial `process.cwd()` and
stays fixed even if the worker changes cwd. Relative filesystem paths use cwd;
`import.meta.url`, `import.meta.dirname` and relative imports refer to the
launch's private source tree. That tree is removed after the process group stops.
Write application output under `data/` at the project root. For example:

```js
import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
const dataDir = join(process.env.SNAPBACK_PROJECT_DIR, "data");
await mkdir(dataDir, { recursive: true });
export async function recordPush(payload, meta) {
  await appendFile(join(dataDir, "push-log.jsonl"), JSON.stringify({ id: meta.idempotencyKey, payload }) + "\n");
  return { logged: true };
}
```

This acceptance handler records locally; it does not deliver to a provider or
promise exactly-once appends. A serve release's `data/` is release-local: to keep
logs across releases, supply an absolute durable directory through a declared
secret and select that secret in the worker directive. Arbitrary environment
variables, `.env` files and `NODE_OPTIONS` are not automatically forwarded/loaded.
Standalone Node workers must supply their own project path, URL and token.

| Entry | Source copied for execution | Where project helpers belong |
| --- | --- | --- |
| Named worker, dev or serve | Every regular file under `snapback/workers/`, not an import graph | Subdirectories of that tree; relative imports with extensions |
| Conventional dev server/worker | All of `snapback/`, including generated files, plus present project files tracked by the server TypeScript checker | That tree, or checker-tracked project imports |
| Explicit `serve --worker <path>` | None; operator-selected entry runs in place | Entry's ordinary Node module tree |

Named workers cannot rely on sibling `src/` or generated modules being copied.
Do not import original application source via cwd to bypass the snapshot. Source
symlinks and non-regular files refuse launch/restart; manifests also use regular,
no-follow copies. Original source replacement cannot change a running copy.
`deploy` packages only the named-worker source subtree, never dependencies.
Install dependencies on the deployment host. Node resolves helper/worker-local
`node_modules`, then schema-local packages, then project and ancestor packages.
For numbered releases, schema-local lookup uses the nearest ancestor containing
`snapback/node_modules`. Symlinked dependency directories and packages work;
they remain live host-owned code outside snapshot validation. Global temporary
parents add no lookup locations. This is trusted Node, **not a filesystem/network
sandbox**; only source bytes, selected environment and process lifetime are isolated.
Doctor reports source-blocked, revocation-blocked and ledger-unavailable states.
Startup retires prior credentials and clears their old status reports.

Named workers start with no declared secrets. A source line such as
`// snapback4 secrets: PUSH_API_KEY` opts into named schema-declared secrets.
The conventional generated runtime retains the full registry's secret set;
service credentials remain trusted and are not per-effect ACLs.

`ledger: true` uses `SNAPBACK_WORKER_LEDGER`, a durable SQLite file beside the
opened backend store, shared by its supervised workers and retained across
releases. The store's identity namespaces the file; fresh temporary stores and
replacement stores cannot replay another store's completions.
Completion commits before acknowledgement; redelivery replays the JSON result.
`meta.idempotencyKey` equals `meta.id`, stable across attempts and restarts.
A crash or unrecoverable storage/result-encoding failure after the external call
but before the ledger commit can still repeat it: pass that key to providers that accept idempotency keys. Delivery remains
at least once. Handlers sharing the file serialize, including across processes.
A busy commit retains the transaction and retries only that commit, including
after cancellation following provider success; a reader can delay completion.
One hung provider stalls every handler sharing that file; give provider calls
a timeout (for fetch, `signal: AbortSignal.timeout(30_000)`).
Keep this file in backups and do not prune completions while effects may replay.
Different disks do not share this protection. The ledger is for low-level effects;
actions and generated `ctx.step` keep their existing contracts.
Storage is validated before any claim. An initialization error stops polling
without spending attempts. Supervised children exit and doctor records
ledger-unavailable during bounded retries; repair storage to resume. Standalone
`done` resolves so its owner can repair and restart.
Later ledger storage failures close it and stop polling without a failed-effect
settlement; unacknowledged claims can expire under their ordinary leases.
Standalone workers still take explicit url/token; opt in with
`ledger: "/durable/path/effects.sqlite"` or omit the option.

```ts
import { runWorker, mintSession, revokeSessions, listEffects, GiveUp } from "snapback4/worker";
const url = process.env.SNAPBACK_URL!, token = process.env.SNAPBACK_SERVICE_TOKEN!;
runWorker({ url, token, ledger: true, effects: { notify: async (payload, meta) => {
  const sent = await fetch("https://push.example.com/send", { method: "POST", headers: { "idempotency-key": meta.idempotencyKey }, body: JSON.stringify(payload) });
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
`TMPDIR`, `LANG`, `LC_ALL`, `TZ`, `SNAPBACK_URL`, every secret
name declared anywhere in the schema, and a per-child
`SNAPBACK_SERVICE_TOKEN`, `SNAPBACK_PROJECT_DIR`, `SNAPBACK_WORKER_LEDGER` and the internal supervision
marker. Parent `NODE_OPTIONS` is not copied. Generated server handlers get a frozen
per-handler subset through `ctx.secrets`; the Node application remains trusted
and can inspect its process environment, as can a legacy worker. Automatically injected
service tokens are never printed, including the legacy development entry. Supervised stdout/stderr
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
use the conventional `snapback/worker.ts`, `.mts` or `.mjs` path. The invitation example below belongs in that worker:
it mints a session for `member:<email>` and returns only `{ principal }`.

### The mock (`snapback4/mock`)

One-shot queries use the same bounded settlement rules as `guide client`:
retired publications reread, genuine exhaustion is retryable `E_QUERY_RETRY`,
and closed/signed-out clients refuse. Only unavailable offline reads use
`E_OFFLINE`. Mock query handlers return values or pages, not `Read` envelopes;
the mock has no Quarry acquisition or server fallback. Pending predictions can
make an empty ready answer partial; they do not prove the link is offline.

`createMockClient({ viewer, tables, ops })` is a client with the same
card over in-memory tables, for component tests: `ops` is `{ queries:
{ name: (tables, args, viewer) => value | page(rows, next) }, mutations:
{ "table.verb": (tables, args, viewer, mint) => ids | Refusal } }` — a
mutation named `t.verb` marks the rows of table `t` pending until
`settle()` commits it (`commitDelayMs` and an initial `link` are options);
`setLink("offline")` flips the link; `upload` accepts anything as a 1×1
PNG and `asset` is always denied. For ephemeral fixtures, set
`ephemeral: { typing: 4000 }` on the mock options and provide `ops.signals` handlers.
They receive the same tables/args/viewer/mint arguments and return the operation's
result or a Refusal. Use `Map.set` for an insert or renewal, including an empty
patch, and `Map.delete` for a deletion. Each configured table expires rows at its
own life, in memory only; refused handlers roll back. The same ordered sender
coalesces proven renewals. Signals never settle as durable writes. With the
legacy `table.verb` convention and no metadata, one table's life is inferred as
four times the generated `renewMs`; multiple table lives need explicit metadata.

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
  [--clock-offset +25h|--resume-clock]`** serves `snapback/*.q` on `127.0.0.1:4400`, recompiling and re-adopting on every
  save (the watcher polls every 400 ms; a save with problems keeps the previous generation serving and prints
  the diagnostics; `--no-watch` never re-adopts, says so at startup, and names a changed `snapback/` when a
  request reaches an operation or argument the running schema lacks; restart to serve the edit); the store lives in `.snapback4/store.sqlite` and persists across runs, and `--fresh`
  (alias `--memory`) starts an empty private temporary WAL store, removed on orderly exit. Each launch
  starts from nothing; an unclean exit can leave its private temporary directory for OS cleanup.
  During schema adoption, query and sync snapshot reads use the previous committed backend;
  newly introduced queries answer pending until their views are complete. Queued mutations have
  separate bounded admission, preserving query and sync capacity. Signed-in `GET /changes` waits
  for the entire adoption to record its durable presence reconnect. This wait grows with the store;
  adoption does not yet yield bounded writer chunks. A reconnect is never acknowledged only in memory.
  The stderr banner prints `store: temporary — discarded on exit` for either flag, or `store: <SQLite
  path>` for persistent dev. For dev and serve, readiness is the first stdout line: the listening URL, emitted
  after store and native-module setup. Wait for that line before requests; lifecycle logs use stderr, so
  read stdout alone for it. A script that reads both streams through one handler matches the tagged
  stderr line `SNAPBACK4_READY verb=dev generation=1 url=http://127.0.0.1:4400 pid=1234 wrapperPid=1230`
  instead (`wrapperPid` only through the npm wrapper). The stderr banner names the server's process
  (`snapback4 dev: http://127.0.0.1:4400  pid 1234 …`), and `GET /dev/status` answers the same `pid`, plus
  `wrapperPid` when the `snapback4` npm wrapper (`node_modules/.bin/snapback4`, npx) launched it, so a
  script that spawned dev (perhaps through npx, npm and a shell) can prove the server it polls is its own.
  The wrapper forwards SIGINT, SIGTERM and SIGHUP; a SIGKILL to it stops the server as well, because the
  binary exits (with SIGTERM's cleanup) once the wrapper that launched it is gone. A port that is already taken refuses the start at once with
  `E_ADDRINUSE`, naming the holder (a running dev's pid and project) and suggesting `--port N`; `--port 0`
  picks a free port, and the first stdout line names it. A second dev on the same project's store refuses
  with `E_STORE_BUSY`, naming the owner's address and pid. For a
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
  `x-snapback-persona: alice` header (the client's `persona: "alice"`), acting as `dev:alice`; a name the
  declaration lacks is refused 401 `E_AUTH` naming it (a schema without `use personas` admits any name). For loopback
  identity requests, `dev` removes the per-peer and per-email minute counters and prints that fact and the
  host's Argon2 slot count once at startup: available cores, capped at 16, minimum 2. Connection/worker caps
  remain; `serve` keeps two Argon2 slots and the 30-per-peer and 10-per-email limits. `dev` and `serve` print
  the listening URL and one newline first on stdout; automatically injected worker
  tokens are never printed. Startup explanations, lifecycle messages and supervised worker logs go to
  stderr. Process exits carry a one-line stderr diagnostic with the verb, serving generation and reason:
  `SNAPBACK4_EXIT` for returned errors/stops, `SNAPBACK4_PANIC` for panics on any thread (including abort
  builds), `SNAPBACK4_SIGNAL` for signals, and `SNAPBACK4_THREAD_EXIT` if the watcher or maintenance thread
  stops. An unexpected background stop ends the server. Generation `0` means this process has not served yet.
  `SIGINT`, `SIGTERM` and `SIGHUP` report immediately; dev flushes its refusal writer and cleans up any
  application worker, then exits `128 + signal`. Serve cleans up a configured worker the same way.
  Otherwise, and for fatal signals such as `SIGBUS`, termination is immediate with the OS
  signal status. `SIGKILL`, power loss and an unwritable stderr cannot be reported from inside the process.
  `snapback4 why SNAPBACK4_SIGNAL` explains the code.
- **Scripts that spawn `dev`.** `resolveBinary()` from `snapback4/bin-path` (file: `dist/bin-path.js`) returns the binary the
  `snapback4` shim runs: `SNAPBACK4_BIN`, then the installed platform package, then a repository build.
  Spawning it directly puts no npm, shell or Node wrapper between the script and the server, so the child's
  PID is the server's and `kill()` stops it. Wait for the first stdout line (the listening URL), then
  stop the child in `finally`:

```ts
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { resolveBinary } from "snapback4/bin-path";
import { createClient } from "snapback4/client";
import { api } from "../snapback/generated/api";

const dev = spawn(resolveBinary(), ["dev", "--port", "0", "--fresh", "--no-watch"], { stdio: ["ignore", "pipe", "inherit"] });
const [url] = await once(createInterface({ input: dev.stdout }), "line") as [string];
const client = createClient({ url, persona: "alice" });
try {
  const me = await client.query(api.myProfile, {});
  if ("denied" in me) throw Error(me.denied.message);
} finally {
  await client.close();
  dev.kill("SIGTERM");
  if (dev.exitCode === null && dev.signalCode === null) await once(dev, "exit");
}
```
- **Development clock:** `snapback4 dev --clock-offset +25h` starts 25 hours ahead; `snapback4 clock advance
  185s [--port N]` advances a running dev and waits for expiry sweeps and queued jobs, so an `every 2m`
  schedule and a three-minute expiry need no real wait. Missed periods fire once; held schedules stay held.
  Each job chunk keeps its normal meter and commit. The JSON response names `now`, `advancedMs` and `work`
  counts, including parked jobs, and a `schedules` list: per schedule, whether it fired, the period it fired
  for (`periodStart`/`periodEnd`, plus `skippedPeriods` when the advance crossed several), its job run, or
  why it did not fire (next boundary, schedule times being UTC, or held by a store whose saved boundary is
  ahead of a restarted clock). A maintenance error leaves time advanced and pending work retries on the
  normal tick; do not blindly repeat the advance. Durations are positive whole numbers with `ms`, `s`, `m`,
  `h`, `d` or `w`, optionally prefixed `+`; the startup offset alone may be negative. Mutations at `POST
  /m/<op>` stamp `now` from this dev clock. The dev clock keeps ticking monotonically and cannot advance
  backwards. Its offset resets on process restart; supply it again, or start `dev --resume-clock` to continue
  from the store's newest commit stamp (or saved schedule boundary). Rows stamped under an
  offset keep their times after restart; use a fresh store per offset test.
  Devices keep the server's time for predictions, reads and expiry, including offline starts.
  `clock advance` and `--clock-offset` reach connected devices at their next response.
  Estimated server time is unfloored and schedules server-answer refetches; issued device
  time (`client.now()`) is monotonic and drives device execution, predictions, expiry and rendering.
  Freshness labels (`since` / `syncedAt`) stay on wall time for "as of three minutes ago".
  `serve` refuses every clock control with
  `E_CLOCK_DEV_ONLY`; invalid or backward advances refuse `E_CLOCK_INPUT`. Scripts may call the same
  loopback-only dev endpoint, `POST /dev/clock/advance` with `{"duration":"+2m"}`. `guide clock` has the
  recipe. `POST /dev/jobs/<job>` with `{"args":{..}}` queues one run of any job as the system on the dev clock,
  behind earlier queued runs, and answers its run (`state` `done` or `parked`) once it finishes; `serve` refuses
  it with `E_AUTH`.
- **Adoption health.** A refused dev adoption stays visible in `doctor` and its reason repeats on the first
  failing job or sweep. Writer-lock and generation failures retry without another save, including reopening
  after a CLI adoption. Identical background store and generation failures are then suppressed while that
  adoption failure is pending; recovery or a changed adoption failure reports the suppressed count and resets
  it. Changed reasons print at most twice per error code in each 60-second window; further changes count as
  suppressed too. `doctor` compares the live host generation with the store and uses the host's dev clock for
  deferred pushes. A `--no-watch` host needs a restart after another process adopts; a schema refusal needs a
  corrected save. A stopped host's deferred deadlines use wall time.
- **`POST /seed`** (dev only, same machine) takes a JSON array `[{ "table": "t", "row": { "id": "..", .. } }, ..]`,
  writes the rows as the system principal in one commit (rules bypassed; validation, constraints, aggregates and
  sync apply) and answers `{ "seeded": N }`; any other body shape is 400 `E_INPUT`, and a row the engine refuses
  answers 200 `{ "denied" }` with nothing written. Rows are written as inserts are: omitted columns take their
  `default` (`now` is the dev clock), sequence columns are assigned (supplying one refuses
  `E_SEQUENCE_SUPPLIED`), and the `$`-prefixed fields `snapback4 data` prints are recorded by the engine, so drop
  them. A principal field holds the stored principal (`"dev:alice"`); a bare `"alice"` refuses. Seed is an
  upsert by `id`, so every row names its own and rerunning a seed updates those rows' mutable columns instead
  of duplicating them; a different value for an `immutable` column refuses `E_CONSTRAINT` naming the column and
  the upsert (keep the original value, use a new id, `POST /dev/reset`, or restart `dev --memory`); a row without an id refuses
  `E_FIELD` with its index. Use
  26-character Crockford base32 ids (digits and capital letters except I, L, O, U), such as
  `0000000000000000000000SEED`; in JavaScript `idFrom("seed:alice")` from `snapback4/client` derives the same valid
  id from a label every time. For recorded-action replay that must not emit notifications, run
  `snapback4 dev --replay`: new effects are never delivered and schedules are held. `guide replay` explains
  the restart and explicit-job behaviour.
- **`POST /dev/reset`** (dev only, same machine; `serve` refuses it with `E_AUTH` as it refuses `/seed`) empties
  the running dev's store so each test starts fresh against one host. In one SQLite transaction it removes every
  application row, view and maintained column, index entry and count, the partition and commit logs, the effect,
  job and action queues, uploaded assets (their bytes are unlinked after the commit), and every account with its
  sessions (signed-up users, guests, custom sessions); it keeps the adopted schema and generation, personas and
  service seats (`snapback4 token` seats and the dev worker's session), and forgets schedule boundaries, so the
  next tick records the current boundary without firing a missed period. The store takes a new `storeId` and the
  reset is itself a commit, so the head keeps counting: every held `/changes` poll returns, a local device sees
  the new identity on its next sync, drops its partition and re-acquires (unsent writes and known receipts are
  kept, as for any store replacement), and an online client halts with `E_STORE_REPLACED` (`createApp` reopens
  it). The body is empty, a `/seed` array, or `{ "seed": [..], "clock": "reset" }` with either key optional:
  seed rows are checked and written exactly as `/seed` writes them, in the same transaction, so a malformed body
  is 400 and a refused row answers 200 `{ "denied" }` with nothing reset; `"clock": "reset"` returns the dev
  clock to wall time (dropping `--clock-offset` and every `clock advance`), and without it the clock is kept. It
  answers `{ "reset": true, "seeded": N, "generation", "storeId", "previousStoreId", "head", "assetsRemoved",
  "now", "clockOffsetMs", "ms" }`; on a small store it takes a few milliseconds. `snapback4 reset [--port N]
  [--seed <fixture dir|rows.json>] [--clock reset]` posts it from a shell (a fixture directory is read as `test
  --fixture` reads it). A reset empties the whole store, so tests that share one dev run one at a time.
- **`snapback4 run <op> ['<json args>'] [--as <persona|principal-id>] [--port N] [--now <milliseconds|+duration>]
  [--json]`** runs one operation against the local store, and says so on stderr (defaults to `dev:alice`; declared personas get the
  `dev:` prefix and other principal ids are used verbatim) and prints the result, the meter and, for a
  mutation, the partition events; a job runs whole as the system (`--as` is ignored) and prints its run.
  Before opening SQLite, it takes the store's lifetime lock: the sidecar file `<database>-owner` beside the
  store (never the database file itself, whose locks belong to SQLite). While a responsive `snapback4 dev`
  owns the store, `run` instead forwards over that host's loopback wire, on its dev clock and adopted schema:
  a query to `POST /q/<op>` and a mutation to `POST /m/<op>` with the `x-snapback-persona` header for the same
  principal, a job to `POST /dev/jobs/<job>`. It says so on stderr and prints the same shape (a forwarded
  mutation has no events or meter). `--now`, a non-persona principal, a `serve` host and a stopped host are not
  forwarded: those refuse `E_STORE_BUSY` with the store site, the server address and the equivalent `curl`
  command. Another CLI writer refuses the same way; stop it or the host, run once, then restart. A `dev
  --fresh`/`--memory` host owns no file, so a plain `run` beside it reads `.snapback4/store.sqlite`, not that
  host's temporary store; `run --port N` forwards to the dev on `127.0.0.1:N` whichever store it serves.
  `data`, `sql` and `test` always read the on-disk store; inspect a fresh dev over HTTP.
  `token` asks a live host to mint; `test` without a fixture, `deploy` and `rollback` refuse while it runs;
  HTTP `/seed` already runs through the dev host. Native devices (process clients and embedded C-ABI hosts) share compatible
  ownership with each other, but refuse a backend owner before initialization and exclude backend writers
  until their SQLite stores close. Exclusion holds while `<database>-owner` is left in place: deleting or
  replacing it while a process runs ends exclusion (that process keeps running), so leave it alone.
  `serve.lock` holds only an address hint; removing it never releases ownership. SQLite opens and retries use the acquired canonical database path.
  Read-only inspection and fixture tests remain available beside the server.
  `data` opens a read-only snapshot without writable store initialization. The native smoke driver's
  stopped-backend restart marker also takes the lifetime lock before advancing the commit clock.
  Without a competing lifetime owner, opening/adoption retries SQLite BUSY/LOCKED for up to 15 seconds,
  reporting the operation and elapsed wait. `E_RUN_BUSY` stops without admitting the operation; other store
  errors keep their meaning. The deadline bounds contention retries; it cannot cancel an atomic activation
  already running or limit job execution time. A completed activation can persist even when the operation
  remains unadmitted after a timeout or source edit. Source changes during the wait refuse
  `E_RUN_SOURCE_CHANGED` before admission; check the source and invoke the intended operation again.
  If an external SQLite writer outlasts the deadline,
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
  selected column), `limit`, `more`, `ruleFiltered: false`, and the same inspection header.
  `--json-objects` instead returns object rows with direct declared boolean columns as true/false
  (optional nulls stay null), including aliases, non-shadowing declaration-order CTEs and subqueries. Numeric SQL
  expressions remain numeric. Alias duplicate output names; unsupported projection syntax
  refuses with E_INPUT and suggests positional `--json`. For example:
  `snapback4 sql "SELECT conversationId, count(*) FROM messages GROUP BY conversationId"`.
  `snapback4 sql '\dt'` (alias `'.tables'`) lists application tables and maintained views;
  `snapback4 sql '\d messages'` (alias `'.schema messages'`) describes Quarry types,
  nullability, indexes and unique keys. Both show the active generation and stored row counts:
  exact through 10,000, otherwise a lower bound of 10,001; ephemeral counts are unavailable.
  Catalog JSON carries `generation`, `tables` (each with `name`, `kind`, `rows`, and
  description-only `columns`/`indexes`), `ruleFiltered: false` and the inspection header.
  `rows.count` is exact only when `rows.exact` is true; null means unavailable.
  Internal-name refusals point to these commands; SQLite metadata stays private.
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
  runs, the effects by state and the failed ones; **`guide [keyword]`** prints cards: cheatsheet, language, app, recipes, types, time, api, indexes, maintains, totals, offline-interactions, rules, sync, sharing, residency, prediction, evolution, deploy, expire, assets, client, wire, social, reads, shapes, writes, sequences, programs, jobs, native, feeds, search, effects, actions, routes, services, presence, receipts, read-only, manual-receipts, ephemeral, bounds, refusals, personas, testing, witness
  (`guide <E_CODE>` explains a code; `guide aliases` lists the words that open a card or one of its sections). A card over 130 lines prints its opening and a numbered section index (piped, also its first section);
  `--section <number or words>` prints one section (any case, a unique prefix or the heading's words; a
  word no heading names prints the section holding most of its mentions, or all of them when they spread),
  `--find <words>` prints the lines that mention them (`a|b` for either), and `--full` prints the whole card. Natural words
  resolve too: `offline` → prediction, `pagination` → reads, `migration` → deploy, `sql` → from-sql, `push` → effects, `clock` → time.
  An unknown word prints three nearest cards and the list on stdout, then exits 1. **`--version`** prints the
  binary's version, which equals the package's. Every flag may be spelled `--flag=value`.

### The wire

The client is the intended surface; the wire is plain JSON for anything else. The server card and compiled
metadata require a live principal. `GET /` is the server's card (`{ snapback4, generation, seq, ops: [{ name,
kind }], tables: [{ name, sync }] }`); `GET /api.ts` the generated TypeScript; `GET /schema` the compiled
backend; `GET /native.wasm` the native module when the backend has one. Authenticated `GET /probe` answers
HTTP 200 `{ ok: true, store_id, seq }`; clients require both the status and body before changing an offline
link back to online. The local client checks the identity and head before restoring freshness or resuming a
long poll.

Responses to `/sync`, buffered `/changes`, `/q/<op>`, `/m/<op>` and session endpoints carry
`X-Snapback-Time` (server Unix milliseconds) and `X-Snapback-Clock` (opaque clock epoch
and revision). Both are exposed to cross-origin clients. Refusals carry them too.
These headers are stamped after execution, any poll wait, and JSON serialization.
Streaming `/changes` instead stamps `serverNow` and `clockRevision` in its final
JSON after the hold. Its early heartbeat headers contain no clock sample, including
when a transport buffers the entire response.

For round trips of at most 1,000 ms, the client estimates
`serverNow - (sent + received) / 2`. Longer responses use the conservative receipt
date `serverNow - received` for both estimated server time and issued device time.
These samples are provisional, as are streaming final-body receipt stamps. Any
short measured sample outranks them. Within each class the smallest RTT wins,
with newest ties, among the latest 32 samples received within 60 seconds.
A server restart or deliberate clock advance begins a new window. Older revisions cannot
undo an advance. On a new epoch, requests already issued cannot switch the clock to another
epoch; a newly issued request can. Receipt dating may lag true server time by
transport latency, but never adds half a hold to the issued floor. The offset
starts at zero and persists beside store identity. Issued time remains monotonic
within a live clock. Each admission atomically commits its issued floor with its
outbox entry; that separate `server-clock-floor` record outlives settlement.
Orphan transfers and recovery writes raise the same floor in their outbox
transaction, including recovery after clock attachment.
Every outbox commit raises the live issued clock and reschedules its deadlines
before later admissions, including journal recovery deferred until backend adoption.
Restore commits available orphan outboxes and their floor before replaying its own
journal; if that save fails, restore fails and leaves the journal unadmitted.
Admissions already waiting behind recovery use at least
the recovered floor at device execution; synchronous journal capture still happens
before the first await.
Startup restores a floor only from this record and queued `entry.now` values.
Before replay, attachment transactionally backfills that record with the maximum
of itself and every queued legacy admission, so their retirement cannot erase it.
An old `last` in offset metadata is ignored: ordinary `now()` calls do not pin
time after reopening. Synchronous web journal capture remains unchanged.

Estimated server time is **unfloored** and schedules refetches of server answers, including
local fallbacks. Issued device time (`client.now()`) rounds to integer milliseconds and is
**monotonic**: local execution, predictions, expiry, asset homes and rendering use it.
Mixed reads retain a deadline from each clock and wake at the earlier delay. `since` and
`syncedAt` are **wall time**, independent of either server clock, for freshness labels.
Wall-time freshness is versioned (`syncedAt:wall:1`); ambiguous legacy `syncedAt` is
omitted until resync. Publication clamps future freshness stamps to `Date.now()` after
wall-clock rollback.
A confirmed row always carries the server's settlement time; the server never adopts a
submitted client clock.

`POST /q/<op>` with `{ "args": {..} }` answers `{ data, complete, cut, seq, next, nextExpiry,
tables, viewer }` or `{ denied }`; `nextExpiry` is the earliest future expiry the visible read encountered, or
null. `POST /m/<op>` with `{ "id", "args", "newIds" }` answers `{ state: "sent", id, seq, result }` on fresh
success, `{ state: "sent", id, seq, replayed: true }` on replay, or `{ state: "failed", id, why, current? }`
(a client-minted `id` makes the write apply at most once; the same `id` with another operation or other
arguments answers `failed` with `E_ID_REUSED`). A replay adds `replayed: true` and omits both
`result` and `current`; a fresh `E_CONFLICT` may carry the live row in `current`. A job is refused at
`/m/<job>` (`E_OP`); in dev, `POST /dev/jobs/<job>` runs one (§5). `POST /sync` takes JSON `{ from, limit, after, stream, pending, store_id? }` (defaults: `0`,
`2000`, `null`, `false`, `[]`, absent). With `from: 0` it returns the paged snapshot: `{ snapshot: true,
events: [{ table, kind, id, data }], watermark, more, next, generation, store_id, acknowledged, sent? }`. Continue
with `after: next`; `limit` is clamped to 1–10,000. `pending` holds at most 256 write IDs, each 1–128 UTF-8
bytes, and reports which queued writes the server applied. The request body is at most **262,144 bytes (256
KiB)**, including the cursor and JSON escaping; this accommodates all 256 maximum-length IDs even with
six-byte escapes. A larger body is HTTP 413 with `denied: E_INPUT`, including chunked bodies; malformed fields
are HTTP 400 with `E_INPUT`. With `from: W` or `stream: true` it returns the stream from a watermark: `{
snapshot: false, events: [{ seq, table, kind, id, data }], watermark, more, generation, store_id, acknowledged, sent?
}`. The optional `sent` map qualifies successful sequences in `acknowledged` and
`committed_above`; its absence requires same-id replay to establish an unknown
outcome. The optional `store_id` echoes the previous reply's database identity; a different identity invalidates
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
`denied`, including `E_AUTH` if the session ended while waiting. A held poll (N > 0) the host has no room
for is refused at once with retryable `E_STREAMS`: 503 with `Retry-After: 2` when the viewers' long-wait pool
is full, 429 with `Retry-After: 5` when the principal already holds its share (default 16). Wait Retry-After,
poll with N = 0 at that pace meanwhile, then hold again; the published client does exactly this and stays
online. Every reply of a query that may read `connected[p]`, refusals included,
carries `refresh: 5000`: presence changes without a commit, so the clients re-read that watch in the background
5 seconds after each reply settles, keeping the answer on screen until a newer one replaces it. `POST /assets` (the file's bytes as the body,
64 MiB at most) answers `{ asset }`; a document for a `file` column adds `?as=file&name=<filename>` and its
declared `Content-Type`, checked against the bytes, and is read only up to the largest file column's bound.
`GET /assets/<id>` serves them (404 hidden or gone, 410 viewed; `Range`
works on ordinary assets, returns 416 when unsatisfiable, and is refused on view-once assets; every response
uses `Cache-Control: private, no-store`; a file is always `Content-Disposition: attachment` with
`nosniff` and a sandboxing `Content-Security-Policy`). `POST /auth/guest` (`{}`), `POST /auth/signup` and `/auth/login` (`{
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
`x-snapback-persona` (dev, same machine, `[A-Za-z0-9_-]+`, a name `use personas` declares) or
`Authorization: Bearer <token>`; send one, since both together refuse `E_AUTH`. Status
codes come from two layers. Failed login and disabled identity methods return HTTP 401
with the same `denied` body the JS auth helpers preserve. Production dev doors return 403;
`guide wire` has the status table. Before anything runs, the request is decoded against the operation's
signature: a body that is not JSON, an argument of the wrong JSON type or shape (a fraction, a string for an
`int`) or an argument the operation does not take is 400 `{ denied: E_INPUT }`, and a query route for a
mutation is 400 `E_OP`; 401 with no or a dead credential or an undeclared persona, 404 `E_OP` for an unknown
operation or route, 413 past the body ceiling (1 MiB for JSON, 16 MiB for `/seed` and `/dev/reset`). Everything the decoded
operation refuses is 200 — a query's `{ denied }`, a mutation's `{ state: "failed", why }` — including value
checks made while it runs (a missing required argument or text past its bound is `why.code` `E_INPUT`),
rules, constraints, `NOT_FOUND`, the program's own `require … else CODE` (with `why.rule` and `why.site`) and
a reused write id (`E_ID_REUSED`; `E_WRITE_ID_REUSE` is the JS client's local refusal before sending); 503 when
it is retryable. A response over 16 MiB is refused `E_BOUND`. `OPTIONS *` answers CORS for
`content-type`, `x-snapback-persona`, `authorization` and `range`. The
server sweeps expiry and fires schedules once a second, runs queued job
chunks each tick, and sweeps unplaced assets once a minute.

## 6. Release

An `E_RULE` caller response keeps its cause ambiguous to avoid probing hidden
rows. In `snapback4 dev`, the stderr line and `snapback4 why recent` identify
the evaluated refusing clause and its schema source site when available. Each live dev instance
keeps up to 32 records under the owner-only local
`.snapback4/dev-refusals/<storeId>/<instance>.json`. Output identifies the store,
instance, PID and address. When several dev instances run in this project,
select `why recent --instance ID` (optionally `--store ID`); stopped or
mismatched records are rejected. Logging and persistence run asynchronously:
records may lag, and a stalled writer drops excess records from its 32-slot
queue (`dropped` reports this when it resumes). No HTTP response exposes them,
and production `serve` does not collect them. The stream covers refusals of
mutations, queries, asset requests and jobs: every refusal envelope (including
E_ASSET_UNKNOWN) and parked job records its operation, code, request or job ID,
and Unix time in milliseconds. Missing instrumentation and replays say
`cause not instrumented`. Jobs share the request stream's sequence and watermark.
Query sites belong to their reader's generation; capture exhaustion points to
`read through`, even before an insert rule runs.
Visibility filtering in sync and reads is not recorded: inspect `snapback4 why TABLE`
for read rules and sync residency, and `snapback4 guide rules`. Empty/null query
answers are silent and unrecorded by default. Only top-level null or [] is
empty; nested empty fields in composed results are present. Opt in with `snapback4 dev --trace-empty` to
record local EMPTY_READ evidence in `why recent`, still without console notices.
A proven storage-probe miss carries `cause: no-candidate` and its site; otherwise
`cause: unrecorded` says no probe miss and no rule cause were recorded.
Neither is proof about another viewer or a device. Rule-filtered answers are never recorded.
`snapback4 why EMPTY_READ` (also `snapback4 guide EMPTY_READ`) gives exact commands
to inspect the read rule, sync coverage and horizon; an empty answer does not
prove denial. The stream identifies this opt-in with `traceEmpty: true`. Each record describes only its named request
or job at that time, never the outcome of a later sync or read. `why recent`
rejects a snapshot while its latest refusal is pending or dropped, until the
writer catches up or you reproduce it. Empty successes do not advance that
watermark or replace the last refusal unless tracing was requested.
Tracing shares the same 32-record stream and queue with real refusals. Use one
quiet reproduction and inspect promptly: polling empties can evict older
refusals, and a dropped latest record makes `why recent` refuse the snapshot
until a newer record is saved. Restart without `--trace-empty` when finished.

Each remaining dev refusal console line combines identical operation, code and
cause (table, clause, phase, source/execution site and generation) for a fixed
one-second window beginning when the writer receives the first record. It prints
once at the window's end with `count N` and the first request/job identity and
time. Repeats do not extend the window; idle windows still flush. The console
holds at most 32 distinct groups and prints the oldest early on overflow. Counts
cover accepted writer records; dropped evidence remains reported separately.
Individual `why recent` records and its 32-record limit are unchanged. Save
errors also use counted console windows. By default a line is short (operation,
code, source site, clause and table, a hidden lookup's read rule, `×N`);
`dev --verbose` prints the full line with phase, generation, execution site,
store, instance and the first request/job identity and time. Normal dev shutdown (`SIGINT`, `SIGTERM`, `SIGHUP`)
drains accepted records and flushes these windows even with held polls and no
application worker. It waits up to two seconds for acknowledgement. A stalled
writer or abrupt termination can still lose queued records and unprinted
windows; requests completing after shutdown starts are not covered.

Start with `snapback4 guide deploy` for package upgrades (including the Expo adapter),
password identity, the first admin and migration recipes. check warns on stderr
(including with --json) when installed core/Expo versions differ. Stop the owned serve process,
wait for exit, deploy, then restart serve; live activation currently refuses E_STORE_BUSY.

`snapback4 dev` is development only — it admits loopback personas and an unauthenticated `/seed`; deploy with `snapback4 deploy` + `snapback4 serve`, which refuse both.

- **`snapback4 deploy <dir> [--allow-destructive]`** (from inside the
  project) compiles it, classifies the change against the current release
  (additive, a rule change, narrowing, destructive) and refuses a
  destructive one without the flag, writes the release under
  `<dir>/releases/N`, installs the schema into the directory's one store,
  points `current` at it (the store's own release pointer is
  authoritative; `current` is a text file containing the release number, not a symlink) and appends `releases.jsonl`. Every
  device re-derives its partition on the next sync; a write queued under
  the old schema that no longer fits is refused, typed.
- **`snapback4 rollback <dir> [--allow-destructive]`** moves `current`
  back, classifying the change the same way. It adopts earlier source into current data;
  it does not restore deleted data, and --allow-destructive cannot bypass E_ADOPT.
- **`snapback4 serve <dir> [--port N|A-B] [--bind H]`** runs the current
  release on the shared store on `127.0.0.1:4400`, tokens only (a persona
  is refused HTTP 401 `E_AUTH`; `/seed` is HTTP 403). Port 0 chooses a free port;
  an inclusive A-B range chooses its first free one, and invalid input refuses E_INPUT.
  Stdout prints the real listening URL; stderr includes SNAPBACK4_READY. A non-loopback literal bind requires
  `--i-understand-cleartext` and prints a warning because the socket is HTTP.
  Put a TLS proxy on the same host in front of the loopback listener: preserve
  `Authorization` and `Origin`, strip `x-snapback-persona`, restrict direct
  backend access, and rate-limit by the real client address. The binary does
  not trust forwarded address or scheme headers. It symlinks the release's
  store to the directory's, so the filesystem must support symlinks.
  `--long-waits N`, `--long-waits-per-principal N` and `--claim-waits N`
  size the held-wait pools (defaults 1,024, 16 and 32); a full bound refuses
  retryable `E_STREAMS`. Bounds, refusals and the measured cost are in
  SERVER.md, "Long-wait capacity". Set the proxy's idle timeout above the
  2-second poll heartbeat and its connection limit above the derived cap.

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

The copy includes the database and any SQLite sidecars, the supervised completion ledger when enabled, `assets/`, immutable `releases/` (including any packaged native module), `current`, and `releases.jsonl`. Authentication, deduplication, job and effect records live in that database. Keep the backup itself unserved. Serving repairs the selected release's generated database symlink to the restored deployment; unexpected regular files at that link path refuse startup.

Use the printed isolated URL with a fresh device store and fresh outbox. Check current reads, backed-up identity access and an asset download. Do not attach a device store or pending outbox from the former server. Keep external effect workers disconnected from the restored endpoint. Serving automatically starts declared effect workers and resumes built-in jobs and schedules: they can call providers, change the restored data or enqueue effects, so account for them when interpreting the recovered state. The automated exercise uses an actual parked job and a controlled schedule boundary to keep those records stable.

The release-activation test executes this `cp -a` sequence after owned processes exit, verifies sessions, deduplication, queued effects, a parked job, release/program identity and asset bytes, and reads the restored data through a fresh process device. The original remains present with post-backup writes, proving the restored server is independent. It also verifies a permitted schema widening, a refused destructive candidate, and rollback after a new restored write. Rollback selects earlier source; it does not rewind rows.

Production continuation needs an application-specific plan for old device watermarks and pending writes, identity/revocation changes since backup, unfinished or repeated jobs, and external effects that may already have happened. Restored operation IDs only prove deduplication represented in the backup; post-backup IDs and effect settlements may be missing. Reconcile those outcomes before reconnecting production clients or workers. External worker code, credentials and service configuration outside the deployment need separate recovery arrangements. SQLite uses WAL with `synchronous=FULL`, including background commits that publish
watermarks. This stopped-process exercise does not establish physical-power-loss durability.

Server query readers use independent connections and a new snapshot per read.
Each SQLite connection currently has a suggested 2,000 KiB page-cache limit;
this is neither reserved memory nor a process RSS bound. Up to 32 idle query
readers retain their caches, with additional connections while requests run.
Mmap stays disabled, including read-only CLI inspection. A larger cache cannot
prevent cache invalidation when background delivery commits during probes.
Before comparing scale checkpoints, record live background work as well as
`doctor --latency`; restarting a drained copy changes that workload.

The current automatic checkpoint is passive at 1,000 WAL pages. The WAL can
retain its high-water file allocation after frames have been checkpointed;
file size alone does not establish uncheckpointed work or a read stall. There
is no added truncation policy or supported cache/mmap tuning setting.
Use local storage for the WAL database: SQLite WAL requires same-host shared
memory and is not supported over network filesystems. Do not enable mmap as an
unmeasured workaround: mapped I/O errors can terminate the process with a signal,
and mixed mapped/unmapped access (including `sql` and work-record inspection)
requires a correctly unified OS buffer cache. These are additional reasons the
server and device defaults remain unchanged.

## 7. Expo

`npx snapback4 init --expo` writes `metro.config.js` and
`metro-wasm-transformer.cjs`, and prints every file it wrote (`init: files: …`); only inside an
existing package whose `package.json` says `"type": "module"` does it name the CommonJS configs `.cjs`.
Wasm is a Metro asset, and the transformer
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
  assets: { keep: "viewed", maxBytes: 67108864 },
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
with the persisted restore evidence intact. For a custom Node host,
`processDevice({ binary, dir })` from `snapback4/native` opens
`snapback4 device <store>` as a process, exchanging one JSON line each way.
Use this published adapter for the same native device protocol. Measured: 1.7 MB linked on iOS, SQLite included; 313 KB
gzip as wasm.

For Expo the module is the `snapback4-expo` package: `nativeDevice` is
the opener and `nativeAvailable()` says whether this build carries it,
so an app opens the Rust device in a development or production build and
the online tier in Expo Go, with nothing above the choice changing.

The client probes the device first and refuses with `E_DEVICE_VERSION`
when the device predates it: reloading JavaScript does not update a
native module; rebuild the development build.

### The device reply

<!-- @ref LLP 3000.036#5 — the device reply is a host contract; the routing rule is the JS client's. -->
`snapback4/client` turns every device `query` into a `Read`. A host that calls
the module itself (`sb4_call`, `processDevice`, or the wasm device without the
client; Exact2's first-party client is one) must make the same decisions. The
device answers from the rows it holds plus its own predictions, and some
answers are not its to give. The reply says which; a host that renders `data`
without reading it shows `[]` or `0` where the server has rows.

The request is `{ "op": "query", "name", "viewer", "args", "now" }`, with `now`
the host's issued time in Unix milliseconds. A top-level `{ "denied": Refusal }`
means the call was refused before evaluation (`E_GENERATION` for a stale
backend, `E_INPUT`, a store failure): repair it, or ask the server. Otherwise
the reply is `{ "ok": { .. } }`:

| field | meaning |
| --- | --- |
| `data` | The value over the rows this device holds, including its own predicted rows. Absent when `loading` is true. |
| `loading: true` | The device cannot produce a value within its coverage (for example a `count` over a table synced with a horizon). |
| `complete` | `true`: the whole answer to what the query read. `false`: more may exist (a meter or word cut, a horizon, missing coverage). |
| `cut`, `next` | As on `POST /q`: `"meter"`, `"words"` or null; the cursor to pass back for the next page, or null. |
| `unknown` | The answer depends on facts only the server has: an `online only` table or view, `connected[p]`, rows past a sync horizon, a partition not yet acquired. |
| `speculative` | Sent only when true. The value, or the refusal, is a placeholder computed as if the missing rows did not exist: `[]`, `0`, `null` or a `NOT_FOUND`-style refusal. It is never an answer. |
| `retained` | The answer reads history this device keeps after leaving a group (`retain delivered-history`); the server no longer serves it, so the answer is the device's even when `unknown`. `retainedRows` marks such rows in a page. |
| `components` | For an object whose fields are separate reads, each field's own `{ complete, unknown, retained, speculative }`. |
| `denied` | The program refused. With `unknown: false` the refusal is authoritative; with `unknown: true` it may come from rows the device does not hold. |
| `pending: true` (on a row) | A row this device predicted from a queued write. Server answers never carry it; the row loses it once sync applies the commit. |
| `tables`, `scopes` | What the evaluation read: evaluate again when sync or a local write touches them. |
| `watermark` | The device's applied sync position at evaluation. |
| `nextExpiry`, `decorationExpiry` | The earliest future instant (issued time) at which something the answer read expires: evaluate again then, offline too. |

**Whose answer.** The client's rule, for every reply:

- **The device's** when `unknown` is false or `retained` is true. Render `data`
  or the refusal. Here `complete: false` means partial, not "ask the server":
  show "Results may be incomplete", never "no matches".
- **The server's** when `unknown` is true and `retained` is false. Online, send
  `POST /q/<op>` with the same arguments ("The wire", §5) and render its reply.
  Until it lands, and offline, non-speculative `data` is a usable partial (the
  page rows the device holds, a lower-bound count): show it as partial.
  Speculative `data`, a speculative refusal and `loading` are not: show
  loading, or offline the last server answer kept for the same operation and
  arguments, labelled with its age, or unavailable (`E_OFFLINE`).
- `E_PREDICT` or `E_NATIVE` with `unknown: true` means evaluation never began
  (the partition is not acquired, or the native module is missing): ask the
  server.
- From `GET /schema`: a query with `schema.operations.<op>.held` never asks the
  server: render the device's reply, or loading. One with `ephemeralReads`
  always does. `runs: "server"` marks a query with a server-only read site, which a
  host may send straight to the server.

Verified with one row in an `online only` table and four rows in a table synced
`last 2`:

| read | device reply | `POST /q/<op>` |
| --- | --- | --- |
| page of the `online only` table | `data: []`, `unknown`, `speculative` | the row |
| `online only` count view | `data: 0`, `unknown`, `speculative` | `4` |
| point read of a row past the horizon | `data: null`, `unknown`, `speculative` | the row |
| page ordered against the horizon | the two held rows, `complete: false`, `unknown` | all four |
| `count` over the horizon table | `loading: true`, `unknown` | `4` |
| `require exists` on a row past the horizon | `denied` (the authored code), `unknown`, `speculative` | the row |
| `require` on an argument | `denied` (the authored code), `unknown: false` | the same refusal |
| the viewer's own predicted insert | the row with `pending: true`, `complete: true` | absent until the write commits |

**The prediction fence is the host's.** The device's answer includes queued
writes; the server's does not until they commit, so a server answer can erase
an optimistic row. Check the outbox (`queued`) before sending `POST /q/<op>` and
again when its reply arrives. Hold the server answer back while a write is
being admitted, while an unconfirmed (`observed_seq` null) predictable entry
has no `predicted` keys, or while the tables of any unconfirmed entry's
`predicted` keys (`table/id`) intersect the read's tables. The read's tables
are the reply's `tables` when it is complete and known, else every table the
operation can read. A host that cannot compute that set may hold back while
anything is queued. Meanwhile show the device's answer, or loading if it is
speculative, and ask again once sync observes the write. The device cannot
apply this fence: a write can begin while the server read is in flight.

**Kept server answers.** Keep each server answer by operation and arguments
for offline recovery, ordered by its `seq` so an older reply never replaces a
newer one. Drop it at its `nextExpiry` (server time), and on a viewer, session,
store or backend-generation change. A device answer is current only while the
link is online, sync is caught up and the store identity is checked; otherwise
label it with the last sync time. When a reply mixes retained and
server-needing parts (`components`, `retainedRows`), the client asks the server
and keeps the retained parts from the device, waiting until the device's
`watermark` reaches the server reply's `seq` before the server page may replace
history. A host that does not compose them should render the device's answer
as partial.

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


### Automatic delivery reports

A mutation declaring `reports delivery of messages by .conversation, .ordinal`
lets the SDK report exactly the positions delivered to this client. Local
clients persist debt with published confirmed rows and accepted fallback
manifests. Online clients collect accepted query manifests in memory, including
nested images. A composed answer omits the manifest when it replaces server
rows with retained local rows. Query manifests pass the same restore floor as
reports. Through `createApp` / `guardClient`, acceptance occurs only when the
facade publishes the shared authority-approved answer or returns it from
`query()` after approval. Its manifest follows the answer's identity, so peer
facades collect it once; refused, superseded or expired answers collect nothing.
Without a facade, acceptance remains the raw watch publication or query return,
synchronously at its final fences. Collection persistence never delays or rejects the answer;
every CAS attempt rechecks those fences, including at the host's commit point.
An answer overtaken before that write stays accepted, but collects nothing.
Unsupported conditional persistence also omits the collection; those rows stay
`sent`. No mounted conversation or application delivery hook is needed.
Keep calling `seen` for messages the person actually views. A continuously
mounted `progress` query acquires its returned message rows, so use it only
when that catch-up is intended.

Reports bypass the ordered outbox and dispatch only when its local network
chain is idle. Four groups may report concurrently, one call per binding and
group, with a 15-second deadline. A retained uncertain attempt keeps its id across
local restarts. Committed success covers its exact run; `RUNS_FULL` parks it
and allows other intervals to proceed. New publications, success, reconnect,
start and a slow timer wake parked runs, at most once per 30 seconds each.
Startup waits only for debt present at startup. Later activation pages wait
for capacity without evicting debt, retaining outbox priority even during live
traffic. A failed page resumes its durable cursor with bounded backoff.

`E_BOUND` is an ordinary non-retryable refusal in either the `why` or
`denied` envelope, including a denial without a head. The interval parks until
the next start and calls `onDeliveryRefused` once. Reconnect, timer wakes,
eviction and recollection do not resend it within the session; clean intervals
in the same group can still report. The next start retries with a new id.
An expired unswept backlog normally clears before then; if an oversized reply
hid a committed report, reporting that coverage again is a no-op. Retries are
bounded by app starts. Start-only suppression applies to every ordinary
non-retryable refusal, is scoped to fingerprint and group, and clears on start
or store reset; it creates no terminal refused entry.

Pass `onDeliveryRefused` to `createClient`, `createLocalClient` or `createApp`
for application refusals. It receives
`{ table, mutation, args, group, from, through, why }`; `why` is the ordinary
coded refusal. `NOT_A_RUN` and `PAST_LAST_MESSAGE` enter a remembered refused
set; other non-retryable application refusals park until restart.
`RUNS_FULL`, membership loss, auth pauses and transport retries do not emit
this callback. Reports do not appear in `onWrite` or `pendingWrites()`.

Local debt survives closing or sign-out for the same viewer. Online sign-out
waits at most one second for reports already in flight; remaining memory debt
is lost. Leaving drops a group's debt. Store replacement or detected restore
clears delivery metadata and fences outstanding callbacks; recover using a
fresh device store. Debt never crosses viewers or binding incarnations.
Each report sends `delivery: { fingerprint }` from its compiled binding or
manifest. `E_DELIVERY_BINDING` drops that binding's state; an unrelated backend
generation preserves unchanged fingerprints. Positions outside JavaScript's
safe-integer range are never collected.

Each binding/group keeps at most 256 owed intervals, 256 reported intervals
and 64 refused intervals. There are at most 4,096 local or 1,024 online active
groups. Eviction drops owed positions, which stay `sent`, but retains refused
intervals. A saturated refused set stops that group's collection and dispatch
until a leave/rejoin or a new device store.

### Inspect subscription pressure

If a screen flashes empty, compare queue/in-flight counts with withdrawal causes.
A `change-timeout` exhausts the answer's one-second budget outside capacity wait;
expiry, denial and resets remain immediate. The last 256 completed attempts supply
queue/attempt latency p50/p95/max, and the last 64 withdrawals retain causes.
Samples contain query names and counts, never arguments or answer values.

```tsx
import type { Client } from "snapback4/contract";
import { inspect } from "snapback4/inspection";
import { useInspection } from "snapback4/react";

export function logSubscriptions(client: Client) {
  const pressure = inspect(client);
  console.table(pressure.queries);
  console.table(pressure.recentWithdrawals);
}
export function SubscriptionPressure({ development }: { development: boolean }) {
  const pressure = useInspection(development);
  return pressure ? <pre>{JSON.stringify(pressure.totals, null, 2)}</pre> : null;
}
```

Mount the overlay inside the client provider and pass the host's development flag
(`import.meta.env.DEV`, or `__DEV__` in Expo). Disabled installs no timer; enabled
samples every 250 ms. Counts include lingering observations and delayed retries;
direct reads and presence refreshes are outside this queue.


### Visible seen progress and independent history

After `check`, a receipts clause emits `api.receiptFamilies.chat`. Import
`useSeen` from `snapback4/react` on web or native:

```tsx
import { usePage, useSeen } from "snapback4/react";
import { api } from "../snapback/generated/api";

export function useReceiptScreen(id: string, visibleIds: ReadonlySet<string>, foreground: boolean) {
  const history = usePage(api.history, { conversation: id });
  const through = Math.max(0, ...history.items.filter(m => visibleIds.has(m.id) && !m.pending).map(m => m.ordinal));
  const seen = useSeen(api.receiptFamilies.chat, { scope: id, through, active: foreground });
  const decorations = usePage(api.messageReceipts, { conversation: id });
  return { history, seen, decorations };
}
```

Supply viewport IDs from the platform's actual visibility callbacks; intersect
with current confirmed rows and combine route focus with foreground. Reset IDs
on account/backend/scope change. Loaded history and acquisition do not mean seen.
Match current decorations by ID; their denial or loading never removes retained
history and grants no media authority. These reads are independent snapshots.

The hook shares progress and one admission/pending call per mounted
client/family/scope. Member withdrawals, replacement, session and store/generation
resets discard local progress; final unmount drops unadmitted progress. Admitted
writes remain in the SDK outbox through restart. The hook never pages history,
reads catch-up progress, or reports delivery. The descriptor's typed member/seen
handles, actual argument names, mapping and fingerprint come from the compiler.

`seen.state` is idle/admitting/pending/retrying/failed; `seen.through` is local
progress, never a confirmed receipt. `seen.why` exposes refusals. Known
E_ADMISSION/E_ADMISSION_STORE/E_ADMISSION_TIMEOUT failures retry with 1–60-second
backoff, at most eight retries while active. Reconnect or `seen.retry()` after
repair wakes those refusals. Other failures/unknown outcomes remember the rejected
position and reset local progress to `max(joining floor, acknowledged)` before failing.
A later different visible position above that floor starts a new attempt, even
below the rejected position. Repeated input and retry never resubmit the rejected
position; membership/session reset clears it.
See `snapback4 guide receipts` for the full rules and two-read recipe.

### Refused sessions and dev time tests

`E_AUTH` retains family `auth` and the server's message on the local tier,
online tier and app online arm, including calls after terminal refusal. Detailed
dev explanations require the dev-only endpoint trust check (loopback peer, Host and
browser Origin). A remaining record can identify expiry; absent records may mean an
earlier/replaced store, another instance, expiry or sign-out, including before server
startup. No token history is kept. Sign in again and discard saved earlier-store tokens.
Serve and untrusted dev requests, including public POST routes, use the same generic
"this session is not live; sign in again" for each case. Clients without credentials
still ask you to sign in. There is no new refusal field; avoid matching message text.
Refused session tokens on logout, narrow, refresh and logout-all use the same
HTTP 401 and `guide: personas` envelope as data requests, without a code prefix
inside the message. Device-app restoration keeps its terminal refusal on
`app.ready`, `app.auth.why` and the signed-out `app.online` query/mutate/act facade.
Local `logoutAll` preserves an already retained refusal; a new sign-in replaces it.

For time-travel tests use `snapback4 dev --fresh --port 4401`, point the suite's
client URL at `http://127.0.0.1:4401`, then run `snapback4 clock advance 25h --port 4401`.
Stop that disposable server after the suite. Each new store needs new sessions.
The advance reports its cumulative offset and restart lifetime. `doctor --url
http://127.0.0.1:4401` reports that clock; dev startup and doctor flag future stamps
in the latest 64 commits with `N_CLOCK_STORE_AHEAD`. Older commits can be missed,
even when their rows remain; historical commit stamps can outlive deleted rows. See `snapback4 guide jobs` for the
complete recipe and detection scope. Inspection failures print "unavailable" and
leave dev startup running; ordinary store admission still applies. No row image
is inspected. Restarting resets time, not written rows.
