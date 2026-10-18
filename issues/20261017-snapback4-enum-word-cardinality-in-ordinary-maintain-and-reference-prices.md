# Snapback 4: Enum word cardinality missing from two ordinary writer prices

**Status:** Open
**Date:** 2026-10-17
**Systems:** Snapback 4, existing maintained-column and reference-action pricing
**Found by:** Muse native-admission delta review (LIVE implementation r7)

Core word-index admission accepts Text and Enum (including optional forms).
Two existing formulas count only Text and use zero for Enum:
`schema/reservations.rs`'s private-maintain parent index cardinality, and
`schema/references.rs::unit_write`. Enum values such as `one two` emit two
word keys despite zero admitted entries at these sites.

Static follow-up, not an executed exploit or failure claim. Both formulas
predate LIVE; the reference-action file is unchanged versus `bbc4b4a9fd`.
LIVE's native bulk/adoption helper now counts Enum variants and empty index
records, with focused tests. Its endpoints refuse private maintained columns
and writing reference actions, so this remaining issue is outside those live
maintenance paths. The independent reviewer marked it nonblocking for the
delta. Preserve the existing runtime ceilings when fixing the sibling prices.

Suggested fix: share a saturating cardinality bound over all admitted word
column kinds; regress maintained and reference-action writers with Enum word
indexes. Review provenance: [verbatim Muse review](../llp/reviews/3000.014.000-live-parent-implementation-r7.muse.md).
