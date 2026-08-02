# 0133-05: The bounded-skew opt-in — declaration, structural admission, settlement semantics, capability fact

**Status:** Closed
**Program:** 20260802-0133-00-settlement-substrate-program.md
**Systems:** Runtime, Storage, API, Testing
**Depends on:** 0133-03
**Related:** LLP 0133 §The bounded-skew opt-in, OQ3; LLP 0131 (declared
contract vocabulary — coordinate the grammar); LLP 0012 (claim machinery)

## Task

Per-field declared acceptance of a client-captured **time** value in lane L:

- **Declaration** in the mutation's declared contract, illustratively
  `boundedSkew: { field, maxSkewMs }`; the bound validates at declaration
  time (positive, finite, under a grammar-set maximum). Coordinate the final
  grammar spelling with the LLP 0131 args-contract vocabulary rather than
  inventing a parallel dialect.
- **Structural admission (narrowed domain):** only a field whose admitted
  write is structurally a directly-assigned `ctx.runtime.now()`-answer — no
  transform, arithmetic, nesting, or derivation. A structural check against
  the declared contract and admitted write shape, not dataflow analysis;
  transformed uses are inexpressible, not discouraged.
- **Settlement semantics:** one authoritative clock sample per settlement;
  skew = |sample − claimed|; within bound the claimed value is written at
  the declared direct slot only, disposition `accepted-bounded-skew` with
  measured `skewMs`; every other sink of the same answer uses the server
  sample; out of bound falls back to re-derivation, labeled `re-derived`,
  never refused for skew alone; an unwritten declared field leaves the claim
  unused in the ledger.
- **Inert in lane Q, normatively:** the pin accepts with no bound check,
  disposition `accepted` under `replay-accept`.
- **Capability fact** (working id `settlement.bounded_skew`): asserts lane-L
  settlement policy only, never a cross-lane data bound. No target claims it
  without declaration + structural check + bound check + receipt
  disposition all shipping. Resolve OQ3's spelling with the LLP 0012 claim
  classes and add the guide capability row (or a GAP row if the guide page
  waits).

## Exit

Sketch 4 in full: within-bound acceptance with capability fact present;
out-of-bound labeled fallback; the mixed-sink variant (declared field accepts,
undeclared sink of the same answer settles server-derived); the lane-Q
inertness variant.

## Resolution

Resolved in `38d74e1a`; a concurrent main-session landing folded the staged
settlement implementation into that commit while also landing LLP 0157's
review amendment.
The authoring grammar now admits one declared direct `runtimeNow()` field with
a positive, grammar-bounded `maxSkewMs`; lane-L settlement uses one retained
server sample, accepts only that direct field within the bound, re-derives it
outside the bound, and leaves lane Q on the accepted replay pin. The stable
`settlement.bounded_skew` capability and a deliberately partial guide row ship
with the declaration, structural validation, receipt disposition, and runtime
policy.

Proving tests:

- `local::tests::llp0133_sketch_4_bounded_skew_is_direct_field_only_and_lane_q_inert`
- `packages/snapback-codegen/settlement-bounded-skew.test.mjs`
- `cargo test --test capability_v0` (3 passed)
- `cargo test --test artifact_schemas_v0` (30 passed)
- the complete `packages/snapback-client` suite
- `scripts/check-generated-artifacts`, `./ref-check --verbose`, and
  `node scripts/check-guide.mjs`

The full Rust library suite completed with 1,639 passing tests, one ignored,
and the three previously inherited live-query failures recorded by earlier
program tickets. One unrelated churn latency assertion also tripped under
full-suite contention and passed immediately in isolation.
