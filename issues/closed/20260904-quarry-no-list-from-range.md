# Quarry: a mutation cannot build a bounded list from a range read

**Status:** Resolved — deliberately deferred
**Systems:** snapback2 compiler (`packages/compiler/src/quarry`), LLP 1010/1011 language record
**Date:** 2026-09-04
**Related:** LLP 1012 §3 implementation record

## What happened

Lane O1c wanted to record a message's original recipients on the row —
`recipients: [principal] <=50` — written at post time from the membership scan, so a later
`unsend` could `for r in msg.recipients:` without any range read or rule question. Quarry
has no comprehension, projection, or append: range reads produce a page, lists come only
from literals, bounded arguments, and fixed built-ins.

## What would fix it

The smallest addition is a bounded projection of a page into a list, e.g.
`recipients = memberships[conversationId] first 50 by byConversationPrincipal { .principal }`
yielding `[principal] <=50`, priced like the page it comes from. It needs an LLP 1010-style
amendment and a certificate rule (the list bound equals the page bound).

## Until then

See the sibling ticket on `or` hoisting; either fix lets LLP 1012's recipe return to
original-recipient fan-out.

## 2026-09-11 triage

**Priority:** deferred. **Disposition:** Open as a language capability request,
not a current acceptance defect.

Direct Quarry supports iterating an already bounded list/page/range (`guide
grammar`, `for`) but still has no list comprehension, positional projection,
or append surface that constructs `[T] <=N` from a page. No current guide card
claims otherwise. The original recipient-fanout motivation is stale after
commit `951e24da8` moved chat onto LLP 1019's engine-owned `deliver` custody
log and marked LLP 1012 §3 superseded; that does not erase the broader list
construction gap.

**Remaining acceptance:** an author-approved Quarry syntax and semantics,
static output cardinality, certificate/native/twin parity, diagnostics, and a
guide example. Close as unwanted only by an explicit language ruling, or as
implemented after those tests land.

## Resolution — 2026-09-11

The user delegated the remaining language choices for this queue. Accepted
LLP 1001 now explicitly defers both page-to-list projection and positional
list indexing. The motivating original-recipient fan-out no longer belongs in
application data: LLP 1019's engine-derived delivery log preserves that
custody. Neither syntax is required by the present loop/offline bars, so adding
a second collection surface and its certificate/twin semantics would expand
scope rather than fix a current defect. Reopen only with a concrete app need
that funds the full acceptance above.
