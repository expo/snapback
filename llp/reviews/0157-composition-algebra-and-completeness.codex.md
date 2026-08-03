# LLP 0157 composition algebra review — Codex family

## Round 1 — 2026-08-02

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Redacted:** no
**Method:** fresh non-author `codex exec` context over the working tree at
0f91ca76; instructed to read LLP 0157 in full plus LLP 0155 (Moves 1–2),
LLP 0135 Part 2, LLP 0120 §Option 3a, and LLP 0080, to spot-check cited
code, and not to read anything under `llp/reviews/` concerning 0157 (no
such artifact existed). Orchestrated by the Fable session that authored
the draft, which therefore does not count as a reviewer; this artifact
records the Codex review verbatim below. Author verification before
application: the four load-bearing substrate citations (0135 §2.3 sealed
`absent` envelope, 0135 §2.5 `retention:"none"` / no `live_delta`,
LLP 0114 `CanonicalClientValueV1`, LLP 0053 generation fences) were
checked against the tree and are accurate.

---

## Overall assessment

**NOT READY — high confidence (0.97).**

The direction is sound, but the draft has four blocking problems: it contradicts LLP 0135’s sealed-result and retention semantics, does not define a reproducible collision-safe identity, leaves the completeness witness insufficiently bound to pagination and authorization state, and does not integrate fragment writes with LLP 0053’s mandatory fences.

## Strengths

- The ownership boundary is mostly disciplined. §Scope and authority, §D1, §D5, and §Non-goals correctly preserve node-class ownership, reject data-dependent composition, and defer aggregates without inventing new grammar. This is faithful to LLP 0155 §Move 1 and LLP 0120 §Option 3a.

- §D3 adopts the right necessary safety rule: independently hydrated nodes from different snapshots cannot establish composite completeness. Reserving `prefix` and forbidding cap-derived prefix claims also follows LLP 0155 §Completeness model.

- §D7 correctly keeps cross-query normalization gated behind projection provenance, version reconciliation, deletion behavior, and adversarial authority evidence, matching LLP 0155 §Move 2.

- The cited implementation posture is accurate. `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED` is enforced at the 1,024-row implicit `collect()` boundary with local/workerd regressions. Delta candidacy in `src/local.rs` requires a schema-exact `documents(table)` contract, and `tests/live_delta_v0.rs` verifies narrowed contracts use validated replacement or refuse before application payload escapes.

- §D6’s “one data model, two projections” is a reasonable answer to LLP 0155 OQ11, and §D8’s stated goal of one execution substrate is the correct architectural posture.

## Concerns

1. **BLOCKING — §D8 contradicts LLP 0135 §2.3’s sealed-result semantics.**  
   LLP 0157 says a sealed composite becomes witness state `refused` with “0135’s sealed reason.” LLP 0135 instead defines a successful, byte-identical `{kind:"absent", nodes:null, continuation:null}` result, deliberately disclosing neither cause nor node. There is no sealed reason. Reclassifying this as refusal changes observable semantics and risks reopening the missing-versus-invisible channel.

   **What would resolve it:** Preserve the sealed `absent` envelope verbatim. At a common snapshot it can carry `complete`, because the complete admitted result is the sealed absence. Reserve `refused` for actual plan/admission/runtime refusal and expose no sealed cause.

2. **BLOCKING — §D2 does not define a usable plan hash or one coherent cross-surface identity.**  
   “The plan hash is the canonical bytes” defines bytes, not a hash; there is no digest algorithm, domain separator, versioned preimage schema, or server recomputation rule. LLP 0131’s canonical form is primarily the argument-*contract descriptor* hash, not canonical runtime argument values. Its explicit-null ruling excludes explicit null from one cross-carrier search shape; it does not define an absent/null value equivalence. Runtime argument identity is already governed by LLP 0114’s `CanonicalClientValueV1`.

   The proposed `(plan hash, canonical args)` also omits the exported function identity that LLP 0135 §2.5 explicitly gives the composite. Two exported functions with the same normalized plan and arguments would collide despite being distinct observable surfaces. Existing generated references and store keys additionally bind app/function, implementation, argument-contract, and result-contract identities.

   **What would resolve it:** Freeze a closed `NormalizedCompositePlanV1` representation and a formula such as domain-separated SHA-256 over its JCS bytes; require the host to recompute and exact-compare it. Separately define the materialization/query identity, including app/deployment or activation, exported function/reference identity, contract identities, plan hash, and LLP 0114-canonical arguments. Specify exactly how `ParentAuthorizationKeyV1` groups serialize into the preimage.

3. **BLOCKING — one common snapshot is necessary but the §D3 witness is not sufficient.**  
   The open-ended “binds to at least” list omits the version stream, activation identity, authorization incarnation/epoch, and composite page/boundary identity. Advancing `sbsb1` can produce a different page at the same commit version when no write intervenes. Because cursor/boundary state is not bound, stale fragments from different pages can satisfy every listed field.

   Fragment granularity and install atomicity are also undefined. “Each fragment stores its witness” does not say whether a fragment is a whole tuple, one node page, or a row slice, nor how a crash midway through a composite install avoids false assembly.

   **What would resolve it:** Define a closed `CompletenessProofV1` binding the materialization identity, version stream, authoritative authorization witness, activation, input composite cursor or complete per-node boundary/terminal vector, full node set, and a batch/result identity. Require atomic installation of the entire established set or an atomic batch-commit marker.

4. **MATERIAL — the completeness state machine is not total, and the cursor transition is expressed against a nonexistent operation.**  
   `unknown` is absence of proof and may be produced locally; `complete` and `refused` are server outcomes; yet all are called a server-issued witness. Transitions for initialization, request failure, cancellation, retry after refusal, auth quarantine/delete, lease expiry, resnapshot, retained boot, and terminal retirement are unspecified.

   Moreover, LLP 0135 removes per-node cursors from the public composite. §D3 and acceptance sketch 8 say “advance one nested cursor,” which cannot happen through `sbsb1`; all nodes resume together.

   **What would resolve it:** Separate `CompletenessStatus` from the server-issued proof and publish a total transition table with producer authority for every transition. Rewrite cursor transitions around supplying one composite continuation and atomically establishing its resulting page. Keeping `prefix` present but producerless in v1 is coherent once explicitly represented that way.

5. **BLOCKING — §D4 re-decides LLP 0135 §2.5’s classification.**  
   LLP 0135 fixes `snapshot-batch.v1` to cursor-free-first-page `live_replace`, no `live_delta`, and `retention:"none"`. LLP 0157 instead says retention is a meet and a composite becomes retained-eligible when every node is. Acceptance sketch 6 then requires a “retained composite,” which cannot exist under the adopted v1 substrate.

   The four proposed axes are also not defined as lattices: incremental eligibility and replace-only delivery are treated as separate axes and then one is assigned the other’s value.

   **What would resolve it:** State the current `snapshot-batch.v1` classification exactly as LLP 0135 fixes it. Put any future meet algebra behind a successor profile, with explicit values, ordering, and side conditions for each axis. Remove the retained-composite acceptance case until such a profile is admitted.

6. **BLOCKING — §D7 is insufficient to preserve LLP 0053’s security obligations.**  
   LLP 0053 requires every snapshot, live callback, optimistic reconciliation, and durable write to capture and compare-and-commit `(query_instance_id, authority_generation, query_generation)`, honor the effective disposition, retain tombstone/frontier state, and atomically bind retained payload to its lease and authorization `CompositeWitness`. §D7 only mentions contract validation and says membership removal cannot override deletion.

   It also places “query instance/generation” inside the fragment key even though LLP 0053’s `query_generation` is mutable fence state, not necessarily stable materialization identity. Treating it as a key component could strand predecessor fragments rather than destroy or quarantine them.

   **What would resolve it:** Define transactional store operations that embed or reference `QueryAuthorizationState`; require the LLP 0053 CAS on every fragment write and render; specify quarantine, deletion, tombstone, lease-expiry, user-switch, and terminal-retirement behavior. Distinguish LLP 0053’s authorization `CompositeWitness` from the new completeness proof.

7. **MATERIAL — the Spec under-owns parts of the LLP 0155 commission it claims to own.**  
   LLP 0155’s authority table assigns Move 2 to the same Spec, so §D7 is not overreach. But it covers only fragment keys and ingestion, omitting the commissioned materialization plan and the per-query membership, freshness, version, resume, retention, reactive-subscription, and observable-store-state contracts. It also does not settle ownership of the evaluator conformance corpus or reconcile LLP 0155’s LLP 0145 bundle obligation.

   On Move 1, the exact Triage/Fleet exit gate and the inspector’s “every retained row” obligation are not preserved. Deferring relational nodes in multi-node composites may also leave Fleet’s commissioned outcome unavailable.

   **What would resolve it:** Add a commission crosswalk mapping every LLP 0155 Move 1/2 obligation to a normative section, owner, or explicit blocking dependency. Restore the Triage/Fleet exit criteria and state that Move 1 cannot exit until any required LLP 0135 relational-node successor lands.

8. **MATERIAL — several acceptance sketches are vacuous, impossible, or lack an oracle.**  
   Sketch 3 cannot freeze identity before the preimage and digest are defined. Sketch 6 requires a v1 retained composite that LLP 0135 forbids. Sketch 8 invokes a per-node cursor operation that does not exist. Sketch 7 only catches leaks that existing single-node fixtures catch, not composite-specific leaks. Sketch 2 tests skewed versions but not same-version/different-page mixing. “Absent rather than guessed” allows an inspector that omits every fact to pass.

   **What would resolve it:** Rewrite these as exact input/output fixtures after the relevant schemas are frozen. Add same-version page mixing, partial/crash installation, auth-fence races, sealed missing/invisible paired worlds, all-node-retainable classification, and positive inspector-oracle cases. Incorporate LLP 0155’s Triage/Fleet workload numbers.

9. **MATERIAL — §D6 does not preserve the inspection authorization boundary.**  
   The model exposes canonical args, authority partitions, obligations, fragments, and retaining identities, but defines neither audience nor redaction. LLP 0080 §3 requires missing and invisible rows to remain indistinguishable in ordinary inspection, with sensitive per-row facts confined to a separately authorized audit channel. “The inspector holds no authority” does not define who may read these projections.

   **What would resolve it:** Freeze separate server/client projection schemas and their authorization rules. State the ordinary-inspection redactions, bind the client artifact to its own store/authority partition, and add paired-world noninterference tests covering inspection output.

10. **NIT — the same commit introduced minor hygiene ambiguity.**  
    LLP 0080 now has two `**Revised:**` metadata fields. Also, `SNAPBACK_COMPOSITE_DYNAMIC_NODE` is called a “working code” while §D1 promises stable reasons; it is not registered elsewhere in the current tree.

    **What would resolve it:** Fold the boundary note into the existing `Revised` field and either register the diagnostic as stable or label it explicitly as a placeholder.

## Suggestions

- Use distinct names for `PlanHashV1`, `QueryMaterializationKeyV1`, `CompletenessStatusV1`, `CompletenessProofV1`, and LLP 0053’s authorization `CompositeWitness`.
- Separate fixed `snapshot-batch.v1` facts from successor-profile algebra throughout §D4 and §Acceptance.
- Add a single normative commission/ownership matrix; it would make omissions and accidental re-decisions much easier to detect.
- Describe the existing implicit-cap behavior as landed at the invocation-error seam, with conversion into the new `refused` public state still pending.

## Open questions

- Is an LLP 0135 sealed `absent` result intended to be complete at its snapshot? The existing substrate strongly implies yes.
- Is cross-function deduplication of identical plans intentional? If not, exported function identity must enter materialization identity.
- What exactly is a fragment: a whole composite result, a node page, or a row-level slice?
- Is completeness defined per bounded page, per terminal traversal, or both under different labels?
- Is LLP 0157 intended to be the full Move 1/2 owning Spec that LLP 0155 names, or only the algebraic layer before another store Spec?

## Recommended next step

Revise to v0.2 and remain Draft. Resolve the substrate contradictions first, then freeze identity and completeness-proof schemas, integrate LLP 0053’s store state machine, and replace the acceptance sketches with executable oracles plus the exact Triage/Fleet gates. After that, run round 2 against the revised text before considering READY.

---

## Round 2 — 2026-08-02

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Redacted:** no
**Method:** fresh non-author `codex exec` context over the working tree at
38d74e1a (v0.2); instructed to read the round-1 artifact above, judge each
round-1 concern's disposition with evidence, then review v0.2's new
material on its own merits against LLP 0135 Part 2, LLP 0155, LLP 0053,
LLP 0114, LLP 0080 §3, and LLP 0120 §Option 3a. Orchestrated by the
authoring Fable session, which does not count as a reviewer.

---

## Overall assessment

**NOT READY — high confidence (0.98).**

v0.2 fully resolves C1, C5, and C10 and materially improves the other areas. It is still not ready because the identity and proof schemas are not actually closed, page completeness does not compose into a defined materialization state, the transition table conflicts with LLP 0053, and the commission crosswalk overstates its coverage.

## Round-1 disposition table

| Concern | Disposition | Evidence |
|---|---|---|
| C1 | **RESOLVED** | §D3 and §D8 preserve the byte-identical `{kind:"absent",nodes:null,continuation:null}` envelope, classify it as `complete`, reserve `refused` for actual refusal, and prohibit disclosure through status, proof, or inspection. |
| C2 | **PARTIALLY RESOLVED** | §D2 now gives `PlanHashV1` SHA-256/JCS/domain separation, host recomputation, exported-function and contract identity, and LLP 0114-canonical arguments; however `QueryMaterializationKeyV1` “binds, at minimum” an open list with no exact byte grammar, and its cross-surface rule omits LLP 0114’s provider-instance namespace. |
| C3 | **PARTIALLY RESOLVED** | §D3 adds stream/version, activation, authorization witness, page/boundary, node-set, batch identity, and atomic page installation; but several bound identities are undefined, single-node cursor pages cannot be represented by the `sbsb1`-only wording, and page proofs do not yield a defined multi-page materialization state. |
| C4 | **FIX-INTRODUCED-DEFECT** | A transition table now exists and correctly removes per-node cursor transitions, but its catch-all preserves stale states, invalid retained-proof handling is absent, same-identity retry success is absent, and “status destroyed” is outside the claimed four-state algebra and contradicts quarantine preservation. |
| C5 | **RESOLVED** | §D4 restates LLP 0135 §2.5 exactly: cursor-free first-page `live_replace`, no `live_delta`, no proved-disjoint skip, and `retention:"none"`; meet algebra is explicitly successor-only. |
| C6 | **PARTIALLY RESOLVED** | §D7 correctly requires the generation-triple CAS on every write and render, preserves tombstones/frontiers, distinguishes the two witnesses, and keeps mutable generations out of the fragment key; §D3 nevertheless collapses quarantine and destructive fence events into one incorrect transition. |
| C7 | **PARTIALLY RESOLVED** | The crosswalk and Fleet relational-node dependency are useful, but “restated verbatim below” is false, the Move-2 acceptance gate is unmapped, several store contracts remain deferred to the implementing slice, and “every retained row” has no row-level contract. |
| C8 | **PARTIALLY RESOLVED** | The sketches now name explicit falsifiers for cap refusal, hash divergence, atomic install, sealed worlds, and fence races; sketch 2 contradicts whole-page fragment granularity, sketches 3/6 depend on still-unfrozen schemas, and sketch 9 lacks a defined re-establishment oracle. |
| C9 | **PARTIALLY RESOLVED** | §D6 adds the normative missing-versus-invisible boundary, a separate audit channel, and client store/partition binding; however it explicitly defers the projection schemas and audience rules to OQ5/the implementing slice while exposing canonical arguments and proof-bound facts. |
| C10 | **RESOLVED** | LLP 0080 now has one `Revised` field, and §D1 explicitly labels `SNAPBACK_COMPOSITE_DYNAMIC_NODE` and the other named codes as placeholders until registration. |

## Fresh concerns

1. **BLOCKING — The transition table is not safely total.** The default “any event not listed leaves the status unchanged” leaves failed proof revalidation potentially `complete`; only changed-plan retries can leave `refused`; and the fence row sends quarantine, deletion, lease expiry, user switch, and retirement to the same non-state, “status destroyed.” LLP 0053 instead preserves quarantined bytes hidden and destroys only on the appropriate dispositions. **Resolution path:** define a product of materialization lifecycle, LLP 0053 disposition, freshness, and page completeness; enumerate valid-proof install, invalid/missing proof, same-identity retry, quarantine/release, delete, retirement, and profile-ineligible retained boot, with LLP 0053 transitions taking precedence.

2. **BLOCKING — `QueryMaterializationKeyV1` is neither closed nor coherently scoped.** “[B]inds, at minimum” contradicts “closed and versioned”; no record layout, serialization, digest, total-byte limit, or encoding of the parent-group canonical bytes is specified. More importantly, §D2 says client materialization keys solely by this value and no surface derives a parallel identity, while LLP 0114 requires provider-instance identity and distinct registries even when two providers borrow the same client. **Resolution path:** freeze exact bytes and limits, define parent-group ordering/byte encoding, and distinguish a global query/materialization subkey from contextual namespaces such as `providerInstanceId` and `client_store_id`.

3. **BLOCKING — `CompletenessProofV1` is not a closed page/batch identity schema.** “Reference” to an LLP 0053 `CompositeWitness`, “sbsb1 token identity,” “node plan hash,” and “batch identity unique to this establishment” have no defined representations. The proof purports to cover all single-node reads, but non-first single-node pages use their owners’ cursors, not `sbsb1`. A sealed result also needs an explicitly uniform page-identity variant so its boundary vector cannot disclose which node sealed. **Resolution path:** freeze cursor-profile-tagged `PageIdentityV1`, `NodePlanHashV1`, `BatchIdentityV1`, and an embedded-or-digested authorization-witness binding; use opaque domain-separated digests rather than raw cursor credentials or protected boundary values.

4. **BLOCKING — Page completeness does not define materialization completeness.** §D3 says `complete` belongs to one page and leaves prior pages untouched; sketch 9 then says pages from different versions remain individually valid while “the live materialization reports `unknown` until re-established,” without defining what must be re-established or how accumulated pages become current. This is load-bearing for pagination and local rendering. **Resolution path:** decide whether a materialization exposes only one current page or an accumulated page set. For accumulation, define its page-set identity, version-consistency rule, invalidation/refetch algorithm, render status, and no-skip/no-duplicate oracle.

5. **MATERIAL — The commission crosswalk is inaccurate.** The claimed verbatim Triage/Fleet gate is absent; LLP 0155’s 20-change, 250,000-event/1,000-update/100-match, Mallory, and pagination gates are not reproduced. The Move-2 real-carrier gate is omitted, as are normative treatment of provisional entities, optimistic layers, outbox/settlement composition, and several per-query facts. OQ9 and “the implementing slice” are dependencies, not landed contracts. **Resolution path:** map every source obligation and acceptance item to normative text, an explicit external owner/dependency, and an executable fixture—or narrow this Spec’s ownership claim.

6. **MATERIAL — Several rewritten sketches still lack executable oracles.** Sketch 2 refers to “two nodes’ fragments,” impossible when §Vocabulary makes a fragment the atomic whole-page tuple. Sketch 3 cannot freeze an open materialization key. Sketch 6 demands a transition cause absent from the inspection model. Sketch 9 has no definition of successful materialization re-establishment. Retained-boot sketches do not identify a retainable single-node profile despite composite v1 being non-retainable. **Resolution path:** give every fixture an admitted profile, exact serialized inputs, operation sequence, observable output, and forbidden output; replace node-fragment mixing with a fault at the actual atomic page-write boundary.

7. **MATERIAL — The inspection authorization contract remains deferred at the point sensitive fields are introduced.** §D6 ordinarily exposes canonical arguments, authority partitions, proof-bound facts, and resume state, while postponing exact schemas and audiences. Page boundaries and cursor-derived identity can contain protected values that LLP 0080 permits only inside opaque credentials or the authorized audit channel. **Resolution path:** freeze ordinary server/client projection schemas and field-level redactions now, including opaque digests for cursor/boundary facts, then broaden sketch 7 across every sealing node and multiple-seal worlds.

8. **DETAIL — “The generation triple is fence state, not identity” is too broad.** Excluding it from the fragment lookup key is sound, and the CAS rule is correct. But LLP 0053 treats `query_instance_id` as the exact never-reused `ClientQuery` instance discriminator; only the generations are purely mutable fence counters. **Resolution path:** say that none of the triple belongs to `QueryMaterializationKeyV1`, while `query_instance_id` remains mandatory instance/scope identity stored and compared with every fragment operation.

## Suggestions

- Define the identity stack explicitly: structural plan hash → global materialization subkey → provider/store namespace → query-instance fence → page identity → batch establishment.
- Make completeness, freshness, authorization disposition, connection state, and materialization lifecycle an explicit product rather than forcing destructive events into one four-value status.
- Turn the commission crosswalk into a verification matrix with source section, normative owner, dependency, and acceptance fixture.
- Keep the v0.2 separation between fixed `snapshot-batch.v1` facts and successor-profile meet algebra; that correction is sound.

## Open questions

- Is public completeness attached to one requested page, the currently rendered page, or the entire accumulated query result?
- Is `QueryMaterializationKeyV1` intended to be globally portable, provider-scoped, or store-scoped?
- Does `CompletenessProofV1` embed the LLP 0053 `CompositeWitness`, bind its canonical digest, or reference some durable ticket identity?
- During quarantine, is the completeness proof retained but non-renderable, and what may ordinary inspection report about it?
- Is LLP 0157 truly the complete Move-2 owning Spec, or should the unprovided store/reactive/carrier contracts move to a separately commissioned Spec?

## Recommended next step

Keep LLP 0157 in **Draft** and revise to v0.3. Freeze the identity/proof/page schemas first, replace the transition table with a total product-state protocol consistent with LLP 0053, then repair the crosswalk and acceptance fixtures against every LLP 0155 Move-1/2 gate. Append this as the dated Codex round-2 review and run another independent round before considering READY.

---

## Round 3 — 2026-08-03

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author `codex exec` context over the modified working
tree at base 29699bd66c16 (v0.3); instructed to read AGENTS.md, LLP 0157,
LLP 0155 Moves 1–2, the commission, LLP 0090's 2026-08-02 proposal, the
relevant 0135/0110/0053/0080/0114/0120 owners, and this artifact's two prior
rounds; explicitly adjudicate all Round-2 findings; and inspect current code
for every current-tree claim. Orchestrated by the current authoring session,
which does not count as a reviewer. The response below is verbatim apart from
omitting the CLI's trailing token-usage counter.

---

## Overall assessment

**NOT READY — confidence 0.98.**

v0.3 is a substantial improvement and resolves the core page-set model, liveness binding, cursor ownership, and `query_instance_id` distinctions. Four blocking precision gaps remain: the claimed node universe is not closed over every generated read, `QueryMaterializationKeyV1` contradicts the current generated-reference schema, completeness installation can still appear to lower LLP 0053 dispositions, and offline proof verification lacks a fully specified trust anchor and authorization-witness byte schema.

## Round-2 disposition table

| Round-2 finding | Disposition against v0.3 | Evidence |
| --- | --- | --- |
| R2-1 — transition table not safely total | **PARTIALLY RESOLVED** | The explicit product and closed event vocabulary correctly preserve quarantine and distinguish retirement. However, `"install valid current page proof"` and `"install valid retained page proof"` say to set disposition to `retain`, while LLP 0053 permits lowering only through exact per-scope resolution with stronger pending scopes preserved. |
| R2-2 — materialization key not closed/scoped | **PARTIALLY RESOLVED** | The fixed 48-byte `qmk1.` subkey and separate client/provider addresses solve scoping. But `QueryMaterializationPreimageV1.function.expectedGeneration: string` contradicts current codegen’s exact object `{schemaVersion, appId, schemaHash, bundleHash, inputsHash}`. |
| R2-3 — proof/page/batch identities not closed | **PARTIALLY RESOLVED** | `PageIdentityV1`, `BatchIdentityV1`, node hashes, result digest, signature, and uniform sealed variant are now present. The canonical JSON projection of LLP 0053’s `CompositeWitness` and authentication of the claimed “signed manifest” remain undefined. |
| R2-4 — page completeness does not compose | **RESOLVED** | `PageSetIdentityV1` now requires one materialization/activation/plan/authority/version, first-to-terminal credential continuity, verified results, and atomic publication. The client product explicitly distinguishes requested page from page set. |
| R2-5 — commission crosswalk inaccurate | **PARTIALLY RESOLVED** | The exact numeric Triage/Fleet and real-carrier exits are restored. The crosswalk still omits LLP 0155’s required vocabulary/design-budget stop rule and the first-party arm/degraded-storage obligations. |
| R2-6 — acceptance sketches not executable | **PARTIALLY RESOLVED** | A1–A12 are much stronger. A6’s batch-identity falsifier is not a rule of `PageSetIdentityV1`; A7 does not distinguish exact corrupt-proof versus corrupt-lease dispositions; A9 requires a baseline multi-membership state the fragment model cannot produce. |
| R2-7 — inspection contract deferred | **PARTIALLY RESOLVED** | The ordinary server/client structures and redactions are now frozen. Several observable digest/value grammars remain open, and A9’s byte-equality claim conflicts with exposing a fresh random `batchIdentity`. |
| R2-8 — `query_instance_id` misclassified | **RESOLVED** | D7 correctly makes it mandatory, never reused, and compared on every operation, while only `authority_generation` and `query_generation` are mutable counters excluded from the reusable key. |

## Strengths

- `NodeCapabilityBindingV1` and `PlanCapabilityClassificationV1` explicitly bind liveness. The `"Query"` versus `"LiveQuery"` near-miss correctly prevents LLP 0090’s mixed successor from treating shape as a registration oracle.
- `NodePlanHashV1` and `PlanHashV1` are reproducible for owner-closed admitted nodes: domain-separated SHA-256, RFC 8785 JCS, normative ordering, and host recomputation are all explicit.
- `PageIdentityV1` correctly handles visible and sealed pages without revealing the sealing node or boundary. `ResultDigestV1`, proof signatures, same-version page-set chaining, and atomic manifests provide a sound foundation.
- D4 accurately preserves LLP 0135’s current `snapshot-batch.v1` classification: first-page `live_replace`, no `live_delta`, no proved-disjoint skip, and `retention:"none"`.
- D8’s concrete `sbbc1` grammar matches the current `Body`, `associated_data`, HKDF, and fixed-nonce vector in `src/bounded_children_cursor.rs`; the `sbsb1` 6,099-byte plaintext calculation is correct.
- The current-tree claims are accurate: `collectRows` refuses an implicit 1,024-row result with `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`, and `delta_documents_contract_matches_schema` gates raw deltas on the exact schema-derived document contract.
- The draft does not infer acceptance from the commission. It keeps the Spec Draft and leaves acceptance to the author.

## Concerns

1. **BLOCKING — The query-node algebra is not closed over its claimed domain.**

   The vocabulary says the v1 node classes are only `"relational_query_v1"` and `"bounded-children.v1"`, while the degenerate-composite rule says “every generated read query” participates. Current generated reads also include ordinary LLP 0004/0007 single-table plans and imperative `defineJsQuery`/inline handlers; LLP 0080 explicitly excludes single-table reads from `RelationalQueryPlanV1`. Those queries have no `NodePlanRecordV1` class or owner-closed `normalizedPlan`.

   The future seam is also inconsistent: `NormalizedCompositePlanV1` requires every snapshot-batch node to appear in one `parentAuthorizationGroup`, but an LLP 0135 OQ5 relational node has no bounded-child parent group. Therefore OQ5 cannot “change no contract here, only the admission list.”

   **Resolution:** Enumerate the complete single-node universe—adding owner-governed classes for ordinary closed single-table reads and explicitly classifying opaque/imperative reads as unsupported or refused—or narrow the “every generated read” claim. Make parent-group coverage conditional on node-class participation, and state which identity/cursor schema the relational successor must version.

2. **BLOCKING — `QueryMaterializationKeyV1` is not byte-reproducible from the current generated reference.**

   The draft freezes:

   > `expectedGeneration: string`

   Current codegen freezes:

   > `expectedGeneration: {schemaVersion, appId, schemaHash, bundleHash, inputsHash}`

   This object is present in generated `FunctionReference`, including its public TypeScript interface. No conversion or digest from that object to the draft’s string is defined, so codegen, Rust admission, and JS cannot reproduce the claimed exact preimage.

   **Resolution:** Embed the exact closed expected-generation object, or replace the field with a separately named, domain-separated digest whose JCS preimage is that exact object. Add equality constraints such as outer `appId === function.appId`, then freeze current-reference golden and near-miss vectors.

3. **BLOCKING — Completeness installation can still bypass LLP 0053’s disposition owner.**

   D3’s exact rows for installing current and retained proofs say “set `retain`.” D7’s `commitPage` writes the fragment, proof, memberships, and product state, but does not require an LLP 0053 per-scope resolution proof and acknowledgment token. A valid completeness proof does not itself establish that all quarantine/delete obligations were discharged; LLP 0053 requires the effective disposition to remain the maximum of every unresolved scope.

   Additionally, `applyAuthorizationTransition(address, …)` is address-scoped, while an authority change rotates the QMK through `authorityPartitionDigest`. The interface does not define the store-wide barrier that finds and deletes/quarantines predecessor addresses before successor initialization.

   **Resolution:** Make lifecycle and disposition authoritative projections of `QueryAuthorizationState`, never independently writable completeness fields. `commitPage` must not lower disposition; it may invoke LLP 0053 resolution only with the exact satisfied scopes/tokens, retaining stronger scopes. Add a client-store-wide authority-transition operation over all predecessor partition addresses, serialized before any successor address can render or initialize.

4. **BLOCKING — Offline proof verification is not fully specified.**

   `AuthorizationWitnessDigestV1` hashes `{queryInstanceId, compositeWitness}`, but the Spec does not freeze the exact JSON member names, null/absence representation, or numeric rules for projecting LLP 0053’s Rust-shaped `CompositeWitness`.

   The proof-key text also says clients persist a “signed manifest,” but `snapback.completeness-proof-keys.v1` contains no signature or trust-anchor field. Binding its digest into an activation preimage can be sound, but only if the client has an independently authenticated expected activation artifact and an exact rule for obtaining and validating that manifest offline; that rule is not stated.

   **Resolution:** Define `AuthorizationWitnessRecordV1` as an exact closed JSON record. Name the installed/authenticated activation artifact as the proof-key trust anchor and require exact manifest-digest comparison, or define the manifest signature/root format. Also pin the Ed25519 signature’s 64 decoded bytes and the exact cursor-credential digest type.

5. **MATERIAL — The ordinary inspection schemas are structural but not byte-exact.**

   `argsDigest`, `streamDigest`, `localRowHandle`, and `credentialDigest` lack complete domain/preimage formulas; `obligations.maxDisposition` is an open `string`; and several hash fields are merely `string`. That prevents the A9 golden trace from being portable.

   A9 also demands byte-identical ordinary projections across paired sealed worlds, while `ClientCompositionInspectionV1.fragments[].batchIdentity` exposes a fresh random value for every establishment.

   **Resolution:** Freeze every digest domain, preimage, salt lifecycle, and value union. Either redact `batchIdentity` from ordinary inspection or define noninterference comparison under fixed test randomness/disregarding explicitly public randomness.

6. **MATERIAL — Baseline multi-membership is impossible under the admitted fragment model.**

   A `MaterializationRecordV1` belongs to one QMK, and `localRowHandle` is derived from result identity plus row position. With cross-query normalization explicitly unadmitted, the same source row cannot acquire one shared handle with multiple retaining materialization keys. Nevertheless A9 requires a “multi-membership” trace and the client schema permits multiple retaining keys.

   **Resolution:** Define baseline membership as a row-occurrence-to-owning-fragment reason, normally singleton, and move cross-query multi-membership acceptance behind the normalization amendment. Preserve “every retained row has a reason” without implying canonical-row sharing.

7. **MATERIAL — The commission crosswalk still overclaims completeness.**

   LLP 0155 requires the owning Spec to pin a maximum admitted node vocabulary and cumulative design/work budget as the stop rule against incremental language growth. D1 has an owner-governed registry but no maximum or cumulative budget.

   The crosswalk also omits Move 2’s first-party-arm question—including the potentially narrower Contract-arm profile—and the required capability behavior for targets that provide volatile online materialization but no durable retention.

   **Resolution:** Add normative crosswalk rows and contracts for the vocabulary/budget stop rule, first-party arm profiles/OQ16, and durable-unavailable target reporting.

8. **MATERIAL — Several acceptance falsifiers do not follow from the normative rules.**

   `BatchIdentityV1` is fresh per establishment, and page-set validation does not require batch identities to be equal. Therefore A6’s “swap same-version batch ids” is either harmless or simply a signature-tampering test, not a page-set-composition falsifier.

   A7 groups corrupt signature, witness, lease, classification, and result under an “exact unknown/quarantine/delete branch” without assigning an exact outcome to each. LLP 0053, for example, requires malformed/mismatched/expired current-instance leases to delete before read, while an invalid completeness proof can ordinarily degrade to `unknown`.

   **Resolution:** Replace the batch-id case with substitution of a signed proof whose page/result identity breaks the chain. Give A7 a table mapping each corruption to its exact store mutation, status, and render result.

## Suggestions

- Reuse an exact `ExpectedGenerationV1` record across codegen and the QMK rather than introducing another spelling.
- Store one authoritative LLP 0053 state and derive the D3 lifecycle/disposition projection from it; avoid two mutable copies.
- Add a compact identity-rotation matrix showing which mutation rotates `NodePlanHashV1`, `PlanHashV1`, QMK, contextual address, query instance, page identity, or batch identity.
- In the acceptance-time LLP 0110 boundary note, explicitly reconcile its “length-framed purpose tuple” shorthand with the existing fixed vector’s actual raw fixed purpose followed by length-framed variable values.

## Open questions

- Does “every generated read query” intentionally include ordinary single-table and opaque/imperative queries?
- What installed artifact is the offline root of trust for `snapback.completeness-proof-keys.v1`?
- Is baseline membership strictly an occurrence-to-fragment relation until normalization is admitted?
- Which store-wide operation enforces an LLP 0053 client-wide or grant-scoped transition across QMKs rotated by authority partition?

## Recommended next step

Revise to v0.4 and remain Draft. Close the algebra universe, exact generated-reference preimage, LLP 0053 disposition/store-wide barrier, and offline proof trust path first; then repair the inspection and acceptance matrices. Afterward, run fresh independent Codex- and Claude-family reviews. This review does not imply acceptance or an author decision.

---

## Round 4 — 2026-08-03

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author `codex exec` context over the modified working
tree at base 29699bd66c16 (v0.4); instructed to read AGENTS.md, LLP 0157,
both prior family artifacts, LLP 0155 Moves 1–2, the commission, LLP 0090's
2026-08-02 proposal, and the relevant owners; explicitly audit every prior
BLOCKING/MATERIAL finding and inspect current code where it affects the
verdict. Orchestrated by the current authoring session, which does not count
as a reviewer. The response below is verbatim apart from omitting the CLI's
trailing duplicate of the response and token-usage counter.

---

Five BLOCKING and three MATERIAL findings remain. v0.4 closes most of the previous review surface, including the composition universe, liveness binding, total page-set semantics, disposition ownership, migration shape, and inspection noninterference. The remaining problems are concentrated in exact identity/proof bytes and authorization safety.

This was read-only; no review artifact or other file was written.

## Prior-finding audit

### Codex Round 3

| Finding | v0.4 disposition |
|---|---|
| **R3-1 BLOCKING — algebra not closed** | **Fully resolved.** D1 now has exactly two registered classes, explicitly refuses ordinary single-table/imperative reads as composition nodes, and distinguishes single-node from multi-node admission ([0157 §D1](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:204)). Parent-group participation is conditional on the registry row, so a future relational successor need not invent a parent ([closure rule 3](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:257)). The exact 2-class/2-profile universe and 6/4 RFC stop are explicit ([growth stop](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:218)). |
| **R3-2 BLOCKING — current generated-reference QMK bytes** | **Not fully resolved.** The five-field `ExpectedGenerationV1` is now exact ([§D2](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:420)), but the new equality between its schema version and the function-reference schema version contradicts the current generated format; see B1 below. |
| **R3-3 BLOCKING — disposition lowering/store-wide transition** | **Fully resolved.** Valid proof installation preserves the owner disposition ([transition table](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:870)); `authorityState` is the sole mutable owner ([§D7](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1185)); `commitPage` applies only exact scope resolutions and recomputes the unresolved maximum ([operation 3](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1201)); operation 7 supplies the store-wide predecessor barrier ([operation 7](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1216)). |
| **R3-4 BLOCKING — offline proof trust/witness bytes** | **Partially resolved.** The witness JSON, null rules and digest are closed ([§D3](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:599)); Ed25519 bytes and signed preimage are fixed ([proof signature](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:735)); and the generated, non-store trust anchor is now explicit ([trust anchor](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:758)). The validation rules still omit the required relationship between the proof version and the witness’s data floor; see B4. |
| **R3-5 MATERIAL — inspection not byte-exact** | **Fully resolved as raised.** Digest formulas are pinned ([§D6](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:987)), state/value unions are closed, and random `batchIdentity` is absent from ordinary inspection ([client projection rules](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1103)). A separate commission-coverage omission remains in M3. |
| **R3-6 MATERIAL — impossible baseline multi-membership** | **Fully resolved.** Membership is explicitly a row occurrence in one page and one materialization ([§D7](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1185)); the client projection freezes a singleton tuple and reserves plural membership for a future normalization amendment ([§D6](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1103)). |
| **R3-7 MATERIAL — incomplete commission crosswalk** | **Fully resolved.** The growth stop, first-party arms, volatile degradation, real-carrier exit, and exact Triage/Fleet numbers are all represented ([crosswalk](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1434), [Move-1 exit](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1574), [Move-2 exit](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1590)). |
| **R3-8 MATERIAL — invalid acceptance falsifiers** | **Fully resolved.** A6 now permits distinct legitimate batch IDs and uses broken page/result or credential continuity as its falsifiers ([A6](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1529)); retained-boot failures have an exact corruption-to-mutation/status table ([§D3](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:885)). |

### Claude Round 1

| Finding | v0.4 disposition |
|---|---|
| **C1 BLOCKING — cursor budget omitted arguments/variable fields** | **Partially resolved.** The calculation now enumerates `args`, activation constants, every body member and owner boundary maxima ([§D8](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1380)). It still calls storage-derived parent incarnation/version “actual” invocation constants while promising to run before storage; see M1. |
| **C2 BLOCKING — unreproducible identity/proof members** | **Partially resolved.** Activation identity is fixed ([§D2](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:432)); cursor digest, result encoding, class registry, cursor-profile registry, and outer boundary vector are defined ([§D3](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:593)). Per-binding contract hashes and the inner owner boundary bytes remain undefined; see B2 and B5. |
| **C3 MATERIAL — LLP 0043/0053 query-key migration absent** | **Fully resolved.** The Spec now explicitly adopts `qmk1` as the LLP 0053 `query_key` producer and commissions 0043/0053 boundary notes ([§D7](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1241)). The migration atomically moves payload, lease, fences, obligations and intent references or safely coexists until fresh sync ([Migration](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1622)). |
| **C4 MATERIAL — plan/function/pending-intent inspection omissions** | **Fully resolved as specifically raised.** The server projection now exposes function ID, indexes, declared bounds, joins and ceilings ([server projection](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1002)); the client exposes function ID ([client projection](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1075)); and exact pending-intent identities are explicitly routed to the authorized owner surface while ordinary inspection reports the count ([redaction rule](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1122)). M3 is a separate remaining pair of LLP 0155 facts. |
| **C5 MATERIAL — cursor-profile IDs unattributed** | **Fully resolved.** The Spec explicitly owns and freezes the distinct cursor-profile registry and commissions owner concurrence ([§D3](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:656)). |
| **C6 MATERIAL — A6 batch-ID ambiguity** | **Fully resolved.** A6 states that distinct legitimate batch IDs are allowed and batch continuity is not a page-set rule ([A6](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1529)). |
| **C7 MATERIAL — Provider address versus React key** | **Fully resolved.** The existing React key remains the unchanged UI index; it resolves to the provider-scoped semantic address underneath it ([§D2](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:535)). This matches the current key’s provider/reference/args structure ([canonical-client-value.mjs](/Users/ccheever/projects/snapback/packages/snapback-client/canonical-client-value.mjs:218)). |

## Remaining findings

### B1 — BLOCKING: current generated references fail the new QMK equality

The preimage correctly embeds the five-field generation object, but v0.4 additionally requires:

> `function.schemaVersion === function.expectedGeneration.schemaVersion`

([0157](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:479)).

Current generated references deliberately have `function.schemaVersion: "snapback.v0"` and `expectedGeneration.schemaVersion: "snapback.v1"` ([generated API fixture](/Users/ccheever/projects/snapback/tests/acceptance/fixtures/app-cli-journey/generated/api.mjs:46)). Therefore current valid generated queries refuse before hashing, contradicting A2’s “current five-field” parity requirement.

Minimal resolution: remove the cross-field equality. Validate each schema version against its own owner grammar and retain the three `appId` equality checks. Any intended unification of those independently versioned records needs a separately commissioned generated-reference migration.

### B2 — BLOCKING: per-binding contract hashes have no defined preimage

`NodePlanRecordV1.argumentBindings[].contractHash` is described only as an “LLP 0131 descriptor hash” ([0157](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:336)). LLP 0131 defines one whole-function `FunctionArgsContractV1` and one hash over that entire root ([0131](/Users/ccheever/projects/snapback/llp/0131-structured-argument-contracts.spec.md:204), [hash formula](/Users/ccheever/projects/snapback/llp/0131-structured-argument-contracts.spec.md:264)); it defines no per-entry descriptor hash.

Using the whole-function hash makes same-name merging depend on unrelated sibling arguments. Hashing the entry locally requires inventing a domain and record. Either choice changes `NodePlanHashV1`, `MergedArgsContractHashV1`, `PlanHashV1`, and QMK bytes.

Minimal resolution: define an exact `ArgumentBindingContractV1`, for example `{format, required, value}` using LLP 0131’s frozen value node, plus a domain-separated hash and exact declaration-order source. Alternatively carry that closed descriptor directly instead of a hash. `MergedArgsContractV1` must compare that exact defined value.

### B3 — BLOCKING: `AuthorityPartitionV1` is only a mutation-queue descriptor

The proposed partition contains only `{authorityInstanceId, sessionGeneration}` ([0157](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:492)). LLP 0039 explicitly defines two axes: principal/data scope and authority-instance/queue scope; in dev, the authority instance is stream-wide, while `sessionGeneration` is observational rather than the compared identity ([0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:1286)). LLP 0114’s actual logical partition additionally binds auth fingerprint, tenant/provider/delegation and stream/reset facts ([0114](/Users/ccheever/projects/snapback/llp/0114-first-class-react-and-query-groups.spec.md:200)).

The current client already exposes `principalScope` separately from `authorityDescriptor`, including dev `userId` ([index.mjs](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:2921)). Thus two dev users can share the proposed digest and QMK, while an ordinary session-generation change can rotate QMK unnecessarily.

Minimal resolution: hash the complete owner-issued headless authority partition, including principal/data scope and the exact provider/tenant/delegation/stream/reset axes required by LLP 0114. Treat the mutation descriptor as one component, not the partition. Exclude `sessionGeneration` from equality or explicitly classify it as non-identity observability.

### B4 — BLOCKING: proof validation does not enforce the authorization data floor

The proof carries a `(stream, commit)` and an authorization-witness digest, but validation only says to compare the witness digest with current LLP 0053 state ([0157](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:710), [validation](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:784)). It never requires the proof’s version to satisfy the witness.

LLP 0053 requires the proof to use the current version stream and a commit at least `min_commit_version` ([0053](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:1111)). Without that rule, a signed proof at commit 99 can validate against a witness whose floor is 100.

Minimal resolution: add a mandatory validation rule: when `compositeWitness.data` is non-null, `proof.version.stream` must equal `versionStream` and `proof.version.commit >= minCommitVersion`; current authorization incarnation/epoch and `queryInstanceId` must also exact-match. Define the `data:null` case explicitly. Apply the same test on install, retained boot, and every render revalidation.

### B5 — BLOCKING: signed boundary identity is not reproducible

The outer boundary-vector record is closed, but each node digest hashes `{position,classId,classVersion,values}`, where `values` is merely “the owner-canonical complete keyset boundary” ([0157](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:673)). No cited owner defines one shared `values` record. Current relational cursor code, for example, stores `boundary` and `_id` as separate members ([rqs.rs](/Users/ccheever/projects/snapback/src/rqs.rs:1349)); bounded and batch cursors use order fields, boundary values and row ID.

The cursor registry also describes profile names but does not give a normative class/plan-to-profile assignment or a closed eligibility rule for `none.v1`. Conforming Rust and JS implementations can therefore sign different boundary/profile bytes for the same page.

Minimal resolution: add a total registry mapping admitted plan/class variants to one `CursorProfileIdV1`, and define exact `NodePageBoundaryV1` variants. At minimum, relational and bounded forms must specify ordered fields/values and the `_id` tie-break, while snapshot-batch must map every node position to its exact bounded variant. Define precisely which plans, if any, may use `none.v1`; reject profile/plan mismatches.

### M1 — MATERIAL: the pre-storage size proof depends on storage-derived values

The budget promises to run before any first-page storage read but counts every parent’s “actual constant identity” and version ([0157](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1380)). `parentIncarnation` and `parentVersion` are learned from the parent point-read, not invocation constants. The assertion that all such values are constant across pages does not make them available before storage.

Minimal resolution: use actual bytes only for genuine invocation constants. For storage-derived parent incarnation/version, use owner-declared fixed maximum serialized widths in the pre-read template. State that visibility and storage access occur only after this maximum-size refusal.

### M2 — MATERIAL: `sbsb1` still lacks one exact cross-language JSON grammar

The envelope, field order, cryptography, and 6,099-byte calculation are correct, and the existing `sbbc1` body matches the current implementation. But “compact UTF-8 JSON in the field order below” does not freeze string escaping, nested boundary encoding, or the unit/epoch of `issuedAt` and `expiresAt` ([§D8](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1293), [body](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1331)). Those choices affect the fixed-nonce vector and maximum-template byte count.

Minimal resolution: define an ordered compact-JSON serializer for `sbsb1`, including exact UTF-8 string escaping and number formatting; require nested `args` to use the exact `CanonicalClientValueV1` bytes and boundary variants from B5; define timestamps as Unix epoch milliseconds with `expiresAt - issuedAt = 1_209_600_000`. Preserve `sbbc1` bytes unchanged.

### M3 — MATERIAL: two required inspection facts remain unreachable

LLP 0155 requires both “snapshot/current version” and “which authorization dependencies … apply” ([0155](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:566)). The v0.4 underlying model claims both facts ([0157](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:979)), but the closed projection contains only one ambiguous `state.snapshot` and obligation count/max disposition—no requested/current version and no authorization-dependency identifiers or redacted handles ([server projection](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1026)).

Minimal resolution: distinguish established snapshot from requested/current version in the closed state projection, with exact null semantics. Add safe authorization-dependency handles/digests or a normative resolution path through the served artifact; sensitive scope identities may remain audit-only, but the ordinary projection must reveal enough to answer that dependencies apply.

## NITs

- Define “ascending” consistently as lexicographic unsigned UTF-8 bytes for `requiredCapabilityIds`, proof keys, and other identity-bearing arrays.
- Require `ProofKeyManifestV1.publicKeyBase64url` to use canonical base64url-no-pad spelling, not merely decode to 32 bytes.

The page/page-set algebra itself is now total and coherent, and D7 plus the 0043/0053 migration has a credible no-redesign Move-2 handoff shape. That handoff is unsafe until the authority partition and proof-floor blockers are corrected.

**Verdict: NOT READY — confidence: 0.99.**

---

## Round 5 — 2026-08-03

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author, ephemeral focused-confirmation context over the
v0.5 working-tree blob `eadd8c4e09f4acb85ca7c9aea5be497350afda2b`;
instructed to audit every Codex Round-4 BLOCKING/MATERIAL and Claude Round-2
BLOCKING finding against the governing owners and current tree. Orchestrated
by the current authoring session, which does not count as a reviewer. The
response below is verbatim apart from omitting the CLI token-usage counter and
normalizing two trailing-space Markdown line breaks to satisfy repository
whitespace checks.

---

Reviewed the current v0.5 worktree blob `eadd8c4e09f4acb85ca7c9aea5be497350afda2b`, against Codex Round 4 blob `56d95a873e77c326a56988b6e4e324cf8c960b46` and Claude Round 2 blob `674cc08f563d781d52596500e14a7077e0e2fd8a`. All nine scoped findings are resolved.

### Prior findings

- **Codex R4 B1 — RESOLVED.** The generated-reference schema and expected-generation schema are now explicitly separate axes, with an exact `QueryMaterializationPreimageV1`. The text requires matching app IDs while forbidding comparison of the two schema versions and requires byte equality for the complete expected-generation record ([LLP 0157 §3.2.6](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:491)). This matches the current generator, where references use `snapback.v0` while session generation uses `snapback.v1` ([codegen](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:168), [generated fixture](/Users/ccheever/projects/snapback/tests/acceptance/fixtures/app-cli-journey/generated/api.mjs:30)).

- **Claude R2 B1 — RESOLVED.** This is the same underlying schema-axis defect. The closed materialization preimage and explicit non-comparison rule above resolve it without collapsing the two version domains.

- **Codex R4 B2 — RESOLVED.** `ArgumentBindingContractV1` now defines the exact per-binding preimage `{format, required, value}`, its domain separator, declaration-order hashing, carried descriptor and digest, and refusal behavior ([§3.2.2](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:352)). It projects the exact binding entry owned by LLP 0131 while remaining distinct from the whole-root merged-argument contract ([LLP 0131](/Users/ccheever/projects/snapback/llp/0131-structured-argument-contracts.spec.md:204)).

- **Codex R4 B3 — RESOLVED.** `AuthorityPartitionV1` is now a closed authority/data partition containing principal scope, authority instance, authorization fingerprint, and tenant/provider/delegation discriminators. `sessionGeneration` is explicitly excluded as observability rather than authority identity ([§3.2.7](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:537)). This composes the two axes from LLP 0039 with LLP 0114’s closed authority-partition requirement ([LLP 0039](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:1286), [LLP 0114](/Users/ccheever/projects/snapback/llp/0114-first-class-react-and-query-groups.spec.md:200)). The required headless projection is accurately treated as a new implementation seam; current code still exposes the relevant pieces separately ([client](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:2921)).

- **Codex R4 B4 — RESOLVED.** The authorization witness has an exact record, and the minimum accepted authorization version is checked against the current query instance, incarnation, epoch, and proof stream. The same checks are mandatory at install, retained boot, and every render; non-null data additionally requires `commitVersion >= minimumAcceptedVersion` ([§3.3.3](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:896)). This preserves LLP 0053’s exact-instance fence and monotonic accepted-version rules ([LLP 0053](/Users/ccheever/projects/snapback/llp/0053-local-first-offline-cache-and-deterministic-invalidation.spec.md:1111)).

- **Codex R4 B5 — RESOLVED.** Cursor profiles now have a total assignment table, including an explicitly reserved `none` profile, with refusal on unassigned or mismatched operation classes ([§3.2.9](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:724)). `NodePageBoundaryV1` gives exact signed boundary variants for scalar and multi-column ordering, including ordered fields and terminal row identity ([boundary grammar](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:751)). These preserve LLP 0080/0110 cursor ownership and match the existing Rust bounded-child body shape ([Rust cursor body](/Users/ccheever/projects/snapback/src/bounded_children_cursor.rs:24)).

- **Codex R4 M1 — RESOLVED.** The 8,192-byte maximum is computed from the complete invocation template before the first page is stored. The template counts every body field plus fixed framing, uses the actual constants and arguments, and conservatively substitutes 36-byte UUIDv7 and 16-digit portable-version widths for storage-derived values ([§6.8](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1579)). Those bounds match current UUIDv7 incarnation generation and the portable maximum-safe-integer version limit ([storage](/Users/ccheever/projects/snapback/src/storage.rs:15960), [manifest](/Users/ccheever/projects/snapback/src/manifest.rs:6308)).

- **Codex R4 M2 — RESOLVED.** The `sbsb1` body now has a closed field order and exact compact-JSON rules: declaration order, no whitespace, RFC 8785 string/number grammar, no Unicode normalization, lone-surrogate refusal, verbatim canonical argument nodes, exact boundary variants, and millisecond timestamps with the stated delta constraint ([§6.7](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1511)). It requires a shared Rust/JavaScript conformance vector. The definition also remains compatible with the present Rust signing envelope and canonical client-value implementation ([Rust](/Users/ccheever/projects/snapback/src/bounded_children_cursor.rs:87), [JavaScript](/Users/ccheever/projects/snapback/packages/snapback-client/canonical-client-value.mjs:103)).

- **Codex R4 M3 — RESOLVED.** The inspector now exposes requested, established, and current completeness versions separately. It also defines an exact authorization-dependency descriptor, digest, server projection, resolution path, and client dependency count ([§4.4](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1099)). This satisfies LLP 0155 Move 2’s requirement to distinguish snapshot state and surface authorization dependencies ([LLP 0155](/Users/ccheever/projects/snapback/llp/0155-distributed-systems-hardening-plan.plan.md:566)).

### Interaction and current-tree checks

- `PlanHashV1` commits the ordered child plans, exact binding contracts, parent group, and liveness; QMK separately commits the materialization preimage and complete authority partition ([PlanHash](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:416), [QMK](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:577)).
- Per-child liveness is carried explicitly by capability binding and is never inferred from query shape, preserving the LLP 0090 mixed-route proposal ([binding](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:300), [LLP 0090 proposal](/Users/ccheever/projects/snapback/llp/0090-relational-read-pushdown.spec.md:31)).
- Proof verification is anchored in an installed key manifest; no received proof may bootstrap its own verifier ([§3.3.2](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:842)).
- Cursor ownership remains with LLP 0110/0135 until Charlie accepts the ownership transition. The transition and downstream ticket dependency are explicit ([§6.9](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1629)).
- The Move-2 seam is closed across materialization storage, witness/proof separation, QMK-based canonical query identity, render admission, and the per-app/storage-partition AuthCoordinator ([§5.3](/Users/ccheever/projects/snapback/llp/0157-composition-algebra-and-completeness.spec.md:1301)).
- Current-tree searches confirm these definitions remain proposed contracts rather than falsely claimed implementations.

New BLOCKING findings: none.
New MATERIAL findings: none.
New NIT findings: none.

This is a confirmation-review conclusion only; it does not accept the Spec.

READY — confidence 0.97.
