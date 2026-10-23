# P1-EV-1 — ordinary Postgres release evolution

## Fix round 1 — 2026-10-23 (stopped)

Base under test: `1875a9e77ff380cf6f51a4b724bb42e4b22445a8` on
`sb4-pg/p1-ev1`. **SQLite admits a case the brief requires to refuse.**
The author's instruction was: “if SQLite itself admits one of the refused
cases, stop and report that rather than diverging.” Implementation stopped
on that condition; this round does not claim the review findings are fixed.

The focused in-process SQLite witness compiles these three releases and seeds
parent `p` plus child `c` before retiring the column:

```quarry
-- v1: children.item
item: parents ? on delete restrict
-- v2: children.item omitted
-- v3: children.item, with restore_dormant = true
item: parents ? on delete keep
```

`Engine::adopt_release_at` returns `Ok(3)` for v3. Generation becomes 3 and
the raw restored child contains `{id: Id("c"), item: Id("p")}`. The witness
asserting refusal therefore fails on the old tip (one failed test, exit 101).
No production source file was changed. The exact temporary test source is
`/tmp/sb4-p1ev1-fix1/ev1_fix1_probe.rs`; it was copied into the existing core
test directory solely for compilation and removed after the run. Its command:

```sh
cargo test --locked -j 4 -p snapback4-core --test ev1_fix1_probe -- --nocapture
```

Both Cargo attempts used only this worktree's target, four jobs and exported
`CARGO_PROFILE_DEV_DEBUG=line-tables-only` /
`CARGO_PROFILE_TEST_DEBUG=line-tables-only`. The initial multi-case probe
already demonstrated this admission, then hit a cascade fixture's missing
product-bound diagnostic; that attempt establishes no cascade verdict. The
focused rerun contains only the valid restrict-to-keep case and fails at its
expected-refusal assertion. Source, logs and process receipts are retained
under `/tmp/sb4-p1ev1-fix1/`, outside Git.

| Requested item | This round's result |
| --- | --- |
| Complete retained definitions/static refusal | Stopped: SQLite admits restrict → retire → keep. Its dormant `Column` contains kind, default, ownership and optional capture source, but no deletion policy or text constraints. No Postgres divergence introduced. |
| Other SQLite restore verdicts | Cascade → omitted, text → email/minimum and identical optional URL round trip were not evaluated after the stop condition. |
| Raw stored-row comparison/decision | Deferred; no change to either store and no new stored-byte qualification or SQLite ticket. |
| Default/requiredness and expanded public witness | Deferred with implementation. |
| Build, no-default check, full core, evolution/maintained/release targets, affected binary tests, RT0 and Postgres script | Not run for this stopped round. Prior results below are historical, not new qualification. Both RT0 tables remain unchanged. |

No Postgres cluster or server was started, and PG17/55440 was untouched.
All recorded probe processes exited and were confirmed absent. Disk samples
remained above 40 GB. The seven previously committed `*.jsonl` process traces
were copied to `/tmp/sb4-p1ev1-fix1/prior-jsonl/` and removed from Git as
requested. Only documentation and those deletions are committed; no push,
stash or git config change. Reference/whitespace validation for this report
is recorded in the journal entry.

## Original round qualification

Date: 2026-10-23. Branch: `sb4-pg/p1-ev1`; base: `06a9d2c47f` from
`origin/sb4-pg/main-mirror`. Local commits only; no push, stash or git config
change. The inventory was committed before implementation (`c41b1551a8`).
The adapter and initial conformance are `4a076a7781`; refusal/ownership repairs
are `8d0983536d`. `bf2a3bed9c` closes execution-fact/lifetime boundaries and
restore refusal parity; `8c1cd5869f` exposes configured restoration, the public witness and
guide updates. This directory records the final qualification.

## Admission slices

The durable-table inventory and each slice's conformance obligations are in
[the store-port RFC §3.5](../../../llp/3000.009.001.000-the-postgres-store-port.rfc.md#35-p1-ev--release-evolution-inventory-and-slices).

| Slice | Scope | Remaining refusal |
| --- | --- | --- |
| EV-1 | Ordinary table additions; optional/literal-defaulted columns; index add/drop/redefinition; dormant table/column/index retirement and explicit restoration, including ordinary refs | Admitted |
| EV-2 | Existing type/default/requiredness/constraint changes, required/context-default additions, narrowed rows | `evolution-narrowing`, `evolution-required-column` |
| EV-3 | Forward backfills, reverse downfills and scalar rename projections | `evolution-backfill` |
| EV-4 | Authority, temporal/read-through/recorded lifecycle, sequence/delivery and maintained-population compositions | `evolution-authority`; unclassified changes keep `release-activation` |
| EV-5 | Explicit table/asset-column renames and aliases | `evolution-renames`; independent asset admission still applies |
| EV-6 | Prune, rollback, preview/staging and saved-version operators | Existing operator/inspection refusals |

The SQLite lifecycle code forced one tightening of the initial plan: its
source-retirement pass visits unchanged temporal/read-through/recorded durable
populations too. EV-1 therefore refuses ordinary schema changes in a schema
containing any such table, even unchanged. Previously admitted P1-MC changes
whose ordinary schema is unchanged remain admitted. A changed table with
sequences or other authority declarations also refuses. Tables carrying
maintained columns cannot be retired in this slice. Rule/audience, storage
owner and existing column interpretation changes remain refused. Existing
asset, runner, view-recount and other profile refusals retain precedence.

## Implementation and conformance

Six C-collated, shape-checked relations retain definitions, rows, cells and
reference lifetime evidence: `_dormant_tables`, `_dormant_columns`,
`_dormant_indexes`, `_dormant_rows`, `_dormant_values`, `_dormant_refs`.
Schema/retained-definition admission precedes preparation writes, under the
existing first-lock owner fence and head lock. Activation, including dormant
movement, catalog, indexes, selection/history and generation, is one
transaction. Data-dependent restore/unique failures retain `E_ADOPT` and roll
everything back. The lower-level unversioned P1-MC group validator retains
`E_CONSTRAINT`. Before release retention is enabled, unversioned projection
retains SQLite's destructive behavior.

The shared contract passes **11 tests** (four SQLite, seven Postgres), including
all EV-1 changes, retire/restore and partial restoration, exact Unicode/JSON
NUL/null/required values, sparse defaults and their indexes, index
redefinition/unique collision, missing restore intent, factual inventory and
Unicode pagination, rollback, generation advance, stale writers, deleted/reused
parent ids and deleted/reused child ids. A newly inserted row lacking a
historical required cell refuses restoration without inventing a value; after
deleting it, restoration preserves all historical values. Additional Postgres
cases reject active authoritative-to-maintained conversion, an ordinary edit
carrying forged execution facts, and an unrelated edit beside an unchanged
temporal table. All eight existing maintained-column tests also pass.

The existing execution-fact guard retains SQLite's exact control flow. A
Postgres-specific extension checks ordinary changes too; it ignores only the
binder's appended `; selected ...` diagnostic on point/scan reasons, which
changes when an index changes. Classes, held/prediction/branch declarations,
reason prefixes, rewrites and extra operations stay checked. Persisted facts
retain their full diagnostic text.

## Public witness

`deploy`/`serve` uses a private socket-only PG16 cluster and the same sequence
on SQLite: v1 writes rows; v2 adds a table, optional/defaulted columns and an
index, drops the old index and retires a table/column; v3 uses
`--restore-dormant` to restore them. Public reads verify interpreted defaults,
index order and exact restored rows/values. The two **13-response** canonical
wire transcripts are byte-identical: **2,578 bytes**, SHA-256
`0653a99b12df679f5de688b66ac7dd9299927d5cc56538262582896faf87fe38`.
Only `store_id`, `now` and the independently checked minted guest viewer are
excluded; data, generations, sequences, scopes and cursors remain compared.
See [Postgres](postgres-wire.json) and [SQLite](sqlite-wire.json).

The final **complete public stage passes** (370.8 seconds), including all six
new missing-ledger recovery fixtures, bootstrap/binding, restart, takeover,
ownership loss, receipt replay, P1-CE and the existing S1/P1-MC fixture. Its
cluster is independently confirmed stopped, every one of its 358 recorded
PIDs is absent, and its scratch directory has been removed.

The first full public stage passed EV-1 and P1-CE on both stores, then caught
an introduced diagnostic-order regression in the incomplete-bootstrap fixture:
the new dormant tables were checked before `_head`. The manifest now preserves
the foundational check order and appends the six new tables. Recovery fixtures
also remove each new table individually and demand refusal before repair,
binding or token claim. The focused EV-1 public run had already passed.

## RT0

Both ratchets pass. All 24 warm cells and both checked-in tables/allowances are
unchanged. Dormant deletion bookkeeping is folded into the existing row-delete
CTE; activation is outside the request path.

| Warm cell | SQLite | Postgres |
| --- | ---: | ---: |
| action_session_w1 | 39 | 29 |
| keyed_first | 87 | 77 |
| narrowed_argument | 46 | 26 |
| one_membership | 80 | 58 |
| rate_limited | 0 | 0 |
| replay_hit | 40 | 30 |
| unauthenticated | 0 | 0 |
| unkeyed_increment | 79 | 57 |
| unknown_operation | 46 | 26 |
| unknown_token | 5 | 5 |
| w1_point | 31 | 23 |
| w2_newest20 | 31 | 23 |

## Checks

Every Cargo command used this worktree's target, five jobs, and
`CARGO_PROFILE_DEV_DEBUG=line-tables-only` /
`CARGO_PROFILE_TEST_DEBUG=line-tables-only`. The authorized original target
was deleted first. No other lane's files or cluster were removed.

| Command/scope | Result |
| --- | --- |
| `cargo build -p snapback4` | Pass, including the final rebuild |
| `cargo check -p snapback4-core --no-default-features` | Pass, repeated after the boundary changes |
| `cargo test -p snapback4-core --no-fail-fast` | Pass: 1,092 passes across 48 target summaries, five existing ignores |
| Final dual-store EV-1 contract | Pass: 11/11, including all Postgres cases |
| Final maintained-column scope | Pass: 8/8 |
| Guide contract | Pass: 127/127. Updated the stale action pin and kept the deploy card within its existing 280-line limit; neither bound was raised |
| Both RT0 ratchets | Pass; no table/budget/allowance changes |
| `cargo test -p snapback4 --no-fail-fast` | 1,440 passes, ten failures, 20 ignores; classification below |
| `bash scripts/test-postgres.sh` | 408 Rust passes, one supplied evaluator Serializable stress red; first public-stage regression repaired as above |
| `./ref-check` | Pass after the journal and follow-up tickets: 565 LLPs, 11,777 refs, zero errors/unchecked |

The broad binary run's ten failures were:

- Two existing release intake-switch tests and clock expiry-drain: socket
  `WouldBlock` under load. The isolated release lifecycle scope passes 12
  tests, one existing ignore. Clock expiry-drain still hits its 30-second
  socket timeout when run alone; it is unresolved.
- `kit3_large_clock_report_uses_complete_http_and_runnable_no_argument_commands`:
  its former transport-ceiling size assertion also fails alone. Both the clock
  tests and clock verb source are unchanged from base; these SQLite-only
  failures are recorded as unresolved, not counted as passes.
- Two init and two timeline-adoption fixtures with the supplied
  `source reservations differ from the schema derivation` red.
- Supplied `web_witness_help_and_invalid_input` red (missing `E_INPUT`).
- The inherited store-port test census: `dev_worker_tests.rs` has four sites
  against listed zero. Both that source and its allowance are byte-identical
  to base `06a9d2c47f`. No allowance was raised. The final census rerun
  reproduces exactly this failure; the separate committer ratchet passes.

The full core command preceded the last Postgres boundary refinements; the
final affected 11-case contract and eight maintained-column cases were rerun
after those refinements.

The unresolved [clock failures](../../../issues/20261023-snapback4-clock-qualification-timeout-and-report-failures.md)
and inherited [census mismatch](../../../issues/20261023-snapback4-store-port-census-dev-worker-baseline.md)
have repository follow-up tickets.

The Postgres script continued past the supplied evaluator stress failure and
passed its other Rust stages, including real ownership/HTTP, change evidence,
maintained columns, the retained read-through/review oracles and corpus.
The first isolated stress command omitted `--include-ignored` and ran no
stress test; it is not qualification. The corrected isolated rerun passes: one
test, zero ignores; 65 increments in each mode, no lost updates, zero
Serialized retries and 104 Serializable
retries. Retained oracle passes do not claim public admission of their
evolution.

The optional root `node scripts/check-inventories.mjs` failed on missing
generated Snapback 1 demo artifacts and old diagnostic-removal justifications;
these are outside the Snapback 4 fence and were not modified. Its diagnostic
is preserved in [inventory-check.log.gz](inventory-check.log.gz).

## S10e-1 interaction

Read-only inspection of `sb4-pg/s10e1` at `9766d2ffe1` finds two fixtures pinning
the old `E_STORE_UNSUPPORTED: release-activation` refusal: the read-through
owner-copy conversion and `expiry_default`'s expiry/default/read-through chain.
**Neither is admitted by EV-1.** With this lane's more specific admission they
fall under `evolution-authority`; that lane's family assertions need adjusting
when integrated. No file or commit on that branch was edited.

## Process custody

All six original-round private postmasters were stopped and absent. Stop checks used
`pg_ctl status = 3`, no `postmaster.pid`, and independent PID absence before
removing their exact owned directories. The final audit has **903 recorded PID
entries, 844 unique PIDs, none present**, and no executable from this
worktree’s target. Cleanup receipts are included; raw JSONL PID ledgers were
removed in fix round 1 and preserved outside Git. All logged
test scratch paths are also absent. The final disk sample is 170.97 GiB free;
no observed guard sample crossed 40 GiB. After preserving the logs, the lane’s
verification scratch and temporary reference logs were removed. PostgreSQL 17
on port 55440 and every other session’s cluster were untouched.

The [check ledger](checks.json) preserves each command-stage result, including
failed initial runs and corrected repeats. Compressed command logs are in
`logs/`; [process-audit.json](process-audit.json),
[evaluation-cleanup.json](evaluation-cleanup.json) and
[public-cleanup.json](public-cleanup.json) record the final custody checks.
