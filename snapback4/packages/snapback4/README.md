# snapback4

The scale-to-zero backend with a partition on every device. One binary
compiles a schema written in Quarry and serves it; one client holds the
viewer's partition on the device and runs the same queries there. This
package carries both: the `snapback4` CLI (the Rust binary, installed for
your platform as an optional dependency) and the TypeScript client.

```sh
npm install snapback4            # the client, and the CLI for darwin-arm64
npx snapback4 init               # writes snapback/schema.q (and ignores .snapback4/ and snapback/generated/)
npx snapback4 check              # compiles it; writes snapback/generated/api.ts
npx snapback4 dev                # serves it on 127.0.0.1:4400, re-adopting on every save
npx snapback4 guide              # the language card; `guide <keyword>` for a card
```

Everything below is the whole published surface. There is no other
documentation; the diagnostics carry the rest (every refusal names its
code, its site and a rewrite, and `snapback4 why <CODE>` explains it).
Every Quarry block in this file and in the guide is compiled by the
package's own suite, and the language card is run, so nothing here
promises a form the compiler refuses.

## 1. The shape of an app

```
my-app/
  snapback/schema.q          the backend: tables, rules, sync, queries, mutations
  snapback/generated/api.ts  written by `check`; never edited, never committed
  src/                       your client: React on the web, React Native on Expo
```

The backend is one file (more `.q` files beside it hold modules; their
operations are named `<module>.<op>`, and every file shares one namespace
of tables, shapes and helpers). The client imports `api` from the generated
file and talks to the server through one client object. There are no
resolvers, no migrations to write, no subscriptions to manage: a table's
`sync` line says which devices hold its rows, and the client's reads run
over what the device holds.

## 2. Quarry

Comments start with `--`. Blocks indent with two spaces. A file holds
directives, tables, maintains, shapes, helpers, queries, mutations, jobs
and schedules, in any order. `snapback4 guide` prints the language card:
every form in one file that compiles and runs, and the idiom for each
thing the language leaves out on purpose.

```quarry
use identity                       -- guests and password accounts (§4)
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

query inbox(c: cursor ?):
  return memberships[viewer] after c first 50 by byPrincipalConversation
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
  id), `int` (within ±(2^53 − 1); there are no floats), `time`
  (milliseconds), `bool`, `decimal <scale>`, `money <CUR> [scale]` (both
  hold integer minor units), `text <=N`, `text M..N`, either with
  `format handle|url`, `enum('a', 'b')`, `json <=N`, `bytes <=N`,
  `[type] <=N` (a bounded list), `image <=N [once]` and `video <=N` (an
  upload the row holds — §4, assets); `?` after a type makes the column
  optional (null when absent).
- **References** are typed ids, with no implicit existence check and no
  delete cascade. The string `"null"` is an id; JSON `null` only fits an
  optional reference. When a mutation requires a visible target, write
  `require exists prompts[promptId] else PROMPT_NOT_FOUND` before its
  writes: a metered point read that refuses absent and hidden targets
  alike. Target deletion and dependent-row cleanup are the application's
  policy, expressed in mutations and rules.
- **Indexes:** `by name: cols` orders rows; `unique name: cols` also
  constrains them. A point read needs a unique index over exactly its key;
  `exists` needs any index over exactly its key; a scan needs an index whose
  leading columns are the scan's prefix, and pages in the order of the
  remaining columns; a cursor needs an index ending in `id` or a unique one.
  `by index` names one when two match.
- **Constraints:** `cap N by cols` (at most N rows per group; needs an index
  leading with those columns), `immutable cols`, `after insert <- exists
  t[..]` (a row that must exist by the end of the mutation that inserted
  this one).
- **Rules:** `read`, `insert`, `update`, `delete`, each `<-` one
  expression over the row (`.col`), `viewer`, and literals: `allow`,
  `deny`, `public` (or the table line `public 'reason'`, which also
  documents why), `.col = viewer`, `.col != 'x'`,
  `exists t[.a, viewer, 'literal']` (a probe may name its columns:
  `exists t[id = .docId, ownerId = viewer]`), `created t[..]` (insert rules
  only: true when this mutation inserted the probed row), `and`, `or`,
  `not`. `update (old, next) <- old.x = next.x` names both images. A table
  with no rule for an effect denies it. Rules compare with `=` and `!=`
  only; the system principal consults no rules.
- **Sync** (§3) and **retain**: `retain until-revoked` (the default: a
  device drops a group's rows when it leaves the group) or
  `retain delivered-history` (it keeps what it was given).
- **Expire:** `expire at .expiresAt` (a `time ?` column with an index
  leading with it, `by byExpiresAt: expiresAt`). A row past that time is
  absent to every reader on every host from that moment, before any rule;
  the server sweeps it within a second and the deletion streams to each
  device holding it. A null time never expires. Disappearing messages
  are one field on insert, `expiresAt: now + ttl if ttl != null else
  null` with `ttl: int ?`; nothing else to write. A `maintain` over an
  expiring table counts a row until the sweep removes it (exact within a
  second), while a read of the row is null at once.

### Maintains

`maintain counts: count messages by conversationId` (or `maintain totals:
sum posts of score by authorId`, over an `int`, `decimal` or `money`
column) keeps an aggregate table the engine writes. A program reads it by
group and gets **the number**: `counts[conversationId]` and
`counts[.conversationId]` in a shape are an `int`, 0 when the group has no
row. (On the wire and on a device the table's rows are `{ id, <by
columns>, value }` with the group's canonical key as the id; that shape
only matters to sync.) It takes one `read` rule and inherits the source's
`sync` when it groups by the audience columns; it is written only through
its source rows.

### Shapes and helpers

`shape card = { id, name, owner: .ownerId }` names a shape; `row card` and
`page card` use it, and `{ ...card, extra: 1 }` spreads its fields into
another. `fn isBrief(ttl: int ?): ttl != null` is a helper expression and
`proc stamp(roomId: rooms):` a helper block (a mutation's statements),
each expanded where it is called (`isBrief(ttl)`; `stamp(r.id)` as a
statement), at most eight levels deep.

### Queries, mutations and jobs

- **Arguments** are typed like columns; `c: cursor ?` is an opaque page
  cursor. An omitted optional argument reads as null.
- **Reads:** `t[key]` (one row by a unique key, null if absent or
  hidden), `t[key] ! else CODE` (or refuse), `exists t[key]`,
  `t[prefix] first N by index` (ascending; `t first N by index` is the
  whole table's page), `t[prefix] after c last N by index` (descending,
  from a cursor; the modifiers come in that order), `merge t [after c]
  first N by index:` with `[lane]` lines (one ordered page over several
  prefixes; a lane may be `[f.col] for f in t[prefix] first N by index`;
  uniform lanes with a non-nullable unique index or an index ending in
  `id` read one head per lane, then advance the winning lanes; other
  lanes read a page each; `check` notes a merge past 50 lanes), `walk
  t[seed] up .parentId depth 8` (a bounded list of rows). A key may name
  its columns: `t[a = x, b = y]`.
- **Shapes:** `{ *, author: users[.authorId], count: counts[.conversationId] }`
  after a page, a list, a row or an object; `.` is the row; `*` spreads its
  columns; a point read inside a shape is null for a hidden row. A shape is
  the only projection.
- **Writes:** `insert t { fields }` (returns the row; the id is minted
  unless given as `id: new` or an id you hold), `insert t { .. } if
  absent` (null on a unique clash), `update t[key] { patch }` (`if .col =
  expected` makes it conditional, refusing `E_CONFLICT` with the current
  row; `NOT_FOUND` when the row is missing), `upsert t[key] { fields }`,
  `delete t[key]`; the key is an id, a row you hold, or a full unique key.
  A final write is the implicit return; bind it to use it (`row = insert
  ..`). Writes check the rule, unique indexes, caps, immutables, text
  formats and `after insert`; any refusal rolls the whole mutation back.
- **Statements:** `x = expr` (a local binds once; there is no
  reassignment), `(q, r) = divmod(a, b)`, `(lo, hi) = sorted(a, b)`,
  `require cond else CODE`, `if:` / `else:` (no `else if`: nest), `for x
  in domain:` over a page, a bounded list, `range(a, b)` (integer
  literals) or `tokens(text)`, `break`, `return [value]`, a `proc` call,
  and a write. Values: `viewer`, `now`, `new` (an id, mutations only),
  `count(page | list)`, `sum(page, .x)`, `sum(list)`, `min(a, b)`, `max(a,
  b)`, `slice(text | list, start, end)`, `sort(list, 'col', '-col')`,
  `tokens(text)` (the @mentions, at most 64), `share(amount, list,
  member)`, `a ?? b`, `a if cond else b` (the arm not taken is never
  evaluated; `x != null` as the condition narrows `x` in the taken arm).
  There is no `/` or `%`: `divmod` binds both parts at once, so a
  remainder is never dropped unread. There is no string concatenation:
  store the parts, the client formats. A bare `return` returns null.
  `=` and `!=` are total (null equals null); `<` and friends need present
  operands — narrow with `if x != null:` or `x ! else CODE`. `not` binds
  tightest: `a != b`, not `not a = b`.
- **Refusals** a program raises with `require .. else CODE` reach the
  client as `{ code: "CODE", family: "rule", rule: "CODE", .. }`; `CODE` is
  UPPER_SNAKE and never starts with `E_`.
- A mutation may loop over a page only when it is one complete
  schema-capped group (`cap N by cols` and `first N`); anything wider is a
  job's `chunk` (`E_STRUCTURAL_FANOUT` says so).

### Jobs and schedules

```quarry
table invites:
  inviteeId: principal
  sentAt: time
  reminded: bool
  by byInvitee: inviteeId, id
  read <- .inviteeId = viewer
  insert <- deny
  update <- deny
  delete <- deny

job remind(periodStart: time, periodEnd: time):
  chunk i in invites first 100 by byId:
    if i.sentAt >= periodEnd:
      break
    if not i.reminded:
      update invites[i.id] { reminded: true }
schedule remindDaily every 1d at 08:00: remind          -- or: every 2m
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
1h`, `every 1d at 08:00`; the shortest period is 1m), exactly once per
boundary across restarts, passing `periodStart` and `periodEnd` when the
job declares them (and nothing else); a schedule first seen fires from
its next boundary. `snapback4 run <job> '{..}'` runs one here and now.
Jobs are not on `api.ts`.

### The meter

Nothing is priced at compile time. As a program runs, the meter counts
examined rows, index entries, rule probes, steps, heap bytes, output
bytes and rows written against ceilings (8,192 rows examined, 16,384
index entries, 8,192 probes, 1,000,000 steps, 16 MiB heap, 1 MiB output,
1,024 rows written per mutation; a job's chunk may examine 16,384 rows
and write 8,192). A query past a ceiling returns what it found with
`complete: false`; a mutation aborts with `E_BOUND` naming the ceiling
and the site. `snapback4 check --cost` prints each site's structural
class; `snapback4 test` prints the numbers on your data.

A page whose read rule the prefix does not decide (the rule reads a
column the scan does not pin) is never `complete`: the device cannot tell
"no more" from "more you may not see". Scan by an index that leads with
the rule's columns, or read the page on the device (§4), where the
partition holds exactly what the viewer may read. `check` says so
(`N_NEVER_COMPLETE`), as it notes a query page returned without a cursor
(`N_NO_CURSOR`), a synced table whose groups can grow with no horizon
(`N_NO_HORIZON`), and a merge past 50 lanes (`N_WIDE_MERGE`).

## 3. Sync: the viewer's partition is the unit of sync

```text
sync public [last N by index]                    everyone holds the same rows
sync to .col [last N by index]                   each row reaches the principal in .col
sync to t[.a, .b] [by .col] [last N by index]    each row reaches every principal with a
                                                 row in t whose (a, b) match; `by .col` names
                                                 the recipient column when t has several
```

The read rule must be exactly the audience — `public`, `.col = viewer` or
`exists t[.a, .b, viewer]` — so a device never holds a row it may not read,
and never misses one it may. A second disjunct or an extra conjunct is a
compile error with the rewrite. The target table needs a unique index
over `(a, b, principal)` and an index leading with `(principal, a, b)`.
The horizon `last N by index` bounds what a device acquires per group;
older rows are online-only, and a device's read past them says
`complete: false`. Joining a group delivers its rows; leaving it delivers
one scope tombstone, and the table's `retain` says what the device keeps.
A table with no horizon delivers every row of every group the device
holds, at every cold start, as the table grows: a public table of posts,
or a group's receipts, is soon the whole cold start. `check` notes such a
table (`N_NO_HORIZON`) unless the group cannot grow (one row per group, or
a `cap` over it); give a growing table a horizon (`last 500 by <index>`:
the newest N per group stay on the device, the rest are online and a
local read past them says `complete: false`). A snapshot arrives in pages
(the client asks for 4,000 events at a time; the wire's default is 2,000
and its ceiling 10,000), each applied in its own transaction, so a large
partition costs a device no more memory than one page; in Node, open the
SQLite store (`openSqlite(nodeSqliteDriver(new DatabaseSync(path)))`) for
anything larger than a test, since the memory store holds every row on
the heap. What it keeps under `delivered-history` it can still read
locally through a query without a membership `require` (the server
refuses the same query once the membership is gone, so a "history" query
answers on the device and is empty online). A table without `sync` is
online-only: a query that reads one runs on the server, and is `complete:
false` on a device with no link.

### Feeds: fan out on write, read one page

A feed can merge the followed accounts' ordered lanes. Uniform lanes with
seekable indexes read one head each, then advance only the winning lanes;
lane discovery, rule probes, lookahead and expired rows still consume the
meter (`N_WIDE_MERGE` describes the work). For frequent reads over many
accounts, move that work to writes: write each reader's entry when the post
is made, sync the entries to the reader, and read one page:

```quarry
use identity
use personas alice, bob

table posts:
  authorId: principal
  body: text <=500
  at: time
  by byAuthorTime: authorId, at, id
  public 'posts are public'
  insert <- .authorId = viewer

table follows:
  followerId: principal
  followedId: principal
  bucket: int                     -- assigned by the app; bucket 0 receives immediate delivery
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  by byFollowedBucket: followedId, bucket, followerId
  cap 1000 by followedId
  cap 200 by followedId, bucket
  public 'follows are public'
  insert <- .followerId = viewer
  delete <- .followerId = viewer

table feed:                       -- one row per reader per post
  readerId: principal
  postId: posts
  authorId: principal
  at: time
  unique byReaderPost: readerId, postId
  by byReaderTime: readerId, at, id
  read <- .readerId = viewer
  insert <- .authorId = viewer
  sync to .readerId last 200 by byReaderTime

table fanouts:                    -- the work still to do: a post's readers outside bucket 0
  postId: posts
  authorId: principal
  at: time
  read <- deny
  insert <- .authorId = viewer

mutation createPost(body: text <=500):
  p = insert posts { authorId: viewer, body, at: now }
  insert feed { readerId: viewer, postId: p.id, authorId: viewer, at: now }
  for f in follows[viewer, 0] first 200 by byFollowedBucket:
    insert feed { readerId: f.followerId, postId: p.id, authorId: viewer, at: now }
  insert fanouts { postId: p.id, authorId: viewer, at: now }
  return { id: p.id }

job fanOut():
  chunk w in fanouts first 5 by byId:
    for f in follows[w.authorId] first 1000 by byFollowed:
      insert feed { readerId: f.followerId, postId: w.postId, authorId: w.authorId, at: w.at } if absent
    delete fanouts[w.id]
schedule fanOutEveryMinute every 1m: fanOut

query following(c: cursor ?):
  return feed[viewer] after c last 20 by byReaderTime { *, post: posts[.postId] }
```

The app assigns followers to buckets of at most 200. The mutation covers
all of bucket 0, a complete schema-capped group; a first-200 slice of a
larger group is refused. The job covers the whole account, capped at
1,000 followers, with `if absent` making its pass idempotent over what the
mutation wrote. Larger audiences use a separate lane their readers merge
on read. The entries sync to each reader; `following` joins `posts`, an
online-only table here, so it answers on the server — carry the columns
the reader renders on the entry itself to answer on the device. The whole
card: `snapback4 guide feeds`.

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
memory in Node, SQLite on Expo — §7), syncs the viewer's partition, runs
every query locally over it, queues every mutation durably and predicts
its rows, and follows the server's stream for the rest. It keeps the
compiled backend in the replica too, so a device that starts with no
network opens on what it holds (`link()` is `"offline"`, reads carry
`fresh: false` and `since`) and catches up when the link returns; only a
device that has never synced needs the server to open. Its options:
`url`; one of `persona` (development), `session` (from `snapback4/auth`,
kept and restored by the client), or `guest: true` (mint one when none is
kept); `store` (`"indexeddb"`, the default where IndexedDB exists;
`"memory"`, the default elsewhere; or an opener `{ open(name, schema) }`
— §7); `sessionStore`; `fetch`; `waitSeconds`. Creation rejects with an
`Error` when guest sign-in fails, when no session is available and `guest`
is not set, or when the server is unreachable and the device holds no
backend. It has `query(op, args) → Read`, `observe(op, args) →
{ getSnapshot(), subscribe(listener) → unsubscribe, close() }` (a live
read; React's `useSyncExternalStore` shape), `mutate(op, args) → Write`,
`upload`, `asset`, `assetSource` (assets, below), `link()`, `onLink`,
`viewer()`, `session()`, `onSession`, `signOut()`, `sync()`, `replica`,
`close()`. After `signOut()` the client is closed and `session()` is null,
as it is once the server refuses the session: anything that keeps the
token — a native image header, a presence lease — takes it from
`onSession` (`useSession` in React) and stops when it is null, so nothing
reads a token after sign-out. A query over a table without `sync` runs on
the server when online and is `complete: false` offline. The online client
(`createClient`, synchronous) takes `url` with `persona`, `session` or
`token`, plus `fetch` and `waitSeconds`, and has the same card without a
store or `replica`; without credentials its link is `"signed-out"` and its
reads are `E_AUTH`.

### The card

Every word a screen reads is on the card (`snapback4/contract`):

```ts
type Read<T> =
  | { data: T; complete: boolean; fresh: boolean; since?: number; next?: Cursor | null }
  | { loading: true }
  | { denied: Refusal };
type Write = { state: "pending"; id } | { state: "sent"; id; seq } | { state: "failed"; id; why: Refusal };
type Refusal = { code: string; family: string; message: string; site?: string; rewrite?: string; guide?: string; rule?: string; retryable?: boolean };
type Link = "online" | "offline" | "signed-out";
```

`complete` says this is everything the query can answer: false when the
meter cut the page, when a scan's read rule is not decided by its prefix
(§2, the meter), when a page declared without a cursor had more rows than
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
since nothing queues it. `family` is `input`, `schema`, `auth`, `rule`
(your `require` codes, with `rule` naming the code), `constraint`,
`bound`, `op`, `asset`, `prediction`, `generation` or `store` from the
engine, and `link` or `client` from the client itself. `isReady`,
`isLoading`, `isDenied` narrow a `Read`.

### React

```tsx
import { SnapbackProvider, useClient, useQuery, usePage, useMutation, useLink, useViewer, useSession, useAsset } from "snapback4/react";

<SnapbackProvider client={client}>...</SnapbackProvider>
const inbox = useQuery(api.inbox, {});                              // Read<...>
const { items, hasMore, loadMore, read } = usePage(api.thread, { conversationId });
const send = useMutation(api.send);   // send.run(args) → Write; send.last (the latest Write); send.inFlight
const link = useLink();               // "online" | "offline" | "signed-out"
const viewer = useViewer();           // the principal, or null
const session = useSession();         // the local client's session, null once it ended
const client = useClient();           // the provided client
```

`useQuery` observes: it re-renders when a sync or a local prediction
touches the query's tables. `usePage` follows `next` across pages; it
supplies the query's cursor argument itself, which must be named `c`
(`c: cursor ?`).

### Assets

```ts
const uploaded = await client.upload(file);            // Blob | ArrayBuffer | Uint8Array
if (uploaded.ok) await client.mutate(api.sendPhoto, { conversationId, photo: { id: uploaded.asset.id } });
const photo = useAsset(message.photo?.id);             // { status: "loading" } | { status: "ready", url, type } | { status: "denied", why }
```

An `image <=N` or `video <=N` column holds an upload: the client sends
the bytes first (`upload` → `{ ok: true, asset: { id, type, bytes, width,
height, duration } }` or `{ ok: false, why }`; the server sniffs JPEG,
PNG, WebP and MP4 and refuses the rest with `E_ASSET_TYPE`, and anything
over the largest column's bound with `E_ASSET_TOO_LARGE`), then places
`{ id }` in the mutation. Inside the mutation the argument already
carries the facts the server established, and the row carries them.
Every fact key is present; `width` and `height` are null for video,
`duration` for images. Bind `duration = clip.duration`, then `require
duration != null else DURATION_UNKNOWN` before `require duration <=
60000 else TOO_LONG`. One asset, one home: your own upload, placed once
(`E_ASSET_UNKNOWN`, `E_ASSET_PLACED`). Serving is the home row's read
rule: `client.asset(id)` fetches the bytes under the viewer's credentials
and resolves `{ url, type, bytes, revoke }` — a blob URL, and `revoke()`
for when the screen is done — or `{ denied }` (`useAsset` in React
revokes on unmount; `client.assetSource(id)` gives `{ uri, headers }`
for native image and video views); a row that is deleted, whose column
is cleared, that expired, or that the viewer may not read answers
`E_ASSET_UNKNOWN`. A column declared `image <=N once` serves one view per
principal: the second is `E_ASSET_VIEWED`, and the bytes are never cached
anywhere (the sender is never counted). Uploads are online only; there is
nothing to queue.

### Sign-in (`snapback4/auth`)

`guest(url)`, `signup(url, email, password)`, `login(url, email,
password)` return `{ ok: true, session }` or `{ ok: false, why }`
(each takes an optional final `fetch`); `logout(url, token)` ends one. A
session is `{ principal, kind: "guest" | "user", token, expiresAt }`;
pass it to `createLocalClient({ url, session })` once and the client
keeps it (`localStorage` on the web, falling back to memory when it
throws; memory otherwise; or the `sessionStore` you pass — three methods
`get`, `set`, `delete`; `expo-secure-store` fits, with the key made
filesystem-safe as in §7). A password is eight characters or more. The
schema opts in with `use identity` (guests and password accounts),
`use identity guests` or `use identity password`; without it the `/auth`
routes refuse with `E_AUTH`. `snapback4 dev` also admits personas;
`snapback4 serve` (a release) admits tokens only.

### The mock (`snapback4/mock`)

`createMockClient({ viewer, tables, ops })` is a client with the same
card over in-memory tables, for component tests: `ops` is `{ queries:
{ name: (tables, args, viewer) => value | page(rows, next) }, mutations:
{ "table.verb": (tables, args, viewer, mint) => ids | Refusal } }` — a
mutation named `t.verb` marks the rows of table `t` pending until
`settle()` commits it (`commitDelayMs` and an initial `link` are options);
`setLink("offline")` flips the link; `upload` accepts anything as a 1×1
PNG and `asset` is always denied.

## 5. Development

- **`snapback4 dev [--port N] [--no-watch] [--fresh]`** serves
  `snapback/*.q` on `127.0.0.1:4400`, recompiling and re-adopting on
  every save (the watcher polls every 400 ms; a save with problems keeps
  the previous generation serving and prints the diagnostics); the store
  lives in `.snapback4/store.sqlite` and persists across runs, and
  `--fresh` uses one in memory that dies with the process (acceptance
  scripts start from nothing). `dev` writes `api.ts` on start and on
  every adoption, and refuses a store that belongs to a deployment
  (`E_GENERATION`). Personas (`use personas ..`) sign requests from the
  same machine with the `x-snapback-persona: alice` header (the client's
  `persona: "alice"`), acting as `dev:alice`.
- **`POST /seed`** (dev only, same machine) takes `[{ "table": "t",
  "row": { "id": "..", .. } }, ..]`, writes the rows as the system
  principal in one commit (rules bypassed; validation, constraints,
  aggregates and sync apply) and answers `{ "seeded": N }`.
- **`snapback4 run <op> ['<json args>'] [--as alice] [--json]`** runs one
  operation against the local store (the persona defaults to alice) and
  prints the result, the meter and, for a mutation, the partition events;
  a job runs whole as the system (`--as` is ignored) and prints its run.
  Exit 1 on a refusal or a parked job, 2 on an engine error.
- **`snapback4 test [--fixture dir] [--as persona]`** loads a fixture
  (one `<table>.jsonl` per table; a file for an unknown table is
  skipped) into a fresh store in memory (without a fixture, the project's
  dev store), runs every query as each persona with arguments derived
  from the data (a reference is the table's first row, a principal the
  persona, a text the shortest that fits, an int 0, a time now, a bool
  false, an enum its first variant, an optional or a cursor null), prints
  the meters beside the ceilings and the arguments it used, and names any
  query it could not run (an `id`, list, json, bytes, image or video
  argument cannot be derived). A query's own `require` refusing a
  derived argument (the persona is not in that group) is reported, not
  counted as a failure; run it with your arguments to see its meters.
- **`snapback4 check [--cost] [--json]`** compiles, writes
  `snapback/generated/api.ts` (`Rows`, `Ops`, `api`), and prints every
  diagnostic with its site and rewrite; `--cost` adds each site's
  structural class. **`snapback4 types`** writes `api.ts` alone.
- **`snapback4 why <E_CODE | op | table>`** explains a refusal code, an
  operation's arguments, result and cost, or a table's rules, sync line,
  expire column and indexes; **`data <table> [--limit N]`** prints rows
  (50 by default); **`doctor [--json]`** says what is in place: the
  store, its size, schedules and their last boundary, the last job runs;
  **`guide [keyword]`** prints the language card (`snapback4 guide`, or
  `guide language`) or one card: language, types, indexes, rules, sync,
  expire, assets, reads, shapes, writes, programs, jobs, feeds, bounds,
  refusals, personas (`guide <E_CODE>` explains a code); **`--version`**
  prints the binary's version, which equals the package's. Every flag may
  be spelled `--flag=value`.

### The wire

The client is the intended surface; the wire is plain JSON for anything
else. `GET /` is the server's card (`{ snapback4, generation, seq, ops:
[{ name, kind }], tables: [{ name, sync }] }`); `GET /api.ts` the
generated TypeScript; `GET /schema` the compiled backend. `POST /q/<op>`
with `{ "args": {..} }` answers `{ data, complete, seq, next, tables,
viewer }` or `{ denied }`; `POST /m/<op>` with `{ "id", "args",
"newIds" }` answers `{ state: "sent", id, seq, result }` or `{ state:
"failed", id, why, current? }` (a client-minted `id` makes the write
apply at most once, and a replay adds `replayed: true`; `current` is the
live row on `E_CONFLICT`); a job is refused over the wire (`E_OP`).
`GET /sync?from=0` is the snapshot, paged: `{ snapshot: true, events:
[{ table, kind, id, data }], watermark, more, next, generation,
acknowledged }`, continued with `after=<next>` (`limit` up to 10,000;
2,000 by default), and `pending=[ids]` (at most 256) reports which
queued writes the server has applied; `GET /sync?from=W` (or `stream=1`)
is the stream from a watermark: `{ snapshot: false, events: [{ seq,
table, kind, id, data }], watermark, more, generation, acknowledged }`.
`GET /changes?since=S&wait=N` answers `{ seq, tables, generation }` when
a commit lands or after N seconds (25 at most; 0 answers at once; at most
500 commits are summarised; no credentials needed). `POST /assets` (the
file's bytes as the body, 64 MiB at most) answers `{ asset }`; `GET
/assets/<id>` serves them (404 hidden or gone, 410 viewed; `Range`
works; `Cache-Control: private, no-store` for `once`, else immutable).
`POST /auth/guest` (`{}`), `POST /auth/signup` and `/auth/login`
(`{ "email", "password" }`) answer `{ "session": { principal, kind,
token, expiresAt } }` or `{ "denied": Refusal }`; `POST /auth/logout`
with the bearer token answers `{ "ok": true }`. Authorization:
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
  release on the shared store on `0.0.0.0:4400`, tokens only (a persona is
  refused `E_AUTH`; so is `/seed`). It symlinks the release's store to
  the directory's, so the filesystem must support symlinks. TLS is a
  proxy's job.

## 7. Expo

The same client runs on React Native with SQLite as the store:

```ts
import * as SQLite from "expo-sqlite";
import * as SecureStore from "expo-secure-store";
import { createLocalClient } from "snapback4/local";
import { expoSqliteDriver, openSqlite } from "snapback4/replica";

const safe = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, "_");   // store and session names carry the URL and the viewer
const client = await createLocalClient({
  url, guest: true,
  store: { open: async (name, schema) => openSqlite(expoSqliteDriver(await SQLite.openDatabaseAsync(`${safe(name)}.db`)), schema) },
  sessionStore: { get: (k) => SecureStore.getItemAsync(safe(k)), set: (k, v) => SecureStore.setItemAsync(safe(k), v), delete: (k) => SecureStore.deleteItemAsync(safe(k)) },
});
```

`snapback4/react` works unchanged. (`node:sqlite` fits the same driver
through `nodeSqliteDriver`; `snapback4/replica` also exports the memory
and IndexedDB stores and the key encoding.)

### The native module

The same interpreter the server runs, as a Rust module the host links —
Expo's Swift and Kotlin, Exact2's Apple and Linux hosts — owning the
partition in its own SQLite, applying the stream, keeping the outbox,
answering queries and predictions. The JavaScript client that remains,
`snapback4/native`, keeps the session, the link, the transport and the
observation of reads; the card is unchanged, without `replica`:

```ts
import { createNativeClient, type NativeOpener } from "snapback4/native";

const client = await createNativeClient({ url, guest: true, sessionStore, native, dataDir });
```

`native` is how the host opens its device: `open(path, backend)` gives
back `{ call, close }` — one JSON call, `call({ op, ... })`, into the
module, and `close()` to release it (`backend` is `GET /schema`'s JSON,
or null to open on the one the device kept, which is how a cold start
with no network opens). The client probes the module first and rejects
with `E_NATIVE_VERSION` when the native binary predates the JavaScript
client (reloading JavaScript does not update the module; rebuild). The
module speaks the same call over a C ABI
(`crates/snapback4-device/include/snapback4.h`: `sb4_open`, `sb4_call`,
`sb4_free`, `sb4_close`) and, for a Rust host, through
`snapback4_device::ffi::call`; `snapback4 device <store> [backend.json]`
runs it as a process, one JSON line each way, and `processCore(binary,
spawn, writeFile)` from `snapback4/native` is the opener over that
process, which is how the Node tests drive the real module. Measured:
1.7 MB linked on iOS, SQLite included; the same interpreter as wasm is
194 KB gzip, so the web keeps the TypeScript twin above.

For Expo the module is the `snapback4-expo` package: `nativeDevice` is
the opener, `documentDirectory()` the place for stores, and
`nativeAvailable()` says whether this build carries it, so an app opens
the Rust device in a development or production build and the TypeScript
tier above in Expo Go, with nothing above the choice changing;
`EXPO_PUBLIC_SNAPBACK_TRACE=1` logs every call.

**Proving it on the device.** The package's own simulator witness
(`witness/expo.mjs` in the repository, run on a booted iOS simulator
against a real `snapback4 dev`, in Expo Go on the TypeScript tier and
with `WITNESS_DEV_CLIENT=1` on the Rust module in a development build)
records the same five things on either: a cold sync, local reads and a
send, a reopen that finds the rows, a cold start with the server
unreachable that opens on what the store holds and answers with
`fresh: false`, and two writes composed offline that survive a restart of
the app still offline and flush in order on reconnect. On the module the
cold sync of 303 rows takes 31 ms against the TypeScript tier's 199. An
app proves the same the same way: gate the client's `fetch` option to
model the link (the server never has to die), close and reopen the
client to model a restart, and read the outcomes off the card.

## 8. Not in this release

Word search (`tokens(text)` is the @mentions of a text, not an index:
search over synced rows on the device, or by a prefix index), effects
(`effect x from m` and `emit x payload` are accepted and queued in the
server's `_outbox`, and nothing delivers them: write the fact to a table
and let a job or a reader act on it), platform binaries other than
darwin-arm64 (build from source with `cargo build --release -p snapback4`
and set `SNAPBACK4_BIN`), an Android module. If the package cannot
express something, the diagnostic names the term; record the gap and
move on.
