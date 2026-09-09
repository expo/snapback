<!-- Provenance: blind read-only review received from codex gpt-6-astra (reasoning max) on 2026-09-09 against origin/main 635999335; launched by the orchestrator (Claude Fable 5.1) from ~/projects/snapback-el-20260908/reviews/rfc/1019.prompt.md; content verbatim. -->

Reviewer: gpt-6-astra, reasoning max · Date: 2026-09-09 · Method: blind read-only review of llp/1019-derived-delivery-custody.rfc.md at 635999335

## Part 1 — the open questions

### 1. Should `received` be always on or opt-in?

**My answer:** Opt-in, spelled `with receipts`. Receipt tracking must use durable, retried client acknowledgements. A server serving a response cannot establish that the recipient fetched it.

**Why:** The brief defines delivered as fetched by the recipient’s client. The current resume path constructs and returns an envelope; its watermark identifies the last returned index position. Neither operation observes client receipt. Moving this bookkeeping into the engine does not remove that information boundary. The cited ticket establishes missing acknowledgement choreography, not the feasibility of acknowledgement without cooperation. [social-messenger.md:500](benchmarks/briefs/social-messenger.md:500), [writer_resume.rs:188](snapback2/crates/snapback2/src/writer_resume.rs:188), [writer_resume.rs:296](snapback2/crates/snapback2/src/writer_resume.rs:296), [receipt ticket:7](issues/20260906-snapback2-no-delivered-ack-primitive-from-the-delivery-log.md:7).

Always-on is therefore not justified by “one negligible row”: the actual feature includes acknowledgement transport, persistence, writes, authorization and invalidation. Historical recipients also need not equal membership information a current reader already holds. Opt-in makes that product choice explicit and limits mandatory runtime work under the existing byte budget. [1019:307](llp/1019-derived-delivery-custody.rfc.md:307), [social-messenger.md:506](benchmarks/briefs/social-messenger.md:506), [NOT-DOING.md:79](rules/NOT-DOING.md:79).

**Confidence:** 94/100.

**Exact replacement text:** Extend the declaration at §1 and replace §6’s receipt semantics:

```text
deliver to <table>[<prefix keys>] [by .<principal column>] as <name> [with receipts]
```

> Receipt tracking is opt-in with `with receipts`; otherwise the declaration creates no receipt state or acknowledgement traffic. The first-party SDK acknowledges original delivery-event identities only after validating and durably accepting a page that disclosed their corresponding content. Acknowledgements are persisted with the accepted page and retried idempotently in bounded batches.
>
> The engine records acknowledgements through the normal certified, traced write lifecycle. Serving a response or accepting a pagination cursor does not acknowledge delivery. `received` means acknowledged receipt; false means unacknowledged, and missing local authority remains partial. Receipt disclosure requires an explicit table-wide authorization policy, not an index-specific override.

Under question 1:

> Resolution: opt-in `with receipts`, implemented through durable SDK acknowledgements; server-served watermarks alone are insufficient.

### 2. Should the log have an explicit `as <name>` or use `messages.delivered`?

**My answer:** Require `as <name>` and preserve ordinary row-table semantics.

**Why:** Quarry already resolves table names through one catalog and indexes through explicit names when inference is ambiguous. Its implemented “one spelling” ruling also distinguishes ordinary row reads from maintain’s scalar point reads. A dotted delivery namespace adds another resolution convention without improving the brief’s behavior. The existing catalog is the stronger foundation. [catalog.ts:7](snapback2/packages/compiler/src/quarry/catalog.ts:7), [catalog.ts:271](snapback2/packages/compiler/src/quarry/catalog.ts:271), [LLP 1011:592](llp/1011-quarry-ergonomics.rfc.md:592), [NOT-DOING.md:39](rules/NOT-DOING.md:39).

“Ordinary table name” must not imply that historical custody is rebuildable like a count. That distinction matters independently of spelling. [successor.rs:906](snapback2/crates/snapback2-core/src/successor.rs:906).

**Confidence:** 97/100.

**Exact replacement text:** Replace §1’s `as` bullet:

> `as <name>` is required and names an engine-owned row table in the existing schema namespace. A collision refuses at the declaration with `E_QUARRY_UNKNOWN` and a rename rewrite. The table retains ordinary row-valued point and range reads; it does not inherit maintain’s scalar reads or projection-rebuild semantics. One content table may carry at most one `deliver`.

Under question 2:

> Resolution: require `as <name>`; use the existing table namespace and ordinary row semantics.

### 3. Should updates emit events, possibly for declared changed columns?

**My answer:** Emit mandatory change events for committed content changes. Do not add configurable column-trigger syntax. Keep the edited badge’s product metadata, such as `editedAt`, authored.

**Why:** The current drain subscribes only to its final tail. An old message outside that tail can change while its thread is unmounted; holding its identity does not arrange another fetch. Implemented LLP 1012 explicitly requires edit/removal events, and the template currently emits an edit event. [drain.ts:184](snapback2/packages/snapback2/src/drain.ts:184), [LLP 1012:559](llp/1012-local-first-v1.spec.md:559), [messages.q:66](snapback2/packages/snapback2/templates/chat/snapback/messages.q:66).

I could not verify the quoted “no edit event is needed for display” in the named current §5. That section says the **thread selects message events**, while edits change the nested body. It does not abolish transport events. Moreover, the social brief already requires edited labels and updated recipient content; the day-two brief expressly asks for `editedAt`. [LLP 1018.003:224](llp/1018.003-truthful-and-composed-client.decision.md:224), [social-messenger.md:537](benchmarks/briefs/social-messenger.md:537), [messaging-day2-evolution.md:43](benchmarks/briefs/messaging-day2-evolution.md:43).

A general trigger language is unnecessary for those requirements and would require an additional scope trade. [NOT-DOING.md:118](rules/NOT-DOING.md:118).

**Confidence:** 99/100.

**Exact replacement text:** Replace §3’s update bullet and amend §§2/5:

> `kind` is `enum('delivered', 'changed', 'removed')`. An update that changes the committed content row appends `changed` events for its original recipients in the same transaction. It preserves the original recipient set and original delivery-receipt identity. Nested content remains subject to its current read rule. Product metadata such as `editedAt` remains authored; no configurable changed-column list is introduced.
>
> The inbox drains every event kind. Thread and preview reads use a kind-scoped index on `(recipient, <prefix keys>, kind, seq, id)`, pinned to `delivered`. Change and removal events refresh or evict the shared body without creating additional thread entries.

Under question 3:

> Resolution: mandatory change events for propagation; authored edit metadata; no configurable column-trigger syntax.

## Part 2 — the review

### 1. Verdict

**NOT READY.** Historical custody, acknowledgement semantics, deletion bounds and authorization require design changes. This verdict concerns implementability of the proposal; it does not make an unimplemented RFC a landing gate. [RULES.md:57](rules/RULES.md:57).

### 2. Blocking defects

**B1 — A served cursor is not a receipt, and `seq` is insufficient.**  
Under §6, generate 51 messages for one recipient in one transaction and return a 50-event page. All events share commit sequence S; recording S marks the unfetched 51st event received. A dropped response produces another false positive. Filtered or metadata-only drains cannot establish receipt of every earlier message either. Existing cursors are unsigned positions, expressly not proofs of previous traversal. Initial query/subscription drainage also uses paths other than `resume_log`, leaving ordinary connected receipt advancement unspecified. [1019:142](llp/1019-derived-delivery-custody.rfc.md:142), [1019:215](llp/1019-derived-delivery-custody.rfc.md:215), [LLP 1011:167](llp/1011-quarry-ergonomics.rfc.md:167), [drain.ts:135](snapback2/packages/snapback2/src/drain.ts:135).

Use acknowledged event identities, or prove a compression scheme that preserves full tuple positions, gaps and actual content disclosure.

**B2 — Historical custody cannot be rebuilt from current membership.**  
Send to Alice/Bob; remove Bob; add Carol; change the delivery declaration. Rebuilding from current rows substitutes Carol for Bob and loses the evidence needed to tombstone Bob’s copy. Deleted source rows cannot reconstruct their history at all. The existing maintain rebuild computes current count/sum projections; its safety argument does not transfer to an event log. [1019:152](llp/1019-derived-delivery-custody.rfc.md:152), [1019:174](llp/1019-derived-delivery-custody.rfc.md:174), [successor.rs:906](snapback2/crates/snapback2-core/src/successor.rs:906).

Preserve historical audience/event identities. Define nonempty installation as explicit bootstrap, not reconstructed send-time history. Removing custodial data needs a named destructive treatment. LLP 1020’s proposed projection exemption must exclude these logs. [LLP 1001:440](llp/1001-query-engine.spec.md:440), [1020:131](llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:131).

**B3 — Today’s membership cap does not bound historical deletion fan-out.**  
Send with cap 50, reduce membership to two, install cap 2, then delete the old message. Current cap admission permits the smaller group, but §4 reserves two historical reads/writes while §3 requires fifty. Rebuilding away those recipients would merely exchange certificate failure for broken custody. [1019:164](llp/1019-derived-delivery-custody.rfc.md:164), [1019:184](llp/1019-derived-delivery-custody.rfc.md:184), [LLP 1017:312](llp/1017-cap-and-complete-fanout.rfc.md:312).

The historical audience needs its own persistent bound and successor admission. Price every generated read/write site and all relevant meters; preserve protection against nonuniform scans consuming a fan-out reserve. Runtime containment otherwise rejects the operation rather than fulfilling deletion. [fanout.rs:93](snapback2/crates/snapback2-core/src/certificate_policy/fanout.rs:93), [runner_ops.rs:1230](snapback2/crates/snapback2-core/src/engine/runner_ops.rs:1230).

**B4 — `byRow` introduces a second authorization model.**  
The generated table denies other recipients’ rows, yet §2 grants content readers access through one index. Existing `Index` has no policy, `Rules` has one read rule per table, and rule authority binds the schema/rule rather than an index-specific disclosure view. Implementing only the exception either violates the stated table policy or leaves the receipt query unable to enumerate recipients. [1019:148](llp/1019-derived-delivery-custody.rfc.md:148), [schema.rs:268](snapback2/crates/snapback2-core/src/schema.rs:268), [schema.rs:293](snapback2/crates/snapback2-core/src/schema.rs:293), [schema.rs:29](snapback2/crates/snapback2-core/src/schema.rs:29).

Choose ordinary table-wide policies or a separately certified receipt projection. Internal audience reads must not disclose hidden rows in client receipts; the existing containment contract still applies. [LLP 1001:141](llp/1001-query-engine.spec.md:141).

**B5 — Removing edit events breaks the stated drain contract.**  
The counterexample and replacement are in Part 1, question 3. This directly contradicts the implemented requirement that edits append events while only the last tail remains live. [1019:171](llp/1019-derived-delivery-custody.rfc.md:171), [LLP 1012:559](llp/1012-local-first-v1.spec.md:559).

**B6 — “The brief does not ask” for join history is false.**  
It explicitly requires full prior history. The proposed thread reads only the new member’s delivery rows, which contain none of that history. Reinserting content is not a history-read solution: it changes delivery events and potentially identity, while existing-ID upsert follows the update path. Define a bounded history bootstrap/read path without rewriting send-time recipients. Also preserve the brief’s rule that departed members drop out of aggregate receipt requirements. [1019:255](llp/1019-derived-delivery-custody.rfc.md:255), [social-messenger.md:500](benchmarks/briefs/social-messenger.md:500), [runner_ops.rs:73](snapback2/crates/snapback2-core/src/engine/runner_ops.rs:73).

**B7 — Additional evidence corrections are required.**

- The quoted uniformity obstruction is historical. Its immediately preceding follow-up records the fix; current code proves an OR true when any arm is decided true. The remaining template defect cannot be attributed to that current language limitation. [1019:65](llp/1019-derived-delivery-custody.rfc.md:65), [LLP 1012:251](llp/1012-local-first-v1.spec.md:251), [visibility.rs:65](snapback2/crates/snapback2-core/src/certificate_policy/visibility.rs:65).
- `purgeMessage` is not a public client operation: schedule targets are excluded from that API. [1019:101](llp/1019-derived-delivery-custody.rfc.md:101), [bound-project.ts:79](snapback2/packages/compiler/src/quarry/bound-project.ts:79).
- `E_SCHEMA_DUPLICATE` is not the existing duplicate-table diagnostic. That path emits `E_QUARRY_UNKNOWN`. [1019:129](llp/1019-derived-delivery-custody.rfc.md:129), [catalog.ts:23](snapback2/packages/compiler/src/quarry/catalog.ts:23), [diagnostics.ts:16](snapback2/packages/compiler/src/quarry/diagnostics.ts:16).

### 3. Material changes

**Specify transaction and incarnation semantics.** Define recipient deduplication, canonical event identity, membership changes within the sending transaction, upsert, repeated updates, seed behavior and rollback. Either forbid source-ID reuse or distinguish incarnations: existing upsert permits recreation, while tombstones currently target only `(table,id)`. An old tombstone must not evict a recreated body. [1019:162](llp/1019-derived-delivery-custody.rfc.md:162), [runner_ops.rs:73](snapback2/crates/snapback2-core/src/engine/runner_ops.rs:73), [tombstones.ts:39](snapback2/packages/snapback2/src/tombstones.ts:39).

**Make twin and receipt-state work explicit.** D1–D4 omit a concrete evaluator prediction/ID-allocation contract. The current hasher rejects an unknown `Table.deliver`; the evaluator’s derived-write machinery handles aggregates. Receipt-state changes also need committed versions, traced dependencies and live invalidation: changing a pooled row at the same sequence is rejected. Re-estimate these lanes; I could not verify a greater-than-2× sizing claim without an effort baseline. [1019:294](llp/1019-derived-delivery-custody.rfc.md:294), [certificate-identity.ts:113](snapback2/packages/evaluator/src/certificate-identity.ts:113), [runner.ts:794](snapback2/packages/evaluator/src/runner.ts:794), [range-store.ts:1168](snapback2/packages/snapback2/src/store/range-store.ts:1168).

**Fix the sample/API acceptance.** `inbox` needs `by byRecipient`; both recipient-prefixed indexes otherwise match. `thread` is descending and therefore not resumable. Changing `messageId` to `row` and removing `expired` also breaks existing assertions, so promise equivalent behavior with revised tests, not unchanged result types/checks. Update the authored delivery seed rows. [catalog.ts:271](snapback2/packages/compiler/src/quarry/catalog.ts:271), [page.rs:128](snapback2/crates/snapback2-core/src/certificate/page.rs:128), [chat.test.ts:141](snapback2/packages/snapback2/templates/chat/snapback/tests/chat.test.ts:141), [chat.test.ts:712](snapback2/packages/snapback2/templates/chat/snapback/tests/chat.test.ts:712), [seed.ts:26](snapback2/packages/snapback2/templates/chat/snapback/seed.ts:26).

**Treat `schedule …: delete .` as lowering plus certification.** Lower it ahead of time to a private target and preserve schedule admission, settlement and rejection reporting. Self-deletion requires both timer maintenance and settlement writes; this is more than admitting a parser token. [parser.ts:137](snapback2/packages/compiler/src/quarry/parser.ts:137), [timers.rs:175](snapback2/crates/snapback2-core/src/timers.rs:175), [engine/timers.rs:153](snapback2/crates/snapback2-core/src/engine/timers.rs:153).

**Complete diagnostics.** Assign `E_DELIVER_UNBOUNDED` to `bound`, principal/declaration errors to `schema`, declaration sites, concrete rewrites and an existing guide page. Specify equivalent raw-schema admission. A code name alone does not satisfy the diagnostic contract. [1019:120](llp/1019-derived-delivery-custody.rfc.md:120), [NOT-DOING.md:102](rules/NOT-DOING.md:102).

### 4. Minor

- Make `Systems:` paths unambiguous and add LLP 1001/1020 to `Related:`; both supply central design premises. [1019:5](llp/1019-derived-delivery-custody.rfc.md:5), [1019:152](llp/1019-derived-delivery-custody.rfc.md:152).
- Qualify the literal “only consumer/grep hit” claims: the owner manifest also emits retention, and replay code mentions a low watermark. Neither establishes server delivery tracking. [writer_ledger.rs:350](snapback2/crates/snapback2/src/writer_ledger.rs:350), [writer_replay.rs:55](snapback2/crates/snapback2/src/writer_replay.rs:55).
- Record all added significant words, including optional-receipt syntax, and measure the complete runtime against 84,000 bytes. Deleting template lines does not establish those savings. Keep recipes within the existing guide budget. [LLP 1011:626](llp/1011-quarry-ergonomics.rfc.md:626), [NOT-DOING.md:76](rules/NOT-DOING.md:76).

### 5. What acceptance does not prove

**Receipt truth across failure and pagination.** Add a journey covering 51 same-commit events, dropped responses, metadata-only and filtered reads, arbitrary cursors, ordinary initial/live drainage, acknowledgement retry after restart, and two clients for one principal. Assert that unfetched bodies never become acknowledged and unavailable authority remains partial. Acceptance 4 currently tests only advancing resume progress. [1019:283](llp/1019-derived-delivery-custody.rfc.md:283), [LLP 0329.016:794](llp/0329.016-agentic-dev-loop-from-scratch.rfc.md:794).

**Historical custody through evolution.** Send, remove recipients, lower the membership cap, add a new member, change the declaration, then unsend and expire old messages. Prove original recipients receive tombstones, joiners receive full history without becoming original recipients, and no successor silently discards custody. Run actual principal-authorized receipt reads against hidden cases. Acceptance 5’s bare add/remove successor cases miss this history. [1019:286](llp/1019-derived-delivery-custody.rfc.md:286), [social-messenger.md:500](benchmarks/briefs/social-messenger.md:500).

**Old edits outside the live tail.** Drain several pages, leave the thread unmounted, disconnect, edit an early message, reconnect only the drain, then restart offline and open that thread. Require updated content, edited metadata and correct search results without duplicate bubbles. Existing acceptance never isolates this propagation gap. [1019:274](llp/1019-derived-delivery-custody.rfc.md:274), [LLP 1012:559](llp/1012-local-first-v1.spec.md:559).

**Containment, fence and actual qualification.** Add engine/twin corpus cases at historical fan-out limits, mixed nonuniform scans, ID recreation, job/schedule rollback and successor-crossing queued intents. Cross the offline fence and prove receipts do not authorize replay early or erase queued writes. Measure existing loop/runtime budgets. I could not verify runtime passes in this static review; listing journeys does not establish them. [runner_ops.rs:1230](snapback2/crates/snapback2-core/src/engine/runner_ops.rs:1230), [LLP 1012:467](llp/1012-local-first-v1.spec.md:467), [RULES.md:41](rules/RULES.md:41).

### 6. Alternatives

The strongest alternative is ahead-of-time expansion into ordinary private history tables and certified IR, with admission enforcing the generated writes at every content-write path, including seeds and schedules. Keep historical audience rows durable; make acknowledgements a separate bounded operation. This preserves ordinary authorization and gives the twin executable writes instead of a second implicit mutation system. I prefer that representation to this RFC’s maintain-rebuild and read-side-watermark model. A small core hook may still be the simplest way to make custody impossible to omit: the existing shared row-change lifecycle is the concrete integration point. Prototype that enforcement before choosing compiler expansion versus native derived writes; neither requires a general trigger language. [RULES.md:55](rules/RULES.md:55), [runner_ops.rs:165](snapback2/crates/snapback2-core/src/engine/runner_ops.rs:165).

### 7. Sequencing

After the five-lane program lands, publish and run the cold reduced-Clique rerun against the loop bar before commissioning this entire RFC. Then prioritize the certificate-soundness fixes and evidence-backed evolution work identified by 1020, while explicitly excluding historical custody from its projection exemption. Revisit 1019 as durable audience custody plus mandatory change propagation, followed by opt-in acknowledgements with a reviewed protocol. Sequence 1021’s lifecycle visibility and termination work independently where it blocks real effect journeys; keep engine-dependent verification off the blocking path. The goal should be a demonstrated reduction in builder correction loops, rather than treating three proposals as an automatically authorized next program. [NOT-DOING.md:13](rules/NOT-DOING.md:13), [1020:90](llp/1020-day-two-evolution-and-legible-ceilings.rfc.md:90), [1021:25](llp/1021-effects-in-the-loop.rfc.md:25), [1021:53](llp/1021-effects-in-the-loop.rfc.md:53).

---

I could not write `/Users/ccheever/projects/snapback-el-20260908/reviews/rfc/1019-astra-max.md` because this session enforces a read-only filesystem.