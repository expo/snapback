# LLP 0212: Agent-native identity and rehearsal grants

**Type:** RFC
**Status:** Accepted
**Systems:** Auth, Identity, Developer experience, Agent tooling, Testing,
Security, CLI, Email delivery
**Author:** Charlie Cheever / Claude (Fable 5), with a commissioned
independent brainstorm from Codex (gpt-5.6-sol, xhigh) on 2026-08-09 —
idea provenance is tagged throughout ([C] Claude, [X] Codex, [=] both
families converged independently)
**Date:** 2026-08-09
**Revised:** 2026-08-12 (ACCEPTED by the author (Charlie Cheever) on the
scoped delta-rule convergence of the super-refine loop — rounds 2/3/4
each found zero pre-existing MATERIAL across both families, and the
v0.5 delta closed Codex's final in-delta finding; not dual-READY on one
revision, accepted knowingly on that basis. The commissioned wave-1a
Specs (LLP 0213/0214/0215) are Implemented and landed on main;
acceptance ratifies the design as built.) 2026-08-09 (v0.5, round-4
dispositions — the v0.5 delta itself is UNREVIEWED; final loop verdicts
bind to v0.4. See §Revision history). 2026-08-09 (v0.4, round-3 delta dispositions). 2026-08-09
(v0.3, round-2 delta dispositions). 2026-08-09 (v0.2, round-1
dispositions). 2026-08-09 (author sitting: all six open questions
ruled; see §Author decisions.)
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
impersonation flags), LLP 0053 (authorization invalidation — the
level-triggered termination pattern), LLP 0059 (durable clock floor and
projection), LLP 0077 (sender-constrained browser auth)

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
— with sessions, rotation, family alarm, and the reserved `_auth`
namespace (five `_auth_*` tables in catalog v1; the reservation is a
namespace rule, not a fixed set) that app code physically cannot
address. No password, no magic links, no OAuth, no passkeys, no
anonymous principals, no SMS (LLP 0151 §Summary states this flatly).
There is **no production email path at all**: codes land in a
dev/test/demo capture mailbox and `prod` refuses `/auth/request-code`
outright (LLP 0057 §Request-code transaction) — so "email-code login,
React web" has no self-serve production story yet
(guide/auth/sessions-and-principals.md).
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
4. **Assurance** — server-derived evidence: `authenticated`,
   `email_verified`, `recent_auth`, `phishing_resistant`. Functions and
   lifecycle transitions require assurances; a session is a projection
   of this state, not the identity itself.

**The assurance record separates kind from provenance** — they are
different fields, never conflated: an assurance is
`{kind, provenance, issuedAt, expiresAt?, governingAuthority?}` — for
rehearsal provenance, `governingAuthority` names the exact minting
authority, *window included* when one mediated the mint, so a
shorter-lived window's expiry or revocation makes every assurance
derived through it inadmissible at use time even while the parent
grant lives — where
`kind` is what was assured (`email_verified`, …) and `provenance` is how
(`delivery`, `import`, `rehearsal`, …). Rehearsal never invents a kind:
`verification.simulate` mints `kind: email_verified` with
`provenance: rehearsal` and the governing authority recorded — the
window when one mediated the mint. **Requirement
evaluation is posture-scoped**: `requires: ['email_verified']` is
satisfied by rehearsal-provenance assurances only on non-production
deployment profiles; production admission policy never accepts
rehearsal provenance, so an implementation cannot accidentally accept
simulated evidence where real contact verification was intended.
Admissibility of the *other* provenances is posture-independent and
owned by the identity-core Spec — `import` in particular is admissible
in production (that is the point of M1's pipeline), with its rules
pinned in the import contract, not implied. The read-only `ctx.auth`
projection (OQ3) preserves the provenance field, though app logic is
taught to declare requirements, not branch on provenance.

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
  assurance. Signup stops being a gate and becomes an upgrade. The
  design authority is layered — stated precisely: the **0011 dated
  amendment** designed continuous `userId` on claiming and the typed
  collision refusal, and records merge as *out of scope* (an app-level
  migration hook as the escape hatch); the `switch_existing`/`merge`
  continuations, reaping/retention limits, and the cleanup-policy
  requirement are **LLP 0151's proposals on top of that amendment**,
  expressly delegated to the commissioned lifecycle spec. This RFC
  proposes making guest-first the paved *template default* for
  agent-built apps, not a platform-wide default.
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
  prose (the LLP 0106 credential-custody stance). Listing is a larger
  disclosure surface than today's exact-challenge-id lookup, so the
  owning 0057 amendment pins its bulk-disclosure contract: pagination
  and count caps, address redaction posture, the exact
  `AdminWrite`/`ImpersonationCapability` composition, and
  planted-sentinel acceptance proving bulk results never reach logs,
  receipts, browser endpoints, or default machine output.
- **V3. Delivery simulator** [X] — deterministic per-fixture delivery
  profiles: `delivered`, `delayed`, `bounced`, `provider_unavailable`,
  `expired_before_open`, `duplicate_callback`, with structured receipts.
  Failure-path testing without a vendor; strictly more valuable than a
  mailbox that only models perfect delivery. Ordering note: the
  simulator can precede real adapters by targeting the challenge seam
  directly; its receipt vocabulary is shared with — but not blocked on —
  V4's adapter contract.
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
  in §Rehearsal grants. A server-side grant, bound to a non-production
  deployment profile (dev/test/demo, never prod — "deployment profile"
  throughout, distinct from LLP 0096's client auth profiles), instance-
  and boot-bound, carrying a closed enum of named effects
  (`challenge.capture`, `challenge.redeem`, `fixture.identity.create`,
  `fixture.session.mint`, `verification.simulate`, `window.install`,
  `budget.rehearsal.allocate`, `clock.auth.advance`) with finite
  budgets, TTL, and an audit trail. No wildcard scope exists, and every
  effect has a named counter (§Rehearsal grants pins the
  effect-to-counter mapping).
- **R2. Rehearsal window** [X] — under the `window.install` effect, a
  grant can install a short-lived server-side policy window: matching
  signups get capture delivery, simulated assurance, and a separate
  rehearsal budget — while the app's ordinary signup UI runs
  unmodified. Application code never carries or even sees an override
  capability; browser/native bundles stay clean by construction.
  **A window's selector is minted, never chosen**: the unguessable
  namespace (e.g. `*@<128-bit-random>.rehearsal.invalid`) is
  generated by the host at *grant mint*, precommitted as the
  `window.install` selector, and consumed by installation —
  predictable domains like `*@example.invalid` are illustrative
  vocabulary only and are never valid selectors. "One-use" means the
  namespace binds to exactly one window installation and dies with it,
  never reused across windows; *within* the live window, matching
  addresses are unlimited up to the window's budgets. **Selector
  entropy is the authoritative foreign-caller boundary** — a caller
  who can reach the deployment cannot obtain the waiver without the
  precommitted namespace, the same discipline this corpus already
  applies to capability URLs. The reachability check is defense in
  depth *on top of* that boundary, its input class stated honestly
  per LLP 0060 (a loopback bind proves nothing about a fronting
  proxy; an operator description is never a security fact): where the
  target class publishes a **target-authored reachability fact**, a
  published-public fact refuses installation — deliberately exposed
  `demo`-class targets publish it, giving the refusal its positive
  case; their operators drive flows through R3/R4 fixtures instead —
  and where no such fact exists (the wave-1 local target),
  installation **proceeds on selector entropy alone with the residual
  named**, never laundered into a reachability claim.
  Fail-closed-on-unknown is deliberately rejected here: it would
  refuse the only wave-1 topology while adding nothing entropy does
  not already provide. The acceptance matrix includes foreign-caller
  selector guessing, loopback-behind-proxy (installation proceeds;
  the guessing rows hold), declared-public refusal, and
  transcript-equivalence rows — plus a **producer-parity gate**: the
  reachability fact has a closed schema, every rehearsal-capable
  target class that is public by design must publish it, and the
  wave-1 local target is the *named* absence exception, so an
  accidental omission cannot silently select the unknown/proceed
  branch.
- **R3. Declarative auth fixtures** [=] — `auth.fixtures` names logical
  personas (identities, assurances, credentials, memberships, scenarios);
  `snapback auth fixtures preview/apply` reconciles idempotently and
  returns a receipt mapping *logical aliases* to freshly minted
  principals. Respects the reset-reissues-principals rule: aliases are
  deterministic, raw ids never are. **Declared memberships are not a
  rehearsal effect**: no membership scope exists in the enum, and
  rehearsal never bypasses membership rules — the fixture applier
  reaches a declared membership by running the app's ordinary,
  app-authorized membership transitions under the persona's own real
  authority (or the fixture fails typed if no such transition exists).
- **R4. Persona factory** [=] — mint N users or agents from a template
  with bounded session handles in one call (`snapback auth personas mint
  --template buyer --count 20`), feeding parallel acceptance workers.
  Handles like `buyer-0007`, never bearer plaintext in output.
- **R5. Auth clock laboratory** [=] — an auth-scoped injected clock on
  test instances: advance challenge expiry, rotation cadence, recovery
  windows, throttle cooldowns, guest-retention deadlines. A
  rehearsal-scoped host operation with an audit receipt; never OS time,
  never prod. **Confined to disposable stores**: because LLP 0059's
  durable clock floor is non-decreasing, an advanced floor cannot be
  lowered by teardown — so `clock.auth.advance` is admissible only on a
  store marked disposable at creation — a creation-time marking,
  deliberately distinct from rule 3's admission taint, though both
  independently make the store permanently ineligible for production
  promotion (and any clock advance is itself a rehearsal effect, so
  rule 3's taint also fires on first use);
  it is never an input to an ordinary store's floor, and a wedged
  far-future ordinary database cannot occur by construction.

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
  is evaluated below — and mostly rejected. (OQ6 ruling: both the
  import pipeline and the narrow bridge are commissioned; the façade
  stays rejected.)

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

### Build order: two waves and a provider tranche, over a dependency spine

Per the OQ1 ruling, the wedge and the floor ship as **one combined first
wave**. The order below is a dependency spine, not a linear wish list —
each item names what it consumes, and the interims are stated rather
than implied.

**Wave 1 — the spine, then the wedge and floor on it:**

- **1a. Contracts first** (authored in wave 1, before the code that
  consumes them): the identity-core Spec (I1 `defineAuth` + I2 catalog
  v3 + the assurance record of §Design frame + I8's hook contract), the
  effect-budgets Spec (vocabulary and charge semantics — the 0057
  constant *migration* follows later and is not a wave-1 gate), and the
  rehearsal-grants Spec. The rehearsal Spec consumes the assurance
  record (for `verification.simulate`) and the budgets vocabulary (for
  its rehearsal budgets) — which is exactly why both contracts are
  wave-1a, resolving what would otherwise be forward references to
  later moves.
- **1b. The wedge** (R1–R5, V2, V5): rehearsal grants, windows,
  captured-inbox promotion, fixtures, personas, and the clock
  laboratory (R5 — disposable-store-only, per its confinement rule).
  V6's no-delivery readiness posture rides the identity-core Spec's
  readiness facts here and completes in 2a. One command yields real
  principals and sessions with no SMTP, no CAPTCHA, no clipboard
  secrets, no rate-limit fights. First consumer: the acceptance suites
  themselves. Carrier interim, stated plainly: **wave-1 rehearsal
  carriage is local-only** (ready-file sidecar / stdin, per 0057's
  discipline); remote/CI key-bound carriage waits for LLP 0150's
  commissioned extractable-key profile and is not claimed before it
  exists.
- **1c. The floor** (I3, I6, minimal V1): guest principals with
  claiming, the zero-dependency password + recovery-codes
  authenticator, and deferred verification for the email-code path.
  The floor's guessing defenses charge budgets from the 1a vocabulary.
  Lifecycle interim, stated plainly: wave 1 ships only the floor's own
  transitions, **enumerated completely** — guest principal and
  session creation; guest claim; password account creation and
  password authentication; password set/change; initial recovery-code
  issuance, consumption, and replacement/rotation after use or
  suspected disclosure (with one-time plaintext custody and redaction
  rules); and each transition's session consequences and
  last-authenticator enforcement — each specified in the
  identity-core Spec with LLP 0151 as the requirements authority; the
  *general* lifecycle engine (A3) is wave 2 and the floor does not
  wait for it.

**Wave 1 release boundary:** the rehearsal surface may not be declared
ready (LLP 0189 claim discipline) until the assurance record and budget
vocabulary it consumes are landed contracts — a wedge shipped against
provisional vocabulary would re-specify itself in wave 2.

**Wave 2 and later, on the stabilized spine:**

- **2a. Assurance generalization + provisioning hook + `ctx.auth`
  claims** (I4 complete, I8, V1 general, V6 enforcement): the full
  requirement-declaration surface beyond the floor's minimum, with
  V6's deploy-time no-delivery check becoming enforceable here.
- **2b. Account lifecycle engine** (A3) — the 0151-commissioned spec,
  numbered and owned in wave 1a's batch, implemented here, before any
  new provider: provider count is worthless if accounts can't be
  repaired safely.
- **2c. Explanation traces + budget migration** (A6; A1's 0057
  constant migration): abuse control that explains itself, completed
  before provider expansion multiplies the surfaces that need it.
- **2d. Delivery adapters + simulator** (V4, V3) — the prod email path.
- **Wave 3. OIDC engine + conformance IdP + return intents +
  registration copilot** (O1–O3) — per 0151's sequencing: Google
  first, GitHub next, Apple when a store-bound app demands it;
  passkeys after custom-domain and recovery foundations.

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

Neither a deployment profile alone nor a token alone:

- The **deployment profile** is the hard outer boundary: `dev` / `test`
  / `demo`, never `prod` — prod refuses mint *and* honor (fail closed
  at both ends). ("Deployment profile" throughout — deliberately not
  LLP 0096's client "auth profiles.")
- The **grant** records exact effects, selectors, budgets, expiry, and
  audit lineage. **Selectors bind every effect, not only windows**,
  and the mapping is total the same way the counter mapping is: the
  rehearsal Spec defines **mandatory selector fields per effect** —
  contact/namespace selectors for capture, redeem, identity creation,
  and session minting; identity selectors for
  `verification.simulate`; for `window.install`, a **namespace
  precommitted at grant mint** — the host mints the unguessable
  namespace when the *grant* is minted, records it as the effect's
  selector, and installation *consumes* the precommitted value —
  **one precommitted namespace per budgeted install** (`windowInstalls: N`
  precommits N namespaces; counter and selector set share one
  cardinality by construction) — so selectors stay mint-time-fixed
  with no output-as-input circularity (acceptance: namespace
  collision, reuse, post-mint mutation, concurrent installs); budget name and charge axes for
  `budget.rehearsal.allocate`; the disposable store/clock domain for
  `clock.auth.advance` — and an effect whose required selector is
  absent or incompatible is refused. This is the difference between a scoped grant and a
  profile-wide grant with a scoped window.
- The **carrier** proves authority to install or exercise the grant —
  local one-boot cases ride the existing `ImpersonationCapability`
  sidecar discipline (LLP 0057: owner-only sibling file, stdin
  attachment, never argv/env); remote/CI cases bind the grant to an
  ephemeral caller key with LLP 0150-style request proofs (wave-1
  carriage is local-only until that commissioned 0150 profile exists —
  §Build order).
- The **rehearsal window** (R2) lets ordinary signup UI exercise capture
  delivery and simulated assurance for a minted, unguessable selector
  namespace with no capability in any client bundle.

**Plane classification, stated plainly (a deliberate boundary, not an
0055 extension):** a rehearsal grant is a **new operator/test-plane
capability owned by the rehearsal-grants Spec** — minted under
`AdminWrite` + `ImpersonationCapability`, carrying host/provider
effects. It is *not* an LLP 0055 grant: 0055's grants are
application-plane function authority for service principals, and 0055
is explicit that scoped tokens never satisfy `Admin*`,
`ImpersonationCapability`, or host-operation policy. The
non-substitution is bidirectional — an 0055 token or grant never
exercises a rehearsal effect, and a rehearsal capability never invokes
application functions or satisfies any 0055 scope. The shared word
"grant" is vocabulary, not substitutability.

A conceptual grant record (illustrative, not the Spec's schema):

```json
{
  "kind": "authRehearsalGrant.v1",
  "instanceId": "…", "startupNonce": "…", "appId": "…",
  "activationDigest": "…", "deploymentProfile": "test",
  "scopes": ["challenge.capture", "challenge.redeem",
             "fixture.identity.create", "fixture.session.mint"],
  "selectors": { "fixtureNamespaces": ["acceptance"],
                 "emailDomains": ["<minted>.rehearsal.invalid"] },
  "budgets": { "identityCreates": 50, "challengeAttempts": 500,
               "sessionMints": 100 },
  "expiresAt": "…", "maxUses": 1000
}
```

(The example deliberately holds only the four contact/namespace-selector
effects, so its scopes, selectors, and counters are mutually compatible
under the totality rules; a grant holding the other effects carries
their per-effect selector fields and counters per the
effect-to-selector and effect-to-counter mappings in this section.)

The closed scope enum, no-wildcard rule, and per-effect budgets are the
design: waivers are *named effects with finite budgets*, and "turn off
rate limiting" is expressible only as `budget.rehearsal.allocate` — a
separate, finite, audited budget, never the absence of one. The budget
model is **closed and conservative**, four rules:

1. **Every effect in the enum has a named counter** (the
   effect-to-counter mapping above is total: capture/redeem charge
   `challengeAttempts`, identity creates and session mints their own
   counters, `verification.simulate` charges
   `verificationSimulations`, `window.install` charges
   `windowInstalls`, `clock.auth.advance` charges `clockAdvances`,
   allocation draws `allocationCeiling`), charged **atomically at the
   effect's linearization point**, with idempotent retry semantics
   that neither double-charge nor yield a free effect — and
   idempotency identity binds to the complete normalized request, so
   one key cannot be replayed across different guesses.
   **Denials charge too**: the budgets Spec distinguishes *attempt*
   counters (charged on refusal and failure — wrong codes, wrong
   passwords, malformed credentials, enumeration probes — preserving
   0057's wrong-code charge and LLP 0060's atomic charge-on-denial)
   from *successful-effect* quota counters; a failed guess is never
   free.
2. **Allocation draws down an immutable ceiling fixed at mint** —
   `allocationCeiling` is conserved: the sum of all budgets ever
   allocated under a grant never exceeds it.
3. **Allocation is non-recursive and non-renewable**: no effect
   reachable under a grant can raise that grant's own ceiling,
   replenish its exhausted budgets, or mint a further grant — so a
   runaway loop exhausts and stops, structurally.
4. `maxUses` bounds total effect invocations independently of
   quantities allocated per call.

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
3. **Rehearsal admission taints the store, not just the rows.**
   Rehearsal-minted identities, sessions, and assurances carry
   protected provenance (`provenance: rehearsal`), *and* the first
   honored rehearsal effect durably marks the whole store — **in the
   same transaction as that effect**, so no crash cut can leave an
   effect without its marker. The marker survives reset, physical
   backup/restore, cloning, and logical export: every Snapback export
   artifact carries a provenance envelope **integrity-bound to the
   exact payload, store identity, and marker state under a host-held
   key** (the 0057 keyring lineage is the mechanism family; the Spec
   pins the primitive and the cross-host verification-key custody),
   and production deploy/import **fails closed on a missing,
   malformed, or unverifiable envelope** exactly as on a tainted one
   — a syntactically clean envelope spliced onto a tainted payload
   fails verification, so the paved-path claim is structural, not
   syntactic. **The envelope authenticates marker state at export
   time, and that is the policy, stated precisely**: ineligibility
   binds to the store's states at and after first rehearsal
   admission, and to every export taken from them. A verifiably
   *pre-taint* export remains promotable **by design**, and that is
   safe by construction, not by policy generosity: the taint marker
   commits in the same transaction as the first rehearsal effect and
   exports are snapshot-consistent (0057's quiescence lineage), so
   any export whose envelope verifies clean provably contains zero
   rehearsal-derived state. Replaying an old clean envelope after
   the live store is tainted therefore imports only pre-rehearsal
   bytes — legitimate, and the acceptance matrix pins it as such:
   the exact clean-export → taint-original → import-old-export
   sequence is a *positive* row (admitted, with the rationale
   recorded), while any export taken at-or-after admission refuses.
   No monotonic external lineage authority is needed because nothing
   post-taint can produce a clean-verifying envelope. A marked store is **permanently
   ineligible for production promotion** — whole-store, fail-closed.
   This deliberately covers what row-level taint cannot: ordinary app
   rows written by handlers running under simulated assurance,
   provisioning-hook output, and fixture-created memberships are all
   inside the ineligible store, so an app-data-only export from a
   rehearsal store cannot launder derived state into prod **through
   any Snapback-mediated promotion or import path** (hand-copied
   bytes are outside any design's reach; the paved paths are the
   claim). Real external egress under rehearsal authority is refused
   unless a declared simulator/test adapter owns the channel — the
   enforcement mechanism is commissioned in landing item 1a, because
   store taint cannot undo an email or a webhook.
4. Restart, reset, or activation-digest change invalidates outstanding
   grants and windows (boot-nonce binding).
5. **Termination terminates derived authority, not just the grant.**
   A rehearsal-derived session's expiry is clamped to its governing
   grant/window; when the grant ends (expiry or revocation), derived
   sessions and windows are refused at the invocation gate immediately
   (level-triggered, the LLP 0053 obligation pattern — not
   next-refresh), and simulated assurances are validated at **use
   time** against their governing authority — the window when one
   mediated the mint, else the grant — so a window's expiry or
   revocation kills its derived assurances and sessions even while
   the parent grant lives, and no simulated evidence outlives the
   authority that minted it. Derived identities are swept
   on grant end or left inert (no live session can be minted against
   them without a new grant).
6. Release qualification asserts `rehearsalActive: false`, zero live
   grants, and — via rule 3's store marker — that the candidate store
   never admitted rehearsal (which subsumes row-level assertions and
   covers derived app state).
7. The capability manifest reports rehearsal support as
   absent/available/active so the posture is a readable fact (LLP 0203
   P4).

**Leak channels and their controls** (condensed; the Spec owns the full
matrix): never in argv or env (stdin/sidecar only, per 0057 discipline);
redacted `Debug` and no route-level body capture (never in logs, traces,
or model transcripts); no browser-consumable endpoint and no CORS-visible
header (the window replaces client carriage); receipts redacted in CI
artifacts; instance+boot+activation binding kills stale-sidecar and
cross-worktree reuse; finite budgets under an immutable allocation
ceiling (budget-model rules 1–4), TTL, revocation, and concurrency
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
   the grant/window/carrier contract (an operator/test-plane
   capability, non-substitutable with 0055 grants in both directions),
   the full leak-channel matrix, the closed effect-to-counter *and*
   effect-to-selector models, the window selector-namespace mint, the
   store-taint marker (same-transaction commit; survival across
   reset/backup/restore/clone/export; the export provenance envelope
   with fail-closed import), and the acceptance matrix (mint
   negatives, prod refusals, store-taint promotion refusal including
   crash cuts around the first effect,
   reset/backup/restore/export/import negatives, envelope-edit,
   clean-envelope/tainted-payload splice, payload-substitution, and
   replay negatives; the disposable-at-creation marker sharing the
   same envelope and survival mechanics, with a promotion negative
   for a disposable store *before* any rehearsal effect; boot-nonce
   invalidation, derived-authority termination at the gate including
   window expiry/revocation with the parent grant live, budget/ceiling
   exhaustion and charge-on-denial, foreign-caller selector guessing,
   loopback-behind-proxy, transcript equivalence, scope substitution,
   carrier custody; plus, incorporated by reference as part of this
   matrix, the R2 reachability rows, the producer-parity gate, and
   the selector-mapping namespace rows named where those mechanisms
   are specified — this list plus the referenced rows is the
   authoritative superset). Commissioned here.
1a. **Rehearsal provenance propagation and the egress gate** — a named
   amendment into the LLP 0058 invocation-authority lineage.
   Provenance derives from the **effective authority and assurance
   decision** — not merely the live session — and travels two paths:
   synchronously through nested calls, actions, provisioning hooks,
   and delivery adapters; and **durably onto every deferred intent a
   rehearsal-provenance invocation enqueues** — LLP 0045 outbox rows,
   queued/replayed work, and cron-rehydrated jobs carry the marker
   through claim, retry, process restart, and delivery, so a clean
   `System` runner delivering a rehearsal-enqueued intent still
   arrives at the gate marked. One egress gate refuses real external
   egress under rehearsal provenance unless a declared simulator/test
   adapter owns the channel. Scope stated honestly: egress initiated
   or durably enqueued by a rehearsal-provenance invocation, not
   arbitrary downstream causality. Acceptance: direct actions, nested
   calls, hooks, adapters, outbox/cron delivery, queued replay,
   restart, and retry all refused without a declared simulator;
   declared simulators remain usable. Without this item, rule 3's
   egress sentence would be a wish; with it, the enforcement point is
   owned.
2. **An identity-core Spec** (new number at implementation time) —
   owns I1 (`defineAuth`), I2 (catalog v3 and the four-layer storage
   split), the assurance record and its posture-scoped admissibility
   rule, I8's verified provisioning hook (its sealed invocation
   authority, allowed write set, and permission-backing provenance —
   "generated transactional hook" is a mechanism only once this
   contract pins it), the read-only `ctx.auth` claims projection
   (OQ3), **the complete floor transition set enumerated in wave 1c**
   (that enumeration is the single source; this item commissions it
   rather than restating it), V6's no-delivery readiness derivation
   (readiness facts present from wave 1b; the deploy-time check
   becomes enforceable in 2a), and the posture-independent
   admissibility rules for non-rehearsal provenances (`import`
   included — the posture-scoped rule in §Design frame governs
   rehearsal provenance only). Catalog v3 gets an owner the way v1
   (0057) and v2 (0055) have owners.
3. **The account lifecycle Spec 0151 commissioned** — this RFC ranks it
   wave 2b and asks the author to assign it a number and owner in the
   wave-1a batch.
4. **LLP 0151 amendments** — assurance layer (I4) as the verification
   vocabulary its authenticators consume; return intents (O2) and the
   registration copilot (O3) as completion-protocol/DX extensions;
   guest-first template posture (I3); and the commissioning of its
   password + guest **implementing** work (I6, I3 implementation) into
   the identity-core Spec's floor transitions — 0151 remains the
   authenticator authority; the implementation commission is recorded
   here so the floor work is owned, not implied.
5. **An effect-budgets Spec** (new number; OQ4 ruling) — one document
   owns budget names, charge axes, and refusal semantics for local and
   hosted alike; LLP 0057 (whose throttle constants it replaces via
   amendment), LLP 0060's multi-bucket throttle, and the
   rehearsal-grants Spec's rehearsal budgets all reference it.
6. **LLP 0057 amendments** — capture-mailbox promotion with its
   bulk-disclosure contract (V2), challenge redemption under rehearsal
   authority (V5), and the constant→budget migration referencing the
   budgets Spec (A1).
7. **LLP 0024/host-ops** — persona and fixture operations; `auth explain`.
8. **LLP 0036** — secret-reference consumption from `defineAuth`.
9. **LLP 0045** — delivery adapter contract (V4) and simulator (V3).
10. **LLP 0203** — auth becomes the named first exhibit for P2 (explain
    traces) and P7 (versioned `--json` on the `auth` CLI family).
11. **Migration surface** (OQ6 ruling) — the Supabase/GoTrue import
    pipeline (M1) and the narrow JWT/JWKS bridge, recorded as a
    **named exception to the no-second-token non-goal** with its
    security contract pinned: bridge tokens are never accepted by any
    Snapback surface (issue-only; Snapback never consumes them); exact
    issuer/subject/audience rules; authority never wider and expiry
    never later than the live source session/principal, with a hard
    platform maximum TTL; no refresh and no delegation;
    key-compromise rotation behavior specified; and the
    bounded-revocation-lag residual for offline verifiers named
    honestly (an external verifier cannot see revocation until token
    expiry — the hard TTL bounds that lag). Growth fence unchanged:
    any endpoint beyond token issuance + JWKS requires reopening the
    rejected-ideas record.

## Non-goals

- No second token or session model *inside Snapback* — sessions,
  bearers, rotation, and fencing stay with 0057/0059/0077. Two named,
  fenced boundary artifacts are the exceptions, not the rule: the
  outbound-only JWT bridge (landing item 11's contract; never consumed
  by Snapback) and the operator-plane rehearsal capability (landing
  item 1; never an application credential).
- Application-plane grants and scopes stay with 0055; rehearsal
  authority is a separate operator/test-plane capability
  (§Rehearsal grants, "Plane classification"), non-substitutable in
  both directions.
- No relitigation of 0151's ruled questions (Option D credential
  ownership, SMS tier 2, generated-domain passkeys preview-only).
- No hosted-target expansion — every new route inherits the existing
  hosted refusals until LLP 0060's conjunctive readiness admits it.
- No federated consent, no Expo-account dependency: the host stays
  sovereign (0150 invariant 5); anything Expo-side is an optional overlay
  in the 0106 lineage.

## Author decisions — 2026-08-09

Recorded from a sitting with the author (Charlie Cheever); the
corresponding design and landing-shape sections have been updated and
are normative. No open questions remain in this revision.

- **OQ1 — Sequencing: wedge and floor ship together.** The
  rehearsal-grants Spec does not ship alone: it lands in one combined
  first wave with the zero-dependency password + guest floor (I3, I6),
  so the first public story is complete auth *with* the agent-DX wedge
  — not test tooling for the one existing provider. (The brainstorms'
  wedge-first lean was considered and narrowed: the wedge still leads
  the wave internally, since the floor's acceptance suites consume it.)
- **OQ2 — Guest-first is the paved template default** for agent-built
  app templates, carrying a default reaping posture for unclaimed
  guests (templates declare it; apps may opt out or change retention).
  The platform-wide default is unchanged; this is template posture,
  per LLP 0151's cleanup-policy requirement (proposed atop the narrower
  0011 amendment and delegated to the lifecycle spec — see I3's
  attribution).
- **OQ3 — Both in v1.** The verified provisioning hook (I8) *and*
  read-only verified/assurance claims on `ctx.auth` ship together: the
  hook is the paved binding path, and the assurance layer (I4) needs
  claim-shaped data anyway. The claims surface is read-only and
  server-derived; it is never a binding mechanism by itself, and the
  guide teaches the hook as the binding path.
- **OQ4 — A standalone effect-budgets Spec** owns the budget
  vocabulary (names, charge axes, refusal semantics) for local and
  hosted alike; LLP 0057's constants migrate to it by amendment and
  LLP 0060's throttle and the rehearsal budgets reference it.
  (Landing-shape item 5.)
- **OQ5 — Names ratified**: "Snapback Identity" as the subsystem;
  `snapback auth` stays the CLI/API family; `defineAuth(...)` the
  authoring object; "auth rehearsal grant" / "rehearsal window" /
  "rehearsal capability" with provisional prefix `sbrc_`, still subject
  to the mechanical credential-prefix registry check at implementation.
- **OQ6 — Import pipeline and the narrow JWT bridge are both
  commissioned.** The bridge is fenced: short-lived,
  audience-constrained token issuance plus a JWKS endpoint, nothing
  else; any growth beyond that reopens the rejected full-façade record
  rather than extending the bridge. It is recorded as a named exception
  to the no-second-token non-goal with the full security contract of
  landing-shape item 11 (issue-only, source-clamped authority and
  expiry, hard maximum TTL, no refresh/delegation, named
  revocation-lag residual).

## Revision history

- **v0.5 — 2026-08-09 (UNREVIEWED delta).** Round-4 dispositions,
  applied after the loop's terminal round — per the LLP 0010 delta
  rule these fixes are recorded as **unreviewed**; the final loop
  verdicts bind to v0.4
  (`f3da1baed35afcf35c8b4e05fb5f39413286889c36e27c6b1f454889e67c7b33`).
  Round-4 verdicts: Fable READY (3 DETAIL), Codex NOT READY (1
  MATERIAL + 1 DETAIL); zero pre-existing concerns for the third
  consecutive cross-family round. Applied here: the pre-taint export
  policy is stated precisely per Codex's replay finding — the
  envelope authenticates marker state *at export time*; ineligibility
  binds to at-or-after-admission states and their exports; a
  verifiably pre-taint export is promotable **by design** and safe by
  construction (same-transaction taint + snapshot-consistent export
  means a clean-verifying envelope provably contains zero
  rehearsal-derived state); the clean-export → taint → import-old
  sequence becomes an explicit positive acceptance row (this adopts
  the first of Codex's two offered resolutions — no external lineage
  authority is needed once the policy is exact); the reachability
  fact gains a closed schema and producer-parity gate (public target
  classes must publish; the wave-1 local target is the named
  exception); one precommitted namespace per budgeted install
  (counter/selector cardinality pinned); envelope cross-host
  verification-key custody assigned to the Spec; landing item 1's
  acceptance list incorporates the R2/selector rows by reference as
  the authoritative superset.
- **v0.4 — 2026-08-09.** Round-3 delta dispositions. Verdicts on v0.3:
  Fable NOT READY (1 MATERIAL — a dropped edit — + 5 DETAIL), Codex
  NOT READY (5 MATERIAL + 3 DETAIL), all in-delta; **zero pre-existing
  MATERIAL across both families for the second consecutive round**,
  so the loop converged on the delta rule with this one focused
  repair round authorized. All applied: landing item 2 now
  single-sources the wave-1c floor enumeration and owns V6's
  readiness derivation and import-provenance admissibility (the
  round-2 closure whose landing-item half had been dropped by a
  silent edit failure); the `window.install` namespace is
  precommitted at grant mint and consumed by installation (no
  output-as-input circularity; collision/reuse/mutation/concurrency
  acceptance); reachability is recast — selector entropy is the
  authoritative boundary, a published target-authored public fact
  refuses, undeclared proceeds with the residual named
  (fail-closed-on-unknown rejected as refusing the only wave-1
  topology); egress provenance derives from the effective authority
  decision and persists onto deferred intents (outbox/cron/queued
  replay/restart/retry acceptance), scoped to initiated-or-enqueued
  egress; the export envelope is integrity-bound to payload, store
  identity, and marker state under a host-held key (splice and
  substitution negatives); the disposable marker shares the envelope
  and survival mechanics with its own promotion negative; the
  illustrative grant is reduced to a selector/counter-coherent
  four-effect example; "governing authority" wording residue fixed;
  0053/0059/0077 added to Related; 2a carries V6's completion.
- **v0.3 — 2026-08-09.** Round-2 delta dispositions. Verdicts on v0.2:
  Fable READY (7 DETAIL, all in-delta); Codex NOT READY (7 MATERIAL +
  3 DETAIL, all in-delta) — **both families found zero MATERIAL in
  pre-existing text**, so the loop converges on the delta rule once
  these in-delta closures verify. All applied: store-taint marker
  commits in the same transaction as the first effect, survives
  reset/backup/restore/clone/export via a provenance envelope with
  fail-closed import, and the laundering claim is scoped to
  Snapback-mediated paths; the egress gate gains an owner (landing
  item 1a — an 0058-lineage provenance-propagation amendment);
  assurances carry `governingAuthority` (window included) and window
  termination kills window-derived authority even under a live parent
  grant; the budget model charges denials (attempt vs. quota
  counters, 0060-consistent, request-bound idempotency); the
  effect-to-selector mapping is total with per-effect mandatory
  fields; selector entropy is named the actual foreign-caller
  boundary with the reachability refusal demoted to fail-closed
  defense in depth (undeclared refuses; loopback-behind-proxy is an
  acceptance row); the wave-1c floor enumerates its producer paths
  completely (creation, authentication, recovery issuance/rotation,
  custody, last-authenticator); R5 and V6 get explicit wave slots;
  the illustrative record is scope/counter-total; "one-use namespace"
  is disambiguated; the OQ4 pointer and R5's marker attribution are
  corrected; import-provenance admissibility is assigned to the
  identity-core Spec.
- **v0.2 — 2026-08-09.** Round-1 super-refine dispositions; both
  families NOT READY on v0.1 (Fable 4M/5D, Codex 8M/2D, convergent on
  four). All applied — the headline repairs: dependency-spine build
  order with stated interims and a release boundary; identity-core
  Spec added so every v1 commitment is owned; guest-claiming
  attribution corrected (0011 vs 0151); assurance record pins kind vs.
  provenance with posture-scoped admissibility; windows bind to minted
  unguessable selector namespaces; termination terminates derived
  authority at the invocation gate; rehearsal admission permanently
  marks the store ineligible for production promotion; closed
  effect-to-counter budget model with an immutable allocation ceiling;
  fixture memberships via ordinary app authority; clock advance
  confined to disposable stores; rehearsal authority classified
  operator-plane (not an 0055 grant); JWT bridge recorded as a named
  exception with a pinned contract. Full finding-by-finding record:
  the round-1 sections of the two review artifacts under
  `llp/reviews/0212-*`.
- **v0.1 — 2026-08-09.** Initial Draft (dual-family brainstorm
  synthesis + evaluation), author sitting ruling all six OQs, and the
  Draft→Review flip at super-refine loop start.
