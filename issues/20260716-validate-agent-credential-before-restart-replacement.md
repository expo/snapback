# Validate an agent credential before destructive restart replacement

**Status:** Open
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

**Done when:**

- Plain synchronization cannot replace a mismatched settled tuple or recover a
  clearing successor without a validated service-principal descriptor.
- The client can offer the configured carrier for a strict handshake while
  durable publication remains closed.
- Only an exact descriptor proof enables initialization/replacement/recovery;
  invalid handshakes leave the predecessor custody record byte-for-byte intact.
- Tests cover a mismatched invalid restart and successful validated recovery.
