# Owner visibility filters `ctx.db` reads inside explicit handlers; no declarative membership authority for conversation-shaped data

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`), lanes `sol-snapback-simplified` and
`sol-snapback-familiar` (0.1.21) · **Systems:** Security/authorization,
Runtime, Schema

**Related:** LLP 0231 (visibility grammar; the resolved disjunctive `anyOf`
ticket `issues/closed/20260811-visibility-grammar-disjunctive-relationship-scope.md`
covers table-level OR but not this), LLP 0056 (memberships)

## Problem

Two connected gaps around membership-scoped authority, which together were
the largest authority friction in the sweep:

1. **Owner visibility applies to server-side handler reads.** In the
   simplified lane, per-row owner visibility filtered `ctx.db` reads inside
   explicit named functions, so a handler running with full server authority
   could not let Bob resolve Alice's quoted message or let an inbox function
   join creator-owned conversation rows. The lane's forced workaround was to
   migrate `conversations`, `memberships`, and `messages` to public-read
   backing visibility (with no `.data` resource and membership checks
   re-implemented in every named function) — strictly broader storage
   visibility than the product wants, recorded by the lane as its material
   ownership migration. A server-authoritative function should be able to
   read on behalf of its own authorization logic; if handler-context reads
   are deliberately visibility-scoped, there must be a sanctioned elevated
   read doorway.

2. **Computed/membership access cannot be declared.** In the familiar lane,
   conversation membership could not be expressed as a declarative access
   rule, so every conversation, membership, message, and receipt handler
   repeated its own active-member/admin check. The simplified lane reports
   the same shape, and additionally that the richer membership authority
   profile in the published closure imposes a one-membership-command
   mutation model that cannot express atomic multi-seat group creation.

## Evidence

- `lanes/sol-snapback-simplified/diary.md` M3 + `final-report.md`
  ("Simplified resources, escapes, and ownership" — the public-read
  migration is flagged as authority friction, not neutral).
- `lanes/sol-snapback-familiar/diary.md` M3 + `essay.md` (authorization
  repetition; "the type system is less expressive than the domain").

## Suggested fix

Decide and document the handler-read authority model (elevated reads vs.
scoped reads with an explicit escalation API). Extend the visibility/
authority grammar so a membership table can gate another table's rows
declaratively (the LLP 0231 `anyOf` work is the natural base), and allow
atomic multi-membership creation inside one mutation. Until then, the guide
should present the repeated-handler-check pattern as the sanctioned recipe,
because it is where otherwise-correct realtime code goes subtly unsafe.
