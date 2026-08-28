# Revalidate Familiar `.order()` result serving in packed packages

**Status:** Resolved
**Opened:** 2026-08-23
**Systems:** Familiar code generation, JS handler runtime, Diagnostics
**Governing:** LLP 0237; LLP 0252; LLP 0295
**Evidence:** Familiar lane in
`benchmarks/runs/2026-08-22-clique-local-main-0126-oxalpha/`; private event
stream at `~/clique-oxalpha-20260822/logs/oxalpha-clique-familiar.jsonl` on the
Durand host

## Problem

On the unpublished candidate-0.1.26 pin, a Familiar JS query handler using
`.order(...)` generated and activated, but result serving then rejected every
field with `SNAPBACK_UNKNOWN_FIELD`. Removing `.order()` and sorting the
collected rows in JavaScript restored serving.

Current source and the Guide admit `.order(field, direction)` as a JS-handler
query-builder verb and describe it as server-side ordering. The candidate
behavior therefore conflicts with an advertised surface; the top-level
declarative `order` field's Familiar disposition does not govern this builder
method.

## Impact

An author cannot identify the causative expression from the runtime errors and
may incorrectly rewrite result contracts or schema fields.

## Required change

Reproduce the exact query shape through current packed packages. If it remains
red, fix the builder/runtime/result-serving path so admitted server ordering
returns the declared documents. If it is green, close this as candidate-pin
evidence and record the fixing revision.

## Acceptance

- A packed-external Familiar fixture orders a bounded result server-side and
  serves every declared field successfully.
- The same fixture proves ascending/descending order and result-contract
  decoding, not only generation.
- No admitted variant reaches serving as downstream `SNAPBACK_UNKNOWN_FIELD`
  errors.

## Revalidation on main — 2026-08-24 (LLP 0300 program close-out)

Does **not** reproduce on main `78bcd5efc` for the ordinary JS-handler
profile: a fresh fixture (familiar-todo dual-profile shape) with
`.order("title", "asc"|"desc")` between `withIndex` and `collect` generated,
activated, hot-reloaded, and **served correctly** with the landed binary —
rows in the requested order both directions, no `SNAPBACK_UNKNOWN_FIELD`.
The 2026-08-22 candidate-pin failure predates several codegen landings
(G0 B2/B3, LLP 0302).

Remaining scope: the strictly-Familiar dialect cannot be revalidated until
the inherited `familiar-dev-loop` codegen red clears
(`resolveExport` `kind` TypeError — G0 program owns, see
issues/closed/20260823-package-test-framework-drift-red.md). Familiar is
experimental, non-default, and outside every template, so this ticket no
longer gates publication; re-run the dialect check after the G0 fix.

## Resolution

Resolved 2026-08-28 as candidate-pin evidence. The failing unpublished pin was
`261e595ad9930cd1f9604a48af54dea59cc52ffb`; the first retained green
ordinary-JS-handler revalidation was `78bcd5efcbb556972b0fdbe4d429b75c65265700`.
No single causal fix was isolated, so the honest fixing range is
`261e595ad..78bcd5efc`. The current strict-Familiar packed proof is green at
lane base `7f38254a646522d01e6c200dc0b7c48ed4f68ccc`; its previously blocking
specifier-less re-export crash was fixed by `9653d21d2`.

The standing regression lives in
`packages/snapback-cli/packed-dev-lifecycle.test.mjs`. Its strict-Familiar
external consumer installs the dynamically computed local tarball closure,
generates `records.orderedAsc` and `records.orderedDesc` as `documents` result
contracts, and executes this bounded server-side shape in both directions:

```ts
ctx.db
  .query('records')
  .withIndex('by_value')
  .order('value', 'asc' /* or 'desc' */)
  .take(3)
  .collect()
```

Three rows are inserted in middle/zulu/alpha order. The proof expects
alpha/middle/zulu ascending and zulu/middle/alpha descending, decodes every
declared and system document field (`value`, `_id`, `_version`, `_createdAt`,
and `_updatedAt`), and repeats the same assertions after the additive-schema
M2 hot reload. Thus generation, activation, result-contract serving, and
successor activation all execute; neither admitted direction reaches a
downstream `SNAPBACK_UNKNOWN_FIELD`.

Exact prerequisite command and result:

```sh
export SNAPBACK_RUNTIME_BINARY=/Users/ccheever/projects/snapback/target/debug/snapback
node packages/snapback-cli/familiar-dev-loop.test.mjs
```

Exit `0`; final output:

```text
familiar W5 runtime-cost integration receipt: 3 queued/replayed mutations, 3 live subscriptions, 3 asset hook issuances, and 513 bounded queries: ok
```

Exact packed proof command and result:

```sh
export SNAPBACK_RUNTIME_BINARY=/Users/ccheever/projects/snapback/target/debug/snapback
export SNAPBACK_R1_ARM=headless
export SNAPBACK_R1_PROFILE=familiar
node packages/snapback-cli/packed-dev-lifecycle.test.mjs
```

Exit `0`; the emitted `snapback.r1-cold-probe.v1` receipt had `ok: true`, an
eleven-package fresh tarball closure, `failures: []`, and this exact relevant
projection at both activation cuts:

```json
{
  "familiarOrder": {
    "m1": {
      "ascending": true,
      "descending": true,
      "decodedFields": ["_createdAt", "_id", "_updatedAt", "_version", "value"],
      "resultContract": "documents",
      "servedWithoutUnknownField": true,
      "serverBound": 3
    },
    "m2": {
      "ascending": true,
      "descending": true,
      "decodedFields": ["_createdAt", "_id", "_updatedAt", "_version", "value"],
      "resultContract": "documents",
      "servedWithoutUnknownField": true,
      "serverBound": 3
    }
  }
}
```
