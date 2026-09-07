# Historical ad hoc admission diagnostic

One fixed baseline-first diagnostic compared original26c9 against the same historical source plus the already landed three-file5dc duplicate-admission repair. Each arm ran3 warmups then20 measured ordinary putMessage requests with the same inputs and original30s HTTP/startup bounds. All46 returned HTTP200 committed receipts. After each owner stopped gracefully, full persisted rows, ledger, maintained counts, sequence, allocator, untouched original rows and23 base certificates passed the frozen assertions. The original failed scale store was not modified or replayed.

| Arm | Median ms | p95 ms | Final messages / sequence |
|---|---:|---:|---:|
| Original26c9 |285.8132565|286.738263|10038 /11341|
| Historical source plus reviewed dedup |194.597961|195.280439|10038 /11341|

The median is approximately31.9% lower in this single comparison. This is not a general causal speedup or evidence that the original full population would finish. Fixed baseline-first order, shared work, cache/observation timing, different real clocks and deliberately distinct allocator namespaces remain confounds. The source repair was already landed as5dc/52252; this packet contains evidence, not another implementation.

The first attempt built the candidate once in22.118s, then failed before any HTTP request because the owner held SQLite's exclusive lock during a starting-state observation. Its actual supervisor1, baseline graceful0, zero requests and absent candidate arm remain intact. The reviewed correction moved full starting SQL before owner startup and final persisted assertions after graceful stop; intermediate values are expected, not independently observed SQL snapshots. It preserved every request/receipt/final-ledger assertion and reused the exact faa2a59c binary. No retries, rebuild, added requests, live immutable reads or lock disabling occurred.

Corrected supervisor4014690 exited0 at1788783528.236445. Baseline owner4014694 ran12:18:34.428–12:18:41.424; candidate4014815 ran12:18:41.895–12:18:46.787; both stopped0. All recorded owners are absent and both ports free. The original28800 accumulated-seconds scale outcome remains incomplete162050/167244, with no100% timings, dynamics or controls. Nothing here extends that deadline or changes its verdict.

The frozen author report retains the compiler supervisor's reported R25 children at12:18:40.960/3.253s and12:18:44.391/3.207s, which overlap the owner window. A separate later R24 report records six children during the posted hold. Exact timing-only receipts show those six all fell outside the actual owner window; this remains a scheduling exception, not a further measured overlap or quiet-host claim. No peer reviewer findings or values were read to establish that timing annotation.

All46 nonsecret timing/receipt-identity records are preserved; median averages measured10th/11th, p95 is nearest-rank19th of20. Supervisor validation parsed every record, checked original deadlines, native timestamp intervals/order, matching cross-arm inputs and final public state, and reverified every151-leaf sealed local author file. Both remote result manifests retain raw private responses, stopped stores/ledgers and certificate custody without exporting them. Original and corrected run.py/validate.py source, workload, correction and old/new source correspondence explain the assertion boundary.

Actual author7629 exited0 after1628.372144s. The original report and all copied bytes remain verbatim except explicitly indexed private fleet-address derivatives. This landing adds no product code, publisher metric, benchmark request, provider-blocked review or successor-uniqueness work. No full-scale, whole product, live main, media/effects, client-size or publication claim follows.
