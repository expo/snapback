# Quarry — the data language (complete reference, v0.2)

Quarry is a small language for backend data programs: **queries** (read) and
**mutations** (read + write). Everything a program may do is in this document;
if a construct is not here, it does not exist. There is no `while`, no
recursion, no ambient clock, no randomness, no I/O, no unbounded read.
Comments run from `--` to end of line.

v0.2 folds in the LLP 0329.014.009 authoring-test verdicts: auto-dereference
through references, bare-name shape fields, optional columns, `enum`, the
`asset` column type, and a section on boundary kinds.

## Programs

```
query name(arg: type, ...):
  <statements>

mutation name(arg: type, ...) -> resultType:
  <statements>
```

Bodies are indentation-scoped; the final expression is the result. Statements:
bindings (`x = expr`, `(a, b) = expr`), guards, writes, `if`/`else:` blocks,
`for` loops, `match` blocks.

**Argument types.** A table name types the argument as a reference to a row of
that table (`c: conversations`). Scalars: `text <=N`, `int`, `time`, `bool`,
`enum('a', 'b', ...)`. Lists carry a mandatory cap: `to: [users] <=50`.
Append `?` for an optional argument (`cursor: time ?`).

## Schema

```
table messages:
  conv: conversations          -- reference column
  author: users
  body: text <=4096
  kind: enum('text', 'image', 'video')
  editedAt: time ?             -- `?` = optional column, absent until written
  by conv, at                  -- an ordering (index); optionally named: by activity: user, activity

table users:
  name: text <=80
  handle: text <=32
  avatar: asset ?              -- a reference into the asset store (see Kinds)
  unique handle                -- unique key; duplicate inserts are refused at commit

maintain unread = count messages by conv           -- engine-maintained aggregate
```

Every table has an implicit `id`. You may extend a schema with top-level
lines:

```
index applications: posting, at          -- add an ordering
unique passengers: ride, user            -- add a unique key
maintain n = count applications by posting
maintain top = max entries of score by contest (readable: public)
```

`maintain` forms: `count t by cols`, `sum t of col by cols`,
`max t of col by cols`, `min t of col by cols`, each with an optional
`where <predicate over the row>`. The engine keeps them exact at commit. A
maintained value over rows the reader cannot see is a **declared
disclosure** — say so with `(readable: ...)`.

Rules appear on tables per effect (`read r <- <predicate>`,
`insert r <- ...`, `update (old, next) <- ...`, `delete r <- ...`); the
engine enforces them on every access. `public` marks a table world-readable
(a declared disclosure). Mutations may additionally guard with `require`.

## References and auto-dereference

A reference value stands for its row. You may:

- chain field access through it: `post.author.name` (reads the author row);
- key a bracket or maintained read with it: `#seatCount[ride]`,
  `messages[conv]`;
- open a shape on it: `.author { name, handle }`.

Access through an **absent** reference or optional propagates absence (like
`?.` everywhere). In a rule or guard, a predicate over an absent value is
false. Use `!` to refuse instead of propagating:
`journals[j]! else NOT_FOUND`.

## Reads

- `t[expr]` — point read, type `Row?`. A reference to `t` keys by id; a
  composite `unique` key is keyed positionally (`dms[lo, hi]`); name columns
  when inference is ambiguous (`t[col = expr]` — the left side is always a
  column name, the right side is expression scope, so an argument may share a
  column's name).
- `exists t[...]` — boolean existence test.
- `#name[key]` — read a maintained aggregate: exact, complete, O(1). Type `int`.
- **Range reads.** If the bracket keys a prefix of an ordering, the read is a
  range and MUST end with a direction and bound: `first N` (ascending) or
  `last N` (descending). It does not parse without one. The result is a
  **page**: up to N rows, with `.more: bool`.

```
messages[c] last 3                       -- newest 3 (ordering inferred from c's type)
members[viewer] last 50 by activity      -- name the ordering when several exist
episodes[s] after sub.lastListenedAt first 100
```

`after expr` / `before expr` restrict the ordering's final column — this is
also the pagination cursor: pass the last row's sort value back in.

- `merge(t[a], t[b], ...) last N` — bounded k-way fan-in over the same
  ordering of one table under several prefixes (a small home feed). For large
  or unbounded audiences, `maintain rows` a feed table instead (fan-out on
  write) — say which you chose and why.

## Shapes

Braces after a row, reference, or page project it. On a page, the shape
applies to every row. Inside a shape, `.` is the focal row; a **bare column
name** selects that column (`{ title, startsAt }`); `*` splices all columns;
`name: expr` computes a field; nested reads may open nested shapes (which
re-focus `.`); bind `as x` on a domain when an inner shape needs the outer
row.

```
messages[c] last 30 {
  *,
  author: .author { name, handle, avatar },
}
```

## Reductions and `capped`

`page | count` and `page | sum .col` reduce a page. Their type is
**`capped int`** — a fact about *the page*, not the population (render as
"N+" when `.more`). A `capped int` cannot be stored by a write, compared in a
`require`, or returned where the schema demands `int`: those are type errors.
A population fact — a total, a maximum, a rank, a follower count — is a `#`
maintained read.

## Writes (mutations only)

```
m = +messages { conv: c, author: viewer, body, at: now }   -- insert; id minted unless given; evaluates to the row
~members[m] { lastReadAt: now }                            -- patch (`.` is the old row in field exprs)
+~unseen[club, u] { n: (.n ?? 0) + 1 }                     -- upsert by unique key; key columns auto-fill on insert
-messages[m]                                               -- delete
```

Inserting a duplicate into a `unique` key refuses the whole transaction at
commit — rely on that rather than racy check-then-insert.

## Guards

```
require exists members[c, viewer] else NOT_MEMBER
require ride.seats > #seatCount[r] else RIDE_FULL
```

`require` refuses the whole transaction with the stable code after `else`.

## Control

- `if cond:` / `else:` blocks.
- `for x in <domain>:` — the domain must be a page, a capped list argument, or
  a literal list. Nothing else iterates.
- `match t[k]:` with arms `some x:` and `none:` — branch on a point read's
  absence. On a restricted table, `none` does not distinguish absent from
  hidden; do not turn it into an existence claim.
- `walk t[seed] up .col depth N` — bounded ancestor traversal along a
  reference column; yields the visited rows in order.

## Clocks and values

- `now` — the client's intent clock. Type `time!intent`: it may be **stored**
  as a timestamp, and nothing else. It cannot be compared with a `time`
  column — that comparison does not typecheck.
- `commit` — the engine's clock at commit. Type `time!commit`: use it in every
  guard that grants or denies by time (expiry, deadline, window).
- `viewer` — the calling principal. `new` — mint an id explicitly (rare;
  inserts mint their own).
- Operators: `+ - * / %` on ints; `= != < <= > >=`; `and or not`; `??`
  (absent-coalesce); `!` after a point read asserts presence with a refusal
  code.
- Builtins: `min`, `max`, `sorted(a, b)` (a pair in order), `tokens(text)`
  (bounded word list, ≤64), `range(a, b)`.

## Kinds — what is not a data program

Some capabilities are **boundary kinds**: declared in the schema, provided by
the engine, never implemented as data programs. Declare them; do not write
their internals. Data programs interact with them only through the declared
seams below.

```
use identity
  -- email+password credentials, expiring sessions, server-side logout
  -- revocation. Provides `viewer` to every program. Credentials and
  -- session tokens never appear in tables you declare.

use assets
  -- upload, storage, and delivery of images/video. Provides the `asset`
  -- column type: programs store and return asset references; bytes never
  -- pass through the data plane.

channel typing(conv: conversations):
  publish   <- exists members[conv, viewer]
  subscribe <- exists members[conv, viewer]
  ttl 5s
  -- ephemeral fan-out (typing, presence): no durable rows, no history;
  -- payloads are small structs; expiry is the engine's.

schedule closeAuction(a: auctions) at a.endsAt:
  run settle(a)
  -- durable, transactionally enqueued invocation of a named mutation under
  -- the system principal at a stored time; rescheduled when the row's time
  -- column changes. Rules and programs stay time-independent: "expires at
  -- T" is a schedule flipping a status column, never a clock comparison in
  -- a rule.
```

Effects (external I/O — push notifications, email) are likewise a kind; for
this exercise, declare them with a one-line contract if the spec needs one.

## Worked examples

A chat thread — the newest 3 messages with each author:

```
query thread(c: conversations):
  messages[c] last 3 {
    *,
    author: .author { name, handle },
  }
```

Sending a message, membership-guarded:

```
mutation send(c: conversations, body: text <=4096) -> messages:
  require exists members[c, viewer] else NOT_MEMBER
  +messages { conv: c, author: viewer, body, at: now }
```
