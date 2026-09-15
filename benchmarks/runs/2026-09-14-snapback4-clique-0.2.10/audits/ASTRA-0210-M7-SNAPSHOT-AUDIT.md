# Astra 0.2.10 M7 snapshot audit — preliminary

Orchestrator evidence audit, not a blind review, grade, or author ruling. This first leg covers snapshot chronology, retained inputs, the exporter’s M6 coverage, and the count migration. It makes no final M7 outcome or post-M7 independent-grade claim. No requests, runtime reproductions, store reads, process operations, or lane/source changes were performed for this audit.

## Evidence boundary and chronology

Packet root `P = /Users/ccheever/clique-sb4-20260913-relaxed-3models`; lane `L = P/lanes/astra-snapback4`; observer `O = /Users/ccheever/projects/snapback-lanebriefs/cell-custody-0.2.10/astra/m7-observer`. Paths below are relative to these roots unless linked otherwise.

The fixed observation cut is the first **372 lines** of [events.jsonl](cell-custody-0.2.10/astra/m7-observer/events.jsonl), ending `2026-09-15T01:32:04.355656Z`; SHA-256 of those exact newline-preserving bytes is `8e0bc00d7a91723d85a589be7bed27963cd3583fc1d7bd2e1f5b592c23418602`. The file itself remains append-only and may now be longer. Observer `start.json` records a two-second polling interval and `phaseAlreadyStarted: false` at 00:51:39.740591. It retains stable parseable safe JSON objects by content hash and source hash manifests, not source contents or continuous write history. No later phase status was polled for this report.

| UTC on 2026-09-15 | Evidence | Interpretation |
|---|---|---|
| 00:51:39.741049 | Event 85, source manifest `4d48c1b8419826ff70276af4dd1b35bb20215b4623af998b0f8e686a6d9b9af8.json` | Initial selected 144-source baseline; selection does not include `API.md`. |
| 00:52:06 | Parent-supplied M7 start time | Session begins before the snapshot. |
| 00:52:17.485942 | Source manifest change adds `m7/run-log.md` | Mandated session log, not the first application edit. |
| 00:52:55.814807 | Event 97, manifest `9915e8920fa5e19e6098b7d95f879e985f849fcd22fbbe6c1a4ad37b56f341c0.json` | All 11 `m7/pre-schema/*.q` copies match the original lane schema. Existing application source remains unchanged. |
| 00:53:48.774 / 00:53:50.306250 | Original pre-snapshot manifest timestamp / event 111 observation | Eight persona snapshots retained; event 112 source manifest `72aaf521200b9f52c71e64e687f956e6d216e3b3ef233d445975c3dc88f0f59b.json` still has original application hashes. |
| 00:55:09.080278 | Event 114, manifest `e9fbb978ca845ab94423a29cc92d821d84bde5e7cd75d9f17e0f8a40a9b53138.json` | First observed application schema edits: `chat.q` and `media.q` change; `counts.q` and `polls.q` appear. |
| 00:56:09.683643 | Event 119, `m7/evidence/backfill.json` | Received `counts.backfill`: one chunk, 15 rows written, `state: done`. |
| 00:56:47.632 / 00:56:48.054774 | Post-migration timestamp / event 132 | Actual first post inputs are retained. |
| 00:57:07.745 / 00:57:08.281272 | First comparison timestamp / event 135 | Received pass for five persona/conversation checks. |
| 01:09:52.340 / 01:09:53.011420 | Pre-correction timestamp / event 207 | A separate, richer baseline after intervening application activity. |
| 01:12:14.894574 | Event 234, `backfill-latest.json` | Later backfill receipt: one chunk, 64 rows written, done. This is not a 64-distinct-message count. |
| 01:12:29.138 / 01:12:31.101872 | Post-correction timestamp / event 250 | Separate correction witness retained. Comparison at 01:12:29.368, event 240, receives pass for 21 persona/conversation checks. |

The original pre-snapshot precedes the first **observed application** edit by about 79 seconds. A two-second passive poll cannot exclude transient writes and restores between observations. The brief’s separate ordering mismatch remains: frozen `instrument/social-messenger.md` lines 670–678 and 713 require the snapshot **before the M7 session starts**, whereas `prompts/astra-snapback4.m7.md` line 9 directs the builder to create the fresh starter backend and export before changing the application; line 24 requires an immediate run log. Observed ordering supports the latter, not the former. This is a protocol qualification, separate from field coverage.

## Exact snapshot inputs

Each linked object below is the original safe JSON manifest; it names and hashes all eight persona objects in the same `O/objects/` directory. Each snapshot path had one unique version in the fixed observation cut. A final read-only check of these specifically named files found **all four current manifests and all 32 current persona files** matching the captured hashes.

| Snapshot directory under `L/m7` | Manifest SHA-256 / retained object |
|---|---|
| `pre-snapshot` | [bd04ae3b9b807c57a5fe76917b805eee28d7d31f5d8a4b2781b20bac075d005d](cell-custody-0.2.10/astra/m7-observer/objects/bd04ae3b9b807c57a5fe76917b805eee28d7d31f5d8a4b2781b20bac075d005d) |
| `post-migration-snapshot` | [c48df924552b0b955afc0abda3d8c54b4913ac9fde0f92216db006de8cf1fc68](cell-custody-0.2.10/astra/m7-observer/objects/c48df924552b0b955afc0abda3d8c54b4913ac9fde0f92216db006de8cf1fc68) |
| `pre-correction-snapshot` | [d9cadaa7ced61df061272d41eb243c71d2395b6bedf253743b08b911098c2d98](cell-custody-0.2.10/astra/m7-observer/objects/d9cadaa7ced61df061272d41eb243c71d2395b6bedf253743b08b911098c2d98) |
| `post-correction-snapshot` | [f5a49b101d1bdc21c5e2e294589509bab5a4a8e9e1ff06845834df2b67f6557b](cell-custody-0.2.10/astra/m7-observer/objects/f5a49b101d1bdc21c5e2e294589509bab5a4a8e9e1ff06845834df2b67f6557b) |

| Persona | Original pre / post: conversations, message projections | Correction pre / post: conversations, message projections |
|---|---:|---:|
| Alice | 2, 15 | 8, 44 |
| Bob | 2, 15 | 8, 44 |
| Carol | 1, 9 | 5, 29 |
| Dave | 0, 0 | 0, 0 |
| Erin | 0, 0 | 0, 0 |
| Frank | 0, 0 | 0, 0 |
| Grace | 0, 0 | 0, 0 |
| Henry | 0, 0 | 0, 0 |
| Total projections | **5, 39** | **21, 117** |

The original export has **15 distinct message IDs** in two distinct conversations: six in the Alice/Bob DM and nine in the starter group. The 39 records are viewer projections, not 39 physical messages. Fifteen distinct IDs plus the 15-write original backfill receipt support the stated 15 starter-row account; this audit did not independently count a database. The later export contains 44 distinct message IDs in eight distinct conversations. Five empty persona exports are present, authenticated-principal-bearing files, not missing files.

Recalculation from retained objects found no original pre/post message-field or asset-map changes and no extra conversations/messages. The three nonempty persona files differ only by the new conversation `messageCount` values (DM 6, group 9); the five empty persona files are byte-identical. All eight persona files are **byte-identical between the correction pair**, including their counts and richer states. Every original message ID is also present in the correction pair; among the 39 original projections, ten receipts changed between the original baseline and the later baseline, with other exported fields unchanged. The correction pair must therefore remain a separate witness, not replace the original baseline.

## M6 field and state coverage

`L/m7/snapshot.mjs` SHA-256 `26db79c0b2cd2493ac9920d87f5c8a10f8c61d0fc4ba0f3c772e59dc10ba8003` exports exactly these 17 message fields:

`id, conversationId, senderId, at, arrival, kind, text, photo, oncePhoto, video, edited, deleted, replyToId, reactions, receipt, expiresAt, viewed`.

It paginates `chat.inbox` and `chat.history` until `next` is absent, sorts IDs, and maps every selected value through `m[f] ?? null`. Thus it collapses missing fields and explicit nulls. It does not retain API completeness flags. It retains conversation objects but not every other inbox projection property.

| Exported state | Original pair: 39 projections | Correction pair: 117 projections | Coverage implication |
|---|---|---|---|
| Kind | 39 text | 99 text, 7 image, 2 video, 9 poll | Later distinct IDs: 37 text, 3 image, 1 video, 3 poll. |
| `photo` | 39 null | 2 populated, 115 null | One distinct regular-photo asset, projected to two viewers. |
| `oncePhoto` | 39 null | 5 populated, 112 null | References preserved; exporter does not fetch/hash once-photo bytes. |
| `video` | 39 null | 117 null | The sole distinct video message is deleted; no populated live-video witness. |
| `edited` / `deleted` | All false / all false | 2 true / 8 true | Adds edit and tombstone states to the later witness. |
| `replyToId` | 15 populated, 24 null | 18 populated, 99 null | Reply ID preservation; quoted message projection itself is omitted. |
| `reactions` | All empty arrays | All empty arrays | No populated reaction aggregate preservation witness. |
| `receipt` | 15 sent, 24 null | 14 read, 5 delivered, 25 sent, 73 null | Later witness covers additional per-viewer receipt states, not raw receipt rows. |
| `expiresAt` | All null | All null | No live expiry-field/boundary witness in either pair. |
| `viewed` | All false | 1 true, 116 false | Later witness includes one viewed projection. |

The exporter **omits `sender` and `quote`**, exposed in the M6 history contract (`L/API.md`, inherited history description) and already present in the original `m7/pre-schema/chat.q:113` `messageCard` shape. This is an **exporter coverage gap** against an all-fields preservation claim, not an invented post-M7 assertion disposition. The baseline source proves these were preexisting shape fields; the observer’s initial source selection did not hash `API.md`. Current inspected `API.md` SHA is `12e0d491e5fdd7635402349f98d9ce1e8022af71b6d7a8d9fc3d64eba69f60b6` and includes the later M7 addition.

Asset maps are empty in the original pair. The correction pair has two persona asset-map entries for **one distinct photo asset**, with byte hash `ce7543ab1030d31f2f66fec69b5bd9c22b3c820bbdfd44d71488fed3e6607fdc`. The exporter hashes regular `photo`/`video` responses only. Its received successful HTTP/hash operations are not independent audit requests.

The separate received [starter-media-preservation object](cell-custody-0.2.10/astra/m7-observer/objects/926e886f0afb1b8c66e38a5da316a9778b30b86fa90422c61da6c35c197effec), SHA `926e886f0afb1b8c66e38a5da316a9778b30b86fa90422c61da6c35c197effec`, records `pass: true` at 01:03:43.479 for 18 **post-migration versus fixture** byte checks: eight avatars, eight post images, two post videos. It supplements the sparse message baseline but is not a pre/post snapshot comparison or proof that the omitted sender/quote objects were exported.

## What the comparisons check

`L/m7/compare-snapshot.mjs`, SHA `d9b4e97af99fbed8d30643df71568c0c600f584cf9852ea48658f08177169dfb`, verifies pre-manifest hashes and principals; for each preexisting conversation it compares the conversation excluding `messageCount`, each preexisting message, and the asset map; it requires post-count equal to the number of nondeleted messages in that pre-export.

The received initial result is [snapshot-comparison.json](cell-custody-0.2.10/astra/m7-observer/objects/56b2871a20b31db5d90998d641e6010139e550c00da52a4c9eb16a786def7562), SHA `56b2871a20b31db5d90998d641e6010139e550c00da52a4c9eb16a786def7562`; the correction result is [correction-snapshot-comparison.json](cell-custody-0.2.10/astra/m7-observer/objects/bb794dd29c336fbe4422cbfcb9a74b153852a7045c8cf57860d0f87293696919), SHA `bb794dd29c336fbe4422cbfcb9a74b153852a7045c8cf57860d0f87293696919`. Both identify their actual before/after directories and carry the same 17-field manifest.

The comparator itself does not verify post-manifest hashes, reject extra conversations/messages, compare omitted fields, or test expiry timing; an empty pre-persona chiefly checks principal identity. This audit’s retained-object/hash comparison supplies the narrower extra-file/content checks described above, not missing runtime or field coverage. Counts in all 21 later persona/conversation rows equal nondeleted exported messages, including a poll conversation with four rows but count two; this is a snapshot observation, not a continuous-forward-maintenance proof.

## Count schema and migration mechanism

The original 11 `.q` files contain no `messageCount`, `countWeight`, or `conversationMessageCounts` structure. Original `m7/pre-schema/chat.q` SHA is `20e8297644afd86a2c8f0414a00ad4e24990f1a824e1078701a71b7f4f82841b`: the conversation table has no count field and the message table has no weight. This inherited absence should be recorded for frozen M7’s preexisting-structure disclosure.

The actual evolution adds physical **`messages.countWeight`**, default one, and a stored maintain:

```quarry
maintain conversationMessageCounts: sum messages of countWeight by conversationId
  read <- exists members[.conversationId, viewer]

shape conversationCard = { *, messageCount: conversationMessageCounts[.id] }

job backfill():
  chunk m in messages first 100 by byId:
    update messages[m.id] { countWeight: 0 if m.deleted = true else 1 }
```

This initial source is `L/m7/initial-evolved-schema/counts.q`, SHA `bd34bd4f099782e9dab0f0fd8d48b7ea281acf0d09938d7ab0054d6dc11c1ca4`. The conversation API exposes `messageCount` through `conversationCard`; it is **not a newly stored column on the physical conversation table**. There is nevertheless a real physical message-field backfill and stored aggregate, rather than only a query-time count. Whether that exact mechanism meets the brief’s “conversation gains a field” wording is an author/grade interpretation; this audit records the mechanism without deciding it.

`L/m7/migrate.mjs`, SHA `c86522f1a45432c46c37c8ed4f3198a3faab91e49ffe11e839ec65b0ade8537b`, stages nullable `countWeight`, temporarily removes the maintain from the adopted schema, runs the published CLI `counts.backfill`, requires `state: done`, then restores required weight and the stored maintain and runs schema check. Its source says to run with the target server stopped; this audit did not inspect processes to independently establish that condition.

The original [backfill receipt](cell-custody-0.2.10/astra/m7-observer/objects/6df9118a7d6fdda99c5d889a8c2f25a79165df95c862f61e8722a1f1909d5483), SHA `6df9118a7d6fdda99c5d889a8c2f25a79165df95c862f61e8722a1f1909d5483`, records 15 writes/done; original post counts are 6 and 9. Later `counts.q` SHA `7e6c4d70b3bf9c0741cf2f3c0d60bf4f9d0d684f674974e73f8ad1274a7dbbed` adds poll-option-key repair, which can write a message again. Its [later receipt](cell-custody-0.2.10/astra/m7-observer/objects/8a60cef977a1d0cb40fc4c9f6b2a7183930a18e3d3aa23d64f3dd1ddd098a8eb), SHA `8a60cef977a1d0cb40fc4c9f6b2a7183930a18e3d3aa23d64f3dd1ddd098a8eb`, records 64 writes/done, not 64 unique rows. Current inspected chat/media source gives new messages weight one and deleted messages weight zero. No independent expiry or live increment test was added here.

Frozen `m7-a06` covers visible backfill/count semantics including expired/tombstoned messages and polls; `m7-a07` covers forward increments/settings. The snapshots provide the bounded count observations above. Frozen **`m7-a08` is a grader predicate** for preexisting messages/media/receipts/reactions intact against the M6-field snapshot; the exporter omissions and empty states constrain that evidence without assigning a result. `m7-a09` concerns prior-green regressions and is outside this preliminary snapshot determination.

Frozen input identities: `P/prompts/astra-snapback4.m7.md` SHA `a6a9274a4c24266598f8788269e4200f895c236ee27b5143c948ca15618fbad3`; `P/instrument/social-messenger.md` SHA `129fd79c5a2b19c7312fc41ed931647b79e2c4afc611c3cc431e0e26a452fbc6`; `P/instrument/schema/social-messenger/assertions.json` SHA `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`.

Final source/receipt/access custody and phase completion remain the parent’s separately scheduled follow-up. Preserve the original baseline, immediate adoption result, richer correction pair, post-only fixture-media checks, and frozen timing mismatch as distinct evidence.
