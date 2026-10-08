# Snapback 4: a job writing the reserved system principal compiles, then parks at runtime

Status: Open
Date: 2026-10-08
Scope: Snapback 4 binder (`crates/snapback4-lang`; lead session — one owner on the core)
Reproduced: yes, on main cc9e0f58d6

## Evidence

App-farm round-2 synthesis, Snapback 4 cluster 12 and recommendation 9
("refuse reserved system principals at `check`"): 5 GPT builds across arms,
each about 1–2 minutes, each found only through `doctor` after a schedule fired.

- bereavement-leave-planner-0690, club-charter-approvals-0265,
  grant-deadline-pipeline-0231: an audit row `actor: 'system'` in a job.
  "Compiler accepted `actor: 'system'`" … "Most needed fix: reject reserved
  system principal literals during check, before a scheduled job runs."
- backup-restore-verifier-0871: `requestedBy: viewer` in a nightly job (a job's
  viewer is the system). "Worst thing: a validly compiled job failed only at
  runtime on the reserved system principal field."

Every build repaired it the same way: an optional principal written `null` for
system events, or a `service:<name>` principal.

## Repro

```quarry
use personas alice
table grants:
  owner: principal
  closed: bool
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- deny
  delete <- deny

table activity:
  actor: principal
  note: text
  read <- .actor = viewer
  insert <- deny
  update <- deny
  delete <- deny

mutation open():
  insert grants { owner: viewer, closed: false }

job tick():
  for g in grants by .id:
    insert activity { actor: 'system', note: 'literal' }

job tock():
  for g in grants by .id:
    insert activity { actor: viewer, note: 'viewer' }
```

```
$ snapback4 check
check: ok — 2 tables (0 synced), 3 operations, no problems
$ snapback4 run open --as alice      # state: sent
$ snapback4 run tick                 # state: parked, rowsWritten: 0
$ snapback4 run tock                 # state: parked, rowsWritten: 0
$ snapback4 doctor
  job tock … Parked: 0 chunks, 0 rows … — E_INPUT: E_INPUT: activity.actor cannot carry the reserved system principal
  job tick … Parked: … — E_INPUT: E_INPUT: activity.actor cannot carry the reserved system principal
```

(The doubled `E_INPUT: E_INPUT:` in the stored run error is a separate papercut.)

## Why this is not fixed in the periphery

The runtime refusal is `snapback4-core/src/engine/validate.rs`
(`contains_system_principal` in `validate_column`/`validate_arg`). The binder
already knows both shapes: it refuses a `'system'` literal in action rules
(`bind/actions.rs` `rule`) and in `as` (`bind/program/job_reads.rs`
`E_JOB_VIEWER_PRINCIPAL`), and it knows `caller_kind == Job` and whether a
write is inside an `as` scope. A refusal in the `check` verb over the bound IR
would duplicate that knowledge without source sites and would not reach the
language's own tests, so it belongs in the binder (lead session).

## Proposed fix (binder)

At a write (insert/update/upsert/write-target patch) of a `principal` (or
`principal?`) column, refuse with a site and repair when the value is

1. the literal `'system'` in any operation, or
2. `viewer` in a job outside an `as recipient.principal:` scope (a job's viewer
   is the system principal),

for example `E_SYSTEM_PRINCIPAL_WRITE: activity.actor cannot store the
reserved system principal; a job runs as the system` with rewrite
`make the column optional and write null for system events (actor: principal?),
or name a service principal ('service:reminders')`. Add the code to
`guide::CODES` and a sentence under "Jobs run as the system principal" in
`guide jobs`. Values that flow through locals or arguments can stay a runtime
refusal.
