# LLP 0135 sequence allocation and snapshot batch review — Codex family


## Round 1 — 2026-07-31

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (`medium` per CLI banner)
**Date:** 2026-07-31
**Method:** fresh CLI runner, read-only sandbox, blind to this Spec's fable artifact
**Target SHA-256:** `cac4af442dae8e94c4430cf9618fe2c64b155380699a3f18a1b1caccf8894ae5`
**Status:** completed

## Verbatim review

## Overall assessment

LLP 0135 is well-scoped and unusually strong for a first draft, but it is **not ready** under LLP 0130 SD-4. Several unresolved MATERIAL issues affect implementability, settlement semantics, information flow, and cursor correctness. Most importantly, the document currently pre-determines LLP 0130 SD-2’s aggregate branch despite repeatedly claiming it does not.

I did not read any `llp/reviews/0135-*.fable.md` file.

## Strengths

- The draft faithfully follows decision 3’s required order: sequence allocation first, snapshot batch second, with both capabilities entering as experimental ([LLP 0135 §Summary](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:15>)).
- The counter design addresses most of LLP 0120’s requested semantics map explicitly: incarnation, abort gaps, retries, exhaustion, contention, and authority.
- The single-writer/multi-writer distinction is honest. SQLite is given a claim, while future multi-writer targets must prove commit ordering or publish a GAP ([§1.3](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:89>)).
- Performance statements are correctly labeled empirical expectations rather than results ([§1.6](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:134>)).
- `AllocateSequence` plausibly lifts Relay’s `moveCard` without admitting the forbidden range collect: it is a fixed point-shaped host effect, not a new set-oriented application read ([§1.2](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:63>), [LLP 0110 §2.1](</Users/ccheever/projects/snapback/llp/0110-bounded-children-and-activity-patterns.spec.md:345>)).
- The 3a boundary is disciplined: static tuple, admitted nodes only, no output-dependent invocation, no reduction vocabulary.
- Sealing the whole composite is the correct evidence-clean partial-refusal posture. The acceptance matrix commendably includes results, status, transport, live initial state, inspection, and malformed cursors.
- Live classification, cross-page nonclaims, experimental acknowledgments, and structured target GAPs are all stated clearly.
- The nonclaims are candid and generally consistent with LLP 0080/0110.

## Concerns

1. **MATERIAL — LLP 0130 SD-2 is already decided by construction.**

   SD-2 says that if `boardView`, `boardSummary`, or Split remains inexpressible after 3a usage evidence, the contracted-aggregate profile is authored ([LLP 0130 SD-2](</Users/ccheever/projects/snapback/llp/0130-program-standing-decisions.decision.md:39>)). LLP 0135 normatively excludes all reductions, then requires the acceptance record to state that `boardSummary` and Split were not expressed ([§5.2](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:433>)). That necessarily selects SD-2’s second branch before empirical usage.

   Repeating that “SD-2 decides later” does not cure the logical pre-decision.

   **Resolution:** obtain an author clarification or amendment to SD-2 defining what evidence could still affect its branch. If SD-2 literally means expressibility by these two surfaces, the contracted-profile outcome is already forced and this Spec must say so honestly. This cannot be repaired by editorial wording alone.

2. **MATERIAL — synchronous handler allocation conflicts with the buffered execution architecture.**

   `ctx.sequence.allocate()` must return an integer while the handler is running, yet lane-L settlement executes buffered `ctx.db`, drives the handler to completion, and only then performs one brief authoritative commit ([LLP 0133 §Re-derivation](</Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:141>)). The commit-order sequence value is not knowable before that commit.

   The implementation choices all change important contracts:

   - hold SQLite’s global writer transaction through the whole JS handler;
   - execute or re-execute the handler during commit;
   - return a symbolic deferred value rather than the promised integer; or
   - allocate outside the application transaction, losing rollback gaplessness.

   None is specified. This blocks Campfire’s handler-tier acceptance shape.

   **Resolution:** specify an executable transaction protocol and its timeout/contention consequences, or restrict v1 to the generated-plan step and defer the handler surface.

3. **MATERIAL — replay treatment is not faithful to LLP 0051/0133.**

   “Exactly like `runtime.id`” is inaccurate. LLP 0051’s recorded-answer ledger is closed to `{ids, now}` ([LLP 0051 D1](</Users/ccheever/projects/snapback/llp/0051-language-neutral-data-tier.rfc.md:235>)); LLP 0133 gives those answers different lane-Q and lane-L treatment. An allocation is neither an existing ledger member nor an ID covered by lane L’s ID-map.

   Returning the retained settlement prevents allocation on an exact post-commit duplicate, but it does not define:

   - lane-Q captured replay;
   - lane-L speculative allocation and authoritative re-derivation;
   - references to a speculative sequence in later queued mutations;
   - stale-reservation re-execution before a settlement exists.

   **Resolution:** define allocation per settlement lane and amend the owning documents, or declare it server-only and unavailable during local execution. The fold list must include LLP 0133 and the actual ledger/wire owner if allocation becomes a host-answer member.

4. **MATERIAL — sequence-only scope tables do not participate in the incarnation registry.**

   LLP 0110 currently creates registry incarnations for participating bounded-child parents ([registry lifecycle](</Users/ccheever/projects/snapback/llp/0110-bounded-children-and-activity-patterns.spec.md:1111>)). LLP 0135 assumes every declared sequence scope already has an active registry incarnation, but its fold-on-acceptance amendments do not widen registry participation, activation validation, restore, import, or backfill.

   **Resolution:** define sequence scope tables as registry participants and extend every central writer plus activation/backfill acceptance. Otherwise sequence allocation works only accidentally for tables already used by `bounded-children.v1`.

5. **MATERIAL — the counter state and exhaustion transition are ambiguous.**

   The table holds `next_value`, but acceptance says a counter “seeded at the safe-integer maximum” refuses. If `next_value` is the next value returned, the maximum should still be allocatable; if it is the last allocated value, its name and initialization rule are wrong.

   **Resolution:** specify a complete state transition, including initial row representation, allocation of the maximum value, and the durable exhausted state. Add boundary tests for `MAX-1`, `MAX`, and the first post-maximum request.

6. **MATERIAL — no falsifiable commit-order test exists.**

   The acceptance test proves density and monotonicity, not `value order == commit order`. SQLite can deliver the claim if the counter RMW is inside the actual writer transaction: the first writer lock prevents a later allocating transaction from committing around it. The handler ambiguity above prevents assuming that arrangement.

   **Resolution:** add a controlled two-transaction test: T1 allocates and pauses before commit; T2 attempts allocation and is encouraged to commit first; record authoritative commit versions and assert sequence order equals commit-version order. Every target must either pass this exact adversarial test or publish the structured GAP.

7. **MATERIAL — the “no read surface” and containment rules omit indirect sinks.**

   The allocated value may appear in mutation results, activity payloads, stored rows, effect receipts, retained settlements, and handler logs. A handler can apparently allocate, return the number, and make no application-row write—creating a read-and-increment count oracle. The text acknowledges disclosure only to someone reading a stored row, even though generated results and receipts also expose it ([§1.7](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:147>)).

   Handler dataflow is explicitly unproved, so the containment rule is not an enforceable evidence boundary.

   **Resolution:** provide an observation/sink matrix covering results, settlements, submitter receipts, fan-out receipts, activity, logs/audit, inspection, errors, unique-constraint signals, and timing nonclaims. Either mechanically constrain handler flow, require an explicit disclosure declaration, or remove handler allocation from v1.

8. **MATERIAL — `relational_query_v1` does not fit the composite protocol as written.**

   The composite admits both bounded-child and relational nodes, but the cursor binds “every node’s parent id, incarnation, and `_version`,” and sealing is expressed in terms of absent/invisible parents ([§2.3–2.4](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:250>)). A relational query has root/join sources and a root-window cursor, not a single protected parent or incarnation ([LLP 0080 §1–2](</Users/ccheever/projects/snapback/llp/0080-portable-relational-queries-and-projections.rfc.md:99>)).

   Likewise, `Σ(takeᵢ + 1)` is asserted uniformly without defining how each relational node’s actual root-window ceiling maps into that formula.

   **Resolution:** either make v1 bounded-children-only, or define node-kind-specific cursor state, sealing behavior, restart conditions, and ceiling composition. Open question 5 cannot remain unresolved while the normative plan already admits relational nodes.

9. **MATERIAL — coordinated terminal-node semantics are internally impossible as written.**

   A terminal bounded-child node must still:

   - re-establish parent visibility so seal-entirely remains true;
   - check parent incarnation and `_version` for restart;
   - return its required parent projection.

   Therefore it cannot simply be “not re-read.” The token does not carry the parent projection, and doing so could violate the 1,024-byte cap. “Zero examined entries” can honestly mean zero child-range entries, not zero parent point reads.

   Also, “each node’s own visible-shape content” risks returning standalone per-node continuation fields, contradicting the rule that per-node cursor identity does not survive composition.

   **Resolution:** define a cursor-free `CompositeNodePage` for every admitted node kind. Terminal bounded-child nodes must redo the deduplicated parent authorization/projection read but examine zero child entries. Explicitly prohibit inner `sbbc1` or relational cursors in results.

10. **MATERIAL — the 1,024-byte `sbsb1` cap is not shown achievable.**

    Up to eight complete boundary states, including arbitrary admitted string order values, plus identities, parent metadata, authority partition, and timestamps may not fit the standalone cursor’s 1,024-byte cap. No static size proof or mint-failure behavior is given.

    **Resolution:** statically reject plans whose worst-case encoded token exceeds the cap, reduce the boundary/node limits, adopt a larger versioned cap, or use server-side cursor custody. Acceptance needs maximum-length multi-node vectors and mint-failure tests.

11. **MATERIAL — parent-auth dedup is not yet pinned at plan-hash time.**

    “Structurally identical” is directionally correct but underspecified. The equivalence class must be determined from canonical normalized authorization-relevant bytes, not runtime coincidence or an implementation’s AST equality.

    **Resolution:** define a canonical `ParentAuthorizationKeyV1` covering the entire authorization declaration, table, typed argument binding, and policy/version identity; include the derived grouping in normalized plan hashing; add golden vectors and near-miss non-dedup cases.

12. **MATERIAL — maturity inheritance conflicts with LLP 0134’s registry-global model.**

    LLP 0135 says composite maturity can never exceed the minimum maturity of its composed profiles. LLP 0134 says maturity is a registry-global constant, orthogonal to support ([LLP 0134 §1](</Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:33>)). It contains no dependency rule preventing `snapshot_batch_v1` promotion before every admissible node kind.

    **Resolution:** either add a promotion prerequisite to LLP 0134 for composite capabilities, or distinguish registry maturity from per-artifact dependency acknowledgments and remove the unsupported “minimum maturity” claim.

## Suggestions

- Add two compact normative matrices: sequence state/settlement transitions and composite node-kind/cursor behavior.
- Expand §4’s fold list to include the relation-incarnation lifecycle owner, LLP 0133/settlement owners, LLP 0113 family addition, cursor registry/key-custody changes, and the LLP 0134 dependency rule.
- Define canonical composite result encoding rather than relying on a TypeScript union to prove byte identity.
- State explicitly that seal noninterference covers semantic observables, while timing/constant-work behavior is either tested or a named nonclaim.

## Open questions

1. Is handler-tier sequence allocation essential to v1, or may the first profile be generated-plan-only?
2. Is first publication bounded-children-only, as the current cursor/sealing design effectively assumes?
3. What empirical evidence could cause SD-2 not to choose the contracted-aggregate branch under this Spec’s deliberately non-aggregate surface?
4. Are terminal bounded-child nodes intended to re-read only their parent authorization/projection while skipping the child range?
5. Is `sbsb1` required to remain self-contained under 1,024 bytes, or may composite cursor custody differ from `sbbc1`?

## Verdict

**NOT READY**

There are multiple unresolved MATERIAL concerns, including an accepted-decision conflict and at least two implementation-blocking semantic gaps. LLP 0130 SD-4’s zero-unresolved-MATERIAL condition is not met.

## Recommended next step

Revise LLP 0135 while it remains Draft, first resolving SD-2 with the author, then choosing an executable handler-allocation/settlement model and a coherent bounded-only or node-kind-specific composite cursor model. After the revisions, rerun both reviewer families from the amended text.

The LLP review skill ordinarily requires this review to be written as a provenance-tracked artifact. The workspace was read-only, so I could not create that artifact.
