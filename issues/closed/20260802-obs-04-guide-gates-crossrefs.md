# D-04: Guide page, capability row, idle + benchmark evidence gates, cross-references (LLP 0154 checklist 4–6)

**Status:** Resolved 2026-08-03 — local guide/capability/cross-references and
retained Linux evidence carrier landed
**Program:** `issues/closed/20260802-obs-00-program.md`
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
- **2026-08-02 — pre-evidence D-04 surface staged.** Added the local guide,
  cross-references, adversarial D7 benchmark/smoke gate, and the C2 idle
  harness. The idle witness uses a production-owned transaction sequence and
  requires one boot flush containing both lifecycle markers; the retained
  evidence carrier uses the non-self-referential source-commit → tracked-
  carrier protocol recorded in LLP 0154. The capability remains `partial`
  with an explicit GAP: active D-05/0135/0136/0132 source work is inside the
  strict evidence closure and would immediately stale a retained receipt.
  The remaining tail is: freeze those source tranches, rebase on their final
  main, run the full clean Linux release proof, commit the generated receipt
  in a source-free carrier commit, enable recurring `--check`, record only
  the genuinely observed numbers, and then close D-04.
- **2026-08-03 — D-04 closed.** The final source freeze is
  `176689c0d96f473c8d3c371f7c7fe793972ec62c`. A clean Linux release proof
  measured it and produced the tracked
  `tests/acceptance/telemetry-phase1-evidence.v1.json` carrier; the recurring
  local proof now runs `scripts/verify-telemetry-phase1-proof --check` and
  reopens any source or receipt drift. Exact idle and benchmark numbers remain
  in that machine-readable authority. The proof deliberately keeps the
  ordinary non-telemetry schedulers armed and bounds their aggregate process
  CPU to 100 ms over 120 s using the machine clock-tick resolution; this is a
  scheduler-overhead guard, not a relaxation of C2's exact zero post-settle
  writes. The operating guide, shipped local
  capability row, generated guide projections, LLP 0000/0104/0154
  cross-references, guide check, and ref-check complete checklist items 4–6.
- **2026-08-03 — exact retained measurements.** The release benchmark admitted
  800 application requests and persisted exactly 800 `function_run` plus 800
  `http_request` rows (2 counted rows/request). Worker/direct-flush p95 was
  5.016/1.078 ms; checkpoint p95 was 0.558 ms; the 10,000-row retention sweep
  took 20.025 ms; event/stats-query p95 was 9.551/25.969 ms. File-backed Ibex
  application p95 was 13.840 ms with telemetry and 13.842 ms without it
  (-0.017% measured overhead). The 17,408-event pressure run retained 8,192,
  shed 9,216, and preserved all 1,024 reserved-capacity events. The 1 MiB cap
  run held main + WAL + SHM to 315,392 bytes, preserved all 20 reserved events,
  and shed 278 normal events. Startup settled in one four-event transaction
  sequence after three observed filesystem mutation samples, the last at
  3,314 ms. The following 120,000 ms window had zero storage mutations, zero
  lifecycle mutations, zero read/write bytes, 7 of 10 admitted CPU ticks
  (70/100 ms at 100 Hz), and zero RSS-page growth. The retained JSON remains
  the exact machine-readable authority for these rounded ticket figures.
