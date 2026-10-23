# G4a: bounded read admission and fact collection

Lane `sb4-pg/g4a`, exact RT6 base `2fdab648822e60e7e4b5a6235aec1d6cebc9c522`.
Host expo-build-450a; build jobs 4, own target, line-tables-only dev/test.
Design read from accepted controls RFC revision 6 at `fcc2aa96ad` (the
requested RT6 base does not contain that document), especially §§2.2, 4.4,
6, 10.1, 10.3, 12; round-trip RFC §§3.1, 7, 11. The current store-port
LLP and root fence apply. `llp-orient` hand-off: none. No semantic SQL
executor, result cache, authority grant, extra database pool or publication.

Before code: expected warm PostgreSQL W1/W2 3/2 → 2/1 after non-authorizing
ingress, then W1 → 1 after full fact composition. W3 gets a separate measured
class. Unsupported closures retain ordinary execution. All existing classes
must stay at or below their RT6 ratchets. SQLite outcome/meter parity remains.

## 1. Short admission

Thirty executing short workers plus 98 waiting requests, disclosed constants.
Waiting requests hold no reader or database snapshot. Worker count decreased
from 32, preserving the matched 30-reader reservation; no connection cap was
raised. Queue capacity does not add to the HTTP connection cap. Original
intake age and the absolute HTTP body deadline survive dispatch. Expired
requests use the same non-draining `E_RATE_LIMIT` response as queue overflow.

Witness: all 128 burst requests accepted and drained with HTTP 200, only 30
entered handlers while held, the 129th received HTTP 503 `E_RATE_LIMIT`.
An expired request with an unfinished large body refused before body drain.
All eight overload tests pass. Initial deadline fixture used a small body
which tiny_http buffers before dispatch; corrected to a streaming body.

Both RT0 tables pass unchanged; five round-trip/publication tests pass.
Postgres W1/W2/increment/keyed/replay: 3/2/8/9/2. SQLite: 6/6/22/30/5.
These deterministic bursts establish bounded behavior, not a loaded S1 SLO
or arrival-sampled capacity claim. Private PG16 master 4057748 is owned by
this lane until final qualification/cleanup. Logs remain under /tmp/sb4-g4a.

## 2. Non-authorizing `/q` ingress

Ingress parses credentials and consults at most 1,024 carried ordinary
capabilities, bound to the serving store id. Entries are factual planning
hints only. No liveness, expiry, supervisor or allow bit is cached. The
query snapshot always resolves fresh facts through the shared Rust resolver,
compares the carried principal/kind/scope, and validates store binding before
returning metadata. A changed scope/kind returns retryable stale authority;
the freshly observed hint permits a subsequent freshly checked retry.
Action/custom credentials retain the complete resolver and are not cached.

A cache miss learns the credential after the existing bounded body intake,
using the existing projection/complete resolver, then executes the query with
its own final authority snapshot. Unknown tokens finish in that discovery
statement, still at one PG flight. Cold discovery is disclosed separately
from warm counts, and cannot produce a program result or metadata refusal.
Personas carry their parsed identity; the final snapshot checks the current
cast/auth policy. Cache invalidation/eviction changes work, never authority.

Both RT0 tables pass (five HTTP/publication cases): PG W1/account W1 3→2,
W2 2→1; SQLite W1/account W1/W2 6→5. Every other warm class stays unchanged,
including PG action 17, unknown token 1 and metadata refusals 2. A first
attempt used the ordinary preflight discovery for non-ordinary credentials,
adding redundant resolver work; retained red counts led to reusing the
existing one-statement discovery instead. No allowance was raised.

All 62 original RT3b HTTP cases pass, including upload, wait/queue, stale
scope/kind, store mismatch, duplicate authority and metadata order. Two added
cache-populated witnesses pass on both stores: revoked, changed scope and
changed kind at the intake/body boundary cannot reuse the hint, disclose
metadata or preserve a full-scope manifest. The scope/kind retry succeeds
only after another final check. The `rt4_` name filter matches zero binary
tests; full binary/core qualification will cover RT4's actual snapshot tests.

## 3. W3 RT0 baseline before composition

A separate W3-shaped HTTP class reads 32 memberships, room totals and unread
counts, with a 33rd excluded room. It executes the S1 expression/filter/order
shape over stored scalar totals; the existing RT0 write bodies stay unchanged.
The composed-path core/store oracle separately covers real maintained totals.
Exact baseline after ingress refinement, before any fact-collector code:
**Postgres 134 flights; SQLite 132 statements**, warm. Postgres first use 138;
SQLite first use 132. W1/W2 remain 2/1 PG and 5/5 SQLite. Both ratchets and all
five round-trip/publication cases pass. This is a new class, not an increased
allowance for any existing class, and not the old M1 harness's 136-statement
or PG2's 153-call measurement.

## 4. One-statement bounded facts

The conservative physical planner collects fixed-key and identity-dependent
points, uniform literal-bounded pages and their single-level rule probes in
one composed SELECT. W3's single excluded non-null total-unique key adds at
most one candidate; Rust still evaluates its predicate. Dependent keys use
the actual nominal Id tag, UTF-8 bytes and terminator; identity admission
forbids NUL. Unicode, quotes, backslashes and newlines are exercised.

Facts include ordinary authority, store identity, generation and head in the
same snapshot. The existing shared Rust resolver, interpreter and meter still
choose every authorization verdict, arithmetic result, refusal, cut and cursor.
The query's Rust execution consumes transaction-local exact answers after
physical collection; no result, snapshot or authority decision is retained
across requests. Cached public scans reproduce the ordinary logical size,
vector, key and preflight charges. Existing speculative prefetch skips facts
already held by this snapshot instead of opening redundant savepoints.

Physical limits remain the existing 4 MiB prefetch envelope, at most 16 access
nodes and 32 prepared closure shapes per connection. The transfer guard also
reserves keys, escaping and decode copies, not just payload bytes. Template
values use the existing typed RT5/RT6 encoder; owned template keys avoid leaking
runtime strings. Unsupported shapes, byte/shape admission and speculative
decode failures retain/reopen ordinary access before execution. No public
meter, workload, durability, timeout or flight allowance increases.
Fixed speculative keys also stay within the existing portable key envelope;
wider/non-scalar keys fall back without choosing an application refusal.

Fallback includes unbounded/arbitrary filters, dynamic non-identity addresses,
mutable/shadowed addresses, nullable uniqueness, nested rule probes, lifetimes,
ephemeral/sync/through rows and private field/recording surfaces. A dependent
address source containing arbitrary JSON/assets or an enum with NUL also
falls back: PostgreSQL JSON extraction unescapes the entire image and rejects
an otherwise valid unrelated JSON NUL. A real both-store fixture proves this
retains the portable Rust behavior; same-level raw JSON facts stay eligible.

The carried-capability map now has its own mutex, so its lookup cannot wait on
reader-factory I/O. Cached principal sizes are bounded; no TTL or cached allow
bit exists. Fresh metadata-refusal snapshots also compare a carried query
scope/kind before returning their envelope. The deadline witness now expires
an actual queued request behind all occupied workers.

Initial full HTTP measurement, before lowering the final ratchet: **warm PG
W1/account W1/W2/W3 = 1/1/1/1**. All remaining warm classes retain their RT6
values. SQLite remains at its post-ingress values (W1/W2/W3 = 5/5/132).
The run correctly refused the obsolete ratchet and requested lowering it;
the final lowered-table run passes all five HTTP/publication tests. Numeric evidence is
in [counts.json](./counts.json); no raw logs are committed.

First-use PG W1/W2/W3 are 3/3/3. First-use keyed/action are 20/25 versus
19/23 before composition: earlier composed reads no longer warm the separate
authority templates those later classes first use. Their warmed budgets stay
9/17. Cold preparation remains visible, not hidden or charged to background.
These counts and deterministic bursts do not establish an S1 capacity/SLO.

Focused evidence: five core cases pass, covering real maintained totals,
all seven logical meter dimensions at zero/one/under/at observed use, complete
outcomes/cursors/errors against ordinary PG and SQLite, static fallback,
transaction-local planted membership/total/order/authority faults, a foreign
commit plus revocation after fact collection, and valid JSON NUL fallback.
The store-oracle's actual composed request path passes four seeded variants,
including hidden membership and missing rows, with planted data/meter/cursor/
refusal differentials and one-flight assertions for W2/W3.

## 5. Qualification

Full core: 1,168 passed across 47 top-level targets, 318 existing ignored cases, no
failures. Full binary: 580 passed, 46 existing ignored cases, no failures.
The earlier checkpoint census included one successful nested child test as
another target; the top-level totals above exclude that duplicate.
The first binary run exposed a stale latency fixture: it filled only the
old active-worker count, then reset the counter while an admitted request
was live. The fixture now fills the full bounded admission; the counter
increment is lazy at saturation. The complete binary rerun passes.

The final both-store RT0 run passes all five tests, including cold unknown
bearers with malformed JSON/unknown operations (one PG discovery flight,
no metadata). No warm class allowance increased. RT6 was independently
checked during qualification and remains exactly the requested base.

The complete sweep disposition, affected reruns and confirmed PID shutdown
are recorded below. The lane delivers local commits on `sb4-pg/g4a`.

### 2026-10-24: statement-fault witness refinement

The broad sweep exposed one G4a-stale RT6 expectation: `flight 1 was never
sent` for composed W1. The witness now injects at every boundary of the
three-command BEGIN/facts/ROLLBACK read flight. A real unrelated, empty
lifetime table declines composition and proves the original sequence path
still receives its original per-flight injections. Planner-variant assertions
prove both paths execute. Complete census equality and the nontransactional
later-command sentinel are retained for every injected error. All 19
literal/serving cases pass in the full affected-suite rerun (8.99 seconds).
This changes only the witness; production code and RT0 tables are unchanged.
The original broad red remains visible in the sweep disposition.

### Completed checks

All Cargo commands use the lane's target, debug profiles and four build jobs;
grouped tests use four test threads. Full suites are followed by the final
affected collector/HTTP tests; the later fault refinement changes tests only.

| Check | Result |
| --- | --- |
| `cargo build --locked -j 4` (workspace) | Pass |
| Full core with `--features postgres --no-fail-fast` | 1,168 pass; 318 existing ignored; 47 top-level targets |
| Full `snapback4` binary with `--features postgres` | 580 pass; 46 existing ignored |
| Both-store RT0 ratchets and publication cases | 5 pass; warm PG W1/W2/W3 = 1/1/1 |
| Final composed collector witnesses, private PG16 | 5 pass |
| Final composed request/store oracle | Pass; four seeded variants and planted differentials |
| Literal/serving error-boundary suite after refinement | 19 pass, composed and sequence fallback |
| Stock sweep's RT3b authority boundaries | 64 pass, both stores |
| Stock sweep's private adapter / ownership / evolution | 237 / 25 / 60 pass |
| Stock sweep's five-backend corpus overlap | 22 pass (1,171.06 seconds) |
| Stock sweep's difftest library / store integration | 12 / 4 pass |
| Full public Postgres CLI witness | Pass, including both-store wire/meters and unchanged S1 maintained-total recount |
| `./ref-check` | Pass: 566 LLPs, 11,836 refs, zero errors/unchecked |

### Stock sweep disposition and cleanup (2026-10-24)

`bash scripts/test-postgres.sh` completed every stage in 3,760.183 seconds,
exit 1. Its two recorded reds are retained: the inherited evaluator
Serializable `40001` at `conformance.rs:294`/`:307` (21 pass / 1 fail), and
the obsolete RT6 second-flight expectation described above (18 pass / 1 fail
in that initial target). The latter is corrected in `1eb697ee75`; the complete
19-case affected suite passes. No production behavior, retry, skip, workload,
deadline, durability setting or ratchet allowance was relaxed. The inherited
race is recorded in [its existing ticket](../../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md).
All other stock targets pass, including all 64 authority witnesses, the
five-backend corpus, the new oracle, and the complete public CLI milestone.

The public witness uses private PG16 master **481445** at
`/tmp/s10d3-serve-6zt790vo`; all 537 recorded commands are reaped. Its own
cleanup and an independent check both confirm status 3, no `postmaster.pid`,
and no master process. The primary private PG16.15 master **4057748** at
`/tmp/sb4-g4a/data` had zero clients before `pg_ctl -m fast -t 180 -w stop`;
stop exits 0, independent status is 3, and both PID file and process are absent.
The monitor **4153738** exits normally. The final census checks **826 unique
recorded PIDs**, including the 36 worker children from both binary runs, plus
processes belonging to the lane's target and private directories: **none left**.
Final `/home` free space is about 115 GiB; the 40 GB stop guard never fires.
Raw logs, cluster data and PID inventories remain outside Git under `/tmp`.
