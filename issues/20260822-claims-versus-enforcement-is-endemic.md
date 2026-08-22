# The claimed-structural / actually-conventional defect class is endemic to the fence work

Status: Open — 8 further gaps, 2 Critical. Latent, not currently exercised.
Created: 2026-08-22
Related: issues/20260822-authorized-effect-program-status.md,
issues/20260822-bounded-commit-capsule-spec.md, LLP 0058

## Why this audit ran

The same defect kept appearing in review: **a guarantee claimed as structural that is actually
conventional** — code or a comment asserts an invariant the type system does not enforce, so it
holds only while callers behave. Four instances in two days:

1. `converge_committed_width: bool` — a flag where a type was needed; hid a convergence defect for
   two review rounds.
2. `CommitUncertainRetention::new` — a doc comment asserting "the caller keeps another handle" that
   nothing enforced; the test passed only because it happened to keep an extra clone.
3. Push branching on `trigger_mode` — exhaustively matched, still the wrong question; broke
   credential-free watch-reaction push in production.
4. Stream R1 (×2, in flight) — provenance from `(AuthMode, ResolvedAppAuthority)` rather than the
   publication carriers, and a marker whose compile-fail test blocked a struct literal while a
   public factory could still mint it.

The shape is identical: **something correlated with the invariant is checked instead of the
invariant**, and a test passes because it exercises the correlated case.

## Verdict

**The four were not the extent of it. The class is endemic at the fence work's adapter and carrier
boundaries.** Eight further gaps, two Critical.

No production route currently exercises the bad pairings. The problem is that **the APIs permit
them**, and correctness depends on today's adapters preserving correlations that nothing enforces.

## The two Critical gaps

**1. `PreparedAuthority` does not bind resolved authority to its publication fences.**

`PreparedBearerAuthority` and `ResolvedServiceAuthority` are described as opaque, non-substitutable
bundles, and their private fields enforce the pairing at construction. But the public
`with_fenced_publication` and `with_service_publication` (`crates/snapback-sync/src/auth/invocation.rs:1527`,
`:1542`) accept **any** carrier without checking it against `resolved`, and
`reserve_authorized_effect` (`:1751`) then trusts what is attached.

Shortest violating path: prepare session authority A, attach the stream-only anonymous publication
from `prepare_anonymous_publication`, retire A's session, then reserve. The anonymous carrier can
still reserve the shared stream because it contains no A-session leaf.

Consequence (INFERRED): a post-logout durable mutation could reserve and commit using a publication
**that never participates in that session's terminal drain** — i.e. the fence would be present and
inert. A cross-pair unit test with a session authority plus anonymous publication would confirm it.

**2. An authorized-effect reservation is not bound to the authority or destination used by the
sink.**

`AuthorizedEffectReservation` is described as retaining the complete authority bundle, and migrated
sites claim the exact caller/session is serialized with the durable cut. The reservation privately
holds authority A, but guarded sinks separately accept a `&PreparedAuthority` B: **authorization is
checked against B while the permit belongs to A.**

## Suspect tests

Separately identified: tests that appear to prove a structural property while exercising only the
correlated case. Notably
`bounded_commit_capsule_during_commit_never_times_out_and_reconciles_exact_rows_only` sounds
structural, but its shared helper performs the exact query before returning `IntendedRows` — it
never supplies a lying reconciliation closure or a transaction closure that bypasses
`FinalCommitCut`.

These matter more than the gaps themselves: they are what lets the next instance through review.

## What was found sound

The publication PUT lease registry has no comparable gap — acquisition is private and
transitions/drop address the exact publication and lease identity. Apart from the unpacked
watch-action settlement, the remaining mode-epoch carriers retain their lease through private
fields.

## What this changes

"Fenced" currently means "fenced provided callers pair carriers correctly." That is weaker than
every fence commit message in this program has claimed, including mine. The remediation is
enforcement at the carrier boundaries — constructors and API shapes that make the bad pairing
inexpressible — not more fences.

Because nothing exercises the bad pairings today, this is fix-forward work rather than an incident.

## Provenance

Read-only codex audit against `175732312`, with the four known instances excluded by instruction.
Full ranked list with file:line citations appended below.

---

I audited current `main` at `175732312` read-only and excluded the four known incidents.

Verdict: this class is endemic to the fence work. I found eight further claims-versus-enforcement gaps. I found no evidence that today’s production routes currently exercise the bad pairings; the problem is that the APIs permit them and correctness depends on the present adapters preserving correlations.

## Ranked gaps

1. Critical — `PreparedAuthority` does not bind resolved authority to its publication fences

Claim: `PreparedBearerAuthority` and `ResolvedServiceAuthority` describe authority and its “exact” fence as opaque, non-substitutable bundles ([coordinator.rs:398](crates/snapback-sync/src/auth/coordinator.rs:398), [engine.rs:3258](crates/snapback-engine/src/local/engine.rs:3258)).

Actual enforcement: their private fields initially enforce the pairing, but public `PreparedAuthority::with_fenced_publication` and `with_service_publication` accept any carrier without checking it against `resolved` ([invocation.rs:1527](crates/snapback-sync/src/auth/invocation.rs:1527), [invocation.rs:1542](crates/snapback-sync/src/auth/invocation.rs:1542)). `reserve_authorized_effect` then trusts those attached carriers ([invocation.rs:1751](crates/snapback-sync/src/auth/invocation.rs:1751)).

Shortest violating path: prepare session authority A, attach the stream-only anonymous publication returned by `prepare_anonymous_publication` ([coordinator.rs:1520](crates/snapback-sync/src/auth/coordinator.rs:1520)), retire A’s session, then reserve. The anonymous carrier can still reserve the shared stream because it contains no A-session leaf ([session_projection.rs:669](crates/snapback-sync/src/auth/session_projection.rs:669)).

Consequence: **INFERRED** — a post-logout durable mutation could reserve and commit using a publication that never participates in that session’s terminal drain. A cross-pair unit test using a session authority plus anonymous publication would confirm it.

Missing enforcement: a constructor/API that preserves resolved-authority-to-publication identity and makes carrier substitution inexpressible.

2. Critical — an authorized-effect reservation is not bound to the authority or destination used by the sink

Claim: `AuthorizedEffectReservation` is described as retaining the “complete authority bundle,” and migrated sites claim the exact caller/session is serialized with the durable cut ([invocation.rs:1225](crates/snapback-sync/src/auth/invocation.rs:1225), [engine.rs:5333](crates/snapback-engine/src/local/engine.rs:5333)).

Actual enforcement: the reservation privately contains authority A, but guarded sinks separately accept `&PreparedAuthority` B. Authorization is checked against B, while `commit_guard` acquires the mode/service guard from A ([invocation.rs:1315](crates/snapback-sync/src/auth/invocation.rs:1315), [engine.rs:5339](crates/snapback-engine/src/local/engine.rs:5339), [engine.rs:15304](crates/snapback-engine/src/local/engine.rs:15304)). There is no identity comparison. Nor is either value bound to the receiving `LocalSnapback`.

Some split phases are weaker still: width plan/commit accept a ticket and reservation but no authority at all ([engine.rs:14960](crates/snapback-engine/src/local/engine.rs:14960), [engine.rs:14982](crates/snapback-engine/src/local/engine.rs:14982)).

Shortest violating paths:

- Reserve under live A, retire B, then call `asset_delete_with_authorized_effect(&B, …, reservation_A)`.
- Produce a width/finalize ticket under B and commit it with a fresh reservation from A.
- Reserve against app instance A, then invoke the sink on `LocalSnapback` B.

Consequence: **INFERRED** — B’s session/service or mode retirement does not drain A’s permit, allowing authority-sensitive writes, including tombstones, to cross B’s terminal boundary. Cross-authority and cross-instance mutation tests would confirm it.

Missing enforcement: one opaque value binding the operation authority, permits, ticket/intent, and destination admission controller.

3. Critical — authorized-versus-mode-only posture remains caller-selected

Claim: LLP 0058 says caller-backed sites use the authorized path, mode-only sites use an explicitly named terminal/internal path, and “no request input or other caller-settable bypass selects the posture” ([LLP 0058:1360](llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1360)).

Actual enforcement: current server routes select correctly, but both siblings remain callable. Examples include:

- `asset_delete` versus `asset_delete_with_authorized_effect` ([engine.rs:15294](crates/snapback-engine/src/local/engine.rs:15294)).
- `asset_tus_patch_commit` versus its authorized sibling ([engine.rs:13456](crates/snapback-engine/src/local/engine.rs:13456)).
- Finalize plan/complete siblings ([engine.rs:13796](crates/snapback-engine/src/local/engine.rs:13796)).
- Push claim/transmitting siblings ([engine.rs:6263](crates/snapback-engine/src/local/engine.rs:6263)).

The push selector also remains incomplete: `has_fenced_publication` checks only the stream/session `publication` option ([invocation.rs:1534](crates/snapback-sync/src/auth/invocation.rs:1534)), while a prepared authority can carry only `service_publication` ([engine.rs:7949](crates/snapback-engine/src/local/engine.rs:7949)). Push uses that boolean to select all three siblings ([server.rs:2027](crates/snapback-server/src/server.rs:2027)). This is separate from the known `trigger_mode` defect: the new predicate observes a real carrier, but not every carrier relevant to the decision.

Shortest violating path: retain a stale caller authority and invoke the mode-only sibling; alternatively, pass a service-publication-only authority through the push host and let `has_fenced_publication == false` choose mode-only.

Consequence: **INFERRED** — authority-sensitive durable rows can commit under a mode guard alone. A service-only push test and a stale-session direct-sibling test would confirm it.

Missing enforcement: a type-level posture/capability distinction, including a total classification over all authority carriers.

4. High — current-attempt proof can launder caller-authored TUS and finalize facts

Claim: the kernel module says a higher adapter cannot combine a valid proof with caller-authored fields ([services_assets.rs:1](crates/snapback-kernel/src/services_assets.rs:1)). TUS calls its value an immutable continuity ticket between validation and acknowledgement ([assets.rs:497](crates/snapback-services/src/assets.rs:497)); finalize says it freezes every fact needed downstream ([assets.rs:488](crates/snapback-services/src/assets.rs:488)).

Actual enforcement:

- `AssetTusPatchTicketV1::from_current_attempt` takes a genuine current-attempt proof but arbitrary `new_offset`, checksum grade, and store, with no validation ([assets.rs:1002](crates/snapback-services/src/assets.rs:1002)). `append` is optional and non-consuming ([assets.rs:1046](crates/snapback-services/src/assets.rs:1046)). The kernel CAS checks only the old values before assigning the caller-supplied new ones ([asset_attempts.rs:768](crates/snapback-kernel/src/storage/asset_attempts.rs:768)).
- `FinalizePrepareTicketV1::from_current_attempt` similarly accepts arbitrary frozen intent, store, feature flags, app identity, quota, and schema ([assets.rs:1352](crates/snapback-services/src/assets.rs:1352)). Commit reloads the attempt but later consumes those ticket-authored app/quota/schema values ([engine.rs:14088](crates/snapback-engine/src/local/engine.rs:14088), [engine.rs:14340](crates/snapback-engine/src/local/engine.rs:14340)).

Shortest violating paths:

- Mint a current-attempt proof, create a TUS ticket with an offset beyond declared length or `all_chunks_checksummed = true`, skip `append`, then commit.
- Mint a finalize ticket with a permissive intent or oversized quota while retaining the real attempt proof.

Consequence: **INFERRED** — inconsistent durable offsets, forged end-to-end integrity grade ([engine.rs:14155](crates/snapback-engine/src/local/engine.rs:14155)), or policy/quota/accounting bypass. Direct factory tests would confirm each.

Missing enforcement: a private validated transition constructor whose result carries the proven new facts.

5. High — a valid width-plan proof can be relabeled with arbitrary prepared metadata

Claim: the same kernel module makes the no-caller-authored-fields assertion, and the width proof is named as proof of the exact accepted publication ([services_assets.rs:62](crates/snapback-kernel/src/services_assets.rs:62)). LLP 0276 also forbids replacing opaque admission with a caller-asserted public constructor ([LLP 0276:721](llp/0276-ideal-codebase-architecture.rfc.md:721)).

Actual enforcement: `into_prepared_variant` consumes a genuine publication proof but accepts arbitrary key, width, digest, length, content type, and recipe version ([services_assets.rs:85](crates/snapback-kernel/src/services_assets.rs:85)). The intended services path checks correspondence and verifies the PUT ([assets.rs:893](crates/snapback-services/src/assets.rs:893)), but the public inter-crate conversion can bypass it. The kernel staging check verifies the embedded publication, not the authored scalar fields ([asset_attempts.rs:1001](crates/snapback-kernel/src/storage/asset_attempts.rs:1001)); commit then writes those scalar fields into blob/rendition metadata ([asset_attempts.rs:169](crates/snapback-kernel/src/storage/asset_attempts.rs:169)).

The source itself concedes that this is only “type-state guidance” rather than a universal boundary ([services_assets.rs:109](crates/snapback-kernel/src/services_assets.rs:109)); that concession conflicts with the module-level structural claim.

Shortest violating path: obtain a real width publication proof, call `into_prepared_variant` directly with invented metadata, then call the public kernel stage/resolve operations.

Consequence: **INFERRED** — a Ready rendition/blob record can describe bytes that were never verified or do not exist under the planned key. A direct lower-crate adversarial test confirms it.

Missing enforcement: confinement of proof conversion and a commit capability that can originate only after the verified PUT path.

6. Medium — `PreparedWatchAction` is unpacked before the exact-epoch settlement

Claim: claimed jobs are paired with their exact admission lease ([engine.rs:1807](crates/snapback-engine/src/local/engine.rs:1807)), and firing settlement is said to remain in the claimed job’s exact epoch ([engine.rs:24785](crates/snapback-engine/src/local/engine.rs:24785)).

Actual enforcement: `PreparedWatchAction::into_parts` exposes the admission lease separately from raw watch/job/ordinal fields ([engine.rs:1838](crates/snapback-engine/src/local/engine.rs:1838)); public `settle_watch_action` accepts those pieces independently ([engine.rs:25025](crates/snapback-engine/src/local/engine.rs:25025)). The server currently unpacks and immediately re-passes the matched values ([server.rs:3378](crates/snapback-server/src/server.rs:3378)).

Shortest violating path: retain raw settlement identity from action X but supply a fresh live `AdmissionLease` from action Y.

Consequence: **INFERRED** — an old firing can be marked succeeded/failed or rescheduled after X’s epoch retired. A two-action mixed-carrier test would confirm it.

Missing enforcement: settlement consuming the still-opaque prepared action carrier.

7. Latent/high — the bounded capsule trusts caller-asserted commit and reconciliation outcomes

Claim: the capsule says the kernel pending value is the only commit primitive and only exact intended rows can resolve ambiguity as success ([commit_capsule.rs:8](crates/snapback-server/src/server/commit_capsule.rs:8)).

Actual enforcement: `CommitAttempt::Committed` and `ExactReconciliation::IntendedRows` are freely constructible crate-visible enum variants ([commit_capsule.rs:38](crates/snapback-server/src/server/commit_capsule.rs:38)). The transaction closure receives full mutable `LocalSnapback`, while the reconciliation closure simply returns the assertion enum ([commit_capsule.rs:558](crates/snapback-server/src/server/commit_capsule.rs:558)). The capsule trusts both outcomes ([commit_capsule.rs:652](crates/snapback-server/src/server/commit_capsule.rs:652), [commit_capsule.rs:688](crates/snapback-server/src/server/commit_capsule.rs:688)). `PendingCommit`’s “must not validate/re-enter Local” restriction is also only prose ([commit_capsule.rs:91](crates/snapback-server/src/server/commit_capsule.rs:91)).

Shortest violating paths: return `Committed` without consuming `FinalCommitCut`; mutate through `LocalSnapback` before the final cut; or return `IntendedRows` without an exact query.

Consequence: false committed success, mutation outside the deadline/authority cut, or discarded ambiguity retention. The module currently has no production caller ([commit_capsule.rs:5](crates/snapback-server/src/server/commit_capsule.rs:5)), so this is prototype-only.

Missing enforcement: kernel-minted opaque commit/reconciliation outcomes and a capability-limited transaction closure.

8. Latent/medium — `FinalCommitCut`’s “only once” invariant has a conventional retry hole

Claim: the runtime assertion says a final cut can be consumed only once ([commit_capsule.rs:475](crates/snapback-server/src/server/commit_capsule.rs:475)).

Actual enforcement: `disposition` is set on successful rollback, but remains `None` when rollback itself errors after deadline or guard refusal ([commit_capsule.rs:484](crates/snapback-server/src/server/commit_capsule.rs:484), [commit_capsule.rs:494](crates/snapback-server/src/server/commit_capsule.rs:494)).

Shortest violating path: first call returns a rollback error; invoke `commit` again on the same cut with another pending value. The assertion permits it.

Consequence: **INFERRED** — multiple final-cut attempts or misleading ambiguity/rollback state. An injected rollback-error-then-second-call test confirms it. Prototype-only.

Missing enforcement: consumption/state transition on every first invocation, including rollback failure.

## Tests that pass for the correlated reason

- The five migrated route-race families are generated at [server/tests.rs:31787](crates/snapback-server/src/server/tests.rs:31787). Their fixture manually reassembles the resolved authority with its matching publication ([server/tests.rs:31299](crates/snapback-server/src/server/tests.rs:31299)). They prove current routing, not carrier non-substitutability.

- The three immediate-push races reserve from `fixture.authority` and pass that same authority into the sink ([server/tests.rs:32121](crates/snapback-server/src/server/tests.rs:32121), [server/tests.rs:32186](crates/snapback-server/src/server/tests.rs:32186)). The credential-free watch test covers only the no-publication/no-service quadrant ([server/tests.rs:25835](crates/snapback-server/src/server/tests.rs:25835)). No test covers service-publication-only authority.

- The asset race macro exercises every route through one bearer and the route’s matching authority/reservation ([server/tests.rs:33214](crates/snapback-server/src/server/tests.rs:33214), [server/tests.rs:33421](crates/snapback-server/src/server/tests.rs:33421)). It cannot detect reservation/authority, reservation/ticket, or cross-`LocalSnapback` substitution.

- `watch_firing_settlement_refuses_retired_epoch_without_settling_the_firing` passes the admission from the same watch context whose IDs it settles ([admission_fence_tests.rs:905](crates/snapback-engine/src/local/admission_fence_tests.rs:905)). It does not test a fresh unrelated lease with the old firing identity.

- `asset_tus_patch_commit_cas_includes_checksum_grade` obtains the ticket through the real preflight and performs `append` before commit ([engine.rs:5072](crates/snapback-engine/src/local/tests/engine.rs:5072)). It proves the correlated adapter path, not that `from_current_attempt` cannot assert a checksum grade or offset.

- The width compile-fail examples prove only that callers cannot write struct literals or pass the wrong proof type ([services_assets.rs:67](crates/snapback-kernel/src/services_assets.rs:67), [assets.rs:856](crates/snapback-services/src/assets.rs:856)). They do not exercise the public proof-to-arbitrary-prepared conversion.

- `bounded_commit_capsule_during_commit_never_times_out_and_reconciles_exact_rows_only` sounds structural, but its shared helper performs the exact query before returning `IntendedRows` ([server/tests.rs:36858](crates/snapback-server/src/server/tests.rs:36858), [server/tests.rs:37596](crates/snapback-server/src/server/tests.rs:37596)). It never supplies a lying reconciliation closure or a transaction closure that bypasses `FinalCommitCut`.

I found no comparable gap in the publication PUT lease registry: acquisition is private and transitions/drop address the exact publication and lease identity ([assets.rs:653](crates/snapback-services/src/assets.rs:653), [assets.rs:689](crates/snapback-services/src/assets.rs:689)). Apart from the unpacked watch-action settlement, the remaining mode-epoch carriers also retain their lease through private fields.

Plainly: **the four known incidents were not the extent of it; this defect class is endemic at the fence work’s adapter and carrier boundaries.**