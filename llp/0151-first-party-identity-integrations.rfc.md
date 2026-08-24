# LLP 0151: First-party identity integrations and first-class auth mechanisms

**Type:** RFC
**Status:** Draft
**Systems:** Auth, Identity, Providers, Client surfaces, Notifications, Developer experience, Guide, Hosted delivery
**Author:** Charlie Cheever / Claude, with first-class design input from
OpenAI Codex (`gpt-5.6-sol`) and a non-author Fable context (rounds 1–2, per
Charlie's direction that the other family participate in the design, not
only review it)
**Date:** 2026-08-02
**Revised:** 2026-08-24 (implementation record for the default development
provider profile: declared providers, one resolver, one stable `signIn`, the
supervised shared broker, and the `snapback auth` setup group. Records what is
not claimed — the identities are hermetic rehearsal identities, not Apple or
Google logins. See the 2026-08-24 dated amendment.)
**Revised:** 2026-08-21 (author ruling and follow-on concurrence:
first-party providers get zero-setup shared development profiles. Local
development and expiring owner-authenticated previews may use Snapback-owned
registrations, with a 100-user limit. The resolver selects full native auth
only after both app-owned provider configuration and the installed client build
verify. Native runtime failures never fall back to shared credentials. Staging
and production require app-owned credentials and reject rehearsal state.)
2026-08-08 (wave-4 kickoff: the **generated-domain passkeys
tier is RULED — preview-only exception**, with a named promotion condition;
see the dated ruling in §Open questions. The shared-delivery twin remains
open and is no longer bound to the passkeys answer.) 2026-08-06 (sitting #4: wave-4 deferral of the generated-domain passkeys tier and shared-delivery questions AFFIRMED; decided together at wave-4 kickoff.) 2026-08-03 (decision-sitting propagation: the two remaining
residual questions — generated-domain passkeys tier and Expo-hosted
shared email/SMS delivery for generated domains — are deferred to the
wave-4 kickoff with their context recorded; see the dated note in §Open
questions. Source: author decision sitting #2,
`issues/20260803-author-decision-sitting-2.md`).
2026-08-02 (decision-sitting propagation: Option D is adopted as
the production paved path; app-owned provider credentials live in LLP
0036-owned config/secret state, with registration automated where APIs exist
and deterministic guided walkthroughs for Google and Apple; a broker is at
most preview-only, with the transparent Google-issuer relay retained solely as
the pre-pinned conditional. SMS OTP moves to tier 2 and may promote only once
a delivery-vendor owner exists. Source:
`issues/20260802-author-decision-packet.md`). 2026-08-02 (v0.3, super-refine round 2: Fable NOT READY narrow,
Codex NOT READY substantial; all 5 Fable + 11 Codex findings applied —
completion protocol re-grounded on LLP 0039's actual session issuance with
sender-constrained redemption, three pinned flow profiles, and a local-arm
callback strategy; brokered-Google identity rules made consistent
(transparent Google-issuer relay; broker-issuer variant rejected as
graduation-lossy); the two families **converged on Option D now** for the
Google residual, recorded as the loop's joint recommendation to Charlie;
passkey RP-id policy split durable-domain-default vs disclosed tethered
mode for generated domains (author decision); external-prerequisite
annotation propagated per row; password zero-vendor floor repaired with
preissued recovery codes; Apple token-revocation obligation (5.1.1(v))
carved out of the token-discard rule; guest migration gains checkpoints/
abort/cleanup-contract semantics; GitHub pinned to the GitHub App product
with minimized secret footprint; LLP 0064 surface axis corrected; 0104
shadow-meter wording; evidence anchors pinned to URLs; a lifecycle
implementing spec commissioned alongside the completion spec. Round-2 fixes
are applied but not yet re-reviewed); 2026-08-02 (v0.2, super-refine round
1: both families NOT READY; all round-1 findings applied — guest section
rebuilt on LLP 0011's dated claiming amendment, delivery re-anchored to the
ephemeral challenge seam LLP 0045/0057 actually pin, LLP 0036 adopted as
the config/secrets owner, OAuth completion-protocol requirements added
(Codex BLOCKING), identity/authenticator storage split adopted, route
taxonomy aligned with LLP 0031, arms/surfaces terminology fixed per LLP
0093/0064, Apple 4.8/form_post/transfer_sub corrections pinned to primary
sources; credential-ownership section restructured around both families'
convergent per-provider matrix with Codex's Option D added; SMS tier-1 kept
per Charlie's pin but annotated external-prerequisite, with both families'
author-decision challenges recorded for Charlie; design-input growth is
chartered for this loop); 2026-08-02 (initial draft from scoping discussion
with Charlie: scope pinned to identity providers + auth mechanisms; tier-1
provider set Expo/Apple/Google/GitHub; SMS promoted to tier 1;
credential-ownership/broker question deliberately left unsettled for the
review loop)
**Related:** [LLP 0011](./0011-auth-and-permissions.rfc.md),
[LLP 0031](./0031-server-route-taxonomy.spec.md),
[LLP 0036](./0036-app-secrets-and-config.rfc.md),
[LLP 0039](./0039-auth-vertical-slice.rfc.md),
[LLP 0045](./0045-notifications-outbox.rfc.md),
[LLP 0057](./0057-auth-provider-protocol.spec.md),
[LLP 0061](./0061-agent-first-snapback-guide.rfc.md),
[LLP 0064](./0064-native-client-surfaces.rfc.md),
[LLP 0069](./0069-payment-provider-boundary.rfc.md),
[LLP 0093](./0093-client-protocol-and-native-clients.rfc.md),
[LLP 0103](./0103-expo-hosted-snapback.rfc.md),
[LLP 0104](./0104-expo-hosted-metering-and-commercial-contract.spec.md),
[LLP 0106](./0106-agent-native-expo-account-bootstrap.rfc.md),
[LLP 0143](./0143-expo-push-notification-seam.rfc.md),
[LLP 0150](./0150-agent-token-acquisition.rfc.md)

## Summary

This RFC answers the question LLP 0011 explicitly deferred ("Magic-link,
password, OAuth, passkey, and external-provider ordering remain later product
choices") and LLP 0039 left as an open question ("Should the first external
provider be OIDC, GitHub OAuth, Google OAuth, or a generic bring-your-own
verified-token hook?"). It names three things — a sharper cut than the
initial draft's two, adopted from Codex's round-1 design input:

- **identity providers** getting first-party integrations — Expo, Apple,
  Google, and GitHub, built as thin data-driven presets over a shared
  generic OIDC substrate (GitHub as the one bespoke OAuth2 adapter; Apple as
  an executable adapter profile, not just preset data);
- **authenticators** that are first-class — email OTP and magic links,
  username + password, passkeys/WebAuthn, and anonymous/guest identities with
  the claiming path LLP 0011's dated amendment already specifies; SMS OTP is
  supported at tier 2;
- **account lifecycle** — linking, unlinking, recovery, guest conversion,
  change-of-identifier, revocation, and abuse budgets, which round 1
  correctly judged "at least as important as adding providers."

It also pins **a tier model** so "first-party" has a testable meaning, and
works the **credential-ownership question** — who registers and holds the
OAuth client credentials for agent-built apps — into a per-provider matrix.
After two review rounds the matrix carried a **convergent two-family
recommendation** (§Credential ownership), and the 2026-08-02 author sitting
adopted app-owned registration for production. The 2026-08-21 ruling makes a
hard-constrained shared broker the default development profile. The broker is
rehearsal infrastructure, not a production credential owner. The app replaces
the profile with app-owned credentials before staging or production. The
standing constraint remains: production sign-in cannot depend on Snapback or
Expo infrastructure unless the app selects that dependency explicitly.

Nothing here changes LLP 0011's authorization model, its guest-claiming
amendment, or LLP 0039's slice; where this RFC touches settled ground it
adopts by reference. Today the only implemented mechanism is the built-in
`email-code` provider (LLP 0057; `crates/snapback/src/auth/provider.rs`); this RFC is the
roadmap for what stands beside it.

## Motivation

Snapback apps are agent-authored. An agent building an app cannot pause to
walk a human through four OAuth consoles, and the app's first user should not
need to create a password before seeing data. Auth is also the layer where
every comparable platform (Convex, Supabase, Firebase, Clerk-backed stacks)
offers a named list of one-click providers; "bring your own OIDC config"
alone reads as absence. The corpus has a proven provider *abstraction*
(LLP 0011, from Valet), a hardened first *slice* (LLP 0039), and an
implemented first provider *protocol* (LLP 0057), but no document says which
concrete services and mechanisms Snapback treats as product surface. That
gap has already produced drift: LLP 0106 designs Expo identity for the
*agent* bootstrap lane without a matching statement about Expo identity for
*end users*, and LLP 0143 established the "first-party seam" pattern for
push with no identity counterpart.

## Relationship to the existing corpus

- **LLP 0011** owns the model this RFC builds on and does not reopen: stable
  Snapback-issued principal ids, `_auth_identities` linking
  `(provider_key, external_subject) → principal`, server-authoritative
  `_auth_*` tables, the account-link safety rule (email-based linking is
  allowed within one provider; **cross-provider email auto-linking is
  opt-in only** — it is the account-takeover vector), the ratified
  user-switch full wipe, and the dated **guest-claiming amendment**
  (2026-07-23) this RFC adopts wholesale. This RFC supplies the deferred
  ordering and the concrete provider list.
- **LLP 0039** owns the credential/session substrate: bearer session
  credentials (`sbs_` prefixed, hashed at rest, sliding/absolute expiry,
  7-day rotation cadence, refresh with a recoverable superseded state),
  issued today by `POST /auth/exchange` on the sessions provider route.
  Its non-goal "OAuth/OIDC provider adapters in the first slice" stands;
  this RFC is the slice after. Its open question on the first external
  provider is answered in §Sequencing.
- **LLP 0057** is the implemented auth catalog and provider protocol — the
  `email-code` challenge/exchange state machine (attempt caps, digest-only
  durable storage, single-use codes) and the bounded in-process capture
  mailbox that dev/test/demo profiles use. New mechanisms extend 0057's
  catalog; they do not fork it.
- **LLP 0045** owns durable notification delivery — but authentication
  challenges are **explicitly outside** its durable outbox: plaintext codes
  are never durable intents, and a future provider adapter accepts only an
  ephemeral/capture-class payload handle at the delivery seam
  (`llp/0045:24-29`; `crates/snapback/src/auth/provider.rs` refuses production delivery
  until that adapter exists). This RFC's email and SMS mechanisms ride that
  *ephemeral challenge-delivery seam*, with 0045 owning transport adapters
  and vendor drivers, never challenge plaintext at rest.
- **LLP 0036** (Accepted) owns app secrets and configuration: provider
  declarations, issuer selection, client ids, scopes, and secret-*reference*
  names live in generated app configuration; secret *values* live in
  per-app deployment state, never in generated source, bundles, exports, or
  logs; enablement fails closed when required configuration is absent. LLP
  0045's D8 precedent already routes delivery credentials through 0036
  `uses` grants. What remains genuinely open is narrower — see §Open
  questions.
- **LLP 0031** owns the route taxonomy: auth-provider entry points are
  registered app/auth routes, not `/_snapback/*` system operations. New
  OAuth routes register in 0031's enforced registry under its existing
  auth-program lane, with explicit credential-resolution and
  response-sensitivity classifications (§Completion protocol).
- **LLP 0064** owns client surfaces — React Native/Expo, Exact Native, and
  protocol-native (Swift is the protocol-native proving client), beside
  React web; **LLP 0093** owns the wire protocol and the hosted-vs-local
  *deployment arms*. Tier-1 obligations span both, as two separate matrices
  (§Acceptance).
- **LLP 0106** covers agents acquiring/attaching to *Expo* accounts for
  provisioning and billing. Distinct layer: this RFC covers *end users of a
  Snapback app* signing in. The two meet only in §Expo below.
- **LLP 0150** covers agents acquiring tokens to *call* a Snapback app and
  explicitly excludes third-party OAuth to external services; unchanged.
- **LLP 0061** makes "tier 1" enforceable: every tier-1 row owes a guide
  page with CI-verified snippets and a capability-index row; missing ones
  are explicit GAP rows until built.
- **LLP 0069** owns the payment-provider boundary (see §Non-goals).
- **LLP 0104** meters hosted usage; notification-provider costs are
  **internal shadow meters** today — customer-facing per-message pricing
  would require an explicit 0104 amendment.

## Tier model

**Tier 1 — paved path.** Bundled adapter or built-in mechanism, zero or
near-zero configuration, guide page with verified snippets, acceptance
coverage on both deployment arms, and affordances on each supported client
surface. An agent gets a tier-1 mechanism working from the guide alone,
without leaving the repo. Every tier-1 claim carries four witnesses: guide
page, hermetic fixture, demo usage, and capability-index row.

**Tier 1 with external prerequisite** *(annotation class added in round 1;
both families independently required it)*. A tier-1 mechanism or provider
whose *production* leg requires an external registration or vendor account
that cannot be completed from the repo (carrier vetting, OAuth console
registration, a mail vendor). The guide's CI-verified path runs against a
hermetic fixture/capture driver; the real-vendor leg is an honestly labeled
walkthrough. The annotation is a disclosure, not an excuse: the in-repo leg
must still work end to end. Applied per row (round-2 correction — the class
existed but was only applied to SMS):

| Tier-1 row | External prerequisite |
|---|---|
| Email OTP / magic link | production mail vendor (hermetic in dev/test) |
| Username + password | none — the zero-dependency floor |
| Passkeys | none in-protocol (RP-id/domain policy, §Passkeys) |
| Anonymous/guest | none |
| Google | OAuth console registration (no registration API); shed only under the conditional broker (§Credential ownership) |
| GitHub | GitHub account + one manifest-flow click |
| Apple | Apple developer team + Services ID + key, at App-Store time |
| Expo | none by design — but the row is GAP until the provider contract exists |

**Tier 2 — supported.** Documented configuration surface and a stable
contract, but no bundled default and no promise of client-surface UI
affordances. Named tier-2 *presets* (see §Architecture) are configured by
name with no bespoke code and no paved-path promise.

**Landscape.** Named so their absence is a recorded decision, not an
oversight. Promotion is a status change in this document plus the LLP 0061
capability-index row.

## First-class mechanisms (tier 1)

### Email OTP and magic links

The built-in `email-code` provider (LLP 0057) already exists; this RFC
proposes ratifying it as the tier-1 default sign-in. Magic links and codes
are **one email-challenge system with two presentation modes** (Codex round
1) — same 0057 challenge state machine, link or code at the presentation
layer. Guidance prefers *codes* because a code survives the
reader-opens-mail-on-another-device case that breaks link flows. In
dev/test/demo profiles, challenges land in 0057's bounded in-process
capture mailbox (exposed through privileged tooling — they are not printed
to a console); production delivery refuses until the LLP 0045 ephemeral
delivery adapter exists. Production email is this row's external
prerequisite: a mail vendor, smaller ceremony than SMS's but real.

### Username + password

Simple, universally familiar, and — a point from Fable's round-1 input worth
stating as the design rationale — the **only production mechanism with no
external dependency at all**: no mail vendor, no OAuth console, no carrier.
For the floor to be real, its recovery path must also be vendor-free:
**password accounts without a verified email are issued preissued recovery
codes at creation** (§Lifecycle); email-based reset is offered when the
account has a verified email and is annotated as that path's external
prerequisite. Tier-1 password support is a package, not a hash column
(Codex rounds 1–2), **aligned with current NIST SP 800-63B guidance
without claiming to reproduce it in full**
([SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/)):
Argon2 with hashing outside the single-writer lock (LLP 0011's
Valet-proven rule), compromised/common-password screening at creation and
change (a launch baseline, not a tier-2 nicety), length minimums per
current guidance, guessing throttles and non-enumerating failure shapes,
username canonicalization and uniqueness rules (case behavior, rename),
session rotation on password change, and the last-authenticator rule
(§Lifecycle).

### Passkeys / WebAuthn

The industry-endorsed passwordless direction and the strongest phishing
resistance available. First-party support means registration and assertion
endpoints, credential state in the credentials relation (§Lifecycle), and
per-surface affordances (native passkey APIs via the Expo module surface;
WebAuthn on web — native clients use the **same durable web RP id** through
platform association, never a native-only identity namespace).

The RP-id policy, revised in round 2 after Codex charged the round-1
synthesis with introducing the tether the pinned constraint forbids:

- **`rpId` is immutable once the first credential is registered.**
- **Production default: the app's own durable domain.** When a custom
  domain exists at passkey-enable time, it is the RP id and no
  platform-domain dependency ever forms.
- **Generated-domain apps: passkeys are a disclosed tethered mode.** The
  RP id is the generated subdomain; if the app later moves to a custom
  domain, continuity uses WebAuthn **Related Origin Requests** — the
  generated origin serves `/.well-known/webauthn` listing the custom
  domain — which works only because, and only as long as, Expo keeps
  serving that origin. That is a real continuing dependency: credentials
  registered against the generated RP id never become independent of it
  (ROR shares an existing RP id; it migrates nothing). The mode therefore
  requires UI disclosure, and **whether it qualifies as production tier 1
  or stays a preview exception is an author decision** (§Open questions).
  The two family positions: Fable — permanent-generated-RP-id + ROR is
  acceptable because Expo retains generated domains indefinitely; Codex —
  a continuing Expo-controlled sign-in dependency is the forbidden tether
  unless explicitly excepted.
- WebAuthn Level 3 requires ROR-supporting clients to process **at least
  five** registrable-origin labels (client policy may allow more)
  ([WebAuthn L3](https://www.w3.org/TR/webauthn-3/)) — ample for one app
  plus a custom domain, unusable for any shared-RP-id scheme.
- **Never a shared cross-app RP id** — that would make one app's passkeys
  assertable by another.
- Until ROR support is verified across target browsers and the native
  association mechanisms, guidance stays: passkeys are an *additional*
  mechanism next to a recoverable one.

### Anonymous / guest identities with claiming

The biggest time-to-first-use lever for agent-built apps: a user tries the
app before any sign-in ceremony. **LLP 0011's dated guest-claiming
amendment (2026-07-23) already specifies this design; this RFC adopts it by
reference rather than re-deriving it**: a guest is a full Snapback
principal — a real `userId` **with a guest marking**, not a provisional id;
claiming attaches an identity link to the existing principal and clears the
marking, so `userId` is continuous and no data is rekeyed; claims require a
server-verified challenge from within the guest session; collision with an
existing account is **refused with a typed error**; claims are atomic,
first-claim-wins, session-rotating, audited, and advance the LLP 0053
`permissionBacking` authorization version.

On top of the amendment, this RFC proposes the post-collision continuation
(the amendment's recorded escape hatch — "an explicit app-level migration
hook" — given shape by both round-1 families, hardened in round 2):

- The typed collision result carries a short-lived capability bound to
  `(guest principal, existing principal, verified proof, initiating
  session)`. Two continuations exist; neither is implicit.
- **`switch_existing`** (the default): sign into the colliding account,
  executing LLP 0011's ratified user-switch fence — session rotation,
  guest-session revocation, and the **complete client-side wipe** before
  any existing-account data is exposed. Guest data is not destroyed at
  switch: the guest principal is frozen (sessions revoked, writes refused)
  and retained in quarantine under an explicit TTL.
- **`merge`** (opt-in, app-registered): an app-supplied deterministic
  migration handler receives `{survivorId, absorbedId}` — the survivor is
  always the pre-existing account, never the guest (the guest session
  proved control of an identifier once; it must not inherit an account's
  authority in place). The handler performs no external side effects and
  runs as ordinary chunked mutations against the frozen guest — freeze
  first, then migrate, then retire — so bulk row migration never sits
  inside one giant hold of the single-writer lock. Round-2 hardening: the
  migration is **checkpointed and idempotently resumable** (re-running a
  chunk is a no-op), abort returns cleanly to the frozen state, absorbed
  data stays invisible to the survivor until migration completes, and the
  handler version is pinned per migration (a deploy mid-migration resumes
  under the pinned version or aborts to frozen). The merge commit is a
  `permissionBacking` event.
- **Reaping needs an app-owned cleanup contract.** Arbitrary app rows may
  reference a guest principal, and Snapback cannot generically know
  whether they should move, delete, or remain. An app declares its
  cleanup policy (delete / tombstone / retain-anonymized) for
  quarantine-expiry; absent a declaration, rows are durably tombstoned
  rather than silently orphaned. Acceptance may not claim switch/merge
  for an app until its cleanup policy is pinned.
- Unclaimed guests expire under a retention limit so they do not
  accumulate unboundedly.

The full transition contract (checkpoint format, resumption, TTLs, LLP
0053 interaction mid-migration) belongs to the lifecycle implementing spec
this RFC commissions (§Open questions).

## Account lifecycle, storage, and abuse budgets

Round 1's most consequential structural input (Codex): **identities and
authenticators are different things and must not share a relation.**

- `_auth_identities` holds *external subjects and verified identifiers* —
  OIDC `(issuer, subject)`, GitHub user ids, verified emails/phones.
- Credential state — password hashes, passkey public keys and signature
  counters, TOTP seeds, recovery-code state — lives in a separate
  `_auth_credentials`-class relation, because uniqueness, rotation,
  revocation, and recovery behave differently per class.
- OIDC identity is canonically `(issuer, subject)`. A `provider_key` is
  sound only because a **provider installation binds it immutably to its
  issuer, tenant/team, and client-registration ownership** — reconfiguring
  a preset must never silently reinterpret existing identity rows.

Lifecycle rules the mechanisms above share (round 2 added the transition
obligations; the full state machine belongs to the commissioned lifecycle
spec):

- **Sensitive transitions require recent authentication.** Link, unlink,
  change-email, change-phone, and recovery-configuration changes demand a
  fresh (step-up) verification, not merely a live session.
- **Transitions have session and notification consequences.** Credential
  and identifier changes rotate the acting session and revoke others per
  class; identifier replacement notifies **both** the old and new
  identifier; recovery-code consumption and replacement notify the
  account's reachable identifiers.
- **Link/unlink** follows the account-link safety rule from LLP 0011, plus
  the **last-authenticator rule**: an account can never unlink or disable
  its last usable authenticator — computed jointly across identities *and*
  credentials, since either class can carry sign-in ability.
- **Recovery.** Recovery codes are tier-1 *infrastructure* (not a
  mechanism): preissued, stored digest-only under LLP 0057's discipline
  (single-use, keyed digests, versioned replacement issues a full new
  set). They are **mandatory for accounts lacking an independently
  recoverable authenticator** — passkey-only, password-without-email,
  SMS-only — rather than for every passwordless account. Email OTP is the
  recovery anchor wherever a verified email exists; apps that skip email
  entirely accept a documented, disclosed reliance on recovery codes.
  Change-email and change-phone are first-class verified flows, not row
  updates (LLP 0039 already flags identity-subject change as pressure on
  the `(provider, subject)` model; those flows land here).
- **Sign-in-only adapters discard provider tokens** — with one pinned
  carve-out: **Apple requires token revocation at account deletion**
  (App Review Guideline 5.1.1(v), effective 2022-06-30: apps offering
  Sign in with Apple must call `POST https://appleid.apple.com/auth/revoke`
  when a user deletes their account, which takes a refresh or access
  token — [Apple developer news](https://developer.apple.com/news/?id=12m75xbj)).
  The Apple adapter therefore retains the refresh token **encrypted,
  revocation-use-only**, in the credentials relation; if no token is held,
  Apple's documented fallback applies (delete the data anyway and direct
  the user to manual revocation). No other adapter stores tokens; apps
  needing provider API access are a different, explicitly-scoped feature.
- **Provider revocation vs account deletion are distinct transitions**:
  identity unlink (subject revoked at the provider), principal deletion
  (user-initiated, triggers the Apple revoke above), and quarantine each
  have defined, audited behavior.
- **Audit events** for link, unlink, collision, merge, recovery,
  reauthentication, and provider reconfiguration — extending 0011's
  guest-claim audit list.
- **Abuse budgets** cover email sends, SMS sends/spend, password guessing,
  OAuth transaction creation, and account enumeration; public failure
  shapes stay non-oracular per 0011.
- Step-up/MFA composition (TOTP, SMS-as-second-factor) is deliberately an
  open question — the factor-composition model has no owner yet.

## Provider integrations (tier 1)

### Architecture: an OIDC substrate with presets

Google is a standard OIDC provider
([Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect));
Apple is OIDC-shaped with quirks; Expo's provider is ours to define and
should be born a clean OIDC provider; GitHub is plain OAuth2 plus a REST
profile call. Therefore the implementation is **one generic OIDC adapter**
plus:

- **presets as data** — declarative records (issuer, endpoints, quirk
  flags, claim mappings), not code, so the tier-2 catalog is cheap and
  extensible. Tier-1 presets: `google`, `expo`. Named tier-2 presets ship
  in the same catalog — **Microsoft Entra ID** first (too important to
  leave as "generic OIDC"; its tenant-selection behavior needs explicit
  handling), then Okta-class enterprise IdPs and consumer OIDC providers.
  "Preset" and "tier 1" are deliberately decoupled: presets are cheap;
  tier 1's guide/acceptance/surface obligations are the expensive part.
- **`apple` as an executable adapter profile**, not just preset data: its
  client-secret JWT signing, conditional `form_post`, first-authorization
  user payload capture, private-relay handling, revocation-at-deletion,
  and transfer operations are provider *logic* (Codex round 1).
- **one bespoke adapter** for GitHub (§GitHub). Discord is the same
  class — OAuth2 without OIDC discovery or id tokens — and sits in the
  landscape as a future bespoke adapter, *not* a generic-OIDC example.
- The substrate's verification obligations are protocol content, not
  implementation notes
  ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html),
  [OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html)):
  `iss`/`aud`/`azp`/nonce/expiry checks, signature-algorithm policy,
  discovery-issuer equality, JWKS rotation, PKCE + `state`, mix-up
  defense, and exact return-target allowlisting.
- **A synthetic conformance IdP fixture ships with the substrate** (both
  families, round 1): local discovery + JWKS + code/PKCE issuer with
  configurable quirk modes (form_post, missing userinfo, name-once) and
  adversarial fixtures (issuer mix-up, JWKS rotation, bad audience,
  replay, redirect manipulation), so the acceptance matrix runs hermetic
  and Apple-quirk paths are testable before Apple lands.

All providers land in `_auth_identities` under LLP 0011's model with the
account-link safety rule stated above.

### The OAuth completion protocol

Round 1's BLOCKING finding (Codex) — how a callback becomes a Snapback
session — was answered in v0.2 and judged displaced, not closed, in round
2. This revision pins what the RFC itself must own; the full wire contract
is commissioned as an implementing spec standing to this RFC as LLP 0057
stands to email-code:

- A server-side **authorization transaction** with bounded expiry stores
  `state`, nonce, PKCE verifier material, the **provider installation id**
  (not just the issuer string — a transaction started under installation N
  must not complete under a reconfigured N+1), initiating client/session
  binding, and the exact return target; one-use, cancelable,
  replay-refused.
- **Sender-constrained redemption.** At transaction creation the client
  generates a one-time redemption verifier (PKCE-style) and retains it;
  the callback yields a short-lived, one-use **completion code** delivered
  via the return target, and redemption requires code **plus verifier**,
  so an intercepted completion code alone is inert
  ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) transaction
  binding; [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html)
  native-client verifier custody). Redemption issues a standard LLP 0039
  bearer session through the same session-issuance path as
  `/auth/exchange` (sessions provider route; no-store credential
  response). **No provider token and no Snapback bearer token ever
  crosses a redirect URL.**
- **Three flow profiles**, pinned here because they differ structurally:
  1. **Browser (server-callback) flow** — confidential server client;
     provider redirects to the server callback; server exchanges the code,
     verifies the id token, and forwards the completion code to the
     allowlisted app return target.
  2. **Native external-user-agent flow** (RFC 8252) —
     ASWebAuthenticationSession / Custom Tabs with https universal/app
     links; the app holds the redemption verifier; never an embedded
     webview.
  3. **Native SDK handoff** — Apple's `ASAuthorizationController` and
     Google's per-platform credential APIs return a provider credential
     *directly to the app* with no redirect; the app submits it to the
     server, which verifies it against the app's registered native client
     ids and issues the session through the same path. This profile is
     why per-platform client ids (§Google) are registered even though no
     callback URL is involved.
- **Local-arm strategy.** The local deployment arm cannot assume a
  provider-reachable callback host. Real-provider flows on the local arm
  use loopback redirect URIs where the provider supports them (Google's
  installed-app loopback class); everywhere else, local acceptance runs
  against the conformance IdP, and real-provider legs are hosted-arm
  walkthroughs.
- Routes — the callback and the redemption route — register in **LLP
  0031's enforced registry** (auth-program lane, not `/_snapback/*`) with
  explicit credential-resolution and response-sensitivity classifications
  matching `/auth/exchange`'s no-store credential class.

### Provider specifics

**Expo.** End-user "Sign in with Expo" — distinct from LLP 0106's agent
bootstrap, though the same Expo identity backend serves both. **Status:
tier-1 target, GAP pending provider contract** (Codex's author-decision
challenge, adopted): until a verified issuer, claims contract, registration
path, and acceptance fixture exist on the Expo side, the row is an explicit
LLP 0061 GAP, not a claim. Because Expo owns the IdP, per-app client
registration is native — no broker question exists for it. It must remain
*a preset, not a privileged path*: apps deployed anywhere treat Expo
exactly as they treat Google, per the no-fundamental-tether constraint.

**Apple.** OIDC-shaped with pinned quirks: `form_post` response mode **when
scopes are requested**, no userinfo endpoint, user name delivered only on
first authorization (capture it then or lose it), optional private-relay
email, and the **revocation-at-deletion obligation** (§Lifecycle).
Structural facts, pinned:

- The `sub` is stable across apps **within one developer team**
  ([Apple SIWA identity-token docs](https://developer.apple.com/documentation/signinwithapple/receiving-a-users-identity-token)).
- Apple's sanctioned migration is the **transfer-identifier protocol**
  (`transfer_sub`,
  [TN3159](https://developer.apple.com/documentation/technotes/tn3159-migrating-sign-in-with-apple-users-for-an-app-transfer)):
  when an app moves between developer teams via App Store Connect
  transfer, id tokens carry a transfer identifier for 60 days so the new
  team can re-key users — **including migrating private-relay
  addresses**. It is defined for app transfers; it is not an established
  path for graduating an app off *shared broker* credentials (that is not
  an app transfer), which is why §Credential ownership treats brokered
  Apple as structurally hazardous: relay addresses are team-scoped too,
  so for relay users even email re-linking has no matching identifier.
- App Review Guideline 4.8
  ([guidelines](https://developer.apple.com/app-store/review/guidelines/)):
  apps using third-party/social login for the primary account must offer
  an equivalent option that limits data to name and email, allows keeping
  the email private, and doesn't collect ad interactions without consent
  — Sign in with Apple satisfies this but is not mandated by name, and
  apps using only their own account system (email OTP, password) are
  exempt. So Apple is coupled in by *social login on iOS*, not by iOS
  itself — and the coupling is "an equivalent-privacy option," which SIWA
  is the practical answer to.
- Native Sign in with Apple (`ASAuthorizationController`) binds to the
  app's bundle id and team — one more per-app-registration force, and the
  native-SDK-handoff profile above is how it reaches a session.

**Google.** Full OIDC; `sub` is "unique among all Google Accounts and never
reused… never changed"
([Google OIDC docs](https://developers.google.com/identity/openid-connect/openid-connect)),
so broker→own-credentials migration preserves identities. No public API
for OAuth client registration exists, and redirect URIs are exact-match
with no wildcards
([Google OAuth docs](https://developers.google.com/identity/protocols/oauth2/web-server)).
Native surfaces use per-platform client ids (Android registration binds
the signing-cert fingerprint; iOS uses its own client type), consumed by
the native-SDK-handoff profile; a shared broker cannot own these, so
brokered Google on native means system-browser flows, not native one-tap.
Basic profile/email scopes avoid Google's app-verification burden;
anything beyond them is out of paved path.

**GitHub.** Bespoke OAuth2 adapter; numeric user id as the stable subject.
Highest-value provider for Snapback's near-term audience. Round 2 pinned
the registration product precisely: the one-click programmatic path is the
**GitHub App Manifest flow**
([manifest docs](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest))
— it creates a **GitHub App**, not an OAuth App (OAuth Apps have no
manifest flow), and a GitHub App supports "Login with GitHub" via the
standard OAuth web flow
([login with a GitHub App](https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-a-login-with-github-button-with-a-github-app)).
The paved path therefore registers a per-app GitHub App with **no
repository permissions and email read access only**, and — because the
manifest exchange returns a private key and webhook secret alongside the
client credentials — the sign-in-only path **discards the private key and
webhook secret** (or never provisions webhooks), keeping the secret
footprint to client id + secret under LLP 0036. GitHub's redirect
matching follows documented host/port/path rules rather than strict
equality; **Snapback's policy is to register and emit exact callback URIs
everywhere, even where a provider accepts broader matching.**

### Sequencing (proposal)

Merged from both families' round-1 input; mechanisms are sequenced
explicitly, not just providers, and the lifecycle core comes first because
everything else hangs off it:

1. **Provider-independent core**: the verified-identity result type, the
   identity/credential storage split, the provider-installation namespace,
   and the transactional link/collision API.
2. **The authorization transaction and completion protocol** (§above).
3. **Synthetic conformance IdP + adversarial fixtures.**
4. **Guest claiming proven on `email-code`** — claim, collision, switch,
   merge, session rotation, recovery — before any external provider; it is
   pure-local and the acceptance demo depends on it.
5. **Google** (proves the substrate against the strictest mainstream
   implementation).
6. **GitHub** (bespoke adapter + manifest-flow assisted registration).
7. **Apple** — sequenced with the first App Store-bound demo, on the app's
   own team, not by calendar.
8. **Passkeys** once the RP-id policy above is adjudicated.
9. **Password** with its full baseline package.
10. **SMS tier-2 support** once the delivery seam and abuse controls exist;
    tier-1 promotion additionally requires the named delivery-vendor owner.
11. **Expo** when its provider contract is verifiable (GAP clears).

`_auth_accounts` does not return (0039's identity-merge model holds);
provider metadata needed for audit lives on the identity link.

## Tier 2 (supported, not paved)

### SMS OTP

**Tier 2**, by the 2026-08-02 author decision. SMS is supported when the app
supplies vendor configuration; it is not a paved tier-1 mechanism. Promotion
requires a named delivery-vendor owner in addition to tier 1's guide,
fixture, demo, capability, deployment-arm, and client-surface witnesses.
Production SMS requires carrier-side sender registration (US A2P 10DLC
campaign vetting or toll-free verification, a days-to-weeks process tied
to a business identity; per-country sender-ID rules elsewhere), and NIST
SP 800-63B treats PSTN out-of-band authentication as *restricted*,
requiring an alternative authenticator be offered.

Phone-first sign-in matters most on the Expo/React Native surface
`[observed — market pattern, region-dependent; strongest in phone-first
markets]`. Design requirements:

- **Abuse controls are launch-gating, not hardening.** SMS pumping
  (artificially inflated traffic) attacks the app owner's wallet directly.
  The supported path fails closed: destination-country allowlist **default-on**,
  per-destination/per-source/per-prefix/per-IP throttles, global spend caps
  with alarms, and idempotent sends. Per-message provider cost is
  **shadow-metered internally under LLP 0104** (customer-facing pricing
  would need an explicit 0104 amendment); locally, enabling SMS requires a
  config acknowledgment of spend exposure.
- **Snapback owns codes; vendors own transport.** The driver is a raw
  message transport (`destination E.164, template id, variables` →
  classified delivery result), behind the same ephemeral challenge-delivery
  seam as email; challenge issuance/verification state stays in 0057's
  state machine. A managed verification product (e.g. Twilio Verify) is a
  *different semantic adapter* — the vendor becomes the challenge source of
  truth — and is outside this path. The seam stays vendor-neutral (E.164
  normalization, locale templates, delivery-status normalization, failover
  policy, secret-safe telemetry) and should not assume phone-OTP ⇒ SMS
  (WhatsApp OTP is cheaper and higher-deliverability than SMS `[observed —
  market pattern, region-dependent]` in several major markets — landscape
  row for now).
- Recycled numbers and SIM-swap risk mean SMS is never the recommended sole
  authenticator for high-value accounts (§Lifecycle recovery rules).

- **Generic OIDC configuration** — the substrate exposed directly (issuer +
  client credentials + claim mapping).
- **Named tier-2 presets** — Microsoft Entra ID (with tenant handling)
  first; Okta-class and consumer OIDC providers as the catalog grows.
- **BYOP verified-token hook** — LLP 0011's boundary (Clerk, WorkOS, Auth0,
  Firebase Auth as the identity system); unchanged by this RFC.
- **TOTP** as a second factor, on the same credential/recovery lifecycle.
- **Device authorization flow (RFC 8628)** for CLI/TV-shaped clients — LLP
  0106 already leans on it for the agent lane; end-user support waits for a
  real embedder.

## Landscape (named, deferred)

Enterprise SSO (SAML, SCIM, org-managed policy — continuous with LLP 0039's
non-goal), Discord and other OAuth2-without-OIDC providers as future
bespoke adapters, WhatsApp OTP (phone-challenge transport rivaling SMS in
several markets — the delivery seam must not assume SMS), QR cross-device
login, wallet auth (SIWE), Facebook/Meta and other social providers beyond
the four, Game Center / Play Games (only if games become a target
vertical).

## Credential ownership

Every provider requires a registered OAuth client with registered redirect
URIs; Apple's additionally requires a developer team, Services ID, and
signing key. Charlie directed (2026-08-02) that the options be written up with
trade-offs under one pinned constraint: no fundamental tether to Expo's
servers; optional convenience is fine. After two rounds the loop carried a
convergent recommendation, and the 2026-08-02 author sitting adopted Option D
as the production paved path.

**Constraints that bound the space:**

- Redirect URIs are registered per client; Google is exact-match with no
  wildcards, GitHub allows documented host/path matching — Snapback emits
  exact URIs regardless. Generated per-app domains cannot be wildcarded
  into a Google registration, which pushes shared-credential designs
  toward a fixed callback host.
- Google and Apple expose **no client-registration API**; GitHub does (the
  App Manifest flow); Expo's is ours to build. "Registration-only broker"
  is therefore infeasible exactly where a broker would matter most, and
  automated per-app registration is free exactly where the broker is
  unnecessary. Where providers support
  [RFC 7591](https://www.rfc-editor.org/rfc/rfc7591.html) dynamic
  registration (enterprise IdPs, often), automation uses it.
- Apple subjects **and private-relay addresses** are team-scoped; the
  sanctioned `transfer_sub` migration covers App Store Connect app
  transfers, not shared-credential graduation. Brokered Apple therefore
  strands relay users with no matching identifier on graduation.
- The consent screen shows the *registered client's* name: under shared
  credentials users see the broker's brand, not the app's.
- Shared credentials share fate: abuse by one app risks provider-side
  suspension and shared rate limits for every app on the client.
- Native surfaces bind registrations to app identity (signing-cert
  fingerprints, bundle ids), which shared brokers cannot own; brokered
  flows on native are system-browser flows.
- **First-party prior art:** Expo's own deprecated `auth.expo.io` proxy
  was a shared fixed-callback broker for exactly this problem; its
  retirement lessons (bind callback→app mapping to verified app
  ownership; no open forwarding; phishing surface of a shared trusted
  domain) are direct evidence for this section.

**The per-provider matrix (both families, round 1):**

| Provider | Development default | Production path |
|---|---|---|
| Expo | Snapback development registration | Native per-app registration because Expo owns the IdP |
| GitHub | Snapback shared development registration | Assisted app-owned registration through the GitHub App manifest flow |
| Apple | Snapback shared browser registration with rehearsal identities | App-owned registration on the app's Apple developer team |
| Google | Snapback shared browser registration with rehearsal identities | App-owned registration through the guided Google console flow |

**The options** (A–C from the initial draft; D added by Codex round 1):
**A:** BYO credentials only. **B:** a hosted broker as the production default.
Option B is dominated by branding leakage, shared failure, Apple identity
migration loss, and an unwanted Expo dependency. **C:** a neutral,
self-hostable broker protocol, narrowed by the matrix to Google-class
providers. **D:** registration
automation without authentication brokering: automate client creation
wherever an API permits (GitHub today, Expo natively, RFC 7591 IdPs),
deterministic guided walkthroughs where it doesn't (Google, Apple), all
results written into 0036-owned config/secret state; at most a
preview-only shared broker for development, never the production default.

**Round-2 convergence.** Both families now recommend **Option D as the
production paved path**, for the same reasons: the conformance IdP (round
1) removed the broker's CI job; the external-prerequisite annotation made
"Google tier 1 with a guided walkthrough" internally honest; and a broker
constrained as hard as both families require, serving exactly one
provider, is a standing spec/ops/security commitment with a poor cost
ratio while the walkthrough is a one-time, minutes-scale, agent-generated
ceremony.

**The pre-pinned conditional (if zero-console Google ever becomes a
product requirement):** the only graduation-preserving shape is the
**transparent Google-issuer relay** — Google remains the issuer, identity
rows stay `(accounts.google.com, sub)`, the app verifies Google's JWKS
and its own nonce (broker-asserted identity forbidden), the PKCE verifier
is app-generated, the broker is stateless per-exchange with no durable
identity storage and no session issuance, and the self-hostable broker
protocol spec ships **with or before** any brokered preset so no-tether
holds by construction. Codex's remaining safeguards (one-use
audience/nonce-bound handoff, token discard, explicit user-visible
labeling, preview-first rollout gated on measured funnel evidence)
compose with that shape. The round-1 "broker-specific issuer namespace"
variant — a separate broker-branded federated IdP — is **rejected**: it
would mint broker-namespace subjects and re-key every identity on
graduation, manufacturing for Google the same stranding hazard the matrix
excluded Apple brokering for. (Round 2 surfaced that the v0.2 text
asserted Google-issuer continuity, a broker issuer namespace, and
app-side Google-token verification simultaneously — mutually
incompatible; this paragraph is the resolution.)

**Author decision — 2026-08-02, amended 2026-08-21.** Option D remains the
production path. The shared broker is now the default development path for
first-party providers. Development identities carry rehearsal provenance and
cannot enter a staging or production deployment. The broker's remaining costs
are visible in development: its consent-screen brand, shared suspension and
rate limits, availability dependency, and correlation risk. None of those
costs silently enters production.

### Default development provider profiles

A new app can select a first-party provider without creating provider
credentials. The provider declaration names the provider and leaves credential
selection on `auto`:

```ts
providers: {
  apple: { kind: 'apple', credentials: 'auto' },
  google: { kind: 'oidc', preset: 'google', credentials: 'auto' },
}
```

The application calls one client interface regardless of the selected Adapter:

```ts
await auth.signIn({ provider: 'apple' });
```

`auto` is a request for deployment-specific resolution. It is not permission
for the client to choose credentials or retry through another identity realm.
The generated auth program remains the single source declaration under LLP
0258. The resolver combines that declaration with deployment state, LLP 0036
configuration readiness, the current app binding, and a client-build receipt.

#### Resolved provider entry

The exact artifact schema belongs to the completion-protocol implementing
Spec. Its minimum semantic content is:

```ts
type ResolvedProviderEntryV1 = {
  format: 'snapback.resolved-provider-entry.v1';
  provider: 'apple' | 'google' | 'github' | 'expo';
  providerInstallationId: string;
  adapter:
    | 'synthetic'
    | 'snapback-shared-browser'
    | 'app-owned-browser'
    | 'app-owned-native';
  identityRealm: 'rehearsal' | 'application';
  authProfileGeneration: string;
  configGeneration?: string;
  clientBuildReceipt?: string;
  readiness: 'ready' | 'blocked';
  nextAction?: string;
};
```

The projection contains no credential value, provider token, callback secret,
user identity, or Snapback session credential. The resolver binds one result to
the auth-profile generation before sign-in begins.

The selection rules are closed:

| Deployment and readiness | Selected Adapter | Identity realm |
|---|---|---|
| Test or checked demo | Synthetic conformance IdP | Rehearsal |
| Local development with verified app-owned configuration and a matching native build receipt | App-owned native | Application |
| Local development without both native readiness facts | Snapback shared browser | Rehearsal |
| Owner-authenticated preview with an explicit expiry and an active rehearsal window | Snapback shared browser | Rehearsal |
| Staging or production with complete app-owned configuration | App-owned native or app-owned browser, according to the client surface | Application |
| Staging or production with incomplete app-owned configuration | Refuse activation | None |

Shared previews are capped at 100 users. Every preview carries an expiry, an
app binding, provider-specific abuse budgets, and a rehearsal authority. The
shared profile is unavailable to an anonymous deployment or a deployment that
claims staging or production posture.

The client projection is not the admission boundary. The shared broker repeats
the deployment, owner-authentication, expiry, app-binding, and user-cap checks
from server-held state before it creates a transaction. A modified client
cannot promote itself into a shared preview or enable shared auth in staging or
production.

#### Native readiness requires both halves

Provider configuration alone cannot select native auth. The current client
must also prove that its signed build contains the matching native integration.

Apple readiness includes the app identity, developer team, Sign in with Apple
capability, signed entitlement, accepted audiences, and production revocation
configuration. Google readiness includes the platform client ids, iOS return
scheme or Android signing-certificate binding, server audience, and native SDK
configuration. The implementing Spec may add provider facts, but it cannot
weaken the two-part rule.

Configuration that is ready while the installed build is not ready keeps local
development on the shared browser Adapter. The projected `nextAction` tells the
author to rebuild. Staging and production refuse instead of serving a shared
profile.

#### Native failures never fall back

Resolution is frozen for one sign-in attempt. If the selected native Adapter
returns cancellation, timeout, `invalid_client`, token refusal, or any other
failure, Snapback reports that result. It does not open the shared browser
Adapter.

Silent fallback would change the consent brand, provider installation,
identity realm, and possibly the provider subject. It could create a second
principal while hiding broken production configuration. An operator may stage
a new auth-profile generation that selects the shared development Adapter, but
an individual request cannot make that change.

#### Shared development browser Adapter

The shared Adapter uses the external-user-agent completion flow on native and
the server-callback flow on web. Shared credentials cannot satisfy bundle-id,
signing-certificate, or team-bound native checks.

The broker accepts only a generated app binding and a fixed provider name. It
never accepts an arbitrary callback URL. The app holds the redemption verifier.
The callback carries only a short-lived one-use completion code. Redemption
requires both values and issues the ordinary Snapback session through the
common completion path. Provider tokens and Snapback session credentials never
cross a URL.

The development broker creates an app-scoped rehearsal identity. The durable
identity tuple includes the development provider installation and a subject
derived from both the app id and the provider subject. The broker does not use
email to link accounts. Two apps that use the same shared provider do not
receive the same Snapback identity.

The earlier transparent Google-issuer relay remains a possible future mode for
identity continuity. It is not the default shared development profile. The
default profile chooses disposable rehearsal identity over implicit migration.

#### Switching to app-owned credentials

Shared and app-owned credentials are separate provider installations. A
configuration change never reinterprets an existing installation. The switch
stages a successor auth-profile generation and signs out rehearsal custody
before the app enters the application identity realm.

Resetting rehearsal auth state is the default transition. An app may implement
an explicit reviewed migration that asks the user to prove both identities.
Snapback never merges the identities by email, provider profile claims, or a
Google-only continuity exception. Apple subjects and private relay addresses
can change with the developer team, so one uniform rule is safer and easier to
test.

Before staging or production, the operator must reset rehearsal state or
complete the explicit migration. Production activation refuses if the resolved
provider profile is shared, any rehearsal identity remains, or a required
app-owned config reference is unset. This is the LLP 0214 rehearsal-provenance
rule applied to the complete identity store, not only the current session.

#### Setup and status

The setup interface reports one replacement task per provider. The intended
commands are:

```sh
snapback auth configure apple
snapback auth configure google
snapback auth status
```

Configuration opens the provider registration page, writes public client ids
and secret values into LLP 0036 deployment state, verifies the callback, and
stages the app-owned profile. Native configuration then requires a new client
build and a matching build receipt before the resolver selects it.

`auth status` reports the selected Adapter, identity realm, configuration
readiness, client-build readiness, and one next action. Secret values never
enter source, generated artifacts, client bundles, logs, status output, or
receipts.

## Non-goals

- Agent token acquisition (LLP 0150) and agent↔Expo account bootstrap
  (LLP 0106).
- Any change to LLP 0011's authorization model, guest-claiming amendment,
  RLS semantics, or `_auth_*` custody rules, or to LLP 0039's
  session/credential substrate.
- Enterprise SSO and org management (landscape).
- Payment-provider integration — owned by LLP 0069 (the initial draft
  miscited LLP 0106, which governs the Expo control plane and billing
  separation).
- Storing or proxying provider API tokens for app use of provider APIs
  (sign-in-only adapters discard tokens, Apple's revocation carve-out
  excepted; API access is separate work).

## Acceptance sketch

Two matrices, not one (round-1 correction — LLP 0093 "arms" are
hosted-vs-local deployment; client surfaces are LLP 0064's axis):

- **Mechanism/provider × deployment arm** (local, hosted): the auth
  matrix extension, running against the conformance IdP fixture
  hermetically on both arms; real-provider legs are labeled hosted-arm
  walkthroughs (plus Google's loopback class locally).
- **Mechanism/provider × client surface** (React web, plus LLP 0064's
  three: React Native/Expo, Exact Native, protocol-native — Swift as the
  proving client): the affordance matrix; adapter/preset rows apply to
  providers, while password/guest/passkey rows have mechanism-appropriate
  witnesses instead. Exact Native's authorization-fencing carrier makes
  its auth rows first-class here, not an afterthought.

Every tier-1 row is done when adapter/mechanism + acceptance coverage land
on both arms, a guide page with CI-verified snippets exists (LLP 0061),
each supported client surface has a working affordance, and the capability
index row flips from GAP — with the row's external-prerequisite annotation
(§Tier model) stating exactly which legs are hermetic and which are
walkthroughs. The proving demo: an agent builds an app that offers
"continue as guest," claims the guest via email code, and links a Google
identity — exercising the three mechanisms whose composition this RFC most
depends on, against the conformance IdP in CI and real Google in the
labeled walkthrough.

The zero-setup profile adds these acceptance obligations:

- one authored `credentials: 'auto'` declaration selects synthetic, shared
  browser, app-owned browser, or app-owned native through resolver inputs only;
- verified provider configuration without a matching client-build receipt
  keeps local development on shared browser auth and reports rebuild as the
  next action;
- a selected native Adapter that returns cancellation, timeout,
  `invalid_client`, or token refusal reports that result without starting a
  shared browser flow;
- two apps using the same shared provider receive distinct app-scoped rehearsal
  identities;
- an owner-authenticated preview expires, refuses its 101st user, and cannot
  outlive its rehearsal authority;
- staging and production refuse incomplete app-owned configuration, shared
  credential selection, and any remaining rehearsal identity; and
- switching to an app-owned installation signs out rehearsal custody and
  neither reinterprets nor auto-links the old provider identity.

## Open questions

- **Credential ownership — ANSWERED 2026-08-02, amended 2026-08-21:** Option D
  is the production path. Shared credentials are the default for local
  development and expiring owner-authenticated previews, capped at 100 users.
  They issue only app-scoped rehearsal identities. The resolver selects native
  auth only after provider configuration and the client build both verify, and
  runtime failures never fall back. The production provider installation
  remains app-owned.
- **SMS tier placement — ANSWERED 2026-08-02:** tier 2, supported with vendor
  configuration; promotion requires a named delivery-vendor owner.
- **Generated-domain passkeys — RULED 2026-08-08 (Charlie, wave-4 kickoff):
  preview-only exception**, not production tier 1. Promotion to production
  tier-1-with-disclosure is conditioned on both (a) **ROR verified** across
  target browsers and the iOS/Android platform-association mechanisms, and
  (b) a **named owner** for the indefinite generated-origin serving
  obligation (`/.well-known/webauthn` must keep resolving for as long as any
  credential registered against that RP id exists — including for apps that
  have since moved to their own domain).

  Rationale: Related Origin Requests is the *only* continuity mechanism
  generated-domain passkeys have, and ROR behaviour is itself an unverified
  open question below. A production tier-1 claim would assert a continuity
  story that has not been demonstrated. The ruling costs little today
  because §Passkeys already holds passkeys to *additional-next-to-a-
  recoverable-mechanism* until ROR verifies — so a generated-domain passkey
  failure is degraded auth, not account loss. The tether only becomes
  load-bearing when passkeys graduate to recommended default, and that
  graduation is gated on the same ROR verification. Ruling tier 1 now would
  spend that decision early, without evidence, in the direction that is
  harder to reverse.

  This resolves the Fable/Codex split by making it evidence-gated rather
  than a standing bet: Fable's position becomes available on ROR
  verification; Codex's forbidden-tether objection is honoured until then.
- **Expo as OIDC provider**: who on the Expo side owns shipping a
  standards-compliant OIDC surface (issuer, claims contract, per-app
  registration), clearing the GAP row?
- **The completion-protocol implementing spec**: commissioned by this RFC;
  needs an owner and a number.
- **The lifecycle implementing spec** (round-2 addition, Codex): the
  transition state machine — link/unlink/replace/recovery/deletion proofs,
  reauthentication rules, notification obligations, session consequences,
  failure atomicity, guest-migration checkpoint contract — commissioned
  alongside the completion spec.
- **ROR verification**: confirm Related Origin Requests behavior across
  target browsers and the iOS/Android platform-association mechanisms
  before passkeys graduate from "additional" to "recommended default."
- **Step-up/MFA composition**: no owner; TOTP and SMS-second-factor
  presuppose it.
- **Auth-system secret consumption**: LLP 0036's grant model is
  action-oriented (D8); provider adapters need a specified system-service
  consumption capability for client secrets and signing keys — an 0036
  extension, not a reopening.
- **Email/SMS delivery vendor ownership**: the ephemeral challenge seam is
  pinned, but whether Expo-hosted shared *delivery* (email for generated
  domains, shadow-metered via 0104) is offered is the delivery-side twin
  of the broker question and should be decided with it.

**Deferred 2026-08-03 — author decision sitting #2
(`issues/20260803-author-decision-sitting-2.md`).** The two residual
author questions above are deferred to the **wave-4 kickoff**, with
their context recorded so kickoff finds them: (a) the
**generated-domain passkeys tier** — production tier-1 with disclosure
versus preview-only; the tethered-continuity risk is the crux; (b)
**Expo-hosted shared email/SMS delivery for generated domains**,
shadow-metered via LLP 0104 — decide beside the passkeys question, and
note that the broker rejection (credential-ownership ruling,
2026-08-02) does not automatically extend to delivery. The wave-3
program ticket (`issues/20260803-wave3-program.md`) carries the
matching wave-4 line.

## Dated amendment — 2026-08-24: the default development profile is implemented

The 2026-08-21 amendment made the shared broker the default development path
for first-party providers. This records what landed for it, and — more
importantly — what still does not exist.

### What landed

- **The declaration is the source of provider policy.** `defineAuth` types
  `apple` and `google` declarations with `credentials: 'auto' | 'shared' |
  'app-owned'`. The declaration key *is* the name `auth.signIn({ provider })`
  takes; v1 refuses an alias rather than opening a second namespace the
  resolved entry and the CLI would both have to carry. The generated
  `ApplicationAuthBootstrapV1` projects the declared providers and their
  credential policy and nothing else — no client id, callback secret, signing
  key, or resolved Adapter. The field is *absent* rather than empty when
  nothing is declared, so apps that declare no provider keep their existing
  descriptor bytes.
- **One resolver, one frozen Adapter.**
  `@expo/snapback-client/provider-entry` implements §Resolved provider entry's
  closed selection table, including the two-part native rule and the
  staging/production refusal. `createProviderEntryDispatch` runs exactly the
  resolved Adapter exactly once. The auth-profile generation binds the provider
  installation, the configuration revision, and the build receipt, so switching
  credential ownership rotates it.
- **One stable call.** `auth.signIn({ provider })` joins the existing
  application auth owner. The Adapter runs the provider flow and returns one
  short-lived external completion; the ordinary coordinator redeems it, so
  provider entry adds no second coordinator and no second signed-in state.
  Provider entry therefore requires the explicit external-session seam, and
  `snapback auth enable` writes it alongside the provider block.
- **The completion protocol, split by seam.** The client half (WebCrypto
  verifier, authorization-URL origin validation, callback state checking) is in
  `@expo/snapback-client` and imports nothing from `node:`; the broker half
  (transaction state, admission, exact return allowlisting, one-use codes, the
  100-user cap, app-scoped rehearsal identities) is in `@expo/snapback-cli`.
- **`snapback dev` supervises the broker.** It mounts on the bootstrap origin
  the Expo client already discovers, and its origin plus return targets ride
  the ordinary credential-free exchange. No second terminal, no broker origin
  to configure, no `EXPO_PUBLIC_*` variable. Return targets are *derived* from
  the supervised client port — `exp://<host>:<port>/--/auth/shared` for Expo Go
  and the web origins — which keeps exact allowlisting intact while needing no
  app-owned native build.
- **Setup and status.** `snapback auth enable | configure | status` implements
  §Setup and status. `enable` edits the declaration through a stale-safe
  compare-and-write and refuses to reserialize a hand-written providers block.
  `configure` records public identifiers and secret *references* only, refuses
  a secret value, and emits the deterministic console walkthrough with the
  app's own bundle identifier, scheme, and return URL filled in. Once — and
  only once — a provider's app-owned configuration is complete, `configure`
  also adds that provider's Expo config plugin to `app.json` through the same
  stale-safe compare-and-write, and names the `npx expo install` and rebuild
  that finish the native half. A module app config (`app.config.ts` and its
  `.js`/`.mjs`/`.cjs` spellings) is code rather than data, so it is never
  rewritten; the exact `expo.plugins` edit is named in `next` instead, and the
  native steps stay owed either way. An app on the shared development profile is a
  browser flow, so nothing native is added to it. `status` resolves with the
  same resolver the client uses.

### What is deliberately not claimed

- **The shared development identities are hermetic rehearsal identities**
  issued by the local supervisor. Nothing in the flow contacts Apple or Google.
  The issuer names its own provenance (`snapback-shared-development.invalid/…`)
  so no downstream consumer can mistake it for `accounts.google.com` or
  `appleid.apple.com`. This is a working development sign-in with no provider
  setup — not a provider login.
- **Snapback-owned provider registrations and a hosted public callback remain
  separate product work.** Option D's production path is unchanged, and
  `auth.first-party-social-providers` stays a design-only capability row.
- **App-owned native provider auth is wired but unproven.** `configure` records
  the configuration and adds the native integration's config plugin; the
  resolver will select `app-owned-native` when both halves verify. Adding the
  plugin is a source edit, not evidence — it neither installs the dependency
  nor produces a build, and the CLI still observes no installed build. No
  signed build carrying
  `expo-apple-authentication` or
  `@react-native-google-signin/google-signin` has been produced or exercised,
  and the CLI never claims native readiness because it cannot observe an
  installed build.
- **Native durable custody is unchanged.** Rehearsal sign-in does not make
  native custody durable; the templates' existing
  `SNAPBACK_AUTH_BOOTSTRAP_PLATFORM_UNSUPPORTED` refusal stands.

### One scoped divergence from §Setup and status

That section says configuration writes "public client ids and secret values
into LLP 0036 deployment state". What landed writes **public identifiers only**
into a tracked, credential-free `snapback/auth-providers.json`
(`snapback.app-owned-auth-providers.v1`), and names the LLP 0036 config entries
for the secrets — `configure` prints the exact
`snapback config set --entry <name> --value-stdin` command and never accepts a
value. The split is deliberate: public identifiers belong to the app and want
to be reviewable and diffable in the repository, while secrets belong to
deployment state and must never be diffable. The file refuses to be read past
if a literal secret ever appears in it. Whether the public half should later
move into LLP 0036 entries as well is an open question, not a decided one.
