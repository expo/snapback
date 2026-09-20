# Snapback 4: a stream page serves row images newer than its own watermark — a pending read-modify-write is replayed on top of its own effect

Status: Closed 2026-09-19 — repaired by Repair B (`201c45d245`, LLP 3000.001 `#reliability-catchup`, the program that owns the sync protocol), verified on a build of main `5df0d211a1` by this ticket's own probe
Priority: P2 (a device shows a wrong value for a predicted relative update until a later page retires the write; an interrupted catch-up leaves it on screen and on disk)
Date: 2026-09-17
Systems: `snapback4-core` `partition.rs` (the stream page's put materialization), `engine/mod.rs` (`acknowledged`), `snapback4-device` `device.rs` (`apply`) and `device/predictions.rs` (`replay`); the client's catch-up loop in `packages/snapback4/src/local.ts`
Observed version: published `snapback4@0.2.27`
Evidence status: found by the GPT-family blind review of LLP 3000.007.001 (finding 3), then reproduced by execution on the published binary

## Problem

A stream page is cut from the partition log by sequence, and its `watermark` is the last
sequence it covers. But every `put` in it is re-materialized from the **current** row
(`partition.rs`: "retained history is device-held; the server serves current readable
images" — `reader.fetch(&event.table, &event.id)`), so the image can already include
commits *after* the page's watermark — including the receiving device's own write, which
the page does not acknowledge because acknowledgement is `seq <= watermark`.

The device then restores, applies the page, and **replays every outbox entry the watermark
does not cover** (`predictions::replay`). A relative update is applied a second time.

## Reproduction (`benchmarks/runs/2026-09-17-snapback4-derived-probes/stream-image-ahead`)

`counters { n: int }`, public and synced; `mutation bump(counterId)`: `update
counters[counterId] { n: c.n + 1 }`. `SB=/path/to/snapback4 node measure.mjs`:

```
alice acquires      → watermark 1 image n = 0
bob bump seq 2 → n 1 | alice bump seq 3 → n 2
page(limit 1) from 1 → watermark 2, more=true, acks={}, events: seq 2 put n=2
```

The page ends at watermark 2, before alice's commit at sequence 3, and does not
acknowledge `alice-1`; its image is already `n = 2`. Alice's device, still holding `bump`
as pending, replays it over that image and shows **3**. The next page (watermark 3)
retires the write and the value returns to 2.

## Why it matters

- Any predicted read-modify-write is affected: a counter, `unread: m.unread + 1`, a
  balance, a position in a list. Writes that set a value, and `insert … if absent`, are
  not.
- The window is a catch-up that needs more than one page, or one that is interrupted
  between pages; the client re-runs affected watches in its `finally` after an
  interrupted catch-up, so the wrong value is rendered, and it stays on disk while the
  device is offline.
- It bears directly on LLP 3000.007.001 (maintained columns), whose device prediction adds
  a delta to a held parent image: "holding the row is knowing the base" is false while
  this holds.

## Direction (not a design)

The confirmed image and the replay boundary must describe the same causal point. Options
the review named: stage a catch-up's pages and publish the overlay only at a page boundary
whose images are not newer than its acknowledgements (for example, only when `more` is
false, or when the page's watermark has reached the head that the images were read at);
or carry, with each page, the sequence the images were read at and acknowledge against
that. Serving historical images instead would reopen the revocation decision the comment
cites (LLP 3000 §7), so it is not proposed.

Regression shape: the probe above as a device test on both stores — after applying the
first page, a watch over the counter never observes a value greater than the server's.

## Resolution (2026-09-19)

LLP 3000.001's rewrite of 2026-09-18 names this ticket as **Repair B**'s target ("the base:
the image already contains the device's own pending write … never install a confirmed image
over a row a live prediction writes"), and Repair B landed on main as `201c45d245`. The
server keeps serving current readable images — that is its materialization policy, not the
defect — but a stream page now carries the two bounds a device needs: `images_at` (the
sequence the images reflect) and `committed_above` (each pending write of the requester
already committed above the page's watermark). This ticket's probe, re-run against a build
of main `5df0d211a1`, shows the same limit-1 page as before with those fields added:

```
published 0.2.28:  {"acknowledged":{},"generation":1,…,"more":true,"watermark":2}
main 5df0d211a1:   {"acknowledged":{},"committed_above":{"alice-1":3},"generation":1,"images_at":3,…,"watermark":2}
```

so the device knows its `alice-1` is committed at 3 while the page ends at 2, and does not
replay it over an image that already contains it. The device-side proof is Repair B's own
regressions on both stores (`crates/snapback4-device/tests/repair_b*.rs`, three counterexample
files) and its four review rounds in that program. The prediction increment of maintained
columns (LLP 3000.007.001 §3.7) that this ticket gated is therefore unblocked on this point.
