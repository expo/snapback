# rewrite-identity--why--NOT_FOUND

2026-10-07. Diagnosis: **harness defect, fixed**.

The saved original pilot case updates an absent item. Both programs correctly
refuse with NOT_FOUND. Inlining two identity calls inserts three IR bindings:
the same WriteTarget is at `run:2` in the original and `run:5` in the rewrite.
The `why` channel did not look up a renamed variable. The only refusal difference
is this statement address; step cost also changes, as expected.

`sites.rs` compares the ordered write/assertion roles, including table and refusal
code, and relates their locations only if that complete sequence agrees. All
other refusal fields and unrecognized sites remain exact comparisons. Both raw
records are retained here. `replay` now passes. Shipped code is unchanged.
