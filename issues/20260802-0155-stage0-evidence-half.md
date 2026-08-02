# LLP 0155 Stage 0, evidence half — freeze baselines and stand up standards-real browser automation

**Status:** Open
**Opened:** 2026-08-02, on LLP 0155's acceptance (fc19d8ed). The acceptance
change carried Stage 0's reconciliation half (the dated LLP 0129
cross-reference and companion records); this ticket owns the other half.
**Systems:** Testing, Client integration, Sync
**Related:** LLP 0155 §Stage 0; LLP 0138 (immutable receipts); the open
browser-carrier guide-gap ticket
(20260801-guide-gap-js-arm-browser-indexeddb-proof.md — same prerequisite,
coordinate rather than duplicate)

## Task

Per LLP 0155 §Sequencing Stage 0:

1. **Retain LLP 0138's receipts immutable** — verify nothing has mutated the
   bakeoff evidence trees; record the verification.
2. **Record current identities** — client/store bundle, carrier, and target
   identities as of the freeze date, so successor evidence has a pinned
   baseline.
3. **Freeze the six application manifests** — Triage Graph, Latency Kanban,
   Contention Calendar, Private Incident Room, Field Notebook, Fleet
   Observatory — as the successor-evidence fixtures for every later stage's
   exit gates.
4. **Standards-real browser automation** — a harness that can terminate and
   relaunch a real browser process over real IndexedDB (not fake-indexeddb,
   not same-process reload), plus the two-tab contention case. This is the
   lead-time item: Move 2's acceptance gate and Move 5's Field Notebook
   discriminator both require it, and the existing browser-proof guide-gap
   ticket has been waiting on exactly this harness.

No new product claims ride this ticket; it is evidence infrastructure. Per
LLP 0155 P6, the harness must let capability facts name carrier and evidence
class honestly.

## Exit

- The freeze artifacts landed (manifests + identity record, immutably
  referenced the way 0138's receipts are).
- The browser harness runs one real terminate/relaunch IndexedDB round-trip
  in CI or a documented locally-reproducible lane.
- The guide-gap ticket updated to point here (or closed onto this harness if
  it fully satisfies it).
