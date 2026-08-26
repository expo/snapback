
## Third instance, and the first one an executing reviewer missed

The LLP 0313 landing A probes were repaired after round 1 flagged them as calling invented methods.
Round 2's **executing** reviewer confirmed all seven "substantively exercise real APIs with the intended
diagnostics". The **reading** reviewer, on the same commit, found one still broken:

> `evidence::verify_and_consume` is called with **six** arguments; the function takes **seven** (the
> `mutation` argument is missing). rustc's first diagnostic is `E0061`, not the claimed `E0308`. If the
> gate is green, it is because a secondary `E0308` happened to overlap `@attack`.

That is the same arity drift as F145 and as the six `register_oauth_client` siblings — **three
occurrences in one day**, in unrelated code, found by three different means.

**What is new here is that execution did not catch it.** Running a compile-fail probe tells you it
failed; it does not tell you *why*. The probe failed, the gate found a diagnostic overlapping the
marked span, and the result scored green. Only reading the signature revealed the count mismatch.

That closes a gap in the reviewer-asymmetry model recorded elsewhere: the executing reviewer is not
strictly stronger. It catches races, hangs, and reachability that reading cannot; it can miss a
*wrong-reason* failure that reading catches immediately. **A witness needs both: run it to see that it
fails, read it to see that it fails for the claimed reason.**

## Standing check for any compile-fail witness

1. Does the call site's **arity and signature** match the current target? Signature drift is silent.
2. Is the diagnostic that fires at `@attack` the **first** one rustc emits, or an incidental secondary
   that merely overlaps the span?
3. Does the recorded `expectedCode` match what was **observed**, not what was expected when written?
