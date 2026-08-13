# Merge resolution report

## Source resolutions

### `packages/snapback-codegen/index.mjs`

Resolved the single import-block conflict as a union. The merged file keeps the
complete `./client-lifecycle.mjs` import block:

```js
import {
  buildClientLifecycleManifest,
  CLIENT_LIFECYCLE_MANIFEST_FILE,
  renderReferenceJSDoc,
} from './client-lifecycle.mjs';
```

and immediately follows it with the complete `./semantic-generation.mjs`
import block:

```js
import {
  APPLICATION_GENERATION_SCHEMA_VERSION,
  SEMANTIC_IDENTITY_SCHEMA_VERSION,
  buildSemanticGenerationInputs,
  completeGenerationIdentities,
  computeBundleId,
  computeGenerationContentIdentities,
  generationAddressNeutralProjection,
  generationDomainHash,
  publishGenerationEnvelope,
  recordLatestEmittedGeneration,
} from './semantic-generation.mjs';
```

No other source in the file was hand-merged. This preserves both LLP 0238
lifecycle-manifest/JSDoc emission and the substrate semantic-generation
identity/envelope helpers.

### `scripts/check-package-test-inventory.mjs`

Resolved both conflict hunks by setting:

```js
expectedTotal = 262
```

and retaining both lanes' history in chronological order:

```text
255 -> 257 (2026-08-12, LLP 0237 rollout 1)
257 -> 258 (2026-08-12, LLP 0237 rollout 2)
258 -> 260 (2026-08-12, LLP 0241 rollout 1)
260 -> 262 (2026-08-12, LLP 0238 rollout 1)
```

All other 56 conflicted files were treated as generated artifacts. Their
working-tree bytes were restored from Git stage 3 (`theirs`), verified
byte-for-byte against the stage-3 blob hashes, and staged without hand-merging.

## Verification outputs

### `node --check packages/snapback-codegen/index.mjs`

Exit status: `0`

```text
(no output)
```

### `node packages/snapback-codegen/index.mjs demos/todo/snapback`

Exit status: `0`

```text
[warning] SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT (auth) todos: table visibility is implicit. Add .visibility({ kind: 'public-read' }), .visibility({ kind: 'owner', field: 'ownerId' }), or .visibility({ kind: 'membership', declaration: 'members', resourceField: 'resourceId', roles: ['member'] }) to the todos defineTable(...) chain (guide/auth/protecting-data.md#declare-who-can-read-each-table).
Codegen summary for todo
  tables 1; operations 6 (query 1, live query 1, mutation 4, action 0); live 1; ephemeral 0
  files 39 (review manifest 1, consumer committed 2, ignored cache 36); warnings 1
  degraded createTodo: functions.mjs:47:14 -> generated/api.d.ts#GeneratedApi["createTodo"]
    Add `result: results.document("table")` for one complete stored row or `result: results.value(v.object({ ... }))` for a direct payload to `createTodo` in functions.mjs and regenerate.
  degraded deleteTodo: functions.mjs:68:14 -> generated/api.d.ts#GeneratedApi["deleteTodo"]
    Add `result: results.document("table")` for one complete stored row or `result: results.value(v.object({ ... }))` for a direct payload to `deleteTodo` in functions.mjs and regenerate.
  degraded editTitle: functions.mjs:62:14 -> generated/api.d.ts#GeneratedApi["editTitle"]
    Add `result: results.document("table")` for one complete stored row or `result: results.value(v.object({ ... }))` for a direct payload to `editTitle` in functions.mjs and regenerate.
  degraded setCompleted: functions.mjs:54:14 -> generated/api.d.ts#GeneratedApi["setCompleted"]
    Add `result: results.document("table")` for one complete stored row or `result: results.value(v.object({ ... }))` for a direct payload to `setCompleted` in functions.mjs and regenerate.
  table visibility 0 declared; 1 implicit
    todos: add .visibility(...) to the table definition; see guide/auth/protecting-data.md#declare-who-can-read-each-table
codegen ok: /Users/ccheever/projects/snapback/.claude/worktrees/aw-integ/demos/todo/snapback/generated  (inputsHash 4c5d758074b2…)
```

After this verification command, the conflicted generated artifacts were
restored from `theirs` again before staging, so the command's regeneration did
not replace the charter-prescribed merge resolution.

### `node scripts/check-package-test-inventory.mjs`

Exit status: `0`

```text
(node:64934) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
[package-test-inventory] snapback-maturity-records: 2
[package-test-inventory] @expo/snapback-runtime-darwin-arm64: 1
[package-test-inventory] @expo/snapback-runtime-linux-x64: 1
[package-test-inventory] @expo/snapback-sidecar: 1
[package-test-inventory] create-snapback-app: 1
[package-test-inventory] @expo/snapback-cli: 23
[package-test-inventory] @expo/snapback-vite: 3
[package-test-inventory] @expo/snapback-client: 63
[package-test-inventory] @expo/snapback-hosted-supervisor: 12
[package-test-inventory] @expo/snapback-publication-authority: 4
[package-test-inventory] @expo/snapback-react: 19
[package-test-inventory] @expo/snapback-expo: 9
[package-test-inventory] @expo/snapback-app-cli: 11
[package-test-inventory] @expo/snapback-codegen: 60
[package-test-inventory] @expo/snapback-contract: 41
[package-test-inventory] snapback-admin-ui: 11
[package-test-inventory] PASS: 262 declared test files
```

Additional resolution checks:

```text
git diff --name-only --diff-filter=U
(no output)

git diff --cached --check
(no output)
```

## Final `git status --porcelain | head -30`

```text
M  .gitignore
M  demos/competitive-checkpoint/snapback/generated/artifacts.json
M  demos/rbac/snapback/generated/artifacts.json
M  demos/todo-v2/snapback/generated/artifacts.json
M  demos/todo/snapback/generated/artifacts.json
M  guide/backend/handler-runtime.md
M  guide/guide-flat.backend.generated.md
M  guide/guide-flat.generated.md
M  guide/guide-flat.reference.generated.md
M  guide/guide-manifest.generated.json
M  guide/reference/diagnostics-registry.json
M  guide/reference/diagnostics.md
M  guide/reference/expo-snapback-cli--verify.md
M  guide/reference/expo-snapback-client--agent-authority.md
M  guide/reference/expo-snapback-client--app-data.md
M  guide/reference/expo-snapback-client--assets.md
M  guide/reference/expo-snapback-client--canonical-client-value.md
M  guide/reference/expo-snapback-client--client-diagnostics.md
M  guide/reference/expo-snapback-client--commands.md
M  guide/reference/expo-snapback-client--evaluation-floor.md
M  guide/reference/expo-snapback-client--external-store.md
M  guide/reference/expo-snapback-client--hosted-browser.md
M  guide/reference/expo-snapback-client--ir-evaluator.md
M  guide/reference/expo-snapback-client--lease-convergence.md
M  guide/reference/expo-snapback-client--local-read-admission.md
M  guide/reference/expo-snapback-client--materialization-store.md
M  guide/reference/expo-snapback-client--micro-core.md
M  guide/reference/expo-snapback-client--micro-live.md
M  guide/reference/expo-snapback-client--micro.md
M  guide/reference/expo-snapback-client--online.md
```
