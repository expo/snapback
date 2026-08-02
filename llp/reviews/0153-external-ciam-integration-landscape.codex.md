# LLP 0153 external CIAM integration landscape review — Codex family

## Round 1 — 2026-08-02

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0 `codex exec`, model `gpt-5.6-sol`,
reasoning effort xhigh, sandbox read-only, approval never
**Date:** 2026-08-02
**Redacted:** no (repository access; no secrets in scope)
**Method:** mutually blind — capsule prohibited reading any `llp/reviews/`
artifact concerning LLP 0152/0153 and any super-refine journal. The
8,929-line transcript was audited afterwards: all `llp/reviews/`
occurrences are the capsule's own prohibition, the repo llp-review skill
text, the reviewer's stated intent to exclude, and one directory listing;
no file under `llp/reviews/` was read. Blindness held. SHA-pinned target
and instruction capsule; read-only; no tests executed. No external vendor
claim was reverified (reviewer's own statement); vendor findings concern
provenance and internal consistency. Session id
`019fc189-5006-7650-a53a-80aa699d079a`; tokens used 218,338.
**Instruction capsule:** `capsule-0153-r1.md` (author-directed
conclusions-first priority)
**Target:** `llp/0153-external-ciam-integration-landscape.research.md`
(v0.1, 959 lines, Draft Research, untracked)
**Target SHA-256:** `88eb933c9dff3d747e018e1e5bbb0fa3689b89fe3c1ac10eef18211c57380488`
**Repo revision at review start:** `main` `67628399`
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## 1. Overall assessment

**NOT READY — by a wide margin.**

The reviewed file matches the supplied SHA-256. The generic-verifier-plus-named-profiles direction is defensible, and Model B may still be the right default. The current recommendation, however, overstates what sender binding protects, assumes native sender constraint despite an explicit corpus GAP, omits mandatory hosted-auth throttling, misroutes organization transitions through LLP 0053, and permits impersonation through an ordinary-session path. The capability, persistence, migration, and support-tier models also remain too incomplete for the conclusions to be followed literally. No external vendor claim was independently reverified; vendor findings below concern provenance and internal consistency.

## 2. Strengths

- §Terms correctly separates upstream subject, Snapback principal, organization context, and session, and rejects email as a cross-provider identity key.
- The Model B analysis explicitly records the two-session-layer cost, revocation lag, assurance-age problem, and organization-switch barrier rather than presenting exchange as free.
- §Principal creation correctly requires transactional first-login provisioning rather than webhook-dependent creation.
- The same-email linking and non-cascade deletion recommendations match LLP 0011's actual rules at [LLP 0011:239](/Users/ccheever/projects/snapback/llp/0011-auth-and-permissions.rfc.md:239).
- §MFA, passkeys, and step-up correctly distinguishes session evidence from tenant-level feature enablement and refuses unsupported assurance requirements.
- §Events defines an appropriate receiver baseline: raw-body verification, bounded input, idempotency, conflict handling, reconciliation, and lag diagnostics.
- §Acceptance gates covers identity collision, issuer migration, key rotation, stale assurance, organization removal, event replay, portability, and guide evidence.

## 3. Findings

1. **BLOCKING — Sender binding is credited with protection it does not provide.**

   At [0153:51](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:51), the summary says exchange "preserves LLP 0077's browser-session security." At [0153:706](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:706), a binding-proof nonce is said to prevent replay from minting unrelated downstream sessions.

   A Snapback proof can bind the newly minted Snapback family to a key. It cannot prove that the key holder is the legitimate owner of a reusable upstream bearer assertion. An attacker holding a copied CIAM JWT can generate another key and another valid Snapback proof. LLP 0077's actual claim is narrower: it constrains copied Snapback credentials after issuance ([LLP 0077:517](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:517)); its issuance proof is tied to the exact challenge exchange and only binds the newly created family ([LLP 0077:756](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:756)).

   Resolve by separating:

   - bearer-originated authentication of the external assertion;
   - sender binding of the resulting Snapback session;
   - provider-signed key/nonce binding where a provider actually supports it;
   - assertion reuse policy, `jti` handling, maximum assertion age, and downstream lifetime clamp.

   Rewrite the summary, §Replay, capability model, and acceptance gate so they do not imply that ordinary LLP 0077 binding prevents upstream-token replay.

2. **BLOCKING — The proposed Expo first wave contradicts the current native sender-constraint contract.**

   The draft makes sender-constrained exchange the default, calls Clerk a strong Expo fit, and proposes proving Clerk "end to end on web and Expo" at [0153:879](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:879).

   LLP 0096 says the opposite capability state:

   > "Until that story exists, a native client cannot claim `auth/sender`, and a sender-constrained deployment cannot admit native clients."

   See [LLP 0096:592](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:592) and [LLP 0096:630](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:630). LLP 0064 classifies React Native/Expo as a native client surface, not browser custody ([LLP 0064:17](/Users/ccheever/projects/snapback/llp/0064-native-client-surfaces.rfc.md:17)).

   Resolve by either limiting the initial sender-constrained proof to browser web, sequencing a native sender-profile amendment before the Expo claim, or labeling Expo as non-sender-bound/local-only and therefore insufficient for hosted Tier 1. Capabilities must report sender support per surface and OS.

3. **BLOCKING — The external exchange path omits LLP 0060's mandatory hosted-auth throttle.**

   The six exchange rules at [0153:414](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:414) contain no admission budget, and neither §Security requirements nor §Acceptance gates adds one.

   LLP 0060 requires hosted auth attempts to charge atomic shared global, effective-source, subject, source×subject, and resolved-family/user buckets, including malformed and unresolved credentials ([LLP 0060:333](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:333)). Limiter failure may not become unlimited.

   Resolve by defining pre-body admission, bounded JWT parsing, pre-verification claimed-subject charging, post-verification principal charging, JWKS-refresh interaction, JIT-provisioning budgets, stable throttle refusals, and acceptance tests. The external exchange must be explicitly added to the LLP 0060/route-policy surface.

4. **BLOCKING — Organization switching is assigned to the wrong governing mechanism.**

   At [0153:501](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:501):

   > "An organization switch is an auth-context change subject to LLP 0053 invalidation and LLP 0059's client barrier."

   LLP 0053 explicitly distinguishes authorization events from session-authority transitions: session revocation and related authority changes belong to LLP 0039 and run through `AuthCoordinator`, not the LLP 0053 authorization-event path ([LLP 0053:450](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:450)). LLP 0059's same-user/different-session rule blanks session-dependent results, strands the predecessor queue, opens a fresh connection, and fresh-snapshots ([LLP 0059:2164](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:2164)).

   An upstream organization switch has two distinct cases:

   - changing session identity context is an LLP 0039/0059 authority transition;
   - reconciling app membership rows is a `permissionBacking` write governed by LLP 0053.

   Define those separately. Also specify where `identity-only` context is projected. LLP 0053 permits retained authorization to depend only on `userId`; session/provider-dependent results are not retainable ([LLP 0053:1640](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:1640)).

5. **BLOCKING — The exchange rules allow impersonation to become an ordinary principal.**

   Rule 4 at [0153:421](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:421) permits an impersonated assertion when "the declaration explicitly permits" it. Rules 5–6 then link a stable principal and mint the normal session.

   That contradicts [0153:588](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:588), which says impersonation must be rejected or represented by a distinct audited authority and must not become an ordinary principal.

   Resolve by removing impersonation from the generic permit list. It must either be rejected or enter a separately specified authority kind with actor/effective-principal provenance, audit, restricted scopes, client projection, and invalidation behavior. No configuration boolean may route it through ordinary session issuance.

6. **BLOCKING — The audience rule conflates ID/session tokens with API access tokens.**

   At [0153:428](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:428), the draft says the audience "must be Snapback/the app API." Elsewhere it explicitly supports ID, access, and provider-session tokens and recommends Firebase ID tokens and Cognito ID/access distinctions.

   A single API-audience rule cannot describe all those token classes. Applied literally, it either rejects valid ID/session-token profiles or encourages treating an ID token as an API access token.

   Preserve the prohibition on raw Google/GitHub resource tokens, but define validation per profile and token kind:

   - API access token: exact Snapback API resource audience;
   - ID token: exact registered relying-party/client audience and `azp` rules;
   - provider session token: the provider's documented application/party semantics;
   - Cognito/Firebase-style quirks: their explicitly pinned client/project fields.

7. **MATERIAL — The capability model omits the policy values the document says are load-bearing.**

   The summary says revocation lag must be exposed through capabilities. Section §Logout requires assertion maximum age, downstream lifetime, lifecycle-event support, online revalidation, and JWKS-failure posture. The type at [0153:749](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:749) exposes almost none of these—mostly booleans.

   LLP 0053 has already settled one part the draft leaves effectively floating: retained authorization must clamp to `provider_not_after_ms` when the provider assertion has an expiry ([LLP 0053:1382](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:1382)).

   Add quantitative and policy-valued capabilities for assertion age, downstream session not-after, retained-lease provider clamp, revocation/reconciliation bound, online-revalidation support, stale-key window, JWKS failure behavior, and sender support per client surface. Require the exchange to populate `provider_not_after_ms`.

8. **MATERIAL — The proposed protected state has unresolved identity, session, cursor, and catalog cardinalities.**

   The canonical key is described as `(issuer, subject)` at [0153:108](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:108), but the exchange looks up `(provider_key, issuer, subject)` at [0153:423](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:423). The proposed identity link then stores a provider session ID and provider event cursor at [0153:461](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:461).

   LLP 0151 says `provider_key` is sound only when a stable provider installation immutably binds issuer, tenant/team, and registration ownership ([LLP 0151:402](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:402)). A provider session ID is session-scoped, not identity-scoped; an event cursor is normally installation/stream-scoped. Putting either singular value on an identity link cannot represent concurrent upstream sessions or one cursor spanning many identities.

   This also requires catalog evolution. LLP 0057's auth catalog is exact-versioned and permits no implicit migration ([LLP 0057:164](/Users/ccheever/projects/snapback/llp/0057-auth-provider-protocol.spec.md:164)); the current identity relation has only `provider`, `subject`, and verification time ([LLP 0057:410](/Users/ccheever/projects/snapback/llp/0057-auth-provider-protocol.spec.md:410)).

   Resolve with distinct provider-installation, identity-link, upstream-session provenance, derived-family mapping, event cursor/dedupe, and membership relations. State the catalog-version/migration requirement in the adoption sequence.

9. **MATERIAL — The support tiers conflict with LLP 0151's existing tier contract.**

   LLP 0153's Tier 1 requires "hosted acceptance" but does not require both deployment arms, per-OS client-surface evidence, a demo witness, or a capability-index row.

   LLP 0151 defines Tier 1 through both deployment arms and a separate client-surface matrix, with every row requiring guide, fixture, demo, and capability witnesses ([LLP 0151:177](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:177), [LLP 0151:795](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:795)).

   Either align the CIAM tiers with that definition or give them a different name, such as "external profile support levels." Replace "client arms" with "client surfaces" and report local/hosted deployment arms separately.

10. **MATERIAL — The load-bearing provider table violates the document's own evidence-label policy.**

    Lines [0153:85](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:85)–87 promise that product behavior is marked `[observed]` and recommendations/deductions `[inference]`. The comparison table at [0153:300](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:300) contains dense vendor facts and the tier recommendations without either labels or row-level sources.

    Several later passages also mix scopes: the Clerk webhook capability claim at lines 582–584 is external behavior labeled only `[inference]`, while WorkOS impersonation facts at lines 588–590 are unlabelled.

    These facts support the provider ordering, so this is not cosmetic. Add sources and observed/inference separation per row or explicitly identify the table as a synthesis from LLP 0152 with traceable source anchors.

11. **MATERIAL — "LLP 0150 owns the agent lane" is an ownership overstatement.**

    At [0153:600](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:600), the draft assigns the agent lane to LLP 0150.

    LLP 0150 states:

    > "This RFC creates no new token model. It is an acquisition-and-consent front end onto LLP 0055's grants, credentials, and scoped tokens."

    See [LLP 0150:146](/Users/ccheever/projects/snapback/llp/0150-agent-token-acquisition.rfc.md:146). LLP 0055 owns agent principals, grants, and scopes; LLP 0150 owns their acquisition ceremony. Correct the ownership statement and decide whether machine identities extend LLP 0055 or require a separate service-principal contract.

12. **DETAIL — Related-header hygiene fails in both directions.**

    The Related header at [0153:9](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:9) omits LLP 0150 despite the body citation. LLP 0001, 0039, 0057, 0060, 0064, and 0096 appear in Related but are never cited by LLP number in the body.

    Add LLP 0150. Cite the governing documents at the sections they actually constrain—especially 0057/0039 for issuance/catalog, 0060 for hosted admission, and 0064/0096 for client surfaces—or remove unearned entries. LLP 0036 should be added if its secrets/config ownership is made explicit.

## 4. Suggestions

- Add a compact ownership table mapping verifier, route, session issuance, catalog migration, secrets, hosted admission, sender constraint, client profiles, lifecycle events, and authorization invalidation to their governing LLPs.
- Distinguish "roadmap target" from "currently supported tier"; a provider should not be described as Tier 1 before its required evidence exists.
- Define stable public refusal codes for issuer, audience, token kind, pending state, tenant, assurance, impersonation, replay, JWKS outage, throttling, and link collision.
- Specify that local logout suppresses automatic re-exchange until explicit user action; otherwise an intact upstream session can immediately sign the user back in.
- Add confidence levels to the Clerk/WorkOS/Auth0 ordering. The provider-class recommendation is stronger than the current comparative evidence for the exact order.

## 5. Open questions the document should carry

- Which normative document owns the external-exchange route and its exact extension of LLP 0057/0077?
- What is the stable provider-installation identifier, and how is issuer/custom-domain reconfiguration migrated without creating a second principal?
- How are upstream session IDs mapped to derived Snapback families so one-session revocation does not require identity-wide revocation?
- How are throttle buckets derived before verification without trusting attacker-controlled issuer/subject claims?
- Which native sender-constraint specification and per-OS evidence must land before Clerk or WorkOS can be called paved on Expo?
- What are reset, backup, logical export/import, and retention semantics for installation state, event cursors, dedupe records, external-session mappings, and disabled links?

## 6. Recommended next step

Revise and remain **Draft**. Repair the blocking security and corpus conflicts first; then add the protected-state/catalog migration model, align support tiers with LLP 0151, expand the capability schema, and source the provider table. Run another independent review round after those prose changes. No code experiment is needed to resolve the findings above.

## Round 2 — 2026-08-02

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0 `codex exec`, model `gpt-5.6-sol`,
reasoning effort xhigh, sandbox read-only, approval never
**Date:** 2026-08-02
**Redacted:** no
**Method:** family-conditioned blindness — own round-1 artifact allowed and
read; other family's artifact, all 0152 review artifacts, and all
super-refine journals prohibited. Transcript audited: the only
`llp/reviews/` traces beyond the capsule text and the permitted round-1
artifact are directory listings and incidental mentions inside LLP body
text. Blindness held. Delta-scoped over the 18 enumerated v0.2 change
sites; three external spot checks (WorkOS API reference, Clerk manual JWT
verification, Convex Clerk integration — all held). The reviewer noted the
read-only sandbox prevented it from appending its own artifact; archived
here by the orchestrator as a dated round-2 section per its instruction.
Session id `019fc1a1-1970-7312-add0-0910e7d08fbd`; tokens used 199,930.
**Instruction capsule:** `capsule-0153-r2.md` (final round per the author's
two-round cap)
**Target:** `llp/0153-external-ciam-integration-landscape.research.md`
(v0.2, 1125 lines, Draft Research, untracked)
**Target SHA-256:** `50342abf499c858b5967f2038b88a11c1741c98326bff48edbfa029c3455c9ef`
**Status:** completed
**Verdict:** NOT READY

## Verbatim review (round 2)

# LLP 0153 round-2 review — Codex family

**Reviewer family:** OpenAI Codex
**Date:** 2026-08-02
**Method:** Delta-scoped, same-family independent review. Read only the permitted Codex round-1 artifact; did not read the other-family artifact, LLP 0152 reviews, or any super-refine journal. Corpus claims were checked against the referenced LLPs.
**Target:** v0.2, 1125 lines, SHA-256 `50342abf499c858b5967f2038b88a11c1741c98326bff48edbfa029c3455c9ef`
**Verdict:** **NOT READY — narrow margin**

The revision repairs most of round 1's architectural problems. It does not need another broad design review, but two security/corpus errors and three material consistency issues must be corrected before landing.

## Round-1 verification

Fully resolved: findings 4, 5, 6, 11, and 12—organization transitions, impersonation, token-kind audiences, machine-identity ownership, and Related-header hygiene.

Substantially resolved but with displaced-text residue: findings 1, 2, and 9—sender binding, native posture, and support-level naming.

Only partly resolved: findings 3, 7, 8, and 10—admission budgets, capability/lifetime policy, protected-state cardinality, and provider-table provenance.

## Strengths

- The bearer-originated-exchange distinction at [0153:52](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:52) is now explicit and materially correct.
- The native sender GAP at [0153:487](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:487) accurately reflects [LLP 0096's current rule](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:592).
- The organization split at [0153:570](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:570) correctly separates LLP 0039/0059 authority transitions from LLP 0053 `permissionBacking` writes.
- Impersonation is now unconditionally rejected from ordinary exchange, with a properly distinct future authority kind.
- The audience rules are correctly profile- and token-kind-specific.
- The WorkOS impersonation, Clerk pending-session, and Convex token-refetch observations survive spot checks against the [WorkOS API reference](https://workos.com/docs/reference/authkit/authentication), [Clerk verification documentation](https://clerk.com/docs/guides/sessions/manual-jwt-verification), and [Convex Clerk integration](https://docs.convex.dev/auth/clerk).
- Growth discipline passes. The added material is mostly load-bearing, not padding; the remaining fixes should replace existing prose rather than add sections.

## Findings

1. **BLOCKING — The new exchange-budget rule misstates LLP 0060 D3 and omits its acceptance/route ownership.**

   At [0153:453](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:453), every attempt—including malformed and unresolved assertions—is said to charge claimed-subject and source×subject buckets.

   LLP 0060 instead requires subject buckets only where a subject is present; malformed, unparseable, or unresolved credentials necessarily charge source and global buckets ([LLP 0060:333](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:333)). Its current v1 contract is also explicitly charge-on-denial, no rollback, and fail-closed ([LLP 0060:373](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:373)).

   The final "LLP 0060/route-policy surface" statement also obscures ownership. LLP 0031 owns the route-policy vocabulary and exhaustive route matrix ([LLP 0031:87](/Users/ccheever/projects/snapback/llp/0031-server-route-taxonomy.spec.md:87)); LLP 0060 owns hosted admission. The acceptance table lacks the source-spray, identity-spray, NAT, malformed-credential, and limiter-failure evidence required by [LLP 0060:992](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:992).

   Replace rule 7 so it says:

   - pre-parse attempts always charge global and effective-source;
   - bounded canonical parsing adds claimed-subject/source×subject only when a subject is available;
   - successful resolution adds family/user buckets;
   - the complete applicable set is charged atomically, including on denial;
   - bucket keys remain bounded and privacy-preserving;
   - JIT issuer quotas are an additional `[inference]`, not attributed to D3;
   - the route is registered under LLP 0031 and receives explicit abuse acceptance coverage.

2. **BLOCKING — The revision conflates upstream assertion freshness, downstream session expiry, and LLP 0053's retained-authorization lease clamp.**

   The summary says upstream suspension becomes visible at token expiry ([0153:67](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:67)), but an already-issued Snapback session does not consult that token unless its own lifetime or revalidation policy requires it.

   More seriously, [0153:817](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:817) describes the downstream session lifetime as clamped by the assertion and calls LLP 0053's `provider_not_after_ms` the existing mechanism. That field belongs to `AuthorizedLease` ([LLP 0053:1320](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:1320)); it bounds retained/offline authorization, not the session family itself ([LLP 0053:1382](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:1382). The capability schema repeats the conflation at [0153:878](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:878), while the open question at [0153:1059](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:1059) correctly leaves assertion-expiry versus session-expiry policy undecided.

   The replay taxonomy also says provider key/nonce binding is the only mechanism making exchange replay-resistant, immediately before acknowledging `jti` single-use tracking. These protect different things:

   - provider-signed key confirmation can establish control of a bound key;
   - nonce or `jti` consumption can enforce freshness/single use but does not prevent a stolen bearer from winning first use;
   - LLP 0077 binds only the newly issued Snapback family.

   Replace the affected prose, move `providerNotAfterClamp` into a retained-authorization capability, and record the provider not-after source in derived-session provenance so later lease issuance can populate it. Add acceptance coverage for duplicate `jti`, nonce reuse, copied-bearer first-use, and downstream expiry policy.

3. **MATERIAL — Installation and organization cardinalities remain internally inconsistent.**

   §Terms and the exchange use `(provider installation, issuer, subject)` ([0153:117](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:117), [0153:447](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:447)), correctly reflecting [LLP 0151's immutable installation binding](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:402). §Account linking then reverts to "`(issuer, subject)` is authoritative" at [0153:825](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:825).

   The identity-link row also stores "upstream tenant/org context" at [0153:522](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:522), while §Organizations correctly describes the active organization as session context. WorkOS, for example, places the selected organization in the access token and changes it through refresh, so concurrent sessions can carry different organizations ([WorkOS sessions](https://workos.com/docs/authkit/sessions)).

   Keep immutable installation tenant/team binding on installation state; place active organization evidence on derived-session provenance; keep mirrored memberships in their own protected/app-owned relation. Make §Account linking use the full scoped key.

4. **MATERIAL — Native/sender qualification did not reach the support levels, acceptance gates, or product promise.**

   The client-bridge and adoption sections are correct, but displaced text still says Model B "preserves sender constraint" without surface scope ([0153:235](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:235)), makes sender-constrained exchange universal Level 0 ([0153:927](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:927), names Clerk a strong Expo fit under paved Level 1, and requires LLP 0077 binding without per-surface qualification in the acceptance table ([0153:1048](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:1048)).

   LLP 0096 permits native ordinary-bearer custody only against non-sender-bound deployments and explicitly denies native access to sender-constrained deployments ([LLP 0096:630](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:630)).

   Qualify the Level 0 and acceptance rows per surface/deployment posture, require a support-level matrix rather than one provider-wide claim, and narrow the bottom-line security promise accordingly. Also change "tiers above" at [0153:1120](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:1120) to "support levels above."

5. **MATERIAL — The provider-table provenance note does not actually make the table traceable.**

   [0153:326](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:326) declares the token/value/work cells `[observed]` "at those anchors," but rows such as Firebase, Cognito, Supabase, Stytch, Descope, and Better Auth contain token/JWKS/session facts with no corresponding per-provider anchor in LLP 0153.

   LLP 0152's matrix covers mechanisms, federation, MFA, passkeys, and configuration ([LLP 0152:151](/Users/ccheever/projects/snapback/llp/0152-sign-in-integration-landscape.research.md:151)); it does not substantiate many of LLP 0153's exchange-token details. A general pointer to LLP 0152 therefore does not resolve round-1 finding 10.

   Add compact row-level source footnotes for the token and quirk claims, or narrow the cells to claims actually supported by existing anchors. Keep the Recommendation column labeled inference.

## Suggestions

- Make these corrections by replacing existing sentences and table cells. No additional explanatory section is needed.
- Change the obsolete open question at [0153:1062](/Users/ccheever/projects/snapback/llp/0153-external-ciam-integration-landscape.research.md:1062) into the genuinely open question: which named profiles provide upstream key confirmation or challenge freshness, and what theft/replay guarantee does each provide?

## Open questions

The document should continue carrying:

- the normative owner and LLP 0031 route classification for external exchange;
- whether external assertion expiry caps the downstream session or only retained authorization;
- which providers offer true upstream key confirmation versus only nonce/`jti` single use;
- the ownership and cardinality of mirrored membership state;
- provider-installation migration and retained-state lifecycle semantics.

## Recommended next step

Revise and remain **Draft** until the five findings above are applied. No third broad super-refine round is genuinely required: these are bounded corpus-alignment and displaced-text corrections that can ride the landing commit, provided the two BLOCKING repairs receive a focused check against the cited LLP lines.

The read-only workspace prevented appending this round to the existing Codex review artifact; if archived, it should be added as a dated round-2 section, not overwrite round 1.
