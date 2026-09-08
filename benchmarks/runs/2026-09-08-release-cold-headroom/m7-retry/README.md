# Clean M7 retry: author closeout

The fresh Sol/xhigh author completed M7 on published `snapback2@0.0.19`.
The coverage-validated M7 suite and frozen live/offline poll choreography pass;
all six required local regression suites pass. The completed
[independent M7 assessment](../assessment-m7/README.md) records nine passes,
with explicit method and preservation limits. This diagnostic does not qualify the earlier continuous run,
repair its M3 failure, establish native behavior, or produce a calibrated score.

The retry began from the original continuous source and fresh starter state.
It received no implementation or findings from the aborted first M7 attempt.
Private export caches, cleared exports and active endpoint checks isolated its
backend on 53134 and web on 53135. The source, logs and stopped database remain
preserved; the assessor uses a separate copy on 53132/53133 without reseeding.

## Evidence and clocks

The [original report](app/m7-report.md), [run record](app/m7-run-record.json),
[failure log](app/m7-run-log.md), [diary](app/m7-diary.md) and
[essay](app/m7-essay.md) retain the author's account unchanged. Read them with
the corrections below. [Custody](custody.json) binds the copied artifacts and
the privately retained source archive: 512 entries, archive SHA-256
`ff7ab819ec96aeab6763dc8215f958ad6fac654bb8ab268b26c8a67dfc563099`.

| Boundary | UTC | Elapsed from supervisor start |
| --- | --- | --- |
| Supervisor start | 15:58:56.399420 | 0 |
| First passing frozen segment | 17:14:25.430 | 4,529.03058s |
| Recorded author stop and receipt hashing | 17:14:39 | 4,542.60058s |
| CLI exit0 after closeout | 17:34:18.214665 | 5,721.815245s |

The cap remains 14,400 seconds. The 13.570-second difference between observed
green and recorded author stop is explicit; later administration is separate.
The final [suite](app/artifacts/suite-m7-1788887554.json) binds the backend
generation and coverage. The final
[choreography](evidence/m7-choreography-attempt-6.jsonl) retains all three
passing live-tally trials and the passing offline settlement trial. Their
timings are individual diagnostic observations, not comparative p95 scores.

## Migration and preservation

Existing raw count structures predated M7. This change added the stored
`conversations.visibleMessageCount`, backfilled three conversations to 6/1/9,
then narrowed the field to required. Existing `messages.kind` values remained
intact; a new optional logical discriminator supports polls. The refused
required-enum successor was not an applied destructive migration.

The [baseline](setup/pre-m7-snapshot.json) and canonical Node 24
[immediate post-migration capture](evidence/post-migration-snapshot.json)
match exactly after excluding capture metadata: 8 personas, 2 visible
conversations, 15 messages, 6 quoted messages and 81 receipt rows across views.
This does not cover the third stored conversation or populated media,
reaction, edited, tombstone or view-once classes, which were absent from the
baseline. Media-reference fields do not prove media-byte integrity.

Later acceptance traffic exceeded the DM query's visible window. The
[supervisor comparison](root-preservation-comparison.json) checks 36 of 48
baseline message copies and 63 of 81 baseline receipt rows; six original DM
messages are absent from both persona views. A separate
[read-only storage witness](six-dm-row-presence.json) finds all six named
rows and matches their original message fields. The original database hash
stayed unchanged, with no WAL/SHM before or after. Separate receipt/reaction
tables were not queried. This is not deletion evidence, but the late API
snapshot remains incomplete as a full preservation check.

## Root corrections and limits

- Early author commands used Node 26.7.0 because a nested login shell reset
  PATH. That snapshot is retained separately. The canonical Node 24.18.0
  snapshot completed before acceptance mutations, and critical checks were
  repeated. Do not call the whole authoring session uniformly Node 24.
- The digest failure came from a new preceding test advancing the shared
  clock, exposing an inherited whole-log assertion. The digest source was
  unchanged and the two rows represented distinct periods. Reordering the
  expiry test addressed the test interaction; no digest runtime defect was
  established by that failure.
- The author's hydration/store-lock explanation is unproven. The probes used
  separate browser contexts and established sign-in form visibility, not
  completed sign-ins. Installed 0.0.19 derives its Web Lock name from the
  partition, independently of the database prefix. The timeout recurred after
  the prefix change. Final choreography passes, but that does not establish
  the proposed cause or a general startup fix.
- A per-tab namespace does not automatically reopen another tab's cached
  rows/outbox. Passing offline vote settlement does not establish tab-close
  recovery, shared-cache takeover or native process-kill behavior.
- Scheduled expiry decrements are tested. The root source audit alone does
  not establish exact expiry-time freshness of the stored count.

All failed setup and choreography attempts remain recorded, including the
missing run ID, malformed command, startup timeouts, missing poll DOM fields
and non-clearing pending marker. The corrected pending marker uses queued
mutation intents; settled durable ledger entries can remain until dismissal.
The independent assessor received source and deterministic evidence without
these root conclusions or the author's narratives.
