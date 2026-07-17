# Scope live grant revalidation to the matched scope entry

**Status:** Open
**Severity:** P2
**Systems:** Agent grants, Live queries, Authorization replay
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0055 §Grants and §Ending authority
**Marker:** correctness, availability

A retained service-principal live query revalidates every scope carried by its
grant, not the exact scope entry that authorized the query.

`resolve_scoped_token` in `src/storage/auth_agent_credentials.rs` retains the
grant's complete scope list in the resolved authority. Function preparation in
`src/auth/invocation.rs` finds the matching function/kind entry but does not
narrow or record it. `prepare_live_rerun_authority` in `src/local.rs` then loops
over every retained scope and terminalizes the subscription if any basis is
stale.

If one grant contains live-query scopes A and B, tombstoning only B therefore
terminates a subscription that uses A. LLP 0055 requires stale entry B to end
B without erasing unrelated authority from the same grant.

**Done when:**

- Prepared/retained live authority records the exact matched scope identity,
  kind, authority-creating bit, and basis.
- Reruns revalidate the token/grant carrier plus that matched scope only.
- A grant with live A and B proves that tombstoning B terminates B while A
  remains live and continues to receive updates.
- Grant-wide revocation, credential rotation/revocation, expiry, and principal
  deactivation still terminate every affected entry.
