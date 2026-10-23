# RT6 — serving B2(a) flights

Base `a025d67cd3`, branch `sb4-pg/rt6`, expo-build-450a. No push.
The [predictions](./CONTEXT.md) precede code; [counts](./counts.json) retain
previous, warm and first-use measurements. Raw logs stay outside Git in
`/tmp/rt6-evidence` on this host. Qualification results, including retained
experimental and timing failures, are recorded below.

The Postgres serving adapter now sends ordered SimpleQuery messages containing
typed EXECUTEs through the RT5 encoder. SQLite's implementation and RT0 table
are unchanged. No class increases. These are serving flight counts and outcome
witnesses, not a latency/SLO or publication claim.

| Class | Previous | Predicted | Measured warm |
| --- | ---: | ---: | ---: |
| W1 / account W1 | 6 | 3 | 3 |
| W2 newest 20 | 6 | 2 | 2 |
| Unkeyed increment / account increment | 16 | 8 | 8 |
| One membership mutation | 17 | 9 | 9 |
| Keyed first attempt | 24 | 9 | 9 |
| Replay hit | 5 | 2 | 2 |
| Action W1, complete resolver | 19 | ≤19 | 17 |
| Unknown operation / narrowed argument | 4 | 2 | 2 |
| Unknown token | 1 | 1 | 1 |
| Unauthenticated / rate limited | 0 | 0 | 0 |

Every warm class has three equal samples. The initial complete serving run
reached all expected outcomes and then failed the intentional lower-the-table
assertion; the Postgres table was lowered to those measurements. The final
Postgres selector passes all three tests; the stock script repeats it
successfully. SQLite's final ratchet also passes against its unchanged table.

RT0 also checks outcomes: W1/account/action return HTTP 200 and `m24`; W2
returns HTTP 200 with exactly twenty rows ordered `m24` through `m5`.
Unkeyed/account/membership writes return HTTP 200 and `sent`. Keyed first is
`sent` without replay; replay sets `replayed=true` and preserves its sequence.
Unauthenticated/unknown-token requests return 401 `E_AUTH`; unknown operation
returns 404 `E_OP`; narrowed arguments return HTTP 200 with `E_INPUT`.
Both metadata refusals retain the correct store identity. Rate limiting returns
429 `E_RATE_LIMIT`. All those assertions pass with the measured counts.

## Flight contents and client boundaries

- **W1 (3):** ingress authority; BEGIN + authority facts + row; membership
  probe + ROLLBACK. Rust resolves authority after the first snapshot flight,
  before fetching the dependent membership. The interpreter performs its
  ordinary rule checks and logical meter charges over exact physical answers.
- **W2 (2):** ingress; BEGIN + authority + fixed-address membership + page +
  ROLLBACK. Arguments and pinned prefix columns determine the addresses.
- **Increment (8):** ingress; BEGIN + owner fence; head lock + generation +
  authority; member/program savepoints + first read; UPDATE; read; program
  release + tail + member release + timeout settings; COMMIT.
- **Keyed first (9):** ingress; unfenced BEGIN + authority + bound receipt +
  ROLLBACK; the increment's seven post-ingress flights. Writer setup additionally
  contains a distinct receipt re-check and the existing asset-placement fact
  lookup, both after the head lock. Receipt INSERT and binding UPDATE ride in
  the tail flight and each must affect one row.
- **Replay (2):** ingress; that unfenced preflight. Store-binding comparison
  and shared bound-receipt policy retain precedence over returning the receipt.
- **Membership mutation (9):** increment plus its dependent program membership
  read. **Metadata refusals (2):** ingress plus the authority snapshot folded
  with framing. **Unknown token (1)** and the two zero-flight refusals retain
  their ingress behavior. **Action W1 (17)** retains every complete-resolver
  read; two BEGIN messages now ride with their first command.

For the RT0 action fixture, those 17 flights are: ingress projection;
BEGIN + authority facts; claimed work; principal generation; latest live
family member; worker-session-family metadata; worker-family-revision metadata;
ROLLBACK; BEGIN + authority facts; claimed work; principal generation; latest
live family member; worker-session-family metadata; worker-family-revision
metadata; W1 row; membership probe; ROLLBACK. The five complete-resolver reads
at each boundary remain separate because they depend on preceding facts.

Savepoints ride with the first program read rather than moving ahead of the
shared authority/time/placement checks. This preserves their semantic position
while meeting the eight/nine-flight schedules. Every client count check,
member disposition and tail count precedes the separate COMMIT flight.
A pre-COMMIT transport failure remains a definite abort; acknowledgement loss
after COMMIT retains the existing unknown-outcome classifier and carries no
publication facts.

Only fixed-address, bounded ordinary read shapes use the physical planner.
Unsupported scans, actual-size decoders, maintained/recorded/lifetime surfaces,
private field gates, nested probes and unnamed credential kinds retain ordinary
snapshot access. Planning reuses the existing 4 MiB exact-prefetch allowance;
larger declarations/fanouts fall back. A changed credential kind or newly
installed optional session storage invalidates the hint: any closed speculative
cut and all its answers are discarded, and the complete resolver/program share
one fresh snapshot. No result combines the two cuts. The context's explicit
credential hint is separate from the interpreter's principal kind.

## Codec and connection obligations

Every physical ownership/lease/reader connection and every raw evaluation
Store before its first BEGIN pins and verifies `client_encoding=UTF8`,
`extra_float_digits=3`, `bytea_output=hex`. Both writer isolation levels also
explicitly request READ WRITE, preserving the previous transaction builder's
behavior on connections whose default is read-only. Ordinary ingress remains a single
Bind statement. Flight values, optional scalars and arrays all use the same
RT5 encoder, including the current tail's 27 arguments (eighteen arrays plus
change-evidence fields). Parent §9.1 rule 5 now explicitly permits both Bind
and this typed EXECUTE path.

The encoder admits at most 32 MiB of aggregate encoded command text inside
the existing 256 MiB physical adapter envelope. Binary input length, array
Datum allocation, encoded value bounds, per-command construction and aggregate
flight size are checked. A refusal poisons the transaction. This changes no
public interpreter ceiling. Cold setup statements are prepared before BEGIN so Parse/PREPARE relation
locks cannot precede the head lock. The adoption witness checks this with an
ACCESS EXCLUSIVE NOWAIT session-table lock while the contender waits.
SQL PREPARE names are unique across Store wrappers
on one physical Client, including wrappers discarded during attach/evaluation.

The RT5 native-Bind differential oracle now also decodes through serving's
Row adapter with the driver's FromSql implementations, for every scalar/array
port type. Exact non-NaN float bits, signed zero and the specified canonical
NaN bits remain checked. The extension also executes the actual authority,
head/generation, row, membership/page, receipt, placement, UPDATE and full
current tail statements. The tail compares durable native-Bind and literal
images after separate savepoint executions. No historical-result replay
semantics were changed: receipts still omit result/current payloads.
The actual statements also run with RT5's hostile shadow schema: authority
NULLs and tail array types are catalog-qualified. The original multi-array
unnest [FROM syntax](https://www.postgresql.org/docs/16/functions-array.html)
remains intact. Native execute retains Bind fallback for
unsupported ignored output payloads, witnessed by a numeric result.

## Witness results

The expanded RT5 + RT6 group passes **19/19** in C and en_US.utf8, including
scratch refusal, cold preparation lock order and local-argument shadowing
fallback. Targeted rewrap/shape/tail regressions also pass.
The full qualification repeats this group.

Fault insertion covers **39 command boundaries** across the folded messages.
The final ownership run separately checks COMMIT loss and a durable receipt
whose acknowledgement is lost; both preserve the previous classification.

- Owner first: the contender is observed blocked on `_owner`; the holder can
  still acquire `_head NOWAIT`. Changing the token refuses the keyed request
  with retryable `E_STORE_OWNERSHIP`, without an operation receipt.
- Generation: an actual Engine adoption holds the head until
  `pg_blocking_pids(waiter)` names it. The waiting serving mutation then sees
  generation 2 and returns `E_GENERATION` without executing or recording it.
- Receipt: the first authorized copy holds the head; the second is observed
  waiting. After the first commits, the second's distinct post-lock command
  sees its receipt. Exactly one increment, receipt and evidence record commit.
- Statement errors are inserted at every command boundary of BEGIN/owner,
  setup, savepoint/read, receipt/tail/release/settings, both W1 flights, W2 and
  replay preflight. Every outcome refuses, later nontransactional sequence
  sentinels remain untouched, and heads/rows/receipts/commits/logs/evidence equal
  their pre-request images. A suppressed `_commits` insertion yields a zero-row
  tail, refuses before COMMIT and restores those same images.
- Residual scalar and array NULs refuse as `E_INPUT` through every parameterized
  serving template: authority, receipt, placement, point, membership, page,
  update and the real tail. Integer-only owner/head/generation and constant
  controls have no text values. Savepoint recovery and COMMIT remain refused, rolling back
  earlier writes. The existing eight NUL admission/rollback tests also pass.
- Hostile per-connection output settings are repaired on both ownership and
  raw Store paths. Serving statement/tail Bind difftests pass.
- SQLite/Postgres authorized mutation outcomes, publication preservation,
  planned W1/W2 values and logical meters, all five tables, bound receipts and
  change-evidence footprints compare equal across repeated writes/replays.

Initial local failures are retained outside Git: planner String versus Id
keys and primary-key lookup/get aliasing; action kind versus principal kind;
SQL PREPARE name reuse; expected old tail counts; witness setup/type errors and
an assertion that incorrectly expected a replay to contain historical result
rows. Those were corrected without weakening outcome, meter or fault checks.
The first broad run also caught an invalid attempted function qualification of
the tail's multi-array unnest; the original FROM form was restored and the
hostile-schema case passes. The final production source is `bfb1135fe3`.
The subsequent experiment sweep found one stale exact count: its warmed
prefetch-off inbox now uses 67 calls instead of 68 because BEGIN shares the
first read. That assertion is lowered without changing outcome or meter checks.

## Required checks and cleanup

The external runner records commands, PIDs, elapsed times, disk availability
and exit status outside Git. All Cargo builds use this worktree's target,
line-tables-only dev/test debug information and `-j 5`. Ordinary grouped
tests use five threads; the explicitly labelled ownership repeat uses one.

| Check | Result |
| --- | --- |
| Normal CLI build | Pass; rebuilt after the final experiment/main handoff (54.98 s) |
| Full default core, including integration/doc targets | 1,120 unfiltered passes, five named ignores; one additional passing subprocess check |
| Full `snapback4` binary with Postgres | 577 passes, 45 named ignores; final rerun 46.86 s test time |
| SQLite RT0 | Pass, table unchanged |
| Postgres RT0 selector | Three passes; all fourteen warm classes stable, no increases; repeated successfully in stock script |
| Postgres adapter group after observer/census corrections | 232/232 pass (163.69 s) |
| RT5/RT6 codec and serving witnesses | 19/19 in C; 19/19 in en_US.utf8 with every parameterized serving template's NUL check |
| Ownership | Corrected bootstrap/head observers pass; all 25 pass with one test thread (82.00 s); grouped timing failures retained below |
| Exact restored prefetch fixture | Pass, warmed on/off calls 7/67; complete outcomes equal |
| No-default-features core check | Pass |
| `./ref-check` | Pass: 566 LLP docs, 11,833 refs, zero errors/unchecked; final documentation repeat recorded separately |

`bash scripts/test-postgres.sh` completes every stage and exits **1**
(3,354.49 s). Its first experiment target has 20 passes / two failures: the
retained evaluator Serializable `40001` and the stale 68-call census.
Its first adapter group has 219 passes / thirteen stale observer/cold-count
failures; ownership has 23 passes / two stale bootstrap-observer failures.
Those transport-specific assertions are corrected and qualified by the
fresh-executable reruns above. The head observers require the exact `_head`
OID's RowShareLock and the expected blocker; advisory observers compare actual
lock identities. No contention, meter, result or timeout check is removed.

Every other stock stage passes: 60 evolution cases, handle traits, 38 doc
tests, committer/maintained-member/command cases, internal HTTP and
change-evidence snapshots, renewal cleanup, bearer lock gaps, all 62 selected
authority-boundary cases, all 22 corpus tests with five-executor overlap,
all eleven differential library tests and four store-campaign tests. The
separate public CLI witness passes evolution/restore byte-and-meter parity,
change-evidence, bootstrap refusals and binding recovery, ownership takeover,
restart persistence, and the unchanged S1 Quarry P1-MC milestone.

The exact saved evaluator executable passes its stress case alone in 4.12 s:
65 increments per mode, zero serialized and 109 Serializable retries. No
retry/backoff, workload, timeout, exclusion or durability input is changed.
The broad red remains a red in the
[existing ticket](../../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md).

The fresh five-thread ownership repeat has two different, unchanged 300 ms
lease assertions fail (23/25). Both passed in the stock-script run and pass
alone using that identical fresh executable (2.59/2.21 s); the entire group
passes with one test thread. These observations and prior occurrences are
[tracked separately](../../../issues/20261023-snapback4-postgres-short-lease-fixture-timing.md).
They establish no root cause and do not turn either grouped red into green.

Source commits: `18dff42c92` predictions, `b946bca7b1` reads, `a150fb7b53`
mutations/ratchet, `0a311bffb5` feature-local hint, `26671fcc26` cold lock order,
`bfb1135fe3` final transport/settings/type fixes, `453d640dd7` physical
witnesses/censuses and timing observations. The full default core preceded
the final Postgres-only refinements; the affected Postgres groups above
qualify those refinements. No expensive default-core repeat is implied.

No `~/q24`, PG17/55440, stash, push or persistent Git configuration was touched.
No raw logs are committed. Final owned-process shutdown is recorded below.

Private PG16 postmasters **3342451** (evaluation plus en_US database, socket
55493) and **3890225** (public witness, private socket 55483) are absent.
Both exact data directories independently return `pg_ctl status=3` and have
no `postmaster.pid`. The public helper's 549 recorded PIDs are absent.
The final cleanup receipt checks **588 PIDs**, all absent; this lane's target
and saved test executable census is empty, as is the census of PG processes
whose working directory is either owned data directory. **PIDs left: none.**

The evaluation cluster's initial 180 s fast-stop guard exits 1 while its
already-running checkpoint is syncing. Ordinary fast shutdown subsequently
finishes cleanly after 193.85 s; no stronger signal, guard increase or
durability setting change is used. The timeout and successful independent
cleanup check are both retained outside Git. Data directories remain for
inspection. Every disk observation stays above the 40 GB stop threshold;
final `df -h /home` availability is 151 G.
