# Revalidate Familiar `.order()` result serving in packed packages

**Status:** Open
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
