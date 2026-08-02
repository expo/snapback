# PKG-02: LLP 0147 Phases A–B — the compiled Micro core, local-dev, with the stop rule

**Status:** Open
**Program:** follows PKG-01 (its metrology is the measuring stick)
**Systems:** Packaging, Codegen, Client SDK, Wire Protocol
**Related:** LLP 0147 (ACCEPTED 2026-08-02 — authorizes the additive
profile + server-egress trust boundary ONLY), LLP 0145 §D-D, the fixed
delta-lane egress defect (eda8f231)

Implement LLP 0147 §Implementation sequence Phases A and B per the doc:
Phase A metrology + low-risk separation (coordinate with PKG-01 — don't
duplicate the attribution machinery), then Phase B's local-dev compiled
core: codegen-specialized application surface over the minimal unchecked
generic transport, with application validation at the authoritative
boundaries.

Binding constraints from the acceptance:

- Nothing changes the current default client, package root, or `./online`
  semantics; the Micro profile is additive and experimental.
- **Stop after Phase B** if the attributed runtime misses the ~25 kB
  ceiling or the split cannot pass the negative proof gates — record the
  numbers and stop; that outcome is a valid result, not a failure to
  push through.
- No capability class or carrier claim before Phase C, which is NOT
  authorized by this ticket.
- OQ10's delta-lane disposition: the egress gap is fixed on main; verify
  the fix satisfies gate 11a's premise before relying on it.

**Exit:** Phase A/B artifacts + the graduation-gate measurements recorded
(size/closure, compile-time proof, runtime authority); either Phase C
readiness declared with evidence, or the stop rule exercised with the
numbers in the ticket.
