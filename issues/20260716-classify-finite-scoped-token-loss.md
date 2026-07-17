# Classify finite scoped-token loss before changing durable custody

**Status:** Open
**Severity:** P1
**Systems:** Agent auth, HTTP diagnostics, JavaScript client, Durable replay
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0055 §Grant-backed live and queued replay, LLP 0059 §Typed terminal auth error
**Marker:** security, durability

Finite `SNAPBACK_AUTH_SCOPED_TOKEN_INVALID` responses collapse ordinary token
expiry, cap eviction, and unknown carrier bytes together with durable grant,
credential-generation, and principal revocation. The client consequently cannot
know whether it should preserve or delete a durable agent queue.

**Done when:**

- Scoped-token resolution classifies the exact cause as `carrier` or
  `durableDelete` without reviving an invalid token.
- The closed classification reaches finite HTTP diagnostics and is parsed
  fail-closed by the client.
- Missing or malformed legacy classification terminates the carrier but cannot
  select destructive durable deletion.
- Tests distinguish token expiry/unknown carrier from grant, credential, and
  principal revocation.
