# Snapback 4: the retired feeds recipe's projection tables trust principals with engine-shaped writes

**Status:** Open — latent, not reachable (see Analysis); documentation fix, P3
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

## Analysis — 2026-09-23 (supervisor, by reading `recipe/following.q` at `3baebbcd3`)

**Verdict: all three claims are latent, not reachable.** The rules are
permissive. But Snapback 4 clients write only through declared mutations, and
the only mutations that write these tables are the recipe's own:
`register`, `follow`, `unfollow`, `createPost`, `repost`, `deletePost`,
`unrepost`, and the `purgeRemoved` job. Each pins the fields that the rules
leave open:

1. **`authors`**: `update <- allow`, and `principal` is mutable. The only
   update is `addFollow`'s promotion, `update authors[authorId] { shared:
   true }`. It runs only after `count(follows[authorId] first 51) > 50`, so
   only when the author really has more than 50 followers. No mutation
   writes `principal`, or sets `shared` any other way.
2. **`pulls`**: `insert <- allow`. `tryPull(readerId, authorId)` inserts:
   - the caller's own route (`readerId = viewer`, on follow);
   - during a genuine first promotion only, the author's own route and each
     existing follower's route.

   The recipe deliberately never probes another reader's route. Its
   comment: "Foreign inserts happen only on an author's first promotion: no
   route for that author exists yet".

   Slot exhaustion by promotion is the recipe's documented 32-pull cap, and
   the caller then gets `FEED_PROMOTION_PULL_CAP`. It is not a rule bypass.
   Sybil followers could promote many authors that a victim follows; that is
   the cap's known cost, and the declaration shares it.
3. **`broadcast`**: `insert <- .actorId = viewer`, with `readerId`
   unpinned. The only shared-path insert is `deliver`'s
   `copy(p, viewer, true)`, where `p.actorId = viewer`. So every broadcast
   row has `readerId = actorId = viewer`.

The same holds for `feed`'s `insert <- .actorId = viewer or .readerId =
viewer`. Delivery copies only to the poster's actual followers, and backfill
copies only into the caller's own inbox.

**The residual risk** is an application that adds its own mutations writing
`authors`, `pulls`, `broadcast` or `feed`. The rules would not stop such a
bug, because the recipe had to let callers write other principals' rows.
That is the structural reason F3 moved these tables to engine ownership.

**Disposition:** priority lowered to P3, documentation. Add one sentence to
the feeds card's "Existing apps with an installed recipe" section: the
recipe's projection tables rely on its own mutations, so do not add
mutations that write `authors`, `pulls`, `broadcast` or `feed`. A
`snapback4 check` note for application mutations that write those tables
would enforce it, and is optional.

A reproduction lane (an OpenAI model) was blocked by its provider's security
filter before running anything. This analysis is by reading, over the
recipe's closed set of mutations, so no reproduction is needed for the
"latent" verdict.
