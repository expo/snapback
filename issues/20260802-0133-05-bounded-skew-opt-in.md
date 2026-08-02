# 0133-05: The bounded-skew opt-in — declaration, structural admission, settlement semantics, capability fact

**Status:** Open
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
