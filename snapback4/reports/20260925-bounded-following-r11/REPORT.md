# Lane U round 11 — expiry retry watch edges (for 0.4.3)

Base: fetched `origin/main` and merged it into `sb4-intent/u-bounded-following`;
the merge fast-forwarded to integrated `05382d59f`. Implementation/test commit:
`93f13ae44`. Both round-10 reviews and the integrated ticket were read. No push
or publication.

## Changes, file by file

| File | Change |
|---|---|
| `packages/snapback4/src/local-query.ts` | Recovery preserves the latest local `nextExpiry` beside remembered data's independent `serverExpiry`. The expiry retry passes `retain: false` through shared local routing to server transport. Purely local retries do not reset or notify loading. The five numbered rules remain, with the two refinements in the procedure comment. |
| `packages/snapback4/test/expiry-retry-watch.test.mjs` | Six real-server tests: chained permits, an already populated watch during delayed fallback, and a server page followed through its cursor; each runs on wasm and native process devices. |
| `packages/snapback4/test/prediction-routing.test.mjs` | Sixteen recovery cases: offline/failed fallback × missing/non-expiring/valid/expired memory × query/watch. Local time and server time differ deliberately. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Documents preserved recovery wakeups and expiry retry transport clearing the expired snapshot without a purely local loading reset. |
| `issues/closed/20260925-snapback4-expiry-retry-watch-edges.md` | Moves the requested ticket from the open directory and appends its resolution and evidence link. |
| `JOURNAL.md` | One dated, append-only round-11 entry, recording the result, measurements and scope. |
| `reports/20260925-bounded-following-r11/` | This report, affected/full-suite/reference evidence, and a reproducible mutation runner that always restores the built JavaScript module. |

## Rule coverage

1. **Session/incarnation:** existing router delivery/publication `E_AUTH` and
   `E_CLOSED` cases, remembered-answer session checks, and expiry-retry
   sign-out/close/incarnation tests all run in the affected suite. No new await
   or publication bypass was introduced.
2. **Known complete local answers win:** existing known-branch tests and
   `MQ local permit watch` / `MQ expiry local watch left` on both tiers still
   require the first notification to contain the post-deadline local result;
   a purely local retry introduces no loading reset.
3. **Unavailable/opaque routing:** the existing engine-withheld offline,
   prediction, held, server and transport-failure cases remain. The new
   `expiry retry populated watch` starts with a published permit-gated value,
   reattaches the same observation (preserving its snapshot while removing
   the old timer), evaluates before T and releases at T. While HTTP is held,
   its snapshot and every notification contain loading, never that value.
4. **Unknown and recovery:** `expiry retry chained permits` on both tiers
   evaluates before T1, retries at T1 with speculative presence and T2, then
   recovers offline loading. Advancing the issued clock to T2, with sync
   frozen, lets the timer publish known `true` after exactly one further
   local evaluation. The 16 router cases prove that loading, `E_OFFLINE` and
   remembered data all retain T2, and remembered `since` and cursor survive.
5. **Final fence, expiry and freshness:** existing retry prediction/session,
   second-expiry dirty-watch, separate-clock composition, remembered expiry,
   authoritative-refusal and freshness tests remain. New recovery cases keep
   server-clock deadline 150 valid when local time is 200 but server time is
   50, while rejecting memory due at server time 50. The new server pagination
   test requires a non-null `next` after the retry and obtains the next three
   distinct rows using that exact cursor on both devices.

No language form or public API was added. Existing forms exercised include:

```quarry
query expiryBranch():
  if exists permits['permit']:
    return false
  if exists permits['later']:
    return exists audits['a1']
  return true
```

The two permit rows expire at T1 and T2; `audits` is `online only`. The full
compiled fixture also runs `audits after c last 3 by .at pageCard` after T,
returning rows 5–3, then 2–0 through its continuation.

## Verification

- `bun install --frozen-lockfile`: passed, no dependency changes.
- Rebuilt the integrated native binary, wasm device and client package.
- Affected suite: **230 passed, 0 failed, 0 skipped**, 61.066 seconds.
  [Evidence](affected.log.gz).
- Three deliberate mutations were rejected, then the built module restored:

  | Mutation | Failing assertions/tests |
  |---|---:|
  | Drop recovery's next local deadline | 18 (16 router cases and both real-device watches) |
  | Restore retention on retry transport | 2 (both populated-watch cases) |
  | Null the cursor only for a server candidate after expiry retry | 2 (both server-pagination cases) |

  [Runner](mutations.py), [results](mutations.log), and the three compressed
  mutation logs are retained beside this report.

Full-suite command, from `snapback4/` (the integrated run's settings):

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
CARGO_BUILD_JOBS=16 SNAPBACK4_RUST_TEST_PROCESSES=8 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=0 SNAPBACK4_SESSION_SEQUENCES=5000 SNAPBACK4_ONLINE_SEQUENCES=3000 bash scripts/test.sh
```

One full `scripts/test.sh`, exit **0**:

```text
== 0 failure(s) in 942 s
```

[Full evidence](test.log.gz): Rust **3,196 passed**, 19 existing ignored,
zero failed (441 s); clients, including all acquisition/server shards,
**1,990 passed**, ten existing skips, zero failures/cancellations (193 s);
models **78 passed**, zero failures/skips (264 s), with unchanged
**5,000 / 5,000 / 3,000** sequences. Every build, documentation, release,
fixture and typecheck stage passed. **Full-suite failures: none — ours,
baseline or environmental.** No waiver or repeat full run was needed.

`./ref-check --verbose`: **509 LLP documents, 9,339 refs, 0 errors,
0 unchecked** ([evidence](ref.log.gz)). The staged diff passes
`git diff --cached --check`.
The rebuilt wasm is unchanged: **1,850,576 B raw / 521,814 B gzip**, within
its unchanged **522,000 B** budget. Changed source/test files are 275, 200 and
747 lines, below the 1,500-line limit.

## Decisions, limitations and failure accounting

No design deviation. The existing integrated dual-clock result fields and watch
scheduler already support the earliest pending wakeup in either domain; recovery
now supplies both instead of conflating local wakeups with server authorization.
Normal transport keeps its existing retention policy. Only retry transport
retires the expired snapshot. No authorization, disclosure, durability, meter,
model count, timeout, package version or acquisition behavior was changed.

The first new test fixture failed compilation because its branches returned
incompatible kinds. It was corrected to consistent record fields and a shared
named page shape. A subsequent fixture revision allowed a server clock advance
to trigger incidental observations before the controlled retry; moving that
advance until the HTTP gate is reached made the intended interleaving explicit.
These were test-development failures, owned and corrected in this round.
Deliberate mutation failures are expected negative controls.

The supplied baseline tail reads `== 1 failure(s) in 276 s` (`cargo test`).
No baseline exemption is requested.

The separate [remembered-answer row-expiry issue](../../../issues/20260925-snapback4-remembered-answer-row-expiry.md)
remains open as instructed: remember an online-only page containing a permanent
message and a typing row expiring at T, go offline, then read at T. The entire
remembered answer is withdrawn. The authorization cutoff remains intact; this
round does not distinguish row expiry from authorization expiry. No new scoped
open problem is known. Scale inventory was not remeasured in this client-only
follow-up.
