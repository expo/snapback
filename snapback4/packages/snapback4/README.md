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

This `README.md` covers the app layout, Quarry and sync (§1–3).
[CLIENT-AND-OPERATIONS.md](./CLIENT-AND-OPERATIONS.md#4-the-client) continues
with the client (§4), development (§5), releases (§6), Expo (§7) and
[what is not in this release (§8)](./CLIENT-AND-OPERATIONS.md#8-not-in-this-release);
[SERVER.md](./SERVER.md) covers TypeScript server handlers, including the
server-only `snapback4/identity` OIDC action recipe, its protocol-double-only
bound-session recovery bridge and the pending repaired-engine qualification.
`snapback4 guide <card>` and `snapback4 why <code>` answer without leaving
the terminal. Every refusal names its code, its site and a rewrite.
Every Quarry block in this file and in the guide is compiled by the
package's own suite, and the language card is run, so nothing here
promises a form the compiler refuses.

**Start here — first working account screen:** follow this short path through
the existing sections; the reference map below can wait.

1. **Choose the Expo/local-replica starter.** Run `npx snapback4 init --expo`
   and follow [§7 Expo](./CLIENT-AND-OPERATIONS.md#7-expo). Use a development
   or production build for the native replica; Expo Go uses the online tier.
   From the project directory, run `npx snapback4 check` to generate the API, then
   keep `npx snapback4 dev` running to serve the backend at `127.0.0.1:4400`;
   see [§5 Development](./CLIENT-AND-OPERATIONS.md#5-development).

2. **Enable identity and persist the session.** For password accounts declare
   `use identity password`; follow [Sign-in](./CLIENT-AND-OPERATIONS.md#sign-in-snapback4auth)
   and `guide personas`. Keep the returned session in the starter's SecureStore
   adapter, pass it and `sessionStore` to the local client, and restore it on reopen.

3. **Declare the profile rule and avatar home.** Start with
   [Profile onboarding after sign-up](./CLIENT-AND-OPERATIONS.md#profile-onboarding-after-sign-up)
   and `guide rules`: a profile belongs to its principal. Add an optional image
   column to that row for the avatar; `guide assets` explains upload then placement
   and how the home row's read rule controls who can fetch it.

4. **Open the correct platform client/device.** Use the
   [§7 Expo opener](./CLIENT-AND-OPERATIONS.md#7-expo): `createLocalClient`
   with `nativeDevice` in a native build, `createClient` in Expo Go. For web,
   use `webDevice()` with the local client in [§4 The client](./CLIENT-AND-OPERATIONS.md#4-the-client).
   Sync when online and check `client.acquired` before relying on local prediction.

5. **Render loading, failed, pending and sent states.** Use
   [The card](./CLIENT-AND-OPERATIONS.md#the-card) and [React](./CLIENT-AND-OPERATIONS.md#react).
   Show denied reads and failed writes, keep the session after a profile-write
   failure, and wait for a pending write's terminal outcome before submitting again.
   Keep the mutation id for `client.write(id)` after reload. Adopted web tabs'
   terminal receipts remain discoverable through a shared server/viewer window
   of 256 receipts, whichever tab adopts the closed store; outboxes keep one owner.

6. **Stop at the first working account screen.** Sign up, save a profile and
   avatar, and reopen with the kept session; a missing profile returns to
   [profile onboarding](./CLIENT-AND-OPERATIONS.md#profile-onboarding-after-sign-up).
   Defer feeds, search, schedules and server handlers until those features are needed.
   Return to `guide feeds`, `guide search`, `guide jobs` for schedules, and
   [SERVER.md](./SERVER.md) with `guide actions` and `guide routes` for server handlers.
   You can stop reading here and build that screen.

**Reference as needed:** read §1 below for the app layout, then open
`snapback4 guide language` for Quarry and `guide rules`
for authorization, `guide sync` and `guide residency` for what the device holds,
and `guide prediction` for offline writes. Use `guide reads` and `guide writes`
as you build screens; `guide replay`, `guide effects`, `guide jobs` and
`guide clock` cover seeds, notifications and tests. Read `guide personas`
when wiring sign-in, `guide assets` when adding media, and `guide actions`
for TypeScript server work and `guide routes` for HTTP routes and webhooks.
Before wiring a client, continue at
[§4 The client in CLIENT-AND-OPERATIONS.md](./CLIENT-AND-OPERATIONS.md#4-the-client):
client setup, the read/write card, React, sign-in and the app's responsibility
for delivering its shell on a cold-offline start begin there.

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
  constrains them. Add `else HANDLE_TAKEN 'That handle is taken.'` to a
  unique index to supply its refusal code and message; `detail` retains the
  original index text for development. The message literal is optional;
  `else HANDLE_TAKEN` says `the program refused with HANDLE_TAKEN`.
  Codes follow `require`: UPPER_SNAKE, never `E_`, declared at the use site.
  Without the hook the `E_CONSTRAINT` message is unchanged. A point read needs a unique index over its key;
  In a program, `exists` uses an exact-key index when present, or a strict prefix scan. Rule probes need an index over exactly their keys. Named equalities covering a total
  unique key check extra columns on the one row, with no extra index; a scan needs an index whose
  leading columns are the scan's prefix, and pages in the order of the
  remaining columns; a cursor needs an index ending in `id` or a unique one.
  `by index` names one when two match. `by name: scope, words(text cols),
  at, id` is a words index: one entry per distinct word of the named text
  columns, read with `matching` (Search, below) and nothing else.
  `day(at)`, `hour(at)` and `bucket(at, 2h, 30m)` are time key components in
  a table's `by` or `unique` list, at any position, once per function per index;
  they use a required time column and add no column to the row.
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
  device holding it. An already returned answer keeps the row until the
  next answer; a live reader that must hide it at its deadline drops it
  locally by `expiresAt` (the client example in CLIENT-AND-OPERATIONS.md).
  A typing indicator or short-lived presence row especially needs this
  filter and a render timer; `guide reads` shows the typing table and query.
  This is an application table, separate from the server's `connected[p]`.
  That server-decided connection signal has no `expiresAt`.
  The server will not return it again after expiry, but does not push a
  removal at that instant.
  A null time never expires. Disappearing messages
  are one field on insert, `expiresAt: now + ttl if ttl != null else
  null` with `ttl: int ?`; nothing else to write. A `maintain` over an
  expiring table recomputes its live source group at read time, before the
  sweep; a partial device reports `complete: false`. If the meter interrupts
  a maintained lookup or live group, the query returns `data: null,
  complete: false`, without substituting zero or a partial total.
  Value-order indexes over expiring sources are refused
  (`E_QUARRY_MAINTAIN_EXPIRE`): live values change before the physical sweep,
  so stored top-N can miss a winner. For a window over the entity's own
  immutable time, `guide feeds` gives hour lanes over a non-expiring source;
  for contributions arriving in the window, its live bounded `rollingLikes()`
  read remains necessary, and a candidate or contribution scan cut makes it incomplete.

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
returns rows; a short key reads a prefix, bounded by a proven source cap,
the meter in a uniform query loop/lane, or an explicit first/last N. The generated
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
  return reactionCounts[messageId] by byGroup { emoji, count: .value }
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
24-hour window: for posts younger than a day, `guide feeds` groups
non-expiring likes by `hour(.postAt), postAt, postId` and merges the last
25 hour lanes ordered by `hour, value, id`, filtering the exact time edge.
It includes the validated copied-time insert rule and a zero-like fill;
ties use maintained id, and groups persist as long as any like remains.
Whole old buckets are skipped, but rejected candidates in the oldest
included hour still consume the meter. For likes arriving in the last day
on posts of any age, `rollingLikes()` still sorts live counts at read time;
a cut makes that bounded ranking incomplete. Value ordering over an
expiring source remains refused because stored order is stale between
expiry and the sweep. The optional scheduled recipe buys a job-computed
score or stored device page, with delayed scores.

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

A program's prefix `exists` is a top-1 scan below the page: no cursor and no
page overflow. Expired siblings still cost examined rows, and `matching` pays
word discovery. A positive held row proves existence on a device regardless of
its horizon; only a negative answer past that horizon needs coverage. A cut
before finding a row returns false on an already capped answer. Mutation prefix
existence tests require a uniform, plain, non-expiring prefix. Rule probes keep
exact-key, one-unit semantics. `exists` has no `where`, `first`/`last`, cursor or seek.

### Actions

Declare typed I/O operations in Quarry and implement them with generated
TypeScript handlers. Read [actions and the server context](./SERVER.md) for
the declaration, admission authority, durable steps, secrets and supervision,
or run `snapback4 guide actions`.

### Queries, mutations and jobs

A mutation classified `predicts: "never"`, from a server site or an author's
`: server` marker, may iterate a bounded plain prefix page when its read rule
is uniform over the prefix. `matching`, merges and tables with expiry are
refused for every mutation page (`E_STRUCTURAL_FANOUT`), predicting or not,
looped or only bound. Prediction still needs a complete
schema-capped group: `for m in members[roomId]:` takes its bound from the
schema cap, so changing the cap changes every whole-group read. An explicit
`first <cap>` stays legal; a smaller explicit bound still fails the prediction
proof. A job's inner loop may also read a capped group without restating it.
Every page a mutation reads, including a page it only
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
  hidden), `t[key] ! else CODE` (or refuse), `exists t[key]` (an exact probe or a prefix top-1 scan), `exists (t[prefix] matching q)`; named extra
  equalities (`t[key = x, col = y]`) return null/false on a mismatch,
  `t[prefix]` (ascending whole group when a schema cap fits the examined ceiling),
  `t[prefix] first N by index` (ascending; `t first N by index` is the
  whole table's page), `t[prefix] after c last N by index` (descending,
  from a cursor; table-page modifiers may come in any order, once each), `merge t [after c]
  first N by index [where predicate]:` with `[lane]` lines (one ordered page over several
  prefixes; a query lane may be `[f.col] for f in t[prefix] by index`,
  using the schema cap or the examined meter when its prefix decides the read rule;
  its `for` also accepts `range(a, b)` over int expressions and bounded lists,
  including list arguments and expressions, in their element order; bounds are
  evaluated once, empty domains are complete, and duplicate lanes deduplicate rows;
  `walk` is not a lane domain. Unknown widths print `lanes ≤ meter`; literal
  widths, equal expressions plus literal offsets, and list bounds are static.
  A non-uniform answer, an opening cut or a word-limit cut has no `next`.
  A uniform lazy merge cut while draining established heads carries `next`
  after its last emitted row, with `complete: false, cut: 'meter'`.
  Lanes computed from `now` move between pages:
  the cursor remains valid, but newly appearing rows before it are skipped;
  uniform lanes with a non-nullable unique index or an index ending in
  `id` read one head per lane, then advance the winning lanes; other
  lanes read a page each; `check` notes an explicit static lane count past 50), `walk
  t[seed] up .parentId depth 8` (a bounded list of rows), `t[scope]
  matching q after c last N by wordsIndex` (word-prefix search; Search,
  below), `merge t matching q [after c] last N by wordsIndex:` over scope
  lanes (search across groups; uniform scopes share one heap of discovered
  word lanes, with one verdict before discovery and at most 32 words per scope),
  `connected[p]` (open connections; `exists connected[p]` tests;
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
  inside the predicate are metered probes or prefix scans. At that level, `after`
  and `first`/`last` end the predicate and modify the outer read. An immediate
  `by` or `matching` after an unparenthesized inner read refuses `E_QUARRY_MODIFIER_SCOPE`:
  parenthesize the inner read, or move the modifier before `where`.
  `check --fix` adds parentheses to preserve the inner modifier, as in
  `where exists (messages[.roomId] matching q)`. A lone next-column comparison
  lowers to a seek with N_SEEK. A full direct page's cursor is after its last result;
  a cut direct page continues after the last rule-visible examined row, including a
  filter rejection, never a hidden row. Non-uniform ranges stay incomplete.
  Merged pages return no `next` for a non-uniform answer, an opening cut or a
  word-limit cut. A uniform lazy merge cut while draining established heads
  carries `next` after its last emitted row, with `complete: false, cut: 'meter'`.
  Its position appends the row id unless the ordering suffix already ends in
  `id`, so equal ordering values never skip rows. Following a cut page keeps
  the aggregate incomplete in `usePage`.
  An older merge token missing that id is refused; restart the walk. Existing
  id-ending merge tokens and direct-page tokens keep their encoding.
  A uniform filtered scan is complete at N matches or the range's end, even
  without a cursor; a meter cut is incomplete. A merge header's `where`
  applies the predicate in every lane before emission; a cut predicate never
  emits its unchecked row. Filtered merges retain the merge's cursor rules:
  use `after c` for a complete page when more matches exist.
  Reads inside a predicate are below its page: an inner top-N does not make
  the outer answer incomplete or take its cursor; an inner meter cut still does.
- **List operations:** pages, lists, and shaped collections share `sort`,
  `slice`, `count`, `sum`, `group`, `first`, `last`, `at`, `join`, and `for`,
  subject to their element types. Aggregating a page aggregates that page;
  `check --cost` names the examined and probe work, and expression ranges
  as `steps ≤ meter`. A uniform query prefix loop may omit `first N`;
  `check --cost` prints `rows ≤ meter (8,192 examined)` and `lanes ≤ meter`
  when no fitting cap supplies a static bound. A cut loop has no continuation;
  use a `maintain` for a total over a group that can outgrow one read.
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
  `tokens(text)` (the @mentions, at most 64), `sha256(text)` (lowercase
  64-character hexadecimal of the exact UTF-8 bytes), `share(amount, list,
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
- Use `sha256` only for high-entropy capability tokens and content checksums.
  It performs no Unicode normalization, case folding, quoting, salting or keying.
  It is not for passwords, low-entropy email anonymization, signatures, MACs or
  entropy generation, and a digest is not automatically safe to publish.
- **Refusals** a program raises with `require .. else CODE` reach the
  client as `{ code: "CODE", family: "rule", rule: "CODE", .. }`; `CODE` is
  UPPER_SNAKE and never starts with `E_`.
- A predicting mutation’s page loop needs one complete schema-capped group
  (`cap N by cols` and `first N`). A never-predicting mutation can pass a
  bounded uniform page, as described above; a larger sweep is a job's `chunk`.

A bounded list loop that only reads, computes and emits may iterate a list
column, an alias, a helper result or a filtered/shaped list from a page.
It need not preserve the whole group. If its body writes rows, including
inside helpers or nested loops, the original `E_STRUCTURAL_FANOUT` check
still applies. Every mutation page still needs a uniform plain prefix over
a table without expiry; the meter and its ceilings are unchanged.

### Jobs and schedules

```quarry
table invites:
  inviteeId: principal
  sentAt: time
  reminded: bool
  by byInvitee: inviteeId, id
  by bySentAt: sentAt, id
  immutable sentAt
  read <- .inviteeId = viewer
  insert <- deny
  update <- deny
  delete <- deny

job remind(periodStart: time, periodEnd: time):
  chunk i in invites[sentAt >= periodStart, sentAt < periodEnd] first 100 by bySentAt:
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
it at a period boundary of the server's clock (`every 2m`, `every
1h`, `every 1d at 08:00`; the shortest period is 1m), never twice for the
same boundary across restarts, passing `periodStart` and `periodEnd` when
the job declares them (and nothing else). Boundaries missed while the
server was down coalesce into one run for the latest period; a schedule
first seen fires from its next boundary. A job in `snapback/jobs.q` is named `jobs.<name>` in
every schedule; `schema.q` jobs use bare names. `check --fix` qualifies an
unambiguous bare module job. `snapback4 run <job> '{..}'` runs one here and now.
Jobs are not on `api.ts`.
Effects are global declarations shared by every file; jobs are module-qualified
operations. The worker dispatches by the declared effect name, while schedules
and `run` address an operation. If `digest.q` declares `effect notify` and
`job daily()`, write `emit notify { ... }`, register `effects: { notify: ... }`
in the worker, and schedule `digest.daily` (`schedule dailyDigest every 1d: digest.daily`).

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
job. Quarry still declares the table, its rules and its `sync`; a mutation
cannot be native, because a device predicts Quarry and the server replays it.
Anything that needs the network stays outside and writes into a table the job
reads.

### Time-bucketed listings and daily uniqueness

```quarry
table roomEntries:
  roomId: id
  at: time
  by byRoomHour: roomId, hour(at), at, id
  public 'Room entries are public.'

table checkins:
  principal: principal
  at: time
  unique byPrincipalDay: principal, day(at) else ALREADY_CHECKED_IN 'One check-in per day.'
  read <- .principal = viewer
  insert <- .principal = viewer

query roomHour(roomId: id, c: cursor ?):
  return roomEntries[roomId, hour(now) - 3] after c last 10 by byRoomHour

query roomWindow(roomId: id, c: cursor ?):
  return merge roomEntries after c last 10 by byRoomHour:
    [roomId, h] for h in range(hour(now) - 3, hour(now) + 1)

mutation checkin():
  return insert checkins { principal: viewer, at: now }
```

A table's `by` and `unique` key lists admit `day(at[, offset])`,
`hour(at[, offset])` and `bucket(at, period[, offset])` at any position,
once per function per index. The input is a required `time` column of that
same table. Periods and offsets follow maintain groups: floor ordinals from
the Unix UTC epoch, with a nonnegative whole offset smaller than the period;
`day(-1 ms)` is -1. Pin the ordinal positionally with an int expression,
or seek on the function name: `roomEntries[roomId, hour >= start, hour < end]`
with a page bound and `by byRoomHour`.

The key is not a column: it is absent from `*`, generated `api.ts`, rules,
`cap … by` and the sync audience, and cannot be written. An index containing
one is not plain, so a mutation page cannot use it. A real column named
`day`, `hour` or `bucket` colliding with that function's key must be renamed.
Changing the underlying time reindexes the row; a job `chunk` can sweep the
index only when that column and every other non-id key column are immutable.
A cursor carries the ordinal. Adding a time key, or changing its period or
offset, rebuilds the index at activation over existing rows.

With a maintained count on the row (LLP 3000.007 §21.3 P2, in design), the
same time key can serve Trending directly.

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

-- everything, grouped by chat
query searchGrouped(q: text <=100, c: cursor ?):
  return memberships[viewer] after c first 20 by byPrincipalConversation where exists (messages[.conversationId] matching q) { conversationId, hits: messages[.conversationId] matching q last 3 by byConvWords }

-- a globally newest-first screen while every chat opens in one read
query searchNewest(q: text <=100, c: cursor ?):
  return merge messages matching q after c last 20 by byConvWords:
    [m.conversationId] for m in memberships[viewer]

query people(q: text <=100, c: cursor ?):
  return profiles matching q after c first 20 by byNameWords

query allPeople(c: cursor ?):
  return profiles after c first 20 by byId
```

`matching ''` matches nothing, including when the needle contains only whitespace or punctuation.
Use `allPeople` while the search box is empty and `people` once the user types.
This directory uses two queries and a client branch: `allPeople` pages the
whole directory in `byId` order; `people` searches through `byNameWords`,
whose trailing `id` orders the matches, not alphabetically by display name.
Continue each query with its own `next`; do not sort only the first page
and treat it as the whole directory. Reset the cursor when switching queries or changing the search text.
Normalize whitespace-only input to `''` in the client if it should browse too.

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
`complete` (`N_NEVER_COMPLETE`): use `searchGrouped` or `searchNewest` to search the viewer's
chats, or read on the device (§4).

`searchNewest` merges matching pages from the viewer's chats, ordered by
`at` and `id`: each lane is one verdict when its scope decides the rule,
and the page is complete when all lanes are complete and the page fits the
meter. The lane source needs no restated bound; `check --cost` prints
`lanes ≤ meter`. An explicit `first N` above 50 still emits N_WIDE_MERGE.
The device runs the same query over held rows.
A pinned conjunct such as `exists members[.roomId, viewer]` denies a scope
before word discovery even when another conjunct needs each row; an
admitted non-uniform scope keeps its per-row costs and stays incomplete;
hidden rows there still spend the query-wide examined/index-entry budget.
The 32-word bound makes that lane incomplete without cutting later lanes;
operator results name it in `word_cut_at`, separately from a meter cut in `capped_at`.
Merged pages withhold `next` for a non-uniform answer, an opening cut or a
word-limit cut, including a non-uniform read within budget or after the merge,
so cursor presence cannot reveal hidden-row costs. A uniform lazy merge cut
while draining established heads carries `next` after its last emitted row;
the page stays `complete: false, cut: 'meter'`.
Reads inside `where` use their own rules and search terms. An empty
matching result past a device horizon is incomplete too, so a held group
can fall back to the server.

**Search every chat I'm in.** Use `searchGrouped` for everything, grouped by
chat: a filtered membership page with each chat's newest three hits. Follow
its one `next` through any number of memberships; a meter-cut page positions
after its last rule-visible examined membership and continues. Its nested
hit preview can be empty or partial on a cut page; following `next` does not
refill that earlier preview. Use the
single-scope `inChat` query for more hits in a chat. Use `searchNewest`
for a first screen in one globally ordered stream while every chat's head
opens in one read. An opening cut answers `complete: false, cut: 'meter'`
without continuation; use the grouped form.

The search card measures both forms on the server and both device stores at
100 / 500 / 1,000 dense chats and the grouped walk at 9,000 memberships.
Each dense chat has 30 messages, 24 matching one word prefix; the page size
is 20. Full sync acquires 3,000 / 15,000 / 30,000 messages. The card records
first-page and whole-walk examined counts and the newest form's opening
limit. These are live reads, not a snapshot: restart after membership changes
and refresh after message changes. Reset the cursor when the search text changes.
The 32-word limit applies per scope. A device read past its horizon answers
`complete: false`, including empty matches; the server searches full history.
The card also keeps the held unscoped search and its acquisition cost, with
an intentional N_NO_HORIZON for full sync.
With horizon-free sources, `check` reports horizon-free source coverage for
`searchHeld`. Answer completeness still depends on runtime authorization,
limits and continuation; `fresh` separately describes sync freshness.
An unscoped search through expiring memberships can be non-uniform and
incomplete below every limit; `first 1` without a cursor is incomplete when
its range contains two held rows. Read `complete` on each answer. A horizon, an online-only
source or zero read sites gets no source-coverage line.
Sources include reads nested in the `matching` expression, not just the searched table.
Its `query searchHeld(q: text <=100, c: cursor ?) held:` declaration is
device-only: `check` explains it, and `dev`, `serve` and `run` refuse
E_QUERY_HELD with a rewrite pointing to the grouped and newest forms on `guide search`.
The local clients answer it online or offline without server fallback, even
at a horizon or cut. `held` does not acquire data or promise completeness.
For ordinary device reads, online fallback asks the server only for a missing
fact or unknown presence; a meter or word cut and a cursorless page stay local,
as do held queries and retained left groups, and pending predictable writes
still prevent fallback.

### Effects

Effects use their global declared name even when the emitting job lives in a
module: `digest.q`'s `daily` job is `digest.daily`, while its `effect notify`
is `notify` in both `emit notify { ... }` and the worker's `effects: { notify: ... }`.

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
  for m in memberships[conversationId] by byConversationPrincipal:
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
A failure follows its declared policy (eight attempts by default); a worker that dies
loses its lease and the effect is claimed again; two workers never hold
one effect. `snapback4 doctor` counts them.

For a digest, **seek the period, filter the ordinal**. The complete recipe
below shares `unreadIn` with the viewer's inbox for the same period and walks
each recipient's own memberships; the job may read expiring messages directly.
`snapback4 guide jobs` explains the 16,384-examined chunk envelope, the measured
hub, the single totals-table fallback past it, and restart/re-run behavior.
Emits commit with the chunk cursor, but queueing a parked run again or manually
running the same period creates another run and can emit again. Use
`(targetUserId, periodEnd)` as the worker's idempotency key, or an emission marker.

```quarry
use personas alice, bob, carol
effect push

table profiles:
  principal: principal
  unique byPrincipal: principal
  public 'profiles are public'
  insert <- .principal = viewer

table conversations:
  title: text <=80
  read <- exists members[.id, viewer]
  insert <- allow
  after insert <- exists members[.id, viewer]
  sync to members[.id]

table members:
  conversationId: conversations
  principal: principal
  readOrdinal: int default 0
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  cap 1000 by principal
  immutable conversationId, principal
  read <- exists members[.conversationId, viewer]
  insert <- exists members[.conversationId, viewer] or created conversations[.conversationId]
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to members[.conversationId]

table messages:
  conversationId: conversations
  senderId: principal
  ordinal: int
  body: text <=4000
  tombstone: bool default false
  at: time
  expiresAt: time ?
  unique byConversationOrdinal: conversationId, ordinal
  by byTime: at, id
  by byConversationTime: conversationId, at, id
  by byExpiresAt: expiresAt
  immutable conversationId, senderId, ordinal, at
  read <- exists members[.conversationId, viewer]
  insert <- .senderId = viewer and exists members[.conversationId, viewer]
  update <- .senderId = viewer
  expire at .expiresAt
  sync last 500 by byConversationOrdinal

fn unreadIn(conversationId: conversations, reader: principal, readOrdinal: int, periodStart: time, periodEnd: time):
  return count(messages[conversationId, at >= periodStart, at < periodEnd] first 100 by byConversationTime where not .tombstone and .senderId != reader and .ordinal > readOrdinal)

query inbox(periodStart: time, periodEnd: time):
  rows = []
  for m in members[viewer] first 1000 by byPrincipalConversation:
    rows = rows + [{ conversationId: m.conversationId, unread: unreadIn(m.conversationId, viewer, m.readOrdinal, periodStart, periodEnd) }]
  return rows

job digest(periodStart: time, periodEnd: time):
  chunk p in profiles first 1 by byId:
    unread = 0
    chats = 0
    for m in members[p.principal] first 1000 by byPrincipalConversation:
      n = unreadIn(m.conversationId, p.principal, m.readOrdinal, periodStart, periodEnd)
      if n > 0:
        chats = chats + 1
        unread = unread + n
    if unread > 0:
      emit push { targetUserId: p.principal, kind: 'digest', periodStart, periodEnd, unread, chats }
schedule daily every 1d at 08:00: digest
```

When presence decides only effects, no live poll but an unexpired grace
queues the push for the grace deadline: up to 35 seconds. `doctor` reports the
deferred count and next deadline; `GET /effects` shows each deadline as `nextAt`.
In tests, close the window with `snapback4 clock advance 36s` or
`POST /dev/clock/advance` with `{ "duration": "36s" }`; a real-time poll
budget must exceed 35 seconds. A reconnect during
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

In tests: `snapback4 clock advance 36s` or `POST /dev/clock/advance` with
`{ "duration": "36s" }` expires grace after a poll ends;
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
It also names query/persona reads past half any ceiling without a cut, showing
at most ten and a count of the rest. Loopback `dev` logs actual meter and word
cuts with the operation, principal, site, counters and `snapback4 why <op>`;
repeats are suppressed per operation and site (at most two lines per minute),
with the suppressed count on the next emitted line. `serve` neither logs these
costs nor returns read meters.

Heap is a cumulative allocation and binding budget: constructed values,
concatenation and other allocating builtins, local bindings, and owned
copies count. Inspecting a held value's length or sum borrows it; row and
map clones share their immutable image. A heap cut stops a query immediately
with `data: null`, `complete: false`, and no continuation, since an interrupted
scalar or shape has no valid partial answer. Its cut site remains internal;
the meter is available only through dev's default read inspection (§4).
An unfinished maintained lookup or live aggregate uses the same unavailable
query result, preserving zero only for a completed missing-group lookup.
A mutation rolls back with `E_BOUND` as above.
`sha256(text)` charges the step meter by the input's UTF-8 byte length plus
one before hashing and charges its fixed 64-byte text result to the heap meter.
A step cut refuses a scalar query with `E_BOUND`; a cut on that result allocation
returns `data: null`, `complete: false`. A mutation rolls back on either cut.

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
For a page of 50 pinned by `conversationId`, either declare `c: cursor ?`
and page with `after c`, or add `cap 50 by conversationId` to the table if
that is the intended group limit. An unscoped plain page can use `cap 50`.
The cap refuses writes beyond its limit; a per-lane cap does not bound a merge.

When the same code and card occur twice in one text `check`, its card excerpt
prints once under the first occurrence, with the `guide:` pointer kept at
every site. At most three excerpts print per check, each at most 4,096 UTF-8
bytes including its full-card pointer and final newline (12,291 extra bytes
including separating blank lines). A single occurrence stays compact;
`check --json` keeps its structured diagnostics. `why <code>` still opens
the excerpt on demand. Every registered code has a dedicated paragraph on
its default card; `why <code>` names the code and explains it there.
For example, `E_QUARRY_SYNTAX` and `E_QUARRY_UNKNOWN` have mistake-and-repair
sections on `guide language`; `E_QUARRY_PLACEMENT` and `E_EMIT_IN_QUERY`
have theirs on `guide programs`. A diagnostic may point to another card
for its context; if that card lacks a section for the code, `check` keeps
the diagnostic and pointer without an excerpt. Explicit `why <code>`
then labels its fallback to that card's opening.

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
and replace held groups with their current acquisition. A device query returning
independent fields of a record can compose when one component retains history
and another needs the server. Each field may hold at most one read; the query
must be cursor-free, not declared `held`, and have no reading `require`.
A found point read of a delivered left row also composes; a missing point
keeps ordinary coverage and fallback. `check --residency` names the proven
components. The second local observation supplies every component that would
stay local as its own query; the one server reply supplies those that need it.
The composed read is `complete` only when the server answer and
every locally kept component are complete; it reports `fresh: false`, no `since`,
and no continuation. Offline or after a failed request, the whole local
answer stands.
Composition is never entered while a predictable write is unobserved; the whole local answer stands until it settles.
Every other shape keeps the separate-query recipe: keep a
left-group read in its own query, since a mixed query without a component
plan returns the whole server answer online when no predictable write is awaiting observation,
and the whole device answer offline.
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
Suppression is reader-dependent, even for an uncapped `sync public` table.
Eligible mutations that require whole-partition coverage can suppress this
advice. An absent note does not certify bounded acquisition or a safe
cold-start size.
Inspect the table's `sync`, horizon and group `cap` with `check --residency --verbose`.

`online only` optionally documents a table with no sync. On a `maintain`,
it opts out of inherited sync. `N_MAINTAIN_SYNCED` calls out public inherited
aggregates and group audiences with unbounded recipients or multiple values per group,
grouped into one note retaining each maintain's source location.
The note names mutations that would stop predicting if the maintain goes
`online only`; `snapback4 test --residency` measures its cold rows. `check`
prints the facts without pre-adoption counts: a new maintain has no stored rows yet.

`check --residency --verbose` lists every table's residency, inferred and inherited
audiences, and each operation's `runs: device | server` or
`predicts: eligible | never`. Read sites are `held`, `horizon` or `server`.
Each site names its read, write or rule's file:line:column when source is
available, including helper writes and after-insert rules. A source-less
fact names its rule or write path instead of an internal compiler site.
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

`test --residency --fixture dir [--as persona]` reports the eight costliest
acquired table/persona pairs, ordered by compact JSON row bytes, then rows,
with all omitted pairs summed into one line and totals that include them.
It measures the real cold partition snapshot, respecting authorization and
horizons; byte counts exclude transport framing and are not process RSS.
`check --residency --fixture dir --as persona` gives the same report where
builders already check their backend. Without a fixture, `check --residency`
measures the active dev-store schema read-only, without adopting current
source; without a dev store it says not measured and names the fixture command.
Use `--verbose` for all table counts, declared facts and notes; on `test` it
also runs the query meters as before. The default acquisition report fits
one screen even for hundreds of tables or personas. No count is extrapolated.

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
its post and repost cards. Its `createPost` inserts a reference event
in `feedPosts` and calls `feedDeliver(event)` in the same transaction.
Its `repost` resolves `feedPosts[original.authorId, postId, false]` and calls
`feedRepost(event.id)`. That helper takes `eventId: feedPosts`; the app post
reference and source event reference have different types and may have
different IDs. The app's
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
reposts, and a cursor query that runs on the device. On a successful 51st follow,
future events switch to broadcast; older events retain their delivery mode.
Promotion requires a pull route for every follower. The caller is checked first:
their own full 32 shared-author slots refuse `FEED_PULL_CAP`, and freeing their
own slot is the repair. If another follower's slots are full,
`FEED_PROMOTION_PULL_CAP` refuses the triggering
follow and promotion atomically, including the app edge, author mode, routes
and counts. Existing followers keep receiving private pushes. Show the refusal;
have each saturated follower unfollow a shared author to free a slot, then
retry the refused follow with a new write ID. Freeing the caller's slot cannot
fix another follower's full slots. If they cannot free a slot, decline the new
follow and keep pushed delivery; more than 32 shared authors needs a separate
serving design. Until every saturated follower frees a slot, every later follow
refuses the same way: the author stays at 50 followers and gains no new followers,
possibly indefinitely for a dormant blocker. The newcomer cannot free that slot.
A server-run query can identify the blocker for the author: `follows` and
`pullCounts` are both `public`. Scan the author's followers, then read each one's
`used`; after rollback, 51 reads (one scan plus 50 count lookups) identify those
at 32. An absent count means zero routes; installed prefixes use `feedFollows`
and `feedPullCounts`. See `guide feeds` for the indexed lookup path.
A saturated new follow of an already-shared author refuses
`FEED_PULL_CAP`, rolling back the app edge too. A saturated
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
  delete <- .readerId = viewer
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
  require authorId != viewer else FEED_CANNOT_FOLLOW_SELF
  a = authors[authorId] ! else FEED_AUTHOR_NOT_FOUND
  if exists follows[followerId = viewer, followedId = authorId]:
    return null
  if a.shared:
    require tryPull(viewer, authorId) else FEED_PULL_CAP
  insert follows { followerId: viewer, followedId: authorId, at: now }
  if not a.shared:
    near = follows[authorId] first 51 by byFollowed
    if count(near) > 50:
      -- Check the caller first so their own full slots name their own repair.
      require tryPull(viewer, authorId) else FEED_PULL_CAP
      update authors[authorId] { shared: true }
      tryPull(authorId, authorId)
      for f in follows[authorId] by byFollowed:
        require tryPull(f.followerId, authorId) else FEED_PROMOTION_PULL_CAP
  visited = 0
  for p in posts[authorId] last 1000 by byActorTime:
    if visited = 917:
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
  for e in feed[viewer, authorId] by byReaderActor:
    delete feed[e.id]
  if exists pulls[viewer, authorId]:
    delete pulls[viewer, authorId]
    slots = pullCounts[viewer] ! else FEED_PULL_COUNT_MISSING
    if slots.used = 1:
      delete pullCounts[viewer]
    else:
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
    for f in follows[viewer] by byFollowed:
      copy(p, f.followerId, false)
  return null

mutation createPost(postId: id):
  require not exists removedEvents[eventId = postId] else FEED_EVENT_REMOVED
  a = authors[viewer] ! else FEED_AUTHOR_NOT_FOUND
  p = insert posts { id: postId, postId, actorId: viewer, authorId: viewer, repost: false, at: now, shared: a.shared }
  deliver(p)
  return { id: p.id }

mutation repost(eventId: posts):
  original = posts[eventId] ! else FEED_POST_NOT_FOUND
  require not original.repost else FEED_ORIGINAL_REQUIRED
  if exists posts[viewer, original.postId, true]:
    return null
  a = authors[viewer] ! else FEED_AUTHOR_NOT_FOUND
  p = insert posts { postId: original.postId, actorId: viewer, authorId: original.authorId, repost: true, at: now, shared: a.shared }
  deliver(p)
  return { id: p.id }

fn removeEvent(p: posts):
  require p.actorId = viewer else FEED_NOT_AUTHOR
  insert removedEvents { id: p.id, eventId: p.id, actorId: viewer }
  if p.shared:
    delete broadcast[viewer, p.id]
  delete posts[p.id]
  return null

mutation deletePost(postId: posts):
  p = posts[postId]
  if p != null:
    require not p.repost else FEED_ORIGINAL_REQUIRED
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
    broadcast[p.authorId] for p in pulls[viewer] by byReaderAuthor

job purgeRemoved():
  chunk p in removedEvents first 1 by byId:
    for e in feed[p.eventId] by byEvent:
      delete feed[e.id]
    delete removedEvents[p.id]
schedule purgeRemovedEvery every 1m: purgeRemoved
```

All authored Following refusals use the reserved `FEED_` prefix; `why` explains
each on the feeds card without claiming generic application names.

The caps are explicit: 1,000 follows and source events per account,
50,000 private entries per reader, 32 pulled authors per reader and
32,000 public broadcast entries plus 32,000 pending removal tombstones
(1,000 per actor). Follow backfills from the last 917 source
events by default, or `clamp(authors, 200, 917)` with custom sizing;
caps refuse writes atomically when reached. The full recipe and
its measured tradeoffs are on the feeds card. Author modes, public follow
edges and public source references sync in full. Inbox entries and exact
pull routes are readable and synced only by their reader. The online-only
`pullCounts` table exposes each reader's installed-route count, not author
IDs, so promotion can refuse saturated followers atomically. The helpers update
it with each route insert/delete; direct imports must include matching counts.
The reader deletes their count row with their final route, releasing the
global accounting slot; remaining routes decrement it, and a later follow
creates it again.
This is an explicit aggregate disclosure. It adds no cold-sync rows.
`saveProfile`, `register`, `createPost`, `repost`, `deletePost` and `unrepost`
remain eligible when required cards and source events are held. `follow`
and `unfollow` queue without rows because slot accounting is online-only;
following backfills when the server commits it.
The inbox keeps its full capped partition for complete Following pages.
Edges carry `at: time default 0`, preserved on an idempotent follow.
Default global metadata caps are 1,000 authors, 100,000 edges, 32,000 pull routes
and 60,000 source references, plus 32,000 online count rows.
`init --recipe feeds --prefix feed --authors 1008 --edges 5921` sizes the
author and edge caps before replay; pull-route and online-count caps grow
together to 32 × authors. The backfill bound is `clamp(authors, 200, 917)`,
including 917 for an edges-only install with the default 1,000 authors.
The lower clamp preserves the earlier 200-event window; the upper bound
reserves 107 of the 1,024 mutation writes for promotion and the app edge.
A smaller backfill copies less history but still scans `last 1000` source
events, so it does not reduce that page's examined-row cost. Init
prints all caps and `backfill/author`, and incoherent sizing refuses
`E_RECIPE_CAPS` before writing. The app's own caps stay its responsibility;
`guide feeds` names the coupled bounds and what each costs.
After installing the recipe, init prints one cold-row measurement command:
`snapback4 test --residency --fixture <fixture-directory> --as <principal>`. Replace
both placeholders with an existing fixture path and principal; a missing
fixture directory refuses instead of measuring an empty store. Ordinary checks do
not repeat the pointer. The feeds card publishes `test --residency`
measurements: the wired 500-follow fixture acquires 3,095 rows / 335,403 B
(up from 1,055 rows); its 5-follow reader acquires 2,600 rows / 250,482 B.
At the calibration shape (1,008 authors, 5,921 edges, 50,228 app posts),
the wired 500-follow reader acquires **139,413 rows / 17,876,585 B**.
That is large, even with short text cards and no media. The feeds card
breaks down the measured cost and states the fixture's scope.
These counts apply to both predicting writes and queued follows; the fixture
has no pull routes. Both still read 20 complete entries with 82 examinations
and 21 probes. The larger 50,000-reference-event envelope acquires 77,665
rows for 500 follows, down from 78,566: 901 foreign pull routes no longer
arrive. Its five-follow and celebrity-plus-four readers acquire 52,915 and
52,866 rows, with 0 and 1 own pulls respectively. The feeds card records
the exact prediction boundary and acquisition tradeoff.

The feeds card's first Trending answer ranks posts younger than a day in
the like's own transaction: a value-indexed maintain merges 25 hour lanes,
with the exact trailing edge in `where`. It has one cursor for liked posts
and a separate bounded zero-like fill when the first page is short; score
changes can move rows between pages, so the cursor is not a snapshot.
The source rule pins principal to viewer, validates the copied post time,
keeps the pair unique and immutable, and admits the viewer's unlike.
No declared mutation accepts a score, time or hour. Ties use maintained id;
the maintain cannot expire or be capped, so historical liked groups stay.
With no source sync it is server-run; adding `sync public` on posts and
likes gives device reads and eligible likes after acquisition, with the
`N_MAINTAIN_SYNCED` disclosure that every group reaches every device.
`check --residency --verbose` shows the exact sites on the card.

For likes arriving in the trailing day on posts of any age, `rollingLikes()`
keeps the bounded live sort and sees expiry before a sweep on both device
stores. It selects at most 4,095 groups, paying one examination per group plus
its source rows under the shared 8,192 examined ceiling. Exceeding the candidate
bound returns accurately scored prefix winners with `complete: false`; an
unfinished count or the separate 16 MiB heap cut returns `data: null,
complete: false`. The default keeps these expiring likes private, reads on the
server and syncs only the last 2,000 posts on acquisition. Its public-like
variant explicitly removes that horizon and replicates full sources and count
groups, so both device stores can recompute expiry offline. A bounded post
sort such as `trendingNow()` pays two examinations per post plus any live
contributions; large post bodies can hit heap before its 4,095 candidate bound
(the 6,000-byte-body fixture fits 1,000 and cuts at 2,700). These bounds do not
apply to the indexed hour-lanes recipe. Remote writes still require sync.
The optional scheduled ranked-table recipe buys a score
computed by a job, such as a native scorer, or a stored page for a device
that cannot hold the maintain; it is neither fresh nor exact.
The card's `vote` predicts its first offline upsert when the post is held;
the viewer's votes have no horizon and are capped at 1,000 per viewer.

## N_PUBLIC_AGGREGATE_COPY: a public copy keeps ordinary write authority

N_PUBLIC_AGGREGATE_COPY is a note, not an error. A public column is assigned
directly from a declared `maintain`, but `insert <- allow` or `update <- allow`
(or a provably unrestricted equivalent) lets any principal set it through any
mutation that writes it. The column duplicates an aggregate the engine already
keeps. Read the maintain directly, or restrict both insert and update authority
so callers cannot choose the copied value. The fresh bounded Trending recipe
in `guide feeds` reads live counts and has no writable ranking table or copied score.

The client calls declared operations, not arbitrary table writes. This note
identifies latent table permission, not proof that a current mutation accepts
an arbitrary score. It covers direct scalar maintain-to-column assignments in
programs and helpers, including jobs, once per column and maintain. It does not
infer copies from names, matching group keys, increments, aliases or arithmetic.
Restricted rules, private targets and immutable columns do not receive it;
absence of the note is not a proof that a ranking cannot be forged. Sync and
`online only` do not change write authority.

## Client and operations reference

Continue with [the client, development, releases and Expo](./CLIENT-AND-OPERATIONS.md).
