# LLP 4001 design review — Claude Opus 5.5, effort max

**Date:** 2026-09-25. **Revision reviewed:** initial (`8a2637efa5`, §11 ruling at `185600d8e2`). **Mode:** blind, read-only, over a detached worktree; `claude -p --model claude-opus-5-5 --effort max`. **Provider/runtime:** Claude Code on the black M5 Max. **Redacted:** no. **Brief (shared verbatim with the Astra and Grok reviewers):**

> You are a blind design reviewer for a proposed Snapback 5, second bet. One reviewer, this session only: do not spawn agents, clone repositories, or run commands on any other machine. Read-only: change nothing, commit nothing. Your review is recorded verbatim under `llp/reviews/` with your model family named; two other families review the same text blind.
> 
> Review `llp/4001-snapback5-sql-front-end.rfc.md` in this checkout. It proposes keeping the Snapback 4 engine untouched and replacing the authoring language (Quarry) with Postgres-dialect SQL: DDL for tables, RLS-shaped policies for rules, views and materialized views for planned and maintained reads, SQL functions for queries, a plpgsql subset for mutations, lowered by a CLI-only parser into the existing Quarry IR. The treatment is the language; the control is Quarry on the same engine build. The first bet, LLP 4000, is Shelved; its §13 says why, and its §4–§5 are the runtime design of record.
> 
> Read the RFC in full, then check its claims against: `llp/4000-snapback5.rfc.md` §1 (the evidence), §4–§5, §9, §13; `llp/3000.012-application-still-owns-derived-data.research.md` §2; `llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md` §5–§6; `llp/3000.013-quarry-states-intent.rfc.md`; `llp/3000.015-shared-baseline-for-snapback5.spec.md`; `llp/0329-agent-native-rebuild-diagnosis.research.md`; the committed Clique target `snapback4/crates/snapback4-sim/tests/fixtures/intent-clique.q`; the Quarry IR `snapback4/crates/snapback4-core/src/ir.rs` and the binder under `snapback4/crates/snapback4-lang/src/bind/`; the guide cards under `snapback4/crates/snapback4-lang/src/guide/`; and `benchmarks/runs/2026-09-05-clique-full-3x3/` for what the Supabase lane actually wrote.
> 
> Focus on, in order:
> 1. **The premise.** Does the record support "the language is the second-largest named item, and SQL is the surface this grader scored at 94" as a reason to expect `data_modeling` to move? What would make the charge merely move to the SQL subset (§10)?
> 2. **Fidelity of the mapping (§3).** Take the committed Clique target and the LLP 3000.015 additions and check, form by form, that §3's SQL can express them and that the lowering to the IR is sound: policies to the three admissible rule shapes and to `update (old, next)`; materialized views to maintained aggregates including the row-keyed and per-reader (Following) forms; SQL functions to planned reads with cursors; the plpgsql subset to Quarry's mutation statements with prediction unchanged; jobs, schedules, effects. Name every form that does not map, or maps with a loss.
> 3. **What is not Postgres (§3.7).** Is the list complete and honest? Is anything presented as standard that a Postgres reader would reject, or anything Snapback-specific hidden in standard-looking syntax? Would a Supabase builder recognize the file?
> 4. **The four hard places in SQL words (§5).** Are completeness classes, device admission, the mutation subset and `now()` correctly restated, and is the claim that they cost less in a familiar frame testable?
> 5. **The pre-test (§7) and the evaluation (§8).** Is the one-day pre-test a fair test of the premise? Can the comparison still pass without the bet being true, or fail without it being false, given LLP 4000 §9's instruments with the language as the treatment and the SQL-SUBSET class added?
> 6. **Cost and sequencing (§4, §9).** Is a `sqlparser`-based front-end lowering to the existing IR a bounded compiler project, and what would a competent implementer build wrong from this text?
> 7. **§11's questions**, answered.
> 
> For each finding: severity (Blocker / High / Medium / Low), the exact RFC section, a concrete scenario or counterexample, and the smallest design change that fixes it. Say plainly what is sound. End with an overall verdict: READY, READY WITH CHANGES, or NOT READY.

## Verbatim review

# LLP 4001: blind design review, Claude Opus 5.5

- **Reviewer:** Claude Opus 5.5 (Anthropic family). One session, no agents, read-only, blind to the other families' reviews.
- **Reviewed:** `llp/4001-snapback5-sql-front-end.rfc.md` at `8a2637efa5` (Draft, initial revision).
- **Date:** 2026-09-24
- **Verdict:** **NOT READY**

**Checked against:**
- **LLPs:** 4000 (§1, §4–§5, §9, §13), 3000.012 (§1–§2), 3000.007 (§3, §5, §6, §9), 3000.013 (§2–§5), 3000.015, and 0329.
- **Target and code:** `intent-clique.q`; in `snapback4-core`, `ir.rs` and `engine/rules.rs`; in `snapback4-lang`, `lib.rs`, `diag.rs`, `parser.rs` and `bind/schema.rs`.
- **Guide cards:** rules, sync, jobs, writes, prediction and language.
- **Benchmarks:** `benchmarks/runs/2026-09-05-clique-full-3x3/`.

Three further sources bear directly on the premise, and the RFC cites none of them:
- the SQL the three Supabase lanes actually wrote, about 1,690 lines in `~/clique-full-20260905/lanes/{astra,grok,muse}-supabase/` (SQL files only);
- calibration #19's `astra/FINAL.md` and its essay;
- the Grok-family comparison on 0.4.0, in `benchmarks/runs/2026-09-24-clique-cmp-grok-0.4.0/`.

## In brief

Changing only the authoring surface over an untouched engine is a good experimental design, and it isolates the treatment better than LLP 4000's bundle did. But this text does not yet describe a surface the untouched engine can accept, and it does not test its premise before building.

1. **The treatment is not the language alone.** The RFC's runtime of record is LLP 4000 §4–§5, which is the shelved derived-residency design. SQL also gets no spelling for `sync`, which the unchanged engine requires. (#1, Blocker)
2. **§3 cannot write the committed Clique target.** Three of §3's own forms are either refused by the binder the RFC calls unchanged or exist in neither arm. §7's pre-test therefore has no defined input. (#2, Blocker)
3. **The record does not support the premise as stated.**
   - The lane that scored 94 wrote unrestricted server SQL, did its authorization in JavaScript, and turned RLS on with zero policies.
   - Five of the eight "language" phrases name restriction, not unfamiliarity.
   - The current release's `data_modeling` note names no language item.
   - In the latest head-to-head, Quarry beats Supabase in `data_modeling`, 84 to 80. (#3, High)
4. **The tests cannot settle the question.** The pre-test measures reading, has no control and no threshold, and never shows the judges a refusal. The comparison can pass without the bet being true. (#9 and #10, High)

## What is sound

- **Treating only the surface is the right experiment**, over an untouched engine, with Quarry on the same build as the control.
- **The parser lives in the CLI only.** Devices adopt bound programs from the server, so the wasm budget is unaffected.
- **LLP 0329's lesson is kept.** Mutations are an analyzable subset lowered to the engine, not arbitrary plpgsql.
- **§5 restates the four hard places faithfully:**
  - the completeness class and its pin rule;
  - the three invertible audiences;
  - rule 6 on `now`;
  - the exception for presence that decides only effects.

  #13 notes two exceptions.
- **Several of the proposed SQL spellings map exactly onto Quarry forms:**
  - `insert … on conflict do nothing returning … into` is `insert … if absent`. The IR says "A unique clash yields absence, never the conflicting row."
  - `order by k desc limit N` is `last N by .k`, newest first (3000.013 §2.1).
  - `raise exception 'CODE'` is `require … else CODE`. The Muse Supabase lane chose this convention unprompted (`raise exception 'CLQFM_EDIT_WINDOW_EXCEEDED'`).
  - Permissive policies combine with OR and restrictive ones with AND, as the RFC says.
  - `using (true)` binds to `Allow`, which the binder infers as a public audience (`bind/schema.rs:296`).
- **The RLS frame fits Snapback's rule model in shape.** Per-command row predicates with membership probes are what the Muse lane wrote, and it scored authorization 86: "RLS turns row visibility into declarative SQL enforced on every path".
- **Queries already have a plan for `in (select col from t where …)`**, as 3000.013 §2.1's value lanes. The RFC could advertise this.
- **The instincts in the evaluation design are right:** a pre-test before compiler work, a SQL-SUBSET class, and §10's first risk. So are §11's three recommendations.

## Findings, ranked

| # | Severity | Section | Finding |
|---|---|---|---|
| 1 | Blocker | §2, §3.2, §3.7, §6, Related | The runtime of record is the shelved derived-residency design, and SQL has no `sync` spelling |
| 2 | Blocker | §3, §3.7, §7 | §3 cannot spell the committed target, and three of its forms are refused or exist in neither arm |
| 3 | High | Summary, §1, §10 | The premise misreads the record |
| 4 | High | §3.2 | Policies look like Postgres RLS but behave unlike it |
| 5 | High | §3.7, §10 | The "not Postgres" list is incomplete, standard syntax hides different meanings, and the expression subset is unstated |
| 6 | High | §3.3 | The view / materialized view split does not match the engine's own choice, and materialized-view semantics are inverted |
| 7 | High | §3.4–§3.6 | The query, mutation, job and schedule subsets miss the target and do not lower one-to-one |
| 8 | High | §4, §9, §10 | Wrong lowering target; `sqlparser` does not parse PL/pgSQL; re-spelling diagnostics is unbounded |
| 9 | High | §7 | The pre-test cannot falsify the premise |
| 10 | High | §8, §10 | The comparison can pass without the bet being true, and fail without it being false |
| 11 | Medium | §3 | SQL's NULL semantics versus Quarry's total equality |
| 12 | Medium | §3.1 | Immutability cannot be stated wherever an update policy exists |
| 13 | Medium | §5 | Device admission becomes a silent downgrade; the "90%" figure is unmeasured |
| 14 | Medium | §1, §3.4 | LLP 3000.009 §6.2's SQL reads are unreconciled, and unused as a relief valve |
| 15 | Medium | §3.7, §4 | The one-spelling ruling, the single refusal code, and `api.ts` naming are undecided |
| 16 | Low | §3 | §3's own SQL has Postgres errors |
| 17 | Low | §1 | Evidence rows 55, 58 and 60 overstate |

---

## 1. The premise

### #3. The premise misreads the record (High)

**Where:** Summary; §1 rows 54–58; §10.

**Answer to the question asked.** No: the record does not support "the language is the second-largest named item, and SQL is the surface this grader scored at 94" as a reason to expect `data_modeling` to move.

**(a) What earned the 94.** The astra-supabase lane:
- enabled RLS on 22 tables and wrote no `create policy` anywhere (`schema.sql`, `scripts/*.sql`). The grading trace (d-02) says "`clqfa_profiles` has RLS enabled and **zero** policies". Its run record says "API owns app authorization".
- wrote its mutations as one plpgsql dispatcher, `clqfa_mutate(who uuid, op text, b jsonb)`. It uses:
  - `elsif`, assignment, `found`, `select … into` and `for update`;
  - set-based `insert … select` fan-outs (`mutations.sql:13, 75, 77`);
  - a like-count trigger (`schema.sql:87–89`);
  - a window-function backfill (`:77`);
  - GIN over `to_tsvector` (`:57–58`).
- ran its reads in Node.

The scorer credited "relational keys, constraints, joins … GIN search and M8 server aggregates … composability". §3.5's subset refuses nearly every construct listed above.

**(b) The other two families.** They scored their Supabase lanes 86 (Grok) and 85 (Muse).
- **Muse** is the only lane that used the frame this RFC proposes: RLS policies, RPCs and pg_cron. It scored 85, below Snapback 4's 90 at 0.4.0. Its membership policies call `security definer` helpers (`using (is_member(id, auth.uid()))`, `functions.sql:4–18`). Its counters and old-versus-new rules are triggers (`functions.sql:43–97`).
- **Grok** put authorization in Express. When the same lane was re-scored beside Snapback 4 0.4.0, its note reads: "the server program is server/store.mjs (~1643 lines) because **RLS/RPC felt like more ceremony**."

**(c) The 94 is anchored and N = 1.**
- The same Grok Supabase lane scored 86 beside Snapback 2 (73) and 80 beside Snapback 4 (84).
- LLP 3000.012 §1 already calls the 2026-09-05 scores "scored differently … directional".

**(d) The current record points the other way.**
- #19 (0.4.0) scored `data_modeling` 90. That is above the 16-run range of 82–89, and up from 82 at 0.2.32.
- #19's note names no language item: "Shared Quarry declarations unified server and replica logic; maintained counts and day buckets were concise. Recipient receipts required explicit rows/helpers, and prediction/completeness introduced learning overhead."
  - The receipts are what LLP 3000.015 removes, in both arms.
  - Prediction and completeness are what §5 says will stay.
- The essay's "Quarry itself added learning cost" names three first-try refusals: object spread, empty search, and seconds in a schedule. All three are answered in 0.4.1 (Lanes K and A).
- In the Grok-family head-to-head on 0.4.0, Snapback 4 scored 84 and Supabase 80 in `data_modeling`.

**(e) The phrases name restriction.** Of the eight "language itself" phrases, five name restriction:
- "restrictive rule expressions"
- "less flexible than general-purpose code or SQL"
- "fewer language escape routes"
- "restricted joins/scans"
- "constrained expressiveness"

Only three name unfamiliarity. A SQL surface that refuses SQL removes the unfamiliarity and sharpens the restriction, because the builder's prior becomes full Postgres. "Less flexible than … SQL" is the comparison this design invites on every refusal.

**(f) The ceiling categories are about ownership, not familiarity.** LLP 3000.012 §2.1 reads the 94–97 categories as "features Snapback turned into declarations on a table". It lists `sync to` and `retain delivered-history` among them, and #19's authorization note (96) credits "retained-history policies". No builder has a prior for any of those. Row 57 drops them and re-reads the row as "familiar shape".

**(g) The one in-house precedent is not cited.** LLP 0329 records a familiar-profile arm (`snapback-familiar`, LLP 0252) that "removed authoring syntax friction and still finished worse … the friction that costs milestones is behavioral, not syntactic". LLP 0329 rightly declines a verdict, because the N ≥ 3 matrix never ran. It is still the only precedent for this bet.

**What would make the charge merely move to the subset.** A Supabase-trained builder writes what both lanes wrote:
- triggers for counters and transition rules;
- security-definer helpers inside policies;
- CTEs and `returns table`;
- `elsif`, `:=` and `found`;
- set-based DML, window functions, `date_trunc` and jsonb.

Each of these becomes `E_SQL_UNSUPPORTED` or "server only". Scored against a full-Postgres prior, that reads as "restricted SQL", which is the old charge in a new spelling.

**Fix:**
- Restate the premise as the open question: does a *restricted* SQL keep the familiarity credit that *unrestricted* SQL earned?
- Cite (a) through (g).
- Make the corpus replay in #9 the premise test, run before any compiler work.

---

## 2. Fidelity of the mapping

### #1. The runtime is misidentified, and residency has no spelling (Blocker)

**Where:** §2, §3.2, §3.7, §6 bullet 3, and the Related line. LLP 4000 §13 contains the same sentence.

**The named runtime is not Snapback 4's.**
- LLP 4000 §4 is "The bridge, derived": a warm set, a depth step, acquisition records, device-computed pages, and "the server keeps no page results". That is the shelved treatment, and it needed feature-gated engine hooks (LLP 4000 §8).
- LLP 4000 §5 adds `useOutbox`, which was a treatment addition. No `useOutbox` exists in `snapback4/`.
- Yet §2 goes on to say nothing in `snapback4-core` or `snapback4-device` changes.

**The surface has no residency spelling.**
- In Snapback 4, "A table's sync declaration chooses its audience and acquisition horizon" (sync card).
- A table with neither `sync` nor `online only` is online-only (3000.007 §6.1).
- Horizons are authored, as in `sync last 500 by .at`.
- A target with several principal columns needs `by .col` (`bind/schema.rs:299–306`).
- The committed target writes `sync public` five times and `sync to members[.conversationId]` twice.
- §3.2's "a table's rows can be held on devices when its select policy is one of the three invertible shapes" is LLP 4000 §3.2's flipped default, not Snapback 4's rule.

**Scenario.** Lower §3's `messages` table on the unchanged binder. There are three possible outcomes, and each is a second treatment:
1. **No `sync` emitted.** Messages are online-only, so M6's offline milestone fails in the SQL arm and passes in the control.
2. **`sync` emitted for every admissible table.**
   - The SQL arm acquires every group in full, with no horizon, against a 100k-message replay.
   - Prediction gains whole-partition witnesses the control lacks.
   - Tables the Quarry author would leave online-only get replicated.
3. **Derived residency.** That is an engine change.

Following cannot materialize at all without `sync public` sources. 3000.013 §3.3 requires them to be "explicitly public and fully `sync public`".

**Consequence for §8.** §8 drops the delivery-load and cold-start instruments "because the engine is unchanged". That is valid only if residency is identical in both arms, which requires this fix.

**Fix:**
1. **Name Snapback 4's runtime** in §2, §6 and the Related line, as LLP 3000, 3000.007 §6, 3000.013 and 3000.015 define it. Cite LLP 4000 §4.5 only as a restatement of Snapback 4's predictor. Correct LLP 4000 §13 to match.
2. **Add a residency spelling with Snapback 4's default**, where absent means online-only. A Supabase builder already knows one. Supabase Realtime is switched on with `alter publication supabase_realtime add table messages;`. So:
   - `alter publication snapback add table messages;` means `sync`, with the audience inferred from the select policy;
   - the horizon and the recipient are options on it, for example `with (horizon = 'last 500 by at', recipient = 'principal')`.
3. **Keep the refusal.** A published table with a non-invertible select policy should be refused (`E_SYNC`, re-spelled), not silently printed as "server only". See #13.

### #2. §3 cannot spell the committed target (Blocker)

**Where:** §3, §3.7, §7.

§7 asks one session to write the committed target "in the SQL of §3, line for line". The session would have to invent spellings for much of it, and the three families would then judge the inventions.

Key: ✓ maps · ≈ maps with a loss · ✗ no spelling · ⊘ refused by the unchanged binder, or in neither arm

| Form (target line) | §3's spelling | | Why |
|---|---|---|---|
| `use identity password` (5) | — | ✗ | No spelling |
| `effect push` (6) | `create type push as (…)` | ≈ | Nothing ties the type to `snapback_emit`'s `json_build_object` |
| Column types, `text <=N`, `text M..N`, `enum`, `?`, `default now` | DDL, `check (length …)`, `check (x in …)`, `default now()` | ✓ | |
| `format handle`, `format url` (11, 14) | — | ✗ | A regex `check` is not in the IR |
| `image <=N`, `video <=N`, `once` (15, 30–31) | `snapback_image (N) …` | ✓ | `once` does not parse as Postgres |
| `unique a, b` | `unique (a, b)` | ✓ | |
| `unique handle else HANDLE_TAKEN '…'` (18) | — | ✗ | Neither the code nor the message has a place |
| `search displayName, handle` (19) | `snapback_search = 'col'` | ≈ | As written, it takes one column |
| `immutable …` (20, 36, 47, 58, 69) | Inferred from update policies | ✗ | Cannot be stated where an update policy exists (#12) |
| `public 'reason'` (21, 37, …) | `using (true)` | ≈ | Binds to `Allow` (`schema.rs:334`), which still syncs as public; the reason is lost |
| `insert <- …`, `delete <- …` | `with check`, `using` | ✓ | |
| `update <- .col = viewer` (single image) | `for update using (…)` | ≈ | Quarry tests only the new image; Postgres's USING tests the old image, and by default the new one too (#4e) |
| `sync public` ×5, `sync to members[…]` ×2 | — | ✗ | #1 |
| `likeCount: count likes`, `repostCount` (34–35) | — | ✗ | Only the `latest … over conversation` comment exists, with no grammar |
| `view activity`: union with constant fields (75–77) | `create view … union all …` | ≈ | `union` (distinct) is undefined; constant projections must be recognized |
| `view following` (79) | `create materialized view` | ≈ | Needs `sync public` sources and immutable mapped columns (#1, #12); a plain `create view` is materialized too (#6) |
| `count … by .col` views (81–83, 88) | `create materialized view … group by` | ≈ | An absent group reads 0 in Quarry and returns no row in Postgres |
| `count likes by .postId.authorId[, day(.at)]` (84–87) | Join plus `group by …, date_trunc(…)` | ≈ | Unstated: recognizing the reference path, `date_trunc` versus `::date`, and the session TimeZone |
| Shapes `postCard` and `activityCard`, nested (91–92) | Per-row subselects | ≈ | `replyCount[.id]` written as a subselect streams unless recognized; nested composite shapes |
| `home`, `global`, `userPosts`, `thread`, `searchAll` | `language sql` plus a cursor | ✓ | Reference arguments (`postId: posts`) become untyped ids |
| `trending` (98–99) | `order by like_count desc, at desc limit 10` | ✓ | Once `likeCount` has a spelling |
| `people … matching q` over two fields (104–105) | `snapback_words(col, q)` | ≈ | One column |
| `socialProfile`: `! else NOT_FOUND`, spread (106–108) | — | ✗ | Not "one select"; `NOT_FOUND` drops out of `api.ts` |
| `insights`: range loop, list, object return (109–113) | — | ✗ | §3.4 admits only `returns setof` of one select |
| `insert … if absent` (116, 119, 125) | `on conflict do nothing returning … into` | ✓ | Exact |
| `if … else if exists …` (118–121, 124–127) | `if … then` only | ✗ | Until `elsif` and `else` are admitted |
| `require … else CODE` (123) | `if … then raise exception 'CODE'` | ✓ | |
| `delete likes[postId, viewer]` | `delete … where …` | ≈ | Quarry raises `NOT_FOUND` on a missing row; Postgres affects zero rows (#7c) |
| `cap 50 by conversationId` (136) | `check (snapback_cap(50, …))` | ✓ | §3.7 calls it `at most`, which is LLP 4000's spelling |
| `retain delivered-history` (152) | `snapback_keep_history` | ✓ | §3.7 calls it `keep history`, which is LLP 4000's spelling |
| `expire at .expiresAt` (153) | `snapback_expire_at` | ✓ | |
| `job daily` (161–171) | A plpgsql function | ✗ | No `:=` or `select into`; function-scoped locals are refused in sweeps; no job marker (#7d) |
| `emit … once [a, b]` (171) | `once => a \|\| ':' \|\| b` | ≈ | Joining strings is not injective |
| `schedule … every 2m: daily` (172) | `cron.schedule(…, $$ select daily(now() …) $$)` | ≈ | The period comes from execution time, which breaks once-per-boundary (#7e) |
| 3000.015 `written by .principal` | `written by principal` | ≈ | Not Postgres; private-by-default projection and `readable by audience` are unstated |
| 3000.015 `sequence by` | `snapback_sequence (col)` | ✓ | That one counter is shared across tables is unstated |
| 3000.015 row-keyed `unread` | Materialized view with an inner join | ≈ | Postgres returns no row for a member with zero unread |
| 3000.015 `update (old, next) … next.x = old.x` | `with check (x = old.x)` | ≈ | `old.` is not available in Postgres policies |
| §3 `messages_edit`: `now() - at <= …` (line 140) | A policy | ⊘ | Rules admit only `=` and `!=` (`schema.rs:376`) |
| §3 `snapback_readable` (`through`) (138–139) | A policy | ⊘ | LLP 3000.014 is Draft, excluded from 3000.015, and has no parser support |
| §3 `latest … generated always as (max(…) over conversation)` (104) | A column | ⊘ | No grammar, and not valid Postgres |

**Tally:** of 41 rows, 12 map, 16 map with a loss, 10 have no spelling, and 3 of §3's own forms are refused or exist in neither arm.

**Fix:**
- Replace §3's illustration with a normative table covering `intent-clique.q`, 3000.015 and #19's program. Each row gives: the Quarry form → the SQL spelling → the lowered Quarry → where a Postgres reader's expectation differs.
- Verify every row twice before §7: the SQL through Postgres's own parser against an empty database with stub domains and functions, and the lowered Quarry through `snapback4 check`.

### #4. Policies look like Postgres RLS but behave unlike it (High)

**Where:** §3.2.

**(a) The expression language is tiny, and nothing says so.**
- The binder admits only:
  - `and`, `or`, `not`, `=` and `!=`, over `.col`, `old.col`/`next.col`, `viewer` and literals;
  - `exists` and `created` key probes.
- The binder's own message is "`<=` is not a rule operator; rules use and, or, not, =, and !=" (`bind/schema.rs:376`).
- Postgres policies accept any boolean expression.
- So §3's `messages_edit` is valid Postgres and refused by Snapback 4.

**(b) `old` is a hidden extension.**
- Postgres policies cannot name `old`, so `with check (read_up_to = old.read_up_to)` (line 137) is a Snapback extension presented as standard SQL.
- Supabase builders enforce transitions with triggers. Muse's `enforce_message_windows` compares `OLD` and `NEW` in a `before update` trigger.

**(c) The canonical membership policy recurses in Postgres, and the Supabase fix loses offline.**
- In Postgres, `members_read`, a select policy on `members` that selects from `members`, fails at query time with "infinite recursion detected in policy for relation "members"".
- The Supabase idiom is a `language sql stable security definer` helper; Muse wrote `using (is_member(id, auth.uid()))`.
- Under §3.2's three literal shapes, that familiar form is "server only". It silently loses offline.

**(d) Role clauses are unmapped.**
- Every Muse policy says `to authenticated`, and none of that is mapped.
- `to service_role` is the natural spelling for Snapback's service grants (`or viewer = 'service:pusher'`).

**(e) Omitting `with check` means different things in the two languages.**
- Postgres reuses `USING` as `WITH CHECK` when the latter is omitted from UPDATE and ALL policies.
- Snapback's single-image `update <- .ownerId = viewer` tests only the new image (`engine/rules.rs:265`: `RuleTerm::Field | NextField => next.field(…)`).
- Scenario: `ownerId` is not declared immutable. Quarry lets a reader of the row set `ownerId` to themselves. Postgres's `using (owner_id = auth.uid())` refuses it.

**Fix:**
- State the policy grammar in §3.7.
- Define the lowering exactly: `using` applies to the old image; `with check` to the next image; an omitted `with check` applies `using` to the next image, as Postgres does.
- For transitions, either list `old.` as a Snapback extension, or admit a `before update` trigger restricted to `if <condition over old/new> then raise exception …` and lower it to `update (old, next)`. That trigger form is what Muse wrote.
- Inline `language sql stable` helpers whose body is an admitted probe, so `is_member(conversation_id)` is recognized as the membership shape.
- State that probes inside policies read without policies. That is security-definer semantics, which is what Snapback's probes already are.
- Map `to service_role` to service grants, and ignore `to authenticated`.

### #6. The view / materialized view split does not match the engine's choice (High)

**Where:** §3.3.

**(a) The author chooses in SQL, but the engine chooses in Quarry.** Quarry has one `view`, and "the engine decides whether to plan it at read time, maintain it, or materialize it" (3000.013 §3). The SQL split mismatches in three places:
- `create view follower_count as select followed_id, count(*) … group by` has no plan-at-read-time Quarry form, because Quarry aggregate views are always maintained.
- `create view following as …` is materialized anyway: "The planner recognizes this shape".
- `create materialized view recent as select … where …` is planned at read time.

**(b) The Postgres prior is inverted.**
- A Postgres materialized view is a snapshot refreshed by `refresh materialized view`. It has no RLS, and it is evaluated with the refresher's identity.
- The RFC's materialized view is the opposite:
  - maintained in the writing transaction;
  - filtered by source rules (3000.013 §3.2; 3000.015 §3);
  - per reader when it mentions `current_principal()`;
  - pending on a per-row basis.
- Neither Supabase lane wrote a materialized view. Both kept their counts with triggers.

**(c) Zero groups differ.** In Postgres, `unread`'s inner join with `count(*)` has no row for a member with nothing unread. 3000.015 §3 defines one value per `members` row, and `followerCount[p]` reads 0 when absent.

**(d) Plain views differ too.** A Postgres `create view` runs with the owner's privileges unless `security_invoker = true`. Snapback reads each source under the viewer's rule.

**Fix:**
- State a bijection: `create view` only for shapes the engine plans; `materialized` only for shapes it maintains or materializes; each mismatch refuses with a rewrite.
- Add §3.7 rows: "a materialized view is engine-maintained, rule-filtered, per viewer, and never refreshed" and "views are security-invoker".
- Define zero-group behavior.
- Consider spelling in-table counts as `generated always as (count(…)) stored` on the parent table. That is closer to the trigger-maintained counters builders actually write.

### #7. The query, mutation, job and schedule subsets miss the target and do not lower one-to-one (High)

**Where:** §3.4–§3.6.

**(a) Queries.** §3.4 admits only `returns setof` of one select. `socialProfile` and `insights` have no admitted form.

**(b) Mutations.**
- §3.5 omits `else`/`elsif`, `:=`, `select … into`, `found`, `continue`/`exit`, and range and array loops.
- All of these exist in Quarry (`Stmt::Assign`, `If.else_body`, `Continue`, `Break`, `LoopDomain::LiteralRange`) and in both Supabase lanes.
- So the SQL arm would be more restricted than the control.
- "This is the RPC-function subset Supabase builders already write" is contradicted by both lanes' code.

**(c) DML semantics.**
- Quarry writes are point writes by id or by full unique key.
  - `update t[k]` and `delete t[k]` return `NOT_FOUND` for a missing row.
  - `update … if cond` returns `E_CONFLICT` when the condition is false (writes card).
- Postgres `update/delete … where` affects zero rows silently.
- Set-based statements (the Astra lane's `insert … select` fan-outs, or a multi-row `update`) lower to loops. In a predicting mutation, those loops are subject to `E_STRUCTURAL_FANOUT`.
- So "lowers one-to-one … prediction, the meter and why are unchanged" holds only for statements that pin a key. Faithful zero-row semantics would add existence reads, and those change prediction.

**(d) Jobs.**
- Nothing distinguishes a job from a mutation. Yet jobs are not in `api.ts`, and no client calls a job.
- A job commits every K iterations, whereas a Postgres function is atomic.
- plpgsql declares locals at function scope, and "A prelude local assigned by the sweep is refused". So the target's `daily`, written in natural plpgsql, is refused.

**(e) Schedules.**
- The engine passes `periodStart` and `periodEnd` "and nothing else", fires at most once per boundary, and merges missed boundaries into one run.
- `$$ select daily(now() - interval '1 day', now()) $$` derives the period at execution time. A late or retried run shifts `periodEnd`, so `once [p.principal, periodEnd]` stops deduplicating.
- The admitted cron grammar is unstated. `every 90s` has no cron form, and `0 8 * * 1-5` has no Quarry form.

**Fix:**
- Write each subset as a grammar, with its lowering.
- Admit the plpgsql spelling of every Quarry mutation form.
- Admit `update/delete … where <full unique key>` as point writes, and list "a missing row raises `NOT_FOUND`" in §3.7. Refuse set-based DML with the loop rewrite.
- Spell jobs as `create procedure`, the Postgres form that may commit, which is the right prior for chunking. Put per-iteration locals in a nested `declare … begin … end`.
- Spell schedules as `cron.schedule(name, '<admitted cron>', $$ call daily() $$)`, with the period supplied as `period_start`/`period_end`.

### #11. SQL's NULL semantics versus Quarry's total equality (Medium)

In Quarry, "Equality and inequality with null remain total" (3000.013 §2.1). In SQL, `=` and `<>` with a null operand are unknown.

**Scenario:**
- `where parent_id <> $1` returns originals and replies in Quarry, but only replies in Postgres.
- `where parent_id = null` returns originals in Quarry, and nothing in Postgres.
- `count(col)` versus `count(*)`, and `sum` of an empty set, also differ.

**Fix:** decide and write it down. The preferred option is SQL semantics by guard insertion, with a statement of what that does to pins and completeness. The alternative is Quarry's semantics, listed in §3.7, with a `check` note on `=`/`<>` over nullable columns.

### #12. Immutability cannot be stated where an update policy exists (Medium)

**Where:** §3.1.

§3.1 infers immutability when "no update policy can change it". But `posts` has an update policy, so the inference fails for `authorId`, `parentId` and `at`, all declared immutable at line 36.

Following, and recorded attribution through `.postId.authorId`, both require immutable mapped columns.

**Fix:** use the Postgres idiom. Lower column privileges (`grant update (body, removed) on posts to authenticated`) to `immutable`.

---

## 3. What is not Postgres (§3.7)

### #5. The "not Postgres" list is incomplete (High)

**Where:** §3.7; §10 bullet 4.

**(a) Some clauses do not parse as Postgres.** `written by principal` and `… once` are not column options in Postgres, or in `sqlparser`'s Postgres dialect. That contradicts §10's "every item parses as Postgres syntax".

**(b) Rows are missing:**
- maintained columns. The comment on line 104 points to §3.7, which has no such row;
- `old.` in policies;
- `use identity`, `format`, and `unique … else CODE 'message'`;
- `public 'reason'`;
- bounded lists, `decimal`, `money`, `json <=N` and `bytes <=N`;
- `after insert <-`;
- bounds on function arguments. Postgres discards type modifiers on function arguments, so `q varchar(100)` bounds nothing;
- multi-column search;
- effect types.

**(c) Standard syntax hides different meanings:**
- An unused `snapback_cursor` argument paginates, while the function body says `limit 50`.
- Views are security-invoker, and materialized views are maintained (#6).
- `written by` columns are private to their owner unless declared `readable by audience`, which has no spelling (3000.015 §1).
- One sequence counter is shared per parent across tables (3000.015 §2).
- Jobs commit per chunk.
- DML on a missing key raises an error.
- Count views read 0 for absent groups.
- A streamed `count(*)` returns null on a meter cut (3000.013 §5.1).
- `current_principal()` is `auth.uid()` renamed.

**(d) The expression subset is unstated.**
- The IR's operators are `= != < <= > >= + - *` plus `and`, `or` and `not`, with a short builtin list (`ir.rs`: `BinaryOp`, `Builtin`).
- Floats are refused (3000.007 §5.7).
- For none of `coalesce`, `case`, `greatest`, `extract`, `date_trunc`, `::`, `like`, `~`, `avg`, `gen_random_uuid()`, jsonb operators or `string_agg` does the RFC say whether it is admitted with a lowering or refused.

**(e) The Quarry names are wrong.** §3.7 gives `keep history` and `at most N by`, which are LLP 4000's spellings. Snapback 4's parser has `retain` and `cap` (`parser.rs:200–213`).

**Would a Supabase builder recognize the file?**
- The tables, yes.
- The policies look like theirs and behave unlike theirs (#4).
- The views and functions look like theirs and mean something else (#6, #7).
- In §3's own example, none of the six policies is both valid Postgres and admitted by the engine with Postgres semantics.

**Fix:**
- Make §3.7 exhaustive under one rule: any construct whose Postgres meaning differs from its Snapback meaning gets a row, even when its syntax is standard.
- Add the admitted operator and function list, with lowerings.
- Spell the viewer as `auth.uid()`, or say why not.

### #15. Three surface decisions are undecided (Medium)

**Where:** §3.7; §4.

**(a) The one-spelling ruling.** 3000.007 §5.5 ruled "the language keeps one spelling". Familiar SQL is many-to-one: `<>` and `!=`, `in` and `exists`, `is null`, `coalesce` and `case`. This needs an author ruling that the SQL surface canonicalizes alternatives rather than refusing them.

**(b) One refusal code.** A single `E_SQL_UNSUPPORTED` makes `explain_code` generic at exactly the point where the subset gets charged. Use a small family instead (statement, expression, join shape, policy grammar), each with a card section.

**(c) `api.ts` naming.** The SQL is snake_case. Generating camelCase gives the builder a mapping to learn. Keeping snake_case makes the client differ from the control. State the choice either way, since it is part of the treatment.

### #16. §3's own SQL has Postgres errors (Low)

**Where:** §3.

- `for p in select … loop` needs `declare p record`.
- `raise exception '<CODE>' using message = …` is invalid, because MESSAGE cannot be combined with a format string.
- `generated always as (…)` needs `stored` before Postgres 18.
- Tuple keys should be `array[…]`, not a joined string.

**Fix:** have CI run §3 and the guide's SQL through Postgres with stubs.

---

## 4. The four hard places (§5)

### #13. Device admission becomes a silent downgrade, and "90%" is unmeasured (Medium)

**Where:** §5.

The restatements of the completeness class, the three audiences, rule 6 and the presence exception are correct. Three problems remain.

**(a) Device admission changes character.**
- In Snapback 4, a non-invertible rule under `sync` is a compile error with a rewrite (`E_SYNC`).
- With no sync spelling, §3.2 turns that into a printed downgrade.
- That is LLP 0329's F1, "capability is a function of authoring form, and the mapping is invisible at the authoring site", and its F2: `using (true)` becomes the cheapest way back to offline.
- The familiar helper-function policy of #4(c) is exactly the form that triggers it.

**(b) The cost is understated.** The mutation subset is narrower than Quarry's (#7b), so "the same four places" understates what the SQL arm pays.

**(c) The edit window is in the wrong place.** §3 puts it in a policy, which the binder refuses. In an admitted design it would be a `raise exception` in the mutation, where #19 and Muse both put it.

**Is "cost less in a familiar frame" testable?** Not as written: "the surrounding 90%" is unmeasured.

**Fix:**
- Report and register the share of the pinned SQL program's statements that are valid Postgres with identical semantics.
- Restore `E_SYNC` via #1.

---

## 5. The pre-test and the evaluation

### #9. The pre-test cannot falsify the premise (High)

**Where:** §7.

**Why it cannot:**
- Reading an expert's admitted SQL is not the same as writing under the brief. The record's charge comes from builders who wrote code, were refused, and read diagnostics.
- There is no control, such as the Quarry spelling or a real Supabase program judged the same way.
- There is no threshold. The count of "where it does not" is predictable from the length of §3.7.
- The judges never see a refusal, yet §10 says the pre-test "catches the worst of" the refusal risk.

**Fix:** two compiler-free tests, each about a day, with their thresholds registered in this document first.

1. **Corpus replay.** Classify every statement the Supabase lanes wrote (about 1,690 lines, on this host) as one of: admitted; admitted after a mechanical rewrite; refused; or server-only, under #2's normative table.
   - Register a stop rule, for example:
     - more than a third of the statements refused; or
     - any of {the membership policy, a counter, a transition rule, the feed read} refused in all three lanes.
2. **Blind writing.** Three families, including the builder's family, write the messaging half from the brief and the SQL card only. Classify their statements the same way. The control arm does the same from the Quarry card.

The reading judgment can remain as a reported third number.

### #10. The comparison can pass without the bet, and fail without its falsity (High)

**Where:** §8, §10.

**It can pass without the bet being true:**
- LANGUAGE is defined as Quarry things, so its count is almost automatically zero in an arm with no Quarry.
- The counts are tiny (about 0.5 phrases per run), so a single phrase decides.
- The classifier cannot be blind to the arm, because the notes say "SQL", "policy" and "plpgsql".
- `data_modeling` is only "reported".

**It can fail without the bet being false:**
- A new compiler, guide and diagnostics set is compared against a control polished over about 20 waves. `diagnostics_dev_loop` has a median of 94.
- One ambiguous phrase classified as LANGUAGE fails "zero in every paired run".

**The rules are inconsistent or missing:**
- §8 says SQL-SUBSET exceeding LANGUAGE is "recorded as the charge moved"; §10 says it falsifies the bet.
- There is no fail rule for a clock loss, or for an overall result that is not distinguished.
- The floors are LLP 4000's floors for a delivery bet. `diagnostics_dev_loop`, `setup_and_docs` and `authorization` are the categories a language treatment puts at risk, and none of them is a floor.

**Fix:**
- Use one symmetric SURFACE class in both arms, with surface tokens masked before classification by a registered dictionary.
- Register a directional `data_modeling` prediction as the primary result, with SURFACE ≤ control as the mechanism gate.
- Add floors on `diagnostics_dev_loop`, `setup_and_docs` and `authorization`.
- Write one fail rule.
- Add a maturity gate before the runs:
  - both guides compile;
  - diagnostics cover every code the Clique program and the corpus can produce;
  - one uncounted pilot per arm, with its fixes landed.

---

## 6. Cost and sequencing

### #8. The lowering target is wrong, and the diagnostics work is unbounded (High)

**Where:** §4, §9, §10.

**(a) The lowering target is wrong.**
- `ir.rs` is "what the Quarry binder emits". Its `Read` and `Scan` already carry the chosen `index`, the bound `key`, the `site` and the `provenance`.
- `compile()` parses source to `ast::Document`, and `bind()` then produces the IR (`lib.rs`).
- So "SQL AST → Quarry IR → the existing binder" cannot run. The workable pipeline is SQL AST → Quarry AST → the unchanged binder.
- The most honest version of that is source-to-source: print the Quarry with `print.rs` and hand it to `snapback4 check`.

**(b) The parser does less than §4 assumes.**
- `sqlparser` keeps a plpgsql body as a dollar-quoted string, so §3.5 needs a second parser.
- `sqlparser` rejects `written by` and `once`.
- libpg_query, via the `pg_query` crate, is Postgres's own parser and has a PL/pgSQL entry point. It makes "valid Postgres" mechanically true.

**(c) Re-spelling the diagnostics is unbounded.**
- A `Diagnostic` carries a pre-formatted Quarry `message` and `rewrite`, and a Quarry `site` (`diag.rs`).
- There are about 400 construction sites: `Diagnostic::new` 84, `type_error` 131, `unknown` 92, `syntax_with` 79, and others.
- `why`, `--residency`, `--cost` and runtime refusals also print Quarry.

**What a competent implementer would build wrong from this text:**
- lower to `ir.rs`;
- expect `sqlparser` to parse plpgsql;
- evaluate `using` against the new image only;
- honor `materialized` over the engine's own choice;
- give `=` Quarry's total semantics;
- turn `update … where` into a point write that raises `NOT_FOUND`;
- expose jobs in `api.ts`;
- pass `now()` into schedules;
- emit `sync` for every admissible table;
- resolve plpgsql parameter-versus-column collisions by preferring the column.

**Fix:**
1. Retarget §4 to the Quarry AST, printed, with a span map from lowered Quarry back to the SQL.
2. Add an equivalence gate: the pinned SQL program must lower to the pinned Quarry program, identical under `print`. That makes "unchanged prediction" a checked fact.
3. Tier the diagnostics. Give SQL rewrites for every code the Clique program and the corpus can produce. Everything else shows the Quarry message plus the lowered line, labeled.
4. Evaluate `pg_query` before lane (a).
5. Land the normative table and the equivalence gate before lanes (b) and (c).

**Is this a bounded compiler project?** Parsing, and lowering DDL and policies, are bounded. Recognizing many SQL spellings, re-spelling diagnostics, and writing the guide are bounded only by accepting a refusal rate. That refusal rate is what #9 should measure first.

### #14. LLP 3000.009 §6.2's SQL reads are unreconciled (Medium)

**Where:** §1 row 61; §3.4.

- 3000.009 §6.2 is Accepted in direction.
- 3000.007 §9's update of 2026-09-16 says "application SQL reads are admitted". They are server-only, in the store's dialect, over authorized inputs, and return `complete: false`.
- As of that update, implementation was still pending (increment D). I did not find it in the guide cards.
- Two SQL surfaces with different semantics would then coexist in one product.
- This is also the largest relief valve for #3's risk. An unlowerable read-only function could become a server-only SQL read instead of `E_SQL_UNSUPPORTED`. Both arms would carry it.

**Fix:** reconcile this in §3.4, and sequence increment D before the comparison, or explain why not.

### #17. Evidence rows overstate (Low)

**Where:** §1.

- **Row 55** quotes half of #19's sentence. The rest is "while providing concise declarations and useful prediction diagnostics".
- **Row 58:** measured from 0.2.32, `data_modeling` moved 82 → 87 → 90, reaching the series high.
- **Row 60:** Convex's first green (64 minutes) beat Snapback 4's (68). Those lanes ran in parallel, and LLP 4000 §1 calls them "not a claim-eligible magnitude". "The clock and correctness goals are already met" overclaims.

---

## 7. §11's questions

1. **Postgres dialect only?** Yes: the builders' prior is Postgres, with pg_cron, plpgsql, GIN and jsonb. But "Postgres" should mean what Postgres's own parser accepts, and the viewer should be `auth.uid()`-shaped. No to the SQLite flavor.
2. **Should the pre-test gate the compiler work?** Yes. Gate on #9's redesigned pre-test, run after #1 and #2 are fixed and with its thresholds registered here first. Running compiler work in parallel would spend it before the premise is tested, which is what LLP 4000 §13 regrets.
3. **Separate package or a `--sql` mode?** A separate package, for protocol rule 6. Make it a thin CLI that emits Quarry and calls the same `snapback4` binary. Then build identity between the arms is trivial, and the equivalence gate is a diff. A `--sql` mode can come later if the bet passes.

## Overall verdict: NOT READY

To reach READY WITH CHANGES, in this order:
1. Name Snapback 4's runtime, and add the publication spelling with Snapback 4's default and `E_SYNC` (#1).
2. Replace §3 with a normative table verified by Postgres's parser and the Snapback 4 binder, and make §3.7 exhaustive (#2, #5).
3. Retarget the lowering to the Quarry AST, with the equivalence gate (#8).
4. Restate the premise, and run the corpus-replay and blind-writing pre-tests against registered thresholds before any compiler lane (#3, #9).
5. Rebuild §8: a symmetric, masked SURFACE class; a registered `data_modeling` prediction; the language-relevant floors; one fail rule; and a maturity gate (#10).

My expectation, which is a judgment and not a measurement: on this record, the SQL arm's `data_modeling` most likely lands within noise of the control, while `diagnostics_dev_loop` and `setup_and_docs` fall. The Supabase prior (triggers, helper functions, CTEs, set-based DML) is broader than any subset this engine can admit, and the current notes no longer charge the language. The corpus replay costs a day and would show whether that expectation is wrong.


---

## Round 2 — revision 2 (`9bc2ea9c83`), 2026-09-25

**Mode:** blind delta review, read-only, over a detached worktree at that commit; `claude -p --model claude-opus-5-5 --effort max`. **Brief (shared verbatim with the Astra and Grok round-2 reviews):**

> You are a blind design reviewer for a proposed Snapback 5, second bet. This is a **delta review**: revision 1 of `llp/4001-snapback5-sql-front-end.rfc.md` (commit `8a2637efa5`) was reviewed by three model families, all NOT READY (their reviews are at `llp/reviews/4001-snapback5-sql-front-end.{astra,grok,opus}.md`); revision 2 (commit `9bc2ea9c83`, the checkout you are in) answers them. One reviewer, this session only: no agents, no clones, no remote commands. Read-only: change nothing, commit nothing. Your review is recorded verbatim under `llp/reviews/`; the other two families review the same revision blind.
> 
> Read, in this order: the three round-1 reviews; revision 2 in full; `git diff 8a2637efa5..9bc2ea9c83 -- llp/4001-snapback5-sql-front-end.rfc.md llp/4000-snapback5.rfc.md`; and whatever you need to check its claims: the committed Clique target `snapback4/crates/snapback4-sim/tests/fixtures/intent-clique.q`, calibration #19's program under `benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/astra/source/snapback/`, `snapback4/crates/snapback4-lang/src/{ast.rs,print.rs,lib.rs,bind/}`, the guide cards, `llp/3000.007-*` §5–§6, `llp/3000.013-*`, `llp/3000.015-*`, `llp/3000.009-*` §6.2, and the Supabase lanes under `~/clique-full-20260905/lanes/` if present on this host.
> 
> Answer five questions:
> 1. **Is each round-1 finding actually resolved by the text?** Go through §12's disposition table and say, per row, whether the disposition is real, partial, or only asserted, naming the sentence or the gap.
> 2. **The normative form table (§3).** Take every row: does the SQL spelling parse as Postgres (with the `snapback` stubs for category A), does the lowered Quarry bind on the unchanged binder, and is the stated difference the whole difference? Name every row that is wrong, and every form of the committed target, LLP 3000.015 or #19's program that has no row.
> 3. **Did revision 2 introduce a new defect?** Look especially at: the `alter publication` residency spelling and its default; `grant update (cols)` as immutability; `generated always as (snapback.count(…)) stored`; the `before update` trigger as the only transition form; `%type` arguments; `create procedure` as a job; SQL null semantics by guard insertion; the equivalence gate (can it be green while the arms still differ?); the pre-tests' stop rules (can either be gamed, and are the thresholds the right ones?); and §8's SURFACE class, masking dictionary, directional prediction, floors and fail rule (can the bet still pass without being true, or fail without being false?).
> 4. **Is the pipeline in §4 now bounded and correct** (pg_query → `ast::Document` → `print` → the unchanged binary)? What would a competent implementer still build wrong?
> 5. **§11's new questions (4–7)**, answered.
> 
> For each finding: severity (Blocker / High / Medium / Low), the exact section or table row, a concrete scenario or counterexample, and the smallest change that fixes it. Say plainly what is now sound. End with an overall verdict: READY, READY WITH CHANGES, or NOT READY.


### Verbatim review

Confirmed: the `immutable` check has no system-principal bypass (only asset checks consult `is_system()`), so immutability binds jobs, unlike rules. I have what I need. Here is the review.

# LLP 4001 revision 2: blind delta design review, Claude Opus 5.5

- **Reviewer:** Claude Opus 5.5 (Anthropic family). One session, no agents, read-only. Blind to the other families' round-2 reviews; I did not open their output files.
- **Reviewed:** `llp/4001-snapback5-sql-front-end.rfc.md` at `9bc2ea9c83` (revision 2), against revision 1 (`8a2637efa5`), the three round-1 reviews and the LLP 4000 diff.
- **Date:** 2026-09-24 (host clock).
- **Checked against:**
  - **Target and program:** `intent-clique.q`, and calibration #19's `schema.q`, `chat.q`, `insights.q`, `config.q`, `FINAL.md` and essay.
  - **Code:** in `snapback4-lang`, `ast.rs`, `print.rs`, `lib.rs`, `parser.rs`, `parser/programs.rs`, `bind/schema.rs` and `bind/catalog.rs`; in `snapback4-core`, `engine/rules.rs` and `engine/write.rs`.
  - **Guide:** the rules and sync cards.
  - **LLPs:** 3000.007 §6, 3000.009 §6.2 and §10.2, 3000.013, 3000.015, 4000 §1 and §9, 0329.
  - **Supabase lanes:** the three lanes under `~/clique-full-20260905/lanes/`.
- **Empirical checks:** every SQL spelling I call passing or failing below was run on **PostgreSQL 17.10**. I used a private scratch cluster in `/tmp` on its own socket, created and removed in this session. It had stubs for the `snapback`, `auth` and `cron` schemas as §3 describes them ("domains and functions"), plus the `authenticated` and `service_role` roles. I ran the RLS behaviour as a non-superuser role.
  - I did not run the binder. The only built `snapback4` binary on this host is ten days older than the current binder, so binder claims are from source.
  - Nothing in the checkout changed.
- **Verdict: NOT READY.** It is close; nothing needs a redesign.

## In brief

Revision 2 turns every round-1 Blocker the right way:
- the runtime is named as Snapback 4's;
- residency has a spelling with Snapback 4's default, and `E_SYNC` is back;
- the illustration is replaced by a normative table;
- the pipeline targets the AST the binder consumes;
- the premise is stated as an open question;
- two compiler-free pre-tests gate the build.

What is left is concentrated in six places:

1. **The equivalence gate rests on a printer that does not exist.** `print.rs` prints expressions and scalar types, not documents. §9 forbids changing `snapback4-*`, so the document printer is new code, and the gate uses that same printer on both sides. It can be green while the arms differ. (#1)
2. **The two central RLS rows are wrong.**
   - Rev 2's canonical spelling of `update <- E` admits no update at all in Postgres (verified: `UPDATE 0` on the owner's own row). The spelling Supabase builders actually write lowers to a different rule. (#3)
   - Quarry allows one rule per effect, and the transition trigger's combination with update policies is unstated. The natural reading (OR) is an authorization bypass on LLP 3000.015's own example. (#2)
3. **The pre-tests cannot do what they are registered to do.**
   - Pre-test 1's idiom clause ("refused in all three lanes") can never fire: no idiom appears in all three lanes' SQL.
   - Pre-test 1's one-third rate is decided by how three statement kinds the RFC never classifies are counted. (#4)
   - Pre-test 2 is asymmetric, and one answer decides it. (#11)
   - The "server-only" relief valve is not what LLP 3000.009 §6.2 specifies. (#6)
4. **§8's fail rule regresses LLP 4000's floor design.** A treatment that is truly +4 on `data_modeling` would pass only about one time in four to two in five, and the record would call the rest failures. One case of the rule is undefined. (#5)
5. **The table does not cover #19's program,** although the Revised line says it does. (#9)
   - It has no row for reference columns, which three other rows depend on. (#8)
   - Horizons have no Postgres spelling (`alter publication … add table … with` is a syntax error). (#10)
   - Six rows fail in Postgres as written. (#12)
6. **"No grant means nothing may"** inverts Supabase's default and binds jobs. It also breaks the byte-identity gate on the committed target itself. (#7)

## What is now sound

- **Runtime:** Snapback 4's (LLP 3000, 3000.007 §6, 3000.013, 3000.015), with LLP 4000 §4–§5 expressly excluded. LLP 4000 §13 was corrected in the same commit.
- **Residency default and admission.** An absent publication means online-only, and `E_SYNC` refuses rather than silently downgrading.
  - Bare `sync` with an inferred audience exists (`SyncAudience::Inferred`). Explicit audiences "must agree with that rule", so a publication statement loses no expressiveness for audiences.
- **Pipeline direction:**
  - Postgres's own parser (`pg_query`), in the CLI only;
  - lowering to the declaration AST;
  - the unchanged binary;
  - both arms from one build.
- **Rows that are right**, verified on Postgres where marked (✔):
  - identity call ✔, `comment on constraint` for coded uniques ✔, and the enum type and check ✔;
  - text-bound and format checks ✔, and the cap check ✔;
  - `generated always as (snapback.count('likes')) stored` ✔, which executes with an IMMUTABLE stub;
  - `union all` activity ✔, materialized Following and count views ✔, `snapback.recorded` ✔ and `snapback.day`;
  - the zero-preserving `left join` unread ✔;
  - `%type` ✔ (Postgres erases it to the base type, which is harmless to a transpiler that reads the source);
  - `into strict` with `no_data_found` ✔ (raises exactly `NOT_FOUND`);
  - `create procedure` with a nested per-iteration `declare` ✔;
  - `on conflict … do nothing returning * into r` ✔ (null row, `found` false);
  - `raise exception 'CODE'` ✔.
- **Policies:**
  - The stated grammar is Quarry's.
  - "Probes do not recurse" is the right thing to list: I reproduced Postgres's `infinite recursion detected in policy for relation` on the self-referencing membership policy.
  - An omitted `with check` behaves as Postgres does; `to authenticated` is ignored.
  - `now()` and ordered comparisons are refused in policies; `default now()` predicts; `clock_timestamp()` is refused.
- **§3.7's organizing rule**, "any construct whose Postgres meaning differs … gets a row", is the right rule.
- **§7's shape.** The pre-tests are compiler-free and gate the build. Their stop rules are registered, and "passing is permission to build, not confirmation".
- **§8's shape.** A symmetric masked SURFACE class, a registered directional primary with the counter-expectation beside it, language-relevant floor categories, one fail rule, a maturity gate, and "not passed never ships".

## 1. Are the round-1 findings resolved? (§12, row by row)

Verdicts are **real** (the text does it), **partial** (it does part, or creates a new defect) or **asserted** (the text claims it and the claim is wrong).

| §12 row | Verdict | The sentence, or the gap |
| --- | --- | --- |
| Premise overclaims | Real, two residues | The Summary and §1 state the open question and cite the counter-evidence. **Residue 1:** LLP 4000 §13 still says this bet "targets the item the record names most and the only surface this grader has scored at 94", the sentence just before the one corrected. **Residue 2:** §1 drops the most direct first-person evidence rather than quoting it whole (#18): #19 FINAL's "Compared with familiar TypeScript or SQL authoring, Quarry introduced learning cost…", and the essay's "With TypeScript functions or SQL I would have spent less time discovering syntax; … more time assembling the local execution semantics. That tradeoff is the central experience of this build." |
| Runtime; no `sync` spelling | Real for runtime, default and `E_SYNC`; partial for the spelling | The horizon/recipient `with (…)` is a Postgres syntax error (#10). Astra 19's "freeze holdouts and rubric before implementation" has no disposition; §9 step 5 still follows the lanes (#16). |
| §3 cannot spell the target | Partial | The table exists, and most target rows are right. But: <br>• there are no reference columns (#8); <br>• `home` lowers to the Global source, and `socialProfile`'s argument has no spelling (#9); <br>• #19's program is claimed and not covered (#9); <br>• four category-A spellings cannot be verified by the stated method (#10), and six rows fail in Postgres (#12). |
| Policies | Partial | The grammar, recursion, omitted `with check` and role mapping are addressed. Still open: <br>• the canonical `update <- E` spelling does nothing in Postgres (#3); <br>• the trigger's combination and its binding of jobs are unstated (#2); <br>• Astra 3's cross-image combination of several permissive update policies (draft→published) is unanswered (#2); <br>• `is null` is missing from the grammar (#15); <br>• Grok's `enable row level security` and owner bypass are unaddressed (#13). |
| `min`/`max`, `latest`, in-table counts | Real for `count` | `latest` is withdrawn and extrema are out. The parser's `sum … of`, `where` and `by` column forms have no spelling (#9). |
| Recorded attribution, `day()`, zero groups | Real | The rows are right; `snapback.recorded` depends on the missing reference row (#8). |
| The three additions (Astra 7) | Partial | The rows name the semantics. But `sequence` cannot be stubbed (#10); `written by` conflicts with the grant rule and the trigger form (#2, #7); none can bind until LLP 3000.015 lands, which §9 schedules after the lanes (#16). |
| Views, shapes, Following | Real, with gaps | `post_card` fails as written (#12). One shape over two sources has no spelling (#9). Postgres refuses policies on materialized views, so a maintain's `read <-` and `online only` have no home (#9). |
| Queries (`socialProfile`, `insights`, cursor) | Partial | `into strict`/`no_data_found` and `%type` work. `insights` fails twice (#12). The cursor rule refuses #19's two-page `people` (#9). |
| DML, statement grammar, jobs, schedules | Mostly real | `once => array[…]` fails for the target's own key (#12). The conflict-target rule misstates `if absent` (#13). The cron grammar is unstated (#19). |
| Value semantics | Partial | The null ruling is asked and the operator list given. Time and durations, integer width, bare `text` meaning `<=10000`, row-null, `in`/`not in` with nulls, and `sum` over an empty set are unaddressed (#13). "`min`, `max` as scalars" are not Postgres functions (#12). |
| §3.7 incomplete; Quarry names wrong | Partial | The names are fixed and the rule is right; the list is not exhaustive by that rule (#13). |
| Immutability inferred from policies | Real as a spelling; new defect | `grant update (cols)` is the right idiom; "no grant means nothing may" is wrong (#7). Astra 4's REFERENCES/CHECK half has no disposition (#8). |
| Device admission a silent downgrade | Real | `E_SYNC` is restored and the "90%" claim removed. |
| The pre-test measures reading | Partial | Pre-test 1's idiom clause cannot fire and its rate is decided by classification (#4). Pre-test 2 is asymmetric and noisy (#11). |
| The comparison passes by construction | Partial | The structure is right. The floors regress, the all-zero case is undefined, and the primary is exposed to the scorer's prior (#5). The masking dictionary leaks the arm (#14). |
| Lowering target; `sqlparser`; diagnostics | Partial | The direction is right, but the printer does not exist and the gate trusts it (#1). The diagnostic tier is sized by a measurement a compiler-free pre-test cannot make (#17). |
| LLP 3000.009 §6.2 | **Asserted, and misdescribed** | #6. |
| One spelling, one code, `api.ts` | Real | Decided, or asked in §11. |
| Evidence rows overstate | Real, over-corrected | See the first row. |

**Round-1 findings with no §12 row:**

| Round-1 finding | Where it is taken up |
| --- | --- |
| Astra 4: REFERENCES and general CHECK | #8 |
| Astra 17 and Opus 10: the unit of classification; about half a phrase per run | #5 |
| Astra 19: holdouts and rubric frozen before implementation | #16 |
| Grok: policies are inert without `enable row level security`, and owners bypass them | #13 |
| Grok: refusing `create index` while the control keeps `by` lines | #9 |
| Opus 5(b): `decimal`, `money`, `json`, `bytes`, bounded lists | §2 "Forms with no row" |
| Opus 8: parameter/column name collisions | §4 |

## 2. The normative form table (§3)

### Rows that are wrong or incomplete

| Row | What is wrong | # |
| --- | --- | --- |
| §3.1 `effect push` | The composite type has no Quarry counterpart (`EffectDecl` has no payload type), so it is checked against nothing. `from`, `secrets`, attempts, backoff, deadline and cancellable (`WorkDecl`) have no spelling. | 19 |
| §3.1 `viewer` | Supabase's `auth.uid()` returns `uuid`; Snapback principals are text and include `'service:x'`. The `principal` type has no row. | Q5 |
| §3.2 `image`/`video`/`once` | `photo snapback.image(10000000)` fails: `ERROR: type modifier is not allowed for type "snapback.image"`. Domains take no typmods. | 10 |
| §3.2 `immutable` | "No grant means nothing may". | 7 |
| §3.2 `search` | Contradicts §3.7 C's refusal of `create index`. Against stubs: `access method "snapback_words" does not exist`. | 10 |
| §3.2 `retain`, `expire at` | `ERROR: unrecognized parameter namespace "snapback"`. | 10 |
| §3.2 `online only` | The lowered form must be *no line* (Quarry's default), not `online only`. Otherwise byte identity fails on the target. | 1 |
| §3.2 `sync` | The `with (snapback.horizon = …, snapback.recipient = …)` clause is `ERROR: syntax error at or near "with"`. Lowered bare `sync` is not byte-identical to the target's `sync public` / `sync to members[…]`. Publication means residency, not Realtime. | 10, 1, 13 |
| §3.2 `written by` | A CHECK reads as a write predicate, not as owner-private projection. It conflicts with the grant rule, and §3.7 does not list it although the row points there. | 7, 13 |
| §3.2 `sequence by` | `ERROR: type modifier is not allowed for type "snapback.sequence"`. It needs a reference to the parent (`E_SEQUENCE_PARENT`), and there is no reference row. | 8, 10 |
| §3.3 `delete <- expr` | An RLS-denied delete is `DELETE 0` in Postgres (verified) and `E_RULE` in Snapback. Not listed. | 13 |
| §3.3 `update <- expr` | Admits no update in Postgres. | 3 |
| §3.3 `update (old, next)` | Combination with update policies is unstated; the form binds jobs in Postgres but not in Snapback; the example fragment does not parse; it is not Muse's form. | 2 |
| §3.3 several rules | The cross-image combination of several permissive update policies is unstated. | 2 |
| §3.3 service grant | `to service_role` loses which service (`'service:pusher'`). | 15 |
| §3.3 grammar paragraph | No `is null`. No named extra-column probe equality (`role = 'admin'`, needed by the target's `members` insert rule). For a *read* policy the rewrite should be `expire at`, not "move into the mutation". | 15 |
| §3.4 `postCard` | `coalesce((select c from reply_count c …), 0)` gives `ERROR: COALESCE types reply_count and integer cannot be matched`. It selects the row, not the count. | 12 |
| §3.4 spread | Inside plpgsql after `into strict p`, the natural `to_jsonb(p) \|\| jsonb_build_object(…)` is refused by §3.7 C. | 9 |
| §3.5 `home` | Selects `from activity_card`, the Global source, so it lowers to `return activity …`, not `following …`. | 9 |
| §3.5 `people` | Where `snapback.bound(q, 100)` goes in a one-`select` function is unstated. Argument typmods are "ignored" silently, though `pg_query` sees them. | 19 |
| §3.5 `socialProfile` | Its argument, `text 3..20 format handle`, has no spelling. | 9 |
| §3.5 `insights` | `ERROR: operator does not exist: json \|\| json`. Also plpgsql's `for d in a..b` is inclusive: `10-6 .. 10+1` iterated **8** times, where `range(day(now) - 6, day(now) + 1)` gives 7. The stated difference is empty. | 12 |
| §3.5 `trending` | Omits the target's `and .at <= now`. The Trending predicate needs both endpoints (`E_QUARRY_MAINTAIN_EXPIRE` text), and the "recognized interval shapes" are unstated. | 12 |
| §3.5 server-only reads | Not LLP 3000.009 §6.2. | 6 |
| §3.6 `if absent` | Quarry's `if absent` absorbs *any* readable unique clash (rules card), which is Postgres's **targetless** `on conflict do nothing` (verified valid). Requiring one target, and refusing `(id)` when another key exists, makes the text claim less than the program does. A hidden clash is `E_RULE`. | 13 |
| §3.6 `update … if cond` | A false condition is `E_CONFLICT` (or `NOT_FOUND` on an unreadable target) in Snapback, and `UPDATE 0` in Postgres (verified). Not in §3.7 B. | 13 |
| §3.6 `emit … once` (marked ✓) | `array['alice'::text, now()]` gives `ERROR: ARRAY types text and timestamp with time zone cannot be matched`. The target's key `[p.principal, periodEnd]` is heterogeneous. | 12 |
| §3.6 job | plpgsql requires `declare p record` at the top for `for p in select`. The lowering must exempt that record from "a prelude local assigned by the sweep is refused". | 19 |
| §3.6 schedule | `call daily(period_start, period_end)` registers, but fails when pg_cron runs it (`column "period_start" does not exist`, verified). The admitted cron grammar is unstated. | 13, 19 |
| §3.6 presence | `… then perform snapback.emit(…) end if` is a syntax error (missing `;`, verified). | 12 |

Every other row parses and executes against the stubs, lowers to a form the current parser accepts (except the LLP 3000.015 rows, which cannot bind until that spec lands), and states its difference completely.

### Forms with no row

- **Committed target:**
  - reference columns (`parentId: posts ?`, `postId: posts`) (#8);
  - the `principal` type;
  - the `time`/`int`/`bool` mapping (implied, never stated; width and domain in #13);
  - nullable arguments (only the cursor's `default null` is shown);
  - an argument with a minimum length and a format (`socialProfile`);
  - one named shape over two sources (`home`/`global`);
  - probe extra-column equalities in policies.
- **LLP 3000.015:** the rows exist. What is missing is the interaction of `written by` with grants, the admin policy and the transition rule (#2, #7), and its three diagnostics in the tier.
- **#19's program:** the list in #9.
- **Quarry forms a builder can reach, in none of the three programs:**
  - types `decimal`, `money`, `json <=N`, `bytes <=N` and bounded lists;
  - modifiers `query … held`, `mutation … predicts` and `native`;
  - `route`/`action`, `use server` and `use personas`;
  - `schedule … as service:x`;
  - explicit `chunk`;
  - maintain `read <-` overrides (Postgres: `"follower_count" is not a table` for a policy on a materialized view);
  - `walk`.

  None of these has a row or a GAP entry.

## 3. Findings, ranked

### 1. High: §4, §2, §1 row 11, §10: the gate's printer does not exist, and the gate trusts it on both sides

**Problem.**
- §1 says "`print.rs` prints a document back to Quarry". It does not. `print.rs` (165 lines: "Quarry text from syntax, for source-aware diagnostics and pasteable rewrites") exports `expression`, `read_expr`, `scalar_type` and `quote`.
- Nothing in `snapback4` prints a `Document`, `TableDecl`, `RuleDecl`, `SyncDecl`, `IndexDecl`, `ViewDecl`, `FeedView`, `MaintainDecl`, `ShapeDecl`, `ProgramDecl`, `Stmt`, `ScheduleDecl` or `EffectDecl`.
- §9 forbids lanes to change `snapback4-*`, so the document printer is new code in `snapback5`.

**Scenario.**
- The gate compares `print(lower(sql))` with the pinned Quarry "under `print`", that is `print(parse(pinned.q))`, both through the new printer.
- A printer that drops a table's `immutable` line, a horizon, or `else CODE '…'` loses the same text on both sides, so the gate is green.
- The control's binary reads the original `.q`; the SQL arm's binary reads the lossy text. `immutable` decides Following admission, recorded attribution and job cursors (`E_TIMELINE_SHAPE`, `E_JOB_CURSOR_INDEX`), which are the facts "identical by construction" is meant to fix.
- The gate's second clause catches this only if "the control's" means the original file, in which case the byte-identity clause is redundant.

**A second gap.** The gate samples one program, while builders write their own. §10 names "the blind writing test's programs, lowered and checked" as the second sample. But pre-test 2 is compiler-free and runs before the transpiler exists, and nothing schedules lowering its programs later.

**Fix.**
1. Name the document printer as lane work, with a round-trip property: `parse(print(parse(q)))` equals `parse(q)` with sites stripped, for every `.q` in the guide corpus, the committed target and #19's four files.
2. Make the unchanged tools the oracle: the bound schema and program IR (`check --json`, sites stripped) of the transpiled text must equal that of the **original** pinned `.q`.
3. State the pinned Quarry in the lowering's canonical form: bare `sync`, and no `online only` line.
4. Put the lowering of pre-test 2's programs into §9 step 4.

### 2. High, security-relevant: §3.3 `update (old, next)` row and the "several rules" row: the combination is unstated, and the natural reading bypasses authorization

**Problem.**
- Quarry allows one rule per effect. The rules card says "Each of `read`, `insert`, `update` and `delete` takes one rule", and `bind/catalog.rs:117` refuses "duplicate update rule … keep one rule per effect".
- An update policy plus a transition trigger therefore lowers to two update rules. Either the binder refuses, or the lowering merges them, and the only merge the table states is "several permissive policies (`or`)".
- In Postgres, a `before update` trigger *restricts*: it ANDs with the policies.

**Scenario 1: an OR merge escalates privilege.**
- LLP 3000.015 §1's own example: admins may update a member row, but the mark is not theirs to write.
- In SQL that is an admin update policy plus a trigger `if not (new.read_up_to = old.read_up_to) …`.
- Merged with OR, it becomes `admin(old) and admin(next) or next.readUpTo = old.readUpTo`. Any member can then rewrite any member row, including `role`, as long as the mark is untouched.

**Scenario 2: the converse inversion.** #19's `receipts` has a transition *permission* and no other update rule. Spelled as rev 2's trigger on a table with RLS enabled and no update policy, Postgres admits no update, while the lowered rule admits the owner's.

**Two more mismatches.**
- **Jobs.** Postgres fires a trigger for every writer, while in Snapback "the system principal consults no rules". The SQL text binds jobs; the lowered program does not.
- **Provenance.** This is not "the `before update` trigger form the Muse lane wrote".
  - Muse wrote named trigger functions (`enforce_message_windows`, `trg_convo_admin`) using `extract(epoch …)`, `->>`, `::int`, `NEW.edited := true` and `TG_OP`, all refused here.
  - Rev 2's form, a plpgsql fragment passed as a trigger-argument string to `snapback.transition`, occurs in no lane.
  - Its example fragment `if not (…) then raise exception 'E_RULE'` is a syntax error: I ran it in a `do` block, and it has no `; end if;`.

**Fix.**
1. Add one sentence to §3.3: *"A table's update rule is one `update (old, next)` rule: (⋁ permissive `using`)[old] ∧ (⋁ permissive `with check`, else their `using`)[next] ∧ (⋀ restrictive) ∧ (⋀ transition conditions)."* This also answers Astra 3's draft→published case.
2. Add to §3.7 B: transition conditions do not bind jobs.
3. Admit the ordinary two-statement form Muse wrote instead of the string-argument form: a `returns trigger` function whose body is `if <cond over OLD/NEW> then raise exception '<CODE>'; end if; return new;`, plus `create trigger … before update … execute function f()`.

### 3. High: §3.3 `update <- expr` row: the canonical spelling admits no update in Postgres

**Evidence.**
- Setup: RLS on, a select policy `using (true)`, and a single policy `for update with check (owner_id = auth.uid())`.
- The owner's own `update docs set title = 'x' where id = 'd1'` returns **`UPDATE 0`**. A permissive policy with no `USING` contributes no row qualifier, and with none the qualifier is false.
- With `using (owner_id = auth.uid())` instead, the same update returns `UPDATE 1`.

**Meaning.**
- Quarry's single-image rule reads only the proposed row (`engine/rules.rs:265`: `RuleTerm::Field | NextField => next.field(…)`).
- In Postgres terms that is `using (true) with check (E)`. The row's stated difference covers the *other* omission.

**Scenario.**
- Muse writes its update policies as `using (E) with check (E)` (`prof_upd`, `post_upd`, `msg_upd`, the conversation policy). Under the table these lower to a two-image transition, not to the target's `update <- .principal = viewer` or `update <- .authorId = viewer`.
- So the pinned SQL program can pass byte identity on `profiles` and `posts` only with the `with check`-only form. The SQL card and the reading judgment would then teach that form, and on the Postgres a Supabase builder already has, it updates nothing.

**Fix.**
- Canonicalize `using (E) with check (E)`, and `using (E)` alone, to `update <- E` when `E` reads only immutable columns and `auth.uid()`. Old and next then agree, so nothing changes semantically.
- Refuse `with check` alone, with that rewrite.
- Add to §3.7 B: a single-image rule checks only the proposed row.

### 4. High: §7 pre-test 1: the idiom clause cannot fire, and classification decides the rate

**Evidence.** The corpus on this host, excluding Astra's `m7/inherited` duplicates, is about 355 top-level statements: Astra 105, Grok 44, Muse 206.

**The idiom clause is unsatisfiable.** None of the four idioms appears in all three lanes' SQL, so "refused in all three lanes" can never hold.

| Idiom | Astra | Grok | Muse |
| --- | --- | --- | --- |
| `create policy` (the membership policy) | 0 | 0 | 45 |
| Counter trigger | yes | none (Grok's SQL has no functions or triggers) | yes |
| Transition trigger | — | — | yes |
| Feed read | none: its six routines are counters, visibility, expiry, `clqfa_mutate` and a replay procedure | none: reads are in Express | yes (`feed`) |

**The rate clause turns on classification.**
- **Unclassified kinds:** 104 statements (29%) are kinds the RFC never classifies: `drop … if exists` (59, mostly Muse's idempotent scripts) and `alter table … enable row level security` (45).
- **Ambiguous kind:** another 44 are `create [unique] index`. §3.7 C calls them refused "with the rewrite: delete it", while pre-test 1's classes include "admitted after a mechanical rewrite".
- **Effect on the rate:**

  | What is counted as refused | Refusal rate, roughly |
  | --- | --- |
  | Unambiguous refusals only | 1 in 8 |
  | Plus the 44 indexes | about a quarter |
  | Plus `enable row level security` | over a third |
  | Plus the drops | over half |

  Three classification choices decide the one-third threshold, not the surface.
- **Unit:** each counts as one statement, so a mutation dispatcher that fills most of a 95-line file weighs the same as one `enable row level security`.
- **The "server-only" class** absorbs every read the lowering can't take (#6).

**Fix.**
1. Make the idiom clause per instance: stop if the membership policy, a counter, a transition rule or the feed read is refused *wherever it occurs*.
2. Register a class for every statement kind in the corpus before running, including `enable row level security`, `drop`, `create index`, `grant`, `alter table` and `begin`/`commit`.
3. Count plpgsql body statements, not top-level ones.
4. Use a third-family classifier, with the rubric by hash.
5. Use "server-only" only where §6.2's admission holds.
6. Justify the one-third threshold; it is round 1's "for example".

### 5. High: §8: the fail rule makes a true bet fail more often than not, and one case is undefined

**Floors.**
- LLP 4000 §9.3 used margins of 2 × run-to-run sd on five categories. A floor failed only "in the median run and in the mean of three", because "with five tests at once, a single trip on noise is expected". Its §12 records "thirteen uncorrected floors" as a round-1 defect.
- Rev 2 uses **1 sd**, **seven** categories, no conjunction and no stated trip rate.
- At N = 3 per arm, the difference of means has sd ≈ 0.82 σ. Each floor then trips on noise with p ≈ 0.11, and at least one of seven trips with p ≈ 0.56 if independent. Correlation lowers that, but not to LLP 4000's few percent.
- LLP 4000 §1 lists sds for holistic, queries, offline, client, writes and `setup_and_docs` only. `diagnostics_dev_loop`, `authorization` and `data_modeling` (the primary's "one scorer sd") have none.

**Primary.** A three-run mean difference of at least +3, with σ ≈ 2.6–3:

| True `data_modeling` effect | Chance the primary is met |
| --- | --- |
| 0 | about 0.08–0.11 (false pass) |
| +3 | about 0.5 |
| +4 (the 90 → 94 motive) | about 0.67 |

**Combined.**
- A treatment that is truly +4 on `data_modeling` and neutral elsewhere passes with probability about 0.67 × (0.45–0.65) × P(reading A) × P(correctness). That is roughly one in four to two in five.
- Yet §8 says "a null result on `data_modeling` is a failed prediction, and the record says so".

**Undefined case.** "Zero in both arms … supports nothing." Does reading (A) then hold, so the bet can pass on the primary alone? Or not, so it fails whatever `data_modeling` does? (LLP 4000 §9.1: "the named bet is not supported.")

**Unit.** At about half a phrase per run, "SURFACE ≤ control in every paired run" means one phrase in one pair decides.

**Scorer prior.**
- gpt-6-astra scores the primary from unmasked narrative files; its family wrote the 94 note crediting "SQL familiarity and composability".
- Masking protects the mechanism, not the primary. Rev 1's risk "the grader's prior cuts both ways" was dropped from §10.

**Fix.**
1. Restore LLP 4000's floor design: 2 × sd, median-and-mean, a stated trip rate, and an sd for every floored category.
2. State P(pass | +4) and P(pass | 0). Either raise N, or record "not shown at N = 3" separately from "failed".
3. Define the all-zero case.
4. Sum SURFACE over the three pairs rather than requiring every pair.
5. Also score `data_modeling` from masked files, or by a second scorer family, and require both.

### 6. High: §3.5 last row, §6, §7: the relief valve is not LLP 3000.009 §6.2

**What §6.2 specifies.**
- A Quarry declaration (`query nearby(…): sql reading places_geo returning places`) over declared projections.
- "A server-only query in the store's dialect". It "never reads the managed row and entry tables".
- Its inputs are public projections, or per-viewer views generated from rules that translate exactly; anything else must be a declared `channel`.
- It returns ids of one table, or computed values.
- "A SQLite-backed application writes SQLite's dialect."
- "Implementation remains increment D", which "still depends on C1's key bound".

**What rev 2 says.** "An unlowerable read-only function becomes a server-only SQL read … in both arms."

**Why that fails.**
- Muse's `feed`, `thread`, `convo_list`, `history` and `insights_*` read managed tables, join rule-filtered tables and return rows. §6.2 refuses all three.
- On a SQLite-backed store the SQL would be SQLite, against ruling 1.
- Pre-test 1's "server-only" class, which does not count as refused, therefore has no bound.

**Fix.**
1. Describe §6.2 as it is.
2. Classify a read as "server-only" only where §6.2 admits it.
3. Name the comparison's store and the dialect of SQL reads on it.
4. Since increment D is gated on C1, withdraw the §3.5 row now and count unlowerable reads as refused.

### 7. High: §3.2 `immutable` row and §3.7 B: "no grant means nothing may"

**Problem.**
- `Constraint::Immutable` is enforced in `engine/write.rs` with no system-principal bypass; only asset checks consult `is_system()`. It binds jobs.
- A Postgres column grant to `authenticated` binds neither `service_role` nor the owner.
- Supabase's default privileges grant table-wide UPDATE to `authenticated`.

**Scenarios.**
1. **The target itself.** The committed target's `members` and `messages` have no `immutable` line and no update rule. Under this rule every column lowers immutable, so the byte-identity gate fails on the target, and a job can no longer tombstone a message or repair a mark.
2. **LLP 3000.015's mark.** For the owner to advance `read_up_to`, the SQL must `grant update (read_up_to) … to authenticated`. In Postgres that lets any authenticated user who passes the admin policy write it, which is the opposite of `written by`.
3. **A forgotten grant.** Forgetting it leaves an update rule that can change nothing, and the row names no diagnostic.

**Fix.**
- Lower `immutable` from the complement of `grant update (cols)` only when a grant exists; with none, emit nothing, which is Quarry's default.
- Exempt `written by` columns.
- State in §3.7 B that immutability binds every writer, jobs included.

### 8. High: §3.2 (no row): reference columns have no spelling, and three rows depend on them

**Problem.**
- The target has `parentId: posts ?` and `postId: posts` (twice). #19 has `parent`, `post` ×4, `chat` ×6, `message` ×3 and `quote`.
- Rev 2 never mentions `references` or foreign keys.
- Three rows need the notion:
  - `snapback.recorded(post_id, 'author_id')` needs `post_id` to be a reference (dotted maintain keys are recorded reference paths);
  - `sequence by` needs one (`E_SEQUENCE_PARENT`);
  - so do Following's mapped fields.

**Scenario.** A builder writes `post_id snapback.id not null references posts (id)`.
- If that lowers to `postId: posts`, Postgres semantics are not Snapback's: in Postgres a like for a missing post fails, and a delete fails or cascades. Snapback references are typed ids with no integrity (Astra round 1 #4).
- If it lowers to `postId: id`, `receivedLikes` and `dailyLikes` refuse.

**Fix.**
- Add a row: `col snapback.id [not null] references t` → `col: t [?]`, refusing `on delete`/`on update`.
- Add to §3.7 B: Snapback enforces neither existence nor deletion.

### 9. High: Revised line, §3, §12: the table does not cover #19's program, and the target's `home` is wrong

**Forms in #19 with no row, or refused:**
1. `fn` helpers: the constant `fn editWindow(): 60000`, and block helpers (`receiptState`, `otherProfile`, `unread`, `reactionList`).
2. `a if c else b` (messageCard `type`, `send`'s `expiresAt` and `preview`) and `??`. These need `case` and `coalesce`, which rev 2 refuses "outside the recognized shapes" without ever stating the shapes.
3. `first(…)`, `group(rows, 'emoji')`, `slice(body, 0, 80)` (`substr` is 1-based), `count(text)` and `count(list)`.
4. Two-argument `min`/`max`. The admitted builtins list them "as scalars", but Postgres has no such functions (`function max(integer, integer) does not exist`, verified). Postgres uses `least`/`greatest`, which are unlisted.
5. `video.duration`.
6. Duration arithmetic on `time`: `now + 4s`, `now + shortTTL()`, `now - m.at <= editWindow()`, and `time default 0`. Quarry durations are integer milliseconds in any expression (LLP 3000.013 §2.4). SQL is `timestamptz ± interval`, and `extract(epoch …)` is refused.
7. List arguments (`ids: [messages] <=50`).
8. `mutation … : server` (`edit`, `deleteMessage`).
9. The explicit index `by byActorTime` and `merge feedEvents … by byActorTime` (`homeFeed`). `create index` is refused, while LLP 3000.013 §2.3 keeps `by` lines in the control as "optional tuning".
10. Two pages in one query (`people`, `homeFeed`), refused by §3.5's cursor rule.
11. `online only` on six maintained views. Postgres refuses both policies on materialized views and adding them to publications.
12. Multi-file programs and module-qualified targets (`: insights.daily`).
13. `text 3..20 format handle` arguments (`profile`, `saveProfile`, and the target's own `socialProfile`).
14. `count … where` / `by`, and `sum … of`, as in-table columns (all admitted by `parse_column`).

**The target's `home`.** It applies `activityCard` to `following`, and `global` applies it to `activity`. A SQL view binds one source, so the `home` row, which reads `activity_card`, lowers to the Global feed.

**Fix.** Either add the rows, or strike "#19's program" from the claim and register each form as a GAP the pre-tests count. Most have natural Postgres spellings:
- `language sql immutable` helpers;
- `case`, `coalesce`, `least` and `greatest`;
- `substr`, with its offset stated;
- `interval` arithmetic, with the `time` domain stated;
- `snapback.id[]` arguments with a bound;
- a server marker;
- a cursor attached per `return query`;
- shape functions over a row type, PostgREST's computed-field idiom (for example `activity_card(a activity)`), so one shape can serve two sources.

### 10. High: §3.2 residency row and §3.7 A: horizons have no Postgres spelling, and four category-A rows cannot be verified as §3 specifies

**Evidence.** Each of these was run against the stubs.

| Spelling | Result |
| --- | --- |
| `alter publication … add table … with (…)` | Syntax error. `ADD TABLE` takes no `WITH`, so `pg_query` rejects it too. Horizons (`last 10000 by .at` in #19, and throughout the sync card) and recipients (`by .personId`) have no spelling. |
| `snapback.image(N)`, `snapback.video(N)`, `image_once`, `snapback.sequence(col)` | Refused: domains take no typmods. Only a C base type with `typmod_in` can take them. |
| The `with (snapback.retain/expire_at = …)` reloptions | Refused at `create table`. |
| `using snapback_words` | Needs an access method and operator classes, not just "domains and functions". |

**Fix.** Respell as statements that execute against stubs. Otherwise, state that verification is a raw `pg_query` parse only and name the rows it covers.
- **Residency:** `select snapback.publish('messages', horizon => 'last 500 by at', recipient => 'principal');`, a call like `cron.schedule`.
- **Sequence:** `ordinal bigint generated always as (snapback.sequence(conversation_id)) stored`. Postgres's own "system-assigned, cannot be supplied" meaning is `E_SEQUENCE_SUPPLIED`.
- **Retention:** `select snapback.retain('messages', 'delivered-history');`.
- **Media:** a CHECK or a call for the byte bound.

### 11. High: §7 pre-test 2: asymmetric, before its input exists, and one answer decides it

**Problem.**
- The SQL card is written in lane (e), after the pre-tests (§9 step 3 comes before step 4). The test therefore uses either the §3 table (unstated) or a day-old draft, against a Quarry card refined over twenty waves.
- `snapback4 check` can judge the Quarry arm's refusals, but the SQL arm's can be judged only by hand. The two sides of an "exceeds" comparison use different instruments.
- N = 3 per arm, five scenarios each, and "exceeds"/"below" with no margin or tie rule: one statement, or one answer out of 15, decides.
- Two scenarios presuppose missing content:
  - "an edit after its window" needs an edit mutation, which the target's messaging half lacks;
  - "a mark advance across 10,000 messages" needs LLP 3000.015's row-keyed view, which is not in the Quarry card and not implemented (no `E_VIEW_KEY` anywhere in `snapback4/`).

**Fix.**
- Freeze both cards by hash.
- Judge both arms' refusals under one hand rubric.
- Register margins: for example, stop if the refusal rate is more than 10 points worse, or accuracy is 3 or more of 15 worse.
- Require the edit window and the mark in the writing task.

### 12. Medium: rows that fail in Postgres as written

These are covered in §2 above:
- `post_card`'s `coalesce`;
- `insights`' `json || json`, and its inclusive-range off-by-one;
- `once => array[text, timestamptz]`;
- the missing `;` in the presence row;
- the transition fragment;
- scalar `min`/`max`;
- `trending`'s missing endpoint.

**Fix.** Run every row through the stub database now, and publish the transcript with the next revision. Those rows are the pre-tests' input. For `once`, use `once => row(p.principal, period_end)`.

### 13. Medium: §3.7 B is not exhaustive by its own rule

Each item below has a Postgres meaning that differs from its Snapback meaning. Items marked ✔ were verified against the scratch cluster.

- **Policies are inert without `enable row level security`, and owners bypass them** ✔. A select policy without `enable` let the reader see another user's rows.
- **RLS-denied `update`/`delete` return `UPDATE 0`/`DELETE 0`** ✔, where Snapback returns `E_RULE` or `NOT_FOUND`.
- **Conflict targets.** Quarry absorbs any readable unique clash, and a hidden clash is `E_RULE` (#2's table row on `if absent`).
- **References** (#8).
- **Value domains:**
  - bare `text` means `text <=10000` (LLP 3000.013 §12.3);
  - `int` is 53-bit;
  - `time` is integer milliseconds.
- **Publication is residency, not Realtime.** Unpublished tables still answer live queries from the server (LLP 3000.007 §6.5). Supabase builders will publish tables to get "realtime" and meet `E_SYNC`.
- **Writer binding:** transition conditions do not bind jobs, while `grant`-derived immutability does.
- **`snapback.written_by`** is not in the list, although its row points there.
- **`period_start`/`period_end`** are engine-supplied names ✔ (the command fails when pg_cron runs it).
- **Parameter vs column names (§4).**
- **`r is not null` on a record** is false when any field is null ✔.

### 14. Medium: §8's masking dictionary leaks the arm

**Problem.** The dictionary omits the words the builders' notes will contain:
- `snapback5` and `snapback4` (in every CLI invocation);
- `Postgres`, `Supabase`, `RLS`, `trigger`, `procedure`, `function` and `cron`;
- `.sql` and `.q`;
- snake_case versus camelCase identifiers;
- every code span.

**Fix.**
- Replace all code spans and identifiers with placeholders, and map the product vocabulary to neutral tokens.
- Register a blindness check: if a classifier can guess the arm from the masked notes above chance (say 65%), extend the mask before the counted classification.

### 15. Medium: §3.3 policy grammar

**Problem.**
- The grammar has no `is null`. Under SQL null semantics, `= null` rules therefore cannot be written. Muse's `is_member` filters `m.left_at is null`, so it is not an inlinable probe.
- The grammar has no named extra-column probe equality (`role = 'admin'`), which the target's `members` insert rule needs.
- `to service_role` drops the service's name.
- For a read policy, the refusal rewrite should be `expire at`.

**Fix.**
- Admit `is [not] null` over a column.
- Admit `and t.col = <literal>` in probes.
- Spell service grants as `auth.uid() = 'service:pusher'`.

### 16. Medium: §9's order

**Problem.**
- Step 2 ("`snapback4 check` on the lowered Quarry") and each lane's gate need LLP 3000.015 in the binary. It is not implemented, and §9 lands it at step 5, after the lanes.
- The holdouts, the rubric and the dictionary are committed by hash at step 5, after implementation. LLP 4000 §9.5 requires them "before the first slice begins" (Astra 19).

**Fix.**
- Make LLP 3000.015 landed a precondition of step 2.
- Commit the instruments before step 4.

### 17. Medium: §2 and §4: "the treatment is the spelling and nothing else"

**Problem.**
- `why`, `--residency`, `--cost`, runtime refusals and tier-2 diagnostics print Quarry. #19's `diagnostics_dev_loop` note credits `why chat.send`.
- If `snapback5 dev` hands generated `.q` files to `snapback4 dev` from the project tree, the builder also has Quarry files in their tree.
- The tier's scope, "every code … the Supabase corpus can produce (measured in §7)", cannot be measured compiler-free.

**Fix.**
- List what the SQL arm reads in Quarry, and count it under SURFACE.
- Keep generated Quarry out of the project directory.
- Size the tier after lane (c).

### 18. Low: residual premise wording

**Problem.**
- LLP 4000 §13's first sentence still carries the withdrawn overclaim.
- §1 omits #19's own trade-off sentence, which cuts both ways.

**Fix.** Correct §13, and quote #19 FINAL's comparison line and the essay paragraph in full.

### 19. Low: smaller gaps

- Does every *named* unique constraint become a client-visible code, or only a commented one? Say "commented only".
- The cron grammar is unstated. `*/7 * * * *` is not a fixed period.
- Argument typmods are "ignored" silently. `pg_query` sees `varchar(100)`, so honour it as `<=100`, or refuse it.
- `%type` of a non-id column could carry bounds and a format. That would close the `socialProfile` argument gap for free.
- The effect's composite type is checked against nothing.
- The `for p in select` record must be exempt from the prelude-local rule.

## 4. Is the §4 pipeline now bounded and correct?

**Bounded in shape, not yet correct.**

The route `pg_query` → `ast::Document` → print → the unchanged binary is right. Four pieces are missing:

1. **The document printer (#1).** Its target must be the parser's output subset of `ast::Document`, not the whole type:
   - `ReadExpr.computed`, `MergeExpr` and `MergeLane` are products of the planner and the intent pass;
   - `read_with` renders two read spellings depending on `order_keys`.
2. **A SQL semantic layer, which §9's lanes never name:**
   - a catalog built from the DDL;
   - Postgres name resolution (aliases, correlated subqueries, `%type`);
   - plpgsql scoping;
   - enough typing for null guards.
3. **Two-level parsing.** `pg_query`'s plpgsql parser returns embedded SQL as strings. Each must be parsed again, with offsets composed for the span map.
4. **Span-map ownership.** The span map must be emitted by the printer.

**What a competent implementer would still build wrong:**

| # | Wrong build | Where it comes from |
| --- | --- | --- |
| 1 | `update <- E` from `with check` alone; Muse's idiom lowered to a transition | #3 |
| 2 | The trigger ORed with the update policies | #2 |
| 3 | `immutable` on every column of tables that have no grant | #7 |
| 4 | `references` dropped to `id` | #8 |
| 5 | Name collisions resolved by guessing: in `language sql`, Postgres binds the **column**, so `where handle = handle` returned every profile (verified); plpgsql raises `column reference "handle" is ambiguous` (verified). The target's `socialProfile(handle)` and nearly every #19 mutation (`chat`, `principal`, `message`, `post`) collide. Refuse unqualified collisions, with the rewrite `social_profile.handle`. | §4 |
| 6 | `a..b` bounds copied, giving eight days | #12 |
| 7 | `is [not] null` on a record given SQL semantics. Refuse it, with the rewrite `found`. | #13 |
| 8 | `not in (select …)` canonicalized to `not exists`, which is wrong over nullable columns | §5 Q4 |
| 9 | `*/7` accepted as `every 7m` | #19 |
| 10 | Every named constraint turned into a code | #19 |
| 11 | Generated `.q` files written into the project | #17 |

## 5. §11's questions 4–7

**4. One spelling. Yes, canonicalize, on two conditions.**
- Canonicalize only equivalences that hold under the null ruling. Refuse `not in (select c …)` over a nullable `c`, with the `not exists` rewrite.
- Include #3's canonicalization: `using (E) with check (E)` over immutable columns becomes `update <- E`. It is the most valuable one.
- `check` should print the canonical form once, as a note.

**5. Null semantics. SQL's**, because the premise is the reader's prior. But:
- Specify it as a two-sided translation (a "true" form and a "false" form for each condition), not guards on atoms, since `not` and `or` over unknown need it.
- Add `is [not] null` to the policy grammar.
- Refuse `is [not] null` on records.
- List Snapback's deliberate departures in §3.7 B:
  - an absent aggregate group reads 0;
  - a count view read `into` a variable gives 0 where Postgres leaves null.
- None of the three invertible shapes needs a guard, because `viewer` is never null. A guard in a read rule is a sign the rule is outside them.

**6. The viewer's name.** Use `auth.uid()`, but decide its type.
- Supabase's returns `uuid`; Snapback principals are text and include `'service:…'`.
- Declare `auth.uid()` as returning a `snapback.principal` domain over text, and type principal columns with it.
- Refuse `uuid` principal columns, with that rewrite. Count them in pre-test 1; the corpus's `user_id uuid` columns will hit it.

**7. Pre-tests before round 3.** Yes, but only after a small revision re-registers them (#4, #6, #11). Pre-registration means the rules must be right before the tests run.
- Run pre-test 1 first. It needs no card and no compiler, and it is the only instrument that can stop the bet before any Snapback 5 code exists.
- Hold pre-test 2 until its card is frozen.
- My round-1 expectation, recorded in §8, stands. Pre-test 1, fixed as in #4, is the cheapest way to show it wrong.

## Findings, ranked

| # | Severity | Section | Finding |
| --- | --- | --- | --- |
| 1 | High | §4, §2, §1, §10 | No document printer; the gate trusts the new printer on both sides |
| 2 | High (security) | §3.3 | Trigger/policy combination unstated; OR bypasses authorization; binds jobs; not Muse's form |
| 3 | High | §3.3 | `update <- E` spelling admits no update in Postgres |
| 4 | High | §7 | Pre-test 1's idiom clause cannot fire; the rate is classification-decided |
| 5 | High | §8 | Floors regress LLP 4000; about a 1-in-4 pass for a true +4; all-zero case undefined; scorer prior |
| 6 | High | §3.5, §6, §7 | Relief valve misdescribes LLP 3000.009 §6.2 |
| 7 | High | §3.2, §3.7 | "No grant means nothing may" |
| 8 | High | §3.2 | No reference columns |
| 9 | High | Revised, §3 | #19 not covered; `home` lowers to Global |
| 10 | High | §3.2, §3.7 A | Horizon spelling is a syntax error; four stubs cannot execute |
| 11 | High | §7 | Pre-test 2 asymmetric, premature, decided by one answer |
| 12 | Medium | §3.4–§3.6 | Rows that fail in Postgres |
| 13 | Medium | §3.7 B | Not exhaustive by its own rule |
| 14 | Medium | §8 | Masking dictionary leaks the arm |
| 15 | Medium | §3.3 | Policy grammar gaps |
| 16 | Medium | §9 | LLP 3000.015 and the instruments come after they are needed |
| 17 | Medium | §2, §4 | The SQL arm reads Quarry; the diagnostic tier is unmeasurable |
| 18 | Low | §1, LLP 4000 §13 | Residual premise wording |
| 19 | Low | various | Smaller gaps |

## Verdict: NOT READY

Revision 2 fixes the direction of every round-1 Blocker, and nothing I found needs a redesign. It is not ready for two reasons:
- Three Highs sit on the instruments that decide whether the program continues (#4, #5, #11), and those must be re-registered before they run.
- Three Highs sit on arm equivalence and authorization semantics that every lane inherits (#1, #2, #3).

The path to READY WITH CHANGES:
1. Redefine the gate on the bound IR, with the unchanged tools as the oracle, and name the printer (#1).
2. State the update-rule combination, and fix the `update <- E` canonicalization (#2, #3).
3. Fix the grant default, and add the reference row (#7, #8).
4. Respell residency horizons and the category-A rows so every row executes on the stub database, and publish that run (#10, #12).
5. Re-register both pre-tests, and describe §6.2 correctly (#4, #6, #11).
6. Restore LLP 4000's floor design, and define the all-zero case (#5).
7. Add #19's forms, or strike the claim (#9).

I would not need to see pre-test results to call that revision READY WITH CHANGES.
