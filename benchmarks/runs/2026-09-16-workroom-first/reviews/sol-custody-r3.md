# Workroom custody — independent Sol r3 review

Date: 2026-09-17
Reviewer: Codex gpt-5.6-sol, requested xhigh.
Native session: `01a0ad0c-063a-7bd3-8bcf-1b2842bbfb02`.
Reviewed: `19cc2656f7af0466f9bfd774bfd456a588634d3b` against `abe888311791ab6ecceba890d8b57a31065cd2c6`.
Received: 2026-09-17T01:57:05Z; process exit 0.

Fresh mutually blind source review. Neither reviewer saw the other's findings. Single reviewer; local source inspection only, no tests, builds, remote commands, clones or spawning.
Only the received public answer follows; no private model thoughts are retained.

## Supervisor disposition

Sol's hard-wall-clock timing objection is accepted. Instead of a fourth product-code repair round, the supervisor withdrew that stronger claim and corrected the historical hash label in a documentation-only delta. Both original reviews remain as received; their subsequent bounded-contract verdicts are separate artifacts.

## Received review

## Findings

1. **Medium — the 30-second cleanup deadline is not actually an overall deadline.** [`run-pilot.mjs`](/Users/ccheever/projects/snapback-worktrees/sb4-workroom-custody-r3-20260917/benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.mjs:137) gives every snapshot a fixed two-second timeout, regardless of remaining cleanup time. A snapshot begun just before the deadline can finish around second 32; then the deadline branch launches another unbudgeted final snapshot at [line 654](/Users/ccheever/projects/snapback-worktrees/sb4-workroom-custody-r3-20260917/benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.mjs:654), extending `_cleanup` to roughly 34 seconds. Additionally, an active sample is awaited before `_cleanup` starts at [line 840](/Users/ccheever/projects/snapback-worktrees/sb4-workroom-custody-r3-20260917/benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.mjs:840), so stop-to-completion can be longer still. This contradicts the explicit overall 30-second contract. Snapshot timeouts must use the remaining budget, and final verification must reserve or respect that budget.

2. **Low — the verification record labels a historical hash as the “Final runner” hash.** [`launcher-verification.md:3`](/Users/ccheever/projects/snapback-worktrees/sb4-workroom-custody-r3-20260917/benchmarks/runs/2026-09-16-workroom-first/protocol/launcher-verification.md:3) names `35f241…`, while this exact runner hashes to `b0ee4a…`, correctly recorded later at [line 232](/Users/ccheever/projects/snapback-worktrees/sb4-workroom-custody-r3-20260917/benchmarks/runs/2026-09-16-workroom-first/protocol/launcher-verification.md:232). Later prose explains the historical context, but the leading label remains contradictory and can misbind verification.

## Test gaps / accepted limitations

- The mocked deadline test advances time during signalling but uses instantaneous snapshots, so it cannot expose finding 1.
- The actual-Codex fixture exercises `ProcessCustody`, not `runPilot` timer, stop-request, and handler integration.
- The documented between-snapshot double-fork/reparent blind spot is an explicit non-goal and is not counted as a defect.
- I ran no tests, builds, fixtures, or suites. The current runner/test hashes match the reported `b0ee4a…` and `97b43d…`.

Governing context applied: LLP 3000 §3/§7, LLP 2000.000 §12, the shared-machine recorded-PID rule, and the Workroom journal’s diagnostic-only claim boundary. Hand-off: none.

**VERDICT: NOT READY** for this bounded launcher delta because the promised overall cleanup deadline is not enforced.
