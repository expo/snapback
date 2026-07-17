# Validate an agent credential before destructive custody replacement

**Status:** Closed
**Severity:** P1
**Systems:** Agent auth, JavaScript client, Durable replay
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0055 §Grant-backed live and queued replay
**Marker:** security, durability, recovery

A fresh durable `AgentAuthorityFence` whose configured tuple differs from the
settled custody record can currently advance and clear the predecessor during
`synchronize()` before `/auth/session` proves that the configured bearer and
service descriptor are valid. A typo or revoked bearer can therefore destroy
locally retained work without ever establishing successor authority.

The same ordering is required for a live `replaceAgentCredential(...)` call:
the proposed carrier must be treated as a narrow handshake offer, not as
custody authority, until its exact service descriptor is proven.

**Done when:**

- Plain synchronization cannot replace a mismatched settled tuple or recover a
  clearing successor without a validated service-principal descriptor.
- The client can offer the configured carrier for a strict handshake while
  durable publication remains closed.
- Only an exact descriptor proof enables initialization/replacement/recovery;
  invalid handshakes leave the predecessor custody record byte-for-byte intact.
- Tests cover invalid and valid live replacement, a mismatched invalid restart,
  and successful validated recovery.

## Resolution

Closed 2026-07-16. Commits `ece6fc4`, `cbadaf5`, and `d4fcfaf` keep replacement
publication closed until an exact `/auth/session` descriptor validates the offered
carrier in `agent-authority.mjs`; custody and client tests cover invalid/valid live and
restart cases.
