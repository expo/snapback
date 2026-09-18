# Snapback 4: the 256 pending-id cap silently drops acknowledgements, and the device replays a write over its own effect

Status: Open
Priority: P2 (a device with more than 256 unacknowledged writes shows a value the server never held, and keeps it; found while designing LLP 3000.001's Repair B, reproduced on `origin/main` with no repair applied)
Date: 2026-09-17
Systems: `snapback4-device` `device.rs` (`sync_state` caps `pending_ids` at 256; `device/predictions.rs` `replay`), the sync wire's `acknowledged` map
Evidence status: reproduced by execution on memory and SQLite through the real `Device`, and it survives reopen — `crates/snapback4-device/tests/repair_b_round3_counterexample.rs`

## Problem

`Device::sync_state` builds `pending_ids` and stops at 256 (`device.rs`, the
`if pending_ids.len() == 256 { break }` in the outbox scan). The server resolves
**only the declared ids** into the page's `acknowledged` map. An outbox entry
past the cap therefore never receives an acknowledgement from sync.

An entry whose mutation response was also lost has no `sent_seq`, so sync's
acknowledgement is its only retirement path. `predictions::replay` keeps
replaying it. Once its commit is at or below the page's watermark, its effect is
already in the confirmed image the page delivered — so the replay applies it a
second time, permanently.

The cap is silent: nothing in `SyncState` says the declaration was truncated,
and the server cannot tell a truncated declaration from a complete one.

## Reproduction

257 committed writes with unavailable mutation responses, one counter. The final
page has `more: false`, so `watermark == images_at` and every declared write is
acknowledged. The 257th is not declared, is not acknowledged, and replays over
its own effect: the server holds 2, the device publishes and reopens on **3**.
The 256-write control publishes 2. Both stores, and it also occurs after a
deferred page.

## Why it matters

- It is independent of any repair: it reproduces on `origin/main` today.
- It is permanent, not transient — nothing later retires the entry.
- It breaks the premise every acknowledgement-based design rests on, that
  `acknowledged` is complete for `seq <= watermark`. LLP 3000.001's Repair B
  states that premise explicitly; this ticket is why it cannot be assumed.

## Direction (not a design)

1. **Do not replay what you could not declare.** The smallest safe guard: an
   entry the device did not declare this round is not replayed, so it shows the
   confirmed base instead of a doubled value. Stale, not wrong.
2. **Declare in batches.** The device paginates its declaration across sync
   rounds so every entry is eventually acknowledged, keeping the request bounded.
3. Either way, a truncated declaration should be visible rather than silent.

Regression shape: the reproduction above, plus the 256 control, on both stores.

## Related

- LLP 3000.001 `#reliability-catchup` (Repair B), whose completeness premise this
  falsifies
- `issues/20260917-snapback4-stream-page-serves-images-newer-than-its-watermark.md`
  (the other place the base and the acknowledgements come apart)
