# Successful r2 acquisition profile

This is the **older integrated 75a source**, before the current foreground fixes and primitive-sharing patch. The original `current-profile10008` timed out on a stale UI predicate and is excluded. Chromium 151.0.7922.34 on the recorded Node 24.13.1 Linux host completed **10,008 messages in 70,007 ms**; first inbox was 1,141 ms. The physical content hash matched the owner. CPU capture ended before physical snapshot inspection.

## Source-mapped sampled CPU

65,912 samples cover 70,029.8 ms (70,029.9 ms profiler span). Rows map through the supplied composed source map to original TypeScript function definitions. Self time is exclusive; inclusive time follows synchronous sampled ancestors and counts recursion once per frame. **Inclusive rows overlap; do not sum them.** Awaited wall time is not reconstructed.

| Original source/function | Self seconds | Inclusive seconds |
| --- | ---: | ---: |
| store/range-store.ts:467 `clone` | 0.001 | 21.823 |
| store/range-store.ts:551 `deliveryAcks` | 0.002 | 15.674 |
| store/canonical.ts:10 `jsonState` | 15.104 | 15.104 |
| store/range-store.ts:763 commit callback | 0.117 | 14.799 |
| V8 garbage collector | 9.556 | 9.556 |
| store/swap-journal.ts:8 `raw` | 6.241 | 7.198 |
| store/range-store.ts:569 detached outbox read callback | 0.002 | 5.989 |
| delivery-acknowledgements.ts:15 `applyDeliveryAcknowledgements` | 2.530 | 5.893 |
| store/swap-journal.ts:55 proxy `get` | 1.849 | 3.843 |
| store/outbox.ts:304 `pendingAcknowledgements` | 2.703 | 2.706 |
| React development JSX `exports.jsx` | 2.319 | 2.678 |
| store/swap-journal.ts:30 `wrap` | 2.099 | 2.175 |
| evaluator/row-image.ts:135 `imageCanonical` | 1.606 | 2.099 |
| V8 idle | 5.875 | 5.875 |

The strongest caller attribution is **deliveryAcks → clone → JSON serialization: 10.824 s self**, plus **deliveryAcks → clone → raw: 4.508 s self**. The source copies the complete acknowledgement dictionary at each detached read. Other detached outbox selections account for 3.945 s JSON self and 1.457 s raw self; the asynchronous trace does not identify their selector, so that needs a labeled counter. `pendingAcknowledgements` then enumerates the dictionary and ignores records already bound to intents. Ack cleanup also traverses all `state.deliveryAcks` under every commit.

Canonical-copy module self time is 15.118 s and the complete swap-journal module is 11.640 s. Together with GC these account for **36.314 s / 51.9% of the sampled span**. GC cannot be assigned to particular allocations from this CPU profile. React development rendering is visible (5.229 s inclusive under `performWorkOnRoot`) but is smaller than acknowledgement copying.

## Timeline and overlapping I/O

CPU starts 11.351 ms after browser navigation and stops at browser 70,041.293 ms. IDB instrumentation is captured afterward, before the physical snapshot, with the last completion at 70,069.5 ms. Network timestamps use Node `performance.now()`; navigation's Node timestamp was not saved, so its exact origin cannot be aligned to browser time. Network cadence differences remain valid within their own clock.

| Approximate browser interval | Canonical module self, s | Swap-journal self, s | IDB transactions started |
| --- | ---: | ---: | ---: |
| 0–10 s | 0.779 | 0.826 | 300 |
| 10–20 s | 1.586 | 1.396 | 201 |
| 20–30 s | 2.092 | 1.684 | 149 |
| 30–40 s | 2.455 | 1.881 | 119 |
| 40–50 s | 2.651 | 1.891 | 98 |
| 50–60 s | 2.693 | 1.926 | 88 |
| 60–70 s | 2.861 | 2.023 | 79 |

CPU bins use profiler elapsed time, offset 11.351 ms from browser bins; one final transaction starts just after 70 s. The growth of copying share while transaction throughput falls supports accumulated-state work, without alone proving a complexity class. Inbox request-start median grows from **165 ms for the first 50 intervals to 531 ms for the last 50**; header-to-next-request median grows from **151 to 508 ms**.

| Network request → response headers | Count | Summed seconds | Median / p95 ms |
| --- | ---: | ---: | ---: |
| `_delivery.deliveries.ack` mutations | 201 | 10.235 | 59.0 / 94.1 |
| `messages.inbox` queries | 201 | 3.809 | 19.1 / 24.7 |
| `groups.mine` queries | 203 | 0.550 | 0.3 / 6.3 |
| All API responses | 615 | 14.817 | 17.7 / 87.7 |

The union of network header-wait intervals is **10.998 s**, over a 70.070 s first-request-to-last-header span; all recorded statuses are 200. These timings include host/event scheduling and exclude response-body completion. The listener remains active through teardown, so its record is not clipped exactly at profiler stop.

| IndexedDB transaction lifetime | Count | Summed seconds | Median / p95 ms |
| --- | ---: | ---: | ---: |
| readonly inbox | 421 | 19.629 | 38.2 / 92.9 |
| readwrite rows/answers/outbox/meta/bytes | 613 | 9.952 | 8.1 / 35.8 |
| initial readonly state | 1 | 0.0003 | 0.3 / 0.3 |
| All transactions | 1,035 | 29.581 | 24.9 / 82.5 |

The IDB lifetime union is **24.675 s**. Lifetimes include transaction queuing and delayed JS completion delivery; they are not disk service times. **Network, IDB and CPU overlap. Neither summed nor union I/O durations can be added to CPU or subtracted as independent blockers.** No per-transaction physical snapshot was introduced.

CDP counters corroborate a busy renderer: ThreadTime 64.050 s, TaskDuration 64.367 s, with 0.063 s layout and 0.015 s style. ScriptDuration is separately reported as 5.938 s; these counters have different accounting and are not summed. JS heap at capture was 454.9 MB used / 797.9 MB allocated. ProcessTime 114.16 s is process-wide.

## Ranked next checks toward 30 seconds

1. **Compare the new fixed-source profile first.** Activation/admission fixes may remove repeated calls. This historical profile does not establish the candidate's remaining cost.
2. **Prioritize detached acknowledgement views.** Record call counts and selected record counts for `deliveryAcks` and generic outbox reads. The proven 15.674 s acknowledgement-copy path plus subsequent enumeration is the largest narrow opportunity. Evaluate a bounded detached pending selection while preserving retry, immutable ownership, FIFO and atomic custody; do not remove retained acknowledgements to hide cost.
3. **Inspect ack cleanup invalidation.** The all-record cleanup loop costs 5.893 s inclusive. A guard for swaps that cannot affect acknowledgement lifecycle could help, but must account for bounds, rejection/expiry, outbox removal and row loss. Proxy and GC savings would overlap these paths.
4. **Then inspect repeated groups refresh/inbox activation and development rendering.** Counts are concrete; their avoided work should be established by the new profile before any broader scheduler, retention or carrier redesign.

Full frame/module/caller tables, input hashes, timeline bins and exact aggregates are in `profile-report.json`. The ignored reusable command is `node runs/followup-diagnostics-20260911/profile-analyze.mjs [evidence-stem]`; other stems write separate `profile-analysis-<stem>.json`. No production sources, test gates or remote workloads were changed.
