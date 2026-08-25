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
## Round 2 — 2026-08-25 (delta round on r2)

- Reviewer: codex `gpt-5.6-sol` @ ultra (verified in run log),
  read-only in capsule-r2 (capsule-r1 lineage + r2 overlay; zero 0308
  review artifacts, verified); received the r1→r2 diff and its own
  round-1 review only.
- Revision under review: r2, target sha256/16 `f56cde3cca4dd3a4`
  (commit `bf3943a80`). Instructions sha256/16 `10c5aed8781a6c64`.
- Launch 1 (07:04Z) was killed by the environment mid-run with no final
  output — voided, not counted. Launch 2: started 2026-08-25T07:21:49Z, exit 0.
  Body below is the complete final message of launch 2, verbatim.

### Review body (verbatim)

## Round-1 disposition check

1. **DISPOSED** — I2 now keeps derivation advisory until a sound refinement checker exists and limits differential testing to pre-filtering/qualification, consistent with [Alive2’s SMT-based refinement model](https://web.ist.utl.pt/nuno.lopes/pubs.php?id=alive2-pldi21).
2. **PARTIALLY DISPOSED** — F2’s capture ordering, lane matrix, and shipped conformance baseline are corrected, but revised I2(a) introduces the material errors below.
3. **DISPOSED** — I1 now limits shared derivation to matcher deltas and local materialization while separating replica continuity and LLP 0190 custody/authority, consistent with [DBSP’s query-IVM scope](https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf); DK-3 is restored.
4. **PARTIALLY DISPOSED** — The carrier, LLP 0274 status, governance-comparator, and LLP 0276 corrections are accurate, but the revised scanner ground truth remains materially false.
5. **DISPOSED** — Current code confirms the whole-`inputsHash` cache, complete-graph publication, whole-definition identities, LLP 0241 atomicity, and corrected LLP 0186/0307 ownership.

## MATERIAL concerns

1. **IN-DELTA — I2(a) contradicts the ratified declaration-conformance contract.** LLP 0308:258–265 presents moving strict enforcement toward default as a narrow strengthening, but LLP 0146:516–531 and 1282–1288 explicitly rule that strict mode remains per-app opt-in and off for newly generated apps; `manifest/types.rs:661–674,714–730` implements that default. The Cloudflare target still refuses the flag because it cannot enforce it (`targets/cloudflare/src/target-admission.js:10–29`). The same paragraph incorrectly calls per-invocation `extraReads`/`extraWrites` over-declaration findings, although LLP 0146:459–515 and `conformance.rs:74–80` reserve that verdict for aggregate coverage, and it falsely groups authored `writes:` into the live-invalidation fallback, which consults only `read_set_summary` (`live_matcher.rs:1721–1742`). Either preserve the accepted opt-in policy and recommend aggregate coverage, or explicitly propose an LLP 0146 amendment with target scope, compatibility, and non-enforcing-target handling.

2. **IN-DELTA — I3’s scanner correction erases live exact-empty false negatives.** LLP 0308:302–304 says unresolved alias/computed paths become opaque and calls LLP 0274 §S0’s exact-empty diagnosis dated. In current code, context tracking covers only directly named handler parameters and direct `ctx.db` shapes (`write-policy.mjs:193–203,341–361,449–476`). Consequently, forms such as `const alias = ctx; alias.db.insert(...)` or `ctx[key].insert(...)` produce neither a site nor `opaque`; the empty census then passes through `buildWritePolicyChecks` (`:948–1028`). Mutable top-level `let`/`var` helpers are also accepted as exact without reassignment analysis (`write-policy.test.mjs:394–415`). This conflicts with Accepted LLP 0274:1365–1383, which requires escaped contexts, computed members, indirect helpers, and unresolved call graphs to become opaque absent a sound proof. The status analysis must identify these current holes rather than asserting they are closed.

## Non-material observations

1. **IN-DELTA** — F2’s “point reads … match precisely” should mean exact positive wakes only: a point-only capture cannot prove general disjointness and falls back when no captured query exists (`live_matcher.rs:2910–2951`).
2. **IN-DELTA** — “Snapback content-addresses coarsely” should be scoped to the validation cache; fine per-operation `implementationHash` and envelope-member digests already exist.
3. **PRE-EXISTING** — The prior-art section still lacks stable primary-source links; the separate LLP 0252 ownership correction is fixed.

## Verdict

NOT READY
## Round 3 — 2026-08-25 (delta round on r2→r3)

- Reviewer: codex `gpt-5.6-sol` @ ultra (verified in run log),
  read-only in capsule-r3 (capsule-r2 lineage + r3 overlay; zero 0308
  review artifacts, verified); received the r2→r3 diff and its own
  round-2 review only.
- Revision under review: r3, target sha256/16 `d9f306d0d91582b0`
  (commit `6583d3e07`). Instructions sha256/16 `810cce0b6909cf7d`.
- Run: launched 2026-08-25T07:35:02Z, exit 0. Body below is the
  complete final message, verbatim.

### Review body (verbatim)

## Round-2 disposition check

1. **DISPOSED** — §I2(a) now preserves strict mode as per-app opt-in, treats unwitnessed declarations as data, reserves over-declaration for aggregate coverage, and excludes authored `writes:` from invalidation fallback, matching LLP 0146 and current implementation.
2. **DISPOSED** — §I3 now explicitly identifies the context-alias, computed-member, and mutable-helper exact-empty false negatives confirmed in `write-policy.mjs`, consistent with LLP 0274’s opaque-unless-proven requirement.

## MATERIAL concerns

None.

## Non-material observations

1. **IN-DELTA** — §I2(a) presents aggregate D2 coverage as the remaining import, although `aggregateConformance` already ships in `verify.mjs:1357–1502`; the actual residue is expanding authoritative path observations. It also says both over- and under-declaration verdicts live there, while complete `missingReads`/`missingWrites` are authoritative per invocation.
2. **IN-DELTA** — §I2(a)’s parenthetical conflates runtime strict-enforcement codes with target admission. `SNAPBACK_HANDLER_UNDECLARED_READ/WRITE` are runtime violations; a non-enforcing target refuses the flag at load with `SNAPBACK_STRICT_DECLARATIONS_TARGET_UNSUPPORTED`.
3. **IN-DELTA** — §F1’s singular “canonical-graph substrate” overstates the architecture. Snapback has several canonical closed representations with separate identity machinery, as §F2 and §I4 themselves explain. This does not distort the recommendations.
4. **IN-DELTA** — The Alive2 bibliography names the wrong authors. The PLDI 2021 paper lists Nuno P. Lopes, Juneyoung Lee, Chung-Kil Hur, Zhengyang Liu, and John Regehr. [PLDI paper entry](https://pldi21.sigplan.org/details/pldi-2021-papers/5/Alive2-Bounded-Translation-Validation-for-LLVM)

## Verdict

READY