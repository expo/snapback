# Membership-scoped queries push authors to widen the read posture

**Filed:** 2026-08-26
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-familiar`
**Systems:** Schema, Auth, Live queries, Guide, Agent experience
**Owner:** unassigned — needs a design owner
**Related:** LLP 0310 F8 / P18, LLP 0234, LLP 0274

## Problem

To make its conversation queries reachable, the familiar lane set
`conversations`, `members`, and `messages` to `public-read` — and said so in its
own diary, calling it "not a production ACL." It shipped a posture it knew was
wrong because the correct one was harder to reach inside the clock.

A capable agent knowingly choosing a posture it can name as wrong is a strong
signal, and a different signal from an agent simply not knowing better. The
narrow read is that the lane cut a corner. The useful read is that
membership-scoped reachability has no obvious paved path.

Filed under the pit-of-success standard recorded in LLP 0310 (2026-08-26).
LLP 0310 r6 moved this row off "out of bar", where earlier revisions had left
it dismissed as lane honesty rather than product feedback.

## Evidence

- `benchmarks/runs/2026-08-25-clique-grok-0127/cells/grok-clique-familiar/`
  (diary, final-report)
- LLP 0310 F8, inventory row P18

## Question this ticket needs answered

What is the paved way to make a membership-scoped query reachable — the reader
is a member of the conversation, and only members should read it — without
widening the table's read posture? If that path exists today, why did neither
the start packet nor the served guide put it in front of an agent that went
looking? If it does not exist, that is a gap in the authoring surface, and
this ticket is the design entry point.

Not scoped to LLP 0310.000's repair bar; it needs its own owner.
