**READY WITH CHANGES.** I found no reproduced functional regression. Two requested guarantees still need qualification:

1. **P2 — Hours-long descriptor stability is unproven.** The [lifecycle regression](/home/ccheever/sb4-intent/review-fdl-r0-astra/snapback4/crates/snapback4/tests/serve_overload/fd_limits.rs:42) exercises three short cycles. My live-server probe completed 38,400 keep-alive requests across 30 cycles: descriptors repeatedly rose from **12 to 268**, then returned to **12**, including after idle expiry. This strongly supports cleanup, but neither measurement covers hours. Add the sustained-server measurement or explicitly limit the claim to the observed workloads.

2. **P2 — macOS runtime behavior remains unverified.** The [report](/home/ccheever/sb4-intent/review-fdl-r0-astra/snapback4/reports/20261002-fdl-fd-limit/REPORT.md:80) correctly discloses type-checking only. The policy appears correct: finite target, unchanged hard limit, preserved higher soft limit, and `min(OPEN_MAX, kern.maxfilesperproc)`. Apple’s [header](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/syslimits.h) and [resource-limit implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_resource.c) support the constants and kernel ceiling. Native execution with an unlimited hard limit is still needed to confirm the platform claim.

The individual claims check out as follows:

| Claim | Concrete result |
|---|---|
| **Parallel demand** | The recorded snapshot confirms **1,197 descriptors**, 96 active tests, and 987 socket handles; serial samples return to three descriptors. The repeated lifecycle test passed independently. Source inspection found no ownership cycle in the new shared abort handle; pooled `FnOnce` jobs consume their captured requests. The hours-long qualification remains open. |
| **Startup raise** | Linux syscall tracing confirmed the raise occurs **before the first socket or thread creation** in ordinary startup. Starting with soft/hard **256/256** succeeded and reported the low limit. Injected `getrlimit` and `setrlimit` failures both produced diagnostics while the server remained usable. The dev/serve lifecycle regression passed. |
| **Test initialization** | Audited the unit-server construction sites: they call the shared initializer directly or first construct an initialized `Host`. The low-limit many-server regression and policy tests passed. |
| **Clone failure** | The existing three-stage regression passed. Additional probes forced **2,000 failed connections at each clone stage**: zero response bytes, zero retained connection leases, and successful subsequent serving. No idle spin appeared. Another probe served **1,000 keep-alive requests under continuous real EMFILE**, confirming request parsing no longer duplicates the abort descriptor. |
| **Reported results** | Retained executable hashes match the report. The ten recorded runs and three witness failures match their logs. The full-suite log ends with **0 failures in 1506 seconds**; I audited that record rather than rerunning the full suite. Device inputs and the wasm budget are unchanged; byte-for-byte wasm identity was not independently established. |

Two operational details deserve explicit wording:

- **Child limits propagate.** I measured server and watchdog soft limits of **65,536**, while Node raised its own soft limit to **1,048,576**. All retained the original hard limit. The 65,536 ceiling therefore applies to the server’s adjustment, not the complete process tree.
- **Clone errors are transport closes, not admission refusals.** Their admission-refusal counters remain zero. Existing connection-cap and worker-cap refusal bytes, counters, and permits remain intact. An actual `accept()` EMFILE still terminates intake with `E_HTTP_LISTENER`; a fixed low hard limit remains an operational constraint.

The witness failure is **demonstrably pre-existing**. Besides reproducing it in 2/5 baseline whole-suite runs, I reproduced it on trial 85 using only the unchanged baseline binary and its own subprocesses:

```text
fdl-baseline-unit \
  smoke_barrier_advances_only_the_commit_clock \
  database_ownership_preserves_sqlites_posix_locks \
  --test-threads=2
```

This ran at soft 4,096. My patched whole-suite repetitions had four witness failures in ten runs and **no EMFILE**. Those samples show no observed rate increase, but cannot establish unchanged probability or the underlying ownership-race mechanism. An additional fully traced baseline run produced 23 timing/readiness failures and was excluded from that comparison.

No repository files changed; nothing was pushed.