# Quarry v0.3

Quarry is Snapback 2's only backend authoring language. It is a bounded
front end to the compiler, checker, evaluator, and server. `snapback2 check`
compiles `.q` in memory; it
does not place generated files in `snapback/`. `snapback2 check` writes an inspection copy under `.snapback/build/quarry/`.

## Project

A project has one schema, `snapback/schema.q`. Declarations (`use identity`,
tables, maintains, channels) belong only there. Other `.q` files declare
operations or reusable shapes; operation stems are API namespaces. Thus
`snapback/messages.q` exports `api.messages.thread`.

TypeScript under `snapback/` is limited to `seed.ts`, `tests/*.test.ts`, and
effect modules that export effects only. Effect bodies remain JavaScript I/O;
tables, rules, channels, maintains, queries, and mutations are Quarry. An
effect module's stem must differ from every `.q` stem.

## Types and tables

Columns and arguments use `principal`, `id`, table references, `int`, `time`,
`bool`, `decimal <scale>`, `money <CUR> [scale]`, `text <=N`, `text M..N`,
`json <=N`, `bytes <=N`, `enum(...)`, and bounded lists `[type] <=N`. Decimal
and money scales are integers from 0 through 12; money defaults to scale 2 and
its currency is exactly three uppercase letters. Add `?` for optional. Text
can add `format handle` or `format url` after its bound. A minimum and a format
become enforced text constraints; maximums remain part of the column type.
Text values may not contain C0 control characters other than tab, newline,
and carriage return.

`image <=N` is a byte-bounded closed record `{ id, width, height }`; `video <=N`
adds integer-millisecond `duration`. Both compose with `?` and bounded lists,
and their fields work in expressions. Asset columns cannot be indexed or used
in `maintain.by`.

```q
mutation inspect(photo: image <=5000000, clip: video <=50000000):
  require clip.duration <= 60000 else TOO_LONG
  return { photo, width: photo.width, clip }
```

Decimal/money literals are whole units (`2.50` → `250`); excess precision
refuses. Matching nominal brands admit `+ - < <= > >= = != min max`; unary
`-`/`* int` preserve them. Money × decimal → money either order; decimal ×
decimal → left brand; money × money refuses.
`/` and `%` rewrite to `divmod(a, b).quotient` and `.remainder`.

`divmod(a,int)` returns `a`-branded fields and is Euclidean: remainder is
nonnegative; quotient equals floor for positive divisors. `share` keeps the
amount brand, requires matching bounded recipients, and assigns remainder units
by ascending value. Share/branded multiplication floor because divisors are
positive; i53 products can overflow. Wire arguments use integer minor units.
Decimal/money seeds use whole-unit JSON numbers or decimal strings and are
exactly normalized to minor units; exponent notation and excess precision refuse.
Shaped rows and pages are typed and keep their brands.

`principal` is the nominal type of `viewer`. It is neither a table reference
nor `id`, even though all three have ID-shaped wire values. A column compared
with `viewer`, or assigned `viewer`, must be `principal`.
A text literal in an Id position (key, cursor, equality, or `??` fallback) is
an Id value on the wire.

Tables get `id` and `byId` implicitly. `by name: a, b` declares a named
ordering; `by a, b` infers `byAB`. `unique name: a, b` declares a named unique
ordering and its uniqueness constraint; `unique a, b` infers `byAB`. `id` may
appear in an index. `immutable a, b` forbids changes to those columns.
`cap N by a, b` holds every group at N rows (an omitted optional column is the
`null` group); every writer, seeds included, refuses past it, and a successor
that would leave a group over N refuses, naming the groups and the cap to raise. `public`
accepts an optional reason string. An insert
postcondition is `after insert <- exists table[...] [by index]`.

`retain delivered-history` keeps rows that went hidden; the default evicts them.

Rules are `allow`, `deny`, `public`, `exists`, `created`, `and`,
`or`, `not`, and `=`/`!=` over `viewer`, literals, `.field`, and channel
arguments. `created` is insert-only. Table rules omit a binder (`read <- …`);
`.` is the row, or the candidate image for update. Only `update (old, next)`
names binders.
Rule `exists`/`created` accepts any index whose leading columns match the key;
when several match, add `by index`. Parentheses allow multiline rules.
Reciprocal references and rule dependencies are supported.

`use identity` enables passwords and guests. `use identity password` and
`use identity guests` select only that method.

## Maintains

`maintain` builds count/sum targets with the source's group types: count is int; sum
value matches its int/decimal/money source. The group
index is unique; the block gives its read rule; user writes are denied.

The optional `readable <- rule` is a deliberate aggregate disclosure. It
allows certification to rely on reading a maintained summary when scanning
the raw source would not have a uniform read rule; the certificate lists that
choice as `E_DISCLOSURE`. It does not replace the target table's ordinary
`read` rule.

`total[key]` reads the target row through the unique grouping index.
`#total[key]` yields its typed value or typed zero when absent/unreadable. A
later `#` read in a mutation reflects its earlier writes.

```q
maintain messageCounts = count messages by conversationId:
  read <- exists memberships[.conversationId, viewer]
```

## Programs

Keys are positional (`table[value, …]`) or named
(`table[column = value, …]`), as in `users[principal = viewer]`. Point reads
need a complete unique key. Range order is `[after cursor] first|last N
[by index]`; repeats/permutations refuse. Point reads may add
`by index`; `exists table[keys]` accepts an index prefix. Shapes use `{ * }`,
bare fields, or `name: expression`; nested work stays bounded. Byte ceilings
bound canonical JSON: a shape is priced by the fields it selects and `*` by
every column at its declared maximum (text at `4·max + 16` bytes), so focused
shapes certify larger pages. `first N` scans ascending; `last N` scans descending.

`shape card = { fields }` defines a reusable shape for `row card`, `page card`,
or a field value; `...card` splices it. `shape card from cards` imports
from `cards.q`; shape-only modules add no API operations. Nested shapes resolve
in their defining module. Shapes use the focal row and context built-ins, never
caller arguments or locals. Expansion retains definition sites, refuses cycles,
and is bounded by depth 8 and 4,096 expanded nodes.

A pageable query declares `c: cursor ?` and reads `after c`; absent means page
one. `complete` and `capped` results carry `next`, either a server-minted opaque
cursor or `null`. Pass it back unchanged. It encodes the table, index, order,
typed post-prefix suffix, and last returned row—never a hidden examined
position. A mismatched or noncanonical token is `E_INPUT` before any scan.
Tokens are not operation-site-bound. The index must be total (end in `id` or be
unique); `after` follows scan order.

`merge table [after cursor] first|last N by index:` fan-ins one or more
indented lanes. Each lane is `[prefix keys]`, optionally `for name in` a bounded
range read. Prefixes must have equal widths and types, leave an index suffix,
and not be structurally identical. Quarry scans every lane at N, concatenates,
sorts by the shared suffix, deduplicates intrinsic `id` keeping the first row,
then returns the first N as a page. Shapes, `for`, and `count` work as for a
range page; an unshaped API result uses the table's row type. A pageable merge
index ends in `id`; its shared cursor is applied unchanged to every lane.

```q
query followingFeed(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 50 by byFollower
  return page { post: ., author: profiles[.author] authorCard }
```

This recipe admits at most 50 follow rows. The query reports `capped` when that
domain hits its limit; it does not meet a product that must cover larger follow
graphs. A merge is `complete` only when every member lane scan exhausted and
the deduplicated union had at most N rows; otherwise it is `capped`.

`require condition else CODE` aborts when false. `match read: some name: … none: …`
branches on presence; it is a statement, not a binding expression. Other statements
bind expressions or `sorted` tuples, `return`, `if/else`, or bounded `for`.
`return` works in all arms; a body's last expression is an implicit return.

Object literals work anywhere expressions do; `{ id: conversationId,
creatorMembershipId }` uses shorthand for the second field. `count(x)` is
`x.length` for bounded lists and pages. Other built-ins are `range`,
`min`, `max`, `divmod`, and `share`. `sorted` is only the two-name form
`(lo, hi) = sorted(a, b)`. `walk table[seed] up .parent depth N` is bounded.
`!` or `! else CODE` requires a present value; `??` supplies an absence
fallback. Program `=`/`!=` are total: absent equals absent and differs from
present; `!=` is `not (=)`. Ordered comparison refuses an optional operand;
use `!` or `??` first. A direct `if x != null:` narrows a bound name or one-hop
row field in that then branch; it does not narrow an `and` operand or the else.
Conditions require Booleans.

`tokens(text)` splits on whitespace, preserving case, punctuation and duplicates;
it is not a word-search tokenizer.

`now` is the read clock in queries and the commit clock in mutations; `commit`
is the commit clock. In a mutation they are the same instant. `now` is pinned
once per request rather than redrawn; `new` allocates a fresh ID on each
evaluation.

Writes are `insert table { fields }`, `update table[key] { patch }`,
`upsert table[key] { row }`, and `delete table[key]`; a non-insert key is any
complete unique key, composite alternate keys included. Alternate-key update
and delete read the unique index once, require the row (`NOT_FOUND`), and write
the base table by its intrinsic `id`; alternate-key upsert passes the matched
`id`, or a fresh `new` id, to the platform's scalar-key `db.upsert`.

Key expressions are evaluated once. An upsert injects omitted key columns from
them; a row or patch may spell a key column only with the same expression as
the key, otherwise `E_QUARRY_TYPE` at that field with a drop-field rewrite. An
upsert row may not spell `id`: by-id derives it from the key; alternate-key
keeps a present row's id or mints one on the absent insert branch. Insert yields
the inserted row. Binding or returning an update/upsert reads its result once,
immediately after the write: a row snapshot, or absence if its read rule denies
the caller (including self-revocation). Use `! else CODE` to require that view;
its refusal rolls back the mutation. Ignored update/upsert statements add no
result read. Delete yields no value. Keys, row expressions, and inline `new`
are evaluated once. A body's final write expression is an implicit return.

## Effects

A TypeScript module exports the effect body and imports its `then` mutation
from the virtual module emitted for a Quarry file. The chat template splits
the two declarations this way.

`snapback/notifications.q`:

```q
mutation recordNotified(outboxId: id, effect: text <=100, result: json <=1000):
  insert notifications {
    outboxId,
    effect,
    providerId: result.providerId,
  }
  return true
```

`snapback/delivery.ts` imports `recordNotified` from `./notifications` and
exports `notify = effect({ grants, run, then: recordNotified })`. The `run`
body performs I/O using its granted `fetch`; `meta.id` is its idempotency key.
See `snapback2 guide effects` for the executable TypeScript recipe.

`snapback/messages.q`:

```q
effect notify from delivery

query thread(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  return messages[conversationId] after c last 50

query summary(conversationId: conversations):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  return {
    conversation: conversations[conversationId],
    messageCount: messageCounts[conversationId],
  }

mutation send(conversationId: conversations, recipientId: profiles, body: text <=4000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  recipient = profiles[recipientId] ! else RECIPIENT_UNKNOWN
  require exists memberships[conversationId, recipient.principal] else RECIPIENT_NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, photo: null, clip: null, at: now }
  for m in memberships[conversationId] first 50 by byConversationPrincipal:
    insert deliveries { recipient: m.principal, conversationId, messageId: row.id, kind: 'message', at: now }
  emit notify { to: recipient.principal, body }
  return { id: row.id }
```

The loop covers the group because memberships is capped at 50 per conversation.

Edit/unsend target current members. Departed recipients evict unsent bodies by
point absence on held-page revalidation, not tombstones (LLP 1012 §5).

## Absence and bounds

Point reads return a row or absence; absent shapes and optional members stay
absent. `!` names a refusal and `??` handles absence. Every missing update or
delete is `NOT_FOUND`; upsert keeps its absent insert branch. The residual
existence-oracle case is by-id unreadable → `E_RULE`, alternate-key unreadable
→ `NOT_FOUND`. A
missing maintained group is zero only through `#`; the ordinary target-table
read remains absent.

Every scan, list, text, JSON, and bytes value is bounded. `for` iterates only
a bounded list/page/range/tokens result. Lowered queries and mutations retain
the same certificate, trace, and runtime budgets.
In a mutation, `for` over a page must cover its range: the table is capped over
the pinned prefix, the rule is uniform there, the bound is a literal at least the
cap, and no scan in the mutation is non-uniform. Cursors and key ranges cut the
range and refuse too. Otherwise `E_STRUCTURAL_FANOUT`; fan-out past a cap is
LLP 1016's continuation.

## Refused platform gaps

Refused (`E_QUARRY_UNSUPPORTED`): `where`, `device`, `oblivious`, `while`,
functions, recursion — pass bounded arguments; loop with bounded `for`/`walk`.
An equality-conjunction `where` over indexable columns returns two repairs: the
schema index line and the indexed prefix read. Repairs keep named keys and sort
order; row-dependent predicates stay refused. After changing an index, restart
pagination with an absent cursor. Other predicates name the index, invariant
(`after insert <- exists …`), or `merge` alternatives.

Writes through a non-unique or incomplete key are index-selection refusals.

## Jobs and schedules

`job name(args):` holds independent `chunk row in table[prefix] first N by index:`
blocks over immutable, total keys; `guide job`. `schedule name on table at
.column [if predicate]: target(args)` fires per row when its `time ?` column is
reached; `schedule name every <Nm|Nh|Nd>: target` fires per period
(`guide schedule`).
