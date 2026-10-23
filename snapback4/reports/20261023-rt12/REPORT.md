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
