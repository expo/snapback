No production blocker found. One **Low coverage gap remains; it does not block landing**.

**Low — abort-listener cleanup lacks detecting coverage.** [read-work.ts:17](/home/ccheever/sb4-intent/review-pq-r5-astra/snapback4/packages/snapback4/src/read-work.ts:17).

Removing `.finally(clean)` from `withReadSignal` still passes all **235 targeted tests**. That mutation leaves an abort listener attached to the client’s lifetime signal after each completed request, accumulating callbacks during repeated refreshes.

The production cleanup is correct. **Smallest fix:** add a focused test that counts attached listeners and requires their removal after both successful and rejected requests. This is a test gap, not an observed production leak.

The port is sound: it introduces no dependency on removed LV machinery and does not restore withdrawal on touched dependencies. Ordinary commits retain and mark answers `revalidating` according to policy; `keep:false`, expiry, and scope resets still withdraw. The new change-version checks reject pre-change local bodies without preventing legitimate success after an episode deadline.

The reviewed scheduling paths preserve eight starts per turn and eight active attempts. Cancellation and lifetime expiry release capacity despite ignored aborts; expired attempts and delayed expiry retries rejoin the queue. FIFO coalescing, canonical React keys, due-only clock sweeps, and withdrawn-deadline floors passed.

The earlier findings have fixes and detecting coverage:

| Earlier finding | Regression coverage |
|---|---|
| Unknown-footprint final drain | `per-row-publication` |
| Floor-rejected completion overwrites newer data; floor raised after evaluation | `per-row-publication`, `per-row-boundaries`, `per-row-retry` |
| Abort corrupts transport diagnostics | `per-row-liveness` |
| Reset-version checks, including final publication | `per-row-publication`, `per-row-retention` |
| Queued `keep:false` retains invalidated data | `per-row-boundaries` |
| Unrelated writes erase remembered fallback | `per-row-retention` |
| Sweep refresh withdraws newer data; sign-out loses denial | `per-row-boundaries`, `per-row-retention` |
| Episodes start during queue wait or pre-invalidation acquisition | `per-row-retention`, `per-row-inflight`, React tests |
| Raw local resubscription bypasses policy | `raw-read-deadlines` |
| Late cancellation; in-flight `/changes`; selective-memory ticket barrier | `per-row-retention`, `per-row-inflight`, `remembered-answers` |

Independent removal controls across **24 variants produced 86 detecting failures**, including all round-5 fixes. I found no remaining stale-publication or membership-removal failure in those interleavings.

The rebuilt copy passed **235 targeted tests plus five React tests**. The real-clock 1,000-hook cases produced **zero loading renders** on wasm, Worker, and process, with replacement starts spanning more than two seconds. I did not rerun the full suite.

All builds, tests, and mutations ran in temporary copies. The review worktree remains unchanged.

**READY WITH CHANGES**