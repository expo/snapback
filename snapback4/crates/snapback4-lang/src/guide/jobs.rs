//! The jobs card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Jobs and schedules: the server's own work, on its own clock

For a replay mode that must not emit notifications, run `snapback4 dev --replay`.
New emits are counted as `suppressed` by `doctor`, with no queued payload:
they are never delivered, including after restarting with or without `--replay`.
Mutations and explicitly run jobs keep their writes, results and meters.
Replay holds schedule admission; restart without it resumes at the next
boundary, skipping held periods. Already queued jobs still run, with their
new emits suppressed. Effects queued before replay keep their ordinary lifecycle.

`--hold-effects` only pauses worker claims: effects stay durable and become
claimable after restarting without the flag. `--hold-schedules` only holds
schedule admission, skipping held periods on restart. Use `--replay` when
new effects must never be delivered; use the effect hold to keep them queued.
The suppression policy stays on the dev store for local `run` invocations
until the next host start; a restart without `--replay` restores normal
emission for new writes and keeps the count. `serve` and release commands
refuse `--replay` with E_REPLAY_DEV_ONLY; production always emits normally.
With `--fresh`, the count dies with the in-memory store; `doctor` and local
`run` inspect the separate on-disk store.

Jobs in `snapback/jobs.q` are named `jobs.<name>` even in that file's schedules;
`schema.q` jobs use their bare names. `check --fix` qualifies an unambiguous bare module job.
Effects are global declarations shared by every file; jobs are module-qualified
operations. The worker dispatches by the declared effect name, while schedules
and `run` address an operation. If `digest.q` declares `effect notify` and
`job daily()`, write `emit notify { ... }`, register `effects: { notify: ... }`
in the worker, and schedule `digest.daily` (`schedule dailyDigest every 1d: digest.daily`).

```quarry
table invites:
  inviteeId: principal
  sentAt: time
  reminded: bool
  by byInvitee: inviteeId, id
  read <- .inviteeId = viewer
  insert <- deny
  update <- deny
  delete <- deny

job remind(periodStart: time, periodEnd: time):
  end = periodEnd                                    -- a read-only prelude, repeated before every chunk
  chunk i in invites first 100 by byId:                -- one page per commit, as the system principal; byId's columns cannot move
    if i.sentAt >= end:
      break                                            -- ends this sweep; `return` ends the job
    if not i.reminded:
      update invites[i.id] { reminded: true }
schedule remindDaily every 1d at 08:00: remind          -- or `every 2m`, `every 1h`; the shortest period is 1m
```

A job is a sequence of sweeps, optionally preceded by statements. Those
statements run at the start of every chunk under its meter; their bindings
are visible in every chunk. A write belongs to a chunk, never the prelude.
Each `chunk x in table[prefix] first N by
index:` walks one index a page per commit as the system principal (every
rule passes; validation, constraints, aggregates and partitions apply)
under the job ceilings (guide bounds). The cursor commits with the rows, so
a chunk is wholly done or not started and a restart resumes at the next
one; the index's columns are `id` or `immutable`, so nothing moves under
the cursor, and rows inserted past the key captured when the sweep began
are not visited, so a sweep over its own table ends. A refused chunk parks
the job with its refusal (`snapback4 doctor` lists runs). No client calls
a job: a schedule fires it once per period boundary of the server's clock,
exactly once across restarts, passing `periodStart` and `periodEnd` when
the job declares them (and nothing else); a schedule first seen fires from
its next boundary. `snapback4 run <job> '{..}'` runs one here and now.

A schedule may also target an action: `schedule renewal every 1m as service:billing: remind`. The action must declare only `periodStart: time` and `periodEnd: time`, or no arguments. It runs under that service seat and its action rule, never as the system. Jobs cannot declare `as` (guide actions).

In tests, use `snapback4 clock advance <dur>` or `POST /dev/clock/advance`; each example line advances the running dev once.

```sh
snapback4 clock advance 36s
curl -X POST http://127.0.0.1:4400/dev/clock/advance -H 'Content-Type: application/json' -d '{"duration":"36s"}'
```

For development and tests, `snapback4 dev --clock-offset +25h` starts the
server 25 hours ahead of wall time. Mutations at `POST /m/<op>`
stamp `now` from this clock. The clock keeps ticking monotonically;
`snapback4 clock advance 2m [--port N]` moves a running dev forward and waits
for expiry sweeps and queued job chunks to finish. Missed periods fire once,
not once per skipped boundary; `--hold-schedules` still holds admission.
The response reports `now`, `advancedMs`, and work counts (including parked
jobs); if maintenance fails, time remains advanced and the normal tick retries
pending work, so do not blindly repeat the advance. The offset belongs to
this process and resets on restart; supply it again when continuing a test.
Rows stamped under an offset keep their times after restart; use a fresh store per offset test.
An advance extends held effect and action leases, including actions' viewer sessions, by its duration; ordinary sessions and retry times stay put.
Clients receive ordinary row times, nextExpiry and sync deletions; their
own clocks and the application wire do not change.

`snapback4 run <op> --now 1789352669447` pins just that local invocation
(query, mutation or job) to Unix milliseconds; `--now +25h` pins it relative
to wall time. Use an absolute past time to create an old post without a seed.
It does not advance a running host or fire schedules. Durations are positive
whole numbers with `ms`, `s`, `m`, `h`, `d` or `w`, optionally prefixed `+`;
a startup offset may also be negative. Backward/zero advances and invalid
values refuse E_CLOCK_INPUT. `serve` refuses clock flags and the control
endpoint with E_CLOCK_DEV_ONLY. The endpoint is dev-only loopback
`POST /dev/clock/advance` with `{"duration":"+2m"}`.

## Refused jobs and schedules

E_JOB_CURSOR_INDEX means a chunk's scan key can move while the job writes.
For example, a sweep `chunk t in tasks first 100 by byScore:` is unsafe
when `score` is mutable: moving a row could skip or revisit it. Sweep by
`byId`, or declare the index's non-id columns `immutable` when they truly
never change. Keep mutable scores out of the resume key; the chunk cursor
and its writes commit together.

E_JOB_GENERATION means a queued job's definition changed or disappeared
before its next chunk. For example, editing `jobs.rescore` during its sweep
parks the old run instead of running a new body from an old cursor. Inspect
`snapback4 doctor`, check the new definition, and queue the job again with
`snapback4 run jobs.rescore '{}'`. Earlier committed chunks remain, so make
the new sweep safe over the work already done.

E_SCHEDULE means the clock cannot call the named target with its supplied
authority and arguments. For example, `schedule hourly every 1h: summarize`
cannot target a query; target a job, or an action with
`as service:billing`. A scheduled target accepts no arguments or only
`periodStart: time` and `periodEnd: time`. Jobs run as the system and
forbid `as`; actions need a seat their rule admits. Use the qualified
name for a module job, such as `jobs.summarize`.
"##;
