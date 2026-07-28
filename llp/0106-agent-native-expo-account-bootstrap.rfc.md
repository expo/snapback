# LLP 0106: Agent-native Expo account bootstrap

**Type:** RFC
**Status:** Accepted
**Systems:** Developer experience, Expo accounts, Identity, Auth, Agent tooling, Provisioning, Billing, Payments, Security, Audit
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Revised:** 2026-07-28 (initial draft after Snapback and Universe source review and primary-source standards research); 2026-07-28 (/llp-super-refine round 1 revision: claim URL pinned as an acknowledged bearer ownership capability with confirmation/notification/hold-reversal/recovery; normative trusted-host account-linking rule + identity-creation liveness gate + canonical signed request digest; orthogonal durable state dimensions with pinned transaction boundaries; normative RFC 9449 proof/replay contract grounded on Universe's jti/nonce gap; flow-letter consistency, RFC 8628 UX-vs-wire scoping, RAR/token-exchange Expo profile, pre-claim owner-of-record + 0104 amendment, escrow-source claim vs 0103, local-only discovery, Slice-0-gates-Slice-2, CIMD SSRF); 2026-07-28 (/llp-super-refine round 2 revision: bearer-claim recovery authority + evidence hierarchy anchored on the bootstrap-request key holder for the no-contact-hint case; workspace stays PROVISIONAL through the hold with the 0103/0104 cutover pinned to the single CLAIM_COMMITTING transition and CLAIM_HELD → REVERSED defined; DPoP replay keyed by jkt+jti with retention ≥ iat window and RFC 9449 nonce challenge/retry for bootstrap.begin; Expo-issued opaque trusted-host continuation token; provisional-scoped credentials during CLAIM_HELD gated on hold-clear; escrow-source prepare/abort newly defined (no 0103 old-owner lease); deferred hold/jti/nonce/revocation values framed as security parameters; SSO hard block corrected to PreventSSOUserOAuthIdentityValidator); 2026-07-28 (/llp-super-refine round 3 revision: REVERSED made the terminal state of an immutable claim attempt with a workspace current-claim pointer that resets to a new UNCLAIMED generation on reversal; normative lifecycle fence inhibiting EXPIRED/cleanup and suspending/bounded-extending TTL during hold/commit/contested states with held-not-destroyed safe terminal; trusted-host contract split into one coherent rule — resolved (issuer,subject) case completes in-agent with no Expo detour, unresolved first-use/collision/SSO/new-identity/recovery cases require an Expo-authored continuation (Expo-hosted or host-rendered opaque UI) that never exposes the collision classification, with Flow C/Summary/Goals narrowed to the resolved case; DPoP bounded-nonce overlap window for concurrency; self-authenticated-unassociated first claimant does not out-rank the PoP holder; gate limb default absent live PoP-holder ack and PoP-holder contest freeze-only; hold-window floor invariant stated; jti cache upper-bound eviction + per-jkt cardinality cap); 2026-07-28 (/llp-super-refine post-convergence touch-up: r4 items folded in); 2026-07-28 (Accepted by author Charlie Cheever after /llp-super-refine — Fable READY r2–r4, GPT-5 residual r4 items folded in)
**Related:** LLP 0000, LLP 0009, LLP 0010, LLP 0018, LLP 0019, LLP 0024, LLP 0036, LLP 0055, LLP 0060, LLP 0069, LLP 0071, LLP 0089, LLP 0103, LLP 0104, LLP 0105, https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization, https://www.rfc-editor.org/rfc/rfc8628.html, https://www.rfc-editor.org/rfc/rfc8693.html, https://www.rfc-editor.org/rfc/rfc9396.html, https://www.rfc-editor.org/rfc/rfc9449.html, https://www.rfc-editor.org/rfc/rfc9700.html, https://www.rfc-editor.org/rfc/rfc9728.html, https://www.ietf.org/archive/id/draft-ietf-oauth-client-id-metadata-document-02.html, https://openid.net/specs/openid-connect-core-1_0.html, https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html, https://www.w3.org/TR/webauthn-3/, https://docs.stripe.com/payments/checkout, https://docs.stripe.com/payments/setup-intents, https://github.com/agentic-commerce-protocol/agentic-commerce-protocol, https://github.com/google-agentic-commerce/AP2

## Summary

An agent asked to make and publish an Expo app should be able to begin work
without stopping at “visit this settings page, create an account, and paste an
API key.” It should also avoid inventing a second Expo identity when the human
already has one, avoid handling raw card data, and leave the human with clear
ownership, recovery, audit, and revocation.

This RFC proposes an **agent-native Expo bootstrap protocol** with three trust
paths, lettered here to match §"Product flows" (A–F) throughout this document:

- **Flow A — standing delegation.** An agent with a valid Expo delegation
  discovers and uses the existing account. Within the delegation's scopes and
  spending policy, the entire flow can be unattended.
- **Flow C — trusted agent host.** A trusted agent host can, with the human's
  consent, pass Expo a signed identity assertion and render Expo's exact
  authorization request in its own secure UI. For the **resolved common case**
  (an existing `(issuer, subject)` mapping), Expo signs the human in and enrolls
  the agent **without making the human navigate to an Expo webpage**. For
  unresolved first-use, collision, SSO, new-identity, or recovery cases an
  **Expo-authored continuation** is required — an Expo-hosted step or
  Expo-authored opaque UI the host renders — which never exposes the collision
  classification (§"Trusted-host account-linking rule").
- **Flow B → Flow D — provisional workspace and universal claim.** An agent
  without either trust path creates an expiring, tightly limited **provisional
  workspace** (Flow B) and receives a proof-key-bound bootstrap credential. It
  can build and deploy a free preview immediately. Expo returns one trusted
  claim URL and QR code. When durable ownership, production capabilities, or
  billing is needed, the human uses that single page (Flow D) to sign into or
  create an Expo identity, select the owning account, approve the agent's
  authority, and optionally complete Stripe-hosted payment. The agent polls,
  then resumes automatically.

Flows E (payment from a phone) and F (preauthorized paid automation) are
extensions of these three; the letter mapping is stable across the Summary,
§"Product flows", the operation surface, and any downstream implementation
specs and tests.

The protocol optimizes for **zero interruption when prior authority exists**,
**in-agent approval when the host can carry trusted identity**, and **one
compact, mobile-friendly approval as the universal fallback**. It does not
pretend that an unknown model process can create a recoverable human identity,
accept recurring-billing terms, or acquire unbounded authority on a person's
behalf without any prior trust or human ceremony.

Permanent accounts remain human- or organization-owned. Agents are first-class
robot/service principals, not synthetic humans with generated email addresses.
A card is a payment instrument, not an identity or recovery mechanism.
Project transfer and login-identity linking are paved paths; destructive
account merging is an exceptional support operation.

## Decision

Expo should build the following product contract:

- A public, abuse-limited bootstrap endpoint may create a provisional workspace
  without an Expo login.
- The provisional workspace is not a `UserEntity` or ordinary customer
  `AccountEntity`. It is held in platform escrow, expires, cannot incur paid
  overages, and has only the capabilities needed for a useful preview.
- The agent generates a key pair locally. Bootstrap and subsequent tokens are
  bound to that key so a leaked bearer string is insufficient by itself. The
  binding is normative and includes an explicit proof-of-possession replay
  contract (unique proof id with server-side rejection, and authorization-server
  nonces where replay risk warrants); see §"Proof-of-possession and replay
  contract". A key-bound credential without replay protection does not satisfy
  this decision.
- A trusted agent host may replace the Expo webpage with an in-product approval
  surface only when it provides a signed, audience-bound identity assertion,
  proves fresh human consent, and renders the Expo-supplied request and receipt
  without allowing the model to alter them.
- The human claims the workspace into an existing or newly created Expo
  account. Claiming is an audited ownership transfer, not an account merge.
- The claim ceremony can also approve an Expo robot installation, scopes,
  credential lifetime, plan, price version, budget, and payment method.
- Stripe Checkout or a SetupIntent-hosted flow is the launch payment surface.
  Expo gives the agent a URL and QR code; the agent never receives the card
  number or wallet credential. Apple Pay and Google Pay can appear through
  Stripe where eligible.
- A phone number is optional delivery convenience, not required identity.
  Sending the link by SMS or push requires consent and a verified or
  rate-limited channel. The same universal link must work directly in the
  chat, terminal, or QR code without a phone number.
- Robot credentials are short-lived, scoped, audience-restricted, revocable,
  and sender-constrained. A long-lived personal access token remains a
  compatibility path, not the paved path.
- An agent may mint narrower child credentials without another human action
  only when the parent grant explicitly includes credential delegation.
- Every operation is idempotent, attributable to both the human owner and
  agent actor, and exposed in an account security/activity view.

These decisions define the product boundary. Exact endpoint names, database
schema, pricing, and UI copy require implementation specs.

## Why this belongs above Snapback provisioning

LLP 0089 defines how an already authorized agent provisions a Snapback app. It
deliberately does not own account creation, organization membership, billing,
quota, or tenant policy. LLP 0103 assigns developer identity, project ownership,
and billing to Expo. This RFC fills the missing layer before LLP 0089:

`unknown agent → Expo authority → account/project/environment → provision`

It applies to EAS Hosting and other Expo services, not only Snapback. Snapback
is the forcing function because an agent-built app should be deployable and
usable before its human has learned Expo's dashboard.

Application end users remain a separate identity plane. An Expo developer
account owns and operates the backend; it is not automatically an app-user
account inside that backend.

## Goals

- Let an agent with no prior Expo credential produce a working, bounded preview
  without pausing for a browser.
- Let an agent with a standing Expo grant create, configure, deploy, and pay
  within policy without human interruption.
- Let a trusted agent host create or link a durable Expo identity through a
  secure in-agent consent surface — without an Expo-site detour for the resolved
  common case (an existing `(issuer, subject)` mapping), and with an
  Expo-authored continuation (Expo-hosted or host-rendered opaque UI) for
  unresolved first-use, collision, SSO, new-identity, or recovery cases
  (§"Trusted-host account-linking rule").
- Collapse unavoidable human interaction into one trustworthy link rather than
  a trail of dashboard instructions.
- Reuse an existing Expo account whenever one exists.
- Make accidental duplicates recoverable without corrupting ownership, billing,
  audit history, or stable project identifiers.
- Give agents native operations for enrollment, credential issuance, rotation,
  attenuation, and revocation.
- Keep raw payment credentials outside the agent, model context, terminal
  transcript, and Expo systems.
- Make agent actions visible, attributable, bounded by spend policy, and easy to
  revoke.
- Work consistently through CLI, HTTP, remote MCP, and future agent surfaces.
- Preserve enterprise SSO, organization policy, data residency, sanctions,
  tax, and support obligations rather than bypassing them for agent traffic.

## Non-goals

- Proving that a completely unknown process is entitled to impersonate or bind
  a particular human without a trust ceremony.
- Treating possession of a card, email address, or phone number as sufficient
  account ownership.
- Letting a model see or store a primary account password, card PAN, wallet
  secret, or unrestricted human personal access token.
- Inventing a separate “agent account” namespace that projects must later
  escape.
- Making irreversible user/account merge a common automated operation.
- Replacing app-user auth from LLP 0055–0060.
- Depending at launch on an experimental agent-payment protocol or agent wallet.
- Letting anonymous workspaces send arbitrary email/SMS, attach custom domains,
  run unbounded egress, or consume paid resources.

## Existing Expo and ecosystem evidence

This source review was performed on 2026-07-28. Universe paths below are
evidence anchors, not a claim that their present behavior is the desired
contract.

### Universe already has useful foundations

Universe's current password signup in
`server/www/src/apiv2/AuthRouter.ts` requires reCAPTCHA in production and
otherwise directs the caller to `expo.dev/signup`. That is deliberately hostile
to automated abuse, but it also means an agent cannot complete the current
flow. Successful signup creates a human user, a primary account, a session, and
verification mail. The bootstrap protocol should not tunnel around that
security control by having agents manufacture password users.

Existing OAuth signup provides important deduplication behavior:

- an existing provider identity signs into its existing user;
- a verified provider email matching a verified Expo user can link to that
  user, subject to conflicting identity and SSO policy;
- a genuinely new verified identity can create a pending identity and complete
  onboarding;
- organization SSO conflicts are preserved rather than silently bypassed.

Universe also already has:

- `RobotEntity`, including account permissions, as the right base for an agent
  principal;
- `AccessTokenEntity`, with one-time token return, SHA-256 storage, visible
  prefix, revocation, last-used state, and audit;
- application transfer authorization and transfer history;
- Stripe Checkout, subscription, and customer-portal routes;
- allowlisted `agent.expo.dev` Stripe return URLs;
- first-party OAuth clients for Expo Agent, Expo MCP, and CLI, with PKCE and
  allowlisted redirects.

The current access token is still too broad for the paved agent path: it has no
intrinsic expiry, audience, proof-of-possession binding, per-project scope, or
task/spend ceiling. Its authority follows the actor's account permission.

Most notably, Universe's PostHog integration in
`server/www/src/external/PostHog.ts` already implements a draft agentic
provisioning shape:

- create an account request with an email/name hint, client metadata URL, S256
  PKCE, region/config, and scopes;
- return credentials for a newly provisioned identity or a trusted
  `requires_auth` URL for an existing one;
- exchange a code for access and rotating refresh tokens;
- enumerate provisioned resources;
- rotate credentials;
- provide trusted deep links.

That integration is valuable implementation evidence. It is not yet a stable,
public, normative standard, and its provider-side behavior should not force
Expo to create durable human users before ownership is proven. Expo should
remain wire-compatible where practical while making the provisional-workspace
boundary explicit.

### Relevant standards

The design should use established authorization components rather than create a
new auth protocol:

- **OAuth authorization code with PKCE** for browser-capable clients and
  **RFC 8628 Device Authorization Grant** for decoupled completion. The latter
  already models “agent displays a URL/code and polls while a person acts on
  another device.” This RFC adopts RFC 8628's **UX and polling semantics**
  (`verification_uri_complete`, a short user code, polling interval, expiry,
  and the `authorization_pending`/`slow_down` back-pressure vocabulary) as the
  claim path's shape; `bootstrap.begin`, provisional deployment, and
  receipt-bound enrollment are **not** an RFC 8628 device-authorization/token
  endpoint. Whether the claim path also exposes a literally wire-compatible
  RFC 8628 device-authorization + token endpoint (with `device_code`,
  `user_code`, `verification_uri[_complete]`, and the standard error set) is an
  implementation-spec decision; until specified, the RFC does not imply wire
  compatibility, only the borrowed interaction model.
- **OAuth 2.0 Security Best Current Practice (RFC 9700)** for exact redirects,
  PKCE, sender/audience discipline, and rejection of password grants.
- **OAuth Protected Resource Metadata (RFC 9728)** and authorization-server
  metadata for discovery. These are also part of the current MCP authorization
  model.
- **Client ID Metadata Documents (CIMD)** for an agent vendor with a stable
  HTTPS identity, with Dynamic Client Registration as a compatibility option.
  CIMD is still an IETF draft; Expo must apply SSRF, caching, and metadata trust
  policy and offer an Expo-hosted client-metadata service for local or
  ephemeral agents.
- **DPoP (RFC 9449)** to bind tokens to the agent's local key.
- **Rich Authorization Requests (RFC 9396)** to express project, environment,
  action class, and budget constraints that do not fit a flat scope string.
  RFC 9396 carries structured detail but does not itself define Expo semantics
  or enforce a spend mandate, so a follow-on spec must register the Expo
  **authorization-detail types**, their **canonical comparison rules**, and
  **resource indicators/audiences**.
- **OAuth Token Exchange (RFC 8693)** as a model for attenuating a parent grant
  into a shorter, narrower task or CI credential. RFC 8693 is only a framework;
  strict attenuation and delegation depth remain Expo policy, so the same
  follow-on spec must define **server-side subset checking against the Expo
  authorization-detail types for every child grant** (a child must be a strict
  subset of the parent's accounts, projects, environments, actions, audiences,
  time, and budget).
- **WebAuthn/passkeys** for low-friction, phishing-resistant human account
  claim and recovery.
- **OpenID Connect** for a trusted agent host to assert a stable issuer/subject
  and verified claims to Expo. The assertion must be minted for Expo, fresh,
  nonce-bound, and released with the human's consent; an LLM-authored email
  string is not an identity assertion.
- **OpenID CIBA** as a possible future pattern when a known, enrolled human
  approves on a separate device through push or a verified channel. It is not
  required for launch; device flow plus a universal link is simpler.
- **MCP authorization** for an authenticated remote MCP server after
  enrollment. MCP does not itself decide who owns an Expo account or who may
  accept billing terms.

GNAP and shared-security-event standards are worth monitoring, especially for
richer delegation and cross-provider revocation, but are not launch
dependencies.

### Payment ecosystem

Stripe-hosted Checkout and SetupIntents already support the important launch
properties: the payment provider collects payment details, records the payment
method mandate, can display eligible wallets, and reports authoritative state
through signed webhooks.

Agentic Commerce Protocol, Google's Agent Payments Protocol, Stripe shared
payment tokens, and agent wallets are useful directionally. They introduce
scoped mandates and transaction-bound payment credentials. They are not a
substitute today for a clear recurring SaaS agreement, account recovery, tax
facts, or Expo's own spending policy. Expo can later accept such a mandate as
another payment authorization input without redesigning account bootstrap.

## Terms and identity model

### Human identity

A recoverable Expo `UserEntity` representing a person. It may have several
linked login methods: passkey, OAuth provider, verified email, and
enterprise SSO.

### Owning account

The Expo account or organization that owns projects, receives usage, controls
members and robots, and is responsible for billing. A human identity may
control several owning accounts.

### Agent client

The software/vendor identity, such as Codex, Claude, Expo Agent, or a local
MCP client. It is identified by registered metadata or a client metadata
document. Client identity says which software is acting; it does not by itself
authorize an Expo account.

### Trusted agent host

An agent product whose server-side issuer, human-authentication controls,
consent surface, and signed assertions Expo has explicitly approved. It can
federate human identity or approval. This is a stronger and rarer status than
being a registered agent client.

### Agent installation

A particular enrolled copy or session of an agent client, identified by a
public-key thumbprint and installation id. It records owner, client, creation
provenance, last use, policy, and revocation state.

### Robot principal

The Expo control-plane actor representing the agent installation or durable CI
job. Human owner, robot actor, and any delegated child actor are separately
recorded.

### Provisional workspace

An expiring platform-escrow container for one or more provisional projects and
preview environments. It is not a fake human and does not imply a customer
contract. It has a fixed free budget and restricted capabilities.

### Bootstrap request

The idempotent state machine binding an agent key, intent, provisional
workspace, claim ceremony, and eventual account/robot authorization.

### Standing delegation

A revocable policy previously approved by a human or organization, permitting a
named agent installation or class of agents to perform specified actions,
possibly with a time window and spend ceiling.

## Product flows

### Flow A: an authorized Expo account already exists

1. The client loads credentials from the supported credential broker and calls
   `identity.inspect`.
2. Expo returns the human/robot actor, accessible accounts, applicable
   organization policy, token bounds, and permitted project operations.
3. The agent discovers an existing project from its Expo project id, repository
   metadata, bundle identifiers, or an explicit project link.
4. If authority and budget cover the requested work, the agent provisions and
   deploys without interruption.
5. If more authority or money is required, Expo creates a narrowly scoped
   approval request rather than directing the user to settings.

An agent must inspect before it bootstraps. “Sign up first, discover later” is
the main path to duplicate accounts.

### Flow B: no Expo authority is available

1. The agent generates an asymmetric key pair and sends its public key, client
   metadata, intent, idempotency key, and optional contact/routing hint to
   `bootstrap.begin`.
2. Expo creates or returns the same bootstrap request and provisional
   workspace.
3. Expo returns:
   - a bootstrap request id;
   - an expiring proof-key-bound credential;
   - the preview workspace/project identity;
   - a trusted `verification_uri_complete`, treated as an acknowledged bearer
     ownership capability with the disclosure, confirmation, notification,
     hold/reversal, and recovery constraints in §"The claim capability is an
     acknowledged bearer capability";
   - a short human code and QR representation;
   - expiry and polling interval;
   - machine-readable limits and next actions.
4. The agent provisions a limited app and deploys a preview while it continues
   the user's app-building task.
5. The agent explains that the preview expires unless claimed. It only asks for
   human action when a durable, production, sensitive, or paid capability is
   needed.
6. The human opens the link on any device and completes the claim ceremony.
7. The agent polls `bootstrap.status`, receives a short authorization code or
   enrollment result bound to its key, exchanges it, and continues.

The agent does not need to open a local browser. The person need not navigate
Expo settings or paste a secret back into the conversation.

### Flow C: trusted agent-host signup

Codex, Claude, or another agent product may already have a recoverable,
authenticated human account. Expo can treat that product as a federated
provisioning host, not as an all-powerful agent:

1. Expo registers the host's issuer, signing keys, redirect/origin policy,
   privacy posture, and supported approval/payment capabilities.
2. The host asks the human to share the minimum identity claims with Expo and
   displays Expo's exact requested app, scopes, duration, destination, plan,
   and budget in trusted host UI outside the model-controlled transcript. What
   the host renders is a **canonical Expo-signed, nonce-bound authorization
   request object** (with a policy/terms version); the host does not compose
   this text.
3. The host sends a one-time signed assertion containing issuer, stable subject,
   Expo audience, nonce, issue/expiry time, verified claims, consent receipt,
   agent installation key, bootstrap request, and a **digest of the exact signed
   request object it displayed**. Expo rejects the assertion if the echoed
   digest does not match a current, unexpired request it issued, so a stale or
   altered request cannot be consented to.
4. Universe verifies the assertion and applies the normative linking rule in
   §"Trusted-host account-linking rule". An existing `(issuer, subject)` mapping
   signs directly into its bound Expo identity. First-time linking of a
   newly-trusted issuer's subject to a **pre-existing** Expo human is **not**
   done on a host-asserted verified email alone; it requires either
   authentication under that Expo identity or an explicitly approved enterprise
   federation/account-linking policy with defined assurance. Responses stay
   generic and non-enumerating.
5. If the collision check finds no existing identity, Universe may create a new
   durable human identity and primary account from the federated assertion —
   only after the collision check and the required terms/age/region/recovery
   ceremony, and only when identity *creation* passes an additional
   freshness/liveness check on the assertion (not merely signature validity),
   subject to organization policy.
6. The host returns Expo's signed authorization receipt to the client and the
   agent completes key-bound enrollment.

This is the closest match to “ask the agent to make an app and never visit an
Expo page.” That fully in-agent, no-detour completion holds for the **resolved
common case** — an existing `(issuer, subject)` mapping (step 4's direct
sign-in). For **unresolved** first-use linking, collision with a pre-existing
Expo human, SSO, new-identity creation (step 5), or recovery, an **Expo-authored
continuation** is required — either an Expo-hosted step or Expo-authored opaque
UI steps the host renders and returns signed results for — driven by an opaque
continuation token that never reveals the collision classification
(§"Trusted-host account-linking rule"). It still includes human consent when a
new identity, broad authority, or payment mandate is created, but the consent
happens in the already-open agent product or the trusted Expo continuation. The
model cannot self-assert the user's identity or click its own approval.

The host may embed a provider-controlled payment component or present an
ACP/AP2-style mandate when Expo and the payment provider support it. Until
then, payment may still require the universal Stripe-hosted page even when free
account signup completes entirely in-agent.

Hosts that cannot meet this trust contract use Flow B and the universal claim
link. A local CLI, arbitrary MCP client, or downloadable script does not become
a trusted identity provider merely by publishing client metadata.

### Flow D: universal claim, signup, and optional payment

The trusted Expo claim page presents a continuous ceremony:

1. Display the app/project, agent client, requested scopes, requested duration,
   destination environment, price/plan, and maximum spend.
2. Sign into an existing Expo identity or create one using passkey, OAuth, or
   verified email.
3. Select an existing owning account/organization or create an account.
4. Resolve organization SSO, policy, region, or administrator approval.
5. Choose whether to claim the provisional project, link it to an existing
   Expo project, or discard it.
6. Approve the robot installation, scopes, duration, credential-delegation
   permission, and notification policy.
7. When needed, complete Stripe-hosted Checkout or payment-method setup.
8. Confirm a final, human-readable receipt.

The approval receipt is cryptographically and durably bound to:

- bootstrap request and agent public-key thumbprint;
- human and destination owning account;
- claimed project and environment ids;
- scopes/action classes and expiry;
- child-credential delegation limits;
- plan, price version, free allowance, budget, and overage policy;
- terms and privacy-policy versions;
- payment-provider customer/session identifiers;
- request id, idempotency key, time, and risk signals.

The browser redirect is never proof that payment or claim succeeded. Universe
advances state only after validating its own authorization transaction and,
for payment, the provider's signed webhook or authoritative API state.

#### The claim capability is an acknowledged bearer capability

The claim URL (`verification_uri_complete`) and its short human code are, by
construction, a **bearer ownership capability**: absent an independent binding
to a specific human, anyone who opens the link and authenticates as themselves
can attempt to select a destination account. This RFC accepts that model
explicitly rather than pretending the link proves identity, and constrains it so
possession alone cannot silently and irreversibly capture another agent's work.
The following are normative for the universal claim path:

- **Narrow disclosure.** The URL/code is single-use, short-lived, high-entropy,
  and delivered only to the agent that created the bootstrap request (or, with
  consent and a rate-limited verified channel, to a contact hint). It is never
  echoed into model-visible prose, logs, analytics, or support views
  (acceptance scenario 16), and non-enumerating responses hide its existence
  from unauthenticated parties.
- **Explicit human confirmation of claimant and destination.** The receipt
  (§Flow D and below) shows, in a human-readable summary the authenticated
  claimant must confirm, **both who is claiming (the authenticated Expo human)
  and the destination owning account**, alongside the agent client, scopes,
  duration, plan, and maximum spend. The claimant cannot approve without seeing
  the destination they are selecting.
- **Notification on claim.** A successful first claim notifies the workspace's
  associated and prior contact channels (any consented contact hint, and any
  channel already associated with a matched-but-not-authenticated existing
  identity) through the notification system, so an unexpected claim is
  observable to the intended human. In the common **no-contact-hint anonymous
  case** — a workspace created with no contact hint and no matched pre-existing
  identity, whose claim URL lives only in the chat, terminal, or QR — those
  channels do not exist, so a bare notification reaches no one. For that case a
  claim MUST **either notify the originating agent channel** (the bootstrap
  request's proof-of-possession holder; see the recovery authority below), so
  that the hold window is actually invoked, **or gate durable ownership on a
  stronger binding** (an independent claimant binding as below). A claim that
  can reach no observer and offers no stronger binding does not durably commit.
  The **gate limb is the default** whenever **no live PoP-holder acknowledgement
  is observed within the hold window** (the originating agent may be gone, or may
  itself be the adversary): absent a live ack, durable ownership is gated on a
  stronger binding rather than committed on the possessor's say-so. A
  **PoP-holder contest is freeze-only — it can freeze or reverse toward the
  safe "held" outcome but never selects a destination** — so a hostile or absent
  originating agent yields at most **denial-of-completion, never takeover**.
- **Hold / reversal window.** A first claim is **not irreversible merely through
  possession of the URL.** It enters a bounded hold/reversal window (the exact
  duration is an open question, balanced against immediate usefulness) during
  which the claim can be reversed via the recovery path before ownership,
  credentials, and any billing mandate become durable. Provisional preview use
  may continue during the hold; irreversible or paid actions are gated until it
  clears.
- **Recovery path.** A contested or mistaken claim has a defined recovery
  ceremony (§Notifications, audit, and recovery) that can reverse an in-window
  claim and, after the window, follow the project-transfer/tombstone recovery
  for a wrongly captured workspace. Recovery does not depend on the same claim
  capability that was used.
- **No silent key/destination substitution.** A stolen claim URL cannot change
  the approved agent public-key thumbprint or the destination without producing
  a visible receipt and notification; the approved key is bound at enrollment
  and any change is an auditable event, not an ambient effect of URL possession
  (acceptance scenario 10).

Where a stronger guarantee is required (for example an enterprise destination,
or when a matched existing identity is present), Expo may additionally require
an **independent binding to the intended claimant** — authentication under an
already-associated identity, or an enterprise federation policy — before the
claim can select that destination.

##### Recovery authority and evidence hierarchy

A bearer capability is only safely reversible if some party has provably
**superior evidence** to the possessor. Because a no-contact-hint workspace has
no contact channel and no pre-existing identity, the notification/recovery path
would otherwise have no actor: a stolen-URL claim would notify no one and, once
the hold clears, become durable. This RFC closes that gap by designating a
first-class recovery principal that exists even in the anonymous case, and by
pinning who may reverse a claim on what evidence. The following is normative:

- **Bootstrap-request proof-of-possession holder is a recovery/dispute
  principal.** The holder of the agent-installation key that created the
  bootstrap request (proven by the same key-bound proof-of-possession used for
  `bootstrap.read`/`bootstrap.status`) is a first-class principal that can
  **observe and contest a claim during the hold window**. This is the only
  anchor present in the no-contact-hint case: the legitimate agent holds the
  installation key, and a claim thief who merely intercepted the URL does not.
  It is the counterpart to the notification requirement above — the originating
  agent channel that a no-hint claim must notify is exactly this principal.
- **Evidence hierarchy (who can freeze/reverse during the hold).** In order of
  strength: (1) authentication under an **already-associated existing identity**
  matched to the workspace; (2) an **enterprise federation/account-linking
  policy** governing the destination; (3) **proof-of-possession of the bootstrap
  request** (the installation key holder). A party with strictly superior
  evidence can freeze or reverse an in-window claim made by a party with weaker
  evidence. Conflicting claims are adjudicated in favor of the superior evidence
  tier; ties within a tier hold the workspace (no durable commit) pending
  out-of-band support adjudication rather than silently resolving to the current
  possessor.
- **A self-authenticated first claimant does not out-rank the PoP holder.** In
  the no-contact-hint anonymous case the first claimant authenticates as
  themselves but has **no prior association to this workspace**, so is *not* a
  tier-(1) party with respect to it. Such a **self-authenticated-but-unassociated
  first claimant does not out-rank the bootstrap-request proof-of-possession
  holder (tier 3)**. Consequently a PoP-holder contest during the hold is not
  out-ranked by the bare claimant and **forces the "held / does-not-durably-
  commit" branch** (§notification-on-claim), resolving toward reversibility
  rather than to the possessor.
- **An unauthenticated contact hint MUST NOT reverse a claim.** A contact hint
  is a routing hint, not proof (§"Contact hints are routing hints"); allowing a
  hinted address to reverse a claim would create a **new takeover path** (steal
  or spoof the hint, reverse the legitimate owner). A contact hint can only
  cause a notification and can only lead to reversal by authenticating into an
  associated identity or completing the recovery ceremony under an evidence tier
  above.
- **Safe terminal outcome when no party has superior proof.** If a claim is
  contested and no party can establish evidence superior to the current
  possessor, the workspace does **not** durably commit to the disputed
  destination on hold-clear: it either remains held pending support adjudication
  or falls back to the project-transfer/tombstone recovery, and the provisional
  container is not silently erased. The default resolves toward reversibility,
  not toward the possessor.

Recovery never depends solely on the same claim capability that was used to
claim, nor solely on the agent being recovered (§"Notifications, audit, and
recovery").

### Flow E: payment from a phone

The phone idea is good, but a phone number should not be necessary:

- Show the trusted universal link in chat and print a QR code in terminal
  clients.
- The same page works on a phone and lets Stripe offer Apple Pay, Google Pay,
  Link, or card as eligible.
- If the human already has a verified phone or push-capable Expo session, offer
  “send to my phone” as a convenience.
- If a new phone number is supplied, get explicit consent, rate-limit delivery,
  use generic non-enumerating responses, and do not treat SMS completion as
  durable identity proof by itself.

For a recurring or usage-billed service, the page must clearly disclose the
plan, included usage, overage rates, billing interval, renewal/cancellation,
budget alerts, and whether charges can occur off-session.

### Flow F: preauthorized paid automation

After a human has approved a payment method and standing spend policy, an agent
may upgrade or allocate paid resources without another ceremony when all of the
following are true:

- its grant permits the exact service and action;
- projected and actual spend remain within per-action and period limits;
- account and organization policy allow unattended changes;
- price and terms versions are within the accepted standing mandate;
- the operation does not cross a configured sensitivity threshold.

Otherwise Expo returns `action_required` with one approval URL. An agent never
turns a free workspace into uncapped usage merely because a card is on file.

## Provisional workspace contract

The provisional workspace makes “start immediately” compatible with abuse and
identity constraints.

Recommended launch limits include:

- a short TTL, with a clearly returned absolute expiry;
- one or a very small number of projects per bootstrap/client/risk bucket;
- fixed compute, request, bandwidth, storage, build, and log ceilings;
- no paid overage and no negative balance, enforced by LLP 0104's account-budget/
  lease protocol against the pre-claim owner-of-record (§"EAS Hosting and
  Snapback"), not merely asserted here;
- no custom domains, organization invites, production credentials, or account
  recovery changes;
- no arbitrary email/SMS/push sending;
- constrained outbound network access and secret injection;
- preview-only naming and an unambiguous provisional banner;
- aggressive abuse, malware, phishing, cryptomining, and automated-signup
  controls;
- export before expiry where safe, followed by a documented deletion window.

Anonymous previews should be useful enough to evaluate the app, not useful
enough to become an unowned production service. Limits are policy, not hidden
failure modes: the agent can read them before choosing a design.

If Expo cannot safely offer an anonymous deployed preview initially, the same
state machine can begin with a local artifact/build sandbox. The protocol must
not fall back to creating unverified permanent users.

## State machine and idempotency

A single linear machine conflates concerns that must fail and recover
independently: a retryable payment failure must not roll back ownership, and
cancelling agent enrollment must not delete a human-owned project. Bootstrap
state is therefore modeled as **orthogonal durable dimensions**, each with its
own terminality, compensation, and idempotency ownership. A bootstrap request is
the product of these dimensions plus explicit substates, not a point on one
line:

- **Workspace lifecycle.** `REQUESTED → PROVISIONING → PROVISIONAL →
  {CLAIMED, EXPIRED, CANCELLED}`. Owns the escrow container and its TTL. The
  workspace **remains `PROVISIONAL` (escrow retained) throughout the ownership
  hold** and terminalizes to `CLAIMED` only when the ownership-transfer
  dimension durably commits (hold cleared). It is *not* terminalized on hold
  entry, so an in-window reversal never has to un-terminalize it. Terminal at
  `CLAIMED` (ownership durably left escrow), `EXPIRED`, or `CANCELLED`.
  **Lifecycle fence (normative).** Entering ownership `CLAIM_HELD` /
  `CLAIM_COMMITTING`, or any contested-adjudication state under §"Recovery
  authority and evidence hierarchy", **inhibits destructive expiry and
  cleanup**: while a claim or dispute is in flight, the workspace-lifecycle
  dimension **cannot fire `EXPIRED`** and the cleanup dimension **cannot begin
  deletion**. The PROVISIONAL TTL is **suspended (or bounded-extended)** to
  cover the hold plus any dispute/adjudication window, so a running TTL can
  never destroy the container mid-claim or mid-dispute. On **`REVERSED`** the
  container resumes its normal `PROVISIONAL` TTL (under the new-generation
  `UNCLAIMED` pointer). On **abandoned or timed-out adjudication** the safe
  terminal is **held-not-destroyed** — the container enters a **durable
  adjudication state** (`CLAIM_DISPUTED`/`ADJUDICATING`) and is retained until a
  bounded safe cutoff (a security parameter), never silently erased while
  ownership is unresolved. **Cutoff transition (normative).** At the bounded
  cutoff, if no resolving support adjudication has landed, the container makes a
  single explicit transition to a **support-controlled `QUARANTINED`/tombstone
  terminal** rather than either destructive `EXPIRED` (which the fence forbids
  while ownership was disputed) or indefinite retention (which defeats the
  bound). That transition is **non-destructive** — data is retained and remains
  **exportable, and is never silently erased while a dispute was live** — and it
  **atomically clears the in-flight-dispute fence** with these consequences:
  **ownership** stays escrow/none (the disputed destination is not committed);
  **capabilities** are frozen (no provisional preview, no new credentials, no
  paid or irreversible actions); and a defined **quarantine-retention TTL** (a
  security parameter) begins, after which — and only then — ordinary
  `EXPIRED`/cleanup becomes eligible for the quarantined container. A resolving
  support adjudication before or during quarantine routes the container to the
  correct owner (claim commit or project-transfer/tombstone recovery per
  §"Recovery authority and evidence hierarchy") instead. `EXPIRED`/cleanup may
  therefore only fire once no claim or dispute is in flight **and** any
  quarantine-retention TTL has elapsed.
- **Ownership transfer (claim).** Ownership is modeled as an immutable **claim
  attempt** plus a workspace-level **current-claim pointer**. A single claim
  attempt runs `UNCLAIMED → CLAIM_HELD →
  {REVERSED, CLAIM_COMMITTING → CLAIMED}` and its states are *append-only*:
  `CLAIM_HELD` is the hold/reversal window, from which the attempt goes to
  **`REVERSED`** (reversal invoked, or a superior-evidence contest under
  §"Recovery authority and evidence hierarchy") **or** to
  **`CLAIM_COMMITTING → CLAIMED`** (the hold clears and ownership durably
  commits). **`REVERSED` and `CLAIMED` are both terminal states of that
  attempt** — a `REVERSED` attempt is an immutable, idempotent reversal record
  and is *never* mutated back to `UNCLAIMED`. Instead, on **`REVERSED`** the
  workspace's **current-claim pointer resets to a new claim-attempt generation**
  (a fresh attempt id at `UNCLAIMED` with a **fresh idempotency scope**), so the
  workspace's *effective* ownership state is `UNCLAIMED` again and a subsequent
  claim is well-defined against the new generation while the reversed attempt
  stays terminal for audit and replay-idempotency. To compose this with the
  caller-generated idempotency key (§"Every mutating request carries"), the
  **effective idempotency key for `workspace.claim` is
  `(caller-generated key, current claim-attempt generation)`**: a retry of
  `workspace.claim` with the same caller key **across a generation boundary**
  lands on the *new* generation rather than replay-deduping onto the terminal
  `REVERSED` attempt of the prior generation, so a legitimate re-claim is never
  stuck on a reversed record and a replay never resurrects one. The explicit
  workspace-level transition is therefore **`REVERSED ⇒ new-generation
  UNCLAIMED`** (pointer reset, not a state edge on the reversed attempt). The 0103/0104
  ownership-interval cutover happens at **exactly one transition — the commit in
  `CLAIM_COMMITTING` at hold-clear**, not on `CLAIM_HELD` entry; entering the
  hold binds intent and starts the window but does not yet open the destination
  ownership interval. On **`REVERSED`** the escrow container returns to
  workspace-lifecycle `PROVISIONAL` under the new-generation `UNCLAIMED` pointer
  (the container is not erased; TTL and the recovery path resume). During
  `CLAIM_HELD`, the authoritative
  **owner-of-record remains the pre-claim platform-escrow interval** (see
  §"EAS Hosting and Snapback"), the **permitted principal is provisional-scoped
  only**, and **metering continues to attribute to the escrow interval** until
  the cutover at commit. Compensation is claim reversal, then the
  project-transfer/tombstone recovery. This dimension, not payment, owns whether
  a human owns the project.
- **Human authorization.** `NONE → IDENTITY_LINKED_OR_CREATED`, following the
  §"Trusted-host account-linking rule" and the universal claim ceremony.
- **Agent enrollment.** `NONE → CODE_ISSUED → ENROLLED → {ENROLL_CANCELLED,
  REVOKED}`. `CODE_ISSUED but not exchanged` and `ENROLL_CANCELLED` are
  first-class. This dimension commits **independently of the billing
  dimension**, but not independently of the ownership hold: `ENROLLED` may issue
  **provisional-scoped** credentials during ownership `CLAIM_HELD`, while
  **durable/production credential authority is gated on hold-clear** (the same
  gate §Flow D and §Notifications apply to credentials becoming durable).
  Cancelling or revoking enrollment **never** deletes a human-owned project — it
  only removes the agent's authority.
- **Billing / entitlement.** `FREE → CHECKOUT_PENDING → {PAID, PAYMENT_FAILED}`,
  where `PAYMENT_FAILED` is retryable and leaves ownership and entitlement at
  their last good state (`ACTIVE_FREE` after a failed upgrade, not rolled back).
  Authoritative only from provider webhook/API state.
- **Cleanup.** `NONE → SCHEDULED → DONE`, racing against claim: a claim that
  lands while provisional cleanup is scheduled **wins** and cancels cleanup;
  cleanup that has begun deletion blocks a late claim with a typed `expired`
  outcome and the recovery path. This race is defined, not left implicit.
  The **lifecycle fence** above bounds this race on the claim side: once a claim
  or dispute is in flight (ownership in `CLAIM_HELD` / `CLAIM_COMMITTING` or a
  contested-adjudication state), cleanup **cannot advance to `SCHEDULED` or
  begin deletion**, so the only surviving race is a claim landing against an
  *already-scheduled* cleanup before any hold exists — which the claim wins.

Transaction boundaries are pinned per operation, not across the whole request:
**claim** commits the ownership-transfer dimension **entering `CLAIM_HELD`**
atomically with the human-authorization result (this binds the intended
destination and starts the hold; it does **not** open the destination ownership
interval); the **0103/0104 cutover** is a *separate* boundary that fires once,
in **`CLAIM_COMMITTING` at hold-clear** (see §"Three different operations" /
§"Escrow-source claim"), and the mirror-image **`REVERSED`** boundary
terminalizes the immutable claim attempt and **resets the workspace current-claim
pointer to a new-generation `UNCLAIMED`**, returning the container to
`PROVISIONAL`; **transfer** is the account-to-account
0103 transfer boundary; **credential issuance/enrollment** commits the
agent-enrollment dimension **independently of the billing dimension** — but
"independently of billing" is **not** "independent of the hold": durable and
production credential authority is gated on hold-clear, and only
provisional-scoped credentials may issue while ownership is in `CLAIM_HELD` (see
§"Agent enrollment"); **subscription creation** commits only the billing
dimension after webhook confirmation; **expiry** commits workspace-lifecycle +
cleanup, but is **inhibited by the lifecycle fence** while a claim or dispute is
in flight (it cannot fire during `CLAIM_HELD`/`CLAIM_COMMITTING` or a
contested-adjudication state). No single transaction spans ownership and payment.

Not every request visits every dimension's non-initial states. An existing valid
delegation (Flow A) may reach `ACTIVE_FREE`/`ACTIVE_PAID` billing directly
without a provisional workspace, leaving the workspace-lifecycle and
ownership-transfer dimensions unused.

The composite outcome vocabulary below is a projection of these dimensions;
`ready`/`pending`/`action_required`/`conflict`/`denied`/`expired` describe the
request as a whole, while the durable dimensions above record which concern is
in which state.

Every mutating request carries:

- a globally unique request id;
- a caller-generated idempotency key scoped to actor and operation;
- the agent installation key thumbprint;
- an intended account/project/workspace if already known;
- an optimistic state version.

Retries return the same resource and current state. A completion event may be
delivered more than once. Consumers deduplicate by event id and fetch
authoritative state.

The protocol returns a small outcome vocabulary:

- `ready`: requested authority/resource is available;
- `pending`: work is continuing; poll or subscribe;
- `action_required`: one trusted URL and structured reason;
- `conflict`: an existing identity/project or incompatible policy needs a
  bounded choice;
- `denied`: the operation is not allowed;
- `expired`: the request or workspace can no longer be used.

It never returns only prose such as “open settings and find API keys.”

## Avoiding duplicate accounts and projects

### Discovery before creation

All official clients call identity/project discovery before bootstrap. Useful
signals include:

- an existing Expo credential in the credential broker;
- `.expo` project linkage and Expo project id;
- repository remote and prior deployment metadata;
- app bundle/package identifiers;
- owning organization policy;
- agent installation public key and prior bootstrap ids.

These signals may suggest a match but must not silently prove ownership.

All **pre-authority** discovery is **local-only**: for the no-authority case,
discovery-before-creation relies solely on signals the client already holds (a
credential in the broker, `.expo` project linkage, local repository/build
metadata). Any **server-side** match query — including bundle/package id or
repository-remote lookups, not just contact hints — requires **authenticated
authority** or returns a **non-enumerating generic result**, so discovery never
becomes an account- or project-enumeration oracle. This is why `identity.inspect`
is marked `Anonymous? No`: it is not a public lookup surface.

### Contact hints are routing hints

An email address or phone supplied by the agent is not proof. If it matches an
existing verified user, Expo should:

- avoid creating a second user;
- send or present a generic trusted authorization path;
- reveal no account-existence fact to the unauthenticated agent;
- require the human to authenticate under the existing account's policy.

For a new user, Expo should prefer a provider-verified identity or passkey plus
a verified recovery channel. Generated `something+agent@…` addresses are not a
sound ownership model.

### Trusted-host account-linking rule

Trusted-host federation (Flow C) accepts a signed assertion carrying an issuer
and stable subject. A newly-trusted issuer's `sub` has no existing Expo mapping
on first use, so the linking decision is where takeover risk concentrates. The
following rule is **normative**:

1. **Existing `(issuer, subject)` mapping.** Signs in directly to the bound Expo
   identity. This is the only case that federates authority without a further
   Expo-side identity proof.
2. **First-time link to a pre-existing Expo human.** A host-asserted verified
   email is **never sufficient by itself** to bind an issuer/subject to an
   existing Expo human — doing so would risk account takeover and bypass that
   account's MFA/recovery posture. Linking requires **either** the human to
   authenticate under the existing Expo identity (the same standard Universe's
   interactive OAuth link path enforces today — the user proves control of the
   Expo account, not merely of a matching mailbox), **or** an explicitly
   approved enterprise federation/account-linking policy with defined assurance
   requirements and honored SSO/conflict handling — the hard block for an
   SSO-governed user is `PreventSSOUserOAuthIdentityValidator`, with
   `OAuthLoginPendingSSOConflict` preserved as an interactive warning, never a
   silent bypass.
3. **No matching identity.** A new durable identity may be created **only after
   the collision check** and the required terms/age/region/recovery ceremony,
   and identity *creation* via a federated assertion is additionally gated
   behind a freshness/liveness check (Fable review, §Flow C) beyond signature
   validity.

In every case responses are generic and non-enumerating: the unauthenticated
host learns neither that a colliding Expo identity exists nor its recovery
posture. Because the three cases above require **materially different
ceremonies** (direct sign-in, authenticate-under-existing-identity or enterprise
policy, and new-identity terms/recovery), a naive response would let the host
distinguish them and thereby enumerate. This creates one coherent contract with
two branches, resolving the apparent tension between non-enumeration and Flow C's
in-agent, no-Expo-detour promise:

- **RESOLVED common case — in-agent, no detour.** When the assertion resolves to
  an **existing `(issuer, subject)` mapping**, the host completes sign-in
  **entirely in its own trusted UI without an Expo-page detour**. This is the
  case Flow C, the Summary, and the Goals' "no Expo-site detour" language refers
  to, and it is the expected steady-state for a returning human of an approved
  host: the mapping already exists, no collision classification is exposed, and
  the host renders Expo's canonical signed request and returns the signed
  consent/enrollment result directly.
- **UNRESOLVED cases — Expo-authored continuation required.** For **first-use**
  linking of a newly-trusted subject, a **collision** with a pre-existing Expo
  human, an **SSO**-governed user, **new-identity creation**, or a **recovery**
  requirement, the ceremonies differ materially *and* must not be distinguishable
  by the host. Universe therefore returns an **Expo-issued opaque
  continuation/challenge token** and requires an **Expo-authored continuation** —
  either **(a)** an **Expo-hosted continuation step** (the host hands off to a
  trusted Expo surface for that step), **or (b)** an **Expo-authored opaque UI
  step the host renders**, driven entirely by the opaque token. An opaque token
  by itself does **not** hide UI content, interaction shape, timing, or returned
  results from the host that renders it, so branch (b) cannot deliver the stated
  non-enumeration as a plain host-rendered protocol. Branch (b) is therefore
  permitted **only via an Expo-controlled isolated component/origin** — an
  Expo-origin sandboxed surface the host embeds but cannot introspect (e.g. an
  Expo-origin iframe/webview) — that presents a **uniform observable envelope**
  (constant step count, field shapes, asset set, and latency profile across all
  unresolved ceremonies) and returns a **generic signed terminal result**, so
  the host **relays only** and cannot classify collision vs SSO vs
  new-identity vs recovery from what it can observe. **Shape-uniformity across
  the unresolved ceremonies is an explicit Flow C conformance requirement** for
  branch (b). If that Expo-origin isolation is not available, the unresolved case
  **falls back to the fully-Expo-hosted branch (a)**, and the **strict
  non-enumeration guarantee is explicitly restricted to branch (a) or the
  isolated-component branch (b)** — it is **never** provided by a plain
  host-rendered protocol. In either permitted branch the host renders a single
  generic "continue" step against the token and **does not learn whether the
  cause was a first-time-link, an SSO conflict, a new-identity requirement, or a
  recovery path** — the collision classification is never exposed. Only Expo,
  when the human proceeds against the token, resolves it to the correct ceremony.
  The host cannot compose these steps or observe which one it is driving; it only
  relays Expo-authored UI and returns signed results.

Flow C's "the host completes linking/creation in its own UI without an Expo
detour" claim is thereby **narrowed explicitly to the resolved
`(issuer, subject)` case**; unresolved cases require the Expo-authored
continuation above (opaque-token-driven, whether Expo-hosted or host-rendered),
which no longer contradicts Flow C, the Summary, or the Goals. This mirrors
Universe's existing OAuth deduplication and SSO-conflict handling
(`_loginOrSignupUserWithOAuthAsync`, `PreventSSOUserOAuthIdentityValidator`),
in which a provider-verified email can link to a verified Expo user **during an
interactive flow where the user authenticated with the provider** and no
conflicting link/SSO policy applies — not on the strength of an asserted email
string alone. (The genuine hard block for an SSO-governed user is
`PreventSSOUserOAuthIdentityValidator`; `OAuthLoginPendingSSOConflict` is a
dismissible interactive warning, not the block.)

### Three different operations

“Merge my accounts” usually means one of three things and the product must ask
which:

1. **Link login identities.** Attach another verified OAuth/passkey/email login
   to the same human user after proving control and checking SSO conflicts.
2. **Consolidate projects.** Transfer selected projects and robot grants into a
   chosen account or organization while retaining stable app ids and explicit
   usage-ownership intervals.
3. **Merge human/account records.** Combine security, recovery, tax, invoices,
   legal acceptances, memberships, and audit history. This is rare, high-risk,
   and usually support-mediated.

The paved recovery for accidental agent bootstrap is (1) plus (2), not (3).
Claiming a provisional workspace is a transfer out of platform escrow. It
preserves project/environment ids, deployment history, and resource identity.

`workspace.claim` is classified as an **escrow-source specialization of LLP
0103's transfer boundary**, not a separate ad-hoc mechanism: it reuses 0103's
atomic ownership-attribution cutover (which opens a new ownership interval
without rekeying the durable id) with the **source owner being platform escrow
(a non-`AccountEntity`) instead of an existing `expoAccountId`**. This requires a
**0103 amendment** to admit an escrow/null-owner source in its transfer
protocol (0103's app-wide transfer today assumes an existing account source);
the first-run claim otherwise inherits 0103's cutover fence, epoch/lease
revocation, and admission-bound attribution. `project.transfer` remains the
account-to-account case; `workspace.claim` is the escrow-to-account first-run
case — the two are listed separately for exactly this reason. Where an
implementation cannot yet reuse 0103's boundary, claim is instead a **distinct
fenced first-run operation** that must still provide the same cutover-atomicity
and attribution guarantees.

"Specialization" here does **not** mean "zero new mechanism." 0103's
prepare/commit/abort is built on **old-owner leases frozen at prepare and
revoked at commit**; an escrow/null-owner source has **no such old-owner
lease**, so the escrow case's **prepare/abort semantics are newly defined** even
when the commit reuses 0103's cutover fence (this is precisely the 0103
amendment flagged above, and why the fallback is a distinct fenced operation).
The cutover fires at exactly the `CLAIM_COMMITTING → CLAIMED` transition
(§"State machine and idempotency"); on `REVERSED` the escrow source is simply
retained, since there is no old-owner lease to restore.

Project transfer must:

- require current control or a trusted claim proof;
- authorize the destination account and organization policy;
- define a billing cutover time;
- preserve historical invoice and tax records under their original customer;
- re-evaluate robots, secrets, domains, webhooks, data region, and integrations;
- revoke or attenuate credentials that should not survive the move;
- notify relevant owners and provide a reversible hold where appropriate.

An emptied accidental account can be disabled/tombstoned after recovery and
retention checks. It should not be silently erased with its audit trail.

## Agent enrollment and credentials

### Separate principal, grant, token, and secret

Following LLP 0055, the model is:

- the robot is the actor/principal;
- the human or organization policy creates a grant;
- access/refresh credentials represent a bounded projection of that grant;
- third-party API secrets belong in a secret broker and are not Expo auth
  tokens.

A display name like “Claude” is not an authorization fact.

### Paved credential shape

The preferred enrollment result consists of:

- a rotating refresh/enrollment credential bound to the installation key;
- short-lived access tokens, initially on the order of minutes rather than
  months;
- `aud`/resource restriction for the intended Expo API or MCP server;
- explicit account, project, environment, and action scopes;
- requested and effective actor ids;
- parent grant and delegation chain;
- absolute expiry and inactivity policy;
- optional action count, resource, and spend ceilings;
- DPoP confirmation/key thumbprint;
- unique token id for revocation and audit.

The existing static Expo access token remains usable for compatibility, but
official agent flows should immediately exchange or wrap it into a narrower
session rather than copying it into every tool.

### Proof-of-possession and replay contract

Proof-key binding is only as strong as its replay defense. The following
RFC 9449 (DPoP) validation is **normative** for the bootstrap credential and for
every enrolled credential presented at an Expo protected resource or
authorization endpoint:

- `typ` is `dpop+jwt`; the signing algorithm is asymmetric and allowlisted
  (`ES256`/`ES384`/`RS256`/`PS256`), never `none` or HMAC;
- `htm` matches the request method and `htu` matches the normalized request URI
  (origin + path, query/fragment stripped);
- `iat` is present and within a bounded acceptance window;
- `jti` is present and **unique per proof, with server-side replay rejection**
  over at least the `iat` acceptance window. Replay identity is keyed by the
  tuple **(confirming key thumbprint `jkt` + `jti`)**, not `jti` alone, so proof
  ids are scoped to the presenting key; the `jti` cache **retention MUST cover
  at least the `iat` acceptance window** (a proof outside that window is already
  rejected on `iat`, so a shorter cache would reopen the replay hole the window
  is meant to close). Beyond that retention *floor*, the replay store MUST also
  carry an **upper-bound/eviction discipline and a per-`jkt` cardinality cap** so
  it cannot become a memory-exhaustion target: entries are evicted once past the
  `iat` window, and a single key thumbprint cannot pin unbounded `jti` entries
  (proofs beyond the per-`jkt` cap are rejected rather than cached without
  limit). Because any evicted entry is necessarily outside the `iat` window, it
  is already rejected on `iat`, so bounded eviction never reopens the replay
  hole;
- `ath` binds the proof to the presented access token at protected resources;
- the confirming key thumbprint (`cnf.jkt`) is continuous with the enrolled
  installation key across bootstrap, status, exchange, and enrollment;
- an **authorization-server-issued nonce** is required where replay risk is
  elevated — explicitly at `bootstrap.begin`, `bootstrap.read`/status, and the
  approval-to-credential exchange — so a proof cannot be replayed even within
  the `iat` window. Because `bootstrap.begin` is the client's first contact and
  cannot carry a server nonce it has not yet seen, it uses the **RFC 9449 nonce
  challenge/retry**: the initial nonce-less request is answered with a
  `use_dpop_nonce` error and a fresh nonce in the **`DPoP-Nonce` response
  header**, and the client **retries** the same request with a proof carrying
  that server nonce. Subsequent nonce-required operations reuse the most
  recently issued nonce and are re-challenged the same way when it is stale. To
  keep concurrency and retries safe, the authorization server MUST accept a
  **bounded set / overlap window of recently-issued nonces** (not only the single
  latest one), so concurrent requests and retries that each carry a
  recently-issued nonce do not invalidate one another; `(jkt, jti)` remains
  independently single-use regardless of which in-window nonce a proof carries.
  The nonce **validity/overlap window MUST NOT exceed (and should be derivable
  from) the `iat` acceptance window**, so a proof carrying a nonce accepted late
  in its overlap window still falls inside the `iat` window and the replay store
  plus the independent `iat` check remain the **joint gate** — a nonce outliving
  the `iat` window would let the `iat` check pass responsibility to the nonce
  alone.

Universe's current DPoP validator (`server/mcp/src/auth/dpop.ts`) already checks
`typ`, algorithm policy, `htm`, normalized `htu`, `iat`, and `ath`, and returns
the `jkt` thumbprint, but it **explicitly does not yet implement a `jti` replay
cache or server-issued nonces** (its own follow-up note says so). The `jti`
replay store and nonce issuance are therefore **required new work**, not
existing behavior, and the stolen-credential guarantee in this RFC and in
acceptance scenario 10 depends on them.

If a bootstrap or enrollment credential is ever issued as something other than
an OAuth access token, it must carry an equivalent, explicitly specified
proof-of-possession and replay contract (unique proof id, server-side replay
rejection, and nonce where warranted); a bare bearer string is never sufficient.

### Credential delivery

Secrets should not appear in model-visible prose. In order of preference:

1. an OS keychain, IDE secret store, or trusted agent credential broker returns
   an opaque credential handle;
2. a local loopback/IPC channel delivers a one-time credential directly to the
   client process;
3. a one-time response is written to a mode-`0600` file or equivalent secure
   sink selected by the user;
4. terminal display is an explicit compatibility fallback with warnings and
   automatic rotation.

Server-side storage is hashed or encrypted as appropriate. Logs, traces,
analytics, support views, and error reports redact credentials.

### Agent-minted child credentials

An enrolled agent may call a native `credential.issue` operation without human
interruption only if its grant includes that authority. The new credential:

- must be a strict subset of parent accounts, projects, environments, actions,
  audiences, time, and budget;
- has a configured maximum lifetime and delegation depth;
- cannot add `credential.issue`, billing, ownership transfer, or destructive
  authority unless the parent grant explicitly permits that exact delegation;
- records the task/CI purpose and parent credential;
- is returned once to a secure sink;
- can be listed and revoked by human or parent agent;
- generates a security event and notification at the configured threshold.

This supports “create a CI deploy credential for this project” without
“navigate to settings and copy a personal token.”

Prefer handles to vendor-specific secrets where an Expo broker can inject a
secret into a build or deployment directly. A secret the agent never reads is
harder for prompt injection to steal.

### Rotation and revocation

Clients get first-class `credential.list`, `credential.rotate`, and
`credential.revoke` operations. Rotation is overlap-safe for a bounded grace
window. Revoking a parent can revoke all descendants. Losing the installation
key requires human or organization recovery, not an email containing a new
long-lived token.

## Proposed operation surface

The operation names are conceptual and should be projected consistently into
HTTP, CLI, and remote MCP:

| Operation | Purpose | Anonymous? |
| --- | --- | --- |
| `identity.inspect` | Discover actor, accounts, projects, and effective policy | No |
| `bootstrap.begin` | Idempotently request or create a provisional workspace | Bounded yes |
| `bootstrap.read` | Read state, limits, and next action | With bootstrap proof |
| `bootstrap.cancel` | Cancel and schedule provisional cleanup | With bootstrap proof |
| `claim.link` | Create the trusted human claim URL/code | With bootstrap proof |
| `billing.checkout.create` | Create an allowlisted hosted payment ceremony | Authorized/claim flow |
| `billing.read` | Read authoritative billing readiness and budget | Authorized |
| `credential.enroll` | Exchange approved bootstrap result for agent enrollment | Approved request |
| `credential.issue` | Mint a narrower child/task/CI credential | Delegated scope |
| `credential.list` | Inspect installations and descendants | Authorized |
| `credential.rotate` | Rotate without widening authority | Authorized |
| `credential.revoke` | Revoke a credential or installation tree | Authorized |
| `workspace.claim` | Transfer a provisional workspace into an owning account | Human-approved |
| `project.transfer` | Move a durable project between owning accounts | Authorized/high risk |

Operations return resource ids, state, structured policy/limits, audit ids, and
trusted next-action links. Human pages and provider redirects are projections
of the same server-side state machine.

LLP 0089 begins after an account/project authorization exists. Its
`app.provision`, `deployment.create`, secret, backup, and observability
operations should accept the scoped credentials produced here.

## Billing and payment contract

### Card data is not identity

A valid card does not establish who owns a project, where recovery mail goes,
whether enterprise SSO applies, or who accepted terms. Expo still needs a
recoverable human or organization owner. Conversely, a useful free provisional
workspace does not need a card.

### Hosted payment is the default

`billing.checkout.create` returns a short-lived Expo-owned URL that redirects
or embeds Stripe's hosted surface. It is bound server-side to:

- owning account and bootstrap/claim request;
- service, plan, price and terms versions;
- currency, tax/customer facts, and trial/free allowance;
- spend cap or overage policy;
- idempotency key and expiry;
- exact allowlisted return locations.

The agent may show or transmit that URL but cannot alter its payload. Raw PAN,
CVC, Apple Pay, Google Pay, or Link credentials never pass through agent tool
arguments.

Stripe webhooks and API reads establish authoritative payment state. Success
redirects, screenshots, agent assertions, and client-side callbacks are hints.
LLP 0069's provider-fact and idempotency rules apply even though this is
developer billing rather than app commerce.

### Payment method versus subscription

Expo should distinguish:

- setting up a reusable payment method and mandate;
- selecting a plan/subscription;
- approving metered overage and a budget;
- making a one-time purchase.

The claim page can combine these into one continuous experience, but the audit
record and APIs must not conflate them. SetupIntent/Checkout consent text must
cover future or off-session use where applicable.

### Spend safety

Every agent-accessible paid action is evaluated against:

- account plan and payment readiness;
- organization allow/deny policy;
- per-action estimate when possible;
- per-project and per-period hard or soft budget;
- cumulative usage;
- action sensitivity;
- the robot's standing mandate.

Alerts are not a substitute for a hard ceiling where the product claims one.
If a precise hard cap is technically impossible for a delayed meter, the UI
must state the bounded lag/exposure.

### Future agent-payment adapters

ACP, AP2, shared payment tokens, or a wallet may later let the human approve a
transaction or mandate in their existing agent environment. Expo should accept
such evidence only through a provider adapter that validates:

- issuer and cryptographic integrity;
- merchant/payee restriction;
- amount, currency, purpose, expiry, and recurrence;
- replay/idempotency state;
- refund/dispute and customer-support facts.

The internal account, entitlement, budget, receipt, and audit model stays the
same. These protocols are an optional convenience, not a launch dependency.

## Notifications, audit, and recovery

The human should be told when an agent:

- is enrolled or granted broader authority;
- creates, reveals, rotates, or revokes a durable credential;
- adds a payment method, changes plan, or enables paid overage;
- crosses spend thresholds;
- transfers a project or changes ownership;
- accesses a sensitive secret or performs a destructive action;
- is automatically suspended for risk or policy.

Notification channels are user-configurable and risk-tiered. Email is a useful
default after verification; push and in-product security inbox are better for
urgent actions; SMS is optional. Notification must not leak secrets.

The security/activity view records:

- human owner, effective principal, robot/agent client, installation key;
- request, session, task, and parent delegation;
- account/project/environment/resource;
- requested and effective scopes, budget, and policy decision;
- before/after state or immutable event facts;
- time, approximate client/network risk data, and outcome;
- links to revoke, dispute, or get support.

High-risk approvals, including a first workspace claim, should have a short
cancellation/hold window when feasible; during that window a claim can be
reversed before ownership, credentials, and any billing mandate become durable.
Recovery must cover a lost agent device, lost human login method, dead email
address, enterprise administrator change, payment dispute, an expired
provisional workspace, and a **contested or mistaken claim** (a workspace
claimed into the wrong account). In-window, the recovery ceremony reverses the
claim; after the window, it follows the project-transfer/tombstone path to move
a wrongly captured workspace back and disable the incorrect owner after
retention checks. Who may invoke reversal, and on what evidence, is pinned by
the **recovery authority and evidence hierarchy** in §"The claim capability is
an acknowledged bearer capability": the bootstrap-request proof-of-possession
holder (the agent-installation key holder) is a first-class recovery/dispute
principal — the anchor that exists even in the no-contact-hint anonymous case —
an unauthenticated contact hint may never itself reverse a claim, and when no
party has superior proof the workspace resolves toward reversibility rather than
toward the current possessor. Recovery cannot depend solely on the agent that is
being recovered, nor on the same claim capability that was used to claim.

## Security and abuse model

### Principal threats

- Prompt injection convinces an agent to widen its own authority, reveal
  credentials, transfer a project, or spend money.
- Automated clients create provisional workspaces for spam, phishing, malware,
  credential validation, cryptomining, or free-resource farming.
- A contact hint becomes an account-enumeration or email/SMS spam oracle.
- An attacker steals a claim URL or bearer bootstrap token and claims another
  agent's work.
- A malicious agent substitutes its own destination account or a higher-priced
  plan during approval.
- A malicious or compromised agent host forges, replays, or overstates a human
  identity assertion or consent receipt.
- Browser redirect or open-redirect confusion causes the agent to accept false
  completion.
- Credentials leak through model context, shell history, logs, support tools,
  or generated source.
- Project transfer leaves stale credentials, domains, webhooks, or billing
  ownership.
- A trusted agent recursively mints broader or longer-lived credentials.
- A user confuses the agent software's identity with the Expo account that will
  own and pay for the project.
- A CIMD (client-id metadata document) fetch is pointed at an internal address
  or a hostile/oversized/redirecting endpoint to drive SSRF, resource
  exhaustion, or metadata poisoning, or a client presents metadata to imply
  authority it does not have.

### Required defenses

- Proof-key binding for bootstrap and enrolled credentials, including the
  normative RFC 9449 replay contract in §"Proof-of-possession and replay
  contract" (unique `jti` with server-side replay rejection, key-thumbprint
  continuity, and authorization-server nonces at bootstrap/status/exchange);
  PKCE, state, nonce, exact redirect matching, and short expiries.
- A human approval summary naming the agent, owner, project, scopes, duration,
  price, and maximum spend; a signed/durable receipt records the same facts.
- Strict trust registration, signature/issuer/audience/nonce/time validation,
  minimum claims, replay prevention, and incident revocation for federated
  agent-host assertions, with a bounded maximum issuer-revocation propagation
  time (a compromised trusted host is the highest-privilege blast radius, since
  it can create or link human identities). First-time linking follows the
  §"Trusted-host account-linking rule"; identity *creation* via a federated
  assertion is additionally gated behind a freshness/liveness check. Expo—not
  model-provided text—supplies the request displayed by the host, as a
  canonical Expo-signed, nonce-bound request object/digest that the assertion
  and consent receipt must echo (stale or altered requests are rejected).
- Provider webhooks/API state, never redirects, as payment authority.
- Non-enumerating responses and rate limits for email, SMS, client metadata
  fetch, signup, claim, and workspace creation. CIMD metadata fetches apply an
  SSRF-safe fetch policy (address/scheme allowlisting, no private-network
  targets, redirect and response-size limits, timeouts, and cache/trust
  controls). Client identity established via CIMD identifies which software is
  acting and never by itself authorizes an Expo account.
- Trusted, visibly Expo-owned universal links with no caller-selected return
  origin outside a strict allowlist. The claim URL/code is an acknowledged
  bearer ownership capability (see §Flow D): single-use, short-lived,
  narrowly disclosed, with a receipt showing both claimant and destination,
  notification to associated/prior channels on claim, a hold/reversal window so
  a first claim is not irreversible through possession alone, and a recovery
  path independent of the claim capability. Possession never silently changes
  the approved agent key or destination.
- Resource/audience-constrained access tokens, sender constraints, child-grant
  attenuation, and revocation cascades.
- Server-side policy checks at every operation; the approval UI does not create
  ambient authority outside the recorded grant.
- Secret redaction and secure credential sinks.
- Separate provisional and production capability sets.
- Malware/abuse scanning, egress controls, quotas, reputation, and rapid
  suspension for anonymous resources.
- Transfer fences that re-authorize integrations and split usage attribution at
  an explicit cutover.
- Clear Expo-versus-agent branding and a security inbox independent of the
  agent client.

Several values this RFC defers to implementation specs are **security
parameters with justified minimums, not free UX knobs**: the hold/reversal
window duration parametrizes the bearer-capability reversal guarantee (§Flow D,
concern-driven), the `jti`/nonce cache retention must cover **at least the `iat`
acceptance window** (§"Proof-of-possession and replay contract", underpinning
acceptance scenario 10), and the **issuer-revocation propagation bound** limits
a compromised trusted host's blast radius. The follow-on specs must set these
against a defensible security floor rather than optimize them purely for
friction. For the **hold/reversal window**, the invariant the floor MUST satisfy
is stated here even though the number is deferred: **the window MUST exceed the
maximum notification-delivery plus human-reaction latency for the
fastest-observing channel** available to the workspace (so a contesting party
can actually observe and freeze an errant claim before it commits). Violating
that floor **weakens the reversal security guarantee** — an under-sized window
(shorter than notification-delivery plus reaction latency) may leave a
legitimate observer unable to contest before commitment — even though absent
acknowledgements and active contests still **fail safe** (the default resolves
toward reversibility and paid/irreversible actions stay gated until the hold
clears). The *floor* is therefore a security parameter, and deriving the
concrete value is a Slice-0 threat-model output, not a UX knob.

The hold-window **floor invariant and the recovery gate limb are two mechanisms
for two distinct cases, not one mechanism that always yields a human observer**.
The **floor invariant governs the case with a human-observable channel** — a
consented contact hint or a channel associated with a matched-but-not-
authenticated existing identity — where a real human can be notified and must be
given time to contest before commitment. The **gate limb** (§"The claim
capability is an acknowledged bearer capability"; §"Recovery authority and
evidence hierarchy") **governs the no-live-observer case** — the anonymous
PoP-only workspace whose only observer is the bootstrap-request
proof-of-possession holder (a polling machine, possibly gone or hostile): absent
a live PoP-holder acknowledgement within the window, durable ownership is
**gated on a stronger binding** rather than committed on possession. The floor
does not presuppose a human observer in that case; the gate limb, not the
notification-latency floor, is what carries the guarantee there.

## Enterprise and policy considerations

An agent-native flow must not become a side door around organization controls.
The destination account may require:

- SSO and administrator approval;
- allowed agent clients or publishers;
- managed-device or network conditions;
- maximum credential lifetime and mandatory DPoP;
- denied scopes such as billing, secret reveal, transfer, or production deploy;
- fixed data region and residency constraints;
- repository/provider linkage;
- centralized budget and cost center;
- retention, legal hold, and audit export;
- no anonymous provisional import.

If policy prevents immediate claim, the bootstrap remains pending or the human
can choose another authorized destination. The agent gets a structured reason
without sensitive organization details.

## Implementation direction

### Universe

Universe should own:

- bootstrap request and provisional-workspace records;
- human identity/account claim and organization policy;
- trusted agent-host issuer registration, assertion verification, consent
  receipts, and emergency trust revocation;
- agent client, installation, robot, grant, and credential metadata;
- project transfer and ownership history;
- Stripe session creation, webhook reconciliation, subscriptions, budgets, and
  entitlements;
- audit events, notifications, risk decisions, expiry, and cleanup.

The implementation should extend `RobotEntity`, OAuth clients, access-token
audit, project transfer, and Stripe Checkout rather than create parallel
notions of owners and credentials. A new scoped/sender-constrained credential
format can coexist with current access tokens during migration.

Universe's existing PostHog agentic-provisioning client should become a
conformance fixture for the shared account-request/resource/credential shape.
Expo's provider side may publish equivalent discovery metadata and a stable
CIMD document for first-party agent clients.

### Expo Agent, CLI, and MCP

Official clients should:

- inspect credentials and project linkage first;
- generate and protect the installation key;
- initiate bootstrap only when necessary;
- render URL, QR, expiry, requested authority, and preview limitations;
- continue useful local/provisional work while approval is pending;
- poll with server-specified intervals and resume automatically;
- store credentials through a broker or keychain;
- surface structured conflicts rather than create another account;
- show the final account, project, plan, budget, and revocation link.

Remote MCP uses the current MCP OAuth discovery and authorization model once
the client has or requests account authority. The public bootstrap operation
must remain a narrow provisioning surface; it is not an anonymous general Expo
MCP server.

### EAS Hosting and Snapback

EAS Hosting and hosted Snapback should accept the stable provisional or durable
project/environment identity and enforce the corresponding entitlement.
Provisional resources must be mechanically unable to consume paid overage.

When claimed, stable project and Snapback environment ids survive. Usage before
claim is attributed to the **pre-claim ownership interval**, and usage after the
authoritative cutover is attributed to the destination Expo account. LLP 0104
owns exact meter and invoice semantics.

Because a provisional workspace is explicitly **not** an `AccountEntity`, it has
no `expoAccountId` to be the owner-of-record for that pre-claim interval. This
RFC pins the pre-claim owner-of-record to **either** a platform/promotional
pseudo-account **or** an explicit **null-owner (platform-escrow) interval** that
0104's metering identity must admit — LLP 0104's §"Metering identity and event
contract" makes the *ownership interval* authoritative and derives
`expoAccountId` from it, so this is the natural amendment point: **0104 must
admit a non-`AccountEntity` (platform-escrow) owner for the pre-claim interval**,
which the claim cutover then closes and reopens under the destination account
(consistent with 0104 listing `transfer`/`preview-TTL governance` as
non-chargeable). The "mechanically cannot consume paid overage" property is **not**
a local assertion of this RFC: it is enforced by **0104's authoritative
account-budget/lease protocol** (§"Authoritative account-budget protocol"),
under which a provisional/escrow owner is issued a fixed free budget and no
paid-overage lease, so the enforcement lives in the meter, not in preview code.

### Credential broker

Expo should define a small credential-broker interface usable by Codex, Claude,
IDE agents, CLI, and CI:

- store and retrieve by issuer, account, project, audience, and installation;
- keep the secret outside normal model context;
- sign DPoP proofs or requests without exporting the private key;
- request attenuation/rotation;
- revoke and enumerate descendants;
- communicate locked, expired, or human-action-required state.

OS keychains and vendor secret stores can implement the interface. A plaintext
dotfile is not the default.

## Delivery slices

### Slice 0: protocol and threat-model spike

- Specify bootstrap/claim state, receipt, outcomes, idempotency, and cleanup.
- Decide which current agentic-provisioning draft fields Expo can share.
- Prototype the key-bound flow against one official CLI/agent.
- Threat-model anonymous resource creation, contact delivery, and claim
  hijacking, and **produce a defensible anonymous-preview abuse budget**
  (open question #1).

**This spike gates Slice 2.** Slice 2 (anonymous provisional workspace and
claim) MUST NOT ship until Slice 0's threat model has produced an acceptable
anonymous-preview abuse budget. If that budget is not defensible for a remotely
deployed preview, Slice 2 begins instead with the local artifact/build-sandbox
fallback (§"Provisional workspace contract") rather than an anonymous deployed
preview.

### Slice 1: existing-account paved path

- Identity/project inspection.
- Robot enrollment and short-lived scoped credentials.
- Secure credential broker integration.
- Native list/rotate/revoke and security notifications.
- No anonymous provisioning yet.

This slice removes most settings/API-key friction for current Expo users.

### Slice 2: provisional free workspace and claim

- Expiring platform-escrow workspace and quotas.
- Trusted agent-host identity assertions and in-product consent for approved
  partners.
- One-link/QR claim with passkey/OAuth/email.
- Project transfer from escrow to an existing or new account.
- Duplicate detection, generic contact behavior, expiry/export/cleanup.

### Slice 3: billing and unattended policy

- Stripe-hosted setup/Checkout in the claim ceremony.
- Webhook-authoritative entitlement.
- Plan, pricing-version, budget, and recurring-mandate receipts.
- Standing paid delegation with spend limits and approval fallback.

### Slice 4: ecosystem adapters

- Remote MCP projection and published discovery/client metadata.
- Compatibility tests against agentic-provisioning clients.
- Optional push/CIBA-style approval.
- Optional ACP/AP2/shared-payment-token adapter after standards and provider
  support mature.

## Acceptance scenarios

The RFC is ready to graduate into implementation specs when the following can
be tested unambiguously:

1. A Codex or Claude client with no Expo account or browser creates a bounded
   workspace, deploys a useful preview, and receives one claim URL.
2. An agent with an existing scoped Expo grant deploys without interruption
   and does not create another account.
3. A registered trusted agent host passes a fresh consented identity assertion;
   Expo links or creates the correct identity and enrolls the agent without the
   human visiting an Expo page or exposing a secret to the model.
4. A replayed, wrong-audience, expired, unsigned, or model-invented host
   assertion cannot create, link, or claim an account.
5. An email hint matching an existing user neither creates a duplicate nor
   reveals account existence to the unauthenticated client.
6. A new human opens one mobile link, creates/signs into an Expo identity,
   approves the agent, pays with an eligible wallet, and the polling agent
   resumes without pasted secrets.
7. Repeating every request after a timeout produces one workspace, one claim,
   one subscription, and one credential lineage.
8. Claiming or transferring preserves project/environment identifiers and
   splits usage attribution at an explicit cutover.
9. An organization requiring SSO/admin approval blocks claim without leaking
   policy details or bypassing the requirement.
10. A compromised bootstrap bearer value cannot be used without the agent key
   (proof-of-possession with `jti` replay rejection and, where required, a
   server nonce). The claim URL/code is an acknowledged bearer capability: a
   stolen claim URL cannot silently change the approved agent key or
   destination, cannot make a first claim irreversible through possession
   alone, produces a receipt naming both claimant and destination, notifies the
   workspace's associated/prior channels on claim, and is reversible within the
   hold window through a recovery path that does not reuse the claim capability.
   For a no-contact-hint anonymous workspace, the claim notifies the originating
   agent channel (the bootstrap-request key holder) or gates durable ownership
   on a stronger binding, and that key holder — which a URL thief lacks — can
   contest the claim during the hold; an unauthenticated contact hint can never
   reverse a claim.
11. A child credential cannot exceed the parent's scopes, resources, lifetime,
   audience, spend, or delegation depth.
12. Revoking an installation invalidates refresh authority and all configured
    descendants; short access-token residual lifetime is bounded and visible.
13. A model/prompt injection cannot submit raw card data, silently widen a
    plan, disable a spend limit, or accept a redirect as proof of payment.
14. Credential issue, rotation, paid activation, sensitive action, and transfer
    produce attributable audit events and appropriate human notifications.
15. Expiry warns the agent and, where a verified owner exists, the human;
    export/retention/deletion behavior matches the published provisional
    contract.
16. No credential, PAN, CVC, wallet secret, or claim capability appears in
    normal logs, traces, analytics, generated code, or model-visible output.

## Open questions

- How useful can the anonymous preview be before abuse risk exceeds its product
  value: remote deploy, local-only artifact, or an invite/reputation-gated
  hybrid?
- Which agent hosts can meet the stronger federated-identity trust contract,
  how are their consent UIs certified, and how quickly can Expo revoke a
  compromised issuer?
- Should one provisional workspace contain exactly one project, or may a
  single app-building task create a small linked set?
- What minimum recovery channel is required to turn a claimed workspace into a
  durable free account if passkeys are the primary login?
- Which agent client identities may use CIMD directly, and when must they use an
  Expo-hosted registration/metadata service?
- Which scopes and maximum lifetimes are safe for unattended child credential
  issuance?
- Can current Expo robot/account permission semantics be extended cleanly, or
  is a separate fine-grained grant table required alongside them?
- Which paid actions can offer true hard caps, and what worst-case meter lag
  must be disclosed for the rest?
- Should a claim default to a personal account, prompt for an organization, or
  recommend an existing project match?
- What transfer hold/reversal window best balances accidental claims and
  immediate usefulness?
- Which notifications are mandatory and which are user-configurable?
- What legal and product wording distinguishes an expiring platform sandbox
  from creation of a durable Expo customer account?

## Ratification checklist

Before acceptance, Expo identity, billing, security, EAS/agent developer
experience, enterprise, legal/privacy, and abuse owners should explicitly
ratify:

- provisional workspace instead of synthetic permanent user;
- trusted-host in-agent signup, universal one-link claim, and
  standing-delegation trust boundaries, including the §"Trusted-host
  account-linking rule", a bounded issuer-revocation propagation time, and the
  freshness/liveness gate on identity *creation* via federated assertion;
- the claim URL/code as an acknowledged bearer ownership capability with
  receipt (claimant + destination), notification, hold/reversal window, and
  recovery path;
- human/account/robot identity model;
- scoped proof-key-bound credential model and child delegation;
- Stripe-hosted payment as launch default;
- project transfer and identity linking instead of automatic account merge;
- phone/SMS as optional delivery only;
- anonymous limits and expiry/deletion contract;
- notification, audit, recovery, and enterprise-policy requirements;
- standards classified as normative, compatibility, or future/experimental.

## Status

Accepted (2026-07-28) via `/llp-super-refine` dual-family review. This RFC
establishes the product and trust model. It still does not authorize anonymous
production workloads, autonomous uncapped billing, or a new credential format
until the follow-on implementation specs define wire, storage, policy, and
rollout details and the named LLP 0103/0104 amendments land.
