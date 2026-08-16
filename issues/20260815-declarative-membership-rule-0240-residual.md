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
([Familiar diary §M3](../diaries/0079-clique-0121-snapback-familiar.diary.md),
[Simplified diary](../diaries/0081-clique-0121-snapback-simplified.diary.md)).
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
