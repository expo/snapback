# Quarry grammar

One directory: declarations in `snapback/schema.q`, operations in
`snapback/<module>.q`, and optional effect implementations, seed data, and
journeys in TypeScript. A project has exactly one of `schema.q` or `schema.ts`.

```q
use identity

table todos:
  title: text <=200
  done: bool
  ownerId: principal
  by ownerId
  read r <- r.ownerId = viewer
```

Schema declarations are `use identity [password|guests]`, `table`, `maintain`,
and `channel`. Table lines are columns, `by`, `unique`, `immutable`, `public`,
rules, and `after insert … <- exists`. Maintains are `count table by fields` or
`sum table of intField by fields`, followed by `read` and optional `readable`.
Channels declare `publish`, `subscribe`, and `ttl Ns`.

Types are `principal`, `id`, table references, `int`, `time`, `bool`,
`text <=N`, `text M..N`, `json <=N`, `bytes <=N`, `enum('a', 'b')`, and
`[type] <=N`; text may add `format handle|url`, and any type may add `?`.

```q
query list():
  return todos[viewer] first 50 by byOwnerId
```

Program declarations are `effect name from module`, `query name(args)`, and
`mutation name(args)`, with optional `-> type`. Statements are bindings,
`return`, `require … else CODE`, `if/else`, bounded `for`, `match … some/none`,
`emit`, and expressions. Expressions include literals, objects, arrays, reads
and shapes, `exists`, `#maintain[key]`, `+ ~ +~ -` writes, `! [else CODE]`,
`??`, `where`, and `sorted/tokens/range/min/max/count`.

See `quarry` for the complete normative surface and refusal list.
