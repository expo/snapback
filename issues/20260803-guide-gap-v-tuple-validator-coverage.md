# guide-gap: `v.tuple` validator has no guide coverage

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 4
**Confidence:** 4
**Systems:** Guide, Codegen validators
**Found by:** 2026-08-03 guide triage pass (delta verification of the
snapshot-batch v1 landing)
**Date:** 2026-08-03
**Governing:** LLP 0061

## Problem

`v.tuple(elements)` (1–8 element validators) landed in
`packages/snapback-codegen/define.mjs` as an author-facing member of the
exported `v` namespace with the snapshot-batch v1 work (27773f6e5). No guide
page mentions it: the only validator inventory the guide carries
(`guide/getting-started/your-first-backend.md`, deliberately partial) omits
it, and `guide/backend/queries.md` doesn't cover it either. Its only in-tree
consumer today is the snapshot-batch result contract, but it is exported and
directly usable, so an author can reach it with no guide answer for when it
is appropriate or what its bounds are.

## Suggested resolution

Either a line in the validator inventory plus a sentence in
`backend/queries.md` result-contract coverage, or — if `v.tuple` is meant to
stay an internal composition detail of snapshot batches — say so explicitly
where validators are enumerated so the omission is a statement rather than a
gap.
