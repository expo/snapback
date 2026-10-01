# BG round 0 — busy-group live propagation

The shipping `production` build running **`snapback4 dev`** meets the requested
p95 below 500 ms on eb1000: **305.1 ms median, 469.6 ms p95, 541.4 ms max** over
50 sends to two mounted remote viewers, taking the slower viewer for each send.
The same-profile baseline was 587.1 / 753.0 / 877.3 ms. An earlier complete run
of the combined fix measured 302.5 / 370.5 / 398.0 ms; both runs are retained.
The final run adds uninterrupted notification capture and an explicit 500-ms
p95 assertion. Across both combined-fix runs, all 100 sends have median 304.7 ms,
p95 398.0 ms and max 541.4 ms. Every send rendered on both remote devices.

The **unoptimized Cargo development build does not meet 500 ms**: its p95 fell
from 2,281.6 to 991.5 ms. Profile differences are not counted as an optimization.
The fix removes two costs: repeated one-row live-count scans and repeated
IndexedDB opens for a single app authority check. Runtime ceilings, wire format,
PQ observation limits, PR/PRL authority and publication policies, and RL retention
are unchanged.

**Fixture and provenance.** Base: `995b1c26694246b7a2c183b0f2ee65fe09947549`
on `sb4-intent/bg-busy-group-render`. This worktree is on eb1000
(`100.65.137.99`, hostname `expose-builder-pixel`, AMD EPYC 9454, 96 logical CPUs).
Node 24.13.1, Bun 1.3.14, Rust 1.97.0, Chromium 151.0.7922.34. The shipping
profile and `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` match
`scripts/publish.mjs`; that flag is fixed in both before and after builds. All measurements
are loopback on this host; other lanes use the machine, and each trace records
its load. No BG build or test ran concurrently with a latency measurement.

The original calibration packet was copied from the office M1 at
`ccheever@100.82.202.35:clique-sb4-20260930-astra-cal28/lanes/astra-snapback4/`.
[Calibration inputs](calibration/) preserve its schema, config, React chat screen,
probe and 20-sample result (2,909–4,576 ms; p95 4,158 ms). Checksums are retained.
That M1 result is context, not an eb1000 before/after comparison.

The server has 50 distinct members and 10,000 messages from those members;
47 inactive members keep their unread history. Three separate Chromium contexts
use real wasm/IndexedDB devices and password sessions: one sender and two remote
viewers. Each mounts the builder's history, decorations, room, membership and
typing reads, automatic SDK delivery, and screen `seen` reporting. The builder
mounts **20 history rows**, acquires the last **500**, and stores **10,000** on
the server; mounting 10,000 DOM rows would be a different workload. No sync is
forced after sends. Sends follow both remote renders, allowing receipt work to
continue across samples. The Expo shell, global feed, media and digest worker
are outside this conversation fixture. Fifty membership rows do not mean fifty
simultaneously open polls; all three active members' `/changes` responses are
captured, and the other 47 have no open request.

**Stage table.** Milliseconds shown as **median / p95 / max**, nearest rank.
Each profile has 50 sends and 100 remote render observations. Send/commit rows
have 50 samples; other rows have 100 except the noted baseline notification gap.
Every per-sample timestamp and work count is in the corresponding summary JSON;
raw traces include all device calls, requests, commits and certification spans.
Durations overlap, so percentile columns must not be summed.

| Shipping profile stage | Before | After (final qualification) |
| --- | ---: | ---: |
| Send → server commit | 133.8 / 248.1 / 294.5 | 60.2 / 169.7 / 251.9 |
| Send → mutation HTTP request | 127.8 / 232.2 / 266.2 | 48.9 / 162.6 / 245.9 |
| Mutation request → commit | 5.6 / 10.0 / 62.3 | 5.7 / 11.8 / 58.4 |
| Commit → /changes response¹ | 5.2 / 84.2 / 496.6 | 5.5 / 219.0 / 252.4 |
| /changes → sync request¹ | 39.0 / 65.5 / 74.3 | 27.5 / 53.8 / 88.4 |
| Sync HTTP request → response EOF | 296.1 / 300.7 / 315.6 | 130.0 / 155.4 / 163.2 |
| Live count certification inside sync² | 291.8 / 300.1 / 306.8 | 125.4 / 148.3 / 158.1 |
| Response → device apply start | 1.7 / 2.8 / 46.5 | 1.4 / 2.0 / 4.5 |
| Device apply call | 11.2 / 119.0 / 174.7 | 9.7 / 13.2 / 16.6 |
| Apply end → first history evaluation end | 7.8 / 10.6 / 11.9 | 6.9 / 10.8 / 11.9 |
| History query call | 3.5 / 64.8 / 123.1 | 3.0 / 4.3 / 5.5 |
| Decorations query call | 34.1 / 40.4 / 45.6 | 28.9 / 36.2 / 44.0 |
| History evaluation → public observation | 76.2 / 99.6 / 183.7 | 48.2 / 62.2 / 70.8 |
| Publication → React commit | 1.7 / 2.4 / 3.6 | 1.5 / 1.9 / 2.4 |

¹ Polling and sync can overlap: a sync already in flight can apply the new cut
before its notification arrives. The final continuous trace captures all 150
active-member notifications (sender included), even beyond a sample's render.
The original shipping baseline captured 97/100 remote notifications inside
sample windows; the other three have no inferred timestamp. Its notification
percentiles use 97 observations. A negative notification→request interval means
the sync started first. This is not a serial stage on every sample.

² Server post-SQLite-commit stamps and count spans use `SystemTime`; browser
stamps use `performance.timeOrigin + performance.now`, on the same host clock.
Instrumentation is temporary and restored by the build helper; no shipping
tracing hook was added. The live-count span is the largest matching span inside
the sync interval, not the sum of three concurrent viewers' recounts. It is
interval-correlated, not a request-ID assertion.

| Work/size per remote update | Before p50 / p95 / max | After p50 / p95 / max |
| --- | ---: | ---: |
| Sync response bytes | 8,774.0 / 9,095.0 / 9,987.0 | 8,774.0 / 9,087.0 / 9,400.0 |
| Live source rows certified | 10,027.0 / 10,050.0 / 10,053.0 | 10,027.0 / 10,050.0 / 10,052.0 |
| History rows examined | 21.0 / 21.0 / 21.0 | 21.0 / 21.0 / 21.0 |
| History returned window | 20.0 / 20.0 / 20.0 | 20.0 / 20.0 / 20.0 |
| Decorations rows examined | 1,081.0 / 1,098.0 / 1,100.0 | 1,081.0 / 1,098.0 / 1,100.0 |
| Device query evaluations until render | 17.0 / 25.0 / 25.0 | 14.0 / 18.0 / 22.0 |

All history evaluations remain bounded at 21 examined rows for a 20-row window.
Decoration queries examine about 1,100 rows, largely twenty messages times fifty
receipt members. They are measurable work, but do not account for the original
multi-second delay. The live basis grows with the fifty sends; a few initial
small-range candidates may also precede the shared certification walk.

| Unoptimized development profile stage | Before | After |
| --- | ---: | ---: |
| Send → slower remote render | 2,214.8 / 2,281.6 / 2,302.0 | 897.4 / 991.5 / 1,064.3 |
| Send → server commit | 180.5 / 252.4 / 283.8 | 63.6 / 143.4 / 148.1 |
| Send → mutation HTTP request | 161.6 / 232.5 / 265.4 | 43.1 / 124.5 / 130.2 |
| Mutation request → commit | 19.9 / 22.0 / 22.9 | 18.9 / 24.6 / 44.9 |
| Commit → /changes response¹ | 7.5 / 14.6 / 52.5 | 6.0 / 20.7 / 29.5 |
| /changes → sync request¹ | 48.7 / 69.0 / 75.7 | 32.2 / 53.5 / 82.4 |
| Sync HTTP request → response EOF | 1,884.5 / 1,906.5 / 1,991.8 | 703.3 / 738.0 / 869.9 |
| Live count certification inside sync² | 1,874.4 / 1,897.9 / 1,982.9 | 693.1 / 728.5 / 859.4 |
| Response → device apply start | 1.9 / 2.4 / 3.0 | 1.6 / 2.2 / 21.0 |
| Device apply call | 12.0 / 15.3 / 18.7 | 10.8 / 14.6 / 27.1 |
| Apply end → first history evaluation end | 5.7 / 7.5 / 10.4 | 7.9 / 10.9 / 12.8 |
| History query call | 2.5 / 3.0 / 3.5 | 3.5 / 4.8 / 5.9 |
| Decorations query call | 33.6 / 37.3 / 45.0 | 34.7 / 42.7 / 49.0 |
| History evaluation → public observation | 56.5 / 68.5 / 93.1 | 54.7 / 63.0 / 102.7 |
| Publication → React commit | 1.8 / 2.3 / 2.8 | 1.6 / 2.2 / 2.9 |

**Attribution and changes.** In the unoptimized reproduction, live count
certification consumes about 1.9 seconds of each 2.2-second render path. Every
send updates the fifty member counts. Because messages have an expiry column,
delivery must certify those counts against the current live source transaction,
even when the stored count is not pending. The stream fallback formerly planned
and fetched one source row per storage scan. It now uses the existing cold
acquisition decoder page of 32, admitted against the saved caller heap before
prepaid certification. A finite or nested caller without page scratch still uses
one row. Every source still crosses expiry, row-rule and field-disclosure checks;
every member still pays and evaluates its predicate. The fixed predicate step
price and source expiry check move out of the member loop; the first contribution
records the deadline. No cached count replaces the current live basis.
[LLP 3000.015 §3](../../../llp/3000.015-shared-baseline-for-snapback5.spec.md#3-a-maintained-view-keyed-by-another-tables-row)
governs the change. The 50-member/10,000-source regression bounds storage **scan
calls** at 400 (32-row pages plus terminal calls), verifies all counts, and checks
all 10,000 source rows were certified. Main makes 10,002 scan calls. The optional
small-range key probe retains its separate 65-key bound. Large-payload tests
exercise page and single-row admission with finite and nested heap allowances.

The server-only fix reduces shipping sync p95 from 300.7 to 133.0 ms, but still
leaves end-to-end p95 at 678.8 ms. Browser app checks were opening IndexedDB three
times and reading the session twice under the same lock. Each check now reads
the legacy epoch marker and session record in **one fresh read transaction**, waits
for commit, repairs mirrors best-effort, observes the epoch, then checks principal
and tombstone. Results are never shared between checks. The same lock and strict
write/admission procedures remain. [LLP 3000.013 §6](../../../llp/3000.013-quarry-states-intent.rfc.md#6-a-paved-client)
governs this change. The public residency before/after regression observes two
locked read transactions with the fix and six with main's app code. A separate
abort test proves successful IDB get requests cannot publish before transaction
completion. Existing peer-logout, stale-mirror, principal-switch and failed-commit
browser cases pass.

The server still performs a full live basis walk per affected delivery batch.
This patch reduces scan planning/decoding overhead, not the O(history × members)
predicate work or the cost of fifty simultaneously active devices. There is no
new protocol field, cross-request result cache, higher meter, longer retained
answer deadline, shorter poll timer, or bypass of app authority.

**LL small-group control.** The unchanged LL real-wasm harness ran 20 repetitions
of all eight flows before and after, with `LL_KEEP=viewed`, using matching
unoptimized server builds. No timeout occurred in either 160-sample run. These
numbers are **server commit → React commit**, matching LL's convention (media
readiness is separately recorded), not BG's send-call headline.

| LL flow | Before median / p95 / max | After median / p95 / max |
| --- | ---: | ---: |
| profile | 38.0 / 43.0 / 43.1 | 34.3 / 40.5 / 49.2 |
| reaction-add | 38.9 / 44.9 / 56.1 | 36.5 / 43.2 / 47.7 |
| reaction-replace | 35.3 / 41.3 / 57.1 | 37.1 / 45.3 / 53.0 |
| reaction-remove | 40.9 / 45.7 / 48.9 | 35.9 / 43.0 / 44.6 |
| reply | 82.2 / 90.5 / 91.0 | 78.0 / 88.3 / 91.2 |
| photo | 85.4 / 91.4 / 91.5 | 73.5 / 85.1 / 85.4 |
| feed-image | 37.4 / 45.7 / 48.5 | 34.6 / 47.4 / 49.3 |
| once-photo | 80.8 / 88.6 / 95.1 | 77.8 / 106.6 / 106.9 |

Small-group p95s remain below LL's roughly 130-ms idle envelope. They are not all
numerically lower: once-photo increases from 88.6 to 106.6 ms, reaction-replace
41.3 to 45.3 ms, and feed-image 45.7 to 47.4 ms. Once-photo's median decreases,
server query count stays six, and the observed tail includes extra device
re-evaluations (p95 56→67). This finite sample on a shared host does not establish
zero latency change. PQ/PR/PRL/RL correctness and work bounds are checked separately.

**Verification and failure ledger.** The single full-suite run found an **ours**
audit failure: `every delivery await is explicitly classified` in
`delivery-fault-matrix.test.mjs`. The two changed authority-await fingerprints
were missing from `delivery-await-boundary.json`. They are now updated with a
reachability explanation in `delivery-fault-instrument.mjs`; delivery fault
sites, recipes and required/optional classifications are unchanged. The full suite was invoked **once**, with exact final summary:

```text
== 1 failure(s) in 1574 s
   client tests
```

Exit 1. The client pool had 5,754 tests: 5,743 passed, this one failed, ten
existing skips, no cancellations. All other suite stages passed, including
Rust (602 s), nine fixture wrappers and all 79 serial client-model tests.
Failure classification: **ours 1 (corrected); baseline 0; environmental 0**.
The corrected delivery-matrix rerun passed **321/321**, with no failures, skips
or cancellations, exit 0 (`delivery-matrix-after.log`). There are no unresolved
failures. The full suite was not rerun or relabeled as a clean pass.

- Affected Rust row-view tests: 30 passed, 0 failed; includes the busy-group and
  finite/nested heap regressions (`row-views-candidate2.log`).
- Affected client cohort: 630 passed, 0 failed, 0 skipped/cancelled
  (`affected-client.log`), including all per-row, retention, LL propagation,
  row/session authority, keep-authority and app-local-session files selected in
  the recorded command.
- Whole guide: 110 passed, 0 failed, 0 ignored (`guide.log`).
- Final shipping Chromium qualification: 50 sends, 100 remote renders, 150 active
  member notifications, explicit p95 <500 assertion passed, exit 0.
- `ref-check --verbose`: 525 LLP documents, 10,065 refs, 0 errors/unchecked.

Negative controls are expected failures, not unresolved regressions:
`regression-main2.log` exits 101 at the new 400-scan bound (10,002 actual);
`authority-regression-main.log` exits 1 at the new two-transaction bound (six
actual). The latter temporarily restores main's `app.ts`, leaving the unused
new authority helper present; all other source is unchanged for this control.

Early implementation/probe failures, all **ours** and corrected, are retained:
`batch-candidate1.log` lost the private acquisition test helper during refactoring
(two E0599 errors); `regression-main.log` omitted the observing store's key-head
delegation; `instrument-baseline2.log` accessed a private counter (two E0616 errors);
`instrument-baseline3.log` tried to replace a running binary (ETXTBSY), fixed with
atomic rename; `ref-check-wrong-cwd.log` records a final checker invocation
from the Snapback 4 fence instead of the repository root (0 LLP documents found,
1,351 consequent missing-reference errors), corrected by running from the root;
`pilot.log` used an unsuitable browser memory session store
(E_ADMISSION). Pilots 2–4 were stopped deliberately: one repeated that setup,
and two added 47 optional simultaneous polls beyond the unchanged 32-waiter
server limit. Their shutdown fetch failures are not latency samples. Final runs
use the requested three active devices. Calibration/early React development
console warnings about snapshot caching and render-time notifications also occur
on main; no final Chromium page error or dropped message occurred.

**Wasm.** Both rebuilt artifacts are **2,015,329 B raw / 605,001 B gzip**,
with identical wasm SHA-256. The inherited ratchet remains **605,225 B** (224 B
headroom on this host). Rust changes are SQLite-only; the other product changes
are TypeScript. No additional bytes are needed, so the cap is not raised merely
to enlarge inherited headroom. The requested approximately 500-B allowance would
apply to a necessary increase; this change requires none. The full suite
independently rebuilt the artifact and passed its budget check.

**Reproduction and evidence.** [Tools and exact commands](tools/README.md),
[context pack](CONTEXT.md), [final per-sample stage table](qualification-production-summary.json),
[shipping baseline stages](production-before-summary.json),
[development baseline](baseline-summary.json), [development after](after-summary.json),
[LL before](ll-before-summary.json), [LL after](ll-after-summary.json).
Raw JSON traces are gzip-compressed without changing their data. `summarize.mjs`
accepts both forms. `*-artifacts.txt` bind the measurement binaries and wasm.
The optional seed database and temporary password-session credentials stay in
`/tmp`, outside the repository. No push or publication is authorized or performed.
