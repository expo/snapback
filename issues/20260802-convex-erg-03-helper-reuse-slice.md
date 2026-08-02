# G-03: Helper reuse slice — after the helper-class cutline decision

**Status:** Open — UNBLOCKED 2026-08-02: cutline decided (context-reader
helpers first; declared reads/writes as evidence, not ceilings — sitting
record in 20260802-author-decision-packet.md ruling 2)
**Program:** 20260802-convex-erg-00-program.md
**Systems:** Codegen, Runtime, API
**Related:** LLP 0118 (handler composition and helper reuse research),
LLP 0127 move 2, LLP 0115 CV-7; Wave-1 lane C1 landing (4d72c407)

## Task

Convex authors factor shared logic into plain functions; Snapback's closed
module graph makes designed duplication. LLP 0127 move 2 proposes the
same-file helper slice; the survey says it is gated on the helper-class
cutline decision (which helper classes are admitted into the closed graph vs
refused with a stable reason).

**Verify first:** Wave-1 lane C1 (CV-7) landed a helper slice on 2026-07-31
(4d72c407). Read that landing and LLP 0118's current state; record in this
ticket what already works (same-file helpers? cross-file? which capability
classes?) and what the cutline decision actually still gates. If C1 closed
more than the survey believed, shrink this ticket honestly.

**Then, once the cutline is decided:** implement the admitted classes with
the closed-graph guarantees intact — helper identity participates in the
function/implementation hashes, refusals are stable diagnostics, and the
admission is visible in generated artifacts.

## Exit

- The dated verification note against C1's landing.
- The cutline decision recorded here with its date (from the decision
  packet).
- An improvement-sweep-derived acceptance case: the duplicated
  optimistic-transform/helper pattern the diaries flagged, expressed once and
  admitted; an out-of-cutline helper refused with the stable reason.
