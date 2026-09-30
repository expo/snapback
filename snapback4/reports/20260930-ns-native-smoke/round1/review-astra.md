**NOT READY.** The timing and smoke-scope claims are supported, but automatic resource ownership needs changes.

1. **P1 — A name prefix does not establish simulator ownership.** [simulator.rs:34](/home/ccheever/sb4-intent/review-ns-r0-astra/snapback4/crates/snapback4/src/verbs/witness/simulator.rs:34) accepts any booted, available iOS device whose name matches. I reproduced selection of `foreign-device`, named `snapback4-smoke-manually-created`, without any creation record. The subsequent lease merely excludes another witness; it permits installation onto this unrelated device. Persist tool-created UDIDs and require that ownership evidence for automatic reuse.

2. **P2 — Free-port selection is not race-free.** [witness.rs:397](/home/ccheever/sb4-intent/review-ns-r0-astra/snapback4/crates/snapback4/src/verbs/witness.rs:397) reserves a port during preparation, then releases it after embedding that origin into the app. Backend startup also releases its reservation before spawning the listener. I reproduced another listener taking the released port, causing `E_WITNESS_PORT`. The other process survives, but an expensive build can become unusable. This handoff gap existed previously; automatic selection does not eliminate it. Ownership must extend through listener startup.

3. **P2 — Boot failures omit the created simulator’s structured identity from the receipt.** [simulator.rs:55](/home/ccheever/sb4-intent/review-ns-r0-astra/snapback4/crates/snapback4/src/verbs/witness/simulator.rs:55) prints the identity, then performs fallible boot operations. The caller records it only after selection returns successfully. A reproduced boot failure exited 1 and saved a receipt without `simulator`, `udid`, or `runtime`, while retaining the created device. Record creation before booting so failed-run receipts support cleanup.

Other requested checks:

- **Selection/concurrency:** unavailable and wrong-platform devices were excluded. Transitional devices are skipped and another device is created. Multiple matching devices use the first listed match, potentially an older runtime. Two runs choosing the same device safely produce one lease winner; the loser refuses even when another matching device is free. There are no automatic shutdown, erase, or delete calls.
- **Artifacts/cleanup:** the exclusive artifact marker passed the concurrent-writer reproduction. No new cleanup path targeting unrelated processes was found.
- **Failures:** missing-Xcode/runtime reproductions produced one actionable message, exit 1, and suppressed injected tool stderr.
- **Honesty:** all **555 retained files** matched their recorded hashes. Receipts support **221.724 s cold**, **83.511 s warm median**, and **186.191 s social**. Final retained helpers match the reviewed source. Docs correctly exclude queued-write replay and populated-history claims.
- **Budgets:** client **114 lines / 1,198 words**, witness **399 lines**, package README **300 lines**; starter READMEs are **40 / 122 lines**. No cap increase.
- **Explicit arguments:** UDID, port, and artifact overrides remain honored. The route adds runtime validation and backend `check`; no explicit-argument regression was identified.

Validation used Linux fake-`xcrun` reproductions and **36 passing Node checks**; the smoke tests used a temporary source-import redirect because generated `dist` was absent. Real macOS execution was assessed from retained evidence, not rerun. The checked-in simulator driver tests themselves are macOS-gated.

No repository files changed; nothing pushed.