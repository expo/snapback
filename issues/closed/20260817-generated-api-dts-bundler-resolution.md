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

Resolved 2026-08-21. Codegen now emits byte-identical `.d.ts` and `.d.mts`
pairs for both `api.mjs` and `app.mjs`. The compatibility `.d.ts` leaves remain
available to existing direct imports and generated package export maps, while
TypeScript pairs `.d.mts` with relative `.mjs` imports under `node`, `bundler`,
and `nodenext` resolution. Both leaves participate in each complete artifact
inventory and review classification; committing either declaration leaf gives
the pair consumer-committed custody. Familiar API bootstrap output follows the
same pairing.

`packages/snapback-codegen/api-module-resolution.test.mjs` generates a real
API and app descriptor, imports their relative `.mjs` modules without
`allowJs` or declaration shims, and runs exact positive/negative type probes
under all three resolver modes. The originating Coterie provider now imports
the generated API and data-model type directly from `api.mjs` and compiles in
strict bundler mode without its former `@ts-expect-error`/cast bridge.
`scripts/check-generated-types` also compiles both declaration leaves and
routes its maintained typed consumer through relative `.mjs` imports.
Maintained demo review manifests, fully committed fixtures, the remote
projection, and starter-template generated closures were regenerated.

Verification:

- `node packages/snapback-codegen/api-module-resolution.test.mjs`
- `scripts/check-generated-types`
- `scripts/check-generated-artifacts`
- `node scripts/check-inventories.mjs`
- `node packages/snapback-codegen/review-surface.test.mjs`
- `tsc --noEmit -p demos/coterie/tsconfig.json`
- `./ref-check --verbose`

Landing SHA: 659897953803cad3aacf442a81207c422220e689
