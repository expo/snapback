# Quarry grammar

Use `snapback/schema.q` and `snapback/<module>.q`. Seeds, tests, and effect
bodies are TypeScript; effect `then` is Quarry.

```q
use identity

table todos:
  title: text <=200
  done: bool
  ownerId: principal
  by ownerId
  read <- .ownerId = viewer
```

Schema declarations are `use identity [password|guests]`, `table`, `maintain`,
and `channel`. Tables contain columns, indexes, invariants, rules, and
`after insert <- exists`; they may contain one `retain until-revoked` or
`retain delivered-history` line, with `until-revoked` the default. `.` is the row. Maintains count/sum by
fields. Channels declare `publish`, `subscribe`, and `ttl Ns`.

Types are `principal`, `id`, table references, `int`, `time`, `bool`,
`decimal <scale>`, `money <CUR> [scale]`, `text <=N`, `text M..N`, `json <=N`,
`bytes <=N`, `image <=N`, `video <=N`, `enum(...)`, `[type] <=N`, and
operation-only `cursor`; text may add a format and any type may add `?`.

```q
query list():
  return todos[viewer] first 50
```

Programs are `effect name from module`, `query`, or `mutation`; results are inferred.
Modules may declare `shape name = { fields }`; apply it to a
row/page/read or splice `...name`. Statements include bindings, `return`,
`require`, `if/else`, bounded `for`, `match`, and `emit`. Expressions include
objects, arrays, reads/shapes, `exists`, `#maintain[key]`, four word writes,
`! [else CODE]`, `??`, `merge`, and the bounded built-ins.

Reads use `table[value, …]` or `table[column = value, …]`, then
`[after cursor] first|last N [by index]`; point reads may use `by index`.
`merge table [after cursor] first|last N by index:` has indented lanes. Declare
`c: cursor ?`; absent starts page one, and pass opaque result `next` back
unchanged. A pageable merge index ends in `id`.
Equality is total; ordered comparison refuses optionals except after direct
`if x != null:` narrowing. Repairable `where` clauses refuse with schema-index
and indexed-read rewrites. Upsert rows cannot spell `id`. Decimal/money seeds
are whole units; wire arguments remain minor units. `sorted` is
`(lo, hi) = sorted(a, b)`. `shape`, `fn`, and `cursor` are reserved bindings.
