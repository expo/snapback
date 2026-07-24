# 0065: EffectCeilingV1 — computed, total, default-deny ceilings

**Status:** Open
**Severity:** P2
**Systems:** Codegen, Authorization, Diagnostics
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0065 §1
**Marker:** step5-impl

Record each closed HostPlan's conservative ceiling as a versioned
`EffectCeilingV1` fact (operations, tables, index ranges, host operations,
authorization dependencies). The traversal is total over the closed plan
vocabulary and default-deny: unknown nodes fail generation. Generation tests
assert each helper constructor's exact expected ceiling; runtime subset check
stays enforcement. Opaque handlers without a proven-complete ceiling remain
ineligible for live/retained capability under LLP 0053. M-sized.
