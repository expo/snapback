# UA round 4 — integrate main without dropping asset, arm or read-only custody

Date: 2026-10-07. Lane parent: `9ab49c9de8323795756e1c4f3a16aab1faa3843e`.
Main parent, fetched before merging: `b14888f7632bf5fe60b61a640dd23e732797974e`.
Branch: `sb4-intent/ua-useasset-native`, on eb1000 (`expose-builder-pixel`).
This is a merge, not a rebase. Both supplied round-3 reviews are READY.
No other worktree/process or machine was used, no simulator was run, and
nothing is pushed. The operator's iOS Release recheck remains pending.

## Governing context

Read the OA landing message and its round-1 report, plus LLP 3000.033 §§1.3–1.4
and §1.8. UA's asset lifecycle remains governed by LLP 3000.008.002.000 §6.
An arm's originating credential fence must survive queues, refresh/authority
waits and retries, with the final check immediately before dispatch. An already
dispatched call keeps its outcome. Read-only scope verification precedes reads;
assetSource exports no URI/bearer before verification; read sessions keep fixed
lifetimes with no SDK refresh. No new design or contract decision is introduced.

## Conflict resolutions

1. **client.ts:** keep both imports. Keep UA's assetReader wrapper, named
   refresh progress, downloader observer and readAsset recursion through the
   same observer. Run main's readGate.verify() first inside that wrapper;
   preserve main's verified-only assetSource gate. Everything outside the
   asset method and its import is byte-for-byte main. OA's post/sendPost arm
   propagation, retry checks and private RequestInit binding are untouched,
   as are the read-only guards and disabled write machinery.
2. **JOURNAL.md:** concatenate both append-only histories, then append this
   round's record. Both complete parent journals remain exact line subsequences.
3. **Open issue, modify/delete:** insert main's "P3 Round 2 evidence
   clarification" verbatim in the closed issue, before the resolution history.
   Keep the open path deleted. It records that the old logs were not a complete
   HTTP trace and cannot prove no fetch occurred; the independent UA reproduction
   and its qualification limits remain distinct.
4. **delivery-await-boundary.json:** retain the union of main and UA's seals,
   then recompute the combined client's seal. client.ts stays at 62 awaits;
   only its hash differs from the auto-merged records. No new delivery I/O.
5. **delivery-fault-instrument.mjs:** retain both sets of rationale and append
   the merge disposition. Scope, fault sites, classifications and recipes stay
   unchanged.

The guide, code lookup, client reference, app-client.ts, local.ts and react.tsx
merged automatically. Review of their deltas against main shows UA's existing
asset observer/hook changes alongside main's read-only and owned-arm changes.
The named custody modules (app.ts, app-online-arm.ts, online-arm-fence.ts,
ephemeral.ts, observe-watch.ts, read-only.ts and read-token.ts) equal main.
UA's asset-download.ts, asset-progress.ts and assets.ts equal the READY lane.
See [source comparisons](source-merge-proof.json) and the
[combined await seal](await-census.log).

## Additional audit correction

The root reference audit found main's existing difftest @ref used a long
fragment the checker did not recognize. Both that source and its LLP were
identical to main before correction. Replaced the comment's fragment with the
stable section number `LLP 3000.035#5.1`. No executable code or test changes.
The initial audit is retained in [ref-check-before.log](ref-check-before.log).

## Verification

The separately completed requested Node run passed **24/24 files, 884 tests,
zero failures and one labelled skip**. The skip is the read-only downgrade
control requiring SNAPBACK4_PREVIOUS_PUBLISHED_BIN; no new publication or
persisted-format change is claimed. This run includes all asset files,
React, delivery-fault, read-types, app-online-arm, every read-only client file
(including rounds 4, 5 and 7), client lifecycle/seams, social-starter and
readme examples. [Requested-suite log](requested-tests.log.gz), [per-file results](requested-results.json).


The complete canonical suite ran because integration touches the shared
client. It completed in **2,131 seconds**, with the two failures and passing reruns below. It includes every requested asset/Blob/buffered/avatar/React/delivery/
read-types, owned-arm, read-only (including round 4), client and starter file,
plus guide and typechecks. The complete [full-suite log](full-suite.log.gz) retains both failures.

Command, from snapback4/:

```sh
TMPDIR="$PWD/target/ua-round4" \
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT \
CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 \
CARGO_INCREMENTAL=0 bash scripts/test.sh
```

Rebuilt wasm matches the pre-merge artifact and OA's reported artifact:
2,135,164 bytes raw / 645,264 bytes gzip; unchanged budget 645,564.
SHA-256: `a4c6b4a8a7e76d81df9f424899f474863ce23cf232c0e4162861cc1333a3ec83`.
No UA changes to engine/device/wasm build inputs are added over main.

### Full-suite witness cleanup failure

The full Rust phase ran 311 test binaries / 1,024 scheduled executions plus
workspace doctests. One CLI unit case failed:
`verbs::witness::preparation::cleanup_tests::shrinking_group_extends_cleanup_until_supervisor_exits`.
Its cleanup returned `E_WITNESS_PROCESS: invalid /proc process group` at
preparation.rs:182. The CLI unit target reported 326 passes, one failure and
four ignores. All other Rust executions, including the 113 guide tests, passed.
This is the same cleanup error class recorded by OA round 1, in a different
case; it is not attributed to UA. Witness preparation/cleanup source equals
main. The complete preparation module rerun with the canonical single test
thread passes **23/23**: [rerun](witness-preparation-rerun.log.gz). No witness code, timeout, assertion
or suite count was changed. The original full-suite failure is retained and
will not be described as a single-green-run qualification.

### Full-suite scratch-location correction

The client pool found one test-setup failure in identity-organizations: its
allow-outside-Git scratch-parent control was allocated under this run's
worktree-local TMPDIR, so its own guard correctly rejected that location.
Reran the complete unchanged file with a newly created private /tmp directory,
outside all Git repositories, then removed that owned directory. It passes
three active checks with the expected managed-provider integration skip:
[rerun](identity-organizations-rerun.log). No test or product code was altered.
This explains the full-run failure; it does not erase it. Use an owned TMPDIR
outside Git for a future full run (the scoped asset suites accept either).

The full client pool completed **339/339 files: 6,670 passed, one failure,
55 labelled skips**, with only the scratch-location failure above. The
canonical run kept 24 file slots on this 96-CPU host. The requested-scope
run independently passes all its active checks; no timeout, history count,
assertion or budget was reduced. **Both final model files pass all 79 checks**, with 5,000 session histories per tier and 3,000 online sequences.

## Final disposition

The integrated asset, owned-arm and read-only behavior passes every requested
active check. The full canonical run completed, but is **not a single-green-run
receipt**: one unchanged witness cleanup case failed transiently, and this
run's TMPDIR caused one scratch-control failure. Their complete scoped reruns
pass without product/test changes, as detailed above. No failed UA, OA or
read-only check remains.

| Check | Result |
| --- | --- |
| Asset/Blob/buffered/avatar/list/pressure/React/read-types | 250 passed |
| Delivery-fault matrix and await census | 339 passed |
| Owned online arm | 32 passed |
| Read-only client files, including round 4 | 118 passed, 1 labelled published-binary skip |
| Client lifecycle/seams | 122 passed |
| Social starter and README examples | 23 passed |
| Guide | 113 passed |
| Full client pool | 339 files; 6,670 passed, 1 scratch-location failure, 55 labelled skips |
| Full seeded models | 79 passed, no skips |
| Full Rust inventory | 311 binaries / 1,024 executions plus doctests; one witness cleanup failure |
| Witness preparation rerun | 23 passed |
| Scratch-control file rerun outside Git | 3 passed, 1 labelled managed-provider skip |
| Client and starter typechecks, package/CLI/wasm builds, release guard, docs budget | Passed in full suite |
| Root reference audit | Passed after the comment-only main anchor correction |
| Operator fixture syntax | Passed; no iOS execution |

[Integration record](integration.json) contains parent IDs, counts and matching
wasm hashes before merge, after build and after the full suite. The
[source comparison](source-merge-proof.json) records the preserved code from
both parents. [Reference audit](ref-check.log), [fixture syntax](fixture-syntax.log).

The current [operator steps](../REPORT.md#repeating-the-fixture--operators-round-4-recheck)
rebuild this integrated SDK with stock Expo/RN, and fixture traces identify
round 4. The operator's new iOS Release image-load evidence remains pending.
Nothing was pushed or published.
