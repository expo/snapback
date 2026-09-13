# Three G1-migration tables carry public-read because the Class-R policy IR cannot express their honest policy

**Opened:** 2026-08-16
**Severity:** P2 (documented residuals; enforcement now fail-closed everywhere else)
**Systems:** Security/authorization, Code generation
**Source:** LLP 0234 G1 corpus migration (per-backend choice table in the landing commit).

The G1 closure declared explicit policies on all 90 corpus tables, but three
cases got `public-read` as the narrowest EXPRESSIBLE policy while their honest
policy is narrower. Each is documented at the declaration site; this ticket
keeps them from disappearing into the migration report:

1. **messaging-snapback view-once tables** — honest policy is
   author-or-recipient, where the recipient set lives in a JSON map on the
   row. The IR's `any-of` composition has no vocabulary for map-keyed
   recipient authority. Candidate owners: a Class-R policy-language extension
   (deliberately deferred by the completion program), or restructuring the
   demo onto a membership table.
2. **pointing-room votes** — hidden vote values remain protected only by the
   declared handler `fieldBoundary:` residual; the row policy is public-read.
   This is LLP 0235's canonical Class-M case and stays with 0235.
3. **rbac appMembers app-scope announcements** — app-scope membership (no
   resource row) cannot be expressed because membership visibility requires a
   `resourceField`. LLP 0231's 2026-08-15 D7 amendment added bounded
   `resourceField: '_id'` self-resource visibility; evaluate whether an
   app-singleton resource row or a scope-level membership form closes this.

   **Resolved 2026-08-16:** LLP 0240 rollout steps 2–3 migrated RBAC to one
   `applications` resource row and one resource-scoped `appMembers` authority
   profile. `applications` uses the D7 `_id` form and `announcements` uses its
   `appId`; both now consume the same generated roster fact. The governed
   transition ledger records the narrowing, and no app-scope public-read
   residual remains for this demo.

Resolution shape: each case either gains an IR form that expresses it (then
the table narrows in a governed transition per LLP 0234 D5) or is explicitly
ruled acceptable-as-documented. None of these blocks G2 enforcement, which
landed with this migration.

## Author sitting 2026-08-16: dispositions for cases 1 and 2

Recorded in [LLP 0274](../../llp/0274-explicit-write-authority-postures.spec.md)
(the LLP 0264 sibling from the write-posture author sitting):

1. **messaging view-once** — ruled: restructure the row-embedded `grants` JSON
   map into grantee-owned grant rows. The read side then narrows with existing
   owner/membership vocabulary (a governed 0234 D5 transition) and the write
   residual (recipient stripping its own grant from the author's row) becomes
   an ordinary owner-policy delete. No map-keyed IR vocabulary is added. The
   restructure is implementation work under LLP 0274 D9.
2. **pointing-room votes** — unchanged: remains LLP 0235's canonical Class-M
   case; LLP 0274 explicitly keeps Class M out of scope.

Case 3 (rbac app-scope) was already resolved 2026-08-16 by the LLP 0240
rollout, as recorded above. This ticket now closes when the view-once
restructure lands and narrows the declaration in a governed transition.
