# Quarry v0.3

Quarry is the only backend language. `check` compiles `.q` in memory, writes an
inspection copy in `.snapback/build/quarry/`, and puts no generated files in `snapback/`.

## Project

`snapback/schema.q` holds `use identity`, tables, maintains and channels.
Other `.q` files hold operations or reusable shapes; stems are API namespaces:
`snapback/messages.q` exports `api.messages.thread`.

TypeScript in `snapback/` is limited to `seed.ts`, `tests/*.test.ts`, and
modules exporting only effects. Effect bodies are JavaScript I/O; everything
else is Quarry. An effect module's stem must differ from every `.q` stem.

## Types and tables

Built-in virtual tables: `connected` supports only `exists connected[p]` and
`#connected[p]` for `p: principal`; see `guide connected`.

Columns and arguments use `principal`, `id`, table references, `int`, `time`,
`bool`, `decimal <scale>`, `money <CUR> [scale]`, `text <=N`, `text M..N`,
`json <=N`, `bytes <=N`, `enum(...)`, and bounded lists `[type] <=N`. Decimal
and money scales are integers 0–12 (money defaults to 2; currency is three
uppercase letters). `?` is optional. Text may add `format handle`/`format url`
after its bound; minimums and formats are enforced, maximums stay part of the type.
Text forbids C0 controls except tab, LF, and CR.

`image <=N` is a byte-bounded closed record `{ id, width, height }`; `video <=N`
adds integer-millisecond `duration`. Both admit `?` and bounded lists, but no
indexes or `maintain.by`. `once` is image-column-only, never on arguments.
Authenticated readers get one original 200, `private, no-store`; anonymous gets
404 even on public rows. HEAD is free; width, Range and conditionals cannot
bypass 410 `E_ASSET_VIEWED` (`guide operator` recovers). Adding `once` leaves
prior views unrecorded; removing it is destructive.

```q
mutation inspect(photo: image <=5000000, clip: video <=50000000):
  require clip.duration <= 60000 else TOO_LONG
  return { photo, width: photo.width, clip }
```

Decimal/money literals are whole units (`2.50` → `250`); excess precision
refuses. Matching brands admit `+ - < <= > >= = != min max`; unary `-` and `* int`
preserve them. Money × decimal → money either order; decimal ×
decimal → left brand; money × money refuses.
`/` and `%` rewrite to `divmod(a, b).quotient` and `.remainder`.

`divmod(a,int)` keeps numeric brands; time gives int. It is Euclidean: remainder is
nonnegative; quotient floors for positive divisors. `share` keeps the amount
brand, needs matching bounded recipients, and assigns remainder units by
ascending value. Share and branded multiplication floor; i53 products can
overflow. Wire arguments use integer minor units; seeds use whole-unit JSON
numbers or decimal strings (exponent notation and excess precision refuse).
Shaped rows and pages keep their brands.

`principal` is the nominal type of `viewer`, distinct from table references and
`id` despite the shared wire shape; a column compared with or assigned `viewer`
must be `principal`. A non-empty text literal in an Id position (key, merge
prefix, equality, `??` fallback) is an Id on the wire; text expressions and
wrong-table refs refuse. A cursor position takes the opaque token, never an Id
literal.

Tables get `id` and `byId` implicitly. `by name: a, b` declares a named
ordering; `by a, b` infers `byAB`. `unique name: a, b` declares a named unique
ordering and its uniqueness constraint; `unique a, b` infers `byAB`. `id` may
appear in an index. `immutable a, b` forbids changes to those columns.
`cap N by a, b` holds every group at N rows (an omitted optional column is the
`null` group); every writer, seeds included, refuses past it, naming the cap and
group; a successor leaving a group over N names the groups and the cap to raise;
only writes that may touch its grouping columns reserve the probe. `public`
accepts an optional reason string. An insert postcondition is
`after insert <- exists table[...] [by index]`.

`retain delivered-history` keeps rows that went hidden; the default evicts them.
`tombstones messages[.messageId] if .kind = 'removed' or .kind = 'expired'` on a
log table names, per delivered row, the `messages` row `.messageId` references;
when it holds the client evicts it before an absence proves it. The column must
reference the target; the predicate reads only this table's `enum`, `bool`, and
`text` columns with `=`, `!=`, `and`, `or`, `not`; several lines union.

Rules are `allow`, `deny`, `public`, `exists`, `created`, `and`,
`or`, `not`, and `=`/`!=` over `viewer`, literals, `.field`, and channel
arguments. `created` is insert-only. Table rules omit a binder (`read <- …`):
`.` is the row, or the candidate image for update; only `update (old, next)`
names binders. Rule `exists`/`created` accepts any index whose leading columns
match the key; when several match, add `by index`. Parentheses allow multiline rules.
Self-probes on a full unique key of nonoptional columns are uniform over own rows;
so is an `or` with an arm proven true by the prefix.

`use identity` enables passwords and guests; `use identity password` or
`use identity guests` selects one.

## Maintains

`maintain` builds count/sum targets with the source's group types: count is int; sum
value matches its int/decimal/money source. The group
index is unique; the block gives its read rule; user writes are denied.

The optional `readable <- rule` is a deliberate aggregate disclosure:
certification may read a maintained summary where scanning the raw source has
no uniform read rule, listed on the certificate as `E_DISCLOSURE`; the target
table's ordinary `read` rule still applies.

`total[key]` reads the target row through the unique grouping index.
`#total[key]` yields its typed value or typed zero when absent/unreadable. A
later `#` read in a mutation reflects its earlier writes.

```q
maintain messageCounts = count messages by conversationId:
  read <- exists memberships[.conversationId, viewer]
```

## Programs

Keys are positional (`table[value, …]`) or named (`table[column = value, …]`);
point reads need a complete unique key and may add `by index`; `exists
table[keys]` accepts an index prefix. Range order is `[after cursor] first|last
N [by index]`; repeats/permutations refuse. Shapes use `{ * }`,
bare fields, or `name: expression`; nested point reads keep the page's
`complete`/`capped` state; hidden rows yield `null`; any early exit,
count, or `require` refuses. Byte ceilings price canonical JSON by selected fields (`*` selects all),
at declared maxima (text: `4·max + 16` bytes). `first N` scans ascending; `last N` scans descending.

`shape card = { fields }` defines a reusable shape for `row card`, `page card`,
or a field value; `...card` splices it. `shape card from cards` imports
from `cards.q`; shape-only modules add no API operations. Nested shapes resolve
in their defining module and see the focal row and context built-ins, never
caller arguments or locals. Expansion keeps definition sites, refuses cycles,
and is bounded (depth 8, 4,096 nodes).

`after` follows scan order: `after c` with `c: cursor ?`; `null` starts page one.
Pass `next` unchanged. It encodes table/index/order, typed suffix, and last returned
row, never a hidden position. `E_INPUT` rejects noncanonical arguments before
execution and scope mismatches before the selected page or merge discovery.
Tokens may cross sites; indexes must end in `id` or be unique.

An `if`/`else` can return a range or merge through aliases and shapes.
`next` follows that return, never an auxiliary read; shapes may omit index
columns. Reset `c` when changing index/order. Non-page and local `partial`
results have no continuation.

`merge table [after cursor] first|last N by index:` fan-ins one or more structurally
distinct `[prefix keys]` lanes (named or positional), optionally `for name in` a
bounded range. Prefixes share widths/types and leave a suffix; equal prefixes and
bounds collapse. A heap merges SQLite streams by suffix, deduplicates `id`,
and returns N rows. Uniform cost is at most L heads + N advances + 2 lookahead, plus
discovery; non-uniform lanes keep per-lane reserves. Retention prices heads,
discovery, page, and lookahead. Local merges need a certificate.
System reads bypass rule-based capping; execution limits still cap.
No runtime lanes: empty page. Shapes, `for`, and `count` work as for
ranges. A pageable index ends in `id`; one shared cursor applies to every lane.

```q
query followingFeed(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 50 by byFollower
  return page { post: ., author: profiles[.author] authorCard }
```

The recipe admits 50 follows; more reports `capped`. A merge is `complete` only
when every lane exhausted and the deduplicated union had at most N rows.

`require condition else CODE` aborts when false. `match read: some name: … none: …`
branches on presence; it is a statement, not a binding expression. Other statements
bind expressions or `sorted` tuples, `return`, `if/else`, or bounded `for`;
`return` works in all arms and a body's last expression is an implicit return.

Object literals work anywhere; `{ id: conversationId, creatorMembershipId }`
uses shorthand. `count(x)` is
`x.length` for bounded lists and pages. Other built-ins are `range`,
`min`, `max`, `divmod`, `share`, and `words`. `sorted` is only `(lo, hi) = sorted(a, b)`.
`!` or `! else CODE` requires a present value; `??` supplies a fallback. Program `=`/`!=` are total: absent equals absent, differs from present;
`!=` is `not (=)`. Ordered comparison refuses an optional operand;
use `!` or `??` first. `if x != null:` narrows a bound name or one-hop row field in that branch
only, not an `and` operand or the else.

`words(text)` yields bounded ASCII whole words; `tokens(text)` extracts `@` mentions.
`words` refuses `+`/template-built text: pass a declared `body: text <=N` argument
or column; `guide live-query` has indexing and editing.

`now` is the read clock in queries and the commit clock in mutations; `commit` is
the commit clock, the same instant in mutations. `now` is pinned
once per request rather than redrawn; `new` allocates a fresh ID on each
evaluation.

Writes are `insert table { fields }`, `update table[key] { patch }`,
`upsert table[key] { row }`, and `delete table[key]`; a non-insert key is any
complete unique key, composite alternate keys included. Alternate-key update and delete
read the unique index once, require the row (`NOT_FOUND`), and write the base
table by its intrinsic `id`; alternate-key upsert writes by the matched `id` or
a fresh `new` id.

Key expressions are evaluated once. An upsert injects omitted key columns from
them; a row or patch may spell a key column only with the same expression as
the key, otherwise `E_QUARRY_TYPE` at that field with a drop-field rewrite. An
upsert row may not spell `id`: by-id derives it from the key; alternate-key
keeps a present row's id or mints one on the absent insert branch. Insert yields
the inserted row. Binding or returning an update/upsert reads its result once,
right after the write: the row, or absence if its read rule now denies the
caller. Use `! else CODE` to require that view; its refusal rolls back the
mutation. Ignored update/upsert statements add no result read. Delete yields no
value. A body's final write is an implicit return.

## Effects

A TypeScript module exports the effect body and imports its `then` mutation
from the Quarry file's virtual module, as the chat template does.

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
exports `notify = effect({ grants, run, then: recordNotified })`; `run` does I/O
with its granted `fetch`, and `meta.id` is its idempotency key. `snapback2 guide
effects` has the executable recipe.

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
absent, including in objects, updates, and calls; bases evaluate once in their
branch. `!` names a refusal and `??` handles absence. Every missing update or
delete is `NOT_FOUND`; upsert keeps its absent insert branch. Unreadable by id
→ `E_RULE`; unreadable by alternate key → `NOT_FOUND`. A missing maintained
group is zero only through `#`; the ordinary target-table read stays absent.

Scans, lists, text, JSON, and bytes are bounded. `for` iterates only a bounded
list/page/range/tokens/words result; optional lists require `?? []` or `if` presence narrowing.
List-column maxima survive aliases and shapes; JSON supplies no list bound.
Ceiling refusals price sites and fields: merges need structural repair
(smaller lanes/page, two reads/two snapshots, or a maintained feed), caps a fitting
chunk, nested scans `maintain.count/sum`, byte bounds narrower collections/fields,
and non-uniform reserves a uniform prefix; never a pasted `return null;`.
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
order; row-dependent predicates stay refused; after changing an index, restart
pagination with an absent cursor. Other predicates name the index, an invariant
(`after insert <- exists …`), or `merge`.

Index-selection refusals list catalog keys and types, plus an executable
replacement when exactly one fits.

## Jobs and schedules

`job name(args):` holds independent `chunk row in table[prefix] first N by index:`
blocks over immutable, total keys; `guide job`. `schedule name on table at
.column [if predicate]: target(args)` fires per row when its `time ?` column is
reached; `schedule name every <Nm|Nh|Nd>: target` fires per period
(`guide schedule`).
