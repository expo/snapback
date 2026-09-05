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
receipt per chunk. Declare the column required and apply again.

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
