# Test pre-COMMIT nested-action abort cleanup ordering

Status: Open
Created: 2026-08-23
Related: LLP 0059, issues/20260823-detached-action-nested-mutation-fence-design.md

## Residual

The detached HostPlan and detached Ibex nested-mutation paths explicitly drop
their caller-authority reservation before dropping the scoped Local guard on
both authorization-snapshot error and mismatch exits. Review confirmed that
ordering, but no retained test drives those pre-COMMIT abort batches; the
ordinary batches are empty on those exits.

An attempted narrow after-Local probe was not suitable for this landing. A
forced mismatch through the detached runner wedged the test harness during
reservation teardown instead of producing a bounded observation. The
experiment and its seam were removed rather than retaining a flaky or
false-green test.

## Acceptance

- Exercise both detached HostPlan and detached Ibex.
- Drive at least one real snapshot error or mismatch after the exact child
  caller reservation exists and before COMMIT.
- Queue observable after-Local work in that aborting Local batch.
- Prove the exact caller reservation is inactive before the queued work runs.
- Prove the child durable effect remains absent and the runner settles within
  its bounded deadline.
