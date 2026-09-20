# Snapback 4: a sync response that cannot fit hides the generation change — and one undeliverable commit wedges a device

Status: Closed (MC0 implementation verified; awaiting lead landing)
Priority: P3 (needs a single commit, or a page of re-materialized images, above 16 MiB; when it happens the device cannot recover by itself)
Date: 2026-09-17
Systems: `snapback4` `serve.rs` (`respond_with_cors`), `snapback4-core` `partition.rs` (whole-commit stream pages, current-image re-materialization), the client's catch-up loop in `packages/snapback4/src/local.ts`
Observed version: main at `ab061be93` (read from source; not executed)
Evidence status: found by the GPT-family blind review of LLP 3000.007.001, round 2 (finding 1); the two code paths below were then read and match

## Problem

`respond_with_cors` serializes a response and, if it exceeds the HTTP ceiling, **replaces the
whole body** with a fixed refusal:

```rust
let refusal = Refusal::new("E_BOUND", "bound", "the HTTP JSON response exceeds 16 MiB; request a smaller page or return fewer values").guide("reads");
serde_json::to_writer(&mut bytes, &json!({ "denied": refusal_json(&refusal) }))
```

The replacement carries no `generation` and no `store_id`. The client's catch-up loop
(`local.ts`, `responsePageTooLarge`) answers by halving `pageLimit` and retrying the same
position; at `pageLimit == 1` it falls through to a refused session. A stream page
preserves whole commits, so a single commit above the ceiling cannot be split by any limit.
Generation adoption happens only after a page decodes, so a device in this state never
learns that the generation changed and that it should discard its images and snapshot
instead — which would have freed it.

Two things make the oversized page reachable without an enormous mutation: a stream page
re-materializes every `put` from the **current** row (see
`issues/20260917-snapback4-stream-page-serves-images-newer-than-its-watermark.md`), so
widening a table's rows after the fact enlarges old pages; and a derived rebuild at
activation emits one row event per rewritten target row in a single commit.

## Direction (not a design)

- The oversized-response body should carry `generation` and `store_id`, and the client
  should compare them **before** it shrinks or retries: a generation change is handled as
  one, whatever the page's size.
- Better, `/sync` should answer a generation mismatch with a small, bounded response before
  it materializes any page (the request would say which generation the device holds).
- A commit that cannot fit a response at `limit = 1` needs a defined outcome — a snapshot
  instruction — rather than a refused session.

LLP 3000.007.001 (maintained columns) lists this as a prerequisite of its first build: its
activation is a generation barrier, and generation discovery must not depend on a row page
being deliverable.

## Resolution — 2026-09-18, lane MC0

All three parts are implemented in the lane working tree; the lead owns the
commit and landing. Oversized snapshot and stream replies retain `generation`,
`store_id` and the page's `watermark`. The real client observes replacement and
adopts a changed generation before lowering its limit. The watermark on a
refusal is never applied as delivered data.

An oversized **stream** response at limit 1 adds `snapshot: true` beside
`denied`; the client restarts with `from: 0, after: null, stream: false`, keeps
limit 1 and publishes only after snapshot catch-up. This reuses the existing
snapshot word rather than adding `snapshot_required` or a new refusal code.
An oversized snapshot row at limit 1 remains refused, so there is no endless
snapshot restart. Commit atomicity and the 16 MiB ceiling are unchanged.

`packages/snapback4/test/sync-overflow.test.mjs` uses a real SQLite server and
the production client loop on both wasm and SQLite process devices. It creates
44 narrow rows in one commit, then widens them separately to 400,000 bytes each:
17,600,000 current body bytes against the real 16,777,216-byte HTTP ceiling.
There is no lowered test ceiling or checked-in large fixture. For the
already-wedged setup only, the transport suppresses the new snapshot instruction
on genuine oversized replies, reproducing the previous protocol's terminal
E_BOUND at limit 1 and watermark 1. After generation adoption it forwards the
server replies unchanged. Both devices adopt generation 2 before shrinking,
then recover through a real snapshot. Separate cases prove same-generation
snapshot recovery to watermark 13 and same-generation store replacement.

With the corrected heartbeat-only change-poll fixture, the identical regression
command (`node --test --test-concurrency=2
packages/snapback4/test/sync-overflow.test.mjs`, from `snapback4/`) reports:

- Base `0f34b023a3a811a9e5482f8e06572f25953c399c`: `ℹ tests 11`,
  `ℹ pass 0`, `ℹ fail 11` (nine regression cases and two containing tests).
- Fixed: `ℹ tests 11`, `ℹ pass 11`, `ℹ fail 0`.

The request-side generation mismatch response before page materialization is
explicitly deferred by the lane brief. It would avoid constructing rejected
pages; this fix makes recovery independent of their deliverability without
changing the request shape. No part of the ticket's direction was rejected.
The journal records the full-suite results separately from these defect proofs.

Final qualification: the complete blocking suite finished with one failing
category (client tests), solely the sandbox's Chromium `SIGABRT`; Rust and
all other categories passed. The requested concurrency-2 client run reports
809 tests, 805 passed, 1 failed, 3 skipped (base: 792 passed, 14 failed,
3 skipped, including the 11 new regression results). Chromium also failed
alone on the exact base. No commit, push, tag or publication was performed.
