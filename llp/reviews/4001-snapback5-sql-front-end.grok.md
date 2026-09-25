# LLP 4001 design review — Grok (grok-4.7), reasoning effort xhigh

**Date:** 2026-09-25. **Revision reviewed:** initial (`8a2637efa5`, §11 ruling at `185600d8e2`). **Mode:** blind, read-only, over a detached worktree; `grok -p … -m grok-4.7 --reasoning-effort xhigh --disable-web-search`. **Provider/runtime:** xAI Grok CLI on the black M5 Max. **Redacted:** no. **Brief:** `~/projects/snapback-sb5-reviews/4001.brief.md`, shared verbatim with the Astra and Opus reviewers. **Verdict: NOT READY.**

## Verbatim review

I'll review LLP 4001 against the cited record and the Quarry IR, read-only and in this session only. First I'm loading the RFC and the documents it depends on.The RFC is loaded. Next I’ll check its evidence and mapping claims against the shelved bet, the Quarry IR, and the Clique program.The 94 is one cell in the September 5 scores, not a stable SQL result. I’ll check what that Supabase lane actually wrote, and whether the Clique forms lower into the IR.# LLP 4001 design review — Grok (grok-4.7)

**Date:** 2026-09-24. **Document:** `llp/4001-snapback5-sql-front-end.rfc.md` (Draft, initial). **Mode:** blind, read-only, this checkout only. **Family:** Grok. **Redacted:** no. **Verdict: NOT READY.**

The record does not support expecting `data_modeling` to move because the spelling became SQL. The printed surface does not cover the committed Clique program, and several of §3's own statements do not lower into the Quarry IR. The pre-test and the comparison can both come out the right color for the wrong reason.

## What is sound

Shelving LLP 4000 and not reopening derived residency is the right call. Keeping the Snapback 4 engine, putting the parser only in the CLI, and leaving the device on IR is the right fence: the wasm budget is untouched, and prediction, the meter, the planner, `complete`, and `pending` stay one implementation.

The experimental shape is right in outline. One engine build, LLP 3000.015 on both arms, Quarry as the control, a pinned program compared by hash, and "Snapback 5 is a number that never ships" if the bet fails. Naming the four hard places in §5 and refusing to claim that SQL deletes them matches LLP 0329: capability follows an analyzable form, so mutations stay a subset. Adding an explicit SQL-SUBSET class, and recording "the charge moved" when that class outweighs the control's language complaints, is a better falsifier than LLP 4000's residual bin. Not failing the bet on a not-distinguished clock is the correct change from LLP 4000 §9.3, because this treatment is not supposed to move the clock. Treating 94 as a hope rather than a bar, in §8, is the honest sentence in the document. Postgres rather than SQLite, and a separate package rather than a mode of `snapback4`, are the right answers to §11. A pre-test before compiler work is the right sequence. Reusing the binder, planner, diagnostics, and `api.ts` emitter is the right architecture.

The three device-admissible read shapes in §3.2 are the three shapes `infer_audience` actually inverts (`public`/`allow`, `.col = viewer`, one `exists` probe ending in `viewer`), and permissive-OR / restrictive-AND matches how policies and `RuleExpr` combine. `keep history`, `expire at`, `online only`, a product cap, and the row-keyed unread predicate are the right Quarry facts to try to spell. The `send` example is the right prediction shape: presence decides only `snapback_emit`.

## 1. The premise

**High — Summary and §1.** The ledger does not say "replace Quarry with SQL and `data_modeling` should move."

The summary says this bet targets the largest named item. The same page says the language is the second-largest (8), behind bounds (11). Those counts are not LLP 3000.012's. That section's own table is RM 12, CP 12, QC 6, LC in all 16, and it says the learning column overlaps the others and is not a single cause. The 8/11/5/2–3 split is the LLP 4000 Opus review counting abridged phrases. The classes are not a partition: "restricted joins/scans" is in the language list and is also a bounds phrase. Ranking them and picking number two repeats the move that shelved LLP 4000, one row down the same list.

The table then dismisses the 11 bounds phrases as execution-model learning that LLP 3000.013's planner has since removed. That is not a recount. All 16 notes are 0.2.x, from before that planner. The post-planner note is calibration #19. LLP 4000 §1 places #19's remaining cost in completeness, the prediction proof, keys that carry membership, and "the compiler's distinctions." §1 of this RFC quotes the one #19 sentence that names SQL and treats it as the recount. #19's `data_modeling` score of 90 is the "inside noise" result this RFC cites for "adding or removing Quarry forms has not moved the category." That result cuts both ways: it does not isolate the spelling as the lever.

What the Astra scorer put at 94 is one cell. `benchmarks/runs/2026-09-05-clique-full-3x3/holistic-scores.md` records Supabase `data_modeling` as 94 / 86 / 85 (mean 88). The same scorer gave Convex 88 and charged it because joins, aggregation, and counter backfills stayed application code. Familiar TypeScript did not reach 94. The 94 note credits keys, constraints, joins, recipient ledgers, GIN search, and server aggregates, and then familiarity.

The lane that earned the 94 did not write the surface §3 proposes. Its committed `schema.sql` enables row-level security on every table and contains no `CREATE POLICY`. Counters are a trigger (`clqfa_like_counter` updates `like_count`). Order is a sequence plus `row_number() over (...)`. Search is a GIN expression index. There are partial indexes and many explicit indexes. Mutations are one `jsonb`-dispatching plpgsql function, `clqfa_mutate(who, op, b)`, using `SELECT … FOR UPDATE`, `count(*)` as a cap, `clock_timestamp()`, and `RAISE EXCEPTION` with English messages. Authorization for that lane scored 78, not 94, and lived in the API. Muse's lane, which did use policies, triggers, and `pg_cron`, scored 85 in this category, inside Snapback 4's range. The only surface this grader put at 94 is unrestricted Postgres plus application-owned triggers, not policies, materialized views, and a plpgsql subset.

§1's own caveat is the accurate claim: nothing shows that a builder pays no tax on a SQL surface that refuses some SQL. The summary says the opposite.

**What moves the charge into §10's subset.** The phrases Opus counted as the language — "less flexible than … SQL," "fewer language escape routes," "restricted joins/scans," "constrained expressiveness" — are complaints about a restriction relative to SQL. A subset that refuses the 94 lane's triggers, GIN and partial indexes, window functions, `jsonb` functions, and dynamic dispatch recreates those phrases with a new referent. The charge moves by construction unless the familiar frame reduces the count even though the restrictions remain. That is a framing hypothesis. The 94 is not evidence for it. Convex at 88 is evidence that familiarity without owning the aggregates does not reach the ceiling, and LLP 3000.012 §2.1's interpretation is who owns the work (RM in 12 of 16), not which keywords are used.

**Smallest change.** Make §1's caveat the claim. Delete "targets the largest" and "SQL is why 94 is reachable." State the hypothesis as: a familiar frame may reduce learning-cost phrases even though completeness, admission, the subset, and `now()` remain. Cite the 94 lane's actual file as what this subset will refuse, and cite Convex 88 as the familiarity-without-ownership comparison. Do not treat RM as already handled by the spelling.

## 2. Fidelity of §3

**Blocker — §3, §3.1, §3.4, §3.5, §3.6, §3.7.** The admitted language does not contain the committed program, and the program printed in §3 is not in the language §3 admits.

`intent-clique.q` plus LLP 3000.015 is the population §7 says will be written line for line. The binder and `ir.rs` are the lowering target. Form by form:

| Form in the target or in §3 | Result |
| --- | --- |
| `use identity password` | No spelling. The `.sql` file is not a program. |
| `effect push` | `create type push as (...)` is a composite type. It does not declare an effect, and it cannot carry the guide's secrets, retry, backoff, deadline, or cancellation. |
| Implicit `id`, client-minted | Quarry refuses an authored `id` column (`bind/catalog.rs`). §3 requires `id snapback_id primary key`. Unspecified special case. `gen_random_uuid()` is what a Postgres reader will write. |
| `text 1..50`, `text 3..20 format handle`, `format url` | §3.1 lowers only `length(x) <= N` and `x in (...)`. Min length and `TextFormat::{Handle, Url}` have no rule. `profiles.handle` does not map. |
| `unique handle else HANDLE_TAKEN '…'` | A unique constraint has no refusal code or message. The generated client loses `HANDLE_TAKEN`. |
| `immutable authorId, parentId, at` | §3.1 infers immutability from "no update policy can change the column." `posts` is `update <- .authorId = viewer` and those three columns are immutable anyway. A policy `using (author_id = current_principal())` still allows the writer to change `author_id`, `parent_id`, and `at`. Inference marks nothing immutable. |
| `public 'Clique profiles are discoverable'` | `using (true)` can lower to `Allow` or `Public`. The reason string, which disclosure notes print, has no slot. |
| `sync public`, `sync to members[.conversationId]`, `sync last N by` | No clause. See the next finding. |
| `retain delivered-history`, `expire at`, `online only`, `cap 50 by` | These four match §3.7 (`snapback_keep_history`, `snapback_expire_at`, `snapback_online_only`, `snapback_cap`). `snapback_cap` inside `CHECK` is not a row-local check; it is at least listed. |
| `search displayName, handle` | §3.7's option is one column. The two-column words index does not fit the shown syntax. |
| `image <=N`, `video <=N`, `once` | Named in §3.7. The `once` attachment is an ellipsis, not a grammar. |
| `enum('member','admin')` | `check (x in (...))` lowered to an enum is a heuristic. A closed `CREATE TYPE` is what a Postgres reader writes, and is not mentioned. Acceptable only as an explicit rule. |
| `likeCount: count likes`, `repostCount: count reposts` | In-table maintained columns. No spelling. The printed `generated always as (max(...) over conversation)` is not legal Postgres (a generated column cannot read another table; `over conversation` is not a window frame) and is not an IR maintain. `MaintainKind` is `Count` or `Sum` only. There is no `min` or `max`. |
| `count likes by .postId.authorId` and the other dotted views (`receivedLikes`, `dailyLikes`, `receivedReplies`, `receivedReposts`) | A join plus `group by` looks like the view and is not the mechanism. Dotted keys lower only when the path is already a recorded field (`bind/maintains.rs`). Delete-and-recreate of the post is why LLP 3000.012 §2.4 stores the attribution on the contributing row. §3.3 does not mention recorded fields. |
| `day(.at)`, `day(.at, 8h)` | Not specified. `date_trunc('day', at)` is the wrong semantics: the guide's `day` is a Unix-UTC millisecond ordinal with no daylight-saving adjustment and an optional fixed offset. `dailyLikes` and `dailyPosts` do not map. |
| `view activity` union | Expressible as `UNION ALL` if the author adds the discriminator the fixture already has (`repost`). Unstated loss: cursors need branch identity because source ids collide across tables (LLP 3000.013 §3.1). A Postgres view runs as its owner unless `security_invoker` is set. Snapback must run it as the viewer. Neither fact is in §3. |
| `view following` | The predicate can be written. Per-reader incremental materialization is not what `CREATE MATERIALIZED VIEW` means, and LLP 3000.013 §3.3 admits it only when the sources are public and fully `sync public`. There is no sync clause to satisfy that. |
| LLP 3000.015 row-keyed `unread` | The §3 query text matches the admitted predicate (one parent equality, comparisons to the `members` row, source-only conditions). Unstated: the members-row read rule, the pending recount when `read_up_to` jumps, and prediction only when the device holds the covered range. |
| `written by` | The idea matches LLP 3000.015 §1. The syntax is not a Postgres column constraint, so the parser named in §4 cannot accept the example. `readable by audience` is missing. LLP 4000 §3.3 says Clique's marks are declared readable; the 3000.015 default is private. The treatment cannot match that product decision. |
| `sequence by` | Named, and the shared per-parent counter is the right meaning. `snapback_sequence(conversation_id)` is not a typmod (typmods are constants). Two such columns share one counter across tables (LLP 3000.015 §2). The type looks like two independent sequences. A reader will not expect a new member to consume a message ordinal. |
| Shapes `postCard`, `activityCard` | §3.3 says a correlated subselect becomes a shape field. Shape fields in the guide are columns, point reads, and `exists`. A correlated `count(*)` is a scan or a maintained aggregate, not a shape field. `pending` propagation and named-shape spread (`socialProfile`'s `{ ...p, followers, following }`) have no spelling. |
| `home`, `global`, `userPosts`, `thread`, `history` | One `select` with `where`, `order by`, and `limit` can express these, except `thread(postId: posts)` and `history(conversationId: id)`. §3.7 has `snapback_id` and not a reference type. `ArgType::Ref { table }` and `ArgType::Id` collapse. That distinction is what LLP 4000 §4.1's depth step qualifies, and what the client types. |
| Cursor | The printed `history` declares `c snapback_cursor` and never reads `c`. The page is a side channel. A Supabase reader writes keyset `WHERE` and will double-apply or ignore the cursor. |
| `trending` | Expressible if `at > now() - interval '24 hours'` is recognized as LLP 3000.013's bucketed lanes and if `order by like_count, at` survives. `like_count` as an in-table maintain has no spelling, so the order key is missing. |
| `people` (`matching`, `text <=100`) | `snapback_words` is listed. Argument bounds are not. |
| `socialProfile` | Point read, `! else NOT_FOUND`, spread, an aggregate point read, and `exists`. §3.4 admits only `language sql` and one `select` returning `setof`. A missing row returns SQL null, not `NOT_FOUND`. Does not map. |
| `insights` | A `range(day(now) - 6, day(now) + 1)` loop that pushes objects. Not one `select`. `generate_series` is outside the admitted body. Does not map. |
| `createPost` / `setLike` / `setFollow` | `if absent` matches `ON CONFLICT DO NOTHING` if the conflict target is the unique key, not only `id`. `require … else CODE` matches `raise`, with the code/message swap below. `else if exists likes[…]` is an existence read in a condition. §3.5 admits `if` and refuses "select into arbitrary expressions," and does not say a condition may be a planned `exists`. The fixture's toggle is in the gap. |
| `update t[key] { … } if <condition>` | Not the same as `if cond then update`. The IR condition is `WriteCondition`, judged against the read rule's `current`, returning `E_CONFLICT`. A plpgsql `if` is a separate read. The fixture has no `if` update; the edit path on the writes card does. |
| `update` / `delete` `where` | §3.5 admits a `where`, not a point key. `update members set role = 'admin' where conversation_id = $1` writes every member. Quarry updates one key. Prediction and the hidden-row refusal rules (readable target → `E_RULE`, unreadable → `NOT_FOUND`) have no range form. |
| Digest job | The body is an outer sweep, an inner loop, a domain `count(messages where …)`, and accumulators. §3.6 says every `for r in select` over a table is a sweep. LLP 3000.013 §5.2 and the jobs card say only the top-level `for` is the chunked sweep; inner loops share the chunk; loop-carried state across a commit is refused. §3.5's closed list omits `:=` and calls `select … into` refused, which is how a SQL author spells `n = count(...)`. The committed job does not map. `once [p.principal, periodEnd]` is a structured key. `message_id \|\| ':' \|\| principal` collides (`a:bc` versus `ab:c`) and is not that key. |
| `schedule dailyDigest every 2m` | `*/2 * * * *` works. `every 90s`, which the jobs card still teaches, is not five-field cron. The engine passes `periodStart` and `periodEnd`. The printed schedule computes `now()` in the command, which is a different clock if it is evaluated at definition rather than at fire. |
| Edit policy `now() - at <= interval '15 minutes'` | Parses as SQL. Cannot lower. `rule_expr` accepts only `=`, `!=`, `and`, `or`, `not`, `exists`, and `created`. `now` and `<=` are a mutation `require`, not a rule. The showcase policy is refused by the binder the RFC says is reused unchanged. |
| `with check (read_up_to = old.read_up_to)` | The equality can be `Eq(NextField, OldField)`, which is a real rule. `old` is not in scope in a Postgres policy. It is not listed in §3.7. LLP 4000 §3.3's monotonic form, `next.readUpTo >= old.readUpTo and next.readUpTo <= conversations[…].latest`, cannot be a rule at all (`>=`, and a cross-row read). |
| `create index`, which §3.1 admits | LLP 3000.013 §2.3 synthesizes indexes and tells the author not to name them. The 94 schema is mostly indexes. Honoring `CREATE INDEX` fights the planner; refusing it is the first subset hit a Supabase builder takes. |
| Service grant `or viewer = 'service:…'` | The engine strips those disjuncts and still syncs (`RuleExpr::device_audience_rule`). §3.2's "any other select policy is server only" drops a grant the control arm can sync. Not in the fixture; it is on the rules card the control builder still reads. |

**Scenario.** A session follows §7 and tries to transliterate `socialProfile`, `insights`, the digest, `HANDLE_TAKEN`, `format handle`, `sync public`, and `receivedLikes`. For each one it either invents syntax §3 does not define or discovers the function is `E_SQL_UNSUPPORTED`. Separately, `snapback5 check` on the §3 listing itself fails: `written by` and the generated column do not parse, and `messages_edit` parses and then dies in `rule_expr` with "`<=` is not a rule operator."

**Smallest change.** Add a three-column table, fixture form to exact SQL to IR node (`RuleExpr`, `Maintain`, `Sync`, `Stmt`), and delete every example that is not a row in it. Move the edit window and any monotonic mark into the mutation body. Give `unique … else`, formats, min length, multi-column `search`, `readable by audience`, structured `once` keys, domain `count`, and `:=` real spellings inside the admitted subset. State that `min`/`max` are out until `MaintainKind` grows, which this bet forbids, so `latest` is not a column. Do not start the pre-test until that table covers every line of `intent-clique.q` and LLP 3000.015.

**Blocker — §2, §3.7, §6.** There is no spelling for `sync`, so the treatment cannot be "the language and nothing else."

`Table.sync` absent means online-only. The fixture opts in with `sync public` and `sync to members[.conversationId]`. Audience inference (LLP 3000.007 §6.6) runs only when a `sync` line is present; the horizon is a separate `last N by`. §3.7 has `snapback_online_only` and not the positive declaration.

If the lowering treats an admissible policy as `sync` with no horizon, two things happen. The fixture's tables happen to match, because they have no horizon. The default flips relative to Quarry: forgetting the line today means server-only; forgetting it under that rule means every device. That flip is LLP 4000's derived residency, which §6 says this bet does not implement ("§8 hooks are not needed") while §2 also says LLP 4000 §4–§5 are the runtime of record. §4–§5 are mostly the derived-horizon design. The list in §2 (partition log, audiences, `complete`, prediction, meter, planner, leave, `online only`) is the unchanged subset of those sections, not the sections.

Following makes the hole concrete. LLP 3000.013 §3.3 and the language card admit per-reader materialization only for sources that are explicitly `sync public`. A `using (true)` policy does not, by itself, set `Sync { audience: Public }`. The printed `following` view cannot be admitted on the engine this RFC refuses to change.

**Smallest change.** Add `snapback_sync` and `snapback_horizon` to §3.7. Default sync to absent, matching the engine. Require the pinned SQL program to carry every `sync` line in the fixture, with no horizon unless the Quarry side has one. Delete the sentence that makes §4–§5, as a whole, the runtime of record. Say instead: Snapback 4's current log, admission, `complete`, and predictor, as LLP 4000 §4.2 (the unchanged log), §4.5, and §5 describe them.

## 3. What is not Postgres

**High — §3 intro, §3.2, §3.3, §3.7.** The non-standard list is not complete, and several standard-looking forms do not mean what a Postgres reader will think they mean.

§3.7 is missing, at least: `old` / `new` in policies; incremental and per-reader meanings of `MATERIALIZED VIEW`; views running as the viewer rather than the owner; an unread cursor argument turning a function into a page; `RAISE EXCEPTION 'CODE'` using the message slot as an application code (plpgsql puts that string in the message and sets SQLSTATE `P0001`); `written by`; `snapback_sequence(column)` and the shared counter; the generated maintain column; `snapback_cap` as a cross-row check; immutability inferred from policies; `check (x in (…))` becoming an enum; `current_principal()` as distinct from `current_user`; `language sql stable` as the query bit; `cron.schedule` captured out of a `SELECT` as a declaration; client-minted `snapback_id` rather than a uuid default; millisecond durations rather than `interval` (a day is not always 86,400,000 ms in Postgres, and it is in Quarry). Policies apply with no `ENABLE ROW LEVEL SECURITY` and with no owner bypass. In Postgres a policy does nothing until RLS is enabled, and the owner bypasses it unless forced. A Supabase builder's first test of §3 against a real Postgres will show every row.

The sentence "a file that uses only the standard subset is a valid Postgres schema" is true and covers no program in this bet. The Clique file cannot be written in that subset.

Would a Supabase builder recognize §3? Not as the file that scored 94. That file is tables, checks, foreign keys, indexes, a sequence, a trigger, and a `jsonb` function. §3 is RLS on every command, `snapback_` types on the columns, a materialized view where that lane used a trigger, and a history function that ignores its page argument. They would recognize `CREATE TABLE`, `CHECK`, `REFERENCES`, and `cron.schedule`. They would not recognize the file as their backend.

**Smallest change.** Split §3.7 into "parses as Postgres but does not mean Postgres" and "does not parse as Postgres." Put the cursor, materialized views, view rights, `RAISE`, RLS-without-enable, and `old` in the first. Put `written by`, sequence typmods, generated maintains, and sync in the second. Delete the claim that everything outside the table is Postgres.

## 4. The four hard places

**Medium — §5.** One of the four is stated accurately, two are narrower than the engine, and "they cost less" has no test.

Completeness. The printed sentence matches `N_NEVER_COMPLETE`: a policy that reads a column the scan does not pin is never complete, because a hidden row must not show up as a short page (the reads card; LLP 3000.007 §5.6). That is one class. The same card also has meter cuts, `N_NO_CURSOR`, expiry, non-uniform search, and merges. §5.6's cursor rule — `next` never sits on a hidden row — is not restated. An RLS user knows a policy hides rows. They do not know the result is `complete: false` rather than a last page. The familiar frame does not contain this bit, so "RLS builders know this" overclaims the example that was restated correctly.

Device admission. The three shapes plus `snapback_readable` match the invertible rules, with the gaps in the table above: service-grant disjuncts still sync, `through` is only a top-level conjunct (LLP 4000 §3.3), and a legal shape with no `sync` line is still online-only. "A join-shaped policy" is not the only refusal. `.col = viewer or exists other` is not a join and is already refused.

Mutation subset. "Refusing `execute` and exception blocks" is the right LLP 0329 constraint and is not a restatement of Quarry's mutation statements. Quarry has assignment, accumulators, domain `count`, `exists` conditions, and point writes. The subset omits those and admits range `update`/`delete`. It is a different language that happens to share some keywords.

`now()`. "A condition that depends on `now` is never proven on the device" matches LLP 4000 §4.5 rule 6, and the presence exception for `send` matches rule 8 if the members loop is a complete capped group. Two holes. A column `default now()` is `ColumnDefault::Now`, not a predicate; `createPost` must still predict, and an implementer who rejects every `now()` will stop it. The 94 lane wrote `clock_timestamp()`, which is not `Input::Now` and is not mentioned. The edit example's `now()` sits in a policy that cannot be lowered, so the sentence describes a program §3 cannot compile.

"They cost less in a familiar frame" is not given an instrument. §8 expects completeness, prediction, and bounds to stay, and compares phrase counts. A count cannot show that the same fact costs less. It can show that it is still mentioned.

**Smallest change.** Label the completeness paragraph as the unpinned-policy case only. Point device admission at `infer_audience` plus service grants, not at "joins." Define the mutation subset as the Quarry statement list, including the fan-out rule the engine already enforces. Say `default now()` predicts and `clock_timestamp()` is refused. Drop "cost less" or add a classifier count for those four classes, treatment versus control, as a reported comparison rather than a vibe.

## 5. The pre-test and the evaluation

**High — §7.** The one-day read is not a test of the premise.

The question is whether a pinned translation "reads as SQL you already know." LLP 0329, which §1 cites for the subset, already recorded the answer to that kind of test: the familiar profile removed syntactic friction and finished worse, and the friction that costs milestones is behavioral. Reviewers reading an admitted file never meet `E_SQL_UNSUPPORTED`. The stop rule ("if §3.7 or §3.5 feels foreign") trips on clauses the RFC has already defined as foreign, and it has no count threshold. The translation is written by one session that has read this RFC, so it will avoid the awkward forms. The judges are blind; the author of the spelling is not. And the translation cannot be line-for-line until the Blocker table has a row for every fixture form. Run now, the families are grading §3's showcase, which does not parse.

**Smallest change.** Keep the gate. Change the task. Freeze the form table first. Give three families the brief, the subset card, and no Quarry source, and have them write the Clique program. Pre-register a stop if any fixture form has no spelling, or if a form that appears in the 94 lane's `schema.sql` (trigger, GIN, partial index, window function, `jsonb` body, sequence) is required and refused. Recognition of a prepared file does not gate anything.

**High — §2 versus §8, and §8's reading (A).** The comparison can pass without the bet being true, and fail without the familiarity claim being false.

§2 says the comparison is two spellings of one pinned program. §8 says that program is supplied to no lane and each builder writes their own, as the brief requires. Both cannot be the measurement. Lanes that write their own programs confound spelling with which product rules they managed to express. A `data_modeling` move is then not attributable to the language. An `offline_sync` floor failure is attributable to a missing `sync` line even if the SQL felt familiar.

Reading (A) holds when the treatment's LANGUAGE count is zero in every paired run and its total learning-cost count is at or below the control's. LANGUAGE, as §8 defines it, is Quarry, Quarry syntax, spreads, shapes, and views-as-a-language. A SQL builder does not write those words. Zero is the default, not a finding. LLP 4000 §9.1's clause that zero in both arms is not evidence is not carried over. If this year's control also stops saying "Quarry," both zeros and a total that merely does not rise pass the bet. `data_modeling` is reported and not gated, so the motive in the summary is not in the verdict. The bet passes on a not-distinguished clock, correctness, floors, and a tautological language count.

The subset clause is the real test and it is aimed one step off. SQL-SUBSET must exceed the control's LANGUAGE count. If the control mentions Quarry twice and the treatment mentions restrictions twice, the charge moved and reading (A) still holds. "Restricted joins" was counted as language in the Opus list; the same sentence in a SQL note can be filed as bounds, which §8 says is expected to stay, and then it does not count as subset either.

A false failure is just as available. Correctness and the `offline_sync` floor fail if the SQL program is not the Quarry program (no sync, no `NOT_FOUND`, digest unexpressible). That falsifies "this surface builds Clique," not "a familiar frame is cheaper." §10 only names the subset inequality as falsifying the bet. Those are different claims and should stay different. Dropping the delivery load is sound only after sync is the same IR on both arms. Until then the engine is not unchanged in what a device receives.

The inherited pieces that should stand do stand: 110 assertions, holdouts, native artifacts, the third-family classifier, serial N = 3, the 25-minute rule, floors, published packages, "not distinguished never ships."

**Smallest change.** Before any lane, the pinned SQL program must lower to the same schema and the same prediction facts as the pinned Quarry program (`check` and `why` on both, committed by hash). That is the equivalence gate. Lanes still write their own programs. Reading (A) should define LANGUAGE as authoring-surface complaints, not as the word Quarry; require SQL-SUBSET to be strictly smaller than the control's surface complaints; require the stayed classes not to rise; and record "no surface charge in either arm" as not supported, as LLP 4000 §9.1 already does. Keep 94 off the verdict.

## 6. Cost and sequencing

**High — §4 and §9.** The happy path for tables and simple selects is a bounded front-end. The project described here is not, and the pipeline sentence points at the wrong intermediate.

The binder does not consume `ir::Program`. It consumes the Quarry declaration AST and emits `ir.rs` plus the schema. "Lower SQL AST to `ir.rs`, then run the binder" is not a pipeline. An implementer who follows it will reimplement admission, rule lowering, index synthesis, and prediction, which is a second binder, or will "bind" IR the binder cannot read. The bounded design is: lower to the existing declaration AST (or the binder's decl structs) and run the unchanged binder. Anything the binder then refuses is a SQL rewrite, not a new engine rule.

`sqlparser` in the Postgres dialect will not parse this language. Function bodies arrive as dollar-quoted strings, not as plpgsql statement trees. The mutation subset, the jobs, and the schedule commands need their own small parser. `written by`, `snapback_sequence(conversation_id)`, and the generated column do not parse as Postgres, so the showcase never reaches that second parser. The crate is the right DDL parser only after §3.7 is a specified dialect extension in front of it.

The unbounded work is the refusal surface, and that surface is the bet. `sqlparser` accepts triggers, `GRANT`, `ALTER`, `security definer`, `DO` blocks, GIN, and window functions. Each needs a pasteable rewrite to the nearest admitted form. §9 puts that in lane (d), after the happy path. Lane (d) is what builders hit. The guide lane ("the same cards, every example in SQL") is a corpus translation: the language card alone still teaches `sync last N`, `update … if`, shapes, `predicts`, and `chunk`, and the guide tests compile Quarry. A 300-line first account is the W14b README budget and is fine. It is not the guide.

What a competent implementer will build wrong from this text:

- A second binder over `ir.rs`, or a string-replace of Quarry rewrites into "SQL."
- A trigger that updates `like_count`, because that is how the 94 file maintains a counter and §3 gives them no column form.
- `date_trunc` for `day()`.
- A join aggregate that recomputes `post.author_id` on read, instead of a recorded field.
- Immutability taken from the absence of an update policy.
- `USING` applied as `WITH CHECK` when `WITH CHECK` is omitted, which is Postgres and is not Quarry's single `(old, next)` predicate.
- Every `FOR` loop chunked, so the digest's per-profile totals split across commits.
- The magic cursor applied on top of a keyset `WHERE` the author also wrote.
- `RAISE EXCEPTION 'HANDLE_TAKEN'` stored as the message.
- `now()` inside `cron.schedule` frozen at definition, or rejected inside `default now()`, so inserts stop predicting.
- One sequence object per column, instead of one counter per parent shared across tables.
- Admissible policies implied as `sync public`, so the control and the treatment deliver different partitions.
- `min`/`max` and `<=` inside rules added to `snapback4-core`, because the showcase needs them and the bet forbids engine changes.
- Lane (a) inventing spellings for `written by` and sync that lane (b) cannot carry, because §9 starts the compiler before the form table exists.

**Smallest change.** Rewrite §4's pipeline as SQL AST to Quarry declarations to the existing binder. State that plpgsql is a separate grammar over the admitted statements only. Make the fixture-to-IR table the entry ticket for every lane. Exit criterion for lanes (a)–(c): the pinned pair agrees on schema, plans, and `why`. Cut the guide lane to the cards those forms use, after the spellings are frozen. Forbid a lane from growing `RuleExpr` or `MaintainKind`.

## 7. Answers to §11

1. **Postgres only.** The prior the Astra note describes is Postgres, and a second SQLite authoring dialect would split the subset without buying that prior. Keep the engine's SQLite `sql` verb as inspection. Say in the RFC that "Postgres" means the dialect you parse, not "SQL a Postgres server will run." Triggers, GIN, window functions, and `clqfa_mutate` are Postgres, and they are out.

2. **The pre-test gates compiler work. This pre-test does not.** Do not run it in parallel, and do not run it as specified. Gate on the writing test in finding 5, after the form table is frozen. A parallel compiler lane will lock in spellings the pre-test was supposed to be allowed to kill.

3. **A separate `snapback5` package.** Protocol rule 6 (published-surface fence) makes a source checkout diagnostic-only, and a `--sql` mode of `snapback4` puts the treatment in the control's CLI. Publish the two arms as two packages from one commit. A mode is reasonable only after the bet passes.

## Verdict

**NOT READY.**

The direction worth keeping is a CLI front-end, the engine left alone, Quarry as the control, and an explicit subset class so a moved charge is visible. This draft is not that experiment yet. The illustrative program does not parse and does not lower; the committed Clique program has no spelling for sync, identity, coded uniques, formats, dotted and calendar aggregates, in-table counts, `socialProfile`, `insights`, or the digest; §3.7 presents Snapback semantics as Postgres; and the verdict can pass on a language count that SQL makes zero by default. A revision that is only a form table, an honest §3.7, a corrected pipeline, and the equivalence gate on the pinned pair is a different review. This text is not ready to build.
