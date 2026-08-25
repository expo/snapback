# LLP 0309 review artifact — grok family

Target: `llp/0309-derived-delta-semantics.rfc.md`

## Round 1 — 2026-08-25

- Reviewer: `grok-4.6` @ xhigh reasoning effort, headless CLI, run
  from an empty directory with a full terminal/tool ban in the prompt;
  no repository access — the target document was inlined verbatim.
- Revision under review: r1, target sha256/16 `0c7087648ec0d346`
  (commit `4b713da15`). Prompt sha256/16 `04704341a8448e83`.
- Blindness: fresh review; no 0309 review artifact existed at launch
  (structural).
- Run: launched 2026-08-25T09:38:41Z, exit 0, empty stderr; body
  below is the complete stdout, verbatim.

### Review body (verbatim)

## Summary

The RFC’s direction is the right one: one operator-level incremental semantics, two consumers, unchanged fail-closed admission, and a docs/vectors → re-derivation → new rules → local consumer sequence that correctly puts an audit before authorship. The document is not ready as a decision record. Its headline mechanism — `∂O` plus composition — is stated as settled design while remaining undefined at the points that decide correctness (the type of a delta, binary operators, order, retracts). The same section over-settles which operators are linear, which state already exists in captures, and what Stage B does when derived forms disagree with shipped lanes. An implementing or consuming program that took D1–D5 at face value would invent those decisions independently, which is the failure mode the RFC is trying to retire.

## MATERIAL concerns

1. **D1–D2 treat composition of `∂O` as the method, but do not define a composable `∂O`.**  
   The one-sentence claim is that a plan’s delta rule “follows by composition instead of by separate authorship,” and D2 repeats that the rule “is the composition of its operators’ delta forms in plan order.” The operator table, however, assigns heterogeneous *characters* (Z-set row deltas, per-parent keyed patches, parent-indexed add/remove/update, 0↔1 visibility flips, boundary classification plus fallback), not a single function type. Equality to-one, bounded to-many, and exists semi-join are binary; “plan order” is a linear-pipeline slogan and does not specify the bilinear form (how a change on one input uses the maintained other side, and whether both-inputs-change is required). Ordered windows are not a Z-set monoid: `+` in `O(S + ΔS) = O(S) + ∂O(S, ΔS)` cannot be the same operation as splicing a ranked list, and `live_delta` is declared unchanged and “additive” while the model’s unit of change is “a remove plus an add.” Fallback makes `∂O` a partial function, which the defining equation does not say.  
   **Fix must establish:** the carrier type of every `∂O` (input delta, maintenance state, output delta, verdict); the incremental form for binary operators; that order is recovered from sort keys (or that ordered operators use a different output monoid); how Z-set negatives are encoded on the existing additive wire; that the equation holds only on a maintain verdict; and that a change *batch* is atomic (a boundary swap as paired remove+add, not one-row-at-a-time). Until that is specified or explicitly demoted to Stage A *acceptance criteria*, “composition” is not a decision an implementer can execute.

2. **“Maintenance state = the captures” is overclaimed inside the document.**  
   Motivation lists `CapturedReadDependency` as carrying serialized predicate, exact row-id lists, pinned versions, order, limit, `result_count`, and a window `boundary`, then says nothing new is captured. The D1 table marks parent→row keys, per-parent counts, and “boundary sort keys + completeness bit + result count” as already `(captured)`, while only semi-join support counts are named as a possible gap (OQ-2). `result_count` is not per-parent counts; a completeness bit is not in the listed vocabulary; support counts are not either. “What this RFC does not change: the capture vocabulary, except through 0209’s ordinary amendment path” therefore reads as if Stage C can proceed without capture amendments for to-many and windows.  
   **Fix must establish:** a per-operator gap table against the listed capture vocabulary (have / missing / wrong grain), and that any missing item is an amendment *or* a fallback pin, before claiming that derivation has a second consumer for existing captures.

3. **The linear / non-linear classification is unsound as written and drops a stateful operator.**  
   D1 says linear operators need no state and “the three non-linear rows are the hard 20%.” Equality to-one is given maintenance state (`parent→row keys`) but is neither called linear nor counted among the non-linear operators. That is four stateful operators (to-one, to-many, semi-join, window), not three. An implementer following the prose can treat to-one as a one-liner with no state, which is a correctness error, or omit it from Stage A’s hard inventory. Closed projection is declared linear with no evidence in-document that projection does not duplicate-eliminate; that is a load-bearing classification, not a restatement of a given form.  
   **Fix must establish:** a two-way partition (state-free linear vs stateful) that includes to-one on the stateful side, and a one-line criterion for projection (row-identity preserved ⇒ linear; otherwise not).

4. **Stage B is described as the strongest gate and is not a gate.**  
   D4.2 / D5 require re-deriving shipped DK-3 and G3 rung 1 behavior and say any divergence “must be explained and ruled on” before Stage C. They do not say what wins: the algebra (shipped lanes are bugs; Stage B implies runtime change), shipped behavior (the algebra is descriptive and may absorb accidents), or a bounded class of equivalences. Combined with “Stage A/B are cheap and independently valuable” and OQ-4 (maybe a one-time manual audit), the audit can rubber-stamp exceptions and Stage C will instantiate a pile of special cases — the per-kind hand-design this RFC exists to stop.  
   **Fix must establish:** an explicit Stage B decision rule and who rules; that unexplained divergence blocks Stage C; and whether Stage B is allowed to change shipped lanes or only to document the algebra.

## Non-material observations

1. The 0051 analogy overstates the mechanism: 0051’s ruling is one *evaluator*; this RFC is one *spec* plus a shared vector corpus. Two instantiations can still drift; D3’s “by construction” should be “by shared forms + the same corpus,” which D3 already also says.

2. `Systems` lists Code generation, but the RFC never decides whether Stage C/D is hand-instantiation against the table, interpreted forms, or generated code. That is a later choice; it should not be inferred from the header.

3. Replica continuity is the right non-consumer, but Stage D still needs one sentence on local *inputs* (local change batches and captures versus applying server-sent frames). Without it, 0190 D3 authors will reasonably confuse this algebra with the rung-5 apply protocol.

4. Operator-inventory completeness is not evidenced in-document (no “these are all closed-profile node kinds,” and no aggregate/union). Stage A needs a closure check against the profile; that is inventory work, not a reason to reject the method.

5. Keep ineligibility → `live_replace` and comparator divergence → 0270 disable named as different operations in Stage A. Unifying them would either hide wrong deltas behind replace or take a lane down for a declared unmaintainable change.

6. Deferring the actual `∂O` text to Stage A is appropriate for a methodology RFC *if* D1 is rewritten as classification hypotheses plus Stage A acceptance criteria. As written, D1 reads as if the forms already exist.

7. OQ-1, OQ-2, and OQ-3 are the right questions; OQ-3’s “specify provable-replacement once” should be the default. Add Stage A questions for carrier type and the Stage B oracle; OQ-4 is process, not semantics.

8. Claims about LLP 0209 §7, G3 rung 1, captures, and 0190 D3 are used as load-bearing context. The safety posture is restated enough to consume as intent. The landed-lane corpus and capture field list are not independently evidenced here; Stage B/A must not treat those citations as verified inventories.

## Verdict
NOT READY
