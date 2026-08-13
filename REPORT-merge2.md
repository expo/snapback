# MERGE2 report

## Resolutions

- `packages/snapback-codegen/package.json`: kept the integration-side S2/S3/L additions (`handler-runtime-profile`, `handler-graph-parity`, semantic-generation golden/rotation, and `client-lifecycle`) and added `media-field-authoring.test.mjs` beside the other asset authoring tests.
- `scripts/check-package-test-inventory.mjs`: set `expectedTotal = 263`; retained the integration-side `255 -> 262` history in chronological order and appended the media-field `262 -> 263` entry for the LLP 0239/0244 slice.
- `guide/capabilities.md`: retained the integration-side tightened `backend.assets` facts, applied the media side's shipped `assets.media-field.v1` state/witnesses/LLP 0244 authority, and tightened only the two affected What-column descriptions to remain below budget. No rows, aliases, witnesses, GAP markers, owners, or dates were removed.
- Every other conflicted generated file in `demos/*/snapback/generated/*`, the guide manifest/flats, and `guide/reference/*` now matches merge stage 3 (`theirs`) byte-for-byte. Because the sandbox could not lock the real Git index, `git checkout-index --stage=3 --force` supplied the same stage-3 bytes without modifying the index.
- Conflict-marker scan over every conflicted worktree path: `PASS`.

## Verification

`node scripts/check-package-test-inventory.mjs`:

```text
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
[package-test-inventory] @expo/snapback-codegen: 61
[package-test-inventory] @expo/snapback-contract: 41
[package-test-inventory] snapback-admin-ui: 11
[package-test-inventory] PASS: 263 declared test files
```

`wc -c guide/capabilities.md`:

```text
55802 guide/capabilities.md
```

The required bound is `< 55808`; the merged file has six bytes of headroom.

The package-chain spot check also reports all integration and media additions present:

```text
handler-runtime-profile.test.mjs: present
handler-graph-parity.test.mjs: present
semantic-generation-golden.test.mjs: present
semantic-generation-rotation.test.mjs: present
client-lifecycle.test.mjs: present
media-field-authoring.test.mjs: present
```

## Staging boundary

The required `git add` could not update the real merge index because its location is outside the writable sandbox:

```text
fatal: Unable to create '/Users/ccheever/projects/snapback/.git/worktrees/aw-integ/index.lock': Operation not permitted
```

Accordingly, the worktree contents are resolved but Git still reports the paths as unmerged. No commit, push, rebase, merge, abort, or other merge-state transition was run.

## Final git status head

```text
UU demos/rbac/snapback/generated/artifacts.json
UU demos/todo/snapback/generated/artifacts.json
UU demos/todo/snapback/generated/functions.manifest.json
UU demos/todo/snapback/generated/schema.manifest.json
M  guide/backend/media-happy-paths.md
UU guide/capabilities.md
M  guide/guide-flat.backend.generated.md
UU guide/guide-flat.generated.md
UU guide/guide-flat.meta.generated.md
UU guide/guide-flat.reference.generated.md
UU guide/guide-manifest.generated.json
UU guide/reference/diagnostics-registry.json
UU guide/reference/diagnostics.md
UU guide/reference/expo-snapback-cli--verify.md
UU guide/reference/expo-snapback-client--agent-authority.md
UU guide/reference/expo-snapback-client--app-data.md
UU guide/reference/expo-snapback-client--assets.md
UU guide/reference/expo-snapback-client--canonical-client-value.md
UU guide/reference/expo-snapback-client--client-diagnostics.md
UU guide/reference/expo-snapback-client--commands.md
UU guide/reference/expo-snapback-client--evaluation-floor.md
UU guide/reference/expo-snapback-client--external-store.md
UU guide/reference/expo-snapback-client--hosted-browser.md
UU guide/reference/expo-snapback-client--ir-evaluator.md
UU guide/reference/expo-snapback-client--lease-convergence.md
UU guide/reference/expo-snapback-client--local-read-admission.md
UU guide/reference/expo-snapback-client--materialization-store.md
UU guide/reference/expo-snapback-client--micro-core.md
UU guide/reference/expo-snapback-client--micro-live.md
UU guide/reference/expo-snapback-client--micro.md
```
