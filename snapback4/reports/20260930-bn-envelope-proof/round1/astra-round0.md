**NOT READY.** The acquisition and offline-retention evidence holds up, but reconnect verification can produce a false passing receipt.

1. **P1 — Failed reconnects can pass.** At [witness-acquire.js:198](/home/ccheever/sb4-intent/review-bn-r0-astra/snapback4/packages/snapback4/bin/witness-acquire.js:198), `client.sync()` returning does not establish successful synchronization. Requests that throw are absent from the recorded samples. I proxied a reconnect response with `events: []`, `more: true`, then dropped the next connection. The CLI exited **0**, recording **`passed: true`, `retained: true`, `downloadedRows: 0`**. HTTP 200 denial and malformed responses also passed. Require a validated, completed reconnect round and reject transport/protocol failures. [Reproduction](/tmp/bn-r0-astra-z61xy0ux/snapback4/packages/snapback4/test/cli-incomplete-reconnect.test.mjs), [failure log](/tmp/bn-r0-astra-z61xy0ux/cli-incomplete-reconnect.log).

2. **P2 — Reflected bearer tokens leak into output and receipts.** [witness-acquire.js:62](/home/ccheever/sb4-intent/review-bn-r0-astra/snapback4/packages/snapback4/bin/witness-acquire.js:62) accepts server refusal text verbatim; the error is subsequently serialized and printed. A local HTTP 401 responder that echoed the supplied synthetic bearer caused it to appear in **stderr, JSON stdout and `acquire.json`**. Ordinary successful receipts omit credentials, but “tokens never reach logs or receipts” is false. Redact the supplied token at output boundaries. [Reproduction](/tmp/bn-r0-astra-z61xy0ux/token-reflection.mjs).

3. **P2 — The report should name the unresolved native acquisition bottleneck.** The [report’s comparison](/home/ccheever/sb4-intent/review-bn-r0-astra/snapback4/reports/20260930-bn-envelope-proof/REPORT.md:45) acknowledges slower native acquisition without identifying the device path as follow-up work. Using its exact hashed production binary, my fresh heavy run acquired **105,034 rows / 1,000 conversations in 41.734 s**, with **2.670 s** server sync and **0.272 s** restart. Instrumentation measured **37.862 s in native `apply` round trips**, including one **35.506 s** call. This localizes the dominant cost to device application/IPC; it does not isolate the internal SQLite cause. Name that performance defect separately from the successful retention proof. [Profile](/tmp/bn-r0-astra-z61xy0ux/profile.log).

4. **P3 — Witness CLI diagnostics are inconsistent.** `witness acquire --wat` returns `E_INPUT`; `witness ios --wat` returns `E_WITNESS_INPUT`. Bare `witness` still advertises only iOS. Update the family usage and align input diagnostics.

The concrete checks for the four claims were:

| Claim | Result |
|---|---|
| Acquisition, retention, exclusive receipts | Existing tests **9/9 pass**. Wiped stores, deleted rows and changed coverage metadata reject. Disabling retention comparison makes the deleted-row and changed-history tests fail. Replayed rows reject; disabling the event guard makes that test fail. Reconnect completion remains defective as above. |
| Twelve measurements and reported medians | Recomputed all **12 receipts’** samples, medians, ranges, counts, coverage comparisons, server totals and recorded CPU conditions; they match `measurements.json`. One fresh heavy run reproduced the reported scale and timing. |
| Bounds recipe, aliases and HV guidance | All six aliases resolve to bounds. The recipe executes and its excerpt matches; removing `--restart` in scratch breaks its test. HV’s cited figures match its report. |
| Refusals and token secrecy | Invalid-input, unreachable-server and identity tests pass; disabling identity comparison breaks its test. Token secrecy fails the reflected-error reproduction. |

The receipts and guide correctly distinguish **native process-device evidence** from iOS UI, web, physical-phone and power-loss evidence.

All mutations and reproductions were confined to scratch. The reviewed checkout remains clean at `ea4ec7b99f`; nothing was pushed.