# Clique on snapback4@0.2.16 (Astra, medium effort): friction review against the 0.2.12 lane

**Short version.** Most of the diagnostic and doc fixes shipped since 0.2.12 held up. Neither of the two issues filed as Snapback defects last run came back, and the builder recorded "confirmed snapback4 defects=0". It grouped 25 correction loops: 18 its own errors, 6 environment, 1 ambiguous. Seven problems are still Snapback's:
- the web client loses a write when the page navigates away (S29)
- the Following-feed trap and a gap in the feeds recipe
- a named shape after `where` still errors, and `--fix` doesn't repair it (S07)
- no clock control (S27)
- no computed-key or top-N aggregates (S24, S25)
- no switch to pause effects and schedules during replay (S28)

There is no simulator proof because the run prompt said it wasn't required. The builder never opened the witness docs.

Lane: `/Users/ccheever/clique-sb4-20260915-astra-next/lanes/astra-snapback4/` (called L16 below); the previous lane is L12. Where I give a clock time, it is a file modification time in local time; run start 1789438589 is 19:16:29.

---

## 1. Friction in the 0.2.16 run

### 1a. Friction the builder hit that Snapback caused

| # | Friction | Evidence | Cost | Inventory row |
|---|---|---|---|---|
| F1 | **A web local-client write is lost when the page navigates right after it.** The admin's "remove member" never reached the server. The workaround is a hand-built raw `fetch('/m/'+op.name, …keepalive:true)` that bypasses the local client. | Run log 1789439799: "remove click immediately followed by full-document navigation left membership unchanged; direct API removal succeeds". `m3-choreo-first.txt` (19:35:12): "removed member received a new live group message". `m3-roster-after.txt` still lists dave. Workaround in `src/adminWrite.ts`. The builder read the writes card at 19:36:01, one second after the roster check. That card says "pagehide or becoming hidden sends only the oldest unconfirmed write with keepalive when no ordinary send is in flight". The mechanism didn't cover this case. The builder logged the attribution as "ambiguous". | About 90 s from failure to logged fix, plus a rerun. Admin writes no longer go through the durable queue. | **S29**. Same error string as L12 `m3-choreo.txt`, same workaround. |
| F2 | **The Following feed first used the read-time merge that the language card itself shows.** It failed the 3× scale rule and forced a rebuild onto the feeds recipe. | The language card's `query following` merges `[f.followedId] for f in follows[viewer]`. `N_WIDE_MERGE` fired from `m2-check-fix.txt` on. Run log 1789439126: "N_WIDE_MERGE retained pending scale measurement". `scale-attempt1/scale-10%-probes.json`: following500 p95 4.89 ms vs following5 1.16 ms (about 4.2×). Rebuilt as `snapback/feed.q` ("Adapted from the published 0.2.16 guide feeds card"). | About 8 min, 20:14:32 to 20:22:30: rebuild, 3 feed checks, fresh replay restart at 1789442353, a types fix at 1789442550. It also poisoned the first scale attempt. | **S14**, residual. The recipe now exists and it worked: final ratio 1.034. **Shared blame:** the builder read the feeds card at 19:22:56, saw the note, and chose to wait for a measurement. |
| F3 | **The feeds recipe has no path for removing a source event (unrepost).** The builder's removal loop hit `E_STRUCTURAL_FANOUT`, whose suggested rewrite is not concrete. Two OR-rule attempts failed. The ending was to make per-reader feed entries `public`, and all feed tables are `online only`. The recipe's `feed` table is `sync`. | `m8-feed-check.txt`: "feedEntries by byEvent (page bound 10000): the mutation page's read rule is not uniformly decided by its prefix / rewrite: read it in a query, or pin the deciding columns". Same message at `byActorEvent` in `-second`. Run log 1789442332: "two OR-rule attempts remained structurally non-uniform; feed projection is public". `feed.q:32` `public 'Projection of public posts and public follow edges'`. `guide-feeds.txt` covers `follow` and `unfollow` but no event removal. | 3 checks between 20:18:02 and 20:18:51, 2 logged loops. Private inboxes ended up public. | **New** (recipe gap). The rewrite text is **S08**, residual. |
| F4 | **A named shape after `where` still fails, and the fix the docs promise didn't apply.** | `m5-check.txt`: "E_QUARRY_TYPE: a shape applies to a row, an object or a page; got bool / rewrite: shape a read: `messages[id] { body }`". The language card says "`check --fix` repairs that spelling when it mistakenly shapes a scalar predicate operand". But `m5-check-fix.txt` (18 s later) is byte-identical, with no `fix:` lines, unlike `m2-check-fix.txt`. From the file names I infer that was the `--fix` run. Final form: `where not .tombstone { ...messageCard }`. | About 80 s (19:42:36 to 19:43:55). Run log 1789440235. | **S07**. Also new: the documented `--fix` didn't fire. |
| F5 | **No clock control.** The builder waited real time for expiry and digest periods, and needed a dev-only system seed to create a post older than 24 hours. | Run log 1789440403: "waiting real expiry clocks; no shortened server-time seam". `choreo-adapter.json` has `waitMs:185000`. `m5-server-expiry.json` shows closed at …308874 and reopened at …493897, about 185 s. Digest probes waited on real 2-minute periods, with a boundary-timing retry (run log 1789442771). `m8-old-post-test-setup.json`: "dev-only system seed for a genuinely backdated existing post". | M5 wall was 724 s, with at least two ~185 s waits. M8 had two digest probes of about 4 min each. | **S27** |
| F6 | **Replay mode is hand-built.** A `fn replayMode(): false` gates effects and the digest job, and schedules were held by hand on the replay instance. | `snapback/runtime.q`; `chat.q:162,191`; `digest.q:31`. Run log 1789442754: "adopted same job-only change in replay instance with schedules held". | Authoring overhead; no loop logged. | **S28** |
| F7 | **Aggregates need derived columns and backfills.** `insightFacts` stores `day` and `period` columns; `insights.backfill` and `feed.backfill` jobs were written by hand. | `insights.q:1-31`. `m8-backfill.txt` wrote 1052 rows, `m8-backfill-final.txt` 180, `m8-feed-backfill.txt` 699. Essay: the builder still had to decide which events counted and "repair historical data after introducing them". | Part of the 1696 s M8 wall. | **S24** |
| F8 | **No maintained top-N.** `rankedPosts` and `rankPost()` are hand-written. The cursor-index refusal came back under an unrelated error code. | `insights.q:33-60`. `m8-check.txt`: "E_QUARRY_UNKNOWN: index rankedPosts.byScore cannot carry a cursor… guide: language". Loop at run log 1789441909. | 1 loop, about 90 s, shared with a TS annotation fix. | **S25**. The error code and guide link are new, minor. |
| F9 | **The digest job had to be split into one-row chunks** plus a `digestChats` scratch table so busy users stay under the meter. | `digest.q` (`chunk m in members first 1`, `chunk p in profiles first 1`). Run log 1789442754: split "so 900 active chats do not share one examined-row meter". | One proactive redesign. | **S26** |
| F10 | **`insert … if absent` returns a nullable result** that must be guarded. | `m8-check-first.txt`: "recordFact's sourceId is id; got a follows reference ?". The rewrite ("guard `f.id != null`… or make its parameter `sourceId: id ?`") was good. Run log 1789441779. | 1 loop, 3 errors. | **S10** (the rewrite quality improved) |
| F11 | **`E_NOT_PREDICTABLE` names an internal program path instead of a source location.** | `m6-check.txt`: "connected[recipient] decides a fallible or variable-cost arm at programs.chat.send.body.19.then.0.loop.0". Run log 1789440895: the real cause was a profile lookup inside the presence arm. | 1 retry, 16 s. | **S08** (internal-site leak), IF1 residual |
| F12 | **Two guide cards the builder asked for don't exist.** `guide maintain` and `guide time` have no card, and the "nearest" suggestions miss `language`, where both topics live. | `guide-maintain.txt`: "no card named maintain; nearest: evolution, personas, reads". `guide-time.txt`: "nearest: reads, assets, native". Run log 1789441669: "unknown maintain/time cards corrected to language". | Small. | **S01** residual (aliases) |
| F13 | **The residency model still slows the builder down at first.** | Essay: "These were useful constraints once I understood them. At first they were also a tax on momentum." Diary M2: "local query completeness is an extra concept". Diary M8: "an OR rule was insufficient for a cleanup sweep". | Conceptual. | **S13** |
| F14 | **Generated `api.ts` fails to import from Node scripts.** `npm init` wrote `"type": "commonjs"`, and `init --expo` merged into that file without changing it. | `m1-seed.txt`: "does not provide an export named 'api'" (it ran on Node 25.9.0). Fixed by adding `snapback/package.json` `{"type":"module"}` (run log 1789438831, where the builder called it environment plus its own error). | About 22 s. | **New**, ambiguous |

### 1b. Problems visible in the evidence that the builder didn't hit or didn't mention

| # | Issue | Evidence | Inventory row |
|---|---|---|---|
| L1 | **Seven mutations never predict at the end**, including `social.createPost`, `like`, `repost` and `saveProfile`. So offline likes, posts and reposts show no pending row. The M8 notes that explained it came as 18 largely duplicated `N_NOT_PREDICTABLE` lines, only on the one check where the change happened. | `m8-check-second.txt`: 24 notes, with duplicate sites such as "write target rankedPosts…" and "upsert inserts do not predict…" both at insights.q:50:5. `m8-feed-check-third.txt`: "7 mutations never predict…". No run-log entry addresses them. The language card's maintain example itself carries `online only`. | S05/S06, residual (duplication and the example) |
| L2 | **`N_NO_CURSOR` fires on a group that can't grow past the page.** `chat.settings` reads `members[conversationId] first 50`, but members has `cap 50 by conversationId`. | `chat.q:40,107`; appears in every check, including `m8-check-final.txt`. | New |
| L3 | **Advisories stay on intentional designs through every check**: `N_NO_HORIZON` on public `profiles`, and `N_WIDE_MERGE` on `searchAll` and on the final `following`. The final `following` still fires only because the builder used `feedPulls first 1000` where the recipe uses 32. | `m8-check-final.txt`. Final report: "Public profile sync is intentionally unbounded". | S16, S17 (as noise) |
| L4 | **The worker's effect dedupe is hand-built** (at-least-once delivery). | `snapback/worker.mjs`. Essay: "The worker needed explicit effect-ID deduplication because logging an effect and acknowledging its delivery are separate actions." | New, low |
| L5 | **The service worker for a cold offline web launch is hand-built.** | `scripts/cache-shell.mjs`. Essay: "A local-first backend does not make an Expo web export load with the network disabled." | New, low |
| L6 | **There is no packaged SecureStore session-store adapter.** The builder's wrapper dropped the starter's key normalization, caught only in final review. | Run log 1789443322; `src/session.ts`. | New, low (the builder's own error) |
| L7 | **Adding one table to the scale-instance schema took 9.2 s.** | `scale-server.log`: "schema adopted as generation 2 (Additive) in 9160 ms". | New data point |

### 1c. Friction that was not Snapback's

- **Benchmark instrument:**
  - The copied harness was read-only: `npm-choreography.txt` EACCES.
  - The `metering/` sibling was missing: `m1-choreo-output.txt`.
  - The default fixture path assumed the original layout: `m2-choreo-retry.txt` ENOENT.
  - Playwright wasn't installed: `m1-acceptance.txt`.
- **Environment:**
  - Node 25.9.0 was on PATH instead of 24.18.0.
  - ffmpeg couldn't load the x265 library: `video-poster.txt`.
  - The first scale replay ran out of local sockets (EADDRNOTAVAIL) after 50,000 actions: `scale-attempt1/scale-output.txt`.
- **The builder's own errors:**
  - leftover scaffold imports (`m1-types.txt`)
  - a native-only image helper used on web (`web.log:178`)
  - pagination test data, feed-tab navigation, and the own-repost key
  - the Metro startup race (`m3-suite-retry.txt`) and a missing poster asset (`m2-ios-verified.txt`)
  - view-once cleanup, and credentials in the seed ledger
  - the insights nav prop, a string passed where a RegExp was expected, and home-screen chat rows
  - restarting the digest server while the schema was invalid, and the digest boundary timing
  - generated type changes, the SecureStore normalization, the probe's button role, and a view-once assumption about the scale fixture
  - an unknown `digestAnchor` function (`backend.log:216`)

---

## 2. Inventory rows that improved or disappeared since 0.2.12

| Row | 0.2.12 lane | 0.2.16 lane | Verdict |
|---|---|---|---|
| S01 | `guide-prediction.txt` was 0 bytes; run log 1789412421: "prediction card absent" | `guide-prediction.txt` 5404 B; `guide.txt` aliases include "predict -> prediction, offline -> prediction" | Fixed (F12 residual) |
| S05 | `final-check.txt` has no never-predict summary | Every check ends "N mutations never predict: … — snapback4 why <op>"; the `predicts:` assertion is enforced (`m6-check.txt`) | Fixed |
| IF1 (presence) | `m6-send-why.txt` "rewrite: remove connected from this query"; logged as a snapback4 defect with a two-stage workaround | Card has the `notifyPost` example; rewrite "decide only the emit with presence"; 16 s retry; `why-chat-send.txt` "predicts: eligible" | Fixed |
| IF2 (cursor) | `paging-diagnostic-console.txt` "pagingReceipt … next:null"; snapback4 defect | API check walked 10,000 messages over 200 pages. The new helper has no early return, so this proves it didn't recur, not that it's fixed. | Didn't recur |
| S06 | `N_MAINTAIN_SYNCED` rewrite "add `online only` to the maintain" | `N_NOT_PREDICTABLE` rewrite "remove `online only` from maintain likeCounts" | Direction fixed (L1 residual) |
| S08 | "E_STRUCTURAL_FANOUT: E_STRUCTURAL_FANOUT: chat.send/for/$p20/0…" | "chat.q:191:5 — … loop over ids… rewrite: iterate the original group: `for row in members[conversationId] first 50…`"; fixed in 14 s | Mostly fixed (F3, F11 residual) |
| S10 | "setting is text <=10; got enum… rewrite: pass text <=10" | An enum now fits `text <=N` (`config.q` `mode: text <=3` takes the enum); nullable rewrite offers either guard or parameter change | Fixed |
| S09, S11, S12 | Cascading "unknown name msg"; generic syntax rewrite; confusing key-count message | Not reproduced | Didn't recur |
| S03 | init refused an existing package.json (L10a) | `npm-init.txt` 19:16:58, then `init-expo.txt` 19:17:50 "wrote 14 files" | Fixed (F14 side effect) |
| S32 | Metro/wasm wiring done by hand | init wrote `metro-wasm-transformer.cjs` and `metro.config.js` | Fixed |
| S14, S15 | No paved Following | Feeds card has the complete recipe (mentions `N_SPARSE_FILTER`); adopted; Following500/Following5 = 1.034 | Much improved (F2, F3 residual) |
| S17 | "past the 8192 examined the meter allows, so the page is cut" | "a read past the 8,192 examined ceiling returns `complete: false`" plus "measure with `snapback4 test --cost`" | Fixed |
| S18 | Search midpoint "2.397ms > 2.185ms; fail" | "search 50% below interpolated curve 1.345 / 3.009 pass" | Passed (different probe scripts) |
| S19 | Horizon guard found only after a defect loop (1789411480) | Card example `guardedPost` plus `why` rewrite "remove a redundant guard"; guards removed up front at M6 with no loop | Fixed |
| S20, S21 | Undocumented | Upsert conditions in the prediction and writes cards; server-arrival ordinal recipe plus `ordinal -> writes` alias | Documented (S21 still hand-built) |
| S30 | README L1525: witness "in the repository", not published | README "Proving it on an iOS simulator", `witness` card, `snapback4-expo/witness` shipped (`package-packs.txt` lines 66–70) | Published but unused (§3) |

**Unchanged:** S07, S13, S16, S24, S25, S26, S27, S28, S29.

**Not exercised in either run:** S02, S04, S22, S23, S31, S33–S36.

---

## 3. Why there is no iOS simulator proof

**The run prompt waived it.** `prompts/astra-snapback4.md:12`: "Every milestone also produces an iOS Hermes bundle export as a build artifact; simulator proofs are not required." The 0.2.12 prompt had the same wording.

**What the brief says.** `instrument/social-messenger.md:103-110`: "M6's offline proofs additionally run on the iOS simulator as a separately recorded native/O4 artifact; absence of that artifact cannot support a native claim but does not block the web authoring-green clock." Acceptance items M6 #1 and #2 are tagged `[native-artifact]`. `ENVIRONMENT.md:26`: "iOS simulators exist".

**What the builder wrote:**
- Final report: "Native execution was not requested: Hermes exports exist, but no simulator/device receipt or physical-power-loss durability claim is made. A browser restart probe passed."
- Final report statuses: `ios-simulator-m6: not-recorded` ("M6 simulator evidence is recorded separately from web green") and `ios-simulator-m8: not-recorded` ("M8 simulator evidence is recorded separately from web green"), each `requiredForGreen=false`.
- Diary M3: "Native playback and Hermes exports exist, but there is no simulator proof claim."
- Diary M8: "Native execution remains unclaimed; an export cannot establish device behavior."
- Essay: the Hermes exports are "valuable build evidence, but it is not a simulator or physical-device execution result."
- `run-record.json`: "Hermes export only; simulator execution not claimed".

**The builder never looked at the witness surface.**
- `guide.txt` (19:17:43) lists the `witness` card and the aliases "simulator -> witness, offline proof -> witness".
- But there is no `evidence/guide-witness.txt`, and no lane file mentions `witness`.
- No file cites the README section. The one README section the run log cites is `#stopped-backup-and-isolated-restore` (1789443102).
- The builder never quotes the section, which says: "`snapback4 witness ios` drives an installed Release app on macOS. It builds nothing. Add `snapback4-expo/witness` to the app and rebuild its native module." It then requires `npx expo run:ios --configuration Release --device "$UDID"`, a mounted `WitnessRunner`, and `npx snapback4 witness ios --bundle-id … --segment offline --artifacts … --port 4400 --prime`.

Publishing the witness (S30) could not change the outcome under this prompt.

---

## 4. Top 10 remaining Snapback problems, ranked by likely scoring impact

| Rank | Problem | Categories | Smallest fix |
|---|---|---|---|
| 1 | Native offline proof missing (§3; S30). The O4 score in L12 was 10. | client_and_offline, grade | Have `init --expo` scaffold a `WitnessRunner` and an `npm run witness:ios` script, and link the witness card from the `offline`/`prediction` card. **Instrument side:** reconcile the prompt's "not required" with the brief's `[native-artifact]` items. |
| 2 | Web write lost on immediate navigation, and the docs' pagehide claim didn't hold (F1; S29). | client_and_offline, diagnostics | Reproduce "mutate then `location.assign`" in the client tests. Flush every queued head within the keepalive budget on pagehide, or document and export `await client.flush()` before navigation. |
| 3 | Feeds recipe has no event removal, and the fanout rewrite is vague, pushing private inboxes to public (F3). | data_modeling, queries_and_live, grade (authz) | Add `removeEvent` to the recipe: iterate `follows[actor] first 50` so `readerId` is pinned, and delete `feed[f.followerId, …]`. The `E_STRUCTURAL_FANOUT` rewrite should name the deciding column (`.readerId`) and the loop that pins it. |
| 4 | Language card's `following` example is the wide read-time merge (F2; S14). | queries_and_live, scale_and_limits | Replace that example with a two-line merge in the recipe's shape (`[viewer]` plus `broadcast… first 32`) and a pointer to `guide feeds`. |
| 5 | No clock control (F5; S27). | diagnostics_dev_loop | Add `snapback4 dev --clock-offset <ms>` (or `run --now`) for dev only. |
| 6 | Aggregates need derived columns, backfills and a hand-built top-N (F7, F8; S24, S25). | data_modeling, queries_and_live | Allow `maintain count t by owner, day(.at)`, adopted with automatic backfill. Document the `rankedPosts` pattern as a recipe until then. |
| 7 | Named shape after `where` still refused, and `--fix` didn't repair it (F4; S07). | diagnostics_dev_loop, setup_and_docs | Make `--fix` rewrite `where <expr> shapeName` to `where <expr> { ...shapeName }`, and use that as the rewrite text. |
| 8 | Silent loss of prediction on social writes, with duplicated one-time notes (L1; S05, S06). | client_and_offline, diagnostics | Collapse `N_NOT_PREDICTABLE` to one line per mutation with its root causes. Remove `online only` from the language card's maintain example, or comment its prediction cost. |
| 9 | No replay/effects pause switch (F6; S28). | diagnostics_dev_loop, scale_and_limits | Add `snapback4 dev --no-effects --no-schedules`. |
| 10 | Diagnostic noise and papercuts (F11, F12, F14, L2, F8 code). | diagnostics_dev_loop, setup_and_docs | Map internal sites to line:col. Add `maintain`/`time` aliases to `language`. Suppress `N_NO_CURSOR` when `first N` ≥ the group cap. Move "cursor index" out of `E_QUARRY_UNKNOWN`. Have `init` set `"type": "module"` or write `snapback/package.json` when merging into a CommonJS package.json. |

**Next after the top 10:** S26 (digest chunking recipe), S16 (subset sync for public tables), a packaged SecureStore session store (L6), and worker-side effect dedupe (L4).