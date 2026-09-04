# Quarry/certificate: the uniformity analysis does not hoist an `or` whose one arm is pinned by the index prefix

**Status:** Open
**Systems:** snapback2 compiler (`packages/compiler`), `snapback2-core` certificate (`uniform_visibility`)
**Date:** 2026-09-04
**Related:** LLP 1012 §3 implementation record; LLP 1001 §"Failure and disclosure semantics"

## What happened

Lane O1c of LLP 1012 tried to keep the chat template's delivery log private while
letting a message's author fan out tombstones over the rows they sent:

```q
table deliveries:
  sender: principal
  recipient: principal
  …
  by bySenderMessageKindRecipient: sender, messageId, kind, recipient, id
  read <- .recipient = viewer or .sender = viewer
```

A scan `deliveries[viewer, messageId, 'message'] by bySenderMessageKindRecipient` pins
`sender = viewer` through the prefix, so the rule is uniformly true over the range. The
certificate refused it (`E_STRUCTURAL_COUNT` at `deliveries.unsend.1`) because the
uniformity analysis collects every field used anywhere in the rule, both `or` arms
included, and `recipient` is not in the prefix.

## What would fix it

Hoist per disjunct: an `or` is uniformly true over a prefix when any one arm is
uniformly true over that prefix; uniformly false when every arm is. This is the same
hoisting LLP 1001 already does for a single term. With it, the recipe's tombstones reach
every original recipient without making the log public.

## Until then

LLP 1012 §3's recipe fans out over current members and departed members learn by point
absence (§5 rule 1).
