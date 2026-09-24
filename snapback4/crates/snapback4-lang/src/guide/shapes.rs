pub(super) const CARD: &str = r##"# Shapes

```quarry
shape brief = { id, body, author: .authorId }                        -- a named shape: bare columns, and `.` for the row

query shapeForms(roomId: rooms, messageId: messages, c: cursor ?):
  page = messages where .roomId = roomId after c last 20 by .at { *, room: rooms[.roomId], count: messageCounts[.roomId] }   -- over a page: `*` spreads every column; a point read inside is null for a hidden row
  row = rooms[roomId] { id, name, tagCount: count(.tags) }           -- over a row: an object; over a nullable row: null when the row is
  named = messages[messageId] brief                                  -- a named shape by its name
  nested = rooms[roomId] { ...card, extra: 1 }                        -- `...name` spreads a named shape's fields
  return { page, row, named, nested }
```

`{ ...p, extra: true }` copies a present row or object's known fields. Fields
can replace inherited fields: `{ ...p, handle: { value: p.handle } }` and
`p { *, handle: { value: .handle } }` return an object in place of the handle
text. The replacing field determines the generated type. A row contributes
the same columns and `pending?: boolean` as `p { *, extra: true }`.
A spread result is `pending` if any row spread into it, directly or through a
spread local, is pending, even when all of that row's fields are replaced.
Later spreads replace earlier fields from left to right. `pending` cannot be supplied or overwritten
in an object that spreads a row. This changes only the output;
rules, ordering and cursors still use the original row.
E_QUARRY_DUPLICATE_FIELD refuses two explicit fields with the same name, even
with a spread between them. Rename or remove the second field; the rewrite
names both locations. A bare column is an explicit field too.
E_QUARRY_SPREAD refuses nullable operands and values without statically known
fields. Establish the row first: `p = profiles[handle = h] ! else NOT_FOUND`,
then `return { ...p, extra: true }`.

An object spread's wildcard follows field order; when shaping an existing row shape,
explicit computed fields win over its wildcard. E_QUARRY_SHAPE_JOIN refuses
joining different row kinds, or a row-derived value and a non-row value,
at the conditional, assignment, return or collection that combines them.
Spread both row arms before joining, or build both arms with the same shape
and kind. The rule also applies inside objects and collections, even when the
result is only read by field. Identical kinds keep their existing behavior. Null adds absence to the same
kind; it does not introduce a competing wildcard rule. When one arm is a plain
object, explicit field projections can make both arms plain objects; those
projections do not copy row pending metadata.

```quarry
table listings:
  title: text
  city: text
  public
table bookings:
  guest: principal
  listing: listings
  start: time
  read <- .guest = viewer
query myBookings(c: cursor ?):
  return bookings where .guest = viewer last 20 by .start after c { *, listing: listings[.listing] { title, city } }
query listingChoice(key: listings, flag: bool):
  p = listings[key] ! else NOT_FOUND
  return ({ ...p } if flag else { ...(p { * }) }) { title: 'override', * }
```

Here `listing` is the expanded object, or null for a missing or hidden listing.

In the first example, table and shape names are the language card's. A shape over a page is
a bounded loop; its fields are the row's columns by bare name, `*` for all
of them, `...shape` for a named shape's fields, and `name: expr` with `.`
as the row. There is no `select` spelling.
A table-typed helper accepts that table's row or reference. A reference has no
fields: read `messages[m] ! else NOT_FOUND` first, or select through the shape's
implicit row parameter, `messages[m] { body: .body }`. Shapes are projections,
not declared helper-argument types.
A helper's early `return` inside a page's shape ends only that call; the page
keeps its `next` cursor and completeness.
A collector building a returned value makes the query incomplete if it exits
with rows still unconsumed, even on a short final page.
Each page needs its own returned owner when it has
more rows: one field's cursor cannot cover a lost sibling or auxiliary page.
A fully consumed, exhausted scan needs no cursor owner, even when its row count
equals the bound and the query returns a scalar such as `count(rows)`.
An auxiliary traversal of an intact returned page does not affect completeness,
even if it breaks. Repeating a page read cannot clear earlier loss: only the
final execution of an owned page site supplies `next`, and an earlier lost
continuation still makes the query incomplete.
A row-based shape keeps `pending?: boolean` from its base, including `*`, named
spreads and subsequent shapes. It is this device's unconfirmed change, absent
after confirmation; it is not a schema column or metadata on a containing record.

## Shapes and helpers

`guide reads` owns paging and continuation; `guide programs` owns helpers.

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
The rule applies only to a query's top-level returned shape expression,
`return <base> { ... }`: the base is an inline scan or merge, or a variable
with exactly one definition, that definition a read, no reassignment and no
other use anywhere in the program. The binder marks that lowered loop; only
that loop drops a row whose shape the meter starved and every later row.
`next` reaches the unfinished row first. A preceding fully computed row
supplies its exclusive position; otherwise the first unfinished rule-visible
row supplies an inclusive position — provided the page's own materialization was
not cut: a drain-cut merge with no fully computed emission, an opening cut or a
word-limit cut retains no continuation. Following an inclusive cursor that again
starves the same first row's returned shape refuses with E_SHAPE_EXCEEDS_METER
instead of returning an empty page with the same `next`: the message names the
read site and ceiling (8,192 examined rows); bound it (`first N`/`last N`) or
move it out of the returned shape. A shaped collector that is not the returned
expression keeps today's behavior: its empty or partial shape stays on the page,
with the existing continuation ownership and position, without trimming or rewind.
This includes assigned shapes, records, conditionals, helpers, aliases and
collector payloads; some such compositions have no continuation owner.
The answer stays `complete: false` on a meter cut, with `cut: 'meter'` on
devices and uniform server reads; non-uniform server reads keep `cut: null`.
A nested page's cut still makes the answer incomplete.
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
exact-key, one-unit semantics. `exists` accepts predicates and seeks, but no `first`/`last` or cursor."##;
