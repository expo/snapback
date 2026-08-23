# Qualify scaffolded `single_table_v1` queries in public packages

**Status:** Open
**Opened:** 2026-08-23
**Systems:** Templates, Runtime packaging, Capability admission
**Governing:** LLP 0157; LLP 0166; LLP 0295
**Evidence:** `benchmarks/runs/2026-08-22-clique-local-main-0126-oxalpha/`;
private lane evidence at `~/clique-oxalpha-20260822/` on the Durand host

## Problem

Both benchmark profiles scaffolded feed-style public live queries that lowered
to `single_table_v1`, but the unpublished candidate-0.1.26 runtime refused
them at first boot:

```text
SNAPBACK_CAPABILITY_UNSUPPORTED single_table_v1
```

The candidate runtime tarball lacked
`bin/packaged-store-qualification.receipt.json`, so the package did not
advertise the capability that the templates selected. Both lanes worked around
the mismatch by making every query authenticated and membership-scoped.

Current `main` still makes qualified package admission depend on this receipt,
while templates still select `single_table_v1`; the candidate observation must
therefore be revalidated through the current publication-shaped path.

## Impact

If current package assembly can still omit the receipt, a fresh scaffold burns
its first correction loop replacing otherwise valid template queries.

## Required change

Either ensure every qualified public runtime package carries a valid packaged-
store qualification receipt, or keep generated templates within the capability
set that the package actually advertises.

## Acceptance

- Build the current publication-shaped closure and install it from packed
  artifacts into a fresh Explicit and Familiar scaffold.
- Confirm the receipt is present and the scaffolded `single_table_v1` queries
  bind and serve, or confirm templates select another admitted class.
- Preserve a package-level regression receipt for the exact closure.
