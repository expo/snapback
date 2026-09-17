| Rank | Item | Fault | Score affected | Recoverable value per engineering effort | Already ships? | Smallest useful change |
|---|---|---|---|---|---|---|
| 1 | **A1 — Quote navigation and search UI defects** | **Agent error**; weak checks also belong to the instrument | O1’s one failed assertion; O2 **85** | Highest-confidence small repairs; no backend project required | Yes | Correct quote scrolling, remove the fixture conversation fallback, resolve readable conversation labels |
| 2 | **H1 — Expensive cold acquisition without a cost breakdown** | **Agent residency choice + possible Snapback acquisition overhead + host contamination** | `scale_and_limits` **65**, down 20; O5 band **30** | Largest observed score opportunity; measurement is cheap, optimization return remains unknown | Horizons and residency measurement ship; horizons were used late, measurement uptake is unestablished | Measure the exact final browser start on an unloaded host, with acquisition volume and phase timings |
| 3 | **H2 — Ordinary reads still induce a serving architecture and explicit bounds** | **Snapback authoring burden**; integration mistakes remain agent error | `data_modeling` **82**; `queries_and_live` **81** | Largest recurring platform burden, but substantial work and **already owned by wave 13** | Hybrid recipe ships and was used; the simpler total-read experience was not fully available on this pin | Finish LLP 3000.007 §20.22; do not commission a competing recipe or raise ceilings |
| 4 | **H3 — Trending guidance reached the builder, but handwritten scoring survived** | **Partial adoption plus documentation fit**, not a demonstrated missing rolling-ranking primitive | Modeling **82**; queries **81** | A narrowly matched example may remove work; no isolated point recovery established | Yes: hour lanes and a maintained ranking example; this app adopted the lanes, not the maintained score | Qualify a maintained example against the brief’s exact tie order, zero-like behavior and residency needs |
| 5 | **H4 — Full-reference orientation despite an existing stopping point** | **Agent navigation choice over a substantial Snapback learning surface** | `setup_and_docs` **88**, down 4 | Low-confidence residual; another documentation expansion is unlikely to pay | **Yes:** the first-account-screen path and explicit stopping point already ship | Test whether builders follow that path before changing it again |
| P1, owned | **False completeness past a sync horizon** | **Snapback defect**, pre-existing | Potential queries/offline correctness; **no deduction demonstrated here** | Correctness priority independent of this score | Defect ships in 0.2.27 and 0.2.28; wave 13 owns repair | Land the owned boundary-coverage repair before promoting broader horizon use |
| Retire | **Digest staging detour avoided** | Previous agent design detour; documentation plausibly prevented recurrence | `background_work` **86 → 91** | Evidence for retaining the new example, not starting another background-work project | Yes; period-seeking jobs already worked on 0.2.27 | Keep the example and its envelope; verify adoption across repeated builders |
| I1 | **Harness dependency/layout friction and nondiscriminating checks** | **Instrument** | Setup time; false green for quote navigation | Small, concrete repairs | Earlier validator repair ships; sibling dependencies and weak checks remain | Package the actual harness dependency closure and strengthen the failing observable |
| I2 | **Missing proof and unstable score interpretation** | **Instrument / run scope** | O1 **78**, O3 **null**, O4 **35**, O5 interpretation | Necessary for trustworthy comparisons; not recovered backend capability | Some tooling exists; required evidence is absent | Align scope, native proof, holdouts, checkpoint retention and report schema before the next calibration |

The ranking orders confidence in recoverable value against effort. The scorer does not allocate deductions to individual incidents; these are not independently recoverable point budgets.

## Evidence boundary and corrections

References use:

- **R28**: `benchmarks/runs/2026-09-17-snapback4-clique-astra-0.2.28/`.
- **R27**: `benchmarks/runs/2026-09-17-snapback4-clique-astra-0.2.27/`.
- **R26**: `benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.26/`.
- **L28**: `/Users/ccheever/clique-sb4-20260917-astra-cal12/lanes/astra-snapback4/`.

I inspected the archived narratives, scores and grader report, plus retained lane evidence, installed documentation and application source. No application, test, benchmark or compiler was run. The requested R27 friction review was absent from this checkout and the local sibling copies checked; this review follows the available R26 review’s form and compares R27’s primary records directly.

**The supplied ten-run overall sequence is 90·91·88·91·88·88·91·90·89·85: flat, now with a low outlier.** One builder and one narrative score per release do not establish release effects. Concrete behavior and changed implementation shape can support a finding; adjacent score movement alone cannot.

Three corrections to the lead’s reading matter:

1. **The cold-start gap is independently corroborated.** The holistic scale deduction references the builder’s 54,982 ms observation, but the grader subsequently measured **39,869 / 39,046 / 38,263 ms**. The evidence is no longer just one stopwatch observation.
2. **Background work at 91 is not the programme’s best.** [R26/astra/FINAL.md:42](/Users/ccheever/projects/snapback-w4b/benchmarks/runs/2026-09-16-snapback4-clique-astra-0.2.26/astra/FINAL.md:42) records `"score": 95`. The defensible statement is recovery from 86 to 91.
3. **The Trending card reached the builder, but its full maintained-ranking form was not adopted.** Hour lanes are present; `posts.score` is still maintained manually.

Keep the score systems separate. Holistic **85** comes from the builder narratives. The grader’s **84 pass, 1 fail, 16 not-run** covers 101 M1–M7 assertions. Its M8 sidecar adds **16 pass, 2 not-run**, yielding **100 pass, 1 fail, 18 not-run** across 119. O2’s **85** is another distinct score. See `R28/astra/grader-report.json:839–856,1005` and `L28/grading/trace.md:695–705`.

## 1. A1 — Repair the application defects in the application

**Attribution: agent error. Supporting backend behavior already exists.**

The strongest inexpensive recovery is three concrete UI repairs:

| Defect | Verbatim evidence | Smallest repair |
|---|---|---|
| Quote preview scrolls to the conversation’s end | `R28/astra/grader-report.json:421`: “the conversation scrolls to its END instead” | Locate/load the original message and scroll to its position within the actual scroll container |
| Chat-search scope uses a fixture DM | `grader-report.json:818`: “searches the fixture DM 'd-alice-bob' for every user” | Require/select the actual conversation; remove the hard-coded fallback |
| Global search displays internal IDs | `grader-report.json:829`: “raw internal conversation id rather than the chat name or participants” | Resolve a group name or DM participants |

The quote defect is a reproduced application failure, not missing backend history. The grader reports seven observations across four scrollback depths and identifies the wired handler landing on the wrong offset (`L28/grading/trace.md:318–334`). It affects **m3-a11/O1**. The grader deliberately excludes it from the additional O2 defect count to avoid double punishment (`trace.md:584–586`). The two search defects hold **O2 at 85**.

The run log also records expensive mistakes that were corrected before completion:

- `lane-run-log.md:78`: `attribution=agent-error source=diagnostic` — “old scale schema keyed events only by actor/post, suppressing self-repost.”
- `:108`: `attribution=agent-error source=diagnostic,model knowledge` — the scale export embedded the development backend URL; “Prior 120000ms was not measured cold-sync latency”.
- `:75`: `source=model knowledge attribution=agent-error` — delivery acknowledgments and named-group resolution covered only the first inbox page.
- `:59`: `source=diagnostic attribution=agent-error` — the verifier “wrongly read scalar aggregate .value”.

Those episodes cost builder time. They do not justify changing write identity, aggregate semantics, pagination or replication. Nor should their already-completed repairs be counted as future score recovery: the holistic scorer explicitly excludes agent/environment correction time (`R28/astra/FINAL.md:12`).

## 2. H1 — Cold startup is a real observed gap with unresolved causal shares

**Attribution: mixed. The app selected expensive residency; Snapback executes that acquisition; both browser measurements occurred under substantial host load. No honest percentage split is available.**

### What was measured

The final evidence reports:

> `"p95Ms": 3.4130420000001322`  
> `"p95Ms": 20.31841700000041`  
> `"coldFirstFeedMs": 54982.169499999996`

— [L28/evidence/scale-final-ui.json:13](/Users/ccheever/clique-sb4-20260917-astra-cal12/lanes/astra-snapback4/evidence/scale-final-ui.json:13), lines 21 and 26.

These are sequential observations within the same approximately 62-second evidence window. The first two are warm online-client calls to Insights and Trending; they are not a breakdown of browser startup.

The timer is slightly broader than “login-to-feed”: it starts immediately before `page.goto`, includes loading the application, filling/submitting credentials and waiting for the first feed item. **Chromium launch happens before the timer starts.** See `L28/scripts/scale-final-ui.mjs:102–111`.

Consequently, the lead is right that **55 seconds is not a query-latency result**. It includes application startup, authentication, acquisition, client processing and rendering. The reported executable-launch stalls are not themselves inside this stopwatch, though host contention can slow its measured stages.

The grader corroborates the failure:

> “Best 38 263 ms, above the frozen 30 s probe timeout”

— `L28/grading/trace.md:660`.

At those measurements, recorded load averages were **26.31 / 30.43 / 41.91**, rather than an unloaded control (`:652`). Memory remained roughly 150–159 MB and bounded. Other evaluated degradation ratios passed, including deep paging **1.137×** and Following **1.066×** (`:654–674`).

### The app’s responsibility

The primary attribution is explicit:

> `attribution=agent-error source=package README/guide,diagnostic`  
> “full public social and private feed residency blocked cold acquisition.”

— [R28/astra/lane-run-log.md:110](/Users/ccheever/projects/snapback-w4b/benchmarks/runs/2026-09-17-snapback4-clique-astra-0.2.28/astra/lane-run-log.md:110).

The builder bounded posts/events/source feed to 5,000 and private/broadcast feeds to 1,000. The final report still states:

> “other public rows still fully sync”

— `R28/astra/lane-final-report.md:50`.

The source confirms public synchronization of follows and likes (`L28/snapback/social.q:13,65`). This is substantive residency choice, not merely an unfortunate host. The correctly targeted unbounded attempt timed out at 120 seconds; the bounded version rendered in 55 seconds. That supports investigating volume, although changing host conditions prevent assigning the entire difference to horizons.

**167,157 is the replay’s action count, not the number of rows this browser acquired.** Neither that count nor whole-store table counts identify this principal’s acquisition volume.

### Snapback’s responsibility

A replica system should make necessary acquisition affordable and unnecessary acquisition visible. The remaining cost could include transport, decoding, device insertion/indexing, persistence or rendering; the retained evidence does not divide them.

The measurement facility already ships:

> “reports the eight costliest acquired table/persona pairs, ordered by compact JSON row bytes”

— `L28/node_modules/snapback4/README.md:1348–1352`.

The recipe installation printed its invocation (`L28/evidence/m8-feed-recipe.txt:2`). The run log and cited final evidence do not establish that the builder obtained that report. This is another case where a pointer shipped without demonstrated measurement uptake.

### Host contamination and the separating measurement

The lead reports load **56–70**, `syspolicyd` at **31% CPU**, and large slowdowns elsewhere (`R28/README.md:54–71`). That invalidates a clean release-performance comparison. It does **not** prove the host explains the threshold failure.

I disagree with using “6.6× versus roughly 5×” to apportion the excess. Those ratios compare different applications, measurement paths and workloads; host load is not a transferable slowdown multiplier.

**The single next measurement should be an unloaded-host rerun of this exact final browser probe, on the same pin, final schema and frozen corpus, with one trace recording per-table acquired rows/bytes and timestamps for authentication, snapshot transfer, device application/persistence, first query and first feed render.**

That separates persistent startup cost from the loaded-host observation and locates the expensive stage. A stopwatch alone cannot separate excessive app volume from expensive processing per row. Exact causal savings from a different residency choice would still require a matched variant; no single scalar can supply all three shares.

**Score implication:** scale **65** and O5 **30** represent a witnessed miss under compromised conditions. They are neither proof of a 0.2.28 regression nor grounds to dismiss acquisition work. Do not promise that repairing it restores exactly 20 points.

## 3. H2 — The largest recurring platform burden is already owned: total reads

**Attribution: Snapback authoring cost; individual integration regressions are agent error.**

The builder reports:

> “That added routing tables, an adoption job, and atomic mutation bridges”

— `R28/astra/lane-diary.md:23`.

The primary log records:

> `workaround source=package README/guide attribution=agent-error`  
> “replace wide Following merge with published hybrid private-inbox/celebrity-broadcast recipe”

— `R28/astra/lane-run-log.md:64`.

The attribution matters: the builder chose and then revised the application shape using a shipped solution. The source does not establish an unexpressible feed or a runtime cap failure. But self-attribution does not make the additional schema, bridges, migration and bounds free.

The scorer names that cost directly in modeling and queries (`R28/astra/FINAL.md:20,28`). The essay says:

> “The recipe reduced algorithm design work, but it did not make integration free.”

— `lane-essay.md:23`.

**This is the largest recurring Snapback engineering item supported here, and it belongs to [LLP 3000.007 §20.22](/Users/ccheever/projects/snapback-w4b/llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md:4185), “total reads.”** Its invariant is that admitted reads complete or return continuations the SDK follows without the author (`:4243–4246`).

Do not overstate what that work promises. The same section retains the hybrid Following recipe until lower per-lane costs are demonstrated on the relevant client path (`:4539–4545`). This run’s successful hybrid degradation ratio does not prove a simpler merge would satisfy the same gate.

**Smallest useful change:** finish and evaluate the owned work, reducing actual author-chosen bounds and continuation machinery. No second total-read project, new search recipe or ceiling increase follows from this review.

M8’s 5,083-second wall includes replay overlap, application corrections, proofs and late residency work (`lane-final-report.md:19,40–42`). It is not a measured 5,083-second language tax.

## 4. H3 — The Trending card arrived; only part of its solution did

**Attribution: documentation reached the builder. Complete adoption and a new expressiveness benefit are not established.**

The evidence chain is stronger than the essay alone:

> `knowledge lookup source=package README/guide evidence=evidence/feeds-guide.txt,evidence/jobs-guide.txt`

— `R28/astra/lane-run-log.md:51`.

Later:

> `source=package README/guide … range merge unsupported, expanded 25 lanes`

— `:57`.

The retained card says:

> “Use a value-indexed maintain over non-expiring likes … merge the last 25 hour lanes.”

— `L28/evidence/feeds-guide.txt:850–853`.

The application implements 25 explicit hour lanes (`L28/snapback/insights.q:27–54`). **Independent rediscovery is not the best-supported explanation: the run records consulting the relevant card before the implementation correction.** That establishes delivery and supports influence, without pretending to observe the builder’s internal reasoning.

But the application does **not** use the card’s maintained ranking:

```quarry
score: int default 0
by byTrending: hourKey, score, at, id
update <- allow
```

— `L28/snapback/social.q:20,30,35`.

Its like mutation explicitly increments and decrements `posts.score` (`:120–128`), and a backfill copies `likeCounts` into that field (`insights.q:55–57`). The old separate expiring rank table disappeared; handwritten derived scoring did not.

There is also a concrete reason not to call the existing card a proved drop-in replacement:

> “Ties break by descending maintained id, not post time”

— `L28/evidence/feeds-guide.txt:971`.

The brief requires newest-first ties, and the grader independently verified that behavior in this application (`L28/grading/trace.md:498–503`). The record does not say why the builder retained `posts.score`; the tie-order difference is a plausible integration concern, not an established motive.

**Documentation versus expressiveness:** the hour-lane maintained form was already demonstrated on published **0.2.27** (`LLP 3000.007:4602–4625`). This run therefore supports better delivery of an existing expression strategy, not a claim that wave 12’s new live-expiry machinery enabled this Trending implementation.

**Smallest change:** qualify the maintained example against the exact score/time tie order and zero-like requirements, and make the replacement of handwritten score updates explicit. Treat this as an example-fit/adoption task until evidence demonstrates missing language capability.

The broad update rule is not, by itself, proof that a caller can submit arbitrary scores. The installed documentation explicitly distinguishes latent table permission from an exposed mutation accepting a forged score (`README.md:1822–1828`). No new authorization deduction is justified here.

## 5. H4 — Orientation remains substantial, but the proposed shortcut already exists

**Attribution: substantial platform surface, with an agent choosing broad reading.**

The log says:

> “read README and client operations in full”

— `R28/astra/lane-run-log.md:13`, `source=package README/guide`.

The essay reports moving among README, client/operations, cards, diagnostics and generated types (`lane-essay.md:27`). That supports a learning burden. It does not establish that the documents were missing or misleading.

The installed README already says:

> “Start here — first working account screen”

— `L28/node_modules/snapback4/README.md:34`.

And:

> “You can stop reading here and build that screen.”

— `:75`.

This is substantially the remedy proposed in the R26 review. **Do not propose it again as unbuilt.** Likewise, web session persistence is an explicit configuration choice, not evidence of broken auth persistence.

The **92 → 88** setup movement is not an isolated documentation measurement. M1’s 600 seconds include orientation, implementation, harness repairs and verification. No amount of that interval can honestly be assigned to unnecessary reading from this record.

**Smallest change:** test the existing entry path with repeated cold builders and record whether they stop. Further documentation expansion ranks below the concrete defects and acquisition measurement.

## 6. P1 — The horizon defect is relevant, reproduced, and not observed as this run’s failure

**Attribution: Snapback. Already owned by wave 13.**

The issue’s reproduction is unequivocal:

> `device page 2 … p09 p08 p04 … "complete":true … "fresh":true`  
> `server page 2 … p09 p08 p07`

— [issues/20260917-snapback4-device-page-past-horizon-answers-from-scattered-rows.md:47](/Users/ccheever/projects/snapback-w4b/issues/20260917-snapback4-device-page-past-horizon-answers-from-scattered-rows.md:47), line 49.

It reproduces on **both 0.2.27 and 0.2.28** (`:7`). An old-row update introduces scattered data below the acquired suffix, and the device mistakes held rows for contiguous coverage.

This application has the triggering ingredients:

- `posts` acquires only the newest 5,000 rows (`L28/snapback/social.q:37`).
- Likes update the parent post’s score, including potentially old posts (`:120–128`).
- A device retained across those updates can later traverse affected history.

That is exposure, not an observed failed assertion. The grader’s no-gap feed check was an **API** traversal (`R28/astra/grader-report.json:248–253`); it does not test a warm device after old-row updates. Fresh-browser startup also does not exercise that history-dependent condition.

The app left message history unchanged when introducing social horizons (`lane-run-log.md:110`), so the issue’s grouped-chat reproduction must not be assumed to have occurred here.

**Smallest change:** land wave 13’s owned coverage-boundary repair and its public/group regressions. Preserve this as a correctness priority, without inventing lost points or attributing the quote-scroll bug to it.

## 7. Background work — a credible avoided detour, not a proved five-point release effect

**The +5 is real; “programme’s best” and attribution to rolling-ranking machinery are not.**

R27’s scorer explicitly charged:

> “expiring-table scan restrictions required nonexpiring staging and candidate revalidation.”

— `R27/astra/FINAL.md:44`.

Its log classified the detour as `attribution=agent-error source=diagnostic` (`R27/astra/lane-run-log.md:95`). Subsequent published-binary investigation established that the refusal concerned a cleanup **mutation**, not the digest’s permitted job read (`LLP 3000.007:4626–4639`).

In R28, the consulted jobs card says:

> “Seek the period, filter the ordinal.”

— `L28/evidence/jobs-guide.txt:107`.

The application follows that pattern directly:

```quarry
return count(messages[conversation, at >= periodStart, at < periodEnd]
  first 10000 by byConversationTime
  where not .tombstone and .sender != reader and .ordinal > readOrdinal)
```

— `L28/snapback/digest.q:7–8`.

The 25-line digest module walks profiles and their memberships, writes a period marker and emits; it does not clone message candidates into staging. The builder’s proof records closed clients, restart, exact counts, authorization and empty-period suppression (`L28/evidence/m8-digest-proof.json:16–22`). The grader independently reproduced those properties (`L28/grading/trace.md:505–523`).

**This supports a specific inference:** W14b’s consulted example plausibly helped avoid R27’s unnecessary staging design. The mechanism already existed, and the resulting application shape is simpler.

It does **not** isolate five points of causal benefit. The scorer’s background note credits scheduling, push and proof outcomes, not Trending (`R28/astra/FINAL.md:44`). No evidence connects the category increase to wave 12’s rolling-ranking runtime changes.

Minute-only syntax and bounded job expressions remain documented learning costs. The run log groups their correction with `attribution=agent-error` (`:57`). No subminute scheduling requirement or demonstrated digest envelope failure warrants expanding those features.

**Disposition:** retain the period-seeking example and its limits; retire “digest necessarily needs staging” from the backlog.

## 8. I1 — Repair the instrument’s remaining friction separately

The primary log records:

> `source=diagnostic attribution=environment` — “copied frozen directory retained read-only permissions”

— `R28/astra/lane-run-log.md:17`.

> `source=diagnostic attribution=environment` — “copied harness needs sibling metering module”

— `:20`.

> `source=fixture attribution=environment` — “copied harness default fixture path escapes lane”

— `:22`.

These are instrument packaging/layout costs. The agent’s premature acceptance launch before dependencies were available is separately labeled agent error (`:18`).

The earlier validator-import fix is real (`issues/closed/20260916-clique-harness-not-self-contained.md:73–87`). This run identifies a **different remaining sibling dependency**, not evidence that the validator repair failed.

The quote test is a second instrument defect:

> “each exercises the tap in a 2-message conversation where the original is already on screen, so neither can discriminate.”

— `R28/astra/grader-report.json:421`.

**Smallest changes:** package the copied harness’s actual dependency closure and media paths; make the quote check start with the original outside the scroll frame and assert that specific original enters it. The latter repairs both the builder acceptance blind spot and the frozen choreography blind spot.

No Snapback runtime work follows from either finding.

## 9. I2 — Proof gaps and scoring scope must not become backend projects

The grader declares:

> “N=1 calibration run, not a claim-eligible wave”

and:

> “No holdout probe set was committed”

— `R28/astra/grader-report.json:1005`.

Consequences:

- **O3 is null** because its permitted holdout input is absent.
- **Seven M6 and two M8 native assertions are not-run.** Hermes exports establish builds, not native execution.
- **M7’s nine assertions are not-run by scope**, while remaining in the grader’s denominator.
- **O4 at 35 is an evidence limitation**, not a demonstrated loss of offline writes.
- **O5 has a genuine observed cold-start miss**, but its checkpoint-relative search/Insights/Trending rules could not all be evaluated because checkpoint instances were unavailable.
- The grader is explicitly uncalibrated, and M8 requires a sidecar because the report schema admits only M1–M7 IDs.

These limits do not erase the grader’s concrete reproductions. They restrict comparative and capability claims.

**Smallest change:** settle the next packet’s scope and proof ownership, retain the required checkpoint inputs, commit the holdouts, and include M8 in the report schema. If native behavior is to earn native points, arrange qualifying native execution; do not relabel browser proofs or exports.

## What I would build next, in order

1. **Fix the quote and search defects, with discriminating checks.** These are the cheapest verified recoveries: one failed assertion and two O2 defects. Keep ownership with the application and harness.

2. **Obtain the instrumented unloaded-host cold-start measurement before choosing an acquisition optimization.** It addresses the largest observed deduction and prevents spending on the already-fast query path. Use the residency report that already ships; then optimize the measured dominant stage or remove measured unnecessary residency.

3. **Finish wave 13’s owned work, with the horizon correctness repair first.** “Total reads” is the largest recurring platform burden. It already has an owner and a measurement programme; this review supplies another consumer case, not justification for a parallel redesign. Do not broaden horizon recommendations while false completeness remains.

4. **Make the existing maintained Trending example fit the exact acceptance semantics.** The card reached the builder, so general discoverability is no longer the central question. Demonstrate newest-first ties, zero-like inclusion and appropriate residency while eliminating handwritten scoring.

5. **Finish the calibration package and proof contract.** Close the remaining sibling dependency/path gaps, preserve checkpoints, settle native/M7 scope and repair the M8 schema mismatch. These changes improve the trustworthiness of the next ranking rather than manufacturing backend improvement.

6. **Measure adoption before adding more introductory documentation.** The first-screen stopping point and direct digest example already ship. Digest shows credible uptake; the stopping point does not. Test those specific outcomes across repeated builders before funding another broad documentation wave.