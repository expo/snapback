# LLP 4001: Snapback 5, second bet — the same engine under a language builders already know

**Type:** RFC
**Status:** Draft
**Role:** Root of the Snapback 5 corpus's second bet (LLP 4000, the first, is Shelved)
**Systems:** A SQL front-end for the Snapback 4 engine: Postgres's own parser lowering to the Quarry declaration AST, printed as Quarry and handed to the unchanged `snapback4` binary; policies as rules; a residency spelling; views and maintained aggregates; SQL and plpgsql subsets as queries, mutations and jobs; the guide; the pre-tests and the calibration protocol
**Author:** Claude Fable 5.1, at Charlie Cheever's request ("let's try it", 2026-09-25)
**Date:** 2026-09-25
**Revised:** 2026-09-25 (revision 2, after three blind design reviews, all NOT READY — [Astra](./reviews/4001-snapback5-sql-front-end.astra.md), [Grok](./reviews/4001-snapback5-sql-front-end.grok.md), [Opus](./reviews/4001-snapback5-sql-front-end.opus.md): the premise restated as the open question with the record's counter-evidence cited; the runtime named as Snapback 4's, not LLP 4000 §4–§5; a residency spelling with Snapback 4's default and `E_SYNC`; §3's illustration replaced by a normative form table covering the committed Clique target, LLP 3000.015 and calibration #19's program, with the rows that map, map with a difference, or have no spelling marked; §3.7 made exhaustive in three categories with the admitted expression subset; the pipeline retargeted to the Quarry AST, printed, with an equivalence gate; two compiler-free pre-tests with registered stop rules; §8 rebuilt around a symmetric masked SURFACE class, a registered directional `data_modeling` prediction, language-relevant floors, one fail rule and a maturity gate; §12 records dispositions); 2026-09-25 (§11 ruling); 2026-09-25 (initial)
**Related:** [LLP 4000](./4000-snapback5.rfc.md) (the first bet, Shelved; its §13 is corrected by this revision), [LLP 3000](./3000-snapback4.explainer.md), [LLP 3000.007](./3000.007-relaxed-quarry-and-explicit-residency.rfc.md) §5–§6 (the language and residency this front-end must reach), [LLP 3000.013](./3000.013-quarry-states-intent.rfc.md) (the planner, `view`, jobs), [LLP 3000.015](./3000.015-shared-baseline-for-snapback5.spec.md) (the additions both arms carry), [LLP 3000.009](./3000.009-general-purpose-backend.rfc.md) §6.2 (server-only SQL reads, the relief valve), [LLP 3000.012](./3000.012-application-still-owns-derived-data.research.md) (the charge ledger), [LLP 0329](./0329-agent-native-rebuild-diagnosis.research.md) and [LLP 0252](./0252-convex-familiar-authoring-profile.rfc.md) (the one in-house precedent for a familiar surface), the [September 5 three-backend run](../benchmarks/runs/2026-09-05-clique-full-3x3/README.md)

## Summary

The first Snapback 5 bet removed the residency spelling from Quarry and was
shelved after nine blind reviews (LLP 4000 §13). This bet keeps the
Snapback 4 engine untouched and replaces the authoring surface with SQL
forms a Postgres or Supabase builder already writes: DDL for tables,
row-level-security policies for rules, Supabase's publication statement for
residency, views and maintained aggregates, SQL functions and a plpgsql
subset for queries, mutations and jobs, `pg_cron`'s form for schedules. The
front-end is a transpiler: Postgres's own parser reads the file, the
lowering produces the Quarry declaration AST, the printer emits Quarry
source, and the unchanged `snapback4` binary binds, plans, checks and
serves it. The device is untouched; the treatment is the spelling.

**The premise, stated as the open question it is.** The learning-cost
record charges Quarry in every ledgered `data_modeling` note, and a share of
those phrases name the language. But the lane this grader scored at 94
wrote *unrestricted* Postgres with authorization in JavaScript and no
policies; the lane that used the RLS-and-RPC frame this RFC proposes scored
85; five of the eight "language" phrases name restriction, not
unfamiliarity; the current release's note names no language item; and the
one in-house precedent for a familiar surface (LLP 0252's familiar profile)
"removed authoring syntax friction and still finished worse." So the
question this bet asks is: **does a *restricted* SQL keep the familiarity
credit that *unrestricted* SQL earned, when the restrictions are the ones
the engine needs for devices, prediction and disclosure?** Three reviews
said that question should be answered before any compiler is built, and
§7 answers it with two compiler-free tests whose stop rules are registered
here: a replay of the actual Supabase lanes' SQL through this surface's
admission rules, and a blind writing test in both languages.

This is a proposal for the author's decision after a second blind review.
Nothing is built.

## 1. Evidence

| Observation | Source | What it supports |
| --- | --- | --- |
| Learning-cost phrases across the 16 ledgered `data_modeling` notes, counted from the abridged evidence: bounds 11, the language itself 8, completeness 5, residency 2–3, prediction 1. The classes overlap; LLP 3000.012 §2.2 says LC overlaps RM and CP and declines a single-cause reading | LLP 3000.012 §2.2; the LLP 4000 Opus round-1 count | The language is a named item, not an isolated cause |
| Of the eight "language" phrases, five name restriction ("restrictive rule expressions", "less flexible than … SQL", "fewer language escape routes", "restricted joins/scans", "constrained expressiveness"); three name unfamiliarity | the same notes, read by the Opus review of this RFC | A SQL surface that refuses SQL removes unfamiliarity and sharpens restriction, because the prior becomes full Postgres |
| The Supabase lane that scored 94 in `data_modeling` (Astra scorer; Grok 86, Muse 85, mean 88) enabled RLS on 22 tables with **zero** `create policy`, put authorization in the API (scored 78), kept its counters in a trigger, ordered with a sequence and `row_number()`, searched with a GIN expression index, and wrote its mutations as one jsonb-dispatching plpgsql function using `elsif`, `:=`, `found`, `select … into`, `for update` and set-based `insert … select` | `~/clique-full-20260905/lanes/astra-supabase/{schema.sql,m7/inherited/scripts/mutations.sql}`; `scores/summary.md` | The 94 credits unrestricted Postgres plus application-owned work, not policies, maintained views and a subset |
| The only lane that used RLS policies, RPCs and pg_cron (Muse) scored 85 in `data_modeling`; its policies call `security definer` helpers and its transition rules are `before update` triggers comparing `OLD` and `NEW` | `~/clique-full-20260905/lanes/muse-supabase/` | The frame this RFC proposes has one data point, below Snapback 4's 90 |
| Calibration #19 (0.4.0): `data_modeling` 90, the series high, up from 82 at 0.2.32; its note: "Shared Quarry declarations unified server and replica logic; maintained counts and day buckets were concise. Recipient receipts required explicit rows/helpers, and prediction/completeness introduced learning overhead" (no language item); its essay's "Quarry itself added learning cost" names three first-try refusals answered in 0.4.1 | #19 FINAL and essay; LLP 3000.013 §12 | The current charge is receipts (removed in both arms by LLP 3000.015) and prediction/completeness (kept in both arms) |
| In the Grok-family re-score beside Snapback 4 0.4.0, Snapback 4 scored 84 and Supabase 80 in `data_modeling`; the same Supabase lane scored 86 beside Snapback 2 | the re-score record | The 94 is anchored and N = 1 |
| LLP 0329 records a familiar-profile arm (LLP 0252) that "removed authoring syntax friction and still finished worse … the friction that costs milestones is behavioral, not syntactic"; the N ≥ 3 matrix never ran | LLP 0329 | The one precedent for this bet is negative and unfinished |
| The categories at 94–97 rest on declarations that move work to the platform (`image <=N once`, read rules with `sync to` and `retain delivered-history`, client-minted ids, `expire at`); no builder has a prior for `sync to` or `retain` | LLP 3000.012 §2.1 | Ownership, not familiarity, is the ledger's own reading of the ceiling |
| On the 2026-09-24 reference lanes (parallel, not claim-eligible): Snapback 4 M8 first green 68 min / last evidence 128; Convex 64 / 152; Supabase 134 / 364 under hosted-auth throttling | `~/clique-ref-20260924` | The engine's clock and correctness are competitive; the authoring score is the open goal |
| The engine has no SQL parser; `sqlparser` keeps plpgsql bodies as strings; `pg_query` (libpg_query) is Postgres's own parser with a plpgsql entry point; the binder consumes `Vec<ast::Document>` and emits the IR; `print.rs` prints a document back to Quarry | `snapback4/crates/snapback4-lang/src/{lib.rs,bind/mod.rs,print.rs}` | The bounded pipeline is SQL → Quarry AST → printed Quarry → the unchanged binary |
| Diagnostics are built at about 400 sites with pre-formatted Quarry messages and rewrites; `why`, `--residency`, `--cost` and runtime refusals print Quarry | `snapback4-lang/src/diag.rs` | Re-spelling every diagnostic is unbounded; tiering is required |

What the evidence supports: an experiment. What it does not support: an
expectation. Opus's stated expectation, recorded here as a judgment and
not a measurement, is that the SQL arm's `data_modeling` lands within
noise of the control while `diagnostics_dev_loop` and `setup_and_docs`
fall. §7's pre-tests are designed to say whether that expectation is wrong
for about two days of work.

## 2. The bet on one page

**The runtime is Snapback 4's**, exactly as LLP 3000, LLP 3000.007 §6
(residency: a table with neither `sync` nor `online only` is online-only;
horizons are authored; the audience is inferred from the read rule when the
`to` clause is omitted), LLP 3000.013 (the planner, `view`, streaming
aggregates, self-chunking jobs) and LLP 3000.015 (the additions) define it
as of the shared baseline commit. LLP 4000 §4–§5 are **not** the runtime
of record; only LLP 4000 §4.5 is cited, as a restatement of Snapback 4's
predictor. Nothing in `snapback4-core`, `snapback4-device` or
`snapback4-lang` changes for this bet.

**The authoring surface is SQL, transpiled to Quarry.** A `.sql` program
is parsed by Postgres's parser, lowered to the Quarry declaration AST,
printed as Quarry, and given to the unchanged `snapback4` binary. Every
diagnostic the binder raises is mapped back through a span map to the SQL
line, with a SQL rewrite for every code the Clique program and the Supabase
corpus can produce, and the Quarry message plus the lowered line for the
rest.

**The treatment is the spelling and nothing else.** Both arms run one
engine build carrying LLP 3000.015. The equivalence gate (§4) requires the
pinned SQL Clique program to lower to the pinned Quarry Clique program
byte-identically under `print`, so residency, plans, prediction facts and
`why` are identical by construction. The control is Quarry on the same
binary.

## 3. The surface: a normative form table

The illustration of revision 1 is withdrawn; three reviews showed it did
not parse, did not lower, and could not spell the committed target. What
replaces it is a table. **Every row is verified twice before §7 runs:**
the SQL through Postgres's parser against an empty database with the
Snapback domains and functions stubbed, and the lowered Quarry through
`snapback4 check`.

Key: **✓** maps · **≈** maps with a stated difference · **✗** no spelling
in this revision (a GAP the pre-test counts) · **§3.7** the row is a
Snapback clause, listed there.

### 3.1 Program and identity

| Quarry form | SQL spelling | Lowered Quarry | Difference a Postgres reader must learn |
| --- | --- | --- | --- |
| `use identity password` | `select snapback.identity('password');` | `use identity password` | §3.7: a configuration call, not DDL (**≈**) |
| `effect push` | `create type push as (target_user_id text, kind text, …); select snapback.effect('push');` | `effect push` | §3.7: the type is the payload; the call registers the effect (**≈**) |
| `viewer` | `auth.uid()` | `viewer` | Supabase's own name; `current_principal()` is dropped (**✓**) |

### 3.2 Tables

| Quarry form | SQL spelling | Lowered Quarry | Difference |
| --- | --- | --- | --- |
| implicit `id`, client-minted | `id snapback.id primary key` (required, no default) | implicit | §3.7: no `gen_random_uuid()`; ids are minted by the client (**≈**) |
| `col: text <=N`, `text M..N` | `col text not null check (length(col) between M and N)` | `text M..N` | recognized `check` shapes only (**✓**) |
| `format handle`, `format url` | `check (col ~ snapback.format('handle'))` | `format handle` | §3.7: the regex is the engine's named format (**≈**) |
| `enum('a','b')` | `check (col in ('a','b'))` **or** `create type role as enum ('a','b')` | `enum(…)` | both admitted; the closed type is canonical (**✓**) |
| `col: t ?` | nullable column | `?` | (**✓**) |
| `default now`, literals | `default now()`, literals | same | `default now()` predicts; `clock_timestamp()` is refused (**✓**) |
| `image <=N`, `video <=N`, `once` | `photo snapback.image(10000000)`, `snapback.image_once(…)` | same | §3.7 (**≈**) |
| `unique a, b` | `unique (a, b)` | same | (**✓**) |
| `unique handle else HANDLE_TAKEN 'That handle is taken.'` | `constraint handle_taken unique (handle); comment on constraint handle_taken on profiles is 'That handle is taken.';` | `unique handle else HANDLE_TAKEN '…'` | §3.7: the constraint name, upper-cased, is the refusal code; the comment is the message (**≈**) |
| `immutable a, b` | `grant update (c, d) on t to authenticated;` (the complement is immutable) | `immutable a, b` | §3.7: column privileges state what may change; no grant means nothing may (**≈**) |
| `search a, b` | `create index on t using snapback_words (a, b);` | `search a, b` | §3.7: an index method name (**≈**) |
| `cap 50 by conversationId` | `constraint at_most_50 check (snapback.cap(50, conversation_id))` | `cap 50 by conversationId` | §3.7: a cross-row check (**≈**) |
| `retain delivered-history` | `with (snapback.retain = 'delivered-history')` | same | §3.7 (**≈**) |
| `expire at .expiresAt` | `with (snapback.expire_at = 'expires_at')` | same | §3.7 (**≈**) |
| `online only` | absent `alter publication` (the default) | `online only` | Snapback 4's default, kept (**✓**) |
| `sync public` / `sync to members[.conversationId]` / `sync … last N by .k` / `by .principal` | `alter publication snapback add table messages;` with `with (snapback.horizon = 'last 500 by at', snapback.recipient = 'principal')` | `sync` (audience inferred from the select policy, LLP 3000.007 §6.6), `sync last N by .k`, `by .principal` | §3.7: Supabase's Realtime statement; a published table whose select policy is not invertible refuses with `E_SYNC` re-spelled, as today (**≈**) |
| `likeCount: count likes`, `repostCount: count reposts` | `like_count int generated always as (snapback.count('likes')) stored` | `likeCount: count likes` | §3.7: a generated column that reads another table; the trigger-maintained counter builders write, as a declaration (**≈**) |
| `public 'reason'` | `create policy … for select using (true); comment on policy … is 'reason';` | `public 'reason'` | the reason rides the comment (**≈**) |
| LLP 3000.015 `written by .principal` | `read_up_to int not null default 0 constraint owned check (snapback.written_by(principal))` | `written by .principal` | §3.7: private to the owner by default; `snapback.readable_by_audience()` in the same check opts out (**≈**) |
| LLP 3000.015 `sequence by conversationId` | `ordinal snapback.sequence(conversation_id)` | `sequence by conversationId` | §3.7: one counter per parent row, shared by every such column in every table naming that parent (**≈**) |

### 3.3 Rules

The admitted policy expression grammar is Quarry's rule grammar and
nothing more: `and`, `or`, `not`, `=`, `<>` (canonicalized to `!=`), a
column, `auth.uid()`, a literal, `exists (select 1 from t where t.k = x.k
and t.principal = auth.uid())` (a key probe), and `snapback.created(t,
col)`. Ordered comparisons, arithmetic, `now()` and functions are refused
in policies with the rewrite "move this condition into the mutation as
`raise exception`". Probes inside policies read without policies, which is
the security-definer semantics Snapback's probes already have; a `language
sql stable security definer` helper whose body is an admitted probe is
inlined and recognized as that probe.

| Quarry form | SQL spelling | Lowered Quarry | Difference |
| --- | --- | --- | --- |
| `read <- expr` | `create policy p on t for select using (expr)` | `read <- expr` | probes do not recurse (**≈**) |
| `insert <- expr` | `for insert with check (expr)` | same | (**✓**) |
| `delete <- expr` | `for delete using (expr)` | same | (**✓**) |
| `update <- expr` (single image, tests the next image) | `for update with check (expr)` | `update <- expr` | an omitted `with check` applies `using` to the next image, as Postgres does; `using` alone lowers to a transition over `old` (**≈**) |
| `update (old, next) <- expr` | `create trigger … before update … execute function snapback.transition($$ if not (expr over old/new) then raise exception 'E_RULE' $$)` | `update (old, next) <- expr` | §3.7: the `before update` trigger form the Muse lane wrote; the only admitted trigger (**≈**) |
| several rules for one effect | several permissive policies (`or`); `as restrictive` (`and`) | one rule | (**✓**) |
| `or viewer = 'service:x'` | `to service_role` on the policy | the service grant | `to authenticated` is ignored (**≈**) |
| `through .ref` (LLP 3000.014) | — | — | **✗** until LLP 3000.014 lands in both arms; membership probes are used instead |
| `public 'reason'` | see §3.2 | | |

### 3.4 Views and aggregates

The engine chooses the strategy for a Quarry `view` (LLP 3000.013 §3); SQL
lets the author choose. The lowering enforces a bijection and refuses the
mismatch with a rewrite: `create view` only for shapes the engine plans at
read time (filters, projections, single-row joins by key, `union all`);
`create materialized view` only for shapes it maintains (aggregates with
`group by`, LLP 3000.015's row-keyed count) or materializes per reader
(Following). Views run as the viewer (`security_invoker`, stated); a
materialized view is maintained in the writing transaction, rule-filtered,
per viewer when it reads `auth.uid()`, never refreshed. An absent group
reads 0.

| Quarry form | SQL spelling | Lowered Quarry | Difference |
| --- | --- | --- | --- |
| `view activity: posts where … { post: .id, actor: .authorId, at, repost: false }` + `reposts { … }` | `create view activity as select id as post, author_id as actor, at, false as repost from posts where … union all select post_id, actor_id, at, true from reposts` | the union view | `union` (distinct) is refused; branch identity is kept for cursors (**≈**) |
| `view following: activity where .actor = viewer or exists follows[viewer, .actor]` | `create materialized view following as select * from activity where actor = auth.uid() or exists (select 1 from follows f where f.follower_id = auth.uid() and f.followed_id = activity.actor)` | the Following view | §3.7: per reader; sources must be published (`alter publication`) and their mapped columns immutable, or `E_FEED` re-spelled (**≈**) |
| `view followerCount: count follows by .followedId` | `create materialized view follower_count as select followed_id, count(*) from follows group by followed_id` | `count follows by .followedId` | absent group reads 0 (**≈**) |
| `view receivedLikes: count likes by .postId.authorId` (recorded attribution) | `create materialized view received_likes as select snapback.recorded(post_id, 'author_id') as author_id, count(*) from likes group by 1` | `count likes by .postId.authorId` | §3.7: `snapback.recorded` names the captured immutable path; a plain join would credit the current row, which the engine does not (**≈**) |
| `view dailyLikes: count likes by .postId.authorId, day(.at)` | `… group by 1, snapback.day(at)` | same | §3.7: `snapback.day` is the UTC millisecond day ordinal, not `date_trunc` (**≈**) |
| LLP 3000.015 `view unread: count messages by members m where …` | `create materialized view unread as select m.id, count(x.id) from members m left join messages x on x.conversation_id = m.conversation_id and x.ordinal > m.read_up_to and x.sender_id <> m.principal and not x.tombstone group by m.id` | the row-keyed view | the `left join` with predicates in `on` and `count(x.id)` is the zero-preserving form; the pending recount is stated (**≈**) |
| `shape postCard = { *, author: profiles[principal = .authorId], replyCount: replyCount[.id], liked: exists likes[.id, viewer] }` | `create view post_card as select p.*, (select pr from profiles pr where pr.principal = p.author_id) as author, coalesce((select c from reply_count c where c.parent_id = p.id), 0) as reply_count, exists (select 1 from likes l where l.post_id = p.id and l.principal = auth.uid()) as liked from posts p` | the shape | a scalar row subselect is a nullable point read (the outer row survives), never a join; a subselect on a maintained view is a point read; a correlated `count(*)` on a base table is refused with the materialized-view rewrite (**≈**) |
| spread `{ ...p, followers, following }` | `select p.*, … from profiles p` | the spread | (**✓**) |

### 3.5 Queries

A query is `create function … returns … language sql stable` with one
`select`, or `language plpgsql stable` with the admitted body of §3.6
minus writes. A `snapback.cursor` argument makes the function a page, and
the lowering attaches it to the function's single `order by … limit N`;
a body with two pages or a keyset `where` on the cursor is refused with a
rewrite. Reference-typed arguments use Postgres's own `%type`:
`post_id posts.id%type` lowers to `postId: posts`.

| Quarry form | SQL spelling | Lowered Quarry | Difference |
| --- | --- | --- | --- |
| `query home(c: cursor ?): return following last 20 by .at after c activityCard` | `create function home(c snapback.cursor default null) returns setof activity_card language sql stable as $$ select * from activity_card order by at desc limit 20 $$` | the page | the cursor is applied by the engine, never written in `where` (**≈**) |
| `query thread(postId: posts, c)` | `thread(post_id posts.id%type, c snapback.cursor default null)` | `postId: posts` | `%type` carries the reference (**✓**) |
| `query people(q: text <=100, c)` | `people(q text, c …)` with `snapback.bound(q, 100)` in the body | `q: text <=100` | §3.7: Postgres discards argument typmods (**≈**) |
| `matching q` over two search columns | `where snapback.matches(profiles, q)` | `matching q` | the table's `snapback_words` index decides the columns (**≈**) |
| `posts[postId]! else NOT_FOUND` then a shaped object (`socialProfile`) | `language plpgsql stable`: `select … into strict p …; exception when no_data_found then raise exception 'NOT_FOUND';` | `! else NOT_FOUND` | the one admitted exception block (**≈**) |
| `insights`: `for d in range(a, b)`, list building, object return | `language plpgsql stable` with `for d in a..b loop days := days \|\| …; end loop; return json_build_object(…)` | the loop and the object | (**≈**) |
| `trending`: `where .at > now - 24h last 10 by .likeCount, .at` | `where at > now() - interval '24 hours' order by like_count desc, at desc limit 10` | the bucketed window | recognized interval shapes only (**≈**) |
| aggregate reads without a view (streaming) | `select count(*) from … where …` in a body | the streamed aggregate | returns null on a meter cut, as LLP 3000.013 §5.1 (**≈**) |
| LLP 3000.009 §6.2 server-only SQL reads | `language sql stable` marked `snapback.server_only()` | the server-only read | the relief valve: an unlowerable read-only function becomes a server-only SQL read (`complete: false`) in **both arms**, once increment D lands (**≈**) |

### 3.6 Mutations, jobs, schedules

A mutation is `create function … language plpgsql volatile` and is
client-callable; a job is `create procedure` (the Postgres form that may
commit), never in `api.ts`. The admitted plpgsql grammar is Quarry's
statement list, spelled the plpgsql way: `declare` (locals; per-iteration
locals in a nested `declare … begin … end`), `:=`, `if … elsif … else`,
`for r in <planned select> loop`, `for i in a..b loop`, `foreach x in
array … loop`, `continue`, `exit`, `select … into [strict]`, `found`,
`insert … [on conflict (<full unique key>) do nothing | do update set …]
returning … into`, `update t set … where <full unique key> [and <cond>]`,
`delete from t where <full unique key>`, `perform snapback.emit(effect,
payload, once => array[…])`, `raise exception 'CODE'`, `return`.
Everything else (`execute`, cursors, other exception blocks, set-based
`update`/`delete`, `insert … select`, triggers other than §3.3's) refuses
with a code from the family of §4 and the loop rewrite.

| Quarry form | SQL spelling | Lowered Quarry | Difference |
| --- | --- | --- | --- |
| `insert t { … } if absent` | `insert … on conflict (<key>) do nothing returning * into r` | `if absent` | the conflict target must be the full unique key that decides absence; `(id)` alone is refused when another unique key exists (**≈**) |
| `upsert t[k] { … }` | `insert … on conflict (<key>) do update set …` | `upsert` | (**✓**) |
| `update t[k] { … }` | `update t set … where <full unique key>` | point write | a missing row raises `NOT_FOUND`, not zero rows (**≈**) |
| `update t[k] { … } if cond` | `update … where <key> and <cond>` | `if cond` → `E_CONFLICT` | (**≈**) |
| `delete t[k]` | `delete from t where <key>` | point delete | `NOT_FOUND` on a missing row (**≈**) |
| `require cond else CODE` | `if not cond then raise exception 'CODE'; end if;` | `require` | §3.7: the message slot carries the code (**≈**) |
| `emit push { … } once [a, b]` | `perform snapback.emit('push', json_build_object(…), once => array[a, b])` | `emit … once [a, b]` | the key is an array, never a joined string (**✓**) |
| `job daily(periodStart, periodEnd): for p in profiles: …` | `create procedure daily(period_start timestamptz, period_end timestamptz) language plpgsql as $$ declare … begin for p in select * from profiles loop declare n int; begin … end; end loop; end $$` | the sweep | §3.7: the top-level `for` is the chunked sweep; inner loops share the chunk; loop-carried state across chunks is refused, as today (**≈**) |
| `schedule dailyDigest every 1d at 08:00: daily` | `select cron.schedule('daily-digest', '0 8 * * *', $$ call daily(period_start, period_end) $$)` | the schedule | §3.7: only cron expressions that are a fixed period plus an offset are admitted (`*/2 * * * *`, `0 8 * * *`); `0 8 * * 1-5` is refused; `period_start`/`period_end` are supplied by the engine, never computed in the command (**≈**) |
| presence in a mutation (`connected[p]` deciding only an emit) | `if not snapback.connected(p.principal) then perform snapback.emit(…) end if` | the effects-only exception | (**✓**) |
| `after insert <-` | — | — | **✗** in this revision |

### 3.7 What is not Postgres, exhaustively

One rule decides membership: **any construct whose Postgres meaning differs
from its Snapback meaning gets a row, even when its syntax is standard.**
Three categories.

**A. Custom grammar (does not parse as Postgres without the Snapback
stubs):** `snapback.image(N)` / `image_once` / `video`, `snapback.sequence(col)`,
`snapback.id`, `snapback.cursor`, `snapback.count('t')` in a generated
column, `using snapback_words`, `snapback.transition($$…$$)` triggers. All
parse once the `snapback` schema's domains and functions are created, which
the transpiler's stub file does.

**B. Standard syntax with Snapback semantics:** policies do not recurse
into probed tables (security-definer probes); an omitted `with check` on
an update policy applies `using` to the next image (as Postgres) and lowers
to a transition; probes must be key probes ending in `auth.uid()`; a
published table's select policy must be invertible or `E_SYNC`; absent
`alter publication` means online-only; `create view` plans at read time and
runs as the viewer; `create materialized view` is maintained in the writing
transaction, rule-filtered, per viewer when it reads `auth.uid()`, never
refreshed, and reads 0 for an absent group; a scalar row subselect is a
nullable point read, not a join; an unused `snapback.cursor` argument
paginates the function's one page; `%type` arguments are typed references;
`update`/`delete … where <key>` are point writes that raise `NOT_FOUND`;
`on conflict` must name the deciding unique key; `raise exception 'CODE'`
carries an application code; a `create procedure` is a chunked job and is
not in `api.ts`; `cron.schedule` admits period-plus-offset expressions
only; `grant update (cols)` states the mutable columns and the rest are
immutable; `comment on constraint` is a refusal message and the constraint
name is the code; `generated always as (snapback.count(…)) stored` is an
engine-maintained counter; `snapback.recorded(ref, 'col')` is a captured
attribution path; `snapback.day(at)` is the UTC millisecond day ordinal;
`default now()` predicts and `clock_timestamp()` is refused; equality with
`null` follows **SQL** semantics, which the lowering implements by guard
insertion and states in `check` where it changes a pin (the ruling asked in
§11); the streamed `count(*)` returns null on a meter cut; `auth.uid()` is
the viewer.

**C. Refused Postgres, with the rewrite named:** `create index` (the
planner chooses; rewrite: delete it), `create trigger` other than §3.3's
transition form (rewrite: a generated counter or a transition), `security
definer` helpers whose body is not an admitted probe, CTEs, window
functions, set-based DML, `insert … select`, `execute`, cursors, exception
blocks other than `no_data_found`, floats, `like`/`~` outside
`snapback.format`, jsonb operators outside `json_build_object`, `avg`,
`string_agg`, `date_trunc`, `extract`, `coalesce` and `case` outside the
recognized shapes, `union` (distinct), `to authenticated` (ignored, not
refused), argument typmods (ignored; use `snapback.bound`).

**The admitted expression subset** is the IR's: `= <> < <= > >= + - *`,
`and or not`, `is null` / `is not null`, `in (select col from t where …)`
(a value lane), and the builtins the language card lists (`length`,
`day`, `hour`, `count`, `sum`, `min`, `max` as scalars, `range`). Floats
are refused (LLP 3000.007 §5.7).

**One spelling.** LLP 3000.007 §5.5 rules that the language keeps one
spelling. SQL is many-to-one (`<>`/`!=`, `in`/`exists`, `coalesce`/`case`).
The ruling this RFC asks for (§11): the SQL surface canonicalizes admitted
alternatives to one lowered form rather than refusing them, and `check`
prints the canonical spelling once.

**`api.ts` naming:** identifiers are lowered from snake_case to camelCase,
so the generated client is identical to the control's; this is part of the
treatment and the guide says so.

## 4. What the front-end is

- **Parser:** `pg_query` (libpg_query, Postgres's own parser, with its
  plpgsql entry point), in the `snapback5` CLI crate only. "Valid Postgres"
  is then mechanically true for the DDL, policies, views and function
  bodies; the Snapback stubs make category A parse.
- **Lowering:** Postgres AST → `snapback4_lang::ast::Document` (the
  binder's own input) → `print.rs` → Quarry source → the unchanged
  `snapback4` binary (`check`, `dev`, `serve`, `why`, `guide`). The
  `snapback5` CLI is a thin wrapper that transpiles and delegates; the two
  arms are the same binary by construction.
- **The equivalence gate:** the pinned SQL Clique program (§7) must lower
  to the pinned Quarry Clique program byte-identically under `print`, and
  `snapback4 check` and `why` on the lowered program must equal the control's
  on the pinned Quarry program. This is a diff, checked in CI, and it is what
  makes "unchanged residency, plans and prediction" a fact rather than a
  claim.
- **Diagnostics, tiered:** a span map from lowered Quarry back to the SQL
  source; SQL rewrites for every code the pinned program and the Supabase
  corpus can produce (measured in §7); every other code shows the Quarry
  message and the lowered line, labeled as such. Refusals of the subset use
  a small family (`E_SQL_STATEMENT`, `E_SQL_EXPRESSION`, `E_SQL_POLICY`,
  `E_SQL_VIEW`), each with a card section, not one generic code.
- **`check`:** the same output as Snapback 4's, in SQL terms; residency,
  the completeness class per function, disclosure notes, device admission
  per table.
- **The guide:** the cards the pinned program's forms use, with every
  example in SQL, plus one card for §3.7; the first account within W14b's
  budget. The rest of the corpus stays Quarry and is not translated for the
  experiment.
- **The client:** unchanged; `api.ts` is the control's.

## 5. What stays hard, in SQL

- **Completeness classes.** A function whose select policy reads a column
  the scan does not pin reads `complete: false` on the server whatever it
  finds. An RLS builder expects a query to enumerate the visible rows; the
  incomplete-result contract is something to learn, and the card says so
  with the paired example (an incomplete search versus an empty one).
- **Device admission** is about deriving an exact delivery audience, not
  about whether a predicate can run on a device. The three shapes and the
  `security definer` inlining are the whole rule; anything else on a
  published table is `E_SYNC` with the membership-probe rewrite, never a
  silent downgrade.
- **The mutation subset** is Quarry's statement list in plpgsql spelling.
  The Supabase lanes wrote set-based DML, triggers and jsonb dispatch; those
  are refused here with rewrites, and §7 counts how often.
- **`now()`**: `default now()` predicts; a branch on `now()` in a mutation
  does not; a time window belongs in a `raise exception`, never in a
  policy.

## 6. Relationship to Snapback 4 and to LLP 4000

- **Engine unchanged**, by the equivalence gate. `snapback5/` holds the
  transpiler crate, the CLI, the SQL guide and the pinned programs.
- **Both arms carry LLP 3000.015** as the shared baseline commit.
- **LLP 3000.009 §6.2's server-only SQL reads** (increment D) are the
  relief valve for unlowerable read-only functions and must land in the
  baseline before the comparison, or the row in §3.5 is withdrawn.
- **LLP 4000 §13's sentence** that its §4–§5 remain the runtime of record
  for this bet is corrected in the same landing as this revision.
- **`through`** (LLP 3000.014) is not in either arm for the experiment.

## 7. Pre-tests, compiler-free, before any lane

Both run on the normative table of §3 after it is verified twice; their
thresholds are registered here.

**Pre-test 1, the corpus replay (one day).** Every SQL statement the three
Supabase lanes of 2026-09-05 wrote (about 1,690 lines on this host) is
classified under §3 as **admitted**, **admitted after a mechanical
rewrite** (canonicalization), **refused**, or **server-only** (the §3.5
relief valve). Registered stop rule: the bet stops if more than one third
of the statements are refused, or if any of {the membership policy, a
counter, a transition rule, the feed read} is refused in all three lanes.
Reported either way: the refusal rate by category, and the list of
refusals with their rewrites.

**Pre-test 2, blind writing (one day).** Three families, including the
builder's, write the messaging half of the Clique brief from the brief and
the SQL card only, with no Quarry source; the control does the same from
the Quarry card. Their statements are classified as in pre-test 1, and each
family then predicts the behavior of five registered scenarios (a hidden
row in a search; an offline send; a removed member's history; a mark
advance across 10,000 messages; an edit after its window) from the file it
wrote. Registered stop rule: the bet stops if the SQL arm's refusal rate
exceeds the Quarry arm's, or if its prediction accuracy on the five
scenarios is below the Quarry arm's. Reported either way.

**The reading judgment** of revision 1 is kept as a third, reported
number: three families read the pinned SQL program cold and count the
foreign stops. It gates nothing.

Passing both pre-tests is permission to build, not confirmation of the
premise.

## 8. Evaluation, pre-registered

The instruments are LLP 4000 §9.3–9.5 with these substitutions:

- **Treatment:** the transpiled SQL surface. **Control:** Quarry on the same
  binary. Both from one commit, published as `snapback5` and `snapback4`
  pre-releases; both carrying LLP 3000.015 and increment D.
- **Maturity gate before any counted run:** both guides compile; the
  diagnostic tier covers every code the pinned program and the corpus can
  produce; one uncounted pilot per arm, with its fixes landed; the
  equivalence gate green on the pinned pair.
- **The primary result, registered:** a directional prediction on
  `data_modeling`. The bet predicts the treatment's mean over three runs
  exceeds the control's by at least 3 (one scorer sd). Opus's registered
  counter-expectation: within noise. Both are written down before the runs.
- **The mechanism gate, symmetric:** one **SURFACE** class in both arms
  (learning-cost phrases about the authoring language, its syntax, its
  restrictions and its refusals, in either language), classified by a
  third family on notes where surface tokens are masked by a registered
  dictionary (`Quarry`, `SQL`, `policy`, `plpgsql`, `rule`, `view`, `sync`,
  `publication`, and the code names) so the arm cannot be inferred.
  Reading (A) holds when the treatment's SURFACE count is at or below the
  control's in every paired run and its total learning-cost count is at or
  below the control's; zero in both arms is "no surface charge in either
  arm" and supports nothing. Completeness, prediction and bounds phrases
  are expected in both arms and are reported.
- **Floors** at the control's mean minus one category sd, on the
  categories a language treatment puts at risk: `diagnostics_dev_loop`,
  `setup_and_docs`, `authorization`, `queries_and_live`, `offline_sync`,
  `writes_and_transactions`, and the holistic score.
- **Correctness:** as LLP 4000 §9.3 (110 assertions, native artifacts,
  holdout probes, calibrated grader, zero blockers, every probe).
- **The clock:** reported; a not-distinguished clock neither passes nor
  fails this bet.
- **One fail rule.** The bet **fails** if the `data_modeling` prediction
  is not met, or any floor fails where the control passes, or correctness
  fails where the control passes, or reading (A) does not hold. It
  **passes** only when all four hold. There is no not-distinguished
  outcome for this bet; a null result on `data_modeling` is a failed
  prediction, and the record says so. Not passed never ships.

## 9. Order of work

1. Blind design reviews of this revision from the same three families;
   revision until READY or a bounded stop of three rounds.
2. The normative table verified twice (Postgres's parser with stubs;
   `snapback4 check` on the lowered Quarry), with every ✗ either given a
   spelling or registered as a GAP the pre-tests count.
3. Pre-test 1 and pre-test 2, with their stop rules. **Stop here for the
   author's decision.**
4. `pg_query` evaluated; the transpiler in lanes: (a) DDL, policies,
   publication → `ast::Document`; (b) views, aggregates, shapes; (c)
   functions and procedures; (d) the span map and tiered diagnostics; (e)
   the SQL cards and first account; (f) the `snapback5` CLI and
   pre-release. Each lane: the equivalence gate on the pinned pair, tests,
   two blind reviews, landed under `snapback5/`. No lane may change
   `snapback4-*`.
5. Increment D (LLP 3000.009 §6.2) and LLP 3000.015 in the baseline;
   holdout probes, the masking dictionary and the classifier rubric by
   hash.
6. The maturity gate, then the comparison of §8.

## 10. Risks, and what falsifies the bet

- **The charge moves to the subset.** The Supabase lanes' idioms (triggers,
  security-definer helpers, CTEs, set-based DML, window functions,
  `date_trunc`, jsonb) are refused here. Pre-test 1 measures the rate;
  §8's SURFACE class counts it in the comparison. Falsified by the stop
  rules or by reading (A).
- **Familiar syntax, unfamiliar meaning.** Category B of §3.7 is long. The
  reading judgment and pre-test 2's prediction task measure whether a
  Postgres reader guesses the meaning right. Falsified by prediction
  accuracy below the Quarry arm's.
- **A new front-end against a control polished over twenty waves.** The
  maturity gate and the language-relevant floors are the defense; a
  `diagnostics_dev_loop` fall is a real cost of the bet, not noise.
- **Two SQL surfaces in one product** if increment D lands with different
  semantics. §3.5 makes the server-only read the same statement in both
  arms.
- **The diff-based equivalence gate cannot catch a lowering that is
  wrong in the same way on both sides of the pinned pair.** The blind
  writing test's programs, lowered and checked, are the second sample.

## 11. Questions for the author

Ruled on 2026-09-25 ("recs all ok"): Postgres dialect only; the pre-tests
gate the compiler work; a separate `snapback5` package. Three reviews
concurred. New:

4. **One spelling** (LLP 3000.007 §5.5): may the SQL surface canonicalize
   admitted alternatives (`<>`/`!=`, `in (select …)`/`exists`) to one
   lowered form instead of refusing them? Recommendation: yes; refusing
   `<>` would be the first "restricted SQL" complaint.
5. **Null semantics:** SQL's (three-valued, by guard insertion, stated in
   `check` where it changes a pin) or Quarry's total equality listed as a
   §3.7 difference? Recommendation: SQL's, because the arm's whole premise
   is the reader's prior.
6. **The viewer's name:** `auth.uid()` (Supabase's) or `current_principal()`?
   Recommendation: `auth.uid()`.
7. **Whether to run the pre-tests before a second review round**, given
   Opus's registered expectation that the comparison lands within noise:
   the pre-tests cost about two days and would show whether that
   expectation is wrong. Recommendation: run them after round 2, before
   any lane.

## 12. Review record

### Round 1 (revision 1, `8a2637efa5`)

Three blind design reviews, all **NOT READY**: Astra (19 findings, 3
blockers), Grok (2 blockers, 4 highs), Opus (17 findings, 2 blockers). They
converged on: the premise overclaims (the 94 lane wrote unrestricted
Postgres with no policies; the policy-based lane scored 85; five of eight
language phrases name restriction; #19's note names no language item; LLP
0252's familiar profile finished worse); the runtime named was LLP 4000's
shelved design and `sync` had no spelling; the illustration did not parse
(a generated column reading another table, `written by` as a column
option, `raise … using message` with a format string) and did not lower
(`now() … <=` in a policy; `min`/`max` maintains; `socialProfile`,
`insights`, the digest job, coded uniques, formats, identity, effects,
in-table counts, dotted aggregates, `day()`, structured `once` keys,
reference-typed arguments, point-key writes); §3.7 was incomplete and
presented Snapback semantics as Postgres; policies recurse in Postgres and
`old` is not available in them; the view/materialized split inverted both
the engine's choice and the Postgres prior; the pipeline targeted the IR the
binder emits rather than the AST it consumes, `sqlparser` does not parse
plpgsql, and re-spelling 400 diagnostic sites is unbounded; the pre-test
measured recognition without a control or a threshold; and the mechanism
criterion was satisfiable by construction while `data_modeling` was only
reported.

| Finding | Disposition in revision 2 |
| --- | --- |
| The premise overclaims (all three) | Summary and §1 rewritten as the open question, with the counter-evidence cited and Opus's counter-expectation registered |
| The runtime is LLP 4000's; no `sync` spelling (Opus B1, Grok B2, Astra 19) | §2 names Snapback 4's runtime; §3.2 adds `alter publication` with Snapback 4's default and `E_SYNC`; LLP 4000 §13 corrected |
| §3 cannot spell the target; the showcase does not parse or lower (all three) | §3 replaced by the normative table with ✓/≈/✗ per row; verification twice required before §7 |
| Policies: grammar unstated, `old` hidden, recursion, roles, omitted `with check` (Astra 3, Opus 4, Grok) | §3.3: the grammar stated; transitions as the `before update` trigger form; security-definer inlining; `to service_role`; omitted `with check` as Postgres |
| `min`/`max`, `latest`, in-table counts (Astra 5, Grok, Opus) | `latest` withdrawn; counters as `generated always as (snapback.count(…)) stored`; extrema out |
| Recorded attribution, `day()`, zero groups (Astra 6, Opus 6) | `snapback.recorded`, `snapback.day`, zero-preserving forms in §3.4 |
| The three additions' semantics lost (Astra 7) | §3.2 rows for `written by` (private by default, opt-out), `sequence` (shared counter), the row-keyed view (`left join`, pending recount) |
| Views/shapes/Following (Astra 8, Opus 6) | §3.4: the bijection, `union all`, nullable point subselects, Following's admission |
| Queries cannot express `socialProfile`/`insights`; the cursor is implicit (Astra 9, Grok, Opus 7a) | §3.5: `language plpgsql stable` bodies, `into strict` + `no_data_found`, range loops; the cursor rule; `%type` references |
| DML semantics differ; the subset omits `:=`, `elsif`, `found`; jobs unclassified; schedules compute `now()` (Astra 10–12, Opus 7, Grok) | §3.6: point writes by full key with `NOT_FOUND`; the full statement grammar; `create procedure` for jobs; period-plus-offset cron with engine-supplied bounds; `once => array[…]` |
| SQL value semantics unbudgeted (Astra 13, Opus 11) | §3.7: SQL null semantics by guard insertion (ruling asked in §11); the admitted expression subset listed |
| §3.7 incomplete; Quarry names wrong (all three) | §3.7 rewritten in three categories under one rule; `retain`/`cap` restored |
| Immutability inferred from policies (Astra 4, Opus 12) | `grant update (cols)` states the mutable columns |
| Device admission a silent downgrade (Opus 13, Grok) | `E_SYNC` restored via the publication spelling |
| The pre-test measures reading (all three) | §7: the corpus replay and the blind writing test with registered stop rules; reading kept as a reported number |
| The comparison passes by construction; `data_modeling` unregistered; floors wrong; two rules on SUBSET (all three) | §8: symmetric masked SURFACE class; a registered directional prediction as the primary result; language-relevant floors; one fail rule; the maturity gate |
| The lowering target is wrong; `sqlparser`; diagnostics unbounded (all three) | §4: `pg_query` → `ast::Document` → `print` → the unchanged binary; the equivalence gate; tiered diagnostics; a code family |
| LLP 3000.009 §6.2 unreconciled (Opus 14) | §3.5 and §6: the relief valve in both arms; increment D before the comparison |
| One spelling, one refusal code, `api.ts` naming undecided (Opus 15) | §3.7 and §11 |
| Evidence rows overstate (Opus 17, Grok) | §1 corrected |

Revision 2 goes back to the same three families.

## Non-claims

This RFC does not claim SQL removes completeness classes, device
admission, the mutation subset, or `now()` on the device; §5 says they
stay. It does not change the engine, the grader, the brief or the protocol.
It does not predict the outcome beyond the registered directional
prediction of §8, and it records the counter-expectation beside it. It
stops at §9 step 3 if either pre-test's stop rule fires.
