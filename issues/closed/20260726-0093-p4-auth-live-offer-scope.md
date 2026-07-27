# 0093 P-4 spec defect: the `auth/live` subscribe-time offer is required more broadly than LLP 0096 §2.2 states, and a client cannot tell which targets need it

**Opened:** 2026-07-26
**Source:** LLP 0093 D4 clean-room discipline (P-4 Kotlin client build, `clients/kotlin`).
**Systems:** Auth, Live Queries, Wire Protocol, Client SDK

## What LLP 0096 §2.2 says

> **Subscribe-time (per subscription):** `x-snapback-auth-invalidation-protocol: 1`
> on `POST /live/{name}/subscribe` **whenever the target is auth-scoped** — a
> live function not proven authority-independent, or a permissioned ephemeral
> collection.

Two operational problems with that sentence, both hit in one sitting.

## Problem 1: a client cannot evaluate the condition

"A live function not proven authority-independent" is a server-side property
of the compiled function manifest. **Nothing on the wire tells a client which
live functions are authority-independent.** There is no field on the subscribe
response, no projection on `GET /auth/session`, and no entry in `/inspect`'s
public projection that a client could key on. The condition is stated as if
the client can evaluate it; it cannot.

Empirically the condition is also broader than the app's own declaration
suggests: the Partitime backend declares `listEvents` with `auth: 'public'`
and the comment "readable anonymously … the result carries no authority", yet
subscribing to it in sessions mode without the header refuses with

```
HTTP 503 SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED
"auth-scoped live work requires the exact authorization-invalidation protocol"
```

The only rule a client can actually follow is **always offer in sessions
mode**. That is a fine rule; it is just not the rule the spec states.

## Problem 2: unsubscribe needs the offer too, and §2.2 does not say so

§2.2 names exactly one subscribe-time carrier route,
`POST /live/{name}/subscribe`. Releasing the same subscription refuses
identically:

```
POST /live/myRsvp/unsubscribe   (bearer + auth/rr offer, no invalidation offer)
HTTP 503 SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED
```

This composes badly with LLP 0095 T-UNSUB, which makes explicit release a
**conformance obligation** with billing-visible consequences: a client that
follows §2.2 literally can create auth-scoped demand it cannot release.

## Cost

~15 minutes total, both diagnosed instantly from the diagnostic code — the
structured refusals are doing a lot of work that the prose is not.

## Fix wanted

- §2.2's carrier bullet becomes: offer on **every** `POST /live/*/subscribe`
  and `POST /live/*/unsubscribe` in sessions mode; state plainly that the
  authority-independence of a target is not client-observable and that
  always-offer is the conformant rule.
- If authority-independence is meant to be client-observable, say where the
  client reads it and add the row to LLP 0094 §0A.1.

## Related

- `issues/closed/20260726-0093-p4-authorization-namespace-undocumented.md` — the
  other undocumented precondition on the same call.

## Resolution

LLP 0096 now requires the auth-client offer on every sessions-mode live
subscribe and unsubscribe request, and publishes the missing/unsupported offer
refusal as a client error rather than a readiness failure.
