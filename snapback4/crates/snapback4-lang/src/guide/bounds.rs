//! The bounds card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Bounds and the meter

Nothing is priced at check. As a program runs, the meter counts examined
rows, index entries, rule probes, steps, heap bytes, output bytes and rows
written against ceilings: 8,192 rows examined, 16,384 index entries, 8,192
rule probes, 1,000,000 steps, 16 MiB heap, 1 MiB output, 1,024 rows written
per mutation; a job's chunk may examine 16,384 rows and write 8,192. A
query past a ceiling returns what it found with `complete: false`; a
mutation aborts with E_BOUND naming the meter, the ceiling and the site
(never the count: it would measure rows the viewer may not read).
`snapback4 check --cost` prints each site's structural class;
`snapback4 test` prints the numbers on your data. A loop is bounded
by a page's `first N`, a list's `<=N`, `range`'s int expressions, `walk`'s depth,
or `tokens`' 64. An accumulated list is bounded by the heap meter and its
iterations by the step meter. `while` stays refused.
`range(a, b)` evaluates int expressions once and iterates under the step meter,
without materializing the range. `check --cost` prints `steps ≤ meter`, a
filtered scan as `filter over ≤ examined ceiling`, its reads as `probe × examined`,
and a seek as a prefix. Sorting or grouping a page only processes that page.
`sha256(text)` charges the input's UTF-8 byte length plus one to steps before
hashing, then 64 heap bytes for its fixed lowercase hexadecimal result. A step
cut refuses a scalar query with E_BOUND; a cut on that result allocation returns
`data: null`, `complete: false`, as other query heap cuts do. A mutation rolls
back on either cut.


## Refused loops and scans

E_UNBOUND_LOOP means the compiler cannot establish an accepted loop domain
or walk depth. For example, `walk nodes[root] up .parent depth 100` exceeds
the supported depth of 1–64; use `depth 8` for an eight-hop query. Iterate
a bounded page, a bounded list argument, `range(a, b)` or `tokens(text)`
for ordinary loops. A `range` may use int expressions and still runs under
the step meter; there is no `while` form.

E_UNBOUND_SCAN means a compiled scan names a table or index absent from its
schema. For example, keeping a compiled read of `byOwner` after renaming
that index leaves the scan unbound. Update the read's `by` clause and run
`snapback4 check`, then use the regenerated backend together with its
programs. Do not reuse old compiled programs against a new schema.

E_FANOUT means a loop received more items than its declared bound.
For example, a raw program declaring a ten-item loop cannot consume an
array of eleven items. Keep the producer and loop bound consistent; in
Quarry, iterate a bounded list or an explicit `first 10` page and process
remaining work through another page or a job chunk. Increasing a runtime
meter ceiling is not the repair, and silently dropping required work is
not a complete sweep.
"##;
