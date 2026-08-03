# LLP 0150: Agent token acquisition

**Type:** RFC
**Status:** Draft
**Systems:** Auth, Security, Agent tooling, Developer experience, API,
Client integration, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-01
**Revised:** 2026-08-02 (decision-sitting propagation: OQ2 is answered with
the exclusive credential-kind model — one agent principal has one live
credential kind at a time, and a kind change supersedes the prior kind;
source: `issues/20260802-author-decision-packet.md`). 2026-08-02 (v0.5, final round-4 super-refine dispositions —
final round by announcement; Fable READY (second consecutive), Codex NOT
READY; the asymmetric-stop rule met and honored, loop concluded. Both
families converged blind a third time (foreign-predecessor injection =
Fable G1 = Codex M) and both recommended applying fixes without a further
round. All applied: escalation mint validates the predecessor is live,
delegated, and bound to the requesting thumbprint; delegation silent
minting is a versioned current-grant state machine (tier-0-eligible
projection of a versioned immutable template; atomic revoke-and-replace
on projection change — closes the raised-scope silent mint and the
widening-vs-immutable-grant dead end); journal dedupe markers are
retained through grant terminality with only the inbox projection
sweepable; delegation creation gets its protocol surface (creation
ceremony carries template/expiry/TTL into digest v2; lifecycle routes in
§7 item 11; `createdBy` reserved, always = grantingUser in v1;
creation-time admission enumerated); invariant 1 narrowed to durable
*bearer* secrets with the private key and `sbagi_` invitation
acknowledged; reservation release covers all terminal non-approval
outcomes; operator-invitation approver rule stated; OQ8 gains the tier-2
TTL and delegation-lifetime parameters.)
2026-08-02 (v0.4, round-3 super-refine dispositions — split
verdict on v0.3: Fable READY (1 MATERIAL + 6 DETAIL), Codex NOT READY (1
BLOCKING + 4 MATERIAL); both families converged blind on the invitation
defect. All applied: the `invited` lane is a reservation state machine
(mint reserves one live invitation, approval consumes, denial/expiry
releases) with its budget named; ownership binds per mode as an explicit
0055 displacement (approver-as-owner under `open`, inviter-as-owner with
approver=inviter under `invited`, operator invitations unowned);
first-use journaling is per-scope, pre-handler, first-*attempted*-use
(actions cannot share a post-success transaction); digest v2 gains mode,
invitation identity, and the delegation id + versioned policy digest;
delegation lifecycle completed (tier-0 expiry formula, subject-removal
revokes the credential's lineage, `createdBy` is audit-only, ceremony
count corrected); the Expo overlay is gated on a 0106-lineage
identity-mapping amendment and does not exist until it lands; coalescing
is upward (one template grant per credential); autonomous-predecessor
escalation requests refuse at mint; the two remaining absolutes narrowed
(durable authority secrets; 0077 as wire/replay model); OQ8 names the
open numeric parameters.)
2026-08-02 (v0.3, round-2 super-refine dispositions — both
families NOT READY on v0.2, every new finding in v0.2-introduced surface;
all applied. `revoke-self` is proof-bound (a bare public key authorizes
nothing); the supersede expiry clamp is unconditional and the CAS is
approver-bound and thumbprint-bound (rotation terminally invalidates
pending requests — no stranded successors); `invited` mode consumes only
creation invitations (pairing codes never create principals) with
same-commit mode revalidation; the agent profile is named an
extractable-key profile that does not claim 0077's custody; digest v2's
canonical field set is pinned; the delegation record contract, granting
user, credential-id subject entries, and mint-time tier re-evaluation are
pinned; journal transactions are exactly-once by `(grantId, eventKind)`;
the Expo overlay projects only the mapped host user's inbox; §7 is
reorganized by owner with the revocation-semantics admission; the `open`
starvation residual is named and accepted.)
2026-08-01 (v0.2, round-1 super-refine dispositions — both
families NOT READY on v0.1; all findings applied. The first-contact path now
pins what approval creates (an owned 0055 principal; the policy knob is
`auth.agents.mode`, not a second knob); the standing-delegation subject is
an owner-accreted key list, and v1 delegations are query-tier only; inbox
routing is pinned (unbound requests are invisible until their capability is
presented); the key-bound token optimization is corrected to preserve
proof-of-possession on every use; the agent sender-profile is honestly
recast as a commissioned LLP 0077 extension, not existing machinery; the
supersede transaction gains expiry, race, no-resurrection, and
tier-ratchet rules and names its live-state destruction cost; escalation
consent is restated at `{fn, kind}` grammar honesty; `SNAPBACK_AUTH_GRANT_SCOPE_DENIED`
replaces a minted code name; dev auto-approval requires the 0055
impersonation capability; hosted targets inherit 0055's wholesale refusal;
§Named amendments and §Acceptance sketch added.)
2026-08-01 (author decisions batch — see §Author decisions:
first-contact policy is app-configurable with allow-under-strict-caps as the
default; escalation supersedes rather than stacks; apps may raise but never
lower ceremony tiers; notification is journal + inbox with optional outbox
push. OQ2 (credential-kind coexistence) and OQ7 (flow consolidation) are
deliberately left open for the review loop.)
**Related:** LLP 0055 (agent principals and scoped grants — the token and
grant model this RFC acquires *into*), LLP 0077 (sender-constrained auth —
the wire/replay model this RFC extends to agent principals under a
deliberately weaker custody profile), LLP 0106
(agent-native account bootstrap — the flow pattern; explicitly *not* the
authority), LLP 0149 (agent application consumption — proposes the
grant-request compiler this RFC consumes), LLP 0053 (authorization
invalidation), LLP 0045 (notifications outbox), LLP 0057 (auth provider
protocol), LLP 0062 (generated app CLI), LLP 0146 (agentic authoring
affordances), LLP 0031 (route taxonomy), LLP 0072 / LLP 0098 (control
plane and hosted edge)

## Summary

Getting an agent authorized against a Snapback app today — and against
almost every service on the internet — ends in a ceremony the human should
never have to perform: log in somewhere, navigate to a settings page, choose
scopes from a checkbox grid by reading documentation, copy a secret, paste
it into a dotfile, and tell the agent "done." Every step of that is either
mechanizable or a security liability, and most steps are both.

This RFC specifies the acquisition path for LLP 0055's grants and tokens so
that the ceremony collapses to its irreducible core: **the human
authenticates and vetoes; everything else is machine work.** Five invariants
govern the design:

1. **Durable bearer authority secrets never transit the human — and in
   the preferred path never exist at all.** A flow in which a person
   sees, copies, or pastes credential or token bytes is a design defect,
   not an inconvenience. The agent generates a keypair locally and asks
   the host to bind a grant to its public key, so there is no durable
   bearer secret to deliver in either direction — the private key is
   durable and secret, but not a bearer artifact: it never transits and
   is never presented, only proven. Two acknowledged exceptions:
   ephemeral *ceremony* capabilities (the approval URI and user code)
   transit the human and carry LLP 0106's acknowledged-bearer-capability
   treatment, granting only the ability to see and decide one request;
   and the `invited` lane's creation invitation (`sbagi_`) is a durable
   ceremony secret inherited from 0055, carried by the human as the
   stated price of that stricter posture.
2. **The agent declares the exact capability set; the human only vetoes.**
   Scope selection is computed (the grant-request compiler LLP 0149 F6
   proposes — see §Authorities for its status), not chosen by a person
   reading docs. The consent surface renders the compiled request in plain
   language and offers approve/deny — never checkboxes.
3. **Ceremony weight is a function of requested authority.** Only reads may
   ever become silent, and only under a standing delegation whose subject
   the owner explicitly accreted; ordinary writes are one click;
   authority-creating scopes require step-up authentication and typed
   confirmation. The ladder is pinned per scope class, not configurable
   into oblivion.
4. **Escalation happens at denial time, about the concrete operation.**
   Insufficient authority is not a dead end; the refusal carries a
   pre-compiled escalation request naming the blocked operation's missing
   scope, so the human approves the specific authority that was missing
   rather than predicting scopes upfront.
5. **The Snapback host is the sovereign authority.** Not every Snapback
   instance is connected to Expo servers, so the mint, the consent surface,
   and the policy store live on the host itself. LLP 0106's account layer
   is an optional read-only overlay for enrolled instances (§6), never a
   dependency and never an authorization input.

This RFC creates no new token model. It is an acquisition-and-consent front
end onto LLP 0055's grants, credentials, and scoped tokens; where it needs
surface 0055 and 0077 do not have, it names the delta in §Named amendments
rather than absorbing it silently.

## Motivation

Two forces meet here.

First, Snapback wants applications to be consumable by agents as easily as
by humans (LLP 0149). The consumption loop — discover, preflight,
authorize, execute, reconcile — has exactly one step that structurally
requires a human, and that step today is the worst part of the experience.
An agent that can compile a least-authority plan but must then dictate a
settings-page scavenger hunt to its operator has wasted the entire benefit.

Second, the existing consent entry path in LLP 0055 — the user-minted
pairing code — was designed for a different initiation direction. It is
correct and is retained in this draft (it structurally eliminates
unsolicited requests and the handle-enumeration oracle; whether it remains
long-term is OQ7), but it presumes the *human* starts the interaction and
hands a secret to the agent. The common agentic case is the reverse: the
agent discovers mid-task that it needs authority and must hand the human
something. Making that direction first-class, without reintroducing the
oracles 0055 dissolved, is the design problem.

## Authorities, prior work, and the boundary this RFC keeps

| Authority | What it owns | What this RFC does with it |
| --- | --- | --- |
| LLP 0055 | Agent principals (registration modes, ownership, provenance), credentials (`sbac_`), scoped tokens (`sbagt_`), grants, scopes, consent digest, caps, revocation, the pairing-code flow — specified, in Review | Acquires into this model; every delta is named in §Named amendments |
| LLP 0077 | Sender-constrained auth for **browser session families**: the server-side wire/storage contract is pinned, with a defect ledger gating positive capability claims and a browser-only client custody schema; its §Credential classes requires an equivalent non-exportable facility before another client claims the profile | This RFC **commissions a deliberately weaker extractable-key agent profile** (§1): it reuses the wire/replay design — not the custody profile, and not an existing implementation |
| LLP 0106 | Device-flow UX and polling semantics for account bootstrap; standing-delegation and agent-installation vocabulary; the acknowledged-bearer treatment of approval links | Borrows the flow shape and vocabulary; rejects the account layer as authority (invariant 5) |
| LLP 0149 | Research findings: F1 (effective actionability / preflight), F6 (**proposes** a grant-request compiler — not yet built) | Consumes the compiler's *output shape* as the request payload; this RFC is a forcing function for building it, not a consumer of an existing tool |
| LLP 0053 | Revocation propagation, dispositions (including the grant-scoped `delete` disposition recorded for 0055), the rollback-checked authorization clock | Inherited through 0055 unchanged; note v1 service principals are online-only clients, so no offline-lease surface is in play |

## Design

### 1. Key-bound grants: the client mints its own credential

The preferred credential path inverts the delivery direction entirely.
Instead of the server minting a secret and transmitting it:

1. The agent generates an asymmetric keypair locally. The JWK thumbprint is
   the credential identity — LLP 0106 already defines an agent installation
   this way.
2. The grant request (§2) carries the public key **and a proof of
   possession over a server-issued challenge nonce** — the server creates
   no request state for a key whose private half the requester has not
   demonstrated.
3. Approval binds the grant to the thumbprint. No **durable authority
   secret** is created server-side or transmitted in either direction,
   ever. (The short-lived key-bound access token of step 4 does transit —
   it is inert without the key, and its sensitivity classification is part
   of OQ3; the ceremony capabilities of §2 are covered by invariant 1's
   acknowledgement.)
4. Every authenticated use — token mint, invocation, poll, rotation, and
   family destruction (`revoke-self`) — carries a per-request proof in the
   0077 shape (signed over method, URI,
   nonce, time, replay id, and the bound token's hash where one is
   presented). **A short-lived key-bound access token reduces server-side
   lookup and grant-resolution cost; it never replaces signature
   verification.** A token presented without its accompanying proof is
   refused — anything less would be a bearer with a decorative thumbprint
   field, which is precisely the class this design exists to eliminate.

**The agent sender-profile is new surface, commissioned here.** LLP 0077's
§Credential classes covers browser session families and requires an
equivalent non-exportable key facility before any other client claims the
profile. The extension this RFC commissions (as a named LLP 0077 amendment)
must pin: supported algorithms and canonical public-key encoding; the
challenge/proof exchange that precedes request creation; exact proof
claims and URI canonicalization; the replay namespace, retention, and caps
for agent proofs (0077's epoch machinery is the model); and — new for
CLI/daemon agents, which browsers do not have — cross-process custody:
either single-custodian serialization of the nonce chain or the bounded
concurrent-flight allowance 0077 defines for WebSocket opens, chosen
explicitly. Polling is proof-bound like every other use: a request id alone
is status-capability enough to learn "pending," but terminal outcomes and
the `grantId` release only under a proof from the requesting key.

**Key custody (owned here, and deliberately weaker than 0077's).**
0077's browser profile requires non-exportable custody, and its
§Credential classes conditions any profile claim on an equivalent
facility. Agent processes cannot universally provide one, so this RFC
defines an **extractable-key agent profile**: it reuses 0077's wire and
replay design and explicitly does **not** claim 0077's custody profile.
The floor: per-agent keys (never per-machine — co-resident agents are
separate principals); a platform non-exportable facility (keychain,
secure enclave) where one exists; else a file readable only by the owning
user (0600) under the agent's own configuration directory — the weaker
fallback named as such, not laundered through 0077's name. A compromised
agent host still loses everything; custody narrows leak channels (logs,
transcripts, committed dotfiles — the dominant real-world class), it does
not make the filesystem trustworthy.

**Rotation is not recovery — the 0055 split carries over.**

- **Self-rotation**: a live key authorizes its replacement in one CAS under
  a proof from the *old* key — grants preserved, no ceremony, credential id
  stable, generation bumped, the 0055 rotation throttle and tombstoned
  thumbprint family retained. For `revoke-self`, a **proof under any
  tombstoned-family key** stands where 0055's presented secret stands —
  the bare thumbprint, being public data (it appears on every consent
  page), authorizes nothing. Rotation **terminally invalidates the
  agent's pending grant requests** — a request is bound to the exact
  thumbprint that minted it, and its approval CAS refuses a rotated-away
  key (§3), so an approved successor can never be stranded behind a key
  that can no longer poll; the agent re-derives under the new key.
  Rotation answers *suspected* theft; note honestly that a thief holding
  the live key can rotate too, which is why the family-wide destroy-only
  `revoke-self` and the owner path exist.
- **Key loss or a credential-kind switch after loss** is **owner
  re-credentialing** in 0055's full sense: step-up, every grant terminally
  revoked, delegators re-consent. A lost key cannot cheaply re-bind
  precisely because a stolen one must not be able to.

Why key-binding is strictly better than bearer delivery: no transit means
no interception — there is no moment at which a durable secret crosses the
network, a screen, or a clipboard; theft requires key exfiltration, and
stolen tokens or logged requests are inert; and the credential can be
rolled locally without ceremony. Costs, stated honestly: per-request
signature verification (bounded, not eliminated, by the token's lookup
optimization); replay protection is mandatory (designed in 0077, extended
here, not free); and the compromised-host limit above.

**Relationship to 0055's `sbac_` credential.** The key-bound class is a
parallel credential kind under the same identity, generation, and fencing
model — `(credentialId, credentialGeneration)` stays unambiguous, with the
thumbprint family playing the role of the secret hash. The 2026-08-02 answer
to OQ2 is exclusive: one agent principal has one live credential kind at a
time, and a kind change supersedes the prior kind. The
secret-based `sbac_` path remains for clients that cannot hold a key; it
becomes the documented fallback, not the default. A middle option — the
client mints a random secret and enrolls only its *hash*, so nothing
transits server→client — is recorded and rejected as the default: it fixes
delivery but remains a bearer on every request, which is the weaker half of
the problem.

### 2. The approval-link flow: agent-initiated consent without the oracle

The second consent entry path, alongside 0055's pairing code:

1. **Request.** After the challenge/proof exchange (§1), the agent calls
   the grant-request route with: its public key (or existing credential),
   the compiled scope set (concrete `{fn, kind}` records wherever
   expressible, requested TTL, and the explicit list of facts the compiler
   could not infer), and its self-declared identity/provenance metadata.
   Requests name **no user** — there is no handle namespace and therefore
   no user-enumeration oracle, which is the specific seam that killed the
   round-3 agent-initiated flow in 0055. (The non-enumeration claim is
   scoped to user handles; the acceptance sketch (§8) carries the request-id
   and poll non-enumeration rows.)
2. **Capability out.** The host returns a verification URI and a short
   user code. Following LLP 0106, the URI is an acknowledged bearer
   capability: it grants the ability to *see and decide* the request, not
   any authority itself. The agent presents URI and code to the human
   (terminal print, or opens a browser when one is local).
3. **Consent.** The human opens the URI, authenticates through the app's
   ordinary auth (LLP 0057 provider protocol — the host's own served
   surface renders this page; no Expo dependency), confirms the user code
   matches what the agent displayed, and reviews the rendered request.
   **Approval binds the approving user as the grant's effective user.**
4. **Poll.** The agent polls with the request id under 0055's existing
   semantics: `SNAPBACK_AUTH_GRANT_PENDING` while pending; approval
   releases the `grantId` under a proof from the requesting key (§1) — and
   for the key-bound class *only* the grant id; there is no token to
   deliver. Denial, expiry, and foreign ids are the single non-enumerating
   `SNAPBACK_AUTH_GRANT_INVALID`. The agent then writes whatever local
   configuration it needs itself. The human is never asked to save
   anything.

**First-contact policy is `auth.agents.mode` — not a second knob.** 0055
already owns the policy for principal creation
(`disabled | invited | open`, default `disabled`), and an unknown key's
grant request is a principal-creation act, so this RFC adds no parallel
policy surface:

- mode `open` — an unknown key may mint a request (under the stricter caps
  below); this is the one-step cold start.
- mode `invited` — an unknown key's request rides a live **creation
  invitation** (`sbagi_`), minted under 0055's `auth.agents.invitedBy`
  policy exactly as for direct registration, through a **reservation
  state machine**: minting the request atomically **reserves** exactly
  one live invitation (CAS — one live invitation binds at most one
  pending request, which is also the `invited` lane's pending budget:
  bounded by 0055's ten live invitations per minting user); **approval
  consumes** the reserved invitation in the creation transaction; denial,
  expiry, and every other terminal non-approval outcome (rotation
  invalidation included) **release** the reservation, leaving the
  invitation live to its own TTL — so an unapproved request still leaves
  no state anyone must clean up. A pairing code is grant consent for an existing agent,
  **not** principal-creation authority, and never substitutes for an
  invitation — anything else would bypass `invitedBy` (a user-minted
  pairing code creating a principal where the app chose operator-only
  invitations).
- mode `disabled` — the request route serves existing credentials only.

The creation transaction **revalidates the current mode and invitation
state in the same commit**: a request minted under `open` does not survive
an `open → disabled` (or `→ invited`) change, and an `invited` approval
consumes only its reserved, still-live invitation — either mismatch
refuses with the non-enumerating code.

The author's product position is that agent-consumable apps should ship
with `open` plus the approval link — that is the painless path this RFC
exists for — while 0055's platform default remains `disabled` and its text
calls `open` a bounded-abuse posture. Reconciling the *default* for
agent-first apps (a template or app-declared posture, not a platform
default flip) is part of the named 0055 amendment (§7). Refusals under a
stricter mode are the single non-enumerating typed error with no
retry-after leak.

**What approval of a first-contact request creates.** In one atomic
transaction (a named 0055 amendment — a fourth registration path,
`approvalLink`, alongside register/invitation/recovery): the agent
principal (`kind: "agent"`), its identity row, the key-bound credential,
and the approved grant. Ownership binds per mode — and this is an
**explicit, justified displacement of 0055's ownership rules**, named in
§7: under `open`, **the approving user becomes the owner** (0055 makes
bare `open` self-registration unowned, with the prod-unrecoverable
residual that entails; approvalLink differs precisely in having an
authenticated human performing consent, so leaving the principal
ownerless would recreate that residual for no reason). Under `invited`
with a user-minted invitation, 0055's rule stands — **the invitation
creator is the owner** — and the approver must *be* the invitation
creator (mismatch refuses non-enumerating): the capability URI must not
let a stranger's approval seat ownership authority on the inviter, or
vice versa. Operator-minted invitations (dev/test/demo only, per 0055's
gating) create unowned principals exactly as 0055 says; any
authenticated user may approve such a request, becoming its effective
user, and the principal lands unowned. In every case
0055's owner-assumption disclosure renders at consent — the
owner-to-be is told what ownership powers they are taking on.
`registration_provenance` records `approvalLink` plus the invitation
class and creator where one was consumed, plus the request's
self-declared metadata, **marked unverified**. There is no
principal-less grant and no bypass: a deployment whose mode forbids
principal creation cannot reach this transaction.

**Consent display and digest.** The consent page renders: the agent's
self-declared identity and provenance **visually marked as unverified
claims** (0055 is explicit that declared names are not attestation — a
request labeled "Codex" proves nothing, and the page must not lend it the
host's authority); the key thumbprint; the concrete scope records with
`authorityCreating` scopes flagged; requested expiry; the compiler's
stated unknowns; the ceremony tier and any app tier override; for
escalations, the predecessor and the full union (§3); and the
owner-assumption disclosure where applicable. The digest is **versioned**
(v2, named amendment) and canonical over exactly: app/deployment
identity; manifest generation and tier-policy generation; the effective
`auth.agents.mode` and, for `invited` requests, the reserved invitation's
identity, class, and creator (and therefore the resulting owner); the
initiation discriminator; the agent principal (or the `approvalLink`
creation marker), credential generation, and key thumbprint; the
effective user; the scope records; expiry; ceremony tier and any app
override; the compiler unknowns; the predecessor grant id and full union
for escalations; and, where a delegation admission is offered, the
**delegation id and its versioned policy digest** (template, expiry,
`maxGrantTTL`, granting user) — a bare yes/no admission bit would let
two differently-scoped delegations render identically.
The approval transaction recomputes and compares in the same commit —
a mismatch (a manifest, tier-policy, mode, or request change since
display) refuses with the non-enumerating code. What was approved is what
was minted, bitwise.

**Inbox routing — an unbound request is invisible until its capability is
presented.** The approvals inbox on the host's served surface lists, for
the authenticated viewer: requests they have previously opened via the
capability URI (an explicit import act — entering the URI or user code
*into* the inbox is equivalent to following it), escalation requests
naming a predecessor grant they issued, and pairing-seeded requests bound
to them. It never lists unbound pending first-contact requests — a
userless request has no inbox to appear in until a user brings its
capability, so the default-`open` posture creates **no** broadcast
consent-fatigue queue and no unsolicited-contact channel, and "an
unapproved request creates no state any user must clean up" stays true
literally. (A dev/test-profile operator diagnostic view of pending
requests may exist behind the admin surface; it is an operations listing,
visually distinct, and not a consent surface.) The inbox remains the
trust-anchored path: a cautious operator can ignore a printed URL and type
the short code into the inbox they navigated to themselves.

**Abuse bounds, keyed honestly — and the residual named.** For
credentialed requesters, caps and throttles key on the credential (0055's
pending cap of 10 applies). For unknown keys: a per-effective-source-IP
throttle (with 0055's stated honest limit that on a local box every
source is loopback), one pending request per key, byte caps on request
metadata and compiler-unknown text, a **global per-app ceiling on
unauthenticated pending requests**, and short TTL (10 minutes, matching
pairing codes) with GC on expiry. The challenge nonces that precede
requests (§1) are stateless — self-authenticating in 0077's epochal
shape — or counted under the same global ceiling, so the flood cannot
simply move one route earlier. What these bounds buy is bounded storage
and bounded work, **not Sybil resistance**: keypairs and signatures are
nearly free, so a determined flood can keep the unauthenticated pool full
and starve legitimate first contact. That residual is **accepted** for
`open` — which 0055 already documents as bounded-abuse posture — because
the flood cannot touch the other lanes' budgets: credentialed requests
key on the credential, `invited` requests are bounded by reserved
invitations (one pending per live invitation, ten live per minting
user), and pairing-seeded requests ride 0055's pairing caps — none draw
from the unauthenticated pool. A deployment that cannot accept the
residual runs `invited`. Exact numeric values here (throttle rates, byte
caps, the global ceiling) are open implementation parameters — OQ8, not
silently-assumed constants.

### 3. Escalation at the point of denial

When an invocation fails at the **pre-handler scope gate** — the static
missing-scope refusal `SNAPBACK_AUTH_GRANT_SCOPE_DENIED` (today its
details carry only `reason: missing_scope`; the §7 amendment adds the
exact missing-scope descriptor) — the refusal additionally
carries an **escalation descriptor**: the refused function's identity and
the minimal additional `{fn, kind}` scope records that would cover it,
derived only from static manifest facts (function id, kind, declared
capability requirements, `authorityCreating` status). Data-dependent
denials (`SNAPBACK_AUTH_PERMISSION_DENIED`, RLS refusals) carry **no**
descriptor — a descriptor there would leak authorization state, and no
static fact can honestly say what grant would change the outcome.

The agent converts the descriptor into a grant request (§2) with one call
(the mint — which reads the predecessor row — refuses with the
non-enumerating code unless the named predecessor is **live, delegated,
and bound to the requesting credential's generation and thumbprint**: a
foreign or stale grant id cannot plant a victim-visible escalation in
anyone's inbox, an autonomous predecessor cannot create a request with
no inbox to route to, and §3's path stays delegated-only end to end;
the approval CAS re-validates the same facts against races).
**The consent page tells the truth at the grammar's altitude**: 0055's
narrowest grant unit is `{fn, kind}`, so approving an escalation for
`deleteTable` grants the *function* — any arguments — and the page says
so ("may call `deleteTable` (mutation) — this covers all its uses, not
only the blocked call"). Argument values never appear in descriptors
(they are data, not manifest facts) and no argument-level narrowing is
claimed or implied. Resource-scoped consent becomes possible only if
0055's grant vocabulary grows selectors (LLP 0149 F6's condition), and is
out of scope here.

Because 0055 grants are immutable, escalation mints a **new grant**, and
**approval supersedes** (decided — §Author decisions): the consent
transaction atomically revokes the predecessor and mints the union of
scopes. Stacking was considered and rejected: a simpler mint, but it
pushes grant-family reasoning onto every audit, display, and revocation
surface forever. The supersede transaction's rules, pinned:

- **Predecessor-live, approver-bound CAS.** The transaction validates in
  the same commit that the predecessor is live (not revoked, not expired,
  recovery generation unchanged) and **bound to the exact requesting
  credential generation and thumbprint** — a rotation between request and
  approval terminally invalidates the request (§1), so an approved
  successor is never stranded behind a key that can no longer poll — and
  that **the approver is the predecessor's effective user**: an
  escalation modifies one user's existing consent, and no other user may
  approve it (mismatch refuses with the non-enumerating code; approval is
  not a cross-user revocation primitive). Autonomous predecessors
  (`effective_user_id` null) are outside the §3 path entirely — their
  authority changes through the channel that created them (the template
  or `auth.mintAgentGrant`). A predecessor that died first — including by
  the user revoking it mid-ceremony — makes the escalation request
  terminally invalid (`SNAPBACK_AUTH_GRANT_INVALID`). **Approval never
  resurrects revoked authority.**
- **Single lineage, no siblings.** A pending escalation whose predecessor
  is superseded by another approval is terminally invalidated, same
  non-enumerating code; the agent re-derives against the successor. No
  rebase in v1.
- **Expiry never extends — unconditionally.** The successor's expiry is
  `min(requested, predecessor's remaining)`, always. Extension is a
  **renewal**, which 0055 already defines as a fresh consent, never a
  side effect of escalation — so no increment, at any tier, prolongs
  existing authority.
- **Ceremony tier is the union's tier.** If the union contains a tier-2
  scope, approval is tier 2 — the ratchet direction. Tier-by-increment
  would launder step-up-consented scopes through one-click ceremonies.
- **Caps account net.** Revoke-and-mint is net-zero against 0055's live
  grant caps in the same transaction; an escalation cannot fail the cap it
  does not raise.
- **Retry is idempotent in effect.** A commit-uncertain approver retry
  yields the same successor (0055's CAS-and-return-immutable-grant
  pattern).
- **Delegation lineage survives supersession.** A successor whose
  predecessor was minted under a standing delegation records that lineage,
  and **revoking the delegation revokes the successors in its lineage**
  — the owner's "revoke the delegation, kill what it enabled" mental model
  stays true through escalation chains.

**The destruction cost, named.** Under 0055/0053, revoking the predecessor
projects pending-revoked with **delete** disposition onto the agent's
affected connections and client state, and queued work settling against
the durable axis fails settlement. Mid-task escalation — this RFC's
motivating scenario — therefore costs the agent its live subscriptions and
predecessor-fenced queued work at the moment of approval; the agent
re-subscribes and re-derives under the successor. That is the honest price
of one-lineage legibility, accepted for v1; a successor-handover
(re-fencing live state to the successor without the delete round-trip) is
named future work requiring its own 0055/0053 amendment, not assumed.

What supersession buys is one legible **lineage**: the current authority of
an escalation chain is always exactly one grant. (0055 permits an agent
multiple live grants across separate consents; supersession does not
change that — it prevents *escalation* from being the thing that
multiplies them.)

### 4. The ceremony ladder and standing delegations

Consent weight is pinned per scope class:

| Tier | Applies to | Ceremony |
| --- | --- | --- |
| 0 — silent | **Query-tier scopes only**, requested by a key in a standing delegation's subject set, matching its template | None. Grant minted immediately; journaled and inbox-listed (below), pushed where a channel exists |
| 1 — one click | Reads outside any delegation; ordinary writes (always — writes are never silent) | Authenticated approval page, single approve action |
| 2 — step-up | `authorityCreating` scopes, action scopes, permission-backing writes (the LLP 0053/0055 two-gate class), creating or **template-widening** delegations (subject admission is governed by §4's explicit-act rule), and anything the app marks elevated | Fresh authentication (re-auth or second factor where the provider supports it) **plus** typed confirmation (the app or agent name), short mandatory TTL, notify-on-first-use |

**Apps may raise tiers, never lower them** (decided — §Author decisions).
The host-pinned map is a floor: an app's manifest may mark specific
functions or scope classes as requiring a higher tier than the host default
(e.g. an ordinary mutation like `sendInvoice` marked step-up), and the
consent surface honors the maximum of the two. No app declaration can move
a scope below the host floor, and the tier-2 pins are not overridable in
either direction. How the marker is declared belongs to the authoring
surface (LLP 0146's manifest lineage); this RFC pins only the raise-only
semantics. (The tier roster itself extends 0055's approval-route contract,
which today requires step-up only for `authorityCreating` — a named
amendment, §7.)

**A standing delegation's subject is an owner-accreted key list — never a
self-asserted machine identity.** Request metadata is requester-supplied,
and 0055 is explicit that declared provenance is not attestation; a
delegation whose subject were "keys claiming to be from my laptop" would
hand silent grants to any remote key willing to lie. So the subject is
mechanical. A delegation is a policy record owned by the **granting
user** — the human whose effective authority it delegates, deliberately
distinct from 0055's agent `owner_user_id`, which names who controls a
principal: `{grantingUser, createdBy, subject: [credential ids],
template (query-tier scope records), delegationExpiry, maxGrantTTL}`.
`createdBy` is **audit provenance only** and in v1 always equals
`grantingUser` — the field is reserved (§5's impersonation path
auto-approves tiers 0–1 only while delegation creation is tier 2, so no
v1 path diverges); no path creates a delegation of another user's
authority. A tier-0 grant's expiry is
`min(requested TTL, maxGrantTTL, delegation remaining, 0055's delegated
bounds)`. **Removing a credential from the subject set revokes that
credential's delegation-minted lineage** (the per-subject scoping of the
whole-delegation cascade — the owner's "un-admit this key, kill what its
admission enabled" mental model holds) as well as ending future silent
mints.
Subject entries are **credential ids** — stable across self-rotation
(rotation proves continuity under the old key), dropped by
re-credentialing (a new credential is a new admission decision). A
credential enters the subject only by an explicit act of the granting
user, one of three: **at delegation creation** — the tier-2 creation
ceremony, offered on a grant approval's consent page as "create
delegation D from this template and admit this key" (the proposed
template, expiry, and `maxGrantTTL` render there and bind into digest
v2) or performed from the inbox's delegation page — admits the key it
rides on; the first tier-1 approval of a later key's grant request may
offer "also admit to delegation D" as a secondary confirmation; or the
user admits a credential from the delegation's inbox page. **Creating a delegation or
widening its template is tier 2; admitting a credential is an explicit
tier-1 act** — deliberately: admission extends silence to a key whose
grant the user is approving in the same breath, and adds no scope class
the template does not already carry, so tier-2 ceremony here would tax
exactly the painless path delegations exist for while guarding no new
authority class. (The standalone inbox-page admission has no same-breath
grant; it rests on the no-new-scope-class leg alone.) Tier-0 minting is governed by the **eligible-projection state machine**
below: a function the app has since raised above silent eligibility (§4
floor rule) is excluded from what any delegation can mint, template
notwithstanding.

The consequences, stated honestly:

- The painless case, counted honestly: **tier 2 once to create the
  delegation** (a ceremony the first agent's browser round-trip carries,
  admitting that first key with it); **tier 1 once per later
  credential**; **zero per subsequent request**. "Zero human interaction
  for every subsequent agent" is not on offer without self-asserted
  subjects, and self-asserted subjects are indefensible — this is the
  honest floor.
- **v1 delegations cover query-tier scopes only.** Write and action scopes
  can never be delegation-covered (consistent with invariant 3 and the
  ladder: writes are never silent). Widening delegations to write scopes
  is future work contingent on a configured notification channel and its
  own review — not a knob this RFC ships.
- Silent mints follow a **versioned current-grant state machine**. A
  delegation's template is versioned and each version immutable —
  widening mints a new version at tier 2. Per credential there is **one
  current delegation grant**, carrying the **currently tier-0-eligible
  projection** of the current template version: the template minus every
  scope the app has raised above silent eligibility, computed at mint —
  a raised scope is never silently minted, full template
  notwithstanding. When the projection in force differs from the current
  grant's (a new template version, or an app tier raise), the next
  covered request **atomically revokes and replaces** the current grant
  with one carrying the new projection, delegation lineage carried, in
  one commit — never two live delegation grants per credential, and no
  illegal mutation of an immutable grant. A request outside the
  projection is simply not covered and takes the ordinary tier-1 path.
  Tier-0 traffic is therefore bounded against 0055's 50-live-grants caps
  by construction; the cap remains reachable through other consents and
  fails typed (`SNAPBACK_AUTH_GRANT_CAP`, "consent is never silently
  evicted") — the interaction is named, not discovered.

**Notification semantics** (decided — §Author decisions; transaction
rules pinned in v0.3, corrected in v0.4): the journal is keyed
`(grantId, eventKind)` for mint events and `(grantId, scopeRecord,
eventKind)` for first-use — per flagged **scope**, so a union grant with
several tier-2 scopes journals each scope's first use. A tier-0 mint
writes its journal row **in the mint transaction** — journal failure
fails the mint, fail closed. A tier-2 first-use row is a **pre-handler
compare-and-insert: first *attempted* use**, gating dispatch — the row
commits before the handler runs, and a failed journal write refuses the
invocation. Attempted-use (not successful-use) is deliberate: actions
run outside the transactional snapshot path and commit effects through
separate mutations, so no post-success rule can share a transaction with
an action's external effects — journaling before dispatch is the only
boundary that is exactly-once for every operation kind. **Dedupe markers
outlive their inbox rendering**: a first-use marker is retained through
its grant's terminality (plus outbox slack) and is never evicted while
the grant lives — eviction would re-arm "first use" on active
authority. Only the **inbox projection** of journal rows carries the
bounded retention and per-user count caps (oldest swept); sweeping the
projection never touches a marker. Recipient: the grant's effective user,
plus the agent's owner where distinct. Rows render prominently in the
approvals inbox unconditionally (bounded retention, per-user count caps,
oldest swept) — this floor is self-contained, requiring no delivery
infrastructure. Where the host has a configured push channel the same
events are additionally enqueued through LLP 0045's outbox, **idempotent
on the journal key** — named honestly as a dependency on 0045 (Draft,
provider delivery unbuilt) *landing*; nothing in the floor waits on it.
A configured channel is not a precondition for creating a (read-only,
v1) standing delegation; the delegation-creation page states which
posture — journal and inbox only, or journal, inbox, and push — the
owner is getting.

### 5. Terminal and no-browser paths

The flow is RFC 8628-shaped, so the terminal path is the *primary* path,
not a degraded one: print URI + code, poll. Refinements:

- **Loopback completion.** When a browser session exists on the same
  machine, the CLI may open the URI directly and receive completion via a
  localhost callback, skipping code comparison (gcloud-style).
- **Local dev profile.** On dev/test profiles, the host may auto-approve
  tier-0/1 requests — under the authority 0055 already requires for
  operator-created agent authority: `AdminWrite` **plus**
  `ImpersonationCapability` (dev/test/demo only, refused on `prod`), with
  the effective user pinned to the impersonated dev principal and an
  audit record of the auto-approval. A bare `sbat_` bearer is not an
  act-as-user authority and does not become one here. `prod` never
  auto-approves.
- **Headless human.** When no browser can ever reach the host's served
  surface (rare: air-gapped ops), the pairing-code inversion carries the
  flow — with its requirement stated honestly: pairing still needs an
  authenticated human consent surface to mint the code and approve the
  request (0055's session-authenticated routes). Headless means that
  surface is a session-bearing CLI/TUI rather than a browser, not that
  consent evaporates into a code.
- **Hosted targets.** 0055 v1 refuses all agent-management routes
  wholesale on hosted targets; every route this RFC adds (grant-request,
  poll, consent page, inbox) **inherits that refusal**, and un-refusing
  rides the same hosted gates 0055 names — the deployment envelope does
  not widen here.

### 6. The Expo overlay (explicitly optional, and read-only in v1)

For instances enrolled with a control plane (LLP 0072/0098 lineage) or an
Expo account (LLP 0106), the overlay **may** show an account-level view
that projects, for an authenticated account user, **exactly what the
host's approvals inbox would show the host user they map to** — through
an account↔host-user identity mapping that is itself real authorization
surface: LLP 0106 is explicit that accounts and application users are
separate identity planes, and LLP 0031 owns route classification, not
cross-plane identity lifecycle. The mapping therefore **requires its own
identity-owning amendment in the 0106 lineage** (mapping creation under
mutual proof, audience and deployment binding, revocation, stale-link
fail-closed) — and **until that amendment lands there is no overlay**;
the host feature is complete without it. Unbound
first-contact requests project to no one: §2's routing rule carries over,
and the overlay must not become the broadcast queue the host itself
refuses to be. In v1 the overlay is strictly read-only: it never
approves, never asserts consent, and is never a grant-mint or consent
input — the host mints, the host revokes, and an instance that has never
heard of Expo has the complete feature. An account layer that *approves* requests or mirrors delegation
policy across instances would be a federated consent-assertion protocol
(signed decisions, identity mapping, anti-replay, issuer lifecycle,
partition behavior) that neither LLP 0072 nor 0098 provides today; that is
a separate future RFC, deliberately out of scope.

### 7. Named amendments, by owner

This RFC's deltas, consolidated so nothing lands silently.

**Into LLP 0055:**

1. **Key-bound credential kind** — thumbprint families under the existing
   identity/generation/fencing model, tombstoned-family `revoke-self`
   under proof (§1); OQ2 governs coexistence.
2. **`approvalLink` registration path** — the atomic
   principal+credential+grant creation transaction; the invitation
   reservation state machine; the **ownership displacement, stated
   plainly**: approver-as-owner under `open` (0055 makes bare `open`
   registration unowned — approvalLink's authenticated approver justifies
   the difference), inviter-as-owner with approver=inviter under
   `invited`, operator invitations unowned per 0055; unverified-provenance
   recording; same-commit mode/`invitedBy`/invitation revalidation; the
   agent-first-app default posture; and §5's dev auto-approval path for
   delegated requests (a new approval path under `AdminWrite` +
   `ImpersonationCapability`, which today gate autonomous grants only)
   (§2, §5).
3. **Consent digest v2** — the canonical field set and same-commit
   revalidation predicate (§2).
4. **Supersede transaction** — the escalation rules of §3, including
   delegation lineage: **new revocation semantics, stated plainly**
   (supersession revocation and lineage-cascade revocation).
5. **Tier roster** — the ceremony ladder's extension of 0055's
   step-up-iff-`authorityCreating` approval contract (§4).
6. **Standing delegations** — the record contract, subject accretion,
   effective-tier re-evaluation, reuse-coalescing, and lineage
   revocation (§4).
7. **Escalation descriptor** — extending
   `SNAPBACK_AUTH_GRANT_SCOPE_DENIED`'s details (today
   `reason: missing_scope` only) with the exact missing-scope
   descriptor (§3).

**Into LLP 0077:** 8. the extractable-key agent sender-profile (§1) —
algorithms, encodings, proof claims, replay namespace, cross-process
custody, and the explicit custody-delta acknowledgement.

**Into LLP 0146's manifest lineage:** 9. the app tier-raise marker (§4).

**Into LLP 0106's lineage:** 9a. the account↔host-user identity-mapping
amendment §6 requires before any overlay exists — mapping creation under
mutual proof, audience/deployment binding, revocation, stale-link
fail-closed.

**Into LLP 0045:** 10. the journal→outbox producer events and their
journal-key idempotency mapping (§4).

**Into LLP 0031:** 11. registry rows for every new route and identifier —
grant-request, challenge, poll, consent page, the inbox and its
capability-import act, the delegation lifecycle operations (create,
widen/version, admit, remove-subject, revoke), the account-mapping
view — with prefix-namespace registrations and credential-sensitivity
classifications (OQ3 tracks the open decisions).

### 8. Acceptance sketch

The adversarial matrix an implementation must pass, named now so a
plausible implementation cannot substitute for a correct one: unknown /
expired / denied / foreign / cross-user request ids indistinguishable
(`SNAPBACK_AUTH_GRANT_INVALID` uniformly); first-contact without proof
refused with no state created; public-key substitution and request/poll
replay refused (nonce and replay-id consumption); approval racing denial,
revocation, expiry, and supersession (CAS terminal states, no
resurrection, no sibling lineages); commit-uncertain approval retry
returning the identical successor; grant-cap accounting under
revoke-and-mint; unauthenticated request-flood behavior at the per-source
and global ceilings; unverified-metadata rendering (a request claiming a
known agent name displays as unverified); delegation subject accretion
(a key outside the subject set never receives tier-0), lineage revocation
through supersede chains, and read-only template enforcement; manifest and
tier changes between request creation and approval (digest revalidation
refuses); key rotation CAS, lost-key re-bind refusal, rotation terminally
invalidating pending requests (no stranded successor), and multi-process
proof-nonce behavior; token-without-proof refusal on every carrier;
`revoke-self` only under tombstoned-family proof (a bare public key
authorizes nothing); mode and invitation races (a pending `open` request
refused after `open → disabled`; an `invited` approval consuming only a
still-live creation invitation; a pairing code refused as
principal-creation authority); approver-mismatch on escalation approval
(non-enumerating refusal); escalation mint negatives — autonomous,
foreign, and stale predecessors all refused non-enumerating, so no
victim-visible request injection; invitation reservation lifecycle (one live
invitation binds one pending request; denial/expiry releases; approval
consumes; approver≠inviter refused); capability-import routing (an
unbound request lists only for its importer); journal exactly-once under
retry (mint-row in-transaction; per-scope first-*attempted*-use
pre-handler compare-and-insert, including for actions; markers retained
through grant terminality — a swept inbox projection never re-arms
first-use; outbox enqueue idempotent on the journal key); delegation
projection replacement (template widening or app tier raise →
atomic revoke-and-replace, never two live delegation grants per
credential, raised scopes never silently minted); hosted-target refusal
of every new route.

## Non-goals

- No parallel token or grant model — every semantic this RFC changes,
  including the new supersession and lineage revocation rules, lands as a
  §7 named amendment extending LLP 0055, never as a second system.
- No cryptographic novelty — proof shapes and replay fencing follow LLP
  0077's design; the agent profile is an extension of it, not a new
  scheme.
- No reconciliation/journal surface for operation outcomes — LLP 0149 F5's
  thread.
- No third-party OAuth *to* external services (an agent acquiring a GitHub
  token via Snapback). The pattern generalizes but the scope here is
  authority over Snapback apps.
- No federated consent assertion — §6's future RFC.
- No trusted-agent-host federation (0106's stronger status). v1 humans
  authenticate directly to the host.

## Author decisions — 2026-08-01

Recorded from a walkthrough with the author; the corresponding design
sections are normative and the items no longer appear under §Open
questions.

- **OQ1 — First-contact standing: app-configurable, default open for
  agent-consumable apps.** Realized in v0.2 as riding 0055's existing
  `auth.agents.mode` rather than a second knob (§2); the author's
  default-`open` product posture is carried as the agent-first-app
  template posture in the §7 amendment, with 0055's platform default
  untouched.
- **OQ4 — Escalation supersedes.** Approval atomically revokes the
  predecessor and mints the union; stacking rejected (§3, with the
  transaction rules added in v0.2).
- **OQ5 — Apps may raise ceremony tiers, never lower them.** The
  host-pinned tier map is a floor; tier-2 pins are not overridable in
  either direction (§4).
- **OQ6 — Notify = journal + inbox unconditionally, outbox push when a
  channel exists.** A configured channel is not a precondition for
  (v1 read-only) standing delegations (§4).

## Open questions

- **OQ2 — Credential-kind coexistence — ANSWERED 2026-08-02.** The model is
  **exclusive**: one agent principal has one live credential kind at a time.
  Changing kind supersedes the prior credential kind under the existing
  generation/fencing and one-act revocation story; key-bound and secret-based
  `sbac_` credentials never coexist for one principal. Source:
  `issues/20260802-author-decision-packet.md`.
- **OQ3 — Identifier and secret-class registrations.** The user code,
  request id, challenge nonce, and any key-bound access token need
  entries in 0055's prefix-free namespace and LLP 0031 registry rows.
  Round 1 established this is not mechanical, and v0.2 selected the
  hybrid contract: the bare request id is a bearer *status* capability
  (pending / not-pending only) and terminal release is proof-bound (§1).
  What remains open inside §7 item 11: registry spellings and prefixes,
  response-sensitivity classifications, entropy floors, and carrier
  handling for each new identifier.
- **OQ8 — Numeric security parameters.** The per-source throttle rates,
  request-metadata byte caps, the global unauthenticated pending ceiling,
  inbox-projection retention and count caps, tier 2's short mandatory
  grant TTL, and the delegation-lifetime bounds (the `delegationExpiry`
  ceiling) are open empirical parameters, pinned at implementation with
  the acceptance matrix — the design decisions are the budget
  *structure* (§2), the marker-retention rule (§4), and the fail
  postures, which are closed.
- **OQ7 — Does the approval-link flow subsume pairing codes (deliberately
  open for the review loop)?** Both are kept in this draft: the pairing
  inversion is strictly stronger against unsolicited requests, needs no
  served consent page, and covers the headless-human case; the approval
  link is the ergonomic default. Both flows converge on one request
  record, one approval transaction, one digest, and one poll contract,
  with a closed initiation discriminator (`userSeeded` / `agentRequested`)
  so the acceptance matrix multiplies only at the entry edge. Reviewers
  should weigh whether the pairing code earns its keep once the approvals
  inbox exists (which also provides a user-initiated entry point — though
  an inbox-minted, user-bound request seed *is* pairing semantics under
  another UI), or whether retiring it loses a structurally distinct
  guarantee. **ANSWERED 2026-08-03 (Charlie Cheever, ratifying both review
  families' convergent recommendation):** keep both flows — the approval
  link as the ergonomic default, the pairing inversion retained for the
  headless-human case and its structural immunity to unsolicited requests —
  on the converged single request record/approval
  transaction/digest/poll contract with the closed `userSeeded` /
  `agentRequested` discriminator. Source:
  `issues/20260802-author-decision-packet.md` (2026-08-03 follow-on
  ratifications).
