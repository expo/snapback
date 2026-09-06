# snapback2: the owner's asset staging ceiling (40 objects / 512 MiB) refuses reseeds and sample media

**Filed:** 2026-09-06 by Claude Fable 5.1 from the Clique full run (benchmarks/runs/2026-09-05-clique-full-3x3), builder evidence as cited; raw lanes at /Users/ccheever/clique-full-20260905/lanes/.
**Status:** open · **Severity:** capability under the brief's media envelope

## Symptom
Reseeding a project with fixture media, and the sample action log's media, hit `E_ASSET_TOO_LARGE` at the owner's staging ceiling of 40 objects or 512 MiB.

## Evidence
- `/Users/ccheever/clique-full-20260905/lanes/grok-snapback2/final-report.md` correction loop 12 and gap 6

## Fix shape
Decide whether the staging ceiling is a per-request or per-owner bound and make it configurable per project (the brief's fixture pack alone is 31 files); the refusal should name the ceiling and the project setting.
