# Anonymous-public asset client drops the Sessions auth protocol offer

**Status:** Resolved
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Assets, Auth, Client integration, Testing
**Date:** 2026-08-05
**Governing:** LLP 0044, LLP 0058, LLP 0176 G0
**Related:** `guide/auth/sessions-and-principals.md`, `guide/backend/assets.md`

## Problem

LLP 0176 G0 requires the messaging fixture to prove both sides of the ordinary
upload boundary in settled Sessions mode:

- a `snapback session mint --email` bearer completes reservation → TUS →
  finalize → typed attach → public delivery; and
- the same upload with documented anonymous-public custody reaches the asset
  ownership boundary and refuses 403.

The positive path passes. The negative path currently refuses earlier with
`SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED`, because
`packages/snapback-client/assets.mjs` drops the parent client's
`x-snapback-auth-client-protocol: 1` offer whenever no bearer exists.

`SnapbackClient(baseUrl, { custody: 'anonymous-public', adminToken: null })`
is the documented Sessions-mode anonymous client. Its ordinary request lane
offers auth-client protocol 1 with no credential. The asset client's
`#custodyHeaders`, however, has only three outcomes:

1. authority-fence bearer → bearer plus protocol offer;
2. external bearer → bearer plus protocol offer; or
3. no bearer → `{}`.

Outcome 3 does not distinguish declared anonymous-public custody from a bare
dev-lane client, even though `SnapbackClient` exposes `custody` and
`authProtocols` for this distinction. The Sessions gate therefore rejects the
request before the upload intent's owner/caller check can run.

## Reproduction

Run:

```sh
node demos/messaging-snapback/tests/acceptance/headless.mjs
```

The suite boots generated startup artifacts with `auth.mode=sessions`, resets
the seed, invokes the real CLI session mint through operator-only stdin
custody, and proves the ordinary bearer upload/attach/delivery chain. Its
anonymous check constructs:

```js
const anonymous = new SnapbackClient(baseUrl, {
  custody: 'anonymous-public',
  adminToken: null,
});
const result = await createAssetClient(anonymous).start({
  upload: api.messageImageUpload,
  file: new Blob([png], { type: 'image/png' }),
  declaredContentType: 'image/png',
}).done;
```

Actual diagnostic:

```text
SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED
add the request header `x-snapback-auth-client-protocol: 1`
```

Expected: the asset request carries the anonymous-public protocol offer, has
no `Authorization` header, reaches the asset owner/caller boundary, and
returns HTTP 403 there. The task should remain `failed`; anonymous upload must
not become authorized.

## Code path

- `packages/snapback-client/index.mjs`: the constructor accepts
  `custody: 'anonymous-public'`, selects `authClientProtocol = 1`, and the
  normal request lane emits the offer without a bearer.
- `packages/snapback-client/assets.mjs`: `#custodyHeaders` emits the protocol
  header only inside `bearerHeaders`; its no-bearer fallback returns `{}`.
- The server correctly refuses the malformed Sessions profile offer before
  asset authorization, so this is a client custody-projection defect rather
  than a server ownership defect.

## Acceptance

- Every asset request made by a parent client with
  `custody: 'anonymous-public'` sends
  `x-snapback-auth-client-protocol: 1` and sends no bearer.
- The messaging G0 negative check receives HTTP 403 at the ownership boundary,
  while its minted-session upload remains green.
- Package coverage pins reservation, TUS transfer, finalize, metadata, and
  delivery-adjacent request headers for both external-session and
  anonymous-public custody.
- Bare no-custody dev clients retain their current `{}` fallback; the fix does
  not invent dev identity.

## G0 disposition

This is a known late-discovered contradiction in LLP 0176 G0's required exit
evidence. Do not append the G0 exit receipt or mark the messaging acceptance
suite green until this ticket is resolved and the ownership-boundary negative
passes through the ordinary asset client.

## Resolution (2026-08-05)

Resolved in the shared client projection. `SnapbackAssetClient.#custodyHeaders`
now reads the parent client's declared `authProtocols.authClient` offer and
returns that offer without a bearer when the parent declares
`custody: 'anonymous-public'`. Credential-bearing parents use the same
projection; the compatibility fallback for shallow bearer adapters remains
protocol v1. A parent with neither declared custody nor a credential still
returns `{}`, so this change does not manufacture a dev identity.

The package test extends the existing custody block across reservation, TUS
`PATCH`, finalize, metadata/delivery-adjacent reads, and TUS resume `HEAD`.
External-session requests carry bearer plus offer `1`; anonymous-public
requests carry offer `1` and no bearer; the bare dev read carries neither.
Failed resume `HEAD` requests now retain their HTTP status in the task
diagnostic, matching the existing TUS `PATCH` failure shape.

The real messaging negative deliberately separates the two facts the fixture
can prove without inventing an owner principal: an ordinary minted session
reserves and pauses an attempt, then an anonymous-public asset client resumes
that exact attempt. Its offer passes the Sessions profile gate, its absent
bearer resolves no caller, and the owner/caller comparison refuses HTTP 403.
Package coverage independently pins the anonymous-public reservation header.

Evidence:

- `bun run test` in `packages/snapback-client` — pass.
- `node demos/messaging-snapback/tests/acceptance/headless.mjs` — 11/11;
  minted-session upload/attach/delivery passes and the anonymous transfer
  refuses at HTTP 403 ownership.
