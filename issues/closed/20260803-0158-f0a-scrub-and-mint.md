# 0158 F0a: identity scrub-and-mint + credential negative corpus

**Opened:** 2026-08-03. **Source:** LLP 0158 §Design sketch
(scrub-and-mint; OQ9 decided: same-appId derived deployment). **Depends
on:** custody schema sweep ticket.

One transactional operation over the custody manifest: terminate/delete
copied sessions and token families; revoke copied agent
credentials/grants/verification codes; rotate the auth-stream
incarnation (`rotate_authorization_version_in`,
src/storage/auth_stream.rs) AND the data-version-stream identity
(`rotate_data_version_stream_in`, src/storage/auth_invalidation.rs);
invalidate parent-signed asset URLs (signing-key rotation and/or the
assets_cut lifecycle-generation bump); mint fresh sidecars into the
fork's own directory; write the fork lineage stamp. User records
(`_auth_identities`) are retained as data (OQ9 residual default).

Negative corpus (all presented to a minted fork, all must be REFUSED):
parent session token, parent agent credential, parent resume token,
parent search cursor, parent admin token, parent-signed asset URL.

Key code facts from the loop: sessions/agent tokens resolve by unkeyed
SHA-256 hash lookup against cloned rows (src/auth/crypto.rs
`hash_bearer`; src/auth/session_projection.rs) — rotation alone does NOT
invalidate them; resume tokens bind appId + manifest generation +
data-stream identity + the directory-scoped resume keyring and never
consult the auth incarnation (src/rqs.rs; src/local.rs).

## Resolution — 2026-08-03

Landed one clone-local transaction that scrubs copied session, agent,
verification, push, retry, lease, and operational authority; rotates auth and
data streams plus asset signing authority; writes an explicitly
non-promotable lineage; and mints fresh admin, auth, and resume sidecars into
an empty staging namespace. The negative corpus proves parent session/agent
hashes absent and refuses the parent admin token, resume token, search cursor,
and parent-signed asset URL. User and identity rows remain copy-class data.
