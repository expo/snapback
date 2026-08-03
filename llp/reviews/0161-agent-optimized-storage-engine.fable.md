# LLP 0161 agent-optimized storage engine review — Fable family

## Round 1 — 2026-08-03 (target v0.1, SHA-256 b2a2bffeaca1a86bf9fd7a05aa7c63b6033cccc5bdf70aa964d04ca693ab55f7)

**Reviewer family:** Claude (Fable 5)
**Provider / runtime:** Claude Code subagent (Explore), fresh non-author context
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh subagent over the working tree at 50ff432a; instruction capsule pinned the target SHA, named LLP 0158/0088/0007/0081/0043/0146/0126/0155 and spot-check targets in src/, and barred reading llp/reviews/. Orchestrated by the Fable session that authored the draft, which therefore does not count as a reviewer; the review is recorded verbatim below.

---

## 1. Overall assessment

LLP 0161 is a genuinely useful piece of first-principles research: the three agent pressures (speculate / need proof / operate concurrently) are real and well-grounded in this repository's own fleet history, the seven properties mostly derive honestly from them, and the gap table is — on the four cells I spot-checked against the tree — substantially more accurate than gap tables in this genre usually are (P2's "computed only during migration verify" is exactly right per `src/rqs.rs` and `src/storage/migration_executor.rs`; P3's journal shape claim matches `src/storage.rs`; P5's "shipped and load-bearing" claim is verified in code; P1's rehearsal and dry-run citations are real). The no-new-engine conclusion follows from the P-set as stated, and the confidence section is unusually honest about the planned column and sequencing. But the document has one corpus-level blind spot that materially distorts its own gap analysis — LLP 0097 (Accepted, substrate landed in `src/branches.rs`) is absent from the document entirely, including the Related list, despite being the nearest existing thing to P1 and the source of the effect-capture machinery P1's quarantine needs — and one internal derivation gap: §1 derives "explicit merges for keeps" as a requirement, and no P-property answers it. Two gap-table cells also misstate what the cited LLPs actually say.

## 2. Verdict — NOT READY

The findings are all fixable in a single revision, but a Research document whose central artifact is a gap table cannot be READY while that table omits an Accepted-and-partially-landed LLP that sits directly on P1, mislabels LLP 0088's recommendation, and attributes an as-of capability to LLP 0158 that its design does not provide.

## 3. Strengths

- **§1 (Why agents change the requirements).** The three pressures are the right decomposition, each traced to evidence that actually exists (LLP 0158's vendor survey; LLP 0081's receipt discipline; this repo's fleet-collision memory). No property in §2 is derived from vibes alone — each carries an agent question it answers, which is the discipline the brief asks for.
- **§3 today-column accuracy where I checked it.** P2's cell is precisely true: `ContentDigestV1` lives in `src/rqs.rs:878-1052`, and its only production consumers are the migration keyset scan (`src/storage.rs:6116-6293`) and the executor's independent expected-value computation (`src/storage/migration_executor.rs:2958-3082`) — flat, streaming, migration-time-only, exactly as claimed, with LLP 0081 OQ2 (line 803) confirming the Merkle variant is asked-for and unowned. P5's cell is verified: server-captured vs client-supplied read sets are the LLP 0007 contract as written (llp/0007:461-491, DK-1 resolved), and both validation paths are shipped and commit-gating (`src/storage.rs:4002, 5126-5128, 11664, 11745`). P3's `[inferred]` hedge is honest and, on inspection, correct — `_snapback_changes` is `(version, table_name, row_id, op, row_json, changed_at_ms)` (`src/storage.rs:5600-5607`), no principal column, while seams like `_snapback_membership_transitions` do carry `principal`.
- **§2's closing paragraph and §3's reading.** The "deliberately absent: a bespoke on-disk format" argument is the document's best move — it makes the no-new-engine conclusion a consequence of the property derivation rather than an assertion, and correctly identifies P2 as the only write-path-touching property.
- **§Confidence.** "Planned overstates their solidity" (0158 is indeed untracked in the worktree; 0088 is Draft) and the explicit deference to LLP 0155/0130 roadmap ownership are exactly the sequencing honesty the brief asks to check. The §4 disclaimer ("if this direction is ever resourced") does not contradict program ownership.
- **Prior-art hygiene by delegation.** Load-bearing market claims are routed through LLP 0158, which carries its own re-verify caveats (Convex, Turso, Supabase rows explicitly tagged author-knowledge there); the Cambria/Jazz lens pointer resolves to a real record (LLP 0037 CC-8 row 11, llp/0037:197-198).

## 4. Concerns

**C1 — MAJOR — LLP 0097 is entirely absent, and its absence distorts the P1 row and the "today" story.**
Claim at issue: P1's today column — "Restore-derived rehearsal (LLP 0081 §7); byte-level backup/restore; single-mutation dry-run (LLP 0146)" — and the planned column citing only LLP 0158.
Evidence: `grep 0097` over the target returns nothing; 0097 is not in the Related list. Yet LLP 0097 (ephemeral data branches and effect isolation) is **Accepted** with substrate landed: `MaterializedBase` (`src/branches.rs:344`), COW overlay, branch registry, and the capture-don't-fire `EffectClass` ledger (`src/branches.rs:582`) — unwired, but real. LLP 0158 itself spends an entire section positioning against it and calls it "the implemented in-app sibling" (llp/0158 §Relationship to LLP 0097), and 0158's quarantine design *reuses 0097's contract*. For a gap analysis of "forking as a primitive" and "quarantined side effects," 0097 is today-column and planned-column material for P1 (and the effect ledger is relevant to P6's "effects recorded" claim). A reader of 0161 alone concludes Snapback's nearest fork-shaped asset is a Draft RFC; the corpus says it is an Accepted design with landed library substrate.
Resolution: add 0097 to Related; add it to the P1 row (today: landed-unwired branch substrate + capture ledger; planned: whichever of 0097-wiring/0158-F0 lands first builds the shared mediation seam, per 0158's own analysis), and mention it where P1's quarantine cost is discussed in §3's reading and §4 item 1.

**C2 — MAJOR — §1 derives a requirement no P-property answers: "explicit merges for keeps."**
Claim at issue: "The engine, not etiquette, must make concurrent speculation safe: isolation for tries, **explicit merges for keeps**" (§1, third bullet).
Evidence: the P-set covers isolation (P1, "disposal as the default outcome") but contains no keep/merge/promotion property — and the corpus has deliberately ruled on this territory: LLP 0088 §4 ratifies merge as app-level-if-ever, LLP 0158 makes merge-back a non-goal, and LLP 0097 answers the keep path with staged promotion by re-execution through the canonical stream. As written, the derivation names a pressure the ideal engine must answer and the ideal-property list silently drops it. Under the brief's own standard — "a missing property agents actually need is a finding" — this is the finding: the keep half of the speculation loop.
Resolution: either add a property (promotion/settlement of speculative work — plausibly "P1b: keeps re-execute through the canonical serialized path; merge is never a storage primitive," which is exactly 0097's staged-promotion design and would let Snapback score *well* on it), or explicitly reconcile in §2 why "explicit merges" resolves to re-execution-not-merge and cite the 0088 §4 / 0097 rulings.

**C3 — MATERIAL — the P4 planned cell mislabels LLP 0088.**
Claim at issue: "LLP 0088 (record history) — deferred" (P4 planned column).
Evidence: LLP 0088's recommendation is the opposite polarity for the capability named — it **pursues** read-only per-record history as its only phase-1 capability (llp/0088 §1, §Overall recommendation: "History-read-only first") and **defers branch creation** (§3). What is true is that 0088 is Draft, gated on the LLP 0085 evidence review, and unimplemented — but "deferred" attributes branching's disposition to record history. Since 0088's history-reads surface (ordered `(version, op, post-image)` per record, horizon marker) is precisely a partial P4 query surface, the cell understates the planned column for the one property it describes.
Resolution: reword to something like "LLP 0088 recommends pursue for read-only history reads (Draft, gated on the 0085 evidence review, unimplemented); branching deferred there and answered in-app by LLP 0097."

**C4 — MATERIAL — "LLP 0158's fork-at-version would give coarse as-of" overstates 0158's design.**
Claim at issue: that phrase in the P4 planned column.
Evidence: 0158's fork captures the parent "at a single committed version" — the version *at snapshot time* (llp/0158 §The fork operation). Nothing in 0158 forks at an arbitrary retained past version; the only past-version mechanism in its orbit is the DO PITR bookmark accelerator, which is one-provider, 30-day, and explicitly ruled ops-grade-not-product by LLP 0083 (a ruling 0158 §Non-goals restates). So a fork gives you "as-of now, frozen," which is a checkpoint, not as-of. As written the cell makes P4's planned column look closer than it is.
Resolution: either delete the phrase, or restate honestly: "0158 forks pin the *current* version; as-of a past version would additionally require retained snapshots or history-sized journal retention — the same retention question this row already names."

**C5 — MINOR — "strongest reviewed-migration contract in the field (LLP 0160 §4)" outruns its citation.**
Evidence: LLP 0160 §4 and Summary bound the claim to the seven-backend bakeoff group ("No system in the bakeoff has more than one of these"; "strongest migration *contract* of the group"). "In the field" is a superset claim the cited section does not establish.
Resolution: "strongest in the seven-backend bakeoff (LLP 0160 §4)" — same rhetorical force, actually covered.

**C6 — MINOR — the Dolt performance figure is load-bearing-adjacent and unverifiable from the corpus.**
Claim at issue: "Dolt's Merkle-DAG storage (novel-writes commit in seconds regardless of size)" (P2).
Evidence: this is vendor-blog-grade general knowledge (prolly-tree structural sharing), used to suggest P2's incremental maintenance is affordable — which OQ1 then honestly reopens. Nothing in the corpus or 0158's prior-art table carries this figure.
Resolution: tag it (`[unverified — vendor-published characterization]`) or drop the parenthetical; OQ1 already carries the real question.

**C7 — MINOR — LLP 0126 appears in Related but nowhere in the body.**
Evidence: 0126 is cited only in the header. OQ5's claim that "the sync engine already replays a journal on the client" is the one place 0126/0043 grounding belongs (0043 explicitly scopes its "retention" to the client's retained store, llp/0043:74-75). Not unfair to 0126 — just an unused citation and a lightly under-cited OQ. Similarly, "the 2026-08-03 test-inventory pass" (§Confidence) is an unanchored reference a future reader cannot chase.

## 5. Suggestions

- **Consider a P8 the corpus would score well on: durable idempotent intent / exactly-once replay.** Agents crash mid-loop and re-issue constantly; "proof over memory" applies to *in-flight work*, not just committed history. Snapback already ships acknowledgement-driven, auth-bound, exactly-once mutation settlement (LLP 0043) — a property none of the cited vendors' agent positioning covers. Its absence makes the P-set look derived partly from what vendors market rather than purely from the three pressures.
- The concurrency pressure could also note **cost/quota governance** (a runaway speculating agent is a resource event, not just a correctness event) — even if only to scope it out to LLP 0154/0104 territory.
- P7's lens half would benefit from one sentence of agent-specific justification (agents ship schema changes at a rate that makes mixed-schema client populations the steady state, not an upgrade window) — right now it is the one property whose agent derivation is implicit.
- In §3's reading, "P2 … layers over SQLite as Snapback-owned bookkeeping tables, the same way the journal does" is a good argument — strengthen it by noting the digest update can ride the same transaction that writes `_snapback_changes`, which is also the honest framing for OQ1's hot-path question.
- The Summary's "no shipping system has the set" would be sharper acknowledging Dolt is the closest external holder (arguably P1–P4) and that P5 is where it stops — that is the differentiation argument in one line.

## 6. Open questions for the author

1. Is the 0097 omission deliberate scoping (in-app branches ≠ "storage engine" property) or an oversight? If deliberate, the document should say so, because 0158 — which the document leans on heavily — treats 0097 as the load-bearing sibling.
2. For §1's "explicit merges for keeps": is the intended answer re-execution-through-canonical-path (0097 staged promotion), and if so should the ideal-property list say that agents need a *keep* primitive and that merge-free re-execution is the deliberately chosen shape of it?
3. P6's today cell says handler "effects recorded, inputs not" — does "recorded" mean journal post-images only? The 0097 effect ledger (the thing that would record *outbound* effects) is landed-but-unwired, so today an emailed email is not durably recorded anywhere. Worth one clarifying clause.
4. Should P4's row distinguish "checkpoint" (fork-at-now, cheap, nearly designed) from "as-of" (arbitrary retained version, retention-policy-expensive)? OQ3 already gestures at fork-pinned history; the table conflates the two.
5. Does the "High" confidence on the today column survive the C1/C3 corrections, or should it drop to "Medium-high, one corpus omission found in review"?

## 7. Recommended next step

One revision pass, not a redesign: add LLP 0097 to Related and to the P1 (and P6) rows; resolve the merges-for-keeps derivation gap either with a new property or an explicit reconciliation citing 0088 §4/0097; fix the P4 cells (0088 polarity, fork-at-version); apply the minor citation fixes (C5–C7). The document's thesis, derivation method, and conclusion all survive these corrections — after them, a second cross-family look at just the diff should suffice for READY, and the doc can then serve its evident purpose as the umbrella map over 0158/0159/0160.


---

## Round 2 — 2026-08-03 (target v0.2, SHA-256 210c8120d552c48914c336c3196aaf249dd15794e99a6b5df1a81182a536c188)

**Reviewer family:** Claude (Fable 5)
**Provider / runtime:** Claude Code subagent (general-purpose), fresh non-author context, blind to prior rounds and to llp/reviews/
**Date:** 2026-08-03
**Redacted:** no
**Method:** same capsule shape as round 1, retargeted at the v0.2 bytes. Recorded verbatim below.

---

## 1. Overall assessment (one paragraph)

This is an unusually trustworthy Research document. I verified every load-bearing "today" cell against the tree and each one checked out: the change journal's exact shape with no principal column (`src/storage.rs:5600-5608`), server-captured read sets that are shipped and genuinely load-bearing for both commit-time validation and live-matcher invalidation (`src/storage.rs:5126-5128`, `src/live_matcher.rs:128`, conflict diagnostics carrying `capturedReads` at `src/storage.rs:11895`), `ContentDigestV1` computed only in the apply/rehearsal verifying phase with `migrate verify` re-proving the sealed receipt and explicitly never re-digesting live tables (`src/storage/migration_executor.rs:2956-2977, 3832-3838`), the landed-but-unwired branch substrate (`src/branches.rs`: `MaterializedBase` at 344, `EffectClass` at 582, `capture_effect` at 685), shipped dry-run (LLP 0146's own capability row, `dry_run` in `src/host_ops.rs`), `_snapback_client_mutations` settlement (`src/storage.rs:1420`), the `rehearse` verb (`src/cli.rs:985`), and the deterministic handler tier's ambient-time denial plus recorded ctx-answer ledger (`src/runtime.rs:3846` `WrappedDate.now = deny("Date.now")`; `CtxAnswerLedger` throughout `src/host_ops.rs`/`src/local.rs`). The eight properties trace honestly to the three agent pressures, the prior-art tags are disciplined, and the narrowed conclusion (no bespoke on-disk engine, but several gaps are engine-layer internals) follows from the table. The residual defects are real but bounded: the LLP 0088 decline-vs-defer polarity is still imprecise despite the v0.2 header claiming it was fixed, the LLP 0158 posture cell and sequencing preamble understate that document's recorded v0.12 state (OQ9 decided, first consumer pinned, F0a green-lit with a ticket program present in the tree), and the derivation from the concurrency pressure stops short of one candidate property (resource governance) without saying why.

## 2. Verdict — READY or NOT READY

**READY** — as a Draft Research document, with the MATERIAL concerns below applied as pre-status-change edits. Nothing I checked contradicts shipped code; the remaining defects are citation-polarity and posture-staleness, not analysis errors.

## 3. Strengths (cite sections)

- **§3's today column survives adversarial spot-checking.** Every cell the brief directed me to verify was accurate, including the two easiest cells to get wrong: P2's phasing claim ("`migrate verify` re-proves the recorded receipt; it does not re-digest") matches `migration_verify_receipt`'s comment and behavior verbatim, and P3's journal shape ("version, table, row id, op, post-image, timestamp — no principal") is exactly the DDL. The P5 "closest to ideal, on paved paths" claim is correct in both directions — capture is shipped/load-bearing *and* the Option A client-supplied-baseline carve-out for host-plan mutations is faithfully reported against LLP 0007's read-set-validation contract (0007 lines 461-491).
- **§2 P4's three-strengths decomposition** (checkpoint / per-record history / arbitrary as-of, three different substrates) is a genuine analytic contribution, and the withdrawn fork-as-as-of claim is correct per LLP 0097 §1 ("v1 forks the current canonical head only").
- **§2 P8** is a well-derived addition — it names a property the corpus already treats as correctness (0043 `clientMutationId` settlement, 0081 replay-returns-the-receipt keyed by `operationId`+audience, 0070 immutable-argument jobs) and correctly distinguishes it from P3/P6.
- **Prior-art tagging discipline** (§2): the Dolt performance figure is `[unverified — vendor claim]`, PlanetScale is narrowed exactly to what LLP 0158's survey table says (schema branches; data via backup/restore), and the Cambria/Jazz lens citation ("a pointer, not an adoption, LLP 0037 CC-8.11") matches 0037's row-11 note precisely. Datomic, FoundationDB OCC, and Convex read-sets are correct and honestly tagged; LLP 0126 is cited fairly (its PowerSync schemaless-views and Triplit compatibility-refusal findings are real, 0126 lines 815-817, 1115-1116).
- **§Confidence is honestly calibrated** — "treat the table as reviewed once, not exhaustive," "posture is not a plan," and low-medium on sequencing with 0155/0130 named as roadmap owners, consistent with 0155's accepted Summary.
- **The narrowed conclusion** (§3 reading, §2 "Deliberately absent") follows: no P-property touches pages/fsync/crash-atomicity, and the Convex-above-commodity-persistence precedent is correctly deployed.

## 4. Concerns

**C1 — MATERIAL. LLP 0088's declined capabilities are still labeled "deferred," despite the revision header claiming this was fixed.**
Claim at issue (P4 corpus-posture cell): *"defers losing-version retention and branching"*; also §1: *"record-level merge is deferred at the core (LLP 0088 §4: app-level-if-ever)"*. Evidence: LLP 0088 §2 is **"do not pursue"** for retained losing versions (0088:126, "losing-version retention declined as server surface," 0088:257), and §4 is **"do not pursue as core machinery, ever"** (0088:187) — only branch creation (§3) is *deferred*. The v0.2 Revised header asserts "LLP 0088's pursue/defer polarity fixed," so the residue is a claimed-fixed defect. The §1 sentence's lead clause ("merge is never a storage primitive") carries the right meaning, but the verb "deferred" contradicts it mid-sentence. Resolution: use 0088's own three verbs exactly — pursues history reads; defers branching; **declines** losing-version retention and core merge.

**C2 — MATERIAL. The P1 posture cell and §4's framing understate LLP 0158's recorded state in the same working tree.**
Claim at issue: P1 corpus-posture cell *"LLP 0158 Draft, spike proved cold-copy O(1) + journal diff *only* — identity mint, credential isolation, egress mediation, asset custody, registry/TTL all unbuilt"* (build-state accurate), plus §3's *"none of it is commissioned program work unless LLP 0130/0155 say so"* and §4's *"if this direction is ever resourced."* Evidence: LLP 0158 v0.12 (llp/0158-instance-forking.rfc.md:8-16, 994-1031, 1061-1081) records **OQ9 DECIDED** (same-`appId` derived deployment), the **first consumer pinned** (this repo's agent fleet), and **F0a green-lit by the author with a ticket program opened** — and `issues/20260803-0158-f0a-*.md` (four F0a tickets plus the first-consumer ticket) exist in the tree (all uncommitted, as is 0158 itself — the Confidence section's "0158 is uncommitted" is accurate). The sequencing view's item 1 therefore reads as hypothetical when its first slice has an author green-light recorded in the companion document. Resolution: update the P1 posture cell and §4's preamble to record the F0a green-light and OQ9 decision (noting the uncommitted state), or date-pin the posture column explicitly to a pre-v0.12 read.

**C3 — MATERIAL. The completeness check stops one property short of the concurrency pressure.**
Claim at issue (§Summary): *"Deriving an ideal engine from those pressures yields eight properties."* The concurrency pressure (§1) derives correctness-isolation (P1) and OCC/read-sets (P5), but nothing covers **resource governance** — quotas, fairness, blast-radius bounding when N agents speculate concurrently on one substrate. The fleet evidence the document itself cites ("this repo's own fleet memory documents the collision patterns") includes resource collisions (stale servers on fixed ports, trampled shared databases — the exact pain LLP 0158's first-consumer pin names), and LLP 0097 OQ5 ("Resource bounds for N concurrent futures — default caps, suspension, GC pressure") already asks the engine-layer half of this question. Similarly, "proof over memory" derives write provenance (P3) but is silent on read auditing (who *saw* what — the forensic complement, and a real agent-fleet question). Resolution: either add the property (or a P3 read-side note), or add a "considered and excluded" line explaining why resource governance is deployment/product surface rather than engine — a Research doc claiming a derived set should show the boundary either way.

**C4 — MINOR. P6's effect-record framing overgeneralizes from the email example.**
Claim at issue (P6 today cell): *"The 0097 `EffectClass` ledger — the thing that would durably record outbound effects — is landed but unwired, so today an emailed email is recorded nowhere durable."* The email half is right (fetch-borne egress leaves no durable record), but one outbound-effect family already **is** durably recorded today: the push lane's intent/message ledger with settlement states and receipt polling (`_snapback_push_intents_v1`, `_snapback_push_messages_v1` with `handed-to-expo`/`ambiguous-receipt`/receipt-poll columns, `src/push.rs:808-856`). Calling the unwired 0097 ledger "the thing that would durably record outbound effects" erases the per-lane exception the document's own coverage caveat exists to preserve. Resolution: scope the sentence to non-push handler egress, or cite the push ledger as the existing per-lane precedent for P6's "broader authoritative effect log."

**C5 — MINOR. Inconsistent tagging on the one untagged Dolt fact.**
Claim at issue (P2): *"Prior art: Dolt's Merkle-DAG/prolly-tree storage"* — asserted bare, while the sibling Dolt claims in P1/P3 carry `[author knowledge — reverify]`. The fact is true (and not load-bearing-wrong), but the document's own tagging discipline says external attributions are tagged inline. Resolution: add the tag.

**C6 — MINOR. P4's as-of cell co-cites LLP 0043 for a window LLP 0008 governs.**
Claim at issue: *"sync-window journal retention (LLP 0008/0043 — client-store retention, per 0043's own scoping) cannot reconstruct arbitrary past states."* The server journal's retention window is LLP 0008's; 0043 explicitly scopes its "retention" to the **client's** retained state (0043:74). The parenthetical acknowledges this, but the "0008/0043" pairing still reads as if both govern the server window. Resolution: cite 0008 for the server journal window and drop or relocate the 0043 reference.

## 5. Suggestions (non-blocking)

- P2's prose asymptotics ("O(1) equality, O(log n) localization, output-sensitive enumeration") and the Revised header's "Ω(k) enumeration" use different vocabulary for the same claim; align them.
- OQ1's "is a lagging digest still a proof?" deserves a pointer to LLP 0081 §5's "a digest with no independent predecessor-derived expected value is inventory, not proof" — the corpus already has the vocabulary to answer it.
- The P5 cell could note that 0007 records Option A as "decided 2026-07-02, pending Charlie's ratification" with the LLP 0065 generated-pattern carve-out — one clause would make the cell's Option A citation self-contained.
- Consider a one-line note in P1 that the spike also surfaced the function-manifest load gap (`appRoot: null` boots fail function runs until `snapback load`) — it is the one operational sharp edge an implementer of "wire what's landed" hits first (0158 §Spike evidence 2).

## 6. Open questions for the author

1. Does LLP 0158's F0a green-light (recorded in v0.12, tickets in-tree) change §4's "if this direction is ever resourced" framing, or do you want this document to deliberately not track uncommitted companion state — and if the latter, should the posture column say so?
2. Is resource governance for concurrent agents (C3) an engine property this document should own as a P9, an LLP 0097-OQ5/0009 concern, or explicitly out of "storage engine" scope?
3. Should P3's provenance ideal include read-side auditing, or is that deliberately P5-explanation territory?
4. Is the push intent/receipt ledger (C4) the intended model for P6's "broader authoritative effect log," or a lane-local pattern the 0097 ledger supersedes?

## 7. Recommended next step

Apply C1, C2, and the C4/C6 scoping fixes as a v0.3 edit and record a decision on C3 (add, or explicitly exclude with reasons). Given how well the today column verified, a full further round is not warranted for a Draft Research doc — a spot re-review of the v0.3 diff by one reviewer suffices, after which promoting to Active is defensible at the author's call. The document's own next-move claim stands: P1 (wiring 0097's substrate, coordinated with 0158's F0a corpus) is the correct highest-leverage first move, and this document is now a reliable map for it.
