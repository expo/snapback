# Clique M7 diagnostic implementation report

Written 2026-09-06T11:45:05.612168+00:00 after the sealed diary and qualitative essay.

## Outcome

Both requested M7 features are implemented in the private app on published snapback2@0.0.6. Final API, browser, frozen M7 choreography, unattended-expiry, type-check and iOS Hermes-export evidence passes the corresponding bounded checks. **This run is not milestone-green or full-run eligible.** Previously-green web regression did not reproduce a fully green result, and the strict final snapshot comparison records acceptance-induced changes. Aggregate native M6 remains a capability failure; M8 remains unresolved. Neither was repaired.

## Clock and conditions

- Model/effort: gpt-6-astra, medium; installed-only aid; single agent, no resumed/forked conversation, no delegation.
- Start: 2026-09-06T11:21:24.041563+00:00 / epoch 1788693684.0415611.
- Authoring stop: 2026-09-06T11:41:11.065742+00:00 / epoch 1788694871.06574.
- Authoring wall interval: 1187.024 seconds (19 minutes 47 seconds). Preparation and starter replay precede this interval. Report/assessment writing follows the stopped authoring interval.
- Terminal status: `diagnostic_complete_not_green`, not a cap timeout or successful full-run certification.
- Root wall/token caps: null. Cap compliance: null, because no caps were supplied.
- Native Codex usage: null; actual approved per-turn usage source is unavailable in the exposed session. No token estimate or cap-compliance estimate was made.
- First product-source boundary: epoch 1788693745.913905, with `initial-hashes.json` and `original-source/` captured before endpoint-only isolation. M7 business logic began after the retained baseline attempts; phase events are in `events.jsonl`.

## Implementation and migration

`snapback/polls.q` creates group poll messages and accepts idempotent set-state vote intents. Questions are 1–200 characters; polls have 2–4 nonempty options of at most 50 characters. Creation requires current group membership. Voting checks current membership, poll visibility and option bounds. A unique actor/message record stores one vote. Mutation IDs are recorded before applying the set state, so a duplicate, including an old retry following a newer selection, does not invert or replace the later state. Polls use existing message IDs, timestamps, send-time receipt targets, push seam, disappearing deadlines and deletion paths. Creation retries also verify creator, conversation and poll type.

`visibleMessageCounts` is a new persisted maintained count of messages grouped by conversation, tombstone and expired flags. `messageCount` is a server-projected conversation field summing the four visible false/null flag groups, including zero for empty conversations. It is exposed in conversation lists, by-key reads, details and settings. It is **not a literal new stored column on the conversations table**; its backing structure is persisted and backfilled by the schema successor. This is distinct from the pre-existing unread receipt-target counts. The supplied `pre-m7-count-structures.json` confirms no previous visible-message count field or maintain existed.

The published compiler accepted the schema, but the owner refused enum expansion with `E_SUCCESSOR_DESTRUCTIVE`. Its exact emitted migration plan was retained and applied using `dev --apply-migration`. The admission receipt reports two backfilled maintains, the new tables/indexes and optional poll-options column. The old enum values and original objects survived that boundary. No database replacement, reset, SQLite import, direct SQLite inspection, seed replay, scale replay, package patch or lock repair occurred.

Count maintenance follows message writes and tombstone/expired transitions transactionally. The existing server timer supplies expiry under the contract's tolerance; the app does not recalculate counts by paging history. Poll options are cleared on deletion and expiry. The frozen PollCompose/PollDisplay kit components render the feature; the app's existing semantic-props adapter now preserves aria-busy for observable queued votes. Frozen kit files were not edited. Votes use the same SDK durable FIFO outbox as reactions.

## M7 verification

| Proof | Retained evidence | Result |
|---|---|---|
| All eight personas' available conversations compared with paged visible history counts | `api-1788694769405.json` and earlier API attempts | Pass |
| Bounds, group-only creation, outsider/removed-member refusal, one vote, switch, duplicate/stale intent, create retry | API evidence above | Pass |
| Forward count for text and polls, zero for new empty groups, deletion and repeated deletion | API evidence above | Pass |
| Poll creation through UI, other-client live tally/switch, real browser offline pending and reconnect, settings count | `ui-1788694752554.json` plus PNGs | Pass |
| Frozen live-tally and offline-reconcile assertions on final kit UI | `m7-kit-choreo-1788694717.jsonl` | Both pass; aggregate green remains false because the suite status honestly retains failed regression |
| Unattended shortened-window expiry of a poll and text; count 2 → 0; later vote refused | `expiry-1788694303935.json` | Pass |
| Final compiler/type checks | `final-schema-check.log`, `final-typecheck.log` | Pass |
| Final iOS Hermes bundle | `ios-export-result-1788694718.json`, `ios-export-1788694718/` | Export succeeds, `.hbc` retained |

Earlier failures remain alongside the corrections: JSX/type errors, an overly specific new denial-test expectation, migration refusal, stale setup identity, and the first kit busy-state choreography miss. `error-catalog.json` identifies tool-only errors whose exact original timestamp was not available; those times are not invented.

The iOS artifact is a Hermes **build/export** proof, not a native runtime/offline claim. No simulator was started or disturbed. The original native M6/M8 gaps remain separately unverified.

## API preservation evidence

All comparisons used the supplied unmodified custom-client helper, ordinary per-persona tokens, and the exact frozen snapshots. No baseline was rewritten and no normalization was added.

1. `comparison-before.json`: 914 checks, pass, zero differences.
2. `comparison-after-baseline.json`: 914 checks, two differences. The frozen M5 baseline changed the starter DM disappearing setting from null to off, visible to Alice and Bob.
3. `comparison-after-migration.json`: 914 checks, the **identical two differences**. Thus no new snapshot difference appeared across the actual migration boundary. This is the bounded schema-preservation evidence; it is not reported as a pristine strict pass.
4. `comparison-during-regression.json`: 58 differences, retained.
5. `comparison-final.json`: 914 checks, **strict fail with 68 differences**. These are 48 raw-receipt comparison entries, eight own-message aggregate receipt fields, two disappearing-setting projections, two profile projections, four accent projections and four background projections. The raw receipt differences are state advances, with no removed recipient entries identified by the follow-up analysis. Browser reading and frozen profile/settings choreography caused these actions; no receipt rollback was performed to manufacture equality.

Original conversation/message IDs and original content, timestamps, media references, edit/tombstone/reply/reaction fields have no reported loss or change in the final comparison. Receipt states are explicitly different after regression viewing. New messages are reported separately by the helper. The original starter contains no message media or reactions, so its empty-baseline comparison cannot prove preservation of nonempty message media/reaction data. The exact helper outputs remain authoritative; `strict-comparison-analysis.json` is only an explanatory index.

The final database intentionally retains acceptance attempts, new messages/groups, profile/settings changes and receipt progression. It has not been rolled back or reseeded.

## Previously-green web regression

Baseline scripts ran after only endpoint isolation and before M7 business changes. The initial web startup failures are retained under `baseline/`. M5's baseline API suite passed; M6 initially lacked a provider receipt. M3's frozen suite was unavailable because it runs starter seeds twice; running it would violate this session's explicit no-reseed rule. No assertion was removed or seed invocation changed.

After migration, the same endpoint-only copies ran under `regression-1/`. Frozen choreography was also attempted for M1–M6 with a new factual setup identity. Setup refused the obsolete Node declaration and two intermediate path representations before the root-level identity was accepted; all attempts are retained. This identity is an environment artifact, not a rewritten assertion or expected result.

| Milestone | Suite | Frozen web choreography |
|---|---|---|
| M1 | Fail: profile-edit handle field timeout after signup | Profile live update and session persistence pass; logout/relaunch fails |
| M2 | Pass | Fails author display-name rendering check; detailed attempts retained in app evidence |
| M3 | Unavailable: forbidden reseeding in frozen suite | DM/live avatars/typing/direct receipts/quote jump pass; group slowest receipt and membership flow fail |
| M4 | Fail: send control becomes disabled during video step after photo | All executed media/reaction/edit/delete choreography checks pass |
| M5 | Pass | Customization passes; view-once UI, warm-offline search and expiry/purge choreography fail |
| M6 web | Push and clean custom-client demo checks pass; suite then fails on absent `evidence/replay-settled.jsonl` | Offline message queue/flush choreography passes |
| M6 native | Previously capability-failed | Not repaired or newly claimed |
| M8 | Previously unresolved | No green claim or repair |

These outcomes do not establish that every current failure was introduced by M7, nor do they establish prior behavior green on this starter environment. The initial web baseline was limited by startup; exact failures, successes and missing prerequisites remain distinct. The M7 regression acceptance item is not passed.

## Isolation and retained runtime

Original backend ownership was verified using PID/parent, command, cwd and listener: wrapper 57662, owner 57663, private port 50700. It was retained throughout. New services are notification provider PID 31118 on 50702 and final Metro PID 84228 on 50701. `processes.jsonl`, `retained-processes.json`, `ownership.txt`, restart events and helper cleanup record their identities and disposition. Failed Expo/openChrome helpers were stopped only after matching this workspace/50701. Private browser contexts were closed by their test scripts. No simulator process was created.

Only assigned ports 50700–50702 were used. No protected backend or browser endpoint was invoked. Endpoint-only private suite copies, original/copy hashes and exact diffs are in `private-copy-hashes.json` and `private-copies.diff`. The original setup identity is retained; `m7-setup-identity.json` records Node 20.19.4/npm 10.8.2 and current host paths. Initial incidental CLI invocations used the shell-default Node 25; browser suites, exports and subsequent checks use the supplied Node20 where explicitly recorded. The original backend retained its existing launch process.

## Frozen bytes, source hashes and recording order

`frozen-integrity.json` passes for all initially inventoried fixture/assertion/kit/replay/acceptance files and the lock. No original instrument, assertion, expected result, replay logic or scale file was edited. Input snapshot/contract/helper hashes are in `input-hashes.json`; product/package hashes are in `current-source-hashes.json`; original source hashes/copies and final diff are retained separately.

Selected SHA-256 values:

- package-lock.json: `5382638179bb43155d2bdd08cb1e8d4eb834fafa949cb98b43a4c746e4292c49`
- published compiler: `9c93d2adc425eab14d977a2a8b0d1228a0a5c8c27c4e59bc889efe9863490a78`
- published client: `2a2e7e7c3ed65232b1d6c03bb933896ded12ea2332645d98aedc1e27c7fc2f80`
- published Darwin binary: `52d7de9c0c31c3e1cd4df59a3afb438d664f428b25bc68994952ece14ace4955`
- final schema.q: `394fd1da7be89e89393f5d6120ece0b0ba232336519fcc29b4ed18689b18ae11`

`diary.md` and `closing-essay.md` were written and sealed in `essay-seal.json` before `experience-assessment.json`. No prior experience score, holistic score, grader score or grading anchor was read. The assessment is qualitative; numeric values are null because the allowed material supplies no numerical recording protocol or scale. No grade or scale was invented.

The concise delivery is separate in `final-answer.md`. This report describes only the fresh M7 interval and does not present preparation as implementation.
