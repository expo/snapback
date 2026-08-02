# D-05: E0 classifier/carrier + fingerprint seams, error_groups, issue state machine (LLP 0156 checklist 1–3)

**Status:** Open — released 2026-08-02 (LLP 0156 Accepted at v0.7);
depends on obs-01 (closed on the amended schema) and obs-02
**Program:** 20260802-obs-00-program.md
**Systems:** Error tracking, Observability, Runtime

Realigned 2026-08-02 to the v0.7 checklist — the super-refine loop
restructured this scope; the earlier body cited the v0.2 draft. Implement
LLP 0156 §Deliverables checklist items 1–3 exactly:

- **E0 classifier (checklist 1):** `ErrorClassificationV1` — the
  exhaustive first-match precedence table (residual `fault` arm), applied
  to failed terminal AND Warning+ point records — in the 0154
  operation-class registry vocabulary as a dated amendment
  (`failure_disposition`, distinct from 0154's usage `disposition`);
  manifest opt-in for declared refusal codes (LLP 0108); the coupling
  rule (disposition-changing revisions bump `fp_version`); classifier
  fixtures per the checklist.
- **E0 carrier (checklist 2):** grammar-validated `errorClass`
  (`unclassified` reserved sentinel) + `stack` in the settle envelope
  with poisoned-getter-safe extraction; the deterministic whole-record
  byte allocator (total occupant order) within 0154's 8 KiB details cap;
  async-seam stack decode; Ibex/workerd parity fixtures + the
  adversarial matrix.
- **E1 store (checklist 3):** the four tables (`error_groups`,
  `error_exemplars`, `error_transitions`, `release_activations`) +
  visible views; flusher upsert + state machine + the restart-safe
  resolved-seq barrier (`enqueue_high_water` + rollout bounds in
  `telemetry_meta` — a dated 0154 D3/meta amendment; the resolve
  transaction advances the high-water); exemplar budgets; fold-only
  group cap with `overflow_fold_count` in meta; horizon sweeps and
  floors; the `iss_` Issue registry row — **OQ-A2 is resolved**: minted
  `TimeOrdered` body, determinism via
  `UNIQUE(generation, fp_version, fp_hash)`; the pinned fingerprint
  byte grammar with cross-language vectors.

Design authority: 0156 §E0.1–E1.3 at v0.7. The per-row `release` column
this consumes exists via 0154's 2026-08-02 admission-identity amendment.
Stack-based fingerprints remain rejected until symbolication — do not
add them. The E0 amendments touch 0154's registry/allowlist/meta:
coordinate with obs-01/obs-02's landed code, and land them as dated 0154
amendments in the same commit as the code.

**Exit:** checklist 1–3 fixture gates pass (the full list lives in
checklist 6 and is proven in obs-06); registry rows landed; ref-check
green.
