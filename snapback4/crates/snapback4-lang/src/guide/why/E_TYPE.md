# Types — E_TYPE

E_TYPE means a runtime value has the wrong kind for the operation using it.
For example, a raw program cannot add the text `'3'` as an integer; supply
`3` as a number and compile the program against its schema. Read the
message's expected and actual types, correct seeds or wire inputs, and
use the generated API types. Changing a declaration does not convert old
values; repair the values before narrowing their type.

Values: `viewer` (a principal), `now` (a time; in a mutation it is the commit's
instant), `new` (an id, mutations only), `true`, `false`, `null`, integers,
`'text'` or `"text"` with `\n`, `\t` and `\\`, `[a, b]` (a bounded list),
`{ a, b: c }` (an object; a bare name is `name: name`). `=` and `!=` are total
(null equals null); `<` and friends, `+`, `-` and `*` need present operands:
narrow with `if x != null:`, `x ! else CODE`, `x ?? default`, or `require x
!= null else CODE`. Guards narrow fields of a bound row too, through `and`/`or`,
conditional arms and the paths that survive an early return; rebinding clears the fact. `time - time` is an int of milliseconds; `time + int` a
time. Text `+` concatenates two present texts. `count(text | page | list)` counts characters or items; `lower(text)`, `trim(text)`, `join(list, separator)`, `sum(page, .col)`, `sum(list)`, `min(a, b)`,
`max(a, b)`, `min(page, .col)`, `max(page, .col)` (also lists of rows), `slice(text | list, start, end)`, `sort(list, 'col', '-col')`,
`group(list, 'col')`, `first(list)`, `last(list)`, `at(list, index)` (element or null),
`tokens(text)`, `sha256(text)`, `share(amount, list, member)`, `(q, r) = divmod(a, b)`,
`(lo, hi) = sorted(a, b)`. `x = expr` binds or reassigns a local with a compatible type; reassignment resets its refinements. Arguments cannot be shadowed. A program ends
with `return [value]`, or with its last expression, or with its final write.
An inline ordered page needs parentheses to separate its order keys from
the column argument: `min((t first 20 by .at), .col)`. Binary `min(a, b)`
and `max(a, b)` retain their meaning; a collection followed by `.col` selects
the aggregate.

Pages, lists and shaped collections share the list operations: `sort`, `slice`,
`count`, `sum`, `group`, `first`, `last`, `at`, `join` and `for`. Their elements
must still fit the operation: `join` joins texts; `sum(page, .amount)` projects numbers.
