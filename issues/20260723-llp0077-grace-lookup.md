# Sender lookup composes with LLP 0057 tombstone-grace resolution

**Status:** Open
**Severity:** P2
**Systems:** Auth, Storage, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0077 §HTTP binding (grace composition) + defect 3, LLP 0057 (tombstone-grace matrix), LLP 0059 (connection-open current-token-only carve-out), src/auth/sender_proof.rs (sender lookup join), issues/20260723-llp0077-senderauth-program.md
**Marker:** llp-0077, sender-auth, grace

Closes LLP 0077 ledger **defect 3**. Sender lookup joins only the current
`_auth_sessions.token_hash` with no tombstone/grace branch, so a proof-bearing
request presenting an in-grace superseded token is refused before ordinary
resolution — breaking LLP 0057's inclusive ten-second grace matrix, which the
Spec's grace-composition rule promises. LLP 0059's narrower rule (connection-
open accepts only a current token) must be preserved.

**Done when:**

- Sender binding lookup reuses the provider's canonical current/tombstone
  classifier before thumbprint verification, honoring LLP 0057's
  live/revoked/tombstone-grace matrix for ordinary finite requests.
- Connection-open remains current-token-only (LLP 0059 carve-out) — an in-grace
  predecessor cannot mint or renew a grant; a negative test proves it.
- Tests cover current, in-grace (inclusive ten-second boundary), sleeping-tab,
  revoked, and grace-expired states, all under the same durable thumbprint.
- LLP 0077's defect 3 row moves to closed.
