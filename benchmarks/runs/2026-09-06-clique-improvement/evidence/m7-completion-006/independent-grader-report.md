# Independent M7 diagnostic grade — Clique / snapback2@0.0.6

Grader: Grok 4.6 xhigh. Diagnostic outcome grading of the frozen fresh-session M7 handoff. No numeric holistic score, no model ranking, no inferred cap compliance, no invented calibration. Author diary, essays, experience assessments, recording-supplement, prior model scores, live008, and productfix work were not read.

## What was graded

Frozen handoff `/Users/ccheever/clique-improvement/next-run/astra-006-m7/frozen-final/`.

| Artifact | SHA256 | Check |
|---|---|---|
| `app-source.tar.gz` | `bc6867d0cb6af091f551bf4b36fe473e32ba2dd34bb6b1982f9cb5433ee416ab` | matches freeze.json |
| `source-files.json` | `8e5bf8a694eefcb7e3ffa784a96132a7af70ce22998bdfec6c8b738105bc2a11` | 332 files, extract hashes match |
| installed `snapback2` | 0.0.6 | lock unchanged after `npm ci` |
| compiler.mjs | `9c93d2adc425eab14d977a2a8b0d1228a0a5c8c27c4e59bc889efe9863490a78` | match |
| client.mjs | `2a2e7e7c3ed65232b1d6c03bb933896ded12ea2332645d98aedc1e27c7fc2f80` | match |
| Darwin binary | `52d7de9c0c31c3e1cd4df59a3afb438d664f428b25bc68994952ece14ace4955` | match |
| original handoff `store.sqlite` | `d8d0f9dd6b8fdf7d86577793056a106c80a2b9e21625b6112ec6a0f6a1c42456` | untouched after grading |
| schema generation | `cd375aaf42120b79ef01975d9d8b20309dc1d97f4cb573ff82870639b2e7a994` | `snapback2 check` ok, no successor refusal |

Source was extracted into `app/` with path-traversal and symlink checks (`extraction-receipt.json`). Backend-state was APFS-copied to `app/.snapback` and never written back to the handoff. Own ports only: 50720 backend, 50721 Expo overlay, 50722 push provider, 50730/50731 disposable M3. Original 50700–50702 and 49100–49102 were not used or stopped.

Frozen `client.web.ts` still points at 50700. An Expo overlay copy (`app-web/`) remapped only that URL to 50720. Endpoint-only copies of frozen scripts live under `grading-copies/` and `app/m7-grading/` with recorded hashes. Product source in `app/` was not repaired.

## M7 assertions (frozen `assertions.json`)

Instrument pin: `social-messenger` VERSION `0.3.0-m8`, assertions SHA256 `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`.

### m7-a01 — Create a group poll (2–4 options) — **pass**

`api.polls.create` committed a 2-option poll (`Coffee` / `Walk`) and a 4-option poll in a new isolated group. Custom-client history projected `type: "poll"`, question in `text`, and `pollOptions`. Non-group (DM) create was refused `GROUP_REQUIRED`.

Separate bound misses (empty question / empty option accepted) are recorded below; they do not erase successful 2–4 option creation.

### m7-a02 — Members vote; live tallies — **pass**

API: Alice voted option 0; Bob’s `polls.state` showed `a=1` without a local selection. Changing Alice’s vote moved Bob’s view to `b=1`. Bob then voted option 1 (`b=2`).

UI (second attempt, `evidence/ui-live-retry.json`): both clients showed 14 poll options; Alice click moved Bob’s tally `0 → 1` in **397 ms**. Attempts 2–3 on the same option did not increment (one vote per user, set-state). First UI attempt failed only because Alice’s remount had not yet painted options.

Lane option identity is `${message.id}-option-${i}`, not the choreography default `m7-option-a`. Choreography against the default adapter would not find those IDs without an adapter override (author `m7-verification/` was excluded from the archive).

### m7-a03 — Changeable one-vote set-state — **pass**

New `mutationId` switching Alice from option 0 to 1 yielded `mine=1`, `a=0`, `b=1` on both members.

### m7-a04 — Duplicate / stale retry — **pass**

Replaying `voteId1` with a different option after the first commit left the original option 0. After a newer `voteId2` selected option 1, replaying stale `voteId1` left option 1. Idempotent set-state held.

### m7-a05 — Offline queued vote / reconnect — **pass** (browser)

Playwright isolated context: Bob offline, click option, `aria-busy="true"` and visible “Vote pending” (`evidence/ui-bob-offline-pending-1788696822311.png`). After reconnect the option tally read `1`.

Headless `createClient` without a durable range store threw `SnapbackRefusal: client transport is offline` instead of enqueueing (`m7-api-grade-attempt3` `offline-vote-error`). That is a client-construction gap, not a disproof of the UI/SDK outbox path the product actually ships in `client.web.ts`.

### m7-a06 — Backfill of visible counts on pre-existing conversations — **pass**

`conversations` / `chats.byKey` / `chats.details` all expose `messageCount`. For both starter conversations the projected count equalled currently visible custom-client history (tombstones excluded; expired rows absent from history). All 15 starter keys `sm0001`–`sm0015` still resolve.

The pre-M7 snapshot has no `messageCount` field, so the exact numeric backfill at the migration instant is not in that snapshot. What is proved: existing conversations now carry a server-projected count that matches visible history, original IDs remain, and the migration comparison did not disturb those IDs.

Original starter: 15 text messages, 0 media, 0 reactions. Nonempty media/reaction preservation cannot be proved from emptiness.

### m7-a07 — Maintained forward, shown in settings — **pass**

| Event | Count |
|---|---|
| new isolated group | 0 |
| after committed polls (2 valid + 2 empty-bound commits) | 4 |
| after text send | 5 |
| after delete-for-everyone (tombstone remains in history) | 4 |
| isolated disappearing `24h` message at send | 1 |
| after real 3-minute expiry, clients closed | 0 |

Expiry timing (server timestamps): `sentAt=1788696670056`, `expiresAt=1788696850056` (exactly 180000 ms). Clients were closed at `2026-09-06T12:11:10.097Z`. Recheck 15052 ms after `expiresAt`: message gone from history, `messageByKey` null, `messageCount=0` (`evidence/expiry-check.json`).

Settings UI shows `Visible messages: N` (`sm-chat-message-count`) on both Weekend Plans (14 at capture) and the grading group (6). Frozen kit `sm-chatsettings-messagecount` is **not** rendered because `ChatSettingsForm` is not passed `messageCount`. The brief’s “shown in chat settings” is met by the lane’s own row; structural choreography that requires the kit ID would miss it.

### m7-a08 — Pre-existing messages intact vs pre-M7 snapshot — **pass** (migration), with later side effects

Independently re-ran the frozen comparator (path/URL remapped only) against the copied DB **before** this session’s new mutations.

| Boundary | pass | checks | diffs | Interpretation |
|---|---|---|---|---|
| comparison-before | true | 914 | 0 | Pre-M7 snapshot still matched immediately before M7 work |
| comparison-after-baseline | false | 914 | 2 | DM `disappearing` null→`off` — **baseline side effect**, not migration |
| comparison-after-migration | false | 914 | 2 | **Same two names** as after-baseline. Migration delta is empty |
| comparison-during-regression | false | 914 | 58 | +56 receipt / `hiProfile` diffs — **regression side effect** |
| comparison-final | false | 914 | 68 | +10 accent/background/receipt diffs — **later acceptance mutations** |
| this session, before new writes | false | 914 | 68 | Exact same 68 names as author final. Cannot be labeled unchanged |

Original message IDs were not missing. The only extra conversation field vs the pre-M7 object is `messageCount`. Receipt/reaction/media columns that were empty in the starter remain empty where not later mutated.

Applied migration plan is only `messages.kind` enum typeChange adding `poll`. `snapback2 check` on the copied state returned that generation and did not demand another successor.

### m7-a09 — Previously green suites still pass — **fail**

Previously green in the original continuous run: M1–M6 web; native M6 failed; M8 unresolved then later specified. Authoring-time regression was incomplete. Independent recheck:

| Suite | Result | Notes |
|---|---|---|
| M1 | **fail** (2 attempts) | a01/a02 completed; `/profile/edit` stuck on “Loading profile…” (`evidence/m1-suite-failure.png`) |
| M2 | **not-run** | Not executed in this session |
| M3 | **pass** on API + idempotent starter | Disposable copy on 50730 completed m3-a03/a04/a05/a14/**a15**; UI quote steps timed out on first Expo load |
| M4 | **pass** | m4-a01/a03/a06/a07/a09 |
| M5 | **pass** | m5-a04/a05/a08/a09/a10/a11 |
| M6 | **not-run** | Sample-50 receipts unavailable (not fabricated). `delivery.ts` still targets 50702. Native not run |
| M8 | **pass** | m8-a01/a03/a04/a05/a06/a07 |

Root’s preparation-only no-reseed restriction had blocked the frozen M3 idempotent-starter suite during authoring. This session ran that canonical suite, including its starter replay calls, against a **second disposable copy** of frozen-final backend-state (not a live lock-copy of the mutated primary DB, and not a reseeding of the original handoff). That is a verification-time accommodation. It is **not** an author-time pass.

Native M6 is explicitly unverified here (live008 simulators were booted; this session did not take them). Prior native failure is preserved, not repaired.

## Additional M7 requirements (brief, not only the 9 IDs)

**Poll bounds — fail.** Max-length and cardinality rejects work (201-char question, 1 option, 5 options, 51-char option). Empty question `""` and empty option `""` **committed**. Mutation args declare `body: text 1..200` and `options: [text 1..50]`; the table `messages.body` is `text <=2000` without a min. UI `PollCompose` disables submit on empty question, so the kit gates a hole the API does not.

**Membership refusal — pass.** Non-members cannot create or vote (codes `MEMBER_REQUIRED` / `MESSAGE_REQUIRED`). Polls are group-only (`GROUP_REQUIRED` on the starter DM).

**Backfilled-field shape — pass (not waived, not assumed as a stored column).** Pre-M7 original source had no count structures. Frozen schema adds:

```
maintain visibleMessageCounts = count messages by conversation, tombstone, expired
```

`conversationCard` projects

```
messageCount: #visibleMessageCounts[.id, false, false]
  + #visibleMessageCounts[.id, false, null]
  + #visibleMessageCounts[.id, null, false]
  + #visibleMessageCounts[.id, null, null]
```

Compiled schema shows a real `visibleMessageCounts` table (`conversation`, `tombstone`, `expired`, `value`) with member read and deny insert/update/delete. That is a persisted maintained aggregate plus a server-projected field. It satisfies the backfilled-field requirement without a literal `conversations.messageCount` column. SQL was used only to explain layout on a clone of the original sqlite; acceptance was proved through the ordinary API.

## Source delta vs original-source

`frozen-integrity.json` sourceChanges (11 paths) match the files that differ between `m7-run/original-source/` and frozen `app/`: `API.md`, `components/Chats.tsx`, `components/client.web.ts`, `components/client.native.ts`, `scripts/clique-client.mjs`, `scripts/semantic-props.cjs`, `snapback/chats.q`, `snapback/delivery.ts`, `snapback/ephemeral.q`, `snapback/media.q`, `snapback/schema.q`. New product files not in original-source: `snapback/polls.q`, `components/Polls.tsx`.

## Limitations and accommodations

- Never invoked hardcoded original endpoints. Endpoint-only script copies and an Expo client overlay were used; diffs/hashes are in `grading-copies/copy-receipt.json`.
- Notification seam in product `delivery.ts` remains `http://127.0.0.1:50702`. This session’s provider listened on 50722 and did not receive those fetches.
- Fixture password login against the copied DB; tokens never printed.
- No holdout probes, no O-dimension scores, no publication.
- Attempts retained (`m7-api-grade-attempt1/2/3`, two M1 runs, UI attempt plus live retry). No best-attempt rewriting of expected results.
- Accidental `snapback2 dev` without `--port` briefly bound 60844 and was stopped immediately; 49100 remained up.

## Cleanup

Own processes on 50720–50731 are stopped after this report (see `logs/cleanup.json`). Foreign listeners (49100–49102, live008, other lanes) were not signalled.
