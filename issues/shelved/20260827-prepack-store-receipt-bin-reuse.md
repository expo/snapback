# prepack does not reuse an existing bin/ packaged-store receipt

**Status:** Open
**Systems:** Packaging, Distribution, Runtime packages
**Date:** 2026-08-27
**Related:** LLP 0041 (`#defence-in-depth`), commit landing the final
public-package packaged-store-receipt guard.

## Context

The final public-package receipt guard (require `bin/packaged-store-qualification.receipt.json`
for a `public-package`, non-staging assembly) is correct and the intended
interlock. During its review, codex flagged a secondary point that grok assessed
as non-blocking; recording it here so it is not lost.

## Observation

`installPackagedStoreQualificationReceipt` (`scripts/runtime-package-authority.mjs`)
sources the store receipt from `SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE`
or from beside the source binary — it does **not** reuse a receipt that already
exists in the package's own `bin/`. Consequently a runtime package that was
already properly assembled (receipt present in `bin/`) cannot be re-packed via a
bare `prepack` (`node prepare-runtime.mjs`) without re-supplying the receipt: the
public-package guard throws `SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_INVALID`.

## Why it is not currently breaking

The official publication path (`scripts/snapback-publish.mjs`) packs with
`--ignore-scripts` and runs the preparer explicitly with the receipt env var, so
`prepack` never re-runs there. Direct `npm publish <dir>` on a runtime package is
not a supported publication path. So this only affects hypothetical manual
re-packing.

## Wanted (small enhancement)

Have the preparer treat an existing, valid `bin/packaged-store-qualification.receipt.json`
in the package as a satisfying source (reuse it) so a properly-assembled package
re-packs idempotently, while a receiptless public-package build still fails closed.
Add a package test for the reuse path.
