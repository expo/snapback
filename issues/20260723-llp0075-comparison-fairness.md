# DECISION: comparison fairness — Convex local-leg topology, margins, generalization

**Status:** Open (author decisions)
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “DECISION: comparison fairness — Convex local-leg topology, margins, generalization” shows the issue materially affects a supported product or engineering path; delay compounds an active rollout, reliability, or verification risk, while the fix requires a few coordinated implementation and test surfaces, with a direct reproduction or current implementation proof.
**Severity:** P2
**Systems:** Competitive evaluation, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0075 open questions + §Measurement and margins, demos/competitive-checkpoint/acceptance/protocol.v0.json (comparatorInventory, nonInferiority), issues/20260723-llp0075-pre-timed-run-pins.md, issues/20260723-llp0075-checkpoint-program.md
**Marker:** llp-0075, competitive-checkpoint, decision, fairness

The fairness-deciding forks that feed the pre-timed-run pins. Each materially
affects the timed result.

**Resolved when:**

- ~~**Convex local-leg topology**~~ **Decided 2026-07-30 (protocol
  amendment v0.9, author):** the isolated cloud development deployment is
  the primary; the account-free local beta is an optional preregistered
  sensitivity arm only, exactly as this bullet leaned.
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
