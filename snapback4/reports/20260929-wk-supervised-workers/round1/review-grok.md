I'll review the supervised-workers change read-only: the lane prompt, the report, and the diff from `4fd338de5` to `c3efc87b0`, then check token handling, supervision, and the ledger against the design.The branch is one commit over 57 files. I'll read the report and the worker, token, and ledger code next, then check the design sections they cite.The design puts a source convention and a SQLite ledger in front of the existing supervisor. I'll read the supervisor, token minting, and ledger with the surrounding call sites, not just the diff hunks.Auto-compacting conversation (80% full)...
Conversation compacted.
The review is ready to write. I’ll pin the exact lines for the findings that decide the verdict, then stop.**READY WITH CHANGES.** On the path this lane actually tests, a service token is not printed, a thrown handler is not stored as a completion, and an effect id does not change when its lease expires or the process restarts. The revocation, packaging, and ledger-identity claims are not true on the failure and store-identity paths below. This review read the diff and the current sources. It did not re-run the suite.

## What is sound

Token handling on the supervised path is sound. The token is placed only on that child's command environment (`dev_worker.rs:238`), after `env_clear` (`dev_worker.rs:334`). The Node version probe uses the cleared command and does not receive it (`dev_worker.rs:157`). Doctor prints declaration paths and the status JSON from `record_status` (`verbs.rs:683-686`, `verbs.rs:744-746`, `dev_worker.rs:249`): name, source, mode, state, starts, restarts, crashes, pid. No token. Deploy copies worker source (`worker_declarations.rs:38`); it does not write a minted token or the ledger into the release tree. The pipe redactor holds a strict prefix of any secret, redacts the JSON-escaped form, and runs before the `[worker:{name}]` prefix (`worker_environment.rs:38-48`, `worker_environment.rs:60-70`). The supervised test splits a token across two stdout writes and also prints it on stderr (`supervised-workers.test.mjs:31-34`, `63-66`). Error reporting wraps a redacted message (`worker.ts:153-154`).

Happy-path revocation lines up. `family` is the token digest (`identity.rs:124-126`, `identity.rs:144`), the same digest the supervisor stores (`dev_worker.rs:215-216`). `substr(key, 15)` matches the 14-character `worker:family:` prefix (`dev_worker.rs:24`). `current_service_tx` fences only a family that has that meta row, so a manual seat is left alone (`identity.rs:44-53`). Startup deletes those rows while the deployment lock is held (`serve.rs:294`, `dev_worker.rs:17-27`). Removing a named worker drops its `DevWorker`, and `Drop` closes the session and SIGTERMs the child (`dev_worker.rs:76`, `dev_worker.rs:290-294`). A reload bumps the revision before close (`dev_worker.rs:174-176`), so a failed DELETE on that path still fails the old token: the meta row still carries the old revision (`identity.rs:51-52`).

`serve` and `dev` share `Supervisor`. `serve` sets `explicit_env`, so it does not hot-reload and does not bump the in-memory revision (`dev_worker.rs:79`, `dev_worker.rs:174`). That matches the immutable release. Workers do not bind ports. Exit is reaped with `try_wait` (`dev_worker.rs:191-196`); stop waits, then SIGKILL, then `wait` (`dev_worker.rs:278-285`). Crash and spawn failure back off from 250 ms to 5 s (`dev_worker.rs:202-204`, `dev_worker.rs:244`). A child that lived longer than 30 s resets the backoff.

The effect id is the outbox primary key assigned once at emit, `effect-{seq}-{index}` (`runner.rs:570`, `effects.rs:93`). Claim, failure, and lease expiry update that row in place (`effects.rs:274`, `effects.rs:365`, `effects.rs:509`). `idempotencyKey` is that id (`worker.ts:182`). The ledger inserts only after `await handler()` returns, and a throw rolls back (`worker-ledger.ts:33-41`). The failed-handler test observes a second call (`supervised-workers.test.mjs:113-127`). The guide's residual window matches the code: the provider call is not atomic with the commit (`guide/effects.rs:75-83`). Generated effects receive the key and do not use this ledger (`worker.ts:332`).

## 1. Security

**Medium. Failed close forgets the family, so a same-revision restart never retries revocation.** `snapback4/crates/snapback4/src/dev_worker.rs:256` and `:271`.

`close_child_session` consumes `child_expires_at` before the DELETE. On any error it still sets `self.family = None`. The next call returns immediately at line 256. Crash restart and daily rotation both close and then mint again without changing `worker_revision` (`dev_worker.rs:196-200`, `dev_worker.rs:183-188`, `serve.rs:320`).

A child crashes a minute after start, so its session has almost a day left. The DELETE fails (database locked, disk error). The log says the session cannot be closed. The replacement is minted at the same supervisor revision. `worker:family:{old digest}` still equals that revision, so `current_service_tx` accepts the old bearer (`identity.rs:51-52`). A grandchild that inherited the environment, or any other copy of the token, can claim beside the new child until expiry or the next host process. Shutdown and reload are safer: reload moves the revision first, and the next process start runs `clear_child_session`.

Smallest fix: do not clear `child_expires_at` or `family` unless the DELETE commits. Keep every unrevoked digest and retry it on the next tick. Do not mint the replacement until the previous digest is revoked or its meta revision no longer matches.

**Medium. Every declared worker receives every secret.** `snapback4/crates/snapback4/src/worker_environment.rs:8-10`, injected at `dev_worker.rs:229-238`.

`values()` is the union of action, route, and effect secrets. The new supervisor passes that whole map to every `snapback/workers/<service>.*` process, plus that process's own token. A push worker whose effect declares one secret also sees the mail secret and every route secret. This was already true for the single conventional worker; the lane now multiplies it by every declared service. Those children do not need the union.

Smallest fix: pass only the secrets declared on the effects and actions that service's entry registers, or start from an empty secret set unless the worker file names them.

**Medium. A symlinked `snapback/workers` directory is followed, despite the comment.** `snapback4/crates/snapback4/src/worker_declarations.rs:28-43` (the follow is `read_dir` at `:33` and `from.exists()` at `:42`). Dev also follows a symlink file: `worker_declarations.rs:17` and `dev_worker.rs:152`.

`package` rejects a symlink *entry* (`:36`) but never `symlink_metadata`s the `workers` directory. `read_dir` follows a directory symlink, and regular files in the target are copied and served. `declared` uses `is_file()`, which follows a file symlink; `start_source` then canonicalizes it and can execute a path outside the tree, with a service token and the full secret map. `serve` after deploy refuses those file symlinks, but not the directory symlink.

Commit `snapback/workers` as a symlink to `node_modules/<untrusted>/workers`. Review of the app tree shows no worker source. `npm install && snapback4 deploy` copies whatever that package published, and `serve` starts it as a service. A file symlink is enough for `dev` to do the same without being packaged.

Smallest fix: reject the `workers` directory itself when `symlink_metadata` says it is a symlink, and in `declared` reject symlink files instead of using `is_file()`.

## 2. Supervision

The restart, signal, and zombie behavior on the tested path is sound, as described above. `SIGINT`/`SIGTERM`/`SIGHUP` set the stop flag when a worker exists (`lifecycle.rs:87-88`); the supervisor loop exits and `Drop` signals children. These are the gaps.

**Low. Mint and secret-load failures do not increase the backoff.** `dev_worker.rs:225` and `:232`, unlike the spawn-failure arm at `:244`.

While the store is busy, the supervisor retries the mint about every 250 ms for as long as it stays up. It does not fork on that path, so this is not a process storm. Double the backoff there too.

**Low. SIGKILL or an abort of the host orphans children with live tokens.** No `PR_SET_PDEATHSIG` or `setpgid` anywhere under `snapback4/crates/snapback4`. Fatal signals re-raise with no child cleanup (`lifecycle.rs:89-92`).

`kill -9` of `serve` leaves Node running. Those processes keep their tokens and keep claiming until the next host start reaches `clear_child_session` (`serve.rs:294`), or until the one-day session expires if nobody starts the host. Set the death signal before `exec`, or put each child in its own group and signal the group from a parent that still has a chance to run.

**Low. Stop is sequential, about two seconds per child that ignores SIGTERM.** `dev_worker.rs:279-285`, and `Drop` of the map runs one worker after another.

Ten stuck workers delay host exit by about twenty seconds. Signal them all, then wait once.

`dev --no-watch` is consistent with `serve`: a deleted worker keeps running until the process exits, and the next start revokes it. That is acceptable if the docs keep saying `serve` does not reload.

## 3. Ledger

A thrown handler, a lost acknowledgement after a successful commit, and a lease expiry of the same outbox row behave as claimed. Concurrent waiters that actually retry `SQLITE_BUSY` (primary code 5) do not both run the handler. These do not.

**Medium. `dev --fresh` / `--memory` writes the durable ledger beside the persistent store, and the key has no store id.** `dev_worker.rs:236-237`, `project.rs:71-73`, `serve.rs:287-289`, `runner.rs:570`, `worker.ts:182`.

`--fresh` opens a temporary engine store and does not take the host lock (`serve.rs:271-273`). The ledger path ignores that. It is `canonicalize(project.store_path()).parent().join("worker-ledger.sqlite")`, which is `.snapback4/worker-ledger.sqlite` even when `store.sqlite` does not exist. Completions are keyed only by `effect-{seq}-{index}`.

Run `dev` until `effect-…0001-…0000` is committed in the ledger. Delete `store.sqlite`, or run `dev --fresh`, so the new store starts its sequence again. The same id is treated as already completed (`worker-ledger.ts:31-32`) and the provider is not called. The other direction is the same bug: a fresh session records completions into the file the next real `dev` will use. Two fresh processes also share that file and can suppress each other. Moving or replacing the store without moving this file is the same collision. The guide says to keep the ledger with the store (`guide/effects.rs:77-78`) and does not say that `--fresh` writes the durable one.

Smallest fix: key or name the ledger by `store_id`. For a temporary engine, put the file in that temporary directory or refuse `ledger: true`.

**Medium. The SQLite write lock is held across the provider call, on one file shared by every opted-in worker.** `worker-ledger.ts:23-33`, path at `dev_worker.rs:237`.

`BEGIN IMMEDIATE` is taken before `await handler()` and released only at `COMMIT`. `busy_timeout` is 0; the other process spins in 25 ms sleeps. The comment at line 20 only yields the Node event loop. It does not drop the database lock. One `SNAPBACK_WORKER_LEDGER` serves every declared worker.

The push worker's `fetch` hangs (the guide example has no timeout). Digest's handler has already been claimed and is blocked in `run()` before its own provider call. The supervisor sees both processes alive, so backoff never applies. Lease expiry requeues digest, and the next claim blocks on the same lock. Every ledgered service stalls until the hung call returns or that process exits.

Smallest fix: read the completion in a short transaction, run the handler outside it, then `INSERT` if absent. That window is already the documented at-least-once case. Add a lock timeout that rolls back and fails the effect.

**Disk full and a corrupt file, from the code, not from a run.** A handler throw or an `INSERT` throw still rolls back when `ROLLBACK` succeeds, so a full disk does not record a completion (`worker-ledger.ts:39-41`). If `COMMIT` fails and `ROLLBACK` also fails, the connection stays inside the transaction. The next `BEGIN` is not primary code 5, so line 25 rethrows, and this process fails later ledgered effects while holding the writer lock until it exits. A committed row whose `result` is not JSON throws at `JSON.parse` after `COMMIT` (`worker-ledger.ts:32`); the row remains, the handler is not repeated, and settlement fails until attempts run out. Neither case is tested.

## 4. What should change before the claims are believed, and the test that would not catch it

Fix the forgotten family and the ledger's store identity before treating "revocation is correct" and "the ledger follows the store" as done. The symlink follow contradicts the comment in the same function. The cross-worker lock should be fixed or the shared-file contract should say that one hung provider stalls every other ledgered service.

The mutation that survives: in `worker-ledger.ts:25`, change `errcode !== 5` to `errcode !== 0` (or delete the retry). The two-process test still passes. Its fake server returns the effect on every `/claim`, and any other URL aborts the process (`supervised-workers.test.mjs:148-153`). The loser throws before the handler, aborts on the settle URL, and never appends to `actions`. The assertion only checks that file is one line (`:165`). Deleting `BEGIN IMMEDIATE` would still fail that test, because both handlers would run during the 200 ms overlap. The suite does not cover a symlinked `workers` directory, a failed `close_child_session`, `dev --fresh` against an existing ledger, a corrupt completion row, or disk full.

The lane's full `scripts/test.sh` was red once because the new awaits were missing from the delivery-await inventory. The report says only that inventory was updated and the single check was rerun. This review did not rerun it.

**Verdict: READY WITH CHANGES.**
