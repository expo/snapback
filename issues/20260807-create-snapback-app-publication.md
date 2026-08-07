# create-snapback-app: publish in the next (0.1.12) promotion sweep

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
the next promotion (0.1.12 or whichever ships next) must do:

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
