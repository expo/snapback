# snapback2: the Following-feed merge certifies well under the brief's 500-follow envelope

**Filed:** 2026-09-06 by Claude Fable 5.1 from the Clique full run (benchmarks/runs/2026-09-05-clique-full-3x3), builder evidence as cited; raw lanes at /Users/ccheever/clique-full-20260905/lanes/.
**Status:** open · **Severity:** bounds vs. envelope (LLP 1010 A5 merge)

## Symptom
A 500-follow user's Following feed as a 20-row enriched merge refused `E_BOUND` (examined 11,684 > 10,240; closure 5,860,100 > 4,194,304); 10 rows certified, so every visible page became two reads. The grok builder certified at `first 360` follow edges at most.

## Evidence
- `/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/run-log.md` epoch 1788626463; `/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/evidence/m2-check-3.txt`, `m2-check-4.txt`, `m2-check-5.txt`
- `/Users/ccheever/clique-full-20260905/lanes/grok-snapback2/final-report.md` correction loop 7 and gap 4

## Fix shape
Either the merge's examined accounting is too coarse for a fan-in whose lanes are prefix-keyed (each lane is a hoisted scan; the union bound need not be lanes × reserve), or the brief's envelope needs a documented partitioned-feed recipe. Decide which and paste the recipe in the refusal.
