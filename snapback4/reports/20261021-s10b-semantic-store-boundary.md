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
