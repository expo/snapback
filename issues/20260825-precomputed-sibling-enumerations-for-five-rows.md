# Pre-computed sibling enumerations for F091, C004, C009, F286, F288

Status: open
Date: 2026-08-25
Systems: snapback-engine, snapback-sync, snapback-kernel, snapback-server
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  issues/20260825-the-strict-family-is-not-batchable-45-roots-for-58-rows.md,
  issues/20260825-lane-completion-checklist.md

## Why this was produced before the lane

LLP 0303 revision **(n)** makes sibling enumeration a deliverable of the fix rather than a finding of
the review, because eight of nine gated lanes were defeated by an adjacent path their fix never
reached. Enumerating in advance, on otherwise-idle read-only capacity, means the implementing lane
inherits the map instead of spending a round drawing it.

## The headline: fixing the exploited site is not close to sufficient

| Row | Distinct path families | Reach of a fix at the exploited site |
|---|---:|---|
| **F091** | **13** | 4/13 structurally — **0 guaranteed semantically**, because all four reconstruct an unbound output |
| **C004** | **12** | 10/12 structurally; coverage indeterminate, and R7–R8 **definitely bypass** the site |
| **C009** | **12** | descriptor site is directly on 6 branches and causally upstream of 12/12, but only if literal, clone, serde, builder **and** alternate construction all derive from the installed issuer reservation |
| **F286** | **2** | 1/2 — direct core callers remain |
| **F288** | **3** | 1/3 overall, 1/2 of the generation-bearing paths — direct prepared and development siblings remain |

F091's line is the one to sit with: a fix at the site where the exploit was executed touches four of
thirteen path families and is **semantically guaranteed on none of them**, because each reconstructs
an unbound output. A lane that fixed the exploited site and declared victory would have been
defeated, exactly as seven lanes before it were.

## My hypothesis about the shared root was wrong

I asked whether the **generation issuer** was a common root across C009, F286 and F288, on the
reasoning that all three concern connection generations and subscription scope. It is not:

- for **F286**, issuer closure covers **0 of 2** paths;
- for **F288**, it "removes the unissued-generation component but does not close the row", because
  B's genuine descriptor still carries a genuinely issued generation that can be combined with A's
  body connection ID, and B's subscription can still be repointed to A.

The actual root is **the exact `PreparedConnectionAct` plus retained subscription owner** — the
prepared act including its connection ID, descriptor/admission, fence and grant, paired with a
subscription whose retained owner is that same connection.

**That is good news.** `PreparedConnectionAct` is one of only four authority roots in the strict
family currently assessed as **sound**: server-private, unconstructible from a dependent crate, and
retaining exact live registry/grant provenance. So F286 and F288 hang off a root that will actually
hold, which makes them more tractable than their path counts suggest — provided the fix derives from
the *tuple*, not from the generation.

## The Q06 asymmetry recurs

Both F286 and F288 show it: a validated B prepared act enters the server, but the staged plan is
assembled with **body connection ID A** and **B's descriptor/fence**. Stage ownership prevents
engine-to-engine travel, but it does not preserve the connection-ID equality the validated input
implies.

That is the same shape as the landed Q06 row — input view bound, reconstructed output not — and it
is now the third place it has appeared. Worth treating as a standing check rather than a per-row
discovery.

## Roots required for the remainder

- **F091** — authenticated subject and claims plus producer database/projection provenance, enforced
  at the consuming engine's common authority tail.
- **C004** — server-derived subject and claims tied to the same durable session database; the common
  raw authority/fence tail must not accept caller-authored equivalents.
- **C009** — the exact installed issuer's reservation history, associated with the exact connection
  grant/fence.
- **F286 / F288** — the `PreparedConnectionAct` / connection-grant tuple, and for F288 the retained
  subscription owner with it.

## C009 lane extension — installed reservation history and exact grant fence

This extends the pre-computed **12-family** C009 count; it does not replace that count with a new
enumeration. The stable labels below make every family and every descriptor-producing branch
reviewable after the fix.

### The six descriptor-producing branches

All six now converge on `LiveInvalidationIssuer::reserve_connection`, and that operation requires
the opaque `InstalledInvalidationReservation` returned by the database/registry-bound install.
The connection generation is an attribute allocated along the way; it is not the root.

| Producer branch | Feature cell | Post-change source of descriptor and fence | Status |
|---|---|---|---|
| P1 served connection/grant | default | `install_authenticated_auth_invalidation` returns `EngineInvalidationBinding`; `ConnectionRegistry::open_prepared` supplies `bound.effect_fence(grant_id)` | **closed** |
| P2 authorization acceptance fixture | Rust `cfg(test)` | fixture installs the issuer, receives the binding, then reserves its synthetic grant fence | **closed** |
| P3 protected-room kick acceptance fixture | Rust `cfg(test)` | same install-returned binding; A and B reserve distinct exact fences | **closed** |
| P4 graph-corpus scheduler | additive `snapback-engine/test-support` | scheduler installs first, then reserves through the returned binding | **closed** |
| P5 graph-measurement scheduler | additive `snapback-engine/test-support` | scheduler installs first, then reserves through the returned binding | **closed** |
| P6 engine unit-fixture installer | Rust `cfg(test)` | helper installs first, then reserves through the returned binding | **closed** |

No seventh descriptor producer was found. `ConnectionGrant` and `BundleConnection` are outbound wire
projections of P1, not producers; neither can deserialize an authority-bearing descriptor back into
the server.

### The twelve path families

| ID | Path family carried by the pre-computed count | Closure after this lane |
|---|---|---|
| C009-R1 | fresh negotiated `/connection/open` grant | descriptor is reserved from P1 with the exact newly minted grant fence before the grant record is inserted |
| C009-R2 | authenticated reopen of an existing grant | `Clone` preserves the same immutable reservation-history `Arc` and exact fence; no field can be changed |
| C009-R3 | ordinary live subscribe transport | `PreparedConnectionAct` remains the carrier; `LiveInvalidationAdmission::new(descriptor)` derives the fence |
| C009-R4 | ordinary live resume transport | same derived admission as R3; the engine also requires the descriptor's exact installed history |
| C009-R5 | authorization-invalidation ACK transport | prepare accepts no fence parameter and stages with `descriptor.effect_fence()` |
| C009-R6 | authorization-invalidation manual-retry transport | prepare accepts no fence parameter; installed-history refusal precedes the existing durable retry reservation transaction |
| C009-R7 | fresh classic bundle registration | `BundleRegisterTarget::new` accepts the descriptor but no fence and derives the latter |
| C009-R8 | replayed classic bundle registration | the grant-record clone preserves P1 provenance and the replay target derives its fence |
| C009-R9 | fresh mixed-bundle live-child registration | the same safe bundle target produces each live child's admission |
| C009-R10 | replayed mixed-bundle live-child registration | the replay target and every child retain the same descriptor/fence root |
| C009-R11 | additive test-support direct live subscribe adapters | public helper accepts a descriptor but no independent fence; unscoped helper is a separate no-descriptor constructor |
| C009-R12 | additive graph corpus/measurement, normal-owner and partition-owner subscriptions | P4/P5 reserve only after install; both subscription arms use the descriptor-derived admission |

No thirteenth authority-bearing family was found. The outbound JSON/schema paths are projections,
and the `cfg(test)` acceptance suites are the P2/P3/P6 producer siblings above rather than another
dependent-reachable sink.

### The five conditional construction routes

| Route required by the pre-computed condition | Status | Structural reason |
|---|---|---|
| literal construction | **closed** | every descriptor field is private, including the process-local reservation history and fence; there is no public literal constructor |
| `Clone` | **closed, clone retained safely** | clone preserves the same reservation-history `Arc` and fence; fields are immutable and there is no `DerefMut`/setter route |
| serde | **closed** | the descriptor no longer implements `Deserialize`; the containing `ConnectionGrant`, `BundleConnection`, and `BundleResponse` remain outbound-only Rust types |
| builder | **closed** | scoped live and bundle builders take only a descriptor and derive its fence; ACK and manual-retry preparation likewise removed their fence parameter |
| alternate construction | **closed** | raw generation reservation is gone; reserving a descriptor requires the unforgeable `InstalledInvalidationReservation` produced by the database-bound install |

The last row still has a deliberate exact-instance check: a descriptor minted from a different,
valid database-bound reservation history can exist, but `LocalInvalidationState` refuses it. This is
artifact-provenance verification, not verification of a caller-selected generation. The generation
itself is always derived.

Carrier audit: `InstalledInvalidationReservation` has no public constructor, `Default`, serde, or
conversion; only the successful database/registry expectation bind produces it. `Clone` retains the
same `Arc` identity, and replay can only reserve a fresh monotone generation from that same history.
The pre-existing `EngineInvalidationBinding` is produced by the authenticated installer, remains
cloneable, and can produce only descriptors carrying that installed identity. A holder can still
choose the grant fence for a genuinely issued descriptor. That is not a route around the C009
reservation root; it is the neighboring cross-connection composition left deliberately visible by
the non-closure claims for F286/F288 below.

### Feature cells and executable evidence

The permanent dependent-crate witnesses cover five attacks in each of these seven cells: no
features; `snapback-auth/test-support`; `snapback-engine/test-support` (which enables auth support);
`snapback-server/test-support`; `snapback-activation/test-support`; standalone
`snapback-sync/test-support`; and all five additive crate features together. The lane found that
standalone sync support previously enabled sync-only methods which called missing auth and kernel
test-support items. `snapback-sync/test-support` now forwards both dependent features, so that cell
reaches the five live attack spans instead of failing early inside the product. The final boundary
gate measured **35/35 C009 cells passing**. Its overall result remains red on **12** baseline-relevant
unchanged inventory/fixture failures; a path-scoped `git diff --quiet origin/main` over both gate
scripts, the kernel/services APIs, and all ten failing legacy fixtures returned zero.

Fail-first was watched against exact `origin/main` (`72b766977`): **5/5** no-feature dependent bins
compiled and each retained the call to `prepare_resume_live_for_transport`. After the change the
same five source attacks fail at their `@attack` spans: literal, clone mutation, serde, independent
builder stapling, and raw-issuer alternate reservation.

Runtime evidence is complementary: `c009_foreign_reservation_history_is_rejected_by_live_subscribe`
constructs a descriptor with equal protocol/issuer/authorization/version-stream/fence wire facts
but a distinct reservation history, observes live-subscribe refusal before subscription insertion,
then observes manual-retry refusal with the durable retry-record count unchanged.
`c009_descriptor_derives_exact_fence_for_live_effect_staging` proves a foreign fence cannot commit
the staged effect while the descriptor's exact fence can.

### Transaction, durable-state, and neighboring-row bounds

This lane adds **no durable state**. Therefore it adds no pre-emption, permanent wedge, rollback,
retention, pruning, or durable-single-use surface. The installed capability is process-local and
`Clone` only preserves the same identity. The existing monotone generation allocator remains
non-reusing; a later failure may burn a generation as before, but cannot reserve or consume another
issuer history.

Transaction scope was checked rather than inferred from transaction existence. Installed
provenance is minted from the database/registry expectation view during
`install_auth_invalidation`. In manual retry, `accepts_connection` checks that provenance before
`reserve_manual_invalidation_retry` enters the existing durable reservation transaction; the
runtime test proves the refusal consumes no durable record. Connection reservation itself has no
durable effect to attest: it occurs inside the same grant-open critical section that has already
minted the exact grant ID and bound authority fence, before insertion of the grant record.

`PreparedConnectionAct` was not restructured. P1 derives from its upstream `BoundGrantAuthority`
and exact grant ID, and later handlers continue to carry its existing descriptor field.
`ResolvedAppAuthority` was not changed. This is intentional coupling to the concurrent lanes that
own those types.

Finally, this lane does **not** claim F286 or F288. Their characterization tests were changed to use
genuinely issued descriptors: `f286_victim_connection_is_touched_and_foreign_obligation_is_discharged`
and `f288_victim_connection_repoints_owned_subscription_with_issued_descriptor` both still pass.
Thus issuer-reservation closure covers neither F286 path and removes only F288's unissued-generation
component, exactly as the corrected hypothesis above states.

## Provenance

Read-only against `5c2650d7526f65a60211057db50b97a9bf2a3551`, rechecked unchanged at the end. These
five rows were briefly promoted to P1-SHIP and have since been corrected back to P2/P3
(`issues/closed/20260825-i-over-escalated-five-p3-rows-to-p1-ship.md`); the enumeration is unaffected by
that severity correction, since it describes reachability rather than severity.
