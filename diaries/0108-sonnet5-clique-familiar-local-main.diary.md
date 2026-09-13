# Diary 0108: Sonnet 5 Clique Familiar on unpublished local main

**Date:** 2026-08-22
**Run:** `benchmarks/runs/2026-08-22-clique-local-main-sonnet5/`
**Lane:** Claude Sonnet 5, Clique M1–M8, Familiar authoring profile
**Backend:** local source commit `b70caf19eae1d4763224ebd182955e04430a67eb`
**Outcome:** all 8 milestones reported green, but verified by a hand-authored
headless acceptance suite (`acceptance.mjs`/`bun run prove`, 43 checks by
M8), **not** the frozen two-browser Playwright choreography the Explicit
lane used — a disclosed methodology gap that makes the two lanes' "green"
not directly comparable in rigor. 869,856 output tokens, 599 tool uses,
1h57m56s build wall (14:18Z–16:16Z) plus wrap-up.

N=1 diagnostic evidence, not scored or claim-eligible. Full diary, essay,
final report, and generated app remain under
`/Users/ccheever/clique-main-20260822/familiar/` on this machine (outside
git). **Read this diary together with
`issues/shelved/20260822-membership-visibility-read-denial-needs-reverify.md`** —
the most important finding of this run is there, not summarized away below.

## The headline finding: a shipped, disclosed privacy regression

M3 (messaging core) hit a read-path failure the lane could not resolve: a
presentational table visibility-scoped to conversation membership would not
reliably return rows to a genuine, bona-fide member, reproduced three
separate ways (a plain indexed query, the documented sanctioned
`requireRole` + `elevated.query` sequence, and a bare `ctx.db.get` on a row
that had definitely committed in an earlier mutation). After about a dozen
isolated repro attempts, the lane made a disclosed compromise rather than
lose the milestone: `messages`, `messageReceipts`, `messageReactions`, and
the presentational `conversationMembers` table are **public-read** in this
build, with a manual `assertConversationMember` check bolted onto the write
paths as partial mitigation. Any authenticated user who knows or guesses a
conversation id can currently read its messages. The lane logged this
plainly rather than quietly shipping it.

In M5, chasing a different gap, the lane found what may be the actual root
cause: `dmCreate`/`groupCreate`/`addMember`/`promoteMember`/`removeMember`
had been inserting the **users-table row id** (`v.id('users')`) into
`conversationMembers.userId`/`conversationAuthority.userId`, both declared
`v.principal()` — a type confusion invisible since M3 because nothing had
ever actually checked membership until the lane added the missing
authorization check itself. Fixed by routing through `users.ownerId`.

**What's explicitly unresolved:** whether the M3 symptom was entirely caused
by this type-confusion bug (in which case membership-visibility reads work
as documented, and the lesson is purely "branded types would have caught
this"), or whether there's a separate, real defect in the read path that the
now-shipped public-read compromise is currently masking. The lane
deliberately did not re-test with corrected principals to find out, and
said so rather than guessing — filed as
`issues/shelved/20260822-membership-visibility-read-denial-needs-reverify.md` for
someone to actually re-verify.

## What else went well

Familiar's `defineAuth` password flow, membership/roster primitive
(`.membership()` + `ctx.membership.<id>.bootstrap/insert/setRolePrincipal`),
and idempotent set-state pattern (likes/reposts/reactions/follows/poll
votes, all the same shape) drew consistent praise across the diary — "more
expressive than anything I'd hand-roll on top of Convex's row-level
`ctx.auth.getUserIdentity()` checks." M7's schema evolution (an additive
optional field, an idempotent backfill mutation verified against a
pre-migration snapshot, forward maintenance in existing write paths) was
"routine — no special migration DSL, no separate migration file, just a
schema edit and `bun run generate`," favorably contrasted with a
Postgres/Prisma migration-and-backfill dance. Two clock-dependent-live-query
refusals (`SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`, hit in M5 and again in
M8) were read, on reflection, as the platform being *more* correct than
expected — "a subscription's authorization silently drifting with wall-clock
time is exactly the kind of thing that should be refused by construction" —
though the lane also noted no guide page connects that diagnostic to its two
sanctioned escape hatches (move the clock read into a mutation; declare
`delivery: 'read'`), costing rediscovery time on each of the three separate
hits.

## Disclosed scope cuts (deliberately not claimed as green)

- **The frozen Playwright choreography was never stood up.** All 43 checks
  are the lane's own headless multi-persona acceptance suite driving the
  generated API directly against a live dev server — real, not mocked, but
  not the instrument the Explicit lane was verified against. Web screens
  exist and the bundle compiles at every milestone boundary, but UI depth is
  uneven (M1–M3 have real interactive screens; M4's reaction picker and
  inline media are backend-complete but not wired into `chat-screen.tsx`;
  M5–M8 are backend/acceptance-only, no dedicated screens).
- Cold-start offline reads, queued offline writes, and durable-queue-restart
  (M6/M8) were not attempted — "I don't have a harness that can honestly
  simulate the backend is unreachable... I'd rather say not-attempted than
  fabricate a green check for a guarantee I didn't actually observe."
- M7 ran in the same continuous session, not a genuinely fresh, context-free
  one as the brief specifies for a real day-2 evaluation — the migration
  mechanics are demonstrated, "a stranger picks this up cold" is not.
- The daily digest is a callable sweep, not wall-clock-scheduled — Familiar
  has no cron primitive (an Explicit-only feature).
- `private-strict` message-media delivery failed for an ordinary session
  client; fixed by switching to `public-immutable` **and** a freshly
  authenticated client in the same pass, with which change actually mattered
  never isolated — self-flagged as under-isolated, not a clean finding.

## Correction loops

6 total: 1 `environment` (the same runtime-readiness checkout-root class of
bug the Explicit lane hit, see
`issues/shelved/20260817-0275-auto-qualify-packaged-runtime-in-prove.md`), 1
`ambiguous`/doc-gap (`defineStarterVerifyProfile`'s receipt-shape
requirements are undocumented outside the template's own pre-authored
script), 3 `ambiguous` (the membership-visibility saga above, explicitly
left unresolved rather than force-attributed), 1 `agent-error` (the
`v.principal()`/`v.id('users')` type confusion — a real, load-bearing bug
that shipped silently for two full "green" milestones until a missing
authorization check exposed it).

## Bottom line

The lane's own closing thought, written before it looked at any timing or
token numbers: the persistent shape of friction across this build was
"Snapback enforces something correctly that I had modeled sloppily" —
clock-dependent visibility and the membership-table read-shape rule were
both, on reflection, the platform being right. The one clear counter-example
is the `v.principal()`/`v.id('<table>')` confusion: both are opaque strings
at the JS layer with no compile-time distinction, and the lane's explicit
recommendation is a branded/nominal type for `Principal` vs. `Id<table>`
that would have caught its own bug at `snapback generate` time instead of
two milestones later. That recommendation, and the still-open question of
whether membership-visibility reads have an independent defect, are carried
forward in
`issues/shelved/20260822-membership-visibility-read-denial-needs-reverify.md`.
