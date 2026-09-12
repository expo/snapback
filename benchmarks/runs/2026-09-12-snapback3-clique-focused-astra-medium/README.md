# Focused Snapback3 Clique experiment — Astra medium

Status: both Astra medium builds and both independent assessments are complete.
The selected workflows have useful passing results; full acquisition and
large-account offline retention fail.

Charlie requested this targeted run on 2026-09-12 after the [original full attempt](../2026-09-12-snapback3-clique-astra-medium/README.md) stopped at M1's required avatar capability. This variant exercises the client-coordination and performance scenarios without unrelated media, presence, push or scheduling prerequisites. Its exact [scope and measurement boundaries](SCOPE.md) were frozen before the fresh builder started.

The new session uses gpt-6-astra at medium reasoning and the unchanged private Linux package from source 409954115f151a72dd95e897c5f00f36877f11e0. It starts from the original builder's frozen text account/profile source, with no prior narratives, grades, receipts, runtime database or installed dependencies. It is a supplied-prerequisite-code experiment, not a from-zero cold build.

The selected work covers one ordinary client's independent resources, actual browser offline close/reopen and durable sends, same-account convergence, starter Insights correctness, and large messaging acquisition/storage/paging. A separate fresh session added polls and backfilled message counts in a populated starter database. The messaging projection retains 1002 conversations and 100015 messages globally; the hub is authorized for 100000 messages and the other scale probe for 10000. Media messages retain their identity and become labeled text.

The continuous result is mixed. One app client handles ordinary messaging,
restored authentication, independent resources and durable offline sends. The
builder still had to author acquisition and unread coordination. Full browser
acquisition remains expensive, and the independent assessor reproduced a
serious offline-history retention failure after a later send. This run does
not establish the holistic improvement proposed for Snapback3.

## Verified continuous outcomes

The [independent report](grader/grading/grader-report.json) is preserved with
separate [coordinator dispositions](coordinator-audit.md). The dispositions
reject one false grader navigation finding and preserve several coverage
limits; the raw report must not be read as an uncorrected defect inventory.

| Selected work | Outcome and limit |
| --- | --- |
| One ordinary app client | Verified; no additional app authenticated reader or private cache. Restored auth, account isolation, navigation and same-account sends pass at the exercised scope |
| Ancillary resource denied or delayed | Authorized messages remain usable; denied unread displays Unknown; sending settles once. The builder's separate whole-HTTP-batch failure remains unresolved and was not independently reproduced |
| Starter offline text workflow | Actual network disconnection, page close/reopen, acquired-page search, pending sends and two-client reconnect order pass. This does not establish complete large-account retention |
| Unread and delivery UI | Resource-level unread convergence and distinct receipt fields pass. Rendered positive-to-zero unread and a stable delivered-only UI state remain unproven |
| Starter Insights | Independently computed totals, reachable screen, seven UTC-day buckets and a fresh like's exact +1 pass. Posts=4 includes an authored reply; the label ambiguity is explicit. Full social scale is omitted |
| Messaging projection and API pagination | Exact 100,015 fixture message IDs, 1,002 conversations, 2,000 reactions and 2,736 quotes verified. SDK pagination contains no missing or duplicate fixture IDs |
| Complete acquisition after a later send | **Fails twice:** all 10,000 expected IDs were fetched, but 9,800 became inaccessible through offline pagination after close/reopen. Server data remained intact |
| 100,000-message account | **Fails:** all three final builder attempts and the independent attempt time out at the 180-second cutoff |

The independent assessor reran the documented 19-check selected browser suite
and three additional controls successfully, then ran its own probes. Those
green suites did not cover the delayed-send retention failure. A first-page
offline query continued to pass during that failure.

## Acquisition and storage

The [builder measurements](builder/measurement-summary.json) retain every
attempt. Acquisition-loop timing starts after the initial login/restoration
and first-use setup; the separate online wall includes that setup. The
independent timings below are `acquisitionEnd - acquisitionStart` from the
raw records, and exclude the later offline audit.

| Condition | Acquisition timing | Completeness / offline result |
| --- | ---: | --- |
| Builder final 10k, send at startup, three fresh stores | 32.649–33.646 s; online wall 33.573–34.571 s | All expected IDs and all offline pages pass |
| Independent 10k startup-send control | 33.797 s | All expected IDs and all offline pages pass |
| Independent 10k later-send controls, two fresh stores | 34.778 / 35.432 s | IDs fetched; only 200 of 10,000 reachable offline |
| Builder final 100k, three fresh stores | 180 s cutoff, observed command overrun up to 1.906 s | 42,500–42,900 IDs fetched; incomplete |
| Independent 100k | 180.843 s acquisition interval | 38,900 IDs fetched; incomplete, no full offline result |

The smaller final builder runs rendered useful inbox/history content within
roughly one second, transferred 27.84–27.88 MB in 166 requests, and reopened to
the first offline query in 765–816 ms. Those first-use results are separate
from full acquisition. The later-send controls submitted after substantial
acquisition, while remaining conversation resources were still being fetched.
They became locally durable in 19.6–131.8 ms and settled in 217.9–315 ms;
exactly one recipient copy was observed. Responsiveness passed while retention
failed. [Raw independent measurements](grader/grading/evidence/gacq-summary.txt)
and the [interpretation audit](coordinator-audit.md) retain the distinction.

Ordinary heap sampling includes driver-held arrays, IndexedDB inspection and
offline replay; its last sample is not steady-state retained heap. The
separate [CPU diagnostic](profile/README.md) uses unchanged source and one
instrumented no-send run. It acquired the exact 10,000 IDs in 23.666 seconds;
this different condition is not pooled with the ordinary repetitions. The
profile attributes SDK, React and other browser work, with 8.037 seconds of
summed persistence await intervals. These intervals include scheduling and
serialization, do not isolate disk cost, and overlap other measurements.
Sampling stopped before database inspection: peak 232.9 MiB, end 105.2 MiB,
and 48.8 MiB after explicit GC. The diagnostic documents source-mapping limits
and its retained first helper failure.

Warm page-one/page-50 measurements pass the selected p95 ratio: 137.4 ms /
237.8 ms = 0.578, against a 3× criterion. Each page has 20 real requests after
three warmups, 200 rows per request and no failures. The assessor audited
the raw record; it did not repeat the measurement.

Read-only storage inspection reproduces 113,262,592 logical database bytes,
of which 55,689,216 (49.17%) belong to the generic index family. The builder
recorded 113,209,344 database bytes plus 112,908,632 WAL bytes before shutdown;
the grader observed the checkpointed file. No explicit vacuum or compaction
was applied. Most of the 23,511,040-byte commit table is the static seed's
touched inventory. This projection has 18 public acquisition-send operation
receipts and no per-message delivery fanout table; it does not contain the
full social workload or 100,000 public message mutations. Its total cannot
be compared directly with Snapback2's full 5.2 GB app.

The installed browser entry is 164,808 raw bytes and the React adapter 867
bytes, excluding React peers. Complete exported app asset sizes are recorded separately
in [transfer sizes](builder/evidence/transfer-sizes.json). This is not the
same artifact or format as Snapback2's minified runtime ceiling.

## Builder experience and day-two phase

The single-client result is useful, but the app still contains an explicit
serial page walker, bounded waits for in-flight resources, a bounded unread
calculation over a last-200 summary, and a public storage timing adapter.
The adapter adds instrumentation, not another cache. The page walker and
unread logic remain application coordination. The outside builder's
[closing essay](builder/closing-essay.md) and [run log](builder/run-log.md)
preserve compiler friction, retries and
workarounds rather than reducing ergonomics to the number of client instances.

The fresh M7 Astra medium session received the same starter database with
real authenticated principals, populated reactions/receipts, an edited
message and a tombstone. The frozen baseline has DM6/group9 visible messages.
Full Alice/Bob/Carol snapshots and an original old-client pending operation
are retained. The builder added polls and a persisted message-count
backfill in 976 seconds. The [independent M7 assessment](m7-grader/grading/grader-report.json)
supports the nine selected M7 assertions and reran all 25 prior passing
regression IDs. The earlier unread/delivered-only UI qualifications still
apply; large acquisition was not rerun after M7 and its failures stand.

| Day-two work | Independently checked outcome |
| --- | --- |
| Same-database migration | Original database identity and all eight principals retained; public backfill replay commits DM6/group9 in two chunks. Physical census and all-persona enumeration cover both existing conversations |
| Preexisting data | All 42 persona-visible message records retain required fields, timestamps, populated replies/reactions, own fetched/viewed receipts, edit and tombstone controls. All 16 underlying preexisting message rows are unchanged |
| Persisted counts | Reachable settings show group9 → 10 after a poll → 11 after a text; stored values agree. A separate message retry does not increment twice |
| Polls and offline vote | Stable option IDs, set/change vote semantics, bounds and membership controls pass. The original offline Bob vote survives actual disconnection and page close/reopen; final A0/B2 has two stored votes |

The migration is explicitly limited to conversations with at most 200 visible
messages. No resumable backfill for a larger conversation was implemented or
executed. The builder first used two nonexistent persona names in its migration
driver; that failure is retained, and a corrected census establishes coverage
for this small database. Compiler corrections for optional arithmetic, ID types
and a bounded tally scan remain in the [builder evidence](m7-builder/COLLECTION.md).
The accepted tally implementation uses a maintained aggregate.

The independent assessment also reconnected the original pre-change client
profile against its own migrated database copy. The original queued message
identity survived but did not settle during the observation. Its helper read
the wrong operation-state field. A separate [coordinator control](m7-coordinator-controls/README.md)
on frozen profile/database copies confirms `parked` with `S3_OPERATION_CHANGED`,
retaining the same input and ID through 25.036 seconds online. The original
message remains absent from the server. Inspection exists, but the app has no
complete recovery presentation and the guide incorrectly promises dismissal
of a parked intent without a receipt. This is explicit parking, not automatic
old-client write compatibility. The [coordinator audit](coordinator-audit.md)
also rejects a false nonmember-read finding: preserving the resource's actual
status/error shows `denied` and `NOT_MEMBER` on all four refreshes.

## Custody and follow-up

The continuous builder ran from 15:01:45Z to 16:11:07Z on 2026-09-12, for
4,162 seconds under launcher custody. The independent Claude Opus 5 assessor
ran from 16:19:24Z to 16:42:06Z, for 1,362 seconds. Its substantive assistant
events identify Opus 5; a small terminal-only Haiku usage entry has no
established purpose, as the [model attestation](grader/provenance/model-attestation.json)
records. The profiling diagnostic was a separate Sol high task. All of these
are distinct from the fresh M7 builder and grader clocks.

The fresh M7 Astra medium builder ran from 16:55:41Z to 17:11:57Z (976 seconds).
Its independent Opus 5 assessor ran from 17:21:01Z to 17:40:46Z (1,185 seconds).
Use these launcher intervals; the report's self-entered end timestamp is not
the terminal process receipt. The [M7 model attestation](m7-grader/provenance/model-attestation.json)
records all 128 substantive assistant events as Opus 5 and another small
terminal-only Haiku usage entry of unknown purpose.

[Builder collection](COLLECTION.md), [grader collection](grader/COLLECTION.md),
[profile collection](profile/COLLECTION.md), [M7 builder collection](m7-builder/COLLECTION.md)
and [M7 grader collection](m7-grader/COLLECTION.md) bind source, package, prompts, attempt evidence and private
archive custody. Raw model streams, databases and browser session profiles
remain private. The static-asset snapshot exclusion mistake and its exact-byte
supplement are retained; no product repair was used to fix collection.

Concrete follow-ups are the
[history-retention issue](../../../snapback3/issues/20260912-acquired-history-lost-across-sequence-advance.md)
and [acquisition/storage issue](../../../snapback3/issues/20260912-browser-acquisition-cost-and-storage-amplification.md).
The [guide-gap issue](../../../snapback3/issues/20260912-guide-gap-paginated-resource-readiness.md)
records the paginated-readiness friction.
The [parked-operation issue](../../../snapback3/issues/20260912-guide-gap-parked-operation-recovery.md)
records the recovery and documentation mismatch.
Charlie identified acquisition as the main concern during this run. The
[speed plan in LLP 2000](../../../llp/2000-snapback3.rfc.md#16-making-acquisition-fast)
targets a complete 10k workflow under three seconds through SDK-owned bulk
acquisition, shared data/evidence, incremental processing and bounded
persistence/publication. It includes the retention repair and an explicit
measurement contract; it is not a result achieved by the measured package.
The unchanged package allowed the experiment to expose these failures. A
future repair needs the same declared data, authority and offline requirements.

Collection verification checked all eight public manifests, 121 coordinator
file links, ignored payloads, credential signatures and SQLite file signatures
with no problems. The M7 snapshot content audit and the coordinator-authored
change whitespace check pass. The full staged whitespace check flags retained
whitespace in raw builder/grader logs and exact source copies; those bytes are
preserved rather than silently normalized. The repository-wide reference check still reports the same 19 inherited
false references in ignored review JSONL. The optional Snapback 1 inventory
check still reports the preexisting `scripts/caps.test.mjs` registration and
missing local contract/client dependencies. No SDK/runtime code changed in this
evidence landing; those inherited checks are not reported green.

This selected run cannot establish full Clique milestone passes, native Apple
behavior, a weighted score, or an equal-scope win over Snapback2. The missing
media, presence, push and scheduling workflows remain outside this diagnostic.
