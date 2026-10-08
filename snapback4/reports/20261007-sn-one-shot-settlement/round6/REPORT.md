# SN round 6 — qualification regressions

Worktree: `sb4-intent/sn-one-shot-settlement`, eb1000 only. Fast-forwarded
`18773fa06a` to `origin/main` **1dd87edd57**, including EM. Frozen Bun install
and `check-sdk-deps.sh` passed (`deps-ok`) before builds. No push.

## Attribution

The seven complete files were built and run at **07f4c495ea** (pre-SN),
**a474980715** (SN landing), and **1dd87edd57** (current main). The first two
used newly created, task-owned detached worktrees `sn-r6-pre` and
`sn-r6-landed`, with independent Cargo targets and SDK/wasm builds. No other
lane's checkout or processes were modified. Runner concurrency: seven files;
Node 24.13.1, Bun 1.3.14, frozen Binaryen 132. Build environment:
`CARGO_BUILD_JOBS=8 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
CARGO_PROFILE_TEST_DEBUG=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`.

Original qualification evidence remains outside this repository:
`~/sb4-intent/ops-tmp/qualify-0416-suite.log` and
`~/sb4-intent/ops-tmp/qualify-0416-notok.txt`. All 24 reported failures are
accounted for below. The cancelled-transport test belongs to
**per-row-liveness**, not online-client-model.

The expectation changes follow the already accepted §11 at **a474980715**,
not a contract change made to satisfy these tests. Its offline paragraph says:

> A dependent custody blocker on a known offline link refuses `E_OFFLINE` in that
> round; it never waits for reconnection or spends the 30-second budget.

The same section permits known disjoint writes/commits, waits on dependent
custody without spending a round, and retains complete device predictions.
The corrected tests assert those outcomes while preserving their existing
mounted-answer, write-outcome, freshness and custody controls.

| File / failing tests | Count | Attribution and correction |
| --- | ---: | --- |
| follow-window: own follow/unfollow, wasm/process × keep undefined/false × wait undefined/0 | 8 | SN changes the old 175 ms refusal into an event wait. The fixture awaited the held write's dependent query before releasing that write. Its parked, silent change feed subsequently timed out, so the next assertion saw E_OFFLINE. Keep dependent reads in flight across the gates, then assert their observed rows. The `postState` compiler summary intersects follow's repost maintenance: an unchanged mounted observation is not proof of static independence. |
| follow-window: post, like and remove, wasm/process | 2 | Intended SN narrowing: cards does not read likes, so the query returns data instead of E_QUERY_RETRY. Assert its rows and completeness; separately hold the like-dependent postState read through observation and assert liked=true. |
| follow-window: empty author's follow, wasm/process | 2 | The same circular wait consumed the mutation's four-second caller budget before the fixture released its POST, yielding pending. Keep the query concurrent; preserve the original sent assertion, final fresh/complete/empty observation, and add the one-shot's empty result. No write-observation/settlement product change was needed. |
| follow-window: Chromium worker false/true × adopted follow/unfollow | 4 | Same dependent-read-before-send ordering and obsolete retry-code expectation. Both one-shots remain pending through receipt and return observed rows after apply; mounted custody and final publication assertions remain. |
| bounded-following: speculative profile, wasm/native | 2 | Intended narrowing: held post cannot affect remoteProfiles. Require the exact served profile and complete=true. Speculative withProfile still refuses and partialWithProfile still contains the prediction. |
| retained-history: R2 sync during reply, wasm/process | 2 | Intended authoritative narrowing: this sync has no changes and can preserve the composed candidate and its original since. Pin preservation; add both relevant-message and unknown-interval controls on both hosts that still require refetch. |
| page-ready: restoration/new chat/pending counts | 1 | §11's explicit offline rule requires prompt E_OFFLINE for unobserved startDM while sync is offline. A later assertion in the same test also encoded the old global barrier: a profile write cannot affect the inbox's server count; require unread=3 and complete=true instead. |
| online-client-model: 3,000 interleavings | 1 | **SN product regression, not DK.** Seed 563 lets a loading candidate consume a free custody wait; after fixing that, seed 2718 exposes free reevaluation of a candidate invalidated during the wait. Preserve the existing <=4 request oracle; loading spends a round and the shared helper rechecks the candidate after custody wakes. A stale candidate spends a publication round. Keep both seeds as explicit replays. |
| per-row-liveness: online cancelled transport preserves earlier diagnostic | 1 | **SN product regression.** A failed query has no generation, causing optional /schema discovery after ECONNREFUSED. The parked discovery delays the query until its deadline and a later feed timeout replaces the diagnostic. Discover only for data candidates. Strengthen this existing test to assert the query's original ECONNREFUSED and zero post-failure discoveries. Wasm/process remain green. |
| worker-regressions: repaired Node retries declaration | 1 | **Non-SN**, introduced by `ab74765288`'s richer worker diagnostic. The fixture's literal `worker needs Node 24` no longer matches `worker /path needs Node 24`. FS `34c6d81a7e` changed fixture custody and other refusal tests, but did not cause this mismatch. Require the exact worker path, wrapper path, rejected v23.0.0 and retry marker; retain repair, worker-start and no-extra-adoption assertions. |

Complete attribution results ([per-file counts and times](attribution.csv)):

| Revision | Files failed | Passed | Failed | Total |
| --- | ---: | ---: | ---: | ---: |
| Pre-SN 07f4c495ea | 0/7 | 261 | 0 | 261 |
| SN landing a474980715 | 6/7 | 238 | 23 | 261 |
| Main 1dd87edd57 | 7/7 | 237 | 24 | 261 |

The SN landing reproduces all 23 SN-related failures. Current main adds the
worker diagnostic mismatch, exactly matching the qualification's 24 failures.
Bounded-following took 218 s pre-SN, 1,704 s at SN and 1,698 s on main: its
intentionally held dependent reads now spend the event-wait budget, rather
than the former four short pauses. No tests were deleted or weakened to speed
that file up.

The Following fixture's quiet change stream now emits ordinary heartbeat
bytes, using the existing `parkedChanges` helper. Network gates still decide
POST execution and sync application. No production timer is shortened. The
lost-save recovery and overlapping follow/unfollow probes also keep dependent
one-shots concurrent, rather than relying on the silence watchdog to release
them. Settled one-shots may remain partial, as §11 already states; final mounted
answers still must become complete and fresh.

## Product fix

The online candidate must be data before optional dependency discovery or a
custody wait can run. Existing current-session E_AUTH handling, retained DK
reasons and obsolete-rotation checks remain in discovery for data candidates.

After a custody event the shared settlement loop calls the same publication
closure again. Waiting itself consumes no round. A newly obsolete proof consumes
the existing four-round bound before reevaluation; a still-valid candidate can
publish directly. Local custody refreshes its pending predicate after the wait.
The app facade repeats asynchronous authority approval after the wait before
its final synchronous raw proof and delivery approval. This applies to local,
online, app and mock through the shared helper. No compiler-summary, store,
generation, receipt, sync-overlap or device-engine changes.

LLP 3000.023 §11, its Revised line, the client guide and E_QUERY_RETRY guide
entry describe the distinction. The custody guarantee, complete prediction
exception, offline refusal, 30-second deadline, and request-count model
assertions remain intact.

## Verification

- All `one-shot*`, query-dependencies and query-publication-session in the
  complete suite: **378 pass, 13 files**, including generation, discovery
  E_AUTH, replay, overlap and the new facade-wakeup control. The earlier focused
  run passed 377 before adding that last regression.
- Corrected Following on current product: **24/24 pass**; final complete suite
  also exercises it. The corrected gates also pass **24/24 on unchanged a474980715 product**;
  the original sent assertions pass there. Only the Following test tools were
  replaced for this later control; that worktree's product source and binaries
  remained unchanged, and its original seven-file attribution run had already
  completed. Both model replay controls instead reproduce their R4 failures on
  that unchanged product.
- Online model: **3,000 seeded sequences pass** with the original R1–R6 oracle
  and both explicit new seeds (29 tests total).
- A facade wakeup regression passes; disabling only its post-wait authority
  check reproduces publication after shared authority ended. The failed
  dependent write leaves rows unchanged, so reevaluation cannot mask the bug.
- Retained-history empty/relevant/unknown sync controls: **6/6 pass**.
- Speculative-profile cases: **2/2 pass**; page-ready **3/3**, per-row-liveness
  **17/17**, worker-regressions **77/77** in affected checks.
- Complete Rust stage: **316 test binaries, 1,029 executions plus doctests pass**;
  integrated guide **113/113**, fixture wrapper **9/9**, package/chat/Expo
  typechecks, docs budget and release guard pass.
- Complete client pool: **356/356 files; 7,032 pass, 54 skipped, zero failures**.
  Bounded Following passes **39/39**, with its real timeout controls retained.
- Complete **`bash scripts/test.sh` passes**, exit 0:
  **`== 0 failure(s) in 2773 s`**. Default 24-file pool and full-count serial
  models; **52 app-session + 29 online model tests pass**. The seven originally
  failing files now pass **267/267** cases, including the added model replays
  and retained-history controls. No test was deleted or its work count reduced.
- `./ref-check`: **531 LLP documents, 10,587 references, zero errors and zero
  unchecked**; `git diff --check` passes.
- Fresh wasm: **2,135,891 raw / 645,605 gzip bytes**; unchanged cap **646,180**,
  **575 B headroom**, exceeding the requested 500 B macOS allowance. No macOS
  build or qualification is claimed.
- `local.ts`: **1,499 lines**, below 1,500; client 1,343; app-client 336;
  query-settlement 123.

Two initial complete-suite attempts were stopped during Rust tests for guide
assertions: the client card exceeded 1,200 words by six, then shortening
removed the pinned literal “30 seconds.” The final 1,200-word text retains
all definition/recovery phrases, including “exhaustion refuses retryable,”
and the unchanged tests and word limit. All 113 guide checks passed with the
final text. A third attempt passed Rust and all completed client files except
the delivery-await census: the four new continuation awaits needed explicit
classification and refreshed count/digest seals. The local waits reuse the
existing custody wait and queued/readQueued boundary; the facade waits reuse
the existing wait and authority check. They add no admission, dispatch, receipt
persistence or delivery acknowledgement. All 162 delivery sites, recipes and
assertions remain unchanged, and the complete delivery fault matrix passes
339/339 after classification. The third run was stopped and the whole suite
restarted with that final inventory. Interrupted runs are evidence, not completed
qualifications. Historical builds used eight Cargo jobs; the final guide and
complete-suite run use sixteen, with all other build inputs unchanged.

Raw command logs are retained alongside this report. Early failed expectations,
control attempts and focused checks are distinguished from final qualification;
no failed run is counted as a pass.


## Evidence index

Logs are losslessly gzip-compressed after their commands finish. Artifact
hashes distinguish the three attribution builds from the final SDK build.

- Attribution: [pre-SN](pre-clients.log.gz), [SN landing](landed-clients.log.gz),
  [merged main](current-clients.log.gz), [per-file totals](attribution.csv),
  [commands](commands.txt).
- Following fixture control: [24/24 on unchanged SN product](landed-corrected-follow-control-final.log.gz)
  and [24/24 after the fix](fixed-follow.log.gz).
- Causal product controls: [both R4 failures on unchanged SN](landed-model-controls.log.gz),
  [facade failure without reapproval](facade-wakeup-control.log.gz),
  [control loader](no-facade-recheck.mjs), [fixed facade](facade-wakeup.log.gz).
- Final checks: [complete suite](full-suite.log.gz),
  [full-count models precheck](final-models-precheck.log.gz),
  [delivery fault matrix](final-delivery-matrix.log.gz),
  [guide](final-guide.log.gz), [reference check](ref-check.log.gz),
  [final artifact hashes](final-artifacts.sha256).
- The `full-suite-first*`, `full-suite-second*` and `full-suite-third*` logs
  retain interrupted attempts and are not qualification passes. Other focused
  logs retain intermediate findings, including assertions corrected before the
  final control runs; the pass claims above name their final logs explicitly.
