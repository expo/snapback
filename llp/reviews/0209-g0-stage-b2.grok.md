# LLP 0209 G0 Stage B2 — grok review record

**Change:** defineGraphQuery authoring + JS lowering/normalization + source-stage refusals + JS<->Rust parity (landed on main as the series ending `4627f9d95`, 2026-08-23)
**Reviewer:** grok-4.6, xhigh (targeted rounds at high/xhigh), read-only, blind to the other family on full rounds
**Orchestrator:** Claude Fable 5 (session snapback-44), under `issues/20260823-llp0209-g0-commission.md`
**Provenance:** every review below was actually received from the named model; verbatim text per round.

## Verdict ledger

| Round | Reviewed | Verdict |
| --- | --- | --- |
| r1 | B2 source (d7403d637 pre-rebase) | VERDICT: NOT READY (2 MATERIAL) |
| r2 | fix round 1 | VERDICT: NOT READY (1 MATERIAL) |
| r3 | fix round 2 | VERDICT: READY |
| r4 | fix round 3 (targeted codex; grok READY r3) | (not run — READY standing from r3) |
| r5 | fix round 4 allowance handshake (targeted codex) | (not run — READY standing from r3) |
| r6 | fix round 5 top-level-only minting (targeted codex) | (not run — READY standing from r3) |

## r1 — B2 source (d7403d637 pre-rebase)

I'll review LLP 0209 G0 Stage B2 against the v0.5 contract and the landed B1 host. First I'll load the review skill and the source commit, then read the spec and the files that commit actually touches.HEAD is regeneration only; B2 lives in `HEAD~1`. Next I’ll read the spec and the files that commit actually changed.I’ll pull the spec sections that bind B2 and the authoring/lowering sources in parallel.Next I’ll compare the JS hasher and refusals with the B1 Rust host, then inspect `define.mjs` and the admission path.I’ll inspect `canonicalJson`, the `defineGraphQuery` authoring path, and the Rust JCS/hash implementations next.The JS hasher uses `JSON.stringify`, not the shipped JCS. I’ll compare that to the Rust host and keep tracing admission, authority, and source-stage refusals.Integer-key objects diverge under `JSON.stringify` versus JCS; numbers do not. Next I’ll run the targeted tests and confirm the source-stage bypass.B2’s lowering, query-shaped-only emission, and frozen-vector replay are in good shape. Two hasher/source-stage holes still let admissible authoring disagree with the B1 host.

`HEAD` is regeneration only. `graph-query.test.mjs` passed (including Rust admission of the one injected fixture). `graph_collection_arguments_contribute_to_max_argument_items_once` passed.

## MATERIAL

### 1. (a) Plan identity is not RFC 8785 JCS — integer-index object keys diverge from the B1 host

`graph-query.mjs` hashes and JCS-sorts with `canonicalJson` from `result-contracts.mjs`, which is **sorted-key `JSON.stringify`**, not the shipped JCS used by B1 `domain_hash` / `rqs_contract::jcs` / `packages/snapback-client/rqs.mjs`.

```3:33:packages/snapback-codegen/graph-query.mjs
import { canonicalJson } from './result-contracts.mjs';
// ...
const compareJcs = (left, right) => Buffer.compare(
  Buffer.from(canonicalJson(left), 'utf8'),
  Buffer.from(canonicalJson(right), 'utf8'),
);
export function graphDomainHash(domain, value) {
  return `sha256:${createHash('sha256').update(domain).update(canonicalJson(value)).digest('hex')}`;
}
```

```21:31:packages/snapback-codegen/result-contracts.mjs
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};
export const canonicalJson = (value) => JSON.stringify(canonicalize(value));
```

Spec §2.4 rule 3 requires RFC 8785 JCS via the shipped `domain_hash` path. After `Object.fromEntries(sortedKeys)`, `JSON.stringify` re-emits **integer-index keys in numeric order** (`"2"` then `"10"`). RFC 8785 / `rqs.mjs` `jcs` keeps UTF-16 order (`"10"` then `"2"`).

Measured on this tree with Node 24.18.0:

| payload | `canonicalJson` | `rqs.mjs` `jcs` |
| --- | --- | --- |
| `{ "10": true, "2": false }` | `{"2":false,"10":true}` | `{"10":true,"2":false}` |
| `{ field, op, value: { Literal: { "10": true, "2": false } } }` | Literal keys `"2"`,`"10"` | `"10"`,`"2"` |
| `0.1`, `1e-7`, `1e21`, `-0`, U+2028, U+10000 keys | match | match |

`ValueExpr::Literal` is `serde_json::Value`; B1 admits any `canonical_client_value_is_valid` object (`graph.rs` ~4211). `lit({ 10: true, 2: false })` and literal-page keyset objects are therefore admissible authored inputs. For those, JS `planHash` ≠ host `graph_domain_hash`, so `validate_graph_query_carrier_v1` returns `SNAPBACK_GRAPH_PLAN_IDENTITY_MISMATCH` after codegen reported success. The same bytes also feed filter/visibility/event-selector **sort keys** (`compareJcs`), so normalization order can diverge too.

The frozen vectors never contain integer-index object keys, so the suite stays green.

**Fix:** Hash and sort with the same RFC 8785 implementation as B1 (`rqs.mjs` `jcs` / `rqs_contract::jcs`), not `JSON.stringify`. Add a vector with integer-index keys inside a filter `Literal` / keyset object and require JS hash == Rust hash.

---

### 2. (b) Source-stage `DYNAMIC_CONSTRUCTION` can be skipped; the evaluated shape still lowers

AST enforcement is `validateGraphAuthoringSource` (`index.mjs` ~19421). It does not cover the register it claims to own:

- **Entry file only.** `if (!source.includes('defineGraphQuery')) return` (~19422). Familiar barrels and `export { q } from './graphs.mjs'` never contain the call. Imported modules are not walked.
- **Identifier callees only** (~19476–19478). `codegen.defineGraphQuery({...})` / `ns.defineGraphQuery({...})` are never collected.
- **Shorthand / computed keys skipped.** Non-`PropertyAssignment` is `continue` (~19533); computed names return `null` from `propertyName` (~19460–19463) and are not inspected. The suite refuses `nodes: graphNodes` (`graph-query.test.mjs` ~528–534) but `{ nodes, projection, ... }` with `const nodes = cond ? a : b` is not seen.
- **`NewExpression` is not dynamic.** `lit(new Date())` is not a `CallExpression`, so ambient time is not `CODE_FORBIDDEN` at AST. Runtime `graphSourcePreflight` (`define.mjs` ~3515) walks the already-constructed `Date` (no enumerable own keys, not a function) and lets `JSON.stringify` bake an ISO timestamp into the plan.

Runtime preflight **does** catch functions, getters, cycles, and `__expr` outside `filters[N].value`. It cannot see a ternary that already evaluated to plain data. That is exactly §2.3 row 4, and that shape reaches `compileGraphQueryV1`.

**Fix:** Walk every definition module, not the entry string; treat property-access callees; inspect shorthand/computed keys; treat `NewExpression` like other construction; fail closed if the spec is not a syntactic object/array literal.

---

## MINOR

1. **`graph_codegen_admission` skip-passes without env** — `crates/snapback-types/tests/graph_codegen_admission.rs:5-8`. Bare `cargo test -p snapback-types --test graph_codegen_admission` is green without checking any manifest. The JS suite injects `SNAPBACK_GRAPH_CODEGEN_MANIFEST`; CI that only runs crate tests does not. Fail instead of skip, or do not register a skip-pass as a host-admission proof.

2. **Authoring surface is wider than B1 admission** — `GRAPH_DATA_NODE_KINDS` includes `search-membership` (`define.mjs:3470-3473`); B1 always returns `SearchUnadmitted` (`graph.rs:4089-4092`). Codegen can succeed; the host never admits it. Same class of gap: JS does not run the B1 analytical cost function, index proofs, or §2.1 projection-scope rules (bare to-one `field` vs required `object` wrapper). DK-7 schema checks are not that predicate.

3. **Unicode filter-sort comment is wrong** — `graph-query.test.mjs:289`. Order `U+E000` then `U+10000` is JCS UTF-8 bytes of the whole filter, not `String::cmp`. Harmless here (those two scalars agree), but it documents the wrong comparator.

4. **`maxArgumentItems` “fix” is a refactor plus a test** — B1 already added `cost.max_items` once in the `Array` arm and `1` otherwise. Behavior is now correct (3+5=8 admits, 7 refuses). The commit does not change the counting rule.

5. **Duplicate diagnostics early-return** — `index.mjs:2360-2365` repeats the same `if (diagnostics.some(...error)) return`.

---

## REFUTED-RISK

- **(c) Class 1 for principal/partition-dependent nodes.** `principal-bound` is forced to 3 (`graph-query.mjs:451`). Owner visibility is 3. Membership without a requested class-2 proof is 3. `permissionBacking: true` upgrades a public-read local class off 1 (`462-463`). Parent class is `Math.max`’d in (`515-518`). Projection class is the roll-up and cannot be authored lower (`548-551`). Search cert class is trusted, but B1 refuses every search node before it can be an admitted class-1 graph.
- **(d) Broadcast certificate emission.** `GraphQuerySpec.broadcast` is only `{ classification: 'query-shaped' }` (`define.d.ts:1196`). `assertKnownSpecFields` allows only `classification` (`define.mjs:3866`). `compileGraphQueryV1` throws `SNAPBACK_GRAPH_BROADCAST_SEPARATION_UNPROVABLE` unless query-shaped (`graph-query.mjs:486-490`) and then writes the query-shaped arm (`605-609`).
- **(e) `maxArgumentItems` still double-counts.** Current loop (`graph.rs:3432-3458`) adds each argument once (`Array` → `cost.max_items`, else `1`). Test `graph_collection_arguments_contribute_to_max_argument_items_once` passed.
- **(f) Scope creep.** B1 `graph.rs` change is the named counting test/refactor. `ephemeral.rs` is digest strings. `effect-ceiling.mjs` adds a `GraphQuery` read/auth walk. Familiar disposition 4, capability id, inventory 330→331, `graph-query.mjs` on the package files list. No matcher, evaluator, or Zerobugs corpus edits in `HEAD~1`.
- **(g) Frozen vectors not replayed.** `graph-query.test.mjs:31-164` loads `tests/conformance/graph/identity-vectors.v1.json` and `minimal-carrier.v1.json`, asserts JS `planHash` and the other five domain hashes (plus one-axis rotations) equal the B1 file, and asserts `GRAPH_IDENTITY_DOMAINS` equals the vector domains. That is a byte-for-byte replay of those payloads. It does not cover the JCS-divergent payloads in MATERIAL 1.
- **Classic float-formatting split.** `JSON.stringify` and RFC 8785 both use ES `Number.toString`. `0.1` / `1e-7` / `1e21` / `-0` match `rqs.mjs` `jcs` on this Node.

---

## Required answers

**(i) Can `defineGraphQuery` emit a manifest the B1 host refuses while codegen reports success?**  
Yes. Two different kinds: (1) **valid graphs whose JS hash is not JCS** (MATERIAL 1) — host `PlanIdentityMismatch`; (2) **graphs JS never runs through `validate_graph_query_plan_v1`** — search-membership (always `SearchUnadmitted`), author-supplied physical costs/window rollups that fail the unique analytical function, missing indexes, empty optional filters that slipped past, projection scope (bare to-one fields). The e2e path only proves one permission-backed `issueGraph` fixture, injected with `testHooks.capabilityManifest`. DK-7 is schema-shaped, not B1 admission.

**(ii) Is `ephemeral.rs` exactly a digest resync?**  
Yes. `HEAD~1` only changes `inputsHash`, `schemaHash`, and `CODEGEN_MEMBERSHIP_SCHEMA_MANIFEST_CANONICAL_SHA256` (and the matching constant in `authoring-validation.test.mjs`). No collection/table/semantic edits. Expected once `defineGraphQuery` / package file lists enter codegen inputs.

**(iii) Weakest seam**  
B2 identity is a `JSON.stringify` look-alike sitting next to a real JCS implementation the host already uses, and compile never evaluates the B1 admission predicate. Agreement is therefore “the frozen camelCase/integer carrier plus one fixture hashed the same,” not “every admissible authored graph is host-reconstructible.” Source-stage AST is a second seam: it is what makes rows 1–4 source-stage, and it only sees identifier calls with inline (non-shorthand) literals in the functions entry file.

---

**Fix-before-ready:** switch `graphDomainHash` / `compareJcs` / `contentIdentity` to RFC 8785 JCS and add an integer-index-key vector; close the AST walker so dynamic construction cannot lower.

VERDICT: NOT READY (2 MATERIAL)

## r2 — fix round 1

I'll start by reading the review skill and the round-1 fix commits so the check is against the actual delta, not just the disposition notes.Next I’ll pull the review skill, the full fix-round diff, and the LLP 0209 sections the dispositions had to satisfy.The review skill is the PR-comment workflow, not this LLP fix-round. I’ll inspect the B2 sources, the round-1 delta, and the spec constraints directly.I’ll read the JCS, source-gate, search, and authority-class paths next, plus the B1 rqs semantics they claim to match.I’ll inspect the Rust JCS implementation, the source-gate call site, maxArgumentItems, and the ephemeral digest change next.JS suite passed. Next I’ll run the targeted Rust graph identity and admission tests.The JS suite, frozen identity vectors, once-count `maxArgumentItems` test, and full-engine admission seam all passed. Checking one source-gate edge so the leftover hole is cited from the actual `ownCallee` path, not a guess.Fix round 1 of LLP 0209 G0 Stage B2 lands the JCS switch, the listed source-gate mechanics, register order, search refusal, and the frozen full-seam vector. Targeted tests passed: `graph-query.test.mjs`, `graph_plan_identity_v1_frozen_positive_and_axis_rotations` (including `jcsBoundary`), `graph_collection_arguments_contribute_to_max_argument_items_once`, and `codegen_emitted_manifest_full_engine_admission_seam`.

One source-stage hole remains: `DYNAMIC_CONSTRUCTION` still reaches lowering when the builder call is not a direct Identifier / `.defineGraphQuery` PropertyAccess of an own-package import.

---

## Round-1 dispositions

### F1 — FIXED

The graph hasher is no longer `result-contracts.mjs` `JSON.stringify` after `Object.keys().sort()`. `graphCanonicalJson` is a dependency-local RFC 8785 mirror of `packages/snapback-client/rqs.mjs`: UTF-16 key order (`graph-query.mjs:110`), ES `Number::toString` (`graph-query.mjs:66-74`), `-0` → `"0"`, unsafe-integer band, non-finite, and lone-surrogate refusals. Integer-index keys are serialized in UTF-16 order as a string, so they cannot be reordered the way a rebuilt JS object plus `JSON.stringify` would (`{"10":true,"2":false}` stays that spelling).

Authoring enforces the same primitive refusals before hashing (`define.mjs:3515-3531`, `3534-3546`). Cross-language vectors live in `tests/conformance/graph/identity-vectors.v1.json:3-74` (`integer-index-key-nesting`, unsafe ±2^53, `1e21`/`1e-7`, `-0`, U+2028/U+2029, astral-key UTF-16 order, lone surrogate, `Infinity`). JS asserts byte-equality with `rqs.mjs` (`graph-query.test.mjs:31-51`); Rust asserts `rqs_contract::jcs` / `ecma_number_string` (`graph.rs:5482-5516`). Frozen B1 plan hashes still match after the switch.

### F2 — FIXED

The listed mechanics are in the tree:

| Disposition | Evidence |
|---|---|
| Walk every definition-graph module, no `includes()` | `index.mjs:2382-2393`, `19664-19678` |
| Property-access callees | `ownCallee` Identifier + namespace `.defineGraphQuery` (`index.mjs:19493-19518`) |
| Shorthand / computed keys | `index.mjs:19623-19633` |
| `NewExpression` / non-literals | `index.mjs:19565-19571`, `19647-19657` |
| Syntactic literal tree | fallthrough at `index.mjs:19657` |
| Helpers resolve to codegen’s own `define` binding | `graphImportResolvesToOwnDefine` (`index.mjs:19425-19447`) |
| Runtime preflight descriptor-only, plain prototypes | `define.mjs:3534-3586` (`TABLE` symbol, no getter invoke, no `fieldType`/`__table` string skip) |

The fixture is a re-export plus `import * as graphDsl` (`tests/conformance/graph/codegen-fixture/functions.mjs`, `issue-graph.mjs:1-4`). Leftover builder-recognition holes are a new MATERIAL, not a missed bullet.

### F3 — FIXED

Source faults are a per-code `Map` (`index.mjs:19535-19538`) emitted in §2.3 order (`GRAPH_SOURCE_FAULT_ORDER` at `index.mjs:19418-19423`, sort at `19680-19688`). Multi-fault test expects `CLIENT_AST_FORBIDDEN`, then `CODE_FORBIDDEN`, then `DYNAMIC_CONSTRUCTION` (`graph-query.test.mjs:658-679`).

Unknown parent is `SNAPBACK_GRAPH_PARENT_INVALID` before the authority while-loop (`graph-query.mjs:628-633` vs `638-675`; test `graph-query.test.mjs:267-289`).

### F4 — FIXED

`search-membership` refuses at authoring (`define.mjs:3741-3746`) and again in `compileGraphQueryV1` (`graph-query.mjs:622-627`). `localAuthorityClass` (`graph-query.mjs:569-582`) never reads `membershipIdentity`. Direct `defineGraphQuery` and `generateInProcess` both expect `SNAPBACK_GRAPH_SEARCH_UNADMITTED` and no published manifest (`graph-query.test.mjs:485-502`, `596-610`).

### F5 — FIXED

`crates/snapback-types/tests/graph_codegen_admission.rs` (env-skip `SNAPBACK_GRAPH_CODEGEN_MANIFEST`) is deleted. The committed vector `tests/conformance/graph/codegen-emitted-manifest.v1.json` is admitted by production `validate_graph_query_admission` (same helper as `engine.rs:8387`). One-axis negative: rename projection field → `SNAPBACK_GRAPH_RESULT_CONTRACT_MISMATCH` (`engine.rs:125-162`). JS regenerates in a temp tree and byte-compares (`graph-query.test.mjs:507-545`). `maxArgumentItems: 8` is 5+3 once; host `graph_collection_arguments_contribute_to_max_argument_items_once` still passes.

### MINOR — FIXED

- Blank-line / stray file: env-skip test file removed.
- Comparator / end-to-end comment: rewritten to the frozen-vector claim (`graph-query.test.mjs:507-511`); comparator generated hashes moved with codegen identity.
- Duplicate early-return: first-fault `if (fault || !node) return` / `if (fault) break` is gone; faults accumulate in the Map.

---

## New MATERIAL

### M1 — `DYNAMIC_CONSTRUCTION` still reaches lowering when the builder call is not a direct own-package Identifier / PropertyAccess

**Severity:** MATERIAL (b)  
**File:** `packages/snapback-codegen/index.mjs:19493-19518` (`ownCallee`), `19540-19548` (`collect`)

`collect` only walks CallExpressions whose callee `ownCallee` classifies as `builder`. That is only:

- an Identifier imported as `defineGraphQuery` from a specifier whose realpath is codegen `define.mjs`
- `ns.defineGraphQuery` where `ns` is a namespace import of that same binding

It returns `null` for:

- `const dsl = graphDsl; dsl.defineGraphQuery(...)` (PropertyAccess whose object is not the imported namespace id)
- `graphDsl['defineGraphQuery'](...)` (ElementAccessExpression)
- `import { defineGraphQuery } from './reexport.mjs'` (specifier does not realpath to `define.mjs`)
- `.call` / `.apply`

Those calls are never `inspect`ed. Runtime preflight (`define.mjs:3534-3586`) walks the **evaluated** object: a ternary `nodes: cond ? [rootA] : [rootB]` is already a concrete array, so `DYNAMIC_CONSTRUCTION` does not fire. `compileGraphQueryV1` then lowers it (`graph-query.mjs:603-741`). Callbacks still die at preflight (`CODE_FORBIDDEN`); this hole is specifically register row 4.

The suite aliases a **helper** (`fakeDsl.desc` → `DYNAMIC_CONSTRUCTION`, `graph-query.test.mjs:654-656`) but still calls `graphDsl.defineGraphQuery`, so the builder is recognized. It never aliases the builder.

**Fix:** Treat every CallExpression whose callee is Identifier `defineGraphQuery` or PropertyAccess/ElementAccess (string literal) `.defineGraphQuery` / `['defineGraphQuery']` as a graph builder and inspect it (or refuse the binding if it is not the own-package define). Do not skip unknown `defineGraphQuery` imports. Add a generateInProcess case: `const dsl = graphDsl; dsl.defineGraphQuery({ nodes: true ? [...] : [...], ... })` must be `SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION`.

Related (same seam, not a second finding): `defineGraphQuery` returns a mutable `graphQuerySource` (`define.mjs:3923-3938`). A later statement in the same module can `push` a node that was never in the literal. Deep-freeze the carrier if the AST walk is meant to be the last word.

---

## Contract checks (a)–(h)

| Axis | Result |
|---|---|
| (a) JS/Rust hash divergence | **Not found on admissible input.** Numbers use ES `String(value)` / `ecma_number_string`, not `JSON.stringify` of a rebuilt object. Boundary vectors plus frozen B1 hashes pass on both arms. Extra JS refusals (non-plain prototype, holes, accessors) are fail-closed, not a different spelling. |
| (b) Source-stage bypass | **M1** — `DYNAMIC_CONSTRUCTION` only. Callbacks still fail closed at preflight. |
| (c) Class 1 for principal/partition-dependent | **Not found.** `principal-bound` is 3 (`graph-query.mjs:570`). Policy inputs raise class 1 (`579-580`). Search never reaches derivation. |
| (d) Broadcast certificate | **Impossible.** Non-`query-shaped` refuses (`graph-query.mjs:604-608`); emit is `{ classification: 'query-shaped', reason }` only (`734-738`). Extra broadcast fields are unknown at authoring (`define.mjs:3896`). |
| (e) `maxArgumentItems` | **Host counts each collection once** (`graph.rs:3429-3458`). Fixture 8 = 5+3. JS copies authored cost; it does not re-derive (see (i)). |
| (f) Scope creep | **Not in this delta.** Fix `graph.rs` is test-only JCS vectors. No evaluator/matcher/Zerobugs. `ephemeral.rs` is original B2, not round 1. |
| (g) Frozen B1 replay | **Holds.** JS identity block (`graph-query.test.mjs:54-192`) and Rust `graph_plan_identity_v1_frozen_*` both passed. |
| (h) Diagnostics/inventory | **No violation seen.** `SNAPBACK_GRAPH_SEARCH_UNADMITTED` / `ARGUMENT_UNBOUND` added to evaluator preserve-list (`index.mjs:20104-20118`); codes already exist in the B1 registry. HEAD regen is the usual projection refresh. |

---

## Required answers

**(i) Admission parity gap?** **Yes, for authored bounds the JS compiler copies rather than derives.** `compileGraphQueryV1` does `queryCost: copy(source.queryCost)` (`graph-query.mjs:726`). An otherwise-valid `defineGraphQuery` with `maxArgumentItems` ≠ the once-sum, or a wrong `windowRollup`, reports codegen success and then dies on the host as `SNAPBACK_GRAPH_BOUND_INVALID`. Search, callbacks, and broadcast certificates cannot take that path. The frozen vector **does** admit (`maxArgumentItems: 8`, engine test ok).

**(ii) `ephemeral.rs` digest?** **Yes — digest resync only, and not in this fix round.** The change is in `d7403d637`: `inputsHash`, `schemaHash`, and `CODEGEN_MEMBERSHIP_SCHEMA_MANIFEST_CANONICAL_SHA256` (`crates/snapback-sync/src/ephemeral.rs:796-899`). No ephemeral behavior. Round 1 does not touch that file.

**(iii) Weakest seam.** Source-stage `DYNAMIC_CONSTRUCTION` has no runtime equivalent and is still gated on recognizing the builder CallExpression as a direct own-package Identifier or `.defineGraphQuery` PropertyAccess. Walk-every-module and descriptor preflight are real, but a namespace alias or computed access skips `inspect`, the VM evaluates one branch, and lowering proceeds. The second-order gap is the same host/codegen split as (i): B2 copies `queryCost` and lets B1 be the analytical-function authority, so codegen success is not admission.

---

VERDICT: NOT READY (1 MATERIAL)

## r3 — fix round 2

I'll review the round-2 delta against the G1/G2 dispositions and LLP 0209, starting with the review skill, the spec, and the HEAD commit.HEAD is the round-2 delta. Next I’ll load the review skill, the spec sections that constrain B2, and the actual commit diff.The skill is a generic PR-review workflow; this is a spec-constrained G1/G2 delta review, so I’ll inspect the new builder resolver and JS cost-parity code against B1.The leftover `ownCallee` path looks suspicious. I'll read the rest of the source-gate walk and hunt for B2 review notes plus the `ephemeral.rs` digest change.Source-gate runs before evaluation. Next I’ll run the allowed JS and types-crate tests and check a few remaining parity seams.Checking one remaining G1 edge: whether `call`/`apply` on an owned identifier is actually accepted, and whether helper leftover can still mark a builder without `owned`.## Round-2 dispositions

**G1 — FIXED.** Every listed `defineGraphQuery` callee is now a builder site. `builderTarget` (`packages/snapback-codegen/index.mjs:19642`) treats identifier, property access, string-literal / no-substitution element access, and `.call`/`.apply` wrappers as builder sites. Proven bindings are walked through `resolveLocal` / `resolveExport` with `realpathSync` (`:19439`, `:19515`–`:19608`), including `export { defineGraphQuery } from '@expo/snapback-codegen/define'`. Unowned or unshadowed bindings refuse `SNAPBACK_GRAPH_DYNAMIC_CONSTRUCTION` (`:19835`) before the literal-grammar walk. `table` / `targetTable` identifiers pass only when `isDeclaredTableBinding` proves a `defineTable` initializer installed in `defineSchema` (`:19723`, `:19964`); other identifiers refuse. `defineGraphQuery` deep-freezes the returned carrier (`define.mjs:3517`, `:3938`). Tests cover element-access accept + conditional refuse (`graph-query.test.mjs:676`), `.call`/`.apply` (`:690`), namespace alias refuse (`:705`), re-export accept (`:713`), unknown-source refuse (`:732`), table alias refuse (`:745`), and frozen mutation (`:538`). `volta run --node 24.18.0 node --test packages/snapback-codegen/graph-query.test.mjs` passed.

**G2 — FIXED.** `validateGraphCostsV1` (`graph-query.mjs:571`) is wired into `graphPlanIdentityV1` (`:854`) and recomputes B1’s rank-0 cost function: collection arguments counted once (`:586`–`:611`, matching `graph.rs:3432`–`:3464`), parent population, physical formulas (root / to-one / to-many / exists direct+through / principal-bound / search), window subtree rollups, and `maxScannedRows` / `maxIndexRanges` / `windowRollup` exact-match (`:845`), all as `SNAPBACK_GRAPH_BOUND_INVALID`. Mismatch tests refuse that code (`graph-query.test.mjs:288`–`:301`). Frozen identity replay still passes (`:54`–`:64`); Rust `graph_collection_arguments_contribute_to_max_argument_items_once` and `graph_plan_identity_v1_frozen_positive_and_axis_rotations` passed. Round 2 did not change emitted graph-plan bytes — only `bundleHash` / `inputsHash` in `codegen-emitted-manifest.v1.json`.

No new MATERIAL. F1/F3/F4/F5 were not regressing in this delta (JCS, source-register order, search unauthorable, frozen seam still in the suite).

## New findings

None MATERIAL.

**REFUTED-RISK — computed / indirect invocation outside G1’s closed spelling set.** `graphDsl['define'+'GraphQuery']`, `(0, defineGraphQuery)(spec)`, and `Function.prototype.call.call(defineGraphQuery, …)` are not builder sites, so a ternary spec could skip the walk and still evaluate. G1 required identifier / any PropertyAccess / ElementAccess string literal / `.call`/`.apply`; those are fail-closed. Residual JS invocation is not the authoring surface.

**MINOR — leftover namespace builder arm is dead.** `ownCallee` still has `graphDsl.defineGraphQuery` → `{ kind: 'builder', name }` without `owned` (`index.mjs:19799`). `builderTarget` always returns first for that spelling; if it ever did not, `!binding.owned` would still refuse. Dead, fail-closed.

## Contract answers

**(i) Admission parity.** Not on the frozen suite. JS codegen byte-emits `codegen-emitted-manifest.v1.json`; the graph plan in that vector is unchanged this round; `graphPlanIdentityV1` now refuses the cost mismatches B1 refuses; identity hashes still match the Rust-owned corpus. In general JS identity is still **normalize + costs**, not a full twin of `validate_graph_query_plan_v1` (for example NodeInert: a to-one child omitted from the projection). That is a pre-existing B2 seam, not a round-2 regression, and not the G2 cost hole.

**(ii) `ephemeral.rs`.** Yes — digest resync only. `d7403d637` (B2 source, not this HEAD) changes three constants in `crates/snapback-sync/src/ephemeral.rs`: `inputsHash`, `schemaHash`, and `CODEGEN_MEMBERSHIP_SCHEMA_MANIFEST_CANONICAL_SHA256`. No control-flow or schema-table edits. Round 2 does not touch the file.

**(iii) Weakest remaining B2 seam.** The source gate is a spelling-enumerated callee recognizer that is now fail-closed on the G1 set, but it is not a taint analysis of every expression that could evaluate to the builder; JS `graphPlanIdentityV1` is a hand-ported cost twin on top of normalize, not B1’s full first-fault register. Codegen success is a rank-0 theorem only for the frozen fixture, not for every authored graph.

VERDICT: READY

## r4 — fix round 3 (targeted codex; grok READY r3)

(no grok run: grok was READY on the prior full round and the delta addressed only codex findings)

## r5 — fix round 4 allowance handshake (targeted codex)

(no grok run: grok was READY on the prior full round and the delta addressed only codex findings)

## r6 — fix round 5 top-level-only minting (targeted codex)

(no grok run: grok was READY on the prior full round and the delta addressed only codex findings)
