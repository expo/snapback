# todo-v2 remote-service publication stale vs codegen; latency-kanban composition activation refuses regen

**Opened:** 2026-08-10 (LLP 0224 Phase 1 landing preflight)
**Status:** Open

Two pre-existing regeneration reds on `main`, found while proving an
unrelated landing (both reproduce on a clean `origin/main` tree and in the
primary checkout's working state; neither is caused by the LLP 0224 work):

1. **todo-v2 remote-service publication is stale relative to codegen.**
   `node packages/snapback-codegen/index.mjs demos/todo-v2/snapback
   --target-profile remote-service-sqlite-ibex` rewrites the committed
   `demos/todo-v2/snapback/generated-remote-service/{schema.manifest.json,
   functions.manifest.json, artifacts.json}` (committed schema manifest
   digest `sha256:4c6219aa…`, regenerated family differs). Consequence:
   `tests/artifact_schemas_v0.rs::remote_service_publication_is_closed_digest_bound_and_host_private`
   fails against any state where the ignored publication leaves and the
   committed manifests are mixed (the primary checkout's disk leaf
   references `sha256:553661fa…`, which matches no on-disk manifest). The
   2026-08-08 `adf404a41` "refresh todo-v2 generated-remote-service
   manifest after demo-manifest edit" appears to have hand-refreshed the
   manifests without a full leaf regeneration. Fix: rerun the codegen job
   and commit the complete regenerated set together (owner: the docs-review
   / demo-truth lane; the leaf may be bound into publication claim digests,
   so the owning lane should re-mint, not a bystander).

2. **latency-kanban trusted composition activation no longer binds its
   regenerated deployment.** `node packages/snapback-codegen/index.mjs
   demos/latency-kanban/snapback` refuses with
   `TRUSTED_COMPOSITION_ACTIVATION_INVALID: trusted composition activation
   does not bind this generated deployment`, so
   `scripts/check-generated-artifacts` exits 1 on `main`. The kanban
   activation was last re-minted in `c45e5215b` (post-S0 remint ceremony);
   codegen has since changed under lanes D/F. Fix: re-mint the composition
   activation for the regenerated deployment identity (owner: the
   composition/activation ceremony holder).

Both were worked around locally (regenerating todo-v2 in-tree for a
self-consistent proof without committing the fleet-owned carriers; kanban
generated state mirrored from the primary checkout).

## Update 2026-08-10 (LLP 0224 Phase 1 second landing)

Item 2 is **resolved upstream**: after the v2 activation ceremony
(`30af2240c`, `c85555499`, `24ba36941`) `demos/latency-kanban` regenerates
cleanly. Item 1 **persists**: `scripts/check-generated-artifacts` on
current `main` still rewrites the committed
`demos/todo-v2/snapback/generated-remote-service/{schema.manifest.json,
functions.manifest.json, artifacts.json}` (verified again today). The
ticket stays open for item 1 only; the owning demo-truth lane should
regenerate and commit the complete set.

## Resolution (2026-08-12, LLP 0231 remainders run)

Both halves are now closed.

- **todo-v2 remote-service staleness** — repaired by the LLP 0231 Lane B
  landing (`0c7b04341`).
- **latency-kanban trusted-composition activation** — the stale activation was
  deleted and re-minted as a v2 composition activation, with its generated
  review manifest and 5/5 receipt regenerated. Latency-kanban is an ordinary
  `CODEGEN_JOBS` entry with no skip in the current checker, so there was no
  skip to remove.
