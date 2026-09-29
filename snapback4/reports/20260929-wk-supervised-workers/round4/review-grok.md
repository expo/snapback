I'll review the supervised-workers change read-only: first the lane prompt, round reports, and the diff, then I'll check that every earlier finding is covered by a detecting test and whether the ledger race is real.The review skill's GitHub workflow doesn't apply here — this is a read-only lane review of a fixed commit range. I'll pull the diff, prior-round findings, and the ledger ticket next.Round 3 says the earlier holes are closed and leaves one unexplained double action. I'll read the ledger, supervisor, and the tests that are supposed to detect those holes.The refresh path and the ledger lock are the two places a previous fix could still be wrong. I'll check the recorded test log and probe SQLite's lock across the provider call.Auto-compacting conversation (81% full)...
Conversation compacted.
The lock-across-await result is already in hand. I’ll finish the two-writer contention check, confirm the exact lines for the remaining findings, and then write the review.Astra’s review claims a commit-busy duplicate. I’ll reproduce that on a copy, and check whether a release snapshot still misses schema-local packages.Commit contention is real: thousands of `COMMIT`s returned “database is locked” against a second `BEGIN IMMEDIATE`. I’ll confirm the actual ledger then runs the provider call a second time.The cross-process lock holds only until `COMMIT`. A recoverable `SQLITE_BUSY` on that commit is rolled back after the provider has already run, so a second process performs the same action. That is enough to block landing.

## Prior findings

All of these are fixed in the current tree (`ba2dcd0cb`). I did not rebuild or rerun the suite: `target/debug/snapback4` and `packages/snapback4/dist` are absent. The detectors below are in the tree, and `round3/affected-qualified.log.gz` records them passing (`pass 102` / `fail 0`).

| Earlier finding | Why it is fixed | Detecting test |
|---|---|---|
| Failed revocation left the old token usable | The family is kept until `DELETE` commits, and mint is refused meanwhile (`dev_worker.rs:270-273`, `:354-375`) | `failed revocation blocks restart until the retired bearer is refused` (`worker-regressions.test.mjs:328`) |
| Deploy followed a symlink at the workers root | `openat` uses `O_NOFOLLOW` (`worker_declarations.rs:9`); a non-regular file fails the walk (`:68`) | `worker snapshot refuses schema/root/entry/helper/fifo escapes` (`:364`) |
| `--fresh` suppressed effects through the persistent ledger | The ledger sits beside the canonical store and is named by `store_id` (`dev_worker.rs:200-206`). `--fresh` uses a private temp store (`serve.rs:286-289`) | `fresh stores and replacement stores cannot replay another store completion` (`:399`) |
| Workers and descendants outlived the server | The watchdog owns the Node process group, sends `SIGTERM`, then `SIGKILL` after 2s (`worker_process.rs:63-69`). Host `SIGKILL` closes the pipe | `${death} stops worker descendants` (`:423`); `watchdog SIGTERM/SIGINT/SIGHUP` (`:298`) |
| Broken ledger initialization consumed attempts | The ledger is opened and validated before any claim (`worker.ts:289-298`). Failure reports once and waits for abort | `ledger corrupt/schema/receipt/parent-file initialization reports once without claiming or settling` (`:437`) |
| Every named worker received every secret | Named entries opt in with `// snapback4 secrets:` | `named workers receive only entry-named declared secrets, defaulting to none` (`:459`) |
| Mint and secret failures retried at a flat 250 ms | `retry_later` doubles up to 5s (`dev_worker.rs:342-344`) | `repeated secret admission failures increase restart backoff` (`:487`) |
| Shutdown was one worker after another | Every stdin pipe is closed before any wait (`dev_worker.rs:127-130`) | `shutdown starts every worker grace period together` (`:473`) |
| Removing a worker forgot a failed revocation, so the bearer still answered `/q` | A retiring worker stays owned while deletion is pending (`dev_worker.rs:107`). Dev adoption bumps `worker_revision` (`serve_adoption.rs:220`). The fence rejects the family (`identity.rs:50-60`) on `/q`, `/m`, and `/auth/refresh` before the auth body (`serve.rs:935-942`) | `removed worker retains query fence / retirement custody while deletion is locked` (`:175`) |
| Restart executed a symlink discovery had rejected | Every launch recopies through the no-follow snapshot and returns before mint on failure (`dev_worker.rs:276-291`) | `restart refuses an entry symlink already rejected by discovery` (`:211`); `launch executes validated entry and helper bytes` (`:229`) |
| Watchdog death left Node beside the replacement | A signal exit `SIGKILL`s the retained group (`dev_worker.rs:384-398`) | `watchdog SIGKILL terminates its Node group before replacement` (`:248`) |
| `/auth/refresh` minted a bearer the redactor had never seen | Supervised families get HTTP 403 `E_WORKER_REFRESH` and no successor (`auth.rs:243-261`, response `:128-130`). A manual seat with the same name still refreshes | `supervised workers/push.mjs` and `supervised worker.mjs` refuse refresh without logging a bearer across split writes (`:56`) |
| Automatic `snapback/worker.*` executed a symlink | `Snapshot::automatic` copies the schema tree with the same no-follow walk (`worker_declarations.rs:121-142`) | `automatic worker.mjs refuses a symlink` (`:128`); restart (`:141`); validated bytes after replacement (`:156`) |

The round-2 schema-local package fix is only half done. It is the Medium finding below. The round-1 `PRAGMA synchronous = FULL` mutation still survives; on this runtime it is not a behavior change. See test strength.

## High — a busy commit drops a finished provider call, and the other process repeats it

`snapback4/packages/snapback4/src/worker-ledger.ts:62` and the rollback at `:65`. The handler transaction starts at `:46` (`BEGIN IMMEDIATE`). `busy_timeout` is 0 (`:30`).

`BEGIN IMMEDIATE` takes a reserved lock, which still allows shared locks. `COMMIT` has to upgrade to exclusive. With `busy_timeout = 0`, a shared lock makes `COMMIT` throw `SQLITE_BUSY` (`errcode` 5). SQLite leaves that transaction open. The `catch` rolls it back anyway, closes the database, and throws `LedgerUnavailable`. No completion row is written. The peer’s next `BEGIN IMMEDIATE` does not see a receipt and runs the handler.

Reproduced on Node 24.13.1 against this `WorkerLedger`, on disposable copies:

- A second connection spamming `BEGIN IMMEDIATE` / `ROLLBACK` for 2 seconds, no third reader and no WAL: 52 commits kept, 30 lost with `database is locked` after the handler had already run. Of 20 sampled lost keys, all 20 ran the handler again later (`calls` 102 = 52 + 30 + 20).
- A deferred reader (`BEGIN` + `SELECT`) held across `COMMIT`: the first `WorkerLedger.run` throws `worker ledger unavailable; polling stopped: database is locked` after its handler, and a second `WorkerLedger` performs the same key. One row, two actions.
- The same spam against `BEGIN EXCLUSIVE`: 4595 commits, 10650 busy begins, **0** busy commits.
- After a busy `COMMIT`, releasing the reader and issuing `COMMIT` again (no rollback) kept the row. The handler does not need to run twice.

Journal mode is `delete`. Checkpointing is not involved. The two handlers do not overlap: the second starts only after the first transaction is gone. Forty trials of two `WorkerLedger` processes with a 40 ms handler and the real 25 ms retry (`:49`) produced no duplicate. That matches the ticket. The peer sleeps 25 ms, so the window is small, and `onError() {}` at `supervised-workers.test.mjs:161` hides the storage error. The actions file still grows by one `performed` line. One suite failure, then twenty quiet reruns, is what that looks like.

This sits in the documented provider-call/commit window (`guide/effects.rs:110-117`): the external call has returned and the receipt is not durable. It is not the crash the guide describes. The other worker’s own `BEGIN IMMEDIATE`, which is how this ledger waits, is enough. The comment at `worker-ledger.ts:8-10` says the other process cannot perform the same key. That is false once this rollback runs. The serialization guarantee does not hold.

**Scenario.** `push` and `digest` share `worker-ledger-<store_id>.sqlite`. `push` is inside a provider call. `digest` retries `BEGIN IMMEDIATE` every 25 ms. One of those attempts still holds a shared lock when `push` commits. `push` rolls the receipt back and stops polling. The effect’s lease expires. `digest`, or a restarted `push`, performs the provider call again.

**Smallest fix.** Change the handler transaction at `worker-ledger.ts:46` from `BEGIN IMMEDIATE` to `BEGIN EXCLUSIVE`, and keep the existing busy retry. Contention then fails before the provider call. Leave the constructor’s short `BEGIN IMMEDIATE` (`:31`) as it is; a busy failure there retries `open` and does not call the provider. Retrying a busy `COMMIT` without `ROLLBACK` also preserves the row, but the one-word change is smaller and is the one measured at zero busy commits.

Do not weaken `two standalone processes sharing a ledger perform one action` (`supervised-workers.test.mjs:132`). Add a deterministic case: hold a deferred read, or spin `BEGIN IMMEDIATE`, across the commit, and require one handler call.

## Medium — serve still does not use schema-local packages

`snapback4/crates/snapback4/src/worker_declarations.rs:169`. Deploy copies schema sources and does not copy `snapback/node_modules` (`verbs/releases.rs:102-106`). `serve`’s project root is `releases/<n>` (`serve.rs:144`). `scope()` links only `<that root>/snapback/node_modules`.

Dev’s root is the app, so the new link is the right one. The qualified log’s `private worker snapshot resolves schema-local packages` tests (`worker-regressions.test.mjs:94`) call `dev` only.

**Scenario.** `schema-package` is `schema` under `<app>/snapback/node_modules` and `project` under `<app>/node_modules`. Dev loads `schema`. `snapback4 deploy <app>/release` then `serve` loads `project`, because the release has no `snapback/node_modules` and the app is only an ancestor `node_modules` link. I applied the same link rules on a copy and Node printed `schema` for the app root and `project` for `release/releases/1`. Installing the package inside the release itself prints `release-local`, but the next release number does not have that directory. The guide states this precedence for supervised workers generally (`guide/effects.rs:63-64`).

An untrusted package cannot become a worker entry: discovery is one regular `snapback/workers/<service>.{mjs,mts,ts}` copied with `O_NOFOLLOW`. It can be the module that entry imports, and on serve that can be the project-root copy rather than the schema pin.

**Smallest fix.** In `scope()`, point `stage/snapback/node_modules` at the nearest ancestor of the project root, including itself, that actually contains `snapback/node_modules`. Add a `serve` test that deploys a shadowed schema-local package and asserts the worker got the schema copy.

## What is sound

**Tokens.** The supervised token is injected on the watchdog’s cleared environment and redacted on stdout and stderr, including across chunk boundaries (`worker_environment.rs:67-100`). Doctor status has name, source, mode, state, counters, and pid, not the token (`dev_worker.rs:347`). The Node version probe does not receive it. Refresh cannot mint an unredacted successor. A retired family is 401 at `principal_of` while deletion is locked, not the auth module’s later 200. Failed close does not mint a second seat. Startup `clear_child_session` is fatal if it fails (`serve.rs:294`). Deploy snapshots copy worker source, not the environment.

**Supervision.** `dev` and `serve` share `Supervisor`. Restart backoff is 250 ms to 5 s and resets after 30 s of life. A new declaration that failed admission is retried without another edit. Watchdog `SIGTERM`/`SIGINT`/`SIGHUP` still reap the group. Workers do not bind ports. One ledger file per store is intentional: one hung provider stalls every opted-in handler on that file, and the guide says so (`effects.rs:104-109`).

**Ledger, apart from the busy commit.** A thrown handler rolls back and is not stored (`worker-ledger.ts:57-58`). Corrupt receipts, a wrong table, disk full, and a commit that then fails rollback close the file and do not settle the claim as a handler failure (`worker.ts:190-193`; tests at `:513`). `--fresh` and a replaced store do not reuse completions. `meta.idempotencyKey` is `effect.id` (`worker.ts:180`). That id is `effect-{seq}-{outbox index}` assigned once at emit (`engine/runner.rs:570`), and this diff does not change that file. Lease expiry and restart redeliver the same id. The ledger does not suppress a delivery that failed; the bug above repeats one that succeeded.

**Retained, not new.** The watchdog fallback can `SIGKILL` a reused pid if Node was already reaped (`issues/20260929-snapback4-watchdog-fallback-group-identity.md`). A ledger init failure leaves the child alive and doctor saying `running` while it claims nothing (`worker.ts:293-298`). `NODE_OPTIONS` is copied into the token-bearing child (`dev_worker.rs:447`). On `serve`, a failed rotation close leaves the old bearer usable until `DELETE` commits, because `worker_revision` stays 0; a replacement is still not minted. None of these reintroduce a second live token.

## Test strength

Deleting `PRAGMA synchronous = FULL` at `worker-ledger.ts:30` still passes `ledger commits with FULL synchronization and durable journaling` (`worker-regressions.test.mjs:261`). That test reads `PRAGMA synchronous` and expects `2`. A fresh `node:sqlite` database on Node 24.13.1 already returns `2` and `journal_mode=delete`. Setting the pragma to `OFF` is killed. Deleting it is not.

Deleting `signal.throwIfAborted()` at `worker-ledger.ts:45` is also uncovered: nothing aborts a waiter blocked on `SQLITE_BUSY`. I did not execute that mutant.

## Verdict

**NOT READY.** Credential retirement, refresh refusal, snapshot custody, and process-group shutdown hold, and the earlier highs and mediums are fixed except serve’s schema-local lookup. The ledger’s cross-process guarantee does not: ordinary `BEGIN IMMEDIATE` contention makes `COMMIT` fail, the code discards a transaction SQLite would retry, and the other process repeats the provider call.
