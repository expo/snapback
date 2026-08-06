# Author decision: @expo/snapback-expo is not in the publishable closure

**Status:** Open — widening landed-pending-release 2026-08-06; closes when 0.1.10 publishes `@expo/snapback-expo`
**Impact:** 4
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Packaging, Guide, Clients
**Date:** 2026-08-06
**Related:** LLP 0181 (zero-configuration Expo, G1 receipts), LLP 0041
(§First-publication latest bootstrap lineage), LLP 0122 (nine-package
closure), `guide/clients/react-expo.md`,
`issues/20260803-first-npm-latest-promotion.md`

## Summary

Found by today's promotion-machinery audit: the flagship zero-config Expo
path is uninstallable from npm.

- `guide/clients/react-expo.md` (frontmatter `maturity: shipped`) instructs
  `"plugins": ["@expo/snapback-expo"]` — the LLP 0181 config-plugin entry,
  witnessed by the G1 receipts under
  `demos/expo-golden-path-fixture/receipts/`.
- But `snapback-expo` is absent from the nine-package closure in
  `scripts/snapback-publish.mjs:36-49` (two runtime packages plus seven
  common packages) and has never been published. An npm consumer following
  the flagship zero-config path cannot install it; only the source-checkout
  install (`scripts/install-local-snapback-packages.mjs`) works today.
- An interim published-closure fence (`<!-- since: 0.1.10 unreleased -->`
  with the rendered banner) now marks the affected section of
  `guide/clients/react-expo.md` so the guide stays honest meanwhile.

## Ask

Charlie's ruling:

1. Widen the closure to ten packages at the next release? Note the
   first publication of a new name triggers npm's auto-`latest` bootstrap
   case recorded in LLP 0041 §First-publication latest bootstrap lineage,
   so the first `@expo/snapback-expo` publish needs that lane's handling.
2. Or keep `@expo/snapback-expo` source-checkout-only for now, with the
   guide fence as the standing honesty marker?

## Execution (2026-08-06, landed-pending-release)

Sitting #4 ruling 2 (`issues/closed/20260806-author-decision-sitting-4.md`)
approved option 1. The widening is landed:

- `scripts/snapback-publish.mjs` `commonPackages` and
  `scripts/snapback-publish-core.mjs` `PACKAGE_INVENTORY` now carry
  `@expo/snapback-expo` as the tenth member, ordered directly after
  `@expo/snapback-react` (its two dependencies, client and react, precede
  it; cli/vite do not depend on it).
- `package.json` already matched the closure shape (explicit `files` list
  including `config-plugin.cjs`/`app.plugin.js`/`provider.mjs`,
  `publishConfig.access: public`, `workspace:*` internal dependencies that
  the staging step stamps to the exact release version, same as
  `snapback-cli`). The README gained the checkout-independent documentation
  funnel and joined `scripts/package-readme-funnel.test.mjs`.
- Closure-size pins updated: the two literal `9`s in
  `scripts/snapback-package-cold-install.test.mjs` now derive from
  `PACKAGE_INVENTORY.length`; the staging-ledger refusal message derives its
  count from the active inventory (the legacy ccheever-preset lineage
  ledgers stay nine-row and still validate).
- Deliberately NOT widened: the leased-promotion vector
  (`PROMOTION_PACKAGE_NAMES` in `scripts/snapback-publish-core.mjs` and
  `packages/snapback-publication-authority/`, plus its schemas). The first
  `@expo/snapback-expo` publish is the degenerate first-publication case —
  npm auto-assigns `latest`, and there is no distinct prior root for the
  leased machinery to verify. Per LLP 0041 §First-publication `latest`
  bootstrap lineage, that lane's handling belongs to the 0.1.10 release
  close-out (which also sweeps `guide/published-closure.json` and the
  react-expo guide fence).
- Staging proof (JS closure): `scripts/snapback-publish.mjs` has no
  runtime-free platform selection (the runtime packages are assembled at
  the pinned SHA on the platform machines at release time), so the local
  proof staged the eight non-runtime members of the widened
  `PACKAGE_INVENTORY` with the same manifest stamping and
  `validateInternalDependencyClosure` path as `stage()`, then
  `npm publish --dry-run` per tarball: eight `dry-run-ok` rows in ledger
  order including `expo-snapback-expo-0.1.10.tgz`
  (sha256 `87e343cdf40fe54957e9c62c5b9460fa538b32447a23e496c1500cd140dc19c9`).
  The expo tarball packs `config-plugin.cjs`, `app.plugin.js`,
  `provider.mjs`, the app-binding schema, and exact registry-resolvable
  `"@expo/snapback-client": "0.1.10"` / `"@expo/snapback-react": "0.1.10"`
  dependencies — no `workspace:`/`file:` specifiers survive staging.

Leave this ticket open until the 0.1.10 publication makes
`@expo/snapback-expo` installable from npm; record the release receipt here
and move to `issues/closed/` then.

- **2026-08-06 (publish claim):** the 0.1.10 ten-package publish is held by session 86767887 (the sitting #4 recorder), executing now via the LLP 0041 fast-path. Sibling sessions: do not publish 0.1.10; artifacts built elsewhere should be discarded.
