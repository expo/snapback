# Every asset delivery request writes a permanent receipt row — read-traffic-driven unbounded growth

**Opened:** 2026-08-08 · **Severity:** P2 (read-rate writes under the global writer; unbounded table) · **Area:** assets / retention

## What

`src/local.rs:11530-11546` (`DeliveryAdmitted` receipt); `src/assets.rs:950-960`
(no retention path for `_snapback_asset_receipts_v1`).

`asset_deliver_from` inserts a receipt inside the read transaction for **every**
GET, including every `Range` request. Tombstone purge explicitly says "receipts
remain," and there is no purge/retention sweep for the receipts table.

## Failure scenario

A client video-scrubbing with range requests, or any hot image, generates one
durable insert per request forever. The receipts table grows without bound and
turns every delivery — a read — into a write under the global writer lock,
degrading the whole instance under read load.

## Fix

Sample or aggregate delivery receipts (e.g. count per asset/day), or give
`DeliveryAdmitted` rows a retention sweep in the GC pass.

## Confidence

High on mechanics; medium on intent. Lifecycle receipts as permanent evidence
is deliberate (LLP 0044 vocabulary), but per-request *delivery* receipts at read
rate are a different growth class that no `@ref` addresses. Part of the "every
registry names its retention bound" theme (see the jobs / stream-attempt /
migration-checkpoint sibling tickets).

## Resolution (2026-08-08)
Fixed on main (Lane B). Verified: cargo build; cargo test --lib asset 135 pass (single-threaded); ref-check clean.
