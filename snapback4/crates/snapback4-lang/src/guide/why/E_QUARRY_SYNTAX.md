# Language — E_QUARRY_SYNTAX

E_QUARRY_SYNTAX means the parser could not read the form at the reported
file, line and column. For example, `query answer:` is missing its argument
parentheses: write `query answer():`, then indent `return 42` by two spaces
on the next line. Keep the colon, close each `(`, `[` and `{`, and separate
arguments and object fields with commas. Follow the diagnostic's rewrite;
`snapback4 check --fix` applies it only when marked mechanical. Fix the first
bad line and rerun `check`; a later empty-body error may be its consequence.

A maintained view cannot declare a separate sync audience. Remove its sync line
to inherit, or replace it with `online only`. The offline-loss repair applies
only when the view is proved to inherit horizon-free public sync and its explicit
read is narrower. For that conflict, remove the sync line and keep the public
read for public offline coverage, or use `online only` and lose offline
aggregate/absence coverage. An unsynced or online-only source supplies no partition
for the view to lose. See `guide maintains` and `guide offline-interactions` for
the replica census.
