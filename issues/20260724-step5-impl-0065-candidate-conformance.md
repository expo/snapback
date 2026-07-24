# 0065: move the standard-patterns candidate to the accepted spec

**Status:** Open
**Severity:** P2
**Systems:** Codegen, Authorization, Generated operations
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0065 §§2-3, 5
**Marker:** step5-impl

The shipped candidate in `packages/snapback-codegen/standard-patterns.*` predates
acceptance and the RFC governs where they diverge. Bring it to spec:
collapsed public refusals (`SNAPBACK_ROW_NOT_FOUND` only at the boundary,
`SNAPBACK_ROW_NOT_VISIBLE` confined to the server trace); explicit
`listIndex` with the owner-leading index requirement and
`SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED`; list ordering by index
sequence + `_id` tie-break (needs the 0007 implicit-suffix ticket);
integer-millisecond `now` fields only; the principal gate order with
`SNAPBACK_STANDARD_PATTERN_PRINCIPAL_UNSUPPORTED` reserved for
authenticated-but-ineligible principals; authority-bearing-table refusal
(`SNAPBACK_STANDARD_PATTERN_TABLE_INELIGIBLE`); versioned opaque cursors
bound to the app authority domain with
`SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID`; the unique-conflict
owner-partitioned-or-declared-disclosure rule. M-sized.
