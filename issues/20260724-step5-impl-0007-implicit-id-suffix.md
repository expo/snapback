# 0007: framework-generated implicit trailing _id index component (scan-order-only)

**Status:** Done (2026-07-24)
**Severity:** P2
**Systems:** Storage, Query planning, Codegen
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** LLP 0007 §Index Contract (amended), Accepted LLP 0080 §1, Accepted LLP 0065 §3
**Marker:** step5-impl

Implement the landed 0007 amendment: every declared index carries an implicit
trailing ascending `_id` component under binary collation, scan-order only —
uniqueness constraints, complete-ordered-key semantics, and output-key tuples
stay over declared fields. Needed by 0065 list ordering and 0080 root access;
shared early dependency of both lanes. Witness: large duplicate-order-key
fixture proving total ordering across evaluators while a unique index over the
same declared fields still refuses duplicates. M-sized.

**Resolution (2026-07-24):** the storage core already implemented the
amendment's exact split — `create_index` appends `_id` to every non-unique
declared index and excludes it from unique ones, and the semantic `_id`
tie-break is already total across the SQLite builder, pure matcher, buffered
overlay, and Cloudflare paths (existing regression tests). Landed the missing
pieces: the named duplicate-order-key witness
(`implicit_index_id_suffix_is_scan_order_only` in src/storage.rs — physical
index shapes via PRAGMA, 64-row shuffled duplicate-key scan order, unique
refusal despite a fresh `_id`) and updated `@ref` annotations citing the
amended LLP 0007 Index Contract and LLP 0080 §1. No behavior change was
required.
