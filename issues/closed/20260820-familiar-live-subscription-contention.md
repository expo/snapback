# Investigate Familiar React degradation with six concurrent live subscriptions

**Status:** Resolved — documented composition bound (category b)
**Systems:** React client, live queries, auth invalidation, outbox
**Date:** 2026-08-20/21
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

Related: `issues/20260818-guide-gap-background-writes-during-auth-transitions.md`
owns the authoring recipe for the same suspension code, but not this
multi-subscription investigation.

## Resolution (2026-08-21)

Classification: **(b) documented composition bound**, governed by LLP 0200
§2.5 (cancellation, fairness, and bounded staleness). This is not an auth or
outbox defect, and the observed false controls are not evidence that React
lost hook ownership.

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

### Deterministic evidence

Final retained run, six authenticated writes per arm:

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

At every miss both coordinators were `phase: settled`, both terminal-auth facts
were false, both providers reported ready/current live stores, both sockets
were open, every outbox had `pending: 0` and `blockedReason: null`, and the
transport recorder showed different per-reference snapshot versions. The
server simultaneously recorded the overload conversion. All independent
references eventually converged; none timed out or tore down.

The immediately preceding 12-write characterization repeated the shape at
larger N: 12/12 independent misses versus 0/12 relational misses, 98 versus 0
new overload diagnostics, and 31.689–42.361 s versus 2.964–4.917 s total
convergence. This also falsifies a one-off route/UI explanation for the live
delay.

The original observation bundled two other application-level effects with the
composition bound:

- Familiar `useMutation` is the settled-only `queue: false` path (LLP 0253
  §6.3). The frozen app's unhandled
  `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` rejection and the resulting Expo
  overlay were not queued-outbox congestion and did not reproduce here.
- Independent references are independently versioned. Consuming partial
  readiness as one atomic UI state produced the frozen app's false controls;
  this fixture directly recorded the same transient disagreement. The
  relational reference removed it because one snapshot contains all six
  relations.

### Mechanism decision and owning follow-up

No runtime/client mechanism is implemented in this lane. Parallelizing turns,
changing scheduler capacity, or inventing a Familiar-only consistency promise
would modify LLP 0200's global scheduling and overload contracts. The current
bounded mechanism is the one the benchmark discovered: compose route-atomic
state into one bounded relational reference, or gate controls until every
independent reference reaches the required application revision.

The owning LLP 0200 follow-up should design a client-visible projection of the
existing overload fact: carry a subscription-scoped pending/overload or
convergence-watermark state to `useQueryState` (and provider diagnostics) when
`SNAPBACK_LIVE_OVERLOAD_DEGRADE` fires. Polling `/inspect` is not an application
mechanism. That design must preserve LLP 0200's latest-value, fail-closed,
refresh-obligation, and typed-teardown semantics. LLP 0200 §2.5 currently says
the client-visible staleness signal is future protocol surface, so adding it
here without an owning decision would be scope expansion rather than a bounded
repair.

### Verification

- `scripts/bootstrap-ibex-runtime` — passed exact current-checkout link,
  launch, and restricted no-eval handler-VM qualification. Three earlier
  attempts retained partial target work but hit
  `SNAPBACK_IBEX_RUNTIME_LINK_TIMEOUT` under concurrent clean-worktree builds;
  none reported missing symbols or a runtime failure.
- Familiar fixture codegen smoke — passed; only the repository's known
  pre-0264 table-write posture advisories were emitted.
- `node --check tests/acceptance/familiar-six-subscription-contention-v1.mjs`
  — passed.
- `node tests/acceptance/familiar-six-subscription-contention-v1.mjs` — passed
  with the final state and comparison above. React's deprecated test renderer
  emitted two non-fatal `act(...)` notices during asynchronous connection-state
  publication; live frame delivery itself is instrumented inside `act(...)`.
- `./ref-check --verbose` — passed: 296 LLP documents, 5,982 references in
  11,216 files, zero errors and zero unchecked references.
- `node scripts/check-inventories.mjs` — ran and stopped on inherited inputs
  outside this lane: absent generated demo/Contract guide snippet artifacts
  and the existing `@expo/snapback-expo` `module.exports` require-export parity
  errors. This lane does not touch the guide, those demos, or that package; the
  command emitted no contention-fixture registration error before the
  `guide-manifest` failure.
