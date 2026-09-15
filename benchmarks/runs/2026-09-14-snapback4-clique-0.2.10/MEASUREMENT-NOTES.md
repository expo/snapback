# Measurement notes and deviations

This accompanies the 0.2.10 Clique record. It preserves received numbers and
qualifies their interpretation; it does not rescore a lane or rule for the author.
The [audits](audits/) supply the detailed assertion, source and provenance checks.

## Holistic scores as received

| Category | 0.2.6 Astra | 0.2.6 Grok | 0.2.6 Muse | 0.2.9 Astra | 0.2.10 Astra | 0.2.10 Grok | 0.2.10 Muse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| overall | 84 | 70 | 80 | 85 | 82 | 63 | 82 |
| setup_and_docs | 87 | 80 | 80 | 78 | 79 | 71 | 90 |
| data_modeling | 82 | 83 | 78 | 88 | 84 | 85 | 90 |
| authorization | 94 | 63 | 85 | 91 | 87 | 63 | 95 |
| queries_and_live | 73 | 61 | 78 | 74 | 77 | 57 | 78 |
| writes_and_transactions | 92 | 71 | 85 | 94 | 86 | 77 | 72 |
| offline_sync | 84 | 68 | 80 | 82 | 80 | 37 | 70 |
| media_assets | 85 | 85 | 72 | 96 | 93 | 79 | 85 |
| background_work | 93 | 79 | 85 | 93 | 78 | 81 | 88 |
| client_integration | 80 | 55 | 82 | 90 | 84 | 48 | 80 |
| diagnostics_dev_loop | 91 | 72 | 82 | 88 | 75 | 79 | 70 |
| scale_and_limits | 69 | 43 | 60 | 82 | 76 | 83 | 55 |
| operations | 86 | 65 | 70 | 87 | 83 | 69 | 75 |

All current score phases exited 0. Walls were Astra 140.434 s, Grok 407.165 s
and Muse 75.485 s. Astra's final equals its public stdout apart from a newline;
Grok has one final JSON fence after public progress prose; Muse's unique linked
terminal was captured verbatim with a provenance receipt. The unchanged
aggregator ran after those checks. Its generated mean remains part of the
received summary, not a pooled causal estimate across three different families.

Grok's public preface announced source/receipt spot checks beyond the
narrative-only scoring instruction. The plain output does not prove which
requests actually ran. This qualifies the generated summary's statement that
each scorer used only narrative evidence. Accepted missing-target upsert
prediction, unreproduced like-list claims and blanket navigation-loss claims
remain in the received opinions alongside the separate controls and dispositions.
No score was adjusted by the orchestrator.

## Independent grades as received

Tuple order is pass / fail / not-run / not-applicable.

| Pin / model | Main report, 101 IDs | M8 sidecar, 18 IDs | O1 | O2 | O3 | O4 | O5 |
| --- | --- | --- | ---: | ---: | --- | --- | --- |
| 0.2.6 Astra | 84 / 8 / 9 / 0 | 16 / 2 / 0 / 0 | 74 | 76 | null | 35 | band 30 |
| 0.2.6 Grok | 60 / 17 / 24 / 0 | 10 / 1 / 7 / 0 | 10 | 25 | null | null | null |
| 0.2.6 Muse | 79 / 13 / 8 / 1 | 15 / 3 / 0 / 0 | 30 | 40 | null | null | band 0 |
| 0.2.9 Astra | 85 / 7 / 9 / 0 | 16 / 2 / 0 / 0 | 72 | 78 | null | 10 | band 75 |
| 0.2.10 Astra | 83 / 2 / 16 / 0 | 16 / 0 / 2 / 0 | 75 | 72 | 85 provisional | 25 | band 30 |
| 0.2.10 Grok | 68 / 17 / 16 / 0 | 3 / 13 / 2 / 0 | 18 | 20 | null | null | null |
| 0.2.10 Muse | 84 / 1 / 16 / 0 | 14 / 2 / 2 / 0 | 58 | 45 | null | 25 | null |

Current grade walls are 2,596.349 / 2,184.473 / 2,591.524 s, all actual exit 0.
All three have the exact 101+18 partition, schema/identity/manifest validation,
trace and DONE. No continuation was needed. This validation establishes output
shape and named completion records, not semantic correctness or calibration.

All three graders declare themselves uncalibrated and lack a committed rotated
holdout set. Astra nevertheless supplied provisional O3 85 using its own probes,
contrary to the frozen holdout method. Preserve that value as a method deviation;
it cannot be compared numerically with earlier nulls. Grok attempted a full replay
but supplied O5 null, contrary to the attempted-replay rule, because required
checkpoints/probe curves were missing. No replacement band is invented. Muse's
current null accompanies no full replay, only the sample-50 conformance exercise.

O4 does not have a uniform native-proof basis across these reports. Some
explanations use web choreography, others emphasize missing simulator artifacts.
Muse's current trace says web evidence is excluded from O4, then cites that
evidence in its O4 explanation. Preserve 25 and the inconsistency. No current
builder or grade supplies native simulator execution proof. Grok's grade also
identifies byte-identical copies of an earlier Hermes bundle under later
milestone names; those are not separate platform executions.

Nine native IDs change from fail to not-run in both Astra and Muse comparisons.
Grok already used not-run for those IDs. Muse's m7-a09 changes from not-applicable
to not-run. These are classification changes, not measured product gains.
The three detailed grade audits enumerate other changed IDs and actual probes.

The frozen report schema admits M1–M7 only, which is why M8 lives in a sidecar.
September 5/12 reports lacked that structured M8 partition. The 0.2.6 anchor and
0.2.9 calibration used here already have it; current claims of a first 119-ID
grade or no structured predecessor are therefore qualified. Original reports
and traces remain unchanged. The 0.2.9 grade resumed its same session after an
exit 0 without result files; its archive lacks the continuation end, DONE and
underlying raw-stream custody. Its received totals exist, but total grade wall
is unknown.

## Execution and source-access deviations

- **Ports and preparation:** anchor ports were 49300–49319, calibration ports
  49320–49339, current ports 49340–49359. The current occupancy check tests
  listening sockets, because unrelated outbound connections can occupy local
  ephemeral ports. Render/verify changes are ports; the runner also has that
  occupancy change. Instrument and template identity are checked separately.
  Historical prepared/pending text, old lane labels and anchor model-probe paths
  are preserved as provenance with execution updates.
- **Shared host and dependencies:** host activity overlapped the cell and the
  ceremony run. Grader traces report substantial load, including Muse's 14–83
  range. Graders used copied checkouts and APFS-cloned dependencies, with separate
  harness installs and shortened timing configurations. Timing retries and
  grader-induced fixture interference remain in their traces; neither a timeout
  nor a best-of-three pass alone establishes an engine cause or stable latency.
- **Grok signing:** the installed platform binary changed from published SHA
  `af4e26be10419df9428bf6be0c7513de07d227e33f77cdb464c4d93dc2a0767d`
  (7,728,288 B) to `929be28d4907839a25b88d9ec456b2a1a18c44921e8e223f86e6982c64cb8ed2`
  (7,701,616 B) after development re-signing and Python/Popen launch workarounds.
  Fourteen file-backed section hashes and three zero-fill sections match, as
  does the 7,666,016-byte payload between load commands and signature. Signature
  and load-command changes remain a deviation. This does not prove signing
  caused the observed dyld stalls or recovery. No private-key export request was
  observed in the bounded public-argument audit.
- **Docs-only discovery:** the current Astra audit inspected 307 public command
  starts without finding an explicit prohibited implementation, declaration,
  sibling or prior-run read request; its own SQLite schema/sample inspection is
  separately recorded. Grok's 731 public calls include two implementation and
  eleven declaration requests. Muse has 44 implementation read/search requests
  and twelve declaration events; targets are unavailable for 299 native
  file/search tasks and two skill reads, and two subagents' internal access
  remains unresolved. Requests do not prove delivery or complete indirect access.
  The anchor audit likewise found five implementation calls for Grok and 23 for
  Muse (21 successful), with none observed in 393 inspected Astra starts. These
  bounded audits do not convert the cells into fully compliant docs-only runs.
- **Copied choreography:** Astra supplied the missing adjacent schema helper
  through a Node loader using pinned AJV2020, retaining the harness source.
  Its M8 invocation uses the supported `/chats` base URL adaptation; earlier
  segments use the app root. Grok adapted two imports to a copied 7,733-byte
  support helper identical to the frozen benchmark helper. Muse adapted two
  imports to a custom 721-byte, 18-line AJV helper. All 340 retained Muse receipt
  rows and setup independently validate with the unchanged original validator;
  format validity does not establish behavior. All 35 copied UI files and 67
  metering files match after Muse's builder; all 35 UI files also match after
  the Astra/Grok builders. Final
  Muse client/platform files match the unmodified published control (35+3 files);
  Expo 0.2.3 is metadata evidence only. Graders also used their described harness
  copies/helpers rather than silently modifying the frozen instrument.
- **Incomplete builders:** Grok stopped with only M1/M2 execution-green before
  any four-hour milestone cap. Its own wall fields disagree; use the runner's
  11,928.612 s. Anchor Grok likewise stopped short of complete capability, so
  elapsed-time comparisons are not like-for-like successful builds. Astra's
  own 7,999 s differs from its runner's 8,018.002 s.
- **Muse completion tail:** after its report and three complete public answers,
  including responses to idle-server callbacks, exact CLI PID 65229 received
  SIGINT. Actual exit 130 and 20,039.027 s remain. The report ends 668 s before
  runner end, uses wrong calendar dates, and assigns an M8 receipt-derived epoch
  80 minutes later than the cited receipt. Its claimed M3 golden time is not a
  retained green receipt. Anchor Muse also has an interrupted empty-turn tail;
  neither actual exit is rewritten to 0.
- **Serial driver takeover:** the original shell was paused while Astra scoring
  continued, then stopped after that scorer ended. Remaining phases are driven
  serially by the orchestrator. The qualified external Muse helper changes only
  its exact hash-bound interrupted-builder completion predicate in memory; the
  on-disk runner, other completion gates, prompts, models, ports and lifecycle
  code remain unchanged. Seven retained guard checks qualify that exception.
  The original `cell.log` consequently has no fabricated cell-done line.
- **Muse live diagnostic configuration:** public command metadata records
  `sysconfig` TTL requests of 60/120 s followed by 86400/604800 s, both with
  completed/exit-0 outer commands. The final report claims restoration, and
  the later exact-row observation has a 24-hour lifetime. These live-store
  writes are distinct from unchanged frozen files and from the grader's later
  fresh-checkout 180/300 s shortened profile. Command metadata alone does not
  establish every downstream HTTP outcome.

## Behavior and evidence qualifications

The avatar assertion/brief require a node that the frozen kit contract and
choreography make conditional. The narrow issue preserves that conflict without
changing received failures. Muse's final builder M5 pass is contradicted by its
unexpired exact row, while its later independent shortened-profile expiry probes
pass. The app-level navigation observations remain alongside reduced controls
that awaited durable admission; no general post-admission loss is established.

Muse's digest pass accepts own-post inclusion in `newPostsInFollowing` as the
grader's reading of the Following feed, not an author-settled rule. Its fresh
probe covers tombstones, read state, membership, quiet periods and restart, but
does not contain a dedicated expired-message digest countercase. Separate
expiry passes do not supply that missing combination. The completed Muse grade
audit retains these interpretation and coverage limits.

Astra's replay keeps the first failed verifier attempt and cumulative clock:
1,149.236 s gross, 208.378 s excluded, 940.858 s recorded. Its HTTP global-search
curve remains incomplete. The 2.918167 ms full-replica Node result is one corpus
diagnostic, not a successful browser three-size curve. Grok's 453 s older-schema
builder replay and 1,229 s final-source grader replay are separate evidence; only
the latter has the retained full final-manifest comparison. Neither supplies the
missing checkpoint/probe curve. Muse has no full replay. Do not add the 86 starter
actions twice: 167,157 scale + 86 starter = 167,243 total.

Astra's 35 timestamped correction events are not 35 normalized loops. Grok's
fourteen final-report rows differ from its twelve numbered chronological entries.
Muse's three final diagnoses omit earlier correction history. The 0.2.9 Astra
structured ledger has 21 protocol loops, despite its README saying 20. Source
burden and grader-discovered bugs do not supply a replacement loop ledger.

## M7 and final custody

Astra's M7 actual lifecycle is 00:52:06–01:39:57 UTC on September 15,
2,870.258 s, exit 0, against its own report's 2,824 s. The report groups twelve
correction episodes (10 agent / 1 environment / 1 backend defect). It retains
failed adoption/setup receipts and a PID-ledger-induced M8 regression failure,
then reruns the complete suite. The final cosmetic poll-label edit has a later
passing two-check choreography, typecheck and iOS export; the native evidence
remains a Hermes build only. Its final 35 client and 3 platform control hashes
match the unmodified published pin; Expo is metadata only. Sixteen selected
named PIDs and assigned listeners are absent at the late observation, not
certified at the exact phase-end instant.

Astra's original snapshot manifest is timestamped 00:53:48.774 and first
observed 00:53:50.306, after the session starts but before the first observed
app-schema edit at 00:55:09.080. All 36 named snapshot files match their retained
observer versions. The original pair contains 15 distinct messages / 39 viewer
projections across two conversations; five of the eight personas are empty.
Its actual post inputs preserve all exported message fields and add counts 6/9.
The correction pair is separate: 44 distinct messages / 117 projections, with
all eight persona files byte-identical across that adoption. Ten of the original
39 receipt projections had legitimately advanced before the later baseline.
It must not replace the original starter snapshot.

The 17-field exporter omits inherited API fields `sender` and `quote`, maps
missing values to null, and omits completeness flags. Original message media,
reactions and expiry fields are empty/null; the correction pair adds delivered/
read receipts, edits, tombstones and one distinct regular-photo byte hash.
Once-photo references are retained without byte fetching; its sole video message
is deleted, leaving no populated live-video reference. Reactions and expiry
fields remain empty/null in both pairs. The separate 18 avatar/post media checks
are post-migration-to-fixture comparisons. The snapshot audit recomputed retained
hashes and content comparisons; it did not supply missing runtime/field coverage
or a post-M7 grade.

The original backfill records 15 writes. A later corrective backfill records
64 writes, including repeated writes for option-key repair, not 64 distinct
message rows. Physical `messages.countWeight` plus a persisted sum supplies the
projected `conversation.messageCount`; a physical conversation counter column
was not added. Whether that mechanism satisfies the brief's exact wording is
not silently ruled by the recording orchestrator.

The final full suite is timestamped 01:32:04.102; first choreography ends
01:32:59.498. A one-expression poll-label edit is observed at 01:33:58.712,
and final choreography ends 01:34:02.902, bound to the earlier full-suite hash.
The complete regression suite was not repeated after that cosmetic edit.
No later app/schema/assertion edits were observed. All thirteen root/instance
Quarry files match. Six standalone prior assertion modules hash-match the
baseline; removing exactly the two M7 dispatch lines from the changed M1 file
reconstructs its original hash. The equal initial/final regression-summary
hash omits timestamps; separate final per-suite receipts establish the rerun.

Astra's M7 public-command audit covers 84 command starts in a 588,503-byte,
203-line stream. It finds two installed declaration content searches and one
declaration filename listing, distinct from implementation content. No explicit
implementation/source-checkout or prohibited inherited diary/essay read was
observed; helper internals, dynamically resolved paths and unlogged activity
remain outside the method. The end-state package control and selected frozen
copies do not prove continuous absence of transient edits.

Grok's M7 ran 01:41:40–02:09:28 UTC, 1,667.198 s, exit 0, against the
report's 1,615 s. Received green follows three agent corrections and one
Node-version correction. The run log's opening local clock has an erroneous
`Z` suffix; epoch and runner times control. Both required choreography checks
pass after an initial offline-vote click failure. Prior M1/M2 suites were rerun;
other prior suite-pass/choreography-fail milestones retain that distinction.

Its original pre export completes at 01:50:24.763, first observed at
01:50:26.207; the first observed app-schema edit follows at 01:53:37.598.
All 18 original/actual-post snapshot files match retained objects. The complete
payloads differ only in export timestamps: eight personas, 39 message projections
of 15 distinct messages and 66 receipt projections of 24 distinct receipt rows.
Five personas are empty. Media/edit fields are null, reactions empty, all receipt
flags false; reply IDs are populated. The 14-field exporter omits expiry and
broader returned author/quote objects. The comparer omits poster, media metadata
and some identity/multiplicity checks. A separate retained-object comparison
establishes the stronger exported-payload equality, without filling those
missing field/state witnesses. Neither export contains `messageCount`.

The stored `conversationMessageCounts` maintain groups by conversation and
`deleted`, projecting the false-group value through `conversation()`. There is
no physical conversation counter or explicit count-backfill job; expiry relies
on physical removal. The snapshots use `inbox`, which omits that projection.
The backend was started with `dev --fresh` and is in-memory. Its received 13 ms
Additive adoption and starter counts are narrative evidence; the suite separately
checks a bounded first-page count and a +1 send. Disk-persistent migration,
pagination, tombstone/expiry transitions and all-persona count behavior are not
thereby qualified.
Final control hashes retain Grok's known platform re-signing exception, while
all 35 client files and the other platform files match the published control.
The initial late-process helper selected only four PIDs; a separate explicit
report-list check found all eleven named PIDs absent at 02:29:24.523. Muse was
already running then, so that latter observation makes no shared-port vacancy
claim. Two further explicit cleanup PIDs, omitted from the report, are absent at
02:31:55.738, giving thirteen named IDs across the observations.

The M7 suite's six passing cases are timestamped 02:00:52.690, SHA
`0e0c8797ebf6bcc1f6d5345934a348b1e72a0c5ef5327ef6c7c4be511a5d402c`.
Both first failed and final green choreography bind it. The final PollMessage
UI fix is observed at 02:04:12.738; final choreography passes at 02:06:28.804,
without rerunning the suite after the fix. No later app edits are observed.
Reversing only the documented M7 additions reconstructs exact old acceptance
and replay-core hashes; prior assertion bodies are unchanged. M1/M2 reran as
nested children of M7; the report's “nested plus direct” claim has no additional
established direct rerun. The separate direct loop runs only M3/M4/M5/M6/M8.
The missing DM route became a directory index with import adjustments and a
settings link, plus a new settings route; it is not an unexplained deletion.

The run log stayed at 236 bytes until 02:08:12, then expanded near the end.
Most entries are retrospective and incompletely timestamped, contrary to the
contemporaneous logging instruction. The 204 public-request audit finds seven
explicit packaged implementation accesses, two broad package searches and one
declaration read. No explicit prohibited inherited diary/essay or sibling read
was identified, within the bounded method. No new signing or installed-SDK edit
request was identified. The final native artifact is a 3,154,470-byte Hermes
export, not a simulator execution.

Grok's claim that jobs cannot scan expiring messages is overbroad: the published
chunk-job form and Astra's actual 0.2.10 message backfill provide counterevidence.
Ordinary mutation scans and unsupported loop/index forms remain distinct. The
received claim is retained and qualified; it is not a new product gap or SQL
necessity argument.

Muse's M7 actual lifecycle is 02:28:59–02:43:55 UTC, 895.247 s, exit 0;
its report claims 846 s. All four required narratives exist. The received
six-case suite and both choreography predicates are green, with all seven
prior suites rerun and exact receipt/source linkage in the final audit.
Five grouped corrections are two agent, two environment and one
ambiguous selector/setup episode. No new Snapback-defect label appears.
Final observation hashes 155 selected paths, with six original paths changed
and none missing. All 35 client and three platform files match the published
control; Expo remains metadata only. Four selected PIDs and assigned listeners
are absent at the late observation.

The preliminary fixed cut retains 186 events through 02:43:36.596, SHA
`424c3a88e3a07aaac0c73b6d30acd551b591af6fedad5d7dc2cd111320d4a707`.
The original pre manifest is timestamped 02:36:34.242, observed 02:36:34.645;
first app edits are observed 02:37:11.011, about 36 seconds later. The observer
initially covers 129 of the original 130 paths, omitting `ui-kit/src/tokens.ts`
under its filename filter; the separate immediate pre-launch check covers all
130. These scopes are not conflated.

All 27 manifest/persona references across the original and two post sets
match captured object hashes. Original messages are 15 distinct IDs / 39
projections; five personas have no conversations. Eight avatar assets have
successful hashes. Original reactions, message media, edits, tombstones,
expiry and nonzero receipt marks are absent. The first post adds a tombstoned
poll; the second adds a live poll, giving 16/17 distinct messages and 42/45
projections. Original message identities remain, but history total changes
9→10→11 and later delivered marks advance. Original profiles, memberships,
avatar hashes and inbox rows remain equal. This is preservation with permitted
growth/progress, not whole-snapshot byte equality.

The exporter reads full inherited history rows and conversation-level reactions
and aggregate receipts, with finite page bounds and no separate truncation
declaration. The comparer omits expiry, history totals, first-page threadCount,
the new count query and several profile/view/membership/aggregate fields. It
does not validate manifest hashes; the audit does that separately. Its
per-principal receipt wording exceeds its aggregate-only check. No machine-
readable comparison result appears in the fixed cut; final invocation/result
custody is addressed by the final audit.

The inherited `messageCounts` maintain and history total include tombstones.
M7 leaves that structure unchanged and adds only the `convoMessageCount`
read-time query, capped at 5,000, plus its settings subscription. Physical
schema changes concern polls. There is no new stored count, contribution
column or count backfill; neither snapshot invokes the new query. The small
starter-state checks do not establish exact counts for every larger conversation.

Muse's six-case receipt is timestamped 02:41:00.989, SHA
`aa37e4a88964ab72d351fb43c3b1576f772d16d206fa6ca995e9d8fbf3afc289`;
the sole completed choreography is green at 02:42:19.392, SHA
`f79dcf66f3a1ee866a3cd94527803bb48198846767c3a84096e836f5e70d28b4`,
and binds that exact suite. Source precedes suite/choreography; no later app,
schema or assertion edits were observed. The acceptance diff is one inserted
M7 block, with all seven original suite bodies unchanged. M3's inherited
mapping problem and M8's missing digest assertions remain. The count tests
exercise starter/API totals, tombstone exclusion, polls and increments, but
neither live expiry nor rendered settings. The report's “No prior failures
existed” cannot erase earlier failed sweeps or the independent 98/3/18 grade.

Run-log suite/choreography epochs extend to 02:45:00/02:46:40, after actual
02:43:55 phase end, then jump backward for cleanup. Runtime stream timestamps
also do not independently establish wall chronology. Receipt/observer times
and line order are retained. Export/compare requests end in `tail` pipelines;
whole-shell exit zero is not independently the comparator exit. INTACT remains
a received claim alongside actual preserved inputs and bounded static checks.

Public commands move prior SQLite/WAL/SHM files to a backup and start `dev`
without `--fresh`; later metadata shows both current and backup files. This
supports a separate persistent instance and retained backup, without a database
content/hash check, reopening, or restart-durability proof. API.md also changed
outside the selected 155-path source inventory and is separately copied with
an explicit literal redaction. Six changed original selected paths is not a
full-tree change count.

The public audit covers 67 parseable command chunks and identifies three
installed-declaration requests; 31 native read, nine write, 19 edit and two
skill tasks lack path/argument coverage. No explicit implementation read is
identified in those commands, without a broader clean-source claim. A shared
temporary backend-log read is explicit; other-lane origin is received attribution.
Credential-printing requests are represented only by metadata/hashes, with
values and raw streams excluded. The inherited 721-byte Ajv helper remains an
adaptation. Final native evidence is a 2,761,462-byte Hermes export. Explicit
cleanup targets web/backend; the supervised worker is separately found absent
in the 02:49:56.284 four-PID/listener observation.

The essay's blanket stored-counter/expiry impossibility claim is qualified by
published maintain/sweep behavior and the separate Astra/Grok implementations.
Expiry removes maintained contributions at sweep, while ordinary reads hide
expired rows immediately; sweep delay prevents a zero-delay equivalence claim.
Those distinctions are not a new product issue, SQL necessity proof or author
decision. Final numeric/file/reference checks and scan dispositions are linked
from the README; their scope is record integrity, not new application grading.

The brief/prompt snapshot-timing mismatch and absence of an independent
post-M7 grade apply to all three sessions. The passive observer is a bounded
two-second archive observation, not a semantic verifier or complete write history.
Its repeated file hashing and selected JSON copying add unmeasured host work;
M7 clocks are not isolated from that observer or other host activity. It does
not change app/packet files or export the required custom-client snapshots.

The archive is selective. Original external source/custody inventories include
files not copied locally; local copy manifests and the final cumulative index
state what is actually here. Some source is explicitly redacted or hash-only.
Raw model streams, credentials, stores and most generated artifacts remain
external. Astra's selected Quarry contains eleven generated configuration lines;
Muse's generated residency facts are a named selected exception. The archive is
not a runnable clone. See [ARCHIVE-MAP.md](ARCHIVE-MAP.md).
