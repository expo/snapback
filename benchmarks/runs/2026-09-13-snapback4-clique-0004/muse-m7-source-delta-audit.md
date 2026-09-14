# Muse M7 source-delta audit

Audit date: 2026-09-14  
Scope: final static source in `lanes/muse-snapback4` compared with the completed continuous-builder archive in `snapshots/muse-continuous/source-snapshot.tar.gz`. I ran no product tests, builds, browser probes, or backend probes; did not read private model reasoning; and did not modify the builder lane.

## Baseline, selection, and lifecycle

The pre-M7 archive is SHA-256 `446d1072677631db4de474326d0e2864340c7d0d2dbc6378df88dfac1fc7451c` (3,479,123 bytes), with 195 source files and inventory SHA-256 `2058d8259365e280fefb4d45e25275441078b75f15d1a43f7ac04c954ed0b950`. Its snapshot manifest is SHA-256 `b21980770054a865c85080ee5cda679c872b8d9809f063ad7166f6a2f07be1c1`; the separate pre-M7 grading custody manifest is SHA-256 `2dd6248c8c2493cbb4357b7c89d57a72749134a0ff3f770262fb7092f48eb334`.

The frozen capture helper, `observed-milestones/helpers/capture-builder-base-bdb0acbe.py` (SHA-256 `bdb0acbeef445664e300a5b75b0e27c7d1fbd87db50d5f79901c75b5f608ab5c`), excludes `.snapback4` and names beginning `.snapback4-`, but not the final lane's `.snapback4.pre-m7-keep`. That directory contains 78 regular files, 75 of which the helper would otherwise classify as source. I excluded the entire directory without reading its contents. Applying the helper's remaining exclusions yields 205 final files, source-inventory-form digest `faf3615e4fb0f5bc491a91fda4856f12bf4f27df646ff7d21eae5ca898ef94ba`, with 10 additions, eight changes, and no removals. Any final curator must preserve this explicit exclusion.

The added product/verification files are `lib/json-schema.mjs`, three metering files, five M7/support scripts, and `tests/m7.mjs`. The changed files are `API.md`, `app-host/clique/src-api.ts`, `app-host/clique/src/components/ConversationView.tsx`, `choreo/setup-identity.mjs`, `snapback/generated/api.ts`, `snapback/schema.q`, `tests/accept.mjs`, and `transcript.json`. Key source hashes are:

| File | Pre-M7 SHA-256 | Final SHA-256 |
|---|---|---|
| `snapback/schema.q` | `e2d9f902b1385a7f4cc3c3dac9abf648f04ffa15f51467b956e31797a511a01a` | `b2604e84346b5a121ca47ce39d7d8b3071c2a53b6005fce32950eb191246bbce` |
| `ConversationView.tsx` | `9352099279721924a4ffa72af51e98adfef435542fb334408a548bf4930d969e` | `93c8553f0be10954fe89809fa864943a99ac33cc584f6ad037e00df667a01792` |
| `app-host/clique/src-api.ts` | `513ffd018af44b9b27a17c41f6c1a9b0df75f2ceef51a0e1fa236fcb0ef0a4d9` | `d56e394f997e3cee30ca3b5feef6d7bd46631d7f669c41ffe38f3e8d791afa4c` |
| `tests/accept.mjs` | `911373b851b47ff04d998448b43dacbd7f65a94d2a03289acbf21772124a380f` | `1a127b05f9885b7c72ca5d6365b743a305ac907b9e948b1c62f18b8feb0b7b25` |
| `tests/m7.mjs` | absent | `dd627da7d5838339561e80ecbec940bf7e6f6bb7f6f7bb8294a2b75ddd3aeb8f` |
| `coverage/m7.json` | excluded evidence | `976610ce9a391596e02d058cdac1802c9d0ec2394de454f7eb8b122d9eb43b2a` |

The actual runner lifecycle is `logs/muse-snapback4.m7.start.json` SHA-256 `8d8898354286d9a70f3a1454381db90b2a6948b41ad5126f9257d00b5f6ade37` through `logs/muse-snapback4.m7.end.json` SHA-256 `f8129bfedb2d71622f689a1183d595eb0ddd6917b20707ef8a7f22d38318849a`: PID 11190, exit 0, 2026-09-14 08:54:00Z–10:41:15Z, 6,434.294 seconds. The builder's `m7/run-log.md` records 6,391 seconds, so the runner receipt is the authoritative wall clock.

## Schema adoption and message counts

The pre-M7 schema already maintained raw `messageCounts` by `chatId` (`snapback/schema.q:199-200`). M7 changed `inbox` and `chatDetail` to subtract a new maintained `tombstoneCounts` ledger (`:428-434,984-1007`), and `deleteMessage` now writes one ledger row with the message's `expiresAt` (`:903-914`). This is an efficient forward path: new messages and polls increment the existing maintained count; new tombstones subtract exactly once through a unique-by-message ledger.

The implementation is correct for the mandated fresh M1–M3 starter corpus, which contains no pre-M7 tombstones. It is not a general historical-tombstone backfill. There is no migration or job that inserts ledger rows for messages already tombstoned before adoption; a nonexpiring historical tombstone would therefore remain counted indefinitely. The schema comment acknowledges the narrower premise as “Backfilled trivially: no tombstones pre-M7” (`:984-1004`). The suite checks the known starter DM/group counts, a new ordinary message, a new poll, a newly deleted nonexpiring message, and one expiring ordinary message (`tests/m7.mjs:168-210`); it does not exercise a pre-adoption tombstone.

The final report's physical-sweep attribution is wrong. It says expired rows stop counting “at the engine sweep” and claims up to one second of skew while the message and tombstone-ledger sweeps interleave (`m7/final-report.md:31-38,123-126`). Published Snapback 4 0.2.6 recomputes maintained groups with expiring sources at the query clock, excludes logically expired source rows, and returns `nextExpiry`; both `messageCounts` and `tombstoneCounts` therefore drop at the shared logical deadline on server and device reads, independent of later physical cleanup. The source proof and client-arm details are retained in `observed-milestones/m7-expiry-attribution-addendum.md` (SHA-256 `8a3dda2402edeb71987f18b6c853a5f27913e95806210c19a535c39114925e2b`, especially lines 13–36). The M7 test polls every ten seconds and labels the result “after the sweep” (`tests/m7.mjs:177-190`), so its pass establishes eventual exclusion but cannot identify the mechanism or a one-second boundary. There is no separate app-specific count skew in the tombstone-ledger design because both expiring source rows carry the same deadline.

## Poll model, visibility, and bounds

The core poll shape is coherent. Polls are group-only ordinary text messages with a 200-character question, two required and up to two optional 50-character options, unique option IDs, one upserted vote per message/principal, maintained per-option tallies and totals, and member-only read/write rules (`snapback/schema.q:1009-1069,1080-1133`). `editMessage` refuses polls (`:891-901`). Generated API types match the checked-in app API byte-for-byte and include all four operations.

There is one material source defect: poll metadata does not follow its message's deletion or expiry. `polls`, `pollOptions`, and `pollVotes` have neither `expiresAt` nor a deletion/retraction path (`:1014-1060`). `deleteMessage` clears the message body but leaves the poll question, labels, tallies, and caller vote intact (`:903-914`). `pollOf` does not reject a tombstoned message, and `threadPolls` reads poll rows directly without joining or filtering the live message (`:1071-1078`). Thus a member can still receive deleted poll content through either query; after logical message expiry, `threadPolls` still returns the orphan. This contradicts the final report's statement that polls “expire, and tombstone, like any message” (`m7/final-report.md:21-30`). The UI happens to suppress the card by joining poll data to its live message list (`ConversationView.tsx:44-52,898-955`), but that is presentation filtering rather than data-layer revocation.

The same orphaning combines with an unpageable bound: `threadPolls` returns the first 100 rows by `byChat` and exposes no cursor (`schema.q:1019-1020,1076-1078`). Once a group has more than 100 retained poll rows, later polls can be omitted; deleted and expired orphans permanently consume the prefix. The suite only checks that one poll appears and never exercises deletion/expiry through either poll query or the 100-row boundary (`tests/m7.mjs:65-107`). This is a high-confidence application-schema defect, not a Snapback 0.2.6 engine attribution.

Vote mutation correctness rests on set-state upsert plus ordered device delivery and transport-envelope replay. The schema stores the optional `mutId` but never branches on it (`schema.q:1121-1133`). The suite verifies exact-envelope replay and a second envelope carrying the same semantic `mutId`, both against the same option (`tests/m7.mjs:160-166`); it does not test delayed out-of-order semantic retries after a newer choice. I did not establish such reordering in the published client and therefore treat this as a proof limit, not a reproduced defect.

## Offline, reconnect, UI, and native

The final UI uses the shared frozen `PollCompose` and `PollDisplay` components on web and native. It trims and compacts blank options, submits two to four stable IDs, hides the ordinary message text when a poll card renders, and maps option state/tallies to the kit (`ConversationView.tsx:283-319,576-605,898-955`). The frozen kit files are byte-identical to pre-M7: `PollCompose.tsx` SHA-256 `5a143045095ae1bae8e640317799fbbed49db436594a0dd72226b9620f525054`; `PollDisplay.tsx` SHA-256 `bb5dfffb85a55184a5b9e1aafdd611c8b64eb94500015bf63a5f33f4d07fc4ec`.

Offline voting uses the Snapback local outbox for durable delivery and an app-local intent for immediate busy state. The first post-suite correction adds a synchronous intent plus reconnect retry; the second keeps the option busy from the device's `mine.pending` state until confirmation (`ConversationView.tsx:104-140,160-281,901-912`). This is structurally consistent with the local-client contract: once a write is accepted into the outbox, the device owns retry, while the app retries only a transport throw that did not become a quiet queued write. The in-memory intent is not itself durable, but the predicted vote row and its pending flag are in the device store, so restart rendering can recover the busy state.

The retained choreography gives useful but bounded support. `m7-a05-offline-vote-reconciles` passed its sole attempt in 1,696.5 ms. `m7-a02-live-poll-tallies` passed attempts 1 and 2 in 568.2 and 616.2 ms, while attempt 3 timed out after 10,384.8 ms with “other-client poll tally did not become observable” and outcome class `application`. The best-of-three aggregate is green, but the receipt does not support uniform live reliability. Receipt SHA-256: `m7/choreo-receipts.jsonl` `03f53e49d10685f98eb7a8f5d5fd84d2679122b49107a7d0a57bf101010e6220`.

The final `ConversationView.tsx` edit has mtime epoch 1789382252, while the retained iOS Hermes bundle has mtime epoch 1789382349. The bundle is `entry-ae6af08f792727e483a95577ebbb51e2.hbc`, 2,805,530 bytes, SHA-256 `1893bec10e4b1992bca075eb6078dd4c1e19258fbc580f1b08dbaa3a037ce3f6`. This chronology is consistent with an export after the final source edit, but it does not cryptographically bind that source to the bundle or establish native runtime behavior; there is no M7 simulator proof.

## Acceptance mapping and evidence chronology

`tests/accept.mjs` adds M7 selection without changing any inherited milestone implementation. The nine inherited test files `tests/m1.mjs`, `m2.mjs`, `m3.mjs`, `m4.mjs`, `m5.mjs`, `m-live.mjs`, `m6.mjs`, `m8.mjs`, and `helpers.mjs` are byte-identical to the 195-file pre-M7 archive. The coverage manifest maps poll creation/validation, tallies/change, same-state replay, counts, settings, and UI vote to the 31-check M7 suite; it delegates live/offline assertions to choreography, snapshot preservation to the grader, and inherited behavior to the full suite.

The suite evidence is real but stale relative to the final offline source:

- M7 suite: 31/31, `m7/accept-m7.log` SHA-256 `e649e519fac247dd54b69e6bb2f1a156417274a58cb91cdee02f8c26230981e4`, recorded at run-log epoch 1789377300.
- Full regression: 160/160, `m7/regression-final.log` SHA-256 `541860a8fbacfe1fb72722cd58be65882e377b4d12e97f9ee2d8afb5d237c01b`, completed at epoch 1789381735.
- Offline intent correction: epoch 1789381970.
- Device-pending correction: epoch 1789382284.
- Choreography green: epoch 1789382315.

Therefore neither 31/31 nor 160/160 qualifies the final `ConversationView.tsx`; choreography covers only the two M7 cross-client assertions after those edits. The final coverage manifest continues to cite the old suite hash through `suite-status.json` (SHA-256 `629b34ef344aaa7c9dd4cb5465eb25d8440387125777fd44ac276c9d88a089f0`). The inherited suites were unchanged, but any claim that the final source itself passed 160/160 is unsupported.

The snapshot evidence also has a reproducibility break. The original baseline was captured before the schema change and an initial `checked=48 diffs=0` was recorded. A probe then polluted the store; the builder wiped/reseeded it and replaced `m7/pre-snapshot` after adoption. The canonical final manifest (`9c3255b78410b2b236aed481fd0a31edfb388617ea19367ada4904ff306d4d99`, export epoch 1789376740002) is the replacement, not the original baseline (`9f2061832810e0c9f87f4d73f4ecbee5c33e0524d6871977323f175e9f0104da`). The later post-choreography 48/0 entry is a logged builder claim about the replacement state; no retained post-comparison persona payload or structured result makes it independently recomputable. The external custody record `observed-milestones/muse-m7-snapshot-replacement-provisional.md` (SHA-256 `15fa6f624e8c8ca4e92ce9483d5006b1e0c8013468530ca738c13c2c1cb9d275`) retains the exact sequence and explains why the first migration comparison cannot be recomputed from the final lane. This is an evidence defect; it does not itself prove data loss.

## Pins and conclusion

Dependency manifests and lockfiles are byte-identical to the pre-M7 archive. The manifests use ranges `snapback4: ^0.2.6` and `snapback4-expo: ^0.2.1`; the unchanged lockfiles resolve exactly `snapback4@0.2.6` and `snapback4-expo@0.2.1`, and the installed packages report those versions. Root/app manifest SHA-256 values are `9ce636cda83d05472d66503e298b6ea71dff49f96e26494bea18a2496214af53` and `f2fff600bfbe2b5e9b1c740b3bc90cbdb76f300605f2d6ca92b15f10949d9f77`; lockfile SHA-256 values are `5707103c6a705ee99a902bbf8b78fcadce9c022281edd2a6251bbcb6b3e77402` and `65d7a5ba28d157b22d7105161207a03ebb121ccce48db8830cbe681cb3f2a659`.

The final source implements the principal M7 path and is strong on group authorization, option bounds, maintained tallies, set-state voting, starter-corpus counts, shared web/native rendering, and the observed offline choreography. The material source defect is poll metadata/query lifetime and the unpageable 100-row poll list. The migration claim is valid for the specified tombstone-free starter corpus but does not backfill historical tombstones in a general deployed store. The final source lacks a post-correction suite run, and the preserved snapshot can no longer independently reproduce the first migration comparison.
