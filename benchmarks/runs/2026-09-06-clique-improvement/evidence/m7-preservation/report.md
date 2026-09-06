# m7-a08 independent adjudication

**Assertion:** m7-a08 — Pre-existing messages, media, receipts, and reactions are intact after the migration, compared against the pre-M7 snapshot exported through the custom-client API over the M6 field manifest.

**Verdict: pass**

**Method:** independent custom-client API export and snapshot comparison. Not a complete M7 grade, not native M6/M8, not metering, not an O-score, not comparative eligibility.

Grader: native Grok 4.6 xhigh, session `ee721c82-1b8c-4e69-b5f1-0262a8167ed1`, launch pid 70649, working directory `/Users/ccheever/clique-improvement/grading/astra-008/m7-preservation` on Apple M5 Max. No subagents. Builder narrative, diary, essay, transcript, suite pass/fail summaries, and other graders were not used.

---

## 1. What was judged

Exact frozen text from `/Users/ccheever/clique-improvement/next-run/astra-008-m7/m7-assertions.json`:

> Pre-existing messages, media, receipts, and reactions are intact after the migration, compared against the pre-M7 snapshot exported through the custom-client API over the M6 field manifest.

M6 field manifest (frozen): per-message `id`, conversation id, sender id, server timestamp, type, text/caption, media reference, edited flag, tombstone flag, reply-to id, reactions (emoji, count, caller own state), and caller-relative receipt on the caller’s own messages.

The sealed baseline is a root-custodied **preclock API export**, not a post-migration success receipt.

---

## 2. Scope honesty (baseline cannot prove populated media/reactions)

The sealed preclock snapshot contains **15 distinct messages** and **48 per-persona message objects**.

Every one of those 15 messages has:

- `media: null`
- `reactions: []`
- `type: "text"`
- `edited: false` / `tombstone: false` in the documented history helper (raw `edited`/`tombstone`/`kind` are JSON `null`)
- `viewOnce: false`

Empty-field preservation on those originals **does not prove** that populated message-media or populated reactions would survive a migration. This lane’s starter log never produced message media or reactions before the clock. Post-clock M4/M6 suite media that later appeared in the Alice–Bob DM are **new** messages; they are not the pre-existing set.

Profile avatars and post image/clip bytes **are** populated in the supplementary snapshot (18 distinct asset IDs). Those populated bytes were downloaded again and matched. That is social/profile/post media, not message media.

---

## 3. Runtime identity (before API observations)

Recorded writer PIDs **5361** and **77770** are absent (`ps -p` exit 1, empty stdout). They were not signalled.

Root-owned prepared native owner **27250** was already running and was left running:

| Check | Observed |
| --- | --- |
| pid | 27250, ppid 1, user ccheever uid 501 |
| started | Sun Sep 6 09:44:39 2026 |
| command | `/Users/ccheever/clique-astra008-m7/node_modules/snapback2-darwin-arm64/bin/snapback2 dev --project /Users/ccheever/clique-astra008-m7 --foreground --owner-child --json --port 51000` |
| cwd | `/Users/ccheever/clique-astra008-m7` |
| listener | `snapback2 27250 ccheever … TCP 127.0.0.1:51000 (LISTEN)` |
| generation (prep metadata) | `b1eb2a35096dcf4c8236a74a49d5f3c3ae0c68c11b9730581877d20560c79afa` |

The owner was not replaced, reset, reseeded, restarted, or stopped. No migration, index-fixture, acceptance suite, or test mutation was executed. No new service, browser, or simulator was started. This grader’s Node export process (pid 37977) exited on its own.

After observations the same pid/cwd/listener were still present; writers 5361/77770 still absent.

---

## 4. Snapshot identity / export normalization

Verified against `/Users/ccheever/clique-improvement/next-run/astra-008-m7/snapshot-identity.json` and sibling `export-starter.mjs`.

| Artifact | Bytes | SHA-256 | Match |
| --- | --- | --- | --- |
| `private/snapshot-01.canonical.json` | 31818 | `85cc884596c8afb0165da078e542199f79069f5e24fe20dd9c1900ad6d3f2c93` | exact |
| `private/snapshot-01.supplementary.canonical.json` | 40324 | `a0023045e587351043ed8630fa8b7c488b2065e0c2cff471d5fd0d548e569c45` | exact |

Identity file internals match those file hashes. Unique messages 15; per-persona message objects 48; `sqliteUsed: false`; tokens not retained.

Canonicalization in `export-starter.mjs` (SHA `ebe6e817ebb3ac246ec0ab069b4b8730bc1121fd55b94c3196bfbd4dcf60f366`, 8738 bytes): UTF-8 JSON, recursive lexicographic object keys, personas by persona ID, conversations/messages/members/reactions deterministically sorted, no whitespace or trailing newline. Transport: custom-client API history composition using **each** persona bearer token. This grader reused that normalization independently and did **not** execute the builder’s post-migration comparator.

---

## 5. Installed snapback2@0.0.8 and authored source integrity

`installed-expected.json` lists **153** package files: 150 under `snapback2` plus 3 under `snapback2-darwin-arm64`.

Before and after API observations:

- every listed file present
- every SHA-256 and byte length matched
- no extra files in either package directory
- `package.json` versions both `0.0.8`

Authored source under `/Users/ccheever/clique-astra008-m7` (245 files; excludes `node_modules`, `.snapback`, `artifacts`, `evidence`, `m7-correction`, `m7-evidence`, Pods/DerivedData): **0 changed, 0 added, 0 removed**. Listing SHA `d68c23c816619a6dc5ae5e31af11f29ab77d84b5b43ffb97f69de51143de1df6` before and after.

Documented history helper `scripts/custom-client.mjs` SHA `5d88f5c4063744a300eafa111db4cd6e1a5c519f861244f6a37e34ac33fa703d` (1130 bytes). App `package.json` SHA `24161346901ad21cb330ec91ef5cc5007bbcbd91214e3582d80bda78ac9cbdcf`; `package-lock.json` SHA `60d2f516f26bb0f3cbb2e8464885cb4b57adf9eb67fc7986e691cb2cee009473`.

The owner process was not asked to reload source.

---

## 6. Independent API method

Script: `work/export-compare.mjs` (SHA `16c88c7235172be413f67a566a903cea057db476449a45731560b6b10ebc3ef5`). Ran as `cd /Users/ccheever/clique-astra008-m7 && node …/export-compare.mjs` so `snapback2/client` resolved; outputs written only under the grading workspace.

For each of the eight starter personas, in persona-ID order:

1. `auth.login` with original fixture email/password
2. close the login client; open a new client with the issued bearer token (token kept only in memory)
3. `auth.me` identity check against the login viewer; `profiles.mine` handle check
4. drain `chats.list`
5. for every conversation, drain documented `history()` (composes `messages.thread` + `messages.listReactions` + caller-relative `messages.receipt`)
6. `chats.info`, `chats.members`, drain `messages.thread` again for raw IDs
7. re-query `messages.receipt` on the caller’s own messages to see whether this session advanced receipts further
8. `social.own`, `social.counts`; Alice also drained `profiles.people`

No `messages.send`, `messages.acknowledge`, `polls.create`, `polls.vote`, or other mutations. Audit operations (274 rows): `chats.info`, `chats.list`, `chats.members`, `custom-client.history`, `messages.receipt`, `messages.thread`, `profiles.mine`, `profiles.people`, `social.counts`, `social.own`.

Then each original referenced asset was fetched with `assetUrl` + `assetBlob` using the owning persona.

Export window: startedEpoch `1788715153.961` → finishedEpoch `1788715157.179` (~3.2 s). SQLite/admin/database paths were not used to establish the assertion.

Observed canonical SHA `bec8161031352e5f32b73e29bf04add7854bee3893b2af796e7c64b541f99ff3` (175692 bytes). Observed supplementary SHA `b073ed070cfd2d7c67eba2b14cb61b04f777cdefddd6ecd16097dea1d0e187cf` (104587 bytes). Credential scan of those files found no fixture passwords or bearer tokens.

---

## 7. Original conversations and memberships

| Conversation | ID | Baseline messages | Observed original IDs | New messages in that thread | `chats.info.messageCount` |
| --- | --- | --- | --- | --- | --- |
| `d-alice-bob` | `s2id-…-000000000002bc01` | 6 | 6/6 for Alice and Bob | 40 new (suite/regression) | 46 |
| `g-starter` / Weekend Plans | `s2id-…-000000000002c001` | 9 | 9/9 for Alice, Bob, Carol, Erin | 0 | 9 |

Dave, Frank, Grace, Henry still have **zero** conversations, matching baseline.

Conversation identity fields (`accent`, `at`, `background`, `creator`, `description`, `disappearing`, `id`, `key`, `kind`, `peerA`, `peerB`, `title`, `ttlMs`) are unchanged for every owning persona. Additive field only: `messageCount` (M7 backfill). That addition is not a loss of original fields.

All six original membership rows remain. Identity (`id`, `conversationId`, `principal`, `role`, `joinedAt`, nested profile including avatar id/width/height) is unchanged. No members were added to original conversations.

Membership delivery/read watermarks are nondecreasing:

- Alice–Bob DM: Alice `readAt` 1788709548386 → 1788713835628 and `deliveredAt` → 1788713849445; Bob `deliveredAt` → 1788713849445, `readAt` unchanged. Both watermarks are **before** this grading export (start 1788715153).
- Weekend Plans: Alice and Bob `deliveredAt` advanced 163 ms to 1788709548554 (timestamp of the last original group message). Carol and Erin watermarks unchanged. `readAt` unchanged for all four.

Those watermark moves are login/delivery progression, not identity mutation. They line up with Alice having read the DM during later M7-session suite traffic (see §9) and with Alice/Bob connecting after seed.

---

## 8. Original 15 messages (M6 fields)

All 15 IDs are present in every owning persona’s drained history. Helper core fields other than caller-relative receipt are byte-for-byte equal to baseline (48/48 core-equal, 48/48 reactions-equal). Extra observed helper fields on originals: none. Raw thread rows gained only additive M7 keys `visibleContribution: 1` and `pollOptions: null`; original raw keys `id`, `conversationId`, `author`, `at`, `body`, `clip`, `edited`, `expiresAt`, `key`, `kind`, `oncePhoto`, `photo`, `quote`, `tombstone` are unchanged.

Prefix `s2id-c892da222fc55cacb93d3bbba58ee31d-`.

### Direct chat `d-alice-bob`

| ID suffix | Sender | Timestamp | Type | Text | Media | Edited | Tombstone | Quote | Reactions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `000000000002cc01` | alice `user:3aAkP0trJsLX382SvJ7gcQ` | 1788709548405 | text | Coffee after work? | null | false | false | null | [] |
| `000000000002f401` | bob `user:hcLyGIAkkqWoZUWR6qmOiw` | 1788709548428 | text | Yes. Corner place? | null | false | false | `…2cc01` | [] |
| `000000000002fc01` | alice | 1788709548436 | text | Exactly. Six thirty. | null | false | false | `…2f401` | [] |
| `0000000000030401` | bob | 1788709548442 | text | I will bring the route map. | null | false | false | null | [] |
| `0000000000030c01` | alice | 1788709548447 | text | Perfect, see you there. | null | false | false | null | [] |
| `0000000000031401` | bob | 1788709548454 | text | On my way. | null | false | false | `…30c01` | [] |

### Group `g-starter`

| ID suffix | Sender | Timestamp | Type | Text | Media | Edited | Tombstone | Quote | Reactions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `0000000000031c01` | alice | 1788709548460 | text | Saturday plan: coffee, lake, then noodles. | null | false | false | null | [] |
| `0000000000034801` | carol `user:HmWZUnXKLKLyhu9Rdf8aWQ` | 1788709548485 | text | Coffee is a definite yes. | null | false | false | `…31c01` | [] |
| `0000000000037401` | erin `user:M3v_Po_jky6aaQYGVpsjIw` | 1788709548511 | text | I can meet everyone at ten. | null | false | false | null | [] |
| `0000000000037c01` | bob | 1788709548517 | text | The west trail is dry now. | null | false | false | null | [] |
| `0000000000038801` | alice | 1788709548526 | text | West trail it is. | null | false | false | `…37c01` | [] |
| `0000000000039001` | carol | 1788709548532 | text | I will bring snacks. | null | false | false | null | [] |
| `0000000000039801` | erin | 1788709548539 | text | Should I book dinner? | null | false | false | null | [] |
| `000000000003a001` | bob | 1788709548547 | text | Please do, for four. | null | false | false | `…39801` | [] |
| `000000000003a801` | alice | 1788709548554 | text | Locked in. See you Saturday. | null | false | false | null | [] |

One persona’s receipts were never copied onto another. Non-own receipts remain JSON `null` in every case (33/33).

---

## 9. Receipts: permitted progression, distinguished from this session

Caller-relative receipts on the 48 original message objects:

| Classification | Count |
| --- | --- |
| other-null-preserved | 33 |
| own-unchanged (`sent` → `sent`) | 9 |
| own-permitted-progression | 6 |
| unexpected / backwards / substituted | 0 |

The six progressions are **only** in the Alice–Bob DM, and only on the caller’s own messages:

| Viewer | Message | Baseline | Observed |
| --- | --- | --- | --- |
| alice | `…2cc01`, `…2fc01`, `…30c01` | sent | delivered |
| bob | `…2f401`, `…30401`, `…31401` | sent | read |

Group own receipts remain `sent` for Alice (`…31c01`, `…38801`, `…3a801`), Bob (`…37c01`, `…3a001`), Carol (`…34801`, `…39001`), Erin (`…37401`, `…39801`).

Re-query of `messages.receipt` immediately after history returned the **same** values (`changedDuringObservation: false` for every original own message). So this grading drain did not further advance those receipts.

The progressed values were already present at first observation. They sit with membership watermarks at 1788713835628 / 1788713849445, which are after preclock (~1788709548) and **before** this export (~1788715154). That is prior M7-session login/read/suite activity on the live owner, not a migration rewrite of receipt semantics. Ladder is only `sent → delivered → read`. No backwards move. No non-own receipt became non-null.

Ordinary login/read-induced receipt advancement is permitted and was observed as already-settled prior activity, not as a mutation issued by this grader.

---

## 10. Profiles, posts, social counts, media bytes

**Profiles (8/8):** Alice through Henry. `id`, `principal`, `handle`, `displayName`, `bio`, `location`, `link`, and avatar `{id,width,height}` match the supplementary snapshot exactly.

**Posts (28/28):** identity payload `id`, `key`, `author`, `body`, `at`, `parent`, `images`, `clip` match. Caller-relative engagement (`liked`, `likes`, `reposted`, `reposts`, `replies`) also match. No new posts.

**Social counts (8/8):** `followers` / `following` / `followed` match per persona (Alice 4/2, Bob 2/2, Carol 1/1, Dave 1/1, Erin 1/2, Frank 1/1, Grace 2/1, Henry 0/2).

**Referenced API media (18/18)** downloaded and hashed against the preclock files in `/Users/ccheever/clique-improvement/next-run/astra-008-m7/private/api-media/`. Comparison is to **baseline API bytes**, not original fixture files (those fixture files were already a different hash at preclock because upload resized/re-encoded images).

| Asset ID | Bytes | SHA-256 (baseline = observed) | Source |
| --- | --- | --- | --- |
| `…0000000000001401` | 767 | `49bc61e66f9f4149ad05827edeb06867d34a735068cb0a38275f01b31549f941` | alice avatar |
| `…0000000000001c01` | 796 | `5e914eced908aef8c84b0e5948b0fa79e412a86a0785a2e8e47a5745d6512e9a` | bob avatar |
| `…0000000000002401` | 767 | `49bc61e6…f941` | carol avatar |
| `…0000000000002c01` | 796 | `5e914ece…2e9a` | dave avatar |
| `…0000000000003401` | 767 | `49bc61e6…f941` | erin avatar |
| `…0000000000003c01` | 796 | `5e914ece…2e9a` | frank avatar |
| `…0000000000004401` | 767 | `49bc61e6…f941` | grace avatar |
| `…0000000000004c01` | 796 | `5e914ece…2e9a` | henry avatar |
| `…000000000001d801` | 2118 | `5dbaca29bf4ae4b15a9c11b0fc767781e0cdf01ab4af9b83430c243288cd72df` | post `sp0002` images[0] |
| `…000000000001dc01` | 2125 | `3cb5eed569e22512018524d101580f9aa990248a6af3f2c29481eb9fa32aa87a` | post `sp0002` images[1] |
| `…000000000001e401` | 49779 | `7e22b943746b2c858910252162f624cac396eb9e4f4100ae80e70431b7883d5f` | post `sp0003` clip |
| `…0000000000020001` | 2118 | `5dbaca29…72df` | post `sp0008` images[0] |
| `…000000000001fc01` | 2125 | `3cb5eed5…a87a` | post `sp0008` images[1] |
| `…0000000000020801` | 49779 | `7e22b943…3d5f` | post `sp0009` clip |
| `…0000000000022401` | 2118 | `5dbaca29…72df` | post `sp0014` image |
| `…0000000000022001` | 2125 | `3cb5eed5…a87a` | post `sp0014` image |
| `…0000000000024401` | 2118 | `5dbaca29…72df` | post `sp0020` image |
| `…0000000000024001` | 2125 | `3cb5eed5…a87a` | post `sp0020` image |

All 18 `match: true`. Copies stored under `private/api-media/` in this grading workspace.

---

## 11. New legitimate polls / regression messages (separated)

These exist **in addition to** the original 15. They do not replace or alter original IDs.

Observed raw messages now: **73** unique = 15 original + 58 new.

**14 new conversations** (keys): `m7-suite-1788711162028`, `m7-choreo-1788711162028`, `m7-bounds-1788711215461`, `m7-suite-1788711244896`, `m7-choreo-1788711244896`, `group1-1788711309800`, `group2-1788711309800`, `m7-expiry-1788711348521`, `m7-suite-1788711564020`, `m7-choreo-1788711564020`, `group1-1788713835206`, `group2-1788713835206`, `m7-suite-1788713916248`, `m7-choreo-1788713916248`.

**13 new poll message IDs** (all in those new groups, none in `g-starter` or the original DM):

`…009e804`, `…00a1c01`, `…00a7801`, `…00ab001`, `…00b3c07`, `…00b7801`, `…00bd401`, `…0106c01`, `…010b001`, `…0111801`, `…0421402`, `…0425801`, `…042c001`.

**40 new messages in the original Alice–Bob DM**, timestamps 1788711310… and 1788713835… / 1788713849…, texts such as `Quoted original 1788711309800`, `Between the quoted messages N`, `image suite 1788711374464`, `video suite 1788711374464`, `Once proof 1788711442533`, `Push 1788713849143 …`, `Custom client demo 1788713849444`. Types: 36 text + 3 image + 1 video in Alice’s drain of that thread. Those timestamps collide with the new suite/group keys above. They are M7-session regression/suite/demo traffic on the live owner, not missing originals.

`g-starter` still has exactly the original nine IDs and no extras.

A correction-lane helper snapshot `app/m7-correction/m3-helper-1-after.json` (schema `m7-correction-fixture-api.v1`) is keyed to the same baseline SHA `85cc88…2c93` and still addresses original conversation `…002bc01`. That file was opened only far enough to confirm causal custody of post-clock fixture API work against this baseline. Its comparison/pass summaries were not read and were not used.

---

## 12. Failures and limits

**Failures:** none that defeat m7-a08. No missing original message, conversation, member, profile, post, or media ID. No unexplained original-field change. No receipt substitution across personas. No SQLite substitute for the API.

**Limits (not failures):**

1. Baseline has no message media and no reactions; surviving empties do not prove populated-message-media or populated-reaction preservation.
2. This session’s first receipt observation is after login. Further change during the drain was shown not to occur; the `sent→delivered/read` DM moves had already happened before this export. Login itself is not separately snapshotted.
3. Additive M7 fields (`messageCount`, `visibleContribution`, `pollOptions`) were not in the preclock objects; they are schema additions, not losses.
4. No complete M7, native M6/M8, metering, O-score, or cross-lane eligibility is inferred.
5. Builder post-migration comparators and suite receipts were not executed or trusted.

---

## 13. Input / output hashes

| Item | SHA-256 | Bytes |
| --- | --- | --- |
| `m7-assertions.json` | `4e23d853855d6df8d64d69e8322492e7b68704d5280befda31a83da5a22ccc30` | 2774 |
| `M7-frozen-brief.md` | `79e9d2885d2a2438aa6e8bcc08c747fb3d205fb604c79cdca2a728cec6b465fa` | 2450 |
| `M6-frozen-field-manifest.md` | `59b5dea03cca724861c9a7c9ff9d865bb777a4d7ceccf942fd7608431fa46ca2` | 395 |
| preclock canonical | `85cc884596c8afb0165da078e542199f79069f5e24fe20dd9c1900ad6d3f2c93` | 31818 |
| preclock supplementary | `a0023045e587351043ed8630fa8b7c488b2065e0c2cff471d5fd0d548e569c45` | 40324 |
| `snapshot-identity.json` | `9a8a69a0707a2ae9dac10bdb97c18bd499914306853628957ef720fe3acffb82` | 6553 |
| `export-starter.mjs` | `ebe6e817ebb3ac246ec0ab069b4b8730bc1121fd55b94c3196bfbd4dcf60f366` | 8738 |
| `installed-expected.json` | `7d4a4fcc31f5ab0efdebeac54b8cf2c4057a055ea935f5d1c0d1ac36c58faed1` | 22784 |
| `personas.json` | `605e4dedeba7c75625ee34ddfd711c4af51937321c69f97949741ef3ccef32a7` | 3974 |
| app `custom-client.mjs` | `5d88f5c4063744a300eafa111db4cd6e1a5c519f861244f6a37e34ac33fa703d` | 1130 |
| app `API.md` | `a27454957f01d5f0d9a2cc98e1c2393fe7bb3532343f1b9aaca9815fe6bbd7a9` | 7308 |
| grader `export-compare.mjs` | `16c88c7235172be413f67a566a903cea057db476449a45731560b6b10ebc3ef5` | 32616 |
| observed canonical | `bec8161031352e5f32b73e29bf04add7854bee3893b2af796e7c64b541f99ff3` | 175692 |
| observed supplementary | `b073ed070cfd2d7c67eba2b14cb61b04f777cdefddd6ecd16097dea1d0e187cf` | 104587 |
| observed API audit | `4ec05f1d7f764c08d0245ba3375d5b829ff4031661ebd9061735bc936e5d7f72` | 57821 |
| `work/comparison.json` | `2b73d5825fb207da915f68d02a810636a4294fc9f6d00ec692ba74b21a8a68d5` | 267558 |

Evidence files: `work/comparison.json`, `work/runtime-before.json`, `work/runtime-after.json`, `work/installed-before.json`, `work/installed-after.json`, `work/source-before.json`, `work/source-after.json`, `work/snapshot-identity-verify.json`, `work/media-downloads.json`, `private/observed.*.json`, `private/api-media/*`.

Owner 27250 remains the listener on `127.0.0.1:51000`. No publication, commit, or push.
