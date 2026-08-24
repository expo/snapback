# Child demand vector cannot represent zero evaluated parents

**Status:** Resolved 2026-08-24
**Owner:** graph demand identity / LLP 0209 B1
**Governing:** LLP 0209 §2.4 and §3.4
**Found:** 2026-08-23, G0 Stage B3

## Original evidence (2026-08-23)

The B3 corpus now contains the real hidden-root detail pair
`g0-pair-detail-hidden-root-empty-child-demand`. Both worlds evaluate zero
root rows for the ordinary principal: one contains an invisible internal issue
and the other omits it. Its comments demand entry therefore has
`intervals: []`; no parent interval is minted, and the parent key would be the
physical `issue._id` if a parent were evaluated.

The remaining blocker is in B1's
`validate_graph_window_vector_v1`. It rejects every empty `intervals` vector
before distinguishing root entries from child entries, returning
`SNAPBACK_GRAPH_WINDOW_VECTOR_INVALID`. The Rust corpus runner records that
exact refusal as the pair's `windowVectorDisposition`; B3 does not change B1
types or invent a parent.

## Acceptance criterion

- Keep exactly one node-keyed vector entry per demand-paged node.
- Keep a root entry non-empty and singleton with `parentKey: null`.
- Accept a child entry with `intervals: []` if and only if
  `evaluated_parents[nodeId]` exists and is exactly empty.
- Continue to require one canonical interval keyed by the physical parent row
  key for every evaluated parent; reject missing, extra, duplicate, source-id,
  or non-canonical parent keys.
- Add instance-identity rotation evidence for zero parents versus one physical
  parent.
- Change the corpus pair's disposition from `BLOCKED` to `VALIDATED`; the same
  hidden/missing-root detail pair and its empty child vector must then pass
  ordinary Rust identity reconstruction.

```sh
cargo test -p snapback-types graph_instance_identity_v1
cargo test -p snapback --test graph_corpus_v1 paired_worlds
```

## Resolution

G2-A changed `validate_graph_window_vector_v1` to accept the still-present
demand-node entry with `intervals: []` exactly when the evaluated physical
parent set is empty. The root entry remains singleton/non-empty, and the
ordinary canonical physical-parent equality checks remain in force. The
corpus pair is now `VALIDATED` and executes through the evaluator in both
worlds.
