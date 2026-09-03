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
