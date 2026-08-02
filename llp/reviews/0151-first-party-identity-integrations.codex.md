# LLP 0151 first-party identity integrations review — Codex family

## Round 1 — 2026-08-02

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Method:** fresh non-author `codex exec` context, read-only sandbox over the
working tree; dual-role engagement per the round-1 capsule — Part 1
first-class design input (Charlie's explicit direction for this loop) plus
Part 2 review at the standing READY bar; mutually blind — instructed not to
read any `llp/reviews/` artifact concerning LLP 0151 nor any 0151
super-refine journal, and verified after the fact not to have done so (the
transcript's `llp/reviews/` occurrences are the capsule's own prohibition,
the repo llp-review skill text it loaded, a filename-only directory listing
containing no 0151 artifact — none existed — and incidental body-text
mentions inside LLP 0000/0143). SHA-pinned target and instruction capsule.
**Instruction capsule SHA-256:** `727b73e0d50304fb8f6f99b179b3345a8a271f517291aea5d7e81ca2b477d970`
**Target:** `llp/0151-first-party-identity-integrations.rfc.md` (v0.1, 357 lines, Draft)
**Target SHA-256:** `cea4ee0a339eb59cf504d76ab1c662e6ab1cd5c929aec39d936a70ac985eb71f`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Status:** completed
**Verdict:** NOT READY (1 BLOCKING, 7 MATERIAL, 5 DETAIL, plus Part 1 design
positions incl. author-decision challenges on SMS tier placement and Expo's
unconditional tier-1 status)

**Orchestrator verification note.** The review's markdown-link *filenames*
for several corpus documents are wrong (e.g. `0045-durable-notifications`,
`0011-authentication-and-authorization`, `0031-route-taxonomy`,
`0093-hosted-local-conformance`, `0036-secrets-and-configuration` — the
actual files are `0045-notifications-outbox`, `0011-auth-and-permissions`,
`0031-server-route-taxonomy`, `0093-client-protocol-and-native-clients`,
`0036-app-secrets-and-config`), but the line anchors and substance were
checked by the orchestrator against the real files and **held in every
sampled case**: LLP 0031 is the route-taxonomy/authority spec whose registry
keeps auth-provider routes outside the reserved `/_snapback/*` system
namespace; LLP 0069 is the payment-provider-boundary owner; the ratified
user-switch full wipe sits at `llp/0011:578-590`; `src/auth/provider.rs`
implements a bounded in-process capture mailbox ("production refuses until
LLP 0045 supplies a human-delivery adapter", `src/auth/provider.rs:2324-2327`)
rather than console printing; LLP 0045 forbids plaintext auth codes as
durable intents with LLP 0057 as the implementing delegate
(`llp/0045:24-29`); and LLP 0093 uses "arm" for hosted-vs-local deployment
(`llp/0093:59-60`) with client surfaces owned by LLP 0064. External claims
(TN3159 transfer identifiers incl. relay addresses, Guideline 4.8
equivalent-option framing with exceptions, conditional `form_post`, Discord
OAuth2-not-OIDC, GitHub redirect host/path matching, RFC 7591/8252/9700,
NIST SP 800-63B password screening and restricted-PSTN posture) are
consistent with the orchestrator's pinned primary sources and knowledge.

## Verbatim review

# LLP 0151 — round 1 (design input + review)

## Part 1 — Design input

### 1. What to support

The RFC should distinguish three things more sharply:

1. Identity providers: Google, Apple, GitHub, Expo, generic OIDC.
2. Authenticators: passwords, passkeys, email/SMS possession proofs.
3. Account lifecycle: linking, unlinking, recovery, guest conversion, session revocation, and identity changes.

The third category is currently underdeveloped and is at least as important as adding providers.

| Capability | Recommendation |
|---|---|
| Email OTP and magic link | Tier 1 as one email-challenge system with two presentation modes. |
| Guest/anonymous | Tier 1, with explicit collision, switching, retention, and cleanup semantics. |
| Passkeys | Tier 1 only after an immutable RP-ID policy and recovery path exist. |
| Username/password | Tier 1 only with blocklist checking, throttling, reset/recovery, session rotation, and last-authenticator protection. Password blocklist checking is a current baseline, not a Tier-2 enhancement. [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/) requires checking new passwords against commonly used or compromised values. |
| SMS OTP | Tier 2 initially; promote after abuse, spend, regional delivery, recycling, recovery, and vendor-failure behavior have been demonstrated. |
| Recovery codes | Tier 1 infrastructure, particularly for passkeys and passwordless accounts. |
| TOTP | Tier 2, built on the same authenticator and recovery lifecycle. |

**Author-decision challenge — SMS OTP as Tier 1.** SMS is valuable and deserves a first-party seam, but it is not "near-zero configuration." It introduces paid infrastructure, fraud and spend exposure, recycled numbers, SIM-swap risk, country restrictions, sender registration, and deliverability variance. NIST treats PSTN out-of-band authentication as restricted and requires an alternative authenticator. I would make SMS a first-party Tier-2 integration with a defined promotion checklist, rather than weakening the meaning of Tier 1.

For providers:

- Google, Apple, and GitHub are the right initial named providers.
- Add Microsoft Entra ID as a named Tier-2 profile. It is too important in real applications to leave only as "generic OIDC," and its tenant-selection behavior deserves explicit handling.
- Keep arbitrary OIDC at Tier 2.
- Treat Discord as a future bespoke OAuth2 adapter, not an example of something generic OIDC already supports. Discord documents OAuth2 scopes such as `identify`, but not OIDC discovery or ID tokens. [Discord OAuth2 documentation](https://docs.discord.com/developers/platform/oauth2-and-permissions)
- Facebook can remain landscape-only until demand justifies its policy and SDK surface.

**Author-decision challenge — Expo as an unconditional Tier-1 provider.** Expo is a reasonable strategic member of the intended provider set, but the RFC says its end-user OIDC capability is not yet established. A provider without a verified issuer, claims contract, registration path, and acceptance fixture cannot presently meet the RFC's own Tier-1 definition. Record Expo as "Tier-1 target, GAP pending provider contract" until those prerequisites exist.

### 2. Credential ownership / broker

Production should default to app-owned provider registrations and credentials. I would replace the A/B/C framing with:

- **Production default — owner-owned registration:** Each app owner controls the OAuth client, consent brand, redirect registration, and provider relationship.
- **Registration automation:** Snapback or Expo automates creation and configuration where provider APIs or dynamic client registration permit it, then writes public configuration and secret references into the app's deployment configuration. OAuth dynamic client registration is already a standardized control-plane model. [RFC 7591](https://www.rfc-editor.org/rfc/rfc7591.html)
- **Guided registration:** Where automation is impossible, generated instructions and validation make BYO setup deterministic.
- **Preview broker:** An Expo-operated shared broker may be offered for development or preview, with explicit branding and limits. It should not be the default production identity plane.

This is effectively Option A plus a new **Option D: registration automation without authentication brokering**.

The broker should be registration-only. A broker in the authorization or token path can observe identity tokens, impersonate applications, correlate users across apps, and become an availability and compromise boundary for every participating application. Making that broker self-hostable reduces lock-in but does not remove the trust expansion.

If a token-path broker is retained as an optional convenience, it should:

- Exchange provider tokens itself and discard them.
- Return only a short-lived, one-use Snapback assertion bound to audience, nonce, app, and initiating device/session.
- Use a broker-specific issuer namespace so brokered identities cannot silently collide with direct-provider identities.
- Be labeled as a separate federated identity provider, not an invisible transport optimization.

The draft understates registration-only brokering when it says it forfeits the fixed-callback benefit. It forfeits one globally shared client registration, but automation can still register a stable per-app callback. That is the desirable trust boundary.

Apple should use per-app registrations where possible. Apple has an official transfer-identifier protocol for migrating Sign in with Apple users and relay addresses when an app changes teams; the RFC's assumption that migration necessarily reduces to email relinking is incomplete. [Apple TN3159](https://developer.apple.com/documentation/technotes/tn3159-migrating-sign-in-with-apple-users-for-an-app-transfer?changes=_10)

### 3. Architecture and sequencing

"Generic OIDC substrate + named profiles + bespoke GitHub adapter" is the correct basic shape, with one qualification: Apple needs an executable provider adapter/profile, not just static preset data. Its client-secret JWT, `form_post` behavior, first-authorization user payload, private-relay behavior, and transfer operations are provider logic.

I would build in this order:

1. Define the provider-independent verified-identity result, authenticator model, provider-installation namespace, and transactional link/collision API.
2. Define the authorization transaction: state, nonce, PKCE verifier, issuer binding, return target, expiry, and one-time session completion.
3. Add a synthetic OIDC test issuer and adversarial fixtures for issuer mix-up, JWKS rotation, bad audience, replay, and redirect manipulation.
4. Use the existing email-code provider to prove guest claim, collision, linking, switching, session rotation, and recovery semantics.
5. Ship Google OIDC.
6. Ship GitHub's OAuth2 plus API adapter.
7. Ship Apple alongside the first iOS social-login demo.
8. Add passkeys once the RP-ID contract is fixed.
9. Add password authentication with its complete security baseline.
10. Add SMS after its delivery and abuse-control seam is proven.
11. Add Expo once its end-user provider contract is verifiable.

The OIDC substrate must explicitly validate `iss`, `sub`, `aud`, `azp` where applicable, nonce, expiry, signature algorithm policy, discovery issuer equality, and JWKS rotation. PKCE, state, authorization-server mix-up protection, and exact return-target allowlisting belong in the protocol definition, not just implementation notes. [OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html), [OAuth 2.0 Security BCP](https://www.rfc-editor.org/rfc/rfc9700.html)

### 4. Hard sub-designs

**Guest → account**

Use an explicit state machine:

- A new identity with no collision attaches to the same guest principal atomically.
- A collision does not merge or switch implicitly. It returns a typed, post-proof collision result plus a short-lived capability bound to the guest principal, existing principal, proof, and initiating session.
- `switch_existing` performs the LLP 0011 user-switch fence: rotate the claiming session, revoke or invalidate other guest sessions, and cause a complete client-side wipe before exposing existing-account data.
- `merge` is separately authorized and invokes an app-supplied, deterministic data-migration handler. The handler must not perform external side effects.
- Guest data is retained in quarantine under an explicit TTL after switching; it is not casually described as "abandoned." Cleanup must account for arbitrary app rows referencing the guest principal.
- The account must never be allowed to unlink its last usable authenticator.

**Passkey RP ID**

Make `auth.rpId` immutable after the first credential is registered. Production passkeys should require a durable app-controlled domain. Generated-domain apps can experiment with passkeys, but the UI must disclose that credentials are tied to that RP ID.

WebAuthn related-origin support can allow multiple origins to share one existing RP ID, provided the RP-ID domain continues serving the required well-known declaration. It does not migrate credentials to a new RP ID and therefore cannot promise independence from an old platform-controlled domain. [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)

Native clients should use the same durable web RP ID through the appropriate platform association mechanism rather than inventing a native-only identity namespace.

**SMS vendor seam**

Do not route authentication challenges through the durable LLP 0045 notification outbox. Define an ephemeral `AuthChallengeDelivery` interface whose durable record contains only a keyed digest, expiry, attempt counters, delivery metadata, and idempotency identity. Plaintext should exist only at the final send boundary.

Start with one messaging transport, such as Twilio Messaging. A managed verification product such as Twilio Verify is a different semantic adapter because the vendor becomes the challenge source of truth.

The seam needs E.164 normalization, templates and locale, per-number/source/prefix/IP limits, country allowlists, global spend caps, idempotency, delivery-status normalization, failover policy, and secret-safe telemetry.

**Configuration and secrets**

The main ownership split is already established by LLP 0036:

- Provider declarations, issuer selection, client IDs, scopes, and secret-reference names belong in generated app configuration or manifests.
- Secret values belong in per-app deployment state, never generated source, bundles, exports, or logs.
- Provider enablement must fail closed when its required generation of configuration is absent.

The remaining design question is narrower: auth providers need a privileged system-service secret-consumption capability, because LLP 0036 currently describes secret use primarily for actions. The RFC should specify that extension rather than reopening the entire storage question.

### 5. What the draft missed

The largest missing concept is a first-class distinction between identities and authenticators.

- `_auth_identities` should represent external subjects or verified identifiers.
- Password hashes, passkey public keys and counters, TOTP seeds, and recovery-code state belong in an `_auth_credentials`-like relation.
- OIDC identity is canonically `(issuer, subject)`, not merely an unconstrained `(provider_key, subject)`. A provider installation must bind its key immutably to issuer, tenant/team, and client ownership.

Other material omissions:

- A complete OAuth callback-to-Snapback-session handoff for browser and native clients.
- One-time completion codes so Snapback bearer tokens and provider tokens never travel in redirect URLs.
- Return-target allowlisting and native universal/app-link behavior. Native OAuth should use an external user agent and PKCE. [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html)
- Change-email and change-phone flows.
- Link, unlink, last-authenticator, reauthentication, and step-up rules.
- Provider revocation and account-deletion behavior.
- Explicit policy that sign-in-only adapters discard provider access and refresh tokens.
- Audit events for identity link, unlink, collision, merge, recovery, and provider reconfiguration.
- Abuse budgets covering email, SMS, password guessing, OAuth transaction creation, and account enumeration.
- Separate acceptance matrices for deployment arms and client surfaces.

## Part 2 — Review

## Overall assessment

The required SHA-256 matched exactly:

`cea4ee0a339eb59cf504d76ab1c662e6ab1cd5c929aec39d936a70ac985eb71f`

The reviewed target is the untracked 357-line v0.1 Draft at `main` revision `67628399`. The central direction is sound: it preserves LLP 0011's principal/identity approach, maintains the LLP 0106 and LLP 0150 identity-plane separation, and chooses a sensible OIDC-plus-adapters architecture.

External-claim confidence:

- **Apple team-scoped subject:** high confidence, but migration analysis is incomplete because Apple supplies transfer identifiers. Apple describes the user identifier as stable within a developer team. [Apple identity-token documentation](https://developer.apple.com/documentation/signinwithapple/receiving-a-users-identity-token?changes=_3)
- **App Store login-services rule:** high confidence that Guideline 4.8 exists; high confidence the draft overstates it as an unconditional Apple-login requirement because Apple lists several exceptions and formally requires an equivalent privacy-preserving option. [App Review Guidelines §4.8](https://developer.apple.com/app-store/review/guidelines/)
- **Google `sub` stability:** high confidence and accurately stated. Google says `sub` is unique among Google accounts and never reused. [Google OIDC documentation](https://developers.google.com/identity/openid-connect/openid-connect)
- **Apple `form_post`:** high confidence but conditional: Apple requires it when scopes are requested, not for every authorization request. [Apple authorization-request documentation](https://developer.apple.com/documentation/signinwithapplerestapi/request-an-authorization-to-the-sign-in-with-apple-server.)
- **Redirect rules:** high confidence that Google forbids wildcard redirect URIs; low confidence in the draft's universal "exact for every provider" formulation because GitHub permits defined host/path matching behavior. [Google OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server), [GitHub OAuth authorization documentation](https://docs.github.com/en/enterprise-cloud%40latest/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- **GitHub numeric ID stability:** high confidence and accurately stated. [GitHub OAuth best practices](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app)
- **Passkey RP-ID non-migration:** high confidence, with the related-origins qualification described above.

## Findings

### BLOCKING — The RFC does not define the OAuth-to-Snapback session completion protocol

Anchors: LLP 0151:171, 176, 192, 325.

The draft names discovery, JWKS, code exchange, PKCE, and claim normalization, but never specifies:

- Authorization-transaction storage and expiry.
- State, nonce, issuer, and initiating-client binding.
- Mix-up and callback replay defenses.
- Browser versus native return handling.
- How a verified identity becomes a Snapback bearer session.
- Whether a bearer token, authorization code, or provider token crosses the redirect.
- One-use redemption, cancellation, and retry semantics.

This cannot safely be deferred to implementation because Snapback's existing auth surface is bearer-token based, while native OAuth requires an external browser and redirect back into the application. LLP 0039's provider state machine is detailed precisely enough to prevent equivalent ambiguity for email-code auth. OAuth needs the same treatment.

The RFC should define a server-side transaction plus a short-lived, one-use completion code bound to the initiating client/session and exact return target. No provider token or Snapback bearer token should appear in a redirect URL.

### MATERIAL — Authentication challenges are assigned to the wrong delivery boundary

Anchors: LLP 0151:79, 109, 127; evidence at LLP 0045:24, 76, and `src/auth/provider.rs:2324`.

The draft correctly repeats that plaintext challenges must not enter durable intents, but then says email and SMS delivery "goes through" or "rides" the LLP 0045 outbox. LLP 0045 explicitly places authentication challenges outside the durable notification outbox pending an ephemeral-handle design.

The current `email-code` provider also uses a bounded in-process capture mailbox; it does not establish durable outbox delivery. The RFC should define a neighboring ephemeral delivery interface and say whether LLP 0045 later owns only transport adapters.

### MATERIAL — Guest collision behavior contradicts LLP 0011 while claiming not to reopen it

Anchors: LLP 0151:65, 158, 162; evidence at LLP 0011:485, 496, and 582.

LLP 0011 says a collision is refused with a typed result, automatic merge is out of scope, guest claiming rotates/revokes sessions, and principal switching requires a complete client wipe. LLP 0151 instead proposes "continue as the existing account" by default and treats guest data as abandoned, without carrying forward those session and wipe requirements.

Either align with LLP 0011's existing transition or explicitly reopen and amend it. The current text cannot claim both that the auth model is unchanged and that this new default is settled.

### MATERIAL — Identity and authenticator storage are conflated

Anchors: LLP 0151:115, 138, 189, 237.

A passkey credential ID and public key, a password hash, and an OIDC subject have materially different uniqueness, rotation, revocation, and recovery behavior. The RFC currently implies they can all be represented through `_auth_identities`.

OIDC also defines subject uniqueness relative to an issuer. `provider_key` is adequate only if its immutable binding to issuer, tenant/team, and registration ownership is specified. Without that rule, reconfiguring a preset could silently reinterpret existing rows.

Define the identity/credential split and provider-installation namespace before treating the model as implementation-ready.

### MATERIAL — The callback route conflicts with the repository's route taxonomy

Anchor: LLP 0151:192; evidence at LLP 0031:93, 127, 298, and LLP 0093:737.

LLP 0031 reserves `/_snapback/*` for system operations while auth-provider entry points remain app-data routes under `/auth/*`. LLP 0093's hosted-root migration does not move every auth route into the reserved namespace.

The RFC needs to decide whether OAuth callbacks are app-data auth routes under `/auth/*` or genuinely new system operations and, in the latter case, explicitly amend LLP 0031.

### MATERIAL — Provider configuration ownership is treated as open despite LLP 0036

Anchor: LLP 0151:355; evidence at LLP 0036:148, 190, 293, and 562.

LLP 0036 already assigns provider declarations to generated app configuration and credential values to non-exportable per-app deployment state. What remains open is how the auth system service consumes those secret generations, since the current capability is action-oriented.

Restate the settled ownership boundary and identify the required auth-system extension. Leaving the whole subject open creates false corpus ambiguity.

### MATERIAL — Tier-1 acceptance confuses deployment arms with client surfaces

Anchors: LLP 0151:89, 325; evidence at LLP 0093:55, 399, LLP 0064:15, and LLP 0061:363.

In LLP 0093, an "arm" is hosted versus local deployment, not React, Expo, Exact Native, or protocol-native client support. Those are client surfaces governed by LLP 0064.

The acceptance section also says every Tier-1 row needs an adapter and named preset, which does not fit passwords, guest sessions, or passkeys. Define two matrices:

- Mechanism/provider × local/hosted deployment arm.
- Mechanism/provider × supported client surface.

Every Tier-1 claim should have explicit guide, fixture, demo, and capability-index witnesses.

### MATERIAL — Apple policy and migration claims materially distort sequencing and broker evaluation

Anchors: LLP 0151:207, 209, 233, 276.

Guideline 4.8 is real, but it has explicit exceptions and requires an equivalent privacy-preserving login rather than universally mandating Sign in with Apple. The statement that Apple must land whenever an iOS app ships any social login is therefore too categorical.

The credential analysis also omits Apple's supported app-transfer migration using transfer identifiers. This does not make a shared broker simple, but it materially changes the comparison between per-app registrations, shared registrations, and graduation paths.

### DETAIL — Discord is incorrectly presented as generic OIDC-compatible

Anchor: LLP 0151:185.

Discord documents OAuth2 authorization and REST identity lookup, not the discovery, ID-token, and issuer contract required by the proposed generic OIDC substrate. Move it to the bespoke OAuth2-adapter landscape beside GitHub.

### DETAIL — Redirect registration is not universally exact

Anchors: LLP 0151:261, 272.

Google's exact, no-wildcard rule is accurately described. GitHub instead applies documented host, port, and path rules when `redirect_uri` is supplied. State the conservative Snapback policy as "Snapback registers and emits exact callback URIs even where a provider accepts broader matching," rather than attributing exact matching to every provider.

### DETAIL — Apple `form_post` is conditional

Anchor: LLP 0151:204.

Apple requires `form_post` when scopes are requested. Rephrase the quirk accordingly; it is not unconditional for every authorization request.

### DETAIL — The development email target is not a console-printing mailbox

Anchor: LLP 0151:109; evidence at `src/auth/provider.rs:104`.

The current provider captures challenges in a bounded in-process development mailbox exposed through privileged tooling. Calling that "prints to a console mailbox" inaccurately describes the implemented boundary.

### DETAIL — The payments scope citation points to the wrong governing LLP

Anchor: LLP 0151:323.

LLP 0106 governs the Expo developer control plane and billing separation. Application payment-provider integration is governed more directly by LLP 0069. The non-goal is correct; its ownership citation should be corrected.

## Verdict

**NOT READY** — The strategic direction is strong and the provider landscape is well scoped, but the missing OAuth session-completion protocol is blocking. Guest transitions, challenge delivery, routing, secret ownership, identity storage, and acceptance axes also conflict with existing LLP boundaries. These are design-document corrections rather than evidence that the architecture is unsound; resolving them should put the RFC within one focused refinement round of READY.

## Round 2 — 2026-08-02

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Method:** delta-scoped round over the 19 enumerated v0.2 change sites;
family-conditioned blindness — own round-1 artifact allowed, Fable artifact
and journal prohibited; v0.2's in-document attribution of Fable positions
was the only cross-family surface. Read-only; target hash verified before
and after review.
**Instruction capsule SHA-256:** `4a1f6d7bafcf822dd34fb90d61410fb373c8de0d637c819654a264208dc8e64c`
**Target:** `llp/0151-first-party-identity-integrations.rfc.md` (v0.2, 696 lines, Draft)
**Target SHA-256:** `83f5e744b9319090420a5932316b8974fd2819b03d6b283c85cd13a72876a5ab`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Status:** completed
**Verdict:** NOT READY (substantial margin; 1 BLOCKING — round-1 blocker
judged displaced, not closed — 7 MATERIAL, 3 DETAIL. Part 1: synthesis of
Codex round-1 positions verified mostly faithful with two qualifications
(passkey position weakened; completion-blocker "applied" overclaimed);
**production recommendation unchanged and now convergent with Fable's
round-2 movement — Option D now, C deferred/optional/preview-first**; the
brokered-Google three-way identity contradiction identified as the item
demanding a single answer)

**Orchestrator verification note.** Key round-2 claims verified before
application: LLP 0039's `/auth/exchange` "issues session credential"
(`llp/0039:1406`; bearer `sbs_` sessions at `llp/0039:786-790`) — the v0.2
"lease machinery" attribution was indeed wrong; LLP 0104 keeps
notification-provider costs as internal shadow meters
(`llp/0104:200-214`); the GitHub App Manifest flow creates GitHub Apps
(not OAuth Apps) and returns private key + webhook secret alongside client
credentials (pinned to docs.github.com in v0.3); the WebAuthn L3
"at least five labels" floor correction accepted over v0.2's "~5-label
cap." The three-way brokered-Google contradiction and the annotation
non-propagation were verified directly against the v0.2 text.

## Verbatim review

# LLP 0151 — round 2

Target integrity verified before and after review: 696 lines, SHA-256 `83f5e744b9319090420a5932316b8974fd2819b03d6b283c85cd13a72876a5ab`. Read-only review; no files were changed.

## Part 1 — Design input, continued

### Fidelity check

The synthesis is mostly faithful to my round-1 input. It accurately carries forward:

- The providers/authenticators/lifecycle split.
- Option A + D as my credential-ownership recommendation.
- The concerns with a token-path broker and the safeguards required if one exists.
- The identity/credential storage split and immutable provider-installation binding.
- The provider architecture, sequencing, synthetic IdP, and adversarial fixtures.
- SMS’s tier-2 challenge, Expo’s GAP status, password baseline, guest collision rules, and OAuth completion requirements.

Two qualifications:

1. **The passkey synthesis weakens my position.** My round-1 recommendation required an app-controlled durable domain for production and treated generated-domain passkeys as experimental with a disclosed tether ([Codex round 1, lines 147–153](/Users/ccheever/projects/snapback/llp/reviews/0151-first-party-identity-integrations.codex.md:147)). V0.2 instead makes the generated subdomain the ordinary RP ID and presents Related Origin Requests as the continuity mechanism ([0151, lines 253–272](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:253)). That preserves my non-migration caveat but drops the production app-owned-domain requirement.

2. **“All 13 Codex findings applied” overclaims the completion result.** The new section adopts the right components, but the round-1 blocker is only partially resolved; see the BLOCKING finding below.

My SMS position is represented faithfully. The document’s account of the other family is internally inconsistent: §SMS says they proposed the external-prerequisite annotation, while §Open questions describes “both families’ tier-2 challenges.” I cannot adjudicate their artifact under the blindness rule, but those two in-document statements cannot both be the precise attribution.

### Cross-family engagement: Google residual

The constrained Option C argument improves C materially. App-generated PKCE, original-token verification by the per-app Snapback instance, no broker-issued session, no durable identity store, and a self-hostable protocol reduce the broker from an identity authority to a token-exchange and availability boundary.

It does **not** change my production recommendation:

- Choose **Option D—guided app-owned registration—as the production paved path**.
- If funnel evidence later justifies C, offer it as an explicitly separate brokered Google identity mode, initially preview-only.
- Do not describe C as invisible transport or promise transparent graduation until the identity namespace is settled.

C still retains consent-brand leakage, shared suspension/rate-limit fate, cross-app correlation, and availability coupling. More importantly, the stated C and Codex safeguards do not presently compose: verifying the original Google ID token means its issuer remains Google, whereas a broker-specific issuer means accepting a broker assertion—which the attributed C position forbids. That contradiction needs a single answer.

My recommendation to Charlie is therefore: **D now; C deferred and optional, contingent on measured need and a separate protocol/identity-migration decision.**

### New lifecycle and completion content

The lifecycle section’s structural direction is strong: separate credentials, canonical issuer/subject identity, token discard, last-authenticator protection, recovery codes, audit events, and abuse budgets are the right foundation.

It is not yet a lifecycle protocol. Link/unlink, identifier replacement, recovery, revocation, deletion, and guest merge still need transition proofs, reauthentication rules, notifications, session consequences, failure atomicity, and recovery assurance. I would commission a lifecycle implementing spec alongside the completion spec.

The completion direction is likewise correct—server transaction, one-use completion artifact, no provider or Snapback bearer in redirects—but it still needs distinct browser/confidential-client, native public-client/native-SDK, and local-arm profiles.

## Part 2 — Delta review

### BLOCKING — OAuth completion remains incomplete across native and local paths

Anchors: [0151, lines 399–419](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:399), lines 459–470, and lines 647–665; [LLP 0039, lines 763–810](/Users/ccheever/projects/snapback/llp/0039-auth-vertical-slice.rfc.md:763).

“Through LLP 0039’s existing lease machinery” names machinery that does not exist for session issuance. LLP 0039’s provider exchange directly creates a session credential; its leases concern admin secret reads, connection validity, or retained authorization.

The new text also stores an initiating-client binding without specifying what the redeemer must prove. If the completion code crosses the app return URL, it is otherwise an intercepted bearer; if it does not cross that URL, its transport is unspecified. The exchange needs a client-generated second secret or another explicit sender constraint. RFC 9700 requires transaction-specific PKCE/nonce binding to the client and user agent, while RFC 8252 describes the native app generating and retaining the verifier. [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html), [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html).

Finally, Apple native authorization and Google per-platform client IDs return credentials to the native app, while the stated protocol assumes a server callback followed by an app return. The local arm also cannot assume its callback server is publicly reachable from an external provider.

Resolution requires the RFC—not merely the future spec—to pin:

- Server-callback browser flow.
- Native SDK/public-client credential handoff.
- Sender-constrained completion redemption.
- The real-provider local-arm callback strategy.
- The new completion route’s credential and response classification in LLP 0031.

The round-1 blocker has been displaced, not fully closed.

### MATERIAL — Brokered Google has mutually incompatible identity rules

Anchors: [0151, lines 315–329](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:315), lines 462–470, and lines 604–629.

The RFC currently claims all three:

- Google identity is canonical Google `(issuer, sub)`, so broker-to-BYO migration preserves it.
- Brokered identities use a distinct broker issuer namespace.
- The constrained broker must not assert identity; the app verifies Google’s original JWT.

Only two can hold. Original-token verification yields Google’s issuer. A broker issuer requires a broker-signed assertion. A separate namespace means graduation requires an explicit re-link/migration rather than automatically preserving identity.

Choose either transparent Google-token relay with installation/audience metadata and a controlled client-ownership migration, or a separate broker IdP with explicit re-linking.

### MATERIAL — The passkey synthesis introduces the forbidden tether

Anchors: [0151, lines 64–70](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:64) and lines 253–272.

A custom origin using the generated-domain RP ID depends on that generated domain continuing to serve `/.well-known/webauthn`. That is a continuing Expo-controlled sign-in dependency, even though the document correctly admits that credentials never become independent of the old RP ID.

Restore the app-controlled-domain requirement for production tier 1, or explicitly record generated-domain passkeys as a tethered preview exception requiring Charlie’s decision.

There is also a factual correction: WebAuthn Level 3 requires clients supporting Related Origin Requests to support **at least five** registrable-origin labels and permits client policy to set a higher limit; it does not specify a universal “~5-label cap.” [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/).

### MATERIAL — Lifecycle rules are obligations without settled transitions

Anchor: [0151, lines 331–355](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:331).

The section does not yet define:

- Recent-authentication requirements for link, unlink, change-email, change-phone, or recovery.
- Which transitions revoke or rotate sessions and which notify old/new identifiers.
- Recovery-code issuance, hashing, one-use consumption, replacement, and recovery notification.
- Provider-revocation versus account-deletion state transitions.
- How “last usable authenticator” is computed from separate identities and credentials.

“Email OTP is the universal recovery anchor” also conflicts with the immediately following email-less account case. Recovery codes should be mandatory for accounts lacking an independently recoverable authenticator, not for every broadly “passwordless” account.

### MATERIAL — Guest switch/merge still lacks safe failure and cleanup semantics

Anchors: [0151, lines 288–313](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:288) and lines 684–686.

Freeze-then-chunked-migrate avoids the database-lock problem but introduces partial migration. The RFC does not specify checkpoints, idempotent retry, abort behavior, visibility during migration, or what happens when the handler version changes.

The default switch path later “reaps” a guest despite arbitrary app rows referring to it. Snapback cannot generically know whether those rows should move, delete, remain tombstoned, or be retained. Pin an app-owned cleanup contract or durable tombstone policy before claiming switch/merge in acceptance.

### MATERIAL — The external-prerequisite tier is not consistently applied

Anchors: [0151, lines 148–169](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:148), lines 177–189, and lines 357–481.

The class explicitly includes OAuth-console registration, yet only SMS is labeled with it. Production email needs a mail vendor, while Google, Apple, and GitHub all require external registration. Consequently, the provider tier headings do not distinguish hermetic completion from production readiness.

Apply the annotation per row: email, Google, Apple, GitHub, and SMS. Keep Expo as GAP pending its provider contract.

### MATERIAL — The password floor contradicts its own recovery package

Anchor: [0151, lines 191–203](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:191).

Password is called the only zero-external-dependency production mechanism, but its mandatory package includes an email reset flow. Preserve the zero-vendor floor with preissued recovery codes or explicitly describe email reset as an external-prerequisite option.

Calling the list an SP 800-63B baseline also overclaims it: current NIST guidance includes, among other requirements, a 15-character minimum for single-factor passwords, password blocklist checking, and detailed verifier/rate-limit rules. [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/). Username canonicalization, uniqueness, case behavior, rename, and non-enumerating lookup are also absent.

### MATERIAL — The GitHub paved path has not selected its registration product precisely

Anchors: [0151, lines 359–383](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:359), lines 473–481, and lines 576–602.

GitHub’s App Manifest creates a **GitHub App**, not an OAuth App. A GitHub App can implement “Login with GitHub” using an OAuth web flow, so the direction is viable, but the RFC currently mixes OAuth-App redirect claims with GitHub-App registration automation.

Pin GitHub App as the product, its email permission and callback behavior, and which manifest-returned credentials are retained or discarded. The manifest returns a private key and webhook secret as well as client credentials; sign-in-only support should not accidentally enlarge its secret footprint. [GitHub App Manifest documentation](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest), [Login with a GitHub App](https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-a-login-with-github-button-with-a-github-app).

### DETAIL — SMS family attribution is internally inconsistent

Anchors: [0151, lines 207–217](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:207) and lines 673–675.

One passage attributes the external-prerequisite annotation to the other family; another attributes a tier-2 challenge to both. Preserve my tier-2 recommendation and use one accurate statement for the other family.

### DETAIL — SMS metering overstates LLP 0104

Anchor: [0151, lines 223–240](/Users/ccheever/projects/snapback/llp/0151-first-party-identity-integrations.rfc.md:223); [LLP 0104, lines 200–214](/Users/ccheever/projects/snapback/llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:200).

LLP 0104 currently makes notification-provider costs internal shadow meters and says provider meters remain internal initially. Replace “per-message cost surfaces through LLP 0104” with “shadow-metered internally”; any customer-facing SMS price requires an explicit 0104 amendment. The WhatsApp cheaper/higher-deliverability assertion should also receive the market/region qualification used elsewhere.

### DETAIL — External evidence anchors remain too broad

Anchors: lines 361–365, 438–471, and 549–555.

Labels such as `[confirmed — developer.apple.com]` are not durable enough for exact policy and protocol claims. Add direct primary-source links or named document/section references. The Apple and Google claims spot-checked successfully; the Related Origin Requests interpretation did not.

## Verdict

**NOT READY — by a substantial margin.**

The revision genuinely resolves most round-1 corpus-boundary and factual findings, but the OAuth completion blocker remains, and the new passkey, broker-identity, lifecycle, guest-migration, tier, password, and GitHub text contains issues that another no-new-evidence refinement can fix. The strategic architecture remains sound; the protocol cuts and production trust boundaries are not yet settled enough for READY.