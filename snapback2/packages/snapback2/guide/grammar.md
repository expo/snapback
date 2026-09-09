# Quarry grammar

`snapback2 guide init` covers setup; `guide auth` covers authentication;
`guide app` shows certified facts. CLI options use `<command> --help`.
`check` validates sources; `dev --status` shows what the owner has installed.

Schema: `snapback/schema.q`. Programs/shapes: `snapback/<module>.q`.
Seeds, tests and effect bodies use TypeScript.
`shape`, `fn`, `proc`, and `cursor` are reserved bindings.
Use `snapback2 guide <keyword>` for a focused card or defining paragraph.
Symbols work without an index; misses list help.

```q
use identity

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
optional. `once` is image-column-only; `cursor` is operation-only. Text may add a format.
Indexes name their ordering: `by name: columns` or `unique name: columns`.

All callable declarations and calls include parentheses. A declaration uses
`:` before its body: `fn double(n: int): n * 2`, `proc store(n: int):` with
a block, or `maintain counts: count rows by owner` with indented read rules.
Schedules use one inline call: `schedule hourly every 1h: cleanup()`.
Fractional literals infer their exact decimal scale; `guide money` explains units.

## Constructs

- `proc`: `proc name(args):` and a block; a statement helper elaborated at each call.
- `maintain`: `maintain name: count table by fields`; sum uses `sum table of column`.
- `cap`: `cap N by columns` bounds each group; reserve is N/N/5N per write, or 1/1/5 with an exact same-`by` count maintain.
- `unique`: `unique name: columns` declares a unique index.
- `immutable`: `immutable columns` forbids changes.
- `public`: `public ['reason']` declares public reads.
- `retain`: `retain until-revoked|delivered-history` controls hidden-row custody; both policy words lex consistently everywhere.
- `channel`: `channel name(args):` declares value, publish, subscribe and ttl.
- `connected`: `exists connected[p]` tests live connections; `connected[p]` counts them (`p: principal`).
- `schedule`: `schedule name on table at .column:` or `every Nm|Nh|Nd:`.
- `job`: `job name(args):` declares independent sweeps.
- `chunk`: `chunk row in table[prefix] first N by index:`.
- `shape`: `shape name = { fields }`; `shape name from module`; `...name` splices.
- `merge`: `merge table [after cursor] first|last N by index:` with indented lanes.
- `after`: `table[keys] after cursor` resumes an opaque page cursor.
- `first`: `table[keys] first N [by index]` scans ascending.
- `last`: `table[keys] last N [by index]` scans descending.
- `require`: `require condition else CODE` aborts on false.
- `walk`: `walk table[seed] up .column depth N` follows at most N parent links.
- `for`: `for name in bounded-list/page/range/tokens:` iterates.
- `emit`: `emit effect { payload }` durably queues I/O.
- `tokens`: `tokens(text)` extracts `@` mentions.
- `divmod`: `divmod(a, b)` returns quotient and remainder; `(q, r) = divmod(a, b)` binds both once; `divmod(time, int)` splits epoch milliseconds into int parts.

```q
query list():
  return todos[viewer] first 50
```

Keys are positional or named (`[column = value]`); point reads may add `by index`.
`! else CODE` requires presence; `??` supplies a fallback. Statements also
bind, `return`, `if/else`, and write with `insert`, `update`, `upsert`, `delete`.
`=`/`!=` are total; ordered comparisons need present operands. `where`
refuses with index/read rewrites. `sorted` uses `(lo, hi) = sorted(a, b)`.
`time - time` yields int milliseconds; `time + int`, `time - int`, and `int + time`
yield time; other time arithmetic refuses. Null keys select optional-column groups in
point/maintain reads, `exists`, and `cap`; required columns refuse null.
