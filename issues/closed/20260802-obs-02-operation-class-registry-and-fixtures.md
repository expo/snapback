# D-02: Operation-class registry, OQ1 ratification vs LLP 0104, boundary-protocol fixture corpus (LLP 0154 checklist 2)

**Status:** Closed — implemented 2026-08-02 in
`52b50e384a7ead4698bc257de6738781cbf2ecc4`
**Program:** `issues/closed/20260802-obs-00-program.md`
**Depends on:** 20260802-obs-01
**Systems:** Observability, Testing

Implement LLP 0154 §Deliverables checklist item 2 exactly. The versioned
operation-class registry; the OQ1 projection-matrix ratification against
LLP 0104 checked by shared fixtures that both the telemetry and metering
projections deserialize. The fixture list in the checklist is long and
normative — read it in the LLP and implement it verbatim (derived
multi-metric event ids, no double counts, per-class timing/timestamp
semantics, retry/dedup, registry-version behavior, reset/in-flight
generation races, raw-tail stats across restart, late-completion bucketing,
cap exhaustion, snapshot-bounded export; boundary-protocol: 7→1→7 and
N→0→N `max_days` transitions, clock rollback vs the floor and across an
hour-finalization boundary, hatch/server parity, mid-hour maintenance
exactly-once).

**Exit:** every named fixture exists and passes; the OQ1 ratification is a
dated note in LLP 0154 cross-checked against LLP 0104 — if the matrices
disagree, that's a decision-packet append, not a silent fix.

## Running log

- **2026-08-02 — acceptance gate open, dependency still blocked.** LLP 0154
  is Accepted and obs-01's single generation-bound substrate landed at
  `bf73583dfb748872045a0d98e61b4632d4207076`. Read-only reconciliation
  found the operation-class work otherwise buildable, but checklist 2's
  shared telemetry/metering projection fixtures cannot be ratified while D2
  requires app/environment/release identity and the fixed event schema does
  not choose its durable representation. That author question is already in
  `issues/20260802-author-decision-packet.md`; this ticket will neither omit
  the fields nor invent columns/details/meta semantics. Work resumes when the
  packet supplies the representation and obs-01 can close on it.
- **2026-08-02 — unblocked.** The admission-identity question is RESOLVED in
  the decision packet via a dated LLP 0154 amendment (worked through with
  Charlie in the 0156-promotion session): `release` is a fixed nullable
  column on `telemetry_events` (out of the `details` allowlist);
  app/environment identity is meta-pinned (`telemetry_meta.app_id`/
  `environment`, stamped into exports at egress). For this ticket's shared
  fixtures: projection equality is checked on the composed record (row +
  meta) against the C7 envelope's identity fields. obs-01 should close on
  the amended schema (one added column + two meta fields against the landed
  substrate at bf73583d) before this ticket starts.
- **2026-08-02 — implementation and proof complete (implementation commit:
  `52b50e384a7ead4698bc257de6738781cbf2ecc4`).** Added the closed
  `operation-class.v1.json` registry, one shared
  `telemetry.projection-fixtures-v1.json` corpus, pure telemetry/metering
  projections, stable per-metric event IDs, and typed registry admission at
  the existing OBS-01 producer seams. No writer, queue, second ingestion
  pipeline, or network SQL surface was added. LLP 0154's OQ1 now carries the
  dated ratification against LLP 0104, including the exact chargeable platform
  subset, complete system exclusions, timestamp stages, derived
  `backend_requests = 1`, measured-fact allowlists, retry/dedup behavior, and
  fail-closed version/unit/duplicate rules.

  The focused post-rebase proof passes 62 tests: 47 telemetry-module tests, 11
  registry/projection contract tests, and four independent committed-corpus
  consumer tests. Of those, this change adds 27 hand-authored tests (12 store
  boundary tests, 11 contract tests, and four independent consumer tests).
  Every checklist-2 store boundary is an explicit SQL/state assertion, not a
  generated-oracle-only fixture. `./ref-check --verbose` and
  `git diff --check` also pass. The full library audit completed with 1,736
  passed, 1 ignored, and four inherited failures:
  `local::tests::generated_demo_manifests_pass_the_effect_ceiling_subset_check`
  (ignored `demos/todo-v2` generated artifacts are absent in a fresh
  worktree), `local::tests::rqs_mutation_after_answer_and_register_loses_no_ops`,
  `local::tests::rqs_tokens_refresh_across_delta_replace_and_current_as_of`,
  and `local::tests::standard_pattern_live_is_conservative_and_recorded`.
  Isolated OBS-02 tests, including the reviewed diagnostic inventory, are
  green.

  `node scripts/check-guide.mjs` retains three inherited errors outside this
  GAP-only slice: missing ignored snippet sources
  `demos/todo-v2/snapback/generated/contract/setCompleted.mutation.ts` and
  `demos/todo-v2/snapback/generated/contract/runtime-links.ts`, plus stale
  `guide/guide-manifest.generated.json`. The capability stays explicitly GAP
  until D-04; this ticket makes no claimable guide promotion.

## Resolution

Implemented by `52b50e384a7ead4698bc257de6738781cbf2ecc4` and closed
2026-08-02. The registry, shared corpus, pure projections, typed production
admission, independent consumers, store-boundary fixtures, and dated LLP 0154
OQ1 ratification satisfy checklist 2 while preserving OBS-01 as the sole
telemetry substrate. The proof and inherited failures are recorded above.
