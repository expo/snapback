# DECISION: comparison fairness — Convex local-leg topology, margins, generalization

**Status:** Open (author decisions)
**Severity:** P2
**Systems:** Competitive evaluation, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0075 open questions + §Measurement and margins, demos/competitive-checkpoint/acceptance/protocol.v0.json (comparatorInventory, nonInferiority), issues/20260723-llp0075-pre-timed-run-pins.md, issues/20260723-llp0075-checkpoint-program.md
**Marker:** llp-0075, competitive-checkpoint, decision, fairness

The fairness-deciding forks that feed the pre-timed-run pins. Each materially
affects the timed result.

**Resolved when:**

- **Convex local-leg topology:** the isolated cloud development deployment,
  account-free local Convex (beta), or both with a preregistered sensitivity arm.
  The topologies have different latency profiles; a beta comparator leg should
  probably be the sensitivity arm, not the primary, to keep the comparison
  idiomatic.
- **Margin rationales:** why each of 1.25× / +2 min / +5 min / +2 / +3 is the
  largest acceptable competitive disadvantage, plus a minimum-detectable-effect
  note for the median-of-seven design and a preregistered rule for a CI that
  straddles a margin.
- **Post-v0 generalization:** whether the public claim stays exact-fixture-only,
  or which holdout fixture earns generalization to an agent-authored AI
  application profile.
- Whether a Convex-arm Stop-class defect (e.g. cross-user access in the
  comparator implementation) stops the checkpoint or is scored as comparator
  evidence.
