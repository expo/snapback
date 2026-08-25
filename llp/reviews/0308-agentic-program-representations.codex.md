# LLP 0308 review artifact — codex family

Target: `llp/0308-agentic-program-representations.research.md`

## Round 1 — 2026-08-25

- Reviewer: codex `gpt-5.6-sol` @ ultra reasoning effort (verified in
  run log header), `codex exec --skip-git-repo-check -s read-only`,
  cwd = a full repo-tree capsule at commit `e4ecd5d7e99` (structural
  blindness: capsule predates every 0308 review artifact).
- Revision under review: r1, target sha256/16 `5a90abcfd8bb9049`.
  Instructions sha256/16 `b6f1447bfdd0af19`.
- Run: launched 2026-08-25T06:44:28Z, finished 07:01:27Z, exit 0. Body
  below is the complete final message, verbatim.

### Review body (verbatim)

## Summary

LLP 0308 identifies real opportunities and accurately describes much of Snapback’s closed IR substrate, client replay, and LLP 0209 measurements. It is not ready, however: its highest-ranked imports rely on an unsound equivalence gate, conflate incremental query semantics with separate replica and custody protocols, and use stale baselines or incorrect owners for declaration conformance, policy IR, and incremental codegen.

## MATERIAL concerns

1. **I2’s proposed equivalence checker is unsound for the authority it receives.**

   LLP 0308:208–215 permits representative-store or corpus differential execution to “validate equivalence,” after which a JavaScript handler silently gains invalidation, local-execution, retention, and delta lanes. Its confidence section and open question retain corpus-only validation as a possible trusted checker, while LLP 0308:308–311 rejects formal machinery.

   Finite tests cannot establish semantic equivalence for arbitrary handler behavior over all arguments, authentication contexts, and store states. Honest refusal controls failed derivations, not false-positive admissions. This also misuses the Alive2 precedent: [Alive2](https://web.ist.utl.pt/nuno.lopes/pubs.php?id=alive2-pldi21) checks semantic refinement using formal IR semantics and SMT, rather than treating sampled differential execution as proof. Internally, LLP 0108:119–128 expressly declines to infer reads, writes, authorization, effects, or results from behavior, and LLP 0237:204–209 says its bounded syntax admissions do not prove semantic purity.

   A fix must define a semantics-closed source fragment and a sound refinement check over every admitted input/state—such as structural proof, proof-producing translation, abstract interpretation, or SMT. Differential execution may qualify that checker but cannot authorize a correctness-sensitive lane. If no such checker is feasible, derived plans must remain advisory and I2’s rank, confidence, and “what not to import” disposition must change.

2. **F2/I2 materially misstate the existing opaque-handler precision and declaration-conformance baseline.**

   LLP 0308:139–146 and 199–203 describe opaque Ibex handlers as table-granular for invalidation and claim that every analysis falls off one binary cliff. In fact, `crates/snapback-kernel/src/live_matcher.rs:1706–1743` consults captured dependencies before the Ibex declared-read fallback, while `live_matcher.rs:2910–2974` precisely handles captured point reads and serialized query predicates. Those captures are retained by `crates/snapback-engine/src/local/engine.rs:42298–42319`; LLP 0020:341–366 records this shipped mechanism.

   LLP 0308:217–222 also says `reads:`/`writes:` are never verified and proposes VM observation as new. LLP 0146 §D1 already defines per-invocation declaration/observation reports and opt-in strict enforcement; this ships in `crates/snapback-kernel/src/conformance.rs:159–184,216–283`. The remaining gap is narrower: strict enforcement is not the default, a single observation is not a global completeness proof, and authored query reads remain a fallback when captures cannot prove disjointness. Authored `writes:` are not themselves a generic invalidation key.

   A fix must present a lane-by-lane matrix distinguishing static plan admission, runtime-captured invalidation precision, RQS/local eligibility, delta eligibility, and declaration enforcement. It must state the residual gap precisely and add LLP 0146 as an owner rather than presenting captured observations as a new I2 mechanism.

3. **I1’s “three fronts, one derivation” claim conflates query IVM with separate replica, storage, and authority protocols.**

   A DBSP-style algebra can plausibly derive incremental query output for closed operators, but it does not thereby derive replica continuity, retained-fact custody, or local evaluation. LLP 0209:2780–2807 explicitly separates “one IR, two evaluators” from the still-undesigned base/predecessor stamping, delivery mode, gap detection, and gap-to-replace contract. LLP 0190:228–250,270–382 separately requires authority, completeness, absence, custody, bounds, writer/rebuild, and migration contracts. Membership semi-joins additionally require explicit authority-bearing inputs; algebra alone does not supply them. The [DBSP paper](https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf) supports compositional incrementalization of a query algebra, not these Snapback-specific protocols.

   LLP 0308:194–195 also incorrectly calls LLP 0008 DK-3 “superseded.” LLP 0209:2724–2737 calls it load-bearing precedent, and LLP 0008:287–300 says only its historical measurements were superseded—the mechanism and decision stand. The active G3 commission already preserves node-by-node eligibility and fallback boundaries.

   A fix must narrow I1 to a shared algebraic kernel, demonstrate lowering and state requirements for Snapback’s root/per-parent top-N windows and authority-bearing semi-joins, and specify the independent consumer contracts for server deltas, replica continuity, and local storage/evaluation. It must preserve DK-3’s wire, fallback, convergence, and authority contracts and reduce the current high confidence until that bridge is established.

4. **I3 treats an accepted policy design as an open import and relies on stale implementation ground truth.**

   The document says the policy discipline has “no typed representation to run over.” Current Rust already has closed `TableVisibilityV1` and `FunctionWritePolicyV1` carriers in `crates/snapback-types/src/manifest/types.rs:1241–1261,8519–8529`. More importantly, Accepted LLP 0274 already specifies `TableWritePostureV2`, `FunctionWritePolicyV2`, `WriteExecutionAuthorityV1`, a closed dispatcher, and exact-versus-opaque operation census at LLP 0274:308–324,1312–1383. Its status explicitly says implementation remains.

   The document also repeats LLP 0274 §S0’s dated scanner failure as current reality. `packages/snapback-codegen/write-policy.mjs:269–497,697–742,822–1028` now follows named helper chains and marks many unresolved alias/computed paths opaque. Residual soundness still needs audit, but the historical exact-empty diagnosis is no longer an adequate current baseline. Meanwhile, `visibility-governance.mjs:253–414` already compares canonical policy bodies rather than treating the entire governance comparator as handler-AST inspection.

   Finally, LLP 0276’s workspace rearchitecture is recorded as structurally implemented and deliberately retains no-build JavaScript tooling consuming Rust-authored schemas; it is not a future “natural moment” to move policy derivation into Rust.

   A fix must reframe I3 as implementation/status analysis of LLP 0274’s accepted design, separate typed carriers and canonical comparison from the harder source-operation census, identify current residual scanner holes, and treat any Rust migration as an explicit LLP 0276 amendment.

5. **I4’s feasibility and ownership claims omit the actual incremental-validation problem.**

   Snapback does not currently expose the fine-grained validation dependency graph implied by “only cache keys.” `packages/snapback-codegen/review-surface.mjs:59–82,247–252` keys the cache by the complete `inputsHash`, and publication verifies and replaces the complete graph at `review-surface.mjs:412–439`. `NormalizedApplicationDefinitionV1` has whole-definition identities while operations remain ordinary array entries (`semantic-generation.mjs:432–535`).

   Accepted LLP 0241:94–177 is the governing identity/custody decision: sub-identities support diffing, but activation remains atomic and the complete generated graph must be verified. Safe incremental reuse therefore requires versioned pass dependencies, invalidation rules for schema/policy/global checks, toolchain inputs, cache-trust custody, and preservation of whole-generation atomicity. Existing hashes alone do not establish those properties.

   The named owners are also wrong. LLP 0186:397–425,476–485 sequences edit-loop work but delegates mechanisms; LLP 0307 is an Implemented bounded round and contains no continuing incremental-codegen program. A fix must route I4 through LLP 0241 plus a real performance owner, inventory coarse and fine identities, design the dependency and cache-custody contract, and measure the attainable ceiling before assigning high confidence.

## Non-material observations

1. LLP 0308:106–108 should say the client and server have separate evaluators over the same IR with conformance, not that the browser uses “the same evaluator the server runs.” `packages/snapback-client/ir-evaluator.mjs:1–16` identifies itself as the browser-side implementation.

2. The live-delta shorthand “ordered/limited” is slightly too broad: unordered limited queries below their effective cap can remain eligible; ordered or cap-saturated windows replace (`live_matcher.rs:3463–3501`).

3. Captured graph dependencies are evaluator-produced companion evidence, not literally fields “in the IR.” The analyzability point remains sound.

4. LLP 0308:300 should cite Accepted LLP 0252 for the shared normalized-boundary ruling rather than saying Draft LLP 0304 itself established it. The external prior-art section would also benefit from stable primary-source links.

## Verdict

NOT READY