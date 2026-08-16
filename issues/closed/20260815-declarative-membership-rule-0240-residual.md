# Declarative membership/role rule: finish LLP 0240 so group handlers stop hand-rolling active-member checks

**Filed:** 2026-08-15 · **Source:** LLP 0236 R7 (Clique 0.1.21 exploratory
sweep, lanes `sol-snapback-familiar` and `sol-snapback-simplified`) ·
**Systems:** Security/authorization, Memberships, Code generation, Schema

**Related:** LLP 0240 (Accepted owner design: application authority
profiles), LLP 0236 R7 + open question 9 (evidence and done-criterion),
LLP 0231 D7 / LLP 0056 (visibility and membership machinery),
`issues/closed/20260815-owner-visibility-filters-handler-reads-membership-authority-gap.md`
(closed sibling: sanctioned elevated reads, membership `resourceField: '_id'`,
bounded bootstrap roster — this ticket tracks the remaining seam only)

## Problem

Computed member access is not available as a declared rule, so in the 0.1.21
sweep every conversation, membership, message, and receipt handler performed
its own active-member or admin check
([Familiar diary §M3](../../diaries/0079-clique-0121-snapback-familiar.diary.md),
[Simplified diary](../../diaries/0081-clique-0121-snapback-simplified.diary.md)).
The elevated-read and principal-array seams from the same sweep are closed;
this per-handler guard duplication is the still-open residual, and LLP 0236 R7
records it as differentiation work: none of the evaluated controls (Convex,
InstantDB, PocketBase; Supabase aborted pre-evidence) supplied a declarative
group-membership authorization language either.

## What done looks like

Implement LLP 0240's declared authority profile far enough that the ordinary
group pattern — member/admin authorization, bounded elevated reads, removal,
negative delivery checks, retained-history policy — composes without copying
the same guard into every handler. Partial authoring-surface implementation
exists (`packages/snapback-codegen` define/authoring `@ref` sites); the gap is
the compiled rule consumed by reads/writes plus the generated roster/role
projections, proven by the Clique group case in both profiles. The external
rerun contract in LLP 0236 already prohibits duplicated per-handler membership
guards where the product offers the declared path, and open question 9 is the
evaluation gate.

## Resolution

Closed 2026-08-15.

- Explicit and Familiar named queries/mutations accept the same
  authority-profile-backed `membership` predicate. Codegen lowers the finite
  role hierarchy once and inserts the backing membership table into the
  captured read set; authored Clique-shaped handlers contain no imperative
  permission guard.
- Generated reads use the non-terminal captured `allowsRole` evaluation and
  blank to `[]` on denial. Generated mutations use the same lowered rule
  through terminal `requireRole`. Runtime proof covers absent membership,
  insertion, removal, negative capture, and the terminal write twin.
- Every local app-owned profile generates bounded live
  `api.<profile>.list` and `api.<profile>.myRole` references. The first returns
  at most 100 `roster.visible` projections; the second returns only the
  server-derived caller's active row. Both preserve non-enumeration.
- LLP 0240 and the guide now state the qualified slice and its honest limits:
  pagination, generated transition hooks, retained-history support,
  search/assets, hosted profiles, and the external npm Clique rerun remain
  separate work. LLP 0236 open question 9 stays open until that rerun; this
  closure makes no competitive-effect claim in advance.

The external published-package rerun is tracked in
[`20260812-0247-0248-measurement-reruns.md`](../20260812-0247-0248-measurement-reruns.md),
and the protected-retention portion is tracked separately in
[`20260815-0243-authority-profile-protected-retention-rollout.md`](../20260815-0243-authority-profile-protected-retention-rollout.md).

The repository proof is `packages/snapback-codegen/rbac-authoring.test.mjs`
for both authoring profiles and
`runtime::membership_bridge_tests::allows_role_is_captured_non_terminal_and_observes_removal`
for the runtime removal/negative-delivery seam.
