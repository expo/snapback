# Bounds

Scans, lists, text, JSON, and bytes are bounded. `for` needs a bounded
list/page/range/tokens result. Optional-list maxima bound length, not
presence: narrow with `if` or use a required fallback (`values ?? []`,
`values ?? more`, or `values ?? maybe ?? more` with required `more`).
`.length` and `count` require the same presence proof. Selection takes the largest
alternative bound (3, 5, 7 → 7), without truncating an alternative.

A present empty list suppresses fallback. A selected fallback evaluates once in
order; a prior binding evaluates at its binding. Aliases and object fields retain
the selected snapshot and bound for lengths, loops and returns.

List-column maxima survive aliases/shapes; JSON supplies no list bound. Ceiling
repairs use smaller pages, maintained aggregates, narrower fields or uniform
prefixes. Mutation page loops must cover a capped prefix with a uniform rule and
literal bound at least the cap; cursors/ranges refuse as `E_STRUCTURAL_FANOUT`.
Fan-out past a cap belongs in a job's `chunk` loop, or read-side (`guide fanout`).

Refused (`E_QUARRY_UNSUPPORTED`): `where`, `device`, `oblivious`, `while`, and
recursion — pass bounded arguments; loop with bounded `for`/`walk`.
An indexable equality `where` returns schema-index and prefix-read repairs;
row-dependent predicates refuse. After changing an index, restart pagination.

Index-selection refusals list catalog keys and types, with an executable
replacement when one unique correction exists.

`check --cost [<op>]` prints the priced plan on admission or refusal: examined,
index entries, rule probes, steps, heap, output, closure and write rows, with source
lines, totals and ceilings. `--json` retains terms and partial certificates;
these diagnostics do not authorize execution. Branches select each meter's
maximum; jobs are priced per chunk, including the progress write.
Loop-carried scalar/object/collection values include repeated growth, aliases,
nested loops, branches and retained intermediates; bounds can exceed measured bytes.
A maintained point read inside a page shape is allowed. Counting the outer
non-uniform page still refuses `E_STRUCTURAL_COUNT`; pin the authorization
scope in the index prefix. An unreadable maintained group has no absence
authority: receipt-only replay remains `partial`, including a server zero.

See `guide quarry` for related topics.
