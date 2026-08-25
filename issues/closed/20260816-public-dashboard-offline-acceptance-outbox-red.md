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

## Resolution (2026-08-25)

The table-write posture was not the cause. An online `recordMetric` call on
the generated public-dashboard artifacts settled successfully, so LLP 0264's
Phase-1a preservation of pre-existing public-read writes was working.

The client also classified the original `TypeError: fetch failed` as a
connectivity failure correctly. The loss happened at the next safety gate:
after dispatch failed, the outbox path fetched `/inspect` to require positive
settlement-ledger evidence. That probe necessarily failed against the same
offline server, and the client discarded the positive capability manifest it
had already observed. It then surfaced the original
`SNAPBACK_CLIENT_REFUSED` instead of accepting durable custody.

`SnapbackClient.inspect()` now records the latest answered
`offline_mutation_replay` fact. If a later capability probe loses transport,
the gate may reuse a prior positive fact; any answered successor manifest
still replaces it, so a Cloudflare-style explicit capability gap refuses
before replay. A focused client test guards both halves of that rule.

The demo acceptance now observes the target manifest before disconnecting.
After the server restart it relaunches the direct/headless client from the new
server kit options, preserving the durable outbox while rotating the per-boot
dev-identity capability required by LLP 0262. This avoids presenting stale
identity custody and exercises default drain from the durable store.

Fail-first evidence: the focused client test failed without the client change
with `SNAPBACK_CLIENT_REFUSED: fetch failed` (`tests 1`, `pass 0`, `fail 1`).
The original acceptance reproduced at `FAIL ... — 4/9` before the fix.

Verification:

- `node demos/public-dashboard/tests/acceptance/offline-local-first.mjs` with
  the lane's explicit shared runtime/server binary: `PASS ... — 9/9`;
- `node demos/public-dashboard/tests/acceptance/headless.mjs` with the same
  binary configuration: `PASS ... — 6/6`;
- `node --test packages/snapback-client/outbox-store.test.mjs`: `tests 85`,
  `pass 85`, `fail 0`;
- `node --test packages/snapback-client/app-data.test.mjs`: `tests 1`,
  `pass 1`, `fail 0`;
- `./ref-check --verbose`: `311 LLP docs, 6581 refs in 12260 files, 0 errors,
  0 unchecked`;
- `node scripts/check-diary-identity.mjs`: `11 known (baseline), 0 new`.

`node scripts/check-inventories.mjs` remains red on unrelated inherited
repository drift: absent generated sources for `competitive-checkpoint` and
`todo-v2`, plus the pre-existing stale diagnostics-registry chain. Those
artifacts are outside this ticket's exact lane scope and were not regenerated.
