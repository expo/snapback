# Snapback 4: "a device restores its session on its own" flakes under full-suite load

**Status:** Open (test reliability)
**Date:** 2026-09-23
**Scope:** `packages/snapback4/test/local-e2e.test.mjs`, the test "a device restores its session on its own".

It failed in two integrated full-suite runs on the M5: READAUTH's landing
and EDGES's landing. Both times the assertion `actual: undefined, expected:
'E_AUTH'` failed after about 50 ms. It passes alone (three of three on the
EDGES tree), and its whole file passes. It looks like a timing race that
shows under load, not a product regression.

**To do:** find the race (the test probably reads a denial before the
session restore settles), make the test wait on the real event, and confirm
it stays green in a loaded full-suite run.
