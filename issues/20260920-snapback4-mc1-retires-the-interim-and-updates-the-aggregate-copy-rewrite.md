# Snapback 4: when maintained columns (MC1) land, retire W15c's interim and point the aggregate-copy note at the column form

Status: Open — for the MC1 landing (the wave 12 lead's lane; LLP 3000.007 §14 ruling 41's addendum)
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
