# LLP 0153: External CIAM integration landscape

**Type:** Research
**Status:** Draft
**Systems:** Auth, External identity, Sessions, Organizations, Client integration, Developer experience, Security, Hosted delivery, Competitive analysis
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-02
**Revised:** 2026-08-02 (initial survey of meta-auth and third-party-auth integration patterns; official documentation checked on 2026-08-02); 2026-08-02 (v0.2, super-refine round 1: Fable READY moderate / Codex NOT READY wide; all 18 findings applied — bearer-originated exchange honesty, native sender-constraint GAP per LLP 0096, LLP 0060 admission budgets, org-switch split across LLP 0039/0059 vs 0053, impersonation removed from the generic permit list, per-token-kind audience rules, policy-valued capabilities, state cardinalities, profile support levels renamed against LLP 0151's tier contract); 2026-08-02 (v0.3, super-refine round 2: Fable READY narrow-to-moderate / Codex NOT READY narrow; rule 7 re-attributed to LLP 0060 D3's actual bucket mechanics with this route's additions marked [inference] and LLP 0031 route registration; provider_not_after_ms rescoped to LLP 0053's retained-authorization lease with derived-session provenance carrying the assertion not-after; key-confirmation vs nonce/jti split; per-surface sender qualification propagated to Model B, Level 0/1, gates, and bottom line; installation-scoped linking key made consistent; exchange-admission gate row added; table provenance narrowed honestly)
**Related:** LLP 0011, LLP 0031, LLP 0039, LLP 0053, LLP 0055, LLP 0057, LLP 0059, LLP 0060, LLP 0064, LLP 0077, LLP 0096, LLP 0150, LLP 0151, LLP 0152

## Summary

Snapback should make external customer-identity platforms—“meta-auth” or CIAM
providers such as Clerk, WorkOS AuthKit, and Auth0—a **paved provider class**.
It should not try to absorb their hosted login, enterprise SSO, SCIM/directory
sync, organization administration, fraud controls, or every recovery ceremony.
Those are exactly the reasons an app may already use one. Snapback should make
that existing identity system work with Snapback's stable principals,
sender-constrained sessions, authorization, live-query invalidation, local-first
clients, tests, and diagnostics without a user migration.

The best shape is **a standards-based verifier core plus thin named profiles**:

- a generic OIDC/JWKS verified-token integration is the substrate, not the
  whole product;
- named **Clerk** and **WorkOS AuthKit** profiles should be the first paved
  integrations;
- **Auth0** should follow as the broad installed-base enterprise profile;
- **Firebase Auth** and **Amazon Cognito** merit named compatibility profiles
  because their token and client conventions are common and not always the
  cleanest generic-OIDC path;
- **Supabase Auth**, **Stytch**, and **Descope** should initially be validated
  recipes over the generic substrate, promoted to named profiles when demand or
  a material protocol quirk justifies maintained code;
- **Keycloak, ZITADEL, FusionAuth, Kinde, Better Auth**, and other compliant or
  self-hosted issuers should work through generic OIDC/JWKS rather than each
  becoming a permanent Snapback product surface.

“Named support” must mean more than a logo. A named profile should provide:

1. issuer, audience, authorized-party, algorithm, and claim validation;
2. a client bridge that acquires and refreshes the right provider token;
3. transactional just-in-time principal linking by `(provider installation,
   issuer, subject)`;
4. optional organization and assurance-claim normalization with explicit
   freshness semantics;
5. coordinated logout, session expiry, lifecycle event reconciliation, and
   permission invalidation;
6. setup/doctor output, local fixtures, and acceptance tests that fail clearly
   when the external dashboard is misconfigured.

The recommended request path is **external token exchange**, not indefinite
pass-through. The provider SDK completes sign-in and obtains a short-lived
external token. Snapback verifies it, links or provisions the stable Snapback
principal transactionally, and mints its ordinary sender-constrained Snapback
session. The runtime never exposes the upstream token to handlers and never
stores the provider's refresh token by default. This preserves LLP 0011's
portable app authorization model and keeps LLP 0077's sender constraint for
what it actually covers: the *resulting* Snapback session is protected from
post-issuance credential copying, but the exchange itself is
**bearer-originated** — sender binding cannot prove that the presenter of a
reusable upstream bearer assertion is its legitimate owner (§Replay and
sender constraint). Sender-constrained issuance is also a **browser-web
capability today**: LLP 0096 records that no native sender-constraint story
exists yet, so native/Expo surfaces cannot claim it (§Client bridge).

There is a real cost: exchanging into a Snapback session creates two session
layers. An already-issued Snapback session does not consult the upstream token
at all — upstream suspension or logout becomes visible only when the
integration consumes lifecycle events, rechecks upstream on high-risk
operations, bounds the downstream session's own lifetime, or uses short
bounded leases. That trade-off should be explicit in capabilities and doctor
output, not hidden behind “supports OIDC.”

## Research question and boundary

This document asks:

- Should Snapback directly accommodate applications already using a CIAM
  product rather than asking them to migrate to Snapback identity?
- What do leading backend products actually do when another service owns login?
- What does generic OIDC/JWT verification solve, and what remains
  provider-specific?
- Which external providers deserve named, tested integration profiles?
- How should users, organizations, MFA evidence, logout, revocation, webhooks,
  and local testing cross the boundary?
- Which ideas belong in a future normative extension to LLP 0011/0151?

This is evidence and recommendation, not a protocol amendment. LLP 0011 remains
normative for stable Snapback principals, protected `_auth_*` state, safe account
linking, and app-owned authorization. LLP 0077 remains normative for hosted
browser sender constraints. LLP 0151 (Draft) carries provider sequencing; this
document recommends refining its tier-2 “BYOP verified-token hook” into a paved
class.

The survey prioritizes official documentation checked on **2026-08-02**.
Product behavior is marked `[observed]`; recommendations and deductions are
marked `[inference]`. Pricing is omitted because it is volatile and does not
change the protocol boundary, though providers may plan-gate organizations,
enterprise SSO, or machine identities.

## Terms: upstream identity is not Snapback authorization

**CIAM** here means a customer identity and access management platform that can
own the user's sign-up/sign-in journey, credentials, federation, and session.
“Meta-auth” is useful informal language: WorkOS or Clerk may themselves broker
Google, Apple, GitHub, passkeys, passwords, SAML, or another IdP, while Snapback
sees one upstream issuer.

Four identities must not be collapsed:

- the **upstream subject** is the provider's `sub` (or equivalent);
- the **Snapback principal** is the stable application actor from LLP 0011;
- an **organization** is an upstream tenant/membership context, not inherently
  a Snapback row-visibility rule;
- a **session** is a particular authenticated continuity claim and may exist
  independently in the upstream provider and Snapback.

The durable identity key is `(normalized issuer, subject)`, scoped by the
declared **provider installation** that binds issuer, tenant/team, and
registration ownership immutably — LLP 0151 pins that a `provider_key` is
sound only under exactly that binding, and reconfiguring a preset must never
silently reinterpret existing identity rows. Email is display and recovery
metadata. It is not a safe cross-provider identity key. This preserves LLP
0011's rule against automatic cross-provider same-email linking.

## What comparable backend platforms do

### Convex: accept specialist-issued tokens and keep the boundary small

Convex explicitly recommends third-party authentication for the complete
feature set—passkeys, MFA, spam protection, and related controls—and calls out
Clerk, WorkOS, and Auth0
([Convex auth overview](https://docs.convex.dev/auth/overview)). `[observed]`
The backend accepts OIDC ID tokens/JWTs, validates the configured issuer and
application ID, and makes verified identity claims available to functions.

Its named Clerk integration illustrates the full client/server bridge:

1. Clerk owns the redirect and sign-in UI;
2. a Clerk-aware React provider obtains a token;
3. `ConvexProviderWithClerk` passes it to Convex;
4. Convex retrieves the public key and validates the token;
5. the client bridge refetches the token as needed
   ([Convex + Clerk](https://docs.convex.dev/auth/clerk)). `[observed]`

The custom OIDC path needs issuer domain, application ID, ID tokens, and JWKS,
while Convex labels it advanced and recommends supported providers
([Convex custom OIDC](https://docs.convex.dev/auth/advanced/custom-auth)).
`[observed]` This is an important product lesson: a small generic protocol can
cover many issuers, while named client glue and diagnostics are what turn
protocol compatibility into an easy integration.

Convex's model is close to token pass-through. That is attractive because the
upstream token remains the current authentication fact and its short lifetime is
the staleness bound. Snapback cannot copy it mechanically: Snapback's hosted
browser protocol also binds its session to a client key and coordinates
auth-dependent local projections. `[inference]`

### Supabase: explicit third-party auth as an adoption feature

Supabase has first-class third-party-auth entries for **Clerk, Firebase Auth,
Auth0, Amazon Cognito, and WorkOS**. Existing production applications can use
those identities with the Data API, Storage, Realtime, and Functions without
migrating users or translating tokens into the historical Supabase JWT format
([Supabase third-party auth](https://supabase.com/docs/guides/auth/third-party/overview)).
`[observed]`

The integration trusts asymmetrically signed JWTs through an OIDC issuer
discovery URL and requires a `kid`. Supabase periodically checks provider keys;
the current documentation warns that rotation may take up to 30 minutes to be
observed and that Supabase Auth cannot yet be disabled. `[observed]` Those are
the sorts of limitations Snapback should expose as capabilities and diagnostics,
not bury in a setup guide.

The Clerk recipe demonstrates why a named profile matters. The user enables a
Clerk domain in `config.toml` or the dashboard, configures Clerk compatibility,
and supplies the Clerk session token from the client SDK
([Supabase + Clerk](https://supabase.com/docs/guides/auth/third-party/clerk)).
`[observed]` Supabase deprecated an older Clerk JWT-template integration that
shared a symmetric project secret; its reasons include dangerous secret
sharing, rotation downtime, and extra token-generation latency. `[observed]`
The clear lesson is to verify an upstream asymmetric token directly or exchange
it locally—never give a CIAM vendor Snapback's signing key.

### The older custom-token pattern: flexible, but easy to overuse

Firebase, Auth0, and many self-built systems can mint a custom token after a
server verifies some external credential. This can bridge nearly anything, but
the application must operate the exchange endpoint and decide identity linking,
replay protection, expiry, error taxonomy, and session invalidation. It is a
mechanism, not a complete third-party-auth product. `[inference]`

Snapback already needs a verified-external-assertion exchange internally. It
should expose a constrained provider interface and named profiles rather than
make every application rebuild that bridge in an ordinary mutation.

## Integration architecture choices

### Model A: pass the upstream bearer token on every request

The client obtains a short-lived CIAM token and sends it to Snapback requests and
WebSocket connections. Snapback validates issuer, audience, signature, and time
claims and derives identity directly.

**Advantages**

- one externally authoritative session fact;
- upstream token expiry naturally bounds stale authentication;
- no Snapback refresh token or parallel logout state;
- close to the successful Convex and Supabase patterns.

**Costs**

- a bearer token alone does not meet LLP 0077's sender-constrained browser
  requirement;
- every client surface must refresh and reconnect correctly;
- upstream token shape leaks toward runtime and handler abstractions;
- app initialization and offline projection depend more directly on the CIAM
  SDK;
- immediate upstream revocation still is not visible to offline JWT validation;
- an external token intended for one API can be incorrectly accepted by another
  unless audience/authorized-party validation is exact.

This model is useful reference prior art but should not be Snapback's hosted
browser default. `[inference]`

### Model B: exchange an upstream token for a Snapback session

The client obtains an upstream token, sends it to a server-owned Snapback auth
endpoint with the LLP 0077 key-binding ceremony, and receives an ordinary
Snapback session. Snapback validates the external token and transactionally
links or creates the principal before issuing the session.

**Advantages**

- preserves one session and auth-context shape inside Snapback;
- preserves sender constraint (on surfaces that have it — browser-web today,
  per LLP 0096), connection projection, offline identity, and
  authorization invalidation;
- provider tokens and custom claims do not reach normal handlers;
- stable Snapback principal IDs make providers replaceable and linkable;
- the server need not keep an upstream refresh token; the provider's client SDK
  may obtain a fresh assertion for a later exchange.

**Costs**

- there are two session layers and two logout operations;
- an upstream user/session revocation can lag until a Snapback lease expires or
  a lifecycle event invalidates it;
- Snapback must define how external assurance age caps the downstream session;
- changing upstream organization context may require a new exchange and
  reauthorization barrier;
- provider client SDKs may not expose the same token type on every platform.

This is the recommended default. A Snapback session derived from an external
assertion should never outlive the maximum policy bound declared for that
profile, and sensitive applications should be able to require a fresh external
exchange. `[inference]`

### Model C: Snapback owns the broker redirect and callback

Snapback redirects to the CIAM hosted UI, receives the authorization callback,
and mints its session. This gives web apps a single integration point and lets
Snapback enforce OAuth state, nonce, and PKCE centrally.

The cost is custody. Snapback must now hold CIAM OAuth client secrets and often
refresh tokens, implement native/deep-link variants, and participate in
provider logout. It also duplicates mature CIAM framework SDKs. This should be
an optional hosted convenience later, not the initial generic contract.
`[inference]`

### Model D: application-minted Snapback custom tokens

The app verifies its provider and uses an admin secret to mint a Snapback token.
This is a necessary escape hatch for legacy or non-OIDC systems, but it moves
the most security-sensitive logic into every application and creates an
attractive unrestricted-mint capability. It should be explicitly advanced,
audited, capability-limited, and never the paved Clerk/WorkOS flow.
`[inference]`

## What generic OIDC/JWKS solves—and what it does not

### The standards core can solve

- issuer discovery and JWKS retrieval;
- signature and algorithm validation;
- exact issuer, audience, and time validation;
- stable `sub` extraction;
- standard `email` / `email_verified`, `amr`, `acr`, `auth_time`, `azp`, and
  nonce claims where actually present;
- key caching and rotation;
- a common verified-assertion result for principal linking.

### A named profile still needs to solve

- which token to request: ID token, API access token, or provider session token;
- the expected audience/application ID and authorized-party semantics;
- SDK-specific acquisition and refresh on React, Expo/React Native, and other
  Snapback client surfaces;
- development and production issuer differences;
- nonstandard or versioned organization claims;
- meaningful MFA/step-up evidence and its freshness;
- pending/incomplete session states;
- session and user deletion events, replay/reconciliation facilities, and
  provider logout;
- local-development fixtures, dashboard instructions, and actionable errors;
- plan gates and unsupported combinations.

Generic OIDC is therefore the **compatibility floor**. A named integration is a
maintained, tested interpretation of the entire boundary. `[inference]`

## Provider comparison for Snapback

| Upstream identity system | Token / integration shape | Enterprise and organization value Snapback avoids rebuilding | Provider-specific work beyond generic verification | Recommendation |
|---|---|---|---|---|
| **Clerk** | Short-lived session JWT; JWKS/manual validation; browser and native SDKs; versioned compact org claims | Polished components/Account Portal, broad sign-in menu, organizations, enterprise connections, MFA/passkeys | Token acquisition adapters; `azp`; `fva` factor age; `sts: pending`; compact/versioned `o` claim; dev/prod instances; webhook/session events | **Paved profile, first wave** |
| **WorkOS AuthKit** | Access JWT + rotating refresh token; JWKS; hosted or custom UI; organization-selected sessions | Enterprise SSO, Directory Sync/SCIM-shaped lifecycle, organizations, admin widgets, audit/RBAC ecosystem | `client_id`/issuer details; org selection; role/permission policy; logout by `sid`; event cursor; authentication method may be exchange response rather than durable JWT claim | **Paved profile, first wave** |
| **Auth0** | Standards-oriented OIDC access token for a registered API; JWKS; mature SDKs | Broad social/enterprise connections, Organizations, Actions, adaptive MFA and risk features | Require API audience; tenant/custom-domain issuer; organization validation; namespaced custom claims; Actions/config drift | **Paved profile, second wave** |
| **Firebase Auth / Identity Platform** | Firebase ID token with project-scoped issuer/audience and Google-published keys; Admin SDK conventions | Existing mobile/web install base, phone auth, multi-tenancy/enterprise federation in Identity Platform | Firebase-specific issuer/audience and token refresh; emulator fixture; tenant claim; disabled-user/revocation check differs from offline JWT validation | **Named compatibility profile, second wave** |
| **Amazon Cognito** | OIDC-shaped user-pool JWTs with access-vs-ID token distinctions, `token_use`, client IDs, JWKS | Existing AWS estates, federation, managed UI, triggers, user-pool groups | Region/pool issuer; correct token kind; `token_use`; app-client audience/client ID; many IaC/dashboard surfaces | **Named compatibility profile, second wave** |
| **Supabase Auth** | Project JWTs; modern asymmetric keys/JWKS coexist with legacy symmetric configurations | Existing Supabase applications, social/phone auth, SAML, MFA | Detect unsupported symmetric legacy keys; project issuer/audience; SDK bridge; session refresh and logout recipe | **Validated generic recipe; promote on demand** |
| **Stytch** | Consumer/B2B session tokens and JWT/JWKS options; frontend/backend SDKs | Rich factor composition, B2B SSO/SCIM, fraud controls | Product/project distinctions; session-token vs JWT validation; org and factor claims; revoke/event semantics | **Validated recipe; named profile on demand** |
| **Descope** | OIDC/JWT and SDK session paths around visual flows | Flow builder, enterprise federation, risk/step-up, passkey journeys | Project/tenant claims; client refresh; authorization and assurance mapping | **Validated recipe; named profile on demand** |
| **Kinde** | OIDC/OAuth SDKs and JWTs | Organizations, SSO, feature flags/entitlements | Audience/org conventions and SDK bridge | Generic OIDC recipe |
| **Keycloak / ZITADEL / FusionAuth** | Self-hostable standards-based OIDC issuers | Self-custody, realms/organizations, federation and enterprise controls | Deployment-specific issuer/realm, claim mapper, rotation, logout | Generic OIDC recipe + conformance suite |
| **Better Auth** | App-owned auth library; can expose/bridge standards or mint app tokens depending configuration | Local ownership, plugin ecosystem, no separate hosted CIAM dependency | No single universal issuer contract across deployments; app owns keys and lifecycle | Generic OIDC where enabled; advanced custom verifier otherwise |

Table provenance: cells backed by this document's per-provider prose
citations (Clerk, WorkOS, Auth0, Supabase, Convex) or by LLP 0152's survey
(mechanism/journey facts) are `[observed]` at those anchors. The
token/JWKS/quirk cells for rows without an inline anchor here — Firebase,
Cognito, Stytch, Descope, Kinde, the self-hosted issuers, Better Auth — are
working characterizations from vendor documentation reviewed for this
survey but not re-anchored in either document; treat them as
`[inference — to be pinned per profile]`, which is also what the open
question on token kinds requires before any support-level claim. The
Recommendation column is `[inference]` throughout.

This ranking is not a quality ranking. It is a decision about which integration
contracts Snapback should continuously test and document. The provider-*class*
recommendation is stronger than the evidence for the exact Clerk → WorkOS →
Auth0 order, which is a judgment from complementarity and the Convex/Supabase
precedent, not a measured comparison. `[inference]`

## Why Clerk and WorkOS should be first

### They cover the likely “already a customer” cases

Both are designed to be the app's visible identity layer, not merely a social
OAuth endpoint. An app adopting Snapback after already shipping Clerk or WorkOS
has users, sessions, organizations, MFA enrollment, and enterprise connections
that would be expensive or impossible to migrate without disruption. A paved
bridge turns Snapback adoption into configuration rather than an identity
migration. `[inference]`

### They complement rather than merely duplicate Snapback

Clerk contributes broad consumer mechanisms, polished UI, session/client SDKs,
and organization UX. WorkOS contributes the B2B path from ordinary login through
enterprise SSO, directory lifecycle, and organization security. Those are large
product surfaces Snapback need not build before its data/runtime value is useful.

Convex independently recommends both for those complementary roles
([Convex auth overview](https://docs.convex.dev/auth/overview)), and Supabase
maintains first-class third-party-auth paths for both
([Supabase third-party auth](https://supabase.com/docs/guides/auth/third-party/overview)).
`[observed]` That is stronger evidence than either vendor's own positioning.

### Their tokens contain useful—but different—state

Clerk session tokens include issuer/subject/session claims, authorized party,
factor-verification ages (`fva`), and a compact active-organization object; the
documentation warns that organization encoding is versioned/compact and custom
claims should stay small
([Clerk session tokens](https://clerk.com/docs/guides/sessions/session-tokens)).
`[observed]` Manual validation also has an important pending-session case: a
valid token may carry `sts: pending` when the user has completed registration
but has an unfulfilled session task, such as joining an organization where
personal accounts are disabled
([Clerk JWT verification](https://clerk.com/docs/guides/sessions/manual-jwt-verification)).
`[observed]`

WorkOS access tokens include `sub`, `sid`, issuer, expiry and—when an
organization is selected—`org_id`, role, and permissions. Refresh can switch
organizations only after WorkOS checks membership, and logout should terminate
the WorkOS session by `sid`
([WorkOS sessions](https://workos.com/docs/authkit/sessions)). `[observed]`
Its authentication API separately reports an `authentication_method`, including
password, passkey, SSO, OAuth methods, Magic Auth, and impersonation
([WorkOS authentication API](https://workos.com/docs/reference/authkit/authentication)).
`[observed]` A profile must not pretend that field is continuously available in
every later access token if it is only present at exchange.

These differences are precisely why one generic “map these arbitrary claims”
form is insufficient as the easy path.

## Recommended Snapback contract

The following syntax is illustrative research, not an accepted public API:

```ts
export default snapback({
  auth: {
    external: {
      providers: {
        clerk: clerk({
          issuer: env("CLERK_ISSUER"),
          audiences: ["snapback"],
          allowedParties: [app.origin],
          organizations: "identity-only",
        }),
        workos: workos({
          clientId: env("WORKOS_CLIENT_ID"),
          issuer: env("WORKOS_ISSUER"),
          organizations: "mirror-membership",
          events: { apiKey: env("WORKOS_API_KEY") },
        }),
      },
      linking: "explicit-cross-provider",
    },
  },
})
```

The declaration should compile into four artifacts:

1. a server verifier/exchange configuration;
2. generated client bridges for installed provider SDKs;
3. a capability/doctor report with external-console actions;
4. deterministic test fixtures and acceptance personas.

### Exchange endpoint

Conceptually:

```ts
const session = await snapback.auth.exchangeExternal({
  provider: "clerk",
  assertion: await clerk.session.getToken({ template: "snapback" }),
  binding: await snapback.auth.createBindingProof(),
})
```

The endpoint should:

1. select only a declared profile—never trust a provider name from an
   unbounded discovery URL;
2. validate protected headers, asymmetric algorithm, `kid`, issuer, audience,
   authorized party when applicable, time claims, token kind, and profile state;
3. derive the external identity solely from verified claims;
4. reject pending, wrong-tenant, or insufficient-assurance states unless the
   declaration explicitly permits them — and reject **impersonated** assertions
   unconditionally on this path (§Impersonation and support sessions; no
   configuration boolean may route an impersonated upstream session through
   ordinary session issuance);
5. transactionally look up the identity under its declared provider
   installation — `(provider installation, issuer, subject)` — create/link the
   stable principal if policy permits, and record minimal audit metadata;
6. mint the normal Snapback sender-constrained session (browser-web surfaces;
   see §Client bridge for the native gap) and trigger the ordinary
   projection/authorization barrier;
7. charge **admission budgets before any verification work**, following LLP
   0060 D3's shared-throttling mechanics exactly: every attempt — including
   malformed and unresolved assertions — charges global and effective-source
   buckets; bounded canonical parsing adds claimed-subject and
   source×subject buckets **only when a subject is parseable**; successful
   resolution adds family/user buckets; the complete applicable set is
   charged atomically in one limiter transaction, including on denial
   (0060's v1 contract is charge-on-denial, no rollback), with bounded
   privacy-preserving bucket keys, stable throttle refusal codes, and
   fail-closed behavior when the limiter itself is unavailable. Two pieces
   are this route's additions, not LLP 0060 text `[inference]`: the bounded
   JWT parse before signature work and per-issuer JIT-provisioning quotas,
   extending LLP 0151's abuse-budget family. The exchange route is
   registered in LLP 0031's route taxonomy and owes LLP 0060's abuse
   acceptance coverage (source spray, identity spray, malformed-credential
   charging, limiter failure).

No profile should accept a raw social-provider access token obtained through
the CIAM product (a token whose audience is Google, GitHub, or another
upstream resource server). Beyond that prohibition, a single audience rule
cannot cover the token kinds this document recommends; validation is pinned
**per profile and token kind**:

- **API access token** (Auth0-style): exact Snapback/app API resource
  audience;
- **ID token** (Firebase-style): exact registered relying-party/client
  audience plus `azp` rules;
- **provider session token** (Clerk-style): the provider's documented
  application/authorized-party semantics;
- **Cognito/Firebase-style quirks**: their explicitly pinned client/project
  fields and `token_use`-class discriminators.

### Client bridge

A named integration should ship provider-specific token acquisition, refresh,
and auth-change listening for the supported client surfaces. Convex's
`ConvexProviderWithClerk` refetches tokens and keeps backend auth state
synchronized `[observed]`; it is, in this document's judgment, the clearest
precedent, because the alternative is every app writing the same race-prone
effect by hand. `[inference]`

The bridge must also be honest about **sender constraint per surface**. LLP
0077's custody key is a browser WebCrypto capability, and LLP 0096 pins the
consequence: off-browser sender-constraint is not defined yet, a native
client cannot claim `auth/sender`, and a sender-constrained deployment
cannot admit native clients to protected surfaces. An external profile
therefore reports sender support per client surface and OS; until the native
story lands, the sender-constrained exchange is proven on browser web, and
Expo/native consumption runs under the corresponding non-sender posture
(local, or whatever hosted admission policy LLP 0060/0096 then permits) —
it must not be advertised as equivalent.

The bridge should distinguish:

- provider UI/session loaded;
- upstream signed out;
- token temporarily unavailable during refresh;
- external token valid but Snapback exchange rejected;
- Snapback session active but upstream state changed;
- organization context changed and requires re-exchange.

“Loading” must not transiently become anonymous and leak into optimistic
execution or live-query subscriptions.

### Principal creation and profile data

First login must provision from the verified request in one Snapback transaction.
It must not wait for `user.created`. Clerk's own webhook documentation warns that
webhooks are asynchronous, may fail, and should not be required to complete an
onboarding flow
([Clerk webhooks](https://clerk.com/docs/guides/development/webhooks/overview)).
`[observed]`

Store only what Snapback needs for identity and audit — and store it at the
right cardinality. Three scopes must not be collapsed onto one row:

- **identity link** (one per external identity): provider-installation key and
  normalized issuer, upstream subject, verified-email value and verification
  fact at link time if relevant, claim/profile version, last verification
  time, active/disabled state. The immutable tenant/team binding lives on
  the provider installation, not here; the *active* organization is session
  context, not identity;
- **derived-session provenance** (one per Snapback session/family minted from
  an exchange): the upstream session ID (`sid`-class) that produced it — so a
  one-session upstream revocation can revoke exactly the derived families
  rather than the whole identity, and a user may hold concurrent upstream
  sessions with different active organizations — plus the active
  organization context asserted at exchange and the assertion's not-after
  (which later retained-authorization lease issuance consumes, §Replay);
- **provider-installation state** (one per configured installation): the
  lifecycle event cursor, dedupe records, and reconciliation checkpoints — a
  cursor spans many identities and cannot live on an identity link.

This is protected `_auth_*`-class state, and LLP 0057's auth catalog is
exact-versioned with no implicit migration — landing it is a catalog-version
bump with an explicit migration, which the adoption sequence must carry as a
real step, not an implementation detail.

App-visible names, avatars, bios, and memberships belong in app tables if the app
needs to query or sync them. Clerk similarly recommends a local table when an app
needs queryable data about other users and warns that webhook copies are
eventually consistent
([Clerk data syncing](https://clerk.com/docs/guides/development/webhooks/syncing)).
`[observed]`

### Organizations and roles

An upstream organization assertion proves that the issuer placed this session in
an organization context. It does not by itself define Snapback authorization.
The default profile should expose the organization as **identity context only**
and keep row visibility in app-owned membership tables.

Three explicit modes are plausible:

- `ignore`: authenticate the person and discard organization context;
- `identity-only`: retain normalized provider/org identifiers for app logic and
  audit, but grant no roles;
- `mirror-membership`: reconcile declared upstream memberships into protected or
  app-owned membership rows, with a documented freshness and invalidation bound.

Directly treating a provider `permissions` array as permanent Snapback
authorization should not be a default. JWT claims can be stale until refresh,
provider roles can change meaning, and multiple organizations require an active
context. Auth0 explicitly requires validating organization claims against an
expected/trusted organization
([Auth0 organization tokens](https://auth0.com/docs/manage-users/organizations/using-tokens)).
`[observed]`

If role mapping is enabled, it should be allowlisted, versioned, observable, and
fail closed. An organization switch is not a cosmetic dropdown update, and the
corpus splits it into two distinct mechanisms that must not be conflated:

- **changing the session's identity context** is an authority transition —
  LLP 0053 explicitly excludes session-authority changes from its
  authorization-event path and assigns them to LLP 0039's `AuthCoordinator`,
  and LLP 0059's same-user/different-session rule then blanks
  session-dependent results, strands the predecessor queue, and
  fresh-snapshots over a new connection;
- **reconciling mirrored membership rows** is a `permissionBacking` write
  governed by LLP 0053's ordinary invalidation, which is also what
  `mirror-membership` mode's freshness/invalidation bound means concretely.

A related consequence: LLP 0053 permits retained/offline authorization to
depend only on `userId`, so any result whose visibility depends on the active
organization context is not retainable and must be projected through the
session-scoped path.

### MFA, passkeys, and step-up

The upstream provider should continue to own enrollment, recovery, and the
interactive step-up ceremony. Snapback should consume only trustworthy evidence
and express requirements in provider-neutral terms:

```ts
requiresAssurance({
  phishingResistant: true,
  maxAuthenticationAge: "10m",
  secondFactorAge: "10m",
})
```

The adapter may satisfy this from standard `amr`, `acr`, and `auth_time`, or from
a named claim such as Clerk's `fva`. If the provider cannot prove a requested
property, the capability compiler should refuse that policy rather than infer it
from “MFA enabled” dashboard state.

WorkOS's authentication-method response can identify a passkey or SSO login, but
the profile must define whether and how that evidence survives into later token
exchanges. “Passkey enabled for the tenant” is not proof that this session used a
passkey. Similarly, an upstream MFA claim does not automatically prove
phishing resistance: SMS/TOTP and WebAuthn have different properties.

Step-up requires a client callback into the upstream SDK or hosted page, then a
fresh exchange. That callback is one of the most valuable pieces of named
integration glue and should be tested per provider.

### Logout, revocation, and stale sessions

Logout has two targets:

1. revoke/clear the Snapback session and wipe its local auth-dependent state;
2. terminate or redirect through the upstream provider's logout where the app
   requests global sign-out.

The API should distinguish `local` from `upstream` logout. Always doing global
logout can unexpectedly sign a user out of sibling applications; never doing it
can make a user appear to sign straight back in. A local logout must also
suppress automatic re-exchange until an explicit user action — otherwise an
intact upstream session immediately signs the user back in and local logout is
a no-op in practice.

Offline JWT verification cannot see immediate server-side revocation. A profile
must declare its revocation posture:

- external assertion maximum age;
- downstream Snapback session/lease maximum age;
- whether session/user lifecycle events are consumed;
- whether high-risk operations require online revalidation or fresh exchange;
- what happens when JWKS refresh fails.

A suspended or deleted external identity should deactivate the identity link and
revoke derived Snapback sessions, but must not cascade-delete application data,
matching LLP 0011. The application owns retention/deletion policy.

### Events, webhooks, and reconciliation

Lifecycle integration is valuable for user disable/delete, organization
membership changes, and upstream session revocation, but it is not the source of
truth for first-login provisioning.

The runtime-owned receiver should provide:

- signature verification over the exact raw body before parsing;
- body-size and clock/replay bounds;
- event-ID idempotency;
- monotonic version/timestamp conflict handling;
- retry-safe transactions;
- explicit unknown-event handling;
- a reconciliation cursor or scheduled repair path;
- metrics for lag, retries, poison events, and last successful reconciliation.

WorkOS recommends its Events API over webhooks for many synchronization jobs
because the API provides controlled consumption, consistent ordering, and replay,
while received webhook order is not guaranteed
([WorkOS data syncing](https://workos.com/docs/events/data-syncing)).
`[observed]` A WorkOS named profile should prefer the cursor-driven Events API
for membership/directory mirroring and use webhooks primarily as a low-latency
wake-up signal. Clerk exposes signed webhook delivery, replay, and retry, while
warning that it is asynchronous; its profile needs an independent reconciliation
story for security-relevant state. `[inference]`

### Impersonation and support sessions

Some CIAM systems can issue impersonated/support sessions. WorkOS documents an
`impersonator` object and an `Impersonation` authentication method in relevant
authentication responses
([WorkOS authentication API](https://workos.com/docs/reference/authkit/authentication)).
`[observed]` These sessions must not silently become ordinary Snapback
principals. The generic exchange path **rejects them unconditionally**
(§Exchange endpoint rule 4); if support sessions are ever wanted, they enter
through a separately specified authority kind with actor/effective-principal
provenance, audit, restricted scopes, distinct client projection, and defined
invalidation — not through a configuration boolean on ordinary session
issuance, and not as a provider role string.

### Machine identities

CIAM products commonly issue machine-to-machine tokens alongside human
session tokens. `[inference — market pattern]` They should not enter the human
external-provider path merely because they have `sub`, `iss`, and `aud`. A
profile must distinguish human session tokens, service principals, and
delegated agent tokens. In the Snapback corpus, LLP 0055 owns agent
principals, grants, and scoped tokens, and LLP 0150 owns their acquisition
and consent ceremony; a future service-identity contract should either extend
LLP 0055's principal kinds or define its own, but must not ride the human
exchange path.

## Configuration and developer experience

### One declaration, three surfaces

The same auth declaration should drive:

- **hosted UI/client helpers**: provider buttons or adapters that know how to
  get an assertion and exchange it;
- **server enforcement**: immutable issuer/audience/claim rules and session
  bounds;
- **operations**: secrets, dashboard callback/origin checklist, event endpoints,
  capability report, and production gates.

Provider secrets must remain deployment configuration and stay out of exported
bundles. Public issuer/client identifiers may be generated into client config.

### Named setup should be mechanical

For Clerk, a setup command should be able to detect the framework, install the
matching bridge, add the provider wrapper, declare issuer/audience, and print the
exact Clerk dashboard settings still requiring a human. For WorkOS, it should
also print application redirect/logout URLs, organization mode, event cursor or
webhook setup, and custom-domain issuer consequences. Every automated change
should be reviewable as a normal diff.

Development and production must be separate profiles. Clerk has distinct
development and production instances; WorkOS applications/environments have
their own IDs, redirect URIs, credentials, and session policy. A production
build must refuse shared/test credentials, localhost origins, missing audience,
or an unverified callback/event route where the provider requires one.

### Doctor output should answer “why am I anonymous?”

At minimum:

- provider declaration loaded / missing;
- client bridge installed and upstream SDK ready;
- issuer discovery/JWKS reachable and cache age;
- observed token issuer, audience, authorized party, token kind, and expiry
  compared to expected values, with personal claims redacted;
- exchange accepted/rejected by stable refusal code;
- principal link found/created/conflicted;
- session binding and projection barrier complete;
- upstream/Snapback auth-state mismatch;
- organization or assurance requirement not satisfied;
- lifecycle reconciliation lag and last provider event.

The common failure should say “Clerk token audience is `foo`; Snapback expected
`snapback`—change this setting at …,” not “unauthorized.”

### Local development and tests

A live external dashboard must not be required for deterministic acceptance
tests. Each named profile should ship a local asymmetric test issuer or signed
fixture harness that exercises the exact validation path, including:

- valid existing and first-login subjects;
- wrong issuer/audience/authorized party;
- expired/not-yet-valid token and clock skew;
- unknown and rotated `kid`;
- pending-session state (unfulfilled session task after completed
  registration);
- organization switch and removed membership;
- insufficient/stale MFA evidence;
- deleted/disabled user event;
- replayed, duplicated, and out-of-order lifecycle events;
- identity collision and forbidden cross-provider email link;
- provider logout while Snapback is offline;
- JWKS endpoint unavailable with cached valid and expired keys.

Provider sandboxes remain necessary for contract tests, but ordinary app tests
should select personas such as `clerk.member.mfaFresh` without a network call.

## Security requirements and watch-outs

### Token confusion

The verifier must pin exact issuer, intended audience, authorized party where
defined, acceptable token type/use, and an asymmetric algorithm allowlist. Auth0
emphasizes that an access token is for the API whose audience it names and that
the API must validate that audience
([Auth0 access-token validation](https://auth0.com/docs/secure/tokens/access-tokens/validate-access-tokens)).
`[observed]` Accepting “any correctly signed token from this tenant” is not
enough: ID tokens, access tokens for another API, and machine tokens can share a
signer.

Never accept an issuer URL supplied inside the untrusted request and then fetch
its discovery document. That is both a trust-confusion and SSRF surface.

### Key rotation and outage behavior

JWKS caches need positive and negative caching, bounded refresh, single-flight,
algorithm/key-use checks, and an explicit stale-key policy. An unknown `kid` may
trigger one refresh but must not let attackers force unlimited network calls.
Previously cached keys can remain usable only for a declared window; an expired
cache plus unreachable issuer should fail authentication closed while producing
an operationally distinct error.

Key rotation behavior belongs in the acceptance contract. Supabase's published
third-party-auth limitation—periodic key checks with possible delay—shows how a
small implementation detail becomes a production outage window. `[observed]`

### Replay and sender constraint

The external JWT is normally a bearer credential, and honesty about what each
mechanism protects is part of the contract. Four things must be kept separate:

- **the exchange is bearer-originated**: whoever presents a valid upstream
  assertion passes verification. An attacker holding a copied CIAM JWT can
  generate their own client key and their own valid binding proof — LLP 0077's
  issuance proof binds only the newly created Snapback family to the
  presenter's key; it cannot authenticate ownership of the upstream token;
- **sender binding of the resulting session** is what LLP 0077 does provide:
  after issuance, copied Snapback credentials are useless without the
  non-extractable client key;
- **provider-signed key confirmation** (an upstream token bound to the
  Snapback client key) is the only mechanism that proves the presenter
  controls a bound key — it exists only where a provider supports it, a
  capability fact, never an assumption. Nonce or `jti` single-use
  consumption is weaker and different: it enforces freshness and
  single-use, but a stolen bearer assertion can still win the first use;
- **bearer-origination policy** covers the rest: maximum assertion age,
  `jti` single-use tracking where present, an explicit downstream-session
  expiry policy (whether the assertion caps the session is OQ1 — a profile
  policy value, not settled corpus machinery), and the §Exchange endpoint
  admission budgets. What the corpus *does* already settle is one level
  down: LLP 0053's `AuthorizedLease` clamps **retained/offline
  authorization** to `provider_not_after_ms` when the provider assertion
  has an expiry — so the exchange must record the assertion's not-after in
  derived-session provenance for later lease issuance to consume.

Exchange is accepted only over TLS. The system should not log the assertion or
store it in app tables.

### Account linking

The installation-scoped key — `(provider installation, issuer, subject)` —
is authoritative. Same-email linking across profiles is
explicit and requires fresh proof of the existing account; provider-asserted
`email_verified` is evidence for contact ownership within a profile, not global
personhood. Issuer/custom-domain changes require an operator-declared migration,
not automatic subject re-keying.

### Claim bloat and cookies

Organization memberships, roles, and arbitrary metadata do not belong wholesale
in downstream sessions. Clerk recommends keeping custom token claims under a
small size and storing larger/queryable data in the application database
([Clerk session tokens](https://clerk.com/docs/guides/sessions/session-tokens)).
`[observed]` Snapback should normalize only the minimum auth context and look up
app authorization locally.

### Event races and deletion semantics

Never require a webhook-created user row before exchange. Never cascade-delete
app data on an external `user.deleted`. Treat events as retryable facts with
provider-specific ordering rules. A delete followed by a delayed update must not
silently reactivate an identity.

### Upstream availability and lock-in

External login and fresh step-up depend on the upstream provider. Existing
Snapback sessions can continue only within the declared stale-auth bound. Stable
Snapback principals, multiple identity links, provider-independent app roles,
and exportable identity mappings are the escape hatch; raw provider claims in
application schema or permission rules are lock-in.

## Capability model

A provider profile should report machine-readable capabilities rather than one
boolean:

```ts
type ExternalAuthCapabilities = {
  token: {
    kinds: ("id" | "access" | "session")[]
    asymmetric: boolean
    rotation: "discovery" | "static-jwks" | "manual"
    maxAssertionAgeSeconds: number
    singleUse: "jti" | "provider-nonce" | "none"
  }
  client: {
    // per client surface (LLP 0064/0096 vocabulary), not one boolean
    web: { supported: boolean; senderConstrained: boolean }
    expo: { supported: boolean; senderConstrained: false } // until LLP 0096's
    native: { supported: boolean; senderConstrained: false } // native story lands
    automaticRefresh: boolean
  }
  session: {
    downstreamMaxAgeSeconds: number       // policy value, not a boolean (OQ1)
    onlineRevalidation: boolean           // high-risk ops can recheck upstream
  }
  retainedAuthorization: {
    providerNotAfterClamp: true           // LLP 0053's AuthorizedLease clamp:
                                          // offline authorization, not the
                                          // session, is what it bounds
  }
  assurance: {
    amr: boolean
    authTime: boolean
    factorAge: boolean
    stepUp: boolean
    phishingResistanceProvable: boolean
  }
  organizations: {
    activeContext: boolean
    membershipEvents: boolean
    orderedReplay: boolean
  }
  lifecycle: {
    userDisable: boolean
    sessionRevoke: boolean
    reconciliation: "none" | "webhook" | "cursor"
    revocationLagBoundSeconds: number     // the staleness bound, quantified
  }
  keys: {
    staleKeyWindowSeconds: number
    jwksOutage: "fail-closed"             // with a distinct operational error
  }
}
```

The policy-valued fields are the point: the summary's revocation-lag trade-off
and §Logout's posture questions are answerable only if profiles expose numbers
and enums, not feature booleans. Generated APIs should refuse to promise a
feature the profile cannot prove. For example, generic OIDC with no
`auth_time` cannot satisfy a ten-minute fresh-auth policy; a webhook-only
profile cannot claim immediate revocation; a profile with
`senderConstrained: false` on a surface cannot claim LLP 0077's posture there.

## Recommended support levels

A naming caution first: LLP 0151 already defines "Tier 1" as a contract with
specific witnesses — both deployment arms, a client-surface matrix, and
guide/fixture/demo/capability evidence per row. The levels below are
**external profile support levels**, not that contract; where an external
profile claims LLP 0151-style Tier 1, it owes the same witnesses (guide page,
fixtures, demo, capability-index row) across the deployment arms and client
surfaces it names. These are also roadmap targets, not current support: no
provider is at any level until its acceptance gates pass.

### Level 0: universal external-assertion substrate

- declared issuer(s), audience(s), authorized parties, token kind, and algorithm;
- OIDC discovery or pinned JWKS;
- strict JWT validation and key rotation;
- transactional stable-principal linking;
- Snapback session exchange — sender-constrained on surfaces that support it
  (browser-web today), with per-surface posture reported honestly;
- generic standard-claim mapping;
- conformance fixtures and doctor output;
- advanced custom verifier only behind a narrower privileged interface.

This must land before named profiles so profiles remain data/behavior adapters,
not parallel auth implementations.

### Level 1: paved and continuously tested

1. **Clerk** — best first consumer/developer-facing profile; a strong fit for
   React web apps today, and for Expo once LLP 0096's native
   sender-constraint story (or an explicitly non-sender hosted posture)
   makes the per-surface claim honest.
2. **WorkOS AuthKit** — best first B2B/enterprise-facing profile and the reason
   not to block Snapback adoption on native SAML/SCIM/org administration.
3. **Auth0** — follow once the contract is proved; broad installed base and
   enterprise depth justify maintained compatibility despite more setup surface.

Each level-1 integration includes client bridges, setup automation, provider
dashboard guide, assurance/org handling, logout, lifecycle reconciliation,
fixtures, and hosted acceptance.

### Level 2: named compatibility profiles

- **Firebase Auth / Identity Platform**;
- **Amazon Cognito**.

These should get explicit verifier presets and client recipes because of usage
and token quirks. Rich organization/MFA/lifecycle normalization can remain
limited until demanded.

### Level 3: validated recipes over generic OIDC/JWKS

- Supabase Auth;
- Stytch;
- Descope;
- Kinde;
- Keycloak, ZITADEL, FusionAuth;
- Better Auth when configured as a standards-compliant issuer.

A recipe means an acceptance test in the compatibility suite, pinned settings,
and guide page—not a provider-specific runtime dependency. Promote a provider
when telemetry/customer demand or a real semantic quirk requires a maintained
adapter.

## What Snapback should not build yet

Paved external CIAM support changes the build-vs-buy boundary. Snapback need not
make these prerequisites for adoption:

- arbitrary enterprise SAML connection administration;
- SCIM/Directory Sync connectors for every directory vendor;
- organization invitation/admin portals;
- risk engines, bot/fraud/device intelligence;
- every MFA enrollment and recovery UI;
- support-user impersonation workflows;
- exhaustive social-provider integrations.

Snapback still needs a strong built-in baseline from LLP 0151/0152: local email
code, guest upgrade, leading social presets, passkeys/recovery direction, and a
provider-independent assurance model. External CIAM must be an option for richer
requirements, not the only way to get safe auth.

## Decision rubric for adding a named profile

A provider earns named support when several of these are true:

- meaningful existing-customer demand would otherwise require migration;
- it supplies major capability Snapback intentionally does not build;
- its token/client/lifecycle behavior cannot be represented honestly by a short
  generic recipe;
- it has stable public issuer/JWKS and test/sandbox contracts;
- it supports Snapback's target client surfaces (LLP 0064's vocabulary);
- lifecycle and revocation behavior can be tested;
- the vendor surface is stable enough for Snapback to own compatibility;
- the adapter can remain thin and does not require provider SDK code in the
  Snapback runtime.

Logo breadth is not the rubric. A long untested list is worse than generic OIDC
plus three excellent profiles.

## Proposed adoption sequence

1. Amend LLP 0151's “BYOP verified-token hook” concept into an explicit external
   assertion/session-exchange capability with the LLP 0077 binding requirement
   (browser-web) and the LLP 0060 admission-budget requirement.
2. Build the generic OIDC/JWKS verifier and conformance harness, and land the
   external-identity state model as an explicit LLP 0057 catalog-version
   migration (§Principal creation and profile data).
3. Prove **Clerk** end to end — **web first, under sender constraint**: token
   refresh, pending state, organization switch, `fva` step-up, logout, and
   webhook reconciliation. The Expo/native leg follows under the non-sender
   posture LLP 0096 permits at that time, and is not claimed as paved until
   its per-surface capability row is honest (§Client bridge).
4. Prove **WorkOS AuthKit**: selected organization, event cursor, role mapping
   off by default, support-session refusal, logout by `sid`, and enterprise SSO
   remaining entirely upstream.
5. Add **Auth0**, using an API access token with exact audience and trusted
   organization validation.
6. Add Firebase/Cognito verifier profiles and publish generic recipes.
7. Use compatibility telemetry and concrete customer requests to decide which
   recipes graduate.

The proving demo should begin as an app already using Clerk or WorkOS, add
Snapback without migrating a user, open a user-scoped live query, switch
organization or revoke membership, and demonstrate the fail-closed projection
barrier and local-state quarantine.

## Acceptance gates for a paved profile

A provider is not “supported” until all applicable rows pass:

| Gate | Required evidence |
|---|---|
| Token validation | Positive and negative issuer/audience/party/type/time/algorithm/key-rotation fixtures |
| Identity | Transactional first login, stable reconnect, collision, explicit linking, issuer migration refusal |
| Session security | LLP 0077 binding on browser-web (per-surface capability rows govern other surfaces); no provider token in handlers/logs; bounded downstream lifetime |
| Exchange admission | LLP 0060 abuse coverage: source spray, identity spray, malformed-assertion charging, limiter fail-closed; per-issuer JIT-provisioning quota fixtures; duplicate-`jti`/nonce-reuse and copied-bearer first-use cases |
| Client lifecycle | Loaded, refresh, expiry, upstream logout, reconnect, offline/online transitions |
| Organizations | Active-context validation, switch barrier, membership removal, stale-claim behavior |
| Assurance | Fresh/stale/absent factor evidence; provider-owned step-up; unsupported requirements refuse |
| Lifecycle | Signed/idempotent events, retry/replay/order, reconciliation, disable/delete without data cascade |
| Operations | Dev/prod isolation, setup checklist, secret redaction, JWKS outage/rotation diagnostics |
| Portability | Stable Snapback principal, multiple identity links, exportable mappings, app-owned permissions |
| Documentation | CI-verified guide snippets and provider-dashboard walkthrough current against a sandbox |

## Open questions

- Should a downstream Snapback session expire no later than the external token,
  or may a short independently bounded session survive token expiry until the
  next reconnect? Security and offline usability pull in different directions.
- Given that an ordinary provider bearer token cannot be bound at exchange
  (§Replay), which named providers offer true upstream key confirmation
  versus only nonce/`jti` single-use freshness, what theft/replay guarantee
  does each actually provide, and what stricter default lifetime should a
  purely bearer-originated exchange carry?
- Which client token should each provider issue specifically for Snapback: an ID
  token, provider session token, or API access token? The answer must be pinned
  per profile, never inferred.
- Is `mirror-membership` runtime-owned protected state or an app-generated table
  with a standard handler? How does it compose with app-created memberships?
- Which upstream event types require immediate LLP 0053 authorization
  invalidation, and which are profile-only metadata updates?
- Can a provider-neutral assurance vocabulary express Clerk `fva`, OIDC
  `amr`/`acr`/`auth_time`, WorkOS authentication methods, and future device
  posture without false equivalence?
- Should upstream global logout be the default in hosted UI, or an explicit
  user choice distinct from “sign out of this app”?
- What minimum sandbox uptime and compatibility SLA is required before a recipe
  becomes a named profile?
- Should Supabase Auth be promoted immediately because Snapback's target users
  are likely to arrive from Supabase, even if the generic recipe is technically
  sufficient?
- How will external identity work for a fully offline first launch? A cached
  Snapback session can establish local continuity, but fresh external proof is
  necessarily online.
- Which normative document owns the external-exchange route — a new spec, or
  dated amendments extending LLP 0057's provider protocol and LLP 0077's
  issuance ceremony?
- What is the stable provider-installation identifier, and how is an
  issuer/custom-domain reconfiguration migrated without splitting existing
  principals? (LLP 0151's immutable-binding rule constrains the answer; the
  migration mechanism is unowned.)
- How are throttle buckets derived before verification without trusting
  attacker-controlled issuer/subject claims — bounded parse of claimed values,
  connection-level identity only, or both?
- Which native sender-constraint specification and per-OS evidence must land
  before Clerk or WorkOS can be called paved on Expo (LLP 0096's GAP)?
- Can an external CIAM identity claim a **guest principal**? LLP 0151 makes
  guest upgrade tier-1 for built-in mechanisms; whether the exchange
  endpoint's create/link step owns the guest-claim transition (session
  rotation, collision refusal, quarantine semantics) or claiming stays
  restricted to built-in mechanisms is undecided — and it is exactly the
  "add Snapback to an existing app" adopter's path.
- What are reset, backup, logical export/import, and retention semantics for
  provider-installation state: event cursors, dedupe records,
  derived-session provenance, and disabled identity links?

## Bottom line

Yes: Snapback should make WorkOS, Clerk, and similar systems easy to use because
they let existing customers adopt Snapback without replacing identity and let
new customers buy enterprise-grade capabilities Snapback should not rush to
reimplement.

The product promise should be precise:

> Bring the identity system you already use. Snapback verifies it, maps it to a
> stable portable principal, preserves Snapback's session and local-first
> security model, and keeps application authorization yours.

Implement that promise with a generic asymmetric OIDC/JWT exchange core, first-
class Clerk and WorkOS profiles, then Auth0, Firebase, and Cognito according to
the support levels above. The differentiator is not accepting JWTs. It is making the
cross-system lifecycle—setup, refresh, identity linking, organizations, step-up,
revocation, local projections, tests, and diagnostics—coherent and difficult to
misconfigure.
