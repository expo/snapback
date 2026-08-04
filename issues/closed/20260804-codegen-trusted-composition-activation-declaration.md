# codegen exports `validateTrustedCompositionActivationV1` without a declaration

**Status:** Open
**Opened:** 2026-08-04 (found during direct-main publish verification; inherited from `origin/main`)
**Systems:** Codegen packaging, TypeScript declarations

`packages/snapback-codegen/index.mjs` publicly exports
`validateTrustedCompositionActivationV1`, but
`packages/snapback-codegen/index.d.mts` has no matching declaration. The
repository export-type gate therefore fails with:

```text
@expo/snapback-codegen .: runtime exports missing from the declaration:
validateTrustedCompositionActivationV1
```

This mismatch is already present on `origin/main` at `9435e3502` and is
unrelated to the Expo cryptoless-online fix or the Linear cleanup. Add the
exact public signature to `index.d.mts` (or deliberately stop exporting the
runtime symbol), then rerun `node scripts/check-package-export-types.mjs`.

## Resolution (2026-08-04)

Added the `validateTrustedCompositionActivationV1` declaration to
`packages/snapback-codegen/index.d.mts`;
`node scripts/check-package-export-types.mjs` is green repo-wide again
(82 declaration surfaces match).
