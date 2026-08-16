# Credentialed HTTP clients still follow redirects (admin, assets, S3)

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Admin client, Asset client, S3 transport
**Date:** 2026-08-15
**Governing:** LLP 0032 S5.D3 (non-redirection of credentialed requests),
LLP 0044, LLP 0062 §4
**Related:** `packages/snapback-client/index.mjs:5119-5142` (the correct fence),
`issues/20260815-ask-push-skip-shared-outbound-floor.md` (push is the same
class on the Rust side)
**Found while:** Whole-codebase security/correctness review (2026-08-15)

## Problem

The headless `SnapbackClient` treats 3xx as a terminal error on any
credentialed request so a proxy/misconfig cannot replay a secret
(`packages/snapback-client/index.mjs:5119-5142`, `redirect: 'manual'`).
Three sibling transports still use the platform default (follow).

### Admin client

`packages/snapback-admin-client/index.mjs:208-226` attaches
`x-snapback-admin-token`, `x-snapback-console-credential`, and
`x-snapback-secret-read-lease`, then `fetch` with no redirect mode. A
307/308 replays those headers to `Location`. `#req` also does unbounded
`res.text()`.

### Asset HTTP / TUS

`packages/snapback-client/assets.mjs:827` defaults `#fetch` to raw
`fetch`. `#json` (937-941) and the TUS HEAD/PATCH loop (1302, 1347) send
`Authorization: Bearer …` and follow redirects. The parent client
already refused this class of failure.

### S3

`src/assets_s3.rs:118-140` builds a default ureq agent (5 redirects, env
proxy) and copies the SigV4 `authorization` header onto the request. A
region redirect, HTTP MinIO, or MITM on `http://` forwards
`Authorization: AWS4-HMAC-SHA256 …`. Operator infrastructure is outside
LLP 0251's *app* egress class, but the secret-exfil shape is the same
one webhooks already closed.

## Desired outcome

- Admin and asset `fetch`: `redirect: 'manual'` (or `'error'`) whenever
  a credential header is present; refuse 3xx with a closed diagnostic;
  cap response body reads.
- S3: `redirects(0)` and `try_proxy_from_env(false)`. Treat 3xx as
  `SNAPBACK_ASSET_STORE_UNAVAILABLE` (or a dedicated redirect-refused
  code), never follow.

## Acceptance

- A 307 on `/_snapback/api/…` does not replay the admin/console
  credential to the `Location` host.
- A 307 on an asset create/TUS PATCH does not replay the session bearer.
- A 302 from the S3 endpoint does not replay SigV4.
- Happy-path admin, TUS, and S3 put/get are unchanged.

## Partial resolution (2026-08-15, JS transports)

`packages/snapback-admin-client/index.mjs` now uses manual redirect handling for
credential-bearing requests, refuses redirect responses with the closed
`SNAPBACK_REDIRECT_REFUSED` diagnostic, and enforces a 64 MiB decoded response
ceiling before JSON materialization. Coverage in
`admin-ui/tests/admin-client-credentials.mjs` proves a 307 never reaches the
named second origin, the body is not read, the oversized-body refusal cancels
the response, and ordinary 2xx projection is unchanged.

`packages/snapback-client/assets.mjs` now applies the same credential-aware
manual redirect posture in its default fetch adapter, JSON route calls, and TUS
HEAD/PATCH loop. `packages/snapback-client/assets.test.mjs` proves create,
resume HEAD, and PATCH each refuse a 307 without bearer replay; the existing
end-to-end custody lifecycles remain green and now assert manual mode on every
credentialed boundary.

Verbatim proof summaries:

```text
admin client credentials: ok
assets.test.mjs passed
```

The Rust S3 half is pending in another lane. `src/assets_s3.rs` was
intentionally not edited, so this ticket remains open.
