# Quarry v0.3

Quarry is the backend language. `check` compiles in memory; inspection goes in
`.snapback/build/quarry/`, never `snapback/`.

## Project

`snapback/schema.q` holds `use identity`, tables, maintains and channels.
Stems name API namespaces:
`messages.q` exports `api.messages.thread`.

TypeScript is only seeds, tests, and effect I/O. Effect/`.q` stems differ.

## Types and tables

Virtual `connected[p]` yields the int connection count for `p: principal`;
`exists connected[p]` tests presence; see `guide connected`.

Columns and arguments use `principal`, `id`, table references, `int`, `time`,
`bool`, `decimal <scale>`, `money <CUR> [scale]`, `text <=N`, `text M..N`,
`json <=N`, `bytes <=N`, `enum(...)`, and bounded lists `[type] <=N`. Decimal
and money scales are integers 0–12 (money defaults to 2; its currency is three
uppercase letters). Add `?` for optional. Text may add `format handle`/`format url` after its bound; minimums and
formats are enforced, maximums stay part of the type.
Text forbids C0 controls but tab, LF, CR.

`image <=N` is a byte-bounded closed record `{ id, width, height }`; `video <=N`
adds integer-millisecond `duration`. Both admit `?` and bounded lists, but no
indexes or `maintain.by`. `once` is image-column-only, never on arguments.
Authenticated readers get one original 200, `private, no-store`;
anonymous gets 404 on public rows too. HEAD is free; width, Range and
conditionals cannot bypass 410 `E_ASSET_VIEWED`. Add `once`: prior views unrecorded; removal is destructive.

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

`divmod(a,int)` keeps numeric brands; time gives int. Euclidean remainder is
nonnegative; quotient floors for positive divisors. `share` keeps the amount
brand, needs matching bounded recipients, and gives remainder units in ascending
value order. Wire arguments use integer minor units; seeds normalize
whole-unit JSON numbers or decimal strings, refusing exponents and excess precision.
Typed decimal/money boundaries scale whole-unit literals once: an absent
`[decimal 3]? ?? [2,3]` yields `[2000,3000]`; supplied `[1250]` and untyped
`[2,3]` stay unchanged. Captures, returns, writes, shapes, and pages keep one
representation.

`viewer` is a nominal `principal`, distinct from table references and `id`
despite the shared wire shape. Columns used with `viewer` must be `principal`.
A non-empty text literal in an Id position (key, merge prefix, equality,
or `??` fallback) is an Id on the wire; text expressions and wrong-table refs
refuse. A cursor position takes the token, never an Id literal.

Tables get `id` and `byId` implicitly. `by name: a, b` declares a named
ordering. `unique name: a, b` declares a named unique
ordering and its uniqueness constraint. Declarations name their indexes;
unnamed indexes refuse with an inferred-name repair. `id` may
appear in an index. `immutable a, b` forbids changes to those columns.
`cap N by a, b` holds every group at N rows (an omitted optional column is the
`null` group); every writer, seeds included, refuses past it, naming the cap and group; a
successor that leaves a group over N refuses, naming the groups and the cap to raise; only
inserts, upserts, and updates that may write its grouping columns reserve the cap probe. `public`
accepts an optional reason string. An insert
postcondition is `after insert <- exists table[...] [by index]`.

`retain delivered-history` keeps rows that went hidden; the default evicts them.
`tombstones messages[.messageId] if .kind = 'removed' or .kind = 'expired'`
declares delivered-row eviction. Its column references the target; its predicate
uses this table's `enum`/`bool`/`text`, literals, `=`, `!=`, `and`, `or`, `not`,
and parentheses. Lines union. Schema hash/certificate bind owner and twin.

Rules are `allow`, `deny`, `public`, `exists`, `created`, `and`,
`or`, `not`, and `=`/`!=` over `viewer`, literals, `.field`, and channel
arguments. `created` is insert-only. Table rules omit a binder (`read <- …`);
`.` is the row, or the candidate image for update. Only `update (old, next)`
names binders.
Rule `exists`/`created` accepts any index whose leading columns match the key;
when several match, add `by index`. Parentheses allow multiline rules.
Self-probes on a full unique key of nonoptional columns are uniform over own rows;
so is an `or` with an arm proven true by the prefix.

`use identity` enables passwords and guests; `use identity password` or
`use identity guests` selects one.

## Maintains

`maintain` builds count/sum targets with source group types: count is int;
sum matches its source. Each has a unique group index and read rule; user writes refuse.

`readable <- rule` permits certification over non-uniform sources (`E_DISCLOSURE`);
the target's `read` still applies.

`total[key]` yields its value or typed zero if absent/unreadable, reflecting
earlier mutation writes. Program point reads and their API types see values;
`data` and rules see rows; bounded ranges keep rows/pages.
For `c: counts`, `c.value`/`c { * }` (aliases/named shapes too) refuse:
use `counts[c]` or, if optional, `counts[c ! else CODE]`.

```q
maintain messageCounts = count messages by conversationId:
  read <- exists memberships[.conversationId, viewer]
```

## Programs

Keys are positional (`table[value, …]`) or named (`table[column = value, …]`).
Point reads need a unique key; `exists` accepts a prefix. `by index`
disambiguates. Range syntax is `[after cursor] first|last N [by index]`;
repeats/permutations refuse. `first` is ascending. `last` is descending.
Shapes use `{ * }`, fields, or `name: expression`. Nested point reads preserve
page `complete`/`capped`; hidden rows yield `null`. Early exit, count or `require`
inside a shape refuses. Canonical JSON byte bounds price selected fields
(`*` selects all) at declared maxima (text: `4·max + 16`).

`shape card = { fields }` works on rows/pages/fields; `...card` splices it and
`shape card from cards` imports it. Shapes use their defining module's focal
row/context, never caller locals. Cycles, depth >8, and >4,096 nodes refuse.

`fn member(c: conversations, p: principal) = exists memberships[c,p]` is an
expression helper; `fn member from access` imports it. Arguments evaluate once
left-to-right. Parameters, context, and bounded reads are valid; capture,
allocation, commit time, writes, assertions, and recursion refuse. Callers own
their `require`/`! else CODE`.

`proc deliver(c: conversations, id: messages, kind: enum('message')):` and a
block declare a statement helper; `proc deliver from access` imports it;
`deliver(c, row.id, 'message')` on its own line calls it. The body elaborates
at each call in the caller's context: parameters bind once, caller locals are
invisible, writes, `emit`, and `require` bind where the caller allows, `return`
refuses, and a parameter's type is the priced bound.

`after` follows scan order: `after c` with `c: cursor ?`; `null` starts page one.
Pass `next` unchanged. It encodes table/index/order, typed suffix, and last returned row. `E_INPUT` rejects noncanonical arguments before
execution and scope mismatches before the selected page or merge discovery.
Tokens cross sites; indexes end in `id` or are unique.

An `if`/`else` can return a range or merge through aliases and shapes.
`next` follows that return, never an auxiliary read; shapes may omit index
columns. Reset `c` when changing index/order. Non-page and local `partial`
results have no continuation.

`{messages,count,preview}` is one outcome without root continuation; nested
bounded arrays are not drainable. Missing count authority makes the whole record
partial (chat `conversationView`).

`merge table [after cursor] first|last N by index:` combines structurally
distinct `[prefix keys]` lanes (named or positional), optionally `for name in`
a bounded range. Prefixes share widths/types and leave a suffix; equal prefixes
and bounds collapse. SQLite streams merge by suffix, deduplicate `id`, and
return N rows; cost is L heads + N advances + 2 lookahead + discovery,
non-uniform lanes keeping per-lane reserves, all priced by retention.
Local merges need a certificate. System reads bypass rule capping, not execution
limits. No lanes yields an empty page. Shapes, `for`, and `count` work
as for ranges. Pageable indexes end in `id`; one cursor applies to every lane.

```q
query followingFeed(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 50 by byFollower
  return page { post: ., author: profiles[.author] authorCard }
```

The recipe admits 50 follows; more is `capped`. `complete` requires exhausted
lanes and at most N rows in their deduplicated union.

`require condition else CODE` aborts when false. Other statements
bind expressions or `sorted` tuples, `return`, `if/else`, or bounded `for`;
`return` works in all arms and a body's last expression is an implicit return.

Objects allow shorthand: `{ id: conversationId, creatorMembershipId }`.
`count(x)` is
`x.length` for bounded lists and pages. Bindings and captured list fields keep their selected element count;
a field named `length` stays that field. Other built-ins are `range`,
`min`, `max`, `divmod`, and `share`. `sorted` is only `(lo, hi) = sorted(a, b)`:
it evaluates `a` then `b` once and returns the values in canonical scalar order.
`! else CODE` requires presence; bare `!` refuses with that repair.
`??` supplies a fallback. Program `=`/`!=` are total: absent equals absent, differs from present;
`!=` is `not (=)`. Ordered comparison refuses an optional operand;
use `! else CODE`, `??`, or narrowing first. `if x != null:` narrows a bound
name or one-hop row field in its then branch; `if x = null:` narrows the else.
`x != null and R` narrows R and evaluates its reads only when reached;
`require x != null else CODE` narrows the rest of its block.

`walk table[seed] up .column depth N` follows at most N parent links.

`tokens(text)` extracts `@` mentions. Search uses a schema
`wordPrefixes(field)` index and an ordinary bounded prefix read; there is no
public `words()` value function. See `guide live-query` for indexing and editing.

`now` is the read clock in queries and the commit clock in mutations; `commit` is
the commit clock, the same instant in mutations. `now` is pinned
once per request rather than redrawn; `new` allocates a fresh ID on each
evaluation.

Writes: `insert table { fields }`, `update table[key] { patch }`,
`upsert table[key] { row }`, `delete table[key]`. Non-insert keys must be complete
unique keys, including composite alternatives. Alternate-key update/delete
read once, require the row (`NOT_FOUND`), then write by `id`.

Keys evaluate once and supply omitted upsert key columns. A row/patch may repeat
a key column only with its key expression; otherwise `E_QUARRY_TYPE` names the
field to remove. Upsert cannot spell `id`: by-id uses the key; alternate-key
keeps a hit's id or mints one.
Insert yields its row. A bound or returned update/upsert reads its result once
right after writing: a snapshot, or absence when its read rule denies the
caller (including self-revocation). `! else CODE` requires that view and
rolls back on refusal. Ignored update/upsert adds no result read. Delete yields
no value. A body's final write is an implicit return; never in a proc.

## Effects

TypeScript exports the effect body and imports its `then` mutation from a
Quarry file's virtual module, as in the chat template.

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
fn isMember from access
proc deliver from access

query thread(conversationId: conversations, c: cursor ?):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  return messages[conversationId] after c last 50

```

Send:

```q
mutation send(conversationId: conversations, recipientId: profiles, body: text <=4000):
  require isMember(conversationId, viewer) else NOT_MEMBER
  recipient = profiles[recipientId] ! else RECIPIENT_UNKNOWN
  require isMember(conversationId, recipient.principal) else RECIPIENT_NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, photo: null, clip: null, at: now }
  deliver(conversationId, row.id, 'message')
  emit notify { to: recipient.principal, body }
  return { id: row.id }
```

Edit/unsend target current members. Departed recipients evict unsent bodies by
point absence on held-page revalidation, not tombstones (LLP 1012 §5).

## Absence and bounds

Ordinary table point reads yield a row or absence; absent shapes and optional
members stay absent in objects, updates, and calls. Bases evaluate once per
branch. `! else CODE` names a refusal; `??` handles absence. Missing update/delete
is `NOT_FOUND`. Upsert retains insertion on absence, including alternate-key lookup.
Read and write authority are independent. When the same owner predicate denies
read and update/delete, the existence oracle remains: by-id → `E_RULE`,
alternate-key → `NOT_FOUND`.
Maintained point reads yield typed zero if missing/unreadable.

Scans, lists, text, JSON, and bytes are bounded. `for` needs a bounded
list/page/range/tokens result. Optional-list maxima bound length, not
presence: narrow with `if` or use a required fallback (`values ?? []`,
`values ?? more`, or `values ?? maybe ?? more` with required `more`).
`.length` and `count` require the same presence proof. Selection takes the largest
alternative bound (3, 5, 7 → 7), without truncating an alternative.

A present empty list suppresses fallback. A selected fallback evaluates once in
order; a prior binding evaluates at its binding. Aliases and object fields retain
the selected snapshot and bound for lengths, loops and returns.

List-column maxima survive aliases/shapes; JSON supplies no list bound. Ceiling
repairs use smaller pages, maintained aggregates, narrower fields or uniform
prefixes. Mutation page loops must cover a capped prefix with a uniform rule and
literal bound at least the cap; cursors/ranges refuse as `E_STRUCTURAL_FANOUT`.
Fan-out past a cap uses LLP 1016's continuation.

## Refused platform gaps

Refused (`E_QUARRY_UNSUPPORTED`): `where`, `device`, `oblivious`, `while`, and
recursion — pass bounded arguments; loop with bounded `for`/`walk`.
An indexable equality `where` returns schema-index and prefix-read repairs;
row-dependent predicates refuse. After changing an index, restart pagination.

Index-selection refusals list catalog keys and types, with an executable
replacement when one unique correction exists.

## Jobs and schedules

`job name(args):` holds independent `chunk row in table[prefix] first N by index:`
blocks over immutable, total keys; `guide job`. `schedule name on table at
.column [if predicate]: target(args)` fires per row when its `time ?` column is
reached; `schedule name every <Nm|Nh|Nd>: target` fires per period
(`guide schedule`).
