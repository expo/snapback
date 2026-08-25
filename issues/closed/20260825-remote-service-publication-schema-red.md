# remote_service_publication_is_closed_digest_bound_and_host_private is red on main

**Status:** Resolved (2026-08-25) · **Opened:** 2026-08-25 (found during the dk7 path-escape fix)

`cargo test -p snapback --test artifact_schemas_v0 remote_service_publication_is_closed_digest_bound_and_host_private`
panics at `artifact_schemas_v0.rs:~2816` on the current main era — reproduced
identically in the primary checkout and two fresh worktrees, before and after
a fresh `snapback-schemagen` run, so it is a content red, not environment.
Likely a concurrent landing rotated the remote-service publication artifacts
without re-minting the digest binding. Also noted here: the two
`dk7_committed_demo_manifests_*` tests fail only in fresh worktrees
("read capability manifest: NotFound" — a gitignored generated input the
primary checkout has), i.e. environmental, not content.

## Resolution (2026-08-25)

The last rotation was `7d1f32b5c` (`feat(graph): LLP 0209 G3 rung 1`), after
the DK-7 path fix in `ecdd3b77e`. It regenerated the tracked review artifacts,
but the publication tuple and ordinary demo manifests are regenerable,
gitignored cache leaves. They therefore remained stale in an existing checkout
and were absent in a fresh worktree. The tests accidentally depended on an
earlier command having populated those caches: the remote test observed stale
digest bindings or a missing profile, and the two DK-7 tests observed missing
manifests.

`artifact_schemas_v0.rs` now invokes the documented codegen commands before
consuming those leaves. Remote-service generation re-mints the complete
digest-bound tuple. The eight DK-7 demo backends regenerate once per test
process with the required outbound-actions profiles, and a shared lock keeps
parallel Rust tests from racing atomic codegen publication. Generator failures
remain hard failures with stable `SNAPBACK_TEST_*_REGEN_FAILED` codes and
captured stdout/stderr.

Fail-first evidence on the fresh lane worktree:

- `remote_service_publication_is_closed_digest_bound_and_host_private` failed
  with a missing `generated-remote-service/remote-service.profile.json`.
- Both `dk7_committed_demo_manifests_*` tests failed with `NotFound` errors for
  ignored generated manifests.

Verification:

- `cargo test -p snapback --test artifact_schemas_v0` — `39 passed; 0 failed`.
- `scripts/check-generated-artifacts` — all registered codegen outputs and
  committed projections current.
- `./ref-check --verbose` — 311 LLP docs, 6740 refs, 0 errors, 0 unchecked.
- `node scripts/check-inventories.mjs` reached an unrelated inherited
  diagnostics-registry drift (`diagnostics-registry.json`, `diagnostics.md`,
  and `diagnostic-codes.d.mts` stale); this lane did not widen into regenerating
  those unrelated projections.
