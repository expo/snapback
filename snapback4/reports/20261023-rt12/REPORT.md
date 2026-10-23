# RT1 and RT2 — request metadata without duplicate snapshots

2026-10-23. Lane `sb4-pg/rt12`, base `901a3627052b93695524b9837935865b92303959`.
Two local commits, in order; no push, stash or git configuration change.

## Governing context (`llp-orient`)

Scope: core mutation acknowledgement, serving publication, response metadata and
both HTTP round-trip tables. Snapback 4's fence applies; the root inventory and
Ibex bootstrap do not. The root LLP 3000 and design brief LLP 2000.000 supply
the engine/host boundary. LLP 3000.009.001.000 (in `current/`) §3.4, §5 and
§9.1 govern handles, fencing and adapter parity; its committer child (also in
`current/`) §3.7 and §9's K0-Q note govern worker ownership and continuations.
The request-budget RFC §3.3–§3.4, §5–§7 is the commissioned change, retaining
its Draft status. The deploy, reads and receipts guide cards were read.

Constraints/rationale: [request-budget §7](../../../llp/3000.009.001.000.001-the-request-round-trip-budget.rfc.md#7-correctness-constraints)
(snapshot/outcome/authority parity), [committer §3.7](../../../llp/3000.009.001.000.000-the-committer.rfc.md#37-the-member-protocol)
(COMMIT before continuation/acknowledgement), [delivery §6](../../../llp/3000.022-delivery-the-sdk-reports.rfc.md#6-the-engine-a-no-op-report-advances-nothing)
(receipt-only writes do not wake), and [retention §12](../../../llp/3000.023-answers-stay-on-screen.rfc.md#12-bound-only-possible-row-revocation-lane-rv-2026-10-02)
(unknown evidence certifies nothing). Documentation updates belong in the
request-budget RFC and append-only JOURNAL. Hand-off: none.

## RT1 design

`mutate_acknowledged` returns an outcome and optional owned publication facts;
ordinary `mutate` retains its existing outcome API. A candidate is assembled
inside the successful member and transferred into the acknowledgement only by
the post-COMMIT continuation. It contains the allocated head, the engine's
accepted incarnation/generation, and the preservation classification of the
same recorder that SQLite persisted. The incarnation is captured during the
existing atomic open and refreshed after successful adoption/reset; it is not
a cross-request authority cache. Postgres's default unknown recorder retains
`preserved: null`, because its tail still writes no evidence.

The serving command updates wake state before acknowledging, in its existing
lock/notification order. It builds its response from those same facts. Replays,
refusals and other callers that need a current head retain the existing fresh
read path. COMMIT errors/unknown outcomes cannot expose the candidate. The
mutation implementation moved out of the nearly full engine module; no SQL,
transaction mode, receipt body or batching protocol changed.

## Witnesses

- Shared SQLite/Postgres concurrent-command witness: sixteen simultaneous
  submitters; every synchronous worker continuation compares carried head,
  incarnation, generation and preservation with the original re-reads before
  acknowledgement, and reads its just-written row. Sequences form 1–16.
- Shared adoption witness: a changed program advances generation; the next
  commit's carried facts equal re-reads; historical replay carries no new facts.
- SQLite reset witness: the next commit carries the new incarnation.
- SQLite ownership-loss witness: a hard-linked owned database fails its ownership guard and refuses the next write
  and fresh head read; no new commit facts escape.
- Postgres stale-token witness: fresh commit facts match re-reads, takeover
  refuses the next write, and unfenced replay still works without new facts.
- Postgres COMMIT-connection-loss witness now uses the acknowledged API and
  requires the original typed unknown outcome, without publication metadata.
- Shared serving-continuation witness confirms COMMIT, loses queue ownership,
  then publishes/responds with **zero database work**, compares those values
  with the old head re-read after loss, and checks the published wake state.
  Its Postgres named ignore is included by the script's existing ratchet filter.

Measurements, final check results and cleanup are recorded below as each
increment completes.

## RT1 measured warm counts

| Class | SQLite before → RT1 | Postgres before → RT1 |
| --- | ---: | ---: |
| action_session_w1 | 39 → 39 | 29 → 29 |
| keyed_first | 87 → 76 | 77 → 62 |
| narrowed_argument | 46 → 46 | 26 → 26 |
| one_membership | 80 → 69 | 58 → 43 |
| rate_limited | 0 → 0 | 0 → 0 |
| replay_hit | 40 → 40 | 30 → 30 |
| unauthenticated | 0 → 0 | 0 → 0 |
| unkeyed_increment | 79 → 68 | 57 → 42 |
| unknown_operation | 46 → 46 | 26 → 26 |
| unknown_token | 5 → 5 | 5 → 5 |
| w1_point | 31 → 31 | 23 → 23 |
| w2_newest20 | 31 → 31 | 23 → 23 |

The unkeyed Postgres 42 and W1 23 match §6. SQLite removes 11 statements;
Postgres removes 15 waits. Every row has three identical warm samples.

## RT1 qualification record

The first core unit run exposed an incorrect new ownership fixture: SQLite
permits continued use of an open renamed database. Its exact isolated rerun
reproduced that assumption failure. The fixture now creates a hard link to its
own database, exercising the existing ownership guard; its corrected isolated
rerun passes. The complete core repeat passes **1,088** cases with five ignores (plus its passing subprocess witness). No store behavior was
changed to make the fixture pass.

The full CLI sweep passed 535 unit cases (9 ignores) and completed every
integration target. Nine integration cases failed initially; every failure
was rerun with only that named case selected. Both toolchain diagnostics
(`farm2_typescript_7_is_refused_by_version_not_crashed_on` and
`w11r1c_toolchain_why_explains_node_start_failure_too`) and the five-second
run-admission case pass alone. Six remain:

| Target | Isolated failure | Observed error |
| --- | --- | --- |
| `init` | `w7a_residency_measures_the_wired_500_follow_reader` | E_SCHEMA source reservations differ from schema derivation |
| `init` | `w8b_residency_measures_the_wired_calibration_shape` | Same reservation error |
| `timeline_adoption` | `check_and_adoption_agree_across_expiry_through_changes_and_following_presence` | Same reservation error |
| `timeline_adoption` | `retirement_resets_dependent_aggregates_even_when_all_names_survive` | Same reservation error |
| `clock` | `advance_drains_expiry_across_multiple_bounded_sweeps` | HTTP read timeout at the existing 30-second bound |
| `security_wave19` | `empty_and_absent_fixture_directories_both_generate_and_record_test_refutations` | Missing generated `security-test.json` after CLI test refusal |

No clean full-CLI claim is made. These additional failures are reported rather
than repaired in this request-metadata lane. The reservation fixture family
matches the supplied known-red category; no baseline claim is made for the
two other failures. The complete outputs are retained under
`/tmp/sb4-rt12-records/rt1-{cli,cli-alone,extra-isolated}.log`.

The initial guide check passed 126 cases and failed its package-content census
because this fresh worktree lacked generated `dist` files. Frozen Bun install,
real wasm binding generation and the package build supplied those artifacts;
the full repeat passes **127/127**. The wasm preparatory build itself exceeded
the existing 735,388-byte gzip budget: initially 735,481. A pinned-Rust-1.97
base archive, using the same authorized target, bindgen and optimizer, measured
735,456 (same raw 2,407,062 bytes), already 68 bytes over. Earlier archive
attempts omitted `rust-toolchain.toml` and used Rust 1.94 (775,734 gzip); those
are explicitly unqualified comparisons. No wasm budget is raised and no
publication or device-artifact qualification is claimed. A final server-module
placement avoids shifting shared device source locations; its result follows.

The final module-declaration placement produced the same 735,481-byte gzip
artifact. The pinned baseline and branch have identical raw byte counts and a
25-byte gzip difference; their source paths differ, so this is not a claim
attributing those bytes. The recorded failed artifact budget remains visible.
The request-only source changes do not require publishing this web artifact.

The publication filter's final repeat passes 16 cases (one named Postgres
ignore), including the two new SQLite serving witnesses. The executing-writer
replay witness retains its historical receipt sequence while republishing and
responding with the current head; this preserves the old duplicate-notification
behavior instead of treating that replay as a fresh commit. The explicit
no-default-features repeat also passes. The full CLI run totals 1,424 passes,
nine initial failures and nineteen ignores across unfiltered summaries;
three named failures pass alone and the six listed above persist.

The complete Postgres script's evaluator stress case initially fails with the
supplied Serializable 40001 signature. Its exact isolated repeat passes both
Serialized and Serializable: 65 increments retained in each, no lost updates,
0 / 80 transaction retries. Later adapter/HTTP stages are recorded below.

## RT1 final checks

| Required check | Result |
| --- | --- |
| `cargo build -p snapback4` | Pass, including the script's final production-code build |
| `cargo check -p snapback4-core --no-default-features` | Pass, explicit final repeat |
| `cargo test -p snapback4-core --no-fail-fast` | Full final repeat: 1,088 passes, five ignores; passing subprocess witness |
| `cargo test -p snapback4 --no-fail-fast` | Every target completed; initial nine failures, six persist alone as listed; affected publication filter 16 passes/one ignore and final SQLite ratchet pass |
| Guide tests | 127/127 pass after generating the missing package artifacts |
| `bash scripts/test-postgres.sh` | Complete: all later stages pass; one supplied Serializable stress failure, exact isolated repeat passes both modes |
| `./ref-check` | Pass after final source/notes (zero errors/unchecked) |
| Whitespace | `git diff --check` pass |

The Postgres adapter stage passes 219 cases; literal/ownership stages 8/25;
handle and doc checks 1/38; committer/maintained/queue stages 2/1/12;
internal HTTP and startup cleanup 1/1; HTTP ratchet plus post-loss publication
2; corpus 19. The public serving witness passes (guest/session, identified
mutation/replay, changes, restart, SIGKILL/takeover, logout/loss, release 2,
non-superuser serving and P1-MC), then independently confirms its owned cluster
stopped. The exact final warm maps are unchanged from the table above on both
stores. No class increases. Test/build execution used only the authorized
Cargo target, jobs=10; free disk remained above the 40-GB stop threshold.

The measurement cluster remains running solely for RT2's required checks.
The script's private public-serving cluster at `/tmp/s10d3-serve-lfor7_iz/data`
is stopped (status 3, no PID file). Final all-process/all-cluster cleanup is
recorded with RT2 below; no publication, push, stash or git settings edit.

## RT2 design and measured warm counts

RT1 commit: `af1888b8129e9585e02454a2b552078f97b7c741`. The next change makes
mutation preflight metadata conditional on a replay/refusal actually using it.
A query supplies a borrowed read-only snapshot to its response-facts callback;
the existing identity SELECT and the already known head are extracted before
program reads. The callback cannot return an owning transaction. Normal query
APIs retain their existing behavior. Generation failures reuse their original
refusal without a second snapshot; early validation refusals still obtain a
head when no query snapshot exists. Metadata/generation handoff retains its
precedence over a persona-auth refusal on obsolete readers.

| Class | SQLite RT1 → RT2 | Postgres RT1 → RT2 |
| --- | ---: | ---: |
| action_session_w1 | 39 → 32 | 29 → 26 |
| keyed_first | 76 → 68 | 62 → 58 |
| narrowed_argument | 46 → 38 | 26 → 22 |
| one_membership | 69 → 61 | 43 → 39 |
| rate_limited | 0 → 0 | 0 → 0 |
| replay_hit | 40 → 40 | 30 → 30 |
| unauthenticated | 0 → 0 | 0 → 0 |
| unkeyed_increment | 68 → 60 | 42 → 38 |
| unknown_operation | 46 → 38 | 26 → 22 |
| unknown_token | 5 → 5 | 5 → 5 |
| w1_point | 31 → 24 | 23 → 20 |
| w2_newest20 | 31 → 24 | 23 → 20 |

The mutation prediction is exact (PG 38). The W1 prediction 19 counted removal
of the entire four-wait response snapshot, but the live identity SELECT remains
necessary inside the query snapshot: actual PG **20**, SQLite **24**. Neither
an attach-time identity substitution nor a SQL join is introduced. Other fresh
mutation/refusal classes save that unused preflight; action reads save the same
query metadata work. Replays retain their current-head boundary. Every class
has three identical warm samples; no class increases.

The existing HTTP refusal witness initially failed because it deliberately
asserted the old gap (`seq = head + 1`) after a commit between metadata and
evaluation. RT2 requires one snapshot, so its stronger assertion is now
`seq = head`, above the earlier answer's cut, with identity/generation checked
against re-reads. The exact updated witness passes. The affected adoption
filter passes 34 cases with two named ignores. New shared snapshot witnesses
hold a read across a competing commit, compare metadata in that snapshot,
keep the original row and then read the acknowledged write, test a refusal at
its cut, reject obsolete readers after adoption and validate a fresh reader.
The focused SQLite snapshot witness passes; the Postgres form is included in
the adapter stage of the complete script.


## RT2 completed CLI and guide checks

The complete CLI run finishes every target: 1,429 unfiltered passes, six
initial failures and twenty ignores. One initial failure is the deliberately
obsolete two-snapshot assertion described above; the corrected exact witness
passes. The clock-drain case passes on its exact isolated repeat. Four cases
persist alone, with the same schema-source reservation errors seen in RT1:

- `init::w7a_residency_measures_the_wired_500_follow_reader`
- `init::w8b_residency_measures_the_wired_calibration_shape`
- `timeline_adoption::check_and_adoption_agree_across_expiry_through_changes_and_following_presence`
- `timeline_adoption::retirement_resets_dependent_aggregates_even_when_all_names_survive`

RT1's missing generated security-record case passes in this full run, as do
its two transient toolchain fixtures and the five-second run-admission guard.
The affected adoption filter passes 34 cases (two ignores). The guide's final
repeat after the wire-contract update passes all 127 cases. The initial
reference check passes 565 documents and 11,769 references, with no unchecked
references or errors; the final post-record check follows below.


The complete RT2 core run passes 1,089 unfiltered cases with five ignores,
plus its passing filtered subprocess witness. The final no-default-features
repeat passes, and the final SQLite HTTP ratchet passes against the updated
table. Its warm map is retained in `rt2-measurements.txt`. The full Postgres
script begins only after that core process exits, so its prescribed manifest
handoff cleanup cannot remove any pending core integration executable.


## RT2 final checks and process custody

| Required check | Result |
| --- | --- |
| `cargo build -p snapback4` | Pass, including the script's final normal CLI build |
| `cargo check -p snapback4-core --no-default-features` | Pass, explicit final repeat |
| `cargo test -p snapback4-core --no-fail-fast` | Complete: 1,089 unfiltered passes, five ignores; passing subprocess witness |
| `cargo test -p snapback4 --no-fail-fast` | Every target completed; four reservation fixtures persist alone; obsolete head-gap assertion corrected and passes exactly; clock case passes alone |
| Guide tests | Final repeat 127/127 pass |
| `bash scripts/test-postgres.sh` | Complete: 387 Rust passes, one supplied Serializable stress red; exact isolated repeat passes both modes; public serving passes |
| Final SQLite/Postgres HTTP ratchets | Pass on both stores; all twelve warm classes equal the tables, no increase |
| `./ref-check` | Pass: 565 LLP documents, 11,769 refs; zero errors/unchecked |
| Whitespace | `git diff --check` pass |

The main Postgres adapter passes 220 cases, including the new shared snapshot
witness. Literal/ownership stages pass 8/25; handle/doc checks 1/38;
committer/maintained/queue stages 2/1/12; internal HTTP/startup cleanup 1/1;
ratchet and zero-SQL post-loss publication 2; corpus 19. The complete evaluator
has only `concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`
red (Serializable 40001). Its exact isolated repeat passes: 65 increments in
each mode, no lost updates, Serialized 0 retries and Serializable 94 retries.
The initial suite red remains recorded; a passing isolated repeat does not
relabel the whole run green.

The public serving witness passes guest/session queries, identified writes and
receipt replay, persisted restart, SIGKILL/lease-expiry takeover, logout and
ownership-loss shutdown, release-2/generation-2 adoption, non-superuser serving,
and P1-MC recount equality. It stops and independently confirms its private
cluster. Final warm/cold maps are retained in `rt2-measurements.txt`.

All owned clusters are now independently stopped (status 3, no PID file):
measurement `/tmp/sb4-rt12.8znlN2/data` (master 517607), RT1 public
`/tmp/s10d3-serve-lfor7_iz/data` (886719), and RT2 public
`/tmp/s10d3-serve-jfmndwv6/data` (1311686). Their data and logs are retained.
`process-custody.json` records the control/master ledger and every public
server PID, plus the retained descendant-monitor ledger path/hash. The final
birth-aware process audit finds no recorded owned process still present, and
an independent executable/cwd census finds no process under the owned target
or cluster directories. Every public server PID is also absent. **PIDs left:
none.** All sampled disk space stayed above 40 GB; final available space is
67 GB. Only the authorized Cargo target and ten build jobs were used. There
was no push, stash, git settings command or contact with the PG17 cluster on
expo-build-450a port 55440.

The final reference audit passes after the source, RFC, guide and qualification
records: 565 LLP documents, 11,769 references, zero errors and unchecked refs.

## RT1/RT2 fix round 1 — 2026-10-23

Base `bfdf05127889775a693960ad21cc6920147a3781`, lane `sb4-pg/rt12-fix1`.
The two supplied blind reviews were read from `/tmp/rt12-review-sol.md` and
`/tmp/rt12-review-grok.md`. The author explicitly selected RT1's confirmed
commit behavior: document and witness it, rather than restore a post-COMMIT
refusal. No additional review is claimed.

Orientation scope: the request-budget RFC §3.3, §3.4, §6 and §7; the committer
RFC §3.7; the port RFC §5.1; root LLP 3000 and brief LLP 2000.000; Snapback 4's
AGENTS/NOT-DOING/JOURNAL; the wire, reads, deploy, search and receipts guide
cards. The port, committer, root and brief are in `llp/current/`; this fence
does not inherit the root inventory or Ibex gates. The context pack's binding
constraints remain COMMIT-before-continuation, no facts for unknown COMMIT,
ordered wakeups, fresh authority/ownership checks for later requests and one
query snapshot for evaluated metadata. Relevant `@ref`s still resolve. No
new design document, capability, ceiling or delivery step is introduced;
hand-off: none.

Changes and witnesses:

1. RFC §3.4/RT1 and `guide/wire.md` state that confirmed durable commits remain
   HTTP 200 sent with their commit-time seq/head/generation/incarnation after
   intervening activation or ownership changes. A test-only pause immediately
   before publication drives real HTTP mutations, a real committed foreign
   Postgres activation, and hard-link ownership loss on an owned SQLite file.
   Each requires the committed metadata, a condition-variable subscriber wake,
   proof that fresh seq now fails, and a refused next HTTP query. Postgres is
   selected by the existing `round_trips_postgres` filter; SQLite runs normally.
2. The refusal-cut witness comment matches its existing head=seq assertion.
3. RFC §3.4 now distinguishes carried request facts from non-request publishers
   that still call `continue_durable_publication` and take fresh snapshots.
4. The query metadata callback returns its original error immediately. An HTTP
   SQLite authorizer witness permits activation/head reads, denies the callback's
   live store_id read, requires the same E_STORE/503 envelope and zero program
   row reads. A healthy control requires successful program row reads. Normal
   success adds no store read or metadata clone.
5. The early-cut fallback is reachable over HTTP. Held queries return
   E_QUERY_HELD before read_transaction; validate_inputs also sees missing
   required arguments, text bounds and malformed cursors after JSON shape
   decoding. HTTP witnesses require their existing denied status (held: 200;
   E_INPUT: 400), fresh head and absent seq. Unknown names, wrong doors and JSON type/shape errors return
   earlier. No fallback behavior changed.

The first witness compile caught two literal Shared fixture initializers that
needed the new test hook and one unconstrained collected Program type. Those
fixture-only compile issues were corrected before executing the witnesses.

The first witness execution passed the metadata short-circuit case and exposed
two incorrect expectations in the new fixtures: SQLite's hard-link guard is
E_STORE, and early engine E_INPUT query refusals use HTTP 400. The tests now
assert those existing outcomes; no product behavior was changed to satisfy
them. Final execution results below supersede those fixture attempts.

This round uses only `/home/ccheever/projects/sb4-p0-s8/snapback4/target`, built
cold with `-j 4` / `CARGO_BUILD_JOBS=4`; no preserved target copy was created.
The complete core command passes 1,089 cases plus its passing subprocess
witness, with five ignores. The complete CLI binary command passes 540 cases
with eleven named ignores, covering serve, publication, committer, adoption and
round trips. All three new non-Postgres regressions pass; the existing refusal
cut witness and SQLite RT0 ratchet pass. Normal build and the explicit
no-default-features core check pass. The full Postgres script and its final
build use the extracted PG16 tools/libraries, TMPDIR=/tmp and only private
socket clusters; its process cleanup and final results follow below.

The main Postgres adapter stage passes all 220 cases; literal tests pass all
8. Three additional, unchanged 300-ms lease fixtures fail in the full run:

- `engine::postgres::ownership::tests::renewal_between_poll_and_claim_terminates_nothing`:
  `renewed claim must match zero rows` at `ownership.rs:291`.
- `engine::command::tests::postgres_tests::commit_outcome_unknown_reaches_the_queued_submitter_unchanged`:
  `ownership lost before listener admission` at `command_postgres_tests.rs:87`.
- `engine::command::tests::postgres_tests::ownership_loss_refuses_every_queued_command_and_new_admission`:
  the same listener-admission setup failure.

Each exact case passes alone using the identical compiled test binary and the
same owned private cluster (respectively 9.19 s, 1.72 s and 3.17 s). No ownership,
queue or lease source was changed, and no baseline run is claimed. The original
failures remain recorded; the full script is not described as green. Logs:
`/tmp/rt12-fix1-{ownership-alone,queue-unknown-alone,queue-ownership-alone}.log`.
The supplied evaluator Serializable stress case also fails with 40001 and was
not chased. All later stages continue; final HTTP results and custody follow.

The full script's Postgres RT0 ratchet passes with the original table, as does
the carried-publication queue-loss witness. The new foreign-activation witness
passes its confirmed 200 sent reply, commit metadata, subscriber wake, and
failing fresh seq read, then exposes one more fixture expectation error: the
next request is refused at ingress with 401 E_GENERATION, before the query's
503 handoff path. The corrected assertion preserves that existing 401 (SQLite
remains 503 E_STORE). No product change was made for this mismatch. All three
Postgres round-trip/publication witnesses are rerun below on a fresh owned
private cluster, with the original tables retained.

### Final qualification

| Check | Result |
| --- | --- |
| `cargo build -p snapback4 -j 4` | Pass, including the complete Postgres script's final normal build |
| `cargo check -p snapback4-core --no-default-features -j 4` | Pass |
| `cargo test -p snapback4-core --no-fail-fast -j 4` | Pass: 1,089 cases plus the passing subprocess witness; five ignores |
| `cargo test -p snapback4 --bin snapback4 --no-fail-fast -j 4` | Pass: 540 cases, eleven ignores; includes all affected serve/publication/committer/adoption/round-trip cases |
| `bash scripts/test-postgres.sh` | Every stage completed; exit 1. Initial failures: supplied Serializable 40001, the three lease fixtures listed above, and the new witness's corrected next-request status assertion. The three lease cases pass exactly alone; the corrected Postgres witnesses pass below. No clean full-script claim |
| Final `round_trips_postgres -- --include-ignored --nocapture` | Pass, 3/3: original ratchet, queue-loss publication, and the corrected foreign-activation HTTP witness |
| Public Postgres serving | Pass: bootstrap refusal/read-only checks, HTTP identity/query/mutation/replay, restart, takeover, release 2, non-superuser serving and P1-MC |
| `./ref-check` | Pass, zero errors or unchecked references |
| `git diff --check` | Pass |

The final Postgres filter ran on another fresh private PG16 cluster. Its
foreign-activation witness now requires the actual next-request 401
E_GENERATION; SQLite continues to require 503 E_STORE. The committed reply in
both cases is 200 sent with commit-time seq/head/generation/incarnation and a
subscriber wake at that head. Final focused output is retained at
`/tmp/rt12-fix1-final-postgres.log`; full required-check logs are
`/tmp/rt12-fix1-{build-final,no-default,core,binary,postgres}.log`.

Both RT0 ratchets passed. Both JSON tables are byte-identical to
`bfdf051278`, independently compared again after the final run:

| Table | SHA-256 |
| --- | --- |
| SQLite | `dfce76ee390e0557076254a0aa0fc42f57985cad5ae5f9324e8c62654fc1722b` |
| Postgres | `08f5fe9b83f1e70597d4760f9dc359ca8c26fb9c7d00fd36f62bfc1b79b8625f` |

### Final process custody

| Private cluster | Recorded postmaster PID | Independent final check |
| --- | ---: | --- |
| `/tmp/sb4-pg-eval.DGDiCY` | 2531216 | pg_ctl status 3; no postmaster.pid; PID absent |
| `/tmp/s10d3-serve-sv28bk40` | 2748366 | pg_ctl status 3; no postmaster.pid; PID absent |
| `/tmp/rt12-fix1-final-pg.myhg1H` | 2786637 | pg_ctl status 3; no postmaster.pid; PID absent |

The public serving children (2771306, 2771466, 2772256, 2773027, 2773198,
2782393) are all absent, as are every recorded command/test/client/driver PID.
The complete 26-PID absence audit and table comparison are retained in
`/tmp/rt12-fix1-cleanup.json`; `/tmp/rt12-fix1-pids.jsonl` and the public
witness's `pids.jsonl` retain launch records. No executable under this lane's
target remains running. Cluster data is retained for inspection. The PG17
cluster on port 55440 was never used or touched. Lowest observed /home free
space was 58 GB, above the 40-GB stop threshold. No target copies, push,
stash, or git configuration changes. PIDs left: **none**.
