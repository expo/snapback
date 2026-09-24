# LLP 4000 design review — Claude Opus 5.5, effort max

**Date:** 2026-09-24. **Revision reviewed:** initial (`3106ff03d9`). **Mode:** blind, read-only, over a detached worktree at that commit; `claude -p --model claude-opus-5-5 --effort max`. **Provider/runtime:** Claude Code 2.1.281 on the black M5 Max. **Redacted:** no. **Brief:** [`4000-snapback5.brief.md`](./4000-snapback5.brief.md), shared verbatim with the Astra and Grok reviewers. **Verdict: NOT READY.**

## Verbatim review

I've finished reading and checking; here is my review.

# Blind design review of LLP 4000 (Snapback 5): Claude Opus 5.5

- **Reviewer:** Claude Opus 5.5 (Anthropic Claude family), reasoning effort max. I did not see the other two reviews.
- **Date:** 2026-09-24.
- **Text reviewed:** the initial revision, at commit `3106ff03d9`. I only read; nothing was changed or committed.
- **Path conventions:** code paths are relative to `snapback4/crates/` unless written out in full. Brief line numbers refer to `benchmarks/briefs/social-messenger.md`. The file names I cite for calibration #19 (the 2026-09-24 run on 0.4.0) are under `benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/`.

## Summary

The experiment is worth running. The way it is set up is right: a fenced sibling, Snapback 4 kept as the control, predictions registered in advance, a check on the mechanism, and reference runs of the incumbents first.

The design is not ready.

- **Three moves reverse decisions the engine depends on for correctness or privacy, not just ergonomics:**
  - pages the app has released but the device keeps have no way to receive revocations;
  - `retain delivered-history` is a product decision the brief tests, not residency plumbing;
  - §4.2 turns completeness from a fixed class into a runtime fact, which reopens a leak the class exists to close. The leak is a way to learn whether rows you cannot read exist.
- **The bar in §9 cannot tell the bet from the control.** On the record, Snapback 4 already reaches first green about twice as fast as both incumbents on the same brief text.
- **The scale replay §9 relies on never holds any pages.** So it cannot load the page registry that §10 names as the main risk.

## What is sound

- **Keeping the engine:** rules, the meter, at-most-once writes, the planner, the device interpreter, the simulator. LLP 3000.012 §3 reaches the same conclusion from the same record.
- **The governance:**
  - a fenced sibling, with Snapback 4 as the control;
  - a version that never ships if the bet fails;
  - a mechanism criterion (no learning-cost charge in three `data_modeling` notes) instead of a score target;
  - fitting the series, running three times, and having the author read the scorer's notes first. These are the right defences against a program crediting its own work.
- **Running the incumbents' lanes before writing code.** It is cheap and should happen whatever else is decided.
- **Naming delivery cost as the honest risk,** with the rule "fix delivery or stop; never add residency vocabulary back". That is a good commitment to make in advance.
- **Both additions aim at real costs.**
  - `per viewer` targets the one `data_modeling` charge #19 names outright: "Recipient receipts required explicit rows/helpers".
  - `through` targets the hand-copied `chat` columns on receipts and reactions.
  - Both LLP 3000.014 reviews endorsed the approach of copying the parent's rule inputs into the child so the child's rule stays local, under stated constraints.
- **The §3.2 rows that are already gone should stay gone:** index names, `maintain` strategies, `first 10001`, `size`, and feed caps the author could see (removed by LLP 3000.013).
- **Following can work under pages.** The inbox is per reader, so matching an inbox copy to the `(home, reader)` page is a single key lookup. That is the same shape as today's per-reader partition write. Finding 8 lists the conditions.

## Findings

### 1. The diagnosis

**Finding 1. High — Summary and §1. The evidence table misreads its sources, and the record does not separate "the learning cost is the bridge" from "the learning cost is learning an unfamiliar language".**

- **Row 2 drops exactly the items §3.2 removes.**
  - The row lists the declarations behind the four top-scoring categories as "`image <=N once`, read rules, client-minted ids, `expire at`".
  - The source says "Access and delivery: read rules, `sync to` and `retain delivered-history`" (`llp/3000.012-application-still-owns-derived-data.research.md:153–154`).
  - #19's authorization note (score 96) credits "retained-history policies [that] directly supported removed-member behavior without a separate history database" (`FINAL.md:22–24`).
  - The builder's diary calls the retained-history policy "the standout" (`lane-diary.md:8`).
  - So the record credits part of what §3.2 deletes with the top scores.
- **What the learning-cost notes name is mostly not residency.** Counting the ledger's abridged evidence in LLP 3000.012 (`:183–200`), across 16 notes:
  - residency: 2 notes (0.2.9 and 0.2.31), or 3 counting "audiences" in 0.2.25;
  - bounds or bounded execution: 11;
  - completeness: 5;
  - prediction: 1;
  - the language itself or its expressiveness: 8. The phrases are "unfamiliar language", "language-learning costs", "Quarry adds learning cost", "restrictive rule expressions", "less flexible than … SQL", "fewer language escape routes", "restricted joins/scans" and "constrained expressiveness".
  - #19's own comparison note says: "Compared with familiar TypeScript or SQL authoring, Quarry introduced learning cost" (`FINAL.md:69`). Snapback 5 keeps Quarry.
- **Rows 9 and 10 contradict each other, and removals have been tried.**
  - Row 9 says the subtractive strategy was "never run". Row 10 says "after two subtractive waves".
  - LLP 3000.013 removed index names, author-chosen caps, merge lanes and `size`. `data_modeling` moved from 87 to 90, which is within noise. The learning-cost charge stayed; only what it named changed, from index prefixes to bounds to "prediction/completeness".
  - W14b was a named removal whose pre-registered prediction was confirmed (LLP 3000.007 §20.24.3).
  - So a removal works when it targets the category it names. Removing vocabulary about *how* the engine works has not removed the learning-cost charge.
- **The charge is already moving to runtime.** #19 charges runtime completeness in three categories:
  - `setup_and_docs`: "insufficient examples of incomplete paginated observations";
  - `queries_and_live`: "Completeness required explicit client handling";
  - `data_modeling`.

  Its platform finding 4 is a runtime completeness defect: an incomplete read was published as `data: null`, which crashed `usePage` at M3 and blanked the inbox at M8 (`README.md:32`). None of these is a compile-time note. Snapback 5 makes every page the device has not fetched incomplete.
- **What the record supports:**
  - the gap between the bottom three and top four categories;
  - a learning-cost charge in every note;
  - that what the charge names follows whichever vocabulary remains;
  - that runtime incompleteness is already being charged.
- **What it does not support:**
  - that the learning cost is specifically the bridge;
  - that §3.2 removes the charge rather than moving it into `queries_and_live`, `client_integration` and `offline_sync`.
- **Fix:**
  - Correct rows 2, 9 and 10.
  - Restate the claim as a test between two readings, both pre-registered:
    - (A) *The bridge.* The learning-cost charge disappears, and no category's note charges runtime completeness, `pending`, or gaps in offline data.
    - (B) *The language.* The charge persists and names pages, `complete`, `through`, or Quarry itself.
  - Extend the mechanism criterion to every category's note (finding 19).

**Finding 2. Medium — §2 and §4. The RFC reverses LLP 2000.000's second flip without engaging the record that motivated it.**

- LLP 2000.000 §2 attributes most of Snapback 2's remaining costs to "result cache, not replica". A Snapback 5 page is a better cache than Snapback 2's: rows are stored once and rules are evaluated on the device. That avoids receipts, evidence identity and follower inboxes.
- Three of §2's rows come back directly:
  - fetching data page by page instead of as one bulk stream;
  - composite answers going partial when one component was never fetched (the `withHistory` row);
  - searching across all of a user's conversations, which can only be answered over what was shown.
- **Fix:** add a table that maps each "result cache" row of LLP 2000.000 §2 either to Snapback 5's answer or to the reason it does not recur.

### 2. Derived residency (§4.1, §4.4)

**Finding 3. Blocker — §4.1 ("released pages are kept for reads but not maintained"; "exactly as Snapback 4's device does today") and §8 (the simulator invariants still apply). Rows held outside maintained pages have no way to receive revocations.**

- **Why today's device can trust what it holds.**
  - It does not re-check rules on rows the server delivered: "Delivered rows are authoritative" (`snapback4-core/src/engine/read.rs:297–308`, `trust_synced_read`).
  - That is sound only because the partition log delivers every delete and every group revocation (`scope`) for everything the device holds.
  - The device catches up from a single watermark (`snapback4-device/src/device.rs:180`) over a log that is never compacted (`partition.rs:731–755`).
  - `leave()` purges the groups whose policy is until-revoked (`device.rs:1050`).
- **Scenario.**
  1. Bob views chat *c* (page P1) and searches it (page P2, which holds message *m* and its reactions). Bob navigates away, so both pages are released.
  2. Then one of three things happens: Carol deletes her reaction on *m* (a hard delete); *m*'s sender deletes it for everyone; or Bob is removed from *c* under the until-revoked policy.
  3. No page is maintained, so nothing reaches the device.
  4. Offline, P2 still shows *m*'s original text, and under until-revoked removal every row of *c* stays readable.
  5. Online, Bob reopens `history(c)`. §4.1 runs the query "over the device's store", and the deleted reaction is still there because P2's tag keeps it. The fresh page counts the reaction and reports `complete: true`.
- **What this violates.**
  - The brief's revocation rule: revoked content must "never render from the offline cache after the client has synced the revocation … a disconnected client purges immediately on reconnect" (brief lines 65–76).
  - Invariant 2 of LLP 3000 §6, which §8 says still applies.
- **Fix:**
  - Keep the partition log, or just its tombstones, as the revocation channel. Every delete, `scope` and expiry for any held row reaches the device in a single watermark order, whether or not its page is maintained.
  - Pages carry only entries, exits and reorders.
  - Local evaluation admits only rows that are current on the revocation channel.
  - Pre-register the size of the held set and the catch-up time for the probe user.

**Finding 4. Blocker — §3.2 row 2, and the sentence "Nothing in this table is a capability the application loses." `retain delivered-history` is a product decision, not residency.**

- **Clique requires the keeping policy.**
  - M3 says: "Removed members immediately stop receiving new messages but keep their local copy of history from before removal." Acceptance step 6 tests it (brief lines 509–510 and 523–524).
  - A holdout probe also covers it: "removed-member delivery" (line 817).
- **Neither default works.**
  - §3.2's replacement, "a revoked row is deleted, a still-readable one is not", deletes Carol's history, so M3.6 fails.
  - If the default is flipped to keep rows when a member loses access, then in a Workroom-style app (which the RFC's Non-claims cover), a member removed from an organization keeps its data on their device.
- **Both policies have product meanings.**
  - LLP 2000.000 §7.2 names both "with their exact product meaning" (`:347–348`): `until-revoked`, the default, where rows go; and `delivered-history`, where rows stay.
  - The engine implements both in `leave()`.
  - #19's program declares the keeping policy on five tables (`chat.q:15, 30, 59, 74, 90`).
- **Fix:**
  - Keep one word per table for the leave policy, and count it in the concept budget.
  - Define "revoked" precisely:
    - deleting a row, expiry, and a view-once photo being viewed always purge;
    - losing access purges under until-revoked;
    - under the keeping policy, losing access stops new delivery but leaves held rows in place.
  - The revocation channel from finding 3 carries loss of access as its own event.

**Finding 5. High — §4.4 and §9. The scale measurement cannot see the risk the RFC names in §10, and the page registry is new server machinery.**

- **The replay never loads the registry.**
  - In the scale replay, each action "settles before the next" through the replay adapter, the push seam is disabled, and probes run one at a time at checkpoints (brief lines 157–221).
  - No population of connected devices holds pages during the replay.
  - The registry's cost grows with the number of pages held while writes commit. Partition append, by contrast, is paid on every commit whether or not anyone is connected: `partition::append` runs inside `mutate` (`engine/mod.rs:929–937`).
  - So the replay charges Snapback 4's mechanism but not Snapback 5's, and the scale floor can pass with the registry never loaded.
- **Delivery is not metered today.** The serving side runs join expansion and snapshots with no ceilings (`Ceilings::unbounded()`, `partition.rs:547–548, 850–851`). "Within the meter" is undefined for delivery.
- **There is no registry to build on.**
  - The only server-side query liveness today works at table level: `/changes` returns which tables were touched, and clients rerun whole queries (`client.ts:400–407`).
  - That contradicts Summary item 1 ("Nothing in `snapback4-core` is rewritten") and §8's list of new work, which leaves out the server.
- **The work can be bounded for Clique, if matching starts from the audience.** A message would touch at most its 50 members' devices. A public post would touch every device, which is what Snapback 4 already pays at serve time, lazily and unmetered. The two unknowns are how large each page's set of dependencies is (finding 6) and how long reconnect catch-up takes. The RFC measures neither.
- **Fix:**
  - Pre-register a delivery load that runs during the replay's last segment, with:
    - every user connected and holding the warm set;
    - the probe user with 100 conversations open;
    - 50 members watching the busy group;
    - 900 followers on `home`.
  - Measure the matching work per commit, delivery p95, registry memory, and reconnect catch-up. Bound each against Snapback 4 with the same devices connected.
  - Specify that matching runs off the commit path and is not charged to the writer's meter, as Snapback 4's lazy expansion is not.

**Finding 6. High — §4.1 and §4.4. A page depends on everything it read, not just the planner's top-level filter, and the device needs the rows its rules consult.**

- **Matching on the query's top-level filter misses real changes.**
  - #19's `history(chat)` returns `messageCard`, which reads `profiles`, `messages[.quote]`, `receiptState(.)` (a loop over receipts with a membership check for each), and `reactionList(.)` (`chat.q:104–113, 220–222`).
  - None of these changes matches the filter `messages where .chat = chat`: a new reaction, a receipt update, a changed display name, or a like count that reorders `trending`. The page goes stale while reporting `complete: true`.
  - Filters on time, such as `trending`'s `.at > now - 1d`, change with no write at all.
- **The device needs the rows its rules consult.**
  - The page must carry the viewer's membership row for `exists members[.chat, viewer]`. That check remains even after `through` stamps the chat id onto the child.
  - It must also carry the viewer's follow edges for `following`'s filter.
  - Otherwise the device hides rows the server returned.
- **The dependency set is large.** For a 50-message page of the busy group, it is roughly 2,500 receipt rows plus the member list, reactions and profiles.
- **This is incremental view maintenance, not filter matching.** The nearest shipped design I know of is query-driven partial replication, as in Rocicorp's Zero, which maintains each query's result incrementally on the server over everything the query read.
- **Fix:**
  - Define a page as everything it read: every point read and index range touched by the plan, its shapes, its helper functions and its rule checks, plus the next moment at which a time-based filter changes. The registry indexes those.
  - Pre-register the size of that set and the matching cost for #19's history, inbox and home pages.

**Finding 7. Medium — §4.4. Matching filters before checking the audience does work for other users' pages, and the page key leaves out the viewer.**

- **Work for other users' pages leaks timing.**
  - §4.4 says a write is "matched against the registry by the same predicates … the audience rule still gates delivery". That runs filter matching over every registered page before checking who may see the row.
  - A message saying "coffee" in a private group then does work in proportion to strangers' registered `searchAll("cof")` pages.
  - If that work sits on the commit path, the sender can tell from how long the write takes to be acknowledged whether other people have such searches open.
  - Partition append does not depend on other viewers: each row image goes to zero or one partition (`partition.rs:111–126`).
- **The page key leaves out the viewer.**
  - §4.4 keys pages by (query, arguments); §4.1 and §4.2 add the cursor. None names the viewer or their auth context.
  - A shared registry entry for `home` or `inbox` would deliver one viewer's page to another.
- **"The partition inversion remains the outer check" is ambiguous.**
  - The inversion, which turns a read rule into an audience, exists for only three rule shapes (`snapback4-lang/src/bind/schema.rs:293`). It picks targets; it is not a check.
  - Read literally, the sentence makes every table with another rule shape ineligible for devices, and nothing tells the author. Today the `E_SYNC` refusal would, but it goes away with `sync`.
- **Fix:**
  - Match starting from the audience: from the row to its audience using the existing inversion, then to that audience's devices, then to their pages.
  - Key pages by (generation, query plan hash, viewer and auth context, arguments, cursor).
  - Gate delivery by evaluating the read rule forward for each device's viewer.
  - Have `check` say so for any table whose rows can never be held on a device.

**Finding 8. Medium — §4.4. "Following … unchanged from LLP 3000.013" is not possible as written.**

- **Its admission rule depends on a form §3.2 removes.** LLP 3000.013 §3.3 materializes the feed only when the originals, reposts and edges are "explicitly public and fully `sync public`" (`llp/3000.013-quarry-states-intent.rfc.md:257`).
- **The celebrity write problem is still open.**
  - In 0.4.0, the celebrity's post took p95 527 ms against 16.6 ms for a 5-follower author, failing the brief's 3× rule (`README.md:29`).
  - Lane L's fair engine lock is not in this tree. `serve.rs:54` and `:126–138` use a plain `Mutex`, and `serve_maintenance.rs:68–78` only calls `yield_now()`.
  - Adding registry matching for each inbox copy inside a 256-copy delivery chunk makes the engine lock stay held even longer, which is exactly what failed.
- **Devices will not hold the edges.** LLP 3000.013 has devices hold "the public edges" (`:318`). Under pages they will not, unless the page carries them (finding 6).
- **Fix:**
  - Restate the admission rule without `sync`: sources readable by everyone, owner-only write rules, and mapped columns that cannot change.
  - Make Lane L a prerequisite, and run matching outside the engine lock.
  - Have home pages carry the viewer's follow edges for the posts' authors.

**Finding 9. Medium — §4.1 and §8. What happens when the schema changes is not specified.**

- **What breaks:**
  - changing a query's filter, order or shape invalidates every held page of it, and their cursors;
  - an old client's generated `api.ts` asks for query shapes the new generation no longer defines;
  - narrowing a read rule means revoking held rows (finding 3);
  - activating `through` means adding hidden columns to child rows the devices already hold;
  - redefining a view means rebuilding it, the problem that took #19's `operations` score down to 72.
- **Snapback 4 handles this today.** It binds each sync stream to a schema generation, re-fetches tables whose rules narrowed, and resets the device when the server's store identity (`store_id`) changes.
- **Fix:**
  - Key pages by (generation, canonical query plan hash).
  - A page survives a schema change only if its hash is unchanged and no rule over anything it read became narrower. Every other page drops to `complete: false` and is fetched again.
  - Page requests from an old generation get a typed `E_GENERATION`.

### 3. Completeness and prediction (§4.2, §4.3)

**Finding 10. Blocker — §4.2: "A query that Snapback 4 would have classed `N_NEVER_COMPLETE` … reads `complete: false` until its server answer arrives, and then `true`."**

- **The note is not a prediction that the server's answer resolves.**
  - The server itself returns `complete: false` for these pages. The code says: "`complete` is a class, not a count: a query with a scan the prefix does not decide is capped whatever the meter found" (`engine/mod.rs:785–788`).
  - The note's own text says "complete: false on the server whatever it finds" (`snapback4-lang/src/guide/codes.rs:197`).
  - LLP 3000 §7 (decided 2026-09-12) keeps it that way so that "a hidden row costs what a miss costs", and where the meter cut the scan is never sent to the client.
  - The note was also never an error in Snapback 4, as §4.2 implies.
- **Making it a runtime fact leaks.**
  - If `complete` becomes true once the server's scan finishes, its value now depends on how many rows the viewer cannot see were in the range.
  - A range with 8,192 or more hidden rows (the examined-rows ceiling, `snapback4-core/src/meter.rs:23`) gets cut and reports false; the same range without them reports true.
  - By narrowing ranges and following cursors, a viewer can use this to learn whether rows they cannot read exist.
- **The safe alternative moves the cost somewhere worse.** If the implementer keeps the class instead, those pages report false forever, with nothing at compile time to say why. That is exactly the runtime surprise the note exists to prevent.
- **Fix:**
  - Keep "completeness is a class" exactly as it is, on the server and the device.
  - Keep the class as one line per query in the default `check` output. It is a correctness fact, not scale evidence.

**Finding 11. High — §4.2. `complete` as defined is wrong in four cases.**

- **(a) Offline.**
  - "Every change the server has delivered for it is applied" is trivially true while offline, so a stale page the app still has open reports `true`.
  - Yet §5 tells apps to show "offline, showing what you had" by reading `complete`.
  - Snapback 4 keeps staleness separate: `fresh` means the value reflects the server now, and `since` lets a screen say "as of three minutes ago" (`snapback4/packages/snapback4/src/contract.ts:43–50`).
- **(b) Writes to what the page filters on.** A pending unfollow or leave writes to `follows` or `members`, not to a row the page is ordered by. Clause 3 of §4.2 never fires, yet what the page shows changes.
- **(c) Pages that shrink.** A local delete in a `last 20` page leaves 19 rows, and the device does not hold the 21st.
- **(d) Stale rows from other pages.** Running the query over the whole store picks up rows held by other pages that the server's answer excluded (finding 3).
- **Fix:** report `complete: true` only when all of the following hold:
  - everything the page read is held and current on the revocation channel;
  - no pending write touches anything the page read, including rows the rules and filters consult;
  - the local result matches the set of rows the server delivered;
  - the query's completeness class allows it (finding 10).

  Keep `fresh` and `since` for staleness.

**Finding 12. High — §4.3. The conditions are not a proof, and they leave out the mutation's body.**

- **Constraints need the complete set of rows for their key.**
  - "Can be checked over held rows" proves nothing when the device holds only some of those rows.
  - Snapback 4 proves absence only from "the complete held group and its key": a synced table with no horizon, and a key that pins the audience (`snapback4-core/src/engine/rules.rs:29–43`). Pages supply no such group.
  - Example: `addMember` has `unique chat, principal` and `cap 50 by chat` (`chat.q:23–24, 154–158`). Predicted from an inbox page that holds only the viewer's own membership, it can add someone who is already a member, or a 51st member. The row shows as pending, then disappears when the server refuses it.
- **The mutation's body reads count too.** §4.3 names "the write's rule" but not the body. #19's `send` loops over `members where .chat = chat` (`chat.q:182–187`). Over a partial member list, the predicted result is wrong.
- **`now` cannot be proven on the device.** `edit` requires `now - m.at <= editWindow()` (`chat.q:234`). The brief enforces that window against server time. #19 marked `edit` and `deleteMessage` as `server`, an eligibility keyword that §3.2 removes.
- **A held row is not a live one.** Both LLP 3000.014 reviews found that prediction needs a live, current parent, not merely a held one (Astra finding 7, Grok finding 7). A released page is held but not current.
- **How often apps will see pending writes.** Here is my estimate, applying §4.1's residency to #19's own program:
  - Ten writes matter offline.
  - Today, four queue without a local row: `follow`, `unfollow`, and the two `server` mutations.
  - Under §4.1, about eight would:
    - `createDm`, which needs all of the viewer's DM pairs;
    - `addMember`, and removing someone else, which need the member list;
    - `send` in #19's form, which loops over the member list;
    - `follow` and `unfollow`, as today;
    - `edit` and `deleteMessage`, which depend on `now`.
  - `react` predicts only if the page carried all of the message's reactions.
  - Which writes predict would depend on the user's navigation history, which the builder cannot see.
- **Fix:**
  - A read in a mutation counts as proven only in one of two ways:
    1. a point read of a row that is on a maintained page and current on the revocation channel;
    2. a complete held set for the read's key range: a maintained page, not cut by the meter, whose filter covers that range. Absence checks and constraints need this second kind.
  - Conditions that depend on `now` are never proven on the device.
  - `why` names the read that failed and the page that would satisfy it.

**Finding 13. High — §5. Two booleans are not enough. Snapback 4's compile-time classes and runtime states carried information apps need.**

- **(a) A write that was not predicted has no row, so no `pending` flag.**
  - M6.2 requires "Send two messages offline; both show pending" (brief line 654), and M8.8 requires the same after relaunching the app.
  - Snapback 4 exposes each write as `pending | sent | failed`, with reasons such as "queued without a row: …" (`contract.ts:74–78`; `snapback4/packages/snapback4/src/local.ts:1303–1305`; the `usePendingWrite` hook).
- **(b) Refusals.**
  - An edit queued offline and replayed after its window has closed is refused, and the app cannot say so without the `failed` state and its reason.
  - LLP 3000 §6 invariants 1 and 4 require every write to be "pending, sent or failed", and failures to arrive as a typed conflict. §8 says the invariants still apply.
- **(c) Denials and loading.** Access refusals (`E_AUTH`, `E_OFFLINE`, rule refusals) and the `loading` state all collapse into `complete: false`.
- **(d) Staleness,** as in finding 11(a).
- **(e) Facts known at compile time.**
  - Snapback 4 generates `predicts: eligible | never` and `runs: device | server` on each operation. They told the app when it had to build its own placeholder.
  - `N_NOT_PREDICTABLE` exists because "the 0.2.6 builder's hardest loop" only showed up during an offline test, not at `check` (LLP 3000.007 §6.4, lines 758–760).
  - §5 moves that loop back into offline testing.
- **(f) Auth.** §5's auth state also drops `restoring` from Lane E's model (LLP 3000.013 §6).
- **Fix:**
  - Keep Snapback 4's read and write result types.
  - Add a view of the outbox that lists unpredicted writes by operation and arguments.
  - Keep `runs` and `predicts` as generated facts on each operation.
  - Count all of these in the concept budget. The residency vocabulary can go; these states cannot.

**Finding 14. High — §6 and §3.2 row 6. Some of the sixteen notes warn about data exposure or completeness, not scale.**

- **Three are about exposure or write permission:**
  - `N_MAINTAINED_COLUMN_DISCLOSURE`: "parent readers learn a count or sum … even without source-row read permission" (`codes.rs:11`);
  - `N_MAINTAIN_DELTA`: warns that an aggregate view exposes a delta "if the delta is private" (`:135`);
  - `N_PUBLIC_AGGREGATE_COPY`: warns of "latent table permission" (`:134`).
- **One is the completeness class.** `N_NEVER_COMPLETE` is the class from finding 10.
- **Hiding them behind `--scale` hides security facts** in a product whose best category is authorization.
- **Optional reports go unused.**
  - #19's scale certificate went unused because the README never mentioned it, and the scorer charged the result (`README.md:34`).
  - §6 says "the calibration brief's scale milestone is expected to run it". That contradicts the RFC's own non-claim that the brief does not change.
- **Fix:**
  - Keep the exposure notes and the completeness class in the default `check`, or make the exposure notes errors that require an explicit acknowledgement.
  - Have the default `check` print one line pointing to `--scale` whenever an operation's cost grows with data.

### 4. The two additions (§3.3)

**Finding 15. High — §3.3, `per viewer`. It cannot express the receipts #19 was charged for, and the example uses a storage shape the record already abandoned.**

- **The sender needs other people's values.**
  - The brief's receipts are "per message, monotonic … In groups the aggregate indicator shows a state only when every member of the message's recipient set has reached it", and the recipient set is the membership at the time of sending (brief lines 500–507).
  - The sender reads other members' states: #19's `receiptState` takes the minimum over other members' rows (`chat.q:104–112`).
  - "Reads see the viewer's own value" cannot express that. The receipt table stays, and `per viewer` replaces only "unread for me".
- **It stores one row per message per reader.**
  - `seen: bool per viewer` on `messages` keeps one hidden row per (message, viewer): up to 10,000 × 50 in the busy group.
  - LLP 3000.007 §6.9 (line 847) records the 0.1.0 lane paying for exactly this shape, and the fix that replaced it: a high-water mark on the membership row.
  - The guide's only unread-count recipe is a `readOrdinal` mark on the membership row (`snapback4-lang/src/guide/jobs.rs:175–208`).
  - Marking 1,500 unseen messages as read would also exceed the 1,024-row write limit per mutation (`meter.rs:23`).
- **Who can read the hidden rows is unclear.** Read literally, "treats it as part of the row's audience" sends every member's flags to every member. That exposes each member's read state to the others and copies the data fifty-fold.
- **The aggregate is a second per-reader materialization.** "Computed for the viewer" contradicts §4.4's "Following, the one per-reader materialization". Every new message changes 49 counts, and expiry must retire them.
- **Fix:**
  - Redesign it as a per-viewer value on the parent, for example `readUpTo: time per viewer` on members or conversations, declared either private to the viewer or visible to the row's audience.
  - The sender's indicator is then: every current member who joined at or before the message has `readUpTo` at or after it. Unread becomes a range count.
  - Otherwise, keep the receipt table and drop the claim.

**Finding 16. High — §3.3, `through .ref`. The RFC quotes the narrower design, but the defects both reviews found are still open, and one is restated.**

- **(a) Live or captured?**
  - §3.3 defines the term as "readable when the row `.ref` names is readable by this viewer now", which is live. It then derives the child's audience "from the copy", which is captured.
  - That contradiction is Blocker 1 in both reviews: "choose one lifetime contract"; "pick one meaning and delete the other".
  - Stamping the parent's incarnation detects that a parent was recreated. It does not decide what happens to the children of a deleted or expired parent. In Clique, messages expire and are tombstoned while reactions still point at them.
- **(b) Refusals must not reveal the parent.** A missing parent, an expired parent and an unreadable parent must all be refused the same way, with the parent read budgeted in advance (Astra finding 4, Grok finding 8).
- **(c) Write-only use.** Using `through` only in a write rule must not store the parent's inputs where a wider read audience can see them (Astra finding 3).
- **(d) Order of operations.** Reject any client-supplied values for the hidden columns, then stamp them, then evaluate the rule (Grok finding 4).
- **(e) Adoption.** Fill the hidden columns inside activation, parents before children.
- **(f) No stated replacement for the sync restriction.** The narrower design limits sync to the three invertible rule shapes, and §3.3 states no Snapback 5 equivalent. The stamped rule still checks `members`, so the device needs that row (finding 6).
- **(g) The budget claim.** §7 says `through` deletes "the `immutable` lines from every child". The narrower design makes the reference column immutable automatically, but still requires `immutable` on the parent's audience columns.
- **Fix:**
  - Adopt LLP 3000.014 revision 2 as the design of record once it exists, with the lifetime question decided. I would choose captured audiences with incarnation stamps, plus an engine-owned cascade that deletes children when their parent is deleted or expires, so no orphan outlives its parent.
  - Add the refusal table, and state which rows the device must hold to evaluate the rule.

### 5. The bar (§9)

**Finding 17. High — §9 row 1 and §1 rows 11–12. The time criterion does not test the bet, and its premises are wrong.**

- **The incumbents have already been timed on this brief.**
  - The brief has not changed since 2026-09-03 (per `git log`), so the 2026-09-05 wave ran the same text.
  - `~/clique-full-20260905/lanes/astra-supabase/milestone-clocks.json` shows M1–M6 and M8 all green, with M5 first green at 70.5 minutes and M8 at 110.5 minutes, cumulative.
  - LLP 3000.007 §2.1 records Convex's first-green times per milestone: 792, 785, 304, 267, 1,037, 1,290 and 1,168 seconds, about 94 minutes in total.
  - Snapback 4 0.4.0 reached M8 first green at 54 minutes.
  - These were different weeks, so the protocol would not accept the comparison. But Snapback 4 is roughly twice as fast, so criterion (a) is probably already met by the control.
- **The fairness rule rests on a false premise.** The RFC says "the incumbents cannot do the offline milestones". In fact:
  - Supabase went green on M6 and M8 and passed 13 of 13 M6 assertions in the independent grade.
  - Convex reached its own M6 and M8 greens, then failed 7 of 13 M6 assertions in the grade.
  - The 44 and 43 the RFC cites are scores from the scoring model's narrative, not measures of what the incumbents could build.
- **"First green" leaves out the risky work.** #19 spent about 60 of its 115 minutes after first green, on switching Following, reworking unread counts, and a second scale replay. That is exactly where derived residency's costs would land.
- **The protocol rules are not met.**
  - "An ordering claim likewise requires N>=8 … unless … a preregistered variance-transfer rule" (`benchmarks/protocol.md:181–186`).
  - Lanes must run "serially on the same machine" (`:27–29`).
  - §9 times the incumbents now and Snapback 5 later, which breaks even its own same-week rule.
- **The additions confound the result.** If `per viewer` and `through` ship only in Snapback 5, they remove #19's named charge, and derived residency gets the credit.
- **Fix:**
  - Decide the bet by comparing Snapback 5 with a Snapback 4 that has the same additions (see Q2). Run them interleaved on one host, at least three runs each under a variance-transfer rule registered in advance, or at least eight each.
  - Measure time to the last green, including scale work, and tokens.
  - Keep the incumbents as a product reference across all milestones.

**Finding 18. High — §9 row 2. The correctness bar is unreachable as written, and the checks that would catch this design's defects are missing.**

- **The pass counts cannot be compared.**
  - Supabase's 92 of 101 came from M1–M6 all passing, with M7 not run.
  - #19's 85 passed and 16 not run left seven native-simulator M6 assertions unrun, because native proof was optional (`RUN_QUALIFICATION.json`), plus M7. So 85 was the most #19 could score.
  - #15's grade had 119 assertions (LLP 3000.007 §20.24.3).
- **The grade is uncalibrated and has no holdout probes.**
  - #19's grade is labelled "uncalibrated-grader … no holdout probe set was committed" (`README.md:3`).
  - The holdout categories are where findings 3, 4 and 10 would show up: "removed-member delivery" and "server-side denials surviving the offline cache".
- **Fix:**
  - Freeze the assertion list with a rule, registered in advance, for assertions that are not run, and compare pass *rates* over the assertions every lane attempted.
  - Require native artifacts from every lane, or exclude them for every lane.
  - Commit a holdout probe set, by hash, that includes those probes plus new ones for:
    - revocation reaching a released page;
    - a removed member's history;
    - completeness over a range full of rows the viewer cannot see.

**Finding 19. Medium — §9 rows 3–5 and the mechanism criterion.**

- **The floors are too low where the charge would move.** The floor for `queries_and_live` is the series median, 83.5, against 90 in #18 and #19. That is the category where a relocated completeness charge would land.
- **Who classifies the learning-cost charge is not stated.** LLP 3000.012 §1 says it was classified "by reading".
- **The failure case is worded wrongly.** §9 says that if the clock moves and the note still says learning cost, "the bet has not been tested". That outcome is a failed prediction, not an untested one.
- **The trend data is stale.** `benchmarks/TREND.md` was generated from 12 runs through 0.2.28 and has not been regenerated since, although its header asks for that after every calibration.
- **Fix:**
  - Set the floors at Snapback 4's recent level (the median of its last five runs) in `queries_and_live`, `offline_sync`, `client_integration`, `writes_and_transactions` and `setup_and_docs`.
  - Have a model from another family classify the notes blind, using a frozen rubric that covers the learning-cost charge and any charge about runtime completeness, pending writes or offline gaps, in every category's note.
  - Regenerate the trend data and fix the series before the work is commissioned.

**What would let the bet pass without being true:**

- criterion (a) is already met by the control;
- the additions' effect is credited to residency;
- the registry's cost falls after first green, and outside a replay that holds no pages;
- the category floors sit below recent levels;
- the learning-cost charge reappears under another category's name;
- no holdout probe tests revocation.

**What would let it fail without being false:** a correctness bar that the control could not reach either.

### 6. The open questions (§11 items 2–4)

- **Q2 (`through` and `per viewer`): put neither in Snapback 5's first slice.**
  - Land both in Snapback 4 first: `through` as LLP 3000.014 revision 2, and `per viewer` redesigned as in finding 15, with its own review. The control then carries them, and Snapback 5 differs from it only in derived residency and the runtime facts, which is what the bet is about.
  - Otherwise any movement in `data_modeling` cannot be attributed, because `per viewer` targets the one charge #19 names outright.
  - If one of them must go into Snapback 5, make it `per viewer`, after the redesign. `through` has no revision 2 yet, and its lifetime question is still open.
- **Q3 (offline depth): require an engine-derived depth policy in the first slice.**
  - The first slice is the messaging half, and the brief defines its states in terms of data the device has fetched or synced:
    - a receipt is `delivered` when "fetched by the recipient's client" (lines 500–503), so if the device only fetches what was shown, "delivered" collapses into "read";
    - M5's offline search covers "already-synced messages";
    - M6 must show "all previously synced chats, messages" (line 616);
    - the scale envelope measures cold-start sync for a user in 100 conversations (line 243).
  - The smallest policy the engine can derive on its own is one step out from the warm set:
    - For each row in a warm page, fetch the first page of every declared query whose only non-cursor argument is that row's reference. For example, fetch `history(chat)` for each conversation in the inbox.
    - Keep those pages maintained while connected, under a stated device budget.
    - Revocations arrive through the channel from finding 3.
  - Pre-register its cold-start cost against the 12.6–15.0 seconds #19 recorded (`lane-final-report.md:53`, `lane-run-log.md:144`).
  - Also state the eviction budget and order, and never evict rows that a pending write or a maintained page depends on. "Evicted by age under a device budget the engine sets" cannot be tested as written.
- **Q4 (concept budget): report it until the first calibration, then make it a binding ratchet.**
  - Freeze and test the counting rule when the work is commissioned, so the number cannot be redefined afterwards.
  - Count the runtime states and error codes the app must handle (read states, write states, `why` outcomes, refusals), not just declaration forms. Otherwise moving concepts from compile time to runtime lowers the count without lowering what the builder must learn, which is findings 1 and 13 in numeric form.

### 7. Under-specified, or not actually removable

**Finding 20. Medium — §3.2 row 7. `online only` and the online tier cannot be removed.**

- **`online only` is a policy about data at rest.** It means "rows never enter a partition or a device" (LLP 3000.007 line 671). Under §4.1, every declared query's pages persist on devices, including audit logs and organization-wide reports, as in Workroom.
- **Headless clients need the online protocol.** M6's third-party client works from nothing but a token and `API.md`, and the replay adapter drives 167,243 actions without a device.
- **Fix:**
  - Keep `online only`: never stored on a device, always answered by the server, and `complete: false` offline.
  - Keep `createClient` as the surface for headless and third-party clients.

**Finding 21. Medium — Summary item 1 and §8. "Nothing in `snapback4-core` is rewritten" and "engine changes land in Snapback 4 first" cannot both hold.**

- **Much of the work is new engine code:**
  - the page registry and page-keyed catch-up are new server code;
  - the device store records no tag for which page or partition brought a row (`snapback4-device/src/memory.rs:32`);
  - `per viewer`'s hidden rows and `through`'s stamping are changes to the write path.
- **The trap:** landing the registry in Snapback 4 first changes the control.
- **Fix:** list the hooks the engine needs (a post-commit change feed that carries the ranges each write touched, page tags in the device store, hidden per-viewer rows), and say which land dormant in Snapback 4 and which exist only in Snapback 5.

**Finding 22. Medium — §4.1, the warm set.**

- **It fetches too much.** "Every query whose arguments are absent or viewer-only, first page", fetched at every sign-in on every device, includes `insights` and `trending`, the heaviest aggregates in the scale envelope, plus any admin query.
- **It holds too little of what matters.** For the probe user it holds only the first 50 of 100 memberships (`chat.q:121–122`). That decides which conversations can predict `send`.
- **Fix:**
  - State the warm set's size budget.
  - Exclude online-only queries.
  - Pre-register its cold-start cost for the probe user.

**Finding 23. Low — §3.1. "Six declaration kinds … That is the whole language card" is not what the brief needs.**

- **What the list leaves out:**
  - `fn` helpers;
  - `effect` and `emit … once`;
  - `search` table lines;
  - `expire at`;
  - media column types, including `once`;
  - `connected` (presence);
  - `upsert` and `if absent`;
  - `require … else`;
  - `created`.
- #19 uses all of these.
- **Fix:** say which stay. Otherwise the concept count at commission will surprise.

**Finding 24. Low — §1 row 10.**

- **The error-code count is off.** The code registry has 161 distinct `E_` codes. The figure of 163 also counts the prefix fragments `E_TIMELINE_` and `E_WITNESS_`.
- **The cited file is not on this host.** `~/sb4-intent/target-clique.q` does not exist here. Cite the committed copy, `snapback4/crates/snapback4-sim/tests/fixtures/intent-clique.q`, which `snapback4/reports/20260924-following-view/report.md:41–43` says is byte-identical.
- **One cited form is a product rule, not residency.** The target's `cap 50 by conversationId` is the brief's 2–50-member rule for groups, which §3.2 keeps as `at most N by`.

## Verdict

**NOT READY.**

There are three Blockers:

- no way for revocations to reach rows in released pages (finding 3);
- a product policy mistaken for residency (finding 4);
- the completeness class turned into a runtime fact that leaks whether hidden rows exist (finding 10).

Each is a correctness or privacy regression against the engine the RFC keeps. And the bar cannot yet tell the bet from its control.

The direction survives. A revision needs to:

- add a revocation channel;
- keep one leave-policy word and `online only`;
- keep the completeness class;
- define pages by everything they read, including the rows their rules consult;
- keep the runtime states of finding 13;
- redesign `per viewer`;
- take `through` as LLP 3000.014 revision 2;
- land both additions in the control;
- judge the bet against Snapback 4, with holdout probes for the trust boundaries and a delivery load.

A second review round on that revision is worth doing.
