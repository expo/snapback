# LLP 4000 design review — Astra (gpt-6-astra), reasoning effort max

**Date:** 2026-09-24. **Revision reviewed:** initial (`3106ff03d9`). **Mode:** blind, read-only, over a detached worktree at that commit; `codex exec -m gpt-6-astra -c model_reasoning_effort=max`. **Provider/runtime:** OpenAI Codex CLI 0.156.1 on the black M5 Max. **Redacted:** no. **Brief:** [`4000-snapback5.brief.md`](./4000-snapback5.brief.md), shared verbatim with the Grok and Opus reviewers. **Verdict: NOT READY.**

## Verbatim review

The direction is worth testing, but the RFC is **not ready to implement**. It identifies real authoring costs, then treats several necessary runtime distinctions as vocabulary that can disappear. They can become engine responsibilities, but the replacement contracts are not yet specified.

I read the RFC in full, the cited evidence and prior positions, both 3000.014 reviews, and the relevant engine, device, client and guide paths. Nothing was changed.

What is sound: keeping one interpreter, server authority, runtime meters, durable writes and the planner; removing authored index selection; offering one client entry point; and making detailed cost reports opt-in. Query-driven acquisition can reduce replication substantially. Neither that benefit nor hiding implementation details requires authors to manage page proofs themselves.

1. **High — Summary, §1, §9: the diagnosis exceeds the evidence.**

   The record supports **recurring, overlapping costs**, not “the remaining cost is learning the bridge” or “capability cannot remove it.” The ledger records LC in 16/16 runs, but also application-maintained read models in 12/16, capacity bounds in 12/16, and completeness/prediction reasoning in only 6/16. It explicitly declines a single-cause interpretation. Familiarity, restricted expressiveness and application-owned work remain competing explanations. [LLP 3000.012 §2.2](/Users/ccheever/projects/snapback-sb5-reviews/astra/llp/3000.012-application-still-owns-derived-data.research.md:171)

   Calibration #19 is particularly unsuitable as evidence that capability additions exhausted their benefit: the builder abandoned the intended Following materialization after a performance failure and restored application-owned projection machinery. Its 90 in `data_modeling` is also the highest retained score, although one run cannot establish an improvement. The checked-in `TREND.md` covers twelve runs, not nineteen; reading all nineteen scores gives an overall range of 85–92 and median 89.

   **Smallest fix:** state the bridge explanation as the hypothesis. Freeze the evidence population and compare against Snapback 4 with the same ordinary fixes. Classify bridge-specific learning separately from receipt modeling and general Quarry learning. “No LC anywhere” is neither necessary nor sufficient evidence that residency simplification caused a gain.

2. **Blocker — §§4.1, 4.4: a query predicate is not a page-maintenance algorithm.**

   **Counterexample:** a device holds the newest twenty messages. Delete one: the server must supply the previously unheld twenty-first message. Changing a membership can alter the entire result without changing any message. Updating a joined profile changes a shaped page without satisfying the message predicate. A rolling Trending window changes when time passes without a committed application write.

   There is also an acquisition race: read the page at sequence S, commit a relevant write, then register the subscription. The device can miss that write permanently. The current online client conservatively invalidates through dependency tables and expiry timers; the partition implementation supplies snapshot/catch-up machinery. Neither is replaced by indexing the returned rows’ predicates.

   **Smallest fix:** specify a versioned snapshot-and-subscribe protocol, including top-N refill, negative dependencies, joins, authorization dependencies, clock invalidation, and atomic application of changes. Restrict the first slice to query shapes with a defined maintenance algorithm; use metered server reevaluation for others.

3. **Blocker — §§3.2, 4.1, 4.4: released pages must remain subject to revocation.**

   **Counterexample:** Alice opens a confidential conversation, navigates away, and releases its page. Her membership is revoked. Section 4.1 stops maintaining the released page but keeps its rows. Without a separate authority channel, those rows remain readable after the device has learned newer server state. An audience check on *new delivery* cannot retract an old image.

   The registry also needs principal-specific identities. `(query, arguments)` does not distinguish Alice’s and Bob’s zero-argument inboxes, viewer-dependent values, or authorization dependencies. Filtering shared row bodies afterward does not make shared results, cursors or completeness valid.

   `retain delivered-history` is a separate product decision. If “revoked row is deleted” includes membership loss, Carol loses the history Clique requires her to keep. If membership loss never deletes held rows, confidential applications lose revocation semantics.

   **Smallest fix:** keep durable revocation processing independent of page subscriptions, purging every applicable tag, cached answer and asset. Bind page evidence to principal, store identity and program/authorization generation. Preserve an explicit retention policy, or acknowledge the capability being removed; retention cannot be inferred from having displayed a row.

4. **High — §§4.1, 4.4, 8, 10: scale is unproven, and Following is not unchanged.**

   Knowing a finite set of query templates does not bound instantiated arguments, cursors, devices or active pages. An index lookup costs its lookup **plus all matches**. One public post can affect every active Global page; one score change can affect many rankings. The 167,243-action replay alone does not specify this workload.

   There is a new disclosure possibility: if registry work spends the originating mutation’s meter, a public write succeeding with few subscribers and failing with many exposes otherwise private subscription activity. Moving that work outside the meter instead leaves an unbounded cost.

   Following currently depends on private edge epochs, removal tombstones, pending-task state, joined cards and full public source replication. Twenty returned feed rows do not supply those dependencies. Its guide explicitly distinguishes delivered contents from outstanding delivery and requires full public source partitions. [Following guide](/Users/ccheever/projects/snapback-sb5-reviews/astra/snapback4/crates/snapback4-lang/src/guide/feeds.md:19)

   **Smallest fix:** retain server materialization and its public-source disclosure prerequisites, but specify the device dependency set separately. Enqueue bounded delivery work independently of subscriber-sensitive mutation outcomes. Preregister page/device cardinalities, churn, reconnects, delivery lag, storage and meter measurements. Budget warm-query work too: “takes no arguments” does not imply “cheap first screen.” A category score cannot establish this mechanism’s cost or attribute a regression to it.

5. **High — §§4.1–4.4, 8: schema adoption has no page-evidence contract.**

   **Counterexample:** `home` changes its predicate or ordering while keeping its name and arguments. An old page is reused under the new program and marked complete. Alternatively, a read rule narrows while released pages remain stored. Old cursors, hidden captures, aggregate values and queued predictions can then refer to different interpretations.

   Current activation binds schema **and programs** to a generation; device adoption invalidates acquisition state, and direct cursors bind generation and prefix. Those guarantees depend on more than replacing the word “partition” with “page.” [Activation](/Users/ccheever/projects/snapback-sb5-reviews/astra/snapback4/crates/snapback4-core/src/store/activation.rs:59)

   **Smallest fix:** initially invalidate all affected page evidence on adoption, reject old cursors, reauthorize retained images, and reacquire active pages before certifying them. Preserve queued write identities and defined generation refusals. Capture fills, aggregate rebuilding and publication must share an activation barrier; background chunking alone is not that barrier.

6. **Blocker — §4.2: receiving the server answer does not establish semantic completeness.**

   The clearest contradiction is `N_NEVER_COMPLETE`. Today it describes a page that remains incomplete **on the server**, because its read rule is not uniformly decided by the scan. The code deliberately excludes non-uniform reads, meter cuts, lost page positions and pending timeline work from completeness. [Diagnostic definition](/Users/ccheever/projects/snapback-sb5-reviews/astra/snapback4/crates/snapback4-lang/src/guide/codes.rs:197)

   **Counterexample:** a non-uniform scan exhausts its meter before reaching later readable rows. Delivering that answer completely cannot make the query complete. Manufacturing a continuation from a hidden stopping key would also undo the cursor disclosure protection.

   Held result rows are insufficient for many local reevaluations: a server-provided unread total does not provide its source population. Conversely, running a query over the union of held rows can admit a stale row retained only by a released page, even though the active server page excludes it.

   **Smallest fix:** define completeness relative to a versioned answer and preserve the server’s semantic completeness. Require valid coverage for every local dependency and retain authoritative scalar/projection results where source reconstruction is unavailable. Keep cursor frontiers disclosure-safe. Hidden coverage machinery is acceptable; falsely certifying its absence is not.

7. **High — §4.3: possession is not proof, and the prediction rate is unknown.**

   **Counterexample:** a device holds a post but has never fetched whether the viewer already liked it. A fresh row ID does not prove absence of the secondary unique `(post, viewer)` key. Similarly, twenty held members cannot establish a fifty-member cap population. A retained parent is not necessarily a current authorization witness.

   The existing engine distinguishes covered presence, covered absence, retained images and provisional dependencies. An occupancy count can help with a cap, but does not establish arbitrary uniqueness or all branches of a mutation; delivering it also needs a disclosure argument. [Insert proof](/Users/ccheever/projects/snapback-sb5-reviews/astra/snapback4/crates/snapback4-core/src/engine/write_target.rs:67)

   **Smallest fix:** have the compiler produce proof obligations and the runtime discharge them against versioned coverage, including negative facts and dependent predictions. Define the promise as sound speculation over the covered local state, with possible server rejection—not proof of future server acceptance.

   No defensible frequency estimate follows from the record. Measure **queueing without an image**, separately from `pending`, which predicted writes also carry. Include send, quoted send, like/unlike, reaction, mark-read, DM creation and follow/unfollow under cold, warm, released and offline states.

8. **High — §§4.2, 4.3, 5: two booleans cannot carry the stated client contract.**

   **Counterexample:** an offline DM creation queues without a local image. There is no row on which to display `pending`. A predicted deletion likewise removes the row. After restart, the application still needs the operation’s durable identity and eventual success or refusal.

   On reads, an empty valid result, unavailable scalar, initial load and authorization refusal require different behavior. A fully acquired offline page may be complete but stale. Section 4.2 allows that state, so §5 cannot use `complete` to mean “offline, showing what you had.”

   These are existing product distinctions, not compiler internals. The current contract exposes loading/refusal, completeness/freshness and operation-level pending/sent/failed states. [Client contract](/Users/ccheever/projects/snapback-sb5-reviews/astra/snapback4/packages/snapback4/src/contract.ts:45)

   **Smallest fix:** retain a compact read-state and durable write-status API, including freshness or connection state. These can be exposed through queries, but remain observable concepts that the RFC and budget must acknowledge.

9. **Blocker — §3.3, `through`: incarnation stamping does not resolve lifetime or interpretation.**

   **Counterexample:** a child captures a public parent’s audience and incarnation. The parent expires. Nothing about storing that incarnation makes the child unreadable “now.” Recreating the ID is another case, but preventing confusion between incarnations does not itself implement revocation of the old one.

   Defaults remain a separate defect: a physically absent immutable parent field can change interpretation when its schema default changes. Changing the parent’s read rule can likewise invalidate captures throughout a descendant chain. The existing activation code deliberately interprets defaults without necessarily storing them.

   **Smallest fix:** choose one meaning: captured audience, or current readability of that parent incarnation. For current readability, define ancestor liveness and revocation dependencies. A smaller first implementation can restrict parent deletion/expiry and interpretation changes. Expand the **entire** inherited rule, preserve narrowing conjuncts, and bind captures and aggregate proofs to incarnation and schema interpretation. Apply ancestor-first atomic adoption.

   The narrower proposal improves the design, but it is not a completed disposition of the two prior reviews.

10. **High — §3.3, `through`: write-only uses and capture ordering remain unspecified.**

   Narrowing the child’s read audience addresses the main widened-audience leak **when enforced**. It does not specify what happens when a public child uses `through` only in its insert rule. Persisting that private parent’s inputs would disclose them through replication; hiding generated fields does not hide wire bytes or cursor values.

   Nor does the RFC explicitly exclude Boolean write uses that recreate the existence oracle: mandatory capture followed by `not through` can distinguish absent from present-but-unreadable parents.

   The current insert path evaluates its write rule before recorded-field capture. Reusing that order would authorize against missing or supplied hidden fields. [Insert path](/Users/ccheever/projects/snapback-sb5-reviews/astra/snapback4/crates/snapback4-core/src/engine/write.rs:34)

   **Smallest fix:** specify admitted rule positions; make write-only checks authorized lookups without persisted copies; reject supplied hidden fields; capture before every relevant authorization/absence decision; and retain captures on patches. Require live, covered device parents, uniform missing/unreadable refusals and meter reservations, and disclosure-safe cursor encoding. Referencing “the narrower design” does not supply these rules.

11. **High — §3.3, `per viewer`: it is useful personal state, but does not replace Clique receipts as specified.**

   **Counterexample:** Alice sends to Bob and Carol; Dave joins later. Clique’s sender-visible receipt depends on the recipients **at send time**, excludes departing recipients, and distinguishes delivered from read. Alice’s own `seen` value answers none of those questions. Allowing her to aggregate other viewers’ values introduces a disclosure the proposed “reads see the viewer’s own value” contract excludes. [Clique M3](/Users/ccheever/projects/snapback-sb5-reviews/astra/benchmarks/briefs/social-messenger.md:482)

   Write authority is also unresolved. If ordinary message updates are sender-only, can Bob update his `seen` value? An implicit exception must permit that field without permitting body edits. Missing local override state cannot automatically mean the default.

   Finally, an unread aggregate over default-false values includes rows for which no hidden override exists. Eagerly creating every `(message, viewer)` row is fan-out; sparse storage requires a defined authorized population and maintained or metered complement calculation. It is not automatically “a view like any other.”

   **Smallest fix:** first specify personal-state semantics: owner-only values, parent read authority, separate field-write authority, incarnation-bound lifetime, default/absence coverage, viewer-keyed aggregates and job context. Either retain the receipt ledger for Clique or separately define recipient snapshots and explicitly authorized cross-viewer receipt summaries. Measure both storage and write amplification.

12. **High — §§3.2, 6: not all removed notes describe scale or residency.**

   **Counterexample:** a public parent exposes a maintained count over private contributions. `N_MAINTAINED_COLUMN_DISCLOSURE` warns about that disclosure; `N_MAINTAIN_DELTA` describes a separate aggregate channel. Both reads can be complete and neither involves a pending write. Moving those notes to `check --scale` silently removes authorization information. [Disclosure notes](/Users/ccheever/projects/snapback-sb5-reviews/astra/snapback4/crates/snapback4-lang/src/guide/codes.rs:11)

   Likewise, a meter limits execution by cutting or refusing it; it does not replace product cardinality, transaction semantics or an offline coverage promise.

   **Smallest fix:** classify notes by purpose. Cost advice can move; authorization disclosures need ordinary diagnostics or explicit declaration-level permission. Preserve product bounds and the internal completeness/prediction analyses. The spelling of a horizon can disappear, but the coverage boundary cannot. Several other removals—index names, strategy selection and authored sizing—already belong to 3000.013 and should not be credited again as new gains.

13. **High — §9: the first-green comparison can reward an unfinished implementation.**

   **Counterexample:** Snapback 5 reaches builder green quickly, then spends an hour repairing scale behavior before obtaining a good independent grade. It passes the proposed clock and correctness criteria, even if the incumbent produced its correct implementation sooner. Calibration #19 already illustrates the separation: approximately 54 minutes to M8 first green, approximately 115 minutes total, including substantial implementation changes.

   “Milestones all three attempt” also permits selection after observing results. M6 and M8 contain mixed obligations, and native evidence is already separated from web authoring green. Dropping whole milestones would discard comparable online work.

   **Smallest fix:** freeze an assertion-level common comparison set before running any lane. Time the earliest retained artifact that independently satisfies that set; repairs invalidate an earlier claimed completion. Report full-product and scale-qualified completion separately. Account explicitly for M7’s separate session. Treat inability or timeout as a recorded outcome, not an opportunity to shrink the comparison set.

14. **High — §9: the correctness and statistical bars permit false success.**

   A pass-count comparison allows different failures and omissions to compensate for one another. “Coverage honest” means omissions are accurately reported, not that required behavior was demonstrated. #19’s 85/0/16 grade is explicitly **uncalibrated**, with no committed holdout probes.

   The cited protocol requires serial same-machine execution, not merely the same host during the same week. It permits three-run ratchet reporting but requires eight repetitions for an ordering claim unless a preregistered variance-transfer exception applies. Three candidate runs against unspecified numbers of incumbent runs do not implement that rule. [Benchmark protocol](/Users/ccheever/projects/snapback-sb5-reviews/astra/benchmarks/protocol.md:174)

   **Smallest fix:** freeze mandatory correctness checks and denominators, require calibrated grading, and prevent omissions or unrelated passes from compensating for authorization, replay and claimed offline failures. Use balanced, serial comparison sets with pinned versions and recorded load. Either follow the repetition rule or explicitly register a limited exploratory decision rule. Freeze numerical category floors. Remove the final non-claim’s stale statement that 94 is the bar.

   Absence of an LC phrase should remain supporting evidence: narrative wording can change without the underlying learning burden changing.

15. **Medium — §§3.1, 7: the concept budget measures something different from its proposed payment.**

   **Counterexample:** removing a receipt table and repeated `immutable` lines saves application code, but removes no **distinct** declaration or modifier when other tables still use both. Adding `through` and `per viewer` therefore need not pay for itself under the stated metric.

   Counting diagnostic codes also rewards hiding diagnostics. “The errors it can draw” has no fixed population. And the supposedly complete six-kind card does not explain where Clique’s effect declaration and worker integration fit; `job` and `schedule` are distinct declaration forms unless the counting rule explicitly groups them.

   **Smallest fix:** publish a fixed counting rubric and a complete target program. Measure distinct concepts separately from repeated application machinery and orientation length. Count necessary runtime states and error recovery too. Establish the baseline before implementation, but use the number descriptively until the first calibration demonstrates that reducing it tracks builder effort.

For §11’s decisions:

- **Item 2: `per viewer` first**, with its narrower personal-state contract resolved. Keep explicit receipt machinery where the brief still requires it. Add `through` after 3000.014 revision 2 settles lifetime, disclosure and activation; combining both now confounds the experiment.
- **Item 3: accept “what was shown plus first screens” for the experiment**, rather than immediately rebuilding partitions through an automatic depth policy. Specify eviction and offline coverage precisely, and test an unopened conversation, deep history, released pages and restart. This is a deliberate product limitation, not equivalent offline capability. It must not be hidden by prewarming benchmark-selected data.
- **Item 4: report the concept count initially.** Gate commission on a complete, internally consistent surface and measurable product obligations. Introduce a ratchet after the counting method and its relationship to effort have evidence.

**Overall verdict: NOT READY.**

---

## Round 2 — revision 2 (`dbb10169b6`), 2026-09-24

**Mode:** blind delta review, read-only, over a detached worktree at that commit; `codex exec -m gpt-6-astra -c model_reasoning_effort=max`. **Brief:** `~/projects/snapback-sb5-reviews/round2.brief.md` (reproduced in the Opus round-2 section). **Verdict: NOT READY.**

### Verbatim review

**Revision 2 makes substantive corrections, but it is still NOT READY.** The main unresolved issues are the page/log protocol, disclosure through page dependencies, and the receipt contract. Several §9 “pre-registrations” also remain unspecified.

Reviewed commit `dbb10169b60ecb828a79e446969893e0b731ebf2`, including the requested revision diff, prior reviews, engine/device code, benchmark protocol and calibration record. The September 5 Supabase clock file is present on this host. Nothing was changed; the checkout remains clean.

“Real” below means the necessary rule is now stated in the proposal, not that it has been implemented.

The §12 dispositions, in their original order:

| # | Round-1 finding | Disposition | Resolving sentence or remaining gap |
|---|---|---|---|
| 1 | Diagnosis over-reads the ledger | **Real** | §1 now says “Learning cost is recurring and overlapping, not a demonstrated single cause”; the Summary explicitly calls the explanation a hypothesis. RM/CP/QC and the competing language explanation are restored. |
| 2 | Cross-viewer cache; released-page revocation; ambiguous partition authority | **Partial** | §4.3 supplies the principal-aware key; §4.2 says the channel reaches “every row the device holds.” Those are correct requirements. Acquisition, ordering, refill and post-leave revocation are still unspecified or inconsistent with the unchanged stream. Findings 1–3 below. |
| 3 | Retention is a product policy | **Real, at the policy level** | §3.2 keeps “one leave-policy word per table”; §4.2 distinguishes membership loss from deletion. Its interaction with eviction and subsequent deletion remains unresolved. |
| 4 | `N_NEVER_COMPLETE` is a server fact | **Real** | §5 explicitly makes `complete` false for a never-complete class; §6 restores the class to default `check`. Receiving an answer no longer upgrades its semantic completeness. |
| 5 | Two booleans lose necessary client states | **Real** | §5 keeps the typed read/write results, freshness, continuation, refusal, restoration and generated execution facts, and adds an outbox view. The necessary product distinctions are restored. |
| 6 | Possession is not prediction proof | **Partial** | “Every read its rule **and its body** perform” and the exclusion of retained/expired witnesses are genuine repairs. The four rules do not yet define range proofs, witness contents or dependent predictions; the expected operation classifications are overbroad. Finding 7. |
| 7 | `through` lifetime and prior review defects | **Partial** | Captured audience, incarnation stamps, stamp-before-check, write-only lookup and atomic adoption are now explicit. However, “the design of record … once it exists” refers to an absent revision. Logical expiry and bounded cascading remain unresolved. Finding 8. |
| 8 | `per viewer` does not express receipts; excessive storage | **Partial** | Moving to parent marks and declaring visibility addresses real problems. Sparse page acquisition, membership ordering and the addressing of other viewers’ marks are not resolved. Findings 5–6. |
| 9 | Disclosure notes are not scale advice | **Real** | §3.2 expressly retains all five named disclosure/completeness notes in default `check`; §6 separates cost reporting. |
| 10 | Evaluation can pass without demonstrating the bet | **Partial; the claimed freeze is only asserted** | The control comparison, serial execution, expanded delivery workload and independent classification are real improvements. There is no complete decision rule, assertion manifest, probe hash, variance-transfer procedure or set of delivery thresholds. Finding 11. |
| 11 | Incumbents can perform offline milestones | **Real** | §1 corrects the false premise and records Supabase’s M6 result. The available clock file confirms M1–M6/M8 green, although M7 is explicitly not run. |
| 12 | Engine reuse claim contradicts required changes | **Partial** | §8 now names hooks and their placement. “Nothing reads it there” does not establish that producing the change feed leaves the control unchanged. Finding 10. |
| 13 | Warm set fetches too much and holds too little | **Partial** | Excluding online-only queries and adding one-step acquisition are concrete choices. “Under a stated size budget” supplies neither the budget nor an admission policy when protected pages exceed it. Finding 4. |
| 14 | Six declaration kinds cannot compile Clique | **Partial** | §3.1 restores effects, helpers, expiry, search and other important forms. Its exhaustive claim still exceeds its list: the retained target also uses `use identity password`, control flow and grouping/aggregation forms. The counting population needs an actual target program and rubric. |
| 15 | Schema adoption unspecified | **Partial** | Generation keys, `E_GENERATION` and activation fills are genuine additions. Survival under widening/default changes and purging newly unauthorized retained images are not settled. Finding 9. |
| 16 | Following cannot remain unchanged under pages | **Partial** | §4.4 restores public-source admission, pending backfill/cleanup and the lock prerequisite. Ordinary follow edges are not the entire device dependency set: edge epochs, removal evidence and pending-work coverage also matter. Findings 1 and 3 apply. |
| 17 | Concept budget measures the wrong thing | **Partial** | §7 correctly separates distinct concepts from removed application machinery, counts runtime obligations and makes the initial number descriptive. The “frozen counting rule” is still future work, including how forms and refusal populations are grouped. |
| 18 | Error-code count and fixture citation | **Real** | §1 changes 163 to 161 and cites the committed fixture. |

Several restored positions are now sound: retaining the partition authority mechanism, keeping both leave policies and `online only`, preserving completeness as a class, keeping the client result types, separating disclosure diagnostics from cost advice, and putting both additions in the control before comparing residency. Matching work outside the writer’s meter is also the right direction. Those corrections should survive the next revision.

The remaining findings follow. I distinguish newly introduced problems from unresolved round-1 issues.

1. **Blocker — §§1.1, 4.2–4.3, 5: page membership and authoritative row delivery have no common acquisition protocol.**  
   **Unresolved, with a new inconsistency introduced by the log/page split.**

   At sequence 100, a device acquires messages 81–100. Message 80’s last image was logged before that acquisition and was never delivered. At sequence 101, message 100 is deleted. The page subscription emits an entry for message 80, but the ordinary forward log has no new image for it.

   The RFC says both that pages supply entries/exits and that “images … still come from the log.” It does not say how this entry obtains an authorized image. The same problem occurs when a join, filter change or clock boundary admits an unchanged row.

   Replaying the old image blindly is unsafe. The existing stream re-fetches current images and rechecks authorization at delivery; its `images_at` can differ from an event’s sequence. See [partition stream and normalization](/Users/ccheever/projects/snapback-sb5-reviews/r2-astra/snapback4/crates/snapback4-core/src/partition.rs:721). Consequently, an asynchronously computed page membership list can disagree with the image subsequently supplied by the stream.

   Other unanswered cases include an entry arriving after its row’s deletion, acquisition racing registration, and an exit removing a page tag while another page still needs the row. A time-driven page change can occur without any new log sequence. One watermark alone does not identify all this evidence.

   **Smallest fix:** specify one versioned page-acquisition transition: authorized snapshot images and negative coverage, registration/catch-up boundary, page revision, store/generation identity, and atomic publication with the relevant log changes. An entry whose image is missing must trigger authoritative acquisition and remain incomplete until it finishes. Preserve deletion precedence and define exits as page membership changes, separately from row revocation. This can reuse the existing snapshot/catch-up machinery; merely naming log spans does not define the extension.

2. **High — §4.2: the unchanged log does not deliver later deletions to former members retaining history.**  
   **New contradiction in the proposed repair.**

   Bob receives message `m`, leaves under `keep history`, and retains it. Alice later deletes `m`. Section 4.2 promises that deletion “always” purges it, including from released pages.

   The existing stream follows group log spans only during membership intervals. After Bob’s scope event, a later group deletion is outside his interval. The device’s leave handling deliberately retains the row. These behaviors are visible in [membership intervals](/Users/ccheever/projects/snapback-sb5-reviews/r2-astra/snapback4/crates/snapback4-core/src/partition.rs:651) and [device leave handling](/Users/ccheever/projects/snapback-sb5-reviews/r2-astra/snapback4/crates/snapback4-device/src/device.rs:1050).

   A global watermark can advance past the deletion without Bob receiving it. Thus “this channel reaches every row the device holds” does not follow from keeping the channel unchanged.

   **Smallest fix:** define a deletion/revocation subscription for previously delivered row incarnations that survives membership loss, carries no new content, and persists across restart. Alternatively, change the promised retention semantics explicitly—but that would need reconciliation with the brief’s delete/expiry guarantees. Test deletion after removal, not just removal itself.

3. **Blocker — §§4.2–4.4: server invalidation dependencies cannot all become device-held rows.**  
   **New defect in the literal “everything it read” repair.**

   A content rule can use `exists grants[group, viewer]` while the grant table itself is private or online-only. The server may consult that grant without granting the viewer permission to read the grant row. The engine explicitly describes existence witnesses as “raw data, never recursively authorized rows.” [Read implementation](/Users/ccheever/projects/snapback-sb5-reviews/r2-astra/snapback4/crates/snapback4-core/src/engine/read.rs:120)

   Section 4.3 nevertheless says that everything the rule consulted is what the device “must hold.” Delivering the grant row can disclose its other fields. A non-uniform scan likewise examines rows the viewer cannot read; retaining the completeness class does not make those rows deliverable.

   Conversely, refusing to deliver those dependencies means some server answers cannot be reconstructed locally. The RFC needs an explicit result for that case.

   Following illustrates the distinction even within the intended workload: its generated filter checks private edge **epochs** and removal tombstones, and its completeness checks pending work. A list of ordinary follow edges for displayed authors does not replace those facts.

   **Smallest fix:** distinguish the server’s invalidation dependency set from the device’s authorized materialization and proof set. Deliver only readable images and explicitly disclosure-safe witnesses; preserve server answers or report local unavailability when reconstruction is impossible. Enumerate Following’s required internal witnesses. Sharing a page must additionally prove viewer independence of the whole plan and shape—public source rows alone do not make `liked: exists likes[id, viewer]` shareable.

4. **High — §4.1: one-step depth has neither a bounded admission algorithm nor a compatible retention/eviction contract.**  
   **Partially unresolved; the automatic expansion is new.**

   One step limits graph depth, not work. Each warm row may invoke several declared queries, and each query’s dependency closure can be large. An unread scalar may require examining thousands of messages even though its displayed result is one integer.

   Now let maintained warm/depth pages exceed the device budget. Eviction cannot remove any row they depend on. The text does not choose among refusing acquisition, dropping maintenance, omitting particular queries, exceeding the budget or returning partial results. “Heavy aggregates … included only while they fit” also needs an ordering rule; otherwise declaration order or timing determines offline capability.

   There is a separate retention problem: Carol leaves a conversation under `keep history`; its released rows become old and unprotected. Age eviction removes the only copy she is still entitled to keep, and she cannot reacquire it. That conflicts with the claimed history and “all previously synced” guarantees.

   Finally, #19’s inbox returns fifty memberships per first page. One step from that page does not cover an arbitrary hundred-conversation user.

   **Smallest fix:** specify numerical storage/work budgets, deterministic query priority, admission and overflow behavior, release rules for automatic pages, and whether depth expands returned rows or the entire dependency closure. Define protected retained history and quota exhaustion explicitly. Freeze those choices before measuring cold start, and test overflow rather than only a comfortably fitting fixture.

5. **High — §3.3, receipt derivation: a high-water mark is insufficient for delivery over sparse pages.**  
   **New defect in the receipt redesign.**

   Bob belonged to a conversation when messages 1–1,000 were sent. The depth step fetches only messages 951–1,000. Setting `deliveredUpTo` to message 1,000 makes the proposed predicate report message 500 delivered, although Bob’s client never fetched it.

   Keeping the mark below the gap causes the opposite error: the fifty messages actually fetched cannot become delivered. Search results, quoted-message acquisition and multiple devices create further gaps.

   This directly contradicts the brief’s definition of delivered as “fetched by the recipient’s client.” [Receipt requirements](/Users/ccheever/projects/snapback-sb5-reviews/r2-astra/benchmarks/briefs/social-messenger.md:500)

   Membership needs a more precise contract too. A join timestamp is not a total membership order: Dave can join after a message in the same millisecond and satisfy `joinedAt <= message.at`. The predicate also needs to exclude the sender. Departures can be handled using current membership incarnations, but the text must say that departing recipients drop out and rejoining does not revive their old obligation.

   **Smallest fix:** retain an engine-owned per-message acknowledgement relation, or use acknowledged intervals with explicitly represented gaps. A scalar frontier is valid only where contiguous acquisition is guaranteed. Bind membership and message ordering to a server sequence/ordinal, specify departure/rejoin behavior, and enforce monotonic receipt transitions. A parent read mark can still be useful for unread state without claiming it replaces the entire receipt relation.

6. **High — §3.3, `per viewer`: ownership, cross-viewer addressing and disclosure remain ambiguous.**  
   **Partially unresolved.**

   On `members`, the proposed storage key is `(member row, viewer)`. That supplies a separate value for Alice on Bob’s member row, Bob on Alice’s row, and so on. It does not inherently select “the mark belonging to this membership’s principal.”

   The sender evaluating `m.readUpTo` needs Bob’s value, while the first bullet says each viewer reads their own value. Making marks visible changes permission, but does not define the addressing operation that selects another viewer.

   “Visible to the row’s audience” also means exposing individual marks to every row reader, including other members and potentially later joiners. That is a broader disclosure than a sender-visible aggregate tick. It can be an intentional product choice; the RFC should state it plainly. Separate field-write authority still needs a rule tying writes to a live, authorized parent.

   **Smallest fix:** choose one precise representation—an ordinary owner-controlled mark on each membership incarnation, or viewer-indexed marks on a conversation—and give concrete read/write syntax and authorization rules. Define default absence coverage, monotonic updates, incarnation lifetime and exactly which values public visibility exposes. Supply the actual sender-receipt and unread queries; the displayed unread expression also needs the relevant sender/deletion exclusions.

7. **High — §4.5: the four rules are conservative intentions, not yet a complete proof system; the expected classifications are not established.**  
   **Partially unresolved.**

   The improvement is real: rules and bodies both count, retained possession is excluded, and server acceptance is not promised. But several proof obligations remain:

   - A loop can visit twenty covered rows while missing the thirtieth. Every visited point being known does not prove the loop’s domain.
   - A complete `last 20` page with a continuation does not establish complete coverage of the filter’s whole key range.
   - An occupancy count can prove a particular cardinality bound; it does not prove arbitrary uniqueness or supply rows used by a mutation body.
   - New witnesses must reflect preceding speculative writes. Two pending inserts cannot both spend the same last free slot.
   - Engine-maintained effects and provisional-row authorization still need their existing coverage checks. Rule 4 cannot make ordinary reads of newly created rows bypass authorization.

   The expected-rate paragraph is also too broad. A held conversation’s first page does not supply an old quoted message required by `send`. `setLike` needs a maintained positive or negative witness for `(post, viewer)`, not just the post. `react` needs the complete relevant reaction/cap population.

   Moreover, #19’s retained program has `fetched`, `startDM` and `setFollow`; its final Following implementation uses application-owned `feedEvents`, not the declared timeline whose slot accounting forces follows to queue. The “as … today” comparison mixes different programs. [Retained chat program](/Users/ccheever/projects/snapback-sb5-reviews/r2-astra/benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/astra/source/snapback/chat.q:168), [retained social program](/Users/ccheever/projects/snapback-sb5-reviews/r2-astra/benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/astra/source/snapback/schema.q:113)

   **Smallest fix:** define proof obligations for point reads, complete scan domains, negative facts, implicit engine reads and speculative dependencies. Unknown obligations must queue the entire mutation. Replace the blanket expected classifications with an operation-by-operation table against a pinned program, distinguishing cold, warm, quoted, released and offline cases. Preserve the existing effects-only presence exception explicitly if `send` is meant to retain it.

8. **High — §3.3, `through`: the deferred specification is absent, and “same sweep” does not establish lifetime safety.**  
   **Partially unresolved, with a new cascade requirement.**

   [LLP 3000.014](/Users/ccheever/projects/snapback-sb5-reviews/r2-astra/llp/3000.014-a-child-reads-through-its-parent.rfc.md:112) still ends with revision 2 pending. The dependency can legitimately be deferred, but it cannot be counted as an adopted, reviewed resolution.

   More concretely, a parent becomes logically expired before the physical sweep. Its public child, carrying no corresponding lifetime check, remains readable during that interval. Deleting both during a later sweep does not make “no orphan outlives its parent” true.

   A parent with thousands of descendants also makes an ordinary atomic cascade exceed the mutation write ceiling. Moving cleanup into chunks creates an intervening state requiring explicit logical revocation.

   **Smallest fix:** require logical ancestor-incarnation revocation at deletion/expiry, with bounded physical cleanup afterward, or restrict the first version’s parent lifetimes and descendant counts. Keep this as an unresolved dependency until an actual 3000.014 revision settles it, together with Boolean admission, interpretation changes, aggregate proofs and update/upsert behavior.

9. **High — §4.3, schema adoption: the survival test omits semantic changes and does not specify withdrawal.**  
   **Partially unresolved.**

   An unchanged query can gain readable rows when a dependency’s rule widens. Its old result is no longer complete, despite no rule having narrowed. Changing a default used by a helper can likewise change the result without changing the query text.

   Conversely, when a rule narrows, marking an existing page incomplete is insufficient. A retained row can still render because delivered images are trusted. The existing device adoption path distinguishes preserving safe images from resetting them; that behavior must survive the page extension. [Device adoption](/Users/ccheever/projects/snapback-sb5-reviews/r2-astra/snapback4/crates/snapback4-device/src/device.rs:489)

   **Smallest fix:** initially invalidate page proofs on every semantic generation change and atomically withdraw or reauthorize affected images before publishing the new generation. Any later survival optimization needs a transitive semantic identity covering rules, defaults, helpers, views, lifetimes and coverage. State cursor rejection, store replacement and queued-write handling explicitly.

10. **High — §8: an unread change feed is not necessarily dormant, and post-commit notification needs recovery semantics.**  
    **Partially unresolved.**

    Recording point/range accesses can add allocations, serialization and storage work even when nobody consumes the feed. Adding that overhead to Snapback 4 could slow the control and make Snapback 5’s comparison easier.

    A volatile notification emitted after commit has the opposite problem: a crash between commit and notification loses an invalidation. The current mutation path appends partition events transactionally; the ordinary change API exposes touched tables, not the proposed detailed feed. [Commit path](/Users/ccheever/projects/snapback-sb5-reviews/r2-astra/snapback4/crates/snapback4-core/src/engine/mod.rs:929)

    Also, registry matching needs changed keys—including old and new positions—not merely reads performed by the writer.

    **Smallest fix:** make collection and persistence explicitly disabled in the control, and define the enabled feed as replayable from a durable commit sequence. Specify changed-key coverage for inserts, deletes, key moves, derived writes and maintenance. Attribute enabled production costs to the candidate.

11. **High — §§9.1–9.4, 10: the revised evaluation still permits a favorable decision without a demonstrated win.**  
    **Partially unresolved; removal of explicit correctness thresholds is a new regression.**

    The revised correctness row defines a pass-rate instrument but no required pass rate or comparison threshold. It names blocker severities but no longer requires **zero blockers**. A faster candidate with fewer correct checks therefore has no explicit numerical rejection rule in that row.

    Likewise, a holdout set being listed does not make passing every trust-boundary probe mandatory. Aggregate pass rates still allow unrelated successes to compensate for different failures.

    The claimed variance-transfer rule supplies two observations—score standard deviation and historical clock spread—but no transfer procedure, eligibility test, decision threshold or stopping rule. Cross-version builder clocks are not automatically a variance estimate for repeated runs of one configuration. The [protocol](/Users/ccheever/projects/snapback-sb5-reviews/r2-astra/benchmarks/protocol.md:174) requires an actual preregistered exception for an ordering claim below eight repetitions.

    Finally, after the additions land, the control might also lose the learning-cost charge. Absence of that charge in Snapback 5 alone would not attribute its disappearance to derived residency.

    **Smallest fix:** complete and freeze a decision manifest before the comparison. Require non-compensating correctness gates, define the primary qualified-completion clock, choose a fixed sampling/stopping rule, and classify both candidate and control notes.

The pre-registrations are therefore **not concrete enough to be held to yet**. These choices remain movable:

| Instrument | Still open to evaluator choice |
|---|---|
| Clock | Which assertions define the intersection; which clock decides; treatment of later repairs; M7’s separate session; timeouts and noncompletion; statistic and required improvement. “Last green” must refer to an independently qualifying retained artifact. |
| Correctness | Assertion IDs; native included or excluded; acceptance threshold; zero-blocker requirement; mandatory holdout passes; probe hash; grader calibration requirement. |
| Sampling | Three versus eight runs; exact variance-transfer formula; stopping rule; run order; load rejection threshold; model/package/scorer pins; treatment of the second-family pair. |
| Delivery | Exact replay interval and arrival rate; devices per user; page/search churn; disconnect duration and reconnect schedule; dropped/backlogged delivery treatment; units and thresholds for each metric. |
| Prediction | Operation mix and denominator; cache states; permissible queueing rate; whether reported rates must match the advance prediction. |
| Floors | Fixed baseline run IDs and numerical values; aggregation across candidate runs; whether `data_modeling` is merely reported or also falls under “every other category.” |
| Mechanism | The actual classification rubric, adjudication and across-run success rule; what happens when both arms lose the charge or results are mixed. |

For example, if “last five” means **0.2.31, 0.2.32, 0.2.33, 0.3.0 and 0.4.0**, their retained scores give floors of **89 queries, 95 offline, 90 client integration, 95 writes and 93 setup**. Those numbers can be frozen now. `TREND.md` still covers twelve runs.

The delivery workload is substantially better than revision 1’s replay-only proposal. Section 10 also supplies a useful direction—reject higher delivery p95 or matching work—but “matching work” must include comparable end-to-end work in both architectures. Comparing a new registry’s counter with a control that has no registry is not a defined measurement.

A competent implementer could still reasonably build incompatible versions of the page acquisition protocol, coverage witnesses, retention subscription, quota policy, receipt relation and mark API. Those are the outstanding implementation contracts. The conservative first slice should specify them directly, retain server fallback for unsupported local proofs, and treat the two additions as gated dependencies.

**Low — §§11–12: the review-consensus claim is inaccurate.** Revision 1’s Astra review accepted “what was shown plus first screens” for the experiment; Grok and Opus required automatic depth. The reviews also did not give identical sequencing answers for the additions. The smallest fix is to record these as the revision author’s choices among differing recommendations, rather than unanimous reviewer decisions.

**Overall verdict: NOT READY.**

---

## Round 3 — revision 3 (`4619cf3fc2`), 2026-09-24

**Mode:** blind delta review, read-only, over a detached worktree at that commit; `codex exec -m gpt-6-astra -c model_reasoning_effort=max`. **Brief:** `~/projects/snapback-sb5-reviews/round3.brief.md`.

### Verbatim review

Revision 3 makes substantial repairs, but it is **NOT READY**. The remaining problems include concrete counterexamples to acquisition coverage and retained-history revocation, an incomplete receipt design, and contradictions between the prediction rules, their expected results, and the experiment’s verdict rules.

This is the Astra blind delta review of `4619cf3fc2`, against `dbb10169b6`. Resolution sentences below refer to **revision 3**; revision 2 is the reviewed baseline. I changed nothing. The working tree remains clean.

For §12’s round-2 disposition table, in its existing order:

| # | Round-2 finding | Disposition | Resolving text or remaining gap |
|---|---|---|---|
| 1 | Page entries versus images; resurrection; two channels; old-row refill | **Partial** | §4.2 specifies an in-stream current-image `put`; §4.3 makes membership device-computed. Those are substantive repairs. But a log-sequence interval does not describe the rows or index coverage acquired by an arbitrary page. The acquisition/refill certificate remains missing. Finding 1. |
| 2 | Soft delete on a released page | **Real, while membership remains valid** | “A device stays subscribed to a span while it holds any row of it” expressly includes updates. Thus releasing a page no longer stops updates to its retained rows. The former-member case remains broken separately. |
| 3 | Later deletions after membership loss | **Partial** | The new tombstone-only subscription addresses physical deletes, expiry and consumption. It does **not** establish the accompanying promise that Alice’s later `delete-for-everyone` reaches Bob: that operation is an ordinary update. Finding 2. |
| 4 | Sharing viewer-dependent shapes | **Real** | §4.3 permits sharing shape values only when no filter, shape, helper or rule check reads the viewer/auth context. Public raw images and viewer-dependent results are now distinguished correctly. |
| 5 | Unreadable rows in the closure | **Partial** | “The device never holds a raw row its viewer may not read” resolves the raw-row disclosure problem. The server-only/unknown fallback is sound. The alternative—carrying a boolean/count result—has no versioning and invalidation protocol. Finding 13. |
| 6 | Redefinition of `complete` | **Real** | §5 explicitly withdraws “no pending write” and “local equals server,” restores the existing predicate, and preserves retained-row behavior. The additional closure-coverage condition is appropriate, provided coverage is actually certified. |
| 7 | Missing prediction conditions and contradictory rate | **Partial** | §4.5 adds audience conditions, body reads, versioned coverage, optimistic plain inserts and the view-input restriction, and removes occupancy witnesses. Its coverage/exemption rules remain insufficient, and the rate table still contradicts both the rules and the program. Findings 6–7. |
| 8 | `per viewer`, receipts, unread, recipient set and delivery marks | **Partial** | Removing the matrix and replacing the unread scan are real improvements. Sender exclusion and join-incarnation intent are right. Exact delivery, receipt persistence, column authority/privacy and the stated cost are not established. Findings 3–5. |
| 9 | Depth, priority, budgets, eviction and retained denial | **Partial** | Numeric budgets, table-reference-only expansion, declaration order, last-read eviction and the denied-with-retained result are now stated. The expansion cap’s unit and protected-data overflow behavior remain ambiguous. Finding 8. |
| 10 | `through` lifetime/cascade mechanics | **Partial** | Read-time liveness, incarnation stamps, restricted positions, write-only exceptions and activation barriers are substantive. Acknowledging that revision 2 does not exist, and gating its use, is honest and correct. The background meter and device-side liveness dependencies remain unspecified. Finding 13. |
| 11 | Change feed, shared-crate hooks, dormant control and wasm | **Partial** | Removing the matcher/feed and naming feature boundaries is useful. But the common receipt addition depends on an index assigned exclusively to the treatment feature. The inherited wasm number is also wrong. Finding 9. |
| 12 | Missing experiment decision rule | **Partial** | The primary clock, 25-minute threshold, combination rule, relative floors and non-distinguished outcome are real registrations. Conflicting verdict statements and operational measurement gaps remain. Findings 10–12. |
| 13 | Reading A judged absolutely/on one arm | **Partial** | Both arms, an independent classifier, named disappearing/staying concepts and a committed rubric are improvements. A can still hold with no learning-cost improvement, and B can coexist with an overall pass despite §10. Finding 10. |
| 14 | Unmeasurable delivery falsifiers | **Partial** | CPU, latency and byte ratios now have numbers. Queueing expectations are not numerical rates; aggregation and accounting boundaries remain open; span-index memory has no bound. Findings 4, 7 and 12. |
| 15 | Historical rather than control-relative floors | **Real** | “≥ control’s mean − 3” resolves this. §9.5 also makes the historical category values sanity checks. Clarify separately whether the relative floor includes `data_modeling`. |
| 16 | Factual corrections, missing forms, first-member admission and references | **Real for the named corrections** | §1 qualifies the milestone evidence; §3.1 restores the named forms and permits first-member insertion through `created conversations`; the cited reference errors are corrected. This does not validate the new ordinal/receipt recipe. |
| 17 | Undisclosed default flip | **Real** | §3.2 explicitly says queried invertible tables become held unless marked `online only`; `check` reports that choice. |
| 18 | Misstated review consensus | **Real** | §11 now distinguishes the reviewers’ recommendations and identifies the selected policies as this revision’s choices. |
| 19 | Reference README’s offline claim | **Real** | The local packet now records Supabase’s 13/13 M6 result and Convex’s 6/13, rather than declaring offline capability absent. I verified the [packet README](/Users/ccheever/clique-ref-20260924/README.md:63). |

The restored `complete` contract is sound. The explicit Following witness list and pending-backfill/cleanup condition are also meaningful repairs. Generation rejection and activation-barrier rebuilding are appropriate. A single ordered stream carrying acquisitions, images and revocations, with device-computed page membership, is a viable architecture. What remains is to specify enough state and ordering to make that architecture uphold its claims.

The remaining defects are:

**1. Blocker — §§4.2–4.3, with consequences in §3.3: a log span is not an acquisition-coverage certificate.**

The sentence “a span is a contiguous range of one partition’s log” conflates two different coordinates:

- Log sequence determines when changes occurred.
- Index keys, predicates and cursors determine which current rows a page contains.

Existing Snapback 4 acquisition explicitly records an index/group/key boundary. Its device code begins, “Acquisition facts belong to the partition, never to an ordinary row put.” Group-join images are current images assigned the join’s sequence; that sequence is not their original creation sequence. See [partition acquisition](/Users/ccheever/projects/snapback-sb5-reviews/r3-astra/snapback4/crates/snapback4-core/src/partition.rs:886) and [device boundary handling](/Users/ccheever/projects/snapback-sb5-reviews/r3-astra/snapback4/crates/snapback4-device/src/device/boundary.rs:1).

**Counterexample:** one commit inserts 51 messages. A later `last 50` acquisition delivers only 50. All 51 original message events have the same commit sequence. A start sequence plus acknowledged watermark cannot identify which message was omitted. Using the acquisition’s synthetic sequence instead requires recording which message incarnations that acquisition actually contained—the missing certificate.

Filtered search and point lookups make the mismatch worse: selected rows need not form any contiguous interval of original log events.

The refill sentence has the right ordering intent, but does not specify the acquisition identity, snapshot/image fence, retry behavior, or atomic publication of newly established coverage. A refill can be necessary when the device is already at the log head; existing `stream` can return immediately in that situation. An ordinary `put` also cannot certify that an index range is exhausted.

**Smallest fix:** distinguish the stream cursor from an acquisition certificate. Define the latter’s table/index/key bounds, generation, image fence, coverage state and exact delivered incarnations where needed. Specify an idempotent in-stream acquisition/refill exchange, including acquisition at an unchanged watermark and subscriptions for empty maintained ranges.

One channel is sufficient **with that protocol**. The current start-sequence description is insufficient.

**2. Blocker — §4.2, “Revocation after membership loss”: tombstone-only delivery misses the stated soft delete.**

**Counterexample:** Bob receives message M, leaves the group under `keep history`, and retains M. Alice subsequently invokes #19’s `deleteMessage`.

That mutation executes:

```quarry
update messages[message] {
  body: '', photo: null, video: null, oncePhoto: null, tombstone: true
}
```

It does not delete the row. See [#19’s mutation](/Users/ccheever/projects/snapback-sb5-reviews/r3-astra/benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/astra/source/snapback/chat.q:238).

The proposed tombstone-only subscription excludes that `put`. Merely reopening the membership interval does not repair it: the existing serve-time normalization skips a present row whose read rule denies Bob. It does not turn an application boolean into a revocation event.

Forwarding all updates instead would deliver post-removal content changes without membership authority.

**Smallest fix:** specify a logical revocation/redaction event for this operation, including its payload and ordering, and deliver it to previously delivered message incarnations after departure. Do not expose tombstones for newly created messages the former member never possessed. Add the exact receive → leave → soft-delete → reconnect sequence to the committed holdouts.

**3. High — §3.3: the receipt state machine remains incomplete.**

The recipient rule is substantially improved. Excluding the sender, excluding later joiners, and treating rejoining as a new membership incarnation are correct for the brief’s aggregate ticks. Removing a departed recipient who already reached a state also preserves the boolean “everyone required has reached it,” although it does not preserve a historical participant count.

Three gaps remain:

- **Delivery is historical, residency is current.** If the index means current acquired/subscribed spans, eviction or device reset can erase the evidence and regress a delivered tick. If it means every acquisition ever acknowledged, its lifetime and storage cost are different from the page index. The text does not choose.
- **Read versus delivered is unspecified for sparse history.** A member can advance a mark while older messages were never fetched. Define whether/how `read` implies `delivered`; two independently named counts do not define the promised `sent → delivered → read` state machine.
- **Unread includes soft-deleted messages as written.** A message with `tombstone: true` still satisfies the stated ordinal predicate. #19 explicitly hides the corresponding receipt from unread accounting during deletion.

**Smallest fix:** define durable, idempotent per-principal receipt facts over message incarnations; distinguish them from subscription state; specify device deduplication/reset behavior, the read/delivery relationship, and the eligible-message predicate for unread. Give the actual aggregate expressions.

**4. High — §§3.3, 4.3, 8 and 9.3: the receipt and span-index costs are materially understated.**

“One aggregate update per recipient device acknowledgement and per mark write” is not the cost of maintained **per-message** counts.

**Counterexample:** one member advances `readUpTo` across 10,000 messages. Up to 10,000 per-message read aggregates change. One acknowledgement can likewise cover many messages. Removing a member can change the recipient denominator for many historical messages. One SQL statement would not make these one metered row mutation or one delivered row image.

A compressed range/index representation might avoid materializing all those changes. That is a different implementation with query, invalidation and delivery costs that must be specified.

The per-device span registry is also new persistent work. With D devices and S disjoint acquisitions per device, the straightforward index is O(D·S). Sparse historical searches, released pages and pinned history make S grow independently of the warm-page count. Exact historical receipt facts may need to survive subscription eviction.

**Smallest fix:** choose materialized per-message counts or an indexed/lazy representation, state the accounting unit and bounds, and define idempotent acknowledgement processing. Measure amplification and peak server registry/storage usage under acquisition churn, device reset, membership departure and large mark advances. Withdraw “the only new server work per commit is none” as a description of the complete proposal.

**5. High — §§3.1 and 3.3: `written by` does not yet define an implementable field contract.**

The example permits Alice to create Bob’s membership, including `readUpTo`’s default. The prose says nobody except Bob may write that value. An implementer must invent an initialization exception.

Other choices are unresolved:

- Whether the field rule grants an owner an update right when the row has no update rule—the example relies on that.
- How a mixed patch containing `readUpTo` and `role` is authorized.
- How the engine identifies the conversation and its latest ordinal for clamping.
- How join ordinals and message ordinals share a server-assigned order. The example merely declares `ordinal: int`.
- How a column is made readable by the row’s audience.

The default privacy claim is particularly consequential. Existing group delivery sends row images. Implementing only field-level **write** authority would still send Bob’s mark in membership rows readable by the group, contrary to the stated owner-only visibility.

**Smallest fix:** specify initialization, patch authorization, ordinal assignment and clamping, and column projection/read semantics; then show a complete membership/message/mark recipe. Alternatively, retain the existing row-audience disclosure policy explicitly. Generic write authority should not silently imply a conversation-specific ordinal type and private-column transport.

**6. High — §4.5 rules 2–3: the proof is still unsound as stated.**

There are now six rules. Several additions are correct, especially versioned coverage, optimistic plain-insert constraints and conservative queueing on unknown inputs. But these counterexamples remain:

- **A complete cursor page is not a complete population.** A `last 20 … after c` page can be complete and uncut while having `next`. Its filter can match the mutation’s range, while its acquired rows cannot establish that range’s count or absence.
- **Uniform readability is not positive readability.** A key can pin the audience to Bob. Alice’s uniformly denied query returns no readable rows; that does not prove no Bob-owned row exists. Existing [`upsert_absence_proven`](/Users/ccheever/projects/snapback-sb5-reviews/r3-astra/snapback4/crates/snapback4-core/src/engine/write_target.rs:69) expressly evaluates the pinned rule positively after establishing uniformity.
- **“Created earlier” does not establish an empty child range.** Ordinary typed references do not enforce target existence. A child may already reference an absent or deleted parent ID; inserting that parent ID does not make the child range empty. The engine explicitly documents this in [reference validation](/Users/ccheever/projects/snapback-sb5-reviews/r3-astra/snapback4/crates/snapback4-core/src/engine/validate.rs:103).
- **Creation does not grant read authority.** A provisional row still needs its read rule evaluated. The current [provisional-read path](/Users/ccheever/projects/snapback-sb5-reviews/r3-astra/snapback4/crates/snapback4-core/src/engine/read_auth.rs:13) preserves that separation.

**Smallest fix:** require a coverage certificate for the exact population being tested, including bounds/exhaustiveness and positively established viewer authority. Restrict the new-parent exemption to a genuinely fresh identity with the necessary provenance guarantees, and explicitly retain provisional read authorization.

**7. High — §4.5’s rate table and §9.3’s queueing gate: this is neither an accurate program classification nor a numerical rate registration.**

The clearest contradiction is internal: rule 6 says materialized-inbox follow writes queue; the `setFollow` row says engine inbox work does not block the edge write. The existing [predictor](/Users/ccheever/projects/snapback-sb5-reviews/r3-astra/snapback4/crates/snapback4-core/src/engine/local.rs:75) queues the whole timeline-edge mutation, including an edge no-op.

The #19 program also contradicts several unconditional entries:

| Entry | Relevant program behavior |
|---|---|
| `createPost` predicts in every state | A reply first checks its parent. An unheld parent requires queueing. |
| `addMember` predicts from a roster | It also reads the chat kind and the proposed member’s profile; a roster of existing members need not hold that profile. |
| `createDm` needs all viewer pairs | #19’s `startDM` performs a lookup of the specific `(viewer, other)` pair. It needs that row or a valid absence proof, not intrinsically every pair. |
| `react` queues because of rule 5 | It has no explicit `now` predicate. If rule 5 includes implicit expiry checks, that extension must be stated. |
| `markRead` is an own-row point write | This is a replacement for #19’s `fetched`, and its newly specified clamping can require a latest-ordinal fact beyond the membership row. |

The presence discussion also needs correction. #19’s `connected` test controls an effect; the existing effects-only exception does not require replicating presence. Deliberately withdrawing that exception can be conservative, but it is a named behavior change, not a need to acquire server presence as ordinary closure data.

Finally, “queues unless…” is not a percentage. A ±10-point tolerance needs denominators and a fixed mixture of cold/warm/released/offline calls and argument cases.

**Smallest fix:** freeze operation-specific scenarios and expected outcomes against the actual comparison program, including root posts versus replies and held versus absent targets. Derive numerical rates from that workload. Separate a prediction-model mismatch from a product regression: unexpectedly *more* correct predictions should not automatically fail the bet.

**8. High — §§4.1–4.1.1: depth admission and protected-data overflow still admit incompatible implementations.**

“Capped per warm page at the page’s own size” does not identify what is counted.

**Counterexample:** an inbox contains 50 conversations, each eligible for `chat`, `roster`, `history` and `typingNow`. Does the cap admit 50 parent references and all four child queries, or 50 child pages total? Under the latter interpretation, declaration order can consume the allowance before any history page is admitted. The printed “history last 50 each” example is not entailed.

The numeric budget also leaves an essential transition unspecified:

**Counterexample:** warm/depth pages and `keep history` already protect all 50,000 rows. A maintained page grows, or the user requests another page. Nothing is evictable. Offline eviction is suspended, and retained history is explicitly unbounded.

This can be a soft acquisition budget, but it is not simultaneously a hard device-store bound.

**Smallest fix:** define the expansion unit and ordering over `(query, arguments)`, account for shared rows once, and specify admission/overflow behavior. State whether protected history lies outside the numeric budget. Define what an on-demand read returns when its closure cannot be admitted, and when a maintained page must lose coverage.

**9. High — §8: the shared receipt addition depends on a treatment-only feature.**

The per-device span index is behind `spans` and is the source of `delivered`. The maintained delivery aggregate must land in Snapback 4 and be present in the control. The control is also said to run with every feature off.

Those statements do not yet describe a buildable control.

The existing sync request has a stream cursor and pending-write information; it does not provide the proposed persistent per-device acquisition ledger. See [`SyncRequest`](/Users/ccheever/projects/snapback-sb5-reviews/r3-astra/snapback4/crates/snapback4/src/serve_sync.rs:118).

**Smallest fix:** place the necessary receipt/acquisition acknowledgement substrate in the explicitly shared baseline, supporting both authored horizons and derived pages. Then gate only the treatment’s acquisition policy and page machinery. Pin the shared baseline artifact hashes and compare feature-off builds against **that** baseline.

Byte identity is a useful control check after this split. It does not resolve the dependency split by itself.

**Medium — §8, wasm subfinding:** the “inherited 410,000-byte” limit is stale. The checked-in [budget](/Users/ccheever/projects/snapback-sb5-reviews/r3-astra/snapback4/metrics/wasm-budget.json) is **486,000 gzip bytes**. An unchanged control can already exceed 410,000. Pin the actual inherited value, or explicitly register 410,000 as a new reduction requirement.

**10. High — §§9.1, 9.3 and 10: the bet can pass while its stated mechanism is false.**

§9.3 makes mechanism interpretation “not a gate.” §10 says that if reading B holds, “the bet is over.”

**Counterexample:** residency removes no learning burden, but the named outbox/check changes save 30 minutes. Correctness, delivery and floors pass; the classifier returns B. The combination rule says **pass**, while §10 says the bet is over.

Reading A also permits both arms to have zero disappearing-item mentions and identical total learning-cost counts. That is a registered outcome, but it is not evidence that the treatment removed the cost attributed to residency.

**Smallest fix:** choose one interpretation. Either require a specified mechanism result for the named bet to pass, or distinguish “the treatment bundle improved authoring time” from “the residency hypothesis was supported.” Make the no-charge-in-either-arm case non-evidence for removal, and reconcile §10 accordingly.

**11. Medium — §§9.3–9.4: the transfer rule is now explicit, but its inferential claim and loss boundary need repair.**

The registered clocks have sample SD about **15.6 minutes**, so the stated approximation is reasonable. Naming N, the statistic, threshold and stopping rule resolves the earlier absence of a transfer rule.

However, 25 minutes being about 1.7 single-run SD does not establish that it is “the smallest difference three runs per arm can distinguish.” No error rate, distributional model or power criterion defines “distinguish.”

There is also a boundary conflict: §9.4 says a smaller difference is not distinguished; §9.3 labels equal medians a loss and any treatment median above control a loss, however small.

**Smallest fix:** either call 25 minutes an operational decision threshold or provide the statistical assumptions supporting the inference. Write an exhaustive, non-overlapping decision function for win, loss and not distinguished. An operational rejection is permissible; it should not be presented as proof that a beneficial mechanism is absent.

On **whether §9 is concrete enough to hold an evaluator to it**: substantially more of it is. The chosen primary clock, 25-minute win threshold, six-run sample, publication requirement, assertion denominator, zero-blocker requirement, all-run holdout requirement, relative category floors, cold-start threshold and secondary-family role are explicit. They should not be reopened after results.

The remaining measurement choices constitute **finding 12**:

| Severity / section | Concrete ambiguity or failure scenario | Smallest fix |
|---|---|---|
| **High — §9.3 primary clock/correctness** | Treatment stops before two expensive non-blocker checks; its earlier last passing evidence wins by 25 minutes, and two missing assertions fit the correctness allowance. The clock rewards omitted work. | Define completion eligibility and failed/aborted-run timing. Require the complete scheduled evidence campaign to finish before a run can earn a clock win; distinguish allowed failures from unattempted work. |
| **High — §9.3 delivery** | Ratios of 1.0, 1.0 and 2.0 pass a mean-based 1.5 gate but fail an every-run gate. The text does not select aggregation across runs. | Specify per-run measurements, cross-run aggregation and whether any individual violation fails. |
| **High — §9.3 delivery accounting** | Receipt maintenance generates extra commits. Counting those in “CPU-ms per commit” can improve the ratio merely by increasing the denominator. Background work can also be left outside the sampled segment. | Use a fixed logical workload denominator; include acknowledgement, maintenance and completion-tail costs. Define delivery latency’s start/end events. |
| **High — §§9.4–9.5 load gate** | A treatment-induced queue of runnable work exceeds load 36. The slow result is discarded as “load” and rerun. Discarding before reading its score does not remove that selection bias. | Separate external host contamination from candidate-induced load; retain the latter as a result. Freeze sampler cadence and external-load retry limits. |
| **High — §§4.5, 9.3** | Changing the mix of root posts/replies or held/unheld targets changes queueing percentages without changing the implementation. | Freeze numeric expectations, invocation populations and weighting, as in finding 7. |
| **Medium — §§9.2, 9.5 native/M7 scope** | The frozen [packet prompt](/Users/ccheever/clique-ref-20260924/prompts/template.md:12) excludes M7 and says simulator proofs are not required. “Native artifacts required” can mean a Hermes export or behavioral native evidence. Both interpretations can produce different grades. | Commit an explicit comparison amendment identifying required native evidence and M7’s treatment, including its clock treatment if run separately. |
| **Medium — §9.3 floors** | “Every category” implies a relative `data_modeling` floor; the separate `data_modeling` row says “none.” | State that the relative floor applies and only the hoped-for absolute 94 is non-gating, or explicitly exclude the category. |
| **High — §§8–9.3 resource coverage** | An implementation can satisfy CPU/latency ratios while accumulating unbounded server acquisition/receipt metadata. Device store size is measured, but the server index has no threshold. | Add the state-size/churn measurement and bound described in finding 4. |

The promised holdout and classifier-rubric hashes are legitimate **future freezes**, not permission for post-result changes. They must include the exact classifier identity and counting procedure. Their content is not yet inspectable; the RFC should claim a registration procedure until those artifacts exist.

Finally, **what remains underspecified enough for competent implementers to diverge** includes all the contracts above, plus one further dependency:

**13. Medium — §§3.3 and 4.3: hidden-result witnesses and parent liveness lack a maintenance protocol.**

**Counterexample:** Bob’s page receives an authorized boolean derived from Alice’s private `blocks` row. Alice changes that row. Bob cannot subscribe to its raw image, and the proposal removes server page matching. What updates or invalidates Bob’s boolean, at what sequence, and what prevents it from continuing to certify completeness?

Likewise, read-time `through` liveness requires a device to learn parent-incarnation death even when the parent is not otherwise resident. Background physical deletion must not leave stale aggregate contributions or device answers apparently complete in the interim.

**Smallest fix:** for the first slice, select the already-safe fallback—such pages are server-evaluated and incomplete offline—unless a versioned, authorized result-witness protocol is specified. In LLP 3000.014 revision 2, explicitly cover device liveness witnesses, logical-death effects on aggregates/constraints, and the cascade’s meter and progress semantics.

The implementer needs a concrete acquisition/refill trace, coverage-certificate schema, post-removal revocation event, budget-overflow state transition, complete receipt recipe and executable prediction conditions. Repeating the simulator invariant or saying the existing channel is unchanged does not supply those contracts.

**Overall verdict: NOT READY.**