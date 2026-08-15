# guide-gap: no migration narrative for evolving a live app's schema under sessions deployment identity

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`), lane `sol-snapback-simplified` (0.1.21) ·
**Systems:** Sessions/deployment identity, Migration, Guide

**Related:** LLP 0081, LLP 0160 and
`issues/20260803-0160-migration-experience-program.md` (G6 is the guide
page; this ticket is sweep evidence for its priority and shape)

## Problem

The simplified lane's hardest non-authority episode was ordinary,
incremental schema evolution (M2 → M3) under sessions deployment identity:
a schema change rotated the deployment identity, interacted with the
sessions pin, and a recovery required booting the preserved exact M2
carrier and then letting the packaged dev successor path advance the pin
without discarding the database. The runtime diagnostics were accurate and
safe (exact expected/observed hashes, database preserved), but the lane had
to read packaged CLI source to understand startup carriers and automatic
successor activation. Its diary names "a clear migration narrative for an
app evolving one milestone at a time under sessions auth" as the largest
missing documentation piece.

That is the normal development rhythm for every app Snapback wants to
serve; the mechanism works but is currently source-readable rather than
guide-readable.

## Evidence

- `lanes/sol-snapback-simplified/diary.md` M3 ("sessions deployment
  identity made the M2→M3 schema evolution unusually exacting" …
  "packaged CLI source was decisive") and `final-report.md` fallbacks
  ("M3 deployment recovery mechanically composed a temporary carrier…").

## Suggested fix

Author the guide page (0160 G6) around exactly this loop: change schema →
identity rotates → what the pin means → how the successor path advances it
→ what the diagnostics' hashes refer to → the recovery recipe when a
partial load has materialized data. Link the diagnostics' error codes to
the page.

## Resolution

Resolved 2026-08-15 by `2e0e5e03a`. New
`guide/backend/schema-evolution.md` follows the requested loop, distinguishes
`schemaHash`, `bundleHash`, and shared `inputsHash`, explains the complete-pair
sessions pin and managed successor, and gives exact-carrier recovery recipes
for both startup mismatch and partially materialized incompatible data. The
capability row and retrieval case 56 route to it, and regenerated diagnostics
link the startup-artifact and schema-evolution codes to the relevant sections.

LLP 0160 G6 is closed with an implementation record, and its program ticket is
updated as the single continuing tracker. Proof:
`packages/snapback-cli/sessions-dev-loop.test.mjs`, `node
scripts/check-guide.mjs`, and `node scripts/check-retrieval-eval.mjs`.
