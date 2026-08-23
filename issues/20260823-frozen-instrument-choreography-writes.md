# Keep choreography writes outside the frozen instrument snapshot

**Status:** Open
**Opened:** 2026-08-23
**Systems:** Benchmark choreography, Lane setup, Frozen instruments
**Governing:** LLP 0201; LLP 0277
**Evidence:** `benchmarks/runs/2026-08-22-clique-local-main-0126-oxalpha/`;
`BENCHMARK_LANE_SETUP_FAILED` symlink and choreography-root digest refusals

## Problem

Running choreography through a lane-local `instrument` symlink mutates the
shared frozen tree. The harness installs Playwright under
`tools/social-messenger/choreography/node_modules` (including `.bin` symlinks)
and writes receipts/logs beneath the snapshot.

Later lane setup correctly refuses that tree: first for forbidden symlinks,
then for a choreography-root digest mismatch.

## Impact

Serial lanes cannot regenerate or retry their packets against one provisioned
instrument. The resulting integrity refusal looks like manifest drift and can
trigger unnecessary restaging.

## Required change

Treat the instrument root as read-only. Install dependencies and write all
runtime output into a lane-owned scratch directory outside the frozen tree.

## Acceptance

- Run choreography for one lane against a digest-pinned instrument.
- Verify the complete instrument tree digest is unchanged afterward.
- Set up and run a second lane from the same snapshot without restaging.
