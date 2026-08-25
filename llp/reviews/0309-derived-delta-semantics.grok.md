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

## Round 2 — 2026-08-25 (delta round on r2)

- Reviewer: `grok-4.6` @ xhigh, headless, terminal ban, no repository
  access; received r2 in full, the r1→r2 unified diff, and its own
  round-1 review only (cross-family blindness preserved).
- Revision under review: r2, target sha256/16 `f3e1d4c8067d6fd6`
  (worktree commit `a3b25007c`). Prompt sha256/16 `4507d08e5321aae1`.
- Run: launched 2026-08-25T09:54:16Z, exit 0, empty stderr; body
  below is the complete stdout, verbatim (including the leading
  narration sentence about loading the offloaded prompt).

### Review body (verbatim)

The prompt was truncated; I’ll load the offloaded full request so the review uses the complete r2 document and diff, not a partial excerpt.## Round-1 disposition check

1. **DISPOSED.** D1 is recast as methodology plus Stage A acceptance criteria; D1.1 gives a typed partial `∂O`, bilinear joins (either-side plus both-change), ranked-sequence vs Z-set composition, batch atomicity, maintain-only equation, and a Stage A wire mapping.
2. **DISPOSED.** Motivation drops “maintenance state = the captures”; D1.3 requires a have/missing/wrong-grain ledger against captures *and* G3 retained state, with amendment or `FALLBACK`-pin — not a claim that Stage C can proceed on the listed capture fields.
3. **DISPOSED.** The table is an explicit hypothesis set; to-one and principal-bound are stateful bilinear joins; projection is split on row-identity preservation; stateful inventory is restated; Stage A owes a `GraphNodeV1` / `TableVisibilityV1` closure check.
4. **DISPOSED.** D4.2 names the 0209 owners, the (a)/(b)/(c) rule, shipped-as-deployed-contract, unclassified divergence blocking Stage C, and “Stage B changes no runtime code.”

## MATERIAL concerns

None.

## Non-material observations

1. **IN-DELTA.** D1.1’s signature is unary in `Δin` while the bilinear bullet requires two inputs plus a both-change term. Stage A should treat join `Δin` as a product (or two unary arms plus a both-change arm) in the type, not only in prose.
2. **IN-DELTA.** “Stateful rows number **five**” collapses membership-visibility with semi-join; the table has six stateful rows, plus nested assembly as a third bucket. Harmless if the closure check is the inventory, misleading if someone treats the “five” as the hard list.
3. **IN-DELTA.** D2 adds “`FALLBACK`-returning” beside standing ineligibility (not-yet-admitted, state-gapped). Every form is partial, so that phrase can be read as pinning every plan. D1.1 already maps a *verdict* to `live_replace`; D2 should say that, not an operator class.
4. **IN-DELTA.** D1.1 returns `state_O'`; D4.2 audits retained-state transitions; D4.1 vectors are only `(state, change batch, expected delta or FALLBACK)`. Include expected next state in the vector schema.
5. **IN-DELTA.** Missing/wrong-grain resolves only by “0209-path amendment or `FALLBACK`-pin,” while D1.3 also names server-internal retained indexes as a source. Adding an evaluator-internal structure is not a capture amendment; don’t fail-close it into the profile path.
6. **IN-DELTA.** Class (c) notes a shipped lane as a sound approximation of the reference, and Stage C instantiates Stage A. One sentence that (c) records are shipped-lane-only and do not become per-kind exceptions in new rungs would stop the residual special-case path.
7. **PRE-EXISTING.** Motivation’s capture-field list and G3 retained-state inventory are still unevidenced citations. D1.3 is the right posture only if Stage A treats those lists as leads, not as the ledger.

## Verdict
READY

## Round 3 — 2026-08-25 (delta round on r2→r3)

- Reviewer: `grok-4.6` @ xhigh, headless, terminal ban, no repository
  access; received r3 in full, the r2→r3 unified diff, and its own
  round-2 review only (cross-family blindness preserved).
- Revision under review: r3, target sha256/16 `9afb39a63b380c41`
  (worktree commit `18eb7f709`). Prompt sha256/16 `65a8dccbd05e229e`.
- Run: launched 2026-08-25T10:05:49Z, exit 0, empty stderr; body
  below is the complete stdout, verbatim (including the leading
  narration sentence).

### Review body (verbatim)

The review prompt was truncated, so I’ll load the offloaded full request first and write the delta review from that complete r2 review, r2→r3 diff, and r3 document.## Round-2 disposition check

1. **DISPOSED.** Binary forms type `Δin` as a product (or two unary arms plus a both-change arm); n-ary forms owe a change term for every input.
2. **DISPOSED.** Stateful count is six, nested assembly is a separate derived bucket, and the closure check is decomposition coverage rather than one row per variant.
3. **DISPOSED.** D2 pins on a `FALLBACK` *verdict* from an admitted form on the change at hand, not on an operator class.
4. **DISPOSED.** D4.1 vectors include expected next state because forms return `state_O'`.
5. **DISPOSED.** D1.3 adds evaluator-internal retained-state addition as a third resolution path, distinct from capture amendment.
6. **DISPOSED.** Class (c) records are shipped-lane-only and must not become per-kind exceptions in new rungs.

## MATERIAL concerns

None.

## Non-material observations

1. **IN-DELTA.** D1.1 allows Stage A to type an n-ary form directly (one form, a change term per input). The D1.2 closure check then says table rows are elementary operators and composite node kinds map to compositions, never “one row per variant.” An n-ary principal-bound or through-edge form would satisfy D1.1 and fail that slogan. The load-bearing rule is already “every input has a change term”; the closure check should admit a single n-ary row that supplies those terms, not only a unary/binary decomposition.
2. **IN-DELTA.** D1.3 now resolves a missing or wrong-grain entry by capture amendment, by evaluator-internal retained-state addition (not profile surface), or by `FALLBACK`-pin. Boundaries still says capture vocabulary *and retained-state shapes* change only through 0209’s amendment path. Align Boundaries with the three-way D1.3 rule so internal retained-state growth is not listed as forbidden.
3. **IN-DELTA.** D4.1 requires expected next state on every vector, but the D1.1 type returns `state_O'` only on the maintain arm. `FALLBACK` has no next-state component (and replace may rebuild state rather than leave it). Restrict the next-state slot to maintain verdicts, or say explicitly what a `FALLBACK` vector pins.
4. **IN-DELTA.** Motivation still says change events deliver post-images; D1.1 now says deletes may carry a pre-image or no row. Leave the G3 precedent as a lead and let D1.1 be the carrier rule, or qualify the Motivation sentence so the two are not read as competing facts.
5. **IN-DELTA.** D4.2’s “stale-capture replacement/continuity” axis sits next to an explicit non-consumer (replica continuity, OQ-6). One clause that this axis is capture-freshness/replacement, not the replica protocol, would keep the new oracle from being read as pulling OQ-6 into Stage B.

## Verdict
READY
