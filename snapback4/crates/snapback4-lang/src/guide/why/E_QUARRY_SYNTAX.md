# Language — E_QUARRY_SYNTAX

E_QUARRY_SYNTAX means the parser could not read the form at the reported
file, line and column. For example, `query answer:` is missing its argument
parentheses: write `query answer():`, then indent `return 42` by two spaces
on the next line. Keep the colon, close each `(`, `[` and `{`, and separate
arguments and object fields with commas. Follow the diagnostic's rewrite;
`snapback4 check --fix` applies it only when marked mechanical. Fix the first
bad line and rerun `check`; a later empty-body error may be its consequence.

A maintained view cannot declare a separate sync audience. If it inherits public
sync, a narrower explicit read conflicts with that horizon-free audience. Remove
the view's sync line, then keep its public read for public offline coverage, or
use `online only` and lose offline aggregate/absence coverage. See `guide
maintains` and `guide offline-interactions` for the replica census.
