# snapback2: Quarry rejects documented mid-body match statements

**Status:** Open
**Systems:** snapback2, quarry
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/quarry/src/program.ts:80-83, snapback2/packages/quarry/src/program.ts:113-128, and snapback2/packages/quarry/src/program.ts:166-188. The documented form of a match used mid-body, whose arms compute values that are intentionally discarded before a following write, is rejected because each arm is required to produce a final expression result. The compiler applies value-producing completion rules even when the enclosing statement context discards the match result, so the advertised control-flow form cannot compile. Add a statement/discard completion mode for non-final matches that accepts effectful arms and ignores their values while retaining the stricter value mode when a match result is consumed.
