# LLP 0215: Effect budgets

**Type:** Spec
**Status:** Draft
**Systems:** Auth, Identity, Security, Abuse control, Deployment, Configuration, Diagnostics, Testing
**Author:** Charlie Cheever / Codex (gpt-5.6-sol) via Claude orchestration
**Date:** 2026-08-09
**Revised:** 2026-08-09 (v0.1 — initial commissioned Spec)
**Related:** LLP 0212, LLP 0057, LLP 0060, LLP 0011, LLP 0203

## Summary

Snapback authentication limits are **named effect budgets**, not constants
attached to routes.

A budget names the harm it bounds, the server-derived dimensions across which
it charges, the point at which its charge becomes authoritative, whether it
counts attempts or successful effects, how it recovers, and how exhaustion is
reported. The same vocabulary applies to the local single-instance target,
hosted shared limiters, and auth rehearsal grants.

This Spec is the authority for:

- budget names and their protected harms;
- the charge-axis vocabulary;
- the `ATTEMPT` and `SUCCESSFUL_EFFECT` counter classes;
- atomic charge and idempotent-retry semantics;
- server-derived trust tiers;
- deployment-profile overlay resolution;
- public and gated budget-refusal shapes;
- the composition boundary with LLP 0060's hosted bucket topology; and
- the budget vocabulary consumed by the rehearsal-grants Spec.

LLP 0057 remains the authority for its current constants until a separate
wave-2c amendment references this Spec and migrates those constants to named
budgets. Landing this wave-1a vocabulary causes no runtime, configuration,
wire, or admission behavior change by itself.

The structure in this Spec is closed. The default numeric terms for new
non-compatibility budgets and trust-tier scaling remain open questions. The LLP
0057 compatibility values are not open: their migration defaults preserve the
existing semantics exactly.

## 1. Authority, scope, and precedence

This Spec is commissioned by LLP 0212's OQ4 ruling and landing item 5.

It owns budget structure for local and hosted auth alike. It does not absorb the
contracts it composes with:

- LLP 0011 remains the authority for server-derived identity and authorization.
- LLP 0057 remains the authority for the email-code challenge, capture mailbox,
  and session protocols until amended.
- LLP 0060 §D3 remains the authority for hosted multi-bucket topology, effective
  source derivation, privacy-preserving hosted keys, atomic charge-on-denial,
  limiter failure policy, and hosted attestation requirements.
- The rehearsal-grants Spec remains the authority for grant minting, effects,
  selectors, immutable allocation ceilings, provenance, and termination.
- LLP 0203 P2 remains the authority for the rule that a gated refusal names a
  mechanically valid next move.

Where these documents compose, precedence is:

1. the owning effect protocol decides whether the requested effect is otherwise
   valid and names its linearization point;
2. this Spec decides which named budgets the effect charges and how budget
   outcomes behave;
3. LLP 0060 decides how the applicable axes become shared hosted buckets;
4. deployment-target hard bounds may tighten an app policy but never loosen it;
5. authorization, capability, assurance, and provider checks remain independent
   necessary conditions.

A budget admission never grants authority. A caller that has budget headroom
but lacks the required identity, assurance, scope, grant, or provider posture
is still refused.

A budget refusal must not reveal whether a later authorization or identity
check would have succeeded.

This Spec covers auth and identity effects. It is not a general billing,
payments, storage-metering, or application-function quota contract. A future
general effect-budget system may reuse the structure only through an explicit
amendment; shared vocabulary must not be inferred from similar names.

## 2. Normative vocabulary

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative.

An **effect** is a state transition, external handoff, expensive computation,
or authority mint whose cost or abuse potential must be bounded.

An **attempt** begins at an effect's declared observation boundary. The
observation boundary is the earliest point at which the server can safely
identify the effect and at least one required charge axis. It may precede body
parsing, credential resolution, or authorization.

A **linearization point** is the single point at which an attempt charge,
successful effect, reservation, or refusal becomes authoritative relative to
concurrent requests.

A **budget** is a stable named contract describing:

- the harm it bounds;
- the effects that charge it;
- its counter class;
- its applicable charge rules;
- its recovery semantics; and
- its refusal presentation.

A **budget rule** is one counter realization under a budget. A budget may have
several simultaneous rules, such as a per-recipient rolling window and an
app/deployment-global rolling window.

A **charge axis** is a server-derived dimension used to partition accounting.

A **charge key** is the internal canonical key for one axis or tuple of axes.
Charge keys are never accepted from request data as already-derived facts.

A **charge** is an authoritative accounting event. A charge may admit or refuse
the requested effect. Charging a refusal means the refused attempt cannot
become free traffic.

A **budget domain** separates counters that must not borrow from one another.
Ordinary auth and each rehearsal authority have distinct domains.

A **policy** binds effects to named budgets and supplies finite terms for every
applicable rule, profile, and trust tier.

A **deployment-profile overlay** is the repo-declared `dev`, `test`, `demo`, or
`prod` transformation of an app's base policy.

A **target overlay** is a deployment implementation's hard or attested
constraint. It is conjunctive with app policy and may only preserve or reduce
headroom.

A **trust tier** is a server-derived posture class used to select finite policy
terms. It is not authorization and is never caller-asserted.

A **budget refusal** is the typed result of an exhausted budget, unavailable
budget authority, missing required axis, or invalid budget policy.

## 3. Budget declarations

Every budget definition has the following logical closed shape:

```ts
type BudgetDefinition = {
  name: BudgetName
  revision: number
  harms: readonly Harm[]
  effects: readonly EffectName[]
  counterClass: "ATTEMPT" | "SUCCESSFUL_EFFECT"
  rules: readonly BudgetRule[]
  recovery: RecoveryContract
  publicRefusal: PublicRefusalClass
}

type BudgetRule = {
  id: string
  axes: readonly ChargeAxis[]
  domain: BudgetDomainSelector
  counter: CounterTerms
  tiers: TrustTierTerms
  missingAxis: "omit-by-declaration" | "refuse"
}
```

The closed harm vocabulary for this revision is:

```text
guessing
enumeration
delivery-cost
challenge-state-allocation
hash-cpu
session-minting
oauth-transaction-allocation
```

A budget MUST declare at least one harm. Adding a harm requires a versioned
amendment to this Spec.

A policy binding may attach several budgets to one effect. For example,
password verification may charge enumeration, guessing, and hash-CPU budgets
in one request.

A budget name is a stable API identifier. Renaming one requires an alias and a
compatibility decision; changing only its numeric terms does not rename it.

A budget rule identifier is diagnostic metadata, not a public API. Public
surfaces carry the budget name but not the exhausted rule or charge key.

Every effect admitted in a deployment profile MUST have at least one applicable
finite budget rule for every eligible trust tier. Omitting one axis rule is
permitted only when another finite rule still bounds the effect.

The words `unlimited`, `infinite`, `disabled`, and sentinel values such as
`-1`, `null`, or the maximum integer MUST NOT represent budget headroom.

A policy description reports an intentionally absent axis rule as
`not-applicable` or `covered-by:<rule>`, never as `unlimited`.

### 3.1 Counter strategies

This revision admits four counter strategies:

```ts
type CounterTerms =
  | {
      kind: "rolling-window"
      limit: PositiveSafeInteger
      windowMs: PositiveSafeInteger
    }
  | {
      kind: "gcra"
      rate: PositiveSafeInteger
      periodMs: PositiveSafeInteger
      burst: PositiveSafeInteger
      retentionMs: PositiveSafeInteger
    }
  | {
      kind: "fixed-total"
      limit: PositiveSafeInteger
    }
  | {
      kind: "occupancy"
      limit: PositiveSafeInteger
    }
```

All integers MUST be finite, positive, and no greater than
`Number.MAX_SAFE_INTEGER`.

A rolling window is the half-open interval `(now - window, now]`. An event
exactly one full window after an older event does not count that older event.

GCRA semantics on hosted targets remain governed by LLP 0060 §D3, including
monotone retry deadlines, bounded denial debt, retention, and capacity.

A fixed-total counter never replenishes within the authority that owns it.
Replenishing it requires a new independently authorized budget domain; an
effect cannot replenish its own domain.

An occupancy counter measures units currently reserved or committed. Its owner
must name the events that release units. Exhaustion does not invent an expected
release time.

A policy MUST NOT silently substitute one strategy for another. Strategy and
terms are part of the compiled policy digest and, where hosted, the deployment
attestation.

### 3.2 Charge axes

The closed charge-axis vocabulary is:

| Axis | Server-derived meaning |
| --- | --- |
| `recipient` | Canonical delivery destination or normalized provider subject addressed by the effect |
| `source` | Effective transport source derived from target-authenticated network posture |
| `principal` | Snapback principal resolved by the server |
| `credential` | Server-resolved challenge, session family, recovery credential, or other credential-domain handle |
| `provider` | Activated auth or delivery provider selected by server configuration |
| `app` | App identity bound by the serving context |
| `deployment` | Deployment or instance identity bound by the serving target |

`recipient` may originate as caller input, but the axis value is the
server-canonicalized value after the provider's normalization and size checks.
A caller-supplied digest or purported canonical address is never the axis.

`source` is never the leftmost forwarding header, a body field, a query
parameter, or an operator assertion. Hosted derivation is governed by LLP 0060
§D2 and §D3. The current local target has no effective-source capability and
must not claim or synthesize one.

`principal` exists only after server-side identity resolution. A claimed user
id is not a principal axis.

`credential` names an internal credential domain, not plaintext credential
material. It may be a challenge id, session-family id, or keyed fingerprint.
Plaintext passwords, codes, tokens, and proofs MUST NOT enter charge keys,
diagnostics, logs, or attestations.

`provider`, `app`, and `deployment` come from activated server state, never
request-selected identifiers that bypass routing and binding checks.

Rules may use tuples such as:

```text
source + recipient
principal + provider + app + deployment
credential + provider + app + deployment
app + deployment
```

A tuple is a composition of the closed axes, not a new caller-controlled axis.

Missing-axis behavior is declared per rule:

- `refuse` means the effect fails closed when the axis cannot be derived.
- `omit-by-declaration` means the compiled profile deliberately does not apply
  that rule, and another finite rule must still bound the effect.

Runtime failure to derive an axis is never treated as an undeclared omission.

### 3.3 Key privacy

Local single-instance implementations may use protected canonical values when
the owning protocol already stores them, but those values remain secret and
must not appear on public surfaces.

Hosted subject, recipient, credential, principal, and composite keys inherit
LLP 0060 §D3's privacy posture. Subject and family values use the target's
domain-separated HMAC construction; raw addresses and identifiers are not
limiter keys.

The budget name, rule id, axis classes, and policy version are not secrets.
Axis values, HMAC outputs, limiter keys, current counter values, and individual
remaining headroom are secrets.

## 4. Counter classes and atomic charging

Every budget is exactly one of two counter classes.

### 4.1 `ATTEMPT`

An `ATTEMPT` counter bounds hostile or costly attempts, including guessing,
enumeration, invalid credentials, and work initiated before success is known.

An attempt charges once when it crosses the effect's observation boundary,
regardless of whether the request later:

- succeeds;
- fails verification;
- is malformed after minimal routing;
- addresses an unknown subject;
- is refused by another budget;
- is refused by the charged budget itself; or
- fails a later authorization or provider check.

Exact idempotent retransmission is the sole exception: it replays the original
charge and outcome rather than creating another charge.

All applicable attempt rules are charged in one serialized decision. Admission
occurs only when every post-charge rule remains within its terms.

When one or more attempt rules are exhausted, the implementation still applies
the attempt charge to all applicable rules. It then refuses with the maximum
recovery point across the exhausted rules.

For rolling or GCRA rules, charge-on-denial may extend debt subject to the
bounded policy required by LLP 0060.

For a fixed-total terminal counter, the stored count may saturate at its
declared limit rather than overflow. The denied invocation still has an
authoritative charge receipt and cannot create headroom or become an effect.

This preserves:

- LLP 0057's committed wrong-code accounting; and
- LLP 0060's atomic multi-bucket charge-on-denial semantics.

### 4.2 `SUCCESSFUL_EFFECT`

A `SUCCESSFUL_EFFECT` counter bounds effects or allocated resources that
actually linearize, including delivery handoff, challenge allocation, session
minting, and OAuth transaction allocation.

A refusal before the protected effect linearizes does not consume a
successful-effect quota. Any `ATTEMPT` budgets on the same request remain
charged.

For a durable effect, quota admission and the effect commit MUST occur in the
same transaction or under an equivalent serialized commit protocol.

For an external effect, the implementation MUST use a reservation protocol:

1. reserve finite headroom atomically;
2. bind the reservation to the request's idempotency identity;
3. perform the external handoff;
4. commit the charge if handoff occurred or may have occurred;
5. release only when authoritative evidence proves no handoff occurred.

A crash or ambiguous provider response must not yield an uncharged external
effect.

For occupancy, reservation itself is the allocation effect. A pre-effect abort
releases it; a committed allocation remains charged until its declared release
event.

### 4.3 Mixed-class effects

An effect may charge both classes.

The required order is:

1. atomically charge all applicable `ATTEMPT` rules;
2. refuse if any attempt rule denies;
3. reserve all applicable `SUCCESSFUL_EFFECT` rules atomically;
4. perform and linearize the protected effect;
5. commit or release the reservations according to the authoritative outcome.

If successful-effect admission refuses, attempt charges remain committed and
successful-effect reservations leave no partial charge.

A policy must not turn an attempt budget into a successful-effect budget merely
because a local implementation can count successful rows more conveniently.

## 5. Canonical budget-name register

These names are owned by this Spec.

### 5.1 Ordinary auth budgets

| Budget name | Class | Harm bounded | Typical effects | Permitted axes |
| --- | --- | --- | --- | --- |
| `auth.guest.create` | `SUCCESSFUL_EFFECT` | Principal/session allocation | Guest principal entry | `app`, `deployment` |
| `auth.account.create` | `SUCCESSFUL_EFFECT` | Account allocation | Password signup or guest password claim | `app`, `deployment` |
| `auth.guessing` | `ATTEMPT` | Guessing | Challenge code, password, recovery code, credential proof verification | `source`, `recipient`, `principal`, `credential`, `provider`, `app`, `deployment` |
| `auth.enumeration` | `ATTEMPT` | Enumeration | Challenge request, challenge exchange, password lookup, refresh, connection admission | `source`, `recipient`, `principal`, `credential`, `provider`, `app`, `deployment` |
| `auth.delivery` | `SUCCESSFUL_EFFECT` | Delivery cost | Email, SMS, or other provider handoff; compatibility challenge issuance | `recipient`, `principal`, `provider`, `app`, `deployment` |
| `auth.challenge-allocation` | `SUCCESSFUL_EFFECT` | Challenge-state allocation | Durable challenge creation, capture-mailbox reservation | `recipient`, `provider`, `app`, `deployment` |
| `auth.hash-cpu` | `ATTEMPT` | Hash CPU | Password, recovery-code, or other expensive verifier work | `source`, `principal`, `credential`, `provider`, `app`, `deployment` |
| `auth.session-mint` | `SUCCESSFUL_EFFECT` | Session minting | Guest, login, exchange, fixture, or lifecycle session creation | `source`, `principal`, `credential`, `provider`, `app`, `deployment` |
| `auth.oauth-transaction` | `SUCCESSFUL_EFFECT` | OAuth transaction allocation | Authorization request state, device authorization, completion state | `source`, `principal`, `provider`, `app`, `deployment` |
| `auth.oauth-callback` | `ATTEMPT` | Guessing, enumeration, hash CPU | OAuth callback, state verification, device polling | `source`, `principal`, `credential`, `provider`, `app`, `deployment` |

The OAuth names are reserved now so later providers compose with this
vocabulary. They have no active default numeric policy in this revision.

`auth.session-mint` is an effect budget, not the same thing as LLP 0057's
current live-sessions-per-user lifecycle cap. Migrating or replacing that cap
requires a separate amendment.

A provider may charge multiple names. For example, password authentication may
charge `auth.enumeration`, `auth.guessing`, and `auth.hash-cpu`; successful
authentication may additionally charge `auth.session-mint`.

Guest password claim charges `auth.enumeration` and `auth.hash-cpu` at the
attempt cut, then charges `auth.account.create` and `auth.session-mint` in the
same transaction as the credential rotation. `auth.session-mint` names the
authority-granting effect class even when claim rotates the acting session in
place rather than allocating a new session id.

### 5.2 Rehearsal budget names

| Budget name | Grant counter field | Class |
| --- | --- | --- |
| `auth.rehearsal.challenge-attempts` | `challengeAttempts` | `ATTEMPT` |
| `auth.rehearsal.identity-creates` | `identityCreates` | `SUCCESSFUL_EFFECT` |
| `auth.rehearsal.session-mints` | `sessionMints` | `SUCCESSFUL_EFFECT` |
| `auth.rehearsal.verification-simulations` | `verificationSimulations` | `SUCCESSFUL_EFFECT` |
| `auth.rehearsal.window-installs` | `windowInstalls` | `SUCCESSFUL_EFFECT` |
| `auth.rehearsal.clock-advances` | `clockAdvances` | `SUCCESSFUL_EFFECT` |
| `auth.rehearsal.allocation-ceiling` | `allocationCeiling` | `SUCCESSFUL_EFFECT` |
| `auth.rehearsal.total-uses` | `maxUses` | `ATTEMPT` |

The grant-record field is a serialization projection. The canonical diagnostic,
policy, and attestation identifier is the budget name.

The rehearsal-grants Spec may add numeric bounds and selector constraints. It
must not rename these budgets or change their counter classes without amending
this Spec.

### 5.3 Name evolution

New names require an amendment that states:

- the harm;
- counter class;
- charging effects;
- permitted axes;
- public non-enumeration posture;
- recovery class; and
- composition with existing names.

A route name, provider brand, deployment target, or implementation algorithm
must not appear in a canonical budget name.

`SNAPBACK_AUTH_THROTTLED` and
`SNAPBACK_AUTH_REHEARSAL_BUDGET_EXHAUSTED` are diagnostic names, not budget
names. They must not become parallel accounting vocabularies.

## 6. Idempotency and retry identity

Every effect that can mutate budget state or produce an external effect MUST
accept or internally derive an idempotency key.

An idempotency record binds the key to a digest of the **complete normalized
request**. The digest includes every semantic input that could change the
effect or its charge:

- effect name and protocol version;
- app and deployment bindings;
- deployment profile;
- provider;
- normalized public request fields;
- opaque digests of secret-bearing fields;
- server-derived principal and credential domains, when present;
- server-derived effective source, when applicable;
- selected trust tier and evidence generation;
- budget policy digest and limiter epoch; and
- rehearsal grant or window identity, when applicable.

Incidental trace ids, connection ids, presentation headers, and arrival time
are excluded unless the owning effect makes them semantic.

Secrets are represented only by domain-separated keyed digests. The normalized
request or its secret-bearing fields must not enter logs, diagnostics, receipts,
or model-visible output.

The idempotency record has the following logical states:

```text
pending
committed(effect receipt + budget charge receipt)
refused(budget or protocol refusal + budget charge receipt)
```

The effect and budget outcomes are one logical result:

- an exact retry of `committed` returns the same effect receipt and does not
  charge again;
- an exact retry of `refused` returns the same refusal and does not charge
  again;
- a retry of `pending` resumes or reconciles the authoritative operation;
- an ambiguous crash must resolve from authoritative effect and counter state;
- no retry may observe an effect without its corresponding charge.

Reusing one idempotency key with a different normalized request returns
`SNAPBACK_AUTH_IDEMPOTENCY_CONFLICT`.

The conflicting request is not treated as an exact retry. Any applicable
source/global attempt budgets charge it as a new refused attempt. It cannot
reuse the original request's charge or effect.

Changing only a password guess, challenge code, OAuth state, recipient,
provider, source, selector, requested quantity, or rehearsal effect therefore
changes the normalized request and cannot obtain free guesses under one key.

Concurrent identical requests converge on one outcome. Concurrent
same-key/different-request calls produce at most one bound request; every
conflicting call refuses without an effect and receives its own applicable
attempt accounting.

An implementation must retain idempotency state long enough to cover the
effect's ambiguity and retry interval. Expiry of an idempotency record does not
replenish a fixed-total budget or erase a durable successful effect.

The generated `guest-v1` entry effect retains its pending, committed, or
refused record through the declared unclaimed-guest retention deadline. Its
derivation key is a durable reference for that same interval. Periodic auth GC
reclaims expired records in ordered bounded batches before retired-key pruning;
an exact retry inside the interval therefore cannot be stranded by key
rotation, while abandoned entry keys cannot grow storage or key custody without
bound. Destructive app reset and restore clear guest-entry replay state in the
same transaction that destroys or terminates the receipt's session authority.

## 7. Server-derived trust tiers

The closed trust-tier order is:

```text
anonymous
  < verified-contact
  < established-session
  < sender-bound
  < scoped-agent
  < rehearsal-authority
```

The ordering is a budget-policy ordering only. It does not imply that one tier
can substitute for another tier's authority.

### 7.1 Tier derivation

`anonymous` means no stronger eligible server-derived posture was proven.

`verified-contact` requires a server-admissible contact assurance bound to the
current principal or ceremony.

`established-session` requires a live server-resolved Snapback session whose
generation and authority remain valid.

`sender-bound` requires an established session plus a sender proof verified for
the current request under the owning sender-constraint protocol.

`scoped-agent` requires a valid key-bound agent principal and a scope
applicable to the requested effect. Merely presenting an agent-shaped string or
service id is insufficient.

`rehearsal-authority` requires a live rehearsal grant or window, the exact
effect scope, selectors, app/instance/boot binding, profile admission, and
governing-authority validity.

Rehearsal authority is eligible only inside the rehearsal budget domain. It is
not a stronger ordinary application credential and never satisfies an LLP 0055
scope, application authorization, or operator policy by ordering alone.

The server selects exactly one effective tier for a budget event after
verifying the evidence relevant to that event. Loss, expiry, revocation, or
mismatch of evidence immediately lowers the derived tier or refuses the effect.

### 7.2 Non-forgeability

Trust tier is never:

- an HTTP header;
- a request-body field;
- a query parameter;
- a cookie claim accepted without server verification;
- a CLI flag forwarded as authority;
- an application function argument; or
- an operator-declared deployment fact.

The implementation MUST NOT register an `X-Snapback-Trust-Tier` or equivalent
carrier. An unrecognized header cannot affect tier selection. A `trustTier`
field in a closed request DTO is rejected as unknown input.

The tier derivation result is sealed server context. Code that accepts a
detached or caller-constructed derivation object fails closed.

### 7.3 Finite tier policies

Every applicable rule resolves to finite terms for every eligible tier.

A higher tier MAY receive greater headroom or a different recovery cadence, but
it never receives an absent counter solely because it is trusted.

Tier scaling need not be monotone for every harm. A scoped agent may warrant
more session mints but less broad recipient fan-out; rehearsal authority uses
separate counters rather than borrowing ordinary user headroom.

Policy compilation resolves inheritance and scaling into concrete finite
terms. Runtime and attestation output never report a multiplier without its
resolved bound.

No tier reports `unlimited`. The highest tier is finite.

## 8. Repo-declared policy and deployment overlays

Budget policy is source-controlled application configuration.

`defineAuth(...)` references one base policy and one overlay for every
deployment profile:

```ts
defineAuth({
  budgets: {
    registry: "snapback.auth.effect-budgets.v1",
    base: { ref: "./auth/budgets.base.ts" },
    overlays: {
      dev: { ref: "./auth/budgets.dev.ts" },
      test: { ref: "./auth/budgets.test.ts" },
      demo: { ref: "./auth/budgets.demo.ts" },
      prod: { ref: "./auth/budgets.prod.ts" },
    },
  },
})
```

The exact files may be generated, but each reference is a static repo path
included in the activation digest. An environment variable, dashboard toggle,
remote mutable setting, or ad hoc CLI override cannot replace the referenced
policy.

Secret material used to derive limiter keys remains in protected deployment
state. The repo declares the secret reference and policy; it never contains the
secret value.

The compiled auth manifest contains:

- registry version;
- base-policy identity;
- all four profile-overlay identities;
- effect-to-budget bindings;
- resolved rule shapes;
- trust-tier table completeness;
- target requirements;
- policy digest; and
- diagnostics metadata.

Unknown names, axes, counter classes, strategies, tiers, profile keys, fields,
or non-finite values fail staging before serving.

### 8.1 Resolution order

For each effect, policy resolution is:

1. validate the registry and effect-to-budget references;
2. load the source-controlled base policy;
3. apply the selected deployment-profile overlay;
4. select concrete terms for the server-derived trust tier;
5. add the target's mandatory rules and hard ceilings conjunctively;
6. add a rehearsal domain, when valid rehearsal authority mediates the effect;
7. verify that at least one finite rule remains and all required axes exist.

The deployment profile is server-selected activated state, not request input.

A profile overlay may:

- tighten a rule;
- supply profile-specific finite terms;
- add a rule;
- omit an explicitly named axis rule when another finite rule remains; or
- mark an effect unavailable.

A profile overlay cannot remove a target hard bound, change a counter class,
rename a budget, introduce an axis, or make a finite term non-finite.

A target overlay never uses last-writer-wins precedence. App and target rules
both apply; the operation is admitted only if all applicable rules admit.

A configuration conflict, missing overlay, or missing sole bounding rule is a
startup/readiness failure, not a fallback to a platform default.

### 8.2 The LLP 0057 dev/demo posture as an overlay

The current per-address exemption is re-expressed as profile policy:

- `test` and `prod` include the `auth.delivery` per-recipient rule;
- `dev` and `demo` omit that one rule;
- all four profiles retain the finite app/deployment-global challenge issuance
  rule;
- capture-capable profiles retain the finite mailbox occupancy rule.

The dev/demo result is not “recipient budget unlimited.” It is:

```text
auth.delivery/recipient: not-applicable
covered-by: auth.challenge-allocation/app+deployment
```

This preserves the reason for the existing exemption: capture-only dev/demo
does not deliver to a real recipient. It does not exempt those profiles from
global resource control.

Generous non-production terms remain finite and source controlled.

## 9. Rehearsal budgets

Rehearsal traffic receives separate finite budget domains. It never receives an
exemption from budgeting.

A rehearsal domain is keyed by the exact governing grant or window plus app and
deployment. Two grants cannot borrow from each other, and a child window cannot
borrow beyond the parent grant's conserved allocation.

Every rehearsal effect charges `auth.rehearsal.total-uses` as an `ATTEMPT`
counter. It additionally charges the effect-specific budget:

| Rehearsal effect | Effect-specific budget |
| --- | --- |
| `challenge.capture` | `auth.rehearsal.challenge-attempts` |
| `challenge.redeem` | `auth.rehearsal.challenge-attempts` |
| `fixture.identity.create` | `auth.rehearsal.identity-creates` |
| `fixture.session.mint` | `auth.rehearsal.session-mints` |
| `verification.simulate` | `auth.rehearsal.verification-simulations` |
| `window.install` | `auth.rehearsal.window-installs` |
| `budget.rehearsal.allocate` | `auth.rehearsal.allocation-ceiling` |
| `clock.auth.advance` | `auth.rehearsal.clock-advances` |

`challengeAttempts` is an attempt counter. Capture, redemption, malformed
input after the observation boundary, selector mismatch, wrong challenge data,
and budget denial all consume it. Exact idempotent retry does not.

The successful-effect counters charge only when their named effect
linearizes. A refused identity creation, session mint, verification simulation,
window installation, allocation, or clock advance consumes `maxUses` but not
the effect-specific successful-effect quota.

`allocationCeiling` is a fixed-total conserved quantity established at grant
mint. An allocation charges the requested quantity, not merely one call.

The sum of every quantity ever allocated under one grant MUST NOT exceed
`allocationCeiling`, including allocations to windows and child budget domains.

Allocation is non-recursive and non-renewable:

- an allocation cannot raise the parent ceiling;
- an allocation cannot replenish a consumed counter;
- a child cannot allocate another ceiling;
- a grant cannot allocate to itself;
- expiry, restart, reset, or activation change does not restore the same grant;
- no effect reachable through the grant can mint another grant.

The rehearsal-grants Spec owns the numeric ceiling, TTL, selectors, and minting
authority, but it must use these names and charge semantics.

Ordinary and rehearsal counters are separate, but shared physical bounds remain
conjunctive. A rehearsal caller may draw from its own challenge-attempt budget
while still consuming finite deployment memory, mailbox occupancy, hash CPU,
and other non-waivable target ceilings.

A capability description or status result reports concrete finite remaining
amounts on a gated surface. Nothing ever reports `unlimited`.

## 10. Local and hosted realization

The same budget names apply to every target. Realization differs only in the
available axes and serialization authority.

### 10.1 Local single-instance realization

The local target may realize durable counters in the app's SQLite auth
database and process-local occupancy counters in the resource owner.

Durable multi-rule decisions use one serialized transaction. An effect cannot
observe partial local charges from a concurrent request.

Process-local occupancy is conforming only for a process-local resource whose
contents disappear with that process, such as LLP 0057's capture mailbox.

The local target does not derive an effective source and must not claim
per-source budgeting. A local policy either omits source rules by declaration
while retaining other finite rules or refuses an effect whose required source
axis is unavailable.

Loss, corruption, or inability to transact with the authoritative counter store
fails closed. The local implementation does not silently switch to an
uncounted in-memory allowance.

### 10.2 Hosted multi-bucket realization

LLP 0060 §D3 supplies the hosted realization of these named budgets.

For every applicable `ATTEMPT` budget, hosted policy maps this Spec's axes onto
LLP 0060's independent bucket set:

| LLP 0060 bucket | Effect-budget axes |
| --- | --- |
| App/deployment-global | `app + deployment` |
| Effective source | `source + app + deployment` |
| Subject or destination | `recipient`, `credential`, or resolved `principal`, plus `provider + app + deployment` |
| Source × subject | `source` plus the applicable `recipient`, `credential`, or `principal` tuple |
| Session-family/user | `credential` and, when resolved, `principal`, plus `app + deployment` |

This table maps vocabularies; it does not replace LLP 0060's bucket topology.

Malformed, unparseable, and unresolved credentials still charge the hosted
source and app/deployment-global rules. Resolution failure must not make them
free.

When a recipient, credential, or principal becomes available, all corresponding
rules join the same atomic charge. One composite bucket never substitutes for
the independent buckets.

Hosted subject and family keys inherit LLP 0060's HMAC construction. Effective
sources inherit its IPv4 `/32`, IPv6 `/64`, trusted-forwarding, and privacy
rules.

The shared limiter's unavailability, invalid configuration, capacity failure,
clock failure, or storage loss refuses the effect. LLP 0060's v1 fail-closed
rule is inherited unchanged; there is no replica-local emergency budget.

### 10.3 Hosted attestation

A hosted deployment attestation publishes:

- effect-budget registry version;
- compiled policy digest;
- deployment-profile overlay identity and digest;
- limiter epoch;
- every active budget name;
- counter class and counter strategy;
- axis classes and tuple shapes, never values;
- concrete finite tier terms;
- exact rate, period, burst, window, or occupancy limit as applicable;
- retention and maximum-key-count parameters;
- limiter clock authority;
- limiter failure policy;
- HMAC derivation version, never key material; and
- the target's supported rehearsal-budget posture.

Changing any published term rotates the limiter epoch as LLP 0060 requires.

The attestation does not publish recipients, sources, principals, credentials,
charge keys, HMAC outputs, current occupancy, remaining individual headroom,
idempotency digests, or rehearsal carrier material.

A stale, missing, unverifiable, unknown-field, non-finite, or policy-digest-
mismatched attestation fails hosted readiness.

## 11. Refusal contract

Every budget refusal has a canonical structured payload:

```ts
type BudgetRefusalDetails = {
  budgetName: BudgetName
  retryAfter:
    | { kind: "duration"; milliseconds: number }
    | { kind: "at"; epochMs: number }
    | { kind: "resource-release" }
    | { kind: "new-authority-required" }
  correlationId: string
}
```

The `retryAfter` field is never omitted.

A duration or absolute time means the same normalized request may become
eligible after that point, subject to other rules.

`resource-release` means recovery depends on a declared occupancy release and
no honest time is known.

`new-authority-required` means the current fixed-total domain cannot recover.
It does not promise that a new authority will be granted.

For multiple exhausted rules, a time-based retry uses the latest required
recovery point. If any exhausted rule requires resource release or new
authority, that stronger recovery class wins.

HTTP surfaces emit `Retry-After` only when the structured value can be
represented truthfully. They do not invent a time for fixed or occupancy
quotas.

### 11.1 Diagnostic codes

| Code | Locus | Meaning |
| --- | --- | --- |
| `SNAPBACK_AUTH_RATE_BUDGET` | HTTP/CLI/MCP | A renewable rolling-window or GCRA budget refused |
| `SNAPBACK_AUTH_QUOTA_BUDGET` | HTTP/CLI/MCP | A fixed-total, conserved, or occupancy budget refused |
| `SNAPBACK_AUTH_BUDGET_AXIS_UNAVAILABLE` | readiness/request | A policy-required server-derived axis is unavailable |
| `SNAPBACK_AUTH_BUDGET_AUTHORITY_UNAVAILABLE` | readiness/request | The authoritative counter service cannot safely decide |
| `SNAPBACK_AUTH_BUDGET_POLICY_INVALID` | stage/startup/readiness | The compiled policy is missing, malformed, inconsistent, or non-finite |
| `SNAPBACK_AUTH_IDEMPOTENCY_CONFLICT` | HTTP/CLI/MCP | One idempotency key was reused for a different normalized request |

Every rate or quota refusal carries `budgetName`, `retryAfter`, and
`correlationId`.

`SNAPBACK_AUTH_THROTTLED` may remain as a legacy presentation alias during the
LLP 0057 migration. It must map to one canonical budget refusal and carry the
same structured details.

`SNAPBACK_AUTH_REHEARSAL_BUDGET_EXHAUSTED`, if retained by the
rehearsal-grants Spec for compatibility, is likewise an alias. It must not own
different accounting or retry semantics.

### 11.2 Public non-enumeration

Public identity surfaces expose only:

- the public diagnostic code;
- the stable budget name;
- the structured retry-after value; and
- an opaque correlation id.

They MUST NOT expose:

- exhausted axis or rule id;
- source, recipient, principal, or credential values;
- whether any identity, challenge, account, or session exists;
- selected trust tier;
- limit, current count, or remaining headroom;
- provider-private cooldown state;
- limiter key or epoch internals; or
- whether a later authentication or authorization check would have passed.

Known and unknown subjects produce the same public shape when the same named
budget class refuses them. Timing and status must not introduce the oracle the
payload avoids.

### 11.3 Gated next moves

A gated operator, admin, rehearsal, CLI, or MCP surface additionally carries a
nonempty `next[]` generated from the diagnostics and operation catalogs.

At least one entry is:

- an exact command;
- an exact input field to change; or
- a resolving guide anchor.

Examples of valid next moves include:

```text
snapback auth budgets explain <correlationId> --json
snapback auth rehearse status --json
wait until <epoch>
reduce requested fixture count below <finite remaining amount>
guide/auth/effect-budgets#<budget-name>
```

A next move must not recommend disabling limits, editing a dashboard, reusing a
different idempotency key for the same attempt, or minting new authority without
naming the required authorization ceremony.

The exact exhausted rule, axis classes, applicable overlay, derived tier,
counter class, and recovery condition may appear only on the gated explanation
surface.

## 12. LLP 0057 migration

### 12.1 Sequencing

The migration has two distinct landings:

1. **Wave 1a:** this Spec, its registry, schemas, and validation vocabulary land.
   No LLP 0057 runtime behavior changes.
2. **Wave 2c:** LLP 0057 is amended to replace its budget constants with
   references to this Spec and the compiled default policy.

Until the LLP 0057 amendment is accepted and its implementation lands:

- LLP 0057's constants remain normative;
- existing counters and diagnostics remain authoritative;
- `defineAuth` budget references do not reinterpret those constants;
- no shadow decision may refuse a request; and
- no capability claim says the constants have migrated.

### 12.2 Compatibility policy

The wave-2c amendment uses these exact defaults:

| Existing LLP 0057 constant | Named budget and rule | Class | Compatibility terms |
| --- | --- | --- | --- |
| Per-address request budget | `auth.delivery`, `recipient + provider + app + deployment` | `SUCCESSFUL_EFFECT` | 5 accepted challenge requests in rolling 10 minutes in `test` and `prod` |
| Dev/demo per-address exemption | `auth.delivery` profile overlay | — | Recipient rule is `not-applicable` in `dev` and `demo`; no unlimited term |
| Global request budget | `auth.challenge-allocation`, `app + deployment` | `SUCCESSFUL_EFFECT` | 120 accepted challenge requests in rolling 60 seconds in every profile |
| Maximum challenge attempts | `auth.guessing`, `credential + provider + app + deployment` | `ATTEMPT` | 5 total submitted attempts per active challenge |
| Capture mailbox capacity | `auth.challenge-allocation`, `provider + app + deployment` | `SUCCESSFUL_EFFECT` occupancy | 1,024 published or reserved entries |

The amendment preserves the existing request-code semantics exactly:

- request counts charge only when the challenge transaction commits;
- per-address and global windows remain `(now - window, now]`;
- an event exactly one full window old no longer counts;
- `dev` and `demo` omit only the recipient rule;
- the global rule applies in all profiles;
- the capture mailbox remains finite in every capture-capable profile;
- mailbox reservation counts before durable challenge creation;
- a pre-commit refusal releases the reservation;
- an accepted request creates a challenge for known and unknown addresses alike;
- unavailable provider, refused profile, and corrupt keyring still mutate no
  budget state because they remain before the compatibility observation point;
- due key rotation already published before later admission refusal remains its
  independent maintenance effect.

The amendment preserves challenge-exchange semantics exactly:

- only a submitted code for an active challenge charges its credential
  `auth.guessing` rule;
- wrong attempts one through four commit and return the uniform invalid result;
- a correct fifth attempt succeeds;
- an incorrect fifth attempt commits the terminal count and locks;
- a later locked attempt cannot overflow or replenish the fixed total;
- unknown, expired, consumed, and superseded challenges retain their current
  public result and do not gain a new local credential charge;
- hosted source/global attempt charging remains independently required by LLP
  0060 when hosted posture applies.

Broader local enumeration charging would be a behavior change and requires a
later explicit policy amendment. It is not smuggled into the compatibility
migration.

### 12.3 Diagnostic compatibility

The wave-2c amendment may retain:

- `SNAPBACK_AUTH_THROTTLED` as the public alias for existing request-code
  rate and mailbox refusals; and
- `SNAPBACK_AUTH_CODE_LOCKED` as the public alias for the fixed
  `auth.guessing` exhaustion.

Those aliases must acquire the canonical structured `budgetName`,
`retryAfter`, and correlation fields through the versioned error envelope.
Changing the public status or primary code requires its own compatibility
decision.

Gated explanation uses the canonical budget names regardless of public alias.

### 12.4 Implementation transition

The implementation transition is:

1. generate the compatibility policy from the exact table above;
2. derive rolling challenge counts from the same retained challenge rows;
3. derive challenge attempt state from the existing `attempts` field;
4. derive mailbox occupancy from the existing published-plus-reserved count;
5. run old and new decisions in a non-authoritative parity harness;
6. prove equality at every boundary time, profile, and concurrency cut;
7. switch one owning transaction at a time under the accepted amendment;
8. remove duplicated constant authority only after the parity suite passes;
9. update LLP 0057's constants table to reference this Spec;
10. update LLP 0060's named-budget references without weakening §D3.

No durable counter migration is required for the compatibility rules because
their authoritative state already exists in challenges and mailbox ownership.
A later budget requiring new state must specify its own upgrade and rollback
protocol.

## 13. Diagnostics and acceptance matrix

The acceptance suite is generated from effect-to-budget bindings, profiles,
tiers, and target realizations. Every row asserts the effect outcome, charge
outcome, refusal shape, and absence of secret material.

| ID | Scenario | Required result |
| --- | --- | --- |
| C1 | Valid attempt succeeds | Every applicable `ATTEMPT` rule charges exactly once |
| C2 | Credential verification fails | Guessing and other applicable attempt rules charge; no successful-effect quota charges |
| C3 | One attempt rule is already exhausted | Every applicable attempt rule charges atomically; effect refuses |
| C4 | A non-exhausted hosted source rule accompanies an exhausted subject rule | Source and global rules still charge; no free spray lane |
| C5 | Malformed hosted credential after observation boundary | Source and app/deployment-global attempt rules charge |
| C6 | Successful-effect quota refuses before effect | Attempt charges remain; every successful-effect reservation is absent or released |
| C7 | Durable effect commits | Effect and successful-effect charge become visible atomically |
| C8 | External handoff response is ambiguous | Reservation becomes a committed charge unless authoritative evidence proves no handoff |
| C9 | Fixed-total counter receives a denied attempt | It does not overflow or regain headroom; denial has a charge receipt |
| L1 | LLP 0057 wrong code attempts 1–4 | Each commits one `auth.guessing` charge and returns uniform invalid |
| L2 | LLP 0057 correct fifth code | Fifth charge and exactly one session commit |
| L3 | LLP 0057 wrong fifth code | Terminal charge commits and challenge locks |
| L4 | LLP 0057 post-lock retry | No overflow, no effect, fixed-total recovery is `new-authority-required` |
| I1 | Exact retry after successful commit | Same receipt, no second charge, no second effect |
| I2 | Exact retry after budget refusal | Same refusal and charge receipt, no second charge |
| I3 | Crash after commit before response | Retry recovers the committed effect and original charge |
| I4 | Same key with a different code or password | `SNAPBACK_AUTH_IDEMPOTENCY_CONFLICT`; no effect; applicable conflict-attempt rules charge |
| I5 | Concurrent identical requests | One effect and one charge set; all callers converge on its result |
| I6 | Concurrent same-key/different-request calls | At most one request binds; conflicting requests refuse and cannot obtain free guesses |
| T1 | Request body supplies `trustTier` | Closed DTO refusal; supplied value never reaches policy selection |
| T2 | Request supplies `X-Snapback-Trust-Tier` | Header has no semantic effect |
| T3 | Forged principal, session, sender, agent, or rehearsal evidence | Tier is not elevated; ordinary authority checks still refuse |
| T4 | Valid proof expires or is revoked between requests | Later request derives the lower tier or refuses immediately |
| T5 | Every tier/profile policy projection | Every applicable resolved term is finite and positive |
| O1 | `dev` or `demo` repeated recipient challenge requests | Recipient rule is not applicable; finite global and occupancy rules still enforce |
| O2 | `test` or `prod` per-recipient boundary | Requests 1–5 admit under compatibility conditions; request 6 refuses until the exact rolling boundary recovers |
| O3 | Any profile global boundary | The 121st accepted request inside 60 seconds refuses |
| O4 | Event exactly one full window old | Older event is excluded from the half-open rolling window |
| O5 | App overlay is looser than target hard bound | Both apply; target bound wins conjunctively |
| O6 | Required profile overlay missing or malformed | Stage/startup/readiness fails; serving does not use a fallback |
| O7 | Sole axis rule is omitted | Policy compilation refuses because the effect has no finite bound |
| R1 | Two rehearsal grants execute the same effect | Counters remain separate by governing authority |
| R2 | Rehearsal effect refuses selector or protocol validation | `maxUses` and applicable rehearsal attempt budget charge; successful-effect quota does not |
| R3 | Rehearsal allocation requests N units | Exactly N conserved ceiling units charge atomically |
| R4 | Allocation would exceed the ceiling | Allocation refuses, ceiling never overcommits, and the grant cannot replenish itself |
| R5 | Rehearsal budget is exhausted while ordinary budget has headroom | Rehearsal effect refuses; it cannot borrow ordinary headroom |
| R6 | Rehearsal has headroom while shared mailbox/CPU bound is exhausted | Outer physical budget refuses; rehearsal never disables the bound |
| R7 | Rehearsal status or capability output | Every budget reports a finite amount or typed exhausted state; never `unlimited` |
| H1 | Local target policy requests source axis | Source is omitted only by declaration with another finite rule, otherwise readiness refuses |
| H2 | Hosted replicas race one multi-axis attempt | One serialized limiter decision charges the complete applicable set |
| H3 | Hosted limiter is unavailable or loses state | `SNAPBACK_AUTH_BUDGET_AUTHORITY_UNAVAILABLE`; no local emergency allowance |
| H4 | Hosted subject/source values reach logs, public error, or attestation | Sentinel test fails; no value or derived key may escape |
| H5 | Hosted policy parameter changes | Attested limiter epoch and policy digest change |
| D1 | Public known and unknown subjects exhaust the same budget | Same code, budget name, retry shape, status, and non-enumerating details |
| D2 | Gated budget refusal | Nonempty mechanically valid `next[]` plus exact budget explanation |
| D3 | Nonrenewable fixed quota refuses | Retry shape is `new-authority-required`, never a fabricated duration |
| D4 | Occupancy quota refuses | Retry shape is `resource-release` unless an authoritative release time exists |
| M1 | Old and compatibility engines run the generated parity corpus | Admission, refusal, mutation, window, profile, and concurrency outcomes are identical |
| M2 | Vocabulary lands without the LLP 0057 amendment | Existing runtime and wire behavior remain byte-for-byte unchanged |

Acceptance fixtures must cover all six trust tiers, four deployment profiles,
every counter strategy, both counter classes, every canonical budget name that
is active, and every public diagnostic alias.

Property tests must vary arrival order, exact boundary timestamps, retry order,
transaction rollback, process interruption, limiter epoch changes, and
idempotency conflicts.

Secret-sentinel tests include canonical addresses, codes, passwords, challenge
ids, principal ids, session-family ids, source addresses, limiter HMAC outputs,
idempotency digests, rehearsal grant ids, and carrier bytes.

## 14. Security invariants

The following are invariant:

1. Passing a budget check grants no identity, assurance, authorization, scope,
   provider readiness, or rehearsal authority.
2. A client never asserts a charge key or trust tier.
3. Failed guesses and hosted denials are not free.
4. Exact retransmission is not double-charged.
5. A changed guess is not an exact retransmission.
6. No effect linearizes without every required successful-effect charge.
7. No counter failure falls back to unlimited operation.
8. Every applicable tier and profile has finite terms.
9. Rehearsal traffic uses separate finite counters and remains under outer
   physical resource ceilings.
10. Public refusals do not enumerate identities, challenges, credentials, or
    tier evidence.
11. Hosted keys remain privacy preserving and shared across replicas.
12. Policy and overlay selection come from activated repo configuration and
    target-attested state.
13. No dashboard or request can loosen a compiled policy.
14. Attestation changes when hosted budget semantics change.
15. A fixed-total or conserved domain cannot replenish itself.

## 15. Non-goals

This Spec does not:

- authorize an effect;
- define CAPTCHA policy;
- define risk scoring or behavioral fraud detection;
- decide the default numeric values for new password, hash, session, OAuth, or
  hosted rate policies;
- replace provider-specific cooldowns or external vendor limits;
- replace LLP 0057's challenge/session state machines;
- replace LLP 0060's hosted source and bucket protocol;
- define rehearsal grant minting, selectors, taint, or termination;
- turn live-session lifecycle caps into effect budgets automatically;
- provide a mutable operator dashboard;
- promise identical numeric policy across deployment profiles; or
- permit a target to claim an axis it cannot derive securely.

## 16. Open questions

The structure, names, axes, counter classes, charge timing, idempotency,
trust-tier derivation, overlay precedence, refusal semantics, rehearsal
separation, and hosted composition are closed by this Spec.

Only numeric policy remains open:

- **OQ1:** What finite base terms should `auth.guest.create`,
  `auth.account.create`, `auth.enumeration`, `auth.guessing`, `auth.hash-cpu`,
  and `auth.session-mint` use for the new
  password and guest floor outside the LLP 0057 compatibility path?
- **OQ2:** What finite per-tier scaling should each ordinary budget use?
  Scaling must be decided per harm; one global trust multiplier is not assumed.
- **OQ3:** What exact finite rates, bursts, retention periods, denial-debt caps,
  and maximum-key counts should the first hosted target attest?
- **OQ4:** What finite default `allocationCeiling`, `maxUses`, per-effect
  quantities, and TTL should the rehearsal-grants Spec choose?
- **OQ5:** Should a later local-policy amendment add source-independent
  `auth.enumeration` attempt accounting beyond the exact LLP 0057 migration?
  If so, its numeric terms and compatibility impact require explicit approval.

None of these questions permits an unlimited interim. A feature whose required
numeric policy is unresolved remains unavailable or uses an explicitly accepted
finite compatibility policy.

## 17. Corpus register

| Corpus item | Relationship to LLP 0215 | Required action |
| --- | --- | --- |
| LLP 0212 | Commissioning authority: A1, A2, rehearsal budget rules, OQ4, wave ordering | Reference this Spec as fulfillment of landing item 5 |
| LLP 0057 | Owns current constants and email-code behavior | Wave-2c amendment replaces the four budget constants with named references and the exact compatibility policy |
| LLP 0060 | Owns hosted five-bucket topology, HMAC keys, charge-on-denial, fail-closed behavior, and attestation | Reference canonical names and publish the resolved policy fields required here; do not duplicate the vocabulary |
| LLP 0011 | Owns server-derived identity and authorization | No semantic amendment required; implementations cite it where principal derivation feeds a charge axis or tier |
| LLP 0203 | Owns P2 next-move discipline | Budget diagnostics and explanation projections join the generated diagnostics/operation catalogs |
| Rehearsal-grants Spec commissioned by LLP 0212 | Owns grant/window mechanics and numeric rehearsal policy | Use the eight canonical rehearsal budget names, counter classes, conserved ceiling, and idempotency rules |
| Identity-core Spec commissioned by LLP 0212 | Owns `defineAuth(...)` and generated auth program | Carry the source-controlled budget references and compiled policy digest defined here |
| Hosted deployment attestations | Publish target-specific concrete policy | Include registry, policy digest, axes, finite tier terms, algorithms, failure policy, and limiter epoch |
| Guide auth capability index | Agent-facing discovery and GAP posture | Add the budget authoring, refusal, explanation, and hosted-attestation capabilities when implemented |

This Draft establishes vocabulary only. It makes no implementation, migration,
hosted-readiness, rehearsal-readiness, or publication claim.
