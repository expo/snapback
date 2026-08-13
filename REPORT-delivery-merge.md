# Delivery merge resolution report

## Resolution by charter class

1. **LLP documents (0236–0242):** Took origin/main byte-for-byte for LLPs 0236, 0237, 0238, 0241, and 0242, preserving the post-acceptance amendments and every main-side `Revised` entry. LLPs 0239 and 0240 start from origin/main and add only the candidate carry-ins recorded below; main's `Revised` entries and companion-RFC Related additions remain intact.
2. **`guide/capabilities.md`:** Preserved the exact 111-row union of both sides, including main's 0245–0249/password-era rows and the candidate's handler-runtime, authority-profile, media, and lifecycle-related surface. Preserved every alias, witness, GAP, owner, and date. Tightened only `What` prose. Final size: **55,792 bytes**, satisfying `wc -c < 55808`.
3. **Headless guide and retrieval eval:** Preserved main's headless/auth additions and added the candidate's generated-reference/lifecycle section and authorities. Preserved main's whoami Case 48 and renumbered the candidate's colliding Cases 48–51 to **49–52**.
4. **Manifest and schemas:** Started from origin/main's `src/manifest.rs`, added the candidate's `authority_profile` / `AuthorityProfileV1` and media descriptor/result/capability plumbing, retained main's publication digest expectations, and restored the candidate's media RQS-demotion hunk over main's reformatted function. Ran `cargo run --locked --bin snapback-schemagen`; `schemas/schema.manifest.schema.json` is regeneration output, never hand-edited.
5. **Package test inventory:** Preserved main's `unrecognized-authority-recovery` and Bun/Vite test additions, added the candidate's reference-kind, generation-check, lifecycle, handler, media, and semantic-generation tests, and added `reference-kinds.mjs` to the client package. The true union is **265** declared tests and the checker passes.
6. **Publication custody and conformance readers:** Took origin/main verbatim for all four `src/local-*-publication*.json` custody files and both relation-activity/sequence-allocation conformance readers. Byte-for-byte comparisons against stage 3 pass.
7. **Remaining conflicts:** Took origin/main verbatim for all other generated Guide projections, demo generated artifacts, registries, and manifests. Across all 121 conflict paths, exactly the nine authored/regenerated union paths differ from stage 3; the other 112 are byte-for-byte origin/main. No conflict markers remain in any conflict-path working-tree file.

## LLP 0239/0240 candidate carry-ins re-applied

`llp/0239-asset-collections-and-media-field.rfc.md`:

- Added LLP 0235 to `Related`.
- Added the constraint that media fields and generated collection-record fields receive LLP 0235 class-M treatment and do not bypass the all-fields fence.

`llp/0240-application-authority-profiles.rfc.md`:

- Added LLPs 0234 and 0235 to `Related`.
- Added the rule that visibility-broadening or incomparable profile/role-lattice edits remain subject to LLP 0234 remotely-prior content-bound approval and exact-set ratchet; D2 rotation records/invalidates but does not replace that prerequisite.

These are exactly the carry-in hunks from `git diff 075cbafbb..a0a1e2911 -- llp/0239* llp/0240*`.

## Verification

- `cargo run --locked --bin snapback-schemagen`: **PASS (exit 0)**; regenerated committed schemas, including the conflicted manifest schema. Compiler emitted warnings only.
- `node scripts/check-package-test-inventory.mjs`: **PASS (exit 0)** — `PASS: 265 declared test files`.
- `cargo check --locked`: **PASS (exit 0)** — finished the dev profile; warnings only.
- `node --check packages/snapback-codegen/index.mjs`: **PASS (exit 0)**; no output.
- `wc -c guide/capabilities.md`: **55,792**.
- Conflict-marker scan across all 121 conflict paths: **0 matches**.
- Working-tree resolution audit: exactly the nine intended union/regeneration paths differ from origin/main; all 112 take-theirs paths compare byte-for-byte.
- Final 122-path `git add --pathspec-from-file=-` attempt: **BLOCKED (exit 128)** — `fatal: Unable to create '/Users/ccheever/projects/snapback/.git/worktrees/aw-integ/index.lock': Operation not permitted`.
- `git diff --name-only --diff-filter=U | wc -l`: **121 in the real index**, solely because the linked-worktree sandbox denied creation of `/Users/ccheever/projects/snapback/.git/worktrees/aw-integ/index.lock`. The working tree is fully resolved. After the orchestrator stages the paths below, this command must return **0**.

## Staging handoff

Stage exactly these 122 paths (the 121 originally conflicted paths plus this report):

- `REPORT-delivery-merge.md`
- `demos/access-desk/snapback/generated/artifacts.json`
- `demos/all-aboard/snapback/generated/artifacts.json`
- `demos/browser-local-first/snapback/generated/artifacts.json`
- `demos/campfire/snapback/generated/artifacts.json`
- `demos/card-game/snapback/generated/artifacts.json`
- `demos/catalog-lens/snapback/generated/artifacts.json`
- `demos/chirp/snapback/generated/artifacts.json`
- `demos/competitive-checkpoint/snapback/generated/api.mjs`
- `demos/competitive-checkpoint/snapback/generated/artifacts.json`
- `demos/competitive-checkpoint/snapback/generated/functions.manifest.json`
- `demos/competitive-checkpoint/snapback/generated/schema.manifest.json`
- `demos/cursors-web/snapback/generated/artifacts.json`
- `demos/dispatch-board/snapback/generated/artifacts.json`
- `demos/file-drop/snapback/generated/artifacts.json`
- `demos/graffiti/snapback/generated/artifacts.json`
- `demos/latency-kanban/snapback/generated/artifacts.json`
- `demos/messaging-snapback/snapback/generated/artifacts.json`
- `demos/partiful-matrix/snapback/generated/api.mjs`
- `demos/partiful-matrix/snapback/generated/artifacts.json`
- `demos/party-wall/snapback/generated/artifacts.json`
- `demos/pointing-room/snapback/generated/artifacts.json`
- `demos/pointing-room/snapback/generated/functions.manifest.json`
- `demos/pointing-room/snapback/generated/schema.manifest.json`
- `demos/public-dashboard/snapback/generated/artifacts.json`
- `demos/pulse-monitor/snapback/generated/artifacts.json`
- `demos/rbac/snapback/generated/artifacts.json`
- `demos/shindig/snapback/generated/artifacts.json`
- `demos/signal-desk/snapback/generated/artifacts.json`
- `demos/team-chat/snapback/generated/api.mjs`
- `demos/team-chat/snapback/generated/app.binding.mjs`
- `demos/team-chat/snapback/generated/app.descriptor.json`
- `demos/team-chat/snapback/generated/app.mjs`
- `demos/team-chat/snapback/generated/artifacts.json`
- `demos/team-chat/snapback/generated/contract-data.manifest.json`
- `demos/team-chat/snapback/generated/functions.manifest.json`
- `demos/team-chat/snapback/generated/provider-bindings.json`
- `demos/team-chat/snapback/generated/provider-introspection.json`
- `demos/team-chat/snapback/generated/schema.manifest.json`
- `demos/todo-v2/snapback/generated-remote-service/artifacts.json`
- `demos/todo-v2/snapback/generated-remote-service/functions.manifest.json`
- `demos/todo-v2/snapback/generated-remote-service/schema.manifest.json`
- `demos/todo-v2/snapback/generated/artifacts.json`
- `demos/todo-v2/snapback/generated/functions.manifest.json`
- `demos/todo-v2/snapback/generated/schema.manifest.json`
- `demos/todo/snapback/generated/artifacts.json`
- `demos/todo/snapback/generated/functions.manifest.json`
- `demos/todo/snapback/generated/schema.manifest.json`
- `guide/capabilities.md`
- `guide/clients/headless.md`
- `guide/guide-flat.clients.generated.md`
- `guide/guide-flat.generated.md`
- `guide/guide-flat.meta.generated.md`
- `guide/guide-flat.reference.generated.md`
- `guide/guide-manifest.generated.json`
- `guide/reference/diagnostics-registry.json`
- `guide/reference/diagnostics.md`
- `guide/reference/expo-snapback-cli--verify.md`
- `guide/reference/expo-snapback-client--agent-authority.md`
- `guide/reference/expo-snapback-client--app-data.md`
- `guide/reference/expo-snapback-client--assets.md`
- `guide/reference/expo-snapback-client--canonical-client-value.md`
- `guide/reference/expo-snapback-client--client-diagnostics.md`
- `guide/reference/expo-snapback-client--commands.md`
- `guide/reference/expo-snapback-client--evaluation-floor.md`
- `guide/reference/expo-snapback-client--external-store.md`
- `guide/reference/expo-snapback-client--hosted-browser.md`
- `guide/reference/expo-snapback-client--ir-evaluator.md`
- `guide/reference/expo-snapback-client--lease-convergence.md`
- `guide/reference/expo-snapback-client--local-read-admission.md`
- `guide/reference/expo-snapback-client--materialization-store.md`
- `guide/reference/expo-snapback-client--micro-core.md`
- `guide/reference/expo-snapback-client--micro-live.md`
- `guide/reference/expo-snapback-client--micro.md`
- `guide/reference/expo-snapback-client--online.md`
- `guide/reference/expo-snapback-client--optimistic-rebase.md`
- `guide/reference/expo-snapback-client--outbox-shared.md`
- `guide/reference/expo-snapback-client--push-installation-expo.md`
- `guide/reference/expo-snapback-client--push-registry.md`
- `guide/reference/expo-snapback-client--react-binding.md`
- `guide/reference/expo-snapback-client--remediation.md`
- `guide/reference/expo-snapback-client--result-transform.md`
- `guide/reference/expo-snapback-client--rqs-preload.md`
- `guide/reference/expo-snapback-client--rqs-registered.md`
- `guide/reference/expo-snapback-client--rqs-store-default.md`
- `guide/reference/expo-snapback-client--rqs-store-expo.md`
- `guide/reference/expo-snapback-client--rqs-store-file.md`
- `guide/reference/expo-snapback-client--rqs-store.md`
- `guide/reference/expo-snapback-client--rqs.md`
- `guide/reference/expo-snapback-client--search.md`
- `guide/reference/expo-snapback-client--vector-search.md`
- `guide/reference/expo-snapback-client.md`
- `guide/reference/expo-snapback-codegen--ctx.md`
- `guide/reference/expo-snapback-expo--app-binding.md`
- `guide/reference/expo-snapback-expo--app.plugin.md`
- `guide/reference/expo-snapback-expo--asset-source.md`
- `guide/reference/expo-snapback-expo--config-plugin.md`
- `guide/reference/expo-snapback-expo--supervised-environment.md`
- `guide/reference/expo-snapback-expo.md`
- `guide/reference/expo-snapback-react--core.md`
- `guide/reference/expo-snapback-react--thumbhash.md`
- `guide/reference/expo-snapback-react.md`
- `guide/reference/index.md`
- `guide/reference/registry.json`
- `guide/retrieval-eval.md`
- `llp/0236-clique-cross-model-authoring-friction.research.md`
- `llp/0237-bounded-handler-modules.rfc.md`
- `llp/0238-explicit-client-lifecycles.rfc.md`
- `llp/0239-asset-collections-and-media-field.rfc.md`
- `llp/0240-application-authority-profiles.rfc.md`
- `llp/0241-semantic-artifact-generation.rfc.md`
- `llp/0242-bounded-query-composition.rfc.md`
- `packages/snapback-client/package.json`
- `schemas/schema.manifest.schema.json`
- `scripts/check-package-test-inventory.mjs`
- `src/local-persistent-store-publication.anchor.v1.json`
- `src/local-persistent-store-publication.v1.json`
- `src/local-relation-activity-publication.v1.json`
- `src/local-sequence-allocation-publication.v1.json`
- `src/manifest.rs`
- `tests/conformance/relation-activity-publication-v1.mjs`
- `tests/conformance/sequence-allocation-publication-v1.mjs`
