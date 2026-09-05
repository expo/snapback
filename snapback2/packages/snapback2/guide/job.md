# Fill a column with a job

`E_SUCCESSOR_NARROWING` means stored nulls prevent making a column required.
Keep it optional, apply the schema, then put this in `snapback/admin.q`:

```q
job fillAvatars:
  chunk p in profiles first 100 by byId:
    update profiles[p.id] { avatarUrl: p.avatarUrl ?? 'https://cdn.example.com/default.png' }
```

Run `snapback2 run fillAvatars --as system --plan` to see index-entry counts,
implied chunks, engine writes and per-chunk ceilings. Then run
`snapback2 run fillAvatars --as system --wait` to fill; `--json` prints one
envelope per chunk, then the job's final envelope, which is its receipt.
Declare the column required and apply again.

Each chunk reads current rows in index order through the upper key captured
at the start of its sweep. Later inserts between the cursor and bound are visited;
inserts beyond it are excluded; deleted rows are skipped. Cursor and writes
commit together. A job can have several independent chunks, in order, with
typed arguments in their prefixes. Jobs execute as the owner, under constraints.

A refused chunk rolls back and parks with its refusal; earlier chunks remain.
Fix the data or constraint, then `run --resume job_id --as system` retries it.
`trace job_id` shows progress and the refusal. `run --cancel job_id --as system`
is terminal. A changed declaration parks; restore it to resume, or cancel and
start again. `dev --status` counts running, queued and parked jobs.

A successor rebuilds maintained columns; a job cannot write them.
Every sweep index column must be `id` or declared `immutable`, and its order
must be total (unique, or ending in `id`); use `by byId` when unsure.

For a one-off repair, `run --file repair.q --as system` accepts one query,
mutation, or job (64 KiB maximum); jobs also accept `--plan` and `--wait`.

`run <job|--file> [args] --as system --dry-run` rehearses instead of running.
The owner snapshots the store and opens the copy with no effects runner, no
timer firing, no asset sweep, no blob writes, the clock pinned at the snapshot
and a fresh id namespace; every chunk runs through the same driver, in-process;
then the copy is deleted. The receipt has `dryRun: true`, rows written per
table, chunks, the effects it would have emitted (name, payload bytes), the
assets it would have released, and any refusal, with exit 0 either way: the
rehearsal told the truth. Exit 1 is `E_REHEARSAL`, the rehearsal itself could
not run. `--dry-run` excludes `--wait` and `--plan`; queries and mutations
rehearse the same way.

The receipt's `state` is `done` (the program ran to completion on the copy),
`parked` (a chunk refused; earlier chunks stand and `refusals` says why),
`rejected` (a mutation's constraint or `require` refused it), or `refused`
(the copy would not start the program). Admission — the name, the kind, the
arguments, an ad hoc program's certificate — happens on the live store before
any copy is taken, so a refusal there is the ordinary envelope (`E_OP_UNKNOWN`,
`E_JOB_ARGS`) and nothing pauses the owner. `POST /control/run` and
`POST /control/job` are the operator seat and take `as: system` when the body
omits it; `POST /control/execute` does not, because it also serves explicit
personas, so send `as: system` with `dryRun: true` there. `dryRun`, `plan`, and
`wait` are JSON booleans; any other value is refused (`E_INPUT`).
