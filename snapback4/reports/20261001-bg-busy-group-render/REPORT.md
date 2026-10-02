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

## Round 2 — rollback-safe counts and occupied heap admission

Base: `4277a65cf4`. Astra's two new high-severity count findings and Grok's
inherited heap-admission finding are reproduced before the fixes. The round-1
client batching change is unchanged. This round has no push or publication.

**Rule and tradeoff.** A reusable numerical certificate now requires a
non-expiring member table. Maintenance's live-recipient index deliberately skips
expired members; a later rollback can revive a member after arbitrarily many
missed inserts, edits, deletes, moves or sweeps. Neither its old basis timestamp
nor its next source deadline accounts for those omissions. Every expiring-member
read therefore uses the existing authorized walk, including members with a null
current deadline and inherited-expiry tables. The rule is based on the declaration,
requires no traversal of an unbounded expired-member backlog, and preserves the
non-expiring-member fast path used by the busy-group fixture. Fresh member/group
authority remains in the delivery transaction, including expiring grants.

A recount restarts its cursor, total and deadline when `now < work.at`, as well
as when its contributing deadline becomes due. Its saved time is the latest
clock that built the prefix. Both completed evidence and private recount work
carry the `count-basis-v2` digest. A legacy prefix could already be incomplete
before this fix, so missing or mismatched work versions also restart. The work
version is optional during legacy validation; changed private work schemas
trigger the existing atomic adoption rebuild. A source delta never upgrades
old evidence. Separate tests reject a corrupted round-1 completed certificate
and a persisted old partial prefix whose time had already moved backwards.

Page and certificate admission retain the outer caller ceiling but use the
current heap occupancy, including the batch's vectors, output reservation and
member images. They no longer assign the saved caller usage back to the meter.
The new boundary regression pins **716,544 B** for the declared 32-row page and
**9,441 B** of intervening batch occupancy. Direct and nested calls both use one
row at page-minus-one and 32 rows at the exact page size and page-plus-one;
this also runs with 17,000 B already occupied before the batch. Existing large
payload, witness, finite-heap and stream cases remain in the affected cohort.
Scalar certificate selection uses current occupancy too.

**Clock inputs actually exposed by the server.** Release serving reads
`SystemTime` through `now_ms()`, so a backwards wall-clock correction from NTP
or around a VM resume can be visible. Resume alone does not imply a rollback.
A running dev clock uses `Instant` elapsed time and rejects negative
`clock advance`; that control cannot rewind it. Restarting dev with a different
`--clock-offset`, explicit `run --now` values, and core `Context::at` / recount
inputs can supply earlier times across durable operations. Transactions pin
their operation time; the implementation assumes no cross-transaction monotonicity.
The code audit and chosen rule are recorded in LLP 3000.015 §3.

**Independent proof and negative controls.** The two literal review reproductions
fail on unchanged round 1: stream 0 versus independently expected/full-acquisition
1 at time 9, and 1,100 versus 1,101 at time 2. The exact-page test fails because
the nested caller admits 32 rows with one byte too little remaining space.
These are assertion failures (exit 101), not build errors. Retained evidence:
`round2/rollback-round1-control.log`, `heap-round1-control.log`.

The extended property uses the same eight seeds, now with 1,225–2,192 initial
sources, generated review-counterexample prefixes, and 300 steps per seed:

| Member declaration | Seeds | Model/scalar comparisons | Full-acquisition comparisons |
| --- | --- | ---: | ---: |
| Non-expiring | 1, 28, 195939070, 305419896 | 22,530 | 1,200 |
| Expiring | 7, 20261002, 3735928559, 24301 | 21,759 | 1,200 |

Across **2,400 steps** (80 generated-prefix steps, 2,320 random actions), it
executes **638 committed recount chunks**, **138 interrupted chunks**, 61 random
backward and 76 random forward clock moves, 163 failed source transactions,
and **330 actual SQLite close/reopens**. Expiring grants, member deadlines,
source expiry, tombstones, sender exclusion, joined/seen floors, rule adoption,
ordinary message/reaction aggregates and deliveries interleave with that work.
Interrupted source writes inject an error after ordinary contribution maintenance;
interrupted recounts drop their transaction before commit. Durable source, member,
count, basis and work rows must match their before-images after rollback. This
is transaction interruption/reopen coverage, not a power-loss hardware claim.

The oracle owns independent maps of source, member, grant and reaction facts.
It evaluates the fixture's comparisons and lifetimes directly; it never uses
`RowKey::matches`, cached counts, evidence deadlines or the engine's live-row
selector to compute expected values. Stream delivery is additionally compared
with scalar reads and full authorized acquisition in the same transaction.
Expired unswept members/grants stay in the model so rollback can revive them.

The expanded properties fail on round 1 for **both** counterexamples: seed 7,
step 2 gives 0 versus 1,328, and seed 1, step 8 gives 1,761 versus 1,762.
`tools/negative-control-round2.py` restores the exact relevant round-1 production
sources for these runs, requires the intended assertion failures, and restores
all candidate files in `finally`. The final negative controls and final affected
suite are retained. **42/42** affected Rust tests pass. The 50-member 10k/100k
work regression remains **(recertified source rows, public examined, public steps)
= (0, 100, 100)** at both populations. Guide **110/110** and frozen-schema
compatibility pass without changing a budget.

**Busy-group remeasurement.** Same production flags, copied round-0 seed,
50 members, 10,000 messages, three Chromium wasm devices, mounted 20-row history,
500-row acquisition, automatic delivery/seen reporting and 50 sends per condition.
The new work schema is adopted on startup. Each run yields 100 remote renders
and 150 active-device notification observations, with no timeout or browser error.
No BG build/test runs during measurement. Milliseconds, median / p95 / maximum:

| Condition | Round 0 | Round 1 | Round 2 |
| --- | ---: | ---: | ---: |
| Idle | 330.6 / 377.8 / 433.5 | 132.5 / 187.0 / 250.3 | 136.4 / 203.5 / 225.2 |
| 96 burners | 706.8 / 1,075.2 / 1,202.9 | 234.3 / 328.3 / 449.4 | 238.6 / 339.6 / 346.3 |

Round 1's large improvement is preserved; this is not a claim of identical
latency. P95 is 16.5 ms (+8.8%) higher idle and 11.3 ms (+3.4%) higher loaded
than the recorded round-1 runs, with lower maxima. Idle still passes p95 <250 ms.
Both conditions recertify zero history rows in all 100 remote deliveries.
CPU during measured sends is 7.03 / 7.89 / 9.14% idle (21 samples) and
99.57 / 99.84 / 99.88% loaded (40 samples). All 96 normal-priority burners
remain alive for the loaded scenario and are reaped afterward. The host is shared,
not exclusively reserved. Toolchain/profile/environment and binary hashes are
retained under `round2/`; these are Linux EPYC measurements, not Mac predictions.

| Stage | Idle round 1 p95 | Idle round 2 p95 | Loaded round 1 p95 | Loaded round 2 p95 |
| --- | ---: | ---: | ---: | ---: |
| Send → request | 62.9 | 70.8 | 147.5 | 154.6 |
| Request → commit | 7.8 | 8.0 | 19.7 | 21.3 |
| Commit → notification | 10.9 | 13.2 | 144.5 | 64.5 |
| Notification → sync request | 43.4 | 44.6 | 67.6 | 73.1 |
| Sync request → EOF | 12.9 | 15.3 | 31.2 | 26.4 |
| Live-count certification | 1.088 | 1.066 | 4.205 | 2.343 |
| Response → apply start | 3.3 | 3.3 | 7.8 | 6.8 |
| Device apply | 16.0 | 16.0 | 20.9 | 24.1 |
| Apply end → history end | 30.1 | 26.6 | 54.8 | 52.2 |
| History query | 25.1 | 23.8 | 17.0 | 18.1 |
| Decorations query | 27.0 | 23.9 | 50.1 | 42.8 |
| History end → public observation | 49.3 | 48.6 | 98.3 | 68.1 |
| Publication → React | 1.1 | 1.1 | 3.2 | 4.5 |

Send stages have 50 samples, remote stages 100. Overlapping intervals and
percentiles are not additive; notification may follow an already-active sync.
Complete stage summaries and client attribution remain beside each trace.

**LL control.** Unchanged harness, `LL_KEEP=viewed`, wasm, matching debug server,
20 repetitions of each flow: 160 samples, no timeout. Commit → React milliseconds:

| Flow | Round 1 median / p95 / max | Round 2 median / p95 / max |
| --- | ---: | ---: |
| profile | 37.6 / 45.0 / 45.0 | 34.5 / 40.0 / 41.9 |
| reaction-add | 39.6 / 44.2 / 102.5 | 34.7 / 41.3 / 42.1 |
| reaction-replace | 38.6 / 41.5 / 41.7 | 36.7 / 40.5 / 40.6 |
| reaction-remove | 40.2 / 48.3 / 48.4 | 37.9 / 42.5 / 44.2 |
| reply | 82.7 / 89.8 / 95.6 | 77.0 / 86.3 / 100.3 |
| photo | 87.8 / 95.9 / 98.5 | 79.3 / 89.0 / 90.7 |
| feed-image | 43.1 / 48.3 / 51.1 | 34.0 / 44.1 / 46.0 |
| once-photo | 84.5 / 90.6 / 93.9 | 71.5 / 89.0 / 102.2 |

LL has neither a row-keyed count view nor the app authority facade. It remains
a control for incidental effects, not a measurement of either BG optimization.
Media readiness is separate and retained in the unchanged harness output.

**Wasm.** 2,015,329 B raw / **605,005 B gzip**, measured with the build script's
`gzip -9 -c FILE`: +0 raw / +2 gzip versus round 1. The unchanged ratchet is
605,225 B, leaving 220 B on Linux; the reported 110–130 B macOS difference
would leave 90–110 B. No ceiling is raised and no Mac measurement is claimed.
`round2/wasm.json` binds the measured artifact. The full suite rebuild
matches its SHA-256, binding these measurements to the final artifact.

**Failures and dispositions.** Expected red controls are listed above. All
unexpected development failures are retained and classified in
`round2/failure-ledger.json`:

- **Ours, corrected:** the first heap test draft called a nonexistent footprint
  helper (`test-draft-compile.log`). It now prices the member through the authorized
  image boundary plus the declared batch allocations. Two setup edit attempts also
  used repository-relative paths from the nested workspace and were rerun correctly.
- **Ours, corrected:** the first expanded property wrongly removed born-expired
  members from its model (seed 3735928559, step 259, `row-views-first.log`). Such
  recipients and grants stay physically stored until retirement and can revive.
  The corrected full property and final 42-test cohort both pass, with no production
  change made to accommodate that incorrect model assumption.
- **Ours, corrected:** staging flagged three raw tool logs with trailing blank
  lines. Their exact bytes are preserved as gzip files; the staged whitespace
  check then passes.
- **Environmental measurement-condition failure:** the first attempted idle run
  completed all 50 sends at 177.8 / 273.0 / 309.2 ms, then failed the p95 <250
  assertion. CPU samples during sends are 99.19% median / 99.66% p95, with another
  lane's `node scripts/contended-reads.mjs` owning the burner workers (parent
  PID 352240, lane CT). It is retained as `external-load-attempt`, not silently
  counted as idle or discarded. All 100 deliveries still recertify zero history
  rows. After that load ended, the complete idle phase was repeated and passes
  with the utilization recorded above. No other lane's processes were stopped.

**Complete suite (one invocation).** Exact terminal summary:

```text
== 0 failure(s) in 1635 s
```

All original phases ran. Rust passed (634 s); the client pool passed **5,745**
tests with ten existing skips, zero failures and zero cancellations out of 5,755
(597 s); all **79** serial model cases passed (307 s). No full-suite correction
or affected-phase rerun was needed. Full-suite failures: **ours 0, baseline 0,
environmental 0**. The complete guide/compatibility run and final affected Rust
cohort passed before this invocation. Reference validation also passes.

The suite's rebuilt wasm is byte-identical to the measured artifact, and the
restored normal client `app.js` digest remains
`d998f75a5141cf077a42c855bc444ec9b2d3c02b70f5d352e6778e1fe147d260`, matching
round 1. Temporary server instrumentation was restored before the suite; the
ignored client instrumentation was removed by the ordinary SDK build.


The scenario validator passes (`round2/qualification-final.json`), including
all renders, notifications, windows, zero history work, owned/reaped burners,
idle p95 assertion and all LL samples. LLP 3000.015 §3 and the guide describe
the revised rule; one append-only journal entry records this round. Source and
artifact hashes and the complete evidence set are bound by the report checksums.
## Round 3 — member lifetime dispatch and malformed evidence

Base: `fcc4b644f9`. This round addresses Astra's high-severity dispatch finding
and Grok's matching finding, forward-only maintenance concern, and malformed
basis timestamp. No merge from main, push, publication, or budget increase.
The scoped context pack is `round3/CONTEXT.md`.

**The class is fixed at dispatch.** `Maintain::row_count_needs_live_basis`
classifies a row-keyed count from **both** source and member effective lifetimes.
Scalar/prepaid reads, grouped delivery, stream preparation, cold acquisition,
device reads and prediction, member refreshes, and private recount publication
now use that classification. Direct, inherited, two-level `read through`, and
currently null member deadlines all qualify. An expiring member cannot reuse a
numerical certificate. Its source can be non-expiring; the batch then walks the
parent index instead of an expiry index. Finite caller heap admission and the
fixed public reservation are unchanged. The busy-group fixture's source-expiry,
non-expiring-member branch still reuses valid transactional evidence.

LLP 3000.015 §3 now audits every count-return dispatch, including horizon
fallbacks, numeric versus existence witnesses, and device prediction. The only
remaining direct stored-count path has neither a source nor a member effective
expiry declaration: no expired member can have been skipped. Source-only checks
that remain select source expiry indexes/basis subtraction or ordinary aggregates;
they cannot bypass the row-keyed dispatch.

**Current-main control.** An isolated checkout of current main
`738d45830c9d51c9c92f65180c56cbecb2f2b068` contains BG round 0, but neither
round 1 nor round 2, and reproduces both literal review cases. Only test modules are added there; no
production fix is transplanted. Both values below are read by a single compiled
query, in one transaction at one clock, beside its independently authorized
source rows, with `complete: true`:

| Reproduction | Round 2 | Current main | Fixed |
| --- | --- | --- | --- |
| Member deadline 10; non-expiring source inserted at 11; read at 9 | 0 versus 1 source | 0 versus 1 source | 1 versus 1 source |
| Member inherits room deadline 2000; source seeded at 1000, deleted by an ordinary mutation at 2500; read at 1500 | 1 versus 0 sources | 1 versus 0 sources | 0 versus 0 sources |

**The defect predates every BG round.** The identical final lifetime tests also
fail on main `6c598ef145e0eaf44831797bd2d631c60e03847b`, immediately before the
round-0 merge. Both that pre-BG main and current main produce **eight expected
assertion failures and two passes**: the two literals, three generated prefixes,
device poison, forward maintenance seam and source-delete underflow fail; public
forward renewal and fan-out rollback pass. `pre-bg-main.log` and
`current-main-final.log`, plus their `*-control.patch` test-only diffs, retain
the evidence. No production code is changed in either control.

`round3/round2-negative.log` retains the same eight assertion failures on exact
`fcc4b644f9`; `round2-malformed-negative.log` separately fails missing `at`.
Earlier `current-main-negative.log` and initial round-2 logs remain for provenance. The fixed literals also check batch, real stream and cold
snapshot images against raw facts. Source/member sync is enabled.

**Forward-only renewal: distinguish the helper from public writes.** The
additional sequence uses clocks **1 → 11 → 12**, never rollback. An ordinary
mutation targeting an already-expired member refuses with `NOT_FOUND` on main
and this branch. Seed/import restoration replaces the expired predecessor and
already recounts correctly on round 2 and main, for direct and through expiry.
It is **not** a reproduced public forward-only stale-count bug.

The old/new-image `row_view_member` maintenance seam itself does have the unsafe
shortcut Grok identified: with no predicate change, round 2 and main copy zero
past a renewal although one source arrived while the member was expired. A
separate helper regression demonstrates that failure without mislabeling it an
ordinary mutation. The joint lifetime rule removes that shortcut and the
incremental member-delta shortcut for expiring members; refresh recounts, or
leaves pending work which reads independently certify. The source prediction
path likewise recomputes instead of adding a delta to a delivered cache.
`main-forward-final.log` retains the **one passing public-path test and one
failing helper test** on main. The fixed branch passes both. Immutable
read-through parent fields cannot be changed in place; generated adoption
changes recapture lifetime inputs and rebuild counts.

**Additional source-write consequence found during this round.** A real CLI
probe seeded an expiring member at 1, inserted its non-expiring source at 11,
then queried and deleted at 9. The corrected read returned 1, but the initial
round-3 writer still refused deletion with `E_OVERFLOW`: it subtracted from the
stale stored zero. This is the same untrusted numerical-cache problem on the
maintenance side. `post-rollback-write-probe-final.log` retains the reproduction.

A server source event now invalidates an expiring member's count and recount
prefix to zero/pending and restarts bounded private work. It never uses that
number as a delta basis; live reads/deliveries still recompute from authorized
input. The writer adds no source-group scan, stays inside the existing per-member
reservation and emits its ordinary view refresh. Continuous writes can restart
that private work; it settles after quiescence. Non-expiring members keep the
original incremental path. A regression covers direct, inherited and two-level
members, each over both source lifetime declarations, including an ordinary
source delete followed by private settlement.

The single full-suite invocation was already running when this additional
consequence was found. Its result is retained below, with final affected checks
and final artifact measurements identified separately; it is not silently
restarted or represented as having tested source bytes it did not consume.

**Malformed evidence.** A matching version is insufficient without an integer
`at <= now`, a correctly typed version and deadline, a literal false pending
bit, and a nonnegative integer count in range. Missing/mistyped fields take the
authorized walk. The corruption test removes or mistypes each of `at`,
`deadline`, `version`, `recountPending`, and `value` (15 cases); the wrong nominal
type for `version` even retains the correct digest bytes. Other evidence stays
valid and the numerical cache is poisoned. The round-2 negative control fails
on missing `at`; `malformed-final.log` passes all 15 cases. Valid v2 evidence
keeps its existing meaning; this repairs validation of already-required fields,
not the interpretation or version of a well-formed proof.

**Independent property proof.** The original eight-seed generator still runs
2,400 steps with its large populations, interrupted transactions/recounts,
reopens, authority grants, ordinary aggregates and clock rollback. Its cold
acquisition comparison now checks the model's expected value separately for
every member, including absence, instead of comparing two dispatch answers.
It retains 44,289 model/scalar/aggregate comparisons and 2,400 acquisition-batch
checks, 650 committed recount chunks and 141 interrupted chunks on the final maintenance fix.

The added generator uses the same raw-fact model approach across two groups,
independent source/member lifetime adoption, mutable count-parent moves, source
moves, physical sweeps, predicate and default adoption, and overlapping durable
SQLite readers. Effective member life is computed from the fixture's parent
facts; no stored count, engine expiry selector, `RowKey::matches`, or certificate
decides the expected result. Defaults include legal legacy rows missing the
defaulted field, constructed with unchanged meaning before adoption. Normal
inserts persist their default; the oracle does not mistakenly reinterpret them.

| Member topology | Seeds | Random/deterministic scheduled actions | Independent comparisons | Overlapping writer/read cases |
| --- | --- | ---: | ---: | ---: |
| Direct expiry | 7, 24301 | 360 | 21,480 | 31 |
| Inherited from counted room | 20261002, 28 | 360 | 30,984 | 38 |
| Two-level `through` with a separate lifetime parent | 3735928559, 305419896 | 360 | 22,110 | 27 |

Each seed first executes a review counterexample prefix; **all three topology
properties fail on exact round-2 dispatch** at that prefix. Across the 1,080
subsequent actions, the operation totals are 105 member writes/moves, 233 source
writes/moves, 121 source removals, 108 clock selections, 110 sweep calls, 106
adoptions, 90 recount attempts, 111 physical close/reopens and 96 overlapping
reader/writer cases. Read clocks range over 9, 1500, 1900, 2500, 3900 and 4500;
large forward/backward moves are generated, not limited to ±20. Every overlap
holds the old read transaction at 1500 across a write at 2500, opens a newer
reader at 2500, and checks both against their own independent model snapshot.
A through-member insert uses an earlier supplied writer clock when necessary
to satisfy its parent's activation rule; the generated read clock stays separate.

The **74,574** added comparisons independently check scalar, batch, acquisition,
and actual stream/snapshot values, including absence and pending state. Two
matching stale paths cannot pass. Separate device tests poison a stored value
with 999 and require exact covered recomputation or incomplete uncovered output
for all three topologies; member prediction refresh cannot preserve that poison.
A 100-member cap overflow aborts a transaction after a source delta and leaves
all count/source before-images unchanged. These cases augment rather than
replace the large-population property and existing device suite.

**Affected checks.** The initial 52/52 row-view cohort passed; the final
maintenance fix passes **53/53**, including all 15 malformed-field cases. The
separate nominal-type check also passes in `malformed-final.log`. The 50-member 10k/100k regression remains
`(recertified source rows, public examined, public steps) = (0, 100, 100)` at
both sizes. Negative-control tooling restores every production file in `finally`;
all expected reds are assertion failures, not build failures.

**Initial round-3 busy-group measurement (before the late maintenance fix).** The unchanged calibration was seeded once because
its old temporary cache was no longer present, then copied for both conditions.
Same production flags, 50 members, 10,000 messages, three Chromium wasm devices,
20-row mounted history, 500-row acquisition, 50 measured sends and automatic
receipt reporting. No BG build/test ran during either scenario. Both produce
100 remote renders, 150 active-device notifications, zero browser errors or
timeouts, and **zero recertified history rows** in all remote deliveries.
Milliseconds, median / p95 / maximum:

| Condition | Round 2 | Initial round 3 |
| --- | ---: | ---: |
| Idle | 136.4 / 203.5 / 225.2 | 136.4 / 186.9 / 255.3 |
| 96 burners | 238.6 / 339.6 / 346.3 | 241.3 / 410.0 / 462.2 |

Idle p95 passes the unchanged **<250 ms** assertion, improving 16.6 ms (8.2%)
from round 2; its maximum is 30.1 ms higher. Loaded p95 is **70.4 ms higher
(+20.7%)**, and its maximum is 115.9 ms higher. The incremental work property is
preserved; identical loaded latency is **not** demonstrated. Both remain far
below the round-0 377.8 / 1,075.2 ms p95 results, but the loaded tail increase is
retained as measured, not retried away or called a test failure. These separate
shared-host runs do not establish a causal performance attribution.

Measured host CPU median / p95 / max is **6.22 / 7.43 / 7.54%** idle (21 samples)
and **99.46 / 99.84 / 99.92%** loaded (40 samples). All 96 normal-priority burners
stay alive through the loaded run and are reaped afterward. No other lane's
process is stopped. The host is a shared Linux EPYC; these are not Mac results.

| Stage | Idle R2 p95 | Initial idle R3 p95 | Loaded R2 p95 | Initial loaded R3 p95 |
| --- | ---: | ---: | ---: | ---: |
| Send → request | 70.8 | 56.9 | 154.6 | 178.6 |
| Request → commit | 8.0 | 8.8 | 21.3 | 19.7 |
| Commit → notification | 13.2 | 9.6 | 64.5 | 72.3 |
| Notification → sync request | 44.6 | 42.2 | 73.1 | 70.9 |
| Sync request → EOF | 15.3 | 13.4 | 26.4 | 33.1 |
| Live-count certification | 1.066 | 1.059 | 2.343 | 3.618 |
| Response → apply start | 3.3 | 3.5 | 6.8 | 7.3 |
| Device apply | 16.0 | 15.5 | 24.1 | 25.6 |
| Apply end → history end | 26.6 | 30.4 | 52.2 | 56.7 |
| History query | 23.8 | 22.5 | 18.1 | 21.3 |
| Decorations query | 23.9 | 26.5 | 42.8 | 50.5 |
| History end → public observation | 48.6 | 49.4 | 68.1 | 88.7 |
| Publication → React | 1.1 | 1.1 | 4.5 | 3.9 |

The trace shows higher loaded send → request and query → publication tails,
as well as a 1.275 ms increase in live-count certification p95. These intervals
overlap; percentile differences are not additive and do not explain the complete
tail by subtraction. Send stages have 50 samples, remote stages 100. Source
work, public examined rows and windows remain unchanged. Raw traces, all stage
summaries and client attribution are under `round3/`.

**Initial LL control.** Unchanged harness, `LL_KEEP=viewed`, wasm, matching debug
measurement server, 20 repetitions of all eight flows: 160 samples, no timeout.
Commit → React milliseconds:

| Flow | Round 2 median / p95 / max | Initial round 3 median / p95 / max |
| --- | ---: | ---: |
| profile | 34.5 / 40.0 / 41.9 | 37.3 / 43.2 / 43.9 |
| reaction-add | 34.7 / 41.3 / 42.1 | 36.2 / 45.5 / 56.7 |
| reaction-replace | 36.7 / 40.5 / 40.6 | 37.3 / 44.4 / 62.7 |
| reaction-remove | 37.9 / 42.5 / 44.2 | 40.3 / 44.8 / 48.0 |
| reply | 77.0 / 86.3 / 100.3 | 83.6 / 88.5 / 91.8 |
| photo | 79.3 / 89.0 / 90.7 | 87.4 / 94.6 / 95.7 |
| feed-image | 34.0 / 44.1 / 46.0 | 41.7 / 45.9 / 47.6 |
| once-photo | 71.5 / 89.0 / 102.2 | 73.9 / 87.9 / 88.8 |

LL has neither the row-keyed count nor the app authority facade; this remains
an incidental-effects control. Media readiness stays separate in its output.
The combined trace validator passes (`round3/qualification-final.json`).

**Initial wasm.** **2,015,371 B raw / 605,077 B gzip**, measured by the build script's
`gzip -9 -c FILE`: **+42 raw / +72 gzip** versus round 2. The branch ratchet
remains **605,225 B**, with **148 B** headroom. Fetched main's RV ratchet is
**610,782 B**, 5,705 B above this artifact; it is reported, not copied into this
branch. No ceiling changes and no Mac measurement. The artifact digest is
`1e7be6f8e2e21af80b3cafcf47231b61302a7c28cca76f923f268f911285967d`.
Guide **110/110** and frozen-schema compatibility pass with the original limits.

**Development and control failure ledger.** Earlier failures remain evidence;
only completed, passing runs are counted as verification.

| Run / failure | Attribution and disposition |
| --- | --- |
| `test-draft-compile.log`: two event-type mismatches and one unresolved map type | Ours, test draft. Corrected the separate stream/snapshot event types and annotated the independent maps. |
| `lifetimes-first.log`: two unknown operations | Ours, fixture. Core compiled operation names require the `lifetimes.` namespace. |
| `lifetimes-second.log`: inherited literal still had its source; three generated default mismatches | Ours, fixture/oracle. Added the missing source delete permission; ordinary inserts persist defaults, so the model must not reinterpret them after adoption. Legacy absent-field rows are now constructed explicitly. |
| `forward-first.log`: expired-member mutation returns `NOT_FOUND` | Ours, incorrect test expectation. The actual public behavior is verified on main and round 2; seed/import renewal already works. The separate old/new-image seam reproduces Grok's shortcut without claiming public mutation reachability. |
| `negative-final-runner.log`: expected seven failures but observed six | Ours, control-harness expectation. The public renewal passed; separating the maintenance-seam regression makes the expected failure explicit. The final cohort also includes the later source-delete regression. |
| `guide-compat.log`, `guide-compat-final.log`: `start::openings_fit_without_growing_the_eight_reference_cards` | Ours, documentation. First 884 and then 881 lines exceeded 879. Shortened to 879; `guide-final.log` passes 110 tests and frozen-schema compatibility. No ceiling changed. |
| `post-rollback-write-probe.log`: CLI unknown operations | Ours, probe spelling. CLI `schema.q` operations omit the `schema.` namespace; corrected in the retained follow-up probe. |
| `post-rollback-write-probe-final.log`: ordinary source delete refuses with `E_OVERFLOW` | Baseline, verified on both current main and pre-BG main. Discovered after the initial round-3 read fix; final source-event invalidation and the six-combination regression repair it. |
| Exact `fcc4b644f9` negative controls | Expected assertion failures: both literal review cases, three topology prefixes, poisoned device count, forward-only maintenance seam, source-delete underflow; separately, missing `at`. All are retained, and production files are restored in `finally`. |
| Current-main and pre-BG-main controls | Expected baseline assertions, with exact revisions and test-only patches retained. The public forward renewal and fan-out rollback controls pass. |

`affected-first.log` was interrupted when the second review arrived; it has no
terminal result and supplies no pass claim. The completed final core cohort
passes 53 tests. The final integration cohort passes **29 tests**: accounting 6,
disclosure 18, legacy 1, witness 3, sync-count delivery 1
(`affected-integration-final.log`). These consume the late maintenance fix.
The initial empty `workflow.log` is an abandoned launcher, not a suite invocation.

**Single full-suite invocation.** Exact terminal line:

```text
== 0 failure(s) in 1485 s
```

Exit 0. The Rust phase passes (472 s), the client pool passes **5,745** tests
with **ten skips**, zero failures/cancellations (582 s), and all **79** serial
models pass (357 s). Builds, wasm ratchet, docs budget, release guard,
typechecks, chat check and nine fixture tests pass. Full-suite failures:
**ours 0, baseline 0, environmental 0**. Expected fault-injection stderr (for
example `E_EFFECT_CLOSED` and refused auth partitions) belongs to passing tests,
not hidden failures. The main controls establish baseline product bugs; no
unexplained suite red is labeled baseline.

The suite's binaries contain the initial round-3 dispatch/evidence fix, before
the late source-event cache invalidation. The final 53-test core and 29-test
integration runs cover that maintenance change. The final artifact confirmation
below rebuilds and measures the final source. `scripts/test.sh` is not run again.

**Final wasm, after the maintenance fix.** Rebuilt explicitly: **2,015,371 B
raw / 605,071 B gzip**, **+42 raw / +66 gzip** versus round 2, and 6 gzip bytes
smaller than the initial round-3 artifact. The branch cap remains **605,225 B**
(**154 B headroom**); main's separate RV cap remains **610,782 B** (5,711 B above
this artifact). No ratchet was changed. Final SHA-256:
`f88840a86df9aa780f4de544df676e3285f4ef7597108a1f2775cedbbd40a00c`.
The suite rebuilt the initial artifact; final measurements use this rebuilt
artifact and newly compiled matching servers. Both artifact records are retained.

**Additional environmental measurement failure, retained.** The first idle
attempt with the final artifacts failed the unchanged `<250 ms` assertion:
**244.1 / 397.1 / 424.7 ms** median/p95/max. During its 38 measured host samples,
CPU was **99.95 / 99.98 / 99.98%**. Read-only PID/working-directory evidence
identifies concurrent Rust tests in the NX review and publication worktrees,
plus another lane's build; BG had no burners or build running. This was not an
idle condition. All 100 remote deliveries still re-certified zero history rows.
`final/unexpected-contention-idle*`, `unexpected-contention-assessment.json` and
`idle-host-contention.json` preserve the failure and evidence. Attribution:
**environmental**, specifically the absent idle precondition; the latency
failure itself is not erased or claimed as a passing benchmark.

The confirmation resumes with the **same binaries**, recording two-second
`/proc/stat` samples and waiting for five consecutive samples below 15% busy
before idle and before starting its own 96 burners. No other lane is stopped,
no measured assertion changes, and no source is rebuilt to obtain a better
sample. This host-admission step and every wait sample are retained in
`confirm-round3.py --measure-only` and `final/*-idle-admission.jsonl`.

The optional quiet-host wait for LL remained busy for over six minutes. Only our
waiting process was interrupted (no test or measurement was active). Final LL
then runs unchanged under recorded ambient load via `--ll-only --ll-current-load`,
without repeating either BG scenario or the suite. Its timings are labeled
contended; they cannot isolate incidental performance changes from host load.
`final/ll-host-decision.json` and the load sampler retain this distinction.

**Final busy-group confirmation.** Same final binaries, fixture, seed cache,
50 sends, 100 remote renders and 150 notifications per condition. The valid
idle run passes the unchanged `<250 ms` p95 assertion. No BG build or test
overlaps either scenario. All 96 normal-priority burners remain alive through
the loaded scenario and are reaped afterward; a subsequent PID check finds
none remaining. Both runs re-certify **zero history rows** in all 100 deliveries.
Milliseconds, median / p95 / maximum:

| Condition | Round 2 | Initial round 3 | Final round 3 |
| --- | ---: | ---: | ---: |
| Idle | 136.4 / 203.5 / 225.2 | 136.4 / 186.9 / 255.3 | 131.4 / 171.3 / 185.0 |
| 96 burners | 238.6 / 339.6 / 346.3 | 241.3 / 410.0 / 462.2 | 262.1 / 458.7 / 468.9 |

Final idle p95 is 32.2 ms lower than round 2 (15.8%); loaded p95 is
**119.1 ms higher (35.1%)**. The incremental work invariant and unchanged
non-expiring-member path are proved; loaded latency parity is not. The initial
410.0 ms loaded result and invalid-idle 397.1 ms result remain visible. This is a
shared host, not a controlled attribution experiment; other work can begin after
the pre-run quiet check. Host CPU after the final burners exited was about 55%,
from other client-test processes. No cause is assigned solely from elapsed tails.

During sends, host CPU median / p95 / max was **15.8 / 19.2 / 30.9%** idle (21 samples) and **99.5 / 99.7 / 99.8%** loaded (44 samples).

| Stage | Final idle p95 (ms) | Final loaded p95 (ms) |
| --- | ---: | ---: |
| Send → request | 66.100 | 179.200 |
| Request → commit | 7.824 | 35.231 |
| Commit → notification | 10.167 | 59.177 |
| Notification → sync request | 45.600 | 116.300 |
| Sync request → EOF | 14.300 | 31.200 |
| Live-count certification | 1.039 | 1.060 |
| Response → apply start | 3.700 | 12.700 |
| Device apply | 15.700 | 24.500 |
| Apply end → history end | 28.400 | 66.100 |
| History query | 25.200 | 21.400 |
| Decorations query | 25.700 | 61.200 |
| History end → public observation | 47.700 | 113.100 |
| Publication → React | 1.300 | 3.700 |

Loaded live-count certification is 1.060 ms p95, versus round 2's 2.343 ms;
the larger tails occur elsewhere, including notification → sync request and
query → publication. These intervals overlap, so percentile differences cannot
be summed into an explanation of total latency. Full per-view traces, client
attribution, host samples and artifact hashes are under `round3/final/`.

**Final LL control (ambient contention).** Matching final debug measurement
server and wasm; unchanged `LL_KEEP=viewed`, 20 repetitions of each of eight
flows: **160 samples, zero timeouts**. Commit → React milliseconds:

| Flow | Final median / p95 / maximum |
| --- | ---: |
| profile | 35.4 / 45.7 / 51.9 |
| reaction-add | 38.5 / 57.6 / 61.6 |
| reaction-replace | 38.9 / 44.9 / 49.0 |
| reaction-remove | 37.7 / 45.7 / 47.9 |
| reply | 85.0 / 104.8 / 129.2 |
| photo | 90.5 / 112.3 / 147.8 |
| feed-image | 39.8 / 54.6 / 69.5 |
| once-photo | 80.0 / 98.1 / 102.7 |

Across the LL wrapper's 38 host samples, CPU median / p95 / max was **99.8 / 99.9 / 99.9%**. These are contended timings, not a quiet-host comparison. Media readiness remains separate in the raw summary.

The final combined trace validator passes (`round3/final/qualification-final.json`):
all renders, notifications, windows, zero history work, 96 owned/reaped burners,
idle p95 assertion and all LL flows. The source and test digest record is
`round3/final-source-sha256.json`. The ordinary SDK and server are rebuilt after
measurement, and temporary source instrumentation is restored.

The failure ledger above covers development errors, expected baseline controls
and the one invalid-idle environmental failure; none is dropped from the record.
Large raw traces, test logs and test-only patches are stored as `.gz` files
(the prose omits that suffix for readability). Decompress patches before applying.
`round3/SHA256SUMS` binds the retained evidence, report, governing docs, tools and
final changed source. No main merge, push, publication or ceiling change.

## Round 4 — private maintenance and certified predicate fields

Base: `587b83d7c8`; paired measurement control: exact round 2 `fcc4b644f9`.
Read the round-3 section first and applied the operator's structural ruling.
Grok's READY and Astra's NOT READY are input reviews, not round-4 approvals.
No main merge, push, publication, or budget increase. Context: `round4/CONTEXT.md`.

**Private bookkeeping is no longer a public field mutation.** Source events for
expiring recipients preserve the cached numerical fields and restart only private
`$recount` work. They still emit the usual view refresh. Incomplete member recounts
remove old `$basis` evidence and retain the previous cache only within the same
parent domain. A new or moved member with no completed count has neither numerical
cache field, instead of an invented zero or flipped pending bit. A separate
stored-cache validator admits that internal shape during adoption; ordinary input
and public projection validation remain strict. Source updates consult private
work before applying numerical deltas. Durable source/member pairs project their
existing incomplete fallback response from private work, whose key is reserved
before storage access. Expiring-source/member reads retain the authorized walk
and eligible transactional certificate path.

`recountPending` describes the **current read's incompleteness**. A witness
predicate involving either `value` or `recountPending` now takes precisely the
same certification path, including read rules and insert rules. An uncertified
field cannot decide a rule or writer: existing `E_VIEW_KEY` refusal applies.
`id`/`member` remain exact identities, checked against current member existence
and effective lifetime. Every copied member authority column is updated in the
member transaction and never carries recount status. The compiler's projected
field set is still authoritative; unrelated member and recorded attribution
fields are not copied. Raw-schema indexes on either computed field also refuse,
so index selection cannot consult a stale cache before certification. These field
policies are specified in LLP 3000.015 §3 and the existing maintains guide.

The v2 proof interpretation is unchanged: incomplete work removes evidence;
missing fields never certify. Legacy cached pending bits still fail reuse and are
reconstructed through the same public read path. No wire field, public schema,
count digest tag, caller ceiling or device prediction policy changed.

**The device cap is handled before payload access.** The durable-source scan now
checks the capped read immediately after the authorization boundary. Its cursor
comes from the encoded index position, independently of an accepted or rejected
payload. A rejected candidate never supplies `id`. The unchanged three-probe cut
and the previously broken four-probe cut both return incomplete meter observations
on Memory and SQLite, with no `E_TYPE`.

**Detecting regressions and independent properties.** The compiled literal puts
an expiring member, one durable message and a guarded row at clock 2. Before and
after private settlement, the count is 1, the returned flag is false, the read
rule hides the row and the insert rule refuses with `E_RULE`. The raw cached
count/flag are unchanged by the source event. The literal also tests matching and
nonmatching read/insert predicates on its copied `principal` field and every
other view column against explicitly constructed member/source facts.

The lifetime generator now enumerates **every declared view column**, for both
read and insert effects, with matching and nonmatching values. Expected count,
member existence and copied columns come from independent facts at the same
clock. Direct members use a parent access witness, so copied `conversationId`
values are exercised across generated parent moves. The three topologies retain
six seeds, 1,080 random/deterministic actions, clock reversal, expiry/sweeps,
adoption, interrupted work, reopen, stream/acquisition checks and 96 overlapping
reader/writer snapshots. Totals are **44,439 direct + 57,624 inherited + 42,414
through = 144,477 independent comparisons**. The original eight-seed,
2,400-step large-population property remains: **44,289 model/scalar/aggregate
comparisons and 2,400 acquisition checks**, with 650 committed and 141 interrupted
recount chunks. A separate 1,100-source case checks all predicates with absent
computed cache fields and with poisoned legacy pending/value fields.

The device property uses seed **20261002**, 16 generated source populations per
host, real acquisition, real prediction, clocks **2, 99, 100, 9**, and **0, 1, 2,
3, 4, 5, 6, 7, 8, 12, 32** remaining rule probes. Each host makes 64 unrestricted
and 704 bounded observations, **1,536 total**, comparing every complete count
with its independent source facts and requiring meter cuts for incomplete reads.
The first population is the review's one-message reproduction.

Negative controls use exact round-3 production files and restore them in `finally`:
`round3-rule-negative.log` exposes the guarded row; `round3-device-negative.log`
fails on both hosts at exactly four remaining probes with the reported `E_TYPE`.
An isolated rollback of only `witness.rs` fails the `recountPending = false`
independent-field assertion. These are assertion failures, not build failures.
No one claims they reproduce a bug on current main: they are detecting controls
for this lane's round-3 change.

Final affected core cohort: **56/56**; final focused field tests: **3/3**;
device cohort: **12/12**; disclosure/accounting/witness/legacy integration:
**28/28**; guide: **110/110**, frozen compatibility: **1/1**. The unchanged
50-member **10k/100k** regression is **(recertified source rows, public examined,
public steps) = (0, 100, 100)** at both sizes. `round4/FAILURES.md` retains every
development failure and its correction, separately from the final-source suite.

**Measurement design.** The busy-group fixture already expires its source and
never expires its members. Round 3's joint lifetime dispatch therefore selects
the same branch as round 2; the earlier loaded rise cannot be attributed to
that gate. Its final certification p95 also fell, 2.343 → 1.060 ms. Those unpaired
shared-host measurements did not establish the cause of the end-to-end increase.

This round builds exact round 2 in an isolated control worktree and saves each
variant's own production server, debug LL server and instrumented SDK/wasm.
Within each condition, order is **base, candidate, base, candidate**. All eight
BG runs use the same seed cache copied into a fresh database, 50 measured sends,
50 members/10,000 messages, three Chromium wasm devices, mounted history 20 and
acquisition 500. Every idle run requires five consecutive two-second host samples
below 15% busy before starting and retains the unchanged **p95 <250 ms** assertion.
The four loaded runs share one continuous set of **96 normal-priority burners**.
No BG build or test overlaps measurement. Host samples and stage traces are
retained for every run. LL uses each variant's own debug measurement server and
wasm, `LL_KEEP=viewed`, 20 repetitions of all eight flows.

**Paired BG results.** Milliseconds from send to the slowest remote React render;
50 sends per run. Base is rebuilt exact round 2, not its historical measurement.

| Condition/order | Variant | Median / p95 / maximum (ms) | CPU median / p95 / max (%) | Certification p95 (ms) |
| --- | --- | ---: | ---: | ---: |
| idle 1 | base | 142.6 / 213.0 / 239.6 | 7.3 / 12.1 / 16.1 | 1.121 |
| idle 2 | candidate | 127.7 / 181.8 / 235.0 | 9.1 / 26.8 / 43.7 | 1.024 |
| idle 3 | base | 135.7 / 184.3 / 201.1 | 14.3 / 17.9 / 18.0 | 1.031 |
| idle 4 | candidate | 133.8 / 193.1 / 218.2 | 11.5 / 13.1 / 13.4 | 1.057 |
| loaded 1 | base | 244.3 / 376.0 / 465.6 | 99.6 / 99.8 / 99.9 | 3.771 |
| loaded 2 | candidate | 257.3 / 410.6 / 450.0 | 99.8 / 99.9 / 99.9 | 1.169 |
| loaded 3 | base | 315.2 / 572.9 / 780.3 | 99.9 / 100.0 / 100.0 | 3.788 |
| loaded 4 | candidate | 337.7 / 533.3 / 576.0 | 99.9 / 99.9 / 99.9 | 3.699 |

| Pooled condition (100 sends each) | Base median / p95 / max (ms) | Candidate median / p95 / max (ms) |
| --- | ---: | ---: |
| idle | 140.4 / 186.7 / 239.6 | 129.5 / 184.6 / 235.0 |
| loaded | 266.5 / 465.6 / 780.3 | 282.6 / 450.0 / 576.0 |

The two adjacent loaded p95 differences are **+34.6 ms (+9.2%)** and
**−39.6 ms (−6.9%)**. The candidate's pooled loaded p95 is 15.6 ms lower (−3.4%),
while its pooled median is 16.1 ms higher (+6.0%). Base p95 itself ranges from
376.0 to 572.9 ms. Thus two pairs do not establish causal latency parity or a
speedup, and do not support the earlier unpaired 35% rise as a stable diff effect.
Same-send-ordinal differences are retained as descriptive pair data; send ordinal
is not an independent control for the scheduler. No attempt was discarded.

Loaded host CPU is consistently above 99.5% at the median, and the parent records
all **96 burners alive and reaped**. Idle admissions all pass, but ambient work can
start afterward: idle candidate 1 reaches 43.7% peak host CPU. Every idle p95 still
passes the unchanged 250 ms gate. All eight runs have **100 remote renders, 150
notifications, history window 20, acquisition window 500 and zero re-certified
history rows**. Per-stage tails and all raw sends are retained; overlapping stage
percentiles must not be added into an end-to-end explanation.

**LL control.** Twenty repetitions per flow per variant, **320 observations and
zero timeouts**, after quiet-host admission. Milliseconds from server commit to
React. Media readiness remains separately recorded in each raw summary.

| Flow | Base median / p95 / max (ms) | Candidate median / p95 / max (ms) |
| --- | ---: | ---: |
| profile | 34.030 / 38.655 / 39.479 | 28.961 / 38.239 / 38.455 |
| reaction-add | 27.999 / 42.334 / 42.915 | 34.810 / 57.354 / 100.910 |
| reaction-replace | 25.742 / 40.632 / 54.616 | 31.093 / 38.599 / 41.655 |
| reaction-remove | 26.644 / 38.671 / 39.670 | 30.228 / 40.874 / 41.418 |
| reply | 51.253 / 78.837 / 95.610 | 62.201 / 82.601 / 83.042 |
| photo | 60.341 / 84.975 / 88.731 | 63.684 / 82.334 / 87.096 |
| feed-image | 26.695 / 39.604 / 46.444 | 25.941 / 41.840 / 46.016 |
| once-photo | 47.443 / 81.585 / 92.649 | 65.325 / 81.768 / 89.254 |

This is a control for unrelated flows, not an assertion that every tail improved.
For example, reaction-add p95 rises from 42.334 to 57.354 ms; reply rises from
78.837 to 82.601 ms. All eight flows complete without a timeout on both variants.
Across each LL wrapper, host CPU median / p95 / maximum is **15.3 / 18.6 / 19.3%**
for base (26 samples) and **13.6 / 20.2 / 22.1%** for candidate (27 samples).
`round4/paired-validation.json` verifies the BG/LL invariants and paired statistics;
`tools/validate-paired-round4.py` accepts the archived gzip traces directly.

**Wasm and artifact custody.** Final candidate: **2,015,799 B raw / 605,215 B gzip**;
exact round 2 rebuilt here: **2,015,329 / 605,005 B**. Delta **+470 raw / +210 gzip**
(+144 gzip versus round 3). The unchanged branch ratchet is **605,225 B**: only
**10 B headroom on this Linux toolchain**. No macOS build or cross-platform budget
claim is made. Candidate wasm SHA-256:
`a4a4014a1b221e39fbc8bf8d384f64065271f57ccbdfc8e7c45532ca489f1b30`.
`round4/wasm.json`, `toolchain.json` and `measurement-artifacts.json` bind the exact
base/candidate binaries and SDK distributions. Temporary instrumentation was
restored before the final-source snapshot and full suite.

**Full-inventory correction and measurement scope.** The first inventory found
one introduced mismatch: `live_view_page_and_point_certificates_cover_real_receipts`
expected 200 examined units for 100 durable view rows, but the private-work lookup
correctly adds 100. Its cost certificate would also understate the 300-unit
receipt. The CLI now reserves member lookup plus either live certification or
the private-work key lookup, recognizes member-only expiry, and describes
`recountPending` predicates through the same live-count classification as `value`.
The extended page/point certificate test passes **13/13**, including both
computed predicates and both lifetime dispatches.

The superseded suite was deliberately stopped with exit **143** after retaining
its main and parallel logs (`initial-suite*`); it has no completed summary and is
not counted as a full-suite pass. The failed test is **ours**, not baseline or
environmental. The completed full suite began after this final correction. The only
source delta from the measurement build is `scale.rs` and its receipt test:
**CLI diagnostics only; engine, device, SDK and guide source are identical**.
`measurement-source.json`, `final-source.json` and
`measurement-source-delta.json` make that scope explicit. The BG/LL harness does
not invoke the cost analyzer. No claim is made that the saved measurement server
binary includes the later CLI diagnostic correction.

**Final-source qualification.** `scripts/test.sh` completed once after the last
code/test change, with `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` and
Node 24.13.1. Exact summary:

```text
== 0 failure(s) in 1506 s
```

The complete Rust inventory (**281 binaries, 994 executions**, plus workspace
doctests) passes. Client tests: **5,745 passed, 0 failed, 10 skipped**; the serial
models: **79 passed, 0 failed**, retaining their full seeded sequence counts.
Final-suite failures: **ours 0, baseline 0, environmental 0**. No current-main
baseline exception is asserted or used. The earlier introduced cost-certificate
failure and all development/negative-control outcomes remain in `FAILURES.md`;
the superseded run is not a passing qualification.

`round4/final-verification.json` verifies all **1,784** captured source/input
digests unchanged from the final suite's start and its exit 0. The suite's wasm
is byte-identical to the measured candidate, still **605,215 / 605,225 B gzip**.
The regular SDK/server are restored by the suite's ordinary builds. Reference
validation passes: **525 LLP documents, 10,074 refs, 0 errors, 0 unchecked**.

Large raw traces and logs are retained as `.gz`; the final suite is
`round4/full-suite.log.gz`. `round4/SHA256SUMS` binds the retained evidence,
governing docs, report, tools and changed source. The older round-3 manifest names
the historical content at `587b83d7c8`; it is not rewritten to describe round 4.
One journal entry records this round. The local commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. No push, publication, main merge,
ratchet increase or round-4 reviewer approval is claimed.
