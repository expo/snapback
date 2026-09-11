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

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — default output path still unsafe for frozen snapshots. **Triage priority:** P2.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

Current choreography.mjs still defaults receipts.jsonl beside the script; explicit --receipts/CHOREO_RECEIPTS moves output but does not make default invocation safe. The runbook still installs dependencies in the choreography directory.

Source audit only: benchmarks/tools/social-messenger/choreography/choreography.mjs DEFAULT_RECEIPTS_PATH and RUNBOOK.md setup. Remaining: keep dependencies and output outside the frozen source and qualify two sequential lanes against the same unchanged digest. Do not mutate frozen snapshots or restage historical runs during this audit.
