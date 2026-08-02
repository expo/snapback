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
