# Snapback 2 job wait reports owner stopped while the job completes

**Status:** Resolved (2026-09-11)
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 CLI owner transport and job waiting
**Related:** LLP 1002; [0.0.25 Clique run](../../benchmarks/runs/2026-09-11-snapback2-0025-clique-linux/README.md)

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

## Note — 2026-09-11

`snapback2 verbs_jobs wait() spins without backoff` was resolved on 2026-09-12
(20 ms between backlog pages, strict sequence progress, malformed pages stop;
`issues/closed/20260912-snapback2-verbs-jobs-wait-spin.md`). A hot poll loop is
a plausible contributor to `EAGAIN` under load, so the reproduction above should
be retried on a package at or after that fix before attributing the failure.
The classification defect stands on its own regardless: a transient connection
error during receipt polling must not be reported as `E_OWNER_NOT_RUNNING` with a
`run snapback2 dev` rewrite while the owner is alive and the job finishes. The
0.0.25 scorer named this false diagnostic explicitly (diagnostics 84,
"reduced trust").

## Resolution — 2026-09-11

The classification defect was direct: every connect/read/write I/O error
was mapped to `E_OWNER_NOT_RUNNING`. Only a refused connect now establishes
no listening owner; timeout/EAGAIN/reset/write failures use the existing owner
family's new `E_OWNER_TRANSPORT` code with a sited, read-only recovery.
`--wait` retries only receipt GETs (100/200/400 ms), retaining the last sequence
and the existing 20 ms progress-page backoff. Exhaustion retains job id,
last observed state and sequence, and a shell-quoted, project-qualified
`trace` command. Neither retry nor recovery replays enqueue. A stopped owner
still receives the start-owner diagnostic, followed by observation of the
same job. The guide, diagnostic catalog and LLP 1016 D6 record the behavior.

Validation: client unit checks 6/6 and job-wait checks 4/4 pass. A real TCP
peer remains accepted/alive while a 10 ms receive timeout reproduces
WouldBlock/EAGAIN on this Mac; the result is transport, not owner absence.
A 128-page progress sequence with interleaved transport failures verifies
cursor continuity, bounded retry exhaustion before/after the first receipt,
and no replay of progress. Stopped-owner and malformed-page recovery are
covered. The original 167,157-action shared-host workload was not rerun;
its source of pressure remains unproven. This closes the independently
reproduced misclassification/recovery defect without attributing that load
failure to the already-fixed spin loop.
