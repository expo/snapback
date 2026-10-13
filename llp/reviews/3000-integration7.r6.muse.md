# Integration 7 round 6 — muse

**Date:** 2026-10-13
**Source:** 1bc9993aec
**Provenance:** Fresh independent ~/sb4-loop/muse-exec.sh --yolo --model muse-spark-1.3-contributor --reasoning-effort high session; common read-only brief; no other review supplied.
**Artifact:** snapback4/reports/20261013-integration7/review-r6-muse.log.gz
**Scope:** Compiler cleanup inspector timeout retry; execution qualification remains separate.

## Verbatim response

READY — bound to immutable `1bc9993aec` only; required full Mac rerun still pending and not claimed here.

Source (`snapback4/scripts/test-command-group.mjs` at `1bc9993aec`): retry is narrow and fail-closed. Only `error.code === 'ETIMEDOUT'` retries, at most once, with first cap `min(10000, remaining)` and retry cap `remaining` against the unchanged 60s `deadline`. Partial timeout bytes are overwritten, never parsed or counted; `empty = 0` reset forces two fresh complete empty snapshots after a timeout. Second timeout, non-ETIMEDOUT error, non-zero status, empty stdout, and malformed rows all still throw `TEST_COMMAND_INSPECTION`; live/invalid rows keep the existing deadline refusal. No signal dispatch, group/session custody, or kill scope changes; `/bin/ps` leaf kill only.

Tests (`test-command-group.test.mjs`): first-timeout path asserts 3 runs, discarded partial bytes, and retry budget within deadline; second-timeout path asserts refusal after exactly 2 calls. Existing negative controls (empty stdout, status 2, plain error, malformed row) are preserved.

Material findings: none — no unbounded retry, no partial-output acceptance, no weakened refusal/custody found across first/second timeout, malformed, live-group/deadline paths.

Minor: no assertion on third-call budget; journal spacing typos (`is942.68`, `sees15445`); Linux nine-pass and Mac-pending status are commit-record claims, not verified in this read-only review (no builds per scope).


