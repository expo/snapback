# PR round 5 — irreversible authority fences and conservative sync memory

Branch `sb4-intent/pr-subscription-pressure`. Read rounds 0–4's prompts/reports
and both complete round-4 reviews: Astra NOT READY, Grok READY without findings.
Merged origin/main **267788df36b2ef6ccbcce53042180c5dd642b126** first into round 4
**b131c89893**, producing **56571c0274461afc6eea81d6659debc4285abea5**. Preserved
both sides, including main's bounded settled one-shot reads, receipt work,
guide requirements and journal entries. No push or publication.

## Repairs and their cost

1. **Every sync publication retires server memory.** Committed applies clear the
   single RememberedAnswers map before fallible post-commit work. Observed
   publication clears it again after reading the actual device watermark. This
   covers absent notifications, empty/unknown footprints, staged application,
   apply-plus-throw, recovery after a lost acknowledgment and no-op sync. An
   advancing empty notification is unknown evidence and clears all memory too.
2. **Terminal refusal permanently retires pending results.** `evidence()` now
   advances the authority revision checked by asynchronous results. Every
   refusal invokes it, even repeated refusals with no owners. Clearing temporary
   `partitionDenied` during the next successful sync cannot restore an older
   revision. Raw replies and facade candidates behind final approval both check
   that revision before publication.
3. **One global fence.** Removed the separate detached-evidence counter. Closed
   getters/resubscriptions and pending result publication now consume the same
   monotonic authority revision. Known empty polls without a sequence advance preserve authority and
   memory: they carry no change evidence. Treating them as change evidence
   exhausted bounded query retries; the single full suite exposed that mistake
   and the final one-line guard corrects it. Distinct store incarnation, HTTP credential,
   per-owner scheduling, memory expiry/ticket and app-approval fences remain.
4. **Live server-derived answers get the same evidence.** Apply revalidates
   server/composed/recovered owners through existing `serverRead` and remembered
   wakeup provenance, even with a disjoint replica footprint. This prevents a
   live answer from subsequently detaching without seeing the evidence. Purely
   local disjoint watches retain their existing behavior. Eight starts/eight
   active, FIFO/bounded overtaking, hard withdrawals and episode limits stay intact.

The smallest safe rule here is **all server memory on every apply/publication**,
not just `touched.length === 0`. The actual social starter returns `typing` as
housekeeping on a zero-event durable sync. An unrelated replicated write can
also accompany an invisible server-only revocation. Neither footprint certifies
server authorization. Keeping memory selectively would need a stronger proof
than these device tables provide. No new watermark mirror, answer cache, owner
registry, timer or ordering protocol was added. Known notification tables and
local admit/settle footprints still preserve completed disjoint memory.

This deliberately also clears memory on no-op sync. An authorized online-only
or out-of-horizon read can lose opportunistic offline fallback until a server
answer refills it. Replica rows are not deleted by this rule; saved server
answers were never durable offline coverage. Pending disjoint evaluations may
retry after shared authority advances. Existing mounted retention remains
bounded by its episode/scope/expiry rules.

[PUBLICATION-AUDIT.md](PUBLICATION-AUDIT.md) lists every result/saved-answer route
back to exposure and its fence: first responses, memory writers and copied
recovery, raw/facade one-shots, normal/quiet observation completions, detached and
lingering owners, staged scope cuts, peeks, closed facades, page caches, freshness
copies and delivery acceptance. The rules are recorded in LLP 3000.023 §10 and
the client reference. Main's §11 settled-query contract remains intact.

## Regressions and affected qualification

Three new files contain **27 tests**. On round 4's complete historical SDK,
**22 fail behaviorally and five already pass** (`round4-final-controls.log`):

- Twelve of fourteen real-device memory tests fail: publication without `/changes`,
  committed apply followed by a throw, recovery after a lost apply acknowledgment,
  housekeeping footprint, unrelated nonempty footprint, and empty advancing
  notification, each on wasm and process. The unknown-footprint pair already
  passes round 4. Every case checks the 1.25-second stale window, all callbacks,
  closed raw/facade getters, direct raw/facade queries and server-authoritative
  `{present:false, secret:null}`.
- All four refusal schedules fail: raw response/final facade approval × two
  devices. A successful sync is held at apply after `partitionDenied` clears,
  then the pre-refusal authorized candidate is released.
- Six of nine unit cases fail: publication, scope loss and refusal
  authority, repeated ownerless refusal, empty-advance invalidation/cut, and
  the new quiet-poll preservation rule. The last is an intentional reduction
  of needless invalidation, not an inherited authorization defect.
  Notification, local commit and reset shared-fence controls already pass.

The original six P1 cases also independently fail on current main
`267788df36` (`main-six-controls.log`), confirming inherited defects. Historical
controls transpile **all** tracked SDK TypeScript modules from the named commit
using the workspace compiler into separate target directories; current real
server/device/wasm are shared. This isolates SDK behavior, not a complete
historical Rust rebuild. `control-sdk.mjs` preserves the method and validates
that its historical source inventory is nonempty.

Before the full suite, affected checks: **364 passed, zero failed**, including all 27 new tests,
all subscription-pressure tests, per-row retention and one-shot settlement
(`publication-affected.log`). Earlier broad affected qualification passed
800/801; its sole failure was the old empty-apply memory-preservation assertion,
now deliberately changed to the new rule. Two existing real-device tests now
wait for server reauthorization after sync before checking authorized offline
reuse. Local disjoint work and admit/settle preservation assertions remain.
No timeout, runtime ceiling, concurrency setting or skip was relaxed.

Whole guide: **107 passed, zero failed** (`guide-qualified.log`, repeated after
the quiet-poll correction in `guide-quiet-final.log`). SDK build and
typecheck pass. The merged delivery-await classification was regenerated by
`awaitBoundary()`. `local.ts` is exactly **1,500 lines**; the client guide is
**114 lines / 1,198 words**. Ref-check: **525 LLP docs / 10,042 references**, zero
errors and zero unchecked (`ref-check-final.log`). The final post-suite affected result is recorded below. All earlier failures, including
merge guide corrections and test-fixture setup, remain in [FAILURES.md](FAILURES.md).

## Social starter offline fallback

`social-fallback.mjs` runs the current starter's actual schema and fourteen read
flows on both real device hosts. It establishes current replica coverage and a
second fixture with 501 newer profiles/messages, putting the selected profile
and message photo outside the 500-row horizons. After warming the reads, it
measures offline reuse, reconnects/refills, accepts a Bob→Carol follow outside
Alice's partition, explicitly syncs its zero-event watermark, then loses
transport and repeats all reads. `/changes` stays held. Online recovery follows.

| Coverage / both device tiers | Round 4 ready offline after sync | Round 5 ready offline before sync | Round 5 ready offline after sync | Online recovery |
| --- | ---: | ---: | ---: | ---: |
| Inside local horizon | 12/14 | 12/14 | 12/14 | 14/14 |
| Selected profile/photo outside horizon | 13/14 | 13/14 | 11/14 | 14/14 |

The two newly unavailable flows are **profile** and **messagePhoto**; both now
refuse `E_OFFLINE` instead of recovering old memory. In-horizon global `search`
and ephemeral `typingIn` were already unavailable offline. With a partial
horizon, searches can return local partial results, so readiness is not a claim
of completeness. The other eleven out-of-horizon flows remain ready. Memory
entries after publication fall from 1→0 inside and 3→0 outside, on both hosts.
Round 4 leaves respectively one and three entries. Online passes still use
three HTTP query calls inside/five outside; recovery has the same counts.

Raw phase outcomes, completeness/freshness, query counts and per-flow timings
are in `social-{round4,final}.json`. These are measured schema read paths,
not native UI frame timings or a production latency bound. Older pre-QS SDKs
represent offline unavailability as loading; comparison uses availability,
not changed refusal vocabulary. Earlier `social-initial`, `social-fixed` and
`social-footprint` and pre-quiet-fix `social-conservative` files are exploratory,
superseded evidence; the incidental
`typing` footprint there exposed why empty-only invalidation was insufficient.

## Pressure and LL

The unchanged two-device Chromium harness mounts **124 observations per device**.
Final normal and forced 1,100-ms runs pass on wasm and process. Each history converges
to **42 unique messages**, with eight active slots and a peak of 116 queued.
The normal wasm run has one legitimate active timeout (1,007.4 ms own
work), producing four empty history snapshots on one device; its peer and both
process histories have no gaps. All four forced withdrawals also say
`queued:false, inFlight:true`, at approximately one second of own active work.
Zero withdrawals are caused by waiting in the queue. The normal timeout is
retained. The earlier pre-correction run also recorded one wasm active timeout
at 1,013.3 ms; its raw `convergence-{final,active}-*` files remain. Every publication and pressure
sample is retained in `convergence-{qualified,qualified-active}-{wasm,process}.json`.

The LL harness completed **1,280 actions without timeout**: twenty repetitions
of eight flows × two SDKs × two device tiers × two load cells. Baseline is the
merged pre-fix SDK `56571c0274`, sharing current server/devices with the final
SDK. Only the harness's SDK/fixture path selection is adapted. Maximum flow
publication p95 in milliseconds:

| Tier / load workers | Merged pre-fix | Round 5 |
| --- | ---: | ---: |
| Wasm / 0 | 147.433 | 57.594 |
| Wasm / 3 | 107.387 | 100.015 |
| Process / 0 | 84.884 | 152.416 |
| Process / 3 | 172.674 | 250.326 |

The higher process values remain visible. The baseline overlapped full-suite Rust work; final cells
overlapped affected checks and other sessions on CPUs 0–3; this does not isolate a universal causal regression or
speedup. [LL-TABLES.md](LL-TABLES.md) gives every flow's publication/React timing
and device/server/asset-home work. Summaries retain all stage distributions;
`ll-{base,qualified}-{wasm,process}-{0,3}.json.gz` retains lossless raw traces.
The conservative rule increases some HTTP work: profile/feed-image medians
often move from zero to two server queries; reaction flows also sometimes gain
one or two. Asset-home reads remain zero for all reaction flows, and viewed
media work stays similar (photo medians range 44–47). These costs are explicit,
not a claim that authorization repair is free.
`FINAL-MEASUREMENT-INPUTS.json` binds the final SDK, devices, native binaries
and harness assets; the separately generated baseline SDK is from the merge commit. The initial 640 round-5 SDK actions before
the quiet-poll repair remain as `ll-fixed-*` / `LL-PREQUIET-TABLES.md`; they are
not substituted for the final measurements.

## Wasm and merge integration

The merged engine builds to **1,994,357 bytes raw / 598,401 bytes gzip**. It is
**1,154 bytes** above main's inherited 597,247-byte ratchet. The budget is raised
exactly to **598,401**, with its integration reason in `metrics/wasm-budget.json`;
no slack. Round 5 adds no Rust product change. The combined main receipt work and
prior PR audience metadata must both remain. Whole-artifact size does not
attribute bytes to either feature. Main's inherited RX ratchet record lists 596,247 gzip, while its later NA
report records 597,059; round 4 records 595,440. Those historical Rust trees
were not rebuilt this round.
`WASM.json` records byte counts and hashes. The single full run's wasm/release
stages pass the final ratchet; the later TypeScript-only guard leaves it unchanged.

## Single full-suite run and input boundary

Invoked `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`
exactly once with the then-current product/test/guide source frozen. No workers or model
counts were changed. The initial input inventory command exceeded Node's stdout
buffer before launch; the suite still started. The corrected inventory captured
2,327 scoped files during the suite prelude, before client tests, and the
adjacent `full-snapshot-boundary.log` records that boundary. It is **not** claimed
as a pre-launch snapshot. Reports/journal and non-budget metrics are outputs.
`QUALIFIED-SOURCE.patch` retains the tracked pre-correction delta used in the
full run; `FINAL-SOURCE.patch` retains the final tracked delta.

Exit **1**. Exact summary:

```text
== 1 failure(s) in 1349 s
```

The failed stage is **client tests**: 5,718 tests, **5,706 passed / two failed /
ten existing skips**, no cancellations. Both failures are **ours**:
`process: app screen and history after leave, remount and offline/online reopen`
and `unread badge uses server fallback online and keeps its bound after cold
offline reopen`. They expected current data but got no data; isolated diagnostic
runs expose `E_QUERY_RETRY`. Both pass on the merged pre-fix SDK, both fail on
the initial round-5 SDK, and both pass with only the quiet-poll early return.
See `full-failures-{base,fixed,quiet-control}.log` and [FAILURES.md](FAILURES.md).
No baseline/environmental test failures were identified. This remains a failed
full run; it is not relabeled green after focused repairs.

All other stages pass, including Rust **4,438 passed / 33 existing ignores**, nine fixture wrappers and **79/79 serial
models**, with the original full sequence counts. Rust takes 542 s, client pool
460 s and models 305 s. The inherited nominal 60-second total budget remains
exceeded. `FULL-INPUTS.json` and `AFTER-FULL-INPUTS.json` match all **2,327** hashes;
no product input changed during the run and no worker was interrupted.

Only after completion, the quiet-poll guard and its positive unit regression
were applied, with corresponding reference/LLP wording. No second full suite.
Final affected tests, whole guide and measurements qualify that small follow-up;
`FINAL-INPUTS.json` identifies the final source and the report preserves the full
run's earlier boundary. Final follow-up runs: **439/440 pass** in `quiet-final-affected.log`; the only
failure is the new quiet-poll unit comparing a raw read against its normalized
snapshot (which adds `existence`). It now compares the saved snapshot identity;
its complete authority file passes **9/9** in `quiet-final-authority.log`.
Thus all **440 unique affected cases** are verified, including both full-suite
failures and all 27 new regressions. The final unit control still fails six of
nine on round 4 (`round4-final-authority.log`); the other eighteen detecting
controls are unchanged. No product code changed after the affected run.
The actual delivery fault/await classification suite passes **321/321**
separately (`delivery-final.log`).
Final social and pressure reruns pass; final LL collection is recorded above.

Final measurement hashes also match (`FINAL-MEASUREMENT-INPUTS.json` and
`AFTER-FINAL-MEASUREMENT-INPUTS.json`). `CONSISTENCY.json` lists the three scoped
post-full-run changes: the quiet-poll guard, its unit regression and client
reference wording. LLP and journal changes are tracked with the implementation.
