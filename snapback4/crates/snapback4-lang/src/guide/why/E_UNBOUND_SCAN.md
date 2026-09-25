# Bounds — E_UNBOUND_SCAN

E_UNBOUND_SCAN means a compiled scan names a table or index absent from its
schema. Recompile after changing a table or its access plan:
`snapback4 check`, then use the regenerated backend together with its
programs. Do not reuse old compiled programs against a new schema.
Compiling and serving refuse it, and a native device checks again; the web device trusts that admission and does not repeat the check, so a hand-built or corrupted backend can still run there.

Web queries and predictions trust the backend compiler's structural admission;
the server rechecks submitted mutations. Local argument, row, rule, coverage
and runtime budget checks still run. A hand-built or corrupted backend can
therefore differ from a native device's structural refusal (`guide prediction`).
