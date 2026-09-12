# Bounded jobs

See `guide successor` for fill and narrowing repairs.
`run <job> --as system --plan` shows counts, chunks, writes and ceilings.
`--wait` polls to completion; `--json` prints chunks and the final receipt.
`POST /control/job` rejects `wait: true`: waiting belongs to the CLI.

`chunk` walks current rows through the upper key captured at sweep start.
Later inserts between cursor and bound are visited; inserts beyond it are
excluded; deleted rows are skipped. Cursor, writes and emitted effects commit
together. Several chunks are independent sweeps in declaration order, not one
snapshot. Jobs execute as the owner under constraints, bypassing viewer rules.
A digest must explicitly validate the target's authorization and content
eligibility at final emission; see `guide fanout`.
`break` ends its sweep, `return` the job; `continue` skips a row.

A refused chunk rolls back and parks; earlier chunks stand. Fix the cause and
`run --resume job_id --as system`. `trace job_id` shows progress and refusal.
`run --cancel job_id --as system` is terminal. A changed declaration parks:
restore it to resume, or cancel and restart. `dev --status` counts running,
queued and parked jobs.

Sweep index columns must be `id` or `immutable`, and the order total
(unique or ending in `id`). Use `by byId` when unsure.

`run --file repair.q --as system` accepts one query, mutation or job up to
64 KiB; jobs also accept `--plan` and `--wait`.

`run <job|--file> [args] --as system --dry-run` rehearses on a discarded
store copy with its clock pinned, fresh IDs, no effects runner, timers, asset
sweep or blob writes. It uses the same chunk driver, then deletes the copy.
The receipt has `dryRun: true`, per-table writes, chunk count, proposed effect
names/payload sizes, released assets and refusals. Exit 0 includes program
refusals; exit 1 is `E_REHEARSAL`, failure to rehearse.
`--dry-run` excludes `--wait` and `--plan`.
The WAL-consistent backup copies all database pages: time/disk scale with store
size. `--plan` reads index counts without copying the store.

Receipt states: `done` completed; `parked` refused a chunk after earlier
commits; `rejected` refused a mutation's constraint or require; `refused`
could not start an admitted program. Admission (name, kind, args, certificate)
happens on the live store before copying; its ordinary errors remain
`E_OP_UNKNOWN`, `E_JOB_ARGS`, etc.

`/control/run` and `/control/job` default to system. `/control/execute`
also serves personas: explicitly send `as: system`.
Select one mode with `mode: "run" | "dry-run" | "plan"` or boolean `dryRun`
and `plan`. `dryRun`, `plan`, `wait` must be JSON booleans.
Contradictory flags/mode, rehearsal with plan or wait, and non-booleans refuse
`E_INPUT` at the flag's site. No flag is silently ignored.
