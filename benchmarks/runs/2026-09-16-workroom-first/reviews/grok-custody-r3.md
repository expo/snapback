# Workroom custody — independent Grok r3 review

Date: 2026-09-17
Reviewer: Grok 4.6, requested xhigh.
Native session: `01a0ad0c-0baa-7251-8c36-f39c46a873c1`.
Reviewed: `19cc2656f7af0466f9bfd774bfd456a588634d3b` against `abe888311791ab6ecceba890d8b57a31065cd2c6`.
Received: 2026-09-17T02:03:04Z; process exit 0.

Fresh mutually blind source review. Neither reviewer saw the other's findings. Single reviewer; local source inspection only, no tests, builds, remote commands, clones or spawning.
Only the received public answer follows; no private model thoughts are retained.

## Supervisor disposition

Sol's hard-wall-clock timing objection is accepted. Instead of a fourth product-code repair round, the supervisor withdrew that stronger claim and corrected the historical hash label in a documentation-only delta. Both original reviews remain as received; their subsequent bounded-contract verdicts are separate artifacts.

## Received review

I'll review only the three in-scope files against the stated custody contract, using local reads and searches—no tests, clones, or other reviewers' artifacts.I'll pull the protocol files and the Snapback 4 journal/LLP notes that bound this custody claim.I'll read the rest of the launcher, tests, and the surrounding protocol constraints before judging the delta.I’ll inspect a few remaining cleanup-path details that could still produce a false-green receipt or an unbounded wait.Independent review of `19cc2656f7af0466f9bfd774bfd456a588634d3b` vs `abe888311791ab6ecceba890d8b57a31065cd2c6`, bounded to:

- `benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.mjs`
- `benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.test.mjs`
- `benchmarks/runs/2026-09-16-workroom-first/protocol/launcher-verification.md`

Inspection only. Tests, hashes, and the reported Codex witness were not rerun.

## What holds

The r3 drain matches the stated contract.

- Stable identity is PID/UID/start token. PPID, PGID, and command hash are receipted coordinates; exec/argv change does not create identity uncertainty (`run-pilot.mjs` `stableIdentityMatches`, `observeRows`).
- Adoption walks only current verified parents in the same snapshot. PID 1 and unrelated same-UID rows are not roots (`observeRows` requires `verified.get(observed.ppid)`; `verified.size === 0` stops adoption).
- Cleanup snapshots keep `adopt: true` in graceful cancel, group waits, exact-PID waits, the outer drain, and the deadline-final snapshot. A child first visible while a verified parent is still live is adopted and queued as a new group or exact PID (`_cleanup`, `groupState`, `signalExact`, `waitForExactGone`).
- Group signal is refused unless every current member is a matching ledger identity; owned PIDs then go through revalidated exact TERM/KILL (`validateGroup`, `cleanupExactPids`).
- Intentional cap/disk/driver stops send leader SIGINT with 5s grace, then TERM/KILL (`intentionalStop`, `gracefulCancel`).
- Cleanup is a singleton. The 30s deadline starts at `_cleanup` entry and clamps polling waits (`cleanupPromise`, `terminalDeadlineExceeded`, `Math.min(..., deadline - Date.now())`).
- Exhaustion, identity mismatch, snapshot failure, unknown group members, and tracked survivors force `receipt.ok === false`.
- SIGINT/SIGTERM handlers are installed before seed and removed only after custody cleanup or exact-child fallback (`run-pilot.mjs` around the `process.on` / `process.off` pair).
- Preserved: `end.json`, `app/FINAL.md` vs private `last-message.md`, `snapback4 === '0.2.26'`, `MAX_MS` four-hour cap, `MIN_FREE_BYTES` 2GiB, `CUSTODY_SAMPLE_MS = 5000`.
- Receipts stay fail-closed for cold-cell self-qualification (`coldCellCoverage.eligibleFromThisReceipt: false`). Docs keep failed r1 and obsolete r2 and do not treat r3 as a scored cell.

I did not find a demonstrable path where this delta claims `ok: true` while the same snapshot still shows a same-UID child of a still-verified tracked parent.

## Findings

No P1 correctness/safety defect against this bounded contract.

### P3 — leader-group SIGKILL can be starved by the 30s cap

**Where:** `run-pilot.mjs` `ProcessCustody` constructor `groupTermMs ?? 30_000`; `_cleanup` graceful 5s then `cleanupGroup(..., { descendant: false })`.

**Path:** Intentional stop. SIGINT grace uses 5s. Leader still alive (as in the reported r3 witness). No distinct descendant groups, or they vanish quickly. Leader-group TERM wait is then `groupTermMs = 30_000` clamped by ~25s remaining. If the original Codex group ignores SIGTERM, the overall deadline fires during that wait and SIGKILL is skipped. Receipt is non-green (`PILOT_TERMINAL_CLEANUP_DEADLINE_EXHAUSTED` plus survivors). This is not a false-success and not unbounded; it is weaker completeness than the old 30s TERM + 10s KILL on that one group. Descendant groups use 5s+5s and are the actual leak path.

### P3 — operator exit codes still ignore `custody.ok` for cap/disk/driver stops

**Where:** `run-pilot.mjs` after `writePrivate(..., 'end.json')`: `four-hour-operational-ceiling` → 124, `disk-floor` → 125, `driver-SIGINT` → 130, `driver-SIGTERM` → 143, before `custodyCleanup?.ok !== true`.

**Path:** Ceiling stop with a tracked survivor writes `custody.ok: false` into `end.json` and still returns 124. That matches “preserve original process exit” and “non-green receipt.” Green/red for this repair is `end.json` `custody.ok`, not the process status.

No unsafe group/PID signalling path showed up: `kill(-pgid)` only follows `validateGroup`; exact kills re-sample and refuse PID/UID/start-token mismatch. A stranger in pgid 1, a reused PID, or a foreign UID refuses the group and does not get a group signal.

## Remaining limitations and test gaps (not introduced defects)

These are not counted as new bugs.

1. **Documented sampling gap.** A process that double-forks and reparents to PID 1 entirely between snapshots is not adopted. The fast-double-fork test leaves pid 300 alive on purpose. That is the stated non-goal, not a late-child leak of a still-verified parent.
2. **Group `killpg` TOCTOU.** Membership is checked on the last snapshot, not atomically with the signal. Inherent to this design.
3. **Fixture scope.** The 14 mocks target `ProcessCustody` (zeroed wait timings, in-process kernel). They do not prove `runPilot` handler lifetime, timer/singleton races, `end.json` shape, or remaining-budget clamps except the mocked-Date SIGINT jump. That matches the stated fixture target.
4. **No mock for `PILOT_REUSED_DESCENDANT_PID_REFUSED`.** Source fail-closes (uncertainty, no adopt, no signal of the new occupant). Untested.
5. **Identity-unverified fallback** (`cleanupExactChild`) uses 5s+5s on the Node handle and is outside `TERMINAL_CLEANUP_MS`. Receipt is already `ok: false`.
6. **If `_cleanup` throws**, `runPilot` synthesizes `ok: false` with `survivors: []`. Non-green, but survivor evidence can be missing. Internal catches make this unlikely.
7. **5s live cadence vs 100ms cleanup polls.** Ordinary long-lived distinct-PGID children of a live Codex/parent are visible and adopted; a child that appears and fully reparents inside one live 5s gap is the sampling limitation. Instrumentation at 5s matches the narrower sampled-ancestry claim; it does not contradict it.

`launcher-verification.md` keeps r1/r2, records r3 hashes/native thread `01a0ad07-c8a5-7c02-9507-31fa653e2194`, and does not promote this to a cold/scored cell. I did not recheck those hashes or the witness.

## VERDICT: READY

Ready as this bounded launcher custody delta only. Not a program, scored-cell, or generic subtree-custody claim.

