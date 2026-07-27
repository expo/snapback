# 0094 §0E gaps a clean-room client hits: an unregistered live code, an unpinned status, and an unstated retention requirement

**Opened:** 2026-07-26
**Source:** LLP 0093 D4 clean-room discipline (P-4 Dart client build).
**Systems:** Wire Protocol, Client SDK, Live Queries

Three small, concrete, independently fixable gaps, all found by driving a
live local server (`demos/todo`, 2026-07-26) from a client written only from
the documents.

## 1. `SNAPBACK_LIVE_RESUME_FUNCTION_MISMATCH` is not registered anywhere

Unsubscribing with the right `subscription_id` but the wrong function name
in the path:

```
POST /live/listTodosOnce/unsubscribe   {"connection_id":…,"subscription_id":"sub_…","auth":{…}}
HTTP 400
{"diagnostic":{"code":"SNAPBACK_LIVE_RESUME_FUNCTION_MISMATCH","severity":"error",
 "subsystem":"realtime",
 "message":"subscription sub_… belongs to listTodos, not listTodosOnce","details":{}}}
```

`grep -rl SNAPBACK_LIVE_RESUME_FUNCTION_MISMATCH llp/ guide/ schemas/`
returns nothing. LLP 0094 §0E's scope clarification carefully enumerates
where `SNAPBACK_LIVE_RESUME_OWNERSHIP` is minted but says nothing about its
sibling. **Fix:** register it in §0E beside the ownership code, with its
HTTP 400 status.

## 2. `SNAPBACK_CONNECTION_TOKEN_INVALID` has no pinned HTTP status, and it is 403

LLP 0094 §0E lists it under "existing codes this spec touches but does not
change" with no status column entry. LLP 0095 T-GRANT-LOSS keys the entire
grant-loss recovery path on it. Observed on the local arm:

| Situation | Status | Code |
| --- | --- | --- |
| no connection token at all | **401** | `SNAPBACK_CONNECTION_TOKEN_REQUIRED` |
| a token the server refuses | **403** | `SNAPBACK_CONNECTION_TOKEN_INVALID` |

A clean-room client that reasonably keys grant-loss recovery on 401 — the
canonical "your credential is bad" status — never takes T-GRANT-LOSS and
instead retries forever against a dead grant. **Fix:** pin both statuses in
§0E (401 required / 403 invalid), the way `SNAPBACK_CONNECTION_SOCKET_REQUIRED`
already has its hosted 409 pinned.

## 3. T-UNSUB understates what must be retained per subscription

LLP 0095 T-UNSUB says a conformant client "**retains the establishing auth
identity per subscription** — discarding it makes demand unreleasable".
True, but incomplete: because unsubscribe/resume route on
`/live/{name}/…`, the client must also retain the **function name**, and
because `supersedes`-resubscribe must reconstruct the original call, it must
retain the **args** too. Item 1 above is the refusal you get for forgetting
the function name; forgetting the args produces a silently *different*
subscription.

**Fix:** T-UNSUB's retention sentence names all three (identity, function
name, args) as the per-subscription retained state, since the paragraph's
whole purpose is telling implementers what they may not throw away.

## 4. The `auth/live` acknowledge path has an undocumented conflict family, and a client cannot tell retryable from terminal

Under ordinary concurrent load — a level-triggered invalidation being
redelivered while an acknowledge is in flight — the acknowledge answers:

```
POST /live/authorization-invalidation/acknowledge
HTTP 409 SNAPBACK_LIVE_STAGE_CONFLICT
"another staged live effect owns the same subscription or obligation precondition"
```

Observed in a normal sessions-mode acceptance run (`demos/rbac`,
2026-07-26), not under stress. `SNAPBACK_LIVE_STAGE_CONFLICT` appears in no
LLP, no guide page, and no committed schema.

It is not alone. `src/server.rs` carries a retry-classification list that
groups it with a whole family a client on the invalidation path will meet:

```
SNAPBACK_LIVE_STAGE_CONFLICT
SNAPBACK_AUTH_INVALIDATION_EXPECTATION_STALE
SNAPBACK_AUTH_INVALIDATION_PENDING
SNAPBACK_AUTH_INVALIDATION_RESOLUTION_STALE
SNAPBACK_AUTH_RESNAPSHOT_REQUIRED
SNAPBACK_AUTH_GRANT_PENDING / _SCOPE_STALE
…
```

The server evidently knows which of these are retryable — that list exists
precisely to classify them. **The client is told nothing.** LLP 0096 §2.2
gives the acknowledge route its obligations (apply-then-ack, quarantine,
bounded retry, manual-retry escalation) but never enumerates its refusals,
so an implementer facing a 409 must guess between:

- retry the same token (correct here — the obligation is still held);
- treat the obligation as discharged (wrong — it silently stays held and
  the frame is redelivered forever);
- escalate to `/manual-retry` (premature — that is for *exhausted* bounded
  retries).

Getting this wrong is not cosmetic: the whole point of the level-triggered
design is that an undischarged obligation is redelivered, so the failure
mode of guessing "discharged" is an infinite loop, and the failure mode of
guessing "escalate" is burning the bounded-retry budget on a transient
conflict.

**Fix:** LLP 0096 §2.2 enumerates the acknowledge route's refusals with
their statuses and, for each, whether the client should retry the same
token, re-apply and re-acknowledge, or escalate. That classification
already exists in the server as a list — publishing it is a
transcription, not a design.

**What the Dart client does meanwhile:** surfaces it as
`SNAPBACK_CLIENT_INVALIDATION_ACK_FAILED` and lets the next redelivery
drive a fresh apply-then-acknowledge. That happens to be correct, but it
is a guess, and it only works because redelivery is unconditional.

## Resolution

LLP 0094 and LLP 0096 now publish the relevant refusal codes, HTTP status
classes, retained-state rules, and invalidation acknowledgement recovery
actions. Server status inventories enforce client-vs-readiness classification.
