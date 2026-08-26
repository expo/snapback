# Membership-scoped queries push authors to widen the read posture

**Filed:** 2026-08-26 · **Investigated:** 2026-08-26 (still needs a design owner)
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

## What the 2026-08-26 investigation found (first half of the question answered)

**The paved path exists, and it is documented on the page the familiar lane was
reading.** `guide/backend/familiar-profile.md` carries a worked example:

```js
messages: defineTable({ roomId: v.id('rooms'), body: v.string() })
  .visibility({ kind: 'membership', declaration: 'roomAccess', resourceField: 'roomId', roles: ['member'] }),
```

and, a few lines later, "do not mark tables `public-read` just so a trusted
handler can inspect them". `guide/auth/protecting-data.md` carries the full
closed set of policy kinds, the `anyOf` arm, and an explicit
"**Do not use public-read merely to silence the implicit-visibility warning**".

So this is **not** a missing capability. That narrows the ticket, and it makes
the second half of the question the real one.

**Why the lane never reached it.** The lane's steering was the expo-chat start
packet. `guide/start/expo-chat.md` — and `guide/start/react.md` — contain **zero
occurrences of "visibility"**. The packet lists `snapback/schema.mjs` as an edit
target and names "membership" once, inside a file description. Read posture is
not in the packet's Posture section and not in its Safety traps.

An agent working from the packet therefore meets read posture for the first time
as a *failure* — a query that returns nothing — and `public-read` is the first
edit that makes the failure go away. Escalating to `familiar-profile.md` or
`protecting-data.md` requires already suspecting that a visibility policy is
what is in the way. That is the pit-of-success gap: the correct move was
discoverable, but only after the wrong one had already worked.

**The constraint on the obvious fix.** "Put it in the packet" is not free.
`guide/start/expo-chat.md`'s steering aggregate now sits at exactly
**16384/16384** bytes against LLP 0259's hard ceiling
(`scripts/check-first-read.mjs`), so a visibility trap has to trade bytes out of
something already there. That is an editorial decision for the packet's owner,
which is part of why this ticket still needs one.

## What still needs a design owner

1. Whether the packet trades bytes for a read-posture trap, and what it drops.
2. Whether the reachability failure itself should say what it is — a query
   returning nothing because of a visibility policy is currently silent, and a
   diagnostic that named the policy would put the paved path in front of the
   agent at exactly the moment it is looking.
3. Whether membership visibility's setup cost (a `.membership(...)` declaration
   plus `ctx.membership.<declaration>.bootstrap(...)`) is itself the thing that
   makes `public-read` win inside a clock, independent of discoverability.

Items 2 and 3 are product questions this investigation deliberately did not
answer.
