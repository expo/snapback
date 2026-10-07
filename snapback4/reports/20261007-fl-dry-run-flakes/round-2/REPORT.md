# FL round 2 — observe completed simulator cleanup

**Round-3 audit correction:** Astra found a missed incomplete publisher-PID
barrier in both ownerless-publication cases. The corrected row and conclusion
below supersede their round-2 audit claims. [Round 3](../round-3/REPORT.md) records
the atomic barrier, identity validation, self-directed fault and regressions.

2026-10-07, against `fc9f9f2740`. All work stayed on eb1000
(`expose-builder-pixel`) in `lane-fl`. Nothing pushed. No remote machine,
other worktree or other lane's process was used.

The user's Apartment mini observation was a test race: the fake `simctl`
writes `deleted-simulator` before returning. Rust waits for command success,
then removes the ownership record. Waiting for the marker alone could observe
the interval between those steps. The user's five-run Mac results are input
to this repair, not execution claimed by this lane.

## Changes and preserved assertions

All three `death during auto-create… deletes only its recorded simulator`
cases now wait for **both** the deletion marker and ownership-record absence,
with a 90-second observation bound. They then wait, also bounded at 90 seconds,
for both recorded background actors to exit before inspecting the complete
simulator call log. Missing process records do not count as exited actors.
The final exact UDID, every mutating simctl target, absent ownership record and
unchanged export assertions remain. Waiting for creation readiness now requires
the complete expected identity, rather than an inode that may still be empty
or contain partially written JSON.

The shared fake runtime-list tool now records `start` after installing its
exit/SIGTERM handlers and polling timer. Its readiness marker therefore
guarantees the handler needed by the exact `start, exit, start` supersession
assertion is installed. That assertion is unchanged.

Three held-wrapper handoff cases wait for the expected stderr diagnostic after
the fixture marker. Marker I/O and parent pipe delivery are independent. Two
overlapping skipped-publication cases wait for child `close` before checking
the complete output. Both passive-observer deadline cases likewise await
`close` before checking stderr, **after** checking process exit and the existing
four-second bound. None of their outcome, retention, publication or deadline
assertions was removed or widened.

The round-1 strict `dev_refusals` source and its permanent mixed-corruption
regression are unchanged. The round-0 blocked-retention cases, compression
fixture, abort handling and shared teardown are byte-identical to round 1;
[preservation hashes](evidence/preservation.json) record this separately from
the runtime-list fixture change. No product source or product timeout changed.

## Why deletion remains before ownership removal

`simulator.rs::select` persists a `ready: false` creation intent in the run's
recovery journal. `recovery.rs::recover` holds the run/device leases, reconciles
that intent against the exact name/runtime, deletes the device, and only then
unlinks its ownership record. Reversing those operations would discard custody
before a failed delete could be retried.

A crash after successful deletion but before unlinking does not block these
runs permanently. On recovery, `reconcile_created` returns `None`; the matching
unready ownership record is removed without another delete. Kernel leases are
released by process death. Automatic selection also requires an actual listed
device and a ready matching record, so an orphan record alone cannot authorize
reuse. This follows LLP 3000.030 §§13/15; the test repair changes no contract.

The [Linux recovery replay](reproduce/simulator-cleanup.mjs) verifies this with
the real `witness export-cleanup` and a private fake `xcrun`:

- Pause delete after writing its marker: the ownership record is demonstrably
  still present, so the former immediate assertion would fail. The revised
  observation stays pending, then succeeds after release and process exit.
- Start with deletion already complete and the matching record still present:
  recovery removes it, writes `finished.json`, and issues only a device-list
  call. An unrelated ownership record remains byte-identical.

The replay extracts and executes the revised test's actual final observation
block. Its two actor records identify the directly owned recovery process for
this Linux exercise; it does **not** pretend to run the Darwin background path.

Four controls execute that same block and must reject: a retained ownership
record (deliberately mismatched so recovery leaves it alone), a wrong deletion
marker, an unrelated simulated call appended **after** the deletion marker,
and changed export bytes. Only the retained-record control shortens its
expected-refusal observation bound to 500 ms; predicates and final assertions
remain unmodified. The fake tool logs calls; it never accesses real simulators.

## Complete file audit

[Registration inventory](evidence/case-inventory.json): **94 cases**, comprising
**32 Darwin-only** and **62 portable**. Each parameter value is included below.
The audit followed `background.rs`, `simulator.rs`, `ownership.rs`, `recovery.rs`,
`retention.rs`, the publisher/wrapper handoffs and both tool fixtures. A terminal
proof receipt is not treated as evidence that later maintenance has completed.

### Darwin-only cases (32)

| Case / parameters | Count | Finding and disposition |
| --- | ---: | --- |
| export publishes before smoke completes… | 1 | Blocked tool holds proof pending; `status --wait` observes the terminal result before status/doctor assertions. Publication and next handoff are synchronous. No additional wait. |
| new publication supersedes blocked smoke… | 1 | Second start follows first group drain and shared lease release. Exact event ordering stays asserted; shared fixture now installs exit handlers before announcing start. |
| background death: driver SIGKILL; worker SIGKILL/SIGTERM/SIGHUP | 4 | Already waits for the owned tool's disappearance after terminal status. Export bytes precede publication return. No later cleanup state is asserted immediately. |
| interrupting a status observer… | 1 | Observer exit is awaited; proof intentionally remains blocked/alive. No cleanup-complete inference. |
| background product failure stays loud… | 1 | Status waits for the failed receipt; export completed before invoke returned. No additional wait. |
| failed evidence pruning… | 1 | Already waits for the cleanup-deferred diagnostic after terminal status before asserting the preserved outcome. |
| driver death / auto-create-buffered-timeout | 1 | **Changed:** complete creation marker, ownership removal, actor exit, then all final assertions. |
| driver death / auto-create-race | 1 | **Changed:** same ordering; bootstatus readiness includes its complete identity. |
| worker death / auto-create-race | 1 | **Changed:** same ordering; surviving driver must finish recovery before call-log inspection. |
| explicit opt-out supersedes… | 1 | New skipped handoff is synchronous; old superseded result already has its own wait. |
| failed latest handoff… (equal / different bytes) | 2 | Invoke waits for publisher failure and synchronous status handling. Previous identity and current marker assertions are intentionally immediate. |
| blocked retention: after SIGTERM/SIGKILL/supersede | 3 | Existing separate compressor/child/guardian/keeper and worker-exit waits precede the next proof. **Preserved without edits.** |
| overlapping skipped export… (marker / handoff failure) | 2 | **Changed:** await `close`, not just `exit`, before checking failure output. Existing current-worker-exit wait protects receipt replacement. |
| request timestamp begins at publication commit… | 1 | Verified publication, request and pending handoff are committed before invoke returns. Tool remains blocked. No additional wait. |
| direct export-retain has bounded custody… | 1 | Caller exit is followed by an explicit descendant-drain wait. No additional wait. |
| SIGKILL overlap defers a still-held retention lock… | 1 | Next tool start occurs after its cleanup-busy log write; paused owner watcher keeps the old compressor alive. Resume is followed by an explicit wait for all old group roles. |
| first-started last-published… (off / non-macOS / background) | 3 | Early wrapper holds its lease; request registration precedes invoke return and observer readiness refuses that live lease. Background variant already waits for worker exit, then queue idle and a synchronous cleanup scan before retention counts. |
| failed handoffs with held wrapper leases… (off / non-macOS / background) | 3 | **Changed:** wait separately for stderr after each wrapper-held marker. After release, wrapper exit plus queue idle already precede retention assertions. |
| failed export lease removes its shell… (off / non-macOS / background) | 3 | Failed wrapper returns after synchronous shell cleanup. Legacy-shell assertions follow held-lease release and queue idle. |

### Portable cases (62)

| Case / parameters | Count | Finding and disposition |
| --- | ---: | --- |
| failed export-skipped handoff… (off / non-macOS); first opt-out… | 3 | Synchronous publisher return precedes handoff/marker checks. Preserve immediate assertions. |
| blocked retention: before SIGTERM/SIGKILL/supersede/deadline | 4 | Existing state waits and timeout cleanup preserved byte-for-byte. |
| repeated skipped exports… (2); skipped maintenance drains… (3); held retention coalesces… (2) | 7 | Final counts follow explicit maintenance idle; signal cases also wait for all recorded group members. Log assertion follows custodian exit. Timing/deadline assertions unchanged. |
| held exclusive/shared publication lock… | 2 | Held locks are acknowledged before inspection; counts and attempt number follow release plus queue idle. |
| failed maintenance retains a parked request… | 1 | Error receipt is followed by `maintenanceIdle(f,true)` before parked-state assertions. Queue producers have exited. |
| retention repairs ownerless publication before/after exchange… | 2 | **Round-3 correction:** the former existence-only barrier wait could capture an empty PID file as zero before the C fixture wrote it. This was missed in round 2. Round 3 publishes the complete PID atomically, validates command/birth, and requests the private publisher to SIGKILL itself; owner exit and queue idle still precede the unchanged repair assertions. |
| live retention owner… (launch gate true / false) | 2 | **Changed:** preserve exit/deadline assertions, then await pipe closure before checking the parked diagnostic. |
| retention cannot remove a run during initialization…; stuck initializer refusal… | 2 | Held initialization lease/barrier protects immediate invariants. Completion checks follow wrapper return and/or maintenance idle. |
| sole maintenance custodian/observer SIGKILL… | 2 | Explicit whole-group drain followed by queue idle precedes counts and resumption-attempt assertions. |
| failed Expo exports / dead wrapper journals… (3 modes) | 3 | Failure return includes synchronous attempt cleanup. Success path releases retention and awaits queue idle before history counts. Native receipt does not stand in for that wait. |
| repeated raced retention-lock deferrals… | 1 | `handoff` active record is written after result, requeue and claim acknowledgment. Existing wait therefore orders all immediately asserted fields. |
| publication-committed / publication-handoff × 3 modes × next Expo success/failure | 12 | Debug barrier stops publication at the exact asserted boundary; wrapper exit follows owner kill. Final history assertions follow maintenance idle. |
| 13 request/claim/scan/compress/delete/done crash points | 13 | Explicit protocol barriers precede fault injection; queue idle, with the documented next export where required, precedes final counts/temporary-file assertions. |
| custodian killed after claiming empty legacy request | 1 | Barrier acknowledges rename before inspecting the empty claim; queue idle precedes history/log checks. |
| handoff-pending / handoff-busy × observer/custodian death | 4 | Victim exit and barrier release precede queue idle; scan exit is also awaited before final status/count assertions. |
| next export repairs parked maintenance… (3 modes) | 3 | Recorded observer exit precedes state surgery; synchronous failed export plus queue idle precedes counts and absence of simulator calls. |

The round-2 blanket assertion that no other early-marker/later-state race
remained was incorrect: the ownerless-publication PID barrier above is one.
The output-delivery findings remain: remaining child `exit` waits either observe processes without captured pipes or use output
only as failure diagnostics; they do not assert complete pipe content. Barrier
invariant checks were not converted into eventual-success polls. No case, skip,
result expectation, custody check or product deadline was removed.

## Verification and limits

- **20/20 loaded Linux recovery replays:** two positive cases and four rejecting
  controls per round: **40 positive passes, 80 expected refusals**. Four owned
  busy loops and the replay's descendants shared CPUs 80–81 via `taskset`.
  All load children reaped; test source unchanged. Rounds took 3.398–4.090 s.
  [Summary](evidence/loaded-summary.json), [runner log](evidence/loaded-runner.log),
  [single replay and controls](evidence/simulator-cleanup.json), and all twenty
  `loaded-NN.json` records are retained.
- **Five export suites passed:** 80 passed, 33 existing platform skips, zero
  failures/cancellations and no runner-reported process leaks. Background alone:
  62 passed, 32 Darwin skips; the file still declares all 94 cases.
  [Canonical runner log](evidence/export-suites.log).
- **`dev_refusals`: 22 passed**, including the unchanged combined-fault regression.
  [Log](evidence/dev-refusals.log). Round-1's 20 loaded full-suite runs and all
  42 Astra corruption controls remain applicable to its unchanged source; they
  were not rerun or reattributed to round 2.
- **Witness units:** initial run **71 passed / 1 failed**, with the already-open
  native `/proc` inspection signature in
  `recovery_volta_style_shim_drains_late_group_member`. Focused unchanged rerun:
  1 passed; complete unchanged module rerun: **72 passed**. The first failure
  remains evidence, and its recurrence is appended to the
  [existing ticket](../../../../issues/20261004-snapback4-native-witness-proc-group-inspection.md).
  No rejected stat snapshot was retained, so its cause is not inferred.
  [Initial log](evidence/witness-unit.log), [focused rerun](evidence/witness-focused-rerun.log),
  [module rerun](evidence/witness-unit-rerun.log). The failed fixture's recorded
  keepers/guardians were all absent in the [process check](evidence/failed-unit-process-check.json).
- JavaScript syntax, Python compilation and `git diff --check` pass. No new
  test files or inventories. Governing `@ref` semantics remain unchanged.

This is **not Darwin execution or publication qualification**. The three
simulator-death cases and the other Darwin-only changes need the user's planned
approximately 15-run loaded mini soak. No full publication dry run, wasm rebuild
or new independent review verdict is claimed.

## Reproduce

From `snapback4/`, using the existing built debug binary and Node 24:

```sh
node reports/20261007-fl-dry-run-flakes/round-2/reproduce/simulator-cleanup.mjs
python3 reports/20261007-fl-dry-run-flakes/round-2/reproduce/load.py
node scripts/run-client-tests.mjs 2 files packages/snapback4/test/export-background.test.mjs packages/snapback4/test/export-publication.test.mjs packages/snapback4/test/export-native.test.mjs packages/snapback4/test/export-native-round2.test.mjs packages/snapback4/test/export-failure.test.mjs
```

The replay operates solely on private temporary fixtures and directly owned
recovery children, releases the delete barrier in `finally`, waits for native
custody to drain and removes its fixtures. It never modifies product/test source.
