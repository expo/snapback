# Round 1 failures and attribution

## Regression controls (expected failures of our round 0 implementation)

`regressions-before.log.gz` ran the first 13 cases against the unmodified round 0
binary/client after the required merge. **2 passed, 11 failed**. Every failure
below is **ours (round 0)**, reproduced before repair:

- Failed revocation/restart: retired bearer authenticated with HTTP 200 rather
  than 401 after SQLite's writer lock was released.
- Worker snapshot: schema-directory symlink, worker-root symlink, and FIFO each
  deployed rather than refusing. Existing entry/helper symlink checks passed.
- Fresh stores: the second fresh backend did not perform its independent effect;
  the test timed out waiting for the missing handler action.
- Worker exit, server SIGTERM, server SIGKILL: descendant cleanup timed out in
  each of the three cases because processes remained alive. Fixture cleanup
  terminated only the recorded PIDs.
- Corrupt SQLite file, wrong completions schema, and non-directory parent: each
  ledger initialization test observed claims (65, 64 and 66 respectively)
  instead of zero. These are three storage fixtures for the same finding.

The separate mutation removes only the named-family session DELETE from the
fixed supervisor. `mutant-revocation.log.gz` records **0 passed, 2 failed**:
restart and rotation each accepted the retired bearer with HTTP 200 instead of
401. Both are **expected mutation-control failures of our code**, and kill the
surviving mutation Astra identified. Rotation extends the stored expiry while
retaining the supervisor's original deadline, so ordinary token expiry cannot
mask a missing deletion. The original source and binary were restored before
qualification. `rotation.log.gz` records the positive control.

## Intermediate qualification

`regressions-after.log.gz`: **16 passed, 2 failed**. Both failures are **ours**:
the existing dev and serve supervision tests still expected the old unscoped
`worker-ledger.sqlite` filename. Assertions now derive the expected name from
the actual store identity. The next affected run passed **53/53** (rotation was
added separately and passed **1/1**). No production behavior was changed to
satisfy these stale expectations.

`grok-before.log.gz`: **0 passed, 2 failed**, expected **ours** controls before
addressing the newly received review. A named entry received an unrelated mail
secret, and four TERM-ignoring workers received termination about two seconds
apart. Both now pass with secret subsets and simultaneous shutdown initiation.

`ledger-storage-before.log.gz`: **0 passed, 2 failed**, expected **ours** controls.
The pre-repair runtime kept claiming/settling after SQLite max-page exhaustion
(10 claims observed) and a combined commit/rollback failure (21 claims observed).
Both now pass with one claim, no settlement, and a closed/released connection.

`mutant-busy.log.gz`: **0 passed, 1 failed**, the expected **mutation-control**
failure requested by Grok. A copied module (not the live product or full-suite
inputs) changes the run-path SQLITE_BUSY check from 5 to 0. The deterministic
waiter fails with `database is locked`; `busy-fixed.log.gz` passes **1/1**. The
strengthened three-process receipt assertion also passes.

## Tool/setup errors

The checkout initially had an uninitialized `vendor/llp`, so the first
`skills/llp-orient/SKILL.md` read failed (**environmental setup**). Initialized
only that submodule, read the skill, and used its scoped orientation.
Several orientation reads guessed nonexistent filenames before enumerating the
real files (**ours**). One metadata/census command used repository-root paths
from inside `snapback4/`: Python raised FileNotFoundError and Node raised
ERR_MODULE_NOT_FOUND, before either edit took place (**ours**). Repeated the
commands at the correct root; the updated await inventory passes. A status
probe used an unowned/nonexistent PID and returned no row; it sent no signal.
The required initial merge had the expected append-only journal conflict:
retained both entries and committed the merge, with no product-code conflict.

## Full suite

The one requested invocation finished with exit **1**, exact summary
`== 1 failure(s) in 1319 s`. Its Cargo stage failed at
`snapback4::snapback4`: **196 passed, 3 failed, 4 ignored**. All three are **ours**:

- `serve::tests::adoption_tests::worker::production_accept_loop_reads_after_delayed_worker_exit`
- `serve::tests::adoption_tests::worker::production_accept_loop_reads_while_exited_worker_waits_for_adoption`
- `serve::tests::adoption_tests::worker::production_accept_loop_waits_for_complete_worker_readiness`

Each failed with `workers: No such file or directory (os error 2)` because the
new no-follow traversal treated an absent schema directory as an error. Restored
the optional declaration behavior for an absent directory (symlinks still
refuse), and made unit fixtures launch the built production watchdog CLI rather
than Rust's test-harness executable. The exact three tests pass **3/3** in
`adoption-worker-repaired.log.gz`. No timeout, assertion or core product rule was
relaxed. The original full-run failures remain in `test-sh.log.gz`.

The initial full build/Rust stage preceded the final streamed Grok review. Its
additional changes were built before/during the client phase and independently
qualified in the final affected/guide/typecheck checks. This is one full-suite
invocation, not a claim of an atomic final-source full-battery snapshot.


Every other stage passed. Clients: **4,587 pass / 0 fail / 10 declared skips**;
models **79/79 pass**. No baseline or environmental test failure in the full
run. The existing 60-second process budget remains missed (**baseline**: the
round-0 report already recorded 1,506 seconds). No ceiling/timeout was raised.
Final affected check is **62/62 pass**, whole guide **98/98**, package typecheck
and final build pass, await census **1/1**, reference audit zero errors.

Final staging whitespace check rejected ten Markdown hard-break spaces in the
retained Astra review (**ours: evidence formatting**, not a product test).
Normalized only trailing spaces; retained every word of the review. The staged
whitespace check then passed. All 31 log files were losslessly gzip-compressed
and verified byte-for-byte by decompression.
