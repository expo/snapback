# Language — E_QUARRY_UNSUPPORTED

E_QUARRY_UNSUPPORTED means the guessed construct is not a Quarry form.
For example, `return len(items)` must be `return count(items)`. The
reported rewrite names the accepted spelling; `snapback4 check --fix`
applies it when marked mechanical. For a different algorithm, use the
language card's bounded loop, helper or native-job idiom. Accepting a
rewrite does not add an alias to the language.

- `while` and recursion → `for` over a page, list, `range(a, b)` with int expressions, or `tokens(text)`; `walk` for a chain.
- Floats → integer minor units in `decimal S` and `money CUR S`, or a native job.
- A typed map with dynamic keys → `group(list, 'col')`, whose result is a list of `{ key, items }` groups in first-seen order.
Before editing, `check --fix` verifies every compiled source; an editor save refuses the repair with its filename. Its final compile re-reads the project.

Ordinary field access propagates null: `row.body` is null when `row` is null.
`check --fix` removes only the `?` in `a?.b`, preserving the base expression
and evaluating it once, including when it is a call or read.

- Guessed spellings are refused with a canonical rewrite; `snapback4 check --fix` applies mechanical repairs (including missing indexes, argument `once`, repeated wildcard fields and empty operation parentheses): `cond ? a : b` → `a if cond else b`; `a?.b` → `a.b`; `len(x)` → `count(x)`; `elif` → `else if`; `proc` → `fn`; `//` and `#` → `--`; `==` → `=`.
