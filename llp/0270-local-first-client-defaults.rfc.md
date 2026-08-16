# LLP 0270: Local-first client defaults

**Type:** RFC
**Status:** Draft
**Systems:** React, Expo, Swift, Headless client, Retained facts, Local query
evaluation, Optimistic mutations, Offline outbox, Client storage
**Author:** Codex gpt-5.6-sol xhigh, orchestrated by Claude Fable 5
(commissioned by the author performance-direction ruling 2026-08-15, Charlie
Cheever)
**Date:** 2026-08-16
**Revised:** 2026-08-16 (v0.2 — review round 1 fixes)
**Related:** LLP 0053, LLP 0129, LLP 0155, LLP 0166, LLP 0190, LLP 0198,
LLP 0209, LLP 0218,
`issues/20260815-local-first-defaults-audit.md`

## Revision history

- **v0.2 (2026-08-16)** — Applied review-round-1 evidence corrections: public
  JS retention and optimistic-view signatures, Expo automatic-queue fallback
  behavior, the target replay-capability prerequisite, Swift's shipped
  transport scope, and the complete mechanism-owner cross-references.
- **v0.1 (2026-08-16)** — Initial draft from the local-first defaults audit.

## Summary

Snapback should make retained query facts, generated optimistic presentation,
offline mutation settlement, and admitted local query answers the ordinary
posture of every Full client arm. Applications should not select a retention
variant, an optimistic-create hook, a local-evaluation method, or a replay
controller to receive the behavior the platform can prove safe.

“Default” does not mean “trust every local byte” or “execute every operation
locally.” It means the client requests the capability automatically and the
owner admits it from exact query/mutation identity, authority, completeness,
carrier, and continuity facts. An unproved case fails closed to an honest
online, pending-without-prediction, hydrate, `unknown`, or refused state. App
configuration never creates authority.

This RFC decides the cross-arm product posture and consequence handling. It
does not take mechanism ownership from LLP 0190's D3 read lane, LLP 0209's
query IR and server/local agreement seam, LLP 0155/0129's generated mutation
lane, LLP 0166's local store, or LLP 0218's settlement lifecycle.

## Status and authority

This is a Draft prompted by the 2026-08-16 client-surface audit. It proposes a
default policy; it does not promote any current capability or carrier claim.
Each arm/profile becomes default only after its governing owner lands the
implementation and scoped receipt.

LLP 0190 remains authoritative for:

- retained-fact identity and admission;
- authority/projection risk classes and invalidation;
- local evaluator admission, completeness, freshness, and `unknown`;
- replica continuity and retained-delta applicability; and
- the D3.2–D3.8 rollout and receipts.

LLP 0209 remains authoritative for the query graph IR and its §8 requirement
that server and local evaluators produce byte-identical results and identical
completeness/refusal labels or answer `unknown`. Current live deltas remain
non-replica-applicable until D3 defines base/predecessor identity, continuity,
and gap-to-replace behavior.

LLP 0155/0129 and LLP 0133 retain generated mutation execution, deterministic
claims, rebase, and settlement ownership. LLP 0218 retains the dispatch union,
queued presentation, and drain safety controller. LLP 0166 retains store
profiles and carrier qualification.

## Problem

The audit found an implementation-shaped rather than product-shaped surface:

| Arm | Current useful pieces | Defaultness gap |
| --- | --- | --- |
| React | IndexedDB default, retained results, generated IR/rebase, automatic outbox drain, result transform | Retention is per-query opt-in; automatic prediction is one-`Insert` special hook; local evaluation is explicit and result-transform-only |
| Expo | React facade, ordinary-relaunch file persistence, provider drain wiring | Carrier registration is explicit and `durable:false`; outbox/local-evaluation safety gates therefore refuse; prediction has React's narrow ceiling |
| Swift | In-repository protocol proving surface for `poll/local` and `live/local`; `live/hosted` is future work | No persistent facts, generated optimistic projection, client mutation outbox, or local evaluator |
| Headless | Browser/Node store default, generated IR/rebase, queue machinery, result transform | Retention remains per-query opt-in; optimistic view and drain lifecycle are explicit; local evaluation is explicit and narrow |

The present posture forces an app author to know which internal mechanism to
activate. That misses the commission's InstantDB-class benchmark: the
ordinary UI path should read and mutate a safe local view immediately, while
the server remains authoritative and eventual settlement stays explicit.

Some flips are semantically material:

- a retained or local answer may render before an online response and may be
  stale;
- an optimistic layer changes visible rows before authorization/constraints
  settle;
- a default drain starts background work and may execute an offline-accepted
  mutation later;
- a durable mobile store changes privacy, deletion, backup, quota, and crash
  obligations; and
- a second evaluator can diverge in values, ordering, membership, or
  completeness.

A cross-arm rule is therefore required; changing individual option defaults
would be unsound.

## Decision

### D1. Default is automatic request plus owner admission

For each of the four capabilities, a Full client automatically requests the
strongest profile supported by its qualified carrier and generated artifact.
No app-facing feature opt-in is required. The owner-produced admission facts
decide whether the request is admitted.

The following do **not** count as opt-ins under this policy:

- choosing that a query is public, private, or uses a particular
  authorization rule — these are application semantics, not client retention
  knobs;
- generating a closed query or mutation IR;
- installing an application client/binding; or
- falling back when an owner proof is absent.

The following are feature opt-ins and should disappear from the common path:

- `authorityIndependent: true` when its only purpose is to request retention;
- protected `retainable: true` as the switch that causes storage;
- `useSnapbackOptimisticCreate(...)` instead of the ordinary mutation hook;
- direct `evaluateLocalResultTransform(...)` instead of the ordinary query
  path; and
- a required `startOutboxDrain()` lifecycle call.

Owner facts may continue to be explicit in generated artifacts or server
configuration where they express real policy. They may not be client-authored
claims accepted merely because a flag is true.

Every refused default is observable through stable capability/diagnostic
facts. Silent downgrade is forbidden when it would make the application
believe it has restart retention, optimistic presentation, offline
settlement, or a complete local answer.

### D2. Persist owner-admitted query facts by default

On a qualified persistent carrier, the client automatically retains every
mounted query the owner admits. Active handle demand requires no separate
durable-registration call. A durable registration remains an explicit
lifecycle surface only when demand must survive with no mounted observer.

Admission remains query-, arguments/window-, projection-, authority-, target-,
carrier-, and artifact-specific:

- an ambient-free public declarative plan may be automatically classified
  authority-independent from its owner IR;
- protected facts require exact owner-issued retention class and lease/barrier
  custody;
- opaque handlers, unknown completeness, unqualified carriers, and memory
  fallback remain online-only/refused; and
- stored predecessor bytes are never relabeled. Adoption is prove-or-fresh
  behind authority and artifact barriers.

Retained publication uses existing honest axes: `freshness: 'retained'`,
stale/offline connection, exact completeness or `unknown`, and a separate
settlement state. It never invents a new local authority tier.

### D3. Derive and attach optimistic presentation by default

For every generated mutation classified `local-executable`, the ordinary
mutation surface derives its optimistic operation from the same
content-addressed IR the server executes and attaches it to every compatible
local materialization automatically.

The default path:

1. verifies exact artifact/operation identity and local-read admission;
2. durably allocates intent sequence and deterministic host claims before
   exposing the layer when offline queueing is available;
3. applies only the generated effect ceiling to a private presentation layer;
4. settles/rejects against server authority; and
5. atomically rebases remaining operations over new canonical state.

`server-only` and missing-read cases are ordinary degradations. They expose
pending intent without fabricating rows. An app-authored reducer may remain a
clearly labeled compatibility escape hatch, but it cannot be the generated
common path or be described as same-operation parity.

The special `useSnapbackOptimisticCreate(...)` hook becomes unnecessary for
ordinary use once its semantics are subsumed. Migration may retain it as an
alias while callers move to the ordinary mutation hook.

### D4. Queue and settle offline intent by default

When the client owns a qualified durable writer store and the target proves
the settlement ledger/replay contract, a deterministic mutation queues on a
transport connectivity failure and one platform lifecycle owner drains it
automatically after readiness/connectivity returns.

React's current `offlineQueue: 'auto'`, per-call `queue: 'auto'`, and
`outboxDrain="auto"` behavior is the model. Expo joins only after its carrier
qualifies. Headless construction owns a controller until `close()` by default;
manual scheduling becomes an explicit constructor policy. Swift implements
the same client mutation outbox rather than reusing the unrelated server
live-delivery outbox name.

Queued is pending, never success or error. The returned union and durable
inspection/settlement surface remain authoritative across restart. Default
drain does not relax readiness, writer, authority, artifact, adoption,
quarantine, strand, result-gone, ordering, or retry barriers.

### D5. Answer admitted queries locally by default

The ordinary query surface consults the admitted local materialization before
network settlement. It publishes immediately only when the owner proof covers
the exact query plan, args/window, projection, authority partition, version,
and required completeness.

The current `result-transform.v1` evaluator remains a valid narrow rung: it
can filter/order/limit a proof-verified retained exact result. It is not a
general local-query claim. Broader profiles graduate only through LLP 0190 D3
and LLP 0209 §8:

- one owner IR, evaluated on server and client;
- exact canonical value, membership, ordering, bound, cursor, and
  completeness/refusal agreement;
- no combination of individually valid fragments without a shared-version
  proof;
- missing fields, edges, absence/range facts, search membership, or
  continuity return `unknown`/hydrate; and
- local replica application begins only after D3 lands base-version,
  predecessor, continuity, and gap-to-replace rules.

Local evaluation cannot widen stored projections, authorize hidden rows, or
turn prediction into settlement.

### D6. Arm claims are receipt-scoped

The target posture is:

| Arm | Default posture after qualification |
| --- | --- |
| React | Retain admitted queries in IndexedDB; derive generated optimistic views; queue/drain automatically; answer admitted profiles through the ordinary hook |
| Expo | Install a first-party qualified native carrier automatically, then match React semantics; unsupported platform rows refuse explicitly |
| Swift | Ship a consumable native store/evaluator/outbox and expose all four through ordinary APIs; fixture state machines alone make no claim |
| Headless | Retain admitted queries in browser/Node stores; expose a canonical optimistic materialization; own the drain lifecycle; answer admitted profiles through ordinary query APIs |

No arm borrows another arm's carrier, process, package, authority, or
conformance receipt. “Full client” packaging does not imply the four claims;
each capability fact names its arm, carrier/profile, target, artifact, and
receipt.

## Semantic-consequence handling

### Visible state and API compatibility

Retained, optimistic, queued, and locally evaluated states remain explicit in
the API even when their behavior is default. Defaultness removes setup
ceremony, not state distinctions. Consumers can still render offline/pending
indicators and inspect why a prediction or local answer was refused.

Rollout uses additive state unions and compatibility aliases before removing
special hooks/options. A default flip that changes an existing app's visible
pre-settlement rows requires a release note and an explicit temporary legacy
policy; it must not masquerade as a patch-level wiring correction.

### Authority, privacy, and custody

Owner admission is the only widening authority. Protected persistence needs
LLP 0053 lease, logout, user-switch, revocation, expiry, policy/artifact
rotation, callback-race, crash, and multi-context receipts. Carrier
qualification includes atomic deletion/recovery and store ownership, not just
“a file survived relaunch.”

If a platform cannot prove durable publication, it may provide labeled
ordinary-relaunch persistence for admitted reads, but cannot queue mutation
settlement or claim the local-evaluation profile whose ship gate requires a
durable carrier. The reason remains exposed.

### Evaluator divergence and completeness

Every locally executable query or mutation profile has a pinned corpus run by
both evaluators. Query comparison is byte- and completeness-exact per LLP 0209
§8. Mutation comparison covers deterministic claims, local-read requirements,
effect ceilings, provisional identities, rejection, and rebase under LLP 0155
and LLP 0133.

A mismatch is a content failure for that profile. It disables/refuses local
execution through a profile/identity rotation or kill switch; it does not fall
back silently while continuing to advertise the capability. Online server
authority remains available where safe.

### Background replay and resource lifetime

Automatic settlement owns explicit lifecycle resources. Providers/clients
must stop controllers on teardown, share one controller per durable writer
store, bound timers/backoff, react to platform foreground/connectivity signals,
and expose manual/disabled policy for hosts whose execution model cannot
permit background work. Selecting manual mode changes scheduling only; it does
not bypass custody or readiness barriers.

### Migration and rollback

- Retention/evaluation identity changes rotate addresses; no offline relabel.
- Existing queued intent is preserved only through owner-approved adoption or
  remains quarantined/stranded; migration never silently acknowledges it.
- The rollout can disable a newly default local profile without deleting
  canonical server data. Privacy barriers still delete predecessor local
  state where required.
- Special React hooks, explicit local-evaluator methods, and headless drain
  calls remain supported long enough to migrate, but docs lead with the
  ordinary path after its receipt lands.

## Rollout

The implementation program is split along existing ownership boundaries:

1. `issues/20260816-default-retained-query-facts-js-clients.md` — remove
   retention feature opt-ins for owner-admitted React/headless queries.
2. `issues/20260816-default-generated-optimistic-projection.md` — attach
   generated mutation IR to ordinary React/Expo/headless presentation.
3. `issues/20260816-default-headless-outbox-settlement.md` — give the headless
   client a default drain lifecycle.
4. `issues/20260816-qualify-expo-local-first-carrier.md` — install and qualify
   the carrier Expo needs for durable outbox and evaluator claims.
5. `issues/20260816-complete-d3-default-local-query-evaluation.md` — execute,
   rather than fork, LLP 0190 D3 and the LLP 0209 agreement seam.
6. `issues/20260816-swift-local-first-read-path.md` — build native retention
   and local evaluation.
7. `issues/20260816-swift-local-first-write-path.md` — build native generated
   prediction and offline settlement.

Each ticket lands affected-scope tests and documentation with its mechanism.
Capability promotion follows LLP 0189's scoped qualification-digest posture;
one arm or risk class need not wait for all others, and no partial landing is
described as universal defaultness.

## Alternatives considered

### Keep explicit options but improve the guide

Rejected as the destination. It preserves safety but leaves product behavior
dependent on authors discovering internal mechanisms. The commission is
about defaultness and coverage, not discoverability alone.

### Flip all existing booleans immediately

Rejected. `authorityIndependent`, protected retention, Expo durability,
headless lifecycle ownership, and local evaluator admission encode real
semantic boundaries. Boolean flips cannot manufacture owner proof, carrier
durability, or server/local agreement.

### Claim the current result transform as local query evaluation

Rejected. Filtering/ordering/limiting a retained exact result is useful and
shipped, but it does not execute a general source-row or graph plan, hydrate
missing facts, or maintain a replica. Claims must name the rung.

### Wait for one universal replica before changing any arm

Rejected. LLP 0190 deliberately admits useful exact-result and risk-class
rungs before a whole-control replica. Receipt-scoped incremental defaults are
honest and avoid making React/Node progress wait for Swift or Expo carrier
work.

## Non-goals

- Client-authored authorization or completeness.
- Whole-table or whole-database replication by default.
- Arbitrary JavaScript query/mutator execution on clients.
- Treating optimistic state as server authority or queued state as success.
- Making memory fallback durable.
- Claiming current live deltas as replica-applicable before D3 continuity.
- Redesigning the D3, query-IR, mutation-IR, store, or settlement owner specs
  inside this cross-arm RFC.

## Open questions

1. Which compatibility release removes `authorityIndependent: true` and
   `retainable: true` as retention switches while preserving any independent
   policy meaning those fields still carry?
2. Should a headless client start its drain at construction, after binding
   readiness, or lazily after the first durable enqueue, provided restored work
   still scans without an app call?
3. Which Apple and Android storage primitive can earn LLP 0166's durable
   publication boundary without importing a disproportionate native runtime?
4. Which exact query profile graduates first from
   `result-transform-snapshot-v1` to LLP 0209 graph evaluation under D3?
