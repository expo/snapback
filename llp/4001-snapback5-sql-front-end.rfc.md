# LLP 4001: Snapback 5, second bet — the same engine under a language builders already know

**Type:** RFC
**Status:** Draft
**Role:** Root of the Snapback 5 corpus's second bet (LLP 4000, the first, is Shelved)
**Systems:** A SQL front-end for the Snapback 4 engine: Postgres's own parser, a resolver, a lowering to the Quarry declaration AST, a document printer, and the unchanged `snapback4` binary; policies as rules; a residency spelling; views and maintained aggregates; SQL and plpgsql subsets as queries, mutations and jobs; the guide; the pre-tests and the calibration protocol
**Author:** Claude Fable 5.1, at Charlie Cheever's request ("let's try it", 2026-09-25)
**Date:** 2026-09-25
**Revised:** 2026-09-25 (step 3 shared-baseline recheck at `da443e4d44`: all nine lowered projects bind, including field authority with both visibility forms, sequence and row-keyed count; their three rows return from ✗ to ≈ without spelling changes; pre-test 1 authorized from this commit)
**Revised:** 2026-09-25 (six-lane reference record: five complete lanes, terminated Opus Supabase, timestamp-derived clocks, grades and holistic scores); 2026-09-25 (step 3 verification after revision 4: executable SQL calls and actual Quarry binding; effect WorkDecl spelling, boolean-rule lowering, bounded reads, argument locals and missing shared-baseline additions corrected or marked GAP; transcript under snapback5/reports); 2026-09-25 (revision 4, after the round-3 reviews: finite SQL spellings and routine classes, in-process equivalence, re-registered pre-tests, mechanism-not-shown and joint power; §12 records every disposition; verification follows separately); 2026-09-25 (revision 3, after the round-2 delta reviews, all NOT READY and all saying "close, nothing needs a redesign" — [Astra](./reviews/4001-snapback5-sql-front-end.astra.md), [Grok](./reviews/4001-snapback5-sql-front-end.grok.md), [Opus](./reviews/4001-snapback5-sql-front-end.opus.md): every Snapback fact that is not legal Postgres after the stubs respelled as a `select snapback.…(…)` call or a `comment on`; reference columns, the principal type and the scalar mapping given rows; the update-rule combination stated as one formula; the transition form made the ordinary `returns trigger` function; `immutable` as a call that binds every writer; the document printer, the resolver and two-level parsing named as lane work; the equivalence gate redefined on the bound IR of the original pinned `.q` with the unchanged tools as oracle; the null ruling decided; the pre-tests re-registered with a corpus manifest, per-kind classes, per-instance idiom stops and margins; §8's floors restored to LLP 4000's design with the all-zero case and the N = 3 power stated; #19's forms given rows or GAPs; §12 records round-2 dispositions; **this is the bounded stop: the document goes to the author with the round-3 verdicts**); 2026-09-25 (revision 2); 2026-09-25 (§11 ruling); 2026-09-25 (initial)
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

This is the small fourth revision authorized after the refine loop stopped.
The commission ends after §9 step 3's verification; pre-test 1 is a separate
step. No compiler or runtime is built by this revision.

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
| The engine has no SQL parser. `pg_query` (libpg_query) is Postgres's own parser with a plpgsql entry point that returns embedded SQL as strings. The binder consumes `Vec<ast::Document>` (`lib.rs`: `compile` → `parse_document` → `bind`) and emits the IR. `print.rs` prints expressions, reads, quoted strings and scalar types for diagnostics; **it does not print a document** | `snapback4/crates/snapback4-lang/src/{lib.rs,bind/mod.rs,print.rs}` | The pipeline is SQL → resolver → Quarry AST → a new document printer → the unchanged binary; the printer is lane work |
| Diagnostics are built at about 400 sites with pre-formatted Quarry messages and rewrites; `why`, `--residency`, `--cost` and runtime refusals print Quarry | `snapback4-lang/src/diag.rs` | Re-spelling every diagnostic is unbounded; tiering is required, and what the SQL arm still reads in Quarry counts as surface (§8) |
| The Supabase corpus on this host, excluding `attempt1/` and `m7/inherited/` duplicates: nine files, 1,729 lines, about 355 top-level statements (Astra 105, Grok 44, Muse 206), of which about 104 are `drop … if exists` and `enable row level security`, and 44 are `create [unique] index` | `~/clique-full-20260905/lanes/{astra,grok,muse}-supabase/` | Pre-test 1's manifest, and why its classes must be registered per statement kind |
| Postgres 17 is installed on the black M5 Max (`/opt/homebrew/opt/postgresql@17`) | this host | The form table can be verified against a real server with the stub schema before any pre-test |

The [2026-09-24 six-lane reference record](../benchmarks/runs/2026-09-24-clique-reference-lanes/README.md)
records evidence for the author's question, “is wall clock faster than Convex and
Supabase, and are the results very correct”: M8 first-green / harness-end minutes
from harness start, with grade pass/fail/not-run/not-applicable out of 119 and
holistic overall, are **Astra Snapback 4 67.91 / 128.05 (104/0/14/1; 87), Convex
64.08 / 153.22 (104/0/15/0; 78), Supabase 133.82 / 369.73 (101/0/18/0; 72)**;
**Opus Snapback 4 60.22 / 103.67 (100/1/18/0; 89), Convex 89.38 / 174.60
(101/0/18/0; 74)**. All five coverage audits are honest, with missing native proof
and differing native-assertion interpretations disclosed. Deviation 1 runs three
lanes per wave in parallel; deviation 2 terminates Opus Supabase before its final
report, leaving it incomplete, ungraded, unscored and not rerun. Compare clocks
within a wave only and backend ordering across waves; N=1 is reference evidence,
not a claim-eligible magnitude or a Snapback 5 result.

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
program's, so residency, plans, prediction facts and `why` are identical for that pinned pair. Independently authored lane programs
still need behavioral qualification. The control is Quarry on the same binary.

## 3. The surface: a normative form table

**Verification, before §7 runs:** every SQL spelling below is executed
against Postgres 17 with the stub schema (`snapback5/stubs/snapback.sql`:
the `snapback` and `auth` schemas' domains and IMMUTABLE stub functions, and
the `snapback` publication), and the lowered Quarry is bound by `snapback4
check` on the shared baseline commit. The transcript of that run is
committed with the table. Seed data and representative calls must execute every function and procedure
body, including both branches and expected refusals; use a non-owner role
for policy witnesses. Creating a plpgsql routine alone is not a pass. Rows
that fail either check are corrected or marked ✗ before any pre-test. LLP
3000.015 is present at `da443e4d44`; the 2026-09-25 recheck binds all nine
lowered projects, including its three previously provisional GAP rows,
without spelling changes. Those rows return from ✗ to ≈; the eight
predeclared GAPs remain. See the [step 3 transcript and dated recheck](../snapback5/reports/20260925-form-table-postgres17.md#2026-09-25--shared-baseline-recheck-at-da443e4d44). This
is spelling/binding verification, not execution of the proposed transpiler
or proof that the dummy SQL functions implement Snapback semantics.

Key: **✓** maps · **≈** maps with a stated difference · **✗** no spelling
(a GAP the pre-tests count) · **B** the row has an entry in §3.7 B.

### 3.1 Program, identity, types

| Quarry form | SQL spelling | Lowered Quarry | Difference |
| --- | --- | --- | --- |
| `use identity password` | `select snapback.identity('password');` | `use identity password` | a configuration call (**≈**, B) |
| `effect push` | `select snapback.effect('push');` or `select snapback.effect('push', attempts => 5, backoff => '30s', deadline => '1h');` | `effect push` or `effect push retry 5 backoff 30s deadline 1h` | bare call preserves defaults; configured call carries exactly its explicit work policy; a worker is registered through the unchanged engine, not loaded by this call (`from module` is legacy no-op Quarry metadata) (**≈**, B) |
| `viewer` | `auth.uid()`, returning the domain `snapback.principal` (text) | `viewer` | Supabase's name with Snapback's type: principals are text and include `'service:x'`; a `uuid` principal column is refused with the rewrite `snapback.principal` (**≈**, B) |
| `principal` column | `owner snapback.principal not null` | `owner: principal` | (**✓**) |
| `t` reference column, `t ?` | `post_id snapback.id not null references posts (id)`, `parent_id snapback.id references posts (id)` | `postId: posts`, `parentId: posts ?` | Snapback enforces neither existence nor deletion; `on delete`/`on update` clauses are refused (**≈**, B) |
| intrinsic table `id` | `id snapback.id primary key default snapback.mint()` | implicit `id` (no column declaration) | omitted insert ids are minted by the engine; the IMMUTABLE stub returns a fixed dummy solely for this verification (**≈**, B) |
| bare `id` column, `id` argument | `snapback.id` | `id` | client-minted; no default (**≈**, B) |
| `text`, `text <=N`, `text M..N`, `int`, `bool`, `time`, duration literals (`int`) | `text` (bare means `<=10000`), `text check (length(col) <= N)` / `between M and N`, `bigint` (53-bit), `boolean`, `timestamptz` (`default 'epoch'::timestamptz` for zero), fixed `interval` literals | the Quarry types | the domains and literal conversions are stated in B (**≈**, B) |
| `format handle`, `format url` | `check (col ~ snapback.format('handle'))` | `format handle` | a named format, not arbitrary regex (**≈**, B) |
| `enum('a','b')` | `create type role as enum ('a','b')` (canonical) or `check (col in ('a','b'))` | `enum(…)` | (**✓**) |
| `default now`, literals | `default now()`, literals | same | `default now()` predicts; `clock_timestamp()` refused (**✓**) |
| `image <=N`, `video <=N`, `once` | `photo snapback.image not null, constraint photo_bound check (snapback.bytes(photo) <= 10000000)`; `select snapback.once('messages', 'photo');` | `image <=N`, `once` | domains take no typmod; the bound is a check and view-once a call (**≈**, B) |

### 3.2 Tables

| Quarry form | SQL spelling | Lowered Quarry | Difference |
| --- | --- | --- | --- |
| `unique a, b` | `unique (a, b)` | same | (**✓**) |
| `unique handle else HANDLE_TAKEN 'That handle is taken.'` | `constraint handle_taken unique (handle); comment on constraint handle_taken on profiles is 'That handle is taken.';` | `unique handle else HANDLE_TAKEN '…'` | only a **commented** constraint becomes a client-visible code; a clash with a hidden row is `E_RULE`, never the code (**≈**, B) |
| `immutable a, b` | `select snapback.immutable('posts', 'author_id', 'parent_id', 'at');` | `immutable authorId, parentId, at` | binds every writer, jobs included; no call means Quarry's default (nothing immutable) (**≈**, B) |
| `search a, b` | `select snapback.search('profiles', 'display_name', 'handle');` | `search displayName, handle` | word-prefix search; `create index` is refused (**≈**, B) |
| `cap 50 by conversationId` | `constraint at_most_50 check (snapback.cap(50, conversation_id))` | `cap 50 by conversationId` | a cross-row check (**≈**, B) |
| `cap 1 by principal`, `cap 50 by chat, message` | `check (snapback.cap(1, principal))`, `check (snapback.cap(50, chat, message))` | same | cross-row extension, as above (**≈**, B) |
| `retain delivered-history` | `select snapback.retain('messages', 'delivered-history');` | same | (**≈**, B) |
| `expire at .expiresAt` | `select snapback.expire_at('messages', 'expires_at');` | same | (**≈**, B) |
| online-only table | no `snapback.publish` call | no line | Snapback 4's default (**✓**) |
| `sync public`, `sync to members[.conversationId]`, `sync to .principal`, `sync … last N by .k`, `by .principal` | `select snapback.publish('messages');` with `horizon => 'last 500 by at'`, `recipient => 'principal'` as named arguments (omit `recipient` to infer a membership audience and its viewer column, emitting `by .principal` when the membership table has multiple principal columns) | `sync` (audience inferred from the select policy), `sync last N by .k`, `by .principal` | a published table whose select policy is not one of the three invertible shapes refuses with `E_SYNC`; publication means residency, not Supabase Realtime; `recipient` accepts one principal column only and must agree with the read rule; `horizon` is exactly `last <positive integer> by <column>` (**≈**, B) |
| `likeCount: count likes`, `count posts by .parentId`, `sum likes of .weight`, `count … where …` | `like_count bigint generated always as (snapback.count('likes')) stored`; `snapback.count('posts', by => 'parent_id')`; `snapback.sum('likes', of => 'weight')`; `snapback.count('likes', by => 'post_id', "where" => 'selected')` | the maintained column | executes with an IMMUTABLE stub; exactly one contributor column must reference the owner, or it must be named by `by`; the filter string is parsed with the finite maintain-predicate grammar; expiring sources refuse as today (**≈**, B) |
| `public 'reason'` | `create policy … for select using (true); comment on policy … on t is 'reason';` | `public 'reason'` | `using (true)` lowers to `public` even without a comment (default reason `<table> is public`); a comment supplies the reason only when the composed read rule is public (**≈**) |
| LLP 3000.015 `written by .principal` (+ `readable by audience`) | `select snapback.written_by('members', 'read_up_to', by => 'principal');` and `, visible => true` for the opt-out | `written by .principal` | private to the owner by default; exempt from `snapback.immutable`; LLP 3000.015 §1's authority contract; SQL executes and both private and audience-visible lowerings bind at `da443e4d44` (**≈**, B) |
| LLP 3000.015 `sequence by conversationId` | `ordinal bigint generated always as (snapback.sequence(conversation_id)) stored` | `sequence by conversationId` | Postgres's own "system-assigned, cannot be supplied" meaning is `E_SEQUENCE_SUPPLIED`; one counter per parent row shared across tables; the parent must be a reference; predicted values are provisional, settlement replaces them and reorders pages, never publishing provisional order as settled; SQL executes and lowering binds at `da443e4d44` (**≈**, B) |
| `enable row level security` | required on every table with a policy | nothing | a policy on a table without it is refused; owners do not bypass (**≈**, B) |

### 3.3 Rules

**Grammar.** A policy expression is Quarry's rule grammar: `and`, `or`,
`not`, `=`, `<>`, `is [not] null`, `is [not] distinct from`, required boolean
columns (lowered explicitly as `column = true`; `not column` as `column != true`), `auth.uid()`, literals and full-key probes. A probe is
`exists (select 1 from t where <equalities covering one total unique key>
[and <residual equality>]*)`; each side of a residual may be any rule term
(column, focal `old`/`new` column, viewer or literal), not just a column
named `principal` and a literal. Null tests and null-safe equalities are
included in key and residual grammar. The resolver emits positional keys
where Following admission needs that exact edge-key order. Ordered
comparisons, arithmetic, `now()` and other functions are refused in rules:
move a write condition into a mutation's `raise exception`, or use
`snapback.expire_at` for read expiry. `snapback.created('chats', chat)` is
an insert-rule-only transaction-created key probe; it is not SQL existence.

Probes read without the target's policies. A `language sql stable security
definer` helper whose body is exactly an admitted probe is inlined; other
security-definer routines are refused. Muse's `is_member` with
`left_at is null` is admitted as a rule, but its residual prevents audience
inversion: publishing that table yields `E_SYNC`.

**Combination.** Write the update rule as one `update (old, next)` rule:
(⋁ permissive `using`)[old] ∧ (⋁ permissive `with check`, else `using`)[next]
∧ (⋀ restrictive `using`)[old] ∧ (⋀ restrictive `with check`, else
`using`)[next] ∧ (⋀ transition conditions). An empty disjunction is false;
an empty conjunction is true. `for all` expands per effect. Omitted clauses
follow Postgres's defaults before composition. Two permissive policies
combine per image, not as paired predicates.

A transition is a constraint, never a grant: its complete canonical bundle
includes `create policy update_base on t for update using (true) with check
(true)` beside the trigger (or narrower explicit permissive policies).
The only admitted trigger exception is `raise exception 'E_RULE'`: the
lowered rule sends **E_RULE**, not an arbitrary application code, to the
client on a readable denied target (hidden targets follow the write matrix
below). A custom `raise exception 'CODE'` belongs in a mutation, where it
lowers to `require … else CODE`; in a transition trigger it is refused with
that rewrite. Transition rules do not bind jobs; `snapback.immutable` does.

`written_by` is field authority, not a row UPDATE grant. Under LLP 3000.015
§1 an owner-only patch needs no permissive row policy; other patched fields
need the composed row rule. A separate transition still constrains an
owner-only patch. Thus the spec's illustrative `next.readUpTo = old.readUpTo`
transition freezes that mark even for its owner; it is not a monotonic-mark
recipe. There is no silent exemption or engine change here. This contract
and the actual shared baseline must agree before that row qualifies.

| Quarry form | SQL spelling | Lowered Quarry | Difference |
| --- | --- | --- | --- |
| `read <- expr` | `create policy p on t for select using (expr)` | `read <- expr` | probes do not recurse (**≈**, B) |
| `insert <- expr` | `for insert with check (expr)` | same | (**✓**) |
| `delete <- expr` | `for delete using (expr)` | same | an RLS-denied delete is `DELETE 0` in Postgres and `E_RULE` in Snapback (**≈**, B) |
| `update <- expr` (single image, tests the next row) | `for update using (expr) with check (expr)`, or `using (expr)` alone, where `expr` reads only immutable columns and `auth.uid()` | `update <- expr` | canonicalized: old and next agree when the columns read are immutable; `with check` alone is refused with this rewrite, because in Postgres it admits no row (**≈**, B) |
| `update (old, next) <- expr` | a `returns trigger` function whose body is exactly `if not (<cond over old/new>) then raise exception 'E_RULE'; end if; return new;` plus `create trigger … before update on t for each row execute function f()` **and** an explicit permissive UPDATE policy | `update (old, next) <- <composed policies> and cond` | the condition is the policy grammar over `old.`/`new.`; assignments to `new` are refused; the trigger does not bind jobs (**≈**, B) |
| several rules for one effect | several permissive policies; `as restrictive`; `for all` (four policies) | one rule per effect, combined as above | (**≈**, B) |
| `or viewer = 'service:x'` | `or auth.uid() = 'service:x'` in the policy | the service grant | `to service_role` is refused with this rewrite; `to authenticated` is ignored (**≈**) |
| `created chats[.chat]` / `created messages[.message]` | `create policy fresh on receipts for insert with check (snapback.created('messages', message));` | `insert <- created messages[.message]` | transaction-local creation, insert rules only (**≈**, B) |
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
on materialized views in Postgres, so residency opt-out is a call: `select snapback.online_only('follower_count');`.
Without it, a maintain inherits its source's sync audience when all audience
columns survive as bare keys, with the horizon dropped; otherwise it is
online-only. Its omitted read rule derives from the source: public/allow
becomes allow, otherwise every rule field must survive as a bare group key.
An explicit maintain read override has no admitted SQL spelling yet (✗ below).

| Quarry form | SQL spelling | Lowered Quarry | Difference |
| --- | --- | --- | --- |
| `view activity: posts where … { post: .id, actor: .authorId, at, repost: false }` + `reposts { … }` | `create view activity as select id, id as post, author_id as actor, at, false as repost from posts where parent_id is null and not removed union all select id, post_id, actor_id, at, true from reposts` | the union view | `union` (distinct) refused; branch identity kept for cursors (**≈**) |
| `view following: activity where .actor = viewer or exists follows[viewer, .actor]` | `create materialized view following as select * from activity where actor = auth.uid() or exists (select 1 from follows f where f.follower_id = auth.uid() and f.followed_id = activity.actor)` | the Following view | admitted only under LLP 3000.013 §3.3's admission rule (and §4's lifecycle): published public sources, owner-only writes, immutable mapped columns, the declared edge key; else `E_FEED` (**≈**, B) |
| `view followerCount: count follows by .followedId` | `create materialized view follower_count as select followed_id, count(*) as count from follows group by followed_id` | the count view | absent group 0; hidden group nothing (**≈**, B) |
| `view originalPosts: count posts where .parentId = null by .authorId` | `… select author_id, count(*) as count from posts where parent_id is null group by author_id` | the filtered count | `is null` spells Quarry's `= null` (§3.7 B) (**≈**) |
| `view receivedLikes: count likes by .postId.authorId` | `… select snapback.recorded(post_id, 'author_id') as author_id, count(*) as count from likes group by 1` | the recorded-attribution view | binds only when `post_id` is a reference, the hop is immutable and the target public; a missing target captures null (**≈**, B) |
| `view dailyLikes: count likes by .postId.authorId, day(.at)` | `… select snapback.recorded(post_id, 'author_id') as author_id, snapback.day(at) as day, count(*) as count from likes group by 1, 2` | same | `snapback.day` is the UTC millisecond day ordinal (**≈**, B) |
| LLP 3000.015 `view unread: count messages by members m where …` | `create materialized view unread as select m.id, count(x.id) as count from members m left join messages x on x.conversation_id = m.conversation_id and x.ordinal > m.read_up_to and x.sender_id <> m.principal and not x.tombstone group by m.id` | the row-keyed view | LLP 3000.015 §3's contract: the member row's read rule; the writer-side bound; `complete: false` and a background recount above it; SQL executes and lowering binds at `da443e4d44` (**≈**, B) |
| `view postTotals: … online only` | `select snapback.online_only('post_totals');` | `online only` on the maintain | (**≈**) |
| `shape postCard = { *, author: profiles[principal = .authorId], replyCount: replyCount[.id], liked: exists likes[.id, viewer] }`, applied to two sources | `create function post_card(p posts) returns post_card_t language sql stable as $$ select p.*, (select pr from profiles pr where pr.principal = p.author_id) as author, (select c.count from reply_count c where c.parent_id = p.id) as reply_count, exists (select 1 from likes l where l.post_id = p.id and l.principal = auth.uid()) as liked $$` | the named shape | a function over a row type, not a PostgREST whole-shape convention; composites redeclare and type-check every field; a scalar point read keeps hidden groups null; `activity_card(a activity)` accepts Following via explicit `row(f.id, f.post, f.actor, f.at, f.repost)::activity` (**≈**, B) |
| maintain residency without an override | no `snapback.online_only` call | inherited sync audience, no horizon | derivation stated above; table defaults do not apply (**≈**, B) |
| maintain `read <-` override | — | — | **✗**: no policy on a Postgres materialized view and no registered override call |
| nested point shapes and field replacement (`activityCard`, `messageCard`) | `select (select post_card(p) from posts p where p.id = a.post) as post, (select pr from profiles pr where pr.principal = a.actor) as actor, a.at, a.repost` (plus unchanged `id`) | `{ *, post: posts[.post] postCard, actor: profiles[principal = .actor] }` | an explicit list containing every unchanged base field exactly once, in base order, and replacements in their base slots canonicalizes to a wildcard plus replacements; duplicate output names refuse; declared result type is checked (**≈**, B) |
| spread `{ ...p, followers, following }` | `select (p).*, … ` over a bound record `p` | the spread | record expansion, not a scan (**≈**) |

### 3.5 Queries

**Routine kind, in precedence order:** procedure → job; a function in the
non-exposed `private` schema → helper (`fn`), including stable plpgsql
blocks with table reads; an immutable SQL scalar expression with no reads
or ambient values → pure helper; a stable SQL function with exactly one
row-typed argument and a composite result → shape; a public volatile
plpgsql function → mutation; otherwise a stable SQL/plpgsql function →
query. Unsupported combinations refuse. A helper's writes are admitted
only in a writing caller; volatility is never used to lie about table reads.
Composites are checked for exact field names, order, nullability and types.

A page ends `return query select … order by … limit N; return;`. Accumulating
`return query` is refused. No cursor argument means a first page; exactly
one cursor argument owns mutually exclusive terminal page returns (so
`people`'s two branches may share `c`). Multiple independent sibling pages
in an object have no SQL spelling in this revision (✗ below); no guessed
association of multiple unused cursors. A keyset predicate on a cursor is
refused. Reference arguments are `posts.id%type`, carrying the referenced
table by a Snapback rule (Postgres erases it); `default null` gives `posts ?`.
`%type` on other columns carries bounds/formats/media bounds. Bare-id lists
are `snapback.id[]`; their first body statement is `perform
snapback.bound(ids, 50)`. Reference-element lists remain a separate GAP.
Argument typmods are honored (`q varchar(100)` is `text <=100`).

| Quarry form | SQL spelling | Lowered Quarry | Difference |
| --- | --- | --- | --- |
| `query home(c: cursor ?): return following last 20 by .at after c activityCard` | `create function home(c snapback.cursor default null) returns setof activity_card_t language plpgsql stable as $$ begin return query select (activity_card(row(f.id, f.post, f.actor, f.at, f.repost)::activity)).* from following f order by f.at desc limit 20; return; end $$` | the page over `following` | (**✓**) |
| `query global(c)` | `return query select (activity_card(a)).* from activity a order by a.at desc limit 20; return;` | the page over `activity` | one shape, two sources (**✓**) |
| `query thread(postId: posts, c)` | `thread(post_id posts.id%type, c snapback.cursor default null)` with `where p.parent_id is not distinct from thread.post_id` and `select (post_card(p)).*` | `postId: posts` | `%type` is a Snapback reference rule (**≈**, B) |
| `query people(q: text <=100, c)` | `people(q varchar(100), c …)`; `if q = '' then return query select p.* from profiles p order by p.created_at desc limit 20; return; end if; return query select p.* from profiles p where snapback.matches(p, q) order by p.created_at desc limit 20; return;` | `q: text <=100` | the typmod is honoured (**≈**, B) |
| `matching q` | `where snapback.matches(profiles, q)` | `matching q` | (**≈**) |
| `socialProfile(handle: text 3..20 format handle)`: `profiles[handle = handle]! else NOT_FOUND`, spread, aggregate point reads, `exists` | `social_profile(handle profiles.handle%type) returns social_profile_t language plpgsql stable`: `select * into strict p from profiles where profiles.handle = social_profile.handle; … exception when no_data_found then raise exception 'NOT_FOUND';` | `! else NOT_FOUND` and the object | the one admitted exception block; an unqualified name that collides with a column is refused with the qualified rewrite (**≈**, B) |
| `insights`: `for d in range(a, b)`, list building, object return | `returns insights_t language plpgsql stable`: `for d in a..b-1 loop days := days \|\| row(…)::day_t; end loop; return row(…)::insights_t;` | the loop and the object | `range(a, b)` is end-exclusive, so `a..b-1`; a declared composite and initialized empty array, never json; integer bounds only; normalize `b - 1 + 1` to `b` for the pinned IR (**≈**, B) |
| `trending`: `where .parentId = null and not .removed and .at > now - 24h and .at <= now last 10 by .likeCount, .at` | `where parent_id is null and not removed and at > now() - interval '24 hours' and at <= now() order by like_count desc, at desc limit 10` | the bucketed window | no cursor is required for this first page; expand `select (post_card(p)).*` and terminate with `return`; both endpoints required; the admitted interval shapes are `now() ± interval '<n> <unit>'` (**≈**, B) |
| aggregate reads without a view (streaming) | `select count(*) into n from messages m where m.conversation_id = message_total.conversation_id` in a body | the streamed aggregate | the read rule must be uniformly decided by the pinned prefix; query reads return null on a meter cut (LLP 3000.013 §5.1); mutations/jobs refuse and roll back rather than commit a partial total (**≈**, B) |
| `fn` helpers (`editWindow`, `receiptState`, …) | `private.edit_window() returns interval language sql immutable` and `private.receipt_state(m messages) … language plpgsql stable` with §3.6 read-only body grammar | `fn` | expression and block helpers, loops and table reads, not in `api.ts` (**≈**, B) |
| `mutation edit(…): server` | `select snapback.server('edit');` | `: server` | (**≈**) |
| optional reference / bounded media argument | `parent posts.id%type default null`, `photo posts.photo%type` | `parent: posts ?`, `photo: image <=10000000 ?` | `%type` carries nominal metadata and nullability (**≈**, B) |
| `[id] <=50`, list growth and cardinality, text length | `ids snapback.id[], extra snapback.id`; `perform snapback.bound(ids, 50); grown := ids; grown := grown || array[extra]; n := cardinality(grown); n := length(body);` | `[id] <=50`, `grown = ids; grown = grown + [extra]`, `count(grown)`, `count(body)` | a static argument bound, not a new scan; empty arrays initialized explicitly; arguments cannot be reassigned in Quarry, so growth uses an initialized local and its append statement; general list-valued binary `+` is not admitted (**≈**, B) |
| `now - m.at <= editWindow()`, `now + shortTTL()` | `now() - m.at <= private.edit_window()`, `now() + private.short_ttl()` where helpers return `interval '60 seconds'` and `interval '180 seconds'` | millisecond subtraction/comparison and duration addition | fixed duration helpers lower to integer milliseconds (**≈**, B) |
| unpaged shaped scans (`roster`, `typingNow`), `first(read)` (`otherProfile`, `findGroup`) | `return query select m.principal from members m where m.conversation_id = roster.conversation_id; return;` without LIMIT; `select … into r from t … order by … limit 1` | unpaged shaped read; `first(read)` | unpaged collections need a fitting cap/pinned audience or the binder's admitted metered scope; null on no scalar row; partial query collections on meter cut; write callers cannot commit incomplete aggregates (**≈**, B) |
| local `group(rows, 'emoji') { key, count(.items) }` | — | — | **✗**: local-list grouping has no registered SQL spelling; `reactionList` is not fully covered merely because block helpers exist |
| named index `by byActorTime: actor, at` and dynamic `merge feedEvents … by byActorTime` | — | — | **✗**: no SQL declaration/merge-lane spelling; replacing it with Following is not IR equivalence |
| reference list `[messages] <=50` | — | — | **✗**: `snapback.id[]` carries no element-table identity; `%type[]` is not a registered Postgres spelling |
| independent sibling pages in one object | — | — | **✗**: cursor ownership needs a separate finite spelling |
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
| `upsert t[k] { … }` | `insert … on conflict (<key>) do update set c = excluded.c, …` where every `set` uses `excluded`, every supplied non-key insert field appears exactly once in SET, and there are no SET-only fields | `upsert` | keys come from the conflict target; omitted defaults are omitted from both patches; partial field correspondence, existing-row expressions and differing insert/patch values refuse (**≈**, B) |
| `update t[k] { … }` | `update t set … where <full unique key>` | point write | missing target is `NOT_FOUND`; an authorized blind patch can change a hidden row and returns null while still hidden; denial is `E_RULE` for a readable target and `NOT_FOUND` for a hidden one (**≈**, B) |
| `update t[k] { … } if cond` | `update … where <key> and <cond>` | `if cond` | a readable target with a false condition is `E_CONFLICT`; an unreadable target is `NOT_FOUND`; the pre-read is the engine's own (**≈**, B) |
| `delete t[k]` | `delete from t where <key>` | point delete | `NOT_FOUND` on a missing row; an authorized hidden delete succeeds; denied existing targets give `E_RULE` regardless of visibility (**≈**, B) |
| `require cond else CODE` | `if not cond then raise exception 'CODE'; end if;` | `require` | `cond` must be a non-null boolean; a nullable condition is refused (**≈**, B) |
| `emit push { … } once [a, b]` | `perform snapback.emit('push', json_build_object(…), once => row(a, b))` | `emit … once [a, b]` | a heterogeneous key is a `row(…)` (**≈**) |
| `if … else if exists likes[postId, viewer]` | `elsif exists (select 1 from likes l where l.post_id = set_like.post_id and l.principal = auth.uid()) then` | the probe in a condition | (**✓**) |
| `job daily(periodStart, periodEnd): for p in profiles: …` | `create procedure daily(period_start timestamptz, period_end timestamptz) language plpgsql as $$ declare p record; begin for p in select * from profiles loop declare n bigint; begin … end; end loop; end $$` | the sweep | a job is a sequence of sweeps: every top-level unpaged `for` over a table, filtered or not, is its own adaptive sweep; a paged, write-free loop before the first sweep is prelude; inner loops share a chunk; loop-carried state across chunks refuses; every sweep-index column must be id or immutable (**≈**, B) |
| `schedule dailyDigest every 1d at 08:00: daily` | `select cron.schedule('daily-digest', '0 8 * * *', $$ call daily(snapback.period_start(), snapback.period_end()) $$)` | the schedule | UTC; admitted cron: `*/N * * * *` for N dividing 60, `M * * * *`, `M H * * *`; `every 90s` and weekday forms are GAPs; the period bounds are engine calls, never `now()` (**≈**, B) |
| `schedule … : insights.daily` | `call insights.daily(…)` in SQL schema `insights`, file `insights.sql` | the qualified target | module = file basename = SQL schema; public schema is the root module; private helpers belong to their source module (**≈**, B) |
| presence deciding only an emit | `if not snapback.connected(p.principal) then perform snapback.emit(…); end if;` | the effects-only exception | (**✓**) |
| `after insert <-` | — | — | **✗** |

### 3.7 What is not Postgres, exhaustively

One rule decides membership: **any construct whose Postgres meaning differs
from its Snapback meaning gets a row, even when its syntax is standard.**

**A. Executes only with the stub schema:** the domains `snapback.id`,
`snapback.principal`, `snapback.cursor`, `snapback.image`,
`snapback.video`; the IMMUTABLE stub functions `snapback.count`, `sum`,
`sequence`, `recorded`, `day`, `bytes`, `format`, `cap`, `matches`,
`connected`, `emit`, `period_start`, `period_end`, `bound`, `mint`,
`created`, `hour`, `duration`; the
configuration calls `snapback.identity`, `effect`, `publish`, `retain`,
`expire_at`, `search`, `immutable`, `written_by`, `once`, `online_only`,
`server`; `auth.uid()`; and the `snapback` publication. Every non-GAP row of §3 must
parse **and execute** on Postgres 17 with `snapback5/stubs/snapback.sql`
loaded and every routine is called; the transcript is committed. Signatures
and named arguments are defined in that stub file; stubs are typed dummies,
not an alternate runtime.

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
only matched `excluded` values; point writes follow §3.6's outcome matrix; a mutation's `raise exception
'CODE'` carries an application code; transition triggers admit only `E_RULE`; a `create procedure` is a chunked job
and is not in `api.ts`; routine classification follows §3.5; private helpers and shapes are not in
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
`=`, and `is not null` / `is distinct from` to `!= null` / `!=`.
Bare `=` / `<>` / `in` / `not in` on nullable operands, including `= null`
and `<> null`, refuse with the null-safe rewrite, never silently change
meaning. Ordered comparisons on nullable operands and nullable boolean
conditions also refuse, including `not (a < b)`: SQL unknown must not
become true after Quarry's false-on-null guard. An explicit non-null
narrowing before comparison is admitted. No context-sensitive positive-
predicate exception in this revision; the rule is deliberately uniform.
`is [not] null` on a record refuses with `found`; bare `text` is
`text <=10000`; `bigint` is 53-bit; `time` is spelled `timestamptz`,
representing finite integral Unix milliseconds, not a SQL `time` of day.
Zero is `'epoch'::timestamptz`; finite timestamp literals require an explicit
UTC offset and millisecond precision. `interval` literals admit integral
milliseconds, seconds, minutes and hours only (24 hours is one fixed day);
months, calendar days, infinities and sub-millisecond precision refuse.
Timestamp subtraction and interval-returning helpers lower to integer
milliseconds; timestamp ± duration preserves time. SQL verification runs
in UTC. The lowering rejects out-of-range 53-bit values; `sum` over an empty set is 0; a streamed `count(*)`
returns null on a meter cut; `snapback.publish` is residency, not Realtime
(unpublished tables still answer live queries from the server); a
`written_by` column has §3.3's field-authority/transition contract and is private to its owner by default; `auth.uid()` is
`snapback.principal`; a `uuid` principal column is refused; `snapback.id`
references enforce neither existence nor deletion; Snapback references
refuse `on delete`/`on update`; `for i in a..b` is inclusive and the
lowering keeps it so (a Quarry `range(a, b)` is `a..b-1`); an unqualified
name that collides between a parameter and a column is refused with the
qualified rewrite; module = file basename = SQL schema (§3.6). PostgreSQL SELECT/RETURNING
visibility is not a prerequisite for Quarry's authorized blind writes;
`FOUND` from an insert is insertion status, not whether its returned row is
visible. An omitted intrinsic id is minted by Snapback; the fixed stub
default is only an execution fixture. `auth.uid()` is the authenticated
principal (including authenticated guest identities); unauthenticated
operation requests are rejected before evaluation, never evaluated with a
null viewer. `auth.role()`, `auth.jwt()` and a user-supplied `viewer`
parameter refuse with `auth.uid()` as the rewrite.

**C. Refused Postgres, with the rewrite named:** `create index` (the
planner chooses; rewrite: delete it, or `snapback.search` for words),
`create trigger` other than §3.3's transition form (rewrite: a maintained
counter or a transition), `security definer` helpers whose body is not an
admitted probe, CTEs, window functions, set-based DML, `insert … select`,
`execute`, cursors, exception blocks other than `no_data_found`, floats,
`like`/`~` outside `snapback.format`, jsonb operators outside
`json_build_object`, `avg`, `string_agg`, `date_trunc`, `extract`,
`union` (distinct), `to service_role`, `on delete`/`on update`, `uuid`
principals, `alter publication`, `*/7`-style cron; `security definer` except the
exact policy-probe helper. Privilege boilerplate (`grant`, `revoke`) and
`set search_path` are ignored during corpus replay, never an authority
mechanism; schema qualification is still required. `create or replace`
and `if not exists` normalize creation of the final catalog, not migration
or adoption behavior.

**The admitted expression subset:** `= <> < <= > >= + - *`, `and or not`,
`is [not] null`, `is [not] distinct from`, `exists <key probe>`, `in (select col from t where …)`
(a value lane, refused over a nullable column), `case when … then … else …
end` (Quarry's `a if c else b`), `coalesce(a, b)` (`??`), `least`/`greatest`
(Quarry's scalar `min`/`max`, exactly two required operands), `substr(s, i, n)` (`slice(s, i - 1, i - 1 + n)`,
with required integers `i >= 1`, `n >= 0`; other offsets refuse), `length`, `snapback.day`, `snapback.hour`,
`count`, `sum`, `cardinality` (list count), `first` via a LIMIT-1
point result (§3.5), `array_agg`-free list building by `||`, `interval`
arithmetic on `timestamptz`, and the media fields (`video.duration` as
`snapback.duration(video)`). Floats are refused (LLP 3000.007 §5.7).

**One spelling.** The SQL surface canonicalizes the registered aliases only:
`<>`/`!=` on required operands; equality operand order;
`create or replace`/`if not exists` creation; terminal `return query …;
return;`; explicit shape lists under §3.4's exact replacement rule; `using (E)
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
  feed views, maintains, shapes, programs, statements, schedules, effects,
  `use identity`, `fn` helpers)
  to Quarry source and emits the span map. Its acceptance test is the
  round-trip property `parse(print(parse(q))) == parse(q)` with sites
  stripped, over the committed target and all §3-admitted forms in #19 and the guide
  corpus. GAP forms are inventoried separately, not silently skipped passes;
  `route`, `walk`, decimal and money are not lane (a)'s exit requirements. It is lane (a)'s exit criterion.
- **The unchanged binary** reads the printed Quarry from a build directory
  (never the project tree) and does everything else: `check`, `dev`,
  `serve`, `why`, `guide`.
- **The equivalence gate:** a harness under `snapback5` calls the unchanged
  `snapback4_lang::compile` in-process on the printed SQL output and the
  **original**, independently pinned Quarry sources. Compare `Schema` by
  `PartialEq` and every complete `BoundProgram.program` by serialized IR,
  including argument/result types, rules, defaults, constraints, residency,
  work policy and API metadata. Strip only source sites/file paths and
  deterministically generated local ids by a documented alpha-renaming;
  never erase constants, field order, rule images or authority. Constant
  endpoint arithmetic (`b - 1 + 1`) may normalize to `b` on both sides.
  `check --json` supplies summaries, not schema/IR, and is not this oracle.
  Also require byte-identical generated `api.ts`, and matching `why` on
  every table and operation (only paths/timing normalized). Printer text
  identity is reported, not gated. Every admitted form, ✓ as well as ≈,
  gets an independent SQL/Quarry semantic witness with seeded input and
  expected value, refusal or disclosure; the SQL author must not compensate
  for a lowering bug. This gate is future compiler work, not step 3.
- **Wrapper ownership:** a manifest binds each SQL source to its module,
  source-root-relative effect asset paths and generated-client destination.
  The wrapper watches SQL, resolves/lowers/rebuilds on change, and asks the
  unchanged dev server to reload the generated Quarry. Moving `.q` into a
  build directory must not relocate assets or `snapback/generated/api.ts`.
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
- **Both arms must carry LLP 3000.015** before shared-baseline qualification.
  Step 3 at `d9f177a434` found those additions absent. The 2026-09-25
  recheck at `da443e4d44` binds all nine lowered projects on the shared
  baseline; its three provisional ✗ rows return to ≈. This completes the
  form-table binding prerequisite, not the future §4 equivalence gate.
- **LLP 3000.009 §6.2** is not a relief valve for this bet; unlowerable
  reads are refused.
- **LLP 4000 §13** already withdraws the earlier claim about "the item
  the record names most" and "the only surface this grader has scored at
  94". That historical correction needs no new edit to the shelved bet.
- **`through`** (LLP 3000.014) is not in either arm for the experiment.

## 7. Pre-tests, compiler-free, before any lane

Both run on the verified form table (§3). The prerequisite that LLP
3000.015 has landed is met at `da443e4d44`, and the dated step 3 recheck
binds its three additions on that baseline. Pre-test 1 is authorized from
this commit, subject to the instrument freeze below; it was not run by
this recheck.

**Pre-test 1, the corpus replay (one day).** The manifest, committed by
hash: `astra-supabase/schema.sql` (92 lines), `astra-supabase/scripts/mutations.sql`
(95), `astra-supabase/scripts/m7-migration.sql` (42), `grok-supabase/server/schema.sql`
(309), `muse-supabase/db/{schema,rls,functions,rpcs,migrate-m7}.sql` (182,
155, 121, 294, 439). The manifest and rubric are frozen **before** replay. This is a compatibility
and rewrite-cost test, not a literal-syntax-only refusal census. Report both.

**Classes:** admitted; canonicalized (exactly a registered alias);
rewritten (one of the following behavior-preserving rewrites); refused (no
admitted spelling after those rewrites); ignored (boilerplate). No
server-only class. Rewrites are visible work: report their count, touched
AST nodes and authoring explanation, never merge them into canonicalized.
A rewrite preserves product outputs, authorization, duplicate/ordering
behavior and required online/offline behavior; a faster but different feed
or weaker policy is not a pass.

| Statement kind / counting unit | Registered classification |
| --- | --- |
| `create table`; add/alter column; add/drop constraint | Count each column and constraint separately, plus one structural top-level statement; classify each by §3. A table's top-level class is its worst non-ignored child (refused > rewritten > canonicalized > admitted). Report child denominators separately, not added to the top-level rate. UUID identity/principal conversion to `snapback.id`/`principal` is rewritten only if no UUID-specific operation or authority changes; removing a used cascade, JSON, array or default behavior is refused. |
| Ordinary functions, procedures and trigger functions | Count each declaration once; its class is the worst of signature and body. Classify bodies separately under §3's finite grammar. Procedures are jobs only when every sweep/prelude fits. Registered counter/window rewrites below classify the entire trigger bundle as rewritten, while raw refused-body counts remain reported. |
| Policies; enable RLS | Policies follow §3.3, including exact probe-helper inlining; RLS enablement admitted. No audience inference is claimed for a residual probe. |
| Triggers | Transition form admitted; the named counter/window bundles below may be rewritten; all others refused. |
| Indexes | Refused as authored; removable redundant performance-only indexes are rewritten only after recording that uniqueness, search or a named merge dependency is not lost. |
| Top-level data INSERT/UPDATE; CTE UPDATE; `do`; `lock table`; `setval` | Refused: migration/data scripts are not declared operations. Moving them into a function is not an unregistered escape. |
| `create sequence`; `create extension` | Refused unless the sequence is exactly the registered per-parent assignment rewrite and its required baseline exists; extensions supplying only UUID generation or cron names are ignored dependency boilerplate, all other extensions refused. |
| `drop … if exists`; BEGIN/COMMIT; GRANT/REVOKE; SET search_path | Ignored boilerplate. Dropping live data or changing product authority is not boilerplate. Explicit qualification still determines resolution. |
| `create or replace`; `if not exists`; other ALTER TABLE; ALTER PUBLICATION | Creation aliases canonicalized; remaining ALTER is classified by final catalog change as above or refused if no §3 form exists; publication residency rewrite requires matching audience, not just Realtime enrollment. |
| Every other kind | Refused; no unregistered class or rewrite may be invented during the run. |

Counting is by the frozen Postgres AST: each top-level node once; each
executable plpgsql statement node once, including IF/loop/return and all
nested branches, excluding block/declaration wrappers. A declaration's
signature is a separate reported unit. No splitting SQL strings at
semicolons inside routine bodies. Report raw spelling refusals as well as
post-rewrite refusals. A third family classifies blind under the hashed
rubric; uncertainty is reported and resolved before unblinding totals.

| Named idiom instance | Pre-registered rewrite and actual stopping question |
| --- | --- |
| Muse `is_member` | Inline the full-key probe including `left_at is null`. It is a legal online-only rule, not an invertible audience. The source corpus does not by itself require device replication; online-only is allowed here and `E_SYNC` alone is not a stop. If the brief requires that membership rule offline, losing it is a refused behavior. |
| Muse `bump_counters`; Astra `clqfa_like_counter` | Generated `snapback.count` columns, with corresponding insert/delete behavior and visibility; conditional contributions use the registered filter. Counter drift/side effects not expressible by that declaration refuse. |
| Muse `enforce_message_windows` | Mutation-side required `raise` checks with fixed intervals, and `edited` assignments in **every** writer, including privileged/job paths where the original trigger applied. The test asks whether coverage and OLD/NEW behavior can be preserved; an uncovered writer or changed boundary refuses. |
| Muse `feed` | Following + page + shape only if public-source admission, audience, duplicates, ranking and continuation agree. CTE removal alone is not equivalence; if Following cannot preserve those behaviors, this instance refuses. |

**Stop rules:** stop if post-rewrite refusals exceed one third of counted
top-level statements or one third of executable body statements; or if any
named instance above has **no behavior-preserving admitted spelling after
its registered rewrite**. The one-third line is an investment threshold,
not a calibrated falsifier. The original spellings' known failures are
registered; whether the complete behavior survives the rewrite is the
empirical question. Nothing here pre-classifies that answer as success.

**Pre-test 2, blind writing (one day, after the SQL card is frozen by
hash).** Three families per arm, including the builder's, write the
messaging half of the Clique brief (which must include the edit window and
the read mark) from the brief and one card only: the SQL card for the
treatment, the Quarry language card at the baseline commit for the control.
Before rates are scored, both arms must cover the same frozen feature
checklist: membership/authorization, send/edit/delete and edit windows,
read marks/unread, ordering, pagination/search, product caps, media,
presence/expiry and digest scheduling. Missing required behavior stops that
arm; an empty backend cannot pass. Fresh sessions with no prior access to
this RFC or answers write both arms, with family assignment interleaved.
Their statements are classified under one hand rubric by a third family;
that common instrument decides the refusal comparison. Quarry is also
checked by `snapback4 check`, with discrepancies reported separately. Each family then
predicts the outcome of five registered scenarios with fixed initial state
and pre-registered expected answers hidden from writers and card authors (a hidden row in a search; an offline send;
a removed member's history under `delivered-history`; a mark advance
across 10,000 messages; an edit after its window). **Stop rules:** the bet
stops if the SQL arm's refusal rate is more than 10 points above the Quarry
arm's, or its prediction accuracy is 3 or more of 15 below the Quarry
arm's; also stop below 12/15 correct in the SQL arm (four of five
scenarios on average), even on a tie. Independent scorers judge predictions.
Freeze cards before revealing answers; publish answers only after both
arms finish. The 10-point/3-answer margins are investment tolerances;
passing is permission to build, not evidence of superiority.

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
  green; pre-test 2's programs lowered and behaviour-checked (§9 step 6).
- **The primary result, registered:** the treatment's `data_modeling` mean
  over three runs exceeds the control's by at least 3. At σ ≈ 2.6–3 per run
  and N = 3 per arm, P(met | true 0) ≈ 0.10 and P(met | true +4) ≈ 0.67;
  those numbers are registered so that a miss at N = 3 is recorded as
  **"not shown at N = 3"**, distinct from "failed", with no optional pooled second look. A later N = 8 is a new,
  separately registered series (eight fresh runs per arm, +3 threshold,
  same gates), never pooling these three or upgrading their verdict. Opus's counter-expectation (within noise) is registered
  beside it. `data_modeling` is scored twice: by the series scorer from the
  narrative files, and by a second scorer family from masked files; both
  must meet the threshold. Before runs the second scorer scores the same
  frozen control-series notes; record its sd/scale and inter-scorer
  correlation. Without that calibration there is no two-scorer power claim.
  Under the illustrative equal-scale normal model at true +4, requiring
  both yields roughly 0.43–0.46 with independent scorers, up to 0.67 with
  perfect correlation; these are sensitivity cases, not measured power.
- **The mechanism gate, symmetric:** one **SURFACE** class (learning-cost
  deduplicated difficulty incidents about the authoring language, its syntax, its restrictions and
  its refusals, and the Quarry the SQL arm still reads), classified by a
  third family on notes where code spans and identifiers are replaced by
  placeholders and the product vocabulary (`Quarry`, `SQL`, `Postgres`,
  `Supabase`, `snapback4`, `snapback5`, `.q`, `.sql`, `policy`, `RLS`,
  `rule`, `trigger`, `procedure`, `function`, `cron`, `view`, `sync`,
  `publication`, the code names) is mapped to neutral tokens by a
  dictionary committed by hash. Count one distinct cause per run, regardless
  of phrase splitting; both arms use the same fixed prompts and reporting
  opportunities, and an incident may have multiple labels but only one
  SURFACE count. Preserve enough content to classify it. Tune masking on
  development notes, then freeze it and audit on 40 independent held-out
  balanced notes. Above 26/40 correct arm guesses invalidates masking;
  revise only with a fresh final audit set, never reuse that set for tuning.
  Report the binomial uncertainty; a pass is not proof of blindness. Reading (A) holds when the treatment's
  SURFACE count **summed over the three pairs** (run i against run i in the
  registered interleaved order) is **strictly lower** than the control's and
  its total learning-cost count is at or below the control's. Zero in both
  arms is "no surface charge in either arm" and reading (A) **does not
  hold**: mechanism not shown, not harm. Equal or higher counts are also
  not shown. Report the pairwise counts so pooling cannot hide a bad pair.
  Strictly lower means at least one deduplicated incident, not one phrase.
  Under an illustrative Poisson count model (λ = 1.5–2.5 per arm), P(A | no
  effect) is about 0.38–0.41; P(A | halved charge) about 0.55–0.65, before
  the total-learning-cost condition. These are upper bounds for that full
  condition, and changing from phrases to incidents requires recalibration.
- **Floors**, exactly LLP 4000 §9.3's five: holistic 4,
  `queries_and_live` 3, `offline_sync` 5, `client_integration` 9,
  `writes_and_transactions` 3 (2 × the registered control-series sd).
  A category fails only when both the median of the three paired
  treatment-minus-control differences and their mean are below minus its
  margin. Setup/docs, diagnostics and authorization scores are reported;
  correctness still gates authority. No uncalibrated additional score floor.
  Under independent normal paired-run noise with variance 2σ² and no harm,
  the mean tail beyond −2σ at N = 3 is Φ(−√6) ≈ 0.0072 per floor;
  the conjunction with the median cannot increase it. The union bound for
  five floors is 0.036, so P(all floors hold) ≥ 0.964 in that model,
  irrespective of cross-floor correlation. Historical variances are a
  transfer assumption, not an observed null distribution.
  Jointly, the two-scorer primary AND floors at true +4 is bounded below
  by P(primary) − 0.036 and above by P(primary): roughly 0.394–0.46 for
  independent scorers, or 0.634–0.67 for perfectly correlated scorers.
  Adding mechanism/correctness cannot improve that power. With independent
  mechanism at 0.55–0.65 it is only roughly 0.22–0.44; without joint
  dependence/calibration no narrower full-gate probability is claimed.
- **Correctness:** as LLP 4000 §9.3, with "where the control passes"
  meaning the control passed the same check in the same pair; a broken
  control voids the pair.
- **The clock:** reported; neither passes nor fails this bet.
- **One outcome rule.** The bet **passes** when both scorers meet the
  primary, every floor holds, correctness holds and reading (A) holds.
  It is **not shown at N = 3** when the primary or mechanism is missing,
  empty or tied, provided floors and correctness hold. It **fails** only
  on floor/correctness harm where the paired control passes. Not passed
  never ships. No third-run result authorizes optional stopping/retesting.

## 9. Order of work

1. Revision 4 under the author's ruling, with round-3 dispositions (§12).
   No fourth review round on this document.
2. LLP 3000.015 landed in Snapback 4 (lanes B1–B3, present at `da443e4d44`).
3. The stub schema and the verification transcript (the current commission
   stops here, before pre-test 1): every row of §3
   executed on Postgres 17 with the stubs, and every lowered form bound by
   `snapback4 check` on the baseline; ✗ rows registered as GAPs.
4. Freeze the corpus manifest, AST counting rule and classifier/rewrite rubric
   by hash, then pre-test 1 (needs no card, no compiler), then the SQL card frozen by
   hash, then pre-test 2. **Stop here for the author's decision.**
5. Freeze the remaining instruments before any lane: the masking dictionary
   and independent audit set, holdout probes, pinned programs, scorer
   calibration and numerical floor/noise model. Pre-test instruments were
   already frozen before their consumers in step 4.
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
  by the semantic fixtures (one per admitted row, added with its lowering lane) and by
  pre-test 2's programs when they are lowered.

## 11. Questions for the author, and the rulings

Ruled on 2026-09-25 (the author: "just do what you think is best … our goal is to make authoring absolutely top notch and performance excellent"): revision 4, then step 3's verification, then pre-test 1; the lead decides the rest.

Ruled on 2026-09-25 ("recs all ok"): Postgres dialect only; the pre-tests
gate the compiler work; a separate `snapback5` package. Decided in this
revision, on the reviews' advice, and open to the author's veto:

4. **One spelling:** canonicalize the registered alias list of §3.7 only;
   nothing that changes meaning under the null rule.
5. **Null semantics: Quarry's total equality in the lowered program**,
   spelled `is null` / `is not distinct from`, with bare `=`/`<>`/`in` over
   a nullable operand refused. Nullable ordering/boolean conditions refuse
   too, including under `not`; use explicit narrowing. A compositional
   true/false SQL lowering is possible without changing the engine, but
   adds resolver/lowering complexity. The lead keeps one clear null rule
   rather than position-dependent exceptions (Opus's alternative).
6. **The viewer:** `auth.uid()`, typed `snapback.principal` (text);
   `uuid` principals refused with that rewrite.
7. **Pre-tests:** pre-test 1 first, after step 3's verification, before
   any card or lane; pre-test 2 after the SQL card is frozen.
8. **Bounded stop resolved:** the author commissioned revision 4 and step
   3 verification. Pre-test 1 follows separately; neither a compiler nor a
   fourth design-review round is commissioned here.

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

### Round 3 (revision 3, `b1edaa05cf`)

Three blind delta reviews, all **NOT READY**, all saying no redesign is
needed and that the remaining edits are local: [Astra](./reviews/4001-snapback5-sql-front-end.astra.md)
(the transition row composes to no grant without an explicit permissive
policy and cannot preserve a custom code; the null ruling does not close
ordered comparisons under `not`; `activity_card(a activity)` cannot take a
`following` row; the pre-test stop is already entailed by the table),
[Grok](./reviews/4001-snapback5-sql-front-end.grok.md) (maintains inherit
their source's residency, so "no publish call" is wrong for them;
`timestamptz default 0` does not parse and `time` is integer milliseconds;
probe residuals may be any rule term; `coalesce(point, 0)` turns hidden
groups into 0; block helpers have no non-`api.ts` spelling; `substr` versus
0-based `slice`; a job is a sequence of sweeps; a dozen #19 forms still have
no row; pre-test 1 as registered stops on Muse's helper and triggers before
verification), [Opus](./reviews/4001-snapback5-sql-front-end.opus.md)
(pre-test 1's idiom stop fires by construction and its rate depends on an
unregistered class; `check --json` carries neither the schema nor the IR, so
the equivalence gate must compare in-process; verification must call the
plpgsql bodies, where six spellings fail; reading (A) must be "not shown"
rather than a fail on one to three phrases; the joint power of the primary
and the floors must be stated). Opus verified the table by executing it.

**The bounded stop.** Three review rounds are preserved above. The author
chose revision 4 and step 3 verification; no new review verdict is claimed.

### Round 3 dispositions

| Round-3 finding | Disposition in revision 4 |
| --- | --- |
| Transition-only grant, empty policy sets, restrictive images, custom code (Astra A; Grok transition; Opus 2/8) | §3.3 complete permissive-policy + trigger bundle; empty OR=false/AND=true; restrictive clauses per image. Only E_RULE in triggers; custom codes stay in mutation `require`. Grok's trigger-as-grant alternative declined to keep the SQL authorization meaning clear. |
| Nullable ordering under NOT; nullable booleans; missing null-safe grammar; `= NULL` alias (Astra B; Grok 5; Opus 6) | §3.3/3.7 include null-safe operators and probe null tests; nullable ordering/boolean conditions refuse, including `not (a < b)`; `= NULL` diagnoses a rewrite. Uniform refusal retained over Opus's positive-position exception for clarity. §11 corrects the claim that SQL truth lowering requires an engine change. |
| Shape across activity/following types; composite SETOF expansion; nested shapes/overrides; result-type declarations (Astra C; Grok 3/4; Opus 2/11) | Explicit typed ROW cast and `(shape(…)).*`; exact complete field-list replacement rule and checked composites; no claim of a PostgREST whole-shape convention. |
| `coalesce` reveals hidden aggregate as zero (all three) | Removed from postCard; authorized miss 0 / hidden null remain the engine's distinct outcomes. |
| Routine kind ambiguity; block/table-reading helpers; IMMUTABLE lie (all three) | §3.5 precedence and private-schema SQL/plpgsql helpers, including row arguments and loops. Stable shape recognized before query; pure immutable helpers cannot read tables. |
| RETURN QUERY accumulation; alternative pages sharing c; cursor-free trending; sibling cursors (Astra C; Grok 4; Opus 9) | Terminal RETURN QUERY + RETURN only; one cursor may own alternative returns; no cursor means first page; sibling-page mapping explicitly ✗. |
| Blind update/delete semantics; upsert insert/patch correspondence; FOUND (Astra D; Grok/Opus table) | §3.6 uses the guide's authority/disclosure outcomes; exact non-key insert/SET correspondence; §3.7 explains SELECT visibility and insert-status versus visible result. |
| Invalid `from =>`, effect defaults versus configured policy (all three) | `module =>` fixed SQL parsing in revision 4; step 3 then removed the legacy no-op module argument and corrected the lowered work clause to `retry`; bare effect and explicit WorkDecl remain separate. |
| Timestamp zero, time/duration type, calendar intervals, duration helpers, precision (Astra E; Grok 1; Opus table) | Epoch timestamptz literal; integral finite UTC milliseconds; fixed interval units; duration-returning helpers; unsupported precision/calendar units refused. |
| `substr` origin and length; least/greatest arity/nulls (Astra E; Grok table) | Exact `slice(s, i-1, i-1+n)` with nonnegative length and positive start; min/max exactly two required operands. |
| Intrinsic id/omitted inserts; bare id distinction (Opus table; Astra forms) | New intrinsic-id row; fixed IMMUTABLE mint stub only for fixture, real engine minting in B; bare id/reference remain distinct. |
| Missing stub signatures: created/hour/duration, cron; actual body execution (all three) | §3.7 A extended, §3 mandates seeded routine calls and non-owner policy witnesses. Step 3 owns transcript/signatures; no creation-only pass. |
| Probe residuals any rule term; is_member vs audience; created target (all three) | §3.3 full-key grammar, residual rule terms and null tests; is_member admitted online-only but E_SYNC when published; concrete `created('messages', message)` row. |
| Public without comment and Following admission citation (Grok/Opus) | `using (true)` emits public with default reason; comment replaces reason; cite LLP 3000.013 §3.3 admission and §4 lifecycle. |
| Maintain residency default, inferred audience, horizon/recipient grammar, omitted read rule (all three) | Separate §3.4 residency row; inherit only surviving audience keys, drop horizon; read derived independently. Explicit read override is ✗; no phantom call. |
| Filtered column replaced by different view; cap ≈ label (Astra table) | Filter argument on generated count macro preserves the column; cap row relabeled ≈. |
| written_by authority vs policies/transitions; sequence provisional settlement (Astra/Opus 8) | §3.3 states field-only bypass of row permission, not transition bypass; the spec's equality example freezes marks. Sequence row states provisional values and page reorder. No shared-core change claimed; baseline verification required. |
| Optional refs, list element refs, bounded media, media metadata (all three) | Scalar `%type` + default null and media `%type` row; list of references explicitly ✗; bare-id list stays distinct; duration signature inventoried. |
| Missing #19 named index/dynamic merge, group/key/items (all three) | Explicit ✗ rows; neither Following nor a maintained count substitutes for those IR forms. `reactionList` coverage not claimed. |
| Missing first/unpaged scans, list growth/count, text count (all three) | §3.5 rows for LIMIT-1/null, unpaged terminal scans, array concatenation/cardinality and text length. |
| Multiple sweeps, filtered sweeps, paged prelude, carried locals; range endpoints (Astra/Grok) | §3.6 job is a sequence of adaptive sweeps; prelude/inner-loop distinctions retained; §3.5 initialized arrays and endpoint normalization. |
| Qualified job names; UTC cron; ambiguous setLike parameter (all three) | SQL schema = module/file; `insights.daily`; UTC; qualify `set_like.post_id`. |
| Streaming query partial total vs write commit (Astra table) | Query cut returns null; mutation/job cut refuses and rolls back. |
| check JSON lacks IR; printer misses identity/helpers; guide scope too broad (Astra F; Grok gate; Opus 2/11) | §4 in-process unchanged compile, actual Schema/IR and API/work metadata comparison, independent original q, generated API and table/op why; printer includes identity/helpers and only admitted guide forms. |
| Pinned-pair claim overgeneralized; semantic fixtures only ≈; SQL watch/assets/client paths (Astra pipeline; Grok gate) | §2 limits identity to pinned pair; §4 witnesses every admitted row and defines wrapper manifest/watch ownership. Step 3 does not claim compiler equivalence. |
| Pre-test 1 guaranteed stop and unregistered table/kind classes; server-only residue; AST units (Astra G; Grok 6; Opus 1) | §7 rewritten class plus named behavior-preservation questions, per-kind/column/constraint rules, exact AST denominators, raw refusal reporting, no server-only escape. Freeze rubric before replay. |
| UUID/viewer/auth context, security definer, GRANT/REVOKE/search_path/creation modifiers (Opus 5/11 and missing forms) | §3.7 rejects supplied viewer/role/jwt and non-probe definer; authenticated guest principal, unauthenticated operations refused. Boilerplate ignored only without product effect; final-catalog creation aliases registered. |
| Pre-test 2 omissions, low absolute comprehension, leaked answers, family exposure, unequal instruments (Astra H; Grok 6; Opus 11) | Frozen common feature checklist, fresh sessions, hidden answers, one hand rubric for decision and compiler discrepancies separately reported, 12/15 absolute floor plus relative margins. |
| Reading A phrase splitting, zero/equal as harm, pooled bad pair, mechanism power (Astra I; Grok 7; Opus 4) | Deduplicated incidents with common elicitation; pairwise reporting; absent/tied/worse reading A is not shown, never harm; illustrative Poisson sensitivity stated. |
| Two-scorer calibration/joint power, floor set/noise rate, optional N=8 (Astra I; Grok 7; Opus 5) | Second-scorer calibration before runs; two-scorer sensitivity and joint primary/floor bounds; exactly five calibrated floors; fresh separately registered N=8, no pooling or verdict upgrade. |
| Masking sample size and reused holdout (Astra I; Grok 7) | Development dictionary then independent balanced 40-note final audit, threshold/uncertainty, fresh audit after any revision; no claim of proven blindness. |
| Step order/instruments; behavior-check cross-reference (Astra/Opus) | §9 freezes pre-test instruments before step 4, remaining instruments before lanes; §8 points behavior checks to step 6. Current commission stops after step 3. |
| Fence points at shelved runtime (all three) | Existing AGENTS pointer retained and conflicting bullets superseded by LLP 4001 §2/3; README/NOT-DOING historical scope called out in AGENTS because those files are outside this commission's edit set. |

## Non-claims

This RFC does not claim SQL removes completeness classes, device admission,
the mutation subset, or `now()` on the device. It does not change the
engine, the grader, the brief or the protocol. It does not predict the
outcome beyond the registered directional prediction of §8, and records the
counter-expectation beside it. It stops at §9 step 4 if either pre-test's
stop rule fires, and at step 1 if the author says so.
