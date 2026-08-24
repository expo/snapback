# Child demand vector cannot represent zero evaluated parents

**Status:** Open  
**Owner:** graph demand identity / LLP 0209  
**Governing:** LLP 0209 §2.4 and §3.4  
**Found:** 2026-08-23, G0 Stage B3

## Problem

`validate_graph_window_vector_v1` requires every demand-paged node entry to
have a non-empty `intervals` vector before it distinguishes the root from a
child. A demand-paged child legitimately has zero evaluated parents when the
root is missing or invisible. Its exact keyed interval vector is then empty,
but the current validator returns `SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID`.

This prevented the B3 hidden-world root-miss case from using the admitted
`issueDetail` graph, whose comments node is demand-paged. B3 uses the admitted
point/list graph for that executable proof instead; it does not mint a fake
parent or interval.

## Acceptance

- Rule explicitly whether a child demand entry with zero evaluated parents has
  an empty interval vector or another closed representation.
- Keep exactly one node-keyed vector entry per demand-paged node.
- Accept the ruled zero-parent form only when `evaluated_parents[nodeId]` is
  exactly empty; keep root intervals non-empty and singleton.
- Add instance-identity rotations for zero parents versus one parent.
- Add a missing/invisible root paired-world case on a graph with a demand child.

```sh
cargo test -p snapback-types graph_instance_identity_v1
cargo test -p snapback --test graph_corpus_v1 paired_worlds
```
