# Lane SN: one-shot settlement

**Latest: [Round 7](round7/REPORT.md).** Match canonical worker and ledger paths
in test expectations, preserving the wrapper's supplied spelling and all assertions.
[Round 6](round6/REPORT.md) attributed the seven qualification files,
retained the publication-race bound after custody waits, skipped discovery for failed
queries, and reconciled fixtures with the accepted contract.
[Round 5](round5/REPORT.md) fenced complete prediction replay and
retained current-session discovery refusals. [Round 4](round4/REPORT.md) refreshed the exact capability-free backend
pin for the additive settlement envelope and verified unchanged schema/IR/storage on
Linux. [Round 3](round3/REPORT.md) merged FL and DK while preserving both lanes. [Round 2](round2/REPORT.md)
added generation/store fences, field-level evidence and dispatch-bound recovery. [Round 1](round1/REPORT.md) restored complete predicted one-shots
and ordered identity adoption. The historical findings below describe round 0.

2026-10-07. Branch `sb4-intent/sn-one-shot-settlement`, base
`46803201b49980417cc3f2109289c22cbed8a439`.
Work stayed in the supplied `/home/ccheever/sb4-intent/lane-sn` worktree on the
assigned host. No other worktree/process was modified, no remote work was
performed, and nothing was pushed or published.

## Result and guarantee

A one-shot can publish while provably unrelated writes remain unobserved.
Dependent writes wait on custody notifications within the existing single
30-second invocation budget. Waiting consumes no publication rounds. Four
unsuccessful publication rounds and their 25/50/100 ms pauses remain for other
causes: loading, withdrawn deadlines, obsolete scopes and relevant/unknown
concurrent changes. Unknown dependencies block.

At successful publication, every write admitted to this client whose operation
may affect a query input must have been observed or failed. Locally, this means
`observed_seq`, not just a server acknowledgement. Online, the terminal receipt
and a covering query cut are required. Evaluation runs again after waiting.
Authorization, filtering, completeness and freshness still determine what the
answer can disclose. A complete local prediction no longer satisfies this
one-shot guarantee; `observe` and hooks still expose predictions offline.

This deliberately follows the task's negative controls literally. Tests that
inspect speculative rows now use observations; tests for successful one-shots
still require the admitted write to be present in the settled answer.

## Calibration diagnosis

External evidence was read in place, not copied into this repository:

- [Evidence README](/home/ccheever/sb4-intent/sn-evidence/README.md),
  [M6 log, line 181](/home/ccheever/sb4-intent/sn-evidence/m6-acceptance.log:181)
  and [builder account, line 81](/home/ccheever/sb4-intent/sn-evidence/run-log.md:81)
  record the history refusal during receipt synchronization.
- [M8 log, line 216](/home/ccheever/sb4-intent/sn-evidence/m8-acceptance-verified.log:216)
  and [builder account, line 97](/home/ccheever/sb4-intent/sn-evidence/run-log.md:97)
  record Trending's refusal and the switch to the borrowed-token online arm.
- [Schema, history at line 218](/home/ccheever/sb4-intent/sn-evidence/schema.q:218)
  reads messages with key-based membership authorization. Generated receipt
  mutations update recipient watermarks/runs; those fields do not affect this
  bare history query. A returned receipt field or decorated receipt does depend
  on those writes.
- [Schema, maintained count at line 51](/home/ccheever/sb4-intent/sn-evidence/schema.q:51)
  and [Trending at line 390](/home/ccheever/sb4-intent/sn-evidence/schema.q:390)
  correct one premise: **likes affect the actual Trending answer**, which orders
  by `likeCount`. They must wait for observation. A reaction write confined to
  reactions is independent of that ranking. The independent-like reproduction
  uses a message-count aggregate; the maintained-likeCount negative control
  covers the real ranking dependency.

The reported local predicate was exactly the broad custody barrier. A
nonpredictable pending write blocked every ready one-shot; any unobserved write
blocked server/composed/remembered answers. The four-round loop provided only
175 ms of pauses, regardless of whether a write was relevant. Global commit
revision/sequence fences also spent rounds for unrelated commits.

## Implementation

The compiler emits an optional `settlement` summary on the existing public
program envelope. It is computed before private maintained formulas disappear
from that envelope. The device IR, schema serialization, storage and wasm are
unchanged. Each footprint is a table map: `null` means all columns and a list
means specific columns. Missing/malformed summaries are unknown, not empty.

Lowered IR effects include all branches, inlined helpers, search and decoration
reads. Closure adds read rules and authorization probe keys/extra equalities,
expiry fields, read-through parents, aggregate sources/recipient/parent keys and
inherited Following sources. Write closure covers receipt counters and removed
recipient runs, maintained views/counts and their public owner columns,
descendants and Following effects. Search indexes follow their source table;
deletes and expiring writes include their derived effects. Only reserved,
compiler-owned receipt recipes receive narrower watermark field writes.
Native/opaque operations remain unknown.

`query-dependencies.ts` supplies the common intersection rule, change/cut
tracking and event waiter; `query-custody.ts` reads existing local outbox
custody. Online metadata is discovered through an exposed response header,
loaded only from supporting servers and bound to store identity and generation.
Older adapters incur no discovery request. A changed store during discovery
refuses instead of authorizing an old answer with new facts. Offline caches
that omit the optional envelope conservatively fall back to unknown.

The app facade propagates the same wait and deadline; the mock accepts explicit
handler effects, with opaque defaults. Local commits use static admission/
settlement tables or published sync evidence; unknown/reset/snapshot evidence
remains broad. Online narrowing requires a contiguous changes range or the next,
non-replayed receipt from the known generation. Gaps retain the global fence.

Mixed queues exposed a second problem: observation sync waited behind a later
unrelated POST. Waiting reads now request observation of known dependent
successes, even with an unresolved tail. Such sync can overlap a held POST;
syncs serialize with each other and ordinary mutations retain FIFO. Existing
device capture/store/generation/send-revision fences remain authoritative.
`LocalNetwork` includes these rounds in close, rotation and transport occupancy;
explicit `sync()` still reserves a newer round. Following history helpers moved
to the existing `local-following.ts` without changing their predicates, bringing
`local.ts` from 1,537 baseline lines to 1,498, below the 1,500-line limit.

LLP 3000.023 §11 and its Revised line, the client card and `E_QUERY_RETRY`
explanation now state these semantics. The client card remains within 1,200
words. No public `contract.ts` shape or live existence classifier changed.

## Reproduce first

The first two regressions ran against the original SDK and native baseline
from this worktree (0.4.14); the 0.4.13 calibration evidence above is separate:
[reproduction.log](reproduction.log) has **12/12 expected failures**, covering
an unrelated held like and unrelated commits at every publication on online,
wasm, process and their app facades. All refused `E_QUERY_RETRY`.

[reproduction-receipts.log](reproduction-receipts.log) has **6/6 expected
failures** for bare history behind a held receipt watermark. This run retained
the original SDK; the server already emitted the new optional summary, which
that SDK ignored. It therefore reproduces the SDK barrier, not a claimed
second pristine-server control.

During implementation, the retained mixed-tail regression first failed after
30 seconds ([reproduction-mixed-tail.log](reproduction-mixed-tail.log)). A
query started only after the unrelated tail was already sending also failed on
all four local/facade arms ([reproduction-late-query.log](reproduction-late-query.log)).
Both now settle while the unrelated send is still held.

The regression suite also holds dependent row changes, rule changes,
materialized counts, maintained `likeCount`, returned receipt watermarks and
unknown operations; waits exceed the old 175 ms pause budget without another
evaluation, and release/failure yields the correct answer. Tests fire the one
production 30,000 ms timer after entry on all six arms, including the facade;
existing held-write tests also exercise real 30-second exhaustion. Shared-rule
tests cover malformed facts, unknown changes, cuts, cancellation and a wakeup
racing asynchronous custody inspection.

## Verification

Initial `git fetch origin && git merge origin/main` was already current.
`bun install --frozen-lockfile` ran in the Snapback 4 workspace; the SDK
bootstrap printed [deps-ok](deps.log) before building (and at final recheck).
An initial root-directory invocation was corrected to the independent
`snapback4/` workspace. Typecheck and SDK build pass.

Recorded checks (counts are per invocation, not summed as unique tests).
Retained logs have trailing whitespace normalized; diagnostic content is unchanged:

| Check | Result | Log |
| --- | --- | --- |
| Dependency regressions, shared rules, online ordering/session compatibility | 121 passed | [discovery.log](discovery.log) |
| All `one-shot*.test.mjs`, query publication/session, live settlement, explicit sync and affected Following lifecycle | 317 passed, 1 opt-in measurement skip | [lifecycle.log](lifecycle.log) |
| Final custody/terminal/deadline/explicit-sync rechecks after lifecycle changes | 166 passed | [custody.log](custody.log) |
| Affected clients, receipts, prediction routing, maintained columns, sync, live publication, read-only races and wasm-budget tests | 535 passed, 1 labelled legacy-binary skip | [affected.log](affected.log) |
| Guide, compiler summary, emitted backend consumers (routes, server opt-in, reservation headroom, job viewer) | 156 passed | [compiler-guide.log](compiler-guide.log) |
| Server `serve::` tests | 190 passed, 4 documented measurement/child/fixture ignores | [server.log](server.log) |
| TypeScript build/typecheck | Passed | [build.log](build.log), [typecheck.log](typecheck.log) |
| `./ref-check --verbose`, whitespace | Passed, zero errors/unchecked refs | [ref-check.log](ref-check.log) |

The one legacy client skip requires `SNAPBACK4_LEGACY_BIN` for published 0.2.32.
The Following shaped-measurement case is opt-in. No complete repository battery
or publication qualification is claimed. Existing tests of offline predictions
were changed to observations; the Following pending-custody test now asserts no
extra evaluations while it waits. Earlier intermediate failures and their
corrections are not counted as final passes.

## Wasm and limits

No tracked core/device source, wasm build input or budget changed. The fresh
Linux bootstrap measured **2,135,336 raw / 645,448 gzip bytes**, SHA-256
`1c5570a0a990ee302620efdf983dbcf3f9488a08eb8da28bbfb056aec9fe8699`, against
645,607 gzip bytes: **159 bytes inherited headroom**. This is below the requested
500-byte margin for a change to device/wasm; this lane adds no wasm change and
makes no macOS qualification claim. A future wasm change must leave at least
500 bytes above its Linux measurement (the stated macOS difference is about
435 bytes). The budget was not raised. `wasm-budget.test.mjs` passes both tests.
