# Lane KG round 1 — bounded default retention and authority holds

Branch: `sb4-intent/kg-kept-through-authority`. Release target: 0.4.5.
The current contract is Accepted LLP 3000.023. The round-0 report is retained
below as historical evidence; its keep-only scope, `fresh: false` mark and
exception for a replacement's earlier expiry are superseded here.
No push, publication, version bump or budget change.

## Result and integration

Merged `origin/main` at `9642d406c` in `9c131c4eb`. Kept both sides of the
JOURNAL append conflict and both Revised histories in LLP 3000.019. Read both
blind round-0 reviews in full. Grok's ordering-test finding and Astra's three
Highs plus Medium are addressed. The fixes and their discriminating tests
landed in `47befc1a8`, before the RFC implementation.

Omitted options retain an answer in one non-renewable episode ending one
second of host time after invalidation processing. `revalidating: true`
preserves `fresh`, `since` and answer identity. `keep: false` withdraws at once;
`keep: true` has no episode cap and retains its existing 30-second linger.
Each has its own watch key. Hard withdrawals replace for every policy.
The facade inherits A's episode by value, follows A's own row deadlines, and
clears shared approvals and peeks on every source withdrawal, including B's
expiry. Accessors enforce deadlines without timer delivery. Episode withdrawal
writes one stable loading snapshot without fencing a valid late replacement.

## Implementation, file by file

Paths in this table are relative to `snapback4/packages/snapback4/`.

| File | Round-1 change |
| --- | --- |
| `src/read-episode.ts` | New absolute host timestamp metadata and a timer/accessor latch; copies never renew an episode. |
| `src/read-observation.ts` | Split retain/linger, preserve identity/freshness in revalidation, check row and episode deadlines, always replace on loading, normalize per-call false, and leave a successful/interrupted internal fallback to the whole evaluation. Episode expiry changes neither revision nor resetVersion. |
| `src/read-expiry.ts` | Deadline-aware raw and held access, with the remembered-answer fence; recursive rearming preserves `withdrawHeld`. |
| `src/read-approval.ts` | Shared approval access checks row/episode deadlines, holds `revalidating` copies, inherits the timestamp by value, and withdraws/announces every reset, refusal, retirement, failure and source expiry. |
| `src/read-notifications.ts` | New synchronous notification deferral for grouped withdrawals: all source/approval snapshots change before application callbacks. |
| `src/app-client.ts` | All five keep gates follow retention; held getters use the accessor; withdrawals clear approvals for opening remounts; the refresh-version authority fence remains. |
| `src/observe-watch.ts` | Three policy keys, deadline-aware peeks, separate linger policy/timer record, retirement notification, and episode notifications to subscribers; close stays `linger || resetOnClose`. |
| `src/client.ts` | Online viewer/credential resets and rereads cover every policy, unconditional resetVersion fence, default reload retention, and explicit hard failure publication/deadline installation. |
| `src/local.ts` | Same local reset/fence/retention changes, deferred shared-approval notifications, exact expiry sweep delivery, and hard failed/expired candidate withdrawal. |
| `src/local-reads.ts` | Ordinary apply/admit/settle retain according to policy; reset operations stay hard; retaining watches preserve row timers. |
| `src/local-query.ts` | Ordinary fallback, including ephemeral refresh, defers to watch policy; explicit expiry retry still passes false. |
| `src/react.tsx` | Preserve omitted keep through observe/peek/usePage; extract Pages. |
| `src/react-pages.ts` | Combined reads carry revalidating; consult all page accessors before a cached result; handle synchronous suffix removal during deadline checks while keeping Object.is stability. |
| `src/contract.ts` | Read's optional readonly `revalidating` field, rewritten Read card and three-state ObserveOptions; explicit action-gating guidance. |
| `CLIENT-AND-OPERATIONS.md` | Default forms, episode clock/start/cap, three policies, failures, fallback composition, reset/facade rules, page cache behavior and action gating. Removed the old fallback/exhaustion exceptions too. |
| `test/retention-episode.test.mjs` | New deterministic replacement, policy, progress, deadline, key, hard-withdrawal and shared-facade tests. |
| `test/retention-pages.test.mjs` | New first/later page deadline-without-timers, stable cache, mark and cursor suffix tests. |
| `test/helpers/authority-fixture.mjs` | Extracted shared fixture with independently gated authority, controllable split clocks and the real remembered-answer cache. |
| `test/keep-authority.test.mjs` | All review regressions and their ordering cases; reverse the earlier-B-expiry expectation per RFC §3.6; preserve freshness with the new mark. |
| `test/keep-observation.test.mjs` | New loading/retention semantics, omitted facade variant, relaxed round-7 hold before A's deadlines, and a real commit revision fence. |
| `test/read-observation.test.mjs` | Separate revalidation from freshness and preserve in-progress nonpublishing fallback. |
| `test/keep-device.test.mjs` | Omitted variants for apply/admit/settle/revocation/leave/refusal and obsolete-evaluation fencing on wasm/process. |
| `test/answer-withdrawal.test.mjs` | Real membership apply, predicted leave, owner transfer and remount controls; omitted/false policies, held/thrown/unavailable/exhausted results, exact episode boundary and late null publication. |
| `test/answer-row-authority.test.mjs` | Existing immediate-withdrawal assertions explicitly choose keep:false. |
| `test/online-read-order.test.mjs` | Existing immediate-withdrawal control explicitly chooses false; ordering protections stay. |
| `test/online-client-model.test.mjs`, `test/helpers/online-client-model.mjs` | R1's immediate-revocation model explicitly chooses false; add the full-run seed-2345 replay and rerun all 3,000 interleavings. Default episodes retain their separate generated coverage. |
| `test/page-authority.test.mjs` | Preserve immediate-withdrawal/fencing controls with false; default fallback retains original freshness and marks revalidation. |
| `test/presence-refresh.test.mjs` | The explicit immediate-invalidation control uses false; failed background sampling remains uncapped. |
| `test/maintained-column-adoption.test.mjs` | Count newly served answers using fresh && !revalidating, excluding a preserved old answer before schema discovery. |
| `test/server-clock-regressions.test.mjs` | Retention keeps since unchanged; remembered wakeups preserve answer identity while notifying revalidation; completed-read clock clamping stays tested. |
| `test/ephemeral-keep.test.mjs` | Simultaneous omitted/false/true typing reads through durable bursts and held replies on every tier. |
| `test/expired-server-watch.test.mjs` | Warm answer before expired-reply series, omitted/false/true policies; verify loading throughout paced retries and recovery. |
| `test/expiry-retry-watch.test.mjs` | Replace old remembered-wakeup snapshot/no-notification assertions with preserved answer identity/data/fresh/since, one mark notification and clearing on replacement. |
| `test/keep-expiry.test.mjs` | Omitted variants across ordinary commits; failures now withdraw immediately. |
| `test/keep-incarnation.test.mjs` | Omitted ephemeral adoption plus all three credential/viewer fences; first viewer discovery retires every policy's old fetch. |
| `test/keep-adoption.test.mjs` | Omitted variants for active/peer adoption and first schema installation. |
| `test/keep-clock.test.mjs` | Omitted split-clock, rollback, delayed memory-body and newer-memory cases, keeping existing true/linger coverage. |
| `test/keep-reset.test.mjs` | Omitted raw and facade variants across wasm/process resets, with blocked old reads and callback-driven remounts. |
| `test/keep-app-expiry.test.mjs` | Omitted and true real createApp/wasm held-expiry, memory barrier, rollback and public recovery. |
| `test/prediction-routing.test.mjs` | Real evaluateLocal fallback/composition with the second local read held; A stays until the full result is ready. |
| `test/keep-app-model.test.mjs` | Eighteen generated createApp sequences: three seeds × online/wasm/process × omitted/true, with delayed authority and measured episode caps. |
| `test/keep-authority-react.test.mjs` | Plain and true hooks through 20 updates, loaded cursor changes and authoritative removal; rendered values/input state/mount count asserted. |
| `test/react.test.mjs`, `test/helpers/react-harness.mjs` | Extract existing inline browser harness below the 1,500-line limit; intentional old withdrawal controls use false; revalidation assertions preserve fresh. |

At repository scope, `llp/3000.019-what-the-builder-still-wrote.rfc.md` §3.3
and Revised record the implemented successor contract. This report and one
new append-only `snapback4/JOURNAL.md` entry record qualification. No Rust,
authorization evaluator, disclosure rule, meter, durable format or diagnostic
changed. LLP 3000.023 remains the Accepted author text.

## Forms that compile and run

```ts
const read = useQuery(api.inbox, {});                    // bounded default
const page = usePage(api.thread, { conversationId });    // bounded pages
const exportWatch = app.client.observe(api.inbox, {}, { keep: false });
const remountWatch = app.client.observe(api.inbox, {}, { keep: true });
const canCopy = isReady(read) && !read.revalidating;
```

No Quarry syntax or new option spelling is introduced. `client.observe`
also accepts omitted options, and both hooks accept either explicit boolean.
False opts out of retention; true opts into uncapped retention and lingering.
`fresh: false` can still describe a completed offline read with no revalidation.

## Review findings: discriminating evidence

- Astra High 1: both held snapshot/peek access check device and server deadlines
  before timers, latch withdrawal and fence delayed remembered bodies across
  rollback. Reverting the accessors makes four new regressions fail.
- Astra High 2: rearmed timers retain the memory callback. Removing only the
  recursive callback argument fails the early-timer/rollback/newer-C test.
- Astra High 3: reset, refusal and retirement notify opening remounts after
  shared withdrawal. Removing those notifications makes three tests fail.
- Astra Medium and Grok: B and C have independent gates. Resolve B while C
  waits: A stays. Refuse C then approve B: denial stays. Removing the version
  fence fails both cases.

These four isolated negative controls ran before the full suite, with generated
bytes restored. Logs: `negative-accessors.log`, `negative-rearm.log`,
`negative-notifications.log`, `negative-ordering.log` under the evidence path.

The real Chromium witness also fails on replacement 1 when Vite substitutes
only main's `app-client.ts` from `9642d406c`: the query draft becomes empty.
Other final runtime modules remain present in that control, so this specifically
isolates main's facade withdrawal. This is not a claim of testing a full main
checkout. The final facade passes both plain and keep:true browser witnesses. The plain
witness delays each serialized storage read by 5 ms, keeping its three watches
inside the cap; true retains the 50 ms delay. The generated tests use 50 ms
for both policies and explicitly verify longer bursts withdraw at the cap.
The control uses an isolated transform; no live suite bytes were mutated.

## LLP 3000.023 §6 evidence index

| Item | Evidence and assertion |
| --- | --- |
| 1 | retention-episode + keep-device: data/null/empty/refusal replace A, preserve A's fresh/since during the wait, clear the mark on replacement and reject pre-commit work. |
| 2 | answer-withdrawal: real apply membership revocation, predicted admit leave and owner transfer on wasm/process, each held/throwing/unavailable/retry-exhausted; false controls withdraw at commit, default shows marked A before the cap, then loading or null. For local exhaustion the same real row query also samples an ephemeral table and receives four stale epochs: this exercises runLocal's finite retry path. Ordinary durable reads have no equivalent finite stale-epoch loop. Online membership exhaustion uses four obsolete sequence replies. |
| 3 | keep-clock/expiry/adoption/incarnation/reset, plus createApp keep-app-expiry: omitted policy through split clocks, rollback, memory fences, owner/peer adoption, first schema and blocked old reads; reset tests include raw and guarded wasm/process observations. |
| 4 | keep-authority + retention-episode + keep-observation: A→B hold, refusal, A/B expiry, late completion after reset, exact own deadline, and independent authority ordering. |
| 5 | keep-authority-react: real client/facade browser notifications, 20 updates, second-page cursor replacements and final empty removal; values, two draft inputs and one mount each checked. Main-facade control fails. |
| 6 | keep-device/keep-observation + retention-episode: join active watch, only true lingers, exact 30-second boundary before timers, scope isolation and both mixed acquisition orders. |
| 7 | keep-app-model: 18 sequences, seeds 23/44/445 on online/wasm/process, every authority-store read delayed 50 ms, observed sync pages/writes/predictions/settlements/server changes; loading allowed only at a measured cap or a named hard withdrawal. |
| 8 | retention-episode: timestamp begins at invalidation, A→B→C never extends it, peek/getSnapshot/timer share one stable loading snapshot, host rollback cannot resurrect A, late success still publishes. |
| 9 | retention-episode/pages, expired-server-watch, ephemeral-keep, prediction-routing and keep-incarnation: all three keys/options, forced false, warm expired replies, held composition, facade mark/source withdrawals, page cache/access deadlines, credential capture and live Bob viewer. |
| 10 | retention-episode + keep-expiry + answer-withdrawal + generated offline transitions: thrown rerun, retry exhaustion, transportOffline, link loss and explicit false are hard withdrawals for retaining watches. |
| 11 | keep-device and keep-observation use actual commit fences; pre-commit replies cannot land afterward with omitted options. |
| 12 | keep-incarnation's live viewer change covers omitted/false/true and clears Alice before Bob's held read; keep-reset covers local viewer resets. |
| 13 | plain createApp browser witness and default authority tests keep the child mounted until A's own deadline or its original episode cap. |
| 14 | retention-episode clear_rows/settle_exit plus real keep-incarnation/adoption/reset cases: hard resets never retain and stale work stays fenced. |

## §3.5 branch and per-call retention audit

Locations below refer to `47befc1a8` (merged main plus the review fixes), so a
reviewer can reproduce every original match. The final search has no watch
`keep` property; the remaining `options?.keep` uses preserve three values.

| Original branch/site | Final dependency |
| --- | --- |
| app-client.ts 85, 104, 113, 122, 214 (initial attach, refresh attach, hold, approve, peek) | Retain: each is `options?.keep !== false`. |
| client.ts 195 (resetKept reset), 196 (notify) | Every watch; renamed resetWatches, grouped withdrawal before notification. |
| client.ts 334 (setViewer reread), 452 (credential notification) | Every watch. Credential success rereads every watch. |
| client.ts 644 (refresh reload) | `watch.retain`, before the in-flight test; another invalidation never renews the episode. |
| client.ts 652 (skip deadline installation on loading/offline) | Removed; hard candidates replace and install their own deadlines. Ordinary reload preserves old deadlines separately. |
| client.ts 655 (resetVersion fence) | Every watch, unconditional. |
| client.ts 866 (normalize keep), local.ts 1207 (same) | Preserve undefined; observationKey chooses retain:/withdraw:/keep:. |
| local-reads.ts 130 (ordinary commit timer survival) | `watch.retain`; resets still clear timers for all watches. |
| local.ts 437 (credential reset), 497 (notify) | Every watch; clear deadlines and deliver shared reset notifications. |
| local.ts 979 (presence result deadlines), 1014 (rerun result deadlines) | Skip removed: explicit loading is hard; failed presence sampling still follows its separate existing no-publication path. |
| local.ts 992 (rerun reload) | `watch.retain`. |
| local.ts 1003 (resetVersion fence) | Every watch, unconditional. |
| observe-watch.ts 24 (peek map key) | Three policies via observationKey, combining retain and linger. |
| observe-watch.ts 48 (close reset) | `watch.linger || resetOnClose`, exactly as required. |
| observe-watch.ts 71 (release), 80 (acquire), 85 (unsubscribe) | `own.linger` only; timer bookkeeping is named `lingering`. |
| react.tsx 110/111 (observe/peek), 219 (Pages constructor) | Options passed intact; memo dependency keeps undefined/false/true distinct. |
| read-observation.ts 42 (fetch retain override) | `retain !== false && this.retain`; false wins even with linger. |
| read-observation.ts 91 (publish swallows loading) | Removed. publish always replaces; reload is the separate retaining operation. |
| ReadObservation constructor | `retain = keep !== false`, `linger = keep === true`; only retain without linger has an episode cap. |
| writes.ts 186/193/199 (`this.keep(...)`) | Unrelated durable receipt persistence method, unchanged. |

The `watch.kept` latch sites (client 632/661/668, local 762–766 in the RFC's
base; current client 639/668/675, local 767) now apply to every retaining
watch because reload sets the latch by retain, not linger. Local freshness
promotion reruns a revalidating answer instead of treating it as newly current.
The asset view's separate `this.options.keep` is unrelated to live observations
and is unchanged.

Per-call audit: local-query's ordinary `server(..., retain = true)` and
`routeLocal(..., retain = true)` now leave fetch's retain option absent. This
includes ephemeral refreshes, which formerly supplied false. The expiry retry
still calls `routeLocal(refreshed, false)` and passes `{ retain: false }`.
Online fetches defer to observation policy; one-shot reads have no watch.
`publishResult: false` never finishes a successful fallback early, and an
internal commit-interruption exception leaves withdrawal to the full rerun.
An exhausted whole read, loading candidate or explicit false remains hard.

## Qualification

Evidence directory: `snapback4/target/lane-kg-r1/` (ignored build output).
Node 24.13.1, Bun 1.3.14, Rust 1.97.0; eight Cargo jobs, dev/test debug
information disabled, fd limit 65,536. Frozen Bun installation and package
build/typecheck pass.

- Whole guide: **86 passed / 0 failed** (`guide.log`).
- Episode/authority focused set: **107/107** (`episodes.log`).
- Device/expiry regression set: **141/141** (`device5.log`).
- Default reset/clock set: **110/110** (`default-resets.log`).
- React/online/expired-reply compatibility set: **72/72** (`compatibility6.log`).
- Extended revocation, default memory and real composition set: **273/273**
  (`extended-evidence.log`); includes all six local revocation/exhaustion cases.
- Generated createApp sequences: **18/18** (`models2.log`), 427 s.
- Chromium authority witnesses: **2/2** (`browser2.log`).
- Final expiry-retry file after the full-run findings: **14/14** (`expiry-retry-final.log`).
- All five full-run finding files after correction: **59/59** (`full-findings-final.log`).
- Final immediate-revocation model: **27/27**, all **3,000 seeds**, including
  the new seed-2345 replay, 57.151 s (`online-model-final.log`).
- Reference audit: **0 errors / 0 unchecked** (`ref-check-final.log`); whitespace check passes.

These focused groups overlap; their counts must not be added as unique tests.
The full suite runs the combined set. The expanded test evidence and remaining
manual correction were completed during its Rust phase, before client discovery.
Seventeen old semantic assertions across the client tests and the immediate-
revocation model failed in that run and were then updated. The first two are
in `db86ef80c`; the remaining client assertions are in `80ed62092`. The model
now opts into its stated immediate-withdrawal policy. No runtime bytes changed
after the full suite began, and the full suite was not rerun.

Wasm: **1,981,512 B raw / 572,053 B gzip**, unchanged from merged main,
**788 B below the unchanged 572,841 B cap**. SHA-256:
`5436a3d17dc29dbee2148bbad942ddea866526e48f9d159e96be5a6c18fe1969`.
The difference from round 0 is inherited from main, not this TypeScript change.
All changed source/test files are under 1,500 lines (`local.ts`: 1,497;
extracted React test harness: 1,430).

Ran `scripts/test.sh` **exactly once**. Exact summary:
**`== 2 failure(s) in 1406 s`**, exit **1**. Failed phases: **client tests**
and **client models**.

Rust tests/doctests: **3,835 passed / 0 failed / 24 ignored** (696 s).
Main client: **2,746 passed / 16 failed / 10 skipped**; seven additional shards:
**56/56** (client phase 428 s). Final seeded models: **77 passed / 1 failed**
(244 s). Fixture wrappers: **9/9**. Native/wasm builds, docs/wasm budgets,
release guard, package typecheck/build and both app typechecks pass.

Every full-run failure is listed below. All **17 are ours**: assertions of
behavior deliberately changed by LLP 3000.023, including the schema test's use
of fresh as a proxy for a newly served answer. No failure is attributed to the
baseline or environment. Runtime bytes needed no further change.

| Failed test | Classification | Correction |
| --- | --- | --- |
| `expiry-retry-watch.test.mjs` — expiry retry remembered branch timer watch wasm | Ours | Old same-snapshot/no-notification assertion; now pin revalidating, preserved identity/freshness and replacement. |
| `expiry-retry-watch.test.mjs` — expiry retry remembered branch timer watch process | Ours | Old same-snapshot/no-notification assertion; now pin revalidating, preserved identity/freshness and replacement. |
| `maintained-column-adoption.test.mjs` — column activation: sqlite, server watch | Ours | Fresh no longer excludes the retained copy; exclude revalidating when recording newly served answers. |
| `page-authority.test.mjs` — applied revocation clears kept and remembered answers and fences in-flight server publications (post-commit failure: false) | Ours | Preserve immediate-withdrawal assertions with keep:false. |
| `page-authority.test.mjs` — applied revocation clears kept and remembered answers and fences in-flight server publications (post-commit failure: true) | Ours | Preserve immediate-withdrawal assertions with keep:false. |
| `page-authority.test.mjs` — a server-class observation uses ordinary device-fallback retention during HTTP | Ours | Default fallback preserves fresh/since and adds revalidating; update the mark assertion. |
| `page-authority.test.mjs` — a predicted membership removal clears a kept private answer before the pending send | Ours | Preserve immediate-withdrawal assertions with keep:false. |
| `page-authority.test.mjs` — predicted expireSecret: every commit clears the pending observation | Ours | Preserve immediate-withdrawal assertions with keep:false. |
| `page-authority.test.mjs` — predicted expireMember: every commit clears the pending observation | Ours | Preserve immediate-withdrawal assertions with keep:false. |
| `page-authority.test.mjs` — online client drops a heap-aborted private answer within one fetch, including after revoke | Ours | Preserve immediate-withdrawal assertions with keep:false. |
| `presence-refresh.test.mjs` — an invalidation during a background refresh withdraws at once, and the late refresh is discarded | Ours | The immediate-invalidation control now explicitly uses keep:false. |
| `server-clock-regressions.test.mjs` — syncedAt, device since and remembered server since remain wall time under +25h skew | Ours | Revalidation preserves since (including its absence); completed-read publication still clamps clock age. |
| `server-clock-regressions.test.mjs` — freshness is clamped at publication after wall time rolls back | Ours | Revalidation preserves since (including its absence); completed-read publication still clamps clock age. |
| `server-clock-regressions.test.mjs` — remembered wakeup retains data until its own server deadline (null, early=false) | Ours | Remembered data stays with preserved identity/freshness and a revalidation notification. |
| `server-clock-regressions.test.mjs` — remembered wakeup retains data until its own server deadline (null, early=true) | Ours | Remembered data stays with preserved identity/freshness and a revalidation notification. |
| `server-clock-regressions.test.mjs` — remembered wakeup retains data until its own server deadline (600, early=false) | Ours | Remembered data stays with preserved identity/freshness and a revalidation notification. |
| `online-client-model.test.mjs` — online clients preserve R1–R6 across 3,000 seeded interleavings (seed 2345, client) | Ours | R1 pins immediate withdrawal; its observations now use keep:false, preserving the strict invariant. Added a named seed-2345 replay. |

The first two failures were independently reproduced with
`node --test --test-name-pattern='remembered branch timer'
packages/snapback4/test/expiry-retry-watch.test.mjs`; the final whole file passes
14/14. The five affected files then pass together: **59 passed / 0 failed**, in 11.641 s (`full-findings-final.log`).
The full model file then passes **27/27**, including all **3,000 seeds** and
the new seed-2345 replay, in 57.151 s (`online-model-final.log`), committed as
`6c0dec7f0`. The full-run red is preserved; it is not relabeled as green, and
the whole suite was not rerun. No unresolved lane failure remains.

## Decisions, deviations and open problems

Engineering choices: a WeakMap carries the absolute host timestamp alongside
the existing answer identity; a small latch owns timer/access checks; raw and
facade holds have independent latch state but share the timestamp by value.
This avoids adding an exported deadline field or coupling a late result to a
reset. Shared notification deferral preserves the two-phase withdrawal invariant
through raw reset batches and the existing expiry sweep. Pages and the browser
harness were extracted to stay within the source-size rule.

The accepted RFC deliberately supersedes round 0's scope, mark, source-B-expiry
exception and default-withdrawal assertions. Tests of the old immediate behavior
now request false; tests of retention assert revalidating without changing fresh
or since. There is no design deviation, engine authorization change, cap increase
or stopped design part. No new public option, external service or dependency.

Resolved lane-authored development failures included stale semantic assertions,
fixture timing/gating mistakes, an owner-transfer fixture initially sent by the
wrong owner, the new retry fixture's count syntax, and internal fallback
interruption briefly publishing loading. These were corrected and their focused
suites passed; expected negative-control failures are evidence, not suite failures.
Full-suite failures and any remaining issue are recorded with the result above.
The inherited 60-second complete-suite budget is still exceeded (reproduce with
`cd snapback4 && bash scripts/test.sh`); no test timeout or budget was raised.
This is an existing runtime-budget gap, not a failing product assertion.

Orientation: used llp-orient, the Snapback 4 fence (LLP 3000), 3000.023 §§3–6,
3000.019 §3.3, 3000.018 §3.2 and 3000.013 §6, plus the current client manual.
No unresolved design hand-off. Every lane commit carries the required
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` trailer.

Round-1 commits: `9c131c4eb` (merge), `47befc1a8` (review fixes),
`53e2ea798` (RFC implementation and regression coverage), `4dd0aa619`
(generated actions and browser witnesses), `db86ef80c` (the first two full-run
assertion corrections), `80ed62092` (the remaining assertions, 59/59 final),
`6c0dec7f0` (immediate-revocation model and full seeded rerun), followed by
the evidence commit.

---

# Historical round-0 report

# Lane KG — kept answers through replacement authority

Branch: `sb4-intent/kg-kept-through-authority`, based on `9473e0a34`.
No push or package publication.

The facade keeps its last authorized answer while a replacement awaits
`authorized()`, with `fresh: false` and the original `since`. It shows the
replacement only after authority, refuses immediately when the check refuses,
and withdraws the held answer at its own deadline. Non-kept observations keep
their immediate replacement withdrawal.

## Implementation, file by file

All package paths below are relative to `snapback4/packages/snapback4/`.

| File | Change |
| --- | --- |
| `src/app-client.ts` | Attach shared approvals to kept observations, reuse them for peeks and opening remounts, gate replacement publication, reject held answers on opening or replacement authority failure, and release them on facade fencing. A refresh revision prevents an older check from publishing after a newer raw event. |
| `src/read-approval.ts` | New internal helper: one approved snapshot per facade/live raw watch. Carries stale metadata, listens for raw changes, owns one expiry registration, and shares notifications with remounts. Raw reset/close removes the registration; there is no separate retention window. |
| `src/read-observation.ts` | Weakly associate snapshots with their owning watch, preserve identity through freshness copies, expose the original freshness time, and notify internal followers about answers, scope resets and expiry. |
| `src/read-expiry.ts` | Attach held deadlines to the raw watch and include them in its existing timer/clock-correction sweep. Withdraw all due holds before any subscriber runs. Local reobservation wakeups do not expire remembered server data. |
| `src/client.ts` | Distinguish expiry of an online raw answer from a scope-ending reset. |
| `src/local.ts` | Make the same distinction for local reads, preserving immediate denial and existing remembered-answer expiry fencing. |
| `test/keep-observation.test.mjs` | Replace the old kept-answer withdrawal expectation; retain the non-kept control and reset/identity checks. |
| `test/keep-authority.test.mjs` | Add deterministic authority, deadline, remount, rollback, reset and opening-storage-error regressions. |
| `test/keep-app-expiry.test.mjs` | Exercise held expiry on a real wasm client, fence a late HTTP memory write across rollback, and recover newer B through the public client. |
| `test/keep-app-model.test.mjs` | Add six generated action sequences on the real server with online/wasm clients and delayed authority. |
| `test/keep-authority-react.test.mjs` | Add a real Chromium/React regression for both kept hooks and local input state through 20 replacements. |
| `CLIENT-AND-OPERATIONS.md` | Document held replacement authority, original deadlines, remount peeks and unchanged non-kept behavior. |
| `llp/3000.019-what-the-builder-still-wrote.rfc.md` (repository root) | Update §3.3 and the Revised header with the implemented contract. |

The journal entry and this report record qualification. `app.ts` and
`observe-watch.ts` need no edit: the existing authorization checks and raw
30-second linger lifecycle are reused.

## Forms that compile and run

No new public API or Quarry spelling:

```ts
const watch = app.client.observe(api.thread, { conversationId }, { keep: true });
const query = useQuery(api.inbox, {}, { keep: true });
const page = usePage(api.thread, { conversationId }, { keep: true });
const immediateWithdrawal = app.client.observe(api.inbox, {});
```

The first three preserve an approved answer during replacement authority.
The fourth retains the existing immediate withdrawal behavior.

## Tests and measurements

- `keep-observation.test.mjs`: 32 passing cases, including both `keep` settings
  for A → B with B's authority blocked; A stays stale only with keep, expires
  on a clock sample at its own deadline, and B appears after authority.
- `keep-authority.test.mjs`: 13 passing cases. Device and server deadlines
  each use timers and clock samples; opening remounts receive expiry even
  before their initial check completes; rollback cannot resurrect A;
  device wakeups do not expire remembered server data; B's earlier deadline
  cannot expire A; all held answers withdraw before callback-driven rollback;
  resets, denial, failed authority, fencing and linger close release holds;
  an opening storage error denies all subscribers instead of preserving data.
- `keep-app-expiry.test.mjs`: 1 passing wasm/createApp regression. Held A
  expires while raw B awaits authority; callback-driven clock rollback and a
  late higher-cut memory write cannot resurrect A, and public offline recovery
  still returns B. A process-local module-loader negative control that removes
  only the held-memory callback fails: the cache contains A instead of B.
- `keep-app-model.test.mjs`: 6 passing sequences, seeds 23, 44 and 445 on
  both online and real wasm clients. There are 108 generated actions total:
  remote changes, bursts, local writes, remounts and, on wasm, offline
  predictions and settlements. Every session-store read during those actions
  waits 50 ms. Assertions inspect every published snapshot after initial data,
  confirm actual sync pages/predictions/settlements, and require close to
  withdraw the answer.
- `keep-authority-react.test.mjs`: Chromium renders a kept `useQuery` editor
  and kept `usePage` editor, types distinct drafts, then delivers 20 server
  replacements under delayed authority. Both inputs preserve their text,
  each editor mounts once, stale data renders, and no loading commit occurs.
  Negative control: replacing only `app-client.ts` with the source at
  `9473e0a34` fails on replacement 1: empty text instead of `query draft`.
  The modified source was restored before qualification.
- Existing keep/clock/device/expiry/reset/adoption/incarnation/ephemeral
  regressions: 100 passing tests, including wasm and process-device coverage.
- Whole guide: 86 passed, 0 failed. Package typecheck/build pass. No diagnostic
  code or guide card was added. Source files changed here remain under 1,500
  lines (largest: `local.ts`, 1,477).
- Wasm, by `scripts/build-wasm.sh`: 1,980,253 B raw / 571,810 B gzip, unchanged
  from this lane's initial build, 1,031 B below the unchanged 572,841 B cap.
  SHA-256: `324a54065e8d7077fe63e1d73dd26b24db29d8e8583d8a35753643f106c3fecc`.
  There are no Rust or engine changes and no change to meters.

Ran `scripts/test.sh` exactly once. Exact summary: **`== 0 failure(s) in 1382 s`**,
exit **0**. No introduced, baseline or environmental suite failure. Rust tests
and doctests: **3,809 passed / 0 failed / 24 ignored**, 906 s. Client main:
**2,503 passed / 0 failed / 10 skipped**; seven additional shards: **56/56**,
client phase 197 s. Final seeded models: **78/78**, 260 s. Fixture wrappers:
**9/9**. Builds, typechecks, docs/wasm budgets and the release guard all pass.
The complete guide test runs both independently and in the full suite.
Reference audit: `./ref-check --verbose` passes with zero errors/unchecked.
Evidence logs are under `snapback4/target/lane-kg/` (ignored build output).

Node 24.13.1, Bun 1.3.14, Rust 1.97.0; eight Cargo jobs, dev/test debug
information disabled and file limit 65,536. Frozen Bun installation passed.
The opening-refusal and fallback-memory hardening landed while the full suite
was in its Rust phase. The final package was typechecked and rebuilt before
the client phase; that phase ran every final runtime and test change.

## Decisions, deviations and remaining work

Chose to keep the superseded answer's deadline attached to the raw live watch,
rather than add a separate facade clock subscription. This preserves the
existing two-phase expiry sweep: every due answer is withdrawn at one captured
clock sample before any notification can roll the estimated server clock back.
The facade holds at most one approved answer per live watch, shares it across
remounts, and releases it when the raw watch resets/closes or the facade fences.

The internal `read-approval.ts` module and the online/local expiry distinction
are engineering choices within the brief. A replacement expiring earlier is
not a scope reset and must not expire a still-valid held answer. No public
contract, engine authorization, disclosure, durability, meter, version or
budget change was needed. There is no design deviation or stopped design part.
No open problem or reproduction remains after qualification. Both intentional
negative controls fail as expected; the full suite has no failures to classify.

The first generated-test draft incorrectly treated `/changes` as a POST,
and the first browser draft tried a mutation without browser durable
admission. These were test-harness defects. The initial browser harness also needed a
Vite alias for React’s JSX development runtime, and typechecking caught two
new internal type declarations that needed correction. All were corrected
before the full suite’s client phase; the final tests use the real change-feed
GET and browser server notifications. These are resolved lane-authored
development failures, not baseline or environmental failures.

## Orientation and scope audit

Applied the repository's `llp-orient` skill after initializing the missing
`vendor/llp` submodule. Governing constraints: LLP 3000 (Snapback 4 fence),
LLP 3000.019 §3.3 (keep, expiry, remount and reset), LLP 3000.018 §3.2
(background refresh and remembered expiry), and LLP 3000.013 §6 (facade
lifetime/authority). 3000, 3000.013 and 3000.019 are in `llp/current`; none is
in `foundation`. The lane brief supplies the accepted amendment to keep
through authority. Documentation updates are confined to §3.3, the client
manual, append-only journal and this evidence report. No further LLP hand-off.

## Commits

- `c1d5ff653` — keep approved app answers through replacement authority.
- `5b4e63249` — generated createApp and React editor regressions.
- `f1bfec08e` — opening authority errors withdraw shared held answers.
- `4b97bf06b` — held expiry fences fallback memory before clock rollback.
- Final evidence commit — this report and the single append-only journal entry.

Every commit includes the required GPT-6 Astra co-author trailer. No push,
publication, version bump, budget increase, full comparative, or Apple UI run.
The supervisor's independent reviews and integration remain external to this lane.
