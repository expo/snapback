# `buildRelease` rejects generated capability manifest schema identity

- Status: Open
- Date: 2026-08-25
- Systems: `packages/snapback-cli` (`buildRelease`), generated capability manifests
- Governing: LLP 0072 (release artifact), LLP 0189 (fix-forward)
- Found by: `package-test-todo` lane while running `packages/snapback-cli/package.test.mjs`

## Symptom

The CLI package suite advances through all template scaffold assertions, then
aborts while building a release from the freshly generated `todo-contract`
scaffold:

```text
SNAPBACK_DEPLOY_GENERATED_IDENTITY_MISMATCH
generated schema, function, and capability artifacts do not describe one application build
schemaVersion: snapback.v1
functionsSchemaVersion: snapback.v1
capabilitySchemaVersion: snapback.v0
```

Reproduction outside the sequential suite:

```sh
node --input-type=module -e "import { buildRelease } from './packages/snapback-cli/index.mjs'; await buildRelease({ backendDirectory: '<fresh-todo>/snapback', outputDirectory: '<tmp>/releases' })"
```

The reproduction exits 1 with the same diagnostic after `buildRelease`
regenerates the backend.

## Diagnosis

`packages/snapback-cli/index.mjs:buildRelease` requires
`capabilityManifest.schemaVersion === schemaManifest.schemaVersion`. Current
codegen correctly emits the application schema and function manifests as
`snapback.v1`, while the canonical target-level capability manifest remains
`snapback.v0` and does not carry application identity fields. A normal output
of the repository's own `generateApp` therefore cannot pass release identity
validation.

This is a product-path defect rather than package-test assertion drift: the
test calls the real `buildRelease` over freshly generated product artifacts,
and the same call fails independently. Determine the intended cross-artifact
identity relation (likely target profile plus a capability-manifest-specific
schema contract rather than schema-version equality), update the release
validator, and add a fail-first release-build regression over current generated
artifacts.

## Blocking impact

`node --test packages/snapback-cli/package.test.mjs` cannot run to completion,
so the `package-test-todo` lane stopped the inherited-red cascade here as
required instead of changing release code outside its template/test-drift
scope.
