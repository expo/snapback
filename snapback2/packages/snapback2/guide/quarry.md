# Quarry v0.3

Quarry is the default Snapback 2 authoring language. It is a small, bounded
front end to the same compiler, checker, evaluator, and server used by the
TypeScript escape hatch. `snapback2 check` compiles `.q` text in memory; it
does not place generated files in `snapback/`. `snapback2 check` writes an
inspection copy under `.snapback/build/quarry/`.

## Project

A project has exactly one schema, `snapback/schema.q` or
`snapback/schema.ts`, never both. Quarry program modules require `schema.q`.
Declarations (`use identity`, tables, maintains, channels) belong only in
`schema.q`; every other `.q` file contains at least one query or mutation and
its stem is the API namespace. Thus `snapback/messages.q` exports
`api.messages.thread`. TypeScript program modules may coexist for effects, but
the same stem cannot occur as both `.q` and `.ts`.

`seed.ts` and `tests/*.test.ts` remain TypeScript data and journey harnesses.
Effect bodies also remain TypeScript because they perform JavaScript I/O.

## Types and tables

Columns and arguments use `principal`, `id`, table references, `int`, `time`,
`bool`, `text <=N`, `text M..N`, `json <=N`, `bytes <=N`, `enum(...)`, and
bounded lists `[type] <=N`. Add `?` for optional. Text can add `format handle`
or `format url` after its bound. A minimum and a format become enforced text
constraints; maximums remain part of the column type.

`principal` is the nominal type of `viewer`. It is neither a table reference
nor `id`, even though all three have ID-shaped wire values. A column compared
with `viewer`, or assigned `viewer`, must be `principal`.

Tables get `id` and `byId` implicitly. `by name: a, b` declares an ordering.
`unique a, b` declares the unique ordering `byAB` and its uniqueness
constraint; `id` may appear in an index. `immutable a, b` forbids changes to
those columns. `public` accepts an optional reason string. An insert
postcondition is exactly `after insert r <- exists table[...] [by index]`.

Rules are `allow`, `deny`, `public`, `system`, `exists`, `created`, `and`,
`or`, `not`, and `=`/`!=` between `viewer`, literals, row fields, and channel
arguments. `created` is insert-only. `update (old, next)` exposes
`old.field` and `next.field`; a one-binding update uses the candidate image.
Rule `exists`/`created` accepts any index whose leading columns match the key;
when several match, add `by index`. Parentheses allow multiline rules.
Reciprocal references and rule dependencies are supported.

`use identity` enables passwords and guests. `use identity password` and
`use identity guests` select only that method.

## Maintains

`maintain total = count source by a, b:` and
`maintain total = sum source of intColumn by a, b:` create an ordinary target
table. Its grouping columns exactly copy the source descriptors, `value` is
`int`, its grouping index is unique, its block supplies the read rule, and
writes are denied. The schema also declares the matching maintain projection.

The optional `readable <- rule` is a deliberate aggregate disclosure. It
allows certification to rely on reading a maintained summary when scanning
the raw source would not have a uniform read rule; the certificate lists that
choice as `E_DISCLOSURE`. It does not replace the target table's ordinary
`read` rule.

`total[key]` reads the target row through the unique grouping index.
`#total[key]` reads its integer value and yields zero when the group is absent.

```q
maintain messageCounts = count messages by conversationId:
  read r <- exists memberships[r.conversationId, viewer]
```

## Programs

Point reads select a complete unique key. Range reads use `first N` or
`last N`, optional `after`/`before` cursor, and optional `by index`. An
`exists table[keys]` probe accepts any prefix-matching index. Name an index to
resolve ambiguity. Shapes use `{ * }`, bare row fields, or `name: expression`.
Nested reads and shapes are bounded by the same compiler policy.

`where predicate` follows a bounded range read. The compiler fetches at most
its `take N` page and evaluates the predicate once per fetched row with `.` as
the row. Nested reads and `exists` are allowed. Filtering does not backfill,
so the result may contain fewer than N rows.

Statements are expression bindings, tuple bindings from `sorted`, `return`,
`require condition else CODE`, `if/else`, bounded `for`, and
`match read: some name: … none: …`. `return` is valid at top level and inside
all arms. Match is a statement, not a binding expression.

Object literals work anywhere expressions do; `{ id: conversationId,
creatorMembershipId }` uses shorthand for the second field. `count(x)` is
`x.length` for bounded lists and pages. Other built-ins are `tokens`, `range`,
`min`, `max`, and `sorted`. `walk table[seed] up .parent depth N` is bounded.
`!` or `! else CODE` requires a present value; `??` supplies an absence
fallback. Comparisons are absence-guarded. `now`, `commit`, and `new` expose
the operation clock, commit clock, and new ID source.

Writes are `+table { fields }`, `~table[id] { fields }`,
`+~table[id] { fields }`, and `-table[id]`. Insert yields the inserted row;
update, upsert, and delete yield no value. Each inserted row expression is
evaluated once, including inline `new` and `now`.

## Effects

A Quarry module imports a named effect from a TypeScript sibling, then emits
an object payload from a mutation:

```q
effect notify from notifications

query thread(conversationId: conversations):
```

The effect `notify` must be exported by `snapback/notifications.ts`.
`emit notify { to: recipient.principal, body }` enters the normal durable
outbox. Emitting in a query is refused by the platform as `E_EMIT_IN_QUERY`.
The generated code site and rewrite are mapped back to the `.q` statement.

## Absence and bounds

Point reads return a row or absence. Shapes over an absent point read are
absent. Optional member selection remains absent. `!` turns absence into a
named refusal, and `??` handles it explicitly. A missing maintained group is
zero only through `#`; the ordinary target-table read remains absent.

Every scan, list, text, JSON, and bytes value is bounded. `for` iterates only
a bounded list/page/range/tokens result. Queries and mutations retain the
same certificate, trace, and runtime budgets as TypeScript programs.

## Refused platform gaps

The following are not part of the Snapback 2 platform and are refused with
`E_QUARRY_UNSUPPORTED`: `asset`/`use assets`, `schedule`, `merge`, `device`,
`oblivious`, `while`, user functions or recursion, `decimal`, and `money`.
Use bounded URL text instead of assets; a caller-invoked mutation instead of a
schedule; one named bounded scan or a maintained feed table instead of merge;
explicit bounded arguments instead of device/oblivious state; bounded
`for`/`walk` instead of while/recursion; and integer minor units instead of
decimal/money.

The refusal says “not part of the Snapback 2 platform” because Quarry states
platform truth; there is no hidden larger Quarry subset to opt into.
