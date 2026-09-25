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


---

## Round 2 — revision 2 (`9bc2ea9c83`), 2026-09-25

**Mode:** blind delta review, read-only, over a detached worktree at that commit; `grok -p … -m grok-4.7 --reasoning-effort xhigh --disable-web-search`. **Brief:** `~/projects/snapback-sb5-reviews/4001-r2.brief.md` (reproduced in the Opus round-2 section).

### Verbatim review

I'll review revision 2 against the three round-1 reviews and the sources those reviews depend on, without changing anything. Starting with the round-1 reviews, then the RFC and the diff.The three round-1 reviews and revision 2 are loaded. Next I’ll check the form table against the Clique target, the binder, and the cited LLPs rather than taking the dispositions at their word.Revision 2 of LLP 4001 at `9bc2ea9c83` is **not ready**. The premise, the runtime, and the pipeline's direction are now right. The normative table is not: several of its own spellings do not parse on Postgres 17, several lowered forms do not bind, calibration #19 still has no rows, and the new gate, pre-tests, and null rule can all come out the right color for the wrong reason.

Checked against the three round-1 reviews, `intent-clique.q`, #19's `schema.q` / `chat.q` / `insights.q` / `config.q`, the Quarry AST and binder, `print.rs`, LLP 3000.007 §5–§6, LLP 3000.009 §6.2, LLP 3000.013 §2.1, LLP 3000.015, the Supabase lanes under `~/clique-full-20260905/lanes/`, and a throwaway Postgres 17.10. Nothing was changed.

## What is now sound

The premise is stated as the question the record actually supports. Unrestricted Postgres scored 94 with no policies; the RLS-and-RPC lane scored 85; five of the eight "language" phrases name restriction; #19's note names no language item; LLP 0252's familiar profile finished worse. Opus's "within noise" expectation is written down beside the bet.

The runtime is Snapback 4's. LLP 4000 §4–§5 are no longer the runtime of record; §13 of that document now says so. Unpublished means online-only, which is §6.1, and a published table whose select policy does not invert refuses with `E_SYNC` instead of a silent downgrade.

The pipeline points at the right intermediate: Postgres AST to `ast::Document`, then text, then the unchanged `snapback4` binary. `pg_query` belongs in the CLI only. Mutations are volatile functions and jobs are procedures. `union all`, security-invoker views, per-reader materialized views, zero groups, cursors kept out of `WHERE`, non-recursive probes, `service_role` versus ignored `authenticated`, array `once` keys, and period-plus-offset cron with engine-supplied bounds are the right contracts. `latest` and maintained `min`/`max` are gone. `through` and `after insert` are explicit gaps. A zero surface charge in both arms supports nothing. The clock neither passes nor fails. Passing a pre-test is permission to build, not confirmation.

## 1. Disposition table

| §12 row | Verdict | Where it is real, and the gap |
| --- | --- | --- |
| Premise overclaims | **Real** | Summary and §1. Residual, Low: LLP 4000 §13 still says this bet "targets the item the record names most" and "the only surface this grader has scored at 94." |
| Runtime was LLP 4000; no `sync` | **Partial** | §2 and the corrected §13 name Snapback 4. `alter publication snapback add table` parses, and absence meaning online-only is the right default. The horizon and recipient spellings do not parse (finding 1). |
| §3 cannot spell the target | **Partial** | The fixture's simple tables, policies, union, and point writes have rows. The table does not cover #19, and §9 step 2 cannot verify the LLP 3000.015 rows (findings 1–3). |
| Policy grammar, `old`, recursion, roles, omitted `WITH CHECK` | **Partial** | §3.3's operator list matches `rule_expr`. The update-policy row contradicts itself, and Muse's real transition trigger does not fit the admitted trigger (finding 4). |
| `min`/`max`, `latest`, in-table counts | **Real** | `latest` is withdrawn. `generated always as (snapback.count('likes')) stored` parses against an immutable stub and lowers to `count likes`, which the binder infers when there is one reference. No spelling for an explicit `by`, a filter, or `sum of`. #19's in-table counts happen to be inferable. |
| Recorded attribution, `day()`, zero groups | **Real** | The three rows are the right Quarry forms. Unstated bind-time requirements: the reference and the target column must be immutable, and the target table must be public (`maintains.rs`). |
| The three additions | **Partial** | The headlines are in §3.2 and §3.4. `sequence(col)` is rejected even after a domain stub. None of the three lowered forms parse in today's binder, and §9 verifies the table before LLP 3000.015 lands (finding 2). |
| Views, shapes, Following | **Partial** | The bijection, `union all`, the nullable subselect, and `E_FEED` are real. #19's `messageCard`, inline shapes, and `online only` maintains have no row (finding 3). |
| `socialProfile`, `insights`, cursor, `%type` | **Partial** | The cursor rule is real. `%type` does not carry a reference. `for d in a..b` is the wrong range (finding 5). |
| DML, `:=`, jobs, schedules, `once` | **Partial** | The statement list and `create procedure` are real, and both parse. `where <key> and <cond>` cannot produce both `NOT_FOUND` and `E_CONFLICT`. Program-level `exists` is still not in the expression subset (finding 6). |
| SQL value semantics | **Only asserted** | "By guard insertion" is not three-valued logic, and it fights the equivalence gate (finding 7). |
| §3.7 incomplete | **Partial** | The three-way rule is the right rule. Category A is false for `image(N)`, `sequence(col)`, `snapback_words`, and the `WITH` reloptions. `ENABLE ROW LEVEL SECURITY`, owner bypass, and `FOR ALL` policies are still missing. |
| Immutability via `GRANT` | **Partial** | The inference bug is gone. `GRANT UPDATE (cols)` is not immutability (finding 8). |
| Silent downgrade | **Real** | A published non-invertible select policy is `E_SYNC`. Horizons remain finding 1. |
| Pre-test measured reading | **Partial** | Two tests exist and reading gates nothing. Both stop rules can be satisfied without the premise being true (finding 9). |
| Comparison passes by construction | **Partial** | Surface class, masking, a registered `data_modeling` prediction, floors, one fail rule, and a maturity gate are all in §8. The bet can still pass without being true and fail without being false (finding 10). |
| Wrong lowering target; `sqlparser`; diagnostics | **Partial** | The target is `ast::Document`, and the diagnostic tier is a real bound. `print.rs` does not print a document (finding 11). |
| LLP 3000.009 §6.2 | **Partial** | The row and the sequencing exist. §6.2's Quarry form is `query …: sql reading … returning …`, not "the server-only read," and §3.5 both requires a marker and auto-promotes anything that fails to lower. |
| One spelling, one code, `api.ts` names | **Partial** | CamelCase `api.ts` is decided. The code family is real. Canonicalization is still an open question, and it is not limited to aliases (question 4). |
| Evidence rows overstate | **Real** | §1 now has the overlap, the full #19 note, 82→90, and the parallel lanes. |

## 2. The form table

Postgres 17.10, with the `snapback` and `auth` stubs the RFC describes, accepts `snapback.identity`, `snapback.effect`, `snapback.count` in a `stored` generated column, `snapback.written_by` in a check, `comment on constraint`, `create policy`, `union all`, `security_invoker`, a materialized view, `create procedure`, and `posts.id%type` in a signature. It rejects the spellings below.

### Rows that are wrong

**Blocker — §3.2 residency row.** `alter publication snapback add table profiles2 with (snapback.horizon = …, snapback.recipient = …)` is a syntax error at `with`. `alter publication … set (snapback.horizon = …)` is a syntax error at the dot. Publication parameters are not reloptions, and stubs cannot create grammar. #19's `sync to members[.chat] last 10000 by .at` and `sync to .principal` therefore have no spelling. The bare `add table` half of the row is fine, and so is the default.

Smallest fix: keep `add table` as "sync, audience inferred." Spell the horizon and the recipient as calls the parser already accepts, for example `select snapback.horizon('messages', 'last 10000 by at')` and `select snapback.recipient('pairs', 'principal')`, lowered to `SyncDecl.horizon` and `SyncAudience::Column`. Pin that the index name is the one the binder already checks.

**Blocker — §3.2 `image` / `video` and `sequence` rows.** A domain stub does not make these execute. Postgres 17 reports `type modifier is not allowed for type "snapback.image"` and the same for `snapback.sequence(conversation_id)`. Category A's sentence that "domains and functions" make category A parse is false for both. `using snapback_words` fails with `access method "snapback_words" does not exist`, which SQL cannot stub. `with (snapback.retain = …)` and `with (snapback.expire_at = …)` fail with `unrecognized parameter namespace "snapback"`. §9 step 2, as written, cannot go green.

Smallest fix: move every Snapback fact that is not legal Postgres after those stubs to a `select snapback.…` call or a `comment on`, and delete the typmod and reloption spellings. Keep `snapback.id` and `snapback.cursor` as domains; those two succeed.

**High — §3.2 `grant update (cols)` row.** The statement parses once the role exists. It does not mean the complement is immutable. `GRANT` adds a privilege for one role; the owner keeps every column; no grant does not revoke anything. The lowering drops the role, so `to authenticated` and `to service_role` become the same global constraint, including for jobs. A second table-level `GRANT UPDATE` is unspecified. Following and recorded paths then depend on an accident of which columns were listed.

Smallest fix: a marker call, `select snapback.immutable('posts', 'author_id', 'parent_id', 'at')`, lowered to `TableDecl.immutable`. State that it binds every writer, including jobs.

**High — §3.3 update-policy row.** The cell says an omitted `WITH CHECK` applies `USING` to the next image, and also that `USING` alone lowers to a transition over `old`. Those are different rules. Muse's `msg_upd` supplies both `USING` and `WITH CHECK`; that combination has no lowering. `FOR ALL` parses and is not in the table.

Smallest fix: one sentence. `WITH CHECK` alone lowers to next-image `update <-`. `USING` alone lowers to `update (old, next) <- expr(old) and expr(next)`. Both clauses lower to `expr(old) and expr(next)`. `FOR ALL` is four policies.

**High — §3.3 trigger row.** `execute function snapback.transition($$…$$)` parses. Postgres does not parse the string. The only expression language that binds is `rule_expr`, which has no `<=`, no `now()`, and no assignments. Muse's `enforce_message_windows` writes `NEW.edited` and compares `extract(epoch from now() - OLD.created_at)`. It is refused by the row that was added to admit it. Two such triggers AND, while permissive policies OR. That combination is unstated.

Smallest fix: say the string is a second grammar, limited to a boolean expression over `OLD`/`NEW` that binds as `update (old, next)`, and that it cannot assign `NEW`. Put time windows in `raise`, as §5 already says. Give multiple triggers the same `OR`/`AND` rule as policies.

**High — §3.5 `%type` row, marked ✓.** On Postgres 17, `post_id tpol.id%type` parses and is an `integer`. `%TYPE` copies the type. It does not remember `tpol`. The same spelling cannot separate #19's `id: id` (a new id), `post: posts` (a reference), `owner: principal`, and `parent: posts ?`.

Smallest fix: mark the row ≈. `posts.id%type` lowers to a reference only by a documented Snapback rule. Spell bare `id` as `snapback.id`, `principal` as `snapback.principal`, and optional refs as `posts.id%type default null` with the nullability stated. Add those three rows.

**High — §3.5 `insights` row.** Quarry `range(a, b)` is end-exclusive (`LoopDomain::ExpressionRange { end_exclusive }`). PL/pgSQL `for d in a..b` includes both ends. `range(day(now) - 6, day(now) + 1)` is seven days; `a..b` as written is eight. The difference cell is empty. `json_build_object` is not the control's typed object, so `api.ts` is not the control's.

Smallest fix: lower `range(a, b)` to `for d in a..b-1`, and say so. Return a declared composite, not json, or withdraw the "identical `api.ts`" sentence for these two queries.

**High — §3.6 conditional update row.** `UPDATE … WHERE key AND cond` affects zero rows both when the row is missing and when `cond` is false. The writes card requires `NOT_FOUND` for a missing or unreadable target and `E_CONFLICT` when the row is readable and the condition is false. One `WHERE` cannot do both without a pre-read, and the pre-read is what changes prediction. The row asserts the outcome and omits the read.

Smallest fix: specify the pre-read and the disclosure rule (unreadable target stays `NOT_FOUND`), or refuse `AND cond` and spell the condition as a preceding `if`, accepting that this form is not Quarry's `if`.

**High — §3.7 expression subset versus the fixture's toggles.** The subset lists comparisons, arithmetic, `is null`, `in (select …)`, and a short builtin list. It does not list `exists`. `setLike` and `setFollow` are `else if exists`. §3.3's probe grammar does not apply inside a function body.

Smallest fix: add `exists <key probe>` to the expression subset and name it in the §3.6 grammar.

**Medium — §3.4 recorded and Following rows.** The lowered Quarry binds only when the hop is immutable and the target is public. The difference cell says the capture differs from a join, which is true, and not that the view is refused without those two facts. `day(.at)` has no offset form; #19 does not need one.

Smallest fix: put the two bind conditions in the difference cell.

**Medium — §3.5 server-only row.** LLP 3000.009 §6.2's form is `query name(…): sql reading <relations> returning …`. The row lowers to "the server-only read" and also says any unlowerable read-only function becomes one. Those are two mechanisms. The second one empties the refusal bucket in pre-test 1.

Smallest fix: the marker is the only door. A function that fails to lower is refused, with a rewrite that names the marker.

### Forms in the committed target, LLP 3000.015, or #19 with no row

From #19, each of these is used and none is determined by an existing row:

- `fn` helpers (`editWindow`, `receiptState`, `otherProfile`, `unread`, `reactionList`). A `stable` function is a client-callable query under §3.5, so these would appear in `api.ts`.
- `mutation edit(…): server` and `deleteMessage(…): server`.
- `insert <- created chats[.chat]` and the same on receipts. §3.3 mentions `snapback.created` in prose and has no row.
- `merge feedEvents after c last 20 by byActorTime`, and the named index `by byActorTime` that `create index` refuses.
- `view postTotals: … online only` on the maintain, not on a table. Without it, #19's aggregates sync and the control's do not.
- `sync to .principal` (`pairs`).
- `cap 50 by chat, message` and `cap 1 by principal`. The shown `snapback.cap` takes one column.
- `group(rows, 'emoji')`, `first(...)`, `slice`, `count(text)`, `video.duration`, `now + 4s`, `??`, and `a if c else b` inside `messageCard`. Category C refuses `coalesce` and `case` outside "recognized shapes," and no shape is recognized.
- List arguments, `ids: [messages] <=50`.
- Argument types `principal`, bare `id`, `posts ?`, and `text 3..20 format handle` (`socialProfile`, `saveProfile`).
- Point returns that are not `! else NOT_FOUND`: `me`, `chat`, `postDetail`, `pair`.
- Inline and nested shapes: `inbox`'s `{ *, conversation, other, unread }` and `quoted: messages[.quote] { body, senderProfile }`.
- A qualified schedule target, `insights.daily`.

From the fixture, additionally: `parentId = null` has no row (finding 7). From LLP 3000.015: the three rows exist but do not bind on this binder, and §9 step 2 runs `snapback4 check` before step 5 lands the spec. The spec's owner-may-patch-without-an-update-rule, `E_FIELD_AUTHORITY`, supplied-value refusal, and the pending-recount contract (meter-sized range in the writer's transaction, otherwise `complete: false` and a background recount) are not in the difference cells. "The pending recount is stated" is the claim, not the contract.

`through` and `after insert` are marked ✗. That is correct. They are not in these three programs.

## 3. New defects

**High — finding 7, §3.7 and §11 question 5.** Guard insertion does not implement SQL's three-valued logic. `NOT (parent_id = $1)` when `parent_id` is null: SQL yields unknown and the row drops; `a = b AND a IS NOT NULL` made false, then negated, yields true and the row stays. SQL `CHECK` treats unknown as success; a guard treats it as failure. The pinned programs test nulls with total equality (`parentId = null`, `parent != null`). Quarry `col != null` already matches `IS NOT NULL`. Rewriting the pinned `= null` into guards makes `print` disagree with the pinned program, so the equivalence gate fails on the program it was built for. Leaving `= null` total makes the gate green while every other nullable `<>` differs.

Smallest fix: do not insert guards. Lower `IS NULL` and `IS NOT DISTINCT FROM` to Quarry's total `=` / `!=`. Rewrite the literal patterns `col = null` and `col <> null` to those. Refuse `=` / `<>` when either side is a nullable column. That is a §3.7 difference, and it is the whole difference.

**High — finding 9, §7.** Both stop rules can be met while the restricted surface is the wrong one.

Pre-test 1 counts "statements," and a mechanical rewrite is defined only by the word "canonicalization." Every refusal in §3.7 already has a rewrite, so a classifier can move `CREATE INDEX`, triggers, and `insert … select` into "admitted after a mechanical rewrite," or mark unlowerable reads server-only, and the one-third line never moves. The named-construct clause fires only when the construct is refused in all three lanes. Astra's SQL has triggers and no policies. Grok's `schema.sql` has indexes and no policies. Muse is the only lane with a membership policy, and that policy calls `is_member`, whose body has `left_at is null` and is not an admitted probe. "Refused in all three" is false because two lanes never wrote it. The same is true of the feed read, which lives in application code on the 94 lane. One third is the wrong kind of threshold until server-only counts against it and the corpus is a named file list. The non-`attempt1` lanes on this host are about 1,700 lines, close to the cited 1,690; including `attempt1/` doubles Muse and moves the denominator.

Pre-test 2 stops only when SQL is strictly worse than Quarry. A tie at one-out-of-five passes. The five scenarios include a 10,000-message mark advance and an edit window that the messaging half may not contain. Families holding the SQL card can avoid every refusal the card lists. That tests whether the card is complete, which is useful, and it does not test a Supabase prior. The threshold "not worse than Quarry" is the right bar for a stop and the wrong bar for the premise. §7 already says passing is permission, not confirmation. The hole is that permission is cheap.

Smallest fix: name the files. Count server-only toward the third. Define a mechanical rewrite as a renaming that `print` cannot distinguish, and nothing else. Fire the named-construct stop when Muse's membership policy, Muse's counter trigger, or Muse's `enforce_message_windows` is refused, without requiring the other lanes to have written them. On pre-test 2, stop on a tie below a registered floor (four of the five scenarios), and publish the expected answer with each scenario.

**High — finding 10, §8.** The bet can pass without the restricted surface earning the familiarity credit. `data_modeling` mean plus 3, with surface and total learning-cost merely equal, passes. Three is asserted as "one scorer sd" and is not in LLP 4000. The only multi-scorer cell §1 cites for this lane is 94 / 86 / 85. Equal surface counts do not show that restriction got cheaper; they show that the phrase count did not rise. The relief valve makes the arm less restricted and can raise `data_modeling` while the surface class stays quiet. The mask list (`Quarry`, `SQL`, `policy`, `plpgsql`, `rule`, `view`, `sync`, `publication`, code names) leaves `RLS`, `trigger`, `auth.uid`, `:=`, `procedure`, `generated always`, and every code block. "Paired run" is not defined.

It can also fail without the claim being false. Reading (A) must hold in every paired run, so one phrase fails N = 3. The floor set adds `queries_and_live`, `offline_sync`, `writes_and_transactions`, and the holistic score on top of the three language-relevant categories. The holistic floor reintroduces the clock that §8 says neither passes nor fails. A control mean and sd estimated from three runs is not a stable floor.

Smallest fix: keep the directional prediction, and require the surface count to be strictly lower, not equal, if the mechanism is part of the pass. Drop the holistic score from the floors. Mask syntax, not only tokens, or drop the blindness claim and use a third family that is allowed to know the arm. Define a pair as run i against run i in a registered order. Cite the sd or stop calling 3 one sd.

**Medium — §10's second sample.** The equivalence gate is one pair. §10 says the blind-writing programs, lowered and checked, are the second sample. §9 runs that writing test before the compiler exists and never says those sources are frozen and re-lowered when the compiler lands. A lossy printer greens "byte-identically under `print`" whenever both sides are printed by it. `check` and `why` on the original Quarry catch a loss only when they surface the dropped clause. Immutable columns, refusal messages, and `residency.inferred` are easy to drop and easy not to notice.

Smallest fix: freeze the pre-test sources and require `check` and `why` on their lowering before any counted run. Say that `print` means a document printer that round-trips every clause `snapback4 check` observes, not `print::expression`.

## 4. The pipeline

The shape is bounded and the direction is correct: `pg_query` to `ast::Document` to source text to the unchanged binary. The binder consumes documents (`lib.rs`, `compile` → `parse_document` → `bind`). It does not consume `ir::Program`.

It is not yet correct as written. `print.rs` prints expressions, reads, and scalar types for diagnostics. It has no document printer. §1's evidence row says it "prints a document back to Quarry." That sentence is false. "Byte-identically under `print`" is not a check that exists until someone writes a round-trip printer. That work is bounded by the forms in §3 only after those forms are real.

`pg_query` does make "this text is Postgres syntax" mechanical for ordinary DDL, policies, views, and function bodies. It does not make §3 legal. The publication `WITH` clause is rejected by the grammar. The trigger condition, the cron command, and `snapback.transition`'s argument are strings, not plpgsql statement trees. `parse_plpgsql` will not see them.

A competent implementer will still:

- call `print::expression` and treat the result as a program;
- attach spans to the AST, then hand printed text to `snapback4`, whose parser assigns new spans, so the span map points at nothing;
- lower `USING` both as next-only and as an old-image transition, because §3.3 says both;
- treat `%TYPE` as `ArgType::Ref`;
- insert `IS NOT NULL` next to each comparison and break `NOT`;
- read `GRANT UPDATE (cols)` as a role-scoped privilege and also as a global constraint;
- imply `sync` from an invertible policy when the publication line was forgotten, which is the default flip §2 just forbade;
- chunk every `FOR`, including the digest's inner loops;
- auto-promote a failed read to a server-only SQL read;
- lower `for d in a..b` inclusive;
- emit one sequence object per column;
- use `timestamptz` for Quarry `time`, so `readAt: time default 0` and `periodStart` change type;
- resolve a PL/pgSQL name to the column when a parameter has the same name. The pinned `handle` argument against `profiles.handle` is the case.

Pin the `pg_query` crate and the Postgres major version. Add the document printer to lane (a)'s exit, with a round-trip test on `intent-clique.q` before any SQL is lowered.

## 5. §11, questions 4–7

**4. Canonicalize aliases. Do not canonicalize meaning changes.** Yes for `<>` and `!=`, and for `col = null` rewritten to the total null test. No for `UNION` versus `UNION ALL`, inclusive `..` versus `range`, `IN (SELECT …)` versus `exists` (nulls and cardinality), or `COALESCE` versus a point read of a maintain. The ruling should name the alias list. An open "admitted alternatives" permission is how the off-by-one lands in `insights`.

**5. Reject guard insertion.** Keep Quarry's total equality in the lowered program. That is what the pinned programs mean, what LLP 3000.013 §2.1 keeps, and what the equivalence gate can check. Spell it with `IS NULL` and `IS NOT DISTINCT FROM`. Refuse bare `=` / `<>` on nullable columns. True SQL three-valued logic is an engine change, and this bet forbids engine changes. The recommendation in §11 is the wrong one.

**6. `auth.uid()`.** Keep it. It is the name in the lanes that this premise is about. It is not a Postgres built-in: the stub file has to create `auth.uid()`, and category A should say so. `current_user` would be a false friend.

**7. Do not run the pre-tests on this text.** Run them after the table parses on Postgres, lowers through `snapback4 check`, and the stop rules are no longer vacuous, and before any compiler lane. That is later than "after round 2" as this round finds the table. Running them now grades spellings Postgres rejects and a writing card that cannot express #19. Two days spent that way would not show whether Opus's expectation is wrong.

## Verdict

**NOT READY.**

The experiment is still the right experiment: one engine, Quarry as the control, the parser in the CLI, the premise treated as a question, and a pre-test before a compiler. This revision does not yet have a surface the unchanged binder can accept, and its new checks can pass while that is still true. The next edit is the form table, the null rule, the stop rules, and a document printer that actually exists. It is not a lane.


---

## Round 3 — revision 3 (`b1edaa05cf`), 2026-09-25

**Mode:** blind delta review, read-only, over a detached worktree at that commit; `grok -p … -m grok-4.7 --reasoning-effort xhigh --disable-web-search`. **Brief:** `~/projects/snapback-sb5-reviews/4001-r3.brief.md`.

### Verbatim review

I'll review revision 3 against the round-2 findings and the committed Clique, Quarry, and calibration evidence, read-only. First I'll read the three prior reviews and the revision-2 text.Revision 3 is loaded. Next I’ll check the round-2 Opus findings and the diff, then test the form table against the binder and the committed programs.Revision 3 of LLP 4001 is **not ready**. The premise, the runtime, the grant rule, the null ruling's direction, and the gate's oracle are now right. The form table still does not lower the pinned programs, and pre-test 1's stop rule fires on this corpus before it measures anything.

Checked against the three round-1 and round-2 reviews, `intent-clique.q`, calibration #19's four files, the Quarry AST, binder, and guide cards, LLP 3000.007 §6, LLP 3000.009 §6.2, LLP 3000.013, LLP 3000.015, LLP 4000 §9.3 and §13, and the Supabase lanes under `~/clique-full-20260905/lanes/`. The nine manifest files are 1,729 lines, as §1 says. No Postgres server is listening on this host, so the syntax claims below are from the Postgres 17 grammar plus the spellings round 2 actually executed; nothing here was re-executed. Nothing was changed.

## What is now sound

The premise is the question the record supports, and LLP 4000 §13 no longer says this bet targets the 94. The runtime is Snapback 4's. Unpublished tables are online-only. A published table whose select policy does not invert is `E_SYNC`.

`snapback.immutable(...)` is immutability: it binds every writer, including jobs, and no call means nothing is immutable. That matches `Constraint::Immutable`, which has no system-principal bypass. `written by` is exempt, which is what LLP 3000.015 §1 needs.

The pipeline points at the right intermediate: `pg_query` to a resolver to `ast::Document` to a new document printer to the unchanged binary. The equivalence gate compares `snapback4 check --json` of the transpiled program with the **original** pinned `.q`, so a printer that drops a clause no longer passes by dropping it on both sides. Guard insertion is gone. LLP 3000.009 §6.2 is not a relief valve. `using (E) with check (E)` over immutable columns is the single-image rule, `with check` alone is refused, and permissive policies combine per image, so the draft-to-published bypass and the "canonical update admits nothing" bug are closed. `a..b-1`, `row(...)` once-keys, `declare p record`, and `snapback.period_start()` / `period_end()` are the right contracts. The power numbers in §8 match a difference of means at σ ≈ 3 and N = 3.

## 1. Is each round-2 disposition real?

| §12 row | Verdict | Where |
| --- | --- | --- |
| Typmods, reloptions, `alter publication … with`, access method | **Partial** | The facts are calls or checks, and `select snapback.publish(...)` is legal Postgres. `timestamptz default 0` is not (§3.1). `interval '1 day'` on `timestamptz` is a calendar day, not 86,400,000 ms. |
| `grant update (cols)` is not immutability | **Real** | `snapback.immutable`; no call emits nothing; jobs included; `written_by` exempt. |
| Reference columns; `%type` erases the table | **Partial** | §3.1's reference, principal, bare `id`, and scalar rows are real, including "no existence, no `on delete`." `posts.id%type` is stated as a Snapback rule. `[messages] <=50` is still `snapback.id[]` (§3.5), and `default null` on a reference is not said to be `t ?`. |
| Update-rule combination; trigger form; `with check` alone | **Partial** | The formula and the `returns trigger` shape fix the OR bypass and the dead `with check`. A transition with no permissive policy is still the empty disjunction, which is deny. #19's receipts have only `update (old, next)`. The `raise exception 'CODE'` in the trigger body is not in the lowered rule. |
| Policy grammar, service role, recursion, RLS, owner bypass | **Partial** | `is null`, non-recursive probes, `enable row level security`, no owner bypass, and `auth.uid() = 'service:x'` are in. The probe grammar is narrower than `bind_probe` (finding 2). |
| `home`, shapes, `insights`, `trending`, `once`, job `declare`, `period_start` | **Partial** | `home` reads `following`; both trending endpoints are present; `insights` is `a..b-1` and a composite; `once` is `row(...)`. `activity_card(a activity)` does not accept a `following` row, and `coalesce(..., 0)` turns a hidden group into 0 (finding 3). |
| Conditional update, `if absent`, general upsert | **Real** | `where <key> and <cond>` lowers to Quarry `if cond`, whose engine returns `E_CONFLICT` or `NOT_FOUND` (writes card). Targetless `on conflict do nothing` matches `if absent` (null on a readable clash). `do update` is `excluded` only. Residue, Low: the delete row omits the unreadable-target half of `NOT_FOUND`. |
| `exists`, and #19's missing forms | **Asserted** | `exists`, `case`, `coalesce`, `least`/`greatest`, and `: server` are in. The sentence "#19's forms covered or marked ✗" is false (finding 4). |
| Null semantics by guard insertion | **Partial** | Guard insertion is withdrawn. Bare `=` / `<>` / `in` on a nullable operand is refused, and `is null` / `is not distinct from` lower to total equality. `<` `<=` `>` `>=` and `not` of those are still admitted and unspecified (finding 5). |
| No document printer; gate trusts it; resolver; two-level parsing | **Partial** | The printer is lane work. The oracle is the original `.q`. The round-trip test is over every guide `.q`, which includes `route`, `walk`, `decimal`, and `money`, while the printer is specified only for §3. |
| §6.2 is not a relief valve | **Real** | The §3.5 row is ✗. Pre-test 1 has no server-only class. |
| Pre-test 1 idiom clause, units, server-only | **Partial** | The manifest, the per-kind classes, body statements, and per-instance stops are real, and the line count checks out. The idiom stop cannot come back "continue" (finding 6). |
| Pre-test 2 asymmetric, one answer decides | **Partial** | Both cards are frozen, one rubric, the edit window and the mark are required, and there is a margin. A tie passes, and so does SQL worse by 10 points or by 2 of 15. Omission of every other feature is still allowed (finding 6). |
| §8 equality, all-zero, floors, masking, power | **Partial** | Strictly-lower summed SURFACE, a second masked scorer, placeholders, and a blindness check are real, and the power arithmetic is right. All-zero fails the bet rather than being "not shown." The floor set is eight categories, not LLP 4000 §9.3's five, and the trip rate is not stated (finding 7). |
| §9 prerequisites after consumers | **Real** | LLP 3000.015, then the transcript, then the pre-tests, then instruments, then lanes. Pre-test 2's programs are lowered in step 6. |
| Maintain residency default | **Asserted** | The opt-out call exists. The default when it is absent is not stated, and the table default is the wrong one (finding 1). |
| SQL arm still reads Quarry; generated `.q` in the tree | **Real** | §2 and §4: Quarry output is listed under SURFACE, and it is written only to a build directory. |
| LLP 4000 §13; #19's quotes | **Real** | §13 withdraws the 94 sentence. §1 quotes the comparison line and the essay paragraph. |

Not in the table: `snapback5/AGENTS.md` still says LLP 4000 §4–§5 are "the runtime design of record" and that treatment hooks live in feature-gated modules. §2 says the opposite.

## 2. The form table

Rows that are wrong or not the whole difference:

| Row | What is wrong |
| --- | --- |
| §3.1 `time`, defaults | `read_at timestamptz default 0` does not parse: there is no assignment cast from `integer` to `timestamptz`. #19 has `readAt: time default 0` (`chat.q`). `interval '1 day'` added to `timestamptz` is a calendar day. Quarry `1d` is 86,400,000 ms. The cell says both are the Quarry types. |
| §3.1 `effect push` | The illustrated call is 5 attempts, 30s backoff, 1h deadline. A bare `effect push` binds as 8 attempts and 4s backoff (`WorkPolicy::default`, then the effect path forces 4s when backoff is omitted). Copied as written, the row fails the gate on the fixture. |
| §3.2 online-only, applied to maintains | "No `snapback.publish` call" is online-only for a **table** (LLP 3000.007 §6.1). A maintain with no `online only` **inherits** its source's audience and drops the horizon (`bind/schema.rs`, the loop at the `inherited_from` assignment; §6.7). `intent-clique.q`'s `followerCount` and #19's `followerCounts` inherit `sync public`. Emitting online-only fails the gate on the pinned target. |
| §3.2 publish | `select snapback.publish('messages', horizon => '...', recipient => 'principal')` parses. `recipient => 'principal'` is `sync to .principal` only. The target form `sync to members[.chat]` is inference, and the row never says `recipient` must be omitted to get it. Passing it against an `exists members` policy is `E_SYNC`. |
| §3.3 transition, and the combination formula | `(⋁ permissive using)` of no policies is false, so a trigger with no update policy admits nothing. #19 `receipts` and `ephemeralReceipts` have only `update (old, next) <- ...`. Postgres agrees with "no policy means deny"; Quarry does not. The formula does not say which empty case it means. The trigger's `'CODE'` is also dropped: the lowered form is a rule, so the failure is `E_RULE`. |
| §3.3 grammar | Admitted probes are `t.col = <literal>` plus `t.principal = auth.uid()`. `bind_probe` allows any rule term as a residual equality. #19's `exists messages[id = old.message, sender = viewer]` does not fit: `sender` is not named `principal`, and `viewer` is not a literal. `role = 'admin'` does fit. `snapback.created(t, col)` is named and has no row for `created chats[.chat]`. |
| §3.4 `post_card` / `activity_card` | `activity_card(a activity)` and `select activity_card(f) from following f` are different composite types. Postgres will not apply one to the other. `coalesce((select c.count ...), 0)` is 0 when the point read is null. A hidden group is null and must stay null (maintains card: authorized miss is 0, hidden hit and hidden miss are null). The coalesce publishes 0. |
| §3.5 `fn` helpers | The prose says an immutable function is a helper. The row says `language sql immutable`. `receiptState`, `otherProfile`, `unread`, and `reactionList` are block bodies that read tables. `language sql` cannot express them. `language plpgsql stable` puts them in `api.ts`. `language plpgsql immutable` is not Postgres `IMMUTABLE`, and that lie is not in §3.7 B. |
| §3.5 list arguments | `ids: [messages] <=50` is a list of references. `snapback.id[]` is a list of bare ids. `%type` is specified for scalars only. |
| §3.6 job | One top-level `for` over a table is the right sweep, and the inner `declare` exemption is right. A job is a **sequence** of sweeps (jobs card). #19 `backfillFeedEvents` has two top-level loops. The row reads as one sweep. A top-level `for` with a `where` is also a sweep, not an inner loop. |
| §3.7 `substr(s, i, n)` | Quarry `slice(text, start, end)` is 0-based and end-exclusive (`b - a` in `bind/program/expr.rs`). `substr` is 1-based and the third argument is a **length**. "The 1-based offset is stated" does not convert either fact. `substr(body, 5, 10)` lowered by subtracting 1 from the start only is `slice(body, 4, 10)`, six characters, not ten. |
| §3.7 expression subset | `first`, `group`, and `count` of a list are missing. #19 uses all three (`otherProfile`, `findGroup`, `reactionList`, `count(actors)`, `count(body)`). Quarry `count(text)` is `length`, not SQL `count`. `bucket` is a guide form; #19 does not use it. `hour` is listed and unused. |

Rows that are sound, as spellings the binder already accepts or that LLP 3000.015 defines and §9 lands first: identity; principal and reference columns; text bounds and named formats; enums; `unique` and commented codes; `immutable`; `search`; both `cap` shapes (the planner synthesizes the index); `retain` and `expire_at`; generated `count` / `sum` / `sequence` once the baseline exists (the count shape is the one round 2 executed); `written_by`; RLS required and no owner bypass; single-image update canonicalization; `for all`; service grants as `auth.uid() = 'service:x'`; `union all`; Following's admission list; filtered, recorded, and day aggregates, including the immutable-hop and public-target conditions; the zero-preserving unread join and the pending-recount sentence; `online_only` as an opt-out; cursor-per-`return query` with the cursor kept out of `where`; `into strict` / `no_data_found`; `varchar(n)`; `matching`; trending's two endpoints; `: server`; targetless `if absent`; `excluded`-only upsert; point update with the engine's `if`; `require` of a non-null boolean; `row(...)` once-keys; the admitted cron subset; `through` and `after insert` and §6.2 marked ✗.

Forms in the committed target, LLP 3000.015, or #19 with no row and no ✗:

- `group(rows, 'emoji')`, including `.key` and `count(.items)`.
- `first(...)` as a scalar (`otherProfile`, `findGroup`), as distinct from `first N` pages.
- `merge feedEvents after c last 20 by byActorTime`, and the named index that merge uses. `create index` is correctly refused; nothing replaces this name.
- Block helpers that read: `receiptState`, `reactionList`, `otherProfile`, `unread`. Expression helpers (`editWindow(): 60000`) are the immutable-SQL row and only that.
- `count` of a list, and `count(text)` as `length`.
- List of references, `[messages] <=50`.
- `now - m.at <= editWindow()` and `now + 4s` compared with an integer duration. `extract` is refused, and `timestamptz - timestamptz` is an interval, which does not compare with `edit_window()`'s integer. Pre-test 2 requires this edit window.
- Inline nested shapes: `quoted: messages[.quote] { body, senderProfile }` and inbox `{ *, conversation, other, unread }`.
- Two mutually exclusive pages on **one** cursor (`people`'s `if q = ''`). §3.5 gives each page its own cursor argument.
- `created chats[.chat]` / `created messages[.message]`, beyond the bare name `snapback.created(t, col)`.
- A maintain's derived `read` when the line is omitted (maintains card: public source derives `read <- allow`; otherwise every rule field must be a bare group key). §3.4 says read rules "are calls" and shows none.
- Bare `public` with no reason string. The parser supplies `"<table> is public"`. A `using (true)` without `comment on policy` is not said to do that.

`through` and `after insert` are correctly ✗. They are not in these programs.

## 3. The focus list

**Residency spelling and default. High. §3.2 online-only row, §3.4 intro, §3.2 publish row.**

`snapback.publish` replaces the illegal `alter publication … with`. For tables, absence meaning online-only is Snapback 4. For maintains it is the wrong default. `view followerCount: count follows by .followedId` has no `online only`; `follows` is `sync public`; the binder copies that audience and clears the horizon. The same is true of #19's `followerCounts` and `followingCounts`. The opt-out call covers only the views that already say `online only` (`postTotals` and the other five in `insights.q`). An implementer who applies "no call means online-only" to every `create materialized view` ships a different partition, and the equivalence gate fails on the pinned target.

Smallest fix: one sentence. A table with no `snapback.publish` is online-only. A maintain with no `snapback.online_only` inherits, horizon dropped, under the §6.7 rule. `recipient` is omitted to infer and is passed only for `sync to .<column>`.

**`grant update` as immutability. Resolved.** The call is the constraint, not a privilege. No new defect in the replacement.

**`generated always as (snapback.count(...)) stored`. Sound as a spelling, with the bind conditions now stated.** Round 2 executed the no-argument form against an immutable stub. `snapback.sequence(conversation_id)` is the same generated-column shape, and "parent is a reference" matches `E_SEQUENCE_PARENT`. This is category B, not Postgres maintenance. Not a new defect.

**`before update` trigger as the only transition. High. §3.3 formula and transition row.**

The per-image OR and the ban on assigning `new` are right, and they close the round-2 privilege bypass. The empty case is not defined. Concrete program: #19 `receipts` has no `update <-`, only

```quarry
update (old, next) <- old.principal = viewer or exists messages[id = old.message, sender = viewer]
```

Under the formula as boolean algebra, no permissive policy makes the old-image disjunction false, and the trigger never gets to decide. That is Postgres (RLS with no policy updates nothing). It is not this program. The row also turns `raise exception 'MARK_FROZEN'` into a bare rule failure.

Smallest fix: state the empty cases. No permissive policy and no transition denies. A transition and no permissive policy **is** the update rule. Say that this is not Postgres, in §3.7 B. Keep the application code only if the lowered rule is a `require`, not a rule; otherwise delete `'CODE'` from the trigger body.

**`%type` arguments. Partial, still wrong for lists. §3.5.**

Scalar `%type` keeping the reference, the bound, and the format is the right Snapback rule, and it is marked ≈. It does not extend to `messages.id%type[]`, and `parent posts.id%type default null` is not said to lower to `posts ?`. #19's `fetched` and `createPost` need both.

Smallest fix: add those two rows.

**`create procedure` as a job. Mostly sound. Medium residue. §3.6 job row.**

Procedure versus volatile function is the right split, the chunk rule matches the jobs card for a single sweep, and `declare p record` is correctly exempt. #19's backfill is two sweeps. The card says a job is a sequence of sweeps and that a filtered top-level `for` is itself a sweep. The row will be implemented as "the first loop chunks, anything after it is inside the chunk."

Smallest fix: "every top-level `for` over a table, filtered or not, is its own sweep; a `for` above the first sweep is prelude only when it is paged and write-free."

**Null semantics. The ruling is the right one, and it is not finished. High. §3.7 B and §11.5.**

Refusing guard insertion is correct. The pinned programs use total equality (`parentId = null`, `parent != null`), LLP 3000.013 keeps equality total, and real SQL three-valued logic would be an engine change this bet forbids. `is null` and `is not distinct from` are the right spellings, and refusing bare `=` / `<>` / `in` on a nullable operand keeps the gate honest.

The subset still admits `< <= > >=`. LLP 3000.013 makes an ordering comparison of a nullable scanned column **false** on null, not unknown. So `not (expires_at > now())` keeps the null row in Quarry and drops it in SQL. `not removed` on a nullable boolean has the same split. Maintain predicates already refuse ordering of optional columns; the SQL subset does not.

Smallest fix: refuse `< <= > >=` and `not` when any operand is nullable, with the same rewrite, and lower `is distinct from` to `!=`. Do not insert guards.

**Equivalence gate. The round-2 hole is closed. Medium residue. §4 and §2.**

The oracle is the original `.q` through the unchanged binary, with sites stripped, and `why` must agree. A lossy printer fails that comparison. Byte identity of printed text is correctly not the gate.

It can still be green while the arms differ, in two ways that the text overclaims past:

- §2 says residency, plans, and prediction "are identical by construction." That is true of the pinned pair only. The calibration lanes write their own programs. Pre-test 2's programs are checked later; the lane programs are not.
- The pinned SQL is hand-written to hit the pinned Quarry. An off-by-one that the SQL author compensated for (`a..b-1` lowered as if `..` were already exclusive) matches the `.q` and contradicts the table. §10 names "one semantic fixture per ≈ row" and does not say what any fixture asserts.

Smallest fix: strike "by construction" for anything but the pinned pair. Define the fixture as a second `.q` that the SQL must hit, one behavior per ≈ row, before any counted run.

**Pre-tests. High. §7.**

Pre-test 1 cannot be gamed into a pass, and it also cannot come out "continue." The idiom rule stops the bet if any instance of a membership policy, a counter, a transition, or a feed read is refused. On this manifest, all four are refused by §3 itself:

- Muse `is_member` is `security definer` and its body is `left_at is null`. §3.3 says that is not an admitted probe.
- Muse `enforce_message_windows` assigns `NEW.edited` and compares `extract(epoch from now() - OLD.created_at)`. The admitted body cannot assign `new` and cannot call `extract`.
- Muse `bump_counters` and Astra `clqfa_like_counter` are `after insert or delete` triggers that update another table. Category C admits only the `before update` form.
- Muse `feed` is a `security definer` SQL function with CTEs and a keyset `where`. CTEs are refused, and a keyset predicate on a page is refused.

So the stop is entailed by the table. Two days of classification will confirm it. That is not evidence about whether a restricted surface keeps a familiarity credit. The one-third line is honestly labeled an investment threshold. It never gets to decide. The `{{P}}` prefixes mean Muse's files are not executable as listed; a hand classifier can still see the idioms.

Pre-test 2 can pass while the surface is worse. "More than 10 points" and "3 or more of 15" let a tie through, and also a 10-point refusal gap and two missed predictions. The writing task must include the edit window and the mark, and nothing else, so a family can skip search, caps, the digest, and media. The expected answers are "published"; if that means the writers see them, the prediction half is vacuous. Read it as pre-registered and hidden, and say so. Including the builder's own family, which has read this RFC, pulls one of the three SQL writers.

The margins are a reasonable cushion against one noisy answer. They are the wrong bar for "the prior survived," and §7 already says a pass is permission. The hole is that permission is available to an incomplete program, and that pre-test 1's permission is unavailable to a complete reading of the corpus.

Smallest fix: make the four idioms a reported breakdown, not an automatic stop, **or** say in §7 that this corpus trips the stop and delete §11.8's "decide with the numbers." If the stop stays, classify a counter trigger as admitted when it rewrites to `snapback.count` without a behavior change, and a window trigger as admitted when the whole condition moves into a `raise` — and define "behavior change" so `NEW.edited := true` and `left_at is null` still trip it. For pre-test 2, require a registered feature list before the rate is computed, hide the answers from the writers, and stop on a tie below 4 of the 5 scenarios.

**§8. Medium. The worst round-2 holes are closed; the bet can still pass without being true, and fail without being false.**

Pass without being true:

- At a true effect of 0, P(primary met) ≈ 0.10 is disclosed. SURFACE has no minimum gap. One phrase across three runs makes the sum strictly lower. Both can happen together.
- The sum hides a bad pair: treatment 0, 0, 4 against control 2, 2, 2 passes.
- Phrase splitting is still the unit. A longer control note is a higher count.

Fail without being false:

- Zero SURFACE in both arms means reading (A) does not hold, and (A) not holding **fails** the bet. A real `data_modeling` win with nothing for either arm to complain about is recorded as a failure. That case should be "not shown," which is what the primary's miss already is.
- Equal SURFACE also fails, rather than "not shown." That is harsher than the primary, and it is a choice. Say it is deliberate or move it to "not shown."
- Floors are holistic, queries, offline, client, writes, setup (7), plus diagnostics and authorization "computed later." LLP 4000 §9.3 floored five categories and stated the trip rate. §1 has no sd for diagnostics or authorization. Eight floors without a trip rate will fail a neutral arm more often than 4000's design. The clock is not itself a fail rule; a holistic score that moves because the arm was slow still can. 4000 included holistic on purpose. Adding three categories is not a restoration.

Masking is now a real attempt: code spans and identifiers become placeholders, the dictionary covers the words round 2 listed, and a guess rate above 65% on held-out notes extends the dictionary before the counted pass. Residual: the repair can delete the words SURFACE needs until the guess rate falls, and 65% on a handful of notes is a weak test. Do not claim the arm is hidden. Claim that the check was run.

Smallest fix: all-zero and equal SURFACE are "not shown," not fail. Require the SURFACE sum to be lower by a registered minimum (at least 3 phrases, or say the unit is a complaint, not a sentence). Drop diagnostics and authorization from the floors until their sds exist, and state the trip rate for the set that remains.

## 4. The pipeline

The shape is bounded: pinned `pg_query`, a catalog and a resolver, two-level parsing of the strings plpgsql returns, lowering to `ast::Document`, a printer that does not exist yet, then the unchanged `snapback4` binary. `print.rs` still prints expressions, reads, quoted strings, and scalar types. §4 says so. That part is no longer a false claim.

It is not yet a spec an implementer can follow without inventing the semantics above. The same person will still:

- treat "no publish call" as online-only on a materialized view;
- AND a trigger into an empty policy and deny #19's mark updates, or OR it and recreate the bypass §3.3 just closed;
- give `activity_card` the type `activity` and then call it with `following`;
- emit `coalesce(point, 0)` and turn hidden groups into zeros;
- lower `substr(s, i, n)` as `slice(s, i - 1, n)`;
- mark a block helper `stable` and publish it on `api.ts`, or `immutable` and have Postgres reject the body for reading tables;
- type `ids` as `snapback.id[]` and lose `messages`;
- lower `for d in a..b` inclusive except the one `insights` example, where the source happens to say `b-1`;
- chunk only the first `for`, and run `backfillFeedEvents`'s second loop inside the last chunk;
- accept `timestamptz default 0` and `now() - at <= edit_window()` because the table calls them the Quarry types;
- satisfy lane (a)'s exit by failing the guide-corpus round trip, or by growing the printer to `route` and `walk`, which this bet does not lower.

`snapback5/AGENTS.md` tells that implementer that LLP 4000 §4–§5 are the runtime of record. §2 says they are not. One of those has to change before a lane starts. The fence is the one that is wrong.

Smallest fix on the printer test: round-trip the committed target, #19's four files, and the guide files whose forms are in §3. Do not make `route` and `walk` part of lane (a)'s exit.

## 5. §11, questions 4–7

**4. Canonicalize the registered list only.** Yes. `<>` and `!=`, the literal `col = null` / `col <> null` forms, `using (E) with check (E)` and `using (E)` alone when `E` reads only immutable columns, and `check (col in (...))` to an enum. Not `in` versus `exists`, not `union` versus `union all`, not `coalesce` versus a maintain point read, not `substr` versus `slice` until the length and the origin are in the rule. The list in §3.7 is the right list except that last one.

**5. Quarry's total equality, in the lowered program.** The revision's choice is the right one for a bet that cannot change the engine. Spell it with `is null` and `is not distinct from`. Refuse bare `=` / `<>` / `in` on nullable operands, and extend that refusal to ordered comparisons and to `not` of a nullable boolean. SQL three-valued logic remains the alternative if the author wants the reader's prior badly enough to pay for an engine change. Guard insertion is not that alternative.

**6. `auth.uid()`, typed `snapback.principal`.** Keep it. It is the name in the lanes this premise is about, and it is not a Postgres built-in; the stub has to create it. Refuse `uuid` principal columns. Muse's `user_id uuid` and Astra's `user_id uuid` will show up in pre-test 1's refused count. That is the right count.

**7. Do not run these pre-tests on this text.** Pre-test 1, as registered, stops as soon as someone reads `is_member`, `enforce_message_windows`, the two counter triggers, and `feed`. Running it does not test Opus's expectation. Fix the idiom rule and the rows in §2 first, then pre-test 1, then the card, then pre-test 2. §11.8's recommendation to run steps 2–4 unchanged would spend the two days confirming a stop the table already contains.

## Verdict

**NOT READY.**

Nothing here needs a different experiment. One engine, Quarry as the control, the parser in the CLI, the premise as a question, and a pre-test before a compiler are still the right shape. This revision does not yet have a surface on which the pinned target lowers to itself: maintain residency, the trigger-only update, the probe grammar, and the time type are wrong in the table, and #19 still has forms with no row and no GAP. Pre-test 1 cannot return the answer §11.8 wants to decide on.

The smallest revision that would be READY WITH CHANGES is those rows corrected, the missing #19 forms either given a spelling or marked ✗, the pre-test stops restated so they are not entailed by §3, and `snapback5/AGENTS.md` pointed at §2. I would not need to see pre-test results to call that revision READY WITH CHANGES.
