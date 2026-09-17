# Snapback 4: Browser persistence has competing owners without Web Locks

Status: Closed
Priority: P1
Observed: 2026-09-16
Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15` (0.2.26)
Review: complete code review requested by Charlie Cheever; lead validation with independent Grok, Muse and Sol reviews.

## Evidence

Code traced and independently raised by Muse. `claim` returns the shared name with exclusive:false when navigator.locks is absent. Two in-memory devices can load the same snapshot and write overlapping changes to the same IndexedDB store, losing outbox or watermark state. The fallback also disables the admission journal and orphan recovery.

## Implementation locations

Paths are relative to `snapback4/`: `packages/snapback4/src/web.ts:claim`, `adoptOrphans`; `web-journal.ts:AdmissionJournal.capture`. Current comment explicitly documents sharing, but no concurrency fence exists.

## Acceptance

Define support for environments without Web Locks: require a safe owner primitive or refuse durable opening with an actionable diagnostic; do not claim durability with multiple unfenced owners. Exercise two concurrent opens and reload recovery. LLP 3000.001 records alternatives.

## Resolution — 2026-09-16

Implemented in `f6b514c35` as part of the complete project review.

Built-in IndexedDB refuses when Web Locks cannot establish exclusive ownership. Custom Persistence providers must implement claim(name, alternate), used consistently for opening and orphan adoption. The memory provider has an explicit provider-local owner set. Tests cover unavailable ownership and concurrent stores; unsupported durable hosts no longer silently share one device database.

Integrated qualification and independent repair review are recorded in
[the review index](../../llp/reviews/3000-complete-code-review-20260916.md).

Follow-up implementation: `7e0fc21da8d7675b4a5ec2a418604b2135c438a9`.
Custom alternate claims must use the discoverable namespace and supply orphan
enumeration/removal. Invalid claims release ownership before refusing.
