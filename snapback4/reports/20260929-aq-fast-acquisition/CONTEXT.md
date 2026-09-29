# AQ context and pre-change attribution

Scope: browser acquisition through the published `createApp` and `webDevice`
paths; built-in strict IndexedDB persistence. Base `f9620c815`.

The `llp-orient` skill was read from the populated SQ vendor copy, read-only.
This lane's skill symlink target is absent. No Snapback 4 foundation entry;
the root, .007, .019 and .022 are in `llp/current`.

- LLP 3000 §4: the Snapback 4 fence and its own checks.
- LLP 2000.000 §§6–9: declared partition, unchanged meters, one interpreter.
- LLP 3000.007 §§18.2 and 20.4: snapshot continuation and catch-up precede
  atomic publication; strict durability, store identity and Worker custody.
- LLP 3000.008.004 §3: actual persistence-fault/reopen evidence.
- LLP 3000.016 §2.2: coverage and online fallback are independent of residency.
- LLP 3000.019 §§3.3–3.5: honest progress, incremental residency, media fences.
- LLP 3000.022 §4: conditional delivery still checks at the commit point.

Current sync guide, SS reports (especially rounds 6 and 9), and PF/SQ reports
were read. No partition inversion, meter cut, public contract, declarations,
wire format, or per-call durability change is intended. Risk: a batched persistence
read accidentally loads unrelated buckets or commits before callback writes.
Update .007's existing persistence record and the tested sync guide if landed.
Hand-off: none.

## Recorded before product edits, 2026-09-29

Host expose-builder-pixel / eb1000, AMD EPYC 9454, 96 logical CPUs. The retained
SQ full store, including WAL, was copied to ignored `target/aq/store`; only
that writable copy is served. The production-profile binary uses packaged
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. Builder files are data;
no builder script is executed.

Five fresh Chromium contexts per device give median startup-to-acquired
**4,888.1 ms default / 4,467.7 ms Worker**. The first diagnostic pair gives
strict save totals **3,482.2 / 2,552.2 ms**, wasm apply **425.7 / 424.3 ms**,
and server total **432.3 / 436.8 ms**. Three sync replies deliver **3,652,183
UTF-8 body bytes**. These initial diagnostic counters include some subsequent
read/close work; final phase qualification captures counters at acquisition.
The initial screen observation subscribed after `app.ready`; it is not an
earliest-screen measurement and is replaced by a watch mounted at creation.

The Worker snapshot pages perform 256 bucket reads apiece; terminal publication
performs 512 bucket reads plus the bounded deletion proof. The second page
rewrites buckets holding earlier staged rows: its 1,821 changes take 1,157 ms
in one strict transaction. Terminal publication takes 1,055 ms in another.
This motivates batching existing bucket reads inside the same strict transaction,
before considering a protocol, declaration or wasm change.

The retained fixture predates calibration #26: it has replyCounts/repostCounts
and no owner-key projections. It acquires 500 messages for u0500's 100
memberships and 500 Following edges. The supplied #26 JSON remains evidence
of its Mac run, not a same-fixture speedup denominator.
