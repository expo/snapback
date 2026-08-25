# remote_service_publication_is_closed_digest_bound_and_host_private depends on review caches

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
location and runs codegen only there. It compares every committed review leaf
read-only with the fresh output and fails with
`SNAPBACK_TEST_COMMITTED_GENERATED_ARTIFACT_DRIFT`, naming
`scripts/check-generated-artifacts`, when committed bytes disagree. The DK-7
schema/parse checks and the remote publication closure checks consume the temp
cache leaves. No test replaces an in-repository `generated*` tree, so sibling
test binaries cannot observe an atomic-publication rename window there.

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

- `cargo test -p snapback --test artifact_schemas_v0` twice — 39 passed, 0
  failed on both runs; `git status --porcelain` was empty before and after.
- `./scripts/check-generated-artifacts` — review manifests, ignored caches, and
  committed projections are current.
- `./ref-check --verbose` — 311 LLP docs, 7255 refs, 0 errors, 0 unchecked.
- `git diff --check` — clean.

The additional `node scripts/check-inventories.mjs` audit still reaches the
baseline diagnostics-registry drift recorded before this fix loop. Its source
inventory excludes `crates/snapback/tests/`, so this test-only Rust change does
not contribute an emitting site or code to that inherited red.
