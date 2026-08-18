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
