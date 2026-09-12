# Quarry grammar

Schema: `snapback/schema.q`. Programs/shapes: `snapback/<module>.q`.
TypeScript is for seeds, tests and effects.
`shape`, `fn`, `proc`, and `cursor` are reserved bindings.
Use `snapback2 guide <keyword>` for a focused card. Quarry comments start with
`--`; `#` and `//` refusals rewrite to that spelling.

```q
use identity

-- The first table is private to its owner.
table todos:
  title: text <=200
  done: bool
  ownerId: principal
  by byOwnerId: ownerId
  read <- .ownerId = viewer
```

Types: `principal`, `id`, table references, `int`, `time`, `bool`,
`decimal <scale>`, `money <CUR> [scale]`, `text <=N`, `text M..N`, `json <=N`,
`bytes <=N`, `image <=N [once]`, `video <=N`, `enum(...)`, `[type] <=N`; `?` is
optional. Array items are scalar; object/row arrays refuse. `once` is
image-column-only; `cursor` is operation-only. Text may add a format.
Indexes: `by name: columns` or `unique name: columns`.

All callable declarations and calls include parentheses. A declaration uses
`:` before its body: `fn double(n: int): n * 2`, `proc store(n: int):` with
a block, or `maintain counts: count rows by owner` with an indented
`read <- rule` (`read <- allow` for a public total; there is no `public` property).
Schedules use one call (`schedule hourly every 1h: cleanup()`), or `delete .` on a row timer.

## Constructs

- `proc`: `proc name(args):` declares a statement helper.
- `maintain`: `maintain name: count table by fields`; sum uses `sum table of column`.
- `cap`: `cap N by columns` bounds each group; `guide bounds` has costs.
- `unique`: `unique name: columns` declares a unique index.
- `immutable`: `immutable columns` forbids changes.
- `public`: `public ['reason']` declares public reads.
- `retain`: `retain until-revoked|delivered-history` controls hidden-row custody.
- `deliver`: `deliver to table[.keys] [by .principal] as name [with receipts] [bootstrap]` derives an engine-owned per-recipient log from a capped group.
- `channel`: `channel name(args):` declares value, publish, subscribe and ttl.
- `connected`: `exists connected[p]` tests; `connected[p]` counts (`p: principal`).
- `schedule`: `schedule name on table at .column:` or `every Nm|Nh|Nd:`.
- `job`: `job name(args):` declares independent sweeps.
- `chunk`: `chunk row in table[prefix] first N by index:`.
- `shape`: `shape name = { fields }`; `shape name from module`; `...name` splices.
- `merge`: `merge table [after cursor] first|last N by index:` plus lanes.
- `after`: `table[keys] after cursor` resumes an opaque page cursor.
- `first`: `table[keys] first N [by index]` is ascending.
- `last`: `table[keys] last N [by index]` is descending.
- `require`: `require condition else CODE` aborts on false.
- `walk`: `walk table[seed] up .column depth N` follows parents.
- `for`: `for name in bounded-list/page/range/tokens:` iterates.
- `emit`: `emit effect { payload }` durably queues I/O.
- `tokens`: `tokens(text)` extracts `@` mentions.
- `divmod`: `(q, r) = divmod(a, b)` binds quotient/remainder once.

```q
query list():
  return todos[viewer] first 50
```

Keys are positional or named (`[column = value]`). If more than one index
matches, choose one explicitly: `rows[key] by byId`.
`! else CODE` requires presence; `??` supplies a fallback. Statements bind,
return, branch, and write. `=`/`!=` are total; ordering needs present operands.
`where` refuses with index/read rewrites. `sorted` binds `(lo, hi)`.
`time - time` yields int milliseconds; adding/subtracting an int offset yields
time. Null keys select optional-column groups; required columns refuse null.
