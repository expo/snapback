# Zerobugs control descending tie-break deviates from LLP 0007

**Status:** Open  
**Owner:** Zerobugs control  
**Governing:** LLP 0007 query ordering; LLP 0209 §9 Stage B oracle comparison contract  
**Found:** 2026-08-23, LLP 0209 G0 Stage B3

## Problem

The frozen Zerobugs control's `compareIssueRows` applies the requested sort
direction to both the declared issue sort field and its source-id tie-break.
LLP 0007 instead fixes the physical `_id` tie-break as ascending in every
direction. The graph kernel therefore appends physical `_id ASC` even for a
backward demand, while the control's source-id tie-break follows its computed
query direction. It is descending on descending query-direction arms; even on
an ascending arm it is the wrong identity domain (`sourceIssueID`, not
physical `issue._id`).

Evidence is
`demos/zerobugs/control/snapback/functions.mjs:2824`–`:2833`: the comparator
computes one direction multiplier and applies it to the source-id comparison.
The B3 corpus case `issueListV2-backward-tied-modified` resolves each source id
through `issueListRead.issueID`, freezes
`oracleDivergence: "direction-tie-break"`, exact-compares the row set, and
normalizes only tied groups to ascending physical issue `_id`.

## Ownership and resolution

This is a control-app deviation, not a G0 graph-IR defect. G0 must preserve the
oracle and carry only the one closed normalization disposition. The Zerobugs
control owner should decide whether to change `compareIssueRows`, cursor
construction/resume tests, and any D1 compatibility expectations together so
descending pages keep complete, duplicate-free traversal while adopting the
LLP 0007 tie-break.

Acceptance evidence after that change:

```sh
volta run --node 24.18.0 node --test demos/zerobugs/control/tests/lane3-list-engine.test.mts
volta run --node 24.18.0 node demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs --fixtures normal-seed-v1,large-seed42-v1,hot-recent-v1
cargo test -p snapback --test graph_corpus_v1
```

Once the control and graph order agree, regenerate the corpus, remove only the
now-obsolete `oracleDivergence` disposition, record the resolution here, and
move this ticket to `issues/closed/`.
