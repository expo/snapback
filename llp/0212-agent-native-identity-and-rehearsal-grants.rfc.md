# LLP 0212: Agent-native identity and rehearsal grants

**Type:** RFC
**Status:** Draft
**Systems:** Auth, Identity, Developer experience, Agent tooling, Testing,
Security, CLI, Email delivery
**Author:** Charlie Cheever / Claude (Fable 5), with a commissioned
independent brainstorm from Codex (gpt-5.6-sol, xhigh) on 2026-08-09 —
idea provenance is tagged throughout ([C] Claude, [X] Codex, [=] both
families converged independently)
**Date:** 2026-08-09
**Revised:** —
**Related:** LLP 0011 (auth and permissions — the principal-first root),
LLP 0057 (auth provider protocol — the shipped email-code provider,
capture mailbox, throttle constants, `ImpersonationCapability`),
LLP 0151 (first-party identity integrations — the provider/authenticator
roadmap this RFC integrates with, never competes with), LLP 0055 (agent
principals and scoped grants), LLP 0150 (agent token acquisition),
LLP 0203 (agent-native surface principles), LLP 0060 (hosted auth
security), LLP 0096 (auth profiles for protocol clients), LLP 0106
(agent-native account bootstrap — custody and ceremony patterns),
LLP 0045 (notifications outbox — the unbuilt delivery path), LLP 0036
(config/secret state), LLP 0058 (staged auth mode), LLP 0024 (host ops —
impersonation flags)

## Summary

Snapback wants what GoTrue affords — `signUp({email, password})` works in
minute one; sessions, verification, recovery, social login, and an admin
API all come from one coherent service — without inheriting the parts of
GoTrue that are hostile to the actual Snapback developer, who is usually
an AI agent: SMTP as a prerequisite for anything working, email
verification loops that block signup testing, fixed rate limits that bite
mid-iteration, CAPTCHA, redirect-URL allowlists, dashboard-only knobs, a
god-mode service-role bearer, and stringly errors.

This RFC does three things:

1. **Records a wide brainstorm and its evaluation** — thirty-odd ideas
   from two model families run independently, bucketed into a build-first
   core, cheap wins, deferrals, and explicit rejections. The rejected-ideas
   record is deliberate corpus culture: the next designer should know what
   was considered and why it lost.
2. **Pins the product thesis**: identity organized around the Snapback
   principal (which LLP 0011 already made the durable root), with
   identities, credentials, and *assurances* as separate attachments, and
   verification recast as **capability upgrade instead of login gate**.
3. **Designs the author's "special token" idea into its safe shape**: not
   a god token that "turns things off," but a scoped, profile-bound,
   instance-bound **auth rehearsal grant** carrying named waiver effects
   with finite budgets — plus a server-side **rehearsal window** so
   ordinary app UI can be exercised without any override capability ever
   touching application code.

The landing shape is deliberately non-umbrella: LLP 0151 remains the
authority for provider integrations and the tier model; this RFC supplies
the product synthesis 0151 doesn't attempt, raises the priority of the
lifecycle spec 0151 commissioned but left unowned, and commissions the
rehearsal-grants Spec as its own document with its own threat model and
acceptance matrix.

## Motivation

### What GoTrue affords (the results to keep)

One service gives you signup, login, logout, refresh, token issuance;
email/password, magic links, email+SMS OTP, ~20 OAuth providers, SAML,
anonymous sign-in; email verification, password recovery, invites; an
admin API; refresh-token rotation, MFA, identity linking; rate limiting
and captcha hooks. The *ease* is the product: a developer gets a working
auth system before understanding any of it.

### Where GoTrue hurts agents (the pains to kill)

- **SMTP before anything works.** Email flows are the default path and go
  nowhere until a mail vendor is configured; in dev the verification email
  vanishes and the agent fake-verifies through the admin API awkwardly.
- **Verification blocks sessions.** "Email not confirmed" gates login
  globally, so signup testing loops through verification every time.
- **Fixed rate limits bite iteration.** A 4-emails-per-hour default is
  abuse defense pointed at the developer.
- **Human ceremonies everywhere**: OAuth app registration, redirect-URL
  allowlists, dashboard toggles ("Confirm email" is a UI switch, not
  config in the repo).
- **The service-role key** is a durable god bearer that leaks into client
  bundles — the exact class LLP 0150 invariant 1 exists to eliminate.
- **Stringly errors** ("Email not confirmed") instead of typed causes with
  next moves — the LLP 0203 P2 offense.
- **CAPTCHA** is agent-hostile by design.
- **Test users pollute real tables**; there is no first-class fixture,
  persona, or time-travel story.

### What Snapback has today (grounding, per the corpus)

The one architectural idea is already right: **the server derives who you
are; the client never asserts it** (LLP 0011; the LLP 0058 shared
invocation gate). Shipped today on the local target: exactly one
authenticator — the passwordless email-code provider (LLP 0057, Accepted)
— with sessions, rotation, family alarm, and the four reserved `_auth_*`
tables app code physically cannot address. No password, no magic links,
no OAuth, no passkeys, no anonymous principals, no SMS (LLP 0151
§Summary states this flatly). There is **no production email path at
all**: codes land in a dev/test/demo capture mailbox and `prod` refuses
`/auth/request-code` outright — so "email-code login, React web" has no
self-serve production story yet (guide/auth/sessions-and-principals.md).
Rate limits are constants, not configuration (per-address 5/10min in
test+prod, global 120/60s everywhere). Test personas exist but need two
independent local-only carriers (admin token + `ImpersonationCapability`),
and `app.reset` reissues principal ids so fixtures can never hold raw
ids. Handlers see the resolved principal and nothing else — no verified
email claim — which makes principal↔app-row binding a documented gap
(`issues/20260808-guide-gap-principal-to-app-identity-binding.md`).

Snapback also has real assets GoTrue lacks, which this RFC builds *on*
rather than re-deriving: the shared invocation gate; connection-bound
authority with generation fencing; the authorization-invalidation
obligation protocol; authorized leases; agent service principals with
scoped grants and pairing (LLP 0055); the key-bound acquisition path
(LLP 0150); `authProgramReadiness` self-report; and the reserved
namespace.

### The design question, sharpened

GoTrue's frictions are not gratuitous — each one bounds a real abuse or
closes a real hole. The agent-native redesign question is therefore never
"how do we turn X off" but "what is X *for*, and can we deliver that
protection through a mechanism that doesn't tax legitimate iteration?"
Rate limits bound abuse cost → replace with named budgets that scale
with proven trust. Email verification proves contact ownership → defer
it to the capability that needs it. CAPTCHA deters bots → distinguish
*authorized* agents structurally instead. The special token the author
proposed is the general form of this move: **a way to present proof of
development authority and receive relief from protections whose threat
model you are provably outside of** — and §Rehearsal grants gives it a
shape that cannot become a production bypass.

## Design frame: four layers

Adopted from both brainstorms and consistent with LLP 0011/0151 [=]:

1. **Principal** — the durable actor: human, agent, guest, or service.
   Snapback-issued, the only thing app data references.
2. **Identity** — a verified identifier or external subject attached to a
   principal: email, phone, `(issuer, subject)` OIDC pair, username.
3. **Credential** — something that can authenticate the principal:
   password hash, passkey, recovery codes, key-bound agent credential.
   LLP 0151's round-1 structural ruling stands: identities and
   credentials never share a relation.
4. **Assurance** — server-derived evidence with kind, source, time, and
   provenance: `authenticated`, `email_verified`, `recent_auth`,
   `phishing_resistant`, `rehearsal_simulated`. Functions and lifecycle
   transitions require assurances; a session is a projection of this
   state, not the identity itself.

The fourth layer is the load-bearing novelty relative to GoTrue: a global
`email_confirmed` boolean becomes a per-claim assurance that *upgrades
capability* rather than gating login, and a simulated assurance minted
under rehearsal authority is mechanically distinguishable — and
inadmissible in production — by construction.

## Idea inventory

Thirty-two ideas from the two independent brainstorms, merged and
deduplicated. Provenance: [C] Claude, [X] Codex, [=] independent
convergence (treated as signal).

### Identity primitives

- **I1. Declared auth program** [X] — one generated `defineAuth(...)`
  declaration owns mechanisms, providers, assurance requirements,
  delivery adapters, recovery policy, guest policy, and abuse budgets.
  Codegen derives schemas, client state machines, readiness facts, fixture
  vocabulary, and provider-registration instructions from it. Kills
  dashboard-only configuration and env-var scatter; secret *references*
  live in the declaration, secret values in LLP 0036 state. (LLP 0203 P1:
  generated or gated, never transcribed.)
- **I2. Principal-first identity graph** [=] — formalize the four-layer
  split above in catalog v3. Email changes, social linking, guest
  claiming, and credential rotation become ordinary graph transitions,
  never user migrations. Largely ratifies what 0011/0151 already chose.
- **I3. Guest-first sessions / anonymous-first progressive identity** [=]
  — every client can mint a real, server-minted guest principal before
  any identity exists; identity factors attach later and upgrade
  assurance. Signup stops being a gate and becomes an upgrade. The 0011
  guest-claiming amendment already designed the hard parts (continuous
  `userId`, typed collision refusal with `switch_existing` / declared
  `merge`, reaping policy); this RFC proposes making it the paved
  *template default* for agent-built apps, not a platform-wide default.
- **I4. Assurance as capability upgrade** [=] — replace boolean
  verification with the assurance layer; functions declare
  `requires: ['email_verified']` (or an app-defined assurance profile) the
  same way they declare `auth: 'authenticated'` today. Verification stops
  blocking identity creation; prod-sensitive operations stay protected.
- **I5. Key-bound users — agents as first-class app users** [=] — an app
  whose *users* are agents authenticates them as LLP 0055 agent
  principals with key-bound credentials and scoped grants, never borrowed
  human sessions or personal API keys. Integrates 0055/0150; absorbs
  nothing. Increasingly the norm, and no GoTrue analog exists.
- **I6. Zero-dependency password + recovery floor** [X] — password
  accounts that work in production with *no* SMTP, OAuth console, or
  broker: Argon2 outside the storage lock, common-password screening,
  non-enumerating guessing defenses, recovery codes, last-authenticator
  rule. Kills the "nothing works until email is configured" bootstrap
  trap; email recovery becomes an upgrade, not the only path.
- **I7. Passkeys as a strong additional authenticator** [=] — WebAuthn
  with custom-domain-first policy, never the sole authenticator in v1,
  generated-domain passkeys staying preview-only per the 0151 ruling of
  2026-08-08.
- **I8. Verified provisioning hook** [X] — after successful verification,
  the host invokes a generated transactional hook with the verified
  identity result *and* the resolved principal, so the app idempotently
  creates its profile/binding/membership rows through declared writes.
  Directly closes the documented principal↔app-identity binding gap
  without a `bindMe({userId})` bypass mutation.

### Verification and delivery

- **V1. Deferred verification** [=] — the mechanism of I4 applied to
  signup: a usable lower-assurance principal immediately; verification is
  a later transition that upgrades capability and rotates the session.
  "Verification required" becomes app policy per function, not an
  identity-server global.
- **V2. Captured inbox as a first-class surface** [=] — promote LLP
  0057's capture mailbox from a challenge-id-keyed peek route into a
  CLI/MCP surface: list pending challenges, redeem one directly into an
  auth coordinator or persona handle, open a magic link in a controlled
  browser. Plaintext codes are not printed by default; reveal is a
  separate audited action, keeping one-time secrets out of model-visible
  prose (the LLP 0106 credential-custody stance).
- **V3. Delivery simulator** [X] — deterministic per-fixture delivery
  profiles: `delivered`, `delayed`, `bounced`, `provider_unavailable`,
  `expired_before_open`, `duplicate_callback`, with structured receipts.
  Failure-path testing without a vendor; strictly more valuable than a
  mailbox that only models perfect delivery.
- **V4. Ephemeral delivery adapters** [X] — Snapback owns challenge
  creation and verification; vendor drivers receive only ephemeral
  destination/template variables and return a classified result. Email is
  tier 1 with capture and real-vendor arms; SMS stays tier 2 per 0151.
  Preserves the LLP 0045 rule that plaintext challenges are never durable
  notification intents.
- **V5. Machine-completable flows** [=] — under rehearsal authority
  (§Rehearsal grants), a test can complete a challenge in one call —
  request-code → redeem — without even reading an inbox. The existing
  triple-gated persona recipe collapses to one budgeted, audited
  operation.
- **V6. Legible no-delivery posture in prod** [C] — an app that requires
  verified email on a deployment with no configured delivery channel
  fails *at deploy/readiness time* with a typed diagnostic naming the
  missing adapter — never as a runtime surprise to end users. (LLP 0203
  P4: absences are declared where the agent reads before invoking.)

### Rehearsal (the override-token idea, in its safe shape)

- **R1. Scoped auth rehearsal grant** [=] — the centerpiece; full design
  in §Rehearsal grants. A server-side grant, profile-bound (dev/test/demo,
  never prod), instance- and boot-bound, carrying a closed enum of named
  effects (`challenge.capture`, `challenge.redeem`,
  `fixture.identity.create`, `fixture.session.mint`,
  `verification.simulate`, `budget.rehearsal.allocate`,
  `clock.auth.advance`) with finite budgets, TTL, and an audit trail. No
  wildcard scope exists.
- **R2. Rehearsal window** [X] — a rehearsal grant can install a
  short-lived server-side policy window scoped to a fixture namespace or
  reserved contact domain (`*@example.invalid`): matching signups get
  capture delivery, simulated assurance, and a separate rehearsal budget
  — while the app's ordinary signup UI runs unmodified. Application code
  never carries or even sees an override capability; browser/native
  bundles stay clean by construction.
- **R3. Declarative auth fixtures** [=] — `auth.fixtures` names logical
  personas (identities, assurances, credentials, memberships, scenarios);
  `snapback auth fixtures preview/apply` reconciles idempotently and
  returns a receipt mapping *logical aliases* to freshly minted
  principals. Respects the reset-reissues-principals rule: aliases are
  deterministic, raw ids never are.
- **R4. Persona factory** [=] — mint N users or agents from a template
  with bounded session handles in one call (`snapback auth personas mint
  --template buyer --count 20`), feeding parallel acceptance workers.
  Handles like `buyer-0007`, never bearer plaintext in output.
- **R5. Auth clock laboratory** [=] — an auth-scoped injected clock on
  test instances: advance challenge expiry, rotation cadence, recovery
  windows, throttle cooldowns, guest-retention deadlines. A
  rehearsal-scoped host operation with an audit receipt; never OS time,
  never prod. (Composes with LLP 0059's durable clock floor — the
  advance is a floor input on rehearsal instances, not a second clock.)

### Abuse control, administration, observability

- **A1. Effect budgets instead of endpoint constants** [=] — model what
  each limit protects (guessing, enumeration, delivery cost, challenge
  allocation, hash CPU, session minting) as named budgets charged across
  the relevant axes (recipient, source, principal, provider, app,
  deployment), replacing LLP 0057's unconfigurable constants and
  composing with LLP 0060's hosted multi-bucket throttle rather than
  duplicating it. Limits become explainable and reusable across new
  mechanisms; refusals carry the budget name and retry-after.
- **A2. Server-derived trust tiers** [=] — budget policy accounts for
  *proven* posture: anonymous < verified-contact < established session <
  sender-bound session < scoped agent < rehearsal authority. Trust is
  never a request header; even the top tier gets a finite budget.
  CAPTCHA becomes an exceptional risk response, never the development
  path.
- **A3. Account lifecycle engine** [X] — linking, unlinking, identifier
  change, password change, passkey enrollment, recovery, guest collision,
  merge, quarantine, deletion, provider reconfiguration as explicit
  transactional state machines with declared proof requirements, session
  consequences, notifications, and audit facts. This *is* LLP 0151's
  commissioned-but-unowned lifecycle spec; this RFC's evaluation ranks it
  ahead of any new provider.
- **A4. Agent-shaped admin API** [=] — list/inspect/reconcile/suspend/
  revoke/delete/import as typed CLI/HTTP/MCP operations with preview, CAS
  bases, idempotency keys, and receipts — never dashboard buttons, never
  unrestricted table access. Destructive operations keep stronger
  ceremonies.
- **A5. Audited view-as** [=] — dev/test/demo mint short-lived,
  watermarked view-as sessions bound to a reason and grant (extending the
  existing `--as-user` + `ImpersonationCapability` machinery); prod
  continues refusing impersonation — support access in prod is a
  user-approved scoped grant, period.
- **A6. Auth explanation traces** [=] — public failures stay
  non-enumerating (`SNAPBACK_*` code + opaque correlation id); a gated
  `snapback auth explain <id>` reveals the exact failed gate, active
  provider/profile/readiness facts, consumed budget class, and the
  mechanically generated next command or guide anchor. LLP 0203 P2 made
  executable; the corpus already names auth refusals as the P2 offender.
- **A7. Security inbox** [X] — a machine-readable per-owner activity
  stream (new credentials, links, recovery events, elevated grants,
  suspicious attempts) where each entry links the exact revoke/contest
  operation. The observation channel that safe holds and reversals need.

### OAuth and headless sign-in

- **O1. One OIDC engine + hostile conformance IdP** [=] — ratifies LLP
  0151's architecture (generic OIDC adapter, presets as data, Apple as
  executable quirk profile, GitHub bespoke) and its synthetic adversarial
  IdP so social login proves hermetically, with no real provider account
  in any test loop.
- **O2. Declared return intents** [X] — apps declare semantic
  destinations (`signed-in-home`, `claim-complete`); codegen emits exact
  provider callbacks and maps one-use completion codes to intents. No
  hand-maintained redirect allowlists, no open-redirect class, and 0151's
  rule stands: no token ever crosses a redirect URL.
- **O3. Provider registration copilot** [X] — `snapback auth provider add
  google` inspects targets, generates exact callback values, automates
  registration where APIs exist (GitHub manifest flow), and emits a
  deterministic guided ceremony where they don't (Google, Apple). Secrets
  go straight to LLP 0036 state; output is redacted receipts. The honest
  version of "no OAuth console misery" — the ceremony that can't be
  automated gets mechanized instead.
- **O4. Headless device authorization** [=] — approval URI + short code
  with key-bound polling for CLI/TV/agent sign-in, reusing LLP 0150's
  ceremony shapes for *end-user* auth rather than inventing a second
  flow.

### Migration and compatibility

- **M1. Supabase/GoTrue import pipeline** [=] — import users, identity
  links, and supported password hashes (rehash on next login) with
  dry-run collision reporting and provenance-marked verified claims.
  Never import live authority: sessions, refresh tokens, challenges,
  provider tokens, MFA secrets.
- **M2. Narrow compatibility edge** [X, C skeptical] — at most: the
  import pipeline plus an optional short-lived audience-constrained JWT
  bridge for external systems that require JWKS. A GoTrue-shaped façade
  is evaluated below — and mostly rejected.

## Evaluation

### Buckets

| Bucket | Ideas | Judgment |
| --- | --- | --- |
| Foundational v1 | I1, I2, I4, I8, V1, A1, A6 | Define the model; prevent every later mechanism from inventing its own semantics |
| Agent-DX wedge (the differentiator) | R1–R5, V2, V5 | The signature capability no incumbent has; mostly composes with shipped machinery (capture mailbox, impersonation boundary) |
| Production mechanisms | I3, I6, V4, O1, O2, O3 | Guest, vendor-free password, email challenge, and social paths with honest prerequisites |
| Cheap wins — land early | V2, V3, V5, R4, R5, A6, V6 | Wrap existing primitives or add deterministic control surfaces |
| After the core stabilizes | I7, A2, A4, A7, O4, M1 | Depend on stable lifecycle/assurance/provider contracts |
| Owned elsewhere — integrate, don't absorb | I5 (LLP 0055/0150), O1–O3 details (LLP 0151), A3 (0151's commissioned lifecycle spec) | This RFC adds product priority, not a second authority |
| Safe only with hard restrictions | R2, R5, A5 | Become bad ideas if global, persistent, browser-carried, or production-reachable |
| Narrow edge only | M2 | Useful for migration; dangerous as a product center |

### Build-first (the seven moves, in order)

1. **Declared auth program + the four-layer catalog** (I1, I2) — one
   authority for mechanisms, generation, readiness, fixtures, docs.
2. **Rehearsal grants + captured inbox + fixtures + personas** (R1–R4,
   V2, V5) — the agent-DX wedge: one command yields real principals and
   sessions with no SMTP, no CAPTCHA, no clipboard secrets, no rate-limit
   fights. First consumer: the acceptance suites themselves.
3. **Assurance layer + deferred verification** (I4, V1) — with the
   verified provisioning hook (I8) closing the binding gap.
4. **Account lifecycle engine** (A3) — give 0151's commissioned lifecycle
   spec a number and an owner before adding any provider; provider count
   is worthless if accounts can't be repaired safely.
5. **Effect budgets + explanation traces** (A1, A6) — abuse control that
   explains itself, landed before password/delivery/OAuth expansion
   multiplies the surfaces that need it.
6. **Guest-first + zero-dependency password/recovery + delivery
   adapters** (I3, I6, V4) — immediate-use, vendor-free, and
   verified-contact paths; SMTP is never the prerequisite for a working
   product.
7. **OIDC engine + conformance IdP + return intents + registration
   copilot** (O1–O3) — per 0151's sequencing: Google first, GitHub next,
   Apple when a store-bound app demands it; passkeys after
   custom-domain and recovery foundations.

### Explicitly rejected

Recorded so they stay rejected for the stated reasons, not forgotten:

- **A universal god-mode token.** [=] A bearer meaning "ignore auth
  friction" is unauditable, unattenuable, and will be copied into app
  code eventually. It conflates effects with different hazards
  (verification simulation, delivery capture, session minting, budget
  allocation, impersonation). The rehearsal grant is its replacement.
- **A persistent `verificationRequired: false` dev override.** [X] Not
  requiring verification is legitimate *product policy* (expressible per
  function through I4); a testing bypass that survives deployment is not.
  Simulated verification must be *evidence with non-production
  provenance*, never a boolean that can ship.
- **"Rate limiting disabled."** [=] Rehearsal callers get a separate
  finite budget; public production endpoints keep ordinary defenses even
  when a leaked capability is presented. Nothing ever reports
  "unlimited."
- **Override capabilities in browser/native bundles.** [=] No query
  param, public header, localStorage entry, or generated constant carries
  rehearsal authority; the rehearsal window (R2) exists precisely so app
  code stays unaware. (0057 already refuses admin/impersonation carriers
  as substitutable credentials; this extends that posture.)
- **Deterministic raw principal ids for fixtures.** [X] Fights
  reset-reissues-principals semantics and invites seeded identity
  references. Deterministic *logical aliases*, freshly minted ids.
- **Automatic cross-provider email linking.** [X] A matching verified
  email does not prove two providers should fuse; linking requires
  recent-auth ceremony and explicit approval (0151's lifecycle stance).
- **A shared general OAuth broker.** [=] Branding leakage, shared
  suspension fate, correlation risk, Apple migration pain; 0151's Option
  D (app-owned registrations + copilot automation) already ruled here.
  Reaffirmed, not relitigated.
- **Passkeys as sole default on generated domains.** Ruled 2026-08-08 in
  0151; carried here as a rejection so this RFC can't be read as
  reopening it.
- **Full GoTrue/JWT compatibility.** [=] A broad façade drags Snapback
  into JWT claim configuration, refresh-token semantics, and endpoint
  quirks its model deliberately doesn't have, and it teaches the old
  idioms this design replaces. Import data; support a narrow JWT bridge
  where an external system demands JWKS; refuse the rest with typed
  migration guidance.
- **Importing live auth authority.** [=] Durable identity facts and
  supported credential verifiers only.
- **Permanent production impersonation.** [=] "Prod refuses
  impersonation" is a boundary, not an inconvenience. Support access in
  prod is a consented scoped grant.
- **CAPTCHA on any development or agent-authorized path.** [C] Trust
  tiers (A2) exist so the anonymous-abuse defense never taxes proven
  authority.

## Rehearsal grants: the safe shape of the special token

The author's prompt: *a special token from Snapback that turns off rate
limiting, email-verification requirements during signup, and other
annoyances.* Both brainstorms converged on the same verdict: the need is
real and the *bearer-that-disables* shape is the one shape it must not
take. The safe form:

> **A scoped, short-lived auth rehearsal grant, minted server-side under
> existing dev-authority carriers, bound to one instance and boot, with
> an opaque capability carrier that application code never receives —
> plus a rehearsal window so real UI flows run without any carrier at
> all.**

Neither a profile alone nor a token alone:

- The **profile** is the hard outer boundary: `dev` / `test` / `demo`,
  never `prod` — prod refuses mint *and* honor (fail closed at both
  ends).
- The **grant** records exact effects, selectors, budgets, expiry, and
  audit lineage.
- The **carrier** proves authority to install or exercise the grant —
  local one-boot cases ride the existing `ImpersonationCapability`
  sidecar discipline (LLP 0057: owner-only sibling file, stdin
  attachment, never argv/env); remote/CI cases bind the grant to an
  ephemeral caller key with LLP 0150-style request proofs.
- The **rehearsal window** (R2) lets ordinary signup UI exercise capture
  delivery and simulated assurance for a matching fixture namespace with
  no capability in any client bundle.

A conceptual grant record (illustrative, not the Spec's schema):

```json
{
  "kind": "authRehearsalGrant.v1",
  "instanceId": "…", "startupNonce": "…", "appId": "…",
  "activationDigest": "…", "profile": "test",
  "scopes": ["challenge.capture", "challenge.redeem",
             "fixture.identity.create", "fixture.session.mint",
             "verification.simulate", "budget.rehearsal.allocate"],
  "selectors": { "fixtureNamespaces": ["acceptance"],
                 "emailDomains": ["example.invalid"] },
  "budgets": { "identityCreates": 50, "challengeAttempts": 500,
               "sessionMints": 100 },
  "expiresAt": "…", "maxUses": 1000
}
```

The closed scope enum, no-wildcard rule, and per-effect budgets are the
design: waivers are *named effects with finite budgets*, and "turn off
rate limiting" is expressible only as `budget.rehearsal.allocate` — a
separate, finite, audited budget, never the absence of one.

**Minting** requires, conjunctively: a non-prod profile, active sessions
mode, `AdminWrite`, the independent process-bound
`ImpersonationCapability`, and exact scopes/selectors/budgets/TTL.
`snapback test` may auto-mint only when it launched the server and owns
the mechanically derived readiness files. The mediated experience is the
product: `snapback auth fixtures apply`, `snapback auth personas mint`,
`snapback auth rehearse status --json` — machine output carries grant
id, expiry, remaining budgets, and persona handles, never carrier bytes
or session bearers.

**Prod-bleed is prevented structurally, not procedurally:**

1. `prod` never mints or validates rehearsal capabilities (refusal by
   token-class prefix before any validation work).
2. Production startup *rejects* rehearsal configuration rather than
   ignoring it.
3. Rehearsal-minted identities, sessions, and assurances carry protected
   provenance (`rehearsal_simulated`); production deploy/import refuses
   protected auth state carrying rehearsal taint — the "dev database
   copied to prod" channel fails closed.
4. Restart, reset, or activation-digest change invalidates outstanding
   grants and windows (boot-nonce binding).
5. Rehearsal sessions cannot refresh after their grant ends.
6. Release qualification asserts `rehearsalActive: false`, zero live
   grants, zero rehearsal-tainted identity state.
7. The capability manifest reports rehearsal support as
   absent/available/active so the posture is a readable fact (LLP 0203
   P4).

**Leak channels and their controls** (condensed; the Spec owns the full
matrix): never in argv or env (stdin/sidecar only, per 0057 discipline);
redacted `Debug` and no route-level body capture (never in logs, traces,
or model transcripts); no browser-consumable endpoint and no CORS-visible
header (the window replaces client carriage); receipts redacted in CI
artifacts; instance+boot+activation binding kills stale-sidecar and
cross-worktree reuse; finite budgets, TTL, revocation, and concurrency
ceilings bound a runaway agent loop; closed enum refuses scope
substitution; every mint/install/effect/expiry/revoke audited with actor,
grant, namespace, and effect class.

**What rehearsal authority must never do** [=]: bypass application
authorization, membership rules, or row scoping; turn a client-supplied
user id into a principal; accept a wrong password or forged proof;
modify provider configuration; disable global resource bounds; expose
provider API tokens; auto-link or merge accounts; convert simulated
assurance into production verification; reach a target whose capability
manifest does not admit rehearsal. The design bypasses **ceremony and
external delivery**, never cryptographic or authorization boundaries.

**Proposed diagnostics** (illustrative, per the 0057 table discipline):
`SNAPBACK_AUTH_REHEARSAL_PROFILE_FORBIDDEN`,
`SNAPBACK_AUTH_REHEARSAL_SCOPE_DENIED`,
`SNAPBACK_AUTH_REHEARSAL_BINDING_MISMATCH`,
`SNAPBACK_AUTH_REHEARSAL_EXPIRED`,
`SNAPBACK_AUTH_REHEARSAL_BUDGET_EXHAUSTED`,
`SNAPBACK_AUTH_REHEARSAL_STATE_PRESENT` (the prod-import taint refusal).
Public identity endpoints keep their non-enumerating shapes; exact
rehearsal diagnostics live on the gated operator plane.

**Why this still kills the friction.** A test runner can: launch a
sessions-mode instance; auto-mint a grant through the trusted ready-file
path; apply named persona fixtures; allocate a separate challenge
budget; capture or directly redeem email challenges; simulate
verified/unverified/bounced states; advance auth time; receive session
handles; run the *same app code that runs in production*; and tear down,
invalidating everything. Verification loops, SMTP setup, CAPTCHA,
rate-limit fights, and bearer-copying all disappear — and no production
bypass switch exists anywhere in the system.

## Naming

- **Subsystem: "Snapback Identity"** [X, C concurs] — broad enough for
  humans, agents, guests, credentials, lifecycle; doesn't imply
  authentication owns authorization. CLI/API family stays `snapback
  auth`. Authoring object: `defineAuth(...)`. Rejected: "Accounts"
  (human-centric), "Sign-In" (too narrow), "Access" (collides with
  authorization), "Passport"/"Gatehouse" (cute but imprecise).
- **Override concept: "auth rehearsal grant"** [=] — both families
  independently reached "rehearsal": it says the system runs the real
  shape under simulated evidence and bounded authority, not that security
  is off. Active state: **rehearsal window**. Carrier: **rehearsal
  capability**, provisional prefix `sbrc_` subject to the credential
  prefix registry. Rejected names: god mode, master/bypass/
  verification-off token, training wheels, unlimited test token — each
  teaches the wrong mental model.

## Landing shape and commissioned work

This RFC creates no second authority. Deltas land by owner:

1. **A rehearsal-grants Spec** (new number at implementation time) —
   the grant/window/carrier contract, the full leak-channel matrix, the
   budget vocabulary, and the acceptance matrix (mint negatives, prod
   refusals, taint-import refusal, boot-nonce invalidation, budget
   exhaustion, scope substitution, carrier custody). Commissioned here.
2. **The account lifecycle Spec 0151 commissioned** — this RFC ranks it
   build-order #4 and asks the author to assign it a number and owner.
3. **LLP 0151 amendments** — assurance layer (I4) as the verification
   vocabulary its authenticators consume; return intents (O2) and the
   registration copilot (O3) as completion-protocol/DX extensions;
   guest-first template posture (I3).
4. **LLP 0057 amendments** — capture-mailbox promotion (V2), challenge
   redemption under rehearsal authority (V5), budget vocabulary replacing
   the throttle constants (A1) with 0060 composition.
5. **LLP 0024/host-ops** — persona and fixture operations; `auth explain`.
6. **LLP 0036** — secret-reference consumption from `defineAuth`.
7. **LLP 0045** — delivery adapter contract (V4) and simulator (V3).
8. **LLP 0203** — auth becomes the named first exhibit for P2 (explain
   traces) and P7 (versioned `--json` on the `auth` CLI family).

## Non-goals

- No second token or session model — sessions, bearers, rotation, and
  fencing stay with 0057/0059/0077; grants and scopes stay with 0055.
- No relitigation of 0151's ruled questions (Option D credential
  ownership, SMS tier 2, generated-domain passkeys preview-only).
- No hosted-target expansion — every new route inherits the existing
  hosted refusals until LLP 0060's conjunctive readiness admits it.
- No federated consent, no Expo-account dependency: the host stays
  sovereign (0150 invariant 5); anything Expo-side is an optional overlay
  in the 0106 lineage.

## Open questions

- **OQ1 — Sequencing of the wedge vs. the floor.** Does the
  rehearsal-grants Spec ship before any new authenticator (the
  brainstorms' recommendation: the wedge pays for itself in every
  subsequent acceptance suite), or alongside the password floor so the
  first marketing story is complete? Author call.
- **OQ2 — Guest-first as template default.** Is guest-first the paved
  posture for agent-built app templates (this RFC's proposal), or opt-in
  per app? Interacts with the 0011 reaping-policy requirement.
- **OQ3 — How handlers consume verified claims.** The binding gap can
  close via the provisioning hook alone (I8), via handler-readable
  verified claims on `ctx.auth`, or both. The hook is safer (no claim
  surface to misuse); claims are more general. Which lands first?
- **OQ4 — Budget vocabulary ownership.** Do effect budgets (A1) replace
  0057's constants in a 0057 amendment, or land as a new spec that 0057
  and 0060 both reference? The former is smaller; the latter keeps
  hosted/local symmetry in one place.
- **OQ5 — Naming ratification.** "Snapback Identity" and "auth rehearsal
  grant" per §Naming; `sbrc_` prefix pending the registry check.
- **OQ6 — The compatibility edge.** Import-only (this RFC's lean), or
  import + the narrow JWT/JWKS bridge? A bridge helps external systems
  (analytics, third-party APIs expecting JWKS) but is the top candidate
  for scope creep toward the rejected full façade.
