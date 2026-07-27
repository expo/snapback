# Team Chat needs membership-scoped opaque room-history pagination

**Status:** Open
**Severity:** P1
**Systems:** Team Chat, Standard patterns, Authorization, Pagination
**Date:** 2026-07-26
**Governing:** LLP 0056, LLP 0065, LLP 0063 Step 6

The `team-chat/local-pressure-v0` checkpoint proves opaque keyset pagination
for each principal's recipient-owned inbox. It does not prove the required
product path: paging one protected room's history.

`defineOwnedKeysetPages` intentionally supports a single owner field and an
index shaped `[owner, cursor]`. A team room instead needs an index shaped
`[room, cursor]` plus a declaration-bound membership predicate. Raw page keys
or application-minted cursors would weaken the current authority-bound cursor
contract and are not acceptable workarounds.

## Needed decision

Extend an accepted query/profile authority with a closed
membership-scoped-keyset shape, or explicitly choose another portable
mechanism. The cursor must bind the app, function pair, room argument,
authorization partition and epoch, index/order schema, and target generation.

## Acceptance

- a member traverses a pinned multi-page room fixture without overlap;
- a non-member sees no room or cursor existence;
- malformed, cross-room, cross-user, cross-target, expired, and
  post-membership-change cursors fail with one safe coded outcome;
- membership removal invalidates an already-minted continuation before
  candidate evaluation;
- concurrent untouched rows are neither duplicated nor skipped under the
  admitted consistency contract;
- the query is index-served with a preregistered work/page bound; and
- the Team Chat pressure app uses the surface through headless and complete UI
  receipts.
