# A maintain value index cannot break ties by a group column, so a ranking cannot be newest-first

Status: open — ruled 2026-09-18 (ruling 41): option 1, as an interim; lane W15c
Priority: P2 (an acceptance criterion a published example cannot meet; the builder's
documented workaround is a handwritten score, which is the shape three prior
calibrations shipped with `update <- allow`)
Date: 2026-09-17
Systems: `snapback4-lang` maintain index validation; the feeds card's maintained
Trending example; LLP 3000.007 §20.20–§20.21

## The limit, verified

A maintain value index accepts **group fields, then `value`, then `id`** and nothing
else. Probed on this build:

    maintain trend: count likes by hour(.postAt), postAt, postId
      by byScore: hour, value, postAt, postId
    -> E_QUARRY_MAINTAIN: a maintain value index is group fields followed by value, id
       rewrite: by byCount: value, id

`postAt` is a group field, so `by byScore: hour, postAt, value, id` is legal — but it
orders by time *before* score, which is not a ranking. To rank, `value` must precede
the tie column, and only `id` may follow `value`. **Ties therefore break by the
maintained row's id, always.** The card states this outcome plainly ("Ties break by
descending maintained id, not post time") without stating that no index can change it.

## Why it costs

The 0.2.28 calibration's brief requires **newest-first** ties. The builder consulted
the feeds card before implementing (run log: `knowledge lookup source=package
README/guide`), adopted the card's 25 hour lanes — and then kept a **handwritten
`posts.score`** with `by byTrending: hourKey, score, at, id`, which ties by post time.
The friction review attributes the retention to the tie-order difference as a
plausible integration concern and asks for the maintained example to be "qualified
against the brief's exact tie order".

**It cannot be, as the language stands.** That is the finding: this is not
example-fit. A maintained ranking can be fresh, indexed, bounded and unwritable by
principals, and still fail an ordinary product requirement — "equal scores, newest
first" — with no expressible remedy.

## Options, none chosen

1. Allow a group field after `value` in a maintain value index (`hour, value, postAt,
   postId`). Smallest for the author; needs the index-maintenance and sweep cost
   assessed, and a decision on whether it generalises beyond one trailing column.
2. Make the maintained row's id order by the group's time column where one exists, so
   descending id *is* newest-first. Narrower, and relies on an ordering the cards
   currently describe as opaque.
3. State the limit honestly in the card and stop recommending the maintained form for
   rankings whose acceptance criteria include a tie order. Cheapest, and leaves the
   handwritten score — with its `update <- allow` exposure — as the paved answer for a
   very ordinary requirement.

Option 3 is what ships today by default. It is the one that keeps costing points.

## Not doing here

No change is proposed in this ticket. LLP 3000.007 §20.22 ("total reads") is wave
13's and this must not pre-empt it; the maintained-columns design (LLP 3000.007.001)
is separately under review. Filed so the next wave scopes from a verified limit
rather than from "qualify the example".

## Disposition (the derived-data lead, 2026-09-17; LLP 3000.007 §21.8 L19)

Taken into the derived-data program (LLP 3000.007 §21). **Recommendation: option 1**, stated
as one rule — *a maintain value index is a prefix of group fields, then `value`, then any
remaining group fields, then `id`.* Every group field is fixed for the life of a maintain row
(one row per group), so trailing group fields add key bytes and no index rewrite that a
change of `value` does not already cause; the sweep and the rebuild are unaffected. It is a
change to the language surface and to code a merge cursor depends on, so it is a lane with a
two-family blind review (W15c, after W15a and W15b), and the author may prefer to wait for the
form that needs no maintain table at all: with ruling 29 (built, W13c) and ruling 30
(LLP 3000.007.001, READY, not built) the ranking is an ordinary index on the parent —
`by byHourLikes: hour(.at), likeCount, at, id` — whose ties are whatever the author writes.
Option 2 is declined (it makes an id order meaningful that the cards call opaque); option 3
is what ships until one of the other two does.

## Ruling (the author, 2026-09-18; LLP 3000.007 §14 ruling 39)

**Not option 1.** The value index is not widened. The author ruled for
**LLP 3000.007.001 (maintained columns), now Accepted and to be built** — the
fourth path this ticket's disposition named. As a column of the row it
describes, `likeCount: count likes by postId` makes the ranking an ordinary
index on the parent, `by byLikes: likeCount, at, id`, whose ties are whatever
the author writes. "Equal scores, newest first" becomes expressible without any
new index rule.

So this limit is **retired with the form, not relaxed within it**. Option 1
would have restated the index rule as a longer rule; the accepted design deletes
a concept and §20.20's caveats with it. Option 2 stays declined. Option 3 is
what has shipped, and is what three consecutive builders answered by hand-keeping
a `posts.score` with `update <- allow`.

This ticket stays **open** until the maintained-columns first build lands, since
until then option 3 is still what ships and the handwritten score is still the
paved answer. It closes when a maintained ranking can tie newest-first, not when
the design is accepted.

Prerequisites, unchanged by acceptance: gate 5 is the lane's milestone zero, and
`issues/20260917-snapback4-oversized-sync-page-hides-generation.md` is a
prerequisite of the first build (§3.11) and is still open. Gates 1 and 2 are
measured and pass.

## Ruling 41 (the author, 2026-09-18; LLP 3000.007 §14) — overturns the ruling above on this one point

**Option 1, as an interim.** Walked through with the derived-data lead, with ruling 39's
reasoning in view (the lead recommended keeping it), the author chose to relax the index
rule now — *a prefix of group fields, then `value`, then any remaining group fields, then
`id`* — so the lanes recipe can tie newest-first before maintained columns ship. Lane
**W15c**, two-family blind review before landing. Ruling 39's acceptance of the
maintained-columns design stands.
