# Snapback 4: a device pages past its horizon from scattered old rows and calls the page complete — a timeline silently skips posts

Status: Open
Priority: P1 (a wrong answer marked `complete: true, fresh: true`, on the published product, in the most ordinary app shape: a horizoned public table whose old rows are ever updated)
Date: 2026-09-17
Systems: `snapback4-core` `partition.rs` (the change stream applies no horizon), `engine/read.rs` (the device's horizon coverage rule in the scan loop); `snapback4-device` `device.rs` (`apply` stores every `put`); the sync card and `NOT-DOING.md` ("A local read past the horizon says `complete: false`")
Observed version: published `snapback4@0.2.27` binary **and** published `snapback4@0.2.27` client (wasm device in Node); the two code sites read unchanged on main at `28534f6f5c`
Evidence status: reproduced by execution; found while measuring LLP 3000.007.001 §7's gate 2 (rows a device gains beyond its horizon)

## Problem

`sync [audience] last N by index` bounds what a device **acquires**: a snapshot delivers the
newest N rows of each group. After that the device follows the change stream, and the stream
applies no horizon — every `put` in the device's partitions is sent, and
`Device::apply` stores every `put` it is sent. So an update to a row **older than the
device's acquired window** lands on the device as a lone old row.

The device decides whether a page over a horizoned table is complete with this rule
(`engine/read.rs`, after the scan loop): the read is on the horizon's own index,
descending, and the page still `has_more` rows held below it. That rule assumes the rows a
device holds on the horizon index are a **contiguous newest suffix** of the server's. A
scattered old row breaks the assumption: a page that runs off the end of the acquired
window continues into the scattered rows, finds "more", and is reported complete. The
rows the device never held, between its window and the scattered row, are skipped without
a word. The published contract says the opposite (sync card: "older rows are online-only,
and a local read past them is `complete: false`"; `NOT-DOING.md`, *Exact horizon
maintenance*: "A local read past the horizon says `complete: false`").

Any update to an old row of a horizoned table does it: the hand-kept `posts.score` three
consecutive Clique builders wrote (one parent `put` per like), an edit, a moderation flag,
a repost count. On the Clique scale fixture's recorded like stream a device that acquired
`last 2000 by byTime` at the 50% checkpoint is sent **1,165 distinct posts beyond its
horizon** in the remaining 7.7 hours of the replay (58% of what it held) — each one a
place where a page can skip.

## Reproduction (`benchmarks/runs/2026-09-17-snapback4-derived-probes/horizon-gap`)

`posts` with `sync public last 5 by byTime`, twelve posts `p01`…`p12`; `timeline(c)` is
`posts after c last 3 by byTime`. Bob's device (the published wasm device, in Node)
acquires `p08`…`p12`. **Control**, before any like: the three pages are `p12 p11 p10`,
`p09 p08 p07`, `p06 p05 p04` — the page that crosses the horizon is handed to the server,
as designed. Then alice likes `p02` and `p04` (a hand-kept score: the parent row is put),
and bob pages again:

```
device page 1 (after likes)   p12 p11 p10   {"complete":true,"cut":null,"fresh":true}
device page 2                 p09 p08 p04   {"complete":true,"cut":null,"fresh":true}
device page 3                 p03 p02 p01   {"complete":true,"cut":null,"fresh":true}
server page 2                 p09 p08 p07
server page 3                 p06 p05 p04
```

Page 2 is answered by the device from `p04`, a row it holds only because it was liked.
Page 3 continues after `p04`. **`p07`, `p06` and `p05` never appear**, and every page says
`complete: true, fresh: true`.

## Why it matters

- It is silent. Nothing is refused, cut or marked stale; the UI has no signal to refetch.
- It is history-dependent: two devices of one principal disagree according to when each
  was connected, and a cold start (a fresh snapshot) repairs it until the next old-row
  update. That makes it nearly impossible to notice in a test that starts from a fresh
  device, which is how every fixture and calibration starts.
- It is the correctness face of a cost LLP 3000.007.001 §3.6 set a threshold on (device
  rows gained beyond the horizon): the growth is not only memory, it is wrong pages.

## Direction (not a design)

Neither repair is NOT-DOING's "exact horizon maintenance": nothing evicts, nothing
back-fills, nothing holds a group at exactly N rows.

1. **Coverage by key, not by count (the correctness fix).** At acquisition a device records,
   per horizoned table and group, the **boundary key**: the horizon-index key of the oldest
   row the snapshot delivered — or "none" when the snapshot delivered fewer than N rows and
   the device therefore holds the whole group. Every `put` at or after that key reaches the
   device through the stream, and so does every delete, so the device knows the group
   *exactly* at and after its boundary and *nothing* below it. A descending page on the
   horizon index is complete while it stays at or after the boundary; a page that would
   cross it returns what lies above, says `complete: false`, and the client asks the server
   — today's control behaviour, made independent of what else the device happens to hold.
   This also replaces the `has_more` heuristic ("Missing rows and alternate index orderings
   cannot establish a complete answer from counts") with a statement a builder can be told.
   A row whose mutable key moves below the boundary while held becomes a straggler the rule
   ignores; one that moves above it arrives by `put` like any new row.
2. **Do not store what was never promised (the growth fix).** `Device::apply` drops a `put`
   for a row it does not hold whose horizon-index key is below the group's boundary. With
   (1) in place this is only about memory and cold storage; without (1) it is not sufficient
   (stragglers).
3. Later, and only if the bytes matter: the device names its boundary keys in the sync
   request and the server skips what (2) would drop. Stateless on the server, so still not
   "exact horizon maintenance"; it is a protocol change and wants its own review.

Regression shape: the probe above as a device test — control pages, two old-row updates,
the same pages again — asserting the page that crosses the boundary is incomplete on the
device and equal to the server's through the client; plus a group the snapshot delivered
whole (fewer than N rows), which must stay complete to its end.

## Related

- LLP 3000.007.001 §3.6 and §7 gate 2 (measured 2026-09-17: 56–58% against a 10% threshold)
- `issues/20260917-snapback4-stream-page-serves-images-newer-than-its-watermark.md` (the
  other place "holding a row" and "knowing the base" come apart)
- LLP 3000.007 §21.3 P1 (total reads) — this is a read that lies about completeness
