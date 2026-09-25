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
