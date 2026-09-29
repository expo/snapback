I'll review the supervised-workers change read-only: first the lane prompt, the round reports, and the diff, then check each earlier finding against a detecting test.Round 2 claims the earlier revocation, symlink, watchdog, and ledger holes are closed. I'll read those paths in the current tree and match each one to a test that would fail if it regressed.Auto-compacting conversation (80% full)...
Conversation compacted.
The prior pass mapped the supervision and ledger paths. I am confirming exact lines and the tests that detect the round 0 and round 1 findings, then I will write the review.The round 0 and round 1 defects are fixed in this tree, and the detectors for them are in `snapback4/packages/snapback4/test/worker-regressions.test.mjs` and `supervised-workers.test.mjs`. I did not re-run them: this worktree has no `snapback4` binary and no `packages/snapback4/dist`. The verdict is from reading the current code and those tests.

## Prior findings

| Finding | Status | Detector |
| --- | --- | --- |
| Failed revocation left the old token usable | Fixed. `close_child_session` (`dev_worker.rs:347`) keeps the family and expiry when DELETE/COMMIT fails. Mint is gated at `:268`. The next start calls `clear_child_session` (`:22`) under the deployment lock (`serve.rs:294`). | `failed revocation blocks restart until the retired bearer is refused` (`worker-regressions.test.mjs:205`): claim is 401, the replacement is 200, and the token is not in the log. |
| Removing a worker forgot a failed revocation | Fixed. Retiring workers stay owned while `child_expires_at` is set (`dev_worker.rs:107`, `:218`). `/q`, `/m`, and `/auth/refresh` use the revision fence (`identity.rs:50`, `auth.rs:241`). | `removed worker retains query fence / retirement custody while deletion is locked` (`:56`): 401 on `/q`, `/m/send`, and `/auth/refresh` while the writer lock is held, then the family is gone and status is `stopped`. |
| Deploy followed a symlink at the workers root | Fixed. `openat` uses `O_NOFOLLOW` (`worker_declarations.rs:9`). Anything that is not a directory or a regular file fails the walk (`:57`). | `worker snapshot refuses schema/root/entry/helper/fifo escapes` (`:241`): deploy exits non-zero and `.env.test` is not in the release. |
| Restart executed a symlink discovery had rejected | Fixed for declared workers. Every launch recopies the tree into a private snapshot (`worker_declarations.rs:103`) and returns before mint on failure (`dev_worker.rs:276`). | `restart refuses an entry symlink already rejected by discovery` (`:92`) and `launch executes validated entry and helper bytes` (`:110`): no `escaped` file; the helper value is `validated`. |
| `--fresh` suppressed effects through a persistent ledger | Fixed. The ledger sits beside the opened store and is named by `store_id` (`dev_worker.rs:198`). | `fresh stores and replacement stores cannot replay another store completion` (`:276`): one reused effect id, four ledger paths. |
| Workers and descendants outlived the server | Fixed for the Node process group. The watchdog SIGTERMs then SIGKILLs that group (`worker_process.rs:63`, `:69`). Watchdog signal-death makes the supervisor SIGKILL the retained group before dropping it (`dev_worker.rs:384`, `:391`). TERM/INT/HUP on the watchdog clean up without a live host (`worker_process.rs:26`). | `watchdog SIGKILL terminates its Node group` (`:129`), `watchdog SIGTERM/SIGINT/SIGHUP` (`:179`), and `worker/SIGTERM/SIGKILL stops worker descendants` (`:300`). |
| Broken ledger init consumed delivery attempts | Fixed. Init failure reports once and does not enter the claim loop (`worker.ts:288`). | `ledger corrupt/schema/receipt/parent-file initialization reports once without claiming or settling` (`:314`): zero claims, settlements, and handler calls. |
| Every named worker received every secret | Fixed. Named workers get only `// snapback4 secrets:` names read from the snapshot (`worker_environment.rs:9`, `dev_worker.rs:314`). | `named workers receive only entry-named declared secrets` (`:336`). |
| Mint and secret failures did not back off | Fixed (`dev_worker.rs:335`). | `repeated secret admission failures increase restart backoff` (`:364`). |
| A new declaration that failed admission was forgotten | Fixed. The name stays in `pending` and is rediscovered (`dev_worker.rs:88`, `:108`). | `new declarations retry failed admission after Node is repaired` (`:165`). |
| `PRAGMA synchronous = FULL` → `OFF` was untested | The OFF mutation is now killed. The test reads `PRAGMA synchronous` on the real connection at init and completion (`worker-regressions.test.mjs:142`) and expects `2`. SQLite reports `0` for OFF. | Same test. Open-path `errcode !== 5` → `!== 0` is also killed by `ledger open waits for a busy writer` (`:193`): BUSY is `5`, so that edit throws instead of waiting. |

`detached: true` grandchildren still leave the process group. That matches the stated contract (the group, not every descendant). Provider I/O still holds the ledger writer lock; that is the documented tradeoff, not a false completion.

## Security

Declared workers do not leak the service token through supervisor logs, doctor, or the deploy snapshot. The redactor holds a secret prefix across chunk boundaries and also matches the JSON-escaped form (`worker_environment.rs:52`). A base64url token has no escaped form distinct from the raw token. Doctor status is name, source path, mode, state, counts, and pid (`dev_worker.rs:341`). `/dev/status` is store id, project, generation, and adoption (`serve.rs:916`). Deploy copies regular-file bytes from `O_NOFOLLOW` descriptors, not the environment. The Node version probe uses a cleared environment and does not receive the token (`dev_worker.rs:437`).

The token is in the watchdog’s environment as well as Node’s, because Node inherits it (`dev_worker.rs:321`, `worker_process.rs:36`). That is same-user `/proc` exposure, not an extra privilege: Node must have the token. It is not printed. A worker can still write `process.env` to a file or the network; redaction is log-only.

An untrusted package cannot become a declared worker unless something writes `snapback/workers/<service>.{mjs,mts,ts}`. That is the same trust as editing the schema. Imports resolve through host `node_modules` on purpose. The snapshot does not execute a symlink in that tree.

Rotation and revocation for declared workers are correct. Family and revision commit with the session (`identity.rs:151` is the same SHA-256 the supervisor stores). A mismatched or failed retirement is refused on query, mutation, route, effect claim, action claim, change-poll, and refresh. Manual seats have no `worker:family:` row and stay on ordinary liveness (`identity.rs:58`). Refresh checks the fence while holding the engine lock (`auth.rs:240`); adoption bumps `worker_revision` only while holding that same lock (`serve_adoption.rs:220`).

**Medium.** `dev_worker.rs:45` (execution at `:313`). `dev` still discovers `snapback/server.ts` and `snapback/worker.{ts,mts,mjs}` with `Path::is_file`, which follows symlinks, then `canonicalize` (`:189`). The unnamed branch never snapshots (`:281`) and runs that canonical path (`:313`) with the full secret map, not the declared subset. `serve` of a release does not use this entry unless `--worker` is passed. `snapback/workers/` rejection does not apply.

Scenario: a postinstall, or any writer in the project, replaces `snapback/worker.mjs` with a symlink into `node_modules`. `dev` mints `service:worker` and runs the target with every declared secret. `npm update` changes the payload without another edit under `snapback/`. The watcher skips symlinks (`project.rs:125`), so the external target is picked up on the next restart, not rejected. The named-worker tests never create this path.

Smallest fix: open that entry with the same `O_NOFOLLOW` walk and execute a private copy, or refuse to mint when it is not a regular file under the project. Do not treat a successful `canonicalize` as custody.

## Supervision

Declared workers in `dev` and `serve` share `Supervisor::start` (`serve.rs:368`). `serve` sets `explicit_env`, so it does not reload on `worker_revision`; `dev` does. Both snapshot named entries. Backoff is 250 ms, doubling to 5 s, and resets only after 30 s uptime (`dev_worker.rs:261`). Shutdown closes every watchdog stdin before waiting (`:127`), so a stuck handler does not add two seconds per worker. The watchdog reaps with `waitid`/`WNOWAIT` (`worker_process.rs:57`), which keeps the Node pid reserved until its own kill. Workers do not bind ports. The shared ledger is the only cross-worker file lock.

`dev --no-watch` will not notice a symlink swap until process restart; restart then re-snapshots and refuses a declared symlink. A `declared()` error during adoption keeps the previous generation and does not bump the revision (`serve_adoption.rs:175`), so the running snapshot stays and the symlink is not executed.

**Low.** `dev_worker.rs:391`. If the watchdog is SIGKILL’d and the Node leader has already exited and been reaped, the supervisor’s fallback `kill(-pid)` is not covered by the watchdog’s `WNOWAIT` reservation (`worker_process.rs:52`). A pid reused as a new process-group leader within one 100 ms park can be killed. The existing SIGKILL test keeps Node in `setInterval`, so it does not catch this.

Smallest fix: take a pidfd when the pid line is read and signal that fd, or confirm the process identity before `kill(-pid)`.

## Ledger

The ledger does not record a failed handler or a commit that did not finish. `handlerFailed` rolls back and rethrows (`worker-ledger.ts:57`). Non-handler failures roll back, or mark the ledger unavailable if rollback fails, and do not insert (`:64`). Disk-full and a failed commit-and-rollback are pinned at `worker-regressions.test.mjs:390` (zero rows, no success settlement). Two processes share one `BEGIN IMMEDIATE` (`:372`, and `supervised-workers.test.mjs:132`): the loser replays the winner’s receipt instead of running the handler again. A corrupt file, a wrong table, a non-JSON receipt, or a parent that is a file fails init without a claim (`:314`).

The effect id is assigned once at emit, `effect-{seq:016x}-{index:016x}` (`runner.rs:570`), and stored as the outbox primary key (`effects.rs:93`). Lease expiry and restart increment `attempt` only. `meta.idempotencyKey` is that id (`worker.ts:180`). A new store can reuse the same text; it does not reuse the ledger file.

Moving the store directory keeps the sibling ledger. Moving only `store.sqlite` opens a new empty ledger and re-runs. That is at-least-once, not suppression. The pre-commit window after a successful provider call is real and documented; it is not a completed delivery being dropped.

**Low.** `worker.ts:293`. After init failure the process waits on the abort signal and does not exit. The supervisor has already recorded `running` (`dev_worker.rs:329`) and will not restart a live child until the one-day window or a source change. Claims are not consumed; they also are not processed. The log line is easy to miss, and doctor keeps saying running.

Smallest fix: exit non-zero after that report so the existing backoff restarts the worker.

**Low.** `verbs.rs:746`. `clear_child_session` deletes families (`dev_worker.rs:27`) and does not delete `worker:status` or `worker:status:%`. After a crash mid-run, or a removal followed by process restart, doctor prints the last JSON, which can still say `running` for a session that startup cleanup already deleted. No token is in that JSON.

Smallest fix: delete `worker:status` and `worker:status:%` in `clear_child_session`, or print a status row only for a name `declared()` still returns.

## What should stop a clean landing

The legacy `dev` entry at `dev_worker.rs:45` should be fixed or explicitly refused before this is called done. It is the same symlink class as the round 1 high, on the path `init` still generates, and it receives every secret. The other two lows should not block.

Test strength: the round 0 and round 1 defects now have detectors, and FULL→OFF plus open-path `!== 5` → `!== 0` are killed. This mutation still survives: delete `PRAGMA synchronous = FULL` at `worker-ledger.ts:30` and leave the connection on SQLite’s default. `PRAGMA synchronous` still reads `2`, so `worker-regressions.test.mjs:158` stays green. Setting the pragma to OFF does not survive. Nothing in the suite executes `snapback/worker.mjs` through a symlink, so the Medium above is untested.

Sound: declared-worker discovery, deploy packaging, private snapshots, per-worker secret subsets, revision fencing on the HTTP doors that round 1 named, startup deletion of orphaned families, process-group shutdown for non-detached children, store-scoped ledgers, stable effect ids, and no false completion on handler or commit failure.

**READY WITH CHANGES**
