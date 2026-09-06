# snapback2: the owner's asset staging ceiling (40 objects / 512 MiB) refuses reseeds and sample media

**Filed:** 2026-09-06 by Claude Fable 5.1 from the Clique full run (benchmarks/runs/2026-09-05-clique-full-3x3), builder evidence as cited; raw lanes at /Users/ccheever/clique-full-20260905/lanes/.
**Status:** open · **Severity:** capability under the brief's media envelope

## Symptom
Reseeding a project with fixture media, and the sample action log's media, hit `E_ASSET_TOO_LARGE` at the owner's staging ceiling of 40 objects or 512 MiB.

## Evidence
- `/Users/ccheever/clique-full-20260905/lanes/grok-snapback2/final-report.md` correction loop 12 and gap 6

## Current disposition (2026-09-06)
The asset-pending lane independently reproduces successful releases consuming the
20/40 pending-object quotas. Root directs separating those slots from released
ready originals while preserving the existing 256/512 MiB byte-admission charges;
no numerical limit or project setting changes. The original proposed configurable
ceiling is not the accepted fix.

Implementation/proof: `/Users/ccheever/clique-improvement/revisions/asset-pending-r1/implementation-report.md`
and its source/test/witness receipts. The isolated public Quarry witness is not
an original benchmark rerun. This ticket remains open for attribution and full
Clique/reseed verification; the original failure is not retroactively passing.
Separate inherited physical custody/GC work is tracked in
`20260906-snapback2-asset-custody-gc-follow-up.md`.
