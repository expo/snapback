# Lane U round 13 — remembered pages survive local timer wakeups

For 0.4.3, on `sb4-intent/u-bounded-following`, after round-12 head
`e880cf39c`. Both round-12 reviews were read. Implementation/test commit:
**`30dd08cd5`**. No push or publication.

## Changes, file by file

| File | Change |
|---|---|
| `packages/snapback4/src/local-query.ts` | Records `localWakeup` from the final candidate's remembered origin. Leaves the attempt-zero consume/dirty behavior intact. Local and composed deadlines are never classified by whether a server deadline is absent. |
| `packages/snapback4/src/local.ts` | Passes wakeup provenance into `scheduleExpiry`, including timer rearming. A remembered local wakeup reruns without reset/notification. Actual local-row deadlines, server deadlines and session refusals still reset. Any future server cutoff stays armed during a slow local rerun. |
| `packages/snapback4/test/expiry-retry-watch.test.mjs` | Two new real-server cases, wasm and native process: publish remembered `true` before T, let its local timer fire, hold the next device reply, and require the original snapshot and notification count to remain unchanged. |
| `packages/snapback4/test/server-clock-regressions.test.mjs` | Five new controlled-clock cases: remembered wakeup with no server expiry; early timer rescheduling; simultaneous server expiry; future server expiry during a held rerun; and a composed page with a real local-row deadline but no server deadline. Allows held asynchronous device outcomes. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Extends the actual-server-expiry publication controls to the retry attempt, adding four cases that require withdrawal, cache deletion, and correct local wakeup handling. This closes Astra's Low test gap. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Documents timer wakeups, continued server expiry during reruns, and withdrawal at actual local/composed row deadlines. |
| `JOURNAL.md` | One dated, append-only round-13 entry with scope and verification. |
| `reports/20260926-bounded-following-r13/` | This report, compressed evidence and a mutation runner that restores both built modules in `finally`. |

No language form or public API was added. The existing `branch()` fixture:

```quarry
query branch():
  if exists audits['a1']:
    return true
  if exists permits['permit']:
    return false
  return true
```

`audits` is `online only`. The server remembers `true` without an expiry;
the synced permit gives the device's speculative branch a local deadline T.
The new real tests publish memory at T−100, advance issued time to T, and hold
the timer's device reobservation. There is no extra notification or loading
snapshot. Releasing the device reply publishes remembered `true` again. No
sync or additional server request rescues the watch.

## Procedure and test coverage

- **Rule 1:** the existing session/incarnation publication checks remain;
  the timer retains its refusal reset. Existing sign-out and close cases run
  in the affected/full suites.
- **Rules 2–4:** known local results, engine withholding, prediction routing,
  placeholder recovery and composition are unchanged. Existing retained-history,
  branch, prediction and authoritative-refusal controls remain green.
- **Rule 5:** final publication records the candidate's origin explicitly.
  A local wakeup already due still clears and dirties the watch on attempt
  zero. A future one reaches scheduling as a wakeup and does not erase memory.
  Timer rearming preserves that fact. A server expiry due simultaneously or
  during the held reobservation still withdraws the page. Composed data with
  a real local deadline and `serverExpiry: null` must also be withdrawn.
- **Astra's retry control:** a first local result expires; its speculative
  retry recovers memory; server time crosses the memory deadline in the final
  `queued()` await. Both query/watch variants, with due/future local wakeups,
  reject the private answer and delete its cache entry.

## Verification

Frozen Bun installation and package build passed. Affected suite:
**281 passed, 0 failed, 0 skipped**, 56.728 seconds ([evidence](affected.log.gz)).
After strengthening the early-timer setup, all **19 clock controls passed**
in 0.524 seconds ([evidence](clock-controls.log.gz)). The full suite below
includes that final setup.

Five deliberate mutations were rejected:

| Mutation | Failing tests |
|---|---:|
| Reset remembered data before the wakeup rerun | 5 (simultaneous-expiry control passed) |
| Infer a wakeup from missing server expiry | 1 (composed local-row deadline) |
| Disarm the server cutoff during the local rerun | 1 |
| Lose wakeup provenance when an early timer rearms | 1 |
| Skip remembered server-expiry enforcement after a local retry | 4 (four initial-attempt controls passed) |

[Runner](mutations.py), [summary](mutations.log), and compressed assertion logs
are included. The runner restored both built modules before the full suite.

Full-suite command, from `snapback4/`, with unchanged integration settings:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
CARGO_BUILD_JOBS=16 SNAPBACK4_RUST_TEST_PROCESSES=8 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=0 SNAPBACK4_SESSION_SEQUENCES=5000 SNAPBACK4_ONLINE_SEQUENCES=3000 bash scripts/test.sh
```

One full `scripts/test.sh`, exit **0**:

```text
== 0 failure(s) in 626 s
```

[Full evidence](test.log.gz): Rust **3,196 passed**, 19 existing ignored,
zero failed (177 s); clients, including acquisition/server shards,
**2,027 passed**, ten existing skips, zero failures/cancellations (193 s);
models **78 passed**, zero failures/skips (242 s), with unchanged
**5,000 / 5,000 / 3,000** sequences. Every build, documentation, release,
fixture and typecheck stage passed. **Full-suite failures: none — ours,
baseline or environmental.** No waiver or repeat full run was needed.

Wasm remains **1,850,576 B raw / 521,814 B gzip**, within its unchanged
**522,000 B** budget. Changed source/test files are 287, 1,431, 294, 813 and
316 lines; all remain under 1,500. [Reference check](ref.log.gz) passed:
509 LLP documents, 9,339 references in 26,527 files, zero errors and zero
unchecked references. The staged diff check also passed.

## Decisions, limitations and failure accounting

No design deviation. Keeping the future server cutoff armed is necessary when
the local timer fires at T1 and a slow rerun lasts past the memory's authorization
deadline T2. Consuming only the local timer must not disarm that cutoff.
No authorization, disclosure, durability, runtime meter, model count, timeout,
package version or acquisition behavior changed. No acquisition remeasurement.

No unmodified product test failed during development. One optional mutation
initially survived: the attempted wall-clock rollback did not actually fire
the timer early. The test now deliberately arms the first timer before its
real deadline, verifies that early callback does not reobserve, then checks
the rearmed callback. The mutation now fails. This was an owned test-strength
issue; mutation failures themselves are expected negative controls.

The supplied baseline tail is `== 1 failure(s) in 276 s` (`cargo test`). No
baseline exemption is requested. The separate
[whole-page row-expiry issue](../../../issues/20260925-snapback4-remembered-answer-row-expiry.md)
remains deferred: an offline remembered page containing a permanent message
and an expiring typing row is withdrawn entirely at the typing deadline.
Engine per-row expiry facts and later design remain necessary. No new scoped
open problem is known.
