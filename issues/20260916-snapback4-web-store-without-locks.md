# Snapback 4: Browser persistence has competing owners without Web Locks

Status: Open
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
