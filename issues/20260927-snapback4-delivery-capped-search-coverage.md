# Snapback 4: test delivery manifests on a capped compact search page

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 4
**Confidence:** 4
**Systems:** Snapback 4 — delivery manifest (LLP 3000.022), compact membership search (LLP 3000.024), `crates/snapback4-lang/tests/delivery_integration.rs`
**Date:** 2026-09-27
**Related:** lane DS round 4 review (Astra, Low), `snapback4/reports/20260927-delivery-server/ROUND4.md`

## Summary

`compact_membership_search_reports_only_authorized_emitted_images` exercises compact search delivery only on complete answers. Neither search request forces an opening, refill or shaping cut. So a mutation that suppresses the delivery manifest whenever a compact search returns a capped page would survive, silently losing delivery for rows that were emitted. This is a coverage gap; no production defect is observed.

## Fix

Add a tracked/untracked differential with the examined ceiling just below the complete search's usage. Require all of the following:
- a nonempty incomplete page;
- unchanged ordinary meters and continuation behavior;
- manifest coordinates matching exactly the emitted images.
