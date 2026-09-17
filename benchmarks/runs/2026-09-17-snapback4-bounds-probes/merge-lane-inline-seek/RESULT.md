# An inline expression in a merge lane source's range seek (published 0.2.27)

Run: `SB=/path/to/snapback4 node measure.mjs`. `check`: `ok — 2 tables (0 synced), 3 operations, no problems`.

```
  inline  REFUSED {"denied":{"code":"E_INPUT","family":"input","message":"E_INPUT: unknown variable $value1"}}
  bound   rows=10 complete=true next=yes
  direct  rows=25 complete=true next=no
```

Ticket: `issues/20260917-snapback4-merge-lane-source-seek-expression-is-an-unknown-variable-at-runtime.md`.
Met first by a fresh builder in the bounds bar's "before" run 1 (loop 4).
