# Panel: LLP 1016 — The administrative plane (codex gpt-6-astra)

**Reviewed:** `llp/1016-administrative-plane.rfc.md` as landed at `6d3d09c6f`, in a read-only capsule exported from that commit (`~/projects/snapback-1016-panel/capsule-astra`), with the engine, owner, compiler, evaluator, templates, the design RFCs it extends, the control-plane RFC beside it, the briefs, and the rules.
**Family:** OpenAI Codex, model `gpt-6-astra`
**Provider/runtime:** codex-cli 0.153.4 (`codex exec --skip-git-repo-check -m gpt-6-astra -c model_reasoning_effort=xhigh -s read-only -C <capsule> -o <out>`); the model's own provenance line says "reasoning effort: not exposed" — the CLI was passed `xhigh`. 237,017 tokens used.
**Date:** 2026-09-05
**Redacted:** No — the panelist read the in-repo documents and sources directly in its own capsule; no content left the local machine beyond the model serving the CLI.
**Method:** Round 1, mutually blind, on the identical brief preserved at `llp/reviews/1016-administrative-plane.panel.brief.md`. The read-only sandbox refused the write to the requested output path (its closing line says so); the review below is its final message as captured by `-o`, verbatim. The orchestrating session authored LLP 1016 and is not a reviewer; it verified the engine claims below against the tree before the synthesis (`1016-administrative-plane.panel.synthesis.md`).

---

## Round 1 review (verbatim)

Reviewer: gpt-6-astra · reasoning effort: not exposed · Date: 2026-09-05 · Method: blind round-1, read-only capsule at 6d3d09c6f

**Verdict: NOT READY**

I support certified chunks and an owner-driven timer. I would commission a smaller revision: resumable jobs, row timers, and narrowing; defer automatic erasure and large-group delivery until their semantics are demonstrated. The RFC mistakes several local properties—write permission, cursor atomicity, receipt absence—for end-to-end guarantees. Those gaps can produce a successful-looking incomplete task. Raw SQL or an external scheduler would not repair them. I could not verify the proposed line estimates or performance numbers; this was source review, without execution benchmarks.

**Blocking findings**

1. **D2 proves too little authority.** Claim: “a rule with no `system` disjunct does not” admit it; “A job that would be `E_RULE` at chunk 400 is red at `check`.”

   Evidence: Boolean rules, dynamic existence, creation, and old/next images are real (`snapback2/packages/compiler/src/quarry/schema.ts:124`; `snapback2/crates/snapback2-core/src/engine/runner_ops.rs:715`). `not deny` admits system without a system disjunct; `system and exists …` is conditional. More seriously, reads remain rule-filtered: a uniformly denied scan reports exhausted empty (`snapback2/crates/snapback2-core/src/engine/runner.rs:1099`). The template’s membership and message reads require membership (`snapback2/packages/snapback2/templates/chat/snapback/schema.q:39`, `snapback2/packages/snapback2/templates/chat/snapback/schema.q:68`).

   Consequently, adding system write permission can leave a fill silently visiting zero rows. Define conservative Boolean partial evaluation under system, distinguishing proven/unknown/refused, and cover scan visibility and point reads, both upsert branches, and engine-owned maintained writes. Retain runtime checks; stop promising that certification excludes future data-dependent failures.

2. **D1/D3 do not preserve the task across concurrency or succession.** Claims: “Every row present when the stage starts”; resume if “table and index survived with compatible types.”

   Evidence: ordinary updates reindex changed rows (`snapback2/crates/snapback2-core/src/engine/runner_ops.rs:126`). Preventing the job body from moving its index does not prevent another mutation from moving an unvisited row behind the cursor. Program identity is explicitly distinct from schema identity (`snapback2/crates/snapback2-core/src/registry.rs:93`).

   A successor changing `fill X=1` to `fill X=2`, or inserting a stage before the saved ordinal, meets the proposed compatibility test but yields a mixed task. Require globally stable scan keys, define inserts at the instant the cursor passes them, and bind stage identity, prefix, arguments, state types, and executable digest. Park on semantic changes. A live sweep can also run indefinitely under arrivals; distinguish it from the design’s sealed-input job (`llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:409`). Persist ad hoc executable content: `source_hash` alone cannot recover a missing file after restart.

3. **D6’s “three words” cannot derive the claimed closure.** Claim: “any column of type `principal`, or a `ref` to a table that does”; scrub “points every principal column … at … `erased`,” while constraints still bind.

   Evidence: the template has unique and immutable principal columns (`snapback2/packages/snapback2/templates/chat/snapback/schema.q:11`, `snapback2/packages/snapback2/templates/chat/snapback/schema.q:35`, `snapback2/packages/snapback2/templates/chat/snapback/schema.q:38`); immutability and uniqueness bind updates (`snapback2/crates/snapback2-core/src/engine/runner_ops.rs:455`, `snapback2/crates/snapback2-core/src/engine/runner_ops.rs:631`). Two scrubbed principals can collide; even the first can violate immutability. References are nominally different from principals, and bounded lists/JSON exist (`snapback2/packages/compiler/src/quarry/program.ts:1076`; `snapback2/packages/compiler/src/quarry/parser.ts:376`).

   No traversal/order is specified for indirect references, cycles, multiple subject paths, or losing the parent before scanning children. Maintained targets also cannot be independently scrubbed consistently with their source projection. Prefer an authored erasure job with explicit coverage and narrowly defined identity operations. Coverage checking must disclose opaque JSON/text limitations. If retaining derivation, define and test this algebra before commissioning J2; use per-subject tombstones rather than one collision-prone identity.

4. **Erasure neither fences recreation nor covers system custody.** Claim: “fence every session … so no intent lands mid-sweep”; clean credentials near the end; sweep “identity, sessions, assets, and the outbox.”

   Evidence: login creates another session from surviving credentials (`snapback2/crates/snapback2-core/src/identity.rs:212`). The store also holds principal-bearing grants, grant slices, and serialized client responses, omitted by D6 (`snapback2/crates/snapback2-core/src/store.rs:219`). Outbox rows have no principal field and retain payload, result, and error (`snapback2/crates/snapback2-core/src/store.rs:182`); claimed payloads leave the writer for effect execution (`snapback2/crates/snapback2/src/effects.rs:63`).

   First commit a durable erasing state that disables authentication and prevents relevant app/job/timer writers from recreating data. Define cancellation/settlement for every outbox state and explicit subject attribution; acknowledge in-flight external I/O. Include replay responses, queued-job arguments/state, unclaimed uploads, and logs in custody accounting. Session logout alone is insufficient.

5. **Device propagation is false for scrub and incomplete for delete.** Claim: “a departed recipient keeps a scrubbed shell”; erasure reaches “every phone on its next resume with no new mechanism.”

   Evidence: a hidden point read exposes no candidate evidence (`snapback2/crates/snapback2-core/src/engine/runner.rs:966`), and delivered-history restores the old content (`snapback2/packages/snapback2/src/store/range-store.ts:1080`). Resume processes the log tail and mounted queries, not every historical answer (`snapback2/crates/snapback2/src/writer_resume.rs:93`, `snapback2/crates/snapback2/src/writer_resume.rs:120`).

   Scrubbing does not make a hidden row readable or absent. Deleting also needs a fresh observation; deleting the delivery row can remove the path that would obtain it. Specify durable revocation delivery covering original recipients and retained answers, or narrow the promise. Test a departed member with an unmounted old page and a watermark beyond the affected delivery.

**Material findings**

1. **Scheduling needs progress and occurrence semantics.** Claims: “only when no client action is waiting”; “at most 64 per tick”; “at-least-once.”

   Evidence: the writer already has an independent timeout loop (`snapback2/crates/snapback2/src/writer.rs:439`); the cited tick belongs to the separate effects runner (`snapback2/crates/snapback2/src/effects.rs:305`). Client-first-until-empty permits indefinite job/timer starvation, and an unbounded head job blocks later jobs. Use bounded interleaving and round-robin chunks; check clients between timer targets. Define schedule installation/backfill, changed/deleted declarations, rearming, and same-`at` reuse. Atomic target-plus-settlement can commit once per occurrence; external effect delivery remains separately retryable. Expose failed-timer recovery; a permanently settled rejection can otherwise leave expired content available. M5 requires expiry without clients (`benchmarks/briefs/social-messenger.md:562`).

2. **D8 changes message semantics unnecessarily.** Claim: “a 5,000-member group sees the message in ten commits.”

   Evidence: M3 requires send-time membership and only 2–50 members (`benchmarks/briefs/social-messenger.md:488`, `benchmarks/briefs/social-messenger.md:500`); current member addition refuses 51 (`snapback2/packages/snapback2/templates/chat/snapback/groups.q:13`). The proposed job scans changing membership and stamps delivery time per chunk. Membership removal/re-addition, unsend before delivery, and delayed earlier messages need explicit treatment. Keep bounded chat sends; demonstrate continuations on a workload with sealed recipients and ordering/completion rules before replacing that recipe.

3. **A snapshot is not sufficient dry-run isolation.** Claim: “nothing touches the store, and the numbers are real.”

   Evidence: snapshots copy SQLite (`snapback2/crates/snapback2-core/src/store.rs:805`); normal owner startup starts effects and asset sweeping (`snapback2/crates/snapback2/src/owner.rs:218`; `snapback2/crates/snapback2/src/writer_assets.rs:57`). Blob reclamation reaches shared external files (`snapback2/crates/snapback2/src/asset_gc.rs:16`).

   Define a rehearsal runtime: no outbound effects, no autonomous copied jobs/timers, no shared blob mutation, pinned clock and isolated allocations. Report effect intents and snapshot-relative results, not future production guarantees.

4. **Narrowing is feasible, but J0 is not merely a diagnostic change.** Claim: “the same walk that already validates newly declared columns”; `check` reports stored null counts.

   Evidence: type differences first become destructive plans (`snapback2/crates/snapback2-core/src/successor.rs:158`); changed required columns are then rejected on any populated table (`snapback2/crates/snapback2-core/src/successor.rs:214`); stored validation only selects certain changed types (`snapback2/crates/snapback2-core/src/successor.rs:339`). Project `check` compiles without a live-store admission call (`snapback2/crates/snapback2/src/check.rs:393`).

   Amend all three admission paths, treating absent fields as null, and recheck inside installation. Separate static check from store-dependent preflight. J0 must not require erasure declarations before their grammar/runtime ships.

5. **Ledger deletion and “zero grace” need redesign.** Claims: delete “the principal’s rows from `_commits`”; release assets by setting `released_at` “to the past.”

   Evidence: touched keys belong to the affected subject regardless of commit actor (`snapback2/crates/snapback2-core/src/store.rs:36`); sequence derives from `MAX(seq)` (`snapback2/crates/snapback2-core/src/store.rs:509`). Reclamation uses `MAX(created_at, released_at)`, so backdating release does not immediately collect a new upload (`snapback2/crates/snapback2-core/src/assets_ledger.rs:356`); forks retain blobs (`snapback2/crates/snapback2/src/asset_gc.rs:22`).

   Preserve sequence/history semantics, define field-level residue across all actors, and report fork-held bytes. Use an explicit immediate-reclamation operation. Do not implement an unbounded ledger sweep as a supposedly bounded “plain” stage.

**Minor findings**

- §10 says four lanes but lists J0–J4. D9 says “one flag”; it adds several.
- D3 resumes only parked jobs, while §6.8 promises resume after cancel. Choose one.
- D11 says deploy tokens see “neither,” although LLP 1015 D6 makes deploy a superset of read (`llp/1015-control-plane.rfc.md:241`).
- §5 omits grammar/state details for `job.<name>`, statement-stage boundaries, and stage returns; spell them or remove cross-stage bindings.
- List the 4 MiB closure ceiling too (`snapback2/crates/snapback2-core/src/certificate.rs:40`).

**Answers to the thirteen questions**

1. **Direction.** Yes to a small driver. It preserves the ordinary interpreter and traced invalidation (`snapback2/crates/snapback2-core/src/live.rs:154`). SQL under a paused owner could work only with explicit rebuild/revalidation and bounded downtime; that is another operational contract. Existing successor rebuilds already traverse whole tables (`snapback2/crates/snapback2-core/src/successor.rs:442`), so “every transaction” overstates today’s guarantee. Abandon chunks for a specific migration only if measured throughput or atomic-cutover requirements justify it.

2. **Four hats.** Schedules/expiry and maintenance are real; universal account erasure is operationally useful but not an M1–M8 requirement. Blocking/reporting is explicitly excluded (`benchmarks/briefs/social-messenger.md:96`). The actual larger scale gap includes 500 followees, beyond the documented merge recipe (`benchmarks/briefs/social-messenger.md:142`; `snapback2/packages/snapback2/guide/quarry.md:146`). Include backup/export, seeding, and effect recovery in the plane’s map, not new kinds. Clique Pay asks for paired ledger writes and ≤50 participants, not close-of-books/payout jobs (`benchmarks/briefs/clique-pay.md:33`).

3. **Chunked mutation.** Atomic cursor-plus-data is right. Persisted typed positions survive deletion; ordinary `for` materializes a bounded domain (`snapback2/crates/snapback2-core/src/engine/runner.rs:246`). Fix B2 and require authoritative complete scan visibility. Partial backfill is acceptable with dual-writing and tolerant readers; erasure needs immediate revocation; fan-out needs product-visible completion rather than assuming task-wide atomicity.

4. **Authority.** Keep ordinary rules for generic jobs; do not turn arbitrary jobs into seed-authorized writers. B1’s conservative proof is sufficient, intentionally incomplete. Engine-owned aggregate deltas retain their exemption. Avoid automatically appending `or system` to an entire transition rule: old/next predicates may encode essential policy (`snapback2/packages/snapback2/templates/chat/snapback/schema.q:48`).

5. **Migration.** Expand/fill/contract is an honest general path after M4 above. No separate `migrate` block yet. Rename-by-copy has costs—dual writes, indexes, app references—and M7’s particular count backfill may already use successor-maintained rebuilding (`snapback2/crates/snapback2-core/src/successor.rs:461`; `benchmarks/briefs/social-messenger.md:688`). Measure before adding another transform surface.

6. **Erasure.** Prefer authored jobs plus explicit coverage and identity lifecycle operations. The current derivation hides choices concerning references, opaque payloads, aggregates, uniqueness, historical devices, and snapshots. Refuse an erasure invocation whose coverage is incomplete; do not make unrelated template `check` fail. B3–B5 and material finding 5 are prerequisites to a completion claim.

7. **Schedules.** Row timers are right; mutation and job targets are useful, but firing a job means atomic enqueue, not completed work. Use the writer’s clock directly; development advances already sweep on that thread (`snapback2/crates/snapback2/src/writer.rs:731`). Defer `every`: a persisted next-digest row rearmed by its target serves recurrence. External cron is an explicit fallback, not fulfillment of M8’s integrated schedule requirement.

8. **Continuations.** The twin must evaluate arguments before consuming the id, matching Emit (`snapback2/packages/evaluator/src/runner.ts:166`). Preserve sender-inline delivery, enqueue with pinned event identity/time, then write idempotent recipient deliveries. Do not use this for immediate revocation; proposed `propagate` explicitly covers work “no job may defer” (`llp/0329.014.004-bounded-data-programs-v1-design.rfc.md:249`). “Silent fifty” is real at execution: mutations become committed without querying range completeness (`snapback2/crates/snapback2-core/src/engine/mod.rs:704`); the template’s group cap prevents it.

9. **Driver.** One writer suffices. The latency unit must include synchronous subscription reruns (`snapback2/crates/snapback2/src/writer.rs:1097`), not just SQLite commit. Start experimentally at 50–100 rows, measure p95/p99 send latency and progress, and treat authored N as a maximum. A fixed internal time-share policy is preferable to operator pacing flags. Count maintained amplification and job bookkeeping in certification (`snapback2/crates/snapback2-core/src/certificate.rs:146`).

10. **Surface.** Keep `run`/`trace`, explicit system authority, admin-token hosted repairs, and read-only MCP defaults. Ordinary `run` currently uses the persona API (`snapback2/crates/snapback2/src/verbs.rs:123`); add a purpose-specific control capability, never an accepted system persona. `execute_adhoc` is a useful seam, but its Checker call lacks Generation’s separate effect-target validation (`snapback2/crates/snapback2-core/src/registry.rs:762`, `snapback2/crates/snapback2-core/src/registry.rs:405`). Match declared admission and persist ad hoc job content.

11. **Agent-friendliness.** An M1–M3 builder needs no erasure ritual. M4 brings deletion; M5 first forces owner-scheduled expiry without clients; M8 adds recurring authorized digests; M7 later evolves stored data (`benchmarks/briefs/social-messenger.md:540`, `benchmarks/briefs/social-messenger.md:596`, `benchmarks/briefs/social-messenger.md:752`, `benchmarks/briefs/social-messenger.md:670`). The missing paved recipe is expiry plus original-recipient revocation, demonstrated with both clients closed and an old retained page. The proposed plan/wait/receipt flow is otherwise good.

12. **Trade.** Delete/defer automatic erasure and its three clauses, `erase by`, global `erased`, and claimed closure test; `every … at` sugar; cross-stage bindings until exercised; authority certificates on unrelated mutations; universal proof claims; and the large-group template rewrite. Keep operational flags; they pay for resumability. Delete the fork CLI adapter as already directed (`llp/1007-state-of-snapback2-and-the-work.plan.md:300`), amend LLP 1015’s route table, and retain snapshot primitives. This overdue small deletion does not justify the whole new surface.

13. **Console.** Later is right. Human-readable `run --plan`, job status, and trace are enough initially; today’s trace already renders JSON prettily (`snapback2/crates/snapback2/src/trace.rs:49`). If needed, the smallest later view is a read-only job/erasure-coverage page on existing routes, without a scratchpad.

**Strengths**

Keep transactional cursor advancement, bounded interpreter execution, ordinary constraints and maintained deltas, explicit cancellation without rollback fiction, owner-local scheduling, one command/API surface, and honest receipts. Keep the distinction between read-time feed merging and durable recipient work. These are the useful core.

**Author decisions — recommendations**

1. §9.1: Row-triggered `at` first; recurrence through a persisted row, `every` deferred.
2. §9.2: No new verb; retain `persona` for session testing.
3. §9.3: One executing chunk, fair interleaving across jobs and client work; no pacing flag.
4. §9.4: Refuse erasure until explicit coverage; no global check-time requirement.
5. §9.5: No ad hoc ledger-row deletion; specify redaction with preserved history/sequence semantics.
6. §9.6: Hosted ad hoc yes, with admin authority, TLS, full admission, durable executable custody.
7. §9.7: After the loop bar; no premature J0 erasure gate.
8. §9.8: Execute the fork-adapter deletion and amend the route table.
9. §9.9: Add/fill/drop first; revisit rename on measured authoring cost.

**What I would build first in J1**

One declared, single-stage `byId` fill job with complete system-visible reads, conservative authority admission, a durable executable digest, and cursor/progress committed with data. Exercise more than two chunks; crash before/after commit, cancel, denied reads, changed program with unchanged schema, and concurrent sends. Include maintained deltas and subscription fan-out in the timing. Deliver `run --wait` and `trace` with one receipt. Establish that small kernel before stages, automatic erasure, recurring sugar, or the full rehearsal surface.

The read-only sandbox refused the write to `/Users/ccheever/projects/snapback-1016-panel/out/astra.md`.
---

## Round 2 response (2026-09-05, cross-read; verbatim)

**Method:** the same runner and capsule, on `1016-administrative-plane.panel.brief-r2.md` (the orchestrator's verification notes plus all three round-1 reviews). The read-only sandbox again refused the file write; the text is the final message as captured by `-o`, verbatim. 97,787 tokens used.

Reviewer: gpt-6-astra (reasoning effort not exposed) · Date: 2026-09-05 · Method: round-2 cross-read, read-only capsule at 6d3d09c6f

**Final verdict: NOT READY — unchanged from round 1.**

Keep the certified chunk driver, with a smaller remit: authored maintenance jobs, narrowing, and owner-driven schedules. Remove derived erasure and the chat continuation rewrite. Keep ordinary table-rule authority and the existing interpreter. Completion means completion of the declared sweep, with intermediate results visible; it does not establish snapshot semantics or universal erasure. I now favor minimal duration-based recurrence. This remains the same architectural direction, with fewer promises and less surface. I could not verify performance or implementation estimates; this was source review without runtime or performance testing.

**Agreements**

- I agree with Muse B3: cursor advancement and timer bookkeeping belong in the certified transaction.
- I agree with grok M1/M9: correct the benchmark motivations before using them to commission fan-out or migration work.
- I agree with both panelists on preserving constraints, receipts, explicit operator authority, and the deferred console.
- I agree with both on add/fill/drop and removing the already-redundant fork CLI adapter.

**Disagreements and changed positions**

**Authority: retain rules; remove automatic grants.** Grok correctly objects that appending `or system` grants every system writer access. Its proposed blanket exemption for declared jobs removes table-rule restrictions from all writes in those jobs. Seed accepts declared rows through a dedicated entry point (`snapback2/crates/snapback2-core/src/registry.rs:803`); maintained writes target engine-owned projections (`snapback2/crates/snapback2-core/src/engine/runner_ops.rs:295`). Neither establishes that arbitrary declared programs should receive that exemption. The chat membership update rule carries a real transition restriction (`snapback2/packages/snapback2/templates/chat/snapback/schema.q:48`).

Choose conservative three-valued evaluation with `Viewer := system`, admitting only proven-true rules; unknown refuses with an explanation. No SAT project is necessary: lowering exposes system as equality (`snapback2/packages/compiler/src/lower/schema.ts:364`), and structural rule analysis already exists (`snapback2/crates/snapback2-core/src/certificate_policy.rs:66`). Include reads and both upsert branches. A denied scan can look empty (`snapback2/crates/snapback2-core/src/engine/runner.rs:1099`), so write permission alone cannot certify a fill. Remove the unconditional `or system` rewrite and the promise that no later chunk can fail. Muse's hypothetical application membership for system is unavailable under the verified reserved-principal rules.

**Erasure: neither tombstones nor table-write coverage repairs D6.** Muse's per-subject tombstone alternative addresses identity collapse but still changes an immutable principal: the template declares that constraint at `snapback2/packages/snapback2/templates/chat/snapback/schema.q:13`, and updates enforce it at `snapback2/crates/snapback2-core/src/engine/runner_ops.rs:455`. Grok's “each table is written” check also proves too little: a program can touch one unrelated row and satisfy it. Choose authored maintenance now; defer a generic erasure contract until subject selection, durable identity fencing, system-held data, external effects, and residual data have explicit semantics.

I disagree with grok's conclusion that D6 gets device propagation right. Hidden point candidates ship no fresh row (`snapback2/crates/snapback2-core/src/engine/runner.rs:966`), while delivered-history restores retained content (`snapback2/packages/snapback2/src/store/range-store.ts:1088`). Resume revisits the log tail and mounted queries (`snapback2/crates/snapback2/src/writer_resume.rs:93`, `snapback2/crates/snapback2/src/writer_resume.rs:120`). Neither a scrubbed shell nor deletion automatically reaches every historical answer. Delete that promise; an authored job does not inherit it.

**Ledger: adopt grok's documented-residue choice.** Muse's permanent append-only premise is corrected by the verified trim (`snapback2/crates/snapback2-core/src/engine/mod.rs:1381`). Its attribution concern survives. I would now omit erasure-specific redaction entirely, retaining normal trimming and documenting residue. Sequence also derives from `MAX(seq)` (`snapback2/crates/snapback2-core/src/store.rs:509`); selective deletion needs more design than this RFC warrants. Job summaries must remain useful after individual chunk records age out.

**Cursor: a watermark is not a snapshot.** Grok's high-water-key option can bound the key interval; a commit sequence alone cannot reconstruct stage-start rows from today's `rows(table_name,row_id,data)` storage (`snapback2/crates/snapback2-core/src/store.rs:148`). Updates replace and reindex current data (`snapback2/crates/snapback2-core/src/engine/runner_ops.rs:126`). Choose a `byId` sweep over a captured upper key, reading current values, with explicit concurrent-insert behavior and no sealed-input claim. Refuse self-populating scans. Persist the executable and bind resumption to its semantics; matching table/index types is insufficient because program identity is distinct from schema identity (`snapback2/crates/snapback2-core/src/registry.rs:99`).

**Recurrence: grok changes my mind; retain scheduled job targets too.** I previously deferred `every` in favor of an application row that rearms itself. M8 explicitly requires server-driven, restart-idempotent per-user digests (`benchmarks/briefs/social-messenger.md:752`). Grok's argument makes the authoring cost decisive: forcing each app to own timer bootstrap and rearming spends more surface than one duration declaration. Keep `every <duration>`; remove calendar/time-of-day sugar.

I also reject mutation-only schedule targets: the per-user digest is a concrete customer for a scheduled sweep. Firing a job means atomically enqueueing its durable occurrence, not completing it. This needs internal enqueueing, not a mutation-level `enqueue` statement or a chat rewrite. Specify period identity, coalescing, and rearming; external effect retries remain separate.

**Fairness: neither drain-until-empty nor a pacing knob fixes progress.** The writer handles one request at a time (`snapback2/crates/snapback2/src/writer.rs:463`), and a committed turn includes synchronous live reruns (`snapback2/crates/snapback2/src/writer.rs:1114`). Reserve background turns after a bounded number of client turns, rotate runnable jobs, and check clients between timer targets. Muse's extra operator cap does not fix starvation. Start with 100-row examples and measure complete turns plus client p95/p99; I could not verify grok's predicted budget failure.

**Hosted repairs: keep them in the hosted lane.** Grok's “remote code execution” label does not establish a reason to require deployment for every repair. The ad hoc entry certifies its program (`snapback2/crates/snapback2-core/src/registry.rs:762`), and LLP 1015 already rules hosted operator mutation execution under admin authority (`llp/1015-control-plane.rfc.md:307`). Close the actual admission gap: declared programs additionally validate effect targets (`snapback2/crates/snapback2-core/src/registry.rs:405`). Require equivalent admission, bounded source, durable executable custody, TLS, and attribution; keep ad hoc execution off MCP. Implement a purpose-specific system entry, since `Actor::new` rejects system (`snapback2/crates/snapback2-core/src/identity.rs:69`).

**J0: both reviews understate it.** Narrowing changes destructive-plan classification and required-column admission (`snapback2/crates/snapback2-core/src/successor.rs:164`, `snapback2/crates/snapback2-core/src/successor.rs:214`); project check currently compiles without that store preflight (`snapback2/crates/snapback2/src/check.rs:393`). It is not check-only. M7's existing maintain rebuild (`snapback2/crates/snapback2-core/src/successor.rs:648`) removes the offered urgency. Keep sequencing after the loop bar.

**Required changes, ranked**

1. **D6; §§3–7, 10–11:** remove derived erasure and its completion claims; authored jobs may perform declared maintenance without claiming universal erasure.
2. **D1/D3/D7; §5:** certify and atomically commit body writes, cursor/progress, timer settlement/rearming, and scheduled-job insertion, including their budget costs.
3. **D2/D4/D7; §§6–7:** use conservative system-authority evaluation covering reads and writes; remove automatic `or system` grants and universal pre-execution success claims.
4. **D1/D3; §§4–5:** specify the stable-key sweep, concurrent inserts, executable custody, semantic succession fencing, stage boundaries, and terminal cancel versus resumable park.
5. **D3/D7; §§5, 8:** define bounded interleaving and fair job progress, then measure complete writer turns, client tail latency, and progress under continuous traffic.
6. **D7; §§4–5:** define occurrence identity and period arguments, installation/backfill, rearming, downtime coalescing, succession, rejected-target recovery, and atomic enqueue for job targets.
7. **D5; §§3, 6, 10:** implement narrowing in planning and installation, count absent fields as null, separate static check from store preflight, and recheck within installation.
8. **D9; §§6, 8:** specify isolated rehearsal with pinned time, suppressed outbound effects/autonomous copied work, isolated allocation, and no shared-blob mutation.
9. **Summary/§0/D8; §10:** correct benchmark claims, retain bounded chat send, cut public enqueue, and commission genuine fill and client-independent expiry witnesses.
10. **D4/D9–D11; §5:** match declared admission, preserve useful summaries beyond ledger retention, implement the system entry and coherent routes, and respect deploy's inherited read capability.

**Deletions**

Delete `erase <- …`, `erase by`, global `erased`, the derived closure test, erasure-driven ledger edits, zero-grace-by-backdating, and automatic device-erasure claims. Delete public `enqueue`, the large-group send rewrite, cross-stage return bindings until needed, calendar sugar, pre-bar erasure checks, and the standalone job SSE endpoint; status polling can serve `--wait`. Retain cancellation, resume, plan, and isolated dry-run. Remove console implementation detail beyond the existing deferral.

**The nine author decisions**

1. **§9.1:** ship minimal `every <duration>` with row timers; no calendar syntax or external-scheduler fallback for M8 — joins grok, differs from Muse and my round 1.
2. **§9.2:** no sixteenth verb; extend `run` and `trace`, retain personas — panel agreement.
3. **§9.3:** one executing chunk, fair interleaving, no pacing flag — Muse favors another knob; grok favors serial operator jobs.
4. **§9.4:** no default deletion; defer generic erasure, require explicit authored coverage when commissioned — Muse would retain coverage words.
5. **§9.5:** preserve normal trimming and document residue; no erasure-driven ledger edits — joins grok; Muse proposes redaction.
6. **§9.6:** hosted ad hoc yes, in the hosted lane with full admission, admin/TLS, durable source, and no MCP — grok splits.
7. **§9.7:** after the loop bar; no J0 exception justified here — both other panelists split.
8. **§9.8:** delete the fork CLI adapter, retain its dev route and snapshot primitive, amend 1015; defer persona API deletion — grok favors that additional deletion.
9. **§9.9:** add/fill/drop; no rename operation until measured authoring cost warrants it — panel agreement.

Charlie, I would commission the reduced kernel once these contracts are written. Its first demonstrations should be a crash-resumable fill during active chat traffic and expiry with clients closed. Those establish the useful administrative plane; erasure deserves its own explicit completion contract.

The sandbox refused the write to `/Users/ccheever/projects/snapback-1016-panel/out/astra-r2.md`; the complete response is printed above.