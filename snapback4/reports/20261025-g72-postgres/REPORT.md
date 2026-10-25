# G7.2: depth-two synchronous Postgres group commit

Base: `24a241b12c` (G7.1), branch `sb4-pg/g72`, host
`expo-build-450a` (OS hostname `expose-builder-nothing`). Scope is the G7.2 row
of accepted LLP 3000.009.001.000.000.002 revision 4. COMMIT remains a separate
third flight. Arm E, G7.3/G7.4 and depth three are outside the implementation.

## Protocol and state

Two owned writer slots overlap final I/O with collection, facts and bounded
interpretation. A successor folds frozen predecessor images into point and
unique-index facts, folds full bound receipts (including refusals), and carries
entropy and the exact leaving head identity. Each slot's synchronous client
runs on its own thread, separate from PIPE. The committer owns interpretation
and drains the FIFO of confirmations before publishing callbacks/results,
continuations, BatchStats and G5/G6 publication. Other producers drain both
slots before their ordinary barrier protocol. The second writer is reserved
from the reader pool: two writers + 29 readers + one production owner = 32.

A predecessor ticket is waited on before generation/identity checks and the
exact seq/revision/attempt CAS and vector tail. A duplicate-only successor still
runs this conditional final even when it has no new tail rows. Remaining original
deadlines bound ticket waits; timeout aborts with no automatic peer retries.
Every apply/tail count is checked before a separate uncancellable COMMIT.
Unknown confirmations never authorize rerun or resolve through a successor.

G6 closes admission under its write lock and counts each dispatched final.
Readers see the count under a read guard, drop that guard to wait, and use G5
after the 1 ms wait budget. Ordered resolution installs only confirmed
publication and decrements; uncertainty clears publication/epoch and stays sticky.

Known aborts first drain every successor, then recover the failed batch under
the existing rules and rerun an innocent successor once as a whole fresh-fact
batch in its original order and deadlines. Probes of uncertain tickets run
highest first under the owner fence before head reseeding. Probe failure
terminates tagged old writers and pauses the old lane; a fresh owner token is
required to reopen. Both lost transports can reconnect after a successful drain.

Seq/revision and entropy remain provisional; remembered results, continuation
emissions and publication install only at release. Eligible closures do not
mutate the effective-time pin; time-dependent programs and schemas with lower
time audiences stay barriers.
Existing minted-id replay is preserved. First-slice closures exclude allocating,
maintained, cap, identity/session and time-dependent writes, so their minter,
read-session and sequence-cache rows remain barrier-only. Transaction fact
caches die with attempts; prepared code remains per connection.

## Evidence

The queue-overlap test builds and fails on unchanged G7.1 `24a241b12c` with only
that test appended: the second wave cannot interpret while the first COMMIT is
held. The failure is the intended runtime assertion after both slots' logical
input and the held-COMMIT witness have been established.

Nine additional mechanism-disabled runs all fail at runtime: the row fold on
SQLite and PG; G6 count observation; ordered release; whole-batch successor
fallback; drain before rerun; predecessor-ticket ordering; original ticket
deadline; and ticket/CAS prefix protection under process death. Temporary
mutation switches were removed; no raw logs or temporary test adapters are
committed. These are mechanism-negative witnesses, distinguished from the
actual-parent queue-overlap failure above. A further pre-fix runtime witness
held the batch's own first-flight ticket and exposed later-deadline peers being
rerun after P1 timed out. P1 timeout classification now uses the same no-rerun
rule as the final predecessor wait; that witness is part of the final suite.
A second pre-fix failure exposed an unacknowledged preparation rollback leaving
G6 open before the first final-flight guard existed. Durable rollback now latches
uncertainty directly; the witness covers both direct and pipelined routes.

The final focused G7.2 run is **29 passed / 0 failed**: 26 asserting witnesses,
the subprocess entry helper, and two measurement entry guards (the latter return
without measuring unless explicitly enabled). The substantive coverage is:

| Property | Witness |
| --- | --- |
| Real queue overlap | Second eight-member wave interprets while the first COMMIT is held; replies and continuations stay held |
| PG fold and ordered release | Held predecessor, both live tickets, outcomes and full snapshot versus N=1, callbacks in batch order |
| SQLite fold | Three seeds × 192 child interpretations through a read-only WAL snapshot while a predecessor row update is uncommitted; results, every meter, tables and event counts equal the serial interpreter |
| Random paired history | Three seeds × 192 PG members, random boundaries, hot keys, refusals, keyed duplicates, drained barriers; complete outcomes/meters and snapshots (including revision) versus N=1; retained G7.1 paired histories also run on both stores |
| Cascades | Both original xids abort, each member interprets twice, successor fallback receipts share one physical transaction; a duplicate-only successor also depends on its aborted predecessor |
| Flight outcomes | Before final, after tail, before COMMIT and after COMMIT; confirmed/known-abort/unknown agree with `pg_xact_status`; attempts differ and reruns get fresh nonces |
| Connection loss | Termination at each pre-COMMIT boundary stays unknown without automatic rerun; two lost sockets drain and both slots subsequently reconnect |
| Drain and consecutive unknowns | A successor parked before its CAS prevents replies and recovery interpretation; two lost confirmations stay unknown without rerun |
| Probe escalation and ownership | Probe timeout terminates old tagged backends and pauses the lane; takeover terminates both slots; fresh token can reopen; loss while closing G6 prevents final dispatch |
| Ticket and deadline | Successor waits on its predecessor before any head lock; both first-flight and predecessor-ticket timeouts abort/skip COMMIT and never retry later-deadline peers |
| Visibility and locks | Concurrent REPEATABLE READ snapshots agree on contiguous commits, marker images and receipts; one-store deadlock delta is zero; a deliberately forced cross-store ticket wait cycle yields one 40P01 known abort |
| Recovery prefix | Kill only recorded child processes before the predecessor final, after only k commits, or after both commit; reopened store equals the serial prefix, including the same attach barrier revision |
| Provisional state | Known abort/unknown outcomes preserve serial rows, receipts, sequences, evidence, intermediate log images and outbox; entropy stays uninstalled until release and matches the oracle after confirmed recovery |
| G6 and connection cap | Count 2 is visible to `read()`, count 1 cannot reopen, unknown clears epoch/publication and remains sticky; 40 logical readers allocate only 29 physical readers beside the two writers |
| Preparation uncertainty | Recorded backend termination before final dispatch makes rollback unacknowledged; both direct and pipelined routes clear publication/epoch, keep the flight count at zero and reject new writer admission |
| RT0 | Two warm slots total six flights for every tested N=1/8/32 under G5 and G6; existing core and HTTP budgets still apply |

The expanded G6 regression witnesses the new ruling directly: during a held
barrier COMMIT, bounded waiting gives way to a G5 read of the prior committed
prefix, with no G6 hit; publication and gate cost settle after confirmation.
Its old assertion that the read must block for the entire COMMIT was superseded.
The crash test compares the same administrative attach on the recovered side
and oracle; that attach is a real extra revision, not a pipeline write.

## Checks and corrections

All Cargo commands use the lane's own target directory, line-tables-only dev/test
profiles and `-j 6`. Counts below are passed / failed / ignored. Direct Cargo
target summaries are counted once, excluding nested crash-child output.

| Check | Result |
| --- | --- |
| Full core, Postgres feature, all 49 direct targets | 1,277 / 0 / 472 |
| Full `snapback4` binary | 608 / 0 / 57 |
| Final focused G7.2, including ignored entries | 29 / 0 / 0 |
| Full G5/G6 revision-cache family, including ignored | 33 / 0 / 0 |
| Core RT0 ratchet | 4 / 0 / 0 |
| HTTP RT0 ratchet | 9 / 0 / 0 |
| Complete `bash scripts/test-postgres.sh`, 36 Rust targets | 843 / 1 / 0; only inherited `40001` |
| Public Postgres serving milestone in that script | PASS, including recovery, ownership, changed release and row recounts |
| SQLite-only `cargo check --no-default-features --features sqlite` | PASS |
| Explicit final measurement entries | 2 / 0 / 0 |
| `./ref-check --verbose` | 569 LLPs, 11,982 references, zero errors or unchecked references |
| `git diff --check` | PASS |

The only remaining Postgres red is
`evaluator_concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`:
SQLSTATE `40001`, concurrent update serialization failure, as permitted in the
lane brief. Every later script stage runs and its private public-serving cluster
stops successfully. The first complete run (842 / 1) instead exposed an obsolete
G6 assertion requiring a read to block through the entire COMMIT; the corrected
bounded-wait assertion passes in the repeated full script and the 33-test family.
An initial concurrent HTTP RT0 run was 8 / 1 at the existing intake latency
budget; all nine pass on the serial rerun with the budget unchanged.

The full core and Postgres runs precede the final preparation-rollback refinement.
That failure path is then checked directly and through the refreshed complete
29-entry G7.2 suite; both direct and pipeline variants pass. The full binary is
also repeated successfully. Tests retain real original deadlines; no production
deadline or budget is relaxed to pass the checks.

## Loopback relative sanity

This is a short queue-level debug-build comparison on `expo-build-450a`, using
TCP `127.0.0.1:35057` to the lane's private PG16. It excludes HTTP ingress and
session resolution. There are 32 closed-loop clients, a fixed batch cap of 32,
256 warmup writes and 1,280 measured writes per cell/depth/repetition. Two
repetitions reverse depth order; aggregate rates divide 2,560 writes by summed
elapsed time and latency averages the equal-sized repetitions. Each cell checks
its full 1,536-write counter. `fsync`, `synchronous_commit` and `full_page_writes`
are all `on`. W4 uses one key per client; W5-exact uses one shared key; W5-mix
uses nominal 1% shared-key requests with the other requests on per-client keys.

The host exposes 12 CPUs. Persisted one-second samples record one-minute load
min/mean/max **4.65 / 4.87 / 5.02**, start load averages **4.65 / 3.66 / 3.22**,
and end **5.02 / 3.81 / 3.28**. The complete measurement entries take 23.37 s,
including fixture setup and the gate probe. PID/load sampling persists at 1 Hz;
child inspection runs at 0.2 s. Earlier runners' excessive JSON rewrite frequency
was corrected before this sample.

| Cell | Depth 1 writes/s | Depth 2 writes/s | Change | Mean ms, depth 1 → 2 | Mean N, depth 1 → 2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| W4 | 2,863 | 2,517 | −12.1% | 11.15 → 12.68 | 32 → 32 |
| W5-exact | 2,149 | 2,363 | +10.0% | 14.87 → 13.44 | 32 → 16.31 |
| W5-mix | 3,045 | 2,655 | −12.8% | 10.47 → 12.02 | 32 → 16 |

Full measured batch histograms (N: count, summed repetitions):

| Cell | Depth 1 | Depth 2 |
| --- | --- | --- |
| W4 | 32:80 | 32:80 |
| W5-exact | 32:80 | 1:69, 2:5, 4:3, 28:3, 30:6, 31:67, 32:4 |
| W5-mix | 32:80 | 1:66, 2:3, 3:2, 4:9, 28:9, 29:2, 30:3, 31:66 |

Per-repetition writes/s, depth 1 / depth 2: W4 2,822, 2,906 / 2,563, 2,473;
W5-exact 2,159, 2,138 / 2,302, 2,427; W5-mix 3,465, 2,716 / 2,613, 2,698.
The first, incomplete measurement attempt hit a final-flight statement timeout
within the unchanged 100 ms admission deadline and ended 1 / 1. Its partial
rates are excluded. The repeated fixed sample completes without refusals.
This short, loaded-host comparison shows mixed results, not a general throughput
improvement or an S1/publication qualification.

A separate scheduling microprobe uses 32 writers × 32 writes, one 50 µs-polling
gate reader and a test-qualified grant. It measures gate scheduling rather than
end-to-end cached-query throughput or real owner clock qualification:

| Depth | Gate hits / G5 fallbacks | Closed ms | Wait count / total ms / max ms |
| --- | ---: | ---: | ---: |
| 1 | 2,652 / 108 | 93.23 | 100 / 87.44 / 1.065 |
| 2 | 1,846 / 735 | 219.24 | 203 / 198.93 / 1.062 |

Both end certain and unrevoked. The software wait budget is 1 ms; observed
wall-clock maxima include scheduler wakeup. Real-owner and unknown-state safety
are covered independently by the G6 suite.

## Process custody

The lane PG16 postmaster `2308805`, port 35057, is stopped with `pg_ctl -m fast`.
Its retained data directory and both public-witness clusters independently return
`pg_ctl status` 3 with no `postmaster.pid`. Across 35 PID-record files, **15,667
unique recorded PID/birth instances**, all three monitors, and 1,066 explicit
public-script PID records, none remain. Available disk at the process-custody audit is 60.64 GiB;
the lowest persisted sample is 59.72 GiB, above the 40 GiB stop floor.

PIDs left: **none**. Raw logs and process records remain outside Git. No push,
stash, Git configuration change, PG17 signal/reconfiguration or `~/q24` access
occurs. The implementation remains based on G7.1 `24a241b12c`.
