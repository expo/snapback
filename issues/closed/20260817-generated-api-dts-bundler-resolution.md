# Generated api.mjs/api.d.ts pairing not resolved for relative .mjs imports under bundler resolution

**Opened:** 2026-08-17
**Source:** Coterie Snapback `ContractDataProvider` adapter (Diary 0086,
M1 adapter entry); LLP 0277 F11

## Symptom

The generated `api.mjs` and adjacent `api.d.ts` are correctly paired for
Node-style consumers, but the Coterie app's bundler-mode TypeScript resolver
did not infer the declaration file for a relative `./generated/api.mjs`
import. The adapter needed a narrow hand-written typed bridge to
`GeneratedApi` to recover type coverage.

## Ask

Make the generated surface resolve types under both `node` and `bundler`
`moduleResolution` without consumer shims — for example by also emitting
`api.d.mts`, or by verifying/adjusting the declaration filename pairing
against both resolver modes in codegen tests. Acceptance: a
`moduleResolution: bundler` consumer importing the relative `.mjs` path gets
full types with no bridge, checked in the codegen test suite.

## Resolution

Resolved 2026-08-21. Codegen now emits byte-identical `api.d.ts` and
`api.d.mts` leaves. The compatibility `.d.ts` remains available to existing
direct imports and generated package export maps, while TypeScript pairs the
`.d.mts` leaf with relative `api.mjs` imports under both `node` and `bundler`
resolution. Both leaves participate in the complete artifact inventory and
typed-API review classification; Familiar bootstrap output follows the same
pairing.

`packages/snapback-codegen/api-module-resolution.test.mjs` generates a real
API, imports `./generated/api.mjs` without `allowJs` or a declaration shim,
and runs exact positive/negative type probes under both resolver modes.
`scripts/check-generated-types` also compiles both declaration leaves and
routes its maintained typed consumer through relative `.mjs` imports.
Maintained demo review manifests, fully committed fixtures, the remote
projection, and starter-template generated closures were regenerated.

Verification:

- `node packages/snapback-codegen/api-module-resolution.test.mjs`
- `scripts/check-generated-types`
- `node scripts/check-package-test-inventory.mjs`
- `node scripts/verify-generated-review-surface.mjs <starter roots>`
- `./ref-check --verbose`

Landing SHA: TBD
