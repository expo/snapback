# Snapback 4: a merge's `next` survives when a non-uniform read runs later in the same query

Status: Open
Priority: P3 (an invariant LLP 3000.007 §20.3 states is enforced only in one statement order; no cross-world leak demonstrated)
Date: 2026-09-17
Systems: `merge_can_continue`, `record_page`, `Runner::next_cursor`, `Engine::query` outcome
Observed version: published `snapback4@0.2.27`
Evidence status: found independently by both blind reviewers of the ruling-26 design, then reproduced by execution

## Problem

§20.3 (review round 1, lane W2R1m): "The non-uniform class withholds `next` even
within budget, so hidden rows cannot change cursor presence by exhausting the
meter." `merge_can_continue()` (`engine/read.rs:796–802`) reads `self.non_uniform`
at the moment the merge records its page. If the non-uniform read runs *after*
the merge, the page was already recorded with `next`, and neither
`next_cursor()` (`read.rs:687–695`) nor the outcome (`engine/mod.rs:715–725`)
re-checks the class.

## Reproduction (`benchmarks/runs/2026-09-17-snapback4-bounds-probes/merge-next-after-non-uniform`)

The same two reads in both orders, in two stores differing only in 9,000 notes
hidden from the viewer:

```
                        0 hidden                          9,000 hidden
mergeAlone              complete=true  next=PRESENT        complete=true  next=PRESENT
mergeThenNonUniform     complete=false cut=null next=PRESENT   complete=false cut=null next=PRESENT
nonUniformThenMerge     complete=false cut=null next=absent    complete=false cut=null next=absent
```

Within each order `next` is identical across the two worlds, so this pair shows
no leak. It shows the rule is order-dependent, which no card says and no test
pins.

## Fix

Decide a merge page's continuation eligibility when the outcome is built, not
when the page is recorded: for the non-uniform class on the server, a merge's
`next` is withheld whatever ran first. Keep the *direct filtered page* contract
(§5.6: a non-uniform direct page does carry `next` after its last rule-visible
row). Regression: both statement orders, paired worlds, server and both device
stores (a device does not set `non_uniform` for synced tables).
