# `SNAPBACK_AUTH_POLICY_UNAVAILABLE` described the violation without naming the repair

**Filed:** 2026-07-26 · **Source:** Partitime matrix
**Status:** message improved in this change; the class of problem is worth a sweep

## What happened

Omitting `x-snapback-auth-client-protocol: 1` on an app-data route answered:

```
HTTP 503  SNAPBACK_AUTH_POLICY_UNAVAILABLE
"the request does not offer the exact supported auth-client protocol"
```

503 reads as "the server is down", so the reader checks the process, adds
backoff, and re-reads their logs — the one thing the message never says is
"add this header". The Partitime coordinator wrote the warning about this exact
trap for CLIENT.md and then fell into it themselves within the hour, which is
good evidence the wording was at fault rather than the reader.

## Fix applied

```
add the request header `x-snapback-auth-client-protocol: 1`: this request does
not offer the exact supported auth-client protocol (on a WebSocket upgrade,
offer the `snapback.auth-client.1` subprotocol instead)
```

## Worth a sweep

Two neighbours have the same shape and were not touched here:
`SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED` (503; repair is
`x-snapback-auth-invalidation-protocol: 1`) and
`SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED` (400; repair is an
`authorizationNamespace` object, whose three members are documented nowhere a
client author will look). A refusal that a client can only fix by reading
`src/server.rs` should name the repair in the message.

Related: `SNAPBACK_AUTH_RESERVATION_STALE` answers 503 with no `retry-after`,
though it is a routine retryable write conflict — see
`20260726-reservation-stale-is-a-503-without-retry-after.md`.
