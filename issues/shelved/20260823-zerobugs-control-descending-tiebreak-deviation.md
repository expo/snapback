# Zerobugs control descending tie-break deviates from LLP 0007

**Status:** Open
**Owner:** Zerobugs control
**Governing:** LLP 0007 query ordering; LLP 0209 §9 Stage B oracle comparison contract
**Found:** 2026-08-23, LLP 0209 G0 Stage B3

## Problem

The remaining deviation is the control comparator's direction-multiplied id
tie-break. `compareIssueRows` and `compareCommentRows` apply the requested
direction to their final id comparison
(`demos/zerobugs/control/snapback/functions.mjs:2824`–`:2839`). LLP 0007
instead fixes the implicit physical `_id` tie-break as ascending in every
direction.

The list roots no longer carry an active corpus divergence. `issueListV2`
declares `modified DESC, sourceIssueID DESC` explicitly, and the normal frozen
case contains 69 equal-`modified` groups but zero residual equal-
`sourceIssueID` groups. `compareIssueRows` is therefore a latent control
deviation only: `sourceIssueID` is unique in the read model, so its final
direction-multiplied source-id branch does not currently decide a list row.

The live disposition is the comments child tie. `issueDetail` declares
`created DESC`; the executable continuation fixture contains one equal-
`created` group where `compareCommentRows`'s descending id branch disagrees
with the graph's implicit physical `_id ASC` order. The corpus freezes exactly
that child-scoped `direction-tie-break` disposition and no list-root
disposition.

## Ownership and resolution

This is a control-app deviation, not a G0 graph-IR defect. The Zerobugs control
owner should change the comparators, cursor construction/resume behavior, and
their D1 compatibility evidence together so descending pages remain complete
and duplicate-free while adopting LLP 0007 ordering.

Acceptance evidence after that change:

```sh
volta run --node 24.18.0 node --test demos/zerobugs/control/tests/lane3-list-engine.test.mts
volta run --node 24.18.0 node demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs --fixtures normal-seed-v1,large-seed42-v1,hot-recent-v1
cargo test -p snapback --test graph_corpus_v1
```

Once the comments control and graph order agree, regenerate the corpus, remove
the child tie disposition, record the resolution here, and move this ticket to
`issues/closed/`. The latent `compareIssueRows` deviation should either be
fixed in the same change or explicitly retained with its uniqueness proof.
