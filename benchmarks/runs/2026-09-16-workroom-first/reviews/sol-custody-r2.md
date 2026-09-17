# Workroom process custody — independent Codex review of r2

Date: 2026-09-17
Reviewer: Codex gpt-5.6-sol, requested xhigh.
Native session: `01a0acec-c4cf-7cd0-92f9-955004ee7e2a`.
Reviewed: `31dc2214f6295efd0570959f2683c51182e1b710` against `abe888311791ab6ecceba890d8b57a31065cd2c6`.
Received: 2026-09-17T01:19:20Z; process exit 0.

Fresh mutually blind, single-reviewer, local read-only source review. No builds, tests, clones, remote commands or spawning were authorized. Reported implementation test results were not rerun by the reviewer. Local source links identify the immutable review worktree.

## Orchestrator disposition

NOT READY. The observable late-child leak is source-confirmed, not covered by the between-snapshot blindspot disclaimer. A final bounded r3 repair is commissioned: evolving verified ancestry throughout cleanup, a 30-second total budget including grace, and signal handlers retained through cleanup. r2's actual-process pass remains historical evidence, not qualification of changed r3 bytes.

## Received review

## Findings

1. **[P1] Cleanup can report success while a late distinct-PGID descendant survives.** Cleanup performs one final adopting sample at [run-pilot.mjs:496](/Users/ccheever/projects/snapback-worktrees/sb4-workroom-custody-20260917/benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.mjs:496), snapshots descendant group IDs once at [run-pilot.mjs:501](/Users/ccheever/projects/snapback-worktrees/sb4-workroom-custody-20260917/benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.mjs:501), and thereafter samples group state with `adopt: false` at [run-pilot.mjs:392](/Users/ccheever/projects/snapback-worktrees/sb4-workroom-custody-20260917/benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.mjs:392). The still-live leader is not terminated until [run-pilot.mjs:510](/Users/ccheever/projects/snapback-worktrees/sb4-workroom-custody-20260917/benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.mjs:510).

   Concrete failure path: after SIGINT grace expires, the leader or a TERM-resistant adopted child creates an ordinary child in a distinct PGID while an earlier descendant group is being cleaned. That new process may appear in repeated cleanup snapshots, but is never adopted and its group is absent from the frozen target list. Exact-PID cleanup covers only the ledger, and final survivor calculation also filters only the ledger at [run-pilot.mjs:533](/Users/ccheever/projects/snapback-worktrees/sb4-workroom-custody-20260917/benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.mjs:533). Consequently the child can survive under PID 1 while `receipt.ok` becomes true at [run-pilot.mjs:542](/Users/ccheever/projects/snapback-worktrees/sb4-workroom-custody-20260917/benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.mjs:542). This is not the documented between-snapshot double-fork limitation: the process can remain observable throughout cleanup.

## Test gap

The graceful mock removes the leader immediately on SIGINT ([run-pilot.test.mjs:134](/Users/ccheever/projects/snapback-worktrees/sb4-workroom-custody-20260917/benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.test.mjs:134)). The actual fixture creates its one detached child before cleanup begins ([run-pilot.test.mjs:272](/Users/ccheever/projects/snapback-worktrees/sb4-workroom-custody-20260917/benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.test.mjs:272), [run-pilot.test.mjs:320](/Users/ccheever/projects/snapback-worktrees/sb4-workroom-custody-20260917/benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.test.mjs:320)). Neither exercises descendant creation after grace expiry or the full `runPilot` stop/timer wiring.

## Pre-existing concern

Not charged as a delta regression: signal handlers are removed before natural-exit or lifecycle-error cleanup begins ([run-pilot.mjs:809](/Users/ccheever/projects/snapback-worktrees/sb4-workroom-custody-20260917/benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.mjs:809), [run-pilot.mjs:813](/Users/ccheever/projects/snapback-worktrees/sb4-workroom-custody-20260917/benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.mjs:813)). A driver SIGTERM during that cleanup therefore takes the default exit path, potentially preventing both completion and `end.json`; the base revision had the same ordering.

The documented five-second sampling/double-fork limitation otherwise remains appropriately narrow. Review was source-only as requested.

VERDICT: NOT READY

