# LLP 4001: Snapback 5, second bet — the same engine under a language builders already know

**Type:** RFC
**Status:** Draft
**Role:** Root of the Snapback 5 corpus's second bet (LLP 4000, the first, is Shelved)
**Systems:** A SQL front-end for the Snapback 4 engine: Postgres's own parser, a resolver, a lowering to the Quarry declaration AST, a document printer, and the unchanged `snapback4` binary; policies as rules; a residency spelling; views and maintained aggregates; SQL and plpgsql subsets as queries, mutations and jobs; the guide; the pre-tests and the calibration protocol
**Author:** Claude Fable 5.1, at Charlie Cheever's request ("let's try it", 2026-09-25)
**Date:** 2026-09-25
**Revised:** 2026-09-25 (revision 3, after the round-2 delta reviews, all NOT READY and all saying "close, nothing needs a redesign" — [Astra](./reviews/4001-snapback5-sql-front-end.astra.md), [Grok](./reviews/4001-snapback5-sql-front-end.grok.md), [Opus](./reviews/4001-snapback5-sql-front-end.opus.md): every Snapback fact that is not legal Postgres after the stubs respelled as a `select snapback.…(…)` call or a `comment on`; reference columns, the principal type and the scalar mapping given rows; the update-rule combination stated as one formula; the transition form made the ordinary `returns trigger` function; `immutable` as a call that binds every writer; the document printer, the resolver and two-level parsing named as lane work; the equivalence gate redefined on the bound IR of the original pinned `.q` with the unchanged tools as oracle; the null ruling decided; the pre-tests re-registered with a corpus manifest, per-kind classes, per-instance idiom stops and margins; §8's floors restored to LLP 4000's design with the all-zero case and the N = 3 power stated; #19's forms given rows or GAPs; §12 records round-2 dispositions; **this is the bounded stop: the document goes to the author with the round-3 verdicts**); 2026-09-25 (revision 2); 2026-09-25 (§11 ruling); 2026-09-25 (initial)
**Related:** [LLP 4000](./4000-snapback5.rfc.md) (the first bet, Shelved; §13 corrected again by this revision), [LLP 3000](./3000-snapback4.explainer.md), [LLP 3000.007](./3000.007-relaxed-quarry-and-explicit-residency.rfc.md) §5–§6, [LLP 3000.013](./3000.013-quarry-states-intent.rfc.md), [LLP 3000.015](./3000.015-shared-baseline-for-snapback5.spec.md), [LLP 3000.009](./3000.009-general-purpose-backend.rfc.md) §6.2 (server-only SQL reads over declared projections; not a relief valve for this bet), [LLP 3000.012](./3000.012-application-still-owns-derived-data.research.md), [LLP 0329](./0329-agent-native-rebuild-diagnosis.research.md) and [LLP 0252](./0252-convex-familiar-authoring-profile.rfc.md), the [September 5 three-backend run](../benchmarks/runs/2026-09-05-clique-full-3x3/README.md)

## Summary

The first Snapback 5 bet removed the residency spelling from Quarry and was
shelved after nine blind reviews (LLP 4000 §13). This bet keeps the
Snapback 4 engine untouched and replaces the authoring surface with SQL
forms a Postgres or Supabase builder already writes: DDL for tables,
row-level-security policies for rules, a `snapback.publish(…)` call for
residency, views and materialized views for planned and maintained reads,
SQL functions and a plpgsql subset for queries, mutations and jobs,
`pg_cron`'s form for schedules. The front-end is a transpiler: Postgres's
own parser reads the file, a resolver builds the catalog and binds names,
the lowering produces the Quarry declaration AST, a document printer emits
Quarry source, and the unchanged `snapback4` binary binds, plans, checks
and serves it. The device is untouched; the treatment is the spelling.

**The premise, stated as the open question it is.** The learning-cost
record charges Quarry in every ledgered `data_modeling` note, and a share of
those phrases name the language. But the lane this grader scored at 94
wrote *unrestricted* Postgres with authorization in JavaScript and no
policies; the lane that used the RLS-and-RPC frame this RFC proposes scored
85; five of the eight "language" phrases name restriction, not
unfamiliarity; the current release's note names no language item; and the
one in-house precedent for a familiar surface (LLP 0252's familiar profile)
"removed authoring syntax friction and still finished worse." The question
this bet asks is: **does a *restricted* SQL keep the familiarity credit that
*unrestricted* SQL earned, when the restrictions are the ones the engine
needs for devices, prediction and disclosure?** Six reviews said that
question should be answered before any compiler is built, and §7 answers it
with two compiler-free tests whose corpus, classes, stop rules and margins
are registered here.

This is the third and last revision under the refine loop's bounded stop.
It goes to the author with the round-3 verdicts. Nothing is built.

## 1. Evidence

| Observation | Source | What it supports |
| --- | --- | --- |
| Learning-cost phrases across the 16 ledgered `data_modeling` notes, counted from the abridged evidence: bounds 11, the language itself 8, completeness 5, residency 2–3, prediction 1. The classes overlap; LLP 3000.012 §2.2 says LC overlaps RM and CP and declines a single-cause reading | LLP 3000.012 §2.2; the LLP 4000 Opus round-1 count | The language is a named item, not an isolated cause |
| Of the eight "language" phrases, five name restriction ("restrictive rule expressions", "less flexible than … SQL", "fewer language escape routes", "restricted joins/scans", "constrained expressiveness"); three name unfamiliarity | the same notes, read by the Opus review of this RFC | A SQL surface that refuses SQL removes unfamiliarity and sharpens restriction, because the prior becomes full Postgres |
| The Supabase lane that scored 94 in `data_modeling` (Astra scorer; Grok 86, Muse 85, mean 88) enabled RLS on 22 tables with **zero** `create policy`, put authorization in the API (scored 78), kept its counters in a trigger, ordered with a sequence and `row_number()`, searched with a GIN expression index, and wrote its mutations as one jsonb-dispatching plpgsql function using `elsif`, `:=`, `found`, `select … into`, `for update` and set-based `insert … select` | `~/clique-full-20260905/lanes/astra-supabase/{schema.sql,scripts/mutations.sql}`; `scores/summary.md` | The 94 credits unrestricted Postgres plus application-owned work |
| The only lane that used RLS policies, RPCs and pg_cron (Muse) scored 85 in `data_modeling`; its policies call `security definer` helpers (`is_member`, whose body has `left_at is null`) and its transition rules are `before update` trigger functions comparing `OLD` and `NEW` with `extract(epoch …)` and assignments to `NEW` | `~/clique-full-20260905/lanes/muse-supabase/db/` | The frame this RFC proposes has one data point, below Snapback 4's 90, and that lane's idioms are broader than this subset |
| Calibration #19 (0.4.0): `data_modeling` 90, the series high, up from 82 at 0.2.32. Its note in full: "Shared Quarry declarations unified server and replica logic; maintained counts and day buckets were concise. Recipient receipts required explicit rows/helpers, and prediction/completeness introduced learning overhead." Its comparison line in full: "Compared with familiar TypeScript or SQL authoring, Quarry introduced learning cost while providing concise declarations and useful prediction diagnostics." Its essay: "Quarry itself added learning cost. I tried an unsupported object-spread form, used an empty text match where a browse branch was needed, and initially chose a schedule duration spelling the compiler rejected. Those were authoring mistakes against a new surface, not missing backend capabilities." | #19 FINAL and essay; LLP 3000.013 §12 | The current charge names receipts (removed in both arms by LLP 3000.015), prediction and completeness (kept in both arms), three first-try refusals answered in 0.4.1, and the language by comparison with a familiar one, in the same breath as its diagnostics' value |
| In the Grok-family re-score beside Snapback 4 0.4.0, Snapback 4 scored 84 and Supabase 80 in `data_modeling`; the same Supabase lane scored 86 beside Snapback 2 | the re-score record | The 94 is anchored and N = 1 |
| LLP 0329 records a familiar-profile arm (LLP 0252) that "removed authoring syntax friction and still finished worse … the friction that costs milestones is behavioral, not syntactic"; the N ≥ 3 matrix never ran | LLP 0329 | The one precedent for this bet is negative and unfinished |
| The categories at 94–97 rest on declarations that move work to the platform; no builder has a prior for `sync to` or `retain` | LLP 3000.012 §2.1 | Ownership, not familiarity, is the ledger's own reading of the ceiling |
| On the 2026-09-24 reference lanes (parallel, not claim-eligible): Snapback 4 M8 first green 68 min / last evidence 128; Convex 64 / 152; Supabase 134 / 364 under hosted-auth throttling | `~/clique-ref-20260924` | The engine's clock and correctness are competitive; the authoring score is the open goal |
| The engine has no SQL parser. `pg_query` (libpg_query) is Postgres's own parser with a plpgsql entry point that returns embedded SQL as strings. The binder consumes `Vec<ast::Document>` (`lib.rs`: `compile` → `parse_document` → `bind`) and emits the IR. `print.rs` prints expressions, reads, quoted strings and scalar types for diagnostics; **it does not print a document** | `snapback4/crates/snapback4-lang/src/{lib.rs,bind/mod.rs,print.rs}` | The pipeline is SQL → resolver → Quarry AST → a new document printer → the unchanged binary; the printer is lane work |
| Diagnostics are built at about 400 sites with pre-formatted Quarry messages and rewrites; `why`, `--residency`, `--cost` and runtime refusals print Quarry | `snapback4-lang/src/diag.rs` | Re-spelling every diagnostic is unbounded; tiering is required, and what the SQL arm still reads in Quarry counts as surface (§8) |
| The Supabase corpus on this host, excluding `attempt1/` and `m7/inherited/` duplicates: nine files, 1,729 lines, about 355 top-level statements (Astra 105, Grok 44, Muse 206), of which about 104 are `drop … if exists` and `enable row level security`, and 44 are `create [unique] index` | `~/clique-full-20260905/lanes/{astra,grok,muse}-supabase/` | Pre-test 1's manifest, and why its classes must be registered per statement kind |
| Postgres 17 is installed on the black M5 Max (`/opt/homebrew/opt/postgresql@17`) | this host | The form table can be verified against a real server with the stub schema before any pre-test |

What the evidence supports: an experiment. What it does not support: an
expectation. Opus's stated expectation, registered beside the bet's
prediction in §8, is that the SQL arm's `data_modeling` lands within noise
of the control while `diagnostics_dev_loop` and `setup_and_docs` fall.
Pre-test 1 is the cheapest instrument that can show that expectation wrong,
and it needs no Snapback 5 code.

## 2. The bet on one page

**The runtime is Snapback 4's**, exactly as LLP 3000, LLP 3000.007 §6
(residency: a table with neither `sync` nor `online only` is online-only;
horizons are authored; the audience is inferred from the read rule when the
`to` clause is omitted, and an explicit audience must agree with it), LLP
3000.013 (the planner, `view`, streaming aggregates, self-chunking jobs) and
LLP 3000.015 (the additions, landed in the shared baseline before any step
of §9 that needs them) define it. LLP 4000 §4–§5 are not the runtime of
record; only LLP 4000 §4.5 is cited, as a restatement of Snapback 4's
predictor. Nothing in `snapback4-core`, `snapback4-device` or
`snapback4-lang` changes for this bet.

**The authoring surface is SQL, transpiled to Quarry.** A `.sql` program is
parsed by Postgres's parser, resolved against a catalog built from its own
DDL, lowered to the Quarry declaration AST, printed as Quarry into a build
directory (never into the project tree), and given to the unchanged
`snapback4` binary. Diagnostics map back to the SQL line through a span
map the printer emits.

**The treatment is the spelling, plus what the SQL arm still reads in
Quarry.** `why`, `--residency`, `--cost`, runtime refusals and every
diagnostic outside the SQL-rewritten tier print Quarry; the maturity gate
(§8) lists exactly which, and the SURFACE class counts them. Both arms run
one engine build carrying LLP 3000.015. The equivalence gate (§4) requires
the transpiled program's bound IR to equal the original pinned Quarry
program's, so residency, plans, prediction facts and `why` are identical by
construction. The control is Quarry on the same binary.

## 3. The surface: a normative form table

**Verification, before §7 runs:** every SQL spelling below is executed
against Postgres 17 with the stub schema (`snapback5/stubs/snapback.sql`:
the `snapback` and `auth` schemas' domains and IMMUTABLE stub functions, and
the `snapback` publication), and the lowered Quarry is bound by `snapback4
check` on the shared baseline commit. The transcript of that run is
committed with the table. Rows that fail either check are corrected or
marked ✗ before any pre-test.

Key: **✓** maps · **≈** maps with a stated difference · **✗** no spelling
(a GAP the pre-tests count) · **B** the row has an entry in §3.7 B.

### 3.1 Program, identity, types

| Quarry form | SQL spelling | Lowered Quarry | Difference |
| --- | --- | --- | --- |
| `use identity password` | `select snapback.identity('password');` | `use identity password` | a configuration call (**≈**, B) |
| `effect push` | `select snapback.effect('push', from => 'push.mjs', attempts => 5, backoff => '30s', deadline => '1h');` | `effect push` with its `WorkDecl` | the call carries the effect's work policy; no composite type (**≈**, B) |
| `viewer` | `auth.uid()`, returning the domain `snapback.principal` (text) | `viewer` | Supabase's name with Snapback's type: principals are text and include `'service:x'`; a `uuid` principal column is refused with the rewrite `snapback.principal` (**≈**, B) |
| `principal` column | `owner snapback.principal not null` | `owner: principal` | (**✓**) |
| `t` reference column, `t ?` | `post_id snapback.id not null references posts (id)`, `parent_id snapback.id references posts (id)` | `postId: posts`, `parentId: posts ?` | Snapback enforces neither existence nor deletion; `on delete`/`on update` clauses are refused (**≈**, B) |
| bare `id` column, `id` argument | `snapback.id` | `id` | client-minted; no default (**≈**, B) |
| `text`, `text <=N`, `text M..N`, `int`, `bool`, `time`, `duration` | `text` (bare means `<=10000`), `text check (length(col) <= N)` / `between M and N`, `bigint` (53-bit), `boolean`, `timestamptz` (integer milliseconds; a literal `0` is admitted), `interval` literals | the Quarry types | the domains and literal conversions are stated in B (**≈**, B) |
| `format handle`, `format url` | `check (col ~ snapback.format('handle'))` | `format handle` | a named format, not arbitrary regex (**≈**, B) |
| `enum('a','b')` | `create type role as enum ('a','b')` (canonical) or `check (col in ('a','b'))` | `enum(…)` | (**✓**) |
| `default now`, literals | `default now()`, literals | same | `default now()` predicts; `clock_timestamp()` refused (**✓**) |
| `image <=N`, `video <=N`, `once` | `photo snapback.image, constraint photo_bound check (snapback.bytes(photo) <= 10000000)`; `select snapback.once('messages', 'photo');` | `image <=N`, `once` | domains take no typmod; the bound is a check and view-once a call (**≈**, B) |

### 3.2 Tables

| Quarry form | SQL spelling | Lowered Quarry | Difference |
| --- | --- | --- | --- |
| `unique a, b` | `unique (a, b)` | same | (**✓**) |
| `unique handle else HANDLE_TAKEN 'That handle is taken.'` | `constraint handle_taken unique (handle); comment on constraint handle_taken on profiles is 'That handle is taken.';` | `unique handle else HANDLE_TAKEN '…'` | only a **commented** constraint becomes a client-visible code; a clash with a hidden row is `E_RULE`, never the code (**≈**, B) |
| `immutable a, b` | `select snapback.immutable('posts', 'author_id', 'parent_id', 'at');` | `immutable authorId, parentId, at` | binds every writer, jobs included; no call means Quarry's default (nothing immutable) (**≈**, B) |
| `search a, b` | `select snapback.search('profiles', 'display_name', 'handle');` | `search displayName, handle` | word-prefix search; `create index` is refused (**≈**, B) |
| `cap 50 by conversationId` | `constraint at_most_50 check (snapback.cap(50, conversation_id))` | `cap 50 by conversationId` | a cross-row check (**≈**, B) |
| `cap 1 by principal`, `cap 50 by chat, message` | `check (snapback.cap(1, principal))`, `check (snapback.cap(50, chat, message))` | same | (**✓**) |
| `retain delivered-history` | `select snapback.retain('messages', 'delivered-history');` | same | (**≈**, B) |
| `expire at .expiresAt` | `select snapback.expire_at('messages', 'expires_at');` | same | (**≈**, B) |
| online-only table | no `snapback.publish` call | no line | Snapback 4's default (**✓**) |
| `sync public`, `sync to members[.conversationId]`, `sync to .principal`, `sync … last N by .k`, `by .principal` | `select snapback.publish('messages');` with `horizon => 'last 500 by at'`, `recipient => 'principal'` as named arguments | `sync` (audience inferred from the select policy), `sync last N by .k`, `by .principal` | a published table whose select policy is not one of the three invertible shapes refuses with `E_SYNC`; publication means residency, not Supabase Realtime (**≈**, B) |
| `likeCount: count likes`, `count posts by .parentId`, `sum likes of .weight`, `count … where …` | `like_count bigint generated always as (snapback.count('likes')) stored`; `snapback.count('posts', by => 'parent_id')`; `snapback.sum('likes', of => 'weight')`; filtered counts as a materialized view (§3.4) | the maintained column | executes with an IMMUTABLE stub; the reference from contributor to owner must be unique or named by `by`; expiring sources refuse as today (**≈**, B) |
| `public 'reason'` | `create policy … for select using (true); comment on policy … on t is 'reason';` | `public 'reason'` | the composed read rule must be public for the reason to apply (**≈**) |
| LLP 3000.015 `written by .principal` (+ `readable by audience`) | `select snapback.written_by('members', 'read_up_to', by => 'principal');` and `, visible => true` for the opt-out | `written by .principal` | private to the owner by default; exempt from `snapback.immutable`; LLP 3000.015 §1's authority contract (**≈**, B) |
| LLP 3000.015 `sequence by conversationId` | `ordinal bigint generated always as (snapback.sequence(conversation_id)) stored` | `sequence by conversationId` | Postgres's own "system-assigned, cannot be supplied" meaning is `E_SEQUENCE_SUPPLIED`; one counter per parent row shared across tables; the parent column must be a reference (**≈**, B) |
| `enable row level security` | required on every table with a policy | nothing | a policy on a table without it is refused; owners do not bypass (**≈**, B) |

### 3.3 Rules

**Grammar.** A policy expression is Quarry's rule grammar and nothing more:
`and`, `or`, `not`, `=`, `<>` (canonicalized), `is [not] null` over a
column, a column, `auth.uid()`, a literal, a key probe `exists (select 1
from t where t.k = x.k [and t.col = <literal>]* and t.principal =
auth.uid())`, and `snapback.created(t, col)`. Ordered comparisons,
arithmetic, `now()` and other functions are refused with the rewrite "move
this condition into the mutation as `raise exception`" (for write rules) or
"declare `snapback.expire_at`" (for read rules on time). Probes inside
policies read without policies; a `language sql stable security definer`
helper whose body is exactly an admitted probe is inlined and recognized as
that probe; any other helper body is refused (Muse's `is_member`, whose body
has `left_at is null`, is not an admitted probe).

**Combination.** A table's update rule is one `update (old, next)` rule:
(⋁ permissive `using`)[old] ∧ (⋁ permissive `with check`, else their
`using`)[next] ∧ (⋀ restrictive) ∧ (⋀ transition conditions). This answers
the draft→published case: two permissive policies combine per image, not
as paired predicates. Transition conditions do not bind jobs (the system
principal consults no rules); `snapback.immutable` does.

| Quarry form | SQL spelling | Lowered Quarry | Difference |
| --- | --- | --- | --- |
| `read <- expr` | `create policy p on t for select using (expr)` | `read <- expr` | probes do not recurse (**≈**, B) |
| `insert <- expr` | `for insert with check (expr)` | same | (**✓**) |
| `delete <- expr` | `for delete using (expr)` | same | an RLS-denied delete is `DELETE 0` in Postgres and `E_RULE` in Snapback (**≈**, B) |
| `update <- expr` (single image, tests the next row) | `for update using (expr) with check (expr)`, or `using (expr)` alone, where `expr` reads only immutable columns and `auth.uid()` | `update <- expr` | canonicalized: old and next agree when the columns read are immutable; `with check` alone is refused with this rewrite, because in Postgres it admits no row (**≈**, B) |
| `update (old, next) <- expr` | a `returns trigger` function whose body is exactly `if not (<cond over old/new>) then raise exception 'CODE'; end if; return new;` plus `create trigger … before update on t for each row execute function f()` | `update (old, next) <- cond` | the condition is the policy grammar over `old.`/`new.`; assignments to `new` are refused; the trigger does not bind jobs (**≈**, B) |
| several rules for one effect | several permissive policies; `as restrictive`; `for all` (four policies) | one rule per effect, combined as above | (**≈**, B) |
| `or viewer = 'service:x'` | `or auth.uid() = 'service:x'` in the policy | the service grant | `to service_role` is refused with this rewrite; `to authenticated` is ignored (**≈**) |
| `through .ref` (LLP 3000.014) | — | — | **✗** for this experiment |

### 3.4 Views and aggregates

A `create view` is planned at read time and runs as the viewer (filters,
projections, single-row point subselects, `union all`); a `create
materialized view` is engine-maintained: an ordinary grouped aggregate
(maintained in the writing transaction, rule-filtered, an absent group
reads 0 and a hidden group reads nothing), LLP 3000.015's row-keyed count
(pending recount when a mark moves further than the writer's meter allows),
or Following (delivered per reader in the background, `complete: false`
while its backfill is pending). Each mismatch between the author's keyword
and the engine's shape refuses with the rewrite. Policies cannot be created
on materialized views in Postgres, so a maintain's residency and read rule
are calls: `select snapback.online_only('follower_count');`.

| Quarry form | SQL spelling | Lowered Quarry | Difference |
| --- | --- | --- | --- |
| `view activity: posts where … { post: .id, actor: .authorId, at, repost: false }` + `reposts { … }` | `create view activity as select id as post, author_id as actor, at, false as repost from posts where parent_id is null and not removed union all select post_id, actor_id, at, true from reposts` | the union view | `union` (distinct) refused; branch identity kept for cursors (**≈**) |
| `view following: activity where .actor = viewer or exists follows[viewer, .actor]` | `create materialized view following as select * from activity where actor = auth.uid() or exists (select 1 from follows f where f.follower_id = auth.uid() and f.followed_id = activity.actor)` | the Following view | admitted only under LLP 3000.013 §4's full rule: published public sources, owner-only writes, immutable mapped columns, the declared edge key; else `E_FEED` (**≈**, B) |
| `view followerCount: count follows by .followedId` | `create materialized view follower_count as select followed_id, count(*) as count from follows group by followed_id` | the count view | absent group 0; hidden group nothing (**≈**, B) |
| `view originalPosts: count posts where .parentId = null by .authorId` | `… select author_id, count(*) as count from posts where parent_id is null group by author_id` | the filtered count | `is null` spells Quarry's `= null` (§3.7 B) (**≈**) |
| `view receivedLikes: count likes by .postId.authorId` | `… select snapback.recorded(post_id, 'author_id') as author_id, count(*) as count from likes group by 1` | the recorded-attribution view | binds only when `post_id` is a reference, the hop is immutable and the target public; a missing target captures null (**≈**, B) |
| `view dailyLikes: count likes by .postId.authorId, day(.at)` | `… select snapback.recorded(post_id, 'author_id') as author_id, snapback.day(at) as day, count(*) as count from likes group by 1, 2` | same | `snapback.day` is the UTC millisecond day ordinal (**≈**, B) |
| LLP 3000.015 `view unread: count messages by members m where …` | `create materialized view unread as select m.id, count(x.id) as count from members m left join messages x on x.conversation_id = m.conversation_id and x.ordinal > m.read_up_to and x.sender_id <> m.principal and not x.tombstone group by m.id` | the row-keyed view | LLP 3000.015 §3's contract: the member row's read rule; the writer-side bound; `complete: false` and a background recount above it (**≈**, B) |
| `view postTotals: … online only` | `select snapback.online_only('post_totals');` | `online only` on the maintain | (**≈**) |
| `shape postCard = { *, author: profiles[principal = .authorId], replyCount: replyCount[.id], liked: exists likes[.id, viewer] }`, applied to two sources | `create function post_card(p posts) returns post_card_t language sql stable as $$ select p.*, (select pr from profiles pr where pr.principal = p.author_id) as author, coalesce((select c.count from reply_count c where c.parent_id = p.id), 0) as reply_count, exists (select 1 from likes l where l.post_id = p.id and l.principal = auth.uid()) as liked $$` | the named shape | PostgREST's computed-field idiom: a function over the row type; a scalar row subselect is a nullable point read; `activity_card(a activity)` serves both `home` and `global` (**≈**, B) |
| spread `{ ...p, followers, following }` | `select (p).*, … ` over a bound record `p` | the spread | record expansion, not a scan (**≈**) |

### 3.5 Queries

A query is a `stable` function: `language sql` with one `select`, or
`language plpgsql` with the admitted body of §3.6 minus writes. An
`immutable` function is a helper (`fn`) and is not in `api.ts`. A page is a
`return query select … order by … limit N` with a `snapback.cursor`
argument; a function may have several `return query` pages, each with its
own cursor argument, which is the returned-page ownership rule of the
control; a keyset `where` on a cursor is refused. Reference-typed
arguments are `posts.id%type` and are typed references by a Snapback rule
(Postgres itself erases the type); `%type` of a bounded or formatted column
carries its bound and format. Optional arguments are `default null`; list
arguments are `snapback.id[]` with `check (cardinality(ids) <= 50)`
spelled as `snapback.bound(ids, 50)` in the body's first statement.
Argument typmods are honoured (`q varchar(100)` is `text <=100`).

| Quarry form | SQL spelling | Lowered Quarry | Difference |
| --- | --- | --- | --- |
| `query home(c: cursor ?): return following last 20 by .at after c activityCard` | `create function home(c snapback.cursor default null) returns setof activity_card_t language plpgsql stable as $$ begin return query select activity_card(f) from following f order by f.at desc limit 20; end $$` | the page over `following` | (**✓**) |
| `query global(c)` | the same over `activity` | the page over `activity` | one shape, two sources (**✓**) |
| `query thread(postId: posts, c)` | `thread(post_id posts.id%type, c snapback.cursor default null)` | `postId: posts` | `%type` is a Snapback reference rule (**≈**, B) |
| `query people(q: text <=100, c)` | `people(q varchar(100), c …)` | `q: text <=100` | the typmod is honoured (**≈**, B) |
| `matching q` | `where snapback.matches(profiles, q)` | `matching q` | (**≈**) |
| `socialProfile(handle: text 3..20 format handle)`: `profiles[handle = handle]! else NOT_FOUND`, spread, aggregate point reads, `exists` | `social_profile(handle profiles.handle%type) returns social_profile_t language plpgsql stable`: `select * into strict p from profiles where profiles.handle = social_profile.handle; … exception when no_data_found then raise exception 'NOT_FOUND';` | `! else NOT_FOUND` and the object | the one admitted exception block; an unqualified name that collides with a column is refused with the qualified rewrite (**≈**, B) |
| `insights`: `for d in range(a, b)`, list building, object return | `returns insights_t language plpgsql stable`: `for d in a..b-1 loop days := days \|\| row(…)::day_t; end loop; return row(…)::insights_t;` | the loop and the object | `range(a, b)` is end-exclusive, so `a..b-1`; a declared composite, never json (**≈**, B) |
| `trending`: `where .parentId = null and not .removed and .at > now - 24h and .at <= now last 10 by .likeCount, .at` | `where parent_id is null and not removed and at > now() - interval '24 hours' and at <= now() order by like_count desc, at desc limit 10` | the bucketed window | both endpoints required; the admitted interval shapes are `now() ± interval '<n> <unit>'` (**≈**, B) |
| aggregate reads without a view (streaming) | `select count(*) … into n` in a body | the streamed aggregate | null on a meter cut (LLP 3000.013 §5.1) (**≈**, B) |
| `fn` helpers (`editWindow`, `receiptState`, …) | `language sql immutable` functions | `fn` | not in `api.ts` (**≈**, B) |
| `mutation edit(…): server` | `select snapback.server('edit');` | `: server` | (**≈**) |
| LLP 3000.009 §6.2 `sql reading … returning …` | — | — | **✗** for this experiment: §6.2 admits bounded reads over declared projections in the store's dialect, gated on increment D, not arbitrary reads of managed tables; an unlowerable read is refused |

### 3.6 Mutations, jobs, schedules

A mutation is `create function … language plpgsql volatile` and is
client-callable; a job is `create procedure`, never in `api.ts`. The
admitted statement grammar is Quarry's, spelled the plpgsql way: `declare`
(locals; `p record` for a `for p in select` loop is exempt from the
prelude-local rule; per-iteration locals in a nested `declare … begin …
end`), `:=`, `if … elsif … else`, `for r in <planned select> loop`, `for i
in a..b loop` (inclusive; lowered as written), `foreach x in array … loop`,
`continue`, `exit`, `select … into [strict]`, `found`, `insert … [on
conflict do nothing | on conflict (<key>) do update set …] returning … into`,
`update t set … where <full unique key> [and <cond>]`, `delete from t where
<full unique key>`, `perform snapback.emit(effect, payload, once => row(…))`,
`raise exception 'CODE'`, `return`. The admitted expression grammar is in
§3.7. Everything else (`execute`, cursors, exception blocks other than
`no_data_found`, set-based `update`/`delete`, `insert … select`, triggers
other than §3.3's) refuses with a code from §4's family and the rewrite.

| Quarry form | SQL spelling | Lowered Quarry | Difference |
| --- | --- | --- | --- |
| `insert t { … } if absent` | `insert … on conflict do nothing returning * into r` (targetless) | `if absent` | absorbs any readable unique clash; a hidden clash is `E_RULE` (**≈**, B) |
| `upsert t[k] { … }` | `insert … on conflict (<key>) do update set c = excluded.c, …` where every `set` uses `excluded` | `upsert` | the general `do update` (existing-row expressions, differing insert values) is refused (**≈**, B) |
| `update t[k] { … }` | `update t set … where <full unique key>` | point write | a missing or unreadable row raises `NOT_FOUND`, never `UPDATE 0` (**≈**, B) |
| `update t[k] { … } if cond` | `update … where <key> and <cond>` | `if cond` | a readable target with a false condition is `E_CONFLICT`; an unreadable target is `NOT_FOUND`; the pre-read is the engine's own (**≈**, B) |
| `delete t[k]` | `delete from t where <key>` | point delete | `NOT_FOUND` on a missing row (**≈**, B) |
| `require cond else CODE` | `if not cond then raise exception 'CODE'; end if;` | `require` | `cond` must be a non-null boolean; a nullable condition is refused (**≈**, B) |
| `emit push { … } once [a, b]` | `perform snapback.emit('push', json_build_object(…), once => row(a, b))` | `emit … once [a, b]` | a heterogeneous key is a `row(…)` (**≈**) |
| `if … else if exists likes[postId, viewer]` | `elsif exists (select 1 from likes l where l.post_id = post_id and l.principal = auth.uid()) then` | the probe in a condition | (**✓**) |
| `job daily(periodStart, periodEnd): for p in profiles: …` | `create procedure daily(period_start timestamptz, period_end timestamptz) language plpgsql as $$ declare p record; begin for p in select * from profiles loop declare n bigint; begin … end; end loop; end $$` | the sweep | the top-level `for` over a table is the chunked sweep; inner loops share the chunk; loop-carried state across chunks is refused (**≈**, B) |
| `schedule dailyDigest every 1d at 08:00: daily` | `select cron.schedule('daily-digest', '0 8 * * *', $$ call daily(snapback.period_start(), snapback.period_end()) $$)` | the schedule | admitted cron: `*/N * * * *` for N dividing 60, `M * * * *`, `M H * * *`; `every 90s` and weekday forms are GAPs; the period bounds are engine calls, never `now()` (**≈**, B) |
| `schedule … : insights.daily` | `call insights_daily(…)` with one `.sql` file per Quarry module | the qualified target | module = file name (**≈**, B) |
| presence deciding only an emit | `if not snapback.connected(p.principal) then perform snapback.emit(…); end if;` | the effects-only exception | (**✓**) |
| `after insert <-` | — | — | **✗** |

### 3.7 What is not Postgres, exhaustively

One rule decides membership: **any construct whose Postgres meaning differs
from its Snapback meaning gets a row, even when its syntax is standard.**

**A. Executes only with the stub schema:** the domains `snapback.id`,
`snapback.principal`, `snapback.cursor`, `snapback.image`,
`snapback.video`; the IMMUTABLE stub functions `snapback.count`, `sum`,
`sequence`, `recorded`, `day`, `bytes`, `format`, `cap`, `matches`,
`connected`, `emit`, `period_start`, `period_end`, `bound`; the
configuration calls `snapback.identity`, `effect`, `publish`, `retain`,
`expire_at`, `search`, `immutable`, `written_by`, `once`, `online_only`,
`server`; `auth.uid()`; and the `snapback` publication. Every row of §3
parses **and executes** on Postgres 17 with `snapback5/stubs/snapback.sql`
loaded; the transcript is committed.

**B. Standard syntax with Snapback semantics:** policies do not recurse
into probed tables; a policy on a table without `enable row level security`
is refused, and owners do not bypass; `using (E) with check (E)` and
`using (E)` alone canonicalize to the single-image rule when `E` reads only
immutable columns; `with check` alone is refused; the update-rule
combination formula of §3.3; the transition trigger does not bind jobs and
cannot assign `new`; an RLS-denied `update`/`delete` is `E_RULE` or
`NOT_FOUND`, not zero rows; a `create view` runs as the viewer; a
materialized view is maintained (three kinds, §3.4), never refreshed, reads
0 for an absent group and nothing for a hidden one; a scalar row subselect
is a nullable point read; `%type` is a typed reference and carries bounds
and formats; `return query … limit N` with a cursor argument is a page and
the cursor is never in `where`; a targetless `on conflict do nothing` is
`if absent` and absorbs any readable clash; `on conflict do update` admits
only `excluded` values; point writes raise `NOT_FOUND`; `raise exception
'CODE'` carries an application code; a `create procedure` is a chunked job
and is not in `api.ts`; `immutable` functions are helpers and not in
`api.ts`; `cron.schedule` admits period-plus-offset expressions only and
the period bounds are `snapback.period_start()`/`period_end()`;
`snapback.immutable` binds every writer including jobs; only a commented
unique constraint yields a code; `generated always as (snapback.count(…))
stored` is an engine-maintained counter; `snapback.sequence(col)` is one
counter per parent row shared across tables, supplied values refused;
`snapback.recorded` is a captured attribution path (missing target
captures null); `snapback.day` is the UTC millisecond day ordinal; `default
now()` predicts and `clock_timestamp()` is refused; **equality is Quarry's
total equality**: `is null` / `is not distinct from` lower to `= null` /
`=`, the literal `col = null` and `col <> null` are canonicalized to them,
and bare `=` / `<>` / `in` / `not in` over a nullable operand is refused
with that rewrite (the ruling of §11); `is [not] null` on a record is
refused with the rewrite `found`; bare `text` is `text <=10000`; `bigint`
is 53-bit; `timestamptz` is integer milliseconds and `interval` literals
are milliseconds; `sum` over an empty set is 0; a streamed `count(*)`
returns null on a meter cut; `snapback.publish` is residency, not Realtime
(unpublished tables still answer live queries from the server); a
`written_by` column is private to its owner by default; `auth.uid()` is
`snapback.principal`; a `uuid` principal column is refused; `snapback.id`
references enforce neither existence nor deletion; Snapback references
refuse `on delete`/`on update`; `for i in a..b` is inclusive and the
lowering keeps it so (a Quarry `range(a, b)` is `a..b-1`); an unqualified
name that collides between a parameter and a column is refused with the
qualified rewrite; module = file name.

**C. Refused Postgres, with the rewrite named:** `create index` (the
planner chooses; rewrite: delete it, or `snapback.search` for words),
`create trigger` other than §3.3's transition form (rewrite: a maintained
counter or a transition), `security definer` helpers whose body is not an
admitted probe, CTEs, window functions, set-based DML, `insert … select`,
`execute`, cursors, exception blocks other than `no_data_found`, floats,
`like`/`~` outside `snapback.format`, jsonb operators outside
`json_build_object`, `avg`, `string_agg`, `date_trunc`, `extract`,
`union` (distinct), `to service_role`, `on delete`/`on update`, `uuid`
principals, `alter publication`, `grant`, `*/7`-style cron.

**The admitted expression subset:** `= <> < <= > >= + - *`, `and or not`,
`is [not] null`, `exists <key probe>`, `in (select col from t where …)`
(a value lane, refused over a nullable column), `case when … then … else …
end` (Quarry's `a if c else b`), `coalesce(a, b)` (`??`), `least`/`greatest`
(Quarry's scalar `min`/`max`), `substr(s, i, n)` (Quarry's `slice`, with
the 1-based offset stated), `length`, `snapback.day`, `snapback.hour`,
`count`, `sum`, `array_agg`-free list building by `||`, `interval`
arithmetic on `timestamptz`, and the media fields (`video.duration` as
`snapback.duration(video)`). Floats are refused (LLP 3000.007 §5.7).

**One spelling.** The SQL surface canonicalizes the registered aliases only:
`<>`/`!=`; `col = null` and `col <> null` to the null tests; `using (E)
with check (E)` and `using (E)` alone to `update <- E` under the immutable
condition; `check (col in (…))` to the enum. `in (select …)` versus
`exists`, `union` versus `union all`, `coalesce` versus a point read and
inclusive versus exclusive ranges are **not** aliases and are not
canonicalized. `check` prints the canonical form once, as a note.

**`api.ts` naming:** identifiers are lowered from snake_case to camelCase;
a collision (`read_up_to` and `"readUpTo"`) is refused. The generated client
is the control's.

## 4. What the front-end is

- **Parser:** `pg_query` (libpg_query, pinned with the Postgres major
  version), in the `snapback5` CLI crate only. Its plpgsql parser returns
  embedded SQL as strings; each is parsed again, with offsets composed for
  the span map (two-level parsing).
- **Resolver:** a catalog built from the program's own DDL; Postgres name
  resolution (aliases, correlated subqueries, `%type`, quoted identifiers);
  plpgsql scoping; collision refusal between parameters and columns; the
  typing needed for the null rule and the canonicalizations.
- **Lowering:** the resolved program → `snapback4_lang::ast::Document`
  (the binder's own input), covering exactly the forms of §3.
- **The document printer:** new code in `snapback5` that prints the
  parser's subset of `ast::Document` (tables, rules, sync, indexes, views,
  feed views, maintains, shapes, programs, statements, schedules, effects)
  to Quarry source and emits the span map. Its acceptance test is the
  round-trip property `parse(print(parse(q))) == parse(q)` with sites
  stripped, over every `.q` in the guide corpus, the committed target and
  #19's four files. It is lane (a)'s exit criterion.
- **The unchanged binary** reads the printed Quarry from a build directory
  (never the project tree) and does everything else: `check`, `dev`,
  `serve`, `why`, `guide`.
- **The equivalence gate**, with the unchanged tools as oracle: the bound
  schema and program IR (`snapback4 check --json`, sites stripped) of the
  transpiled pinned SQL program must equal that of the **original** pinned
  `.q` file, and `why` on every operation must agree. Byte identity of
  printed text is reported, not gated, because a lossy printer would be
  lossy on both sides. The pinned Quarry is stated in the lowering's
  canonical form (bare `sync` where inferrable; no `online only` line).
- **Diagnostics, tiered:** SQL rewrites for every code the pinned program
  and the pre-test corpora can produce (sized after lane (c), when the
  compiler exists); every other code shows the Quarry message and the
  lowered line, labelled. Refusals use the family `E_SQL_STATEMENT`,
  `E_SQL_EXPRESSION`, `E_SQL_POLICY`, `E_SQL_VIEW`, each with a card section.
- **`check`:** the same output as Snapback 4's, in SQL terms.
- **The guide:** the cards the pinned program's forms use, in SQL, plus
  one card for §3.7; the first account within W14b's budget; the SQL card
  is frozen by hash before pre-test 2.
- **The client:** unchanged; `api.ts` is the control's.

## 5. What stays hard, in SQL

Unchanged from revision 2: completeness classes stay (an RLS builder
expects a query to enumerate the visible rows; the incomplete-result
contract is something to learn and the card says so); device admission is
about an exact delivery audience, and anything else on a published table is
`E_SYNC`; the mutation subset is Quarry's statement list in plpgsql
spelling, narrower than what both Supabase lanes wrote; `default now()`
predicts and a branch on `now()` does not. Added: a single-image update
policy checks only the proposed row, and a Postgres builder's habit of
`using (E) with check (E)` is what canonicalizes to it.

## 6. Relationship to Snapback 4 and to LLP 4000

- **Engine unchanged**, by the equivalence gate. `snapback5/` holds the
  transpiler crate (parser, resolver, lowering, printer), the CLI, the SQL
  guide, the stub schema, the pinned programs and the verification
  transcript.
- **Both arms carry LLP 3000.015** as the shared baseline commit, landed
  before any step of §9 that binds a program.
- **LLP 3000.009 §6.2** is not a relief valve for this bet; unlowerable
  reads are refused.
- **LLP 4000 §13** is corrected once more in this landing: its first
  sentence about "the item the record names most" and "the only surface
  this grader has scored at 94" is withdrawn.
- **`through`** (LLP 3000.014) is not in either arm for the experiment.

## 7. Pre-tests, compiler-free, before any lane

Both run on the verified form table (§3), after LLP 3000.015 has landed.

**Pre-test 1, the corpus replay (one day).** The manifest, committed by
hash: `astra-supabase/schema.sql` (92 lines), `astra-supabase/scripts/mutations.sql`
(95), `astra-supabase/scripts/m7-migration.sql` (42), `grok-supabase/server/schema.sql`
(309), `muse-supabase/db/{schema,rls,functions,rpcs,migrate-m7}.sql` (182,
155, 121, 294, 439). Units: top-level statements, **and** plpgsql body
statements inside every function, counted separately and both reported.
Classes, registered per statement kind before the run: `enable row level
security` → admitted (required); `drop … if exists` and `begin`/`commit` →
ignored (not counted); `create index` → refused (§3.7 C); `grant`/`alter
publication` → refused; `create policy` → admitted, refused or server-only
per §3.3; `create trigger`/trigger functions → admitted only in the
transition form; every function body statement → admitted, canonicalized
(a renaming the printer cannot distinguish, nothing else), or refused.
"Server-only" is not a class in this pre-test (§3.5's row is withdrawn), so
nothing escapes the refused count. A third family classifies, blind, with
the rubric by hash. **Stop rules:** the bet stops if more than one third of
the body statements, or more than one third of the top-level statements,
are refused; or if any instance of a membership policy, a counter, a
transition rule or a feed read is refused **wherever it occurs** (Muse's
`is_member` policy, Muse's counter trigger, Muse's
`enforce_message_windows`, Muse's `feed`, Astra's like-count trigger). One
third is an investment threshold, registered as such, not a calibrated
falsifier.

**Pre-test 2, blind writing (one day, after the SQL card is frozen by
hash).** Three families per arm, including the builder's, write the
messaging half of the Clique brief (which must include the edit window and
the read mark) from the brief and one card only: the SQL card for the
treatment, the Quarry language card at the baseline commit for the control.
Their statements are classified under one hand rubric by a third family
(the Quarry arm is also checked by `snapback4 check`). Each family then
predicts the outcome of five registered scenarios with fixed initial state
and published expected answers (a hidden row in a search; an offline send;
a removed member's history under `delivered-history`; a mark advance
across 10,000 messages; an edit after its window). **Stop rules:** the bet
stops if the SQL arm's refusal rate is more than 10 points above the Quarry
arm's, or its prediction accuracy is 3 or more of 15 below the Quarry
arm's. Passing is permission to build, not confirmation.

**The reading judgment** (three families read the pinned SQL program cold)
is a reported number and gates nothing.

## 8. Evaluation, pre-registered

- **Treatment:** the transpiled SQL surface, plus what it still reads in
  Quarry (listed by the maturity gate). **Control:** Quarry on the same
  binary. Both from one commit, published as `snapback5` and `snapback4`
  pre-releases; both carrying LLP 3000.015.
- **Maturity gate before any counted run:** both guides compile; the
  diagnostic tier covers every code the pinned program and the corpora can
  produce; the list of what the SQL arm reads in Quarry is committed; one
  uncounted pilot per arm with its fixes landed; the equivalence gate
  green; pre-test 2's programs lowered and behaviour-checked (§9 step 4).
- **The primary result, registered:** the treatment's `data_modeling` mean
  over three runs exceeds the control's by at least 3. At σ ≈ 2.6–3 per run
  and N = 3 per arm, P(met | true 0) ≈ 0.10 and P(met | true +4) ≈ 0.67;
  those numbers are registered so that a miss at N = 3 is recorded as
  **"not shown at N = 3"**, distinct from "failed", and the author may then
  choose N = 8. Opus's counter-expectation (within noise) is registered
  beside it. `data_modeling` is scored twice: by the series scorer from the
  narrative files, and by a second scorer family from masked files; both
  must meet the threshold.
- **The mechanism gate, symmetric:** one **SURFACE** class (learning-cost
  phrases about the authoring language, its syntax, its restrictions and
  its refusals, and the Quarry the SQL arm still reads), classified by a
  third family on notes where code spans and identifiers are replaced by
  placeholders and the product vocabulary (`Quarry`, `SQL`, `Postgres`,
  `Supabase`, `snapback4`, `snapback5`, `.q`, `.sql`, `policy`, `RLS`,
  `rule`, `trigger`, `procedure`, `function`, `cron`, `view`, `sync`,
  `publication`, the code names) is mapped to neutral tokens by a
  dictionary committed by hash; a blindness check (a classifier guessing
  the arm above 65% on held-out masked notes) extends the dictionary before
  the counted classification. Reading (A) holds when the treatment's
  SURFACE count **summed over the three pairs** (run i against run i in the
  registered interleaved order) is **strictly lower** than the control's and
  its total learning-cost count is at or below the control's. Zero in both
  arms is "no surface charge in either arm" and reading (A) **does not
  hold**.
- **Floors**, LLP 4000 §9.3's design: margin = 2 × the category's
  run-to-run sd over the last five control-series runs (holistic 4,
  `queries_and_live` 3, `offline_sync` 5, `client_integration` 9,
  `writes_and_transactions` 3, `setup_and_docs` 7, `diagnostics_dev_loop`
  and `authorization` computed and recorded before the runs), a floor fails
  only in the median run **and** in the mean of three, and the expected
  noise trip rate across the set is stated with the sds.
- **Correctness:** as LLP 4000 §9.3, with "where the control passes"
  meaning the control passed the same check in the same pair; a broken
  control voids the pair.
- **The clock:** reported; neither passes nor fails this bet.
- **One fail rule.** The bet **passes** when the primary is met by both
  scorers, every floor holds, correctness holds, and reading (A) holds. It
  is **not shown at N = 3** when the primary is missed but no floor,
  correctness check or reading (A) fails against the control. It **fails**
  when a floor, correctness or reading (A) fails where the control passes.
  Not passed never ships.

## 9. Order of work

1. This revision to the author with the round-3 verdicts (§12). No fourth
   round on this document.
2. LLP 3000.015 landed in Snapback 4 (lanes B1–B3, in their final reviews
   as this is written).
3. The stub schema and the verification transcript: every row of §3
   executed on Postgres 17 with the stubs, and every lowered form bound by
   `snapback4 check` on the baseline; ✗ rows registered as GAPs.
4. Pre-test 1 (needs no card, no compiler), then the SQL card frozen by
   hash, then pre-test 2. **Stop here for the author's decision.**
5. The instruments committed by hash before any lane: the corpus manifest,
   the classifier rubrics, the masking dictionary, the holdout probes, the
   pinned programs.
6. The transpiler in lanes: (a) `pg_query`, the resolver, DDL and policies
   → `ast::Document`, and the document printer with its round-trip test;
   (b) views, aggregates, shapes; (c) functions and procedures, then the
   diagnostic tier sized; (d) the span map; (e) the SQL cards; (f) the
   `snapback5` CLI and pre-release. Each lane: the equivalence gate on the
   pinned pair, tests, two blind reviews, landed under `snapback5/`. No lane
   may change `snapback4-*`. Pre-test 2's programs are lowered and
   behaviour-checked here.
7. The maturity gate, then the comparison of §8.

## 10. Risks, and what falsifies the bet

- **The charge moves to the subset.** Both Supabase lanes wrote triggers,
  security-definer helpers, CTEs, set-based DML, window functions,
  `date_trunc` and jsonb. Pre-test 1 measures the rate on their actual
  files; §8's SURFACE class counts it in the comparison.
- **Familiar syntax, unfamiliar meaning.** Category B is long. Pre-test 2's
  prediction task measures whether a Postgres reader guesses the meaning
  right.
- **The SQL arm still reads Quarry** in `why`, `--residency`, `--cost` and
  tier-2 diagnostics. Counted under SURFACE; listed by the maturity gate.
- **The scorer's prior cuts both ways.** The series scorer's family wrote
  the 94 note; a second, masked scorer is required on the primary.
- **A new front-end against a control polished over twenty waves.** The
  maturity gate and the floors on `diagnostics_dev_loop` and
  `setup_and_docs` are the defence.
- **The gate's oracle is the unchanged binary**, so a lowering that is
  wrong in the same way on both spellings of the pinned pair is caught only
  by the semantic fixtures (one per ≈ row, added in lane (a)) and by
  pre-test 2's programs when they are lowered.

## 11. Questions for the author, and the rulings

Ruled on 2026-09-25 ("recs all ok"): Postgres dialect only; the pre-tests
gate the compiler work; a separate `snapback5` package. Decided in this
revision, on the reviews' advice, and open to the author's veto:

4. **One spelling:** canonicalize the registered alias list of §3.7 only;
   nothing that changes meaning under the null rule.
5. **Null semantics: Quarry's total equality in the lowered program**,
   spelled `is null` / `is not distinct from`, with bare `=`/`<>`/`in` over
   a nullable operand refused. Grok's argument decided it: guard insertion
   is not three-valued logic, true SQL semantics is an engine change this
   bet forbids, and the pinned programs mean total equality. Astra and Opus
   preferred SQL's semantics with a compositional specification; that
   remains the alternative if the author wants the reader's prior to win
   here at the cost of an engine change.
6. **The viewer:** `auth.uid()`, typed `snapback.principal` (text);
   `uuid` principals refused with that rewrite.
7. **Pre-tests:** pre-test 1 first, after step 3's verification, before
   any card or lane; pre-test 2 after the SQL card is frozen.
8. **New, for the author:** the bounded stop. Three rounds of blind review
   have moved this document from a sketch to a contract; the round-3
   verdicts are in §12. The lead's recommendation: whatever they say, run
   §9 steps 2–4 (the additions land anyway; the verification and pre-test 1
   cost about two days and no Snapback 5 code) and decide on the compiler
   with pre-test 1's numbers in hand.

## 12. Review record

### Round 1 (revision 1, `8a2637efa5`)

Three blind design reviews, all NOT READY. Dispositions in revision 2,
re-assessed by round 2 below.

### Round 2 (revision 2, `9bc2ea9c83`)

Three blind delta reviews, all NOT READY, all saying the experiment is the
right one and nothing needs a redesign; Grok ran the form table against a
Postgres 17 and Opus against a scratch cluster. They converged on:

| Round-2 finding | Disposition in revision 3 |
| --- | --- |
| Typmods on domains, `snapback.` reloptions, `alter publication … with`, an access method: not Postgres, cannot be stubbed (Grok B, Opus 10, Astra) | §3: every such fact is a `select snapback.…(…)` call or a check; §3.7 A says "executes only with the stub schema"; verification transcript required (§9 step 3) |
| `grant update (cols)` is not immutability; "no grant means nothing may" breaks the target (all three) | `snapback.immutable(…)`; binds every writer; `written_by` exempt |
| No reference-column row; three rows depend on it; `%type` erases the table (all three) | §3.1 rows for references, `principal`, bare `id`, the scalar mapping; `%type` as a Snapback rule carrying bounds and formats |
| `update <- E` canonical spelling admits no update in Postgres; the update-rule combination unstated; the transition trigger's string form is not Muse's and ORs into a bypass (Opus 2–3, Grok, Astra) | §3.3: the combination formula; `using (E) with check (E)` canonicalization; `with check` alone refused; the ordinary `returns trigger` form; transitions do not bind jobs |
| Policy grammar lacks `is null` and extra-column probe equalities; `to service_role` loses the service; recursion; `enable row level security` and owner bypass (all three) | §3.3 grammar; `auth.uid() = 'service:x'`; B rows |
| `home` reads the Global source; one shape over two sources; `post_card` ill-typed; `insights` json and off-by-one; `trending` endpoint; `once` array types; presence `;`; job `declare p record`; `call daily(period_start …)` fails under pg_cron (all three) | §3.4–3.6 corrected; shapes as functions over a row type; `a..b-1`; composites not json; `row(…)` keys; `snapback.period_start()` |
| The conditional update cannot yield both `NOT_FOUND` and `E_CONFLICT` without a pre-read; `if absent` misstated; general `do update` too broad (Grok, Opus, Astra) | §3.6: the engine's pre-read stated; targetless `on conflict do nothing`; `excluded`-only upsert |
| `exists` missing from the expression subset; `case`/`coalesce`/`least`/`greatest`/`substr`/intervals/list arguments/helpers/`: server`/multi-file/online-only maintains from #19 have no rows (all three) | §3.5–3.7: rows and the expression subset; #19's forms covered or marked ✗ |
| Null semantics by guard insertion is not three-valued logic and breaks the gate (Grok, Astra, Opus) | §11 ruling: total equality, spelled with the null tests; bare `=` on nullables refused |
| The document printer does not exist; the gate trusts it on both sides; resolver and two-level parsing missing (all three) | §4: the printer as lane (a)'s exit with a round-trip test; the gate on bound IR of the original `.q`; the resolver; two-level parsing; collisions refused |
| §6.2 is not a relief valve (Opus 6, Grok) | §3.5 row withdrawn; unlowerable reads refused |
| Pre-test 1's idiom clause cannot fire; the rate is classification-decided; server-only empties the bucket; units (all three) | §7: manifest by hash; classes per kind; body statements counted; per-instance idiom stops; no server-only class; the third-family classifier |
| Pre-test 2 asymmetric, premature, one answer decides (all three) | §7: both cards frozen by hash; one rubric; margins of 10 points and 3/15; the task must include the edit window and the mark |
| §8: equality passes the mechanism; all-zero undefined; floors regress LLP 4000; N = 3 power; masking leaks; scorer prior (all three) | §8 rebuilt: strictly lower summed SURFACE; all-zero fails (A); LLP 4000's floor design; P(met) stated and "not shown at N = 3"; placeholder masking with a blindness check; a second masked scorer on the primary |
| §9's order puts prerequisites after consumers (Astra, Opus) | §9 reordered: 3000.015 first; instruments before lanes; pre-test 2's programs lowered in step 6 |
| Residency default differs for maintained views (Astra) | `snapback.online_only('view')` row |
| The SQL arm still reads Quarry; generated `.q` in the tree (Opus 17) | §2 and §4: listed under SURFACE; build directory only |
| LLP 4000 §13's first sentence; #19's full quotes (Opus 18, Grok) | §1 and LLP 4000 §13 corrected |

### Round 3 (revision 3)

Pending. Recorded here when the three reviews return; the document then
goes to the author regardless of verdict.

## Non-claims

This RFC does not claim SQL removes completeness classes, device admission,
the mutation subset, or `now()` on the device. It does not change the
engine, the grader, the brief or the protocol. It does not predict the
outcome beyond the registered directional prediction of §8, and records the
counter-expectation beside it. It stops at §9 step 4 if either pre-test's
stop rule fires, and at step 1 if the author says so.
