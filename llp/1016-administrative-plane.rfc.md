# LLP 1016: The administrative plane — jobs, schedules, and erasure for bounded data programs

**Type:** RFC
**Status:** Draft — proposal, binds nothing; **panel-reviewed 2026-09-05 (§12): NOT READY as written, direction endorsed by all three families; do not commission from this text** (`rules/RULES.md`: only
implemented specs bind, and a spec needs an implementer and a date; §10 has
neither yet). Sequenced after the loop bar by `rules/NOT-DOING.md`; §9 asks
whether one small lane may precede it.
**Systems:** `snapback2/packages/compiler` (the Quarry front end: `job`,
`chunk`, `enqueue`, `schedule`, `erase`; certification of system authority),
`snapback2/crates/snapback2-core` (`_jobs`, `_timers`, the chunk driver,
successor narrowing, the derived erasure program, the `erased` principal),
`snapback2/crates/snapback2` (`run --file/--wait/--dry-run/--plan/--cancel/
--resume`, `trace <job>`, `/control/jobs*`, `/control/timers`, the owner's
tick), `snapback2/packages/snapback2` (guide recipes `job`, `schedule`,
`erase`; the `chat` template's `send`), `snapback2/packages/evaluator` (the
twin's `Enqueue` no-op), `rules/NOT-DOING.md`
**Author:** Claude Fable 5.1, commissioned by Charlie Cheever 2026-09-05 in
session, on a criticism made by a separate reviewing session the same day
**Date:** 2026-09-05
**Revised:** 2026-09-05 (panel record added, §12: three families, NOT READY ×3, direction endorsed, thinner kernel; revision (a) pending the author's rulings on six splits); 2026-09-05 (initial)
**Related:** LLP 0329.014.004 §2 (dimensions B and I: time is state; jobs)
§6 (the `schedule` and `job` kinds) §9 (open question 3: "`job`: chunked
mutation or schedule continuation?"), LLP 0329.014.006 (F1's schedule/job
row; S3's dispositions), LLP 0329.016 §5.1 (P4 nothing is silent; P5
refusals paste their rewrite; P10 done is a receipt) §5.10 (MCP split by
blast radius) §5.11 (the verb table), LLP 1000, LLP 1001 §1 (the system
tables) §2 (what a commit records) §4 (successors; `E_SUCCESSOR_COLUMN_REQUIRED`)
§8 (`emit` and the outbox), LLP 1002 §4 (the wire) §5 (the owner: one writer
thread, `/control/clock`) §6 (the verbs), LLP 1003 §2 (the outbox lifecycle
this borrows the shape of) §4 (the runner tick), LLP 1006 §9 (asset
reclamation), LLP 1010 A5 (`merge`: fan-in at read), LLP 1011 B1 (opaque
cursors; total indexes), LLP 1012 §3 (the caller-invoked `purgeExpired`) §5
(the four swap rules: absence evicts), LLP 1014 §3.5 (no click-only action),
LLP 1015 (the control plane: tokens, `run --env production`, the operator
ledger row, D13 no console yet), `rules/RULES.md`, `rules/NOT-DOING.md`,
`snapback2/packages/snapback2/guide/quarry.md` §Refused platform gaps

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
property says a *task* must be one transaction. The four hats are the same
hat: work whose size the author cannot bound, composed of steps whose size
the compiler can. This RFC proposes that composition as one kind and three
declarations, and nothing that bypasses the language:

1. **A `job` is a chunked mutation** (answering LLP 0329.014.004 open
   question 3). Its body is an ordinary bounded program run once per
   chunk of an index scan; the owner carries the cursor between commits.
   Every chunk has a certificate, a trace, OCC, invalidation, and a ledger
   row like any commit. The job's size is unbounded; each step's is not.
2. **Jobs run as the system principal under the tables' own rules**, and
   `check` proves the authority statically: a job whose write site's rule
   does not admit `system` is refused at `check`, not at chunk 400.
3. **Expand, fill, contract is the migration path.** A successor may narrow
   an optional column to required when no stored row is null; otherwise it
   is refused with the count and the fill job pasted. Renames and retypes
   are add, fill, drop — three `check`-policed steps, never a silent
   rewrite.
4. **Erasure is declared per table and derived by the engine.** `erase <-
   delete | scrub { … } | keep` on each table that names a principal; a
   reserved `erased` principal for scrubbed rows; one derived job
   (`run erase`) that sweeps declared tables, identity, sessions, assets,
   and the outbox, refuses until every principal-bearing table has declared,
   and reaches devices through the absence rule LLP 1012 §5 already ships.
5. **The `schedule` kind is a row-triggered timer** the engine indexes from
   a `time` column and the owner fires on its existing tick into a named
   mutation or job as `system`, at-least-once under an idempotency key.
   Periodic work is the same kind on a system-owned row; whether that
   crosses the "cron" line on `rules/NOT-DOING.md` is the author's (§9.1).
6. **Fan-out past the bound is a continuation**: `enqueue job { args }` in a
   mutation is one write site on `_jobs`; the job delivers the rest after
   the commit, chunk by chunk, and the mutation's response names it. Feeds
   still fan in at read (`merge`, LLP 1010 A5); continuations are for
   per-recipient rows.
7. **The CLI is the plane; the console comes later on the same routes.**
   No new verb: `run` gains `--file`, `--wait`, `--dry-run`, `--plan`,
   `--cancel`, `--resume`; `trace` accepts a job. Ad hoc programs run
   through the engine's existing `execute_adhoc`, certified against the
   live generation, never installed, ledgered by source hash. The operator
   seat is `--as system` locally and an `admin` token hosted (LLP 1015
   D10), and every operator action is a ledger row.

What is refused is in §1: no jobs framework, no cron surface, no raw write
path, no admin DSL, no second admin API, no console in this RFC.

## 0. The four hats, and the property

Where the corpus refuses each today, so the proposal is measured against
facts rather than the paragraph:

| Hat | Where it is refused today |
| --- | --- |
| **Backfill** | `for` "iterates only a bounded list/page/range/tokens result" (`guide/quarry.md` §Absence and bounds); a new column on a table with rows must be optional (`E_SUCCESSOR_COLUMN_REQUIRED`, LLP 1001 §4); a type change is a destructive plan that *drops the column's values* (`MigrationPlan::TypeChange`). There is no admitted way to write every row of a table. |
| **Scheduled work** | `schedule` is in the refused list with the rewrite "use a caller-invoked mutation instead of a schedule" (`guide/quarry.md` §Refused platform gaps). Disappearing messages are a client-invoked `purgeExpired` "because the server has no clock of its own" (LLP 1012 §3). LLP 1001 and LLP 1003 both defer the kind. |
| **Bulk delete, repair, erasure** | Writes are `insert`, `update table[key]`, `upsert table[key]`, `delete table[key]` — one row per key (`guide/quarry.md` §Programs); `where` was deleted (LLP 1010 A4). `data` reads only; `_` tables are reachable only through dedicated verbs (LLP 1001 §1). Erasing a principal means a program per table that cannot exceed 2,048 writes per commit, with no way to run it again from where it stopped. |
| **Fan-out past ~50** | The reference recipe `send` fans out with `for m in memberships[conversationId] first 50` (`guide/quarry.md` §Effects); the same page admits "at most 50 follow rows" in `followingFeed`. A fifty-first member gets no delivery row, and the commit is `committed` like any other. |

The property behind all four: `Ceilings` (`snapback2-core/src/certificate.rs`)
bound one execution — 10,240 examined index entries, 10,240 rule probes,
1,000,000 steps, 8 MiB heap, 1 MiB output, 2,048 written rows — and the
certificate proves the program under them before it runs. That is what makes
the trace complete (invalidation is exact, LLP 1001 §5), OCC sound (LLP 1012
§7), receipts honest (`receipt ⊆ trace ⊆ certificate`, LLP 1001 §2), and the
twin small enough to ship (LLP 1012 §10). None of those facts is about a
*task*. They are about a *transaction*. A backfill of a million rows as five
hundred transactions of two thousand rows has every one of them, per
transaction, and the field's alternatives — a Rails migration with no
certificate, a cron job with no trace, a `DELETE WHERE` with no receipt —
have none.

So the plane is a **driver**, not an escape: a small piece of the owner that
runs certified programs in sequence, persists where it is between them, and
reports. The language does not change its bounds; it gains one loop whose
iterations are commits.

## 1. What this RFC is counterweighted by

`rules/RULES.md`: moving something onto the doing-list takes something off.
`rules/NOT-DOING.md` already carries "one `schedule` kind" on the feature
list and lists nothing about jobs or erasure; this RFC adds one kind (`job`)
and three declarations. It pays, first, by refusing what the field builds
instead:

| Not building | Why |
| --- | --- |
| **A jobs framework** — queues with priorities, worker pools, per-job retry policies with backoff, dead-letter queues, a dashboard. | A failed chunk parks the job with its refusal; the operator resumes or cancels. Retrying a certified program that was *rejected* is retrying a fact. The outbox already has the one retry policy the product needs (LLP 1003 §2) and it is for I/O, not data. |
| **A cron surface** — expressions, a crontab file, `cron` verbs, a scheduler process. | One `schedule` kind, fired on the tick the owner already has (LLP 1003 §4). What "cron" on `NOT-DOING.md` forbids is a *service*; §9.1 asks the author whether `every` on the same kind is inside the line. |
| **A raw write path** — SQL console, `data set`, `data delete`, CSV upload into tables, an "admin" API that skips rules. | "No write path exists outside the language" is the property that makes every constraint trustworthy (LLP 0329.014.004 §4). Repair is a Quarry program certified against the live generation (D4). |
| **A second language for administration** — a job DSL, a YAML pipeline, a migration file format with its own semantics. | Quarry already has bounded `for`; a job is that loop across commits. One language, one spelling (`rules/NOT-DOING.md`). |
| **A second admin API or catalog.** | `/control/*` is the one table (LLP 1015 D1); the verbs call it, the console later reads it, MCP later projects it. |
| **Bulk import** — a streaming loader, a JSONL ingest engine. | LLP 0329.014.006 S3.10: "asset plus job". A job whose chunk reads a staged asset is the shape; it needs the assets slice first and is not in v1 (§9.7). |
| **A browser console, in this RFC.** | LLP 1015 D13 and its ruling: the agentic API first; the console later, on the same routes, adding none (D12). |

Second, the doing-list trade. Three candidates are offered in §9.8; the
recommended one is executing a deletion already ruled: LLP 1007 §7 deleted
the public `fork` verb ("keep the owner's snapshot primitive; drop the thin
CLI adapter") and the verb is still in `main.rs`. The snapshot primitive
stays and gains this RFC's `--dry-run` as its consumer.

Nothing here adds a blocking check, a script, a registry, or a config file.
The three guide recipes replace the refused-`schedule` sentence and the
`send` recipe's silent fifty.

## 2. Decisions

"Owner" is the running `snapback2` process that owns a store (LLP 1002 §5);
"system" is the reserved system principal (LLP 1001 §6); "the tick" is the
owner's runner wake-up, on every commit with emits and every second otherwise
(LLP 1003 §4).

### D1 — A job is a chunked mutation

```q
job fillAvatars:
  chunk p in profiles first 200 by byId:
    update profiles[p.id] { avatarUrl: p.avatarUrl ?? 'https://cdn.example.com/default.png' }
```

- **Shape.** `job name(args):` followed by *stages* in order. A stage is
  either a `chunk` block or a plain statement block. `chunk x in
  table[prefix] first N by index:` is a bounded `for` whose range continues
  across commits: the body runs for at most `N` rows in one transaction,
  the transaction commits, the cursor advances to the last visited row's
  full key tuple (the opaque cursor of LLP 1011 B1, so the index must be
  total — ending in `id` or unique — `E_JOB_CURSOR_INDEX` otherwise), and
  the next chunk reads `after` it. A chunk that visits fewer than `N` rows
  with the scan exhausted ends the stage. A plain block is one transaction.
  Args are job-wide and may appear in a chunk's prefix.
- **Every chunk is an ordinary program.** The compiler certifies the body
  exactly as it certifies a mutation whose `for` bound is `N`: the same
  ceilings, the same write-site accounting, `E_TRACE_SUBSET` at runtime.
  The job's certificate adds `kind: job`, `stages[{ kind: chunk | once,
  table, index, take }]`, and `chunks: unbounded`. There is no job-level
  bound to prove and the certificate says so rather than pretending.
- **The cursor commits with the chunk.** The `_jobs` row (D3) is updated in
  the chunk's own transaction, so a crash between "wrote the rows" and
  "advanced the cursor" cannot exist; on restart a chunk is either wholly
  done or not started. Exactly-once per chunk on one owner, at-least-once
  never needed.
- **What a job visits.** Every row present when the stage starts and not
  deleted before the cursor reaches it; a row inserted during the stage is
  visited if and only if its key lies beyond the cursor. Convergence claims
  ("after the job every row has X") are the author's to earn by ordering:
  make the *programs* write X for new rows first (the successor), then run
  the job over old rows (D5). The reference page says this in one sentence.
- **Moving the row you stand on.** A body that writes a column of the
  chunk's own index would revisit or skip rows; `check` refuses it
  (`E_JOB_CURSOR_WRITE`, rewrite: iterate `by byId`). Deleting the current
  row is fine — the cursor is a key tuple, not an offset.
- **Clocks.** `now` is the commit clock, pinned per chunk. A job that needs
  one instant across chunks reads it in a plain first stage and carries it
  as a value in `_jobs.state` (the engine stores the stage's return value;
  later stages read it as `job.<name>`). No ambient time crosses a commit.
- **Failure.** A chunk that is `Rejected` (a constraint, a rule, a ceiling)
  parks the job with the refusal envelope; nothing it wrote survives, the
  cursor does not move, and `trace` shows the refusal on the chunk that
  hit it. Resume re-runs that chunk; cancel ends the job with the rows
  written so far intact — a job is not a transaction and does not claim to
  be. Both are chunk-boundary operations; neither is silent.

This answers LLP 0329.014.004 open question 3 as **chunked mutation**. The
alternative — a schedule continuation that enqueues itself — is the same
mechanism with the cursor smuggled through arguments and no certificate
row saying it loops; the design RFC's own words for the kind ("chunked,
resumable, generation-fenced bulk work over sealed inputs") describe D1.

### D2 — Jobs run as `system` under the rules, proven at `check`

A job runs as the system principal, like an effect's `then` (LLP 1003 §2),
under the tables' ordinary rules — no seed-style exemption, which exists
for declared data only (LLP 1001 §4). A table that wants to be backfilled
says so with the word Quarry already has:

```q
table profiles:
  …
  update <- .principal = viewer or system
```

What changes is *when* the refusal happens. The certificate already carries
every write site; the compiler can evaluate each site's rule for the system
principal structurally — `system` admits it, `allow` admits it, a rule with
no `system` disjunct does not — and refuses the job at `check`
(`E_JOB_AUTHORITY`, family `job`, site = the table and effect, rewrite: the
rule line with `or system` appended). A job that would be `E_RULE` at chunk
400 is red at `check`. The same proof applies to a `schedule`'s target (D7)
and to a `then` mutation, which today finds out at runtime.

### D3 — The driver in the owner

One table and one thread it already has:

| `_jobs` | `id TEXT PK, name TEXT, source_hash TEXT, generation TEXT, args TEXT(JSON), state TEXT (queued \| running \| parked \| done \| cancelled), stage INTEGER, cursor TEXT(JSON), stage_state TEXT(JSON), chunks INTEGER, rows_written TEXT(JSON per table), enqueued_by TEXT (a commit seq, a token id, a persona, or 'timer:<id>'), started_at, updated_at, finished_at INTEGER, last_error TEXT(JSON)` + index on `(state, updated_at)` |
| --- | --- |

- **One job at a time per store.** The writer thread (LLP 1002 §5) runs a
  chunk only when no client action is waiting on its channel; between
  chunks it drains pending client actions first. Clients never wait on a
  chunk longer than one chunk, and a chunk is bounded. A second job queues;
  `run` prints the queue position and returns unless `--wait`.
- **Succession pauses and re-proves.** Applying a successor (LLP 1001 §4)
  pauses running jobs, re-certifies each declared job under the new
  generation, and resumes it if the chunk stage's table and index survived
  with compatible types; otherwise it parks with `E_JOB_GENERATION`. An ad
  hoc job (D4) is bound to the generation hash it was certified under and
  parks on any succession. Nothing runs a predecessor's program against a
  successor's schema, which is LLP 1001 §4's fencing rule applied to the
  one durable intent this RFC adds.
- **Restart.** A `running` row at owner start resumes from its cursor
  (the chunk that was in flight never committed). Not `sent_unknown`: a job
  touches only the store, and the store knows.
- **Cancel** flips `running | queued | parked → cancelled` at the next
  boundary. **Resume** re-queues a parked job; if the park reason was a
  refusal that the author has since fixed (a rule, a constraint), the fix
  arrived as a successor and the job was re-certified by it.
- **`reset` and `fork`.** `reset` clears `_jobs` with the data it
  clears (LLP 1001 §1's `reset_data`); a snapshot carries `_jobs` as it
  carries everything, which is what makes `--dry-run` (D9) honest.

### D4 — Ad hoc programs, the operator seat, and the ledger

`snapback2 run --file fix.q [args] --as system` compiles the file with the
same worker, certifies it against the live generation with the engine's
existing `Runtime::execute_adhoc` (`registry.rs`, `Ceilings::default()`),
executes it — a query returns rows, a mutation commits, a job enqueues — and
records `source_hash` in the ledger. It is never installed, never becomes an
op in the manifest, and is refused by everything a declared program is
refused by. This is the console: an agent writes the repair in the language
it already knows, `check`s it by running it, and the receipt is the same
receipt.

The operator seat is the system principal. Locally, `--as system` is
admitted on `run`, `data`, and `why` (today `--as` names a dev persona; the
reserved value is refused). Hosted, LLP 1015 D10 already says `run --env
production` acts as system under an `admin` token and appends `{ kind:
"operator", op, token, at }` to the ledger. This RFC widens that ledger row
to every operator action in both modes: `_commits.kind` gains `operator`,
`job`, and `schedule` beside `mutation | system | seed`, and `trace` answers
"who ran this, from where" for a chunk as it does for a mutation. A
mutation run by an operator is a mutation: it obeys the rules as `system`,
and `E_RULE` naming `system` with the `or system` rewrite is the honest
answer to "why can't the admin edit that."

### D5 — Expand, fill, contract

Today a successor is additive or refused with a plan of drops (LLP 1001
§4). Two admissions make backfill the paved migration path:

1. **Narrowing is admitted when it is true.** A successor that changes a
   column from `T?` to `T` is *additive* when no stored row holds `Null`
   there — the same walk that already validates newly declared columns —
   and refused otherwise with `E_SUCCESSOR_NARROWING { table, column,
   nullRows, sample: [≤10 ids] }` and a rewrite that is the fill job:

   ```q
   job fill_profiles_avatarUrl:
     chunk p in profiles first 500 by byId:
       update profiles[p.id] { avatarUrl: p.avatarUrl ?? <value> }
   ```

   The `<value>` is the author's; everything else is derived from the
   schema. A retype `T → U` that is not a narrowing stays destructive, and
   its plan's `TypeChange` line gains the rewrite "add `<col>_2: U?`, fill,
   drop `<col>`".
2. **`E_SUCCESSOR_COLUMN_REQUIRED`'s rewrite names the three steps** —
   declare it `T?`, `deploy`, `run fill_… --wait`, declare it `T`,
   `deploy` — instead of only "add it while the table is empty."

Renames are add, fill, drop; there is no rename operation and this RFC
does not add one (§9.9 records the cost). Every step is a `check`, every
`deploy` snapshots first (LLP 1015 D5), and a fill that parks leaves the
optional column optional — nothing is half-migrated in a way `check` cannot
see.

### D6 — Erasure is declared per table and derived by the engine

Every table that names a principal — any column of type `principal`, or a
`ref` to a table that does — declares what erasing that principal does to
its rows:

```q
table messages:
  …
  erase <- scrub { body: null, photo: null, clip: null }   -- the row stays; authorId becomes `erased`

table deliveries:
  …
  erase <- delete

table ledgerEntries:
  …
  erase <- keep 'retained seven years under the audit policy'
```

- **Three words.** `delete` removes the row (constraints and unique
  indexes still bind; `after insert` invariants do not fire on deletes;
  maintains apply their delta). `scrub { patch }` writes the patch — every
  named column must be optional or given a value — and points every
  principal column naming the erased principal at the reserved **`erased`**
  principal, a second reserved value beside `system` (LLP 1001 §6), which
  can log in to nothing, satisfies no `= viewer` rule, and renders as the
  app chooses ("deleted user"). `keep` requires a reason string and is
  reported in every erasure receipt. `erase by col` restricts the sweep to
  one column when a table has several principal columns and only one
  identifies the subject (a `deliveries` row has a recipient and, through
  `messageId`, an author; erasure of the author scrubs the message and
  keeps the delivery).
- **The derived job.** `snapback2 run erase '{"principal": "…"}' --as
  system` runs a job the engine derives at `check` from the declarations —
  no authoring, like the derived tests of LLP 1002 §7. Its stages, in
  order: fence every session of the principal (the logout fencing of LLP
  1002 §5, so no intent lands mid-sweep); for each declared table, one
  `chunk` over an index whose prefix reaches the principal column
  (`E_ERASE_UNREACHABLE` at `check` when no such index exists, rewrite:
  `by byPrincipal: <col>`), applying the word; release every asset owned by
  a deleted or scrubbed row with zero grace (LLP 1006 §9's `released_at`,
  set to the past); delete `_outbox` rows still `queued` for the principal
  and scrub the `payload` of settled ones that carry its id; scrub the
  principal's rows in `_credentials` and `_principals` (the id stays, as a
  tombstone the ledger can name); and, last, a plain stage that writes the
  receipt row. The engine writes as the erasure authority, exempt from the
  tables' user rules — the declaration *is* the authorization — and never
  from constraints.
- **Refuse until declared.** `run erase` on a schema with any
  principal-bearing table that has no `erase` clause refuses
  `E_ERASE_UNDECLARED`, family `erase`, listing every such table with the
  three words pasted per table (`erase <- delete` for tables whose read
  rule is `<col> = viewer`; `erase <- scrub { … }` naming the optional
  columns for the rest). The loop bar's template ships without the clauses
  and pays nothing; the first `run erase` prints the whole list once.
  `snapback2 guide app` shows the erasure map: every table, its word, and
  the index the sweep uses.
- **What reaches devices.** A deleted row is a point absence on the next
  fresh receipt that names it, and absence evicts the row and its bytes
  from every held answer (LLP 1012 §5 rule 1); a scrubbed row is a changed
  row and is re-delivered. `retain delivered-history` keeps *hidden* rows,
  not *absent* ones (rule 4 versus rule 1), so a departed recipient keeps
  a scrubbed shell and loses a deleted body. Erasure therefore reaches
  every phone on its next resume with no new mechanism; a device that
  never resumes holds what it was delivered, which is true of every system
  and is written on the reference page rather than implied away.
- **Residue, named.** `_commits.touched` holds index keys, which can
  include a principal id (it is an index prefix in every table above), and
  the table is bounded to 10,000 rows and trimmed (LLP 1001 §1). The
  derived job's last stage deletes the principal's rows from `_commits`
  and the receipt says so; SQLite pages and WAL frames are not scrubbed,
  and the receipt says that too (LLP 1012 §5's own caveat: "a claim about
  current logical state, not forensic erasure"). Snapshots taken before
  the erasure hold the rows; the receipt lists them by name and
  `rollback --data` to one of them is the operator's decision with the
  `E_ROLLBACK_DISCARDS` accounting LLP 1015 D5 already requires.
- **A derived check.** When any table declares `erase`, `snapback2 test`
  gains `erasure-closure`: seed, erase one seeded principal, assert every
  declared table has no row naming it (or only `erased`), every `keep`
  table is listed, sessions are fenced, and a client holding a delivered
  page evicts on its next receipt. Read-only to the agent, like the other
  derived checks.

### D7 — The `schedule` kind: a row-triggered timer, fired on the tick

```q
schedule expireMessage on messages at .expiresAt:
  purgeMessage(.id)
```

- **Declaration.** `schedule name on table at .column [if condition]:
  target(args from the row)`. `column` is a `time ?` column of the table;
  `target` is a mutation or job of this project whose args the row
  expressions satisfy; `condition` is a rule-language predicate over the
  row, re-evaluated at fire.
- **The timer index.** The engine maintains `_timers (schedule, row_id,
  at, generation)` from the column as it maintains any index: insert with
  a present `at` enqueues, update to a different `at` reschedules, update
  to `null` or delete cancels, all in the row's own transaction. An
  absent `at` enqueues nothing. Population scale is an index scan, not a
  heap the owner holds.
- **Firing.** On the tick, the writer takes due timers oldest-first, at
  most 64 per tick, and for each runs the target as `system` with the row's
  current values, in one transaction that also deletes the timer row —
  fire and settle are one commit, so a crash re-fires and the target's
  idempotency key `(schedule, row_id, at)` makes the second run a
  no-op-or-refusal, never a double. A target that is `Rejected` records
  the refusal in the ledger row (`kind: schedule`) and does not re-fire;
  `if` false at fire time settles silently *in the ledger* — visible in
  `trace`, never a hidden retry. At-least-once is the honest claim; the
  certificate records `maxLateness` as a measured number (LLP
  0329.014.004 §2.2 B), not a promise.
- **Authority.** The target's write sites are proven for `system` at
  `check` (D2). `purgeMessage` on `messages` needs `delete <- .authorId =
  viewer or system`; the compiler says so.
- **Development.** `POST /control/clock` (LLP 1002 §5) advancing past a
  timer fires it on the next tick, so a journey can insert a row with
  `expiresAt: now + 1h`, advance the clock, and assert the purge — the
  `test` receipt gains `schedules: fired N, late 0`.
- **Periodic work.** `schedule nightlyClose every 24h at 03:00 UTC:
  closeBooks` is the same kind on a system-owned row the engine keeps in
  `_timers` with no trigger table, re-armed by its own firing; missed
  firings during downtime fire once at start, not once per missed period.
  Whether this is inside the "cron" line of `rules/NOT-DOING.md` is §9.1.
  Without it, periodic work is an external trigger on the CLI — `snapback2
  run closeBooks --as system` from a host scheduler or CI under an `admin`
  token — which needs no owner clock at all and is the v1 fallback.

The `chat` template's disappearing messages move from a client-invoked
`purgeExpired` to `schedule expireMessage`; the recipe dependency LLP 1012
§12 names becomes a schedule line and the client-side trigger is deleted.

### D8 — Fan-out past the bound is a continuation

```q
mutation send(conversationId: conversations, body: text <=4000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, photo: null, clip: null, at: now }
  insert deliveries { recipient: viewer, conversationId, messageId: row.id, kind: 'message', at: now }
  enqueue deliver { conversationId, messageId: row.id }
  return { id: row.id }

job deliver(conversationId: conversations, messageId: messages):
  chunk m in memberships[conversationId] first 500 by byConversationPrincipal:
    if m.principal != messages[messageId].authorId:
      insert deliveries { recipient: m.principal, conversationId, messageId, kind: 'message', at: now }
```

- `enqueue job { args }` is a statement in a mutation, one write site
  `{ table: "_jobs", kind: Enqueue, max_rows: 1 }` per static occurrence,
  refused in a query (`E_ENQUEUE_IN_QUERY`) and for a job the generation
  does not declare (`E_JOB_UNKNOWN`) — the exact shape of `emit` (LLP 1001
  §8). It consumes one id from the mutation's reserved range so the twin
  stays aligned: the twin treats `Enqueue` as a no-op that still consumes
  the id, as it treats `Emit`.
- The mutation's response gains `enqueued: ["job_…"]`; `trace <seq>` shows
  the job under the commit that enqueued it and each chunk under the job.
  The sender's own delivery is written inline and is therefore predicted
  by the twin; the other members' rows arrive by invalidation as chunks
  commit — a 5,000-member group sees the message in ten commits of 500,
  each a receipt, none silent.
- **This is not the feed answer.** LLP 1010 A5's `merge` fans in at read
  and is the paved form for a feed; LLP 0329.014.004 §4's rule stands —
  maintain when fan-in is bounded, compute at read when fan-out is
  unbounded. A continuation is for rows that must exist per recipient:
  delivery logs (retention and offline drain, LLP 1012 §3), notifications,
  per-member state. The reference page says which to pick and why; the
  `send` recipe's silent fifty becomes this.

### D9 — Observability is the same three verbs, plus one flag

- `snapback2 trace job_…` prints the job: name, source hash, generation,
  who enqueued it, stages with their chunk counts, rows written per table,
  the commit seq range, the current cursor, and the parked refusal if any.
  `trace <seq>` on a chunk's commit shows the job it belongs to. `trace
  timer:<id>` shows a schedule's firing.
- `snapback2 run <job> … --wait` blocks and prints one line per chunk
  (`--json`: one envelope per line) and exits 0 done, 1 parked or refused
  (typed), 2 usage — an agent runs a backfill in one command and reads one
  receipt. Without `--wait`, `run` returns the job id and position.
- `snapback2 run <job> … --dry-run` snapshots the store (the `fork`
  primitive), runs the whole job against the snapshot, prints the same
  receipt with `dryRun: true`, and discards the snapshot; nothing touches
  the store, and the numbers are real. `--plan` prints the certificate and,
  per chunk stage, the index-entry count under the prefix and the chunk
  count it implies — the cheap estimate before the expensive one.
- `dev --status` and `/control/status` gain `jobs: { running, queued,
  parked }` and `timers: { due, next_at }` from the tables, in every
  build. `logs` carries one structured line per chunk and per firing.
- Routes, all `read` capability unless noted (LLP 1015 D6): `GET
  /control/jobs`, `GET /control/job/<id>`, `GET /control/job/<id>/events`
  (SSE: one frame per chunk, terminal on done/parked/cancelled — the one
  stream `--wait` and the console both read), `POST /control/job/<id>/cancel`
  and `/resume` (`admin`), `POST /control/run` for ad hoc programs
  (`admin`; the body is the `.q` source and args; refused over non-TLS
  hosted like a secret value), `GET /control/timers`.

### D10 — No new verb

The verb table is fifteen (LLP 1002 decision 5; `rules/NOT-DOING.md`: no
verb without its row in LLP 0329.016 §5.11 and its entry in the measured
loop). LLP 1015 kept token operations under `deploy --token` for the same
reason. This RFC extends `run` — already "invoke an op as a persona;
replaces the `admin` function runner" — with `--file`, `--wait`,
`--dry-run`, `--plan`, `--cancel <job>`, `--resume <job>`, and extends
`trace` to jobs and timers. `run <job>` with `--as` other than `system` is
`E_JOB_PRINCIPAL` (rewrite: `--as system`). The alternative, a sixteenth
verb `job` paying with the deletion of `persona` (personas are created on
first use, LLP 1002 §4, so `persona create` is redundant and `persona list`
is a `dev --status` field), is §9.2.

### D11 — Hosted, under LLP 1015's tokens, and MCP

`read` tokens see `/control/jobs*`, `/control/timers`, and job events;
`admin` tokens run, cancel, resume, and submit ad hoc programs; `deploy`
tokens neither. Every hosted job or ad hoc run carries the token id in
`enqueued_by` and the operator ledger row. When MCP lands (LLP 1015 D15),
job status and trace are read tools by default; `run` of a declared job is
a write tool behind the explicit flag; ad hoc `--file` is absent from MCP
entirely, as LLP 1014 F4 keeps secret values out of it — an agent that
wants to run arbitrary programs against production uses the CLI with an
`admin` token, on the record.

### D12 — The console, when it comes

LLP 1015 D13's ruling stands: no browser console in this RFC. When the
author builds the user-focused console, this RFC shapes what it can be: a
static React app served by the owner at `/_/` (the single-binary shape LLP
1014 F7 found honest), talking to `/control/*` with a token, showing jobs
with live progress from the events stream, the erasure map with its
declared words, a `data` browser as the system principal, the timer index,
and a Quarry scratchpad that runs a program with `--dry-run` first and
`--as system` second. The rule it inherits from LLP 1014 §3.5: no action is
click-only, because every button is a route a verb already calls, and the
catalog that would prove it is the one table in `control.rs`.

## 3. Day one, as a transcript

```text
$ snapback2 check
refused E_SUCCESSOR_NARROWING: profiles.avatarUrl is declared `text` but 312 stored rows are null (p_01J…, p_01J…, …)
  rewrite: declare `avatarUrl: text <=2048 format url ?`, then fill it:
    job fill_profiles_avatarUrl:
      chunk p in profiles first 500 by byId:
        update profiles[p.id] { avatarUrl: p.avatarUrl ?? <value> }
  then declare it required and check again

$ snapback2 run fill_profiles_avatarUrl --as system --plan
job fill_profiles_avatarUrl: 1 stage · profiles by byId · 500/chunk · 4,118 entries → 9 chunks
authority: profiles.update admits system ✓

$ snapback2 run fill_profiles_avatarUrl --as system --wait
job_01J9… chunk 1/9 · 500 rows · seq 88,412
…
job_01J9… done · 9 chunks · profiles: 4,118 updated · 1.9 s

$ snapback2 run erase '{"principal":"p_01J8…"}' --as system
refused E_ERASE_UNDECLARED: 3 tables name a principal and declare no erase word
  rewrite (paste into snapback/schema.q):
    table profiles:      erase <- delete
    table messages:      erase <- scrub { body: null, photo: null, clip: null }
    table deliveries:    erase <- delete

$ snapback2 run erase '{"principal":"p_01J8…"}' --as system --dry-run --json
{"job":"dry","stages":[{"table":"messages","word":"scrub","rows":1204},{"table":"deliveries","word":"delete","rows":9871},…],"sessionsFenced":2,"assetsReleased":37,"outbox":{"deleted":0,"scrubbed":3},"keep":[],"snapshotsHoldingRows":["snap_rel_3f9a_1"],"dryRun":true}

$ snapback2 run erase '{"principal":"p_01J8…"}' --as system --wait
job_01J9… done · 6 stages · 21 chunks · receipt: .snapback/receipts/erase-p_01J8….json

$ snapback2 run --file ./fix-handles.q --as system --dry-run
mutation fixHandles: profiles: 3 updated (dry run)

$ snapback2 run --file ./fix-handles.q --as system
committed seq 88,441 · operator · source 9c1e…

$ snapback2 trace job_01J9…
job deliver(conversationId: c_…, messageId: m_…) · enqueued by seq 88,450 (messages.send, alice)
  stage 1 chunk memberships[c_…] by byConversationPrincipal 500/chunk
    chunk 1 seq 88,451 · 500 deliveries · 41 ms
    chunk 2 seq 88,452 · 137 deliveries · 12 ms · exhausted
  done · 637 rows · 2 commits
```

Every line above is a `--json` envelope with the same fields; the text is a
projection of it.

## 4. The grammar delta, on one screen

```
job name(args):                    -- stages in order; runs as system; every stage one or more commits
  chunk x in table[prefix] first N by index:   -- a for whose iterations are commits; index total
    …bounded statements…
  …plain statements…                             -- one commit
enqueue name { args }              -- in a mutation: one _jobs write; the job runs after the commit
schedule name on table at .col [if predicate]:  target(args from the row)
schedule name every <duration> [at HH:MM UTC]:  target      -- §9.1
erase <- delete | scrub { patch } | keep 'reason'          -- on a table naming a principal
erase by column                    -- when only one principal column identifies the subject
erased                             -- the reserved principal scrubbed rows point at
```

Refused, unchanged: `while`, recursion, ambient time, any write outside the
language. `for` keeps its bound; `chunk` is the only loop whose bound is per
commit rather than per program, and it exists only in a `job`.

## 5. The engine delta

- **Tables.** `_jobs` (D3), `_timers` (D7), both engine-owned, reserved to
  the schema (`E_SCHEMA_RESERVED`), readable only through the verbs.
  `_principals.kind` gains `erased`. `_commits.kind` gains `operator | job
  | schedule`; `CommitRecord` gains `job: Option<String>` so a chunk names
  its job and `trace` can walk it.
- **Certificate.** `kind: job` with `stages[]` and `chunks: unbounded`;
  `write_sites` gains `Enqueue`; `system_authority: proven | [sites]` on
  every mutation and job (D2); the erasure map (`erase[{ table, word,
  by, index }]`) on the schema certificate; `schedules[{ name, table,
  column, target, maxLateness }]`.
- **Runtime.** `Runtime::run_chunk(job_id) -> ChunkOutcome` (one
  transaction: the body for ≤ N rows plus the `_jobs` update);
  `Runtime::enqueue` from `Stmt::Enqueue`; `Runtime::fire_due(limit)` for
  timers; `apply_successor` gains narrowing admission (D5) and job
  re-certification (D3); the derived erasure job is built by
  `Generation::certify` from the `erase` declarations, not authored.
- **Twin.** `Stmt::Enqueue` is a no-op that consumes one id (parity with
  `Emit`). Jobs, timers, and erasure never run on the twin; their effects
  arrive as invalidation and absence, which the twin already handles.
- **Owner.** The writer thread's loop gains two branches after draining
  client actions: fire due timers (≤ 64), then run one chunk of the head
  job. The runner tick (LLP 1003 §4) wakes it; no new thread.

## 6. What makes it agent-friendly, stated as rules

1. **One language.** A backfill, a purge, a repair, and an erasure are
   Quarry programs an agent already knows how to write, `check`, and read
   in `guide`. There is no admin DSL to learn and no button that does what
   a program cannot.
2. **`check` before `run`.** Authority (D2), cursor safety (D1), reachability
   (D6), and narrowing (D5) are refused at `check` with a pasteable
   rewrite. A job that would fail at chunk 400 is red before chunk 1.
3. **Every run is a receipt.** `--wait` turns a long task into one command
   with one JSON receipt and a typed exit code; `trace` reprints it later;
   nothing is a spinner.
4. **Rehearsal is cheap and real.** `--plan` counts; `--dry-run` runs the
   whole thing on a snapshot and reports actual rows. An agent that cannot
   see production can still say what it will do to it.
5. **Nothing prompts, nothing is silent.** Cancel and resume are flags; a
   parked job says why; a skipped timer is in the ledger; erasure's residue
   is in the receipt. `P4` and `P5` of LLP 0329.016 §5.1, applied to the
   slow path.
6. **Derived where it can be.** The fill job is pasted by the refusal; the
   erase job is derived from three words per table; the erasure closure
   is a derived test. The agent declares intent and the compiler writes the
   loop.
7. **The operator seat is explicit and on the record.** `--as system` is
   typed, not ambient; hosted it is a token with an expiry; every action is
   a ledger row `trace` can attribute. An agent never wonders whether it is
   acting as a user or as the operator.
8. **Resumable by construction, safe to interrupt.** Cursor and rows commit
   together; Ctrl-C, a crash, a deploy, or a `cancel` leaves a state
   `trace` can name and `--resume` can continue.
9. **The hosted surface is the local one.** The same flags work with
   `--env production` and an `admin` token; MCP gets the read tools by
   default and the write tools by declared blast radius (LLP 1015 D15).
10. **Three recipes, CI-executed** (`guide job`, `guide schedule`, `guide
    erase`), each one screen, each with the refusal an agent will meet
    first and its rewrite, within the "about twelve recipes" budget of
    `rules/NOT-DOING.md` — replacing the refused-`schedule` sentence and
    the silent-fifty `send`.

## 7. Diagnostics

Families `job`, `schedule`, `erase`; two codes join `successor`. Each has a
site, a rewrite, and a page (`rules/NOT-DOING.md`: no code without all
four).

| Code | Family | When | Rewrite |
| --- | --- | --- | --- |
| `E_JOB_CURSOR_INDEX` | job | a `chunk` index is not total | end the index in `id`, or iterate `by byId` |
| `E_JOB_CURSOR_WRITE` | job | the body writes a column of the chunk's index | iterate by an index the body does not move |
| `E_JOB_AUTHORITY` | job | a write site's rule does not admit `system` | the rule line with `or system` |
| `E_JOB_PRINCIPAL` | job | `run <job>` with a persona | `--as system` |
| `E_JOB_GENERATION` | job | parked on succession; stage table or index gone or retyped | `run --resume` after fixing the schema, or `--cancel` |
| `E_JOB_UNKNOWN` | job | `enqueue` names no job in the generation | declare it, or the nearest name |
| `E_ENQUEUE_IN_QUERY` | job | `enqueue` in a query | move it to a mutation |
| `E_SCHEDULE_COLUMN` | schedule | `at` names a column that is not `time ?` | declare `col: time ?` |
| `E_SCHEDULE_TARGET` | schedule | the target's args do not match the row expressions | the target's signature |
| `E_SCHEDULE_AUTHORITY` | schedule | the target writes where `system` is not admitted | the rule line with `or system` |
| `E_ERASE_UNDECLARED` | erase | a principal-bearing table has no `erase` word | one line per table, word suggested from the read rule |
| `E_ERASE_UNREACHABLE` | erase | no index prefix reaches the principal column | `by byPrincipal: <col>` |
| `E_ERASE_SCRUB_COLUMN` | erase | a scrub patch names a required column without a value | make it optional or give a value |
| `E_SUCCESSOR_NARROWING` | successor | `T?` → `T` with null rows | the fill job |
| `E_SUCCESSOR_COLUMN_REQUIRED` | successor | (existing) | gains the three-step rewrite |

## 8. Measurements to record

Each lands as a line in `snapback2/metrics/` with the landing that produces
it, each with a budget `scripts/measure.mjs --check` can hold (LLP 1012 §14,
LLP 1015 §6):

| Number | Budget |
| --- | --- |
| one chunk of 500 single-column updates, warm, committed | 25 ms |
| a 100,000-row fill end to end, clients idle | 30 s |
| client mutation p50 while a fill runs, relative to idle | ≤ 2× |
| `run erase` for a principal with 10,000 rows across six tables | 10 s |
| timer lateness, p99, owner idle | 1.5 s (one tick plus one chunk) |
| `--dry-run` overhead beyond the job itself, 100 MB store | 3 s |
| `check` on the chat fixture with three jobs, two schedules, and erase words | still under the 1 s product latency (`rules/RULES.md`) |
| bytes added to the binary | recorded, no budget |

## 9. Author decisions

Each with a recommendation; none ruled.

1. **`every` and the "cron" line.** Recommend shipping `every` as the same
   kind on a system-owned timer row (D7). The line on `rules/NOT-DOING.md`
   is read here as "no cron *service*, no expressions, no verbs"; one
   duration and an optional time of day is a timer, and the fallback
   (external triggers hitting the CLI under a token) is the Snapback 1
   shape of pushing the product's work outside the product. Veto keeps
   row-triggered `at` only.
2. **A sixteenth verb.** Recommend no: `run` flags and `trace` (D10). The
   alternative is `job` paying with `persona`.
3. **Concurrency and pacing.** Recommend one job at a time per store,
   client actions first, no pacing flag; add `--pace <ms>` only when a
   measurement in §8 says the 2× budget is missed.
4. **Erasure default.** Recommend refuse-until-declared (D6). The
   alternative — default `delete` for every principal-bearing table — is
   silent data loss with a good excuse.
5. **`_commits` residue.** Recommend the derived job's last stage scrubs
   the principal's ledger rows and the receipt names what it cannot scrub
   (pages, WAL, prior snapshots). The alternative is documenting it as
   residue and touching `_commits` never.
6. **Ad hoc programs hosted.** Recommend yes under `admin` over TLS,
   ledgered by source hash, absent from MCP (D4, D11). The alternative is
   dev-only, which sends the operator back to a declared-and-deployed
   mutation for every production repair.
7. **Sequencing.** Recommend everything after the loop bar, in the order of
   §10, except lane J0 — narrowing admission and the erasure map in
   `check`, both a few hundred lines with no runtime — which could land
   before it as correctness of the migration story. The default is that
   nothing precedes the bar.
8. **What comes off the doing-list.** Candidates: (a) execute LLP 1007
   §7's ruled deletion of the `fork` CLI adapter (recommended; the
   primitive stays for snapshots, `test`, and `--dry-run`; LLP 1015 D1
   still lists `/control/fork` as a dev route and would be amended);
   (b) `persona create` and `/control/persona`, redundant with
   create-on-first-use; (c) the client-invoked `purgeExpired` recipe and
   its trigger, replaced by D7 — which happens regardless.
9. **Rename.** Recommend no rename operation in v1: add, fill, drop is
   three checks and no new successor kind. Reopen when a brief's migration
   count makes the three steps a measured cost.

## 10. Sequencing and lanes

Implementer and date: **none** — a proposal until written here. When
commissioned, four lanes in order, each behind `scripts/test.sh` and the
measured loop:

- **J0 — the migration story** (may precede the bar, §9.7): narrowing
  admission with `E_SUCCESSOR_NARROWING` and its pasted fill job; the
  three-step rewrite on `E_SUCCESSOR_COLUMN_REQUIRED`; the erasure map in
  the certificate and `guide app`; `E_ERASE_UNDECLARED` and
  `E_ERASE_UNREACHABLE` at `check`. No runtime.
- **J1 — jobs**: the grammar (`job`, `chunk`), certification including
  `E_JOB_AUTHORITY`, `_jobs`, the driver, `run --file/--wait/--dry-run/
  --plan/--cancel/--resume`, `trace <job>`, routes, the `job` recipe.
- **J2 — erasure**: the three words, the `erased` principal, the derived
  job, the `erasure-closure` derived check, the receipt, the `erase`
  recipe.
- **J3 — schedules and continuations**: `_timers`, the tick, `schedule …
  at`, `enqueue`, the twin's `Enqueue`, the `chat` template's `send` and
  disappearing messages rewritten, the `schedule` recipe, `every` if
  ruled.
- **J4 — hosted**: token capabilities on the routes, the events stream
  under `--env`, the MCP rows — folded into LLP 1015's H3 when both exist.

The console is after all of them and after LLP 1015's hosted version, on
these routes.

## 11. Non-claims

This RFC does not accept itself, does not change `rules/NOT-DOING.md` (it
proposes §1's refusals and §9.8's trade for the author to add when
commissioned), does not amend LLP 0329.014.004 (it answers one of its open
questions and cites the rest), does not build or promise a console, and
does not claim GDPR compliance — it claims that an erasure declared per
table is executed, receipted, and propagated to devices, and names what it
cannot reach. It moves nothing on the media, offline, or observability
slices, and does not change any Snapback 1 status.

## 12. Panel record (2026-09-05)

Three families reviewed this document at `6d3d09c6f` under the LLP 0005
loop — codex `gpt-6-astra`, Muse Spark, and grok-4.6 — mutually blind in
round 1 and in a cross-read discussion in round 2, on the question "are
you happy with this RFC, or should the design go in a different
direction?" The record is `llp/reviews/1016-administrative-plane.{astra,muse,grok}.md`
(verbatim, both rounds), the two briefs, and the orchestrator's synthesis
`llp/reviews/1016-administrative-plane.panel.synthesis.md`, in which every
engine claim was verified against the tree.

**Verdict, both rounds, three of three: NOT READY; the direction is
right.** No panelist chose a different direction; each refused the
unbounded operator mode and the product boundary on the record. All three
want a thinner RFC of the same driver (synthesis §6.3): `job`/`chunk` with
the cursor certified as an engine write and a `byId` sweep; narrowing at
successor application; row-triggered `schedule … at` plus `every
<duration>` on a system-owned row; `run --file/--wait/--plan/--dry-run` with
a rehearsal runtime; no new verb. Cut from v1 by unanimous round-2
agreement: D8 (`enqueue` and the `send` rewrite — the template caps groups
at fifty and the celebrity fixture is a read-side `merge`), the derived
erasure of D6 (a scrub to one `erased` identity is refused by `immutable`
and collides on `unique` on the template's own tables; the derivation
cannot see refs, json, maintains, custody tables, or hidden rows on
devices), erasure-driven `_commits` edits, and job SSE.

**Verified errors in this text** (synthesis §2): D2's authority test is
neither sound nor complete, and the engine filters *reads* for the system
principal too, so a job with write authority can scan zero rows and finish
green; `E_SUCCESSOR_NARROWING` cannot be raised by `check` (no store) — only
at successor application; M7's message count is a successor maintain
rebuild, not a job; the silent fifty is unreachable in the template; `--as
system` cannot be a persona (`E_AUTH_RESERVED`); `deploy` tokens inherit
`read`; §10 lists five lanes; D9 adds six flags; D3 and §6.8 disagree on
resume after cancel.

**Splits for the author** (synthesis §6.2, with the orchestrator's
recommendation in each): the authority model for declared jobs
(engine-authorized by declaration, or table rules with a conservative
three-valued proof plus system read visibility); the word `every`;
whether a schedule may target a declared job; hosted ad hoc programs
(2–1 yes); J0 before the loop bar (recommendation: no); what replaces
erasure (recommendation: one paragraph naming the semantics a contract
needs, no kind).

**Also for LLP 1015:** D10's system-principal reads assume a visibility the
engine does not implement (synthesis §6.4).

This text is not revised in place; revision (a) follows the rulings and
takes the shape of synthesis §6.3. Until then the decisions above describe
what the panel rejected as much as what it kept, and nothing here should
be commissioned from.
