# Types — E_ADOPT

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
A column may end with `default <literal | now | viewer>`. Omitted insert
fields take their defaults before rules run; explicit values, including null
on an optional column, win. `now` and `viewer` use the writing host's context.
An added required column with a literal default also fills absent fields in
old images on every host, without rewriting rows or logging partition events.
Changing a required default rechecks its existing unique indexes and caps too.
`data` and `sql` show that interpretation; device persistence exports are raw storage images.
Optional columns still read null when absent. New required `default now` or
`default viewer` columns adopt only an empty table; otherwise use an optional
column or a literal default. `check` reads `.snapback4/store.sqlite` when it
exists (or `--store path`); `E_ADOPT` locates each successor refusal and its
rewrite, as `dev` refuses the save. Without a store, check only compiles.
Pages, lists and shaped collections share the list operations: `sort`, `slice`,
`count`, `sum`, `group`, `first`, `last`, `at`, `join` and `for`. Their elements
must still fit the operation: `join` joins texts; `sum(page, .amount)` projects numbers.