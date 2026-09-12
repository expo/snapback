# Bounded jobs

Fill/narrowing repairs: `guide successor`.
`run <job> --as system --plan` shows counts, chunks, writes and ceilings.
`--wait` polls to completion; `--json` prints chunks/receipt.
Waiting is CLI-only: `POST /control/job` rejects `wait: true`.

Transport pressure retries observation three times with backoff.
`E_OWNER_TRANSPORT` includes `job`, `lastObservedState`, `lastObservedSeq`
and project-qualified `trace` recovery. `E_OWNER_NOT_RUNNING`: start, then
trace. Malformed pages stop with trace recovery. Repeating `run --wait`
enqueues another job.

`chunk` walks current rows through its initial upper key, including later
inserts in the remaining interval; later keys/deleted rows are skipped.
Cursor/writes/effects commit together. Sweeps use independent snapshots in
declaration order. Jobs bypass viewer rules but obey constraints; validate
authorization/content eligibility at final emission (`guide fanout`).
`break` ends the sweep, `return` the job; `continue` skips a row.

A background turn fires ≤64 due timers, then runs a chunk at that pinned clock only
if none remain due. Backlogs delay jobs (`logs`: `skipped: "timers-due"`;
`dev --status`: due timers). Exact expiry counts need synchronous cleanup:
rejected/skipped targets and job targets can retain expired rows.

Refused chunks roll back and park; earlier commits stand. Fix, then
`run --resume job_id --as system`; `trace job_id` shows progress/refusal.
`run --cancel job_id --as system` is terminal. Changed declarations park:
restore or cancel/restart. `dev --status` counts job states.

Sweep indexes require `id`/`immutable` columns and total order
(unique or ending in `id`); use `by byId` when unsure.

`run --file repair.q --as system`: one query, mutation or job, up to 64 KiB.
Jobs accept `--plan` and `--wait`.

`--dry-run` rehearses a job or file on a discarded WAL-consistent copy:
same chunks, pinned clock, fresh IDs; no effects runner, timers, asset sweep
or blob writes. Copy time/disk scale with store size; `--plan` reads counts.
The `dryRun: true` receipt lists writes, chunks, proposed effects/payload sizes,
released assets and refusals. Exit 0 includes program refusals; 1 is
`E_REHEARSAL`. Excludes `--wait`/`--plan`.

States: `done` complete; `parked` chunk refusal; `rejected` mutation
constraint/require; `refused` program could not start.
Name/kind/args/certificate admission precedes copying; `E_OP_UNKNOWN` and
`E_JOB_ARGS` leave the owner running.

`/control/run` and `/control/job` default to system; for `/control/execute`,
send `as: system` for operator use.
Use `mode: "run" | "dry-run" | "plan"` or boolean `dryRun`/`plan`.
`dryRun`, `plan`, `wait` require JSON booleans; contradictions, rehearsal
with plan/wait or non-booleans refuse `E_INPUT` at the flag's site.
