# Decide honest-narrowest table visibility for the frozen zerobugs control

**Status:** Open — author decision required
**Systems:** zerobugs control / auth / table visibility / acceptance fixtures
**Date:** 2026-08-24
**Related:** LLP 0182, LLP 0183, LLP 0231,
`issues/20260824-zerobugs-control-generate-refusal-assetattachment.md`

## Why this is deferred

The LLP 0183 D1 control is a frozen parity instrument. Lane M2 declared every
table `public-read` solely to preserve the control's existing observable
behavior while satisfying LLP 0231 D2; it did not change the handler-level
authority in `demos/zerobugs/control/snapback/functions.mjs`.

An honest-narrowest migration would change which rows ordinary `ctx.db` reads
can see and would require explicit elevation, parent-derived policy, a role
declaration, field masking, or some combination. That is an author decision,
not a mechanical follow-up. The notes below inventory what the implemented
function boundary suggests; they do not authorize a schema change.

One cross-cutting exception must be designed deliberately: the acceptance-only
`fixtureInspectTable` lets any authenticated session inspect every fixture
table before the first identity binding, then closes the surface
(`functions.mjs:714-730`). An honest migration should make that bootstrap read
explicitly elevated/governed rather than letting it determine ordinary table
visibility. The crew-only `lane4StateAudit` is the other intentional broad
reader (`functions.mjs:2319-2353`).

## Per-table analysis

- **`user` — public row visibility, with field boundaries.** Public live
  queries enumerate user presentation rows (`functions.mjs:3345-3377`), but
  the public projection deliberately omits `email` and `githubID`
  (`functions.mjs:2690-2699`); `githubID` is released only for the bound
  identity (`functions.mjs:4268-4287`) and email is consumed for notification
  delivery. Suggested row policy: `public-read`; separately declare/mask those
  two fields.
- **`project` — `public-read`.** Public live queries enumerate projects
  directly (`functions.mjs:3379-3417`), and labels/issues project their parent
  project.
- **`issue` — public rows or bound crew.** `assertIssueVisible` implements the
  exact read rule: `visibility === 'public'`, otherwise a bound crew user
  (`functions.mjs:262-271`); list materialization repeats that rule before
  release (`functions.mjs:3157-3159`). Suggested policy: a public-field/crew
  disjunction, which needs a declared role authority rather than trusting a
  caller role claim.
- **`viewState` — bound source-user ownership, plus explicit crew/bootstrap
  elevation.** Ordinary reads and writes constrain both `userID` and `issueID`
  to the bound actor (`functions.mjs:2150-2177`, `functions.mjs:2956-2967`).
  Because `userID` is a `user` id rather than a principal, this needs an
  identity-binding-aware owner policy or a principal field migration.
- **`comment` — inherit the parent issue's public-or-crew visibility.** Public
  comment reads first prove the parent issue visible
  (`functions.mjs:3727-3773`, `functions.mjs:3801-3825`); edit/remove authority
  is comment creator or crew (`functions.mjs:2007-2078`). A parent-composed
  policy is narrower than independently public comments.
- **`label` — `public-read`.** Public label queries enumerate labels and their
  projects (`functions.mjs:3299-3343`, `functions.mjs:3461-3536`). Crew-only
  creation is a write-policy concern (`functions.mjs:2082-2137`).
- **`issueLabel` — inherit creator-or-crew authority from the parent issue.**
  This source join is read for issue label mutation/cleanup only after
  `assertCreatorOrCrew` (`functions.mjs:1678-1760`) and by the crew audit; the
  public graph uses `issueLabelRead` instead.
- **`emoji` — inherit the subject's parent issue visibility; creator-or-crew
  for mutation.** Public reads prove an issue or comment's issue visible before
  enumerating emoji (`functions.mjs:4011-4098`), while deletion is restricted
  to emoji creator or crew (`functions.mjs:1935-1946`).
- **`userPref` — bound source-user ownership, plus explicit crew/bootstrap
  elevation.** Both live read and mutation constrain `userID` through the
  identity binding (`functions.mjs:2181-2207`, `functions.mjs:3623-3644`). As
  with `viewState`, the stored owner is a `user` id, not a principal.
- **`issueNotifications` — bound source-user ownership for ordinary reads,
  with elevated mutation/effect maintenance.** The public detail path returns
  only the viewer's row (`functions.mjs:2969-2978`), and subscription updates
  write only the bound actor's row (`functions.mjs:1768-1813`). Notification
  recipient construction legitimately scans all subscribers inside an
  authorized mutation (`functions.mjs:1257-1280`), so that read needs explicit
  elevation under an owner policy.
- **`identityBinding` — principal owner visibility, with a governed bootstrap
  override.** Normal resolution is exact on `principal === ctx.auth.userId`
  (`functions.mjs:230-249`). Actor binding must also check global one-to-one
  uniqueness before inserting (`functions.mjs:782-817`); those bootstrap
  checks should be visibly elevated rather than making every binding public.
- **`authorityProbeMembers` — principal owner/private membership visibility.**
  The only application operations are authenticated self insert/remove through
  the membership API (`functions.mjs:193-224`); no raw roster read is part of
  the control.
- **`authorityProbeState` — principal owner visibility.** Every lookup is
  indexed by `userId === ctx.auth.userId`, and writes use that same principal
  (`functions.mjs:179-224`).
- **`projectUserRead` — `public-read`.** This is a presentation read model used
  by public project/user pickers (`functions.mjs:3646-3724`,
  `functions.mjs:4183-4244`), not the permission-backing membership table.
- **`issueListRead` — the same public-row-or-bound-crew policy as `issue`.**
  The list engine reads the materialized rows, then applies the exact
  `visibility === 'public' || viewer.role === 'crew'` boundary before any
  release (`functions.mjs:3126-3160`).
- **`issueLabelRead` — inherit the parent issue's public-or-crew visibility.**
  The public list engine uses these edges only to filter already-authorized
  issue roots (`functions.mjs:3014-3042`, `functions.mjs:3157-3179`). The row
  lacks a visibility field, so honest enforcement needs parent composition or
  a denormalized authority key.
- **`issueSearchDocument` — public partition or bound crew.** Search explicitly
  selects only `public` for an anonymous/ordinary viewer and adds `internal`
  only for crew (`functions.mjs:3044-3087`). Suggested policy mirrors the
  `issue.visibility` disjunction.
- **`searchEpoch` — public partition or bound crew.** The same visibility-class
  loop reads public epochs for ordinary viewers and both classes for crew
  (`functions.mjs:3044-3060`); this table should share the search-document
  policy.
- **`fixtureIngestLedger` — no ordinary app visibility; governed acceptance
  bootstrap only.** Its query surface is authenticated and closed to the
  receipt-bound fixture/overlay plan (`functions.mjs:615-711`), while ingest
  uses it for ordered idempotent batches (`functions.mjs:522-585`). This calls
  for explicit acceptance elevation/override, not a public table.
- **`notificationIntent` — frozen crew-administrator/system delivery only.**
  Leasing verifies a bound crew user and the one frozen admin source id before
  scanning intents (`functions.mjs:4542-4568`). Ordinary application mutations
  may insert intents atomically, but that is write authority, not read
  visibility. Suggested read policy: crew/operator-only, with a system lane for
  delivery if the acceptance-only worker becomes production.
- **`notificationAttempt` — frozen crew-administrator/system delivery only.**
  Attempts are read and settled only behind the same exact operator guard
  (`functions.mjs:4542-4623`, `functions.mjs:4643-4703`), plus the crew audit.
- **`unsubscribeTokenUse` — bound source-user ownership plus token-capability
  lookup.** Consumption first proves the session/source-user binding, checks
  the token digest, and inserts a row owned by that actor
  (`functions.mjs:4294-4336`). The stored `userID` needs the same
  identity-binding-aware policy as other per-user overlays; digest lookup is an
  explicit elevated capability check.
- **`assetAttachment` — `public-read` at row level, with field boundaries and
  owner/crew write-maintenance rules.** The public gateway resolves an
  attachment by opaque key and returns only key/asset/type/size
  (`functions.mjs:4441-4463`). Attach deduplication is owner-checked
  (`functions.mjs:4384-4437`), and cleanup is owner-scoped except for crew
  (`functions.mjs:4466-4495`). `owner` should not become a public projected
  field merely because the delivery alias is public.

## Author decisions needed

1. Whether to add principal fields to the three source-user-owned overlay
   tables or teach the policy vocabulary to compose through `identityBinding`.
2. How parent-derived visibility for comment/emoji/join/read-model rows is
   represented without changing the frozen source shape.
3. Which acceptance seams receive governed `ctx.db.elevated` reads and whether
   they remain in the control after the parity program closes.
4. Which user/asset fields get formal `fieldBoundary:` declarations pending
   the shipped class-M implementation.
