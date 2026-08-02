# Corpus hygiene: apply the unfolded fold-on amendments from the Wave-1 acceptances

**Status:** Resolved 2026-08-02
**Systems:** Docs
**Related:** LLP 0135 §4, LLP 0136 Appendices A/B, LLP 0073, LLP 0091,
LLP 0094, LLP 0120, LLP 0134

The 2026-08-02 survey found that amendments both Wave-1 specs required to
fold into downstream docs *at acceptance* never landed, so those docs are
stale relative to Accepted specs:

1. LLP 0135 §4 — "Fold-on-acceptance amendments (drafted, not applied)" —
   apply as dated amendments to the named downstream docs (LLP 0120 family).
2. LLP 0136 Appendix A — the draft LLP 0073 amendment marked "apply only on
   acceptance" (acceptance happened 2026-07-31; the fold did not) — and
   Appendix B's dated 0091/0094 wire amendments.
3. LLP 0134's in-doc `## Status` section still reads "Draft." while its
   header reads Accepted — the same drift 0133 had corrected on 2026-08-01;
   0134 was missed by that sweep. Fix the section.

Coordinate with the wave1-0135 / wave1-0136 implementation tickets: each
fold lands exactly once — whichever ticket gets there first does it and
leaves a dated note in the other.

Docs-only; no code claims. Run ./ref-check --verbose after each fold.

**Exit:** all three items landed as dated amendments in house style; this
ticket closed with the commit list.

## Running log

- **2026-08-02 — reconciliation applied, no code claims.** The LLP 0135 §4
  owner folds now appear as dated amendments in LLP 0110, 0080, 0051, 0108,
  0133, 0113, 0043, and 0008; LLP 0120 records that snapshot-batch answers
  bounded fan-out and sequence allocation is its own primitive while
  aggregates remain open. LLP 0136's Appendix A/B contracts are folded into
  LLP 0073, 0091, and 0094 as staged accepted designs with implementation,
  schema regeneration, and capability evidence explicitly pending. LLP
  0134's body Status now agrees with its Accepted header. LLP 0135/0136 mark
  their fold lists applied so implementation lanes do not repeat them.
- **2026-08-02 — proof.** `./ref-check --verbose` and the docs-only guide
  check gate the landing. No runtime, schema artifact, guide capability, or
  maturity claim changes in this ticket.
- **2026-08-02 — landed.** Commit
  `d7eef3c65db5ab39abcefdebc0c642b247c02623` is on main with all three
  reconciliation items and the implementation-lane coordination notes.
