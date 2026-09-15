# Muse 0.2.10 M7 snapshot/count audit — preliminary fixed cut

Orchestrator evidence audit, not a blind review, grade, author ruling, or phase-outcome determination. This bounded leg inspects passive observer metadata, retained safe snapshot JSON, immutable pre-M7 source, and selected source whose hashes match the fixed cut. No application requests, runtime tests, store reads, process operations, steering, lane edits, private thoughts, or raw tool-result bodies were used. Authentication portions of exporter source were excluded from output; this artifact contains no credential values.

The original eight-persona export precedes the first observed application edit. It covers a sparse starter state and two already-available post versions. **The inherited `messageCounts` maintain is unchanged; M7 adds a bounded read-time count query, not a physical conversation-count field or count backfill. Neither snapshot exports that new query.** No completion, green, or post-M7 independent-grade claim follows from this audit.

## Frozen evidence boundary and custody

`O` = [Muse passive observer](cell-custody-0.2.10/muse/m7-observer/); `L` = `/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/muse-snapback4`.

The fixed cut is the first **58,766 bytes / 186 complete events** of `O/events.jsonl`, SHA-256 `424c3a88e3a07aaac0c73b6d30acd551b591af6fedad5d7dc2cd111320d4a707`, ending **2026-09-15T02:43:36.596362Z**. Later reads used only that length and rechecked its SHA; later observer events were not polled or incorporated. It includes 43 source-manifest events. The live log can grow, so this is a prefix identity, not an assertion about its eventual full-file hash.

Observer [start.json](cell-custody-0.2.10/muse/m7-observer/start.json), SHA `d74aa51e0b3a2e50c7774ea0513f999819183d633eac6e3852fc427d87c5964e`, records observer PID 1710 at 02:28:30.394111Z, `phaseAlreadyStarted:false`, a two-second poll, and source hashes only. It is neither the snapshot exporter nor a verifier. Parent supplied the actual M7 launch **02:28:59 UTC, child 6364**, and an immediate pre-launch check matching all 130 original source hashes. This audit independently matches **129/129 shared paths** from the first observer source manifest to [builder/custody.json](cell-custody-0.2.10/muse/builder/custody.json), SHA `00f0920f8a0244ddbb55672b4addd8b4073b177d8c1525f49f791cf601a6f5b3`; that observer manifest does not list the 130th path, `ui-kit/src/tokens.ts`. The parent's 130-path check and this 129-path observer check must retain their different coverage.

Source-manifest filenames are observer keys, not their serialized file SHA. Important exact identities:

| Event | Observer manifest under `O/source-versions` | Actual file SHA-256 |
|---|---|---|
| 106, initial | `6ae7497b760ac06e88a05a640831382758b0e03ca1f12c1299c72dc56e1bb666.json` | `c81e54cc63b8809dac2a6d563ee3bbfbdec18c409081ba00f7e06463ac282686` |
| 120, original export | `2a067e4245d62936fa27054d9b6b7d2f7e83196c857ab95c7444c4da3094efef.json` | `ff1ec0bce3ba52cfa4105999808ba108f346327ba70ef8bdf6cb20c9012c7943` |
| 122, first app edit | `e013b56cced433fa67e0371e37229f5fc5c24c44439d015ffbcec75202bedb4c.json` | `a2924749b51c89b819df3adb9f80a34c856ec51b888b2a914528076ab05b4d58` |
| 186, cut | `678fe9a268551063f41e1aef05c4afb6c9ff67ecbcb4ee1d75d4055b076ff16b.json` | `3440fd0ee390946e435cd909fa09193f9c1d1874e244c0c9e452d801d9b99c4e` |

## Original export order

| UTC, 2026-09-15 | Evidence | Bounded conclusion |
|---|---|---|
| 02:28:30.394643 | Initial source event 106 | Original observed application hashes. |
| 02:28:59 | Parent's launch receipt | M7 session starts. |
| 02:29:18.871693–02:36:08.424849 | Events 107–109 | Only `m7/run-log.md` changes among selected source paths. |
| 02:36:32.624033 | Event 110 | New exporter `scripts/m7-snapshot.mjs`; no observed pre-existing app edit. |
| 02:36:34.242 / 02:36:34.645909 | Pre-manifest timestamp / events 111–120 | Original eight persona files and manifest captured; original selected app hashes still present. |
| 02:37:11.011102 | Event 122 | First observed app edits: `snapback/schema.q` and generated API. About 36.4 seconds after the pre-snapshot observation. |
| 02:41:21.556 / 02:41:23.282581 | First post-manifest timestamp / events 156–165 | Complete first post export, with one additional poll message. |
| 02:42:42.766 / 02:42:44.116678 | Second post-manifest timestamp / events 172–181 | Complete second post export replaces three populated persona files and manifest; original pre files remain the only captured pre version. |

This supports the M7 prompt's export-before-app-edit ordering. It does **not** meet the separate frozen brief's export-before-session wording: `instrument/social-messenger.md` lines 670–678 and 713 say before M7 starts, whereas `prompts/muse-snapback4.m7.md` line 9 delegates fresh starter setup/export to the running agent. Preserve that protocol discrepancy. A two-second observer cannot exclude transient edit-and-restore operations between observations, and timestamps are observations, not instrumented write traces.

Frozen brief SHA `129fd79c5a2b19c7312fc41ed931647b79e2c4afc611c3cc431e0e26a452fbc6`; M7 prompt SHA `fe5454d2d340184fcfecca1a51011dbd085f6712b9fe567d7ea32965960be572`.

## Exact snapshot versions and populated states

The following immutable manifest objects name/hash all eight respective persona objects. All 27 manifest/persona references were resolved and their raw bytes matched their named SHA. They identify actual received JSON, without asking the app for another export. The five empty-persona documents are byte-identical across all three sets.

| Set | Retained manifest object / SHA-256 |
|---|---|
| Original `m7/pre-snapshot` | [28de68c84f9d06c569fa635e14a5aa9ca6dde814244cfa392bf946ab138e515c](cell-custody-0.2.10/muse/m7-observer/objects/28de68c84f9d06c569fa635e14a5aa9ca6dde814244cfa392bf946ab138e515c) |
| First `m7/post-snapshot` | [72b8b0e49b35b801241c7d194bfb40e72bf9a0ab3088bd9bfacacd9ac1eaafb0](cell-custody-0.2.10/muse/m7-observer/objects/72b8b0e49b35b801241c7d194bfb40e72bf9a0ab3088bd9bfacacd9ac1eaafb0) |
| Second/latest post in this cut | [70aa4b5a333881fec935969c8acbd9f15374a127758798edc69752525d9417d0](cell-custody-0.2.10/muse/m7-observer/objects/70aa4b5a333881fec935969c8acbd9f15374a127758798edc69752525d9417d0) |

| Persona | Pre conversations | Pre message projections | Post 1 projections | Post 2 projections | Original persona SHA-256 |
|---|---:|---:|---:|---:|---|
| alice | 2 | 15 | 16 | 17 | `e28be68472ef39ea8e8e55b43d73c7b6537d0e3b8cbe737710da08384ce22c59` |
| bob | 2 | 15 | 16 | 17 | `8810c92a67a446a294c75c87ac1c6c73e95c2732d189384435917196f18f1d8d` |
| carol | 1 | 9 | 10 | 11 | `00fad5334c4872dcb345857c653ccf3676d666d841108c72a9196cabb4b08d0f` |
| dave | 0 | 0 | 0 | 0 | `8136694e839998be5e4765c28d0faaccd3a3dd7857308d517791798a1d320c68` |
| erin | 0 | 0 | 0 | 0 | `50bf13f974a4e67859caa2ec80df7fbd2cf269f8826894e8eefd034fbc3a5ced` |
| frank | 0 | 0 | 0 | 0 | `fa45447775ce02e66eb0da5fcb617040a1559a7805dc5137fa4798fe9f64a53b` |
| grace | 0 | 0 | 0 | 0 | `b06f1cdb0d5e266d08205f27e779c752587354fcb0ccfb1d4e79c66dc715f00a` |
| henry | 0 | 0 | 0 | 0 | `2cc33d9e1909b17c0ec09fa1f821c6334a5b9f69f1ae46cd137c6092837f08dc` |

The original set contains **two distinct conversations and 15 distinct message IDs**, represented as **five persona/conversation projections and 39 message projections**. Those are the starter 6-message DM and 9-message group as seen through member access; 39 is not a physical row count. This audit did not open the underlying store or independently count physical rows.

- All original messages are text; six distinct reply-to IDs are populated (15 projected reply references). `editedAt`, `expiresAt`, `photo`, `clip`, and `photoOnce` are null throughout; `tombstone` is false throughout. No message-media preservation, edited/tombstoned-message preservation, or expiry transition is demonstrated by that original state.
- Reactions and view-once view records are empty in all eight original exports. Each populated conversation has aggregate receipt rows: 15 distinct message aggregates / 39 projections, all `sent`, with zero read and delivered marks. The snapshot does not contain physical per-recipient receipt rows or a nonempty caller-own reaction witness.
- Members are populated: five distinct conversation memberships / 13 projections, with roles and profiles. All member `lastReadAt` values are null. Sender IDs and six reply links are captured; full message-card sender/quote expansion is not separately exported.
- All eight personas have profiles and avatar references. There are **eight distinct avatar asset IDs / 14 exported asset references**, all with successful byte hashes. These are avatar assets, not message photos/videos. Profiles, avatar references, and media-hash arrays are byte-for-byte equal per persona in both post versions.

First post contains 16 distinct messages / 42 projections: the 15 originals plus one **tombstoned poll** in the starter group. Second post contains 17 distinct messages / 45 projections: it adds a second, non-tombstoned poll. No original message disappears. Across every original message object, the only value change is the inherited group-history `total`, 9→10→11; the newly optional `pollQuestion` is null on originals. The unchanged DM total is 6. New group rows and the inherited totals include the tombstoned poll.

Original inbox rows, profiles, members, views, reactions, and asset hashes remain equal. Original aggregate receipt rows remain present. First-post aggregates are unchanged; by second post, delivered counts increase on all 39 original aggregate projections, with state changing to `delivered` on 24, while 15 remain `sent`. No read marks are present. This is **progress after the original snapshot**, not preservation of pre-existing nonzero marks. It illustrates why an exact-all-fields-equal comparison would be inappropriate for live receipts, and why the weaker actual comparison must be described accurately.

## Export and comparison scope

`scripts/m7-snapshot.mjs`, SHA `3499e0a8cd97502a32fc12930c6d50f758eb1207e4bd273545fb63bd10510709`, was introduced before the original export and remains the same in the fixed cut; its inspected bytes match that manifest. It calls the app's custom-client HTTP query surface for `myProfile`, `inbox`, `historyPage`, `threadMessages`, `convoReactions`, `convoAggregates`, `membersOf`, `myViews`, and `principalProfiles`, and hashes referenced assets. It exports full returned history objects; it does not project each message into an explicit normalized M6 object.

The immutable inherited [API.md](cell-custody-0.2.10/muse/builder/API.md), SHA `8f21716db990c9b4c3009555de1835d86140f1a6dfdaa6cd274e36301226e6cb`, lines 33–38 documents the history `total` and message fields. Original history objects carry 14 fields: `id`, `conversationId`, `authorId`, `at`, `kind`, `body`, `photo`, `clip`, `photoOnce`, `quoteId`, `editedAt`, `tombstone`, `expiresAt`, `total`. The export represents reactions and receipt state separately at conversation level. Frozen M6 lines 641–647 require message identity/content/media/edit/delete/reply information plus reactions `(emoji,count,caller-own state)` and own-message receipt state. Empty reaction arrays cannot establish the richer nonempty shape or caller-own behavior; aggregate receipts establish only the states actually present.

Exporter limits: one inbox page (source query first 100), at most 40 history pages of 100, one reaction page (last 100), and one member/view query per conversation. It breaks on denied/non-array history and may retain an incomplete projection without a distinct truncation declaration. These caps do not truncate the observed tiny original state. `threadCount` is merely the returned first `threadMessages` page length (50-row bound), not a persisted counter or the new count query.

`scripts/m7-snapshot-compare.mjs`, SHA `a3e7ac78fbd8a48df5b6b23bc782ed80c587ce090c94f585f639a04c7071dcf9`, matches the fixed cut. Defaults select `m7/pre-snapshot` and `m7/post-snapshot`; the later post therefore replaces the earlier default input. Both actual versions are preserved by the observer. This audit did not execute the comparator or inspect terminal result bodies, and no machine-readable snapshot-comparison result is present among this cut's observed JSON paths. The argument-level provenance and final chosen invocation remain for the final phase audit.

Its static comparison checks old message existence and nine scalar fields (`id`, `conversationId`, `authorId`, `at`, `kind`, `body`, `editedAt`, `tombstone`, `quoteId`), three asset IDs, and a derived edited flag; old conversations/selected settings/roles; old reaction keys; nondecreasing aggregate read/delivered counts; old membership roles; and old asset SHA values. It allows extra messages and newer receipt marks.

Material limits to retain: it does not verify either snapshot manifest's advertised file hashes; compare `expiresAt`, history `total`, `threadCount`, or the new `convoMessageCount`; compare profile fields, view records, membership timestamps/read markers, conversation background reference, aggregate `total`/`state`, or recipient identity; reject extra rows; or prove nonempty reaction shape. The comment about preserving “per-principal read marks” is broader than its aggregate-only predicate. This audit's byte/hash checks and selected JSON comparisons supply narrow additional custody/field observations, not missing dynamic assertions or a grader result.

## Count structure and migration boundary

Immutable original `snapback/schema.q`, SHA `e78ec02f3b1e06deaa5924fa66cf63649e217681c128cf1c304efc3b3e3ed9c2`, already declares `maintain messageCounts: count messages by conversationId`, with `read <- allow` and `online only`. It supplies the original history `total` (6/9), search totals and count summaries. Thus this lane entered M7 with a stored maintained count structure; it cannot be described as starting without counts.

Fixed-cut schema SHA `741638080ae30bbf3383879fe3fcfe8b895cfbb3c2a91a76eb973df79afe626f` preserves that maintain exactly. The count-related addition is `convoMessageCount` at lines 567–570: membership check, `messages[conversationId] first 5000 by byConvTime where not .tombstone`, then `count(pg)`. The new settings component SHA `4addf46adbbea04ac65176aa870349ebb5696728d4d30c954b56043a1a669311` subscribes to this query and renders its result at `sm-chatsettings-message-count`. Both inspected source hashes match the cut.

This is a **bounded count computed on reads**, relying on ordinary query expiry visibility and filtering tombstones. It adds no `conversations.messageCount` column, message contribution column, new count maintain, or count-populating backfill job. The physical schema additions visible in source concern polls: widen the message kind enum, add optional `pollQuestion`, and add `pollOptions`/`pollVotes` tables. Source establishes that shape; this audit does not independently prove a particular adoption command, backing-store identity, migration timing, or post-crash persistence.

The two post snapshots do not call `convoMessageCount`. Their group `total`/`threadCount` values 10 and 11 include the tombstoned poll; this is expected for the inherited total and raw thread page length and is **not** evidence that the settings query returns the same value. Conversely, source inspection of the new query does not convert these snapshots into backfill/count receipts. The 5,000-row bound is also material to “every conversation” claims beyond the starter fixture.

Frozen `m7-a06` requires visible-message backfill excluding tombstones/expiry and including polls; `m7-a07` requires forward counts shown in settings; `m7-a08` is grader-owned preservation against the pre-M7 M6 snapshot. The bounded source and JSON observations above qualify those claims but do not adjudicate them. No independent post-M7 grade, physical count migration success, continuous forward-maintenance result, or full M6 preservation certification is asserted.

## What remains outside this preliminary leg

No files were absent for the eight-persona pre export or either observed post export. The phase's completion state is intentionally not inferred from the existence of narratives, acceptance files, or choreography paths in the cut. A final audit may bind actual lifecycle end, received suite/choreography results, exact comparator invocation, final source identities and later changes, declared count reasoning, and teardown/public-access evidence. This report stays bound to the fixed observation cut and makes no numerical verdict or author-ruling change.
