# Review artifact — LLP 0211, Codex family

Target: `llp/0211-typed-opaque-structured-stored-values.spec.md`

## Round 1 — 2026-08-09

**Provenance.** Reviewer: codex exec, model gpt-5.6-sol,
model_reasoning_effort=xhigh, read-only sandbox, repo-local capsule at
`0d951fa69`. Blindness: instruction-based, self-attested (repo-local run;
excluded-by-instruction: `llp/reviews/0211*`, scratchpad, run journals).
Orchestrator/reviser: Claude (Fable 5) — did not review. Revision under
review: `0d951fa69` (file sha256 prefix `7ea0615b656e3166`). Instruction
capsule sha256 prefix `98a817bfd8`. Verdict: **NOT READY**.

**Verbatim review body follows.**

---

Blindness self-attestation: I did not read review artifacts, journals, or the other family's output.

## Concerns
1. [MATERIAL] The stored grammar and outermost-node dispatch are not closed — The declaration admits the LLP 0131 recursive vocabulary while listing only asset/id references and top-level literal unions as exceptions (`llp/0211-typed-opaque-structured-stored-values.spec.md:130-146`). That is insufficient for codegen: the current vocabulary also contains `v.principal`, `v.json`, `v.vector`, `v.tuple`, and the protected `v.relationIncarnationOf` (`packages/snapback-codegen/define.mjs:336-363`, `packages/snapback-codegen/define.mjs:419-489`), and vector currently bypasses the position grammar entirely (`packages/snapback-codegen/index.mjs:6121-6136`). The “at any depth” wording would also literally reject existing top-level `AssetRef` and `Id` fields, although presumably only Structured interiors are meant. The Spec must define a closed dispatch table: after top-level optionality is removed, which nodes retain existing `FieldType`s, which outer nodes produce `FieldType::Structured`, and which nodes are legal in an interior. At minimum `v.relationIncarnationOf` must be explicitly refused inside Structured because it is framework-authored lifecycle state, not application data (`llp/0110-bounded-children-and-activity-patterns.spec.md:1024-1033`). Principal, raw `v.json`, vector, and tuple handling must likewise be decided rather than inferred by the implementation.

2. [MATERIAL] Object closure and nested optionality are contract decisions wrongly left open — Open questions 4 and 6 determine write acceptance, generated types, canonical contract identity, and migration validity (`llp/0211-typed-opaque-structured-stored-values.spec.md:333-344`). LLP 0131 normalizes optionality at object/root entries through `required: false` (`llp/0131-structured-argument-contracts.spec.md:233-239`), while its later ruling excludes explicit null from the agreed optional-property carrier (`llp/0131-structured-argument-contracts.spec.md:1058-1077`). The stored contract therefore cannot safely defer whether objects are closed or what `v.optional` means as an array element or union variant. The Spec should normatively pin closed objects and either restrict optionality to top-level/object-member entries, with omission meaning absence and `v.null()` spelling null, or fully define another representation across validation, hashing, and generated types.

3. [MATERIAL] The small-table `v.json()` conversion path contradicts the governing migration authority — LLP 0211 allows a “conservative activation-time scan” for small tables (`llp/0211-typed-opaque-structured-stored-values.spec.md:223-230`), but LLP 0007 explicitly requires the conservative applier to reject type changes that rewrite rows and routes every such change through LLP 0081 (`llp/0007-storage-portability.spec.md:682-691`, `llp/0007-storage-portability.spec.md:728-734`). LLP 0081 requires a reviewed plan for all non-additive changes and represents type changes through staged add/copy/validate/publish/retire operations (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:125-139`, `llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:346-360`, `llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:391-405`). Table size does not waive that authority. The Spec must remove the activation fast path or define and obtain an owner amendment with bounded, atomic, rollback-safe semantics. It must also pin the legal same-name conversion shape—successor generation or a genuinely new staged destination—rather than merely naming add/copy.

4. [MATERIAL] The encoding-identity split has no authoritative carrier — The Spec says the logical contract and `canonical-json-text.v1` have separate identities and relies on that split to make future re-encoding non-breaking (`llp/0211-typed-opaque-structured-stored-values.spec.md:150-165`, `llp/0211-typed-opaque-structured-stored-values.spec.md:237-245`), but it never says where the encoding identity is recorded or hashed. LLP 0007 requires a single-sourced physical mapping used by reader and writer (`llp/0007-storage-portability.spec.md:124-133`), while LLP 0081 derives its authoritative plan from exact predecessor and successor manifests/hashes (`llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:163-173`). If a future encoding changes behind an unchanged logical hash without a separately bound physical identity, the planner cannot detect, approve, or prove that migration. `TEXT` on every target is itself admissible under LLP 0004/0007; the defect is the missing manifest/storage-generation/migration carrier for its versioned identity.

5. [MATERIAL] Phase A does not yet define the complete observation and sync surface or a safe delivery bound — The Spec claims whole-value live delivery can ride unchanged machinery and that Phase A thereby supplies defined sync behavior (`llp/0211-typed-opaque-structured-stored-values.spec.md:189-200`, `llp/0211-typed-opaque-structured-stored-values.spec.md:261-274`), but the acceptance matrix covers only index/filter/order/search/matcher refusals (`llp/0211-typed-opaque-structured-stored-values.spec.md:288-291`). Current bounded-child and relational projections deliberately admit only portable scalar leaves (`packages/snapback-codegen/define.mjs:2150-2166`); search stored fields separately reject JSON (`src/storage.rs:10562-10573`); the change journal carries whole-row JSON snapshots (`src/storage.rs:12583-12635`); and live deltas put every changed whole row into one serialized op envelope (`src/live_matcher.rs:813-838`, `src/local.rs:22804-22866`). A 32 KiB per-field limit does not bound a row containing multiple structured fields or a multi-row delta against the repository’s 64 KiB live-frame profile (`src/server.rs:6779`), which open question 3 itself acknowledges (`llp/0211-typed-opaque-structured-stored-values.spec.md:329-332`). The Spec must decide aggregate row/change/live-envelope behavior—bounded admission, fragmentation, or conservative replacement/refusal—and explicitly cover read-your-writes, change-journal replay, retained/local client stores, bounded/relational/maintained projections, and search/vector stored-field projections. Until then, “defined sync behavior” does not satisfy CV-4b’s exit, although stable refusals could do so once this matrix is closed.

6. [MATERIAL] The capability and maturity route is not specified far enough to execute — A proposed identifier plus “LLP 0113 qualification route” is not a publication contract (`llp/0211-typed-opaque-structured-stored-values.spec.md:247-254`). LLP 0134 requires every newly minted capability to enter the closed registries as experimental, identifies separate hosted and local/package support authorities, requires a dated governing amendment where no carrier or closed LLP 0113 claim-family kind exists, and requires a same-commit introduction record (`llp/0134-capability-maturity-promotion.spec.md:154-194`, `llp/0134-capability-maturity-promotion.spec.md:198-218`, `llp/0134-capability-maturity-promotion.spec.md:944-960`). LLP 0113 separately pins that maturity and runtime support are distinct facts (`llp/0113-qualification-and-publication-authority.spec.md:73-96`). The Spec must settle the capability id, required-capability propagation, local/package support carrier and predicate, hosted claim-family kind or amendment, and introduction record. A green acceptance corpus may be necessary evidence, but it cannot by itself make support true.

7. [DETAIL] The carve-out rationale still calls migration trivial — The summary says this slice pays none of CV-4b’s costs and has “trivial migration” (`llp/0211-typed-opaque-structured-stored-values.spec.md:41-46`), while the migration section correctly prices both JSON conversion and future re-encoding as O(N), proof-bearing work (`llp/0211-typed-opaque-structured-stored-values.spec.md:223-235`). Revise the summary to say only a newly added field is cheap; the later section already contains the more honest decision.

8. [DETAIL] Portable acceptance should include the target mapping and client carriers — The representation says `TEXT` on every target, but the exit names only SQLite and schema-compiler query refusals (`llp/0211-typed-opaque-structured-stored-values.spec.md:159-165`, `llp/0211-typed-opaque-structured-stored-values.spec.md:288-291`). Add a cross-adapter canonical-text/logical-value fixture when the Postgres adapter exists, plus read-your-writes and persistent-client round trips. LLP 0007 explicitly calls for cross-engine and local/server parity evidence (`llp/0007-storage-portability.spec.md:776-795`). This is acceptance-detail work once the governing decisions above are closed.

## Verdict
NOT READY — binding to revision 0d951fa69 (sha256 7ea0615b656e3166)
The core carve-out—typed atomic values, canonical portable TEXT, no interior predicates, no element identity, and no raw-byte exposure—is coherent and preserves the proposed future representation options. However, the revision still leaves the executable grammar, optional/object semantics, lawful migration path, physical-encoding identity, delivery/sync bounds and refusal matrix, and capability-publication authority unresolved. Those are implementation-governing decisions rather than implementation details, so the document is not ready at this revision.

## Round 2 — 2026-08-09 (delta round)

**Provenance.** Reviewer: codex exec, model gpt-5.6-sol,
model_reasoning_effort=xhigh, read-only sandbox, repo-local capsule at
`bf5cfa214`. Blindness: instruction-based, self-attested. Reviser:
orchestrator, did not review. Revision under review: `bf5cfa214` (file
sha256 prefix `cad95f0810919c00`). Delta round (round2-instructions.md).
Verdict: **NOT READY — four MATERIAL, all IN-DELTA; zero PRE-EXISTING
MATERIAL.**

**Verbatim review body follows.**

---

Blindness self-attestation: I did not read review artifacts, journals, or the other family's output.

## Concerns
1. [MATERIAL][IN-DELTA] The closed declaration is not closed over the actual validator grammar — The top-level table gives no fate for public forms including `v.null()`, `v.literal(...)`, and `v.tuple(...)`; these are distinct builders whose current `fieldType: Json` does not make them `v.json()`. The interior inventory similarly names only `v.number() (Integer/Real)`, although `define.mjs` exposes distinct `v.integer()`, `v.real()`, and `v.finiteReal()` spellings. Under “everything not listed refuses,” those numeric forms would be rejected, contrary to the parenthetical and grammar-reuse claim. Acceptance covers neither ambiguity. The Spec must enumerate each fate explicitly.

2. [MATERIAL][IN-DELTA] A per-row structured-byte ceiling cannot guarantee the 64 KiB live-frame claim — `LiveEnvelope::LiveReplace` contains `rows: Vec<Value>` and `LiveDelta` contains multiple row-bearing operations; one mutation may affect far more than one row. Two individually valid rows whose structured values are 32,748 bytes each serialize to a minimal `live_delta` of 65,772 bytes, already exceeding 65,536 bytes. Other scalar fields and envelope metadata can also push even one row over the limit. The mechanism must bound complete serialized envelopes/rows or specify chunking, resync, or another delivery behavior; the proposed per-row structured aggregate does not establish the claimed invariant.

3. [MATERIAL][IN-DELTA] The new manifest identity carrier is not specified sufficiently to be authoritative — At this revision `FieldManifest` contains only `{name, field_type, optional}`. LLP 0211 says the new entry carries `Structured`, a logical-contract hash, and an encoding id, but does not normatively require the recursive descriptor itself, freeze its wire shape, define the field-root hash domain/preimage, require load-time recomputation, or define exactly how the encoding id enters storage-generation identity. “Hashed as contracts are” is insufficient because LLP 0131’s formula is for a different `FunctionArgsContractV1` root. Acceptance also lacks cross-language carrier/hash goldens and a planner fixture proving an encoding-id-only change creates a successor generation. A hash alone cannot drive runtime validation, and divergent implementations could produce incompatible migration identities.

4. [MATERIAL][IN-DELTA] The local/package support authority is unnamed and conflicts with LLP 0134’s non-inference rule — LLP 0134 §1 says `LocalCapabilityPublicationV1` and `PackageCapabilityAttestationV1` bind only the relation/activity pair and generalize to nothing else; other local capabilities use plain registered booleans, while any new source-owned carrier requires an explicit governing design. LLP 0211 instead invokes “the standard support-fact carrier” without choosing the plain-boolean route or defining a new carrier and its package trust predicate. Consequently, the distinct support flip has no executable authority. The Spec must name the exact local and public-package support predicate/carrier.

5. [DETAIL][IN-DELTA] Acceptance does not fully pin the newly claimed matrices — The write-path contract includes imports and migrations, but canonical stability is required only for insert, patch, seed, and buffered routes. Also, the claim that existing maintained-projection admission excludes structured leaves is not true for search/vector `storedFields`: current search code applies no stored-field type restriction, while vector code rejects only `Vector`. Add explicit import/migration seam evidence and search/vector stored-field refusals, or identify a structural test proving those routes share the authoritative gates.

6. [DETAIL][PRE-EXISTING] LLP 0044 still contains stale array-element enforcement text — Its latest header and §Typed references withdraw asset-reference arrays, but the enforcement paragraph still says every `v.assetRef` field includes an “array element.” The latest ruling is clear, so this is non-blocking corpus drift, but the paragraph should be reconciled.

## Verdict
NOT READY — binding to revision bf5cfa214 (sha256 cad95f0810919c00)

The revision has four unresolved MATERIAL concerns, all IN-DELTA: an incomplete declaration dispatch, an invalid live-frame bound, an under-specified persistent identity carrier, and an undefined capability-support authority. No MATERIAL concern is PRE-EXISTING; the only PRE-EXISTING concern reported is detail-level LLP 0044 drift.

## Round 3 — 2026-08-09 (final in-budget delta round)

**Provenance.** Reviewer: codex exec, model gpt-5.6-sol,
model_reasoning_effort=xhigh, read-only sandbox, repo-local capsule at
`a8e1d75df`. Blindness: instruction-based, self-attested. Reviser:
orchestrator, did not review. Revision under review: `a8e1d75df` (file
sha256 prefix `1c43c9121ff96fd4`). Delta round (round3-instructions.md).
Verdict: **NOT READY — one MATERIAL, IN-DELTA (wire/hash pinning); zero
PRE-EXISTING MATERIAL; delta-convergence condition holds from this
family.**

**Verbatim review body follows.**

---

Blindness self-attestation: I did not read review artifacts, journals, or the other family's output.

## Concerns

1. [MATERIAL][IN-DELTA] `StoredStructuredContractV1` still lacks a frozen wire and hash definition — §Representation names the semantic components and domain string, but never fixes the record’s JSON members, descriptor root, canonicalization input, domain separator, hash algorithm, or textual hash form. “The wire shape is frozen at introduction” postpones that decision. By contrast, LLP 0131 specifies the exact root/entry/node forms and the formula `sha256(UTF8(domain + "\n") || JCS(contract))`, including the `sha256:` lowercase-hex representation. Because these bytes and the resulting hash govern persisted-manifest compatibility and LLP 0081 storage-generation identity, implementation-selected goldens cannot establish conformance to this revision; they would merely bless whichever incompatible choice lands first.

2. [DETAIL][IN-DELTA] Migration-case count is stale — §Migrations says “Three migration cases” but now enumerates four. This identifies no defective decision and is implementation-phase/editorial only.

## Verdict

NOT READY — binding to revision a8e1d75df (sha256 1c43c9121ff96fd4)

The carrier’s durable wire and identity preimage remain underdetermined, so the revision has one unresolved MATERIAL concern. That concern is IN-DELTA; no MATERIAL concern is PRE-EXISTING.

## Loop close-out — 2026-08-09

**Terminal: delta-convergence with an unreviewed tail (3-round budget
exhausted).** Final verdicts bind to revision `a8e1d75df` (sha256
`1c43c9121ff96fd4`): fable NOT READY (1 MATERIAL in-delta), codex NOT
READY (1 MATERIAL in-delta). **Pre-existing text was MATERIAL-clean from
both families in both delta rounds (2 and 3)** — the delta-convergence
condition holds. The two round-3 in-delta MATERIALs (search-storedFields
disclosure split; StoredStructuredContractV1 wire members + hash formula)
plus round-3 DETAILs were fixed in the round-3 close-out revision, whose
delta is **UNREVIEWED** — recorded in the document header. Disposition
ledger: every round-1/2/3 concern from both families is dispositioned in
the revisions its round produced (see the dated Revised entries); no
concern was summarized away; one reviewer claim (codex r2: "v.number is
not a builder") was refuted against code and not applied. Growth: 349 →
~560 lines over the loop, beyond the ~20% guidance, MATERIAL-driven and
disclosed each round. Recommendation to the author: the Spec is ready for
acceptance consideration with the unreviewed-tail caveat; the
implementation phase (authorized separately by the author) proceeds
against the close-out revision and treats both families DETAIL ledgers as
implementation checklist items.
