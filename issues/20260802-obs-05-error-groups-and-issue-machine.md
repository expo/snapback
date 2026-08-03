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

### 2026-08-02 — integration note from the LLP 0135 sequence lane

After rebasing onto `96f56cb6`, the complete Rust library suite passed 1,797
tests but the reviewed HTTP diagnostic inventory gate found these newly
emitted observability diagnostics unclassified:
`SNAPBACK_ERROR_GROUP_STATE_INVALID`,
`SNAPBACK_ERROR_RESOLVE_BARRIER_MISSING`,
`SNAPBACK_ERROR_ROLLOUT_INVALID`,
`SNAPBACK_ERROR_STATE_SEQUENCE_EXHAUSTED`,
`SNAPBACK_ERROR_STATE_SEQUENCE_INVALID`,
`SNAPBACK_ERROR_TRANSITION_SERIALIZATION_FAILED`,
`SNAPBACK_TELEMETRY_SEQUENCE_EXHAUSTED`, and
`SNAPBACK_TELEMETRY_SEQUENCE_INVALID`. The sequence lane did not assign HTTP
semantics for another subsystem; the D-05/observability owner should classify
them in the reviewed `src/server.rs` table and rerun
`server::tests::s5_d10_production_diagnostic_inventory_cannot_drift`.

### 2026-08-02 — tranche 4: E0 runtime carrier checkpoint

This collision-minimized checkpoint completes the runtime capture and private
carriage half of checklist 2 without wiring an observation emitter:

- the shared settle harness extracts `name`/`constructor.name`, message, and
  stack independently under hostile getters, validates the closed
  `errorClass` grammar, and bounds message/stack at 16 KiB with explicit
  truncation witnesses; the shared JS envelope decoder revalidates and
  preserves that private carrier through refusal admission and Cloudflare
  platform-failure classification while proof and kit responses remain
  carrier-free;
- Rust handler-output decoding re-bounds and revalidates the carrier into a
  serde-skipped `SnapbackError` context. Clone and witness-replacement paths
  preserve it, while action secret redaction scrubs its raw message and stack;
- every Ibex prepared-invocation path now carries immutable
  `trackedRefusals`, and admitted application refusals are privately marked as
  tracked or admitted-untracked without changing admission or public
  diagnostics; and
- the existing Hermes asynchronous-failure ABI is decoded before either
  owned string or the value handle is released, preserving its closed class,
  message, stack, and truncation flags. Multiple unhandled rejections remain
  an ordered carrier vector and deliberately select no fingerprint winner.

Focused Air evidence: exact-link bootstrap and restricted no-eval VM
qualification; `cargo check --locked --lib`; the three actual-Ibex private
carrier tests; all eight handler-output/admission tests; private diagnostic
serialization and action-secret redaction; the existing deterministic
whole-record allocator test (including oversized `appDetails` whole-drop);
and the Ibex/workerd hostile-getter parity test. The local-proof harness test
adds poisoned getters, an all-getter-trapping Proxy, thrown primitive
families, invalid/reserved classes, and Cloudflare carrier-preservation
folds.

Explicitly deferred: consuming the private context at the existing
observation seam and all telemetry/local/server emission; carrying
`trackedRefusals` into the hosted-JS refusal-disposition path; and choosing
how one terminal with multiple ordered unhandled rejections maps to eligible
fingerprints. The last question is recorded in the author decision packet.
This ticket remains **Open**: this checkpoint is neither whole E0 emission nor
E1/D-06 completion.

### 2026-08-02 — tranche 5: Rust local/server emission and E1 fold proof

The existing Rust producer seams now consume the serde-skipped failure context
without widening `Diagnostic`, its API envelope, or any CLI/MCP/console
surface. One telemetry-private helper owns the required order: apply
`ErrorClassificationV1`, select and stamp an eligible fingerprint from the
already-admitted record and at most one carrier, then run the closed 8 KiB
details allocator. `ObservationSpan::finish_error` takes the private context
from the returned `SnapbackError`; ordinary span completion covers code-bearing
typed failures and code-less HTTP transport failures; the standalone
diagnostic point supplies its validated subsystem. The flush transaction is
unchanged and proves E1 by materializing only the producer stamps.

Focused coverage pins the local prepared-invocation disposition:
`trackedRefusals` produces an eligible `app_refusal` fingerprint while an
admitted-untracked refusal carries the same disposition without a fingerprint
or group. A detached server nested-mutation throw consumes its exception
carrier and stamps `errorClass`/normalized template identity. A nested logical
`function_run` plus its registered HTTP carrier deliberately emits and groups
two records with distinct `(kind, name, branch)` identity; that is the two
existing observation seams, not duplicate publication of one issue.

This still does **not** complete obs-05. The author-blocked multiple-unhandled
path preserves the classifier's truthful residual `fault` and
`issue_eligible: true`, but selects no carrier or fingerprint winner. It
therefore remains raw, increments `malformed_error_stamp_count` exactly once,
and creates no group; a focused test pins that fail-safe behavior pending the
ruling in `issues/20260802-author-decision-packet.md`. No first/last/aggregate
winner is inferred.

Hosted-JS tracked-refusal disposition also remains out of this tranche for an
exact authority reason: `cloudflare/src/coordinator.js` calls the shared
`admitDeclaredRefusal(fn.refusals, ...)`, while
`packages/snapback-harness/envelope.mjs` accepts only the declared set and its
result carries no trusted `trackedRefusals` membership. Extending that hosted
path would require a reviewed immutable tracking-authority carrier and a
hosted observation owner; the Rust `PreparedInvocation` authority cannot be
inferred from handler bytes.
