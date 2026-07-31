# LLP 0131 structured argument contracts review — Codex family


## Round 1 — 2026-07-31

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (`medium` per CLI banner)
**Date:** 2026-07-31
**Method:** fresh CLI runner, read-only sandbox, blind to this Spec's fable artifact
**Target SHA-256:** `e78bb47e953ae35cd5cd9c059870f1ddbe94bd93f72bfac36966247d137b6726`
**Status:** completed

## Verbatim review

## Overall assessment

LLP 0131 has the right architecture—one normalized recursive vocabulary, server-side pre-effect validation, and reference-not-respell for the Rust-owned search AST—but it is **NOT READY** under LLP 0130 SD-4.

The draft contains several material factual errors about `argsContractHash`, understates the re-key blast radius, leaves the descriptor’s authoritative round trip incomplete, and has unresolved capability, diagnostics, SchemaRef, replay, and acceptance boundaries. These are specification defects, not implementation details.

Provenance: Codex-family round-1 review, OpenAI/Codex runtime, 2026-07-31, independent document-and-code inspection, no redaction, and no `0131-*.fable.md` artifact read.

## Strengths

- The CV-4a/CV-5 scope split is faithful to LLP 0115 and the issue: arguments first, stored fields left to CV-4b.
- Treating ingress validation as an evidence addition—not client-side convenience—is exactly right.
- Validation is correctly placed before handler execution, plan execution, buffering, or settlement.
- The search design correctly keeps Rust as grammar owner and exports rather than respells its schema.
- The retained-settlement replay distinction is directionally sound: releasing already-retained output should not reinterpret historical input under a newer contract.
- The proposed LLP 0004 amendment is correctly deferred until acceptance rather than editing the parent RFC prematurely.
- Split Ledger and the search AST are good concrete conformance fixtures.

## Concerns

### 1. MATERIAL — The hash baseline and “no semantic consumer” claim are false

LLP 0131 says the current hash is computed over the bounds-blind `argDescriptors` form and therefore cannot see bounds ([0131 §descriptor](/Users/ccheever/projects/snapback/llp/0131-structured-argument-contracts.spec.md:127)). It is actually computed directly over `def.args` ([index.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:1942)), whose validator objects contain `resultOptions` with bounds ([define.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:203)). The provider descriptor is bounds-blind; the current hash input is not that descriptor.

The hash also has real semantic consumers:

- `implementationHash` directly includes `argsContractHash` ([index.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:4170)), so re-keying every args hash necessarily changes every implementation hash.
- `client.search()` compares it to a hard-coded request-contract digest ([client index.mjs](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:147)).
- React deployment identity includes it ([react-binding.mjs](/Users/ccheever/projects/snapback/packages/snapback-client/react-binding.mjs:125)).
- React store keys include it ([canonical-client-value.mjs](/Users/ccheever/projects/snapback/packages/snapback-client/canonical-client-value.mjs:225)).

Therefore “a diff, not a behavior change” and “`implementationHash` unaffected” ([0131 §Identity](/Users/ccheever/projects/snapback/llp/0131-structured-argument-contracts.spec.md:260)) are materially wrong.

Resolution: correct the baseline, inventory every consumer, state the compatibility/cache/search-reference consequences, and add old/new golden evidence. Either preserve compatible identities deliberately or document the re-key as an intentional whole-function identity migration. The search client’s hard-coded discriminator must be migrated explicitly.

### 2. MATERIAL — Descriptor authority and round-trip integrity are incomplete

The draft names `FunctionArgsContractV1`, but does not freeze its exact serialized form, object-field requiredness representation, legacy-alias normalization, relation-incarnation normalization, or manifest/schema field names.

More importantly, the Rust host currently only syntax-checks `argsContractHash`; unlike result contracts, it does not recompute it ([manifest.rs](/Users/ccheever/projects/snapback/src/manifest.rs:1546)). Adding a descriptor without requiring host-side recomputation permits descriptor/hash disagreement, corrupting diagnostics and implementation identity.

Resolution:

- Freeze the Rust-owned enum and JSON representation.
- Normalize `real`/`number`/`finiteReal`, relation incarnations, optional fields, literals, and every bound explicitly.
- Require load-time recomputation and exact comparison of the v2 hash.
- Reject missing descriptors, unknown node kinds, unknown registry entries, or descriptor/hash mismatch before activation.
- Add a complete node-by-node round-trip corpus through JS generation, committed manifest schema, Rust serde/load, inspect/provider/Contract projections, and generated references.
- Add tampered-manifest tests, not only hash-change fixtures.

### 3. MATERIAL — Capability gating weakens the universal ingress claim

The goals say every declared argument object, including scalars, is server-validated ([0131 §Goals](/Users/ccheever/projects/snapback/llp/0131-structured-argument-contracts.spec.md:51)). But only apps with structured or `SchemaRef` arguments require `args_contract_v1`; scalar-only apps may still deploy to a target with no seam ([0131 §Capability](/Users/ccheever/projects/snapback/llp/0131-structured-argument-contracts.spec.md:204)).

That makes the headline guarantee target- and shape-dependent, and no-argument functions on an incapable target also cannot enforce the closed empty root against extra properties.

Resolution: every function manifest using the new descriptor—or every freshly generated app—must require `args_contract_v1`, including scalar-only and empty argument roots. Otherwise narrow every universal claim and admit that scalar validation remains optional on incapable targets; that would not meet the commissioned evidence-addition bar.

### 4. MATERIAL — LLP 0073 ownership is unresolved, and search diagnostic behavior contradicts itself

LLP 0131 twice says LLP 0073 open question 12 is “resolved there,” but LLP 0073 still explicitly marks it Open ([0073 OQ12](/Users/ccheever/projects/snapback/llp/0073-portable-full-text-search.rfc.md:904)). CV-5’s commissioned work requires resolving that carrier-scope question.

The diagnostic contract is also contradictory:

- The generic failure rule says every descriptor violation emits `SNAPBACK_FUNCTION_ARGS_CONTRACT_VIOLATION`.
- The diagnostics table says search retains `SNAPBACK_SEARCH_QUERY_INVALID`.
- Current search deserialization discards the serde error and emits the search code ([sqlite.rs](/Users/ccheever/projects/snapback/src/search/sqlite.rs:1625)).

Resolution: amend LLP 0073 in the same landing and choose the carrier ownership. Then define the diagnostic layering precisely—for example, root/scalar request-contract violations use the generic code while `SchemaRef` delegates structural and semantic query failures to the search code, or vice versa. Specify how the path is preserved through wrapping.

Also use LLP 0108’s bounded RFC 6901 JSON Pointer rules, including unknown-key hashing and truncation, rather than the currently illustrated `$...` JSONPath syntax ([0108 diagnostics](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:542)).

### 5. MATERIAL — `SchemaRef` does not leave option E genuinely open as claimed

The v1 node means “closed platform-owned Rust-schema registry,” and hashes only its stable id. Option E’s documented semantics require app-schema evolution to produce visible contract-hash churn. Reusing this node unchanged for `v.doc("cards")` would not witness a table-schema change unless the app schema id changed on every revision, which is not option E’s proposed spelling or behavior.

Resolution: either:

- name the v1 node `PlatformSchemaRef` and state that option E will require a distinct expanded/digest-carrying node; or
- give `SchemaRef` an explicit authority class and semantic-schema digest/version, with different hashing rules for platform-versioned and app-schema references.

Also specify a single closed registry mapping each id to both its exported artifact definition and its runtime validator, with load-time refusal for absent or mismatched pairs.

### 6. MATERIAL — Replay taxonomy is too ambiguous

The retained-result rule is correct relative to LLP 0108: already-retained output is released without rerunning the handler. But LLP 0008 separately pins offline replay as `function + args + environment` against fresh server state ([0008 replay](/Users/ccheever/projects/snapback/llp/0008-local-first-sync-and-realtime.rfc.md:318)). That is a fresh server execution and must pass current ingress validation before handler execution.

The “every fresh invocation” lane list does not explicitly name offline-outbox replay, while the following paragraph broadly says replay does not revalidate. That wording is easy to implement incorrectly.

Resolution: distinguish three cases normatively:

1. Offline queued mutation execution: fresh invocation, must validate.
2. Retained settlement lookup/release: no input revalidation and no handler.
3. Durable-job execution: enqueue validates canonical bytes against the pinned artifact; execution/retry follows LLP 0070, while successor/operator replay revalidates its migrated args under the newly admitted artifact.

Add acceptance cases for all three. LLP 0070 already requires canonical validator-checked argument bytes at enqueue ([0070](/Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:69)).

### 7. MATERIAL — The diagnostics set contains an uncommissioned, unresolved policy decision

The two clarifications for `FUNCTION_INVALID_VALIDATOR` and `SCHEMA_INVALID_VALIDATOR` are sound. The search clarification is unresolved as above.

`SNAPBACK_FUNCTION_ARGS_CONTRACT_DEGRADED` is new scope. The ticket says the `v.json()` escape is already loud; it does not commission a new diagnostic. The table assigns it `info` severity while immediately saying severity is undecided. LLP 0130 SD-1 and CV-6 concern omitted result contracts, not arbitrary argument JSON, so they do not supply authority for this policy.

Resolution: remove/defer this diagnostic, or explicitly own its emission, deduplication with provider degradation, severity, remediation, exemptions, and acceptance test. It cannot simultaneously be normative `info` and undecided.

### 8. MATERIAL — Acceptance is not yet sufficient or fully adjudicated

Open question 3 leaves the 1 MiB complete-args ceiling “proposed” and calls for measurement, but acceptance contains no hot-path budget. The 64 KiB live frame fact is correct ([server.rs](/Users/ccheever/projects/snapback/src/server.rs:5882)), but it does not settle HTTP/direct/scheduled admission cost.

Acceptance also lacks:

- deployment refusal for scalar-only functions on incapable targets;
- complete descriptor serialization and hash recomputation;
- unknown `SchemaRef` and registry/artifact mismatch refusal;
- edge and one-over tests for depth, node, array, object-field, string/JSON, and total-byte limits;
- union deterministic-failure behavior and bounded/redacted paths;
- every ingress lane and evaluator;
- offline replay, retained settlement replay, and scheduled enqueue distinctions;
- the implementation-hash/search-client/cache blast-radius migration;
- diagnostic-code stability across generic and search lanes.

Resolution: decide the normative ceiling or define a preregistered measured gate with a fixed fallback, then expand acceptance to cover the full evidence graph. A Draft that says open questions 1–3 must be adjudicated before implementation cannot satisfy SD-4 while questions 2 and 3 remain open.

### 9. MINOR — LLP 0004 succession should explicitly correct the old pointer

The proposed appendix timing is correct. However, LLP 0004’s 2026-07-30 pointer says the value-expression IR operates over scalar argument references ([0004](/Users/ccheever/projects/snapback/llp/0004-application-data-api.rfc.md:621)); LLP 0131 correctly finds that whole args and path lookups already carry structured JSON.

Resolution: the accepted dated alignment should explicitly say it supersedes the deferred pointer and corrects that scalar-reference statement. This avoids leaving two dated parent statements that appear simultaneously normative.

## Suggestions

- Rename the serialized root or explain why `FunctionArgsContractV1` uses a `function-args:v2` hash domain.
- Add a carrier matrix covering authored validator, normalized descriptor, manifest JSON, Rust enum, hash, operation JSON Schema, TypeScript, provider, Contract, inspect, search registry, and durable-job artifact.
- State that the shared corpus is structural where it exercises serde/JSON Schema/TypeScript. Search’s index-specific semantic constraints—declared fields, analyzer results, prefix limits—cannot generally be represented by the exported generic request schema and remain LLP 0073 runtime validation.
- Freeze JCS golden vectors that include finite-real bounds and numeric literals; the text’s claim that the value domain contains only safe integers is inaccurate.
- Make legacy spellings aliases into the normalized node vocabulary, not additional descriptor node kinds.

## Open questions

My recommended dispositions are:

1. **One grammar:** accept one normalized `ResultValueV1`-class node vocabulary for argument values, with explicitly normalized legacy aliases.
2. **Option E:** keep it open by separating platform schema references from app-schema expansion, unless the node gains an authority class and semantic digest.
3. **Ingress budget:** retain 1 MiB only if a preregistered hot-mutation benchmark passes; otherwise choose a measured lower profile maximum. Transport limits may remain lower.
4. **Provider carrier:** decide in LLP 0073 now. The provider/operation projection should at minimum be verified against the exported artifact; Contract may remain a downstream surface with explicit GAP behavior.
5. **Scheduled execution:** validate at enqueue and pin the admitted validator/artifact; retries trust immutable validated bytes; successor replay revalidates.
6. **Offline replay:** classify it explicitly as a fresh invocation and validate before handler execution.

## Verdict

**NOT READY**

The draft does not meet LLP 0130 SD-4’s zero-unresolved-MATERIAL condition and currently contains claims directly contradicted by the code.

## Recommended next step

Revise LLP 0131 to resolve the hash/identity facts first, then close descriptor authority, capability gating, search ownership/diagnostics, SchemaRef/option-E semantics, replay taxonomy, and acceptance. Amend LLP 0073 OQ12 in the same proposed landing. After those changes, commission Codex-family round-1 re-review before seeking dual-family READY.

The LLP review artifact should be recorded as `llp/reviews/0131-structured-argument-contracts.codex.md`; this read-only session could not create it.
