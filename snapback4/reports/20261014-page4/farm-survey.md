# PAGE4 farm survey — fix list 11

Read-only inputs: all 100 wave-11 final schemas and the 50 odd-numbered wave-10
final schemas used by PAGE3. `survey.py` copies each schema to a temporary project
before invoking `check --json`. All 150 source hashes match before and after;
all checks exit zero. The saved JSON preserves every diagnostic and source hash.

Baseline source: `498f8110f9` (published 0.4.27 plus PAGE3). Final semantic source:
`193f94ea9d`. The binary SHA-256 is in the qualification manifest.

| Farm | Never complete before → after | Conditional before → after | Schemas with never-complete notes |
|---|---:|---:|---:|
| Wave 11 (100) | 16 → 6 | 6 → 6 | 9 → 4 |
| Wave 10 (50) | 2 → 2 | 0 → 0 | 1 → 1 |

“Never complete” counts the compiler's `N_NEVER_COMPLETE` code, including the
legacy aggregate note which can be complete for a static grant holder. It is
not a count of missing rows, and explicit conditional notes remain separate.

| Shape / lane | Never complete before → after | Conditional before → after |
|---|---:|---:|
| Named ordered audience unions/membership (003) | 3 → 0 | 0 → 0 |
| Exhibit exact point membership and conditional parent guards (005) | 1 → 0 | 2 → 2 |
| Conditional photo guard on an aggregate (021) | 0 → 0 | 1 → 1 |
| Timed negative publication witness (023) | 1 → 1 | 1 → 1 |
| Required parent snapshot (031) | 1 → 0 | 0 → 0 |
| Hidden parent owner / conditional comment guard (034) | 2 → 2 | 1 → 1 |
| Readable negative static role plus finite status enum (049) | 2 → 1 | 0 → 0 |
| Required parent snapshots (061) | 2 → 0 | 0 → 0 |
| Conditional parent/client audience (069) | 0 → 0 | 1 → 1 |
| Copied scopes plus publication pointer (075) | 3 → 2 | 0 → 0 |
| Owner/public/member union (079) | 1 → 0 | 0 → 0 |

Remaining never-complete notes:

- **023 spread:** negative evidence about the timed/private seal source. Pins
  can select a narrower member/self audience; they do not make private or
  future absence observable. No index/cap-only repair is claimed.
- **034 poolProposals / poolMembers:** a pool owner may not read the parent
  witness. PAGE3's complete repair is retained verbatim: checked immutable
  `poolOwner`, restrict-delete reference, original-writer check, writer payload
  and existing-row/seed backfill. It preserves readers because owner is immutable.
- **049 roomBudget:** unpaged sum keeps its streaming aggregate domain, outside
  the complete page planner. Noncontractors have an observable negative static
  grant. Contractors' scope can be pinned to an exact status, narrowing the sum;
  the whole page `selectionsFor` now has a complete enum-complement plan. The
  note calls the aggregate an analyzer limitation, not evidence of missing rows.
- **075 versionsOf / stemsOf:** more than one row-dependent witness, mutable
  publication pointer and copied child scopes. A successful song/version read
  alone does not prove the child's band/song fields or disclose a hidden song
  witness. Extra snapshot pins explicitly narrow the result. No complete form
  preserving every original reader is claimed for these unchanged schemas. A
  child id is never equated with an unrelated parent table id in the advice.

Remaining conditional notes (six): 005 roomExhibits and pendingExhibits,
021 guessCount, 023 leagueTable, 034 proposalComments, 069 commentsOn. These
are complete for their named pinned-parent/member guard, and capped for other
callers. The forecast compound guard is now named explicitly. Their unpinned
reader fields are retained in the saved JSON. Aggregate/budget queries retain
aggregate-domain behavior, rather than becoming silent bounded sums.

Wave 10 retains only 033 poolProposals / poolMembers, with the same PAGE3
checked-copy/backfill remedy. No new note, binder refusal or source drift.

083's final schema already uses an admitted author list; a separate direct
author-id exact-W fixture verifies the original disjunctive shape, system W,
empty/missing witnesses, cursor scope and discovery cuts. 013's final schema
already scopes its search; a separate cross-membership online words fixture
and generated family verify the wider sound server form without widening
device holdings. These are tested reach extensions, not invented farm deltas.
