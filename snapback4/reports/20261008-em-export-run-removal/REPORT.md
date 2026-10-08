# EM round 11 — coordinate failed-export directory removal

Main is merged and the run-removal race is fixed. Maintenance could create
`run.lock` and `export.lock` after a failed wrapper had unlinked the files it
found, but before its final `rmdir`. Both the observer and the shell-repair
worker reproduce real `ENOTEMPTY` under deterministic barriers. Neither can
write into that deletion window after this change. Production priority, queue
semantics, evidence policy and the 90-second drain check remain unchanged.

All work ran in this worktree on eb1000. No other worktree, machine or lane's
process was changed. Nothing was pushed or published. The two original
maintenance tickets remain open for the operator's next macOS soak.

## Merge and governing context

`git fetch origin && git merge origin/main` integrated main **376fb2912e** into
round-10 **b9088428d0**. Merge commit **b7de0a0e8c** lists these resolutions:

- `export-background.test.mjs`: retain FL's `checkedSpawnSync`, checked 128 MiB
  `ps -axww` listing, async identity-bound signals, custody waits and Darwin
  bindings. Retain EM's wakeup/custody regressions and bounded private evidence
  collector around the unchanged drain predicate. The collector satisfies both
  lanes' timeout-evidence intent without restoring a whole-log read or full
  command-line dump. Await FL's asynchronous signal dispatch in EM's added test.
- LLP 3000.030: retain every EM revision and FS's isolation/preparation-receipt
  additions, with the shared NZ revision once.
- JOURNAL: concatenate the conflicting append-only sections. Every line from
  each parent's journal remains an ordered subsequence of the merge result.

[Preservation checks](merge-preservation.json) bind those claims. FS's
`test_process.rs`, preparation completion timestamp/receipt code and smoke
isolation remain byte-identical to main. Publication's bounded five-second
export-custody retry coexists with FS's isolated publication tests. Recovery's
last-close tests and their fork-held controls remain intact; this round only
changes stale directory handling in the product worker. FS separately closed
the earlier parallel recovery fixture lease ticket.

The `llp-orient` context is LLP 3000.030 §15 (custody, private publication,
maintenance and retention), LLP 3000's publication-suite contention rules, and
Snapback 4's own workspace/append-only JOURNAL contract. The two LLPs are in
`llp/current/`; the Snapback-1 foundation does not supply this workspace's gates.
Keep real lease acquisition, birth-bound process ownership, pending/current
pins, five full plus twenty compressed evidence sets, bounded deferral and
original export outcomes. The open question is the exact Mac writer PID, not
whether these two write/delete orderings exist. §15 and the ticket addenda are
updated with the code. No new LLP or user setting; skill hand-off: none.

`bun install --frozen-lockfile` passed, the SDK dependency script printed
`deps-ok`, and both the native CLI and SDK rebuilt successfully.

## Incident evidence and causal limits

The operator reports round-10's six Mac runs at 100/100 except run 4 at 99/100;
the repaired publication crash-matrix custody case passed all six. Run 4's
marker-failure case returned status 1, but cleanup replaced its injected error
with `ENOTEMPTY` for unpublished run `1791438428822-6360`.

[Archive inventory and excerpt](mac-evidence.json) record the supplied archive's
SHA-256 and [complete original log](mac-background-4.log.gz). The log names
`snapshot-1791438431261409000-28064713-cleanup-cleanup`, but that snapshot is
**absent** from the archive. Only four later cleanup snapshots remain. Thus the
archive cannot identify which PID wrote the file, or choose between the two
writers proven below. It would be unsupported to label an unrelated later
snapshot as this failure's evidence.

The failed attempt has no completed publication or result and is excluded from
compression history. Its live wrapper initially holds `export.lock`. However,
recursive deletion unlinks the lease pathname as well as `live.json`; the open
leased inode alone does not protect its old pathname. The observer's
`ready_run` used `create(true)` for both locks. The ownerless repair path could
also see the now-missing journal, acquire initialization custody (which the
wrapper had released before Expo), then create both lock files. The final
`rmdir` fails if either writer arrives after its enumeration. A stale worker
could even recreate the parent directory after deletion through `lease()`'s
`create_dir_all`. These are concrete maintenance writers, without a compressor.

## Product repair and forced orderings

Readiness opens existing lock files without `O_CREAT`. Missing lock paths have
no owner to wait on; broken symlinks and other I/O failures still refuse. These
are advisory probes; the worker still acquires authoritative leases before work.

Before publication has been attempted, the wrapper deletes bulk output while
retaining `run.lock`, `export.lock`, `live.json` and its existing export lease.
It then takes the existing initialization lease for the final shell removal.
Bulk deletion does not hold that project-wide lock. Failed export-lease
acquisition already holds initialization custody and uses it for cleanup.
If initialization cannot be acquired within its existing five-second bound,
the shell is preserved, the export refuses and a later inventory backstop can
repair it; no unlocked fallback deletion is attempted. A worker rechecks the
candidate's existence under initialization custody before creating run/export
leases. A vanished discovery is already covered and is not recreated.

There is no new blocking reverse lock edge: shell repair's acquisition remains
nonblocking, including when the wrapper holds the export lease while acquiring
initialization. Namespace recovery for publication-attempted trees is unchanged.
No result becomes success by ignoring a deletion error, and failed attempts
still occupy no evidence keep slot.

Three portable regressions use the existing debug-only barrier mechanism:

1. Pause an observer after directory discovery. The real wrapper fails its
   marker, unlinks the enumerated contents, and pauses before `rmdir`. Resume
   the real observer's probes, then let the wrapper call the actual `rmdir`.
2. Pause that same removal window and start a supervised repair worker. Observe
   either its completed deferral or its acquisition of the directory's leases.
   Fixed code defers under initialization custody and the directory stays empty.
3. Pause a worker after discovering an ownerless shell. Remove it under a real
   initialization lease, then resume. It must skip the vanished directory;
   the test observes the path before a faulty worker could delete it again.

The Node interposer only widens an actual unlink-to-`rmdir` interval. It does
not manufacture `ENOTEMPTY` or return fake filesystem errors. Fixed assertions
require the original injected marker error, no publication, no surviving
failed run and the unchanged queue drain. Unexpected overlapping-export
assertions now capture evidence in the bounded failure ring before cleanup.

[controls.py](controls.py) restores the old creating probes, absent worker
existence check and unguarded final removal, retaining the barriers. It builds
a separate pinned negative CLI, runs all three regressions, then restores
source in `finally` and rebuilds/pins the fixed CLI. The [control log](negative-controls.log.gz)
shows **two actual `ENOTEMPTY` failures**, each with new `export.lock` and
`run.lock` entries, and **one recreated-directory failure**. The expected exit
is 1 (three failing tests). The mutation diff and build/command receipts are
retained. An initial version observed worker stdout instead of its private
stderr and missed transient recreation; its log is retained. The final test
observes the directory while the faulty worker still holds it.

## Linux verification

The fixed dev CLI used by the JS campaigns has SHA-256
`c970535a492bd9616e7a287ba3e7e4860c4028f9dccfba51ef2942722eeadbc3`.
Cargo's integration-test build produced a separate CLI executable; that CLI
and the native unit binary used by the 79/79 recheck are retained together in
[native-binaries.json](native-binaries.json). Both builds use the same restored
product source. Source and binary receipts accompany the logs. Test helpers bind fixture
signals to that actual binary. Snapshots are archived with private file modes
and retain the original capture/rotation bounds (28 snapshots, 795 private
files, verified before archiving).

| Check | Result |
| --- | --- |
| Full export-background file | **70 passed, 34 Darwin skips**; 104 cases |
| Separate crash matrix, including expired-dispatch control | **30 passed** |
| Wakeup / sleep / deadline / publication ordering | **22 passed** |
| Bounded diagnostics / FIFO / stale-PID controls | **6 passed** |
| Export publication / failure / native / native-round2 | **6 / 2 / 9 / 3 passed**, one native Darwin skip |
| FL signals / processes / command-group / file-runner | **16 / 53 / 7 / 42 passed** |
| FS worker / supervised-worker files | **77 / 5 passed** |
| Witness / witness acquisition | **8 / 43 passed** |
| Preparation JS file, corrected runner environment | **15 passed** |
| All native witness units, including retention, recovery, publication and FS isolation | **79 passed** on recheck; first run 78/79 as below |
| Native witness integration | **32 passed** |
| Release cargo check | Passed |
| `../ref-check --root .. --verbose` | Passed; zero errors, zero unchecked |

The shared three-file-concurrency run executed all 16 affected JS files:
383 passed, 35 skipped and one setup failure. My evidence runner initially
passed its private `077` umask to tests; preparation's successful receipt was
`0400` rather than its asserted `0444`. The runner now creates private logs
while preserving the inherited test umask (`002` here). The unchanged preparation
file passes 15/15 on recheck. No product or test assertion was changed for it;
the original aggregate log remains retained and is not relabelled as a pass.

The first four-thread native witness run passed 78/79 and hit the known
`E_WITNESS_PROCESS: invalid /proc process group` in
`preparation::cleanup_tests::shrinking_group_extends_cleanup_until_supervisor_exits`.
An isolated recheck and a complete same-source four-thread recheck pass (1/1
and 79/79). The original failure is appended to the existing
[process-inspection ticket](../../../issues/20261004-snapback4-native-witness-proc-group-inspection.md).
Its parser and preparation fixture are unchanged; no raw refused stat bytes
were captured, so this work makes no new claim about that separate cause.

[repeat.py](repeat.py) ran all **three new regressions 30 times each**, with
four owned busy loops and the tests confined by `taskset` to CPUs 94–95.
All **90 cases pass**. Per-run durations were 3.838–4.605 seconds (median 4.166).
Every load child was terminated and reaped. No other lane's process was touched.
The original 90-second drain bound applies throughout; no stress-specific
allowance was introduced. [Per-run receipts](repeat.json) and all 30 raw logs
are retained. The complete background run took 401 seconds and the separate
matrix 152 seconds. Reports retain failed runs as well as rechecks.

## Operator macOS soak

From this revision's `snapback4/`, with Node 24 and a normal-priority shell:

```sh
bun install --frozen-lockfile
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=4 cargo build -p snapback4
python3 reports/20261008-em-export-maintenance-priority/mac-soak.py --out "$PWD/target/em-r11-mac" --runs 6
```

Use a fresh output directory. Expected preflight: policy **2/2**, wakeup
**22/22**, diagnostics **5 passed / 1 skipped**, followed by **104/104** per
background run (100 from round 10, one merged FL listing case, three removal
regressions). The existing script pins the CLI and retains each run's logs and
snapshots. No Mac execution or closure of the maintenance tickets is claimed
here. The absent historical snapshot limits attribution to the two proven
writers; the operator's soak must confirm this repair on Darwin.
