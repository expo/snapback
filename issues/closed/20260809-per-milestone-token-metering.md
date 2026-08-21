# social-messenger harness: per-milestone token phases not metered

**Status:** Closed (2026-08-21)
**Systems:** Benchmarks, Agent harnesses, Measurement
**Related:** LLP 0201 D2; LLP 0295 D0.6; P2 pilot finding F3
**Landing SHA:** TBD

Found in the P2 pilot (record:
`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`, F3).

The run-record extension schema defined per-milestone wall and token phases,
but the pilot's driver (orchestrator plus background agents) observed only
lane-total tokens at completion. Token caps are keyed by `(cap family,
milestone)`, so they could not be calibrated or enforced without
per-milestone attribution.

## Ruling

The 2026-08-20 orchestrator ruling selects the diary-0069 harness-native path
as the sole cap-bearing channel. There is no estimator subsystem. Boundary
snapshots are prefix sums over harness-native per-turn usage joined to the
milestone receipt timestamps. Families whose harness provides no trustworthy
per-turn usage record use honest nulls and remain token-cap-advisory under LLP
0201 D2.

The cap sums **fresh input plus native output**. Cache reads and writes remain
recorded but excluded; reasoning/thinking is recorded as an output subset and
is not double-counted.

## Resolution

- `benchmarks/tools/social-messenger/metering/joiner.mjs` joins normalized
  usage to `receipts-m*.jsonl` and/or stamped `suitePassAt` /
  `choreoPassAt` boundaries, emitting schema-shaped per-milestone authoring
  token phases and replayable prefix snapshots.
- `benchmarks/tools/social-messenger/metering/adapters/claude-session.mjs`
  de-duplicates Claude per-message session usage; `adapters/codex-session.mjs`
  adds the missing Codex rollout-log adapter by differencing cumulative
  `token_count` records. Kimi and Grok use `adapters/advisory.mjs` and emit
  null phases.
- `benchmarks/tools/social-messenger/metering/watchdog.mjs` is the separable
  driver enforcement hook. It arms one `(cap family, milestone)` budget,
  de-duplicates stable turn IDs, excludes cache counters, and emits the LLP
  0201 `capability-failure` / `capped-tokens` charging block once exhausted.
- `benchmarks/schema/social-messenger/run-record-extension.schema.json` now
  records fresh/cache/output/reasoning counts and the explicit
  `firstProductEdit` snapshot (orientation bytes/tokens plus selected skills)
  required by LLP 0295 D0.6 and the matrix skill-routing ticket.
- `benchmarks/protocol.md` names the approved native sources, inclusive
  turn-to-green boundary rule, null fallback, exact cap counters, and
  first-product-edit receipt.
- Synthetic fixture tests under
  `benchmarks/tools/social-messenger/metering/test/` prove Claude/Codex
  normalization, prefix/delta joins, exact-boundary inclusion, honest advisory
  nulls, schema-shaped output, and one-shot watchdog charging.

No live benchmark rerun was required for this implementation. Token caps must
still seed only from fresh lanes run under the retained native meter; the P2
pilot's lane-total figures remain unmetered at milestone grain.
