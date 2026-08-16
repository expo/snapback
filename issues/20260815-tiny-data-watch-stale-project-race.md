# `db.watch` overlapping `project()` can overwrite an auth denial with a stale page

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Tiny data surface, Client SDK, React `useQuery`
**Date:** 2026-08-15
**Governing:** LLP 0255 S8 (query state), LLP 0053 (authorization invalidation)
**Related:** `issues/closed/20260716-blank-live-state-on-terminal-auth-loss.md`
(the inverse: blanking on loss; this ticket is loss being undone)
**Found while:** Whole-codebase security/correctness review (2026-08-15)

## Problem

```530:573:packages/snapback-client/data-client.mjs
    const project = async (rows = liveHandle?.rows, detail = {}) => {
      const writes = await pendingWrites(descriptor);
      if (disposed) return;
      ...
      if ((denial?.diagnostic?.code ?? denial?.code) === 'SNAPBACK_AUTH_REQUIRED') {
        publish(blockedQueryState({ handle: projectedHandle, pendingWrites: writes }));
        return;
      }
      ...
      publish(queryState({
        handle: projectedHandle,
        data: pageFrom({ rows, cursor: liveHandle?.cursor ?? null }),
        pendingWrites: writes,
      }));
    };
    ...
      onUpdate(rows, detail) {
        void project(rows, detail);
      },
      onConnectionChange(connection, detail) {
        void project(liveHandle?.rows, { ...detail, connection });
      },
```

`project` is async (always awaits `pendingWrites`) and has no generation
token. Each live callback starts another `project`. An older in-flight
call can finish last and `publish` stale rows / connection /
`pendingWrites`.

Worse: a snapshot started **before** `authorization_denied` still holds
the previous `rows` in its closure. If it completes after the denial
project, it overwrites `blocked` with `ready` and the last authorized
page. `db.useQuery` (`packages/snapback-react/data.mjs:48-53`) is this
watch.

`dispose` only skips publishes after the await; it does not cancel older
projects.

## Related S8 gaps (same owner, same file)

File these as the same landing unless they split cleanly:

1. **`pendingWrites` is not live.** Watch never `subscribeOutbox` /
   `subscribeMutation`. For withheld/unavailable prediction, the live
   handle does not move, so `pendingWrites` stays `[]` until some
   unrelated query event. S8 requires intersecting unresolved intents on
   every non-`skipped` arm.
2. **Settled writes never leave `pendingWrites`.**
   `__dataPendingWrites` keeps every non-refused settled data record
   until ACK piggyback removes it. There is no comparison to this
   watch's receipt frontier, so a successful `transact` can stay in
   `pendingWrites` forever if the user does not mutate again.
3. **`observe()` fail-closed too hard.** The first `mutationStatus`
   throw permanently `settleReject`s `handle.settled`
   (`data-client.mjs:316-318`). S7.3: `settled` rejects only when
   observation is irrecoverably unavailable. `unknown` status never
   terminalizes `db.transaction(intentId).settled` either.

## Desired outcome

Monotonic project generation: ignore completions with
`generation < current`. Treat authorization denial as a barrier that
older row-bearing projects cannot cross. Subscribe to outbox changes
and drop settled writes once this materialization observes the receipt
frontier. Transient `mutationStatus` errors retry; only irrecoverable
observation failure rejects `settled`.

## Acceptance

- A snapshot `project` started before `authorization_denied` cannot
  republish `ready` after the denial.
- Two rapid `onUpdate`s publish in event order (or the later event
  wins; never the earlier).
- `transact` appears in `watch` `pendingWrites` without a live-query
  event, and leaves after this watch observes the committed page.
- A single transient `mutationStatus` throw does not reject
  `handle.settled` if a later observe succeeds.
