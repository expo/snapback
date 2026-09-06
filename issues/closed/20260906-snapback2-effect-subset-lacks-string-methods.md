# snapback2: the effect TypeScript subset refuses basic string methods

**Filed:** 2026-09-06 by Claude Fable 5.1 from the Clique full run (benchmarks/runs/2026-09-05-clique-full-3x3), builder evidence as cited; raw lanes at /Users/ccheever/clique-full-20260905/lanes/.
**Status:** open · **Severity:** capability

## Symptom
`slice`, `substring`, `indexOf`, and `charAt` on strings are refused inside effect bodies, so a push-notification preview (first 80 characters of a message) had to be computed in the Node provider adapter instead of the effect.

## Evidence
- `/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/run-log.md` epoch 1788631628 (M6)
- `/Users/ccheever/clique-full-20260905/lanes/astra-snapback2/evidence/m6-check-4.txt`, `m6-check-5.txt`, `m6-check-6.txt`

## Fix shape
Admit the bounded string methods (they are pure and length-bounded by the input) in the effect subset; document the admitted method list on the effects guide page.

## Resolution

Resolved 2026-09-05 by wave 1 lane L5: the effect body library is ES2020 (63 globals kept, string methods included), main 4bb2ae094.
