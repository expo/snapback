# public-dashboard offline acceptance: outbox phase red on main (4/9)

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Offline outbox, Acceptance testing, Client
**Date:** 2026-08-16
**Related:** issues/20260816-ownership-composition-fixture-wave.md (suspected
same wave), LLP 0043 M2, LLP 0270

## Signature

`demos/public-dashboard/tests/acceptance/offline-local-first.mjs` fails 5 of
9 checks on main — every check in the offline-mutation/outbox-settlement
phase, deterministic:

1. `offline create/update queue durably with client-minted ids` —
   `SNAPBACK_CLIENT_REFUSED: fetch failed` (the mutate surfaces the network
   failure instead of queueing);
2. `a relaunch with pending intent renders retained pre-intent rows...` —
   pending-intent fact expected 2, got 0;
3. `server restart settles the queued intent exactly-once` — timeout waiting
   for current;
4. `duplicate delivery of a settled id` — undefined `clientMutationId`;
5. `fresh client instance after restart` — offline-settled create present
   after relaunch.

The retention-phase checks (default store, refusal boundary, retained
render) pass.

## Bisect evidence (2026-08-16 orchestration session)

Same binary (built at post-2fbe4676f src; the candidate landings are
JS-only), `SNAPBACK_RUNTIME_BINARY` pinned, codegen re-primed per sha:

- `e49e75efc` (docs-only landing; PRE default-drain wave 1, PRE optimistic
  wave 2): **4/9, identical signature** — the red predates both LLP 0270
  client landings.
- `d92e8165a` (post wave 1): 4/9 identical.
- Current retained-lane worktree (wave 3): 4/9 identical.

So the LLP 0270 waves did not introduce it. Prime suspect is the LLP 0264
Phase-1a enforcement landing (`4fe648fd0`) or an adjacent same-day landing —
the demo's mutations (`recordMetric` etc.) are generic writes on the
pre-0264 posture (`SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING` warnings
in codegen), and "fetch failed" surfacing instead of queue custody matches a
server-side refusal changing the client's failure classification. Not
verified further; whoever owns the enforcement-wave burn-down
(20260816-ownership-composition-fixture-wave.md) should fold this in or
bisect the exact commit.
