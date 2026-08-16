# LLP 0268: Broadcast-shaped realtime with durable shared deltas

**Type:** RFC
**Status:** Draft
**Systems:** Live queries, Realtime, Auth, Performance, Local-first sync
**Author:** Codex gpt-5.6-sol xhigh, orchestrated by Claude Fable 5 (commissioned by the author performance-direction ruling 2026-08-15, Charlie Cheever)
**Date:** 2026-08-16
**Revised:** 2026-08-16 (v0.2 — review round 1 fixes)
**Related:** LLP 0209, LLP 0200, LLP 0008, LLP 0170, LLP 0013, LLP 0090,
LLP 0265,
`issues/20260815-broadcast-shaped-realtime-commission.md`,
`src/local.rs`, `src/live_matcher.rs`, `src/ephemeral.rs`, `src/server.rs`

## 0. Charter and position

The commission is accepted as a durable-realtime architecture decision:
Snapback will separate **broadcast-shaped** live subscriptions from
**query-shaped** subscriptions. For an admitted public or group-scoped feed,
the server authorizes each subscriber when it joins and whenever its authority
changes, then computes each ordinary committed-data disposition once for the
shared fan-out group—not once per subscriber.

The motivation is the current multiplication recorded by the commission and
LLP 0209 §1. `LocalSnapback::notify_live_subscriptions_in_frame` currently
selects affected subscriptions one by one; its delta fast path calls
`try_live_delta_fanout` with each subscription's captured membership, while its
auth-scoped replace path calls `invoke_authorization_resolution` for each
subscription (`src/local.rs`). LLP 0209 §1 measured evaluation cost multiplied
by subscriber count and found that the measured hot relational/auth-scoped
queries produced only replace deliveries. This RFC removes that multiplication
only where one result is mechanically proved safe to share.

This is not permission caching by elapsed time, an authored assertion that a
query is public, or weaker delivery. It is a classification-backed split:

- ordinary base-data changes, which may use one maintained group result and
  compact committed deltas; and
- authority changes or subscriber-specific results, which remain on the
  strict fail-closed path.

**Binding sequencing gate.** LLP 0209 §9 G0 has not exited. Its §3 authority
classification and paired-world conformance corpus are prerequisites, not work
this RFC may anticipate with a parallel classifier. **No implementation of the
broadcast classifier, registry, shared evaluation, or shared delta distributor
may begin before a recorded G0 exit that includes every named §7 input.** An
otherwise recorded LLP 0209 G0 exit that lacks those inputs does not unblock B1;
G0 must first be extended and its exit re-recorded with them. After that exit,
establishment and shared group state sequence alongside LLP 0209 G2; compact
delta production sequences alongside G3. §6 makes those dependencies explicit.

## 1. Decision: adopt the LLP 0209 G0 classification

### 1.1 The rule

The broadcast-shaped classification is **the owner-issued result of LLP 0209
§3/G0**, applied to a class-1 authority-independent base, plus the separate
group-scoped establishment check that G0 must identify. This RFC defines no
second class enum, source annotation, inference algorithm, or trust escape.

A subscription is broadcast-shaped exactly when the G0 artifact proves both:

1. the complete delivered base is class 1 under LLP 0209 §3; and
2. any non-public audience restriction is a separable establishment-time check
   for one owner-computed group scope that is mechanically bound to this result
   instance.

"Complete delivered base" includes membership, projection, order, length,
existence, completeness, refusal, and every delta-relevant fact. The group check
may decide whether a principal may join; it may not alter any delivered result.
A public subscription uses the public establishment requirement under the same
rule, not a separate authority class.

For a non-public scope, G0 must additionally prove both of these bindings:

1. the establishment scope is owner-computed from the same instance's canonical
   args, or an executable equality proof binds every delivered resource to the
   argument from which that scope is computed (LLP 0170 Finding 1); and
2. at the same instance and authority version, the scope's deny-set is exactly
   the fail-closed audience for that instance—every principal a fresh strict
   evaluation would deny is denied establishment, and no broader scope is used.

An argument-addressed role or membership check without the first binding is an
**unbound join check**. It is query-shaped and excluded from this lane even if
its result base is otherwise class 1. Likewise, an establishment predicate whose
deny-set differs from the fail-closed audience cannot qualify.

The group identifier may also be an ordinary canonical query argument. A feed
for `projectId = P` can therefore differ from a feed for `projectId = Q` while
remaining class 1: the instance identities differ by an explicit argument, not
by hidden caller authority. The binding above forbids admitting a member of P
to an instance keyed by Q using P's membership check. It also forbids deriving
the result for P from who the caller is and then calling the result shared.

No class-2 partition-scoped result node or class-3 principal-scoped node is
broadcast-shaped here. A role or membership predicate may be the separate join
check, but a role-dependent projection or filter remains query-shaped. This is
the commissioned class-1-base rule; widening to class-2 result sharing requires
amending LLP 0209 and this RFC, not an implementation shortcut
(`issues/20260815-broadcast-shaped-realtime-commission.md`).

### 1.2 Properties consumed from G0

The broadcast path consumes exactly these properties from LLP 0209 §2, §3,
and §9 G0:

1. **Closed provenance.** Every result-bearing node is in the finite admitted
   IR. Opaque JavaScript, an authored `reads` list, or `authScopeField` cannot
   qualify (LLP 0170 Findings 1–2).
2. **Class-1 invariance.** At fixed plan, args, and window/range, result and
   every fact in the delivered base from which a later delta may be constructed
   are invariant across principals, sessions, grants, and authority partitions.
3. **Complete observable equivalence.** G0's paired worlds cover bytes,
   membership, order, length, existence, completeness, and refusal; hidden
   rows influence none of them (LLP 0209 §3; LLP 0170 Finding 3).
4. **Owner-computed identity.** Plan/instance, canonical args, window/range,
   result-contract identity, and authority class are host-recomputed; clients
   cannot choose sharing keys.
5. **Instance/scope binding.** The exact scope is owner-computed from this
   instance's canonical args, or an executable equality binds every delivered
   resource to the scope argument. An unbound join check is refused as
   query-shaped (LLP 0170 Finding 1).
6. **Exact fail-closed audience.** At the same instance and authority version,
   the establishment scope's deny-set is exactly the fail-closed audience for
   that instance.
7. **Separable group admission.** The exact-scope predicate decides only
   join/deny and produces an authority-versioned admission, never an overlay.
8. **Complete invalidation dependencies.** Every admission input maps to LLP
   0008's declared `permissionBacking` and enumerated session/lease/grant/
   revocation transition vocabulary.
9. **Declared bounds.** G0 supplies result, examined-row, fan-out, byte, and
   maintained-write bounds; the distributor adds no unbounded cache or log.

If G0 does not prove any one of these properties, the answer is query-shaped.
There is no "probably public," operator override, or review-only waiver.

### 1.3 Classification and delta eligibility are separate

Broadcast-shaped answers **who may share one result**. LLP 0209 §7 answers
**whether a commit can be maintained as a delta**. They remain separate:

- a broadcast-shaped graph whose node rules return `Delta` gets the compact
  shared-delta path;
- `NoChange` advances each subscriber's convergence disposition without
  reconstructing a result;
- a broadcast-shaped graph whose data rule requires `Replace` gets one group
  re-evaluation and one shared replacement result, not N reconstructions; and
- a graph that fails the broadcast classification gets the existing
  per-subscription path even if some single-table operation happens to admit a
  DK-3 delta.

This preserves LLP 0209 §7's rule that one ineligible node pins the graph to an
honest replacement while still taking the sharing win proven by class 1.

## 2. Decision: extend the durable delta path with a group distributor

### 2.1 Group identity and establishment

The new internal owner is a **broadcast group**, keyed by:

```text
BroadcastGroupKey =
  G0 instance identity × G0-bound establishment-scope identity
```

This is not a free product: a scope identity may pair only with the instance
named by its G0 instance/scope binding certificate, and only when its deny-set
certificate names that same instance. The key is stable; the current authority
incarnation is separately stamped.
The group owns one current materialization, dependency set, committed-version
frontier, delta state, and bounded subscriber set. Delivery watermarks,
obligations, connection effect fences, and outboxes remain per subscription.

Establishment is one atomic logical operation:

1. recompute plan, instance, and scope identities server-side and require the
   G0 broadcast certificate;
2. verify the G0 instance/scope and exact-audience bindings, then resolve
   public/group admission at an exact authority version;
3. create the bounded outbox before registration is visible;
4. sample/build the result at committed cut V and register without a
   snapshot/register gap; and
5. enqueue the initial `live_replace` at V under the exact admission/effect
   fence.

An authority-transition reservation interlocks steps 2–5. If the authority
version changes before registration and initial publication complete, the join
does not publish under the predecessor: it retries under the successor or
fails closed. A concurrent data commit is either in snapshot V or enqueued
after the registration, never lost between them.

This atomicity deliberately follows the shipped sessions-mode ephemeral
precedent without using its data model. The load-bearing establishment path is
`authorize_bound_ephemeral_room`: it acquires a `RoomAuthorityPermit`, resolves
the durable room permission, and retains the permit across the lookup, caller's
room act, and final transport boundary (`src/server.rs`;
`RoomAuthorityPermit`, `src/ephemeral.rs`).
`subscribe_with_room_authority_and_effect_fence` then checks the already-loaded
`AccessPolicy` with `ensure_authorized`, uses that exact permit, creates the
outbox before visible insertion, and snapshots plus registers inside one room
operation; a racing publish therefore cannot fall between them
(`src/ephemeral.rs`). `ensure_authorized` alone is not the establishment
precedent. The durable broadcast group requires the complete permit-backed join
invariant at a durable committed cut.

### 2.2 Ordinary committed-data distribution

For a non-authority commit mapped to a broadcast group:

1. select affected groups from shared captured dependencies;
2. collapse to the last change per row id;
3. run LLP 0209 §7/DK-3 once against group membership;
4. atomically advance group materialization and dependencies;
5. construct one address-neutral delta core with identity, version,
   projection-only ops, and any shared resume proof; and
6. wrap/enqueue it per subscription through existing outboxes and final gates.

Fan-out still costs O(recipients) enqueues and transport bytes. Authorization,
classification, maintenance, and core serialization become O(affected groups).
The existing subscription-addressed wire permits a small recipient wrapper,
but never a second query, authorization resolution, or delta classification.

The public wire remains additive and familiar: `live_delta`, `live_replace`,
and `current_as_of` retain their existing meanings. This RFC creates an
internal distribution owner, not an app-visible "broadcast" API and not a
best-effort event wire kind.

### 2.3 Relationship to LLP 0209 §7 and DK-3

The delta **producer** is LLP 0209 §7 rung 4, extending LLP 0008 DK-3. This RFC
creates no competing classifier and adopts these invariants:

- exact, conservative eligibility and honest `live_replace` fallback;
- compact `add`/`update` ops carry only the delivered projection defined by the
  result contract and LLP 0209 §7 node rule; `remove` remains id-addressed;
- DK-3 whole-document `add`/`update` ops are admitted only for the exact
  schema-derived `documents(table)` contract, where stored document equals
  delivered projection; every other shape without a certified projection-aware
  op rule uses one shared `live_replace`;
- SQL/evaluator agreement for every admitted predicate operator;
- last-change-per-row-id collapse;
- atomic delta/membership/captured-row-dependency advancement;
- per-node debug/test convergence against a fresh evaluation; and
- fail-closed exclusion until a membership/semi-join evaluator is certified.

Today `try_live_delta_fanout` rebuilds `prior_ids`, calls `compute_live_delta`,
serializes, and advances dependencies per subscription (`src/local.rs`;
`src/live_matcher.rs`). Its `compute_live_delta` ops carry the changed storage
row, which is valid here only under the `documents(table)`
document-equals-projection contract, not as a general graph payload rule. The
distributor moves the eligible state to `BroadcastGroupKey`; G3 still grows
projection-aware eligibility node by node.

An ordinary removal may be compact only if it carries LLP 0200 §2.4's
witnessed-shrink obligation through revision-bound ACK. Today's auth-scoped
DK-3 path falls back to replace when the classified ops include `Remove`
(`try_live_delta_fanout`, `src/local.rs`).
Until compact obligation carriage exists, use shared replacement. Permission
removal is never admitted here; §4 owns it.

### 2.4 Relationship to ephemeral realtime

The ephemeral lane proves the pattern but is not the implementation carrier. Its shipped shape is:

- sessions mode uses `authorize_bound_ephemeral_room` plus `RoomAuthorityPermit` for the durable permission
  lookup and establishment boundary; `subscribe_with_room_authority_and_effect_fence` uses that permit and
  retains auth/effect-fence state;
- `fan_out_locked` clones one `Arc<EphemeralMessage>` across subscriber outboxes without re-running
  `AccessPolicy::allows` per publish;
- `RoomAuthorityRegistry` blocks protected acts/final sends across a permission-changing ticket; and
- `complete_room_reauthorization` rechecks exact subscribers, removes denied ones, refreshes authorized
  contexts, and publishes successor snapshots (`src/ephemeral.rs`).

Those are the establishment, shared-payload, and transition patterns adopted. This RFC does **not** reuse
`RoomState`, `EphemeralMessage`, room-local versions, TTL expiry, or `EphemeralLatest`: LLP 0013
§§Semantics and Relationship to durable sync define those as lossy overlays, not durable query results.

Implementation extends the DK-3/LLP 0209 durable lane with a **new group distributor** while reusing the
neutral durable transport in `src/ephemeral.rs`: bounded outboxes, connection effect fences, final-send
admission, notifier wake-up, and overflow-to-resync. Refactoring those utilities is allowed; routing
durable result state through the ephemeral room store is not.

G1's drain-cycle memo may seed an evaluation but is not the distributor: its pre-G0 key is session-exact
and its entries are caches; a broadcast group is a G0-classified, fenced, maintained distribution owner.

## 3. Decision: LLP 0200 §2.4 applies unchanged

There is no broadcast-specific revocation fence. Every recipient remains an ordinary live subscription,
and LLP 0200 §2.4 applies unchanged:

1. a transition immediately marks affected subscriptions authority-stale, waiting on no evaluation;
2. final delivery checks current authority/effect fences and drops an in-flight predecessor frame;
3. each subscription stays fenced until successor re-resolution succeeds;
4. restoration is latest-authority-wins, with at most one pending restoration per subscription; and
5. persistent failure/overload ends in fail-closed resync or typed teardown, never stale delivery.

**Revocation safety remains the fence plus delivery gate, not reconstruction speed.** A group pause or
generation may reduce waste but cannot replace the per-subscription gate, durable client fence/tombstone,
or ACK custody (LLP 0200 §2.4; LLP 0008 authorization-invalidation amendment).

Restoration reruns establishment for every affected subscriber. A denial drops the subscriber from the
broadcast group's fan-out set, but durable live keeps the `LiveSubscription` as the tombstone/ACK carrier:
`fail_subscription_fanout_with_retry` raises `InvalidationDisposition::Delete`, issues
`ResolutionKind::TerminalDelete`, and enqueues the invalidation frame without removing the subscription
(`src/local.rs`). This differs from ephemeral `complete_room_reauthorization`, which removes a denied
connection from `room.subscribers` (`src/ephemeral.rs`). An admit receives a successor-stamped full snapshot
before later deltas. Class-1 proof permits one group snapshot computation, but permission resolution remains
per subscriber.

A commit containing an affected permission change is never an ordinary base delta: the classifier fences
first and restores from successor truth. Only proven-disjoint subscribers continue. Ambiguity widens the
fence; it never narrows it.

## 4. Decision: the fail-closed lane owns every individualized boundary

### 4.1 Exclusive boundary

The strict fail-closed lane exclusively owns:

- all `permissionBacking` writes and enumerated session/lease/grant/revocation/activation/erasure events;
- all establishment and transition-time public/group admission checks;
- every unbound instance/scope join check or admission scope whose deny-set is
  not exactly the instance's fail-closed audience;
- all class-2 partition and class-3 principal result shapes;
- any filter, projection, order, limit, completeness, or refusal depending on caller authority;
- per-principal overlays such as `viewState` and every partition-of-one;
- opaque or incompletely proven result/authorization/invalidation plans;
- any compact op without a certified delivered-projection payload rule;
- mixed or uncertain events not proved disjoint; and
- resync/restoration after authority uncertainty.

The broadcast lane owns only ordinary data dispositions for an admitted class-1 base. It never decides
continued access: the subscriber map is the output of fail-closed admission, not an authority source.

### 4.2 Information-flow argument

Without this boundary, a subscriber could learn what a fresh query or
reconstruct path denied:

1. a member of P could use P's join check to receive an instance keyed by Q;
2. a revoked member could receive a later delta;
3. a shared delta could expose a hidden row through ops, count/order/existence/completeness/refusal;
4. an `add`/`update` op could expose storage columns absent from the authorized delivered projection; or
5. a replacement connection/grant could inherit predecessor admission.

The design closes each channel:

- the owner-computed instance/scope binding rejects P-for-Q admission, while
  exact deny-set equivalence makes establishment match the fresh fail-closed
  audience for that instance;
- complete permission dependencies turn revocation into an LLP 0200 §2.4 transition whose fence/gate
  rejects predecessor frames;
- G0's class-1 proof and paired worlds make every delivered observable invariant to hidden rows; and
- projection-only ops, with whole-document DK-3 limited to
  document-equals-projection contracts, prevent storage-column over-delivery;
- per-subscription effect fences remain on enqueue/final send, so connection-id reuse is not continuity
  (`ConnectionEffectFence` and guarded outbox drains, `src/ephemeral.rs`).

Paired-world acceptance therefore does more than compare one hidden world with
another. In each world, every compact `add`/`update` row is compared byte for
byte with the corresponding row in that world's fresh reconstruct-path
delivered projection, and delta-applied state must equal that fresh result.
Fixtures include storage-only extra columns so two equally over-broad deltas
cannot pass merely because they match each other.

LLP 0170 Findings 1–3 are load-bearing: `authScopeField` is invalidation metadata, JavaScript `reads`
lack result provenance, and table-wide labels do not safely authorize future operations. No opaque
assertion, table `public` label alone, or free-text waiver can admit this lane.

This RFC accepts **no new content or membership leak**. A caller may learn that its own subscription was
fenced/denied—the strict lane already exposes that control fact—but receives no successor data without
successor admission. Without proof of classification and invalidation closure, the path stays gated.

## 5. Durable delivery, bounds, and observability

Distribution preserves Snapback's durable live semantics, not the ephemeral/external best-effort model:

- frames retain committed versions and per-subscription monotonic delivery;
- latest-value elision remains, but witnessed obligations transfer and cannot be elided (LLP 0200 §2.4);
- overflow, lost continuity, or inexact delta causes replacement/resync, never silent loss;
- reconnect, RQS, retention floors, and gaps remain with LLP 0008/0090/0209; no retained-replica claim; and
- settlement remains decoupled from fan-out under LLP 0200 §§2.1–2.2.

Group state is demand-scoped and retains a bounded current materialization/dependencies, not event history.
Group/subscriber/row/byte/frame/handoff counts are hard-bounded. Exceeding one refuses the path or converts
to existing resync/teardown; it never evicts state while claiming continuity.

The minimum diagnostic ledger records, by plan/instance/group and target:

- classification/refusal; establishment/transition checks, admits, and denies;
- data commits matched/skipped and group `Delta`/`NoChange`/`Replace` counts;
- group computations versus recipient enqueues/bytes and replacement reasons;
- stale drops, shrink obligations, resyncs, overflows, and teardowns; and
- group/subscriber/materialization byte high-water marks.

Diagnostics must not expose identities or hidden rows merely to explain sharing.

## 6. Implementation gates and acceptance

### 6.1 Sequence

- **B0 — blocked on an extended G0 exit.** No runtime path. B0 closes only when a recorded LLP 0209 G0
  exit includes every §7 input and its exit corpus; a G0 exit without them must be extended and does not
  permit B1 to start.
- **B1 — alongside G2.** Consume the classifier; build bounded group identity, atomic join, shared
  dependencies/replacement, diagnostics, and a control. Per-subscription fallback remains.
- **B2 — alongside G3.** Put admitted §7 node rules over group state; add shared delta cores, compact
  shrink-obligation carriage, projection-only payloads, and per-recipient durable gates. Whole-document
  ops remain limited to the `documents(table)` document-equals-projection contract.
- **B3 — qualify, then claim.** Run correctness, information-flow, scale, and failure instruments per
  target. Hosted targets prove one group authority or a shared adapter (LLP 0013 room rule).

G0 is necessary, not sufficient, for B2: without G3 convergence a node remains shared-replace-only.
Neither phase changes LLP 0209's capability-publication gate.

### 6.2 Correctness and security acceptance

Required corpus:

1. class-1 public/group feeds admitted; class-2/3, opaque, overlay, and incomplete shapes refused;
2. direct same-instance canonical-arg scope derivation and an executable equality binding each admit;
   an argument-addressed role/membership check without either binding is classified query-shaped;
3. adversarial mismatch: a member of P requesting an instance keyed by Q cannot enter Q through P's
   establishment scope, and receives no Q snapshot, replacement, or delta;
4. at one instance and authority version, broadcast establishment and a fresh strict fail-closed
   evaluation deny exactly the same principals;
5. non-member denial creates no broadcast-group subscriber;
6. snapshot/register races lose no commit;
7. N same-group clients converge to fresh evaluation from one group disposition;
8. distinct canonical args/windows never share;
9. revoke racing a built delta loses at the final gate, with peers correct;
10. connection/grant replacement inherits no membership or queued frame;
11. mixed permission/data commits restore affected subscribers from successor truth;
12. ordinary remove carries shrink obligation + revision ACK or uses shared replacement;
13. resubscribe-with-pending uses replacement;
14. bound overflow yields targeted resync/typed teardown, never silent loss; and
15. paired hidden worlds include storage-only extra columns: every compact `add`/`update` row byte-equals
    its corresponding fresh reconstruct-path projected row, delta-applied state byte-equals the fresh
    projected result in each world, and the worlds yield identical deltas, watermarks, replacements,
    completeness, and refusal.

### 6.3 Performance acceptance

Use LLP 0209/0265 discipline at 1/10/100/1,000 subscribers where target limits admit. For one stable group,
each affected ordinary commit records:

- zero establishment/permission rechecks;
- one matcher/delta-or-replace computation per group, independent of subscribers;
- one bounded enqueue per recipient; and
- result/delta bytes and client convergence equal to the control.

The transition arm still performs per-subscriber checks and meets LLP 0200 §2.4's fence target. Publish no
claim until control/broadcast arms match data, authority, result, durability, network, and correctness
posture under LLP 0265 §§3–8.

## 7. Named G0 input dependencies (not author gates)

Missing upstream inputs consumed here, not independently answered:

- **G0-BCAST-CLASS:** certificate that the complete, delta-relevant base is class 1.
- **G0-BCAST-SEPARATION:** proof that the group predicate is establishment-only, with no overlay.
- **G0-BCAST-SCOPE:** canonical owner-computed scope identity and equality/normalization.
- **G0-BCAST-SCOPE-BINDING:** proof that the establishment scope is owner-computed from the same
  instance's canonical args, or an executable equality binds every delivered resource to that scope
  argument; unbound join checks classify as query-shaped.
- **G0-BCAST-AUDIENCE:** proof that, at the same instance and authority version, the scope's deny-set is
  exactly the fail-closed audience for that instance.
- **G0-BCAST-INVALIDATION:** complete admission-input → authority-event mapping and affected selection.
- **G0-BCAST-IDENTITY:** identity strong enough to imply byte-equivalent results.
- **G0-BCAST-CORPUS:** allow/deny, P-member/Q-instance mismatch, exact-audience parity,
  projection-versus-storage-column, hidden-world, transition, mixed-commit, and refusal rows.
- **G0-BCAST-BOUNDS:** normal/large-fixture group-state and fan-out bounds.

Different G0 names/carriers are fine; these labels describe dependencies, not a fork of its grammar.

## Open questions

No author-gated product or security call remains in v0.2. Wire encoding, data structures, and adapter
placement are constrained implementation choices; unresolved classification facts are §7 G0 inputs.

## Revision history

- **v0.1 (2026-08-16).** Initial draft: adopts G0's class-1-base plus establishment check, extends
  DK-3/G3 with a bounded group distributor, keeps LLP 0200 §2.4 unchanged, and fixes the fail-closed boundary.
- **v0.2 (2026-08-16).** Review round 1 fixes: binds admission scope and exact fail-closed audience to the
  result instance; makes compact ops projection-only; corrects establishment, denial, fallback, and
  obligation-transfer grounding; scopes G0 to base classification; and expands adversarial acceptance.
