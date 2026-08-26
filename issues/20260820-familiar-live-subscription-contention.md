# Investigate Familiar React degradation with six concurrent live subscriptions

**Status:** Open — category (b) classification complete; pre-inconsistency
client diagnostic still required
**Systems:** React client, live queries, auth invalidation, outbox
**Date:** 2026-08-20/21
**Reopened:** 2026-08-21 — independent review showed Wanted #4 was not met;
the inspect-only overload diagnostic is not an application-visible warning
**Reopened:** 2026-08-25 — fix-round review showed the five-second client
timer can fire after partial publication and during healthy, within-capacity
convergence; the synthetic unit test did not exercise the real publish path
**Evidence:** Diary 0105 M2; frozen Clique `0.3.2-m8` two-client choreography
on local commit `708e2e5c5348b5bb863cd7120afbafad9db99e9a`

## Observation

The Familiar Clique lane initially composed one route from six ordinary live
subscriptions (profiles/users, posts, follows, likes, reposts, and the route's
narrow reply input). This is well below the documented 64-subscription
per-connection ceiling. Under repeated two-browser choreography:

- three authenticated create-post mutations settled, but the author's own live
  card did not become observable within the frozen 15-second ceiling;
- an earlier interactive mutation rejected with
  `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED`, and the unhandled rejection left
  Expo's development overlay intercepting later trials;
- independently materialized follow/post/repost sets transiently disagreed,
  causing false set-state controls and incorrect Following projections.

The lane replaced the independent reads with one bounded Familiar live query
returning a singleton relational state row. With otherwise equivalent app and
choreography behavior, final live-post trials stabilized at 1.356–1.365s and
all follow/like/repost/reply trials passed.

This run had accumulated development data and several app-level route bugs, so
it is not yet a minimal proof of a Snapback defect. The sharp before/after and
the low subscription count make it too strong to classify as ordinary app
tuning without investigation.

## Wanted

1. Extract a two-principal fixture with six Familiar `useQuery` subscriptions,
   repeated authenticated set-state writes, and the same 15-second observation
   ceiling. Run it both as six references and as one equivalent relational
   reference.
2. Capture auth-coordinator state, subscription readiness/refresh state,
   connection count, outbox suspension reason, and per-query snapshot versions
   at every miss.
3. Determine whether the trigger is auth proof acquisition, subscription
   fan-out/backpressure, independent snapshot ordering, React hook ownership,
   or the benchmark app.
4. If the behavior is correct but composition-sensitive, document the bound
   and add a diagnostic before the UI reaches an inconsistent/suspended state.
   If it is a runtime/client defect, keep six independent queries green under a
   deterministic regression.

### Wanted #4 design revision (2026-08-26, round 4; implementation not started)

Lane C retains the fix-round bar's option (c): an explicit own-write atomic
query-group gate entered before mutation transport, with pressure produced
only by the real LLP 0200 Data-to-Refresh conversion and inserted into the LLP
0219 channel before the opted group exposes staged data. Healthy
within-capacity Data work stays silent and every non-opted caller retains
independent latest-value publication. Round 3 makes targeting explicitly
per-subscription, orders reconnect pressure in the subscribe response ahead of
its snapshot, and makes a typed blank a recoverable publication state rather
than a permanent acquisition lock. Round 4 leaves those resolved mechanisms
unchanged and closes only tombstone lifetime/deadline enforcement and the
retired-floor immutable-witness/bounded-eviction seams.

The revised worktree memo is root `DESIGN.md`. The repository-stable design is
now intentionally cross-owned by draft-pending-review dated amendments:

- [LLP 0094](../llp/0094-wire-envelope-contract.spec.md#draft-live-delivery-pressure-wire-amendment--2026-08-26) owns closed-DTO capability preflight,
  the exact per-subscription interest offer/echo, ordinary legacy fallback,
  and the reconnect subscribe-response pressure member;
- [LLP 0200 §6e](../llp/0200-live-evaluation-scheduling-and-settlement.spec.md#6e-draft-amendment-2026-08-26--own-write-atomic-composition-gate) owns only
  committed revision/watermark facts and the Data-to-Refresh → pressure
  hand-off → Refresh-publication server order for exactly interested
  subscriptions;
- [LLP 0114](../llp/0114-first-class-react-and-query-groups.spec.md#draft-own-write-atomic-group-amendment--2026-08-26) owns the group generations,
  authoritative-only snapshot algebra, pre-overlay all-or-nothing mutation
  intercept, finite hold, auto-allocated idle blank successor, and bookkeeping
  listener;
- [LLP 0095](../llp/0095-client-lifecycle-and-conformance.spec.md#draft-live-delivery-pressure-lifecycle-amendment--2026-08-26) owns subscription state/generation fencing and live/poll/reconnect/duplicate
  behavior, including drain-handoff dispositions and the bounded retired-
  episode/coverage high-water;
- [LLP 0219](../llp/0219-client-dev-diagnostics-channel.rfc.md#draft-live-delivery-pressure-carrier-amendment--2026-08-26) owns the exact
  `live_delivery_pressure.v1` semantics, interest-targeted durable
  `LiveEnvelope`, strict-coverage-raise enqueue/FIFO rule, and channel insertion;
- [LLP 0267 §7.8](../llp/0267-query-cost-guardrails.rfc.md#78-draft-overload-episode-registry-amendment--2026-08-26) owns the bounded current
  episode registry and exact creation-plus-negotiated-hold tombstone expiry,
  while §7.4 keeps `pendingDeliveryReason` an inspect-time join-only value.

Grant negotiation merely permits participation. A subscription is targeted
only after its subscribe interest is exactly echoed; negotiated ordinary
subscriptions allocate no episode and emit no pressure. Mounting an atomic
group on an unnegotiated lineage refuses with guidance to create a fresh
preflighted provider/connection because re-open cannot upgrade it; the ordinary
lineage and its traces remain undisturbed.

The finite composition deadline is fixed at pre-transport acquisition and is
never reset by settlement, resync, reconnect, supersession, or another episode
conversion. At the cut the provider fences and removes the predecessor,
releases the lease, and publishes one typed blank owned by an automatically
allocated idle successor. A later own write may acquire that blank successor
and recover rows after its committed V is fully covered; remount is only
no-write data recovery. A multi-group busy refusal reports the latest current
blocking deadline, not the earliest, as its bounded non-reserving retry point.
Every snapshot/coverage callback enforces `monotonicNow >= deadlineAtMs` before
testing release, so reconnect content that arrives after the local cut blanks
and fences the predecessor instead of publishing rows.

The corrected ordering claim is diagnostic-before the next post-gate group
notification; canonical child stores and ordinary consumers may advance
earlier. T-RECONNECT carries a transferred episode in `LiveSubscribeOutput`
and applies it before the response snapshot, while the client retains a bounded
retired episode/coverage high-water so a late durable reprojection cannot
resurrect a cleared episode. A T-LOSS tombstone now expires exactly at episode
creation plus the negotiated hold, which keeps it transferable through the
first-allocation group's deadline. The high-water retains `firstWaveSeq`
and `cause`, so only an exact immutable-witness strict coverage raise may
reactivate; it remains one fixed-size record per extant canonical store and is
discarded with final store eviction, bounding churn under LLP 0114's store cap.
Matching optimistic mutations refuse before
overlay or transport; opted group rows are authoritative only. Required
acceptance includes interest targeting/legacy silence, real producer on both
lanes, drain dispositions, strict-raise enqueue, response-before-snapshot
reconnect, exact-expiry loss/reconnect, at-deadline snapshot blanking,
immutable-witness retired dedup/reactivation, bounded store eviction,
group-sharing/multi-group acquisition, automatic blank-successor recovery, and
the silent within-capacity control.

Round-4 self-review does not claim convergence. A group acquired after an
episode's original creation can receive a legitimate strict-coverage
reactivation of that same fixed-expiry key; its later local deadline then
outlives `createdAtMs + liveDeliveryPressureMaxAtomicHoldMs`. Loss and reconnect
inside that interval can again omit the tombstone and release covering rows
without the diagnostic. Choosing expiry renewal, a fresh episode, or a gate-
acquisition fence would change settled machinery and is reserved for the author
LLP review sitting after this round.

This revision changes design documents only. Wanted #4 remains open, none of
the amendments is accepted, and no product implementation is present or
authorized in this round.

Related: `issues/closed/20260818-guide-gap-background-writes-during-auth-transitions.md`
owns the authoring recipe for the same suspension code, but not this
multi-subscription investigation.

## Investigation status (2026-08-21; corrected after independent review)

The classification portion is complete: **(b) documented composition bound**,
governed by LLP 0200 §2.5 (cancellation, fairness, and bounded staleness).
Within the minimized fixture, post-settlement misses are not caused by auth
suspension, queued-outbox congestion, disconnection, or lost React hook
ownership. This does not close the ticket: Wanted #4 also requires a diagnostic
before the UI becomes inconsistent or suspended, and no such client mechanism
has shipped.

The admission ceiling of 64 subscriptions per connection is a resource cap,
not a latency guarantee. LLP 0200 defines scheduler capacity as pending
subscription count multiplied by evaluation cost, serves one subscription per
scheduler turn, and promises the `max_hold + one turn + transport` convergence
bound only while demand is within capacity. Once inherited pending age reaches
the default five-second `max_hold`, the server converts the data work into a
priority refresh obligation and records `SNAPBACK_LIVE_OVERLOAD_DEGRADE`.
LLP 0200's Phase-3 implementation record already classifies 13.1-second
delivery starts in a six-observer arm as that explicit overload path.

### Minimized reproduction

`tests/acceptance/familiar-six-subscription-contention-v1.mjs` and its
`tests/acceptance/fixtures/familiar-six-subscription-contention/` backend are
the retained reproduction. It uses:

- the same two authenticated principals for both comparison arms;
- six stable-args Familiar `useQuery` plus `useQueryState` references per
  principal (`profiles`, `posts`, `follows`, `likes`, `reposts`, `replies`),
  each reading a distinct synced relation;
- one authenticated Familiar `useMutation` which atomically sets both the
  revision and boolean state in all six relations;
- one equivalent relational reference returning the same six relations in a
  singleton row;
- a 15-second ceiling that begins only after the mutation promise settles,
  followed by a bounded 60-second late-convergence observation; and
- per-miss auth capture, terminal-auth fact, outbox status, React readiness and
  rendered table state, provider/client resource counts, transport snapshot
  versions, server subscription count, scheduler counters, coalescer counters,
  watermarks, and recent diagnostic counts.

Both arms used one open connection per principal. Provider/server subscription
counts were exactly 6/12 in the independent arm and 1/2 in the relational arm.
The same generated manifest, binary, sessions, rows, mutation, and observation
logic were used; only the query composition changed.

### Retained characterization and deterministic gate

The initial retained run produced this characterization for six authenticated
writes per arm. The exact miss count is load-sensitive evidence, not the test
invariant:

| Fact | Six independent references | One relational reference |
|---|---:|---:|
| 15-second post-settlement misses | 6/6 | 0/6 |
| Mutation settlement | 0.460–4.560 s | 0.252–0.735 s |
| Post-settlement convergence | 18.874–33.854 s | 1.027–1.689 s |
| Total write-to-convergence | 21.806–34.314 s | 1.434–2.123 s |
| Completed scheduler turns | 72/72 | 12/12 |
| Abandoned scheduler turns | 0 | 0 |
| Cumulative scheduler-turn time | 32.319 s | 4.542 s |
| New `SNAPBACK_LIVE_OVERLOAD_DEGRADE` diagnostics | 44 | 0 |
| Incoherent React renders, Alice | 25/40 | 0/9 |
| Incoherent React renders, Bob | 29/43 | 0/10 |

An independent review rerun observed 2/6 independent-reference misses rather
than 6/6 and correctly rejected the old exact-count assertion. That variance is
consistent with LLP 0200's capacity equation: host-dependent evaluation cost
changes how many writes cross 15 seconds. The revised gate asserts the stable
mechanism instead:

- at least one independent-reference write misses the 15-second ceiling, while
  the relational control has zero misses;
- every miss has settled authenticated custody, non-terminal auth, live/current
  React query states, unpaused live providers, open sockets, all 12 server
  subscriptions, and concrete per-reference snapshot versions;
- the fixture has no outbox-capable store (`outbox.supported: false`), every
  settled-only Familiar mutation fulfills, and authorization-suspension count is
  derived from captured mutation outcomes rather than written as a literal;
- the independent arm records overload conversion while the relational control
  does not; and
- the scheduler performs exactly 72 finished, zero-abandoned turns for the six
  references versus 12 finished, zero-abandoned turns for the relational
  reference, after which every reference converges.

The harness now refuses a stale configured runtime: the shared launch ladder
must return a `verified` current-source identity, and the receipt retains the
selected binary's SHA-256 digest.

The immediately preceding 12-write characterization repeated the shape at
larger N: 12/12 independent misses versus 0/12 relational misses, 98 versus 0
new overload diagnostics, and 31.689–42.361 s versus 2.964–4.917 s total
convergence. This also falsifies a one-off route/UI explanation for the live
delay.

The original observation bundled two other application-level effects with the
composition bound:

- Familiar `useMutation` is the settled-only `queue: false` path (LLP 0253
  §6.3), and this fixture intentionally installs no RQS/outbox store. The frozen
  app's unhandled
  `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` rejection and the resulting Expo
  overlay remain separate authority-transition evidence owned by the related
  guide/state-matrix work; they did not reproduce here.
- Independent references are independently versioned. Consuming partial
  readiness as one atomic UI state produced the frozen app's false controls;
  this fixture directly recorded the same transient disagreement. The
  relational reference removed it because one snapshot contains all six
  relations.

### Mechanism decision and outstanding exit

No runtime/client mechanism is implemented in this lane. Parallelizing turns,
changing scheduler capacity, or inventing a Familiar-only consistency promise
would modify LLP 0200's global scheduling and overload contracts. The current
bounded mechanism is the one the benchmark discovered: compose route-atomic
state into one bounded relational reference, or gate controls until every
independent reference reaches the required application revision.

Polling `/inspect` is not an application mechanism and does not meet Wanted #4.
The open D0.5/W4 decision packet at
`issues/closed/20260821-provider-connection-subscription-budget-decision.md` owns the
supported independent-versus-aggregate envelope and the diagnostic emitted
before that envelope is exceeded. The accepted W5 design packet at
`issues/closed/20260821-app-boundary-runtime-cost-diagnostics-design.md` owns
the bounded/redacted application projection; its client implementation is
tracked by `issues/20260822-client-runtime-cost-and-delivery-inspection.md`.
That implementation should carry the decided subscription-scoped
pending/overload or convergence state to `useQueryState` and provider
diagnostics while preserving LLP 0200's
latest-value, fail-closed, refresh-obligation, and typed-teardown semantics.

This ticket remains open until that client-visible diagnostic is implemented
and an acceptance test proves it arrives before the first inconsistent or
suspended UI observation. LLP 0200 §2.5 calls the stale marker future protocol
surface, so the classification harness cannot truthfully claim that exit by
observing the server's existing overload fact after a miss.

## Fix-round correction (2026-08-25)

The five-second warning did not meet Wanted #4. Each subscription can publish
its authoritative rows as soon as that subscription's delivery callback runs,
so one reference can become visible while its siblings still hold the prior
revision, before a commit-relative five-second timer fires. The unit test
instead held every reference stale, fired the timer, and appended a synthetic
inconsistency marker afterward; that callback ordering was not evidence about
the real publication path.

The threshold also did not distinguish overload from healthy convergence.
LLP 0200 §2.5 bounds *delivery start* at `max_hold` plus one in-flight turn and
allows end-to-end convergence to extend by a `max_eval_turn` plus transport
while demand remains within capacity. A healthy subscription can therefore be
uncovered at exactly five seconds. The timer producer, its diagnostic code,
and the synthetic tests were retracted in this fix round rather than ship a
false-positive warning or preserve an invalid closure claim.

Wanted #4 remains open. A future solution must either observe and warn at the
actual pre-publication boundary without treating ordinary independent
publication as overload, add an application-visible protocol state that
distinguishes owed/overloaded work, or deliberately gate a defined atomic
composition surface. It must include a real-path regression that records the
diagnostic before the first partial UI publication and a protocol-compliant
within-capacity control that stays silent.

### Verification record

#### 2026-08-21 classification

- `scripts/bootstrap-ibex-runtime` — passed on the final rerun by reusing the
  exact-current-revision, digest-bound readiness receipt. An earlier
  review-reconciliation attempt linked but timed out during the launch probe
  while other worktrees were compiling; `scripts/ibex-doctor` found the
  runtime inputs and Hermes loader artifacts healthy.
- `target/debug/snapback runtime-qualify` with dynamic-loader overrides
  scrubbed — passed the restricted no-eval handler-VM probe and reported
  commit `201f74e9c562ccbb729767ff4a0e7ce29e662ed3`, `gitDirty: false`.
- Familiar fixture codegen smoke — passed inside the acceptance harness; only
  the repository's known pre-0264 table-write posture advisories were emitted.
- `node --check tests/acceptance/familiar-six-subscription-contention-v1.mjs`
  — passed.
- `node tests/acceptance/familiar-six-subscription-contention-v1.mjs` — the
  original 6/6 exact-count gate passed once, then failed under independent
  review with 2/6. The corrected mechanism gate passed with 5/6 independent
  misses versus 0/6 relational misses, 47 versus 0 overload conversions,
  72 versus 12 finished scheduler turns, zero abandoned turns, all 12
  mutations fulfilled, and zero authorization suspensions. The server identity
  was `verified`; the receipt recorded SHA-256
  `63ff2fa3331c953641f638789406471b7b7cf959f4190f530890208f6aa6a501`.
- `./ref-check --verbose` — passed: 296 LLP documents, 5,982 references in
  11,216 files, zero errors and zero unchecked references.
- `node scripts/check-inventories.mjs` — ran and stopped on inherited inputs
  outside this lane: absent generated demo/Contract guide snippet artifacts
  and the existing `@expo/snapback-expo` `module.exports` require-export parity
  errors. This lane does not touch the guide, those demos, or that package; the
  command emitted no contention-fixture registration error before the
  `guide-manifest` failure.
