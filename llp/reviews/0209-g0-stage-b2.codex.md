# LLP 0209 G0 Stage B2 — codex review record

**Change:** defineGraphQuery authoring + JS lowering/normalization + source-stage refusals + JS<->Rust parity (landed on main as the series ending `4627f9d95`, 2026-08-23)
**Reviewer:** codex gpt-5.6-sol, xhigh (targeted rounds at high/xhigh), read-only, blind to the other family on full rounds
**Orchestrator:** Claude Fable 5 (session snapback-44), under `issues/20260823-llp0209-g0-commission.md`
**Provenance:** every review below was actually received from the named model; verbatim text per round.

## Verdict ledger

| Round | Reviewed | Verdict |
| --- | --- | --- |
| r1 | B2 source (d7403d637 pre-rebase) | VERDICT: NOT READY (5 MATERIAL) |
| r2 | fix round 1 | VERDICT: NOT READY (2 MATERIAL) |
| r3 | fix round 2 | VERDICT: NOT READY (2 MATERIAL) |
| r4 | fix round 3 (targeted codex; grok READY r3) | VERDICT: NOT READY (1 MATERIAL) |
| r5 | fix round 4 allowance handshake (targeted codex) | VERDICT: NOT READY (1 MATERIAL) |
| r6 | fix round 5 top-level-only minting (targeted codex) | VERDICT: READY |

## r1 — B2 source (d7403d637 pre-rebase)

Found 5 material issues. `HEAD` is regeneration-only; the authored scope is confined to the requested B2 files.

## Findings

1. **MATERIAL — JS hashing accepts values B1 JCS refuses.**  
   [graph-query.mjs:25](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:25) clones through `JSON.stringify`, while [result-contracts.mjs:21](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/result-contracts.mjs:21) implements canonical JSON as sorted objects plus `JSON.stringify`. Authoring accepts any finite number at [define.mjs:720](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/define.mjs:720), including `9007199254740992`; JS hashes it successfully, but B1 refuses unsafe integral numbers in [rqs_contract.rs:139](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-types/src/rqs_contract.rs:139). JS likewise accepts lone UTF-16 surrogates, which B1 explicitly requires the JS arm to refuse at [rqs_contract.rs:197](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-types/src/rqs_contract.rs:197). The JSON round-trip can additionally coerce or omit non-JSON values rather than refusing them.  
   **Fix:** implement the exact B1 JCS refusal and number-formatting rules before cloning or hashing; replace JSON-round-trip copying; add cross-language vectors around ±2^53, 1e21, `-0`, exponent boundaries, and lone surrogates.

2. **MATERIAL — the source-stage code/dynamic-construction gate is bypassable.**  
   [index.mjs:19430](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19430) recognizes builders/helpers by identifier spelling without authenticating their import, and [index.mjs:19493](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19493) rejects only arrow/function expressions—not method declarations, accessors, arbitrary identifiers, or member expressions. A locally defined `asc`, or `accessIndex: dynamicallyComputedValue`, reaches lowering. More severely, `{__proto__: {toJSON() { … }}}` passes the AST check; runtime preflight only traverses own keys at [define.mjs:3537](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/define.mjs:3537), after which [graph-query.mjs:25](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:25) executes the inherited `toJSON`.  
   **Fix:** enforce a field-aware literal grammar, resolve DSL helpers to trusted module bindings, reject every function-like/method/accessor/class/dynamic-reference form outside explicitly permitted table and helper positions, require plain prototypes, and read descriptor values without invoking properties.

3. **MATERIAL — refusal-register ordering and spelling diverge from B1.**  
   The source checker records the first traversal fault at [index.mjs:19489](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19489), so a declaration containing both a callback and client AST can report `CODE_FORBIDDEN` before normative row-1 `CLIENT_AST_FORBIDDEN`. Separately, an unknown parent stalls authority derivation and reports `SNAPBACK_GRAPH_CYCLE` at [graph-query.mjs:546](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:546); B1 reports `PARENT_INVALID` first at [graph.rs:2600](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-types/src/manifest/graph.rs:2600).  
   **Fix:** collect faults and select by the normative register order; validate missing parents before topological authority derivation.

4. **MATERIAL — search membership can produce authority class 1 from authored claims.**  
   Search membership is public authoring surface at [define.d.ts:1100](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/define.d.ts:1100), including an author-supplied `membershipIdentity.authorityClass`. Lowering copies that identity at [define.mjs:3704](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/define.mjs:3704), and class derivation trusts it directly at [graph-query.mjs:450](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:450). A membership-dependent node can therefore emit class 1. B1 explicitly refuses every authored search node until D6 provider-owned preimages exist at [graph.rs:4061](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-types/src/manifest/graph.rs:4061).  
   **Fix:** remove search membership from B2 authoring or unconditionally emit `SNAPBACK_GRAPH_SEARCH_UNADMITTED`; never derive authority from an authored provider identity.

5. **MATERIAL — the claimed Rust-host admission test exercises only rank-0 artifact validation.**  
   [graph-query.test.mjs:495](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.test.mjs:495) invokes [graph_codegen_admission.rs:10](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-types/tests/graph_codegen_admission.rs:10), which only deserializes `FunctionManifest` and calls `validate_artifact()`. It never runs installed-schema/index/result-contract admission from [engine.rs:34403](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-engine/src/local/engine.rs:34403) and [engine.rs:35154](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-engine/src/local/engine.rs:35154). Codegen merely copies `accessIndex` at [define.mjs:3731](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/define.mjs:3731), does not validate the analytical cost equations, and builds result cardinality from `maxRootRowsPerPage` at [define.mjs:3891](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/define.mjs:3891), whereas the host reifies it from `maxResultRows` at [engine.rs:34337](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-engine/src/local/engine.rs:34337). Unknown indexes, incorrect `maxArgumentItems`, or unequal result bounds can therefore generate successfully and then be refused.  
   **Fix:** pass emitted functions and schema through the complete engine admission seam, preferably via a shared deterministic verifier, with negative parity cases for every admission register.

**MINOR — whitespace failure.** [graph_codegen_admission.rs:24](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-types/tests/graph_codegen_admission.rs:24) has an extra blank line; `git diff --check HEAD~2..HEAD~1` reports it. Remove the blank line.

## Refuted risks

- **REFUTED-RISK — broadcast certificate emission:** TypeScript permits only `query-shaped` at [define.d.ts:1196](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/define.d.ts:1196), lowering rejects anything else at [graph-query.mjs:486](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:486), and emits only the query-shaped admission arm.
- **REFUTED-RISK — maxArgumentItems double-counting:** [graph.rs:3429](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-types/src/manifest/graph.rs:3429) now adds exactly one cardinality per argument; demand-time handling at [graph.rs:4708](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-types/src/manifest/graph.rs:4708) matches the contract. The targeted `3 + 5 = 8`, `7` refused test passed.
- **REFUTED-RISK — frozen-vector replay:** [graph-query.test.mjs:29](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.test.mjs:29) reads the frozen B1 carrier/vector files and checks all six domains, base hashes, and one-axis rotations. Hash equality under the exact domains binds the canonical bytes for those fixtures; it simply lacks the boundary coverage exposed by finding 1.
- **REFUTED-RISK — scope creep:** no evaluator, matcher, Zerobugs, or corpus source was changed. [effect-ceiling.mjs:354](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/effect-ceiling.mjs:354) only derives static declared read/authority metadata.
- **REFUTED-RISK — package inventory:** the inventory check passes at 331 tests.

## Required answers

(i) **Yes.** `defineGraphQuery` can report success for manifests the B1 host refuses—unknown index/prefix, inconsistent cost bounds, result-contract cardinality mismatch, unsafe JCS literals, and every authored search-membership node are concrete paths.

(ii) **Yes.** The [ephemeral.rs:793](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-sync/src/ephemeral.rs:793) diff changes only the frozen `inputsHash`, `schemaHash`, and their canonical SHA-256 constant. There is no semantic or control-flow change.

## Weakest seam

The weakest seam is the duplicated boundary between permissive JS authoring/lowering and the full Rust installed-owner admission kernel. The current evidence proves one friendly artifact through type-layer validation, while strict JCS, source closure, installed index/schema facts, analytical costs, authority ownership, and result reification remain independently implemented or untested. A shared host verifier invoked by codegen, backed by cross-language negative vectors, would close several of these findings at once.

Verification: the targeted Rust `maxArgumentItems` test and package inventory passed. The complete JS test could not create its temporary fixture under this read-only sandbox (`EPERM`); its non-temporary identity/normalization/refusal prefix ran successfully.

VERDICT: NOT READY (5 MATERIAL)

## r2 — fix round 1

Two material gaps remain: the source gate is bypassable through unproven bindings, and JS codegen can emit an incorrect `maxArgumentItems` value that B1 rejects.

## Disposition review

- **F1 — FIXED (REFUTED-RISK).** The graph canonicalizer now uses ECMAScript number serialization, negative-zero handling, UTF-16 key order, and descriptor-only data traversal in [graph-query.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:23). Unsafe integers, non-finite numbers, and lone surrogates refuse during authoring in [define.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/define.mjs:3515). The frozen vectors cover integer-index keys, exponent thresholds, astral-key ordering, and refusals in [identity-vectors.v1.json](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/identity-vectors.v1.json:3), with matching Rust assertions in [graph.rs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-types/src/manifest/graph.rs:5475). A read-only replay passed all boundary vectors against both graph JCS and shipped `rqs.mjs`.

- **F2 — PARTIAL (MATERIAL).** The fix now walks all definition-graph modules in [index.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19664), resolves direct/package namespace helpers, handles property-access callees in [index.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19493), inspects computed/shorthand properties, refuses `new` and non-literal positions, and performs descriptor/plain-prototype runtime preflight in [define.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/define.mjs:3534). However, the binding-provenance bypass described below remains.

- **F3 — FIXED.** Source faults are deduplicated by code and sorted using the normative four-row order in [index.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19418) and [index.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19664). Unknown parents refuse before authority topological derivation in [graph-query.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:628).

- **F4 — FIXED.** Authored search membership refuses immediately in [define.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/define.mjs:3741), with a second lowering guard in [graph-query.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:621). Consequently, authored `membershipIdentity.authorityClass` cannot reach class derivation. Principal nodes force class 3, while partition classes derive from installed visibility/policy inputs in [graph-query.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:558). Broadcast emission remains impossible: non-query-shaped authoring refuses and the emitted arm is hard-coded query-shaped in [graph-query.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:602).

- **F5 — FIXED.** The environment-skipped `crates/snapback-types/tests/graph_codegen_admission.rs` test was deleted. The committed manifest is loaded through the production graph-admission validator, followed by a one-axis result-contract negative, in [engine.rs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-engine/src/local/tests/engine.rs:125). That validator is the same production function called during activation/loading at [engine.rs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-engine/src/local/engine.rs:8848). The JS suite regenerates and byte-compares the identical committed manifest in [graph-query.test.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.test.mjs:507).

- **MINOR — FIXED.** The blank-line-bearing skip test was deleted; the comparator comment now correctly names whole-filter canonical JCS bytes in [graph-query.test.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.test.mjs:331); and only one pre-evaluation diagnostic return remains in [index.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:2395). `git diff --check 5fc165467 HEAD` is clean.

## New material findings

1. **MATERIAL — source-stage closure can still be bypassed.** Builder discovery recognizes only direct imported identifiers and dot-property namespace calls; local aliases and element access such as `graphDsl['defineGraphQuery'](...)` are not collected by [index.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19493). Separately, any identifier is accepted in `table`/`targetTable` positions without proving that it is the imported schema binding in [index.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19647). Thus a conditional local alias selecting between genuine table builders, or an aliased builder receiving dynamically assembled plain data, reaches lowering because runtime preflight sees only the evaluated plain carrier. Fix by binding-resolving builder/helper/table identifiers through the module graph, rejecting unproven exported graph definitions, and adding computed-callee, local-builder-alias, and conditional-table negatives.

2. **MATERIAL — `maxArgumentItems` still has a JS/Rust admission divergence.** JS merely remaps argument-cost IDs in [graph-query.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:416) and copies the authored query cost into the candidate in [graph-query.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:720). Rust recomputes the aggregate—each collection contributes its declared cost once and each scalar contributes one—and requires exact equality in [graph.rs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-types/src/manifest/graph.rs:3429). A read-only probe changed the zero-argument frozen plan’s `maxArgumentItems` from `0` to `1`; JS accepted it and minted a plan hash, while B1 necessarily returns `SNAPBACK_GRAPH_BOUND_INVALID`. Fix by mirroring Rust’s exact argument-cost index and aggregate calculation before hashing/emission, including a one-axis negative.

## Required answers

1. **Can codegen succeed with a manifest B1 refuses?** Yes. An incorrect but structurally valid `maxArgumentItems` is emitted and hashed successfully by JS but refused by B1.

2. **Is the `ephemeral.rs` change exactly a digest resync?** Yes. The diff changes only embedded `inputsHash`, `schemaHash`, and the corresponding canonical fixture digest at [ephemeral.rs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-sync/src/ephemeral.rs:795) and [ephemeral.rs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-sync/src/ephemeral.rs:895). No manifest structure or behavioral code changed. A read-only recomputation matched `d5e4c1a77ed620ace6a41c0d377d007eead53454c8272d65b58a8cf21f33c0fa`.

3. **Weakest seam.** The weakest seam is the boundary between syntactic authoring validation and the evaluated carrier handed to normalization: the source gate proves only selected import spellings, runtime preflight proves only the resulting object’s descriptors/prototypes, and neither preserves full provenance from syntax to lowered fields. The single frozen full-engine vector strongly proves one happy path, but does not close that provenance gap or enforce all Rust semantic invariants such as aggregate argument bounds.

The requested full JS test was attempted but could not create its temporary fixture directory under the read-only sandbox (`EPERM` before assertions); the narrower read-only JCS and digest checks passed.

VERDICT: NOT READY (2 MATERIAL)

## r3 — fix round 2

Fix round 2 is not ready. G1 and G2 each retain one material admission gap.

### G1 — PARTIAL

The disposed changes are largely present:

- Direct identifier, property access, string-literal element access, `.call`, and `.apply` sites are recognized in [index.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19642).
- Own-package imports are realpath-resolved and followed through direct re-exports in [index.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19430).
- Unverified direct builder bindings refuse, while table positions require literals or proven schema-table bindings in [index.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19676).
- The returned carrier is recursively frozen in [define.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/define.mjs:3515), with mutation coverage in [graph-query.test.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.test.mjs:538).
- Element access, call/apply, re-export, unknown-source, and table-alias tests exist beginning at [graph-query.test.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.test.mjs:676).

MATERIAL: a local alias of the genuine builder is not treated as a builder site. `resolveLocal` returns local variables without following their initializer at [index.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19540), while `builderTarget` accepts an identifier only when it is literally named `defineGraphQuery` or directly resolves to an own export at [index.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19649).

Consequently this bypasses the literal-grammar walk:

```js
import * as graphDsl from "@expo/snapback-codegen/define";
const dgq = graphDsl.defineGraphQuery;
const nodes = condition ? left : right;
export const q = dgq({ nodes, /* ... */ });
```

The collector ignores `dgq(...)` at [index.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19823), and runtime preflight cannot reconstruct the conditional construction after evaluation. This permits a source-stage `SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION` bypass.

Fix: recursively resolve immutable local identifier/property/element aliases to their import provenance, including multi-hop aliases, and add dynamic local-alias tests for ordinary invocation plus `.call`/`.apply`.

### G2 — PARTIAL

The round-two validator now mirrors the principal B1 aggregates and formulas:

- Safe arithmetic and factors: [graph-query.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:458)
- `maxArgumentItems`: [graph-query.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:586)
- Population and physical formulas: [graph-query.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:642)
- Window rollups: [graph-query.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:782)
- Explicit argument-total and scanned-row mismatch tests: [graph-query.test.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.test.mjs:288)

MATERIAL: JS still accepts nested graph-cost wire fields that B1 rejects. `defineGraphQuery` closes only the top-level graph-cost object at [define.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/define.mjs:3908). Normalization preserves unknown node and argument fields via copying/spreading at [graph-query.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:417), and the codegen schema check is shallow at [index.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:1915). B1’s nested cost records use `deny_unknown_fields` at [graph.rs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-types/src/manifest/graph.rs:1032).

An in-memory probe adding `unexpectedCostField` to `queryCost.graph.nodes[0]` was accepted and hashed by JS. The corresponding B1 manifest deserialization refuses it. Thus JS-accepts ⇔ B1-admits is false.

Exact reason parity is also incomplete: an unsafe integer in a whole-query bound refuses as `SNAPBACK_GRAPH_ARGUMENT_UNBOUND` through [define.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/define.mjs:3530), while B1 returns `SNAPBACK_GRAPH_BOUND_INVALID` at [graph.rs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-types/src/manifest/graph.rs:3411).

Fix: close or reconstruct every nested graph-cost wire record exactly as B1 does, align unsafe-bound reasons, and replay one frozen acceptance/refusal corpus byte-for-byte in both JS and Rust. The current positive equality assertion at [graph-query.test.mjs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.test.mjs:585) does not establish full admission parity.

### Direct answers

1. Yes. A nested unknown graph-cost field can pass `defineGraphQuery` and codegen while producing a manifest B1 refuses.
2. Yes. The `ephemeral.rs` change is exactly a digest resynchronization: two embedded hash strings and their frozen canonical digest changed at [ephemeral.rs](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-sync/src/ephemeral.rs:796); no schema or behavior changed.
3. The weakest seam is the duplicated JS↔Rust admission boundary. B2 hand-mirrors B1’s closed wire types, normalization, formulas, and primary reasons, but lacks a shared negative corpus. Happy-path hash equality therefore misses precisely the failures above: source constructs omitted by the AST proof and nested wire shapes accepted by JS but rejected by Rust.

No additional MATERIAL was found in JCS number formatting, authority-class derivation, broadcast emission, scope, or diagnostics/inventories. B2 remains query-shaped-only, and HEAD does not change the evaluator, matcher, B1 types, or Zerobugs corpus. `check-inventories` and `ref-check --verbose` passed. The targeted Node test could not start because the read-only sandbox rejected its temporary-directory creation with `EPERM`.

VERDICT: NOT READY (2 MATERIAL)

## r4 — fix round 3 (targeted codex; grok READY r3)

Covered alias spellings — PASS: const/multi-hop provenance and alias `.call` are recognized; mutable, computed-name, comma-callee, and `call.call` forms refuse in [graph-query.test.mjs:810](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.test.mjs:810), [graph-query.test.mjs:846](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.test.mjs:846), and [graph-query.test.mjs:850](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.test.mjs:850).

Nested cost records — PASS: node, argument, and window records are closed during authoring at [define.mjs:3926](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/define.mjs:3926) and normalization at [graph-query.mjs:70](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:70), matching Rust’s `deny_unknown_fields` records at [graph.rs:1032](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-types/src/manifest/graph.rs:1032).

Unsafe-bound reason — PASS: unsafe `bounds`/`queryCost` integers now produce `SNAPBACK_GRAPH_BOUND_INVALID` at [define.mjs:3542](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/define.mjs:3542) and [graph-query.mjs:56](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.mjs:56).

Shared parity corpus — PASS: all 11 cases are frozen at [codegen-parity-corpus.v1.json:5](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/tests/conformance/graph/codegen-parity-corpus.v1.json:5); JS replays ten wire cases plus the `jsOnly` source case at [graph-query.test.mjs:602](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.test.mjs:602) and [graph-query.test.mjs:737](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.test.mjs:737); Rust replays the same non-`jsOnly` outcomes/reasons and explicitly skips `jsOnly` at [graph.rs:6297](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/crates/snapback-types/src/manifest/graph.rs:6297); independent JS replay and the fresh Rust test binary both passed.

No-new-hole check — MATERIAL: `function getBuilder() { return graphDsl.defineGraphQuery; } getBuilder()({ nodes: true ? […] : [] })` produces zero source faults and accepts the evaluated carrier; function declarations resolve at [index.mjs:19549](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19549) but `descriptorContainsBuilder` ignores non-variable declarations at [index.mjs:19695](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19695), bypassing the collector at [index.mjs:19948](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19948) and violating LLP 0209’s closed, non-data-dependent IR requirement at [LLP 0209:103](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/llp/0209-live-graph-profile.spec.md:103).

VERDICT: NOT READY (1 MATERIAL)

## r5 — fix round 4 allowance handshake (targeted codex)

1. Wrapper and double-loop invocations are runtime-refusal tested at [graph-query.test.mjs:877](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.test.mjs:877) and [graph-query.test.mjs:902](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/graph-query.test.mjs:902).
2. The nonce channel is lexical, unexported, and protected from dynamic discovery by disabled string/Wasm generation: [index.mjs:20745](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:20745), [index.mjs:20677](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:20677).
3. Positives remain covered, but allowances retain only each module’s proven-site count—not offsets—at [index.mjs:20154](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:20154) and [index.mjs:21020](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:21020).
4. MATERIAL: loop ancestors are not rejected at [index.mjs:19962](/Users/ccheever/projects/snapback/.claude/worktrees/g0-b/packages/snapback-codegen/index.mjs:19962), so a zero-iteration loop can mint a transferable module allowance that `getBuilder()(dynamicSpec)` consumes; skipped modules default-deny, but this same-module bypass remains.
VERDICT: NOT READY (1 MATERIAL)

## r6 — fix round 5 top-level-only minting (targeted codex)

1) Airtight: only direct source-file expression statements or exported top-level `const` initializers mint.
2) Both regressions require generation refusal and the specific AST-refusal diagnostic.
3) Existing positive forms remain admitted by the unchanged allowlisted shapes.
VERDICT: READY
