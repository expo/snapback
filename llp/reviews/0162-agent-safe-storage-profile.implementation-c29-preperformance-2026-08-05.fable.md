# LLP 0162 C29 pre-performance implementation review — Fable

**Reviewer family:** Fable
**Provider / runtime:** Anthropic Claude Code CLI 2.1.223, model `fable`
**Date:** 2026-08-05
**Reviewed commit:** 3f5c587fbe58533a6d471b0e13f238e6baabf774
**Implementation tree SHA-256:** sha256:58dcf92bad47ae5327a5b8459b5ba5666ddfa467ee31a27266497ba4c9226ad9
**Verdict:** NOT READY
**Method:** Fresh exact CLI review barred from `llp/reviews/`; exact HEAD,
implementation digest, root cleanliness, and the clean Ibex gitlink were
independently verified. No performance process ran.

## Findings received

1. **High — the sibling terminal-supplement table retained C28's corruption
   class.** Host closure trusted its SQL terminal time without comparing the
   retained JSON supplement.
2. **Medium — public explanation was an existence/divergence oracle.** A
   foreign physical key returned auth-stale/reused classifications while an
   absent key returned `null`, rather than one closed
   `authorization-unprovable` posture.
3. **Medium — the row-1 rollback matrix was incomplete and
   non-discriminating.** Host terminal replay lacked a direct pruned-identity
   cell; the pending test observed counts only after rollback and omitted the
   Host lease table.
4. **Medium — acknowledgement/JSON-side coherence lacked a discriminating
   Host-close negative.** The live acknowledgement projection is normally
   null until its delete transition, and no corrupt JSON terminal/ack case
   proved the comparison.

The reviewer also noted lower-priority missing Rust decoding proof for an
absent required tombstone counter, weak successful-close postconditions, and
stale LLP 0158 wording. C30 closes the material findings and those bounded
proof gaps. The derived capability and broader facts remain `Missing`; this
verdict is not acceptance or publication evidence.
