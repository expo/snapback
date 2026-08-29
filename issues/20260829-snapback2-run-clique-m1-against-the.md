# snapback2: run Clique M1 against the published snapback2 as soon as init and dev exist

**Status:** Open
**Systems:** snapback2, benchmarks
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-29
**Related:** LLP 1000, LLP 0329.016 §8, benchmarks/protocol.md

The benchmark is Snapback 1's (benchmarks/, Clique M1-M8, protocol.md). Gate rows from LLP 0329.016 §8: M1 time-to-first-green <= 1,200 s on a fresh agent against the PUBLISHED pin; Snapback-attributed correction loops <= 1; retrieval calls before first edit <= 2; pass^3 >= 0.8. Wire the harness to snapback2 the day 'snapback2 init' and 'snapback2 dev' land; until then the bar in rules/NOT-DOING.md is unmeasurable.
