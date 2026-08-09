# LLP 0213: Auth rehearsal grants

**Type:** Spec
**Status:** Draft
**Systems:** Auth, Identity, Security, Testing, Agent tooling, Runtime, Storage, Backup/restore, Notifications, Cron, Deployment, CLI
**Author:** Charlie Cheever / Codex (gpt-5.6-sol) via Claude orchestration
**Date:** 2026-08-09
**Revised:** 2026-08-09 (initial Draft commissioned by LLP 0212 landing items 1 and 1a)
**Related:** LLP 0212, LLP 0057, LLP 0055, LLP 0058, LLP 0045, LLP 0060, LLP 0053, LLP 0059, LLP 0150, LLP 0031

## Summary

This Spec makes landing items 1 and 1a of
[LLP 0212](./0212-agent-native-identity-and-rehearsal-grants.rfc.md)
executable.

It defines an **auth rehearsal grant**: a short-lived, finite,
operator/test-plane capability that lets an authorized non-production test
runner exercise named auth-testing effects without weakening application
authorization or creating a production bypass.

A grant is bound to one instance, boot nonce, app, activation digest, sessions
mode, and non-production deployment profile. It carries a closed eight-effect
scope, exact selectors, immutable budget ceilings, a total-use limit, and a
terminal expiry or revocation boundary. There is no wildcard effect, selector,
budget, or authority.

A **rehearsal window** lets an ordinary browser or native client exercise the
real signup surface without carrying rehearsal authority. The host precommits
one CSPRNG-minted selector namespace for each budgeted installation when the
grant is minted. Installation consumes that namespace exactly once. During the
window, ordinary requests matching the namespace may receive the plan's
budgeted capture or simulated-verification behavior. The namespace, not
loopback reachability, is the authoritative foreign-caller boundary.

Rehearsal authority is categorically distinct from LLP 0055 application-plane
grants. An LLP 0055 grant cannot exercise a rehearsal effect, and a rehearsal
capability cannot invoke an application function or satisfy an LLP 0055 scope.

The first honored rehearsal effect permanently marks the store in the same
transaction as that effect's durable linearization. The marker survives reset,
backup, restore, clone, and logical export. Every logical export carries a
host-MACed provenance envelope bound to the exact payload, store identity, and
marker state.

That envelope authenticates marker state **at export time**. States at or after
first rehearsal admission, and exports from those states, are permanently
ineligible for production promotion. A verifiably pre-taint export remains
promotable by design: same-transaction admission marking plus
snapshot-consistent export proves that a clean-verifying export contains no
rehearsal-derived state.

This Spec also amends the LLP 0058 invocation-authority lineage with a sealed
rehearsal-provenance value. Provenance derives from effective authority and the
actual assurance decision, propagates synchronously through nested execution,
and persists durably on deferred intents. One egress gate refuses real external
egress under rehearsal provenance unless a declared simulator/test adapter owns
the channel.

Wave-1 carriage is local-only. It follows LLP 0057's carrier-custody discipline:
an owner-only ready-file sidecar or explicit bounded stdin attachment, never
argv or environment variables. Remote and CI key-bound carriage remains
deferred to the extractable-key agent profile commissioned by LLP 0150.

## Scope, ownership, and precedence

This Spec owns:

- the versioned `authRehearsalGrant.v1` record;
- the closed rehearsal-effect enum;
- the total effect-to-counter mapping;
- grant accounting, idempotency, ceilings, and exhaustion semantics;
- the total effect-to-selector mapping;
- window namespace generation, precommitment, installation, and termination;
- rehearsal carrier spelling and local custody;
- mint, exercise, status, revoke, and release-qualification behavior;
- rehearsal-derived authority termination;
- store admission and disposable-store markers;
- logical-export provenance envelopes;
- cross-host envelope verification-key custody;
- rehearsal-provenance derivation and propagation;
- the single external-egress gate;
- route-registry classifications and DTO discipline;
- stable `SNAPBACK_AUTH_REHEARSAL_*` diagnostics; and
- the authoritative acceptance matrix in this document.

LLP 0057 remains authoritative for:

- the email-code provider and session machinery;
- `ImpersonationCapability`;
- the auth keyring lifecycle;
- physical backup/restore quiescence;
- public provider non-enumeration;
- credential redaction;
- `Cache-Control: no-store`; and
- the existing wrong-code attempt charge.

LLP 0055 remains authoritative for application-plane service principals,
credentials, scoped grants, consent, and function authority. This Spec does not
extend its scope grammar.

LLP 0058 remains authoritative for shared invocation admission, prepared
authority, nested authority inheritance, and source-registry coverage. This
Spec adds rehearsal provenance to that lineage without creating another
invocation gate.

LLP 0045 remains authoritative for durable notification intents, claiming,
retry, cron delivery, and the prohibition on durable plaintext auth codes.
This Spec adds a protected provenance field to deferred intents.

LLP 0060 remains authoritative for public-edge reachability honesty and
charge-on-denial throttling. A loopback bind is not evidence that a deployment
is private.

LLP 0053 supplies the level-triggered termination pattern: terminal authority
is durable state checked at every admission and publication boundary, not a
one-shot revocation message.

LLP 0059 remains authoritative for the durable auth clock floor and
session/publication fences.

LLP 0150 owns the commissioned remote/CI extractable-key sender profile.
Nothing in this Spec claims that profile is implemented.

LLP 0031 remains authoritative for the route-registry axes and response
sensitivity classes.

Where this Spec conflicts with illustrative language in LLP 0212, LLP 0212's
pinned requirements prevail. This Spec closes the details LLP 0212 delegated.

## Normative vocabulary and constants

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative.

A **deployment profile** is exactly one of `dev`, `test`, `demo`, or `prod`.
It is not an LLP 0096 client auth profile.

A **grant** is the protected `authRehearsalGrant.v1` record plus its mutable
accounting and terminal state.

A **rehearsal capability** is the `sbrc_` carrier that proves possession of one
grant. The carrier is not a session, application credential, or LLP 0055 token.

An **effect** is one member of the closed enum in §Closed effect enum.

A **selector** is a mint-time-fixed, finite predicate constraining an effect.

A **rehearsal window** is a server-side policy object installed by consuming one
precommitted selector namespace.

An **honored effect** is an effect whose semantic linearization succeeds. A
charged denial is not an honored effect.

A **governing authority** is the exact grant or window whose continued validity
is required for derived sessions or assurances. If a window mediated the
derivation, the window is always the governing authority; the parent grant is
also checked transitively.

A **rehearsal-provenance invocation** is an invocation whose effective
authority is rehearsal-derived or whose assurance decision depends on
rehearsal-provenance evidence.

All durable and wire timestamps are Unix epoch milliseconds in
`0..=9_007_199_254_740_991`. Durable auth time uses LLP 0059's non-decreasing
clock floor.

| Name | Normative value |
| --- | --- |
| Grant record kind | `authRehearsalGrant.v1` |
| Window record kind | `authRehearsalWindow.v1` |
| Assurance provenance | `rehearsal` |
| Export-envelope kind | `authRehearsalExportEnvelope.v1` |
| Reachability-fact kind | `authRehearsalReachability.v1` |
| Deferred-provenance kind | `authRehearsalProvenance.v1` |
| Allowed deployment profiles | `dev`, `test`, `demo` |
| Required auth mode | settled, available `sessions` |
| Rehearsal carrier prefix | `sbrc_` |
| Rehearsal carrier entropy | 256 CSPRNG bits |
| Window selector entropy | 192 CSPRNG bits |
| Window domain suffix | `.rehearsal.invalid` |
| Window namespaces per install budget | exactly one |
| Carrier digest at rest | SHA-256 of complete canonical carrier |
| Export payload digest | SHA-256 of exact payload bytes |
| Export-envelope MAC | HMAC-SHA-256 |
| Ready-file sidecar mode | exactly `0600` |
| Ready-file directory expectation | owner-controlled; no-follow managed path |
| Credential response cache policy | `Cache-Control: no-store` |
| Collision candidate bound | three complete CSPRNG candidates |
| Wildcard effects/selectors | forbidden |
| Recursive allocation | forbidden |
| Budget renewal/replenishment | forbidden |
| Production mint or honor | forbidden |

The 192-bit window selector floor is closed, not an open question. It exceeds
LLP 0212's 128-bit minimum while leaving a valid DNS label after lowercase
base32 encoding: 24 random bytes encode to 39 lowercase base32 characters,
comfortably below DNS's 63-character label limit. It also preserves a wide
birthday margin across any plausible number of minted rehearsal windows.

The 256-bit `sbrc_` carrier follows LLP 0057's `ImpersonationCapability`
strength rather than inventing a weaker operator-plane bearer.

Operational TTL ceilings and default budget quantities remain the numeric open
questions at the end of this Draft. Their structure and fail postures are
closed here.

## Security boundaries and invariants

The protocol has twelve load-bearing invariants.

1. **Non-production is conjunctive.** Mint and use require `dev`, `test`, or
   `demo`; settled sessions mode; the exact instance; the exact boot nonce; the
   exact app; and the exact activation digest.

2. **Authority is named.** The grant contains only eight exact effects. No
   wildcard, prefix scope, future-effect catch-all, or tier exists.

3. **Every effect is selected.** Every granted effect has its mandatory
   mint-time selector. Missing, unknown, incompatible, or extra selectors
   refuse the grant.

4. **Every effect is finite.** Every effect maps to a named counter and every
   authenticated invocation is independently bounded by `maxUses`.

5. **Denials are not a free oracle.** Once a grant is resolved, non-idempotent
   denials charge the applicable attempt accounting. Public requests that
   cannot resolve a window remain subject to the ordinary LLP 0057/0060
   throttles.

6. **Allocation cannot amplify itself.** The allocation ceiling is immutable;
   consumed allocation never returns; allocation cannot mint authority, raise
   a ceiling, replenish a counter, or allocate more allocation authority.

7. **Clients never carry rehearsal authority.** Browser/native bundles,
   application source, query parameters, cookies, local storage, and public
   headers never receive `sbrc_`.

8. **Selector entropy is the foreign-caller boundary.** Reachability facts are
   defense in depth and claim-honesty inputs, not a substitute for entropy.

9. **First use marks the whole store.** No honored effect can become externally
   observable without the store being durably marked first or atomically with
   it.

10. **Derived authority cannot outlive its governor.** Sessions are
    expiry-clamped, assurances validate at use time, and the invocation gate
    checks terminal state level-triggeredly.

11. **Rehearsal provenance cannot disappear across scheduling.** Nested work
    inherits it and deferred work stores it durably.

12. **Real external egress has one gate.** Rehearsal-provenance work may use a
    declared simulator/test adapter, but it cannot contact a real external
    destination.

These are structural boundaries. Operator intent, a `demo` label, a loopback
socket, a test filename, or a comment cannot substitute for them.

## Plane classification and non-substitution

An auth rehearsal grant is an **operator/test-plane capability**.

It is minted under operator authority and exercises host/provider testing
effects. It does not represent an application principal.

The mint predicate is conjunctive:

```text
deploymentProfile ∈ {dev, test, demo}
AND authMode == sessions
AND authModeState == settled
AND authModeCapability == available
AND caller satisfies AdminWrite
AND caller satisfies ImpersonationCapability
AND target capability reports rehearsal available
AND requested record validates completely
```

No conjunct may be inferred from another.

In particular:

- `AdminWrite` does not satisfy `ImpersonationCapability`;
- `ImpersonationCapability` does not satisfy `AdminWrite`;
- a session does not satisfy either operator gate;
- an LLP 0055 credential or scoped token satisfies neither;
- a rehearsal capability satisfies neither `AdminWrite` nor
  `ImpersonationCapability`; and
- prior possession of another rehearsal capability cannot mint a grant.

The non-substitution boundary is bidirectional:

| Presented authority | Rehearsal effect | LLP 0055 function scope |
| --- | --- | --- |
| `sbrc_` rehearsal capability | eligible after grant checks | always refused |
| `sbagt_` LLP 0055 scoped token | always refused | eligible under LLP 0055 |
| human session | always refused as rehearsal carrier | ordinary session rules |
| `AdminWrite` alone | always refused | operator routes only |
| `ImpersonationCapability` alone | always refused | no application authority |
| `AdminWrite` + `ImpersonationCapability` | may mint, not substitute for a minted grant | operator routes only |

A rehearsal effect never invokes an application function merely because the
grant is operator-plane. When a fixture needs app memberships, it must run the
application's ordinary app-authorized transitions under the fixture
principal's real authority. If no such transition exists, fixture application
fails typed. Rehearsal does not add a membership effect.

## Grant minting

### General mint rules

A mint request MUST specify:

- exact effects;
- the mandatory selector for each effect;
- finite effect limits;
- a finite immutable allocation ceiling;
- finite `maxUses`;
- an explicit expiry;
- any precommitted window plans;
- a request idempotency key; and
- the exact target/app identity derived by the operator plane.

The server, not the caller, fills:

- `grantId`;
- `kind`;
- `instanceId`;
- `bootNonce`;
- `appId`;
- `activationDigest`;
- `deploymentProfile`;
- sessions-mode generation;
- creation time;
- creator audit identity;
- carrier hash;
- CSPRNG window namespaces; and
- initial zero-valued counters.

The caller may request a number of window plans and their finite behavior, but
MUST NOT supply window namespace bytes. Supplying such a field is an unknown
field and fails closed.

A mint is atomic. It either publishes the complete grant, all namespace
precommitments, the carrier digest, and its audit fact, or publishes none of
them.

A random collision retries the complete candidate, up to three candidates.
Partial grants, partial namespace sets, and deterministic collision repair are
forbidden.

### `snapback test` auto-mint

`snapback test` MAY auto-mint exactly when all of these facts hold:

1. it launched the exact server process;
2. it owns the mechanically derived ready-file path;
3. the ready descriptor names the live instance and startup nonce;
4. live `/health` confirms that startup nonce;
5. the app id and activation digest match the test artifact;
6. the deployment profile is `dev`, `test`, or `demo`;
7. sessions mode is settled and available;
8. the target reports rehearsal `available`;
9. the launcher possesses the ready-file `ImpersonationCapability` sidecar;
10. the launcher possesses `AdminWrite`; and
11. the requested grant template has explicit finite effects, selectors,
    budgets, expiry, and `maxUses`.

Auto-mint MUST refuse an attached server, caller-supplied URL, stale ready
descriptor, arbitrary sidecar path, pre-existing process, or remotely reached
target.

The auto-minted carrier is published only through the mechanically derived
rehearsal sidecar described in §Local wave-1 carrier custody.

Teardown revokes the grant, terminates its windows, removes managed sidecars,
and waits for level-triggered authority closure. Process exit remains an
independent terminal boundary.

## `authRehearsalGrant.v1`

### Logical schema

The protected logical record is:

```json
{
  "kind": "authRehearsalGrant.v1",
  "grantId": "uuid-v7",
  "instanceId": "uuid-v7",
  "bootNonce": "opaque-live-startup-nonce",
  "appId": "canonical-app-id",
  "activationDigest": "sha256:...",
  "sessionsModeGeneration": 1,
  "deploymentProfile": "test",
  "scopes": [
    "challenge.capture"
  ],
  "effectSelectors": {
    "challenge.capture": {
      "contacts": [
        {
          "kind": "contactNamespace",
          "fixtureNamespace": "acceptance",
          "domainDigest": "sha256:..."
        }
      ]
    }
  },
  "limits": {
    "challengeAttempts": 100,
    "identityCreates": 0,
    "sessionMints": 0,
    "verificationSimulations": 0,
    "windowInstalls": 0,
    "clockAdvances": 0,
    "allocationCeiling": 0,
    "maxUses": 100
  },
  "consumed": {
    "challengeAttempts": 0,
    "identityCreates": 0,
    "sessionMints": 0,
    "verificationSimulations": 0,
    "windowInstalls": 0,
    "clockAdvances": 0,
    "allocationUnits": 0,
    "usesCharged": 0
  },
  "createdAt": 0,
  "expiresAt": 0,
  "revokedAt": null,
  "createdBy": {
    "operatorAuditId": "opaque",
    "mintRequestDigest": "sha256:..."
  },
  "carrierHash": "sha256:..."
}
```

This is a logical schema. An implementation MAY normalize records across
protected tables, but the logical fields, validation, and atomicity are
normative.

All request and response DTOs are closed. JSON field names are camelCase.
Unknown fields, duplicate keys, unknown enum values, alternate encodings,
non-integer counts, negative counts, unsafe integers, and invalid timestamps
are refused.

`scopes` is sorted and duplicate-free.

`effectSelectors` has exactly one member for each member of `scopes` and no
other member.

Every effect counter appears in `limits` and `consumed`, including zero-valued
counters for absent effects. A scope requires a positive corresponding limit.

`allocationCeiling` may be zero when `budget.rehearsal.allocate` is absent. It
MUST be positive when that effect is present.

`maxUses` is always positive.

`carrierHash` is SHA-256 of the complete canonical `sbrc_` spelling. Carrier
plaintext is never durable.

`revokedAt` is the only mutable authority-status field. Expiry is immutable.
The derived status is live only while `revokedAt` is null and every binding and
time predicate remains valid.

The scopes, selectors, initial limits, allocation ceiling, expiry, bindings,
and window plans are immutable after mint. Narrowing or widening means revoke
and mint a new grant.

### Binding validation

Every effect use validates all of these against live server facts:

```text
record.kind == authRehearsalGrant.v1
record.instanceId == live instance id
record.bootNonce == live startup nonce
record.appId == live app id
record.activationDigest == live activation digest
record.sessionsModeGeneration == live settled sessions generation
record.deploymentProfile == live deployment profile
live deployment profile ∈ {dev, test, demo}
live auth mode == settled available sessions
record.revokedAt == null
durableNow < record.expiresAt
```

A mismatch refuses before effect-specific state is read or changed.

Restart changes the boot nonce and invalidates every prior grant.

Reset rotates the relevant instance/authorization incarnation and invalidates
every prior grant even if the process remains alive.

Activation change invalidates every prior grant even if the app id and process
remain unchanged.

Changing from sessions mode, entering pending/quarantined mode, or changing the
sessions generation invalidates every prior grant.

A grant never revalidates if the server later returns to an equal-looking
configuration. A terminal binding mismatch is recorded and treated as ended.

## Closed effect enum

The scope enum is exactly:

```text
challenge.capture
challenge.redeem
fixture.identity.create
fixture.session.mint
verification.simulate
window.install
budget.rehearsal.allocate
clock.auth.advance
```

No other value is accepted.

The following forms are specifically invalid:

```text
*
auth.*
challenge.*
fixture.*
verification
window
budget.rehearsal.*
future
```

An implementation MUST use an exhaustive enum match. A new effect requires a
reviewed Spec amendment, a selector definition, a counter mapping, diagnostics,
route classification, and acceptance rows.

## Total effect-to-counter mapping

The mapping is total:

| Effect | Named effect counter | Counter class | Semantic charge |
| --- | --- | --- | --- |
| `challenge.capture` | `challengeAttempts` | attempt | one for every resolved capture attempt, success or denial |
| `challenge.redeem` | `challengeAttempts` | attempt | one for every resolved redemption attempt, including wrong/expired/consumed codes |
| `fixture.identity.create` | `identityCreates` | successful effect | one per identity durably created |
| `fixture.session.mint` | `sessionMints` | successful effect | one per session durably minted |
| `verification.simulate` | `verificationSimulations` | successful effect | one per assurance durably minted |
| `window.install` | `windowInstalls` | successful effect | one per namespace installation committed |
| `budget.rehearsal.allocate` | `allocationCeiling` | successful quantity | requested units added to `allocationUnits` |
| `clock.auth.advance` | `clockAdvances` | successful effect | one per committed auth-clock advance |
| every effect | `maxUses` | attempt | one per non-idempotent resolved invocation, including denial |

`maxUses` is an independent universal attempt counter. It is not a wildcard
effect and grants no authority.

### Atomic charge at linearization

Accounting and the semantic effect share one serialized decision.

For a successful durable effect, the effect counter, `usesCharged`, idempotency
record, store marker when first needed, audit fact, and semantic write commit in
one transaction.

For `challenge.capture`, whose secret result is process-local, the durable
accounting, idempotency outcome, audit fact, and first-use store marker commit
before the mailbox value is released. A crash may conservatively leave a
marked store without returning the code; it cannot return a code from an
unmarked store.

For external or process-local effects, no external result is released before
the durable accounting boundary commits.

For a denial after grant resolution:

- `usesCharged` increments once;
- an attempt-class effect counter increments once;
- successful-effect quota counters do not increment;
- the denial outcome is recorded under the request idempotency identity; and
- no semantic effect occurs.

A malformed or unknown carrier that cannot resolve a grant cannot charge that
grant. It remains subject to the ordinary bounded public/operator ingress
throttle.

A production `sbrc_` refusal occurs before grant lookup and therefore does not
charge a grant that production must not recognize.

### Request-bound idempotency

Every effect request carries an idempotency key.

The idempotency identity is:

```text
grantId
effect
idempotencyKey
SHA-256(canonical complete normalized request)
```

The normalized request includes every selector input, requested quantity,
challenge proof, identity reference, window plan id, clock delta, and target
binding relevant to the effect.

An exact retry returns the recorded outcome and neither double-charges nor
re-executes the effect.

The same idempotency key with a different normalized request digest is an
idempotency conflict. It is a distinct charged denial and cannot reuse the
first request's successful outcome.

A caller therefore cannot hold one idempotency key constant while changing
wrong-code guesses for free.

Idempotency storage survives process restart for at least the entire authority
record retention period. Restart still invalidates the grant; retained
idempotency state exists to prevent ambiguous replay, not to revive authority.

Commit ambiguity follows LLP 0057/0059 exact-successor reconciliation. The
server re-reads the durable effect, accounting, and idempotency rows and accepts
only the exact predecessor or exact intended successor. It never guesses that
an effect rolled back and executes a second effect.

### Immutable allocation ceiling

`allocationCeiling` is fixed at grant mint.

Every successful `budget.rehearsal.allocate` request carries a positive integer
`units`.

The allocator checks and commits:

```text
newAllocationUnits = oldAllocationUnits + requestedUnits
newAllocationUnits <= allocationCeiling
```

`allocationUnits` is monotone.

Units remain consumed when:

- the allocated budget expires;
- a window expires;
- the operation using the allocation is denied;
- the downstream resource is unused;
- the grant is revoked; or
- a process restarts.

There is no deallocation, refund, replenishment, renewal, or ceiling edit.

Allocation may create only a finite rehearsal-budget record for one
mint-authorized budget name and exact charge-axis tuple.

Allocation MUST NOT:

- allocate `allocationCeiling`;
- allocate `maxUses`;
- allocate any rehearsal effect counter;
- raise any grant or window budget;
- change selectors;
- change expiry;
- mint another grant;
- mint another carrier;
- create a recursive allocator; or
- renew an expired or exhausted budget.

### `maxUses`

`maxUses` bounds the number of resolved, non-idempotent effect invocations
independently of every effect counter and allocation quantity.

When `usesCharged == maxUses`, every new request refuses
`SNAPBACK_AUTH_REHEARSAL_BUDGET_EXHAUSTED`.

An exact idempotent replay remains readable after exhaustion because it does
not create another use.

A failed challenge guess consumes both one `challengeAttempts` unit and one
`maxUses` unit.

A failed selector or scope substitution consumes one `maxUses` unit once the
grant and effect request are structurally resolvable.

## Total effect-to-selector mapping

Selectors are finite, exact, and fixed at mint.

The logical selector variants are:

```text
ExactContactSelectorV1
ContactNamespaceSelectorV1
FixtureSelectorV1
IdentitySelectorV1
WindowPlanSelectorV1
BudgetAllocationSelectorV1
AuthClockSelectorV1
```

Unknown selector variants refuse.

### Contact selectors

An exact contact selector is:

```json
{
  "kind": "exactContact",
  "canonicalAddressDigest": "sha256:..."
}
```

A contact namespace selector is:

```json
{
  "kind": "contactNamespace",
  "fixtureNamespace": "acceptance",
  "domainDigest": "sha256:..."
}
```

Digests use a domain-separated SHA-256 over the complete canonical address or
domain. They are equality commitments, not authentication keys.

A contact selector never contains:

- a glob;
- a regex;
- a prefix match;
- a suffix other than the exact committed domain;
- a catch-all local part outside a committed namespace;
- Unicode alternate spellings; or
- caller-selected normalization rules.

Canonicalization occurs before comparison under the provider's canonical
address rules.

### Identity selectors

An identity selector is one of:

```json
{
  "kind": "identityId",
  "identityId": "idn_..."
}
```

```json
{
  "kind": "fixtureAlias",
  "fixtureNamespace": "acceptance",
  "alias": "buyer-0007"
}
```

```json
{
  "kind": "windowNamespace",
  "windowPlanId": "uuid-v7"
}
```

A fixture alias resolves only through the protected fixture receipt created
under the same grant and exact fixture namespace.

A window-namespace selector matches only an identity created from a contact in
the named installed window.

Client-supplied user ids, unbound email text, and application row ids are not
identity selectors.

### Effect mapping

| Effect | Mandatory selector field | Required semantics |
| --- | --- | --- |
| `challenge.capture` | `contacts` | nonempty finite exact-contact or contact-namespace set |
| `challenge.redeem` | `contacts` | nonempty finite exact-contact or contact-namespace set; the challenge must resolve to one member |
| `fixture.identity.create` | `fixtures` | nonempty finite set of exact `{fixtureNamespace, contact}` pairs |
| `fixture.session.mint` | `fixtures` | nonempty finite set of exact `{fixtureNamespace, contact}` pairs; selected identity must belong to one |
| `verification.simulate` | `identities` | nonempty finite identity-selector set |
| `window.install` | `windowPlans` | exactly one precommitted plan per budgeted install |
| `budget.rehearsal.allocate` | `allocations` | nonempty finite set of exact `{budgetName, chargeAxes}` tuples |
| `clock.auth.advance` | `authClock` | exact `{storeId, clockDomain: "auth", disposableMarkerId}` |

A missing selector refuses mint.

A selector present for an absent effect refuses mint.

An effect request incompatible with its selector refuses before semantic work.

An implementation MUST NOT treat a missing selector as "all", "current app",
"current user", "localhost", or any other default.

### Fixture selectors

A fixture selector is:

```json
{
  "fixtureNamespace": "acceptance",
  "contact": {
    "kind": "exactContact",
    "canonicalAddressDigest": "sha256:..."
  }
}
```

or:

```json
{
  "fixtureNamespace": "acceptance",
  "contact": {
    "kind": "contactNamespace",
    "fixtureNamespace": "acceptance",
    "domainDigest": "sha256:..."
  }
}
```

The two fixture namespace values must agree in the second form.

Logical aliases are deterministic only within the fixture namespace. Raw
principal and identity ids remain freshly minted.

A reset may permit the same logical alias to be reconciled to a new principal,
but never revives a prior grant or session.

### Budget-allocation selectors

A budget-allocation selector is:

```json
{
  "budgetName": "registered-budget-name",
  "chargeAxes": [
    {
      "axis": "app",
      "valueDigest": "sha256:..."
    }
  ]
}
```

`budgetName` must be registered by the effect-budgets Spec commissioned by LLP
0212.

`chargeAxes` is the complete canonical axis tuple required by that budget.
Omitting a required axis, supplying an extra axis, changing axis order after
canonicalization, or supplying caller text where the axis must be server
derived refuses.

The allowed axis names are owned by the budgets Spec. This Spec requires exact
finite equality and forbids `all`, `any`, `*`, inherited, or dynamically
widened axes.

### Auth-clock selector

The auth-clock selector is exactly:

```json
{
  "storeId": "uuid-v7",
  "clockDomain": "auth",
  "disposableMarkerId": "uuid-v7"
}
```

The current store must match `storeId`.

The creation-time disposable marker must exist and match
`disposableMarkerId`.

No selector can name wall clock, OS clock, application time, another store,
another clock domain, or an ordinary non-disposable store.

## Rehearsal windows

### Window plan precommitment

Every `window.install` selector contains `windowPlans`.

At grant mint the caller supplies the finite behavior and budget request for
each plan, but the host supplies its namespace.

A logical plan is:

```json
{
  "windowPlanId": "uuid-v7",
  "namespaceDigest": "sha256:...",
  "enabledEffects": [
    "challenge.capture",
    "challenge.redeem",
    "verification.simulate"
  ],
  "windowBudgetLimits": {
    "challengeAttempts": 100,
    "verificationSimulations": 20,
    "sessionMints": 20
  },
  "expiresNoLaterThan": 0
}
```

The plaintext namespace is returned exactly once in the mint response and
eligible owner-only sidecar. The protected record retains its commitment.

Every enabled effect must also appear in the parent grant's scope and must have
a compatible selector referencing the same `windowPlanId` or namespace
commitment.

Window budgets are finite and count within the parent grant's effect counters,
`maxUses`, and immutable allocation ceiling as applicable. A window never
creates independent replenishable authority.

The following cardinality invariant is exact:

```text
limits.windowInstalls == effectSelectors["window.install"].windowPlans.length
```

The plans are distinct.

A grant with `windowInstalls: N` precommits exactly `N` namespaces.

A grant with the `window.install` effect and zero plans is invalid.

A grant with plans but no `window.install` effect is invalid.

### Namespace spelling and entropy

Each namespace uses 24 CSPRNG bytes.

The host encodes those bytes as 39 lowercase unpadded base32 characters and
constructs:

```text
<39-lowercase-base32>.rehearsal.invalid
```

The exact ASCII domain is canonical.

The namespace is not caller chosen, derived from app id, derived from grant id,
sequential, timestamp based, deterministic in production code, or reused from
a fixture name.

Test-only deterministic RNG injection may force collisions for acceptance
testing, but it is not an admissible runtime RNG.

The server commits a domain-separated digest:

```text
SHA-256(
  "snapback.auth-rehearsal.window-namespace.v1\0"
  || LP(canonicalNamespace)
)
```

The plaintext namespace is sensitivity-classified like credential material:
no-store, no body logging, no receipts, no diagnostics, no traces, and no
default machine transcript.

### Collision and reuse

Grant mint checks each candidate against:

- every unconsumed namespace reservation;
- every live window;
- every terminal window namespace tombstone; and
- every other candidate in the same mint.

A collision retries the complete candidate up to the three-candidate bound.

Exhaustion refuses the whole grant mint with no carrier or partial namespace
publication.

A namespace reservation has exactly three states:

```text
reserved
installed
terminal
```

The only forward transitions are:

```text
reserved -> installed -> terminal
reserved -> terminal
```

There is no transition back to `reserved`.

Expiry or revocation before installation moves the reservation to `terminal`.

Reset, restart, activation change, or parent grant termination moves every
reservation/window to `terminal`.

Terminal namespace commitments remain in the protected non-reuse ledger for
the lifetime of the store lineage. Reset does not clear them.

### Installation

An install request names:

- the exact `windowPlanId`;
- the grant carrier;
- an idempotency key; and
- no caller-supplied namespace or widened behavior.

Installation validates the parent grant, selector, reachability fact, plan
budget, and namespace reservation.

Its linearization point is one transaction that:

- charges `maxUses`;
- charges `windowInstalls`;
- consumes the exact reservation;
- creates `authRehearsalWindow.v1`;
- records its separate window counters;
- records the idempotency outcome;
- records the audit fact; and
- applies the first-use store marker if this is the first honored effect.

A concurrent installation of the same reservation has exactly one winner.

An exact idempotent retry returns the winner's window receipt without another
charge.

A different request after consumption is a charged denial. It cannot create a
second window.

Post-mint mutation of namespace, enabled effects, budget ceilings, expiry
ceiling, app binding, or selectors is forbidden.

### Window behavior

A window is:

```json
{
  "kind": "authRehearsalWindow.v1",
  "windowId": "uuid-v7",
  "grantId": "uuid-v7",
  "windowPlanId": "uuid-v7",
  "namespaceDigest": "sha256:...",
  "instanceId": "uuid-v7",
  "bootNonce": "opaque",
  "appId": "canonical-app-id",
  "activationDigest": "sha256:...",
  "createdAt": 0,
  "expiresAt": 0,
  "revokedAt": null
}
```

The window expiry is no later than:

- the plan's `expiresNoLaterThan`;
- the parent grant expiry; and
- every applicable allocated budget expiry.

An ordinary app request enters a window only when its canonical contact domain
matches the committed namespace and the window is live.

The request carries no `sbrc_`, rehearsal header, query flag, cookie, or body
authority.

Within the live window, matching local parts are not individually precommitted,
but every honored effect remains bounded by the window and parent counters.

The namespace matches one installation, not one request. "One use" applies to
installation. Multiple matching requests may proceed only within finite
budgets.

A nonmatching request follows the ordinary auth provider path.

A guessed matching namespace does not gain application authorization. It gains
only the finite enabled rehearsal behavior of that exact window.

### Reachability fact

The target-authored closed fact is:

```json
{
  "kind": "authRehearsalReachability.v1",
  "targetClass": "registered-target-class",
  "exposure": "publishedPublic",
  "producerVersion": 1,
  "targetBuildDigest": "sha256:...",
  "deploymentConfigDigest": "sha256:..."
}
```

`exposure` is exactly:

```text
publishedPublic
notPublicByDesign
```

Unknown fields or enum values make a present fact invalid.

The fact is target-authored. Operator config, request bodies, forwarded
headers, bind-address booleans, or environment variables cannot manufacture or
override it.

Installation behavior is:

| Reachability input | Window installation |
| --- | --- |
| valid `publishedPublic` | refuse |
| valid `notPublicByDesign` | proceed, still relying on selector entropy |
| absent on wave-1 local target | proceed with the named residual |
| absent on any target not registered as the wave-1 exception | refuse producer-parity failure |
| malformed, unverifiable, or wrong-build fact | refuse |

A `publishedPublic` refusal is defense in depth. It is not evidence that
non-public facts prove privacy.

The wave-1 local target is the sole named absence exception. Its absent fact
means only:

> Snapback has no target-authored reachability statement for this topology.
> Installation proceeds on 192-bit selector entropy. A loopback server may be
> publicly re-exposed by a reverse proxy, and Snapback does not detect that.

A loopback bind behind a public proxy therefore takes the absent-local branch
and proceeds. The foreign-caller guessing guarantees still rely on the
namespace entropy and finite budgets.

Fail-closed-on-unknown reachability is deliberately rejected for the named
wave-1 local target because it would refuse the only wave-1 topology without
strengthening the actual selector boundary.

### Producer-parity gate

The target-class registry carries exactly one of:

```text
reachabilityFactProducerRequired
wave1LocalAbsenceException
```

Every target class public by design MUST be
`reachabilityFactProducerRequired`.

Only the wave-1 local target may carry `wave1LocalAbsenceException`.

Adding a rehearsal-capable target class without one classification fails the
registry drift gate.

A public-by-design class lacking a producer fails build/qualification.

A producer-required target whose fact is absent at runtime refuses window
installation.

The producer-parity gate prevents accidental producer omission from silently
selecting the local unknown/proceed branch.

## Local wave-1 carrier custody

### Carrier spelling

The rehearsal carrier is:

```text
sbrc_<base64url-no-pad of 32 bytes>.<8 lowercase hexadecimal CRC32>
```

The CRC is corruption detection, not authentication.

The server retains only SHA-256 of the complete canonical carrier and the
grant's exact bindings.

The raw carrier is held in a non-cloneable, non-serializable, zeroizing wrapper
during publication and then discarded by the server.

The `sbrc_` class MUST be added to the repository's registered credential
namespace.

The mechanical check is the existing
`credential_prefixes_are_mutually_prefix_free` acceptance test over
`REGISTERED_CREDENTIAL_PREFIXES`.

That check must prove:

- `sbrc_` is mutually prefix-free with every registered class;
- every existing resolver rejects `sbrc_`;
- the rehearsal resolver rejects every other class;
- identifiers and non-bearer classes never authenticate; and
- unknown prefixes never fall through to anonymous authority.

### Ready-file sidecar

For auto-mint, the mechanically derived sibling is:

```text
<ready-file>.auth-rehearsal
```

The ready descriptor names that exact sibling in
`authRehearsalCapabilityFile`.

Discovery accepts no arbitrary path.

The sidecar is:

- a regular file;
- owned by the effective service/launcher identity;
- mode exactly `0600`;
- one hard link;
- opened no-follow;
- size bounded;
- included in managed-path alias checks;
- atomically published before the descriptor that names it; and
- removed with ready-file teardown.

A mode or ownership mismatch is refused, not repaired in place.

The sidecar contains a closed, size-bounded object carrying only:

```json
{
  "kind": "authRehearsalCarrier.v1",
  "grantId": "uuid-v7",
  "bootNonce": "opaque-live-startup-nonce",
  "carrier": "sbrc_...",
  "windowNamespaces": [
    {
      "windowPlanId": "uuid-v7",
      "namespace": "<secret>.rehearsal.invalid"
    }
  ]
}
```

The object is credential-sensitive. It never enters a normal JSON command
receipt.

Discovery validates the ready descriptor's startup nonce against live health
before reading the sidecar.

A stale descriptor, stale sidecar, cross-worktree path, replaced file, symlink,
or hard-linked file refuses.

### Stdin attachment

A later local CLI accepts the carrier only through an explicit bounded stdin
attachment, provisionally named:

```text
--auth-rehearsal-capability-stdin
```

The flag:

- is accepted only by registered rehearsal operations;
- conflicts with `--ready-file`;
- requires an exact local target whose health identity is verified;
- reads at most 512 bytes;
- requires canonical `sbrc_` spelling;
- stores input only in zeroizing memory; and
- never echoes input.

The carrier is never accepted from:

- argv;
- an environment variable;
- a query parameter;
- a request body field other than the internal registered carrier attachment;
- a cookie;
- a browser storage API;
- a generated app constant;
- application config;
- a model-visible command receipt; or
- an arbitrary filesystem path.

HTTP transport inside the local operator projection uses only the dedicated
`x-snapback-auth-rehearsal-capability` header after CLI custody. The header is
not CORS-allowed and is accepted only on registered rehearsal operations.

No browser console prompt or client SDK setter accepts it.

### Remote and CI carriage

Wave 1 has no remote or CI rehearsal-carriage claim.

A URL target that is not verified as the launcher-owned local process refuses
the stdin carrier.

A remote server does not accept a raw `sbrc_` bearer merely because TLS is
present.

Remote/CI carriage requires the key-bound, per-request proof profile
commissioned by LLP 0150:

- an extractable-key agent profile;
- canonical request proofs;
- replay protection;
- exact target and grant binding;
- cross-process nonce custody; and
- a separately reviewed carrier/response contract.

Until that profile lands, capability manifests report remote/CI rehearsal
carriage absent.

## Effect execution and audit

Every effect request passes this order:

1. classify the carrier prefix;
2. enforce production prefix-class refusal;
3. parse the closed operation DTO;
4. resolve the `sbrc_` digest;
5. validate grant bindings and terminal state;
6. bind the complete normalized request to idempotency;
7. charge the universal attempt accounting;
8. require exact effect scope;
9. require the mandatory selector and exact match;
10. apply effect-specific preconditions;
11. atomically charge successful-effect quota and linearize the effect; and
12. return a redacted, no-store result.

The effect audit fact contains:

- grant id;
- window id when applicable;
- actor audit id;
- app id;
- activation digest;
- effect enum;
- selector class, never selector plaintext;
- idempotency digest;
- counter before/after values;
- outcome class;
- governing authority;
- timestamp; and
- terminal reason when applicable.

It never contains carrier bytes, namespace plaintext, contact address, code,
session bearer, provider token, verification proof, key material, or raw
payload.

Every audit-producing path uses a closed outcome enum. Free-form exception text
does not become the machine outcome.

## Derived sessions, assurances, and termination

### Governing authority

Every rehearsal-derived session and assurance records:

```json
{
  "kind": "grant",
  "grantId": "uuid-v7"
}
```

or:

```json
{
  "kind": "window",
  "windowId": "uuid-v7",
  "parentGrantId": "uuid-v7"
}
```

If a window mediated creation, the second form is mandatory. Recording only the
parent grant is invalid.

### Derived sessions

A rehearsal-derived session's expiry is:

```text
min(
  ordinary session expiry,
  governing authority expiry,
  parent grant expiry when the governor is a window
)
```

The session also retains the governing-authority reference in protected state.

Possession of the session bearer is necessary but insufficient.

At every invocation admission and final publication/commit boundary, the shared
gate validates:

- ordinary session state;
- governing authority existence;
- governing authority not revoked;
- governing authority not expired;
- parent grant live when the governor is a window;
- exact app/instance/boot/activation binding;
- sessions mode still settled; and
- non-production posture.

A terminal governing authority causes immediate
`SNAPBACK_AUTH_REHEARSAL_AUTHORITY_ENDED` refusal on the gated operator
diagnostic plane. Public session surfaces retain their ordinary
non-enumerating expired/revoked shape.

### Simulated assurances

`verification.simulate` may mint only an assurance kind defined by the
identity-core contract.

The rehearsal extension is:

```json
{
  "kind": "email_verified",
  "provenance": "rehearsal",
  "issuedAt": 0,
  "expiresAt": 0,
  "governingAuthority": {
    "kind": "grant",
    "grantId": "uuid-v7"
  }
}
```

The assurance kind and provenance are independent fields.

Rehearsal never invents a new assurance kind and never rewrites provenance to
`delivery`, `import`, or another production-admissible source.

A requirement may accept rehearsal provenance only on a non-production
deployment profile.

The assurance evaluator validates governing authority at **use time**, not only
at mint or session creation.

When multiple admissible assurances could satisfy a requirement, the evaluator
deterministically prefers a non-rehearsal assurance. If the effective decision
depends on any rehearsal assurance, the prepared invocation carries rehearsal
provenance.

A rehearsal-derived session remains rehearsal-provenance authority even if a
later real assurance could independently satisfy the function requirement.

### Level-triggered termination

Expiry, explicit revocation, reset, restart, activation change, mode change, and
binding failure are terminal authority transitions.

Termination is level-triggered state:

- a terminal premark closes new admission;
- every act-time gate reads the current terminal state;
- in-flight work must pass the final publication fence;
- stale wakeups cannot reopen authority;
- process restart reconstructs terminal truth from durable state and live
  bindings; and
- no one-shot notification is trusted as the revocation mechanism.

A window ends independently of its parent grant.

Window expiry or revocation terminates every window-derived session and
assurance even when the parent grant remains live.

Grant termination ends every child window and every grant- or window-derived
session and assurance.

### Derived identities

Every rehearsal-created identity carries protected rehearsal provenance and
the exact creating grant/window lineage.

When its governing authority ends, the identity becomes **inert immediately**:

- ordinary session mint refuses;
- credential enrollment refuses unless an ordinary non-rehearsal lifecycle
  transition independently authorizes it;
- assurance use still validates provenance;
- no window is inferred from the identity alone; and
- application authorization is not inherited from its rehearsal origin.

A target MAY sweep inert rehearsal identities later under a bounded GC policy.

Whether swept or retained, no derived identity can yield live authority after
its governor ends without a new grant and a newly authorized, selector-matching
effect.

## Store admission and permanent markers

### Marker schema

The protected store marker is logically:

```json
{
  "kind": "authRehearsalStoreMarkers.v1",
  "storeId": "uuid-v7",
  "disposableAtCreation": false,
  "disposableMarkerId": null,
  "rehearsalAdmitted": false,
  "firstAdmissionAt": null,
  "firstAdmissionGrantDigest": null,
  "firstAdmissionEffect": null
}
```

A disposable store instead begins:

```json
{
  "kind": "authRehearsalStoreMarkers.v1",
  "storeId": "uuid-v7",
  "disposableAtCreation": true,
  "disposableMarkerId": "uuid-v7",
  "rehearsalAdmitted": false,
  "firstAdmissionAt": null,
  "firstAdmissionGrantDigest": null,
  "firstAdmissionEffect": null
}
```

`disposableAtCreation` is chosen only while creating an empty store.

It cannot be added to an existing store, cleared, or downgraded.

On first honored rehearsal effect, the store transitions atomically to:

```text
rehearsalAdmitted = true
firstAdmissionAt = durableNow
firstAdmissionGrantDigest = domain-separated digest of grant id
firstAdmissionEffect = exact closed effect enum
```

The transition is monotone and permanent.

A denial does not by itself set `rehearsalAdmitted`, although its budget charge
and audit fact remain durable.

### Same-transaction rule

For a durable effect, the first-admission marker and effect commit in the same
transaction.

For an effect whose externally visible result is not itself durable, the marker
transaction commits before the result can become visible.

Permitted crash outcomes are:

```text
no effect, no marker
no externally observed effect, marker present
effect committed/observed, marker present
```

The forbidden outcome is:

```text
effect committed/observed, marker absent
```

A conservative false-positive marker is acceptable. A false-negative marker is
not.

### Survival

The marker survives:

- app reset;
- auth reset;
- ordinary restart;
- activation change;
- physical backup;
- declared physical restore;
- supported clone;
- logical export;
- logical import;
- migration;
- compaction; and
- app-data-only export.

Reset MUST NOT delete or recreate the marker row.

A supported physical backup captures the database, auth keyring, and marker
under LLP 0057's quiescence/LTX-boundary rules.

A declared restore preserves the marker before any production admission check.

A supported clone receives the same marker state and store-lineage identity or
an integrity-bound derived identity that retains the source marker state. It
cannot become a clean unrelated store.

Logical export cannot omit the marker envelope merely because the selected
payload excludes protected auth tables.

### Promotion policy

A store is ineligible for production promotion if either is true:

```text
disposableAtCreation == true
rehearsalAdmitted == true
```

The ineligibility is permanent for that store lineage.

Production promotion includes:

- starting a production deployment from the store;
- importing into a production candidate;
- restoring into a production candidate;
- cloning into a production candidate;
- publishing the store as a production seed;
- app-data-only promotion; and
- any Snapback-mediated equivalent.

Row deletion, reset, principal deletion, grant revocation, waiting for expiry,
or removal of rehearsal-derived auth rows does not make the store eligible.

Hand-copying bytes outside Snapback-mediated paths remains outside the
mechanical claim. Snapback's supported promotion paths refuse laundering.

## Logical-export provenance envelope

### Envelope schema

Every logical export carries a closed envelope:

```json
{
  "kind": "authRehearsalExportEnvelope.v1",
  "artifactId": "uuid-v7",
  "sourceStoreId": "uuid-v7",
  "payloadSha256": "base64url-no-pad-32-bytes",
  "markerState": {
    "disposableAtCreation": false,
    "disposableMarkerId": null,
    "rehearsalAdmitted": false,
    "firstAdmissionAt": null,
    "firstAdmissionGrantDigest": null,
    "firstAdmissionEffect": null
  },
  "snapshotWitness": {
    "authorizationIncarnation": "uuid-v7",
    "databaseVersion": 1
  },
  "sourceKeyId": "sbak_...",
  "mac": "base64url-no-pad-32-bytes"
}
```

Unknown fields, duplicate keys, alternate base64url spellings, unsupported
versions, unsafe timestamps, inconsistent nullability, and unknown effect
values fail closed.

`payloadSha256` hashes the exact payload bytes presented to import, after final
compression/container production. Import hashes the bytes before parsing or
writing them.

`sourceStoreId` must match the store identity encoded in the export payload's
closed metadata.

The envelope's marker state is the state of the snapshot from which the payload
was read.

### Snapshot consistency

Logical export uses one snapshot-consistent boundary for:

- payload rows;
- source store identity;
- marker state;
- authorization incarnation; and
- database/version witness.

The exporter retains the exact keyring view used to derive the envelope key
while producing the MAC.

A marker transition racing export yields either:

- a complete pre-admission snapshot with a clean authenticated envelope; or
- a complete at-or-after-admission snapshot with a tainted authenticated
  envelope.

It cannot yield rehearsal-derived payload with a clean authenticated marker.

A raw database or row copy without this boundary is not a Snapback logical
export.

### MAC primitive

Let `K_auth` be the exact 32-byte material of the retained LLP 0057 auth-keyring
key identified by `sourceKeyId`.

Derive the store-specific export key:

```text
K_export =
  HMAC-SHA-256(
    K_auth,
    "snapback.auth-rehearsal.export-key.v1\0"
    || LP(sourceStoreId)
    || LP(sourceKeyId)
  )
```

Encode the envelope's non-MAC fields into a closed length-prefixed binary form
in the field order shown above.

Compute:

```text
mac =
  HMAC-SHA-256(
    K_export,
    "snapback.auth-rehearsal.export-envelope.v1\0"
    || LP(encodedEnvelopeWithoutMac)
  )
```

The serialized JSON is not itself treated as canonical MAC input. It is decoded
through the closed schema and re-encoded into the pinned binary form.

The envelope never carries `K_auth` or `K_export`.

Envelope verification compares the MAC in constant time.

The existing LLP 0057 auth keyring remains closed. This Spec does not add fields
to its format.

### Cross-host verification-key custody

A same-host import derives `K_export` from its trusted retained source keyring.

A cross-host import requires the destination host to possess an independently
transferred verification-key capsule containing the exact derived `K_export`
for `(sourceStoreId, sourceKeyId)`.

The capsule is not part of the export artifact.

It moves only through a declared operator-key transfer:

- owner-only source and destination files, mode `0600`;
- or bounded explicit stdin between trusted operators;
- never argv or environment;
- never app config;
- never a repository artifact;
- never stdout or ordinary JSON receipts;
- never a browser or application API; and
- never an envelope-provided key.

The destination stores the capsule in a host-owned, no-follow, owner-only trust
store keyed by `(sourceStoreId, sourceKeyId)`.

A missing key, wrong key, ambiguous duplicate, malformed capsule, or
envelope-supplied key fails closed.

Because HMAC is symmetric, a destination trusted with `K_export` can forge
envelopes for that source store/key pair. That destination is therefore inside
the import trust boundary. The derivation is store-specific and does not expose
the source auth key or permit challenge-code verification. Cross-organization
verification without trusting the destination to forge would require a future
signature profile; it is not claimed here.

### Import policy

Import performs this order:

1. require the envelope;
2. parse its closed schema;
3. find the independently trusted verification key;
4. verify the MAC;
5. hash the exact payload bytes;
6. compare `payloadSha256`;
7. parse the payload's closed metadata;
8. compare source store identity and snapshot witness;
9. evaluate marker policy;
10. apply the destination-profile gate; and
11. write payload and marker state atomically.

Missing, malformed, unverifiable, mismatched, or contradictory provenance
fails before any destination write.

A production destination refuses when:

```text
markerState.disposableAtCreation == true
OR markerState.rehearsalAdmitted == true
```

A non-production destination MAY import such an artifact, but it must preserve
both markers atomically.

### Pre-taint policy

The envelope authenticates marker state **at export time**.

Ineligibility binds to:

- every store state at or after first rehearsal admission; and
- every export taken from such a state.

A verifiably pre-taint export remains promotable by design.

The safety argument is structural:

1. the first admission marker commits in the same transaction as the first
   durable rehearsal effect, or before a non-durable effect is exposed;
2. logical export is snapshot-consistent;
3. the envelope authenticates the exact payload hash, store identity, and
   marker state from that snapshot; and
4. therefore a clean-verifying envelope cannot contain rehearsal-derived
   state.

The exact sequence:

```text
export clean snapshot A
honor first rehearsal effect in source store B
import old clean snapshot A into production
```

is admitted.

The imported bytes are the pre-rehearsal bytes of A. The later taint of B does
not travel backward in time.

No external monotonic lineage authority is required for this policy.

The following remain refused:

- any export taken from B;
- a tainted envelope replay;
- a clean envelope spliced onto B's payload;
- a clean envelope with any substituted payload;
- a clean envelope for another store identity; and
- an envelope whose verification key is missing or untrusted.

## Disposable-at-creation stores and auth clock

A disposable store is marked during empty-store creation, before any schema,
seed, auth identity, or app row is written.

The marker is distinct from rehearsal admission:

- disposable marking says the store must never be promoted even before
  rehearsal;
- admission marking says an honored rehearsal effect occurred.

Both share:

- protected storage;
- monotone survival;
- backup/restore behavior;
- clone behavior;
- logical-export envelope integrity; and
- production-promotion refusal.

`clock.auth.advance` requires the disposable marker before it charges or
advances the clock.

The effect advances only LLP 0059's auth-domain injected clock/floor for the
selected store. It never changes OS time or application time.

A successful advance:

- charges `maxUses`;
- charges `clockAdvances`;
- sets rehearsal admission if needed;
- records the exact prior and successor auth-clock values;
- preserves non-decreasing time; and
- commits atomically.

The clock may move forward only.

Teardown does not lower the durable floor.

Because the store was disposable from creation, a far-future floor cannot wedge
an ordinary promotable database.

An ordinary store presented to `clock.auth.advance` refuses
`SNAPBACK_AUTH_REHEARSAL_DISPOSABLE_REQUIRED` without advancing time.

## Rehearsal provenance in invocation authority

### Provenance shape

The sealed server-only value is:

```json
{
  "kind": "authRehearsalProvenance.v1",
  "governingAuthorities": [
    {
      "kind": "window",
      "windowId": "uuid-v7",
      "parentGrantId": "uuid-v7"
    }
  ],
  "authorityDecisionDigest": "sha256:...",
  "assuranceDecisionDigest": "sha256:..."
}
```

The set is canonical, duplicate-free, and monotone under composition.

The value is not projected into application-controlled request fields.

Application code cannot create, clear, replace, or serialize a fake clean
value.

### Derivation

After resolving effective authority and evaluating function assurances, the
shared gate derives provenance from both decisions.

The invocation is rehearsal-provenance when either is true:

- the effective authority is a session or principal authority governed by a
  rehearsal grant/window; or
- the assurance decision actually used one or more
  `provenance: rehearsal` assurances.

Merely storing a rehearsal assurance that was not used does not mark a clean
session invocation when a non-rehearsal assurance satisfied the requirement.

A rehearsal-derived session remains marked even if no assurance is required.

A `System` runner does not erase inherited provenance.

An admin bypass does not convert rehearsal-derived work into clean work.

### Synchronous propagation

The immutable prepared invocation carries provenance through:

- query-to-query nested execution where supported;
- action execution;
- `ctx.runMutation`;
- nested mutation;
- generated provisioning hooks;
- auth lifecycle hooks;
- notification delivery adapters;
- webhook adapters;
- provider adapters;
- asset/external-service adapters;
- error/retry wrappers; and
- local simulator adapters.

A nested target enforces its own ordinary auth requirements while inheriting the
outer provenance. It cannot replace provenance through body input.

If multiple parents converge, provenance is the canonical union. A clean parent
cannot cancel a rehearsal parent.

Every registered `InvocationSource` and every nested/runtime entry has an
exhaustive provenance policy. A new source without one fails the registry drift
test.

## Durable deferred-intent provenance

A durable deferred intent gains a protected nullable field logically equivalent
to:

```json
{
  "rehearsalProvenance": {
    "kind": "authRehearsalProvenance.v1",
    "governingAuthorities": [],
    "authorityDecisionDigest": "sha256:...",
    "assuranceDecisionDigest": "sha256:..."
  }
}
```

Absence means the enqueueing invocation was clean.

Application payload cannot supply the field.

When a rehearsal-provenance invocation creates a deferred intent, enqueue and
provenance persistence occur in the same transaction.

This applies to:

- LLP 0045 notification outbox rows;
- queued actions;
- queued mutation/replay work;
- scheduled work created by an invocation;
- retry rows;
- adapter-owned deferred requests; and
- any future durable-intent registry member.

Claiming copies the protected provenance into the claim lease.

Retry preserves it unchanged.

Process restart reconstructs it from durable state.

Queue replay reconstructs prepared deferred authority containing it.

Cron rehydration preserves it even though the cron runner's base authority is
`System`.

Delivery result recording retains it for audit and subsequent retry.

Dead-lettering does not clear it.

Deduplication may merge only equal provenance values or take their canonical
union. It must never choose the clean input over a marked input.

A malformed durable provenance value fails the work item closed before adapter
execution.

LLP 0045's plaintext-code prohibition remains unchanged. Provenance metadata
does not authorize durable challenge plaintext.

## The single external-egress gate

All real external egress passes one conceptual and implementation-owned gate:

```text
ExternalEgressGate::prepare(
  prepared authority/provenance,
  registered channel,
  registered adapter,
  destination class
)
```

The gate runs before:

- provider-secret acquisition;
- DNS resolution;
- socket creation;
- HTTP request construction;
- SMTP connection;
- webhook dispatch;
- external queue publication; or
- provider SDK invocation.

If rehearsal provenance is absent, ordinary channel policy applies.

If rehearsal provenance is present, the gate admits only an adapter whose
activated manifest classification is exactly:

```text
declaredSimulator
declaredTestAdapter
```

A simulator/test adapter must be non-production, hermetic for its declared
channel, and structurally unable to reach the real provider.

A runtime option, function argument, destination hostname suffix, environment
variable, or adapter self-assertion cannot confer the exemption.

A declared simulator may capture or deterministically simulate:

- delivered;
- delayed;
- bounced;
- provider unavailable;
- expired before open; and
- duplicate callback.

It remains subject to rehearsal budgets, store marking, redaction, and audit.

A real adapter under rehearsal provenance refuses
`SNAPBACK_AUTH_REHEARSAL_EGRESS_REFUSED`.

The refusal is durable on deferred work. Retry does not become clean.

The gate's scope is exact:

> external egress initiated by a rehearsal-provenance invocation, or external
> egress performed from a durable intent enqueued by one.

This Spec does not claim arbitrary downstream causality. If a rehearsal
invocation writes an ordinary application row and a later causally unrelated
clean cron scans that row and independently decides to send something, the
absence of a typed deferred-intent edge is outside this gate's provenance
claim. The whole-store promotion marker still prevents that rehearsal store
from being promoted through Snapback's supported paths.

Direct runtime `fetch`, webhook helpers, notification providers, and other
external transports must register as gate channels. An unregistered egress
channel refuses rather than bypassing the gate.

## Production refusals and capability reporting

### Prefix-class refusal

Production recognizes `sbrc_` only as a forbidden credential class.

On every production ingress, structural prefix classification happens before:

- CRC validation;
- base64 decoding;
- carrier hashing;
- grant lookup;
- selector lookup;
- effect parsing beyond the bounded outer envelope; or
- any rehearsal state read.

A presented `sbrc_` therefore receives the production rehearsal-class refusal
without revealing whether its bytes are well formed or correspond to a grant.

Production never mints, validates, honors, refreshes, revokes through the
carrier, or diagnostically explains a rehearsal capability.

Public surfaces fold the refusal into their existing non-enumerating auth
shape. Exact rehearsal diagnostics are available only on the gated operator
plane.

### Startup refusal

Production startup rejects, rather than ignores:

- rehearsal enablement;
- auto-mint configuration;
- rehearsal grant templates;
- window templates;
- rehearsal sidecar declarations;
- simulator-as-rehearsal configuration;
- live rehearsal grants;
- live rehearsal windows;
- malformed rehearsal state;
- disposable stores;
- rehearsal-admitted stores; and
- pending rehearsal-provenance deferred intents.

The refusal occurs before app-data bind.

Unknown rehearsal configuration fields also refuse; they are not warnings.

### Capability manifest

The exact runtime capability value is:

```text
absent
available
active
```

Its meaning is:

| Value | Meaning |
| --- | --- |
| `absent` | target/profile cannot mint or honor rehearsal authority |
| `available` | non-production target supports the protocol, sessions mode is eligible, and no live grant/window exists |
| `active` | at least one live grant or window exists |

`prod` always reports `absent`.

A target lacking the implementation reports `absent`.

`active` is runtime state, not a static build claim.

The public capability projection may report only this closed value and protocol
version. It does not report grant ids, counts, selectors, expiry, budgets, or
carrier state.

The gated operator status projection may report redacted grant ids, expiry,
effect names, and remaining counters, but not carrier bytes or selector
plaintext.

### Release qualification

A release candidate claiming no rehearsal authority must prove:

```json
{
  "rehearsalActive": false,
  "liveRehearsalGrants": 0,
  "liveRehearsalWindows": 0,
  "storeRehearsalAdmitted": false,
  "storeDisposableAtCreation": false
}
```

The proof is bound to the candidate store and activation digest.

Row-level absence is insufficient.

A candidate with no live grants but a prior admission marker refuses.

A candidate with a disposable marker refuses before any rehearsal effect.

A candidate derived from a missing or unverifiable logical-export envelope
refuses.

## Routes, operations, and DTOs

All request/response types use the LLP 0037 serde/schemars authority inherited
through LLP 0057.

Request DTOs:

- use camelCase;
- apply `deny_unknown_fields`;
- reject duplicate JSON keys;
- reject unknown enum variants;
- have committed generated schemas; and
- apply body limits before parsing.

Credential-bearing and selector-bearing responses:

- are `CredentialSecret`;
- set `Cache-Control: no-store`;
- disable request/response body logging;
- never enter receipts or runtime snapshots; and
- redact `Debug`, errors, traces, and panic context.

The minimum LLP 0031 registry rows are:

| Route / operation | Path policy | Credential resolution | Invocation authority | Effect policy | Response sensitivity |
| --- | --- | --- | --- | --- | --- |
| host-op `auth.rehearsal.mint` | `AdminWrite` | `AdminCredential` | `Operator` | `ImpersonationCapability` | `CredentialSecret` |
| host-op `auth.rehearsal.exercise` | operator system route | `RehearsalCapability` | `Operator` | exact grant effect | `CredentialSecret` |
| host-op `auth.rehearsal.revoke` | `AdminWrite` | `AdminCredential` | `Operator` | `ImpersonationCapability` | `OperatorMetadata` |
| host-op `auth.rehearsal.status` | `AdminRead` | `AdminCredential` | `Operator` | none | `OperatorMetadata` |
| CLI logical export/import | local operator | operation-specific local custody | `Operator` | export/import policy | owner-only artifact |
| ordinary provider/signup routes under a window | existing route policy | existing provider/session resolver | existing resolved caller | server-side window match only | existing response class |

`auth.rehearsal.exercise` is one registered operation family with an exhaustive
closed effect union. Its maximum response sensitivity is
`CredentialSecret`, even for a variant whose actual response contains only
metadata.

A generic map or arbitrary JSON payload is forbidden. Each effect has a closed
variant DTO.

No new public "rehearsal" route exists.

Window-mediated clients call the ordinary provider and app routes.

The operator carrier header is not in permissive CORS policy.

## Diagnostics

Exact rehearsal diagnostics live on the gated operator plane.

Public auth routes retain their existing non-enumerating shapes. A public
caller cannot determine from the diagnostic whether a rehearsal grant, window,
identity, namespace, challenge, or budget exists.

| Code | HTTP / locus | Trigger | Non-enumerating posture |
| --- | --- | --- | --- |
| `SNAPBACK_AUTH_REHEARSAL_REQUEST_INVALID` | 400 operator | malformed closed DTO, duplicate/unknown field, invalid count or selector shape | details name only field class/schema version |
| `SNAPBACK_AUTH_REHEARSAL_CARRIER_REQUIRED` | 403 operator | missing, malformed, unknown, or wrong-class rehearsal carrier | public surfaces fold into ordinary auth refusal |
| `SNAPBACK_AUTH_REHEARSAL_PROFILE_FORBIDDEN` | 403 or startup | mint/use in `prod`, forbidden target/profile, or production `sbrc_` prefix | does not validate carrier or reveal grant existence |
| `SNAPBACK_AUTH_REHEARSAL_CONFIG_FORBIDDEN` | startup | production rehearsal config or sidecar declaration | operator-only path/key class; no secret bytes |
| `SNAPBACK_AUTH_REHEARSAL_SCOPE_DENIED` | 403 operator | requested effect absent from exact grant scope | public/window path uses ordinary non-enumerating result |
| `SNAPBACK_AUTH_REHEARSAL_SELECTOR_DENIED` | 403 operator | mandatory selector absent, incompatible, or unmatched | never echoes contact, identity, or namespace |
| `SNAPBACK_AUTH_REHEARSAL_BINDING_MISMATCH` | 403 operator | instance, boot, app, activation, mode generation, or profile mismatch | names only binding axis, not expected/observed secret |
| `SNAPBACK_AUTH_REHEARSAL_EXPIRED` | 403 operator | grant expired before effect admission | public session path retains ordinary expiry shape |
| `SNAPBACK_AUTH_REHEARSAL_AUTHORITY_ENDED` | 403 operator | grant/window revoked, terminal, or parent ended | public invocation keeps ordinary terminal-auth shape |
| `SNAPBACK_AUTH_REHEARSAL_BUDGET_EXHAUSTED` | 429 operator | effect counter, window counter, allocation ceiling, or `maxUses` exhausted | may name counter and retry impossibility; no selector |
| `SNAPBACK_AUTH_REHEARSAL_IDEMPOTENCY_CONFLICT` | 409 operator | same key used with a different normalized request | never reports either request body |
| `SNAPBACK_AUTH_REHEARSAL_NAMESPACE_UNAVAILABLE` | 503 mint | three namespace candidates collided or RNG unavailable | no candidate bytes |
| `SNAPBACK_AUTH_REHEARSAL_NAMESPACE_CONSUMED` | 409 operator | reservation already installed or terminal | no namespace plaintext |
| `SNAPBACK_AUTH_REHEARSAL_REACHABILITY_PUBLIC` | 403 install | valid target fact says `publishedPublic` | names target class only |
| `SNAPBACK_AUTH_REHEARSAL_REACHABILITY_INVALID` | 503/startup | malformed, wrong-build, missing-required, or unverifiable fact | no topology secrets |
| `SNAPBACK_AUTH_REHEARSAL_PRODUCER_PARITY` | build/qualification | target class lacks required fact-producer classification | registry identity only |
| `SNAPBACK_AUTH_REHEARSAL_DISPOSABLE_REQUIRED` | 409 operator | auth-clock advance requested on an ordinary store | store id omitted from public output |
| `SNAPBACK_AUTH_REHEARSAL_STATE_PRESENT` | 409/startup/import | tainted or disposable state reaches production promotion | reports marker class, not grant/identity details |
| `SNAPBACK_AUTH_REHEARSAL_ENVELOPE_INVALID` | 409 import/CLI | missing, malformed, MAC-invalid, payload/store mismatch, or splice | one generic verification refusal |
| `SNAPBACK_AUTH_REHEARSAL_EXPORT_KEY_UNAVAILABLE` | 503 import/CLI | trusted verification key absent or ambiguous | may name source key id only on local operator plane |
| `SNAPBACK_AUTH_REHEARSAL_PROVENANCE_INVALID` | 503 worker | malformed or contradictory deferred provenance | refuses before adapter/provider access |
| `SNAPBACK_AUTH_REHEARSAL_EGRESS_REFUSED` | 403/function/worker | real external egress attempted under rehearsal provenance | public recipient/provider existence remains hidden |

The status mapper enumerates every request-path code. Unknown internal codes
remain 500.

Diagnostic details never include:

- `sbrc_`;
- selector namespace;
- contact address;
- challenge id or code;
- session bearer;
- identity subject;
- provider token;
- key material;
- payload bytes;
- request digest input; or
- raw deferred intent.

## What rehearsal authority must never do

Rehearsal authority MUST NEVER:

- bypass application authorization;
- bypass membership rules;
- bypass row scoping;
- satisfy an LLP 0055 application grant;
- invoke an application function merely by holding `sbrc_`;
- turn a client-supplied user id into a principal;
- accept a wrong password;
- accept a forged cryptographic proof;
- turn a wrong verification code into a successful ordinary proof;
- modify provider configuration;
- modify application auth policy;
- disable global resource bounds;
- create an unlimited budget;
- replenish an exhausted budget;
- raise its own allocation ceiling;
- mint another rehearsal grant;
- expose provider API tokens;
- expose auth keyring material;
- place rehearsal authority in browser/native code;
- auto-link accounts;
- merge accounts;
- bypass explicit lifecycle ceremonies not named by an effect;
- convert simulated assurance into production verification;
- rewrite `provenance: rehearsal`;
- make a rehearsal-derived session outlive its governing authority;
- clear store admission or disposable markers;
- export tainted state with a clean-verifying envelope;
- promote a tainted or disposable store to production;
- perform real external egress without the single gate;
- label a real adapter as a simulator at runtime;
- treat loopback as proof of private reachability; or
- reach a target whose capability manifest does not admit rehearsal.

Rehearsal bypasses ceremony and external delivery only where a named,
selector-bound, budgeted effect says so. It never bypasses cryptographic,
authorization, custody, production, or promotion boundaries.

## Authoritative acceptance matrix

The tables in this section are the authoritative superset commissioned by LLP
0212 landing items 1 and 1a. An implementation claim requires every applicable
row, not a hand-selected subset.

Instrumentation must prove handler/effect entry, durable writes, counter
values, marker state, adapter entry, network attempts, logs, and response
classification.

### Mint, plane, and production

| ID | Scenario | Required result |
| --- | --- | --- |
| M-01 | mint in `test`, settled sessions, valid `AdminWrite` and `ImpersonationCapability`, complete finite request | succeeds; returns one redacted grant receipt plus credential-sensitive carrier/selectors |
| M-02 | mint in `prod` | refuses `PROFILE_FORBIDDEN`; no grant, carrier, namespace, counter, or audit-success row |
| M-03 | mint in `dev` auth mode rather than sessions | refuses before RNG or durable mint |
| M-04 | sessions mode pending, unavailable, or quarantined | refuses before RNG or durable mint |
| M-05 | missing `AdminWrite` | refuses without saying whether `ImpersonationCapability` was valid |
| M-06 | missing/invalid `ImpersonationCapability` | refuses without saying which operator credential failed |
| M-07 | session, admin-read, secret-read lease, LLP 0055 token, or prior `sbrc_` substituted for a mint gate | refuses |
| M-08 | unknown effect, wildcard, prefix scope, or duplicate scope | closed-DTO refusal |
| M-09 | scope missing its selector | mint refuses |
| M-10 | selector supplied for absent scope | mint refuses |
| M-11 | scope has zero effect limit | mint refuses |
| M-12 | zero/negative/unsafe `maxUses` or allocation ceiling | mint refuses |
| M-13 | caller supplies window namespace bytes | unknown-field refusal |
| M-14 | partial RNG/collision failure during mint | no partial grant, carrier, or reservation survives |
| M-15 | exact idempotent mint retry after success | returns same durable grant outcome; no second grant or namespaces |
| M-16 | mint idempotency key reused with changed request | conflict; no second grant |
| M-17 | `snapback test` launched and owns exact ready artifacts | auto-mint may succeed |
| M-18 | `snapback test` attaches to a pre-existing or caller-URL server | auto-mint refuses |
| M-19 | rehearsal carrier presented to an LLP 0055 resolver | class mismatch; no function authority |
| M-20 | LLP 0055 carrier presented to rehearsal exercise | class mismatch; no rehearsal lookup |
| M-21 | `sbrc_` presented to production | prefix-class refusal before CRC, decoding, hash, or lookup |
| M-22 | malformed and valid-looking `sbrc_` presented to production | identical rehearsal-class refusal shape |
| M-23 | production startup contains rehearsal config | startup refuses before app-data bind |
| M-24 | production startup sees zero live grants but an admission marker | startup refuses `STATE_PRESENT` |
| M-25 | production startup sees disposable marker before any effect | startup refuses `STATE_PRESENT` |
| M-26 | production capability manifest | reports `absent` |
| M-27 | eligible non-production with no live authority | reports `available` |
| M-28 | at least one live grant/window | reports `active` without ids, counts, selectors, or expiry |
| M-29 | release qualification with active grant/window | fails |
| M-30 | release qualification with historical taint but zero live authority | fails |
| M-31 | release qualification on never-admitted, non-disposable store | may pass when other release gates pass |

### Binding, scope, budgets, and idempotency

| ID | Scenario | Required result |
| --- | --- | --- |
| B-01 | exercise under exact instance/boot/app/activation/profile/mode | eligible for effect checks |
| B-02 | carrier reused across instance | binding mismatch; no effect |
| B-03 | server restart with same database and app | old grant refuses by boot nonce |
| B-04 | reset without process restart | old grant/window refuses by rotated instance/incarnation |
| B-05 | activation digest changes without restart | old grant/window refuses |
| B-06 | sessions mode generation changes and later returns to sessions | old grant remains terminal |
| B-07 | effect not in scope | charged denial; no semantic effect |
| B-08 | selector absent at use due to corrupt state | fail closed; no semantic effect |
| B-09 | selector incompatible with request | charged denial |
| B-10 | challenge wrong-code redemption | charges `challengeAttempts` and `maxUses`, preserving LLP 0057 behavior |
| B-11 | unknown/expired/consumed challenge under resolved grant | same attempt charge and non-enumerating public result |
| B-12 | successful capture | charges `challengeAttempts` and `maxUses` before code release |
| B-13 | failed identity precondition | charges `maxUses`, not `identityCreates` |
| B-14 | successful identity creation | effect, `identityCreates`, `maxUses`, idempotency, audit, and marker share one commit |
| B-15 | successful session mint | `sessionMints` and `maxUses` charge atomically with session |
| B-16 | successful simulated assurance | `verificationSimulations` and `maxUses` charge atomically |
| B-17 | `maxUses` exhausted with effect quota remaining | all new effects refuse |
| B-18 | effect quota exhausted with `maxUses` remaining | that effect refuses; other scoped effects retain their own finite headroom |
| B-19 | exact successful idempotent retry | same outcome, no double effect or charge |
| B-20 | exact denied idempotent retry | same denial, no double charge |
| B-21 | one idempotency key reused across different code guesses | each divergent request is a charged conflict; no free guesses |
| B-22 | concurrent identical request | exactly one semantic effect and charge; peers observe recorded outcome |
| B-23 | ambiguous commit, exact successor durable | returns/reconciles only that successor |
| B-24 | ambiguous commit, exact predecessor durable | reports failure without executing a fresh successor |
| B-25 | allocation exactly reaches ceiling | succeeds |
| B-26 | allocation exceeds ceiling by one | refuses without partial allocation |
| B-27 | allocated budget expires unused | consumed allocation does not return |
| B-28 | attempt to allocate `allocationCeiling`, `maxUses`, or rehearsal counters | refuses |
| B-29 | attempt to allocate another grant or allocator | refuses |
| B-30 | revoke/remint after exhaustion | old grant remains exhausted/terminal; new grant is independently minted under full mint gates |

### Selectors and windows

| ID | Scenario | Required result |
| --- | --- | --- |
| W-01 | grant with `windowInstalls: N` and exactly N plans | cardinality valid |
| W-02 | grant with N plans and a different install counter | mint refuses |
| W-03 | forced first namespace collision, second candidate unique | mint succeeds with second candidate only |
| W-04 | three forced collisions | whole mint refuses `NAMESPACE_UNAVAILABLE` |
| W-05 | collision between two plans in one mint | colliding candidate retried; final plans distinct |
| W-06 | caller attempts post-mint namespace mutation | closed request/selector refusal |
| W-07 | caller attempts post-mint effect/budget/expiry widening | refusal |
| W-08 | first install of reserved plan | succeeds and consumes reservation |
| W-09 | exact idempotent retry of install | returns same window; no second charge |
| W-10 | second different install request for same reservation | charged `NAMESPACE_CONSUMED` refusal |
| W-11 | two concurrent install requests | exactly one installation wins |
| W-12 | revoke/expire reservation before install | reservation becomes terminal and never installs |
| W-13 | terminate installed window | namespace becomes terminal and is never reused |
| W-14 | reset then mint another grant | old namespace commitment remains in non-reuse ledger |
| W-15 | ordinary client flow under window | request has no `sbrc_`, special header, cookie, or body authority |
| W-16 | client bundle/transcript scan | no carrier, namespace constant, rehearsal flag, or hidden override |
| W-17 | nonmatching contact while window live | ordinary provider path and ordinary public transcript |
| W-18 | foreign caller guesses random namespaces | cannot match except with 192-bit guessing probability; ordinary throttles charge failures |
| W-19 | foreign caller submits a predictable domain such as `example.invalid` | no window match |
| W-20 | foreign caller learns grant id but not namespace | gains no window behavior |
| W-21 | guessed namespace matches | only exact finite window effects apply; application authorization remains enforced |
| W-22 | valid `publishedPublic` reachability fact | installation refuses |
| W-23 | valid `notPublicByDesign` fact | installation may proceed; no privacy claim is inferred |
| W-24 | wave-1 local target has no reachability fact | installation proceeds with residual recorded |
| W-25 | loopback server sits behind public reverse proxy | takes local absence branch and proceeds; guessing rows W-18–W-21 remain the boundary |
| W-26 | malformed/wrong-build reachability fact | installation refuses |
| W-27 | public-by-design target class lacks producer | producer-parity build/qualification failure |
| W-28 | new target class lacks registry classification | drift gate fails |
| W-29 | non-local producer-required target omits runtime fact | install refuses |
| W-30 | public caller probes same nonmatching address with and without a live unrelated window | same status/code/body schema and no rehearsal-existence disclosure |
| W-31 | compare ordinary UI request with window-mediated UI request | same route and DTO; only the user-selected contact namespace differs |
| W-32 | window budget exhausts while parent grant remains live | further matching effects refuse; no fallthrough to unlimited behavior |
| W-33 | parent grant ends while window remains before its own expiry | window terminates immediately |

Transcript equivalence in W-30/W-31 covers route, method, headers, request schema,
response schema, status class, and public diagnostic class. It does not claim
constant-time equivalence across provider work.

### Store marking, crash cuts, backup, and promotion

| ID | Scenario | Required result |
| --- | --- | --- |
| S-01 | denial before first honored effect | store remains unadmitted; denial accounting persists |
| S-02 | crash before transaction commit | no effect and no admission marker |
| S-03 | crash after durable effect/marker commit but before response | effect and marker both present |
| S-04 | capture crash after marker commit but before secret release | marker may be present; no secret was released |
| S-05 | injected attempt to commit effect without marker | transaction/invariant refuses |
| S-06 | first effect and marker race concurrently | one first-admission transition; all honored effects observe marked state |
| S-07 | reset after admission | marker survives |
| S-08 | app/auth rows deleted after admission | marker survives |
| S-09 | physical backup of admitted store | backup retains marker |
| S-10 | declared restore of admitted backup into non-prod | restored store remains marked |
| S-11 | declared restore of admitted backup into prod | refuses before serving |
| S-12 | supported clone of admitted store | clone remains ineligible |
| S-13 | app-data-only export of admitted store | tainted envelope required; omission impossible |
| S-14 | logical export missing envelope | import refuses before write |
| S-15 | malformed envelope | import refuses before write |
| S-16 | one-bit envelope edit | MAC verification fails |
| S-17 | one-bit payload edit | payload hash comparison fails |
| S-18 | clean envelope spliced onto tainted payload | payload hash/store witness fails |
| S-19 | clean envelope with substituted clean payload from another snapshot | payload hash fails |
| S-20 | clean envelope/payload substituted from another store | store identity comparison fails |
| S-21 | envelope-provided verification key | rejected; key must be independently trusted |
| S-22 | missing cross-host verification key | import refuses |
| S-23 | wrong or ambiguous cross-host key | import refuses |
| S-24 | replay a tainted envelope and matching payload into prod | refuses `STATE_PRESENT` every time |
| S-25 | replay an envelope against a different payload/store | verification refuses |
| S-26 | clean export A, taint source B, then import old A into prod | **positive:** admitted because A proves a pre-taint snapshot |
| S-27 | clean export A, taint source B, export B, import B into prod | refuses |
| S-28 | import tainted artifact into non-prod | may succeed only while preserving marker atomically |
| S-29 | create disposable store and promote before any effect | refuses |
| S-30 | create disposable store, advance auth clock, reset, then promote | refuses; both marker classes survive |
| S-31 | ordinary store requests auth-clock advance | refuses without advancing |
| S-32 | disposable store requests valid auth-clock advance | succeeds atomically and becomes admitted if this is first effect |
| S-33 | raw copy lacks Snapback backup/export proof | no supported promotion claim; paved import refuses |
| S-34 | release check scans rows but ignores store marker | acceptance fails; row-level proof is insufficient |
| S-35 | source keyring rotates after export and destination has exact derived capsule | old artifact remains verifiable |
| S-36 | destination has source auth key id but not independently transferred derived key | refuses |

### Derived-authority termination

| ID | Scenario | Required result |
| --- | --- | --- |
| T-01 | grant-derived session expiry exceeds grant expiry | session expiry is clamped to grant |
| T-02 | window-derived session expiry exceeds window expiry | session expiry is clamped to window |
| T-03 | grant expires during live session | next gate and final publication fence refuse |
| T-04 | grant revoked during in-flight action | terminal premark blocks new work; stale final publication refuses |
| T-05 | window expires while parent grant remains live | window-derived sessions and assurances refuse |
| T-06 | window revoked while parent grant remains live | same immediate refusal |
| T-07 | parent grant revoked while child window live | window and all descendants terminate |
| T-08 | simulated assurance cached before governor ends | use-time validation refuses after termination |
| T-09 | real and rehearsal assurance both exist | evaluator prefers admissible real assurance; decision records actual provenance |
| T-10 | session was minted through rehearsal but later gains real assurance | effective authority remains rehearsal-provenance |
| T-11 | restart with durable derived session row | old governing boot binding refuses |
| T-12 | activation change with derived assurance | use-time binding check refuses |
| T-13 | derived identity remains after GC delay | identity is inert and cannot mint ordinary authority |
| T-14 | new grant exactly selects retained derived identity | only newly authorized effect may act; old governor remains terminal |
| T-15 | dropped revocation notification | no effect; level-triggered state still refuses |
| T-16 | stale wakeup after terminal state | cannot reopen grant, window, session, or assurance |

### Carrier custody and leak channels

| ID | Scenario | Required result |
| --- | --- | --- |
| C-01 | ready sidecar is exact regular owner file mode `0600` | eligible after nonce/path checks |
| C-02 | sidecar mode `0644`, wrong owner, symlink, or extra hard link | refuses; no in-place repair |
| C-03 | arbitrary sidecar path supplied | refuses |
| C-04 | stale ready descriptor/boot nonce | refuses before carrier use |
| C-05 | descriptor publication fails after sidecar staging | unpublished sidecar is removed |
| C-06 | carrier supplied as argv value | CLI parser has no such value form/refuses |
| C-07 | carrier supplied through environment | ignored/refused; never resolved |
| C-08 | carrier supplied through bounded explicit stdin | eligible only for registered local rehearsal operation |
| C-09 | stdin exceeds 512 bytes or spelling is noncanonical | refuses and zeroizes buffered input |
| C-10 | stdin carrier used with a remote/unverified URL | refuses |
| C-11 | `sbrc_` placed in browser header/body/query/cookie | public route does not resolve it; no CORS admission |
| C-12 | logs, traces, errors, receipts, panic, `Debug`, health, inspect scanned with planted carrier | no carrier bytes or hashes appear |
| C-13 | mint/window namespace response cached | acceptance fails; all such responses must be no-store |
| C-14 | process listing and shell history inspected | no carrier because argv carriage does not exist |
| C-15 | app bundle and generated source scanned | no carrier or selector namespace |
| C-16 | `credential_prefixes_are_mutually_prefix_free` runs with `sbrc_` | passes whole registered namespace |
| C-17 | every credential resolver receives every other class sample | only rehearsal resolver accepts `sbrc_`; all substitutions refuse |
| C-18 | remote/CI raw bearer attempt | refuses until LLP 0150 key-bound profile lands |

### Provenance and egress

| ID | Scenario | Required result |
| --- | --- | --- |
| E-01 | rehearsal-derived action directly calls real HTTP/provider adapter | gate refuses before secret read, DNS, or socket |
| E-02 | rehearsal-derived action calls nested mutation that initiates egress | nested work inherits provenance; gate refuses |
| E-03 | clean outer call invokes nested work whose assurance decision uses rehearsal evidence | derived provenance marks nested work; egress refuses |
| E-04 | rehearsal invocation reaches provisioning hook | hook inherits provenance; real egress refuses |
| E-05 | rehearsal invocation reaches auth lifecycle hook | hook inherits provenance; real egress refuses |
| E-06 | rehearsal invocation reaches delivery adapter directly | real adapter refuses |
| E-07 | rehearsal invocation enqueues LLP 0045 outbox row | provenance persists in same transaction |
| E-08 | clean `System` cron claims that outbox row | row provenance rehydrates; real delivery refuses |
| E-09 | worker restarts between claim and delivery | provenance survives restart and still refuses |
| E-10 | provider retry is scheduled after refusal/failure | retry retains provenance and still refuses |
| E-11 | queued action/replay created under rehearsal | durable marker survives queue settlement/replay |
| E-12 | queued mutation invokes nested action after replay | provenance remains through both boundaries |
| E-13 | deduplication merges clean and rehearsal intents | result carries rehearsal provenance or refuses merge; never clean |
| E-14 | malformed deferred provenance row | worker refuses before adapter entry |
| E-15 | application payload attempts to set provenance null/clean | field is protected/unknown and cannot clear server value |
| E-16 | adapter claims simulator through request argument or environment | no exemption; real egress refuses |
| E-17 | manifest-declared simulator captures delivery | succeeds within budgets; no real network/provider-secret access |
| E-18 | manifest-declared deterministic bounce/delay/duplicate simulator | usable and records structured simulated outcome |
| E-19 | declared test adapter attempts a real socket | hermeticity acceptance fails and adapter is not admissible |
| E-20 | unregistered runtime egress channel | refuses rather than bypassing gate |
| E-21 | rehearsal invocation writes ordinary row; later independent clean cron reacts without a typed deferred-intent edge | outside causal-propagation claim; store remains promotion-tainted |
| E-22 | public diagnostic from egress refusal | does not reveal recipient, provider account, grant, window, or namespace |

### Public transcript and non-enumeration

| ID | Scenario | Required result |
| --- | --- | --- |
| N-01 | unknown versus wrong versus expired challenge under a window | existing public non-enumerating provider shape |
| N-02 | live window versus no window for a nonmatching contact | same public schema/status/diagnostic class |
| N-03 | malformed versus well-formed `sbrc_` on production public ingress | same profile-forbidden class before validation |
| N-04 | selector mismatch on operator plane | exact code available, but selector plaintext omitted |
| N-05 | selector mismatch through ordinary signup route | ordinary public auth failure; no rehearsal code |
| N-06 | budget exhaustion under public window | ordinary bounded failure shape; operator explain may name counter |
| N-07 | carrier, namespace, address, code, token, and key sentinels planted through all DTOs | absent from public/operator logs and default machine output |
| N-08 | public capability projection while active | reports only `active` and protocol version |
| N-09 | gated status request | may report redacted ids/effects/counters, never carrier or selector plaintext |
| N-10 | undeclared/wrong-class credential | no fallthrough to anonymous or another resolver |

## Implementation hand-off

The implementation must use protected storage outside app-addressable schemas.

Non-obvious enforcement sites carry `@ref` annotations to this Spec, including:

- grant schema validation;
- carrier prefix classification;
- total effect matches;
- selector validation;
- budget linearization;
- first-use marker transaction;
- window namespace generation and consumption;
- governing-authority checks;
- export-envelope MAC generation/verification;
- deferred provenance persistence; and
- the external-egress gate.

The route registry must exhaustively classify every new operation.

The invocation-source registry must exhaustively classify provenance behavior.

The deferred-intent registry must enumerate every durable work type and prove
same-transaction provenance persistence.

The egress-channel registry must enumerate every external transport and every
simulator exemption.

Generated schemas and fixtures must be committed and drift-gated.

The affected proof must include:

- `./ref-check --verbose`;
- route/credential prefix registry tests;
- generated DTO-schema checks;
- the complete acceptance matrix above;
- planted-secret redaction tests;
- crash-cut storage tests;
- backup/restore/export/import tests;
- concurrency and idempotency tests;
- reachability producer-parity tests; and
- zero-network simulator/egress instrumentation.

## Open questions

Only numeric implementation parameters remain open.

### OQ1 — TTL defaults and hard ceilings

The following numeric values must be selected empirically and pinned with the
implementation acceptance fixtures:

- default and hard maximum grant TTL;
- default and hard maximum window TTL;
- idempotency/tombstone retention after terminal expiry;
- derived-identity sweep delay; and
- cross-host verification-key retention.

The closed structure is unchanged: every TTL is finite, every window and
derived authority is clamped to its governor, expiry cannot renew authority,
and missing retention state fails closed.

### OQ2 — Budget defaults and numeric caps

The following defaults/hard caps remain open:

- default `maxUses`;
- per-effect default limits;
- default and hard maximum `allocationCeiling`;
- maximum plans per grant;
- maximum live grants per instance;
- maximum live windows per grant/instance;
- maximum fixture identities/sessions;
- denial-debt caps; and
- simulator transcript/receipt count and byte caps.

Every selected value must be finite and positive where its effect is enabled.
Changing one requires an explicit compatibility and acceptance update.

The 192-bit window-selector floor, 256-bit carrier floor, HMAC-SHA-256 envelope
primitive, effect enum, selectors, accounting rules, non-recursion,
same-transaction marking, pre-taint policy, production refusals, provenance
propagation, and egress gate are not open questions.

## Status

Draft. This Spec is the commissioned authority for auth rehearsal grants,
windows, carrier custody, store admission provenance, and rehearsal egress
containment. It requires an appropriately scaled review before acceptance.
