# Change-evidence follow-ups from the P1-CE review

Status: Open
Date: 2026-10-23
Scope: Snapback 4 core (`engine/sync_evidence.rs`, `revocation.rs`)
Severity: P3 (witness strength); P2 (wide-schema revocation)

Two items from the blind P1-CE review (`082d3de7f0`..`addf5750eb`). Neither
blocked landing.

1. **The stream interleaving witness cannot tell one snapshot from several.**
   `sync_evidence.rs` (~64–90): the concurrent commit records a different
   principal's receipt at sequence 2 while the reader checks Alice at image
   head 1. A later, separate receipt transaction would still not return that
   receipt, and the sequence-1 evidence stays the same, so reintroducing
   separate transactions would still pass. Add a concurrent Alice receipt-only
   commit at head 1, and a prune across the held snapshot, so that only the
   single-transaction `certified_stream_at` passes. (One reviewer.)

2. **A wide schema turns a known small footprint into revocation.**
   `Footprint::preserved` returns `[]` when `schema.tables.len() > 256`
   (`revocation.rs` ~82–83). Callers send that as a known list, and the
   client reads `[]` as revocation (`change-evidence.ts`). A 257-table schema
   therefore revokes every watch instead of answering unknown (`null`). Both
   stores share the function. The rows are refetched, so nothing stale is
   kept, but this is a false certification and should map to unknown.
   Pre-existing; not introduced by P1-CE. (One reviewer; check before fixing.)
