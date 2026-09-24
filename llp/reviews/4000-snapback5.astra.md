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