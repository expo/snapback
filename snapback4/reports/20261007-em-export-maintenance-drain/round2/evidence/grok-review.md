I'll review the EM drain-timeout change on this checkout only: read the report, tickets, and LLP 3000.030 §15, then audit the diff and run the named tests before giving a verdict.The checkout is already at `7775413989`. Next I’ll read the report, the three tickets, and LLP 3000.030 §15, then inspect the commit range.The report claims diagnostics-only tracing and an unchanged 90-second drain check. I’ll read the retention change and §15 next, then audit wakeup paths against the code rather than the report.The debug build is running. While it compiles, I’ll check the retained archives for secrets and confirm the helper’s capture bounds.Auto-compacting conversation (80% full)...
Conversation compacted.
The serial export-background run finished with exit code 0. I'll read that log, then run the negative controls and the witness retention tests before writing the verdict.The serial suite passed: 58 tests, 36 Darwin skips, no failures, and no drain-timeout snapshots. Next I’ll run the negative controls on CPUs 80–83, writing their output under the scratch directory.The negative controls finished in about three minutes. I’ll confirm both stalls failed the original 90-second check and left distinguishable snapshots, then run the retention unit tests.**Verdict: READY WITH CHANGES**

The diagnostics in `7775413989` are safe to keep, and the 90-second drain check is as strong as before. The audit text is not. `kick_until` can still return success while holding `maintenance-next.lock` and then exit, so a concurrent `request()` + `kick()` coalesces and leaves queued maintenance with no observer. That path is pre-existing, it was not reproduced here, and it must not be written up as closed. Tickets stay open. No lane files were edited and nothing was pushed. Host was `expose-builder-pixel`.

## What ran

| Check | Result |
| --- | --- |
| `run-client-tests.mjs 1 files` `export-background.test.mjs` | exit 0, 309.98 s. **94 tests, 58 pass, 36 Darwin skips, 0 fail.** No drain-timeout snapshot. |
| `negative.py` (output under the scratch dir, CPUs 80–83) | wrapper exit 0; node exit 1; 182.41 s. Exactly two `coalesced maintenance queue drained` errors and two `*-drain-timeout` snapshots. The temporary test copy was removed. |
| `cargo test -p snapback4 --bin snapback4 verbs::witness::retention::tests` | exit 0, 89 s. **2 passed, 0 failed** (330 other lib tests filtered out). |

Counts and the two snapshot shapes are in `reviews/em-r1.grok.evidence/NOTES.md`. `snapback4/target` is 6.6 GB. One earlier `node --test` of the same file was invalid: gitignored `dist/resolve-binary.js` was missing, so those failures were `ERR_MODULE_NOT_FOUND` in about 120 ms, not drain timeouts. The official runner above is the one that counts.

## 1. `retention.rs` is diagnostics-only

The +38 lines add `trace()` and call sites only. The write is inside `debug_assertions` and only if `SNAPBACK4_DEBUG_RETENTION` is set. IO errors are ignored. Release builds compile the write out. `json!` / `record.clone()` at the call sites still run in release; they do not change queue, lease, or retention decisions.

When the flag is on, `observer-launched` appends before `drop(queued)`, and `wait-retention` appends before `drop(active)`. A slow append lengthens a hold that already existed. It does not take the initialization or publication leases (`ready` traces only after `try_lock` has failed). The export-background suite and both retention unit tests passed with the flag forced on by `watchMaintenance`. No new failure mode showed up.

## 2. Diagnostics are enough on Linux, not quite on Darwin

On this host the two injected stalls are distinguishable, and the snapshots survived cleanup:

- **Held lease.** Pending request, live observer with fd 3 on `maintenance-next.lock`, the Python holder with an exclusive flock on `retention.lock`, 898 `wait-retention` lines.
- **Missing observer.** Pending request, `maintenance-next.json` still naming a pid, empty process list, empty lock list, trace stopping after a single `wait-retention` with no later `observer-launched`. Cleanup then drained (`maintenance-result.json` error null).

Bounds and publication: the whole negative-control snapshot tree was 182 KB. Copies are limited to `.json/.jsonl/.log/.lock/.tmp` under `artifacts/native-smoke` (not bundles). There is no hard byte cap; a 60-minute observer at the 100 ms wait cadence is a few MB, which is acceptable. No environment dump. The trace name is `retention-trace.jsonl`, and the crash matrix’s `maintenance-*` inventory ignores it (those cases passed). The npm package publishes `dist/`, `bin/`, and READMEs; the crate is `publish = false`. The trace is not a published artifact. Capture errors are logged and do not replace the assertion. The 110 s timer is cleared in cleanup; this suite never fired it.

Darwin is the hole. `lsof` in `maintenance-evidence.mjs` has no `maxBuffer`. Node’s 1 MB default throws `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` before `snapshot.json` is written, and the catch reports the error without the directory path. `ps` is explicitly capped at 8 MB. The report’s “bounded lsof” sentence does not match the code. The outstanding soak, and `mac-run7.log.gz`, are macOS.

## 3. The drain check is unchanged

`maintenanceIdle` still requires the request, claim, and parked files to be gone (unless `allowParked`) and the next/active pids to be dead, with the same 90_000 ms bound. `observedMaintenance` only records timing and, on failure, snapshots and rethrows. A synchronous snapshot can only delay the poll, which makes the check stricter, not weaker. Both negative controls still fail that exact assertion, then the owned fixtures drain.

## 4. Wakeup audit

Lease lifetime is sound. `spawn_owned` shares the lock via `dup2` to fd 3; `inherited` sets `CLOEXEC` before any grandchild is spawned; the parent drops its descriptor after the record write. A dead owner releases `flock`. Nothing here lets a maintenance lease outlive its process beyond the existing fork-before-exec window.

Deadlines are the ones already specified: 30 s monotonic work, WD cleanup extra, observer `SIGKILL` of the direct child at 100 s and error at 105 s, 60-minute wall `expires` plus a monotonic budget. Linux `sleep_clock` is 0, so suspend is caught by the wall clock. `kick_until`’s expiry string says “parked” but does not rename to `maintenance-parked.json`; the request stays runnable for the next export. That is pre-existing and is the safer outcome. The wrapper’s 5 s preflight kill can still enter the documented interrupted-launch case. Not a new bug.

The ordinary exit/request story in the report is true for the common case: the observer drops `maintenance-next.lock` before `kick_until`, and a request that is visible to that recheck, or that arrives after the lock is released, gets an observer.

It is not true for this return:

```126:136:snapback4/crates/snapback4/src/verbs/witness/retention.rs
fn kick_until(root: &Path, expires: u128) -> Result<Value> {
    if !runnable(root) { return Ok(Value::Null); }
    // ...
    let queued = lock_file(root, "maintenance-next.lock")?;
    if !try_lock(&queued)? {
        trace(root, "kick-coalesced", Value::Null);
        return Ok(recovery::read(&root.join("maintenance-next.json")));
    }
    if !runnable(root) { return Ok(Value::Null); }
```

Line 127 does not hold the lock. Line 136 does, until `queued` is dropped on return. Coalesce treats “lock is busy” as “a holder will keep observing” and returns `Ok` immediately. A holder that has just decided `!runnable` will not spawn and will not loop. A producer that finishes `request()` and loses `try_lock` in that window — a preemption between the stat and the `flock` unlock is enough — leaves a pending request and no observer. The same shape exists if `observation_guard` fails at the top of the maintain loop (`?` while `queued` is still in scope): the observer unwinds without `kick_until`, and a concurrent `kick()` can coalesce against a process that is exiting.

That is not one of the documented next-export cases. Those are cancellation, sleep, expiry, launch or record errors, exhausted retries, parked worker errors, and loss of both peers. This return is success. I am not saying it caused the three historical timeouts; those still have no snapshot. The new traces would show it: `kick-coalesced`, then `observer-idle` or process exit, a pending request, and no later `observer-launched`.

## Required before this record is the audit

1. Remove “no ordinary lost-wakeup path” and “the exit/request recheck is intact” from `REPORT.md` (opening and the exit/request row), `JOURNAL.md` (the 2026-10-07 EM entry), and the three ticket addenda. State the line 136 window, and the guard-unwind window, as open suspects. Do not assign them the historical incidents. LLP §15 does not make the false claim; it correctly says the failures stay unclassified and no queue-policy correction is claimed.
2. On Darwin, do not let `lsof` abort the snapshot. Cap or record its failure, and always write `snapshot.json` and the directory path. Correct “bounded lsof” in the report.

A product fix is recommended and was not this lane’s contract: while the lock is held, `!runnable` should drop it and retry, not return `Ok`. Coalesce only when the holder will keep running. That needs its own regression; it should not be slipped into this diagnostics diff.

The 110 s timer can block the event loop and steal time from `until` and the 120 s test guard. Measured drains are well under 5 s, and this run did not hit it. Low severity, not a condition of the verdict.
