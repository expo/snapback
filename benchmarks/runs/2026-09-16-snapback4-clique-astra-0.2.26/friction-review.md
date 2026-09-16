# Clique on snapback4@0.2.26: evidence-bound friction review

| Rank | Item | Attribution | Score affected | Recoverable value per engineering effort | Already ships? | Smallest useful change |
|---|---|---|---|---|---|---|
| 1 | **A1 — Missing application wiring and error handling** | **Agent error** | O2: two minor defects, two cosmetic defects, and the swallowed-refusal part of d-01 | High: concrete defects with small application fixes; no Snapback feature work | Yes | Wire chat links, display failed follows, resolve DM counterparts in search/API documentation, document Insights counting semantics |
| 2 | **H1 — Promotion silently stops delivery to a saturated follower** | **Snapback recipe limitation**; separate application error above | O2’s one **major** defect; relevant to queries and scale | High: independently reproduced lost delivery, with a bounded mitigation; full graph support is larger work | The problematic behavior ships and is documented | Make promotion fail atomically with an actionable capacity refusal when an existing follower cannot receive a route; retain the previous delivery state |
| 3 | **H2 — Orientation still requires reading too much before M1** | **Snapback ergonomics**, not misleading documentation | `setup_and_docs` **85 → 89**, correcting the run README | Plausible return from a small documentation change; no isolated time measurement | The document map ships; a short, sufficient Expo onboarding path is not established | Narrow the existing “Start here” path to the account/profile/asset/replica decisions needed for the first working screen |
| 4 | **H3 — Optional server search uses the unbatched form despite a shipped bounded alternative** | **Agent implementation choice** over a real Snapback execution constraint | `queries_and_live` 82; `scale_and_limits` 83 | High for correcting this app; weak evidence for new engine engineering | **Yes:** held search and the two-cursor server walk | Use the existing membership-batched server form; package that form for adoption only if another cold builder misses it |
| 5 | **H4 — Fresh Trending requires handwritten transactional ranking maintenance** | **Snapback expressiveness/authorization design gap**; server-placement correction is agent error | `data_modeling` 84; `queries_and_live` 82 | Meaningful recurring burden, but not a one-line implementation | Scheduled ranking and bounded live sorting ship; the requested combination does not | First decide the authority of synchronous derived writes; meanwhile publish the exact fresh-ranking pattern the builder had to assemble |
| 6 | **H5 — Replica acquisition remains substantial and poorly decomposed** | **Snapback model cost plus application residency choices** | `scale_and_limits` 83; `client_integration` 88 | Measurement is cheap; an optimization’s point return is presently unknown | Residency measurement ships and was not demonstrably used | Obtain per-table acquired rows/bytes for this app before changing synchronization or the engine |
| 7 | **H6 — Durable pending UI needs application view metadata** | **Documented application responsibility**; observed failure remains **ambiguous** | `offline_sync` 92; `client_integration` 88 | A small example could save work; evidence does not justify an outbox repair | Outcome observation and pending hooks ship; a durable multi-message view example is not established | Publish the saved-write-ID rendering pattern without adding another submission authority |
| I1 | **Harness packaging aborts otherwise productive builds** | **Instrument** | No score for attempt 1; reproducibility of every category | First instrument priority; not a recoverable Snapback deduction | A sanctioned layout existed, but the copied directory was not self-contained | Ship a copyable harness with its actual validator dependency and fixed relative layout |
| I2 | **Score provenance and missing proof distort comparisons** | **Instrument / evidence coverage** | O1, O3, O4, O5; erroneous category comparisons | Repair measurement before spending against these numbers | Native witness tooling exists; the required artifacts and several instrument inputs do not | Correct the comparison table; predeclare simulator coverage, freeze probes and timing rules, and represent M8 in the report schema |

The numbered ranking orders concrete repair value against implementation size. It does **not** assign invented point estimates: the holistic scorer supplies category scores, not per-incident deductions. Instrument items have a separate priority because repairing measurement is not equivalent to improving the backend.

## Evidence conventions and corrections

References below use:

- **R26** = `benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.26/`.
- **R25** = `benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.25/`.
- **L26** = `/Users/ccheever/clique-sb4-20260916-astra-cal10/lanes/astra-snapback4/`.
- **L25** = `/Users/ccheever/clique-sb4-20260916-astra-cal9/lanes/astra-snapback4/`.

The local L26 run log matches the archived `R26/astra/lane-run-log.md` byte for byte. Installed package files and saved evidence were inspected; no application, benchmark, compiler, or test was executed.

**The setup premise needs correction.** The actual [0.2.25 scorer file](/Users/ccheever/projects/snapback-w4b/benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.25/astra/FINAL.md:14) says:

> `"score": 85`

Its explanation names the README, client reference, keyword cards, and generated API. The new scorer gives 89. Therefore **setup improved four points**, not declined one. The previous friction review agrees with 85; `R26/README.md:54` is the inconsistent source.

Other baseline entries are also wrong. Reading the two scorer files directly gives:

| Category | 0.2.25 | 0.2.26 | Change |
|---|---:|---:|---:|
| Overall | 91 | 90 | −1 |
| Setup and docs | **85** | 89 | **+4** |
| Data modeling | 88 | 84 | −4 |
| Authorization | **96** | 97 | +1 |
| Queries and live | 86 | 82 | −4 |
| Writes and transactions | 95 | 96 | +1 |
| Offline sync | **95** | 92 | −3 |
| Media assets | **98** | 97 | −1 |
| Background work | **96** | 95 | −1 |
| Client integration | **89** | 88 | −1 |
| Diagnostics/dev loop | 94 | 95 | +1 |
| Scale and limits | 87 | 83 | −4 |
| Operations | **88** | 88 | 0 |

Sources: `R25/astra/FINAL.md:10–60` and `R26/astra/FINAL.md:10–60`. The three four-point drops are real entries in the score files. Several surrounding trends in the run README are not.

**Passing assertions do not mean no defects.** The JSON contains **85 pass, zero fail, 16 not-run**. Its separate defect list contains one major, two minor, and two cosmetic defects. Its notes also report the M8 sidecar: **16 pass, two not-run**, producing **101/119** overall. Those totals are distinct from holistic 90.

The M6 seven not-run assertions require native simulator artifacts; they are not seven failed web checks. `R26/astra/grader-report.json:867–878,1130` explains this distinction.

## 1. A1 — Fix the application defects in the application

**Attribution: agent error. Already-supported behavior was omitted.**

The cheapest verified improvements are not backend changes.

| Defect | Verbatim evidence | Smallest repair |
|---|---|---|
| Chat links do nothing | `R26/astra/grader-report.json:825`: “Bubble never passes onPressLink to the kit's MessageBubble.” | Pass the link handler, as the post UI already does |
| Follow refusal disappears | `grader-report.json:814`: “the profile follow button discards the failed write with no message.” | Observe the returned write and render its refusal |
| DM search labels are indistinguishable | `grader-report.json:835`: “global message search shows the same 'DIRECT MESSAGE' header for every DM group.” | Resolve and display the other participant |
| Custom-client instructions cannot identify a named DM | `grader-report.json:845`: “API.md doesn't document how to resolve a DM's counterpart” | Document principal-to-profile resolution using the existing operations |
| Insights interpretation is unstated | `grader-report.json:855`: “Both are defensible readings, but they are undocumented.” | State whether self-activity counts and whether “posts” excludes replies |

The follow callback confirms the omission: `L26/src/Main.tsx:28` calls `client.mutate(api.setFollow, …)` without handling its result. The SDK’s documented failed-write rendering already exists in `L26/node_modules/snapback4/CLIENT-AND-OPERATIONS.md:365–375`.

**Score:** O2 is **65**, versus 78 in the previous review. The grader associates that score with the complete defect bundle, including H1’s major defect (`grader-report.json:869–872`). It does not price these small fixes separately. Nor did the narrative-only holistic scorer necessarily see these later grader findings.

**Engineering implication:** repair the reference application and its acceptance coverage. Do not turn missing `onPressLink`, DM labeling, or ignored write results into new Snapback runtime projects.

## 2. H1 — A shipped recipe silently abandons an existing follower

**Attribution: Snapback recipe limitation. The missing refusal UI is separately agent error.**

This is the strongest new correctness evidence in the run, although the builder never encountered it during the ordinary fixture replay.

The grader reports:

> “The reader still shows as following, but the author's new posts never reach their Following feed.”

— `R26/astra/grader-report.json:814`.

The isolated reproduction is specific:

> “50 more followers then made Q popular. The reader still shows `following: true`.”

> “Q's next post **is not in the reader's Following feed**, but it is in Global and in a fresh follower's Following feed.”

— `L26/grading/trace.md:199–200`.

The reader already held 32 shared-author pull slots. Promotion switched Q to shared delivery, but failed to install that reader’s route.

### It is shipped behavior, not an accidental application rewrite

`L26/snapback/feed.q:137–138`:

```quarry
if used = 32:
  return false
```

`feed.q:155–159` updates the author to shared, then calls `feedTryPull` for followers without requiring success.

The published guide is unusually candid:

> “A skipped follower keeps old private entries but receives no later broadcast from this author until they free a slot and unfollow/refollow.”

> “`complete` covers the installed lanes, not skipped authors”

— `L26/evidence/guide-feeds.txt:358–362`.

Thus this is **not misleading documentation or a newly discovered interpreter bug**. It is a documented recipe policy that produces an unacceptable silent product outcome. Documentation does not make that outcome the builder’s invention.

The L25/L26 recipe comparison leaves this promotion logic unchanged. Differences are author/global routing caps, the backfill literal, and the repost parameter rename. **This is not a wave-10 regression.** This grader exercised an older edge.

### Cost and smallest change

**Builder cost:** none recorded; the fixture’s popular-author distribution did not hit it.

**Points:** the grader’s sole major O2 defect. The whole O2 defect bundle moved 78 → 65; attributing all 13 points to this one item would overstate the evidence.

**Smallest mitigation:** require successful route installation for every existing follower before committing promotion. On failure, roll back the triggering follow/promotion transaction and return a clear capacity refusal. The previously valid pushed-delivery state remains intact. The application must display that refusal.

This changes an intentional saturation policy and should be stated as such. It does **not** provide arbitrary support for more than 32 shared authors. If that broader graph is required, the serving model needs a separate design. Raising `cap 32` alone is insufficient because the query width and meter are coupled to it.

## 3. H2 — The setup fix worked; first-screen orientation remains too broad

**Attribution: Snapback ergonomics. No misleading documentation established.**

The builder says:

> “The largest orientation cost was the broad published README, which made the auth/asset/replica responsibilities explicit.”

— `R26/astra/lane-diary.md:4`.

The run log shows where that cost actually landed:

> `1789586426 knowledge-lookup source=package-README/guide attribution=environment evidence=evidence/guide-language.txt; read README.md and CLIENT-AND-OPERATIONS.md fully; exact pins installed`

— `R26/astra/lane-run-log.md:10`.

This is a **full-document reading cost during M1**, not a later search for a missing API. The log’s `attribution=environment` does not record a Snapback defect; the diary supplies the subjective orientation judgment.

From the lane origin to that entry is 206 seconds. That interval also contains fixture reading and installation. It is **not** a measured 206-second documentation tax. M1’s retained green is 390.284 seconds from origin (`lane-final-report.md:11,20`); again, that includes implementation and verification.

### Addressable, but not by splitting the reference again

The new opening explicitly identifies all three documents and their roles:

> “This `README.md` covers the app layout, Quarry and sync (§1–3).”

— `L26/node_modules/snapback4/README.md:21`.

Lines 22–25 name the client reference and `SERVER.md`. Lines 32–43 provide “Start here,” including the client and cold-offline shell responsibility. The old false claim that the README contained the whole surface is gone.

The remaining problem is that the entry path still introduces a large map of language, rules, sync, residency, prediction, reads, writes, replay, effects, jobs, clocks, personas, assets, actions, and routes. The builder responded by reading both principal documents completely.

**Inference:** the addressable cost is deciding what can safely wait. The run does not show that the reference itself should be shorter or that its important semantics can disappear.

The smallest useful change is an **explicit stopping point within the existing opening**:

1. Choose the Expo/local-replica starter.
2. Enable identity and persist the session.
3. Declare the profile rule and avatar home.
4. Open the correct platform client/device.
5. Render loading, failed, pending, and sent states.
6. Reach the first working account screen; defer feeds, search, schedules, and server handlers until those features are needed.

That is a task path through existing material, not another guide corpus.

### Judgment on the README’s interpretation

I agree that findability improved and broad orientation remains a real reported cost. I disagree with treating **90 → 89** as evidence that the fix bought little: the actual move is **85 → 89**.

I also would not reopen the 1,500-line exception on line count alone. The installed README inspected here has 1,566 lines; the run README names 1,562. Neither number measures learning cost. The evidence supports testing a shorter **required first read**, not another reference split.

**Expected return:** plausible setup improvement from a small change. The entire remaining 11-point gap is not recoverable documentation waste.

## 4. H3 — Search hit an existing bound through a different application shape

**Attribution: agent choice of server-query shape; Snapback owns the bounded-query learning burden.**

The final diagnostic states exactly what is bounded:

> “the merge over messages reads up to 1000 lanes, one page of 21 each — up to 21000 rows per read; a read past the 8,192 examined ceiling returns `complete: false`”

— `L26/evidence/final-check.log:6`.

This is **not a fixed platform rule that server search stops at 1,000 chats**. It is a worst-case meter warning for this app’s single merge over up to 1,000 memberships.

The run-log attribution is:

> `knowledge-lookup source=diagnostic attribution=environment evidence=evidence/why-wide-merge.txt; global UI uses held indexed search; server scope is metered`

— `R26/astra/lane-run-log.md:39`.

The builder understood the limitation and kept it in an optional server API. The required scale probe used 100 chats; the UI used held search (`lane-final-report.md:93`). No 1,000-chat runtime failure was established in this run.

### The alternative already ships—and L25 used it

L26 uses:

```quarry
[m.conversationId] for m in members[viewer] first 1000 by byPrincipalChat
```

— `L26/snapback/chat.q:260`.

L25 instead declared separate `searchChats` and `searchBatch` operations, paging memberships 50 at a time (`L25/snapback/chat.q:236–240`).

The installed guide gives that same two-cursor form:

> “Only then advance `batch` to the saved membership `next` and reset `c = null`.”

— `L26/evidence/guide-search.txt:176–177`.

It also records a measured 1,000-membership walk (`guide-search.txt:219–225`). This is stronger evidence than attributing the score drop to a new platform ceiling.

**Smallest change:** adopt the published batched server walk. Preserve the guide’s caveat that meter- or word-cut batches cannot simply be advanced and called exhaustive (`guide-search.txt:193–206`). Held search is already the successful UI path.

**Score:** explicitly named under queries and scale. The four-point movements cannot be split into implementation-shape effects and scorer variance with N=1.

**Next-wave implication:** do not raise ceilings. If making the existing server form easier to adopt is desired, an installable search recipe is a smaller and better-supported experiment than engine work.

## 5. H4 — Trending’s remaining burden is precise and recurring

**Attribution: Snapback design gap; one execution-placement correction is agent error.**

The builder says:

> “The immediate Trending index required explicit source-write maintenance; the published scheduled recipe permits score lag and therefore did not meet this brief's load-time freshness.”

— `R26/astra/lane-diary.md:25`.

The essay adds:

> “I used a ranking row maintained in the source write transaction, expiring with the post's rolling window, and made the read depend on server time.”

— `lane-essay.md:25`.

### What the builder implemented manually

The final code contains all of the following:

- A separate `trendingRows` table with post reference, score, timestamp, expiry, unique post index, and score ordering (`L26/snapback/insights.q:27–40`).
- Creation of a zero-score ranking row alongside each original post (`schema.q:118–120`).
- A like-state transition check and incremental ranking update in `setLike` (`schema.q:122–132`).
- An initial-data backfill job (`insights.q:43–48`).
- Expiry at the original post’s trailing-day boundary.
- A server-time-dependent query, with cursor and deterministic score/time/post ordering (`insights.q:33,41–42`).
- Broad principal write rules on the ranking table:

```quarry
insert <- allow
update <- allow
```

— `insights.q:37–38`.

That is real application design and duplicated derived-state maintenance. It is not merely adding an index declaration.

### Separate the design work from the correction loop

The placement repair is explicitly attributed:

> `correction-loop M8 attribution=agent-error evidence=snapback/generated/api.ts; Trending was device-run; added server-now eligibility filter to enforce screen-load server freshness`

— `R26/astra/lane-run-log.md:76`.

Do not relabel that loop a platform failure.

M8’s retained-green wall was 726.019 seconds (`lane-final-report.md:17`). It includes aggregates, digests, proofs, navigation repair, and pending-view work. There is **no isolated Trending time measurement**.

The final prediction summary names `setFollow` as never predicting; it does **not** name `createPost` or `setLike` (`L26/evidence/final-check.log:20`). Older reviews’ claim that Trending costs those operations prediction must not be carried into this run.

### Why the existing alternatives do not remove this work

The shipped scheduled recipe explicitly says:

> “scores and new candidates lag by one schedule period”

— `L26/evidence/guide-feeds.txt:870`.

It keeps ranking writes denied to principals and lets the job maintain them (`guide-feeds.txt:831–854`).

The immediate `trendingNow()` alternative sorts a bounded candidate scan. The guide says a day or nested reads past the meter yield an incomplete set (`guide-feeds.txt:887–894`). It is not a general replacement for the fresh indexed ranking used here.

L25 already had the same essential application solution: a public expiring `ranked` table with `insert/update <- allow`, `refreshRank`, source-write calls, and a rebuild job (`L25/snapback/insights.q:26–50`; `social.q:90,99`). This makes a 0.2.26 regression claim untenable.

The earlier system-owned-write proposals recur in the 0.2.21, 0.2.22, and 0.2.23 reviews; the 0.2.24 and 0.2.25 reviews retain the widened-table residual. Counting deferrals is less useful than recognizing that the same unresolved authority boundary remains.

### The decision needed before implementation

A generic `system update` spelling would introduce authority, not just convenience.

The narrow decision is:

> May an authorized source mutation cause a declared, deterministic derived-table update in the same transaction under engine authority, while ordinary principal writes to that target remain denied?

A sufficient design must specify:

- Which source transitions and target fields the declaration authorizes.
- That callers cannot supply arbitrary target keys or scores.
- How source authorization is checked before derivation.
- How derived work consumes the existing transaction meter.
- Whether the derived effect participates in device prediction, and what inputs it requires.
- How the ranking expires, backfills, and becomes server-fresh without a schedule lag.

**Recommendation:** prefer a narrow declared derivation for this ranking over an unrestricted privileged helper. The exact syntax is not established by this run.

A smaller documentation-only change can publish the fresh transactional pattern that already works. That saves rediscovery but **does not close** the authorization design gap or eliminate handwritten maintenance.

**Score:** the strongest recurring explanation for some of the data-modeling/query deduction. Exact recoverable points remain unknown.

## 6. H5 — Acquisition costs are real; optimization attribution is missing

**Attribution: Snapback’s replica model and the app’s explicit residency choices.**

The builder reports:

> “Public social sync deliberately acquires the public corpus; cold-sync evidence measures that cost.”

— `R26/astra/lane-final-report.md:93`.

Measured observations:

> “M8 cold sync: 6114.413ms; observed Node-client-plus-replica peak RSS: 384288KiB, excluding backend.”

— `lane-final-report.md:49`.

That is approximately 375 MiB of **Node client plus replica process RSS**, not wire bytes, table storage, or an iOS memory measurement.

The feed recipe, posts, likes, and ranking rows use public sync. Six maintains also inherit sync (`L26/evidence/final-check.log:10–18`). The evidence does not identify which component dominates memory or acquisition.

### Wave 10’s measurement pointer still did not establish uptake

Installation printed:

> `cold rows: snapback4 test --residency --fixture <fixture-directory> --as <principal>`

— `L26/evidence/m2-feed-recipe.log:2`.

No residency report was found in the saved evidence, and the run log records no invocation. The final report provides wall time and process memory, not per-table acquired row/byte totals.

**Smallest next change:** measure this app’s residency breakdown using the existing facility and a usable fixture. Only then decide whether an application maintain should become online-only or whether a platform acquisition optimization is warranted.

**Score:** scale and client integration. There is no demonstrated 0.2.26 acquisition regression: the prior report recorded 8.29-second cold acquisition, but the different application and measurement conditions prevent a causal speed comparison.

## 7. H6 — Pending UI caused work, but the failed behavior remains ambiguous

**Attribution: documented application work; unresolved incident attribution.**

The run log is explicit:

> `correction-loop M8 attribution=ambiguous … repeat harness saw missing offline bubble while independent dual-client reproduction passed; added durable pending-view fallback for SDK queued-without-row outcomes, never resubmitting from view metadata`

— `R26/astra/lane-run-log.md:78`.

The resulting implementation is an eleven-line `src/pending.ts` ledger that persists view metadata, observes SDK write IDs, and removes terminal entries. Its boundary is stated in the code:

> “The SDK outbox owns submission, ordering and retry.”

— `L26/src/pending.ts:3`.

Existing client documentation already tells builders to keep the mutation ID and recover through `usePendingWrite`, `client.write`, and `onWrite`, without resubmitting (`CLIENT-AND-OPERATIONS.md:357–388`).

**Smallest useful change:** a concrete durable list-of-pending-messages example using those APIs. The current example primarily demonstrates a pending send control.

**Not justified:** changing outbox delivery, claiming a lost-message defect, or counting the ambiguous reproduction as a confirmed regression. The independent reproduction passed, and the builder explicitly declined that attribution.

**Score:** offline and client integration mention the view-state responsibility. Native simulator behavior remains unproven and must stay separate.

## 8. Friction that should not become Snapback engineering

The final report’s enumerated corrections contain **14 agent-error entries and one ambiguous entry**. Additional environment and authoring incidents occur in the run log. Those counts are not a backend defect total.

Examples with primary attribution:

| Incident | Primary evidence | Consequence |
|---|---|---|
| Wrong pagination property | `lane-run-log.md:46`: “attribution=agent-error … custom API pagination corrected to Read.next, not cursor” | One adapter correction; the correct contract already ships |
| Changed arguments under a stable retry ID | `lane-run-log.md:45`: “attribution=agent-error … reuploaded media under same write id causing E_ID_REUSED” | Correct refusal, not broken idempotency |
| Reads inside a presence-controlled effect branch | `lane-run-log.md:43`: “attribution=agent-error … moved variable-cost reads outside effects-only presence branch to restore prediction” | Correct eligibility diagnostic and local repair |
| Schedule seconds rather than supported units | `lane-run-log.md:65`: “attribution=agent-error … converted config seconds to equivalent minutes” | Syntax correction, not a missing scheduling capability |
| Lazy device import during offline reload | `lane-run-log.md:29`: “attribution=agent-error … use platform-resolved static device import” | Client startup repair |
| Concurrent verification changed the corpus | `lane-run-log.md:21–23` | Serialize those tests; no backend concurrency defect established |
| Navigation, draft clearing, JSX, warning overlays | `lane-run-log.md:17,27–34,67` | Application fixes |
| Earlier M8 receipts overwritten | `lane-run-log.md:85`: “reporting-limitation attribution=agent-error” | Limits reconstruction; does not license invented timestamps |

The schedule diagnostic was concrete:

> `E_QUARRY_SYNTAX: a period is a number and m, h or d: 2m, 1h, 1d`

— `L26/evidence/proof-backend.stderr:114`.

These incidents support improving examples where repetition warrants it. They do not support loosening prediction semantics, adding a second pagination property, weakening write-ID checks, or expanding schedule syntax merely to erase a correctly diagnosed mistake.

## 9. Instrument defects and the aborted attempt

### I1 — A non-self-contained harness creates divergent builder behavior

Attempt 1 records:

> `error source=diagnostic attribution=environment … frozen harness imports absent lib/json-schema.mjs; exact ERR_MODULE_NOT_FOUND persists with full arguments and Node 24.18.0.`

— `R26/attempt-1-aborted/run-log.md:25`.

It then records:

> “M1 aborted — no first-green; frozen choreography cannot start. Non-green cause=instrument.”

— `attempt-1-aborted/run-log.md:34`.

The successful attempt records:

> `workaround source=fixture attribution=environment … isolated copied harness with AJV schema validator dependency; no check logic modified`

— `R26/astra/lane-run-log.md:18`.

The run README adds an important qualification: the sanctioned flattened layout’s `lanes/lib/` existed throughout, while attempt 1 copied the harness one level deeper (`R26/README.md:26–33`). Therefore the strongest established statement is **copy-layout/dependency fragility**, not that the validator was absent everywhere on the machine.

The aborted lane consumed **751 seconds of total elapsed work**, including implementation and finalization (`attempt-1-aborted/final-report.md:7`). That is lost scored work, not 751 measured seconds spent debugging the import.

**Smallest repair:** distribute the copyable harness with its real dependency closure and one supported destination layout. Validate that packaged layout before the next frozen run. Do not rely on a builder deciding whether fabricating an AJV adapter is allowed.

The recovered native-package registry refusal remains ambiguous (`attempt-1-aborted/run-log.md:12,30`). It is not evidence of a lasting Snapback installation defect.

### I2 — Missing proof and unstable scoring are not backend failures

`R26/astra/grader-report.json:1130` states:

> “no holdout probe set was committed”

and:

> “The frozen schema admits only m1–m7 ids”

The consequences are concrete:

- **O3 is null**, not an authorization failure.
- **M7’s nine assertions are not-run by scope**, not evidence that migrations fail.
- **Seven M6 and two M8 native assertions lack simulator artifacts.** Hermes exports and Node-replica proofs do not satisfy them.
- **O4 is 35**, versus 10 in the previous review, without newly supplied simulator evidence. Do not call this a 25-point offline-runtime gain.
- **O5’s band 30 is provisional.** It comes from a 0.097 ms Insights mid-curve miss under an unfrozen, incompletely calibrated instrument.

The builder’s attribution is:

> `observation attribution=ambiguous … literal Insights mid-curve timing bound missed (1.915ms versus 1.818ms); no O5 pass claim, concurrent replay host-load caveat retained`

— `R26/astra/lane-run-log.md:92`.

The holistic scorer correctly says that miss “is not charged” (`astra/FINAL.md:56`). The grader applies the literal O5 rule while acknowledging the margin is within measurement noise (`grader-report.json:882`).

**Smallest repair:** correct the comparison table immediately; before another run, freeze the missing probes, usable timing predicates and caps, native-proof scope, and report schema. Preserve this run’s non-claims. Do not manufacture retrospective measurements.

## 10. The three four-point drops: regression, old edge, or variance?

| Scored cause | What the evidence establishes | Classification | What would distinguish the remaining explanations? |
|---|---|---|---|
| Optional 1,000-chat server merge | L26 chose one 1,000-lane merge; L25 used 50-chat membership batches; the current guide still supplies batching | **Old execution edge, different app shape. No demonstrated release regression.** | Run the identical server-search program and fixture on both pins; separately compare batched and unbatched forms. Blind-score the same evidence |
| Fresh Trending index | Both lanes hand-maintained ranking rows in source writes; current scheduled recipe explicitly permits lag | **Recurring design burden. The additional four-point charge may be scorer emphasis/variance.** | Compare matched implementations and isolated authoring steps; repeat cold builds with and without an adequate fresh-ranking recipe or derivation |
| Explicit execution bounds and prediction learning | Scorer names the learning burden; run log attributes concrete prediction/syntax corrections to agent error; digest retains a declared 16,384-row bound | **Long-standing model cost. No changed bound established here.** | Identify a changed rule or diagnostic on the same program, or repeat builds with measured bound-related corrections under fixed materials |

The three causes overlap categories. Search appears in both queries and scale; Trending appears in both modeling and queries. **Do not turn the three −4 movements into three independently recoverable four-point projects.**

The evidence supports the existence of those costs. N=1 does not establish their score magnitude, a package regression, or how much is scoring variance.

## 11. What wave 10 actually bought

The nine rows below follow `R26/README.md:9–18`, with the grouped low items unpacked.

| Wave-10 item | Evidence in this run | Verdict |
|---|---|---|
| **1. README entry map** | Installed README names all three documents at lines 21–25. Run log line 10 records full reading; scorer line 16 says “no misleading documentation was established.” | **Used; old findability defect closed.** Setup is actually **85 → 89**. Broad first-read cost remains |
| **2. Inline explanation for repeated diagnostics** | Retained `*check*.log` files contain at most one occurrence of each code per check. Final check lines 2–18 have three different notes. `why-wide-merge.txt` exists and run-log line 39 records the lookup | **No demonstrated inline-excerpt benefit.** Explicit `why` was reached this time; that is not proof the new inline trigger caused it |
| **3. `N_NO_CURSOR` cap alternative** | `proof-backend.stderr:85–87` prints the revised explanation on Trending: “a table `cap N by column` can replace a cursor…” followed by “this page still needs continuation.” Final Trending has a cursor. Typing already has `cap 50 by conversationId` (`chat.q:73`) | **Explanation surfaced; cursor correction made.** The new cap remedy was not needed at the observed warning. Typing’s silence uses the existing cap-based suppression |
| **4. Effect/job qualification explanation** | Worker uses `effects:{notify:…,digest:…}` (`scripts/push-worker.mjs:6`); schedule targets `digest.daily` (`snapback/config.q:14`). No repeat of the old naming errors | **Correct forms used; recurrence absent.** Consistent with a benefit, but no isolated causal proof. The schedule-unit error is a different issue |
| **5. Repost helper renamed to `eventId`** | `feed.q:210`: `fn feedRepost(eventId: feedPosts)`. App resolves the source event and passes `event.id` (`schema.q:138–139`). Diary line 8: “Quarry itself compiled this increment on the first check.” | **Used; the recurring reference-type compile loop is absent.** Renaming did not remove the need to resolve the source event |
| **6. Backfill sized and bounded during recipe installation** | Installation reports `authors=2000` and `backfill/author=917` (`m2-feed-recipe.log:1`); generated `feed.q:162` retains 917 | **Used; no handwritten bound repair established.** The published result is a ceiling-safe 917, not an unlimited backfill or the full author count. H1 is unrelated and remains |
| **7. Typing-specific expiry filter** | `src/Chat.tsx:21` filters `t.expiresAt>now` and updates time every 100 ms; the indicator consumes that result at line 38 | **Used directly.** Grader typing expiry passes; worst recorded harness trial is 4,850.3 ms (`grader-report.json:964–972`). Both releases passed, so no assertion-point gain is demonstrated |
| **8. Residency pointer and missing-fixture refusal** | Pointer printed at recipe installation (`m2-feed-recipe.log:2`); no saved residency report or logged invocation | **Pointer emitted, measurement not demonstrated.** Missing-directory refusal was not reached. No demonstrated scoring benefit from either change |
| **9a. Empty-search directory form** | `schema.q:24–27` declares separate `people` and `directory`; `src/Chat.tsx:55,71` selects between them | **Used; the previous empty-search correction did not recur** |
| **9b. One-time token stream change** | Wave journal documents the stdout move (`snapback4/JOURNAL.md:23681–23687`). Retained primary backend stdout/stderr are empty; the log establishes no relevant token-stream incident | **Shipped; consumer benefit unproven here.** Do not claim this run proves capture safety |
| **9c. Meaning of `N_NO_HORIZON` silence** | No corresponding correction, lookup, or measurement is established in the retained run account | **No demonstrated behavioral effect** |
| **9d. Cascade suppression** | Retained schedule refusal is one actionable syntax diagnostic (`proof-backend.stderr:114–118`); no contentless cascade episode is established | **No demonstrated benefit or regression in this lane** |

### The diagnostic census is not automatically the next wave

The run README and journal promote the remaining **66 missing dedicated diagnostic sections** as the next large item. This calibration does not establish that priority.

The four newly supplied common-refusal sections have no demonstrated repeated-code excerpt consumer here. Several notes repeat **across successive checks**, while the feature triggers on repeats **within one check**. That distinction matters.

The builder did successfully use `why N_WIDE_MERGE`, and the eligibility diagnostic led to the correct repair. `E_ID_REUSED` remains in the missing-section census (`JOURNAL.md:24569`), but the builder understood that refusal and fixed the invalid retry.

**Blunt conclusion:** completing all 66 sections may improve coverage, but this run supplies no evidence that it beats fixing silent feed loss, shortening first-screen orientation, or resolving fresh-ranking authority. A census is not an effort-weighted friction ranking.

## 12. What I would build next, in order

1. **Repair the calibration package and score provenance before another run.** Make the harness self-contained, correct the baseline table, and settle proof/scoring inputs. Otherwise engineering will continue responding to layout choices and inconsistent measurements.

2. **Fix the concrete O2 defects, with ownership kept explicit.** Application handlers and DM addressing are small agent repairs. Separately change the feed recipe so capacity exhaustion cannot silently invalidate an existing follow; use atomic refusal as the bounded first mitigation.

3. **Add a sufficient Expo first-screen path to the existing README opening.** The map worked; the builder still read two complete documents before M1. Test whether an explicit stopping point reduces that reading without causing later mistakes.

4. **Make the existing complete server-search path easier to adopt.** Start with the shipped two-cursor recipe, which L25 already used. Avoid a ceiling increase or new search architecture until the same program shows a platform limitation.

5. **Decide synchronous derived-write authority, then implement the narrow fresh-Trending form.** This is the persistent design burden. Another scheduled example cannot satisfy load-time freshness, and a generic privileged write would evade the decision rather than answer it.

6. **Measure acquisition by table before optimizing it.** The 6.1-second/375-MiB observation deserves investigation, but wall time and RSS do not identify the right engineering target. Do not spend the wave on an unlocalized memory theory or the ambiguous pending-bubble incident.

---

**File not written:** your instruction prohibits all writes, and the single-file exception remains unconfirmed. The complete review is provided above; no files were modified.