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