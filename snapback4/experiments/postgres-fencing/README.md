# Postgres ownership and fencing prototype

A throwaway prototype, not product code. It asks whether the ownership and
fencing protocol in
[LLP 3000.009.001.000 §5](../../../llp/3000.009.001.000-the-postgres-store-port.rfc.md#5-ownership-and-fencing)
works on real Postgres without superuser. That protocol is: every durable
transaction is fenced with `SELECT token FROM _owner FOR SHARE`; takeover is
driven by a lease on the database clock and uses `pg_terminate_backend`; the
advisory lock is only a fast path. It produces the P1b SIGSTOP witness of
§10 and parent [LLP 3000.009.001](../../../llp/3000.009.001-snapback4-on-postgres.rfc.md)
§6 point 3 ahead of the host work. Parent §9 explains why the first draft's
advisory-lock gate failed review; witness 6b reproduces that failure.

**Result in one line.** The token fence holds in every scenario. In every
witness, nothing the old owner wrote committed after the takeover, for head
advances and non-head writes alike. The protocol as written in §5 still has
one fatal liveness hole: the `backends` pid list. A paused owner connection
that is not on the list blocks takeover forever (W3). Three smaller defects
also need fixing: `FOR SHARE` starves the owner's own renewals (W8); the
adapter's head-first lock order deadlocks with takeover (W10); and an
in-flight COMMIT can be durable but unacknowledged (W9).

**Revision 5's lease claim (W11, added later).** RFC §5.2 now claims the
expired lease with a no-op `UPDATE` before terminating anything. On this
cluster the claim behaves as §5.1–§5.2 say. A renewal that lands before the
claim makes the claim match zero rows, and nothing is terminated (W11a). A
claim that lands first blocks the renewal, and the renewal then matches zero
rows (W11b). Fences keep flowing while the claim is held (W11d). The claim's
row lock survives `ROLLBACK TO SAVEPOINT` (W11e). A racing second standby
terminates nothing (W11f). The revision-3/4 "re-read, then terminate" design
kills a live owner that renewed after the re-read, and this run reproduces
that deterministically (W11c). The earlier witnesses (W2, W3, W8, W10) give
the same verdicts under the claim strategy. See
[the claim section](#the-step-2-lease-claim-w11).

Everything below ran against a real PostgreSQL 16.15 cluster on this
machine. The only exception is the managed-provider column, which comes from
documentation only and is labelled as such.

## What is here

| Path | What |
| --- | --- |
| `src/lib.rs` | Connection helper, the fence (`fence()`), the schema (`RESET_SQL`) |
| `src/bin/node.rs` | One serving process, `--role owner` or `--role standby`. Every connection runs as non-superuser `sb_core` |
| `src/bin/witness.rs` | The harness. It resets the schema, spawns nodes, sends SIGSTOP/SIGCONT, observes as superuser, and prints `RESULT` lines |
| `shim/skewclock.c` | `LD_PRELOAD` clock skew for W5 (libfaketime is not installed) |
| `scripts/cluster.sh` | A private cluster: `initdb`, start on a short `/tmp/sbpgXXXX` socket plus 127.0.0.1, and create the roles |
| `run.sh` | One command per witness |
| `results/run1.txt`, `results/run2.txt` | Two complete transcripts with identical verdicts. `results/w8.txt` is a W8 rerun after a reporting fix (below) |
| `results/claim-run1.txt`, `claim-run2.txt`, `claim-run3.txt` | Three transcripts of `witness w11 claim-reruns`: W11a–f, plus W2, W3, W8 and W10 under the claim strategy |

**Schema.** The tables are `_owner(singleton, holder, token, lease_until,
backends int[])`, `_head(singleton, seq, owner_token)`, `_log(seq,
owner_token, writer)` (one row per head advance) and `_sessions(id,
minted_by_token, writer)` (the non-head write). `_takeovers` holds one row per
takeover. `track_commit_timestamp = on`, so every row's commit instant can be
ordered against the takeover's commit instant: the commit timestamp of its
`_takeovers` row.

**Node.** A serving node holds four connections, all tagged
`application_name = sb-owner:<holder>:<token>`:

- a lease connection, which takes the advisory lock and renews
  `lease_until = clock_timestamp() + lease WHERE token = $mine`;
- a committer connection for head advances. Each one runs the fence, then
  `SELECT seq FROM _head … FOR UPDATE`, inserts into `_log`, and runs
  `UPDATE _head … WHERE owner_token = $mine`;
- N session connections, each running the fence and then an insert into
  `_sessions`;
- optionally (`--late-conn`), a connection opened after the pids were
  registered.

The fence is the first statement of every writing transaction. A transaction
refuses when the token differs.

**Standby.** It polls `lease_until < clock_timestamp()`, terminates the old
owner's sessions, then runs one transaction:

1. `SELECT … FROM _owner FOR UPDATE`, with `lock_timeout`;
2. re-checks the token and expiry;
3. increments the token, records its holder and backends, and sets
   `_head.owner_token`;
4. inserts the `_takeovers` row;
5. commits, then serves.

There are three termination strategies:

- `pidlist`: the §5 design;
- `appname`: every same-role session whose tag names a generation no newer
  than the expired token;
- `blockers`: whatever `pg_blocking_pids()` reports blocking the waiting
  `FOR UPDATE`, filtered to same-role owner tags.

Two strategies were added later for W11 (`--strategy`, alias `--takeover`):

- `claim`: RFC revision 5 §5.2, in one transaction. A no-op `UPDATE … WHERE
  token = T AND lease_until < clock_timestamp()` comes before any
  termination, then the savepoint loop around `FOR UPDATE`. See
  [below](#the-step-2-lease-claim-w11).
- `reread`: revision 3/4's design, kept to demonstrate its hazard. Before
  each termination round, `_owner` is re-read without a lock, and then the
  blockers are terminated.

Lease 3000 ms, renew 500 ms, standby poll 100 ms. **Stated bound:** a standby
commits its takeover within lease + 1000 ms of the owner stopping. That is
the poll, plus the termination waits (about 100 ms per backend, see below),
plus the transaction.

## Environment and rerunning

- PostgreSQL 16.15 at `~/tools/pg16/usr/lib/postgresql/16/bin`
  (`LD_LIBRARY_PATH=~/tools/pg16/usr/lib/x86_64-linux-gnu`), on Linux
  6.8, x86_64.
- Rust 1.97, `postgres` 0.19.14, built offline from the local cargo cache.
- `trust` authentication on the socket and on 127.0.0.1 only. It is a
  throwaway cluster.

```sh
cd snapback4/experiments/postgres-fencing
PGFENCE_DIR=/some/scratch/dir ./run.sh w3     # one witness; starts the cluster if needed
PGFENCE_DIR=/some/scratch/dir ./run.sh all    # all ten, about 4 minutes; transcript in results/all.txt
PGFENCE_DIR=/some/scratch/dir scripts/cluster.sh down   # stop it and remove the socket dir
```

`PGFENCE_DIR` defaults to `${TMPDIR:-/tmp}/pgfence-$USER`. `cluster.sh down`
only stops the cluster whose env file it wrote.

**Roles** (created by `cluster.sh`):

| Role | Purpose |
| --- | --- |
| `sb_super` | Superuser, used by the harness only |
| `sb_ddl` | Table owner, NOLOGIN |
| `sb_core` | Every owner and standby process |
| `sb_other` | An unrelated application role |
| `sb_inspect` | SELECT only |
| `sb_signal` | A member of `pg_signal_backend` |
| `sb_core_member` | A role that is a member of `sb_core` |

## Results

Two complete runs (`results/run1.txt`, `results/run2.txt`) gave the same
verdict on every line. Timings show run 1 / run 2.

| # | Witness | Verdict | Key evidence |
| --- | --- | --- | --- |
| 1 | Same-role termination, no superuser | **PASS** | `sb_core`→`sb_core` terminated. `sb_core`→`sb_other` and `sb_core`→superuser: `42501 permission denied to terminate process` |
| 2 | SIGSTOP takeover, paused in a head tx / a session tx (`FOR SHARE`) | **PASS / PASS** | Takeover 3008/3004 ms and 3038/3036 ms after SIGSTOP (bound 4000). Old-token rows committed after the takeover: 0 in `_log`, 0 in `_sessions`. Paused tx's row absent; head `owner_token` = new |
| 3 | Unlisted paused backend: `pidlist` / `appname` / `blockers` | **FAIL** / **PASS** / **PASS** | `pidlist`: no takeover in 20 s (8 lock timeouts; standby `Lock:transactionid` behind the unlisted pid). `appname`: 3137/3135 ms. `blockers`: 2890/2885 ms. Zero late commits in both passing cases |
| 4 | Stale-token reconnect | **PASS** | Both fenced probes refused, `owner_token_is_2_process_holds_1`. Controls: the head is caught by its predicate, but an *unfenced* session mint **commits** |
| 5 | Lease clock | **PASS** (3 cases) | Takeover lands 327/326 ms after `lease_until` with no skew, and 324/324 ms with the owner at +1 day and the standby at −1 day. An owner with a 0.1× monotonic clock is taken over while alive, and still has 0 late commits |
| 6a | Clean shutdown fast path | **PASS** | Release → takeover in 1–2 ms with the advisory wait. Without it, 485/486 ms (1000 ms poll) |
| 6b | First draft: gate on `pg_advisory_lock` | **FAIL (expected)** | The standby blocked the full 15000 ms against a stopped owner. After `sb_core` terminated the lease backend, it acquired in 0 ms |
| 7 | Safety nets | see below | `idle_in_transaction_session_timeout` rescues the pid list in W7a (PASS, 3035/3034 ms). Neither timeout fires in `ClientWrite`. Keepalives do not detect a stopped process |
| 8 | Fence lock mode | **PASS** (with `KEY SHARE`) | Under `FOR SHARE`, the renewal blocks behind any open fenced tx and a 7 s tx causes a takeover of a live owner. Under `FOR KEY SHARE`, renewals take 0 ms, the takeover `FOR UPDATE` still blocks, and the W2 scenarios pass |
| 9 | COMMIT in flight at termination | **PASS** (fencing), with a failure mode to name | The commit was waiting on synchronous replication. It was durable before the takeover, but the old owner saw `connection closed` |
| 10 | Lock order (fence after `_head`) | **DEADLOCK** | With head first, the takeover gets `40P01 deadlock detected`; with the fence first, no deadlock |
| 11a | Renewal between poll and claim (`claim`) | **PASS** | Claim `rows=0`, abandoned; 0 `TERMINATE` events, 0 server-log terminations; all 3 owner backends alive; the paused fenced transaction committed |
| 11b | Claim first, then renewal (`claim`) | **PASS** (hygiene after commit / in loop) | Renewal `Lock:transactionid`, blocked by the standby, for about 1020 ms. After the takeover it returned `rows=0` (hygiene after commit) or `57P01` (hygiene in the loop). 0 old-token commits after the takeover |
| 11c | Same race, revision 3/4 `reread` | **HAZARD REPRODUCED** (deterministic) | Renewal committed after the unlocked re-read. About 100 ms later the standby had terminated the live owner's fenced backend, then saw `owner_renewed` under `FOR UPDATE` and backed off. The owner lost a write and stopped serving |
| 11d | Fences flow during the claim | **PASS** | 20 `FOR KEY SHARE` probes: mean about 0.6 ms, max under 1 ms; 93–94 owner commits while the claim was held; takeover 158–159 ms after release |
| 11e | Savepoint retention | **PASS** | 4 step-3 `55P03`s. After `ROLLBACK TO SAVEPOINT` the renewal is still blocked by the standby, and a probe `UPDATE` gets `55P03`. `_owner` xmax is a multixact holding `<standby xid>:nokeyupd`. The renewal returns `rows=0` after the takeover |
| 11f | Two claim standbys racing | **PASS** (1 deterministic + 3 free races per run) | The loser's claim blocks behind the winner's (811–812 ms deterministic, about 310 ms free), then `rows=0`. The loser made 0 terminations; every winner backend was alive; one takeover |
| 2, 3, 8, 10 under `claim` | Reruns | **PASS / PASS / PASS / same as before** | W2 3015–3049 ms; W3 3147 ms (tag hygiene) and 2894 ms (blocker termination only); W8 claim lock matrix and slow owner PASS; W10 head-first still `40P01`, fence-first none |

### W1: same-role termination without superuser (PASS)

```
sb_core -> sb_core: ok=true (victim gone: true)
sb_core -> sb_other: DENIED(42501 permission denied to terminate process)
sb_core -> superuser: DENIED(42501 permission denied to terminate process)
sb_core -> sb_core_member (a role that is a member OF sb_core): DENIED(42501 ...)
sb_signal (pg_signal_backend) -> sb_other: ok=true
sb_signal (pg_signal_backend) -> superuser: DENIED(42501 ...)
sb_signal (pg_signal_backend) -> sb_core: ok=true
sb_core_member (member of sb_core) -> sb_core: ok=true
sb_core sees superuser backend: application_name=w1-victim-super state=<null> query=<insufficient privilege>
sb_inspect (SELECT only) SELECT ... FOR KEY SHARE on _owner: DENIED(42501 permission denied for table _owner)
```

What this shows:

- **Same-role termination works without superuser.** `EXECUTE` on
  `pg_terminate_backend` is granted to PUBLIC by default.
- **Membership runs one way.** A member of `sb_core` can terminate `sb_core`
  backends, but `sb_core` cannot terminate its member's.
- **`pg_signal_backend` is far broader than the protocol needs.** It lets the
  role kill every non-superuser backend on the cluster, though still no
  superuser backend. The protocol does not need it and should not ask for it.
- **`application_name` and `pid` of other roles' sessions are visible to
  `sb_core`**, while `state` and `query` are hidden. So any filter on the tag
  must also filter on `usename = current_user`.
- **Row locks need UPDATE privilege.** Both `FOR SHARE` and `FOR KEY SHARE`
  require UPDATE privilege on `_owner`, so a read-only role cannot run the
  fence.

### W2: SIGSTOP takeover (PASS)

From `results/run1.txt`, with the owner paused inside a fenced head
transaction:

```
owner    PAUSING kind=head n=30 seq=30 token=1 pid=1856330 holds=_owner:Share,_head:FOR_UPDATE sleep_ms=3000
SIGSTOP -> owner
  1856330 sb_core sb-owner:A:1  idle in transaction  Client:ClientRead  xid 327480  UPDATE _head SET seq = $1 ...
standby  LEASE_EXPIRED attempt=1 token=1 holder=A lease_until=...02.39762 db_now=...02.424149 backends=[1856329, 1856330, 1856331]
standby  TERMINATE pid=1856329 why=listed ok=true ms=100      (x3)
standby  TOOK_OVER holder=B token=2 from_token=1 ... db_at=...02.72723
standby took over 3008 ms after SIGSTOP
SIGCONT -> owner
owner    COMMIT_FAILED kind=head n=30 ... error communicating with the server
owner    PROBE kind=head fenced=true result=REFUSED owner_token_is_2_process_holds_1
owner    PROBE kind=session fenced=true result=REFUSED owner_token_is_2_process_holds_1
commit-order check: takeover_commit=10:11:02.727017 | _log: old-token rows=29 committed-after-takeover=0
  last-old-commit=10:10:59.708429 new-token rows=143 | _sessions: old-token rows=13 committed-after-takeover=0 ...
  | head seq=172 owner_token=2 | paused-tx rows present: sessions=0 log=0
```

The session-transaction variant passes the same way. Under `FOR SHARE` the
owner's renewals stop as soon as the transaction pauses, because the
renewal's row lock conflicts with its own fence (see W8). That makes the
takeover earlier, not later.

### W3: an unlisted backend (pid list FAILS; tags and blockers PASS)

`--late-conn` opens one connection after `REGISTERED`. That is a lazily
opened or pooled reconnect connection the pid list never learns about. It
pauses holding `_owner FOR SHARE`, and then the owner is SIGSTOPped.

The pid-list standby terminates every listed pid. It then waits on the
unlisted backend for as long as the owner stays stopped: 20 s here, the
harness's cap. There is no bound.

```
  1861664 sb_core sb-owner:A:1  idle in transaction  Client:ClientRead  xid 328001  {}         20302 ms  INSERT INTO _sessions ...
  1861665 sb_core sb-standby:B  active               Lock:transactionid             {1861664}            SELECT token, lease_until < clock_timestamp() FROM _owner ... FOR UPDATE
  _owner: token=1 holder=A backends={1861648,1861654,1861657} lease_until=10:11:12.248993 expired=true
RESULT W3 unlisted-backend/pidlist FAIL :: took_over_after_stop=NEVER | BLOCKED: no takeover in 20000 ms | standby lock timeouts=8
```

The two alternatives both pass:

- **`appname` (3137 ms):** the standby terminates all four `sb-owner:A:1`
  sessions, including the `idle_in_transaction` one.
- **`blockers` (2890 ms):** the standby terminates exactly one session, the
  one `pg_blocking_pids` names: `TERMINATE pid=1874988
  why=blocker:sb-owner:A:1`. The old owner's other sessions are left alive
  and refuse on their next fence:
  `COMMIT_FAILED kind=head … REFUSED owner_token_is_2_process_holds_1`.

That second run shows that **only sessions holding the `_owner` lock need
terminating for safety**. Every other old-owner session refuses by itself.
The `blockers` run also shows a hygiene gap: the new owner reports
`advisory=false`, because the stopped old lease connection still holds the
fast-path advisory lock. Tag-based termination releases it.

### W4: reconnect with a stale token (PASS)

Both fenced probes refuse. The controls, which are the same writes without
the fence, show what the fence adds:

```
PROBE kind=head fenced=false(control) result=REFUSED head_owner_token_predicate
PROBE kind=session fenced=false(control) result=COMMITTED value="control-A-1"
```

**Isolation corollary.** A transaction can begin before the token increment
and run its fence after it:

- under READ COMMITTED (what the adapter's serialized writer uses), the fence
  re-reads and sees the new token;
- under REPEATABLE READ it raises `40001 could not serialize access due to
  concurrent update`.

Both refuse. A serializable writer's retry loop must not hide that `40001`:
its retry will see the new token and refuse.

### W5: the lease clock (PASS)

No protocol decision reads a host wall clock:

- `lease_until` is written as `clock_timestamp() + lease`;
- expiry is tested as `lease_until < clock_timestamp()`, both in the poll and
  again under `FOR UPDATE`;
- the fence compares tokens only.

The host's monotonic clock drives only the renewal cadence and the standby's
poll. The `LD_PRELOAD` shim skews `clock_gettime`, `gettimeofday` and `time`.
`HOST_CLOCK host_minus_db_s=86400` and `-86400` confirm it took effect.

| Case | Takeover commit − `lease_until` (DB clock) | SIGSTOP → takeover (harness) |
| --- | --- | --- |
| No skew | 327 / 326 ms | 3323 / 3322 ms |
| Owner +1 day, standby −1 day (realtime) | 324 / 324 ms | 3319 / 3320 ms |

**A slow host clock.** With the owner's monotonic clock at 0.1×, renewals
come 10× late. The standby then takes over a **live, unpaused** owner. That
owner was still committing 76 ms before the takeover and committed nothing
after it (`last-old-commit=…07.571278`, `takeover_commit=…07.647503`,
committed-after-takeover=0). So a skewed or stalled host clock costs
availability, never safety.

### W6: the advisory lock

- **6a (PASS).** The owner stops cleanly: it sets `lease_until = '-infinity'`,
  then calls `pg_advisory_unlock`. A standby blocked in `pg_advisory_lock`
  (with `lock_timeout` = its 1000 ms poll) commits the takeover 1–2 ms after
  the release. Without the advisory wait the same standby takes 485/486 ms.
- **6b, the first draft (FAIL as expected).** The owner is SIGSTOPped while
  holding its session advisory lock. A standby gated on `pg_advisory_lock`
  waited until `statement_timeout` (15000 ms). `sb_core` then terminated the
  lease backend, step 1 of the new protocol, and the lock was acquired in
  0 ms.

### W7: complementary safety nets (what each does and does not cover)

| Mechanism | Paused owner, backend idle in tx | Paused owner, backend `active`/`ClientWrite` | Host dead or partitioned |
| --- | --- | --- | --- |
| `idle_in_transaction_session_timeout=2s` | **Covers it.** Server log: `FATAL: terminating connection due to idle-in-transaction timeout` 2 s after the pause. The pid-list standby then took over in 3035/3034 ms (W7a PASS) | Does not fire: 6 s later the backend was still `active / ClientWrite` | Covers it once the backend is idle in tx |
| `statement_timeout=2s` | Not applicable: it is not a statement | **Does not fire** in `ClientWrite`: the backend was still there after 6 s | Same |
| `tcp_keepalives_idle=1, interval=1, count=2`, `tcp_user_timeout=3s` | **Does not detect it.** All 3 owner TCP backends were alive 10 s after SIGSTOP, because the stopped process's kernel answers probes | Same | Designed for this case (not run: partitioning needs root) |
| `pg_terminate_backend` by `sb_core` | Works (W2) | **Works**: gone in 100 ms (W7b) | Works |
| Process death (`SIGKILL`) | All backends gone in 21 ms (the kernel closes the sockets) | — | — |

So `idle_in_transaction_session_timeout` on the serving role is a useful
backstop, but it is not a substitute for termination. It cannot see a
backend that is blocked writing to a stopped client. That backend holds the
fence lock exactly as long.

### W8: `FOR SHARE` versus `FOR KEY SHARE`

The `_owner` row sees three lock requests: the fence (one of two modes), the
renewal (a plain `UPDATE` of non-key columns, which takes
`FOR NO KEY UPDATE`), and the takeover (`SELECT … FOR UPDATE`).

| Fence lock held | Renewal `UPDATE` | Takeover `FOR UPDATE` (taken after the renewal) |
| --- | --- | --- |
| `FOR SHARE` | **blocked** (`55P03` after 1000 ms) | blocked (correct) |
| `FOR KEY SHARE` | renewed in 0 ms | **blocked (correct)**: the key-share lock survives the renewal's new row version |

What this table means in practice:

- **Under `FOR SHARE`, renewal is serialized behind every in-flight fenced
  transaction.** With 8 writers and no think time, renewals took a mean of
  137 / 61 ms and a maximum of 379 / 145 ms. Under `KEY SHARE` they took
  0 ms, maximum 1 ms.
- **A single 7 s transaction under `FOR SHARE`** stalls renewal until the
  lease lapses. The standby then takes over an owner that was slow but alive
  (`SPURIOUS-TAKEOVER`). Under `KEY SHARE` there is no takeover; the slow row
  commits and the owner keeps serving (`slow-tx row committed=1`, in
  `results/w8.txt`).
- **The W2 SIGSTOP scenarios pass under `KEY SHARE`**: 3005/2990 and
  3035/3036 ms, 0 late commits.
- **Caveat.** Under `KEY SHARE`, the token increment must be taken with an
  explicit `SELECT … FOR UPDATE`. A plain `UPDATE _owner SET token = …` has
  the same lock shape as the renewal, which W8a shows does *not* wait for
  key-share holders. It would therefore break the fence.

Reporting note: in `run1` and `run2` the `slow-owner/keyshare` line printed
`slow-tx row committed=0`. That was a harness bug: the row id was read from
an unset field. It was fixed, and W8 was rerun into `results/w8.txt`, which
shows `committed=1`. The verdict did not change.

### W9: a COMMIT in flight when termination arrives

`synchronous_standby_names = 'phantom'` is set (no standby ever answers). One
owner transaction commits with `synchronous_commit = on`, so it is durable
locally and then waits in `IPC:SyncRep`. The owner is then SIGSTOPped. The
server log at termination:

```
WARNING:  canceling the wait for synchronous replication and terminating connection due to administrator command
DETAIL:  The transaction has already committed locally, but might not have been replicated to the standby.
```

The outcome:

- The row exists with the old token. Its commit timestamp is 3 s before the
  takeover's commit. This standby used the pid list, so it terminated the
  session before its own `FOR UPDATE` ran, and no lock wait was observed here.
  The statement that a commit waiting on synchronous replication keeps its
  locks until the wait ends comes from Postgres's commit sequence, not from
  this run.
- No old-owner commit landed after the takeover. **Fencing holds.**
- The old owner never got an acknowledgement (`connection closed`).

This is the general shape of the window: a commit can race termination and
succeed while its client sees an error. Synchronous replication, the
configuration §5 requires for same-incarnation failover, makes the window
seconds wide instead of microseconds.

### W10: lock order

`engine/postgres/store.rs` `transaction()` takes `SELECT seq FROM _head …
FOR UPDATE` as its first statement. If the fence comes *after* that lock,
the order inverts against the takeover, which locks `_owner` and then
`_head`:

```
head-first:  owner tx: fence read token=0 after 702 ms; takeover tx: 40P01 deadlock detected after 1002 ms
fence-first: takeover tx: committed after 300 ms (waited for the owner tx, no deadlock)
```

The inverted order is not unsafe: the deadlock victim was the takeover, and
the owner's commit was ordered before it. But a takeover can keep losing
deadlocks to a live owner.

## The step-2 lease claim (W11)

RFC revision 5 changed takeover after round 4 (Grok N2). W8 showed that a
renewal (`FOR NO KEY UPDATE`) is not queued behind a waiting `FOR UPDATE`
when only key-share locks are held. So the revision-3/4 rule, "re-read
`_owner` without a lock before each termination round", leaves a window. A
renewal can commit between the re-read and the termination, and the standby
then kills a live owner. Revision 5 first claims the expired lease with a
statement that the renewal does conflict with:

```sql
BEGIN;
UPDATE _owner SET lease_until = lease_until
 WHERE singleton AND token = $T AND lease_until < clock_timestamp()
 RETURNING token;                     -- 0 rows: abandon, terminate nothing
SAVEPOINT step3;
SELECT token, lease_until < clock_timestamp() FROM _owner WHERE singleton FOR UPDATE;
  -- lock_timeout; a watcher terminates token-bounded same-role tagged blockers;
  -- on 55P03: ROLLBACK TO SAVEPOINT step3 and retry
UPDATE _owner SET token = $T + 1, holder = …, lease_until = clock_timestamp() + lease …;
UPDATE _head SET owner_token = $T + 1;  INSERT INTO _takeovers …;
COMMIT;
```

`node --strategy claim` implements this in `takeover_claim()`. The step-2
claim has its own `lock_timeout` (`--claim-lock-timeout-ms`, default
5000), and a timeout there abandons the attempt without terminating
anything. Step 5, the tag-based hygiene sweep, is placed by `--hygiene loop`
(the default, as §5.2 lists it), `after` (after the commit) or `off`. Every
W11 owner and standby fences with `FOR KEY SHARE`.

**Interleavings are engineered, not hoped for.** `--hold
after_poll,after_claim,after_reread,after_savepoint_rollback` makes a node
print `HOLD at=<point>` and block on stdin until the harness releases it.
Each hold fires once. The owner's lease is made to lapse by a SIGSTOP while
the owner is inside a fenced session transaction (`--pause
session:12:10000`). A SIGCONT then makes its lease thread renew at once. The
harness confirms the renewal committed by polling `_owner` as the superuser
before it releases the standby.

Terminations are counted two ways: the node's own `TERMINATE` events, and
server-log lines `terminating connection due to administrator command`
appended during the witness window.

Run: `witness w11` (W11a–f), `witness claim-reruns` (W2, W3, W8 and W10
under `claim`), or `PGFENCE_DIR=… ./run.sh w11 claim-reruns`. Together
they take about 4 minutes. Three runs (`results/claim-run{1,2,3}.txt`) gave identical
verdicts. The figures below are from runs 1 and 2.

### W11a: the renewal commits between poll and claim (PASS)

```
[ 3.050] standby  LEASE_EXPIRED attempt=1 token=1 holder=A lease_until=…:16.265574 db_now=…:16.295246
[ 3.050] standby  HOLD at=after_poll token=1
[ 3.052] SIGCONT (the owner's lease thread renews at once) -> owner
[ 3.062] renewal committed: token=1 lease_until=…:19.297174 (now in the future)
[ 3.064] RELEASE after_poll -> standby
[ 3.065] standby  CLAIM rows=0 token=1 waited_ms=0 terminated=0 -> abandon
[ 3.065] standby  TAKEOVER_ABORTED why=claim_zero_rows
[10.314] owner    RESUMED kind=session n=12 id=A-1-s0-12
RESULT W11a … PASS :: … standby TERMINATE events=0 | server-log terminations in window=0 |
  owner backends before=[1132821, 1132824, 1132825] after=[1132821, 1132824, 1132825] | owner LOST=[] |
  paused fenced tx resumed=true committed=1 | _owner.token=1
```

The paused fenced transaction would have been the step-4 victim. It
survived, finished its 10 s pause and committed.

### W11b: the claim first, then the renewal (PASS)

The standby holds after a successful claim, and the owner is resumed:

```
standby  CLAIM rows=1 token=1 waited_ms=0 db_at=…
SIGCONT (claim held: renewal should block, fences should not) -> owner
while the claim is held: renewal pid=…688 wait=Lock:transactionid blocked_by=[<standby>] waiting_for=1019ms
RELEASE after_claim -> standby
standby  FOR_UPDATE acquired_ms=153 step3_timeouts=0 token=1 expired=true
standby  TOOK_OVER holder=B token=2 …
owner    RENEWAL n=1 took_ms=1180 rows=0
owner    LOST token=1 renewal_refused_token_moved
owner    PROBE kind=head fenced=true result=REFUSED owner_token_is_2_process_holds_1
commit-order check: … _log: … committed-after-takeover=0 … _sessions: … committed-after-takeover=0 …
  paused-tx rows present: sessions=0 log=0
```

With `--hygiene loop`, the step-5 sweep terminates the waiting renewal's
connection before the commit. The owner then learns from
`RENEWAL … rows=error err=57P01` instead of from zero rows. The renewal was
blocked for the same 1020 ms, and there were 0 late commits. Both are
losses, and neither lets the renewal succeed.

### W11c: the same race under the revision-3/4 re-read (HAZARD REPRODUCED)

`--strategy reread --hold after_reread`. The standby's `FOR UPDATE` waits
on the paused fenced transaction. Its watcher re-reads `_owner` (still
expired) and holds. The owner is resumed and renews. Then the watcher is
released:

```
[34.656] standby  REREAD result=still_expired token=1 lease_until=…:47.862198 db_now=…:47.901218 blockers=[(1134849, "sb-owner:A:1")]
[34.656] standby  HOLD at=after_reread token=1
[34.658] SIGCONT (the owner renews while the standby's FOR UPDATE waits) -> owner
[34.669] renewal committed: token=1 lease_until=…:50.904067 (now in the future)
           1134856 sb_core sb-standby:B  active  Lock:transactionid  {1134849}  SELECT token, lease_until < clock_timestamp() FROM _owner … FOR UPDATE
           _owner: token=1 holder=A … lease_until=…:50.904067 expired=false
[34.671] RELEASE after_reread -> standby
[34.772] standby  TERMINATE pid=1134849 why=blocker:sb-owner:A:1 ok=true ms=100
[34.823] standby  TAKEOVER_ABORTED why=owner_renewed
[41.910] owner    COMMIT_FAILED kind=session n=12 pid=1134849 DB_ERROR error communicating with the server
[41.910] owner    LOST token=1 session_write_failed n=12
[41.926] owner    PROBE kind=head fenced=true result=COMMITTED value=688
```

So a renewal can commit while a `FOR UPDATE` waits. Here it did, and the
standby still terminated the live owner's backend. It issued the
termination 2 ms after the renewal was confirmed, and the backend was gone
100 ms later. The
standby's own check under `FOR UPDATE` then found the lease renewed, and it
backed off. The owner's probe afterwards *committed* under token 1, which
confirms that no takeover happened: the owner was healthy and lost a
transaction for nothing. (This prototype's owner treats any failed write as
a loss of ownership and stops serving. A real owner might retry instead, but
the in-flight write is gone either way.) Safety held; this is a liveness
and availability defect, which is what Grok N2 predicted. It reproduced in
all three runs.

### W11d: fences keep flowing during the claim (PASS)

The same run as W11b (hygiene after the commit). While the claim was held,
a separate `sb_core` connection ran 20 fenced transactions (`BEGIN; SELECT
token … FOR KEY SHARE; COMMIT`, 25 ms apart):

| | run 1 | run 2 |
| --- | --- | --- |
| Probe fence latency, mean / max | 605 / 950 µs | 614 / 963 µs |
| Token read by every probe | 1 | 1 |
| Owner commits with token 1 after the claim and before release | 94 | 93 |
| Claim held after SIGCONT | 1021 ms | 1022 ms |
| Release → takeover commit (step 3 + 1 termination + commit) | 158 ms | 159 ms |

The claim stalls only the renewal. Ordinary fenced writes run at full speed
until step 3 and its terminations. The W8 lock matrix (below) shows why that
is safe: a fence granted *during* the claim locks the pre-claim row version,
and the lock still blocks step 3's `FOR UPDATE` on the claim's new version.

### W11e: the claim survives ROLLBACK TO SAVEPOINT (PASS)

`_owner` is set to token 1 with a lapsed lease, and no owner process runs.
A same-role connection that is **not** owner-tagged holds `FOR KEY SHARE`,
so the standby skips it (`BLOCKER_SKIPPED`), and step 3 times out with
`--takeover-lock-timeout-ms 300`. A token-1 renewal is issued after the
claim. The standby holds right after its first `55P03` and `ROLLBACK TO
SAVEPOINT`, in state `idle in transaction`:

```
[42.851] standby  LOCK_TIMEOUT step=3 n=1 waited_ms=300 rolled_back_to_savepoint=true
[42.851] standby  HOLD at=after_savepoint_rollback n=1
[43.157] after ROLLBACK TO SAVEPOINT: renewal state=active wait=Lock:transactionid blocked_by=[1135840];
           standby state=idle in transaction xid=11455; committed _owner row xmax=2515
           multixact members=[11454:keysh,11455:nokeyupd]; probe update: 55P03 canceling statement due to lock timeout
[43.459] standby  LOCK_TIMEOUT step=3 n=2 … [43.760] n=3 … [44.061] n=4
[44.359] after further step-3 timeouts: renewal state=active wait=Lock:transactionid blocked_by=[1135840]
RESULT W11e savepoint-retention PASS :: … renewal finished rows=0 after 2150 ms, after the takeover commit=true
```

The claim's row lock belongs to the top-level transaction: the committed
row's xmax is a multixact of the blocker's `keysh` and the standby's
top-level xid as `nokeyupd`. The savepoint covers only the `FOR UPDATE`.

Honesty note: the first W11e run (not saved; it ran before the recorded
transcripts) reported FAIL. The harness had compared `xmax` with the
standby's xid directly, and `xmax` is a MultiXactId whenever a key-share
locker is present. Every behavioural check in that run passed: the renewal
stayed blocked through 4 timeouts, the probe got `55P03`, and the renewal
returned `rows=0` after the takeover. The check now expands the multixact
with `pg_get_multixact_members` and requires the standby's xid as
`nokeyupd`.

### W11f: two standbys racing (PASS)

Deterministic. B and C both observe the expiry and hold. B is released, and
it claims and holds. C is released:

```
C's claim while B holds its claim: wait=Lock:transactionid blocked_by=[<B>] query=UPDATE _owner SET lease_until = lease_un
standbyB TOOK_OVER holder=B token=2 …
standbyC CLAIM rows=0 token=1 waited_ms=812 terminated=0 -> abandon
RESULT W11f two-standbys/deterministic PASS :: … C TERMINATE events=0 | B (sb-owner:B:2) backends before=[…] after 2 s=[…] (identical) |
  B LOST=[] | _takeovers=["1:A", "2:B"] | … committed-after-takeover=0 … committed-after-takeover=0
```

There were three free races per run, with no holds and two pollers. Both
standbys won at least once across the runs. Every loser's claim blocked
behind the winner's whole takeover (308–311 ms: step 3, the terminations
and the commit) and then returned `rows=0`. The losers made 0 terminations,
there was one takeover, and every winner backend survived.

### Reruns under the claim strategy

| Witness | Verdict (runs 1, 2) | Evidence |
| --- | --- | --- |
| W2 SIGSTOP, paused in a head / session tx | **PASS / PASS** | 3015/3016 ms and 3049/3049 ms (bound 4000). 0 late commits. Claim `rows=1 waited_ms=0`, `FOR UPDATE` after 304 ms (3 hygiene terminations at about 100 ms each) |
| W3 unlisted paused backend, hygiene in the loop | **PASS** | 3147/3147 ms. The tag sweep terminated all four `sb-owner:A:1` sessions, including the unlisted one |
| W3 unlisted paused backend, `--hygiene off` | **PASS** | 2894 / 2899 ms (runs 2 and 3; added after run 1). Only `TERMINATE … why=blocker:sb-owner:A:1`: blocker termination alone suffices after the claim |
| W8 lock matrix with the claim | **PASS** | See below |
| W8 slow owner (one 7 s fenced tx, `KEY SHARE`) | **PASS** | No claim, no takeover, slow-transaction row committed, owner still serving |
| W10 lock order | **head-first DEADLOCK, fence-first none**, as before | head-first: the claim takeover gets `40P01` after 1002 ms; fence-first: commits after 301 ms |

The W8 lock matrix with the claim (`FOR KEY SHARE` fences, `lock_timeout`
1000 ms). Every run gave the same outcomes; timings varied by at most
1 ms:

| Step | Result |
| --- | --- |
| Fence F1 before the claim | granted, 0 ms |
| Claim (no-op `UPDATE`) with F1 open | **granted, 1 row, 0 ms** |
| Renewal while the claim is held | **blocked** (`55P03`) |
| New fence F2 while the claim is held | **granted, 0 ms** |
| `FOR UPDATE` (in a savepoint) with F1 and F2 open | blocked (`55P03`) |
| Renewal after `ROLLBACK TO SAVEPOINT` | **still blocked** (`55P03`) |
| `FOR UPDATE` with only F2 (taken during the claim) open | **blocked** (`55P03`) |
| `FOR UPDATE` with no fence open | granted |
| Renewal after the token increment commits | 0 rows |

The row "only F2 open" is the safety-critical one. F2 was granted on the row
version the claim had already superseded. Postgres carries a `SELECT … FOR
KEY SHARE` lock forward along the update chain, so the claimer's `FOR
UPDATE` on its own new version still waits for F2. That is consistent with
W11b, W11d and W11f, which all show 0 old-token commits after the takeover
while fences flowed during the claim.

## Privileges discovered

The serving role needs:

- `SELECT, INSERT, UPDATE` on `_owner`, `_head` and the durable tables.
  **UPDATE on `_owner` is required for the fence**, because row-level
  `FOR SHARE` and `FOR KEY SHARE` need it (W1);
- `EXECUTE` on `pg_terminate_backend` (granted to PUBLIC by default) and on
  `pg_blocking_pids`;
- visibility of `pg_stat_activity`, which every role has for its own role's
  sessions.

It does not need superuser, `pg_signal_backend` (which it should not be
given) or `pg_read_all_stats`.

Every owner and standby of a store must run as the **same** role. A member
role can terminate the base role, but not the reverse. Because `sb_core` can
terminate every `sb_core` session, two stores that share a role can
terminate each other's sessions. Filtering by tag alone does not separate
them, since tags are client-chosen; either the tag must carry the store id
or the role must be per store.

## Managed providers (documentation only, NOT run)

No provider was contacted, and no account or database was created. The
claims below come from provider documentation, gathered by a research
subagent. They are **UNVERIFIED** against a live instance.

| | Same-role `pg_terminate_backend` | Default pooler | Session advisory locks / `application_name` through the pooler | Failover replication | `track_commit_timestamp` |
| --- | --- | --- | --- | --- | --- |
| RDS / Aurora | `rds_superuser` holds `pg_signal_backend` (PG16+). Same-role termination is vanilla behaviour (inferred) | RDS Proxy is opt-in | Advisory locks *pin* the session in RDS Proxy | Multi-AZ instance: synchronous. Multi-AZ cluster: semi-synchronous (one reader acknowledges). Aurora: storage quorum (quorum size not confirmed on the page read) | Custom parameter group |
| Cloud SQL | Documented as needing `pg_signal_backend`, which can be granted. Same-role not stated | Managed pooling is opt-in; default mode is transaction; session mode and direct port 5432 exist | Unsupported in transaction mode | HA: synchronous to two zones | A supported flag |
| Supabase | Docs say "superuser, `pg_signal_backend`, or your own session". **Test same-role explicitly** | Supavisor transaction mode (port 6543) is recommended for serverless; direct connections and session mode exist | Lost in transaction mode | Read replicas asynchronous. Automatic primary failover not documented | Configurable, needs a restart |
| Neon | `neon_superuser` holds `pg_signal_backend` | PgBouncer transaction mode is on by default for new projects; a direct string exists | Unsupported via the pooler | Safekeeper quorum | **Not supported**: these witnesses' commit-order check could not run there, though the protocol does not depend on it |

On every provider, the owner and standby must connect directly or in session
mode. Under transaction pooling, a server pid and its `application_name`
belong to whichever client is in a transaction at the moment, so terminating
a pid does not identify the old owner.

## What the RFC should change

Each change cites the witness that drives it.

1. **Replace the `backends` pid list.** Driver: W3, a FAIL that blocks
   forever. Takeover should loop with a bounded wait:
   1. Take `SELECT … FROM _owner FOR UPDATE` with `lock_timeout`.
   2. While it waits, terminate every session `pg_blocking_pids()` reports
      that is same role and tagged as an owner. This step alone is
      sufficient for safety and needs no registration.
   3. Also terminate every same-role session tagged
      `sb-owner:<store>:<holder>:<token ≤ observed>`. This is for hygiene:
      it frees the stale advisory lock and connections.
   4. Retry on `55P03`; never wait unbounded.

   The tag must carry the token so a slow standby cannot kill a newer
   owner's sessions. It must fit in 63 bytes (`NAMEDATALEN`), and the filter
   must include `usename = current_user` because tags are visible across
   roles (W1).
2. **Fence with `FOR KEY SHARE`, and take the token only with explicit
   `SELECT … FOR UPDATE`** (W8). Under `FOR SHARE`, the lease renewal queues
   behind every in-flight durable transaction. That stretches renewal
   latency, and one long transaction causes a takeover of a live owner.
   `KEY SHARE` keeps the fence (the takeover still waits) and frees the
   renewal. It is correct only if the token is never changed by a plain
   `UPDATE`.
3. **The fence must be the first lock of every writing transaction**, before
   `_head FOR UPDATE` (W10). Today `store.rs` `transaction()` takes the head
   first; adding the fence after it deadlocks with takeover.
4. **Name the ambiguous commit** (W9). A COMMIT racing termination can be
   durable while its client sees an error. This happens for seconds under
   synchronous replication. Fencing still orders it before the takeover. But
   every write path must be retry-safe across owners, through receipts or
   idempotency keys, and the new owner must treat whatever is committed as
   committed.
5. **Use `clock_timestamp()`, not `now()`**, for `lease_until` and the expiry
   test, and re-test expiry and token under `FOR UPDATE` in the takeover
   transaction (W5). `now()` is transaction start, so a renewal that waited
   on a lock would write a lease that is already shorter than intended
   (reasoning; the prototype uses `clock_timestamp()` throughout). The
   host clock may drive cadence only. The RFC should say that a slow host
   clock costs availability, not safety.
6. **State the takeover bound**: lease + poll + termination + transaction.
   Here that was 3.0–3.3 s for a 3 s lease. Issue every
   `pg_terminate_backend(pid)` first and wait once. The PG14+
   `pg_terminate_backend(pid, timeout)` form waits in 100 ms steps, which
   cost 100 ms per backend in series here.
7. **Grants and roles** (W1). The serving role needs UPDATE on `_owner` for
   the fence, and no `pg_signal_backend`. Every process of a store must run
   as one role, and stores sharing a role must be separated by the tag's
   store id. `doctor` should verify same-role termination on the provider
   (Supabase's documentation is ambiguous here) and refuse transaction-mode
   poolers for both owner and standby connections, not only the owner.
8. **Add `idle_in_transaction_session_timeout` on the serving role as a
   backstop, not a mechanism** (W7). It does not cover a backend blocked in
   `ClientWrite`, and neither does `statement_timeout`. TCP keepalives do not
   detect a paused process at all.

9. **The step-2 claim (revision 5) holds up; three wording changes** (W11).
   Nothing in §5.1–§5.2 is contradicted. The claim is granted beside
   in-flight fences, blocks the renewal, keeps its lock across `ROLLBACK TO
   SAVEPOINT`, and fences granted during it still order before the token
   change (W8 claim matrix). The wording changes:
   1. **Step 5 versus "matches zero rows".** If the hygiene sweep runs
      inside the loop, as listed, it terminates the old owner's waiting
      renewal connection. The owner then learns of the loss from `57P01`,
      not from zero rows (W11b, hygiene in the loop). Both are safe. Either
      say "fails or matches zero rows", or run the sweep after the commit.
      It is only hygiene: blocker termination alone took over in 2894 ms
      (W3, `--hygiene off`).
   2. **Give step 2 its own `lock_timeout` and say what 55P03 means.** The
      claim waits behind another standby's claim for that standby's whole
      takeover: 308–812 ms here, so in general step 3's wait plus the
      terminations. A claim that times out has terminated nothing and
      should abandon like zero rows. "Zero rows: … or another standby won"
      should read "blocks, then zero rows" (W11f).
   3. **State the dependency on `FOR KEY SHARE`.** The claim is granted
      beside fences only because `FOR NO KEY UPDATE` does not conflict with
      `FOR KEY SHARE`. Under the first draft's `FOR SHARE` fence, Postgres's
      lock-conflict table says the claim itself would wait on every
      in-flight fence. That is reasoning from the documentation; it was not
      run.

Still open after this prototype; none of these were run:

- a real network partition;
- provider failover, including the database clock moving between hosts at
  promotion, which leaves a `lease_until` computed on the old primary;
- PgBouncer in session mode;
- several standbys racing under the older strategies. W11f covers two
  standbys under `claim` only;
- `kill -9` of the owner followed by takeover. W7 shows only that the
  backends vanish in 21 ms; a takeover still waits for the lease.
