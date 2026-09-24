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