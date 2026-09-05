# LLP 1016: The administrative plane — jobs, schedules, and the operator seat for bounded data programs

**Type:** RFC
**Status:** Draft — revision (a) with the five decisions ruled and an
implementer and dates (§9, §10); **in implementation** since 2026-09-05
(author ruling: implement now, ahead of the loop bar; the trade is in
`rules/NOT-DOING.md` §Moves). Binds lane by lane as each lands
(`rules/RULES.md`: only implemented specs bind).
**Systems:** `snapback2/packages/compiler` (the Quarry front end: `job`,
`chunk`, `schedule … at`, `schedule … every`; the `system` rule word
removed), `snapback2/crates/snapback2-core` (the operator execution
context, system visibility, `_jobs`, `_timers`, the chunk and timer engine
writes, successor narrowing), `snapback2/crates/snapback2` (the writer's
turn policy, `run --file/--wait/--plan/--dry-run/--cancel/--resume`, `trace
<job>`, the rehearsal runtime, `/control/jobs*`, `/control/timers`),
`snapback2/packages/snapback2` (guide recipes `job` and `schedule`; the
`chat` template's `notifications` rules and disappearing messages),
`snapback2/packages/evaluator` (unchanged: nothing here runs on the twin),
`rules/NOT-DOING.md`
**Author:** Claude Fable 5.1, commissioned by Charlie Cheever 2026-09-05 in
session, on a criticism made by a separate reviewing session the same day;
revision (a) written at the author's instruction to take the panel's
feedback into account with the orchestrator's own judgement
**Date:** 2026-09-05
**Revised:** 2026-09-05 (a.1 — the five decisions ruled, the author having delegated them to the orchestrator; implementer, lanes, and dates written; the loop-bar sequencing overridden by author ruling); 2026-09-05 (a — the panel folded: one authority model for the
system principal and the `system` rule word deleted; the job is a sequence
of sweeps over immutable keys under a captured upper key, with cursor and
progress as certified engine writes; narrowing moved to successor
application; `every <duration>` on a system-owned timer row; schedule
targets may be jobs; the continuation statement, the derived erasure, the
`erased` principal, the `_commits` edits, and job SSE deleted; the writer's
turn policy specified; the rehearsal runtime specified; §0's fourth hat
corrected; author decisions reduced to five); 2026-09-05 (panel record
added); 2026-09-05 (initial)
**Related:** LLP 0329.014.004 §2 (dimensions B and I) §2.1 L (sealed
operation authority: system visibility) §5 ("computation under system
visibility by a `schedule` or a system continuation") §6 (the `schedule`
and `job` kinds) §9 (open question 3), LLP 0329.016 §5.1 (P4, P5, P10)
§5.10 §5.11, LLP 1000, LLP 1001 §1 (system tables) §2 (what a commit
records) §4 (successors; engine-owned writes are exempt from rules and
never from constraints) §6 (the reserved principal) §8 (`emit`), LLP 1002
§4 §5 (the one writer thread; `/control/clock`) §6, LLP 1003 §2 (the
outbox lifecycle; the `then` ruling this supersedes when implemented) §4,
LLP 1006 §9, LLP 1007 §7 (the ruled `fork` deletion this executes), LLP
1010 A5, LLP 1011 B1, LLP 1012 §3 §5, LLP 1014 §3.5, LLP 1015 D1 D6 D10
(the finding in §12 is for it) D13, `rules/RULES.md`,
`rules/NOT-DOING.md`, `snapback2/packages/snapback2/guide/quarry.md`;
`llp/reviews/1016-administrative-plane.panel.synthesis.md` and the six
review artifacts beside it

## Summary

A reviewing session read Snapback 2 on 2026-09-05 and put its objection in
one paragraph:

> What's structurally missing is one thing wearing four hats: there's no
> administrative plane. No data backfill (successors add columns
> optional-only; `for` is too bounded to iterate a table). No scheduled work.
> No bulk delete or repair — GDPR erasure is inexpressible. No fan-out past
> ~50. All four are blocked by the same property that produces the
> guarantees. That's not a missing feature, it's the shape of the design, and
> it's the thing I'd want an answer for before betting on it.

The diagnosis is right and the conclusion is wrong. The property that
produces the guarantees is that **every transaction is a certified bounded
program** — examined rows, rule probes, steps, and written rows are numbers
the certificate proves before the transaction starts (`certificate.rs`:
10,240 examined, 2,048 written, a million steps by default). Nothing in that
property says a *task* must be one transaction. The administrative plane is
therefore a **driver over certified programs**, not an escape from them:
one new kind, one filled-in kind, one seat, and nothing outside the
language. Three families reviewed the first draft and endorsed exactly
this direction while rejecting half of what the draft hung on it (§12);
this revision is the kernel they would commission, decided rather than
averaged:

1. **The system principal is the store's owner.** A program executing as
   `system` — a declared job, a schedule's target, an effect's `then`, the
   seed, or the operator at the keyboard — **reads every row and writes
   under constraints, unique indexes, immutability, maintains, and the
   certificate, never under viewer rules.** Rules govern viewers; the owner
   is not a viewer. This is one model where the first draft had three, it
   is what the design RFC already calls system visibility, and it deletes
   the `system` rule word, which under this model could only ever mean
   `deny`.
2. **A `job` is a sequence of sweeps.** Each `chunk` block walks one index
   whose key columns are `id` or declared immutable, under an upper key
   captured when the sweep starts, `N` rows per commit; the cursor and the
   progress row are certified engine writes inside that commit, so a chunk
   is done exactly once or not at all. The job's size is unbounded; every
   step is a bounded program.
3. **Expand, fill, contract is the migration path.** A successor that
   narrows `T?` to `T` is admitted when no stored row is null and is
   otherwise refused, at application, with the count and the fill job
   pasted. Renames and retypes are add, fill, drop.
4. **The `schedule` kind fires on the owner's own clock**: `on table at
   .column` for row timers, `every <duration>` for periodic work on a
   system-owned timer row, both settled and re-armed in the firing's commit,
   targeting a mutation or a job. The benchmark's disappearing messages and
   daily digest are its first two customers.
5. **The CLI is the plane.** No new verb: `run` gains `--file`, `--wait`,
   `--plan`, `--dry-run` (a rehearsal runtime over a snapshot), `--cancel`,
   and `--resume`; `trace` accepts a job or a timer. The operator seat is
   `--as system` locally and an `admin` token hosted, through a
   purpose-specific engine entry, every action a ledger row. The console
   comes later on the same routes.

Deleted from the first draft, on the panel's evidence and the
orchestrator's agreement: the `enqueue` continuation and the `send` rewrite
(the benchmark caps groups at fifty and fans feeds in at read); erasure as
a derived kind (a scrub to one `erased` identity is refused by `immutable`
and collides on `unique` on the template's own tables, and no derivation
can see refs, JSON, maintains, custody tables, or rows hidden on devices);
the static authority proof (moot under decision 1); edits to `_commits`;
job SSE; cross-stage bindings; calendar syntax. Erasure and fan-out are
§2 D7: authored compositions of the kernel, with the honest limits named.

## 0. The four hats, corrected

| Hat | Where it is refused today | What this RFC does |
| --- | --- | --- |
| **Backfill** | `for` iterates only a bounded page (`guide/quarry.md` §Absence and bounds); a new column on a populated table must be optional (`E_SUCCESSOR_COLUMN_REQUIRED`, LLP 1001 §4); `Optional(T) → T` is a `Drop::TypeChange` that drops values (`successor.rs:164-168`). | D2 (the sweep) and D4 (narrowing). One correction to the first draft: a **maintained** column needs no job — a successor already rebuilds every maintain over all source rows in its own transaction (`successor.rs:648-672`), which is how the benchmark's M7 "backfilled message count" is met. Jobs are for columns the engine does not derive. |
| **Scheduled work** | `schedule` is refused with the rewrite "use a caller-invoked mutation" (`guide/quarry.md` §Refused platform gaps); disappearing messages purge from the client "because the server has no clock of its own" (LLP 1012 §3); the benchmark's M8 digest requires emission "driven by the schedule alone … no connected client" (`benchmarks/briefs/social-messenger.md:757-760`), which nothing today can do. | D5. |
| **Bulk delete, repair, erasure** | Writes are one row per key; `_` tables are reachable only through verbs; nothing runs as the owner except the seed. | D1 (the seat), D2 (sweeps), D6 (ad hoc programs). Erasure is an authored job whose limits this RFC names (D7); a completion contract for it is a later document. |
| **Fan-out past ~50** | The mutation machine commits regardless of a `Limit`-stopped page (`engine/mod.rs:708`), so a `for … first 50` fan-out is silent past fifty. **But** the template refuses a fifty-first member (`templates/chat/snapback/groups.q:16`, `GROUP_FULL`), the benchmark's groups are 2–50, and its 900-follower celebrity is a read-side `merge` (LLP 1010 A5). | Not a bar gap; not built. D7 shows the composition (a row, a schedule, a job) that serves it when a brief asks. |

The property behind all four: `Ceilings` bound one execution; the
certificate proves the program under them before it runs. That is what
makes the trace complete, OCC sound, receipts honest, and the twin small.
None of those facts is about a task. They are about a transaction.

## 1. What this RFC is counterweighted by

`rules/RULES.md`: moving something onto the doing-list takes something off.
`rules/NOT-DOING.md` already carries "one `schedule` kind"; this RFC adds
the `job` kind and the operator seat. It pays, first, with deletions of
existing surface:

| Deleted | Why |
| --- | --- |
| **The `system` rule word** (`guide/quarry.md` §Rules; `lower/schema.ts:364`). | Under D1 the system principal never consults rules, so `insert <- system` means exactly `insert <- deny`. The template's one use (`schema.q:123-124`) becomes `deny`. A word that can only mean another word is deleted, not deprecated. |
| **The client-invoked `purgeExpired` recipe** (LLP 1012 §3, §12). | D5's row timer is the server's clock; the client-side trigger and its journey step go. |
| **The `fork` CLI adapter** (`verbs.rs:242-254`). | LLP 1007 §7 ruled it deleted; it is still in `main.rs`. The snapshot primitive stays (`test`, previews, and D6's rehearsal use it) and `POST /control/fork` stays a dev route; LLP 1015 D1's table is amended. |
| **`persona create`** (`verbs.rs`, `POST /control/persona`). | Personas are created on first use (LLP 1002 §4); `persona list` folds into `dev --status`. |

Second, with refusals — what the field builds and this RFC will not:

| Not building | Why |
| --- | --- |
| A jobs framework: priorities, worker pools, retry policies, dead-letter queues. | A rejected chunk parks with its refusal; retrying a certified program that was *rejected* is retrying a fact. The outbox keeps the one retry policy the product has, for I/O (LLP 1003 §2). |
| A cron service, crontab syntax, calendar or time-of-day syntax, `cron` verbs. | One kind, two triggers, one duration. What "cron" on `NOT-DOING.md` forbids is a service (§9.2). |
| A raw write path: SQL, `data set`, CSV upload, an admin API that skips constraints. | "No write path exists outside the language" is what makes every constraint trustworthy. Repair is a Quarry program (D6). |
| A second admin language, a migration file format, a `migrate` block on the successor. | Quarry has bounded `for`; a job is that loop across commits. |
| A second admin API or catalog. | `/control/*` is the one table (LLP 1015 D1). |
| A derived erasure program, a coverage checker, a tombstone identity. | §12 and D7: derivation cannot see what erasure must reach; an authored job with named limits is honest now, and a completion contract is its own document. |
| A continuation statement in mutations. | D7: the composition of existing kinds does the job when a brief asks; no new write site, nothing on the twin. |
| Bulk import. | LLP 0329.014.006 S3.10: asset plus job; needs the assets slice. |
| A browser console, in this RFC. | LLP 1015 D13's ruling; D8 here. |

Nothing here adds a blocking check, a script, a registry, or a config file.
Two guide recipes (`job`, `schedule`) replace the refused-`schedule`
sentence and the purge recipe.

## 2. Decisions

"Owner" is the running `snapback2` process that owns a store (LLP 1002 §5);
"the writer" is its one thread that holds the `Runtime`; "system" is the
reserved principal (LLP 1001 §6); "a turn" is one unit of the writer's
work — a client action with its post-commit live reruns, one timer firing,
or one chunk.

### D1 — The system principal is the store's owner

**Reads.** A program executing as `system` reads every row. Rule
evaluation is skipped for that principal at every read site — point, range,
`exists`, `merge`; the trace still records every row and range touched, so
invalidation and the ledger are unchanged. Today the engine filters the
system principal like any viewer (no exemption exists in `runner.rs`,
`runner_ops.rs`, `visibility.rs`, or `certificate_policy.rs`; a hoisted-false
rule halts a scan as exhausted and empty, `runner.rs:1099`), which is why a
job with write authority on `messages` would otherwise scan zero rows
through `read <- exists memberships[.conversationId, viewer]` and finish
green. The design RFC already names the intended semantics — "computation
under system visibility" (LLP 0329.014.004 §5) and "sealed operation
authority: scoped system reads whose only disclosure is declared writes"
(§2.1 L). This RFC implements the first and keeps the second as the
non-disclosure rule: nothing a system program reads is served to a client
except through its declared writes.

**Writes.** A program executing as `system` writes under constraints,
unique indexes, `immutable`, `appendOnly`, transitions declared as
constraints, maintained deltas, and the certificate's write ceilings —
exactly the set that already binds engine-owned writes (`runner_ops.rs:295-297`:
"aggregate writes bypass user insert/update/delete rules but never
constraints or unique indexes"; LLP 1001 §4 for the seed). Viewer rules —
`read`, `insert`, `update (old, next)`, `delete` — are not consulted.

**Who executes as `system`.** Declared jobs (D2), schedule targets (D5), an
effect's `then` (LLP 1003 §2), the seed, and the operator seat (D6). Nothing
a client can call. There is no `or system` on any rule and no way to grant
a viewer the seat: the confused-deputy shape the first draft invited is not
expressible.

**The `system` rule word is deleted.** With rules never consulted for the
system principal, `insert <- system` and `insert <- deny` are the same
predicate for every principal that reads rules. The word goes from the
grammar, the lowering (`lower/schema.ts:364`), the reference page, and the
template (`schema.q:123-124`, the `notifications` table written by `then`,
becomes `insert <- deny` / `update <- deny`). Diagnostic: `E_QUARRY_UNSUPPORTED`
names the word with the rewrite `deny`.

**Consequences for other documents, when this lands.** LLP 1003 §2's
ruling that `then` "runs as the system principal under the ordinary table
rules" and needs `insert: rule.system()` on its table is superseded: `then`
is a system program like any other. LLP 1015 D10's `data --env production`
and `run --env production` as the system principal finally mean what that
document assumes; today they would see nothing on a membership-gated
table.

**The alternative, recorded.** Two panelists (astra, Muse) preferred to keep
declared jobs under the tables' rules with a conservative three-valued
proof at `check` and to add system visibility only for reads; their
argument is that `(old, next)` transition rules encode policy an operator
should not silently bypass (`schema.q:48`). The orchestrator's judgement:
those rules encode policy for *viewers'* intents; the operator is the
author of both the rules and the job, in one file, under `check`, on the
ledger; and the alternative needs `or system` grants on every table a job
touches, which one panelist (grok) showed admits every system writer at
once. One model, no grants, one deleted word. The author may veto (§9.1).

### D2 — A job is a sequence of sweeps

```q
job fillAvatars:
  chunk p in profiles first 100 by byId:
    update profiles[p.id] { avatarUrl: p.avatarUrl ?? 'https://cdn.example.com/default.png' }
```

- **Shape.** `job name(args):` followed by one or more `chunk` blocks, in
  order. Nothing else: no plain statement stages, no bindings that cross a
  block (a job that needs a value across sweeps reads it again). Args are
  job-wide, typed like a mutation's, validated when the job is enqueued,
  and may appear in a chunk's prefix.
- **The sweep.** `chunk x in table[prefix] first N by index:` is a bounded
  `for` whose range continues across commits. The index's key columns —
  the prefix and the suffix that orders the sweep — must each be `id` or a
  column the table declares `immutable`; otherwise `E_JOB_CURSOR_INDEX`
  (rewrite: `immutable <cols>` on the table, or `by byId`). This is the
  stability property stated once as a schema fact: no concurrent write can
  move an unvisited row across the cursor, because nothing can change its
  key (`runner_ops.rs:126` reindexes a row on update; a key that cannot
  change is never reindexed). The template's `deliveries` and
  `memberships` already declare it; `messages` gains `immutable
  conversationId, authorId` in the same landing.
- **The captured upper key.** When a sweep starts, the engine records the
  last key under the prefix. The sweep visits rows with key ≤ that bound,
  in index order, `N` per chunk, reading current values; a row inserted
  beyond the bound is never visited, so a body that inserts into its own
  table cannot make the sweep endless; a row inserted between the cursor
  and the bound is visited; a row deleted before the cursor reaches it is
  not. A chunk that returns fewer than `N` rows with the bound reached ends
  the sweep. This is the honest replacement for the design RFC's "sealed
  inputs": the store keeps current rows only (`store.rs:148`), so no
  watermark can reconstruct a start-of-sweep image, and the RFC does not
  claim one.
- **Every chunk is a certified program, plus two engine writes.** The
  compiler certifies the body exactly as a mutation whose `for` bound is
  `N`. The engine adds, inside the same transaction, the `_jobs` progress
  update (cursor, chunk count, rows written) and — for the last chunk of a
  sweep — the stage advance. These are certified as `engineWrites: [_jobs]`
  on the job's certificate, counted like `Emit`'s `_outbox` write
  (`runner_ops.rs:363-374`), and the job's certificate carries `kind: job`,
  `sweeps[{ table, index, prefixTemplate, take }]`, and `chunks: unbounded`.
  Because progress commits with the rows, a crash between "wrote the rows"
  and "advanced the cursor" cannot exist: a chunk is wholly done or not
  started. Exactly-once per chunk on one owner is a fact of the commit, not
  a retry policy.
- **Clocks.** `now` is the commit clock, pinned per chunk. A job that needs
  one instant across a sweep takes it as an argument.
- **Failure.** A chunk that is `Rejected` — a constraint, a ceiling, an
  `E_INPUT` — **parks** the job with the refusal envelope; the chunk's
  writes roll back, the cursor does not move, `trace` shows the refusal on
  the chunk that hit it. `run --resume` re-runs that chunk (after the author
  fixed whatever refused it, which arrived as a successor). `run --cancel`
  ends the job at the next boundary; cancel is terminal and the rows
  already written stay. A job is not a transaction and never claims to be;
  a half-run fill leaves an optional column optional, which `check` and
  D4 can see.
- **Identity and succession.** `_jobs` binds the job's `program_hash` (the
  certified plan hash), the generation hash, and the arguments. When a
  successor is applied, every running or queued job is paused and its
  program looked up in the new generation: same `program_hash` → continue;
  a changed body, a missing job, or a changed sweep index → **park** with
  `E_JOB_GENERATION` (rewrite: `run --cancel` and start again, or restore
  the declaration). Nothing runs a changed program from an old cursor
  (`registry.rs:93`: generation identity is the schema's; program identity
  is separate and must be bound explicitly). An ad hoc job (D6) stores its
  source in `_jobs.source` and parks on any succession.

This answers LLP 0329.014.004 open question 3 as **chunked mutation**. It
also answers the first draft's own overreach: the kind was defined there
with stages, cross-stage state, and continuation; the panel showed each
of those either had no bar customer or hid a semantic the engine cannot
keep. A sequence of independent sweeps is what backfill, purge, digest,
and erasure actually are.

### D3 — The driver

| `_jobs` | `id TEXT PK, name TEXT, source TEXT NULL (ad hoc only), program_hash TEXT, generation TEXT, args TEXT(JSON), state TEXT (queued \| running \| parked \| done \| cancelled), sweep INTEGER, upper_key TEXT(JSON), cursor TEXT(JSON), chunks INTEGER, rows_written TEXT(JSON per table), enqueued_by TEXT (a persona, a token id, 'timer:<id>'), created_at, updated_at, finished_at INTEGER, last_error TEXT(JSON)` + index on `(state, created_at)` |
| --- | --- |

- **One writer, one turn policy.** The writer loop (`writer.rs:439-480`)
  serves one client action per turn, and each committing action runs its
  live-query reruns before the turn ends (`writer.rs:1097-1133`), so the
  latency unit is the whole turn, not the SQLite commit. The policy: after
  serving a client action, if the channel is empty **or** eight client
  turns have passed since the last background turn, the writer takes one
  **background turn**: fire due timers, at most 64 (D5), then run one chunk
  of the head job. Under continuous client load a job therefore advances at
  least one chunk per nine turns; when idle it runs back to back. No
  operator pacing flag; the author-declared `first N` is the knob, examples
  use 100, and §8 measures the turn.
- **One operator job at a time.** `_jobs` is a FIFO; the head runs, the
  rest wait; `run` prints the queue position and returns unless `--wait`.
  Schedule-enqueued jobs join the same queue (D5).
- **Restart.** A `running` row at owner start is set back to `queued` with
  its cursor; the chunk in flight never committed. **`reset`** clears
  `_jobs` with the data it clears; a snapshot carries `_jobs` like every
  table.

### D4 — Expand, fill, contract

1. **Narrowing is admitted when it is true, at application.** A successor
   that changes a column from `T?` to `T` is classified as *additive* when
   no stored row holds `Null` there and an absent field counts as null;
   otherwise it is refused `E_SUCCESSOR_NARROWING { table, column,
   nullRows, sample: [≤ 10 ids] }` with a rewrite that is the fill job:

   ```q
   job fill_profiles_avatarUrl:
     chunk p in profiles first 100 by byId:
       update profiles[p.id] { avatarUrl: p.avatarUrl ?? <value> }
   ```

   Three admission paths change (`successor.rs:164-168` classifies the
   type difference as `Drop::TypeChange`; `:196-198` refuses it as
   destructive before `:214-228` ever walks required columns), and the
   walk over stored rows that exists for new columns is reused. **Where
   the refusal appears:** project `check` is static and opens no store
   (`check.rs:393`), so narrowing is judged where successors are applied —
   the owner's watcher on save (`/control/status` shows `refused` with the
   plan and the log carries it, LLP 1002 §5) and `deploy` (LLP 1015 D4,
   "a red `check` is a red `deploy`" extends to a refused application). The
   first draft's transcript put this refusal under `check`; it was wrong.
2. **`E_SUCCESSOR_COLUMN_REQUIRED`'s rewrite names the three steps** —
   declare `T?`, apply, `run fill_… --as system --wait`, declare `T`, apply
   — instead of only "add it while the table is empty".
3. **A maintained column is not a job's customer.** A successor rebuilds
   every maintain over all source rows in its own transaction
   (`successor.rs:648-672`); a fill job over a maintained target would be
   refused like any user write to it. The reference page says so beside
   the fill recipe.

Retypes that are not narrowings stay destructive; the plan's `TypeChange`
line gains the rewrite "add `<col>_2: U?`, fill, drop `<col>`". Renames are
add, fill, drop; there is no rename operation (§9.5).

### D5 — Schedules: row timers and periods, on the owner's clock

```q
schedule expireMessage on messages at .expiresAt:
  purgeMessage(.id)

schedule dailyDigest every 24h:
  digestSweep
```

- **Two triggers, one kind.** `schedule name on table at .column [if
  predicate]: target(args from the row)` fires once per row when `column`
  (a `time ?` column) is reached; `schedule name every <duration>: target`
  fires once per period. A target is a mutation or a declared job of this
  project; a job target takes the row's or period's values as its
  arguments. Durations are `Nm | Nh | Nd`, at least one minute; there is no
  time-of-day, weekday, or calendar syntax (§9.2).
- **The timer index.** `_timers (id, schedule, row_id NULL, at, period_start
  NULL, generation)`, indexed on `at`, is maintained by the engine as an
  index is: a row insert with a present `at` enqueues, an update to a
  different `at` reschedules, an update to `null` or a delete cancels, all
  inside the row's own transaction, all certified as `engineWrites:
  [_timers]` on every program that writes the table. Installing a new `on
  table` schedule populates `_timers` from existing rows in the successor's
  transaction, exactly as a new index is populated (LLP 1001 §4); removing
  the declaration drops its timers; changing its target rebinds them under
  the new generation. An `every` schedule owns one system row in `_timers`
  created at install with `at = install time + duration`.
- **Firing.** On a background turn (D3) the writer takes due timers,
  oldest first, at most 64 per turn, and for each runs **one transaction**:
  execute the target as `system` (a mutation runs to completion inside it;
  a job target is **enqueued** into `_jobs` inside it — a job is many
  commits and can only be started atomically, not finished), delete the row
  timer or re-arm the period timer, and append the ledger row `{ kind:
  "schedule", schedule, occurrence, outcome }`. Because firing and
  settlement are one commit, a crash re-fires, and the **occurrence
  identity** — `(schedule, row_id, at)` for a row timer, `(schedule,
  period_start)` for a period — makes the second attempt a no-op: a job
  target already enqueued or running for that occurrence coalesces; a
  mutation target is expected to be idempotent on its arguments, and the
  reference page says so beside the recipe.
- **Re-arm and missed periods.** A period timer re-arms to `period_start +
  duration`, anchored to the schedule, not to the moment it fired. If the
  owner was down across several periods it fires **once**, for the latest
  missed period, then re-arms; the ledger records the periods skipped. A
  row timer whose `at` is already in the past when it is installed or
  written fires on the next background turn.
- **Rejected targets.** A target that is `Rejected` settles the occurrence
  with the refusal in the ledger row and does not re-fire; `trace
  timer:<id>` and `logs` show it, `dev --status` counts `timers: { due,
  rejected }`, and the operator re-runs the target by hand if it matters.
  For disappearing messages it rarely does: the server already refuses
  expired content at read (the brief's own requirement, `social-messenger.md:565`),
  so the purge is hygiene and the tombstone rows for devices, not the
  enforcement.
- **Lateness is measured.** The certificate records the schedule; the
  metric line records p99 lateness (§8). At-least-once is the claim; "within
  five seconds" is a number, never a promise (LLP 0329.014.004 §2.2 B).
- **Development.** `POST /control/clock` (LLP 1002 §5) advancing past a
  timer fires it on the next background turn; a journey inserts a row with
  `expiresAt: now + 1h`, advances the clock, and asserts the purge; the
  `test` receipt gains `schedules: { fired, late, rejected }`.
- **The two customers.** The `chat` template's disappearing messages become
  a `schedule … at .expiresAt` whose target writes the `expired` log rows
  LLP 1012 §3 describes; the client-side trigger is deleted. The
  benchmark's M8 digest is `schedule dailyDigest every 24h: digestSweep`
  where `digestSweep` is a job with one sweep over `profiles by byId` that
  emits one effect per user with a non-zero count — "driven by the schedule
  alone", restart-idempotent by occurrence, authorized because the sweep
  runs as the owner and discloses nothing but its declared writes.

### D6 — The operator seat, ad hoc programs, and rehearsal

- **The seat.** `Runtime` gains a purpose-specific entry for operator
  execution, beside `execute_then` and `execute_seed`: it constructs the
  system context that no caller can build (`Context::system` is private,
  `engine/mod.rs:57-71`; `Actor::new` rejects the reserved id,
  `identity.rs:69`), executes one program under D1, and appends the ledger
  row `{ kind: "operator", op | source_hash, by, at }`. The CLI spelling is
  `--as system`, admitted on `run`, `data`, and `why` in `dev` mode
  (`system` is not a persona and never becomes one; the flag routes to the
  entry point); hosted, it is an `admin` token (LLP 1015 D6, D10), and the
  ledger's `by` is the token id.
- **Ad hoc programs.** `snapback2 run --file fix.q [args] --as system`
  compiles the file with the same worker, certifies it against the live
  generation through `execute_adhoc` (`registry.rs:762`) **with the same
  admission as a declared program** — the checker today skips
  `Generation::certify`'s effect-target validation (`registry.rs:405`); it
  must not — executes a query, mutation, or job, and ledgers its source
  hash. An ad hoc job persists its source in `_jobs.source` so a restart
  can recompile it; the source is capped at 64 KiB (`E_ADHOC_SIZE`). It is
  never installed and never in the manifest. This is the console: an agent
  writes the repair in the language it knows.
- **`--plan`** certifies and prints: the sweeps, the index-entry count
  under each prefix and the chunk count it implies, the engine writes, and
  the ceilings — the cheap estimate.
- **`--dry-run` is a rehearsal runtime, not a copy.** The owner snapshots
  the store (the `fork` primitive), opens the copy in **rehearsal mode** —
  no effects runner, no timer firing, no asset sweep, no blob mutation
  (releases are reported, not reclaimed), the clock pinned at the snapshot,
  an isolated id allocator — runs the whole job, prints the receipt with
  `dryRun: true` and the effects it *would* have emitted, and deletes the
  copy. A plain copy under ordinary startup would run effects and sweep
  shared blobs (`owner.rs:218`, `writer_assets.rs:57`, `asset_gc.rs:16`);
  the mode exists to make "nothing touches production" true.
- **`--wait`** blocks, prints one line per chunk (`--json`: one envelope per
  line) by polling `/control/job/<id>`, and exits 0 done, 1 parked or
  refused, 2 usage. No streaming route; polling is enough for a CLI.
- **`--cancel <job>` and `--resume <job>`** are operator actions on a run
  and live under `run` as `deploy --token create/revoke` lives under
  `deploy` (LLP 1015 D6): the verb table stays at fifteen.
- **Hosted.** `read` tokens see `/control/jobs`, `/control/job/<id>`,
  `/control/timers`; `deploy` tokens inherit those (LLP 1015 D6: each
  capability is a superset of the last); `admin` tokens run, cancel,
  resume, and submit ad hoc programs over TLS (`POST /control/run`, body =
  source and args, refused over a non-TLS transport like a secret value).
  An `admin` token can already deploy arbitrary programs and run any
  declared mutation as the owner; ad hoc execution adds no authority it
  does not have, only a shorter path, on the same ledger. MCP (LLP 1015
  D15): job status and trace are read tools; `run` of a declared job is a
  write tool behind the explicit flag; ad hoc programs are absent from MCP.

### D7 — Erasure and fan-out are authored compositions

**Erasure.** With D1, D2, and D6, an agent can write the erasure the first
draft tried to derive:

```q
job eraseAccount(who: principal):
  chunk d in deliveries[who] first 200 by byRecipientAt:
    delete deliveries[d.id]
  chunk m in messages[who] first 100 by byAuthorTime:
    update messages[m.id] { body: null, photo: null, clip: null }
  chunk f in follows[who] first 200 by byFollower:
    delete follows[f.id]
```

and run it as the owner with `--plan`, `--dry-run`, and `--wait`. What the
RFC says plainly beside that recipe, because the panel showed each of
these is where a derivation would have lied:

- A `unique` or `immutable` principal column cannot be scrubbed to another
  identity; the row is deleted, or the app declares the column mutable and
  chooses its own tombstone value.
- Rows that name the subject through a `ref`, an id inside `json` or a
  list, or a maintained aggregate are the author's to find; `guide app`
  lists every table and index whose keys mention a principal column, which
  is a map, not a proof.
- Identity is fenced first: the job's first sweep should be over nothing —
  the recipe's first line is `run auth.disable '{"who": …}'`, a declared
  mutation that revokes credentials and fences sessions (LLP 1002 §5), so
  no login recreates a session mid-sweep (`identity.rs:212`).
- What the engine holds beyond tables: `_grants` and replay custody
  (`store.rs:219`), `_outbox` payloads (no principal column, `store.rs:182`),
  assets (released on delete, reclaimed after grace,
  `assets_ledger.rs:355`; snapshots and forks keep bytes), and `_commits`
  (trimmed to 10,000 rows, `engine/mod.rs:1381`; never edited). Each is
  named as residue in the reference page.
- Devices: a deleted row is a point absence on the next fresh receipt that
  names it, and absence evicts (LLP 1012 §5 rule 1); a scrubbed row is
  re-delivered to viewers who can still read it — but a row that is
  *hidden* to a departed recipient is never re-observed (`runner.rs:966`),
  so `retain delivered-history` keeps what that device was delivered. That
  is what the word means (LLP 1012 §5 rule 4), and this RFC does not
  promise otherwise.

A completion contract for erasure — subject selection, an "erasing" state,
custody sweeps, external effects, and residue, each with semantics — is a
later document when a brief asks for it. It will be built on this kernel,
not beside it.

**Fan-out past the bound.** Not built. When a brief needs per-recipient
rows for an unbounded audience, the shape is a composition of what this
RFC ships: the mutation inserts one `broadcasts` row with `at: now`; a
`schedule deliverBroadcast on broadcasts at .at: deliver(.id)` fires; the
`deliver` job sweeps the audience index in chunks. No new statement, no
write site in mutations, nothing on the twin, and the sender's own copy is
written inline so it predicts. Revocation is never deferred this way: the
design RFC's `propagate` (§2.2 E) is for work "no job may defer".

### D8 — Routes, no new verb, no console yet

| Route | Mode | Capability |
| --- | --- | --- |
| `GET /control/jobs`, `GET /control/job/<id>` | dev, serve | read |
| `GET /control/timers` | dev, serve | read |
| `POST /control/job` (enqueue a declared job with args) | dev, serve | admin |
| `POST /control/job/<id>/cancel`, `/resume` | dev, serve | admin |
| `POST /control/run` (ad hoc source and args; TLS) | dev, serve | admin |
| `POST /control/fork` | dev | — (unchanged; the CLI adapter goes) |

`dev --status` and `/control/status` gain `jobs: { running, queued, parked }`
and `timers: { due, next_at, rejected }`. The console, when the author
builds it (LLP 1015 D13), is a static page served by the owner over these
routes: running jobs, timers, `data` as the owner, and a Quarry scratchpad
that runs `--dry-run` first. It adds no route a verb lacks (LLP 1014 §3.5:
no click-only action).

## 3. Day one, as a transcript

```text
$ snapback2 dev
SNAPBACK_URL=http://127.0.0.1:41823
refused E_SUCCESSOR_NARROWING: profiles.avatarUrl is declared `text` but 312 stored rows are null (p_01J…, p_01J…, …)
  rewrite: declare `avatarUrl: text <=2048 format url ?`, apply, then fill it:
    job fill_profiles_avatarUrl:
      chunk p in profiles first 100 by byId:
        update profiles[p.id] { avatarUrl: p.avatarUrl ?? <value> }
  then declare it required and apply again
(serving the previous generation; see `dev --status`)

$ snapback2 run fill_profiles_avatarUrl --as system --plan
job fill_profiles_avatarUrl: 1 sweep · profiles by byId · 100/chunk · 4,118 entries → 42 chunks
engine writes: _jobs · ceilings: examined 200 / written 101 per chunk

$ snapback2 run fill_profiles_avatarUrl --as system --dry-run
rehearsal: 42 chunks · profiles: 4,118 updated · 0 effects · 3.1 s (copy discarded)

$ snapback2 run fill_profiles_avatarUrl --as system --wait
job_01J9… chunk 1/42 · 100 rows · seq 88,412 · 19 ms
…
job_01J9… done · 42 chunks · profiles: 4,118 updated · 2.4 s · operator: alice@dev

$ snapback2 run --file ./fix-handles.q --as system --dry-run
rehearsal: mutation fixHandles: profiles: 3 updated · 0 effects

$ snapback2 run --file ./fix-handles.q --as system
committed seq 88,455 · operator · source 9c1e…

$ snapback2 trace timer:t_01J9…
schedule expireMessage on messages at .expiresAt · row m_… · at 2026-09-06T10:00Z
  fired seq 88,470 · purgeMessage(m_…) committed · late 0.4 s

$ snapback2 dev --status --json | jq .jobs,.timers
{ "running": 0, "queued": 0, "parked": 0 }
{ "due": 0, "next_at": "2026-09-06T03:00:00Z", "rejected": 0 }
```

Every line is a `--json` envelope with the same fields; the text is a
projection of it.

## 4. The grammar delta, on one screen

```
job name(args):                              -- one or more sweeps, in order; runs as the owner
  chunk x in table[prefix] first N by index:  -- key columns are `id` or declared immutable
    …bounded statements…                       -- one commit per chunk; cursor commits with it
schedule name on table at .column [if predicate]: target(args from the row)
schedule name every <Nm|Nh|Nd>: target        -- a system-owned timer row, re-armed on firing
```

Deleted: the `system` rule word (`deny` is its meaning). Refused, unchanged:
`while`, recursion, ambient time, any write outside the language. `for`
keeps its bound; `chunk` is the only loop whose bound is per commit rather
than per program, and it exists only in a `job`.

## 5. The engine delta

- **Execution context.** A system context skips rule evaluation at read
  sites and write sites and keeps everything else (trace, constraints,
  maintains, ceilings, ledger). Constructed only by `execute_seed`,
  `execute_then`, the timer firing, the chunk driver, and the operator
  entry point.
- **Tables.** `_jobs` (D3), `_timers` (D5); both engine-owned and reserved
  (`E_SCHEMA_RESERVED`). `_commits.kind` gains `operator | job | schedule`
  beside `mutation | system | seed` (a store-format change the fence
  allows); `CommitRecord` gains `job: Option<String>` so `trace` can walk a
  job's chunks.
- **Certificate.** `kind: job`, `sweeps[]`, `chunks: unbounded`,
  `engineWrites: [_jobs]` on jobs; `engineWrites: [_timers]` on every program
  that writes a table with a row schedule; `schedules[{ name, trigger,
  target }]` on the schema certificate. The `system` rule term is gone from
  `RuleExpr` lowering.
- **Runtime.** `Runtime::run_chunk(job_id)`, `Runtime::fire_due(limit)`,
  `Runtime::execute_operator(program | source, args)`; `apply_successor`
  gains narrowing admission (D4), `_timers` population for a new row
  schedule, and job re-binding by `program_hash` (D2). A rehearsal-mode
  constructor for the owner over a snapshot (D6).
- **Twin.** Unchanged. Jobs, timers, and operator programs never run on
  the twin; their effects arrive as invalidation and absence.
- **Owner.** The writer's turn policy (D3); the runner tick (LLP 1003 §4)
  wakes it; no new thread.

## 6. What makes it agent-friendly, stated as rules

1. **One language, one seat.** A backfill, a purge, a digest, a repair, and
   an erasure are Quarry programs run as the owner. There is no admin DSL,
   no grant to configure, and no button that does what a program cannot.
2. **`check` refuses what it can see; application refuses the rest, loudly.**
   Key stability (D2), timer columns and targets (D5), and ad hoc admission
   (D6) are refused at `check` with a rewrite; narrowing is refused where
   the store is, with the fill job pasted.
3. **Rehearsal is cheap and real.** `--plan` counts from the index;
   `--dry-run` runs the whole job in a rehearsal runtime and reports rows
   and would-be effects. An agent that cannot see production can still say
   what it will do to it.
4. **Every run is a receipt.** `--wait` turns a long task into one command
   with one JSON receipt and a typed exit code; `trace` reprints it later;
   nothing is a spinner.
5. **Nothing prompts, nothing is silent.** Cancel and resume are flags; a
   parked job says why; a rejected timer is in the ledger; residue is on
   the page. P4 and P5 of LLP 0329.016 §5.1, applied to the slow path.
6. **Resumable by construction, safe to interrupt.** Cursor and rows commit
   together; Ctrl-C, a crash, a deploy, or a cancel leaves a state `trace`
   can name.
7. **The operator seat is explicit and on the record.** `--as system` is
   typed, not ambient; hosted it is a token with an expiry; every action is
   a ledger row `trace` attributes.
8. **The hosted surface is the local one.** The same flags work with
   `--env production` and an `admin` token; MCP gets the read tools by
   default.
9. **Two recipes, CI-executed**: `guide job` (a fill, with the narrowing
   refusal it answers) and `guide schedule` (disappearing messages and the
   digest), inside the "about twelve recipes" budget.

## 7. Diagnostics

Families `job`, `schedule`, `operator`; one code joins `successor`. Each has
a site, a rewrite, and a page.

| Code | Family | When | Rewrite |
| --- | --- | --- | --- |
| `E_JOB_CURSOR_INDEX` | job | a sweep's index has a key column that is neither `id` nor declared immutable | `immutable <cols>` on the table, or `by byId` |
| `E_JOB_GENERATION` | job | parked on succession: changed body, missing job, or changed sweep index | `run --cancel` and start again, or restore the declaration |
| `E_JOB_ARGS` | job | enqueue with arguments that do not type | the job's signature |
| `E_SCHEDULE_COLUMN` | schedule | `at` names a column that is not `time ?` | declare `col: time ?` |
| `E_SCHEDULE_TARGET` | schedule | the target is not a mutation or job of this project, or its args do not match | the target's signature |
| `E_SCHEDULE_DURATION` | schedule | `every` below one minute or not `Nm\|Nh\|Nd` | the form |
| `E_OPERATOR_REQUIRED` | operator | `run <job>`, `--file`, `--cancel`, `--resume` without the seat | `--as system`, or an `admin` token |
| `E_ADHOC_SIZE` | operator | ad hoc source over 64 KiB | declare it as a job |
| `E_SUCCESSOR_NARROWING` | successor | `T?` → `T` with null rows, at application | the fill job |
| `E_SUCCESSOR_COLUMN_REQUIRED` | successor | (existing) | gains the three-step rewrite |
| `E_QUARRY_UNSUPPORTED` | quarry | (existing) the `system` rule word | `deny` |

## 8. Measurements to record

Each lands as a line in `snapback2/metrics/` with the landing that produces
it, with a budget `scripts/measure.mjs --check` can hold:

| Number | Budget |
| --- | --- |
| one background turn: a 100-row single-column chunk, committed, with 50 live subscriptions rerun | 30 ms |
| a 100,000-row fill end to end, clients idle | 60 s |
| client mutation p95 while a fill runs under continuous sends, relative to idle | ≤ 2× |
| the digest sweep over 1,000 profiles, one effect each | 5 s |
| row-timer lateness, p99, owner busy | 1.5 s |
| `--dry-run` overhead beyond the job itself, 100 MB store | 3 s |
| `check` on the chat fixture with two jobs and two schedules | under the 1 s product latency |
| bytes added to the binary | recorded, no budget |

## 9. Author decisions — ruled 2026-09-05

The author delegated all five to the orchestrator on 2026-09-05 ("make the
best decisions you can on the five decisions and implement this"). Each is
ruled as the text already takes it; the alternative stays recorded so a veto
has a name.

1. **The authority model (D1).** Ruled: the system principal is the owner —
   total reads, constraints bind, viewer rules do not apply, the `system`
   rule word deleted. Alternative (astra, Muse): jobs under the tables'
   rules with a conservative three-valued proof, plus system visibility for
   reads only. Veto restores the word and the proof and adds `or system`
   grants per table.
2. **The word `every` (D5).** Ruled: `every <Nm|Nh|Nd>` is one duration on
   the one schedule kind and is inside `rules/NOT-DOING.md`'s line, which
   forbids a cron *service*; the benchmark's M8 needs it. Alternative:
   period timers exist only as a system-owned row the app re-arms with its
   own mutation — the same mechanism with the sugar removed. Veto removes
   the word, not the mechanism.
3. **Hosted ad hoc programs (D6).** Ruled: yes, under an `admin` token over
   TLS, persisted, size-capped, off MCP; the panel was 2–1. Until LLP 1015
   H0 lands token admission, `POST /control/run` admits the loopback control
   secret only, like every other route. Alternative
   (grok): local `--file` only. Veto deletes `POST /control/run`.
4. **What comes off the doing-list (§1).** Ruled as the trade: the `system`
   rule word, the client-invoked purge recipe, the `fork` CLI adapter, and
   `persona create`. The author adds the lines to `rules/NOT-DOING.md` when
   commissioning; the honest note is that these are small, and the real
   payment is what §12 lists as cut from the first draft.
5. **Rename (D4).** Ruled: no rename operation; add, fill, drop. Reopen
   when a brief's migration count makes three steps a measured cost.

**Sequencing (author ruling 2026-09-05): implement now.** The loop-bar
sequencing of revision (a) is overridden by the author's instruction to
implement; `rules/NOT-DOING.md` §Moves records what unblocks and what comes
off. The panel's point stands as a fact, not a gate: the narrowing change
is not `check`-only, and M7 does not need it.

## 10. Lanes

Implementer: **codex `gpt-6-astra` (xhigh)** per the standing roster,
orchestrated, reviewed by two blind families, and landed by Claude Fable
5.1. Dates are targets; a lane that slips returns here. Four lanes (J1 is
split in two so each codex run stays small), each behind `scripts/test.sh`
and the measured loop:

| Lane | Worktree | Target |
| --- | --- | --- |
| J1a — the seat and narrowing | `~/projects/snapback-s2-c`, `s2/admin-plane` | 2026-09-05 |
| J1b — jobs | `~/projects/snapback-s2-pay`, `s2/admin-jobs` (from J1a's tip) | 2026-09-06 |
| J2 — schedules | `~/projects/snapback-s2v`, `s2/admin-schedules` (from J1b) | 2026-09-06 |
| J3 — rehearsal and routes | `~/projects/snapback-s2`, `s2/admin-rehearsal` (from J1b) | 2026-09-06 |


- **J1a — the seat and narrowing.** D1 (system visibility, the operator
  entry, `--as system` on `run`/`data`/`why`, the `system` word deleted,
  the template's two rules to `deny`, LLP 1003's `then` under the new
  model, `_commits.kind = operator`) and D4 (narrowing at application, the
  pasted fill, the three-step rewrite).
- **J1b — jobs.** D2 and D3 (`job`/`chunk`, `_jobs`, the engine writes,
  the turn policy), `run <job>`, `run --file`, `--wait/--plan/--cancel/--resume`,
  `trace <job>`, `/control/jobs*`, the `job` recipe, `immutable` on the
  template's `messages`, the `fork` adapter and `persona create` deleted,
  LLP 1015 D1 amended. **First demonstrations:** a crash-resumable fill during
  continuous chat sends, measured as whole turns; the same fill parked by a
  constraint and resumed.
- **J2 — schedules.** D5 (`_timers`, `at`, `every`, job targets, occurrence
  identity, re-arm, the dev clock), the template's disappearing messages
  moved server-side and the client trigger deleted, the digest sweep as a
  fixture, the `schedule` recipe. **Demonstration:** expiry firing with both
  clients closed; the digest firing once after a simulated two-day outage.
- **J3 — rehearsal and hosted.** The rehearsal runtime behind `--dry-run`,
  the routes under LLP 1015's tokens, `POST /control/run`, the MCP rows —
  folded into LLP 1015's H3 when both exist.

## 11. Non-claims

This RFC does not accept itself, does not change `rules/NOT-DOING.md` (it
proposes §1's deletions and refusals for the author to add when
commissioning), does not amend LLP 0329.014.004 (it answers open question 3
and cites the rest), does not amend LLP 1003 or LLP 1015 (it names what
changes in each when this is implemented), does not build or promise a
console, and does not claim GDPR compliance or any erasure completion: it
claims that an authored erasure job runs as the owner, is receipted, and
has its limits written beside it. It moves nothing on the media, offline,
or observability slices, and changes no Snapback 1 status.

## 12. Panel record

**The first draft (2026-09-05, initial)** was reviewed at `6d3d09c6f` by
three families under the LLP 0005 loop — codex `gpt-6-astra`, Muse Spark,
grok-4.6 — mutually blind in round 1 and in a cross-read discussion in
round 2, on the question "are you happy with this RFC, or should the
design go in a different direction?" The verbatim record is
`llp/reviews/1016-administrative-plane.{astra,muse,grok}.md`, the two briefs,
and the orchestrator's synthesis `1016-administrative-plane.panel.synthesis.md`,
in which every engine claim was verified against the tree.

**Verdict, both rounds, three of three: NOT READY; the direction is
right.** No panelist chose a different direction; each refused the
unbounded operator mode and the product boundary on the record. All three
asked for a thinner RFC of the same driver.

**What revision (a) took, unanimously found:** the cursor and timer
bookkeeping are engine writes the certificate must carry (Muse; grok raised
it to blocking); the sweep is `byId`-or-immutable over a captured upper key
with no sealed-input claim (astra, grok); program identity is bound
separately from schema identity (astra); the writer needs a turn policy,
not "when idle" (all three); `--dry-run` needs a rehearsal runtime (astra);
narrowing is refused at application, not `check` (astra, grok); M7's count
is a maintain rebuild (grok); the silent fifty is unreachable in the
template (grok, astra); `--as system` is an entry point, not a persona
(grok, astra); the benchmark's M8 digest requires server-side recurrence
(grok; astra changed its mind on it); `enqueue` and the `send` rewrite go
(all three by round 2); the derived erasure, the `erased` identity, and the
`_commits` edits go (all three by round 2); job SSE goes; `deploy` tokens
inherit `read`; the lane count, the flag count, and cancel-versus-resume
wording.

**Where revision (a) decided rather than averaged:** the authority model
(D1: the owner reads everything and writes under constraints; the panel
split 2–1 the other way, and §9.1 records the alternative); schedule
targets may be jobs (astra's position, against grok and Muse); `every` ships
(grok and, by round 2, astra and Muse on the mechanism); hosted ad hoc
programs ship under `admin` (astra and Muse against grok); nothing precedes
the loop bar (astra against grok and Muse).

**A finding for LLP 1015:** D10's `data`, `why`, and `run --env production`
as the system principal assume the visibility D1 introduces; on the engine
as it stands an `admin` token reading production sees nothing on a
membership-gated table.

**Proposed next step:** a short blind READY check on this revision from two
families, then the author's rulings on §9, then commissioning after the
loop bar.
