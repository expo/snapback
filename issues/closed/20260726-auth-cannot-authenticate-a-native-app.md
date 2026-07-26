# Improvement: the only shipped auth provider cannot authenticate a native app

**Status:** Resolved 2026-07-26 · **Kind:** improvement (product gap) · **Filed:** 2026-07-26
**Blocked by:** LLP 0045 (notifications outbox), Draft
**Evidence:** `demos/partitime/SPEC.md` §4b, `demos/partitime/native/*/NOTES.md`

## What

Snapback's only shipped auth provider is email + one-time code, and its only
delivery mechanism is a **process-local capture mailbox** gated to
`Dev`/`Test`/`Demo` profiles (`src/auth/provider.rs`, `permits_capture`).

Reading that mailbox requires an admin token **plus** a process-bound
impersonation capability that exists as a file next to the server's ready-file.
An app running on a phone can hold neither. Verified from a device during the
Partitime build:

```
GET /auth/mailbox               -> 404
GET /_snapback/api/auth/mailbox -> 403
```

There is no email or SMS delivery anywhere in the product, and no OAuth/OIDC
provider. So **there is no path by which a real user of a real native app can
obtain a code**, and therefore no path by which they can sign in.

## What the matrix did instead

Every native cell (SwiftUI, Compose, Flutter iOS, Expo iOS/Android, Exact
macOS/iOS) signed in through a **password edge built for this experiment** — a
server-side component that owns passwords with scrypt, holds the admin
credentials host-side, drives the real handshake, and hands the client a genuine
Snapback bearer.

That edge is a demo scaffold, not a Snapback feature. It is documented as such
in `demos/partitime/backends/snapback/CLIENT.md` §3 and `SPEC.md` §4b so nobody
mistakes it for shipped capability.

## Why this is worth a ticket rather than just a known gap

The gap is usually described as "real delivery is LLP 0045, still Draft," which
frames it as a missing *convenience*. It is stronger than that: **sessions-mode
auth is currently unreachable from any client that is not co-located with the
server process.** That includes every phone, every browser on another machine,
and every hosted deployment (Cloudflare has `supportedAuthModes: ["dev"]` and
registers no `/auth/*` routes at all).

## Proposed

Any one of these unblocks it; they are not exclusive:

1. Land a prod-capable delivery provider (LLP 0045).
2. Specify a sanctioned external-identity-broker seam — a supported way for a
   server-side component to mint a session, which is exactly what the demo edge
   improvises today.
3. Ship a password credential.

Related: `20260726-snapback-client-cannot-carry-an-external-bearer` — option 2
is only useful if the client can then carry the resulting bearer.

## Resolution

Option 2 is now the sanctioned local dev/test/demo bridge. LLP 0045 and
LLP 0096 define a trusted server-side identity broker as a separate
session-entry seam: the broker owns AdminWrite plus the process-bound
impersonation capability, invokes the existing `auth.mintSession` host
operation, and releases the genuine bearer only to the user it authenticated.
`guide/auth/native-apps.md` documents the security boundary and explicitly
does not claim production delivery or hosted support.

The first-party JS and Swift clients now adopt the resulting bearer with the
exact auth protocol offers, so the bridge no longer requires a hand-written
protocol client. Production delivery under LLP 0045 remains a named gap rather
than being implied by this resolution.
