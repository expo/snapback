# create-snapback-app: publish in the next (0.1.13+) promotion sweep

**Opened:** 2026-08-07
**Area:** packages/create-snapback-app / scripts/snapback-publish-core.mjs
**Related:** LLP 0186 W2 (ecosystem scaffold entry point), LLP 0041
(packaging owner), LLP 0115 decision 9 (terminal npm identity),
issues/20260807-expo-chat-template-cold-install-coverage.md (same
promotion sweep)

`create-snapback-app` (LLP 0186 W2's named ecosystem entry point) exists
in-repo as a thin wrapper over the `@expo/snapback-cli` scaffold mechanism:
`packages/create-snapback-app/cli.mjs` calls `scaffoldApp`/`listTemplates`
programmatically, defaults to the `expo-chat` template, and is covered by
`packages/create-snapback-app/package.test.mjs` (file-list parity with
`snapback new`, CLI-owned refusal codes, registry-derived help). It is
registered in the canonical package-test inventory, the
`create-snapback-app-package` local-proof rung, and the README funnel test.

What it is deliberately **not** yet: part of the published closure. The
qualified release lane owns that step, and this ticket records exactly what
the next promotion (0.1.13 or whichever ships next; 0.1.12 shipped
2026-08-07 via the fast path without this package) must do:

1. **npm name availability check.** `create-snapback-app` is unscoped (it
   must be, so `npm create snapback-app` resolves). Before staging, verify
   the name is free on the public registry (`npm view create-snapback-app`
   should 404) or already owned by us; if it is squatted, escalate to the
   author — do not silently rename.
2. **Closure inclusion.** Add `create-snapback-app` to the publication
   inventory in `scripts/snapback-publish-core.mjs` (`PACKAGE_INVENTORY`
   and, if it participates in candidate promotion, `PROMOTION_PACKAGE_NAMES`)
   as part of the promotion change, so the ledger, receipts, and
   `published-closure.json` cover it. It is unscoped: source name and
   registry name are one identity, consistent with LLP 0115 decision 9.
   The staging step must swap the `workspace:*` dependency on
   `@expo/snapback-cli` for the released version, as it does for sibling
   workspace references.
3. **Cold-install coverage.** Extend
   `scripts/snapback-package-cold-install.mjs` so the packed
   `create-snapback-app` tarball is exercised from a clean directory
   (`npm create snapback-app` or direct bin invocation → scaffold →
   the same generate/typecheck legs the template legs already run). This
   is the same sweep as the expo-chat template leg tracked in
   `issues/20260807-expo-chat-template-cold-install-coverage.md`; do both
   together.
4. **Guide fence sweep.** `guide/getting-started/the-authoring-loop.md`
   documents `npm create snapback-app` under the
   `<!-- since: 0.1.12 unreleased -->` fence; the promotion that publishes
   the package clears that fence together with the expo-chat one (the
   fence checker will flag it as stale once `published-closure.json`
   advances).

None of this is faked in-repo: the publication inventory, promotion
receipts, and ledgers are untouched until the qualified lane runs.

## Progress 2026-08-07 (Lane D)

- **Item 1 (name availability): verified.** `npm view create-snapback-app`
  404s on the public registry as of 2026-08-07 — the unscoped name is free.
  Re-confirm immediately before the publish step of the promotion that
  ships it.
- **Item 2 (closure inclusion): landed now, staged-only — determination.**
  `create-snapback-app` is appended (last, after `@expo/snapback-vite` /
  `@expo/snapback-cli` respectively) to `PACKAGE_INVENTORY`,
  `PROMOTION_PACKAGE_NAMES`, and the publish script's `commonPackages`.
  This was assessed safe against the currently-published 0.1.11 closure:
  every consumer of the inventory is promotion-lane-only
  (`validatePackageRows` / `validateQualifiedPlatformReceipts` validate
  same-revision ledgers and receipts; the public-package-proof workflow is
  workflow_dispatch-only), the frozen-record drift gates execute at the
  recorded revision so 0.1.11-era records keep validating with 0.1.11-era
  code, `guide/published-closure.json` records versions only (no package
  list), and the cold-install unit fixtures derive from the inventory
  programmatically. The `workspace:*` → exact-candidate-version swap is the
  generic nameMap path in `stage()`; under the identity preset the unscoped
  source name is its own registry identity. Consequence: the next staged
  qualification run produces an 11-package closure; re-validating a
  pre-change (10-package) ledger with post-change code correctly refuses,
  which is the intended fail-closed behavior.
- **Item 3 (cold-install coverage): landed.** The cold-install script now
  exercises the packed `create-snapback-app` tarball from a clean consumer
  directory (materialized tarball install asserted, bin invocation →
  default expo-chat scaffold → packed install → offline generate →
  typecheck → static acceptance → live `npm test` receipt), gated on the
  ledger actually containing a `create-snapback-app` row so older ledgers
  remain verifiable. See the sibling expo-chat ticket for the template leg
  landed in the same change. Evidence note: unit fixtures cover the leg's
  receipt checks and gating; the leg's first end-to-end execution is the
  next staged qualification run after this change (0.1.12 published via
  the fast path before it), whose platform receipts now fail
  closed unless it passes
  (`packedCreateSnapbackAppScaffoldFromCleanDirectory`).
- **Item 4 (guide fence sweep): partially overtaken.** The 0.1.12
  fast-path sweep already cleared the `since: 0.1.12` fence in
  `guide/getting-started/the-authoring-loop.md`; the page now honestly
  labels `create-snapback-app` as "in-repo now; its npm publication rides
  the next promotion sweep". The promotion that publishes the package
  owns updating that phrasing.
- Ticket stays open until a promotion publishes the 11-package
  closure and clears the fences.
