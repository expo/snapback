# bounded-programs: `receipt.absences` is never validated against `trace.absences`

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 5
**Confidence:** 5
**Systems:** Engine, Authorization, Testing
**Date:** 2026-08-29
**Related:** LLP 0329.021 P5, LLP 0329.020,
`spikes/bounded-programs/src/engine.rs`, `spikes/bounded-programs/SPEC.md`

## Summary

`SPEC.md` states the containment invariant plainly:

> Runtime assertions enforce `receipt ⊆ trace ⊆ certificate`.

`assert_bounds` (`src/engine.rs:1445`) enforces the examined and rule-probe
ceilings and iterates `trace.points` and `trace.ranges`. **It never validates
`receipt.absences` against `trace.absences`.** Across the whole file
`receipt.absences` appears exactly twice, both writes:

```
src/engine.rs:793    self.receipt.absences.push(absence);
src/engine.rs:1361   self.receipt.absences.push(absence);
```

It is never read back or checked. So one component of the receipt is outside the
invariant the spec says is enforced.

Found by the codex panelist in LLP 0329.020's round 3 while source-checking
LLP 0329.021 P5, and verified independently.

## Why it is benign today and why it should still be fixed

Benign now: both call sites push the same tuple into `trace.absences` and
`receipt.absences` on the same line, so they cannot currently diverge. This does
**not** affect LLP 0329.021 P5's finding, which is about what an absence *means*,
not about whether it is validated.

Worth fixing because absences are the component P5 identifies as
**authority-only and noninterference-critical**. A receipt absence asserts "no row
exists at this key" — a claim about the authoritative dataset. If a receipt ever
crosses an untrusted boundary, or if a future code path constructs a receipt
independently of a trace, an unvalidated absence is a forged "does not exist",
which is both a correctness failure (`Fresh` over data the client does not hold)
and a disclosure surface (asserting non-existence is itself information).

The invariant is cheap to state and cheap to check. Leaving it implicit means it
holds by construction of two adjacent lines rather than by assertion.

## Suggested fix

Extend `assert_bounds` to check `receipt.absences ⊆ trace.absences`, matching the
treatment rows, ranges, and verdicts already receive. Add a negative test that
constructs a receipt carrying an absence absent from the trace and asserts the
bound check refuses it.

## Scope of the claim

Established by reading `src/engine.rs`: the two write sites are the only
occurrences, and `assert_bounds` does not reference them. Not established: whether
any consumer outside this file constructs or mutates a receipt independently —
that would raise the urgency from hygiene to defect.
