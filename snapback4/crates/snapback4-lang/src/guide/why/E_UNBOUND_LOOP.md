# Bounds — E_UNBOUND_LOOP

E_UNBOUND_LOOP means the compiler cannot establish an accepted loop domain
or walk depth. For example, `walk nodes[root] up .parent depth 100` exceeds
the supported depth of 1–64; use `depth 8` for an eight-hop query. Iterate
a bounded page, a bounded list argument, `range(a, b)` or `tokens(text)`
for ordinary loops. A `range` may use int expressions and still runs under
the step meter; there is no `while` form.

A mutation classified `predicts: "never"`, from a server site or an author's
`: server` marker, may iterate a bounded plain prefix page when its read rule
is uniform over the prefix. `matching` and merges are refused for every
mutation page (`E_STRUCTURAL_FANOUT`). Expiring scans follow the server
read-only-phase rule in guide programs. Prediction still needs a complete
schema-capped group: `for m in members where .roomId = roomId:` takes its bound from the
schema cap, so changing the cap changes every whole-group read. An explicit
`first <cap>` stays legal; a smaller explicit bound still fails the prediction
proof. A job's inner loop may also read a capped group without restating it.
Every page a mutation reads, including a page it only
binds, must be uniformly decided by its prefix (`E_STRUCTURAL_FANOUT`): read it in
a query, or pin the deciding columns.
A page verdict evaluated from its pinned prefix charges the rule's static probe count on either outcome, including probes skipped by `and`/`or` short-circuiting; an aborting mutation page also costs one examined unit before the verdict.
The pass is atomic and remains subject to 1,024 rows written per mutation.
`check --cost` names the examined ceiling and, for expiring scans, the
unswept-row backlog, which is store work off the meter. It never commits a partial pass after a budget abort.

A bounded list loop that only reads, computes and emits may iterate a list
column, an alias, a helper result or a filtered/shaped list from a page.
It need not preserve the whole group. If its body writes rows, including
inside helpers or nested loops, the original `E_STRUCTURAL_FANOUT` check
still applies. Every mutation page still needs a uniform plain prefix over
a table admitted by the expiry rule (guide programs); the meter and its
ceilings are unchanged.
