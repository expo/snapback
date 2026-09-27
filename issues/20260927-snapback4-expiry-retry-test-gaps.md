# Snapback 4: the expired-reply retry has two unpinned properties

- **Opened:** 2026-09-27, from Grok's review of lane FK (`~/sb4-intent/reviews/fk-r0.grok.md`).
- **Severity:** Low. Test strength only; the landed code is correct.

Lane FK's recovery for an expired server reply (a live local watch retries,
paced and capped at one second) has two properties no test pins:

1. **The composed origin.** Deleting `|| origin === "composed"` at
   `packages/snapback4/src/local-query.ts:297` survives every test: the
   existing composed expiry case (`prediction-routing.test.mjs:575`) calls
   `evaluateLocal` without a watch. Give it a watch and assert
   `retryExpired === true`.
2. **The one-second cap.** `expired-server-watch.test.mjs:56` checks only the
   first four gaps (25/50/100/200 ms). Removing both caps still passes, and
   enough failures would push the delay past the 32-bit timer ceiling. Assert
   the gap stays at or below one second after the cap is reached.
