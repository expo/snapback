# Familiar expressiveness refusals: principals in structured interiors, stored-field retype, scalar query lowering

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`), lanes `sol-snapback-familiar` and
`sol-snapback-simplified` (0.1.21) · **Systems:** Schema/validation,
Query lowering, Migration

## Problem

Three expressiveness refusals that each forced a lane onto a weaker type
than the domain wanted:

1. **Principal validators are rejected inside structured arrays.** A
   recipient snapshot naturally typed as an array of principals could not
   be generated; both lanes fell back to server-authored principal-ID
   strings / `v.json()`. Safe in these implementations only because clients
   never author the snapshot — the type system is less expressive than the
   domain exactly where authority data lives.

2. **A stored field cannot be retyped even along a widening/JSON path.**
   The simplified lane's partially loaded `recipientSet` had materialized as
   JSON; the corrected concrete-array schema was refused as a stored-field
   retype, permanently pinning the workaround from (1). There is no
   documented evolution path from `v.json()` to a structured type for
   already-stored data short of the full migration machinery (LLP 0081/0160).

3. **Scalar object query results cannot lower.** A familiar query returning
   a single object had to become a one-row array. Convex-familiar authors
   will write `get`-shaped queries constantly; this papercut hits in the
   first hour.

## Evidence

- `lanes/sol-snapback-familiar/diary.md` M3 + `final-report.md` (backend
  correction loops: "scalar object query lowering refusal; …
  nested-principal … generation refusal").
- `lanes/sol-snapback-simplified/diary.md` M3 + `final-report.md`
  ("`recipientSet` remains server-derived `v.json()` because published
  structured interiors reject principal validators and the
  already-materialized JSON field could not be retyped").

## Suggested fix

Admit principal validators in structured interiors (or document the
sanctioned snapshot pattern prominently); define a supported
JSON→structured widening story tied into the LLP 0160 migration program;
lower scalar object query results.
