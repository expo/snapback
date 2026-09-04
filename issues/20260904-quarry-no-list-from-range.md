# Quarry: a mutation cannot build a bounded list from a range read

**Status:** Open
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
