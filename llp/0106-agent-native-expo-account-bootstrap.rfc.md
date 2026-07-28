# LLP 0106: Agent-native Expo account bootstrap

**Type:** RFC
**Status:** Draft
**Systems:** Developer experience, Expo accounts, Identity, Auth, Agent tooling, Provisioning, Billing, Payments, Security, Audit
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Revised:** 2026-07-28 (initial draft after Snapback and Universe source review and primary-source standards research)
**Related:** LLP 0000, LLP 0009, LLP 0010, LLP 0018, LLP 0019, LLP 0024, LLP 0036, LLP 0055, LLP 0060, LLP 0069, LLP 0071, LLP 0089, LLP 0103, LLP 0104, LLP 0105, https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization, https://www.rfc-editor.org/rfc/rfc8628.html, https://www.rfc-editor.org/rfc/rfc8693.html, https://www.rfc-editor.org/rfc/rfc9396.html, https://www.rfc-editor.org/rfc/rfc9449.html, https://www.rfc-editor.org/rfc/rfc9700.html, https://www.rfc-editor.org/rfc/rfc9728.html, https://www.ietf.org/archive/id/draft-ietf-oauth-client-id-metadata-document-02.html, https://openid.net/specs/openid-connect-core-1_0.html, https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html, https://www.w3.org/TR/webauthn-3/, https://docs.stripe.com/payments/checkout, https://docs.stripe.com/payments/setup-intents, https://github.com/agentic-commerce-protocol/agentic-commerce-protocol, https://github.com/google-agentic-commerce/AP2

## Summary

An agent asked to make and publish an Expo app should be able to begin work
without stopping at “visit this settings page, create an account, and paste an
API key.” It should also avoid inventing a second Expo identity when the human
already has one, avoid handling raw card data, and leave the human with clear
ownership, recovery, audit, and revocation.

This RFC proposes an **agent-native Expo bootstrap protocol** with three paths:

1. An agent with a valid Expo delegation discovers and uses the existing
   account. Within the delegation's scopes and spending policy, the entire flow
   can be unattended.
2. A trusted agent host can, with the human's consent, pass Expo a signed
   identity assertion and render Expo's exact authorization request in its own
   secure UI. Expo links or creates the human identity and enrolls the agent
   without making the human navigate to an Expo webpage.
3. An agent without either trust path creates an expiring, tightly limited
   **provisional workspace** and receives a proof-key-bound bootstrap
   credential. It can build and deploy a free preview immediately. Expo returns
   one trusted claim URL and QR code. When durable ownership, production
   capabilities, or billing is needed, the human uses that single page to sign
   into or create an Expo identity, select the owning account, approve the
   agent's authority, and optionally complete Stripe-hosted payment. The agent
   polls, then resumes automatically.

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
  bound to that key so a leaked bearer string is insufficient by itself.
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
  secure in-agent consent surface, without an Expo-site detour.
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
  another device.”
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
- **OAuth Token Exchange (RFC 8693)** as a model for attenuating a parent grant
  into a shorter, narrower task or CI credential.
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
   - a trusted `verification_uri_complete`;
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
   and budget in trusted host UI outside the model-controlled transcript.
3. The host sends a one-time signed assertion containing issuer, stable subject,
   Expo audience, nonce, issue/expiry time, verified claims, consent receipt,
   agent installation key, and bootstrap request.
4. Universe verifies the assertion and resolves the issuer/subject to an
   existing Expo identity. Account linking follows explicit verified-identity
   and SSO policy; it never relies on an unsigned email hint.
5. If no identity exists, Universe can create the human identity and primary
   account from the federated assertion, subject to required terms, age,
   region, recovery, and organization policy.
6. The host returns Expo's signed authorization receipt to the client and the
   agent completes key-bound enrollment.

This is the closest match to “ask the agent to make an app and never visit an
Expo page.” It still includes human consent when a new identity, broad
authority, or payment mandate is created, but the consent happens in the
already-open agent product. The model cannot self-assert the user's identity or
click its own approval.

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
- no paid overage and no negative balance;
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

A bootstrap request has one explicit state:

```text
REQUESTED
  → PROVISIONING
  → PROVISIONAL
  → AWAITING_CLAIM
  → AWAITING_POLICY
  → AWAITING_PAYMENT
  → ACTIVE_FREE | ACTIVE_PAID

Any non-terminal state → DENIED | EXPIRED | CANCELLED
```

Not every request visits every state. An existing valid delegation may go from
`REQUESTED` to `ACTIVE_FREE` or `ACTIVE_PAID` without creating a provisional
workspace.

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

High-risk approvals should have a short cancellation/hold window when feasible.
Recovery must cover a lost agent device, lost human login method, dead email
address, enterprise administrator change, payment dispute, and an expired
provisional workspace. Recovery cannot depend solely on the agent that is being
recovered.

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

### Required defenses

- Proof-key binding for bootstrap and enrolled credentials; PKCE, state, nonce,
  exact redirect matching, and short expiries.
- A human approval summary naming the agent, owner, project, scopes, duration,
  price, and maximum spend; a signed/durable receipt records the same facts.
- Strict trust registration, signature/issuer/audience/nonce/time validation,
  minimum claims, replay prevention, and incident revocation for federated
  agent-host assertions. Expo—not model-provided text—supplies the request
  displayed by the host.
- Provider webhooks/API state, never redirects, as payment authority.
- Non-enumerating responses and rate limits for email, SMS, client metadata
  fetch, signup, claim, and workspace creation.
- Trusted, visibly Expo-owned universal links with no caller-selected return
  origin outside a strict allowlist.
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
claim is charged to the promotional/provisional pool; usage after the
authoritative cutover is attributed to the destination Expo account. LLP 0104
owns exact meter and invoice semantics.

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
  hijacking.

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
10. A compromised bootstrap bearer value cannot be used without the agent key,
   and a stolen claim URL cannot silently change the approved agent key or
   destination.
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
  standing-delegation trust boundaries;
- human/account/robot identity model;
- scoped proof-key-bound credential model and child delegation;
- Stripe-hosted payment as launch default;
- project transfer and identity linking instead of automatic account merge;
- phone/SMS as optional delivery only;
- anonymous limits and expiry/deletion contract;
- notification, audit, recovery, and enterprise-policy requirements;
- standards classified as normative, compatibility, or future/experimental.

## Status

Draft. This RFC proposes the product and trust model. It does not authorize
anonymous production workloads, autonomous uncapped billing, or a new
credential format until the relevant owners ratify the decisions above and
follow-on implementation specs define wire, storage, policy, and rollout
details.
