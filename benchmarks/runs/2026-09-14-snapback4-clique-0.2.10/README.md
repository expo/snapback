# Clique on Snapback 4 0.2.10 — three-model cell

This is LLP 3000.007 §10.3's full Clique rerun. The received holistic scores are
**Astra 82, Grok 63, Muse 82**, against **84 / 70 / 80** on 0.2.6. Astra's separate
0.2.9 calibration scored 85. These are one run per model and pin, with different
completion and observation coverage. They do not establish the magnitude or
cause of a product change.

The [three-pin ceremony record](../2026-09-14-snapback4-ceremonybar-third/README.md)
is separate: all three 0.2.10 runs retained the natural membership rule, passed
the five probes and incurred zero Snapback-attributed loops. The full apps below
still needed reporting-model and integration corrections.

## Packet and method

The packet is `/Users/ccheever/clique-sb4-20260913-relaxed-3models`, with instrument
commit `409954115f151a72dd95e897c5f00f36877f11e0` (177 files, 16,243,769 bytes).
Its published pins are `snapback4@0.2.10`, platform package 0.2.10, and
`snapback4-expo@0.2.3`. This pin contains W–W4 and membership lane S; it predates
W5 and the separate CU and §19 landings. Later fixes receive no credit here.

The sequence is all three continuous builders, all three holistic scores, all
three independent grades, then fresh M7 sessions. Builders use Astra
`gpt-6-astra` medium, Grok `grok-4.6` xhigh and Muse `muse-spark-1.3` xhigh.
Each family's scorer runs at xhigh; independent grades use fresh
`claude-opus-5` sessions. Builder claims, scorer opinions, independent grades and
orchestrator audits remain separate. The frozen sequence has no independent
post-M7 grade.

The host was shared and loaded. Ports are 49340–49359; the occupancy check counts
listening sockets. The cell overlapped the latter part of ceremony run 1 and
all of runs 2 and 3. The [archive map](ARCHIVE-MAP.md) explains selected local
copies, broader external custody inventories, redactions and omitted files.

## Received results

Builder walls come from actual runner lifecycle records, including shutdown
tails. Grade tuples are **pass / fail / not-run / not-applicable**, over all 119
frozen IDs. The [101+18 partition](grades/summary.md) is retained separately.

| Pin / model | Builder wall s | Actual exit | Holistic | Independent grade, 119 |
| --- | ---: | ---: | ---: | --- |
| 0.2.6 Astra | 9,614.013 | 0 | 84 | 100 / 10 / 9 / 0 |
| 0.2.6 Grok | 12,499.350 | 0 | 70 | 70 / 18 / 31 / 0 |
| 0.2.6 Muse | 17,657.686 | 130 | 80 | 94 / 16 / 8 / 1 |
| 0.2.9 Astra | 6,889.565 | 0 | 85 | 101 / 9 / 9 / 0 |
| 0.2.10 Astra | 8,018.002 | 0 | 82 | 99 / 2 / 18 / 0 |
| 0.2.10 Grok | 11,928.612 | 0 | 63 | 71 / 30 / 18 / 0 |
| 0.2.10 Muse | 20,039.027 | 130 | 82 | 98 / 3 / 18 / 0 |

**Astra:** seven continuous builder milestones are green. The grader's two
failures concern DM avatars and settings followed by navigation. Nine native
proofs are now classified not-run, whereas the earlier Astra grades called
them fail; that classification change explains most of the apparent failure
reduction. The avatar assertion conflicts with the frozen kit's conditional
contract. Its final scale replay settled 167,157 actions plus 86 starter actions;
the retained first failed verifier and its correction remain in the clock.
The recorded replay is 940.858 s after excluding checkpoint work. The HTTP
search curve is incomplete; a separate full-replica Node diagnostic is not a
successful three-size browser curve.

**Grok:** only M1 and M2 are execution-green in the builder record. It stopped
before the four-hour caps. The independent grader finds that M2's mapped tests
do not establish its claimed capabilities, as with the corresponding anchor
mapping audit. Insights and Trending screens crash despite passing small API
probes. Digest counts include old unread activity and emit in quiet periods.
The grader's 1,229 s full replay binds the final schema and passes the final
manifest; it is stronger evidence than the builder's 453 s replay on an older
schema. Neither has the required checkpoint/probe curve. The received O5 null
conflicts with the frozen rule for an attempted replay; it remains null with
that qualification, without an invented replacement band.

**Muse:** its final continuous sweep contains seven green choreography segments,
with earlier failures retained. The M5 expiry pass is contradicted by a separate
read-only observation: its exact probe row still had an unexpired 24-hour TTL
after the 46.459 s passing check. This is an instrument false positive, not proof
of an engine expiry defect. Muse ran only a 50-action scale sample. The CLI was
interrupted after its completed report and repeated completion responses to
idle-server callbacks; original exit 130 is preserved. Its report's dates and
some milestone timestamps disagree with lifecycle/receipt times. The independent
grader's three failures concern avatars, rolling rather than UTC day buckets,
and the 200-candidate Trending limit. Its proper shortened-TTL expiry and
offline/cold-web purge probes pass, as do period digest, restart and inspected
authorization cases, with the digest interpretation and coverage limits in the
measurement notes and Muse grade audit. M3's mismatched suite IDs separately
reduce O1 credit.

No builder supplies native simulator execution proofs. Original score notes
remain unchanged alongside separate qualifications: accepted upsert behavior
was charged as a defect; reduced published-pin controls contradict broad
unsynced-like and post-admission outbox-loss claims. Those controls do not
reproduce every full-app interaction. See the received files and
[bounded audits](audits/).

The received O1–O5 values are not a calibrated, uniform comparison. In
particular, current Astra's provisional O3 85 uses grader-authored probes in
place of absent committed holdouts. Earlier O3 null values are missing evidence,
not lower numeric scores. O4 and O5 practices also differ. No weighted total or
pooled improvement estimate is computed. Detailed values and assertion deltas
belong in the [measurement notes](MEASUREMENT-NOTES.md) and completed grade audits.

## Reporting and integration finding

The relevant remaining work is concrete; neither a raw error count nor a smaller
schema establishes it. Astra's 35 correction **events**, Grok's 14 final-report
rows and Muse's three final-session diagnoses are not comparable normalized
loop ledgers. The 0.2.9 Astra ledger has 21 protocol loops despite its README's
summary of 20. Together with the Grok/Muse source-access deviations, these limits
prevent a claim that the declared docs-only full-cell loop-bar gate passed.
The observations below support a qualified recommendation about remaining work.

| Retained correction | Outcome and attribution |
| --- | --- |
| Astra M8, run-log 69–70 | Changed reporting/ranking residency to preserve social-write prediction, then removed an invalid explicit sync override on a maintain. Real reporting-model correction work; received agent-error. The bundled fixture repair is separate. |
| Grok final 11 / run-log 9 | Changed access for a daily-activity helper that reads before ordinary insert/update. Real reporting-counter authority work; received agent-error. It is not engine-private upsert. |
| Astra M6, run-log 51 | Restored capped-page provenance by emitting while iterating the original membership page. Received agent-error against the retained fan-out rule. |
| Astra M6, run-log 55 | The guide promised presence prediction that the published binder refused. A worker relay moved eligibility evaluation to dispatch. Independently confirmed docs/integration loop, later resolved by the separate §19 program. |
| Grok and Muse receipt revisions | Repeated aggregation/polling changes and failed receipts show integration work. Root-cause normalization and equal green coverage are absent; red receipts are not automatically product loops. |

The final source still has reporting work tables and bounded scans. Astra has
17 tables and 13 maintains; Grok 22 and 5; Muse 20 and 10. These counts are source
inventories, not equivalent-coverage savings. Grok and Muse cap Trending's
candidate pool at 200; their simpler digest models do not alone establish
correct period totals. None of the three apps uses a worker action, so this cell
does not measure that already-built escape hatch's sufficiency.

**Recommendation, awaiting the author:** give §9.1 application SQL reads their
Moves line on the remaining reporting cost shown here. This reads the trigger
as reporting-authoring cost, including the two received agent-error corrections.
It does not claim a confirmed report-specific engine defect or prove that SQL
uniquely fixes either loop; the protocol did not require that latter proof.
Importing the ceremony bar's Snapback-only attribution would not establish the
same result. The proposed scan planner, second authorization translation and
approximate SQLite VM meter remain design costs for the author to weigh. The
[dated RFC finding](../../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#10.3)
records this qualified recommendation without changing a Moves line or
commissioning implementation.

## Fresh M7 evolution

| Model | Actual M7 wall s | Actual exit | Received outcome |
| --- | ---: | ---: | --- |
| Astra | 2,870.258 | 0 | Green; six suite-required IDs, two choreography checks, all seven prior suites |
| Grok | 1,667.198 | 0 | Green; six suite-required IDs, two choreography checks; prior M1/M2 suites rerun |
| Muse | 895.247 | 0 | Green; six suite-required IDs, two choreography checks; seven prior suites rerun |

Astra's report clock is 2,824 s; the table uses its runner. Twelve grouped
correction episodes comprise ten agent errors, one environment issue and one
confirmed backend defect. A legal compound maintain generated an ID accepted
on writes but rejected during later schema adoption. Restoring the old schema
reopened the store; replacing the derived tally with bounded counts over retained
votes let the migration proceed. The [P2 ticket](../../../issues/20260915-snapback4-maintained-identity-blocks-additive-schema-adoption.md)
retains separate 144/145/159-byte public-pin controls. This is an adoption defect,
not an additional argument that SQL is necessary.

Its physical migration backfilled a message contribution column over 15 starter
rows. A persisted sum exposes `conversation.messageCount` through the API; there
is no physical counter column on conversations. The received API comparison
preserves the exported starter state, with counts 6/9. A late cosmetic poll-label
change followed the full suite; focused choreography, typecheck and the Hermes
export were repeated. Failed adoption and PID-ledger regression attempts remain.
The original eight-persona export contains 39 viewer projections of 15 distinct
starter messages. Actual before/after files are retained, but the exporter omits
`sender` and `quote` and collapses missing values to null. Starter media and
reactions are empty. A separate corrective-adoption pair preserves richer test
state byte-for-byte, including additional receipt states and one distinct regular
photo byte hash; it still has no populated reactions or live-video reference.
The 18 later avatar/post checks compare against fixtures, not a populated
pre-migration message-media baseline. These are preservation witnesses with
explicit field/state limits, not an independent m7-a08 grade.
All thirteen final root/served-instance Quarry files match. The prior assertion
modules remain unchanged; M1's dispatcher-only addition was verified by
reconstructing its original hash. No later app edits were observed after the
final choreography. The M7 audit additionally records two installed declaration-
file searches; the earlier continuous-builder audit did not cover this session.
No explicit implementation-source or prohibited inherited diary/essay read was
observed. The scope of the prompt's “generated types” permission is not silently
adjudicated.

Grok's report clock is 1,615 s. It records three agent corrections and one
Node-version correction, with the first offline-vote choreography failure
retained. The stored count maintain groups by conversation and tombstone flag;
the API projects its value without a physical conversation counter column or
an explicit backfill job. This adoption was on a fresh in-memory backend;
it does not demonstrate a disk-persistent migration. Its original and actual post exports preserve the
whole exported payload apart from timestamps: 15 distinct messages, 24 receipt
rows, eight personas. Media and reactions are empty and receipt flags are false.
The comparer itself checks fewer fields than the exports; neither snapshot
exports the new count. The audit retains these limits instead of converting the
received green into an independent migration grade. The six-case suite preceded
the offline UI fix; final choreography followed, and no later app edits were
observed. The old M1/M2 test bodies hash-match after removing only M7 additions;
their original grading qualifications remain. Prior M3–M8 choreography failures
were not repaired. Its M7 public requests include seven packaged implementation
accesses, two broad package searches and one declaration read. The retrospective
run log and overbroad claim that jobs cannot scan expiring messages are separately
qualified in the final audit.

Muse's report clock is 846 s. Its five grouped corrections are two agent,
two environment and one ambiguous selector/setup episode. The inherited raw
`messageCounts` maintain stays unchanged. The new settings count scans up to
5,000 live messages and filters tombstones at read time; no stored count or
count backfill was added. The received green therefore does not establish an
equivalent forced count migration, or justify interpreting 895 s as a migration
speedup. The original eight-persona snapshot precedes observed app edits, with
15 distinct messages / 39 projections and eight avatar asset hashes. Original
message media, reactions, edits, tombstones, expiry and delivered/read marks are
empty. Both actual post versions are retained: new polls change inherited
history totals and later delivered marks advance. Its comparer accepts those
changes and omits some fields; it does not check the new count query. These
limits qualify the report's blanket byte-identity statement. Its sole green
choreography binds the exact six-case suite, and all seven prior assertion
bodies are unchanged. No later app edits were observed. The narrated suite
and choreography epochs extend beyond actual phase end; receipt times control.
The final audit also records three installed-declaration requests, unavailable
native-tool arguments and a shared temporary-log read. Earlier independent
failures remain; the claim that none existed is qualified. Its statements about
stored counts and expiry are overbroad: maintains update at sweep, with a delay
distinct from immediate read hiding. No new impossibility claim or grade follows.

The inherited Muse schema already has an online-only `messageCounts` maintain,
including tombstones; it has no conversation count field. Astra and Grok have
neither a conversation count field nor that maintain. This qualifies the forced
migration comparison. The frozen brief asks for a snapshot before the session,
while the frozen prompt has the fresh builder create it before edits during
the session; actual order must be recorded. The passive external observer
retains stable JSON versions and source hashes, without exporting a snapshot,
making app requests or changing benchmark inputs.

Anchor M7 walls were 1,345.403 / 1,658.219 / 6,434.294 s, all actual exit 0.
Their builder-green claims have source/snapshot and regression qualifications,
including Muse's replaced baseline and post-receipt source edits. The 0.2.9
calibration has no archived M7 phase. Baseline independent grades are not
rewritten by M7 builder claims.

## Deviations and verification

The [measurement notes](MEASUREMENT-NOTES.md) contain the full deviation inventory,
and the verbatim reports/audits retain each source's claims and qualifications.
The completed packet spans September 14 11:15:05 to September 15 02:43:55 UTC:
55,730 elapsed seconds. All twelve phases have actual end records; eleven
exited zero and the interrupted continuous Muse builder remains exit 130.

The main departures already established are Grok's early stop, implementation
and declaration discovery in Grok/Muse, Grok's development re-signing, adapted
copies of choreography imports, shared-host/runtime effects, Muse's interrupted
completion tail, and the original serial shell's takeover. The external Muse
helper admits only that exact hash-bound interrupted builder for later phases;
it preserves all other frozen gates and lifecycle outcomes. It does not change
the runner on disk or relabel exit 130 as success.

All 145 / 62 / 130 captured builder source hashes matched after scoring and
before any grade, and remained unchanged after their respective grades.
All three grades completed without a continuation. The pre/post-M7 source
inventories and late selected PID/listener observations are under each lane's
M7 custody directory, with explicit scope and times. The 177-file frozen
instrument, prompt templates and pins match their manifests after all phases;
rendered prompts have separate final-observation hashes. Package observations
preserve Grok's signing exception and Expo's metadata-only limit.
The final [table comparison](protocol/final-comparison-verification.json),
[file-custody check](protocol/completed-record-verification.json),
[scoped credential-pattern scan](protocol/archive-secret-scan.json) with
[reviewed dispositions](protocol/archive-secret-scan-dispositions.json), and
[reference check](protocol/ref-check-result.json) retain their methods and
actual results. [ARCHIVE.sha256](ARCHIVE.sha256) inventories the final selected
files; raw model streams and most generated artifacts remain external. These
checks establish the stated record boundaries, not additional application
passes, complete protocol compliance or an independent M7 grade.

All comparisons retain N=1 per model per pin and the received evidence limits.
The four §14 rulings accepted by the author on 2026-09-14 are already recorded;
this measurement does not reopen them.
