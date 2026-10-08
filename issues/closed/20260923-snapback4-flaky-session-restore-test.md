# Snapback 4: "a device restores its session on its own" flakes under full-suite load

**Status:** Closed
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


## Resolution — 2026-10-08, lane FT

Closed after verifying the already-landed repair `9473e0a347`. The test now
delays remote logout by 300 ms and polls for the server's `E_AUTH`; sign-out's
local completion is deliberately not the remote-revocation barrier. This is
the same incident resolved in [the September 27 record](20260927-snapback4-local-e2e-session-restore-flaky.md).
FT repeated the current case with its file neighbours under confined CPU load
and restored the old immediate read in a disposable negative control; that
control fails with the original `undefined` versus `E_AUTH` signature.
No product change or guard increase was needed. Final run counts, custody and
logs are in the [FT report](../../snapback4/reports/20261008-ft-client-flakes/REPORT.md).
