# Diary 0036: Split Ledger current-main rerun

**Application:** integer-money shared-expense ledger on Snapback and Convex
**Rerun:** 2026-07-30
**Snapback revision:** `01e941730306973aadaf21cd50b4c1613d171075`
**Systems:** Snapback, Convex, Inline handlers, Nested result contracts,
Transactions, Ibex/Hermes runtime, Live queries, Acceptance
**Related:** Diary 0027; LLP 0003, LLP 0004, LLP 0008, LLP 0010, LLP 0108;
`/Users/ccheever/projects/snapback-workout-matrix-20260729/apps/05-split-ledger`

## Why rerun

Diary 0027 found two related Snapback problems:

- JS function declarations and implementations lived in different files with
  repeated names/source wiring; and
- both the nested ledger result and split-vector mutation argument degraded to
  `unknown`.

Current main ships inline handlers and explicit recursive result contracts. I
migrated the same four-table contract while leaving Convex unchanged.

`ledger` is now one inline live-query declaration with a closed
`results.records` contract. The contract describes the group, participant
array with derived integer net cents, expense array, split count, and net total;
the outer query is exactly one row. `addExpense` is an inline mutation returning
`Id<"expenses">` and declaring `outgrewIr: "general-iteration"`.
`handlers.mjs` was deleted.

## Commands

```sh
node /Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs \
  apps/05-split-ledger/snapback-app
node --check apps/05-split-ledger/snapback-app/functions.mjs
npx tsc -p apps/05-split-ledger/convex-app/convex/tsconfig.json

node apps/05-split-ledger/snapback-app/acceptance.mjs

/Users/ccheever/projects/snapback/scripts/ibex-doctor
/Users/ccheever/projects/snapback/scripts/bootstrap-ibex-runtime

cd apps/05-split-ledger/convex-app
CONVEX_AGENT_MODE=anonymous bunx convex dev --once \
  --start 'node acceptance.mjs' --tail-logs disable
```

Convex used isolated ports 3260/3261 and exited after the one-shot run.

## What current-main authoring fixed

### The result is genuinely typed

The previous ledger query generated an unknown row. The new `api.d.ts`
contains an exact one-element readonly tuple with:

- closed group system/application fields;
- `ReadonlyArray` participants with table-scoped IDs and `netCents`;
- `ReadonlyArray` expenses with integer cents;
- integer `splitCount`; and
- integer `netTotalCents`.

Provider introspection records `allowExtra: false`, outer
`minItems: 1 / maxItems: 1`, and maximum 1,024 participants/expenses. Runtime
egress should reject a malformed or oversized post-JSON result before live
publication. This closes the larger of Diary 0027's two type gaps.

### Implementation and transaction declaration are colocated

Arguments, read/write tables, result contract, `general-iteration` tier
rationale, validation, and buffered inserts are visible in one declaration.
There is no global handler registry and no source/export indirection.

### Output arrays and nested records are expressive

`v.array(v.object(...))` is sufficient for the deeply nested *result* shape,
including bounded cardinality. Snapback's generated output typing is now
competitive with Convex's inferred query result for this view.

## What remains painful

### Split input is still unknown

`v.array` is result-contract-only in the shipped authoring validator. Function
arguments still accept the split vector as `v.json()`. Codegen emits exactly
one warning:

```text
PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED
mutations.addExpense.arguments.splits is explicitly unknown
```

The inline handler still manually checks:

- that the root is a non-empty array;
- each element is exactly `{ participantId, shareCents }`;
- integer/safe/non-negative cents;
- participant membership and uniqueness; and
- exact sum before any write.

This is more honest than pretending `v.array` types the request, but Convex's
`v.array(v.object(...))` remains materially better at this boundary.

### The read remains imperative and N+1 shaped

The four-table balance derivation still performs one split-index query per
participant. The current relational surface does not express this aggregation.
Explicit output typing makes the boundary safer; it does not improve the query
plan.

### Colocation is not a line-count reduction

Total authored Snapback source plus acceptance rose from 379 lines / 12,587
bytes to 427 lines / 14,119 bytes. The direct handler carries validation beside
its declaration, and the result contract necessarily spells out nested system
and application fields.

Generated output rose from 1,082 lines / 36,979 bytes to 2,579 lines / 87,495
bytes across the same 18 materialized files. The exact nested contract and
identity evidence explain much of the increase. Current custody commits only
`artifacts.json`, so this is complete-cache volume rather than an 18-file
source-review diff.

External imports remain checkout-relative, and the first-backend guide still
front-loads the legacy `handlers.mjs` model even though the query/mutation
pages teach inline authoring.

## Runtime evidence: exact build, recovered bootstrap ordering

The Snapback checkout and binary stamp matched exactly at
`01e941730306973aadaf21cd50b4c1613d171075`; the prior diary's binary
provenance mismatch is fixed.

The first authoritative attempt nevertheless failed **0/5**. Every
query/mutation attempt returned:

```text
SNAPBACK_RUNTIME_CREATE_FAILED: Ibex runtime could not be created
```

That includes the seed-balance query, bad-sum atomicity test, valid atomic
expense, derived balances, and live second-client expense.

The shared read-only doctor saw the Hermes framework and only warned that the
vendored Ibex CLI was missing. The paved bootstrap exited 0, declared the
artifacts usable, and passed exact cargo link plus server-launch smoke. A
post-bootstrap sequential Streak invocation failed identically, establishing
that bootstrap's current gate does not prove actual handler VM creation.

The coordinator reproduced the native refusal and captured its underlying
cause:

```text
Armed startup refused: Hermes promise rejection checkpoint tracking is unavailable
```

Ignored native artifacts were refreshed through the paved vendored
bootstrap/download cache—not by editing or copying framework files by hand.
Exact linking initially continued to pass while handler creation failed. A
parallel matrix lane then identified the ordering defect: bootstrap had run
before the final framework refresh. Rerunning the same paved bootstrap *after*
that refresh rebuilt/relinked the exact binary against the final framework.

The sequential Split Ledger rerun then passed **5/5**:

1. exact seeded integer-cent balances and zero-sum total;
2. bad split sum rejected with no expense/split rows;
3. valid expense and three splits committed atomically;
4. derived balances matched `[Ada 2300, Grace -100, Lin -2200]`; and
5. a second native client received the complete coffee expense with all split
   rows.

Final provenance:

- checkout and binary embedded commit:
  `01e941730306973aadaf21cd50b4c1613d171075`;
- binary modified `2026-07-30T00:55:57-0700`;
- framework artifact modified `2026-07-30T00:55:00-0700`; and
- framework SHA-256
  `7c3dd1a82c329c187d57939071dbffb8fa699518559a32019f17077a4413bfb6`.

The acceptance harness printed `spawned snapback binary identity: unpinned`,
so the diary does not use that label as provenance evidence; the explicit
configured binary path, checkout hash, embedded binary commit string, and
framework digest above provide the exact evidence.

The final classification is **recovered bootstrap-ordering friction**, not a
runtime outage and not a Split Ledger validation or transaction defect. It is
still a significant developer-experience gap: link/launch smoke passed in the
bad ordering, while a real handler VM failed. Retained machine evidence is at
`apps/05-split-ledger/results/main-rerun.json`.

## Convex control

The unchanged Convex arm passed **5/5**:

1. exact seeded integer-cent balances and zero-sum total;
2. bad split sum rejected with no expense/split rows;
3. valid expense and three splits committed atomically;
4. derived balances matched `[Ada 2300, Grace -100, Lin -2200]`; and
5. a second native client received the complete coffee expense with all split
   rows.

Functions were ready in 288.54 ms on the recorded run. Convex still lacks
schema-level integer and unique-index constraints in this implementation, and
anonymous local mode remains beta, but its nested input validator and
zero-recovery runtime path are clear advantages in this rerun.

## Generation and size evidence

```text
tables 4; operations 2; live 1
files 18 (review manifest 1, consumer committed 0, ignored cache 17)
warnings 1
inputsHash 63c3ce585d3e43aee88a1c28915c55cf202d44b1e8339d71b9efb0485045e4d9
real 1.06s; user 0.66s; sys 0.09s
```

| Arm | Authored source + acceptance | Generated |
| --- | ---: | ---: |
| Snapback current main | 427 lines / 14,119 bytes | 18 files, 2,579 lines / 87,495 bytes |
| Convex unchanged | 319 lines / 11,071 bytes | 5 files, 368 lines / 12,444 bytes |

Snapback's generated set includes provider, Contract, capability, operation,
result-contract, and implementation-identity evidence beyond Convex's five
files. The comparison is footprint, not equivalent artifact purpose.

## Verdict against Diary 0027

Fixed:

- separate JS declaration/implementation files;
- unknown nested ledger result;
- lack of closed/bounded runtime result contract;
- implicit reason for choosing JS over mutation IR; and
- binary/check-out stamp mismatch.

Partially fixed:

- nested arrays are typed for result contracts, but not mutation arguments.

Still open:

- first-class structured array/object input validation and generated argument
  types;
- multi-table aggregation/grouping ergonomics;
- installable external packages and starters;
- complete-cache volume and dense review-manifest ergonomics;
- getting-started guide freshness; and
- atomic bootstrap/download ordering plus a real handler VM creation probe
  after the final framework refresh, covering armed-startup prerequisites such
  as promise-rejection checkpoint tracking rather than only load/link/launch.

Compared with Convex, current Snapback is now stronger than before at explicit
integer/result bounds, schema-level compound uniqueness, declared read/write
effects, and inspectable contract identity. Convex remains simpler and more
precise at the nested mutation-input boundary. Both arms ultimately passed all
five real-backend transaction/live checks, but Snapback required a framework
refresh followed by a correctly ordered paved bootstrap to do so.
