# Quarry grammar

Use `snapback/schema.q` plus operation modules `snapback/<module>.q`. Only
`seed.ts`, tests, and effect bodies are TypeScript; effect `then` is Quarry.

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
and `channel`. Tables contain columns, indexes, invariants, visibility/write
rules, and `after insert <- exists`; `.` is the row. Maintains count/sum by
fields. Channels declare `publish`, `subscribe`, and `ttl Ns`.

Types are `principal`, `id`, table references, `int`, `time`, `bool`,
`decimal <scale>`, `money <CUR> [scale]`, `text <=N`, `text M..N`, `json <=N`,
`bytes <=N`, `enum(...)`, and `[type] <=N`; text may add a format and any type
may add `?`.

```q
query list():
  return todos[viewer] first 50
```

Programs are `effect name from module`, `query`, or `mutation`; results are
inferred. Modules may declare `shape name = { fields }`; apply it to a
row/page/read or splice `...name`. Statements include bindings, `return`,
`require`, `if/else`, bounded `for`, `match`, and `emit`. Expressions include
objects, arrays, reads/shapes, `exists`, `#maintain[key]`, four word writes,
`! [else CODE]`, `??`, `merge`, and the bounded built-ins.

Reads use `table[value, …]` or `table[column = value, …]`, then
`[after|before cursor] first|last N [by index]`; point reads may use `by index`.
`merge table [after|before cursor] first|last N by index:` has indented lanes.
An all-optional argument cursor omits when absent and rejects mixed presence.
Program `=`/`!=` are total;
ordered comparison refuses optionals except in the then branch of a direct
`if x != null:` narrowing. Repairable `where` clauses refuse with schema-index
and indexed-read rewrites. Upsert rows cannot spell `id`. Decimal/money seeds
are whole units; wire arguments remain minor units. `sorted` is
`(lo, hi) = sorted(a, b)`. `shape`, `fn`, and `cursor` are reserved bindings.
