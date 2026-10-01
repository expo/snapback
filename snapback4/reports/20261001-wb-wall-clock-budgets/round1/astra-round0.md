**READY WITH CHANGES — two P2 findings.**

1. **P2: Presence refresh timing became “eventually.”**
   [presence-refresh.test.mjs:16](/home/ccheever/sb4-intent/review-wb-r0-astra/snapback4/packages/snapback4/test/presence-refresh.test.mjs:16) replaces the three-second guard with 122 seconds, while retaining only the assertion that refresh happens *no earlier* than requested. LLP 3000.018 specifies refreshing after the supplied interval.

   In scratch, adding four seconds to the first product refresh timer made the original test fail at three seconds; **all ten converted tests passed**. Preserve the interval check using controlled timers, with the hang guard bounding fixture completion separately.

2. **P2: The slow-reader replacement does not prove the server response remains blocked.**
   [http-bounds.test.mjs:251](/home/ccheever/sb4-intent/review-wb-r0-astra/snapback4/packages/snapback4/test/http-bounds.test.mjs:251) checks the client socket’s `readableFlowing` and `destroyed` flags. Both can retain their expected values after the server’s write timeout has ended the response.

   I delayed the probe by 6.5 seconds. Server latency records confirmed `/sync` had completed with a refusal after approximately 5.25 seconds, yet **the converted test passed**; the original failed. A regression holding the engine lock until that timeout could therefore escape. Assert that the server response remains unfinished when the probe completes, using server completion evidence or an explicit barrier.

The fallback conversion itself looks sound. Its answer, ordering, classification and replica-fence assertions remain. Scratch controls confirmed:

| Control | Original | Converted |
|---|---|---|
| Fallback publication delayed 6.5 seconds | Fails | Passes |
| Delivery response processing delayed 75 ms | Fails | Passes |
| Fallback publication withheld | — | Named `TEST_HANG` at 124 seconds |

I compared assertion changes across the changed files and sampled broadly across retention, expiry, PQ scheduling, admission, retries, browser fixtures, workers and search. The sampled one-second episode checks and PQ count limits remain intact.

Independent scoped execution covered 541 cases across 16 files. Three initial failures were missing guide fixtures in my scratch copy; their complete file passed after correcting that setup. I verified the 384-entry final test-source manifest and retained qualification hashes supporting the composite loaded runs and reported 1404-second full-suite pass. I did not rerun the full suite.

No reviewed files changed; nothing pushed.
