# Snapback 4: when maintained columns (MC1) land, retire W15c's interim and point the aggregate-copy note at the column form

Status: Resolved — F1b maintained-column adoption and surface, 2026-09-23 (supervisor owns review and commit)
Priority: P3 (a coordination note, not a defect; nothing is wrong until MC1 lands without it)
Date: 2026-09-20
Systems: `snapback4-lang` `bind/schema.rs` (the maintain value-index rule), `bind/aggregate_copies.rs` (the note's rewrite), the feeds and maintains cards
Evidence status: the two landings below and the ruling

## What MC1's landing carries besides the column

1. **Retire the interim value-index rule** (lane W15c, `5df0d211a1`; ruling 41's addendum): the
   refusal returns — a maintain value index ends `value, id` again — pointing at the column form
   (`likeCount: count likes by postId` and an ordinary parent index `by byLikes: likeCount, at, id`).
   The maintains card's clause "until maintained columns ship" and the feeds card's Trending block
   (`by byScore: hour, value, postAt, postId`) change with it.
2. **The aggregate-copy note's rewrite** (lane W15b, `cef745dede`) names two forms today — keep the
   count in a maintain and read it, or pin the column with §21.1 item 3's rule — because the design
   was unbuilt; with the column form real, the rewrite leads with it: *declare `likeCount: count
   likes by postId` on the row*, then the pinning rule for what a column cannot express.
3. The wave 12 lead's own list from the MC1 brief.

## Not doing here

Nothing; filed so the MC1 landing does not have to rediscover either.

## Resolution — 2026-09-23

F1b restores the maintain value-index suffix `value, id`; its refusal points to
`likeCount: count likes by postId` and the ordinary parent index
`by byLikes: likeCount, at, id`. The aggregate-copy rewrite leads with that
column form, followed by pinning both write rules for derivations it cannot
express. The maintains card removes the interim exception. Trending now merges
25 hour lanes of `by byHourLikes: hour(at), likeCount, at, id`, including zeros
and breaking ties by post time. Activation, engine/device oracle, retirement
refusal and compilable-card tests accompany the change.

Real mechanism gate 5 passes with 100,000 parents, 1,000,000 sources and two
HTTP devices: both adopt, including the device behind a 16,744,164-byte page;
no device response exceeds the ceiling. Evidence, affected checks and wasm
measurement are in [the F1b report](../../snapback4/reports/20260922-f1b-columns.md).
