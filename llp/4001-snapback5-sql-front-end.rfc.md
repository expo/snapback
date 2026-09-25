# LLP 4001: Snapback 5, second bet — the same engine under a language builders already know

**Type:** RFC
**Status:** Draft
**Role:** Root of the Snapback 5 corpus's second bet (LLP 4000, the first, is Shelved)
**Systems:** A SQL front-end for the Snapback 4 engine: a Postgres-dialect parser lowering to the Quarry IR; policies as rules; views and materialized views as planned and maintained reads; SQL functions as queries; a plpgsql subset as mutations; the guide; the calibration protocol
**Author:** Claude Fable 5.1, at Charlie Cheever's request ("let's try it", 2026-09-25)
**Date:** 2026-09-25
**Revised:** 2026-09-25 (initial)
**Related:** [LLP 4000](./4000-snapback5.rfc.md) (the first bet, Shelved; its §4–§5 remain the runtime design of record and its §9 instruments are reused here), [LLP 3000.015](./3000.015-shared-baseline-for-snapback5.spec.md) (the additions landing in Snapback 4 that both arms carry), [LLP 3000.013](./3000.013-quarry-states-intent.rfc.md) (the planner and `view`, which the front-end lowers to), [LLP 3000.007](./3000.007-relaxed-quarry-and-explicit-residency.rfc.md) §5 (the language re-derived: the semantics the SQL forms must reach), [LLP 3000.012](./3000.012-application-still-owns-derived-data.research.md) (the charge ledger), [LLP 0329](./0329-agent-native-rebuild-diagnosis.research.md) (why Snapback 1's TypeScript handlers were replaced by an analyzable language), the [September 5 three-backend run](../benchmarks/runs/2026-09-05-clique-full-3x3/README.md)

## Summary

The first Snapback 5 bet removed the residency spelling from Quarry and was
shelved after nine blind reviews showed it targeted the smallest thing the
learning-cost record names (LLP 4000 §13). This bet targets the largest.
Across sixteen ledgered `data_modeling` notes the learning-cost phrases name
bounds 11 times, **the language itself 8 times**, completeness 5, residency
2 or 3 (LLP 4000 §1). The only authoring surface this grader has ever put at
94 in `data_modeling` is SQL: Supabase, for "relational keys, constraints,
joins and recipient ledgers directly expressed the product … SQL familiarity
and composability." Snapback 4's own categories at 96 and 97 are the ones
where the declaration matched a prior the builder already had.

Snapback 5, second bet: **keep every mechanism of the Snapback 4 engine and
replace the authoring surface with SQL forms a Postgres or Supabase builder
already knows.** Tables in DDL. Rules as policies in the row-level-security
shape. Views as views; engine-maintained aggregates as materialized views.
Queries as SQL functions. Mutations as a plpgsql subset. Schedules in the
`cron.schedule` form. The front-end is a parser and a lowering into the
Quarry IR the binder already produces; the engine, the partition log,
prediction, the meter, the planner, `complete` and `pending`, and the
diagnostics are untouched. The device receives IR, so the parser never
enters the wasm budget.

The experiment is clean in a way LLP 4000's was not: the treatment is purely
the language, the control is Quarry on the identical engine build carrying
the same LLP 3000.015 additions, and the same Clique program is pinned in
both spellings. What SQL cannot remove is stated up front: completeness
classes stay (a server-authoritative replica cannot certify a page it cannot
prove without disclosing hidden rows), the three device-admissible policy
shapes stay, and mutation bodies must be analyzable for prediction, which is
why they are a subset and not arbitrary plpgsql. The bet is that these
survive better in a frame the builder already holds ("the policy decides
visibility"; "RPC functions are restricted") than in a new language.

This is a proposal for the author's decision after blind review. Nothing
here is built.

## 1. Evidence

| Observation | Source | What it supports |
| --- | --- | --- |
| Learning-cost phrases across 16 `data_modeling` notes: bounds 11, the language itself 8 ("unfamiliar language", "language-learning costs", "Quarry adds learning cost", "restrictive rule expressions", "less flexible than … SQL", "fewer language escape routes", "restricted joins/scans", "constrained expressiveness"), completeness 5, residency 2–3, prediction 1 | LLP 3000.012 §2.2, counted in the LLP 4000 Opus round-1 review | The language is the second-largest named item, and the bounds phrases mostly describe execution-model learning that LLP 3000.013's planner has since removed from the authored surface |
| #19's own comparison note: "Compared with familiar TypeScript or SQL authoring, Quarry introduced learning cost" | #19 FINAL | The grader names the alternative it holds as the prior |
| Same builder family, same brief: Supabase 94, Convex 88, Snapback 2 68 in `data_modeling`; Supabase credited with familiarity and composability | LLP 3000.012 §2.1, the 2026-09-05 record | 94 is reachable with this grader, and SQL is the surface that reached it |
| Snapback 4's categories at 94–97 rest on declarations that match a builder's prior (`image <=N once`, read rules, client-minted ids, `expire at`) | LLP 3000.012 §2.1 | Familiar shape, not fewer concepts, is what scores at the ceiling |
| Two capability waves (0.3.0, 0.4.0) and one subtractive wave moved `data_modeling` 87 → 90, inside noise; the charge kept naming whatever Quarry still asked the author to learn | LLP 3000.013; calibration #19 | Adding or removing Quarry forms has not moved the category; the frame itself is the candidate |
| Snapback 1's TypeScript handlers were replaced by an analyzable language because capabilities depended on authoring form and the compiler could not see the program | LLP 0329 | Mutations must stay analyzable: a subset, lowered to IR, not arbitrary code |
| On the 2026-09-24 reference lanes (Astra medium, same host, parallel), Snapback 4 0.4.0 reached M8 first green in 68 min and its last passing evidence at 128 min; Convex 64 / 152; Supabase 134 / 364 (hosted-auth throttling). Tokens: Snapback 4 42.0 M in / 163 k out; Convex 46.5 M / 210 k; Supabase 90.0 M / 356 k | `~/clique-ref-20260924` | The clock and correctness goals are already met by the engine; the unmet goal is the authoring score |
| The engine has no SQL parser; the `sql` verb hands text to SQLite for read-only inspection | `snapback4/crates/snapback4/src/verbs/sql.rs` | The front-end is new compiler work; the `sqlparser` crate (Postgres dialect) is the obvious parser, running in the CLI only |

What the evidence does not show: that a builder meets *no* tax on a SQL
surface that refuses some SQL. The "restricted joins/scans" phrases could
return in a new spelling. §8 measures exactly that.

## 2. The bet on one page

**The runtime is Snapback 4's**, as LLP 4000 §4–§5 record it after nine
reviews: one partition log, audiences from inverted read rules, `complete`
as a class plus a runtime fact, `pending` on rows and in the outbox,
prediction by Snapback 4's own predictor, the meter, the planner of LLP
3000.013, the leave policy, `online only`, the disclosure notes. Nothing in
`snapback4-core` or `snapback4-device` changes for this bet.

**The authoring surface is SQL.** A program is a `.sql` file (or several)
in a Postgres dialect. `snapback5 check` parses it with a Postgres-dialect
parser, lowers it to the same IR `snapback4 check` produces from Quarry,
binds and plans it with the same binder and planner, and emits the same
`api.ts` and the same diagnostics, re-spelled in SQL terms with SQL
rewrites. A builder who knows Postgres reads and writes the whole backend
without learning a language; what they learn is which SQL the engine admits
on devices and in mutations, told in the vocabulary they already use for
row-level security and RPC functions.

**The treatment is the language and nothing else.** The control is Quarry
on the same engine build. Both arms carry LLP 3000.015's additions (`written
by` becomes a column option; `sequence by` becomes a column type; the
row-keyed maintained view becomes a materialized view). The same Clique
program is pinned in both spellings, written by one session and committed by
hash, so the comparison is between two spellings of one program.

## 3. The surface

The Clique messaging half, as the bet would have a builder write it. Every
form below is standard Postgres syntax except the ones §3.7 lists as
Snapback clauses.

```sql
-- Tables: standard DDL.
create table conversations (
  id           snapback_id primary key,
  kind         text not null check (kind in ('dm', 'group')),
  latest       int generated always as (max(messages.ordinal) over conversation) -- §3.7: a maintained column
);

create table members (
  id              snapback_id primary key,
  conversation_id snapback_id not null references conversations (id),
  principal       snapback_principal not null,
  role            text not null default 'member' check (role in ('member', 'admin')),
  joined_at       snapback_sequence (conversation_id),          -- engine-assigned; LLP 3000.015 §2
  read_up_to      int not null default 0 written by principal,  -- §3.7: field-level write authority
  unique (conversation_id, principal),
  constraint at_most_50 check (snapback_cap(50, conversation_id))
) with (snapback_keep_history = true);

create table messages (
  id              snapback_id primary key,
  conversation_id snapback_id not null references conversations (id),
  sender_id       snapback_principal not null,
  ordinal         snapback_sequence (conversation_id),
  body            text not null check (length(body) <= 2000),
  photo           snapback_image (10000000),
  at              timestamptz not null default now(),
  tombstone       boolean not null default false,
  expires_at      timestamptz
) with (snapback_keep_history = true, snapback_expire_at = 'expires_at', snapback_search = 'body');

-- Rules: policies in the RLS shape. `current_principal()` is the viewer.
create policy members_read   on members  for select using (exists (select 1 from members m where m.conversation_id = members.conversation_id and m.principal = current_principal()));
create policy members_insert on members  for insert with check (
  snapback_created(conversations, conversation_id)
  or exists (select 1 from members m where m.conversation_id = members.conversation_id and m.principal = current_principal() and m.role = 'admin'));
create policy members_update on members  for update
  using (exists (select 1 from members m where m.conversation_id = members.conversation_id and m.principal = current_principal() and m.role = 'admin'))
  with check (read_up_to = old.read_up_to);           -- the mark is not an admin's to write
create policy messages_read   on messages for select using (snapback_readable(conversations, conversation_id));  -- LLP 3000.014 `through`
create policy messages_insert on messages for insert with check (sender_id = current_principal() and snapback_readable(conversations, conversation_id));
create policy messages_edit   on messages for update using (sender_id = current_principal() and now() - at <= interval '15 minutes');

-- Views: a plain view is planned at read time; a materialized view is engine-maintained.
create materialized view unread as
  select m.id as member_id, count(*) as unread
  from members m join messages x on x.conversation_id = m.conversation_id
  where x.ordinal > m.read_up_to and x.sender_id <> m.principal and not x.tombstone
  group by m.id;                                       -- LLP 3000.015 §3, in SQL

create view history_card as
  select x.*, p as sender, (select count(*) from reactions r where r.message_id = x.id) as reactions
  from messages x join profiles p on p.principal = x.sender_id;

-- Queries: SQL functions. A `snapback_cursor` argument makes the function a page.
create function history(conversation snapback_id, c snapback_cursor default null)
  returns setof history_card language sql stable as $$
  select * from history_card where conversation_id = conversation order by ordinal desc limit 50
$$;

-- Mutations: a plpgsql subset (§3.5). `raise exception` with a code is `require … else`.
create function send(message_id snapback_id, conversation snapback_id, body text)
  returns messages language plpgsql volatile as $$
declare m messages;
begin
  if length(body) = 0 then raise exception 'EMPTY_BODY'; end if;
  insert into messages (id, conversation_id, sender_id, body) values (message_id, conversation, current_principal(), body)
    on conflict (id) do nothing returning * into m;
  for p in select principal from members where conversation_id = conversation and principal <> current_principal() loop
    if not snapback_connected(p.principal) then
      perform snapback_emit('push', json_build_object('to', p.principal, 'message', message_id), once => message_id || ':' || p.principal);
    end if;
  end loop;
  return m;
end $$;

-- Work: a job is a function; a schedule is the pg_cron form.
select cron.schedule('daily-digest', '0 8 * * *', $$ select daily(now() - interval '1 day', now()) $$);
```

### 3.1 Tables

Standard `create table` with column types, `not null`, `default`,
`references`, `primary key`, `unique`, `check`, and `create index`. Types
map onto the engine's: `text`, `int`/`bigint`, `boolean`, `timestamptz`
(the engine's `time`), `jsonb` (the engine's structured values), and the
Snapback domain types of §3.7. `check (length(body) <= 2000)` is `text
<=2000`; `check (kind in (…))` is an enum. `immutable` columns are a
`check` on update (`old.col = col`) or, more naturally, the absence of an
update policy admitting the column; the lowering marks a column immutable
when no update policy can change it and says so in `check`.

### 3.2 Policies

`create policy <name> on <table> for select | insert | update | delete
using (<expr>) [with check (<expr>)]`, exactly the row-level-security form.
`using` is evaluated on the existing row (`old`), `with check` on the
proposed row (`new`), which is Quarry's `update (old, next)` in Postgres's
own words. `current_principal()` is `viewer`. `snapback_created(t, col)` is
`created t[.col]`; `snapback_readable(t, col)` is `through .col` (LLP
3000.014), a policy-only function. Several policies on one table for one
command combine with `or`, as Postgres combines permissive policies; a
`restrictive` policy combines with `and`.

**Device admission** is unchanged and printed in SQL words: a table's rows
can be held on devices when its `select` policy is one of the three
invertible shapes — `using (true)` (public), `using (col =
current_principal())`, or `using (exists (select 1 from t where t.k =
table.k and t.principal = current_principal()))` (one membership probe) —
or a `snapback_readable` of a table that is. Any other `select` policy is
admitted for online reads and printed as "server only" with the rewrite
naming the nearest admissible shape. This is LLP 3000.007's rule in the
frame RLS builders already hold: the policy decides visibility, and some
policies cannot be evaluated on a device.

### 3.3 Views

`create view` is a read planned at read time (LLP 3000.013's planned
`view`): filters, projections, joins to a single row by key, unions.
`create materialized view` is an engine-maintained aggregate: `count`,
`sum`, `min`, `max` with `group by`, maintained in the writing transaction
as LLP 3000.007.001 and 3000.015 §3 define, including the row-keyed form
(a `group by` on another table's row through a single join on the key).
The Following feed is `create materialized view following as select …
where actor = current_principal() or exists (select 1 from follows …)`,
admitted under LLP 3000.013 §4's rule (sources readable by everyone,
owner-only writes, immutable mapped columns) and materialized per reader.
A materialized view whose shape the engine cannot maintain refuses with the
existing diagnostic, re-spelled: "this materialized view would need a
rebuild on every write; make it a view, or group by a key."

Shapes (nested rows) are subselects returning a row or a count, as in
`history_card`; the lowering recognizes a per-row subselect keyed on the
outer row as a shape field. Builders who prefer JSON can write
`json_build_object`, which lowers to the same shape.

### 3.4 Queries

A `create function … returns setof <view or table> language sql stable`
whose body is one `select` with `where`, `order by`, `limit` and an optional
`snapback_cursor` argument is a query. The planner chooses every index (LLP
3000.013); `limit N` with `order by` is `first`/`last N by`; the cursor
argument makes the function a page with `next`. `snapback_words(body, q)`
is `matching`. Aggregate reads without a materialized view stream as LLP
3000.013 §5 streams them. A function body the lowering cannot plan refuses
with the completeness class in its message, as today.

### 3.5 Mutations

A `create function … language plpgsql volatile` whose body uses only:
`declare` of row and scalar variables; `if … then … end if`; `for r in
select … loop … end loop` over a planned read; `insert … [on conflict (key)
do nothing | do update set …] returning … into`; `update … set … where`;
`delete … where`; `perform snapback_emit(effect, payload, once => key)`;
`raise exception '<CODE>' [using message = …]`; `return`. Everything else
(`execute`, cursors, exception blocks, loops without a planned domain,
`select` into arbitrary expressions) refuses with `E_SQL_UNSUPPORTED` and a
rewrite naming the admitted form. This is the RPC-function subset Supabase
builders already write, and it lowers one-to-one onto Quarry's mutation
statements, so prediction, the meter and `why` are unchanged.

### 3.6 Work

A job is a plpgsql function whose loops are the self-chunking sweeps of
LLP 3000.013 §5; `for r in select … loop` over a table is a sweep.
Schedules are `cron.schedule(name, '<cron expr>', $$ select fn(args) $$)`,
the pg_cron form; `every 1d at 08:00` is `'0 8 * * *'`. Effects are
declared with `create type push as (…)` and emitted with `snapback_emit`;
`once => key` is `emit … once [key]`.

### 3.7 The Snapback clauses (what is not standard Postgres)

The list is kept short and every item reads as Postgres syntax:

| Clause | Meaning | Quarry form |
| --- | --- | --- |
| `snapback_id`, `snapback_principal`, `snapback_cursor` | domain types for ids, principals, cursors | `id`, `principal`, `cursor` |
| `snapback_image (N)`, `snapback_video (N)`, `… once` | media columns with a byte bound and view-once | `image <=N`, `video <=N`, `once` |
| `snapback_sequence (parent_col)` | engine-assigned per-parent sequence | `sequence by` (LLP 3000.015 §2) |
| `written by <col>` column option | field-level write authority | `written by` (LLP 3000.015 §1) |
| `with (snapback_keep_history = true)` | the leave policy | `keep history` |
| `with (snapback_expire_at = '<col>')` | expiry | `expire at .col` |
| `with (snapback_search = '<col>')` | the search index | `search col` |
| `with (snapback_online_only = true)` | never on a device | `online only` |
| `check (snapback_cap(N, col))` | a product cap | `at most N by col` |
| `current_principal()`, `snapback_created(t, col)`, `snapback_readable(t, col)`, `snapback_connected(p)`, `snapback_words(col, q)`, `snapback_emit(…)` | the rule and program builtins | `viewer`, `created`, `through`, `connected`, `matching`, `emit` |

Everything else a builder writes is Postgres. A file that uses only the
standard subset and no Snapback clause is a valid Postgres schema, which is
the property that makes the frame familiar.

## 4. What the front-end is

- **Parser:** the `sqlparser` crate in its Postgres dialect, in the CLI
  crate only. The device receives IR; the parser is never in the wasm.
- **Lowering:** SQL AST → the Quarry IR of `snapback4-core/src/ir.rs`
  (`Program`, `Stmt`, `Expr`, `Read`, `Scan`, `Merge`) and the schema IR,
  then the existing binder, planner, diagnostics and `api.ts` emitter. The
  lowering is a new crate, `snapback5-sql`, beside `snapback4-lang`; it
  reuses the binder rather than the Quarry parser.
- **Diagnostics:** every existing `E_*`/`N_*` code keeps its meaning; the
  message and the rewrite are re-spelled in SQL, and the rewrite is valid
  SQL the builder can paste. `E_SQL_UNSUPPORTED` is the one new code, with
  a rewrite naming the nearest admitted form. `explain_code` covers all.
- **`check`:** the same output as Snapback 4's (errors, completeness class
  per function, disclosure notes, device admission per table, `--scale`),
  in SQL terms.
- **The guide:** the same cards, with every example in SQL, and one card
  that lists §3.7 and §3.5's subset. The first account stays within W14b's
  300-line budget.
- **The client:** unchanged. `api.ts` is generated from the functions'
  signatures and return types; `createApp`, `useQuery`, the read and write
  results, the outbox and `why` are Snapback 4's.

## 5. What stays hard, said in SQL

- **Completeness classes.** A `select` whose policy the scan cannot decide
  uniformly reads `complete: false` on the server whatever it finds (LLP
  3000 §7). In SQL words: "the policy on `messages` reads `conversation_id`,
  which this function's `where` does not pin, so the page cannot be proven
  complete without revealing hidden rows; pin it, or accept `complete:
  false`." The note is the same; the frame is one RLS builders know.
- **Device admission** (§3.2): three policy shapes. A builder who writes a
  join-shaped policy is told it is server-only, with the membership-probe
  rewrite.
- **Mutation bodies** (§3.5): a subset. A builder who reaches for `execute`
  or an exception block is refused with the admitted form.
- **`now()` in a prediction:** never proven on the device (LLP 4000 §4.5);
  `send` predicts through the effects-only presence exception, `edit` does
  not, and `why edit` says so.

These are the same four places Quarry charges the builder. The bet is that
they cost less when the surrounding 90% of the program is the builder's own
language.

## 6. Relationship to Snapback 4 and to LLP 4000

- **Engine unchanged.** No feature flags, no hooks, no fence around
  delivery. `snapback5/` holds the front-end crate, the CLI (`snapback5`
  wraps `snapback4`'s verbs with the SQL parser in front), the guide, and
  the pinned SQL Clique program. The wasm budget is untouched because the
  device is untouched.
- **Both arms carry LLP 3000.015.** `written by`, `sequence by` and the
  row-keyed maintained view are Snapback 4 additions (lanes B1–B3 in review
  as this is written); the SQL forms in §3 are their spellings.
- **LLP 4000's §4–§5** remain the runtime design of record; its §8 hooks
  are not needed; its §9 instruments are reused in §8 here with the
  language as the treatment; its §13 records the shelving.
- **Sibling, not successor.** Snapback 4 continues as the control and as
  the product. If the bet fails, `snapback5-sql` is a number that never
  ships and Quarry stays the language.

## 7. The Clique program in both spellings

Before any compiler work, one session writes the committed 0.4.1 Clique
target (`snapback4/crates/snapback4-sim/tests/fixtures/intent-clique.q`,
plus the LLP 3000.015 additions) in the SQL of §3, line for line, and
commits both spellings by hash under `snapback5/programs/`. Three model
families then judge the SQL spelling blind on one question: *does this read
as SQL you already know, and where does it not?* That is a one-day pre-test
of the bet's premise, costs no compiler work, and its answer (the count of
"where it does not" items) is recorded here before the front-end is built.
If the families find the Snapback clauses of §3.7 or the subset of §3.5
foreign, the bet is revised or stopped at that point.

## 8. Evaluation, pre-registered

The instruments are LLP 4000 §9.3–9.5, with these substitutions:

- **Treatment:** the SQL front-end. **Control:** Quarry on the same engine
  build (pre-release packages of both, from one commit, published under
  `snapback5` and `snapback4`). Both arms carry LLP 3000.015.
- **The program:** the pinned Clique program of §7, in both spellings,
  supplied to no lane; each builder writes its own, as the brief requires.
- **Reading (A), the language:** in the treatment arm's learning-cost
  phrases, the items expected to disappear are the LANGUAGE class of LLP
  4000's rubric (Quarry itself, its syntax, rule expressions, "the
  compiler's distinctions", spreads, shapes, views as a language); the
  items expected to stay in both arms are completeness, prediction, bounds.
  A new class, SQL-SUBSET (refusals of SQL the engine does not admit, the
  Snapback clauses, the plpgsql subset), is expected to appear in the
  treatment and is counted. Reading (A) holds when the treatment's LANGUAGE
  count is zero in every paired run and its total learning-cost count is
  at or below the control's; SQL-SUBSET items are reported and, if they
  exceed the control's LANGUAGE count, reading (A) is recorded as "the
  charge moved to the subset".
- **The clock, correctness, delivery and floors:** as LLP 4000 §9.3, with
  the delivery load dropped (the engine is unchanged) and the cold-start
  measurement dropped for the same reason. The correctness gate, the
  110-assertion list, native artifacts, the holdout probes inside the
  published categories, the calibrated grader, the third-family classifier
  with a rubric by hash, serial interleaved runs at N = 3 under the written
  25-minute rule, and "not distinguished never ships" all stand.
- **The verdict:** the named bet passes on a clock win or a clock
  not-distinguished **plus** correctness and floors passing **plus**
  reading (A). Unlike LLP 4000, a not-distinguished clock does not fail
  this bet: the language is not expected to change the clock, and the
  author's ruling put the clock first only relative to the incumbents,
  which the engine already beats. `data_modeling` is reported; 94 is the
  hope, not the bar.

## 9. Order of work

1. Blind design reviews of this RFC from three families; revision until
   READY or a bounded stop of three rounds.
2. The pre-test of §7: the Clique program in SQL, judged blind by three
   families. Recorded here. Stop or revise if the premise fails.
3. The front-end, in lanes: (a) parser and schema lowering (tables, types,
   §3.7 clauses, policies → rules, admission printed); (b) views and
   materialized views → planned and maintained reads; (c) functions →
   queries and the plpgsql subset → mutations, jobs and schedules; (d)
   diagnostics re-spelled with SQL rewrites and `explain_code`; (e) the
   guide in SQL and the first account; (f) the `snapback5` CLI and
   pre-release publication. Each lane: tests, two blind reviews, landed
   under `snapback5/`.
4. The pinned programs, the holdout probes, the rubric and the classifier
   committed by hash.
5. The comparison of §8.

## 10. Risks, and what falsifies the bet

- **The charge moves to the subset.** A builder who writes SQL the engine
  refuses may report "restricted joins" in a new spelling. Reading (A)'s
  SQL-SUBSET class measures it; the §7 pre-test catches the worst of it
  before compiler work. Falsified when SQL-SUBSET items exceed the
  control's LANGUAGE items.
- **Composite shapes are awkward in SQL.** Per-row subselects and
  `json_build_object` are heavier than Quarry's `shape`. The pre-test's
  "where it does not read as SQL" list will say whether this is charged.
- **The grader's prior cuts both ways.** A surface that looks like Postgres
  but refuses Postgres may be judged more harshly than a language with no
  prior. The pre-test is the early signal; the comparison is the answer.
- **Two spellings of the same fact.** The §3.7 clauses are the part a
  Postgres reader must learn; the list is deliberately short and every item
  parses as Postgres syntax.
- **Parser and lowering size.** `sqlparser` is a large dependency, in the
  CLI only; the device is untouched. The lowering must reach every form the
  Clique program uses before the comparison, which §9's lanes sequence.
- **Mutations stay a subset**, by LLP 0329's lesson; if builders find the
  subset foreign, the bet has found the limit of "familiar", and the record
  says where.

## 11. Questions for the author

1. Postgres dialect only, or also the SQLite flavor? (Recommendation:
   Postgres, because that is the prior the grader and Supabase builders
   hold.)
2. Should the §7 pre-test gate the compiler work (recommended: yes; it is a
   day and it tests the premise), or run in parallel?
3. Is the `snapback5` CLI a separate package, or a `--sql` mode of
   `snapback4`? (Recommendation: a separate package for the comparison,
   because protocol rule 6 pins published packages per arm; a mode later if
   the bet passes.)

## Non-claims

This RFC does not claim SQL removes completeness classes, device
admission, the mutation subset, or `now()` on the device; §5 says they
stay. It does not change the engine, the grader, the brief or the protocol.
It does not claim a score; it registers the language as the treatment and
the LANGUAGE class as the item expected to disappear, and it stops if the
pre-test says the frame is not familiar after all.
