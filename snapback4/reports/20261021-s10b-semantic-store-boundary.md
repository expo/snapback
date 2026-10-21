# S10b — finish the semantic store boundary

2026-10-21. Branch `sb4-pg/s10b`, base `1250ea3b3d`, worktree
`/home/ccheever/projects/sb4-s10a` on expo-build-450a. One agent, no
sub-agents, stash, push, git configuration changes or additional worktrees.
All Cargo work uses this lane's `snapback4/target`, ten build jobs,
`CARGO_INCREMENTAL=0` and line-tables-only dev/test debug information.

Governing scope: [LLP 3000.009.001.000 §3.4](../../llp/3000.009.001.000-the-postgres-store-port.rfc.md#34-one-engine-over-both-stores),
revision 2, plus the S10a report and both supplied reviews. The base already
has P1-MR's absent-evidence correction; S10b retains it without another
semantic change. No Postgres enum arm or new admission/serving claim is added.

## Bridge disposition

| S10a bridge | S10b disposition |
| --- | --- |
| `AnyStore` `Deref`/`DerefMut`, `AnyTx`, `ReadSnapshot`, `AnyInspection` `Deref` | All five implementations removed. Every reached operation is explicit dispatch or a typed family. |
| `WriteStore` and its two implementations | Removed. The committer opens `AnyStore` directly; adapter-owned reset/witness producers hand over the same existing owning `AnyTx`. Their opener, member and physical commit order is unchanged. |
| Concrete SQLite `CommitTransaction` forwarding | Removed. The solo committer consumes the owning enum; its implementation remains the final physical commit operation. |
| Shared job/request convenience bridges | Replaced by explicit scoped operations on `AnyStore`, retaining SQLite's shared receiver and snapshot boundaries. The `RequestsStore for &AnyStore` implementation is removed. |
| Activation/preparation bridge | Permanent per-arm activation dispatch and existing preparation families. Redundant release-check convenience removed; release policy calls the preparation capability directly. SQLite-only helpers borrow the concrete transaction inside the adapter; engine callbacks receive `AnyTx`. |
| Seed, restoration, release-event and legacy-reference bridges | Seed preparation and legacy rewriting dispatch on `AnyTx`. Restoration and release events use the landed release-history family. No free-function adapter policy is exported to the engine. |
| Step adapter views | Final scoped `StepTransaction` facades, as §3.4 assigns. Their fields are private and only `AnyTx` constructs them. Each method selects its adapter internally; they expose no owning or physical handle. |
| Adapter record/helper re-exports | Advice records/presentation, `Sizes` and `LogEvent` now live in the neutral port; receipt helpers come directly from shared receipt policy. Concrete SQLite retains its existing public record spellings for devices/fixtures. |
| Hidden inherent calls | Ledger writes/reads have `LedgerTransaction`/`LedgerReader`; receipt writes extend the receipt family. Following history has a read capability implemented by owner and snapshot. Placement lookup has narrow `AssetPlacementReader`. Transaction control, time publication, asset lifecycle, opening, reader creation, ownership, backup and inspection are explicit port operations. Simulator receipt counts, evaluation row inventories and snapshot log reads also dispatch explicitly. |
| `serve_changes` snapshot chain | Explicit snapshot identity, ledger and change-evidence operations replace the implicit chain. Metadata, activation, receipts and evidence forward through the owned transaction without a borrow getter. |

Temporary bridge census: **5 owning dereference implementations → 0**;
**0 temporary bridges retained**, with no allowance or raise switch.
`From<sqlite::Store>` remains the final one-way ownership constructor for
existing SQLite fixtures, as the RFC requires. Scoped authority callbacks,
typed backup/ownership and step owner views remain final semantic interfaces;
they do not expose backend types through the owning handles.

`ChangeEvidence` access now returns `Result<Option<()>, RuntimeError>`.
Existing SQLite/Postgres evidence algorithms retain their SQL and ordering;
shared certification maps unavailable-family errors and missing/pruned/unknown
facts to unknown. Empty intervals and known evidence keep their prior meaning.
Operator worker-report lists also have a fallible port boundary. Physical
fixture probes explicitly select SQLite at the witness site or in a test-local
helper; no debug raw access is added to the neutral handles or the restricted
member facade.

The compiled owning-handle negative checks cover all four owning handles and
the preparation facade; the source census follows aliases of handles and
dereference traits. Existing member
privacy, arbitrary-getter and physical-control negatives remain in force.
New neutral-handle tests distinguish known empty evidence from unknown/missing
evidence and exercise an unavailable-family refusal.

## Qualification

Building commits so far: `15bf3b8bf1` (semantic boundary, 1,283 changed lines)
and `0ad24c906a` (core/host physical fixtures, 1,099 changed lines).
The remaining cross-crate fixtures, census and qualification record form the
final commit containing this report.

Confirmed checks:

Local transcripts are under `/tmp/s10b-checks`: the completed core and host
runs are `core3.log` and `host4.log`; the full device run is `device6.log`.
The isolated host logs, final repaired build/ratchet logs, both Postgres script
logs, isolated/remaining-target logs and independent cluster-stop receipts are
retained there as well.

| Check | Result |
| --- | --- |
| Binary build | Pass, including final semantic operations |
| Core no-default-features | Pass |
| Device web/wasm no-default-features | Pass |
| Full core suite | **1,040 passed / 0 failed / 5 ignored** |
| All workspace Rust test targets (`cargo check --workspace --tests --keep-going`) | Pass |
| Guide `every_emitted_code_is_explained` | **1 passed** |
| Wasm codec census | **27 passed** |
| Ratchets/census | **15 passed**, including the final rerun |
| Full host suite | **1,403 passed / 2 failed / 15 ignored**; isolated reruns described below |
| Full device tests | **1,573 passed / 0 failed / 4 ignored**; doctest repair described below |
| Postgres script, normal and serialized-test-function runs | **Nonzero** on the retained evaluator's existing serialization flake; **188 family + 19 corpus passed** |
| Other experiment targets + isolated concurrency case | **40 + 1 passed**; the other 17 conformance tests passed in each full run |
| Root ref-check | **Pass: 0 errors / 0 unchecked references** |

The two host failures were `advance_drains_expiry_across_multiple_bounded_sweeps`
(TCP read timeout reported as `WouldBlock`) and
`live_dev_forwards_run_refuses_other_offline_writers_with_its_address_and_releases_on_exit`
(the existing five-second assertion). Both passed alone: the clock case in
28.07 seconds and the admission case in 4.67 seconds after the cache repair
below. All three supplied host baseline cases passed in the full run. No
timing bound changed.

The Postgres failure is already tracked by
[the open serializable-exhaustion issue](../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md).
The exact four-writer case passed alone (65 increments per mode, no lost
updates, 130 aggregate serializable retries), but returned `40001` in both
full script runs, including `RUST_TEST_THREADS=1`. The retained evaluator's
retry implementation and conformance scenario are unchanged from the base.
No retry policy was altered to make this qualification green. Cargo's
experiment-target fail-fast left four binaries unexecuted; those were run
explicitly afterward, with **40/40** passing. Every other experiment test
passed, and the failing case passed in isolation. The full script remains
nonzero and is not presented as a green run.

Both script-owned clusters (`o3kYNb`, `Sc62TO`) and the separate isolated and
remaining-target clusters (`imP1D4`, `COWSJw`) were stopped by their launchers.
Independent checks again returned status **3**, with no `postmaster.pid`,
for each exact owned data directory. No existing cluster was stopped.

The two Cargo workspaces share the required lane target. Switching from the
standalone evaluator to main reproduced S10a's duplicate-crate metadata
conflict (`serde_core`/`serde_json`/core instances). The main isolated test and
final ratchets initially could not compile. Only generated `.rlib`/`.rmeta`
artifacts for this lane's three shared libraries were removed for a sequential
main-workspace rebuild; test executables, source, locks and third-party
dependencies were preserved. The binary rebuild and isolated admission rerun
passed, followed by all 15 final ratchet/census tests. The running device
suite later reached doctests and still referenced one removed library hash.
All 1,573 runtime tests had passed, but the full command exited nonzero at
that documentation compilation step. The separate device doctest rebuild and
rerun passed (zero documentation examples), with no source or assertion change.

Final census: **0 concrete tokens/declarations in 0 engine/host files**;
**0 owning dereference bridges**; raw-access ratchet **0 production sites /
95 fixture sites in 13 files**; committer ratchet **49 sites in 11 files**.
The member facade remains closed, with no arbitrary getter or physical-control
capability added.

Root reference validation and whitespace checks pass. `/home` has 188 GB free
at completion; the 20 GB stop threshold was never reached. The final commit
uses the requested author, committer and co-author metadata. No push or stash.

No semantic decision outside the RFC was required.

## Fix round 1 — 2026-10-21

Rebased first with `git fetch -q origin sb4-pg/main-mirror` and
`git rebase FETCH_HEAD`, onto `f72f6c5c92`. The sole conflict was the journal
append; both histories were retained. The RFC retains one Revised line,
now headed `S10b fix round 1`. Main's activation recheck is byte-identical
in `engine/postgres/release.rs`; its measurement commits remain ancestors.
The three prior lane commits rebased as follows:

| Original | Rebased |
| --- | --- |
| `15bf3b8bf1` | `3aa5d86aa0` |
| `0ad24c906a` | `217441b829` |
| `bb7e8f1db1` | `a5cf658c87` |

1. **Asset location and remaining bridges (Grok Major).** Removed the three
   infallible path/directory/ephemeral methods from `AnyStore`. The fallible
   `asset_location` returns the admitted SQLite directory and its cleanup
   policy; a store without blob storage can return the typed `assets`
   unsupported-family error. Upload staging checks before minting/staging,
   delivery before time advancement, sweep before ledger staging, and reset
   before its reset transaction. Reset captures the directory for its
   post-commit cleanup. Existing concrete SQLite methods remain intact.
   The new SQLite location regression checks exact path/cleanup parity and
   that location resolution creates no directory. Existing upload, delivery,
   reset, sweep and detached-custody tests use the admitted location.
   RFC §3.4 records S10c returns and safety for busy timeout, database path,
   ownership, backup and every inspection error surface.
2. **Actual non-test trait implementations (Sol P2).** Added the integration
   test `store_handle_traits.rs`, using dependency-free trait-overlap checks
   against the library built without `cfg(test)`. It rejects `Deref`,
   `DerefMut` and `AsRef`/`AsMut`/`Borrow`/`BorrowMut` of the SQLite store,
   transaction, inspection and raw driver types for all four public owning
   handles. Private preparation/member unit checks and the fast lexical
   census remain. Three temporary mutation probes each generated a legal
   implementation by macro under `cfg(not(test))`: `Deref`, `AsRef` and
   `Borrow` through an associated-type alias. Each failed in the integration
   assertion with E0283. Every probe was removed afterward; the normal
   integration target builds. Probe transcripts are `/tmp/s10b-r1-probe-*.log`.
3. **Cheap inherited census gaps (Sol P3).** Alias propagation now includes
   associated-type assignments. Member checks follow signature aliases across
   scanned files and inspect arguments, callback bounds and where clauses as
   well as returns. The driver matcher follows file-local `use` and
   `extern crate` renames, including chained renames. Regression probes cover
   the supplied bypasses. The census headers and RFC explicitly retain the
   limits of unexpanded member macros, cross-file raw-driver aliases,
   procedural/cross-crate expansion and arbitrary type inference.

The lexical checks pass: **0 concrete handles, 0 owning dereferences,
0 production raw-access sites**; fixture raw access remains **95 sites in
13 files**. The wasm codec census passes **27/27**. Initial root ref-check
passes with **0 errors / 0 unchecked references**. Full qualification for
this fix round is recorded below; earlier qualification above is historical.

### Fix-round qualification

All commands for this round completed successfully. Cargo commands used
`--locked`, this lane's own `snapback4/target`, and ten build jobs. The earlier
profile note describes the original qualification: this fix round used Cargo's
default debug/incremental profile settings.

| Check | Fix-round result |
| --- | --- |
| `cargo build -p snapback4` | Pass |
| Core without default features | Pass |
| Device web/wasm without default features | Pass |
| Full core suite, including doctests | **1,042 passed / 0 failed / 5 ignored** |
| Full host suite | **1,406 passed / 0 failed / 15 ignored** |
| Full device suite, including doctests | **1,573 passed / 0 failed / 4 ignored** |
| Explicit committer/store-port ratchets and handle census | **16 passed** |
| Complete language guide test target | **127 passed** |
| Wasm codec census | **27 passed** |
| Affected simulator security/review fixtures | **44 passed** |
| Affected language security histories | **28 passed** |
| Complete Postgres script | **58 experiment + 190 family + 19 corpus passed**, exit 0 |

Counts include test executions reported by subprocess witnesses. All three
supplied host baseline cases passed in the full run. No unexpected failure
needed an isolated rerun. The known Postgres four-writer case also passed
in the full script: 65 increments per mode, no lost updates, and 106 aggregate
serializable retries. No retry policy, workload, assertion or timeout changed.
Existing named corpus exclusions remain unchanged.

The only owned Postgres cluster was `/tmp/sb4-pg-eval.IK9iWs`. The script
stopped it, and an independent `pg_ctl status` returned **3**, with no
`postmaster.pid`. Its data is retained for inspection. The full script log
and independent stop receipt are `/tmp/s10b-r1-checks/postgres.log` and
`postgres-result.json`; the main command transcripts and exit statuses are
in the same directory. Initial codec and mutation-probe logs are under
`/tmp/s10b-r1-*.log`.

The standalone device command uses a different dependency feature graph from
the combined host/device warm-up. To keep disk headroom, only completed or
superseded test executables named in this round's logs were reclaimed from
this lane's target. Current device binaries and all `.rlib`/`.rmeta` files
were retained; cleanup receipts are in the transcript directory. No library
metadata repair was needed, and all full commands, including doctests, passed.
The final filesystem has about 52 GB free.

Final census: **0 concrete handles, 0 owning dereferences, 0 production raw
sites**; raw fixture access remains **95 sites in 13 files** and the committer
opener census remains **49 sites in 11 files**. The journal union and this
round's journal updates are append-only. Root reference validation and
whitespace validation are rerun after this qualification record is written.
The fix is committed locally with the requested identities and co-author
trailer; no push or stash, and no reviewer-worktree changes.

Final root `./ref-check` passes: **564 LLP documents, 11,645 references,
0 errors / 0 unchecked**. Diff whitespace validation passes.
