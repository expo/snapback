# 0093 P-4 spec defect: `supersedes` is an open-decoder capability field with no response witness

**Opened:** 2026-07-26
**Source:** LLP 0093 D4 clean-room discipline (P-4 Dart client build).
**Systems:** Wire Protocol, Client SDK, Live Queries

## The defect

`supersedes` is the mechanism LLP 0095 T-RECONNECT makes mandatory:
"reconnect is **fresh subscribe with `supersedes`**, never implicit
resumption". It rides `LiveSubscribeInput`, which LLP 0094 §0C.1 keeps
**open** — with this stated mitigation:

> the silent-feature-off hazard is accepted and mitigated by response
> witnesses (`resumeRefusal` is the existing example: an ignored capability
> field must have a response-visible echo or refusal so the client can
> detect feature-off)

`supersedes` has no such witness. Probed against a live local server
(`demos/todo`, 2026-07-26) — a subscribe carrying
`"supersedes": "sub_019f9d41249174c0950804878929c02c"`:

```json
{"subscription_id":"sub_019f9d4124f87b009eed151a69b61215",
 "permission_epochs":{"user:user_ada":0},
 "receipt":{"kind":"subscription","event":"established",
            "subscriptionId":"sub_019f9d4124f87b009eed151a69b61215",
            "scope":{},"snapshotVersion":11,"correlation":null,
            "receivedAtMs":1785049720056}}
```

Byte-identical in shape to a subscribe with no `supersedes` at all. Nothing
says the named predecessor was disposed.

`Receipt::Subscription` already carries a `supersededBy` member
(`src/live_wire.rs`), but it is populated on the **disposed** receipt, which
rides the retention ring — not the subscribe response the client is holding.

## Why it matters

The consequence of a silently ignored `supersedes` is the one thing LLP
0093 D2 calls out as billing-visible: **leaked demand**. A client that
reconnects N times leaves N-1 armed subscriptions the server thinks are
live, and the client cannot detect it, cannot release them (it has moved on
to a new id), and only the 120 s idle-TTL crash backstop — which T-REAP
explicitly says is "the crash backstop only" — eventually collects them.

Worse, this is the field most likely to be silently dropped by a
non-first-party arm: the hosted `kitSubscribe` is an open decoder in every
family (§0C.3), so a hosted server that never implemented `supersedes` would
answer success and leak demand invisibly.

## Fix wanted

Add the witness §0C.1 promises. Minimal shape: an additive optional
`superseded` member on `LiveSubscribeOutput` echoing the disposed
predecessor id (and absent when no `supersedes` was presented, or present as
an explicit refusal code when the named subscription could not be disposed).
`LiveSubscribeOutput` is an open object in the server→client direction, so
"additive optional fields are the sanctioned in-v1 evolution" (§0C.2) —
this needs no version token.

Then LLP 0095 T-RECONNECT can state the conformance obligation: a client
that presents `supersedes` and receives no witness must surface a structured
diagnostic rather than assume the predecessor is gone.

## Resolution

Local and hosted subscribe responses now return either an exact `superseded`
witness or a typed `supersessionRefusal`. Schemas and acceptance tests cover
both outcomes.
