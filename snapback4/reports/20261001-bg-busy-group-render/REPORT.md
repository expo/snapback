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


## Round 1 — incremental certification and concurrent authority reads

**Final qualification:** the shipping production build reaches **132.5 ms median,
187.0 ms p95, 250.3 ms maximum** from send to the slower remote viewer, meeting the
explicit `<250 ms` assertion. The round-0 control is 330.6 / 377.8 / 433.5 ms.
Under 96 ordinary CPU-burning processes, the comparison is
706.8 / 1,075.2 / 1,202.9 → **234.3 / 328.3 / 449.4 ms**. Each run has
50 sends and 100 remote renders, no timeout or browser page error, and all three
active devices' final notifications. Final runs include the corrected browser-only
authority scheduling, recorded-member fallback and rebuilt wasm. No push or
publication was performed.

Base: `c0d6d1ee28`, same eb1000 toolchain, shipping flags, calibration schema,
50-member/10,000-message seed, three browsers, twenty mounted history rows,
500-row source acquisition, automatic delivery and seen reporting as round 0.
The final candidate starts from a copy of the **round-0 seed database**, exercising
old-basis adoption. `binaries.sha256` binds both profiles on both revisions.
Client trace hooks are applied identically to the matched before/after builds.

“Idle” means no synthetic burners and no concurrent BG build/test. This is a
shared fleet host, not an exclusively reserved machine. During the final measured
sends, one-second `/proc/stat` samples show CPU utilization **5.86% median /
6.85% p95 / 6.91% maximum** idle (20 samples), and **99.60% / 99.88% / 99.94%**
loaded (40 samples). The loaded run keeps 96 normal-priority busy processes alive,
one per affinity-visible logical CPU, and reaps all 96 afterward. Earlier
controls record load averages but not CPU utilization; those averages are not
instantaneous load measurements. These are eb1000 results, not predictions for
the office M1. All completed runs and every sample are retained.

The primary after columns use `qualification-idle` / `qualification-loaded` and
`ll-final`, with final client scheduling and wasm. The pre-suite `after-idle` /
`after-loaded` runs (p95 193.3 / 393.1 ms) and `ll-after` (once-photo p95 82.7 ms)
remain as development evidence. Their source-count implementation predates only
the recorded-member fallback; their broad authority batching was subsequently
restricted to committed IndexedDB scopes. The `after-pilot` is earlier still.

**Shipping stage tables.** Milliseconds, median / p95 / maximum, nearest rank.
Send stages have 50 samples; per-remote stages have 100. As in round 0, notification
and sync can overlap, and server count spans are interval-correlated rather than
request-ID tagged. Percentiles and overlapping elapsed spans must not be added.

| Idle stage | Round 0 | Round 1 final |
| --- | ---: | ---: |
| Send → slower remote render | 330.6 / 377.8 / 433.5 | 132.5 / 187.0 / 250.3 |
| Send → server commit | 62.6 / 99.5 / 127.2 | 38.3 / 72.0 / 128.5 |
| Send → mutation HTTP request | 56.1 / 93.0 / 122.2 | 31.9 / 62.9 / 121.2 |
| Mutation request → commit | 6.1 / 8.2 / 8.5 | 6.0 / 7.8 / 9.1 |
| Commit → /changes response | 4.8 / 9.0 / 10.2 | 4.6 / 10.9 / 122.2 |
| /changes → sync request | 42.8 / 59.9 / 129.5 | 21.6 / 43.4 / 67.6 |
| Sync request → response EOF | 130.4 / 134.8 / 156.3 | 7.7 / 12.9 / 19.7 |
| Live-count certification inside sync | 125.0 / 128.9 / 149.3 | 0.5 / 1.1 / 1.2 |
| Response → device apply start | 1.8 / 2.6 / 3.8 | 1.5 / 3.3 / 14.5 |
| Device apply call | 11.6 / 14.7 / 55.3 | 11.4 / 16.0 / 20.2 |
| Apply end → first history evaluation end | 8.3 / 11.1 / 16.5 | 3.1 / 30.1 / 36.1 |
| History query call | 3.6 / 5.6 / 14.9 | 6.2 / 25.1 / 28.7 |
| Decorations query call | 33.2 / 37.4 / 39.6 | 17.9 / 27.0 / 31.0 |
| History evaluation → public observation | 56.6 / 70.3 / 166.5 | 34.8 / 49.3 / 55.5 |
| Publication → React commit | 1.7 / 2.1 / 3.7 | 0.7 / 1.1 / 1.5 |

| 96 CPU burners stage | Round 0 | Round 1 final |
| --- | ---: | ---: |
| Send → slower remote render | 706.8 / 1,075.2 / 1,202.9 | 234.3 / 328.3 / 449.4 |
| Send → server commit | 121.8 / 202.0 / 239.8 | 65.1 / 160.7 / 198.4 |
| Send → mutation HTTP request | 103.9 / 186.6 / 224.6 | 50.7 / 147.5 / 180.2 |
| Mutation request → commit | 14.8 / 24.7 / 30.2 | 14.5 / 19.7 / 26.9 |
| Commit → /changes response | 9.6 / 514.5 / 716.4 | 8.6 / 144.5 / 189.8 |
| /changes → sync request | 68.8 / 115.4 / 136.8 | 53.0 / 67.6 / 149.9 |
| Sync request → response EOF | 369.0 / 618.7 / 664.6 | 16.0 / 31.2 / 61.1 |
| Live-count certification inside sync | 355.7 / 596.7 / 647.1 | 0.7 / 4.2 / 6.7 |
| Response → device apply start | 2.0 / 6.2 / 18.5 | 2.6 / 7.8 / 27.2 |
| Device apply call | 13.5 / 24.6 / 140.0 | 14.5 / 20.9 / 26.5 |
| Apply end → first history evaluation end | 8.0 / 15.2 / 25.8 | 12.5 / 54.8 / 70.7 |
| History query call | 2.4 / 8.0 / 21.3 | 5.3 / 17.0 / 21.4 |
| Decorations query call | 40.4 / 65.3 / 90.5 | 37.1 / 50.1 / 56.0 |
| History evaluation → public observation | 74.7 / 138.4 / 447.3 | 15.0 / 98.3 / 112.8 |
| Publication → React commit | 1.4 / 4.3 / 6.8 | 1.2 / 3.2 / 7.1 |

**Count work and design.** All 100 remote deliveries in both final runs recertify
**zero** history rows (round 0: median 10,027, p95 10,050). Idle certification goes
from 125.0 / 128.9 / 149.3 ms to 0.485 / 1.088 / 1.197 ms. The source insertion
still evaluates its own delta against the fifty bounded member predicates.
No unchanged source is reevaluated. History remains 21 examined rows for twenty
returned rows; decorations still examine roughly 1,100 rows.

A count's existing private `$basis` record now holds the conservative minimum
source deadline and a digest of the maintain, source and member definitions.
Count and evidence update atomically. Adding a contributor lowers that minimum;
removing the earliest source seeks the next parent/expiry index key, which may
include noncontributors and therefore remains conservative. Version mismatch,
due expiry, missing/legacy evidence, a future basis timestamp or a pending count
uses the existing authorized live walk. Expiry remains effective at the instant,
before sweep. Sweeping the minimum restores reuse without a history walk. Cold
acquisition retains its full shared walk. A schema/evidence-format change rebuilds
counts and evidence in the adoption transaction; a real legacy-format migration
regression covers optional-field validation before that rebuild.

Authority is **fresh**, not a stored viewer verdict. Delivery checks the current
member and current uniform group rule in its transaction and pinned clock,
including witness expiry. This certifies current authority for the whole domain;
its numerical proof needs no new source predicate evaluations when grant data
changes. Definitions are digested, facts are freshly proved. Row-dependent
private disclosure, recorded source/member fields, read-through sources, maintained sources and
nonuniform rules cannot use this group proof and retain the sealed per-row path.
This explicitly avoids trying to version unbounded transitive authority facts
with one table counter. Public examined/step prices, saved caller heap admission,
nested witness allowance and pending live-basis checks remain. The optimization
is SQLite-only; ordinary non-row-keyed aggregates keep their existing live path.
The design is recorded in [LLP 3000.015 §3](../../../llp/3000.015-shared-baseline-for-snapback5.spec.md#3-a-maintained-view-keyed-by-another-tables-row).

**Client attribution and cut.** The before/after table below clips synchronous
wasm CPU and transaction/facade/lock elapsed spans to each requested interval.
Times are median / p95 (ms); counts are transactions. Elapsed IDB time includes
main-thread scheduling and can overlap decorations CPU, lock waits and facade
checks. It is not additive storage service time.

| Client attribution | Round 0 | Round 1 final |
| --- | ---: | ---: |
| Send → request: prediction CPU | 0.1 / 0.3 | 0.1 / 0.3 |
| Send → request: decorations CPU | 16.8 / 32.3 | 13.4 / 34.5 |
| Send → request: other query CPU | 1.7 / 2.3 | 1.0 / 2.7 |
| Send → request: other VM CPU | 0.9 / 2.2 | 0.8 / 1.6 |
| Send → request: device IDB elapsed | 1.5 / 5.8 | 1.8 / 9.6 |
| Send → request: authority IDB elapsed | 7.2 / 30.9 | 2.3 / 25.5 |
| Send → request: facade checks elapsed | 53.8 / 93.0 | 28.7 / 56.7 |
| Send → request: authority transactions | 24.0 / 41.0 | 5.0 / 8.0 |
| Send → request: lock queue elapsed | 26.1 / 49.7 | 16.5 / 36.5 |
| History → public: decorations CPU | 29.4 / 32.9 | 25.4 / 38.7 |
| History → public: other query CPU | 0.3 / 2.1 | 2.3 / 3.6 |
| History → public: device IDB elapsed | 1.4 / 3.6 | 1.9 / 4.4 |
| History → public: authority IDB elapsed | 40.2 / 45.8 | 3.9 / 16.6 |
| History → public: facade checks elapsed | 56.6 / 70.3 | 34.6 / 49.1 |
| History → public: authority transactions | 15.0 / 20.0 | 2.0 / 2.0 |
| History → public: lock queue elapsed | 3.4 / 10.4 | 17.9 / 40.7 |
| History evaluation → raw local notification | 29.8 / 33.5 | 28.2 / 43.7 |
| Raw local notification → public observation | 26.2 / 62.9 | 6.6 / 10.1 |

Prediction itself is about 0.1 ms. The main pre-request costs are interleaved
receipt/decorations evaluation and repeated facade authority reads queued through
the same persistence/session locks. After history evaluation, decorations can
still block the browser before the raw notification, followed by facade checks
before public delivery. The round-1 app batches calls on a prepared IndexedDB-authority scope already
queued **before** an authority read starts, so they share its committed snapshot and linearization
point. The batch is cleared before lock acquisition. Calls arriving during or
after the read queue a fresh transaction. There is no completed-result cache,
no deferred journal durability and no weaker logout/epoch/publication fence.
Repeated IndexedDB reads among the already queued calls provide no extra
documented authority guarantee. Memory/native stores and preparing scopes keep
the original per-call awaited persistence schedule; the full-suite failure
ledger below records why widening this optimization was incorrect. [LLP 3000.013 §6](../../../llp/3000.013-quarry-states-intent.rfc.md#6-a-paved-client)
records this rule. The unchanged strict write/admission path still commits before
unlocking. The test observes four transactions for two simultaneous calls on
round 0, at most three on round 1, and exactly two fresh checks for a later call.

Pre-send p95 falls 93.0 → 62.9 ms; history-to-public p95 falls 70.3 → 49.3 ms.
The remaining decorations computation is real query work over the fixture's
requested receipts; this round does not weaken that query, retention or authority
contract. Individual device-IDB and lock percentiles can rise as the shorter
pipeline changes overlap; they are not claimed as universally faster.

**LL small-group control.** Unchanged LL harness, `LL_KEEP=viewed`, wasm, twenty
repetitions of all eight flows, matching debug server builds, no timeouts in
160 samples on either side. These are commit → React times, unlike BG's send
headline. Media readiness remains a separate observation.

| LL flow | Round 0 median / p95 / max | Round 1 final median / p95 / max |
| --- | ---: | ---: |
| profile | 33.8 / 46.3 / 51.5 | 37.6 / 45.0 / 45.0 |
| reaction-add | 38.4 / 45.3 / 97.7 | 39.6 / 44.2 / 102.5 |
| reaction-replace | 36.7 / 43.7 / 52.1 | 38.6 / 41.5 / 41.7 |
| reaction-remove | 40.0 / 44.9 / 45.9 | 40.2 / 48.3 / 48.4 |
| reply | 81.4 / 94.9 / 96.2 | 82.7 / 89.8 / 95.6 |
| photo | 84.4 / 92.5 / 94.1 | 87.8 / 95.9 / 98.5 |
| feed-image | 39.0 / 45.6 / 48.6 | 43.1 / 48.3 / 51.1 |
| once-photo | 79.4 / 93.2 / 94.7 | 84.5 / 90.6 / 93.9 |

The LL page calls `createLocalClient` directly, bypassing the app authority
facade, and its fixture has no row-keyed count view. Neither BG hot-path change
is exercised there; LL is a control for incidental effects and host variation.

The old round-0 once-photo p95 88.6 → 106.6 ms is not reproduced: the same round-0
revision now gives 93.2 ms, and final round 1 gives 90.6 ms. Inspecting the old p95
sample shows apply-end → evaluation 47.5 → 64.6 ms and apply 6.9 → 8.4 ms,
while server sync is actually shorter (12.7 → 7.1 ms). The old worst after
sample had apply 14.8 ms and 67 device query evaluations instead of 55 in the
old before tail. Thus the observed tail sits in apply/evaluation scheduling and
reevaluation, not a larger server recount. The retained trace does not identify
a causal regression; run-to-run scheduling variation is the supported explanation,
not a proof of zero impact. See `round0-once-photo-attribution.json` for all twenty
samples and both tails. Feed-image p95 here is 45.6 → 48.3 ms; no universal
small-group latency improvement is claimed.

**Property and work proof.** The state-machine test uses seeds
`[1, 7, 28, 20261002, 195939070, 3735928559, 305419896, 24301]`, 300 steps each:
2,400 steps, **18,062 independent naive-model comparisons**, plus comparison of
incremental unread against the full authorized acquisition recount after every
step. It covers Clique-shaped `unread` (`seenOrdinal`, joined threshold, sender
exclusion and tombstones), the language-card `messageCounts`, and corpus/guide
`reactionCounts` (independent expiry rather than read-through). The ordinary
aggregates retain their current implementation and are checked after every step,
including denied aggregate keys. Actions comprise 744 source upserts (inserts and
updates), 257 source delete attempts, 244 member inserts/changes, 231 member removal attempts,
236 clock advances, **221 real SQLite close/reopens**, 220 rule/grant changes,
and 247 reaction edits/deletes. Random expiry includes already-due births.
Separate tests cover pending 1,100-row counts before sweep, exact deadline
crossings, recovery of reuse after sweep, legacy-format adoption, and recorded
member-input fallback. Private member predicate inputs already require an
owner-only read rule at schema admission; both compiler and raw-schema tests
enforce it. Recorded member inputs are stripped by the query projection, so
reuse now conservatively refuses those tables. The new raw-schema regression
compares warm delivery with full acquisition when the stored and disclosed
predicates differ (`recorded-member-final2.log`, pass).

The 50-member work regression inserts 10,000 and 100,000 history messages,
then a new source, and certifies a delivery. At both sizes its tuple
`(source rows recertified, public examined, public steps)` is **`(0, 100, 100)`**;
all fifty returned counts equal history + 1. It is a work assertion, not timing.
On `c0d6d1ee28`, the same new test fails at the zero-source bound with **10,001**
rows; the retained control exits 101 for that assertion, not compilation.
The old paging, heap, pending, witness/disclosure and client fault regressions
remain in the affected cohorts and full suite.

**Wasm and qualification artifact scope.** The full suite rebuild reports
**2,015,329 B raw / 605,003 B gzip**, measured with the build script's
`gzip -9 -c FILE` (Python/zlib gzip outputs are not this ratchet's measurement).
This is +0 raw / +2 gzip versus round 0. The cap stays **605,225 B**, leaving
222 B on Linux; the reported ~130-B macOS difference would leave ~92 B.
No increase is necessary, so no new 500-B allowance is taken. The size and digest
are in `round1/wasm.json`. All new certification state/code is SQLite-only;
the browser optimization is TypeScript. The pre-suite timing runs used the
existing round-0 wasm build. The suite rebuilt the candidate wasm, whose digest
changed; an exact-artifact confirmation is recorded below rather than assuming
identical bytes from identical raw size.

**Development failure ledger.** All unexpected pre-suite failures below are
**ours and corrected**, not baseline or environmental exclusions:

- `row-views-first.log`: certificate scratch was added to the source reservation,
  breaking the finite private-witness case. The lifetimes now reuse their maximum.
  `row-views-second.log`: cold acquisition incorrectly reused evidence and skipped
  that case's source witness; cold acquisition now retains its original path.
- `row-views-third.log`: the restart test used `/tmp` as its database parent;
  Store's directory-mode check refused it. Each test now owns a file under the
  workspace target directory. `property.log`: a generated delete of an absent
  or already-expired source expected success; the model driver now skips that
  nonexistent action, preserving production delete semantics.
- `authority.log`: the injected abort hit only the first authority transaction,
  which the concurrent poll could consume. The regression now aborts every
  authority read while the query is pending, and still requires refusal before
  publication. The complete authority cohort then passed 19 tests.
- `guide.log`: the maintains card grew to 883 lines against its 879-line limit.
  Redundant wording was trimmed; no guide budget was raised. `guide-final.log`
  passes all 110 tests.
- `authority-control-round0.log`: the first negative-control setup replaced
  ignored `dist/app.js`, but this browser test imports source. It therefore
  unexpectedly passed and the control wrapper failed. The corrected source
  control fails only the intended simultaneous-read bound (four transactions),
  plus its parent aggregate test result.
- `property-final.log`: the expanded ordinary-aggregate denial assertion called
  the internal recount without its required key-authorization precondition.
  The driver now performs that check, like the production read path;
  `property-final2.log` passes all 2,400 steps and 18,062 model comparisons.
  `property-final3.log` also requires every expected maintained group to exist.

The deliberate work and authority controls are expected red evidence. A debug
binary was also caught by its digest during an initial production setup and
stopped before any measured send; no such sample enters a table. The retained
production pilot is 137.6 / 190.7 / 227.0 ms and predates the upgrade and
expiry-minimum refresh fixes. The final implementation measurements above use
both fixes and the later recorded-member fallback; the pilot is not substituted
for qualification.

**Full-suite failure dispositions.** The complete `scripts/test.sh` command was
invoked once and allowed to finish every original case; no worker was cancelled.
Its Rust phase records one failure, `durable_schema_and_types_keep_base_bytes`:
the expected private basis schema lacked the new optional `deadline` and
`version` fields. **Ours, corrected.** The test now adds exactly those expected
fields in all three frozen row-view fixtures; every other schema and emitted
TypeScript byte stays frozen. The first focused correction named only the
ordinary fixture and consequently failed on the inherited-member fixture;
`ephemeral-compat-after2.log` covers all three and passes.

The client pool reports 5,755 tests: 5,729 passed, **16 failed**, ten existing
skips and zero cancellations. Every failure is **ours**, from applying authority
batching beyond committed IndexedDB scopes:

| Failed cases | Count | Disposition |
| --- | ---: | --- |
| Online app reopens after replacement, session accepted `true` and `false` | 2 | Original memory scheduling restored; both pass |
| Replacement waits for durable retirement, persistence failure `false` and `true` | 2 | First request no longer waits behind a later held admission; both pass |
| `keep=undefined`, wasm, seeds 23 / 44 / 445, delayed authority | 3 | Original per-call scheduling restored; all pass |
| `keep=undefined`, process, seeds 23 / 44 / 445, delayed authority | 3 | Same correction; all pass |
| `keep=true`, wasm, seeds 23 / 44 / 445, delayed authority | 3 | Same correction; all pass |
| `keep=true`, process, seeds 23 / 44 / 445, delayed authority | 3 | Same correction; all pass |

The four replacement cases time out waiting for the first post while the second
journal admission is held. The twelve generated cases time out awaiting an answer
after delayed-authority/offline/burst interleavings. These are product scheduling
regressions, not slow-host exclusions. The correction limits coalescing to a
prepared IndexedDB-authority scope and retains the original awaited persistence
path everywhere else. The entire replacement file passes **9/9** and the entire
keep-model file passes **18/18**, without weakening their checks or increasing
hang budgets. Those reruns used an isolated copied package while the original
suite continued; their `app.js` SHA-256 is byte-identical to the normal final SDK
build: `d998f75a5141cf077a42c855bc444ec9b2d3c02b70f5d352e6778e1fe147d260`.
The isolated setup first failed to rewrite `.ts` import extensions and then lacked
the package's `#fetch` import map; both setup failures are ours and retained as
`store-replacement-candidate.log` / `candidate2.log`. The corrected run is
`store-replacement-candidate3.log`.

Final source authority/fault checks pass **340/340**, including the updated await
fingerprint (74 awaits, same count as round 0), peer logout, successful reads
followed by transaction abort, and the concurrent/fresh authority-read bound.
The final SDK typecheck and normal build pass. Source count logic did not change
during these client corrections. The full suite's serial models load the corrected
normal SDK build; the original client pool kept its already-loaded pre-fix module.
The exact complete summary follows below. Full-suite test
failure classification: **ours 17, baseline 0, environmental 0**, all corrected
by the named focused runs. `round1/failure-ledger.json` lists every failed test.


**Complete-suite result (one invocation).** The exact terminal summary is:

```text
== 2 failure(s) in 2647 s
   cargo test
   client tests
```

All 79 final serial model cases passed. The two failed stages contain the 17
individual failures listed above, all ours and corrected by the named focused
reruns. This is a corrected-red full-suite record, not a claim that the original
complete invocation passed. The whole guide passed 110 tests. The final recorded
member fallback is SQLite-only and was added after the full run; its focused
regression passes. Its first test draft assumed a missing predicate operand
compared as an integer zero; the existing predicate comparator instead orders
null. That test-only expectation failed (`recorded-member.log`), and an attempted
rerun used the wrong working-directory prefix (`recorded-member-final.log`). The
final fixture uses a captured value of five against source ordinal one, checks
the stored count is zero and the disclosed full recount is one, and requires
warm delivery to match it. These development failures are ours, not baseline or
environmental. The server profiles were rebuilt after this final fallback.


**Final scenario qualification.** `tools/measure.mjs` completed both 50-send
shipping scenarios (exit 0), including the idle p95 assertion; the unchanged LL
harness completed 160 cases (exit 0). `python3 tools/qualify-round1.py` then checks
the retained traces: two remote renders per send, all three devices reaching each
send's notification watermark, the 20-row window, zero recertified history rows,
all burners accounted for and zero LL timeouts. It passes; see
[qualification results](round1/qualification-final.json),
[idle stages](round1/qualification-idle-summary.json),
[loaded stages](round1/qualification-loaded-summary.json), and
[LL stages](round1/ll-final-summary.json). Client attribution for both conditions
is retained alongside those summaries. CPU samples cover only the interval from
the first measured send through the final remote render, excluding setup/cleanup.

The instrumenters restored all Rust source changes and the normal SDK/server
builds were restored after measurement. The final normal `app.js` digest still
matches the corrected focused-test artifact stated above. `round1/final-artifacts.json`
binds source inputs, measurement binaries and wasm; `SHA256SUMS` covers the report
and retained evidence. LLP 3000.015 §3 owns the count design, LLP 3000.013 §6 owns
the concurrent authority-read rule, and one dated journal entry records this round.
