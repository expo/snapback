# Astra-medium Clique calibration #18 — `snapback4@0.3.0` / `snapback4-expo@0.3.0`

**Holistic score: 92/100. Independent functional grade: 101 passed, zero
failed, 18 not run.** This is the first calibration whose pins carry the 0.3
derived-data forms. One continuous cold Astra-medium builder ran M1–M6/M8;
M7 and the other builder lanes were not run. The grade is labelled
**uncalibrated-grader** (`calibrationPassed: false`).

## Packet and scope

| Item | Record |
| --- | --- |
| Full packet | `/Users/ccheever/clique-sb4-20260923-astra-cal18/` on the black M5 Max. |
| Public pins | `snapback4@0.3.0`, `snapback4-darwin-arm64@0.3.0`, `snapback4-expo@0.3.0`; [frozen pins](./PACKAGE_PINS.json) and [qualification](./RUN_QUALIFICATION.json). |
| Instrument | 179 frozen files from `30fea66c9b20dbea50e6d8444a61c2cd9ca3c787`. Manifest SHA-256 `89b8c59d734334c015eaed025a52488e4c6266aabd40e21ade6a75ffd35381d2`. |
| Templates and runners | Five templates and all five scripts copied byte-for-byte from cal17, which copied them from cal16. Template manifest SHA-256 `33e54d45d451400c38d9e1f738ebcd0181b0fc6c8fbf97de60e4fc15033b0f2e`. |
| Rendering | All 12 rendered prompts name both 0.3.0 pins. The only differences from cal17 are package versions and the absolute packet-root relocation emitted by the unchanged renderer. [Raw diff](./lifecycle/rendered-prompts.diff), [verification](./lifecycle/frozen-input-verification.json). |
| Measured scope | One Astra-medium continuous M1–M6/M8 builder; fresh Opus 5 grade; fresh Astra-xhigh read-only holistic score. M7, Grok and Muse builder lanes remain unrun. |
| Native scope | Seven iOS Hermes exports delivered; no installed simulator proof. Nine native assertions and nine M7 assertions are not run. |
| Isolation | No predictions or private 0.3 program documents supplied to any session. The operator did not open the protected prediction file. The builder received only the frozen prompt/instrument and public-package learning surface. |
| Host and ports | Black M5 Max, 18 CPUs, packet ports 49360–49379. The supervisor released the heavy slot. Assigned ports were clear immediately before builder and assessment launches. Background processes remained present. |

The packet's README, qualification, frozen-input checks and render diff are
retained. Neither the instrument, templates, scripts, models nor prompt text
was changed. [Final 203-file input check](./lifecycle/final-frozen-input-verification.json).

## Lifecycle and usage

All three model phases ran under `nohup` in the background, with runner and
child PIDs recorded. The operator used short polls; no model phase was
relaunched. Grade and score started concurrently after the verified builder
snapshot. UTC times below cross midnight; the run retains its commissioned
September 23 identity.

| Phase | Model / effort | Start UTC | End UTC | Wall seconds | Exit |
| --- | --- | --- | --- | ---: | ---: |
| Builder | gpt-6-astra / medium | 2026-09-23T22:34:58Z | 2026-09-24T00:04:47Z | 5,388.895 | 0 |
| Grade | claude-opus-5 / provider default | 2026-09-24T00:06:26Z | 2026-09-24T01:00:31Z | 3,245.162 | 0 |
| Score | gpt-6-astra / xhigh | 2026-09-24T00:06:26Z | 2026-09-24T00:09:13Z | 167.065 | 0 |

The builder's internal clock is 5,353 seconds; the external runner clock is
5,388.895 seconds. They are separate measurements. The lifecycle files retain
the original commands, PIDs, outputs and timing fields. Their `detached: false`
field describes the frozen runner's foreground child; the outer `nohup`
launch receipts record the operator's detached runner.

- [Builder usage](./lifecycle/builder-usage.json): 32,574,159 input tokens,
  including 32,072,960 cached; 145,227 output tokens, including 54,533 reasoning
  output tokens.
- [Score usage](./lifecycle/score-usage.json): 262,308 input tokens, including
  216,448 cached; 4,723 output tokens, including 2,830 reasoning output tokens.
  The CLI separately printed 50,583 tokens used.
- [Grade usage](./lifecycle/grade-usage.json): provider-reported 266 input,
  352,931 cache-creation input, 24,355,376 cache-read input and 174,118 output
  tokens (50,375 thinking tokens); 137 turns; reported cost $20.061278.
  These provider categories are preserved as emitted, without pooling them
  into a cross-provider efficiency statistic.

The launcher verified Node 24.18.0. The builder reported that login shells
initially selected Node 25 and switched commands to the absolute Node 24 path.
Nonfatal Linear connector authentication warnings appear in the Codex startup
logs; builder and scorer both completed with exit 0. The builder also
encountered a command rejection for `rm -f` syntax and continued within the
same session; its transcript retains the rejected command.

## Host sampling

The sampler started before the detached builder launch and stayed running
through both assessments and aggregation. It stopped normally via its own
stop marker at `2026-09-24T01:02:11.795871+00:00`; its recorded PID was 27705.
No operator signal was sent to an application process.

There are **147 samples**, from `2026-09-23T22:34:58.557078+00:00` through
`2026-09-24T01:02:07.629745+00:00`. One-minute load min/median/max is
**7.62 / 26.57 / 121.65** on 18 CPUs.
Sample intervals are 60.251–60.734 seconds.
[Raw samples](./host-load.jsonl), [statistics](./lifecycle/host-load.statistics.json)
and [passive process snapshots](./lifecycle/host-contention-observations.jsonl)
are retained. The snapshots record system services and other applications;
no unowned process was stopped. These observations establish no cause for an
application result or timing measurement. The grader's per-check load readings
are separate from this continuous sampler.

## Installed-member comparison and builder custody

Each of the three registry `dist.integrity` values was obtained with
`npm view <package>@0.3.0 dist.integrity`. Independently downloaded tarballs
matched those SHA-512 values. All **91 regular package files** in the
pre-grade snapshot match the qualified tarballs: 71 SDK files, three platform
files and 17 Expo files, including the CLI binary.
[Installed-member comparison](./lifecycle/installed-qualified-members.json).
The builder's [setup identity](./astra/setup-identity.json) is retained separately.

No assigned-port listener remained after the builder exited, so operator
termination was unnecessary. The complete APFS clone used `/bin/cp -cRp`
from 2026-09-24T00:05:48.166843+00:00 to 2026-09-24T00:05:53.768581+00:00, with no exclusions.
Source-before, source-after and snapshot match across **46,218 entries,
40,015 regular files and 3,398,208,205 logical file bytes**.
[Custody receipt](./lifecycle/builder-custody.json).

The complete app, stores, dependencies and full-content manifests remain in
`attempts/builder-completed/` and its adjacent manifest files in the packet.
All six expected narratives/reports were delivered. This repository retains
74 selected builder files verified against that snapshot, including the
[final report](./astra/lane-final-report.md), [diary](./astra/lane-diary.md),
[essay](./astra/lane-essay.md), [run log](./astra/lane-run-log.md),
[run record](./astra/run-record.json), backend source and selected receipts.
[Selection verification](./lifecycle/builder-selected-verification.json).
Relative links inside verbatim narratives refer to the full packet.

The builder retained two fresh replay runs, each with 167,243 settled actions:
1,267.038 seconds for its M6 program and 1,079.509 seconds for the completed
M8 program. Both report matching the combined invariant manifest, including
1,008 users, 50,228 posts/replies and 100,015 messages. The clocks overlap
other work and must not be added to builder wall time. Its timing samples
remain builder diagnostics. Its base run record validates; the full publication
record still lacks external driver metering and other required custody.
Historical failed checks and correction events remain in its report and packet.

## Holistic result

The [verbatim scorer output](./astra/FINAL.md) gives **92/100**. The overall
score is a holistic judgment, not the arithmetic mean of category scores.

| Category | Score |
| --- | ---: |
| overall | 92 |
| setup_and_docs | 96 |
| data_modeling | 87 |
| authorization | 97 |
| queries_and_live | 90 |
| writes_and_transactions | 96 |
| offline_sync | 96 |
| media_assets | 98 |
| background_work | 89 |
| client_integration | 92 |
| diagnostics_dev_loop | 97 |
| scale_and_limits | 90 |
| operations | 91 |

All seven actual scorer tool calls were audited: one tool-registry lookup and
six read-only Node REPL calls. They loaded the brief and the five permitted
lane narratives. No prior run, grading output, other lane, application source
or Snapback repository was read; no mutation or runtime test occurred.
Each returned narrative contains the complete pre-grade snapshot text.
[Tool and input-custody audit](./lifecycle/score-tool-audit.json).

## Independent functional result

The [primary report](./astra/grader-report.json),
[M8 companion](./astra/m8-assertion-results.json) and [trace](./astra/trace.md)
account for exactly 119 assertion IDs, without missing, extra or duplicate IDs
or invalid result statuses. The grader reports AJV validation against the
frozen schema. The unchanged aggregator validated Astra's 101/18 partition
before refusing the missing Grok lane. The following is a separately labelled
**Astra-only operator tally**, not a three-lane aggregate.

| Set | Pass | Fail | Not run | Not applicable |
| --- | ---: | ---: | ---: | ---: |
| Prior-comparable 101 | 85 | 0 | 16 | 0 |
| M8 only 18 | 16 | 0 | 2 | 0 |
| Complete 119 | 101 | 0 | 18 | 0 |

| Milestone | Pass | Fail | Not run |
| --- | ---: | ---: | ---: |
| M1 | 13 | 0 | 0 |
| M2 | 27 | 0 | 0 |
| M3 | 15 | 0 | 0 |
| M4 | 12 | 0 | 0 |
| M5 | 12 | 0 | 0 |
| M6 | 6 | 0 | 7 |
| M7 | 0 | 0 | 9 |
| M8 | 16 | 0 | 2 |

[Operator tally](./lifecycle/grade-summary.json). Not-run IDs are
`m6-a01`–`m6-a07`, `m8-a17`–`m8-a18` (nine native proofs), and
`m7-a01`–`m7-a09`. Coverage spot-verification is `honest`.

The grader records three minor findings: missing frozen-kit Trending
surfaces; replay receipts labelled `sent` for skipped actions; and a fresh
re-replay failing with `E_ID_REUSED` after an avatar re-upload. It records two
cosmetic findings: the HTTP login documentation omits its response shape,
and operational scripts append to the delivered run log/use PID files in ways
that complicate a second operator's work. No blocker or major defect is
reported. These are the grader's classifications, preserved without changes.

Recorded objective dimensions are **O1 72, O2 84, O3 null, O4 20, O5 band 75**.
O3 lacks the required secret holdout probe set; O4 records absent native
proof. O5 uses the published degradation rules: absolute ceilings and the
replay cap remain uncalibrated placeholders, the 10%/50% search states cannot
be remeasured, and receipt aggregation was checked read-side only. No weighted
total or complete holdout-performance qualification is claimed.

The following limitations and deviations remain explicit:

- `calibrationPassed: false`, `sessionOutcome: completed`,
  `contaminated: false`; the result remains labelled **uncalibrated-grader**.
  The grader discloses that its temporary clean-checkout copy briefly
  included excluded builder narratives, which it deleted without reading.
  Its contamination flag and that disclosure are retained together.
- `rerunsUsed: 1`: the grader's initial M6 suite attempt omitted the documented
  push worker. It corrected that setup omission and reran the suite once.
  Both attempts remain in the complete grading snapshot. The model phase
  was not relaunched.
- `m2-a07` is a choreography-class assertion for which the grader found no
  follower-count artifact. It used browser automation and disclosed the
  protocol deviation. `m3-a08` had one harness timing measurement, so the
  grader left `bestOf3Ms` null.
- The frozen assertion manifest's summary counts say 116, while its arrays
  contain 119; the arrays govern the tally. The frozen primary schema admits
  only the 101 M1–M7 IDs, so the 18 M8 results remain in the companion file.
- The trace's historical sentence at line 684 says this is the first session
  to emit structured M8 results. Cal17 already contains all 18 M8 IDs. That
  sentence is not adopted here; the original grader files remain verbatim.
  [Operator note](./lifecycle/operator-custody-notes.json).

## Builder's derived-data mechanisms

The following describes the verified pre-grade backend. File names and line
numbers refer to the verbatim files under [astra/source/snapback](./astra/source/snapback/).
The [source inventory](./lifecycle/derived-data-source-inventory.json) binds
all eight final Quarry files. The applied backfill is retained separately.

- **Maintained column:** `snapback/social.q:11` declares
  `score: count likes by postId`; line 12 indexes it with
  `by byHourLikes: hour(at), score, at, id`.
- **Declared timeline:** `snapback/social.q:77` declares
  `maintain feed: timeline`. Lines 78–82 bind profiles, posts, reposts and
  follows, including `events posts by authorId, at removed by removed`.
  The Following query reads it directly at line 100:
  `return feed[viewer] after c last 20 { *, post: posts[.postId] postCard, actor: profiles[principal = .actorId] }`.
- **Maintained counts and dotted attribution paths:**
  `snapback/social.q:83`–92 declares like, reply, repost, follower and
  following counts. `snapback/insights.q:16` declares
  `maintain receivedLikes: count likes by postId.authorId`;
  lines 19, 22 and 25 use `postId.authorId` for daily likes, received
  reposts and received replies. Lines 1, 4 and 7 use
  `replyTarget.authorId` for likes on replies, daily reply likes and
  nested replies. Lines 10 and 13 count original posts and daily posts.
  `snapback/chat.q:208` declares
  `maintain reactionCounts: count reactions by conversationId, messageId, emoji`.
  Generated `snapback/digest-config.q:3` and line 6 declare period post
  and follower counts using `bucket(.at, 2m, 0m)`.
- **Application-written global-feed projection:**
  `snapback/social.q:150`–157 declares `table events` with `postId`,
  `actorId`, `repost` and `at`, a time index and an actor/post/type unique key.
  `createPost` writes it at line 121:
  `insert events { postId: p.id, actorId: viewer, repost: false, at: now }`.
  `setRepost` writes it at line 137 and deletes its row at line 140.
  The Global query reads `events` at line 102. These rows contain copied
  post references, actor attribution and event timestamps.
- **Additional captured attribution:** `snapback/social.q:37`–43 declares
  likes with `postId: posts`, `replyTarget: replies ?`, `principal` and `at`.
  Line 129 inserts `replyTarget: replies[postId].id`. Replies declare the
  same optional target at line 24 and insert it at line 125. Neither table
  declares a copied target-author field; the like table has no `authorId`
  or `postAt` field. Its author aggregates use the dotted paths quoted above.
- **Applied backfill:** the archived
  [evidence/m8-attribution-upgrade.q](./astra/evidence/m8-attribution-upgrade.q):3
  declares `job backfillReplyTargets()`. Lines 4–7 scan replies and
  `update replies[r.id] { replyTarget: target }`; lines 8–11 do the same
  for likes. The [execution receipt](./astra/evidence/m8-attribution-backfill.txt)
  is preserved. Final `snapback/attribution.q:1` retains only
  `fn replyIdFor(postId: id): replies[postId].id`; the backfill job is not
  declared in the final eight-file backend.
- **Other application-written lookup and progress state:**
  `snapback/chat.q:22` declares `table dmPairs`, populated at line 129.
  `send` updates conversation `lastOrdinal`/`lastAt` at line 174 and member
  `delivered`/`readOrdinal` at line 175; `acknowledge` updates the latter at
  line 187. `messages.recipients` is declared at line 62 and captured by
  the send mutation at lines 169–176. Reaction writes copy
  `conversationId: m.conversationId` and `expiresAt: m.expiresAt` at line 215.
  `snapback/digest.q:1` declares `table digestMarkers`; the job checks it
  at line 14 and writes `insert digestMarkers { principal: p.principal, periodEnd }`
  at line 29. `snapback/chat.q:232` declares the application-written `views`
  table, populated by `markViewed` at line 242.
- **Verification clauses, feed helpers and zero-like fills:** there is no
  `verify` clause or `feed.<helper>(...)` call in the eight final Quarry
  files. There is a post-insert policy at `snapback/chat.q:18`:
  `after insert <- exists members[.id, .creatorId, 'admin']`.
  The Following query uses the direct timeline read quoted above.
  Trending is a single indexed merge at `snapback/insights.q:34`–36:
  `rows = merge posts after c last 10 by byHourLikes where .at > now - 86400000 and .at <= now:`
  followed by `[h] for h in range(hour(now) - 24, hour(now) + 1)` and
  `return rows postCard`. It contains no separate zero-like fill read.
  The seven-day summary does construct day rows at lines 29–32, reading
  `dailyPosts[viewer, d]` and
  `dailyLikes[viewer, d] + replyDailyLikes[viewer, d]` for each day.

The scheduled digest is declared at `snapback/digest-config.q:9` as
`schedule dailyDigest every 2m: digest.daily`. Its job uses period count
lookups and bounded unread-message reads (`snapback/digest.q:10`–29).
This inventory describes the delivered source and archived upgrade; it
assigns no quality judgment or causal interpretation.

## Final custody and aggregation

The complete grading directory was APFS-copied and verified at
`attempts/grade-completed/` (89 entries).
[Grade custody](./lifecycle/grade-terminal-custody.json).
The grader removed its temporary clean checkout and AJV installation during
its cleanup; retained probe source/results, suite receipts and logs remain
in that complete grading snapshot, with the terminal transcript in the packet.

The post-assessment comparison finds **no application-code change**. Of the
original authored-source/narrative files, only `run-log.md` differs: documented
replay commands appended entries after the scorer had read it. The other
narratives and the backend source are unchanged. Runtime database/assets,
push and sample-replay evidence changed, and grading outputs were added.
The grader also reports leaving the starter DM's disappearing setting `off`.
[Complete change inventory](./lifecycle/post-assessment-changes.json) and
[run-log diff](./lifecycle/post-grade-run-log.md.diff).

The original suite-status file and sample-replay state match the snapshot.
The sample-replay JSONL and result file do **not** match the original pre-grade
versions: the grader restored the stream captured before its forced-replay
experiment, after earlier grading activity had already appended to it. The
record's builder receipts come from the original snapshot. The scale SQLite
main file is unchanged; its WAL/SHM files changed during access. This is not a
byte-unchanged claim for the entire live database directory.
[Restoration comparison](./lifecycle/operator-custody-notes.json).

Each unchanged three-lane aggregator ran exactly once and exited 1 on the
missing Grok lifecycle record. Grok and Muse are unrun; no all-lane aggregate
is claimed. [Commands/outcomes](./lifecycle/aggregator-operator.json),
[grade refusal](./lifecycle/summarize_grades.py.operator.log),
[score refusal](./lifecycle/aggregate_scores.py.operator.log).
Ports 49360–49379 were clear after grading; the operator stopped no application
process. The sampler and all recorded runner/model PIDs had exited at final
custody. No commit or push was performed.

## Interpretation boundary

This is one descriptive, frozen run. The score, grade, authoring mechanisms,
correction history, timings and shared-host samples are observations of this
app and these sessions. This record does **not** interpret any result as an
effect of 0.3. The supervisor's separate reading against blinded predictions
is outside this record. Native runtime behavior, M7, other builder lanes,
secret holdouts and full publication qualification remain outside the
established evidence. No phase was repeated because of its result.
