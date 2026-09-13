# Compact acquisition floor diagnostic

This bounded experiment shows that representation, normal gzip transfer,
decoding, grouped IndexedDB persistence, index construction and first direct
local queries do not themselves prevent Snapback 3's sub-three-second 10k acquisition
target. The lossless-row fresh-browser results were **1,231.2ms, 1,358.3ms and 1,413.6ms**
from immediately before page navigation through same-page IndexedDB connection
close/reopen and the first direct local history and exact-term search queries (median
**1,358.3ms**). The browser itself was not closed and reopened inside these timed
repetitions.

This is a lower-bound diagnostic, not product qualification or a candidate SDK
implementation. It follows the first experiment in
[LLP 2000 §16](../../../llp/2000-snapback3.rfc.md#16-making-acquisition-fast).
The detailed small result is in [results.json](results.json); private browser
profiles, copied databases, the compact payload and the full run record remain
on the EPYC host under
`/home/ccheever/snapback3-acquisition-20260912/floor/private-results`.

## Fixed input and preparation

The diagnostic used `snapback3@0.0.1-experimental.0` from source
`409954115f151a72dd95e897c5f00f36877f11e0`, archive SHA-256
`719eba5bfaffeebf117ca3e10d60d830da2ca4ca735693ea0e46f0d6317fcb4e`.
The installed package had the previously verified 108 payload files. The
fixture seed SHA-256 was
`e037a99d4cabdb496004c92939c602b2781187b4b0af6ac4e6a3f5c29371c3e2`.
All inputs were copied from the stopped profile lane before use; the source
lane, its database and its profile evidence were never mutated.

Input preparation launched the copied fixed fixture, signed in through the
existing development persona route as `u0500`, and traversed the existing
public SDK queries. It obtained 100 conversations and exactly 10,000 unique
messages in 151 pages (2 inbox pages and 149 message pages). The sorted ID-set
digest independently matched the retained exact-fixture oracle:
`ba91d208c55f77a1a4b792e2eb09407fe774a9814b1358981bbad7950ec984ac`.
This check prevents an arbitrary first-10k slice from standing in for the
authorized fixture.

Preparation was not separately instrumented as a claim interval. The complete
lossless controller ran for 10.626 seconds, including copied-fixture owner
startup, public-SDK authentication and traversal, owner shutdown, compact
construction, all three browser repetitions, audits and cleanup. That aggregate
is retained for custody and must not be reported as an acquisition or
preparation timing.

The primary compact payload contains all 100 conversation objects and 10,000
message objects returned by the public SDK, serialized without selecting,
adding, removing or normalizing row properties. The copied fixture schema has
exactly seven declared message fields plus implicit `id`: `conversationId`,
`senderId`, `text`, `serverTimestamp`, `replyTo`, `edited`, `tombstone`, and
`id`. SHA-256 `4577c483eae67e8a1a7a096ad37c022806a61ab8552cf2d43f9a3e32d8f04017`
binds that `schema.q`; the copied compiled project SHA-256 is
`a0f2972d79f536ca569c0203b3d044e52a59eb0f25fab74577d75b5b7b560063`.
The schema hash is the same file hash recorded in the retained profile's
`inputs.json`, so the copied fixture and profiled source agree.
All observed SDK rows had those exact eight keys. An earlier draft's statement
about an optional `type` field came from a later M7 schema and was a
documentation-assumption error, not a product or data omission in this fixture.

The lossless payload is 1,916,522 bytes as JSON and 93,198 bytes with Node's
normal gzip settings, a 4.86% ratio. Each measured browser requested one HTML
document and the compact payload. CDP recorded two completed requests and
100,401 encoded bytes per
repetition; the compact endpoint itself was requested exactly once per
repetition.

## Included timing boundary

The outer clock starts immediately before navigation. The measured page then:

1. fetches the gzip compact payload and lets Chromium decompress it;
2. decodes UTF-8 and parses JSON;
3. creates a raw-message store keyed by message ID, a conversation store, a
   compound conversation/time/history index, and a separate multi-entry
   exact-token search-document index;
4. saves unchanged message objects and derived regex search documents in ten
   1,000-row transactions, then saves the unchanged conversation objects and
   completion metadata in one transaction;
5. waits for every transaction to complete, closes the IndexedDB connection,
   reopens that connection in the same live page, and issues the first 40-row
   direct IndexedDB history query and first 20-row direct IndexedDB search
   query.

The persistence/index interval dominated at 1,176.2–1,357.4ms. Gzip fetch
through decoded body took 21.3–30.4ms, UTF-8 decode 1.0–1.1ms, JSON parse
6.9–8.0ms, database open 6.0–7.7ms, close/reopen 0.2–0.3ms, and the two first
direct local queries together 1.3–2.3ms. These inner intervals are components or brackets;
only the outer before-navigation interval is the stated end-to-end floor.

| Repetition | Before load through first index queries | Persistence/index interval | Pre-audit used JS heap | Full-row audit (excluded) | IDB durability hint |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 1,358.3ms | 1,293.4ms | 8,143,927 bytes | 161.6ms | `relaxed` |
| 2 | 1,231.2ms | 1,176.2ms | 6,994,715 bytes | 133.1ms | `relaxed` |
| 3 | 1,413.6ms | 1,357.4ms | 8,111,363 bytes | 148.0ms | `relaxed` |

Each repetition used a new persistent Chromium profile and therefore a new
IndexedDB database. Immediately after the primary endpoint, before validation,
`performance.memory.usedJSHeapSize` was 6,994,715–8,143,927 bytes. This is a
single browser heap sample, not a peak, retained-heap or whole-process measure.
The separately timed 133.1–161.6ms validation audit then read all 10,000 full
message rows and all 10,000 history-index keys. SHA-256
`86cc3d45609124219c7a74101015da00a96568e06d9b1341b418129fed5a38f2`
matched the canonical full public-SDK input rows after IndexedDB readback in
every repetition; all 100 conversation keys were present. This demonstrates
lossless full-row persistence and indexed access to the whole acquired set
rather than only the first displayed page.

## Preserved tuple cohorts

Two earlier successful cohorts used an explicit eight-field message tuple. The
tuple happened to cover every key observed in this exact fixture, but it was a
field-selecting representation and therefore did not prove that unknown future
properties survive. The lossless cohort above replaced that assumption with
direct object storage and a full-row digest. No earlier result was overwritten.

| Cohort | Before load through primary endpoint | Post-audit observation originally reported | Audit | Private run SHA-256 |
| --- | --- | --- | --- | --- |
| Tuple/object-store audit | 945.2, 816.3, 937.7ms | 1,024.2, 854.9, 994.9ms | all object-store keys | `07330b2d8b48f74f006d8c0168e672cfd12ac28592bb1b7484a73f71cad110d8` |
| Tuple/history-index audit | 887.2, 938.4, 808.3ms | 975.7, 1,020.6, 891.5ms | all object-store and history-index keys | `938b6eb90875b5a962f5066b3e94a55e860904e95efde4e36a77d113a1398f0a` |

The first numbers reported during execution (1,024.2, 854.9 and 994.9ms) were
the controller's before-load through post-audit observation bracket. The
primary timer embedded in that same raw record ends before its separately timed
audit at 945.2, 816.3 and 937.7ms. The second tuple cohort added a full
history-index key audit, which changed `floor.html` and its post-primary audit
cost. The final lossless cohort changed `run.mjs` to retain raw SDK objects and
`floor-lossless.html` to store raw messages unchanged while placing derived
regex tokens in a separate search-document store. [results.json](results.json)
binds every raw private path and script hash.

A separate control physically reopened the tuple/history-index cohort's
repetition 1 persistent Chromium profile after that measured context had closed. It loaded a small control
page while online, set Chromium's network emulation offline, asserted
`navigator.onLine === false`, then queried the persisted history/search indexes
and audited all 10,000 history-index keys. The queries and full index audit took
128.1ms and the exact ID digest matched. This control is outside the floor
timing. Because the small page had to load online after the browser reopened, it
does not qualify an offline-first shell reopen or the product's physical offline
reopen obligation.

## Deliberate omissions

The fixture-only compact endpoint has no general-purpose route and no runtime
authorization. Authentication and authorized public-SDK traversal occur only
during input preparation, outside the primary timing. This arrangement is not
a proposed production authentication bypass.

The timed repetitions leave browser networking online; their first queries call
IndexedDB directly and perform no fetch. The separate physical-reopen control is
the evidence that the same direct queries work after network emulation is set
offline. The timed path also omits authentication and the existing SDK's query
evidence, closure validation, sequence and authority fencing, revocation, live-query
publication, resource notifications, durable operation journal, receipt work,
failed-persistence recovery, resumable progress, interruption/cancellation,
foreground writes, server-side bulk construction, shaped-network behavior, and
UI rendering. It does not encode truthful per-query absence evidence for the
empty rooms. Its search index uses simple locale-lowercased Unicode word tokens
and exact-token lookup; it does not implement Quarry's full search contract.
IndexedDB requests use the `relaxed` durability hint, so transaction completion
is not an fsync or OS-crash durability claim. The full-row validation audit
occurs after the primary timer; the primary endpoint includes index readiness
and first queries, but not the full 10,000-key scan. The diagnostic covers one
fixed 10k unit; it does not establish owner bounds, 1k/100k scaling, first useful
content, peak memory, or production readiness.

Those omissions explain why the 1.36-second lossless-row median cannot be compared
directly with the retained ordinary acquisition (roughly 33–35 seconds) or the
instrumented 23.666-second no-send run. It does provide evidence for the SDK
design work: an integrated path has substantial room below three seconds if it
can approach this compact representation while restoring the omitted authority,
evidence, durability, interruption and foreground-work obligations.

## Scripts and custody

[extract.html](extract.html) prepares the exact authorized dataset through the
public SDK. [floor-lossless.html](floor-lossless.html) implements the primary
lossless-row compact browser path; [floor.html](floor.html) retains the earlier
tuple cohort path.
[run.mjs](run.mjs) owns the copied-fixture server, compact loopback endpoint and
one Chromium instance at a time, recording Linux PID/start-tick custody before
stopping only those owners. [reopen.html](reopen.html) and
[reopen-control.mjs](reopen-control.mjs) implement the separately timed physical
profile-reopen/offline-query control. [input-hashes.json](input-hashes.json)
binds the successful remote scripts and private evidence. [cleanup.json](cleanup.json)
records that ports 54920 and 54921 were free afterward, with no owned external
process left; local Commonroom on port 4383 was untouched.

Three preparation-only harness failures are retained privately. The first two
incorrectly required the SDK's page snapshot `complete` flag even though the
existing authored traversal accepts fresh paginated data; the third retained a
leftover final assertion of the same assumption. Each failed before compact
measurement, cleaned up its exact owned PIDs, and contributed no timing sample.
They are diagnostic-script failures, not product failures. The lossless
cohort's one allowed retry also preserves a post-measurement harness failure:
the first script asserted the tuple result field `messageKeys` after the
lossless page correctly returned `messageRows`. No samples from that attempt
were admitted; the retry changed only that assertion and completed all three
fresh repetitions.
