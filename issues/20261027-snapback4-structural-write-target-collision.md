# Structural source walk: unresolved row target can collide with a table name

Status: Open
Owner: SEC11
Date: 2026-10-27
Related: LLP 3000.036.004.000, LLP 3000.036.004.001

The SECP retaining controls found an inherited source-analysis shape: a local
conditional row selection named like another table (`docs = r if flag else
other; update docs {role:'admin'}`) is correctly bound to the selected row at
runtime, but `authority_walk::normalize_target` can leave its lexical target
unchanged. The filtered structural writer interface then sees a catalog name
and can misclassify the write's resource. No false gate is demonstrated here;
finite replay still owns gate admission.

SECP's separate `advice_writes` stream labels still-keyless updates/upserts as
unresolved, so advisory freshness cannot lose that effect, including inside
helpers. Its direct/helper collision controls are in `security_secp.rs`.
The same regression exposed a missing-column index panic in
`derived/workflow::stage_copy`; SECP replaced that index with a guarded lookup
that returns no copy proof. Structural `writes`/`column_writes` behavior was
otherwise preserved for SEC11 ownership.

Follow up by making structural target resolution explicit rather than inferring
success from catalog membership, and add suitable inference/replay controls.
