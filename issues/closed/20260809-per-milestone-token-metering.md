# social-messenger harness: per-milestone token phases not metered

**Status:** Closed (2026-08-21)
**Systems:** Benchmarks, Agent harnesses, Measurement
**Related:** LLP 0201 D2; LLP 0295 D0.6; P2 pilot finding F3
**Landing SHA:** 59894588b

Found in the P2 pilot (record:
`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`, F3).

The run-record extension schema defined per-milestone wall and token phases,
but the pilot's driver (orchestrator plus background agents) observed only
lane-total tokens at completion. Token caps are keyed by `(cap family,
milestone)`, so they could not be calibrated or enforced without
per-milestone attribution.

## Ruling

The 2026-08-20 orchestrator ruling selects the diary-0069 harness-native path
as the sole cap-bearing channel. There is no estimator subsystem. Terminal
snapshots are prefix sums over harness-native per-turn usage joined to
driver-stamped green/cap/abort boundaries in execution order. Families whose
harness provides no trustworthy per-turn usage record use explicit
reason-coded honest nulls and cannot adjudicate a token cap under LLP 0201 D2.

The cap sums **fresh input plus native output**. Cache reads and writes remain
recorded but excluded; reasoning/thinking is recorded as an output subset and
is not double-counted.

## Resolution

- `benchmarks/tools/social-messenger/metering/manifest.mjs` verifies the
  driver's hash-bound builder/descendant session tree, receipt identities,
  terminal-boundary artifact, wall origin, and recorded clock-skew bound.
- `benchmarks/tools/social-messenger/metering/joiner.mjs` differences every
  attempted milestone's terminal prefix — green, cap, or abort — so a failed
  or final failed attempt is emitted and never charged to its successor.
- `benchmarks/tools/social-messenger/metering/adapters/claude-session.mjs`
  globally de-duplicates Claude messages across the retained tree;
  `adapters/codex-session.mjs` differences cumulative `token_count` records
  within each rollout before aggregating descendants. Delegation is charged,
  not prohibited. `adapters/unavailable.mjs` emits reason-coded nulls for any
  family whose approved tree is unavailable.
- `benchmarks/tools/social-messenger/metering/watchdog.mjs` requires a real
  enforcement controller and wall origin, gates the next model turn until
  termination acknowledgement and then refuses it, retains post-trip
  overshoot, and preserves lane-global turn identity across milestone arms.
- `benchmarks/schema/social-messenger/run-record-extension.schema.json` now
  records fresh/cache/output/reasoning counts, terminal sequence/status, and
  the explicit `firstProductEdit` snapshot (orientation bytes/tokens plus selected skills)
  required by LLP 0295 D0.6 and the matrix skill-routing ticket.
- `benchmarks/schema/social-messenger/run-record.schema.json` composes the base
  and extension schemas and mechanically restricts approved sources plus the
  advisory/unavailable null-cap posture.
- `benchmarks/protocol.md` names the aggregation policy, manifest provenance,
  inclusive turn-to-terminal rule, unavailable fallback, exact cap counters,
  enforced watchdog contract, and first-product-edit receipt.
- Synthetic and retained-usage-only fixture tests under
  `benchmarks/tools/social-messenger/metering/test/` prove Claude/Codex
  descendant aggregation, every-terminal prefix/delta joins, exact-boundary
  inclusion, honest nulls, cross-milestone de-duplication, composed-schema
  refusal, and end-to-end no-turn-after-trip enforcement.

No live benchmark rerun was required for this implementation. Token caps must
still seed only from fresh lanes run under the retained native meter; the P2
pilot's lane-total figures remain unmetered at milestone grain.
