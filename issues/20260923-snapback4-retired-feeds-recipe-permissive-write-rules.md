# Snapback 4: the retired feeds recipe's projection tables trust principals with engine-shaped writes

**Status:** Open
**Date:** 2026-09-23
**Owner:** the Snapback 4 0.3 program lead
**Scope:** existing applications with an installed feeds recipe (`init --recipe feeds`, retired in 0.3 by lane M7). Declared timelines (`maintain <name>: timeline`) are not affected: their expansion strips every non-read rule and makes these tables engine-owned (LLP 3000.007.003 §3.3).
**Source:** Grok 4.7 xhigh review of lane M7, packet 4. Not independently reproduced yet.

## What the review found in `crates/snapback4-lang/src/recipe/following.q`

- **`authors`: `update <- allow`, and `principal` is not immutable.** Any
  principal could rewrite another author's row, flipping `shared` without a
  promotion. That could break later follows, or switch an author to
  broadcast-only delivery early.
- **`pulls`: `insert <- allow`.** Any principal could insert a route for any
  reader. That could fill another reader's 32 slots, desynchronize
  `pullCounts` from `pullTotals`, or probe a reader-private route through a
  unique-constraint collision.
- **`broadcast`: `insert <- .actorId = viewer`, without pinning `readerId`.**
  A caller could insert its own event under another author's broadcast key.

## Why it matters now

`init` no longer installs the recipe, and new applications should use the
declaration. Applications installed before 0.3, including every Clique
calibration app built with the recipe, keep these rules.

## To do

- Reproduce each case against a recipe installation on 0.2.33.
- If real, decide whether a 0.3.x patch tightens the recipe program for
  existing installations: owner-pinned rules, and immutable `principal`.
  The declaration's expansion ignores these write rules, so tightening
  cannot change declared timelines.
- Say what existing installations should do. The migration path to the
  declaration needs empty event and edge tables (a fresh store).
