# RT-A — the database exchanges around public `serve`

2026-10-22. Diagnosis only; no product or RFC change. Source and all line numbers
are from `eeb79ebc7c083bf3cb1cd77f8dcfd730048e6349` on `sb4-pg/rt-a`.

**The tiny increment really executes 58 SQL statements in 57 dependent protocol
exchanges.** Nine read-only snapshots consume 43 of those exchanges; its durable
transaction consumes 14. Four session resolutions consume 24 exchanges. Warm W1
and W2 consume 23 each, and a mutation with one explicit membership check consumes
58. The engine-only execution model omits most of this envelope.

| Request, warm plans and reader | PG executed statements | PG exchanges / dependent waits | SQLite executed statements |
|---|---:|---:|---:|
| Original tiny counter increment | 58 | 57 / 57 | 79 |
| Tiny owner-authorized point `/q/peek` | 22 | 22 / 22 | 30 |
| W1 authorized point | 23 | 23 / 23 | 31 |
| W2 authorized newest 20 | 23 | 23 / 23 | 31 |
| Counter update plus one explicit membership `require` | 59 | 58 / 58 | 80 |
| Constant `/q` with a new session, first / second use | 21 / 21 | 21 / 21 | 29 / 29 |

These are request counts, excluding separately identified background work. Three
warm repetitions agree in each principal class. The checked mutation's first
invocation additionally prepares UPDATE; its next three agree. No latency or
throughput qualification follows from this instrumented debug build.

## Method and scope

One worker, this checkout and host only, no sub-agents, clones, remote commands,
push or stash. Both private clusters used PostgreSQL **16.15** from
`$HOME/tools/pg16`; PG17 was absent. The transport was a private Unix socket
through an observing Unix-socket relay. `listen_addresses` was empty; `fsync`,
`synchronous_commit` and `full_page_writes` were on. The relay adds no artificial
delay. This is a count reproduction, not the S1-PG inter-host timing experiment.

The relay forwards original byte chunks without rewriting them. Independent
stream parsers reassemble PostgreSQL messages, including fragmented headers and
payloads. It records frontend message types, prepared statement names and SQL,
backend CommandComplete tags and ReadyForQuery, and the startup handshake.
**Executed statement counts come from backend CommandComplete messages**, not
from counting semicolons or Parse messages. The retained events include no Bind
parameter values, credentials, backend row contents, or startup field values.
`log_statement=all` was also enabled, with parameter logging disabled, as a
secondary local diagnostic; the wire capture is the counting authority.

Terminology matters:

* `PDS` = Parse, Describe, Sync, followed by its response through ReadyForQuery:
  one prepare exchange and zero executed SQL statements.
* `BES` = Bind, Execute, Sync, followed by its response: one execution exchange.
* `Q` = simple Query through ReadyForQuery. A `Q` containing two SETs executes
  two statements in one exchange.
* `CS` = Close, Sync. This executes no SQL. The driver's statement destructor
  sends it without awaiting it; it can overlap the next request to Postgres.
  Cold/renewal tables therefore distinguish wire cycles from dependent waits.
* Startup through AuthenticationOk/ReadyForQuery is an additional exchange when
  a new connection is opened. Terminate is a one-way process/connection-close
  message, with no response or SQL round trip; it is retained in raw events.

Every warm request in the table contains only Q and BES cycles. The verifier
checks that each response completes before the next request flight starts:
**57 warm cycles really are 57 serial waits**, with no hidden pipelining.
Cold prepares and asynchronous statement closes have their own counts below.

The small [local instrumentation patch](./instrumentation.patch) enables
SQLite's unexpanded STMT trace, tagged by Rust thread ID, and captures the call
stack at each Postgres adapter transaction opener. It changes no SQL or product
outcomes. It is an experiment artifact, **not applied to the committed product**:
the three modified product files were restored, and the ordinary binary rebuilt.
Its environment checks/backtrace overhead are intentionally not a proposed
production instrumentation design. The first captures lacked SQLite thread
tags; their mixed windows are retained, but the table uses the separate,
thread-scoped SQLite repeat.

HTTP calls use the actual deployed `serve` binary, guest bearer sessions, and
the existing `/q/<op>` and `/m/<op>` routes. Bodies are `{args: ...}` with no
operation id, store-id intent, continuation, delivery manifest, or search state.
Thus there is no keyed `_ops` receipt/replay cost in these measurements. Requests
are serial; servers, pooled readers, and prepared plans are reused. Fresh serve
processes separately establish the first-reader cost.

The unchanged S1 application still refuses deploy with
`E_STORE_UNSUPPORTED: maintained-columns`; [stderr](./full-deploy.stderr) retains
the refusal. [admitted-s1.q](./admitted-s1.q) removes only the two maintained
count fields and the W3 query using them, adds native identity and fixture-insert
helpers/rules, and preserves the **W1/W2 bodies and their membership read rules**.
Its seed is one user, room, membership and counter plus 25 messages. W1 returns
message 24; W2 returns exactly messages 24 through 5, newest first. This is the
closest admitted diagnostic shape, not a deployed S1 application, 1M seed,
matching benchmark cell, or capability workaround. [tiny.q](./tiny.q) preserves
the original counter-probe mutation and adds point/constant queries.

The checked mutation adds exactly one explicit
`require exists memberships[room, viewer]`. Existing counter read/update rules
also run; “one rule” does not mean only one boolean authorization evaluation in
the entire engine. Its additional physical membership lookup costs one BES
exchange. The owner branch of the counter's rule admits this non-null owner.

## All 57 tiny-increment exchanges

In the following table, `http/` means `snapback4/crates/snapback4/src/`, and
`core/` means `snapback4/crates/snapback4-core/src/`. Ordinals are the actual
ordered flights in `counts.json`, run `tiny`, phase `increment-warm-0`.
Every row is **per request**, unless explicitly stated otherwise. The SQLite
column counts the corresponding semantic stages in its thread-scoped trace.

| Stage and flight ordinals | Executed PG SQL | Statements | Exchanges | SQLite statements | Code site |
|---|---|---:|---:|---:|---|
| Ingress authentication, 1–6 | START RO; generation/head; full/read session union; two supervisor metadata reads; ROLLBACK | 6 | 6 | 10 | `http/serve.rs:940`; `http/serve_identity.rs:69`; `core/identity.rs:229` |
| Route authentication after reading body, 7–12 | Same six | 6 | 6 | 10 | `http/serve.rs:1145` → `principal_of` |
| First writer-queue admission, 13–18 | Same six | 6 | 6 | 10 | `http/serve.rs:1172`; `http/serve_identity.rs:108` |
| Preflight response identity/head, 19–22 | START RO; generation/head; store id; ROLLBACK | 4 | 4 | 8 | `http/serve.rs:1188` → `response_head`, `:807` |
| Executing writer admission, 23–28 | Same six authority statements | 6 | 6 | 10 | `http/serve.rs:1407`; `http/serve_identity.rs:108` |
| Durable start, 29 | START READ COMMITTED READ WRITE | 1 | 1 | Included below | `core/engine/postgres/store.rs:103` |
| Owner fence, 30 | `SELECT store_id,token ... FOR KEY SHARE` | 1 | 1 | — | `core/engine/postgres/store.rs:127` |
| Head fence, 31 | `SELECT seq ... FOR UPDATE` | 1 | 1 | — | `core/engine/postgres/store.rs:173` |
| Writer generation check, 32 | `SELECT generation FROM _backend` | 1 | 1 | Included below | `core/engine/postgres/store.rs:185` |
| Member/program frames, 33,34,38,40 | SAVEPOINT member; SAVEPOINT program; RELEASE program; RELEASE member | 4 | 4 | 4 | `core/engine/committer.rs:278`, `:75`; `core/engine/mod.rs:1019`, `:1041` |
| Program execution, 35,37 | Two counter/index scans | 2 | 2 | 2 | `core/engine/postgres/store.rs:501`, `:515` |
| Row write, 36 | UPDATE r | 1 | 1 | 1 | `core/engine/postgres/store.rs:593` |
| Tail, 39 | One WITH statement: head increment + commit + log/outbox/presence slots | 1 | 1 | Included below | `core/engine/postgres/tail.rs:32` |
| Durable finish, 41–42 | SET LOCAL statement_timeout; SET LOCAL lock_timeout; COMMIT | 3 | 2 | Included below | `core/engine/postgres/ownership.rs:128`; `core/engine/postgres/store.rs:354` |
| Post-commit publication head, 43–45 | START RO; generation/head; ROLLBACK | 3 | 3 | 1 | `http/serve.rs:1421`; `core/engine/committer.rs:380`; `core/store/port/operations.rs:46` |
| Publication identity, 46–49 | START RO; generation/head; store id; ROLLBACK | 4 | 4 | 1 | `core/engine/committer.rs:381`; `core/engine/postgres/metadata.rs:51` |
| Preservation evidence, 50–53 | START RO; generation/head; commits LEFT JOIN change evidence; ROLLBACK | 4 | 4 | 1 | `http/serve.rs:1423`; `http/serve_changes.rs:355`; `core/engine/postgres/change_evidence.rs:69` |
| Final response identity/head, 54–57 | START RO; generation/head; store id; ROLLBACK | 4 | 4 | 8 | `http/serve.rs:1424` → `response_head`, `:807` |
| **Total** | **Nine RO transactions plus one durable transaction** | **58** | **57** | **79** | |

SQLite's complete durable block is **20 statements**, including the four
savepoint operations, two scans and one UPDATE listed above. Its other thirteen
are BEGIN IMMEDIATE, four activation identity reads, two next-sequence reads,
two side-table existence probes, INSERT/DELETE change evidence, INSERT commit,
and COMMIT. All twenty are enumerated in `counts.json` rather than estimated
from the PG dialect.

The nine snapshots are therefore **four authority snapshots, two response-head
snapshots, one publication-head snapshot, one publication-id snapshot and one
preservation snapshot**. They are different API callers, not nine retries or a
rule loop. Generation/head capture and rollback framing are emitted by
`core/store/port/lifecycle.rs:39`, `:30`,
`core/engine/postgres/handle.rs:22`, and
`core/engine/postgres/store.rs:165`–`:189`.

The two metadata reads in each successful guest resolution are the current
worker session-family marker and the named worker-family revision, from
`core/identity.rs:205`–`:216`. They happen even for this ordinary guest. A
supervised family can require an additional revision read; that case is outside
these numbers. Session minting occurred before the request windows: four
*resolutions* here do not mean four session creations.

`continue_durable_publication` says its continuation stage “never opens a
transaction” (`core/engine/committer.rs:374`), but its calls to `seq()` and
store identity dispatch to Postgres wrappers that each open one. The measured
seven exchanges are underneath that abstraction. HTTP publication notifies
condition variables in memory; no mounted live query, change-feed consumer or
background worker was attached. Preservation classification adds its own four
exchanges. There are no extra SQL queries for a `/changes` request, `_ops`
receipt or continuation in this sample. Untimed schemas make
`advance_time_audiences` a no-SQL early return
(`core/engine/time_audience.rs:99`); it is not the source of these nine snapshots.

The current tail is **already one statement**. Moving that same tail into one
statement saves zero. The two SET LOCAL statements are already one Q flight,
not two. These two details are essential to the 58-versus-57 reconciliation.

## Read requests, cold readers, and sessions

| Warm read stage | PG statements / exchanges | SQLite statements | Code site / frequency |
|---|---:|---:|---|
| Before-body detached-reader authentication | 7 / 7 | 7 | `http/serve.rs:940`; `core/store/port/operations.rs:58`; per request |
| After-body detached-reader authentication | 7 / 7 | 7 | `http/serve.rs:1145`; same resolver; per request |
| Response identity/head snapshot | 4 / 4 | 8 | `http/serve.rs:1257`; `:807`; per request |
| Query snapshot setup/end | 3 / 3 | 7 | `core/engine/mod.rs:777`; BEGIN, generation/head, ROLLBACK on PG; per request |
| Tiny row read, or W1 row + membership / W2 membership + page | 1 / 1, or 2 / 2 | 1, or 2 | `core/engine/postgres/store.rs:501`; per execution |
| **Tiny / W1 / W2 total** | **22 / 23 / 23** | **30 / 31 / 31** | |

A detached read resolution additionally reads and compares store identity in
its authority snapshot. Each normal read thus has **four RO transactions**.
The scalar constant has no program SQL and still pays 21 exchanges. W1's row
and membership probe are separate executions of the cached ascending-index
SQL. W2 executes that membership lookup and a descending LIMIT page query;
it does not make twenty per-row SQL trips. Quarry's rule/hoisting behavior
therefore saves physical probes already, but does not remove the HTTP envelope.

“Cold session” here is the first `/q/constant` use of a freshly minted second
guest bearer, on a previously used reader. Its first and second calls both use
21 statements/exchanges (SQLite 29). There is no per-bearer authority cache to
warm. Session lifetime, session refresh/mint, HTTP keep-alive, cold reader
construction and cold SQL plans are distinct concepts. The requests use native
bearers on fresh HTTP calls; this probe makes no HTTP connection-cache claim.

| Cold observation | SQL statements | SQL wire cycles | PDS prepare cycles | CS close cycles | Startup exchanges | Dependent waits including startup |
|---|---:|---:|---:|---:|---:|---:|
| First tiny increment after make | 58 | 59 | 2 | 0 | 0 | 59 |
| Tiny point, first reader | 45 | 57 | 11 | 3 | 1 | 55 |
| Tiny point, first read after serve restart | 45 | 57 | 11 | 3 | 1 | 55 |
| W1, first reader (also after restart) | 46 | 58 | 11 | 3 | 1 | 56 |
| W2 first use, existing W1 reader | 23 | 24 | 1 | 0 | 0 | 24 |
| Checked mutation, first use | 59 | 59 | 1 | 0 | 0 | 59 |

Add the startup column to SQL wire cycles to get all bidirectional cycles:
e.g. **58** for the first tiny point, with **55** awaited driver operations.
The three CS cycles are pipelined destructor cleanup, not three extra blocking
round trips. The first increment prepares the ascending-index scan and UPDATE;
W2 prepares the descending scan; the checked mutation prepares UPDATE on its
writer. A cold reader has broader setup costs than those operation-only misses.

Exactly **23 extra executed statements** construct a new PG reader: six in
the source's before snapshot, two session-affinity/version probes, three
connection SETs in one Q, one application-name tag, five opening checks, and
six in the reader's after snapshot. There are eleven prepares and three closes.
Thus the SQL-cycle surcharge is `23 - 2 + 11 + 3 = 35`, plus one startup exchange;
the dependent-wait surcharge is 33 including startup. These are **per physical
reader creation**, not per session and not inevitable per warm request.
Sites: `http/serve_readers.rs:101`, `core/engine/postgres/handle.rs:29`–`:36`,
`core/engine/postgres/ownership.rs:102`–`:123`. Its opening transaction takes an
owner key-share fence but rolls back; it is not an additional durable mutation.

SQLite's first reader costs one extra PRAGMA statement: tiny 31 rather than 30,
W1 32 rather than 31. Native prepares do not execute extra SQLite statements.
On initial untagged traces maintenance sometimes overlapped, producing larger
windows. The repeat identifies the request thread by its session lookup and
counts only that thread; e.g. first W1 has 32 request statements and nine
background statements, rather than claiming all 41 belong to W1.

## Lease renewal is per process

The dedicated lease connection executes, on **every tick**, START; a conditional
UPDATE of `_owner`; the two SET LOCALs in one Q; COMMIT. That is **five executed
statements, six SQL wire cycles and five blocking waits**: its UPDATE is prepared
anew (PDS) and closed anew (asynchronous CS). It is not warm-cached like Store's
statements. The tiny idle window captures three complete ticks: 15 statements,
18 cycles, 15 dependent waits. Request-overlapping ticks are recorded under
`renewal_flights`, excluded from request counts by their dedicated connection.

Sites: `core/engine/postgres/ownership.rs:377`–`:390` and `:128`. Frequency is
per serving process/lease cadence, independent of request rate; it is not valid
to add five SQL statements to every mutation. It must remain independent of a
long application transaction, use the token predicate and database clock, and
not wait for the application's head lock. The clusters' lease-release and
connection shutdown work lies outside request windows.

## Proposed reductions and their arithmetic

These are design proposals, not implemented or qualified improvements. Numbers
below are **isolated savings from the measured warm baseline** unless a row says
otherwise. They overlap and must not be added indiscriminately. For pipeline
proposals, fewer dependent waits need not mean fewer Sync/ReadyForQuery cycles.

| Proposal | Predicted saving and resulting count | Correctness constraint | SQLite impact |
|---|---|---|---|
| Delay preflight response-head construction until replay/refusal actually needs it | Tiny mutation saves 4, **57 → 53**; checked 58 → 54 | Keep replay/error metadata bound to the acknowledged store and generation; final response still covers the commit | Removes 8 statements from this successful unkeyed path |
| Carry committed seq, store incarnation and exact preservation evidence into publication and response | Saves the four post-commit snapshots: **15**, tiny **57 → 42**, checked 58 → 43 | Hand off only after durable COMMIT; preserve ordered wakeups, unknown-evidence semantics, store/generation binding and `head >= acknowledged seq`. A contract demanding a newer head still needs a later read | Removes 11 statements here: publication seq/id/evidence 3 plus final head 8 |
| Reuse request authority through body decoding and the first preflight; retain ingress and final writer admission | Remove route and first-writer duplicate resolutions: **12**, tiny **57 → 45** | A session must be checked fresh after relevant body/queue waits. Move final authority into the actual admission snapshot; never retain a before-body RR snapshot across a queue and treat it as current | Removes two 10-statement authority snapshots, saving 20 |
| One read-snapshot owner per necessary authority boundary, with typed APIs borrowing it | W1/W2 four snapshots → ingress + execution snapshots saves **6 framing exchanges**, 23 → 17; reusing response id/head as well yields **16**. Nine → two would save 21 framing exchanges for mutations, but overlaps the preceding changes | Generation, head, rules and rows agree within each snapshot; retain distinct freshness boundaries. A literal single snapshot held across upload/queue waits is not an acceptable authority shortcut | Fewer BEGIN/ROLLBACK and repeated four-field activation identity reads; no change to SQLite transaction modes |
| Combine session, supervisor markers, store/generation checks into one bounded, parameterized autocommit authority SELECT | Each current writer resolution **6 → 1**, or **20 saved** across four (57 → 37); read resolutions **7 → 1**, saving 12 (W1/W2 23 → 11) | Same authority result, principal generation, expiry, read cap, family/supervisor revision and incarnation checks in one statement snapshot; §9.1 NUL/ambiguity checks remain shared | Can combine metadata reads; account for legacy optional `_read_sessions` storage, rather than querying an absent table |
| Pipeline independent read queries using tokio-postgres | Existing writer resolution 6 → **4 dependent waits**, eight saved across four (57 → 49); read resolution 7 → **4**, W1/W2 23 → 17. SQL/Sync cycles can stay unchanged | First wave generation + session (+ store id for reads); next wave independent supervisor reads once family is known. Validate all results before disclosing or writing. Do not pipeline data-dependent or side-effecting work past a refused guard | No network benefit; shared snapshot APIs still reduce interpreter/statement overhead |
| Fold guarded writer setup into first flight | BEGIN + owner + head + generation + two SAVEPOINTs: **6 → 1**, saves 5 waits (57 → 52) | Owner is first lock; token failure prevents later work; head precedes generation visibility check. Needs guarded server SQL/function or a proven pipeline protocol, not blindly executing after a failed Rust-side token check | Ordinary SQLite IMMEDIATE framing stays; savepoint semantics remain |
| Fold terminal SET LOCALs with COMMIT; pipeline/fold releases and tail where proven safe | SET flight + COMMIT **2 → 1**, saves 1. Full current finalization (RELEASE program, tail, RELEASE member, SET batch, COMMIT) **5 → 1** would save 4 waits; pipelines may retain five wire cycles | Preserve abort dispositions, deferred-rule failures, tail affected-count checks, unbounded durable COMMIT wait and unknown-COMMIT classification. COMMIT returning ROLLBACK must never acknowledge success | No SET cost; reduced frame dispatch possible, while preserving rollback behavior |
| Move the tail into one statement | **0**: it already is one | Preserve commit order and all log/effect/receipt semantics if broadening a function | SQLite's tail has more statements, but changing it is separate work |
| Reuse owner fencing | **0** for caching proof across transactions; one fence can be amortized over a correctly fenced physical batch, or folded into guarded setup | §5 requires the first lock of **every writing transaction**. A cached token or live lease is not continuing proof of ownership. Keep the key-share lock until COMMIT, and takeover's conflicting lock protocol | SQLite uses its existing ownership/IMMEDIATE boundary; no PG-style row fence to remove |
| Cache the lease UPDATE statement on the dedicated connection | Renewal **6 → 4 wire cycles, 5 → 4 waits**; saves one prepare and one asynchronous close per tick | Session affinity; discard prepared handle on reconnect. Keep conditional token UPDATE, database time, independent renewal and COMMIT handling | None |
| Pre-open and warm actual serving readers within a connection budget | Saves **35 SQL cycles + 1 startup** on the measured first tiny/W1 request; no warm-request saving | Warm per physical connection/generation, retire obsolete readers on activation/native epoch change; bound connections and avoid pinning transactions | Removes first-request PRAGMA/open overhead, increases idle connections |

Caching live authority per connection alone has no safe positive count here.
Bearer sessions are not tied to HTTP or PG connections. A reusable request
capability can carry digest, incarnation, family/generation and validity deadline,
but a revocation or supervisor change while queued still requires a fresh final
check. A cross-request cache needs an authoritative invalidation/version protocol,
including loss/reconnect handling and expiry; a TTL or best-effort notification
is insufficient. Caching immutable parse/digest information does not eliminate
that final database check. The observed cold/warm-session equality confirms
that the current implementation is doing live work on each request.

For comparison with K3, the original seven-shareable-flight illustration still
fits this trace: BEGIN, owner, head, generation, tail, SET batch and COMMIT can
be shared by a physical batch. Leaving the other fifty serial gives
`50 + 7/N` exchanges per member and only `57/(50+7/16) = 1.130×` at N=16
when flush is negligible. K3 alone does not solve the envelope.

## Request budgets

The checked-in raw-PG control is stricter than “a few statements”:
`snapback4/experiments/scale-controls/src/db.rs:17`–`:21` and
`src/main.rs:109` execute **one prepared autocommit statement for W1, W2 and
W4**, including membership authorization. Its token verifier is outside PG.
Snapback's durable session revocation and shared ordered log are additional
contracts; matching their costs needs structural work.

| Class | Current dependent waits | Useful intermediate budget | Strict network budget for ≤2× this raw control |
|---|---:|---:|---:|
| Point read | 22 tiny / 23 W1 | **6** | **2** |
| Newest-20 read | 23 | **6** | **2** |
| Tiny / one-membership mutation | 57 / 58 | **8** | **2** |

The read intermediate is one early authority exchange followed by a final
execution snapshot with BEGIN, combined authority/generation/id/head, two
dependent point/rule/page reads, and ROLLBACK (five more). The mutation
intermediate is one ingress authority exchange, one guarded owner/head/generation
setup flight, one final authority flight, at most three program read/write
flights, one guarded tail/frame flight, and one SET/COMMIT flight. Carrying the
commit's metadata makes post-commit SQL zero. These are **target dependency
budgets**, not claims that the current adapter can meet them by editing a few
batch_execute calls.

The strict two-exchange read target is early live authority plus one composed
authorized point/page statement that returns authority, generation, head, store
id and result consistently. The strict mutation target is early live authority
plus one **server-side atomic operation** containing final authority, owner
fence, head/generation, rule checks, row changes, complete commit tail and
returned metadata, committed by the statement's implicit transaction. It needs
trusted lowering/function design for the admitted program, all failure semantics,
and differential qualification. A general Rust interpreter still making separate
remote reads cannot reach this budget by transaction-framing cleanup alone.

If the lead instead budgets against an explicitly multi-statement raw control,
the budget is `2 × measured dependent raw waits`; it should name that control.
The 6/8 intermediate budgets must **not** be described as within 2× of the current
one-statement control. Even two exchanges only budgets the network component:
CPU, log amplification, locking, durability and queueing still need measurement.
At the earlier probe's 0.56 ms ping, the present serial network term is about
31.9 ms for 57 waits and 12.9 ms for 23; two waits would be about 1.12 ms.
Those are arithmetic predictions, not new latency observations.

## Governing context, verification and custody

Orientation used the Snapback 4 fence, root LLP 3000, LLP 2000.000, NOT-DOING,
JOURNAL, and the paved deploy/reads/rules guide cards. The relevant in-flight
LLPs are [the store port](../../../llp/3000.009.001.000-the-postgres-store-port.rfc.md)
§5 ownership, §5.4 ambiguous commit and §9.1 shared validation/parity; and
[the committer](../../../llp/3000.009.001.000.000-the-committer.rfc.md)
§2 reference scope, §3.5–3.6 replay/snapshot constraints and §9 S1a/S1b findings.
Root LLP 3000 remains in the foundation set; these children are in current.
This report proposes no accepted design or corpus status change, so the handoff
is to the lead's budget/RFC work. No RFC was edited.

[counts.json](./counts.json) contains every per-request statement total, ordered
flight with SQL, CommandComplete tags, prepare/close/startup counts, renewal
flights, and snapshot call sites, plus SQLite SQL and separately excluded
background statements. The complete scrubbed raw streams and call stacks are
[raw-tiny.json.gz](./raw-tiny.json.gz), [raw-reads.json.gz](./raw-reads.json.gz)
and [raw-sqlite.json.gz](./raw-sqlite.json.gz). Their JSON retains base source,
instrumented binary SHA-256, request windows, outcomes and process IDs.
[verification.json](./verification.json) hashes the archives and confirms
18 warm request checks and 15 owned server/postmaster PIDs absent. All short-lived
CLI/initdb/pg_ctl invocations also completed and were waited for.

Reproduction, starting at the source above:

```sh
git apply snapback4/reports/20261022-rt-a-round-trips/instrumentation.patch
CARGO_TARGET_DIR="$PWD/snapback4/target" CARGO_INCREMENTAL=0 cargo build --manifest-path snapback4/Cargo.toml --locked -j 16 -p snapback4
RT_A_TINY_ONLY=1 python3 snapback4/reports/20261022-rt-a-round-trips/probe.py
gzip -n -c snapback4/reports/20261022-rt-a-round-trips/raw.json > snapback4/reports/20261022-rt-a-round-trips/raw-tiny.json.gz
RT_A_READS_ONLY=1 python3 snapback4/reports/20261022-rt-a-round-trips/probe.py
gzip -n -c snapback4/reports/20261022-rt-a-round-trips/raw.json > snapback4/reports/20261022-rt-a-round-trips/raw-reads.json.gz
python3 snapback4/reports/20261022-rt-a-round-trips/sqlite_probe.py
gzip -n -c snapback4/reports/20261022-rt-a-round-trips/sqlite-raw.json > snapback4/reports/20261022-rt-a-round-trips/raw-sqlite.json.gz
python3 snapback4/reports/20261022-rt-a-round-trips/analyze.py
python3 snapback4/reports/20261022-rt-a-round-trips/verify.py
git apply -R snapback4/reports/20261022-rt-a-round-trips/instrumentation.patch
```

Every cluster and server has `finally` cleanup. Two PG clusters are independently
confirmed stopped with `pg_ctl status` (exit 3); all fifteen recorded PIDs are
absent. **PIDs left: none.** Private runtime directories are recorded in the
archives and verification; no unrelated process was signalled. Builds used only
the authorized `snapback4/target`, `CARGO_INCREMENTAL=0`, and `-j 16`. The final
observed free space was 78 GB, above the 30 GB stop threshold. Product files and
ordinary binary were restored. Build warnings were existing unused-code warnings.

The initial setup transcript is [setup-history.txt](./setup-history.txt).
Setup history is retained honestly: an initial build accidentally ran at the
repository root and refused its missing Ibex dependency before compiling; it was
rerun in the fenced workspace. The first admitted fixture omitted insert rules,
so its setup mutation correctly refused E_RULE; that run's tiny measurements
and full cleanup were preserved, then fixture-only insertion rules were added
for the successful S1 read run. An initial verifier expectation confused the
restart's W1 alias with the tiny point; the class-specific assertion was corrected
and all checks rerun. These are harness corrections, not product fixes.

**UNVERIFIED:** full maintained-column S1 deployment, the 1M seed, PG17,
inter-host/0.56 ms latency reproduction, concurrency or p99/throughput, flush
timing, keyed receipts/replay, expired/revoked/read-capped/service sessions,
timed-publication schemas, mounted live queries/change consumers, continuations,
and every proposed reduction. No complete product battery was needed for this
report-only landing; the diagnostic and restored binaries built successfully,
the actual public requests completed with the expected W1/W2 outcomes, framing
and exact count checks passed, Python sources compile, and whitespace/reference
checks passed (`ref-check`: 564 LLP documents, 12,330 references, zero errors
and zero unchecked references; `git diff --check`: clean).
