# Snapback 4: orphan recovery deletes its principal's only retained history

Status: Open
Priority: P1 (irreversible loss of delivered history that the server no longer authorizes)
Date: 2026-09-17
Systems: `snapback4/packages/snapback4/src/web.ts` (`adoptOrphans`)
Evidence status: reproduced by the GPT-family round-3 Repair C reviewer; inherited defect in the recovery path, deferred explicitly from fix round 4
Related: [LLP 3000.001, Repair C](../llp/3000.001-durable-replica-and-write-lifecycle.research.md#reliability-retention)

## Problem

`adoptOrphans` transfers queued writes and terminal receipts, then removes the
source database when no journal or unresolved transfer remains. It does not
establish durable custody of the source's retained rows before removing it.
Matching principal and store incarnation make receipt recovery valid but do
not make left-group history reacquirable.

## Reviewer's reproduction and evidence

The reviewer used the real memory-device export from `fixture(..., "dev:bob",
true)`: the device had acquired a partition, left one group, and still answered
with exactly 25 retained left-group rows. The export was installed as an orphan
and recovered into a destination for the same principal and store incarnation.
Recovery removed the source store, destroying those 25 rows.

The source-host probe failed with:

```text
AssertionError [ERR_ASSERTION]: recovery deleted the store holding all 25 retained left-group rows
actual: false
expected: true
```

Original reproduction log:
`/var/folders/yp/_12yp6653wn7x0_vvt87c5q80000gn/T/repair-c-review-szezhb30/review-logs/orphan-probe.log`.
The real exported fixture is `review-logs/real-orphan.json` in that same review
checkout; `crates/snapback4-device/tests/reviewer_final.rs::final_emit_real_orphan`
produced it. The review is retained in this lane at
`snapback4/target/reviews-round3/gpt-family-review.txt` (finding 1).
Fix round 4 also retains a copy of the supplied log at
`snapback4/target/repair-c-round4/inherited-orphan-probe.log`.
This was a real device export exercised through the source host with a device
boundary double, not a Chromium/IndexedDB witness.

## Why it matters

These rows cannot be fetched again after the principal leaves the group.
Successful write/receipt recovery can therefore cause permanent local data loss
even when every identity check passes. Foreign-owner refusal does not address
this same-owner case.

## Second symptom: valid legacy orphan writes remain stranded

The round-5 GPT-family review independently reconfirmed the 25-row deletion
and reproduced a second symptom: an orphan with no `device:history-owner`, a
committed write whose recorded viewer matches the opener, and no synchronous
journal copy is skipped before device construction. `adoptOrphans` excludes
every unbound source containing a live `r`, `b` or `o` cell. The write remains
in its source, is never imported, and cannot reach the sender automatically.
Primary-store legacy first binding preserves the same valid write.

Evidence: `snapback4/target/reviews-final/gpt-family-review.txt`, Part 2,
findings 2 and 3. This is a false recovery exclusion, not loss of the source.
The author explicitly defers it in Repair C fix round 6: letting more sources
enter the current removal path would widen the irreversible-history defect.
Both symptoms remain open; the executable-outbox ownership fix does not change
orphan inspection, source-removal criteria, or claim custody of retained rows.

## Direction

Before removing an orphan, establish whether it holds retained history. If it
does, or that cannot be ruled out, preserve the source until its retained copies
have durable custody elsewhere. Cover empty and held-only orphan controls,
same-owner left-group recovery, interrupted transfer, and unknown provenance.
Receipt recovery alone must not authorize deleting the database. After that
custody repair, consult the device when inspecting legacy orphan sources and
recover matching committed writes without requiring a journal copy. Cover the
same source with retained rows, foreign/unlabelled writes, and interrupted
transfer; an unresolved source must stay intact. Do not expand Repair C fix
round 6 into either deferred recovery repair.
