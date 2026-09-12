# Bounded jobs

See `guide successor` for the fill recipe and narrowing repair.
`run <job> --as system --plan` shows counts, chunks, writes and ceilings;
`--wait` runs to completion. It is CLI-side polling after the owner returns the
enqueued id; `POST /control/job` itself refuses a `wait: true` field rather than
silently discarding it. `--json` prints each chunk and the final receipt.

`chunk` reads current rows in index order through the upper key captured
at the start of its sweep. Later inserts between the cursor and bound are visited;
inserts beyond it are excluded; deleted rows are skipped. Cursor and writes
commit together. `break` ends its sweep, `return` ends the job, and `continue` skips a row.
Jobs run as the owner, under constraints.

A refused chunk rolls back and parks with its refusal; earlier chunks remain.
Fix the data or constraint, then `run --resume job_id --as system` retries it.
`trace job_id` shows progress and the refusal. `run --cancel job_id --as system`
is terminal. A changed declaration parks; restore it to resume, or cancel and
start again. `dev --status` counts running, queued and parked jobs.

Every sweep index column must be `id` or declared `immutable`, and its order
must be total (unique, or ending in `id`); use `by byId` when unsure.

For a one-off repair, `run --file repair.q --as system` accepts one query,
mutation, or job (64 KiB maximum); jobs also accept `--plan` and `--wait`.

`run <job|--file> [args] --as system --dry-run` rehearses instead of running.
The owner snapshots the store and opens the copy with no effects runner, no
timer firing, no asset sweep, no blob writes, the clock pinned at the snapshot
and a fresh id namespace; every chunk runs through the same driver, in-process;
then the copy is deleted. This writable, WAL-consistent SQLite backup copies all
database pages, so its time and disk cost scale with store size. `--plan` reads
index counts without making a snapshot. The receipt has `dryRun: true`, rows written per
table, chunks, the effects it would have emitted (name, payload bytes), the
assets it would have released, and any refusal, with exit 0 either way: the
rehearsal told the truth. Exit 1 is `E_REHEARSAL`, the rehearsal itself could
not run. `--dry-run` excludes `--wait` and `--plan`; queries and mutations
rehearse the same way.

The receipt's `state` is `done` (the program ran to completion on the copy),
`parked` (a chunk refused; earlier chunks stand and `refusals` says why),
`rejected` (a mutation's constraint or `require` refused it), or `refused`
(the copy would not start an admitted program). Admission — the name, the
kind, the arguments, an ad hoc program's certificate — happens on the live
store before any copy is taken, so a refusal there is the ordinary envelope
(`E_OP_UNKNOWN`, `E_JOB_ARGS`) and nothing pauses the owner; `refused` is
therefore a safety net no fixture reaches (an admitted program the copy
itself cannot enqueue or run), kept so the receipt is never silent, not a
branch to delete. `POST /control/run` and `POST /control/job` are the
operator seat and take `as: system` when the body omits it;
`POST /control/execute` does not, because it also serves explicit personas,
so send `as: system` with `dryRun: true` there. A body names its run once:
`mode: "run" | "dry-run" | "plan"`, or the booleans `dryRun` and `plan`.
`dryRun`, `plan`, and `wait` are JSON booleans; any other value is refused
(`E_INPUT` at the flag's site), and so is a flag that disagrees with `mode`
(`dryRun: true` with `mode: "run"`, `dryRun: false` with `mode: "dry-run"`,
`plan: true` with `mode: "dry-run"`) or `dryRun` with `plan`; `dryRun: true`
alone rehearses and `plan: true` alone plans. Nothing a body says is ignored.

See `guide fanout` for when bulk work belongs in a `chunk` job rather than a
mutation loop.
