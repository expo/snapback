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