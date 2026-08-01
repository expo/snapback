# Guide gap: reset invalidates sessions and changes local principal identities

**Status:** Open
**Impact:** 3
**Urgency:** 4
**Ease:** 5
**Confidence:** 5
**Score reviewed:** 2026-07-28
**Score rationale:** A normal Guide-led sessions demo hit two failed fixture strategies because the reset/identity lifecycle consequence was not adjacent to the reset seed loop. The correction is mostly documentation and a verified example.
**Severity:** P2
**Systems:** Guide, Sessions auth, Reset, Seeding, Memberships
**Date:** 2026-07-28
**Governing:** LLP 0039, LLP 0056, LLP 0061, LLP 0102

The Guide's normal authoring loop makes reset-based deterministic seeding look
applicable to a sessions-mode membership fixture, but does not place the
identity consequences where an author needs them.

The LLP 0102 Snapback Todo arm tried:

1. mint Alice/Bob/Mallory sessions to obtain server-issued principal IDs;
2. seed membership rows with those IDs through admin reset;
3. query with the minted sessions.

That failed with `SNAPBACK_AUTH_REQUIRED` because reset advanced the auth
boundary and invalidated the sessions. Reminting after reset did not solve it:
the same local email resolved to a different principal ID, so the seeded
membership rows named stale identities.

The correct resource-scoped design used authenticated
`ctx.membership.<declaration>.bootstrap(...)`, server-owned resource IDs, and
owner-authorized member insertion. It is secure and works well, but required
failed runs plus repository-example inspection to discover.

Evidence:

- `diaries/0027-todo-backend-bakeoff.diary.md`
- `demos/backend-bakeoff/arms/todo/snapback/work/snapback/handlers.mjs`

## Acceptance

- the reset/seed Guide page explicitly says reset invalidates existing
  sessions and that reminted local identities are not stable fixture IDs;
- the sessions and scoped-membership pages link to that warning;
- one CI-verified example shows deterministic fixture shape through
  authenticated resource bootstrap without application-owned IDs;
- the Guide distinguishes reset-safe dev principals from sessions-mode
  server-issued principals; and
- the capability index points sessions-mode membership seeding to the paved
  bootstrap path.

---

**RESOLVED 2026-08-01 (fix-wave docs sweep).** guide/auth/sessions-and-principals.md §"Reset invalidates sessions and reissues principals" states both consequences (pre-reset bearers fail; reminted identities are new principals), directs sessions-mode fixtures to authenticated resource bootstrap instead of captured principal ids, and distinguishes reset-stable dev principals. Cross-linked from guide/backend/versioned-seeds.md §"Run the loop against a sessions-mode app".
