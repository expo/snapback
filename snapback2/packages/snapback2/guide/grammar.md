# Quarry grammar

Backends have one `snapback/schema.q`; operations live in
`snapback/<module>.q`. TypeScript under `snapback/` is limited to `seed.ts`,
`tests/*.test.ts`, and effect modules that export effects only. An effect's
optional `then` mutation is declared in Quarry.

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
and `channel`. Table lines are columns, `by`, `unique`, `immutable`, `public`,
`read|insert|update|delete <-` rules, `update (old, next) <-`, and `after insert
<- exists`; the single row is `.`. Maintains are `count table by fields` or
`sum table of field by fields`, then `read` and optional `readable`.
Channels declare `publish`, `subscribe`, and `ttl Ns`.

Types are `principal`, `id`, table references, `int`, `time`, `bool`,
`decimal <scale>`, `money <CUR> [scale]`, `text <=N`, `text M..N`, `json <=N`,
`bytes <=N`, `enum('a', 'b')`, and `[type] <=N`; text may add
`format handle|url`, and any type may add `?`.

```q
query list():
  return todos[viewer] first 50
```

Program declarations are `effect name from module`, `query name(args)`, and
`mutation name(args)`; result types are inferred. Statements are bindings,
`return`, `require … else CODE`, `if/else`, bounded `for`, `match … some/none`,
`emit`, and expressions; a body's last expression returns implicitly.
Expressions include literals, objects, arrays, reads and shapes, `exists`,
`#maintain[key]`, `insert`/`update`/`upsert`/`delete` writes,
`! [else CODE]`, `??`, `where`, and
`sorted/tokens/range/min/max/count/divmod/share`.

Reads use `table[value, …]` or `table[column = value, …]`, then
`[after|before cursor] first|last N [by index] [where predicate]`; point reads
may use `by index`. Program `=`/`!=` are total; ordered comparison refuses
optionals. `sorted` is only `(lo, hi) = sorted(a, b)`.

See `quarry` for the complete normative surface and refusal list.
