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

## Round 2 — 2026-07-31

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (`medium` per CLI banner)
**Date:** 2026-07-31
**Method:** round-2 delta — reviewer given its own Round 1, the SD-2 adjudication to scrutinize, and instructed to verify items 2–12 against v0.2 then review new text only; read-only sandbox, blind to this Spec's fable artifact
**Target SHA-256:** `e89cc5b5a10dd60d9ae402b7ea95c47a76c13a3a4d0b823e72692ba9ed139e17`
**Status:** completed (first attempt, no retry needed)

### Verbatim review

Reviewed exact target SHA-256 `e89cc5b5a10dd60d9ae402b7ea95c47a76c13a3a4d0b823e72692ba9ed139e17`. I did not inspect the Fable review body.

## Round-1 item resolutions

1. **SD-2 adjudication — ACCEPTED, not a defect.** The adjudication correctly distinguishes who makes the decision. LLP 0120 already establishes that 3a cannot express `boardSummary` or Split’s reductions; LLP 0135 merely records that usage evidence for the criteria in [SD-2](</Users/ccheever/projects/snapback/llp/0130-program-standing-decisions.decision.md:39>). The contracted-aggregate outcome is effectively implied by **SD-2 plus LLP 0120**, but it is not newly pre-empted by LLP 0135’s construction. No real pre-emption is missed.

2. **Buffered allocation protocol — RESOLVED.** The snapshot-derived tentative integer, buffered counter RMW, captured-read validation, abort/re-execution behavior, and brief authoritative commit form an executable protocol consistent with LLP 0003’s handler boundary ([§1.2](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:176>)).

3. **Settlement/replay semantics — RESOLVED, with one DETAIL correction below.** The value is correctly settlement-replay evidence, not a `{ids, now}` ledger member; lane-L local execution is excluded and lane Q remains authoritative-only ([§1.4](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:225>)).

4. **Registry enrollment — RESOLVED.** Counter declarations are a second registration ground, with insert/delete/recreation/restore, reviewed backfill, stamping, and fold-on-acceptance coverage.

5. **Exhaustion — RESOLVED.** `MAX−1`, `MAX`, and durable post-MAX exhaustion are unambiguous and represented in acceptance.

6. **Commit-order falsifier — RESOLVED.** The T1 pause/T2 commit/T1 validation failure and fresh allocation vector directly distinguishes allocation order from commit order ([§5.1](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:667>)).

7. **Sink matrix — NOT FULLY RESOLVED; MATERIAL remains.** See M1 below.

8. **Bounded-children-only — RESOLVED.** V1 admits no relational nodes; successor requirements are separated cleanly ([§2.1](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:393>)).

9. **Every resume reads parents — RESOLVED.** Terminal nodes repeat deduplicated parent authorization/projection reads while examining zero child-range entries; inner cursors are prohibited ([§2.4](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:514>)).

10. **Cursor budget — RESOLVED.** The arithmetic is correct: `8192 − 6 = 8186` base64url characters; at most 6,139 decoded bytes; minus 24-byte nonce and 16-byte tag leaves 6,099 plaintext bytes. Static worst-case refusal prevents a runtime size cliff ([§2.4](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:496>)).

11. **Parent authorization identity — RESOLVED.** `ParentAuthorizationKeyV1` has closed canonical JCS bytes, structural equality, plan-hash inclusion, golden vectors, and near-miss tests ([§2.2](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:434>)).

12. **Maturity — RESOLVED.** Minimum-maturity inheritance is no longer falsely normative. Promotion order is explicitly only a proposed LLP 0134 prerequisite pending that document’s own loop ([§2.6](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:558>)).

## New concerns

### M1 — MATERIAL: handler diagnostics expose tentative or aborted allocations

The new sink matrix omits handler logs and thrown-error diagnostics. This matters because the handler receives an ordinary integer before commit, while Snapback’s console stringifies handler values and immediately sends them through `runtime.log` ([console sink](</Users/ccheever/projects/snapback/packages/snapback-harness/ctx-bootstrap.js:664>), [stringification](</Users/ccheever/projects/snapback/packages/snapback-harness/allowlist-install.js:409>)).

A handler can therefore:

```js
const n = ctx.sequence.allocate("messages", roomId);
console.log(n);
```

and subsequently lose captured-read validation. The tentative number has already escaped even though the allocation did not commit. A handler can similarly include it in a thrown error. That contradicts the normative claims that a failed attempt “leaves no trace” and an aborted transaction “leaves no observable trace” ([§1.2–1.3](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:176>)).

Resolution requires an explicit diagnostics/error posture and acceptance vector. Plausible choices are transactionally buffering sequence-bearing handler diagnostics until commit, or narrowing the no-trace claim while honestly documenting tentative-value disclosure. The latter may require an evidence-boundary review.

### D1 — DETAIL: the LLP 0133 divergence-class statement is inaccurate

The claim that sequence divergence “fits none” of LLP 0133’s three classes is too strong. It does not fit the specialized **id-map** or time treatment, but changed sequence-bearing results, rows, branches, or failures do fit **outcome divergence**, whose rule is simply that the authoritative outcome wins ([LLP 0133](</Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:501>)).

The real missing facility is narrower: outcome reconciliation provides no typed mapping for speculative sequence values copied into later pending arguments. Rewording that distinction preserves the sound lane-L exclusion.

### D2 — DETAIL: SD-2 explanatory prose overstates branch uncertainty

The new text says the contracted branch is “reachable-or-not” and evidence may land outside both branches ([§5.2](</Users/ccheever/projects/snapback/llp/0135-sequence-allocation-and-snapshot-batch.spec.md:752>)). LLP 0120 already says `boardSummary` and Split remain inexpressible under 3a, so once SD-2’s usage-evidence trigger fires, its contracted-profile branch follows.

This does not revive Round-1 item 1: SD-2 itself owns and causes that outcome. The misleading branch-uncertainty language should simply be removed.

## Verdict

**NOT READY**

One unresolved MATERIAL concern remains, so LLP 0130 SD-4’s zero-unresolved-MATERIAL condition is not met.

## Next step

Revise the sink/abort contract to cover handler logs and thrown errors, add an adversarial aborted-allocation diagnostic test, and make the two DETAIL wording corrections. Then rerun the Codex-family delta review on the new SHA.

## Round 3 — 2026-07-31

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (`medium` per CLI banner)
**Date:** 2026-07-31
**Method:** round-3 delta — reviewer given its own Rounds 1–2, instructed to verify M1 (v0.3's narrowing posture, re-verifying the cited code claims), D1, and D2 against v0.3, then check the Fable-originated delta changes for fresh defects only; read-only sandbox, blind to this Spec's fable artifact
**Target SHA-256:** `a58bc797a08238e8953e7d2fff6b5d24ba6e08cbc124450a870bb4c55b37a941`
**Status:** completed (first attempt, no retry needed)

### Verbatim review

Reviewed exact v0.3 SHA-256 `a58bc797a08238e8953e7d2fff6b5d24ba6e08cbc124450a870bb4c55b37a941`, without reading the Fable review.

## Round-2 item resolution

- **M1 diagnostics posture — NOT RESOLVED; MATERIAL.**  
  Narrowing is honest for `console`: arguments are eagerly stringified and immediately forwarded through `runtime.log` ([allowlist-install.js](/Users/ccheever/projects/snapback/packages/snapback-harness/allowlist-install.js:409), [ctx-bootstrap.js](/Users/ccheever/projects/snapback/packages/snapback-harness/ctx-bootstrap.js:664)). Therefore an aborted attempt can indeed leak its tentative number through this explicitly non-protocol diagnostics channel.

  The problem is the Spec treats a **thrown-error payload** as the same kind of channel. An uncaught handler error is instead encoded into the handler completion envelope and converted into `SnapbackError` details ([ctx-bootstrap.js](/Users/ccheever/projects/snapback/packages/snapback-harness/ctx-bootstrap.js:1097), [runtime.rs](/Users/ccheever/projects/snapback/src/runtime.rs:2550)). That is a runtime/protocol diagnostic, contradicting §1.2's claim that a failed attempt leaves no trace on any protocol surface.

  The acceptance vector is also impossible as written: if the handler actually throws, execution fails before captured-read commit validation; it cannot both surface the thrown payload and then be "driven to abort" by counter validation. If it catches the error, the thrown payload does not itself escape. Thus the narrowing hides one remaining protocol leak rather than fully resolving it.

- **D1 divergence classification — RESOLVED.**  
  §1.4 now correctly classifies changed sequence-bearing outcomes as ordinary LLP 0133 class-3 outcome divergence and identifies the missing typed mapping for values copied into later pending arguments as the actual gap.

- **D2 SD-2 branch language — RESOLVED.**  
  The reachable-or-not overstatement is gone. §5.2 accurately says the contracted-profile branch is the expected consequence of SD-2 plus LLP 0120 once the usage-evidence trigger fires, while leaving trigger and branch adjudication with LLP 0130's owner.

## Fable-originated delta

- **`maxEncodedBytes` declaration — no fresh defect.** The write-enforced UTF-8 bound, adoption check, establishment refusal, and maximum-width acceptance vector provide a workable static cursor bound.
- **Byte-identical `PARENT_UNAVAILABLE` collapse — no fresh defect.** The ordering and acceptance requirements consistently collapse hidden, absent, and inactive non-public scopes without an existence oracle.
- **Invariant-bound race vector — no fresh defect.** It now tests density, uniqueness, and commit-version order while properly allowing either retry or typed conflict as LLP 0003's target-specific recovery.
- **Lane-Q overlay omission — new MATERIAL concern.** §1.4 defines query-dependent omission of "the pending row" only from projections that project or order by the sequence field. Existing LLP 0008/0043 semantics make an optimistic changeset mutation-level and all-or-nothing, not dependent on which projection observes it. The same row could consequently appear optimistically in one projection while being absent from another, and a multi-row allocating mutation could partially apply its optimistic changeset. The fold list also does not draft the required LLP 0008/0043 amendment.

  Resolve this by choosing a mutation-level atomic rule—most simply, omit the entire optimistic changeset when any write depends on an unavailable allocation—or formally extend the overlay model. Add a cross-projection, multi-row acceptance vector and fold the rule into its owning LLPs.

## Verdict

**NOT READY**

SD-4 is not met: M1 remains MATERIAL, and the lane-Q delta introduces another MATERIAL inconsistency.

## Next step

Revise §1.7 and §5.1 to separate immediate console disclosure from uncaught thrown errors, deciding whether thrown messages are sanitized/value-free or explicitly acknowledged as protocol disclosure. Then define a mutation-atomic lane-Q withholding rule with an LLP 0008/0043 fold and acceptance coverage, and rerun the Codex-family delta review.

## Round 4 — 2026-07-31

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (`medium` per CLI banner)
**Date:** 2026-07-31
**Method:** round-4 targeted — reviewer given its own Rounds 1–3, instructed to check v0.4's resolutions of its two Round-3 items (the thrown-error acknowledgment posture and the mutation-atomic lane-Q rule) and the changed text only for fresh defects; read-only sandbox, blind to this Spec's fable artifact
**Target SHA-256:** `8df9437107429dd423dd86a6fef3b4ce221e8952cfeee2d42d5a3315aca4ad4b`
**Status:** completed (first attempt, no retry needed)

### Verbatim review

Reviewed exact v0.4 SHA-256 `8df9437107429dd423dd86a6fef3b4ce221e8952cfeee2d42d5a3315aca4ad4b`. I did not read the `.fable.md`.

**Verdict: READY**

1. **Thrown-error channel — RESOLVED.** The protocol-carried, app-authored disclosure is now classified honestly; durable/result no-trace claims are narrow and falsifiable, and the two abort mechanisms have valid, explicitly separate vectors.

2. **Lane-Q mutation atomicity — RESOLVED.** Whole-changeset withholding across every row and projection preserves LLP 0043 M2/LLP 0008 atomicity; §4.7 and the mixed cross-projection vector adequately pin the fold.

No fresh defects found in the v0.4 delta.

**Next step:** Append this Round-4 verdict to the Codex review artifact, then the author may proceed with the SD-4 status decision. The read-only workspace prevented me from appending it directly.
