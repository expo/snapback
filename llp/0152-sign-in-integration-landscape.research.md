# LLP 0152: Sign-in integration landscape and lessons

**Type:** Research
**Status:** Draft
**Systems:** Auth, Identity providers, Client integration, Developer experience, Security, Configuration, Hosted delivery, Competitive analysis
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-02
**Revised:** 2026-08-02 (decision-sitting propagation: OQ14 is answered —
external CIAM is a sibling paved path governed by LLP 0153's provider class,
while LLP 0151 remains first-party-focused; the same sitting moves SMS OTP to
tier 2 in LLP 0151. Source: `issues/20260802-author-decision-packet.md`).
2026-08-02 (initial market survey; official product documentation checked on 2026-08-02, with practitioner reports separated from product facts); 2026-08-02 (v0.2, super-refine round 1: both families NOT READY; all 21 findings applied — conclusions re-baselined against LLP 0151 v0.3, whose same-day revision had already absorbed several challenges; recovery/TOTP claim corrected to exact matrix counts; shared-credential production posture closed; inherited session-issuance and hosted-admission gates added; §Implications relabeled confirms-vs-requests); 2026-08-02 (v0.3, super-refine round 2: Fable READY comfortable / Codex NOT READY moderate; TOTP+recovery count corrected five→seven after Codex's primary-source audit of Stytch consumer TOTP and Appwrite recovery codes, both orchestrator-reverified; gate 12 expanded to LLP 0060's complete admission conjunction; gate 11 adds per-request sender proofs; session-authority vs authorization-invalidation split per LLP 0039/0053; OQ15 existing-vs-proposed machinery; line re-wraps)
**Related:** LLP 0011, LLP 0039, LLP 0045, LLP 0053, LLP 0057, LLP 0060, LLP 0061, LLP 0064, LLP 0077, LLP 0096, LLP 0151, LLP 0153

## Summary

The sign-in market has converged on a broad menu but not on one product shape.
The strongest managed products offer four layers together:

1. **authentication mechanisms** such as password, email code, SMS code, magic
   link, passkey, and anonymous/guest access;
2. **federated identity providers** such as Google, Apple, GitHub, Microsoft,
   enterprise OIDC, and SAML;
3. **journey and assurance policy** such as sign-up rules, account linking,
   MFA enrollment, step-up authentication, recovery, and organization discovery;
4. **delivery surfaces** ranging from a hosted login page, through editable
   components or a visual flow builder, to headless APIs.

No surveyed product is best at all four. On the documentation evidence this
survey can support (relative-ease claims here are documentation-derived
hypotheses pending the hands-on bakeoff in the open questions), Clerk and
WorkOS are the best-documented short path to a polished conventional login.
Descope is unusually strong at making the
journey itself configurable. Stytch exposes the richest factor composition.
Auth0 has the broadest mature enterprise control plane, at the cost of concepts,
configuration, and price. Supabase makes identity unusually useful beside
application data and authorization. Firebase remains an easy cross-platform
default but has a less modern first-party factor set. Convex's most complete
answer is deliberately to consume a specialist provider; its own Convex Auth is
small, fast to start, and still beta. Better Auth offers the clearest
configuration-as-code model and local ownership, but the application also owns
delivery, schema evolution, UI, and more security decisions. Cognito and
Keycloak are capable infrastructure rather than low-friction product surfaces.

The best composite design for Snapback is not merely “support many providers.”
It is a **declarative, capability-checked auth journey** with:

- an email code and guest-upgrade path that works locally;
- Google, Apple, GitHub, Microsoft, generic OIDC, and later SAML presets over a
  common identity-link model;
- hosted, generated-component, and headless projections of the same declaration;
- production gates that identify missing provider credentials, redirect URLs,
  domains, delivery adapters, recovery methods, and abuse controls before ship;
- passkeys with progressive enrollment, stable-domain checks, complete lifecycle
  management, and an explicit recovery path;
- an assurance model that carries evidence (authentication methods, factor
  age, step-up requirement) rather than a single `mfa: true` boolean — in a
  Snapback-owned vocabulary whose mapping to NIST/OIDC terms is an open
  question, not a claimed equivalence;
- safe account linking based on provider subject and verified evidence, never a
  casual same-email merge across providers;
- a verified-external-assertion (BYOP) seam so an app whose identity already
  lives in a CIAM product keeps that journey — the paved external-provider
  class is LLP 0153's subject;
- deterministic acceptance personas and a provider simulator so auth can be
  tested without live email, SMS, or third-party consoles.

On MFA scope, LLP 0151 v0.3 (revised the same day as this survey) already
holds most of the position this research argues for: recovery codes are
tier-1 *infrastructure* — mandatory for accounts lacking an independently
recoverable authenticator — and TOTP sits in Tier 2 as a second factor. The
market evidence confirms both placements. The residual challenge is narrower
and real: 0151 deliberately leaves the step-up/MFA **factor-composition model
an open question with no owner**, and it has no assurance projection
(methods, factor age, step-up requirement) in the session. The market
comparison says that composition model should be owned and shipped with the
first production auth profile — for calibration, of the thirteen surveyed
products, seven (Clerk, Auth0, Stytch, Descope, Better Auth, Keycloak, and
Appwrite) document both TOTP and a recovery-code package; the strongest
products pair them with assurance evidence, which is the piece 0151 still
lacks.

## Research question and method

This document asks:

- Which identity providers and direct authentication mechanisms do relevant
  products support?
- How does an application select, configure, render, and test those choices?
- What do products provide for MFA, step-up authentication, passkeys, recovery,
  account linking, and enterprise SSO?
- Which paths are genuinely easy, and where does the setup burden reappear?
- Which ideas should inform Snapback's first-party identity roadmap in LLP 0151?

The survey prioritizes official documentation current on **2026-08-02**.
Product facts below are drawn from those sources and linked inline. Ease and
frustration claims are either direct consequences visible in a product's setup
contract or are identified as anecdotal in prose and linked to practitioner
reports — the discipline is carried in the text and links rather than literal
`[observed]`/`[anecdotal]` tags. Vendor claims like “five minutes” are treated
as evidence of the intended happy path, not an independent benchmark. Pricing
is intentionally not tabulated: it changes too quickly, depends on factor and
enterprise feature, and is not required to answer the mechanism/configuration
question. Plan gates that materially change the product surface are noted.

Corpus baseline: LLP corpus claims — above all the characterizations of LLP
0151 — are checked against **LLP 0151 v0.3 (2026-08-02)**, which was revised
by its own review loop the same day this survey was drafted. If 0151's
Revised header moves again, §Implications must be re-verified before this
document is used as review evidence. Scope boundary: the external-CIAM
consumption seam (Clerk/WorkOS/Auth0 as the app's identity system) is LLP
0153's subject; this document covers the first-party sign-in landscape and
touches that seam only where the market comparison requires it.

The detailed set is WorkOS AuthKit, Clerk, Supabase Auth, Convex Auth and
Convex's external-provider seam, Firebase Authentication / Google Cloud Identity
Platform, Auth0, Stytch, Descope, Better Auth, Amazon Cognito, Keycloak,
Appwrite, and PocketBase. Kinde, FusionAuth, and ZITADEL provide a second check
on the conclusions; Ory, Authentik, Logto, Magic, Auth.js, and Passport remain
relevant follow-up comparisons but were not exhaustively inventoried here.

## Vocabulary: three things vendors often blur

An **identifier** is what the user types or selects: email address, phone number,
username, or sometimes no identifier for a discoverable passkey. A **mechanism**
is how control is proved: password, code, link, passkey/WebAuthn assertion, or
external IdP assertion. A **provider** is an external identity authority such as
Google, Apple, GitHub, Microsoft Entra, an arbitrary OIDC issuer, or a SAML IdP.

MFA is a fourth axis. “Email code plus email link” is not two-factor
authentication because both prove control of the same channel. NIST's current
model distinguishes knowledge, possession, and inherence factors and says
multiple instances of the same factor are still one factor
([NIST SP 800-63-4 model](https://pages.nist.gov/800-63-4/sp800-63/model/)).
Products that model methods as a flat list make it easy to accidentally confuse
availability with assurance.

Passkeys need equally careful language. A passkey is a WebAuthn credential and
is phishing-resistant because it is bound to a verifier name. With required
user verification it can combine possession of a credential with local PIN or
biometric activation, and several vendors allow that ceremony to satisfy an MFA
policy. That does not make every WebAuthn configuration equivalent: relying
party ID, user-verification requirement, discoverability, authenticator type,
backup state, and recovery policy matter.

## Market matrix

The table records product-owned support, not every flow that can be constructed
with custom tokens or another provider. “Passkey” means a first-class lifecycle,
not merely that custom auth can accept the result of somebody else's WebAuthn
ceremony. Recovery codes are folded into the MFA column; audited against
official docs (not just this table's compression), seven products document
both TOTP and a recovery-code package — Clerk, Auth0, Stytch
([consumer TOTP creation returns `recovery_codes`](https://stytch.com/docs/consumer-auth/authentication/totps/api)),
Descope, Better Auth, Keycloak, and Appwrite
([single-use recovery codes and a recovery-code challenge factor](https://appwrite.io/docs/products/auth/mfa)).
WorkOS, Supabase, Firebase, and Cognito document TOTP without a recovery-code
package; Convex and PocketBase document neither. "Recovery-code package"
here means product-generated single-use codes usable as an authentication
factor, whatever the plan tier.

| Product | Direct sign-in mechanisms | Federation / named providers | MFA and step-up | Passkeys | Primary configuration shape |
|---|---|---|---|---|---|
| **WorkOS AuthKit** | Email + password; six-digit email “Magic Auth”; hosted session flow | Google, Microsoft, GitHub, Apple, GitLab, LinkedIn, Slack; API also names Bitbucket, Discord, Intuit, Salesforce, Vercel, Xero; enterprise SSO | AuthKit TOTP; optional or required per environment. Separate composable MFA API also offers TOTP and US-only SMS | Yes; hosted UI only; progressive enrollment; can satisfy required MFA | Dashboard toggles + hosted UI or headless API; CLI installer can modify and validate supported frameworks |
| **Clerk** | Email code, email link, phone/SMS code, username, password, passkey; Web3 wallets | 25 named social providers including Apple, Google, GitHub, Microsoft, Facebook, Discord, GitLab, LinkedIn, Slack, TikTok, Twitch, X; custom OIDC; enterprise connections | SMS, TOTP, backup codes; optional or required; passkey may satisfy policy | Yes; enroll after another sign-up method; lifecycle UI; domain/satellite restrictions | Dashboard toggles; Account Portal or components/Elements/custom API flows; shared dev OAuth keys, own production keys |
| **Supabase Auth** | Email/phone + password; email magic link; email OTP; phone OTP; anonymous; passkey | Apple, Azure/Microsoft, Bitbucket, Discord, Facebook, Figma, GitHub, GitLab, Google, Kakao, Keycloak, LinkedIn, Notion, Slack, Spotify, Twitch, Twitter, WorkOS, Zoom; custom OAuth/OIDC; SAML | TOTP and phone factors; app reads AAL1/AAL2 and enforces it in UI/server/RLS | Yes in current docs; project toggle plus an experimental SDK flag; high- and low-level WebAuthn APIs | Hosted dashboard or local/self-hosted `supabase/config.toml`; application owns most UI and MFA policy |
| **Convex** | Convex Auth: password, password reset, optional email verification, email magic link/code, and documented one-time email/SMS codes | Convex Auth OAuth such as GitHub/Google/Apple; backend accepts OIDC JWTs from Clerk, WorkOS, Auth0, or custom issuer | Convex Auth does not provide the breadth of specialist providers; Convex recommends an external platform for MFA/passkeys/spam protection | Through external IdP, not a first-class Convex Auth lifecycle | `auth.config.ts` + environment; external React providers or beta Convex Auth library; no bundled UI |
| **Firebase Auth / Identity Platform** | Email + password, email link, phone/SMS, anonymous, custom token | Google, Apple, Facebook, GitHub, Microsoft, X/Twitter, Yahoo, Play Games, Game Center; Identity Platform adds generic OIDC/SAML and tenants | Identity Platform supports SMS and TOTP MFA; client implements enrollment/resolution | No first-class Firebase passkey lifecycle found in current Firebase Auth docs; custom auth/external IdP can bridge one | Firebase console + platform SDKs/FirebaseUI; Identity Platform/Admin APIs for advanced config |
| **Auth0** | Email/username/phone + password; passwordless email/SMS; passkey; custom DB | Large Marketplace of social connections; custom social OAuth; enterprise OIDC/SAML/AD/LDAP-style connections | Push/Guardian, SMS, voice, TOTP, WebAuthn security key or device biometric, email, Duo, recovery codes; never/adaptive/always plus Actions and step-up | Yes for database connections, web Universal Login and native | Connection-oriented Dashboard/Management API; Universal Login or SDKs; Actions for policy |
| **Stytch** | Email magic link; email/SMS/WhatsApp OTP; password; mobile biometrics; crypto wallets; passkey/WebAuthn | Google, Apple, GitHub, Microsoft and other OAuth; SAML/OIDC SSO; SCIM in B2B product | Any valid distinct-factor composition; TOTP secondary with recovery codes issued at creation (consumer and B2B); MFA at login or step-up | Yes as primary or secondary after bootstrap; full lifecycle | Consumer vs B2B projects; prebuilt UI, frontend SDKs, or backend API; app enforces factor composition from session |
| **Descope** | OTP, magic link, “enchanted”/embedded links, password, passkey, TOTP, security questions, WhatsApp nOTP, device auth | Built-in major social OAuth, custom apps, SSO; Descope can be IdP or SP | Visual composition of distinct methods; conditional/risk-based MFA and step-up; recovery codes | Yes; console-configured RP/domain; flows or APIs | Visual drag-and-drop Flows, hosted app, embedded/native SDK, or backend API |
| **Better Auth** | Email + password built in; plugins for username, magic link, email OTP, phone/password or phone OTP, anonymous, passkey | Google, GitHub, Apple, Discord and many adapters; generic OAuth plugin | Plugin provides TOTP, delivered OTP, encrypted recovery codes, trusted device; passwordless endpoints require explicit hooks if they must be gated | Yes via plugin/SimpleWebAuthn, including conditional UI and optional passkey-first bootstrap | TypeScript config + server/client plugins + generated/migrated database schema; bring your own UI and delivery |
| **Amazon Cognito** | Username/email/phone + password or SRP; email/SMS OTP; custom challenge; guest identity pool | Apple, Google, Facebook, Login with Amazon; generic OIDC/SAML; developer-authenticated identities | SMS, email, TOTP; required/optional; compatibility rules between OTP first factor and MFA; passkey with UV can satisfy MFA | Yes outside Lite plan, in choice-based flow; managed UI or SDK API | AWS console/API/IaC across user pool, app client, domain, IdP, managed login, triggers, and sometimes identity pool/IAM |
| **Keycloak** | Username/password, OTP, recovery flows, WebAuthn/passwordless | Built-in social providers plus generic OIDC, OAuth2, and SAML identity brokering | Configurable authentication executions/flows; TOTP/HOTP, WebAuthn, recovery codes and conditional flows | Yes, both WebAuthn second factor and passwordless | Realm Admin Console/CLI/config; compose and bind execution flows; self-operated server |
| **Appwrite** | Email + password, phone/SMS, magic URL, email OTP, anonymous, custom token | Many console-configured OAuth2 providers | TOTP, email, phone factors plus single-use recovery codes as a challenge factor; app lists factors and completes challenges | No first-class lifecycle; docs recommend custom tokens for biometric/passkey systems | Project console toggles + SDK calls; app owns UI |
| **PocketBase** | Configurable identity-field + password; email OTP | Configurable OAuth2 providers such as Google, GitHub, Microsoft | Optional MFA requires a second enabled auth method; email OTP is the common second method; no TOTP recovery package documented | No first-class lifecycle | Per-auth-collection options in the local admin UI; compact client API |

### Provider breadth is less important than provider classes

The recurring first-party consumer set is **Google, Apple, GitHub, Microsoft,
Facebook, and X**, with Discord/LinkedIn/Slack/GitLab common in developer and B2B
products. The most valuable escape hatches are **generic OIDC** and **generic
SAML**, because they turn a fixed logo list into a protocol surface. Clerk's
current named list is unusually broad
([Clerk social providers](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/overview));
Supabase publishes a similarly explicit list and now accepts custom OAuth2/OIDC
providers
([Supabase social login](https://supabase.com/docs/guides/auth/social-login)).

WorkOS chooses a narrower, B2B-oriented social set but makes enterprise SSO the
continuation of the same journey
([WorkOS social login](https://workos.com/docs/authkit/social-login)). Cognito's
named consumer set is only Apple, Amazon, Facebook, and Google, but generic OIDC
and SAML fill much of the protocol gap
([Cognito external IdPs](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-identity-provider.html)).

The winning abstraction is therefore not a permanently exhaustive enum. It is:

- named presets with icons, default scopes, claim normalization, quirks, and
  acceptance fixtures for the providers users expect;
- a generic OIDC path for standards-compliant providers;
- a generic SAML path for enterprise connections;
- a bespoke OAuth2 adapter only where the provider is not OIDC (GitHub is the
  most important example for Snapback);
- a verified-token/BYOP seam when another system owns the complete journey.

## Product findings

### WorkOS AuthKit: the shortest B2B-shaped happy path

AuthKit supports email/password, social login, email-code Magic Auth, enterprise
SSO, MFA, and passkeys in one hosted journey
([overview](https://workos.com/docs/authkit/overview)). Authentication returns
an authorization code regardless of the upstream method, which gives the app a
single callback/exchange shape
([authentication API](https://workos.com/docs/reference/authkit/authentication)).
The same user may have password and Google methods enabled, selected in the
Dashboard per environment.

The best ideas are consolidation and progressive disclosure. A team can begin
with a hosted page and dashboard toggles, then move to the API for a custom UI.
The CLI installer detects a framework, installs SDKs, creates routes, configures
redirect/CORS settings, and build-validates; importantly, the docs explicitly
tell the developer to review the resulting diff
([WorkOS CLI installer](https://workos.com/docs/authkit/cli-installer)). That is
an excellent agent-authored-app pattern.

WorkOS also makes a strong product call that Snapback should take seriously:
Magic Auth is a six-digit email code, and WorkOS deprecated magic links because
enterprise mail scanners may click and consume them
([authentication-method discussion](https://workos.com/docs/authkit/modeling-your-app)).
Stytch instead preserves links but implements scanner-aware handling
([Stytch magic-link security](https://stytch.com/docs/consumer-auth/authentication/magic-links/overview)).
Either is better than pretending link scanners do not exist.

Passkeys are dashboard-enabled, hosted-UI-only, domain-bound, and can be offered
through progressive enrollment after a password login. If MFA is required, a
verified passkey can satisfy it without another TOTP prompt
([WorkOS passkeys](https://workos.com/docs/authkit/passkeys/passkey-configuration/multi-factor-auth)).
AuthKit's native MFA is TOTP; the separate composable WorkOS MFA API also offers
SMS, currently US-only
([WorkOS MFA](https://workos.com/docs/mfa)).

The trade-off is that the easiest path is also the most product-owned: hosted UI,
Dashboard state, WorkOS session semantics, and an organization-centric model.
Custom UI returns much of the state-machine work to the application. One small
2026 practitioner thread calls AuthKit pleasant when the hosted UI fits, while
calling the lower-level API confusing; this is useful but weak anecdotal evidence
([report](https://www.reddit.com/r/webdev/comments/1qqu9ud/workos_for_nonenterprise_applications/)).

### Clerk: broad consumer mechanisms and excellent prebuilt surfaces

Clerk is the clearest example of treating sign-in, sign-up, user profile, and
session tasks as one product. Its dashboard selects email code/link, phone code,
username, password, passkey, social/enterprise connection, Web3, and MFA behavior
([strategy configuration](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options)).
The Account Portal and components give the user enrollment, profile, linking,
MFA, and recovery UI that an API-only provider leaves unfinished.

The development story is unusually smooth: most social connections use shared
Clerk credentials and redirects in development. Production deliberately requires
the application's own OAuth credentials
([Google setup](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)).
That makes “turn on Google” truthful in dev without hiding the production
ownership boundary. Provider settings separately control whether a connection
can sign users in/up or only be linked to an existing account.

Clerk's passkey docs are notably honest. Users must bootstrap with another
method, may hold at most ten passkeys, and passkeys are tied to an RP domain;
satellite domains and switching between the Account Portal domain and localhost
can surprise development. Clerk explains when a passkey satisfies MFA rather
than offering it as a dedicated second-factor enrollment
([same strategy guide](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options)).
Its MFA package is the conventional minimum: SMS, TOTP, and backup codes,
optional per user or required for the instance.

Clerk also documents account linking as a state machine rather than “same email
means same person.” A verified OAuth email may link, while an earlier unverified
password identity triggers verification and sometimes password change before
linking
([Clerk account linking](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking)).

The consistent practitioner view is “very fast until you depart from the paved
UI.” Reports praise setup and time saved, while naming deep component styling,
webhook synchronization to an app-owned user table, service dependence, and
price as the recurring costs
([2025 discussion](https://www.reddit.com/r/nextjs/comments/1olw8o2/any_experience_with_clerk/),
[earlier discussion](https://www.reddit.com/r/nextjs/comments/1575smi/clerk_auth/)).
These are anecdotes, not reliability measurements.

### Supabase Auth: broad mechanisms beside Postgres, with more app-owned policy

Supabase covers nearly the whole direct-method menu: email/phone password,
email magic link and OTP, phone OTP, anonymous users, social login, SAML, MFA,
and now passkeys
([Auth overview](https://supabase.com/docs/guides/auth),
[passkeys](https://supabase.com/docs/guides/auth/passkeys)). The strongest
configuration idea is dual custody: hosted projects use the Auth Providers
dashboard, while local development and self-hosting use checked-in
`supabase/config.toml`, with secrets referenced through `env(...)`
([local config](https://supabase.com/docs/guides/local-development/managing-config)).

The MFA model exposes authenticator assurance levels. After a first factor the
session is AAL1; TOTP or phone verification yields AAL2. The app can inspect the
current and next AAL and enforce it in frontend routing, server rendering, or
Postgres RLS
([TOTP flow](https://supabase.com/docs/guides/auth/auth-mfa/totp),
[MFA overview](https://supabase.com/docs/guides/auth/auth-mfa)). This is much
more composable than a provider-owned `mfaEnabled` flag, but it also means the
application owns enrollment UI, challenge routing, and policy correctness.

Supabase's current passkey API offers a one-call flow for ordinary clients and a
start/verify split for native or custom ceremonies, plus list/rename/delete and
admin revocation. The JavaScript server example still enables an experimental
flag, so this should be treated as a new surface whose maturity may differ by SDK.

The main operational traps are visible in the official docs:

- provider access/refresh tokens are returned only where available, are not
  stored by Supabase, and are not refreshed for the app;
- SAML users are not identity-linked to regular accounts, so equal emails can
  produce distinct users; email is therefore not a durable principal key;
- MFA enforcement in SSR is explicitly described as tricky;
- cookie refresh and PKCE callbacks require careful per-request server clients.

Older community reports repeatedly describe Next.js SSR, OAuth callbacks, and
magic-link redirects as painful
([2023 report](https://www.reddit.com/r/Supabase/comments/120oh2p/why_is_supabase_dev_experience_so_terrible/),
[official Next.js troubleshooting](https://supabase.com/docs/guides/troubleshooting/how-do-you-troubleshoot-nextjs---supabase-auth-issues-riMCZV)).
The age of the reports and subsequent `@supabase/ssr` work lower their weight,
but the boundary remains intrinsically more complex than a provider-owned hosted
page.

### Convex: a verifier seam first, a small beta provider second

Convex's architecture is unusually honest: it accepts OIDC JWTs for WebSocket
and RPC authentication and recommends Clerk, WorkOS, or Auth0 when the app needs
passkeys, 2FA, spam protection, and mature user management
([Convex auth overview](https://docs.convex.dev/auth/overview)). Configuration is
a small `convex/auth.config.ts` provider list containing issuer domain and
application ID; deployment syncs the verifier configuration. Provider-specific
React wrappers own token acquisition and refresh
([Clerk integration](https://docs.convex.dev/auth/clerk)).

Convex Auth is the no-second-vendor option. It supports password/reset/optional
verification, email links and codes, documented one-time email/SMS codes, and
OAuth providers such as Google, GitHub, and Apple. It stores users in Convex
and needs no separate hosting server, but is
beta, lacks UI components, has incomplete/experimental Next.js server support,
and intentionally offers fewer advanced features
([Convex Auth](https://docs.convex.dev/auth/convex-auth)).

This split is a useful precedent for Snapback: a small built-in provider can be
the fastest local and portable path without pretending to replace specialist
CIAM. The verifier contract and stable internal principal remain the durable
surface.

### Firebase: easy cross-platform basics, dated edges, Identity Platform upsell

Firebase Auth's durable strengths are SDK breadth, anonymous upgrade, provider
linking, and a console that makes the basic methods easy. Its documented set is
email/password, email link, phone SMS, anonymous/custom auth, and federated
Google, Apple, Facebook, GitHub, Microsoft, X, Yahoo, Play Games, and Game Center
([where to start](https://firebase.google.com/docs/auth/where-to-start)).
FirebaseUI provides a drop-in surface; the app can instead build every screen
against the SDK.

Advanced federation and MFA belong to the Google Cloud Identity Platform
posture. TOTP and SMS are supported second factors, with email verification as a
precondition for MFA in most flows
([TOTP MFA](https://docs.cloud.google.com/identity-platform/docs/admin/enabling-totp-mfa)).
Current Firebase docs do not expose a first-class passkey enrollment/sign-in/
recovery lifecycle; an app can bridge an external ceremony through custom auth,
but that is not equivalent product support.

Two warnings are especially relevant to Snapback. First, Firebase distinguishes
trusted and untrusted email assertions across providers before auto-linking;
GitHub/Facebook/X emails are not categorically treated like Gmail/Apple evidence
([verified email behavior](https://firebase.google.com/docs/auth/users)).
Second, the August 2025 Firebase Dynamic Links shutdown changed mobile email-link
and older OAuth flows, illustrating how a convenient deep-link dependency can
become migration work
([email-link warning](https://firebase.google.com/docs/auth/web/email-link-auth)).

### Auth0: the breadth ceiling and the complexity warning

Auth0 models each source of users as a **connection**: database, passwordless,
social, enterprise, or custom. Database connections support email, username, or
phone identifiers with password or passkey and may use Auth0's store or custom
database scripts
([database connections](https://auth0.com/docs/authenticate/database-connections)).
The Marketplace and custom-social path make provider breadth effectively open
ended
([social IdPs](https://auth0.com/docs/authenticate/identity-providers/social-identity-providers)).

Its MFA surface is the market's breadth ceiling: Guardian push, SMS, voice,
TOTP, WebAuthn security key, WebAuthn device biometric, email, Duo, and recovery
codes. Policies can be never, adaptive, or always, with Actions for application,
user, metadata, IP, location, and step-up conditions
([MFA factors](https://auth0.com/docs/secure/multi-factor-authentication/multi-factor-authentication-factors)).
Passkeys work with Universal Login on web and native iOS/Android
([passwordless/passkeys](https://auth0.com/docs/authenticate/passwordless)).

This flexibility creates a large state space: tenant, application, API,
connection, organization, Universal Login, Action, rule/policy, custom domain,
and plan entitlement can all affect one login. Auth0's own 2026 response to
feedback acknowledges B2B plan “price cliffs”
([Auth0 plan feedback](https://auth0.com/blog/how-feedback-shaped-new-auth0-b2b-plans/)).
Community evidence strongly associates Auth0 with mature docs and capability,
but also with pricing and configuration complexity; treat that as directional,
not a controlled comparison
([pricing discussion](https://www.reddit.com/r/webdev/comments/18d6hcd/auth0_increases_price_by_300/)).

### Stytch: factor composition rather than a fixed MFA checkbox

Stytch's consumer product covers magic links, email/SMS/WhatsApp OTPs,
passwords, OAuth, passkeys/WebAuthn, mobile biometrics, and wallets; its B2B
product adds SAML/OIDC, SCIM, organizations, and RBAC
([authentication overview](https://stytch.com/docs/get-started/guides/authentication)).
The strongest idea is its explicit factor-combination table: passkeys and
WebAuthn may be primary or secondary after bootstrap, TOTP is secondary only,
and email link plus email OTP is called out as an invalid “two factor” pairing
because both prove the same mailbox. Sessions retain an array of authentication
factors, and the app enforces login MFA or later step-up from that evidence
([Stytch MFA](https://stytch.com/docs/consumer-auth/authentication/mfa/overview)).

That is close to the right Snapback model. It preserves evidence instead of
compressing it into “MFA happened,” and it allows a sensitive operation to ask
whether a sufficiently fresh, independent factor set is present.

### Descope: the journey is a visual program

Descope exposes the broadest journey vocabulary: OTP, magic/enchanted/embedded
links, social OAuth, SSO, passkeys, TOTP, passwords, security questions,
WhatsApp, recovery codes, device auth, and agent/MCP-oriented methods
([method inventory](https://docs.descope.com/auth-methods)). Its differentiator
is Flows: a drag-and-drop program containing screens, actions, branches,
connectors, and error behavior
([Flows](https://docs.descope.com/flows)). The same backend can be consumed via
hosted flow, embedded SDK, client SDK, or backend API.

MFA is simply a sequence of independent evidence-producing methods, optionally
conditioned on risk. Descope explicitly rejects two email-channel steps as MFA
([MFA overview](https://docs.descope.com/mfa)). Passkey configuration exposes
the RP domain and warns that changing it can strand users who lack another
verified method
([passkey settings](https://docs.descope.com/auth-methods/passkeys/settings)).

The idea to steal is not necessarily a graphical editor. It is that the auth
journey is a first-class, inspectable program whose branches and postconditions
can be validated. A declarative Snapback manifest could provide that value with
less UI and less arbitrary flow complexity.

### Better Auth: the strongest configuration-as-code reference

Better Auth puts the selection directly in TypeScript. Email/password and social
providers are core configuration; username, magic link, email OTP, phone,
anonymous, passkey, two-factor, organizations, API keys, and many other features
are server/client plugins
([basic usage](https://better-auth.com/docs/basic-usage),
[plugin catalog](https://better-auth.com/docs/plugins)). This is the clearest
reference for “say what the app supports in code.” Database schemas and
migrations are generated from the selected plugins.

The trade is honest: the app supplies email and SMS delivery callbacks, mounts
the auth handler, installs matching client plugins, renders UI, owns the
database, and reviews migrations. The passkey plugin is full-featured —
registration, conditional UI, list/rename/delete, authenticator metadata, RP ID,
origin, and user-verification controls
([passkey plugin](https://better-auth.com/docs/plugins/passkey)). The 2FA plugin
offers TOTP, delivered OTP, encrypted backup codes, and trusted-device behavior,
but by default gates credential endpoints rather than OAuth/magic-link/passkey
endpoints; apps needing universal 2FA must add hooks
([2FA plugin](https://better-auth.com/docs/plugins/2fa)). That default is an
important footgun to avoid.

Community reports split predictably: greenfield projects that accept Better
Auth's schema find it pleasant; migrations with an existing custom user model
can fight required fields, schema ownership, cookie behavior, and abstraction
([migration report](https://www.reddit.com/r/nextjs/comments/1rznpyt/migrating_to_better_auth_from_next_auth_and_its_a/)).
This is anecdotal and the linked URL itself may disappear; the architectural
point is independently visible in the generated-schema contract.

### Cognito and Keycloak: capable, operationally expensive control planes

Cognito now has a modern feature list: password/SRP, email and SMS passwordless
OTP, WebAuthn passkeys, custom challenges, social/OIDC/SAML federation, SMS/
email/TOTP MFA, and managed login
([authentication flows](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-authentication-flow-methods.html)).
But a complete app may cross user pools, app clients, hosted domains, identity
providers, Lambda triggers, identity pools, and IAM roles. Passwordless OTP is
not compatible with required MFA in the obvious way; passkeys need the
choice-based `USER_AUTH` flow and are unavailable on Lite; some defaults and
attributes become difficult to change after users exist.

Practitioner sentiment is consistent in shape: users describe it as cheap
once understood, while naming confusing names, docs, token flows, UI
customization, and IaC defaults as a high setup tax
([2026 AWS discussion](https://www.reddit.com/r/aws/comments/1r324m8/aws_cognito_experience/)).
This is anecdotal and is not used here as a reliability measurement; the
official troubleshooting surface and number of independent resources support
only the complexity finding.

Keycloak offers comparable protocol and factor depth under the operator's
control. Realms can broker social, OIDC, OAuth2, and SAML identities, and an
administrator can duplicate, reorder, condition, and bind password, OTP,
WebAuthn, recovery, and required-action executions
([Keycloak Admin Guide](https://www.keycloak.org/docs/latest/server_admin/)).
That is powerful and self-hostable. It also means the operator owns upgrades,
availability, mail, themes, databases, realm configuration, and a flow graph
whose alternative/required semantics can produce surprising journeys. Keycloak
is a protocol server and administration system, not the “one declaration and a
beautiful native screen” bar Snapback is trying to set.

### Smaller BaaS products: simplicity through a smaller claim

Appwrite exposes password, phone SMS, magic URL, email OTP, anonymous, OAuth2,
custom tokens, and TOTP/email/phone MFA with single-use recovery codes usable
as a challenge factor
([Auth](https://appwrite.io/docs/products/auth),
[MFA](https://appwrite.io/docs/products/auth/mfa)). OAuth providers are
dashboard toggles backed by app-owned provider credentials
([OAuth2 setup](https://appwrite.io/docs/products/auth/oauth2)). Passkeys are a
custom-token integration, not a managed lifecycle.

PocketBase configures password identity, email OTP, OAuth2, and optional MFA per
auth collection in one local admin UI. It has no server-side session store or
logout endpoint; clients discard self-contained tokens. Its MFA means requiring
another enabled method, commonly email OTP, rather than a broad authenticator
system
([PocketBase auth](https://pocketbase.io/docs/authentication/)). The product is
an excellent simplicity reference precisely because it does not claim the
assurance, recovery, hosted delivery, or enterprise surface of specialist CIAM.

### Cross-checks: Kinde, FusionAuth, and ZITADEL

The secondary set reinforces the main conclusions:

- Kinde defaults new businesses to email OTP rather than password, rejects
  magic links, supports phone/Twilio, social/custom OAuth2, SAML, and passkeys,
  and explicitly warns that shared vendor credentials are for development only
  because of rate limits, branding, and Apple identity binding
  ([Kinde methods](https://docs.kinde.com/authenticate/about-auth/authentication-methods/),
  [production-key warning](https://docs.kinde.com/authenticate/about-auth/about-authentication/)).
- FusionAuth combines hosted/self-hosted operation with passwordless, WebAuthn,
  MFA, social presets, OIDC, SAML, and explicit identity-linking strategies
  ([identity providers](https://fusionauth.io/docs/lifecycle/authenticate-users/identity-providers/),
  [WebAuthn](https://fusionauth.io/docs/lifecycle/authenticate-users/passwordless/webauthn-passkeys)).
- ZITADEL combines cloud/self-hosted OIDC/SAML infrastructure, hosted or custom
  login, passwords, social IdPs, TOTP/email/SMS/U2F, and passkey self-service;
  it too recommends choosing a custom domain before passkeys
  ([self service](https://zitadel.com/docs/concepts/features/selfservice),
  [passkeys](https://zitadel.com/docs/concepts/features/passkeys)).

## How applications say what they support

Four configuration patterns recur.

### 1. Dashboard toggles

WorkOS, Clerk, Firebase, Supabase hosted, Auth0, Cognito, Appwrite, Kinde, and
others ask an operator to enable methods and paste provider credentials in a
web console. This is discoverable and keeps secrets out of source. It is weak
for review, environment parity, reproducibility, drift detection, and agents.

Clerk and WorkOS improve the model by making configuration explicitly
environment-scoped. Clerk's shared development credentials reduce time to first
login; production refuses to rely on them. WorkOS's installer can mutate both
the project and dashboard and then build-validate. These are best-in-class
onboarding ideas.

### 2. Configuration as code

Better Auth's TypeScript object and plugins are the strongest pure example.
Convex's verifier list and Supabase's local `config.toml` are smaller examples.
AWS CDK/Terraform can describe Cognito, and Keycloak has realm exports, but those
encode infrastructure rather than an author-friendly product declaration.

Code configuration is reviewable and reproducible, but secrets must remain
references, not values. It also needs an apply/inspect loop: a declaration that
says `google: true` is not production-ready if the provider console lacks the
exact redirect, the secret is absent, or the consent app is still in testing.

### 3. Visual journey program

Descope makes order, branches, risk checks, enrollment, and error handling
explicit. Auth0 Actions and Keycloak authentication flows are more operational
versions of the same idea. This is powerful for enterprise variation and easy to
make too complex. Snapback should borrow the inspectable program and validation,
not necessarily arbitrary graph editing in v1.

### 4. Provider/verifier seam

Convex consumes a provider-issued JWT; Snapback's existing BYOP direction
(LLP 0151's tier-2 verified-token hook, on LLP 0011's boundary) does the
same. This minimizes the backend's auth surface and lets Clerk/WorkOS/Auth0
own the journey. It creates a second data owner and often a webhook or first-login
projection into the application database. The seam is essential — LLP 0153
researches paving it into a full external-provider class — but should not
be the only paved path if portability and local operation are product goals.

## What is actually easy

“Easy” has at least five different meanings:

| Stage | Lowest-friction pattern | Where the work returns |
|---|---|---|
| First local login | Shared dev OAuth keys, capture email codes, anonymous user, or provider simulator | None if the product has a real dev posture; otherwise delivery and callback setup |
| Polished default UI | Hosted page or prebuilt account components | Branding, navigation, custom fields, accessibility review, and native presentation |
| Production social login | Provider preset + exact checklist | Every provider still requires production registration, keys, redirect URIs, consent/branding, and sometimes review |
| Advanced assurance | Provider-owned MFA task UI and recovery | App-specific step-up policy and protected-operation enforcement |
| Full customization | Headless API / visual flow / local library | The application now owns the state machine, accessibility, recovery, abuse cases, and regression tests |

On that rubric — read "easiest" throughout as *best documented for*, a
hypothesis the bakeoff open question would test, not a measured ranking:

- **WorkOS AuthKit and Clerk** are easiest for a conventional hosted or
  component-based web/B2B journey. WorkOS's new installer is particularly
  agent-friendly; Clerk has the richer user-facing component system.
- **Descope** is easiest when the hard part is a conditional custom journey and
  a visual editor is acceptable.
- **Firebase and Supabase** are easy for a client-rendered BaaS app already using
  their ecosystem. SSR, native deep links, app-owned MFA UI, and authorization
  policy erase some of that advantage.
- **Convex Auth** is easy for a small client-rendered Convex app that accepts a
  beta library and builds its own UI. Convex plus Clerk/WorkOS is easier for a
  complete product but introduces a second service.
- **Better Auth** is easy for a TypeScript team that wants ownership and accepts
  its schema/plugin model. It is not “less work”; it relocates the work into the
  repository and application operations.
- **Cognito, Keycloak, Auth0, and FusionAuth** become attractive as requirements
  approach their breadth or infrastructure constraints. They are not the
  smallest cognitive path for a simple app.

## What is troublesome, annoying, or dangerous

### Production OAuth configuration is irreducibly multi-party

Every serious system eventually asks the app owner to create a provider app,
copy client IDs/secrets or signing keys, register exact callback URLs, configure
consent branding and privacy URLs, choose scopes, and repeat for dev/preview/
production and web/native clients. Shared development credentials can hide this
temporarily but must not imply that production is ready.

Google consent status and sensitive-scope review, Apple Services IDs/team/key/
private-relay setup, and native application identifiers make those providers
more than a toggle. Apple is consistently the most ceremonious mainstream
provider. App Store guideline 4.8 also requires a privacy-preserving equivalent
login option for many apps that offer third-party social login
([Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)).

### Redirect, cookie, SSR, and deep-link bugs dominate integration time

The cryptography is usually not what app developers debug. They debug:

- a trailing slash or preview URL missing from an allowlist;
- a callback landing on the wrong environment;
- `SameSite`, secure-cookie, proxy-host, or custom-domain behavior;
- server rendering refreshing a token without returning the updated cookie;
- opening an email link on a different browser/device;
- mobile universal/app links and a system-browser return;
- WebView restrictions from Google and platform providers;
- logout that clears the app but not the IdP, or vice versa.

OAuth 2.0 Security BCP requires PKCE for public clients and strict redirect
handling; modern browser guidance also rejects the implicit and resource-owner
password grants
([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700),
[browser-app guidance](https://www.ietf.org/archive/id/draft-ietf-oauth-browser-based-apps-24.html)).
Snapback should own these mechanics in generated/hosted clients and expose
diagnostics in product vocabulary rather than leaking raw protocol errors.

### Magic links are deceptively fragile

They cross devices poorly, depend on deep links, and are clicked by enterprise
mail scanners. Same-browser restrictions improve security while making the
cross-device case worse. Email codes have a small transcription cost but a
cleaner device boundary and are easier to capture in deterministic tests.
Support links if users want them, but make codes the conservative default.

### SMS is costly, abusable, and weaker than it feels

SMS introduces per-message spend, country allowlists, deliverability variation,
toll fraud/SMS pumping, recycled numbers, SIM swaps, and recovery ambiguity.
Clerk exposes country allowlists; Firebase/Google offers reCAPTCHA SMS defense;
Supabase explicitly warns about SIM swaps. NIST classifies PSTN out-of-band auth
as a restricted authenticator, requires an unrestricted alternative, and says
manual OTP entry is not phishing-resistant
([NIST authenticator requirements](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/)).

SMS can still be a first-class consumer mechanism. “First-class” must include
budget/rate controls, regional policy, abuse signals, safe number-change
reauthentication, and a stronger recovery/step-up alternative — not just a
Twilio callback.

### Passkeys move complexity into domains, lifecycle, and recovery

Passkeys remove password and phishing burdens but add:

- RP ID/custom-domain planning before enrollment;
- localhost, preview, subdomain, satellite-domain, web/native association, and
  account-portal differences;
- bootstrap for users with no credential yet;
- multiple credentials per user, names, last-used time, deletion, and admin
  revocation;
- synced vs device-bound credentials and user-verification policy;
- lost-device/account recovery that must not be weaker than the promise;
- migration problems when a broker's domain or credential ownership changes.

The best products explicitly manage the whole lifecycle and use progressive
enrollment. A checkbox that only performs registration and assertion is not a
complete passkey feature.

### Account linking can become account takeover

The stable key is `(issuer/provider, subject)`, never email alone across
provider installations — Snapback's built-in `email-code` provider
legitimately uses the canonical email address as its own provider-scoped
subject (LLP 0039), which is exactly a `(provider, subject)` key, not a
cross-provider email match. Email is evidence whose strength varies by
provider and moment. Providers may omit it, expose a
private relay address, return an unverified address, allow it to change, or
scope the subject to an app/team. Safe systems separate:

- automatic linking when an existing trusted relationship and verified evidence
  justify it;
- explicit linking from an already authenticated session with re-verification;
- merge of two principals and their application data;
- recovery when the original provider is gone.

Snapback's existing rule — LLP 0011's "cross-provider email auto-linking must
be opt-in only" — is the right conservative baseline. The product should
explain a would-be duplicate,
not silently create or merge one.

### MFA without recovery and assurance evidence is incomplete

TOTP enrollment needs QR and secret fallback, verification before activation,
factor naming/listing/removal, recovery codes, administrator recovery, and
session revocation after reset. Step-up needs factor age and a pending session
that cannot accidentally access protected data before completion. Two methods
on one channel do not make MFA. A passkey may satisfy a policy only when the
configuration and ceremony actually provide the required user verification.

Supabase's AAL, Stytch's factor array, Descope's distinct-evidence rule, Clerk's
pending session task, and Auth0's Actions are stronger references than a single
boolean.

### Split user data and webhooks create consistency problems

Specialist CIAM owns users while the application owns profiles, memberships,
and permissions. Developers commonly copy provider users into their database by
webhook. Delivery is asynchronous, duplicated, reordered, and can fail; deletion
events raise retention questions. Convex documents both first-request creation
and webhook synchronization, showing the seam plainly
([storing users](https://docs.convex.dev/auth/database-auth)).

Snapback should transactionally create/link its stable principal from a verified
request and treat webhooks as reconciliation, not a prerequisite for first
login. Provider deletion should deactivate the identity link and invoke an
app-owned cleanup policy rather than cascade-delete application data.

### Self-hosting changes who carries the pager

Better Auth, Keycloak, PocketBase, self-hosted Supabase/Appwrite, FusionAuth,
ZITADEL, Ory, and Authentik reduce vendor custody or lock-in. They do not remove
email/SMS delivery, database backup, signing-key rotation, rate limiting, abuse
defense, CVE upgrades, availability, audit, and incident response. “Open source”
and “easy sign-in integration” are separate virtues.

## Best ideas to take — and improve

### 1. One declaration, several projections

An app should declare intent in code, approximately:

```ts
auth: {
  entry: ['guest', 'emailCode', 'google', 'apple', 'github'],
  passkeys: { enrollment: 'progressive', requireStableDomain: true },
  assurance: {
    default: 'single-factor',
    sensitive: { require: 'phishingResistantOrTotp', maxAge: '10m' },
  },
  recovery: ['emailCode', 'recoveryCodes'],
  linking: { crossProviderEmail: 'confirm-existing-session' },
}
```

This is illustrative, not a proposed wire/schema contract. The same declaration
should project to hosted UI, generated editable components, headless APIs,
runtime capabilities, guide instructions, and acceptance tests. Dashboard edits
should round-trip into or visibly drift from the declaration; there must not be
two silent sources of truth.

This combines Better Auth's reviewability, Clerk/WorkOS's polished surface, and
Descope's journey semantics.

### 2. A compiler that refuses incomplete production auth

Before a deployment can claim a provider/mechanism, validate:

- exact environment and callback origins;
- custom domain/RP ID and native association files;
- secret references and provider key age, never secret values in manifests;
- provider app production/consent status where machine-checkable;
- mail/SMS delivery adapter, sender/domain verification, and regional budget;
- at least one recovery path for password, passkey, or MFA enrollment;
- rate limits, attempt budgets, anti-enumeration behavior, and body/log redaction;
- deployment-arm and client-surface support for every selected journey;
- generated acceptance fixtures and negative cases.

WorkOS's installer/build validation is the seed of this idea. Snapback can do
better because its capability manifest and stable diagnostic vocabulary can make
the result machine-verifiable at runtime.

### 3. Shared development convenience with an explicit graduation gate

Clerk, Auth0, Descope, and Kinde demonstrate the value of shared development
OAuth credentials. Snapback can offer a provider simulator, capture mailbox,
capture SMS, or optional neutral broker for development. **Production refuses
shared credentials.** A posture acknowledgment is not a sufficient exception:
it resolves none of consent-brand leakage, shared suspension blast radius,
issuer/subject continuity, provider-token custody, or migration — and this
document's own credential-ownership finding (§Implications item 6) calls a
generic "graduate later" promise unsafe. LLP 0151 already recommends
app-owned credentials for production (its Option D) and pre-pins the only
shape a production broker could take: issuer continuity, app verification,
nonce/PKCE constraints, no session issuance, and a self-hostable protocol.
Any production exception rides that complete conditional contract and 0151's
author decision, not a declaration flag. The inspection surface should say
`development-simulated`, `brokered-shared`, or `app-owned`, not merely
`google: enabled`.

### 4. Provider presets over a protocol substrate

LLP 0151's OIDC-substrate direction is supported by the market. Presets should
carry more than endpoints: default scopes, expected issuer/audience, email trust
posture, subject scope, first-login-only fields, logout support, profile refresh,
provider-token custody, native/web variations, console checklist, and conformance
fixtures. GitHub remains a bespoke OAuth2/profile adapter. Generic OIDC and SAML
are product capabilities, not hidden escape hatches.

### 5. Email code first; link as an optional presentation

Keep one protected challenge state machine and offer code and link presentations
only where their semantics are explicit. Codes should be the default because
they work across devices and survive scanners. If links ship, use scanner-aware
handling, bind the initiated journey, make tokens single-use, and explain
same-device requirements before the user leaves the app.

### 6. Passkey progressive enrollment with domain-readiness

Do not require a new user to understand passkeys before reaching value. Begin
with guest, email code, or social identity, then offer passkey enrollment once
the app has a durable RP domain. Support conditional UI for returning users,
multiple credentials, list/rename/delete, admin revoke, last-used time, and
recovery. Preserve actual user-verification evidence in the session so policy
can decide whether it satisfies MFA.

### 7. Assurance as data and tasks

Project into every resolved session:

- authentication methods (`amr`-like evidence);
- assurance level;
- time of each factor verification;
- phishing-resistant/user-verified facts;
- pending tasks such as verify-email, enroll-factor, choose-organization,
  accept-invite, or recover-account;
- invalidation of stale clients on reset/link/recovery — two distinct
  existing mechanisms, kept separate as the corpus keeps them: session and
  family **authority transitions** (revocation, recovery-driven rotation)
  are LLP 0039's, while **authorization versions and obligations** for
  `permissionBacking` changes such as link/claim/merge effects are LLP
  0053's.

Handlers ask for a declarative assurance requirement; the common gate either
admits or returns a typed task/refusal. Clients cannot infer that a successful
first factor means a fully active session.

### 8. Recovery is designed with enrollment

Every mechanism row must specify bootstrap, add, authenticate, list, rename,
remove, loss, recovery, admin reset, revoke, and migration. TOTP without recovery
codes and passkeys without another trusted recovery path are incomplete. High-
value changes — email, phone, password, passkey removal, MFA reset, provider link,
and recovery-method addition — require recent step-up and revoke affected session
families.

### 9. Guest upgrade preserves the principal

Supabase/Firebase anonymous upgrade and LLP 0151's proposed guest principal are
high-leverage. A guest should already be a stable Snapback principal; attaching
the first verified identity preserves the ID and all owned data. If the identity
belongs to another principal, do not invent a generic merge. LLP 0151's
collision semantics are the right shape and the market survey confirms them:
`switch_existing` signs into the colliding account while the guest principal
is **frozen and retained in quarantine under a TTL** (not destroyed), and the
opt-in `merge` is an app-declared, checkpointed, resumable transactional
handler paired with an app-owned cleanup contract at quarantine expiry.

### 10. First-class test identity and provider simulation

Auth features are notoriously under-tested because live providers, mail, SMS,
passkeys, and MFA are awkward in CI. Snapback can make this a differentiator:

- deterministic provider simulator with signed OIDC fixtures and key rotation;
- capture email/SMS channels that exercise the real challenge state machine;
- virtual WebAuthn authenticators and RP-domain negative fixtures;
- scenarios for duplicate email, missing email, private relay, unverified email,
  first-login-only name, provider deletion, key rotation, replay, and callback
  mismatch;
- MFA enrollment, recovery-code single use, factor reset, stale-session refusal,
  and step-up age tests;
- generated personas available to acceptance tests without client-asserted
  production identity.

No surveyed product's documentation shows this whole matrix made as easy as
its happy-path login — a documentation finding; the bakeoff open question is
what would confirm it hands-on.

## Implications for LLP 0151

This Research does not amend LLP 0151, but it supplies evidence for its
review. Baseline: **LLP 0151 v0.3 (2026-08-02)** — that document was revised
by its own review loop the same day this survey was drafted and already
absorbed several positions the survey argues for, so each item below is
labeled **confirms** (market evidence supporting what 0151 v0.3 already
says) or **requests** (an exact addition or change). If 0151 moves again,
re-verify these labels before use.

1. **Microsoft placement — confirms, with one residual question.** Google,
   Apple, and GitHub are the right mainstream/developer presets, and 0151
   v0.3 already names Microsoft Entra ID as the *first* named tier-2 preset
   with explicit tenant handling — precisely the treatment the market
   evidence demands. The residual question is whether B2B demand justifies a
   Tier-1 promotion ahead of full SAML; the survey's evidence (Microsoft
   present across nearly every broad provider) supports asking, not yet
   answering. Expo identity is strategically unique to this ecosystem but not
   validated by the general market.
2. **Email OTP default — confirms, requests scanner semantics.** 0151 already
   prefers codes over links (a code survives the read-mail-on-another-device
   case), riding the built-in email-code provider LLP 0057 defines. The
   market adds a second, independent rationale the RFC should
   cite: enterprise mail scanners consume links — WorkOS deprecated magic
   links over exactly this, and Stytch ships scanner-aware handling. Request:
   make link-scanner semantics explicit wherever links ship.
3. **SMS tier placement — superseded by the 2026-08-02 sitting.** LLP 0151
   now places SMS at tier 2 and requires a delivery-vendor owner before
   promotion. Its SMS row still carries everything this survey's evidence
   demands for any supported or future paved path: launch-gating abuse controls
   (country allowlists, per-destination/source/prefix/IP throttles, spend
   caps), the vendor-neutral delivery seam (E.164, templates, status
   normalization, failover, riding LLP 0045's adapter), SIM-swap and
   recycled-number rules, change-phone as a verified flow, and mandatory
   recovery codes for SMS-only accounts as the non-PSTN alternative. The
   market evidence is confirmation, not a gap report; the genuinely open
   piece 0151 already tracks is delivery-vendor ownership.
4. **MFA composition — confirms the placements, requests an owner.** 0151
   v0.3 makes recovery codes tier-1 infrastructure and TOTP a tier-2 second
   factor; the market confirms both. What it deliberately leaves open — the
   step-up/MFA factor-composition model, which it says "has no owner yet" —
   is the piece the strongest surveyed products (Supabase's assurance
   levels, Stytch's factor array, Descope's distinct-evidence rule) all own.
   Request: assign that owner and ship the composition/assurance model with
   the first production auth profile, including TOTP's inclusion in that
   profile.
5. **Passkey Tier 1 must be lifecycle-scoped — requests.** LLP 0151 correctly
   names the RP ID trap. Request: add progressive enrollment, conditional UI,
   multiple-key management, last-used metadata, admin revocation,
   user-verification evidence, and recovery to the tier definition.
6. **Credential ownership — confirms the matrix, requests runtime exposure.**
   0151 v0.3 already carries a per-provider credential-ownership matrix and
   recommends app-owned production credentials (Option D), consistent with
   this survey's finding that branding, suspension blast radius, redirect
   ownership, Apple team-scoped identities/private relay, and passkey RP IDs
   make a generic "graduate later" promise unsafe. Request: the runtime must
   expose who owns each credential (§Best ideas 3's inspection surface).
7. **Configuration should be declarative and capability-checked — requests.**
   LLP 0151 names provider tiers but not yet how an app declares a journey.
   Better Auth, Supabase local config, and Descope show complementary pieces;
   WorkOS shows the value of an installer that both modifies and verifies.
8. **Provider login vs provider API authorization — confirms.** 0151 v0.3's
   sign-in-only adapters discard provider tokens (with the pinned
   Apple-revocation carve-out), which is exactly the separation this survey
   recommends. The market evidence reinforces it: if an app requests Google
   Calendar or GitHub repository scopes, provider token custody and refresh
   are a separate secrets/product surface. Basic sign-in presets request only
   identity scopes.

## Proposed evaluation gates for a future Snapback design

A design derived from this research should not advance on a provider-count demo
alone. It should pass:

1. **Declaration gate:** one checked-in declaration selects mechanisms,
   providers, assurance, linking, and recovery without embedding secrets.
2. **Projection gate:** hosted/generated/headless surfaces and runtime inspect
   agree on the declaration and current environment readiness.
3. **Local gate:** two principals and a guest-upgrade journey work with no live
   third-party account and no network delivery.
4. **Production-config gate:** missing/incorrect redirect, domain, secret,
   provider status, and delivery posture each fail with a stable actionable code.
5. **Linking gate:** same/different verified emails, unverified email, absent
   email, private relay, and already-linked identity cannot cause silent takeover.
6. **Passkey gate:** stable RP, preview-domain refusal, progressive enrollment,
   multiple credentials, removal, lost-device recovery, and user-verification
   projection are exercised on every deployment arm and client surface that
   claims support — the corpus keeps those axes distinct (LLP 0064's client
   surfaces; LLP 0096's negotiated auth profiles over arm × lane tuples), and
   acceptance must report them separately, not as one "web and native" pair.
7. **MFA gate:** independent factor composition, pending-session confinement,
   recovery-code single use, reset/revocation, and step-up age are acceptance-
   tested.
8. **Abuse gate:** enumeration, credential stuffing, code guessing, resend
   storms, SMS pumping, OAuth replay/mix-up, and log/response secret exposure
   have bounded outcomes.
9. **Lifecycle gate:** provider key rotation, subject/profile change, provider
   deletion, app reset/restore, backup/export, and migration preserve or
   deliberately invalidate authority.
10. **Documentation gate:** every declared Tier 1 capability has a Guide page
    with verified snippets and an exact target/maturity row (LLP 0061's guide
    machinery is what makes this gate enforceable).
11. **Session-issuance gate (inherited from Draft LLP 0151/0077's
    contracts):** OAuth completion runs LLP 0151's bounded authorization
    transaction — sender-constrained completion-code redemption, with
    neither provider nor Snapback bearer tokens crossing redirect URLs —
    and hosted issuance carries LLP 0077's custody-key binding, with sender
    proofs on every protected request and connection open thereafter.
    Replay/mix-up fixtures alone do not cover this.
12. **Hosted-admission gate (inherited from Accepted LLP 0060):** hosted
    deployments satisfy LLP 0060's **complete admission conjunction**, in
    its own vocabulary — static deployment capability (edge
    confidentiality, effective-source derivation, shared multi-bucket
    throttling that charges malformed and unresolved attempts, globally
    fenced invalidation — a non-exhaustive floor), then hosted-auth
    capability (adding the sender-constrained client posture), then live
    admission (deployment attestation, live health, disabled operator
    surface, direct-bearer exclusion, and the mixed-version boundary). A
    deployment claims each level only when the whole conjunction for that
    level holds.

## Open research questions

1. What exact Microsoft preset should Snapback pave first: consumer Microsoft,
   Entra multi-tenant OIDC, or an organization-bound B2B shape — and what
   evidence (product strategy, telemetry, or an author pin) ranks
   Microsoft/GitHub ahead of Facebook/X for Snapback's actual target users?
2. Within the broker shape LLP 0151 has already pinned — it rejected a
   broker-issuer variant as graduation-lossy and pre-pinned a transparent
   Google-issuer relay, with "Expo as OIDC provider" its own open question —
   what subject-stability and credential-migration properties would an Expo
   service need for end-user identity, not just agent provisioning?
3. Which passkey RP-domain strategy works across Snapback preview URLs, EAS
   Hosting, custom domains, Expo native association files, and self-hosted apps?
4. Should Snapback execute WebAuthn itself or consume a narrowly scoped,
   replaceable component while retaining principal/session authority?
5. Which SMS verification services provide the right combination of global
   delivery, fraud controls, test credentials, portability, and cost visibility?
6. What assurance vocabulary should be portable between built-in factors and
   upstream OIDC `amr`/`acr` claims without trusting unrecognized issuer
   claims — and is it NIST-compatible, explicitly non-equivalent internal
   vocabulary, or per-profile mappings? (Email-code sign-in is not a NIST
   out-of-band authenticator, so a NIST-shaped label would overclaim.)
7. How should an app declare transactional guest-to-existing-principal merge
   behavior, and what rollback/authorization constraints apply?
8. How much auth-journey configurability can be admitted without recreating the
   hard-to-reason-about flow graphs of Keycloak/Auth0/Descope?
9. What export format preserves users and identity links while correctly
   excluding live sessions, OTPs, provider secrets, and non-exportable passkey
   private material?
10. A hands-on bakeoff remains valuable: build the same web + Expo app with
    WorkOS, Clerk, Supabase, Convex+provider, Firebase, and Better Auth; record
    time to local login, production Google/Apple, MFA, passkey, account linking,
    test automation, and provider removal. Documentation research cannot measure
    the last mile reliably.
11. What exact product claim constitutes the "first production auth profile" —
    sign-in only, upstream-MFA evidence accepted, or first-party MFA — and who
    owns the factor-composition design (§Implications item 4)?
12. Can production shared credentials ever be permitted, and if so, what
    requirements beyond acknowledgment make that safe? (§Best ideas 3 argues
    only LLP 0151's pre-pinned conditional broker contract could.)
13. When hosted UI, generated components, and headless configuration diverge,
    which checked-in declaration is authoritative, and what are the
    rollback/migration semantics of reconciling drift?
14. **Answered 2026-08-02:** external CIAM is a sibling paved path governed
    by LLP 0153's provider class; LLP 0151 remains focused on first-party
    identity integrations. Source:
    `issues/20260802-author-decision-packet.md`.
15. Which of the twelve evaluation gates are measurable with existing or
    already-proposed machinery — the capture mailbox exists today; the
    synthetic conformance IdP is proposed by LLP 0151; the auth acceptance
    personas and provider simulator are proposed by this Research — versus
    which need genuinely new infrastructure, i.e., how do the gates
    sequence against 0151's §Sequencing?
16. Where does WhatsApp OTP sit? The survey records it (Stytch, Descope) and
    0151's delivery seam deliberately does not assume phone-OTP ⇒ SMS, but
    the composite design and gates are silent on non-SMS phone challenge.

## Confidence

- **High** on product-supported mechanism/provider categories and configuration
  shapes: they come from official current documentation linked inline.
- **High** on the cross-product design conclusions around configuration drift,
  account-link identity, passkey RP binding, distinct factors, recovery, and
  production OAuth ceremony: multiple independent products and standards agree.
- **Medium** on relative ease rankings: the architecture and amount of required
  setup are observable, but team/framework familiarity strongly affects results.
- **Low-to-medium** on generalized practitioner sentiment: linked community
  reports are self-selected anecdotes and are used only to identify recurring
  friction, never as reliability or market-share measurements.
- **Time-sensitive** on plan gates, newest passkey features, named provider lists,
  and beta status. Re-check vendor docs before a normative Snapback RFC is
  accepted or implementation begins.
