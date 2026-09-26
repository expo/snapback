# Clique reference lanes — Astra medium and Opus 5.5 high

Five complete lanes and one terminated lane. This is the reference-clock evidence for
[LLP 4001 §1](../../../llp/4001-snapback5-sql-front-end.rfc.md#1-evidence), the SQL front-end bet,
for the author's question: **“is wall clock faster than Convex and Supabase, and are the results very correct”**.
The packet was commissioned under LLP 4000 §9 before that first bet was shelved.
This record measures Snapback 4 and the incumbents; it is not a Snapback 5 result.

Read time to first green within each wave, then the independent grade's pass count
and coverage honesty, then the holistic score. N=1 per builder/backend cell: a
reference, not a claim-eligible magnitude. The packet's two deviations are retained
verbatim in [packet-README.md](./packet-README.md).

## Packet

| Item | Record / source |
| --- | --- |
| Read-only packet | `/Users/ccheever/clique-ref-20260924/`; no builder, grader or scorer was run while making this record |
| Instrument commit | `30fea66c9b20dbea50e6d8444a61c2cd9ca3c787` — [INSTRUMENT_COMMIT](./INSTRUMENT_COMMIT) |
| Instrument digest | SHA-256 of [INSTRUMENT.sha256](./INSTRUMENT.sha256): `1070612b243a19ce688270d11558a03ba4a050ceaff582e2f803069da0e4a13e`; all 178 listed files matched their hashes in the packet. This identifies the manifest, not a hash of a concatenation or archive |
| Instrument relationship | Calibration #19's frozen instrument; this packet's environment overlay declares three lanes sharing the host and harness-native token accounting where exposed. [Packet](./packet-README.md), [overlay](./instrument/ENVIRONMENT.md) |
| Pins | `snapback4@0.4.0`, `snapback4-expo@0.4.0`, `convex@1.46.0`, `@supabase/supabase-js@2.117.1` — [PACKAGE_PINS.json](./PACKAGE_PINS.json) |
| Provider posture | Convex anonymous/local; Supabase hosted `clique-pilot`, lane-private credentials and per-wave prefixes `clqra_` / `clqro_` — packet README. Credentials are not retained |
| Host | Black M5 Max, macOS arm64, 18 cores, 128 GB RAM; Node 24.18.0; same host as calibration #19. [Overlay](./instrument/ENVIRONMENT.md), [host-load.jsonl](./host-load.jsonl) |
| Wave 1 | Astra: `codex exec --json`, `gpt-6-astra`, medium; Snapback 4 / Convex / Supabase, ports 49500–49519 / 49600–49619 / 49700–49719; [start files](./logs/astra-snapback4.start.json) |
| Wave 2 | Opus: `claude -p --output-format stream-json`, `claude-opus-5-5`, high; same backends, ports 49200–49219 / 49300–49319 / 49400–49419; [start files](./logs/opus-snapback4.start.json) |
| Sequence | Waves run sequentially; three builders run in parallel within each wave. M1 → M2 → M3 → M4 → M5 → M6 → M8 in one cold session. M7 not run |
| Grader | Fresh independent `claude-opus-5` session per complete lane, same model for all. **Same family as the Opus builders.** Every retained report nevertheless says `sameFamilyGraded: false`; preserve this metadata error, do not infer cross-family grading from it |
| Holistic scorer | `gpt-6-astra`, xhigh, narrative files only; same family as the Astra builders. Opus score files mislabel `scorer.family` as `opus` while `scorer.model` and score-start commands name `gpt-6-astra` |

**Deviation 1 — parallel load.** Protocol rule 5 prescribes serial lanes. Here the three
backends share the host in parallel, as declared before results. Contention inflates
absolute wall clocks; the surviving reading is within-wave ordering and ratio, not
portable minutes. Across waves read backend ordering only, never compare minutes.
Load was not constant: other processes could share the host and completed builders
leave different later portions of a wave. The retained load trace is evidence, not a correction factor.

**Deviation 2 — termination.** `opus-supabase` was terminated with the orchestrating
harness session after its M8 green marker, before `final-report.md`. There is no
`end.json` or terminal `result` event. It was not graded, scored or rerun. The packet
calls this “roughly eleven hours”; the actual recorded start-to-last-output span is
9 h 55 min 35 s. Neither that last write nor the prose estimate establishes an exact
termination time. The only complete Supabase lane is Astra.

## Builder clocks

All timestamps are UTC. Wall is `end.endedEpoch − start.startedEpoch`; the M8
column uses the final report's first-green epoch minus that same harness start.
Orientation is inside the clock. The reports' own starts are slightly later.
Session end includes later replay, correction, verification, reporting and cleanup;
it is not the time of last passing acceptance evidence. Separate replay clocks may
overlap and are not added. “Green” is the builder's suite plus web choreography bar,
not a 119-assertion grade or proof of native correctness.

| Lane | Start UTC | End UTC | Builder wall s (min) | M8 report green UTC | M8 min from start |
| --- | --- | --- | --- | --- | --- |
| [astra-snapback4](./lanes/astra-snapback4/final-report.md) | 2026-09-24T17:57:58Z | 2026-09-24T20:06:01Z | 7,683 (128.05) | 2026-09-24T19:05:52.898Z | 67.91 |
| [astra-convex](./lanes/astra-convex/final-report.md) | 2026-09-24T17:57:58Z | 2026-09-24T20:31:11Z | 9,193 (153.22) | 2026-09-24T19:02:02.543Z | 64.08 |
| [astra-supabase](./lanes/astra-supabase/final-report.md) | 2026-09-24T17:57:58Z | 2026-09-25T00:07:42Z | 22,184 (369.73) | 2026-09-24T20:11:46.954Z | 133.82 |
| [opus-snapback4](./lanes/opus-snapback4/final-report.md) | 2026-09-25T00:08:13Z | 2026-09-25T01:51:53Z | 6,220 (103.67) | 2026-09-25T01:08:26.000Z | 60.22 |
| [opus-convex](./lanes/opus-convex/final-report.md) | 2026-09-25T00:08:13Z | 2026-09-25T03:02:49Z | 10,476 (174.60) | 2026-09-25T01:37:36.000Z | 89.38 |
| opus-supabase | 2026-09-25T00:08:13Z | not run | not run | not run | not run |


For the incomplete lane, M8 in the table above is **not run as a final-report measurement**;
its recoverable marker appears below, not as a completed campaign.

| Incomplete lane | Start | Last stdout write | Observed span | End / final report / grade / score / tokens |
| --- | --- | --- | --- | --- |
| opus-supabase | 2026-09-25T00:08:13Z | 2026-09-25T10:03:48Z | 35,735 s (595.58 min) | not run / not run / not run / not run / not run |

Source: [start](./logs/opus-supabase.start.json),
[termination receipt](./logs/opus-supabase.terminated.json) (`lastStdoutWriteEpoch`,
`lastStdoutWriteAt`). The last NDJSON event has no timestamp; its write time is
known from that receipt, not reconstructed from event contents.

### Per-milestone time to first green

Cumulative minutes from the harness start; M7 is not run in all six lanes.
Complete lanes use `final-report.md` milestone rows. The incomplete lane uses only
captured first-green run-log markers in its NDJSON tool result (line 2706), not a
final report, grade, or score.

| Milestone | astra-snapback4 | astra-convex | astra-supabase | opus-snapback4 | opus-convex | opus-supabase |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | 10.20 | 12.52 | 8.86 | 20.55 | 37.72 | 35.82 |
| M2 | 24.83 | 19.68 | 28.58 | 27.97 | 44.43 | 42.68 |
| M3 | 33.18 | 24.02 | 56.90 | 36.07 | 49.22 | 48.92 |
| M4 | 38.32 | 28.05 | 66.81 | 40.13 | 52.88 | 56.20 |
| M5 | 53.70 | 36.21 | 84.16 | 53.83 | 75.20 | 76.75 |
| M6 | 60.79 | 53.11 | 120.82 | 54.28 | 80.78 | 89.60 |
| M8 | 67.91 | 64.08 | 133.82 | 60.22 | 89.38 | 99.63 |


Recovered `opus-supabase` marker epochs and UTC instants:


| Milestone | Epoch | UTC |
| --- | --- | --- |
| M1 | 1790297042 | 2026-09-25T00:44:02.000Z |
| M2 | 1790297454 | 2026-09-25T00:50:54.000Z |
| M3 | 1790297828 | 2026-09-25T00:57:08.000Z |
| M4 | 1790298265 | 2026-09-25T01:04:25.000Z |
| M5 | 1790299498 | 2026-09-25T01:24:58.000Z |
| M6 | 1790300269 | 2026-09-25T01:37:49.000Z |
| M8 | 1790300871 | 2026-09-25T01:47:51.000Z |


Astra Snapback 4 M1 is the first **retained** green: an earlier passing rehearsal's
receipt was overwritten, so its exact first green is unavailable. Astra Convex
M1–M4 use conservative recorded green handoffs where the earliest receipts were
not retained. These are observed clocks, not fabricated sub-second measurements.
Source: each lane's final-report clock notes.

### M8 receipt cross-check and clock discrepancies

Each receipt below is a combined green (`suite.pass`, `choreography.pass` and
`green` all true). Astra report timestamps agree exactly. Opus reports record
slightly later completion markers; both clocks are retained without rewriting the reports.

| Lane | Earliest retained combined M8 green UTC | Report minus receipt s | Packet receipt (line 6) |
| --- | --- | --- | --- |
| astra-snapback4 | 2026-09-24T19:05:52.898Z | 0.0 | `lanes/astra-snapback4/evidence/choreo-m8-1790276746102.jsonl` |
| astra-convex | 2026-09-24T19:02:02.543Z | 0.0 | `lanes/astra-convex/evidence/m8-choreography-1790276520409.jsonl` |
| astra-supabase | 2026-09-24T20:11:46.954Z | 0.0 | `lanes/astra-supabase/evidence/m8-first-green-choreo.jsonl` |
| opus-snapback4 | 2026-09-25T01:08:18.741Z | 7.259 | `lanes/opus-snapback4/receipts/choreo-m8-1790298493.jsonl` |
| opus-convex | 2026-09-25T01:37:31.382Z | 4.618 | `lanes/opus-convex/evidence/choreo-m8-green2.jsonl` |


The raw `end.json.wallSeconds` fields conflict with timestamp subtraction:


| Lane | End minus start s (used) | end.json wallSeconds (not used) | Difference s |
| --- | --- | --- | --- |
| astra-snapback4 | 7683 | 7055.022 | 627.978 |
| astra-convex | 9193 | 8564.868 | 628.132 |
| astra-supabase | 22184 | 21555.225 | 628.775 |
| opus-snapback4 | 6220 | 6220.046 | -0.046 |
| opus-convex | 10476 | 10475.873 | 0.127 |


The packet cannot explain the approximately 628-second Astra discrepancy. The
sub-second Opus differences are consistent with integer epoch precision. No hidden
startup interval is subtracted. The older LLP 4001 row's “last evidence” numbers
were approximate report clocks; these are explicitly harness-end clocks.

## Independent grade: 101 comparable assertions + 18 M8

Each tuple is **pass / fail / not-run / not-applicable**, counted from the individual
`assertionResults` entries, not from prose totals. Every complete lane has all 119
IDs accounted for. Not-run and not-applicable are visible, never folded into passes.

| Lane | 101 comparable P / F / NR / NA | 18 M8 P / F / NR / NA | 119 total P / F / NR / NA | Coverage honesty | Defects blocker / major / minor / cosmetic |
| --- | --- | --- | --- | --- | --- |
| [astra-snapback4](./lanes/astra-snapback4/grading/grader-report.json) | 88 / 0 / 12 / 1 | 16 / 0 / 2 / 0 | 104 / 0 / 14 / 1 | honest | 0 / 1 / 4 / 1 |
| [astra-convex](./lanes/astra-convex/grading/grader-report.json) | 88 / 0 / 13 / 0 | 16 / 0 / 2 / 0 | 104 / 0 / 15 / 0 | honest | 0 / 2 / 5 / 2 |
| [astra-supabase](./lanes/astra-supabase/grading/grader-report.json) | 85 / 0 / 16 / 0 | 16 / 0 / 2 / 0 | 101 / 0 / 18 / 0 | honest | 0 / 5 / 3 / 2 |
| [opus-snapback4](./lanes/opus-snapback4/grading/grader-report.json) | 84 / 1 / 16 / 0 | 16 / 0 / 2 / 0 | 100 / 1 / 18 / 0 | honest | 0 / 0 / 7 / 3 |
| [opus-convex](./lanes/opus-convex/grading/grader-report.json) | 85 / 0 / 16 / 0 | 16 / 0 / 2 / 0 | 101 / 0 / 18 / 0 | honest | 0 / 0 / 2 / 2 |
| opus-supabase | not run | not run | not run | not run | not run |


All five coverage spot checks are **honest**, not assertions that all mapped tests
are strong or reproducible. The graders identify weak and flaky tests below.
`opus-snapback4`'s one assertion failure is **m3-a02: DM bubbles lack sender avatars**.
The Astra Snapback 4 not-applicable entry is **m7-a09**, a conditional post-evolution
regression check; its other eight M7 assertions are not-run. The other four complete
lanes record all nine M7 assertions not-run. M8 is 16 pass / 2 not-run everywhere:
the missing assertions are native proofs m8-a17 and m8-a18.

**Coverage comparability limit:** Astra Snapback 4 and Astra Convex award m6-a05–a07
passes from the web queue/flush segment; Astra Supabase and both complete Opus lanes
mark all m6-a01–a07 not-run without native artifacts. This accounts for the three-pass
difference between the Astra 104s and Supabase's 101. No complete lane has simulator
proof. Preserve the supplied grades; do not read that three-pass gap as demonstrated
superior native behavior. All graders declare `calibrationPassed: false`, no committed
holdout probe set (`none-uncommitted`), and no O3 score. The holistic score below is
separate from the unavailable weighted O-dimension total.

### Defects retained from the graders

IDs and severities below are the graders', not new adjudications. Full detail and
source evidence are in each linked `grader-report.json` under `defects`.


**[astra-snapback4](./lanes/astra-snapback4/grading/grader-report.json)**


- `d-01` (major): Celebrity post acknowledgement degrades with follower count and violates the frozen write-path rule.
- `d-02` (minor): The builder’s scale probes omit the celebrity write-path rule.
- `d-03` (minor): M8 zero-day-bucket acceptance assumes all activity is from the current UTC day.
- `d-04` (minor): Quoted-reply acceptance assumes the seeded reply remains on the first history page.
- `d-05` (minor): The no-preview-card test checks literal text, not the prohibited UI.
- `d-06` (cosmetic): M6 assumes the push worker is already running and gives an unhelpful assertion failure otherwise.


**[astra-convex](./lanes/astra-convex/grading/grader-report.json)**


- `d-01` (major): Missing Node types make the documented backend command fail typechecking and refuse function deployment.
- `d-02` (major): M8 acceptance fails when the UTC day differs from the seeded activity day.
- `d-03` (minor): Typing expiry misses its bound in a majority of recorded trials.
- `d-04` (minor): Shortened grading configurations are hard-wired; production values require a code edit.
- `d-05` (minor): A packet evidence file contains plaintext generated-account credentials; that file is not retained here.
- `d-06` (minor): People search scans the full profiles table.
- `d-07` (minor): Cold initial sync needs a round trip per conversation.
- `d-08` (cosmetic): User-facing errors expose raw Convex error envelopes.
- `d-09` (cosmetic): Obsolete trend timers remain scheduled until a maintenance mutation cleans them up.


**[astra-supabase](./lanes/astra-supabase/grading/grader-report.json)**


- `d-01` (major): M6/M8 native proofs and the specified O4 evidence are absent.
- `d-02` (major): An Auth account without an application profile can sign in with an undefined profile.
- `d-03` (major): M1 avatar acceptance expects an asset URL while the UI uses an account-scoped blob URL.
- `d-04` (major): M3 idempotency acceptance exhausts the hosted session pooler.
- `d-05` (major): Orphan-signup recovery passes an obfuscated Auth ID into the admin update and fails.
- `d-06` (minor): A fixed signup timeout exposes raw abort errors while server signup can remain in flight.
- `d-07` (minor): Non-member message sends use an inconsistent HTTP refusal status.
- `d-08` (minor): Pooler pressure silently skips revocation, push and expiry worker ticks.
- `d-09` (cosmetic): Duplicate email and handle share an ambiguous error.
- `d-10` (cosmetic): Profile-update API documentation is absent and partial patches expose a raw database error.


**[opus-snapback4](./lanes/opus-snapback4/grading/grader-report.json)**


- `d-01` (minor): Asynchronous composer prefill races M4 acceptance.
- `d-02` (minor): Live Following-feed repost projection is intermittent and passes only under best-of-three.
- `d-03` (minor): Continuous M2 liveness and M8 Insights sweeps can stall, despite targeted green reruns.
- `d-04` (minor): The replay store was mutated after its conformance receipt and no longer independently matches that snapshot.
- `d-05` (minor): The backend npm script points to a nonexistent file; the documented direct CLI works.
- `d-06` (minor): Replay evidence omits the busy-group receipt-aggregation and cold initial-sync degradation rules.
- `d-10` (minor): Previously viewed media fails cold-offline on web; the native assertion remains separately not-run.
- `d-07` (cosmetic): API refusal styles differ between errors and empty authorized results.
- `d-08` (cosmetic): API.md lacks the profile setup needed by a new third-party account.
- `d-09` (cosmetic): Delayed edit prefill changes the behavior of immediately typed characters.


**[opus-convex](./lanes/opus-convex/grading/grader-report.json)**


- `d-01` (minor): Conversation enumeration silently caps results without a continuation cursor or documented limit.
- `d-02` (minor): Ordinary private-chat media uses unauthenticated, non-expiring capability URLs.
- `d-03` (cosmetic): Unauthorized markRead returns success as a no-op instead of a refusal.
- `d-04` (cosmetic): The replay log echoes a fixture password; the quoted credential is redacted from the retained grader report.


The Astra Supabase final report additionally records a cap-exhausted separate scale
replay: M8 web green does not establish a complete scale envelope. The Snapback 4
celebrity write-path findings also prevent a blanket “very correct at scale” reading.

## Holistic score

Scored from narrative files only; these scores are not correctness grades.
Column headers link to the original score JSON fenced in `FINAL.md`.

| Category | [astra-snapback4](./scores/astra-snapback4/FINAL.md) | [astra-convex](./scores/astra-convex/FINAL.md) | [astra-supabase](./scores/astra-supabase/FINAL.md) | [opus-snapback4](./scores/opus-snapback4/FINAL.md) | [opus-convex](./scores/opus-convex/FINAL.md) | opus-supabase |
| --- | --- | --- | --- | --- | --- | --- |
| setup_and_docs | 82 | 84 | 88 | 90 | 70 | not run |
| data_modeling | 81 | 81 | 92 | 94 | 83 | not run |
| authorization | 95 | 85 | 82 | 97 | 85 | not run |
| queries_and_live | 85 | 72 | 70 | 94 | 78 | not run |
| writes_and_transactions | 93 | 94 | 92 | 95 | 92 | not run |
| offline_sync | 94 | 40 | 45 | 84 | 30 | not run |
| media_assets | 95 | 71 | 70 | 91 | 81 | not run |
| background_work | 89 | 90 | 68 | 97 | 86 | not run |
| client_integration | 77 | 84 | 62 | 88 | 87 | not run |
| diagnostics_dev_loop | 91 | 87 | 85 | 96 | 82 | not run |
| scale_and_limits | 86 | 81 | 70 | 84 | 69 | not run |
| operations | 83 | 82 | 75 | 89 | 76 | not run |
| overall | 87 | 78 | 72 | 89 | 74 | not run |


## Harness-native builder tokens

One terminal usage event per complete lane. These are raw provider counters, not
estimates from prose and not grading/scoring tokens. Codex `input_tokens` **includes**
`cached_input_tokens`; Claude `result.usage.input_tokens` is separate from cache read
and creation. Output detail is retained in `tokens.json`; reasoning/thinking is a
subset, not extra output. Do not sum cache-read into Codex input or compare totals
across model families as a common cost unit.

| Lane | Input | Output | Cache read | Cache creation | NDJSON terminal event line |
| --- | --- | --- | --- | --- | --- |
| astra-snapback4 | 42,030,941 | 162,799 | 40,970,112 | 0 | 705 |
| astra-convex | 46,480,565 | 210,401 | 45,738,240 | 0 | 810 |
| astra-supabase | 89,956,042 | 355,638 | 88,355,968 | 0 | 1719 |
| opus-snapback4 | 550 | 297,575 | 133,723,714 | 714,996 | 2271 |
| opus-convex | 502 | 387,364 | 106,455,016 | 661,599 | 2908 |
| opus-supabase | not run | not run | not run | not run | not run |


Astra source fields: `turn.completed.usage.{input_tokens,output_tokens,cached_input_tokens,cache_write_input_tokens}`.
Opus source fields: `result.usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}`.
For `opus-supabase`, no `result` event exists: all token cells are **not run**, and
`tokens.json` has null counters with that reason; partial message usage is not extrapolated.

## Comparison reading

**Astra — no backend lane missing.** Reported/retained first-green ordering is Supabase → Snapback 4 →
Convex at M1, then Convex → Snapback 4 → Supabase at each of M2, M3, M4, M5, M6 and M8.
At whole-brief M8, Convex is first (64.08 min), Snapback 4 next (67.91), Supabase last
(133.82). Session-end ordering differs: Snapback 4 → Convex → Supabase. Grades then
read Snapback 4 = Convex (104 passes) ahead of Supabase (101), with all coverage
spot checks honest and the native-evidence scoring difference above. Finally,
holistic ordering is Snapback 4 (87) → Convex (78) → Supabase (72), highest first.
The clock does not show Snapback 4 beating Convex to M8 green in this wave.

**Opus — missing the complete Supabase lane.** Among complete lanes, Snapback 4 reaches
every milestone green and session end before Convex; M8 is 60.22 versus 89.38 min.
The partial Supabase markers fall between those two at M1–M3 and after both at
M4–M8 (M8 99.63 min), but cannot supply a complete time/grade/score reading. Grade
passes favor Convex (101) over Snapback 4 (100, with the sender-avatar failure);
coverage is honest for both. Finally, holistic ordering is Snapback 4 (89) → Convex
(74). Supabase's grade, coverage audit, score and completed wall are all not run.

**Across waves — ordering only.** The Snapback 4/Convex M8 ordering reverses between
builders; the complete-lane session-end and holistic orderings favor Snapback 4
in both. The grade ordering is a tie in Astra and favors Convex in Opus. There is
no complete two-family Supabase comparison. Do not compare wave minutes, average
across builders, or infer a claim-eligible speedup. The packet supports useful
reference clocks and candid correctness gaps, not an unqualified “faster and very
correct” claim for every backend and builder.

## Retention, sources and reproduction

[clocks.json](./clocks.json) and [tokens.json](./tokens.json) each have one object per
lane, source paths relative to the packet root, input SHA-256 digests, exact epochs,
field/line locators and nulls with reasons. Displayed minutes are seconds / 60 rounded
to two decimals; JSON retains seconds. [extract.py](./extract.py) produces both:

```sh
python3 benchmarks/runs/2026-09-24-clique-reference-lanes/extract.py /Users/ccheever/clique-ref-20260924
```

An optional second argument writes the two JSON files to another directory for a
byte-for-byte comparison. It rejects output inside the packet, imports no packet
code and runs no builders, graders, scorers, services or package installs.

| Numbers / facts | Authoritative source path in packet and derivation |
| --- | --- |
| Start, end, builder wall, discrepancy | `logs/<lane>.start.json` (`startedAt`, `startedEpoch`), `logs/<lane>.end.json` (`endedAt`, `endedEpoch`, `wallSeconds`); subtract epochs |
| Complete-lane milestone/M8 clocks | `lanes/<lane>/final-report.md`, milestone first-green columns; subtract the harness start. Every report line and corroborating receipt is indexed in `clocks.json` |
| M8 receipt cross-check | Exact paths and line numbers in the receipt table above; `recordedAt`, `green`, `suite.pass`, `choreography.pass`; report epoch minus receipt epoch |
| Incomplete markers | `logs/opus-supabase.ndjson:2706`, tool-result stdout containing the run log's `epoch Mx GREEN (first green)` lines |
| Last output, observed span, incomplete status | `logs/opus-supabase.terminated.json`, `lastStdoutWriteAt` / `lastStdoutWriteEpoch`; subtract start; no exact end is inferred |
| Grade counts, coverage, failures, defects and caveats | `lanes/<lane>/grading/grader-report.json`: `assertionResults.*.result`, `coverageSpotVerification`, `defects`, `grader`, `wave`, `notes`; M8 from sibling `m8-assertion-results.json` under `assertionResults.*.result`. Count 101 + 18 unique IDs |
| Holistic category and overall scores | `scores/<lane>/FINAL.md`, fenced JSON `backends.<backend>.<category>.score` |
| All token values | `logs/<lane>.ndjson`, terminal event lines in the token table; exact provider keys above and full counter names in `tokens.json` |
| Model/effort/ports and phase provenance | `logs/<lane>.start.json`, `logs/<lane>.grade.start.json`, `logs/<lane>.score.start.json`; corresponding ends retained |
| Pins, instrument commit and hashes, host, protocol, waves | `PACKAGE_PINS.json`, `INSTRUMENT_COMMIT`, `INSTRUMENT.sha256`, `instrument/ENVIRONMENT.md`, `README.md`, `host-load.jsonl` |

Per complete lane, retained at their packet-relative paths: score `FINAL.md`,
`grading/grader-report.json`, `grading/m8-assertion-results.json`, `final-report.md`,
`run-log.md`, `diary.md`, `essay.md`. Also retained: pins, instrument commit/hash
manifest, host load, **all** `logs/*.start.json` and `logs/*.end.json` (builder,
grader and scorer), `logs/opus-supabase.terminated.json`, the packet README renamed
`packet-README.md`, and its environment overlay. Raw NDJSON, app stores, provider
secrets, `node_modules`, `dist`, `artifacts` and `tmp` are not copied. Links inside
original narratives can point to evidence retained only in the source packet.

[retained-files.json](./retained-files.json) lists every copied file with source and
retained SHA-256 and its credential-check result. Each was scanned with Gitleaks
before writing and checked against known provider credential values without exposing
them. One deliberate redaction: `lanes/opus-convex/grading/grader-report.json`,
`defects[id=d-04].summary`, replaces an embedded replay action containing a fixture
password. All other copied files are byte-identical; assertion results, severity
and the fact of the leak are unchanged. The raw NDJSON needed for reproduction
remains in the read-only packet, identified by digest.

Unsupported by this packet: an exact Opus Supabase end or final token total; its
final report, grade or score; its completed campaign wall; the overwritten exact
Astra Snapback 4 M1 first green; exact early Astra Convex receipt times; an explanation
for the Astra `wallSeconds` discrepancy; native proof for any lane; a calibrated
holdout-based correctness score; a consistent native-assertion interpretation across
all graders; or claim-eligible serial / replicated / cross-wave timing magnitudes.
No missing value has been replaced with a zero, rerun or estimate.
