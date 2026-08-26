# Qualified staging omitted packaged-store qualification receipts

**Status:** Closed
**Impact:** 4
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Systems:** Package distribution, Qualified staging, Capability advertisement, Local persistent store
**Date:** 2026-08-07
**Governing:** LLP 0041 §Qualified staging substrate; LLP 0110 §Single-table public-package advertisement amendment — 2026-08-06; LLP 0166 §Public-package advertisement amendment — 2026-08-06

## Failure

The first qualified-staging execution, EAS run
`019fdeb1-6d46-72a2-ace6-c52d06a9825b` at source revision `8913704c0`,
reached both platform staged-proof jobs and failed in the expo-chat
live-acceptance leg of `scripts/snapback-package-cold-install.mjs`.
`functions.load` refused with:

`SNAPBACK_CAPABILITY_UNSUPPORTED: function conversationDetails requires capability single_table_v1, which the served instance manifest does not support`

The same refusal covered `messagesForConversation` and `users`.

## Attribution

A `public-package` runtime advertises `single_table_v1` only after validating a
`snapback.packaged-store-qualification.v1` receipt co-installed at
`bin/packaged-store-qualification.receipt.json`. Runtime package preparation
can source that receipt from the source binary's sibling or its platform
specific explicit environment path, but intentionally no-ops when neither is
present. The qualified-staging workflow had no receipt-minting step, so its
staged runtime packages silently omitted the file and startup correctly kept
the capability as a GAP.

In-repository contributor-source proofs did not expose the defect because the
contributor carrier chain authorizes this surface without the public-package
receipt conjunction. Published 0.1.11 and 0.1.13 closures also passed: direct
`npm pack` inspection verified that both platform runtime tarballs carry the
receipt. Those releases used the manual per-platform mint and restage path
that the qualified-staging workflow lacked.

## Resolution

The workflow now performs two-pass assembly. Pass one stages a deliberately
receiptless qualification closure. Each platform filters out the other
platform's npm-`os`/`cpu`-restricted runtime tarball, cold-installs the
remaining closure, runs the three-check packaged-store suite, and mints a
receipt beside its extracted runtime binary. Pass two restages the original
source-bound runtime artifacts with both receipts wired into package
preparation, then sends that receipt-qualified closure to both staged proofs.

`scripts/qualified-staging-ledger-check.mjs` is now fail-closed by default: it
opens every runtime tarball and requires the packaged receipt's v1 schema and
`single_table_v1` capability id. Only the explicit pass-one environment switch
may admit missing receipts. Synthetic tarball tests cover absence, that narrow
opt-out, valid receipts, type mismatches, non-runtime packages, and the
pre-existing ledger closure fields.

## Local flip evidence — 2026-08-07 (darwin-arm64)

Repro paired the worktree at `145fc2b6a` with the published 0.1.13
`public-package` runtime binary (`gitCommit b975f003b`, clean release), its
shipped receipt deliberately removed:

- **Pass 1 (receiptless staged closure):** `snapback-publish` dry-run staged
  a 0.1.14 closure; `snapback-package-cold-install.mjs --install-source
  staged` failed in the expo-chat starter acceptance with exactly the EAS
  signature — `schema.load ok:true`, `functions.load ok:false`, three
  `SNAPBACK_CAPABILITY_UNSUPPORTED` diagnostics (`conversationDetails`,
  `messagesForConversation`, `users`), starter-acceptance receipt
  `status:"failed"`, dev exited 1.
- **Mint:** `scripts/packaged-store-qualification.mjs` against that closure:
  suite `packaged-store-qualification-v1` 3/3 pass, receipt minted beside the
  binary. The new wrapper (`qualified-staging-store-qualification.mjs
  --platform darwin-arm64`) reproduced the same mint end to end from the
  closure's own runtime tarball.
- **Pass 2 (restaged with receipt):** the runtime tarball then contained
  `package/bin/packaged-store-qualification.receipt.json`; the same
  cold-install run produced zero `SNAPBACK_CAPABILITY_UNSUPPORTED`
  diagnostics, the expo-chat and create-snapback-app legs passed, and the run
  proceeded to the final retained-comparator identity check — which failed
  only because this hybrid repro pairs a 0.1.13 binary with a 145fc2b6a
  ledger, an impossibility in the real lane where the binary is built at the
  candidate revision.
- **Gate discrimination:** the new fail-closed ledger check refuses the pass-1
  runtime tarball (receipt missing) and admits the pass-2 tarball
  (`snapback.packaged-store-qualification.v1` / `single_table_v1`).
- **Published closures:** 0.1.11 and 0.1.13 runtime tarballs (both platforms)
  carry the receipt; booting the published 0.1.13 binary with the receipt env
  the CLI wrapper sets advertises `single_table_v1` (supported, no gap, no
  qualification-mode marker). The published registry path does not exhibit
  this defect. A bare-binary boot without the CLI's env forwarding does not
  load the sibling receipt — that is the designed loader seam, not a defect.

## Close-out

Closed 2026-08-26 (July/early-August leftover sweep). The two-pass
qualified-staging assembly is in `.eas/workflows/qualified-package-staging.yml`
(`qualified-staging-store-qualification.mjs` per platform, then Restage
qualified). `scripts/qualified-staging-ledger-check.mjs` is fail-closed.
The full qualified ceremony plus `latest` promotion is recorded at
`tests/acceptance/publication/promotion-receipt-0.1.18.json`; newest
published closure at sweep time is 0.1.27. The original
`SNAPBACK_CAPABILITY_UNSUPPORTED` / missing
`bin/packaged-store-qualification.receipt.json` defect is gone.
