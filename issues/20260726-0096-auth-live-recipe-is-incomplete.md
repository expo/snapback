# 0096 §2.2 spec defect: the acknowledge body breaks the casing convention of its sibling live routes, and `duplicate` is an undocumented success outcome

**Opened:** 2026-07-26
**Source:** LLP 0093 D4 clean-room discipline (P-4 **Dart** client build,
`clients/dart`). First non-JS client to complete the `auth/live`
apply-then-acknowledge cycle.
**Systems:** Auth, Wire Protocol, Client SDK, Live Queries

> **Scope note.** The concurrent P-4 **Kotlin** build independently filed the
> two larger `auth/live` gaps, and this ticket does not restate them:
> `issues/20260726-0093-p4-authorization-namespace-undocumented.md`
> (`authorizationNamespace` is required and appears in no LLP) and
> `issues/20260726-0093-p4-authorization-invalidation-state-machine-gap.md`
> (LLP 0095 has no transition for the only envelope an auth-scoped live
> query delivers). Both reproduce exactly here — see the corroboration note
> at the bottom. What follows is what remains once the acknowledge actually
> fires, which needs a client that got past both of those.

## 1. The acknowledge body is camelCase; its sibling live routes are snake_case

```
POST /live/authorization-invalidation/acknowledge
  {"connectionId":"conn_…","ackToken":"ack_…"}    -> 200 {"outcome":"discharged"}
  {"connection_id":"conn_…","ackToken":"ack_…"}   -> 400 SNAPBACK_REQUEST_JSON_INVALID
```

`/live/{name}/subscribe` and `/live/{name}/unsubscribe` take
**`connection_id`**. The acknowledge route — same subsystem, same
connection, adjacent path, reached in the same code path — takes
**`connectionId`**, and `AuthorizationInvalidationAckInput` is a **closed**
decoder (LLP 0094 §0C.1), so the wrong spelling is a hard refusal rather
than a silently-ignored member.

The `src/live_wire.rs` "mixed by lane" rule does not cover this: these are
two HTTP request bodies on the same lane, in the same feature. Nothing in
LLP 0094 §0E, LLP 0096 §2.2, or the committed schemas flags the switch, and
`/manual-retry` presumably shares it.

**Fix:** LLP 0096 §2.2's "Routes owned by the claim" bullet states the body
casing for both acknowledge routes. Changing the wire is breaking;
documenting it is free.

## 2. `duplicate` is a success outcome and is documented nowhere

The invalidation frame is **level-triggered and redelivered until
acknowledged**, so a redelivery routinely races an in-flight acknowledge. On
the second presentation of the same token the server answers:

```json
{"outcome":"duplicate"}
```

not an error. That is exactly right — an idempotent ack is what makes
level-triggered delivery safe — but a client author sees a non-`discharged`
outcome and has no document telling them whether the obligation is held or
released. My harness initially failed on it, and the wrong reaction
(re-apply, or escalate to manual-retry) is available and plausible.

Observed in every run: because the client acknowledges promptly after
applying, the redelivery that was already in flight produces `duplicate`
more often than `discharged`.

**Fix:** LLP 0096 §2.2 enumerates the acknowledge outcomes and states that
`duplicate` discharges — one sentence beside the existing
"acknowledge-after-apply" obligation.

## Resolution taken in the Dart client

camelCase body; `discharged` and `duplicate` both treated as discharge.
Proven by `clients/dart/bin/prove_sessions.dart` (17/17 against
`demos/rbac`).

## Cross-language corroboration (worth more than either report alone)

Two clean-room clients were built independently on 2026-07-26 — Kotlin
(`clients/kotlin`) and Dart (`clients/dart`) — with no contact between them.
Both hit, in the same order:

1. `/connection/open` refusing without the `auth/rr` offer despite its
   "Public" label (`…-p4-connection-open-auth-rr-gate.md`);
2. `SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED` with no documentation of
   the field or its members (`…-p4-authorization-namespace-undocumented.md`);
3. the camelCase-inside-a-snake_case-envelope decode failure
   (`…-p4-live-envelope-casing-exception.md`);
4. `authorization_invalidation` having no state-machine transition
   (`…-p4-authorization-invalidation-state-machine-gap.md`);
5. T-UNSUB's dev-mode-only recipe hard-failing in sessions mode
   (`…-p4-sessions-mode-unsubscribe-body-auth.md`).

Independent rediscovery by two implementers in two languages is the
strongest available evidence that these are properties of the documents
rather than of one reader. They should be prioritised accordingly.
