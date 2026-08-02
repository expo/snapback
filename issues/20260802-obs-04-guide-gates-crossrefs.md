# D-04: Guide page, capability row, idle + benchmark evidence gates, cross-references (LLP 0154 checklist 4–6)

**Status:** Open — GAP row landable NOW; the rest gated on LLP 0154
Status: Accepted
**Program:** 20260802-obs-00-program.md
**Depends on:** 20260802-obs-03
**Systems:** Observability, Docs, Testing

Immediately, before acceptance: add the missing
`backend.observability-v1` GAP row to `guide/capabilities.md` — LLP 0154
names its absence a standing violation of the index's own policy. (Add the
`backend.error-tracking-v1` GAP row in the same change for LLP 0156.)

After acceptance, per checklist items 4–6: the `guide/` page for the
observability surface and the capability-index row flip; the LLP 0035-style
idle re-run with telemetry enabled (settle write bounded and terminal, zero
writes after settle — C2); the D7 benchmark gate (amplification, burst,
file growth vs C8 cap, flush/sweep stalls, query latency, shed behavior,
app-latency impact); LLP 0000's reserved Observability slot pointed here;
the LLP 0104 cross-reference for the shared span/registry.

**Exit:** guide check green (`node scripts/check-guide.mjs`), both evidence
gates recorded with numbers, cross-references landed as dated notes.

## Running log

- **2026-08-02 — GAP rows prepared.** Added honest design-only GAP rows for
  `backend.observability-v1` and `backend.error-tracking-v1`. Neither row
  claims a target or shipped witness. The observability row remains open for
  its Phase-1 implementation, guide page, idle/benchmark evidence, and
  owning-document cross-references; the error-tracking row remains gated on
  LLP 0156 becoming Accepted and its own D-05/D-06 implementation.
