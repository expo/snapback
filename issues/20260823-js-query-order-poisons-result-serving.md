# Refuse unsupported Familiar `.order()` before activation output

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

Current Familiar disposition policy says `.order()` is unsupported and should
refuse with a route to Explicit. The candidate behavior therefore missed the
intended pre-output refusal and surfaced a misleading downstream diagnostic.

## Impact

An author cannot identify the causative expression from the runtime errors and
may incorrectly rewrite result contracts or schema fields.

## Required change

Reject unsupported `.order()` during Familiar generation, before activation
artifacts are emitted, and name both the expression and the supported rewrite
or Explicit-profile route.

## Acceptance

- A packed-external Familiar fixture containing `.order()` refuses before
  activation output.
- The diagnostic names `.order()` and routes to JS-side sorting or Explicit.
- No variant reaches serving as downstream `SNAPBACK_UNKNOWN_FIELD` errors.
