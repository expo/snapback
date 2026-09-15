# Clique on snapback4@0.2.21 (Astra, medium effort): friction review against the 0.2.19 lane

**Short version.** Holistic score 88, down from 91. The builder logged 24 correction or error entries: 19 agent-error, 2 environment, 2 ambiguous and 1 snapback4-defect (`final-report.md:84-87`). The one defect is the password minimum. Built-in signup counts 8 UTF-8 bytes, not 8 characters, and nothing configures it (run log 1789484744).

Waves 4 and 5 closed six of the 0.2.19 items, and the builder used each fix directly:
- **W4a.** Group admin removal goes through the local client's `mutate` (`src/Chats.tsx:522,600`). M3's removal check passed on its first attempt, and the navigation-loss string appears nowhere in lane evidence.
- **W5a.** Every scale replay ran under `dev --replay`. No app replay flag remains in `snapback/*.q`.
- **W5b card text.** Reactions use the prediction card's membership shape and predict their first insert. L19's d-06 did not recur.
- **W5c opener.** The starter's `await c.sync()` when online is in `src/client.ts:17`, with no loop.
- **W5f.** The dense Following query is written inline (`social.q:78`), and no spelling refusal was logged.
- **W5g.** The builder used `clock advance` in three proofs, a calendar offset in the digest generator, and the starter's Metro `blockList`.

Three fixes shipped but went unused, and one went unexercised. Unused: `init --recipe feeds`, the scheduled Trending recipe, and `client.acquired`/`usePendingWrite`. Unexercised: presence under `clock advance`.

Five problems are still Snapback's:
- **Following.** For the second run in a row, an independent builder chose the same design:
  1. A read-time merge, which measured 4.31× at 500 follows.
  2. Then a filter over the global timeline, which leaves `N_SPARSE_FILTER`.

  This happened even though `N_WIDE_MERGE` (from M2 on) and the feeds card both name `init --recipe feeds`. Inference: the recipe cannot be dropped into an app that already has `follows` and `posts` tables and a media post model. The scorer charged the result in queries_and_live and scale_and_limits, and the grader filed it as d-03.
- **Password minimum in bytes (d-02).** This is unchanged since 0.2.19. This builder's audit found it and logged it as a defect, and the scorer charged it in authorization.
- **"predicts: eligible" hid a horizon guard.** A message-id existence check silently removed offline pending bubbles. The fix took about 5 minutes and added a ledger table plus a backfill. The essay calls the heading "not enough", and the scorer quoted that in diagnostics.
- **Exact Trending.** The builder read the scheduled recipe and declined it because of its one-minute lag. It scores in the write path instead, on a public table with `update <- allow`.
- **Smaller costs:**
  - `N_NO_HORIZON` recommends the very horizons that would break the prediction proofs the prediction card asks for.
  - `use identity` leaves guest sessions on (d-01).
  - The attribution columns still need a backfill, and the digest still runs one profile per chunk.
  - The README grew another 11.7%.
  - `clock advance` expired a live worker's effect lease.

**Score drops.** None traces to a 0.2.21 regression:
- **authorization −6:** the unchanged byte policy, newly disclosed.
- **queries_and_live −5 and scale_and_limits −6:** the same sparse-filter design L19 shipped, narrated more starkly in the candid gap list and a README section, plus N=1 scorer variance.
- **writes_and_transactions −3:** the builder's own intent ledger.
- **diagnostics_dev_loop −2:** the "predicts: eligible" complaint.

**Regression check.** No regression from waves 4–5 is established. One item should be verified: `E_EFFECT_LEASE` after `clock advance` (V4).

Lane: `/Users/ccheever/clique-sb4-20260915-astra-cal5/lanes/astra-snapback4/` (L21 below). The previous lane is L19 (`/Users/ccheever/clique-sb4-20260915-astra-cal4/lanes/astra-snapback4/`). Paths without a directory are under L21's `evidence/`. Clock times are file modification times in local time; run start 1789480667 is 06:57:47, and epoch 1789480800 is 07:00:00. Between 0.2.19 and 0.2.21, two releases shipped: 0.2.20 (wave 4, LLP 3000.007 §20.13) and 0.2.21 (wave 5, §20.14). "Package README" means `node_modules/snapback4/README.md` in L21 (142,262 B).

---

## 1. Friction in the 0.2.21 run

### 1a. Friction the builder hit that Snapback caused

H-numbers are this review's items. G-, M- and d-numbers refer to FRICTION-0.2.19.

| # | Friction | Evidence | Cost | Inventory row |
|---|---|---|---|---|
| H1 | **The password minimum is 8 UTF-8 bytes, with no policy knob** (grader d-02) | **Docs.** The personas card (`guide-auth-final.txt:41`, read 08:05:23) says "Signup accepts 8–1,024 password bytes"; package README:1728 says the same. `use identity` has only three forms: plain, `guests`, `password` (package README:1733-1734).<br>**Probe.** `auth-unicode-policy.json`: "Built-in signup accepted two Unicode code points totaling eight UTF-8 bytes".<br>**Builder.** Run log 1789484744: "published built-in server auth exposes no stricter character-count policy". The UI workaround is `src/Root.tsx:94-95` (`Array.from(password).length < 8`).<br>**Source (w4b checkout).** The constant is `snapback4-core/src/identity.rs:202-205`: "a password needs at least 8 UTF-8 bytes".<br>**Unchanged since 0.2.19.** L19's package README:1542 has the same sentence. | About 25 s: probe 1789484724, log 1789484744, M1 regression pass 08:05:46. The disclosure then appears in the README, `essay.md:130-136` and `final-report.md:197`. Scorer: authorization −6, and the overall note. | **New** (auth policy). This is the run's only snapback4-defect. |
| H2 | **Following: the read-time merge fails at 500 follows, and the rebuild filters the global timeline.** The recipe was not adopted. | **M2 note.** `m2-check.txt:14-16`: "N_WIDE_MERGE: query social.following: read cost grows with the number of related principals (up to 1001 lanes) … rewrite: … for Following, `snapback4 init --recipe feeds`".<br>**Card.** The feeds card was read at 07:44:29, 1789483469 (`guide-feeds.txt:3`: "Adopt: `snapback4 init --recipe feeds`"). `init.log` shows only the plain Expo init.<br>**Measurement.** `scale-final.json`: following500 p95 4.3046 ms vs following5 0.9987 ms. Run log 1789484066: "ratio=4.31 exceeds 3x. Added dense-follow global-index scan path at 100 follows".<br>**Rebuild.** `social.q:77-78`: `if followingCounts[viewer] >= 100: return events after c last 20 by byTime where .actorId = viewer or exists follows[viewer, .actorId] eventCard`.<br>**Warning.** `m8-adaptive-feed-check.txt:2-3`: "N_SPARSE_FILTER: events by byTime: this unscoped `where` pins no index prefix; sparse matches can exhaust the row meter and return short `complete: false` pages / rewrite: pin a leading index key, or run `snapback4 init --recipe feeds`". The card says to "use this recipe for Following rather than filtering the global timeline" (`guide-feeds.txt:324-326`).<br>**Result.** Final ratio 1.257 (`performance-summary.json`). The disclosed limit is in README "Known envelope tradeoff" and `final-report.md:198`. | 104 s (1789484066 → 1789484170), plus the scale-m8 revalidation replay (239 s, 1789484197–1789484436). Scorer: queries_and_live and scale_and_limits notes. Grader: d-03. Logged as agent-error. | **S14, S15** (G3 recurring) |
| H3 | **A message-id existence guard read through a horizon and silently removed offline prediction.** The heading said "eligible". | **Guard added.** Run log 1789484288: "send now reuses stable message IDs authoritatively".<br>**Only warning.** `m8-intent-check.txt:62-63`: "N_NOT_PREDICTABLE: media.sendMedia remains eligible; may queue without a row past the horizon … rewrite: remove a redundant guard, or read a synced fact without a horizon". It names `sendMedia`, not `send`.<br>**Why.** `why-send-final.txt:3-5`: "chat.send: predicts: eligible … Horizon: point messages by byId … (site chat.q:162:14 (messages[messageId])); may queue without a row past the horizon".<br>**Failures.** `offline-restart-final.log` (1789484560): `assert.ok(q.data.some((m) => m.id === id && m.pending))` failed. `m8-choreo-attempt4.log` (08:03:34): m8-a15 timed out "waiting for getByTestId('sm-convo-bubble')", and m8-a16 reported "dual-offline convergence did not yield receipted messages".<br>**Fix.** Run log 1789484594 adds a `sentMessages` ledger (`schema.q:49-64`) and a `backfillSent` job (`schema.q:65-67`; `m8-message-ledger-backfill.txt`: 82 rows).<br>**Prior warnings the builder had.** The card warned (`guide-prediction.txt:84-88`, read 07:11:00). Essay:77-78: "“Predicts: eligible” alone is not enough; the per-read coverage conditions are essential." | About 5 min from guard (1789484288) to fix (1789484594). One failed M8 choreography (green again at 08:06:39). A 31st table and a backfill. The final replay was rerun because it "includes no-horizon sent-message ledger" (1789484825, 292 s). Scorer: diagnostics_dev_loop note and offline_sync note. Logged as agent-error. | **S19, S20** (L1 family; the W5b heading covers insert arms, not main-path guards) |
| H4 | **Exact trailing-window Trending:** the scheduled recipe lags, so the builder hand-built write-path scoring on a public table with `update <- allow` | **Recipe read.** Lines 426-534 of the feeds card, read 07:44:29: "scores and new candidates lag by one schedule period (1 minute)" (`guide-feeds.txt:510-511`). The expire card still refuses value order over expiring sources (`guide-expire.txt:42-44`, E_QUARRY_MAINTAIN_EXPIRE).<br>**Reason given.** Essay:100-104: "A periodically rebuilt ranking would have introduced freshness lag that the brief did not allow."<br>**What was built.** `insights.q:26-41` (`expire at .expiresAt`, `update <- allow`, `sync public last 500 by byRank`). `createPost` and `like` write scores (`social.q:119,125-134`). The backfill is `insights.q:47-48`.<br>**Check.** `m8-check1.txt:62`: "N_NOT_PREDICTABLE: social.like remains eligible; may queue without a row past the horizon: point rankedPosts by byPost". `why-like.txt:3` says `predicts: eligible`. | Design only, no loop. The scorer did not charge Trending this run: the queries note drops it. | **S25**. **Changed:** like now predicts (G5 closed in effect), but the rule widening remains (M2). |
| H5 | **Join-attribution columns and a backfill remain** (G7 residual) | `posts.parentAuthorId` (`social.q:18,116`) and `events.authorId` (`social.q:35,118,142`) are stored by hand. `insights.backfill` is `insights.q:42-50`. `m8-backfill.txt`: "chunks": 4, "rowsWritten": 406. README: "`insights.backfill` populates the derived ranking and attribution fields". The anchor half closed (§2). | Part of M8 (1789483590–1789484808) | **S24** |
| H6 | **The digest runs one profile per chunk**, with `digestChatCounts` scratch rows | `digest.q:24` (`chunk p in profiles first 1 by byId`); scratch table `digest.q:1-9`; per-profile loop over up to 1,000 follows `digest.q:28-29` | Proactive design, no loop | **S26** (G8 recurring) |
| H7 | **An app-level intent ledger for set-state retries** | **Ledger.** `schema.q:35-47` (`intents`, `acceptIntent`), used by follow, like, repost, react and addMember (`social.q:92,122,137`; `media.q:38`; `chat.q:137`).<br>**Adapter.** The replay adapter passes fixture ids as `mutationId: a[2]` (`scripts/replay.mjs:58,64,97,125`).<br>**API gap.** `mutate<A, R>(op: Mutation<A, R>, args: A)` takes no write id (`node_modules/snapback4/dist/contract.d.ts:178`). `client.act(…, { id: mintId() })` does (package README:1304). The engine's at-most-once record is keyed by operation id (package README:274-278).<br>**Builder and scorer.** Run log 1789484288, source=model-knowledge. `intent-proof.json` passes. | Part of the 1789484288 loop; one more no-horizon table. Scorer writes_and_transactions: "Application-authored intent ledgers supply additional idempotency semantics". | **New.** **Shared blame.** L19 had no such ledger. Inference: a caller-supplied write id would have let the built-in record serve the replay adapter. |
| H8 | **Rows stamped under a dev clock offset stay in the future after restart** | Run log 1789484482: "allocate a fresh test store per invocation so dev clock offsets from a prior run cannot leave future rows after restart". The jobs card: "The offset belongs to this process and resets on restart" (`guide-jobs.txt:79-80`). | 16 s (1789484466 → 1789484482), plus a fresh store per M8 suite run. Logged as agent-error. | **S27** (new sub-item, low) |
| H9 | **Each asset belongs to one row**, so reusing a fixture uploads the bytes again | Diary M2: "every upload belongs to one row, so fixture reuse uploads bytes again". Scorer media_assets: "M2 required uploading fixture bytes separately for each owning row". | No loop. Scorer media_assets −1. | **New**, low |
| H10 | **Guide keyword miss** | `guide-aggregates.txt:1`: "no card named aggregates; nearest: maintains, jobs, residency". Run log 1789483756. | Seconds. The essay credits the redirect. | Low (the S01 alias path worked) |

### 1b. Problems visible in the evidence that the builder didn't hit or didn't mention

| # | Issue | Evidence | Inventory row |
|---|---|---|---|
| V1 | **`N_NO_HORIZON` recommends horizons that would break the prediction proofs the prediction card asks for** | **The notes.** The final check carries 7 `N_NO_HORIZON` notes (`m8-message-ledger-check.txt`). `reactions`: "rewrite: sync to members[.conversationId] last 500 by byConversation" (`m4-check.txt:14-16`). `sentMessages`: "rewrite: sync to .principal last 500 by byPrincipalKey" (`m8-message-ledger-check.txt:26-28`). `intents`, `likes` and `views` get the same kind of rewrite.<br>**The card.** "With `sync to members[.conversationId] last 500 by byConversation`, a first write cannot prove absence outside the window" (`guide-prediction.txt:124-126`). The no-horizon membership shape is at `:133-137`.<br>**Consequence.** Following the note would bring back L19's d-06 and H3's loss. | S16, S17 (**new contradiction**) |
| V2 | **`N_NOT_PREDICTABLE` fires once; `createPost`'s horizon reads persist silently** | **The note appeared once.** `m8-check1.txt:58-60` (07:47:26): "N_NOT_PREDICTABLE: social.createPost remains eligible; may queue without a row past the horizon: rule posts by byId: sync public last 500 by byTime". It is absent from `m8-digest-check.txt` (07:48:50) and every later check.<br>**Still in the final source.** The `rankedPosts` insert rule probe (`insights.q:37`) and an opening `if exists posts[postId]` guard (`social.q:103`) both read the horizon.<br>**Summaries.** They list only `chat.createDM` and `social.repost` (`m8-message-ledger-check.txt:66`). The card says "A loss of eligibility produces one `N_NOT_PREDICTABLE` note per mutation" (`guide-prediction.txt:23-25`).<br>**Inference.** An offline post queues without a row; the grader did not probe offline posting. | S05, S06 residual |
| V3 | **`use identity` leaves guest sessions on** (grader d-01) | `schema.q:1`. Trace §4.1: "`POST /auth/guest` returned a `guest` session. That guest then succeeded at saveProfile, createPost, and createDM with Alice." The language card documents `use identity password` (`guide-language.txt:16`, read 06:59:12). The starter schema is `use identity` (w4b `snapback4/apps/chat/snapback/schema.q:9`, copied by `crates/snapback4/src/verbs/init.rs:259`), and its opener mints a guest (`apps/chat-expo/src/client.ts`). No check note. L19 also had `use identity`; its grader did not probe guests. | **New** (starter default) |
| V4 | **`clock advance` expired a live worker's effect lease** | `digest-backend.log:9-10`: "snapback4: 1 effect lease expired; queued again", then "snapback4 worker: Error: E_EFFECT_LEASE: E_EFFECT_LEASE: effect effect-000000000000000a-0000000000000000 is queued and not claimed by this worker; claim it first", from `snapback4/dist/worker.js:36`. That run advanced 120 s (`scripts/digest-proof.mjs:145`). No duplicate was logged only because the app worker dedupes by effect id (`snapback/worker.mts:5-6`, written in M6). The package README describes lease loss only for "a worker that dies" (:852-853). **Inference:** dev leases run on the dev clock, so a handler without dedupe performs twice. **Not established** whether this predates W5g, which moved presence onto the dev clock. | **New. Regression candidate: verify.** |
| V5 | **A transient "viewer-repost … counted as a direct follow-projection hit", seen in both lanes** | L21: `m2-choreo.jsonl` repost-following-feed-surface attempt 2, and `m2-choreo-attempt1.jsonl` attempt 3. L19: `m2-choreo.jsonl` attempt 1. The app code differs between the two lanes. Candidate cause: the harness's `(value) => !value.direct` wait is satisfied by an empty Following list while it loads (`harness/tools/social-messenger/choreography/choreography.mjs:917-933,1540-1548`), then the page catches up. **Cause not established.** | None (investigate) |
| V6 | **Following is server-evaluated** (inference) | Both Following arms read `events`, which is `sync public last 500 by byTime` (`social.q:46`). Follow visibility is 495.8 and 470.9 ms, against 54.9/56 ms for likes (`m2-choreo.jsonl`); L19's was 440–505 ms. No `why following` was captured. | S14 (M3 recurring) |
| V7 | **Advisory noise grew to 16 notes** | `m8-message-ledger-check.txt:1`: "16 notes". The mix is 7 `N_NO_HORIZON`, 6 `N_MAINTAIN_SYNCED` ("no currently eligible mutation reads it"), 2 `N_WIDE_MERGE` and 1 `N_SPARSE_FILTER`; L19's final check had 7. The message-search `N_WIDE_MERGE` tells a membership search to "write the feed on the way in: a table of entries per reader" (`m5-check.txt:22-24`). Partly the builder's design: more no-horizon ledgers and synced counts. | S16, S17 (M7 recurring) |
| V8 | **Synthetic residency sites** | `why-send-final.txt:15-19` has five "Held: rule members …" lines, sited "(site update conversations rule)" ×2, "(site insert messages rule)" ×2 and "(site after insert)". `why-like.txt:13`: "(site insert if absent likes)". | S08 residual (M6 recurring) |
| V9 | **No replay line at dev startup** (inference) | The run log says these instances started with `--replay` (1789484826, 1789485698). Their logs (`scale-final-backend.log:1-4`, `scale-final-inspection-backend.log:1-4`) print only the development-only and Argon2 lines. `doctor` was not captured for a replay store. | Low |
| V10 | **The docs keep growing** | Package README: 142,262 B, against 127,362 B at 0.2.19 (+11.7%). The feeds card is 22,204 B against 16,600 B (+34%), because the recipe prelude and the Trending recipe were added. | G12 |

### 1c. Friction that was not Snapback's

- **Environment:**
  - Read-only copied harness needed `chmod` (run log 1789480770).
  - The harness snapshot lacked its JSON-schema helper and needed AJV (1789481023).
  - Node v25.9.0 on PATH against a declared 24.18.0 (1789481023); the grader's re-run was refused on the same mismatch (trace §3.1).
- **Instrument:**
  - The prompt waived simulator proofs (`prompts/astra-snapback4.md:12`), so the native assertions m6-a01..a07 and m8-a17/a18 are not-run and O4 = 30.
  - M7 was not run.
  - The frozen harness waits for disappearing messages in real time (302.8 s, trace §3). Diary M5 needed a second five-minute wait after a failed suite linkage.
  - The harness's `toggleFollow` tab assumption (1789481514) and DM rows on the base URL (1789483928) were logged as ambiguous.
  - No probe set was committed, so O3 is null.
  - The grader is uncalibrated (`calibrationPassed: false`).
  - The scorer is one N=1 session reading narrative only (`prompts/astra-snapback4.score.md`).
- **The builder's own errors** (`final-report.md:91-114`):
  - Metro crashed when the harness directory was moved under it (1789481059).
  - The profile form copied extra fields into mutation arguments (the `E_INPUT` diagnostic made the fix immediate).
  - A pagination assertion used post ids.
  - DM route resolution; creating an absent counterpart DM.
  - A case-sensitive label assertion.
  - A random handle; an empty optional URL (`E_INPUT: link must be an http or https URL`, `m6-suite-retry.log`).
  - A missing cwd; a TrendingRow prop; a relative launch path.
  - The seed ordering; a JSX replacement miss.
  - The 4.31× merge (H2's agent half) and the horizon guard (H3's agent half).
  - Clock-offset stores (H8's agent half).
  - The member picker capped at 50 profiles.
  - JSONL archiving.
- **App defects the grader found:** d-04 (likely a follow button reading a loading query, §4), d-05 (video bubble) and d-06 (binary unread badge).

---

## 2. The 0.2.19 items: recurred, closed, changed, or unexercised

### Explicit checks

- **`init --recipe feeds` and the feeds card.**
  - **Card read.** The builder read the card at 07:44:29 (1789483469), during M6 scale preparation (run log 1789483504). It had already seen the command in `N_WIDE_MERGE` since `m2-check.txt:15` (07:06:52).
  - **Recipe not run.** `init.log` records a single plain init.
  - **Global filter chosen.** The builder gives no reason for passing over the recipe. Run log 1789484066 and essay:80-94 present the global scan as the dense-reader tradeoff.
  - **Inference: four likely reasons.**
    1. Recipe tables `follows` and `posts` (`guide-feeds.txt:49,71`) collide with the app's `social.q:1,14`, and init refuses collisions (`guide-feeds.txt:9-13`).
    2. The recipe's post is a text `body` with no images, video, replies or counts (`guide-feeds.txt:71-87`).
    3. The recipe's `createPost` and `repost` "queue without prediction" (`guide-feeds.txt:265-266`), and its `follows` is `online only` (`:59`), whereas the app's profile counts read synced follows.
    4. The failure surfaced at M8, with M2–M6 already green.

    L19's builder independently shipped the same global filter, at more than 50 follows.
- **`dev --replay`.** Used for every scale replay (run log 1789483571; README "Use `snapback4 dev --replay --no-watch --port 49366`"). The personas card was read at 07:44:29 (`guide-replay.txt:3-14`).
- **`clock advance`.** Used in `scripts/trust-check.mjs:87,103,117`, `scripts/suites/m8.mjs:45` and `scripts/digest-proof.mjs:33,80,145,197` (which also uses `--clock-offset`).
- **`client.acquired` and `usePendingWrite`.** Named on the prediction card the builder read at 07:11:00 (`guide-prediction.txt:5-9`), but used nowhere in `src/` or `app/`. The opener's `await c.sync()` is the starter's form.
- **Trending recipe.** Read and declined for lag (H4).
- **Web navigation write loss.** Not hit.
  - Removal goes through the local client (`src/Chats.tsx:600` → `:522`). There is no keepalive or online-client workaround.
  - `m3-choreo.jsonl` has member-add-promote-remove-leave-and-live-cutoff passing on attempt 1.
  - The one M3 miss (`m3-choreo-attempt1.jsonl`) was "waiting for getByTestId('sm-convo-input')", the builder's DM-route error (1789481961).
  - The string "removed member received a new live group message" appears only in the grader's harness copy. The grader's M3 re-run was green (trace §3.1).

### Item by item

| Item | 0.2.19 (L19) | 0.2.21 (L21) | Verdict |
|---|---|---|---|
| G1 web write lost on navigation (S29) | Same error string; online keepalive workaround | Local `mutate` for removal, first-attempt pass; no workaround (above) | **Closed** (W4a), exercised |
| G2 replay holds, doesn't suppress (S28) | App replay flag | `dev --replay`; no flag in Quarry; no scorer charge (background_work +2: "Only a small logging worker was required") | **Closed** (W5a), adopted |
| G3 Following recipe declined (S14, S15) | Merge at 4.37×, then a global filter above 50 follows | Merge at 4.31× (`scale-final.json`), then a global filter at 100 or more follows (`social.q:77-78`); `N_SPARSE_FILTER` remains; the recipe was not run despite two notes naming the command (H2) | **Recurred.** W5d's command is visible but was not adopted |
| G4 spelling refusals in the dense query (S07) | Three refusals in about 30 s | `social.q:78` uses an inline `exists follows[viewer, .actorId]` and a bare `eventCard` tail; no `E_QUARRY_*` in the run log between 1789484066 and 1789484170; first recorded check ok (`m8-adaptive-feed-check.txt:1`). Diagnostic texts were not retained, so zero attempts cannot be proven. | **Closed** (W5f), exercised |
| G5 Trending with no ranked expiring order (S25) | Online-only `ranked`; like never predicted | Synced public `rankedPosts`; `like` is `predicts: eligible` (`why-like.txt:3`); the scheduled recipe was read and declined for lag (H4) | **Changed.** The like-prediction cost is gone; the write-path design and refusal remain |
| G6 online open before acquisition | Six-minute loop; `sync()` added | `src/client.ts:17` `if (c.link() === "online") await c.sync();` (the starter form, W5c); no loop; `acquired` unused | **Closed** (W5c), adopted through the starter |
| G7 attribution and anchor columns (S24) | Stored columns, `digestAt`, a 905-row backfill | Anchor: `scripts/configure-digest.mjs:5,10` generates `bucket(.at, 1d, 8h)` for the production config, with no anchor column. Attribution: still stored, with a 406-row backfill (H5). | **Anchor closed** (W5g), adopted. **Attribution recurred.** |
| G8 digest one profile per chunk (S26) | `chunk p in profiles first 1` | `digest.q:24`, same (H6) | **Recurred** |
| G9 emit over a filtered recipient list (S08) | One refusal, 52 s | `notifyMessage` emits while iterating `members[conversationId] first 50` with an inline `connected` test (`chat.q:193-195`); no refusal logged | **Not exercised** (the prescribed shape was written first) |
| G10 presence grace in tests | 36 s wait per M6 suite run | M6 suite uses the online `createClient` and closes the recipient before sending (`scripts/suites/m6.mjs:17,32`); no grace wait anywhere | **Not exercised** (W5g unused) |
| G11 ambiguous positional key | `E_QUARRY_AMBIGUOUS`, fixed with `--fix` | `follows[viewer, .actorId]` and `follows[viewer, target]` (`social.q:78,99`) with `byPair` unique and `byFollowed`; no ambiguity refusal in any check | **Closed** (W5f unique preference), exercised |
| G12 README size and residency model (S13) | 127,362 B; "knowing which local facts are complete" | 142,262 B (+11.7%); diary M1 "unusually comprehensive but lengthy"; H3 loop; essay:57-78 | **Recurred** (both halves) |
| M1 react's first insert never predicts, yet `check` said eligible (S20) | `m6-check.log:138,147-148` | `media.q:1-14`: unique `(conversationId, messageId, principal)`, `cap 50 by conversationId, messageId`, no horizon, which is the card's membership shape (`guide-prediction.txt:133-137`); no `chat.react` in any summary | **Closed** (W5b card), adopted |
| M2 hand-built Trending widens write rules | `update <- allow` on `posts` and `ranked` | `rankedPosts` `update <- allow` (`insights.q:38`); `posts.score` gone | **Recurred** (narrower) |
| M3 Following server-only | `runs: server` | Inference only (V6) | **Recurred** (inferred) |
| M4 stale batch-route doc | README:1816 | `guide-jobs.txt:71-72`: "Mutations at `POST /m/<op>` stamp `now` from this clock." | **Closed** (W5a) |
| M5 README SecureStore keys unnormalized | README:2082 | Package README:1724-1725: "with the key made filesystem-safe as in §7"; `src/device.ts:4-9` normalized | **Closed** (W5a) |
| M6 long, synthetic residency sites | 57 of 197 sites without a line | V8 | **Recurred** |
| M7 advisory noise | 7 notes | 16 notes (V7), plus the new `N_NO_HORIZON` contradiction (V1) | **Recurred, worse** (partly the builder's design) |
| M8 Metro watches `.snapback4/` | Crash under Node 25 | `metro.config.js:4-5` is the starter's `.snapback4` blockList with its comment; the only Metro crash was the agent moving the harness (1789481059) | **Closed** (W5g), via the starter |
| M9 dev clock shipped, not used | 185 s real waits | Used in three proofs (above); only the frozen harness still waits in real time | **Closed** (W5g pointers), adopted |
| d-06 offline first reaction shows no chip | `optimisticChipOffline: 0` | The reaction shape predicts (M1); the grader's offline checks raised no reaction defect, and L21's d-06 is an unrelated unread badge (trace §4.5) | **Closed** |

---

## 3. The score drops

The scorer is a fresh session reading only L21's narrative and run record (`prompts/astra-snapback4.score.md`). It sees no earlier score, so 1–3 point moves are within N=1 variance.

| Category | 0.2.19 → 0.2.21 | Snapback-attributable cause named in the note | Other causes |
|---|---|---|---|
| overall | 91 → 88 | "Auth-policy and sparse-feed limitations prevent an ideal score" (H1, H2) | Framing, and variance |
| setup_and_docs | 92 → 90 | "unusually comprehensive, lengthy README" (V10). The L19 replay-doc charge (G2) is gone. | Variance |
| data_modeling | 88 → 88 | "separately modeled identity ledgers" (H3, H7) | The ledgers are partly the builder's choice |
| authorization | 97 → 91 | H1, the password byte policy | Not a regression: the policy is unchanged. The builder's audit disclosed it. |
| queries_and_live | 89 → 84 | H2, `N_SPARSE_FILTER` | Same design as L19, narrated more starkly, plus variance |
| writes_and_transactions | 95 → 92 | "Application-authored intent ledgers" (H7, shared) | The builder's design choice |
| offline_sync | 92 → 90 | "explicit projection-completeness modeling" (G12, H3) | The horizon guard was agent-attributed; the simulator is unproven (instrument) |
| media_assets | 98 → 97 | One owning row per asset (H9) | Variance |
| background_work | 93 → 95 | None. G2 closed. | — |
| client_integration | 90 → 89 | None named | Native interaction unobserved (instrument); variance |
| diagnostics_dev_loop | 95 → 93 | "'Predicts: eligible' alone omits essential per-read conditions" (H3, V2) | — |
| scale_and_limits | 91 → 85 | "sparse-filter incompleteness remains" (H2) | Same design as L19; the scorer calls the initial tuning failure agent-attributed; variance |
| operations | 89 → 88 | None | "M7 migration/backfill was deliberately untested" (instrument) |

### authorization 97 → 91 (−6): the builder's different audit, not a regression

- **Notes.** L19: "membership-scoped sync, effective removal with retained local history, admin controls and row-linked asset refusal". L21: "Run-log's snapback4-defect identifies the remaining gap: eight-byte passwords satisfy built-in auth without the required character-count override."
- **Snapback-attributable.** The byte minimum and the absence of a policy knob are real (H1). L19 shipped the same package sentence (L19 package README:1542), and L19's app enforced nothing extra. The L19 builder never tested a multi-byte password.
- **Why the score moved.** The only new input is the L21 builder's own audit (run log 1789484744, 1789484800) and its `snapback4-defect` label, which the rubric tells the scorer to charge. The L19 authorization charge for client admission (G1) is gone, and the note does not mention it.
- **Not seen by the scorer.**
  - The guest default (d-01, V3) lives in `grading/`, which the scorer does not read.
  - The `rankedPosts` `update <- allow` widening (M2) exists in both lanes and was never charged.

### queries_and_live 89 → 84 (−5): the builder's framing of an unchanged design, not a regression

- **Notes.** L19: "Exact Trending required expiring ranked candidates; essay.md identifies workload sensitivity in the dense Following query." L21: "Essay and final report retain N_SPARSE_FILTER: broad, sparse follow sets can yield incomplete pages despite successful dense-envelope tuning."
- **The design did not change.**
  - L19 filtered the global timeline above 50 follows; L21 does so at 100 or more. Both keep `N_SPARSE_FILTER`.
  - The merge ratios before the rebuild are 4.37× (L19) and 4.31× (L21); the final ratios are 1.41 and 1.257.
  - The Trending charge dropped out of the note (H4: like predicts).
- **What changed is the narrative.** L19's final report called it "an application design limit, not a universal performance claim" (L19 `final-report.md:92`). L21 lists it as a candid gap: "A broad follow set with mostly inactive authors can return an incomplete page" (`final-report.md:198`). It also gets a README section, "an acknowledged scalability limitation", and the verdict line "meaningful limits in sparse-feed queries".
- **Snapback-attributable part.** Two independent builders, on 0.2.19 and 0.2.21, did not adopt the recipe even with the command on the card and in two notes (H2).

### scale_and_limits 91 → 85 (−6): the same design with more prominent disclosure, not a regression

- **Notes.** L19: "all 16 measured degradation gates passing locally. Dense Following remains sensitive to sparse activity; the original merge failure was attributed to application design." L21: "Measured envelope checks passed; sparse-filter incompleteness remains. Initial tuning failure is agent-attributed."
- **The substance is the same**, and every measured value passes:
  - Following 500/5: 1.257
  - Celebrity: 1.028
  - History: 0.967
  - Search, insights and trending interpolation: all under their limits
  - Celebrity writes: 0.909
  - Cold sync: 640 ms (`performance-summary.json`)

  L21 reports 10 checks where L19 reported 16 gates. Inference: the scorer saw fewer measured items and a louder limitation.
- **Snapback-attributable.** H2 only. No measured regression: the pre-fix merge ratio matches L19's.

### The smaller drops

- **writes_and_transactions −3.** `intents` is new builder design (L19 had none). Snapback's share is the missing caller-supplied write id on `mutate` (H7, inference).
- **diagnostics_dev_loop −2.** Snapback-attributable (H3, V2). The note quotes the essay directly.
- **offline_sync −2, setup_and_docs −2, media_assets −1, client_integration −1, operations −1.** Variance, plus the named README length (V10), residency learning cost (G12) and asset ownership (H9).

### Grades

These are a separate claude-family grader, uncalibrated in both runs.
- **O1: 72 → 75.** No new failures; a grader re-run miss on M4 is d-05.
- **O2: 80 → 78.** L19 had three minor app defects and three cosmetic ones. L21 has five minor defects and one cosmetic (§4). Of those, d-01 and d-02 come from grader probes L19's grader did not run (`/auth/guest`, a multi-byte password). Instrument variance in discovery, not new behavior.
- **O4: 40 → 30.** No simulator artifact in either run, because the prompt waived it. Both graders cite the same web receipts. The anchor moved on grader judgment: instrument and grader variance.

---

## 4. Grader defects d-01 … d-06

| ID | Summary (grader) | Cause | Classification |
|---|---|---|---|
| d-01 (minor) | `use identity` enables guests; a guest can post and DM | `schema.q:1`; trace §4.1 | **App configuration**, with a Snapback default nudge (below) |
| d-02 (minor) | Server password minimum is 8 UTF-8 bytes, not 8 characters | H1 | **Snapback-attributable** (fixed policy, no knob) |
| d-03 (minor) | Following for 100+ follows is a global scan and can return an incomplete page (`N_SPARSE_FILTER`) | `social.q:77-78` (H2) | **Shared.** The app chose the pattern; Snapback's recipe was not adoptable in practice, and the filtered scan is admitted with a note. |
| d-04 (minor) | The Following projection after a follow toggle times out on first attempt, in both builder and grader runs | See below | **App bug** (inference). Snapback's contribution is at most the ~470 ms server-evaluated page (V6). |
| d-05 (minor) | Video bubble renders before its media element; one harness miss | `src/Chats.tsx` video render; trace §4.4 | **App bug** |
| d-06 (cosmetic) | Binary unread badge | `src/Chats.tsx` ChatRow (`unreadCount`, :84) | **App bug** |

### d-01: can `use identity` disable guest sessions?

**Yes.** The package README says: "The schema opts in with `use identity` (guests and password accounts), `use identity guests` or `use identity password`" (package README:1733-1734). The language card the builder read at 06:59:12 says the same: "`use identity guests` or `use identity password` admits one kind" (`guide-language.txt:16`). The app never calls `guest()`; there is no `guest` in `src/` or `app/`.

**This is an app configuration bug, with two Snapback nudges:**
- The starter schema is `use identity` (w4b `apps/chat/snapback/schema.q:9`, written by `init.rs:259`). Its opener mints a guest when there is no session (`apps/chat-expo/src/client.ts`).
- The package README's onboarding example says "The availability query needs a guest session (`use identity` enables guests)" (:1797).

No `check` note flags a guest door on an app whose client never mints a guest.

### d-02: password minimum in bytes vs characters, and whether it is configurable

**Bytes, and not configurable.**
- **Docs:** package README:1728 ("Signup passwords are 8–1,024 UTF-8 bytes") and the personas card (`guide-auth-final.txt:41`).
- **Source:** `password.len() < 8` in w4b `snapback4-core/src/identity.rs:202`, with the message "a password needs at least 8 UTF-8 bytes".
- **Knob:** none. The three `use identity` forms (package README:1733-1734) carry no policy.
- **Probes:**
  - Builder: two code points totaling eight bytes accepted (`auth-unicode-policy.json`).
  - Grader: 7 ASCII characters refused, 4 two-byte characters accepted (trace §4.1).
- **Workaround:** the app enforces code points in the UI only (`src/Root.tsx:94-95`). A direct SDK signup bypasses it.

**Snapback-attributable. Not a wave 4–5 regression:** L19's package README:1542 had the same text.

### d-03: the Following feed can be incomplete

The final query switches to `events after c last 20 by byTime where .actorId = viewer or exists follows[viewer, .actorId] eventCard` once `followingCounts[viewer] >= 100` (`social.q:77-78`). Check reports `N_SPARSE_FILTER` (`m8-adaptive-feed-check.txt:2`), and the lane discloses it (README "Known envelope tradeoff"). The dense scale fixture never triggers it (the grader's spot check is exact, trace §4.7).

**Shared.**
- **The app's part:** choosing the global filter over the recipe the card recommends (`guide-feeds.txt:324-326`).
- **Snapback's part:** the recipe is a separate seven-table model whose table names and post shape collide with an app built M2–M6 (inference, §2). It was not adopted by either independent builder, and the engine accepts the global filter with only a note.

### d-04: the first-attempt timeout after a follow toggle

**The harness steps** (`harness/tools/social-messenger/choreography/choreography.mjs:1329-1365`):
1. Compose an Alice post.
2. Sample Bob's Following with an always-true predicate (`() => true`).
3. Toggle follow on Alice's profile.
4. Wait for `direct` to differ from the sample.

**The evidence.** In the starter, Bob already follows Alice (`instrument/fixtures/starter-m2.log:3`). Attempt 1 failed with "Bob's Following projection after follow toggle did not become observable within 10000ms". Attempts 2 and 3 passed at 495.8 and 470.9 ms (`m2-choreo.jsonl`). The grader's re-run reproduced this on attempt 1 (trace §3.1). L19's app passed attempt 1 at 505.4 ms (L19 `m2-choreo.jsonl`).

**The likely cause (inference).** The profile screen reads `counts` with a placeholder principal (`useQuery(api.social.counts, { principal: p?.principal ?? "none" })`, `app/profile/[handle].tsx:16`). The follow button then sends `set: !counts?.followed` (`:33`). A click made while the real-principal `counts` read is still loading sends `set: true` for an already-followed author, a no-op, and the projection never changes. Once the read has resolved, later attempts send the correct value.

**Classification.** App bug. Snapback's share is at most the latency of a server-evaluated Following page (V6), which is the same as in L19.

The separate "viewer-repost … counted as a direct follow-projection hit" transient is V5; its cause is not established.

---

## 5. Remaining Snapback-attributable friction, ranked (next-wave candidates)

Expected impacts are inference from the scorer's notes; nothing here is measured. "W4–5 regression?" asks whether the evidence suggests waves 4–5 introduced the problem.

| Rank | Friction | Smallest product change | W4–5 regression? | Expected impact |
|---|---|---|---|---|
| 1 | **Following recipe not adoptable into a built app.** Two builders shipped the global filter; d-03 (H2, G3; S14, S15). | Make `init --recipe feeds` adopt into an existing schema. `--prefix feed` renames the recipe's declarations and references instead of refusing collisions. A card section shows wiring `deliver(p)` into the app's existing `createPost`/`repost`, carrying `postId` and joining the app's own `postCard` rather than a text `body`. `N_SPARSE_FILTER` on a follow-edge filter over a global timeline names the incompleteness condition and prints the exact `init --recipe feeds --prefix feed` command. | No (unchanged since L19) | queries_and_live +3–5; scale_and_limits +3–6; grader O2 (d-03 gone) |
| 2 | **Password minimum counts bytes, with no knob** (H1, d-02) | Count Unicode scalar values for the minimum; keep the byte bound for the maximum. Optionally `use identity password min 8`. Change the personas card and README:1728 to say "characters". | No (same text in 0.2.19) | authorization +3–6 (removes the lane's only snapback4-defect); O2 |
| 3 | **"predicts: eligible" hides main-path horizon guards; `N_NOT_PREDICTABLE` fires once** (H3, V2; S19, S20) | Add a persistent third bucket to the end-of-check summary: "eligible, but these reads queue without a row past a horizon: chat.send (messages[messageId], chat.q:162)". Qualify the `why` heading the way W5b did for insert arms ("predicts: eligible except past the horizon at …"). Add a specific note for an existence guard on an argument id: the write id already dedupes, and this guard costs prediction. | No (W5b narrowed only insert arms) | diagnostics_dev_loop +1–2; offline_sync +1; removes a class of five-minute loops |
| 4 | **`N_NO_HORIZON` recommends the horizon that breaks prediction** (V1) | When a table's lack of a horizon is what proves an eligible insert arm or guard, suppress the note or print "kept: required by chat.react's insert proof" instead of a `last 500` rewrite. | No (new interaction, visible because the builder followed the W5b card) | diagnostics_dev_loop +1; notes 16 → about 9 (M7) |
| 5 | **Exact Trending forces write-path scoring with `update <- allow`** (H4, M2; S25) | Let a mutation write a system-owned table through a declared helper (for example `system update rankedPosts[…]`), with the table's rules left at `deny` for principals, so exact scoring needs no widened rule. Alternatively, state on the card the post-per-day envelope where `trendingNow()` stays exact under the 8,192 ceiling, so an "exact" brief has a named choice. | No | authorization +1 (narrower rules); queries_and_live +1 |
| 6 | **No caller-supplied write id on `mutate`**, so the builder built an intent ledger (H7) | Add `mutate(op, args, { id })` on online and local clients, matching `act` (package README:1304), with one card sentence for replay adapters that carry fixture ids. | No | writes_and_transactions +1–3; one fewer no-horizon table |
| 7 | **Guests on by default in a password-only app** (d-01, V3) | Add a personas-card and README line: "an email-and-password product declares `use identity password`". Have the starter comment the choice. A `check` note is not possible without client visibility. | No | O2 (d-01); authorization +0–1 |
| 8 | **`clock advance` expires a live worker's effect lease; `runWorker` logs `E_EFFECT_LEASE`** (V4) | Extend held leases by the advanced duration (or keep lease expiry on wall time) in `dev`, and have `runWorker` report a lost-lease settle as informational. Add one line to the effects card. | **Possible; verify** whether leases moved to the dev clock with W5g or earlier (W3d) | background_work +0–1; prevents double sends in non-idempotent test handlers |
| 9 | **Attribution columns need a backfill (G7 residual); digest one profile per chunk (G8)** (H5, H6; S24, S26) | Allow maintain group keys from a point-read join on an immutable reference (`by posts[.parentId].authorId`). Publish a digest recipe with maintained per-member unread counters and a multi-row chunk. | No | data_modeling +1; operations +1 (no backfill job) |
| 10 | **Docs weight and residency noise** (V7, V8, V10; G12, M6) | Stop the README growing: move recipes to cards only and keep the README an index. Give rule sites `file:line`. Stop sending a membership-search `N_WIDE_MERGE` to the feeds recipe. Print the `--replay` state at dev startup (V9). | Trend, not a regression (+11.7% README, +34% feeds card) | setup_and_docs +1–2 |
| 11 | **Low:** asset per owning row (H9); dev clock offsets leave future rows after restart (H8); investigate V5's repost transient with a Snapback-side witness | Asset reuse by id across rows owned by the same principal. One jobs-card line: "rows stamped under an offset keep their times; use a fresh store per offset test". | No | media_assets +1; operations (small) |
