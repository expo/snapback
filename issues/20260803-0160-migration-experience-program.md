# Migration-experience program — execute LLP 0160's gap ledger

**Status:** Open (program)
**Opened:** 2026-08-03, commissioned by Charlie ("make 0160 actionable").
**Systems:** CLI, Runtime, Storage, Admin console, Guide, Testing
**Related:** LLP 0160 (north-star + the §5 gap ledger — THE single source
of truth for scope; this ticket deliberately does not restate ledger rows),
LLP 0081 (owns migration semantics; D-class rows conform code TO it,
A-class rows require dated amendments to it BEFORE semantics move),
LLP 0158 (G7/G7′ dependency), LLP 0093 (OQ3's protocol half)

## Structure

Work the §5 ledger in the doc's own suggested order, as tranches:

- **Tranche 1 (start now):** G2 (refusal message-text slice — zero
  infrastructure, ships immediately), then G1 (human rendering of
  plan/receipt with the golden fixture set and presentation contract),
  then G11 (populate `preconditionRows` — the example's own data source).
- **Tranche 2:** G3′ (intent scaffold), G6 (guide page + capability row),
  G5 (`snapback migrate status` + recovery experience).
- **Tranche 3 — the drift audit block:** G9a+G10+G12+G13+G16 as one
  conformance pass over the CLI, receipt, capability, dry-run, and
  rehearsal/backup seams. Route G9b (rollback input) to Charlie with the
  audit's evidence on why the shipped input was deliberate (OQ7).
- **Tranche 4:** G14 (diagnostic→recovery matrix, generated from the
  registry), G15 (admin inspection — meet the 0081 acceptance floor
  first, then the experience half), G8 (migration-scale evidence — the
  D-half is conformance drift: no test crosses the second batch
  boundary), G4′a.
- **Blocked, do not start:** G7/G7′ (fork rehearsal — needs LLP 0158
  F0a's custody/fidelity proofs plus a dated 0081 §7 amendment), G4′b
  (needs the OQ6 Moment-8 ruling).

## House rules

As the 0133/0154 programs: verify-against-main first; the R/D/A
governance lanes are binding — an A-class change lands its dated
amendment to the owning doc in the same commit or not at all; @ref
annotations; ./ref-check + guide check green on touched surfaces;
own-correctness green per the current wave policy; tickets for
sub-slices only if a tranche needs parallel hands; dated
implementation-record notes on LLP 0160 as tranches complete; ledger
rows get struck through in the LLP (with commit ids) as they close, so
the doc stays the single source of truth.

## Author rulings routed out of this program

- **OQ6 (Moment 8 settlement)** — gates G4′b; presented to Charlie
  separately with the decision input 0160 records.
- **OQ7 (G9b rollback input)** — presented with the drift audit's
  evidence when tranche 3 reaches it.
- **OQ3 (compatibility-verdict owner)** — 0160's proposed split
  (presentation half here, protocol fact restated in LLP 0093) awaits a
  cheap author blessing; record it in the LLP when given.

**Exit:** every unblocked ledger row closed with its class's governance
respected; blocked rows carry dated notes naming their dependency; guide
page live; LLP 0160 carries the implementation record. This ticket closes
citing the final ledger state.
