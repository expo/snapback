# LLP 0214 landing: persistent-store qualification receipt re-mint needs an external secret

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Systems:** Publication carriers, Custody
**Date:** 2026-08-16

## Context

The LLP 0214 ctx.auth.claims + binding-seal landing changed src/local.rs, which
rotates the source hash embedded in the local persistent-store publication
carrier. The carrier + anchor were re-minted and all verifiable gates pass
(publication manifest tests 70/0, agent_safe_publication_checker 110/0,
bounded_children_v1/write_activity_v1 4/0, single_table_v1 2/0, cargo check
clean). The persistent-store QUALIFICATION RECEIPT freshness re-mint is blocked
by the missing externally-custodied `SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG`
(owned by the LLP 0234 visibility-governance feature, unrelated to this lane).
The existing receipt was retained unmodified (not faked); its retained-source
check fails closed correctly. No lane-G gate is red.

## Fix-forward

When `SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG` is available (visibility-
governance owner / external custody), re-mint the persistent-store qualification
receipt to pin the current src/local.rs and confirm the retained-source check
passes. Until then the capability verification stands on the reconciled carrier
+ retained receipt.
