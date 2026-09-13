**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.150.1, `gpt-5.6-sol` at xhigh
reasoning effort (confirmed in run-log header: `reasoning effort: xhigh`),
read-only sandbox, independent ephemeral session
`01a052cd-73b5-7b72-8c17-7411e7227ab3`
**Date:** 2026-08-30
**Redacted:** no
**Method:** cli-runner (`~/.volta/bin/codex exec -s read-only`)

# Review artifact — LLP 0331, Codex family

Advisory review requested by the author on the uncommitted Draft. This
session did not author the target. Blindness with respect to
`llp/reviews/` was instruction-based (SELF-ATTESTED); no 0331 review
artifact existed at launch.

- Target: `llp/0331-scoped-roles-diary-feedback.research.md`
- Target sha256 at review: `b9c07d9ec40fce0854ead6f0fb4320aadf6419b5b0146916347e1aa791eb996e`
- Checkout HEAD: `112ff712123ca660e1be9d958a9e0069e36e1a4a` (file uncommitted)
- Instruction brief sha256: `f7e6feaf249fb7be86dffc6a944071639c349eae05bd6d14b39c5835231c70b0`
- Verbatim body sha256: `73727810a67076d7665edad24f3e49e0b9032c4995924ca5bc5b62b330d20252`
- Wall clock: ~13 minutes
- Result: **NOT READY** (4 MATERIAL, 4 MINOR)

Body below is verbatim from the Codex `-o` final message.

---

## Round 1 — 2026-08-30 — uncommitted Draft at sha256 `b9c07d9e…`

## Overall assessment

This is a valuable research record with a credible central observation: Snapback’s declared authority path earns strong praise when exercised, but timed builders often choose ordinary tables, handler checks, and public-read visibility instead. The document is unusually candid about security compromises and generally treats diary evidence responsibly.

It is not ready in its current form, however. Its reconciliation against current source is materially stale in several places, its prevalence and causal-magnitude language exceeds what its method can support, and one proposed response to `requireRole` exactness could silently broaden authorization. Those defects would make this an unreliable input to a later change program.

The ownership split is otherwise sensible: LLP 0056 owns the membership machine, LLP 0100 principal-addressed operations and pages, LLP 0240 authority profiles, and LLP 0310 the broader Clique DX inventory. The main ownership failure is treating LLP 0240’s already-shipped projection and operation work as unfinished.

## Strengths

- The declared-path versus handler-path split is load-bearing and directionally correct. A green handler-path implementation is not evidence about LLP 0056’s authoring experience. The document is right not to average those populations.

- Finding 3 is well supported. The public-read compromises are accurately characterized in Diary 0081, Diary 0092, Diary 0104, Diary 0105, and Diary 0108. [Diary 0081](/Users/ccheever/projects/snapback/diaries/0081-clique-0121-snapback-simplified.diary.md) calls its widening the lane’s largest authority compromise; [Diary 0104](/Users/ccheever/projects/snapback/diaries/0104-sol-high-clique-explicit-local-main.diary.md) expressly disclaims a production-private-messaging result; and [Diary 0105](/Users/ccheever/projects/snapback/diaries/0105-sol-high-clique-familiar-local-main.diary.md) calls its projection a production-hardening gap. [The reachability ticket](/Users/ccheever/projects/snapback/issues/shelved/20260826-membership-scoped-query-reachability.md) supports the discoverability diagnosis without claiming that the capability is absent.

- The first-party artifact claims are substantially accurate. The [Expo chat template](/Users/ccheever/projects/snapback/packages/snapback-cli/templates/expo-chat/snapback/schema.mjs) uses public-read conversations, memberships, and messages. [Coterie’s schema](/Users/ccheever/projects/snapback/demos/coterie/snapback/schema.mjs) declares a current-seat membership relation but leaves messages and receipts public-read and does not exercise an authority-profile lattice.

- The load-bearing quotations I checked are accurate, including Diary 0015’s `lastHolder` observation, Diary 0100’s “paid for itself” assessment, and Diary 0101’s praise for host-owned roster transitions. I found no fabricated quotation in the inspected sample. The document also correctly retains Diary 0108’s later correction: the principal/row-id confusion was discovered, but membership visibility was not retested.

- Several still-current cliffs are correctly identified. Creator-seat incidental values remain unavailable through `bootstrap`; an authority profile still requires literal `owner`; direct imperative `requireRole` remains exact while a profile-declared role predicate is hierarchy-lowered. The two open correctness tickets—[role laundering](/Users/ccheever/projects/snapback/issues/shelved/20260819-generated-role-checks-launder-roles-through-array-slice.md) and [stale-handle policy bypass](/Users/ccheever/projects/snapback/issues/shelved/20260826-stale-handle-membership-plan-bypasses-successor-transition-policy.md)—remain open and are appropriately treated as security work, not authoring polish.

- The “What not to change” section is strong. Private rosters, non-oracular removal, `lastHolder`, clock-dependent visibility refusal, and transition-matrix authority should not be weakened merely to reduce ceremony.

## Concerns

1. **MATERIAL — Finding 4 and Finding 8 miss the shipped authority-product projection and generated-operation closure.**

   **What is wrong:** The document presents Diary 0058’s app-maintained mirror plus second reconciliation mutation as the current “sanctioned interim,” treats the projection closure largely as a guide-page landing, asks whether generated projection is sufficient, and recommends that profiles imply kick/promote/list when the transition matrix permits. That describes historical state, not the 2026-08-30 source it claims to have checked.

   **Evidence:** [The current projection recipe](/Users/ccheever/projects/snapback/guide/recipes/membership-roster-projection.md) is marked `maturity: shipped`. It documents platform-generated history/incarnation projection and transactionally frozen recipient sets derived from membership writer-seam row images; it explicitly rejects a second app-authored roster mirror. [LLP 0240](/Users/ccheever/projects/snapback/llp/0240-application-authority-profiles.rfc.md), revised 2026-08-22, contains the projection implementation record. [The private-roster decision ticket](/Users/ccheever/projects/snapback/issues/closed/20260821-private-authority-product-roster-decision.md) is closed, as is the writer/runtime implementation ticket. Current [scoped-roles guidance](/Users/ccheever/projects/snapback/guide/auth/scoped-roles.md) already says a profile emits the supported subset of `invite`, `join`, `leave`, `changeRole`, `remove`, and `transferOwner`.

   Diary 0058 remains valid evidence of the historical interim, including its same-file correction that profile operations are directly callable. It cannot establish that the interim remains current after LLP 0240’s later implementation.

   **What would resolve it:** Recast Diary 0058’s mirror as a dated historical cliff; add the closed decision and implementation tickets; describe what the generated projection now closes; replace Recommendation 8 and Open Question 4 with precise residual gaps, if any. Route remaining projection work to LLP 0240 rather than presenting already-shipped work as a new program.

2. **MATERIAL — “Membership-gated asset sharing is still refused” conflates ordinary membership with authority-profile composition.**

   **What is wrong:** Finding 8 and Finding 9 classify membership-gated asset sharing as still unavailable. That is too broad and makes a closed historical cliff appear current.

   **Evidence:** [Protecting data](/Users/ccheever/projects/snapback/guide/auth/protecting-data.md) says one membership declaration can govern table visibility, ephemeral admission, and asset reads. [The asset guide](/Users/ccheever/projects/snapback/guide/backend/assets.md) documents the shipped `.assetSharing({ kind: 'membership', membership, roles })` form. [Party Wall](/Users/ccheever/projects/snapback/demos/party-wall/snapback/schema.mjs) is a first-party proof of membership-gated asset sharing. What remains refused in [scoped-roles.md](/Users/ccheever/projects/snapback/guide/auth/scoped-roles.md) is specifically asset sharing composed with an `authorityProfile`.

   Diaries 0014, 0045, and 0046 accurately record the older packaged closures they exercised, but they do not license the present-tense generic claim.

   **What would resolve it:** Split the row into “ordinary membership asset sharing—shipped” and “authority-profile-backed asset sharing—still refused.” Add Party Wall to the current-source and first-party-demo survey.

3. **MATERIAL — The prevalence, ranking, and prevention claims exceed the evidence boundary.**

   **What is wrong:** The document correctly says this is not a controlled prevalence study, but then says “most” timed lanes skipped the primitive, ranks recommendations “by how often” diaries lost time or shipped worse ACLs, and claims one pair of changes would have prevented “most” disclosed ACL compromises. No eligible denominator or incident-by-cause accounting supports those statements.

   **Evidence:** In the raw [0.1.29 Snapback lanes](/Users/ccheever/projects/snapback/benchmarks/runs/2026-08-27-clique-published-0129-matrix/lanes/), the four grok/sol Explicit/Familiar lanes that reached the relevant build milestone all skipped `.membership()` and `.authorityProfile()`. That is strong evidence. The four GLM/terra Snapback lanes stopped around M1, however; they are censored observations, not choices to skip the primitive. Diary 0114 is explicitly a digest rather than a membership build, yet the source taxonomy includes 0109–0114 under “handler path / skipped.” Diary 0073 is also program-level evidence rather than a straightforward membership build.

   The “ranked by how often” claim directly contradicts the document’s own method section. The `bootstrap(joinedAt)` improvement also does not plausibly explain every public-read compromise in Diaries 0092, 0104, 0105, or 0108, so “prevented most” needs an explicit causal matrix.

   **What would resolve it:** Define eligibility—Snapback lane, reached the milestone where scoped authorization was needed, and had enough remaining time to choose a design—then publish numerator, denominator, and exclusions. Describe non-reaching lanes as censored. Replace frequency-based ranking with a qualitative grouping unless counts are supplied. Support any prevention claim with an incident-to-cause table or weaken it to a hypothesis.

4. **MATERIAL — Changing direct `requireRole` to inherit the profile lattice could weaken an existing authorization fence.**

   **What is wrong:** Recommendation 6 offers closing direct `requireRole` through the profile hierarchy as a viable option. Existing imperative calls are exact-role checks. Changing their meaning in place could admit owners or higher roles where applications deliberately requested only `admin`, silently broadening deployed authorization.

   **Evidence:** Diary 0101 correctly observed the difference: profile-declared `hasRole('member')` is hierarchy-lowered, while direct `requireRole(resource, 'admin')` is exact. [LLP 0240](/Users/ccheever/projects/snapback/llp/0240-application-authority-profiles.rfc.md) makes hierarchy lowering part of the declared profile IR; it does not redefine every imperative helper call. The still-open [role-laundering issue](/Users/ccheever/projects/snapback/issues/shelved/20260819-generated-role-checks-launder-roles-through-array-slice.md) reinforces that this boundary warrants conservative treatment.

   **What would resolve it:** Remove in-place semantic broadening as a recommendation. Prefer a distinct profile-qualified hierarchical helper, codegen expansion at declared call sites, or a diagnostic that explains the exact/hierarchical distinction and suggests the explicit role set. Any migration must make broadened admission reviewable.

5. **MINOR — The bootstrap recommendation overstates the `initialMembers` gap.**

   **What is wrong:** Recommendation 3 says incidental fields should flow through both `bootstrap()` and `initialMembers`. Current generated initial-member values can already carry fields admitted by the membership insert transition. The missing input is the server-synthesized creator seat.

   **Evidence:** The bootstrap section of [scoped-roles.md](/Users/ccheever/projects/snapback/guide/auth/scoped-roles.md) distinguishes the fixed creator seat from additional transition-checked initial members. Diaries 0058, 0100, and 0101 establish the creator-seat problem.

   **What would resolve it:** Say “allow declared incidental values for the creator seat” and separately evaluate provenance, timestamp custody, and which fields the caller may supply.

6. **MINOR — The Expo template identity claim is over-attributed.**

   **What is wrong:** The template does use `v.id('users')`, but it is an ordinary product-membership table, not a `.membership()` declaration. Calling that identity intrinsically “wrong” is too strong. The real problem is that the template’s production-membership comment invites migration or copy-paste without teaching the principal bridge.

   **Evidence:** [The template schema](/Users/ccheever/projects/snapback/packages/snapback-cli/templates/expo-chat/snapback/schema.mjs) contains no `.membership()` declaration. Diary 0108 is still strong evidence that substituting a users-table row id for `v.principal()` is dangerous once the declared path is adopted.

   **What would resolve it:** Reframe this as a migration and teaching hazard, then recommend a production variant or explicit `Id<'users'>`–to–`Principal` bridge.

7. **MINOR — The hooks closure needs sharper terminology.**

   **What is wrong:** Finding 8 says dedicated per-profile hooks are missing while generic hooks work. That is defensible only if “per-profile” means app-specific generated wrappers. The current guide now ships authority-specific package-generic hooks, so the row otherwise reads as a stale capability claim.

   **Evidence:** [scoped-roles.md](/Users/ccheever/projects/snapback/guide/auth/scoped-roles.md) documents `useSnapbackAuthorityRoster`, `useSnapbackAuthorityMyRole`, `useSnapbackAuthorityMutation`, and `useSnapbackAuthorityMutationStatus`, re-exported by Expo. Diary 0021’s 2026-08-16 entry predates or records the absence of generated profile-specific wrappers.

   **What would resolve it:** Name the residual precisely: “app-generated `useRoomAccess…` wrappers remain absent; package-generic authority hooks are shipped.”

8. **MINOR — “Diary consensus” is stronger than the competitive evidence permits.**

   **What is wrong:** Finding 10 is correctly labeled qualitative, but the table header calls it consensus and compresses different tasks, versions, and clocks into backend-level conclusions.

   **Evidence:** The document’s own evidence boundary disallows magnitude claims against Convex and sequencing claims across unrelated subsystems. Individual comparisons from Diaries 0100, 0101, and 0114 are useful observations, not a consensus sample. I did not independently re-verify every non-load-bearing comparison sentence in Finding 10.

   **What would resolve it:** Rename the table “Reported comparisons in the cited diaries,” keep each statement bound to its diary and task, and avoid backend-wide summaries where the corpus contains only one or two relevant builds.

## Suggestions

- Add a temporal evidence ledger with columns for diary, package/source version, milestone reached, declared versus handler path, observed workaround, later correction, current status, and governing LLP or ticket. That would make the two-population split auditable and prevent historical workarounds from becoming present-tense claims.

- Split every capability row by composition class where necessary: ordinary membership, authority-profile-backed membership, local versus hosted, online versus retained. Asset sharing demonstrates why one “membership” row is too coarse.

- Add the closed private-roster decision and writer/runtime tickets, Party Wall, and the current [messaging-snapback schema](/Users/ccheever/projects/snapback/demos/messaging-snapback/snapback/schema.mjs) to the high-signal source set.

- Give duplicate diary numbers their slugs—especially 0045, 0046, and 0058—so citations are unambiguous.

- Turn the recommendation list into a traceability table before using it as program input: observation, current gap, security invariant, existing owner, proposed decision vehicle, and acceptance evidence. LLP 0056, LLP 0100, LLP 0240, and LLP 0310 already own different portions.

- Preserve the document’s caution around Diary 0108. The unperformed corrected-principal retest should remain an explicit uncertainty, not evidence of a separate membership-read defect.

## Open questions

- Is LLP 0331 intended to record what builders experienced at diary time, current 0.1.29 state, or both? If both, should every finding have separate “observed then” and “current now” fields?

- What is the eligible denominator for “skipped the primitive”? Should lanes that never reached the relevant milestone be excluded or reported separately as censored?

- After LLP 0240’s shipped projection, which product-fact needs remain genuinely unsupported: creator-seat incidentals, something about projection declaration ergonomics, or a different composition?

- Should ordinary membership and authority-profile composition be analyzed as separate product surfaces for search, assets, and ephemeral state?

- What backward-compatible helper can expose profile-hierarchical admission without changing the meaning of existing exact `requireRole` calls?

- Should the Expo chat template remain deliberately simple and public, or should it include a second production-private schema variant with an explicit app-user-to-principal bridge?

- Which first-party demo should become the canonical complete group-chat composition, and how will its diary distinguish platform friction from benchmark-imposed shortcuts?

## Recommended next step

Revise LLP 0331 before using it to commission product work. First correct the current-state reconciliation for generated projection, profile operations, hooks, and asset sharing. Then add an eligible-lane evidence table, remove unsupported frequency and “prevented most” claims, narrow the bootstrap recommendation to creator-seat fields, and replace the in-place `requireRole` broadening option with a compatibility-safe design question. A fresh independent review should then focus on the revised evidence ledger and security-preserving recommendations.

NOT READY
