# Types — E_QUARRY_TYPE

E_QUARRY_TYPE means the expression's type does not fit its position.
The diagnostic names the expected and actual types and the source location.
A table reference is that table's typed id, not its row: `ref.field` reads
the row (`table[ref].field`, null when missing or hidden), and `table[id] !
else NOT_FOUND` refuses instead. Narrow an optional value with `if x != null:`,
`x ! else CODE` or `x ?? default` before using it where a present value is
required. Use the declared enum type when its variants cannot all widen
to the helper's text bound; changing a type never converts stored values.

Helpers expand at each call: a table-typed parameter keeps a row argument as a row (fields need no lookup), while a reference argument stays a reference.
An enum fits `text <=N` when every variant has at most N characters and
contains no control characters except tab, LF and CR. This is
static and total: no variant is truncated or converted at runtime. If one
variant is too long, declare the helper parameter with the enum instead.
After a scalar `where` predicate, a declared shape name shapes the page:
`where not .hidden card` and `where not .hidden { ...card }` agree. A valid
row/object shape inside a predicate keeps its meaning; parenthesize it to
make that scope explicit, or use `{ ...card }` explicitly for the page.

`?` after a type makes it optional: null when absent, and an omitted
optional argument reads as null. Text literals in id positions are ids. A
`<table>` reference is a typed id, with no implicit existence check and no
delete cascade: the string `"null"` is an id, and JSON null only fits an
optional type; when a target must be visible, `require exists t[id] else
CODE` before the write (guide writes). `=`
and `!=` are total (null equals null); `<` and friends need present operands:
narrow with `if x != null:`, `x ! else CODE`, or `x ?? default`. A null guard
also narrows a bound row's field (`r.changedAt != null`), until the local is rebound. `time`
arithmetic: `time - time` is an int, `time + int` a time. Duration literals are integer milliseconds:
`now + 30s`, `now - 1d`, `500ms`, `15m` and `7d`. `/` and `%` give
the Euclidean quotient and remainder of ints or times; zero refuses `E_DIV_ZERO`.
Check the divisor first: `require n != 0 else EMPTY`.
An enum is accepted as `text <=N` only if every variant fits N characters
and contains no control characters except tab, LF and CR,
including when both types are optional. This is a static, total widening;
it adds no runtime conversion. Otherwise give the helper parameter the enum
type. `(now / 1) * 1000` explicitly scales integer milliseconds; a scaled
count belongs in an `int` column. A repeated pure `fn` call narrows under its null guard when its arguments
are names, snapshot field paths, literals or such calls. Pure helpers read
no tables or clocks and write nothing. Other optional calls still need a
local: bind once, then guard it.
Text `+` concatenates; `count(text)` counts characters. Loop-built strings and
lists are heap-bound; a write still validates their actual column lengths.

Inside a nested `where`, `.` is that predicate's own row: in a contests shape,
`entries where .contest = .id` compares two entries fields. A named key reads
the enclosing row: `entries[contest = .id] first 10 by .id`.

A reference's field (`p.bed.max`) reads one row, null when it is missing or
hidden. Two hops (`r.planting.bed.owner`): read the first row (`planting =
plantings[r.planting] ! else NOT_FOUND`), then `planting.bed.owner`. In a
`require`, read the row present (`bed = beds[p.bed] ! else NOT_FOUND`) rather
than `?? 0`, which admits a missing row.
