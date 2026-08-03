# 0166 L7 — legacy parity (standing) and lease convergence

**Status:** Open (program: `20260803-0166-impl-program.md`; the S4
parity half binds from L1 onward — set it up FIRST; the convergence
half requires L2)
**Spec:** LLP 0166 §D6 (all three subsections), the dated 2026-08-03
LLP 0043/0090 boundary notes

Scope:

- **S4 as a standing gate:** run the shipped store-parameterized
  `rqs-resume-suite.mjs` unmodified against the successor format on
  every carrier, in the local proof, from the first L1 landing; assert
  the shipped legacy comparator, budget envelope, D3 outbox rule,
  arbitration, `inProgress` refusal, and purge behaviors byte-exact;
  legacy entries never acquire grace/TTL/demand or cross-section
  pressure.
- **Lease-family convergence** (close-predecessor-first): the
  pending-intent precondition (refuse while dependent intent pends;
  wait for settlement or explicit discard); step 1 = the predecessor
  instance's LLP 0053 terminal retirement *begins*, durably, in the
  lease artifact, before any successor publication; step 2 = fresh
  qmk1 establishment; step 3 = retirement finalizes; connected-attempt
  initiation only.
- No dual render at any crash cut; no cross-artifact transaction is
  attempted (the 0043 boundary note pins the atomic arm as not
  exercisable in v1).

Done means: S4 green as a standing gate across the whole program; S5's
convergence legs pass (crash at each cut; pending-intent refusal leg;
exactly-one-renderable at every point).

---

**Progress (2026-08-03):** convergence half implemented (Codex,
session-supervised) and landed: close-predecessor-first coordinator with
connected-attempt + pending-intent refusals, real Contract-store
retirement operations and real L2 establishment in tests, crash cuts at
every boundary with exactly-one-renderable asserted, and an instrumented
no-cross-artifact-transaction assertion. The S4 standing-gate half has
been live since L1. Ticket stays Open until the program umbrella closes
it.
