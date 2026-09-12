# Bounded jobs

See `guide successor` for fill and narrowing repairs.
`run <job> --as system --plan` shows counts, chunks, writes and ceilings.
`--wait` polls to completion; `--json` prints chunks and the final receipt.
`POST /control/job` rejects `wait: true`: waiting belongs to the CLI.

Transport pressure retries the same observation three times with backoff.
Persistent `E_OWNER_TRANSPORT` retains `job`, `lastObservedState` and
`lastObservedSeq`; use its project-qualified `trace` recovery command.
For `E_OWNER_NOT_RUNNING`, start the owner, then trace the existing job.
Malformed pages also stop with trace recovery. Repeating `run --wait`
enqueues another job.

`chunk` walks current rows through its initial upper key: later inserts within
the remaining interval are visited; later keys and deleted rows are skipped.
Cursor, writes and effects commit together. Sweeps run in declaration order
across independent snapshots. Jobs obey constraints but bypass viewer rules;
validate authorization and content eligibility at final emission (`guide fanout`).
`break` ends its sweep, `return` the job; `continue` skips a row.

A refused chunk rolls back and parks; earlier commits stand. Fix it, then
`run --resume job_id --as system`. `trace job_id` shows progress/refusal.
`run --cancel job_id --as system` is terminal. Changed declarations park:
restore to resume, or cancel/restart. `dev --status` counts each job state.

Sweep index columns must be `id` or `immutable`, and the order total
(unique or ending in `id`). Use `by byId` when unsure.

`run --file repair.q --as system` accepts one query, mutation or job up to
64 KiB; jobs also accept `--plan` and `--wait`.

`run <job|--file> [args] --as system --dry-run` uses the same chunk driver on
a discarded store copy: pinned clock, fresh IDs, no effects runner, timers,
asset sweep or blob writes. Its `dryRun: true` receipt lists table writes,
chunks, proposed effects and payload sizes, released assets and refusals.
Exit 0 includes program refusals; exit 1 is `E_REHEARSAL` (could not rehearse).
`--dry-run` excludes `--wait` and `--plan`.
The WAL-consistent backup's time/disk scale with store size. `--plan` reads
index counts without copying.

States: `done` completed; `parked` refused a chunk; `rejected` failed a
mutation constraint/require; `refused` could not start the admitted program.
Name/kind/args/certificate admission precedes copying; ordinary errors
(`E_OP_UNKNOWN`, `E_JOB_ARGS`) leave the owner running.

`/control/run` and `/control/job` default to system. `/control/execute`
also serves personas: explicitly send `as: system`.
Select one mode with `mode: "run" | "dry-run" | "plan"` or boolean `dryRun`
and `plan`. `dryRun`, `plan`, `wait` must be JSON booleans.
Contradictory flags/mode, rehearsal with plan or wait, and non-booleans refuse
`E_INPUT` at the flag's site. No flag is silently ignored.
