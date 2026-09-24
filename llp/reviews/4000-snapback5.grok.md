# LLP 4000 design review — Grok (grok-4.7), reasoning effort xhigh

**Date:** 2026-09-24. **Revision reviewed:** initial (`3106ff03d9`). **Mode:** blind, read-only, over a detached worktree at that commit; `grok -p … -m grok-4.7 --reasoning-effort xhigh --disable-web-search`. **Provider/runtime:** xAI Grok CLI on the black M5 Max. **Redacted:** no. **Brief:** [`4000-snapback5.brief.md`](./4000-snapback5.brief.md), shared verbatim with the Astra and Opus reviewers. **Verdict: NOT READY.**

## Verbatim review

I'll review the Snapback 5 RFC against the cited record and the Snapback 4 engine, read-only. First I'll read the proposal and the evidence it rests on.The research ledger and the two LLP 3000.014 reviews are the load-bearing citations. I'll read those next, then the calibration record and the engine the RFC says it keeps.The record does not support the diagnosis as written, and four mechanisms in the RFC would be built wrong if an implementer followed the text. Verdict at the end.

## What is sound

The level split is real. LLP 3000.012 §2.1's medians (queries 83.5, scale 84.5, data modeling 85, top of the table 94–97) and the "LC in all 16 notes" ledger in §2.2 match the RFC's table. The quoted learning phrases (index prefixes, bounds, residency, structural completeness, prediction constraints, residency proofs) are in that ledger. Supabase 94 / Convex 88 / Snapback 2 68 in data modeling is what §2.1 says. Calibration #19 is holistic 88, data modeling 90, and the note really does praise shared declarations while charging receipt rows and prediction/completeness learning (`astra/FINAL.md`). The wall clocks check out: 0.2.29 is 122 min, 0.2.30 is 118, 0.2.31 is 77, 0.2.32 is 4,753 s (79 min), 0.3.0 is 5,389 s (90 min), 0.4.0 is 6,884 s with M8 first green at 3,257 s. There are 16 `N_*` codes. No incumbent has a clock on this brief. `offline_sync` really does sit at a series median of 93, and #19's `client_integration` 80 is the missing `createApp` asset option.

Keeping the Snapback 4 engine, the planner, the meter, at-most-once writes, and `view` is the right shape for a sibling. So is "the audience is the read rule" as far as LLP 3000.007 §6.6 actually went (drop the repeated `sync to`, not the horizon). Conservative prediction, `why` on demand, and moving scale certificates to an opt-in report are coherent. A pre-registered clock-and-grade bar, with Snapback 4 kept as the control, is the right kind of bet. `through` as a whole read audience plus narrowing conjuncts, stamped inside the writing transaction, is the headline both LLP 3000.014 reviews asked for. The risk section is right that page delivery is the invalidation problem the partition log was built to avoid.

## 1. The diagnosis

**High — §1, Summary, the evidence table.** The record does not say the remaining data-modeling cost *is* the bridge vocabulary, or that capability cannot move it.

LLP 3000.012 §2.2 is a four-column ledger. RM or CP is in all 16 notes; LC is also in all 16; the text says the learning column overlaps the others and names bounds, completeness, and read models as the things being learned. It says the recurring cost is derived data the application maintains, and that this is not a demonstrated single cause. The RFC's "what it supports" cell — "the bridge's vocabulary is the charge" — drops RM and CP.

The same section's ceiling is not "declarations that match a builder's prior, minus residency." §2.1's interpretation of the strong categories is assets, **read rules plus `sync to` plus `retain delivered-history`**, client-minted ids, and `expire at`. The RFC's "94–97" band drops `offline_sync` (median 93) and `sync`/`retain`, and keeps `diagnostics_dev_loop`, which is not a table declaration. The vocabulary §3.2 deletes is part of why authorization and offline sit at the ceiling.

After the capability waves the charge **moved**, which the protocol will not let anyone call a magnitude (N=1; `benchmarks/protocol.md` refuses magnitude claims below eight repetitions). Data modeling in the ledger ends at 82 on 0.2.32; #18 is 87; #19 is 90, one point above the old 82–89 range. #19's note no longer charges feed machinery. It charges receipts and prediction/completeness. LLP 3000.013's "did not move" is "inside noise," not "capability is exhausted."

The advice-repair citation is real and cuts both ways. Calibration #14 zeroed the targeted diagnostic shapes and `setup_and_docs` sat at 0.14 of its standard deviation (§20.22.7, not §20.23). The bounds bar after 0.2.29 also recorded the retired note's sentence showing up in the builders' reports in the note's place. Deleting a word does not delete the behavior the scorer reads.

**Scenario.** A Snapback 5 builder never types `sync`, `retain`, or `N_NEVER_COMPLETE`. Search still returns a page that is not the whole result (`searchAll` in #19's `chat.q`). Likes do not appear until the server answers. The grader's note says "completeness required explicit client handling" and "unread state was awkward," and never says "learning cost." §9's mechanism criterion passes. Data modeling does not go to 94.

**Smallest change.** Restate the claim as: LC is in every note and overlaps a second cost; after 0.4.0 the note that remains is receipts plus runtime completeness/prediction; vocabulary removal is a hypothesis about that second residue, not a finding. Keep RM/CP in the table.

## 2. Derived residency

**Blocker — §2, §4.1, §4.4, §8.** A page registry keyed by `(query, arguments)` does not preserve LLP 2000.000 §7.1, and #19's replay cannot show that it does.

Partition inversion is a log the engine maintains per audience: a membership insert bootstraps that group's rows, a membership delete emits one scope tombstone, and the device never holds a row the engine did not place in that audience (`postgres/log.rs` appends by partition; §7.1–7.2). §4.4 says that inversion "remains the outer check" and §8 says the sync-derived partition log is the mechanism Snapback 5 replaces. Those are the same mechanism. An implementer has to pick one.

The registry key in §4.4 is `(query, arguments)`. The set of pages in §4.1 is `(query, arguments, cursor)`. `home()`, `inbox()`, and `insights()` take no arguments and depend on `viewer`. One registry entry for `home` is a result cache shared across viewers. That is the cache LLP 2000 §7.5 existed to dissolve. The outer check saves you only if it re-evaluates the rule per device and refuses to reuse the stored page. The RFC never says the key includes the viewer, the cursor, or the schema generation.

**Scenario.** Viewer A and viewer B both subscribe to `home()`. The server fills one page record from A's follows. B's device applies it. Alternatively the outer check strips rows B cannot read and B's home is silently missing B's own posts. Either result is wrong. A public `global` page can be shared; a viewer-relative page cannot. The RFC's warm set lists `home`, `global`, `trending`, and `insights` as the same kind of thing.

Revocation is not a predicate match on a message row. `removeMember` deletes a membership and changes no message. §4.4 matches "the planner's predicate for the page." `history(chat)`'s predicate is `.chat = chat`. It does not change, so the held page stays `complete` and the local membership row is still in the store. §4.1 then re-runs `exists members[.chat, viewer]` over that stale row. §3.2's "a revoked row is deleted" does not say this. Released pages are "kept for reads but not maintained," so the tombstone is not delivered there at all. The removed member keeps the conversation. Partition inversion's scope tombstone is what made this not the application's problem. `retain delivered-history` in #19's `chat.q` is the opposite policy again: keep what was delivered, deliver nothing new. §3.2 claims that policy is the new default. It is not. #19's authorization note credits retained history for removed-member behavior.

**Following.** LLP 3000.013 §4 materializes one inbox per reader, copies in the background, and sets `complete` false while a backfill or cleanup for that reader is pending. Devices hold the private inbox and the public edges. #19 did not run that path: the celebrity post missed the 3× rule (p95 527 ms), and the builder left it for a read-time filter and then an application-owned projection. "Unchanged from LLP 3000.013" means the path the calibration abandoned, and under pages it is a second delivery system. The warm `home` page is `last 20` of the inbox, not the inbox. §4.2's `complete` does not mention pending delivery tasks, so the first screen can read `complete: true` while follower copies are still queued. Local "still followed?" filtering needs the edge rows. Today those are `sync public` (the whole graph). Nothing in §4.1 fetches them unless a declared query returns them.

**Scale.** #19's replay is 167,243 settled actions, 1,002 conversations, 100,015 messages, then named-reader page checks. It is not N devices holding warm sets, open threads, and search strings. Partition append is one log row per audience. Registry matching is per held page per subscriber. `searchAll(q)` is `messages matching q where exists members[.chat, viewer]` (`chat.q`). A new message matches an arbitrary set of held strings. That is not "an index probe" for Clique's shapes. A one-subscriber replay will not falsify §4.4, so §9's scale bar will not either.

**Schema adoption.** `successor.rs` already classifies rule changes as re-derive-the-partition, and literal-default additions can be applied without a rebootstrap when they do not change audience (`keeps_literal_default_images`). A page model adds a class the file does not have: editing a declared query changes what every device holds. What breaks if that is left implicit:

- Devices keep applying the old predicate and reporting `complete`.
- Cursors from the previous generation stay valid (`E_GENERATION` exists today and is not mentioned).
- Adding `through` or `per viewer` to a populated table publishes a half-filled audience. Both LLP 3000.014 reviews rejected a background fill for this. Activation today is one generation barrier (`column_activation`, LLP 3000.007.001).
- Changing a parent default or which columns a parent rule reads changes descendant audiences without an update. `interpretation()` in `successor.rs` already treats absent fields as schema-dependent. The Astra review of LLP 3000.014, finding 2, is this case.
- Redefining a populated view still hits `E_TIMELINE_REDEFINE`, the #19 operations score of 72. "The engine is kept" keeps that unless the fix lands in Snapback 4 first, which §8 requires and does not name.

**Smallest change.** Key every page by `(viewer, query, arguments, cursor, generation)`. Keep the partition log as the authority and revocation channel; treat the registry as an index of which log spans a device has subscribed to, not as a second authority. A membership deletion invalidates every held page whose rule probes that membership, including released pages, which drop rows rather than going stale. State shared-versus-per-viewer pages. Add a subscription fixture (many devices, warm set plus one open thread plus one `searchAll`) to the scale bar. On schema change, drop affected pages and refill `through` copies inside the existing activation barrier, parents before children, or do not publish.

## 3. Completeness and prediction

**Blocker — §4.2, §5.** `complete` is not computable as §4.2 defines it, and the two booleans drop facts the client already had to grow.

`N_NEVER_COMPLETE` is a **server** fact. The guide card says a page whose read rule reads a column the scan does not pin is `complete: false` on the server whatever it finds, because "no more" cannot be distinguished from "more you may not read" without disclosing the hidden key (`guide/codes.rs`; `prefix_verdict` in `read.rs` builds one synthetic row from the pinned prefix). #19's `searchAll` is that query. §4.2 says a Snapback 4 `N_NEVER_COMPLETE` query reads `complete: false` until the server answers and then `true`. That is the bug the note exists to prevent. The class was not a compile-time prediction of "the bytes have not arrived."

§4.2's three false cases (never fetched, offline and released, local write pending on an order key) omit meter cuts, word cuts, non-uniform authorization, Following backfill, schema generation, and a pending write that has no row. §4.1 also says the device re-runs the query over held rows. A server page and a local recompute over a subset are not the same result. `complete` cannot mean both "we hold the server's snapshot" and "local evaluation equals the server."

The current client contract is not two booleans. `Read<T>` is data plus `complete`, `cut`, `fresh`, `since`, `next`, or `loading`, or `denied` (`contract.ts`). `fresh: false` plus the last answer is the repair for #19's bug, where an incomplete read was published as ready `data: null` and `usePage` crashed. §5 says an app that wants "offline, showing what you had" reads `complete`. §4.2 says a held page stays `complete` while offline. Those sentences contradict each other. With §4.2, `complete` never means "showing what you had."

`cut: null` on a non-uniform read is a disclosure control ("not disclosed here," not "not cut"). Deleting `cut` forces the server to lie with `complete` or to reveal the cut. Deleting `next` leaves `home(c: cursor ?)` with no way to obtain `c`. A queued write "with no local image" (§4.3) has nowhere to put `pending`, because §5 hangs `pending` only on a row. `await createPost` does not update the page. The screen looks settled and empty of the write.

Compile-time classes that were carrying real information, not just vocabulary:

- `N_NEVER_COMPLETE` and `N_NO_CURSOR`: the page will not become complete, and there is no continuation. The app has to change the query, not render a spinner.
- `N_MAINTAINED_COLUMN_DISCLOSURE`, `N_MAINTAIN_DELTA`, `N_PUBLIC_AGGREGATE_COPY`: a count is readable by people who cannot read the source. Runtime `complete` does not say this. It is a product decision, not a progress flag.
- `N_HORIZON_GUARD` / horizon sites inside an otherwise predictable mutation: the call usually predicts and sometimes queues. One static `pending` bit cannot say "this one may queue."
- `fresh` / `since` / `denied`: transport, age, and refusal. #19 already showed that collapsing them into the payload is a user-visible defect.

**High — §4.3.** Prediction-by-proof is sound only in the conservative direction, and a realistic Clique session hits `pending` on the common social writes.

The engine does not treat "the row is on the device" as coverage. `aggregate_read_coverage` and `horizon_coverage` in `read.rs` mark a missing count or an unpinned existence as unknown. Recorded prediction requires a live, currently covered parent, not a retained or expired image (both LLP 3000.014 reviews; `device/recorded.rs`). §4.3 says "rows the device holds" and "constraints checked over held rows, or the engine carries the occupancy count (Lane P's design)." There is no Lane P occupancy design. Snapback 4's Lane P is read-only SQL and starters (`JOURNAL.md`, 2026-09-13). LLP 0093's Lane P is poll delivery. An implementer who checks uniqueness against a `last 20` page will predict a duplicate.

What #19 actually predicts is predicted because of **partitions**, not because the proof is small. `likes`, `follows`, and `posts` are `sync public` with no horizon, so the device holds the corpus (LLP 3000.007 §20.22.6: on the order of 48,200 posts). A page of cards holds `liked: exists likes[...]` as a boolean on a shape, not the like row. Under §4.1, `setLike`, `setFollow`, and `setRepost` cannot prove absence, so they queue with no local image. `saveProfile` cannot prove `unique handle`. `send` can be proved only when the membership row and the member page used by `for p in members` are both held; the warm set does not include `roster(chat)` or `history(chat)`, because those take arguments. So the write the offline milestone cares about (send) is predictable only after that chat has been opened online, and the writes the social half does constantly (like, follow) are not. §10's "more writes read `pending`" is true and understated. Rejection rollback of a predicted row is not specified; today the partition stream replaces the prediction.

**Smallest change.** Define `complete` as three server facts the device may also observe: `complete` (the server could prove this page is the whole visible result), `cut` (meter or words, withheld when disclosing it would leak), and `caughtUp` (this device has applied the log through the page's watermark). Keep `fresh`/`since`, `next`, `loading`, and `denied`. Do not map `N_NEVER_COMPLETE` to "true once the response arrives." Define the row closure of a page (every row and witness the plan and the rules read, not the rendered shape). Prediction reuses the existing unknown-coverage rules; delete the Lane P citation; a unique or `at most N` proof requires an occupancy witness, not a page. A non-predicted write is visible as a pending mutation id even when it has no row, and a refusal removes the local image.

## 4. The two additions

**Blocker — §3.3 `through .ref`.** The paragraph adopts the reviews' headline and drops the conditions that made them NOT READY.

Both reviews (`llp/reviews/3000.014-a-child-reads-through-its-parent.astra.md` and `.grok.md`) agreed: parent lifetime and identity, defaults and rule interpretation, disclosure of copied inputs, the existence oracle, completeness needing the whole rule, prediction needing a live covered parent, and adoption not being a chunked job. The narrower design they wrote down includes, and §3.3 does not:

- Incarnation means intrinsic id plus a generation bumped on delete and expiry, and a reused id or a changed unique key does not inherit the old children. §3.3 says "stamped" and never defines it. Ids are client-supplied; `insert_attempt` replaces an expired row that still has that id.
- The copy is the parent's substituted inputs under the schema interpretation at insert, not a live walk. Changing `bool default true` to `default false`, or which columns the parent rule reads, must refill behind one generation or be refused. §3.3 is silent. §6 of LLP 3000.014, which the reviews said does not cover this, is not replaced.
- Hidden fields are rejected if the client sends them, stamped, then the rule runs. The current write path checks the rule before recorded fields are filled, and a missing field evaluates as null (`write.rs` order, cited in the Grok review). §3.3 does not say this. The existence oracle (`not through`, or `through` under `or`) is forbidden by "narrowing conjuncts" only if that phrase is defined as top-level and not under `not`. The meter for a present hidden parent versus an absent one still needs the write-target reservation or the writer can tell them apart.
- Copied inputs do not ride query rows, `*` shapes, cursors, or write results. They may ride the sync image only when every recipient of that image may read them. A page store keeps the whole row on the device. `*` in #19's `messageCard` would publish `$chat.owner` to every member unless the split is specified. Narrower child audiences make this worse, not better.
- Sync admits only three rule forms (`public`/`allow`, `.col = viewer`, one `exists`). "So sync, prediction and completeness see a local rule" is the wrong inference: a local rule is not an invertible audience. Snapback 5 has deleted `sync` and still cites it as the consumer of the copy. Prediction must see a live covered parent in the same transaction, including a parent inserted earlier in that mutation (`created messages[.message]` in `send`). `held` is not enough. A retained-history parent must not authorize a new child.
- Aggregates derive a rule only when the stored inputs are a function of the group key inside one incarnation and are stored on the aggregate row. `count comments by issue` does not get that from the word `through`.
- Adoption fills inside activation, parents before children, and rolls back if any parent incarnation is missing. §3.3 has no adoption section. The first time someone adds `through` to Clique's `messages`, this is the bug.

**Scenario.** Comments copy issue `X`'s org A. `X` expires and is reinserted in org B. A page pinned by `.issue = X` has one verdict. Org B receives org A's comment bodies, or the count mixes them. Separately, `read <- through .issue` on messages, with the parent rule later edited to exclude a column the copies still carry: old messages stay readable, new ones are not, and no check fires.

**Smallest change.** Replace §3.3's `through` paragraph with the narrower design from the two reviews, including incarnation, interpretation identity, stamp-then-check, the recorded-field split, three-form audience admission, live covered parents, aggregate key condition, and activation fill. Do not say it is adopted until those sentences are in this RFC. Keep it out of the first slice (question 2 below).

**Blocker — §3.3 `per viewer`.** The column does not replace the receipt table #19 charged, and the reading given is either a leak or the wrong product.

#19's receipts are one row per `(message, other member)`, readable by every member of the chat, inserted by the **sender** in `send`'s `for p in members` loop, reduced with `min` across other members into `sent` / `delivered` / `read` on `messageCard`, and counted per viewer for the unread badge (`receiptState`, `unreadCounts`). There is a second table because disappearing messages expire. `cap 50 by message` matches `cap 50 by chat` on members.

§3.3 says reads see the viewer's **own** value, and a mutation sets the viewer's own value. The sender cannot write the recipient's bit, and cannot read it to draw the tick. The aggregate example, `count messages where not .seen by .conversationId`, is only the viewer's unread badge. Default `false` is unspecified: materializing it is members × messages (50 × 100,015 at #19); not materializing it means "unseen" is "no hidden row," and the sender's fan-out has no write to express. "Part of the row's audience" is the wrong concept. Audience is who may read the message. Seen-state is a second relation. Folding it into the message row and delivering "the row" to every holder of `history(chat)` ships A's seen bit to B.

Prediction and cost follow. Marking seen can be local. The unread view and the sender's `min` cannot, unless those aggregates are maintained and their deltas are in the page closure. A held history page would show `pending` on the bit and `complete: true` on a stale unread count. Every `send` still fan-outs to each warm inbox (every signed-in member holds the arg-less inbox). That is the write amplification the receipt table already had. The authoring win is real only after the engine owns that fan-out. The RFC does not say it does.

**Smallest change.** Specify two derived facts, not one column: a viewer-private bit the viewer writes, and a sender-visible aggregate (`min` / count) the engine maintains from those bits, readable under the message's existing rule. Defaults are not stored. The sender's insert creates no per-recipient row; the audience at insert time is the domain of the aggregate. Expire the private bits with the message. State that other viewers' bits are never in a page, a cursor, or a `*` shape. Keep the private bit out of the message's read-rule audience.

## 5. The bar

**High — §9, and the last sentence of Non-claims.** The order of instruments matches the author's ruling. As written, the bet can pass without being true. `benchmarks/protocol.md` does not contain a same-week rule. It says lanes of one comparison run **serially on one machine**, and that tokens are the cross-run metric because load muddies wall clocks. #13's own README recorded load swinging into the 80s because other work shared the host.

What would let it pass without being true:

1. **The M1–M8 contradiction.** The table requires time to first green on M1–M8 below both incumbents. The prose says incumbents cannot do M6 and M8 (`offline_sync` 44 and 43 on the 2026-09-05 record) and that the clock is compared only on milestones all three attempt. If "first green" requires M8, the incumbents never finish and Snapback 5 wins. If it excludes M6/M8, Snapback 5 can lose the offline product and still win the primary instrument. Protocol `firstGreenAt` is the later of suite pass and choreography pass, and it is null on abort. The bar never binds itself to that definition. #19's "54 min" is M8 first green, with 61 further minutes of post-green scale work excluded. An evaluator can move that boundary.
2. **The grade is not on a shared check set.** "Pass count ≥ the best of the three" rewards the lane that attempts more checks. Offline assertions that incumbents not-run, and Snapback 5 passes weakly, raise Snapback 5's count. #19 is 85 passed, 0 failed, 16 not run, labelled `uncalibrated-grader`. `coverage: honest` is a real grader verdict (the manifest spot-check in `grader-report.schema.json`). It does not make pass counts comparable. "Zero blockers" is not defined in that schema.
3. **The score floor does not test the diagnosis.** Holistic ≥ 89 and every category at the §2.1 median means data modeling at 85 passes. 94 is "the hope, not the bar" in §9 and "a bar the bet is held to" in Non-claims. A product that did not move data modeling passes the floor. Mean of three, with a scorer standard deviation near three and a protocol that withholds magnitude claims below N=8, will clear 89 by noise. The RFC says this and then uses the mean as a gate.
4. **The LC criterion is a keyword unless someone classifies it the way §2.2 did** (by reading, not by matching words). §10 lets the author read the notes first. The author deciding what counts as LC is the self-attribution §10 is trying to prevent. The bounds bar already showed a deleted note returning as a sentence.
5. **§4.4 is declared falsified only if `scale_and_limits` falls below the median.** The median is 84.5. #19 scored 87 while missing a midpoint by 0.011 ms on a flat curve, with one reader. A registry that is quadratic in subscribers can sit above 84.5 on that replay. Conservative prediction (everything `pending`, eventually consistent) passes functional checks and can make the clock faster because the builder stops fighting eligibility. `writes_and_transactions` and `offline_sync` floors are the only backstop, and they are medians of a partition-based series.

**Smallest change.** One comparison set, serial, one host, load gate recorded, protocol `firstGreenAt` on the intersection of milestones all three can pass, offline milestones reported separately and not inside the primary clock. Grade the intersection; count a not-run on a shared check as not passed; define blocker as the grader's existing severities. Quote the Non-claims sentence so 94 is not a bar. Classify LC with the §2.2 procedure, by someone other than the author, published with the notes. Add the subscription fixture before a scale miss can be dismissed. Do not treat N=3 means as a magnitude. The author's ordering (clock, then correctness, then score floor) can stand once those are the instruments.

## 6. Questions 2–4

**`through` and `per viewer`.** `per viewer` first, and not in the form §3.3 writes it. Do not put `through` in the first slice. Receipts are the cost #19 actually charged; parent flattening was not the sentence in that note. `through` is still NOT READY under both existing reviews, and LLP 3000.014's revision 2 has not landed. Debugging audience copies and page delivery in one slice is how the lifetime bug ships. Land the narrower `through` in Snapback 4, where the three invertible sync forms still exist to reject a bad copy, then take that engine. The first messaging slice should keep an explicit receipt table until `per viewer` can express the sender-visible tick, the private bit, expiry, and the unread count without a second author-written table. Putting today's `per viewer` into the messaging slice deletes the charged table and fails the milestone.

**Offline depth.** Do not accept "what was shown, plus first screens" as the offline product. Do not require unbounded history in the first slice either. The warm set covers `inbox` and `home`, which take no arguments. The conversation you tap is `history(chat)` and is absent until it has been fetched online. That is the ordinary offline open, and it is the case a 10,000-message horizon currently answers. Require one engine-derived step: the first page of every query whose arguments are ids already in the warm set (each inbox row's chat, not the whole log). Defer anything deeper. If that one page is too large for the meter, the depth policy is the thing to fix, not a returned `sync` line.

**Concept budget.** A reported number until the first calibration, not a blocking gate at commission. §7's count is not yet a measurement: it includes "diagnostic codes an author can draw," which punishes a better error, and §3.1's "six kinds" omit `fn`, `effect`/`emit`, `enum`, `search`, `format`, `require`, `upsert`, and `for`, all of which #19's program uses to compile. A gate on an undercount freezes the wrong language. Do what §9 step 2 already says: record the Snapback 4 count and the proposed Snapback 5 count before implementation, with an explicit inclusion list. Ratchet only after the first calibration, against that baseline.

## 7. What an implementer would get wrong, and what §3.2 cannot remove

Under-specified beyond the findings above:

- The read-set closure of a page (rows versus shapes versus probe witnesses). #19's cards are shapes with `exists` and nested profiles. Storing the rendered card makes prediction impossible; storing every probed row makes the page a partition by another name.
- Whether released pages are still authorized. §4.1 says they are readable and not maintained. That is a stale-authority cache.
- `fn`, jobs, `effect`/`emit`, `expire at`, `search`, and `once` assets are in the calibration program and absent from "that is the whole language card," while §3.2 says the table is everything that leaves. An implementer who builds §3.1 cannot compile Clique. The concept budget then ratchets a fiction.
- §8 says nothing in `snapback4-core` is rewritten, and §4.4's registry has to run inside the commit that today appends the partition log. The integration point is the core write path. Say so, and land it in Snapback 4 first as §8's own rule requires.
- Simulator invariants "with held pages substituted for the partition" is not a substitution. The partition invariant is "every row the viewer may read within the horizon, and no row they may not." The page invariant is weaker and has to be written down (closure, revocation, generation).

Not actually removable:

| §3.2 row | Why it stays |
| --- | --- |
| `retain delivered-history` | Product policy for a removed member. The proposed default deletes unreadable rows and also fails to deliver the tombstone to released pages. #19's authorization score depends on the declared policy. |
| Horizons | The meter bounds one request. It does not prefetch the first page of each warm-set chat, and it does not prove uniqueness. Removable only after the depth rule in §6 and an occupancy witness exist. |
| `cap N by` as a bound | `cap 50 by chat` on members is a product constraint and should survive as `at most N by`. `sync last 10000 by .at` is not that constraint. Deleting every `cap` deletes both. |
| The 16 `N_*` codes as a class | Residency notes (`N_NO_HORIZON`, `N_HORIZON_GUARD`, `N_NOW_SERVER`, `N_NOT_PREDICTABLE`, `N_MAINTAIN_SYNCED`) can leave with residency. `N_NEVER_COMPLETE`, `N_NO_CURSOR`, `N_MAINTAINED_COLUMN_DISCLOSURE`, `N_MAINTAIN_DELTA`, and `N_PUBLIC_AGGREGATE_COPY` are disclosure and continuation facts. `check --scale` does not put them in front of a builder whose page never becomes complete. |
| Online-only as a table property | Removable for tables no device query reads. Not removable for "this query must not be durable on the device." One `createApp` is fine only if it still forwards the asset option #19 lacked and still queues web writes. |
| `sync` / `sync to` as spellings | The spellings can go. The log, the tombstone, and the three-form audience check cannot. §6.6 dropped `to`, not this. |

`createClient` versus `createApp` is removable after the option gap is closed. Index names and `maintain` strategy spellings are already gone in LLP 3000.013; listing them as new removals does not shrink what #19's author still wrote (`by byActorTime` is in that program).

## Verdict

**NOT READY.** Do not commission an implementation from this text. The sibling, the engine reuse, the opt-in scale report, and a clock-then-correctness bar are sound. The diagnosis over-reads the ledger. The page registry, as specified, reintroduces a cross-viewer result cache and drops revocation. `complete`/`pending` delete server completeness, disclosure, and freshness. `through` restates a design both reviews rejected. `per viewer` does not replace receipts. The bar can pass while those are true. Fix the blockers in §§3.3, 4.1, 4.2, 4.4, and 5, and narrow §1, before a second review.


---

## Round 2 — revision 2 (`dbb10169b6`), 2026-09-24

**Mode:** blind delta review, read-only, over a detached worktree at that commit; `grok -p … -m grok-4.7 --reasoning-effort xhigh --disable-web-search`. **Brief:** `~/projects/snapback-sb5-reviews/round2.brief.md` (reproduced in the Opus round-2 section).

### Verbatim review

I'll review revision 2 against the three round-1 findings and the engine it cites, without changing anything. First I'll read the prior reviews and the RFC delta.The three round-1 reviews are all NOT READY, and they overlap on revocation, completeness, receipts, and the bar. Next I’ll read revision 2 and the diff that claims to answer them.Revision 2 keeps the log and restates the bar. I’ll check those claims against the engine, the brief, and the documents the RFC cites.Revision 2 is **not ready**. The completeness class, the client result types, the cross-viewer page key, and judging the bet against Snapback 4 are real fixes. The log-and-page split, the receipt mark, and the prediction rate are not.

## 1. Is each §12 disposition real?

| §12 row | Verdict | Where it stands |
| --- | --- | --- |
| Diagnosis over-reads the ledger | **Real** | §1 now says the charge overlaps read models, bounds, and completeness, and §9.1 registers readings (A) and (B). One slip: Supabase's M7 is `not-run` in `~/clique-full-20260905/lanes/astra-supabase/milestone-clocks.json`, so "every milestone green" is false. M8 cumulative first green at 110.5 min is right. |
| Registry is a cross-viewer cache and drops revocation | **Partial** | §4.3 keys pages by generation, plan, viewer, arguments, and cursor, and matching starts from the audience, off the commit path. The refill hole below is still open. |
| `retain delivered-history` is product policy | **Partial** | §3.2 keeps `keep history`, and §4.2 says that event stops new delivery and leaves held rows. Eviction and page exits can still delete them. |
| `N_NEVER_COMPLETE` is a server class | **Real** | §5: `complete` is false for a page whose class is never-complete. §6 prints that class in the default `check`. |
| Two booleans drop the client contract | **Real** | §5 keeps `complete`, `cut`, `fresh`, `since`, `next`, `loading`, `denied`, `pending` / `sent` / `failed`, the outbox, `runs`, `predicts`, and `restoring`. That matches `contract.ts`. |
| Possession is not proof; Lane P is not in the tree | **Partial** | §4.5 replaces possession with four rules and drops the Lane P citation. "Versioned" never appears in the rules, and the expected rate contradicts them. |
| `through` adopts the rejected design | **Partial** | The lifetime bullets in §3.3 are real. "LLP 3000.014 revision 2" is not a document: `llp/3000.014-a-child-reads-through-its-parent.rfc.md` is still the NOT READY text, and its §10 says revision 2 is pending. Its §5 still says an orphan stays readable. |
| `per viewer` cannot express receipts | **Partial** | The mark is no longer one row per message. The formula does not implement the brief's receipts. |
| Disclosure notes are not scale advice | **Real** | §3.2 and §6 name the five residency notes and six cost notes that leave, and the five disclosure and completeness notes that stay. That is all 16 `N_*` codes. |
| The bar can pass without being true | **Partial** | The control comparison, holdout categories, serial rule 5, and a non-author classifier are in §9. The pass conditions are still movable. |
| Incumbents can do the offline milestones | **Real** | §1 corrects the false premise. Supabase M6 and M8 are green on that clock file. |
| "Nothing in the engine is rewritten" | **Partial** | §8 names hooks and fences. The feed cannot be dormant as written, and the page registry is not one of the hooks. |
| Warm set fetches too much and holds too little | **Partial** | §4.1 adds a budget, excludes `online only`, and adds one depth step. The budget has no number and no priority, and the step does not cover the probe user's 100 conversations. |
| Six declaration kinds cannot compile Clique | **Partial** | §3.1 adds the forms #19 uses, except `merge`. #19's home feed is `merge feedEvents after c last 20 by byActorTime` in `schema.q`. |
| Schema adoption unspecified | **Partial** | §4.3 has generation, plan hash, narrowing, and `E_GENERATION`. A parent-rule edit that does not narrow still leaves stamped `through` copies on the old interpretation. |
| Following "unchanged" is impossible without `sync` | **Real** | §4.4 restates admission without `sync`, puts the viewer's edges in the home closure, holds `complete` false during backfill, and requires Lane L's lock. Lane L is named, not specified. |
| Concept budget measures the wrong thing | **Partial** | §7 counts runtime states and refuses to count "codes an author can draw." `why` outcomes and "refusal codes a generated client can receive" are not a fixed list. |
| 163 codes should be 161; cite the fixture | **Real** | §1 says 161 `E_*` and 16 `N_*` and cites `snapback4/crates/snapback4-sim/tests/fixtures/intent-clique.q`. The guide registry is 161 and 16. |

## 2. New or remaining defects

### Blocker — §4.2–§4.3. An entry is not an image, and the two streams can disagree.

§4.3 says a page subscription adds "the twenty-first message after a delete" to the log, and that "tombstones and images still come from the log." The current log is a per-audience stream: `partition::append` writes `put`, `del`, `scope`, and `join`, and `stream` catches a device up from one watermark over membership intervals (`partition.rs`). The newest-20 snapshot is not an interval. The twenty-first message's `put` is before that watermark, so the entry names a row the device does not hold.

Matching runs off the commit path. A matcher that appends "enter message 51" after a later commit has tombstoned message 51 resurrects it. That breaks LLP 3000 §6 invariant 2: a row revoked at sequence S renders on a client whose watermark has passed S.

An exit is the other direction. Unfollow removes a post from `home` and does not tombstone it. Nothing says an exit drops a page tag only. Treating it as a tombstone deletes a row another page still holds.

`trust_synced_read` does not mean "the log delivered it." It returns true only when `table.sync` is set, and then only for `DeliveredHistory` or an audience that cannot expire on the device clock (`read.rs`). Deleting `sync` makes the existing function return false for every table, so a keep-history row is rechecked against `exists members` and disappears. Logical expiry is also applied at catch-up before the sweep logs a scope (`partition.rs`, around the `expired` walk). A new page catch-up that only applies logged tombstones misses that.

**Smallest change.** One merged log, the stream that already has one watermark. A refill is a new `put` of the current image, sequenced before the entry that tags it. The matcher emits only after reading the log through its own append, and it does not emit an entry for a dead id. An exit drops the page tag and nothing else. Restate trust as the leave policy plus "no audience expiry the log has not recorded," not `sync.is_some()`.

### Blocker — §3.3. The mark does not implement the brief's receipts.

The brief (`social-messenger.md`, M3): receipts are **per message**, monotonic, `sent` → `delivered` (fetched by that client) → `read` (viewed the conversation). The group tick advances only when every member of the **recipient set** has reached that state. The set is membership at send time, and members who leave or are removed before reaching a state drop out.

§3.3's operational sentence is "every member whose `joinedAt` is at or before the message has `readUpTo` at or after it."

- The sender is a member whose join time is before the message. Alice sends, her mark stays at the default 0, Bob reads. The tick never leaves `sent`. M3 acceptance step 4 fails. #19 never inserts a receipt for the sender (`chat.q`, `send`).
- `deliveredUpTo >= message.at` cannot represent a tail fetch. §4.1's depth step fetches `last N by .at`, the newest page. Any timestamp that covers the newest fetched message also covers every older message the device never fetched. #19's `fetched(chat, ids, opened)` marks specific ids for that reason.
- Nothing writes `deliveredUpTo`. A mutation "may set only the viewer's own value," so either the app sets it (and the engine's depth fetch is invisible) or delivered collapses into read.
- The mark is not monotonic and not clamped. A member who sets `readUpTo` to a future time marks messages that do not exist yet, including for everyone else when the mark is visible.
- Unread is `count messages where .at > readUpTo`. That counts the viewer's own sends, and it counts the full prior history for a new member (`readUpTo` default 0). #19's unread is receipts for this principal with `state < 2`, created at send, so neither happens. The brief also says new members see full history; it does not say that history is unread.
- "Visible to the row's audience" puts the raw timestamp on the member row. That row's rule is `exists members[.chat, viewer]`, so every member's log image carries every other member's cursor, not the aggregate tick. Private marks are kept out of pages, cursors, and `*` shapes, and are not kept out of the partition image. `joinedAt` is not a column in the §3.1 example; #19's immutable `at` works only if leave deletes the row and rejoin inserts a new one.

Leavers do drop out: deleting the member row deletes the mark, which matches the brief's drop-out clause. Multi-device read sync (M8) also works, because one mark per viewer rides the member row to both of that viewer's devices.

**Smallest change.** Keep per-message delivery state, or define a structure that can name a non-prefix fetched set. Define the recipient set as members other than the sender who were members at send time and have not since left. Clamp each viewer's mark to the latest message time, monotonic. State who advances `delivered` when the engine fetches. Exclude the viewer's own sends and pre-join messages from unread. Strip private marks from the log image, and say that a visible mark discloses the raw cursor to every current member.

### High — §4.1. The depth step, the budget, and `keep history` cannot all hold.

The step maintains the first page of every query whose only non-cursor argument is a reference on a warm-page row, and eviction "never drops a row that a pending write or a maintained page depends on." The budget is "stated numbers in the program's generated facts," and no number or priority is given. If the budget is smaller than the step, one of the two sentences is false. Dropping `insights` before `inbox` is allowed.

#19's inbox is `last 50`. The probe user has 100 conversations (`social-messenger.md`, cold-start rule). The other 50 are not in the warm page, so they are not in the step. The 12.6–15.0 s figure is not that workload: 12.6 s is the successful full-replica acquisition (`lane-final-report.md`, 12582 ms, 100 conversations); 14.98 s is the earlier attempt that then failed `E_SHAPE_EXCEEDS_METER` (`lane-run-log.md`).

After removal, `keep history` leaves held rows in place. The history query's rule no longer admits the viewer, so a still-maintained page emits an exit for every message. Released keep-history rows are not protected from eviction, because they are neither a pending write nor a maintained page. M3.6 fails by either path.

The step is not recursive. That part is sound.

**Smallest change.** Give the budget a number and a priority with `inbox` and `home` above aggregates. State that the step covers every conversation the cold-start rule names, or change the rule. On `keep history`, detach subscriptions without emitting exits, and pin those rows against eviction.

### High — §4.5. The four rules are a refusal procedure, not the rate that is written next to them.

Read literally, a read is proven only if it is a point read of a live row on a maintained page, a complete uncut set or an occupancy witness for an absence or a constraint, or a row this body just created. `now` in a condition is never proven. Anything else queues. That direction does not invent a local success the covered state cannot support, provided an occupancy witness is only the population the viewer is allowed to count. A witness over hidden rows would make `at most N` unsound; the text does not say.

The rate is not that procedure, applied to #19:

- `send` reads `exists connected[principal]` for every other member and loops `for p in members`. A range read is neither rule 1 nor rule 2. `connected` is not on the history page. `send` queues. The rate says it predicts once the conversation page is held.
- `setLike` needs absence of `likes[post, viewer]`. The card stores `liked: exists …` as a boolean, not a covered negative fact. Rule 1 has no point-absence. Twenty held posts do not prove this viewer has no like row. The rate says `setLike` predicts on a held post.
- There is no `markRead`. #19's `fetched` updates `receipts[id, viewer]` for specific ids. `receiptState` returns a string, so the closure has to store the raw receipt rows or the point read is not held.
- `follow` / `unfollow` do queue under these rules, except unfollow of an edge the home closure actually holds, which rule 1 allows. The rate says both always queue.
- `edit` and `deleteMessage` queue because of `now`. That part of the rate is right. So is rule 4, which `send` needs for `created messages[.message]`.

"Versioned coverage" is not defined. Currency is "on the revocation channel," with no sequence in the discharge.

**Smallest change.** Add point absence as a delivered negative fact, and classify range reads with rule 2. Say an occupancy witness counts only rows the viewer may read. Replace the rate with the operations these rules actually predict on #19's `chat.q` and `schema.q`, after `connected` and `fetched`. Keep the closing sentence: this is speculation under concurrency, not future acceptance.

### High — §8. The dormant feed is on the commit path, and it is not the registry.

`mutate` collects `runner.read_tables` (table names), appends partition events, and commits (`engine/mod.rs`). Ranges and point-read keys are not recorded. Capturing them has to happen inside `runner.run`, before the runner is dropped, in the same transaction. That is not post-commit. If capture consumes the meter or can fail the commit, writes that succeed today fail. If it shares the transaction, the 167,243-action replay gets slower, so the control moves.

The page index needs the inverse: which subscribed closures contain the key this commit wrote. The partition log already carries those row images. A feed of what the write read does not answer which pages to update. §8 does not list the registry.

**Smallest change.** Say capture cannot affect the meter, cannot fail the commit, and is not written into the partition log. List the subscription index as Snapback 5-only. Drop the feed unless matching is specified against it.

### High — §9. The bet can still pass without being true, and reading (A) can fail without being false.

- §9.3 gates both protocol `firstGreenAt` and time to last green, and does not say which wins when they disagree. "Beats the control" has no delta. The variance-transfer rule "registered here" is "a standard deviation of about 3 and the spread of the last five runs." `benchmarks/protocol.md` requires N≥8 for an ordering claim unless the transfer rule itself states the decision. An evaluator can pick the delta after seeing the runs. N≥3 is the escape hatch.
- The clock cell uses "the intersection every lane attempts." The correctness cell says a not-run on a shared check counts as not passed. Intersection-after-the-fact drops an assertion a lane skipped. Those are different sets.
- Reading (A) fails if any note mentions pending writes or offline gaps. §10 states both as intended consequences. An honest note confirms (B) and fails the bet even when removing the spelling worked. The rubric that would prevent that is not written. The author's ruling in the same section still says a score near 89–90 is acceptable if the clock beats the incumbents.
- `data_modeling` is reported, not gated. Queueing-without-image is measured, not gated. A builder who predicts nothing can finish faster and clear a median floor.
- "Delivery p95 or matching work above Snapback 4" does not say the population, the noise rule, or whether this harness load is inside the builder's clock. Floors are medians of the last five historical runs, not scores of the control that carries the additions.
- §11 question 5 still asks whether this comparison is the budget. Until that is answered, §9 is not registered.

**Smallest change.** One primary clock: last green, including the delivery load, median of the preregistered N, with a numeric margin written now. One assertion list, frozen before the first lane, not-run counts as not passed. Rewrite (A) so intended pending and one-step depth are not automatic failure, and publish the classifier's rubric in this RFC. Gate the queueing rate. Define the delivery comparison against the control on the same devices, with a noise rule.

## 3. What an evaluator can still move

- Which of the two clocks decides, and what delta counts as a win at N=3.
- The assertion set, by reading "intersection every lane attempts" instead of the frozen list.
- The holdout pass conditions. The categories are named; the observation is not. "Completeness over a range full of hidden rows" does not say that `complete` stays false and `cut` stays withheld.
- Whether a note about follow queueing falsifies reading (A).
- Which delivery percentile, over which commits, with what noise margin.
- The cold-start baseline, any number in 12.6–15.0 s, including the failed acquisition.
- The concept count, by adding or dropping `why` outcomes and refusal codes.
- Whether question 5 retires the comparison after the results are disappointing.

The holdout categories, "not-run counts as not passed," native-for-every-lane, serial execution, and a non-author classifier are concrete enough to hold.

## 4. What a competent implementer would still build wrong

The findings above are the wrong builds. Four more are smaller:

- **§3.1.** Implementing the card as the whole language omits `merge`, so #19's home feed does not compile. `group(...)` is used too, as a call rather than a declaration.
- **§3.3 against the current LLP 3000.014.** Cascade-delete children, and also keep orphans readable, because that RFC's §5 still says so and §3.3 calls it the design of record. `not through` and `through` under `or` are still legal if the implementer follows 3000.014 §2. Aggregates still have no "inputs are a function of the group key" rule.
- **§4.3.** A populated-view rebuild "in the background" publishes a generation while devices still read the old view. That is the failure mode both 3000.014 reviews refused for adoption.
- **§4.2.** Page catch-up that does not append logical expiry leaves an expired audience readable until the sweep.

## What is now sound

The hypothesis is stated as a hypothesis. The partition log stays the authority: one audience per row, scope tombstones, one watermark, no compaction. Page keys include the viewer, and a public page is the only one that can be shared. `home` is per viewer. Completeness stays a class on the server, the device, and in `check`, so a finished scan cannot reveal hidden rows. The read and write types, the outbox, and `runs` / `predicts` stay. Audience-first matching, off the writer's meter and outside the engine lock, is the right shape. `keep history` and `online only` are acknowledged as product policy. The note split matches the sixteen codes. Prediction no longer treats "the row is on the device" as coverage, released rows are not witnesses, `now` in a condition is not proved, and same-body `created` rows are visible. Following is restated without `sync`. The bet is against Snapback 4 with the same additions, not against incumbents the control already beats to first green. The 161/16 counts and the Supabase 110.5 min clock check out.

**Verdict: NOT READY.** Do not commission an implementation from this text. A further revision has to make a refill image one event in the existing log, make the receipt mark match M3 or keep the receipt table, and make the prediction rate and the §9 decision rule true of the text that is already written.
