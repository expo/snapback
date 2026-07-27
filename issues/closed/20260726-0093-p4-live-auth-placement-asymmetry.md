# 0093 P-4 spec defect: subscribe and unsubscribe carry the live owner in different places, and getting it wrong is diagnosed as an ownership failure

**Opened:** 2026-07-26
**Source:** LLP 0093 D4 clean-room discipline (P-4 Dart client build).
**Systems:** Wire Protocol, Client SDK, Live Queries, Auth

## The defect

LLP 0095 T-UNSUB (added from the P-2 Swift ledger) tells a client it must
"present the subscription's establishing live owner … the `auth` object of
the subscribe input". It does not say **where** on each body, and the two
bodies differ:

| Route | Where the identity lives | Schema |
| --- | --- | --- |
| `POST /live/{name}/subscribe` | **nested**: `input.auth` (inside `HandlerInput`) | `live.subscribe.input.schema.json` |
| `POST /live/{name}/unsubscribe` | **top level**: `auth` | `live.unsubscribe.input.schema.json` |
| `POST /live/{name}/resume` | **top level**: `auth` | `live.resume.input.schema.json` |

A clean-room implementer who reads T-UNSUB's "the `auth` object of the
subscribe input" literally and mirrors the subscribe shape sends
`{"connection_id":…, "subscription_id":…, "input":{"auth":{…}}}`.

Both bodies are **open decoders** (LLP 0094 §0C.1: `LiveSubscribeInput` /
`LiveUnsubscribeInput` "stays open"), so the misplaced member is silently
ignored. The request then refuses:

```
HTTP 403
{"diagnostic":{"code":"SNAPBACK_LIVE_RESUME_OWNERSHIP","severity":"error",
 "subsystem":"realtime",
 "message":"subscription sub_… is owned by a different live owner",
 "details":{}}}
```

Verified against a live local server (`demos/todo`, 2026-07-26).

"Owned by a different live owner" is the least useful possible message for
"you put the member in the wrong object": it points at authority, not at
shape, and `details` is empty. The implementer's natural next move is to
hunt for an identity mismatch that does not exist.

This is exactly the silent-feature-off hazard LLP 0094 §0C.1 accepts for
open decoders on the promise that it is "mitigated by response witnesses
(`resumeRefusal` is the existing example: an ignored capability field must
have a response-visible echo or refusal so the client can detect
feature-off)". For `auth` placement there is no witness — only a misleading
403.

## Fix wanted

1. **LLP 0095 T-UNSUB states the member paths explicitly** — subscribe:
   `input.auth`; unsubscribe and resume: top-level `auth` — rather than
   "the `auth` object of the subscribe input".
2. Enrich `SNAPBACK_LIVE_RESUME_OWNERSHIP`'s `details` so a shape mistake is
   distinguishable from an identity mismatch (e.g. `presentedIdentity: null`
   vs `presentedIdentity: {...}`; today `details` is `{}`). An absent `auth`
   on an authed subscription is already called out in T-UNSUB as a mismatch
   case — the wire should say which of the two happened.
3. Consider closing `LiveUnsubscribeInput` (it has no capability-evolution
   story of its own, unlike `LiveSubscribeInput`, which stays open for
   `resumeFromToken`). A closed unsubscribe decoder turns this from a
   misleading 403 into `SNAPBACK_REQUEST_JSON_INVALID` naming the unknown
   member.

## Resolution

LLP 0094 and LLP 0096 now specify auth placement for every live route and
mode. Ownership refusals expose the subscription ID and presented/expected
identity relationship without leaking the expected identity.
