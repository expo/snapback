# Grok 0.2.10 M7 snapshot/count audit — preliminary

Orchestrator evidence audit, not a blind review, grade, M7 outcome, or author ruling. The two retained eight-persona snapshot sets have identical contents after removing export timestamps. They establish preservation of the exported starter states at this boundary. They do **not** export/check the new message count or populated media/reactions, and their comparator checks less than the complete exported payload.

No application requests, tests, store reads, process operations, lane writes, or private model thoughts were used. This report fixes one observation cut and does not poll the phase. Final completion/source/access custody remains a separately commissioned follow-up.

## Evidence boundary and chronology

`L = /Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/grok-snapback4`.

`O = /Users/ccheever/projects/snapback-lanebriefs/cell-custody-0.2.10/grok/m7-observer`.

The fixed cut is the **first 91 lines**, 29,454 bytes, of [observer events](cell-custody-0.2.10/grok/m7-observer/events.jsonl), last event `2026-09-15T02:02:50.043292Z`; exact prefix SHA-256 is `01ba4a5957dbf9a7a26ed63944ad6ad829c58b22c8a02a70efd8c0486ac76e11`. The live events file may now be longer. Fifteen source manifests occur in this cut. The two-second observer copies stable parseable safe JSON versions and hashes selected source; it does not retain source contents or a continuous write trace. Its `start.json` says `phaseAlreadyStarted: false` at 01:41:40.557197; this audit uses the parent-supplied actual runner start **01:41:40 UTC, child 59663**, not the run log’s ambiguous local-time-with-Z notation.

| UTC on 2026-09-15 | Fixed-cut evidence | Finding |
|---|---|---|
| 01:41:40.557645 | Event 37, source manifest `9f03933e25341182d3c1c576f7bc1ed571e38920c23dc6465fbfae0f48e1a87d.json` | Initial 95 selected sources; original schema SHA `f71d0b6102eba07f4b75906d8e344d266273b88d6f8ede7528fd23a4ea7935fd`. |
| 01:42:04.756492 | Event 38 | Adds only `m7/run-log.md`; no application edit. |
| 01:49:58.033895 | Event 39 | Adds `scripts/export-m7-snapshot.mjs`; existing application hashes still unchanged. |
| 01:50:24.656–01:50:24.762 | Eight original persona export timestamps | Alice through Henry exported over about 106 ms. |
| 01:50:24.763 / 01:50:26.207255 | Pre-manifest timestamp / event 48 observation; source manifest event 49 | Original pre inputs retained; selected application source remains at its inherited version. |
| **01:53:37.598333** | Event 50, source manifest `ce22ae060d98df4f7ca1fb0c1f4edea37e562ef3a06a75627be8970246bb75ab.json` | **First observed application edit:** `snapback/schema.q`, SHA `9a63098c2deb96569d34b17611264bd2b1dda12d75e81caa3c84fd4882c21edd`. |
| 01:54:25.943658 | Event 51 | Schema changes to `2040a14bbbd282db27e9ff9456d43acc13e149c0587e88e39aec765bcbb7017f`; generated API changes. |
| 01:56:08.908–01:56:09.030 | Eight post persona timestamps | Actual post inputs retained. |
| 01:56:09.030 / 01:56:10.687813 | Post-manifest timestamp / event 63 observation | Post manifest and all eight files captured. |
| 01:56:09.085 / 01:56:10.687813 | Comparison timestamp / event 54 observation | Received `pass: true`, zero mismatches, all eight personas named. |

The original export completes about **193 seconds before the first observed schema edit** (about 191 seconds between observer captures), but about nine minutes **after session start**. The frozen brief requires a snapshot before the M7 session starts; the supplied M7 prompt instructs the fresh-session builder to seed and export before application changes. As in the Astra audit, those are separate ordering requirements. The observed selected-source sequence supports export-before-application-edit, not export-before-session. A two-second poll cannot exclude transient edits/restores between observations.

The initial schema in immutable [pre-M7 source](cell-custody-0.2.10/grok/pre-m7-source/source/snapback/schema.q) matches the observer’s original schema hash. The inspected current schema and two snapshot scripts still match their versions in this fixed cut; subsequent UI/settings/acceptance edits visible in the cut are outside this preliminary snapshot determination. No lifecycle-end inference is made from available or absent files.

## Original inputs, all personas, and actual post comparison

The manifest objects below retain exact filenames, principals, per-persona counts, and SHA-256 identities. Their `sha256:` prefixes are metadata formatting, removed when resolving `O/objects/<hash>`.

| Retained object | SHA-256 |
|---|---|
| [Original pre manifest](cell-custody-0.2.10/grok/m7-observer/objects/aff5e84f5c6ad2efb2eca984d9df5c3d4cd8dc0246f02d125b340cd018ca2fea) | `aff5e84f5c6ad2efb2eca984d9df5c3d4cd8dc0246f02d125b340cd018ca2fea` |
| [Actual post manifest](cell-custody-0.2.10/grok/m7-observer/objects/68a09502fba7180dda51ff050fa1e57f41b0b5f009fd9fa88a1209b2c9deb699) | `68a09502fba7180dda51ff050fa1e57f41b0b5f009fd9fa88a1209b2c9deb699` |
| [Received `m7/snapshot-compare.json`](cell-custody-0.2.10/grok/m7-observer/objects/280db3e2f9c84274f8b20b2a4a656ed8634c206a2c3f4254364b99a9609f5289) | `280db3e2f9c84274f8b20b2a4a656ed8634c206a2c3f4254364b99a9609f5289` |

Each snapshot path has one unique captured version in the fixed cut. All **18 specifically named current files** (two manifests and 16 persona files) matched those original observer hashes when read for this audit. The post manifest reuses the `clique.m7-pre-snapshot-manifest.v1` schema-version string, but its actual directory, export timestamps and hashes distinguish it from the original pre input.

| Persona | Conversations, pre = post | Message projections, pre = post | Receipt projections, pre = post |
|---|---:|---:|---:|
| Alice | 2 | 15 | 24 |
| Bob | 2 | 15 | 24 |
| Carol | 1 | 9 | 18 |
| Dave | 0 | 0 | 0 |
| Erin | 0 | 0 | 0 |
| Frank | 0 | 0 | 0 |
| Grace | 0 | 0 | 0 |
| Henry | 0 | 0 | 0 |
| **Totals** | **5 projections** | **39 projections** | **66 projections** |

These are **15 distinct message IDs** in two distinct conversations (six DM messages and nine group messages), and **24 distinct receipt IDs**. Neither 39 nor 66 is a physical-row count. The exported IDs and states are consistent with the intended starter corpus; no database or complete seed replay was independently inspected here. The five empty persona files are present, with principals and field manifests; they are not missing exports.

Recomputation from original retained objects found each persona’s entire pre/post payload identical after removing only top-level `exportedAt`: principal, declared fields, conversation metadata, all message fields, receipt IDs and states, and array contents all match. No extra/missing conversations, messages, reactions or receipts occur in this pair. This check is stronger than the received comparer’s subset checks, but remains bounded to what was exported. It is an immediate post input, not a claim about the final exercised M7 state.

## M6 field coverage and nonempty states

`L/scripts/export-m7-snapshot.mjs`, SHA `445ebdb648be7f44949cade763a564ac067ac403c494296ba78c1888157cd709`, writes the 14-field manifest:

`id, conversationId, authorId, at, photo, clip, photoOnce, poster, body, editedAt, deleted, quoteId, reactions, receipts`.

The inherited [API.md](cell-custody-0.2.10/grok/builder/API.md), SHA `f96551b5f8fd6b52c2170ca0076bf94c3a08a762eba92f09aaa81eefd599582b`, matches the currently inspected lane document. Lines 41–48 name identity/time, photo/clip/photoOnce, body/edit/deletion/reply, reactions and receipt flags. The exporter represents those named fields and additionally `poster`. The manifest references `API.md` by name, not its hash; this audit supplies that document identity.

| State | Both snapshots | Limit |
|---|---|---|
| Identity, author, timestamp and body | 39 projections, 15 distinct messages; all 15 distinct bodies nonempty | Preserved exported values. |
| `quoteId` | 15 populated projections, 24 null; six distinct messages have a quote ID | Reply IDs, not the full returned quote/profile object. |
| `photo`, `clip`, `photoOnce`, `poster` | All 39 null for each field | No populated media-reference or asset-byte preservation witness. |
| `editedAt` | All 39 null | No edited-message transition/state witness. |
| `deleted` | All 39 false | No tombstone preservation witness. |
| `reactions` | All 39 arrays empty | No populated reaction preservation witness. |
| `receipts` | 66 projected rows, 24 distinct IDs; every `delivered=false`, `readFlag=false` | Nonempty receipt identities and initial flags are preserved; delivered/read states are not represented. |
| `expiresAt` | **Not exported** | Do not infer null or expiry behavior from its absence. |

The exporter’s media projection is only `{id,type,bytes}`; it performs no asset-byte downloads/hashes. It maps missing/invalid media to null, several optional scalars to null, and flags with boolean coercion. Reaction rows retain id/message/principal/emoji; receipt rows retain id/message/principal/delivered/readFlag, omitting their conversation column. It queries `receiptsOf` for every exported message. That yields member-visible receipts beyond the API document’s narrower “caller’s own messages” description; no access-control adjudication is made here.

The original `threadMessages` source at lines 471–472 additionally returns `author`, shaped `quote`, and all physical message columns including `expiresAt`. Those broader returned fields are omitted from this exporter. Unlike the Astra API manifest, Grok’s explicit prose M6 field list itself does not name the author/quote objects or expiry; distinguish **the named M6 list** from **all fields actually returned by the query** rather than silently applying one lane’s manifest to another. No blanket complete-row preservation claim is supported.

Pagination is bounded: `inbox` is queried once with `c:null` (its source page size is 50); message history allows at most 50 iterations of 50 rows, constructing the next `c` from the last row ID; reaction and receipt reads each take a single page of 50. It does not retain continuation/completeness metadata. Every conversation here has fewer than 50 messages and each actor fewer than 50 conversations, so the actual pair does not exercise those continuation paths. These source limits matter to larger preservation claims, not a manufactured failure on this starter pair.

## What the received comparer actually verifies

`L/scripts/compare-m7-snapshot.mjs`, SHA `5ae307cff565b04a8734c490c1fb03b15c0308ec669cfa4b48a9b43d1267fe80`, reads the pre manifest’s filenames and corresponding files in the actual pre/post directories. It checks that each old conversation/message remains and compares identity/time/body/edit/deletion/reply plus **media IDs**. It requires each preexisting reaction principal/emoji pair and receipt principal/boolean-state tuple to remain.

It does **not** verify either manifest’s hashes, compare principal/field-manifest values, compare conversation metadata, reject added messages/conversations/reactions/receipts, or compare reaction/receipt row IDs. It omits exported **`poster` entirely**, and omits media `type`/`bytes`. Its reaction/receipt sets ignore duplicate multiplicity. For empty personas, it chiefly succeeds by having no old conversations to traverse. Therefore `pass:true, mismatches:[]` is not by itself a complete 14-field/payload identity claim. This audit’s independent retained-object comparison and hash checks establish the stronger, still bounded identity result described above.

Neither exporter nor comparer records the new `messageCount`. The received comparison cannot be cited as numeric backfill/count proof. Frozen m7-a06/a07 count/UI/forward-maintenance predicates and m7-a08 grader preservation semantics remain separate from this preliminary check; no result is assigned to them here.

## Inherited count structure and actual schema mechanism

The pre-M7 schema SHA `f71d0b6102eba07f4b75906d8e344d266273b88d6f8ede7528fd23a4ea7935fd` has no conversation message-count structure. Its conversation table (lines 187–201) has no counter; message table (244–268) has no contribution/count field. Existing membership `unread`, conversation tails, and reporting tables are other app state, not an inherited conversation message count.

At the inspected schema SHA `2040a14bbbd282db27e9ff9456d43acc13e149c0587e88e39aec765bcbb7017f`, the relevant new source is:

```quarry
maintain conversationMessageCounts: count messages by conversationId, deleted
  read <- exists memberships[.conversationId, viewer]
  online only

query conversation(conversationId: conversations):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return conversations[conversationId] { *, myRole: memberships[conversationId, viewer], messageCount: conversationMessageCounts[conversationId, false] }
```

The maintain is at line 344; the query at 505–507. This creates a **stored aggregate table** and projects its nondeleted-group value as an API field. It adds **no physical counter column to `conversations`, no per-message count-contribution column, and no explicit count-backfill job**. Source comments say it relies on engine backfill during schema re-adoption. The related physical schema changes add optional `messages.pollQuestion` (line 253), index `byConvDeleted` (262), poll tables, and a poll-vote maintain. That is the concrete mechanism to describe, rather than an unqualified claim of a physical conversation-field backfill.

The published 0.2.10 README, SHA `5c39274c701d6392031b1a65e4a398070686a45598d5e748a9c39f8d6bb07b74`, lines 228–237 describes a maintain as an engine-written aggregate table whose indexed lookup returns the number (zero for a missing group); lines 696–697 explain that `online only` opts out of inherited sync. This supports the source-level distinction from a query-time scan or manually updated conversation column. The schema filters tombstones through its boolean grouping and relies on physical expiry removal for expired contributions; no explicit time predicate appears in this maintain.

The `inbox` query remains a raw conversation projection without `messageCount`, and the exporter reads `inbox`, not `conversation()`. Consequently both snapshots omit the new count even though `conversation()` is written to expose it. Generated API changes before the post export show a new compiled artifact; by themselves they do not independently prove the active store adopted it or populated expected count values. There is no count-value/adoption receipt in the audited snapshot pair. This audit did not inspect a store or invoke `conversation()` to fill that gap.

Whether the stored-maintain/projected-field mechanism satisfies the brief’s “backfilled field”/“real migration” requirement belongs to the author or applicable grading procedure. Record the inherited absence, the physical aggregate mechanism, and the lack of count values in these particular snapshots without inventing a ruling, pass, or failure.

Frozen input identities: `prompts/grok-snapback4.m7.md` SHA `adec3c8f6964ac9348f65a0d345852aa22c61eaa50fd193be747d538e4b6172d`; `instrument/social-messenger.md` SHA `129fd79c5a2b19c7312fc41ed931647b79e2c4afc611c3cc431e0e26a452fbc6`; `instrument/schema/social-messenger/assertions.json` SHA `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`.
