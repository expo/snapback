# Author decision: @expo/snapback-expo is not in the publishable closure

**Status:** Open — needs Charlie's ruling
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
