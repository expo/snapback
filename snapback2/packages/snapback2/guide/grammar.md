# Quarry grammar

`snapback/schema.q` holds schema; `snapback/<module>.q` holds programs.
Seeds, tests, effect bodies: TypeScript; effect `then`: Quarry.

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
Tables hold columns, indexes, `unique`, `immutable`, `cap N by cols`, rules,
`after insert <- exists`, and `retain until-revoked` (default) or
`retain delivered-history`. Only the latter keeps hidden rows; both evict
absences, uniform-range holes, and tombstones. `.` is the row. Maintains
count/sum by fields. Channels use `publish`, `subscribe`, and `ttl Ns`.

Types: `principal`, `id`, table references, `int`, `time`, `bool`,
`decimal <scale>`, `money <CUR> [scale]`, `text <=N`, `text M..N`, `json <=N`,
`bytes <=N`, `image <=N`, `video <=N`, `enum(...)`, `[type] <=N`, and
`cursor` (operations only). Text may add a format; `?` means optional.

```q
query list():
  return todos[viewer] first 50
```

`effect name from module`, `query`, `mutation`: programs.
`shape name = { fields }` projects rows/pages or splices as `...name`.
`shape name from module` imports it.
Statements: bindings, `return`, `require`, `if/else`, bounded `for`, `match`,
`emit`. Expressions: objects, arrays, reads/shapes, `exists`, `#maintain[key]`,
word writes,
`! [else CODE]`, `??`, `merge`, and bounded built-ins.

Reads use `table[value, …]` or `table[column = value, …]` plus `[after cursor]
first|last N [by index]`; point reads allow `by index`.
`merge table [after cursor] first|last N by index:` has indented lanes. Declare
`c: cursor ?`; absent starts page one. Pass opaque `next` back unchanged. A
pageable merge index ends in `id`.
Equality is total; ordered comparisons need nonoptional operands or direct
`if x != null:` narrowing. `where` refuses with index/read rewrites. Upserts
cannot spell `id`. Consumed update/upsert yields a read-visible row or absence;
ignored writes add no read. Decimal/money seeds use whole units, wire args minor
units. `sorted` is
`(lo, hi) = sorted(a, b)`; `(q, r) = divmod(a, b)` binds both parts once.
`shape`, `fn`, `cursor` are reserved.

`time - time` yields int milliseconds; `time + int`, `time - int`, and
`int + time` yield time; other time arithmetic refuses. `divmod(time, int)`
splits epoch milliseconds into int parts. Null keys select optional-column
groups in point/maintain reads, `exists`, and `cap`; required columns refuse null.
