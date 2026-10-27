# G6D — prerequisites for a safe Postgres read-grant default

2026-10-27; lane `sb4-pg/g6-default`, base `a0927e774cf2806a5e09d8b75ea96cc92b1d8235`.
**Proposal status: Review. Production defaults are unchanged.** The proposed
activation contract is the dated “G6 default-on proposal” in
[LLP 3000.009.001.000.002 §4.2](../../../llp/3000.009.001.000.002-beating-the-postgres-controls.rfc.md#4.2).

G6's write-path cost is small in this local point-increment diagnostic.
Existing exact version and owner-shape checks can refuse older binaries.
The stall evidence identifies cold-reader convoys and dispatch overload,
without establishing the exact trigger of the original 88-timeout smoke.
**A sampled clock witness cannot establish a future clock bound.** The safe
automatic rule needs an enforced deployment clock contract as well as a
passing witness; `ha=none` alone does not supply one. No such infrastructure
profile is established here. Plain unmanaged Postgres consequently stays G5.

| Default-on prerequisite | This lane's disposition |
| --- | --- |
| Explain one-second stall | Recorded mechanisms explained; current gate behavior reproduced; historical smoke's exact initiating instruction remains unknown |
| G5/G6 write cost | Measured locally at three rates; integrated marker/witness and S1 costs remain unqualified |
| Old-binary compatibility fence | Two-guard design and historical-source runtime proof; production upgrade/downgrade still to implement |
| Witness clock contract | Tripwire model and live samples; future bound still requires enforcement outside sampling |

## Scope and governing context

- Scope: Postgres `read_grant.rs`, `ownership.rs`, `opening.rs`, `store.rs`,
  public `store_config.rs`/`store_port.rs`, grant regressions and the retained
  S1/G6/FF3/OWN reports. The paved public profile is
  [`guide/release-json.md`](../../crates/snapback4-lang/src/guide/release-json.md).
- Governing LLPs: [3000](../../../llp/3000-snapback4.explainer.md) is the
  Snapback 4 root; [store-port §5](../../../llp/3000.009.001.000-the-postgres-store-port.rfc.md#5)
  owns fencing/takeover; [performance §4.1–§4.3 and §6](../../../llp/3000.009.001.000.002-beating-the-postgres-controls.rfc.md)
  owns G5/G6; [concurrent commits §5 and §23](../../../llp/3000.009.001.000.000.003-concurrent-disjoint-commits.rfc.md)
  owns W-ordered visibility and the competitive/default gates. Root, store-port
  and performance are linked in `llp/current/`; concurrent commits is reached
  by reference and has no current-overlay link at this base. The Snapback 4
  fence excludes the root foundation's Snapback 1 runtime rules.
- Active constraints: owner claim precedes termination (store-port §5.2);
  no CPU response can rely only on a database writer fence (performance §4.2);
  exact fill revision/authority/identity and publication gating remain
  mandatory (§4.1–§4.3); uncertainty retains OWN's fail-stop (§5.1);
  a claim names the shipped and qualified configuration (concurrent §23.3).
- Rationale: paused old readers can serve revoked authority unless the
  persisted foreign barrier outlasts every local read deadline (§4.2).
- Open risks: future clock/VM behavior, all-owner rollout and downgrade,
  raw administrator writes, mixed-read false misses and Stage R integration.
- Document update: amend existing §4.2, retain its prior ruling and status;
  append journal evidence. Hand-off: implementation and review of this
  Review proposal; no new LLP or acceptance is implied.

Snapback 4 has its own Cargo workspace and no Ibex/Hermes dependency, so its
fence explicitly makes the repository-root Ibex bootstrap unnecessary.
All Cargo artifacts used this lane's `/home/ccheever/projects/sb4-g6d/target`;
dev/test debug information is `line-tables-only`, eight build jobs, no shared
target or incremental build. No headline paired measurement overlaps an owned
build/test. The auxiliary statement-only probe supplies SQL counts, not timing
or CPU qualification; owned compilation overlapped that probe.

## Stall: recorded observations and local reproduction

| Record | Actual observation | Attribution/limit |
| --- | --- | --- |
| [Original G6](../20261024-g6/REPORT.md) and LLP §6 | One-second **candidate wait policy**; 24 read-only windows have no gate closure or candidate stalls; maximum successful hit over the whole unrestricted arm 131.859 µs | No measured one-second lease-renewal stall |
| [Original S1 final smoke](../../experiments/scale-controls/results-20261024-s1-onehost-final/README.md) | First 100/s repetition: 88 timeouts, p99 1,002.439 ms; later repetitions p99 5.288/5.247 ms | A real historical failure; exact initiating instruction was not traced |
| [S1 diagnosis](../../experiments/scale-controls/results-20261025-s1-diagnosis/README.md) | Cold native bursts: G5 961/1,470 ms and G6 981/1,532 ms on A/B; warm bursts about 10 ms. Eight traced writes respond at 992–1,008 ms and exactly explain eight excess durable writes | Reader construction and return under global locks, with the unchanged one-second client deadline; mechanism directly witnessed, historical-smoke assignment remains an inference |
| Same diagnosis | Original 100/s timeouts cluster at seconds 11–13, dispatch p99 about 3.1 ms, host CPU 11–12 logical cores; inspected read intervals have renewal max 25.4 ms, gate-read max 1.06 ms, no gate close/revoke | HTTP-side delay, no evidence for a one-second grant/GC pause |
| Overloaded S1 curves | Intended-arrival/dispatch tails approach one second while HTTP service is much shorter; occurs in G5 too | Generator backlog and `expired_before_send`, a separate overload mechanism |

[R1](../20261025-r1-postgres/REPORT.md) already moved cold construction outside
the global reader locks and prepared the reader population before readiness.
[G7.2](../20261025-g72-postgres/REPORT.md) changed the candidate wait budget
from one second to one millisecond. The gate stays closed through durability;
G5 can still validate the previous committed prefix while COMMIT is blocked.

This lane extends the existing real-PG advisory-lock/deferred-COMMIT witness:
the read returns through G5 while the writer remains held, and the gate then
stays held for another 1.1 seconds. The maximum candidate wait must remain
below 100 ms, allowing scheduler noise while rejecting the former one-second
policy. The measured gate/wait aggregates and final verdict are retained in
[`evidence.json`](./evidence.json). This reproduces the protocol distinction;
it does not recreate the missing historical smoke trace or assert the shared
96-core host reproduces the S1 machine's contention.

The [OWN report](../20261027-ownership-loss/REPORT.md) concerns a different
mechanism: sticky durability uncertainty despite successful lease renewal.
Its fix exits the serving owner; this investigation does not relabel that
failure as a one-second clock or renewal stall.

## Paired write cost

Private PG **16.15**, Unix socket only, port **55660**, fsync/synchronous_commit/
full_page_writes **on**, 256 MiB shared buffers, max_connections 100,
pg_stat_statements tracking top-level statements. No PG16/17 cluster belonging
to another lane was inspected or used. Release executable SHA-256:
`5158b78990c34df5fb6a4ca27199503be8788f9dd91c907ad01d0f2ab60435e1`.

[`measure.py`](./measure.py) uses the public deploy/serve/guest/HTTP mutation
path, 32 clients and 32 disjoint counters. Each increment reads its counter,
checks `.owner = viewer` and returns the updated row. It omits S1's million
message rows and membership/maintained-total families. Each arm starts a new
namespace/service, primes counters and runs two seconds warm-up, followed by
eight seconds at the specified intended-arrival rate. The order is
**G5/G6/G6/G5/G5/G6 at each of 100, 400 and 800/s**. No affinity or quiet-host
claim is made; one-minute load ranges **21.34–26.63** over recorded boundaries.

Every one of 18 windows has zero errors, and application counter delta = head
delta = ACKs. Total measured ACKs **62,400**. Entries below are medians of
three repetitions per arm, including all measured repetitions.

| Offered/s | Tier | Intended p50/p99 ms | PG CPU µs/ACK | WAL B/ACK (LSN) | Statement WAL B/ACK | SQL statements/ACK |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 100 | G5 | 3.261 / 4.452 | 1,737.5 | 981.10 | 899.49 | 27.160 |
| 100 | G6 | 3.016 / 4.359 | 1,725.0 | 982.58 | 901.34 | 27.180 |
| 400 | G5 | 2.692 / 4.668 | 1,334.4 | 1,028.22 | 946.94 | 26.994 |
| 400 | G6 | 2.453 / 5.040 | 1,281.3 | 1,019.89 | 939.02 | 26.888 |
| 800 | G5 | 2.858 / 4.936 | 1,257.8 | 842.13 | 782.06 | 23.332 |
| 800 | G6 | 2.881 / 4.951 | 1,204.7 | 846.42 | 778.36 | 23.080 |

G6 minus G5 median p99: **−0.094 / +0.371 / +0.014 ms**; PG CPU:
**−12.5 / −53.1 / −53.1 µs/ACK**; LSN WAL: **+1.48 / −8.33 / +4.29 B/ACK**.
These are serial diagnostic differences, not a causal G6 CPU speedup or a
maximum overhead guarantee. Scheduling changes physical group sizes; SQL
counts include framing, timeout/settings, lease traffic and utility commands.
CPU samples sum live and reaped private PG family CPU, including background
work and the boundary observer. PID reuse/incomplete snapshots refuse a run.
LSN WAL includes cluster background/maintenance for prior scratch namespaces;
statement WAL separates much, but not all, of that contribution. WAL/CPU ranges
and every repetition remain in the aggregate JSON; notably a 100/s G5 LSN
sample is 1,311.82 B/ACK, rather than being removed as an outlier.

The protocol attribution is stronger than a difference between noisy totals:
R1's program tail already returns the complete publication stamp, adding
**no extra publication statement or application-write flight for G6**.
A separate statement-only four-second 100/s probe has **400 ACKs/arm**,
zero standalone publication queries in either arm, and **0 G5 / 9 G6 grant
UPDATEs**. That is the extra reserved-connection UPDATE per renewal, about
two/s. Grant installation is outside the timed window. Lifecycle/solo writes
without a valid tail stamp still make the additional publication query.
The marker and clock witness are prototypes; their integrated cost is unmeasured.

The original G6 1% write/read mix retains **92.3% cache misses** and about
5.1k reads/s. Defaulting a revision-equality cache does not repair mixed-read
invalidation or qualify Stage R/D/W visibility. These remain explicit gates.

Pilot instrumentation corrections are disclosed: one two-second pilot used
an untagged JSON counter path and could not reconcile; the first full attempt
then rejected a disappearing observer backend as PID reuse. Both stopped and
reaped their services, and neither supplies a headline measurement. The final
18-run series uses tagged `Row/Int` decoding and checks start identities for
surviving PIDs, charging exited children through parent cutime/cstime.

## Compatibility: two existing guards, one atomic upgrade

The concrete proposal in LLP §4.2 uses `_backend.version =
'snapback4-postgres-read-grant-1'` **and** `_owner.read_protocol TEXT COLLATE
"C" NOT NULL`, no default, value `g6-v1`. `_meta.read_grant_clock` and the
presence of `_read_grant` alone are ineffective: old binaries ignore them.

The pre-G6 G5 source `af342f8ef1` checks exact `_backend.version` in
`opening.rs` before decoding/attaching a generation; its evaluator paths in
`mod.rs` also check exact equality. The currently accepted string originated
with the authority adapter (`93c7907624`); prior formats use distinct exact
version checks. The owner's exact five-column shape check runs at lease
connect, before claim. New protocol states must explicitly admit six columns
and the new format together; partial/unknown states refuse.
Core `_head` opening admission checks its relation properties, rather than
requiring the exact current column set; its extra `attempt` field is not a
universal old-binary refusal marker. `_catalog` describes logical table
identity, and individual `_meta` feature keys are not a global format guard.

[`marker.py`](./marker.py) only operates on a stopped `g6d_cost_*` scratch
namespace, refuses a live owner/backend, installs one guard at a time, calls
the ordinary unmodified binary, verifies its precise error and unchanged
application head, then restores the original marker state in `finally`.
The new version produces `opening` refusal **after changing the token**;
the extra owner column produces `unexpected column set` **without changing
the token**. This is why the early owner guard accompanies the format guard.
Both probes also pass against a separately rebuilt **pre-G6 G5** executable
from `af342f8ef16215a44d8de2f5c4bc7755da341fa5`, SHA-256
`b0107a5d6921d98fe8448649334210b70e2936579596a0a4ea59a64de2fdd0c2`.
That is a historical source rebuild, not an npm artifact qualification.
All four probe children exit nonzero at the intended guard and are reaped;
their application heads remain unchanged. The source audit establishes the
guard across the supported version lineage; it does not test every historical
published tarball or an arbitrary fork that bypasses admission.

Activation must fence old writers, install both guards and the persisted
grant in one synchronous transaction, and only then publish local admission.
New binaries with G6 disabled drain/release the exact grant and serve G5 while
retaining the guards. An explicit stopped-store downgrade can remove both
only after grant drainage/expiry, exclusion of all old handles and legacy
layout verification, atomically with no open writer. An ambiguous commit
cannot authorize marker removal. No production migration or downgrade was
silently added in this design lane. Raw privileged SQL remains outside the
supported all-writer contract.

## Clock witness: executable model and safety boundary

[`clock_witness.py`](./clock_witness.py) is an executable design model. It is
**not connected to production admission**. `--test` covers ten deterministic
cases: legal clocks/conservative deadline, +500 ms step/sticky revocation,
10% rate excess, accumulated small jumps, suspend at a hit, pause aging both
clocks, late renewal, high RTT/backward step, asymmetric RTT bounds, and an
intra-interval violation invisible to sampling. The live mode brackets
`clock_timestamp()` with BOOTTIME/MONOTONIC, using an explicit private
connection. **17 samples pass**, RTT **8.32–13.10 ms**, with no definitely
positive excess advance. Faults alter model inputs, not system/database clocks.

The integrated proposal piggybacks a timestamp on grant UPDATE RETURNING,
ties it to the actual persisted deadline, compares interval bounds over a
rolling lease horizon, checks suspend/freshness at each hit and after
authority resolution, and revokes the local epoch to G5 on a trip. It never
turns a late renewal into a live epoch or shortens a foreign persisted barrier.
The exact formulas, thresholds, default modes, diagnostics and release rules
are in the amendment.

Linux distinguishes suspend-inclusive BOOTTIME from MONOTONIC, which stops
during suspend; their agreement does not establish an independent time source.
See the [kernel timekeeping API](https://docs.kernel.org/core-api/timekeeping.html).
PG's actual-time function can change within a statement; transaction `now()`
would not provide this witness. See the [PostgreSQL date/time functions](https://www.postgresql.org/docs/17/functions-datetime.html).

An arbitrary forward DB jump immediately after sampling can let a successor
commit revocation while the old reader still passes its local check. No next
sample can retract that response. Current local exposure is at most the
remaining 2.746253 s window **if BOOTTIME remains trustworthy**; the proposed
750 ms observation-age check narrows that remaining local bound. A VM freezing
both local clocks removes a real-time bound. A deployment profile must
guarantee future rate/jump and VM elapsed-clock behavior; measured agreement
alone cannot safely replace that assumption.

## Verification and cleanup

| Completed check | Result |
| --- | --- |
| Private-PG G6 grant suite, including E reader-release witness | 18 passed, 0 failed |
| Suspend-aware window and publication-gate unit tests | 2 passed, 0 failed |
| Clock model fault/interval witnesses | 10 passed, 0 failed |
| Live clock sampling | 17 passing samples |
| Current + pre-G6 marker refusal probes | 4 intended refusals; all application heads unchanged; owner-shape guards leave token unchanged |
| Paired HTTP write measurement | 18 windows, 62,400 ACKs, no errors; exact counters/head |
| Statement-only probe | 800 ACKs, no errors; 0 standalone publication queries; G6 9 extra grant UPDATEs |
| `./ref-check --verbose` | Passed; final receipt in evidence |
| `git diff --check` | Passed |
| `node scripts/check-inventories.mjs` | Ran; failed on unchanged Snapback 1 checkout preconditions, described below |

The real COMMIT stays closed **1,108.305 ms** while the candidate wait is
**1.060 ms**, then G5 reads the prior committed prefix. This tests publication
waiting separately from renewal and preserves the durability barrier.

Inventory failure: missing root `typescript`/`ajv` dependencies, ignored
`demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json`,
and ignored Exact/Contract output under `demos/todo-v2/snapback/generated/contract/`.
Those Snapback 1 paths and their generators were unchanged by this lane.
The checker asks for root install and generated-artifact/Contract bootstraps;
this is not a new Snapback 4 registry-content failure. No production diagnostic
site moved and no registry was regenerated. The affected selector plan was
generated; it conservatively treats the test implementation path as a core
source and expands to reverse dependents. Executed checks are the focused
grant/gate tests plus the prototypes/public probes above, not the entire
reverse-dependent client battery or publication qualification.

The completed check counts, gate timing, historical marker witness and cleanup
audit are retained in [`evidence.json`](./evidence.json). Only aggregates and
reproducer source live in this report directory; raw logs and private scratch
state remain outside Git. The first attempted release-profile core test was
correctly rejected by the project's debug-only `test-support` guard; an initial
filter using the source filename selected zero tests. Neither supplies a
passing test count. The final command uses the canonical debug test profile
and actual module filter `engine::revision_cache::tests::grant::`.

No push, stash, Git configuration change, credential copy or shared-cluster
operation is authorized or performed. Only recorded owned process PIDs may
be signalled. No PG directory is deleted; cleanup stops the recorded private
postmaster and checks its pidfile before any future removal. Final PID and
`/home` free-space receipts are recorded after all checks.

Private postmaster **1918926** on port **55660** stopped successfully; its
pidfile is absent. All **27 recorded runtime PIDs** are gone. No PG data
directory was deleted. `/home` free at cleanup: **116.88 GiB**. Raw local
records remain under `/tmp/sb4-g6d-moo6a1ma`; only the aggregates are committed.
