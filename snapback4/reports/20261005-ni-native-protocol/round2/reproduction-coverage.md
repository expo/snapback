# Round 2 reproduction coverage

Both supplied round-1 reviews were read in full. Retained-packet mutations copy
the original packet and rebind every changed evidence hash before validation.
The source distributions and original packets remain unchanged.

| Reproduction | Regression / retained control | Live qualification |
| --- | --- | --- |
| Astra 1: consumption and order leak across conversations | HTTP regression checks Eve's first view and consecutive local order keys; also checks a second asset in Alice's conversation | Reference backend used by every cell |
| Astra 2: asynchronous decoded cache reload | `async-viewonce-load`, `old-viewonce-refusal`; sticky driver failure regression | `async-viewonce` fails `m6-a04` after the cold screenshot |
| Grok 2: stale pixels with a retargeted crop | `retargeted-viewonce`, `stale-viewonce-pixels`, `wrong-prime-pixels` | `stale-viewonce` fails |
| Astra 3 / Grok 2: `m6-a05` credited without native or committed-screen read | `sent-native-a05`, `sent-screen-receipts`; current server corroboration remains independent | `wrong-receipts` fails for M6 and M8 |
| Grok 2: native snapshot outside receipt window | `late-native-snapshot` | Final good runs capture inside the window |
| Astra 4: empty MP4 boxes accepted as decoded video | `undecodable-video`; missing-decoder and valid synthetic fixture tests | `undecodable-video` is unmeasured despite recorder checker's success claim |
| Astra 5 / Grok 2: later successful search capture rejected | `search-retry` positive control; driver verifies no final name is published before success | Known-good and newest-first search pass |
| Grok 2: target is initially scrolled off | Driver starts with offscreen row, locates it, then publishes after fresh screen; `missing-post-scroll-screen` rejects | `newest-first` passes after recorded scroll |
| Astra 6: Bob renders after 600 ms | Chromium tests for 1.5-second success and bounded failure | `delayed-bob` passes; `late-bob` fails beyond 10 seconds |
| Astra coverage: no-op `Driver.reconnect` stays green | Real reconnect exercised for M6/M8; replacement with no-op causes two test failures | Both good reconnect segments pass |
| Grok 4: Darwin `Operation timed out` misclassified | `test_darwin_ssh_timeout` | Separate unavailable-host invocation is null |
| Grok 5: duplicate timestamps cover only 0.10 seconds | `short-duplicate-window`, `short-duplicate-samples`; reconnect regression checks actual sampling span | Good M6/M8 sample spans exceed five seconds |
| Fresh source review: buffered load above sequence cutoff | `buffered-viewonce-load`; backend-start regression | Guard remains active through backend readiness |
| Continuation: repeated presentation timestamps coalesced by Mac decoder | `test_repeated_presentation_times_decode_every_encoded_sample`; ten encoded samples must yield ten images; original M8 must decode all 1,344 samples | Final M8 and matrix requalified under `66763bd858` |
| Initial round-2 qualification: retained read screen unnecessarily requires new event | Earlier committed read positive rebound control; newer `sent` screen rejects | Entire final 19-cell matrix rerun after correction |

The [artifact results](./artifact-controls.json), [extra positive control](./additional-controls.json),
[live verdicts](./verdicts.json), and [archive index](./evidence-index.json)
retain the outcomes and source identities.
