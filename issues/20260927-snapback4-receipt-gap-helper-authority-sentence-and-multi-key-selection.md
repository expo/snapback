# Snapback 4: the receipt-gap helper's authority sentence is too wide, and multi-pinned-key selection follows name order

**Opened:** 2026-09-27, Grok's and Astra's round-2 blind reviews of `96d67e2569` (the calibration #23 data_modeling landing)
**Severity:** Low: advice precision; no disclosure (the helper's integer matches the all-absent run in every case both reviewers built)
**Area:** the `E_STRUCTURAL_FANOUT` expiry-scan rewrite (`snapback4/crates/snapback4-lang/src/bind/program/constraints.rs`), the sequences card (`guide/sequences.md`)
**Status:** Open

Two precision gaps in the pasteable `skipExpired_*` helper and its advice,
found after the landing closed the round-1 defects:

1. **The authority sentence lists a membership check as sufficient.** The
   diagnostic and the card say the prefix justifies a receipt advance only
   after the caller's own authority check, "the membership check or the
   card's readable-message anchor". Under `read <- deny`, `require exists
   members[...]` passes and the helper still returns the same prefix whether
   ordinal 1 is absent or held by a live hidden row (Grok: prefix 3 either
   way; no disclosure, but the advance is unjustified). The anchor
   point-read is the check that fails closed; membership alone is not. Tighten
   the sentence to name the anchor as the required check and membership as
   the usual way to make the anchor readable, and adjust
   `deny_and_read_through_scopes_require_authority_before_using_the_prefix`
   to assert the tightened text.
2. **Several pinned required references with covering keys resolve by name
   order.** With `unique aaa: room, ordinal` and `unique zzz: conversation,
   ordinal`, both `room` and `conversation` pinned by scalar equality, the
   helper probes `room`. A row with that room and ordinal in another
   conversation stops the probe early (it never skips an in-scan live row,
   so the error is in the safe direction), but the helper is not the scan's
   scope. Prefer the reference the refused scan is ordered within (the one
   whose equality bounds the page), and withhold with the plain diagnostic
   when that cannot be determined. Add the two-pinned-reference case to
   `helper_follows_the_scan_coordinate_regardless_of_key_order_or_other_indexes`.

Reproductions: Grok's under `~/sb5/reviews/dm2-grok-probes/` and Astra's
`key-probes.log` under `~/sb5/reviews/dm2-astra-probes/` on EPYC.
