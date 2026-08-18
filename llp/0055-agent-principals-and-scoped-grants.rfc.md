# LLP 0055: Agent principals and scoped grants

**Type:** RFC
**Status:** Review
**Systems:** Auth, API, Security, Agent tooling, Client integration, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-13
**Revised:** 2026-08-10 (LLP 0204 commissioned the full granted-operation
capability-link authority carrier for reads and writes; design only, with no
implementation or capability claim — see the dated amendment.) 2026-08-10 (the first-class `snapback auth export` / `auth import`
logical-transfer surface now carries closed v1 principal, ownership, identity,
deactivation, and scope-basis facts while structurally excluding all spendable
or consent-pending authority; empty-v2 import rotates authorization incarnation
and has no-resurrection acceptance coverage.) 2026-08-10 (LLP 0204 S5 Landing C implements exact retained
service-authority snapshots for pending effects and re-resolves credential,
generation, grant, token, effective user, expiry, and integration status at
approval time.)
2026-08-09 (LLP 0204 S5 Landing B implements user-owned durable
watch anchors with credential-free `revalidatePrincipal` authority, a
365-day finite lifetime, and immediate death on principal/basis/function
revocation. Integration-owned `capturedGrant` issuance remains commissioned.)
2026-08-09 (LLP 0204 S2 Landing C implemented DCR and the local
OAuth grant facade; Landing A implemented the integration registration and
lifecycle core; watch anchors remain commissioned — see the dated amendment).
2026-08-04 (implemented the per-app `asset-callbacks` principal and exact grants). 2026-08-03 (per-app `asset-callbacks` service principal for
sessions-mode asset lifecycle callbacks — author decision sitting #2;
see the dated amendment). 2026-08-01 (LLP 0062 app-CLI credentialed lane: exact scoped-token
release, server-relative TTL receipts, actor/effective tuple re-attestation,
reference-only profiles, loopback/redirect fences, and cap-aware
cross-process admission; see the dated amendment). 2026-07-30 (§Audit extended to the live wire: subscription
establishment/renewal carries the server-derived block as immutable
subscription metadata, and client/CLI non-2xx retention is byte-preserving;
landed under `issues/closed/20260717-app-cli-attribution-seams.md`).
2026-07-17 (bounded filesystem-helper identity: request, session,
and hook correlation allocators consume the last safe integer once and then
permanently close their capability lineage with a typed refusal). 2026-07-17 (structured custody ownership: returning or throwing
from an ownership callback closes its owner to new work, joins every operation
already started through that owner, and only then releases the universal gate
or physical lock). 2026-07-17 (consuming witness retirement: a retirement dispatch
terminalizes its partition owner, cleanly closes SQLite before carrier unlink,
and proves recovery removes rollback-journal residue). 2026-07-17 (bounded exact Agent terminal ledger: custody format 2
uses fixed hash buckets, globally closes on bucket overflow, migrates the v1
witness journal through a crash-safe compatibility cut, bounds partition scans,
and exposes redacted count/byte diagnostics). 2026-07-17 (filesystem directory-capability closure: the Node
adapter retains one validated POSIX CWD inode in a dedicated helper, resolves
every SQLite lock and custody operation relative to it, bounds retained helpers
and exact-namespace crash-orphan cleanup, and fails closed after helper loss).
2026-07-16 (terminal side-ledger reconciliation: durable Agent
custody records tuple-specific terminal witnesses before primary read,
validation, or cleanup,
backfills pre-ledger tombstones, requires independent partition ownership, and
pins coordinated rollout plus permanent witness retention). 2026-07-16 (finite service-authority closure: exact token witnesses
now fence every finite response/effect, auth-session descriptor, connection
open, and connection act against terminal storage transactions; deadline
terminality is durable before publication and external native initiation has
an explicit cut). 2026-07-16 (durable agent-custody closure: the reference headless
client persists a versioned authority tuple/epoch/revision record behind exact
transactional compare-and-set, requires an exact server descriptor before
initialization, adoption, recovery, or live credential replacement, and waits
for terminal barriers; filesystem custody provides private atomic files and a
bounded cross-process advisory lock). 2026-07-16 (ENG-24916 G5 close-out: the three sealed
authorization-expression inputs now flow through codegen and the Rust
authority, actor-aware HostPlan row filters and trusted mutation guards are
evaluated under both delegated and direct projections with intersection, and
the live matcher reapplies the same rule for incremental deltas; Contract
optimistic evaluation refuses these server-owned inputs). 2026-07-16 (ENG-24918 G7 checkpoint: retained grant-backed live
authority now revalidates every immutable scope basis as well as its durable
grant and carrier coordinates; a same-mode manifest activation that tombstones
a retained scope projects a host-branded terminal delete before admission
reopens, while preserving the public grant-scope diagnostic identity). 2026-07-16 (ENG-24919 G8 close-out: scoped-token handshakes now
issue an opaque queued-replay descriptor over the durable actor/credential
generation/grant tuple while excluding token churn; grant-backed live carries
an exact token-bearing connection-effect fence, revalidates retained authority
against the protected catalog on every rerun, expires and revokes through the
terminal notifier, and purges only the ended carrier's topology; the headless
agent fence preserves that durable tuple across token replacement, rejects
stale carrier callbacks, and ACK settlement is descriptor-scoped so a second
grant of the same effective user cannot acknowledge guessed ids). 2026-07-16
(ENG-24917 G6 close-out: codegen derives the
`authorityCreating` marker for declared permission-backing writes; exact scope
consent is carried into the runtime writer; membership and raw
permission-backing effects enforce the authoritative dynamic gate, including
aliased/computed calls and unmarked wrappers; only full-provenance membership
writes are consentable, while every other service-principal permission-backing
lane is refused). 2026-07-16 (ENG-24914 G3 close-out: scoped-token-bound
connections are indexed by exact `tokenId`; token-cap eviction terminates only
the evicted carrier, while credential rotation and `revoke-self` terminate all
token carriers named by their committed storage witnesses; the live wire gains
the closed `SNAPBACK_AUTH_SCOPED_TOKEN_INVALID` terminal class). 2026-07-15
(ENG-24913 G2 checkpoint: landed the non-production,
operation-bound step-up substrate and coupled its single-use consumption to
`authorityCreating` grant approval; owner credential routes, revoke-all, and
LLP 0045 production delivery remain pending); 2026-07-14 (round-7 dual-family revision, /llp-super-refine:
**integrated the round-6 dispositions into the normative body**, which both
families found were recorded in the triage but not the body — rewrote the two
owner-re-credentialing "grants nothing new" passages to carry the
**ownership-assumption** concession (an owner who never held the current
credential can assume the agent's third-party-granted memberships), added the
owner-assumption disclosure to the consent display, put the **synthetic-principal**
`--as-agent` rule in the dev-impersonation body, added the **LLP 0056 M5** and
**LLP 0060** landing prerequisites, and added recovery-generation persistent
state and emergency-transfer/quarantine to §Protocol obligations; also reconciled
the eligibility predicate as **durable recoverability** jointly owned with LLP
0056. Round-6 changes below.) 2026-07-14 (round-6 dual-family revision, /llp-super-refine:
**non-widening narrowed to reached host operations** with the auth-dependent
control-flow limit (a skipped `ctx.permissions.deny()`, an actor-dependent
result or egress) named honestly rather than claimed away; **owner
re-credentialing disclosed as ownership-assumption authority** (an owner who
never held the current credential can, by reissuing, assume third-party-granted
roles the agent holds — disclosed at grant/consent surfaces and recorded in
audit), not framed as an authority-neutral key rotation; **`auth.kind`
reconciled with dev impersonation** (a simulated agent kind uses a distinct
synthetic principal id, so kind stays a pure function of durable identity for
LLP 0043/0053 retainability); **`AgentDestroyCapability` given a
domain-separated production carrier** distinct from LLP 0057's dev-only `sbic_`
impersonation bearer (which is never published on `prod`); **eligibility
strengthened to durable recoverability** so a sole unowned-production
credential-lost holder does not count as eligible (aligns with LLP 0056's
commit-stage invariant); **`authorityCreating` gated on LLP 0056 M5** in the
landing decomposition; **trusted-local admission bound to LLP 0060's
target-authored deployment capability** (a reverse-proxied local process is not
trusted-local); **request-secret classification** added for routes that receive
credentials; the credential namespace corrected to include LLP 0057's shipped
`sbc_`/`sbak_`/`sbic_`; and the revision-header/round-count provenance
reconciled. Full triage in §Review triage. Prior rounds preserved below.)
2026-07-13 (round-5 dual-family review revision: **recovery no
longer fights LLP 0039** — minting a credential for an *existing* principal is
by definition an impersonation effect, and 0039 pins "every impersonation
effect is refused on `prod`", so recovery is now dev/test/demo-only like every
other authority-creating verb and **no 0039 amendment is required**. That
yields the invariant the whole profile matrix falls out of: **on `prod` the
operator plane may destroy agent authority but never create or assume it**;
creating agent principals on `prod` is app policy (`invitedBy: "users"`), not
an operator act. The production continuity residual is named honestly, with
agent-held recovery keys (proof *by* the agent, not assertion *about* it — and
therefore not an impersonation effect) as the named path out. Also:
`authorityCreating` closed into a real effect system — the **effect is gated at
the write site by the host**, not only by static derivation, so an aliased or
wrapped call cannot launder it (0053's two-gate rule), tier scopes never cover
marked functions (evaluated live against the active manifest), and explicit
pre-marker consents are terminally invalidated; the authorization-version claim
corrected (pure grant/credential/token transitions add no 0053 events, but
manifest activation is 0053's **existing event 2** and advances the version);
recovery now atomically retires sibling recovery invitations and pre-recovery
pairing requests via a **recovery generation**; the **pairing code registered
as a fifth secret class** (`sbpc_`) with digest, single-use CAS, attempt
ceiling, and redaction sentinels; the carrier/connection axis separated from
the durable authority axis so two live tokens on one grant cannot cross-fence;
**all agent-management routes refused on hosted targets** in v1; the
credential-family tombstone horizon actually bounded (age **and** size); the
browser-reachable permanent-destruction residual named (superseded in round 6
by `AgentDestroyCapability` on `prod`, which the settled body requires — the
earlier "strictly weaker than `app.reset`" framing was withdrawn as false,
since `app.reset` is itself `NonProd`); and the
"rotation cannot lock the owner out" claim narrowed to what it really
guarantees. Earlier rounds: round 4 — recovery re-gated behind the non-browser
carrier after both families found the `AdminWrite`-only design let a
browser-held console credential capture any agent principal; family-wide
`revoke-self`; user-minted pairing-code consent; `authorityCreating` marker
introduced; settlement = durable axis + live validation; round 3 — durable
deactivation, downgrade coverage, terminal scope invalidation, `isDirectHuman`,
attribution block, hosted refused wholesale; round 2 — ending surfaces,
invitation class split, one-live-credential invariant, structured scopes;
round 1 — authority-transition reclassification, `sbat_` collision fix, plane
narrowing, sealed projections; initial draft same day)
**Related:** LLP 0000, LLP 0004, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0017, LLP 0019, LLP 0024, LLP 0031, LLP 0039, LLP 0042, LLP 0045, LLP 0053, LLP 0056, LLP 0058, LLP 0150, LLP 0204

## Summary

This RFC proposes making agents first-class principals in Snapback auth: a
blessed way for an agent to register, hold credentials, authenticate, and act —
either as itself or on a user's behalf — with authority that is scoped,
expiring, revocable, and distinguishable in every audit surface.

It is the document that [LLP 0019](./0019-agentic-readiness.research.md) F2
asked for ("machine / agent identity and scoped capability tokens" — named
there the largest auth gap), and the one that supplies the `servicePrincipal`
authority mode that [LLP 0024](./0024-agent-operating-surface.spec.md)
§Authority Tuple and [LLP 0042](./0042-agent-mcp-surface.rfc.md) §Authority
hold "reserved until LLP 0011 pins scoped tokens." **Scope honesty:** this RFC
un-reserves `servicePrincipal` for **local and trusted-local** deployments
only. **Every hosted service-principal invocation — query, live query,
mutation, action, connection open, over HTTP, CLI, or MCP — remains refused
in v1** (§Plane boundary). Un-refusing hosted surfaces awaits the hosted
deployment-security contract LLP 0039 names as unowned, and hosted
*mutations* additionally await the durable audit log (LLP 0019 F8); the
0024/0042 amendment text carries both gates so they travel with the
un-reservation.

The proposal deliberately disentangles three concerns that "agents sign up and
log in" bundles together:

1. **an agent operating Snapback itself** — deploy, inspect, load manifests,
   reset: the **operator plane**. That plane already has carriers (the admin
   token, `AdminWrite`, `AdminSecretRead` leases, `ImpersonationCapability`),
   agents already use them locally, and **this RFC does not extend it**.
   `servicePrincipal` is *not* an operator credential (§Plane boundary);
   hosted operator principals are an open question, not a claim;
2. **an agent as an app principal** — autonomous (it registers, has a profile
   row, holds memberships, posts messages: an application-plane principal
   whose `kind` is `agent`) or **delegated** (it acts as a user, under that
   user's consent, within a scoped grant);
3. **attestation** — proving a caller actually is an agent. v1 is explicit
   about this: declared kind is honor-system; the *credentialed* facts (which
   principal, which grant, which effective user) are strong.

One structure covers the application plane: every invocation resolves to an
**actor principal**, an optional **effective principal**, and the **scoped
grant** that authorized acting as one for the other — the audit tuple LLP 0019
F2 pins. A plain human session is the degenerate case where actor and
effective principal coincide and the grant is the session itself.

## Motivation

- **The corpus is blocked on it.** LLP 0024 and LLP 0042 both reject hosted
  service-principal mutation calls "until scoped tokens exist," and
  [LLP 0017](./0017-admin-console-inspection-surface.rfc.md) keeps the hosted
  admin surface disabled until hosted auth exists. The only non-interactive
  app authority today is local dev impersonation, which is acceptable on a
  trusted local box and unacceptable anywhere else.
- **Delegation is coming to ordinary apps, and it is a product feature, not an
  internal tool.** Real end users will point agents at the apps they use — a
  food-ordering app whose users script "reorder my usual from the place near the
  office," a booking app driven by an assistant. Those agents run against
  **production**, on behalf of ordinary users, and they must be creatable,
  re-credentialable, and revocable *by those users* without an operator in the
  loop. Without a delegation primitive, every such agent holds a full user
  bearer — indistinguishable from the user, unscoped, and revocable only by
  killing the user's own session. That is the pattern this RFC exists to make
  unnecessary, and it is why the production paths here are user-authorized rather
  than operator-authorized (§Re-credentialing).
- **Agent-first positioning.** Snapback's differentiation
  ([LLP 0010](./0010-agent-dx-and-acceptance.spec.md), LLP 0024, LLP 0042) is
  that agents are the primary operators. An auth system where "agent" is a
  first-class principal kind — rather than a fake human account — extends that
  positioning into the apps Snapback hosts.

## Goals

- One principal model covering human users, autonomous agents, and delegated
  agents, resolved at the same single invocation gate
  [LLP 0039](./0039-auth-vertical-slice.rfc.md) builds.
- Scoped, TTL'd, revocable grants whose revocation ends live authority through
  the same class of machinery LLP 0039 pins for session revocation — fenced,
  fail-closed, never stranding a live result — **with a defined
  authority-ending surface on every profile, including production, for every
  authority class this RFC creates** (authority *creation* on `prod` is
  deliberately app policy, never an operator act — §Recovery).
- The actor/effective/grant audit tuple recorded uniformly across the CLI,
  HTTP, and MCP projections of app-data invocation, carried by a
  server-derived response attribution block (§Audit).
- Agents usable as app end users: keyed by the same Snapback user id, so
  profile and membership tables (LLP 0011, [LLP 0056](./0056-scoped-roles-and-memberships.rfc.md))
  work for them unchanged — with principal continuity across recovery and
  import, so those rows never orphan.
- A registration path whose abuse posture is app policy, not an accident.
- **No path by which app-plane authority, or a browser-held operator
  credential, becomes "act as any principal."**

## Non-Goals

- Cryptographic attestation that a caller is an agent, or which model/vendor
  it is. Named as an open question, not claimed.
- Payments, metering, or an agent marketplace.
- Widening LLP 0039's frozen slice. This RFC lands strictly after that
  slice's ordered items, and adds no precondition to them beyond the dated
  amendments 0039 accepts.
- Agent-to-agent delegation chains in v1. Depth 1 is structural, not just a
  rule: consent requires a live session of the effective user, and agents
  have no session path.
- Replacing LLP 0024's local dev impersonation, which remains the local-dev
  path and remains `localDevOnly`.
- **Operator-plane authority.** v1 grants never authorize lifecycle,
  provisioning, manifest loads, reset, or any `Admin*`-gated operation.
- **Hosted service-principal invocation of any kind** (§Summary, §Plane
  boundary).
- **Retained/offline reads under `servicePrincipal`.** v1 service-principal
  clients are online clients.
- **A durable audit log.** v1 records authority attribution in the response
  attribution block and denial diagnostics (§Audit); the general audit
  substrate is LLP 0019 F8's follow-on.
- **Built-in human-user deletion.** LLP 0039 excludes it; when that work
  lands, ending a user must end their grants (an obligation recorded here for
  it, not a surface this RFC builds).

## Design

### Principal kinds

`_auth_users` gains agent-relevant columns: `kind` (`"human" | "agent"`,
default `human`, immutable after creation), and — for agents — `display_name`,
`operator_contact`, an **immutable `registration_provenance`** record (who
created this principal: the tagged minting authority, the invitation class,
and the creation timestamp; durable, exported, redacted of secrets, and
independent of the invitation row, which sweeps), `deactivated_at`, and
**`owner_user_id`** (nullable).

**Agents have owners, and that is what makes them viable in production.** An
agent created from a user's session (`invitedBy: "users"` — the sanctioned
production creation path) records that user as its **owner**. An agent created by
an operator verb, or by `open` self-registration, is **unowned**. The
distinction is load-bearing, because an owner can do for their own agent, from an
ordinary session, what the operator plane is forbidden to do on `prod`:
re-issue its credential (§Re-credentialing). This is not a loophole in the
production invariant — it is the same principle the invariant already rests on.
Creating an agent on `prod` is *app policy authorized by a user*, never an
operator act; **re-credentialing one the user owns is the same kind of act** —
app policy, not an operator impersonation effect, which is what lets it happen on
`prod` at all. It is **not**, however, authority-neutral, and this document does
not claim it is: if the agent rotated its own credential without the owner and
then accrued third-party grants or memberships, an owner reissuing the credential
**assumes** that third-party-granted authority (see §Re-credentialing). Owner
re-credentialing is therefore an **ownership-assumption** capability, disclosed
wherever an agent receives a grant or membership and recorded in audit — the
right trade for production continuity, but disclosed as the assumption it is,
not waved away as "nothing new." Agents
are **users** — same Snapback-issued principal id, same joinability. The
alternative (a separate principals table) would fork every surface keyed by
`userId`: profile rows, memberships, RLS auth variables, audit facts.

**Deactivation is durable state, not just an event.** `deactivated_at` is
consulted fail-closed by **every** authority-creating and
authority-exercising path: token mint, invocation validation, grant-request
creation and approval, template application, recovery consumption, and the
operator mint verbs. Deactivating an agent also terminally voids its pending
grant requests and any un-consumed recovery invitations naming it.
Deactivation is **permanent in v1** (no reactivate verb); the principal row,
its profile, and its memberships remain as historical app data.

**Deactivation is refused while it would leave a protected resource with no
_eligible_ holder.** An agent's memberships survive deactivation, and LLP 0056's
`lastHolder` refuses removing the final holder of a protected role — so a
deactivated agent left holding such a role would strand the resource permanently:
held by a principal that can never act, and *unfixable*, since the protecting
invariant forbids clearing the row.

An earlier draft refused deactivation only when the agent was the **sole holder**,
and that is **not sufficient** — a two-step schedule defeats it. Agents A and B
both hold `host`; deactivate A (allowed, A is not sole); then B leaves (also
allowed, since the row-counting check still sees **A's row**). The resource is now
held only by permanently-deactivated A. Every step was legal; the result is
permanent stranding.

So the predicate is **eligibility, not sole-ness**, and it is shared with LLP 0056:
a holder is **eligible** iff its principal is not permanently deactivated.
Deactivation (owner or operator) **fails typed** whenever it would leave any
protected resource with **no eligible holder**, naming the resources — the app must
seat a replacement first. Symmetrically, LLP 0056 refuses **seating or promoting a
deactivated principal into a protected role**, so the eligible set cannot be kept
full with principals that cannot act. Same fail-closed shape as 0056's refusal to
delete a resource while memberships remain: the system declines to enter a state it
has no exit from. (The residual — a *live* principal that is merely idle or
unreachable — is 0056's principal-side roster-hygiene question, and no row-level
invariant can detect it.)

**"Not deactivated" is necessary but not sufficient for the stranding
guarantee, and the gap is an unowned agent that has lost its only credential.**
A `prod` agent with no owner and no recovery key that loses its credential is
**permanently unable to act** (§Recovery residual) yet is not `deactivated_at`,
so a sole such holder of a protected role strands the resource exactly as a
deactivated one would — reachable through `revoke-self`, operator credential
revocation, declared restore, or importing a dormant unowned agent. Eligibility
is therefore defined as **durable recoverability**, not merely
"not deactivated": a holder is ineligible if it is deactivated **or** provably
unable to ever re-authenticate (unowned, no live credential family, no recovery
key). The row-level invariant can decide this for the credential/recovery facts
it owns (credential-family emptiness, recovery-key presence, ownership); the
*idle-but-recoverable* residual remains 0056's roster-hygiene question. And
because a credential can be lost *after* seating, the system also provides an
**emergency transfer/quarantine** path that does not require preserving a
compromised or lost credential: an operator (on `prod`, under
`AgentDestroyCapability`) may reseat a protected role away from an
unrecoverable holder, which is a destroy-class authority transition, never an
assume. Acceptance covers the sole-unowned-production-holder case across
revoke-self, operator revocation, restore, and import.

App-visible consequences:

- app profile/membership tables key agents by `userId` exactly as humans;
- rules gain analyzable, subscribe-time-resolved auth variables (per LLP
  0011's rule model): `auth.kind` — the **effective** principal's kind — plus
  `auth.actorKind` and `auth.isDelegated`. A delegated agent acting for a
  human resolves `auth.kind = "human"` (the effective principal *is* the
  human); an autonomous agent resolves `auth.kind = "agent"`,
  `auth.isDelegated = false`. "Only the person themself" is therefore
  `auth.kind == "human" && auth.isDelegated == false` — neither conjunct
  alone suffices. Under `devImpersonation` the variables default to
  `kind = "human"`, `actorKind = "human"`, `isDelegated = false`. Simulating an
  agent kind uses the 0024-amendment option `--as-agent`, and it selects a
  **distinct synthetic principal id**, never a second kind for one `userId` —
  so `auth.kind` stays a pure function of durable identity (the retainability
  premise LLP 0043/0053 depend on holds), and a dev session cannot make one
  `userId` present as both human and agent. For
  **anonymous** callers the sealed projection carries no `kind` key at all,
  so a rule referencing it resolves null and fails closed under LLP 0011's
  missing-auth-variable rule. LLP 0056 inherits these semantics.
  Retainability (pinned in the 0039 amendment): `auth.kind` is a pure
  function of the immutable `userId` and is compatible with
  `Retainable ⇒ userId-only`; `auth.actorKind` and `auth.isDelegated` are
  **not**, so a query reading them is retention-ineligible — moot in v1
  (service principals are online-only), load-bearing at item 8;
- `ctx.auth` exposes the same facts, and the handler twin of "the person
  themself" is `ctx.auth.kind === "human" && ctx.auth.actor == null` —
  **both** conjuncts, because `actor` is absent for autonomous agents too, and
  `actor` is present **iff** the invocation is delegated, so the check cannot fail
  open. A generated **`isDirectHuman(ctx)`** helper ships with the 0004 alignment
  so applications do not hand-roll this security-sensitive conjunction wrong.

### Resolved authority: `servicePrincipal`

```
servicePrincipal {
  actorUserId,          // the agent principal presenting the credential
  credentialId,         // which credential authenticated the mint
  credentialGeneration, // rotation fencing input
  grantId,              // the scoped grant authorizing this invocation
  tokenId,              // which scoped token carried this invocation
  effectiveUserId?,     // present iff this is delegated authority
}
```

Because [LLP 0053](./0053-authorization-invalidation.rfc.md) pins `ctx.auth`
as a **sealed, mode-specific exact value** (extra keys impossible), the new
projections join that sealed enumeration through a **dated LLP 0053
amendment** enumerating everything it touches: the two `servicePrincipal`
projections below; `kind` on the session and dev-impersonation projections;
the anonymous answer (no `kind` key); the classification of the three
auth-variable **IR expression kinds** as admitted analyzable inputs (today
the IR carries only `auth.userId`, and 0053 denies new expression kinds for
protected queries until classified); and the **grant-scoped `delete`
disposition** this RFC defines (§Ending authority) so a future 0053 reader
does not apply the client-wide session rule universally.

```ts
// autonomous agent (actor == effective; no actor block by construction)
{ userId: <agentUserId>, sessionId: null, isAuthenticated: true,
  provider: "agent-credential", roles: [], kind: "agent" }

// delegated agent (actor != effective)
{ userId: <effectiveUserId>, sessionId: null, isAuthenticated: true,
  provider: "agent-credential", roles: [],
  kind: <effective user's kind>,           // "human" for a human delegator
  actor: { userId: <agentUserId>, kind: "agent", grantId: <grantId> } }

// human session (unchanged shape + kind, via the same 0053 amendment)
{ userId, sessionId, isAuthenticated: true, provider, roles: [],
  kind: <the user's kind> }
```

`userId` being the effective principal is the load-bearing choice: app code,
RLS rules, and membership checks written for humans work unmodified for
delegated agents — the agent sees exactly what the delegating user could see,
**intersected with the grant's scopes**.

**Non-widening is host-enforced, not merely intended.** Exposing
`auth.actorKind` and `auth.isDelegated` to the rule language would otherwise
break the central guarantee: a rule spelling
`row.ownerId == auth.userId || auth.isDelegated` *widens* a delegated agent
beyond its delegator, and LLP 0011's rule language offers no monotonicity that
would forbid it syntactically. So the composition rule is pinned at the host:

> **A delegated invocation is authorized only where the same invocation under
> the effective user's _direct_ projection would also be authorized, and its
> result is intersected with that direct result.** Actor variables can only ever
> *narrow*.

**Enforcement is per-read and per-write, and the handler runs once.** Two earlier
drafts tried to earn an exemption from checking — first by inferring that a
handler "reads no actor variable" (unsound: an opaque Ibex handler reaches keys by
aliasing, computed access, or reflection, exactly what Accepted LLP 0053 refuses to
trust), then by arguing the projections are *observationally identical* when actor
keys are withheld (also false: the delegated projection carries `sessionId: null`,
so a handler detects delegation from `sessionId` alone). A third draft called the
rule "dual evaluation," which read as *running the invocation twice* — unbuildable
for an **action** (egress would fire twice) and needlessly expensive everywhere
else.

The rule is neither. It is applied where authorization already happens:

> **Single execution. Every _host-mediated authorization decision_ is evaluated
> under both the delegated and the direct projection** — each row admitted to a
> read, each write, each effect, and each trusted check (`requireRole`,
> `ctx.permissions.deny()`) — **and the stricter answer wins.**

The handler body executes **once**, under the delegated projection. It is only the
*decisions* that are doubly evaluated, and every one of them is host-owned, so
none requires re-running the handler: read admission is an RLS evaluation the host
performs per row, write admission likewise, and the trusted checks are host
operations that take the projection as an input. Nothing runs twice, no egress
doubles, and there is no result to reconcile

Handler-internal branching on `ctx.auth.actor` is **not** an authorization decision
and is not trusted to be one — consistent with LLP 0053, where a plain throw is
untyped and only the host's terminal operation is proof. An actor-aware handler may
therefore compute whatever it likes; it still cannot read a row, commit a write, or
fire an effect that the effective user could not, because those are the host's calls
and the host makes them twice — whatever the handler computes
(rows, a `count`, a projection, a join, an opaque value) is derived only from data
the effective user could have read directly.

**The guarantee is _authority_ non-widening over reached host decisions, not
observational equivalence to the direct execution — and the difference is
deliberate, stated because it is the natural place to misread the theorem.**
A handler that gates its *own* refusal on actor-ness —
`if (ctx.auth.actor == null) ctx.permissions.deny(); await ctx.db.insert("t", v)` —
skips that `deny()` on the delegated path, so the insert proceeds where the
direct execution's handler would have stopped it. That is **not** a widening:
the insert is doubly authorized, and it commits only because writing `t` is
within the effective user's *authority* — the skipped `deny()` was a
**handler-imposed** policy, not an authority boundary, and a handler that wants
to refuse delegated actors must do so with a host trusted check the host will
evaluate, not a branch the host cannot see. Symmetrically, an actor-dependent
result or egress returns or emits only data the effective user could read, so it
too stays within authority. What this document does **not** promise is that a
delegated invocation is byte-for-byte the direct invocation; a handler can
behave differently by actor (including declining to act), and only its
host-mediated reads, writes, and effects are held to the effective user's
authority. An app that needs a delegated agent held to a stricter *behavioral*
contract than the user's own authority expresses it as a grant scope or a
declarative rule, not as in-handler control flow. Acceptance covers the
skipped-`deny()`, actor-dependent-result, and actor-dependent-egress cases with
exactly this verdict: authority non-widening holds; observational equivalence is
not claimed. Non-widening therefore holds for
**every** function kind and **every** result shape without enumerating them, and
`query`, `liveQuery`, `mutation`, and `action` need no special cases: reads are
intersected, writes and egress are doubly authorized, live registrations re-apply
the intersection on every re-query.

**The authorization projection excludes `sessionId` and `provider`.** This is what
makes the direct baseline sound rather than synthetic-and-hopeful. Authorization —
declarative rules, `requireRole`, write rules, the trusted denial — sees only
`{ userId, isAuthenticated, roles, kind }`, plus `actor` / `actorKind` /
`isDelegated` on the delegated side. It never sees `sessionId` or `provider`,
because those differ between a real session and any agent-borne authority, and an
authorization decision keyed on them would make "what the user could see directly"
depend on *how* they were authenticated. (An earlier draft's synthetic direct
projection carried `sessionId: null`, so a rule or handler keyed on `sessionId ==
null` would have been *widened* by delegation relative to the user's real session —
a real inversion.) `ctx.auth` still exposes `sessionId` and `provider` to handler
code for non-authorization purposes; they simply cannot gate access, and the
data-layer intersection means a handler branching on them still cannot read a row
the user could not.

**The direct projection is an enumerated sealed value**, not an implied one — LLP
0053 makes exact key sets load-bearing, so the dual run's baseline is pinned like
every other projection. For a delegated invocation whose effective principal is
user *U*, the **authorization** projection is exactly
`{ userId: U, isAuthenticated: true, roles: [], kind: <U's kind> }` — *U*'s
authority with no delegation, and with no authentication-shape fields to key on.
It joins the sealed enumeration in the same dated LLP 0053 amendment as the
others, alongside the handler-facing projections.

**Replay, queues, and stores — after LLP 0039 item 7.** Queued/replayed
service-principal work is available only when item 7 and descriptor protocol 1
are active. Settlement requires **both**: (a) equality on the **durable
authority axis** `(actorUserId, credentialId, credentialGeneration,
grantId)` — `tokenId` is recorded for audit but **never compared**, because
tokens are 1-hour carriers that routinely expire and cap-evict, and keying
settlement to them would strand every queue that outlives its token (0039's
carrier-vs-authority precedent: session refresh preserves queued mutations);
**and** (b) **validation against live durable authority at settlement time**
— the grant unrevoked and unexpired, the credential live and
current-generation, the principal not deactivated, and the scope entry not
terminally invalidated. Tuple equality alone would let work settle after a
revocation; both halves are required. (`tokenId` *does* belong in the
*connection* tuple — a connection opens with one token and dies with it.) The
shipped descriptor is an opaque UUIDv7-shaped SHA-256 projection of the four
durable coordinates, never of `tokenId`; the descriptor reveals no bearer and
does not treat its digest bits as a timestamp. A hygiene rotation therefore
strands queued work as well as dropping connections — stated, not left to
inference. Before item 7, agent clients are online-only and the kit refuses
offline enqueue under `servicePrincipal`.

### Plane boundary

**v1 `servicePrincipal` authorizes generated-function invocation only, only
over the app-data transports, and only on local/trusted-local deployments.**
The surfaces that resolve a scoped token are exactly the app-data HTTP
function routes and WebSocket-carried **function** operations (granted
`liveQuery` subscribe/resume arrives with item 6), plus
`POST /connection/open`. Nothing else. Pinned consequences:

- **CLI and MCP projections ride the same gate.** A CLI or MCP
  `servicePrincipal` invocation is carried over the app-data invocation gate
  with the scoped token as the sole credential — the MCP server presents the
  agent's token to the app-data routes, not its local admin token. The
  admin-gated host-ops `function.run` operation **never resolves a scoped
  token**.
- **The MCP authority matrix, corrected.** `devUser` is **not** displaced:
  LLP 0042's local slice keeps allowing `devUser` (and `devAdminBypass`)
  through the **host-ops** projection under dev-mode/dev-impersonation rules,
  and LLP 0039 keeps impersonation on host-ops behind
  `ImpersonationCapability` under sessions. What this RFC adds is a *second,
  independent* path: **sessions-mode app-data invocation under a scoped
  token**. The two are different transports with different carriers and
  neither replaces the other; the un-reserving amendment publishes the matrix
  (dev mode → host-ops `devUser`/`devAdminBypass`; sessions mode → app-data
  `servicePrincipal`; hosted → all refused).
- **Hosted: refused wholesale.** Every hosted cell — query, live query,
  mutation, action, connection open, over HTTP, CLI, or MCP — refuses
  `servicePrincipal` with the structured capability/auth diagnostic 0042
  already uses — **and so does every agent-management route** (§Routes). No
  hosted cell opens implicitly.
- **Ephemeral room operations refuse `servicePrincipal` in v1** (no scope
  vocabulary yet; a room-scope grammar is an open question).
- Host-ops lifecycle, provisioning, manifest loads, reset, and everything
  gated `AdminRead`/`AdminWrite`/`AdminSecretRead`/`ImpersonationCapability`
  **refuse `servicePrincipal`**. LLP 0056's rule is the same wall from the
  other side: app-plane authority never satisfies operator-plane policy.

### Registration

Agent registration is app policy in the schema manifest. `auth.agents.*` is
meaningful only under `auth.mode: "sessions"`; declaring it under `dev` mode
is a manifest-load error. `auth.agents.*` changes ride **ordinary schema
apply** (no restart barrier): they change abuse posture, not the authority
model. `mode: "disabled"` stops **new principal creation**; it does not
disable existing agents (the kill verbs do that) and it does not block
**recovery** of an existing principal.

```
auth.agents.mode:      "disabled" | "invited" | "open"     // default "disabled"
auth.agents.invitedBy: "operators" | "users"               // default "operators"
auth.agents.template:  [ ...scope records ]                // optional
```

- `disabled` — no agent principals can be created; the creation routes refuse.
- `invited` — creation requires a single-use **creation invitation** (class
  `creation`, prefix `sbagi_`):
  - host-ops `auth.mintAgentInvitation` when `invitedBy: "operators"` —
    gated exactly like `auth.mintSession` (`AdminWrite` **plus** the
    `ImpersonationCapability` effect gate; dev/test/demo only; refused on
    `prod`);
  - `POST /auth/agent-invitations` from any authenticated human user's
    session when `invitedBy: "users"` — the app's explicit opt-in, and the
    only production-profile *creation* path. Per-user budget (10 live
    unconsumed) plus a route throttle. Once LLP 0056 lands, apps may gate
    this route with a global role — a named 0056-composition option.
  - **Manifest-time notice:** staging `invited` + `operators` emits a
    diagnostic that agent onboarding will be impossible on `prod`.
- `open` — `POST /auth/agents/register` is public, with its own throttle
  budget. LLP 0039's throttle honesty applies: on a local box all sources are
  loopback, so this is bounded-abuse posture, not Sybil resistance.

Registration creates the `kind: "agent"` user (with its immutable
`registration_provenance`) and an `_auth_identities` row (`provider:
"agent-credential"`, subject = the stable credential id), and returns — once —
the credential secret plus the agent's `userId`. If the app declares
`auth.agents.template`, the template grant is created as an explicit step of
**registration** and its `grantId` is returned (the framework default is no
template — a fresh agent can authenticate and call nothing).

### Re-credentialing, recovery, and the production profile invariant

Losing an agent's credential must not lose the agent. The principal id is what
profile rows and [LLP 0056](./0056-scoped-roles-and-memberships.rfc.md)
memberships key on, so re-credentialing has to preserve it. The question is *who
may do it*, and the answer differs by whether the agent has an owner.

**The invariant, first.** Minting a credential for an **existing** principal lets
the minter act as that principal, so when the **operator plane** does it, it is an
impersonation effect — and LLP 0039's frozen slice pins **"every impersonation
effect is refused on `prod`."** That gives:

> **On `prod`, the _operator plane_ may end agent authority, but never create it,
> assume it, or terminally destroy the identity.** Creating **and
> re-credentialing** an agent on `prod` is *app policy authorized by a user* —
> never an operator act.

No 0039 amendment is required, and the sessions×prod cell ("sessions enforced; no
impersonation") stands unamended.

**Owner re-credentialing — the production path.** The owner of an agent
(§Principal kinds) re-issues its credential from an ordinary authenticated
session: `POST /auth/agents/{id}/credential`, **session bearer of the owner**,
**available on every profile including `prod`**. Atomically: revoke every prior
credential and token; **terminally revoke every grant** (the owner re-consents,
which is one click, and any *other* user who had delegated to this agent
re-consents too — a credential re-issue must not silently carry a third party's
consent forward); **bump the recovery generation**, voiding pairing requests
created before it; **re-apply the app's current autonomous template**, if any;
and mint the fresh credential — new credential id, new `_auth_identities` row,
**same principal**. Profile rows and memberships resolve throughout.

This is not an operator impersonating anyone — that is what makes it legal on
`prod`. But it is **not authority-neutral for the owner**, and the document is
explicit about the residual: terminally revoking every grant closes the
*delegated-grant* assumption vector, yet **memberships survive** (they resolve
throughout, above), so an owner who never held the current credential can, by
reissuing, **assume any third-party-granted membership** the agent accrued (a
role in another user's channel a third party seated it into, say). That is an
**ownership-assumption** capability, and v1 owns it honestly rather than denying
it: the capability is **disclosed at every surface where an agent receives a
grant or membership** (so a third party seating an agent into a role sees that
the agent's owner can assume it) and **recorded in audit** on every
re-credential. It remains the right trade for production continuity — the "rotate
my API key" gesture, extended to the memberships the key's holder accrued — but
it is disclosed as an assumption, not framed as neutral. The sender-bound
alternative (the owner authorizes recovery without ever obtaining an
agent-usable bearer) is the named open question that would remove the residual.

**But that argument is about the owner, and the attacker is not the owner.** A
thief holding a stolen session bearer could otherwise walk the owner routes and
convert a *transient, revocable* session into a **durable agent credential that
survives the session's revocation** — mint or re-issue the agent's credential,
keep the secret, and retain authority (plus the re-applied template grant, plus
any memberships the agent holds) long after the user logs out everywhere. That is
the same defect class the operator path closed in round 4, and the owner path
must close it too. The security property is pinned as such:

> **A stolen session must not be convertible into authority that outlives the
> compromise response.**

Two mechanisms deliver it. **Neither exists in the corpus today, and both are
therefore owned here as dated LLP 0039 amendments** (§Companion obligations) with
routes of their own — an unowned dependency under a load-bearing security claim
would be exactly the kind of gap this document refuses elsewhere:

- **Step-up authentication on irreversible owner operations** — a new LLP 0039
  surface. The owner routes whose consequence a stolen bearer must not reach —
  those that **mint a durable secret** (`POST /auth/agent-invitations`,
  `POST /auth/agents/{id}/credential`) **and the one that is irreversible**
  (`DELETE /auth/agents/{id}`, permanent deactivation) — require a **fresh
  authentication proof bound to the operation**: a freshly verified LLP 0039
  challenge, scoped to this operation and this agent, within a short window
  (default 5 minutes), replayable once. A valid session bearer alone is **not**
  sufficient.

  **Step-up therefore inherits LLP 0039's delivery prerequisite, and this RFC names
  it rather than assuming it away.** A step-up challenge must actually *reach the
  human*, and the frozen slice's built-in provider is **capture-only**: codes are
  read from the capture mailbox, which is `AdminWrite` + `ImpersonationCapability`
  and **refused on `prod`**. So on a `prod` profile there is no readable challenge
  under 0039 alone — which is the same reason 0039 already states that self-serve
  signup "additionally needs [LLP 0045](./0045-notifications-outbox.rfc.md)'s real
  delivery seam." **The owner paths on `prod` therefore depend on that seam, exactly
  as ordinary `prod` login does.** This RFC adds no new delivery requirement; it
  inherits the one the parent already owns, and it would be dishonest to let the
  production story read as though it were reachable without it. Until LLP 0045's
  delivery lands, `prod` agent onboarding and re-credentialing are reachable only on
  the deployments 0039 already contemplates (admin-onboarded, same-origin), and the
  landing decomposition names LLP 0045 as a **prerequisite of the `prod` owner
  paths** rather than of the RFC as a whole. A stolen bearer alone therefore
  cannot mint agent credentials, and the attacker must defeat the login factor,
  not just the session. **Ordinary consent approval does not require step-up** — it mints no
  secret, and the cascade below revokes it. **But approving a scope marked
  `authorityCreating` does**, and the reason is precise: its effects are *durable
  app data* (a seated LLP 0056 membership) that **survives the cascade**, since
  revoking grants cannot un-write a membership row. A stolen bearer must not be
  able to convert itself into permanent privilege that outlives the compromise
  response, so the one consent whose consequence the cascade cannot reach is the
  one that requires a fresh login proof.
- **Compromise-response cascade** — also a new LLP 0039 surface
  (`POST /auth/sessions/revoke-all`, session-authenticated, the *I was
  compromised* button; 0039 today has per-session logout and admin revocation but
  no user-facing revoke-everything gesture). Ordinary logout ends one session and
  leaves grants alone — durable consent should survive a transient session, and an
  agent must keep working when its owner closes a tab. But revoke-all
  additionally **revokes the user's owned agents' credentials and tokens, and
  every delegated grant that user has issued**. Principals, profile rows, and memberships survive;
  the user re-issues with step-up. This is what makes the property true rather
  than aspirational: after the cascade, nothing an attacker minted from the stolen
  session still authorizes anything.

**The cascade's limit, named rather than discovered.** Revoke-all can end every
*grant-borne* authority, but it **cannot un-write durable app data**: a membership
an authorized delegate already seated survives it, because a membership is a row
in the app's own table, not a credential. That is why `authorityCreating` consent
is step-up-gated (a stolen bearer must not be able to *create* such a row in the
first place) and why LLP 0056 requires `provenance: "full"` on any table a marked
function writes (so a row that *was* seated is attributable to the actor,
effective principal, and grant, and the app can find and remove it). What the
cascade guarantees is therefore exact: **no authority an attacker minted from the
stolen session still authorizes anything, and any durable row a delegate wrote
before the compromise is attributable and removable by the app** — not that the
row vanishes on its own.

The remaining residual is the ordinary one the corpus already owns: if the
attacker also defeats the login factor, they are the user. The client-page XSS
posture that bearer custody rests on remains the unowned contract LLP 0039 names. It makes the motivating case work end to end on
production: a user's shopping agent loses its credential, the user re-issues it
from the app, re-consents, and the agent keeps its identity, its history, and its
memberships. It also makes **autonomous-scope evolution** work on `prod` (update
the template; the owner re-credentials; the new template applies) and makes
**declared restore** survivable (owners re-issue, which an app can surface as a
"reconnect your agent" prompt, rather than every agent being lost).

**Operator recovery — for unowned agents, non-prod only.** An agent with no owner
(operator-created, or `open` self-registered) has no session that can speak for
it, so its only re-credentialing path is the operator verb
**`auth.mintAgentRecovery`** — gated `AdminWrite` **plus
`ImpersonationCapability`** — the effect policy exists in the route registry
today (`crates/snapback/src/server.rs`), while the non-browser **carrier** it names (a 0600-mode
keyring read or a per-boot terminal secret; never the browser console credential)
is specified by LLP 0039 and **not yet built**, so this RFC depends on it rather
than assuming it — and **dev/test/demo only, refused on `prod`**, because it *is* the impersonation
effect the invariant forbids there. It mints a distinct `sbagr_` recovery
invitation, consumed at `POST /auth/agents/recover` with the same atomic,
fails-safe semantics as owner re-credentialing (and consumption, being the effect
site, is **itself refused on `prod`** — see below). A **deactivated** agent cannot
be recovered by either path.

**The gate binds at the effect site, not only at the mint.** Invitations are
durable 7-day artifacts and `ServerProfile` resolves per boot, so gating only the
minting verb would leave a laundering path: mint under `demo`, reboot under
`prod`, consume. The impersonation effect fires at **consumption**, so
`POST /auth/agents/recover` is refused on `prod`, every invitation records its
**minting profile**, and an **operator-minted** `sbagi_` creation invitation is
likewise refused at consumption on `prod` — while a **user-minted** one remains
consumable, since it was never an operator act.

**The residual, stated plainly.** After ownership, it is narrow and it is not
about the delegated case at all:

- an **unowned** agent on `prod` that loses its credential cannot be
  re-credentialed (no owner session can speak for it; the operator path is
  forbidden there). It must re-register as a new principal, orphaning any app data
  keyed to its old `userId`. Unowned agents on `prod` can arise only from `open`
  self-registration or from import — the operator creation verb is itself
  prod-refused — and `open` mode is already documented as a bounded-abuse posture
  rather than a serious production stance.
- **imported** agents land on `prod` re-credentialable **if owned** (the owner
  re-issues) and **dormant if unowned**.

Apps that want production-robust agents therefore use `invitedBy: "users"`, which
is the default recommendation and the path the motivating case takes anyway. An
**agent-held recovery key** (proof *by* the principal, so not an impersonation
effect on any profile) would close the unowned case too, and remains an open
question — but it is no longer on the critical path.

### Credentials and tokens

- **Agent credential** — long-lived secret, prefix `sbac_` + CRC, stored
  hashed, rotatable, revocable. Never presented on app-data requests;
  accepted only by the mint/rotate/grant-request/revoke-self routes. **At
  most one live credential per agent** — registration, rotation, and recovery
  all preserve the invariant atomically, which keeps `(credentialId,
  credentialGeneration)` unambiguous in every fencing tuple.
- **Scoped token** — short-lived bearer minted by `POST /auth/agents/token`
  under the credential; prefix `sbagt_` + CRC, default TTL 1 hour, hard
  maximum 24 hours, binding exactly one grant. Opaque rows in
  `_auth_grant_tokens` (stable `tokenId`), **stored hashed**, validated per
  invocation — so for reachable work revocation lands on the next request and
  the TTL is a **theft-window bound**, not the revocation mechanism. (The
  24-hour ceiling matches LLP 0053's `AuthorizedLease` maximum: both bound a
  holder the server cannot reach.)
- **Invitations** — single-use, TTL-bounded (7 days), stored hashed,
  enumerable and revocable before consumption: `sbagi_` (creation) and
  `sbagr_` (recovery), distinct classes with distinct routes.
- **Pairing code** — the user-minted consent secret (§Grants), prefix `sbpc_` +
  CRC, 256-bit, stored hashed, TTL 10 minutes, **single-use under CAS**, with a
  per-code attempt ceiling (5) and its own throttle. It is a secret class in
  its own right — not a general-purpose bearer, but a short-lived
  authority-*creating* input — so it is no-store, redacted from logs,
  diagnostics, receipts, and the inspection twin, and it carries a
  planted-sentinel redaction row like every other class.

**Rotation is revocation-strength; it cannot cost the owner the ability to
destroy the family** (a stronger claim would be false — see the lost-response
case below). `POST
/auth/agents/rotate` replaces the secret and bumps `credentialGeneration`;
the credential **id** (and the `_auth_identities` subject) is stable. Older
generations fail per-invocation validation immediately and their live
connections are projected pending-revoked (a hygiene rotation drops the
agent's own connections and strands its queued work — deliberate, stated).
**`POST /auth/agents/revoke-self` accepts any attributable secret in the
credential's tombstoned family** — not merely the immediate predecessor —
retained hashed to a **bounded horizon: 30 days**, with rotation **throttled to
at most one per hour** — enforced by a **durable** per-credential counter
(`rotated_at` on `_auth_agent_credentials`, checked against the rollback-checked
clock, so the throttle survives restart and cannot be reset by racing or
rebooting) — which keeps the retained set trivially bounded (~720 hashes) with no
count-based cap. A count-based horizon was the wrong shape: a thief
holding the live secret could simply rotate N times to *evict* the owner's
generation, which is precisely the lockout `revoke-self` exists to prevent.
Time-only retention plus a rate bound removes that lever entirely — the throttle
does not "prevent" rotation, it bounds its rate, and the guarantee rests on
time, not on the attacker's restraint. After the horizon, the owner's
remedy is the operator kill verb `auth.revokeAgentCredential` — `AdminWrite`,
**available on every profile**, so the family can always be destroyed even when
self-service has swept. Round 3's
single-`predecessor_hash` design was defeated by a thief who simply rotates
**twice**: the owner's secret became N−2 and could no longer even destroy the
family. The family-wide, destroy-only, idempotent alarm is LLP 0039's
protocol-obligation-4 shape ("an attributable tombstoned bearer"), it leaks
nothing (it grants no authority and returns no data), and it means: rotation
answers *suspected* theft, `revoke-self` answers *known* theft without an
operator, and operator revocation/recovery is the backstop when the family
window has swept.

**Prefixes are a registered, collision-checked, prefix-free namespace.** The
repository already mints `sbat_` (local admin token — the collision an early
draft walked into), `sbcc_` (console client credential), **`sct_`
(connection tokens — a real bearer class on live/outbox/ephemeral
transports)**, and the `sbrk_`/`sbrl_`/`sbrp_`/`sbrm_` secret-read family
(`sbrp_`/`sbrm_` are a nonce and a MAC, not bearers); LLP 0039 pins `sbs_`
for session bearers (**unbuilt today** — pinned, not minted). This RFC
registers `sbac_`, `sbagt_`, `sbagi_`, `sbagr_`, and `sbpc_`. Acceptance sweeps the
whole namespace: mutually prefix-free, each bearer class rejected by every
other class's resolver, non-bearer classes never authenticating.
(Operator-configured admin tokens may be unprefixed and are classified by
their dedicated carrier, not by prefix dispatch.)

**Secret-bearing responses are classified.** Every route returning credential,
token, or invitation material (register, recover, token mint, rotate,
invitation mint) is credential-sensitive in its LLP 0031 registry row —
no-store, excluded from logs, diagnostics, receipts, and the gated inspection
twin — with planted-sentinel redaction acceptance for all four new classes.

**Carriers and class dispatch.** Scoped tokens ride `Authorization: Bearer`
like session bearers, under the same credential-precedence contract
(presented-but-invalid is an error, never a fall-through). Class dispatch is
structural on the registered prefix **before** resolver selection; a
credential of one class reaching another's surface is a typed
`SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH`. Widening 0039's "`Authorization`
is reserved for session bearers" to "app-plane bearers (session or
agent-scoped)" is a named dated 0039 amendment. Credentials and invitation
secrets are presented only in their dedicated routes' bodies.

**Caps** (v1 constants): live grants per actor (50) and outstanding delegated
grants per effective user (50) — at either cap, grant creation fails
`SNAPBACK_AUTH_GRANT_CAP`; **consent is never silently evicted**. Live tokens
per grant: 10 (minting the 11th revokes the oldest, projecting onto its
connections). Pending pairing requests per agent: 10. Live unconsumed
invitations per minting user: 10. Scope entries and bytes per grant: bounded.
`last_used_at` advancement (credentials and grants alike) is coalesced — UX
surface, never an authorization input.

**Expiry validation runs on the rollback-checked authorization clock.** Every
expiry this RFC pins — invitations, pairing requests, grants, tokens, live
deadlines — is compared against the durable clock high-water discipline LLP
0053 establishes at **item 6** (`auth_clock_high_water_ms`) and reuses at item
8: a detected backward clock jump fails authority validation closed rather
than extending it. Because this RFC wants finite agent calls after item 5, its
first landing stage **brings that item-6 clock infrastructure forward as an
independent prerequisite** rather than waiting for item 6 (stated so the
sequencing is not a surprise).

Sender-binding (DPoP/RFC 9449) remains the same named trajectory 0039 records
for human bearers.

### Grants

Grants are the durable authorization fact connecting an actor to a scope of
action, and they are **immutable in v1**: created, then revoked or expired —
never edited. Narrowing means revoke-and-remint; widening means a new consent.
This is what keeps every grant lifecycle change an *authority* event with no
"permissions changed while authority lives" middle state.

Protected catalog records (field lists and invariants, not DDL):

- `_auth_grants` — `id`, `actor_user_id`, `effective_user_id` (null =
  autonomous), `scopes` (canonical structured records), `created_at`,
  `expires_at` (nullable only for autonomous grants), `revoked_at`,
  `created_by` (tagged provenance: `session:<id>`, `hostOps:<verb>`,
  `registration`, `recovery`, `startup` — tags, not foreign keys),
  `request_id`, `consent_digest` (canonical digest of everything the consent
  UI displayed: the concrete scope records, the expiry, and the agent's
  identity and `registration_provenance`), `last_used_at`.
- `_auth_agent_credentials` — `id` (stable across rotation), `user_id`,
  `secret_hash`, `generation`, `created_at`, `rotated_at`, `revoked_at`,
  `last_used_at`, plus the **tombstoned family hashes** retained to the
  pinned horizon for revoke-only use. Invariant: at most one live row per
  `user_id`.
- `_auth_grant_tokens` — `id`, `token_hash`, `grant_id`, `credential_id`,
  `credential_generation`, `created_at`, `expires_at`, `revoked_at`.
- `_auth_agent_invitations` — `id`, `token_hash`, `class`
  (`creation | recovery`), `created_by`, `agent_user_id` (iff recovery),
  `expires_at`, `revoked_at`, `consumed_at`, `consumed_by`.
- `_auth_pairing_requests` — the consent records (below).

All five sweep on expiry+slack, the session-GC pattern.

- **Autonomous grant.** `effective_user_id = null`. v1 producers: the
  app-declared template **at registration** (the only producer available on
  `prod`), and host-ops `auth.mintAgentGrant` (`AdminWrite` +
  `ImpersonationCapability`, **dev/test/demo, refused on `prod`**) — which is
  also the explicit post-recovery application step. The consequence is stated
  rather than implied: **on `prod` an agent's autonomous _grant_ is fixed at
  registration** (§Recovery's residual) — no operator can mint it another one.
  Note precisely what that does and does not freeze: the grant's **scope
  records** are immutable, but a **tier** record (`{tier: "query"}`) means "the
  current functions of that kind" and is resolved live against the active
  manifest, so deploying a new query *does* extend an autonomous tier grant's
  reach. That is the declared semantics of a wildcard the *app itself* chose for
  *its own* agent — and marked (`authorityCreating`) functions never join a tier
  regardless. An app that wants an autonomous agent's reach pinned across
  deployments grants explicit `{fn, kind}` records in the template instead of a
  tier. Acting as itself, the agent is just a
  principal: RLS and LLP 0056 roles apply to its own `userId`.
- **Delegated grant.** Minted only through the consent flow below.

**Consent: a user-minted pairing code (the CIBA-shaped inversion).** Round 3's
agent-names-the-user-by-handle flow had an unavoidable identity-oracle seam
(a create-then-poll transcript distinguishes resolvable from unresolvable
handles unless the server maintains indistinguishable decoy state), and it
required distributing user handles to agents. v1 inverts it, which dissolves
both problems structurally:

1. the **effective user**, from a live authenticated session, mints a
   short-lived **pairing code** (`POST /auth/pairing-codes`; 10 minutes,
   single-use, capped, throttled) and hands it to the agent out of band;
2. the agent, authenticated with its credential, presents the code with its
   requested scopes (`POST /auth/agents/pair`). Requests are therefore
   **user-initiated by construction**: unsolicited consent requests cannot
   exist, there is no handle namespace, and no oracle — an invalid code is a
   single non-enumerating failure;
3. the user's session sees the pending request bound to their code
   (`GET /auth/grant-requests`), and **approves or denies** it — the consent
   moment, displaying the agent's identity and `registration_provenance`, the
   concrete scope records (including any `authorityCreating` scopes, flagged
   as such), the expiry, and — when the granting user is **not** the agent's
   owner — an **owner-assumption disclosure**: the agent has an owner who can
   re-credential it and thereby assume the memberships/roles this consent leads
   to (§Re-credentialing), so the user is consenting to authority the agent's
   owner can inherit. All of this is captured in `consent_digest`. Approval
   creates the grant atomically with request consumption (CAS on the terminal
   state; concurrent approvals yield exactly one grant);
4. the agent polls the token route with `{ pairingRequestId }`: still-pending
   returns a typed `SNAPBACK_AUTH_GRANT_PENDING`; approval mints the first
   token and returns the `grantId`. **A re-poll after approval atomically
   revokes the prior first token and mints a replacement** — idempotent *in
   effect*, cap-neutral, and requiring no plaintext retention (tokens are
   stored hashed; re-returning a secret the server no longer holds is
   impossible, which is why round 3's "re-return it" pin was unimplementable).
   Denied, expired, nonexistent, and foreign requests all return the same
   non-enumerating `SNAPBACK_AUTH_GRANT_INVALID` — also the agent's stop
   signal;
5. approval, denial, and revocation are idempotent under retry.

Bearer-only transport means approval is a session-authenticated `POST` with no
cookie-CSRF surface in v1.

**Grant lifetime.** Delegated grants **must** carry `expires_at`: default 30
days, hard maximum 90, chosen within those bounds at consent and displayed
there; renewal is a fresh consent, never a silent extension. Autonomous grants
may be indefinite — bounded by the credential lifecycle and the revocation
surfaces, encoding the app's policy about its own agent rather than a user's
consent.

**Scopes are closed, canonical, and analyzable — stored structured, rendered
for display only.**

- `{ fn: <functionId>, kind: <consented kind>, basis: <generation>,
  authorityCreating: <bool> }` — one generated function. `authorityCreating` is
  the consent bit the host gate checks (set from the flagged consent display for
  delegated grants; declared explicitly in `auth.agents.template` or
  `auth.mintAgentGrant` for autonomous ones — an autonomous agent that must
  write permission-backing tables therefore says so at grant time, and a `prod`
  app declares it in the template).
- `{ tier: "query" }` / `{ tier: "mutation" }` — the `query` tier covers
  `query` **and** `liveQuery`; `mutation` covers `mutation`. Autonomous
  grants take these as live wildcards; **delegated** grants expand them to
  the concrete `{fn, kind}` list **at consent time**, so a later deployment
  cannot silently widen what a user approved.
- **Actions are never wildcard-grantable** — explicit `{fn, kind: "action"}`
  only, for autonomous and delegated grants alike.
- **`authorityCreating` is an effect, gated at the effect site.** A delegated
  agent whose grant covers a role-management mutation can seat a **durable**
  LLP 0056 membership — including for its own actor principal — which
  **survives grant revocation** and can later authorize the agent autonomously.
  Ordinary mutation-tier consent must not silently include "may mint durable
  privilege." Closing that requires more than a manifest marker, because
  deciding statically that "this function writes a membership table" is exactly
  the analysis Accepted LLP 0053 refuses to trust (its protected profile pins
  **two** gates — "load-time analysis rejects a statically visible call; **the
  host gate rejects a dynamically reached call**" — and its acceptance treats
  aliases and computed property access as fixtures, not as scanner
  limitations). So the model is two-gate, and the **host gate is the sound
  half**:

  The effect is **not** membership-specific. LLP 0053 already recognizes the
  general class: any write to a `permissionBacking: true` table changes durable
  authorization state. An app can declare its own ACL or role table as
  `permissionBacking` without using LLP 0056 at all, and a tier-scoped delegated
  mutation writing *that* table would mint durable privilege just the same. So
  the effect is defined over **every system-known permission-backing write**;
  LLP 0056 memberships are the blessed instance, not the boundary.

  0. **Provenance is a precondition, and v1 scopes the consentable surface to
     what can actually record it.** A permission-backing table written under
     `servicePrincipal` must carry **host-filled provenance**, so the durable
     privilege a delegate mints stays attributable after the grant dies. **LLP
     0056 membership tables are the only tables that carry that mechanism in
     v1** (`provenance: "full"` — the append-only transition log). Therefore:
     a marked function writing a 0056 membership table is consentable as
     described below; **a write to any _other_ `permissionBacking` table under
     `servicePrincipal` is refused outright, typed** — there is no consent path
     for it in v1, because there is no designed way to attribute it. That is
     fail-closed and owned, rather than gesturing at a generic provenance
     mechanism this RFC does not design. Extending consentable authority-creation
     to app-declared permission-backing tables (with their own host-filled
     provenance) is a named open question.
  1. **Manifest marker (static, best-effort):** codegen derives
     `authorityCreating` for functions that write **any `permissionBacking`
     table** (LLP 0056 membership declarations emit that property); an author
     may also set it explicitly. Marked functions are **excluded from
     tier wildcards**, require an **explicit `{fn, kind}` scope**, are
     **flagged as authority-creating in the consent display**, and require the
     target membership table to declare LLP 0056 `provenance: "full"` (the
     append-only transition log — creation-only attribution cannot survive the
     kick or downgrade a delegate performs).
  2. **Host gate (dynamic, authoritative):** the **permission-backing write**
     itself **refuses, typed
     (`SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED`)**, whenever the invoking
     authority is a `servicePrincipal` whose grant does **not** cover the
     invoked entry point by an explicit, authority-creating-consented scope.
     An aliased call, a computed property access, a data-dependent branch, or
     an unmarked wrapper that reaches a membership write therefore **fails at
     the write**, not merely at codegen. This is why the scope model can keep
     LLP 0039's rule that nested `ctx.runMutation` inherits authority and is
     not re-scope-checked: scopes gate **entry points**, while the
     authority-creating **effect** is gated at the **effect site**, so a
     wrapper cannot launder it.

  Marker lifecycle is closed with no new storage: **tier scopes never cover a
  marked function** — autonomous tier wildcards are evaluated live against the
  active manifest, so a function that *becomes* marked simply stops being
  covered (no terminal-exclusion list is needed, and grant immutability is
  untouched). **Explicit `{fn, kind}` scopes granted *before* the function was
  marked are terminally invalidated at the activation that adds the marker** —
  they were consented without the durable-authority disclosure, so that consent
  is void; re-granting requires a fresh consent that shows the flag. Removing a
  marker never revives a terminally invalidated entry.
  (LLP 0056 carves out **bootstrap-only** writes: the bootstrap capability can
  seat only the server-derived effective principal under a same-transaction
  creation witness, so it cannot name a principal and the self-seating
  escalation is unspellable through it — otherwise every "create an event"
  mutation would need explicit consent for no safety gain.)

**Consent binds a stable endpoint, not an implementation.** An earlier draft
implied consent was bound to "the entry point as composed at the active
manifest version" while only removal and kind-change invalidated a scope —
false, since a developer may freely change a function's body and its nested
`ctx.runMutation` graph. Pinned honestly: **consent is to a stable
`{functionId, kind}` endpoint whose implementation the app developer may
change**, exactly as a user consenting to an OAuth scope trusts the app not to
redefine it maliciously; the `authorityCreating` marker exists precisely
because *one* category of semantic change is too dangerous to leave to that
trust, and a function gaining the marker **terminally invalidates** every tier
scope that previously covered it. Manifest activation re-validates every scope
basis: a removed function or a changed kind makes the entry **terminally
invalid** — durably marked, never revived, so re-deploying the same id later
does not resurrect old consent (verified real hazard: ids default to
`fn:{name}` and are reusable). Finite calls against a terminal entry fail
scope-denied; live registrations riding it are ended at activation. Binding
consent to a developer-versioned *capability contract* instead remains an open
question.

**Mint predicate.** `POST /auth/agents/token` mints iff the credential is live
and current-generation; the agent is not deactivated; the named grant or
pairing request exists and is unexpired/unrevoked (or pending); **and its
`actor_user_id` equals the credential's principal**. Failures split by what the
caller already knows: a dead/rotated/revoked **credential** — a fact its holder
is entitled to — fails `SNAPBACK_AUTH_AGENT_CREDENTIAL_INVALID` (so the agent
recovers instead of retrying); everything about **grants** collapses to the one
non-enumerating `SNAPBACK_AUTH_GRANT_INVALID`. Token `expires_at` is
`min(now + ttl, grant.expires_at)`. The response is a **grant receipt** —
resolved scope records plus token and grant expiries.

**Enforcement** happens at the shared invocation gate, before the handler: an
out-of-scope call fails typed `SNAPBACK_AUTH_GRANT_SCOPE_DENIED` carrying the
missing scope and a reason kind (missing-scope, terminally-invalid entry,
expired grant, revoked credential, wrong actor). This is a plain typed
invocation refusal, **not** a `SNAPBACK_AUTH_PERMISSION_DENIED` producer —
0053's trusted-denial enumeration is closed and nothing here amends it. Scope
intersection is one-directional: a grant only narrows what the effective
principal could do; RLS and function checks then run against the effective
principal as usual.

### Routes and credential classes

Rows marked **[secret]** return credential material (no-store, redacted). The
full LLP 0031 registry rows land in the revision this RFC obligates.

| Route / verb | Credential | Notes |
|---|---|---|
| `POST /auth/agents/register` **[secret]** | none, or `sbagi_` creation invitation (body) | gated by `auth.agents.mode`; throttled; an **operator-minted** invitation is refused at consumption on `prod` (user-minted remains the prod path) |
| `POST /auth/agent-invitations` **[secret]** | owner's session bearer **+ step-up auth** | user-minted **creation** invitations (`invitedBy: "users"` only); **step-up is required — this mints a durable secret, and a stolen bearer alone must not reach it** (§Re-credentialing); budgeted + throttled; never names an existing principal |
| `GET`/`DELETE /auth/agent-invitations[/{id}]` | session bearer | enumerate/revoke one's own unconsumed invitations |
| `auth.mintAgentInvitation` (host-ops) **[secret]** | `AdminWrite` + `ImpersonationCapability` | creation class; dev/test/demo only; refused on `prod` |
| `auth.mintAgentRecovery` (host-ops) **[secret]** | `AdminWrite` + `ImpersonationCapability` | **unowned agents only**; **dev/test/demo, refused on `prod`** — an *operator* establishing a credential for an existing principal is the impersonation effect the invariant forbids there (§Re-credentialing). Owned agents use the owner path instead |
| `POST /auth/pairing-codes` **[secret]** | session bearer | the **user** mints the `sbpc_` pairing code (consent step 1); capped, throttled |
| `POST /auth/agents/pair` | agent credential (body) | agent presents the code + requested scopes |
| `GET /auth/grant-requests` | session bearer | pending requests bound to the caller's codes |
| `POST /auth/grant-requests/{id}/approve` \| `/deny` | session bearer; **+ step-up auth iff the request contains an `authorityCreating` scope** | the consent moment; displays identity, provenance, scopes (authority-creating flagged), expiry. Step-up is required exactly where the cascade cannot reach the consequence (§Re-credentialing) |
| `POST /auth/agents/token` **[secret]** | agent credential (body) | mint predicate; re-poll = revoke-and-replace; returns the grant receipt |
| `POST /auth/agents/rotate` **[secret]** | agent credential (body) | revocation-strength generation bump |
| `POST /auth/agents/revoke-self` | **any attributable family secret** (body) | credential suicide; idempotent; destroy-only |
| `GET`/`DELETE /auth/grants[/{id}]`, bulk revoke-by-actor | session bearer | user-facing enumeration/revocation; never accepts scoped tokens |
| app-data invocation gate, `POST /connection/open` | session bearer **or** `sbagt_` scoped token | the only two surfaces scoped tokens address |
| `POST /auth/agents/{id}/credential` **[secret]** | owner's session bearer **+ step-up auth** | **the production re-credentialing path.** All profiles. Step-up (fresh login proof) is required because this mints a durable secret — a stolen bearer alone must not reach it. Atomic: revokes prior credentials/tokens and all grants, bumps the recovery generation, re-applies the current template, preserves the principal |
| `GET /auth/agents` | owner's session bearer | list the agents I own (all profiles) |
| `DELETE /auth/agents/{id}` | owner's session bearer **+ step-up auth** | permanently deactivate an agent I own (all profiles). **Step-up is required because this is irreversible** — the same reason the operator twin `auth.deactivateAgent` is `NonProd`. A stolen bearer must not be able to permanently destroy a user's agents |
| `POST /auth/sessions/revoke-all` | session bearer | the *I was compromised* gesture: revokes every session **and** the caller's owned agents' credentials/tokens **and** every grant they have issued (§Re-credentialing). A **new LLP 0039 surface**, owned by that amendment |
| `POST /auth/agents/recover` **[secret]** | `sbagr_` recovery invitation (body) | **unowned agents only**; consumption is the **effect site**, so **refused on `prod`**; independent of `auth.agents.mode`; atomic |
| `auth.mintAgentGrant` (host-ops) | `AdminWrite` + `ImpersonationCapability` | autonomous grants; **dev/test/demo; refused on `prod`** |
| `auth.revokeGrant`, `auth.revokeAgentCredential`, `auth.revokeAgentInvitation` (host-ops) | `AdminWrite`; **on `prod`, + `AgentDestroyCapability`** (non-browser carrier) | the **operator** kill path, and it acts across **every** principal. The carrier requirement is about **blast radius**, not irreversibility: an app-origin XSS holding the console credential must not be able to destroy every agent and every consent in the app at once — mass grant destruction is mass consent loss even where an individual owner could re-consent. (Owners revoke and re-issue *their own* agents from ordinary sessions; that path is untouched.) Each records its 0024 authority tuple |
| `auth.deactivateAgent` (host-ops) | `AdminWrite`, **`NonProd`** | identity-**terminal**; matches the corpus's treatment of irreversible verbs (`app.reset` is `NonProd`) |

**The profile invariant, mechanically:** every authority-**creating** *operator*
verb (`mintAgentInvitation`, `mintAgentRecovery`, `mintAgentGrant`) is
dev/test/demo-only and refused on `prod` — **and so is the consumption site of
what it mints** (`/auth/agents/recover`; operator-minted `sbagi_` at
`/auth/agents/register`), because a durable invitation must not survive a reboot
into `prod`. The **owner** paths (`/auth/agent-invitations`,
`/auth/agents/{id}/credential`, `/auth/agents/{id}` delete) are **app-plane and
available on every profile** — they are how agents are created and kept alive in
production, and they are not operator acts. Every authority-**ending** verb (`revokeGrant`,
`revokeAgentCredential`, `revokeAgentInvitation`) is `AdminWrite` on
dev/test/demo and additionally requires **`AgentDestroyCapability`** (the
non-browser carrier) on **`prod`**, where destruction is irreversible. The one **identity-terminal** verb
(`deactivateAgent`) is `NonProd` (§Recovery). **All agent-management routes — registration, recovery, invitation
and pairing-code minting, consent, token mint, rotation — are refused wholesale
on hosted targets in v1**, alongside hosted invocation: they create principals,
durable grants, long-lived credentials, and abuse load, and would become live
authority the moment hosted invocation were un-reserved. No hosted cell opens
implicitly.

Pinned consequences: a scoped token can invoke granted functions and open
connections — it can **not** manage grants, mint invitations or pairing codes,
register or recover agents, or read the consent surface. Grant management is
session-only: a delegated agent must not enumerate or revoke its delegator's
other grants. Every route rejects wrong-class credentials with the typed
mismatch (no fall-through) and carries its own throttle budget.

### Ending authority: revocation, expiry, deactivation

Grant revocation and expiry, credential revocation (including `revoke-self`),
rotation's generation bump, token revocation (including cap eviction),
invitation revocation, request denial, and agent deactivation all **end an
authority**; none is an authorization event in LLP 0053's sense. This follows
0053's own carve-out — "logout, session expiry, and admin session revocation
are **authority transitions**, not authorization events" — and the same
reasoning applies: the authority ends, so grant-backed client state is
**deleted**, not re-filtered. Grants being immutable, there is no
surviving-authority-with-narrower-permissions case, so **pure grant,
credential, token, invitation, and principal transitions add no new event to
0053's closed universe and do not advance the authorization version.**

**Manifest activation is the exception, and it is not new.** This RFC requires
activation to re-validate scope bases (§Grants) — and activation of schema,
functions, or authorization metadata is already **LLP 0053 event 2**, which
advances the global authorization version transactionally. So an activation
that terminally invalidates scope entries and ends the live registrations
riding them fires the **existing** event 2 exactly once, and the ordering is
pinned: the version advance, the terminal scope invalidation, and the
grant-scoped connection deletions are one transactional cause. Nothing about
that is a new event class; the earlier draft's blanket "nothing here touches
the authorization version" was wrong and is corrected here. What *does* ride
0053's ordinary machinery is the effective user's own permission churn (a
membership revoked while a delegated agent subscribes is an ordinary
0056/0053 matter, identical for agents and humans).

- **Every ending has a trigger surface** (§Routes) at every profile. Nothing
  in this document's lifecycle lacks a caller, and every state in its records
  has a producer.
- **Finite work fails closed immediately** — tokens validate per invocation
  against the token row, grant, credential (id + generation), scope-entry
  validity, and `deactivated_at`.
- **Live surfaces end through the authority-transition machinery.** The bound
  authority at `POST /connection/open` gains the `servicePrincipal` variant
  `(actorUserId, credentialId, credentialGeneration, grantId, tokenId,
  deadline)`, `deadline = min(token, grant)`. Every ending event projects
  **pending-revoked** onto the affected connections through the same two-phase
  protocol sessions use, with **`delete`** disposition for the agent client's
  affected state. **Grant-scoped delete is defined by this RFC** (0053's
  client-wide rule is scoped to 0039 session transitions) and is carried into
  the dated 0053 amendment so a future reader does not misapply the
  client-wide sentence.
- **Two axes, deliberately separated.** The **durable authority axis** —
  `(actorUserId, credentialId, credentialGeneration, grantId)` — is what queued
  work settles against (token churn must not strand a queue). The **carrier
  axis** — `(tokenId, connectionId)` — is what *live* state is bound to. A
  grant may have several live tokens at once (cap 10), so the two must not be
  conflated: **token revocation or cap eviction ends only the carrier instances
  bound to that `tokenId`** — its connections close and their query instances
  are destroyed — while another live token's connections on the same grant are
  untouched. Query instances are never reused across carrier instances, so a
  stale callback from an evicted token cannot address a surviving token's
  state.
- **The agent-client fence** (built with item 6): the agent SDK — CLI/daemon
  clients, not the browser kit's `AuthCoordinator` — implements 0053's fence
  contract with the store namespaced by the **durable authority axis**, live
  query instances namespaced by the **carrier axis**, never-reused query
  instance ids, and compare-and-commit against the authority generation for
  every callback and durable write. Live surfaces negotiate
  `authInvalidationProtocol: 1`.
- **Revoking a delegated grant never disturbs the user's own session**; ordinary
  logout does not revoke grants (durable consent survives transient sessions) —
  but the **revoke-all-sessions** compromise gesture does, and additionally kills
  the user's owned agents' credentials and tokens (§Re-credentialing).
  Agent deactivation ends all of that agent's grants, tokens, connections,
  pending requests, and recovery invitations. **Revocation ends grant-borne
  authority only** — durable rows an authorized delegate wrote (memberships)
  are app data and persist, attributably, per the `authorityCreating` rules.
- **The browser console credential reaches no agent destruction on `prod`.**
  Two earlier drafts got this wrong in opposite directions — one accepted a
  browser-reachable permanent destruction primitive by (falsely) comparing it to
  `app.reset`, which is itself `NonProd`; the other assumed "ending" authority
  was reversible on `prod`, which it is not, since `prod` forbids the
  re-creation. The settled rule (§Recovery): on `prod` the destruction verbs
  require `AgentDestroyCapability` (a non-browser carrier), so an app-origin XSS
  holding the console credential can neither create, assume, nor destroy agent
  authority there. The residual that remains is the ordinary one the corpus already owns:
  the client-page XSS posture that bearer custody rests on is the unowned
  contract LLP 0039 names.
- **`--allow-auth-downgrade` covers the agent classes.** 0039's audit-logged
  sessions→dev downgrade revokes every durable session so re-enabling sessions
  resurrects nothing; the dated amendment extends exactly that to agents:
  downgrade transactionally removes credentials, tokens, grants, invitations,
  and pairing requests (while retaining principals and scope-basis tombstones).
  Re-enabling sessions means fresh onboarding and fresh consent.

### Attestation, honestly

`kind: "agent"` is self-declared. v1 makes no claim to detect an agent
registering as a human or vice versa. What the declaration buys anyway: apps
can apply distinct rate limits, pricing, ToS, and UX to declared agents; RLS
can gate on `auth.kind`/`auth.actorKind`/`auth.isDelegated`; and the audit
trail is truthful about every *credentialed* fact — "agent X acting for user Y
under grant Z" is server-issued and unfakeable by an honor-system flag.
Provider-signed attestation is an open question; `_auth_identities` with a new
provider kind is its natural landing spot.

### Audit

Under `servicePrincipal`, every app-data function response carries a
**server-derived attribution block** — `{ actorUserId, effectiveUserId (null =
autonomous), grantId, dryRun }`, ids only, registered with LLP 0012 and
response-sensitivity classified. CLI and MCP projections copy that block
verbatim; an envelope a wrapper synthesizes without it carries no attribution
authority. Denials *after a service-principal authority resolved* carry the
same attribution (denials *before* resolution have no authority to attribute —
scoped honestly). **Live surfaces (2026-07-30, the LLP 0062 wire seams):**
live-subscription establishment carries the same block on
`LiveSubscribeOutput.attribution` as immutable subscription metadata —
derived once from the retained establishing authority — and a renewal
resubscribe (`/live/{name}/resume`) re-answers that establishment block
unchanged rather than re-deriving from the presenting caller; rotation
terminates the watch, and a restarted subscription under the successor
carries that generation's freshly derived block. The finite client core and
generated CLI retain the block verbatim on non-2xx envelopes too
(byte-preserving pass-through; per-principal-class parity tested). Dry-run:
v1 has no scoped-token dry-run surface
(`function.explain` is host-ops), so `dryRun` is `false` for agents until that
changes. A durable, queryable audit **log** is LLP 0019 F8's follow-on — and a
**precondition for hosted mutation authority**; the 0024/0042 amendment text
carries that gate.

### Catalog and lifecycle

The six new tables — `_auth_grants`, `_auth_agent_credentials`,
`_auth_grant_tokens`, `_auth_agent_invitations`, `_auth_pairing_requests`, and
`_auth_scope_bases` — join the protected `_auth_*` catalog: outside the app
manifest, never journaled, never synced, catalog version bumped. A **dated
0039 amendment** pins the refuse-at-open rule this depends on — a
session-aware binary refuses at open any `auth_catalog_version` above its
understanding, from the first catalog-creating binary onward (0039 today pins
only that the marker exists, so without the amendment an older binary could
reopen the database "without agents" and silently strand live grants).

- `app.reset` wipes agents, grants, credentials, tokens, invitations, and
  pairing requests with the rest.
- **Logical export** includes agent users and identities — with
  `display_name`, `operator_contact`, the immutable `registration_provenance`
  (so consent can still render the agent's origin after invitation GC), and
  `deactivated_at` — and **excludes grants entirely**, plus all
  credential/token/invitation/request material. Export carries **`owner_user_id`**,
  which the import story turns on: an **owned** imported agent is re-credentialed
  by its owner from an ordinary session **on any profile**, preserving its
  `userId`, profile rows, and LLP 0056 memberships. Only an **unowned** imported
  agent lands dormant on `prod` (§Re-credentialing's residual).
- **Declared restore** (`--restored-from-backup`) revokes restored tokens,
  credentials, and grants alongside sessions, and **purges invitations and
  pairing requests** — single-use and consent-pending state must not return
  spendable. The undeclared-restore residual is 0039's, and it is wider here
  for exactly as long as a restored credential would have lived — which is why
  declared restore kills credentials rather than trusting TTLs they do not
  have.

**Implementation status.** *G1 landed via ENG-24912* — the **catalog shape,
principal machinery, and prefix namespace**, on top of the LLP 0057 auth-catalog
implementation (which postdates this RFC and now owns the `_auth_*` catalog,
reservation, and version marker). What landed:

- **Catalog version 2.** `AUTH_CATALOG_VERSION` is bumped `1 → 2`: `_auth_users`
  gains `kind`/`display_name`/`operator_contact`/`registration_provenance`/
  `deactivated_at_ms`/`owner_user_id` (with biconditional CHECKs pinning
  human⇔no-provenance, agent⇔has-provenance, and confining
  deactivation/ownership to agents), and the six tables — `_auth_grants`,
  `_auth_agent_credentials`, `_auth_grant_tokens`, `_auth_agent_invitations`,
  `_auth_pairing_requests`, and the never-GC'd `_auth_scope_bases` tombstone —
  join the exact recognized shape. `_auth_*` protection, journal/sync exclusion,
  and reset-wiping come free from the existing reservation.
- **Refuse-at-open** is delivered by LLP 0057's existing marker machinery: a
  binary recognizes the versions it understands ({1, 2}) and any higher marker
  fails closed with `SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED`, so an older
  (v1-only) binary refuses a v2 catalog rather than reopening "without agents".
- **Ownership + durable deactivation.** Create-time owner/provenance recording,
  the fail-closed deactivation consult, and the **eligible-holder** refusal
  (computed against LLP 0056 M1's membership manifests — the same predicate as
  0056 M2's eligible-holder rule, from the other side; sole-ness is *not*
  enough — the two-step schedule is refused).
- **The prefix namespace.** `sbac_`/`sbagt_`/`sbagi_`/`sbagr_`/`sbpc_` are
  registered with per-class secret newtypes and a single structural classifier
  over the **full** implemented namespace — which now also includes 0057's
  `sbic_`/`sbc_`/`sbak_`, beyond the classes this RFC enumerated. Mutual
  prefix-freeness is asserted programmatically; a wrong-class credential is a
  typed `SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH`, never an anonymous
  fall-through; `sbrp_`/`sbrm_` are structurally non-authenticating.

**Deferred (flagged forward dependencies), not guessed:** the six-table
grant/token/credential/invitation/pairing **lifecycle** (mint, rotate,
revoke-self, recover, consent, settlement) is G3/G4; the tables and the
deactivation/ownership/prefix machinery land here. A **first-class v1→v2
migration** is deferred — LLP 0057 pins "a future migration changes the marker
first-class" — so an existing v1 catalog is recognized as legacy (sessions work;
agents unavailable) rather than silently rebuilt; fresh catalogs are created at
v2. **Logical export/import is implemented** by `snapback auth export` / `auth
import`: the closed version-1 artifact carries these agent columns, identities,
and `_auth_scope_bases`; import admits only an empty exact-v2 catalog, rotates
the authorization incarnation in the same transaction, and has planted-secret
no-resurrection acceptance coverage. Durability is also proven across restart.

### Landing decomposition

- **Stage prerequisites:** stable, non-optional function ids (0012/0004
  obligations — deterministic across regeneration for unchanged source) and
  the rollback-checked authorization clock (0053 item 6, **brought forward**
  as an independent prerequisite).
- **Prerequisite of `authorityCreating` service-principal writes:
  [LLP 0056](./0056-scoped-roles-and-memberships.rfc.md) M5.** The
  effect-site gate and `provenance: "full"` attribution the marker depends on
  are LLP 0056 M2–M5 work (M1 is the schema surface only), so every
  service-principal permission-backing write stays **refused closed** until
  0056 M5 and an explicit authority-threading storage stage have landed;
  effect-site tests run through the real storage seam. This is a hard
  ordering, not a soft dependency — the marker cannot be honored before its
  substrate exists.
- **Prerequisite of trusted-local service-principal admission:
  [LLP 0060](./0060-hosted-auth-security.rfc.md)'s target-authored deployment
  capability.** A profile or bind address alone cannot distinguish trusted-local
  from a publicly reverse-proxied local process (LLP 0060 §D1 limit), so
  service-principal admission binds to 0060's deployment capability as an
  **explicit landing prerequisite**, and the 0024/0042 un-reservation carries
  the gate. A reverse-proxied local process is not trusted-local.
- **Prerequisite of the `prod` owner paths specifically:
  [LLP 0045](./0045-notifications-outbox.rfc.md)'s delivery seam.** Step-up
  requires a challenge that reaches the human, and the frozen slice's provider is
  capture-only with the mailbox refused on `prod` (§Re-credentialing). This is the
  same prerequisite 0039 already names for self-serve signup — inherited, not
  invented — and it gates the `prod` owner routes, not the RFC as a whole:
  everything else lands on dev/test/demo and on the admin-onboarded deployments
  0039 contemplates.
- **After 0039 item 5:** registration, recovery, credentials, invitations,
  pairing/consent, grants, token mint, every revocation and deactivation
  surface, the attribution block, and **finite request/response** invocation.
- **After item 6:** grant-backed **live** surfaces, the two-phase transition
  projections onto agent connections, and the agent-SDK fence deliverable.
  Until then `servicePrincipal` live registration is admission-refused exactly
  as auth-scoped session live is.
- **After item 7:** queued/replayed work, under the settlement rule
  (§Resolved authority).
- **Item 8 / never in v1:** retained/offline service-principal reads.

### Companion obligations

- **LLP 0024 / LLP 0042 amendments** — un-reserve `servicePrincipal` with the
  §Plane boundary scope, **publish the MCP authority matrix** (dev-mode
  host-ops `devUser`/`devAdminBypass` preserved; sessions-mode app-data
  `servicePrincipal` added; hosted refused), and carry both hosted gates.
  0024 also owns `--as-agent` if adopted.
- **Dated LLP 0053 amendment** — the sealed `ctx.auth` enumeration (both
  `servicePrincipal` projections; the **direct projection** the non-widening dual
  run evaluates against; `kind` on session and dev-impersonation;
  the anonymous answer), the three auth-variable expression kinds in the
  protected-query input profile, and the **grant-scoped `delete`
  disposition**. *Landed 2026-07-14 via ENG-24906 — LLP 0053 §Agent-auth
  protected-query inputs.*
- **Dated LLP 0039 amendments** — **step-up authentication** (an
  operation-bound, short-window re-verification of the built-in provider's
  challenge, required by the irreversible owner operations — 0039 has no such
  flow today); the **`POST /auth/sessions/revoke-all` compromise gesture** and
  its cascade into owned agents' credentials and issued grants (0039 has
  per-session logout and admin revocation, but no user-facing
  revoke-everything); the new **`AgentDestroyCapability`** effect capability
  registered alongside `ImpersonationCapability` but carried by a
  **domain-separated production destroy bearer**, *not* LLP 0057's `sbic_`
  impersonation carrier — `sbic_` is generated only in dev/test/demo and never
  published on `prod`, and it is categorically an *impersonation* (assume)
  carrier, so reusing it for a `prod` destroy capability would both be
  unavailable there and conflate assume with destroy. The destroy bearer is its
  own registered prefix with its own issuance, custody, publication, redaction,
  restart, and revocation rules (LLP 0057/0031), and cross-substitution tests
  prove it satisfies neither `ImpersonationCapability` nor `AdminSecretRead` and
  that `sbic_` does not satisfy it. It is never the console credential;
  `Authorization` widened to app-plane bearers; connection binding gains the `servicePrincipal` variant and
  deadline; restore's revocation list gains the agent classes;
  `--allow-auth-downgrade` gains them too; the item-7 descriptor gains the
  durable-authority axis; the auth-variable retainability classification;
  and the catalog-version refuse-at-open rule.
- **Dated LLP 0011 addendum** — principal kinds and delegation join the parent
  authentication model.
- **LLP 0031 revision** — registry rows for every route and verb, with the
  **[secret]** response classifications and class-dispatch rules, **and a
  request-secret classification**: `[secret]` today marks routes that *return*
  credential material, but several agent routes *receive* credentials,
  invitations, recovery secrets, or pairing codes in their JSON bodies while
  returning none. Every such field is carried by a typed, non-serializable,
  zeroizing, redacted DTO (the shape LLP 0057's `crates/snapback/src/auth/wire.rs` already uses),
  and the route is marked request-secret so middleware body-buffering,
  diagnostics, logs, receipts, and debug formatting never capture it.
  Acceptance covers malformed and duplicate bodies, middleware peeking, and
  debug/`Display` output.
- **LLP 0012 registrations** — the new diagnostic codes
  (`GRANT_SCOPE_DENIED`, `GRANT_INVALID`, `GRANT_PENDING`, `GRANT_CAP`,
  `AGENT_CREDENTIAL_INVALID`, `CREDENTIAL_CLASS_MISMATCH`, registration/
  invitation/pairing refusals), the attribution-block DTO, the
  stable-function-id manifest requirement, and the `authorityCreating` marker.
- **LLP 0045 dependency** — the delivery seam step-up needs on `prod`
  (§Re-credentialing); 0039 already names it for self-serve signup, and the owner
  paths inherit it.
- **LLP 0004 alignment** — generated spelling for the `ctx.auth` additions,
  the three auth variables, `isDirectHuman`, the stable-id codegen rule, and
  the `authorityCreating` declaration.
- **LLP 0056 composition** — the delegated-role semantics and the
  `auth.actorKind`/`auth.isDelegated` variables (0056 consumes, this RFC
  defines); the `authorityCreating` marker requiring 0056 `provenance: "full"` on the
  written membership table; the optional role gate on user invitation minting.

## Protocol obligations deferred to implementation

**This is an RFC, not a protocol spec** — the same call LLP 0039 §Protocol
obligations records (ratified by Charlie, 2026-07-12) for the parent umbrella,
and the same methodological split appeared here: one reviewer family held this
document to executable-protocol standards, the other to RFC-altitude design
pins. Design intent is pinned above; protocol rigor lands in the implementing
LLP/spec. These obligations are recorded so they cannot be quietly lost:

1. **Transition inventory.** One authoritative state/transition table for
   credentials (incl. the tombstoned family window), invitations (both
   classes), pairing requests, grants, and tokens: caller, carrier, atomic
   writes, CAS points, crash outcomes, and GC horizons.
2. **Settlement predicate.** The exact item-7 settlement algorithm: tuple
   equality **plus** live-authority validation, with its ordering,
   idempotency, and failure dispositions, and the adversarial enqueue-then-end
   traces (grant revocation/expiry, rotation, deactivation, recovery,
   downgrade, terminal scope invalidation).
3. **Consent protocol.** The pairing-code state machine end to end: code
   entropy, binding, timing-envelope equivalence for invalid codes, cap
   accounting, and the concurrent approve/deny/revoke schedules.
4. **Fence mechanics.** The agent-SDK store/callback namespace, query-instance
   identity, and compare-and-commit rules discharging LLP 0053's fence
   contract for a multi-grant client.
5. **Dual-evaluation mechanics for opaque handlers.** For a delegated
   **mutation**, "every authorization decision must pass under both projections
   while the handler executes once" needs its executable form: which run's reads
   enter the read set, how a divergent `requireRole` outcome is linearized, and
   what a mid-handler nested `ctx.runMutation` inherits. The *semantics* are
   pinned (§Resolved authority); the mechanism is implementing-spec work, and it
   is recorded here so it cannot be quietly lost.
6. **Hosted admission.** The profile × kind × transport matrix as executable
   policy, and the runtime capability (not a profile name) that distinguishes
   trusted-local from hosted (LLP 0060's target-authored deployment capability).
7. **Recovery-generation persistent state.** Where the recovery generation lives
   (the agent record), how a pairing request binds the generation it was created
   under, the compare/CAS rule that voids a pre-generation request at consume,
   its crash outcomes, and the populated-catalog v1→v2 migration that introduces
   the column. The *effect* is pinned (re-credentialing bumps it; older pairing
   requests cannot become new grants); the durable mechanics are implementing-
   spec work.
8. **Emergency transfer / quarantine of a stranded protected role.** The
   operator path (on `prod`, under `AgentDestroyCapability`) that reseats a
   protected role away from a holder that is unrecoverable — deactivated or, per
   LLP 0055/0056's durable-recoverability predicate, provably unable to
   re-authenticate — without preserving a compromised or lost credential. This
   is a destroy-class authority transition (never an assume), and it is the exit
   that keeps the eligible-holder invariant (§Principal kinds) from bricking a
   resource; its exact steps, atomicity, and audit are implementing-spec work.

## Validation Requirements

Identity, registration, recovery, deactivation:

- Register in each mode; `disabled` refuses creation while existing agents keep
  working **and recovery still works**; `invited` refuses without a valid
  invitation; reuse, expiry, and revocation-before-consumption fail closed; the
  `invitedBy` matrix holds (operator creation verb refused on `prod`; the
  user-session mint route exists, is budgeted, refuses when not opted in); the
  `invited`+`operators` manifest diagnostic fires.
- **Class negatives:** a user-minted creation invitation cannot name an existing
  principal (refused at mint; a forged body fails at consumption); an `sbagi_`
  secret is refused by `/auth/agents/recover` and an `sbagr_` secret by
  `/auth/agents/register` (structural class dispatch).
- **The profile invariant, gated at mint _and_ effect site:** every
  authority-**creating** verb is **refused on `prod`** and requires `AdminWrite`
  **plus `ImpersonationCapability`** elsewhere — an ordinary admin bearer **and a
  browser-held console credential are each refused** (the escalation round 3
  opened). **Mint-in-demo → reboot-into-`prod` → consume is refused** for both a
  recovery invitation and an operator-minted creation invitation, while a
  **user-minted** creation invitation still consumes on `prod`. Every
  authority-**ending** verb succeeds with `AdminWrite` on dev/test/demo and
  refuses `AdminRead`; **on `prod` each additionally requires the non-browser
  operator carrier — a browser-held console credential is refused**, so an
  app-origin XSS can neither create, assume, nor destroy agent authority there;
  **`auth.deactivateAgent` is refused on `prod`** (identity-terminal); and
  revoking credential + grants under the carrier fully stops a rogue prod agent.
- **A stolen session cannot be upgraded into durable authority, nor destroy one**
  — the property asserted directly: a valid bearer **without** step-up is refused
  at `/auth/agent-invitations`, `/auth/agents/{id}/credential`, **and
  `DELETE /auth/agents/{id}`** (the irreversible one); a step-up proof is
  operation-bound (a proof minted for one agent does not authorize another) and
  single-use; **approving an `authorityCreating` scope also requires step-up**,
  because a membership the delegate then seats is durable app data the cascade
  cannot revoke — while an ordinary consent needs none, since the cascade kills the
  grant; and after the
  user's **"revoke all sessions"** cascade, every credential, token, and delegated
  grant minted from the compromised session is dead, while the agent principals,
  profile rows, and LLP 0056 memberships survive for re-issue. Ordinary
  single-session logout, by contrast, leaves grants and agent credentials intact.
- **The durable-privilege escalation is closed — the full adversarial trace, end
  to end.** A thief holding a stolen session bearer: mints a pairing code from the
  victim's session; presents it from an **attacker-owned** agent (whose credential
  the victim's cascade can never touch, since the victim does not own it); and
  attempts to approve an **`authorityCreating`** scope so that agent, acting as the
  victim, could seat a membership **for its own actor principal** — durable
  authority that would survive the victim's revoke-all and leave the attacker's
  agent autonomously privileged over the victim's resources. **The approval is
  refused without step-up**, which breaks the chain at its only load-bearing link.
  The trace is asserted in full, including the negatives that make it airtight: an
  *ordinary* (non-`authorityCreating`) grant approved from the stolen bearer is
  **killed by the cascade**; and a delegate holding only ordinary mutation-tier
  scope **cannot** reach a membership write at all, because the host gate refuses
  it (§Grants) — so no path to durable privilege bypasses the step-up gate.
- **Owner re-credentialing works on `prod` — the motivating case, end to end:**
  a user creates an agent, consents to scopes, the agent acts; the credential is
  lost; the **owner re-issues it from an ordinary session on `prod`**; the
  principal id is preserved, profile rows and LLP 0056 memberships still resolve,
  the app's current autonomous template re-applies, and the owner re-consents.
  **A non-owner's session is refused**, an owner cannot re-credential an agent
  they do not own, and a scoped token is refused (grant management is
  session-only).
- **Re-credentialing is fails-safe:** it revokes all prior credentials/tokens,
  **terminally revokes all grants** (a *third* user's delegation to that agent does
  **not** survive silently — they must re-consent), bumps the **recovery
  generation** so a pairing request created before it cannot be approved into a
  post-re-credential grant, and revokes every other unconsumed recovery invitation
  naming the principal. Two siblings racing consumption, and a revocation racing
  consumption, each yield exactly one outcome.
- **Operator recovery is unowned-only and non-prod:** `auth.mintAgentRecovery`
  refuses an **owned** agent (the owner path exists), refuses `AdminWrite` without
  `ImpersonationCapability`, refuses a browser-held console credential, and is
  refused on `prod` at **both** mint and consumption.
- **Autonomous-scope evolution on `prod`** works through the owner path: update
  the template, the owner re-credentials, the new template applies.
- **The narrowed residual is asserted, not assumed:** an **unowned** agent on
  `prod` (from `open` registration or import) cannot be re-credentialed and must
  re-register; an **owned** imported agent is re-credentialable by its owner on
  `prod`; and a declared restore on `prod` leaves **owned** agents recoverable by
  their owners rather than stranding every agent.
- **Deactivation** closes every door (mint, invoke, pair, approve, template
  application, pre-minted recovery consumption), survives restart and
  export/import, and has no reactivation path — **but is refused, typed, whenever it
  would leave a protected LLP 0056 resource with no _eligible_ holder**, naming the
  resources. The adversarial schedule is asserted, because a **sole-holder** check
  is not enough: deactivate A (not sole) → B leaves → **refused**, since A is
  ineligible and B is the last eligible holder. A permanent deactivation can
  therefore never strand a resource in a state the protecting invariant forbids
  fixing.

Credentials, tokens, classes:

- Mint, call in scope; out-of-scope fails `GRANT_SCOPE_DENIED` with the reason
  kind.
- **Cross-class negatives:** session bearer on the mint route; agent credential
  at the invocation gate; scoped token on grant management/consent/registration;
  admin token at the app-data gate; invitation secrets outside their routes —
  each fails the typed class mismatch, none falls through.
- **Prefix sweep** across the full registered namespace (`sbs_`, `sbat_`,
  `sbcc_`, **`sct_`**, `sbrk_`/`sbrl_`/`sbrp_`/`sbrm_`, `sbac_`, `sbagt_`,
  `sbagi_`, `sbagr_`, **`sbpc_`**): mutually prefix-free; every bearer class
  rejected by every other resolver; `sbrp_`/`sbrm_` never authenticate.
- **Redaction sentinels** for all **five** new secret classes — including the
  **pairing code** — across logs, diagnostics, denial details, receipts, and the
  gated inspection twin; secret-bearing responses are no-store; the pairing code
  is hashed at rest, single-use under CAS, and exhausts its attempt ceiling.
- **Wrong-actor mint:** credential A against B's grant *or* B's pairing request
  fails the non-enumerating `GRANT_INVALID`, identical for nonexistent, revoked,
  expired, denied, and foreign targets; a dead credential fails
  `AGENT_CREDENTIAL_INVALID` instead.
- **Thief-rotates-N:** after *any* number of attacker rotations within the
  horizon, the owner's original secret **still calls `revoke-self`** and destroys
  the family (the round-3 single-predecessor design failed at two rotations; a
  count-based horizon would have failed at five). Beyond 30 days the secret is
  swept and refused,
  and no rotation sequence can evict the owner's secret before the time horizon
  (retention is time-only; the rate bound merely caps storage). The operator
  ending verb remains available on every profile as the backstop after sweep.
- **Lost rotate response:** the agent holds only a tombstoned secret — it can
  `revoke-self` but cannot authenticate. An **owned** agent's owner simply
  re-issues the credential from their session (with step-up) on **any profile**;
  only an **unowned** agent falls back to operator recovery (dev/test/demo) or
  re-registration (`prod`).
- **Lost-mint-response:** a re-poll after approval revokes the prior first token
  and mints a replacement — the agent recovers, the cap does not drift, and no
  plaintext token was retained.
- Rotation invalidates old secrets and generations immediately; live connections
  under an older generation are pending-revoked; **queued work under an older
  generation is stranded** (asserted, not inferred).
- Caps: grant caps refuse with `GRANT_CAP` (**no eviction of consent**); the
  token cap evicts the oldest and projects onto its connection; pairing,
  invitation, and scope caps enforced.
- One-live-credential invariant across registration, rotation, and recovery.
- **Clock rollback** extends no invitation, pairing request, grant, token, or
  connection deadline; expiry-boundary and restart cases pass.

Delegation, consent, scopes:

- Delegated grant: the agent sees exactly the effective user's visibility; a row
  the user cannot see, the delegated agent cannot see; `ctx.auth.userId` is the
  user and `ctx.auth.actor` is the agent in handlers and the attribution block.
- **Grant-cannot-widen, and neither can an actor variable:** a scope naming a
  function whose RLS denies the effective user still denies the delegated agent.
  The host's direct-projection intersection is proven against the shapes that
  would otherwise widen — a **disjunctive** rule (`owner == auth.userId ||
  auth.isDelegated`), a **negated** one, and an **actor-only allow** each deliver
  the delegated agent **no** row the effective user could not fetch directly.
- **The handler runs once; the intersection is per-read.** An opaque handler
  reading **`sessionId`** — not an actor key — can detect delegation, so any
  exemption keyed on "this handler reads no actor variable" is unsound, and the
  fixture asserts it. But nothing executes twice: an **action** fires its egress
  exactly once (a design that ran it twice would be unbuildable), and a
  **mutation** commits one set of writes. **Authorization never reads `sessionId`
  or `provider`:** a rule or check keyed on `sessionId == null` cannot widen a
  delegated agent past the user's real session, because the authorization
  projection does not carry the field.
- **Non-widening is enforced at the data layer, so it survives every result
  shape:** a widening rule does not leak through an **aggregate** either — a
  delegated `count`/`sum` over rows the effective user cannot read returns the
  user's number, not the agent's, because the *reads* were intersected, not the
  rows of the answer. Asserted for a row set, an aggregate, a projection, and an
  opaque computed return; for a **mutation** (writes authorized under both
  projections; the delegated run's writes commit); and for an **action** (reads
  intersected, egress authorized under both).
- **`isDirectHuman` cannot fail open:** `actor` is a sealed property present
  **iff** the invocation is delegated, so the conjunction accepts a direct human
  session and rejects **both** the delegated agent and the autonomous agent —
  proven in a handler, not only on rule variables; projections match the sealed
  enumeration byte-for-byte; an anonymous caller's `auth.kind` rule fails closed.
- **Pairing consent:** only the code-minting user's session can approve; the
  code is single-use under CAS (a replay after consumption fails) and its
  attempt ceiling locks it out; an invalid/expired/foreign code is a single
  non-enumerating failure with an equivalent timing envelope; concurrent approvals yield one grant; denial is a
  first-class action; the consent display carries identity, provenance, scope
  records, **authority-creating flags**, and expiry (digest recorded); delegated
  grants without expiry, or beyond the hard max, are refused.
- **Wildcard expansion:** a function deployed after consent is not invocable
  under a pre-existing delegated tier grant; it is under an autonomous one.
- **Terminal invalidation:** removing a granted function (or changing its kind,
  or marking it `authorityCreating`) then re-deploying the same id does **not**
  revive the entry — finite calls stay denied and the ended live registration
  stays ended.
- **`authorityCreating` is closed at both gates:** a marked function is
  unreachable via tier wildcards (autonomous wildcards evaluate live against the
  active manifest, so marking a function removes it from coverage without
  touching the immutable grant); it is reachable only by explicit,
  flag-displayed consent; and it requires the target 0056 table to declare
  `provenance`. **The host gate is proven independently of the static
  derivation:** an **unmarked wrapper** and an **aliased/computed-access** call
  that dynamically reach a membership write under a tier-scoped
  `servicePrincipal` each fail typed at the **write**
  (`AUTHORITY_CREATING_UNCONSENTED`) — the codegen derivation is not trusted to
  be sound. An **explicit pre-marker grant** is terminally invalidated by the
  activation that adds the marker, and marker removal does not revive it.
  Bootstrap-only writes (0056) do **not** trigger the marker. The self-seating
  trace runs end to end — a delegated agent with explicit consent seats its own
  actor as `host`, the grant is revoked, the membership **persists** with its
  `grantedBy*` attribution, and the agent's later autonomous access is explained
  by that row, not by the dead grant.
- **Activation is LLP 0053 event 2, and terminal invalidation is durable:** an
  activation that advances a function's **basis generation** (removal, kind
  change, `authorityCreating` change) advances the global authorization version
  **exactly once**, and the version advance, the basis advance, and the
  grant-scoped connection deletions commit as one transactional cause — **with no
  grant row rewritten** (immutability preserved). Old consent **never revives** (the ABA negative): remove a granted function,
  **re-add the same id and kind**, and the pre-removal scope entries still fail to
  match — the basis-generation row is a durable tombstone that survived the
  removal, so the re-add resumes above the stale `basis`, across restart and
  declared restore. Pure grant/credential/token/principal transitions advance **no**
  version.
- **`authorityCreating` covers permission-backing writes generally:** a
  **non-membership** app table declared `permissionBacking` is gated identically —
  an unmarked mutation writing it under a tier-scoped `servicePrincipal` fails at
  the write, including through an alias or wrapper; and a scope consented
  **without** the `authorityCreating` flag cannot invoke a marked function even if
  its `{fn, kind}` matches.
- Actions reachable only by explicit `{fn, kind: "action"}`.

Ending authority:

- Grant revocation mid-connection ends grant-backed live results through the
  two-phase path with `delete`; a revoked token fails closed on the next finite
  request; the authorization version does not move.
- Credential revocation and deactivation cascade across grants/tokens/
  connections; each operator ending verb refuses `AdminRead` and records its
  authority tuple; **on `prod` each additionally requires
  `AgentDestroyCapability`** and refuses a browser-held console credential
  (§Re-credentialing), while `auth.deactivateAgent` is `NonProd` outright.
- Deadline convergence closes a live connection with no revocation write.
- Bulk revoke-by-actor ends every grant from that user to that agent; the user's
  own session is undisturbed.
- **Agent-client fences (item 6):** stale success after rotation and stale
  callback after cap eviction cannot repopulate cleared state; two grants
  addressing one query key stay namespaced by the durable axis; and — the
  multi-carrier case — **two live tokens on one grant**: evicting token A closes
  only A's connections and destroys only A's query instances, token B's live
  state survives untouched, A's stale callbacks cannot address B's state, and
  queued work under the shared grant survives A's eviction entirely.
- **Settlement (item 7):** cross-tuple replay is refused; work **survives
  routine token expiry/eviction within the same grant**; and work is **refused
  when the durable authority ended after enqueue** (grant revoked/expired,
  credential rotated/revoked, principal deactivated, recovered, downgraded, or
  the scope entry terminally invalidated) — both halves of the settlement rule.
- **Downgrade:** `--allow-auth-downgrade` → dev → re-enable sessions: no agent
  credential, token, grant, invitation, or pairing request returns live.

Lifecycle, audit, projections:

- `app.reset` wipes all six new tables; export carries identity facts — including
  **`owner_user_id`** (which the import story depends on: an owned agent is
  re-credentialable by its owner on any profile), registration provenance, and
  deactivation — **and `_auth_scope_bases`** (a durable authorization fact, not a
  secret), and no credential/grant material;
  **an _owned_ imported principal is re-credentialed by its owner on any profile
  — including `prod` — and its profile/membership rows resolve against the same
  `userId`**, while an **unowned** one lands dormant on `prod` (rows resolve;
  authentication impossible) — the residual asserted, not assumed; consent renders
  the agent's origin after invitation GC.
- **Declared restore on `prod` does not strand owned agents** — the ownership
  design's whole point: after a declared restore, an **owned** agent is
  recoverable by its owner re-issuing the credential from an ordinary session
  (with step-up), and an app surfaces that as a "reconnect your agent" prompt.
  Only an **unowned** agent is stranded and must re-register. The capability
  report exposes `agentRecovery: "owner"` (and `"unavailable"` for unowned
  principals on `prod`), and the restore runbook states it.
- Older session-aware binary vs. bumped `auth_catalog_version`: fails closed at
  open, typed.
- The attribution block is server-derived and identical across CLI, HTTP, and
  MCP projections of the same function (autonomous = null effective principal);
  a wrapper-synthesized envelope without it carries none.
- **MCP matrix:** dev-mode host-ops `devUser`/`devAdminBypass` still work (0042
  unchanged); sessions-mode app-data accepts a valid in-scope
  `servicePrincipal`; **hosted refuses `servicePrincipal` for every kind and
  transport**; host-ops `function.run` and lifecycle verbs refuse scoped tokens;
  ephemeral room operations refuse `servicePrincipal`.

## Open Questions

- Verifiable agent attestation — and, relatedly, how a user verifies *which*
  agent is asking at consent (display names are self-declared;
  `registration_provenance` helps but is not attestation).
- Sender-binding (DPoP-shaped) for agent credentials and tokens.
- Scope grammar growth: table/resource scopes via LLP 0056 memberships,
  read-only row projections, and a room-scope vocabulary so ephemeral surfaces
  can stop refusing `servicePrincipal`.
- Should consent bind a developer-versioned per-function **capability
  contract** (re-consent on incompatible change) rather than a stable endpoint?
  Should app-declared **scope bundles** be the consent unit to reduce scope
  fatigue?
- **Unowned agents on `prod`.** Owner re-credentialing solves production
  continuity for the agents that have owners (§Re-credentialing), which is the
  recommended shape. An **agent-held recovery key** — proof *by* the principal, so
  not an impersonation effect on any profile — would close the unowned case
  (`open` registration, imported operator-created bots) too. Worth building, or is
  "unowned agents are a non-production shape" the right permanent answer?
- **Ownership lifecycle.** Can ownership be transferred? What happens to an agent
  when its owner's account is deleted (an inherited question — LLP 0039 has no
  user deletion yet)? Should an app be able to declare agents owned by a *team*
  (an LLP 0056 membership) rather than an individual?
- Should recovery notify former delegators (their grants died) as a
  first-class fact rather than a re-consent surprise?
- Should `open` registration exist before hosted deployment security is owned?
- Delegation chains: permanent non-goal, or a macaroon-style
  **attenuation-only** derivative (strictly narrower, shorter-lived child
  tokens minted offline, never widening, never changing the effective
  principal) — which composes with the narrowing invariant and the DPoP
  trajectory?
- Hosted **operator** service principals: separate issuer and scope grammar —
  which document owns it?
- Retained/offline reads under `servicePrincipal`: what token/grant clamps
  would extend `AuthorizedLease`?
- Does the LLP 0045 outbox eventually carry invitation and pairing delivery,
  under the capture-class constraint 0039 pins for auth codes?
- Does `_auth_accounts` (merged away in 0039) return when agent credentials and
  external OAuth both exist?

## Implementation checkpoint: step-up consent (2026-07-15)

The first bounded G2 slice is implemented as the dated LLP 0039 amendment
§Dated amendment: operation-bound step-up. In `dev`, `test`, and `demo`, a
session-authenticated human can request a five-minute capture challenge bound to
the exact `grantApproval` request id. The digest additionally binds the exact
user and session authority. Approval re-reads the stored scopes and, iff any is
`authorityCreating`, verifies and consumes that proof in the same SQLite
transaction that creates the immutable grant. Ordinary consent still requires
no step-up. Login challenges, other targets, and other sessions cannot be
substituted; concurrent replay creates at most one grant. The effect boundary
resamples time after proof coordination, and an ambiguous commit is published
only after exact request/grant/challenge reconciliation; otherwise the route
fails unavailable.

This checkpoint intentionally does **not** claim the owner invitation,
owner-credential, owner-deactivation, or revoke-all routes. The closed operation
vocabulary is ready to add those targets, but each protected effect must couple
proof consumption to its own durable transaction. Production challenge creation
remains fail-closed with
`SNAPBACK_AUTH_STEP_UP_DELIVERY_UNAVAILABLE` until LLP 0045 supplies the
ephemeral human-delivery seam; capture is not a production escape hatch.

## Implementation checkpoint: G3 carrier projection (2026-07-16)

The credential/token lifecycle and its connection projection are implemented.
`POST /connection/open` already bound a scoped token to an exact
`servicePrincipal`, but the connection registry previously filed that grant in
the anonymous reverse index and the rotate/token/revoke-self routes discarded
the exact token-id witnesses returned by their committed storage operations.
The registry now maintains a token-id reverse index and projects those witnesses
through LLP 0059's terminal notifier. Token-cap eviction removes and terminalizes
only the evicted token's connections; another token on the same durable grant
survives. Rotation and `revoke-self` terminalize every live carrier belonging to
the ended credential family. The terminal frame uses the newly registered
`SNAPBACK_AUTH_SCOPED_TOKEN_INVALID` code with reason `revoked`.

At this checkpoint grant-backed live registration was still admission-refused;
the later G8 checkpoint below replaces that temporary refusal. G3 closed the
mid-connection rotation and cap-eviction obligations without claiming G7's
broader grant/lifecycle transitions or G8's live-query and queued-settlement
surface.

## Implementation checkpoint: G5 non-widening invocation gate (2026-07-16)

The sealed authorization projection is now executable rather than documentary.
`auth.kind`, `auth.actorKind`, and `auth.isDelegated` are first-class closed
`ValueExpr` nodes in the Rust manifest and generated authoring surface. Their
values are server-owned fields on the canonical invocation input, skipped by
the handler-input wire and schemas so a caller cannot synthesize them.
`auth.kind` remains retainable alongside `auth.userId` because it is an
immutable function of that identity; either actor-bearing input makes a query
online-only. The Contract optimistic evaluator refuses all three rather than
guessing the server's projection.

For a delegated `servicePrincipal`, HostPlan query-filter admission and trusted
mutation guards evaluate actor-aware expressions once under the delegated
projection and once under the enumerated direct effective-human projection;
SQL combines both row constraints with `AND`, and guard admission requires both
answers. The direct projection has no actor and the authorization evaluator has
no `sessionId` or provider input. A missing direct actor fails closed. Runtime
clock/id inputs are refused before an actor-aware decision can consume either.
Actor-independent nodes reuse one result because the closed declarative IR
proves the two authorization inputs identical for those nodes; this is not the
rejected inference over an opaque Ibex handler. The handler itself still runs
once under its handler-facing delegated projection.

The same intersection now governs incremental live matching and op-log deltas,
not only initial SQL snapshots, so a later write cannot reintroduce a row that
the direct baseline excluded. Acceptance covers actor-only, negated, and
disjunctive widening attempts; row sets and values derived from them (count,
projection, and opaque result shapes); direct-human helper behavior for direct,
delegated, and autonomous principals; and the existing single-execution action
path. Client/codegen tests pin the new dependence dimensions and the optimistic
refusal.

## Grant-backed live and queued replay

G8 landed on 2026-07-16. `GET /auth/session` accepts a current scoped token and
issues the same closed authority-descriptor protocol used by session clients.
The service-principal descriptor is stable across token mint, expiry, and cap
eviction, but changes when the actor, credential id, credential generation, or
grant changes. Every queued mutation still resolves a live scoped token first;
function preparation then checks the current immutable scope entry, and only
after those gates does descriptor comparison or settlement lookup run.
Standalone acknowledgement uses the same live-token resolution and durable
descriptor ownership without creating an application effect.

Grant-backed live connection effects carry the authorization-stream
incarnation, never-reused connection-grant id, and exact `tokenId`. Initial
subscribe and every retained rerun validate the actor, effective user,
credential id and generation, grant, token, principal activation, and both
grant/token deadlines directly against the protected catalog without retaining
the bearer. That rerun check precedes both full queries and delta fanout, closing
the interval between a durable revocation commit and asynchronous topology
cleanup. Scoped-token expiry owns a socket deadline and publishes the same
terminal code with reason `expired`.

Grant revoke and bulk revoke-by-actor project their committed token-id witnesses
through the terminal lifecycle just like rotation, cap eviction, and
`revoke-self`. Registry removal, exact-fence room/outbox purge, live-subscription
topology purge, and terminal `delete` notification therefore share one carrier
cut. Two tokens on one durable grant have distinct effect fences: ending token A
removes only A's connections and query instances; token B continues to act.
Retained/offline service-principal reads remain refused as the v1 plane boundary
requires.

The headless kit now has a separate `AgentAuthorityFence`; it does not reuse the
browser `AuthCoordinator`. Its durable custody record names the explicit
`(actorUserId, credentialId, credentialGeneration, grantId)` tuple, while its
memory-only fence tracks the current `(tokenId, carrierGeneration)` live axis. Every HTTP result, raw or
managed socket frame, live update, receipt, and overlay publication is marked
with the captured carrier and compare-and-committed before exposure. Token
replacement increments the carrier generation, closes transports, and clears
connection grants; when the durable tuple is unchanged, the server-issued
authority descriptor remains bound and queued replay continues. A tuple change
increments the durable epoch and deletes predecessor state before successor
publication. The reference Node custody adapter persists a versioned
tuple/epoch/revision/phase primary record with exact transactional
compare-and-set and cross-process locking; bearer bytes, token ids, and carrier
ids remain memory-only. Beside the format-2 primary row, custody keeps an exact
terminal ledger: 64 deterministic SHA-256 buckets with at most 64 tuple entries
per bucket by default. Each entry retains only the closed
`(actorUserId, credentialId, credentialGeneration, grantId)` tuple and its
derived key. It never contains a bearer, token id, or carrier generation. The
fixed geometry permits at most 64 bucket partitions and 4,096 exact entries;
hash concentration can exhaust one bucket earlier. Rather than evict evidence
or admit a false negative, the first overflowing insert advances the root to
`closed`, after which every tuple is terminally refused. Root closure and
entries are monotonic.

Main-row reads and writes, ledger reads and writes, migration, and final
publication comparisons serialize through one reserved custody gate. The
terminal process establishes exclusion before even reading or validating the
primary row, so corrupt primary bytes may reject settlement but later repair
cannot reopen the tuple. Every active install, adoption, confirmation, and
publication comparison consults the exact bucket; a distinct proposed tuple
cannot delete the active primary row, and a fresh null-CAS loser re-enters the
gate before deciding whether the winner is its predecessor. Before a distinct
active tuple replaces a pre-ledger `settled/deleted` primary tombstone, the
reader absorbs that old tuple as terminal evidence under the same gate.

Migration treats the old tuple-specific v1 witness files as a compatibility
journal. A new root begins `preparing`; under the universal gate the migrator
captures one bounded directory snapshot and idempotently unions every
identifiable, structurally owned v1 witness into its bucket, then advances the
root to `active` (or `closed` on overflow). While the
root's `legacyCut` is false, a new terminal verdict always settles its v1
witness *before* writing the v2 bucket. Before a closed root is committed beside
a still-v1 primary, the exact current primary tuple is also journaled for an old
reader. Only an active/closed ledger may accompany the format-2 primary cut.
After that cut, the migrator retires each identified witness's JSON record and
SQLite lock carrier, fsyncs those removals, and only then advances `legacyCut`
false-to-true. The cut is therefore a cleanup seal: a crash before it repeats
the bounded migration snapshot, while steady v2 gates never scan the shared
directory. A straggling v1 terminal process can still write its journal witness
before reading and rejecting the format-2 primary, so every candidate check
derives that tuple's exact v1 partition, strictly reads it, absorbs it, and
retires both files before it can compare publication authority. Crashes at every boundary replay
monotonically: before the primary cut old readers retain exact v1 evidence;
after it their strict v1 primary decoder refuses format 2, while new readers
finish the root cut and cleanup without ignoring a straggler witness.

Storage advertises `partitionOwnership: "partitioned-v2"`. Its gate owner must
provide independently owned `withPartition`, paged `scanPartitions`,
exact-revision `remove`, and both-file `retire` operations. An adapter backed only by one
non-reentrant global mutex, or one advertising the v1 contract, is refused
before synchronization. Ownership callbacks are non-reentrant; caller custody
ids cannot collide with reserved internal namespaces; derived ids use a
separate larger bound. Filesystem v1 names are opaque hashes: invalid JSON
cannot be reversed to prove which custody produced it. Migration therefore
leaves an unidentifiable record untouched. This cannot authorize its tuple:
every post-cut allow/replace path still derives the candidate's exact hashed
filename and validates those bytes strictly, so a malformed related witness
fails closed while malformed unrelated bytes remain isolated. Identifiable
records classified as this custody are validated strictly during migration.
Filesystem scans examine at most 4,096 directory entries and otherwise fail closed with
`SNAPBACK_AUTH_CUSTODY_PARTITION_SCAN_LIMIT`; a legacy corpus above that
supported migration budget requires operator custody-store rotation and never
publishes a format-2 primary from a preparing root.

This remains an on-disk coordination-protocol change. Drain and upgrade every
process sharing a custody directory together; mixed execution is not a
supported availability mode. The compatibility journal and primary-format cut
make an interrupted rollout fail closed rather than forget terminal evidence:
a v1 process sees the exact journal until the cut and rejects the format-2 row
afterward. `inspectCustody()` reads only the root and its at most 64
deterministic buckets; it exposes ledger format/state, unique witness count,
exact stored v2 bytes, capacity, the 75% warning
thresholds for total and per-bucket pressure, the largest bucket count, and a
warning bit. It never exposes tuple identities. Closed state always warns.

The filesystem adapter accepts only a normalized absolute custody path. It
rejects untrusted lexical symlinks, untrusted or replaceable resolved ancestor
owners, unsafe ancestor ACL grants, and a custody directory that is not an
effective-user-owned real `0700` inode. After that validation, one dedicated
helper compares the exact device/inode/owner, changes into that directory, and
retains the kernel CWD reference for the process lifetime. POSIX resolves every
single-component lock, record, temporary, rename, unlink, and directory-fsync
operation relative to that retained inode (`AT_FDCWD` semantics); the
configured pathname is never resolved again. The helper that opens the
relative SQLite lock and holds `BEGIN IMMEDIATE` is also the only process that
can compare or replace the corresponding record, so helper death releases the
lock and eliminates the stale writer together. Directory-name replacement at
any later cut cannot split lock and record custody.

Lock, record, and temporary files must be effective-user-owned, single-link
regular `0600` files without access-expanding ACLs. Record reads use
nonblocking bounded I/O capped at 64 KiB and revalidate the opened and named
inode after the read. Each partition has one deterministic `<record>.tmp`
sidecar, so acquisition checks exactly one name and can retain at most one
64-KiB crash orphan; it never walks the shared directory. SQLite may also use
one deterministic `<lock>-journal` sidecar while its rollback-mode transaction
is live or recovering. A clean release removes it; helper death may leave it as
fixed recovery input for the next SQLite acquisition, never as a new logical
partition. The rule applies equally to primary, ledger-root, bucket, and
transient legacy-witness partitions. A conforming format-2 custody is
physically bounded by one gate, one primary, one root, at most 64 bucket
partitions, and their fixed record, lock, rollback-journal, and temporary
names. Preexisting opaque v1 or corrupt files are bounded by the 4,096-entry
supported migration corpus globally, but an unidentifiable hash cannot
honestly be attributed to one logical custody; it remains strict candidate
evidence until operator custody-store rotation.

Witness retirement is valid only while the universal gate is held. Every
conforming v1 and v2 `AgentAuthorityFence` takes that same gate before a witness
partition, so no old writer can own the lock when v2 unlinks its carrier. A
retirement dispatch consumes that partition owner: read, replace, remove,
scan, nested ownership, and repeated retirement all fail with
`SNAPBACK_AUTH_CUSTODY_LOCK_LOST`; only release is allowed, and only a later
ownership interval may use the partition again. The helper first terminalizes
its session and cleanly rolls back and closes SQLite while the stable lock
pathname still exists. It then unlinks and fsyncs the lock, followed by the
validated JSON record and another directory fsync. A helper crash before the
clean close can leave the deterministic rollback journal, which the next
SQLite acquisition recovers and removes. Every crash checkpoint after the
close is journal-free. After any crash, either the discoverable JSON remains
or the bucket entry is already durable. Calling partition-adapter primitives
directly without the gate is outside this protocol and receives no anti-ABA
guarantee.

An ownership callback is also a structured asynchronous boundary. Every
`read`, `replace`, `remove`, `retire`, scan, and nested-partition operation is
registered before it can yield. Callback return or throw first closes the owner
to new starts, then joins the exact registered promises, and only after their
settlement releases the in-memory gate or filesystem capability. Rejections
are observed immediately so a missed await cannot become an unhandled process
event; an explicitly awaited/caught CAS refusal remains the callback's concern,
and a callback or physical-release failure keeps its existing precedence. A
hung missed-await child therefore keeps the universal gate closed rather than
creating a second-owner interval underneath live predecessor work.

The parent capability's request and session correlations and the helper's hook
correlations are positive safe integers with no wrap or saturation reuse. The
last safe value may complete its predecessor operation; the next allocation
terminalizes that retained capability lineage, closes helper sessions (thereby
releasing SQLite ownership), rejects all pending correlations without map
replacement, and returns
`SNAPBACK_AUTH_CUSTODY_CORRELATION_EXHAUSTED` thereafter. A process restart is
the only way to obtain a fresh correlation space and revalidate the directory
capability; exhaustion never silently respawns a helper against a pathname.
At most 32 distinct directory capabilities may be retained per process.
Capabilities are never idle-evicted, because re-resolving a pathname would
reopen the ABA; a helper that dies permanently closes that process's view until
an explicit process restart. This is process custody against other OS users
and pathname replacement, not protection against a malicious process already
running as the same effective uid and mutating entries inside the pinned inode.

A fresh process, a different configured tuple, interrupted-transition recovery,
and live credential replacement all require a strict scoped-token handshake
whose exact service descriptor matches the proposed tuple before any custody
write. An invalid proposal leaves the predecessor record byte-for-byte intact.
Contract registers its physical durable store before that recovery handshake,
so a persisted clearing intent cannot settle without replaying the store's
epoch-bound deletion. Protocol-v1 construction without either browser custody
or this agent custody remains refused.

Terminal handling classifies the server's explicit `carrier` versus
`durableDelete` disposition against the captured authority. Missing, malformed,
or close-only diagnostics are conservatively carrier-local and never authorize
durable deletion. The finite HTTP path awaits the accepted terminal barrier,
and all result publication, transport creation, and durable replay effects are
fenced against the exact persisted capture. Counter exhaustion closes the
fence permanently rather than wrapping or reusing an authority identity.
An accepted durable deletion snapshots its mandatory local stores before any
callback. It attempts exact-key purge after the terminal-witness attempt even
when that attempt or primary counter planning fails, and re-purges after any
interrupted clearing replay that could rebind the tuple. Unregistration cannot
resolve ahead of a snapshotted cleanup callback, including when requested from
the synchronous confidentiality cut.
For durable Agent custody, exhaustion commits a terminal `exhausted` marker
that retains the exact closed durable tuple but strips all bearer, token, and
carrier material whenever one revision remains. The tuple is necessary to
identify the permanently poisoned authority and is not credential-secret
persistence.
A legacy non-terminal record already at the maximum revision is durable poison
on every read: it blanks publication and is never accepted as current merely
because no further compare-and-set is representable.

Queued acknowledgement is authorized on the same opaque descriptor axis as
settlement, not merely on the effective-user fingerprint. This matters for two
grants delegated to the same effective user: knowledge of another grant's
opaque client-mutation id cannot acknowledge or delete its settlement row.

## Implementation checkpoint: G7 lifecycle completeness (2026-07-16)

The durable and carrier endings implemented through G3 and G8 now cover grant
revoke, actor bulk revoke, credential rotation, `revoke-self`, token-cap
eviction, scoped-token expiry, and agent deactivation witnesses. Retained live
authority revalidates the exact actor, credential generation, grant, token,
effective user, deadline, and each immutable `{fn, kind, basis,
authorityCreating}` scope entry before every full rerun or delta fanout. A
same-mode manifest activation reconciles scope bases in its existing event-2
transaction; before successor admission reopens, a retained service query on a
tombstoned shape receives a host-branded `delete` disposition and terminal
resolution, never a retryable quarantine or successor snapshot. The public
diagnostic remains `SNAPBACK_AUTH_GRANT_SCOPE_DENIED`; its terminal brand is
process-local and cannot cross or be forged through JSON.

This checkpoint does not claim all of G7 closed. Owner invitation,
owner-deactivation, owner re-credentialing, and revoke-all compromise routes
remain the G2 delivery/lifecycle work described above. Logical export/import
has since landed as a closed credential-free format: exact-v2 empty-catalog
import preserves ownership/deactivation/scope bases, rotates authorization
incarnation atomically, and resurrects no excluded authority. Declared restore
and auth downgrade continue to purge agent authority with their existing
no-resurrection acceptance coverage. The remaining owner/operator trigger
surfaces must land or be explicitly re-scoped before the G7 ticket can close.

## Implementation checkpoint: G6 authority-creating effects (2026-07-16)

The two-gate effect system is implemented. Codegen derives
`authorityCreating` from every declared write to a hand-authored
`permissionBacking` table and preserves an author's conservative explicit
marker. A marked entry point under `servicePrincipal` requires the exact
resolved `{fn, kind}` scope to carry authority-creating consent; an ordinary
matching scope fails typed before execution. Tier expansion and basis
invalidation continue to use the previously landed marker state.

The authoritative gate lives on the runtime effects. The prepared invocation's
exact consent bit rides the host-owned membership writer, so unmarked wrappers,
aliases, computed property access, and data-dependent paths cannot launder a
membership write. A service principal may write a membership declaration only
when its scope was explicitly consented and the declaration carries
`provenance: "full"`. Raw Ibex writes to any non-membership permission-backing
table are refused for insert, patch, and delete even with consent. HostPlan
mutations are refused at their pre-execution effect seam because that lane
cannot attach full membership provenance.

Acceptance covers the consequence as well as the refusals: a consented
delegate seats its own actor as a durable `host`, revocation ends the grant but
does not erase the membership, creation provenance retains the actor,
effective user, and dead grant id, and a later autonomous role check succeeds
from that row. The new typed diagnostic is projected as HTTP 403 and included
in the reviewed production diagnostic inventory.

## Implementation checkpoint: finite service authority fencing (2026-07-16)

Finite scoped-token use now carries an exact process witness from durable
resolution through final publication. The witness binds token, grant, actor,
effective user, credential generation, and token/grant deadlines. It is used
by query, mutation, action, `/auth/session`, connection-open, retained live,
and every later connection act. A terminal storage operation plans the exact
affected token ids read-only, premarks those fences before its first write,
then settles only its own ticket after known commit, known rollback, or an
exact durable reconciliation. An uncertain outcome blocks only that planned
set; it never quarantines unrelated service principals.

The two ending axes remain separate. Token revoke, expiry, and cap eviction
terminalize the carrier only. Grant expiry/revocation, credential rotation or
revocation, and principal deactivation terminalize durable authority. A
terminal cause is chosen from the committed operation, not reconstructed from
a generic invalid-token error. Monotonic-observed token or grant expiry is
persisted through the same exact terminal transaction before any finite or
live surface publishes terminality, so restart cannot revive it under a lower
wall sample.

Detached Ibex actions also fence native network initiation. Application input
is normalized first; `Begin` reserves the exact authority; the trusted native
enqueue occurs synchronously; and `Initiated` is acknowledged exactly once in
`finally`. A terminal transaction that has premarked first prevents enqueue;
one that arrives after `Begin` waits only for that bounded native initiation
cut, not for the network response.

## Dated amendment: app-CLI scoped-token release (2026-08-01)

LLP 0062's process-per-command agent lane changes the desirable scoped-token
shape without changing the durable agent/grant model: every invocation mints a
fresh, short-TTL carrier and must be able to end that exact carrier as soon as
the command settles. Waiting for the ordinary one-hour default would make a
sequential agent workload fill the ten-token grant family and evict unrelated
work. The following contract is therefore part of the v1 agent surface.

### Receipt and scheduling authority

`POST /auth/agents/token` adds `actorUserId`, `effectiveUserId`, and
`expiresInMs` to its existing secret response. The actor and effective fields
are server-resolved from the credential and grant; they are receipt facts, not
caller-selected input. A credential-owning CLI must compare the complete
durable tuple `(actorUserId, effectiveUserId, credentialId,
credentialGeneration, grantId)` with its reference-only profile before
constructing `AgentAuthorityFence`. A substitution is terminal and the newly
minted token is released before the command refuses.

`expiresAtMs` remains an absolute audit fact. `expiresInMs` is the scheduling
authority: it is computed by the server from the same rollback-checked `now`
used by minting, after both the requested TTL and grant expiry have been
applied. A client never compares its wall clock with `expiresAtMs` to decide a
renewal. LLP 0062's Node engine requests 130 seconds by default, within this
RFC's one-hour default and 24-hour maximum; the server remains the authority
and may return less.

### Exact release primitive

`POST /auth/agents/token/release` accepts the closed body `{ token: sbagt_ }`,
accepts no `Authorization` header, installs no invocation principal, and
returns an empty `204` with `Cache-Control: private, no-store`. Knowledge of a
scoped token can end only that exact carrier. The server resolves the stored
token id including an already-revoked row, acquires the finite
service-authority terminal gate with `Carrier` disposition, idempotently sets
`revoked_at_ms`, and projects the exact token terminal event to any bound live
connection. A retry after a lost `204` therefore succeeds identically; an
unknown or swept token receives the ordinary non-enumerating
`SNAPBACK_AUTH_SCOPED_TOKEN_INVALID` carrier refusal. Durable credentials and
grants are untouched.

The route has its own per-carrier throttle bucket (240 attempts/minute),
separate from mint and every other agent-management route. Its request body is
secret-classified for ingestion/redaction even though its response is opaque:
the `sbagt_` value never enters logs, diagnostics, receipts, inspection, or an
`Authorization` header. Redirects are terminal and a second hop is never
attempted.

The token-mint route's independent floor is raised to 600 attempts per minute
for this process-per-command client. That admits the specified sequential
burst of hundreds without turning completed short-lived commands into their
own throttle. The increase remains credential-and-grant bound: minting still
requires a live long-lived credential and a live grant, while malformed
traffic stays in the route's separate bounded source bucket. The ten-carrier
grant cap and the client admission ledger remain the concurrency controls;
the mint rate is not used as a substitute for either.

### CLI custody and admission

The LLP 0062 reference profile is a closed version-1, mode-0600 POSIX file. It
stores only target origin, app id, grant id, actor/effective user ids,
credential id/generation, and a durable credential *reference* (an absolute
mode-0600 file or a named environment variable); it never stores `sbac_` or
`sbagt_` plaintext. Every ancestor and file passes ownership, symlink,
single-link, mode, and byte-bound checks before a credential is read. The Node
engine refuses credentialed use where POSIX ownership/mode semantics are not
available.

Agent credentials are presented only to a literal loopback origin and only
after the connected peer is rechecked as loopback; hostname inference and
redirect following are forbidden. Pairing challenges enter through stdin or a
mode-0600 file, never argv or an environment variable. On approval, the CLI
writes the reference-only profile and immediately releases the pairing poll's
first token.

Across processes, admission is keyed by normalized `(target origin, app id,
grant id)` under an owner-only directory. The target-advertised
`perGrantTokenCap` is authoritative; the ordinary one-shot capacity is
`max(1, cap - 2)`, reserving two carriers for a watch and renewal cut. Slot
leases expire with the requested short token lifetime, so a killed process
self-heals. A command acquires a slot before reading the credential or minting,
releases the token (one retry, then TTL as crash-safe backstop), and only then
releases its slot. Above-cap work waits within a bound or refuses typed; it
never mints the eleventh carrier and silently evicts a sibling. Sequential
bursts release promptly and therefore do not self-throttle.

This amendment reconciles the earlier pairing prose: re-poll still
revoke-and-replaces a prior pairing-request token at the server, but the
process-per-command reference client treats that token as a one-use receipt,
persists only its durable tuple, and releases it immediately.

## Dated amendment: per-app `asset-callbacks` service principal (2026-08-03)

Ruled by the author at decision sitting #2
(`issues/20260803-author-decision-sitting-2.md`), resolving
`issues/20260731-0044-sessions-callback-authority.md` as its option (a):
LLP 0044's sessions-mode asset lifecycle callbacks execute under a
**per-app scoped service principal named `asset-callbacks`**, minted per
app in this document's principal vocabulary. Its grants are scoped and
auditable like any service-principal grant — the audited grant
vocabulary is reused rather than inventing a new authority class — so
receipts keep "who ran this" explicit. The `ctx.auth` projection and
commit-time validation obligations of the class are recorded in LLP
0039's matching dated amendment; the classification here is the
0039/0055-side prerequisite the ticket required before implementation.

**Implemented 2026-08-04.** `crates/snapback/src/storage/auth_asset_callbacks.rs` maintains one
protected-catalog agent principal per app and one immutable exact-function
grant per callback mutation. It mints no user session, credential, scoped-token
secret, or owner bearer. Fresh execution and commit both revalidate the app
provenance, principal, live grant, and current scope basis; mutation receipts
retain the ordinary authority binding, and the asset work-completion receipt
explicitly records the service actor and exact grant.

## Dated amendment: LLP 0204 integration registrations and watch anchors (2026-08-08)

**Commissioned by:** [LLP 0204](./0204-app-external-surfaces.rfc.md),
especially D7, D8, D9.3, and the OQ11 ruling.

**Status:** `External-automations bundle` (2026-08-10) implements watchAnchor
issuance, revocation coupling, and renewal. `S2 Landing A` (2026-08-09) makes the integration registration
class, record, suspension, and `integration.retire` lifecycle verb reachable;
`S2 Landing C` implements DCR and the local OAuth authorization-code facade.
The remaining amendment text records the governing design. This
amendment does not widen scoped-token routing:
scoped tokens still address exactly the app-data invocation gate and
`POST /connection/open` pinned in [§Routes and credential classes](#routes-and-credential-classes),
and scoped-token minting of capability links is deferred to LLP 0204 D9.4's
granted-link amendment set.

### Integration registration class

The principal model gains a named **`integration` registration class**. It is
still a `kind: "agent"` principal rather than a new principal kind, but its
authority profile is delegation-only. This is a necessary refinement of the
existing registration behavior: [§Registration](#registration) says that an
`auth.agents.template` grant is minted as an explicit registration step, and
[§Re-credentialing](#re-credentialing-recovery-and-the-production-profile-invariant)
says owner re-credentialing re-applies the current autonomous template. For an
integration-class principal, template application is suppressed at **both**
sites:

- registration, including DCR-backed registration, never creates the
  `auth.agents.template` grant; and
- owner re-credentialing never re-applies that template to the integration.

The token mint predicate extends the one in [§Grants](#grants): an integration
credential may mint only against a live **installation grant** — a delegated
grant whose actor is that integration principal, whose effective principal is
the consenting user, and whose provenance binds the integration registration
and installation ceremony. It refuses autonomous grants, template grants, and
ordinary delegated grants lacking that installation lineage. Integration
principals cannot hold autonomous memberships; any membership or grant that
would authorize the principal without an effective consenting user is invalid
for this class.

Manifest activation and import/migration validate the class invariant before
admission opens. A record with a template-derived grant, an autonomous grant,
an autonomous membership, or an installation whose actor does not match the
registration is refused for explicit repair; activation and migration do not
silently delete or reinterpret authority. These checks supplement, and do not
weaken, the existing live credential/grant checks in [§Grants](#grants).

### Installation does not seat integration ownership

The approval-link ownership rules in LLP 0150
[§2, “What approval of a first-contact request creates”](./0150-agent-token-acquisition.rfc.md#2-the-approval-link-flow-agent-initiated-consent-without-the-oracle)
normally seat the approver as owner under `open`, and under user-`invited` seat
the invitation creator while requiring approver = inviter. Integration-class
registrations expressly displace **both** rules: approving an installation
never seats or transfers ownership. In `invited` mode the inviter is recorded
only in immutable registration provenance, not as owner. Operator-minted
invitations remain unowned as LLP 0150 already specifies.

An integration record may gain an owner only through a distinct ceremony that
proves possession of the integration credential/key, or through an operator
action. The operator ownership-claim arm is dev/test/demo-only and refused on
`prod`, matching the host invariant that the operator plane on `prod` may end
agent authority but never create or assume it. Before committing the claim,
the ceremony renders and binds into its receipt the ownership-assumption
disclosure required by
[§Principal kinds](#principal-kinds), [§Re-credentialing](#re-credentialing-recovery-and-the-production-profile-invariant),
and [§Grants](#grants): ownership includes the power to re-credential and to
assume any surviving membership authority the principal holds. The disclosure
is mandatory even when the integration-class checks currently find no
autonomous membership; an empty present set does not narrow the ownership
capability.

Once an owner exists, the existing owner re-credentialing verb retains its
exact semantics: it terminally revokes every grant for fresh consent and does
not become hygiene rotation
([§Re-credentialing](#re-credentialing-recovery-and-the-production-profile-invariant)).
On `prod`, that owner path remains delivery-gated by LLP 0045 because its
operation-bound step-up challenge must reach the human
([§Landing decomposition](#landing-decomposition)). Until that delivery seam is
available, the operator's ending-only integration-retirement arm below is the
backstop; no operator re-credential/assume path is introduced on `prod`.

### Integration retirement

The lifecycle gains the terminal verb **`integration.retire`**, invokable by
either:

- a caller proving possession of a live or attributable tombstoned credential
  in the integration's credential family; or
- an operator satisfying the destroy-class policy.

Retirement atomically marks the integration record revoked, destroys the whole
credential family, terminates its tokens/connections/queued carriers, and
terminally revokes **every installation grant** issued to that integration.
Every user must complete fresh consent before any successor registration can
act. This is the unowned integration record's non-operator global kill path; it
does not redefine `POST /auth/agents/rotate`, which remains the
grant-preserving generation bump described in
[§Credentials and tokens](#credentials-and-tokens), and it does not replace a
user's existing right to revoke only their own installation.

The key-holder arm inherits the tombstoned-family proof obligations of
`revoke-self` in [§Credentials and tokens](#credentials-and-tokens): a bare
public thumbprint or family identifier proves nothing; attribution is
proof-bound, destroy-only, idempotent, retained only for the bounded family
horizon, and reveals no data. The operator arm inherits at least the production
protection on the existing kill verbs in
[§Routes and credential classes](#routes-and-credential-classes): on `prod`,
`AdminWrite` alone and the browser console credential are insufficient;
`AgentDestroyCapability` on its domain-separated non-browser carrier is also
required. Retirement has greater blast radius than those verbs — credential
family plus all installations — so an implementing spec may strengthen but
must not weaken that floor.

The LLP 0031 `S2 Landing A` dated amendment records the landed wire and
host-operation spellings, atomic transition, and registry rows;
`integration.retire` is now a reachable verb.

### Dynamic client registration under the registration modes

RFC 7591 dynamic client registration (DCR) consumes the same
`auth.agents.mode` policy described in [§Registration](#registration); it is
not a bypass or a second mode:

- `disabled` refuses **new integration-principal creation**. It does not
  disable an existing integration or prevent an existing integration from
  requesting another user's installation grant through fresh consent — the
  same new-principal-only boundary [§Registration](#registration) states for
  existing agents;
- `invited` accepts DCR when the request carries a live `sbagi_` creation
  invitation from the source selected by `invitedBy`. The registration
  transaction revalidates the current mode, `invitedBy` value, invitation
  class, creator, reservation, expiry, and single-use state, then consumes the
  invitation atomically. Under `invitedBy: "operators"`, an operator-minted
  invitation remains consumable under the existing consumption-site profile
  gate: it is accepted on dev/test/demo, refused at consumption only on
  `prod`, and yields an unowned integration record. Production registration
  therefore remains user-invited or `open`, per LLP 0204 D1. The inviter is
  retained as provenance only under the ownership exemption above; and
- `open` creates an unowned, provisional integration-class record. DCR creates
  no installation and no authority; each installation still requires that
  user's consent.

This uses the invitation reservation/consumption contract that LLP 0150
[§2](./0150-agent-token-acquisition.rfc.md#2-the-approval-link-flow-agent-initiated-consent-without-the-oracle)
already specifies, while changing only the integration ownership result named
above.

### Watch-anchoring grants

The delegated-grant lifetime in [§Grants](#grants) has a 90-day hard maximum
and treats renewal as fresh consent. LLP 0204 OQ11 commissions a distinct
**`watchAnchor` grant profile** for durable watches. It may live longer than
that ordinary delegated maximum, but it is strictly narrower:

- it binds one immutable watch id, exactly one exposed query with its canonical
  argument/template digest, and exactly the declared reaction scope;
- it contains no tier wildcard, cannot authorize an ad hoc wire invocation,
  cannot be reused by another watch, and cannot gain scopes through manifest
  growth;
- every scheduled evaluation and firing revalidates the anchoring principal,
  integration/installation where present, grant, query basis, reaction basis,
  and watch status before work or external effects begin; and
- the user may revoke it instantly. Revocation cancels pending firings,
  terminates retained evaluation, and kills the watch under the same
  grant-scoped terminal disposition used by
  [§Ending authority](#ending-authority-revocation-expiry-deactivation).

The implementing spec must choose and publish the longer finite lifetime and
renewal ceiling; this amendment does not invent an unchecked indefinite grant.
A suspended or deleted anchoring principal kills the watch. For an
integration-owned watch, suspension of the integration admission record also
stops evaluation immediately; resumption never substitutes for re-consent to a
revoked/expired watch anchor. Every reaction remains separately admitted and
journaled under LLP 0204 D9.3.

**Implementation checkpoint (S5 Landing B, 2026-08-09).** The first shipped
anchor profile is the user-owned `revalidatePrincipal` arm. Creation requires
a live provider session, but stores no session credential; the record pins the
user and authority-instance ids, exact query/reaction identities and scope
bases, and expires 365 days after creation. Scheduled evaluation reconstructs
credential-free owner authority and revalidates principal activity, both
function identities and bases, exposure, expiry, and watch status before any
query or reaction. Revocation, replacement, expiry, deletion, or principal
deactivation makes the watch terminally `dead` and prevents retained work from
acting.

The renewal ceiling is 365 days from a renewal's fresh-admission instant.

**Implementation checkpoint (external-automations bundle, 2026-08-10).** An
active delegated integration may now create `capturedGrant` watches. The watch
and its ordinary `_auth_grants` watchAnchor row are inserted in one SQLite
transaction. The grant actor is the integration principal, the effective user
is inherited from the live installation grant, `created_by` binds the immutable
watch id, and the consent digest binds that id, installation grant, canonical
query-argument digest, reaction digest, optional webhook URL, exact scopes, and
expiry. Function reactions carry exactly the live-query and reaction scopes;
webhook reactions carry exactly the live-query scope while the signed webhook
target is bound in the same consent digest. There is no tier expansion.

The watchAnchor lifetime and renewal ceiling are both 365 days. A fresh user
session may renew only its own still-live integration watch through
`POST /watches/{id}/renew`; the transaction revokes the predecessor grant,
mints the equally narrow successor, and advances the watch anchor by no more
than the ceiling. The installation grant, integration record, watchAnchor,
scope bases, digest binding, and watch status are reloaded before every
evaluation, reaction, and webhook network initiation. Revoking either the
watchAnchor or its installation grant marks the watch dead in the revocation
transaction and clears pending firing state.

### Pending-effect authority snapshots

**Implementation checkpoint (S5 Landing C, 2026-08-10).** LLP 0204 D9.5's
pending-effect record freezes the original service caller's actor,
credential id and generation, grant id, token id and deadline, and optional
effective user. Approval does not turn the approving user into the executing
principal. Immediately before the effect decision, the protected catalog
re-resolves that exact tuple and rechecks current credential generation,
credential/principal activity, grant status and expiry, scoped-token status
and expiry, effective-user equality, scope bases, and integration suspension.
A rotated/revoked/suspended or otherwise stale tuple refuses the effect and
appends the coded terminal transition; it never falls back to the approver's
authority or mints a replacement token.

Non-link effects use dynamic local approver policy: the session user must
currently be allowed to invoke the underlying function. Link-originated
effects are the OQ9 exception and bind the minter principal as the sole
approver while still revalidating the live minter/link lineage. These records
are consent intents, not grants, tokens, or new authority carriers.

### Suspension is not revocation

An integration record's `suspended` status is a reversible admission-layer
state. While suspended it refuses new token mint, invocation, watch evaluation,
and new installation ceremonies, but it does not itself revoke, renew, or
replace any installation consent. Resumption merely removes that admission
block and re-runs all ordinary live checks; only installations and watch
anchors that remain independently live, unexpired, and unrevoked may act.
Consent revoked or expired during suspension never resurrects.

This reversible suspension delivers the immediate-stop half of LLP 0204 D7's
operator-suspension sentence without claiming terminal revocation.

This is deliberately separate from the terminal transitions enumerated in
[§Ending authority](#ending-authority-revocation-expiry-deactivation), from
owner re-credentialing's all-grant revocation, and from `integration.retire`.
Those verbs remain terminal. Implementations and operator UI must never label
suspension as credential/grant revocation or infer fresh consent from
resumption.

## Dated amendment: LLP 0204 granted capability links (2026-08-10)

**Commissioned by:** [LLP 0204](./0204-app-external-surfaces.rfc.md), D9.4,
the OQ9 ruling, and the 2026-08-10 author sitting's full granted-operation
extension.

**Status:** commissioned design only. No granted-link mint, carrier, resolved
authority, route, read, or write is implemented or capability-claimed by this
amendment. The external-anonymous S5 Landing A carrier remains the only shipped
capability-link invocation carrier.

### Bounded service-principal authority for a possessor

A **granted capability link** is a service-principal authority class with a
different carrier. The request presents the capability-link URL secret rather
than an agent credential plus scoped token. Possession proves only authority to
attempt the one invocation bound by the link; it does not authenticate the
possessor as the minter, an agent principal, or the effective principal.

The mint transaction creates one immutable **link grant** with its own
`linkGrantId`. Its resolution is exact:

- **actor** — `capabilityLinkPossessor { linkId }`, a sealed carrier actor with
  no `userId`, credential, credential generation, token, membership, owner, or
  registration record. Audit must not attribute the invocation to the minter;
  the minter appears only in lineage;
- **effective principal** — the effective principal carried by the admitted
  minting authority. A granted link therefore requires a minting authority with
  an effective principal: a direct session or a delegated
  `ServicePrincipal`. Anonymous, `AdminBypass`, `System`, dev-impersonation,
  and autonomous service-principal authority cannot mint this carrier; and
- **grant** — the immutable link grant, whose ceiling is the exact intersection
  of the minting authority, the app's current authorization for the effective
  principal, the one exposed function's `{fn, kind, basis}` scope, the
  validated argument template, expiry, and optional use count. It has no tier
  wildcard, cannot gain reach through manifest growth, cannot address another
  route or function, and cannot mint a scoped token or connection grant.

The link grant records a sealed `minterAuthorityRef`. For a delegated
`ServicePrincipal` this includes the parent `grantId`, minter actor principal,
and effective principal. For a direct session it includes the session's
server-derived principal and authority-instance lineage; this is the
session-as-degenerate-grant case described in [Summary](#summary), not a
caller-supplied identity. Every response and durable journal projection keeps
`linkGrantId`, `linkId`, `minterAuthorityRef`, and the effective principal
distinct. No projection may collapse the possessor actor into the minter.

LLP 0058's matching dated amendment adds the named sealed resolved-authority
variant and handler projection. It is the only shared-gate construction path
for this carrier; no generic bearer fallback, body authority, or anonymous
projection may exercise the link grant.

### Mint is a scoped delegation operation

Minting a granted link consumes authority; ordinary permission to call a
function is not by itself permission to publish that authority as a bearer
URL. The closed scope vocabulary gains an exact-function
`capabilityLinkMint` operation. A delegated service principal must hold that
operation for the same `{fn, kind, basis}` in addition to its ordinary call
scope. A direct session reaches the same host-owned mint gate under the
effective user's current function authorization and app policy. The mint gate
runs before the link secret or link grant exists and refuses tier/wildcard
delegation.

The child ceiling must be a subset of the minting authority at creation and at
every use. The mint transaction binds the current exposure declaration,
function kind and scope basis, canonical pinned/caller-argument template,
effective principal, minter lineage, expiry, use bound, and mutation posture.
Changing a caller-supplied argument cannot select a broader function, scope, or
effective principal; ordinary schema validation precedes the function gate.
The expiry is `min(requested, 30 days, parent authority remaining)` with a
7-day default, so a child cannot outlive its parent and app source cannot raise
the platform maximum.

### Lineage and the existing lifecycle verbs

A granted link never becomes independent authority. Invocation reloads the
link grant and revalidates its unexpired/unrevoked state, the effective
principal, current exposure and function basis, minter lineage, parent grant
where present, integration admission where present, remaining use count, and
the ordinary function authorization gates before preparing a handler.
Revoking or expiring a parent grant terminally kills every descendant link
grant; the link cannot be reminted or rebound without fresh live mint
authority. Direct link revocation remains instant and exact-link-scoped.

The credential verbs keep their actual LLP 0055 meanings:

- `POST /auth/agents/rotate` is the grant-preserving hygiene rotation. A
  descendant link does not compare the mint-time `credentialGeneration` or
  `tokenId` at use, so rotation drops the minter's old token carriers and
  connections but does **not** kill a link while its parent grant remains
  live. This amendment does not reinterpret rotation as consent revocation or
  a global kill.
- `POST /auth/agents/{id}/credential` is owner re-credentialing under the
  owner's session bearer plus operation-bound step-up. It terminally revokes
  every grant; descendant links therefore die through their parent grants and
  require fresh consent before any replacement may be minted.
- `integration.retire`, user revocation of an installation grant, bulk grant
  revocation, grant expiry, principal deactivation, and terminal scope-basis
  invalidation likewise kill descendant link grants through their existing
  grant-ending semantics. Reversible integration suspension blocks use while
  suspended but does not turn resumption into fresh consent or revive a link
  whose parent grant ended.

This is deliberately parent-**grant** lineage, not mint-time token lineage.
The scoped token authorizes the mint request and then leaves no carrier
authority behind; expiry or cap eviction of that token cannot silently change
the grant-preserving lifecycle into token-bound consent.

### Reads, writes, approval, and settlement

The carrier admits the exact exposed operation named by the link grant: reads
(`query`, or the finite snapshot of a `liveQuery`) and writes (`mutation` or
`action`). Every operation still passes the ordinary auth requirement, grant
scope, effective-principal non-widening, permission-backing effect, admission,
and result controls. A link cannot invoke host operations, auth/grant
management, retained/offline reads, connection open, ephemeral rooms, or any
surface outside the registered capability-link invocation operation.

A mutation or action is valid only when **every use is approval-gated or the
link is single-use**, exactly as LLP 0204 OQ9 rules. Approval creates the LLP
0204 D9.5 pending-effect sibling; its frozen authority snapshot is the
`CapabilityLinkPossessor` tuple and link/parent lineage, not a fabricated
credential-generation/token tuple. Immediately before execution it revalidates
the link grant, parent grant, effective principal, current scope basis,
arguments, use state, and minter-as-approver rule. A single-use write consumes
its use and wins execution in one atomic admission decision. Approval,
single-use, and any `authorityCreating` effect gates compose; none substitutes
for another.

Every actual use receives a monotonic per-link ordinal and a durable pre-dispatch
journal fact containing only redacted identities, lineage, function, argument-
template digest, decision, and coded outcome. Bearer bytes and application
values never enter that journal. A refused or uncertain mutating attempt settles
to one exact result and cannot be replayed into a second effect.

### Granted-link plane boundary

Granted-link invocation is a service-principal invocation for the plane rule.
It is admitted only on **local or trusted-local** targets carrying LLP 0060's
target-authored deployment capability. Every hosted granted-link read, write,
mint through delegated authority, and approval execution is refused wholesale
under [Plane boundary](#plane-boundary), with the same structured capability/auth
diagnostic as other hosted service-principal calls. The separate hosted-gates
program must land and explicitly amend this boundary before any hosted cell may
open; serving the already-anonymous S5 Landing A link family does not imply
granted-link authority.

### Acceptance obligations for an implementing spec

The implementing spec must prove: possessor attribution never becomes the
minter; a link cannot acquire a user/principal record or membership; the child
scope is a strict subset and a function/basis change never widens or revives it;
rotation preserves a live parent grant and link while owner re-credentialing
and every parent-grant ending kill it; token expiry alone does not kill it;
suspension blocks without revocation/resurrection confusion; reads and writes
both traverse the shared gate; approval-gated and single-use writes cannot
double execute under retries or races; direct and lineage revocation win one
exact terminal outcome; and every hosted carrier/operation cell refuses before
handler evaluation.

## Status

**Review** — moved from `Draft` by the author (Charlie, 2026-07-13), who is the only party LLP 0005 permits to make that call. Refined through multiple
dual-family review rounds (fresh Claude Fable 5 Max and GPT gpt-5.6-sol ultra
reviewers, none with memory of prior rounds). The archived artifacts are the
authoritative record and count of every review — currently 14 Fable-family and
12 GPT-family rounds — recorded verbatim with provenance in
`llp/reviews/0055-agent-principals-and-scoped-grants.{fable,codex}.md`; this
prose no longer restates a round tally that drifted from them.

**Two author rulings, 2026-07-13 (Charlie), settle what the loop could not:**

1. **Altitude — ratified.** This document is an RFC, not a protocol spec. Design
   intent is pinned here; protocol rigor lands at implementation time
   (§Protocol obligations deferred to implementation). This is the same call
   Charlie ratified for the parent umbrella on 2026-07-12
   ([LLP 0039](./0039-auth-vertical-slice.rfc.md) §Protocol obligations), and it
   resolves the methodological split the two reviewer families reached — one
   holding the document to executable-protocol standards, the other to
   RFC-altitude design pins.
2. **Agents on `prod` — yes, and the loop had the design wrong.** The product
   case *is* production: real users pointing agents at real apps (§Motivation).
   The orchestrating session had framed prod agents as inherently
   "credential-fragile" because re-credentialing an existing principal is an
   impersonation effect and LLP 0039 refuses those on `prod`. That reasoning was
   sound only for the **operator plane**, and it silently assumed the operator was
   the only party who could ever re-credential an agent. **Agents have owners**
   (§Principal kinds), and an owner re-issuing their own agent's credential from
   an ordinary session is app policy — no more privileged than rotating an API key
   they already hold, and exactly parallel to `invitedBy: "users"` creation, which
   was already allowed on `prod`. §Re-credentialing now makes production continuity
   work end to end, and the residual shrinks to **unowned** agents only.

The loop earned its keep. It found — and this document fixes — defects no single
family found alone: the `sbat_` prefix collision with the shipped admin token; an
`AdminWrite`-only recovery path that would have let a browser-held console
credential capture any agent principal; a `revoke-self` design a thief defeats by
rotating twice; a delegation-widening hole via `auth.isDelegated`; a **fail-open**
`isDirectHuman` created by a *previous* round's fix; an unsound
"observationally identical projections" claim (an undeclared handler can detect
delegation by reading `sessionId` alone); and the fact — verified in
`crates/snapback/src/admin.rs` — that a residual argument resting on "`app.reset` is equally
reachable" was false, since `app.reset` is `NonProd`. Twice, both families
independently converged on the same defect.

### Review triage (round 6, /llp-super-refine)

The round-6 revision recorded dispositions in this triage; **round 7 integrated
them into the normative body** after both families correctly flagged that a
triage entry is not a body change — in particular that the body still said owner
re-credentialing "grants nothing new," contradicting the concession. Round 7
rewrote the two "nothing new" passages (§Principal kinds, §Re-credentialing) to
carry the ownership-assumption concession, added the owner-assumption disclosure
to the consent-display enumeration (§Grants step 3), put the synthetic-principal
rule in the dev-impersonation body (§Principal kinds), added the LLP 0056 M5 and
LLP 0060 prerequisites to §Landing decomposition, and added the recovery-
generation persistent-state and emergency-transfer/quarantine items to §Protocol
obligations. Dispositions (now reflected in the body, not only here):

- **Resolved in text:** non-widening narrowed to *authority* non-widening over
  reached host decisions, with the skipped-`deny()`/actor-dependent-result/egress
  limit named and the observational-equivalence claim explicitly disclaimed
  (§Resolved authority); eligibility strengthened to durable recoverability plus
  an emergency transfer/quarantine path (§Principal kinds);
  `AgentDestroyCapability` given a domain-separated `prod` carrier distinct from
  LLP 0057's dev-only `sbic_`; request-secret classification added to the LLP
  0031 obligation; the credential namespace corrected to include the shipped
  `sbc_`/`sbak_`/`sbic_`; and the revision-header/round-count provenance
  reconciled (the artifacts are now the count of record).
- **Owner re-credentialing (GPT #2) — disclosed, not redesigned.** Author ruling
  2 already settled that an owner re-issuing their own agent's credential is
  app policy. GPT's sharper point is that an owner who never held the *current*
  credential can, by reissuing, **assume third-party-granted roles the agent
  accrued** — so re-credentialing is an ownership-*assumption* capability, not an
  authority-neutral rotation. The document now says so plainly and requires the
  capability to be **disclosed at every surface where an agent receives a grant
  or membership and recorded in audit**; the sender-bound "owner authorizes
  recovery without obtaining the bearer" alternative stays a named open question.
- **`auth.kind` dev-impersonation (GPT #3):** a simulated agent kind uses a
  distinct **synthetic principal id**, so `kind` remains a pure function of
  durable identity and LLP 0043/0053 retainability holds; `--as-agent` (if 0024
  adopts it) selects that synthetic principal, never a second kind for one
  `userId`.
- **`authorityCreating` sequencing (GPT #6):** the landing decomposition gates
  every service-principal `authorityCreating` write closed until **LLP 0056 M5**
  (full provenance) and the authority-threading storage stage have landed;
  effect-site tests run through the real storage seam.
- **Trusted-local admission (GPT #11):** bound to **LLP 0060's target-authored
  deployment capability** — a reverse-proxied local process is not trusted-local,
  and profile/bind-address alone cannot distinguish them; this is an explicit
  landing prerequisite, and the 0024/0042 un-reservation carries it.
- **Attribution breadth (GPT #4):** the compromise-response guarantee is
  narrowed — revoke-all ends *future* grant-borne authority; only
  full-provenance LLP 0056 transitions are durably attributable; committed
  ordinary app mutations and external action effects may be irreversible, stated
  plainly, and whether high-impact scopes need step-up consent is an open
  question.
- **Recovery-generation state (GPT #8):** its owner (the agent record), request
  binding, and CAS/transaction ordering are named as a §Protocol-obligations
  item, with populated-catalog v1→v2 migration; the split-document suggestion is
  the author's call (altitude ratified).

The current revision incorporates the round-6 findings and has **not yet been
reviewed** — the next fresh pass follows. Depends on LLP 0039's slice and
LLP 0053 (Accepted); blocks un-reserving `servicePrincipal` in LLP 0024/0042
(trusted-local scope — hosted agents unblock when hosted auth does, an inherited
gap this RFC does not own). LLP 0011 remains the parent design; where this
document restates a contract 0011, 0039, or 0053 pins, those documents win.
