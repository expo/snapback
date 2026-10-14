# Programs — E_STRUCTURAL_FANOUT

For one row, use a point read by id (`table[id]`). For a global total, use a maintained aggregate authorizing the caller; public totals need a public read rule. Neither scans private rows inside the mutation.

For receipt gaps, `guide sequences` has the server blocker read and scoped
receipt proof; counts do not prove individual receipt coverage. Declare
`ordinal: sequence by conversationId` for that recipe.

Example: declare `cap 50 by room` on members, then iterate
`for m in members where .room = room:`; put the condition and row write inside
that loop.

A mutation with `predicts: "never"` (a server site or `: server`) may pass
over a bounded plain prefix page whose read rule is uniform over its prefix,
without a complete schema-capped group. A `: server` mutation may scan an
expiring table only in its initial read-only statement prefix (guide programs);
its pages still need a uniform plain prefix, `matching` and merges stay refused,
and predicting mutations still cannot scan expiring tables. Move the scan into
that phase, or use a job sweep, which may read a table with expiry. A predicting mutation
keeps the complete-group requirement for page loops: `for row in t where .owner = viewer:`
uses the schema cap, without restating it. An explicit `first N` remains legal;
an explicit bound below the cap still fails that proof. A job's inner loop may
also read a capped group this way. A bounded list loop whose
body only reads, computes and emits may use a list column, alias, helper result,
or filtered/shaped list derived from a page; it need not preserve the whole group.
A row write anywhere in that body, including an inlined helper or nested loop,
keeps the original structural-fanout check and its capped-group rewrite.
Every page a mutation reads, even just
binding it, must be uniformly decided by its prefix (`E_STRUCTURAL_FANOUT`).
When a capped scope can decide the rule, the rewrite names the missing rule
columns and a capped loop that supplies their values. Pinning `.readerId` decides visibility; it grants no read
authority over another reader's inbox. See `guide feeds` for removal limits.
For `exists` and aggregate constraint checks without a deciding capped scope,
the refusal explains that hidden rows would be missed. Use a per-unit unique
constraint every writer obeys, or a readable availability audience if the
product permits it; `guide writes` has a per-night booking example. A hidden
unique collision stays E_RULE; only a readable collision can use its named code.
The pass is atomic and still aborts above 1,024 rows written. `check --cost`
prints the examined ceiling and, for expiry, the unswept-row backlog (store
work, off the meter) rather than a first-N-rows price.
For structural fanout, compiling and serving refuse it, and a native device checks again; the web device trusts that admission and does not repeat the check, so a hand-built or corrupted backend can still run there.

A program's prefix `exists` is a top-1 scan below the page: no cursor and no
page overflow. Expired siblings cost no examined rows; `matching` pays
word discovery. A positive held row proves existence on a device regardless of
its horizon; only a negative answer past that horizon needs coverage. A
query cut is an incomplete null; a mutation cut is `E_BOUND` with no write.
Mutation prefix existence tests require a uniform plain prefix and the same
expiry admission as other scans (guide programs). Rule probes keep
exact-key, one-unit semantics. `exists` accepts predicates and seeks, but no `first`/`last` or cursor.

Recipes: `guide rule-recipes` — Status dashboard over private rows; Minimum-group publication; Materialised access; Blind comparison with a system job.
