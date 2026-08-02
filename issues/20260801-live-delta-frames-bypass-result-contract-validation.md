# Live delta frames publish storage rows without result-contract validation

**Status:** Open
**Found:** 2026-08-01, LLP 0147 round-1 super-refine (Codex family BLOCKING-2,
independently found by the author pre-verification pass; author-verified)
**Systems:** Live queries, result contracts, local runtime, wire protocol
**Related:** LLP 0108, LLP 0090, LLP 0095, LLP 0147 (D3)

## Defect

`try_live_delta_fanout` publishes application rows to subscribers without
passing them through the result-contract egress seam.

The full re-run path validates. `execute_query_invocation` calls
`validate_handler_result` over the complete row array before the publication
effect guard:

```rust
crate::result_contract::validate_handler_result(
    function,
    &Value::Array(invocation.output.rows.clone()),
)?;
let _publication = prepared.effect_guard("query result handoff")?;
```

— `src/local.rs:23055-23060`

The delta path does not. It computes operations from committed `ChangedRow`
values, copies the raw rows straight into wire operations, and serializes the
frame:

```rust
let wire_ops: Vec<LiveDeltaWireOp> = ops
    .iter()
    .map(|op| LiveDeltaWireOp {
        op: /* Add | Update | Remove */,
        id: op.id.clone(),
        row: op.row.clone(),
    })
    .collect();
```

— `src/local.rs:19551-19562`, serialized at `:19594`

There is no `validate_handler_result` call anywhere in
`try_live_delta_fanout` (`src/local.rs:19497-19684`).

## Why it matters

**This is a spec violation, not only a missing check.** LLP 0108 is normative
and says:

> "Query and live-query output is validated before snapshot/live publication,
> cache insertion, or transport serialization."

— `llp/0108-inline-handlers-and-result-contracts.spec.md:440-443`

A delta frame is live-query output undergoing transport serialization.

**It is reachable with a contract narrower than the table schema.** An authored
result contract takes precedence over the HostPlan query's default document
contract — `effectiveResultContract` returns the authored contract before it
ever consults `runtime?.HostPlan?.Query?.table`:

```js
const authored = authoredContract(def?.resultContract, tables);
if (authored) return validateEffectiveResultContract(authored);
```

— `packages/snapback-codegen/result-contracts.mjs:594-596`

So a live query declaring a narrow `records` contract gets a validated initial
snapshot, and then an otherwise schema-valid row change delivers, via the delta
lane, a row that violates the declared contract — including fields the declared
result shape excludes. Failure shape: the client publishes a value outside its
declared type, and a field the contract was written to withhold reaches the
subscriber.

The delta lane is entered only for plan-based queries with no membership
filters and no standard pattern (`src/local.rs:19195-19205`), which bounds the
blast radius but does not remove it.

## Why LLP 0147 cares

LLP 0147's D3 decides that the Micro client ships **no** generic
application-payload validator, on the premise that every client-bound payload
crosses an authoritative server-validation boundary. That premise is currently
false on this path. Until it is closed, either the seam is fixed or Micro's
live lane cannot claim the server-trust property.

## Candidate fixes

1. **Validate the effective post-delta result.** Most faithful to LLP 0108's
   words; costs reconstructing the result set on the delta lane, which is
   exactly the O(changed rows) economy LLP 0090 D1 bought.
2. **Per-operation validation against the element contract.** Validate each
   added/updated `row` against the contract's element shape rather than the
   whole array. Cheap and O(changed rows); needs a proof that element-wise
   validity plus a valid predecessor implies whole-result validity for the
   contract kinds the delta lane admits (`documents`, `records`).
3. **Refuse the delta lane for narrowed contracts.** Fall back to a validated
   replacement whenever the effective result contract is not the table's
   default document contract. Cheapest and safest; costs delta economy exactly
   where an author narrowed the contract.

Fix 2 is the likely answer if the implication holds; fix 3 is the honest
interim.

## Acceptance

A live query over table T declaring a `records` contract narrower than T's
schema, with a valid initial snapshot, then a commit adding a row that is
schema-valid but contract-invalid: no delta frame carrying that row may be
published. Today one is.

Add the symmetric positive case so a fix cannot pass by suppressing publication:
a contract-valid change must still reach the subscriber promptly — as a
validated delta, or as a validated replacement if fix 3 is chosen. Stating it
this way keeps all three candidate fixes admissible; requiring a *delta*
specifically would foreclose fix 3.
