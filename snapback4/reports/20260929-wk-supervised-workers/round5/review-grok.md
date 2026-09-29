I'll review the supervised-worker change read-only: first the diff and prior-round findings, then I'll check each claimed fix with a detecting test before looking for anything that should block landing.The review skill's GitHub workflow doesn't fit this request: I'll stay read-only and write the review myself. Next I’ll pull the diff and the earlier-round findings so each claimed fix can be checked against a test.Round 4 says the busy-commit duplicate, schema-local lookup, doctor status, `NODE_OPTIONS`, and the rotation fence are fixed. I'll read those paths and the tests that are supposed to catch a regression.Auto-compacting conversation (80% full)...
Conversation compacted.
The ledger duplicate and the snapshot lookup are the two claims that still need a detecting run. I'll copy the ledger out of the tree, run the contention test with and without the fix, and pin the line numbers the review has to cite.The duplicate claim turns on one `COMMIT` retry. I'm running that test against the current ledger and against the old single-commit version, on copies outside the tree.**READY WITH CHANGES.** The ledger duplicate fix holds, and I reproduced the old double execution without it. The snapshot still lets a credentialed worker load a package from `/tmp/node_modules`. That should be fixed before landing. I did not build `snapback4` or run the Rust suite; those tests were checked against the source only.

Reviewed `78bcc92c8..74757c866b` at `74757c866bd436ca1e009db6a0832399e6f03fdb`. The worktree was left clean. Ledger runs used `/tmp` copies of `worker-ledger.ts` on Node v24.13.1, driven by `SNAPBACK4_TEST_WORKER_LEDGER`. There is no `target/debug/snapback4` and no `packages/snapback4/dist` here.

## Earlier findings

| Round-3 item | Result |
| --- | --- |
| Busy `COMMIT` rolled back a finished receipt | Fixed. Detecting test run, both ways. |
| `serve` schema-local packages | Present in the shared snapshot. Not executed (needs the binary). |
| Ledger init left `doctor` at `running` | Code exits 78 and records `ledger-unavailable` when retirement also succeeds. Test not executed. |
| `NODE_OPTIONS` copied into the worker | Cleared environment; `NODE_` is reserved. Test not executed. |
| `serve` rotation fence | Same `close_child_session` compare-and-swap as `dev`. Test not executed. |
| Untested `synchronous=FULL` and abort guards | Both tests passed on the repaired ledger. Dropping `PRAGMA synchronous = FULL` fails the durability test (`0 !== 2`). |

The busy-commit test is `worker-ledger-contention.test.mjs:13`. On the repaired copy, both variants passed: one `performed`, two `original-receipt` results, including when abort arrives after the busy `COMMIT`. The abort-before-handler test at `:82` also passed. Replacing `commit()` with a single `this.db.exec("COMMIT")` failed both variants. The trace was process A `performed`, `busy` on `COMMIT`, then `worker ledger unavailable ... database is locked`, and process B `performed`. That is the duplicate: the handler ran twice, and the first receipt was thrown away.

`PRAGMA synchronous = FULL` and `busy_timeout = 0` are checked by `worker-regressions.test.mjs:263`. That test passed on the repaired copy. A copy that set only `busy_timeout` failed with synchronous `0 !== 2`. `ledger open waits for a busy writer` (`:322`) and the in-process two-connection test (`:501`) also passed.

These are in the source and unrun, because they need the binary:

- Schema-local lookup is the nearest ancestor `snapback/node_modules`, linked in `worker_declarations.rs:203-205`, used by named and automatic snapshots for both `dev` and `serve`.
- Init failure calls `process.exit(78)` (`worker.ts:153-157`, `:293-304`) and the supervisor records `ledger-unavailable` only after retirement commits (`dev_worker.rs:252-265`). If retirement also fails, the status is `revocation-blocked`, which is the stricter of the two.
- `command()` clears the environment and copies only `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, and `TZ` (`dev_worker.rs:458-464`). `NODE_` is a reserved secret prefix (`worker_environment.rs:28`). The Node version probe uses that cleared command before any token is minted.
- Failed retirement compare-and-swaps `worker_revision` once from the child's original revision (`dev_worker.rs:380`) and will not mint again until the delete commits (`:273-276`). `serve` and `dev` share this path.

## Credential lifecycle

Sound, from the source.

The service token is not stored. The session `family` column is the token digest (`identity.rs:171`), and the supervisor writes that same digest to `worker:session-family` or `worker:family:<digest>` (`dev_worker.rs:37-39`, `:304-306`). Status JSON is name, source, mode, state, counters, and pid (`dev_worker.rs:352-353`). `doctor` prints those rows and nothing else (`verbs.rs:744-746`). The token is injected only on the watchdog's cleared environment and is added to the stdout/stderr redactor (`dev_worker.rs:324-340`).

Refresh is the same for named and conventional workers. A fenced or dead bearer is 401. A live supervised family is HTTP 403 `E_WORKER_REFRESH` with no successor (`auth.rs:243-261`). The `OR` / `AND` in that lookup matches either meta key, not a same-named manual seat. Manual seats still rotate. Request doors pass `shared.worker_revision` through `resolve_supervised` / `current_service`. Unguarded `identity::resolve` is only in `serve_tests.rs`.

Retirement covers removal, rotation, restart, and shutdown. The child is stopped before the delete. A failed delete keeps the family and blocks the next mint. Startup `clear_child_session` (`dev_worker.rs:22-29`, called from `serve.rs:294`) deletes supervised families only. Every successful adoption bumps `worker_revision` (`serve_adoption.rs:220`), so the old child cannot claim during the stop delay, and peers restart under the new revision once.

## Supervision

`dev` and `serve` share `Supervisor` / `DevWorker`. Named entries and dev's automatic entry run a no-follow copy: `openat` with `O_NOFOLLOW`, symlinks and non-regular files refused, snapshot held until the child group is gone. Explicit `serve --worker` stays the operator's live path, which LLP 3000.009 §5.3 allows.

The watchdog is its own process group and puts Node in another. It writes the Node group id before forwarding output, and on stdin EOF, SIGTERM, SIGINT, or SIGHUP it signals the group, then SIGKILL after two seconds (`worker_process.rs:22-71`). Node exit, including 78, kills the group before the watchdog exits, so a clean exit 78 does not need a second kill. Shutdown closes every stdin before any wait (`dev_worker.rs:392-407`). If the watchdog itself dies by a signal, the host SIGKILLs `-(worker_pid)` (`:411-412`).

Still open, and not claimed fixed: `issues/20260929-snapback4-watchdog-fallback-group-identity.md`. After an unexpected watchdog death, that fallback is a numeric group id. `WNOWAIT` does not keep the id reserved once the watchdog is gone. Low, known.

### Medium — snapshot parents include `/tmp/node_modules`

`worker_declarations.rs:180`. `Snapshot::scope` runs `mkdtemp` under `std::env::temp_dir()`. On this machine that is `/tmp`. Node resolves a bare specifier by walking physical parents of the file. The private `scope/` chain is searched first, and then `/tmp/node_modules`.

I built that layout under `/tmp/snapback4-worker-…/scope/snapback/workers/push.mjs` with `import` of a package that existed only at `/tmp/node_modules/<name>`. Node printed `from-tmp` and exited 0. A package in `scope/node_modules` then won (`from-project`). `scope/snapback/node_modules` won over that (`from-schema`). So a present project or schema package still wins. A missing or mistyped bare import, which should be `ERR_MODULE_NOT_FOUND`, runs whoever can create `/tmp/node_modules` (any local user; `/tmp` is sticky, not private). That process has `SNAPBACK_SERVICE_TOKEN`. `$HOME/.node_modules` is older Node behavior and is not this bug. The new ancestor is `/tmp`, because the project file's own parents never included it.

Smallest fix: create the snapshot under the store or `.snapback4` directory, mode `0700`, not `std::env::temp_dir()`. `Drop` already deletes it. LLP 3000.009 §5.3 says the private hierarchy preserves the project's ancestor lookup and that installed dependencies stay host-owned. It should not add `/tmp`.

The worker tests never plant a package on a physical parent of the snapshot, so this survives the suite.

### Low — named workers follow a `snapback/package.json` symlink

`worker_declarations.rs:206-208` (`std::fs::copy`). Automatic mode replaces that file through the no-follow walk (`:134-137`) and refuses a symlink. Named mode never does. A symlink whose target carries an `imports` map is copied into the named snapshot and honored by Node. Ancestor `package.json` files at `:195-197` are followed for both modes. Worker source symlinks are refused; these metadata copies are not.

Smallest fix: copy `snapback/package.json` with the same `O_NOFOLLOW` descriptor read the automatic walk already uses, and refuse a symlink.

### Low — a removed worker can stay `running` in `doctor`

`dev_worker.rs:22-29` and `verbs.rs:746`. `clear_child_session` deletes supervised sessions and family meta, not `worker:status` or `worker:status:%`. Spec is right that doctor is the last report, not a live probe, while the declaration still exists. It is wrong after this sequence: status is `running`, the declaration is removed, the host is killed before `stopped` is written, the next process revokes the family and does not own that name. `doctor` keeps printing `running` for a worker that is gone and whose token is already dead.

Smallest fix: delete `worker:status` and `worker:status:%` in `clear_child_session`, or print a row only for a name `declared()` still returns.

## Ledger

The cross-process guarantee holds for recoverable `SQLITE_BUSY`, and the deterministic test actually detects the old bug.

This Node's file databases default to `journal_mode=delete` and `synchronous=2`. The ledger sets `busy_timeout=0` and `synchronous=FULL` (`worker-ledger.ts:30`) and does not change the journal mode, so commits stay on the rollback journal. `BEGIN IMMEDIATE` takes the reserved lock. The handler and the `INSERT` run inside it. `COMMIT` is what needs the exclusive lock.

A second connection in `BEGIN` plus `SELECT` makes that `COMMIT` return `errcode: 5`, `database is locked`, and leaves the writer transaction open. An `INSERT` after that failed `COMMIT` succeeded. After the reader's `ROLLBACK`, `COMMIT` succeeded and both rows were durable (`count=2`). A peer `BEGIN IMMEDIATE` that has already returned busy does not leave a transaction, and the writer's `COMMIT` then succeeds. Overlapping processes still hit busy commits: in 250ms of cross-process `BEGIN IMMEDIATE` traffic, 754 commits returned errcode 5 and 7194 succeeded. The lock is gone by the time the peer's `BEGIN` returns, which fits a 1-in-22 flake better than a stuck reader. Checkpointing is not involved.

The old `commit()` was one `exec("COMMIT")`. Errcode 5 fell into `run`'s catch (`worker-ledger.ts:64-68`), which rolls back. The handler had finished and the insert was discarded, so the other process did not see a row and ran the handler. That is the noretry result above. Two immediate writers do not need a third process to make `COMMIT` busy; the third deferred reader is what makes the test reliable.

The repair (`worker-ledger.ts:75-87`) retries only errcode 5, keeps the reservation, does not run the handler again, and ignores abort after provider success. Both contention variants passed. Cancellation before `BEGIN IMMEDIATE` still does not run the handler.

What remains, and is specified in LLP 3000.009 §5.2: if the process dies, or commit fails for something other than errcode 5, after the handler returns and before a durable commit, the receipt is gone and the action may run again. Generated `ctx.step` is still outside this ledger. A reader or a hung handler stalls every key in the file, because the write transaction covers the handler on purpose.

A copy that retried `COMMIT` at most 100 times, then threw errcode 5, still passed all three contention tests. The harness drops the reader as soon as it sees the first busy `COMMIT`, so a large cap never expires. That cap would discard the receipt if the reader stayed longer, which is the original bug. The suite would stay green.

## Verdict

**READY WITH CHANGES.** Credential fencing, refresh, redaction, environment clearing, no-follow source copies, watchdog group cleanup, and the busy-commit retry are sound. The retry is backed by a test that fails on the old single `COMMIT` and passes on the repair. Move the worker snapshot out of `std::env::temp_dir()` before landing. The two Low items should be fixed in the same pass, but they are not the reason to hold it.
