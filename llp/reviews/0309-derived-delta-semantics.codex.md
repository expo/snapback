# LLP 0309 review artifact — codex family

Target: `llp/0309-derived-delta-semantics.rfc.md`

## Round 1 — 2026-08-25

- Reviewer: codex `gpt-5.6-sol` @ ultra (verified in run log),
  `codex exec --skip-git-repo-check -s read-only`, cwd = full
  repo-tree capsule at commit `4b713da15` (structural blindness: no
  0309 review artifacts existed anywhere at capsule build).
- Revision under review: r1, target sha256/16 `0c7087648ec0d346`.
  Instructions sha256/16 `a48e7c8dc28912a8`.
- Run: launched 2026-08-25T09:38:38Z, exit 0. Body below is the
  complete final message, verbatim.

### Review body (verbatim)

## Summary

The RFC identifies a promising direction, and its preservation of fail-closed admission, fallback, wire compatibility, and the replica-continuity boundary is broadly consistent with LLP 0209. It is not ready, however: the proposed derivation rests on an inaccurate account of current maintenance state, misclassifies several closed-surface operators, does not define an executable derivation mechanism, and overstates the local evaluator’s established role.

## MATERIAL concerns

1. **“Maintenance state = captures” is false for the landed G3 implementation.**

   The RFC says the delta function consumes only `(captures, change batch)` and that nothing new must be captured (`llp/0309-derived-delta-semantics.rfc.md:73-84`, `88-98`). `CapturedReadDependency` does contain row IDs, predicate/order metadata, limits, result counts, completeness-related boundary data, and versions (`crates/snapback-types/src/storage.rs:304-340`). But G3 separately retains substantially more state: complete `RowInstance` values, per-node rows, child indexes, exists results, continuation state, proofs, and query outputs (`crates/snapback-engine/src/graph_evaluator.rs:442-470`). That state is copied into `retained_state` after evaluation (`graph_evaluator.rs:3067-3083`) and is required by `evaluate_graph_delta_on` (`graph_evaluator.rs:3593-3619`).

   The actual delta lanes also perform storage reads and compare full old and new rows (`graph_evaluator.rs:3641-3870`); captured reads are copied forward rather than reconstructed as the complete maintenance state. Updates carry a post-image, not generally the `-old + new` pair assumed by a Z-set delta (`crates/snapback-kernel/src/storage.rs:723-737`, `5553-5586`). An update to an interior ordered row, for example, cannot be maintained from a boundary key and post-image alone without the prior sort value or an authoritative lookup.

   A fix must define the real state contract: retained relation/index data, output/proof/ledger state, capture metadata, and whether changes provide pre-images, post-images, or authorized point reads. It must also distinguish server-internal retained state from state that may cross the client custody boundary.

2. **The operator table is neither complete nor correctly classified for the closed graph surface.**

   Several rows collapse materially different semantics:

   - `TableVisibilityV1` includes membership and `AnyOf` membership arms (`crates/snapback-types/src/manifest/types.rs:1241-1317`). Membership-table writes can change another table’s visibility without changing that source row, so visibility as a whole is not a stateless linear filter. DK-3 explicitly replaces for membership visibility (`crates/snapback-kernel/src/live_matcher.rs:3484-3500`), consistent with LLP 0008’s hardened membership boundary (`llp/0008-live-query-protocol.spec.md:346-355`).
   - The principal-bound relation node includes a parent join, target lookup, visibility, principal field, optional binding relation, and filters (`llp/0209-live-graph-profile.spec.md:718-730`). If “principal-bound scope” denotes this node, it is a keyed multi-input join rather than a stateless linear partition. If it denotes only a surrounding partition operation, the actual relation node is missing from the table.
   - Equality-to-one and principal-bound relations are joins. In the relevant formalism, joins are bilinear and their derivatives depend on retained state from both inputs, not merely a parent-to-row-key map.
   - Bounded to-many nodes always combine ordering and paging (`llp/0209-live-graph-profile.spec.md:681-694`). LLP 0209’s capture contract includes per-parent predicate/order/window/limit/result-count/boundary/completeness information and row IDs, not merely counts (`llp/0209-live-graph-profile.spec.md:2519-2533`, `2587-2589`).
   - “Closed projection” includes nested object, array, and exists structure (`llp/0209-live-graph-profile.spec.md:630-653`, `746-752`). It is not automatically the ordinary stateless relational projection unless the algebra defines grouping, hierarchy, ordering, and exact serialization separately.

   This also makes the statement that there are “three non-linear rows” (`llp/0309-derived-delta-semantics.rfc.md:110-118`) inconsistent with the table itself. The external formalism is directionally appropriate, but the [DBSP paper](https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf) derives behavior over explicitly typed stream operators and treats joins as bilinear; it does not justify these collapsed classifications.

   A fix must give a typed decomposition matching every `GraphNodeV1` variant and visibility arm, including all input relations, three-valued/unknown behavior, union/support semantics, hierarchy, ordering, serialization, and exact state requirements.

3. **The RFC never identifies the artifact from which rules are actually derived, so its core guarantee and Stage B are not performable as stated.**

   Stage A produces only documentation and vectors (`llp/0309-derived-delta-semantics.rfc.md:186-191`). Stage B nevertheless promises a mechanical check (`192-195`), while OQ-4 allows it to be a one-time manual audit (`238-241`). D3 then claims two implementations agree “by construction” (`142-154`). Two implementations written independently from prose and example vectors do not have that property.

   The repository’s existing precedent for preventing semantic drift is a shared executable evaluator, not merely shared documentation (`llp/0051-filter-ir-and-classification.spec.md:1016-1035`). Furthermore, G3 delta production lives in `graph_evaluator.rs`; `live_matcher.rs` identifies affected nodes but does not implement the graph delta (`crates/snapback-engine/src/local/engine.rs:33917-33982`). A meaningful G3 re-derivation must compare eligibility, storage reads, output operations, proofs, ledgers, retained-state transitions, stale-capture handling, and fallback decisions—not only emitted bytes for successful examples.

   A fix must select a canonical executable mechanism—such as a typed operator IR with a syntax-directed transform, generated implementations, or one shared reference evaluator—and define the Stage B equivalence oracle. Otherwise the RFC must weaken “generic derivation” and “by construction” to a normative specification plus separately tested implementations.

4. **The asserted second consumer is not established by LLP 0190 or LLP 0209, and “the same captures” conflicts with local custody constraints.**

   The RFC says every delta rule necessarily exists once on the server and once in the future local evaluator (`llp/0309-derived-delta-semantics.rfc.md:59-71`, `142-154`). LLP 0190 D3 instead assigns local evaluation admission, conformance, and retained-fact custody (`llp/0190-local-first-client-plan.plan.md:228-281`). It requires the client to consume only facts/fragments authorized for the exact plan, projection, window, authority, and proof, and forbids protected hidden rows from influencing output (`541-559`). Its dual-runtime conformance stage concerns evaluation of the owner IR (`788-798`), not necessarily client-side derivation of server change deltas.

   LLP 0209 likewise separates “one IR, two evaluators” for evaluation from the future continuity protocol by which server-produced deltas maintain a local replica (`llp/0209-live-graph-profile.spec.md:2788-2809`). The current full retained state is deliberately internal (`GraphEvaluationOutput.retained_state` is `serde(skip)`), while inspection omits arguments, row IDs, principal IDs, and interval endpoints (`llp/0209-live-graph-profile.spec.md:2560-2565`).

   A fix must decide what the client maintains—authorized base facts, intermediate operator state, or only server-produced result patches—who computes each derivative, how state is transported and versioned, and how D3’s projection and authority restrictions are preserved. Alternatively, the RFC should present local derivation as a possible future consumer rather than an already-required duplicate implementation.

5. **The claimed unchanged mismatch response contradicts current G3 behavior and misapplies LLP 0270.**

   D4 says divergence disables the lane through rotation or a kill switch and never silently falls back, while calling the comparator posture unchanged (`llp/0309-derived-delta-semantics.rfc.md:177-184`). Current G3 comparison records a convergence failure and returns no delta; the caller then emits an ordinary replace (`crates/snapback-engine/src/local/engine.rs:34012-34045`, `33488-33552`). LLP 0209 v0.11 describes exactly that force-replace-and-count behavior (`llp/0209-live-graph-profile.spec.md:3364-3368`). LLP 0270’s disable/refuse posture applies to locally executable advertised profiles, not automatically to this server-internal optimization.

   A fix must separately decide and specify the server G3 mismatch response and the local-profile conformance response. If automatic server-lane disabling is intended, it is a policy change and needs defined scope, latching, recovery, and capability-advertisement behavior.

## Non-material observations

1. The RFC accurately preserves per-kind admission, membership and opaque-handler fallback, authority-transition fencing, and additive `live_delta`/`live_replace` negotiation.

2. Its exclusion of replica continuity is consistent with LLP 0209 OQ-6 and the distinction between delta production and durable client replica custody.

3. OQ-2 is appropriately open: the current membership capture’s matched count is not yet a demonstrated per-row support-multiplicity representation.

4. “Server matcher” should be replaced with “server graph delta evaluator” where G3 is meant; the matcher presently supplies affected node IDs rather than computing the graph patch.

## Verdict

NOT READY
## Round 2 — 2026-08-25 (delta round on r2)

- Reviewer: codex `gpt-5.6-sol` @ ultra (verified in run log),
  read-only in capsule c0309-r2 (r1-capsule lineage + r2 overlay; zero
  0309 review artifacts, verified); received the r1→r2 diff and its
  own round-1 review only.
- Revision under review: r2, target sha256/16 `f3e1d4c8067d6fd6`
  (worktree commit `a3b25007c`). Instructions sha256/16
  `503d24aad9800869`.
- Run: launched 2026-08-25T09:54:14Z, exit 0. Body below is the
  complete final message, verbatim.

### Review body (verbatim)

## Round-1 disposition check

1. **PARTIALLY DISPOSED.** R2 correctly rejects “state = captures” and accounts for retained rows, authorized reads, image direction, and custody, but D1.3 still omits outer serving state such as window-ledger and capture-freshness transitions.
2. **PARTIALLY DISPOSED.** The classifications are substantially corrected, but D1.1 still mis-types composite multi-relation nodes as two-input operators, while its one-row closure rule cannot express their decomposition.
3. **PARTIALLY DISPOSED.** R2 adds an executable reference evaluator and Stage-B decision rule, but its equivalence oracle still omits shipped read/effect, proof, ledger, and capture-continuity obligations.
4. **DISPOSED.** Local derivation is now conditional, and D3.2 preserves LLP 0190’s exact-plan, projection, authority, proof, and hidden-row custody restrictions.
5. **DISPOSED.** D4.3 now matches the landed G3 response: record the mismatch, suppress the delta, and force a fresh replace for that event; LLP 0270 remains scoped to advertised local profiles.

## MATERIAL concerns

1. **[IN-DELTA] The typed decomposition still does not cover the closed surface.** D1.1 says principal-bound relations and semi-joins take two inputs (`llp/0309-derived-delta-semantics.rfc.md:126-129`), but `PrincipalBound` may consume parent, optional binding, and target relations, while a through-edge semi-join consumes parent, through, and target relations (`graph.rs:254-280,964-997`; `graph_evaluator.rs:1774-1885,2141-2238`). Moreover, the closure check says each `GraphNodeV1` variant maps to exactly one table row, although rows mix primitive operators with composite node kinds. Stage A must require an explicit syntax-directed decomposition into elementary binary operators—or typed n-ary forms with every input-change term—and check every semantic component, not one row per variant.

2. **[IN-DELTA] The reference semantics and Stage-B oracle still omit parts of the shipped maintenance contract.** D4.2 compares eligibility, fallback, retained-state transitions, and emitted ops (`llp/0309-derived-delta-semantics.rfc.md:251-263`), but G3 separately maintains bounded/authorized read effects, proof updates and composition, window ledgers, and stale-capture replacement state (`graph_evaluator.rs:228-235,3785-3870`; `local/engine.rs:34068-34110,34159-34168`). Two implementations could agree on the listed axes while widening reads or breaking proof, ledger, or capture continuity. These axes must be included in the derivation/equivalence contract or explicitly excluded and protected by a separate mandatory acceptance gate.

## Non-material observations

1. **[IN-DELTA]** “Stateful rows number five” miscounts six explicit rows: membership visibility, two joins, bounded to-many, root window, and exists semi-join.

2. **[IN-DELTA]** “Change events as delivered carry post-images” is overbroad. Inserts and updates carry post-images, while deletes may carry the deleted pre-image or no row, depending on the carrier (`storage.rs:5628-5654,16229-16264`).

3. **[IN-DELTA]** D3.2 mandates Stage-A forms for future “local maintenance” while leaving patch-only maintenance open; patch application is not operator-level derivation. Scope the mandate to client-side derivation and make `FALLBACK` handling consumer-specific: server-side replace versus local `unknown`/hydrate/refusal.

## Verdict

NOT READY
## Round 3 — 2026-08-25 (delta round on r2→r3)

- Reviewer: codex `gpt-5.6-sol` @ ultra (verified in run log),
  read-only in capsule c0309-r3 (c0309-r2 lineage + r3 overlay; zero
  0309 review artifacts, verified); received the r2→r3 diff and its
  own round-2 review only.
- Revision under review: r3, target sha256/16 `9afb39a63b380c41`
  (worktree commit `18eb7f709`). Instructions sha256/16
  `8b1d391112f0cc1a`.
- Run: launched 2026-08-25T10:05:46Z, exit 0. Body below is the
  complete final message, verbatim.

### Review body (verbatim)

## Round-2 disposition check

1. **DISPOSED.** D1.1 now requires syntax-directed decomposition or directly typed n-ary forms covering every input, while the closure check covers every semantic component (`llp/0309-derived-delta-semantics.rfc.md:126-135,167-171`), matching the three-relation shapes in `graph.rs:254-280,938-990`.
2. **DISPOSED.** D1.3 and D4 now include outer serving state, expected next state, authorized read effects, proofs, window ledgers, and capture continuity—either within equivalence or behind a mandatory gate (`llp/0309-derived-delta-semantics.rfc.md:175-190,265-295`), matching `graph_evaluator.rs:3600-3877` and `local/engine.rs:33917-34168`.

## MATERIAL concerns

None.

## Non-material observations

1. **[IN-DELTA]** The closure paragraph calls table rows elementary, but `PrincipalBound` and through-table `ExistsSemiJoin` remain composite hypothesis rows (`llp/0309-derived-delta-semantics.rfc.md:157-171`). Clarify that “elementary” describes Stage A’s corrected inventory.
2. **[IN-DELTA]** The cross-change wording is imprecise: a binary both-change arm uses both deltas, not retained opposite-side state, while direct n-ary forms also need interaction terms or an equivalent whole-product formula (`:126-138`). The defining equivalence property already enforces this.
3. **[IN-DELTA]** D4.1 appears to require expected next state for `FALLBACK` vectors, although the declared form returns `state_O'` only on maintain outcomes (`:113-115,265-270`). Limit that requirement or type fallback-state transitions explicitly.
4. **[IN-DELTA]** D1/D2 still map `FALLBACK` categorically to `live_replace`, while D3.2 makes handling consumer-specific (`:136-140,203-206,251-256`). Scope the earlier mapping to the server consumer.
5. **[IN-DELTA]** D1.3’s internal retained-state path is ambiguous against the boundary requiring retained-state changes through LLP 0209’s amendment path (`:186-190,334-335`). Clarify that “no capture amendment” does not waive any required retained-state amendment.
6. **[IN-DELTA]** The revised image claim remains broader than the shared carrier: synthetic production updates can carry `row: None` (`local/engine.rs:14861-14866,20515-20520`). Scope it to the admitted application-row carriers.
7. **[PRE-EXISTING]** The Motivation still categorically says change events deliver post-images (`llp/0309-derived-delta-semantics.rfc.md:86`), contradicting the later carrier-dependent correction.

## Verdict

READY