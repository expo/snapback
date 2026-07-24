**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.145.0 — model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, approval never; non-interactive `codex exec` orchestrated by /llp-review
**Date:** 2026-07-24
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** cli-runner

# LLP 0065 reviews — GPT family

## Round 1 — 2026-07-24

1. **Overall assessment**

The proposal’s core idea is good: generated convenience must not invent security meaning, and an intentionally narrow owner-scoped profile is a sensible first step. However, LLP 0065 is not yet sound enough to serve as the Step 5 authorization/visibility floor. Its gating is circular, several public and authorization semantics remain open, and its acceptance suite cannot witness some of its central claims.

2. **Strengths**

- LLP 0065 §1, “Fact classes,” cleanly separates schema-derived facts, explicit security declarations, and runtime evidence. The rule that observations may verify but never widen a ceiling is exactly right.
- LLP 0065 §2, “The v1 visibility floor,” makes visibility mandatory and explicit, requires authentication, executes the owner predicate rather than treating metadata as enforcement, and prevents client-directed ownership transfer.
- LLP 0065 §3, “Common pattern contracts,” correctly requires real unique indexes, explains why pagination needs an exact unique owner partition, and refuses silent offset fallback.
- The trusted-default design is appropriately narrow: only existing `RuntimeNow`/`RuntimeId` expressions, omitted client properties, and closed argument schemas (§3).
- Deterministic generation and fail-before-replacement behavior are strong agent-facing defaults (§4, “Generated artifacts and diagnostics”).
- The scope boundary is disciplined: LLP 0065’s Summary explicitly does not authorize joins, projections, or migrations, leaving those to LLP 0080/0081 as LLP 0063 intends.

3. **Concerns**

1. **HIGH — The acceptance/implementation gate is circular.** LLP 0063 §Workstream 6 and §Sequence require LLP 0065 acceptance before inference and standard-pattern work proceeds, while LLP 0065 §5 requires implemented generation, real-server tests, per-pattern receipts, and a Step 5 Partitime receipt before acceptance. The existing “implementation candidate” does not resolve the circular Partitime dependency.  
   **Resolution:** make semantic `Accepted` authorize implementation, then gate `Implemented` and `STEP5.DECLARATION_REDUCTION` on executable conformance receipts. Alternatively, explicitly authorize non-shipping witness prototypes while Draft.

2. **HIGH — Generated query capabilities and LLP 0053 composition are unspecified.** LLP 0065 §§2–3 emit queries and `authScopeField`, but never classify them as callable-only, live-replace, syncable, retained, or auth-resyncable. LLP 0053 requires complete capture, conservative fallback, convergence proof for authorization-sensitive skips, obligation-backed shrinkage, mandatory non-live resnapshot, and leases for retention. LLP 0065 §5 tests only point-in-time server access.  
   **Resolution:** define a capability matrix for every emitted function. Any live or retained owner query must explicitly inherit LLP 0053, including authority-partition identity, complete read summaries, `authScopeField` convergence, negative-delivery obligations, late-result fences, reconnect/resume resnapshot, and lease gates. Add generated-pattern composition tests.

3. **HIGH — The authority subject and tenant boundary are not closed.** LLP 0065 §2 uses `ctx.auth.userId` without pinning effective-principal behavior for human, autonomous-agent, delegated-agent, anonymous, system, and admin modes. It explicitly defers tenant profiles, while LLP 0063 §Workstream 6 requires cross-tenant negatives for every generated pattern. A plain string owner field also leaves namespace assumptions implicit.  
   **Resolution:** normatively bind ownership to the accepted effective-principal projection and define eligible authority modes and equality semantics. Either restrict `owner.v1` to per-app/single-tenant contexts and define cross-tenant testing as app-isolation testing, or add a composite tenant-plus-owner profile with same-user/different-tenant cases.

4. **HIGH — Public noninterference is optional and misses other existence channels.** LLP 0065 §2 permits distinct missing/invisible codes and only says public targets “may” collapse them; Open Question 4 leaves this unresolved, yet §5 claims another owner’s row cannot be observed. Moreover, a client-influenceable global unique index can reveal a hidden row through conflict-versus-success on create or update. Raw `delete(id) -> existed` behavior could do the same if inherited from LLP 0004.  
   **Resolution:** require identical public status/code/body/schema for absent and invisible outcomes by default, with private causes only in gated audit/doctor traces. Require every client-observable constraint to be owner-partitioned or covered by an explicit disclosure declaration. Test missing versus other-owner outcomes and cross-owner unique conflicts for every adapter.

5. **HIGH — Standard mutating helpers have no authority-bearing-table eligibility rule.** `defineOwnedCrud` accepts an installed table without excluding membership or `permissionBacking` tables (§3). Those writes are governed by LLP 0055/0056’s `authorityCreating`, provenance, and effect-site gates; generic CRUD could otherwise become an authority-laundering surface.  
   **Resolution:** add a closed eligibility matrix. Mutating standard helpers should reject membership and permission-backing tables before artifact emission until a dedicated authority-creating profile exists. If such writes are later admitted, derive the static marker from the complete write ceiling and retain the authoritative runtime effect gate.

6. **HIGH — The CRUD and keyset-page contracts are not portable public specifications yet.** `list` has no required owner-prefix index, explicit order, bound, or truncation signal. Keyset pages leave cursor type, ordering direction, limit, token encoding and validation, first/next result shapes, `_id` tie-break composition, and concurrent cursor-field mutation behavior undefined. LLP 0007 §Query Semantics requires bounded deterministic ordering ending in `_id`; LLP 0065 §5 contains no pagination witness.  
   **Resolution:** specify versioned `OwnedCrudV1` and `OwnedPageV1` wire contracts, including exact arguments/results/errors, portable cursor-field types, index order, direction, page bounds, opaque cursor contents, and concurrency guarantees. Require owner-indexed list behavior or remove unpaginated `list`. Add cross-target no-skip/no-duplicate and malformed/cross-owner cursor tests.

7. **HIGH — Ceiling completeness is neither defined nor proven.** LLP 0065 §1 says codegen “may” compute a reachable union, without defining the ceiling’s granularity or a total traversal. LLP 0065 §5’s subset check and one out-of-ceiling fault prove runtime enforcement, not that every reachable branch or future IR node entered the ceiling. For opaque live queries, an underdeclared read may never cause the rerun that would discover the mismatch.  
   **Resolution:** define a canonical `EffectCeilingV1` covering operations, tables, indexes/ranges, cardinality, host operations, and authorization dependencies. Closed-plan generation must use a total recursive traversal and default-deny every unknown node. Assert exact expected ceilings for all constructors separately from runtime subset tests. Opaque handlers with unproved summaries must remain ineligible for live/retained capability under LLP 0053.

8. **HIGH — The transactional owner guard is not reconciled with the governing execution contracts.** LLP 0065 §2 requires an in-transaction read and guard. That implicitly needs LLP 0051 D2’s conditional `Get → Guard → Patch/Delete` model, while LLP 0004 and LLP 0007 still describe HostPlans as unconditional writes using a client-supplied baseline. LLP 0065 neither selects and reconciles the model nor tests a race.  
   **Resolution:** explicitly lower generated update/delete to a server-evaluated conditional plan whose read, guard, and write share the authoritative transaction and commit validation. Reconcile LLP 0004/0007 when accepted, and test both commit orders for concurrent owner transfer, deletion, and revocation after the guard read.

9. **MEDIUM — Generated artifact authority and conformance are under-specified.** LLP 0065 §4 does not pin exact result/error schemas, LLP 0004’s stable `{appId}:{exportedName}` identity and rename behavior, or LLP 0037’s Rust-owned manifest/schema drift gate. Section 5’s TypeScript compilation and one real-server run are insufficient portability evidence.  
   **Resolution:** normatively inherit stable function identity, define every helper’s exact public DTOs, extend the Rust-owned artifact schemas, and add schema round-trip/drift tests. Name every currently claimed evaluator and target; require the shared portability corpus before a future target advertises support.

10. **MEDIUM — The cross-document owner-profile dependency is not enforced.** LLP 0080 §3 normatively admits LLP 0065’s owner profile, but LLP 0063’s Step 5 row gates joins/projections on LLP 0080/0081 without requiring LLP 0065 for that path. Owner-visible relational work could therefore nominally open while its visibility profile remains Draft.  
    **Resolution:** either add LLP 0065 acceptance to the owner-visible LLP 0080 entry gate or move `owner.v1` into a shared accepted authorization-profile authority that both RFCs consume.

4. **Suggestions**

- Give every profile and helper a stable versioned identifier such as `owner.v1`, `owned-crud.v1`, and `owned-keyset.v1`.
- Emit a proof/provenance manifest showing which declaration produced every validator, visibility predicate, ceiling fact, default, and capability bit. This would make §1’s fact classes directly inspectable.
- Express the helper contracts as a compact machine-readable matrix: arguments, results, indexes, visibility, capabilities, diagnostics, and required receipt IDs.
- Add property-based generation over schema shapes, authority modes, constraint layouts, and mutations, checked against a small reference oracle.
- Split `SNAPBACK_STANDARD_PATTERN_INVALID` into more actionable stable diagnostics where the reason is mechanically known.
- Add LLP 0081 to LLP 0065’s `Related` metadata, and correct LLP 0080 §6’s stale “0074/0075” references to LLP 0080/0081.

5. **Open questions**

- Which generated reads are callable-only, live, syncable, or retainable?
- Is owner visibility defined over the effective principal, actor principal, or another canonical subject?
- What exactly does “cross-tenant” mean for the v1 owner profile?
- Is public existence secrecy mandatory by default, and which constraints may explicitly disclose existence?
- What cursor stability is promised under concurrent inserts, deletes, and cursor-field updates?
- Which table classes are eligible for each helper?
- What is the canonical ceiling schema and proof of traversal completeness?
- Which status transition authorizes implementation, and which transition requires executable receipts?

6. **Verdict**

Verdict: NOT READY

The proposal has a strong core, but circular gating and unresolved authorization, noninterference, pagination, ceiling, and transactional semantics leave multiple HIGH blockers to acceptance.
## Round 2 — 2026-07-24

**Provider / runtime:** OpenAI Codex CLI v0.145.0 — model gpt-5.6-sol, reasoning effort ultra, sandbox read-only; non-interactive `codex exec` orchestrated by /llp-review. Reviewed the round-1-reconciled revision; permitted to read its own round-1 artifact only. The reviewer noted an accidental sibling-review excerpt surfaced by a search and re-derived findings in a clean pass (see its integrity note).

> **Review-integrity note:** This review targets the round‑1-reconciled snapshot present at the start: commit `ce700efff5e8e3d589150de899021f851a56c1f5`, LLP 0065 SHA‑256 `80d9077f…`. The shared worktree advanced during review. A coordinating search also accidentally surfaced a short sibling-review excerpt; it was excluded, and the findings below were re-derived in a clean GPT-family pass using only the frozen corpus and the permitted Codex round‑1 review.

## 1. Per-concern resolution table

| # | Round‑1 concern | Resolution | Verification |
|---|---|---|---|
| 1 | Circular acceptance/implementation gate | **RESOLVED** | LLP 0065 §6 makes acceptance semantic and implementation-authorizing, while conformance receipts separately gate `Implemented` and `STEP5.DECLARATION_REDUCTION`, consistent with LLP 0063 §Sequence. |
| 2 | Generated-query capabilities and LLP 0053 composition | **PARTIALLY RESOLVED** | §4 now limits queries to callable/`live_replace`, disclaims retention, and inherits LLP 0053; however, §2 emits `authScopeField` as a disjointness fact while §4 claims no disjoint skip, contradicting LLP 0053 §§Negative deltas / Two orthogonal declarations. |
| 3 | Authority subject and tenant boundary | **PARTIALLY RESOLVED** | §2 binds ownership to the effective `ctx.auth.userId` and one app authority domain, but autonomous/dev-impersonation modes remain unclassified, “sealed service” is non-canonical, and §6 lacks LLP 0063’s required cross-app negative. |
| 4 | Public noninterference and existence channels | **PARTIALLY RESOLVED** | §2 now collapses missing/invisible outcomes by default and governs unique-conflict disclosure, but its per-target public-disclosure escape conflicts with §6’s universal byte-indistinguishability requirement and LLP 0080 §3’s audit-only distinction. |
| 5 | Authority-bearing-table eligibility | **RESOLVED** | §3 rejects mutating helpers over membership and `permissionBacking` tables before emission, with a matching §6 negative, preserving LLP 0055/0056 effect-site gates. |
| 6 | CRUD/keyset contracts are not portable public specifications | **PARTIALLY RESOLVED** | §3 adds indexes, total list order, bounds, strict keyset continuation, cursor validation, and concurrency limits, but still omits exact DTOs, continuation/end shape, ordered cursor types, direction/limit surface, and deterministic list-index selection. |
| 7 | Ceiling completeness undefined and unproven | **PARTIALLY RESOLVED** | §1 adds total traversal, unknown-node default denial, exact-constructor tests, and opaque-handler exclusion, but still says codegen “may” compute the ceiling and defines no versioned fact schema or granularity for operations, ranges, host effects, or auth dependencies. |
| 8 | Transactional owner guard unreconciled | **RESOLVED** | §2 explicitly selects LLP 0051 D2’s server-evaluated read → guard → write lowering in one authoritative transaction, rejects a client baseline, requires LLP 0004/0007 reconciliation, and §6 races transfer/delete in both commit orders. |
| 9 | Generated artifact authority and conformance | **PARTIALLY RESOLVED** | §4 inherits LLP 0004’s stable function identity and LLP 0037’s drift gate, but does not define the promised DTOs or Rust-owned profile/helper manifest fields, nor a complete target/profile corpus-admission matrix. |
| 10 | LLP 0080 owner-profile dependency | **PARTIALLY RESOLVED** | §2 says owner-visible LLP 0080 outputs additionally require LLP 0065 acceptance, but LLP 0063 §Sequence and LLP 0080 §Acceptance still omit that owner-mode subgate from their claimed-complete entry conditions. |

## 2. New concerns

1. **HIGH — `authScopeField` both enables and disclaims disjointness skipping.**  
   LLP 0065 §2 emits the field for disjointness, while §§4/6 promise resnapshot on dependency commits and no skip. LLP 0053 defines that field as an explicit skip refinement requiring convergence proof.  
   **Resolution:** either omit/disable it for v1, or admit the skip and add cross-owner-skip/own-owner-wake convergence and negative-delivery tests.

2. **MEDIUM — The anonymous principal diagnostic is unwitnessable under the inherited gate order.**  
   An authenticated function rejects an anonymous caller with `AUTH_REQUIRED` before `owner.v1` can return `SNAPBACK_STANDARD_PATTERN_PRINCIPAL_UNSUPPORTED`; target, credential, and grant-scope refusals similarly precede profile admission.  
   **Resolution:** specify target/credential/grant → authentication → profile-class → owner-predicate ordering, retaining governing codes and reserving the pattern code for otherwise-admitted but profile-ineligible principals.

3. **MEDIUM — The disclosure escape contradicts conformance.**  
   §2 permits public missing/invisible distinction through a target declaration, while §6 requires every claimed adapter to remain byte-indistinguishable and LLP 0080 permits distinction only through a gated audit channel.  
   **Resolution:** remove the escape or define a separately versioned disclosure profile with exact DTO, inspection, capability, and acceptance semantics.

4. **MEDIUM — The revised list/page plan remains underdetermined.**  
   Multiple owner-leading indexes leave list ordering ambiguous, and pagination does not fully specify LLP 0007’s `_id`-terminated order, first/next DTOs, limits, direction, or cursor bindings.  
   **Resolution:** require an explicit `listIndex` and define complete versioned `OwnedCrudV1`/`OwnedPageV1` arguments, results, ordering, cursor identity, and end-of-stream behavior.

5. **MEDIUM — App isolation is asserted but neither represented nor witnessed.**  
   The RFC does not normatively bind cursors, live keys, and capabilities to the application authority domain, and §6 lacks a same-subject/two-app collision fixture.  
   **Resolution:** bind the relevant app/deployment/database/issuer/stream identity and add the cross-app negative required by LLP 0063.

## 3. Verdict

Verdict: NOT READY

The live-invalidation contradiction and remaining principal, secrecy, pagination, ceiling, artifact, tenant, and owner-relational gating gaps prevent spec-level acceptance.
## Round 3 (targeted verification) — 2026-07-24

**Provider / runtime:** OpenAI Codex CLI v0.145.0 — model gpt-5.6-sol, reasoning effort ultra, sandbox read-only; non-interactive `codex exec`.

| Item | Verdict | Verification |
|---|---|---|
| N1 | RESOLVED | [§§2, 4, 6](/Users/ccheever/projects/snapback-review-0065-0080-0081/llp/0065-generated-data-pattern-soundness.rfc.md:111) disable the skip, require conservative resnapshot, and record the disabled refinement. |
| N2 | PARTIALLY RESOLVED | The order and fixtures match, except `system` and admin cannot reach profile admission under accepted LLP 0058. |
| N3 | RESOLVED | [§2](/Users/ccheever/projects/snapback-review-0065-0080-0081/llp/0065-generated-data-pattern-soundness.rfc.md:149) universally collapses missing/invisible outcomes and confines distinction to the audit channel. |
| N4 | RESOLVED | [§3](/Users/ccheever/projects/snapback-review-0065-0080-0081/llp/0065-generated-data-pattern-soundness.rfc.md:204) pins index selection, ordering, versioned DTOs, continuation semantics, and Rust-manifest identities. |
| N5 | RESOLVED | [§3](/Users/ccheever/projects/snapback-review-0065-0080-0081/llp/0065-generated-data-pattern-soundness.rfc.md:235) binds cursors/live keys/capabilities to the authority domain; [§6](/Users/ccheever/projects/snapback-review-0065-0080-0081/llp/0065-generated-data-pattern-soundness.rfc.md:344) adds the two-app negative. |
| P7 | RESOLVED | [§1](/Users/ccheever/projects/snapback-review-0065-0080-0081/llp/0065-generated-data-pattern-soundness.rfc.md:76) requires computed, versioned `EffectCeilingV1` facts with the requested dimensions. |
| P10 | RESOLVED | [LLP 0080 §Acceptance](/Users/ccheever/projects/snapback-review-0065-0080-0081/llp/0080-portable-relational-queries-and-projections.rfc.md:545) explicitly requires accepted LLP 0065 for owner-visible relational work. |

### New blockers

- **MEDIUM — unwitnessable system/admin refusal.** LLP 0065 expects `system` and admin authority to reach profile admission and receive `SNAPBACK_STANDARD_PATTERN_PRINCIPAL_UNSUPPORTED`. Accepted LLP 0058 instead defines `authenticated` as requiring a resolved user, rejects authenticated cron/system targets at manifest load, and keeps admin bypass anonymous ([§Closed function requirement](/Users/ccheever/projects/snapback-review-0065-0080-0081/llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:215), [gate matrix](/Users/ccheever/projects/snapback-review-0065-0080-0081/llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1134)). Preserve their inherited pre-profile refusals or explicitly reconcile LLP 0058.

Verdict: NOT READY

N2 still contains a governing-corpus contradiction that makes two required acceptance cases impossible.
## Round 4 (targeted verification) — 2026-07-24

**Provider / runtime:** OpenAI Codex CLI v0.145.0 — model gpt-5.6-sol, reasoning effort ultra, sandbox read-only; non-interactive `codex exec`.

N2: RESOLVED

New blockers: None.

Verdict: READY

The revised gate order and acceptance witnesses now match LLP 0058’s admin-bypass and system/cron behavior without contradiction.