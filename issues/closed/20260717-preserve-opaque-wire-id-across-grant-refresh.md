# Preserve opaque wire id across connection-grant refresh

**Status:** Closed
**Severity:** P1
**Systems:** Client kit, Connection grants, Ephemeral state, Live sockets
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0031 §Connection capability grants; LLP 0034 §2/§4
**Marker:** connection-grant, refresh, opaque-id, collision, mint-only

`SnapbackClient` caches a connection grant under the app's readable label, but
the granted wire id can differ after a collision or under mint-only
containment. Refresh sent the readable label together with the prior wire
token. Server idempotence looks up that token under the requested wire id, so
the mismatched request could not recover the existing grant and minted a
successor instead.

For an ephemeral HTTP subscribe followed by a never-open socket retry, this
could leave the server room registered under the predecessor id while the
socket and client overlay moved to the successor. The client could then claim
a live map whose registration had no delivering socket.

**Done when:**

- The client cache remains keyed by the readable label.
- Refresh re-suggests the prior granted wire id and presents its previous
  token, allowing same-server idempotent reopen when label and id differ.
- A target that legitimately returns a successor id updates the retried
  request and overlay identity before either escapes.
- Failed refresh cleanup deletes the label-keyed cache entry, not a wire-id
  key that was never stored.
- A deterministic collision-shaped token-rejection test proves both request
  bodies and the successful overlay identity.

## Resolution

The grant opener now accepts the local cache label separately from the wire id
suggested to `/connection/open`. First open suggests the label; refresh keeps
that label as the map key but suggests `previous.id` with `previous.token`.
Failure cleanup continues to address the label-keyed cache.

The client error-path suite forces an initial opaque grant, rejects the first
ephemeral subscribe token, returns a distinct successor from refresh, and
proves the refresh request names the predecessor wire id, the retry uses the
successor, and `overlay.grantedConnectionId` records the successful attempt.

Verification on 2026-07-17:

- `node demos/_kit/tests/client-errors.mjs` — passed 73/73.
- `node --check demos/_kit/client.mjs` — passed.
