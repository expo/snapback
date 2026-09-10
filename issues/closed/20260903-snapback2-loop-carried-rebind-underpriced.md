# snapback2: loop bodies are priced once, so a loop-carried rebinding is under-estimated

**Opened:** 2026-09-03 (row-width lane, blind review, inherited hole)
**Area:** `snapback2/crates/snapback2-core/src/certificate/output.rs` (`statements`, `Stmt::Assign` growth)

The output estimator walks a loop body once with the iteration count applied
to pushes and assignments, but a variable rebound inside the loop from its own
previous value plus a row field (a loop-carried accumulation into a scalar or
object, not a collection push) is priced as a single iteration: the reviewer's
program certified at 68 output bytes and served 1,020. The growth accounting
in `assignment_growth` covers collections; extend it to loop-carried scalar/
object rebinds (price the rebind at iterations × the added bytes, saturating),
or refuse the pattern statically with a rewrite to an explicit accumulator.

Pin: the reviewer's program (a `Let` rebound in a `For` over a page from its
own previous value and a text column) certifies at or above its served bytes.

## Resolved 2026-09-10 (LLP 1020 A5, lane `cost`)

A loop-carried scalar/object rebind is priced as growth per iteration × the loop bound, across
self-occurrences, aliases, branches, nested loops, and retained intermediates
(`growth::fixed_width_from`, `certificate/recurrence.rs`, `certificate/output.rs`,
`retention.rs`). The pin is `snapback2/crates/snapback2-core/tests/certificate_cost.rs::
ticket_68_vs_1020_is_a_runnable_projected_rebind` (measured 1,020 under its bound) and
`loop_carried_value_bounds_dominate_maximum_width_escaped_executions` (nine loop-growth
shapes × four maximum-width escaped fills, bound ≥ measured for output and closure).

**Annotation 2026-09-10 (fix round r1):** the pin above was written with `Assign`; the reviewer's
program rebinds with `let` inside the `for`, and the estimators priced a `let`/`const` overwrite as a
fresh single-iteration binding (53 output bytes certified against 2,029 served at `first 252`,
`body: text <=4`). Both estimators and the coupled recurrence now treat a `let`/`const` of a name
already bound as the same assignment; the pin in the ticket's own spelling is
`certificate_cost.rs::ticket_let_rebind_in_a_for_is_priced_as_the_same_recurrence`.
