# Relational query projections degrade generated result types to unknown

**Date:** 2026-08-03  
**Status:** Open  
**Area:** `@expo/snapback-codegen`

## Problem

`defineRelationalQuery` has a closed, fully declarative projection, but codegen
emits `PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED` and types the result row as
`unknown`. The diagnostic recommends adding a `result` contract, while the
closed relational authoring spec rejects `result` as an unknown field.

The fresh `demos/triage-graph` retained inbox projects seven scalar fields from
two known tables and still requires casts in its React surface. This weakens a
major advantage of generated composites and makes the diagnostic impossible to
resolve at the app layer.

## Proposed resolution

Derive the result contract from the admitted relational projection (including
left-join nullability and literal validators), or admit a checked `result`
field whose contract is proven equal to that projection. Update the diagnostic
so its suggested repair is legal for the function profile.

## Evidence

Run `node demos/_kit/codegen.mjs demos/triage-graph/snapback`; the warning names
`queries.retainedInbox.result.row`. This lane does not change
`packages/snapback-codegen/index.mjs` because P3's boundary makes a core change
a follow-up.
