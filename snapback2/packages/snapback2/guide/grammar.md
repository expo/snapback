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

Schema uses `use identity [password|guests]`, `table`, `maintain`, and `channel`.
Tables hold columns, indexes, rules, `after insert <- exists`, and
`retain until-revoked` (default) or `retain delivered-history`.
Only hidden rows differ: the default evicts; delivered history keeps.
Absences, uniform-range holes, and tombstones always evict. `.` is the row. Maintains
count/sum by fields. Channels declare `publish`, `subscribe`, and `ttl Ns`.

Types: `principal`, `id`, table references, `int`, `time`, `bool`,
`decimal <scale>`, `money <CUR> [scale]`, `text <=N`, `text M..N`, `json <=N`,
`bytes <=N`, `image <=N`, `video <=N`, `enum(...)`, `[type] <=N`, and
operation-only `cursor`. Text may add a format; `?` makes any type optional.

```q
query list():
  return todos[viewer] first 50
```

Programs: `effect name from module`, `query`, or `mutation`.
`shape name = { fields }` applies to a row/page/read or splices as `...name`.
`shape name from module` imports it; shape-only modules export no operations.
Statements include bindings, `return`, `require`, `if/else`, bounded `for`,
`match`, and `emit`; expressions include
objects, arrays, reads/shapes, `exists`, `#maintain[key]`, four word writes,
`! [else CODE]`, `??`, `merge`, and bounded built-ins.

Reads use `table[value, …]` or `table[column = value, …]` plus `[after cursor]
first|last N [by index]`; point reads may use `by index`.
`merge table [after cursor] first|last N by index:` has indented lanes. Declare
`c: cursor ?`; absent starts page one. Pass opaque `next` back unchanged. A
pageable merge index ends in `id`.
Equality is total; ordered comparisons need nonoptional operands or direct
`if x != null:` narrowing. `where` refuses with index/read rewrites. Upserts
cannot spell `id`. Consumed update/upsert yields a read-visible row or absence;
ignored writes add no result read. Decimal/money seeds are
whole units; wire arguments remain minor units. `sorted` is
`(lo, hi) = sorted(a, b)`. `shape`, `fn`, and `cursor` are reserved bindings.
