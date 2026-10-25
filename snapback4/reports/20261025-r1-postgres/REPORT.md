# R1 — reader readiness, bounded fill and two write-flight reductions

Branch `sb4-pg/r1`, base `25ee876966185acfa7be9eace384b2988512da56`,
worktree `/home/ccheever/projects/sb4-land3`. Local PG16 over a private Unix
socket; durable settings unchanged. This report records loopback relative
evidence on a noisy shared machine. The authoritative S1 rerun is elsewhere;
these results qualify neither S1 capacity nor publication.

The serving pool lends up to four independent construction factories and does
all connection/qualification work outside its mutex. An epoch change discards
an old construction result and its factory. Errors/unwind return reservations.
The physical PG pool separately bounds constructors at four and total physical
readers at 30. All 30 detached serving loans are prepared before serve readiness.
Replacement and maintenance repair also prepare outside the reader mutex;
existing identity/generation/store-binding checks remain in force.

The baseline deterministic constructor witness fails while its hook is parked:
the global reader mutex is unavailable. After the fix the mutex remains free.
The ready-burst witness parks construction behind a panic hook and simultaneously
holds 30 distinct loans; no construction is reached and acquisition stays under
100 ms. Additional witnesses cover physical-pool capacity, error/unwind custody
and a constructor racing a backend/native epoch replacement.

The diagnosis's traced eight HTTP deadline failures reconcile with eight
durable writes. Its five native first-800/s trials contain 134 excess commits;
those uninstrumented native trials cannot be assigned individually to server
responses from the retained aggregates. The linked original archive is absent
on this machine. The new controlled HTTP witness parks the reply *after*
confirmed COMMIT, observes the unchanged one-second client timeout and exactly
one durable execution, then proves keyed replay does not execute again. No
counter duplication or accounting defect was found. HTTP timeout means unknown
outcome; loss of a database COMMIT acknowledgement still returns non-retryable
`E_COMMIT_OUTCOME_UNKNOWN`. Readiness removes the observed cold-growth cause.

Non-idle collection uses enqueue intervals (3/4 old + 1/4 new), resetting after
a gap above a 20 ms history horizon (independent of the 1 ms fill window). It waits only if a predicted arrival fits within the original
1 ms window, for at most one estimated interarrival interval (minimum 1 µs),
capped by the window's remaining duration; an empty timeout ends collection. The first arrival after idle and sparse predictions never wait; target 1 never waits; solo work
ends collection in FIFO order; the 32-member/adaptive latency bounds remain.
Four policy tests cover idle/low rate, queued bursts across a busy write cycle,
predicted fill/window expiry and p99 adaptation. The first 1 ms history
candidate retained N≈16 under load; that failed distribution and its
failing-before queued-burst witness prompted the 20 ms history correction.

The first writer flight combines BEGIN, remaining program-budget controls, a raising owner/store check, then
separate head/generation/authority/receipt commands. Facts still take their
READ COMMITTED snapshots after the lock grants. Grant-enabled tails return
revision/head from the head UPDATE's RETURNING relation plus complete publication
identity. Later writes/revisions/rollback invalidate the captured stamp;
activation/no-tail transactions retain the final complete query. Count validation
precedes the separate uncancellable COMMIT. The G6 gate still closes before
COMMIT dispatch and installs only on confirmation.

| Warm path | Before | After |
| --- | ---: | ---: |
| G5 program batch N=4/8/32 | 5 | 4 |
| G6 simple program batch | 6 | 4 |
| Core batch with an extra shared-dependency level | 6 | 5 |
| HTTP unkeyed/account write | 8 | 7 |
| HTTP keyed first / one-membership write | 9 | 8 |
| G6 W1/W2/W3 hit | 0/0/0 | 0/0/0 |

The HTTP and core-overlay RT0 ratchets pass on both stores; SQLite's values are unchanged. The owned G6 group
witness checks all six publication fields against independent persisted values,
revision/head advance by every member, and an old cached fill misses after the
commit. The existing G6 abort, unknown COMMIT, COMMIT-stall and activation
witnesses pass (18/18 G6 checks). A planted shadow `=` operator also
exposed a missing qualification in the new raising owner check: it reached
application commands instead of refusing ownership. Catalog-qualified token
and store comparisons fix that witnessed failure. A second planted witness
holds the owner row throughout: the original remaining program budget must
refuse before the lock is released. It failed when the fused fence preceded
its timeout controls; installing those controls before the fence fixes it.

## Relative loopback evidence

[All 83 retained trial aggregates and N histograms](./measurements.json).
The fixture is RT0's small schema with one hot counter, 32 HTTP senders,
Connection: close, three seconds of independent intended arrivals, no warm-up,
and full backlog drain. The wire timeout is one second. Intended backlog is
retained rather than expired: high-rate p99 values **fail** the S1 deadline,
and writes/s includes drain. These are mechanism diagnostics, not passing S1
rungs. All binaries use the test profile with line-tables-only debug; captures
run after this lane's builds/tests drain. PG16.15 has fsync, synchronous_commit
and full_page_writes on. Binary digests and every retained candidate are in the
aggregate; no per-request server trace or round-trip collector was enabled.

All five cold baseline arms fail on their first repetition: **32 HTTP timeouts
and exactly 32 excess durable commits each**, 160 total. Other rejected
requests are E_RATE_LIMIT and contribute no commit. This reproduces the original
first-cohort signature on this host. The failed arms remain disqualified and
are not substituted with later repetitions. Across **78 prepared-reader
trials**, **1,079,999 acknowledgements exactly match durable commits**; there
are no wire timeouts or unknown extra commits. One E_RATE_LIMIT occurs at the
overloaded 9,600/s final trial and is retained.

The final comparison below isolates the collection policy: both arms already
have reader readiness and fused flights. Control is the rejected 1 ms-history
candidate; final uses 20 ms history and one predicted-interval wait inside the
unchanged 1 ms window. Three repetitions per arm; mean N pools their histograms,
writes/s is the repetition median, load is the observed one-minute load range.

| Offered/s | Control → final mean N | Control → final writes/s | Control → final host load |
| --- | ---: | ---: | --- |
| 800 | 1.378 → 1.939 | 799.2 → 798.9 | 54.17–54.27 → 54.17–54.28 |
| 6,400 | 16.000 → 15.956 | 3,333.9 → 3,047.5 | 54.04–55.75 → 54.09–54.89 |
| 9,600 | 16.131 → 15.979 | 3,677.0 → 4,038.8 | 42.40–56.84 → 31.72–42.40 |

At 9,600/s the batch fractions for **N=1 / 2–8 / 9–16 / 17–31 / 32** are
**25.60 / 7.65 / 16.67 / 41.47 / 8.61%** in the control and
**0.13 / 0.48 / 69.65 / 29.74 / 0.00%** in the final arm. The final policy
reduces one-member groups and tightens the distribution, but saturated mean
fill stays near 16. It does **not** establish a throughput win: the two
saturated rungs move in opposite directions and host load changes. The 20 ms
history/full-window intermediate arm also retained N≈16 and mixed throughput;
its complete results are preserved. The 1 ms limit and C=32 remain binding
constraints for the authoritative S1 rerun elsewhere.

At 800/s median p99 is 5.732→12.768 ms, below the existing 100 ms latency
budget; this is not a zero-overhead low-load claim. Idle and expired-history
unit witnesses request no fill wait. Every requested fill wait is bounded by
the original collection deadline and 32-member cap; no arrival restarts it.

## Verification and custody

[Check receipts](./checks.json): full core **1,273 passed / 0 failed / 437
ignored**, across 49 targets including doctests; full binary **608 / 0 / 57**;
complete Postgres script **806 Rust checks / 0 failures**, plus the public
serve/deploy/evolution/ownership witness. The inherited 40001 did not occur.
HTTP RT0 **9/0**, core overlay RT0 on both stores **2/0**, literal/flight
witnesses **35/0**, program batches **75/0**, G6 **18/0**, TCP pipeline **9/0**,
final queue/command checks **19/0** (four collection-policy tests), and reader
witnesses **4/0**. The final ready burst takes at most **19.95 µs** for a loan;
its construction hook is unreachable while all 30 loans are held together.

The first full-binary invocation lacked its compiled supervisor executable and
ran timing tests unrestricted; build plus four test threads resolves those
setup failures. Eager 30-reader preparation also required the Postgres runner
to default to four fixture threads within its 400-connection private cluster.
A second private TCP cluster supplies TCP-only witnesses. The remaining-budget
correction reruns literal flights, program batches, G6 and the full binary/HTTP
ratchet; the final collection change reruns every queue/command test and the
full binary/HTTP ratchet. This follows affected-input verification, with no
publication or exact-commit full-battery claim.

[Cleanup receipt](./cleanup.json): both recorded private PG16 clusters and both
public-witness clusters are stopped; pg_ctl status=3, pidfiles/sockets absent,
postmaster identities checked, and all 31 measurement child PIDs absent.
**PIDs left: none.** Minimum observed root free space is 35 GiB; only this
worktree's completed incremental caches were removed. Raw logs, process
ledgers, immutable measurement executables and full per-second load samples
remain outside Git under `/tmp/sb4-r1`. No push, stash, Git configuration change
or unowned signal occurs.
