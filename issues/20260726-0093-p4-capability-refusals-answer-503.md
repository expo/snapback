# 0093 P-4 spec defect: permanent capability refusals answer HTTP 503, inviting exactly the retry storm LLP 0096 forbids

**Opened:** 2026-07-26
**Source:** LLP 0093 D4 clean-room discipline (P-4 Kotlin client build, `clients/kotlin`).
**Systems:** Auth, Wire Protocol, Client SDK, HTTP surface

## The defect

Both sessions-mode profile refusals answer with **HTTP 503**:

```
POST /connection/open           -> 503 SNAPBACK_AUTH_POLICY_UNAVAILABLE
POST /live/{name}/subscribe     -> 503 SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED
POST /live/{name}/unsubscribe   -> 503 SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED
```

These are **client-side offer defects** — the caller failed to send a required
protocol offer header. They are permanent until the client changes its own
behavior; no amount of waiting fixes them.

503 is the one status code whose whole meaning is "transient, retry later".
Every mainstream HTTP client stack (OkHttp interceptors, Retrofit, Ktor's
`HttpRequestRetry`, `URLSession` retriers, gRPC-style backoff wrappers) ships
retry-on-5xx as a default or near-default. A Kotlin/Android client assembled
from ordinary parts will therefore retry-storm a permanent misconfiguration.

That directly contradicts LLP 0096 §2.1's own conformance obligation:

> surface an axis refusal as a structured capability diagnostic (LLP 0064's
> compatibility-refusal discipline), **never a blind retry**

The spec asks clients not to retry while the transport-level signal tells them
to. And neither LLP 0096 §2.1/§2.2 nor LLP 0094 §0E states the status code at
all, so a clean-room implementer cannot even discover the hazard from the
documents — only by making the call.

For contrast, LLP 0094 §0E does pin status codes for its four negotiation
refusals, all **400**, and `SNAPBACK_AUTH_INVALIDATION_NAMESPACE_REQUIRED` (a
sibling refusal on the same route) is also 400. The 503s are the outlier.

## Cost

~5 minutes to notice, 0 to work around (this client does not auto-retry). The
cost is latent and lands on the next implementer who does.

## Fix wanted

1. LLP 0096 §2.1–§2.4 state the HTTP status of every profile refusal, and
   LLP 0094 §0E registers `SNAPBACK_AUTH_POLICY_UNAVAILABLE` and
   `SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED` alongside the negotiation
   codes.
2. Author decision on the code itself: a missing client offer is a client
   defect and reads as **400/412**, not 503. If 503 is deliberate (e.g. the
   same code also covers "server readiness item not yet unlocked", which
   genuinely is transient), then the two cases need distinct statuses —
   otherwise no client can tell "you are misconfigured" from "come back
   later", which is precisely the distinction the retry rule depends on.
