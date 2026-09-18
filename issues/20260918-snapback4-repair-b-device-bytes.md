# Snapback 4: Repair B's 23 KB on the wasm device, attributed and reclaimable

Status: Open
Priority: P2 (no defect; a ratchet raise the diet program should earn back)
Date: 2026-09-18
Systems: `snapback4-device` deferred publication, capture/declaration state, restore evidence; the wasm device budget
Evidence status: measured by ordered source ablation on the integrated tree, gzip

## What happened

Repair B (LLP 3000.001 `#reliability-catchup`) raised the wasm budget from
411,000 B to 434,000 B gzip. The device measured 433,908 B against main's
410,459 B — a delta of 23,449 B, about **21.3% of the bytes the diet program has
recovered so far**. The author's ruling of 2026-09-18 permits a landing to raise
the ratchet with its reason stated; this ticket is where the debt lives so that
it is concrete rather than diffuse.

## Where the bytes are

Measured by ordered source ablation, not estimated:

| Area | Growth |
|---|---:|
| Deferred slot and its recording | 10,824 B |
| Capture and declaration state | 6,889 B |
| Restore evidence and observation | 1,654 B |
| Wasm opening | 1,218 B |
| Shared publication/lifecycle/wire remainder | 5,550 B |
| **Total** | **26,135 B** |

2,686 B were already reclaimed before the raise: 412 B from sorting and
collection choices, 2,242 B from combining the recording maps, and 32 B from
correctness changes that happened to shrink. A shared-applicator experiment
*added* 2,640 B and was reverted — worth knowing before anyone tries it again.

## Why it is not simply removable

The deferred slot is the repair: a page whose images contain one of this device's
own replayable writes publishes nothing until it does not, and the slot is where
those effects wait. The capture and declaration state is what makes the
acknowledgement bounds exact rather than conservative. Neither is ornament.

## Direction

The largest item is the deferred slot and its recording at 10.8 KB, which is
representation work rather than a cheap win — the cheap wins are taken. The
recording map's encoding and the staged effect representation are the places to
look. Any attempt should be measured the same way (ordered ablation, gzip on the
integrated tree) so the numbers stay comparable.

## Related

- `issues/20260913-snapback4-wasm-device-diet.md` — the ratchet's home
- LLP 3000.002 — the device representation and codec redesign
- LLP 3000.001 `#reliability-catchup` — what the bytes buy
