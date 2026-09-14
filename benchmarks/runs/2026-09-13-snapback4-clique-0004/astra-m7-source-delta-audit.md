# Astra M7 source-delta audit

Audit date: 2026-09-14

Scope: read-only static comparison of the completed Astra M7 lane at `lanes/astra-snapback4` with the retained pre-M7 builder source snapshot. I did not run tests or probes, inspect private reasoning, read the admitted broad-process output, or modify the builder lane. This is a source/custody audit, not an audit of grading methodology.

## Compared baseline and exact delta

The pre-M7 baseline is `snapshots/astra-continuous/source-snapshot.tar.gz` (archive root `astra-snapback4`, SHA-256 `1bc93672de7b66cb05bfa54c4f80805429d7c9c5c2c96b21a1cc1835c3d5e694`, 1,608,793 bytes). Its 261-file inventory is `snapshots/astra-continuous/source-inventory.sha256` (SHA-256 `181788eeb85c48f3092072229e590a21c6dbaf8e05d4397484cc4413f535387d`). `snapshots/astra-continuous/snapshot-manifest.json` (SHA-256 `026ffd67685d418192d8ca698819e78b08a1b715db7ca4b4a602a0aa6dbc2123`) defines the exclusions and records both hashes. The later custody record `snapshots/astra-grading-pre-m7/capture-manifest.json` (SHA-256 `dd964a4ca7a17004066bc8d806807eb7f84569d46e5005b276a4d7581ac35731`) independently repeats the archive and inventory identities.

Applying that same selection policy and inventory format to the final lane yields 263 files and an independently derived inventory digest `ad0de9f3c3d77f1a61fef74fed91a8f649af0970274315fa8625aabdb3e5bdbb`: two additions, seven changes, and no removals.

| Path | Pre-M7 SHA-256 | Final SHA-256 | Disposition |
|---|---|---|---|
| `scripts/acceptance-m7.mjs` | absent | `76fdac5770f7e024b1a9582567e2cec7ce81f4883519bae385c54737e83f9d1c` | added |
| `snapback/polls.q` | absent | `bf468d4d438cca28980e311f17ba1be18fe5bbe887630c4823e97edfd536b909` | added |
| `API.md` | `367d6693324044c0aafc6bbdf77388ccdf9c0a2869e683efc8a498971fec2dd6` | `c22db4bae658186af67eaddc481473bb22cc5a14402f9b831b19472af3a188ee` | changed |
| `README.md` | `4ff819464b2c194242de81837b339105316e2d6111cc63b7ad2c2d2a6d6a88b9` | `6f8885976a54e89284bd0fc0030296110eeb3d1cba2904f4eaf545350a29903f` | changed |
| `lib/chat.tsx` | `66bad017f360135bdfe49440df74350152af2c15eafce3ae3691033b23dbf319` | `6da9a2ff122c0d26d9a588f69b5d6df2ab0a0644b7ada3fff69f6a76c7c0f456` | changed |
| `snapback/chat.q` | `9829b3fdfbdfd9915b2d5d8a7e8e944505dbbef4d135c2a5d81fdd39f99d0df1` | `f73bcc2c01343434835f9d2ee7fa5afc988bd1421b9735e05d3fd34ea15ec7a1` | changed |
| `snapback/custom.q` | `3b16ce3e14f4cba863d9d6cfc9325a020d0bdbefa3364f541db08dbcce92f1d5` | `2507fa9a18f69f1803d02823569d961d64634196f632bf5fa559e0f3f24a9636` | changed |
| `snapback/generated/api.ts` | `c86faafb76b7e089b6e99de5f5e88b90e18e2d21d9b426e97a1ab2dece349f35` | `ca4945d6bb9b4864a47d95b5bd4d62e58fd76376121de5d6a5fdf61dae04be42` | changed/generated |
| `snapback/schema.q` | `980071277ef45ca9041a47afbe30b9868d775e4c972d343990972aff2c4ae139` | `b869e9c791847b402c50c9ad16b1ced1fba4a5ec9843451ffc48e0004417422c` | changed |

The pre-M7 copies under `m7/pre-schema` and deployment release 1 byte-match every pre-M7 canonical `.q` file. Thus the comparison starts from the actual inherited builder source, rather than a reconstructed approximation.

## Migration and deployment lineage

The staged source supports the reported optional-to-required migration:

- Release 2 adds `messages.visibleWeight: int ?`, `pollOptions`, the poll-vote table, writes `visibleWeight: 1` on every text/media/poll insertion, writes `0` on tombstoning, and includes the idempotent backfill job (`m7/deployment/releases/2/snapback/chat.q:55-56,160,209,258,305-307`; `polls.q:1-38`).
- Release 3 retains the nullable field and moves the job to the root module with `schedule migrateMessageCounts every 1m: backfillMessageCounts` (`m7/deployment/releases/3/snapback/schema.q:298-301`). The retained backend diagnostic reports one chunk and 15 rows written; it actually records two idempotent schedule firings, each processing the same 15 starter rows (`m7/backend-backfill-root.log`, SHA-256 `818f00c9207c1ee8302ba976d910ce22a33c9cdb7e9c48073e04291a70dc3104`).
- Release 4 makes `visibleWeight` required, removes the temporary schedule, and adds `maintain visibleMessageCounts: sum messages of visibleWeight by conversationId` (`m7/deployment/releases/4/snapback/chat.q:55,98,101,306-307`; `schema.q:298-300`). The preflight refusal identifies exactly the nullable-to-required change and aggregate rebuild (`m7/deploy-contract.log`, SHA-256 `c53640a14ba3fe52f3fe8e859691dfe47851f6f27e040c919c37b0c720854445`).
- A public `command_execution` completion event (`logs/astra-snapback4.m7.ndjson`, event `item_37`, line 72, event SHA-256 `1a3042d26f1d8186ea6f42d2bf1659a955bb577568b28f0d05dbe66d44acf355`) contains the actual authorization invocation `npx snapback4 deploy m7/deployment --allow-destructive`. The surrounding chained command later exited 1, but `m7/deploy-final.log` (SHA-256 `d21160b826d5cae6526b3cdf99ad1ae892fc55dde1fd58513e06f35d13a06f42`) records release 4 as current, so the authorized deploy itself completed. No credential-bearing command or unrelated process text is reproduced here.
- Release 5 adds the missing `editCaption` poll immutability guard; `m7/deployment/current` contains `5` (SHA-256 `f0b5c2c2211c8d67ed15e75e656c7862d086e9245420892a7de62cd9ec582a06`). The final canonical and release-5 sets each contain the same eleven `.q` files with identical per-file bytes and inventory digest `4a39410f2d867975874290b2c8e9649cba940e15c4ca2560e3df726098b9b10f`.

The final backfill remains safe to rerun: it maps tombstones to zero and every other surviving message to one (`snapback/schema.q:298-300`). The migration verification reports exact 6-message DM and 9-message group counts for every authorized persona/conversation pair (`m7/migration-verification.json`, SHA-256 `0c42eda1c70dd1e9c3a1ebbe81240d306543de6a9847fb33ab22dc31ef127f13`). The pre/post snapshot code compares the fixed M6 fields, reactions, media descriptors, receipts, public rows, and accessible asset bytes (`m7/snapshot.mjs:6-17`; `m7/compare.mjs:4-10`); its retained result is green for all eight personas (`m7/snapshot-comparison.json`, SHA-256 `f0e21936c88290860eb6f995cc8284c10012bf5c8dd07eaa83703619e7a2dea4`). This supports preservation for the starter fixture. It does not demonstrate populated message reactions, message media, or non-default receipt states because the fixture did not contain them, a limit the builder report states.

## Poll, offline, edit, and count semantics

The source implements one changeable vote per user with a unique `(messageId, principal)` key and a set-state `upsert`; option bounds are checked against the immutable option array (`snapback/polls.q:1-15,32-39`). Reusing the same mutation envelope ID replays without changing a later vote, while a new ID sets the current choice; the focused acceptance covers both paths (`scripts/acceptance-m7.mjs:37-44`). Membership guards apply to poll creation, voting, table reads, and sync audiences (`snapback/polls.q:11-15,22-29,32-38`).

The React path calls the normal Snapback mutation client, so an offline vote enters the same durable outbox; the locally predicted `pollVotes` row drives `mine` and `pending` while live-query updates drive tallies (`lib/chat.tsx:158-175`). The unchanged M7 choreography explicitly observes pending while offline, reconnect settlement, and a second member's tally (`choreography/choreography.mjs:2423-2533`, SHA-256 `cc600295f80d40b89910a1bf01eb3c7d8b9c24625c9741035ca3844f80418fcc`).

Poll question/options are server-immutable through both legacy text edit entry points, and the UI hides Edit for poll messages (`snapback/chat.q:238-253`; `lib/chat.tsx:293-316`). Delete changes the contribution to zero and clears poll options; expired rows contribute until the engine's documented sweep removes the row. Text, media, and poll creation all write one; tombstones write zero; the maintained sum is member-readable and is exposed in both inbox and conversation reads (`snapback/chat.q:97-101,152-160,198-209,255-259,307-308`; `snapback/polls.q:22-30`). The final count test covers text, media, poll, tombstone, and eventual expiry changes plus the settings rendering (`scripts/acceptance-m7.mjs:46-55`).

## Regression and pin/source custody

The canonical `scripts/acceptance-m1.mjs` through `acceptance-m6.mjs` and `acceptance-m8.mjs` are byte-identical to the pre-M7 archive. Their respective SHA-256 values are `7a38b5fbd2b0a69efcccebda7cc78d2bf9ead492d6c7468477fa7542c860d7f8`, `84e485d00163bcaa68f0ad6474c04c2105c650a12a9e3ce05e85d99ae7740792`, `eea3dbbb671f66fe35c7d4d2b57073a338bec0627b1fae0a6e5ea26d978fa9e1`, `41d67f27478c3d6566b2cfaf49f3453437d9d7bae24e69a4a589e5a42dbdee61`, `2864fc0b35384762998846e767371baeafb2252190755748f30ca86b2cbe232e`, `88b57fea34630ffc3ea99471ad009f70895a93d97ec38d80b18cc8c312b171cf`, and `e4f053f2acc8a71c8a3266a0e13aba6f31b392ad89e56be2448fbf10f4812c9b`; the unchanged generic dispatcher hashes to `b28ec6c7e4113d7c186fd06412d4a2dff487798a124272d3568fc2f454a7c929`. `m7/regressions.mjs:3-7` invokes those canonical suites rather than copied variants. The retained result records exit 0/pass for M1-M6 and M8 (`m7/regression-results.json`, SHA-256 `0999b9f073feae19918c162e8312bf3f8805ef62fba02237db369eb038b69e57`). This audit confirms unchanged source and receipt structure, not runtime truth, because no suite was rerun.

`package.json` and `package-lock.json` are unchanged from pre-M7 (SHA-256 `2a5b4f0e86c8d29d7ae73f5886687bca08184681ee11db5595c701ff330670ca` and `0a2c0efac1aee054c8edc1c75c52cbc2605f3badfcab937fdf178d2035136f67`). Both declare exact `snapback4@0.2.6` and `snapback4-expo@0.2.1`; installed package metadata reports those versions. The final generated API statically contains the new row fields, `messageCount` results, and `polls.votes/create/vote` operations (`snapback/generated/api.ts:171-185,314-366,423-430`) and hashes to `ca4945d6bb9b4864a47d95b5bd4d62e58fd76376121de5d6a5fdf61dae04be42`.

`m7/evidence-hashes.json` itself hashes to `594c686a4056aed54f04a7eb1ef04ca6c352c4ddf1c38690a079c95bef3f87c2`; every one of its 13 listed files currently matches its recorded byte count and digest, including the final `.q` sources, UI integration, suite/choreography receipts, snapshots, and the iOS Hermes artifact (`7095e4ca…`, 2,794,166 bytes). Its phrase “bind the delivered source” is slightly broader than its contents: it omits the changed `API.md`, `README.md`, and `snapback/generated/api.ts`, plus the unchanged package pin files. The exact full source delta and those hashes are supplied above.

## Findings and limits

No material source-level defect was found in the migration, server poll semantics, idempotency, offline prediction path, edit immutability, or message-count maintenance. The source and retained receipts support the claimed M7 behavior within the starter-scale and fixture-population limits above.

Two bounded app/UI issues remain, neither invalidating the protocol or the covered acceptance paths:

1. The supplied frozen UI-kit `PollCompose` enables submission when at least two options are nonblank but sends the entire option array (`ui/src/PollCompose.tsx:49-51,66-108`). After adding a third or fourth input and leaving it blank, the button is enabled once two options are filled, then the server correctly refuses the empty element under `[text 1..50]`. `ui/src/PollCompose.tsx` byte-matches the pre-M7 archive and final lane at SHA-256 `5a143045095ae1bae8e640317799fbbed49db436594a0dd72226b9620f525054` (also recorded in the pre-M7 snapshot manifest), so this behavior came from the provided kit and was merely exposed by Astra's new M7 integration; it is not freshly authored model app logic. The kit or integration should require every rendered option to be nonblank or omit blank optional rows before submission.
2. Astra's newly changed `lib/chat.tsx` passes a poll question as ordinary `MessageBubble.text` and again as `PollDisplay.question` (`lib/chat.tsx:258-293,165-170`), while `MessageBubble` renders nonempty text (`ui/src/MessageBubble.tsx:192-201`). The question therefore appears twice in the conversation. This is a presentation defect in the M7 app integration, not a data or synchronization defect.

Poll creation does not emit the push `notify` effect that text/media sends emit (`snapback/polls.q:22-30` versus `snapback/chat.q:161-165,210-214`). The M7 contract and `API.md` do not promise poll push notifications, so this is an explicit scope limitation rather than a validated protocol defect.
