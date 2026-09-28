# Snapback 4: two test-strength gaps in the delivery fault matrix

- **Status:** Open
- **Date:** 2026-09-28
- **Area:** `snapback4/packages/snapback4/test/delivery-fault-matrix.test.mjs`, `delivery-fault-instrument.mjs`, `src/local.ts:1103`
- **Found by:** Grok's review of lane RG round 6 (`~/sb4-intent/reviews/rg-r6.grok.md` on the EPYC host); non-blocking Lows at landing

1. **Site 52 does not prove its retry is armed.** Changing `catch { retryFlush(); continue; }` to `catch { continue; }` at `local.ts:1103` survives the matrix and the controls: the tails still POST in the same pass. Nothing asserts that a timer is armed while the fault is held, so a failed acknowledged-receipt recovery might never be retried. Fix: for sites 52 and 80, after the three posts and while the fault is still enabled, assert `api.retry` as site 68 does (`delivery-fault-matrix.test.mjs:179`).
2. **A new helper `await` is not a matrix row until someone adds it.** Adding `await history.read(id)` in a helper that `flushOnce` calls, outside the owner allowlist, keeps the site list and recipes valid; refreshing the count and hash in `delivery-await-boundary.json` makes the census pass, and the new rejection is never exercised. Fix: drop the owner allowlist for files already in scope and keep an explicit waiver list of non-delivery awaits, so a new await fails `recipe()` until it is classified required or optional.
