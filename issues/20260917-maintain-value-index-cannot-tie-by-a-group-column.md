# A maintain value index cannot break ties by a group column, so a ranking cannot be newest-first

Status: open
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
