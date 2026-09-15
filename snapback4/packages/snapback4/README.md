# snapback4

The scale-to-zero backend with a partition on every device. One binary
compiles a schema written in Quarry and serves it; one client holds the
viewer's partition on the device and runs the same queries there. This
package carries both: the `snapback4` CLI (the Rust binary, installed for
your platform as an optional dependency) and the TypeScript client.

```sh
npm install --save-exact snapback4 # the client, and the CLI for darwin-arm64
npx snapback4 init               # writes snapback/schema.q (and ignores .snapback4/ and snapback/generated/)
npx snapback4 check              # compiles it; writes snapback/generated/api.ts
npx snapback4 dev                # serves it on 127.0.0.1:4400, re-adopting on every save
npx snapback4 guide              # the language card; `guide <keyword>` for a card
```

For an online or Expo starter, replace `init` above with `init --online`
or `init --expo`, then run `npm install` before `check` to install the
merged dependencies. The initial exact pin matches the starter's dependency.

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
  snapback/worker.ts          optional Node worker: effects and actions (dev starts it)
  snapback/generated/api.ts  written by `check`; never edited, never committed
  src/                       your client: React on the web, React Native on Expo
```

The backend is one file (more `.q` files beside it hold modules; their
operations are named `<module>.<op>`, and every file shares one namespace
of tables, shapes and helpers); generated operations group under `api.<module>`
(`api.social.follow`, not `api.follow`). The client imports `api` from the generated
file and talks to the server through one client object. There are no
resolvers, no migrations to write, no subscriptions to manage: a table's
`sync` line says which devices hold its rows, and the client's reads run
over what the device holds.

**Two ways to run.** `snapback4 init` starts local-first: declare `sync`
and open `createLocalClient` so the device holds its partition and works
offline. `snapback4 init --online` writes a schema with no `sync` lines
and a `src/client.ts` on `createClient`. Its queries run on the server and
stay live through `/changes`, with no replica. Both tiers use the same
rules, meter, identity, assets and jobs. Add `sync` and open a local-first
client when the app needs offline data. `init --expo` adds the phone
starter, selecting the native tier when available and online in Expo Go.

## 2. Quarry

Comments start with `--`. Blocks indent with two spaces. A file holds
directives, tables, maintains, shapes, helpers, queries, mutations, actions, jobs
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
  optional (null when absent). `default <literal | now | viewer>` fills an
  omitted insert column on the writing host; an explicit value wins.
  A required literal default also fills absent columns in older rows on every host; optional columns still read null when absent.
  An enum fits `text <=N` when every variant has at most N characters and
  contains no control characters except tab, LF and CR: a
  static, total widening with no runtime conversion. If any variant exceeds
  N, use the enum type on the helper parameter instead.
- **References** are typed ids, with no implicit existence check and no
  delete cascade. The string `"null"` is an id; JSON `null` only fits an
  optional reference. When a mutation requires a visible target, write
  `require exists prompts[promptId] else PROMPT_NOT_FOUND` before its
  writes: a metered point read that refuses absent and hidden targets
  alike. Target deletion and dependent-row cleanup are the application's
  policy, expressed in mutations and rules.
- **Indexes:** `by name: cols` orders rows; `unique name: cols` also
  constrains them. A point read needs a unique index over its key;
  `exists` needs any index over its key. Named equalities covering a total
  unique key check extra columns on the one row, with no extra index; a scan needs an index whose
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
  with no rule for an effect denies it. A rule may probe existence on a maintain
  over an expiring source at one unit, but `check` refuses an equality on its
  `value` (E_QUARRY_LIVE_MAINTAIN_PROBE): read the maintain in the program;
  its live value cannot be probed at one unit. Equalities on non-expiring
  maintains and ordinary tables are unchanged. Rules compare with `=` and `!=`
  only; the system principal consults no rules. Write authority and refusal
  disclosure are separate, as the write contract below states.
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

### Write authority

For update/upsert, "readable" means the read rule admits the old row in the
pre-write state, before the patch or any of its effects. The engine resolves
id and unique-key targets privately; the update rule judges old and next.

| Target before the write | Refusal details |
| --- | --- |
| Readable | `E_RULE`; `E_CONFLICT` with a read-rule `current`; named `E_CONSTRAINT`; `E_INPUT` |
| Unreadable or absent | `NOT_FOUND` for rule denial, an `update` condition, secondary unique clash, or an incomplete insert patch; no row, index, column or branch detail |

A hidden collision on ordinary insert or `insert ... if absent` stays
`E_RULE`; a readable collision names its index (if-absent returns null).
An update or upsert-patch colliding with a different hidden row returns generic
`E_RULE` when its target is readable and `NOT_FOUND` when its target is unreadable.
Use `upsert counters[recipient] { count: 1 }` under an `update` rule to
write another principal's row. Success discloses the admitted row's existence
and the update rule predicates. It grants no extra stream or snapshot row.
A condition belongs on `update`; an upsert inserts or patches. A condition
needs a row you can read; a blind patch needs none. On a row you cannot read,
immutable columns in a patch are ignored. A readable immutable mismatch still
names the column. Before target lookup, the engine reserves room for the rule
probes and the largest merged image allowed by the schema and supplied patch;
if it cannot fit, `E_BOUND` refuses equally for a hidden or absent target.

`old` in a rule and the conditional update's `if` are evaluated inside the
engine. An update/upsert result and conflict `current` are read-rule gets,
never the merged patch image: null or withheld when hidden at that read.
A patch can grant read authority and then return its row. Omitted asset columns
keep their placement. An explicit asset id on a row you cannot read must be your
own upload, even if it equals the retained id. Update authority is checked
before asset diagnostics. A readable maintain is an explicit delta read channel;
`N_MAINTAIN_DELTA` notes potentially wider source update authority.
A missing `upsert` predicts its insert when the synced group is held with no
horizon, both the key and the materialized insert image prove readability,
and the viewer-readable partition covers every secondary unique lookup and
affected cap group. The image includes key columns, patch and defaults; a
whole-table cap needs the whole public table. Left groups and unproved
conditions queue without a predicted row and still send `/m` (guide prediction).
The at-most-once record stores the replay body, with value-free diagnostic
messages and no `result` or `current`. Replay returns
execution identity only, with `replayed: true`; historical `result` and
`current` are withheld, including after revocation or a dropped response.
The same operation id under another principal has no access to that receipt.
`delete` keeps its own existing rule and behavior.

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
another. After `where`, use `{ ...card }` to shape the page; a bare shape
name attaches inside the predicate. If it mistakenly shapes a scalar there,
`check --fix` inserts the explicit page shape.
`fn isBrief(ttl: int ?): ttl != null` is a helper expression and
`fn stamp(roomId: rooms):` a helper block ending in `return expr` or a bare `return`,
each expanded where it is called (`isBrief(ttl)`; `stamp(r.id)` as a
statement or expression), at most eight levels deep. A table-typed helper parameter keeps a row argument as a row with fields and no lookup; a reference argument stays a reference. A helper can write only
when its caller can; a query's diagnostic names the write at the call site.
A helper's `return` ends only that call, including inside a page's shape;
the page keeps its continuation and completeness.
A collector building a returned value makes the query incomplete if it exits
with rows still unconsumed, even on a short final page.
Every page with more rows needs its own returned
cursor owner; another field's page cannot cover a lost sibling or auxiliary
page. A fully consumed, exhausted scan is complete without an owner, including
an exact-bound scan returned as `count(rows)` (subject to the meter, rules and
device horizon). An auxiliary loop over an intact returned page does not change
its completeness, even if that loop breaks. Repeating a page read never clears
an earlier loss. If an owned page site executes repeatedly, only its final
execution supplies `next`; a continuation lost by an earlier execution still
makes the query incomplete.

### Actions

```quarry
action invite(email: text <=200)
action refreshModel() <- viewer = 'service:ranker'
```

An action has typed arguments and no Quarry body: the application's
TypeScript worker performs it and returns a JSON result. `<- allow` is
the default (any signed-in principal); `deny` pauses it, and a rule over
`viewer` can admit a named service. It cannot read tables or arguments.
The generated operation is `Action<A, R = unknown>`, `kind: "action"`,
server-run and never predicted. See `guide actions`; its declaration is
compiled on that card beside the language card.

### Queries, mutations and jobs

A mutation classified `predicts: "never"`, from a server site or an author's
`: server` marker, may iterate a bounded plain prefix page when its read rule
is uniform over the prefix. `matching`, merges and tables with expiry are
refused for every mutation page (`E_STRUCTURAL_FANOUT`), predicting or not,
looped or only bound. Prediction still needs a complete
schema-capped group. Every page a mutation reads, including a page it only
binds, must be uniformly decided by its prefix (`E_STRUCTURAL_FANOUT`): read it in
a query, or pin the deciding columns.
A page verdict evaluated from its pinned prefix charges the rule's static probe count on either outcome, including probes skipped by `and`/`or` short-circuiting; an aborting mutation page also costs one examined unit before the verdict.
The pass is atomic and remains subject to 1,024 rows written per mutation.
`check --cost` prints "a pass over the first N rows of <prefix>; examined
ceiling <n>". It never commits a partial pass after a budget abort.

```quarry
mutation recentPass(roomId: rooms): server
  n = 0
  for row in members[roomId] first 10 by byRoomPrincipal:
    n = n + 1
  return n
```

A job may put a read-only prelude before its first `chunk`. It runs again
at the start of every chunk, with its bindings visible there and its work
charged to that chunk's meter. Writes belong inside a chunk.

- **Arguments** are typed like columns; `c: cursor ?` is an opaque page
  cursor. An omitted optional argument reads as null.
- **Reads:** `t[key]` (one row by a unique key, null if absent or
  hidden), `t[key] ! else CODE` (or refuse), `exists t[key]`; named extra
  equalities (`t[key = x, col = y]`) return null/false on a mismatch,
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
  below), `merge t matching q [after c] last N by wordsIndex:` over scope
  lanes (search across groups), `connected[p]` (open connections; `exists connected[p]` tests;
  Presence, below). A key may name its columns: `t[a = x, b = y]`.
  With a total unique `(chatKey, principal)` key on t, `.principal = viewer
  or exists t[.chatKey, viewer]` is decided by the chat: each row witnesses
  itself, so the chat's roster page is complete without a second table.
- **Seeks and filters:** `t[prefix, col >= start, col < end] first N by idx`
  seeks on the first unpinned index column. `t[prefix] after c first N by idx
  where predicate` evaluates the read rule then the predicate for each row;
  only rows passing both count toward N. `.` is the row, and indexed reads
  inside the predicate are metered probes. A lone next-column comparison
  lowers to a seek with N_SEEK. A full page's cursor is after its last result;
  a cut page continues after the last rule-visible examined row, including a
  filter rejection, never a hidden row. Non-uniform ranges stay incomplete.
  Merged pages return no `next` for a non-uniform read or a meter or word-limit
  cut, because a shared cursor cannot advance past an unfinished lane.
  A uniform filtered page is complete at N matches or the range's end, even
  without a cursor; a meter cut is incomplete.
- **List operations:** pages, lists, and shaped collections share `sort`,
  `slice`, `count`, `sum`, `group`, `first`, `last`, `at`, `join`, and `for`,
  subject to their element types. Aggregating a page aggregates that page;
  `check --cost` names the examined and probe work, and expression ranges
  as `steps ≤ meter`.
- **Shapes:** `{ *, author: users[.authorId], count: counts[.conversationId] }`
  after a page, a list, a row or an object; `.` is the row; `*` spreads its
  columns; a shape based on a row keeps its device-owned `pending?: boolean`,
  including through named spreads and another shape. A point read inside is null
  for a hidden row. A shape is
  the only projection.
- **Writes:** `insert t { fields }` (returns the row; the id is minted
  unless given as `id: new` or an id you hold), `insert t { .. } if
  absent` (null on a unique clash), `update t[key] { patch }` (`if .col =
  expected` makes it conditional, refusing `E_CONFLICT` with the current
  row; `NOT_FOUND` when the row is missing), `upsert t[key] { fields }`
  (insert or patch: omitted columns keep their values on an existing row;
  an absent row fills defaults and then, for any required column still
  missing, refuses `NOT_FOUND`, the one word an unreadable target gets),
  `delete t[key]`; the key is an id, a row you hold, or a full unique key.
  Upsert predicts an update of a held row, and the insert of a missing
  one only when the synced group has no horizon and the key proves
  readability; otherwise a first like or reaction queues without a
  predicted row. `guide prediction` shows predictable
  insert-if-absent/delete set-state writes over a held viewer partition.
  A final write is the implicit return; bind it to use it (`row = insert
  ..`). Writes check the rule, unique indexes, caps, immutables, text
  formats and `after insert`; any refusal rolls the whole mutation back.
- **Statements:** `x = expr` binds or reassigns a local with a compatible type;
  reassignment resets refinements, and arguments cannot be shadowed. `(q, r) = divmod(a, b)`, `(lo, hi) = sorted(a, b)`,
  `xs = []` then `xs = xs + [value]` appends under the heap meter;
  `for x in xs:` iterates the accumulated list.
  `require cond else CODE`, `if:` / `else if:` / `else:`, `for x
  in domain:` over a page, a bounded list, `range(a, b)` (integer
  expressions, under the step meter) or `tokens(text)`, `break`, `continue`, `return [value]`, a `fn` call,
  `emit effect { payload }` (Effects, below), and a write. Values: `viewer`, `now`, `new` (an id, mutations only),
  `count(text | page | list)` (characters or items), `lower(text)`,
  `trim(text)`, `group(list, 'col')` (first-seen `{ key, items }` groups),
  `first(list)`, `last(list)`, `at(list, i)` (element or null), `join(list, separator)`, `sum(page, .x)`, `sum(list)`, `min(a, b)`, `max(a,
  b)`, `slice(text | list, start, end)`, `sort(list, 'col', '-col')`,
  `tokens(text)` (the @mentions, at most 64), `share(amount, list,
  member)`, `a ?? b`, `a if cond else b` (the arm not taken is never
  evaluated; `x != null` as the condition narrows `x` in the taken arm).
  `/` and `%` give the Euclidean quotient and remainder of ints or times;
  zero refuses `E_DIV_ZERO`. `(now / 1) * 1000` scales integer milliseconds;
  store the scaled count as `int`. Bind an optional helper result once and
  guard that local before arithmetic; repeated calls do not share a null
  refinement. `divmod` binds both parts at once. Text `+` concatenates present texts;
  interpolation and formatting stay in the client. A bare `return` returns null.
  `=` and `!=` are total (null equals null); `<` and friends need present
  operands — narrow with `if x != null:` or `x ! else CODE`. Guards also
  narrow bound row fields through short circuits and surviving branches;
  rebinding the local clears its field facts. `not` binds
  tightest: `a != b`, not `not a = b`.
- **Refusals** a program raises with `require .. else CODE` reach the
  client as `{ code: "CODE", family: "rule", rule: "CODE", .. }`; `CODE` is
  UPPER_SNAKE and never starts with `E_`.
- A predicting mutation loops over one complete schema-capped group
  (`cap N by cols` and `first N`). A never-predicting mutation can pass a
  bounded uniform page, as described above; a larger sweep is a job's `chunk`.

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
its next boundary. A job in `snapback/jobs.q` is named `jobs.<name>` in
every schedule; `schema.q` jobs use bare names. `check --fix` qualifies an
unambiguous bare module job. `snapback4 run <job> '{..}'` runs one here and now.
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

query everywhere(q: text <=100, c: cursor ?):
  return merge messages matching q after c last 50 by byConvWords:
    [m.conversationId] for m in memberships[viewer] first 50 by byPrincipalConversation

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
("cof": coffee, coffers, cofounder — one seek each, at most 32 words per scope,
else `complete: false`) and merges them as ordered lanes into one page,
newest first when the index says so; every further term must be a prefix
of some word of the row ("cof car" finds "COFFEE for Carol"). Mid-word
text never matches; an empty search matches nothing; an expired row is
gone at once; an edit re-tokenizes. A scope the rule decides costs one
verdict per scope. An unscoped words index (`by byWords: words(body), at,
id`) under a per-chat rule checks the rule per row and is never
`complete` (`N_NEVER_COMPLETE`): use `everywhere` to search the viewer's
chats, or read on the device (§4).

`everywhere` merges matching pages from the viewer's chats, ordered by
`at` and `id`: each lane is one verdict when its scope decides the rule,
and the page is complete when all lanes are complete; past 50 lanes
`check` emits N_WIDE_MERGE, and the device runs the same query over held rows.
A pinned conjunct such as `exists members[.roomId, viewer]` denies a scope
before word discovery even when another conjunct needs each row; an
admitted non-uniform scope keeps its per-row costs and stays incomplete;
hidden rows there still spend the query-wide examined/index-entry budget.
The 32-word bound makes that lane incomplete without cutting later lanes;
operator results name it in `word_cut_at`, separately from a meter cut in `capped_at`.
Merged pages withhold `next` for a non-uniform read or a meter or word-limit
cut, including a non-uniform read within budget, so cursor presence cannot
reveal hidden-row costs.
Reads inside `where` use their own rules and search terms. An empty
matching result past a device horizon is incomplete too, so a held group
can fall back to the server.

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
  sync

table messages:
  conversationId: id
  authorId: principal
  body: text <=4000
  at: time
  by byConvTime: conversationId, at, id
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  sync last 500 by byConvTime

mutation send(conversationId: id, body: text <=4000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  msg = insert messages { conversationId, authorId: viewer, body, at: now }
  for m in memberships[conversationId] first 50 by byConversationPrincipal:
    if m.principal != viewer and not exists connected[m.principal]:
      emit notify { targetUserId: m.principal, chatId: conversationId, preview: slice(body, 0, 80) }
  return { id: msg.id }
```

This send stays eligible to predict because presence decides only effects;
the server decides who is notified at commit. For dispatch-time presence
or any other presence-dependent decision, emit unconditionally and have
the worker call a service mutation that reads `connected`.
Prediction evaluates the safe untaken presence arms too and discards their
effects, so it pays at least their server cost. Effect ids never consume
`new` or an insert's ids.

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
and the server answers it online. A mutation stays eligible to predict
when presence decides only effects, so its rows are independent of
presence and the server decides who is notified at commit.
Presence-derived values use comparisons, `exists`, boolean logic and field
values. Arithmetic, fallible builtins, reads, `new` or refusals controlled
by presence keep `predicts: never`, as do conditional values without a
fixed-size proof.
Prediction charges both safe presence arms, so it may reach a bound even
when the server would fit.
If an untaken arm needs a combined guard's value refinement, the device
queues without a row; put the data guard outside the presence guard.

### The meter

Nothing is priced at compile time. As a program runs, the meter counts
examined rows, index entries, rule probes, steps, heap bytes, output
bytes and rows written against ceilings (8,192 rows examined, 16,384
index entries, 8,192 probes, 1,000,000 steps, 16 MiB heap, 1 MiB output,
1,024 rows written per mutation; a job's chunk may examine 16,384 rows
and write 8,192). A query past a ceiling returns what it found with
`complete: false`; a mutation aborts with `E_BOUND` naming the ceiling
and the site. `snapback4 check --cost` prints each site's structural
class; `snapback4 test` prints the numbers, including heap bytes, on your data.

Heap is a cumulative allocation and binding budget: constructed values,
concatenation and other allocating builtins, local bindings, and owned
copies count. Inspecting a held value's length or sum borrows it; row and
map clones share their immutable image. A heap cut stops a query immediately
with `data: null`, `complete: false`, and no continuation, since an interrupted
scalar or shape has no valid partial answer. Its meter and cut site remain
internal; a mutation rolls back with `E_BOUND` as above.

A page whose read rule the prefix does not decide (the deciding fields include a
column the scan does not pin) is never `complete`: the server cannot tell
"no more" from "more you may not see". Scan by an index that leads with
the rule's columns, or read the page on the device (§4), where the
partition holds exactly what the viewer may read. `check` says so
(`N_NEVER_COMPLETE`), as it notes a query page returned without a cursor
(`N_NO_CURSOR`), a synced table whose groups can grow with no horizon
(`N_NO_HORIZON`), and a merge past 50 lanes (`N_WIDE_MERGE`).

## 3. Sync: the viewer's partition is the unit of sync

```text
sync [last N by index]                           audience inferred from the read rule
sync public [last N by index]                    everyone holds the same rows
sync to .col [last N by index]                   each row reaches the principal in .col
sync to t[.a, .b] [by .col] [last N by index]    each row reaches every principal with a
                                                 row in t whose (a, b) match; `by .col` names
                                                 the recipient column when t has several
```

`sync` infers the audience from the read rule; an explicit `to` must agree.
The read rule must be exactly the audience — `public`, `.col = viewer` or
`exists t[.a, .b, viewer]` — so a device never holds a row it may not read,
and never misses one it may. A non-service second disjunct or an extra conjunct is a
compile error with the rewrite. The target table needs a unique index
over `(a, b, principal)` and an index leading with `(principal, a, b)`.
Read rules may add `or viewer = 'service:pusher'` (or several service grants);
sync infers its audience without them, so device snapshots and streams stay the same.
Every insert-rule branch on that audience table must prove the caller already
has the matching grant, or that the mutation created the referenced group;
`.principal = viewer` alone is a self-grant and fails `check`. Audience group
and recipient columns must be immutable or guarded on update. This also covers
insert-if-absent and upsert. The horizon `last N by index` bounds what a device acquires per group;
older rows are online-only, and a device's read past them says
`complete: false`. Joining a group delivers its rows; leaving it delivers
one scope tombstone, and the table's `retain` says what the device keeps.
Retained rows survive a leave whatever the horizon; the horizon bounds what
a device acquires, never what it keeps. The same local completeness rule
applies after leaving: an exhausted horizon is `complete: false`, while
unbounded whole-group history is `complete: true`. A read pinning the left
group answers from those rows on the device online and offline, through a
query without a membership `require`. Replacement snapshots keep left groups
and replace held groups with their current acquisition. If the same query
also has an unknown held-group read, it still falls back to the server.
Keep a read of a left group in its own query: mixing its retained rows
with an unknown held-group read returns the whole server answer online
(without the left rows) and the whole device answer offline.
A table with no horizon delivers every row of every group the device
holds, at every cold start, as the table grows: a public table of posts,
or a group's receipts, is soon the whole cold start. `check` notes such a
table (`N_NO_HORIZON`) unless the group cannot grow (one row per group, or
a `cap` over it); give a growing table a horizon (`last 500 by <index>`:
the newest N per group stay on the device, the rest are online and a
local read past them says `complete: false`). A snapshot arrives in pages
of 2,000 events, each staged in its own transaction and published
together with the last, so a device never shows half a snapshot.

`online only` optionally documents a table with no sync. On a `maintain`,
it opts out of inherited sync. `N_MAINTAIN_SYNCED` calls out public inherited
aggregates and group audiences with unbounded recipients or multiple values per group.
The note names mutations that would stop predicting if the maintain goes
`online only`; `snapback4 test --residency` measures its cold rows. When a
dev store exists, `check` includes its measured value-row count before adoption.

`check --residency` lists every table's residency, inferred and inherited
audiences, and each operation's `runs: device | server` or
`predicts: eligible | never`. Read sites are `held`, `horizon` or `server`.
Queries reading `connected` run on the server; mutations stay eligible when presence decides only effects.
A horizon site stays eligible but may queue without a row past the horizon;
`E_PREDICT` names the table, index and key. `why <op>` names the reason and
rewrite; `why <table>` includes the rule used for inference. The generated
`api.ts` documents arguments, results, these words, horizon sites and
`require` codes. `check` compares with `snapback/generated/residency.json`;
`dev` compares with its served generation. `N_NOW_SERVER` and
`N_NOT_PREDICTABLE` name changed sites, including added horizon risks.
Every text `check` also summarizes mutations that never predict, with one
reason each; JSON checks include `predictionSummary`. Add `predicts` before
a mutation header's colon (`mutation like(postId: posts) predicts:`) to assert
eligibility: `check` refuses `E_NOT_PREDICTABLE` at that header if any site
makes it `never`. This asserts eligibility, not that every call will predict;
a horizon miss can still queue without a row. See `guide prediction`.

`test --residency --fixture dir [--as persona]` prints measured cold rows and
compact JSON row bytes per synced table and persona, plus totals and
aggregate row counts. It uses the real partition snapshot, respecting
horizons. Facts and measurements are labelled; byte counts exclude transport
framing and are not extrapolated.

### Feeds: complete Following on the device

`snapback4 guide feeds` carries the complete Following recipe: private
inboxes for small accounts, one public projection for celebrity posts,
follow-time backfill, atomic unfollow purge, own posts and attributed
reposts, and a cursor query that runs on the device. On the 51st follower,
future events switch to broadcast; older events retain their delivery mode.
The card lists its schema caps and measured cold-sync tradeoff. A named
merge lane reads a second table with the same columns and plain index;
each table keeps its own rule and sync. `cap N` without `by` caps the whole
table. `N_SPARSE_FILTER` points here when a global timeline filter can spend
the page meter on unrelated authors.

A cursor from generation N works on N+1 when its table, index, direction
and typed ordering suffix still match; it continues through current data.
IDs break equal ordering keys and identify copies across projections;
copies must keep the same ordering fields.

```quarry
table authors:
  principal: principal
  shared: bool default false
  unique byPrincipal: principal
  public 'delivery mode is public'
  insert <- .principal = viewer
  update <- allow
  online only

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  cap 1000 by followerId
  cap 1000 by followedId
  public 'the follow graph is public'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  online only

table pulls:
  readerId: principal
  authorId: principal
  unique byReaderAuthor: readerId, authorId
  cap 32 by readerId
  read <- .readerId = viewer
  insert <- allow
  delete <- .readerId = viewer
  sync

table posts:                       -- originals and attributed reposts, one source event each
  actorId: principal
  authorId: principal
  postId: id
  repost: bool
  body: text <=500
  at: time
  shared: bool
  unique byActorPost: actorId, postId, repost
  by byActorTime: actorId, at, id
  by byTime: at, id
  cap 1000 by actorId
  immutable actorId, authorId, postId, repost, at, shared
  public 'original posts and attributed reposts are public'
  insert <- .actorId = viewer
  online only

table feed:                        -- private inbox, with rendered columns
  readerId: principal
  eventId: posts
  actorId: principal
  authorId: principal
  postId: id
  repost: bool
  body: text <=500
  at: time
  unique byReaderEvent: readerId, eventId
  unique byReaderTime: readerId, at, eventId
  by byReaderActor: readerId, actorId, id
  by byTime: at, eventId
  immutable readerId, eventId, actorId, at
  cap 1000 by readerId, actorId
  cap 50000 by readerId
  read <- .readerId = viewer
  insert <- .actorId = viewer or .readerId = viewer
  delete <- .readerId = viewer
  sync

table broadcast:                   -- public celebrity events, stored once
  readerId: principal
  eventId: posts
  actorId: principal
  authorId: principal
  postId: id
  repost: bool
  body: text <=500
  at: time
  unique byReaderEvent: readerId, eventId
  unique byReaderTime: readerId, at, eventId
  by byReaderActor: readerId, actorId, id
  by byTime: at, eventId
  immutable readerId, eventId, actorId, at
  cap 32000
  public 'celebrity posts and reposts are public'
  insert <- .actorId = viewer
  sync public

fn copy(p: posts, readerId: principal, shared: bool):
  if shared:
    insert broadcast { readerId, eventId: p.id, actorId: p.actorId, authorId: p.authorId, postId: p.postId, repost: p.repost, body: p.body, at: p.at } if absent
  else:
    insert feed { readerId, eventId: p.id, actorId: p.actorId, authorId: p.authorId, postId: p.postId, repost: p.repost, body: p.body, at: p.at } if absent
  return null

mutation register():
  insert authors { principal: viewer } if absent

mutation follow(authorId: principal):
  require authorId != viewer else CANNOT_FOLLOW_SELF
  a = authors[authorId] ! else AUTHOR_NOT_FOUND
  if exists follows[followerId = viewer, followedId = authorId]:
    return null
  insert follows { followerId: viewer, followedId: authorId }
  if not a.shared:
    near = follows[authorId] first 51 by byFollowed
    if count(near) > 50:
      update authors[authorId] { shared: true }
      insert pulls { readerId: authorId, authorId } if absent
      for f in follows[authorId] first 51 by byFollowed:
        insert pulls { readerId: f.followerId, authorId } if absent
  if authors[authorId].shared = true:
    insert pulls { readerId: viewer, authorId } if absent
  for p in posts[authorId] last 200 by byActorTime:
    if not p.shared:
      copy(p, viewer, false)

mutation unfollow(authorId: principal):
  if not exists follows[followerId = viewer, followedId = authorId]:
    return null
  for e in feed[viewer, authorId] first 1000 by byReaderActor:
    delete feed[e.id]
  if exists pulls[viewer, authorId]:
    delete pulls[viewer, authorId]
  delete follows[followerId = viewer, followedId = authorId]

fn deliver(p: posts):
  if p.shared:
    copy(p, viewer, true)
  else:
    copy(p, viewer, false)
    for f in follows[viewer] first 50 by byFollowed:
      copy(p, f.followerId, false)
  return null

mutation createPost(postId: id, body: text <=500):
  a = authors[viewer] ! else AUTHOR_NOT_FOUND
  p = insert posts { id: postId, postId, actorId: viewer, authorId: viewer, repost: false, body, at: now, shared: a.shared }
  deliver(p)
  return { id: p.id }

mutation repost(postId: posts):
  original = posts[postId] ! else POST_NOT_FOUND
  require not original.repost else ORIGINAL_REQUIRED
  if exists posts[viewer, original.postId, true]:
    return null
  a = authors[viewer] ! else AUTHOR_NOT_FOUND
  p = insert posts { postId: original.postId, actorId: viewer, authorId: original.authorId, repost: true, body: original.body, at: now, shared: a.shared }
  deliver(p)
  return { id: p.id }

query following(c: cursor ?):
  return merge feed after c last 20 by byReaderTime:
    [viewer]
    broadcast[p.authorId] for p in pulls[viewer] first 32 by byReaderAuthor
```

The caps are explicit: 1,000 follows and source events per account,
50,000 private entries per reader, 32 pulled authors per reader and
32,000 public broadcast entries. Follow backfills the last 200 source
events; caps refuse writes atomically when reached. The full recipe and
its measured tradeoffs are on the feeds card.

The feeds card also retains the ranked-feed and Trending recipes: a job
scores the shared pool into `ranked`, and the device composes it with the
reader's own signals. Trending over a day that exceeds the examined-row
ceiling is incomplete; use the maintained ranking when that set grows.
The card's `vote` predicts its first offline upsert when the post is held;
the viewer's votes have no horizon and are capped at 1,000 per viewer.

## 4. The client

The generated `api` groups a module’s operations under `api.<module>`: `api.social.follow`, not `api.follow` (§1).

The local client routes queries using the compiled `runs` word. An observed
server-run query refreshes when a commit touches its tables. Offline, it
returns the last server answer for that watch with `fresh: false` and
`since`, kept only in memory for the client's lifetime, or `denied: E_OFFLINE`
(`family: link`, `retryable: true`) when there is no answer. It never uses an
empty device page as a server answer.

```ts
import { createLocalClient } from "snapback4/local";   // the local-first tier
import { webDevice } from "snapback4/web";             // the device on the web
import { createClient, mintId } from "snapback4/client"; // the online tier (no store)
import { api } from "../snapback/generated/api";

async function openThread(conversationId: string) { // an existing conversation this viewer belongs to
  const online = createClient({ url: "http://127.0.0.1:4400", persona: "alice" });
  const client = await createLocalClient({ url: "http://127.0.0.1:4400", persona: "alice", device: webDevice() });
  const thread = await client.query(api.thread, { conversationId });
  const write = await client.mutate(api.send, { conversationId, body: "hi" });
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
A successfully acquired empty partition is still known data. When upgrading a store that lacks acquisition metadata, one completed online
sync is required;
existing durable writes remain queued. Safe literal-default-only schema
widening keeps acquired images readable; a reset or newly added table requires
acquisition again.

On the web, a failed save rejects the call and discards its uncommitted in-memory
state. The next serialized call reopens the last persisted state; earlier
durable writes survive. Failed startup releases the store lock. Runtime bytes
become the offline entry only after initialization and cache persistence; if
that save fails, the same bytes may retry, while changing the initialized
runtime requires reloading the page. The application still owns its offline
HTML/JavaScript shell.

The client owns the session, link, transport and read observation. Its options: `url`; `device`;
one of `persona` (development), `session` (from `snapback4/auth`, kept
and restored for this JavaScript runtime by default), or `guest: true`
(mint one when none is kept); `sessionStore`; `fetch`; `waitSeconds`. It
has `query(op, args) → Read`, `observe(op, args) → { getSnapshot(), subscribe(listener) →
unsubscribe, close() }` (a live read; React's `useSyncExternalStore`
shape), `mutate(op, args) → Write`, `act(op, args, options?) → Act`, `link()`, `onLink`, `viewer()`,
`onViewer`, `onWrite`, `session()`, `onSession`, `refreshSession()`,
`logoutAll()`, `signOut()`, `sync()`,
`close()`. `onWrite` reports the terminal `sent` or `failed` outcome of a
write that first returned `pending`; it is a live-client notification, while
the durable outbox remains the authority across a restart. A restored or
provided session within 24 hours of
expiry rotates before the protected backend is fetched (temporary action sessions cannot refresh); a running client
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
await client.close();
```

On the web, `mutate` waits for the outbox's IndexedDB commit, and `pagehide`
or becoming hidden sends only the oldest unconfirmed write with an authenticated
keepalive request when no ordinary send is in flight. A blocked or oversized
head is never skipped. Requests share the browser's 64 KiB body budget; unsent or unconfirmed writes
stay durable for retry on reopen, with mutation-id dedupe preventing duplicates.

On the web one tab is one device: a second tab on the same store opens
its own, and the writes a tab left queued when it closed are adopted by
the next device that opens the store. `webDevice({ wasm })` takes the
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
import type { Cursor } from "snapback4/contract";
type Read<T> =
  | { data: T; complete: boolean; fresh: boolean; since?: number; next?: Cursor | null }
  | { loading: true }
  | { denied: Refusal };
type Write<R> =
  | { state: "pending"; id: string }
  | { state: "sent"; id: string; seq: number; replayed?: false; result: R }
  | { state: "sent"; id: string; seq: number; replayed: true; result?: never }
  | { state: "failed"; id: string; why: Refusal };
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

`webDevice()` stores wasm bytes by SHA-256 digest in IndexedDB and opens from
them without a network fetch on reload. It also persists the compiled backend
with the device rows, so a device that opened and synced online can reopen
offline. Custom wasm URLs should identify immutable module versions.

A sent replay receipt carries `replayed: true` and no result. Narrow with
`write.state === "sent" && !write.replayed` before using `write.result`;
query the current state when a replay needs a value. Both client tiers and
React mutation settlement preserve the receipt. `Client.signOut()` revokes
its session when reachable, clears its credentials and closes the client.
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
host. On loopback, `dev` allows as many concurrent Argon2 slots as the host's
available cores, capped at 16 and never below 2; `serve` keeps two slots.
Full slots refuse with retryable `E_RATE_LIMIT`.
The schema opts in with `use identity` (guests and password accounts),
`use identity guests` or `use identity password`; without it the `/auth`
routes refuse with `E_AUTH`. `snapback4 dev` also admits personas;
`snapback4 serve` (a release) admits tokens only.

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
  unique byPrincipal: principal
  unique byHandle: handle
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
or an existing session. Reuse the signed-in client on the profile screen:

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

### Action results

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

A service is a principal `service:<name>` with a bearer session of its
own: `snapback4 token --service pusher` prints it once (`--release <dir>`
for a deployment). The token and one newline are the whole of stdout, with
prose on stderr, so capture it with `TOKEN=$(npx snapback4 token --service pusher)`.
Rules admit it like any principal (`insert <- viewer =
'service:ranker'`); with its token a worker claims what the backend
`emit`s under a lease, performs it, and settles it — a thrown handler
retries with backoff, `GiveUp` fails it at once, the returned value is
kept beside the effect — and mints or revokes the sessions of the
accounts the application authenticates itself. `meta.id` is the
idempotency key a provider should see.
A read rule may grant `viewer = 'service:pusher'` beside its sync audience;
`check --residency` lists the service grants, which admit server reads without adding device partitions.

The same worker handles `actions: { invite: async (args, meta) => result }`.
Its `meta.session` is client-ready: `createClient({ url, session: meta.session })`
runs reads and writes under the REQUEST's principal, never the worker's.
The session cannot refresh or enter worker/minting routes, and dies on
settlement or lease expiry. It lasts 60 seconds by default; set
`actionSessions: { invite: 120 }` and `lease: 120` per handler (the shorter
wins; maximum 900). Thrown errors retry after 2 seconds, doubling to
5 minutes and at most 8 attempts; `GiveUp` fails at once. Action results
are JSON, bounded by the unchanged 1 MiB output ceiling. The worker only
claims supplied handler names; effects and actions wait independently.

With `snapback/worker.ts` (or `.mjs`), `dev` starts Node 24 and supplies
`SNAPBACK_URL` and `SNAPBACK_SERVICE_TOKEN`, a `service:worker` token
printed once. It restarts after crashes with 250 ms to 5 s backoff and
stops the child when dev exits. `doctor` shows the worker file and the
request queue by state. Production workers are ordinary Node processes
you supervise. `apps/chat/snapback/worker.ts` is the invitation example:
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

- **`snapback4 init [dir] [--online|--expo]`** starts a project without
  overwriting existing files. An existing `package.json` keeps its metadata;
  required dependencies, devDependencies and scripts merge into it through an
  atomic replacement, so a failed package write leaves the original intact. A different
  value for the same required key refuses with the key and both values before
  any file is written. Run `npm install` again after merging a starter.
  The default writes the local-first todo
  schema and `.gitignore`; `--online` adds an online client, package.json
  and README. `--expo` copies the chat starter with its backend, invitation worker, screens,
  secure session store and native/online tier selection. Its toolchain
  matches the reference app: Expo **57.0.22**, React Native **0.86.3**,
  React **19.2.3**, expo-sqlite **57.0.3**, babel-preset-expo **57.0.11**.
  Keep Expo and its Babel preset on the same major; a mismatch can leave
  private fields in the bundle that Hermes cannot compile. The generated
  README gives the install and run commands.

- **`snapback4 dev [--port N] [--no-watch] [--fresh] [--hold-effects] [--hold-schedules]`** serves
  `snapback/*.q` on `127.0.0.1:4400`, recompiling and re-adopting on
  every save (the watcher polls every 400 ms; a save with problems keeps
  the previous generation serving and prints the diagnostics); the store
  lives in `.snapback4/store.sqlite` and persists across runs, and
  `--fresh` uses one in memory that dies with the process (acceptance
  scripts start from nothing). For recorded-action replays, `--hold-effects`
  prevents workers from claiming effects; emitted effects remain durable and
  become claimable after restarting without the flag. `--hold-schedules`
  prevents schedule admission; restart without it resumes at the next boundary,
  skipping the held periods, including when the schedule changed while held. Already queued jobs still run. Both flags are
  independent and require no app code. `dev` writes `api.ts` on start and on
  every adoption, and refuses a store that belongs to a deployment
  (`E_GENERATION`). Personas (`use personas ..`) sign requests from the
  same machine with the `x-snapback-persona: alice` header (the client's
  `persona: "alice"`), acting as `dev:alice`. For loopback identity requests, `dev` removes the
  per-peer and per-email minute counters and prints that fact and the host's
  Argon2 slot count once at startup: available cores, capped at 16, minimum 2.
  Connection/worker caps remain; `serve` keeps two Argon2 slots and the
  30-per-peer and 10-per-email limits.
  `dev` and `serve` print only the listening URL and one newline on stdout;
  startup explanations, lifecycle messages and supervised worker logs go to stderr.
  Process exits carry a one-line stderr diagnostic with the verb, serving
  generation and reason: `SNAPBACK4_EXIT` for returned errors/stops,
  `SNAPBACK4_PANIC` for panics on any thread (including abort builds),
  `SNAPBACK4_SIGNAL` for signals, and `SNAPBACK4_THREAD_EXIT` if the watcher
  or maintenance thread stops. An unexpected background stop ends the server.
  Generation `0` means this process has not served yet. `SIGINT`, `SIGTERM`
  and `SIGHUP` report immediately; with an application worker they clean it
  up and exit `128 + signal`. Otherwise, and for fatal signals such as
  `SIGBUS`, termination is immediate with the OS signal status.
  `SIGKILL`, power loss and an unwritable stderr cannot be reported
  from inside the process. `snapback4 why SNAPBACK4_SIGNAL` explains the code.
- **`POST /seed`** (dev only, same machine) takes `[{ "table": "t",
  "row": { "id": "..", .. } }, ..]`, writes the rows as the system
  principal in one commit (rules bypassed; validation, constraints,
  aggregates and sync apply) and answers `{ "seeded": N }`.
- **`snapback4 run <op> ['<json args>'] [--as alice] [--json]`** runs one
  operation against the local store (the persona defaults to alice) and
  prints the result, the meter and, for a mutation, the partition events;
  a job runs whole as the system (`--as` is ignored) and prints its run.
  Exit 1 on a refusal or a parked job, 2 on an engine error.
- **`snapback4 test [--residency] [--fixture dir] [--as persona]`** loads a fixture
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
- **`snapback4 check [--cost|--residency|--fix|--json]`** compiles, writes
  `snapback/generated/api.ts` (`Rows`, `Ops`, `api`), and prints every
  diagnostic with its site and rewrite; `--cost` adds each site's
  structural class, and `--residency` names where operations run.
  `--fix` applies only diagnostics explicitly marked `mechanical`: an
  ambiguous key's `by`, a cursor index's missing `id`, and exact canonical
  spelling rewrites, including `==` to `=`. Before it edits, every compiled file must be
  unchanged on disk, and every compiled file is read again just before the
  write. This check is best effort: it refuses an edit it observes and names
  the file; a save in the instant before the write can still be overwritten. It prints one
  `fix:` line per change to stderr, re-reads the project, recompiles, and reports the remaining diagnostics normally (`--json`
  remains one JSON result on stdout; `--cost` prose goes to stderr when
  combined with `--json`). Unmarked design suggestions are
  left for the author. **`snapback4 types`** writes `api.ts` alone and prints
  its path plus one newline on stdout, with its status on stderr.
- **`snapback4 sql "<SELECT …>" [--release dir] [--limit N] [--json]`**
  inspects the developer's own store, **never rule-filtered**. It opens
  `.snapback4/store.sqlite` read-only alongside `dev`, or a deployment's
  store with `--release`; no schema adoption and no writer lock. Temporary
  views expose each application table's `id` and columns from the active
  compiled schema; a required column an old row lacks reads its literal
  default, and an absent optional column reads null. Scalar tags are unwrapped; compound values remain
  canonical tagged JSON. Only one `SELECT` or `WITH … SELECT` is allowed:
  writes refuse `E_SQL_READ_ONLY`, and internal tables (including raw
  `r`/`i` and SQLite metadata) refuse `E_SQL_INTERNAL`. The result is bounded
  to 200 rows by default and says when more exist. The table is stdout;
  the inspection header and row-count/truncation notice go to stderr. `--json` returns
  `columns`, positional `rows` (retaining every selected column), `limit`,
  `more`, `ruleFiltered: false`, and the same inspection header. For example:
  `snapback4 sql "SELECT conversationId, count(*) FROM messages GROUP BY conversationId"`.
- **`snapback4 device <store.sqlite> [backend.json]`** runs the native
  device over stdin/stdout, one JSON request and answer per line.
- **`snapback4 --help`** lists every verb and its flags; `deploy`,
  `rollback` and `serve` are described in §6.
- **`snapback4 token --service <name> [--days N] [--release <dir>]`**
  mints a service's bearer token into the project's store (or a
  deployment's) and prints it once.
  The token and one newline are the whole of stdout (even with `--json`),
  with prose on stderr, so capture it with `TOKEN=$(npx snapback4 token --service worker)`.
- **`snapback4 why <E_CODE | op | table>`** explains a refusal code, an
  operation's arguments, result and cost, or a table's rules, sync line,
  expire column and indexes; **`data <table> [--limit N]`** prints rows
  as one JSON object per stdout line (50 by default), with any truncation
  hint on stderr; **`doctor [--json]`** says what is in place: the
  store, its size, schedules and their last boundary, the last job runs,
  the effects by state and the failed ones;
  **`guide [keyword]`** lists cards and aliases, or prints one card: language,
  types, indexes, rules, sync, residency, prediction, evolution, expire, assets, reads, shapes, writes,
  programs, jobs, native, feeds, search, effects, actions, services, presence,
  bounds, refusals, personas, witness (`guide <E_CODE>` explains a code);
  Natural words resolve too: `offline` → prediction, `pagination` → reads,
  `migration` → evolution, `sql` → personas, `push` → effects. An unknown
  word prints three nearest cards and the list on stdout, then exits 1.
  **`--version`** prints the binary's version, which equals the
  package's. Every flag may be spelled `--flag=value`.

### The wire

The client is the intended surface; the wire is plain JSON for anything
else. The server card and compiled metadata require a live principal.
`GET /` is the server's card (`{ snapback4, generation, seq, ops:
[{ name, kind }], tables: [{ name, sync }] }`); `GET /api.ts` the
generated TypeScript; `GET /schema` the compiled backend; `GET
/native.wasm` the native module when the backend has one. Authenticated
`GET /probe` answers HTTP 200 `{ ok: true }`; clients require both the status
and body before changing an offline link back to online. `POST /q/<op>`
with `{ "args": {..} }` answers `{ data, complete, seq, next, nextExpiry,
tables, viewer }` or `{ denied }`; `nextExpiry` is the earliest future expiry
the visible read encountered, or null. `POST /m/<op>` with `{ "id", "args",
"newIds" }` answers `{ state: "sent", id, seq, result }` on fresh success,
`{ state: "sent", id, seq, replayed: true }` on replay, or `{ state:
"failed", id, why, current? }` (a client-minted `id` makes the write
apply at most once). A replay adds `replayed: true` and omits both `result`
and `current`; a fresh `E_CONFLICT` may carry the live row in `current`.
A job is refused over the wire (`E_OP`).
`POST /sync` takes JSON `{ from, limit, after, stream, pending }` (defaults:
`0`, `2000`, `null`, `false`, `[]`). With `from: 0` it returns the paged
snapshot: `{ snapshot: true, events: [{ table, kind, id, data }], watermark,
more, next, generation, acknowledged }`. Continue with `after: next`;
`limit` is clamped to 1–10,000. `pending` holds at most 256 write IDs,
each 1–128 UTF-8 bytes, and reports which queued writes the server applied.
The request body is at most **262,144 bytes (256 KiB)**, including the
cursor and JSON escaping; this accommodates all 256 maximum-length IDs
even with six-byte escapes. A larger body is HTTP 413 with `denied: E_INPUT`,
including chunked bodies; malformed fields are HTTP 400 with `E_INPUT`.
With `from: W` or `stream: true` it returns the stream from a watermark:
`{ snapshot: false, events: [{ seq, table, kind, id, data }], watermark,
more, generation, acknowledged }`. There is no GET `/sync` route.
`GET /changes?since=S&wait=N` requires the same principal and answers
`{ seq, tables, generation }` when a commit lands or after N seconds (25
at most; 0 answers at once; at most
500 commits are summarised). With `heartbeat=1`, an idle HTTP/1.1 response
starts immediately and sends JSON whitespace every 2 seconds before the
final JSON object. Proxies must forward chunks without buffering. Once
streaming starts, the status is 200; check the final object for `denied`,
including `E_AUTH` if the session ended while waiting. `POST /assets` (the
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
is 401 `E_AUTH`.

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
files when customizing Metro. The starter selects native or online on phones;
select `webDevice()` when adding a local-first web client.

The same client runs on React Native over the native module — the
`snapback4-expo` package, §7.1 — in a development or production build.
Expo Go loads no custom native code and no wasm under Hermes, so an app
there runs the online tier with a session it keeps itself:

```ts
import * as SecureStore from "expo-secure-store";
import { createLocalClient } from "snapback4/local";
import { nativeAvailable, nativeDevice } from "snapback4-expo";
import { createClient } from "snapback4/client";
import { guest, keepSession, restoreSession } from "snapback4/auth";
const url = "http://127.0.0.1:4400";
const sessionStore = { get: SecureStore.getItemAsync, set: SecureStore.setItemAsync, delete: SecureStore.deleteItemAsync };
async function kept() {
  const restored = await restoreSession(url, sessionStore);
  if (restored) return restored;
  const signedIn = await guest(url);
  if (!signedIn.ok) throw new Error(signedIn.why.message);
  await keepSession(url, signedIn.session, sessionStore);
  return signedIn.session;
}
const client = nativeAvailable()
  ? await createLocalClient({ url, guest: true, sessionStore, device: nativeDevice })
  : createClient({ url, session: await kept() });   // Expo Go
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

`--prime` first launches with `segment === "prime"`, waits for the completed
`primed` step, and terminates the app. It then stops the backend, verifies
connection refusal, starts video and logs, and cold-launches with the given
segment. Complete `offline-done`, await `waitFor("reconnect")`, then complete
`done`. `step(name, fn)` returns the function's result and records completion
only if it succeeds. Receipts inside a step carry `name:running`; failure
records `name:failed`. Steps are sequential. `receipt(object)` preserves the
object's fields and adds only `witness: { at, step }`; `witness` is reserved.
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
