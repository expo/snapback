# snapback2: single-cell asset custody forces one upload per recipient for per-recipient grants; view-once one-use delivery not landed

**Filed:** 2026-09-06 by Claude Fable 5.1 from the Clique full run (benchmarks/runs/2026-09-05-clique-full-3x3), builder evidence as cited; raw lanes at /Users/ccheever/clique-full-20260905/lanes/.
**Status:** open · **Severity:** design gap (LLP 1006)

## Symptom
An asset can occupy one cell, so a recipient-specific view-once grant could not reference a shared upload (`E_ASSET_IN_USE`); the builder uploaded one copy per member. The published client types state that server one-use delivery has not landed, so the app cannot honestly claim single-fetch delivery while a grant stays open.

## Evidence
- `/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/run-log.md` epoch 1788629491 (M5), `/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/evidence/m5-acceptance.log`, `/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/lib/sendViewOnce.mjs`
- `/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/diary.md` M5

## Fix shape
Either admit N-cell references to one asset under a declared grant table, or give view-once a first-class delivery primitive; LLP 1006's asset RFC should rule which.

## Resolution

Resolved 2026-09-06 by lane L11: `image <=N once` gives server one-use delivery per authenticated principal (410 `E_ASSET_VIEWED` after), one upload and one owning row; the client `viewOnce` stand-in is deleted; main 50d5c628e (LLP 1006 §2a.1).
