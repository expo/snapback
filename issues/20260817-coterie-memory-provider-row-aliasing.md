# Coterie memory provider leaks backing rows through direct list queries

**Filed:** 2026-08-17 · **Status:** Open · **Systems:** Demos, Contract,
Provider adapters, Testing

**Related:** LLP 0266; `demos/coterie/src/data/memory-provider.ts`

## Problem

The memory provider's direct table queries clone the delivered array but can
still expose its backing row objects. A subscriber that mutates one of those
objects can therefore mutate provider state without going through a declared
mutation. The `listProfiles` occurrence was fixed at its delivery boundary in
the avatar selected-state closure; an isolation regression now pins that row
ownership.

The remaining occurrences found in the same-file query survey are:

- `listSession`: returns the backing `Session` rows directly.
- `searchSocial`: filters into a new array while retaining the backing
  `SearchResult` row objects.

The other current list/projection queries construct fresh result rows and do
not share this backing-row alias: `listFeed`, `listThread`,
`listProfilePosts`, `listChats`, `listMessages`, `observeTyping`, and
`listInsights`. `listProviderClaims` also creates fresh rows and has no backing
provider table.

## Wanted

Clone rows at the delivery boundaries for `listSession` and `searchSocial`,
using the file's existing `cloneRows` idiom. Add isolation regressions that
mutate a delivered row and prove a fresh snapshot remains unchanged. Keep the
declared provider shapes and compatibility tokens unchanged because this is an
ownership fix, not a value-shape change.
