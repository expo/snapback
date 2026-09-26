# Lane U round 12 — remembered validity and local wakeups (for 0.4.3)

Both round-11 reviews were read. This change follows round-11 head `d5c2f6d20`
on `sb4-intent/u-bounded-following`, already based on integrated main
`05382d59f`. Implementation and test commit: **`22d665202`**. No push or
publication.

## Changes, file by file

| File | Change |
|---|---|
| `packages/snapback4/src/local-query.ts` | At final publication, a remembered candidate's local deadline is a wakeup, not its validity limit. A due local wakeup sets `watch.dirty` on either attempt and is cleared before returning. Only the remembered candidate's server deadline can expire its data. Future local wakeups survive, including when expired memory is withdrawn. The five numbered rules remain. |
| `packages/snapback4/test/expiry-retry-watch.test.mjs` | Six new real-device cases: Astra's remembered `branch()` as a query and watch, plus watched retry server pagination, each on wasm and native process devices. The page test captures the first data notification and follows its cursor. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Sixteen cases cross the local deadline after recovery, at the final publication fence; four cases instead cross the memory's own server deadline and require withdrawal/deletion while retaining future local wakeups. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | States that an elapsed local wakeup reruns the watch without withdrawing valid memory, which expires only at its own server deadline. |
| `JOURNAL.md` | One dated, append-only round-12 entry with measurements and scope. |
| `reports/20260925-bounded-following-r12/` | This report, compressed test/reference evidence, and a mutation runner that restores the built JavaScript module in `finally`. |

## Behavior and tests

No new language form or public API. The real fixture compiles and runs the
review's existing form:

```quarry
query branch():
  if exists audits['a1']:
    return true
  if exists permits['permit']:
    return false
  return true
```

`audits` is `online only`; the synced permit expires at T. The server takes
the first branch and returns `true` with no expiry. The device takes the
speculative permit branch at T−1. Delivering that local result at T now
preserves the remembered `true`, with `fresh: false`. The query needs no extra
local evaluation. The watch immediately reobserves at T and never publishes
loading or the speculative `false`. Sync is frozen; no server request rescues
it. Both hosts run both variants.

`expiry retry server pagination watch` obtains the first server page after a
local expiry retry, requires its `next`, then passes that exact cursor to
retrieve the next three distinct rows. It inspects the first notification so
a later clock-triggered watch rerun cannot hide a cursor dropped only on the
retry.

The 16 router cases cover initial/retry observations × offline/failed fallback
× null/future server expiry × query/watch. Each advances device time inside
`queued()` **after** `recover()` reads memory, before publication returns.
They require remembered data, its original `since` and cursor, a cleared local
wakeup, unchanged server expiry, preserved cache entry, and `dirty: true` for
a watch. The four server-expiry controls cross the server deadline at the
same publication boundary; private memory is withheld and deleted. An elapsed
local wakeup dirties that watch; a future one stays scheduled.

## Numbered procedure coverage

1. **Session/incarnation:** unchanged checkpoints; existing sign-out, close,
   delivery/publication and expiry-retry interruption cases remain in the
   affected suite. The new decision is synchronous after the final fence.
2. **Known complete local wins:** existing branch controls and the real
   `MQ local permit watch` / `MQ expiry local watch left` cases still pass;
   purely local retries add no loading reset.
3. **Unavailable routing:** existing offline, prediction, held, server and
   transport-failure cases remain. Engine-withheld results do not recover
   whole-answer memory.
4. **Unknown/recovery:** Astra's query/watch reproductions preserve valid
   memory instead of a speculative placeholder. Existing pending-prediction
   and retained-composition guards remain.
5. **Publication/expiry:** a remembered candidate is judged by its own server
   deadline. The local wakeup is consumed and schedules reobservation even
   on attempt zero. Final-await races, future deadlines, actual server expiry,
   original freshness age and watched continuation have explicit tests.

## Verification

- Frozen Bun installation and package build passed.
- Affected suite: **256 passed, 0 failed, 0 skipped**, 55.533 seconds.
  [Evidence](affected.log.gz).
- Four deliberate mutations were rejected, and the built module restored:

  | Mutation | Failures |
  |---|---:|
  | Expire remembered data when only the local wakeup is due | 20 |
  | Omit the dirty-watch mark when consuming a due wakeup | 10 (10 query controls passed) |
  | Return the consumed local wakeup instead of clearing it | 16 (4 device controls passed) |
  | Null `next` only on a watched server candidate after retry | 2 |

  [Runner](mutations.py), [summary](mutations.log); compressed failure logs
  beside this report show assertion failures, not harness exceptions.

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
zero failed (176 s); clients, including acquisition/server shards,
**2,016 passed**, ten existing skips, zero failures/cancellations (193 s);
models **78 passed**, zero failures/skips (243 s), with unchanged
**5,000 / 5,000 / 3,000** sequences. Every build, documentation, release,
fixture and typecheck stage passed. **Full-suite failures: none — ours,
baseline or environmental.** No waiver or repeat full run was needed.

Wasm remains **1,850,576 B raw / 521,814 B gzip**, within its unchanged
**522,000 B** budget. `./ref-check --verbose` passed:
**509 LLP documents, 9,339 refs, 0 errors, 0 unchecked**
([evidence](ref.log.gz)). The staged diff passes `git diff --cached --check`.

## Decisions, limitations and failure accounting

No design deviation. Preserving a future local wakeup even when the memory's
server deadline expires follows the requested separation of validity from
scheduling. No source/test file exceeds 1,500 lines: changed files are 286,
805 and 263 lines. No authorization, disclosure, durability, runtime meter,
model count, timeout, package version or acquisition behavior was changed.
No scale inventory was remeasured in this client-only follow-up.

During test development, the first watched-pagination fixture expected exactly
one first-page request despite a legitimate clock-triggered rerun. Both device
variants failed that request-count assertion. Capturing the first data
notification and closing the observation there corrected the harness and
strengthened the cursor regression. This was an owned test-development failure;
mutation failures are deliberate negative controls.

The supplied baseline tail is `== 1 failure(s) in 276 s` (`cargo test`). No
baseline exemption is requested.

The separate [whole-page row-expiry issue](../../../issues/20260925-snapback4-remembered-answer-row-expiry.md)
remains deferred and unchanged: remember an online-only page containing a
permanent message and a typing row that expires at T, then read offline at T.
The entire remembered answer is withdrawn. Its principled fix requires engine
per-row expiry facts and later design work; the authorization cutoff remains
intact. No new scoped open problem is known.
