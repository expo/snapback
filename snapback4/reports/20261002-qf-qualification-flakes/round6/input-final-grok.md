I'll review lane QF as one change from `850fea9957` to `4291d06dee`, starting with the review skill, the lane report, and the diff. No files will be changed and nothing will be pushed.This is a lane audit, not a generic branch review: I'll read the report and the commit range, then check each claim against the code and the recorded runs. No files will be changed.The lane is six commits, mostly the suite runner plus a large evidence bundle. I'll read the report's claims and the runner source next, and keep the review read-only.Auto-compacting conversation (81% full)...
Conversation compacted.
The Darwin helper’s two-second budget is the remaining check that could change the verdict. I’ll time it on the Apartment mini against a browser-sized process set, then write the review.**READY.** Lane QF (`850fea9957` exclusive through `4291d06dee`, clean tree at `4291d06dee`) does what the operator ruled: a file cannot pass while a process it still owns is alive, except the stated escape, and it does not signal a process it cannot prove is its own. The recorded Linux and Apartment-mini runs match the claims. Nothing here is a custody hole of the round 0–1 kind.

## Claims

| Claim | Check |
|---|---|
| Linux focused: 42 passed, 6 skipped | `round4/linux-focused.log` ends `-- client files: 2/2; failed 0; tests {"tests":48,"pass":42,"fail":0,"skipped":6}`. Exit file is `0`. The 6 skips are the Darwin-only helper-fault tests (`skip: process.platform !== 'darwin'`). |
| Mini 48/48 | `round4/mini-focused.log` on `MacMini-Apt101-M5-A` (Darwin arm64, Node v24.18.0) ends `{"tests":48,"pass":48,"fail":0,"skipped":0}`. Exit file is `0`. `mini-cleanup.log` says `task-scratch-removed`. The two files run one after the other, so that invocation was serial. |
| Flaky tests 200/200 and 2,031/2,031 background, 0 refusals | Recount of `round4/stress-runs.jsonl.gz`: 2,431 rows, all `passed: true`, exit code 0, signal null, `counts.fail` 0. `worker` 200 rows with exactly 1 test; `replacement` 200 rows with exactly 2; `load` 2,031 rows, 283 files. No empty results. The 56 rows that are not all-passing are pre-existing skips (Expo, identity, schema-capabilities, and the 6 Darwin skips inside `test-file-runner`), not runner refusals. |
| Full suite 0 failures in 1,510 s | Decompressed `round4/full-suite.log.gz` SHA-256 is `6181560c5dd093eab007c45de60ad3609af9941e6027789dd93a176efbd12793`, matching `full-suite-summary.json`. Footer is `== 0 failure(s) in 1510 s`. Zero `not ok` lines and zero `-- client file FAIL`. Pools: fixtures 9/9, client files 283/283 (5,843 tests, 16 skips, 0 fail), models 79/79. |

These are checks of the recorded artifacts, not a re-run. The suite log shows `-- available CPUs: 96; client file concurrency: 24`, so that run is not the serial publication dry run.

## Custody

A passing file requires exit code 0 and no hang, leak, spawn error, or inspection failure (`run-client-tests.mjs`). Cleanup SIGKILLs the keeper’s process group before the first verification snapshot, then individually kills registered detached children after a start-time check, then requires two empty snapshots 50 ms apart inside 5 s. Any live member seen in that window is `TEST_FILE_LEAK` even if it later exits. Zombies are not live.

That closes the earlier holes, and the focused logs show the tests that lock it in: the setsid orphan is reaped (`ok 12` on both Linux and the mini), the double-forked shell orphan is reaped, and the unsampled child forked after a stale `ps` snapshot is gone before the file returns. A vanished PID is treated as exited (`identity` returns undefined on ESRCH, and the “enumerated group member has exited” test passes). A whole `ps` failure, timeout, or empty table throws `TEST_PROCESS_INSPECTION` and cannot be a pass.

The residual is the one the explainer states at `llp/3000-snapback4.explainer.md` (“Publication suite under contention”): an escaped process, new session or group and no longer in the owned ancestry, whose environment is unreadable or redacted, or which no longer carries the token. The mini log shows it narrowly for `/bin/sleep`: `TEST_PROCESS_UNREADABLE` with `environment unavailable or empty`, the runner test expects the file to pass while that sleep is still alive, and the fixture then reaps its own child. On Linux the same shape is a readable token and `ok 26` asserts `TEST_FILE_LEAK`. Same-session `setpgid` with a cleared token stays session-owned. One unreadable candidate is a diagnostic, not a refusal: the mini log also skips an `sshd-session` that way, and the file still passes. The Linux suite summary records 14 such diagnostics and zero failed files.

The wording is a little narrower than the code.

- A child that never inherited the token (`env` replacement, not a later delete) has the same outcome as “removed its token.”
- A different-uid process is never token-inspected. Inside the keeper group that fails the file (the group kill or the leftover member). Outside the group it can still be alive on a pass, with no diagnostic.
- Darwin treats an empty environment as redaction, which is the right outcome for restricted binaries and also covers a genuinely empty environment.

None of those are a pass while a readable, same-uid, token-bearing escape is alive. Orphans reparented to PID 1 stay candidates, because PID 1 is on the runner’s ancestor chain; the setsid test is that case.

Signaling matches the ruling. The group signal is `kill(-keeper.pid)` only while that pid’s start identity is the keeper’s. Registered detaches and token matches are start-checked. An unreadable or redacted candidate is not signaled. A 256-bit token is not something another session has. Another user’s processes are excluded by uid. Another session’s pre-launch process tree is excluded because its parent chain hits a baseline process that is not an ancestor, and a still-live pre-launch session is skipped because POSIX cannot join one. I did not find a path that signals a process the runner cannot prove is its own.

## Watchdog

The clock is synchronous `test:dequeue` and `test:complete` over IPC, not TAP or console. Each event resets the timer. There is no absolute file ceiling. The bound is `max(15 min, largest single guard + max(60 s, 25%))`, and serial mode does not change it.

The committed round-2 census (`round2/guards.json`, 286 files) matches `largestGuard` exactly, including search 8,592 s, admission 6,832 s, horizon, and the others over 12 minutes. No census file has a single guard the floor or the map would under-cover. `retained-history`’s largest guard is one `hangBudget(126)` of 372 s, so the 15-minute floor covers that subtest, and each later subtest resets the timer. The focused tests that a progressing file survives past the stall, and that console chatter does not, are `ok` on both hosts. A hang diagnostic names the file, elapsed time, stall bound, idle interval, last progress event, the last 16 KiB, and the owned processes, then kills the group.

I did not re-execute the TypeScript census. This lane does not edit timeout declarations outside `web-admission-review`, `worker-regressions`, the new runner tests, and the replacement helper.

## Assertions and pass/fail

The only removed assertion line in the lane diff is the admission replacement pair `assert.ok(heads.every(head => head.ok === true))` and `assert.notEqual` on `store_id`. Both now live in `helpers/replacement-server.mjs` and still run: all 10 `replacementFor` call sites await it. The copy also gained a 5 s busy deadline and closes the server if setup throws. Worker changes add checks: HTTP `/auth/config` must return 200 before the test proceeds, the repaired-Node test asserts `declaration will retry`, and a new test asserts a printed URL is not completed admission. The new `skip` is only the six Darwin helper-fault cases.

Pass/fail for product assertions is otherwise unchanged. New failures are hang, leak, and inspection failure. One extra semantic change: the worker fixture’s `t.after` now SIGKILLs the server after 5 s if SIGTERM does not exit it, and SIGKILLs recorded worker and helper pids. A server that ignores SIGTERM no longer hangs teardown until the file watchdog; the body can pass. That is cleanup escalation, not a deleted assertion.

## macOS, as the dry run uses it

`SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1` leaves concurrency at 1. Models are already `run-client-tests.mjs 1`. Stall bounds do not change. The mini focused run was serial and 48/48, including the setsid reap and the `/bin/sleep` redaction pass. The Linux suite does not stand in for that: it ran 24-wide.

## Findings

1. **Low.** The published limitation should also say “never inherited the token” and “runs as another uid and has left the group.” Same outcome as the stated escape, but the sentence as written does not cover them.
2. **Low.** Worker-fixture teardown can turn a server that ignores SIGTERM into a pass after 5 s. Product assertions are intact.
3. **Low.** The runner never checks that the detached keeper’s session and group are its own pid. A failed `setsid` would leave the tree in a pre-existing session, which the sweep then skips, and `kill(-keeper.pid)` can miss it. Not observed. Normal detached spawn is what the setsid tests already reap.

## Open

- **Darwin helper budget on a loaded MacBook.** Every same-uid process that appeared since the file started, and whose parent chain reaches the runner or PID 1 before a pre-launch non-ancestor, is passed to one `KERN_PROCARGS2` helper with a single 2 s timeout. Pre-existing sessions are dropped only after that read. A timeout is `TEST_PROCESS_INSPECTION` and fails the file. That is the mandated fail-closed path, not a mis-labeled leak. I could not time it: SSH to `ccheever@100.64.36.16` was blocked in this session, and the office M5 is out of scope. The mini log only shows a handful of candidates. If a publication dry run reports `environment helper failed (ETIMEDOUT)` on a file that is otherwise progressing, reopen this verdict.
- The TypeScript guard census was not re-parsed. The committed 286-file census matches the current stall function, and this lane did not change other files’ guards.
- The published binary hash is not in the tree, so it was not re-checked. The suite and stress logs are the runs as recorded.
