# LLP 0157 composition algebra review — Claude family

## Round 1 — 2026-08-03

**Reviewer family:** Anthropic Claude
**Provider / runtime:** Claude Code 2.1.220, `claude --print`, model
`claude-fable-5`, effort `max`, permission mode `plan`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author, non-persistent Claude Code context over the
modified working tree at base 29699bd66c16 (v0.3); instructed to read
AGENTS.md, LLP 0157, LLP 0155 Moves 1–2, the commission, LLP 0090's
2026-08-02 proposal, and the relevant 0135/0110/0053/0080/0114/0120 owners;
inspect current code for every current-tree claim; and not read any 0157
review artifact. Orchestrated by the current authoring session, which does
not count as a reviewer. The response below is verbatim.

---

# Review: LLP 0157 — The composition algebra, plan identity, and the completeness witness (working-tree v0.3)

Fresh independent Claude-family review for the LLP 0005 loop. Blind constraint honored: no file under `llp/reviews/` beginning `0157` was read (only its existence was confirmed by directory listing, to check the Status section's claim). Evidence base: full reads of the target, LLP 0155 (Moves 1–2 and framing sections), the commission ticket, LLP 0090's 2026-08-02 amendment proposal, LLP 0135 Part 2 + implementation record, LLP 0110's cursor protocol and landing evidence, LLP 0053's witness/fence sections, LLP 0080 §3–4, LLP 0114, LLP 0120 option 3a — plus direct implementation inspection of every current-tree claim the draft makes (`src/bounded_children_cursor.rs`, `packages/snapback-harness/ctx-bootstrap.js`, `tests/local_v0.rs`, `tests/workerd_twin_v0.rs`, `src/local.rs` delta-lane admission, `tests/live_delta_v0.rs`, LLP 0112 format-1 gates in codegen/client/server, `src/auth/invalidation.rs`, `packages/snapback-client/canonical-client-value.mjs`, and the conformance vector file).

## Overall assessment

**NOT READY** — confidence: high.

This is a strong v0.3: the architecture is right, the owner boundaries are scrupulous, and — notably — **every current-tree claim I checked is true**, several to the byte. But two defects survive in exactly the precision class the v0.3 header claims closed. First, the sbsb1 static size budget's stated computation omits the `args` member that this draft's own body redesign introduced, which breaks the "no data-dependent pagination cliff" derivation §D8 exists to prove. Second, the identity/proof stack — declared "closed byte-for-byte," with A2 requiring cross-language reproduction of "every §D2 preimage and output byte" — still contains members no implementer can produce bytes for without inventing something (`mergedArgsContractHash`, the `activationHash` owner/preimage, the boundary-vector encoding, the cursor-digest domain binding, concrete `classId`/`classVersion` registry values, the `encodingId` vocabulary). Both are narrow textual closures, not design rework; the distance to READY is short.

## Strengths

1. **Current-tree honesty is exemplary — verified.** The sbbc1 registry entry in §D8 is byte-accurate to the shipped implementation: the 17-field body order matches the `Body` struct's serde declaration order exactly; HKDF roles (resume root as IKM, purpose as salt, UTF-8 `keyGeneration` as info), the AAD framing (purpose bytes *not* length-framed, then app/database/target each as 4-byte big-endian length + UTF-8 — the draft's spelling is more precise than LLP 0110's "length-framed … tuple" prose and matches the code), the exactly-14-day interval check (`expires_at − issued_at != MAX_AGE_MS` is an exact-equality rejection in the decoder, not a max-age check — the draft got a subtle fact right that LLP 0110's own text understates), future-issuance rejection, `deny_unknown_fields`, the 1,024-byte cap, and the committed Rust/Node fixed-nonce vector all check out. Likewise `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED` (the crosswalk's "specifically the inline-handler `collect()` 1,024-row seam… with local/workerd regressions" is exactly right, and no declarative path emits it), the delta lane's exact structural equality against the schema-derived `documents(table)` descriptor with both narrowed-contract regressions, LLP 0112 format 1's all-`LiveQuery` gates at four layers, and the confirmed absence of all eight new identity types from code.
2. **The liveness-in-identity design is the right answer to LLP 0090's seam, and it is complete.** `NodeCapabilityBindingV1` inside `NodePlanRecordV1`, the `internal`/`Query`/`LiveQuery` pairing constraints, A3's byte-identical-storage-plan near-miss oracle, and §D4's "Mixed route is a distinct profile" together satisfy all the amendment proposal's demands this Spec can satisfy: registration only for `live.kind === "admitted"` children, read-only ordinary children, per-child identity rotation on liveness change, a new artifact/wire version, and — verbatim from the proposal's requirement — no rediscovery of liveness from plan shape.
3. **Fail-closed completeness is coherent end to end.** `unknown` locally producible, `complete` server-derived, `prefix` producerless with a named unreserve path (OQ8), `refused` closed; the sealed-composite-is-`complete` resolution correctly treats LLP 0135 §2.3's byte-identical envelope as the admitted result while disclosing no cause; the product state with a total, closed event table (unknown events rejected, LLP 0053 precedence stated) is a real improvement over a fifth enum.
4. **LLP 0053 fidelity in §D7.** The exact `(query_instance_id, authority_generation, query_generation)` compare-and-commit on every operation, no check-then-read gap, quarantine-preserves/delete-destroys+tombstone, `active → retiring → removed`, never-strand-under-unreachable-key, and the explicit `CompositeWitness`-vs-completeness-proof distinction all match LLP 0053's Client fences section faithfully; fence state is correctly excluded from the reusable key.
5. **Owner-boundary discipline.** Restated owner facts are restated exactly (I verified the `snapshot-batch.v1` classification record against LLP 0135 §2.5, the seal envelope against §2.3, the dedup-key encoding against §2.2, and the 8,192/8,186/6,139/6,099 arithmetic, which is correct); the meet algebra is properly deferred; the ownership transition is properly gated on acceptance with LLP 0110/0135 governing until then; the Status section does not read a Charlie decision into anything.
6. **The commission crosswalk earns its keep** — including the honest recordings that Fleet's exit is blocked on LLP 0135 OQ5 and that the interim fail-closed milestone exists today only as the imperative `collect()` seam, not the public witness.

## Concerns

**1. [BLOCKING] §D8's static cursor budget omits the `args` member its own body split introduced.** The budget rule reads: "Establishment computes the maximum serialized plaintext size from the fixed envelope, each deduplicated parent, and every node's declared boundary types." But this draft deliberately split LLP 0135 §2.4's design — where the composite's non-cursor argument values *were* the deduplicated parent bindings ("for bounded-children nodes these are exactly the parent ids, bound once per deduplicated parent declaration") — into two distinct plaintext members: `parentGroups` *and* a separate `args: unknown // complete non-cursor CanonicalClientValueV1`. A `CanonicalClientValueV1` can reach 262,144 canonical bytes — larger than the entire 6,099-byte plaintext budget — and the stated computation never counts it, nor says how (`actual serialized bytes` vs. declared worst case) the other invocation-variable strings (`function`, `keyGeneration`, `streamEpoch`, `authorityPartition`) are counted. A composite the stated check admits can then fail mint at page 1, which reintroduces exactly the data-dependent refusal LLP 0135 confined to custody grounds, and falsifies the section's own "Runtime oversize is therefore not a data-dependent pagination cliff." *Resolution:* enumerate the computation over every plaintext member: invocation-constant members (including `args`, which is fixed for the whole pagination) at their actual serialized bytes at establishment; per-deduplicated-parent bindings at their closed widths; per-node boundary states at declared-type worst case with `maxEncodedBytes` JSON-serialized as already specified. State explicitly that because `args` is invocation-constant, an establishment-time check on actual bytes preserves the no-mid-flight-cliff rule (for v1, id-typed parent args keep the whole check authoring-time computable; string-arg successors move the arg term to invocation time), and that oversize still refuses with `SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED` before the first page.

**2. [BLOCKING] The identity/proof stack still has members no independent implementation can reproduce byte-for-byte.** The v0.3 header claims "The identity stack is now closed byte-for-byte," and A2 requires codegen, Rust admission, and the JS client to "reproduce every §D2 preimage and output byte." Members that currently cannot be produced from this Spec plus its cited owners: (a) `mergedArgsContractHash` in `NormalizedCompositePlanV1` — no domain string, no record, no owner citation at its site; the later sentence "LLP 0131 governs the carried contract-descriptor hashes" sits under `QueryMaterializationPreimageV1` and most naturally covers `function.argsContractHash`/`resultContractHash`, and even read generously, the *merged* descriptor's construction (member order, same-name dedup per LLP 0135 §2.1) is undefined; (b) `activationHash` — used in the materialization preimage and the proof, and carrying a new MUST ("The activation preimage MUST carry that digest"), yet no owning document or preimage for "activation" is ever named; (c) `PageIdentityV1`'s cursor `digest` members — "cover the exact wire credential," but the draft never ties them to the `OpaqueCredentialDigestV1` domain it defines two paragraphs earlier, leaving the domain separation of a signed field ambiguous; (d) `boundaryVectorDigest` — the domain string is given but the canonical record for "the server-internal complete per-node boundary-or-terminal vector" (and the `none.v1` "canonical empty vector") is not, which matters for Rust/Cloudflare server parity; (e) the admitted-class registry that D1 rule 2 declares "the single place a new class is recorded" appears nowhere as an actual table, so the concrete `classId`/`classVersion` values (`relational_query_v1`, `bounded-children.v1` — note the two inherited spelling conventions) that enter `NodePlanRecordV1` and the signed proof are unpinned; (f) `ResultDigestV1`'s `encodingId` vocabulary. *Resolution:* pin each — a domain string + closed record (or explicit owner-and-construction citation) for (a) and (b); one sentence each tying (c) to `OpaqueCredentialDigestV1` and giving (d) a closed record; an actual registry table for (e) with exact strings and versions; a registered initial `encodingId` value for (f).

**3. [MATERIAL] Adopting `qmk1` as the durable store address rewrites LLP 0053's `query_key` without commissioning the reconciliation.** `ClientMaterializationAddressV1` is declared to be "the LLP 0053 durable store/namespace address," and §D7 allocates `query_instance_id` under it — i.e., the `query_key` member of LLP 0053's `ClientQuery`/`Subscription` namespace (defined there as "the canonical function-plus-arguments retained-store key," and minted today in `packages/snapback-client` as `retainedQueryKey(name, args)` into the wire-validated `QueryNamespace.queryKey`) becomes the qmk1 spelling. The server treats the field as an opaque discriminator so the wire survives, but the owning definition changes, and the Ownership-transition section commissions dated boundary notes only in LLP 0110 and LLP 0135. The relationship to the LLP 0043/0053 lease-backed retained store (which LLP 0090 v0.6 explicitly keeps separate and untouched) is likewise unstated in §Migration, which covers only RQS snapshots. *Resolution:* commission a dated LLP 0053 note (and 0043 if the lease store is affected) in the same acceptance landing — `query_key`'s canonical spelling for materializations under this Spec is the qmk1 subkey — and add one Migration sentence stating whether existing lease-store entries adopt, coexist with, or migrate into `MaterializationRecordV1`.

**4. [MATERIAL] The closed ordinary projections do not discharge LLP 0155's inspector enumeration, and the crosswalk doesn't disclose the gap.** LLP 0155's inspector must answer "which indexes, bounds, joins, and aggregate ceilings the plan uses" — §D6's underlying model lists "node plan explanations, indexes, bounds," but neither closed projection carries any of them (only `examinedEntryCeiling` and hashes), and a model fact reachable through no projection is dead. "Which pending intents currently affect its presentation" is reduced to `pendingIntentCount` with intent ids deliberately redacted to the audit channel — defensible, but the crosswalk row for inspection doesn't record that two 0155 bullets are satisfied only via redaction/indirection. Separately, `ClientCompositionInspectionV1` omits the owning function identity entirely (no `functionId`/name), so the store's own developer cannot answer 0155's first inspector question ("which generated query… own[s] it") from the ordinary client artifact, despite the function being the app's own artifact fact with no partition-boundary concern. *Resolution:* add static plan-explanation fields (index names, declared bounds, per-node ceilings — artifact facts, not runtime data) to the server projection or state normatively that plan explanation resolves through `nodePlanHash` against the served manifest; add function identity to the client projection; record the pending-intent redaction decision in the crosswalk row.

**5. [MATERIAL] The cursor-profile id vocabulary is minted here but attributed to owners as pre-existing.** §D3 calls `profileId` "the owner-registered cursor profile (`none.v1` for an unpaginated single-node plan, `relational.v1`, `bounded-children.v1`, or `snapshot-batch.v1` today)." No such registry or names exist today: LLP 0080's cursor is unnamed ("opaque and versioned"), and `none.v1`/`relational.v1` appear nowhere else in the corpus or code. These strings enter `PageIdentityV1` and therefore the signed proof bytes. *Resolution:* state that this Spec mints and owns the cursor-profile id registry (distinct from §D8's envelope-prefix registry — the two axes should be explicitly distinguished), pin the exact strings, and note owner concurrence for naming their cursors in the acceptance boundary notes.

**6. [MATERIAL] A6's "swap same-version batch ids" oracle is ambiguous against §D3's set rule.** `BatchIdentityV1` is per-establishment-attempt and deliberately *not* among `PageSetIdentityV1`'s shared fields — a multi-page set necessarily holds distinct batch ids, and §D3's completeness conditions never mention batch continuity. Under one reading A6's case is tamper detection (moving one proof's `batchIdentity` into another must fail signature verification — consistent); under the other it demands that a legitimately re-established, chain-continuous, same-version page from a different attempt poison the set — which §D3 does not require, and an implementer following A6's stricter reading would add an unstated set condition. *Resolution:* one sentence in A6 naming the intended mechanism ("tampered `batchIdentity` fails proof signature verification; batch continuity is deliberately not a set condition — a re-established page whose credential chain and version match remains admissible").

**7. [MATERIAL] The relation between `ProviderMaterializationAddressV1` and LLP 0114's implemented store key is unstated.** LLP 0114's registry key is the frozen, golden-vectored `["snapback:react-store-key:v1", providerInstanceId, {artifactKind,schemaVersion,appId,id,name,kind}, canonicalArgs]` — a live, implemented identity (`canonicalReactStoreKeyV1`). §D2 declares its own tuple "the LLP 0114 in-memory provider registry address" and separately forbids deriving "a parallel semantic identity." As written, either the existing react-store-key becomes a violation of this Spec's own rule, or it is the blessed index — the text doesn't say which, and the react key binds strictly less (no activation/deployment/plan/authority-partition facts). *Resolution:* one paragraph: the 0114 key remains the unchanged UI-level index within one provider lifetime (its bytes and vectors untouched); `ProviderMaterializationAddressV1` is the semantic identity beneath it; name whether a dated 0114 note rides the acceptance landing.

**8. [NIT] Related header omissions.** LLP 0043, 0048, 0108, 0112, 0133, and 0134 are all load-bearing citations in the body (outbox custody, diagnostics registration, result contracts, mixed-route artifact format, settlement seam, acknowledgment-gate locus) but absent from `Related:`.

**9. [NIT] "Restored verbatim"/"reproduced exact" overstates the exit-gate transcription.** Wording deltas vs. LLP 0155 exist ("rather than"→"not"; "the inspector"→"inspection"; "fixtures" dropped), and one is a real tightening: the normalization carrier case fires "if normalization is ever *proposed*" where 0155 says "if… *admitted*." The tightening is good — but mark it as a deliberate strengthening or make the lists byte-verbatim; "exact" should not paper over a semantic delta.

**10. [NIT] Disambiguate the two `planHash` fields sharing one body-field name across the family.** sbbc1's body `planHash` is today the untagged `sha256_identity` of the serialized `BoundedChildrenPlan` (computed in `src/local.rs`, frozen by the committed vector); sbsb1's body `planHash` is "recomputed `PlanHashV1`" (domain-separated, capability-bearing). A held-implementation reader could "unify" them and break the frozen sbbc1 vector. One sentence in the family registry noting the deliberate divergence protects it.

**11. [NIT] Evidence-pin typo: the commissioning acceptance commit.** The header cites "LLP 0155's acceptance (fc19d8ec)"; the repository has no such object — the acceptance commit is `fc19d8ed` ("docs(llp): accept LLP 0155 local-sync direction…"), as the commission ticket also records.

**12. [NIT] Small wording/typing closures.** "Clients persist only the public verification key and its *signed* manifest" — the manifest is digest-bound via `activationHash`, not signed; reword. `subscription.connectionState: string` is an open string inside an otherwise closed §D7 record — pin the enum or cite its owner. `PageSetIdentityV1`'s fields are typed bare `string` where sibling records use `` `sha256:${string}` ``. And `visibleRows[].retainingMaterializationKeys` is structurally a singleton in v1 (a store-salted digest of *result* identity cannot match across queries) — one sentence saying the plural is the normalization-upgrade seam would prevent readers inferring cross-query row sharing exists.

## Suggestions

- Add one worked two-node `NormalizedCompositePlanV1` example (with its `PlanHashV1` and a `qmk1.…` spelling) as non-normative illustration; it would make A2's vector authoring and the near-miss rotation matrix concrete.
- In §D3, note explicitly that the proof's `nodes` array is deliberately redundant with `planHash` (defense in depth for offline verifiers), so future reviewers don't flag it as identity duplication.
- In the fail-closed floor paragraph, add the one-line current-tree fact the crosswalk implies: the declarative LLP 0080 grammar carries explicit bounds and keyset continuations, so the imperative `collect()` seam is the only implicit-cap ambiguity on current main — that's the evidence for "no code path may translate a cap hit into silence" being achievable in the interim.
- Consider stating the page-set manifest's behavior when a referenced fragment is individually destroyed by an LLP 0053 disposition (the derived answer — set decays to `unknown` — is correct but worth one sentence next to `commitPageSet`).

## Open questions

1. Is instance-binding of `CompletenessProofV1` (via `queryInstanceId` in both the proof and `AuthorizationWitnessDigestV1`) deliberate load-bearing anti-replay, accepting that reinitialization after retirement discards otherwise-valid proofs? A sentence of rationale would prevent a future "optimization" that weakens it.
2. Where does the proof-key manifest live across activation swaps? A retained lease can outlive the activation that bound the manifest ("must remain available at least as long as the longest admitted retained lease") — does the client persist the old manifest alongside fragments, or must the server serve retired manifests?
3. Does the `sbsb1` `args` member carry the composite's merged args exactly as `canonicalArgs` (LLP 0114 serialization) or in a cursor-local encoding? B1's fix should answer this as part of pinning the budget term.
4. For the mixed-route successor: does a `live.kind:"none"` child inside a mixed group still get a `QueryMaterializationKeyV1`-addressed materialization record (read-only, no subscription), or only the live children? §D4.5 implies per-child identity for all; one clause would settle it.

## Recommended next step

Apply the two BLOCKING pins (the §D8 budget-term enumeration and the §D2/D3 preimage closures) and the five MATERIALs as v0.4 — all are localized text changes with no architectural movement — then run the fresh dual-family round the Status section already prescribes. Given how much of v0.3 verified clean against both the owners and the implementation, I'd expect v0.4 to be a genuine READY candidate. Acceptance, per the commission and LLP 0130 SD-4, remains Charlie's.

---

## Round 2 — 2026-08-03

**Reviewer family:** Anthropic Claude
**Provider / runtime:** Claude Code 2.1.220, `claude --print`, model
`claude-fable-5`, effort `max`, permission mode `plan`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author, non-persistent Claude Code context over the
modified working tree at base 29699bd66c16 (v0.4); instructed to read
AGENTS.md, LLP 0157, both prior family artifacts, LLP 0155 Moves 1–2, the
commission, LLP 0090's 2026-08-02 proposal, and the relevant owner documents;
audit every prior BLOCKING/MATERIAL finding and inspect current code for facts
affecting the verdict. Orchestrated by the current authoring session, which
does not count as a reviewer. The response below is verbatim.

---

# Review: LLP 0157 v0.4 — Claude-family delta review (Round 2)

Fresh non-author delta review for the LLP 0005 loop. Evidence base: full reads of v0.4, both review artifacts (Claude R1, Codex R1–R3), LLP 0155 Moves 1–2 plus its §Risks stop-rule text, the commission ticket, LLP 0090's 2026-08-02 amendment proposal, and the owning sections of LLP 0135 Part 2 (+OQ5), 0053 (dispositions, client fences, witness, lease, `query_key`), 0110 (`sbbc1`), 0080 (§3–4 and the 2026-08-02 boundary note), 0114, 0131, 0120, and 0043. Every current-tree claim bearing on the verdict was checked in code — the `sbbc1` Body order/AAD/expiry/cap/HKDF/vector, the `CompositeWitness` serde projection, the cap seam and its regressions, the delta-lane gate, the authority descriptor, the generated `expectedGeneration` object and its hash spellings, canonical-value limits, server `query_key` opacity, and the confirmed absence of every new identity type and of `sbsb1` from code. The full review is also written to the plan file.

## Overall assessment

**NOT READY** — confidence high (~0.9).

The delta is overwhelmingly clean: **every** Claude Round-1 BLOCKING/MATERIAL finding and **every** Codex Round-3 finding is genuinely resolved in v0.4, most with verifiable byte-level closure. But one v0.4 fix introduced a new defect in the identity stack's own refusal rules — the same precision class both prior rounds blocked on — and it survives contact with committed generated artifacts. Distance to READY: one sentence plus nit sweeps.

## The blocking finding

**1. [BLOCKING] §D2's `function.schemaVersion` = `function.expectedGeneration.schemaVersion` refusal contradicts every committed sessions-mode generated reference.** These are two different version axes: the reference's top-level `schemaVersion` is the artifact-format version (`SCHEMA_VERSION`, `snapback.v0` for all current references — `packages/snapback-codegen/index.mjs:7428ff`), while `expectedGeneration.schemaVersion` is the generation artifact version (`artifactVersion`), which is `snapback.v1` under sessions (`index.mjs:8671ff` branches on `artifactVersion === SCHEMA_VERSION && authMode === 'dev'`). Verified in committed artifacts: `tests/acceptance/fixtures/app-cli-journey/generated/api.mjs:42` (`"schemaVersion": "snapback.v0"`) vs `:35` (`"schemaVersion": "snapback.v1"` inside `expectedGeneration`); the asset-conformance fixture matches. The two coincide only in dev mode, so dev fixtures pass — but under `authMode: "sessions"` (a value the activation record itself defines) the constraint "refuses before hashing," meaning no sessions-mode `QueryMaterializationKeyV1` can exist, and A2 — which requires reproducing every preimage "including the current five-field `ExpectedGenerationV1`" — refuses instead of reproducing. Note A2's own near-miss list tests only app-id mismatch, never this equality; the clause is vestigial. This is fix-introduces-defect: the three appId equalities Codex R3-2 requested are correct; the schemaVersion equality was over-generalized.

*Minimal correction:* delete the clause, or restate the two members as distinct owner-carried version axes preserved verbatim (reference artifact-format version vs generation artifact version; equal today only in dev mode), with only the three appId equalities refusing before hashing. If a version-coherence check is wanted, the sound one is `function.expectedGeneration` byte-equal to the activation's `expectedGeneration` — one generation per activation, true of current artifacts — not the intra-reference equality.

## Claude Round-1 audit (all findings)

- **B1 (sbsb1 budget omits `args`) — RESOLVED.** §D8 now counts "**every** body member": the actual complete `args` serialization (with the invocation-constant rationale that keeps the no-mid-flight-cliff derivation sound), the key-generation manifest's maximum spelling, actual invocation constants, per-deduplicated-parent constant identity plus safe-integer version widths, both timestamps, JSON punctuation/escaping, and per-node max(terminal, owner-declared worst-case boundary); refusal is `SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED` before the first page, with the mint-time wire cap as defense in depth that is "never a terminal result or a data-dependent pagination cliff." `args` is pinned as "the exact canonical JSON value used as §D2 `canonicalArgs`."
- **B2 (six unreproducible identity members) — RESOLVED on all six.** (a) `MergedArgsContractV1` closed record, domain string, and walk/merge rule; (b) `CompositionActivationIdentityV1` with domain-separated hash and dual exact-recompute; (c) "Every `CursorEndV1.digest` is this digest" ties cursor digests to `OpaqueCredentialDigestV1`; (d) `snapback.page-boundary-vector.v1` closed record with per-node `boundaryDigest` formula and the canonical empty vector; (e) the §D1 registry table with exact `classId`/`classVersion` values; (f) `established-result-jcs.v1` registered with an amendment rule.
- **M3 (qmk1-as-`query_key` uncommissioned) — RESOLVED.** §D7 states the canonical-`query_key` adoption with dated LLP 0053 *and* 0043 boundary notes commissioned in §D8's transition, and §Migration adds the legacy `retainedQueryKey` paragraph (adopt only when recomputable, otherwise coexist non-renderably then retire, never relabel in place). Verified: the server treats `query_key` as an opaque ≤8,192-byte unparsed string (`src/auth/invalidation.rs:776ff`), so "producer migration rather than a wire shape change" is exactly right; the 48-byte `qmk1` spelling fits.
- **M4 (inspection gaps) — RESOLVED.** Server `plan.nodes` now carries `indexIds`, `declaredBounds`, `joinKinds`, `aggregateCeilings`, `examinedEntryCeiling`; the client projection gains `functionId`; the crosswalk row records the pending-intent redaction/indirection decision.
- **M5 (cursor-profile vocabulary) — RESOLVED.** The registry is stated as minted here, distinct from §D8's prefix registry, with owner naming concurrence in the boundary notes; `relational-query.v1` replaced the invented `relational.v1`.
- **M6 (A6 batch-id ambiguity) — RESOLVED.** "Tampering a proof's batch id fails its signature, and batch continuity is not a page-set rule," plus the signed-substitution chain-break case.
- **M7 (LLP 0114 react-key relation) — RESOLVED.** The index-not-identity paragraph, no byte migration, dated 0114 boundary note. (One residue became NIT 2 below.)
- **N8–N12 — all RESOLVED** (Related extended with 0043/0048/0108/0112/0133/0134; "verbatim" claim replaced by the explicit strengthening note; dual-`planHash` divergence sentence; `fc19d8ed` corrected; digest-bound trust-anchor wording, closed `connectionState` enum, `sha256:`-typed page-set fields, singleton `readonly [string]` retaining tuple with the normalization-seam sentence). All four R1 open questions are answered in text.

## Codex Round-3 audit (all findings)

- **R3-1 (universe not closed) — RESOLVED.** LLP 0004/0007 single-table and imperative/inline plans are "not silently reclassified… refuse composition until an owner-governed node class is registered"; parent-group coverage is conditional via the registry's required/none column and rule text; the OQ5 successor is pinned as a new versioned plan/cursor profile that "reuses the record shapes in §D2–D7… not the node vocabulary or liveness inference rules." (Residual scoping ambiguity is NIT 3.)
- **R3-2 (QMK not byte-reproducible) — RESOLVED as to the record, but see BLOCKING 1.** The exact five-field `ExpectedGenerationV1` object is embedded, and the "preserve their current generated spelling byte-for-byte" rule matches a subtle three-way reality I verified (v0/dev: bare-hex `inputsHash` plus `sha256:`+truncated-16-hex `schemaHash`/`bundleHash`; v1/sessions: namespaced `snapback.v1:sessions:…:sha256:<64hex>` strings, with the `function` segment in `bundleHash`). The added schemaVersion equality is the new defect.
- **R3-3 (disposition bypass / no store-wide barrier) — RESOLVED.** `authorityState` is the sole mutable owner; `commitPage` "never lowers disposition" and applies only a `resolutionBundle` of LLP 0053's exact scope ids/proofs/ACK tokens while recomputing the maximum over unresolved scopes; op 7's store-wide barrier with receipt-gated successor initialization plus A8. All verified against 0053's §Client fences and §Dispositions.
- **R3-4 (offline proof trust) — RESOLVED.** `AuthorizationWitnessRecordV1` is exact and *verified against the Rust*: `src/auth/invalidation.rs:879ff` serializes camelCase `{versionStream, minCommitVersion}` with `data` as explicit `null` (no `skip_serializing_if`) and epoch capped at the safe-integer max — the spec's "null, never omission" and "portable safe integers" are byte-accurate. Trust anchor is the closed read-only generated bundle artifact with exact-match and degrade-to-`unknown` rules; Ed25519's 64 decoded bytes and the cursor-credential digest type are pinned.
- **R3-5 (inspection byte-exactness / batchIdentity) — RESOLVED.** All digest domains/preimages frozen including `LocalRowHandleV1`'s HMAC key lifecycle; `maxDisposition` closed; `batchIdentity` removed from ordinary inspection with the paired-worlds rationale.
- **R3-6 (multi-membership impossible) — RESOLVED.** Membership is one row occurrence in one page; singleton tuple; A9 says "singleton occurrence membership"; the plural field is the gated normalization seam.
- **R3-7 (crosswalk overclaims) — RESOLVED.** §D1's growth stop rule faithfully implements LLP 0155:1287–1290 (maximum vocabulary 6/4, one-per-amendment cumulative budget, RFC escalation reconsidering the thesis); first-party-arm/OQ16 and volatile/degraded-target rows added, backed by §D7's `volatile-online-v1` profile with the structured durable GAP and Contract-arm honesty rule.
- **R3-8 (falsifiers don't follow) — RESOLVED.** A6 rewritten as above; the §D3 retained-boot failure table maps each corruption class to its exact store mutation/status/render, and I verified each row against the owners: malformed/mismatched/expired/rollback-tainted lease → delete-before-read (0043's fail-closed list), same-incarnation newer-epoch witness → quarantine-before-read, missing/wrong-incarnation/stream witness → delete-before-read (0053's offline/boot pins), artifact change → delete, proof corruption → discard + `unknown` never lowering a disposition. All four R3 open questions are answered in text.

## Fresh-pass verification highlights

The `sbbc1` registry entry remains byte-accurate to `src/bounded_children_cursor.rs` (17-field serde order; raw purpose + 4-byte-BE-length AAD; exact-equality 14-day interval rejection; 1,024 cap; HKDF roles; 24-byte nonce; both fixed-nonce vector legs). `sbsb1` has no code predecessor, and the held 0135 ticket is Open with its "whoever lands first pins it" note — §D8's acceptance-gated ownership transition honors both queued consumers, and §D2/D4.5/Migration satisfy all five demands of 0090's mixed-route amendment without shape-derived liveness. The 48-byte `qmk1` and 8,192→8,186→6,139→6,099 arithmetic are correct. The crosswalk's cap-seam and delta-lane claims are exactly true (`ctx-bootstrap.js:642ff` is the sole emitter; `local.rs:3245ff` ends in structural equality; `live_delta_v0.rs` covers both narrowed-contract paths). The authority descriptor is the closed three-member record the spec claims.

## NITs (would not block READY)

2. **§D2 "including its committed vectors"** overstates: committed vectors pin the inner `CanonicalClientValueV1` grammar only; no test imports `canonicalReactStoreKeyV1` and no assembled-key vector exists in the tree. Reword or drop the clause (the key's vector obligation is LLP 0114's own gap).
3. **Single-node parent-group scoping.** The rule "every node whose §D1 registry row says `required` appears in exactly one group" reads as unconditional, while the preceding sentence makes single-node groups "empty unless that owner defines a group." State explicitly that the `required` column governs multi-node profiles and that a `single-node.v1` bounded-children plan has `parentAuthorizationGroups: []`; pin with a single-node vector, since the two readings produce different `PlanHashV1` bytes.
4. **§D7 op 7's "LLP 0039/0053 store-wide AuthCoordinator."** The implemented coordinator (`packages/snapback-contract/auth-coordinator.mjs`) is the LLP 0059 per-app-id cross-context custody artifact with stores as registered participants — "store-wide" describes the barrier's coverage, not the coordinator's scope, and 0059 deserves the citation. Semantics are unambiguous; fix the parenthetical.
5. **Stale G-02 pointer.** §D5 and §Status cite `issues/20260802-convex-erg-02-move1-type-flow-remainder.md`; it was resolved 2026-08-02 into `issues/closed/` (its resolution explicitly honored the no-parallel-shapes boundary). Update the path and the waiting-consumers tense.

## Verdict

**NOT READY** — confidence high (~0.9). One BLOCKING finding (the §D2 schemaVersion equality, minimal correction given above); no MATERIAL findings remain; four NITs may remain under READY. Everything else in v0.4 verified clean against both the owners and the implementation, so with that one clause fixed I would expect the next delta round to be a genuine READY candidate. Acceptance is Charlie's; this review does not accept.

---

## Round 3 — 2026-08-03

**Reviewer family:** Anthropic Claude
**Provider / runtime:** Claude Code 2.1.220, `claude --print`, model
`claude-fable-5`, effort `max`, permission mode `plan`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author, non-persistent focused-confirmation context over
v0.5; instructed to audit every Claude Round-2 BLOCKING and Codex Round-4
BLOCKING/MATERIAL finding against the governing owners and current tree.
Orchestrated by the current authoring session, which does not count as a
reviewer. The response below is verbatim.

---

# Review: LLP 0157 v0.5 — Claude-family focused confirmation (Round 3)

Fresh non-author confirmation review for the LLP 0005 loop, plan/read-only mode; no repository files were edited (the review is also written to the session plan file). Evidence base: full read of v0.5 (1,911 lines); Claude Round 2 and Codex Rounds 1–4; AGENTS.md; LLP 0155 Moves 1–2 (inspector list :570–583, stop rule :1287–1289, both workload exits); the commission (`issues/20260802-0155-move1-composition-spec-commission.md` plus ruling 11 at `issues/20260802-author-decision-packet.md:214`); LLP 0090's 2026-08-02 amendment proposal; owner passages in LLP 0135, 0110, 0053 (:1111–1121), 0059, 0039 (:1286–1308), 0080, 0114 (:200–212), 0131 (:204–270); and current-tree inspection of both committed generated fixtures, `packages/snapback-client/index.mjs:2921–2945`, `canonical-client-value.mjs`, `src/rqs.rs:1349–1360`, `src/bounded_children_cursor.rs:22,26–44`, `auth-coordinator.mjs`, and the closed G-02 ticket.

## Prior-finding audit

**Claude R2-B1 / Codex R4-B1 (BLOCKING — the schemaVersion cross-axis equality) — RESOLVED.** v0.5 (0157:519–527) deletes the equality and implements both rounds' minimal correction verbatim: only the three `appId` equalities refuse before hashing; the two members are named distinct owner axes ("generated-reference artifact-format axis" vs "generation-artifact axis"), "intentionally distinct (`snapback.v0` / `snapback.v1` in current sessions artifacts) and are never compared to each other"; the sound replacement check is `function.expectedGeneration` byte-equal to the activation's `expectedGeneration`. Verified in both committed artifacts: `app-cli-journey/generated/api.mjs` has `"snapback.v0"` outer (:42, :67) vs `"snapback.v1"` inside `expectedGeneration` (:35, :60), and — decisive for the replacement rule — every reference in each fixture carries one byte-identical five-field `expectedGeneration` (one distinct bundleHash per artifact in both fixtures), so the new byte-equality is satisfiable today and does not reintroduce the defect class. A2 (:1712–1718) now requires preserving the distinct axes "without comparing them." §D2's preamble additionally exempts owner-carried generation spellings from this Spec's digest grammar (:286–288), preserving the dev bare-hex / sessions namespaced realities.

**Codex R4-B2 (per-binding contract preimage) — RESOLVED.** `ArgumentBindingContractV1 = {format, required, value}` with `value` byte-for-byte LLP 0131's frozen value node including materialized bounds; domain `snapback:argument-binding-contract:v1:`; `name` outside the semantic hash while renaming still rotates `NodePlanHashV1`; owner declaration order; supplied-hash-must-reproduce; explicit distinctness from the whole-root `argsContractHash`; `MergedArgsContractV1` requires byte-identical contract and hash on later same-name occurrences (0157:354–369, 385–414). Well-defined against LLP 0131: entries are `{"name","required","value"}` member-for-member `ResultObjectFieldContract` (0131:229–233) with "Every bound member is always present" (:261–263). This is Codex's own proposed shape.

**Codex R4-B3 (authority partition) — RESOLVED.** `AuthorityPartitionV1` (0157:537–575) is now the complete data/invocation partition: `principalDataScope {authMode, userId|null explicit-anonymous, authorizationStreamIncarnation}`, `authorityInstanceId`, `authFingerprint`, `tenantId`, `providerId`, delegation triple; `sessionGeneration` "observability, not equality … deliberately absent"; the descriptor's instance id "imported … not the whole partition." Verified against all three owners: `currentAuthorizationScope()` returns exactly `principalScope {authMode, authorizationStreamIncarnation, userId}` with the dev fallback (incarnation ← authorityInstanceId, userId ← devUserId) — the precise dev-sharing hazard B3 described, now split by `principalDataScope`; LLP 0039:1304–1308 ("Compared fields on delivery are `authorityInstanceId` only"); LLP 0114:200–212 already names `AuthorityPartitionV1` with the never-reused instance / fingerprint / tenant-provider-delegation / stream-reset axes and the `getAuthoritySnapshot`/`subscribeAuthority` seam the spec cites, with the dated 0114 boundary note commissioned (:1634–1637).

**Codex R4-B4 (authorization data floor) — RESOLVED.** The witness relationship is mandatory (0157:896–906): `queryInstanceId` + current incarnation/epoch exact-match; non-null `data` → `proof.version.stream === versionStream` and `commit >= minCommitVersion`; `data:null` contributes no floor and is admitted only as the LLP 0053 owner's exact current witness; applied at installation, retained boot, and every render revalidation (op 8 rechecks, :1401–1403). Matches LLP 0053:1115–1117 exactly. A5 tests every leg including client-authored `data:null` rejection (:1739–1743).

**Codex R4-B5 (signed boundary identity) — RESOLVED.** Total assignment registry (profile × class → cursor profile × boundary variant, :735–749); `none.v1` reserved and inadmissible with refusal on absent pairs and profile/boundary mismatches; closed `NodePageBoundaryV1` with `orderFields` (owner-plan declaration order), equal-length LLP 0051 canonical-scalar `boundary`, and `rowId` as the separate `_id` tie-break never repeated in `boundary`, validated before hashing (:753–776). Current-tree accurate: `RelationalCursorBody` has `boundary: Vec<Value>` aligned 1:1 with plan order fields plus separate `id` (`src/rqs.rs:1349–1360`); the bounded variant matches `Body`'s `order_fields`/`boundary`/`row_id`. `boundaryDigest` now hashes `{position,classId,classVersion,boundary}` (:793–796), and §D8 pins the one-to-one sbsb1 state mapping (:1559–1563).

**Codex R4-M1 (pre-storage budget) — RESOLVED.** Storage-derived parent incarnation/version use a pre-read template (36-ASCII-byte UUIDv7 / 16-decimal-digit max safe integer), explicitly "never called invocation constants," with owner-widening-amends-first and "the maximum-size refusal completes before visibility evaluation or any storage access" (:1594–1601); actual bytes only for genuine invocation constants. The UUIDv7 fact is tree-true (LLP 0131:277–279 code-verified `Uuid::now_v7()`; the client's `UUID_V7` incarnation check), and A4 adds the 6,099/6,100 template cases before storage.

**Codex R4-M2 (sbsb1 grammar) — RESOLVED.** "Ordered compact JSON is exact" (:1565–1577): declaration-order members, no whitespace, RFC 8785 string escaping (lone surrogates refuse), RFC 8785 numbers plus portable-safe-integer restriction; `args` embedded verbatim as the already-canonical §D2 bytes (sound — `canonicalizeClientValueV1` emits RFC 8785/JCS bytes); boundaries use the §D3 variants; timestamps Unix-epoch ms with `expiresAt − issuedAt === 1_209_600_000`; independent Rust/JS fixed-nonce vectors; `sbbc1` untouched (17-field order and `PURPOSE` constant re-verified against code).

**Codex R4-M3 (inspection facts) — RESOLVED.** The closed state now distinguishes `requestedVersion`, `establishedSnapshot|null`, `currentVersion|null` with exact null semantics ("never inferred from connection state or wall time," :1186–1227), and authorization dependencies are reachable via the closed descriptor: server ordinary carries sorted digests + classification + count, client carries classification + count, with the normative digest→descriptor resolution on the separately authorized served-artifact path (:1119–1142, 1211–1215, 1265–1268) — satisfying LLP 0155:579/581 in exactly the audit-only-sensitive shape Codex's resolution permitted. A9 exercises the distinct versions and dependency facts.

All prior NITs from both rounds are also closed (react-key vector overclaim; single-node empty parent groups with the `required` column scoped to multi-node; LLP 0059 coordinator attribution — per-app-id keying verified in `auth-coordinator.mjs`; the G-02 pointer now names the existing `issues/closed/` file whose resolution records the no-parallel-shapes boundary; global unsigned-UTF-8 "ascending" rule; canonical no-pad 32-byte proof keys).

**Cross-cutting:** the rotation table stays coherent with the new records (argument contract → `NodePlanHashV1`; authority partition → QMK; session-generation rotates nothing; dev users now split QMK, with the event table requiring op 7's barrier receipt on authority change); §D4.5/§Migration still satisfy all five demands of LLP 0090's 2026-08-02 proposal without shape-derived liveness; the trust-anchor artifact and manifest-digest binding are intact beneath the new floor; §D8's transition honors the commission's "whoever lands first pins it" rule; LLP 0135 §2.5 facts and LLP 0155's stop rule and exit numbers are restated exactly.

## New findings caused by the delta

1. **[NIT] `sbsb1` `parentGroups[].groupIndex` has no value definition.** The array "follows §D2 group order" and node `position` is pinned dense, but no sentence defines the integer; a 1-based implementer diverges until the vector catches it. *Correction:* one clause — "`groupIndex` is the zero-based index of the group in §D2's `parentAuthorizationGroups` order; entries are dense and ascending."
2. **[NIT] A9's dependency "handles" are unscoped.** The closed client projection deliberately carries only classification + count; digests are server-ordinary. A9's "classification, count, and handles" could read as requiring client handles, which the closed client record would refuse. *Correction:* qualify — "classification and count on both projections, digest handles on the server projection."

## Verdict

**READY** — confidence: high (~0.9). Every Claude Round-2 BLOCKING finding and every Codex Round-4 BLOCKING and MATERIAL finding is RESOLVED in v0.5 with content-pinned, current-tree-verified closure; the two remaining findings are NITs, which may remain under READY. Per the commission and LLP 0130 SD-4, acceptance is Charlie's; this review does not accept the Spec.

## v0.11 amendment loop, round 1 — 2026-08-06

**Round record (persisted before launch).** Scope: delta review of the
uncommitted v0.11 `snapshot-batch.v2` / `sbsb2` dated amendment (LLP 0157
primary; boundary notes in LLPs 0135/0080/0110). Document status: Accepted —
no status transition is authorized or applied; this is the addendum review
path. The 2026-08-05 LLP 0135 owner ruling is fixed authority, out of review
scope. Topology: single-cluster lockstep, one fresh review per family,
mutually blind; blindness is instruction-based (reviewers have repository
access) and therefore self-attested. Reviser: the orchestrating Fable
session, which does not review. Revision hashes (sha256):
0157=6ee3967d74bd601cc453536c09dcc8ba82a1bb63adf7062474fe11a708399e3d,
0135=0853be65217329bbd1ec9dd5482bbfc2fa715139cb49239cbef2bccc74bfe47e,
0080=d49ae282aefe450cfc26d076fb1aea716ee07fd7e46fa8d728f9d1a6ec0d5ce7,
0110=d1dcdf0a5b846f145388daad839db1bf5dcec86d6d8db736189a47b949fed728.
Capsule: scratchpad review-instructions-r1.md + v011-delta.diff (594 lines).
Verdict rule: READY gates on the delta; PRE-EXISTING concerns are recorded,
not gating.

**Provenance:** Claude family, fresh Opus session via the Agent tool (general-purpose, no orchestrator context), 2026-08-06. Mutually blind (instruction-based, self-attested in the body). Verdict binds to the round-1 revision hash vector recorded above. Body verbatim below.

I have read the delta, all four target documents (0157 in full), and verified the load-bearing cross-references against the owners and the source tree. Here is my review.

---

# LLP 0157 v0.11 (`snapshot-batch.v2` / `sbsb2`) — delta review, round 1

**Blindness attestation.** I read nothing under `llp/reviews/` matching `0157-*`, no other reviewer's output, and no orchestrator notes. My sources were the delta diff, the four target files (hashes confirmed identical to the review request), and repository documents/code I chose independently: LLP 0080 §§1–4, LLP 0110 (LLP 0135 fold + LLP 0157 boundary), LLP 0135 §§2.1–2.6/§3/§4, LLP 0134 §1, LLP 0004 §`SingleTablePlanV1`, `src/manifest.rs`, `src/snapshot_batch_cursor.rs`, `tests/fixtures/snapshot-batch-sbsb1-parity-v1.json`, `tests/conformance/snapshot-batch-sbsb1-parity-v1.mjs`, `scripts/verify-local-proof`. I did not review the 2026-08-05 owner ruling itself.

## Verified positives (things I tried to break and could not)

- **All four ruling pins are rendered, and rendered exactly.** Cursor binding, resume/restart, sealing, and work accounting each have a named `§D8` subsection whose clauses map one-to-one onto LLP 0135's ruling items 1–4, including the harder-to-remember sub-clauses (relational node has *no substitute parent `_version`*; a root omitted by an `inner` join still costs one joined lookup; invocation-level authorization refusal is never recoded as parent absence; an all-relational tuple has no reachable sealed envelope).
- **Budget arithmetic checks out independently.** 8,192 − 6 (`sbsb2.`) = 8,186 base64url chars; 8,186 ≡ 2 (mod 4) → 3·2,046 + 1 = 6,139 decoded bytes; 6,139 − 24 − 16 = 6,099 plaintext. The prefix is the same width as `sbsb1`, so "therefore the identical arithmetic" is true rather than asserted. The 6,099/6,100 vector pair is the correct boundary.
- **Section anchors are right.** LLP 0080 §2 does state the no-skip/no-duplicate untouched-root guarantee plus the moved-root tolerance (0080:258–262); LLP 0080 §3 *does* own "the complete conservative dependency set" (0080:357), so §D4's citation is correct even though §3 is titled "Visibility and authority". LLP 0135 §2.2 (`ParentAuthorizationKeyV1`), §2.3 (seal-entirely), §2.5 (classification), §2.6 (acknowledgment gate) all resolve correctly.
- **The §D4 v2 classification is genuinely byte-identical** to the v1 record quoted immediately above it, and `SNAPBACK_SNAPSHOT_BATCH_RESULT_CONTRACT_INVALID` is reused exactly as LLP 0135's 2026-08-04 dated addition defines it.
- **The parity-pattern claim is factually accurate, not aspirational.** `src/snapshot_batch_cursor.rs:589–621` does exactly what §D8 describes (shared committed fixture, plaintext byte-equality, wire equality, in-module drift guard against `body()`), and the independent Node consumer is registered at `scripts/verify-local-proof:134`.
- `./ref-check` is green (188 docs, 6,214 refs, 0 errors) after the delta.

---

## Concerns

### C1 — MATERIAL — IN-DELTA — §Scope and authority still describes the profile as reserved and the amendment as outstanding

`llp/0157-composition-algebra-and-completeness.spec.md:206–209`:

> "LLP 0135's 2026-08-05 OQ5 ruling now directs narrow `relational_query_v1@1` admission in **reserved** `snapshot-batch.v2`; this Spec owns the **still-required** exact reviewed registry/cursor amendment, not the product decision itself."

The delta systematically updated every other statement of this kind — §D1 rule 3, the growth stop rule, the §D3 assignment note, the crosswalk Move-1 row, the Move-1 workload-exit paragraph, OQ1, and Status — but missed this one. The result is a direct internal contradiction: the document's own scope section says the registration has not happened while §D1/§D8/Status say it landed on 2026-08-06. This is the section a reader consults to learn what the Spec owns, so it is not decorative.

**Fix:** replace with, e.g., "LLP 0135's 2026-08-05 OQ5 ruling directed narrow `relational_query_v1@1` admission through `snapshot-batch.v2`; this Spec's 2026-08-06 v0.11 amendment lands that exact reviewed registry/cursor registration (§D1, §D3, §D4, §D8), not the product decision itself."

### C2 — MATERIAL — IN-DELTA — the acknowledgment rule mis-states LLP 0135 §2.6 for the one class this profile exists to admit

`llp/0157…:337–340`:

> "Its capability id is `snapshot_batch_v2`, entering the registry at `experimental` under LLP 0135 §2.6's admission-acknowledgment gate — an ordinary artifact must acknowledge `snapshot_batch_v2` plus **every composed node class's experimental capability id**."

LLP 0135 §2.6's actual rule is narrower and differently shaped: "an ordinary artifact claiming a composite must acknowledge `snapshot_batch_v1` **and every composed experimental id** — with v1 bounded-children-only, exactly `snapshot_batch_v1` plus `bounded_children_v1`."

The difference is load-bearing here, because `relational_query_v1` is **not** experimental. `src/manifest.rs:9154–9205` puts `RelationalQueryV1` in the `CapabilityMaturity::Stable` arm (with the comment "stable acknowledgment is a no-op"), while `BoundedChildrenV1` is Experimental. So the amendment's phrasing presupposes an experimental id that does not exist for the relational class, and it is two-way readable:

- Reading A (0135's rule): a v2 artifact acknowledges `snapshot_batch_v2` + `bounded_children_v1` when a bounded-child node is present; an all-relational artifact acknowledges only `snapshot_batch_v2`.
- Reading B (0157 as written): a v2 artifact must additionally list `relational_query_v1`, and an artifact omitting it **refuses at admission**.

A14 then compounds it by testing "an artifact missing the `snapshot_batch_v2` or composed-class acknowledgment" refuses — which under reading B makes the all-relational golden case (b) fail admission for a reason 0135 never authorized. A Rust host and a JS codegen can land on different sides of this.

**Fix:** mirror the owner verbatim: "…must acknowledge `snapshot_batch_v2` and every composed **experimental** capability id — for a mixed tuple exactly `snapshot_batch_v2` plus `bounded_children_v1`; `relational_query_v1` is Stable, so its acknowledgment is a no-op and is never required."

### C3 — MATERIAL — IN-DELTA — the v2 result-envelope *shape* for an all-relational tuple is unpinned, while the result contract is identity-bearing and refusable

`llp/0157…:2031–2046` pins runtime behavior ("An all-relational tuple has no parent and therefore no reachable sealed envelope") and pins the tuple contents ("the declared result contract must exactly match the declaration-ordered tuple, else `SNAPBACK_SNAPSHOT_BATCH_RESULT_CONTRACT_INVALID` refuses at load"). It never says whether the generated result **type** for an all-relational v2 composite is still LLP 0135 §2.3's two-arm discriminator

```ts
{ kind: "absent"; nodes: null; continuation: null } | { kind: "visible"; … }
```

with a provably unreachable `absent` arm, or is narrowed to the visible arm alone.

Both readings are defensible from the delta ("byte-identical … envelope" and "extends unchanged" point at the two-arm union; "no reachable sealed envelope" plus the Spec's own no-parallel-shapes generated-type discipline point at narrowing). They are not interchangeable: the arm set changes the authored `resultContractHash`, therefore `QueryMaterializationKeyV1`, and it changes whether a conforming artifact takes `SNAPBACK_SNAPSHOT_BATCH_RESULT_CONTRACT_INVALID` at load. A Rust admission check and a JS codegen resolving this differently produce a mutual load refusal — exactly the failure the diagnostic was added to make legible.

**Fix:** one clause in §D8 "Sealing", e.g. "Every `snapshot-batch.v2` composite, including an all-relational tuple, carries LLP 0135 §2.3's unnarrowed two-arm `SnapshotBatchRow` envelope; the `absent` arm is statically unreachable for an all-relational tuple but is never removed from the declared result contract." (Or the opposite ruling, stated equally explicitly.) Then add the arm-set case to A14.

### C4 — MATERIAL — IN-DELTA — the LLP 0110 boundary note attributes seal-entirely to the wrong owner

`llp/0110-bounded-children-and-activity-patterns.spec.md:1784–1790`:

> "…whose bounded-child positions keep **this Spec's** boundary/terminal mapping and parent point-read, incarnation/`_version` restart, **and seal-entirely semantics** byte-for-byte…"

Three of those four are correctly LLP 0110's. "Seal-entirely" is not: it is LLP 0135 §2.3 ("Seal-entirely partial refusal"), which itself only says it *extends* "LLP 0110 §1.3's ordering". The same delta's own text says so twice — 0157 §D8 (`llp/0157…:2031`, "LLP 0135 §2.3's seal-entirely rule extends unchanged") and the LLP 0135 dated note. These boundary notes exist precisely "so no future editor changes one copy alone"; landing a third copy that relocates ownership defeats that purpose and invites a future editor to amend seal-entirely in 0110.

**Fix:** "…keep this Spec's boundary/terminal mapping, parent point-read, and incarnation/`_version` restart semantics byte-for-byte, under LLP 0135 §2.3's unchanged seal-entirely rule…"

---

## NITs

- **N1 — IN-DELTA.** `llp/0157…:1755–1757`: the heading became "Common `sbbc1` / `sbsb1` / `sbsb2` envelope" but the sentence beneath still reads "**Both** families use:". Change to "All three families use:".
- **N2 — IN-DELTA.** §Summary item 8 (`llp/0157…:187–189`) still reads "the common `sbbc1`/`sbsb1` AEAD envelope registry and the complete `sbsb1` body/budget live here" — not updated for `sbsb2`, unlike the §D8 Ownership-transition paragraph the delta did update.
- **N3 — IN-DELTA.** The `sbsb2` section re-declares the whole record but restates only *some* inherited member semantics. `groupIndex`'s zero-based-dense definition, `parentAuthorizationKeyDigest`'s `snapback:parent-authorization-key:v1:` domain, and "`nodes` is dense position order" exist only in the `sbsb1` paragraph. Since the section says "reuses `sbsb1`'s envelope, ordered-compact-JSON serializer, [and] 8,192-byte wire cap" — an enumeration that pointedly does not include body-member semantics — add one sentence: "every identically named body member carries its `sbsb1` semantics unchanged."
- **N4 — IN-DELTA (borderline PRE-EXISTING).** Crosswalk row `llp/0157…:2103` still reads "§D1: **2/2 v1**, hard 6 classes/4 profiles, one-per-amendment and RFC escalation". The ceilings are right; "2/2 v1" is a stale historical count (now 4/4) and "one-per-amendment" no longer applies to the profile axis at all. Suggest "4/4 now, hard 6 classes/4 profiles, one class per amendment, no further profile except by RFC".
- **N5 — IN-DELTA, altitude: implementation-phase.** A14 requires that "a tuple with no relational node declared under `snapshot-batch.v2`" refuse "with their closed codes", but no code is named anywhere for that condition — it is new to this profile, and LLP 0135 §3's registry offers two plausible homes (`SNAPBACK_SNAPSHOT_BATCH_PLAN_INVALID` for shape versus `SNAPBACK_SNAPSHOT_BATCH_NODE_INELIGIBLE` for per-node eligibility; the 2026-08-04 note's rationale argues against collapsing them). §D1 rule 1 explicitly makes code registration an implementing-slice act, so I am **not** treating this as a MATERIAL defect — it identifies no defective decision, only an unmade detail. One sentence delegating v2 admission codes to LLP 0135 §3's registry would close it cheaply.
- **N6 — IN-DELTA.** `llp/0157…:337`, "Its capability id is `snapshot_batch_v2`, **entering the registry** at `experimental`", is present-tense about a registry the amendment cannot touch: `snapshot_batch_v2` appears nowhere in `src/`, `packages/`, or `tests/`, and LLP 0134 §1 makes experimental entry a mechanical **same-commit** event (introduction record + both source registries + full-registry projection + a non-projection test). LLP 0135 §2.6 uses the same participle for v1, so there is precedent and the following sentence fences every downstream claim — hence NIT, not MATERIAL. Prefer "will enter the registry at `experimental` through LLP 0134 §1's same-commit introduction record when the implementation lands".
- **N7 — IN-DELTA.** A11 tests v1's cursor-bearing-subscribe refusal (`SNAPBACK_SNAPSHOT_BATCH_LIVE_CURSOR_UNSUPPORTED`, LLP 0135 §2.5); A14 inherits the byte-identical §D4 classification but never exercises that refusal for v2. One clause in A14.
- **N8 — PRE-EXISTING.** §D8's work accounting leans on "its owner-declared root **examined-entry ceiling**" for a relational node, and A14 instruments "examined root-range entries" against "the summed declared ceilings". LLP 0080 closes `take` (`0..=1024`) but never closes a numeric root examined-entry formula — its nearest normative statement is the acceptance bullet "examined entries stay within the admitted window" (0080:684–686). Bounded children have the closed `take + 1`; `single_table_v1` has the literal `1024`. This predates the delta (§D6's `examinedEntryCeiling: number` already assumes one per class), and the amendment faithfully renders the ruling's "sums every owner's declared … ceiling", so it does not gate. Worth a pointer — "as instrumented by LLP 0080 §Acceptance's index-served root bound" — and, eventually, an LLP 0080 amendment closing the formula.
- **N9 — IN-DELTA.** The `sbsb1` refusal paragraph (`llp/0157…:1910–1911`) still lists only "`sbbc1` refuses in a batch and `sbsb1` refuses in a standalone node". Cross-profile coverage in **both** directions is complete, but only in the `sbsb2` paragraph. A back-reference in the v1 paragraph would stop a future editor from reading v1's list as closed.

---

## Answers to the five review questions

1. **Completeness against the ruling — yes.** All four pins are byte-exact, not descriptive; I found no clause of the ruling unrendered. C2 is the only place where a rendering *changes* an owner rule rather than restating it, and that is the acknowledgment set, not one of the four pins.
2. **Consistency with the existing document — mostly, with one real contradiction (C1) and several stale-sentence NITs (N1, N2, N4, N9).** The registry tables, growth stop rule, `NormalizedCompositePlanV1`, `CursorProfileIdV1` and the assignment registry, `NodePageBoundaryV1` reuse, the `sbsb1` grammar/serializer/budget carve-out, §D4, the crosswalk, migration, OQ1, and Status are all internally consistent after the delta. `NodePageBoundaryV1` and the §D3 boundary-vector encoding correctly needed no change: the vector's generic `kind:"boundary"` plus `classId` in the digest preimage already carries the class-selected variant.
3. **Consistency with the owners — one misattribution (C4).** The 0135 note, the 0080 note, the reused `ParentAuthorizationKeyV1`, the relational root-window boundary, and the bounded-child boundary/terminal mapping all match their owners' normative text; the `maxEncodedBytes` obligation on relational root string order fields is genuinely covered by LLP 0135 §4.1's "every composed string order field" and needs no new owner surface.
4. **Wire exactness — good, with one open shape (C3) and one inheritance gap (N3).** Field order, the closed three-arm state union, class/tag mismatch refusal, `parentGroups:[]`-never-omitted, prefix width, the 6,139/6,099 arithmetic, the distinct `…:v2` purpose bytes (which make cross-prefix decode fail authentication independent of the tag check), and the both-directions cross-profile refusals are all exact. The unresolved implementer-visible fork is the all-relational envelope arm set.
5. **Non-goals honesty — yes, with the N6 caveat.** No implementation, no support claim, no Fleet receipt, and no capability publication is smuggled; the Fleet row stays an explicit GAP, and "specified here, frozen by the implementation" is unambiguous — the amendment authors the vector obligations and the acceptance oracle, and defers generation/freezing. The single soft spot is the present-tense "entering the registry".

**Recommendation:** C1, C2, and C4 are one- or two-sentence edits. C3 needs one authorial ruling (unnarrowed union versus narrowed), then one sentence plus an A14 case. None of the four disturbs the ruling, the record shape, or the arithmetic.

VERDICT: NOT READY — confidence 0.80 (high on C1/C2, which are corroborated by exact owner text and the code-owned maturity registry; moderate on C3/C4, which an author could reasonably rule as already-determined or as NIT-level).

## v0.11 amendment loop, round 2 — 2026-08-06

**Round record (persisted before launch).** Post-revision delta round: the
orchestrating Fable session applied every round-1 finding from both families
(all seven MATERIAL, all NITs including the PRE-EXISTING N8 pointer) plus one
author-authority ruling: the all-relational `snapshot-batch.v2` composite
keeps LLP 0135 §2.3's unnarrowed two-arm result envelope. Same topology and
instruction-based (self-attested) blindness as round 1; reviser does not
review. Revision hashes (sha256):
0157=aa5c33aadae326fd135e84f0147b9310e81896d440ce07f6808524008ac9c663,
0135=d4d7b0ac2d3d27419df1ca37d734030a22540b3de9677e3e8940d6c310015853,
0080=01606da44bea9c06212042a8810d88a2b2fb5e44d89f7dd795c6f9e6e7b0ede7,
0110=1e713cfe76f98dfcd39f6667690d843efa827aa9c3d4a61d1a980d24eb9e85e8.
Capsule: scratchpad review-instructions-r2.md (enumerated revision delta) +
v011-delta-r2.diff (751 lines). Verdict rule unchanged: READY gates on the
amendment; PRE-EXISTING concerns recorded, not gating.

**Provenance:** Claude family, fresh Opus session via the Agent tool (general-purpose, no orchestrator context), 2026-08-06. Mutually blind (instruction-based, self-attested in the body). Verdict binds to the round-2 revision hash vector recorded above. Body verbatim below.

I have what I need. Writing the review.

---

# LLP 0005 review — LLP 0157 v0.11 (`snapshot-batch.v2` / `sbsb2`), round 2

**Reviewer:** Claude family, independent, round 2 (no round-1 context).
**Blindness attestation:** I did not read anything under `llp/reviews/` (no `0157-*` artifact, no other reviewer output, no orchestrator notes). My only inputs were the instructions file, `scratchpad/v011-delta-r2.diff`, the four target documents, and repository owner documents/code I verified against (LLP 0004, 0007, 0080, 0110, 0134, 0135; `src/manifest.rs`, `src/local.rs`, `src/rqs.rs`, `src/snapshot_batch_cursor.rs`, `src/server.rs`).
**Snapshot verified:** all four sha256 hashes in the instructions match the working tree. `./ref-check` passes (188 docs, 6,214 refs, 0 errors).
**Fixed authority respected:** I did not relitigate the 2026-08-05 LLP 0135 ruling's admission bounds, names, or live/retention posture, nor the orchestrator's two-arm-envelope ruling. C2 below is about the *exactness of the sentence stating* that ruling, not the ruling.

## What I verified positively (so the concerns are read in proportion)

- **Ruling completeness (Q1): all four pins are landed, exactly.** Cursor binding (merged args once, closed per-node state union, bounded-child v1 mapping byte-for-byte, relational terminal-or-root-window with ordered root fields and `_id` tie-break, no invented relational parent group); resume/restart (no substitute parent `_version`, fail-closed plan/arg/authority/stream-epoch/order-schema validation, LLP 0080 §2's no-skip/no-duplicate carried through, bounded-child incarnation/`_version` → whole-composite restart); sealing (all four ruling sentences present verbatim in substance); work accounting (root/child ceilings, parent point-reads, exactly one joined-side unique lookup per consumed root *including inner-omitted*, no unbounded scan). Profile bounds, names (`snapshot-batch.v2`/`sbsb2`/`snapshot_batch_v2`), static-tuple closure, and the "one profile, no new algebra axis" constraint are all present.
- **The acknowledgment restatement is factually correct against shipped code.** `src/manifest.rs:9198` puts `RelationalQueryV1` in the `Stable` arm and `BoundedChildrenV1` in `Experimental`; `src/manifest.rs:12016-12030` makes a stable acknowledgment a genuine no-op. So "exactly `snapshot_batch_v2` plus `bounded_children_v1`" for a mixed tuple and `snapshot_batch_v2` alone for all-relational is exact, and it mirrors LLP 0135 §2.6's v1 sentence shape.
- **Byte arithmetic checks out.** `8192 − len("sbsb2.") = 8186`; `ceil(4·6139/3) = 8186` and `ceil(4·6140/3) = 8187`; `6139 − 24 − 16 = 6099`. Identical to `sbsb1`, as claimed. The `sbsb2` body member list and order are member-for-member identical to `sbsb1` with only `formatVersion: 2` and the widened state union differing — I diffed them field by field.
- **Citations I spot-checked are right, including ones that look wrong.** `LLP 0080 §3` really is where "The complete conservative dependency set…" lives (0080:361), not §4 — the §D4 pointer is correct. `LLP 0110 §1.2` really does say "`take: 0` examines no child entry" (0110:241). LLP 0110's `sbbc1` restart-precedence rule (0110:1192-1194) is restated word-accurately. LLP 0134 §1 really owns the `same-commit.v1` introduction record. `LLP 0080 §Acceptance`'s "index-served root bound" instrumentation exists (0080:688-689).
- **The parity pattern §D8 tells the implementation to reproduce is real and correctly described**: `tests/fixtures/snapshot-batch-sbsb1-parity-v1.json` + Node consumer `tests/conformance/snapshot-batch-sbsb1-parity-v1.mjs` + in-module drift guard (`src/snapshot_batch_cursor.rs:585-623`).
- **Non-goals honesty (Q5): clean.** No implementation, support, or capability claim is smuggled. The de-circularized gate (implementation work may land; runtime admission and claims are gated) is stated consistently in §D1, §D8, §Status, and OQ1, and the three owner documents keep their GAPs honest.

---

## Concerns

### C1 — MATERIAL — IN-DELTA — the two-outcome totality is stated without scoping it to credential validation in a v2 composite

**Location:** `llp/0157-composition-algebra-and-completeness.spec.md:2051-2068` (§D8, `sbsb2` "Resume and restart").

> "The public resume outcomes are total and exactly two, following the implemented v1 rule. … **Every** other failure — malformed bytes, authentication failure …, expiry, wrong `formatVersion` or `keyGeneration`, cross-function, cross-plan, cross-`args`, cross-parent, cross-authority, node/group-binding mismatch, state-tag/class mismatch, order-schema-invalid boundary, and cross-profile presentation — collapses to `SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`."

Two things break under the literal reading, and they are exactly the "Rust and JS implementer resolve it differently" case:

1. **Custody-ground mint failure.** The same section, 259 lines earlier (`:1792-1793`), says "Mint failure refuses the page; it never converts a nonterminal page into terminal." LLP 0135 §2.4 pins it as a *custody-grounds* refusal keeping LLP 0110's rule, and main already ships the distinct public code `SNAPBACK_SNAPSHOT_BATCH_CURSOR_MINT_UNAVAILABLE` (`src/local.rs:27046`, classified public at `src/server.rs:25059`). A resume that validates but cannot mint the next continuation is "another failure"; collapsing it to `CURSOR_INVALID` tells the client "request the first page without a cursor" and loses pagination position on a transient keyring blip.
2. **Cross-profile presentation to a *non*-composite.** The same paragraph says "`sbsb2` refuses … in every standalone node", and "cross-profile presentation" is listed as collapsing to `SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`. But a standalone relational or bounded-children node must refuse with **its owner's** code — `SNAPBACK_RELATIONAL_CURSOR_INVALID` (LLP 0080 §2) or `SNAPBACK_BOUNDED_CHILDREN_CURSOR_INVALID` (LLP 0110) — never the snapshot-batch code. As written, 0157 reaches into another owner's refusal surface.

The v1 paragraph does not have this problem because it says "*credentials* collapse" and claims no totality. The totality claim is new in this amendment.

**Fix (one clause):** scope the sentence — "The public outcomes of **validating a continuation presented to a `snapshot-batch.v2` composite** are total and exactly two… Every other *credential-validation* failure … collapses to `SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`. Failures outside credential validation keep their own owners' codes: a custody-ground mint failure refuses the page (§D8's envelope rule), a result-contract mismatch refuses at load, and an `sbsb2` credential presented to a standalone node refuses under that node owner's cursor-invalid code."

---

### C2 — MATERIAL — IN-DELTA — the two-arm-envelope sentence asserts that `QueryMaterializationKeyV1` does not depend on the tuple's class mix, which contradicts §D2

**Location:** `llp/0157-…:2079-2085` (§D8, `sbsb2` "Sealing").

> "…so the envelope arm set, the authored `resultContractHash`, and therefore `QueryMaterializationKeyV1` never depend on the tuple's class mix."

`QueryMaterializationKeyV1` carries `planHash` (`:744`), and §D2's rotation table (`:864-865`) makes node normalized plan / class / order rotate `NodePlanHashV1` → `PlanHashV1` → QMK. Two composites differing in class mix **must** carry different QMKs; if they did not, that would be an identity collision, not a stability property. The intended claim — that the *envelope arm set* is class-mix-independent, so no QMK difference arises *from the arm set* — is correct and worth stating; the sentence as written overshoots it into a false global claim inside an Accepted Spec's normative text.

**Fix:** "…so the envelope arm set and therefore the authored `resultContractHash` never depend on the tuple's class mix, and no `QueryMaterializationKeyV1` difference arises from the arm set. (Class mix still rotates `PlanHashV1` and therefore QMK through §D2's ordinary rotation table.)"

---

### C3 — MATERIAL — IN-DELTA — the relational node's "owner-declared root examined-entry ceiling" is not a declared quantity in LLP 0080

**Location:** `llp/0157-…:2092-2103` (§D8, `sbsb2` "Work accounting"), and its oracle at `:2329-2333` (A14).

> "…for each relational node, its owner-declared root examined-entry ceiling plus **exactly one joined-side unique-index lookup per relational root consumed**…"
> A14: "Work instrumentation proves each page performs at most the summed declared ceilings — examined child-range entries, parent point-reads, examined root-range entries, and exactly one joined-side unique lookup per consumed relational root…"

The bounded-child summand is now pinned to the digit (`take + 1`, and exactly `0` when `take` is `0`, per LLP 0110 §1.2). The relational summand is not: LLP 0080 declares **no numeric examined-entry ceiling**. It says "`take` bounds **consumed authorized roots**, not emitted rows" (0080:239), "A page that consumes fewer than `take` roots is terminal" (0080:252), and its acceptance instruments an "admitted window" (0080:688-689) — but no formula. Nor does the code carry one: the only `examined_entry_ceiling` in the tree is `single_table_v1`'s constant `1024` (`src/manifest.rs:3380`, `7630`).

So the composite ceiling that §D8 calls "a static fact of the normalized plan, encoded in `PlanHashV1`" is not fully computable, and A14's summed-ceiling instrumentation is not executable as written. A Rust implementer reading LLP 0080 §2 will plausibly derive `take` (no lookahead is needed — terminality is decided by consuming fewer than `take`); a JS implementer will plausibly mirror bounded-children's `take + 1`. That is a per-page off-by-one in a fail-closed work bound.

**Fix (either is fine, but one must be chosen here, not at implementation time):** (a) pin it in the same sentence — "its owner-declared root examined-entry ceiling — exactly `take` examined root-range entries, and `0` when `take` is `0`, per LLP 0080 §2's consumed-root bound"; or (b) state that LLP 0080 must land a dated ceiling declaration before the profile's implementation may claim a summed ceiling, and add that to the residual gate.

**Altitude note:** this is not a detail-only demand. The amendment newly makes the *sum* normative and instruments it in A14; the defective decision is asserting a static summable ceiling whose relational summand no owner declares.

---

### C4 — MATERIAL — IN-DELTA — the `sbsb2` pre-read template leans on two constants that no owner closes for relational nodes

**Location:** `llp/0157-…:2017-2031` (§D8, `sbsb2` "Budget").

> "Each relational node compares terminal framing against its owner-declared worst-case `kind:"relational-boundary"` state: **the declared order-field types' closed maxima**, every string order field carrying the schema-level, write-enforced `maxEncodedBytes` bound, and **the root-`_id` spelling counted at its owner-declared maximum JSON-serialized width**, escaping and framing included."

(a) **"the declared order-field types' closed maxima."** For `sbsb1` this worked because LLP 0135 §2.4 closes exactly the LLP 0110 order-type set — "integer, boolean, and id widths are closed", strings bounded by `maxEncodedBytes` — and LLP 0110 §1.2 *refuses* float order fields. Relational ordering is a wider set: LLP 0080 admits ordering over "qualified root scalar (non-JSON) fields" (0080:272) with no type restriction, and LLP 0007 admits ordering over any scalar/system field, `Json` excepted (0007:339), where scalar includes floating point (0007:95). Nothing in 0135/0157/0080 closes the maximum ECMAScript/RFC 8785 spelling width of a finite double — and `src/rqs.rs:120-135` shows the relational cursor path already serializes doubles. So the "closed maxima" premise is false for the type set v2 newly admits into the template.

(b) **"the root-`_id` spelling … at its owner-declared maximum JSON-serialized width."** No owner declares a maximum `_id` width. The shipped v1 template uses §D2's universal 256-byte id ceiling (`row_id: "x".repeat(256)` at `src/local.rs:27189`); a second implementer chasing "owner-declared" will find nothing and may derive a much smaller LLP 0148 prefixed-id width.

Both constants are load-bearing: §D8's vector (c) requires "a maximum-width template vector at **exactly** 6,099 plaintext bytes plus the 6,100-byte establishment-time refusal", which only exists if both languages compute the identical template. Divergence here also moves the `SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED` admission boundary.

**Fix:** in the same paragraph, (a) either restrict a v2 relational node's order fields to the same closed four (string with `maxEncodedBytes`, table-scoped id, safe integer, boolean) with a stated refusal for any other declared order type, or enumerate the additional maxima (notably the closed maximum RFC 8785 number spelling); and (b) replace "owner-declared maximum JSON-serialized width" with the actual authority — "§D2's 256-byte id ceiling, JSON-escaped and framed", which is what the shipped `sbsb1` template already uses.

---

### C5 — MATERIAL — PRE-EXISTING text, delta-induced — five documents outside the amendment still say the reviewed registration is pending

**Non-gating** under the stated rule (this is text the amendment never touched), but it is a same-commit obligation created by this delta, and §D8's own ownership-transition rule ("so no future editor changes one copy alone", `:2136-2139`) is the reason to say so.

- `llp/0166-local-persistent-store.spec.md:10`, `:1907`, `:2188`, `:2291` — "reviewed `snapshot-batch.v2` registration, implementation, and fresh Fleet witness" as three outstanding items.
- `guide/capabilities.md:67` — "reviewed `snapshot-batch.v2` profile, implementation, and fresh witness pending".
- `guide/sync/offline-and-retention.md:145` — same.
- `issues/20260804-llp-0166-finish-out-residue.md:18-19` — "The row now waits on the reviewed exact profile registration…".

The amendment made exactly this edit for LLP 0110's copy (`0110:1805-1808`). The same edit — registration landed 2026-08-06; implementation, frozen vectors, and fresh witness remain — is owed to these five.

---

## NITs

- **N1 — IN-DELTA.** `:984` dropped "v1" from "The total **v1** assignment registry is:", while `:996-999` keeps "A class/profile pair absent from the table … refuses." `mixed-route.v2`/`exported_query_v1` has no row. §D2 (`:678`, "This profile has no cursor, completeness proof, retention, parent group, or delta claim") resolves it for a careful reader, but the last scoping word is gone. Fix: "The total **cursor-bearing** assignment registry is:" plus a half-sentence noting `mixed-route.v2` has no cursor and therefore no row.
- **N2 — IN-DELTA.** The rewritten growth stop rule (`:364-373`) dropped "A proposal that **exceeds either ceiling**…". The six-class ceiling is still stated, but the consequence of exceeding it (stop and commission an RFC) now attaches only to a fifth profile, a new axis, or >1 class per slice. Add "a seventh class" to the escalation list.
- **N3 — IN-DELTA.** The `take: 0` → ceiling `0` pin appears only in the v2 paragraph (`:2093-2095`), so a byte-identical bounded-child node declares `1` under LLP 0135 §2.5's `Σ(takeᵢ + 1)` in v1 and `0` in v2, while §D6 exposes `examinedEntryCeiling` as a *node* fact. Both are satisfiable ("at most"), but a one-clause note that LLP 0135 §2.5's sum is an upper bound and LLP 0110 §1.2's per-node value is the declared ceiling in **both** profiles would remove the asymmetry.
- **N4 — IN-DELTA.** "Cross-profile is total in both directions" (`:2065-2068`) names `sbsb1`, `sbsb2`, `sbbc1` — but not LLP 0080's standalone relational credential family (`sbrc1` on main, `src/rqs.rs:56`), which is precisely the credential a v2 caller now also holds. It is covered by the collapse rule, but a section claiming a *complete* both-direction rule should name it: "an LLP 0080 standalone relational credential refuses in any batch."
- **N5 — IN-DELTA.** §D1's gate says "no generated artifact may require the capability" (`:360-361`), unqualified, while A14 (`:2323-2327`) requires generating fixture artifacts that require it. Add "shipped" or "published" so the acceptance corpus is not self-blocking.
- **N6 — IN-DELTA.** The residual gate is stated with three different item lists: 0157 §D1/§Status (executor + frozen vectors + target publication authority), LLP 0135 OQ5 (`0135:1346-1349`: implementation + frozen vectors), LLP 0110 (`0110:1805-1808`: implementation + vectors + Fleet witness). Each is defensible in its own frame, but a pointer to §D1's canonical list from the other two would stop the lists from drifting apart.
- **N7 — IN-DELTA.** `:2417-2421`: "`sbsb1` has no deployed predecessor, and `sbsb2` has none either" plus "independently **supportable**". `sbsb1` *is* deployed and `snapshot_batch_v1` support *is* published on the qualified contributor local target (LLP 0135's 2026-08-03 implementation record). Say "no credential migrates" and "independently supported on the qualified local target and support-false elsewhere".
- **N8 — IN-DELTA (acceptance coverage).** A14 omits the one case where v2 makes an LLP 0110/0135-originated schema member load-bearing for an LLP 0080 plan: a relational node whose string root order field carries no `maxEncodedBytes` must refuse before the first page with `SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED` (`:2027-2029`). Add it to A14's boundary cases. (I confirmed the surface exists and is schema-level per `(table, field)`: `src/local.rs:25464-25520`, LLP 0135 §4.1 amendment 1.)
- **N9 — PRE-EXISTING.** 0157's v1 resume paragraph (`:1922-1926`) never says what a changed stream/restore epoch does, while the v2 paragraph says it yields `RESTART_REQUIRED` "following the implemented v1 rule" — which is true of the implementation (LLP 0135:1210, "parent incarnation/version **and stream changes** return restart-required") and of LLP 0110:1188-1189. The delta makes the v1 silence visible; a matching clause in the v1 paragraph would close it.
- **N10 — PRE-EXISTING.** LLP 0110 §1.1 (`0110:205-206`) still defines `ParentIncarnationV1` as `sbpi1.<base64url-no-pad(JCS({createdAt,creationVersion}))>`, which is ~73 bytes, while `0110:982-995` (a section that is "normative where it conflicts with earlier text") makes it a canonical UUIDv7, the code mints `Uuid::now_v7()` (`src/storage.rs:18125`), and 0157 §D8's budget template uses 36 ASCII bytes (`:1899-1900`) — matching the shipped template `"0".repeat(36)`. Already resolved by precedence, but the stale §1.1 spelling is now load-bearing in two profiles' budgets; deleting or annotating it is cheap.
- **N11 — IN-DELTA.** `:2088-2090` uses `SNAPBACK_SNAPSHOT_BATCH_RESULT_CONTRACT_INVALID` for **arm-set narrowing**, while its owner's registration (LLP 0135:815-824) defines the trigger as a contract that "does not exactly match the declaration-ordered cursor-free visible page tuple" — the *visible* payload. The extension is reasonable and §D1 authorizes reusing §3's diagnostics, but the owner's registered trigger should gain a clause covering arm-set narrowing so the code's definition and its v2 use agree.

## Altitude dispositions

- C3 and C4 are **not** implementation-phase detail: each identifies a decision the amendment made (a static summable ceiling; a byte-exact pre-read template) whose inputs no owner document supplies. One sentence resolves each, and both must be resolved before the frozen vectors can be generated — the vectors are the gate, so deferring them to the implementation is circular.
- C1 and C2 are single-sentence exactness defects in normative text, not stylistic.
- N5, N8 and N11 are the borderline cases; each is a one-clause edit and none blocks.
- Nothing here questions the ruling's substance, the two-arm envelope choice, or the profile's admission bounds.

## Answers to the five review questions

1. **Completeness against the four pins:** complete. All four pins, plus every profile bound and name in the ruling, are landed.
2. **Internal consistency of LLP 0157:** two real defects (C1 vs §D8's own mint-failure sentence; C2 vs §D2's rotation table) plus N1/N2/N3.
3. **Consistency with the owner documents:** the four targets cohere; the fan-out to LLP 0166, the two guide pages, and the issue ticket is unlanded (C5).
4. **Wire exactness:** C3 and C4 are places where a Rust and a JS implementer would produce different bytes/bounds; C1 is a place where they would produce different codes. Everything else I checked (field order, byte arithmetic, purpose bytes, AAD, state-union mapping, `parentGroups:[]` for all-relational) is exact.
5. **Non-goals honesty:** clean. The gate is de-circularized and no support, capability, or implementation claim is smuggled.

**VERDICT: NOT READY** — 4 MATERIAL concerns in the amendment (C1, C2, C3, C4), all with bounded one-paragraph fixes; C5 is reported but non-gating; no BLOCKING concern. Confidence: 0.8 (high on C1/C2/C3, which I verified against owner text and shipped code; moderate on C4(a), which depends on whether the authors intend v2 relational order fields to inherit LLP 0080/0007's wider scalar type set — if they intend the narrow four, the fix is one refusal clause and the concern is a NIT).

## v0.11 amendment loop, round 3 — 2026-08-06

**Round record (persisted before launch).** Delta round after the round-2
revision, final round within the default budget. The orchestrating Fable
session applied all six gating round-2 MATERIALs (Codex R2-01/R2-02; Claude
R2 C1–C4) and the round-2 NITs N1–N9/N11, landed the C5 fan-out copies
(LLP 0166, guide/capabilities.md, guide/sync/offline-and-retention.md, the
residue ticket), and recorded Claude R2 N10 as owner residue in the ticket.
Two further orchestrator rulings under author authority: the v2 relational
order-field template set is closed to the four v1 template types, and the
relational per-node examined-entry ceiling is pinned at exactly `take`.
Same topology and instruction-based (self-attested) blindness; reviser does
not review. Revision hashes (sha256):
0157=e8ad954f5ac804a1e4f847aafb15fb43080c4569c401719a81ae5eb152e21425,
0135=179f9e42f6665dd9356d77d2f9974bf69b78ed33eb763cb6776106b3ccbecd76,
0080=01606da44bea9c06212042a8810d88a2b2fb5e44d89f7dd795c6f9e6e7b0ede7,
0110=51cbca17d46ef2143214a8e182465f50e5881c87151e43ef227c13d9bd85782b.
Capsule: scratchpad review-instructions-r3.md (enumerated round-3 delta) +
v011-delta-r3.diff (941 lines, now including the fan-out files). Delta-round
convergence rule in force: the loop converges when no family reports a
MATERIAL concern in pre-existing text; remaining in-delta fixes get one more
delta round or the final revision is labeled unreviewed.

**Receipt note — supplementary round-2 review from a concurrent
orchestrating session (2026-08-06, corrected).** A second orchestrating
session, asked to supervise this program, observed at ~03:46 that no round-2
Claude-family output artifact existed, concluded (wrongly, as it turned out)
that the launching session had died, verified the four target files still
matched the persisted round-2 hashes byte-for-byte, and launched an
additional round-2 Claude-family review against the identical surviving
round-2 capsule (`review-instructions-r2.md` sha256
40197d32545d22184fa2dbb396bffbb6f4c458bda4cc5dcc46495e24e4512f60,
`v011-delta-r2.diff` sha256
b1b0136aa23feccc113665d0f1d1c8e6392bd2446ed52b69f9cb540778b0a50b);
fresh subagent, same instruction-based (self-attested) blindness. The
original session was in fact alive: its own round-2 review (above, C1–C5)
was received at ~04:02, and it proceeded to the round-2 revision and the
round-3 launch before this supplementary review landed here. Both round-2
Claude-family reviews are bona fide, mutually independent, and bound to the
same round-2 revision hashes; neither is a fabrication or replacement. An
earlier version of this note, written before the original session's receipt
was visible, wrongly stated that review "was never received"; this corrected
note supersedes it.

**Disposition flag for the orchestrating session (must be resolved before
convergence):** the supplementary review's R2-1 (MATERIAL, IN-DELTA — the
restart "exactly when" biconditional contradicts the expiry/`formatVersion`
collapse list and the implemented v1 decode-first anchor on overlap inputs,
e.g. an authenticated-but-expired credential carrying a changed epoch; fix =
one decode-validity clause plus one overlap near-miss vector) is NOT
addressed by the round-2 revision — verified against the round-3 hashes
(0157=e8ad954f…e21425): the revised §D8 partition paragraph conditions
restart on AAD authentication and parent visibility but not on decode
validity, and §D8(d)/A14 still lack the overlap vector. Its R2-2/R2-3
overlap concerns already fixed in the round-2 revision; R2-5 needs no
change; R2-4 (LLP 0080 "remain gated" phrasing) and R2-6 (PRE-EXISTING v1
epoch-restart omission in 0157 §D8 `sbsb1` and LLP 0135 §2.4) remain open
for disposition. The review below is recorded verbatim on receipt.

# LLP 0157 v0.11 amendment (`snapshot-batch.v2` / `sbsb2`) — round-2 review (Claude family)

## Blindness attestation

I have not read anything under `llp/reviews/` matching `0157-*`, nor any other
reviewer's output or orchestrator notes. My inputs were: the review
instructions, the amendment diff at
`scratchpad/v011-delta-r2.diff`, the four target documents in full or in all
touched/cited regions, the owner documents' governing sections (LLP 0135
§2.1–§2.6, §3, the 2026-08-05 ruling, OQ5; LLP 0110 §1.2, §1.3, the `sbbc1`
protocol/restart-precedence section, the 0157 boundary and publication-
authority sections; LLP 0080 §1–§4, §Acceptance, the boundary notes), LLP 0134
§1, and repository source/proof files verified below.

## Hash verification

`shasum -a 256` over the four working-tree files matches the instructions
exactly:

- `llp/0157-composition-algebra-and-completeness.spec.md` — `aa5c33aa…8ac9c663` ✓
- `llp/0135-sequence-allocation-and-snapshot-batch.spec.md` — `d4d7b0ac…10015853` ✓
- `llp/0080-portable-relational-queries-and-projections.rfc.md` — `01606da4…e7b0ede7` ✓
- `llp/0110-bounded-children-and-activity-patterns.spec.md` — `1e713cfe…9e85e8` ✓

## Repository facts checked (not taken on faith)

- `relational_query_v1` is Stable and `bounded_children_v1` is Experimental in
  the code-owned registry (`src/manifest.rs:9164–9205`); stable acknowledgment
  is a no-op (`src/manifest.rs:12017` and the §9155 comment). The §D1
  acknowledgment restatement is therefore factually correct today.
- The claimed committed `sbsb1` parity pattern is real:
  `tests/fixtures/snapshot-batch-sbsb1-parity-v1.json` (shared fixture),
  `tests/conformance/snapshot-batch-sbsb1-parity-v1.mjs` (independent JS
  consumer re-deriving HKDF/HChaCha20/AAD from primitives), registered in the
  local proof at `scripts/verify-local-proof:134`.
- The implemented v1 resume behavior: `src/snapshot_batch_cursor.rs`
  `decode()` rejects expiry, future issuance, wrong `formatVersion`, and wrong
  `keyGeneration` **at decode**, before any epoch/parent comparison; the
  executor compares stream epoch and parent incarnation/`_version` only after
  a successful decode, and an authenticated changed `stream_epoch` yields
  `SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED` (`src/local.rs:42524–42539`).
- LLP 0134 §1 defines the `same-commit.v1` introduction record §D1 cites.
- No stale "three plan profiles" / "reserved" normative text remains in
  LLP 0157 (grep; the remaining "reserved" occurrences are the Revised-header
  history and the Status section's historical 2026-08-05 paragraph, which the
  new v0.11 paragraph correctly supersedes in sequence).

## The five questions

**(1) Completeness against the ruling's four pins.** Complete. Pin 1 (cursor
binding: merged args bound once, closed per-node state union, bounded keeps
the v1 mapping byte-for-byte, relational terminal-or-root-window boundary with
ordered root fields and separate `_id` tie-break, structural parent groups, no
invented relational parent) — §D8 "Cursor binding" states each element. Pin 2
(resume/restart: no substitute parent `_version`, fail-closed
plan/argument/authority/epoch/boundary validation, LLP 0080 §2's untouched-root
guarantee with its stated moved-root tolerance, whole-composite restart on
bounded parent change) — §D8 "Resume and restart", exact against LLP 0080 §2's
wording. Pin 3 (sealing: zero-row relational = visible empty page; inner/left
joined rows never seal; bounded parent absence seals the whole mixed tuple
byte-identically; invocation-level authorization refusal never recoded as
absence) — §D8 "Sealing". Pin 4 (work accounting: summed owner ceilings,
parent point-reads, exactly one joined-side unique lookup per consumed root
including inner-omitted roots, no unbounded scan) — §D8 "Work accounting";
LLP 0080 §1 pins exactly one joined table per plan, so per-consumed-root
lookup accounting is total.

**(2) Internal consistency of LLP 0157.** One MATERIAL defect found in the new
total-outcome rule (R2-1) and two wording nits (R2-2, R2-3). Otherwise
coherent: §Summary 8, §Scope, §D1 registration + growth stop rule, §D2
parent-group rules, §D3 union/table/naming, §D4 item 3, §D8, crosswalk row,
A14, Move-1 exit, Migration, OQ1, and the Status v0.11 paragraph all tell one
story; the take-0 ceiling, `parentGroups:[]`, arm-set, and vector obligations
are stated identically at each site.

**(3) Consistency with the owner documents.** Consistent. The admission bounds
(2–8 nodes, ≥1 relational, summed `take` ≤ 1,024), names
(`snapshot-batch.v2`/`sbsb2`/`snapshot_batch_v2`), live/retention posture
(`live_replace` cursor-free first page, `retention:"none"`, no `live_delta`,
no local relational re-evaluation), and the four pins match LLP 0135's ruling
verbatim in substance. The v2 acknowledgment restates LLP 0135 §2.6's rule
with the correct admission locus. Bounded-child `take: 0` ⇒ ceiling 0 matches
LLP 0110 §1.2 ("`take: 0` examines no child entry") — the amendment is more
exact than LLP 0135 §2.5's `Σ(takeᵢ+1)` and correctly routes through the
owner's declaration. The LLP 0110 note attributes seal-entirely to LLP 0135
§2.3 (correct section). Owner boundaries are respected: LLP 0135 stays
execution owner with the pins commissioned by its own ruling; LLP 0080 keeps
grammar/standalone cursor/admission; LLP 0110 keeps body semantics; no
document re-decides another's question. The 0080 boundary note's content
(root-window boundary elements, no-skip/no-duplicate guarantee, inner/left,
one lookup per consumed root) matches both §D8 and 0080 §1–§2.

**(4) Wire exactness.** One divergence fork found (R2-1, below). Everything
else is deterministic: exact field order with `formatVersion: 2` the only
scalar delta from `sbsb1`; verbatim canonical `args`; closed three-tag state
union with class-selected tags and refusal on mismatch; explicit
`parentGroups: []` (never omission); the budget arithmetic (8,192 → 8,186
base64url chars after the six-byte `sbsb2.` prefix → 6,139 decoded → 6,099
plaintext) is correct for both prefixes; distinct `…:v2` purpose bytes ride
salt and AAD, making cross-profile presentation an authentication failure and
the prefix registry mutually prefix-free; the budget fails closed on missing
bounds.

**(5) Non-goals honesty.** Clean. Every claim-shaped statement is either
verified true (Stable/Experimental maturities, the implemented v1 restart
test, the committed `sbsb1` parity fixture/consumer/proof registration) or
future-tense and gated ("will enter the registry … when the implementation
lands"). The de-circularized gate consistently distinguishes landing
implementation work from runtime admission and claims, and 0110/0135/0157
state the outstanding set identically (implementation, frozen vectors,
capability publication, fresh Fleet witness/receipt). No support, capability,
or implementation claim is smuggled.

## Concerns

### R2-1 — the two-outcome rule's restart biconditional contradicts its own collapse list and its cited v1 anchor on overlap inputs

**Severity: MATERIAL. Classification: IN-DELTA** (round-2 revision text, delta
item 7).

Location: LLP 0157 §D8 `sbsb2`, "Resume and restart", the paragraph beginning
"The public resume outcomes are total and exactly two, following the
implemented v1 rule."

Quote: "`SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED` is returned exactly when a
credential that authenticated under the current app/database/target AAD
carries a changed stream/restore epoch or a changed bounded-child parent
incarnation or `_version`. **Every** other failure — malformed bytes,
authentication failure (…), expiry, wrong `formatVersion` or `keyGeneration`,
… — collapses to `SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`."

The paragraph itself fixes "authenticated" to mean AEAD success ("authentication
failure (which cross-app, cross-database, and cross-target mismatches become,
since all three ride the AAD…)"). An **expired** credential therefore still
*authenticates*. Consider an authenticated credential that is expired (or
carries the wrong `formatVersion` under a valid envelope) **and** carries a
changed stream/restore epoch or changed parent facts:

- The "exactly when" biconditional classifies it RESTART_REQUIRED.
- The collapse sentence lists expiry / wrong `formatVersion` as
  CURSOR_INVALID.
- The cited anchor — "the implemented v1 rule" — resolves it the opposite way
  from the biconditional: `src/snapshot_batch_cursor.rs` `decode()` rejects
  `expires_at < now_ms`, future issuance, and wrong
  `formatVersion`/`keyGeneration` **before** the executor ever compares
  epoch/parent facts, so the implemented v1 outcome for expired-plus-changed-
  epoch is CURSOR_INVALID.

This is exactly a Rust/JS divergence fork: a Rust implementer extending the
v1 executor (decode-validity first) returns CURSOR_INVALID; a JS implementer
transcribing the spec's "exactly when" literally returns RESTART_REQUIRED.
The §D8(d)/A14 minimum vector set does not pin the overlap: it requires
expiry-only collapse cases and changed-epoch/changed-parent restart cases
separately, so both divergent implementations pass every required vector. The
divergence also has a mild security flavor: honoring the literal rule means
performing semantic restart classification on credentials v1 refuses at
decode.

Fix (one clause plus one vector): condition restart on decode validity, e.g.
"…exactly when a credential that authenticated under the current
app/database/target AAD **and otherwise decoded validly (well-formed,
unexpired, non-future-issued, current `formatVersion` and `keyGeneration`)**
carries a changed stream/restore epoch or a changed bounded-child parent
incarnation or `_version`" — or an explicit precedence sentence
("decode-validity failures collapse before the restart comparison, as in the
implemented v1 rule"). Add the overlap near-miss (expired credential with a
changed epoch → CURSOR_INVALID) to the §D8(d) and A14 vector set so the rule
is pinned, not just prose.

### R2-2 — overbroad "never depend on the tuple's class mix" claim

**Severity: NIT. Classification: IN-DELTA** (round-2 orchestrator-ruling
text, delta item 7).

Location: §D8 "Sealing", last clause of the all-relational sentence: "…so the
envelope arm set, the authored `resultContractHash`, and therefore
`QueryMaterializationKeyV1` never depend on the tuple's class mix."

Taken literally, the resultContractHash/QMK half is false: node classes
determine node result shapes (a bounded-child node contributes a
`{parent, children}` page, a relational node a row array — the immediately
preceding sentence says so), and `classId` enters `NodePlanHashV1` →
`PlanHashV1` → QMK, so different class mixes always produce different
contract hashes and keys. The true claim is that the envelope **arm set** —
and hence any arm-set component of the contract — never varies with class
mix (no one-arm narrowing for all-relational tuples). No implementer could
act on the false literal reading against §D2's operative rules, so this does
not gate; rescope the clause, e.g. "…so the envelope arm set — and with it
the arm-set component of the authored `resultContractHash` and of
`QueryMaterializationKeyV1` — never depends on the tuple's class mix." The
orchestrator ruling itself (unnarrowed two-arm envelope for every v2
composite) is stated exactly and consistently everywhere else (§D4, §D8,
A14); I reviewed its statement only, per the fixed-authority rule.

### R2-3 — "on this Spec's acceptance" anachronism for `sbsb2`

**Severity: NIT. Classification: IN-DELTA.**

Location: §Summary item 8 ("on this Spec's acceptance, the common
`sbbc1`/`sbsb1`/`sbsb2` AEAD envelope registry and the complete `sbsb1` and
`sbsb2` bodies/budgets live here") and §D3 ("Acceptance carries the naming
concurrence in the LLP 0080/0110/0135 boundary notes", now also covering the
v2 name). `sbsb2` entered by the 2026-08-06 v0.11 amendment, not at the
2026-08-03 acceptance, and its naming concurrence rides the 2026-08-06 dated
boundary notes. Wording only; a dating parenthetical fixes both.

### R2-4 — LLP 0080's "implementation … remain gated" phrasing re-imports the circular reading

**Severity: NIT. Classification: IN-DELTA.**

Location: LLP 0080 Revised header ("implementation and vectors remain gated
in LLP 0157") and boundary-note tail ("implementation and cross-language
vectors remain gated there"). Under the de-circularized §D1 gate,
implementation work **may land**; what is gated on it is runtime admission
and claims. LLP 0110 and LLP 0135 use the precise "remain absent"/"remain
outstanding"; 0080 should match ("remain outstanding under LLP 0157's gate")
so no reader reconstructs the circular pre-round-2 reading.

### R2-5 — maturity enumerations hard-code present facts

**Severity: NIT. Classification: IN-DELTA.**

Location: §D1 dated registration ("for a tuple containing a bounded-child
node, exactly `snapshot_batch_v2` plus `bounded_children_v1`;
`relational_query_v1` is Stable…") and A14's mirrored cases. Verified
accurate today and consistent with LLP 0135 §2.6's own enumeration style, but
a later `bounded_children_v1` promotion silently stales the "exactly" clause.
The governing rule ("every composed **experimental** capability id") is
stated first and controls, so this is hygiene only; no fix required.

### R2-6 — the v1 (`sbsb1`) prose omits the epoch-change restart case its own implementation has

**Severity: MATERIAL. Classification: PRE-EXISTING** (does not gate this
verdict).

Location: LLP 0157 §D8 `sbsb1` section ("Authenticated parent
incarnation/version change yields `SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED`;
malformed, expired, cross-app, cross-plan, cross-parent, cross-authority, or
boundary-invalid credentials collapse…") and LLP 0135 §2.4's matching
sentence. Neither lists a changed stream/restore epoch on the restart side,
yet the implementation returns RESTART_REQUIRED for it
(`src/local.rs:42528–42539`) and the new v2 section now cites "the
implemented v1 rule" as including that case. The amendment never touched
these sentences. Recommend folding the epoch case into both v1 sentences in a
follow-up so the v2 section's anchor is documented, not code-only.

## Altitude note

R2-1's fix is a one-clause precedence statement plus one near-miss vector; it
identifies a defective *stated rule* (a contradiction/fork), not a missing
level of detail, so it is spec-phase, not implementation-phase, material. No
other concern demands added detail; R2-2 through R2-5 are wording rescopes
and R2-6 is pre-existing.

## Verdict

One IN-DELTA MATERIAL concern (R2-1) is unresolved; all remaining in-delta
concerns are NITs and the other MATERIAL (R2-6) is PRE-EXISTING and reported
without gating.

VERDICT: NOT READY — confidence 0.78 (the R2-1 defect is verified against the
implementation and the paragraph's own definitions; the residual uncertainty
is only whether the author intends restart-wins-over-expiry as a deliberate
v2 divergence, which would still require fixing the "following the
implemented v1 rule" anchor and the collapse list).

**Provenance:** Claude family, fresh Opus session via the Agent tool (general-purpose, no orchestrator context), 2026-08-06. Mutually blind, instruction-based and self-attested; the review body discloses one incidental one-line grep hit on this artifact, with the affected finding self-downgraded — recorded here as the body states it. Verdict binds to the round-3 revision hash vector recorded above. Body verbatim below.

I have completed the review. Here it is.

---

# LLP 0005 review — LLP 0157 v0.11 (`snapshot-batch.v2` / `sbsb2`), round 3 (delta)

**Reviewer family:** Claude · **Round:** 3 (delta) · **Working tree:** `/Users/ccheever/projects/snapback`

## Attestation and method

- I did **not** open anything under `llp/reviews/` matching `0157-*`, any other reviewer's output, or orchestrator notes. **One disclosure:** a `grep -rn` for `SNAPSHOT_BATCH_CURSOR_MINT_UNAVAILABLE` across `src/ tests/ packages/ llp/` incidentally printed **one line** of `llp/reviews/0157-composition-algebra-and-completeness.claude.md` in its results. I did not open the file and issued no further greps over that path. That one line indicated a prior-round finding on the custody mint code; I have accordingly **downgraded** my own finding on that topic (N3 below) rather than presenting it as fresh, and no other finding here is informed by it.
- All four pinned sha256 values reproduce exactly (`shasum -a 256`).
- Primary targets read in full (LLP 0157, 2,597 lines) or in the relevant entirety (0135 Part 2 + §3 + §4 + records, 0110 §1.1–1.5 + cursor closure, 0080 §1–§4 + Acceptance). Fan-out copies verified against the primary from the diff.
- Code consulted: `src/snapshot_batch_cursor.rs`, `src/local.rs` (`snapshot_batch_max_boundary`, `enforce_snapshot_batch_cursor_budget`, the resume-validation block at ~28133–28215, diagnostics at ~27020–27050), `src/rqs.rs` (`RelationalCursorBody`, wire prefixes), `src/manifest.rs` (`FieldType`, `CapabilityId::maturity`), `schemas/capability.manifest.local-dev-sqlite-ibex.json`.
- Tooling run: `./ref-check` → **ok, 0 errors**. `node scripts/check-guide.mjs` → **ok, 57 pages, 46 warnings** (all pre-existing authority-drift warnings from concurrent sessions; one *info* is in-delta, see N6).
- Fixed authorities respected: the 2026-08-05 LLP 0135 owner ruling, the unnarrowed two-arm envelope, the closed four-type v2 order-field set, and the relational `take`-entry ceiling are reviewed for **statement exactness only**, never re-litigated.

---

## MATERIAL concerns

### C1 — MATERIAL — **IN-DELTA** (items 1 and 5); underlying overlap **PRE-EXISTING** in LLP 0110
**The stream/restore-epoch restart trigger and the cross-authority collapse fire on the same input, and the "total and exactly two" partition states no precedence. Shipped v1 resolves it the opposite way from the text.**

Location: `llp/0157-…spec.md:2072-2083` (and the parallel `sbsb1` sentence added at `:1925-1929`).

> "After every parent is present and visible, `SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED` is returned exactly when a credential that authenticated under the current app/database/target AAD **carries a changed stream/restore epoch** or a changed incarnation or `_version` for a still-visible bounded-child parent. **Every** other credential-validation failure — … **cross-authority**, … — collapses to `SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID`."

Per §D2, `AuthorityPartitionV1.principalDataScope` contains `authorizationStreamIncarnation` (`:783`), and the `sbsb2` body binds `authorityPartition` as the `AuthorityPartitionDigestV1` over that record. §D8 never defines `streamEpoch` nor states its relationship to `authorizationStreamIncarnation`. In shipped main they are **literally the same string** — `src/local.rs:28018-28026` computes `stream_epoch` once and passes it both into the body and into `snapshot_batch_authority_partition_digest(…, &stream_epoch)`, which writes it as `"authorizationStreamIncarnation": stream_epoch` (`src/local.rs:27102`).

Consequences:

1. A **genuine** authorization-stream/restore rotation necessarily changes *both* `streamEpoch` and `authorityPartition`. Both branches of the stated partition match; the document gives no precedence rule. Two conforming implementations may return different public codes for the identical input.
2. Shipped v1 resolves it **cross-authority first**: `src/local.rs:28147` tests `body.authority_partition != authority_partition` → `CURSOR_INVALID`, and only at `:28153` tests `body.stream_epoch != stream_epoch` → `RESTART_REQUIRED`. So for a real rotation the restart outcome is **unreachable**; it is reachable only for a credential whose `streamEpoch` was tampered while `authorityPartition` was left intact — which is exactly what the shipped regression exercises (`src/local.rs:42528-42530`, `body.stream_epoch = "different-stream"`). The new parenthetical "**the implemented v1 rule**, per LLP 0110's `sbbc1` protocol and LLP 0135's 2026-08-03 implementation record" therefore over-reads the implementation record.
3. This directly compromises a **required frozen vector**. §D8 `:2164-2165` and A14 `:2350` both require "the two authenticated restart cases (**changed stream/restore epoch**; changed parent incarnation/`_version`)". An independent JS consumer generating that vector must decide whether to hold `authorityPartition` constant (tamper → RESTART) or recompute it (rotation → INVALID). Rust and JS will not agree.

**Concrete fix** (one of):
- (a) State precedence explicitly and define the axis: "`streamEpoch` is the same authorization-stream/restore incarnation carried in `AuthorityPartitionV1.principalDataScope.authorizationStreamIncarnation`; because a genuine rotation changes both members, the cross-authority collapse is evaluated **before** the epoch comparison and wins, and the restart-on-epoch outcome is reachable only for a credential whose bound partition still matches the current one," and restate the A14 vector as the tamper case; **or**
- (b) Drop the stream/restore-epoch clause from the restart trigger entirely — §D3's event table (`:1260`) already routes an authority change to a *different QMK and a different address*, so the epoch-restart outcome buys nothing — and reduce A14's "two authenticated restart cases" to the parent incarnation/`_version` case.

**Pre-existing flag (required by the delta rules):** the same unresolved overlap exists in **LLP 0110 `:1186-1193`**, which lists "stream/restore epoch … changed → `SNAPBACK_BOUNDED_CHILDREN_PARENT_RESTART_REQUIRED`" alongside "… authority partition … collapse to `…CURSOR_INVALID`". That is a **MATERIAL concern in pre-existing owner text**, inherited and elevated to a totality claim by this delta. Whichever fix is chosen should land a one-sentence dated reconciliation in LLP 0110.

---

### C2 — MATERIAL — **IN-DELTA** (item 4); underlying gap **PRE-EXISTING** in §D8's `sbsb1` budget
**The v2 budget's computability claim is not discharged: three of the four closed template widths are pinned nowhere, and the plausible readings differ by ≥1 byte — exactly the granularity the required 6,099/6,100 vector tests.**

Location: `llp/0157-…spec.md:2026-2040`.

> "Each relational node compares terminal framing against its worst-case `kind:"relational-boundary"` state, **computable because this profile closes the admitted order-field type set**: … a portable string carrying the schema-level, write-enforced `maxEncodedBytes` bound, a table-scoped id, a JavaScript-safe integer, or a boolean — the same closed template types the v1 budget uses … The root-`_id` tie-break is counted at §D2's universal 256-byte id ceiling, JSON-escaped and framed…"

The delta pins **one** width (root-`_id` = 256). The other three are not pinned here, in §D8's `sbsb1` budget (`:1897-1900`, which only defers to "the owner-declared worst-case boundary state"), or in the owners. **LLP 0135 §2.4** asserts the property without a digit: "integer, boolean, and id widths **are closed**" (`:711-716`). LLP 0110 and LLP 0080 give no digits. So "computable" rests on nothing an independent implementer can read off. The divergences are real and one-byte-scale:

| Template type | Reading A | Reading B | Shipped v1 (`src/local.rs:27113-27142`) |
| --- | --- | --- | --- |
| boolean | `true` = 4 | `false` = 5 | `Value::Bool(true)` → **4** |
| safe integer | `9007199254740991` = 16 | `-9007199254740991` = 17 | `Value::from(9_007_199_254_740_991_i64)` → **16** |
| id-typed *order field* | 256 + 2 quotes | escaped ≤ 512 + 2 | `"x".repeat(256)` → **258** |
| string | escape expansion 2× | escape expansion 6× | `"\u{0}".repeat(bound)` → **6× + 2** |

Two consequences:

1. **Cross-language parity fails at the pinned boundary.** §D8 `:2158-2160` and A14 `:2345` require "a maximum-width template vector at **exactly 6,099** plaintext bytes plus the **6,100-byte** establishment-time refusal". A one-byte template disagreement flips admit/refuse. This is precisely the class of defect the frozen-vector obligation exists to prevent, and the amendment authors that obligation while leaving the inputs unpinned.
2. **Shipped v1 under-counts.** `Value::Bool(true)` is 1 byte narrower than `false`, and the positive max-safe-integer is 1 character narrower than the negative one. A composite whose computed worst case lands at exactly 6,099 with a boolean order field can mint 6,100 at runtime — the "invariant failure" path (`:2043-2044`), i.e. a real (if narrow) data-dependent cliff of exactly the kind §D8 promises never to have.

**Concrete fix:** pin the four digits in the v2 budget paragraph and state that they also govern the v1 template: string = declared `maxEncodedBytes` at its maximum JSON escape expansion (6 characters per bounded byte) plus the two framing quotes; id-typed order field and root `_id` = 256 unescaped bytes plus two quotes (and cite LLP 0148's 20–38-character minted-id spelling as the real bound, since §D2's "every `*Id` string … at most 256 bytes" scopes this Spec's own record fields, not an application row `_id`); JavaScript-safe integer = **17** characters unless the declaration proves the field non-negative; boolean = **5** (`false`). Then file the `snapshot_batch_max_boundary` reconciliation (`Value::Bool(true)`, positive-only max int) as an implementation ticket so v1 and v2 share one template.

---

### C3 — MATERIAL — **IN-DELTA** (item 3); the §D6 field itself is **PRE-EXISTING**
**The new §D6 binding sentence does not say which of four accounting dimensions the single `examinedEntryCeiling: number` carries.**

Location: `llp/0157-…spec.md:2127-2140`.

> "…for each bounded-child node, `take + 1` examined child-range entries, and exactly `0` when `take` is `0` (LLP 0110 §1.2), **plus one point-read per deduplicated parent declaration**; for each relational node, exactly `take` examined root-range entries … **plus exactly one joined-side unique-index lookup per relational root consumed** … **These per-node values are the declared `examinedEntryCeiling` facts §D6 exposes**…"

§D6 declares exactly one scalar per node: `examinedEntryCeiling: number` (`:1451`). The sentence says "these per-node **values**" (plural) map to it. A relational node's number is then either `take` or `2 × take`; a bounded-child node's is either `take + 1` or `take + 2`. A9 requires a byte-exact golden inspection trace, so a Rust/JS divergence here is a real parity failure. LLP 0135 §2.5 keeps the units separate ("`Σ (takeᵢ + 1)` examined child-range entries **plus** one point-read per deduplicated parent declaration", `:754-756`), which is the resolution I would expect — but the amendment does not say so, and A14 `:2377-2381` then lists four dimensions ("examined child-range entries, parent point-reads, examined root-range entries, and exactly one joined-side unique lookup"), reinforcing that four numbers exist for one field.

**Concrete fix:** one clause — "a node's `examinedEntryCeiling` is exactly its examined index-entry count (`takeᵢ + 1` for a bounded-child node, `takeᵢ` for a relational node); parent point-reads are projected by §D6's `parentAuthorizationGroupCount`, and the per-relational-node joined-lookup ceiling (`takeᵢ`) is deliberately not a v1 §D6 field — A14's work instrumentation covers it."

---

## NIT concerns

- **N4bis / C4 → NIT — IN-DELTA (item 1).** The out-of-partition list (`:2086-2091`) names only the custody-ground mint failure and the result-contract load refusal, but `SNAPBACK_SNAPSHOT_BATCH_LIVE_CURSOR_UNSUPPORTED` is also a continuation presented to a v2 composite, and it refuses "before storage" (A14 `:2361-2363`; LLP 0135 §2.5 `:771`) — i.e. **before** the sealing precheck the paragraph says the partition is reached after. Not a resolution ambiguity (A14 and LLP 0135 §2.5 both pin the ordering), only an incomplete enumeration inside a stated totality. *Fix:* add "…, and a cursor-bearing subscribe refuses with `SNAPBACK_SNAPSHOT_BATCH_LIVE_CURSOR_UNSUPPORTED` before any storage work and therefore before the sealing precheck."

- **N1 — NIT — IN-DELTA (item, §D4).** `:1326-1327`: "including each relational node's complete conservative set (**LLP 0080 §3**)". LLP 0080 §3 is *Visibility and authority*; the table-granular conservative invalidation rule ("a commit touching any declared source or authorization dependency causes an authoritative resnapshot") is **§4** (`llp/0080-…:384-387`), and LLP 0135 §2.5 cites §4 for exactly this. *Fix:* §4.

- **N2 — NIT — IN-DELTA (item 4).** `:2033-2035`: "any other declared order-field type (**notably float or decimal**, which LLP 0080 admits for standalone ordering…)". There is no `decimal` field type — `FieldType` is `String | Boolean | Integer | Real | Vector | Json | Principal | Id | RelationIncarnation | AssetRef` (`src/manifest.rs:1189-1220`). The types the closed set actually excludes and that a reader could mistake for "a portable string" are `principal`, `relationIncarnation`, and `assetRef` — note that `maxEncodedBytes` is String-only in shipped validation (`src/local.rs:25493-25496`), so they refuse correctly today, but naming them makes the closure self-evident. *Fix:* "notably float (`v.real()`), and equally `v.principal()`, `relationIncarnation`, and `assetRef`, which are string-shaped but carry no `maxEncodedBytes` declaration."

- **N3 — NIT — IN-DELTA (item 1); registration gap PRE-EXISTING.** `:2087-2090` carves out "a custody-ground mint failure … with its **distinct public custody diagnostic** (LLP 0135 §2.4…)" without naming it. Main ships `SNAPBACK_SNAPSHOT_BATCH_CURSOR_MINT_UNAVAILABLE` (`src/local.rs:27046`, public-classified at `src/server.rs:25059`), and LLP 0135 §2.4 also names no code, and §3's registry does not list it. *Fix:* name the code here and add a dated line to LLP 0135 §3 exactly as the 2026-08-04 `RESULT_CONTRACT_INVALID` addition did (`llp/0135-…:815-824`) — the identical residue pattern the DK-9 reconciliation already used.

- **N5 — NIT — IN-DELTA (item 3).** `:2133-2135` attributes "index-served with no residual post-index predicate" to "LLP 0080 §2's pipeline". §2 owns `take`-bounds-consumed-authorized-roots and the terminal rule; the *index-served, no-residual-post-index-predicate* guarantee (and the owner-field-leading index that keeps invisible roots out of the examined range) is **§1** (`llp/0080-…:168-188`). Both are needed for the `take`-entry ceiling to hold; cite both.

- **N6 — NIT — IN-DELTA (item 13).** `guide/sync/offline-and-retention.md` now records a 2026-08-06 fact while its frontmatter still reads `reviewed: 2026-08-05` / `reviewed-commit: HEAD`; `check-guide` emits "reviewed-commit is unpinned (HEAD) — **pin it in the landing change**". *Fix:* bump `reviewed` to 2026-08-06 and pin the landing commit.

- **N7 — NIT — IN-DELTA (item 11).** `llp/0135-…:1287-1291` is ungrammatical: "an authored result contract that narrows the two-arm §2.3 envelope **is the same load-time result-contract mismatch** `SNAPBACK_SNAPSHOT_BATCH_RESULT_CONTRACT_INVALID` **refuses**". *Fix:* "… is the same load-time result-contract mismatch: `SNAPBACK_SNAPSHOT_BATCH_RESULT_CONTRACT_INVALID` refuses."

- **N8 — NIT — IN-DELTA (item 8).** §D1 `:361-362` carries "no shipped generated artifact may require the capability **(acceptance-corpus fixtures may)**"; §Status `:2571-2572` repeats the gate without the carve-out. Not a conflict ("shipped" already excludes fixtures), but the fan-out documents call §D1's list canonical, so the two copies should read identically.

---

## Verified-correct (spot checks worth recording)

- Byte arithmetic reproduces exactly: `8,192 − len("sbsb2.") = 8,186` base64url characters; `8,186 mod 4 = 2` → `⌊8,186 × 3/4⌋ = 6,139` decoded bytes; `6,139 − 24 − 16 = 6,099` plaintext. Identical to `sbsb1` because both prefixes are five characters (`src/snapshot_batch_cursor.rs:17-19` agrees).
- Prefixes are genuinely mutually prefix-free against every shipped cursor family: `sbbc1`/`sbsb1`/`sbsb2`, plus `sbrc1` (LLP 0080 standalone, `src/rqs.rs:56`), `sbrt1`, `sbpc1`.
- `take + 1` / `take: 0 → 0` is exactly LLP 0110 §1.2 (`:239-241`) and the executor closure (`:1197-1199`); `Σ (takeᵢ + 1)` as an *upper* bound over per-node declarations is honest given the `take: 0` carve-out.
- The relational ceiling is faithful to its authorities: LLP 0080 §2 `:252-254` ("A page that consumes fewer than `take` roots is terminal") justifies "no lookahead entry", and §1 `:168-188` supplies the index-served/no-residual-predicate premise that keeps examined entries inside the window even on the "mostly-invisible" acceptance fixture.
- The acknowledgment gate is exact against shipped code: `relational_query_v1` is stable (it fell out of the non-stable arm of `CapabilityId::maturity`, `src/manifest.rs:9155-9163`), `bounded_children_v1` is experimental, so "exactly `snapshot_batch_v2` plus `bounded_children_v1`" and "an all-relational tuple acknowledges `snapshot_batch_v2` alone" both hold. LLP 0134 §1 is indeed the `MaturityIntroductionRecordV1` / `same-commit.v1` locus.
- The §D3 assignment-registry lead-in fix is correct and the table is now genuinely total: `mixed-route.v2` has no cursor per §D2 `:680`, and `exported_query_v1` is "not admitted as an algebra single-node API", so no rows are missing.
- The sealing-beats-restart precheck is consistent with LLP 0135 §2.3 (`:676-679`) and with shipped v1 (`src/local.rs:28133` ff. validates the cursor only after `group_rows` are proven visible — note the `expect("all groups visible after seal check")` at `:28160`), and it is *executable* because parent ids come from arguments, not the credential.
- The arm-set narrowing (item 2) is sound against §D2's rotation table: `resultContractHash` is a member of `QueryMaterializationPreimageV1.function` (`:743`), so class mix does rotate `PlanHashV1` → QMK, while the arm set alone does not.
- Migration (item 9) is accurate: LLP 0135's 2026-08-03 record does publish local support with remote/hosted support-false (`llp/0135-…:1222-1223`).
- Fan-out copies (LLP 0166 header + three body spots, `guide/capabilities.md`, `guide/sync/offline-and-retention.md`, the residue ticket) all agree with the primary; none over-claims. The ticket correctly records LLP 0110 §1.1's stale `sbpi1.<…>` `ParentIncarnationV1` spelling (`llp/0110-…:205-206`) as owner residue against the canonical UUIDv7 reconciliation (`:995`) — I confirm the drift and that the §D8 36-byte template depends on the UUIDv7 reading. **Pre-existing, disclosed, and ticketed; not blocking.**

---

## Altitude dispositions

- **This Spec's altitude (fix here, in v0.12):** C1 (state the `streamEpoch`/authority-partition relationship and the precedence, or drop the epoch-restart clause), C2 (pin the four template digits), C3 (`examinedEntryCeiling` unit), N1, N2, N5, N8, and the C4/N-clause on `LIVE_CURSOR_UNSUPPORTED`.
- **Owner-document altitude (dated one-liners, land with the amendment):** LLP 0110's identical stream-epoch/authority-partition overlap (C1's pre-existing half); LLP 0135 §3's missing `SNAPBACK_SNAPSHOT_BATCH_CURSOR_MINT_UNAVAILABLE` registration (N3); LLP 0135's grammar (N7); LLP 0110 §1.1's `sbpi1.` spelling (already ticketed).
- **Implementation altitude (ticket, not a document fix):** `snapshot_batch_max_boundary`'s `Value::Bool(true)` and positive-only max-integer template under-counts, reconciled to whatever C2 pins.
- **Landing hygiene:** N6 (guide frontmatter pin/date).
- **Out of scope / deliberately not re-litigated:** the 2026-08-05 owner ruling, the unnarrowed two-arm envelope for every v2 composite, the closed four-type order-field set, and the relational `take`-entry ceiling as the chosen ceiling.

Nothing in this round rises to BLOCKING: every MATERIAL is a one-to-three-sentence exactness fix inside text the amendment already owns, and none of them threatens the registration's shape, the growth budget accounting, or the honesty gates. But all three are genuine cross-language resolution ambiguities in the exact regions round 3 rewrote, and two of them (C1, C2) would produce divergent frozen parity vectors — the artifact the gate list depends on.

VERDICT: NOT READY — confidence 0.82

## v0.11 amendment loop, round 4 — 2026-08-06

**Round record (persisted before launch).** Final delta round under the
LLP 0010 §2 addendum's "remaining in-delta fixes get one more delta round"
allowance (the default 3-round budget was reached at round 3; launch caps
are respected at 4 of 6 per family). The orchestrating session applied all
round-3 findings from both families: Codex R3-C1 (cross-profile refusal
scoped under each surface's sealing/visibility precheck) and NITs R3-C2/
R3-C3; Claude R3 C1 (streamEpoch axis + cross-authority-first precedence,
fix (a), plus the LLP 0110 dated reconciliation discharging the flagged
pre-existing MATERIAL), C2 (four family template widths pinned; v1
under-count ticketed as
issues/20260806-snapshot-batch-template-width-undercount.md), C3
(examinedEntryCeiling unit), and NITs C4/N1/N2/N3/N5/N7/N8 (N6's guide
frontmatter pin is deferred to the landing commit by design). Revision
hashes (sha256):
0157=e87acca491a84ff3c02f86cbebca805c2ab370999908e3d6f9e8c198009adb8a,
0135=746159671abc358263b76cd881e45740a7114136eebada291ccbee531abe864a,
0080=01606da44bea9c06212042a8810d88a2b2fb5e44d89f7dd795c6f9e6e7b0ede7,
0110=28cfd4af2302c83e05bdf05a3dd08a65f5e1e9b2929c76560f20a789f6e2140f.
Capsule: scratchpad review-instructions-r4.md + v011-delta-r4.diff (1,024
lines). Stop rule: after this round, remaining in-delta fixes are applied
and labeled unreviewed, or the loop escalates; a MATERIAL concern in
pre-existing text still blocks delta convergence.

**Provenance:** Claude family, fresh Opus session via the Agent tool (general-purpose, no orchestrator context), 2026-08-06. Mutually blind; the body discloses two incidental exposures via in-scope ticket files that name review-artifact filenames/finding IDs (neither artifact was opened). Verdict binds to the round-4 revision hash vector recorded above. Body verbatim below.

I have completed my verification. Here is my review.

---

# LLP 0005 review — LLP 0157 v0.11 (`snapshot-batch.v2` / `sbsb2`), round 4 (delta)

**Reviewer:** Claude family, independent. **Repo:** `/Users/ccheever/projects/snapback`.
**Snapshot verified:** all four pinned sha256 digests reproduce exactly (`shasum -a 256` on 0157/0135/0080/0110 → `e87acca4…`, `74615967…`, `01606da4…`, `28cfd4af…`). `./ref-check` → `ok — 188 LLP docs, 6217 refs in 18990 files, 0 errors, 0 unchecked`.

**Blindness attestation.** I did not open anything under `llp/reviews/`. Two **incidental disclosures**: the in-scope ticket `issues/20260806-snapshot-batch-template-width-undercount.md` names `llp/reviews/0157-composition-algebra-and-completeness.claude.md` in its `Related:` line and "Claude round-3 review finding C2"; the in-scope ticket `issues/20260804-llp-0166-finish-out-residue.md` cites "Claude R2 N10". I read only those two ticket files (both are listed fan-out targets) and opened neither review artifact, nor any orchestrator note.

## Verification performed against code and authorities

| Pinned fact | Verification | Result |
| --- | --- | --- |
| `streamEpoch` / authority-partition precedence vs shipped v1 validator | `src/local.rs:28143–28154` compares `body.authority_partition` (→ `CURSOR_INVALID`) **before** `body.stream_epoch` (→ `RESTART_REQUIRED`); `snapshot_batch_authority_partition_digest` (`:27069–27110`) embeds `"authorizationStreamIncarnation": stream_epoch` inside `principalDataScope`, matching §D2's `AuthorityPartitionV1` byte-for-byte | **Exact.** Genuine rotation rotates the digest → collapses to `CURSOR_INVALID`; restart-on-epoch is reachable only by tamper. The in-tree test matrix (`:42502` vs `:42529`) confirms both arms. |
| String template = `maxEncodedBytes` × 6 + 2 quotes | RFC 8785 §3.2.2.2 inherits `JSON.stringify` escaping: max per-**byte** expansion is 6 (` ` for a single-byte control char); multi-byte UTF-8 and lone-surrogate cases are strictly cheaper per byte. Shipped `snapshot_batch_max_boundary` uses `"\u{0}".repeat(bound)` — tight | **Correct and tight.** |
| Integer = 17 chars (`-9007199254740991`) | 1 sign + 16 digits; RFC 8785 number spelling is ECMAScript `Number::toString`. Shipped code uses positive `9_007_199_254_740_991` (16) | **Correct**; the named under-count is real and ticketed. |
| Boolean = 5 (`false`) | Shipped code uses `Value::Bool(true)` (4) | **Correct**; under-count real and ticketed. |
| Id / root-`_id` = 256 unescaped + 2 quotes | See **M2** | **Not sound as stated.** |
| Excluded-type list | `FieldType` (`src/manifest.rs:1189–1247`) is `String|Boolean|Integer|Real|Vector|Json|Principal|Id|RelationIncarnation|AssetRef`; `snapshot_batch_max_boundary`'s `_ => Err(budget_exceeded)` refuses everything but String/Integer/Boolean/Id | **Matches shipped refusal set.** (`Real` = `v.real()` confirmed.) |
| `examinedEntryCeiling` unit vs §D6 / A9 / A14 | §D6 `ServerCompositionInspectionV1.plan.nodes[].examinedEntryCeiling` is per-node; `parentAuthorizationGroupCount` is plan-level (`:1452`, `:1458`). LLP 0110 §1.2 (`:1197`) — "fetches at most `take + 1`; `take: 0` performs no child read". LLP 0080 §1 index-served premise (`:170–187`) and §2 `take` bound confirmed. A14 instruments the joined-lookup ceiling | **Consistent.** The reconciliation that LLP 0135 §2.5's `Σ(takeᵢ+1)` is an *upper bound* (not exact at `take: 0`) is correct and well made. |
| Scoped cross-profile refusal vs LLP 0110/0080 | LLP 0110 §sbbc1 (`:1186`) — "After parent visibility succeeds, the runtime … decrypts and validates"; code (`local.rs:28400–28448`) defers all cursor bytes until after `parent.expect("visible parent exists")`. LLP 0080 §3 keeps missing/invisible byte-indistinguishable | **Correct.** The scoping is a genuine improvement: it no longer over-claims that cursor validation precedes a receiving surface's sealing. |
| Owner-code spellings | `SNAPBACK_RELATIONAL_CURSOR_INVALID` (`local.rs:26981`), `SNAPBACK_BOUNDED_CHILDREN_CURSOR_INVALID` (`:26998`), `SNAPBACK_SNAPSHOT_BATCH_CURSOR_MINT_UNAVAILABLE` (`:27046`, publicly classified `server.rs:25059`), `SNAPBACK_SNAPSHOT_BATCH_LIVE_CURSOR_UNSUPPORTED` (`:16214`) | **All four exist as spelled.** |
| §D4 citation | LLP 0080 §3 `:361` "The complete conservative dependency set…"; §4 `:385` "V1 invalidation is deliberately table-granular" | **Exact.** |
| §D3 lead-in totality | §D2 `:680` — `mixed-route.v2` "has no cursor, completeness proof, retention, parent group, or delta claim" | **Exact.** Closes a real totality gap. |
| §Status ↔ §D1 gate copy | Both carry "no shipped generated artifact may require the capability (acceptance-corpus fixtures may)" verbatim | **Matches.** |
| No premature claim | `grep -rn "snapshot_batch_v2\|snapshot-batch.v2" src schemas` → **zero hits** | **Honest.** Registration is semantic-only as stated. |
| Wire arithmetic | 8,192 − 6 = 8,186; ⌊8,186 × ¾⌋ = 6,139; 6,139 − 24 − 16 = 6,099 | **Exact.** |

---

## Findings

### M1 — MATERIAL — **IN-DELTA** (round-4 revision item 10)
**LLP 0110's new dated note asserts a consequence that is false for the `sbbc1` family whose protocol it claims to reconcile.**

Exact quote, `llp/0110-bounded-children-and-activity-patterns.spec.md` (dated note 2026-08-06):

> LLP 0157 §D8 also states the family validation precedence this Spec's `sbbc1` protocol left implicit: the authority-partition comparison is evaluated before the stream/restore-epoch comparison, so **a genuine rotation (which changes both) collapses to the cursor-invalid class and the epoch-restart outcome is the tamper-only case** — the shipped order

The **ordering** half is true for `sbbc1` (`src/local.rs:28446–28453`: `authority_partition` → `bounded_children_cursor_invalid()`, then `stream_epoch || parent_incarnation || parent_version` → `bounded_children_parent_restart_required()`). The **consequence** half is not, because the two families bind different objects under the same field name:

- `sbsb1`/`sbsb2` bind `authorityPartition` = `AuthorityPartitionDigestV1`, whose preimage contains `principalDataScope.authorizationStreamIncarnation` (`src/local.rs:27097–27102`; §D2 `:776–780`). A rotation therefore *does* change both members.
- `sbbc1` binds `authorityPartition` = `prepared.authority().resolved().invalidation_subject()` (`src/local.rs:28415`), a bearer-free **session-identity** string (`src/auth/invocation.rs:428–460`) that carries no stream incarnation. The authorization-stream incarnation is a *database-level* record (`src/storage/auth_stream.rs:28–45`), independent of it.

Consequence: for `sbbc1`, a genuine authorization-stream restore/rotation changes `streamEpoch` **only**, so the shipped code returns `SNAPBACK_BOUNDED_CHILDREN_PARENT_RESTART_REQUIRED` — which is the correct and desirable outcome for that family (a restore should restart, not masquerade as a tampered credential). The note asserts the opposite of shipped behavior and, worse, an implementer reading an Accepted Spec's normative dated note could "reconcile" a working, frozen-vector code path into the wrong outcome class.

Note the tell: LLP 0135's parallel 2026-08-06 note states the same precedence **without** the "(which changes both)" clause and is therefore correct for its own family. The clause was transplanted into 0110 where its premise does not hold.

**Concrete fix** (two clauses, no design change):

> …the authority-partition comparison is evaluated before the stream/restore-epoch comparison — the shipped order, which this Spec's protocol section left implicit. The stronger `sbsb1`/`sbsb2` consequence does **not** carry to `sbbc1`: those families bind `authorityPartition` as §D2's `AuthorityPartitionDigestV1`, whose preimage contains the stream incarnation, so a genuine rotation changes both members and collapses to cursor-invalid; `sbbc1` binds the coarser authority-partition identity, which a stream rotation does not move, so a genuine rotation legitimately reaches `SNAPBACK_BOUNDED_CHILDREN_PARENT_RESTART_REQUIRED`. The protocol section's two lists gain no new code.

**Altitude:** correctly at 0110's altitude as a boundary note; the fix is a scoping clause, not an escalation. The corresponding §D8 `sbsb1` paragraph sentence ("the same cross-authority-first precedence the `sbsb2` section pins for the family") is *correct as written* because it is scoped to the `sbsb` families — but if the family-wide phrasing is meant to reach `sbbc1`, it needs the same one-clause carve-out.

---

### M2 — MATERIAL — **IN-DELTA text resting on a PRE-EXISTING premise** (round-4 revision item 3)
**The pinned id template width is not a sound ceiling for `Id`-typed order fields; only the framework-minted root `_id` is bounded.**

Exact quote, `llp/0157` §D8 "Budget":

> an id-typed order value and the root-`_id` tie-break count **256 unescaped bytes** plus the two framing quotes (a deliberate ceiling above LLP 0148's 20–38-character minted spelling; §D2's 256-byte `*Id` rule scopes this Spec's record fields, so the profile pins the same number for row ids explicitly)

Two distinct values are being covered by one digit, and only one of them is bounded:

1. **The root `_id` tie-break — sound.** `_id` is a system field; writes carrying it refuse with `SNAPBACK_SYSTEM_FIELD_WRITE` (`src/storage.rs:17872–17878`), so every `_id` is framework-minted: LLP 0148 `prefix_` + 26 Crockford base32, or a canonical UUIDv7 (`src/ids.rs:14–39`). Escape-free and far under 256. ✔
2. **An `Id`-typed order value — not sound.** A `v.id("table")` field is ordinary application data. Its only value validation is *nonempty string* (`src/args_contract.rs:237–243`: `Principal | AssetRef | Id { .. } => value.as_str().filter(|text| !text.is_empty())`), stored as opaque TEXT (`src/storage.rs:19345–19352`; the decoder test at `:27821` calls it "an exact opaque-string identity"). There is **no** length bound and **no** grammar bound. `maxEncodedBytes` is optional per `(table, field)` and enforced only where declared (`validate_order_field_bound`, `src/storage.rs:17971–17990`); `snapshot_batch_max_boundary` requires it for `FieldType::String` only, substituting a hard `"x".repeat(256)` for `FieldType::Id`.

So a `v.id()` order value of 10,000 bytes, or 256 bytes of `"` (which JCS-escapes to 512), sails past the establishment template and blows the 6,099-byte plaintext budget at mint time on page *N* — producing exactly what the same paragraph promises cannot happen:

> disagreement is an invariant failure, **never a terminal result or a data-dependent pagination cliff**

This is sharpest precisely where the amendment does *new* work. LLP 0110 §1.2 at least admits ids as "table-scoped ID under **canonical** ID-byte order"; LLP 0080 has **no** root order-field type restriction at all (§1 `:139–187` requires only deterministic, index-served ordering ending in the root `_id`), so this amendment is the first document to admit `Id`-typed *relational* root order fields — at an unenforced ceiling.

It is also internally inconsistent: the same sentence *excludes* `principal` and `assetRef` on the express ground that they "carry no `maxEncodedBytes` bound", while *admitting* `Id`, which equally carries none.

**Classification note (delta round):** the underlying premise — "integer, boolean, and **id widths are closed**" — is **PRE-EXISTING** owner text in LLP 0135 §2.4 (`:712–713`), and the unenforced 256 is pre-existing in `snapshot_batch_max_boundary`. Per the round-4 instruction I flag it explicitly as **a MATERIAL concern resting on pre-existing text**. What is new, and what makes it reviewable here, is that v0.11 (a) pins the digit as a to-the-digit family ceiling, (b) extends it to a surface with no owner canonicality claim, and (c) attaches the no-cliff invariant promise to it.

**Concrete fix** — either is cheap and preserves the chosen digits (no width-policy change):

- *(preferred, closes it)* require the bound symmetrically: "an id-typed **order field** must additionally carry the same schema-level, write-enforced `maxEncodedBytes` bound a string order field requires, and counts it at the same six-character escape expansion; the framework-minted root-`_id` tie-break needs no declaration and counts 256 unescaped bytes plus the two framing quotes, since `_id` is a system field no write may supply and every minted spelling is LLP 0148 base32 or canonical UUIDv7."
- *(minimum, honest)* keep the 256 as inherited from LLP 0135 §2.4's closed-id-width premise and state that the premise is not yet write-enforced for `v.id()` fields, tracking it in `issues/20260806-snapshot-batch-template-width-undercount.md` alongside the boolean/integer reconciliation — the amendment already established exactly this pattern for the strictly smaller sibling gap.

**Altitude:** the ceiling statement belongs here (this Spec owns the cursor budget); the *enforcement* belongs to LLP 0135 §2.4 / the write boundary, so the fix is a scoping sentence plus a ticket line, not new machinery in 0157.

---

### N1 — NIT — IN-DELTA (revision item 3)
**"one family template, not two" reads onto `parentVersion`, which the `sbsb1` paragraph pins at a different digit.**

New text: "The template widths are pinned to the digit, and they govern the `sbsb1` template identically — **one family template, not two** … a JavaScript-safe integer counts 17 characters (`-9007199254740991`)". Forty lines above, unchanged: "The pre-read parent template uses 36 ASCII bytes for LLP 0110's UUIDv7 `parentIncarnation` and **16 decimal digits** for the maximum portable-safe-integer `parentVersion`."

Both are right — `parentVersion` is `u64` (`src/snapshot_batch_cursor.rs:32`, guarded by `valid_body_numbers`), so 16 digits is exact — but two of the four pinned widths are explicitly scoped to *order values* ("a string **order value**", "an id-typed **order value**") while the integer and boolean widths are bare, so a careful implementer must guess whether the 17 supersedes the 16. Getting it wrong over-counts by one byte per group (safe, never unsafe), so this is a NIT, not MATERIAL.

**Fix:** "a JavaScript-safe integer **order value** counts 17 characters (`-9007199254740991`); a boolean **order value** counts 5 (`false`). The nonnegative `parentVersion` keeps its 16-digit pin above."

### N2 — NIT — IN-DELTA (revision item 3)
**The stated exclusion *reason* is inaccurate for one of the three named string-shaped types.**

> …and equally the string-shaped `principal`, `relationIncarnation`, and `assetRef` declarations, **which carry no `maxEncodedBytes` bound**

Accurate for `principal` and `assetRef`. Not for `relationIncarnation`: §D8's own `sbsb1` paragraph pins **36 ASCII bytes** for exactly that shape (`parentIncarnation`), and `src/manifest.rs:4374` gives it `ResultValueContract::String { max_bytes: 64 }`. The *outcome* (refuse) is right and conservative — it matches the shipped `_ => Err(budget_exceeded)` arm — but in an amendment whose thesis is pinning facts to the digit, the justification should not be one that the same section contradicts.

**Fix:** drop `relationIncarnation` from the "no bound" clause and give it its own half-sentence — e.g. "…and `relationIncarnation`, which is framework-owned and never an application order axis, is likewise outside the closed set."

---

## Concerns explicitly *not* raised

For the record, I checked and cleared these: the `mixed-route.v2` no-row parenthetical (correct per §D2); the growth stop rule's 4-of-4 / 6-class arithmetic and its crosswalk row (consistent); `NormalizedCompositePlanV1`'s "only schema change is the enumerated addition … every predecessor record instance's bytes are unchanged" (true — JCS serializes values, not type unions); the three-vocabulary state-tag mapping (`bounded-children.v1` → `kind:"boundary"` vs `relational-query.v1` → `kind:"relational-boundary"` vs the digest vector's class-agnostic `kind:"boundary"`) — awkward but fully specified and closed by the state-tag/class refusal; A14's forward reference to "LLP 0135 §3's closed codes" for the not-yet-registered no-relational-node refusal (§D1 explicitly routes it there under the placeholder rule); the arm-set/`resultContractHash` reasoning (correct and a good catch by whoever wrote it); and the guide/0166/issues fan-out, all of which stay honest GAPs with no support or capability claim. The deferred `reviewed`/`reviewed-commit` frontmatter pin is excluded per the brief.

**MATERIAL concerns in pre-existing text:** one — **M2**'s underlying premise (LLP 0135 §2.4's "id widths are closed", plus the unenforced 256 in `snapshot_batch_max_boundary`). No other MATERIAL defect was found in pre-existing text on a fresh read of §D1–§D8, the crosswalk, acceptance, migration, and status sections.

**Overall:** this is a strong, unusually well-grounded amendment. The precedence pin, the `Σ(takeᵢ+1)`-as-upper-bound reconciliation, the §D6 unit separation, the `mixed-route.v2` totality parenthetical, the arm-set/QMK reasoning, and the both-directions cross-profile scoping are all exact against the shipped code and the owner documents, and the self-reported v1 template under-count with its own ticket is exactly the right honesty. Both MATERIAL findings are one- or two-sentence scoping fixes that change no pinned digit and no fixed authority.

VERDICT: NOT READY — confidence 0.88 (high on M1, which I verified directly against three code sites and the two divergent `authorityPartition` bindings; moderate-high on M2, whose severity turns on whether the reviewer counts an unenforced inherited premise as in-amendment — the internal inconsistency with the `principal`/`assetRef` exclusion is what tips it to MATERIAL for me).

## v0.11 amendment loop close-out — 2026-08-06

The loop ran four rounds: the default three-round budget plus the LLP 0010
§2 addendum's one further delta round; launch caps (4 of 6 per family) were
respected. The final family verdicts are the round-4 reviews above and bind
to the round-4 revision hash vector recorded in that round's record. Both
round-4 reviews were NOT READY on narrow, convergent findings: the two
families independently found the same LLP 0110 precedence over-
generalization (Codex R4 C1 = Claude R4 M1) with near-identical fixes, and
Claude R4 additionally found the id-order-field template soundness gap (M2,
resting on LLP 0135 §2.4's pre-existing "id widths are closed" premise and
the shipped hard-256 substitution) plus two NITs each. No round produced a
cross-family contradiction, a defective-decision dissent, or a
fundamental-redesign demand, and finding volume decreased monotonically
(R1: 7 MATERIAL across families; R2: 6; R3: 3 + 1 shared; R4: 1 shared + 1).

Per the delta-round rule ("remaining in-delta fixes get one more delta
round or the final revision is labeled unreviewed"), the orchestrating
session applied every round-4 finding — the owner-scoped LLP 0110/0135
precedence corrections, the id-typed-order-field `maxEncodedBytes`
requirement (discharging the flagged pre-existing premise; ticketed
reconciliation extended in
`issues/20260806-snapshot-batch-template-width-undercount.md`), the vector
(c) adjustment, and NITs Codex R4 C2/C3 and Claude R4 N1/N2 — as a
**closing revision that is unreviewed by either family**. Closing revision
hashes (sha256):
0157=cafbb1838efff2ab4412df6632949ea09666faf124b230cbc6145e4c63fa0134,
0135=0d8edba23ee753d1102f1da15f26f38ae8799b1604c229f961b3277be19350ce,
0080=01606da44bea9c06212042a8810d88a2b2fb5e44d89f7dd795c6f9e6e7b0ede7,
0110=e71d634818d9395b2abe0e033656e8296dfffbcd377cee30bf3241d4ac043341.
The one deliberately deferred landing item is the guide pages'
`reviewed`/`reviewed-commit` frontmatter pin, applied in the landing
commit. Open owner residue is ticketed, not silently dropped: LLP 0110
§1.1's stale `ParentIncarnationV1` spelling
(`issues/20260804-llp-0166-finish-out-residue.md`) and the v1 budget-
template reconciliation (`issues/20260806-…-undercount.md`).

**Terminal state:** stop rule reached; convergence was not dual-READY. The
amendment lands with its closing revision labeled unreviewed under the
delta-round rule; the document's Accepted status is unchanged (no status
transition was in this loop's authority). Recommendation to the author:
treat the four-round record plus the labeled closing revision as the
review basis for this dated amendment; any residual concern re-enters
through an ordinary dated amendment. No prior verdict is reclassified.

## Close-out addendum — supplementary-review disposition (2026-08-06, later)

The v0.11 close-out above enumerated dispositions for the four numbered
rounds but not for the supplementary round-2 Claude-family review recorded
earlier in this artifact (bound to the round-2 hashes). The supervising
session dispositioned it in a follow-up dated amendment (LLP 0157 v0.11.1),
per the close-out's re-entry rule ("any residual concern re-enters through
an ordinary dated amendment"):

- **R2-1 (MATERIAL, IN-DELTA)** — APPLIED: the §D8 `sbsb2` restart
  biconditional is now conditioned on decode validity, with decode-validity
  failures collapsing before any epoch/parent comparison (the implemented v1
  decode-first rule), and the expired-plus-changed-epoch overlap near-miss
  is added to §D8(d) and A14. No round-1–4 verdict reclassified; the fix is
  the review's own concrete fix.
- **R2-2, R2-3** — already fixed by the round-2/round-3 revisions
  (independently found as Codex R2-01 and applied dating parentheticals);
  no action.
- **R2-4 (NIT)** — APPLIED: LLP 0080's Revised-header and boundary-note
  "remain gated" phrasing de-circularized to the outstanding-under-gate
  spelling LLP 0110/0135 use.
- **R2-5 (NIT)** — no change required (the governing experimental-ids rule
  is stated first and controls), as the review itself proposed.
- **R2-6 (MATERIAL, PRE-EXISTING)** — 0157 half already applied by the
  round-4 revision (the v1 `sbsb1` prose carries the epoch-restart case);
  LLP 0135 §2.4 half APPLIED in v0.11.1 (epoch on the restart side,
  `expired` in the collapse list, decode-first ordering).

Like the v0.11 closing revision, v0.11.1 is a dated amendment labeled
**unreviewed by either family**; it binds to the landed v0.11 text and
changes no pinned digit, wire byte, owner ruling, or capability gate.
