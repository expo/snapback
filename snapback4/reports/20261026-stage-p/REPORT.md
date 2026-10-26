# Stage P: ordered Postgres server cost

Lane `sb4-pg/stage-p`, base `5fc6e6449b`, host `expo-build-450a`
(OS hostname `expose-builder-nothing`). No WF changes or concurrent-disjoint
writer/reader implementation are included. No push or publication occurs.

## P0, before implementation

The first attribution used the unchanged S1 schema, all 256 users, 1,025
rooms, 8,448 memberships and 257 counters, but **zero messages**. It is a
diagnostic, not the authoritative million-message S1 fixture. In particular,
the small population makes the old JSON tail choose a sequential scan of `r`.
The later paired million-message run is the primary performance comparison.

These release runs use private socket-only PG16.15, 32 closed-loop HTTP
clients, no added database delay, three seconds warmup and ten seconds per
cell. W4 uses one counter per principal; the initial diagnostic's W5 mix has
25% shared-key clients; W5 same uses the shared counter for every client.
The paired full-fixture harness uses S1's **1% hot-key** mix instead.
There is no open-loop arrival-rate/SLO qualification here. Concurrent host
load is recorded; these are local cost and residence observations.

`pg_stat_statements.track_planning=on`, top-level tracking, JIT off, and 1%
sampled `auto_explain` analyzed/timed JSON plans supply the server clocks.
Per-batch values include execution **and** planning, divided by physical tail
calls, including solo tails. Batch size is the durable sequence delta divided
by those calls. Raw queries, credentials and logs stay outside Git under
`/tmp/stage-p-20261026/`. Aggregates are in `attribution-before.json`.

| Initial diagnostic, ms/batch | W4 | W5 mix, 25% | W5 same |
| --- | ---: | ---: | ---: |
| Mean N | 10.55 | 10.63 | 10.60 |
| Settings guard | 0.133 | 0.185 | 0.183 |
| Owner fence | 0.159 | 0.176 | 0.175 |
| Facts, identity, receipts | 0.271 | 0.316 | 0.327 |
| Tail | 2.458 | 3.022 | 3.072 |
| Other controls | 0.015 | 0.017 | 0.017 |
| Non-wait subtotal | 3.036 | 3.716 | 3.774 |
| Advisory-ticket wait, separately | 3.336 | 3.472 | 3.362 |

The supplied fit is `2.4 + 0.086N` ms across P1 and the tail: about 3.31 ms
at N=10.55. The diagnostic's non-wait subtotal is 3.04 ms. This is a
component attribution at observed N, **not** a new measurement of the
intercept. Guards/fence explain only 0.29 ms; the tail is the first cut.
Advisory waits overlap the ordered chain and are not additive CPU.

Sampled tail CTE clocks, across 57 plans, average: head 0.027 ms, images
2.026, commits 0.154, evidence 0.169, pruning 0.703, empty log 0.106, empty
effects 0.108, presence 0.001 and empty receipts 0.087. These clocks include
dependencies/materialization and **must not be summed**. All 57 image plans
scan `r`; the post-change small-fixture samples use `r_pkey` instead. That
plan switch is not assumed to occur on the million-message fixture.

PG process CPU per committed write is approximately 364/433/436 us for these
three cells. The earlier supplied N≈11 anchor is 263–300 us, versus G7.0 arm
C's 134 us at N=16. Different populations, batch sizes and HTTP versus SQL
harness work prevent treating those as a measured delta. The full-fixture
paired run below supplies the within-run comparison.

COMMIT's `pg_stat_statements` utility clock is only about 0.0004 ms; it
excludes the transaction-end flush. A second baseline with 2% sampled
completed-statement duration logging measures 90 COMMIT samples averaging
5.25 ms, including setup. Its W4 residence is 22.99 ms versus 17.29 ms
without that logging. Flush and logging disturbance therefore remain separate
from the non-wait statement ledger. The paired run uses identical sampling
settings for both binaries.

## Implementation and witnesses

The implementation and final verification results will be recorded in the
completion update to this report. This initial attribution checkpoint makes
no claim that Stage P or full-fixture qualification is complete.
