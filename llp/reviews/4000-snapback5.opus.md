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


---

## Round 2 — revision 2 (`dbb10169b6`), 2026-09-24

**Mode:** blind delta review, read-only, over a detached worktree at that commit; `claude -p --model claude-opus-5-5 --effort max`. **Brief (shared verbatim with the Astra and Grok round-2 reviews):**

> You are a blind design reviewer for a proposed Snapback 5. This is a **delta review**: revision 1 of `llp/4000-snapback5.rfc.md` (commit `3106ff03d9`) was reviewed by three model families, all NOT READY, and revision 2 (commit `dbb10169b6`, the checkout you are in) answers them. Read-only: run any read-only command, change nothing, commit nothing. Your review is recorded verbatim under `llp/reviews/` with your family named; the other two families are reviewing the same revision blind.
> 
> Read, in this order:
> 1. The three round-1 reviews: `llp/reviews/4000-snapback5.astra.md`, `llp/reviews/4000-snapback5.grok.md`, `llp/reviews/4000-snapback5.opus.md`.
> 2. Revision 2 in full, and `git diff 3106ff03d9..dbb10169b6 -- llp/4000-snapback5.rfc.md`.
> 3. Whatever engine code and documents you need to check its claims: `snapback4/crates/snapback4-core/src/engine/` (the partition log, `read.rs`, `write.rs`, `rules.rs`), `snapback4/crates/snapback4-device/`, `snapback4/packages/snapback4/src/contract.ts`, `llp/3000.014-*` and its reviews, `llp/2000.000-*` §7, `benchmarks/protocol.md`, the calibration #19 record, and `~/clique-full-20260905/lanes/*/milestone-clocks.json` if present on this host.
> 
> Answer four questions:
> 1. **Is each round-1 finding actually resolved by the text?** Go through §12's disposition table and say, per row, whether the disposition is real, partial, or only asserted. Name the sentence in revision 2 that resolves it, or the gap.
> 2. **Did revision 2 introduce a new defect?** Look especially at: the log as authority with pages as an index over it (§4.2–4.3: can a page subscription and the partition log disagree? what does a device do with an entry/exit for a row whose image never arrived on the log?); the one-step depth policy (§4.1: cost, eviction, its interaction with `keep history`); prediction by proof (§4.5: is the four-rule proof sound, and is the stated expected rate right for #19's program?); `per viewer` as a mark on the parent (§3.3: does it express the brief's receipts, including recipients who leave, and what does "visible to the row's audience" disclose?); the engine hooks in §8 (can a dormant change feed be landed in Snapback 4 without changing the control?); and the bar in §9 (can the bet still pass without being true?).
> 3. **Are the pre-registrations in §9 concrete enough to be held to?** Name any criterion an evaluator could still move after seeing results.
> 4. **What remains under-specified enough that a competent implementer would build it wrong?**
> 
> For each finding: severity (Blocker / High / Medium / Low), the exact section, a concrete scenario or counterexample, and the smallest change that fixes it. Say plainly what is now sound. End with an overall verdict: READY, READY WITH CHANGES, or NOT READY.


### Verbatim review

# LLP 4000 revision 2: delta design review, Claude Opus 5.5 (Anthropic), effort max

- **Date:** 2026-09-24.
- **Revision reviewed:** revision 2 (`dbb10169b6`), read against revision 1 (`3106ff03d9`). I did not see the other two round-2 reviews. I only read; nothing was changed or committed.
- **What I checked it against:**
  - the three round-1 reviews;
  - the engine: `snapback4-core` (`partition.rs`, and `engine/read.rs`, `read_auth.rs`, `write.rs`, `write_target.rs`, `rules.rs`, `local.rs`, `meter.rs`), `snapback4-device` (`device.rs`, `device/boundary.rs`, `device/history.rs`) and `packages/snapback4/src/contract.ts`;
  - the documents: LLP 3000.013 §3–4, LLP 3000.014 and both its reviews, LLP 2000.000 §2 and §7, and `benchmarks/protocol.md`;
  - the record: calibration #19's README, FINAL, lane diary and Quarry source; the committed Clique target `snapback4/crates/snapback4-sim/tests/fixtures/intent-clique.q`; `~/clique-full-20260905/lanes/astra-supabase/milestone-clocks.json` (Supabase reached M8 first green at 110.5 min cumulative, as revision 2 says); and the `~/clique-ref-20260924` packet README.
- **Paths:** code paths are relative to `snapback4/crates/` unless written out. Calibration #19's files are under `benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/astra/`.
- **Disclosure:** this same model wrote the round-1 Opus review, in a separate session. Revision 2 adopted four of that review's fixes almost word for word:
  - the four conditions on `complete`;
  - `per viewer` "on `members` or `conversations`";
  - the one-step depth rule;
  - "a complete held set for the key range" as proof of absence.

  Findings H3, H4, H5 and M1 below say where each of those was wrong or incomplete.

## Summary

Revision 2 turns the design the right way:
- the partition log stays the authority;
- pages are keyed by viewer and generation;
- the leave policy, `online only`, the completeness class and Snapback 4's typed results all stay;
- the bet is judged against a control that carries the two additions.

Most round-1 blockers are resolved in intent.

It is not ready to commission, for three reasons:
- **One blocker remains, in the core mechanism.** The text never says which log events reach a device. On the reading §4.3 suggests most strongly, updates that revoke content never reach pages the app has released. On the reading §4.2 states, the delivery falsifier fails automatically.
- **Several fixes bring new defects:**
  - page sharing ignores shapes that depend on the viewer;
  - the page closure includes rows the viewer may not read;
  - `complete` changes meaning without saying so;
  - the four proof rules are unsound in one place, too strict in two and silent in three;
  - `per viewer` on `members` is the wrong tool, and unread counts become a read-time scan.
- **§9 has instruments but no decision rule.** Reading (A) is judged on one arm only, against a standard the control already fails.

## What is now sound

- **The log is the authority and the revocation channel (§4.2).** Scope events already travel in the principal's own partition, so a membership revocation reaches the device whatever pages it holds.
- **The page key (§4.3):** generation, plan hash, viewer and auth context, arguments, cursor. That removes the cross-viewer result cache for rules that depend on the viewer. H1 is about shapes, which the key rule still misses.
- **Matching starts from the audience,** runs off the commit path and is not charged to the writer's meter. That closes round 1's timing and meter disclosures.
- **What stays:**
  - `keep history`, with until-revoked as the default;
  - `online only`;
  - `at most N by`;
  - the completeness class and the five disclosure notes in the default `check`;
  - the `Read<T>` and `Write` types;
  - `runs` and `predicts`;
  - the `restoring` auth state.
- **The direction of §4.5 is right:**
  - possession is not proof;
  - the reads in the mutation body count;
  - `now` is never proven on the device;
  - a parent must be live and covered, and a parent created earlier in the same body is visible;
  - a refusal removes the local image;
  - `why` names the read that failed and the page that would satisfy it.
- **Following (§4.4)** is restated without `sync`: the admission rule, the viewer's follow edges in the home page's closure, `complete: false` during backfill, and Lane L as a prerequisite.
- **Schema adoption (§4.3):** a page is dropped and refetched unless its plan hash is unchanged and no rule it depends on became narrower; old-generation requests get `E_GENERATION`; fills for `through` and `per viewer` happen inside activation, parents first.
- **Receipts derived from marks (§3.3):** "every member whose `joinedAt` is at or before the message has `readUpTo` at or after it", evaluated over current membership, is exactly the brief's recipient-set rule (brief lines 500–507). Members who leave before reaching a state drop out, and a member who rejoins later was not a recipient. One mark write stays inside the 1,024-row write limit.
- **`through` now has one lifetime rule,** not two contradictory ones. Also right:
  - uniform refusals;
  - write-only use stores no copy;
  - copied inputs stay out of query rows, cursors and write results;
  - fills happen inside activation.
- **The shape of §9 is right:**
  - the control carries the additions;
  - lanes run interleaved and serially on one host;
  - the clock to the last green is included;
  - a not-run shared check counts as not passed;
  - holdout probes are committed by hash;
  - a delivery load the replay never exercised;
  - blind classification of notes by another model family, and the author does not classify;
  - a failed prediction is called one.
- **§1's corrections check out:** 16 note codes, 161 error codes, and the incumbents' clocks.

## 1. Round-1 dispositions, row by row

**Real** means the text resolves the finding. **Partial** means some of it is resolved. **Asserted** means the table claims it but the text does not do it.

| # | Round-1 finding | Verdict | The sentence that resolves it, or the gap |
|---|---|---|---|
| 1 | The diagnosis over-reads the ledger; rows 2, 9, 10 wrong | **Partial** | The rows are fixed (§1) and the claim is now a bet with a registered alternative (Summary, §9.1). But the corrected record points away from the bet, and the RFC does not say so. Residency appears in only 2–3 of the 16 learning-cost phrases, and #19's diary places its remaining cost in mechanisms revision 2 keeps (H7). |
| 2 | A registry keyed by (query, arguments) is a cross-viewer cache and drops revocation for released pages | **Partial** | The key is real (§4.3 "Key"). "This channel reaches every row the device holds" (§4.2) is **asserted**: the text never says which events reach a device, and the revocations it lists miss update-shaped ones (B1). Astra's snapshot-and-subscribe race and her fallback for query shapes with no maintenance algorithm are not addressed. |
| 3 | `retain delivered-history` is a product policy | **Real** | §3.1 `keep history`; §3.2 "Kept". New gaps with eviction and the depth step (M1). |
| 4 | `N_NEVER_COMPLETE` is a server fact | **Real** | §5: "complete is false … for a page whose class is never-complete"; §6 prints the class. |
| 5 | Two booleans lose facts | **Real**, for the types | The §5 code block. But §5 also changes what `complete` means (H3). |
| 6 | Possession is not proof; the body counts; `now`; the Lane P citation | **Partial** | Rules 1–4 improve on revision 1, and the citation is gone. But "versioned coverage" is never defined, and "a maintained occupancy witness the engine delivers" is Lane P's unlanded idea again, unspecified. Rule 2 lacks Snapback 4's audience condition and its exemption for minted ids. Range reads in the body fall under no rule. The expected rate is **asserted** and contradicts the rules (H4). |
| 7 | `through` restates a rejected design; its lifetime is undecided | **Partial** | The lifetime is decided (§3.3, first bullet). But "LLP 3000.014 revision 2 … the design of record" names a document that does not exist yet. The cascade is new and unspecified; changes to a parent's rule or defaults after the copy are not addressed; and where `through` may appear in a rule (`not through`, `through` under `or`) is not restated (M2). |
| 8 | `per viewer` cannot express the sender's tick | **Partial** | The receipt derivation is real. What the modifier means on `members`, how a query reads another member's mark, and what unread costs are not (H5). |
| 9 | Some notes are disclosure facts | **Real** | §3.2 rows 4–5 and "Kept"; §6. |
| 10 | The bar can pass without being true | **Partial** | The instruments are real. The decision rule, the thresholds and classifying both arms are missing (H6, H7, M5–M8). |
| 11 | The incumbents can do the offline milestones | **Real** | §1, the September 5 row. The reference packet's README still says they cannot. |
| 12 | "Nothing in the engine is rewritten" | **Partial** | §8 lists the hooks. The change feed carries the wrong data, "dormant" has no test, and the "Snapback 5 only" hooks live in shared crates (M3). |
| 13 | The warm set fetches too much and holds too little | **Partial** | Online-only queries are excluded and a depth step is added. The budget has no number, the depth step is far wider than its examples, and the probe user's inbox page holds 50 of 100 conversations (M1). |
| 14 | §3.1's six kinds cannot compile Clique | **Mostly real** | Still missing forms the committed target uses: `use identity`, `enum`, `default`, `unique … else CODE`, control flow, builtins (L1). |
| 15 | Schema adoption unspecified | **Real** | §4.3 "Schema adoption". Missing only what a page over a view reports while the view is rebuilt. |
| 16 | "Following unchanged" is impossible without `sync` | **Real** | §4.4. |
| 17 | The concept budget measures the wrong thing | **Real**, as a process | §7. The counting rule itself is still to be written. |
| 18 | 163 codes should be 161; cite the committed fixture | **Real** | §1. |

Round-1 findings the table leaves out:
- **Astra 2:** a versioned snapshot-and-subscribe protocol, atomic application of each commit, and a metered server fallback. Not addressed; B1's fix covers the first two.
- **Opus 5:** delivery is unmetered today (`Ceilings::unbounded()` in the serving paths). "Delivery work is bounded per page" names no bound.
- **Astra 11, and Grok's LLP 3000.014 finding 8:** whether the device can tell an absent mark (the default) from a mark it does not hold, and how a job reads one principal's mark. Field-level write authority is resolved; these two are open (H5).

## 2. New defects in revision 2

### B1. Blocker — §4.2–4.3 (also Summary item 2, §1.1, §2). Which events reach a device

**What the text says:**
- §4.2: the log "stays exactly as it is", and "a device catches up from one watermark".
- §4.3: "From the partition, the server finds the devices subscribed to spans of it, and from those devices the pages whose closure the write touches", and "Tombstones and images still come from the log".
- §4.1: released pages "are not maintained for entries and exits, and remain subject to the revocation channel".

**What Snapback 4 does:**
- A device's stream is every event of its own partition, the public partition and every group it held, after one watermark (`snapback4-core/src/partition.rs:721`).
- A horizon only limits what is fetched when the device first acquires a group. An update to a row the device holds is always applied (`snapback4-device/src/device/boundary.rs:98`).
- Each update is re-read at serve time, and becomes a delete if the row is gone (`partition.rs:848–858`).

That is why an update reaches every row a device holds today.

**Three readings the text allows:**
1. **The log exactly as it is.** The device receives every event of every partition its viewer is in, and derived residency limits only what it stores. Revocation holds. But delivery saves nothing, §4.3's matcher is extra work on top of Snapback 4's, and §10's falsifier ("matching work above Snapback 4's") fires automatically, because Snapback 4 does no matching.
2. **Partition spans.** A page subscribes the device to the partition spans its closure touches. This fits "log spans", "exactly as it is" and "one watermark", provided that:
   - a span stays subscribed while the device holds any row of it;
   - a new span is acquired inside the stream, the way group joins are (`partition.rs:886`, ruling 36).

   This reading is coherent. But then public data still reaches every device, because the warm set always holds `global` and `trending`. One `searchAll` page subscribes every group the viewer is in. And entries, exits and reorders can be computed on the device, so §4.3's matcher shrinks to fetching refills.
3. **Filtered by page closures.** The stream carries only events that touch held closures, plus tombstones. This is what §4.3's matching paragraph describes, and it breaks in four ways:
   - **Deleted content survives on released pages.** Bob's search page holds message *m*, and he navigates away, which releases the page. *m*'s chat is not in his depth step: it is his 51st conversation, or *m* lies below the first history page. Alice then deletes *m* for everyone. In #19's program and in the committed target, that is `update messages[m] { body: '', …, tombstone: true }` (`chat.q:249`; `intent-clique.q:143`). It is an update, not a tombstone. §4.2's channel carries tombstones, scopes, expiry and view-once; released pages are not maintained. One of two things follows:
     - Bob's device keeps *m*'s body, and offline search (M5.5 and M6.1, brief lines 607 and 651) shows content the brief says "must never render from the offline cache after the client has synced the revocation" (lines 65–73).
     - Or "current on this channel" excludes every released row from local evaluation, and offline search over previously synced messages returns nothing.
   - **The server must track every device's rows.** Tombstones for released rows need the server to know every row each device holds. Neither §4.3 nor §9.3's "registry memory" mentions this per-device state.
   - **"One watermark" fails,** because each page starts at its own sequence number.
   - **Entries can bring back deleted rows.** An entry can name a row whose image the log never sent (the 21st message after a delete is older than the watermark). So entries must carry images, which contradicts "images still come from the log". And because matching runs off the commit path, an entry computed from commit *S* can arrive after the row's tombstone from commit *S*+1 and resurrect the row. That is prevented only if entries are re-read at serve time and ordered in the same stream.

**The two questions the brief for this review asked:**
- **Can a page subscription and the log disagree?** Yes, in each way above.
- **What does a device do with an entry for a row whose image never arrived?** The text does not say.

**Smallest change.** Adopt reading 2 and write it down:
- the unit of subscription is a partition span;
- a span stays subscribed while the device holds any row of it, so every update and every tombstone reaches every held row;
- a new span is acquired inside the stream, at a sequence position, with images read at serve time, as joins are;
- a refill (a row older than the span's acquisition) is served the same way, never outside the stream;
- the device computes entries, exits and reorders for the rows it holds, and the server's page state is only an index for refills, not a second delivery channel.

Then say plainly that public data reaches every device, as it did in #19, and restate §10's falsifier to match. If filtering by page closure is what is meant instead, the RFC must add:
- tracking on the server of the rows each device holds;
- updates as well as tombstones for held rows;
- a start sequence for each span;
- entries read at serve time and ordered in the stream;
- and a pre-registered size for that per-device registry.

### H1. High — §4.3 "Key". The sharing rule ignores shapes that depend on the viewer

§4.3 says: "Only a page whose rule is public may be shared across viewers."

**Scenario.** #19's `globalFeed` and `trending` read public rows. But their `postCard` shape computes `liked: exists likes[.id, viewer]` and `reposted: exists reposts[viewer, .id]` (`schema.q:105–107`, `insights.q:18–19`). Both queries are in every device's warm set. Shared under this rule, Bob's `global` page carries Alice's likes. In Clique that is wrong data. If the probed table were private (a `bookmarked` flag, say), it would be a disclosure.

**Smallest change.** Share a page only when no part of its plan reads `viewer` or the auth context: not the filter, the shape, a helper `fn` or a rule check. Otherwise the viewer is part of the key. Better still, share the rows and keep each viewer's shape values separate.

### H2. High — §4.3 "A page is everything it read", against §4.2's invariant 2. The device would hold rows its viewer may not read

§4.3 puts into the closure "the rows its shapes, helper functions and rule checks consulted", and says "that closure is what the device must hold". But rule probes read raw rows, whatever the probed table's read rule says: "Existence witnesses are raw data, never recursively authorized rows" (`engine/read.rs:120`).

**Scenario.** A shape field `blockedMe: exists blocks[blocker = .author, blocked = viewer]`, on a table only the blocker may read. The device would hold another principal's row, with every column in it. The log would never deliver that row, and invariant 2 forbids holding it. Clique's probes all land on rows the viewer can read, so a calibration will not catch this. Apps shaped like Workroom will.

**Smallest change.** Limit the closure a device holds to rows the viewer may read. Two options for probes into anything else:
- carry them as results (a boolean or a count), each with its own disclosure status;
- or make the page not evaluable on the device, so it reads `complete: false` offline.

The second is what Snapback 4 does today: a probe into data the device does not hold is marked unknown.

### H3. High — §5 `complete`. Revision 2 changes its meaning while saying the runtime facts are kept

**What `complete` means in Snapback 4.** On the device, `complete` is true when none of these hold (`engine/local.rs:46`):
- the meter or a word limit cut the read;
- the rule's verdict is not uniform;
- the page overflowed or lost its position;
- a timeline is pending;
- the read went past the horizon;
- presence is unknown.

`contract.ts:39` documents it as "false beyond a sync horizon or at an online-only site". A write the server has not confirmed shows as `pending: true` on its rows and in `Write`.

**What revision 2 adds.** Two more conditions: "no pending write touching it" and "its local result equals the server's". This model's round-1 review proposed both. They were a mistake:
- **Every optimistic write makes pages incomplete.** A like, reaction or send turns `home`, `trending`, the post page or the thread to `complete: false` until the server answers. Offline, M6.2's two queued messages keep the thread incomplete the whole time. #19 was charged for exactly this state: "completeness required explicit client handling", and platform finding 4 was an incomplete read mishandled. Revision 2 makes that state routine.
- **"Local equals server" has no protocol.** Comparing the two needs an identity for the server's result at a sequence the device can check against. Nothing defines one.
- **It breaks retained history.** Snapback 4 deliberately stops a retained row from spoiling the whole query's coverage (`engine/read.rs:412–413`), so Carol's inbox stays complete after she is removed from a group. Under revision 2, her retained membership row is in the local result but never in the server's, so her inbox reads incomplete forever.
- **It confounds the comparison.** The control does not get this change. So §9.2's claim that the only difference is derived residency is false, and the change biases the result toward reading (B).

**Smallest change.** Keep Snapback 4's definition. `complete` is about how much of the result is present: whether the horizon or closure is held, the query's class, and any cuts. Unconfirmed writes stay on rows and in the outbox; staleness stays in `fresh` and `since`. Add only one new reason for `false`: the closure is not held, or not current. If the author wants pending writes to affect `complete`, land that in the control too.

### H4. High — §4.5. The four rules are unsound in one place, too strict in two and silent in three, and the stated rate does not follow from them

**Is the proof sound?** Not as written.
- **Unsound: no audience condition.** Rule 2 accepts "a maintained page whose filter covers that range", but a page holds only the rows the viewer can see. Snapback 4 proves absence only when the key pins readability, meaning the key alone determines who may read the rows (`engine/rules.rs:29–43`, `engine/read_auth.rs:57–76`). #19's builder learned exactly this rule: "Offline reactions now predict inserts because their uniqueness and cap keys carry the membership scope" (`lane-diary.md:29`). Without the condition, a unique key whose range holds rows the viewer cannot read counts as proven free, and `not exists` over a private table counts as proven false. The round-1 Opus wording dropped this condition.
- **Too strict: minted ids.** Snapback 4 skips the primary-key proof for a freshly minted id (`engine/write.rs:62`, `engine/write_target.rs:96`). Rule 2 has no such exemption. Read literally, it stops every insert, because an id is a unique key no page covers. Even §3.1's `createPost … if absent` would never predict.
- **Too strict: ranges under a row created in the same body.** Rule 4 lets the body read a row it created. It does not say that ranges keyed by that row are empty apart from what the body inserts. Examples:
  - #19's `send` inserts receipts under `unique message, principal` and `cap 50 by message`, keyed by the new message (`chat.q:61–69, 182–187`);
  - `createPost` inserts a `feedEvents` row under a unique key that contains the new post;
  - `startDM` and `createGroup` insert members of a chat created in the same body.
- **Stricter than Snapback 4.** Rule 2 covers constraints in general. Snapback 4 checks a plain insert's constraints against the rows the device holds and lets the server refuse (`check_constraints`, `engine/write.rs:335`). That is exactly the "sound speculation … with possible server rejection" §4.5 promises. Snapback 4 requires proof only where a wrong guess changes which branch the mutation takes (`if absent`, upsert).
- **Silent: range reads in the body.** `for p in members where .chat = chat` and `count(…)` fall under no rule.
- **Silent: views and maintained aggregates.** Revision 1's rule "writes no `view` input the device cannot recompute" was deleted with no replacement. It is the only rule that explains why `follow` and `unfollow` queue.
- **Silent: offline.** "On a maintained page and current" means nothing while disconnected. Read literally, nothing predicts offline, and M6.2 fails.
- **The occupancy witness is unspecified.** "A maintained occupancy witness the engine delivers" is Lane P's unlanded idea again, with no specification and no disclosure rule. A count over rows the viewer cannot read is exactly the case `N_MAINTAINED_COLUMN_DISCLOSURE` exists for.

**Is the stated rate right for #19's program?** No. Assuming the minted-id exemption Snapback 4 has, here is what the rules give:

| Operation | What the rules give | What §4.5 states |
|---|---|---|
| `send` | Queues. The receipts' unique key and cap are keyed by the message created in the same body, and the loop over members is a body range read that no rule covers. | Predicts |
| `addMember` | Predicts. `roster(chat)` is a depth-step page with no row limit, and it covers both `unique chat, principal` and `cap 50 by chat` (`chat.q:129–130, 154–158`). | Queues |
| `setFollow` | Predicts from a profile screen. `socialProfile`'s closure holds `exists follows[viewer, p.principal]` (`schema.q:126`). | Queues |
| `react` | Predicts, but never on a message with `expiresAt` set (rule 3), so never in a chat with disappearing messages on. | Predicts |

"The depth step holds every inbox conversation's first page" is also wrong for the probe user. The inbox's first page is `last 50` memberships (`chat.q:121–122`), half of the 100 conversations in brief line 243.

**Smallest change:**
- **Define versioned coverage:** a page's coverage is valid as of the watermark the device has applied, online or offline.
- **Rule 2** requires the key to pin readability, or the table to be public.
- **Exempt** minted ids, and ranges under a row created in the same body.
- **Put range reads in the body under rule 2.**
- **Keep plain-insert constraints optimistic,** as Snapback 4 does. Require proof only where a wrong guess changes the branch taken (`if absent`, upsert, `require not exists`).
- **Restore the view-input rule.**
- **Specify the occupancy witness** with a disclosure rule, or delete it.
- **Pre-register the rate** as a table: each operation under cold start, warm, released and offline (M5).

### H5. High — §3.3 `per viewer`. Receipts derive correctly, but the modifier is the wrong tool on `members`, reading another member's mark has no form, and unread becomes a read-time scan

**Receipts:** yes, including recipients who leave (see "What is now sound"). The rest has four problems:
- **On `members`, `per viewer` makes a matrix nobody needs.** Each members row already belongs to one principal. `per viewer` stores one value per (row, viewer), but the receipt rule uses only the diagonal: the row principal's own value. That is a plain column plus a field-level write rule. #19 already has one (`readAt`, `chat.q:22, 205`). The committed target has one too (`readOrdinal`, `intent-clique.q:131`), and its digest job reads it per principal. What is missing is field-level write authority, so that an admin's `update` right does not cover another member's mark, plus a guide recipe. A new modifier is not needed. The round-1 Opus fix offered `members` and `conversations` as equivalent placements; they are not.
- **On `conversations`, there is no way to read another member's mark.** "Each viewer reads and writes their own value" contradicts "visible to the row's audience … the sender's tick reads other members' marks". No form names principal *p*'s mark, either in a query or in a job.
- **Unread is not "a view like any other":**
  - LLP 3000.013 §3.3 says "Any other view that mentions `viewer` is planned at read time" (`llp/3000.013-quarry-states-intent.rfc.md:267–268`). So unread becomes a range scan for each inbox row. Its cost grows with the number of unread messages, and it runs under the 8,192-row examined ceiling (`snapback4-core/src/meter.rs:23`).
  - #19's `unreadCounts` was a maintained view, with constant cost per lookup. The probe user's inbox (100 conversations, including the 10,000-message group) is where the scan will be cut.
  - On the device, where the depth step holds 50 messages per chat, a badge above 50 cannot be computed offline.
- **What "visible to the row's audience" discloses:** every member's read position, live, to every other member. If the write records wall-clock time when the chat is opened (as #19's `fetched` writes `readAt: now`), it also discloses when each member opens the chat. That is a presence signal the sender's aggregate does not need. It is no wider than #19's receipts table, which every member could read. But it is the product decision the RFC calls it, and the RFC should state it as one.

Two small gaps: the rule must exclude the sender, and §3.1's `members` lacks the `joinedAt` and `deliveredUpTo` columns the rule uses.

**Smallest change.**
- On `members`, replace `per viewer` with field-level write authority ("`readUpTo` is written only by `.principal`"), and make the value a monotonic message position rather than wall-clock time.
- Keep `per viewer` only for rows no single principal owns, and define how to read another principal's visible mark.
- Specify unread either as a count per (member, conversation) that the engine maintains (an engine addition, to be listed in §8), or as a read-time scan whose cost at the probe user is pre-registered.

### M1. Medium — §4.1. The depth step's scope, eviction, and `keep history`

**Scope.** Read literally for #19, the rule covers every query whose one non-cursor argument is a reference:
- `chat`, `roster`, `history` and `typingNow` for each inbox row;
- `postDetail` and `replies` for each post on screen;
- and, if arguments typed `principal` count as references (the text does not say), `userPosts` and `pair` for each author on screen.

That is 50 rows × 4, plus 50 posts × 2–4: about 300–400 pages kept up to date for every signed-in device, including the post list of every author on screen. §4.1's examples suggest something much narrower. The wording comes from the round-1 Opus review.

**Other problems:**
- **The budget has no number,** and there is no order for which depth pages are dropped first.
- **Page size and order now decide offline coverage, silently.** #19's inbox is ordered by the time the member joined, so the depth step covers the 50 most recently joined conversations, not the most active. Nothing in `check` tells the author.
- **Eviction "by age" is undefined:** the row's age, the time the page was released, or the last read? Offline, nothing counts as maintained, so depth rows can be evicted exactly when they are needed.
- **Eviction weakens `keep history`.** Retained rows sit on no maintained page, so age-based eviction eventually deletes a removed member's history. That is weaker than Snapback 4's `retain delivered-history`.
- **The depth step does not know what to do with retained rows.** It derives from the rows of warm pages:
  - if it reads Carol's retained membership row, it asks for `history(c)` again and is denied;
  - if it reads the server's inbox page instead, her retained history belongs to no page at all.
- **Denied pages with retained rows are undefined.** The text does not say what a subscription returns when the server now denies it but the device holds retained rows for it. Snapback 4 answers from those rows ("A left group's delivered rows remain a device answer", `snapback4-device/src/device/history.rs:1`). Answering `denied` fails M3.6 (brief line 523).

**Smallest change:**
- Limit the depth step to arguments that reference a table, one level deep, capped per warm page, with a stated drop order.
- Have `check` print the derived residency, for example: "offline: inbox first 50 by membership time → history first 50 each".
- Define what "age" means for eviction.
- Pin `keep history` rows against eviction and say the store will grow, or state the weaker meaning.
- Say that a denied page with retained rows returns them with `complete: false` and `fresh: false`.

### M2. Medium — §3.3 `through`. The cascade is a new referential action with no mechanics

LLP 3000.014 §8 left referential actions out of scope. Revision 2 brings one in as its lifetime rule, and leaves these open:
- **What triggers it:** an explicit delete, the expiry sweep, and `insert_attempt` replacing an expired row that has the same id (`engine/write.rs:74`).
- **How much work it may do:** deleting a Workroom project cascades without limit, against a limit of 1,024 rows written per request.
- **The window after expiry:** between logical expiry (instant) and the physical sweep, the children of an expired message stay readable. The brief requires refusal "from the moment of revocation/expiry".
- **Write-only children:** do reports filed against a post cascade when the post is deleted?
- **Changes after the copy:** a parent's read rule or defaults can change under existing copies ("schema interpretation at insert"). Both LLP 3000.014 reviews asked for such changes to be refused, or refilled atomically.

**Smallest change.**
- A child is live exactly when its parent incarnation is live, checked at read time, so expiry takes effect instantly.
- The physical cascade runs as background work under a stated meter.
- Write-only children do not cascade.
- Changes to how a parent is interpreted are refused while it has descendants, or refilled inside activation.

Alternatively, mark the lifetime rule provisional until LLP 3000.014 revision 2 exists.

### M3. Medium — §8. The hooks as written would change the control or carry the wrong data

**Can a dormant change feed land in Snapback 4 without changing the control?** Only as a compile-time feature that no control build enables. Three problems:
- **The feed would carry the wrong data.** It "carries the ranges and point reads each write touched". Matching needs what each commit changed: the table, the id, the new image or the deletion, and the index keys the row now occupies. That applies to base rows, aggregates, Following inbox copies, marks, cascades and sweeps. What a write read does not matter. The partition log cannot supply this: an update carries only the new image, and a delete is logged only when a row leaves a partition, never when it leaves a range inside one (`snapback4-core/src/partition.rs:146–147`).
- **"Dormant" is not free.** Capturing changes on every commit happens inside the engine lock that Lane L is making fair. And `snapback4-core` compiles into the device's wasm, which has a blocking 410,000-byte budget.
- **The "Snapback 5 only" hooks live in shared crates.** The page tags go into `snapback4-device`, which Snapback 5 uses as a crate, so they need a feature flag or a fork.

**Smallest change.**
- State what the feed contains.
- Define "dormant" as behind a cargo feature, with the control's published server and device builds byte-identical with and without it.
- Say which crate gets the device page tags, and under which flag.
- Say that Snapback 5's device must fit the inherited wasm budget with its extra code.

### L1. Low — Accuracy

- **§1.1 row 1** says evidence identity "does not recur: … the log's watermark is the only identity". But the page key (generation, plan hash, viewer, auth context, arguments, cursor) and "closure held and current" are evidence identity and coverage, which LLP 2000.000 §7.5 lists as dissolved. They come back, smaller. Say so.
- **§1.1's last row** cites §4.6. Following is §4.4.
- **§3.1 says the card contains everything the target uses.** The target also uses `use identity password`, `enum`, `default`, `unique handle else HANDLE_TAKEN '…'`, and `range`/`day` (`intent-clique.q:5, 16, 18, 108, 130`). #19 also uses `update (old, next) <-`, `created` as a rule term, control flow and `group`. §7's count will come out low.
- **§3.1's `members` cannot admit its first member.** Its insert rule requires an existing admin; #19's had `or created chats[.chat]`.
- **§4.1's "arguments … viewer-only":** queries do not take `viewer` as an argument. "Cursor-only" is presumably meant.
- **The default has flipped.** Without `sync`, every table with an invertible read rule can be held on devices. So a page over an audit table stores it on devices unless the author remembered `online only`. In Snapback 4, a table with no `sync` line was online-only. Print this fact per table in the default `check`; §4.2 half-says it.

## 3. Can §9 be held to?

**Can the bet still pass without being true?** Yes, in three ways:
- reading (A) is judged on one arm only, and can be relaxed after the results are in (H7);
- the delivery falsifier cannot be measured as written (M5);
- the category floors come from older runs, not from the control (M6).

It can also fail without being false (H7).

### H6. High — §9.2–9.3. There are instruments but no decision rule

An evaluator could still choose any of these after seeing the results:
- **The variance-transfer rule.** §9.2 names its inputs (a scorer standard deviation near 3; the spread of the last five wall clocks) but not the rule itself: the statistic, the direction, the threshold. The protocol requires that rule to be registered in advance for an ordering claim below N=8 (`benchmarks/protocol.md:181–186`). The bet's verdict is an ordering claim. The last five Snapback 4 clocks ran 77–115 minutes (standard deviation about 15), so three runs per arm can only detect a difference of about 25 minutes. Say what a smaller difference means.
- **Which clock decides,** when `firstGreenAt` and the time to last green disagree.
- **The correctness bar.** Correctness has a definition but no threshold: at or above the control? Within *k* assertions of it?
- **How the criteria combine.** In strict order of priority, or must every one pass? What counts as "the bet fails", which triggers "never ships"? What does the Opus 5.5 builder pair count for if it disagrees with Astra?
- **How floors are aggregated:** the mean of three runs, each run, or two of three.
- **The "load gate".** `protocol.md` defines no such gate. Give its threshold and what happens when it is exceeded.
- **The confound.** Besides residency, the treatment changes what `complete` means (H3), adds `useOutbox` (Snapback 4 has `usePendingWrite`), and changes the default `check` output. Land the client changes in both arms, or name them as part of the treatment.

**Smallest change.** One table giving, for each instrument, the statistic, its threshold relative to the control, and the verdict it produces. Then the rule that combines the verdicts. Then the variance-transfer rule, written out.

### H7. High — §9.1. Reading (A) is absolute and judged on one arm

Reading (A) requires that "no category's note charges runtime completeness, pending writes or gaps in offline data". But:
- **The control already draws that charge.** #19 drew it in three categories.
- **Revision 2 draws more of it.** It keeps the completeness class, prints it for every query in the default `check`, and makes runtime `complete: false` more common (H3).
- **#19's diary places its remaining cost in mechanisms revision 2 keeps** (`lane-diary.md:14, 17, 21, 29`):
  - "The cost was learning completeness notes";
  - "The tradeoff is learning the interpreter's proof of locally safe prediction" (the presence guard that `why chat.send` found);
  - unique and cap keys that carry the membership scope;
  - "the compiler's distinctions".

  None of that is residency spelling.

So:
- **The bet can fail without being false:** (A) is nearly unreachable whatever residency does.
- **It can pass without being true:** if "no charge" is relaxed to "fewer charges" after the results are in.
- **It cannot separate the causes:** classifying only Snapback 5's notes cannot tell residency's effect from the two additions both arms carry.

**Smallest change:**
- Classify both arms' notes, blind to which arm wrote them.
- Name the classifier's model family, and commit its prompt and rubric by hash before any lane runs.
- Pre-register which named items should disappear (sync, horizon, residency and eligibility vocabulary in the learning-cost phrases), and which are expected to stay (completeness, prediction proofs).
- State (A) as a margin between the two arms on those counts.
- Say why removing spelling that #19's note did not name should remove the charge that it did name.

### M5. Medium — §9.3 "Delivery load" and §10. The falsifiers cannot be measured as written

- **"Matching work above Snapback 4's"** either fires on any matching at all, since Snapback 4 does none, or compares different units. Pick one common unit: CPU per commit, rows examined, or bytes delivered.
- **"Each bounded against Snapback 4" has no ratio.** Cold start is "pre-registered against 12.6–15.0 s" with no threshold. Registry memory has no bound.
- **The rate of writes queued without a local image has nothing to be held against.** It is measured, but §4.5's prose expectation contradicts the rules (H4), and falsification runs through `writes_and_transactions`, which is a scorer category.
- **Starting from the audience does not help public writes.** Every device holds public pages through the warm set. Without an index from key ranges to pages, the matcher loops over every device on each public write. Name that index.

**Smallest change.** Thresholds as ratios to the control's values measured in the same run, one common unit of work, and H4's rate table with a stated tolerance.

### M6. Medium — §9.3 "Score floors". The floors come from older runs, not from the control

Which five runs make up "the median of Snapback 4's last five" (0.2.31 through 0.4.0)? How are they aggregated, and is the floor fixed before or after the control's own runs? Medians from older versions let Snapback 5 fall below its own control and still clear the floor.

**Smallest change.** Set the floors relative to the control's runs in this comparison, for example each category's mean at or above the control's mean minus one scorer standard deviation. List any historical runs used, now.

### M7. Medium — §9.3 "Clock". The definition mixes two instruments

"Protocol `firstGreenAt` on a frozen assertion-level intersection every lane attempts" mixes two things: the harness's milestone boundary (suite pass plus choreography pass, `protocol.md:121–124`), and a set of grader assertions. And "every lane attempts" is known only after the lanes run.

**Smallest change.** Both arms attempt everything, so the frozen set is the whole list. The time is the protocol's per-milestone `firstGreenAt` and the protocol's clock to the last passing evidence (`protocol.md`, "Timing"). Name which of the two decides.

### M8. Medium — §9.3 "Correctness". Four choices are still open

- **Native artifacts.** "Required for every lane or excluded for every lane": decide which, now.
- **Which assertion list:** #19's 101 assertions, or the reference packet's 119 (the 101 plus 18 M8 results)?
- **The holdout probes.** Who writes them, and when? They must be committed before the Snapback 5 implementation exists, by someone who is not implementing it. They should include delete-for-everyone on a released page (B1) and a denied page with retained rows (M1).
- **Publication.** Protocol rule 6 makes lanes run from a source checkout diagnostic-only. So "a number that never ships" still needs a pre-release publication path for the comparison.

**Criteria an evaluator can still move after seeing results:**
1. the variance-transfer statistic and threshold;
2. which clock decides;
3. the correctness bar;
4. whether native artifacts count;
5. 101 or 119 assertions;
6. the holdout probes' content and timing;
7. how floors are aggregated, and which runs set them;
8. what counts as reading (A): all runs, most runs, or fewer charges;
9. which classifier is used;
10. the delivery ratios and the unit of work;
11. the cold-start threshold;
12. the expected rate of writes queued without an image;
13. how the criteria combine;
14. the role of the second builder family.

## 4. What a competent implementer would build wrong

In the order they would hit them:
1. **The per-device stream (B1).** Filtering by page closure is the natural reading of §4.3, and it loses revocations that arrive as updates.
2. **Entries (B1).** Sent without images, or outside the stream, they resurrect deleted rows.
3. **Sharing (H1).** Shared `global` and `trending` pages give one viewer's `liked`/`reposted` values to everyone.
4. **The closure (H2).** Taken literally, it puts rows the viewer may not read onto the device.
5. **`complete` (H3).** It flips to false on every optimistic write, and "local equals server" gets improvised.
6. **Proofs (H4).** No audience condition, no minted-id exemption and no offline coverage: some predictions are wrong, and others never happen.
7. **`per viewer` on `members` (H5).** A matrix, plus an unread scan that the meter cuts.
8. **The depth step (M1).** Arguments typed `principal` produce hundreds of maintained pages per device.
9. **`keep history` (M1).** Eviction deletes a removed member's history, or the depth step keeps asking for it.
10. **The cascade (M2).** Run inside the deleting transaction, it hits the write limit. Run in the sweep, it leaves children readable after expiry.
11. **The change feed (M3).** Built from reads, and "dormant" code still in the control's builds.
12. **The matcher for public writes (M5).** A loop over every device.

## Verdict

**NOT READY.**

The direction is right, and most round-1 blockers are resolved in intent. What is left is specification, not a change of course:
- adopt partition spans as the unit of subscription and write down the delivery protocol (B1);
- fix the sharing and closure rules (H1, H2);
- restore Snapback 4's `complete` (H3);
- rewrite the proof rules and derive the expected rate from them (H4);
- restate `per viewer` as a column its owner writes, with a costed unread count (H5);
- write §9's decision rule, and classify both arms (H6, H7).

With those done, a third round should be short.


---

## Round 3 — revision 3 (`4619cf3fc2`), 2026-09-24

**Mode:** blind delta review, read-only, over a detached worktree at that commit; `claude -p --model claude-opus-5-5 --effort max`. **Brief:** `~/projects/snapback-sb5-reviews/round3.brief.md` (the round-2 brief with the commits and questions advanced one revision).

### Verbatim review

# LLP 4000 revision 3: delta design review, Claude Opus 5.5 (Anthropic), effort max

- **Date:** 2026-09-24. **Revision reviewed:** revision 3 (`4619cf3fc2`), read against revision 2 (`dbb10169b6`) and the three round-2 reviews. I did not see the other two round-3 reviews. Read-only; nothing was changed or committed.
- **What I checked it against:**
  - the engine: `snapback4-core` (`partition.rs`, and `engine/local.rs`, `read.rs`, `rules.rs`, `write.rs`, `write_target.rs`, `prediction.rs`, `presence.rs`, `mod.rs`), `meter.rs` and `assets.rs`;
  - the device: `snapback4-device` (`device.rs`, `device/boundary.rs`);
  - the server's sync endpoint (`snapback4/src/serve_sync.rs`), the guide cards (`guide/prediction.rs`, `guide/feeds.md`) and `contract.ts`;
  - the documents: LLP 3000 §6, LLP 3000.014 and both its reviews, LLP 2000.000 §7, `benchmarks/protocol.md`, `TREND.md`, the probe-category registry and the grader schema;
  - the record: calibration #19's lane logs, `host-load.jsonl` and Quarry source; the committed target `intent-clique.q`; the brief; `~/clique-ref-20260924` (its README and `GRADER_ASSERTIONS_101.txt`); and `~/clique-full-20260905/lanes/*/milestone-clocks.json`.
- **Wording:** this round's brief asks for "the sentence in revision 2" that resolves each finding. Round-2 findings are answered in revision 3, so I quote revision 3.
- **Disclosure:** this model wrote the round-1 and round-2 Opus reviews, in separate sessions. Revision 3 adopted several round-2 Opus fixes almost verbatim:
  - partition spans as the unit of subscription ("reading 2");
  - restoring the view-input rule;
  - pinning `keep history` rows against eviction;
  - cargo features with byte-identical control builds;
  - an engine-maintained unread count.

  Findings B1, H4, M1, M4 and M5 say where those recommendations were incomplete or wrong.

## Summary

Revision 3 fixes what round 2 found wrong with how the mechanism is built:
- there is one delivery channel;
- the device computes its own pages;
- refills are current images served inside the stream;
- released rows of current members keep receiving updates;
- `complete` is Snapback 4's again;
- the proof rules are sound;
- §9 finally has a decision rule.

The direction is settled.

It is not ready to commission, for four reasons:
- **One core step is unspecified.** §4.2 keeps "membership inserts bootstrap a group" in its list of what stays unchanged. But it removes both the horizon that bounded a bootstrap and the server matcher that produced entries. Nothing says what a join does now:
  - read one way, every joined group, and the cold-start snapshot, arrive whole;
  - read the other way, a new conversation never reaches the inbox, which still reports `complete: true` (B1).
- **Three new promises are not true of the text.**
  - The tombstone-only subscription cannot carry the delete-for-everyone it promises (H1).
  - Engine-derived `delivered` is not exact from start sequences, and its source is a feature the control has switched off (H2).
  - The ordinals it rests on are neither assigned by the server nor constrained (H3).
- **The prediction table contradicts the rules printed beside it.** The rules also quietly drop Snapback 4's effects-only presence exception. That exception is the only reason `send` queues, so dropping it is both a confound and an M6 regression (H4).
- **§9's rule turns a null result into a failure most of the time.** "Loss" has no margin, and the thirteen per-category floors are not corrected for multiple comparisons. The mechanism reading is a gate in §10 and not a gate in §9.3 (H5).

Every fix below is a paragraph or a table, not a change of course.

## What is now sound

- **One channel.**
  - There is no matcher and no change feed.
  - Entries, exits and reorders are computed on the device from rows arriving in the stream. "An exit drops a page tag and nothing else."
  - Refills are current images re-read when served, and "never for a dead id". That is the same normalization `partition::expand_joins` already applies: a `put` whose row is gone is served as a `del` (`partition.rs:855–858`). So a refill cannot bring a deleted row back.
  - Revision 2's resurrection race and its two disagreeing channels are gone.
- **Released rows of current members stay current.** "A device stays subscribed to a span while it holds any row of it." So update-shaped revocations reach released search pages. #19's delete-for-everyone is `update … tombstone: true` (`chat.q:249`).
- **`complete` is Snapback 4's.**
  - §5's list matches `engine/local.rs:46` term for term, plus one reason: the closure is not held or not current.
  - Pending writes stay off `complete`, staleness stays in `fresh`/`since`, and retained rows do not spoil coverage.
- **The closure never holds a raw row the viewer cannot read.** Shape values are never shared across viewers when the plan reads `viewer`.
- **The six proof rules never predict from uncovered state.**
  - Rule 2's audience condition is Snapback 4's (`rules.rs:28–43`).
  - The minted-id and created-row exemptions match `write.rs:60–69`.
  - `now` is never proven, versioned coverage is defined for offline, and the unlanded occupancy witness is gone.
  - Rule 4's optimism about plain-insert constraints is Snapback 4's own; server refusal catches it.
  - H4 is about the rules being too strict and about the table, not about soundness.
- **`per viewer` is withdrawn, and `written by` stands on its own.** The fallback ("the receipt table stays in the application") is a real exit.
- **`through` is honest.** It is provisional and out of any first slice. Liveness is checked at read time, which closes the window between expiry and the sweep. The cascade runs in the background under a meter. Its positions in a rule are restricted. Changes to how a parent is interpreted are refused or refilled inside activation.
- **Schema adoption is conservative in the right way.**
  - A page survives only if its plan hash is unchanged *and* no rule, default or helper in its closure changed.
  - Retained images are withdrawn or reauthorized.
  - Populated views are rebuilt behind the activation barrier.
- **Honesty about delivery.** Snapback 5 "does not claim to deliver less than Snapback 4; it claims to author less." The flipped default and the derived residency are printed by `check`.
- **§9's scaffolding.**
  - The bet is judged against the control, in interleaved serial runs.
  - Native artifacts are required, and a not-run counts as not passed.
  - Holdout probes are committed by hash, from a session that has not seen Snapback 5 code; the grader is calibrated.
  - Both arms are classified by a third model family against a hashed rubric.
  - Lanes run from pre-release packages.
  - The first slice stops for the author before any comparison is run.
- **§1 and §11 corrections check out.** Supabase's M7 is recorded as not run. The reference packet's README now says the incumbents attempt the offline milestones.

## 1. Round-2 dispositions, row by row

**Real** means the text resolves the finding. **Partial** means some of it is resolved. **Asserted** means the table claims it but the text does not do it.

| # | Round-2 finding (as §12 lists it) | Verdict | Resolving sentence, or the gap |
|---|---|---|---|
| 1 | An entry is not an image; a matcher can resurrect a row; two channels; the 21st message predates the watermark | **Partial** | Resolved by "Entries never carry images of their own", by a refill being "a new `put` of the current image inside the stream … never for a dead id", and by "the device computes its pages". Gap: an entry whose row lies in a partition the device does not follow yet (a new conversation) has no delivery path once the matcher is gone. §4.2 still says joins "bootstrap a group", with no horizon to bound them (B1). A "span" is a range of sequence numbers, but coverage and `delivered` need key floors (M2, H2). The round-2 Opus "reading 2", which revision 3 adopted, had the same hole. |
| 2 | Delete-for-everyone never reaches released pages | **Real** | "A device stays subscribed to a span while it holds any row of it, so every later update and tombstone for a held row arrives in the one stream, whether the page that brought the row is maintained, released, or gone." |
| 3 | Later deletions do not reach a former member who retains history | **Asserted** | "stays subscribed to **tombstones only** (deletes, expiry, view-once) … so Alice's later delete-for-everyone reaches Bob's retained copy" contradicts the bullet just above it: "Delete-for-everyone in #19 is an update". The subscription carries nothing the brief tests, and it leaks later departures (H1). |
| 4 | Sharing by "public rule" leaks shape values that depend on the viewer | **Real** | "its **shape values** may be shared only when no part of the plan … reads `viewer`". Mostly moot, since the server now keeps no page results (L3). |
| 5 | "Everything it read" puts unreadable rows on the device | **Partial** | "The device never holds a raw row its viewer may not read" resolves the disclosure. The other option, "carried as a **result** … with its own disclosure status", has no way to be kept current in a one-channel design (M3). |
| 6 | `complete` redefined | **Real** | §5, word for word; checked against `engine/local.rs:46`. The released-page rule sits in §4.1 and §8, not in §5's list, and what happens when a released page is reopened is unstated (M2). |
| 7 | The proof rules are incomplete, and the rate contradicts them | **Partial** | Rules 1–5 and versioned coverage are real. But rule 6 is broader than Snapback 4's actual rule, the effects-only presence exception is dropped, the `setFollow` row contradicts rule 6, and the table is scored on a program that does not exist. "The rate contradicts the rules" is still true (H4). |
| 8 | `per viewer` is the wrong tool on `members`; the tick; the tail fetch; `deliveredUpTo` | **Partial** | Real: `per viewer` withdrawn; `written by .principal`; the sender excluded; leavers drop out; a rejoin is a new row; unread is no longer a scan; the fallback stated. Open: `delivered` is not exact from start sequences, and the control cannot carry it (H2). Ordinals are supplied by the client, and the "join ordinal" column does not exist (H3). Unread is an unspecified aggregate that counts tombstoned messages (M5). |
| 9 | Depth step unbounded; conflicts with eviction and `keep history`; 100 conversations against a 50-row inbox; denied pages with retained rows | **Mostly real** | Real: table-reference arguments only; one level; a numeric budget; declaration-order priority; eviction by time since last read, suspended offline; retained rows returned for a denied page; `check` prints it all. Open: what "capped per warm page at the page's own size" caps; arguments typed `id` silently get no depth step; what "keep history rows are pinned" covers, and how pinned rows count against the budget (M4). |
| 10 | Cascade mechanics; `not through`; revision 2 does not exist | **Real, as a provisional position** | "A child is live exactly when its parent incarnation is live, checked at read time"; the background cascade runs under a meter; write-only children are exempt; positions are restricted; the rule is marked provisional. Where a deleted parent id's incarnation counter is stored is rightly left to LLP 3000.014 revision 2. |
| 11 | The change feed carries the wrong data and sits on the commit path; tags in shared crates; wasm budget | **Partial** | "There is no change feed and no matcher", and the features are real. "Byte-identical with every feature off" names no baseline and is brittle for inline hooks. The `delivered` addition the control must carry comes from feature `spans`, which the control has off (M1, H2). |
| 12 | §9 has instruments but no decision rule | **Partial** | The combination rule and the transfer rule are real. But "loss" has no margin; the floors are uncorrected across 13 categories; the load gate would have discarded #19 itself and counts the lane's own processes; and "N = 8 or a stop" conflicts with the stopping rule (H5). |
| 13 | Reading (A) is absolute and judged on one arm | **Real**, in construction | Both arms are classified, by a third family, against a hashed rubric, with items expected to disappear and items expected to stay, and intended consequences are not automatic failures. New: "run for run" names no pairing, and §10 ("reading B, the bet is over") contradicts §9.3 ("interpretation, not a gate") (H5). |
| 14 | The delivery falsifiers cannot be measured | **Partial** | One unit and fixed ratios are real. The new per-device server state is not measured: revision 2's "registry memory" was dropped. "CPU-ms per commit" misses work done per stream request. The queueing gate has no population (M6, H4). |
| 15 | Floors come from older runs | **Real** | The floors are now relative to the control. See H5 on multiple comparisons. |
| 16 | Accuracy: Supabase's M7; §3.1's omissions; admitting the first member; "viewer-only"; §1.1 | **Real** | §1 now says "M1–M6 and M8 green, M7 not run". §3.1 adds `merge`, `use identity`, `enum`, `default`, `unique … else`, control flow and the builtins. `members` admits its first member through `created conversations[…]`. §4.1 says "only arguments are a cursor". Nit: §3.1's `members` has no `update` rule, so `promote` cannot be written. |
| 17 | The default flips | **Real** | "A default that flips, printed." |
| 18 | §11 misstates the round-1 consensus | **Real** | §11 now records the differing recommendations. |
| 19 | The reference packet's README | **Real** | It now reads "the incumbents do attempt the offline milestones". |

Round-2 findings the table leaves out:
- **Resolved but not listed.**
  - Astra 9 (survival across schema changes, and withdrawal): resolved by "no rule, default or helper … depends on changed" and "withdraws or reauthorizes retained images".
  - Grok's three: the background view rebuild, logical expiry at catch-up, and the trust rule restated without `sync`. Resolved in §4.3 and §4.2.
- **Still open.**
  - How capped or aborted runs enter the clock (Astra).
  - Whether M7 runs (Astra). The 119-assertion list carries nine M7 assertions, and the reference packet does not run M7.
  - Which model and version produce the holistic score (Astra).

## 2. New defects in revision 3

**Short answers to the questions this round asked:**
- **Is one channel sufficient?**
  - Yes, for rows in partitions the device already follows: updates, deletes, entries, exits, reorders and refills all arrive in one stream, in sequence order.
  - No, for new partitions (B1) and for values carried for probes the viewer cannot read (M3).
  - Presence stays a separate ephemeral channel, which is why `send` queues (H4).
- **Is the refill rule sound?**
  - Yes. A current image re-read when served cannot bring back a deleted row.
  - Not specified: how the device asks for a refill, and that a refill extends the key floor (M2).
  - "Before the entry that tags it" is left over from revision 2.
- **Does the tombstone-only subscription work in the existing stream?** It can be added mechanically, but it does not do what §4.2 claims, and it leaks (H1).
- **What does the per-device span index cost?** New per-device identity and server state where there is none today, and a write on every poll. None of it is measured by §9.3 (H2, M6).
- **The depth policy's cost** is bounded by §4.1.1's budget. What it caps and what it pins are ambiguous (M4).
- **The proof** is sound; the stated rate is not derived from it (H4).
- **`delivered`** is not exact, not costed, and cannot be carried by the control (H2). The recipient rule is right in intent but rests on ordinals (H3).
- **The §8 hooks:** byte identity is either vacuous or unachievable (M1).
- **§5** is sound.
- **§9** can fail without being false, and can pass without being true (H5).

### B1. Blocker — §4.2 (the first paragraph against "What changes"), §4.1, §4.3. A join has no defined behavior, so entries in partitions the device does not follow cannot reach it

**What the text says.**
- §4.2 keeps the log "exactly as it is", including "membership inserts bootstrap a group".
- It then says what changes: "In Snapback 4 a device acquires a group's span from the authored horizon. In Snapback 5 a device acquires the spans its pages read."
- §4.3 adds that "the stream delivers by partition as today" and that there is no matcher.

**What the engine does.**
- A join is logged in the principal's own partition and is "never streamed: the stream expands it to the group's rows" (`partition.rs:69–71`).
- The expansion picks rows by the horizon (`partition.rs:886–899`). With no horizon it picks every row (`remaining = usize::MAX`, `:538`).
- A device with no watermark takes a snapshot of every group and every public table its principal holds (`snapshot_page`, `:435`).
- A membership row lives in its group's partition. In #19 that is `members … sync to members[.chat]` (`chat.q:31`); §3.1's read rule inverts the same way.

**Two readings, both broken.**
1. **Bootstrap unchanged.**
   - Joining the busy group delivers all 10,000 messages.
   - A cold start delivers every group whole, plus the whole public corpus: #19's replica without even its `last 10000` horizon.
   - The warm set, the depth step and the 50,000-row budget then describe nothing.
2. **Bootstrap replaced by page acquisition.** Alice creates a group `g` with Bob.
   - The only signal is the join in `p:Bob`, and joins are not streamed.
   - Bob's new membership row sits in `g:members:[g]`, a partition his device does not follow.
   - Bob's inbox (`members where .principal = viewer last 50`), computed on the device, never gains `g`. It still reports `complete: true`, because every row in its closure is held and current.
   - No depth-step span for `g` is ever acquired, so Alice's messages never reach Bob's device.
   - M3 acceptance 1–2 and live delivery fail, silently.
   - Revision 2's server matcher would have produced this entry. Revision 3 removed it without a replacement.

**Smallest change.** Define a join for Snapback 5:
- the stream delivers, at the join's position, the principal's own membership row and the group's parent row, and nothing else;
- a page whose range is keyed by the viewer's memberships (the inbox) treats a joined group it has not acquired as "closure not held" until the depth step acquires that group's first pages as spans;
- a scope event removes the group from that set;
- the cold-start snapshot is replaced by acquiring the warm set and the depth step.

Delete "membership inserts bootstrap a group" from §4.2's list of what stays unchanged. The invariant in H6 is what would have caught this.

### H1. High — §4.2 "Revocation after membership loss" and §8. The tombstone-only subscription delivers nothing the brief tests, contradicts itself, and leaks what happened after removal

- **It cannot carry its own example.** Delete-for-everyone is an update in three places:
  - in #19 (`chat.q:249`);
  - in the committed target (`tombstone: bool`);
  - in any app that meets the brief's field manifest, which requires a surviving message object with a "tombstone flag" (`social-messenger.md:645`).

  An update is a `put`, and a tombstone-only span filters puts out. So "Alice's later delete-for-everyone reaches Bob's retained copy" is false for the very program the RFC cites. The bullet above it says as much.
- **Its other two payloads are not log events.**
  - View-once consumption is recorded per principal in `_asset_views` (`assets.rs:439–583`), not in the log.
  - Expiry of a retained message is already applied on the device, from the `expiresAt` the device holds.
- **It leaks.** A span that continues after removal delivers every `del` in the group's partition.
  - Carol is removed. Because §3.1 keeps `members` under `keep history`, her retained roster (from the depth step's `roster(c)`) stays on her device.
  - A week later Dave leaves, and his member row's `del` reaches Carol.
  - So Carol learns the group's later departures, and the ids and timing of messages created and deleted after she left. The membership-interval rule (`partition.rs:654–718`) exists to withhold exactly that.
  - The other reading, "tombstones only for rows the device retains", needs a server-side set of every row every device holds.
- **It costs forever.** It adds a permanent span per pair of principal and group left. With no index by event kind, each stream request scans the group's whole post-removal traffic to find the deletes.
- **The brief does not ask for it.** Its revocation ruling applies "after the client has synced the revocation", and Snapback 4 does not deliver post-removal revocations either.

**Smallest change.** Either:
- withdraw the promise and the mechanism, and state that retained history is frozen at removal (§8 loses a hook); or
- if the author wants post-removal revocation, add a declared revoking column (for example `revoke when .tombstone`). Its transitions are delivered only for ids put before the scope event. Count it in §7.

### H2. High — §3.3 "`delivered` is an engine fact", §4.3, §8. Not exact as specified, not free, and not something the control can carry

- **(a) It is not exact.**
  - Scenario: Bob signs in on a new phone at sequence 5,000. The depth step acquires the newest 50 messages of `history(c)`; their puts were logged at sequences 4,100–4,990. The index records "a span of `g:messages:[c]` starting at 5,000", and the phone acknowledges 5,010.
  - By the stated rule ("acquired the span containing it and acknowledged past its sequence"), none of the 50 messages is delivered, although the phone holds all of them.
  - Starting the span at the oldest acquired put (4,100) instead fails the other way. An older message edited at 4,500 counts as delivered, though the phone never fetched it.
  - Exactness needs three things:
    - the key floor of each acquisition and refill, which Snapback 4's acquisition marker already carries (`wire::Acquisition.floor`, `device/boundary.rs`);
    - each message's *insert* sequence, since the aggregate re-logs the message on every increment;
    - a union of intervals per principal, across devices, re-acquisitions and gaps.
- **(b) "The engine already knows which rows it has delivered to which device" is false.**
  - The sync endpoint takes `{generation, from, limit, after, stream, pending, store_id}` plus a principal, with no device identity (`serve_sync.rs:44–47`).
  - It serves the stream from a read-only `reader()` (`:58`, `:86`).
  - Its only acknowledgement is the outbox lookup in `_ops` (`engine/mod.rs:812–824`).
  - `delivered` turns every poll by every device into a write: the watermark, span records, and aggregate updates.
- **(c) §8's cost line undercounts.** "One aggregate update per recipient device acknowledgement and per mark write" is off by the number of messages each one covers.
  - One acknowledgement covering a 50-message acquisition updates 50 aggregates.
  - A read mark moving from 0 to 10,000 in the busy group updates 10,000. That is ten times the 1,024-row write ceiling (`meter.rs:23`), and maintained work is charged to the writer (`write_target.rs:321`). It is the very failure `per viewer` was withdrawn to avoid.
  - A departure changes `recipients`, and both counts, for every message the leaver was a recipient of.
  - If the aggregates are columns on `messages`, each change re-sends a message image of up to 2 KB to every member device, where #19 re-sent a small receipt row.
- **(d) The control cannot carry it.** §8 puts the source, "the per-device span index … the source of `delivered`", behind feature `spans`, and the control's builds have every feature off.
  - Either the control keeps the receipt table, and the arms then differ in exactly the `data_modeling` charge §3.3 moved into the control to neutralize;
  - or the control enables `spans`, and is no longer the control.

**Smallest change.** Take the RFC's own fallback now:
- the receipt table (or #19's `fetched`) stays in both arms' programs;
- `written by` and a maintained unread count stay as the addition;
- engine-derived delivery becomes its own LLP, with key-floor acquisition records, per-principal delivered intervals, an insert-sequence rule and a costed write path.

### H3. High — §3.1 and §3.3. The ordinals that receipts, unread counts and the read mark rest on are neither assigned by the server nor constrained

§3.3 says "Ties … broken by the message's `ordinal` against the member's join ordinal, both server-assigned". But:
- `messages.ordinal: int` has no default, and §3.1's card has no form that assigns it;
- #19 has no ordinal at all (it orders by `.at`), and the committed target's `ordinal: int` is supplied by the writer;
- `members` in §3.1 has no join-ordinal column;
- the insert rule `insert <- .senderId = viewer and through .conversationId` places no constraint on `ordinal`.

**Scenario.** Mallory, a member, sends a message with `ordinal: 9007199254740991`.
- The first member who marks the conversation read clamps `readUpTo` to "the conversation's latest", which is Mallory's number. Every later real message has a smaller ordinal and is never unread for that member again.
- Under the target's `last 50 by .ordinal`, Mallory's message sits at the top of the history for good.
- A message given an ordinal below a member's join point removes that member from its recipient set.

Separately, comparing `joinedAt ≤ at` on the server's wall clock is not a total order across transactions.

**Smallest change.**
- Add an engine-assigned sequence per parent (for example `ordinal: sequence by conversationId`, counted in §7). It is assigned at commit; a prediction carries a provisional value.
- Define a member's join ordinal as the parent's sequence value when the membership commits.
- Define recipients, unread counts and the clamp on those two values only.

### H4. High — §4.5 rule 6, the pre-registered table, and §9.2's "Nothing else differs". The table contradicts the rules, and the rules drop a Snapback 4 exception without naming it

- **(a) The `setFollow` row contradicts rule 6.**
  - The row says "predicts from a profile page … (rule 6 does not block the edge write)".
  - Rule 6 says "it is why `follow` and `unfollow` queue when the inbox is materialized", and §10 says `follow` queues.
  - The row is right only for #19's program, which has no engine Following. Its stated reason, "the inbox copy is engine work", describes the target's materialized `following`. For that program rule 6, `engine/local.rs:83` ("timeline follow/unfollow/refollow requires online-only slot accounting") and `guide/feeds.md:412` ("Follow and unfollow always queue") all say it queues.
- **(b) Rule 6 is broader than Snapback 4's rule.**
  - Snapback 4 blocks only Following's edge writes. An `online only` aggregate stops the mutations that *read* it, not the mutations that write its inputs. The guide's `post` example still predicts while its count view is `online only` (`guide/prediction.rs:97–107`, `:155–157`).
  - Read literally ("an input of a view the device cannot recompute"), rule 6 stops two operations the table says predict:
    - the target's `createPost`, which feeds `replyCount`, `originalPosts`, `dailyPosts` and `following`;
    - `setLike`, which feeds `receivedLikes` and `dailyLikes`.
  - The round-2 Opus review asked for revision 1's broad wording. That was a mistake.
- **(c) Snapback 4's effects-only presence exception is gone.**
  - Snapback 4 keeps a mutation eligible when presence decides only whether an effect is emitted (`presence.rs:56`, `connected_effects_only`; guide: "`notifyPost` stays eligible: the server decides the effects at commit").
  - #19's `send` predicts through it. Its lane log records "presence now decides only emit".
  - The depth step holds `roster(c)`, so rule 2 covers the members range for every conversation it reaches. The only unproven read left is `connected[p]`.
  - So `send` queues only because the exception was dropped. That has nothing to do with residency, and §9.2 does not name it as part of the treatment.
  - The consequence: messages sent offline exist only in the outbox, so the treatment's builder must render outbox rows inside the thread to meet M6.2. That is more to learn, which biases reading (A) against reading (B).
- **(d) The table is scored on a program that does not exist.**
  - #19 has no `markRead`, no `createDm` and no engine Following. The target has no `send`. Each builder's program differs from run to run.
  - `markRead` "predicts" only for conversations on the inbox's first page.
  - The ±10-point gate compares a measured percentage with binary per-state cells, and names no mix of states.
  - It would be measured during a delivery load whose writes come from the headless replay adapter, which never predicts at all.

**Smallest change.**
- Restore Snapback 4's two rules verbatim: the timeline-edge rule and the effects-only presence exception.
- State that §4.5 matches Snapback 4 wherever residency does not force a difference, and name any remaining difference as part of the treatment in §9.2.
- Compute the table mechanically from a pinned program committed by hash (the target plus the additions).
- Measure the rate on a scripted device workload with a fixed mix of cold, warm, released and offline states.

### H5. High — §9.3–9.5 and §10. The decision rule fails a null result most of the time, and the mechanism is a gate in one section and not in another

**It can fail without being false.**
- **"Loss" has no margin.** A loss is a treatment median at or above the control's; a win needs 25 minutes.
  - With the stated per-run standard deviation of about 15 minutes, the difference of two three-run medians varies by about 14 minutes.
  - With no true effect, the result is "loss" about half the time.
  - A treatment that is truly 10 minutes faster still comes out a loss about a quarter of the time.
  - A "fail" verdict rules out the N = 8 follow-up that "not distinguished" allows.
- **Thirteen floors, with no correction for multiple comparisons.**
  - Each category must stay within the control's mean minus 3.
  - The series moves about ±3 between runs with no change in the surface (`TREND.md`). It moves more in `queries_and_live` (74–91), `setup_and_docs` (78–96), `scale_and_limits` (65–91) and `diagnostics_dev_loop` (78–95).
  - On noise alone, each floor trips roughly one time in ten to one in four, and any single trip fails the bet. It counts as caused by the treatment, because the control always passes a floor defined relative to itself.
  - So a treatment identical to its control trips at least one floor often, and most of the time if categories move independently.
  - `TREND.md` itself says that testing 13 categories at once needs |t| > 3.5.
- **The load gate selects on the lane.** It reads whole-host load.
  - Calibration #19, the instrument run and one of the transfer rule's five data points, had 4 of its 155 one-minute samples above 36, peaking at 70.8. The gate would have discarded it.
  - The gate also counts the lane's own native builds and replays, which are now required. So "discarded … and rerun" can select on what the lane itself did.
- **Costs unrelated to residency land on the treatment:** the `send` regression and the `delivered` asymmetry (H4c, H2d).

**It can pass without being true.**
- **Three answers on reading (B).** §9.3 makes the mechanism "interpretation, not a gate", so a clock win with reading (B) passes. §10 says "If that is not where the charge lives (reading B), the bet is over". §9.1 calls it a failed prediction.
- **The clock can be won by doing less.**
  - Under the treatment's rules, the builder cannot spend #19's `why chat.send` correction loop.
  - The product loses predicted offline sends, but M6.2 can still be met through the outbox, and `offline_sync`'s −3 tolerance absorbs the rest.

**Smallest change.**
- Define a loss as the treatment median ≥ the control median + 25 minutes.
- Make the floors a non-inferiority test on the holistic score plus a named subset (`queries_and_live`, `offline_sync`, `client_integration`, `writes_and_transactions`), with margins sized to each category's run-to-run spread and a stated correction for multiple comparisons.
- Gate on load from outside the lane's own processes.
- Say in one place whether reading (B) ends the bet.
- Remove H4's confound, so that the clock compares residency rather than prediction policy.

### H6. High — §8, "The simulator's invariants apply unchanged". Nothing checks that a device page is right

- **Invariant 7 cannot apply unchanged.** LLP 3000 §6 invariant 7 ("After faults stop, every client converges") was written for a device that holds its whole partition. Under derived residency the device holds a subset by design, so either it never converges or "converges" quietly means something weaker.
- **The added page invariant checks conditions, not answers.** "A page reports `complete: true` only under §5's conditions" is satisfied by a page that is wrong in each of these ways:
  - B1's missing conversation;
  - a released page reopened over rows that eviction removed (M2);
  - a carried result that has gone stale (M3).
- **Nothing compares a device page with the server's answer.** None of invariants 1–7 does.

**Smallest change.** Add a differential invariant: at quiescence and at random points, every maintained page reporting `complete: true` equals the server's evaluation of the same key (generation, plan, viewer, arguments, cursor) at the device's applied watermark. Restate invariant 7 as convergence of pages.

### M1. Medium — §8 and §10. Byte identity is either vacuous or unachievable, and it is not the property that matters

- **The baseline is not stated.** Compared with the same source built with features off, the test is trivially true.
- **Against a build without the hooks, it fails.**
  - Rust embeds the file, line and column of every `unwrap`, `expect` and `panic!` site (`core::panic::Location`).
  - An inline `#[cfg(feature = "spans")]` block in `partition::stream`, where §8 puts two hooks, shifts every later site. The binary changes even with the feature off.
- **Feature unification can switch the hooks on.** Cargo's resolver 2 unifies features across the packages built in one invocation. If the control is built together with `snapback5`, which enables `spans` and `pages`, the control silently compiles with the hooks.
- **It does not cover the additions both arms must share,** and one of them depends on `spans` (H2d).

**Smallest change.**
- Hooks live only in feature-gated modules, with call sites that add no lines to shared files.
- The control is built from a build graph that excludes `snapback5`, and its resolved feature set is asserted.
- The gate is behavioral equivalence: the invariant suite plus a recorded replay produce identical stream bytes and identical store hashes with features off. Byte identity becomes a best-effort report.

### M2. Medium — §4.2–4.3. A span with a start sequence is not coverage, and spans requested by the device need an authorization rule

- **Coverage.** Snapback 4's device knows what it holds by one key floor per table, horizon index and group, and it drops puts below that floor (`device/boundary.rs:97–107`). Revision 3's span records only a start sequence.
  - A page computed on the device needs key-range coverage per table, index and prefix.
  - Refills must extend that coverage and eviction must shrink it. Otherwise a released page reopened after partial eviction evaluates as complete over holes.
- **Reopening a released page.** The text does not say whether a reopened released page is re-acquired or is maintained straight away.
- **Authorization.** Today's stream reads group spans only inside membership intervals derived from the principal's joins and scopes (`partition.rs:730–739`). Once spans are requested by the device, "invariant 2 applies unchanged, because the channel is unchanged" no longer follows.

**Smallest change.**
- Define coverage records as key ranges with floors, as Snapback 4's `Acquisition` already does.
- Say that a released page is re-acquired when it is reopened.
- State that a requested span is intersected with the principal's authorization intervals when served, and that a request for a group the principal does not hold is refused like a denied page.

### M3. Medium — §4.3, "carried as a result … with its own disclosure status". Nothing keeps it current

- **Scenario.** A shape field `blockedMe: exists blocks[…]` reads a table only the blocker may read.
  - Its rows live in a partition the viewer can never follow, and there is no matcher.
  - When the blocker unblocks, nothing reaches the device, and the page still reports `complete: true`.
- **Smallest change.** Keep only the second option in §4.3: such pages cannot be evaluated on the device, read `complete: false` offline, and get the value from the server online.

### M4. Medium — §4.1 and §4.1.1. Three ambiguities an implementer must guess at

- **"Capped per warm page at the page's own size" has three readings:**
  - the number of depth pages derived from one warm page;
  - the number of depth pages per warm page per query;
  - the number of rows in each depth page.

  #19's inbox has four qualifying queries per row (`chat`, `roster`, `history`, `typingNow`). Under the first reading, 50 depth pages cover at most a quarter of the inbox's `history(c)` pages, and none at all if priority follows declaration order across queries.
- **The trigger is a typing detail.**
  - The committed target types `history(conversationId: id, …)` and `members.conversationId: id` (`intent-clique.q:127–153`), so its depth step is empty.
  - A builder who writes `id` instead of a table reference loses offline history without warning.
- **"`keep history` rows are pinned" has two readings.**
  - If it means every row of a `keep history` table (`messages` in §3.1), the store grows with all traffic of every conversation the device follows. It passes the 50,000-row budget, and pinned rows cannot be evicted to make room.
  - If it means only rows retained after removal, Carol's retained history is whatever survived eviction, often just the depth step's 50 messages. That is not "as it is in Snapback 4", which retains the whole delivered horizon (`last 10000`).

**Smallest change.**
- Specify "at most one first page per qualifying query per row of a warm page", with an explicit drop order.
- Have `check` warn when an `id` argument's values are always another table's ids.
- Pin only rows retained after membership loss, count them outside the budget, and say that retained history is what was held at removal.

### M5. Medium — §3.3 and §8. Unread is a new kind of aggregate with no way to declare it, and it counts deleted messages

- **It cannot be declared.** "An engine-maintained count per membership: messages … with ordinal greater than the member's `readUpTo`" depends on a column of another row. No `view` form in §3.1 can declare that, so the engine would have to recognize Clique.
- **It counts content the brief excludes.** As defined, it counts tombstoned messages, and expired ones until the sweep. #19's `unreadCounts` excluded them (`.visible`), and the brief's digest probe (`tb-digest-authorization`) fails any count that includes "expired/tombstoned content".
- **The clamp needs another aggregate.** "Clamped to the conversation's latest" needs a maintained maximum that nothing declares.

**Smallest change.**
- Declare unread as a maintained view with an explicit filter; add the form to §3.1 and count it in §7.
- Make the clamp and monotonicity a rule (`update (old, next) <- …`) over a declared maximum.

### M6. Medium — §9.3, "Delivery load". The new server state and the work done per request are not measured

- **The new state goes unmeasured.** Revision 2 measured "registry memory". Revision 3 adds real per-device server state (spans, watermarks, `delivered` bookkeeping) and measures none of it.
- **The unit misses the new work.** "Server CPU-ms per commit" measures work on the commit path, but revision 3's new work happens per stream request.

**Smallest change.** Add server index bytes per connected device, and total server CPU per minute across all paths, each with a threshold against the control.

### L1. Low — §9.5's holdout probes and §10's "audit-shaped table". Three mandated probes cannot run against a Clique app

- **Two need tables the brief never asks for.**
  - "A removed member's history under both leave policies" needs a table with the default until-revoked policy, which Clique does not have.
  - So does §10's "audit-shaped table".
- **One is outside the published categories.** "Completeness over a range full of hidden rows" fits none of the seven trust-boundary categories in `probes/categories.md`.
- **Either way the verdict moves.** Scored as not passed, these probes make the bet unable to pass. Scored any other way, the scoring is chosen after the fact.

**Smallest change.** Move these checks into the first slice's simulator suite against a fixed program, and keep lane probes inside the published categories.

### L2. Low — §7. The concept count leaves out what derived residency adds

- **What it leaves out:**
  - the warm set;
  - the depth step, with its trigger on reference-typed arguments;
  - eviction and pinning;
  - per-table device admission;
  - the outbox.

  `check` prints these because the builder has to act on them. Yet the count scores Snapback 4's authored spelling of the same facts and not their derived replacement.
- **Smallest change:** one point for each concept `check` prints that the builder can change.

### L3. Low — Vestigial or inaccurate text

- **The time-boundary index.** §4.3's index is state per device page held on the server, but the server no longer has the pages. The device can compute its own boundaries.
- **"Before the entry that tags it"** assumes entries are sent. They are computed on the device.
- **The cross-viewer sharing rule** has nothing left to govern, since the server keeps no page results.
- **"The sync image"** (§3.3) names something revision 3 deletes.
- **"View-once consumption are tombstones"** (§4.2) is wrong. View-once is recorded in `_asset_views`, not in the log.

## 3. Can §9 be held to?

The table in §9.5 fixes most of what round 2 named. An evaluator can still move these after seeing results:

1. **The delivery load.** Whether it is inside the primary clock ("including the scale replay and the delivery load"). It is not in the brief, §6 says the brief does not change, and the builder does not run it.
2. **Capped or aborted runs.** How they enter the median. `firstGreenAt` is null for caps and aborts (`protocol.md:121`), and a "last passing evidence" may not exist.
3. **M7.** Whether M7 runs. `GRADER_ASSERTIONS_101.txt` includes nine M7 assertions, and the reference packet does not run M7.
4. **The 18 M8 assertions.** They are "results beside" the frozen 101, with no list of ids and no hash.
5. **The "run for run" pairing** in reading (A).
6. **Reading (B).** Whether it ends the bet: §9.1, §9.3 and §10 give three answers.
7. **"N = 8 or a stop".** Who decides, and whether the first three runs count toward the eight. The latter would contradict "no run is added … after seeing results".
8. **The queueing gate.** Its program, its mix of states and its client population (H4d).
9. **The delivery load's program.** Which program the delivery load runs: the builder's, which differs every run, or a pinned reference.
10. **"CPU-ms per commit".** Whether it covers only the commit path, or all server CPU divided by commits (M6).
11. **Holdout probes a Clique app cannot exercise.** How they are scored (L1).
12. **The load gate's scope.** Whether it counts the lane's own processes (H5).
13. **The holistic scorer.** §9.2 names the builder and the grader, but not the scorer whose scores set the floors and whose notes are classified. The reference packet uses `gpt-6-astra` at xhigh.

These are concrete enough to hold:
- the 25-minute threshold, and "every treatment run below the control's slowest";
- zero blockers and every holdout probe in every run. Recent grader reports have no blockers, so the control can meet this.
- a not-run counting as not passed, and native artifacts required;
- floors relative to the control, once corrected for multiple comparisons;
- the third-family classifier with a hashed rubric;
- the pre-release publication path.

## 4. What a competent implementer would still build wrong

In the order they would hit them:

1. **Joins (B1):** either a bootstrap with no horizon, or an inbox that never sees a new conversation.
2. **Coverage as start sequences (M2):** released pages reopened over holes left by eviction, and requested spans served without the authorization check.
3. **Tombstone-only spans (H1):** every delete in a group the principal left, delivered to the removed member.
4. **`delivered` (H2):** acquisitions counted by sequence, and writes added to a read-only stream path that has no device identity.
5. **Ordinals (H3):** supplied by the client, as in the target.
6. **Rule 6 read literally (H4b):** `createPost` and `setLike` stop predicting.
7. **No presence exception (H4c):** `send` never predicts.
8. **The depth cap (M4):** the first reading drops `history` entirely.
9. **Arguments typed `id` (M4):** no depth step at all.
10. **Pinning (M4):** every `keep history` row pinned, and the budget breached.
11. **Unread (M5):** a Clique-specific engine feature that counts tombstoned messages.
12. **Carried results (M3):** stale values under `complete: true`.
13. **The control build (M1):** built in the same invocation as `snapback5`, with the hooks silently on.
14. **The time-boundary index (L3):** per-page state kept on the server.

## Verdict

**NOT READY.**

Revision 3 gets the mechanism right:
- one channel;
- pages computed on the device;
- refills inside the stream;
- Snapback 4's `complete`;
- sound proof rules;
- a real decision rule.

What remains is specification and statistics, not a change of course. With the changes below, I would call it **READY WITH CHANGES** for the first slice (§9.6 step 6), which already stops for the author before any comparison is run:

1. **Joins (B1):** define what a join delivers, and make the snapshot the warm set plus the depth step.
2. **Retained history (H1):** withdraw the tombstone-only subscription, or add a declared revoking column.
3. **Receipts (H2):** take the receipt-table fallback in both arms.
4. **Ordinals (H3):** have the engine assign them.
5. **Prediction (H4):** restore Snapback 4's timeline-edge rule and its presence exception, and compute the rate table from a pinned program.
6. **The decision rule (H5):** give "loss" a margin, correct the floors for multiple comparisons, and say in one place whether reading (B) is a gate.
7. **The simulator (H6):** add the invariant that compares device pages with the server's answers.
