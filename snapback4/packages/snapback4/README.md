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
  `by index` names one when two match. `by name: scope, words(text cols),
  at, id` is a words index: one entry per distinct word of the named text
  columns, read with `matching` (Search, below) and nothing else.
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
  only; the system principal consults no rules. A unique-key or id collision
  with a row the writer cannot read returns the generic `E_RULE`, including
  insert-if-absent and upsert; only a readable collision names its key.
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
  t[seed] up .parentId depth 8` (a bounded list of rows), `t[scope]
  matching q after c last N by wordsIndex` (word-prefix search; Search,
  below), `connected[p]` (open connections; `exists connected[p]` tests;
  Presence, below). A key may name its columns: `t[a = x, b = y]`.
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
  `emit effect { payload }` (Effects, below), and a write. Values: `viewer`, `now`, `new` (an id, mutations only),
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

### Native jobs and reads

```quarry
job rescore(): native                    -- the body is snapback/native/, in Rust
schedule rescoreEvery every 5m: rescore  -- fired like any job
query personalize(first: int): native    -- a read: on the server as the viewer, on a device over its rows
```

A job whose body is not Quarry but the app's own Rust (LLP 3000.005), for
the scoring half of a feed and anything else that wants floats, vectors,
real loops and a typed schema without putting them into Quarry.
`snapback/native/` is a Cargo package the app owns — `crate-type =
["cdylib"]`, its own `[workspace]`, a dependency on `snapback4-native` —
and `snapback4 check` writes `snapback/generated/native.rs` (a constant
per table, index and maintain; a `serde` struct per table), builds the
package for `wasm32-unknown-unknown` into `snapback/generated/native.wasm`
(cold about ten seconds, then a cargo no-op), and refuses if a declared
job is not one the module implements. `dev` rebuilds on every save under
`snapback/`; `deploy` ships the module with the release; `run <job>` runs
it here; `doctor` says whether the module and the toolchain are in place.

```rust
// snapback/native/src/lib.rs
use snapback4_native::{Chunk, Ctx, Next, Order, Result, from_row, json, row_of};
mod schema { include!("../../generated/native.rs"); }
use schema::*;
snapback4_native::module! { jobs: [rescore], reads: [personalize] }

fn rescore(ctx: &Ctx, chunk: &Chunk) -> Result<Next> {
    let page = ctx.scan(tables::POSTS, indexes::posts::BY_ID, &[], Order::Asc, 100, chunk.state.as_ref())?;
    for row in page.rows {
        let post: Posts = from_row(row)?;
        let votes = ctx.maintained(maintains::POST_SCORE, &[json!(post.id)])?;
        let age_hours = (chunk.now - post.at) as f64 / 3_600_000.0;
        let score = (votes as f64 * 10.0 - age_hours.powf(1.5)).round() as i64;
        ctx.upsert_by(tables::RANKED, indexes::ranked::BY_POST, &[json!(post.id)], row_of(&Ranked { id: String::new(), post_id: post.id, score, at: post.at })?)?;
    }
    Ok(match page.next { Some(state) => Next::Again(state), None => Next::Done })
}

fn personalize(ctx: &Ctx, args: &Json) -> Result<Json> {
    let viewer = ctx.viewer()?;
    let page = ctx.scan(tables::RANKED, indexes::ranked::BY_SCORE, &[], Order::Desc, 50, None)?;
    let mut items: Vec<(i64, Json)> = Vec::new();
    for row in page.rows {
        let ranked: Ranked = from_row(row)?;
        let seen = ctx.lookup(tables::SEEN, indexes::seen::BY_READER_POST, &[json!(viewer), json!(ranked.post_id)])?.is_some();
        items.push((ranked.score - if seen { 1000 } else { 0 }, json!({ "postId": ranked.post_id, "seen": seen })));
    }
    items.sort_by_key(|(weight, _)| -*weight);
    Ok(Json::Array(items.into_iter().map(|(_, item)| item).collect()))
}
```

**A native read is the twin** (LLP 3000.005 §9): `query name(args):
native` runs the same Rust on the server as the viewer — every `Ctx` read
under the viewer's rules and the read meter, `complete` from the meter —
and on a native device (the Expo module, Exact2's hosts, the `snapback4
device` process) over the rows it holds, with the device's words (a page at
the horizon is `complete: false`); the same rows give the same answer,
floats included (`wasmi` is built deterministic). The client fetches the
module from `/native.wasm` once per digest (`/schema` names it) and
installs it on the device, which keeps it, so a cold start offline answers
native reads too. The web device carries no wasm host (with one its wasm
doubled, to 648 KB gzip) and says so; the client then asks the server, as
it does for a device without the module. A native read cannot write,
returns no cursor (page by your own arguments) and returns the value model
(ints, not floats: round a score); `api.ts` types its result `unknown`. A
mutation cannot be native: a device predicts Quarry and the server replays
it.

One chunk per call, one transaction per chunk, under the job ceilings: the
job returns `Next::Again(state)` to be called again with that state after
the chunk commits — a scan's `next` is the natural state, so a crash
resumes at the next page as a Quarry `chunk` resumes by its cursor — or
`Next::Done`. Every `Ctx` read and write is the interpreter's own on the
chunk's transaction (`get`, `lookup`, `maintained`, `scan`, `mint`,
`insert`, `insert_if_absent`, `update`, `upsert`, `upsert_by`, `delete`):
rules pass for the system, validation, constraints, maintains and
partition events apply, the meter counts, and so the ordinary query and
`sync` serve what the job wrote. The first refusal — a bound, a
constraint, a bad value — parks the job with it (`doctor` lists runs); a
panic parks it as `E_NATIVE_TRAP` with the panic's text; 2,000,000,000
units of fuel per chunk (about 90,000 per host call) is the step ceiling,
so the row ceilings bind first. The module imports one host function and
nothing else: no clock, no randomness, no network — `chunk.now` is the
host's — and a native job therefore runs under the simulator like any
job. Quarry still declares the table, its rules and its `sync`; a query
or mutation cannot be native, because a device predicts Quarry and the
certificate reads it. Anything that needs the network stays outside and
writes into a table the job reads.

### Search

```quarry
table conversations:
  title: text <=120
  read <- exists memberships[.id, viewer]
  insert <- allow
  sync to memberships[.id]

table memberships:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  unique byConversationPrincipal: conversationId, principal
  by byConversationPrincipalRole: conversationId, principal, role
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer, 'admin'] or created conversations[.conversationId]
  sync to memberships[.conversationId]

table messages:
  conversationId: conversations
  authorId: principal
  body: text <=4000 ?
  caption: text <=200 ?
  at: time
  by byConvTime: conversationId, at, id
  by byConvWords: conversationId, words(body, caption), at, id
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  sync to memberships[.conversationId] last 500 by byConvTime

table profiles:
  principal: principal
  displayName: text <=50
  handle: text <=30 format handle
  unique byPrincipal: principal
  unique byHandle: handle
  by byNameWords: words(displayName, handle), id
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer

query inChat(conversationId: conversations, q: text <=100, c: cursor ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return messages[conversationId] matching q after c last 50 by byConvWords

query people(q: text <=100, c: cursor ?):
  return profiles matching q after c first 20 by byNameWords
```

`words(cols)` is an index component: one entry per distinct word of the
named text columns, folded the same way on every host (NFC, lowercase, a
word boundary at every character that is not a letter or a digit). The
columns before it scope the search (a chat); the columns after it order
the page and end in `id`, so a cursor continues it. A words index serves
`matching` and nothing else, and cannot be unique. `matching q` folds the
text the same way: the first term selects every word it is a prefix of
("cof": coffee, coffers, cofounder — one seek each, at most 32 words,
else `complete: false`) and merges them as ordered lanes into one page,
newest first when the index says so; every further term must be a prefix
of some word of the row ("cof car" finds "COFFEE for Carol"). Mid-word
text never matches; an empty search matches nothing; an expired row is
gone at once; an edit re-tokenizes. A scope the rule decides costs one
verdict per word. An unscoped words index (`by byWords: words(body), at,
id`) under a per-chat rule checks the rule per row and is never
`complete` (`N_NEVER_COMPLETE`): search across every chat on the device
(§4), where the partition holds exactly what the viewer may read, offline
too.

### Effects

```quarry
effect notify

table memberships:
  conversationId: id
  principal: principal
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer]

table messages:
  conversationId: id
  authorId: principal
  body: text <=4000
  at: time
  by byConvTime: conversationId, at, id
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]

mutation send(conversationId: id, body: text <=4000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  msg = insert messages { conversationId, authorId: viewer, body, at: now }
  for m in memberships[conversationId] first 50 by byConversationPrincipal:
    if m.principal != viewer and not exists connected[m.principal]:
      emit notify { targetUserId: m.principal, chatId: conversationId, preview: slice(body, 0, 80) }
  return { id: msg.id }
```

The data plane never calls out. `emit name { payload }` in a mutation or
a job keeps the payload durably in the same commit as the rows (a
refused mutation emits nothing), and a worker — a process the
application runs with a service token, §4 — performs it and settles it.
A failure retries with backoff up to eight attempts; a worker that dies
loses its lease and the effect is claimed again; two workers never hold
one effect. `snapback4 doctor` counts them. A scheduled job that emits
once per period is the digest recipe.

### Presence

`connected[p]` is how many connections a principal holds open on the
server now — a device following the stream keeps a long poll open, and
one that answered a moment ago still counts for 35 seconds — and `exists
connected[p]` is the test. It is not a table: nothing syncs, nothing is
written. A mutation reads it to notify only those with no connected
client (Effects, above); a query reads it for an online mark. On a
device the word is unknown: a query that reads it is `complete: false`,
and a mutation's prediction reads everyone as connected, the server
deciding when the write arrives.

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
Every insert-rule branch on that audience table must prove the caller already
has the matching grant, or that the mutation created the referenced group;
`.principal = viewer` alone is a self-grant and fails `check`. Audience group
and recipient columns must be immutable or guarded on update. This also covers
insert-if-absent and upsert. The horizon `last N by index` bounds what a device acquires per group;
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
of 2,000 events, each staged in its own transaction and published
together with the last, so a device never shows half a snapshot.

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
the reader renders on the entry itself to answer on the device. At 500
follows the reader's page examines the rows it examines at 5: one prefix
of the reader's own lane. A ranked feed for a community keeps one shared
candidate set instead: a job on a schedule scores the pool from maintains
into a public `ranked` table every device holds, the viewer's own signals
(`seen`, votes, a ranker's `affinity`) sync to the viewer, and the device
composes the two; the external ranker writes its per-reader word through a
service seat (`insert <- viewer = 'service:ranker'`). The whole card, both
shapes: `snapback4 guide feeds`.

## 4. The client

```ts
import { createLocalClient } from "snapback4/local";   // the local-first tier
import { webDevice } from "snapback4/web";             // the device on the web
import { createClient } from "snapback4/client";       // the online tier (no store)
import { api } from "../snapback/generated/api";

const client = await createLocalClient({ url: "http://127.0.0.1:4400", persona: "alice", device: webDevice() });
const thread = await client.query(api.thread, { conversationId });
const write = await client.mutate(api.send, { conversationId, body: "hi" });
```

The local-first client opens the device — the Rust module, the same
interpreter the server runs: as wasm on the web (`webDevice()`, the
partition in memory and kept in IndexedDB behind each call), as the
native module on Expo (§7), as a process in Node (`processDevice()` from
`snapback4/native`) — syncs the viewer's partition into it, runs every
query on it, queues every mutation durably and predicts its rows, and
follows the server's stream for the rest. The device keeps the compiled
backend too, so a device that starts with no network opens on what it
holds (`link()` is `"offline"`, reads carry `fresh: false` and `since`)
and catches up when the link returns; only a device that has never
synced needs the server to open. The client itself is the session, the
link, the transport and the observation of reads: about seventeen
kilobytes over a device of three hundred. Its options: `url`; `device`;
one of `persona` (development), `session` (from `snapback4/auth`, kept
and restored for this JavaScript runtime by default), or `guest: true`
(mint one when none is kept); `sessionStore`; `fetch`; `waitSeconds`. It
has `query(op, args) → Read`, `observe(op, args) → { getSnapshot(), subscribe(listener) →
unsubscribe, close() }` (a live read; React's `useSyncExternalStore`
shape), `mutate(op, args) → Write`, `link()`, `onLink`, `viewer()`,
`session()`, `onSession`, `refreshSession()`, `logoutAll()`, `signOut()`,
`sync()`, `close()`. A restored or provided session within 24 hours of
expiry rotates before the protected backend is fetched; a running client
schedules the same rotation. A successful rotation replaces the stored
session and the Authorization bearer before `onSession` receives it. After
`signOut()` the client is closed and `session()` is null, as it is once
the server refuses the session: anything that keeps the token — a native
image header, a presence lease — takes it from `onSession` (`useSession`
in React) and stops when it is null, so nothing reads a token after
sign-out. `logoutAll()` does the same after the server confirms every
session for the principal was revoked; an offline refusal leaves this
session in place so the operation can be retried. The online client takes
`url` with `persona`, `session` or `token`, and has the same card without a
device; applications that keep its session use `refreshSession(url,
token)` and replace the online client with the returned session.

On the web one tab is one device: a second tab on the same store opens
its own, and the writes a tab left queued when it closed are adopted by
the next device that opens the store. `webDevice({ wasm })` takes the
wasm as a URL, a Response, bytes or a compiled module when a bundler
cannot resolve the default beside the module; `webDevice({ persist:
memoryPersistence() })` keeps nothing, for tests.

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
over the largest column's bound with `E_ASSET_TOO_LARGE`). Images must have
nonzero dimensions, at most 16,384 pixels per side and 40 million pixels
total; video must have a positive duration of at most one hour
(`E_ASSET_BOUNDS`). It then places
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
principal after placement, including the uploader; an unplaced owner preview
is exempt. The second is `E_ASSET_VIEWED`. Range is refused before consuming a
once view (`E_ASSET_RANGE`); ordinary unsatisfiable ranges return 416. Every
asset response is `private, no-store`, and at most two uploads write at once
outside the engine mutex. Uploads are online only; there is nothing to queue.

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
sessions last seven days. Signup passwords are 8–1,024 UTF-8 bytes and login
passwords at most 1,024; attempts and concurrent Argon2 work are bounded by the
host. The schema opts in with `use identity` (guests and password accounts),
`use identity guests` or `use identity password`; without it the `/auth`
routes refuse with `E_AUTH`. `snapback4 dev` also admits personas;
`snapback4 serve` (a release) admits tokens only.

An application that authenticates its own accounts — a phone number it
verified, a member of its own directory — mints their sessions through a
service (below) and hands each token to that account's device, which then
talks to the server directly with `createLocalClient({ url, session })`;
the principal is the application's own name for the account
(`member:42`), outside the engine's namespaces.

### Workers and services (`snapback4/worker`)

```ts
import { runWorker, mintSession, revokeSessions, listEffects, GiveUp } from "snapback4/worker";

runWorker({ url, token, effects: { notify: async (payload, meta) => { await push(payload); return { providerId: meta.id }; } } });
const session = await mintSession(url, token, "member:42", "member", 30);
await revokeSessions(url, token, "member:42");
```

A service is a principal `service:<name>` with a bearer session of its
own: `snapback4 token --service pusher` prints it once (`--release <dir>`
for a deployment). Rules admit it like any principal (`insert <- viewer =
'service:ranker'`); with its token a worker claims what the backend
`emit`s under a lease, performs it, and settles it — a thrown handler
retries with backoff, `GiveUp` fails it at once, the returned value is
kept beside the effect — and mints or revokes the sessions of the
accounts the application authenticates itself. `meta.id` is the
idempotency key a provider should see.

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
- **`snapback4 token --service <name> [--days N] [--release <dir>]`**
  mints a service's bearer token into the project's store (or a
  deployment's) and prints it once.
- **`snapback4 why <E_CODE | op | table>`** explains a refusal code, an
  operation's arguments, result and cost, or a table's rules, sync line,
  expire column and indexes; **`data <table> [--limit N]`** prints rows
  (50 by default); **`doctor [--json]`** says what is in place: the
  store, its size, schedules and their last boundary, the last job runs,
  the effects by state and the failed ones;
  **`guide [keyword]`** prints the language card or one card: language,
  types, indexes, rules, sync, expire, assets, reads, shapes, writes,
  programs, jobs, native, feeds, search, effects, services, presence,
  bounds, refusals, personas (`guide <E_CODE>` explains a code);
  **`--version`** prints the binary's version, which equals the
  package's. Every flag may be spelled `--flag=value`.

### The wire

The client is the intended surface; the wire is plain JSON for anything
else. The server card and compiled metadata require a live principal.
`GET /` is the server's card (`{ snapback4, generation, seq, ops:
[{ name, kind }], tables: [{ name, sync }] }`); `GET /api.ts` the
generated TypeScript; `GET /schema` the compiled backend; `GET
/native.wasm` the native module when the backend has one. `POST /q/<op>`
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
`GET /changes?since=S&wait=N` requires the same principal and answers
`{ seq, tables, generation }` when a commit lands or after N seconds (25
at most; 0 answers at once; at most
500 commits are summarised). `POST /assets` (the
file's bytes as the body, 64 MiB at most) answers `{ asset }`; `GET
/assets/<id>` serves them (404 hidden or gone, 410 viewed; `Range`
works on ordinary assets, returns 416 when unsatisfiable, and is refused on
view-once assets; every response uses `Cache-Control: private, no-store`).
`POST /auth/guest` (`{}`), `POST /auth/signup` and `/auth/login`
(`{ "email", "password" }`) answer `{ "session": { principal, kind,
token, expiresAt } }` or `{ "denied": Refusal }`; `POST /auth/logout`
with the bearer token answers `{ "ok": true }`; `POST /auth/refresh`
returns a replacement session and invalidates that bearer; `POST
/auth/logout-all` revokes every session for its principal and answers
`{ "ok": true, "revoked": N }`. With a service token:
`POST /auth/session` (`{ "principal", "kind"?, "days"? }`) mints a session
for an account the application authenticated, `POST /auth/revoke`
(`{ "principal" }`) ends every session of one and answers `{ "revoked" }`,
`POST /effects/claim` (`{ "effect"?, "limit"?, "lease"?, "wait"? }`, the
last two in seconds; `wait` long-polls until something is due) answers
`{ "effects": [{ id, effect, payload, attempt, seq, at }] }`, `POST
/effects/<id>/done` (`{ "result"? }`) and `POST /effects/<id>/failed`
(`{ "error", "retry" }`) settle one (`E_EFFECT_LEASE` when this worker
does not hold it, 404 `E_EFFECT_UNKNOWN` when no such effect is queued),
and `GET /effects?state=queued` lists them; a user's token at any of these
is 401 `E_AUTH`. Authorization:
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
  release on the shared store on `127.0.0.1:4400`, tokens only (a persona
  is refused `E_AUTH`; so is `/seed`). A non-loopback literal bind requires
  `--i-understand-cleartext` and prints a warning because the socket is HTTP.
  Put a TLS proxy on the same host in front of the loopback listener: preserve
  `Authorization` and `Origin`, strip `x-snapback-persona`, restrict direct
  backend access, and rate-limit by the real client address. The binary does
  not trust forwarded address or scheme headers. It symlinks the release's
  store to the directory's, so the filesystem must support symlinks.

## 7. Expo

The same client runs on React Native over the native module — the
`snapback4-expo` package, §7.1 — in a development or production build.
Expo Go loads no custom native code and no wasm under Hermes, so an app
there runs the online tier with a session it keeps itself:

```ts
import * as SecureStore from "expo-secure-store";
import { createLocalClient } from "snapback4/local";
import { nativeAvailable, nativeDevice } from "snapback4-expo";

const sessionStore = { get: SecureStore.getItemAsync, set: SecureStore.setItemAsync, delete: SecureStore.deleteItemAsync };
const client = nativeAvailable()
  ? await createLocalClient({ url, guest: true, sessionStore, device: nativeDevice })
  : createClient({ url, session: await kept() });   // Expo Go
```

`snapback4/react` works unchanged.

### The native module

The same interpreter the server runs, as a Rust module the host links —
Expo's Swift and Kotlin, Exact2's Apple and Linux hosts — owning the
partition in its own SQLite, applying the stream, keeping the outbox,
answering queries and predictions; the wasm the web runs is the same
module over memory. A host opens its device with `open(name, backend)`
and gives back one JSON call, `call({ op, ... })`, into the module
(`backend` is `GET /schema`'s JSON, or null to open on the one the
device kept, which is how a cold start with no network opens). The
module speaks the same call over a C ABI
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

**Proving it on the device.** The package's own simulator witness
(`witness/expo.mjs` in the repository, run with `WITNESS_DEV_CLIENT=1`
on a booted iOS simulator against a real `snapback4 dev`, the Rust
module in a development build) records five things: a cold sync, local
reads and a send, a reopen that finds the rows, a cold start with the
server unreachable that opens on what the store holds and answers with
`fresh: false`, and two writes composed offline that survive a restart of
the app still offline and flush in order on reconnect; the cold sync of
303 rows takes 31 ms. The Chromium witness (`witness/idb.mjs`) proves the
same on the wasm device over IndexedDB. An app proves the same the same
way: gate the client's `fetch` option to
model the link (the server never has to die), close and reopen the
client to model a restart, and read the outcomes off the card.

## 8. Not in this release

Platform binaries other than darwin-arm64 (build from source with
`cargo build --release -p snapback4` and set `SNAPBACK4_BIN`), an Android
module, search beyond word prefixes (no stemming, relevance ranking,
phrase or mid-word matching), push delivery itself (a worker's, through
the effects above), an identity provider beyond guests, passwords,
services and the sessions a service mints, presence beyond the server's
own polls. If the package cannot express something, the diagnostic names
the term; record the gap and move on.
