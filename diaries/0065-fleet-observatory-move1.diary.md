# Diary 0065: Fleet Observatory Move-1 successor

**Date:** 2026-08-06
**App:** `demos/fleet-observatory-move1`
**Program:** LLP 0155/0157 Move 1, Fleet exit lane

## What I built

I built Fleet as a new discoverable demo instead of editing the zero-bakeoff
application. That kept LLP 0138's failed first receipt and corrected v2 receipt
immutable while retaining their workload lineage: 25,000 devices, 250,000
events, 1,000 updates, exactly 100 active matches, and 20 query changes.

The required route is one generated `snapshot-batch.v2` composite. Its
relational node reads the owner-visible event window and joins each event to a
unique protected vehicle record carrying device and owner facts. Its bounded
child node reads the active fleet view's per-vehicle rollups. The declaration
is substantially clearer than the predecessor JS handler's nested point-query
loop: the tuple, bounds, joined-side uniqueness, visibility, and `retention:
"none"` posture are all inspectable generated facts.

The workload source remains 250,000 server rows. Only 5,000 critical Fleet-0
events are query-visible to the controlled owner, only 100 arrive per page,
and Mallory owns neither the relational root nor joined side. The fixture
mutation keeps a separate fixture-owner field so the controlled actor can
author all scale rows without making nonmatching rows part of the active query.
The 100 rollups correspond one-to-one with the active burst events; applying
the burst updates both nodes without any client-side join.

Compared with React plus Convex or Supabase, the static mixed tuple removes a
large class of handwritten join, pagination, and cache-scope mistakes. Snapback
adds trusted-activation ceremony and currently makes a volatile composite leave
bookkeeping in the materialization store, so the acceptance harness must prove
the row/byte transition explicitly rather than treating cache presence as
retention.

## Guide experience

The relational-query, acceptance, query-bounds, and offline-retention pages
correctly supplied the source-authorization, real-server, implicit-prefix, and
`retention:"none"` constraints. The snapshot-batch page still documents only
v1, while the offline page says v2 implementation and vectors remain absent
even though the landed source and LLP 0157 implementation checkpoint now carry
them. I filed `issues/20260806-fleet-snapshot-batch-v2-guide-gap.md`; this lane
does not update the capability row or claim closure ahead of its receipt.

## Verification checkpoint

The source-level codegen and demo tests are part of the application commit.
The following commit adds the listener-backed 250,000-row workload run,
inspection/footprint measurements, and retained receipt; its results will be
appended here without rewriting this build record.

The in-sandbox attempt completed activation preparation and static gate 1,
then the real binary was denied its loopback listener with `Operation not
permitted` at `127.0.0.1:0`. The harness retained that outcome as 1 PASS / 7
BLOCKED and `--require-qualified` correctly rejected it. No byte, row, or
hydration number was invented. An orchestrator with loopback access must run
the harness once, then run its qualified `--check`; that rerun replaces this
blocked checkpoint with the authoritative measurements and activation/binary
bindings.

## 2026-08-16 — owner stamps and conflict-oracle disclosures

Fleet views, rollups, and vehicle facts now omit application-authored owner
fields and receive their effective principal from the host. The two globally
unique batch inserts also declare their exact value-free conflict disclosures,
bound to `seedRollupBatch` and `ingestVehicleBatch`; that makes the existence
oracle explicit instead of silently inheriting it from a generic insert. The
demo-local trusted activation was re-prepared after the authored-source change.
The ordinary events writes remain pre-0264 at runtime and are visibly marked
migration-pending; no workload or capability claim was promoted.
