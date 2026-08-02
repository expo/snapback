# LLP 0152 sign-in integration landscape review — Codex family

## Round 1 — 2026-08-02

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0 `codex exec`, model `gpt-5.6-sol`,
reasoning effort xhigh, sandbox read-only, approval never
**Date:** 2026-08-02
**Redacted:** no (repository access; no secrets in scope)
**Method:** mutually blind — capsule prohibited reading any `llp/reviews/`
artifact concerning LLP 0152/0153 and any super-refine journal. The
7,189-line transcript was audited afterwards: all `llp/reviews/`
occurrences are the capsule's own prohibition, the repo llp-review skill
text, the reviewer's stated intent to exclude, and one directory listing;
no file under `llp/reviews/` was read. Blindness held. SHA-pinned target
and instruction capsule; read-only; no tests executed. Four external
primary-source spot checks performed via web search (WorkOS magic-link
deprecation, Stytch scanner handling, NIST restricted-PSTN, Supabase
passkeys — all held). Session id `019fc189-48a5-7742-b9f2-d01518472838`;
tokens used 192,345.
**Instruction capsule:** `capsule-0152-r1.md` (author-directed
conclusions-first priority)
**Target:** `llp/0152-sign-in-integration-landscape.research.md` (v0.1, 967
lines, Draft Research, untracked)
**Target SHA-256:** `b2c6547021095d3f4172722aa88bc2ca05e4b098d4513d20ea430ad20d4aa74e`
**Repo revision at review start:** `main` `67628399`
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## 1. Overall assessment

**NOT READY by a moderate margin.**

The market inventory is substantial, but the conclusions are not reconciled with current LLP 0151 v0.3. The central MFA thesis falsely treats recovery codes as deferred and TOTP as "landscape"; the SMS implication asks LLP 0151 to add requirements it already contains; and "nearly every serious competitor" is contradicted by the document's own matrix. The proposed gates also omit governing session-issuance, sender-constraint, and hosted-security requirements. These are document-level defects that can be resolved without implementation work, but they affect the recommendations that matter most.

## 2. Strengths

- The four-layer model in [0152:13](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:13) cleanly separates mechanisms, federation, journey policy, and delivery surfaces.
- The provider-class conclusion in [0152:139](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:139)—presets over OIDC, SAML, bespoke OAuth2 where necessary, and a BYOP seam—is well supported and agrees with LLP 0151's OIDC/GitHub architecture.
- The account-linking and webhook recommendations in [0152:669](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:669) and [0152:699](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:699) correctly preserve stable principals, transactional first login, conservative linking, and non-cascading provider deletion. The cross-provider opt-in rule is accurately grounded in [LLP 0011:239](/Users/ccheever/projects/snapback/llp/0011-auth-and-permissions.rfc.md:239).
- The passkey lifecycle inventory in [0152:651](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:651) is materially better than checkbox-level "WebAuthn supported" analysis.
- The local provider simulator, capture channels, adversarial identities, and lifecycle fixtures in [0152:836](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:836) are strong product recommendations.
- The final bakeoff question and time-sensitive confidence qualification in [0152:947](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:947) and [0152:953](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:953) correctly acknowledge what documentation research cannot establish.
- Four limited primary-source spot checks held: WorkOS's magic-link deprecation, Stytch's scanner-aware handling, NIST's restricted-PSTN requirements, and Supabase's experimental but lifecycle-capable passkey surface. [WorkOS](https://workos.com/docs/authkit/modeling-your-app), [Stytch](https://stytch.com/docs/consumer-auth/authentication/magic-links/overview), [NIST](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/), [Supabase](https://supabase.com/docs/guides/auth/passkeys).

## 3. Findings

1. **BLOCKING — The central MFA conclusion falsely describes LLP 0151.**

   Anchor: [0152:56](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:56): "Deferring TOTP and recovery codes"; [0152:872](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:872): "Leaving them in 'landscape'."

   LLP 0151 does neither. It places "**TOTP as a second factor**" in Tier 2 at [LLP 0151:659](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:659), and declares "**Recovery codes are tier-1 infrastructure**" at [LLP 0151:423](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:423). The actual unresolved gap is factor composition: "Step-up/MFA composition … is deliberately an open question" at [LLP 0151:455](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:455).

   Resolve by rewriting the Summary and implication 4 around the real delta: recovery infrastructure is already Tier 1; TOTP is already Tier 2; the research may recommend including TOTP in the first production profile and assigning ownership for the step-up/MFA composition model.

2. **BLOCKING — "Nearly every serious competitor" is contradicted by the market matrix.**

   Anchor: [0152:58](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:58): "the ordinary, vendor-independent recovery and second-factor package nearly every serious competitor provides."

   The matrix at [0152:123](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:123) explicitly shows both TOTP and recovery/backup codes for only Clerk, Auth0, Descope, Better Auth, and Keycloak. WorkOS, Supabase, Firebase, Cognito, and Appwrite list TOTP without recovery codes; Convex and PocketBase do not provide that package; Stytch's recovery entry is B2B-scoped and does not establish a general recovery-code package.

   Resolve by adding a distinct recovery column and reporting exact counts. The recommendation can stand on lifecycle completeness and independence from PSTN/vendor delivery; it cannot stand on the current "nearly every competitor" claim.

3. **BLOCKING — The SMS implication asks for safeguards LLP 0151 already specifies.**

   Anchor: [0152:868](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:868): "SMS Tier 1 needs a larger definition. The adapter alone is insufficient."

   Current LLP 0151 already makes abuse controls launch-gating, including country allowlists, per-destination/source/prefix/IP throttles, spend caps, and alarms at [LLP 0151:273](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:273). It specifies vendor-neutral transport at [LLP 0151:281](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:281), names recycled-number/SIM-swap risk at [LLP 0151:293](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:293), requires recent authentication for phone changes at [LLP 0151:411](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:411), and mandates recovery codes for SMS-only accounts at [LLP 0151:423](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:423).

   Resolve by marking this evidence as confirmation of LLP 0151's current definition. Identify only genuine remaining gaps, such as delivery-vendor ownership, which LLP 0151 already carries as open at [LLP 0151:853](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:853).

4. **MATERIAL — Several other §Implications items do not distinguish existing LLP 0151 content from proposed changes.**

   Anchors: [0152:858](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:858), [0152:864](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:864), [0152:877](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:877), [0152:890](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:890).

   LLP 0151 already:

   - makes Microsoft Entra the first named Tier-2 preset at [LLP 0151:471](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:471) and [LLP 0151:661](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:661);
   - prefers email codes over links at [LLP 0151:221](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:221);
   - requires recovery for passkey-only accounts at [LLP 0151:423](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:423);
   - separates sign-in from provider-API token custody at [LLP 0151:780](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:780).

   The valid deltas are narrower: possible Microsoft Tier-1 promotion; scanner-aware link semantics; progressive enrollment, conditional UI, richer credential management, and user-verification projection.

   Resolve by labeling each item either "confirms current LLP 0151" or "requests this exact addition."

5. **MATERIAL — The Summary omits the BYOP/external-CIAM seam that the body calls essential.**

   Anchors: the "best composite design" list at [0152:38](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:38), versus the "winning abstraction" including BYOP at [0152:158](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:158) and the "essential" verifier seam at [0152:550](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:550).

   LLP 0151 explicitly has a Tier-2 "BYOP verified-token hook" at [LLP 0151:665](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:665). LLP 0153 goes further and recommends a paved external-CIAM provider class at [LLP 0153:13](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:13) and [LLP 0153:79](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:79).

   Resolve by adding the verified-external-assertion/BYOP seam to the Summary's composite design, or explicitly delegating its detailed recommendation to LLP 0153.

6. **BLOCKING — The shared-credential recommendation permits an unsafe production escape hatch.**

   Anchor: [0152:767](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:767): "Production must refuse shared credentials unless the deployment explicitly declares and accepts that posture."

   Acknowledgment alone does not resolve consent-brand leakage, shared suspension fate, issuer/subject continuity, provider-token custody, or migration. The same document later calls a generic "graduate later" promise unsafe at [0152:881](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:881).

   LLP 0151 recommends app-owned Option D for production at [LLP 0151:744](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:744). Its possible production broker is a narrowly pre-pinned conditional with issuer continuity, app verification, nonce/PKCE constraints, no session issuance, and a self-hostable protocol at [LLP 0151:753](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:753).

   Resolve by refusing shared credentials in production pending LLP 0151's author decision, or by making the exception contingent on that complete conditional contract—not a posture acknowledgment.

7. **MATERIAL — "Client arms" conflates three distinct corpus axes.**

   Anchors: [0152:760](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:760) and "web and native arms" at [0152:910](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:910).

   LLP 0064 defines React Native/Expo, Exact Native, and protocol-native as distinct **client surfaces** at [LLP 0064:17](/Users/ccheever/projects/snapback/llp/0064-native-client-surfaces.rfc.md:17). LLP 0093 defines **arms** through tuples such as `poll/local`, `live/local`, and `live/hosted` at [LLP 0093:492](/Users/ccheever/projects/snapback/llp/0093-client-protocol-and-native-clients.rfc.md:492). LLP 0096 composes auth profiles onto those arm × lane tuples at [LLP 0096:113](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:113).

   Resolve by splitting acceptance into provider/mechanism × deployment arm and provider/mechanism × client surface, with negotiated auth profiles attached where applicable.

8. **BLOCKING — The proposed evaluation gates omit governing session-issuance and hosted-security requirements.**

   Anchor: the allegedly sufficient future-design gate list at [0152:895](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:895).

   OAuth replay/mix-up coverage is not enough. LLP 0151 requires a bounded authorization transaction, sender-constrained completion-code redemption, and forbids provider or Snapback bearer tokens from crossing redirect URLs at [LLP 0151:509](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:509). LLP 0060 requires edge confidentiality, effective-source derivation, shared throttling, globally fenced invalidation, and sender-constrained browser posture before hosted-auth capability at [LLP 0060:121](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:121). LLP 0077 binds issuance and every protected request to the browser custody key at [LLP 0077:517](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:517) and [LLP 0077:756](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:756).

   Resolve by adding an OAuth completion/session-issuance gate and a hosted-admission/sender-constraint gate, or explicitly declaring those inherited gates mandatory.

9. **MATERIAL — Guest-collision handling weakens LLP 0151's safety contract.**

   Anchor: [0152:829](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:829): "continue as existing account and abandon guest data."

   LLP 0151 explicitly says guest data is not destroyed on switch; the guest principal is frozen and retained in quarantine under a TTL at [LLP 0151:354](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:354). Its optional merge is checkpointed, resumable, version-pinned, and paired with an app-owned cleanup contract at [LLP 0151:363](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:363).

   Resolve by using LLP 0151's `switch_existing`/freeze/quarantine terminology and carrying its cleanup requirements, or explicitly arguing for a different policy.

10. **MATERIAL — The document presents `aal` as part of the settled composite while leaving assurance vocabulary open.**

   Anchors: Summary endorsement at [0152:49](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:49), illustrative `aal1` configuration at [0152:727](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:727), and the still-open vocabulary question at [0152:938](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:938).

   This matters because the proposed default is email-code authentication, while current NIST guidance does not recognize email as an out-of-band authenticator. An `aal1` label could therefore be mistaken for a NIST assurance claim that the design cannot make. [NIST authenticator requirements](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/).

   Resolve by using neutral internal vocabulary until mappings are specified, or explicitly defining Snapback assurance levels and their non-equivalence or conformance relationship to NIST/OIDC upstream claims.

11. **MATERIAL — The relative-ease conclusions outrun the stated evidence quality.**

   Anchors: "shortest path" at [0152:25](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:25), repeated "easiest" rankings at [0152:570](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:570), and the categorical claim at [0152:852](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:852).

   The method rejects vendor time-to-value claims as benchmarks at [0152:75](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:75); open question 10 says documentation cannot measure the last mile reliably; and Confidence rates relative ease only Medium. "Best documented candidate for…" follows. "Shortest/easiest" and "no surveyed product" do not yet follow.

   The Cognito paragraph is a sharper internal contradiction: [0152:456](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:456) calls practitioner sentiment "unusually consistent" and uses it for "reliable," while [0152:962](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:962) says anecdotes are never used as reliability measurements.

   Resolve by qualifying rankings as documentation-derived hypotheses pending the bakeoff, and remove "reliable" unless supported by non-anecdotal evidence.

12. **DETAIL — The evidence-labeling method is not followed literally.**

   Anchor: [0152:75](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:75) says product facts are `[observed]` and experience claims are labeled `[anecdotal]`.

   Outside the method paragraph, neither tag appears. Practitioner passages use prose such as "This is anecdotal," and matrix cells are not individually traceable to sources. That is understandable editorially, but it is not the stated method.

   Resolve by either applying the tags consistently or changing the method to describe the actual convention: linked official facts, with practitioner claims explicitly identified in prose.

13. **DETAIL — The Related header fails the requested body-mention rule.**

   Anchor: [0152:9](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:9).

   Only LLP 0151 is named in the body. LLP 0001, 0011, 0039, 0045, 0057, 0060, 0064, 0077, 0096, and 0153 appear only in `Related`. Several are genuinely relevant, but the body does not earn them. In particular, the linking rule at line 682 should cite LLP 0011, the arm/surface requirements should cite 0064/0096, the hosted gates should cite 0060/0077, and the external-CIAM boundary should cite 0153.

   Resolve by adding the appropriate body references or pruning unneeded entries.

## 4. Suggestions

- Add a conclusion-traceability table: recommendation, supporting products/standard, evidence type, confidence, and whether it confirms or challenges LLP 0151.
- Add a separate recovery column to the market matrix; MFA-factor support and account recovery are currently compressed together.
- Replace "never email" at line 671 with "never email alone across provider installations." Snapback's built-in `email-code` provider legitimately uses the canonical email address as its provider-scoped subject at [LLP 0039:602](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:602).
- Make production readiness tri-state where external consoles are not machine-readable: machine-verified, operator-attested, or unverifiable/refused.
- Separate market consensus, Snapback-specific inference, and author decision throughout the conclusion sections.

## 5. Open questions the document should carry

1. What exact product claim constitutes the "first production auth profile": sign-in only, upstream-MFA evidence, or first-party MFA? Who owns the factor-composition design?
2. Does Snapback use NIST-compatible assurance levels, an explicitly different internal vocabulary, or profile-specific mappings?
3. What evidence ranks Microsoft/GitHub ahead of Facebook/X for Snapback's actual target users: product strategy, telemetry, or an author pin?
4. Can production shared credentials ever be permitted, and if so, what requirements beyond acknowledgment make that safe?
5. Which checked-in declaration is authoritative when hosted UI, generated components, and headless configuration diverge, and what are the rollback/migration semantics?
6. Is external CIAM a sibling paved path governed by LLP 0153, or merely a Tier-2 escape hatch under LLP 0151?

## 6. Recommended next step

Revise and remain **Draft**. Reconcile the conclusions against current LLP 0151 v0.3, replace the unsupported competitor-universality claim with exact matrix evidence, distinguish confirmations from requested changes, add the inherited session/hosted security gates, and repair evidence/Related hygiene. Then run the next independent review round; no broader vendor survey is necessary before that re-review.

## Round 2 — 2026-08-02

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0 `codex exec`, model `gpt-5.6-sol`,
reasoning effort xhigh, sandbox read-only, approval never
**Date:** 2026-08-02
**Redacted:** no
**Method:** family-conditioned blindness — own round-1 artifact allowed and
read; other family's artifact, all 0153 review artifacts, and all
super-refine journals prohibited. Transcript audited: the only
`llp/reviews/` traces beyond the capsule text and its own permitted round-1
artifact are a `git status` listing. Blindness held. Delta-scoped over the
16 enumerated v0.2 change sites; two external primary-source checks (Stytch
Consumer TOTP API, Appwrite MFA) — both subsequently re-verified by the
orchestrator before application. Session id
`019fc1a1-1192-7392-b455-8493fa16e42a`; tokens used 211,050.
**Instruction capsule:** `capsule-0152-r2.md` (final round per the author's
two-round cap)
**Target:** `llp/0152-sign-in-integration-landscape.research.md` (v0.2,
1085 lines, Draft Research, untracked)
**Target SHA-256:** `a54aa24d8d537498d79da30c5fabacadb6fe904d7fcf685f20ab411e57ce5214`
**Status:** completed
**Verdict:** NOT READY

## Verbatim review (round 2)

# LLP 0152 round-2 review — Codex family

## Overall assessment

**Verdict: NOT READY by a moderate margin.**

The revision substantively resolves 11 of my 13 round-1 findings. One finding—the market count for TOTP plus recovery codes—is still unresolved and now appears prominently in the headline conclusion. The hosted-admission repair is partial, and two localized corpus descriptions need correction.

The target hash matches `a54aa24d8d537498d79da30c5fabacadb6fe904d7fcf685f20ab411e57ce5214`. Blindness held. The live checkout is at `4f7890eb`, not the capsule's `67628399`, but the intervening committed change is LLP 0150 and does not affect the governing files reviewed here. Current LLP 0151 remains v0.3.

## Round-1 verification

| Round-1 finding | Round-2 result |
|---|---|
| 1. Recovery/TOTP placement vs 0151 | **Resolved** at [0152:63](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:63) and [0152:940](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:940). |
| 2. Unsupported competitor count | **Not resolved**; see BLOCKING finding 1 below. |
| 3. SMS requirements already in 0151 | **Resolved** at [0152:931](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:931). |
| 4. Confirms vs requests | **Resolved** throughout [0152:906](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:906). |
| 5. BYOP/external-CIAM seam | **Resolved** at [0152:57](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:57) and [0152:579](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:579). |
| 6. Unsafe shared-credential exception | **Resolved** at [0152:803](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:803). |
| 7. Arms vs client surfaces | **Resolved** at [0152:796](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:796) and [0152:987](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:987). |
| 8. Session/hosted security gates | **Partially resolved**; see MATERIAL finding 2. |
| 9. Guest collision | **Resolved** at [0152:874](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:874). |
| 10. Settled `aal` vocabulary | **Resolved** at [0152:51](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:51), [0152:768](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:768), and [0152:1033](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:1033). |
| 11. Ease/reliability overclaims | **Resolved** at [0152:25](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:25), [0152:484](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:484), and [0152:601](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:601). |
| 12. Evidence-labeling method | **Resolved** at [0152:89](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:89). |
| 13. Related/body-mention hygiene | **Resolved**; every Related entry now has a substantive body mention. |

## Strengths

- The confirms-versus-requests rewrite is precise and accurately baselined against current LLP 0151 v0.3.
- Shared production credentials are now refused under the correct present posture, while LLP 0151's narrowly conditional future broker remains visibly author-dependent.
- Guest collision, account-linking, assurance vocabulary, and deployment-arm/client-surface distinctions now preserve the governing corpus rather than paraphrasing it loosely.
- The evidence and ease qualifications are honest about what documentation research can establish.
- Growth is disciplined: 118 added lines, 12.2% over v0.1, remains comfortably inside the roughly 20% budget. I found no padding.

## Findings

1. **BLOCKING — The five-of-thirteen TOTP-plus-recovery count is false.**

   Anchors: [0152:63](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:63), [0152:145](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:145), [0152:159](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:159), and [0152:164](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:164).

   Two omitted products have explicit official support:

   - Stytch's **Consumer** TOTP creation response includes `recovery_codes`; it is not B2B-only. [Stytch Consumer TOTP documentation](https://stytch.com/docs/consumer-auth/authentication/totps/api)
   - Appwrite documents TOTP authenticators, generated single-use recovery codes, and recovery-code MFA challenges. [Appwrite MFA documentation](https://appwrite.io/docs/products/auth/mfa)

   Therefore "exactly five" and "Appwrite document[s] TOTP without recovery codes" are false. If the remaining rows hold, the count is seven: the named five plus Stytch and Appwrite.

   This is the substantive repair requested by round-1 finding 2, so that finding is not genuinely closed. Re-audit the column, update both rows and every repeated count, and add direct source links.

2. **MATERIAL — The hosted-admission gate still compresses three distinct LLP 0060 levels.**

   Anchor: [0152:1010](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:1010).

   The gate is labeled "Hosted-admission" but lists only the four mechanisms sufficient for static `deploymentCapable`. LLP 0060 says `hostedAuthCapable` additionally requires sender-constrained client posture, while actual admission also requires deployment attestation, live health, disabled operator surface, direct-bearer exclusion, and the mixed-version boundary at [0060:126](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:126) and [0060:465](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:465).

   Gate 11 mentions issuance binding, but LLP 0077 also requires sender proofs on every protected request and connection open at [0077:517](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:517).

   Require the complete LLP 0060 D5/D6 admission conjunction and make the four-item list explicitly non-exhaustive.

3. **MATERIAL — Best idea 7 assigns session-authority transitions to LLP 0053.**

   Anchor: [0152:847](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:847).

   The bullet says an "authority generation" projected into the session makes reset/link/recovery invalidate stale clients, then names LLP 0053 as the machinery. LLP 0053 explicitly excludes session revocation from its authorization-event universe and assigns those authority transitions to LLP 0039 at [0053:450](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:450).

   Split the concepts:

   - LLP 0039 session/family authority transitions handle revocation and recovery-related rotation.
   - LLP 0053 authorization versions and obligations handle `permissionBacking` changes such as link/claim/merge effects.

   Do not describe LLP 0053 as projecting an authority generation "into the session."

4. **DETAIL — OQ15 calls proposed fixtures "existing machinery."**

   Anchor: [0152:1063](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:1063).

   The capture mailbox exists. The conformance IdP is proposed by LLP 0151 at [0151:491](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:491), and the auth-specific acceptance personas/provider simulator are proposed by this Research. Rephrase as "existing and already-proposed machinery," identifying which is which.

## Suggestions

- Add the distinct recovery-code column originally suggested in round 1. Folding recovery into free-form MFA prose directly caused the incorrect count to survive the repair.
- In evaluation gates, use LLP 0060's exact vocabulary: static deployment support, hosted-auth capability, and live hosted admission.
- Keep session authority generation and authorization-version invalidation as separately named concepts.

## Open questions

- Does the author intend gate 12 to require actual live admission or only static target capability? The current heading and contents disagree.
- Were Stytch Consumer and Appwrite recovery codes omitted because of source-selection drift, or because "recovery-code package" had an unstated narrower definition? If narrower, define it and apply it consistently.

## Recommended next step

Revise and remain **Draft** until the four findings above are applied. The present SHA should not land unchanged.

No third super-refine round is genuinely required. These defects can be corrected and source-verified in the landing commit: recheck the thirteen recovery rows, restore LLP 0060's complete admission conjunction, split LLP 0039/0053 ownership, and correct OQ15's current-versus-proposed wording.
