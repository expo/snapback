# LLP 0104 review — Fable family

## Round 1 — 2026-07-27

**Reviewer family:** Claude Fable  
**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5`  
**Effort:** max  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only tools, mutually blind structurally
isolated capsule  
**Target SHA-256:** `22e8cb22bb3ba0a3afca3939805ed66d05c457119b2fdbd60f4c4a3a561751a5`  
**Capsule SHA-256:** `a148115ddd1ab630d02975cb23203f16cf96107ad2cc0d4391152d0e5670626b`  
**Instruction SHA-256:** `51d1c9d777d26e9cfa197feffac847e5ebb89da785fe66e926eaeadc77a94ee5`  
**Status:** unavailable — provider HTTP 429 before a review was delivered  
**Session ID:** `8ad95dd0-2f82-41f0-86c2-d8229503881c`  
**Duration:** 1,910 ms  
**Failure:** the provider reported that the account reached its monthly spend
limit. This is not a review or verdict and does not count toward convergence.

### Remote retry — completed

**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5` on the approved M4 Mac mini fleet lane  
**Session ID:** `62d6b66a-2708-4237-b156-66460ce3d479`  
**Duration:** 811,955 ms  
**Cost:** $9.320315  
**Status:** completed

I've completed my review pass through the target spec, the governing corpus (LLPs 0080, 0065, 0051, 0007, 0004, 0053, 0043, 0055), the manifest/storage/codegen/wire implementation, the schemas, the guide, and the driving issues. Here is the review.

---

# Review — LLP 0104 (Bounded children and activity patterns), Round 1

## 1. Overall assessment

This is a corpus-literate, disciplined spec that answers LLP 0080's first open question and fills LLP 0065's transaction-pattern gap with the right architecture: closed data plans rather than callbacks, explicit never-inferred visibility (`through-parent.v1`, `through-scope.v1`), exact index requirements with examined-entry work bounds, sealed missing-versus-invisible behavior with a well-reasoned cursor-validation order, conservative `EffectCeilingV1` totals, and honest live/retention classification. Section 1 (bounded children) is close to acceptance-grade: its pipeline, cursor binding, concurrency bound, deletion policy, and live obligations compose LLP 0080/0053/0007 correctly, and I found no soundness hole in the noninterference design.

Section 2 (write-with-activity) is architecturally right but claims to "compose the existing closed-plan … idempotency, and settlement contracts" while actually diverging from them in two verifiable places: it admits a bounded index-range read the LLP 0051 vocabulary does not have, and it redefines the durable settlement identity and refusal semantics that are already implemented and pinned (`src/storage.rs`, `schemas/mutation.input.schema.json`, LLP 0043). Separately, the acceptance sequence leans on a product fixture (Signal Desk) and suites that are not in this repository, and one of the two admitted parent-visibility modes has no acceptance coverage. These are focused, resolvable revisions, not structural rework.

## 2. Strengths

- **Correct amendment posture.** The spec amends the two Implemented authorities rather than restating or competing with them, and the split is thoughtfully chosen: the query profile rides LLP 0080 (so `public-read` stays a query-only 0080 authority), the mutation pattern joins LLP 0065's standard-pattern registry (so `owner.v1` principal admission, table eligibility, and the DTO rule stay controlling). `RelationalQueryPlanV1`/`root-window-v1` are explicitly left untouched.
- **The cursor-after-visibility ordering is genuinely well designed.** Validating the cursor only after the parent is visible makes absent and invisible parents indistinguishable *even under a malformed cursor*, closing a probe channel LLP 0080's pipeline never had to face. The sealed `{"parent":null,"children":[],"continuation":null}` result with parity across status, transport, live initial state, and inspection is the right observation boundary, and the deleted-parent continuation collapsing to the same sealed result is consistent.
- **Work bounds are physical, not cosmetic.** "Bounds count physical range entries, not merely projected rows; there is no post-index predicate" — because v1 refuses independently-visible children instead of filtering after the bound, examined-entries ≤ take + 1 is actually provable, matching the instrumentation precedent LLP 0080's implementation established.
- **Index exactness matches the shipped rules.** `[childForeignKey, ...orderFields]` with the framework-generated scan-order-only `_id` suffix is exactly LLP 0007's amended index contract (verified at `llp/0007` §Index Contract), and the duplicate-order-key totalization and refusal diagnostics mirror the implemented relational corpus.
- **The activity pattern's information-flow spine is explicit.** Seven named provenance slots mapped to author-selected schema-checked fields, no inference from `actorId`/`createdAt` naming, forbidden authority-bearing/projection-output tables, no generated activity update/delete authority, and the honest statement that the activity table name has no security meaning — all faithful to LLP 0065's fact-class discipline. `actor` from the canonical effective user subject and `occurredAt`/row-ID from recorded ledger answers are grounded in mechanisms that exist (`ValueExpr::AuthUserId`, the ctx-answer ledger, ids-sequence row IDs).
- **Capability honesty follows the proven pattern.** Per-target/profile `experimental`→`stable` with executable witnesses, structured GAPs, refusal-before-invocation, and no fallback to scans/client grouping/post-commit hooks — the same shape that took `relational_query_v1` to stable.
- **Diagnostics are new, collision-free families** (`SNAPBACK_BOUNDED_CHILDREN_*`, `SNAPBACK_ACTIVITY_*` appear nowhere else in the repo), and generation preserves the prior output tree per LLP 0065 §5.

## 3. Concerns

**C1 — MATERIAL. §2.1 admits a bounded index-range read the closed plan vocabulary does not have, with no LLP 0051 amendment.**
Evidence: §2.1: the primary plan "may touch the scope row and may read a declared bounded index range." The implemented step set is `Insert | Patch | Delete | Get | Guard | Let | DeleteWhere | InsertEach` (`src/manifest.rs:3094-3144`); `Get` is point-by-id only, and the only non-point read form is `MembershipExists`, an authoritative-only *boolean* role predicate (`src/manifest.rs:3219-3235`), not a row-binding range read. LLP 0051 D2 explicitly names filtered-read guards as out-of-profile ("Get is point-by-id, so these are JS-tier today"; a bounded `Exists`/`Count` form is a *named growth candidate*, not admitted). Yet §Amendments item 4 declares only a non-amending "relationship" to LLP 0051, and §8.2 never tests a range read. A new read step has real obligations LLP 0051 pins for every vocabulary growth: captured-dependency class, matcher/SQL/corpus cases, ceiling contribution, overlay behavior.
Resolution criteria: either (a) delete the range-read allowance from v1 (point reads via `Get` plus the scope point-read suffice for the §7 flows), or (b) add a dated, same-landing LLP 0051 amendment defining the new step's capture, ceiling, bound, corpus, and optimistic-overlay semantics, and add matching §8.2 witnesses.

**C2 — MATERIAL. §2.4 diverges from the implemented and pinned settlement contract while claiming to compose it.**
Evidence: the implemented `ClientMutationIdentity` binds `{id, function, auth_fingerprint, authority_instance_id, input_fingerprint}` (`src/storage.rs:576-582`) — no plan hash — and its input fingerprint is args + readSet + ctxLedger (`src/storage.rs:13191-13204`), not the spec's "canonical business-argument digest." Mismatch refusals are already stable, distinct public codes with distinct client guidance: `SNAPBACK_CLIENT_MUTATION_ID_REUSED` for function/payload reuse and `SNAPBACK_AUTH_STALE_RESULT` for authority mismatch with explicit discard-or-re-record guidance (`src/storage.rs:1673-1731`; pinned in LLP 0043:298 and in `schemas/mutation.input.schema.json`'s field descriptions). §2.4 replaces all of this with one new code covering "changed arguments, authority, function, or plan hash." Worse, binding the *plan hash* into the refusal path regresses the exact window this machinery exists to close ("closing the response-loss/reconnect duplicate window (LLP 0043 M2)", `src/storage.rs:572-574`): a client whose mutation committed but whose response was lost, retrying after any redeploy that changed the plan, is refused instead of receiving its retained result bytes — it can no longer learn its mutation committed, and §8.2 codifies the regression ("Changed args, authority, function, or plan hash with the same ID refuse without executing"). Note a duplicate never re-executes anything, so refusing it on plan-hash change protects nothing that returning the retained (old-plan) result would not.
Resolution criteria: inherit the existing identity and codes for the shared conditions (or explicitly amend LLP 0051/LLP 0043 with a dated change and justification — the amendment list currently names neither); specify plan-hash as recorded settlement *evidence* (inspectable, part of replay provenance) rather than a refusal-triggering identity element, or explicitly define the cross-deploy retained-result behavior and its client protocol; align the identity element list with the implemented fingerprint composition or state the intended superset/subset relation.

**C3 — MATERIAL. The required product fixture and its acceptance suite are not in this repository.**
Evidence: §7 makes Signal Desk "the required first product fixture" and §8.3 requires it to pass "its native comparison acceptance suite," but `demos/signal-desk/**` matches nothing here and Diary 0022 does not exist; the program issue cites it only as "working-copy `demos/signal-desk/COMPARISON.md`" (`issues/shelved/20260727-backend-bakeoff-improvement-program.md:12`), and `issues/20260727-comparator-acceptance-kit.md` records that its current suite is "a repository-private six-check suite" with the packaged replacement an open sibling ticket. §8.3's codegen-summary item ("relation count, per-parent bounds, … exact/degraded result counts, and direct remediation links") similarly presumes the open `20260727-codegen-review-surface` deliverable. §Motivation's claims about Signal Desk's current query/mutation shape and §7's index names are unverifiable against this capsule. The review gate asks whether the acceptance sequence is "grounded in mechanisms the repository actually has"; §7/§8.3 are currently grounded in an uncommitted working copy plus two open tickets.
Resolution criteria: state where Signal Desk lands (committed with the migration, with the suite invocation that counts as the witness runnable from this repo), or rebase the product-fixture obligations onto an in-repo fixture (e.g., `demos/competitive-checkpoint`, the admitted LLP 0063 Step 5 fixture) until the bakeoff arm is committed; name the comparator-kit and codegen-summary ticket dependencies explicitly or scope those §8.3 items to what exists.

**C4 — MATERIAL. The `public-read` parent mode is admitted but has zero acceptance coverage.**
Evidence: §1.1 admits LLP 0080's query-only `public-read` as parent visibility, and under `through-parent.v1` this makes *every child of a public parent* publicly readable — the highest-leverage misdeclaration surface in the profile. §8.1's items are exclusively owner-shaped (cross-owner noninterference, invisible-parent parity, authority rotation). LLP 0080's own acceptance pinned authenticated **and** anonymous public-read witnesses (no write authority, authority-partition fencing including the anonymous partition, no laundering); nothing equivalent appears here, including how the cursor's authority-partition binding behaves for anonymous callers.
Resolution criteria: either drop `public-read` parents from v1, or add §8.1 items covering anonymous and authenticated public-read fixtures, absent-parent behavior (invisibility being impossible), no-write-authority proof, partition fencing across transitions, and anonymous-partition cursor binding/refusal.

**C5 — DETAIL. §1.3's normative pipeline understates the inherited gate order.**
Evidence: the pipeline opens "target/credential/grant gates → validate parent-id argument," omitting the authentication gate and profile-class admission that LLP 0065 §2 pins between grant-scope refusals and owner admission (`SNAPBACK_AUTH_REQUIRED` before profile admission; `SNAPBACK_STANDARD_PATTERN_PRINCIPAL_UNSUPPORTED` at admission), and leaving argument-validation placement relative to authentication unpinned for owner-visible parents.
Resolution criteria: restate the first pipeline stage as the inherited LLP 0058/0065 gate order by reference and pin argument validation's position in it.

**C6 — DETAIL. `SNAPBACK_BOUNDED_CHILDREN_VISIBILITY_WIDENING` has no defined trigger.**
Evidence: §1.1 provides no declarable output visibility ("Output visibility is exactly the parent visibility; v1 provides no declassification or widening declaration"), and a child needing independent visibility "fails generation" — but §5 lists a widening diagnostic with no plan state that can produce it.
Resolution criteria: define the triggering configurations (and which one gets `VISIBILITY_REQUIRED` vs `VISIBILITY_WIDENING` vs `PLAN_INVALID`) or remove the code.

**C7 — DETAIL. Order-field admission, direction matching, and projection-leaf types are imprecise.**
Evidence: §1.2 requires order fields to be "a portable scalar admitted by LLP 0007" using "the same binary/equality/collation rules as LLP 0080" — but LLP 0080's type rules are *join-key equality* rules (string/id/integer/boolean; float excluded), and ordering is a different question: whether float order fields are admitted (with what total order for the cursor boundary), whether a declared `desc` order must match index direction or reverse scans are admitted per target (§7 assumes a descending `by_incident_created` read), and whether projections exclude JSON leaves (LLP 0080 excludes them; §1.3 only implies inheritance) are all unstated.
Resolution criteria: enumerate the admitted order-field types with their total-order/encoding rules, pin direction-versus-index semantics, and state the projection leaf type set explicitly.

**C8 — DETAIL. The activity foreign key's relation to the `scopeId` provenance field is unstated.**
Evidence: §2.2's `foreignKey` and §2.3's `scopeId` slot are both "set from the … scope ID," and §3's example maps both to `"incidentId"`; whether they must name one field (refusing otherwise) or may be two fields carrying the same value is undefined, while §2.3 separately refuses "overlapping" mappings.
Resolution criteria: pin coincidence-or-distinct semantics and the corresponding generation-failure case.

**C9 — DETAIL. §2.2's "therefore no broader than the source transaction's authorization anchor" overclaims.**
Evidence: visibility is per-operation (LLP 0065's floor, which this spec elsewhere honors — "the activity table name itself has no security meaning"). A later bounded-children read of the activity table could declare a `public-read` parent and legally widen exposure; the write-side declaration constrains nothing about read declarations.
Resolution criteria: reword to bind the claim to the reading operation's declared parent visibility, or require owner-mode parity for activity-table reads in v1.

**C10 — DETAIL. Missing references for the contracts §2.4 rides.**
Evidence: the Related list omits LLP 0043 (the queued-mutation/settlement authority whose M2 window §2.4 inherits) and LLP 0094 (the wire envelope); the envelope also makes `authorityDescriptor` mandatory whenever `clientMutationId` is present (`schemas/mutation.input.schema.json`), a requirement §2.4's "direct protocol callers must supply it" sentence should name alongside the ID.
Resolution criteria: add the references and the descriptor requirement.

## 4. Suggestions

- Explain why the cursor binds "the declared `take`" when `take` is plan-fixed and the plan hash is already bound — or drop the element; if a caller-supplied `take` is anticipated later, say so (it changes lookahead and continuation identity).
- Add one principal-class witness set per profile (anonymous, bare `servicePrincipal`, delegated agent) to §8.1/§8.2, or state explicitly that LLP 0065's witnesses are inherited without re-witness on the new surfaces.
- Pin degenerate table-coincidence rules for §2: `source == activity` and `scope == activity` should fail generation (the plan may not write the activity table; a scope point-read on the activity table is incoherent), while `scope == source` is presumably legal and useful under `create-owner.v1` — worth one sentence each.
- Clarify "one required child foreign-key field": whether "required" means schema-required (excluding optional FKs and their null index entries) or merely plan-required; null-key entries are unreachable by exact equality either way, but the index-population consequence deserves a sentence.
- State in §5 which side owns ceiling overflow: `SNAPBACK_ACTIVITY_EFFECT_CEILING_EXCEEDED` reads as authoring-time (declared maxima over 1,024) while runtime overflow uses the inherited refusal classes — the split is currently inferable but not stated.
- §2.1 could normatively name the escape hatch OQ4 gestures at: a mutation whose primary logic exceeds the closed vocabulary stays in the explicit handler tier and simply doesn't get this pattern — mirroring LLP 0051's "outgrew the IR" diagnostic discipline would help authors route themselves.

## 5. Open questions

1. Should an exact duplicate settle-lookup return the retained result bytes across a plan-hash change (recording the settling plan identity as evidence), given a duplicate never re-executes? If not, what is the client protocol for learning that a response-lost mutation committed after a deploy? (Bears directly on C2.)
2. Where does Signal Desk land as a committed fixture, and does the §8.3 witness run from this repository's proof or the working copy's harness? (Bears on C3.)
3. Is the intent that `bounded-children.v1` reads of an activity table be restricted to the same visibility mode as the writing pattern's scope (owner-parity), or is a deliberate later `public-read` declaration on the read side an accepted, reviewable widening? (Bears on C9.)
4. For §7's descending activity feed, is direction-flexible scanning of a single declared index an evaluator obligation on every target, or must the index declare the direction? (Bears on C7.)

## 6. Readiness verdict

The spec's architecture is right and Section 1 is nearly acceptance-grade, but four material items block acceptance as written: an unadmitted IR read form presented as existing vocabulary (C1), a settlement-contract divergence that regresses the implemented duplicate-window guarantee and overlaps pinned stable codes without an amendment (C2), a required acceptance fixture and suite that live outside this repository (C3), and an admitted visibility mode with no acceptance coverage (C4). Each has a concrete, bounded resolution; a revision addressing them (plus the detail items where cheap) should converge quickly.

VERDICT: NOT READY

## Round 2 — 2026-07-27

**Reviewer family:** Claude Fable  
**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5` on the approved M4 Mac mini fleet lane  
**Effort:** max  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh remote CLI runner, read-only tools, mutually blind
structurally isolated capsule; delta-round instructions  
**Target SHA-256:** `cd2afe4fc61320a1f8df6e335c4a8866d20fb725ccf76fb26c9d76d95a2baa4d`  
**Capsule SHA-256:** `edd205f69e081c9094209337a99f9500f63454ae4c45583d19330f0a17cc1481`  
**Instruction SHA-256:** `172db757f8a00b334f9dd6a12ef9c139acd6688e62c7aea5e5a0e35cc1629d19`  
**Status:** completed
**Session ID:** `a31f4775-ea16-47e8-84cc-daa370413564`
**Duration:** 1,067,449 ms
**Cost:** $23.1550835

All verification is complete — four agents plus my own reading of LLP 0080, 0065, 0043, 0051, 0007, 0100 and the wire schemas. The implementation agent confirmed the settlement identity, closed-plan vocabulary, and wire shapes match the spec's claims exactly, while confirming the incarnation host fields do not exist. I have everything needed to write the Round 2 review.

---

# LLP 0104 super-refine — Round 2 review

## 1. Overall assessment

This revision is a large, genuine improvement. The claims it makes about resolving round 1 mostly verify against the corpus and the implementation: the settlement section now inherits LLP 0043 *exactly* (I checked every member and code against both the RFC and `src/storage.rs` — they match), the primary-plan subset names LLP 0051's real step vocabulary with a finite quantitative ceiling, the persisted/ascending narrowing is grounded in how the buffered overlay actually works, and the existence-secrecy pipeline matches LLP 0065's pinned gate order with the cursor-after-visibility refinement closing the malformed-cursor oracle. The amendment discipline and the §7/§8 conversion of external fixtures into explicit same-landing import obligations are the right shape.

What keeps it out of READY is concentrated and fixable: the new `ParentIncarnationV1` mechanism is derived from host fields that do not exist in LLP 0007 or the storage layer and has no stamping path for ordinary writers; the delegated-provenance vocabulary contradicts LLP 0055/0058's closed actor model in three places; and the spec normatively depends on LLP 0101/0102, which exist nowhere — not in `llp/`, not in tombstones, not promised by any ticket (the result-contracts ticket has no design gate at all), and none of the cited identifiers exist in code.

## 2. Strengths

- **Settlement inheritance is exact, verified against code.** `ClientMutationIdentity` is really `{id, function, auth_fingerprint, authority_instance_id, input_fingerprint}` (`src/storage.rs:576-582`), and the input fingerprint really covers `{args, readSet, ctxLedger}` (`storage.rs:13191-13204`) — precisely §2.4's claim. Function identity is the bare function name (`local.rs:5505-5510`), so replay across a plan-hash deployment returning retained bytes without execution is implementation-consistent, not aspirational. `SNAPBACK_CLIENT_MUTATION_ID_REUSED` (function and payload mismatch, `storage.rs:1675,1724`) and `SNAPBACK_AUTH_STALE_RESULT` with its literal "discard it or explicitly re-record it" guidance (`storage.rs:1711`) exist as cited, as do refuse-don't-evict caps and the acknowledgement/purge lifecycle (LLP 0043; `storage.rs:162-178, 13394`).
- **The point-operation subset is real vocabulary, and the ceiling is finite.** `MutationStep::{Insert,Patch,Delete,Get,Guard,Let,DeleteWhere,InsertEach}` and `ValueExpr::{RuntimeId,RuntimeNow,…}` exist exactly as named (`src/manifest.rs:3094-3210`), so both the admitted subset and the excluded constructs are well-defined. "Exactly one `runtime.now`" is consistent with the per-invocation frozen clock (LLP 0051; `CtxAnswerLedger.now` is a single value, `manifest.rs:3492-3517`). Max three application writes against the unchanged 1,024 bound is trivially checkable.
- **The persisted/ascending narrowing is honest and grounded.** The buffered-lane exclusion matches the real overfetch mechanics (`runtime.rs:1119-1133, 1802-1857`), and relational plans are *already* excluded from that lane by an existing test (`storage.rs:14452-14467`), so `bounded-children.v1` follows precedent rather than inventing a carve-out. Physical indexes are implicitly ascending with the `_id` suffix auto-appended only to non-unique indexes (`storage.rs:8363-8399`) — exactly the shape §1.2 assumes.
- **Existence secrecy is coherent end to end.** The gate pipeline matches LLP 0065's pinned order verbatim; deferring cursor decoding until after parent visibility makes absent/invisible indistinguishable even under malformed cursors, which round 1's structure could not claim; the sealed one-row union extends LLP 0080 §3's observation boundary to live initial state; and public-read correctly has no invisible branch and confers no write authority (LLP 0080 §3).
- **Wire realism.** The one-row tuple fits the existing `QueryOutput {version, rows}` with `items: true` unchanged (`schemas/query.output.schema.json`), and excluding `take` from the cursor because the plan hash already binds it is a clean dedup. The non-unique order + `_id` totalization design is the one LLP 0065's own open question 1 anticipated.
- **Fixture honesty.** §7 no longer presumes external files: it names the working-copy `demos/signal-desk` and Diary 0022 as artifacts the implementation landing must import, and the two prerequisite tickets (`issues/20260727-comparator-acceptance-kit.md`, `issues/20260727-codegen-review-surface.md`) are in fact committed. §8's acceptance matrix is unusually complete (paired databases, malformed-cursor secrecy, fault-injection points, replay-across-deploy, ceiling boundaries).

## 3. Concerns

**C1 — MATERIAL, high. `ParentIncarnationV1` is derived from host fields that do not exist, and no amendment creates them.**
Evidence: §1.1 defines the token over "the parent's authoritative host `(createdAt, creationVersion)` fields at creation." LLP 0007's system fields are `_id`, `_version`, `_createdAt`, `_updatedAt` (0007:60-68), where `_version` is explicitly the *last-change* version, mutated by every patch — there is no immutable creation-version fact anywhere: zero occurrences of `creationVersion`/`creation_version`/`_creationTime` in the corpus or in `src/`, `packages/`, `schemas/` (storage's managed-field list is `_id|_version|_createdAt|_updatedAt`, `storage.rs:13037`). The amendment list (§Amendments item 3) states LLP 0007's "commit-version model … unchanged" and names no new system field. Both profiles consume the token (child index bytes, cursor binding, §2.1 scope guards, §2.2 `scopeIncarnationField`), so the central new mechanism is underivable as written. Secondary defect: the unprefixed spelling `createdAt` is the *application*-column convention (LLP 0004:154-156 explicitly distinguishes it from host `_createdAt`), and 0104 itself uses `createdAt` as an example author field (§2.3, "None is inferred from names such as … `createdAt`") and as the `occurredAt` mapping target in §3 — the same spelling in host and application senses.
Resolution: either (a) add a same-landing LLP 0007 amendment introducing an immutable creation-version fact (with allocation timing defined so the token is derivable *inside the creating transaction*, which `create-owner.v1` requires), or (b) redefine the token over existing authoritative facts (e.g. `(_createdAt, _id)`), with an explicit argument that this discriminates delete/recreate under every admitted ID path; in all cases use the `_`-prefixed host spellings and de-collide them from application-field examples.

**C2 — MATERIAL, high. No stamping mechanism exists for ordinary writers of child rows.**
Evidence: §1.1 requires every child row's incarnation field be "set only from the selected parent's host … token," "never accepted from a client argument," yet the only defined writer that stamps it is `write-with-activity.v1` (§2.1: "an insert sets both from the authorized scope"). A plain LLP 0065 CRUD insert takes field values from client arguments (forbidden here), and no `ValueExpr`, schema field class, or handler surface exists for deriving the token from a parent read. §7's own fixture exposes the gap: incident → comments is read through `defineBoundedChildrenQuery`, but only `addTask` is required to use `defineWriteWithActivity` — the comment-insert path has no defined way to populate `incidentIncarnation`. Adoption of the profile on an existing child table (schema-required field) also implies a backfill migration the spec never mentions. Mis-stamped rows fail closed (unreachable through the helper), so this is an implementability/adoption defect rather than a leak — but it makes the query profile unusable except alongside the write profile.
Resolution: define the mechanism — e.g. a framework-maintained schema field class (incarnation-of-⟨fk⟩, auto-stamped on any admitted write that sets the foreign key), or an admitted plan/handler construct for deriving the token — and state the backfill requirement for adopting tables. Alternatively, restrict profile-served child tables to profile-governed writes explicitly, if that is the intent.

**C3 — MATERIAL, high. Delegated-provenance vocabulary contradicts LLP 0055/0058.**
Evidence, three instances. (a) §2.3 pins `actorKind` to "the closed `human | service | agent` actor class," but LLP 0055's closed, immutable principal-kind set is `"human" | "agent"` (0055:264-265), confirmed by LLP 0058's frozen projection (`kind?: "human" | "agent"`, `actor: { userId, kind: "agent", grantId }`, 0058:1089-1101) and by the implemented `ValueExpr::AuthActorKind` projecting that two-value domain. "Service" is an *authority mode* (`ServicePrincipal`), not an actor kind — and since both visibility scopes require a canonical user subject, a bare service principal is refused at profile admission (LLP 0065), so `service` is unproducible through this profile: the enum admits a value that can never occur and omits none that can. (b) §2.3's `grant` slot is "present exactly when the authority descriptor carries one" — but the authority descriptor is `{descriptorVersion, authorityInstanceId, sessionGeneration}` (LLP 0039:1304-1311) and carries no grant; the grant identity is `grantId` in the resolved actor projection (0055:390, 0058:1089-1101). The presence condition points at the wrong artifact. (c) "Effective subject"/"actual actor" are new coinages; the canonical terms are *effective principal* (`effectiveUserId`, projected as `ctx.auth.userId`; LLP 0065's "canonical user subject") and *actor principal* (`actorUserId`) — 0055:181-185.
Resolution: pin `actorKind` to LLP 0055's closed kind set (or amend 0055 in the same landing to define a third value and its producer); re-source `grant` presence to the resolved invocation authority's `actor.grantId`; align the slot definitions to `effectiveUserId`/`actorUserId`/`grantId` vocabulary. The delegation fixtures in §8.2 then test a realizable matrix.

**C4 — MATERIAL, medium. Normative dependency on LLP 0101/0102, which exist nowhere.**
Evidence: the Related line names LLP 0101 and LLP 0114; §1.3 relies on "LLP 0101's `results.records`," §2.4 on "LLP 0101 `ExpectedOperationV1`/result-contract tuple," §2.5 on "LLP 0101 `results.document(...)` or `results.value(...)`," §4 on `result_contract_v1`/`expected_operation_v1`. The corpus runs 0000–0100 then jumps to 0104; `llp/tombstones/` is empty, so 0101–0103 are unaccounted for against the "next available number" rule. No ticket assigns those numbers: `issues/20260727-sound-handler-result-contracts.md` has no design gate and promises no LLP; `issues/20260727-typed-live-query-groups.md` likewise. None of the cited identifiers exist in code (zero hits repo-wide). LLP 0114 is cited in Related and never used in the body. The §2.5 gate ("cannot be advertised until the target implements LLP 0101 result validation") is correct sequencing for *capability* claims, but the spec's own semantic content — its result grammar and settlement-evidence tuple — is defined by a document that may never exist under that number or with those spellings. (`ref-check` will not catch this: it validates only `@ref` annotations, not Related lines.)
Resolution: land LLP 0101 at least as Draft/Review pinning the referenced identifiers before or with 0104's acceptance (and give the result-contracts ticket the design gate the bakeoff program's rule 1 requires), or restate §1.3/§2.4/§2.5 to specify the requirement in 0104's own words with ownership marked pending; drop or substantiate LLP 0114; account for the 0101–0103 numbering skip.

**C5 — DETAIL, medium. The effect ceiling and guard enumeration don't cover `create-owner.v1` and source deletes.**
Evidence: §2.5 records "one scope point read" as fixed, but `create-owner.v1` performs none (the scope is created, §2.1); the ceiling should be mode-parametrized. In `create-owner.v1` the "zero through eight relationship-guarded point reads" are unsatisfiable — no pre-existing row can carry the not-yet-committed scope's ID, so every guarded `Get` necessarily fails — yet the spec neither excludes them nor says so. And §2.1's guard sentence enumerates "a point read or patch" but omits the source *delete*: a `Delete` targeting an ID from arguments could escape the relationship proof unless preceded by a guarded `Get`, which no rule requires ("No read or write may escape that relationship proof" states the intent without the mechanism).
Resolution: make the scope-read count mode-dependent; state that `create-owner.v1` admits zero relationship-guarded reads (or define what they may target); require the source delete's target to be relationship-guarded (guarded `Get` before `Delete`, or extend the guard rule to deletes).

**C6 — DETAIL, medium. Cursor custody is unpinned relative to the profile family, and LLP 0100 is unreconciled.**
Evidence: sibling bounded-page profiles pin custody the spec omits: envelope/keyring reuse (`sbpc1` — LLP 0100:253-260 explicitly rules a new crypto family unnecessary; LLP 0080's lineage uses `sbrc1`), a 1,024-byte wire maximum and 30-day age, and a mint-failure rule (0100:296-299: a full page must carry a continuation; mint failure fails the page with `SNAPBACK_STANDARD_PATTERN_CURSOR_MINT_UNAVAILABLE` — without this, §1.3's continuation-presence invariant can be silently violated as a truncated "terminal" page). LLP 0100 — a Draft one day older that defines `membership-keyset-pages.v1`, the corpus's third bounded keyset-page profile alongside `owned-keyset-pages.v1` and now `bounded-children.v1` — is absent from the Related line entirely. Also two smaller cursor items: "Parent updates that change its current authorization/projection version restart continuation" names a behavior no cursor member implements (§1.4 binds parent ID and *creation* incarnation, not current version); and the rationale for requiring order fields in the projection ("a clear authenticated cursor discloses no omitted value") silently exempts the bound child `_id`, which 0080 §2 permits in cursors unprojected — state the exemption.
Resolution: pin envelope family, size, age, and mint-failure behavior (adopt or explicitly deviate from the 0100/0065 custody contract); add LLP 0100 to Related with one sentence distinguishing the profiles; fix or delete the "restart continuation" sentence; state the `_id` exemption.

**C7 — DETAIL, low. Exact-vocabulary drift against defining documents.**
Instances: (a) §1.4's cursor binds "stream identity" — LLP 0090 deliberately renamed that to `versionStream` (0090:16 changelog, 0090:275-284), and 0104's separate use of "incarnation" for its parent token collides with the authorization-stream "incarnation" in `AuthorizationVersion {incarnation, epoch}`; (b) §2.4 sites the "mandatory `authorityDescriptor` in the LLP 0094 mutation envelope" — LLP 0094 defines no such member (one route-table cell only); the owner is `MutationRequest` (`src/manifest.rs:3413-3458`, LLP 0039:1304-1314/LLP 0051), and its modality is conditional (required whenever `clientMutationId` is present after descriptor-protocol negotiation — always true for this profile, but cite it as such); (c) Amendment 3 names LLP 0004 "generated-query and conditional mutation sections" that don't exist as sections (the content lives under "Deferred Work" and "First-Slice API Decisions"; LLP 0007's carve-out under "Transactions and Atomicity"); (d) §1.3 attributes a "flat portable result-value set: … finite real …" to LLP 0080, which enumerates no such named set and never says "finite real" (it pins `RelationalResultEncodingV1` over LLP 0051's canonical value mapping); (e) Amendment 5 attributes "authority partitions" and "replacement obligations" to LLP 0053, whose actual terms are authorization pair and *delivery* obligation — "authority partition" is 0080/0063 vocabulary. Substantively the inherited behavior is right in every case; the citations are not, and this corpus treats citations as load-bearing.
Resolution: one editing pass pinning each borrowed identifier to its defining document's spelling and locus.

**C8 — DETAIL, low. Two wire-contract statements need same-landing carve-outs.**
Evidence: (a) the live envelope pins "every row's system `_id` member is its durable identity" (`schemas/live.envelope.schema.json:414`); the computed record row has no `_id`. Relational projection rows already soften this in practice, but §1.5 claims first-page `live_replace` without addressing the stated invariant — the live-envelope doc should gain a computed-record-row carve-out in the same landing. (b) `QueryOutput` already has a top-level `cursor` member used for relational continuations (`manifest.rs:3703-3714`); 0104 puts `continuation` inside the row without stating the relationship (the evident reason — `LiveReplace` frames carry no cursor member, and the live first page must carry its continuation — is worth one sentence, plus pinning the top-level `cursor` as absent for this profile). Also, `sbpi1` should be registered in the credential-prefix registry LLP 0055:1643 requires to stay mutually prefix-free (it is one character from `sbpc1`, whose `sbpc_` sibling is a secret class), noting it is the corpus's first un-MAC'd, plainly decodable `sb…1.` artifact stored in application rows — deliberately so.

**C9 — DETAIL, low. Acceptance-gate process facts.**
The bakeoff program's rule 1 requires the super-refine reviews be "recorded under `llp/reviews/`"; none exist for 0104 yet despite two Revised-header reconciliations — record them before Accepted. §8.3's "installed comparator acceptance kit" and "codegen review-surface proof" correctly make the two open tickets' *machinery* (both currently unbuilt) prerequisites for `Implemented`; a clause acknowledging that cross-ticket scheduling coupling would prevent a stalled P2 ticket from silently blocking this spec's status ladder.

## 4. Suggestions

- Cite LLP 0065 open question 1 in §1.2 or the amendments: it anticipated exactly this non-unique-order + `_id`-totalized-cursor design, which strengthens the answer to LLP 0080's open question 1 against 0100's unique-cursor presumption.
- The implemented `ValueExpr::AuthActorKind`/`AuthIsDelegated` projections are natural producers for the provenance slots once C3 is fixed — worth naming in §6's sequence.
- Align the capability id `write_activity_v1` with the profile name (`write_with_activity_v1`), or note the abbreviation; the `_v1` snake_case convention itself matches the registry (`relational_query_v1`, `bounded_response_stream_v1`).
- The Guide page should document the ascending-only consequence for activity feeds (newest-first requires an inverted sort key, as `by_incident_sort_key` hints) so the restriction doesn't surface as a guide-gap ticket later.
- "Structured GAP" in §4: today's `capability_gaps` are plain strings (`manifest.rs:4143`); if a structured record is intended, say it's new machinery.

## 5. Open questions

1. What ID-reuse path is `ParentIncarnationV1` actually defending against (recorded-answer replay returns retained results without re-executing; migrations? client-minted `_id`s per LLP 0007?), and does the answer favor a new immutable host field versus deriving from `(_createdAt, _id)` in C1?
2. If the result-contracts ticket proceeds without an LLP (its current state), where do the identifiers §2.5 consumes get pinned — and should 0104 hold in Review until that authority exists?
3. Are relationship-guarded `Get`s intended to be admissible at all in `create-owner.v1`, given nothing can carry the new scope's ID (C5)?
4. Should the child incarnation field be projectable to clients, or internal-only? §1.2 requires order fields in the projection but is silent on the FK/incarnation prefix fields.

## 6. Readiness verdict

The revision's core claims verify: both profiles are finite, the authorization pipeline and secrecy posture are sound and inherited correctly, and the settlement/wire inheritance is the strongest part of the document — checked exact against LLP 0043 and the implementation. But the spec's central new mechanism (`ParentIncarnationV1`) is specified over host fields that don't exist with no stamping path for ordinary writers, the delegated-provenance enum contradicts the closed actor model it must record, and the result-contract grammar is owned by a document absent from the corpus. Each is fixable within the existing design; none is fixed yet.

VERDICT: NOT READY

## Round 3 — 2026-07-27

**Reviewer family:** Claude Fable  
**Provider / runtime:** Anthropic Claude Code 2.1.220,
`claude-fable-5` on the approved M4 Mac mini fleet lane  
**Effort:** max  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh remote CLI runner, read-only tools, mutually blind
structurally isolated capsule; final delta-round instructions  
**Target SHA-256:** `a6d7fbb38611ab7e555b55848bc88e126e16e4655008497907a902f40d211136`  
**Dependency SHA-256:** `bd1bb9aaaa4f9c9015039d09a716add5ea86dbc442d0954ff49b11931e9fb3ac`  
**Capsule SHA-256:** `59e2c65a8e33f963c2048bfb66e07558b1d14a313e4f770a2ae808b5d32d7cf7`  
**Instruction SHA-256:** `5b20a61c32ad26cf32099bd7b52d3b106342f7944bb8429188e1bfb94c613191`  
**Status before launch:** pending

**Session ID:** `12b57214-0475-4fbf-b5a9-64318969ba82`  
**Duration:** 962,193 ms  
**Cost:** $6.51141750  
**Status:** completed

All verification is complete. The last checks confirmed the existing cursor is HMAC-over-cleartext with a 1,024-byte cap and 30-day age on the resume keyring (so 0104's AEAD/2,048-byte continuation is a real deviation from the "shared custody" it cites), and LLP 0080's portable-type discipline matches §1.2's order-type set. I have everything needed to write the review.

---

# Review — LLP 0104 "Bounded children and activity patterns" (super-refine round 3, fresh/blind)

**Review posture.** Fresh delta review against the document and its dependencies only; I did not open `llp/reviews/` or any journals. LLP 0101 was read in full as dependency context, treating its own "Final author reconciliation after round 3" as controlling per its conflict rule. One process note: the detail-horizon rule's canonical text lives in the `vendor/llp` skill submodule (uninitialized here) and the upstream repo (network fetch denied in this session), so I applied it as standardly stated: a concern is MATERIAL only if it must be decided in this document for the committed design to be sound and closed; concerns settleable during implementation without changing a committed decision are DETAIL, and I do not demand specification beyond the document's decision horizon.

## Overall assessment

This is a strong, disciplined spec that has genuinely converged over the loop. The final author section fixes the two hardest problems correctly: the fictional host `(createdAt, creationVersion)` token is replaced by a transactionally-owned protected registry (LLP 0007 confirms no host creation-version field exists — the round-2 finding was real, and the fix is grounded: `_snapback_*` protected-table precedent exists in `src/storage.rs`, UUIDv7 matches the platform's `runtime.id` convention), and provenance is now derived exclusively from server-prepared `ResolvedAppAuthority`, which exists in `src/auth/invocation.rs:276` with exactly the members the profile needs (`actor_user_id`, `grant_id`, optional `effective_user_id`), consistent with LLP 0055's `human | agent` closed actor set and its delegation/dev-impersonation model.

I verified the repository dependencies extensively and almost all of them are real: LLP 0080 and 0065 are both Implemented as claimed; 0080's Open Question 1 and its non-unique-`many` exclusion say what §Motivation says they say (llp/0080 lines 162–163, 685–688); the `SNAPBACK_ROW_NOT_FOUND`/`ROW_NOT_VISIBLE` public/audit collapse pattern is implemented precedent (llp/0065 line 327); LLP 0043's settlement machinery (identity tuple with auth fingerprint and opaque authority-instance id, refuse-don't-evict caps, piggyback ACK as a separate stage, 65,536-byte retained output, admin purge) all check out; LLP 0007's 1,024 bounds, scan-order-only `_id` suffix, and true unique indexes with the stable `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION` diagnostic are real — which makes the partitioned-uniqueness requirement close a genuine existence oracle, not a hypothetical one; the standard-pattern cursor custody (`sbpc1`, resume keyring, 30-day age, mint-failure refusal, single byte-identical refusal code) exists in `src/rqs.rs:288–349`; and the three prerequisite tickets plus the issue exist under `issues/`, while Diary 0022 and `demos/signal-desk` are correctly described as not-yet-imported (diaries stop at 0021; no bakeoff demo directory).

What keeps this at NOT READY is a small set of closure gaps, all in or around the final author section, none architectural: a stale `expected_operation_v1` dependency that LLP 0101's own final narrowing no longer provides; the stamping mechanism's missing-parent branch left undefined even though it silently converts dangling-foreign-key writes from legal to refused across every writer; and several new public refusal behaviors the final section introduces without naming or defining (the restart diagnostic, protected-field write refusal, the meaning of "no-op"). Each is a sentence-to-paragraph edit.

## Strengths

- **The registry design is sound and honest.** Same-transaction incarnation lifecycle, patch-preserves/delete-deactivates/recreate-renews, activation gated on a full stamping corpus and exact existing-child agreement, and an explicit reviewed backfill for adoption ("no row is silently blessed"). Delete/recreate isolation falls out structurally rather than from overloading `_version` or timestamps.
- **Existence secrecy is carefully engineered and testable.** Parent authorization strictly precedes child work; cursor validation deferred until after visibility so a malformed cursor cannot become an oracle; the sealed one-row absent/visible payload is byte-specified; paired-store acceptance fixtures (§8.1) are exactly the right nonvacuous witnesses; `public-read` correctly has no invisible branch and partition-bound cursors.
- **Work bounds are physical, not cosmetic.** At most `take + 1` examined index entries counting physical range entries, no post-index predicate, `take: 0` examines nothing, exact index shape with refusal rather than convention, and the buffered overlay honestly GAPped because it cannot satisfy the bound — plus examined-entry instrumentation in the implementation sequence.
- **Settlement semantics are faithfully inherited, not reinvented.** Exact LLP 0043 `ClientMutationIdentity` retained (plan hash deliberately excluded from duplicate-refusal identity, with the correct consequence that cross-deployment exact retries return retained bytes without executing), replay via LLP 0101's frozen retained validator, ACK/purge lifecycle unchanged, activity rows correctly classified as product data outside settlement GC.
- **Effect ceilings are total and mode-indexed.** Separate closed formulas for `create-owner.v1` and `existing-owner.v1`, runtime subset checking, single-transaction rollback of source/scope/activity/version/settlement together, and min/max boundary acceptance rows. Maximum three application writes sits comfortably inside LLP 0007's untouched 1,024 ceiling.
- **Live claims are honest.** First-page-only `live_replace`, cursor-bearing subscribe refused pre-storage with a registered code, no `live_delta`/retention claims, and LLP 0053's gates named for any future incremental profile.
- **Authority provenance is derived, never asserted.** No transport-descriptor or argument-supplied authority facts; effective/actual actor never collapsed; delegation fixtures required; bare-service refusal matches LLP 0055's actual model.
- **The first-publication gate is the right posture** after this corpus's experience: no positive capability, even experimental, without the complete committed evidence set — and the gate's witness list covers the final section's own additions (backfill/restore, cursor disclosure, projection exclusions, uniqueness, effect corpus).

## MATERIAL concerns (severity-ranked)

**M1. The central stamping rule leaves its failure branch undefined and silently imposes an insert-time referential existence check on every writer, contradicting Non-goals.**
Evidence: the final section requires every write path — "plans, JS handlers, seed, import, migration, and buffered execution" — to look up the current parent and stamp the schema-required protected incarnation field whenever the foreign key is inserted or changed (llp/0104 lines 922–931). Nothing states what happens when there is *no* current active parent: a dangling-FK child insert, an insert after parent deletion, or an FK retarget to a nonexistent row. Because the field is required, such writes must refuse — but today dangling foreign keys are legal application data (no referential constraints exist; LLP 0080 treats unmatched join keys as simply not matching), so adopting a relation changes the semantics of *existing* JS handlers with no stated diagnostic, no LLP 0004-facing amendment, and no migration note. Meanwhile Non-goals still says "referential constraints … or orphan cleanup" are excluded (line 872), which is no longer accurate for the insert/update direction on stamped relations. The activation-time stamping corpus this section itself mandates cannot be written until this branch is decided.
Resolution: define the missing/inactive-parent stamping outcome with a stable public code; state explicitly that stamped relations enforce write-time parent existence (and reconcile the Non-goals bullet to "no referential *delete* actions"); name the LLP 0004/Guide-visible behavior change for existing writers; add the dangling-FK, insert-after-delete, and buffered pending-parent cases to the stamping corpus.

**M2. §4's `expected_operation_v1` dependency contradicts LLP 0101's final narrowing and, read literally, makes `write_activity_v1` permanently unpublishable.**
Evidence: §4 requires `write_activity_v1` to "report exact dependencies on `result_contract_v1`, `expected_operation_v1`, and the LLP 0043 … settlement profile" (line 649), and §2.4 retains "LLP 0101 `ExpectedOperationV1`/result-contract tuple … as settlement evidence" (line 471). LLP 0101's final round-3 section removes `ExpectedOperationV1` entirely from its v1 landing and forbids advertising `expected_operation_v1` (llp/0101 §Final B). LLP 0104's own final section says "no new ExpectedOperation carrier or cross-deployment settlement evidence is added" (line 942) — which supersedes the *evidence-retention* clause but does not cleanly strike the §4 *capability-dependency* line, since reporting a dependency is not "adding a carrier." An implementer following §4 literally would gate the capability on something no planned landing provides.
Resolution: explicitly strike `expected_operation_v1` from §4 and rewrite §2.4's evidence sentence in terms of what LLP 0101's final slice actually ships — the retained result bytes, `resultContractHash`, and frozen effective validator stored with the settlement.

**M3. The final section introduces new public outcomes without naming, defining, or totalizing them.**
Evidence: (a) cursor restart on parent patch/policy/restore/incarnation change "returns the single restart diagnostic" (line 951) — unnamed; is it `SNAPBACK_BOUNDED_CHILDREN_CURSOR_INVALID` (indistinguishable from a malformed/cross-plan cursor, which matters for client retry UX) or a distinct registered code? §5 registers neither, and §8.1's cursor rows don't witness the parent-touch restart case. (b) Direct attempts to supply or patch the protected field "refuse" (line 929) — no code. (c) "A no-op or missing source rolls back and appends no activity or settlement" (lines 1006–1007) — "no-op" is undefined: an empty patch specification, or a patch whose values all equal current storage (which under the commit-version model would otherwise still bump `_version`)? The acceptance row "every no-op/missing path" is untestable until this is pinned, and the answer is user-visible mutation semantics. (d) The authority→provenance mapping is not total over `ResolvedAppAuthority`: direct human, delegated agent, and dev-impersonation are called "explicit" but the dev-impersonation mapping (its `actorKind`, actual-vs-effective) is never actually given, and `Anonymous`, `AdminBypass`, and `System` (all real variants, `src/auth/invocation.rs:276–317`) are unaddressed for this profile.
Resolution: register stable codes for restart, protected-field write refusal, and (per M1) stamp failure; define "no-op"/"changed row" exactly; give the complete authority-variant mapping table with an explicit admit/refuse for every variant; add the parent-touch restart witness to §8.1.

## DETAIL concerns

**D1. Superseded-token residue and the `sbpi1` prefix reassignment.** Five normative sites still say `(createdAt, creationVersion)` (lines 121, 153, 266, 363, 404), all silently superseded by the registry UUIDv7; worse, §1.1 line 153 assigns `sbpi1.` to the now-dead incarnation string while the final section reassigns `sbpi1` to the AEAD continuation credential (line 948) — one character from the existing `sbpc1` class and semantically confusable with the superseded incarnation token. This corpus has already been bitten by prefix-class confusion once (LLP 0091's `sbrk_`→`sbrq_` rename). Resolution: strike or annotate the residue sites; pick a non-confusable continuation prefix (e.g. `sbbc1`) and register it.

**D2. AEAD from a MAC keyring, and the 2,048-byte cap deviation.** The "shared cursor keyring custody" is concretely the resume keyring holding HMAC-SHA256 keys over cleartext bodies with a 1,024-byte wire cap (`src/rqs.rs:288–344`; LLP 0100 calls 1,024 "the standard cursor's … maximum"). AEAD is a new primitive: it needs its own key class or purpose-bound derivation (never raw HMAC-key reuse), and the doubled cap deserves one justifying sentence. Resolution: name the key class/derivation and the cap rationale.

**D3. `bounded_children_v1` should also report a `result_contract_v1` dependency.** Its sealed row is validated via LLP 0101 `results.records` (line 940), yet §4 attaches dependency reporting only to `write_activity_v1`.

**D4. Amendment inventory drift.** The final section adds a same-lifecycle LLP 0007/0037 amendment (registry + protected field, line 933) and a "live-envelope authority" computed-record carve-out (line 955) — but §Amendments/§6.1 still lists only 0080/0065/0004/0007, and the carve-out's target document is never named (LLP 0094/0095 or the RQS family, whose mint rules require row ids). Resolution: update the amendment list and name the carve-out's owning document.

**D5. Registry invariants unstated.** At-most-one-active-per-`(table_name, row_id)` is implied but neither stated nor enforceable from the given schema (no partial unique index on `active`); inactive rows accumulate forever with no retention posture; the "reusing the application id" path (only import/explicit-id writers can) is unidentified.

**D6. Auxiliary-read counting ambiguity.** "Zero through eight guarded auxiliary point reads, counting the implicit reads of every patch/delete" (lines 998–999) — does the *source* patch/delete's implicit read consume one of the eight, on top of §2.1's "at most eight `Get` point reads"? One sentence pins the generation-time check.

**D7. The `mutation` digest no longer serves its stated purpose.** §2.3 calls it "a digest of the durable settlement identity," but the final formula (lines 979–988) digests only fields already stored as individual provenance columns in the same row — it adds no correlation to the settlement, and two same-shape invocations (same actor patching the same source) share a digest. Either include a non-credential per-settlement component (e.g. a domain-separated digest of the LLP 0043 input fingerprint) or redescribe the field as a row-integrity checksum.

**D8. "LLP 0005 review loop" resolves to the wrong document in this corpus.** This repo's LLP 0005 is the Contract/Exact React integration explainer; §6.1 and §8 clearly mean the upstream LLP-workflow numbering (the issue says "run `llp-super-refine`"). Cite the upstream doc or skill explicitly.

**D9. Cross-profile cursor-restart composition is unstated.** Binding the continuation to parent `_version` means every `write-with-activity` invocation that takes the optional scope touch restarts *all* outstanding child continuations for that parent — in Signal Desk, every `addTask` with incident touch breaks every open task-list continuation for that incident. The conservative choice has in-corpus precedent (LLP 0100 accepts exactly this cost, lines 291–292) and is safe, but §1.4's no-skip/no-duplicate guarantee is now conditioned on "and no writer touched the parent," and the spec never surfaces the composition consequence or a client retry contract. One paragraph plus the §8.1 witness from M3(a).

## Suggestions (non-blocking)

- Consider, as a later revision, binding the cursor to the authorization-relevant parent subset (incarnation, plan hash, owner-field value, policy epoch) instead of full `_version`, to decouple pagination from unrelated parent touches; record the current choice's rationale in §1.4.
- State the interaction with LLP 0101's newly *enforced* 4 MiB egress ceiling: a `take: 1024` page of wide projections can exceed it, and the refusal class for an over-ceiling valid page should be named for the query lane.
- Add a sentence that the activity table doubles as a bounded-children child (as §7 implies for incident→activity), and that both derive incarnations from the same registry — it is true and worth making explicit.
- Enforce the registry's single-active invariant with a partial unique index in the reference SQLite schema.

## Open questions

The spec's four open questions are well-chosen; I would add: (1) What is the retention/pruning posture for inactive registry rows over long delete/recreate churn? (2) Should the wire distinguish "honest restart" from "invalid cursor" (client UX) or is indistinguishability deliberately preferred for secrecy uniformity? (3) Under what authority, if any, do `AdminBypass`/`System` write through this profile — refusal, or audit-visible bypass provenance? (M3 requires deciding; this question is about which answer is right.)

## Readiness

The committed design — protected registry incarnations with central stamping, through-parent visibility with sealed secrecy, AEAD version-bound cursors, prepared-authority provenance, exact inherited settlement, mode-indexed total ceilings, and the all-evidence publication gate — is sound, implementable, and verified against real machinery in this repository. But the final author section, which is the normative closure the round exists to certify, still leaves one dependency contradiction with LLP 0101's final slice (M2), one undefined failure branch at the heart of its signature mechanism together with an unacknowledged writer-visible semantics change (M1), and a set of unnamed/undefined public outcomes (M3). These are days-not-weeks edits with no architectural risk, but a spec whose stated bar is totalized refusal semantics and registered stable codes has not yet met its own bar.

VERDICT: NOT READY
