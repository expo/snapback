# M7 uncalibrated diagnostic — sanitized evidence

Grader: Grok / grok-4.6. Builder family: Codex. Instrument: snapback2@0.0.19 social-messenger. Neutral handoff: `setup/assessment-input.json`. Clock: 2026-09-08T17:37:00Z–2026-09-08T17:53:10Z. Session outcome: completed. calibrationPassed=false. sameFamilyGraded=false. No holdout probe set was preregistered (`probeSetSha256="not-preregistered"`); O1–O5 and B8 were not scored.

This trace redacts credentials, tokens, and incidental personal data. Fixture personas are named only as alice/bob/carol/etc. Raw logs, Playwright screenshots, and snapshot JSON remain under `results/private/` for audit.

## Identity and isolation

- Installed CLI: `snapback2 0.0.19` (`setup/installed-version.json`; live `node_modules/.bin/snapback2 version` matched).
- `setup/final-source-manifest.json` sha256 `035ef999a9f5d804d32a06a0265245305663fd01e670cc19d2ba84802da0dcf1` matches `assessment-input.sourceManifestSha256`.
- Data copy: stopped migrated `.snapback` (not reseeded). `setup/data-copy.json` recorded storeSha256 `9aa9b9bd…`. Before owner start the live `store.sqlite` hashed `e3df4995…` (size unchanged, no WAL). Difference is recorded as copy/open-time SQLite bytes, not as a reseed. No `snapback2 reset`, seed, or `--apply-migration` was run.
- Owner generation after start: `030479ec81d67bc3fb9ef9bc7b0f27a3848dd6d9300f4b74dc4738ea3274bb03`, status ready, listen `127.0.0.1:53132`.
- Owned processes: backend PIDs 34728/34730/34731; web PID 36513 on `127.0.0.1:53133`. No contact with 53120–53131 or 53134+.
- Environment: Node 24.18.0 via Volta prefix; `CI`, `SNAPBACK2_COMPILER`, `SNAPBACK_BIN`, `SNAPBACK2_BIN`, `CARGO_TARGET_DIR` unset; `SNAPBACK_URL`/`EXPO_PUBLIC_SNAPBACK_URL=http://127.0.0.1:53132`, `CHOREO_BASE_URL=http://127.0.0.1:53133`; `TMPDIR` under the assigned tree. Expo export used private `tmp/expo-export-1788889414-36206` and `--clear`.
- Export binding check (`results/private/export-binding-check.json`): ClientProvider const and CliqueApp const both inlined `http://127.0.0.1:53132`; no 53120/53134/3210 URLs. Navigated only after that check.

## Phase 0 — read-only data-custody preflight

Derivative helper `results/scripts/assessment-snapshot-53132.mjs` (original `setup/snapshot.mjs` sha256 `e55c2550…` left unmodified; original endpoint gate remains 53134).

Preflight capture `results/private/preflight-api-snapshot.json` (endpoint 53132):

| coverage | pre-M7 | post-migration | root-post-author | preflight |
|---|---|---|---|---|
| uniqueConversations | 2 | 2 | 3 | 3 |
| uniqueMessages | 15 | 15 | 38 | 38 |
| visibleMessageCopies | 48 | 48 | 104 | 104 |
| receiptRows | 81 | 81 | 170 | 170 |
| image/video/reacted | 0/0/0 | 0/0/0 | 3/3/0 | 3/3/0 |

Query/cursor/embedded-list scope (all four snapshots): `chats.list` + `messages.thread`; every starter persona; every returned cursor page. `messages.thread` embeds at most 10 reactions and 50 receipt rows. Media comparison is reference fields, not fetched bytes. Observed `messagePages` stayed 1. `chats.list` used a second empty complete page after a capped first page.

## m7-a08 — snapshot comparison

`setup/pre-m7-snapshot.json` vs `evidence/migration/post-migration-snapshot.json`: unique message payloads equal; 15/15 IDs; 0 M6-field diffs; 0 reaction diffs; 0 receipt changes. Conversation IDs `d-alice-bob`, `g-starter` only.

`setup/root-post-author-snapshot.json` vs preflight: 0 missing IDs, 0 field diffs, 0 receipt changes on the post-author corpus. Endpoint 53134 vs 53132 and capture timestamps differ. Coverage totals match.

Pre-existing starter IDs sm0001–sm0015 remain in `messages.offlineHistory` after author tests and this assessment. Independent field compare against the pre-M7 snapshot: 0 diffs on id/conversationId/sender/at/kind/body/image/video/edited/tombstoned/replyTo/viewOnce/expiresAt.

Receipt advancement on sm0007–sm0015 from pre-M7 to post-author/preflight: monotonic `sent`→`read` on existing recipient rows (no missing/extra recipients). Accounted as legitimate later tests/clients opening threads (DeliveryPump marks delivered/read). New rows after migration are acceptance/demo/choreography IDs (`accept-*`, `custom-demo-*`, `m7-choreography-poll`, `m7-acceptance-group`), not replacements of starter identities.

Empty populated-value classes in the pre-M7 snapshot: image=0, video=0, reacted=0, edited=0, tombstoned=0, viewOnce=0, expiresAt non-null=0. Media/reaction intactness for *pre-existing* rows is vacuously empty in those classes. Later snapshots gained media from subsequent tests, not from the pre-M7 corpus.

A final match does not prove uninterrupted availability during the migration window. The post-migration snapshot is the closest supplied after-migration capture.

## thread-cursor

`messages.thread` is `last 20 by byConversationTime`. On `d-alice-bob` after later tests (42 visible rows) the first page was `state=capped`, `next=null`, `n=20`. Starter sm0001–sm0006 are absent from that page and from the snapshot helper, which only follows `next`. They remain in `offlineHistory` (oldest-first, paginated with real `next` cursors) and `groups.settings.messageCount` is 42. Filed as defect d-01. This is not treated as migration data loss.

## Pre-M7 count structures and backfill scope

`setup/pre-m7-schema.q` already declared `maintain messageCounts = count messages by conversationId` (and member/receipt aggregates). It had no poll tables and no `visibleMessageCount` column.

Current `snapback/schema.q` keeps `messageCounts`, adds `maintain visibleMessageCounts = count messages by conversationId, tombstoned`, `pollVoteCounts`, and required `conversations.visibleMessageCount`. `snapback/admin.q` job `backfillConversationMessageCounts` sets that field from `#visibleMessageCounts[id, false]`. Backfill scope is every retained conversation row’s visible (non-tombstoned) count. Raw count structures predated M7; the forced-migration field is the new required visible count plus the tombstone-split aggregate.

## Documented M7 acceptance

Command: `npm run acceptance -- --milestone m7` with `SNAPBACK_URL=http://127.0.0.1:53132` and `CHOREO_BASE_URL=http://127.0.0.1:53133`.

Result: pass. Receipt `app/artifacts/suite-m7-1788889521.json` (copy `results/private/acceptance-receipts/`). Tests:

- `m7-polls-count-backfill-maintenance` pass (210 ms). Detail: baselineCounts dm=36 group=10 at suite time; boundsRejected=4; pollDelta=1; textDelta=1; tombstoneDelta=-1.
- `m7-prior-green-regressions` pass (30100 ms). Nested regression-m1/m2/m4/m5/m6/m8 pass. excludedPriorFailure=m3.

Coverage bytes after the suite: sha256 `29cab2533f1113f7900c5d1940afcf129636561539d26f61a365c1487b911d7f`, identical to the pre-suite file and `coverage/manifest.json` pin.

## Coverage spot-check

Sampled suite-required IDs m7-a01, m7-a03, m7-a04, m7-a06, m7-a07, m7-a09. Mapped tests exist and exercise the named operations (create bounded poll, change/retry vote, read pre-existing counts/IDs, increment/tombstone, spawn prior suites). Verdict: honest. The m7-a06 suite oracle for pre-existing conversations is a floor plus starter ID presence, not exact visible-count equality; exact equality was checked independently.

## Independent API (`results/scripts/independent-m7-api.mjs`)

### m7-a01

Rejected: empty second option, 201-char question, 51-char option, DM poll. Created 200-char question, 4 options, first label length 50. Count +1. Pass.

### m7-a03

Vote A then B: counts 0 and 1; vote.optionId = B. Pass.

### m7-a04

Duplicate mutationId on B: count stayed 1. Pass.

### m7-a06

At independent-check time (after the suite added more DM rows):

- d-alice-bob: settings/visibleMessageCount=42, offlineHistory rows=42, visible=42, tombstoned=0, expiredPresent=0, polls=0. Starter sm0001–sm0006 in offlineHistory: all true. Thread rows=20 (capped, next null); starter IDs false in thread.
- g-starter: settings/visibleMessageCount=10, offline rows=10, visible=10, polls=1 (m7-choreography-poll). Starter sm0007–sm0015 present in both offlineHistory and thread.

Pass on exact visible-count match plus starter ID presence.

### m7-a07 (API)

Isolated group: text +1 then tombstone restored prior count. Pass. UI below.

### m7-a02 (API subscription, supporting)

Three Carol subscriptions on a fresh poll: deliveries saw count>=1 in 30/6/5 ms. Not a substitute for two-client UI.

## Independent browser (frozen Playwright `choreography/node_modules/playwright/index.mjs`)

Two isolated contexts, alice and bob, against the 53133 export.

### m7-a02

Fresh poll “Browser live tally?” in group “Assess M7 mtsyriks”. Best-of-three retained attempts:

1. alice→bob option A: 0→1 in 117 ms, pass
2. alice→bob option B (vote change): 0→1 in 121 ms, pass
3. bob→alice option A: 0→1 in 120 ms, pass

Best 117 ms. Bound not specified by the brief; judged as live other-client update. Author-session `evidence/migration/m7-choreography-attempt-6.jsonl` also passed with visibleMs 168.4/168.1/170.8.

### m7-a05

Bob context `setOffline(true)`, click option B: pending (`aria-busy` or `data-pending`) observed. Reconnect: Alice tally 1→2. Pass. Author-session choreography attempt-6 also passed.

### m7-a07 (UI)

`sm-chatsettings-messagecount` on the assess group: 3 (matches API after two polls + the browser poll; tombstoned text excluded). Weekend Plans settings retry: 10, 4 members, disappearing off. First Weekend Plans navigation in the combined script timed out after poll compose; retry on a fresh page succeeded. Count is shown in chat settings.

### m7-a01 (UI compose)

“Create poll” composer on Weekend Plans submitted; at least one `sm-poll` remained visible.

## m7-a09

Previously-green milestones M1, M2, M4, M5, M6, M8 still passed under this copy. Nested M1 used this session’s 53132/53133 (including the authenticated web screen). M3 was not executed and is not a required repair.

## Defects beyond the checklist

**d-01 major.** `messages.thread` (`snapback/messages.q` line 31: `last 20`) returned `capped` with `next=null` on a 42-message DM. API.md says capped pages carry a cursor and to stop when `next` is null. Older starter messages are then invisible to thread/snapshot clients while still present on `offlineHistory` and counted in settings. Not scored as m7-a08 fail because the rows exist and post-migration snapshot matched pre-M7 before later tests grew the DM past 20.

## Excluded dimensions

O1–O5 null: uncalibrated diagnostic, no preregistered probes, no O-scoring commission. B8 not scored. Native/simulator not re-run. Builder diaries, self-scores, transcripts, and sibling lanes were not read.

## Artifacts

- `results/grader-report.json`
- `results/sanitized-evidence.md`
- `results/scripts/assessment-snapshot-53132.mjs`, `independent-m7-api.mjs`, `independent-m7-browser.mjs`, `compare-snapshots.py`
- Private: preflight snapshot, snapshot comparison, API/browser JSON, acceptance receipt copies, screenshots, owner-generation, export-binding-check, owned-process log
