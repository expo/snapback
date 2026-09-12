# Snapback 2 live multiplex ignores `lastEventId`

**Status:** Resolved
**Priority:** P2
**Date:** 2026-09-11
**Systems:** `snapback2/crates/snapback2/src/serve_live.rs` (`update`), `packages/snapback2/src/live.ts`, `client.ts`
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1002 §4 (SSE deliveries); Clique reconnect rematerialization

## Symptom

The client multiplex control sends `lastEventId` per child (`live.ts`, `client.ts`). The test fixture forwards it onto `Last-Event-ID`. The real owner `update()` never reads `lastEventId`. Grep of `snapback2/crates` finds no `Last-Event-ID` / `last_event` handling at all, including `GET /api/subscribe`.

Every reconnect is a full `Subscribe` re-execution. For replaceable query snapshots that is not lost rows, but it is a full rematerialization of every mounted child (up to 256) on every transport blip, and it is why the mock-owner Last-Event-ID test cannot speak for production. Combined with `subscribeRegular` `onLoss` publishing `hydrating` when there is no offline runtime, reconnect looks like identity/data flicker.

## Evidence

`serve_live.rs` `update()` walks `add` / `remove` and calls `handle.subscribe(...)`. It does not read `entry["lastEventId"]` or the `Last-Event-ID` header.

## Proposed

Pick one and make tests match production:

**A. Snapshot-replaceable (cheaper, likely correct for today’s queries).** Document that multiplex live always sends a fresh snapshot. Drop `lastEventId` from the client control payload. Skip / rewrite the Last-Event-ID test so it does not run against a mock that the owner does not implement. Avoid `hydrating` on reconnect when the last receipt is still valid (`client.ts` `onLoss`).

**B. Honor `lastEventId`.** On control-add, if the child’s last seq is still the live slot’s `last_seq` and the receipt digest matches, send nothing (or an `unchanged` frame) instead of re-executing. Needs a writer API that is not “always subscribe from scratch.”

Recommend **A** unless a query kind exists whose SSE frames are incremental rather than replaceable. Today’s live deliveries are snapshots.

## Acceptance

- Production owner and the client fixture agree: either both ignore resume (and tests say so) or both honor `lastEventId`.
- Reconnect of 50 mounted queries does not publish `hydrating` for each child when an offline runtime holds a last receipt (related: [session expiry viewer](./20260911-snapback2-session-expiry-drops-restoring-viewer.md)).
- No claim that `Last-Event-ID` is implemented until B lands.

## Resolution (2026-09-12)

Selected A: live reconnect replaces query snapshots. Client control payloads and fixtures no longer transmit an unsupported resume event id. On transport loss a held snapshot remains visible as stale instead of reverting to hydrating; existing offline custody behavior remains. Guide/LLP1002 state fresh snapshot semantics. The affected client suite passed 96 tests, including the rewritten reconnect/fixture contract; no Last-Event-ID replay is claimed.
