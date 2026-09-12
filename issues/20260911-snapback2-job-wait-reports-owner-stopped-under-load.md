# Snapback 2 job wait reports owner stopped while the job completes

**Status:** Open
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 CLI owner transport and job waiting
**Related:** LLP 1002; [0.0.25 Clique run](../benchmarks/runs/2026-09-11-snapback2-0025-clique-linux/README.md)

## Evidence and impact

The cold Clique builder on builder-1000, using published `snapback2@0.0.25`,
ran `snapback2 run insights.backfillAnalytics '{}' --as system --wait --project
scale-instance-retry` after its 167,157-action replay. The command emitted chunk
progress and then exited 1 with `E_OWNER_NOT_RUNNING`, message `owner connection
failed: Resource temporarily unavailable (os error 11)`, and rewrite `run snapback2 dev`.
The retained job trace records 3,196 chunks and commit range 167248–170443;
the builder subsequently verified the completed backfill. The run log records
the owner as alive and switches to enqueue plus periodic status/final trace.

Evidence is retained on builder-1000 under
`/home/ccheever/clique-0025-20260911/lanes/astra-snapback2/`:
`evidence/scale-upgrade.log`, `evidence/scale-analytics-trace.json`,
`scripts/upgrade-scale.mjs`, and run-log entry at epoch 1789171648.
This is one observed failure on a shared machine, not a demonstrated root cause.

## Requested outcome and acceptance

Reproduce the wait failure under sustained job progress and transport pressure.
Determine why a transient connection failure is classified as an absent owner.
Keep recoverable wait failures distinct from a stopped owner, and preserve the
job ID/status so users can recover without restarting a healthy owner. Verify
that retrying observation cannot enqueue the job again, and that a truly stopped
owner still produces the appropriate actionable diagnostic.
