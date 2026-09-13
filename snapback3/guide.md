# Building with the first Snapback 3 slice

An application has a `snapback/` directory containing a Quarry schema, named
queries and mutations, and an optional development `seed.ts`. The compiler
infers the API from those operations. The server certifies them and owns the
authoritative SQLite database. The SDK owns live reads, device storage, and
durable mutation recovery.

Start with the working [Commonroom example](examples/chat/README.md). Its
[schema](examples/chat/snapback/schema.q) and
[message operations](examples/chat/snapback/messages.q) show the actual forms
accepted by this implementation. A read rule controls row visibility; mutation
requirements and write rules enforce the operation's authority. A development
persona exercises those same rules under a local fictional account.

## Authorization rules and write preconditions

Rules use supported predicates such as `allow`, `deny`, `exists`, `=` and `!=`
over `viewer` and row fields, combined with `and`, `or`, and `not`.
Numeric ordering comparisons (`<`, `<=`, `>`, `>=`) are refused in rules.
An operation can use a mutation `require` for a write precondition. That does
not replace read authorization: every read still needs a rule that expresses
the intended visibility using supported predicates. Compiler repair advice
preserves this distinction and does not promise an equivalent automatic rewrite.

## Generate the application API

Run `snapback3 check <application-directory>`, or the repository CLI as shown in
the README. This writes `.snapback3/build/api.d.ts`. Include it in the app's
TypeScript configuration. Development mode refreshes it after an accepted backend
change. Generated declarations extend the `api` imported from `snapback3/client`;
there is no separately maintained list of operation names or argument types.

`check --json` prints structured certification results. During development,
a query can be inspected with:

```sh
snapback3 run messages.page '{"conversationId":"studio"}' --as alice --project examples/chat
```

`dev` owns the foreground process and prints its URL. Use Ctrl-C to stop it.
Accepted backend edits preserve the database; a rejected edit leaves the previous
generation serving and reports the compiler's diagnosis. A second owner cannot
open the same database. Each application stores its private state in `.snapback3/`.

The accepted project definition is committed with its database generation.
After a worker restart, the owner recertifies that committed definition before
serving reads, including when an update committed but its reply was lost.
An older experimental database without this recovery record refuses startup
with `S3_PROJECT_RECOVERY_REQUIRED`. After verifying that the current backend
source is the intended installed project, run `dev` or `serve` once with
`--adopt-legacy-project` to establish the record. Automatic worker recovery
never adopts a legacy project or installs a new source definition.

Jobs and system mutations use the separate local operator credential stored in
`.snapback3/operator.json`. For example:

```sh
snapback3 job enqueue messages.backfill '{}' --as system --project my-app
snapback3 job recover '{"limit":32}' --as system --project my-app
snapback3 job status JOB_ID --as system --project my-app
```

If an enqueue response is lost, use `job recover` to discover committed jobs
before taking another action. It reads durable IDs, names, states and timestamps
for this operator, including after the whole owner restarts. Follow a non-null
`next` cursor by passing it as `after`; `limit` defaults to 32 and is at most 64.
`job plan`, `resume` and `cancel` inspect or control an existing declaration or
job. `operator logs --as system` provides recent owner diagnostics, while durable job
recovery remains available after those in-memory logs are gone. Application
session credentials cannot use operator routes.

## Read independently useful values

Create one client and put it in the React provider:

```tsx
import { createClient } from 'snapback3/client';
import { SnapbackProvider } from 'snapback3/react';

const client = createClient({ url: window.location.origin });
await client.ready;
// Local development only. The headless auth API also has signup/login/logout.
await client.auth.persona('alice');

<SnapbackProvider client={client}><App /></SnapbackProvider>;
```

`client.ready` restores local state. It does not wait for a network connection
or assert that cached data is fresh. A restored session reconnects in the
background; resources continue to report their own completeness and freshness.

For an Expo 57 native application, install `expo-sqlite` and `expo-crypto` with
Expo's package installer, then use the native entrypoint:

```tsx
import { createExpoClient, SnapbackProvider } from 'snapback3/expo';

const client = createExpoClient({
  url: backendUrl,
});
await client.ready;

<SnapbackProvider client={client}><App /></SnapbackProvider>;
```

This entrypoint supplies SQLite persistence, Expo's streaming fetch, and secure
operation identities. Use the same query, acquisition and mutation APIs as on
the web. Its default SQLite filename includes a hash of the backend URL, so
switching servers cannot restore another server's session or queued writes.
Trailing slashes do not create another database. Browser applications keep
using `snapback3/client`.

An explicit `databaseName` selects a plain basename in the application's private
database directory. The caller then owns that namespace: reuse it only for the
same backend. The earlier unscoped `snapback3.db` is never adopted automatically.
After independently confirming which backend owns an existing file, an
application can select that exact name to reopen it.

Keep the client for the application's lifetime. `client.close()` immediately
stops new work; `await client.closeAsync()` also waits for pending storage work
and closes its owned database connection. An explicitly supplied `storage`
adapter remains the caller's responsibility. The
[Expo/Hermes witness](benchmarks/native-platform/README.md) now exercises real
iOS simulator SQLite, offline reopening across process death, FIFO replay and
terminal receipt restoration. Full Clique's native media, search and scale
journeys remain unqualified by that small persistence fixture.

A query returns a resource snapshot, including its value and what is known about
that value. Reading messages and an unread count separately lets each remain
useful independently:

```tsx
import { api } from 'snapback3/client';
import { useQuery } from 'snapback3/react';

const messages = useQuery(api.messages.page, { conversationId, c: null });
const summary = useQuery(api.conversations.unread, { conversationId });
const unread = summary.complete ? summary.data?.unread : undefined;
```

`complete` describes the server's completeness classification at `seq`.
A bounded page can have useful `data` and a `next` cursor while `complete` is
false. Render that page and follow its cursor; waiting for the same capped page
to become complete will not download the rest. `fresh` describes current server
confirmation. Cached offline data can be complete and stale. A missing count is
unknown; render that state instead of turning it into zero. Resources from
different sequences do not establish a common snapshot.

Use the opaque `next` cursor as the next query's `c` argument. The example uses
40-message pages and 50-conversation pages. It displays the selected page and
explicitly provides earlier/latest navigation. Resources share authorized facts
and local evaluation evidence, but a query that lacks sufficient evidence stays
unavailable offline. This slice does not automatically download every room.

Live resource frames replace each subscribed result directly. Ordinary commits
do not deliberately blank all views. A denial or row removal takes effect even
when saving the replacement to browser storage fails. New positive facts become
available only after durable admission. The client also fences old sequences and
out-of-order manifest replies.

Headless applications use `client.watch(op, args)` and its `subscribe`,
`getSnapshot`, and `refresh` methods, or await `client.query(op, args)` for one
result. React renders that same store; it has no separate cache.

## Acquire a dataset for offline use

Declare the paginated dataset on the same client that serves the screen. This
example acquires Commonroom's complete conversation list and each conversation's
message history:

```ts
import { api, pages } from 'snapback3/client';

const history = client.acquire({
  id: 'room-history',
  revision: '1',
  root: pages(api.conversations.list, { c: null }),
  expand: entries => entries.flatMap(({ conversation }) => conversation ? [
    pages(api.messages.page, { conversationId: conversation.id, c: null },
      { key: conversation.id }),
  ] : []),
});

await history.completed;
```

The SDK follows opaque cursors, groups authorized reads and storage writes,
and retains durable progress. Completion includes local query evidence and
indexes. Ordinary `watch` and `query` calls then use the acquired data offline;
the application does not need another reader, cache or page accumulator.
`pages` accepts certified queries that return lists; a record containing a page
array is not a supported acquisition result. Time-dependent and connected queries
cannot declare a durable offline dataset.

Use a stable `id` and change `revision` when the dataset definition or `expand`
logic changes. Registration captures the declaration and its root arguments;
changing the original object later does not change an existing handle. The
captured `expand` function should derive the same dataset for a given revision.
The SDK checks the root and derived declarations when resuming.
An explicitly changed declaration withdraws its previous scope even when the
replacement cannot finish offline. Other datasets keep their own identity.

The handle exposes `getSnapshot()` and `subscribe()` for progress and current
availability. `completed` is the current acquisition cycle's promise. Transient
connection failures keep that promise pending and resume automatically after
reconnect. `cancel()` rejects it with `S3_ACQUISITION_CANCELLED`; awaiting
`history.resume()` starts a new cycle after cancellation or a terminal error.
Cancellation also withdraws a ready dataset and any displayed resources that
depend on it; resume revalidates before making it available again.
Repeated resume calls during acquisition join the same work. A sealed handle
cannot resume under a different account or generation.

A known newer commit suspends old evidence while the SDK revalidates it;
retained history is not discarded for every ordinary write. Account changes, denial and accepted generation changes
withdraw the previous authority. A failed authority withdrawal seals this
client and attempts to remove the matching durable session. If storage refuses
every write, durable erasure cannot be guaranteed. Clients reusing one custom
storage adapter wait for its pending withdrawal and cleanup before restoring.
Separate adapter instances must provide their normal change notifications.
A saved dataset can restore after process reopen, subject to the same authority
and sequence checks. The application shell must separately be available offline
as described below.

## Save an operation once

```tsx
import { api } from 'snapback3/client';
import { useMutation, useOperation } from 'snapback3/react';

const send = useMutation(api.messages.send);
async function submit(body: string) {
  const operation = send({ conversationId, body });
  await operation.durable; // Saved locally; it is now safe to clear this submitted draft.
  return await operation.settled; // The server outcome is saved locally.
}
```

Call the mutation in an event handler. `useOperation(operation)` subscribes to
its lifecycle; `useClientState().pending` lists work for the active account.
The phases distinguish saving locally, queued, sending, and observing an accepted
write in relevant live queries. A server commit and its appearance in a query are
different events. A rejected or conflicting receipt needs an application decision.

The SDK persists immutable arguments and identity before sending. After a lost
response or browser reopen, it checks that identity and retries it when needed.
The server records data and its terminal receipt in one transaction. The same
receipt remains recoverable after a schema or program change; uncommitted work
whose identity has changed is parked for review.

Do not call `mutate` again merely because a reply is late: that requests a new
operation. Let the original recover. `client.operation(id)` finds saved work;
`client.dismissOperation(id)` acknowledges terminal or parked work after the app
has preserved any user input it needs. A changed account seals retained operation
handles, hides its data, and leaves its saved work recoverable under that account.

Draft retention is application policy. Commonroom persists drafts and edit bases
per account and conversation, clears only the submitted draft after durable
admission, and preserves words from rejected operations. Its conditional edit
compares the original body so a later edit does not silently overwrite another
change.

## Offline and storage behavior

Browser clients use IndexedDB by default. Each admitted batch updates normalized
rows and resource evidence incrementally, alongside the operation journal.
`client.setOnline(false)` selects deliberate offline use; `setOnline(true)` resumes
recovery. The example exposes this through its room details panel. Browser network
events also drive connection state.

The example separately installs an application shell after its first successful
online visit. Its service worker caches only the built interface assets, so the
page itself can reopen offline. It never caches authentication or query responses.
An updated shell waits until older tabs close, without reloading an active draft.

Account changes propagate to other tabs sharing the same client database. An
adapter for tests or another host must implement the atomic `ClientStorage`
contract. `createMemoryStorage()` is for tests or explicitly ephemeral sessions;
it does not make process-restart durability promises.

The [README](README.md) lists the supported runtime and its current omissions.

## Media HTTP transport

The experimental Node owner now serves validated images and videos through the
following headless HTTP surface. The ordinary SDK upload/cache/rendering API is
still being integrated. Build both `snapback3-worker` and `snapback3-media`;
project admission qualifies the helper's exact protocol and supported formats.

| Request | Result | Authentication |
| --- | --- | --- |
| `POST /api/assets?kind=image` | Raw JPEG/PNG/WebP upload, at most 10 MiB; returns `{ id, width, height }` | Application bearer |
| `POST /api/assets?kind=video` | Raw MP4/H.264 with optional AAC, at most 50 MiB and 60 seconds; also returns duration in milliseconds | Application bearer |
| `GET /api/assets/:id/status` | Creator's upload lifecycle: `receiving` or `ready` | Application bearer |
| `POST /api/assets/:id/discard` with `{}` | Discard an unattached upload; bounded reclamation releases its storage charge | Application bearer |
| `POST /api/assets/session` with no body | `{ token, expiresAt }` for private media playback | Application bearer |
| `GET` or `HEAD /api/assets/:id` | Currently authorized bytes or metadata; ordinary assets support ranges and ETags | Application bearer, or anonymous for certified public ordinary assets |
| `GET` or `HEAD /api/assets/:id?s=token` | Private player URL using the media-only token | Media carrier only |

Set the actual image/video `Content-Type` on upload. Pass the returned record
as the corresponding image/video argument to the authored attachment mutation.
Readiness follows validation, quota reservation, durable bytes and removal of
the original metadata-bearing stage. An upload does not itself attach an asset
to an application row.

Media-only tokens expire within ten minutes, never outlive their application
session, and disappear when the owner restarts. Every byte request rechecks the
current session and owning row. Send a carrier only on the asset GET/HEAD route;
never put the application bearer in a URL or combine both credentials. A client
can obtain a new carrier after expiry or owner restart.

An available once image is consumed by an authorized GET; HEAD does not consume
it. A previously consumed image returns 410 only to a currently authorized
recipient. Anonymous, foreign and unreadable assets return 404. Once images use
`no-store`; request them only when the user opens them and keep their bytes in
memory. Ordinary media caching and its account/revocation lifecycle will be
owned by the SDK media integration.

The focused Mac qualification used the real worker/helper/HTTP path, including
an uploaded five-second MP4 played by Chrome through a private carrier. It also
exercised row denial, once behavior, restart/logout, reclamation, helper process
limits and interrupted uploads. This is not yet the full Clique media or native
media qualification. Linux helper memory-limit code has been cross-compiled;
the current browser proof is on macOS.
