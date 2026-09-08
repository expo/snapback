# M7 Run Log

- Authoritative start: epoch `1788883136.39942`, from `../logs/author-launch.json`.
- Hard cap: `14,400` seconds; deadline epoch `1788897536.39942`.
- Initial author process: PID `11683`, model `gpt-5.6-sol`, effort `xhigh`.
- Scope: assigned M7 app tree only, with the permitted `../setup`, `../evidence`, and `../logs` operational artifacts.
- Initial backend: `http://127.0.0.1:53134`; assigned web origin: `http://127.0.0.1:53135`.
- Contamination check: no excluded context was supplied or accessed.
- Baseline supplied before authoring: 8 personas, 2 unique conversations, 15 unique messages, 6 quoted messages, and 81 receipt rows across persona views. Populated migration-proof classes are text/quote and receipts; image, video, reactions, edited, tombstoned, and view-once classes are empty.
- Pre-existing count structures: `true`. The pre-M7 `messageCounts` maintain grouped every `messages` row only by `conversationId`; `groups.settings` surfaced it directly. It therefore included tombstones, while expiry affected it only when the scheduled purge deleted a row. Pre-transition live values were `d-alice-bob=6`, `derived-conversation=1`, and `g-starter=9`.
- 2026-09-08: began frozen brief, assertion, choreography, UI contract, source, and installed `snapback2@0.0.19` documentation inspection. No product edit or schema transition yet.

## Attempts

- Source correction: the first `polls.q` draft used a branch-local `row` binding at its return site (`E_QUARRY_UNKNOWN`); changed the stable idempotent return to `messageId`.
- Compile attempt 1: failed `E_BOUND` because nesting poll options/votes into each generic message history row exceeded certified heap/closure bounds. Corrected by moving poll detail to `polls.byId`, a bounded per-poll live query.
- Compile attempt 2: passed, but the owner required an explicit destructive plan for directly widening `messages.kind`. The generated plan SHA-256 was `442b6caf7d0fad1bd72df812f3032d375cf3470dedcfaba2ec1275cef97944b9`; applying it was refused `E_SUCCESSOR_COLUMN_REQUIRED` before any generation/data change. Replaced it with the additive optional logical discriminator `messages.messageType`; the old `kind` bytes remain untouched and projections fall back to them.
- Compile attempt 3: failed `E_STEPS` for a message-discriminator rewrite job. Removed that rewrite: pre-existing logical kinds use the unchanged legacy field through projection fallback, while all new writes populate `messageType`.
- Optional migration generation `b3968f33c0a675601671d87ff9f822608404b8a63c7778d72d5e54611840de27` installed without owner restart.
- Planned and ran `admin.backfillConversationMessageCounts --as system --wait`. Job `job_s2id-8755dc9ac930975a7de4deeb17a6c734-000000000004a001` finished in one chunk, visited/wrote 3 conversations, and produced counts `6`, `1`, `9` for `d-alice-bob`, `derived-conversation`, `g-starter`.
- Narrowed `conversations.visibleMessageCount` from optional to required; final generation `030479ec81d67bc3fb9ef9bc7b0f27a3848dd6d9300f4b74dc4738ea3274bb03` installed without restart.
- Immediately ran the immutable public-client snapshot helper before acceptance fixture writes. The first invocation accidentally inherited Node 26 through a login shell and is retained as `../evidence/post-migration-snapshot-node26-attempt.json` (SHA-256 `8636d1e8766d330a38f30b4a1f77c2c3f1c4322a91b6019a0568f29c981e61cc`). Before any live test mutation, the canonical invocation was repeated with Node 24.18.0 as `../evidence/post-migration-snapshot.json` (SHA-256 `64ca0e085c27f076b762f74fe72279d912a7fe09d1ebc093dff44e65e22a837c`).
- Snapshot comparison ignoring capture timestamps: exact payload match. Baseline IDs `sm0001`–`sm0015`, 2 conversations, 15 unique messages, 6 quotes, and 81 receipt rows are intact; populated and empty class counts match the pre-M7 snapshot exactly.
- Inspection correction: an initial `jq` expression assumed `personas` was an object; it is an array. The corrected read-only query produced the per-persona conversation/message-copy inventory retained above.

## Qualification and browser correction attempts

- Required-runtime requalification attempt 1: `snapback2 check` and TypeScript passed under Node 24.18.0, but authored journeys failed because the first M7 expiry test advanced the shared test clock and caused digest rows to appear in the later digest journey. Retained log: `../logs/m7-node24-requalification-1.log`.
- Required-runtime requalification attempt 2: moved expiry into its own journey after the digest scenario; check, TypeScript, and all authored journeys passed. Retained log: `../logs/m7-node24-requalification-2.log`.
- Final authored journeys cover group-only poll creation and bounds, one changeable vote, identical set-state retry idempotence, visible-count increment for a poll and a text, tombstone decrement, and scheduled expiry decrement.
- M7 suite attempt 1 passed and produced `artifacts/suite-m7-1788885663.json`. This result was later superseded by UI/browser corrections.
- The first export command was malformed before Expo launched; its private directory was retained. The corrected initial export passed in a fresh private directory (`../logs/m7-export-1.log`). Two malformed static-server commands were also retained in this narrative; neither started a listener. The owned static server then started on only port 53135.
- Setup inspection correction: one probe omitted the required environment and observed host Node 26 while also using a wrong schema path. The authoritative setup identity was then generated and validated under Node 24.18.0. A `--help` invocation emitted the frozen runner's expected setup refusal because no lane-run ID was provided; it was not treated as choreography evidence.
- Frozen choreography attempt 1 failed before segment execution: both browser contexts did not expose `sm-auth-email` within 30 seconds. Its empty JSONL/observation files are retained. A two-context diagnostic reproduced both tabs stuck on `Restoring Clique…`.
- Browser correction: `components/ClientProvider.web.tsx` used one IndexedDB prefix for all tabs. It now creates a stable session-tab ID and a separate durable prefix per tab. Two simultaneous fresh contexts then both reached sign-in.
- A command-entry attempt for suite attempt 2 used the invalid flag `--milVILLE`; the failure is retained in `../logs/m7-suite-attempt-2-malformed.log`.
- Suite attempt 3 ran correctly but failed the M7 count assertion because prior commissioned regression fixtures had increased the starter DM count from 6 to 12. Its prior-green regressions all still ran and passed. The acceptance check was corrected to preserve and locate the immutable starter IDs from the beginning of offline history, require non-regressing count floors, and test exact forward deltas in an isolated conversation. This does not replace the exact pre-fixture backfill proof from the canonical post-migration snapshot and first suite.
- Suite attempt 4 passed after that retry-safe assertion correction. A malformed export-directory setup attempt with a mistyped PATH failed before creating the intended directory; the next private-directory export passed (`../logs/m7-export-2.log`).
- Frozen choreography attempt 2 reached the application but failed both required assertions because this React Native Web renderer did not emit the frozen kit's `accessibilityValue` as a semantic DOM attribute. A direct Chromium inspection showed the two options and tallies but no `aria-valuetext`/`data-value`.
- Semantic correction: the app-side `SemanticContractBridge` now attaches stable option IDs, integer tally/total values, selected state, and pending state to the unchanged frozen poll kit. A real browser inspection verified `m7-option-a`, `m7-option-b`, tally `0`, and total `0` before rerunning qualification.
- Suite attempt 5 and a fresh isolated export passed. Frozen choreography attempt 3 again failed during intermittent pre-login hydration; its empty files are retained. A following two-context diagnostic reached sign-in in both unique tab namespaces.
- Several command-entry errors were retained rather than hidden: a malformed tool expression that launched no command, an `envFly` typo that launched no qualification process, a temporary PATH typo that made `rg`/`head` unavailable, a failed `apply_patch` context match that changed no file, and frozen attempt 4's accidental extra `anybody` argument (structured setup refusal, no receipt writer created).
- Frozen choreography attempt 5 passed all three live-tally attempts, then failed the offline assertion only at the final “pending cleared” observation. The tally itself reconciled. Installed `snapback2@0.0.19` documentation explains that `useOutbox().entries` retains settled ledger entries until dismissal, while `useMutation(...).pending` contains only queued intents.
- Final correction: poll pending state now derives from `useMutation(api.polls.setVote).pending`. Suite attempt 6 then passed check, TypeScript, authored journeys, M7 feature acceptance, exact six-ID coverage validation, and regressions for M1, M2, M4, M5, M6, and M8. Receipt: `artifacts/suite-m7-1788887554.json`, SHA-256 `2584f8a79fafb94b450527912c168f2e4484b8e7f5472908d483049619fccad4`.
- Final export 4 passed in private temp directory `m7-expo-export-5.sTHiLK`. Before navigation, its bundle was verified to contain only `http://127.0.0.1:53134`; endpoint evidence is `../evidence/m7-export-4-endpoint-check.json`. Entry SHA-256: `3a2223f33d2ce7bdb22da388e630a4cc1dd9b730b76349ff1e6ab6406edb159d`.
- Frozen choreography attempt 6 passed `m7-a02-live-poll-tallies` in all three retained live attempts (click-to-observer-tally: 168.4 ms, 168.1 ms, 170.8 ms) and `m7-a05-offline-vote-reconciles` in its sole attempt. Segment receipt: `../evidence/m7-choreography-attempt-6.jsonl`, SHA-256 `ce469977719e3ce4bb5f38b4a9e6dfac058db8537a2300e36f6ea32dda011e0c`.

## Clock and claim boundary

- First final-source hash-bound green boundary: epoch `1788887679`.
- Authoring elapsed from the supervisor origin: `4542.60058` seconds.
- Fixed authoring cap: `14,400` seconds; it was not replaced by elapsed time.
- Authoring stopped at the green boundary. Subsequent work is verification, evidence consolidation, and reporting.
- This is an M7 diagnostic continuation. It does not repair or relabel M3, does not claim native M6/M8 proof, does not claim an independent coverage assessment, and does not claim a protocol-conforming full run or calibrated benchmark score.
- Post-clock verification attempt 1 detected three manually transcribed digest mismatches in the narrative/run record (suite, choreography, and observation hashes). The underlying retained files and frozen segment binding were unchanged. The record was corrected to the machine-computed digests and verification was repeated.
- Post-clock verification attempt 2 detected the same kind of manual transcription error in the suite-status digest field. The retained suite-status file was unchanged; its machine-computed digest replaced the narrative typo before the final verification.
- Final post-clock verification completed at epoch `1788888783`: all 21 recorded artifact digests matched, all required JSON parsed, and the assigned backend/web listeners remained available.
