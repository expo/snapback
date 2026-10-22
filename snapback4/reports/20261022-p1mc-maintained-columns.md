# P1-MC — ordinary maintained columns on Postgres

The current implementation and qualification are recorded in **P1-MC fix round 1**
below. The original P1-MC record is retained first as implementation history.

## Finding recorded before implementation

At base `eeb79ebc7c`, ordinary transactional count/sum maintenance is already
implemented over both stores. The exclusion is stale for writes, but removing
it alone does not provide release evolution:

- `engine/postgres/profile.rs:22–23` delegates ordinary-column admission to
  the evaluator exclusion. `engine/postgres/mod.rs:544–556` admits only the
  older read-through exception, refusing ordinary private maintains.
- `engine/maintains.rs:249,284,471,579` runs deltas, rebuilds and checked
  aggregate arithmetic through `Rows`; `engine/columns.rs:70` mirrors into
  the current parent through the same port. `postgres/store.rs:588,610`
  already implements those row/index writes. No SQL aggregate is needed.
- `engine/activation.rs:106–158` already chooses changed private maintains,
  rebuilds them, then mirrors parents with `column_activation.rs:48–60`,
  behind the generation barrier. That builder runs over `AnyTx` on Postgres.
- However `engine/postgres/opening.rs:110–111` refuses every nonidentical
  schema before invoking that builder. It has no physical row projection or
  retired-private-target cleanup for adding/dropping maintained columns.
  Those attach-time adapter operations and a narrowly scoped evolution
  admission are needed; general schema evolution remains outside this lane.
- Row-keyed views remain refused: `profile.rs:22` and `mod.rs:546` require
  the separate durable background recount runner. It does not fall out of
  ordinary aggregate maintenance.
- Aggregate values have an intentional 53-bit refusal (`maintains.rs:592–596`),
  using `i128` before conversion. Rule 8 does not turn an overflowing Quarry
  aggregate into a saturated successful value; stored i64 bookkeeping must
  continue to saturate in shared policy. Both boundaries need witnesses.

Paths above are relative to `snapback4/crates/snapback4-core/src/` and refer
to the unmodified base. This section was written before changing code.

## Orientation

Scope: Postgres admission and attach; common maintained-column store oracles;
the existing public deploy/serve witness; affected guide cards and ticket.
Governing constraints: LLP 3000.009.001.000 §3.4, §9 and §9.1 (enum store,
rules 1–9); LLP 3000.007.001 §3.2 and §3.11 (private authority, mirror and
generation barrier); LLP 3000 §4 and §7 (fence, source size, append-only journal).
These 3000-series documents live outside the old foundation/current registry.
The local llp-orient link is broken (uninitialized vendor); the skill was read
from the existing assetrow checkout without cloning or modifying its files.
Open risks: reject unrelated evolution before writes, retain sparse zero images,
rebuild indexes for existing parents, and prove concurrency with actual blocking.
Doc updates: maintains/deploy/release-json, port RFC, journal and scale ticket.
Hand-off: none; the user explicitly commissions this bounded implementation.

## Implementation

1. **Admission:** `postgres/profile.rs` no longer calls the evaluator's narrow
   `refuse_maintained_columns`. Complete private derivations pass the normal
   common schema validation. Projected server schemas still refuse; row-keyed
   views still refuse `E_STORE_UNSUPPORTED: view-recount`.
2. **Adapter:** `postgres/column_evolution.rs` admits only ordinary maintained
   field additions, redefinitions and removals, and indexes using those fields.
   It compares the remaining ordinary declarations, rebuilding derived prices
   and excluding executable operation facts (including source locations which
   shift when a declaration gains lines). Unrelated table, field, rule, lifetime,
   index and other schema changes refuse. Program changes remain possible.
   Under fenced attach it projects retired fields, deletes retired private
   rows/indexes and builds changed indexes through the existing portable key
   validator. `opening.rs` includes schema changes in generation publication and
   then invokes the existing common recount/mirror builder. No aggregate SQL or
   second write interpreter is added.
3. **Store oracles:** the new `maintained_columns` tests compare complete mutation
   and query outcomes, including meters, replay, private/parent rows and ledger
   results with prefetch off/on. They cover positive/negative sums, a zero sum
   with nonzero count, null parents, selected contributions, parent moves,
   delete-to-zero, parent deletion/rebirth, program refusal after writes, overflow,
   physical rollback, nested savepoint abort and restricted member abort.
   Release cases add, redefine, drop and re-add columns over existing rows,
   compare ranked reads and all logical images, retain sparse first-addition
   zeros and verify private row/index removal. An overflowing backfill preserves
   the prior generation and release selection, and reopens successfully.
   SQLite can restore explicit zero fields from its dormant column custody on
   re-add; Postgres recomputes derived fields and leaves those zeros sparse.
   Only that physical representation differs: public outcomes are compared
   exactly, without normalizing values, meters, generations or sequences.
4. **Public witness:** the existing script now deploys the unchanged
   `experiments/scale-controls/snapback-app/snapback/schema.q` using the public
   CLI's explicit `--store-url`, seeds 24 messages through a test-only operator
   helper using an acquired lease and `Engine::seed_at`, then uses public serve,
   a native account session, W1/W3 and a public `post`. It recounts every room and
   sender from the resulting 25 source rows using read-only SQL. No managed data
   is written through SQL and no HTTP fixture door is added. The script discovers
   the already-compiled CLI test helper rather than invoking Cargo while a
   server witness is active.
5. **Docs:** the maintains, deploy, release-json and diagnostic cards, CLI help,
   port RFC §9 and its single Revised header describe the admitted slice and
   retain the general-evolution/recount exclusions. The journal is append-only.

### Adapter parity audit (RFC §9.1)

| Rule | Applied here |
|---|---|
| 1 — NUL | New projection reads canonical JSON text and decodes it in Rust, never jsonb. Keys remain typed text binds under the existing guard. Public Quarry text constraints still reject control characters; the fixture uses admitted text. Existing NUL family contracts remain in the Postgres script. |
| 2 — bounded order | Every new page uses `ORDER BY id LIMIT 256`, unique within its fixed table; managed ids have C collation. |
| 3 — explicit columns | Projection selects `id,data`; inserts name `t,ix,k,id`; no `SELECT *` or cached variable result shape. |
| 4 — terminal errors | All attach work shares the administrative transaction. Backfill error rolls projection, indexes, private totals, markers, release and generation back together; statement-error contracts remain unchanged. |
| 5 — typed arguments | Table/index names, ids, payloads and optional continuation ids bind as typed arguments. The positive bounded page size is fixed, not dialect-parsed text. |
| 6 — attach DDL | No per-operation DDL and no new relation. Existing shape validation runs before candidate row projection, under the existing ownership/head fence. |
| 7 — observable race | Both writers execute interpreter maintenance through adapter transactions on the same parent. The holder waits for `pg_blocking_pids` on the actual head fence, or a fired SQLite busy handler. This witnesses the admitted serialized path, not optimistic parallel writes. |
| 8 — boundaries | No SQL arithmetic is added. Aggregates retain shared checked i128 intermediates and the public 53-bit E_OVERFLOW rule, including negative underflow. Existing i64 bookkeeping saturation contracts remain in the family suite. Saturating a Quarry aggregate into success would change its contract and is intentionally not done. |
| 9 — locale | No locale-sensitive SQL normalization is added. The complete Postgres script is run on an en_US.utf8 cluster, including the existing structured attach-shape tests. |

### Retained evaluator and non-claims

The duplicate `PostgresEngine` stays unchanged. It still refuses ordinary columns
until S10e. Attempting to use it as the third oracle exposed its missing initial
empty-parent invalidation: the common builder starts this fixture at head 1,
while the retained evaluator starts it at head 0. This lane compares the same
common engine over SQLite and Postgres instead of normalizing that disagreement.

General row evolution/dormant population, row-keyed recounts, provider HA,
publication, the 1M-message seed and W1–W5 performance measurements are not claimed.
The small S1 public fixture qualifies the capability needed to rerun that scale
campaign; it is not a throughput result.

## Qualification

Logs are retained under `/tmp/p1mc-*.log` on this lane. The unchanged public S1
fixture passed on PostgreSQL 16.15 with en_US.utf8: 24 seeded messages, one public
post, every room/user total equal to a recount. The final complete Postgres repeat passed, including every evaluator integration
target and the public CLI witness.

| Check | Result |
|---|---|
| `cargo build -p snapback4` | Pass; repeated by the Postgres script. |
| `cargo check -p snapback4-core --no-default-features` | Pass. |
| `cargo test -p snapback4-core --no-fail-fast` | Pass: 1,068 unfiltered cases + one filtered subprocess case; five ignored. |
| `cargo test -p snapback4 --no-fail-fast` | 1,404 unfiltered passes + 13 filtered subprocess passes; 18 ignored; only `web_witness_help_and_invalid_input` failed before the client was built. Its isolated rerun passes after the fresh wasm/client build. The two other named baseline cases passed. |
| Store-port/committer ratchets and handle census | 16 pass; no allowance increases. |
| Compiled handle guards | One pass in each of default and Postgres builds. |
| Release guards | Both pass (raw test support and web-device-check refuse release profiles). |
| `cargo test -p snapback4-lang --test guide` | Final 127 pass. Each of the three initial failures also passes alone. Updated the intended refusal-definition pins, kept the maintains card at its unchanged 879-line ceiling, and built missing package artifacts. |
| Root `node scripts/check-guide.mjs` | Nonzero: 17 pass, one failure, one skip, three generated-artifact preconditions. See below. |
| Wasm codec census | 27 pass. |
| Fresh wasm/client artifacts | Pass: 2,406,499 B raw / 735,093 B gzip, below unchanged 735,407 B budget; package build passes. The standard wasm build commands use this lane's requested dev/test debug environment. |
| `scripts/test-postgres.sh` | Final exit 0 on en_US.utf8: 58 evaluator + 213 adapter + 22 ownership + one compiled guard + 37 doctest + two existing member + one maintained-member + one internal HTTP + one startup-renewal + 19 corpus cases = 355 visible Rust passes, plus the captured operator-seed helper and public CLI witness. |
| Serializable evaluator conformance alone | Pass on a new private en_US.utf8 cluster: 65 increments per mode, zero serialized retries / 88 serializable retries; no lost updates. |
| `./ref-check` | Final pass: 564 LLP docs, zero errors and zero unchecked references. |

The initial Postgres script run hit the already-tracked evaluator `40001`
exhaustion in `concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`.
It matched the failure at `tests/conformance.rs:244` in the
[existing ticket](../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md).
The isolated rerun passes unchanged. Inspection also found that Cargo's default
fail-fast behavior skipped the four later evaluator integration targets after
this red. Added `--no-fail-fast` to the existing invocation and repeated the full
script with `RUST_TEST_THREADS=1`; it exits 0. Its conformance case again retains
65 increments per mode (zero serialized retries / 92 serializable retries). The four writers inside conformance and both
writers inside each blocking witness are unchanged; product retry limits,
durability, assertions and resource budgets are unchanged.

The root Guide failure is outside Snapback 4: the diagnostics registry reports
missing removal justification for `SNAPBACK_EPHEMERAL_REAUTHORIZATION_INCOMPLETE`
and unused checked-in removal justifications. Its production roots exclude
`snapback4/`; no inputs to that registry changed here. The symbol registry lacks
`@expo/snapback-contract`; generated demo operation/Contract artifacts are absent,
so corpus/snippet/manifest checks report preconditions. Root and Snapback 4 frozen
Bun installs were performed. No old-engine bootstrap or registry rewrite was
undertaken for this fenced lane.
The initial focused iterations and witness setup errors are retained rather than
reported as passes: test assumptions about evaluator heads, sparse re-added zero
fields and race results were corrected; a Cargo build-lock timeout led to direct
invocation of the compiled test helper; invalid NUL-bearing fixture text was
replaced with valid text after Quarry correctly refused it.


## Process custody and resources

All eight owned clusters were stopped and independently checked: no
`postmaster.pid`, `pg_ctl status` = 3, and their recorded postmaster PIDs absent.
All 22 recorded public server PIDs are absent. The scripts also awaited every
failed-start CLI subprocess. No server or cluster is left running.

| Cluster directory under `/tmp/` | Postmaster PID |
|---|---:|
| `sb4-p1mc-pg.qbigXy` | 2439118 |
| `s10d3-serve-3rhbnl4t` | 2487087 |
| `s10d3-serve-a54tympc` | 2499986 |
| `sb4-pg-eval.7Q8QCe` | 2719715 |
| `s10d3-serve-19koz8fj` | 2766493 |
| `sb4-p1mc-isolated.Ypbzo4` | 2784784 |
| `sb4-pg-eval.V6YhcY` | 2785059 |
| `s10d3-serve-nj8q53u9` | 2848691 |

Only this lane's `snapback4/target` was used. Cargo jobs were capped at 10,
incremental compilation disabled and dev/test debug info set to
`line-tables-only`. Minimum observed `df -h /` free space was 168G, above the
30 GB stop threshold. No cloning, sub-agents, stash or push. The journal's old
contents remain a byte-for-byte prefix, the RFC has one Revised line beginning
P1-MC, and no ratchet allowance or resource budget was raised.

Local landing: branch `sb4-pg/p1mc`, based on `eeb79ebc7c083bf3cb1cd77f8dcfd730048e6349`.
The local commit uses author `Codex <noreply@openai.com>`, committer
`Charlie Cheever <ccheever@firewoodagent.com>` and the requested Codex co-author
footer; its identifier is provided in the final response. No push is authorized
or performed.


## P1-MC fix round 1 — 2026-10-22

Base: `45416b150c8900594ed1e65ed557d7178b2dcb07`; local branch
`sb4-pg/p1mc-f1`. One worker on the assigned host/worktree; no delegation,
cloning, remote commands, stash or push. The `llp-orient` skill was read from
`/home/ccheever/.codex/skills/llp-orient/SKILL.md`. Scope and constraints remain
LLP 3000.009.001.000 §3.4/§9/§9.1 and LLP 3000.007.001 §3.11. No new protocol,
public store method, ceiling or ratchet allowance is introduced.

1. **Unique projection groups.** The changed-index set compares the full `Index`
   (all components and uniqueness). After projection and the common rebuild,
   Postgres streams affected unique keys in 256-key pages, decodes their logical
   prefix, exempts null-containing groups and refuses duplicates with SQLite's
   `cannot activate posts.byRoom: existing group exceeds a unique key` message.
   All work remains in the fenced activation transaction before publication.
   The public Quarry/raw-schema validator already forbids maintained columns in
   unique keys (`schema/columns.rs`). The review's exact public declaration
   therefore refuses before activation on both stores. The regression first
   proves that refusal, then exercises the physical projection and SQLite's
   low-level activation directly to test the defensive invariant independently.
   It adds the maintained count over existing parents to preserve sparse zeros,
   tests the same-author/different-room collision, and includes noncolliding
   authors and distinct-null controls.
2. **Executable facts.** Full server preparation re-derives source reservations
   and receipt dependencies and rejects disagreeing supplied nonempty maps.
   For unchanged programs/declarations in the column slice, the common engine
   derives expected execution facts from the previously admitted declarations
   plus candidate schema/IR: receipt-maintenance dependency, source-reservation
   sites and the resulting prediction class. The compiler and activation share
   the receipt-maintenance refusal calculation. Author declarations such as
   `held` remain fixed for unchanged IR. Flags, prices, prediction and receipt
   graph forgeries refuse equally on SQLite and Postgres, through ordinary and
   release adoption. Both adapter attach and the common activation builder
   recheck execution facts against the persisted predecessor. The Postgres
   adapter also validates canonical graph/prices before its immutable input
   can be published, including callers below Engine preparation. The forgery
   regression exercises that direct adapter boundary.
3. **Receipt evolution.** Normalization re-derives the receipt graph after
   removing private declarations, instead of comparing the full graph with
   stripped schemas. The cross-store receipt fixture seeds conversation,
   membership and message rows, then adds a recipient sum, redefines it as a
   count and drops it, comparing rows, graph, generations and complete screen
   query outcomes. The sum makes `send` never-predicting; count restores its
   prior eligibility, as the compiler requires.
4. **Guide.** The short `E_STORE_UNSUPPORTED` registry now names the admitted
   maintained-column slice. `release-json` qualifies sparse zeros as initial
   additions and describes explicit zeros on redefinition.

Qualification and process-custody results for this round follow below; the
older qualification sections above describe the original P1-MC commit only.

The first default core pass exposed four raw-schema fixtures that edited types,
indexes or maintenance predicates after compilation while keeping old reservation
prices. Their builders now refresh derived metadata after those edits; their
behavioral assertions and heap/resource limits are unchanged. All four corrected
cases pass in the final core repeat. The first pass's remaining serial run was
stopped to restart the complete command against those corrections with eight test
threads. Its recorded shell/Cargo/test PIDs (1987453, 1990362, 2033550) were checked
and confirmed absent. That interrupted pass is not claimed as qualification.

The guide's package-reference checks also require generated client assets in a
cold tree. The frozen Bun install passes; the initial client build reports only
missing generated Wasm modules. The owned Wasm build uses the assigned target,
eight build jobs while the core's eight test threads run, and the requested
line-table dev/test settings. Its temporary copy of the standard build script
removes that script's debug=0 overrides; optimizer, bindgen, stamping and budget
checks are unchanged. A temporary lock and asset digest receipt prevent duplicate
asset generation when the sequential check script reaches that stage.

### Final qualification for fix round 1

All requested checks pass on the final semantic change. Logs and process records
are under `/tmp/p1mc-f1-evidence/` on this host.

| Check | Final result |
|---|---|
| `cargo build -p snapback4` | Pass; repeated after the full Postgres script. |
| `cargo check -p snapback4-core --no-default-features` | Pass; final repeat passes. |
| `cargo test -p snapback4-core --no-fail-fast` | Pass: 1,069 visible passes (including the filtered subprocess), five ignored; final run uses eight test threads. |
| Postgres maintained-column scope, `--include-ignored` | Nine passes across the adapter and maintained-member stages, including all three new cross-store regressions and six forged-fact variants. |
| `cargo test -p snapback4-lang --test guide` | Pass: 127 tests. |
| `bash scripts/test-postgres.sh` | Exit 0: 358 visible Rust passes (58 evaluator, 216 adapter, 22 ownership, one compiled guard, 37 doctests, three member, two HTTP/startup, 19 corpus), plus the captured operator seed and public CLI witness. |
| Public S1 maintained-column witness | Pass on private PostgreSQL 16/en_US.utf8: unchanged Quarry deploy, 24 seeded messages plus one public post, every room/user total equal to its source recount. |
| Fresh Wasm/client prerequisites | Pass: 2,406,499 B raw / 735,096 B gzip, below unchanged 735,407 B budget; normal package build passes. |
| `./ref-check` from repository root | Pass: 564 LLP documents, zero errors, zero unchecked references. The first wrapper invocation ran from `snapback4/`, found no `llp/` corpus and was corrected. |

The evaluator's concurrent-writer case passes unchanged: 65 increments in each
mode, no lost updates, zero serialized retries and 70 serializable retries. No
retry limit, assertion, workload or resource ceiling changed. The receipt spec's
§14.3 now records native price validation while preserving its existing trust
contract for newly authored raw-IR descriptor/program pairs.

### Process custody for fix round 1

Every owned cluster was stopped and independently rechecked with `pg_ctl status`
(exit 3), no `postmaster.pid`, and its recorded postmaster PID absent. All six
recorded public server PIDs and all recorded check/restart runners are absent.
**Owned PIDs left: none.** Detailed records: `cleanup-confirmation.json` in the
local evidence directory.

| Cluster directory | Postmaster PID (absent) |
|---|---:|
| `/tmp/s10d3-serve-cg3veed8` | 2512698 |
| `/tmp/sb4-p1mc-f1-pg.IycB9w` | 1972835 |
| `/tmp/sb4-p1mc-f1-pg.J3vwIj` | 1954374 |
| `/tmp/sb4-p1mc-f1-pg.SByPSj` | 1959257 |
| `/tmp/sb4-p1mc-f1-pg.ZPMkEA` | 1972454 |
| `/tmp/sb4-p1mc-f1-pg.eKNlN7` | 1984179 |
| `/tmp/sb4-p1mc-f1-pg.nzTmPk` | 1977590 |
| `/tmp/sb4-p1mc-f1-pg.y4UalA` | 1953254 |
| `/tmp/sb4-pg-eval.LnxrwR` | 2420907 |

Public server PIDs (all absent): 2523893, 2523963, 2524556, 2525454, 2525768, 2532624.

Only the assigned `snapback4/target` was used. Incremental compilation stayed off;
dev/test debug settings stayed `line-tables-only`; builds used at most 16 jobs.
The asset build used eight jobs alongside the core's eight test threads. Minimum
observed `df -h /` free space was 64G, above the 30 GB stop threshold. No cloning,
remote commands, sub-agents, stash, push, publication or budget increase.

Local delivery is one fix commit on `sb4-pg/p1mc-f1`, parent
`45416b150c8900594ed1e65ed557d7178b2dcb07`, with the requested Codex author and
co-author footer. Its hash is supplied in the final response.
