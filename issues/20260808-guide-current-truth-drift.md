# guide: canonical authoring and capability pages contain current-truth drift

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Systems:** Guide, packaged development loop, auth, capability index
**Date:** 2026-08-08
**Related:** LLP 0041, LLP 0058, LLP 0061, LLP 0093, LLP 0187, LLP 0194

## Summary

The canonical authoring loop currently gives agents several mutually
inconsistent facts about the scaffold and published closure:

- `guide/getting-started/the-authoring-loop.md` says the `expo-chat` starter
  keeps the dev auth profile and that production adopts sessions, while the
  starter's checked-in schema already declares `auth: { mode: 'sessions' }`.
- The page says the registry's `latest` tag selects `0.1.8`. The authoritative
  `guide/published-closure.json` currently records `newestPublished: 0.1.15`
  and `newestQualified: 0.1.7`.
- `operating.packaged-dev-loop` in `guide/capabilities.md` still describes the
  expanded React closure as absent from the byte-verified public `0.1.0`
  closure, despite the authoring page's later 0.1.7 qualification account.
- The authoring loop tells generated-app users to run `npm test` and
  `npm run test:static`, while all three current templates declare
  `packageManager: bun@1.3.12` and their generated instructions use Bun.
- `clients.non-js` is phrased as “Published and maintained non-JS clients
  beyond Swift (Kotlin and Dart)” while its maturity is `partial`, its guide
  cell is a GAP, and no Kotlin or Dart client directory exists. The row reads
  like a shipped claim even though it is an aspirational gap.

These are high-leverage pages: AGENTS.md and the packaged authoring skill route
cold agents into them. The current guide checks pass because the facts are
ordinary prose rather than checked snippets or availability fences.

## Ask

Reconcile the current facts in the authoring loop and capability index against
the template schemas, package-manager declarations, publication ledger, and
implemented client inventory. Keep the useful distinction between the newest
published closure and the newest independently qualified closure, but source
both version values from one authority or otherwise make their drift checked.

## Acceptance

- The `expo-chat` auth description agrees with the shipped template and states
  the production identity boundary accurately.
- The displayed newest-published and newest-qualified versions agree with
  `guide/published-closure.json`; a later publication cannot silently stale the
  prose again.
- Generated-app commands use the template's declared package manager, or the
  page explicitly explains and verifies supported alternatives.
- `operating.packaged-dev-loop` and `clients.non-js` state shipped, partial,
  and GAP facts without reading as contradictory capability claims.
- `node scripts/check-guide.mjs` and the relevant template/package tests pass.

