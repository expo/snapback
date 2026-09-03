# Quarry grammar

Backends use `snapback/schema.q`; operations use `snapback/<module>.q`.
Only `seed.ts`, `tests/*.test.ts`, and effect-only modules may be TypeScript.
Effect `then` mutations are Quarry.

```q
use identity

table todos:
  title: text <=200
  done: bool
  ownerId: principal
  by ownerId
  read <- .ownerId = viewer
```

Schema declarations: `use identity [password|guests]`, `table`, `maintain`,
and `channel`. Table members are columns, `by`, `unique`, `immutable`, `public`,
write/read rules, `update (old, next) <-`, and `after insert <- exists`; `.` is
the row. Maintains count or sum by fields, with `read` and optional `readable`.
Channels declare `publish`, `subscribe`, and `ttl Ns`.

Types are `principal`, `id`, table references, `int`, `time`, `bool`,
`decimal <scale>`, `money <CUR> [scale]`, `text <=N`, `text M..N`, `json <=N`,
`bytes <=N`, `image <=N`, `video <=N`, `enum('a', 'b')`, and `[type] <=N`; text may add
`format handle|url`, and any type may add `?`.

```q
query list():
  return todos[viewer] first 50
```

Programs are `effect name from module`, `query name(args)`, or
`mutation name(args)`; results are inferred. Statements are bindings,
`return`, `require … else CODE`, `if/else`, bounded `for`, `match … some/none`,
`emit`, and expressions; a body's last expression returns implicitly.
Expressions include literals, objects, arrays, reads and shapes, `exists`,
`#maintain[key]`, `insert`/`update`/`upsert`/`delete` writes,
`! [else CODE]`, `??`, `merge`, and
`sorted/tokens/range/min/max/count/divmod/share`.

Reads use `table[value, …]` or `table[column = value, …]`, then
`[after|before cursor] first|last N [by index]`; point reads may use `by index`.
`merge table [after|before cursor] first|last N by index:` has indented
`[prefix] [for name in bounded-read]` lanes. An all-optional argument cursor is
omitted when absent and rejects mixed presence. Program `=`/`!=` are total;
ordered comparison refuses optionals. `sorted` is `(lo, hi) = sorted(a, b)`.

See `quarry` for the normative surface and refusals.
