# RT6 — serving B2(a) flights

Base `a025d67cd3`, branch `sb4-pg/rt6`, expo-build-450a. No push.
The [predictions](./CONTEXT.md) precede code; [counts](./counts.json) retain
previous, warm and first-use measurements. Raw logs stay outside Git in
`/tmp/rt6-evidence` on this host. Full qualification is running.

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
assertion; the Postgres table was lowered to those measurements. Final ratchet
runs are recorded below when qualification completes.

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
`extra_float_digits=3`, `bytea_output=hex`. Ordinary ingress remains a single
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

## Witness results

The expanded RT5 + RT6 group passes **18/18**, including scratch refusal and
cold preparation lock order. Targeted rewrap/shape/tail regressions also pass.
The full qualification repeats this group.

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
- Residual scalar and array NULs refuse as `E_INPUT` through folded commands
  and the real tail. Savepoint recovery and COMMIT remain refused, rolling back
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

## Required checks and cleanup

Pending. The external runner records every command, PID, elapsed time, disk
availability and exit status. All Cargo builds use this worktree's target,
line-tables-only dev/test debug information and `-j 5`; test concurrency is five.
No `~/q24`, PG17/55440, stash, push or persistent Git configuration was touched.
The owned private PG16 postmaster is 3342451, socket port 55493. It will be
stopped and independently confirmed absent after qualification.
