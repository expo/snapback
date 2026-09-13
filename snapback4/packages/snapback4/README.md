# snapback4

The scale-to-zero backend with a partition on every device. One binary
compiles a schema written in Quarry and serves it; one client holds the
viewer's partition on the device and runs the same queries there. This
package carries both: the `snapback4` CLI (the Rust binary, installed for
your platform as an optional dependency) and the TypeScript client.

```sh
npm install snapback4            # the client, and the CLI for darwin-arm64
npx snapback4 init               # writes snapback/schema.q
npx snapback4 check              # compiles it; writes snapback/generated/api.ts
npx snapback4 dev                # serves it on 127.0.0.1:4400, re-adopting on every save
npx snapback4 guide              # the grammar on one screen; `guide <keyword>` for a card
```

Everything below is the whole published surface. There is no other
documentation; the diagnostics carry the rest (every refusal names its
code, its site and a rewrite, and `snapback4 why <CODE>` explains it).

## 1. The shape of an app

```
my-app/
  snapback/schema.q          the backend: tables, rules, sync, queries, mutations
  snapback/generated/api.ts  written by `check`; never edited, never committed
  src/                       your client: React on the web, React Native on Expo
```

The backend is one file (more `.q` files beside it hold modules; their
operations are named `<module>.<op>`). The client imports `api` from the
generated file and talks to the server through one client object. There
are no resolvers, no migrations to write, no subscriptions to manage: a
table's `sync` line says which devices hold its rows, and the client's
reads run over what the device holds.

## 2. Quarry

Comments start with `--`. Blocks indent with two spaces. A file starts
with directives, then tables, maintains, queries and mutations.

```
use identity                       -- guests and password accounts (§6)
use personas alice, bob, carol     -- a development cast (§5)

table conversations:
  title: text <=120
  creatorId: principal
  read <- exists memberships[.id, viewer]
  insert <- .creatorId = viewer
  update <- deny
  delete <- deny
  after insert <- exists memberships[.id, .creatorId, 'admin']
  sync to memberships[.id]

table memberships:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  unique byConversationPrincipal: conversationId, principal
  by byConversationPrincipalRole: conversationId, principal, role
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  immutable conversationId, principal, joinedAt
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer, 'admin']
  delete <- .principal = viewer or exists memberships[.conversationId, viewer, 'admin']
  sync to memberships[.conversationId]

table messages:
  conversationId: conversations
  authorId: principal
  body: text <=4000 ?
  editedAt: time ?
  at: time
  by byConvTime: conversationId, at, id
  immutable conversationId, authorId
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  update <- .authorId = viewer
  delete <- .authorId = viewer
  retain delivered-history
  sync to memberships[.conversationId] last 500 by byConvTime

maintain messageCounts: count messages by conversationId
  read <- exists memberships[.conversationId, viewer]

query thread(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  return messages[conversationId] after c last 50 by byConvTime

query inbox():
  return memberships[viewer] first 50 by byPrincipalConversation
    { conversationId, conversation: conversations[.conversationId], count: messageCounts[.conversationId] }

mutation send(conversationId: conversations, body: text <=4000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, at: now }
  return { id: row.id }

mutation edit(messageId: messages, body: text <=4000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  update messages[msg] { body, editedAt: now }
  return null
```

### Tables

- Every table has an implicit `id` and a unique `byId` index.
- **Types:** `principal`, `id`, `<table>` (a reference to that table's
  id), `int`, `time` (milliseconds), `bool`, `decimal <scale>`,
  `money <CUR> [scale]`, `text <=N`, `text M..N [format handle|url]`,
  `enum('a', 'b')`, `json <=N`, `bytes <=N`, `[type] <=N` (a list),
  `image <=N [once]` and `video <=N` (an upload the row holds — §4,
  assets); `?` after a type makes the column optional (null when absent).
- **Indexes:** `by name: cols` orders rows; `unique name: cols` also
  constrains them. A scan needs an index whose leading columns are the
  scan's prefix; a page's order is the index's remaining columns.
- **Constraints:** `cap N by cols` (at most N rows per group),
  `immutable cols`, `after insert <- exists t[..]` (a row that must
  exist by the end of the mutation that inserted this one).
- **Rules:** `read`, `insert`, `update`, `delete`, each `<-` one
  expression over the row (`.col`), `viewer`, and literals: `allow`,
  `deny`, `public` (or the table line `public 'reason'`, which also
  documents why), `.col = viewer`, `.col != 'x'`,
  `exists t[.a, viewer, 'literal']`, `created t[..]` (insert rules only:
  true when this mutation inserted the probed row), `and`, `or`, `not`.
  `update (old, next) <- old.x = next.x` names both images. An `exists`
  probe needs an index over exactly its key columns; `by index` names
  one when two match.
- **Sync** (§3) and **retain**: `retain until-revoked` (the default: a
  device drops a group's rows when it leaves the group) or
  `retain delivered-history` (it keeps what it was given).
- **Expire:** `expire at .expiresAt` (a `time ?` column with an index
  leading with it, `by byExpiresAt: expiresAt`). A row past that time is
  absent to every reader on every host from that moment, before any rule;
  the server sweeps it within seconds and the deletion streams to each
  device holding it. A null time never expires. Disappearing messages
  are one field on insert, `expiresAt: now + ttl if ttl != null else
  null` with `ttl: int ?`; nothing else to write.

### Maintains

`maintain counts: count messages by conversationId` (or `maintain totals:
sum posts of score by authorId`) keeps an aggregate table the engine
writes. A program reads it by group and gets **the number**:
`counts[conversationId]` and `counts[.conversationId]` in a shape are an
`int`, 0 when the group has no row. (On the wire and on a device the
table's rows are `{ id, <by columns>, value }` with the group's canonical
key as the id; that shape only matters to sync.) It takes its own `read`
rule and inherits the source's `sync` when it groups by the audience
columns.

### Queries and mutations

- **Arguments** are typed like columns; `c: cursor ?` is an opaque page
  cursor. An omitted optional argument reads as null.
- **Reads:** `t[key]` (one row by a unique key, null if absent or
  hidden), `t[key] ! else CODE` (or refuse), `exists t[key]`,
  `t[prefix] first N by index` (ascending), `t[prefix] after c last N by
  index` (descending, from a cursor), `merge t first N by index:` with
  `[lane]` lines (one ordered page over several prefixes), `walk t[seed]
  up .parentId depth 8`.
- **Shapes:** `{ *, author: users[.authorId], count: counts[.conversationId] }`
  after a page or a row; `.` is the row; `*` spreads its columns; a point
  read inside a shape is null for a hidden row. `shape card = { .. }`
  names one to reuse.
- **Writes:** `insert t { fields }` (returns the row; the id is minted
  unless given), `insert t { .. } if absent` (null on a unique clash),
  `update t[key] { patch }` (`if .col = expected` makes it conditional;
  `NOT_FOUND` when the row is missing), `upsert t[key] { fields }`,
  `delete t[key]`. A final write is the implicit return; bind it to use
  it (`row = insert ..`). Writes check the rule, unique indexes, caps,
  immutables and text formats; any refusal rolls the whole mutation back.
- **Statements:** `x = expr`, `require cond else CODE`, `if:` / `else:`,
  `for x in page:`, `return`. Values: `viewer`, `now`, `new` (an id),
  `count(page)`, `sum(page, .x)` (a field over a page or list; `sum(list)`
  over numbers), `slice`, `min`, `max`, `a ?? b`, `a if cond else b`
  (the arm not taken is never evaluated; `x != null` as the condition
  narrows `x` in the taken arm). There is no `/`: `(quotient, remainder)
  = divmod(a, b)` binds both at once, so a remainder is never dropped
  unread. A bare `return` returns null.
  `=` and `!=` are total (null equals null); `<` and friends need
  present operands — narrow with `if x != null:` or `x ! else CODE`.
- **Refusals** a program raises with `require .. else CODE` reach the
  client as `{ code: "CODE", family: "rule", .. }`.

### Jobs and schedules

```
job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 100 by byId:
    ... a mutation's body with p bound; reads and writes as the system ...
schedule daily every 1d at 08:00: digest        -- or: every 2m
```

A job is the server's own work: a sequence of sweeps, each `chunk x in
table[prefix] first N by index:` walking one index a page per commit as
the system principal (every rule passes; validation, constraints,
aggregates and partitions apply) under the job ceilings. The cursor
commits with the rows, so a chunk is wholly done or not started and a
restart resumes at the next one; the index's columns are `id` or
`immutable`, so nothing moves under the cursor, and rows inserted past
the key captured when the sweep began are not visited. `break` ends the
sweep, `return` the job; a refused chunk parks the job with its refusal
(`snapback4 doctor` lists runs). No client calls a job. A schedule fires
it once per period boundary of the server's clock (`every 2m`, `every
1h`, `every 1d at 08:00`), exactly once per boundary across restarts,
passing `periodStart` and `periodEnd` when the job declares them (and
nothing else); a schedule first seen fires from its next boundary.
`snapback4 run <job> '{..}'` runs one here and now. Jobs are not on
`api.ts`.

### The meter

Nothing is priced at compile time. As a program runs, the meter counts
examined rows, index entries, rule probes, steps, heap bytes, output
bytes and rows written against ceilings (8,192 rows examined, 8,192
probes, 1,000,000 steps, 1 MiB output, 1,024 rows written per mutation).
A query past a ceiling returns what it found with `complete: false`; a
mutation aborts with `E_BOUND` naming the ceiling and the site.
`snapback4 check --cost` prints each site's structural class;
`snapback4 test` prints the numbers on your data.

A page whose read rule the prefix does not decide (the rule reads a
column the scan does not pin) is never `complete`: the device cannot tell
"no more" from "more you may not see". Scan by an index that leads with
the rule's columns, or read the page on the device (§4), where the
partition holds exactly what the viewer may read.

## 3. Sync: the viewer's partition is the unit of sync

```
sync public [last N by index]          everyone holds the same rows
sync to .col [last N by index]         each row reaches the principal in .col
sync to t[.a, .b] [last N by index]    each row reaches every principal with a
                                       row in t whose (a, b) match
```

The read rule must be exactly the audience — `exists t[.a, .b, viewer]`
or `.col = viewer` — so a device never holds a row it may not read, and
never misses one it may. A second disjunct or an extra conjunct is a
compile error with the rewrite. The target table needs a unique index
over `(a, b, principal)` and an index leading with `(principal, a, b)`.
The horizon `last N by index` bounds what a device acquires per group;
older rows are online-only, and a device's read past them says
`complete: false`. Joining a group delivers its rows; leaving it delivers
one scope tombstone, and the table's `retain` says what the device keeps.
What it keeps under `delivered-history` it can still read locally through
a query without a membership `require` (the server refuses the same query
once the membership is gone, so a "history" query answers on the device
and is empty online). A table without `sync` is online-only: its queries
run on the server.

## 4. The client

```ts
import { createLocalClient } from "snapback4/local";   // the local-first tier
import { createClient } from "snapback4/client";       // the online tier (no store)
import { api } from "../snapback/generated/api";

const client = await createLocalClient({ url: "http://127.0.0.1:4400", persona: "alice" });
const thread = await client.query(api.thread, { conversationId });
const write = await client.mutate(api.send, { conversationId, body: "hi" });
```

The local-first client opens the device's replica (IndexedDB on the web,
memory with `store: "memory"`, SQLite on Expo — §7), syncs the viewer's
partition, runs every query locally over it, queues every mutation
durably and predicts its rows, and follows the server's stream for the
rest. It keeps the compiled backend in the replica too, so a device that
starts with no network opens on what it holds (`link()` is `"offline"`,
reads carry `fresh: false` and `since`) and catches up when the link
returns; only a device that has never synced needs the server to open. Its options: `url`; one of `persona` (development), `session` (from
`snapback4/auth`, kept and restored by the client), or `guest: true`
(mint one when none is kept); `store`; `sessionStore`; `fetch`;
`waitSeconds`. It has `query(op, args) → Read`, `observe(op, args) →
{ getSnapshot(), subscribe(listener) → unsubscribe, close() }` (a live
read; React's `useSyncExternalStore` shape), `mutate(op, args) → Write`,
`link()`, `onLink`, `viewer()`, `session()`, `signOut()`, `sync()`,
`replica`, `close()`. The online client takes `url` with `persona`,
`session` or `token`, and has the same card without a store.

### The card

Every word a screen reads is on the card (`snapback4/contract`):

```ts
type Read<T> =
  | { data: T; complete: boolean; fresh: boolean; since?: number; next?: Cursor | null }
  | { loading: true }
  | { denied: Refusal };
type Write = { state: "pending"; id } | { state: "sent"; id; seq } | { state: "failed"; id; why: Refusal };
type Refusal = { code: string; family: "input" | "schema" | "auth" | "rule" | "constraint" | "bound" | "op" | "link" | "generation"; message: string; site?: string; rewrite?: string; guide?: string; retryable?: boolean };
```

`complete` says this is everything the query can answer: false when the
meter cut the page, when a scan's read rule is not decided by its prefix
(§2, the meter), or when a page declared without a cursor had more rows
than it holds (declare `c: cursor ?` and page with `after c`; `check`
notes it). `fresh` says the device has everything the server had at the
last sync (`since` is the last sync's time when it does not); `next` is
the cursor for the next page (pass it as the query's `cursor ?` argument);
a page with a cursor and more rows is `complete: true` with `next`. A row this device wrote and the server has not yet
confirmed carries `pending: true`. A write is `pending` while the link is
down (it lands when it returns), `sent` with the server's sequence, or
`failed` with the refusal and its predicted rows withdrawn. `isReady`,
`isLoading`, `isDenied` narrow a `Read`.

### React

```tsx
import { SnapbackProvider, useQuery, usePage, useMutation, useLink, useViewer } from "snapback4/react";

<SnapbackProvider client={client}>...</SnapbackProvider>
const inbox = useQuery(api.inbox, {});                              // Read<Rows["memberships"][]>
const { items, hasMore, loadMore, read } = usePage(api.thread, { conversationId });
const send = useMutation(api.send);   // send.run(args) → Write; send.inFlight
const link = useLink();               // "online" | "offline"
const viewer = useViewer();           // the principal, or null
```

`useQuery` observes: it re-renders when a sync or a local prediction
touches the query's tables. `usePage` follows `next` across pages.

### Assets

```ts
const uploaded = await client.upload(file);            // Blob | ArrayBuffer | Uint8Array
if (uploaded.ok) await client.mutate(api.sendPhoto, { conversationId, photo: { id: uploaded.asset.id } });
const photo = useAsset(message.photo?.id);             // { status: "loading" } | { status: "ready", url, type } | { status: "denied", why }
```

An `image <=N` or `video <=N` column holds an upload: the client sends
the bytes first (`upload` → `{ id, type, bytes, width, height,
duration }`; the server sniffs JPEG, PNG, WebP and MP4 and refuses the
rest with `E_ASSET_TYPE`, and anything over the largest column's bound
with `E_ASSET_TOO_LARGE`), then places `{ id }` in the mutation. Inside
the mutation the argument already carries the facts the server
established (`require clip.duration <= 60000 else TOO_LONG`; every key
is present, null where the kind has none), and the row carries them. One asset, one home: your own
upload, placed once (`E_ASSET_UNKNOWN`, `E_ASSET_PLACED`). Serving is
the home row's read rule: `client.asset(id)` fetches the bytes under the
viewer's credentials and returns a blob URL (`useAsset` in React;
`client.assetSource(id)` gives a URI and headers for native image and
video views); a row that is deleted, whose column is cleared, that
expired, or that the viewer may not read answers `E_ASSET_UNKNOWN`. A
column declared `image <=N once` serves one view per principal: the
second is `E_ASSET_VIEWED`, and the bytes are never cached anywhere
(the sender is never counted). Uploads are online only; there is
nothing to queue.

### Sign-in (`snapback4/auth`)

`guest(url)`, `signup(url, email, password)`, `login(url, email,
password)` return `{ ok: true, session }` or `{ ok: false, why }`;
`logout(url, token)` ends one. A session is `{ principal, kind, token,
expiresAt }`; pass it to `createLocalClient({ url, session })` once and
the client keeps it (`localStorage` on the web, memory otherwise, or the
`sessionStore` you pass — three methods, `expo-secure-store` fits). The
schema opts in with `use identity` (guests and password accounts),
`use identity guests` or `use identity password`. `snapback4 dev` also
admits personas; `snapback4 serve` (a release) admits tokens only.

### The mock (`snapback4/mock`)

`createMockClient({ viewer, tables, ops })` is a client with the same
card over in-memory tables, for component tests; `setLink("offline")`
flips the link.

## 5. Development

- **`snapback4 dev [--port N] [--no-watch] [--fresh]`** serves
  `snapback/*.q` on `127.0.0.1:4400`, recompiling and re-adopting on every
  save; the store lives in `.snapback4/` and persists across runs, and
  `--fresh` uses one in memory that dies with the process (acceptance
  scripts start from nothing). Personas
  (`use personas ..`) sign requests from the same machine with the
  `x-snapback-persona: alice` header (the client's `persona: "alice"`),
  acting as `dev:alice`.
- **`POST /seed`** (dev only, same machine) takes `[{ "table": "t",
  "row": { "id": "..", .. } }, ..]`, writes the rows as the system
  principal in one commit (rules bypassed; validation, constraints,
  aggregates and sync apply) and answers `{ "seeded": N }`.
- **`snapback4 run <op> '<json args>' --as alice [--json]`** runs one
  operation against the local store and prints the result and the meter.
- **`snapback4 test [--fixture dir] [--as persona]`** loads a fixture
  (one `<table>.jsonl` per table) into a fresh store in memory (without a
  fixture, the project's dev store), runs every query as each persona with
  arguments derived from the data (a reference is the table's first row,
  a principal the persona, a text the shortest that fits), prints the
  meters beside the ceilings and the arguments it used, and names any
  query it could not run. A query's own `require` refusing a derived
  argument (the persona is not in that group) is reported, not counted
  as a failure; run it with your arguments to see its meters.
- **`snapback4 check [--cost] [--json]`** compiles, writes
  `snapback/generated/api.ts` (`Rows`, `Ops`, `api`), and prints every
  diagnostic with its site and rewrite; `--cost` adds each site's
  structural class.
- **`snapback4 why <E_CODE | op | table>`**, **`data <table>`**,
  **`doctor`**, **`guide [keyword]`** (cards: rules, sync, expire, assets,
  jobs, writes, reads, shapes, bounds, types, personas, refusals).

### The wire

The client is the intended surface; the wire is plain JSON for anything
else. `POST /q/<op>` with `{ "args": {..} }` answers `{ data, complete,
seq, next }` or `{ denied }`; `POST /m/<op>` with `{ "id", "args",
"newIds" }` answers `{ state: "sent", seq, result }` or `{ state:
"failed", why }` (a client-minted `id` makes the write apply at most
once); `GET /sync?from=W` streams the partition; `GET /changes?since=S`
long-polls for commits; `POST /assets` (the file's bytes as the body)
answers `{ asset }`, `GET /assets/<id>` serves them (404 hidden or gone,
410 viewed; `Range` works); `GET /schema` is the compiled backend;
`POST /auth/guest` (`{}`), `POST /auth/signup` and `/auth/login`
(`{ "email", "password" }`) answer `{ "session": { principal, kind, token,
expiresAt } }` or `{ "denied": Refusal }`; `POST /auth/logout` with the
bearer token ends it. Authorization: `x-snapback-persona` (dev, same
machine) or `Authorization: Bearer <token>`.

## 6. Release

- **`snapback4 deploy <dir> [--allow-destructive]`** compiles the project,
  classifies the change against the current release (additive, a rule
  change, narrowing, destructive) and refuses a destructive one without
  the flag, writes the release under `<dir>/releases/N`, installs the
  schema into the directory's one store, and points `current` at it.
  Every device re-derives its partition on the next sync; a write queued
  under the old schema that no longer fits is refused, typed.
- **`snapback4 rollback <dir>`** moves `current` back.
- **`snapback4 serve <dir> [--port N] [--bind H]`** runs the current
  release on the shared store, tokens only. TLS is a proxy's job.

## 7. Expo

The same client runs on React Native with SQLite as the store:

```ts
import * as SQLite from "expo-sqlite";
import { createLocalClient } from "snapback4/local";
import { expoSqliteDriver, openSqlite } from "snapback4/replica";

const client = await createLocalClient({
  url, guest: true,
  store: { open: async (name, schema) => openSqlite(expoSqliteDriver(await SQLite.openDatabaseAsync(`${name}.db`)), schema) },
  sessionStore: { get: SecureStore.getItemAsync, set: SecureStore.setItemAsync, delete: SecureStore.deleteItemAsync },
});
```

`snapback4/react` works unchanged. (`node:sqlite` fits the same driver
through `nodeSqliteDriver`.)

## 8. Not in this release

Word search (`tokens()` and word-prefix indexes are parsed, not served:
search over synced rows on the device, or by a prefix index), effects
(server-side side effects to third parties: write the fact to a table
and let a job or a reader act on it), platform binaries other than
darwin-arm64 (build from source with `cargo build --release -p snapback4`
and set `SNAPBACK4_BIN`). If the package cannot express something, the
diagnostic names the term; record the gap and move on.
