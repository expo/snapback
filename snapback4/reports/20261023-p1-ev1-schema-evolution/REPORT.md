# P1-EV-1 — ordinary Postgres release evolution

## Fix round 2 — 2026-10-23 (restore byte parity)

Base and failing-before production: `f8c54693c129`. The lead reverses
round 1's sparse-restore decision. Local-only work on `sb4-pg/p1-ev1`;
no push, stash or Git configuration change.

### Changes and baseline sensitivity

Postgres now matches SQLite's column-restore walk: select tables from retained
definitions (including definition-only restoration), materialize predecessor
optionals/defaults across every live row, overlay retained values, then write
canonical JSON. Rows inserted while the column was absent also participate;
a missing retained cell does not skip materializing the predecessor. A restored
table supplies its retained predecessor. Ordinary add-column remains sparse.
SQLite production is unchanged, and request-path statements are unchanged.

The shared witnesses read **literal `r.data` strings** through the two physical
adapters, without materializing or re-encoding them. They also compare complete
small-row query outcomes, large-default point/scan meters, and parent-delete
change evidence. The public witness uses only configured deploy/serve and
HTTP to reproduce the large-default `/changes` difference.

| Witness | On unchanged `f8c54693c129` production | With this fix |
| --- | --- | --- |
| `{id,n,memo}` → retire memo, add `extra?` / `count default 7` → restore | Literal row mismatch: SQLite stores both siblings; Postgres omits them. A third row inserted while memo is dormant exposes the same mismatch without a retained memo cell | Equal literal `r.data` for all three rows, including Unicode/NUL and explicit null memo; equal complete point-query outcomes |
| 300 KiB required literal-default sibling, empty child with `on delete restrict` | Literal image sizes **307,298 B SQLite / 74 B Postgres** | **307,298 B on both**, byte-for-byte equal |
| Delete the restored large-default parent | SQLite evidence is unknown; Postgres evidence is certified | Both unknown |
| Public `/changes` for that delete | SQLite `changes: null, preserved: null`; Postgres `changes: {after: 1, through: 2, writes: {notes: null}}, preserved: [children]`. Focused public harness fails equality | Both complete HTTP answers equal: `changes: null, preserved: null`, generation 3, sequence 2, touched `notes` |
| Post-restore scan and point query meters | Already equal for these queries; coverage, not a claimed baseline meter failure | Equal in every `Metered` dimension, data and completeness |

The failing-before Rust run has 14 passes and exactly three failures: small
literal bytes, large literal bytes, and large parent-delete evidence. The
focused public witness separately fails the HTTP equality assertion. The
first implementation run passes the complete 35-case dual-store evolution
target. Final qualification is recorded below. Early development probes had
Rust borrow/signature/assertion compile errors and were corrected before the
failing-before execution; no compilation failure is counted as product evidence.

The large-default scan's final meter is examined 1, index entries 0, rule
probes 0, steps 3, heap 307,584 B, output 307,310 B, rows written 0 on both
stores. The point query is steps 3, heap 615,170 B, output 307,298 B with
otherwise the same counters. Both queries are complete with equal data.
A second pass at a 1 MiB heap ceiling also matches every counter and result:
the scan stays complete, while both point queries cap with heap 1,230,044 B
and output 6 B. The public focused harness passes in 192.14 seconds, with
its private cluster stopped and confirmed. The earlier HTTP baseline run
failed as expected in 176.09 seconds and also stopped its own cluster.

### Ledger scope and review nits

No legacy compatibility decoding is added. EV-1 has not landed; its earlier
experimental retained-column format cannot occur in a real supported store.
These tests create fresh in-memory stores and uniquely named Postgres
namespaces. A developer could explicitly reuse one of the old private
clusters retained under `/tmp/` with a newer binary, carrying experimental
pre-fix records across runs. Those disposable artifacts are not an upgrade
contract; this round uses a fresh PG16 cluster and never opens an earlier
round's database. The required retained fields keep failing closed.

Grok's coverage nit is closed with two one-line preparation cases: default
7→8 and optional→required. They join the existing four cases and their
identical-restore positive controls. Other optional nits leave no required
change. The previous SQLite-only sparse-storage ticket is
[closed](../../../issues/closed/20261023-snapback4-sqlite-restore-materializes-sibling-defaults.md):
both stores materialize on restore, and going sparse would require a
both-store change plus observable-evidence/meter qualification. RFC §3.5 and
its Revised line record the ruling and the pre-landing ledger boundary.

### Checks and custody

All targeted affected scopes pass. The full Postgres script completes all
stages and exits **1** with the two classified Rust failures below; its
complete public harness passes. Both exact failing cases pass alone. The
Serializable stress occurrence is tracked in the
[open evaluator ticket](../../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md).
All Cargo commands use this worktree's own target, four jobs (including the
script's inherited `CARGO_BUILD_JOBS=4`), and exported
`CARGO_PROFILE_DEV_DEBUG=line-tables-only` /
`CARGO_PROFILE_TEST_DEBUG=line-tables-only`. Only private PG16 clusters are
used. Logs, wire artifacts and process records stay under
`/tmp/sb4-p1ev1-fix2/` or the public harness's private `/tmp/` scratch; no raw
log or PID trace is added to Git. The 40 GiB free-space guard is sampled while
each command runs. PG17/55440 is untouched.

| Check | Round-2 result |
| --- | --- |
| `cargo build --locked -j 4 -p snapback4` | Pass; 183.28 seconds |
| Core `--no-default-features` check | Pass |
| Full default core, `--no-fail-fast` | **1,103 passes, zero failures, five existing ignores**; 1,506.70 seconds |
| Final dual-store evolution target | **35/35**, zero ignores; includes both heap ceilings |
| Nontransactional preparation witness | Pass: six refusal cases plus identical-restore positive controls |
| Maintained-column scope | **9/9** |
| Core release contract | **21/21** |
| Binary release lifecycle | **12 passes, one existing ignore**, zero failures |
| Both RT0 ratchets | Pass: every one of 24 warm cells equals the original table; checked-in tables/allowances unchanged |
| Focused public harness | Pass; 192.14 seconds. Original 13-response transcripts remain exactly 2,819 B and SHA-256 `b24af6ef8cb10d1a329319647c2ed133109853e5f83092952802daac4690cfa1`; both large-default `/changes` responses are equal and unknown |
| `bash scripts/test-postgres.sh` | **433 Rust passes, two failures, zero ignores**; all stages run, complete public harness passes; exit 1, 2,090.97 seconds. Both exact failing cases pass alone; details below |
| Root `./ref-check` | Pass: 565 LLPs, 11,781 refs, zero errors/unchecked; repeated after final report/journal |

The evaluator conformance target completed with 17 passes and one failure:
`concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`
escaped SQLSTATE `40001` at `tests/conformance.rs:244`, followed by the join
at :257. This is the existing open stress-failure class, not an EV-1 restore
case. The evaluator source and retry path are unchanged. Its exact executable,
SHA-256 `619849a44b8ce663c95fa1caceafeff4a379ceeb68e8299f6e96d8b2e21d6dd5`,
passes the exact case in one isolated run: 65 increments per mode, no lost
updates, zero serialized and 96 total serializable retries. No limit, backoff,
internal writer concurrency, timeout or durability input changed. An isolated pass does not
make the complete script green or establish a root cause. The existing
[evaluator ticket](../../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md)
retains this occurrence.

The ownership subtarget has 24 passes and one failed live-lease assertion in
`two_owners_stale_token_refuses_without_a_receipt` at
`engine/postgres/tests/ownership.rs:228`: contender B acquires where the fixture
expects `None`. Its lease is 300 ms. The exact unchanged core test executable
passes that exact case alone in 1.41 seconds. This is a timing-sensitive
observation, not a root-cause attribution; the ownership implementation and
lease settings remain unchanged. This fixture uses an unversioned store,
without dormant release restoration. The complete-script failure remains a
failure despite the isolated pass.

The requested binary scope is release lifecycle, not a new broad binary
sweep. Round 1's historical clock, reservation, security-wave19 contact
refutation and web-witness reds remain classified below; no unrelated fixture,
implementation or allowance is changed in this round.


Final public qualification repeats both EV-1 scenarios successfully and passes
all existing serving/recovery/ownership/P1-CE/P1-MC stages. The original
13-response wire transcripts still have the same 2,819-byte length and SHA-256
above. Both large-default `/changes` responses are exactly equal after only
store-id/time normalization: unknown changes and preservation, generation 3,
sequence 2, touched `notes`. No complete-script green claim is made.

All **four owned private PG16 clusters** are independently confirmed stopped:
`pg_ctl status = 3`, no `postmaster.pid`, no recorded postmaster or remaining
process with an owned cluster's data directory. The cleanup audit checks
**1,235 unique recorded PIDs**, all absent, and finds no executable
remaining from this worktree's target. Final sampled free space is
**149.38 GiB**; the 40 GiB guard never fired. Raw logs, exact isolated
executables, copied wire artifacts and process evidence remain under
`/tmp/sb4-p1ev1-fix2/`; none is added to Git. PG17/55440 and other sessions'
clusters are untouched. Whitespace validation passes. Local commit only;
no push, stash or Git configuration change.

## Fix round 1 — 2026-10-23 (lead ruling applied)

Historical qualification. Round 2 above supersedes the sparse-restore decision
and the claim that interpreted-row parity made the storage difference unobservable.

Continuation base: `2e2bfe600b`; production baseline: `1875a9e77f`.
Local commit only; no push, stash or git configuration change. The prior
stopped attempt is superseded by the lead ruling: Postgres restore
admission is bounded by the equivalent in-place edit on its retained
predecessor and requires an identical retained column definition. SQLite's
broader admission is not a semantic divergence when it also admits the edit
in place. This round changes no SQLite production code.

### 1. Complete retained definitions and admission

The Postgres ledger now retains kind, default, authoritative ownership,
optional engine capture source (all fields of SQLite's dormant record),
deletion policy and per-column text constraints. Restoration compares those
fields before initialization or release preparation. Type/default/constraint
changes refuse `evolution-narrowing`; deletion-policy/ownership changes refuse
`evolution-authority`. An identical optional formatted-text definition restores.
Logical unique constraints remain index definitions, with group validation.

The same nine cases run independently in place and across retirement on both
stores. Invalid text is included so row validation cannot mask a missing static
refusal. Refused attempts preserve generation, raw rows and dormant inventory;
a subsequent identical restoration still succeeds. A separate Postgres witness
uses a nontransactional sequence and schema-scoped DDL event trigger on the
preparation initializer, plus a
positive identical-restore control to observe attempted writes even if they
would roll back.

| Column definition | SQLite in-place | SQLite retire/restore | Postgres in-place / restore |
| --- | --- | --- | --- |
| `parents ? on delete restrict` → `parents ? on delete keep` | Admit, generation 2 | Admit, generation 3; parent id preserved | Both `evolution-authority` |
| `parents ? on delete cascade` → `parents ?` (implicit restrict) | Admit | Admit; parent id preserved | Both `evolution-authority` |
| `text <=100` → `text <=100 format email`, conforming value | Admit | Admit; value preserved | Both `evolution-narrowing` |
| Same format change, value `x` | Admit; row hidden | Admit; row hidden | Both statically `evolution-narrowing`, never row-validation `E_ADOPT` |
| `text <=100` → `text 8..100`, conforming value | Admit | Admit; value preserved | Both `evolution-narrowing` |
| Same minimum change, value `x` | Admit; row hidden | Admit; row hidden | Both statically `evolution-narrowing` |
| Identical `text <=200 format url ?` | Admit without generation change | Admit; exact value restored | Admit / admit |
| `int default 7` → `int default 8` | Admit | Admit | Both `evolution-narrowing` |
| `int ?` → `int`, historical non-null value | Admit | Admit | Both `evolution-narrowing` |

No case has SQLite refusing in place while admitting restore, so no SQLite
admission-loophole ticket is needed under the ruling. Text minimum syntax is
`text 8..100`; the brief's `min 8` denotes the same constraint but is not Quarry
syntax. Parent deletion is not an authored entry point in the cascade fixture,
so the test does not invent an unrelated product cap.

### 2. Stored bytes after restore

The shared raw-row witness implements `{id,n,memo}` → retire memo and add
`extra?`/`count default 7` → restore memo while retaining those additions.
SQLite physically adds `extra = null` and `count = 7` on the final restore;
Postgres keeps both absent and restores the exact memo, including Unicode/NUL.
The two interpreted query rows are identical, including both siblings. This
round keeps Postgres's sparse bytes because §3.5 explicitly requires new
optionals/defaults to remain physically absent. `row_image` supplies those
values for reads and index construction, making the distinction unobservable
in application wire rows (raw owner inspection can see it).

The [SQLite follow-up](../../../issues/closed/20261023-snapback4-sqlite-restore-materializes-sibling-defaults.md)
records the reproduction and required preservation of physical absence. SQLite
is unchanged. The differential witness pins the current raw difference and
identical interpreted results rather than silently asserting raw parity.

### 3. Witness gaps and baseline failures

Default-only and optional→required cases now run both in place and after a
column drop. Deletion policies and text format/minimum changes have dedicated
cases. The public v3 keeps v2's `extra`/`count` declarations while restoring
memo, the retired table and an identical optional URL field; v3 differs from
v1. It compares full normalized response bytes and checks exact restored data.
The first complete public run passes: 13 responses, 2,819 bytes per store,
SHA-256 `b24af6ef8cb10d1a329319647c2ed133109853e5f83092952802daac4690cfa1`.
Only store id, wall time and the independently checked minted guest viewer
are excluded; generation, sequences, data, scopes and cursors remain compared.

On unchanged `1875a9e77f` production code, the complete expanded Rust target
has 28 passes and three failures: restrict→keep restoration wrongly returns
`Ok(3)`, cascade-column retirement refuses `release-activation` before it can
reach the restore probe, and identical URL restoration returns
`evolution-narrowing`. Cascade retirement now excludes schema-derived
action-event prices from residual declaration comparison; input derivation and
executable facts remain independently checked. This permits its identical
restore and the changed-policy static refusal to be exercised. The
expanded public witness independently fails v3 deploy with that same URL
refusal. The old raw-row comparison demonstrates unequal stored rows, while
the interpreted rows match. Default/requiredness and static changed-text
refusals already pass on the baseline; they close coverage gaps rather than
claiming new product fixes. The initial minimum probe used invalid syntax and
was corrected before collecting the complete verdict table. An initial
preparation probe used the retained evaluator (whose `evolution` refusal is
intentional); it is not qualification of the common Engine.

### Checks and custody

Qualification is complete. The broad binary failures below remain explicitly
unresolved; every affected evolution/release check passes.
Every Cargo command uses this worktree's target, four jobs, and exported
line-tables-only dev/test profiles. Evidence, logs and PID traces remain under
`/tmp/sb4-p1ev1-fix1/`; public harness scratch is also under `/tmp/`.
The seven old committed JSONL traces were already removed by `2e2bfe600b`;
none remain tracked under this report directory. No raw evidence is added.

| Check | Fix-round result |
| --- | --- |
| `cargo build --locked -j 4 -p snapback4` | Pass; the Postgres script also rebuilds the final CLI |
| Core no-default-features check | Pass |
| Full default core, `--no-fail-fast` | Pass: 1,102 passes, five existing ignores; 1,909.71 seconds |
| Dual-store evolution target | Pass: 31/31, zero ignores |
| Nontransactional preparation witness | Pass: all four refused changes leave the marker untouched; identical restores advance it |
| Maintained-column scope | Pass: 9/9 (the eight prior oracles plus the committer member test) |
| Core release contract | Pass: 21/21 |
| Affected binary release lifecycle | Pass: 12 passes, one existing ignore |
| Both RT0 ratchets | Pass: every one of the 24 warm cells equals the original-round table below; no table, budget or allowance changes |
| Guide target | Pass: 127/127, including the clarified Postgres restore guidance |
| Complete public harness | Pass: 422.04 seconds, including expanded EV-1 on both stores, recovery, ownership, P1-CE and P1-MC |
| Broad binary sweep | 1,424 passes, 13 failures, 20 ignores; classification below |
| `bash scripts/test-postgres.sh` | Pass: 431 Rust passes, zero failures/ignores, plus the complete public harness; 1,708.44 seconds |
| Root `./ref-check` | Pass: 565 LLPs, 11,779 refs, zero errors/unchecked; repeated after final report/journal |

The broad binary command completes with **1,424 passes, 13 failures and 20
ignores**. Counts use the final summary for each Cargo target, excluding
nested child-test summaries already represented by their parent target.
The failures are:

- Two clock cases already recorded in the original round: expiry-drain
  `WouldBlock` and the large-report size assertion.
- Four supplied reservation fixtures: two init residency cases and two
  timeline adoption cases report `source reservations differ from the schema
  derivation`.
- The inherited `dev_worker_tests.rs` census mismatch (four sites versus
  listed zero), already fixed on main as `a044e8d606`; no allowance or fixture
  is changed in this lane.
- The supplied web witness missing-`E_INPUT` assertion.
- HTTP committer and live-dev ownership timing failures. Both pass in
  isolation without source changes (one test each).
- Three security-wave19 cases. A serial rerun passes ten of eleven tests,
  including the missing-record and private-serve-preparation cases that
  failed in the broad run. `check_refutes_excluded_contact_roles_before_any_full_test`
  still fails: check returns success with zero refuted/two unproved invariants
  instead of the expected generated counterexample. This source and the
  security implementation are unchanged; it remains an unresolved result
  outside the Postgres evolution scope, not a claimed pass.
  The [qualification follow-up](../../../issues/20261023-snapback4-security-wave19-contact-refutation-qualification.md)
  records the reproduction without claiming an application disclosure.


Final script qualification rebuilds the shipped CLI and repeats the complete
public harness. Its final EV-1 transcripts are again exactly 2,819 bytes and
have the same SHA-256 recorded above. The evaluator stress passes both modes:
65 increments each, no lost updates, 110 Serializable retries. No ignored
stress test is counted as qualification. The complete script is green.

All **four owned private PG16 clusters** are independently stopped: `pg_ctl
status = 3`, no `postmaster.pid`, and no recorded postmaster present. The final
audit checks **2,716 unique recorded PIDs**, all absent, and finds
no executable remaining from this worktree's target. Public harness logs,
wire transcripts and process evidence are copied under
`/tmp/sb4-p1ev1-fix1/public-evidence/`; the custody receipt is
`/tmp/sb4-p1ev1-fix1/final-custody.json`. Final sampled free space is
231.60 GiB; no disk guard crossed 40 GiB. PostgreSQL 17 on
55440 and other sessions' clusters were untouched. No push, stash or Git
configuration change. Whitespace and final reference validation pass.

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
