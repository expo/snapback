# snapback run refuses public zero-arg queries against a sessions target

**Status:** Resolved
**Opened:** 2026-08-24
**Resolved:** 2026-08-25
**Systems:** CLI, Auth
**Related:** LLP 0307 (Track Q-a probe, published-0.1.26 finding 4),
`benchmarks/runs/2026-08-24-qa-ports-probe-0126/record.md`

## Problem

On published 0.1.26, `snapback run <publicQuery>` against a sessions-mode
target refuses even public zero-argument queries with
`SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED` (an injected `userId` reaches a path
that rejects body auth). The one-off CLI invocation surface — exactly the
tool an agent reaches for first to sanity-check a query — is unusable
against the default template's auth mode, and the refusal names a
mechanism (`body auth`) the caller never used.

The Q-a probe worked around it via `snapback session mint` +
`createExternalSessionClient`, which is the documented programmatic path
but a heavy substitute for a smoke-check verb.

## Wanted

Either `snapback run` learns the sessions-mode invocation path for public
operations (no auth required → no auth injected), or it refuses with a
diagnostic that names the actual situation ("sessions target; use
`snapback session mint` + …" with the exact next command), not a
body-auth complaint. First option preferred: public operations should be
runnable with zero ceremony.

## Acceptance

- `snapback run` executes a public zero-arg query against a
  sessions-target dev server, or its refusal names the sessions
  situation and the exact working alternative.
- Covered by a CLI test against a sessions-mode fixture.

## Resolution

`snapback run` no longer serializes an absent `--user` as `userId: null`.
It first preserves the established administrative host-op projection; when a
sessions query reaches that projection's scoped secret-read boundary, the CLI
retries through the ordinary anonymous `/query/{name}` route. That route's
served-manifest and function-auth gates remain authoritative, so declared
public queries run with no session ceremony while protected queries still
refuse through the sessions app-auth path.

The native CLI integration fixture runs a declared-public Ibex query against a
sessions-policy server and asserts the anonymous query result. It then invokes
an authenticated query through the same retry path and proves both that the
app route returns `SNAPBACK_AUTH_REQUIRED` and that the protected handler's
execution counter remains zero. The retry predicate remains intentionally
broad because the ordinary `/query/{name}` route is the fail-closed function
auth gate; it cannot mint admin or session authority. The complete
`host_ops_v0` integration file passes all 15 tests.

## Follow-up (2026-08-25)

The native `snapback run` request body now has a direct serialization unit
test: no `--user` omits `userId`, while an explicit user still serializes the
same `userId` string. Request construction uses a typed serializable carrier
whose optional field is guarded by `skip_serializing_if = "Option::is_none"`,
so a future refactor cannot silently restore explicit null body authority.
The regression was confirmed fail-first with `userId: null` (`1 failed`, exit
101), then passed with the omission guard (`1 passed`, exit 0).

## Follow-up fix (2026-08-25)

The first fix's fixture selected the sessions policy but did not install the
fully settled sessions runtime facts that require an auth-client protocol offer
on every online app-data request. The anonymous `/query/{name}` retry therefore
shipped without `x-snapback-auth-client-protocol: 1`; the default React
scaffold correctly refused it with
`SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` and `snapback run` exited 3.

The retry now matches the first-party client's `anonymous-public` request
shape: it sends the v1 auth-client offer with an args-only body and sends no
admin token, bearer, lease, or `userId`. The native fixture now installs a
settled sessions deployment plus session activation readiness, proves the
public command succeeds, and preserves the protected-query
`SNAPBACK_AUTH_REQUIRED`/zero-handler-execution negative. A packaged CLI test
also executes the README's exact public command shape against the generated
default React sessions scaffold. The issue remains closed because the
documented command passes end to end.
