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

Start here: read `snapback4 guide language` for Quarry, then `guide rules`
for authorization, `guide sync` and `guide residency` for what the device holds,
and `guide prediction` for offline writes. Use `guide reads` and `guide writes`
as you build screens; `guide replay`, `guide effects`, `guide jobs` and
`guide clock` cover seeds, notifications and tests. Read `guide personas`
when wiring sign-in, and `guide assets` when adding media.

## 1. The shape of an app

```
my-app/
  snapback/schema.q          the backend: tables, rules, sync, queries, mutations
  snapback/worker.mts        optional Node ESM worker: effects and actions (dev starts it)
  snapback/generated/package.json  ESM boundary for generated artifacts
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
Every starter writes `snapback/generated/package.json` with `{"type":"module"}`,
so Node ESM seed scripts can import `api` from `snapback/generated/api.ts`
even when the app's package.json says `"type":"commonjs"`. Existing scripts
under `snapback/` keep their module interpretation. The Expo starter uses
`worker.mts` so its generated worker is explicitly ESM in a CommonJS app.
`check` and `dev` rebuild the generated package boundary alongside `api.ts`.

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
  expiring table recomputes its live source group at read time, before the
  sweep; a partial device or a meter cut reports `complete: false`.
  Value-order indexes over expiring sources are refused
  (`E_QUARRY_MAINTAIN_EXPIRE`); `guide feeds` gives the scheduled Trending
  recipe with predictable likes and an explicit score lag.

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
`check` calls an upsert with an unprovable insert arm `predicts: updates only`,
and lists that arm in its summary with the first failing horizon, rule or cap
coverage proof. `insert ... if absent` reports the same insert limitation.
An id supplied to `insert ... if absent`, including a parameter or helper result,
needs the `byId` absence proof too. Only an id minted by `new` during the call
(including an omitted id) can use a covered secondary unique key instead.
`check` preserves a local's `new` fact across unrelated requires, reads, emits
and writes. A direct assignment tracks the local's new value; a branch or loop
that may assign it discards its fact. Other locals keep their mint facts.
Membership-scoped reactions with `last 500` cannot prove absence outside that
window; removing it still leaves `(messageId, principal)` unable to decide
`exists members[.conversationId, viewer]`. A viewer-keyed read rule with no
horizon and caps grouped by that viewer predicts a first write but shows only
the viewer's own reactions. Full public sync covers a per-message cap but
makes every reaction public. Membership reads can predict without a horizon
when every unique key and cap group includes `conversationId` and the device
holds the deciding membership row; that acquires all reactions in the held
conversation. None of these means complete children of just the held messages.
If no shape fits the product, this write queues until the server answers;
show its pending state using the returned write's `state` and `client.onWrite`
(guide writes). Changing `upsert` to an existence branch does not supply absence
or cap coverage.
The at-most-once record stores the replay body, with value-free diagnostic
messages and no `result` or `current`. Replay returns
execution identity only, with `replayed: true`; historical `result` and
`current` are withheld, including after revocation or a dropped response.
The same operation id under another principal has no access to that receipt.
`delete` keeps its own existing rule and behavior.

### Maintains

Calendar keys accept an optional literal offset: `day(.at, 8h)` and
`bucket(.at, 1d, 8h)` start each period at 08:00 UTC. The integer key is
`floor((at - offset) / period)`; use the same offset in the lookup, such as
`day(now, 8h)`. Offsets are nonnegative whole durations smaller than the
period (zero is allowed); `hour(.at, 30m)` works too. A day is always
86,400,000 ms, with no timezone or daylight-saving adjustment. Changing the
offset rebuilds the maintain without adding a source column.

A maintain keeps an engine-owned table of rows { id, <group columns>, value }.
A full-key lookup returns the number, zero when absent. An explicit page
returns rows; a short key without a page operator is refused. The generated
byGroup index covers the complete group tuple. Source caps can bound distinct
groups without a new runtime target cap.

Filters accept typed scalar comparisons, and/or/not and required boolean
columns, with no reads, viewer, now, helpers or arithmetic. Calendar keys take
required time columns; day, hour and bucket are UTC epoch floor ordinals,
including negative timestamps. Duplicate output names and id/value are refused.
These Clique examples replace stored original-post flags and calendar fields,
and expose reaction chips and a value ranking:

```quarry
table posts:
  authorId: principal
  parentId: id ?
  at: time
  score: int
  by byAuthor: authorId, id
  public 'posts are public'
  online only

table likes:
  postId: posts
  authorId: principal
  principal: principal
  unique byPostPrincipal: postId, principal
  public 'likes are public'
  online only

table reactions:
  messageId: id
  emoji: text <=20
  principal: principal
  by byMessage: messageId, id
  cap 50 by messageId
  public 'reaction counts are public'
  online only

maintain originalPostCounts: count posts where .parentId = null by authorId
  read <- allow
  online only
maintain dailyPosts: count posts where .parentId = null by authorId, day(.at)
  read <- allow
  online only
maintain hourlyPosts: sum posts of score by authorId, hour(.at)
  read <- allow
  online only
maintain periodPosts: count posts by authorId, bucket(.at, 2m)
  read <- allow
  online only
maintain digestPosts: count posts by authorId, bucket(.at, 1d, 8h)
  read <- allow
  online only
maintain reactionCounts: count reactions by messageId, emoji
  read <- allow
  online only
maintain postLikes: count likes by postId
  read <- allow
  online only
  by byCount: value, id

query today():
  return dailyPosts[viewer, day(now)]
query reactionChips(messageId: id):
  return reactionCounts[messageId] first 50 by byGroup { emoji, count: .value }
query mostLiked(c: cursor ?):
  return postLikes after c last 10 by byCount { postId, count: .value }

query digestToday():
  return digestPosts[viewer, bucket(now, 1d, 8h)]
```

Value-order indexes end in value, id, optionally after group fields. last N
descends by both; ordinary cursors continue it. A direct page cursor binds the
evaluated prefix and active generation, so another prefix or adoption refuses
it. Ordinary writes keep it valid; rows can move between pages. Only existing nonzero groups
appear. Author attribution stays a source field. A value-order page pins
every group field before value in its index;
value, id alone gives a global ranking. A UTC day is not a rolling
24-hour window: the scheduled Trending recipe on `guide feeds` includes
zero-like candidates and keeps likes predictable, with scores lagging one
schedule period plus execution/sync delay. It ranks likes on posts younger
than 24 hours, not recent likes on older posts. Value ordering over an
expiring source is refused; live unranked reads still recompute selected,
unexpired contributions.

A maintain inherits source sync only when every audience column survives as
a bare key, with no target horizon. It stays until-revoked even when its source
retains delivered-history. Public inheritance sends all groups to every device,
including when a query reads only the top ten. An online-only derived side
effect does not prevent prediction of a source write; reading it does. Unknown
aggregate bases queue without a predicted row and are never initialized to zero.
For an expiring zero sum, a held source witness keeps the candidate; local
absence requires held source coverage with no horizon. Otherwise the write
queues without a predicted row. Live scalar misses and empty pages stay
incomplete under incomplete source coverage. An inherited aggregate over a
public source with subset delivery runs on the server; its local scalar and
page coverage stays unknown.

Filtered counts disclose predicate membership; computed keys disclose bucket
membership and rank discloses relative values to the declared aggregate read
audience. The filter grants no source-row read. Restrict the maintain's read
rule when these deltas are private; guide rules shows that form. Adoption
rebuilds changed derived definitions on populated stores through today's
atomic activation path; resumable adoption is a separate slice.

Even a hidden aggregate can disclose a constraint outcome: near an integer
endpoint, a hidden selected contribution can make a write fail with
E_OVERFLOW while an excluded contribution commits. Work reservation does not
prevent this overflow bit; the refusal names only the maintain and column,
and the failed transaction rolls back.

### Shapes and helpers

`shape card = { id, name, owner: .ownerId }` names a shape; `row card` and
`page card` use it, and `{ ...card, extra: 1 }` spreads its fields into
another. After a scalar predicate, `where not .hidden card` shapes the page
with the declared `card`, as does `where not .hidden { ...card }`. A valid
row/object shape inside a predicate keeps its meaning; parenthesize that
operand, or use `{ ...card }` explicitly for the page.
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
  from a cursor; table-page modifiers may come in any order, once each), `merge t [after c]
  first N by index [where predicate]:` with `[lane]` lines (one ordered page over several
  prefixes; a lane may be `[f.col] for f in t[prefix] first N by index`;
  uniform lanes with a non-nullable unique index or an index ending in
  `id` read one head per lane, then advance the winning lanes; other
  lanes read a page each; `check` notes a merge past 50 lanes), `walk
  t[seed] up .parentId depth 8` (a bounded list of rows), `t[scope]
  matching q after c last N by wordsIndex` (word-prefix search; Search,
  below), `merge t matching q [after c] last N by wordsIndex:` over scope
  lanes (search across groups), `connected[p]` (open connections; `exists connected[p]` tests;
  Presence, below). A key may name its columns: `t[a = x, b = y]`.
  If several indexes match a positional key, a single exact-type match wins
  first. If that remains ambiguous and exactly one is unique over the whole
  key, that unique index wins; otherwise use `by index`.
  With a total unique `(chatKey, principal)` key on t, `.principal = viewer
  or exists t[.chatKey, viewer]` is decided by the chat: each row witnesses
  itself, so the chat's roster page is complete without a second table.
- **Seeks and filters:** `t[prefix, col >= start, col < end] first N by idx`
  seeks on the first unpinned index column. `t[prefix] after c first N by idx
  where predicate` evaluates the read rule then the predicate for each row;
  only rows passing both count toward N. `.` is the row, and indexed reads
  inside the predicate are metered probes. At that level, `matching`, `after`
  and `first`/`last` end the predicate and modify the outer read. An immediate
  `by` after an unparenthesized inner read refuses `E_QUARRY_MODIFIER_SCOPE`:
  parenthesize the inner read, or move the modifier before `where`.
  `check --fix` adds parentheses to preserve the inner index. A lone next-column comparison
  lowers to a seek with N_SEEK. A full page's cursor is after its last result;
  a cut page continues after the last rule-visible examined row, including a
  filter rejection, never a hidden row. Non-uniform ranges stay incomplete.
  Merged pages return no `next` for a non-uniform read or a meter or word-limit
  cut, because a shared cursor cannot advance past an unfinished lane.
  A uniform filtered scan is complete at N matches or the range's end, even
  without a cursor; a meter cut is incomplete. A merge header's `where`
  applies the predicate in every lane before emission; a cut predicate never
  emits its unchecked row. Filtered merges retain the merge's cursor rules:
  use `after c` for a complete page when more matches exist.
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
  A device accepts a local hit for `after insert <- exists t[key]`. A miss
  predicts a refusal only when the key proves readability and the synced
  group is fully held without a horizon; otherwise the insert or upsert
  queues without a predicted row for the server to decide.
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

**Search every chat I'm in (100–1,000 memberships).** `snapback4 guide
search`, section "Search every chat I'm in", carries the complete Quarry
and the two-cursor walk. Search fully synced messages with one unscoped
words index on the device, or page memberships 50 at a time on the server
and exhaust each batch's matching result cursor before advancing the
membership cursor. Group the accumulated results by chat in the client.
The `everywhere` example above covers its first 50 chats; its result cursor
does not advance to the next 50 memberships. Batches are each newest first;
one globally ordered stream needs a merge of all batch heads.

Measured at 100 / 500 / 1,000 chats with 30 messages per chat, 24 matching
one word prefix, and 20 results per page: both device stores examine 22
rows on the first page; the bounded server merge examines 1,201. Full walks
find 2,400 / 12,000 / 24,000 hits across every chat, with complete pages.
Full sync acquires 3,000 / 15,000 / 30,000 messages. A sync horizon keeps
search over held messages working but reports `complete: false`, including
empty searches; online, use the scoped server walk for full history.
The card records whole-walk costs, horizon measurements, the 32-word
limit (global on the device, per chat on the server), and the per-reader
copy cost. A meter-cut matching merge cannot be continued with a result
cursor alone. The card intentionally documents N_NO_HORIZON for full sync
and N_NEVER_COMPLETE for the unscoped query's server execution.

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
the server commits the effects and defers grace-only decisions until their
deadline. For dispatch-time presence
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
When presence decides only effects, no live poll but an unexpired grace
queues the push for the grace deadline: up to 35 seconds. A reconnect during
that window cancels it, even if the new poll ends before claim or the server
restarts. A live poll at claim also cancels it. The recorded effect has state
`satisfied`, `result: { outcome: 'presence_reconnected' }` and zero attempts;
it never reaches a worker. Otherwise it becomes claimable once through the
existing lease protocol. No grace means immediate admission; an already live
poll still suppresses the push. Cancellation requires a proven necessary
absence guard, such as `if not exists connected[p]`, an alias of that test,
or a conjunction of absence tests. With several necessary absences, the
queue waits for their latest grace deadline; reconnecting any one within
its own window satisfies the guard. An unconditional payload read such as
`emit audit { online: exists connected[p] }`, `not exists connected[p] or force`,
and boolean forms without that proof remain immediate and are never
cancelled by reconnect. Nested necessary absence guards also qualify.
Potential dependency allocations, propagation and emission copies reserve
the same heap allowance with or without grace, including on a device; actual
allocations remain metered.
`clock advance` extends held effect leases by the advanced duration, preserving
their remaining real-time lifetime; retry `nextAt` still follows the dev clock.
`runWorker` reports a lost settlement with the server's code and message.
Only a recorded `queued` state is informational and says requeued;
`sent`, `running`, `failed` and unknown outcomes go to `onError` (or stderr).
A handler error whose settlement cannot be recorded is reported separately,
with the original error and stack.

### Presence

In tests: `snapback4 clock advance 36s` expires grace after a poll ends;
open polls stay connected. Online client queries read the updated server
answer; presence is still not replicated to a device.

`connected[p]` is how many connections a principal holds open on the
server now — a device following the stream keeps a long poll open, and
one that answered a moment ago still counts for 35 seconds — and `exists
connected[p]` is the test. It is not a table: nothing syncs, nothing is
written. A mutation reads it to notify only those with no connected
client (Effects, above); a query reads it for an online mark. On a
device the word is unknown: a query that reads it is `complete: false`,
and the server answers it online. A mutation stays eligible to predict
when presence decides only effects, so its rows are independent of
presence and the server commits the effects. In those effects-only mutations,
grace alone defers the push for up to 35 seconds instead of losing it. A
reconnect in the window, or a live poll at claim, cancels it with the recorded
`satisfied` outcome `presence_reconnected` (Effects, above). Grace deadlines
and recorded reconnects survive restart; `clock advance` makes a waiting
effect due along with its grace.
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
scalar or shape has no valid partial answer. Its cut site remains internal;
the meter is available only through dev's opt-in read inspection (§4).
A mutation rolls back with `E_BOUND` as above.

A page whose read rule the prefix does not decide (the deciding fields include a
column the scan does not pin) is never `complete`: the server cannot tell
"no more" from "more you may not see". Scan by an index that leads with
the rule's columns, or read the page on the device (§4), where the
partition holds exactly what the viewer may read. `check` says so
(`N_NEVER_COMPLETE`), as it notes a query page returned without a cursor
(`N_NO_CURSOR`), a synced table whose groups can grow with no horizon
(`N_NO_HORIZON`), and a merge past 50 lanes (`N_WIDE_MERGE`). A single-group
page omits the cursor note when its bound covers the group cap and that cap
fits the default 8,192-row examined ceiling. Larger caps still need a cursor;
other metered work can also cut a read.

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
a `cap` over it), or an eligible mutation's reads or insert proof need its
whole partition (`guide prediction`); otherwise consider a growing table's horizon (`last 500 by <index>`:
the newest N per group stay on the device, the rest are online and a
local read past them says `complete: false`). A snapshot arrives in pages
of 2,000 events, each staged in its own transaction and published
together with the last, so a device never shows half a snapshot.

`online only` optionally documents a table with no sync. On a `maintain`,
it opts out of inherited sync. `N_MAINTAIN_SYNCED` calls out public inherited
aggregates and group audiences with unbounded recipients or multiple values per group,
grouped into one note retaining each maintain's source location.
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
Each mutation gets one `N_NOT_PREDICTABLE` note with distinct root causes
and deduplicated sites and rewrites.
Every text `check` also summarizes mutations that never predict, blocked insert
arms, and eligible mutations with horizon reads; JSON checks include `predictionSummary`.
The horizon bucket and `why`'s qualified heading keep every read and site visible
on unchanged checks. This includes the expiring source behind a live-aggregate
write-rule probe: prediction needs that source without a horizon.
`N_HORIZON_GUARD` distinguishes the argument row id from the mutation write id;
only codes with `DUPLICATE`, `RETRY` or `DEDUPE` words get retry advice.
Application invariants such as `else EVENT_REMOVED` keep their guards.
Ordinary mutation pages still get `N_NO_HORIZON` growing-table advice;
point/exists reads, rule probes and insert proofs that need whole coverage do not.
When an eligible mutation reads an ascending `first N` page, or a page on
a different index from the suggested horizon, the note names the mutation
that would lose prediction instead of recommending that horizon. A descending
`last N` page on the horizon's own index may keep the rewrite; an exhausted
horizon can still make that call queue without a predicted row.
Add `predicts` before
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

Run `snapback4 init --recipe feeds --prefix feed` to write `snapback/feed.q` and the typed
client example `src/following.ts`, then `snapback4 check` to generate
`api.feed.feedFollowing`. This adds to an existing project, including `init --expo`, or
creates the normal starter plus the recipe in an empty directory. Existing
destination files and non-directory parents refuse before any write. Init
first compiles the existing `snapback/*.q` sources plus the recipe in memory;
name clashes report both declarations and files. App declarations that shadow
unrenamed recipe references, such as builtin `count`, refuse before writing
and name the declaration and file; rename the app helper and its callers.
`--prefix feed` renames the
recipe's declarations and references through its syntax tree (`posts` →
`feedPosts`, `deliver` → `feedDeliver`, `following` → `feedFollowing`),
keeping the app's `posts` and `follows`. Index names are table-local and stay
unchanged. Qualified schedule targets in another module keep their names,
even when a local job has the same name. Without a prefix a clash refuses and prints the prefixed command. A write failure removes newly created
files and preserves the existing `.gitignore`. Pass your app's client to the
example; call the `feedRegister()` helper inside the app's profile-save mutation. Read-time merges are fine
when the follow count is bounded small. `N_WIDE_MERGE` explains how a
principal-driven merge's read cost grows with the number of related principals
and names this command as an example for Following;
`N_SPARSE_FILTER` names it for a global-timeline filter too.

For an existing media app, the feeds card's “Wire into an app” example keeps
its post and repost cards. Its `createPost`/`repost` insert a reference event
in `feedPosts` and call `feedDeliver(event)` in the same transaction. The app's
Following query joins `posts[.postId] postCard` and its repost attribution;
no body or media is copied into the recipe. Its `follow`/`unfollow` mutate the
app edge and call `feedAddFollow`/`feedDropFollow` as a one-mutation bridge.
Backfill existing authors, reference events and edges before switching reads.
The app cards must also be synced for an offline join; their own rules and
horizons remain authoritative. With a prefix, standalone mutations become
`fn` helpers: only `api.feed.feedFollowing` remains a client operation, and
`src/following.ts` has no mutation wrappers. Clients cannot create ghost
references or bypass the app's follow bridge through the installed recipe.
The card gives the complete compilable example, including `saveProfile`.

`snapback4 guide feeds` carries the complete Following recipe: private
inboxes for small accounts, one public projection for celebrity posts,
follow-time backfill, atomic unfollow purge, own posts and attributed
reposts, and a cursor query that runs on the device. On the 51st follower,
future events switch to broadcast; older events retain their delivery mode.
Promotion skips a follower whose 32 pull slots are full; that reader keeps
old pushed events but misses later broadcasts from this author until freeing
a slot and unfollowing/refollowing. A saturated new follow of an already-shared
author refuses `FEED_PULL_CAP`, rolling back the app edge too. A saturated
author keeps their own shared events through an own-inbox copy.
`deletePost` and `unrepost` hide source events through synced removal
tombstones immediately after the removal commit is applied, then a scheduled
system job purges private copies in bounded chunks; the feeds card explains
live-page completeness, metered filtering, and fresh re-reposts.
The tombstone insert rule requires its ID to equal the event ID and its actor
to own the existing source. Keep `removeEvent`, called by these two mutations,
as the only insert; it writes the marker before deleting the source in the
same transaction. A guessed foreign event ID cannot hide or purge it.
The tombstone check runs inside each merge lane's `where` predicate before
an entry is emitted. A cut stops before the unchecked entry: no removed ID
is returned. Checked live entries may remain, with `complete: false`
and no `next`; retry the same cursor after cleanup.
Pages contain live rows without null slots and fill through removed entries
under the meter. With uniform lanes and enough budget, the cursor query is
complete at 20 live matches or the end, and continues after its last live
entry. Longer removed runs cost more examinations and probes. An offline
device still sees its last synced state. Ordinary point reads and read-rule
probes keep their existing semantics.
The 40-event test with its newest 20 removed uses 82 examinations and
41 tombstone probes to return 20 live rows and a continuation; examined
ceiling 25 returns no rows, incomplete, without a cursor.
Following uses the eager merge path because its lanes read different tables.
Filtered lanes discovered by `for` also use eager evaluation, preserving
each selector's bindings throughout pagination; uniform fixed-prefix lanes
on one seekable plain index can still use the lazy path.
The card lists its schema caps and measured cold-sync tradeoff. A named
merge lane reads a second table with the same columns and plain index;
each table keeps its own rule and sync. `cap N` without `by` caps the whole
table. `N_SPARSE_FILTER` points here when a global timeline filter can spend
the page meter on unrelated authors.

A merge cursor from generation N works on N+1 when its table, index, direction
and typed ordering suffix still match; it continues through current data.
IDs break equal ordering keys and identify copies across projections;
copies must keep the same ordering fields.

```quarry
table authors:
  principal: principal
  shared: bool default false
  unique byPrincipal: principal
  cap 1000
  public 'delivery mode is public'
  insert <- .principal = viewer
  update <- allow
  sync public

table follows:
  followerId: principal
  followedId: principal
  at: time default 0
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  cap 1000 by followerId
  cap 1000 by followedId
  cap 100000
  public 'the follow graph is public'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

table pulls:
  readerId: principal
  authorId: principal
  unique byReaderAuthor: readerId, authorId
  cap 32 by readerId
  cap 32000
  read <- .readerId = viewer
  insert <- allow
  delete <- .readerId = viewer
  sync

table pullCounts:                 -- server-only slot accounting; never lists installed authors
  readerId: principal
  used: int
  unique byReader: readerId
  cap 32000
  public 'only the number of installed pulls is public; routes stay reader-private'
  insert <- allow
  update <- allow
  online only

table posts:                       -- originals and attributed reposts, one source event each
  actorId: principal
  authorId: principal
  postId: id
  repost: bool
  at: time
  shared: bool
  unique byActorPost: actorId, postId, repost
  by byActorTime: actorId, at, id
  by byTime: at, id
  cap 1000 by actorId
  cap 60000
  immutable actorId, authorId, postId, repost, at, shared
  public 'original posts and attributed reposts are public'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

table removedEvents:               -- compact tombstones for deleted public source events
  eventId: id                       -- shared identity across source and tombstone tables; checked by the insert rule
  actorId: principal
  unique byEvent: eventId
  by byActor: actorId, id
  immutable eventId, actorId
  cap 1000 by actorId
  cap 32000
  public 'removal of a public source event is public; id is the eventId'
  insert <- .actorId = viewer and .id = .eventId and exists posts[id = .eventId, actorId = viewer]
  sync public

table feed:                        -- private inbox, with app post references
  readerId: principal
  eventId: posts
  actorId: principal
  authorId: principal
  postId: id
  repost: bool
  at: time
  unique byReaderEvent: readerId, eventId
  unique byReaderTime: readerId, at, eventId
  by byReaderActor: readerId, actorId, id
  by byTime: at, eventId
  by byEvent: eventId, id
  immutable readerId, eventId, actorId, at
  cap 1000 by readerId, actorId
  cap 50000 by readerId
  cap 1001 by eventId
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
  at: time
  unique byReaderEvent: readerId, eventId
  unique byReaderTime: readerId, at, eventId
  by byReaderActor: readerId, actorId, id
  by byTime: at, eventId
  immutable readerId, eventId, actorId, at
  cap 32000
  public 'celebrity posts and reposts are public'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public

fn copy(p: posts, readerId: principal, shared: bool):
  if shared:
    insert broadcast { readerId, eventId: p.id, actorId: p.actorId, authorId: p.authorId, postId: p.postId, repost: p.repost, at: p.at }
  else:
    insert feed { readerId, eventId: p.id, actorId: p.actorId, authorId: p.authorId, postId: p.postId, repost: p.repost, at: p.at }
  return null

mutation register():
  insert authors { principal: viewer } if absent
  return null

fn tryPull(readerId: principal, authorId: principal):
  if readerId = viewer:
    if exists pulls[readerId, authorId]:
      return true
  slots = pullCounts[readerId]
  used = 0
  if slots != null:
    used = slots.used
  if used = 32:
    return false
  -- Foreign inserts happen only on an author's first promotion: no route
  -- for that author exists yet. Never probe another reader's private route.
  insert pulls { readerId, authorId }
  upsert pullCounts[readerId] { readerId, used: used + 1 }
  return true

fn addFollow(authorId: principal):
  require authorId != viewer else CANNOT_FOLLOW_SELF
  a = authors[authorId] ! else AUTHOR_NOT_FOUND
  if exists follows[followerId = viewer, followedId = authorId]:
    return null
  if a.shared:
    require tryPull(viewer, authorId) else FEED_PULL_CAP
  insert follows { followerId: viewer, followedId: authorId, at: now }
  if not a.shared:
    near = follows[authorId] first 51 by byFollowed
    if count(near) > 50:
      update authors[authorId] { shared: true }
      tryPull(authorId, authorId)
      for f in follows[authorId] first 1000 by byFollowed:
        tryPull(f.followerId, authorId)
  visited = 0
  for p in posts[authorId] last 1000 by byActorTime:
    if visited = 200:
      break
    visited = visited + 1
    if not p.shared:
      copy(p, viewer, false)

  return null

mutation follow(authorId: principal):
  return addFollow(authorId)

fn dropFollow(authorId: principal):
  if not exists follows[followerId = viewer, followedId = authorId]:
    return null
  for e in feed[viewer, authorId] first 1000 by byReaderActor:
    delete feed[e.id]
  if exists pulls[viewer, authorId]:
    delete pulls[viewer, authorId]
    slots = pullCounts[viewer] ! else FEED_PULL_COUNT_MISSING
    update pullCounts[viewer] { used: slots.used - 1 }
  delete follows[followerId = viewer, followedId = authorId]

  return null

mutation unfollow(authorId: principal):
  return dropFollow(authorId)

fn deliver(p: posts):
  if p.shared:
    copy(p, viewer, true)
    if not exists pulls[viewer, viewer]:
      copy(p, viewer, false)
  else:
    copy(p, viewer, false)
    for f in follows[viewer] first 1000 by byFollowed:
      copy(p, f.followerId, false)
  return null

mutation createPost(postId: id):
  require not exists removedEvents[eventId = postId] else EVENT_REMOVED
  a = authors[viewer] ! else AUTHOR_NOT_FOUND
  p = insert posts { id: postId, postId, actorId: viewer, authorId: viewer, repost: false, at: now, shared: a.shared }
  deliver(p)
  return { id: p.id }

mutation repost(postId: posts):
  original = posts[postId] ! else POST_NOT_FOUND
  require not original.repost else ORIGINAL_REQUIRED
  if exists posts[viewer, original.postId, true]:
    return null
  a = authors[viewer] ! else AUTHOR_NOT_FOUND
  p = insert posts { postId: original.postId, actorId: viewer, authorId: original.authorId, repost: true, at: now, shared: a.shared }
  deliver(p)
  return { id: p.id }

fn removeEvent(p: posts):
  require p.actorId = viewer else NOT_AUTHOR
  insert removedEvents { id: p.id, eventId: p.id, actorId: viewer }
  if p.shared:
    delete broadcast[viewer, p.id]
  delete posts[p.id]
  return null

mutation deletePost(postId: posts):
  p = posts[postId]
  if p != null:
    require not p.repost else ORIGINAL_REQUIRED
    removeEvent(p)
  return null

mutation unrepost(postId: id):
  p = posts[viewer, postId, true]
  if p != null:
    removeEvent(p)
  return null

query following(c: cursor ?):
  return merge feed after c last 20 by byReaderTime where not exists removedEvents[eventId = .eventId]:
    [viewer]
    broadcast[p.authorId] for p in pulls[viewer] first 32 by byReaderAuthor

job purgeRemoved():
  chunk p in removedEvents first 1 by byId:
    for e in feed[p.eventId] first 1001 by byEvent:
      delete feed[e.id]
    delete removedEvents[p.id]
schedule purgeRemovedEvery every 1m: purgeRemoved
```

The caps are explicit: 1,000 follows and source events per account,
50,000 private entries per reader, 32 pulled authors per reader and
32,000 public broadcast entries plus 32,000 pending removal tombstones
(1,000 per actor). Follow backfills the last 200 source
events; caps refuse writes atomically when reached. The full recipe and
its measured tradeoffs are on the feeds card. Author modes, public follow
edges and public source references sync in full. Inbox entries and exact
pull routes are readable and synced only by their reader. The online-only
`pullCounts` table exposes each reader's installed-route count, not author
IDs, so promotion can skip saturated readers atomically. The helpers update
it with each route insert/delete; direct imports must include matching counts.
This is an explicit aggregate disclosure. It adds no cold-sync rows.
`saveProfile`, `register`, `createPost`, `repost`, `deletePost` and `unrepost`
remain eligible when required cards and source events are held. `follow`
and `unfollow` queue without rows because slot accounting is online-only;
following backfills when the server commits it.
The inbox keeps its full capped partition for complete Following pages.
Edges carry `at: time default 0`, preserved on an idempotent follow.
Global metadata caps are 1,000 authors, 100,000 edges, 32,000 pull routes
and 60,000 source references, plus 32,000 online count rows.
The feeds card publishes `test --residency`
measurements: the wired 500-follow fixture acquires 3,095 rows / 335,403 B
(up from 1,055 rows); its 5-follow reader acquires 2,600 rows / 250,482 B.
These counts apply to both predicting writes and queued follows; the fixture
has no pull routes. Both still read 20 complete entries with 82 examinations
and 21 probes. The larger 50,000-reference-event envelope acquires 77,665
rows for 500 follows, down from 78,566: 901 foreign pull routes no longer
arrive. Its five-follow and celebrity-plus-four readers acquire 52,915 and
52,866 rows, with 0 and 1 own pulls respectively. The feeds card records
the exact prediction boundary and acquisition tradeoff.

The feeds card also retains the ranked-feed and Trending recipes: a job
scores the shared pool into `ranked`, and the device composes it with the
reader's own signals. Trending's `create` and `like` write only their source
rows and predict when their required data is held; no mutation updates
another author's post or ranking row. The schedule alone writes `ranked`
from non-expiring like counts and post time every minute. Both the scheduled
and immediate queries break equal-score, equal-time ties by post id; the
ranked row's separately minted id is the final stored ordering key. Scores and new
candidates lag by one period plus queue, execution and sync delay; chunks
commit independently. Candidates expire at post time plus 24 hours before
any sweep. This is a post-time window, not recent likes on older posts.
The immediate `trendingNow` alternative is incomplete when the day's posts
or nested reads exceed the meter; a complete ranked page does not certify
score freshness.
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
`store_id` with a head below the device's watermark is a restore or shrink,
not a replacement: `E_STORE_RESTORE` halts sync and refuses reads, including
after an offline reopen. The old watermark and outbox remain in place.
Stop that client and use a fresh device store and outbox for the restored
backend; retry or backend adoption does not silently reacquire that identity.
A lower poll or probe head invalidates freshness and requests sync confirmation.
Only an authenticated sync reply with the matching identity and a head below
that request's acquired watermark persists the refusal; a notification alone
cannot halt a healthy client. Each native owner binds its interpreter and loaded
module digest to the adopted store identity. Another owner's replacement
requires adoption and module reload before local reads or prediction resume.

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
shape), `mutate(op, args, options?) → Write`, `act(op, args, options?) → Act`, `link()`, `onLink`, `viewer()`,
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
With an exclusive Web Lock, the web device records the mutation id, operation,
arguments and minted row ids synchronously in localStorage, in call order,
before `mutate` returns its promise. Same-origin navigation can therefore leave before IndexedDB admission
commits: the next client admits those records before new writes, then sends
through the ordinary outbox with the original ids. A closed tab's records are
adopted by the next device that opens the store, under the outbox's Web Lock.
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
throwing or full localStorage, missing Web Locks, an unidentified backend store,
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
later recovery can admit it if the authored condition changes. The returned
refusal alone does not guarantee preserved cancellation in that case.

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
import type { Cursor, ReadMeter } from "snapback4/contract";
type Read<T> =
  | { data: T; complete: boolean; fresh: boolean; since?: number; next?: Cursor | null; meter?: ReadMeter }
  | { loading: true }
  | { denied: Refusal };
type Write<R> =
  | { state: "pending"; id: string; reason?: string }
  | { state: "sent"; id: string; seq: number; replayed?: false; result: R }
  | { state: "sent"; id: string; seq: number; replayed: true; result?: never }
  | { state: "failed"; id: string; why: Refusal };
type Refusal = { code: string; family: string; message: string; site?: string; rewrite?: string; guide?: string; rule?: string; retryable?: boolean };
type Link = "online" | "offline" | "signed-out";
```

To measure a real account's server read in development, opt in on the online
client (the same session or bearer token works alongside a local client):

```ts
import { createClient } from "snapback4/client";
import { isReady } from "snapback4/contract";
import { api } from "../snapback/generated/api";
const client = createClient({ url: "http://127.0.0.1:4400", token: process.env.SNAPBACK_TOKEN!, meter: true });
const read = await client.query(api.thread, { conversationId: "existing-conversation" });
if (isReady(read)) console.log(read.meter); // { examined, indexEntries, probes, steps, heapBytes, outputBytes, rowsWritten }
await client.close();
```

`Read.meter` contains the engine's counters for that server answer, including
examined rows, index entries, rule probes (`probes`), steps, charged heap work
(`heapBytes`), output bytes and rows written. These are work counts, not latency
or process memory. Successful `query` and `observe` answers carry them; a
remembered offline watch keeps its last server answer's counters. Local device
reads have no meter. The wire opt-in is `x-snapback-meter: 1` on `POST /q/<op>`.
Loopback `dev` omits the field by default; `serve` ignores the header and never
returns meters. They can reflect hidden work, so they are development-only.
For local-store inspection, `snapback4 run <op> '<json args>' --as <principal id>
--json` prints the same engine counters under `metered`, using their Rust names
(`rule_probes`, `heap_bytes`, etc.). `--as alice` resolves a declared persona to
`dev:alice`; any other value is a literal principal id, such as `user:...` from
the account's session or an application principal such as `member:42`.

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
only for that client lifetime, up to 256 terminal outcomes. A secondary web
tab transfers its receipts when its closed store is adopted: destination
receipts win id collisions and count as newest, so adopted receipts fill only
spare capacity and cannot displace the destination's window. Rebuild the Expo native binary with this client
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
record, keyed by principal and mutation id, wins even for different operations
or arguments. Use a new id for a new intent. Each client remembers used ids for
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
Development clock advances extend a held action's lease and viewer session
by the same duration; ordinary sessions keep their expiry.

With `snapback/worker.ts` (or `.mts` or `.mjs`), `dev` starts Node 24 and supplies
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

- **`snapback4 init [dir] [--online|--expo] [--recipe feeds [--prefix <name>]]`** starts a project without
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
  `--recipe feeds [--prefix <name>]` adds the Following module and typed client example above;
  it also works after the starter has been initialized, without rewriting its files.

- **`snapback4 dev [--port N] [--no-watch] [--fresh|--memory] [--replay] [--hold-effects] [--hold-schedules] [--clock-offset +25h]`** serves
  `snapback/*.q` on `127.0.0.1:4400`, recompiling and re-adopting on
  every save (the watcher polls every 400 ms; a save with problems keeps
  the previous generation serving and prints the diagnostics); the store
  lives in `.snapback4/store.sqlite` and persists across runs, and
  `--fresh` (alias `--memory`) uses one in memory that dies with the process (acceptance
  scripts start from nothing). The stderr banner prints `store: in memory — dies with this process`
  for either flag, or `store: <SQLite path>` for persistent dev. For dev and serve,
  readiness is the first stdout line: the listening URL, emitted after store and
  native-module setup. Wait for that line before requests; lifecycle logs use stderr.
  For a replay mode that must not emit notifications,
  run `snapback4 dev --replay`: new emits are never delivered. The
  startup banner says effects are suppressed and schedules held; `doctor`
  reports the persisted dev replay and schedule policy. The write's
  transaction keeps only a durable `suppressed` count, shown by `doctor`,
  with no queued payload. Mutations, explicitly run jobs, results and meters
  behave normally. Replay also holds schedule admission; restarting without
  it resumes at the next boundary and skips held periods, including when the
  schedule changed while held. Already queued jobs still run, with new emits
  suppressed. Effects queued before replay keep their ordinary lifecycle.
  `--hold-effects` only prevents worker claims: effects remain durable and
  become claimable after restarting without the flag. `--hold-schedules`
  only prevents schedule admission and skips held periods on restart.
  The holds are independent; choose `--replay` when new effects must never
  be delivered. Suppressed effects never become deliverable after any restart.
  The policy stays on the dev store for local `run` invocations until the
  next host start; restarting without `--replay` restores normal emission for
  new writes and preserves the count. With `--fresh`, the count dies with the
  in-memory store; `doctor` and local `run` inspect the separate on-disk store.
  `serve`, deployment and `--release` invocations refuse `--replay` with
  `E_REPLAY_DEV_ONLY`; production always emits normally.
  `dev` writes `api.ts` on start and on
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
- **Development clock:** `snapback4 dev --clock-offset +25h` starts 25 hours
  ahead; `snapback4 clock advance 185s [--port N]` advances a running dev and
  waits for expiry sweeps and queued jobs, so an `every 2m` schedule and a
  three-minute expiry need no real wait. Missed periods fire once; held
  schedules stay held. Each job chunk keeps its normal meter and commit.
  The JSON response names `now`, `advancedMs` and `work` counts, including
  parked jobs. A maintenance error leaves time advanced and pending work
  retries on the normal tick; do not blindly repeat the advance.
  Durations are positive whole numbers with `ms`, `s`, `m`, `h`, `d` or `w`,
  optionally prefixed `+`; the startup offset alone may be negative.
  Mutations at `POST /m/<op>` stamp `now` from this dev clock.
  The dev clock keeps ticking monotonically and cannot advance backwards.
  Its offset resets on process restart; supply it again to continue a test.
  Rows stamped under an offset keep their times after restart; use a fresh store
  per offset test.
  Devices receive the ordinary sync deletion and row timestamps, and keep
  their own local clocks. `serve` refuses every clock control with
  `E_CLOCK_DEV_ONLY`; invalid or backward advances refuse `E_CLOCK_INPUT`.
  Scripts may call the same loopback-only dev endpoint,
  `POST /dev/clock/advance` with `{"duration":"+2m"}`. `guide clock` has the recipe.
- **`POST /seed`** (dev only, same machine) takes `[{ "table": "t",
  "row": { "id": "..", .. } }, ..]`, writes the rows as the system
  principal in one commit (rules bypassed; validation, constraints,
  aggregates and sync apply) and answers `{ "seeded": N }`.
  For recorded-action replay that must not emit notifications, run
  `snapback4 dev --replay`: new effects are never delivered and schedules
  are held. `guide replay` explains the restart and explicit-job behaviour.
- **`snapback4 run <op> ['<json args>'] [--as <persona|principal-id>] [--now <milliseconds|+duration>] [--json]`** runs one
  operation against the local store (defaults to `dev:alice`; declared personas
  get the `dev:` prefix and other principal ids are used verbatim) and
  prints the result, the meter and, for a mutation, the partition events;
  a job runs whole as the system (`--as` is ignored) and prints its run.
  `--now 1789352669447` pins the invocation to Unix milliseconds, so a post
  can be created in the past without a special seed; `--now +25h` uses wall
  time plus the duration. This pins queries, mutations and jobs equally;
  it does not change a running dev clock or fire schedules.
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
  In tests, use `snapback4 clock advance <dur>` or `POST /dev/clock/advance`; each example line advances the running dev once.

  ```sh
  snapback4 clock advance 36s
  curl -X POST http://127.0.0.1:4400/dev/clock/advance -H 'Content-Type: application/json' -d '{"duration":"36s"}'
  ```

- **`snapback4 check [--cost|--residency|--fix|--json]`** compiles, writes
  `snapback/generated/api.ts` (`Rows`, `Ops`, `api`), and prints every
  diagnostic with its site and rewrite; `--cost` adds each site's
  structural class, and `--residency` names where operations run.
  `--fix` applies only diagnostics explicitly marked `mechanical`: an
  ambiguous key's `by`, a cursor index's missing `id`, and exact canonical
  spelling rewrites, including `==` to `=` and `a?.b` to
  `a.b`: ordinary field access already propagates null, and removing only
  the `?` evaluates the base once even when it is a call or read. Before it edits, every compiled file must be
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
  Stderr names the owning store; each isolated store needs its own token (§4, Workers and services).
- **`snapback4 why <E_CODE | op | table>`** explains a refusal code, an
  operation's arguments, result and cost, or a table's rules, sync line,
  expire column and indexes; **`data <table> [--limit N]`** prints rows
  as one JSON object per stdout line (50 by default), with any truncation
  hint on stderr; **`doctor [--json]`** says what is in place: the
  store, its size, schedules and their last boundary, the last job runs,
  the effects by state and the failed ones;
  **`guide [keyword]`** lists cards and aliases, or prints one card: language,
  types, indexes, maintains, rules, sync, residency, prediction, evolution, expire, assets, reads, shapes, writes,
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
`GET /probe` answers HTTP 200 `{ ok: true, store_id, seq }`; clients require both the status
and body before changing an offline link back to online. The local client checks
the identity and head before restoring freshness or resuming a long poll. `POST /q/<op>`
with `{ "args": {..} }` answers `{ data, complete, seq, next, nextExpiry,
tables, viewer }` or `{ denied }`; `nextExpiry` is the earliest future expiry
the visible read encountered, or null. `POST /m/<op>` with `{ "id", "args",
"newIds" }` answers `{ state: "sent", id, seq, result }` on fresh success,
`{ state: "sent", id, seq, replayed: true }` on replay, or `{ state:
"failed", id, why, current? }` (a client-minted `id` makes the write
apply at most once). A replay adds `replayed: true` and omits both `result`
and `current`; a fresh `E_CONFLICT` may carry the live row in `current`.
A job is refused over the wire (`E_OP`).
`POST /sync` takes JSON `{ from, limit, after, stream, pending, store_id? }` (defaults:
`0`, `2000`, `null`, `false`, `[]`, absent). With `from: 0` it returns the paged
snapshot: `{ snapshot: true, events: [{ table, kind, id, data }], watermark,
more, next, generation, store_id, acknowledged }`. Continue with `after: next`;
`limit` is clamped to 1–10,000. `pending` holds at most 256 write IDs,
each 1–128 UTF-8 bytes, and reports which queued writes the server applied.
The request body is at most **262,144 bytes (256 KiB)**, including the
cursor and JSON escaping; this accommodates all 256 maximum-length IDs
even with six-byte escapes. A larger body is HTTP 413 with `denied: E_INPUT`,
including chunked bodies; malformed fields are HTTP 400 with `E_INPUT`.
With `from: W` or `stream: true` it returns the stream from a watermark:
`{ snapshot: false, events: [{ seq, table, kind, id, data }], watermark,
more, generation, store_id, acknowledged }`. The optional `store_id` echoes
the previous reply's database identity; a different identity invalidates old
snapshot cursors and partition evidence, even if the watermark is equal or
higher, while a server restart on the same database keeps its identity.
An older server can omit this additive field; a backwards watermark still
requires reacquisition, and a device with no stored identity reacquires once
when it first learns one. There is no GET `/sync` route.
`GET /changes?since=S&wait=N&store_id=ID` accepts the optional previous identity,
requires the same principal and answers
`{ seq, tables, generation, store_id }` when a commit lands or after N seconds (25
at most; 0 answers at once; at most
500 commits are summarised; beyond that, all tables are invalidated). `seq`
is the actual committed head, read in the same transaction as the identity and
changed tables. A different identity or a head below `since`
answers immediately; a regressed head is returned as `seq`. A matching
identity still waits for a commit or the deadline. With `heartbeat=1`, an idle HTTP/1.1 response
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
files when customizing Metro. The starter selects native or online on phones;
select `webDevice()` when adding a local-first web client.
The resolver blockList excludes `.snapback4/` store trees (including SQLite
sidecars, assets and generated runtime files) while preserving Expo's existing
exclusions; keep this entry when customizing Metro.

The same client runs on React Native over the native module — the
`snapback4-expo` package, §7.1 — in a development or production build.
Expo Go loads no custom native code and no wasm under Hermes, so an app
there runs the online tier with a session it keeps itself. Normalize session
keys for SecureStore, as the Expo starter does:

```ts
import * as SecureStore from "expo-secure-store";
import { createLocalClient } from "snapback4/local";
import { nativeAvailable, nativeDevice } from "snapback4-expo";
import { createClient } from "snapback4/client";
import { guest, keepSession, restoreSession } from "snapback4/auth";
const url = "http://127.0.0.1:4400";
const sessionStore = {
  get: (key: string) => SecureStore.getItemAsync(key.replace(/[^A-Za-z0-9._-]/g, "_")),
  set: (key: string, value: string) => SecureStore.setItemAsync(key.replace(/[^A-Za-z0-9._-]/g, "_"), value),
  delete: (key: string) => SecureStore.deleteItemAsync(key.replace(/[^A-Za-z0-9._-]/g, "_")),
};
async function kept() {
  const restored = await restoreSession(url, sessionStore);
  if (restored) return restored;
  const signedIn = await guest(url);
  if (!signedIn.ok) throw new Error(signedIn.why.message);
  await keepSession(url, signedIn.session, sessionStore);
  return signedIn.session;
}
const local = nativeAvailable()
  ? await createLocalClient({ url, guest: true, sessionStore, device: nativeDevice })
  : null;
if (local?.link() === "online") await local.sync();
const client = local ?? createClient({ url, session: await kept() });   // Expo Go
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
