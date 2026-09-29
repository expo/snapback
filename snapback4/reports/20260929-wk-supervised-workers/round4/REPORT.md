# WK round 4 — retain completed receipts through contention

Branch: `sb4-intent/wk-supervised-workers`. The first command fetched and merged
origin/main. Merge `d22e97335` retains both appended journal histories; this was
the sole merge conflict. Linux / Node 24.13.1. No push or publication.

## Changes

1. SQLite busy COMMIT now retains the existing transaction and writer reservation,
   waits asynchronously and retries only COMMIT. It does not rerun the completed
   handler or discard its receipt for ordinary reader/writer contention. A waiter
   can abort before handler entry; cancellation after provider success still
   finishes the receipt commit. Persistent readers can delay completion.
2. Serve snapshots use the nearest ancestor containing snapback/node_modules
   before project-root packages, matching the documented schema-local precedence.
   Source validation/private copies and trusted host-installed dependencies remain.
3. A ledger initialization failure stops polling before claims. Supervised
   processes exit with internal status 78 even with live application timers;
   doctor records ledger-unavailable during bounded retries. Repair storage to
   resume. Standalone done resolves for its owner to repair and restart. Later
   ledger storage failures use the same stopped lifecycle.
4. The explicit worker environment no longer copies NODE_OPTIONS, including
   the Node version probe. Only runtime paths, locale/timezone, selected declared
   secrets and supervisor settings are passed. Existing credential redaction and
   refresh refusal remain intact.
5. A failed credential deletion fences the retiring child's original revision
   once. Serve honors revision changes too. Peers renew under that revision;
   repeated retirement failures cannot advance it again. Successful independent
   restarts leave peers alone, and manual seats remain live. Replacement minting
   still waits for deletion to commit.
6. The FULL test starts the actual connection at OFF before its normal setup,
   then observes both commits. The abort test holds the writer, observes real
   SQLITE_BUSY, aborts a waiter and releases the lock. Both deletion mutations
   now fail.
7. The full run exposed round-3 snapshot regressions. Automatic dev snapshots
   now copy checked project imports outside snapback/ using the existing checker
   graph and descriptor-relative validation. Delayed-launch and linked-helper
   tests pin that custody. Lifecycle/routes/server test records now use their
   owned output directories, because module URLs address the private snapshot.

LLP 3000.009 §5.2/§5.3, the effects/actions cards, server manual and operations manual co-evolve. The
client await census changes only the two server-worker entries. Effect identity,
ordering, attempts, leases, meters, authorization policy, generated step semantics
and native jobs are unchanged. No contract.ts or wasm-engine edit.

Delivery remains at least once: process death, an unrecoverable storage failure,
or an unrecordable result after provider success and before durable commit can
repeat the action. Provider idempotency covers that window. The shared local file
serializes handlers and can wait on readers; separate disks do not share receipts.
No actual-provider or macOS qualification is claimed.

## Detecting evidence

Both complete round-3 reviews are saved, with dispositions in REVIEWS.md and
hashes in review-inputs.json. Their high ledger finding has a deterministic
reproduction with two actual worker processes and a third held SQLite reader:

- Before: A performs, its COMMIT returns real SQLITE_BUSY, A rolls back, then B
  performs and commits. Two actions for one key.
- After: A retains its transaction and commits when the reader releases; B
  replays that receipt. One action, two original receipts, replay after exit.
- Post-provider cancellation follows the same completed-receipt behavior.

See commit-before-final.log.gz and commit-fixed.log.gz. The original two-process
shared-ledger test keeps all assertions and now exposes unexpected worker errors.
The [intermittent-duplicate ticket](../../../../issues/closed/20260929-snapback4-worker-ledger-intermittent-duplicate.md)
is resolved. Its original silent run cannot prove the exact cause, but this
reproduced mechanism explains the symptom and is now covered.

Schema-only and shadowed serve dependencies, dev/serve parent preload markers,
and dev/serve ledger-failure status all fail before repair and pass afterward.
The production-mode rotation test keeps the old session valid in storage while
holding deletion, then checks query/mutation/refresh refusal, manual-seat
liveness and a working replacement. Removing its revision CAS fails. An extra
serve peer test confirms both peers renew and repeated failure does not keep
changing the revision.

| Check | Result | Evidence |
| --- | --- | --- |
| Final five-file affected suite: regressions, supervision, contention, worker HTTP and generated effect contexts | 114/114 pass | affected-final.log.gz |
| Final contention, post-provider cancellation and aborted waiter | 3/3 pass | commit-fixed.log.gz |
| Serve peer renewal under failed retirement | 1/1 pass; old binary fails | peer-fence.log.gz, peer-fence-before.log.gz |
| Production-mode rotation, named and conventional paths | 1/1 pass | rotation-final.log.gz |
| Corrected lifecycle fixture, dev and serve SIGTERM cleanup | 1/1 pass | lifecycle-final.log.gz |
| All routes cases after fixture repair | 13/13 pass; combined command's server load failed separately | routes-server-fixed.log.gz |
| Final full server end-to-end file | 9/9 pass | server-qualified.log.gz |
| Whole guide after final text | 98/98 pass | guide-complete.log.gz |
| Final host build / docs budget; package build | pass | build-final.log.gz, docs-budget-final.log.gz, package-build.log.gz |
| Await reachability classification | 1/1 pass | await-boundary.log.gz |
| Delete FULL / delete run abort check / delete retirement CAS | all detected | mutant-full.log.gz, mutant-abort.log.gz, mutant-rotation.log.gz |
| Final reference audit | zero errors / unchecked | ref-check-final.log.gz |

The six requested runtime repairs preceded the full run. It then exposed a
missing checked-import copy and fixture paths inherited from round 3. Those
were repaired after the relevant full stages had finished and qualified by
the affected suite, routes, server, lifecycle and whole-guide runs above.
The final host build includes the checked-import repair and final guide text.
The extra peer/custody tests and documentation also evolved during that run.
The filtered snapshot-unit command selected zero tests and supplies no test
qualification. Source hashes at full-run start and final source are retained
separately. No full invocation was repeated or relabeled green.
[FAILURES.md](FAILURES.md) names all 19 full-run failures, detecting controls
and command/test-authoring errors. No known affected failure remains.

## Required single full-suite run

Command: `scripts/test.sh` from `snapback4/`, invoked exactly once, exit **1**.
Exact final summary and failed stages:

```text
== 2 failure(s) in 1358 s
   cargo test
   client tests
```

Cargo's lifecycle target: **20 passed / 1 failed**. Client tests: **4,820 tests,
4,792 passed, 18 failed, 10 skipped, 0 cancelled**. Final client models: **79/79
passed**. Every other stage passed, including wasm, docs budget, release guard,
package/app typechecks and fixture wrappers. See test-sh.log.gz and test-sh.exit.

All **19 failed tests are ours**, inherited from our round-3 snapshot change:
one Rust lifecycle fixture, thirteen route fixtures, four server fixtures and
one missing project-import runtime path. Their exact names, causes and later
passing evidence are in FAILURES.md. **Zero baseline or environmental test
failures** are assigned. The suite's inherited **60-second budget remains
missed**; no timeout or ceiling was increased. This red full-run snapshot is
preserved alongside successful scoped qualification of the final repairs.

## Wasm

Canonical full-run build, measured independently with its gzip -9 -c command:
2,040,529 B raw / **592,975 B gzip**, against **593,719 B gzip**; **744 B** spare.
SHA-256: `3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
No cap increase. See wasm.json.

The prior Low watchdog fallback group-ID reuse concern remains in its existing
open ticket; it is not represented as fixed. Doctor records the last reported
state, not a fresh OS probe. One append-only journal entry and a local commit
with `Co-Authored-By: GPT-6 Astra <noreply@openai.com>` accompany this report.
