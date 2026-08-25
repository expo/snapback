# Remote-service artifact schema tests depended on review caches

**Status:** Open · **Opened:** 2026-08-25 (found during the DK-7 path-escape fix)

`cargo test -p snapback --test artifact_schemas_v0 remote_service_publication_is_closed_digest_bound_and_host_private`
failed according to checkout-local generated state: an existing checkout could
hold a stale ignored remote-service closure, while a fresh worktree had no
`generated-remote-service/remote-service.profile.json` at all. The two
`dk7_committed_demo_manifests_*` tests had the same environmental dependency
on missing or stale ignored cache manifests. This was not a stale committed-
artifact content red.

Commit `7d1f32b5c` (`feat(graph): LLP 0209 G3 rung 1`) had already reminted the
tracked review artifacts for todo, todo-v2, and the todo-v2 remote-service
profile: `artifacts.json`, `authorization-review.json`, and the policy-selected
`schema.manifest.json` / `functions.manifest.json`. The test failure came from
the rest of the materialized graph, not from those committed bytes.

## Custody reality

The generated roots in this test have per-leaf custody:

- `artifacts.json` is the committed review manifest.
- `schema.manifest.json` and `functions.manifest.json` are committed only where
  `codegen.policy.json` selects them as `consumer-committed` projections (todo,
  todo-v2, and todo-v2 remote-service here).
- `authorization-review.json` and the governance baselines/ledgers are also
  committed projections under LLP 0173 §1 custody.
- `capability.manifest.json`, `remote-service.profile.json`, the remote auth/data
  capability manifests, generated operation schemas, and the other ordinary
  materialized graph leaves are ignored, regenerable caches in the todo-v2
  remote-service review-cache root.

## Resolution of the test red (2026-08-25)

`artifact_schemas_v0.rs` now copies each backend into an isolated temporary
location and runs codegen only there. It derives the byte-comparison set from
the committed `artifacts.json`: the declared `review-manifest` leaf plus only
the `files` entries carrying `consumer-committed` custody. It compares those
committed review leaves read-only with the fresh output and fails with
`SNAPBACK_TEST_COMMITTED_GENERATED_ARTIFACT_DRIFT`, naming
`scripts/check-generated-artifacts`, when committed bytes disagree. The DK-7
schema/parse checks consume `schema.manifest.json`, `functions.manifest.json`,
and `capability.manifest.json` from the temporary generation; cache-only
schema/function manifests are never read from the repository.

The remote-service test is now named
`remote_service_fresh_cache_closure_matches_committed_review_leaves_and_is_host_private`.
Its fresh profile's `schemaManifest` and `functionManifest` digests are checked
against the committed copies of those two consumer projections. The remaining
digest checks describe only the isolated fresh cache closure. The two DK-7 demo
test names likewise say that they validate/parse fresh manifests and separately
match committed review leaves. No test replaces an in-repository `generated*`
tree, so sibling test binaries cannot observe an atomic-publication rename
window there.

No digest or generated artifact was hand-edited.

## Why this ticket remains open

The remote profile still declares `publication.kind: "gitPinnedCheckout"` and
`addressing: "commitSha"`; its owning Rust contract says consumers pin the
containing Snapback commit and verify every referenced artifact. That promise
conflicts with `scripts/generated-artifact-policy.mjs:56`, which classifies
`demos/todo-v2/snapback/generated-remote-service` as a review-cache root, and
`.gitignore:50`, which ignores the profile and most of its referenced closure.

The isolated test validates the current cache policy honestly, but it cannot
make the git-pinned delivery promise true. Follow-up:
[`issues/20260825-remote-service-git-pinned-custody-contract.md`](./20260825-remote-service-git-pinned-custody-contract.md).

## Verification

Before the final two runs, 1,307 ignored, regenerable cache leaves were deleted:
all 1,272 leaves under the 29 `demos/*/snapback/generated*` roots, plus the 35
leaves under `demos/all-aboard/tests/egress-probe/generated`. The same leaves
were deleted again after `check-generated-artifacts` recreated them. The exact
ignored-leaf queries returned no paths both before run 1 and after run 2.

With `CARGO_BUILD_JOBS=8` and `CARGO_INCREMENTAL=0`, the literal whole-file
summaries were:

```text
test result: ok. 39 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 23.59s
test result: ok. 39 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 21.18s
```

The requested ordinary status snapshot was identical before and after the two
runs:

```text
$ git status --porcelain
 M crates/snapback/tests/artifact_schemas_v0.rs
```

`git status --porcelain --ignored -- demos` was intentionally nonempty in both
snapshots: it reported pre-existing `.snapback/` caches, old
`.artifact-schemas-*` temporary directories, and the separate
`browser-local-first/snapback-sessions/generated` cache. It reported none of
the deleted `demos/*/snapback/generated*` leaves or the egress-probe generated
leaves.

- `./scripts/check-generated-artifacts` — `[check-generated-artifacts] ok: review manifests, ignored caches, and committed projections are current`
- `./ref-check --verbose` — `ref-check: ok — 311 LLP docs, 6971 refs in 14563 files, 0 errors, 0 unchecked`
- `git diff --check` — clean.

The additional `node scripts/check-inventories.mjs` audit still reaches the
baseline diagnostics-registry drift recorded before this fix loop. Its source
inventory excludes `crates/snapback/tests/`, so this test-only Rust change does
not contribute an emitting site or code to that inherited red.
