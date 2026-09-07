# LLP 1018 focused-plan panel — Grok

**Reviewer family:** Grok
**Provider / runtime:** Grok CLI, `grok-4.6`, effort `xhigh`
**Date:** 2026-09-07
**Redacted:** No; selected repository context contained no credentials
**Method:** CLI runner; independent initial response, instruction-based blindness
**Targets:** LLP 1018 §12, LLP 1018.001 and LLP 1018.002 at `cc0616af4`
**Context difference:** Initial full packet exhausted three turns while loading CLI-offloaded context, without a review. Successful retry contained both full child RFCs, parent §12 and the same authorization/replay excerpts, excluding other panelists' responses. The CLI reported prompt offloading and read that local packet despite the requested no-tool mode. No structural blindness claim is made.
**Round 1 retry prompt SHA-256:** `e9d4b79da85478a9b281a18f6f94fc9286f8f451f18cae1394a834419bf0b176`
**Authority:** Charlie requested this panel and delegated plan revisions; feedback is advisory, not acceptance.

## Initial attempt — 2026-09-07 (incomplete, not a review)

The review context was truncated in the message, so I’ll read the full prompt file first and then write the panel review from that snapshot only.The prompt file is large; I’ll read the rest of the snapshot so the review covers the full two-child plan and investigations.


Runtime: `Max turns reached`; exit 1.

## Round 1 retry — 2026-09-07 (verbatim)

The full review request was truncated, so I’ll read the offloaded prompt and then write the panel review from that snapshot only.**Thesis.** The two-child plan is a second planning surface on an integration lane that already holds the compiler, sparse aggregates, observation API, and query work it wants to unify. 1018.001 is a good checklist aimed at the wrong artifact: a child RFC whose acceptance can stall or reshape a compiler this draft does not own. 1018.002 is the sharper mis-aim. The pending-client run shows two queued writes conflicting after an optional-column successor. LLP 1012’s commit path compares point digests over canonical wire rows **and** policy verdicts; LLP 1001 binds those verdicts to the **complete schema hash**. Either identity can produce that symptom. The RFC still leads with a finite policy graph, canonical labeled edges, exclusion proofs, and a new verdict domain. A wrong closure is a real authorization bug, not taste. It is not yet shown to be what fired, and a conservative closure that keeps whole row/schema descriptors may hash-equal today’s binding. The missing simplification is one evidence census that names what each carried byte proves, then the smallest change that removes that false conflict—or an explicit keep-the-schema-hash finding. Do not add a second compiler, a second policy interpreter, six new hashes, a lifecycle controller, or an extension framework.

**Concrete changes**

1. **Collapse 1018.001 into the architecture lane’s review record.** Map `bound-model.ts`, `bound.ts`, `bound-project.ts`, `bound-api.ts`, and `bound-source.ts` onto the six responsibilities; list remaining dual producers; add witnesses only for gaps (presence joins, page provenance, once-only evaluation). Evidence: the RFC already says a completed candidate can satisfy it without new code; snapshot `2cae5d9a2` already has typed direct lowering; LLP 1018 §5 already cut typed IR from the hygiene repair. A child RFC with its own acceptance matrix becomes a second spec. What would change my mind: a dual semantic owner still in the integrated candidate that the lane is not already deleting (public API types inferred from printed TypeScript after direct lowering).

2. **Make 1018.002’s first deliverable an autopsy of the two-write experiment, not a closure design.** For each conflicting intent, name which compare failed: wire-row digest, absence, verdict/schema-hash, replay identity, program meaning, or coverage. Evidence: 1012 compares digests and verdicts; 1001 puts the schema hash on verdicts; an optional column most mechanically changes canonical rows. §4 already admits a new policy identity may not fix the experiment. Park §3’s graph until that identity is named. What would change my mind: the diagnostic README already showing unchanged point digests and a mismatch on the schema-hash component of the verdict.

3. **If the autopsy says policy identity, replace the schema hash with the smallest conservative stand-in, not a dependency engine.** Enclosing normalized rule + transitively referenced rule identities + certifier/interpreter semantic version; whole-schema fallback whenever a descriptor participates or a dependency kind is unknown. No second interpreter, no parallel registry, no in-place upgrade of old opaque verdicts. Evidence: 1001’s cyclic-graph / short-circuit amendment exists so incomplete closures fail open; the RFC’s exclusion-proof bar will often retain whole descriptors anyway. What would change my mind: one excluded component (an unrelated table with no policy, read, or certifier edge) proven not to affect meaning, authority, disclosure, or certified behavior on the existing corpus.

4. **Run read-evidence first among the three investigations, in 1018.002’s vocabulary, without merging the work.** Trace one public count from native execution through receipt, store, twin, and prediction against the candidate’s sparse aggregates; require a distinction among complete `0`, proved absence, and unheld. Evidence: parent §12 already states complete `0` is not proof a maintained-count key is absent; a ticket exists; the architecture snapshot already has sparse aggregate work. Another representation is the duplication to refuse. What would change my mind: the candidate already carrying authorized absence vs unheld through cold reopen and cap overflow on both evaluators, recorded on that ticket.

5. **Defer query-lifecycle ownership and the public extension inventory until a freeze of the integration snapshot.** Both are deletion/ownership hygiene on APIs the compiler and observation work are still moving. Parent §12 already forbids a new controller and a new extension framework; inventories now produce tables that expire. What would change my mind: a demonstrated race in the shared-session / observation candidate (stale async completion, last-consumer disposal, follower takeover) or a public export with an in-repo app caller the lane intends to keep.

**Next 1–2 days, and what to defer**

Two paper mappings, no runtime change, no new LLP, no new hash:

- From `benchmarks/runs/2026-09-07-snapback2-evolution-diagnostic/`, write which identity invalidated each queued write, and whether newly issued intents commit because they mint new verdicts, new row shapes, or both.
- From the bound-* candidate, fill 1018.001’s census: old owner, candidate owner, deleted production path, remaining consumer, intentional semantic change.

Defer: policy-closure hashing and a new verdict domain; any compiler work outside the existing architecture lane; query transition tables; export inventories; helper syntax; live-query scheduling; making every successor replayable; a compatibility framework; holding the architecture lane on RFC acceptance.

If the autopsy names wire-row canonicalization, the next slice is a digest-stability rule (absent optional fields) reviewed as data-evidence OCC, not as 1018.002 implementation. If it names the schema hash on verdicts, write the three-line stand-in and the exclusion list—still Draft, still no runtime owner until authorization review.

**Counterargument**

Without 1018.001 as a standing contract, the integration lane can land “direct lowering” that still has two Quarry meanings (diagnostics/API from one tree, executable IR from another), which is the failure 1018 exists to prevent. Without writing closure constraints before anyone touches hashes, the cheapest response to the two-write experiment is deleting the schema hash, which 1001 says is an authorization bug. The RFCs are fences. That is fair. It does not require child LLPs, a graph digest, or three parallel investigations. Put the §3 tables in the parent as constraints on the existing lane and on any later invalidation patch; keep targets Draft; let the experiment and the bound-* census decide whether either child deserves to exist as more than a memo.


## Round 2 — 2026-09-07 (verbatim discussion)

All initial responses, author positions and evidence corrections were shared.
Prompt SHA-256: `17a00d8c72214ed74ddc1ff3fe9a53243999c9df26a6981d3d17fcb5160b7cfa`. This discusses provisional decisions, not the final edited document bytes.

The most important disagreement is whether 1018.001 and 1018.002 should remain Draft RFC children (author), collapse to checklists so they cannot grow a second compiler or a policy-graph engine (Muse and my round 1), or be “resolved” by landing the compiler and shelving invalidation this week (Gemini). That choice sets the plan’s shape. Gemini treats this panel as implementation authorization. Muse treats 1018.001 as a rival frontend that must freeze until the integration lane is accepted or abandoned. The author’s finite-closeout intent is right; leaving that intent inside two Draft children is what recreates the stall.

**Corrections.** Gemini: there is no shown +11kB gzip from forwarding; 79,207 B is a five-root total, not a causal ceiling blow. The 32-item disposition is already 27 CLOSED / 4 OUTSIDE-Q / 1 RETAIN / 0 PENDING — not five undisposed repair checks. `client.observe` does not prove drain, authorization, follower takeover, or recovery ownership. The unsend defect is not established as missing inbox navigation; later lane evidence is unsend count 2 then regression to capped seq 7 / count 3. Muse: gross bypassed-versus-added lines are not the live census; net compiler production is −7,663. Author-shaped 1018.001 is not a second compiler unless it grows new AST, checker, or emitter work. A full §12 transition table before any other repair is more apparatus than the two named witnesses need. Me (round 1): another pending-client autopsy is not needed. The report already attributes both conflicts to `Schema::rule_hash` complete-schema binding; byte-identical FIFO replay, stored-terminal retry after post-commit loss, and `E_OP_UNKNOWN` after rename already passed. Conservative conflict plus new-intent recovery is demonstrated safety, not a missing diagnosis. Deferring lifecycle until an integration freeze is weaker after 301e59bb6.

**One synthesis improvement.** Write the 1018.002 counterfactual as a preservation matrix of those already-passing behaviors, plus isolation of rule identity from row digests, current-op checks, and coverage resets. Name which successful new semantics would still satisfy every matrix row. That checks the known attribution without rediscovering it, and it blocks both naive hash deletion and a new verdict domain. Static policy closure and dynamic touched reads stay separate keys.

**Reverse decision 1, not 6.** Do not keep two Draft children. Fold 1018.001’s remainder into parent closeout on the existing lane: census deltas only; retain `0c1a538ae` as a packaged Expo `skipLibCheck` negative type check (printed `Result` and `IsAny` were insufficient); no second acceptance matrix. Demote 1018.002 from Draft child to an audit memo on the pending-client evidence. Decision 6 should stand: this panel should not cancel commissioned forwarding or incremental work; assess residual complexity on integrated code. Decision 2 should stand except ordering: qualify the 301e59bb6 settlement regression before implementing a new absence receipt. Check the sparse-aggregate candidate for public zero versus proved absence versus unheld; do not staff Gemini’s engine change until that residual is shown.

