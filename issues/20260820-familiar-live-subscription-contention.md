# Investigate Familiar React degradation with six concurrent live subscriptions

**Status:** Open
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
