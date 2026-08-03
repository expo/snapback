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

## Running log

### 2026-08-02 — collision-safe tranche 1: pure contracts

Branch `codex/d05-contract-20260802` began from `origin/main` at
`8fdcd41eef93cd28d4deb76991e93ae06a2c0a55`. This checkpoint lands only
the collision-free authoring-independent slice:

- the pure typed classifier/carrier/fingerprint/details-allocator module and
  generated Rust/JavaScript vectors;
- operation registry `registryVersion: 2`'s additive classifier vocabulary,
  retaining the `operation-class.v1.json` artifact family;
- the `iss_` `Issue` registry row with a `TimeOrdered` body; and
- this LLP 0154 registry/D2 amendment.

The full classifier corpus uses an independent expected-value oracle and
covers every frozen cancellation, timeout, overload, and caller membership,
plus admitted app refusal, transport 4xx/5xx, projected-400 logical faults,
and `_unmatched`, across all eight Phase-1 kinds, all four carrier categories,
and both opt-in states.

Deliberately deferred from this checkpoint: `trackedRefusals` authoring,
manifest validation, and the corresponding dated LLP 0108 amendment, because
the concurrent 0134 maturity lane owns `src/manifest.rs`, codegen emission,
and the shared package-test inventory on the same base. That additive commit
must follow the 0134 landing/rebase and preserve both inventory additions.
Also deferred as later D-05 tranches: settle/async handler carrier wiring,
`telemetry.rs` storage/flusher/state-machine work, `runtime.rs`, `server.rs`,
`local.rs`, guide/capability publication, and all D-06 surfaces.

### 2026-08-02 — collision-safe tranche 2: refusal tracking authoring

After tranche 1 landed as `2d05933d` and the 0134 maturity lane landed, this
branch rebased to that integrated head and completed the deferred private
authoring authority:

- `trackedRefusals` is accepted by every function builder, declared in the
  TypeScript authoring surface beside the previously missing `refusals`
  property, and emitted only when non-empty;
- builder validation, defensive codegen validation, and Rust manifest-load
  validation enforce a unique subset of the function's declared `refusals`;
- the immutable prepared invocation carries both sets for the later emission
  tranche; and
- schema artifacts plus independent authoring/type/Rust tests pin the field,
  subset refusals, omission default, and absence from public/provider
  projections.

This tranche still does not change refusal admission or wire envelopes, emit
telemetry, project the field publicly, or touch `runtime.rs`, `telemetry.rs`,
`server.rs`, `local.rs`, guide/capability publication, or D-06.

### 2026-08-02 — tranche 3: E1 store checkpoint

The store-only E1 slice now lives in `telemetry.rs`, with no runtime, server,
local-publication, host-op, CLI, MCP, or console surface changes:

- legacy-safe schema migration creates the four E1 tables and strict
  current-generation visible views; `telemetry_meta` carries the enqueue
  high-water, rollout tuple, fold/malformed/mismatch counters, and activation
  floor;
- the OBS flush transaction inserts raw rows and folds complete closed
  failure stamps atomically, preserving OBS-04's flush-commit witness order;
  malformed eligible carriers remain raw and are counted rather than
  reclassified;
- branch validation now distinguishes code-less 5xx transport fingerprints
  from code-bearing typed/app/exception/diagnostic tuples, including closed
  `subsystem`, `errorClass`, `appCode`, and `statusClass` facets;
- group folding is cap-bounded without eviction, exemplar rings have separate
  UTF-8 byte/depth/per-flush accounting, rollout predecessor lookup survives
  raw exemplar aging, and activation cap/horizon pruning advances a visible
  floor;
- direct single and bulk transitions serialize with flush, use checked
  monotone sequences, persist restart-safe resolve barriers, preserve resolve
  provenance through reopen/ignore, replace it on re-resolve, and expose a
  transition-history floor derived from bounded rows plus group authority.

Focused Air evidence at this checkpoint covers fail-before-commit rollback,
closed-branch confusion and code-less transport, same-batch and same-hash
activation ordering, rollout's half-open event-time window, all exemplar
budgets, signed/SQLite sequence exhaustion, direct-transition/flush ordering,
bulk selector ordering, strict disabled/horizon/floor visibility, the exact
resolve-after-lost-admission restart crash schedule, group and activation
caps/floors, generation rotation, fingerprint-version split with exemplars
absent, and transition-history pruning/derived floor. The checkpoint remains
open because E0 runtime carrier wiring and the later E1 public surface are
separate D-05/D-06 tranches.
