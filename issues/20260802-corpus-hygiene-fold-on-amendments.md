# Corpus hygiene: apply the unfolded fold-on amendments from the Wave-1 acceptances

**Status:** Open
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
