# Focused Clique — final handoff

The selected text/browser implementation is runnable. The final selected driver passed all 19 assertions it executed after explicitly acquiring the starter histories; three additional control checks and the custom API checks also passed. Earlier failures remain evidence. The separately injected whole-read-batch network failure remains a failure. **Full hub acquisition did not complete.** No full M3/M6/M7/M8 green, native Apple result, canonical replay throughput, weighted score, or comparative efficiency score is claimed.

## Identity and scope

- Start epoch: **1789225312**. Sole builder: requested fresh gpt-6-astra, medium; no delegation or other model session.
- Backend source identity: 409954115f151a72dd95e897c5f00f36877f11e0; installed package 0.0.1-experimental.0. Archive SHA-256 independently matched 719eba5bfaffeebf117ca3e10d60d830da2ca4ca735693ea0e46f0d6317fcb4e.
- Instrument: b323d61f60b5d167708ca6ebe6434b1d5a79c899, social-messenger 0.3.8-m8, supplied manifest b183d949bb4c5871747afb92f0eccb153c813765037507ef4d888f76a6da07a6. Observed hashes cover 185 files. Frozen inputs were not edited.
- The supplied M1 account/profile shell and presentational kit are prerequisites. Frozen public documentation was located under product-docs/; public-docs/ was absent. No platform patch or source-checkout inspection was used.

[run-log.md](run-log.md) records boundaries and repairs; [closing-essay.md](closing-essay.md) was written before final metric aggregation. Dependencies and loader authoring were on the builder clock. No authenticated token/cost accounting is claimed.

## Selected correctness and explicit coordination

[ selected-results.json ](selected-results.json) retains assertion outcomes and links every selected attempt. The final scope covers m3-a01; browser analogues of m6-a01/a03/a05–a07; m6-a10–a12 (a12 is a builder-authored documentation variation, not independent grader execution); m8-a01–a04 and m8-a13–a18. Membership denial, delayed old-account responses, logout/login and rapid navigation are also checked.

One ordinary app SDK client owns all resources and mutations. Additional app authenticated readers: **0**; private caches: **0**; recreated mutation intents: **0**. Explicit additions are the serial acquisition helper, bounded in-flight resource wait, client calculation of unread from a last-200 summary, and a public IndexedDB adapter timing wrapper. The final test observation path recorded **14 refresh attempts, including 2 retries**; these are read retries, not repeated sends. Unavailable or bounded-out unread counts display Unknown.

A denied ancillary resource passes without disabling messages or duplicating a send. Aborting an entire shared HTTP read batch did not pass; it is separately retained. Cold reopen was intermittent on the earlier implicit-view path. Two later runs passed after the app's explicit acquisition step. These passes are qualified to that path, not evidence that every warm cache is reliable. Corrections to earlier dependent receipt assertions are recorded in evidence/selected-attempt-corrections.json.

Receipt controls separately prove server acceptance, recipient fetch acknowledgment, and recipient view. Committing a write is never called read. Receipt watermarks are authenticated client reports; the UI indicates whether another recipient has reached the watermark, not all-member group delivery. Reaction snapshots include populated rows and caller-own state. Insights uses actual starter posts/follows/likes/reposts/replies: Alice totals are **4 posts, 2 likes received, 1 repost received, 1 reply received, 4 followers, 2 following** before the test like. Today and all six empty UTC days are checked for both posts and likes; Bob's new like increments the total by exactly one. Main-DB like-day repair mutations are recorded. Aggregates are bounded to 100 and are not a full-social-scale implementation.

## Fixture and acquisition

The independently checked text projection contains **105,134 selected actions**, omitting 62,109 scale social actions. It retains **1,002 conversations, 100,015 messages, 2,000 reactions**, and all 52 starter M2 actions. It converts 910 media sends and six media posts to labeled text and omits avatar bytes. Independent Python parsing compared every transformed actor/time/verb/argument and authorization scope. Independent authorized HTTP traversal subsequently matched every fixture message's sender, text, quote, and authoritative seed timestamp.

The loaded DB also contains **18 recorded acquisition sends**, each independently found exactly once by recipient u0002, making 100,033 current messages. Hub fixture authorization is exactly 1,000 conversations/100,000 fixture messages; probe authorization is 100/10,000; starter Alice/Bob see only their 15 fixture messages. See artifacts/fixture/projection-manifest.json, evidence/server-fixture-verification.json and evidence/acquisition-id-audit.json.

Loading used supported development seed/persona APIs, not private SQLite writes. The seed's timestamps are explicitly loader-assigned, ending at the preparation clock, not the documentary January log times. Actual server values are retained in evidence/server-message-timestamps.jsonl. Spawn-to-ready-file startup/compile/seed time was approximately **11.74 s**, using the readiness file's filesystem timestamp as an indirect boundary; it is not an engine-only seed timer.

The following are the final **viewport-confirmed**, serial, fresh-storage repetitions. Online wall starts before login/restoration, excluding fixture preparation. MB is decimal. Heap is sampled every 500 ms, includes app/instrumentation, and is not forced-GC retained heap. IndexedDB physical usage is estimated.

| Persona / repetition | Outcome | Fixture IDs acquired | Online wall s | Peak sampled heap MB | IDB estimate MB | Offline reopen → first query ms |
|---|---|---:|---:|---:|---:|---:|
| u0500 / 1 | complete | 10,000 / 10,000 | 33.57 | 227.40 | 3.96 | 765 |
| u0500 / 2 | complete | 10,000 / 10,000 | 34.10 | 248.51 | 3.96 | 796 |
| u0500 / 3 | complete | 10,000 / 10,000 | 34.57 | 235.04 | 3.96 | 816 |
| u0001 / 1 | timeout | 42,900 / 100,000 | 180.01 | 433.46 | 6.54 | not measured after cutoff |
| u0001 / 2 | timeout | 42,500 / 100,000 | 181.86 | 453.01 | 6.45 | not measured after cutoff |
| u0001 / 3 | timeout | 42,900 / 100,000 | 181.91 | 447.54 | 6.58 | not measured after cutoff |

All three probe runs independently matched every expected ID, every declared page, and the complete offline query set after close/reopen. The hub rows are partial acquisitions and failures. At 30 s they had 10,500/10,800/10,600 messages; at 60 s, 18,500/18,700/18,600. Probe acquisition had finished its 10,000 fixture messages plus the recorded sends by the 30-second observations and finished the remaining empty conversation pages shortly afterward; no 60-second observation was needed. The 180-second whole-attempt cutoff was requested, but observed network-cutoff command latency overran by 7–1,906 ms; exact boundaries are retained. Same-attempt hub offline reopen was not measured after watchdog closure. Three **separate partial-history** hub reopen probes passed at 242/253/226 ms; they do not replace full hub acquisition.

All **24 acquisition attempts**, including setup failures, interruption, earlier series and the extra cutoff capture, are retained. Earlier “paint” labels were DOM-presence observations below the viewport; evidence/measurement-corrections.json explicitly disqualifies them as paint evidence. Final visual bounds scroll into view and wait two animation frames, with bounding boxes recorded. [measurement-summary.json](measurement-summary.json) contains request counts, transfer bytes, auth restoration, first useful screen, last HTTP response, durable-write boundary, long tasks, heap samples and storage measurements. Final probe transfers were approximately 27.84–27.88 MB in 166 requests; hub partial transfers were approximately 80.50–81.26 MB in 463–467 requests. Completed HTTP byte counts and streamed data-event bytes overlap and must not be added.

## Foreground sends, paging and storage

| Persona / repetition | Local durability ms | Server settlement ms | Separate observations |
|---|---:|---:|---|
| u0500 / 1 | 5.1 | 224.6 | committed; recipient fetched; viewport confirmed |
| u0500 / 2 | 7.3 | 201.1 | committed; recipient fetched; viewport confirmed |
| u0500 / 3 | 7.4 | 199.2 | committed; recipient fetched; viewport confirmed |
| u0001 / 1 | 14.7 | 204.8 | committed; recipient fetched; viewport confirmed |
| u0001 / 2 | 7.6 | 213.8 | committed; recipient fetched; viewport confirmed |
| u0001 / 3 | 11.2 | 204.2 | committed; recipient fetched; viewport confirmed |

Independent recipient fetch was observed 436–584 ms after the authoritative server timestamp; sender viewport observation was 547–645 ms after it. These are polling/driver upper bounds. All 18 acquisition sends across the retained series had exactly one final recipient ID and text copy.

The app acquires pages serially. Median public storage-adapter write-resolution intervals were about 100–104 ms for the probe and 271–280 ms for the hub; SDK refresh medians were 216–220 ms and 404–419 ms. HTTP header intervals were about 26 ms and 29 ms. Durable admission is a substantial measured wall interval, but it includes scheduling and is not pure disk I/O. Body completion, SDK computation and rendering were not separated into a defensible residual breakdown. See evidence/pipeline-intervals.json.

Busy g0001 paging used the rendered conversation and real SDK refreshes: **20 requests per page after three warmups**, no zero-request samples. Page 1 p50/p95: **213.3/237.8 ms**; page 50: **127.3/137.4 ms**. The p95 ratio is **0.578**, passing the selected ≤3 diagnostic. The 20 measured requests transferred 2,952,140 and 2,955,340 bytes respectively. This ordered, warmed diagnostic is not a universal production guarantee.

Read-only SQLite inspection after exact-PID shutdown found:

- Database: **113,209,344 bytes**; retained WAL: **112,908,632 bytes**; total **226,117,976 bytes**. No explicit checkpoint, vacuum or compaction; these sizes matched the pre-stop scope. Preserve the DB and WAL together.
- Physical rows table: **30,523,392 bytes**, plus its primary index **3,264,512 bytes**.
- Physical index_entries table and its three indexes: **55,689,216 bytes**, containing 220,455 logical index entries.
- Commit metadata: **23,511,040 bytes**; most payload is the seed's touched inventory (23,473,604 bytes), not 100,000 public mutation receipts.
- Terminal operation receipts: 18 rows; table plus primary index **24,576 bytes**. Large-fixture application read-watermark rows are zero; no per-message delivery fanout table is authored. Main small-state receipt controls are separately preserved.

Every physical table/index, including empty inherited tables, has rows/pages/bytes in evidence/storage-scale.json. Application rows and logical index-key payloads are in evidence/storage-detail.json; physical shared-page bytes are not falsely apportioned to logical app tables. The 2,000 reaction IDs, actors and emoji were independently checked. This messaging-plus-starter-social projection is **not compared with the prior full app's 5.2 GB**.

The self-contained installed client entry is 164,808 raw bytes; the React adapter is 867 bytes, excluding React peers. Complete exported static assets are separately listed in evidence/transfer-sizes.json. Final delivered JavaScript is byte-identical to the measured build; formatting did not change it.

## Handoff and remaining limits

Use [BUILD.md](BUILD.md), [API.md](API.md), and [HANDOFF.md](HANDOFF.md). The separate artifacts/starter-app database has **DM 6/group 9**, with pristine Alice/Bob/Carol snapshots. scripts/snapshot-export.mjs exports all requested message fields, populated reactions with caller-own state, and own-message recipient watermarks. The coordinator should add its reaction/receipt/tombstone controls and take new snapshots before the fresh M7 session.

No polls or conversation message-count field were implemented. Existing day fields, read watermarks and query-derived totals are documented for honest later migration claims. Avatar/media lifecycle, view-once, typing/presence, push/digests, full action-schema conformance, full-social-scale Insights, and Apple proof remain explicit exclusions. All recorded owned owners/workers are stopped; ports 54900–54902 were verified closed. M7 was not launched.
