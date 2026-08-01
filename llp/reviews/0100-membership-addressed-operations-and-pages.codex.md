# LLP 0100 membership-addressed operations and pages review — Codex family

## Round 1 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (`medium` per CLI banner)
**Date:** 2026-08-01
**Redaction:** not redacted
**Method:** full round-1 — independent review per LLP 0005, author-directed super-refine (Charlie 2026-08-01); reviewer instructed to weigh the five LLP 0137 sweep tickets as mandatory coverage cases and verify load-bearing code citations against the current tree; read-only sandbox, blind to this RFC's fable artifact
**Target SHA-256:** `4ba87d1dad15c956b0311adec57befe517e83c03c445ba4a458cdda70228b43b`
**Instruction SHA-256:** `6c307d3234f5213244160999cd9f66f172ac26abc5ce38721ef3998b7e92d3f9`
**Status:** completed (first attempt, no retry needed)

### Verbatim review

## Overall assessment

I verified and read exactly the requested 542-line file:

`4ba87d1dad15c956b0311adec57befe517e83c03c445ba4a458cdda70228b43b`

I did not read any `llp/reviews/0100-*.fable.md` file.

LLP 0100 is a strong, implementation-oriented design for its original two problems: principal-addressed removal and membership-scoped pagination. Its authorization, non-disclosure, linearization, cursor custody, and acceptance reasoning are unusually concrete.

However, the LLP 0137 sweep materially expanded the known design territory. Three of the five mandatory cases remain undesigned. Under the supplied READY bar, that is substantive incompleteness rather than ordinary implementation detail.

## Strengths

- The private-roster boundary is explicit. The draft distinguishes byte-level non-disclosure from the deliberately accepted authorization-epoch observable instead of claiming impossible indistinguishability.
- `removePrincipal` is constrained by a total transition, host-resolved target row, captured absence, invariant denial, `lastHolder`, delegated consent, and full provenance.
- The concurrency account covers present, absent, insert, removal, and role-change races, including companion writes in the no-op branch.
- Pagination authority is executable, not metadata: every page evaluates a declaration-bound membership predicate.
- Cursor negatives, mint failure, authorization changes, rejoin, cross-resource reuse, and nonexistent-versus-unjoined resources are covered adversarially.
- The proposal correctly builds on real implementation seams:
  - Declaration-bound `arg`/`rowField` membership references exist in [define.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:371).
  - Membership writes already have a closed host-owned carrier in [storage.rs](/Users/ccheever/projects/snapback/src/storage.rs:11820).
  - `MembershipExists` is authoritative-only and captured in [manifest.rs](/Users/ccheever/projects/snapback/src/manifest.rs:5111).
  - The existing opaque `sbpc1` envelope and uniform verifier exist in [rqs.rs](/Users/ccheever/projects/snapback/src/rqs.rs:287).

## Concerns

1. **MATERIAL — "List the caller's resources" remains undesigned.**

   LLP 0100's page helper starts from a caller-known resource argument. It cannot discover the resources for which the caller holds a membership. The current authoring surface deliberately accepts only `arg`, `rowField`, or the app singleton; the guide explicitly prescribes a parallel app-data feed for "my events" in [scoped-roles.md](/Users/ccheever/projects/snapback/guide/auth/scoped-roles.md:154).

   Resolution: specify a declaration-owned self-membership projection or equivalent semi-join. Pin:

   - returned facts—at least resource id and role;
   - treatment of pending and expired roles;
   - ordering, bounds, and pagination;
   - live grant, role-change, and revocation behavior;
   - cross-principal isolation and private-roster preservation;
   - whether it can feed ordinary resource-table composition without an authorization mirror;
   - manifest, capability, and acceptance changes.

2. **MATERIAL — Membership-visible full-text search remains undesigned.**

   The current search visibility union is closed to `PublicRead` and `Owner` in [search/types.rs](/Users/ccheever/projects/snapback/src/search/types.rs:39), with the same restriction enforced by codegen in [define.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:560). Nothing in the membership page profile changes search candidate visibility.

   Resolution: define the membership search visibility profile end to end: declaration/resource binding, role subset, posting and source-row recheck in one snapshot, empty outsider result, revocation behavior, cursor authorization binding, effect ceiling, capability facts, and member/outsider/revoked acceptance cases.

3. **MATERIAL — Trusted membership seed/reset remains undesigned.**

   Sessions-mode versioned seeds still reject even an empty named membership table in [storage.rs](/Users/ccheever/projects/snapback/src/storage.rs:1062). Although `MembershipWriter::Seed` already exists, LLP 0100 neither admits it through the versioned-seed lane nor specifies reset retirement and fixture restoration.

   Resolution: define a declaration-checked trusted seed/import lane, including:

   - principal identity validation;
   - role vocabulary and nominal resource validation;
   - provenance;
   - `lastHolder` and final-state validation order;
   - named empty membership tables as reset targets;
   - atomic deletion of runtime seats and restoration of fixture seats;
   - authorization incarnation/epoch consequences;
   - replay/idempotence and reset receipts;
   - a witness that a runtime-only principal loses authority after reset.

4. **MATERIAL — The cursor requirements are broader than the current binding seam, but the implementation plan does not enumerate the required bridge.**

   LLP 0100 requires pair identity, normalized non-cursor arguments, the global authorization pair, data-version stream, active artifacts, target profile, and deployment generation. The current binding in [local.rs](/Users/ccheever/projects/snapback/src/local.rs:21144) contains app, helper/profile, plan fragments, auth fingerprint, and compatibility permission epochs. Those epochs are explicitly not the durable global `AuthorizationVersion` in [local.rs](/Users/ccheever/projects/snapback/src/local.rs:10812). The current code also recognizes only `owned-keyset-pages.v1`.

   The RFC's implementation order mentions normalized arguments and the membership profile, but not all the other missing binding inputs. Following it literally would not establish the claimed stale-membership and artifact-identity guarantees.

   Resolution: identify the cursor-authority/runtime seam that will provide every listed input, define pair identity precisely, and map each binding component to current storage/deployment state. Acceptance should mutate each component independently and verify refusal before candidate evaluation.

5. **should-fix — Resolve the callable-only implementation shape explicitly.**

   LLP 0100 says `live: false`. The existing owned helper is emitted using `defineLiveQuery` in [standard-patterns.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/standard-patterns.mjs:401), and LLP 0065 describes it as callable and `live_replace` capable.

   Resolution: state that the new helper emits ordinary `Query` definitions and cannot subscribe, or deliberately reuse `LiveQuery` with `defaultLive: false` and revise the capability claim. The current text points toward the former.

6. **detail — The expanded scope needs an integrated acceptance story.**

   Once the missing surfaces are added, the product receipt should prove that one membership declaration drives listing, relational reads, search, pagination, asset policy where applicable, and revocation—without authorization mirrors. This is the composition witness required by LLP 0137 §P1, not five isolated unit suites.

## Five-case coverage check

| Required case | Coverage | Finding |
|---|---|---|
| A2 membership semi-join cannot list own channels | **Not covered** | Known-resource predicates and pages cannot enumerate the caller's resource memberships. |
| A3 search visibility cannot express membership | **Not covered** | No membership variant for search visibility or posting recheck is proposed. |
| A3 membership not seedable/reset cannot retire authority | **Not covered** | No versioned-seed or reset design is proposed. |
| Team Chat owner removal | **Covered by design** | `principalAddressedWrites.remove` and `removePrincipal` directly dissolve it. |
| Team Chat room pagination | **Covered by design, with concern 4 unresolved** | The helper and acceptance model fit the case, but its required cursor binding is not fully mapped to current code. |

## Verdict

**NOT READY.**

This is not a flawlessness judgment. Three mandatory, evidenced product cases have no design, and one load-bearing cursor guarantee lacks a complete current-tree implementation map.

## Next step

Revise LLP 0100 and keep it `Draft`:

1. Add designs for self-membership resource listing, membership-visible search, and trusted membership seed/reset.
2. Reconcile the cursor binding and callable-only seams with the cited current code.
3. Add one composed LLP 0137 acceptance witness covering all five cases.
4. Run a fresh Codex-family re-review after the revision.

The filesystem was read-only, so I could not persist the required LLP 0005 artifact. This review should be saved as `llp/reviews/0100-membership-addressed-operations-and-pages.codex.md` with the appropriate provenance header.
