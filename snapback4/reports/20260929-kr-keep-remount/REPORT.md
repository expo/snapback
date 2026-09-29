# KR round 0 — keep remount snapshot identity

Base: `aedd35615ad54901a481a01481e5d8f6110c69b4`.
Branch: `sb4-intent/kr-keep-remount`. Local commit only; nothing pushed or published.
Scope and governing constraints: [CONTEXT.md](./CONTEXT.md).

## Finding and decision

This was an idle-remount test starting from a non-idle observation. The online
client's existing cancellation/resumption is permitted by LLP 3000.023 §10,
**Queue and lifetime**. No product source changes are needed.

The unmodified test failed **7/10** focused repetitions here, with exactly the
reported strict-identity difference: the same answer plus `revalidating: true`.
[Outcomes](./before.json), [all ten logs](./before.log.gz). These runs used
SR's independently built, unchanged-base binary, this lane's SDK built from the
base, and source-matched wasm. SR's SDK/core/device/test diff from the base was
empty. The initial working tree was clean. [Input hashes](./inputs.json) bind
the binaries, SDK, wasm, final test and toolchain; the final-test hash also
appears in [the 50-run results](./after.json).

Diagnostic preload [trace.mjs](./trace.mjs) logs fetch paths, publication,
invalidation stacks and queue ownership without editing product code. Its first
two runs passed; the third reproduced the same failure on this lane's freshly
built base binary ([trace 1](./trace-01.log.gz), [trace 2](./trace-02.log.gz),
[failing trace 3](./trace-03.log.gz)). Event ordinals in trace 3:

| Event | Evidence |
| --- | --- |
| 1–2 | The fixture seeds its three rows, before creating the client. |
| 5–7 | `/changes?since=0` and the first `/q/secret` are dispatched. |
| 9–10 | The feed returns `seq: 1`, `generation: 1`, tables `members,secrets`. The `poll → scheduleRead → reload(true, {queued:true})` stack shows the initial query still in flight. |
| 13–15 | The first answer publishes with `dirty: true`; the refresh tail schedules its dirty reread and sends the second `/q/secret`. |
| 16 | Last unsubscribe calls `ReadWork.cancel`: `active: true`, `inFlight: true`, with the ready answer still displayed. |
| 17 | Remount calls `acquire → start → scheduleRead → reload(false, {queued:true})`, retaining that answer with `revalidating: true`. Strict object identity fails. |

Thus the triggering evidence is the test's **own seed commit through the durable
change feed**, followed by last-subscriber cancellation and remount resumption.
No clock correction, presence refresh, sequence retry, later mutation or new
credential is involved in the failing interval. The conservative dirty reread
is existing online queue behavior; this lane does not change its scheduling or
authority acceptance rules. Presence is absent from this query.

Section 10 explicitly permits canceling active work on last-owner close and
resuming it on reacquisition. Retention preserves an answer, not an unchanging
snapshot object throughout revalidation. The test's strict idle-join assertion
remains valid once its preparation establishes an idle answer.

## Change

In the existing three-tier test:

- Local clients finish initial sync before opening the observation.
- Online fetch holds delivery of the initial change-feed response until the
  first query has settled. It then releases the real response and waits for a
  distinct successful replacement with the expected row and no revalidation
  mark. It neither fabricates nor drops the feed event.
- The original strict snapshot-identity assertion remains. The test explicitly
  checks that its starting answer is settled.
- The no-new-read counter is checked both synchronously and after a zero-delay
  event-loop turn, covering queued dispatch. Identity must remain exact then too.
- Operation/argument/retention-policy isolation, last subscriber behavior,
  the 29,999 ms/30,000 ms boundary, and synchronous sign-out withdrawal of
  both active and idle answers remain unchanged.

The test still has its original 30-second timeout and original polling bound.
The zero-delay yield exercises the work queue; it is not a settling delay.
No withdrawal, account, store, schema, expiry or episode fence was changed.

The [post-fix trace](./trace-after.log.gz), event 20, confirms the first last-owner
release has `active: false`, `pending: false`, `delayed: false`, `inFlight: false`
and `dirty: false`. Its startup replacement completed before remount.

An isolated generated-SDK mutation changes `if (resume) start(watch)` into
`queueMicrotask(() => start(watch))`, forcing an otherwise-idle join to schedule
a read. The copied final test passes without the mutation, then fails at
**“joining does not queue another read either”, `4 !== 3`**. The real working
SDK was never mutated. [Control outcomes](./join-control.json),
[passing control](./join-control-baseline.log.gz),
[expected mutation failure](./join-control-spurious-join.log.gz).

## Repetition commands

Run from `snapback4/` after building the binary and client:

```sh
# Before: unchanged test, repeated ten times with the source-matched base binary.
node --test --test-name-pattern='^online: keep remount' packages/snapback4/test/keep-device.test.mjs
# After: repeated 50 times, sequentially, with no retries or discarded runs.
node --test --test-name-pattern='^(online|process|wasm): keep remount' packages/snapback4/test/keep-device.test.mjs
# Optional diagnostic preload, usable before or after the patch:
node --import ./reports/20260929-kr-keep-remount/trace.mjs --test --test-name-pattern='^online: keep remount' packages/snapback4/test/keep-device.test.mjs
```

All **50/50 after runs** pass all three tiers: **150 passed, 0 failed**, with
three tests and zero skips/cancellations per run. [Outcomes](./after.json),
[every complete run log](./after.log.gz). A separate initial three-tier run also
passed ([log](./focused-initial.log.gz)).

## Verification

| Check | Result |
| --- | --- |
| Focused repetitions | 50 consecutive runs × 3 tiers, **150 passed, 0 failed**, no skips |
| Retention/client checks | **483 passed, 0 failed, 0 skipped**, 417.932 s; [log](./affected.log.gz) |
| Queue work, liveness and retry checks | **44 passed, 0 failed, 0 skipped**, 6.576 s; [log](./queue-tests.log.gz) |
| Reference audit | **524 LLP docs, 9,924 refs, 0 errors, 0 unchecked**; [log](./ref-check.log.gz) |
| Rust workspace build and client build | Pass; [Rust](./build-rust.log.gz), [client](./package-build.log.gz), [dependency install](./bun-install.log.gz) |
| Full blocking suite, invoked once | **Exit 0: `== 0 failure(s) in 1386 s`**; [complete log](./suite.log.gz), [exit status](./suite.exit) |
| Full serial models within that suite | **79 passed, 0 failed, 0 skipped**, 311.520 s; 5,000 online session sequences, 5,000 local session sequences and 3,000 client interleavings |

The single blocking-suite run uses
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`.
It began after the affected retention run finished. Its Rust stage passed in
592 seconds; both app typechecks and fixture wrappers passed. The client stage
ran all 238 ordinary client files at concurrency 24, including all three remount
cases, and passed in 407 seconds: **5,123 passed, 0 failed, 10 declared skips**.
The full run completed without a failure: **ours 0, baseline 0, environmental 0**.
The script was not rerun. Its 1,386-second duration exceeds the repository's
nominal 60-second budget; SR's preceding full run already took 1,348 seconds.
That inherited process-budget overrun is disclosed, not counted as a passing
60-second gate. No timeout or count was changed to obtain these results.

No product source changed. The full suite nevertheless rebuilt wasm and measured
**2,040,529 B raw / 592,975 B gzip**, **744 B** below the unchanged **593,719 B**
cap. SHA-256 remains
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.

The retention invocation ran `keep-*.test.mjs`, `answers-stay-*.test.mjs` and
`expired-server-watch.test.mjs` at file concurrency 4. It also listed a nonexistent
`read-work.test.mjs` pattern, which Node ignored; no coverage is claimed for that
name. The separate queue invocation used the actual `per-row-work.test.mjs`,
`per-row-liveness.test.mjs` and `per-row-retry.test.mjs` files at concurrency 4.
No test timeout, repetition count or model count was changed.

## Reproduction and control failures

| Classification | Failure | Disposition |
| --- | --- | --- |
| Baseline, fixed here | Original online remount strict identity: runs 2, 4, 5, 6, 7, 8 and 9 of ten fail; diagnostic run 3 fails identically | Same answer gains `revalidating: true`; diagnosis and deterministic test preparation above. Every run is retained. |
| Ours, intentional isolated mutation | `joining does not queue another read either`, `4 !== 3` | Expected falsification result after forcing a spurious queued join read in a private generated-SDK copy. Passing control and unchanged real SDK preserved. |
| Ours, evidence packaging | Initial gzip verification read before the writer closed and raised `EOFError` | The raw suite log was intact. Recompressed with an explicitly closed writer, checked byte-for-byte against the raw log, then verified every gzip artifact. No test was rerun. |

## Ticket and limits

`issues/20260929-snapback4-keep-remount-snapshot-identity.md` is absent at this
lane's base and remains absent here. Its open SR copy was read, but no unrelated
SR branch was merged and no duplicate ticket was created. When SR's ticket
arrives, close it with this resolution and move it to `issues/closed/`:

> Resolved by KR round 0: seed change-feed traffic dirtied the first online
> query; last unsubscribe canceled its reread and remount legitimately marked
> resumption as revalidating. Order the initial feed delivery and wait for its
> settled replacement before asserting idle remount identity. Strict identity,
> no-read-on-join, key isolation, 30-second expiry and sign-out checks remain.
> The baseline failed 7/10; final focused runs passed 50/50 on each tier.

No new retention policy or behavior is claimed. Existing LLP 3000.023 §10 and
the current guide govern this test correction; no LLP amendment is needed.
