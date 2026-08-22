# Membership-visibility reads may deny bona-fide members; needs re-verification independent of a found type-confusion bug

Status: Open

## Problem

During a diagnostic Clique (social-messenger) build on local-main Snapback
(commit `b70caf19eae1d4763224ebd182955e04430a67eb`), the Familiar-profile
lane hit a read-path failure it could not resolve within its correction-loop
budget, shipped a disclosed compromise, and later found a real bug of its own
that may or may not be the true root cause. Full detail:
`diaries/0108-sonnet5-clique-familiar-local-main.diary.md` (M3 and M5
entries) and the lane's own
`final-report.md` under `/Users/ccheever/clique-main-20260822/familiar/`
(outside git; correction loops 3-5).

**Symptom (M3):** a plain table `.visibility({kind: 'membership', ...})`
projecting off a separate `.membership()`-declared authority table would not
reliably return rows to a genuine, bona-fide conversation member — reproduced
three separate ways (a plain indexed query from a query handler, the
documented sanctioned sequence `ctx.permissions.<id>.requireRole(...)` +
`ctx.db.elevated.query(...)`, and a bare `ctx.db.get` point lookup on a
message that had definitely committed in an earlier, separate mutation). This
is not the documented same-handler bootstrap race. After roughly a dozen
isolated repro attempts, the lane made `messages`, `messageReceipts`,
`messageReactions`, and the presentational `conversationMembers` table
public-read as a disclosed compromise, and added manual
`assertConversationMember` checks to the write paths as partial mitigation.
**This is a real, currently-shipped privacy regression in that diagnostic
build**: any authenticated user who knows/guesses a conversation id can read
its messages. (Scoped to a throwaway benchmark app outside this repo, not a
production Snapback deployment — but the read-path behavior it's chasing is
in this codebase.)

**Found later (M5), and the likely actual root cause:** `dmCreate`/
`groupCreate`/`addMember`/`promoteMember`/`removeMember` were inserting the
**users-table row id** (`v.id('users')`) into `conversationMembers.userId`/
`conversationAuthority.userId`, both declared `v.principal()` — every
non-creator membership row had the wrong identity type since M3, undetected
because nothing had ever checked membership for real until the lane added a
missing `assertConversationMember` check in M5 and watched it deny legitimate
members. Fixed by routing through `users.ownerId`.

**The open question this ticket tracks:** the lane explicitly did not go back
and re-enable declarative membership visibility with the corrected principals
to check whether the original M3 symptom (denial via the documented sanctioned
read path, and the bare `ctx.db.get` failure) disappears once the identity
values are correct. It is genuinely unknown whether:
(a) the M3 symptom was entirely caused by the M5 type-confusion bug (in which
    case membership-visibility reads work as documented and there is no
    platform defect — just a sharp corner that a nominal/branded id type
    would have caught at `snapback generate` time), or
(b) there is a separate, real defect in membership-visibility read
    resolution (or in `ctx.permissions.<id>.requireRole` + `ctx.db.elevated`,
    or in point-lookup consistency across transactions) independent of the
    identity-type bug, which the disclosed public-read compromise is
    currently masking.

## Reproduction

Not yet minimized as a standalone repro. The lane's shipped app
(`/Users/ccheever/clique-main-20260822/familiar/`, outside git, retained on
this machine) has the full history: the original public-read compromise,
the later-discovered type-confusion fix, and the still-shipped compromise
left in place. A minimal repro would: declare a `.membership()` authority
table plus a `.visibility({kind:'membership',...})` presentational table,
insert membership rows with correctly-resolved `v.principal()` values (not
`v.id('users')`), and confirm whether a genuine member can read via (1) a
plain indexed query, (2) `requireRole` + `elevated.query`, and (3)
`ctx.db.get` on a row committed in an earlier mutation.

## Suggested follow-up, independent of the above

`v.principal()` and `v.id('<table>')` are both opaque strings at the JS
layer with no compile-time distinction, despite meaning very different
things. A branded/nominal type for `Principal` vs. `Id<'users'>` (refusing to
assign/compare across them) would have caught the M5 bug at `snapback
generate` time instead of at a test the lane happened to add two milestones
later by choice, not because the platform demanded it. Worth considering as
a codegen/typing improvement regardless of how the read-path question above
resolves.

## Related

- `demos/coterie` and the Explicit-profile Clique lane
  (`diaries/0107-sonnet5-clique-explicit-local-main.diary.md`) did not hit
  this — Explicit's messaging schema was adapted from `demos/coterie`'s
  already-proven design rather than authored fresh, so it may simply never
  have exercised this exact combination.
- `benchmarks/runs/2026-08-22-clique-local-main-sonnet5/record.md`
