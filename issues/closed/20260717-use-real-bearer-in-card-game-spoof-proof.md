# Use a real session bearer in the Card Game body-authority spoof proof

**Status:** Closed
**Severity:** P2
**Systems:** Card Game demo, Acceptance testing, Auth transport
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0058; LLP 0059
**Marker:** acceptance, auth, bearer, body-authority, test-validity

The Card Game acceptance test claimed to send Grace's legacy body authority
beside Ada's valid bearer, but read `bearer` from `AuthCoordinator.settledView()`.
That projection intentionally omits credential material, so the actual header
was `Bearer undefined`. The server still rejected the unsupported body field,
but the test did not prove the advertised authenticated cross-principal case.

**Done when:**

- The spoof request obtains Ada's bearer only through the coordinator's exact
  captured credential accessor.
- The body still names Grace and the server rejects it as
  `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED`.
- No bearer is added to ordinary settled views or test output.

## Resolution

The acceptance proof now captures Ada's current coordinator authority and uses
`credentialFor(capture).bearer` solely to construct the raw transport header.
The body continues to assert Grace's identity, so the existing 400 diagnostic
now proves that a valid authenticated carrier cannot be combined with legacy
body authority.
