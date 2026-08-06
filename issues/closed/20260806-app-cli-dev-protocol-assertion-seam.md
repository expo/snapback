# App CLI dev calls lost their protocol-offer assertion seam

**Status:** Resolved
**Opened:** 2026-08-06
**Resolved:** 2026-08-06
**Systems:** App CLI, client auth transport
**Related:** LLP 0062

The served app-CLI journey expected a sessions target to reject the explicit
dev body assertion with `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED`. Instead, the
client omitted the auth-client offer and was rejected earlier with
`SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED`. The isolated journey reproduced
the failure.

## Resolution

The app CLI dev principal now uses anonymous-public offer custody plus a
narrow internal `__allowLegacyDevAssertion` transport seam. That seam requires
anonymous-public custody, retains the explicit dev assertion only for its
intended caller, and leaves ordinary anonymous-public requests stripping all
legacy auth fields. `auth.test.mjs` now asserts both the v1 offer header and
the exact development user carried in the query body.

Verification with Node 24.18.0:

- `packages/snapback-app-cli/auth.test.mjs` — passed
- `tests/acceptance/app-cli-served-journey.mjs` — passed all 20 checks
