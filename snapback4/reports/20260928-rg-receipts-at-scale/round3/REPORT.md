# RG round 3 — terminal notifications survive observation failure

2026-09-28, `sb4-intent/rg-receipts-at-scale`. First ran `git fetch origin &&
git merge origin/main`: already up to date, with round 2 at `86fd998e8` and
origin/main at `a745b110f`. Read rounds 0–2's prompts, reports and journal
entries and Astra's full review. Grok had progress text but no verdict at
start; did not wait. The [context pack](CONTEXT.md) names the governing LLPs.

## Fixes and controls

1. **Durable refusal after a failed queue read.** The observation check now
   catches failure, schedules sync retry, and continues resolving the mutation
   and emitting `onWrite`. A healthy check still publishes before the batch
   completes; FIFO successes still POST without an intermediate sync. The
   regression injects exactly one `E_STORE` from `queued` immediately after
   the second write's refusal is persisted. With `/changes` held, `/sync`
   blocked and retry timers frozen, the second caller and `onWrite` both get
   `failed`, agreeing with `client.write(id)`. Releasing sync and advancing the
   retry timer publishes the first success without a second refusal event.
   [Before the fix](regressions-before.log), notification is absent; the test
   checks before advancing either the caller timeout or the retry clock.
2. **Final post-loop sync.** The tail survives the FIFO snapshot and the
   known-success branch's eligibility check, then another owner retires it
   just before the network callback's fresh queue lookup. This takes
   `retired → continue`, with no tail `begin_send` or POST. `/changes` is held,
   retry timers are frozen, and publication is held until its request appears.
   Removing **only** the final `await syncUnobserved()` now
   [fails](final-sync-mutant2.log) because no sync starts; restoring it
   [passes](final-sync-fixed2.log). The first fixture retired the tail too
   early and its mutant survived ([retained attempt](final-sync-mutant.log));
   the corrected fixture uses the known-success history read as its barrier.
3. **Audit fixes.** The device already reports a committed reply before
   fallible host bookkeeping. `terminalDeviceCall` preserves that reply if
   the surrounding call later rejects, while scheduling media housekeeping
   separately. It never converts an absent commit or a denied reply to
   success. This covers recovered receipts and keepalive `settle_exit`, as
   well as ordinary and qualified-success settlement. Replacement now queues
   retired-success delivery alongside committed invalidation. Application
   callbacks run after the host call returns or rejects, before media work,
   `sync_state` or synced-time persistence can fail. The eight audit cases
   [all fail on round-2 code](audit-baseline.log) and
   [all pass with the fixes](regressions-fixed2.log).

Only TypeScript settlement and tests change; no server algorithm, public
contract, authorization, disclosure, receipt coverage, meter or budget change.
The queue-reading body moved to `local-receipts.ts`, retaining active settlement
notification markers through observation, to keep
`local.ts` within its 1,500-line source limit. LLP 3000.019 §3.3 records the
post-commit delivery rule. The prior rounds' scale measurements stand; no new
browser-latency or calibration-store measurement is claimed this round.

## Terminal-delivery audit

Source: [local client](../../../packages/snapback4/src/local.ts),
[receipt helpers](../../../packages/snapback4/src/local-receipts.ts),
[regressions](../../../packages/snapback4/test/store-reset-review.test.mjs).

Scope is ordinary mutation `Write` completion and `onWrite` across the local
client, raw online client and app custody wrapper, plus the separate delivery
queue callback. This enumerates the fallible awaits between retained terminal
custody and delivery, including ones inside the device-call wrapper. Exceptions
thrown synchronously by application callbacks are outside this await audit.

| Path | Await after terminal custody / disposition |
|---|---|
| `local.ts::flushOnce`, new POST result | `settleReceipt` awaits history persistence and device settlement. Receipt-save failures are already caught as `persistencePending`; the original response resolves/emits before the later retry check, and the in-memory receipt retains custody. Once durable, `syncUnobserved` awaited queue inspection/sync after removing the resolver: **fixed** by catching observation failure and scheduling retry independently. Regression 1 pins both caller and event. |
| `flushOnce`, existing success-qualified entry | `history.acknowledged` may read/save a corrected receipt; `settleReceipt` may then retire the outbox entry. Before durable retirement, failure leaves the resolver and outbox for retry. Post-commit host/media failure is **fixed** by the same committed-reply wrapper. Resolution and emission already precede the subsequent queue read/sync, so those later failures cannot erase completion. |
| `flushOnce`, `recoverReceipt` before dispatch | `history.read`/`acknowledged`, `history.keep`, then `settle`: a recovered refusal could disappear durably before media/host failure prevented return to the caller. **Fixed** by the committed-reply wrapper. `recovered refusal delivery survives post-commit {media,host} failure` checks notification, caller, durable lookup, no POST, and separate housekeeping retry. |
| `flushOnce`, receipt returned by `begin_send` | The second `recoverReceipt` call has the identical settlement boundary. **Fixed** by the same wrapper; the recovered-refusal fixtures enter precisely through this `begin_send` receipt path. |
| `local.ts::call(observe_store)` / `syncRound` replacement | A reset durably retires success-qualified writes, but its call awaited media/host work and the round then awaited `sync_state` and `set_meta` before notifying. **Fixed** by capturing each retired receipt in the committed callback and delivering with the invalidation after the host finishes, including rejection. Four tests inject each failure independently, require one `sent` event and durable lookup agreement, retain `acquired=false`, then verify a healthy retry does not duplicate the event. This also covers resets observed outside `syncRound`. |
| `listenForExit` → `exitRefusalSettlement` | `history.read` precedes the atomic `settle_exit` commit; prior failure cannot remove the entry. After commit, media or host rejection formerly skipped `publish`. **Fixed** by the committed-reply wrapper; two real-web-device pagehide tests require one refusal event and an empty outbox despite each post-commit failure. A failed save without a commit remains an error and publishes nothing, as the existing admission/exit custody tests require. |
| `settleReceipt` / `recoverReceipt` helpers | `keep` deliberately precedes `settle`. A failure before outbox retirement preserves retry custody. All local settlement callers now use the wrapper that distinguishes a durable callback from a pre-commit failure. Returned terminal results still take the observation catch above. |
| `readQueued` / `WriteHistory.retainEmissions` | The full suite exposed a related retry defect: observation after durable retirement discarded the prior notification marker before recovery delivered. **Fixed** by retaining active settlement IDs through delivery; recovered receipts acquire that ownership too. The browser receipt-abort tests and a deterministic small regression fail without it. |
| `WriteHistory.acknowledged`, `read`, `keep`, `persistPending` | These establish or recover custody, not notifications. `read` preserves an unpersisted known terminal result through save failure; `keep` removes the unpersisted copy only after storage success. No resolver is deleted here. `lookupWrite` may throw during inspection, but is a caller-initiated lookup and does not consume a completion event or settle a shared receipt. |
| Startup retained receipts / `replayOnOpen` | History preservation happens before replay can remove evidence. Startup failure rejects opening; no public mutation waiter/subscriber exists yet. Reopened outbox entries use the audited flush paths. |
| Local admission, auth/session changes and close | Admission failures before dispatch are not server terminal custody. Auth/close do not reinterpret dispatched terminal receipts; `ClosingResponses` preserves responses received before close finishes. Close intentionally clears subscribers and resolves unknown writes pending after bounded active local work; settlement owners retain their known response. No extra post-durable notification await remains. Existing transport/close and local-receipt tests pass. |
| `client.ts::send`, `failUnsentWrites`, `stopForStore` (raw online) | Resolution and synchronous emission follow the classified response with no intervening await. Later watch refreshes do not gate delivery. Raw online history is in memory, with no device persistence boundary. |
| `app-online.ts::settle`, mutation dispatch, raw `onWrite`, and `write(id)` recovery | Await journal `change` before notifying. Every ordinary settlement call catches rejection through `retain`, which preserves the known outcome and notifies before reporting the storage error. Mutation dispatch returns the original result. `change` has no fallible awaited housekeeping after `store.set`; journal invalidation catches its own notification errors. `refuseStore` batch retirement similarly performs no awaited post-save work before its `.then` notification. Existing online receipt-save failure/recovery tests pass. |
| `delivery.ts::DeliveryQueue` → `onDeliveryRefused` | Separate from ordinary `Write` events. It awaits the conditional storage edit before notifying, then performs no other await before the callback. Local storage returns immediately after successful CAS; failed CAS re-reads, and stale incarnation suppresses an obsolete callback intentionally. The receipt/delivery suite covers these boundaries. |

## Validation

Final affected checks: **243 Rust and 596 client tests passed**, with one
opt-in Rust measurement ignored and one explicit macOS-only client skip.
The final 42-test outbox file is included in the
[183-test clock/outbox group](client-clock-outbox-after-suite.log).
The earlier standalone [41/41 run](outbox-final2.log) is retained as pre-suite evidence.
[Commands](commands.txt), [exit codes](check-exits.txt) and full logs are retained.

| Check | Result |
|---|---:|
| Rust row-view units | 24 passed |
| Core row-view, disclosure, sync-count and receipt integration | 31 passed |
| Device row-view, range and delivery | 53 passed |
| Whole guide | 93 passed |
| Rust receipt gaps and delivery | 42 passed; 1 opt-in measurement ignored |
| Client clock, React, pending writes and outbox | 183 passed |
| Client receipt and delivery | 212 passed |
| Settlement, transport outcomes and store replacement | 38 passed |
| Media lifecycle and native adapter | 30 passed; 1 macOS Foundation/AVFoundation test skipped on Linux |
| Maintained columns, both stores and both publication paths | 4 passed |
| HTTP transport, including automatic replay and explicit-sync tail recovery | 12 passed |
| Unread range, cost text, cold restoration and meter bounds | 62 passed |
| Full browser admission/session-boundary file | 55 passed |
| Client build and typecheck | passed |
| Root reference audit | 522 LLP documents, 0 errors, 0 unchecked |

The post-suite client groups and complete corrected fixtures all pass after the
final emission-marker fix. Logs carry the `-after-suite` suffix; the complete
source-bundled browser run is `web-admission-final.log`. The earlier
41-test standalone run preceded that final fix and is not counted twice.

### Full-suite findings and correction

The single full run exposed two maintained-column test failures, one each for
SQLite and wasm. Both are **ours**, caused by the earlier shared FIFO sync
changing which page the fixture receives: with both writes committed, its
parent image is ahead of the event cut and `committed_above` includes the tail.
LLP 3000.001 Repair B requires the device to defer that page, including its
rows and acknowledgements. The old test expected immediate publication.

The [isolated current-client control](maintained-columns-current.log) fails
both cases with published values `[0,0,0]` instead of the received `[1,1,3]`.
Replacing only `local.js` with origin/main's pre-lane implementation in a
separate directory [passes both](maintained-columns-main-local.log), using
the same current Rust binary. The
[control script](maintained-columns-controls.mjs) pins the original fixture;
it never replaces the live client's build during the suite. The standalone
[diagnostic rerun](maintained-columns-diagnostic.log) also reproduces both failures.

The corrected test covers both cases on both stores. A single queued write
retains the original strict immediate-publication assertion. A queued tail
requires a future image head, exactly one `committed_above` receipt, unchanged
public watermark and rows, advanced private transfer cursor, and unchanged
published state across an offline reopen. Both variants retain the full
watch/value sequence, pending-parent confirmation, and later cold reopen.
The tail case fences sync until both mutation responses arrive, making the
intended image head deterministic. [All four pass](maintained-columns-fixed2.log).
No production publication rule was changed to satisfy these tests.

The two 256-ID boundary failures are also **ours**. Their incidental
expectation that sync acknowledges at least one tail ID depended on the old
per-write sync. The [current control](transport-http-current.log) records 256
sync acknowledgements plus 17 ordinary same-ID replay receipts; all 273 writes
complete once. With [origin/main's local client](transport-http-main-local.log),
272 arrive through sync and one by ordinary replay. The
[isolated control](transport-http-controls.mjs) pins the old fixture.
The corrected fixture retains automatic replay and adds an explicit-sync case
on each store with the mutation route temporarily unavailable. This forces
advancement beyond the first pending-ID window and retains the no-repost,
exactly-once notification, six snapshot batches and complete 37-row checks.
The [full corrected transport file passes 12/12](transport-http-fixed2.log).

The fifth failure, `unread range check names the chosen predicates, index and
horizon`, is **ours**: it still required the cost phrase “the walk is not
metered” removed in round 1. The [source attribution](cost-text-attribution.txt)
records both versions; the [diagnostic run](unread-range-diagnostic.log) fails
only that assertion. It now pins the 64-key necessary-predicate probe, larger
shared expiry walk, one-examined/one-step reservation and internal ledger.
The [whole unread-range file passes 62/62](unread-range-fixed.log).

The sixth failing leaf is **ours**, a production defect:
`a known NOT_ADMIN refusal survives two receipt aborts when keepalive answers
first` emitted the refusal twice. Its parent `web admission review: recovery
and transport respect the session boundary` is consequently red too.
The [focused pre-fix run](web-admission-diagnostic.log) reproduces duplicate
notifications with either response ordering. A receipt-save retry retires the
outbox and then checks observation; that queue read used to forget the prior
emission marker before the retry delivered. Settlement now owns the ID before
receipt recovery and queue reads retain active owners' markers through final
delivery. Ownership still releases in `finally`, so the set remains bounded
by active work. [Both browser orderings pass](web-admission-fixed.log).

A smaller deterministic outbox test injects two receipt-save refusals, freezes
retry time, then requires publication and one refusal event after repair.
[Before the marker fix it emits twice](emission-dedup-before2.log).
The full-suite build was kept intact while its models finished; subsequent
client tests rebuild and test the corrected source separately.

The exact summary from the **one** `scripts/test.sh` run is:

```text
== 1 failure(s) in 4162 s
   client tests
```

The [full log](full-suite.log) records all stages. Ordinary client tests:
**3,910 passed, 7 failed, 10 skipped**. The seven failures are the six leaf
failures above plus the web-admission parent. All other stages passed,
including **79 client model tests**. The ten client skips are one macOS-only
media test and nine explicitly opt-in historical/managed-identity fixtures.
The host load of 126.89 across 96 CPUs selected serial client files.
No baseline or environmental failure is claimed: every failing leaf is ours.

The single run uses the settlement source before the final emission-marker
fix and the original five stale fixture assertions. That result stays red in
the record. The [suite production digests](suite-production-digests.json)
distinguish it from the final [source digests](source-digests.json). Final
build/typecheck, all affected client groups and the complete corrected
fixtures are rerun after the fix; the browser admission file passes **55/55**.
The full suite is not repeated.

## Failures and disposition

| Classification | Failure | Disposition |
|---|---|---|
| Ours, expected control | Durable refusal's callback and event disappear after the queue-read fault | `regressions-before.log`; final code passes |
| Ours, expected control | Eight post-commit audit cases lose completion on round-2 code | `audit-baseline.log`; final code passes |
| Ours, expected mutant | Deleting only the final sync prevents publication after early tail retirement | `final-sync-mutant2.log`; restored source passes |
| Ours, full-suite failures | Both maintained-column interrupted-sync cases assumed every received parent image was immediately publishable | Isolated controls attribute this to our shared FIFO sync. Corrected fixture covers immediate publication and Repair B deferral; 4/4 pass in `maintained-columns-fixed2.log` |
| Ours, full-suite failures | Both 256-ID boundary tests depended on an intermediate sync to acknowledge part of the tail | Current/main controls preserve 273 exactly-once outcomes through different recovery paths. Test automatic replay plus explicit sync with replay unavailable; full transport file passes 12/12 |
| Ours, full-suite failure | Unread-cost test retained “the walk is not metered” after our round-1 wording correction | Update the assertion to the corrected cost model; whole unread-range file passes 62/62 |
| Ours, full-suite production defect | Web admission keepalive-first receipt-abort case emits NOT_ADMIN twice; its parent also fails | Retain active settlement IDs during emission cleanup and acquire ownership before receipt recovery. Both browser orderings pass; deterministic pre-fix control emits twice |
| Ours, validation driver | Editing `commands.txt` while the original bash driver was still running made it resume at an obsolete offset after the full suite completed | `driver-invocation.log`: missing partial pathname then unexpected `;;`, driver exit 2. The suite itself completed once with the preserved summary; two accidental passing groups used the old build. Rebuilt and ran the entire affected-client command set from a fresh invocation |
| Ours, expected regression | Small receipt-save retry regression emits the same refusal twice before the marker fix | `emission-dedup-before2.log`; final 42-test outbox file includes the guard |
| Ours, fixture timing | First small dedup test advanced frozen time before flush scheduled its retry | `emission-dedup-before.log`; wait for the flush continuation, then `emission-dedup-before2.log` reproduces the actual duplicate |
| Ours, fixture timing | First explicit-sync transport fixture called sync before the initial receipt window retired; two assertions failed | `transport-http-fixed.log` (10/12); fence ordinary replay and sync while retirement advances the window; 12/12 pass |
| Ours, fixture timing | First expanded maintained-column run passed 3/4; web tail could sync before its second commit | `maintained-columns-fixed.log`; explicitly fence sync until both POST responses, then 4/4 pass |
| Ours, validation invocation | First maintained-column patch used a path relative to the repository while its command ran from `snapback4/`; the subsequent old tests failed twice | `maintained-columns-wrong-cwd.log`; corrected path and fixture |
| Ours, fixture weakness | First final-sync fixture retired before the intended network lookup, so the mutant passed | Preserve `final-sync-mutant.log`; corrected timing is pinned by the known-success branch and zero tail `begin_send` calls |
| Ours, implementation setup | Initial extraction made `queued` a const used before initialization; generic helper inferred no `ok` field | `client-fix-build.log`; restore a hoisted function and use the explicit reply type; build/typecheck pass |
| Ours, validation setup | Tests were invoked after that failed build, consuming partially emitted JS and failing at client opening | `regressions-fixed.log` (2 failures), `audit-fixed-first.log` (8 failures); subsequent commands require successful build first; final checks pass |

Exploratory source discovery also encountered absent guessed filenames/globs
and the uninitialized skill link; a `tail -8` invocation with several paths
and a multi-revision `git rev-parse --short` invocation were rejected. These were ours, corrected by discovery, the existing sibling
skill and `tail -n`; they were not product checks. Temporary live-source
mutants were restored in `finally` blocks and the client rebuilt afterward;
full-suite attribution controls used isolated copies. Retained text logs strip
terminal trailing whitespace only.

[Wasm measurement](wasm.json), after the full suite's rebuild: **2,019,815 B
raw / 585,381 B gzip**, SHA-256
`2e12e4657211129dfe80e58ff8ef88a23d52ad19885ed5d461c30a68d47e68a0`.
Byte-identical to round 2, with **812 B** headroom under the unchanged
**586,193 B** budget.

No tools installed. No push or publication. The local commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
