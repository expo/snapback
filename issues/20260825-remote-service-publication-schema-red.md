# remote_service_publication_is_closed_digest_bound_and_host_private is red on main

**Status:** Open · **Opened:** 2026-08-25 (found during the dk7 path-escape fix)

`cargo test -p snapback --test artifact_schemas_v0 remote_service_publication_is_closed_digest_bound_and_host_private`
panics at `artifact_schemas_v0.rs:~2816` on the current main era — reproduced
identically in the primary checkout and two fresh worktrees, before and after
a fresh `snapback-schemagen` run, so it is a content red, not environment.
Likely a concurrent landing rotated the remote-service publication artifacts
without re-minting the digest binding. Also noted here: the two
`dk7_committed_demo_manifests_*` tests fail only in fresh worktrees
("read capability manifest: NotFound" — a gitignored generated input the
primary checkout has), i.e. environmental, not content.
