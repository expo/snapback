# public-dashboard offline acceptance: outbox phase red on main (4/9)

**Status:** Resolved
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

The client now persists the latest answered `offline_mutation_replay` fact
through ordinary successful query/live-query lifecycle, bound to canonical
origin and the target's served artifact generation. Generated mutation
references must match that exact generation; string-named mutations carry no
generation and therefore match the cached fact on canonical origin. A
`queue: 'auto'` enqueue probe that loses transport may reuse that matching
prior positive only to enqueue directly, without a foreground mutation POST;
any answered successor manifest or HTTP error replaces it. Replay always
requires a fresh positive inspection, so 404/502 responses and transport loss
refuse before mutation POST. Focused tests guard the HTTP, replay, relaunch,
cross-context replacement, origin, and generated-reference identity boundaries.

The demo acceptance is again un-prewarmed: it closes the online client, stops
the backend, then creates the offline client. The fact acquired by normal
online use survives in the default durable store. After restart it relaunches
the direct/headless client from the new server kit options, preserving the
durable outbox while rotating the per-boot dev-identity capability required by
LLP 0262. This avoids presenting stale identity custody and exercises default
drain from the durable store.

Fail-first evidence: the focused client test failed without the client change
with `SNAPBACK_CLIENT_REFUSED: fetch failed` (`tests 1`, `pass 0`, `fail 1`).
The original acceptance reproduced at `FAIL ... — 4/9` before the fix.

Round-3 verification (2026-08-25):

- `node --test packages/snapback-client/outbox-store.test.mjs`: `tests 94`,
  `pass 94`, `fail 0`. The same run names the new focused cases:
  broker-unavailable negative plus IndexedDB writer handoff, migrated retained
  live query reconnect plus public capability settlement and later offline
  queueing, cached-evidence `SNAPBACK_OUTBOX_NOT_WRITER` with no POST, and
  in-process file peer-negative routing.
- `SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback" node
  demos/public-dashboard/tests/acceptance/offline-local-first.mjs`: `PASS
  public-dashboard / offline-local-first (JS arm) — 9/9`. The first check now
  awaits `whenOfflineMutationReplayCapabilitySettled()`; it no longer polls
  internal RQS metadata.
- `SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback" node
  demos/public-dashboard/tests/acceptance/headless.mjs`: `PASS public-dashboard
  / headless — 6/6`. Both demo runs used the existing qualified binary stamped
  at `f446d966b`; the explicit override reported the expected stamp mismatch
  against JS-only HEAD and did not build a runtime.
- `node scripts/check-guide.mjs`: `21 passed, 1 failed, 0 skipped, 0
  preconditions; 157 pages, 1872 snippets, 174 routes + 51 host-ops joined, 94
  warnings`. Symbol registry, guide corpus, manifest/MCP, and flat projections
  pass. Only the diagnostics-registry freshness check is red: the round-3
  `index.mjs` line shifts require the supervisor-owned diagnostics regeneration
  and `SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` union fix, deliberately excluded
  from this lane.
- Regenerated projections: `guide/reference/registry.json` and its 57 Markdown
  symbol projections; `guide/guide-manifest.generated.json`; and the changed
  global, reference, and sync flat guides. The diagnostics registry JSON and
  Markdown were restored unchanged to `HEAD` before rebuilding the guide
  projections.
- `./ref-check --verbose`: `311 LLP docs, 6636 refs in 12503 files, 0 errors,
  0 unchecked`.
- `git diff --check`: no output (pass).
