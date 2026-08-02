# G-03: Helper reuse slice — after the helper-class cutline decision

**Status:** Resolved 2026-08-02 — verified already landed by Wave-1 C1
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

## Running log

- **2026-08-02 — verify-against-main found the full cut already landed.** At
  `ceb205a6b70fb47f12295e4a1be40efdd06edb98`, commit
  `4d72c40705e6685c1449a57a7b29c1e5672e519d` is present and implements the
  complete LLP 0118 option-1a same-file slice. It includes the Relay Board
  context-reader helper shared by three operations, not only capability-free
  calendar helpers; the generated manifests preserve each operation's
  declared `reads`/`writes` as evidence with no ceiling enforcement. It also
  carries resolve-and-splice emission, per-operation v2 named-helper-content
  hashes, full-spliced-byte capability rescanning, and stable helper-scoped
  refusals. LLP 0108 already absorbed the normative mechanism, LLP 0118 OQ1
  already records the measured benchmark, and the LLP 0115 CV-7 board row
  already names the landing. The earlier closed C1 ticket is
  `issues/closed/20260730-move2-capability-free-helper-cut.md`.
- **2026-08-02 — proof and resolution.**
  `node packages/snapback-codegen/inline-helper-sharing.test.mjs` passes on
  current main, covering both motivating diary shapes, context-reader
  evidence, exact invalidation, cross-helper adversarial syntax, cycles,
  top-level laundering, ambient runtime reads, and helper identity.
  `./ref-check --verbose` is green. This queue ticket was a stale duplicate,
  so it closes with no code change and no new author decision.
