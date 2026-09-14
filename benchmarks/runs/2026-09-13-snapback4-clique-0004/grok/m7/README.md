# Grok M7 evidence

**Status: received builder-reported green with a material snapshot-custody
qualification; no post-M7 independent grade.** The foreground `grok-4.6`
`xhigh` process exited 0 at `2026-09-14T08:53:40Z`. The runner recorded
1,658.219 seconds of wall time. The builder's report records
`start=1789374381`, `end=1789375914`, and `wall_s=1533`; the two wall values
differ by 125.219 seconds and are preserved without reconciliation. Package
pins were `snapback4@0.2.6` and `snapback4-expo@0.2.1`.

**Snapshot-custody qualification.** The frozen brief requires the baseline
snapshot before the M7 session starts, while the rendered prompt directs the
fresh agent to seed and export it before making changes. The runner started at
`2026-09-14T08:26:02Z`; the manifest records export at
`2026-09-14T08:36:59.347Z`, about 657 seconds later. The run log records the
first schema change at `08:38:00Z`, after the snapshot. The builder followed
the prompt, but the orchestration did not satisfy the brief's pre-session
custody requirement. `m7-a08` is grader-owned, and no independent post-M7
grade was run. Its zero-mismatch comparison remains builder-produced and
independently ungraded.

The final M7 suite passes all six suite-owned assertions, and the choreography
receipt passes both required assertions: three retained live-poll attempts and
one offline-vote reconciliation. The aggregate snapshot comparison reports no
mismatches across eight personas. The pre-snapshot manifest and comparison are
copied; persona bodies remain external and hash-bound. The builder reports a
setup-only first choreography refusal under the wrong Node version, followed
by the green run with the pinned Node binary. It reports no Snapback defect in
this phase and no native export.

Two passive captures preserve intermediate custody. All five first M7 receipt
files are byte-identical to the final receipts. In the earlier postmigration
capture, the run log is a strict prefix of the final log and the snapshot
comparison has the same result with an earlier `comparedAt`; the schema,
manifest, and all eight persona snapshot bytes match final. See
[`capture-comparison.json`](./capture-comparison.json).

M7's regression command used the canonical M1-M6 and M8 receipt paths. The 14
per-milestone suite and coverage files retained here are byte-identical to the
continuous source inventory, while `suite-status.json` changed to add M7.
They are labeled M7-era custody because the builder reports rerunning those
suites; they do not replace the immutable continuous archive.

[`source-m7-delta.json`](./source-m7-delta.json) identifies seven changed and
four added source/config files against the continuous source inventory. Those
11 final files are copied verbatim under [`source-m7/`](./source-m7/). The
comparison covers source-snapshot-eligible files and is not a Git diff; it
found no deletion among the 228 baseline-selected files. No continuous or
grading source bytes were copied into this namespace.

[`COPIED_FILES.json`](./COPIED_FILES.json) inventories 45 verbatim
copies totaling 267,368 bytes. Each destination was
created exclusively and verified against its source by byte length and
SHA-256. [`external-artifacts.json`](./external-artifacts.json) retains
hash-only references for raw CLI/runtime logs, process state, runtime SQLite
files, persona bodies, and immutable baseline custody files. Credential file
names are recorded without reading or hashing their contents. Raw CLI, private
reasoning, process listings, tokens, dependencies, native/build output,
grading, scores, prompts, and instrument files are excluded. No public-command
or source-access audit was performed during this curation.

The [static outcome audit](../../grok-m7-outcome-audit.md) verifies exact suite/choreography linkage and records the narrower snapshot evidence: no retained post-persona payloads, no asset-byte checks, and no explicit message type field in the export. M1/M2 are the previously green milestone subset; the additional reported suite reruns do not change inherited milestone failures.

The [source audit](../../grok-m7-source-delta-audit.md) finds two material app defects despite passing receipts: the conversation-wide 200-vote query can hide later polls, and native users cannot open the composer. It confirms the real backfill and vote semantics, but records incomplete new test mappings and inherited weak regressions. The received green is qualified by these findings.
