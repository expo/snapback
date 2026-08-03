# Wave-1 remainder: implement LLP 0135 — sequence allocation + snapshot-batch composition

**Status:** Closed 2026-08-03
**Systems:** Runtime, Storage, API, Wire Protocol
**Related:** LLP 0135 (Accepted 2026-07-31; handler-tier sequence substrate
implemented 2026-08-02 but unpublished, snapshot half unblocked), LLP 0120
(option 3a), LLP 0155 Move 1 and LLP 0157 §D8 (same option-3a family)

Two halves with different readiness:

- **Sequence half — substrate landed, publication remains.**
  `ctx.sequence.allocate` gapless/monotonic allocation
  (`sequence_allocation_v1`) now has declared sequences, order-field bounds,
  and per-scope serialization named in the API (the scope is part of the API,
  not a footnote — LLP 0128 guardrail 2). The A6 demo proves the local
  handler-tier substrate; the combined sequence checkpoint also implements the
  generated `AllocateSequence` step and lane-Q mutation-atomic withholding.
  Those additions do not qualify target support: the remaining §5.1
  disclosure/performance/commit-order corpus is still required before LLP 0113
  publication. Until then the capability is support-false with a structured
  GAP.
- **Snapshot-batch half — unblocked.** `snapshot_batch_v1` (multiple query
  nodes in one cursored batch with a composite `sbsb1` cursor over
  bounded-children nodes) is the same LLP 0120 option-3a family the LLP 0155
  Move-1 composition-algebra Spec adopts. LLP 0157 §D8 resolves the ownership
  question: LLP 0135 Part 2 is implementable as written and owns the cursor
  grammar. LLP 0157's identity, completeness, inspection, and store layers
  attach without changing those execution semantics.

Also due at landing: apply LLP 0135 §4's fold-on amendments ("drafted, not
applied") to their downstream docs if the hygiene ticket has not already.

**Exit:** both parts' §5 executable acceptance implemented; capability ids
registered and honestly published through LLP 0113 only after qualification;
the A6 arm on the real primitive; dated implementation-record amendment on the
LLP; LLP 0115 board row updated.

## Coordination log

- **2026-08-02 — owner folds taken by corpus hygiene.** The
  `20260802-corpus-hygiene-fold-on-amendments` lane applied LLP 0135 §4's
  dated owner amendments at `d7eef3c65db5ab39abcefdebc0c642b247c02623`
  and marked §4 folded. This implementation ticket
  must not repeat them; it still owns code, executable acceptance, capability
  registration, demo replacement, and the implementation record.
- **2026-08-02 — sequence substrate implemented; ticket intentionally remains
  open.** The local SQLite/Ibex source tree now has declared
  `ctx.sequence.allocate(counterName, scopeId)`, incarnation-scoped serialized
  counters, atomic settlement/replay facts, safe-integer exhaustion,
  membership/public scope reach, explicit brownfield-incarnation activation,
  UTF-8 order-field bounds, and focused package/runtime/storage substrate
  evidence. A6 now
  uses the primitive and asserts JOB-4..JOB-9 plus exact receipt allocation
  facts; literal seed and reset/restore histories are bridged with real
  committed allocations. This does not publish `sequence_allocation_v1`:
  support remains false with a structured GAP until all of §5.1 and LLP 0113's
  qualification route are satisfied.
- **2026-08-02 — sequence integration checkpoint.** The generated
  `AllocateSequence` plan step and lane-Q mutation-atomic optimistic withholding
  now extend the implemented substrate with focused proof. They remain
  insufficient for publication while the other §5.1 vectors are open.
- **2026-08-02 — snapshot half unblocked.** LLP 0157 now exists, and §D8
  explicitly adopts LLP 0135 Part 2, calls it implementable as written, and
  confirms that its `sbsb1` cursor grammar belongs to LLP 0135. The composite
  remains unimplemented and unregistered; standalone `sbbc1` already exists
  under the bounded-children profile. The ticket remains Open for the actual
  snapshot implementation and acceptance, not for a cursor-ownership hold.
- **2026-08-02 — static snapshot carrier checkpoint, still unpublished.**
  The Rust manifest now has a closed `SnapshotBatchPlanV1` carrier and
  standalone admission analysis for the 2–8 bounded-child tuple, summed
  `take <= 1024`, exact merged parent-id arguments, per-node schema/index/
  projection validation, order-bound registration, read/effect summaries,
  and internally derived structural parent-authorization groups.
  `snapshot_batch_v1` is registered at experimental maturity but its positive
  support predicate is false on every target and every target reports the
  structured GAP. Whole-function admission deliberately still refuses: the
  existing result-contract vocabulary cannot exactly represent the visible
  heterogeneous node tuple, and LLP 0135 does not pin
  `ParentAuthorizationKeyV1`'s closed canonical record bytes. Both owner
  questions are recorded in `issues/20260802-author-decision-packet.md`.
  No executor, `sbsb1` runtime integration, live delivery, canonical plan hash,
  cross-language key bytes, or publication claim lands in this checkpoint.
- **2026-08-02 — remaining snapshot half held for LLP 0157.** Charlie's
  wave-closing rescope leaves the static carrier checkpoint above in place but
  stops further LLP 0135 implementation in this wave. The sequence substrate
  and snapshot carrier remain support-false with their structured GAPs; no
  executor, cursor publication, or target claim is implied. Resume the held
  snapshot half only with the LLP 0157 composition-spec work and the two
  recorded author rulings resolved.
- **2026-08-02 — end-of-wave greening residue.** Rust 1.97 clippy reports
  `clippy::collapsible-if` in `src/value_expr.rs`'s sequence-allocation
  binding-order validator (landed with the sequence checkpoint). Its focused
  correctness tests remain green; unrelated feature lanes may allow only this
  named lint while retaining `-D warnings` for their own code. The single
  end-of-wave greening pass owns the mechanical cleanup.
- **2026-08-02 — diagnostic-inventory residue found by obs-05.** The full Rust
  suite on the obs-05 emission landing found the existing HTTP diagnostic
  inventory gate missing four sequence/snapshot codes:
  `SEQUENCE_ACTIVATION_STATE_INVALID`,
  `SNAPSHOT_BATCH_CEILING_EXCEEDED`,
  `SNAPSHOT_BATCH_NODE_INELIGIBLE`, and
  `SNAPSHOT_BATCH_PLAN_INVALID`. The observability lane does not own those
  classifications and did not guess them. Per Charlie's relaxed landing
  cadence, the end-of-wave greening pass owns their batch registration; the
  feature's focused correctness suites remain green.

## Resolution — 2026-08-03

The released snapshot-batch half is complete on the contributor local target:
exact LLP 0157 plan identity and `sbsb1` bytes, one-snapshot multi-node
execution, structural parent authorization dedup, sealed tuple results,
coordinated resume/restart, cursor-free-first-page live replacement, codegen,
capability support, guide coverage, and executable three-node acceptance all
land together with the dated LLP 0135 record and LLP 0115 board update.

The sequence substrate had already landed and was verified rather than
reimplemented. Its intentionally unfinished target-qualification/publication
work now has the single-purpose follow-up
`issues/20260803-sequence-allocation-qualification.md`; closing this mixed
umbrella does not imply `sequence_allocation_v1` support.
