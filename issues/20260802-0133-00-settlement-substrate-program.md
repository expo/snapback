# LLP 0133 settlement-substrate program — the buildable-now half

**Status:** Open (program)
**Opened:** 2026-08-02, from the LLP 0130–0155 implementation-status survey
**Systems:** Sync, Storage, Runtime, Client integration, Wire Protocol, Testing
**Related:** LLP 0133 (Accepted 2026-07-31, zero implementation), LLP 0129
(ledger row 1), LLP 0155 (Stage 2 consumes this substrate), LLP 0043, LLP 0059,
LLP 0051, LLP 0008, LLP 0034

## Why now

LLP 0133 is Accepted with an empty implementation trail (no code, no tickets,
verified 2026-08-02 across `src/`, `packages/`, `issues/`, Linear). It is the
substrate LLP 0155's Stages 2–3 settle through, and it is needed regardless of
how 0155's refinement resolves. Charlie directed the program 2026-08-02.

## The scope split

LLP 0133 §rule 2 makes the lane label client-attested and privilege-free: a
lane-L submission is an ordinary wire message any client can construct. So the
**entire server-side lane-L settlement path is buildable and testable now with
synthetically constructed lane-L submissions** — no local IR evaluator
required. The client store seam extension is likewise buildable against
synthetic receipts. What this program deliberately does NOT build:

- **Local capture itself** (the LLP 0051 D2 IR evaluator, speculative
  execution, speculative receipts, acceptance sketch 5) — that is LLP 0155
  Stage 2 / LLP 0129 Candidate A work.
- **Identity-mismatch disposition** (sketch 6) — ledger rows 3/5's owners
  (LLP 0081 / 0051 / 0123). This program only records the claims (ticket 02).
- **OQ2 typed-id declarations** — row 2's admission vocabulary; the
  leaf-equality floor ships first.
- **Final receipt wire spelling** (OQ1) — content lands here under working
  names; the wire projection is the row-4 owners' (LLP 0043/0034/0093/0094)
  and needs dated amendments when it freezes.

## Tickets, in dependency order

- 01 receipt lane labels + disposition-labeled claim ledger + privacy rule
- 02 settlement-identity extension (fail-closed collisions, gate ordering)
- 03 lane-L server re-derivation path (synthetic submissions; sketches 2/7/10)
- 04 id-map by logical mint identity, unmapped-never-guessed (sketch 3 server)
- 05 bounded-skew opt-in: declaration, structural admission, capability fact
  (sketch 4)
- 06 client store seam extension: id-map delivery, leaf rewrite, cascade
  (sketch 3 client, sketch 9)

01+02 are independent substrate; 03 needs both; 04 and 05 ride 03; 06 needs
04's receipt shape.

## House rules for this program

Every landing carries `@ref LLP 0133#<section>` where non-obvious, updates the
capability index/guide only when a fact becomes claimable, runs
`./ref-check --verbose`, and moves its ticket to `issues/closed/` with a
resolution note naming the proof. Acceptance sketches from LLP 0133 are the
falsifiable exit criteria — each ticket names its sketches. `cargo test` needs
`DYLD_FRAMEWORK_PATH=<repo>/vendor/ibex/ios/Frameworks` on macOS; run
`scripts/bootstrap-ibex-runtime` on a fresh checkout first.
