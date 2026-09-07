# Quarry grammar

Start an Expo app with `snapback2 init my-app --template chat --client expo`.
`snapback2 guide init` covers scaffolding and CLI setup; `snapback2 guide auth`
covers authentication; `snapback2 guide app` shows the current backend's certified
facts. CLI options use `<command> --help`.
`check` validates sources; `dev --status` shows what the owner has installed.

Schema: `snapback/schema.q`. Programs/shapes: `snapback/<module>.q`.
Seeds, tests and effect bodies use TypeScript.
Use `snapback2 guide <keyword>` for grammar and a defining paragraph.
Symbols work without a valid index; misses list help.

```q
use identity

table todos:
  title: text <=200
  done: bool
  ownerId: principal
  by ownerId
  read <- .ownerId = viewer
```

Types: `principal`, `id`, table references, `int`, `time`, `bool`,
`decimal <scale>`, `money <CUR> [scale]`, `text <=N`, `text M..N`, `json <=N`,
`bytes <=N`, `image <=N [once]`, `video <=N`, `enum(...)`, `[type] <=N`; `?` is
optional. `once` is image-column-only; `cursor` is operation-only. Text may add a format.
`shape`, `fn`, and `cursor` are reserved bindings.

## Constructs

- `maintain`: `maintain name = count table by fields:`; sum uses `sum table of column`.
- `cap`: `cap N by columns` bounds each group; reserve is N/N/5N per write, or 1/1/5 with an exact same-`by` count maintain.
- `unique`: `unique [name:] columns` declares a unique index.
- `immutable`: `immutable columns` forbids changes.
- `public`: `public ['reason']` declares public reads.
- `retain`: `retain until-revoked|delivered-history` controls hidden-row custody.
- `channel`: `channel name(args):` declares publish, subscribe and ttl.
- `connected`: `exists connected[p]` tests live connections; `#connected[p]` counts them (`p: principal`).
- `schedule`: `schedule name on table at .column:` or `every Nm|Nh|Nd:`.
- `job`: `job name(args):` declares independent sweeps.
- `chunk`: `chunk row in table[prefix] first N by index:`.
- `shape`: `shape name = { fields }`; `shape name from module`; `...name` splices.
- `merge`: `merge table [after cursor] first|last N by index:` with indented lanes.
- `after`: `table[keys] after cursor` resumes an opaque page cursor.
- `first`: `table[keys] first N [by index]` scans ascending.
- `last`: `table[keys] last N [by index]` scans descending.
- `require`: `require condition else CODE` aborts on false.
- `match`: `match read:` branches into `some name:` and `none:`.
- `for`: `for name in bounded-list/page/range/tokens/words:` iterates.
- `emit`: `emit effect { payload }` durably queues I/O.
- `tokens`: `tokens(text)` extracts `@` mentions.
- `words`: `words(text)` returns bounded, deduplicated lowercase ASCII words.
- `divmod`: `divmod(a, b)` returns quotient and remainder; `(q, r) = divmod(a, b)` binds both once; `divmod(time, int)` splits epoch milliseconds into int parts.

```q
query list():
  return todos[viewer] first 50
```

Keys are positional or named (`[column = value]`); point reads may add `by index`.
`! [else CODE]` requires presence; `??` supplies a fallback. Statements also
bind, `return`, `if/else`, and write with `insert`, `update`, `upsert`, `delete`.
`=`/`!=` are total; ordered comparisons need nonoptional operands. `where`
refuses with index/read rewrites. `sorted` uses `(lo, hi) = sorted(a, b)`.
`time - time` yields int milliseconds; `time + int`, `time - int`, and `int + time`
yield time; other time arithmetic refuses. Null keys select optional-column groups in
point/maintain reads, `exists`, and `cap`; required columns refuse null.
