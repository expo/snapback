# 0093 P-4 spec defect: `/connection/open` is documented Public but demands the `auth/rr` offer in sessions mode

**Opened:** 2026-07-26
**Source:** LLP 0093 D4 clean-room discipline (P-4 Kotlin client build, `clients/kotlin`).
**Systems:** Wire Protocol, Auth, Client SDK

## What the documents say

- LLP 0094 §0A.1 gives `/connection/open` the Auth column value
  **"Public (grants, never exercises)"**.
- LLP 0096 §2.7's gate-timing table lists `/connection/open` under
  *"`POST /connection/open` body (open-time)"* carrying `wireVersion` and
  `authInvalidationProtocol` — the two **body** offers. The row for the four
  axis **headers** is "per request (HTTP headers)", and `/connection/open` is
  not called out there.
- LLP 0096 §2.1 scopes `auth/rr` to "every `RouteClass::AppData` route except
  the diagnostic trio `/`, `/health`, `/auth/session` and `/app/ensure`".

A clean-room implementer reads §0A.1's "Public" and §2.7's open-time row and
concludes the open call carries body offers only.

## What is actually true

In sessions mode `POST /connection/open` refuses **without**
`x-snapback-auth-client-protocol: 1`:

```
HTTP 503
{"diagnostic":{"code":"SNAPBACK_AUTH_POLICY_UNAVAILABLE","severity":"error",
  "subsystem":"auth",
  "message":"the request does not offer the exact supported auth-client protocol",
  "details":{"capability":"onlineRequestResponse","minimumAuthClientProtocol":1}}}
```

With the header (and **no bearer at all**) it succeeds and mints the grant.
So the route is "Public" in the credential sense — it never resolves a caller
— while still being inside the `auth/rr` **offer** fence. Both statements are
true; neither document says both.

Reproduced against a local sessions-mode server (the Partitime Snapback
backend's generated artifacts loaded via `--startup-artifacts`).

## Cost

~15 minutes and one failed proving run. Cheap to diagnose only because the
diagnostic names the missing capability precisely.

## Fix wanted

Either:
- LLP 0094 §0A.1's Auth column for `/connection/open` reads
  "Public credential; `auth/rr` offer required in sessions mode", and
  LLP 0096 §2.7 adds `/connection/open` to the per-request-header row; or
- the route is genuinely exempted server-side (it grants, never exercises).

The former matches shipped behavior and costs one table cell each.
## Resolution

The connection-open contract now names the bearer credential and auth/RR offer
as independent requirements. Missing offers produce an actionable client
refusal naming both accepted carriers, with regression coverage.
