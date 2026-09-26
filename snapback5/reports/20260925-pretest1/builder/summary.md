# Pre-test 1 — builder-family classification

The frozen corpus yields **354 top-level units** and **333 routine PL/pgSQL executable AST units**. Post-rewrite refusals are **152/354 (42.94%)** and **201/333 (60.36%)**, respectively. These numbers use the unresolved readings documented below; they are not reconciled cross-family totals.

Raw-spelling refusals: top-level **191/354 (53.95%)**; routine PL/pgSQL body **210/333 (63.06%)**.

The registered stop-rule predicates evaluate as follows:

- Top-level post-rewrite refusal > one third: **true** (152 > 354/3).
- Routine-body post-rewrite refusal > one third: **true** (201 > 333/3).
- Any named idiom without a behavior-preserving admitted spelling: **true** (Muse bump_counters, enforce_message_windows and feed, under the documented readings).
- is_member: **yes**, online-only full-key probe. Astra clqfa_like_counter: **yes for the manifested insert/delete behavior**, with A-COUNTER-SCOPE unresolved. The two counters are two answers within one of the four registered idiom rows.

No conclusion about the bet is drawn.

**Denominators and rates by file.** N includes ignored units within that group. Each cell contains a count and its percentage of that group/file N; zero-denominator rates are n/a. Table children and signatures are never added to top-level/body N.

**Top-level.**

| File | N | Admitted | Canonicalized | Rewritten | Refused | Ignored | Raw refusal | Post-rewrite refusal |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| astra-supabase/schema.sql | 83 | 23 (27.71%) | 8 (9.64%) | 15 (18.07%) | 36 (43.37%) | 1 (1.20%) | 51/83 (61.45%) | 36/83 (43.37%) |
| astra-supabase/scripts/mutations.sql | 2 | 0 (0.00%) | 0 (0.00%) | 0 (0.00%) | 2 (100.00%) | 0 (0.00%) | 2/2 (100.00%) | 2/2 (100.00%) |
| astra-supabase/scripts/m7-migration.sql | 20 | 2 (10.00%) | 1 (5.00%) | 1 (5.00%) | 12 (60.00%) | 4 (20.00%) | 13/20 (65.00%) | 12/20 (60.00%) |
| grok-supabase/server/schema.sql | 43 | 0 (0.00%) | 0 (0.00%) | 10 (23.26%) | 32 (74.42%) | 1 (2.33%) | 42/43 (97.67%) | 32/43 (74.42%) |
| muse-supabase/db/schema.sql | 27 | 0 (0.00%) | 0 (0.00%) | 9 (33.33%) | 18 (66.67%) | 0 (0.00%) | 27/27 (100.00%) | 18/27 (66.67%) |
| muse-supabase/db/rls.sql | 98 | 50 (51.02%) | 0 (0.00%) | 6 (6.12%) | 2 (2.04%) | 40 (40.82%) | 2/98 (2.04%) | 2/98 (2.04%) |
| muse-supabase/db/functions.sql | 21 | 0 (0.00%) | 0 (0.00%) | 3 (14.29%) | 13 (61.90%) | 5 (23.81%) | 16/21 (76.19%) | 13/21 (61.90%) |
| muse-supabase/db/rpcs.sql | 14 | 0 (0.00%) | 0 (0.00%) | 0 (0.00%) | 12 (85.71%) | 2 (14.29%) | 12/14 (85.71%) | 12/14 (85.71%) |
| muse-supabase/db/migrate-m7.sql | 46 | 4 (8.70%) | 2 (4.35%) | 1 (2.17%) | 25 (54.35%) | 14 (30.43%) | 26/46 (56.52%) | 25/46 (54.35%) |
| **Overall** | 354 | 79 (22.32%) | 11 (3.11%) | 45 (12.71%) | 152 (42.94%) | 67 (18.93%) | 191/354 (53.95%) | 152/354 (42.94%) |

**Routine PL/pgSQL bodies.**

| File | N | Admitted | Canonicalized | Rewritten | Refused | Ignored | Raw refusal | Post-rewrite refusal |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| astra-supabase/schema.sql | 6 | 1 (16.67%) | 0 (0.00%) | 5 (83.33%) | 0 (0.00%) | 0 (0.00%) | 5/6 (83.33%) | 0/6 (0.00%) |
| astra-supabase/scripts/mutations.sql | 138 | 57 (41.30%) | 0 (0.00%) | 4 (2.90%) | 77 (55.80%) | 0 (0.00%) | 81/138 (58.70%) | 77/138 (55.80%) |
| astra-supabase/scripts/m7-migration.sql | 13 | 0 (0.00%) | 0 (0.00%) | 0 (0.00%) | 13 (100.00%) | 0 (0.00%) | 13/13 (100.00%) | 13/13 (100.00%) |
| grok-supabase/server/schema.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| muse-supabase/db/schema.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| muse-supabase/db/rls.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| muse-supabase/db/functions.sql | 31 | 0 (0.00%) | 0 (0.00%) | 0 (0.00%) | 31 (100.00%) | 0 (0.00%) | 31/31 (100.00%) | 31/31 (100.00%) |
| muse-supabase/db/rpcs.sql | 48 | 18 (37.50%) | 0 (0.00%) | 1 (2.08%) | 29 (60.42%) | 0 (0.00%) | 29/48 (60.42%) | 29/48 (60.42%) |
| muse-supabase/db/migrate-m7.sql | 97 | 42 (43.30%) | 0 (0.00%) | 4 (4.12%) | 51 (52.58%) | 0 (0.00%) | 51/97 (52.58%) | 51/97 (52.58%) |
| **Overall** | 333 | 118 (35.44%) | 0 (0.00%) | 14 (4.20%) | 201 (60.36%) | 0 (0.00%) | 210/333 (63.06%) | 201/333 (60.36%) |

**Routine signatures.**

| File | N | Admitted | Canonicalized | Rewritten | Refused | Ignored | Raw refusal | Post-rewrite refusal |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| astra-supabase/schema.sql | 1 | 0 (0.00%) | 0 (0.00%) | 1 (100.00%) | 0 (0.00%) | 0 (0.00%) | 1/1 (100.00%) | 0/1 (0.00%) |
| astra-supabase/scripts/mutations.sql | 2 | 0 (0.00%) | 0 (0.00%) | 0 (0.00%) | 2 (100.00%) | 0 (0.00%) | 2/2 (100.00%) | 2/2 (100.00%) |
| astra-supabase/scripts/m7-migration.sql | 3 | 0 (0.00%) | 0 (0.00%) | 0 (0.00%) | 3 (100.00%) | 0 (0.00%) | 3/3 (100.00%) | 3/3 (100.00%) |
| grok-supabase/server/schema.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| muse-supabase/db/schema.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| muse-supabase/db/rls.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| muse-supabase/db/functions.sql | 11 | 0 (0.00%) | 0 (0.00%) | 3 (27.27%) | 8 (72.73%) | 0 (0.00%) | 11/11 (100.00%) | 8/11 (72.73%) |
| muse-supabase/db/rpcs.sql | 11 | 0 (0.00%) | 0 (0.00%) | 0 (0.00%) | 11 (100.00%) | 0 (0.00%) | 11/11 (100.00%) | 11/11 (100.00%) |
| muse-supabase/db/migrate-m7.sql | 9 | 1 (11.11%) | 0 (0.00%) | 0 (0.00%) | 8 (88.89%) | 0 (0.00%) | 8/9 (88.89%) | 8/9 (88.89%) |
| **Overall** | 37 | 1 (2.70%) | 0 (0.00%) | 4 (10.81%) | 32 (86.49%) | 0 (0.00%) | 36/37 (97.30%) | 32/37 (86.49%) |

**Table / ALTER children.**

| File | N | Admitted | Canonicalized | Rewritten | Refused | Ignored | Raw refusal | Post-rewrite refusal |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| astra-supabase/schema.sql | 243 | 159 (65.43%) | 3 (1.23%) | 2 (0.82%) | 79 (32.51%) | 0 (0.00%) | 80/243 (32.92%) | 79/243 (32.51%) |
| astra-supabase/scripts/mutations.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| astra-supabase/scripts/m7-migration.sql | 24 | 14 (58.33%) | 0 (0.00%) | 0 (0.00%) | 10 (41.67%) | 0 (0.00%) | 10/24 (41.67%) | 10/24 (41.67%) |
| grok-supabase/server/schema.sql | 371 | 299 (80.59%) | 0 (0.00%) | 21 (5.66%) | 51 (13.75%) | 0 (0.00%) | 72/371 (19.41%) | 51/371 (13.75%) |
| muse-supabase/db/schema.sql | 308 | 205 (66.56%) | 8 (2.60%) | 17 (5.52%) | 78 (25.32%) | 0 (0.00%) | 95/308 (30.84%) | 78/308 (25.32%) |
| muse-supabase/db/rls.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| muse-supabase/db/functions.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| muse-supabase/db/rpcs.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| muse-supabase/db/migrate-m7.sql | 43 | 24 (55.81%) | 1 (2.33%) | 2 (4.65%) | 16 (37.21%) | 0 (0.00%) | 18/43 (41.86%) | 16/43 (37.21%) |
| **Overall** | 989 | 701 (70.88%) | 12 (1.21%) | 42 (4.25%) | 234 (23.66%) | 0 (0.00%) | 275/989 (27.81%) | 234/989 (23.66%) |

**SQL-language bodies (supplemental).**

| File | N | Admitted | Canonicalized | Rewritten | Refused | Ignored | Raw refusal | Post-rewrite refusal |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| astra-supabase/schema.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| astra-supabase/scripts/mutations.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| astra-supabase/scripts/m7-migration.sql | 1 | 0 (0.00%) | 0 (0.00%) | 0 (0.00%) | 1 (100.00%) | 0 (0.00%) | 1/1 (100.00%) | 1/1 (100.00%) |
| grok-supabase/server/schema.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| muse-supabase/db/schema.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| muse-supabase/db/rls.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| muse-supabase/db/functions.sql | 8 | 1 (12.50%) | 0 (0.00%) | 3 (37.50%) | 4 (50.00%) | 0 (0.00%) | 4/8 (50.00%) | 4/8 (50.00%) |
| muse-supabase/db/rpcs.sql | 7 | 0 (0.00%) | 0 (0.00%) | 0 (0.00%) | 7 (100.00%) | 0 (0.00%) | 7/7 (100.00%) | 7/7 (100.00%) |
| muse-supabase/db/migrate-m7.sql | 2 | 0 (0.00%) | 0 (0.00%) | 0 (0.00%) | 2 (100.00%) | 0 (0.00%) | 2/2 (100.00%) | 2/2 (100.00%) |
| **Overall** | 18 | 1 (5.56%) | 0 (0.00%) | 3 (16.67%) | 14 (77.78%) | 0 (0.00%) | 14/18 (77.78%) | 14/18 (77.78%) |

**Anonymous DO bodies (supplemental).**

| File | N | Admitted | Canonicalized | Rewritten | Refused | Ignored | Raw refusal | Post-rewrite refusal |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| astra-supabase/schema.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| astra-supabase/scripts/mutations.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| astra-supabase/scripts/m7-migration.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| grok-supabase/server/schema.sql | 4 | 1 (25.00%) | 0 (0.00%) | 0 (0.00%) | 3 (75.00%) | 0 (0.00%) | 3/4 (75.00%) | 3/4 (75.00%) |
| muse-supabase/db/schema.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| muse-supabase/db/rls.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| muse-supabase/db/functions.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| muse-supabase/db/rpcs.sql | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 (n/a) | 0/0 (n/a) |
| muse-supabase/db/migrate-m7.sql | 9 | 3 (33.33%) | 0 (0.00%) | 0 (0.00%) | 6 (66.67%) | 0 (0.00%) | 6/9 (66.67%) | 6/9 (66.67%) |
| **Overall** | 13 | 4 (30.77%) | 0 (0.00%) | 0 (0.00%) | 9 (69.23%) | 0 (0.00%) | 9/13 (69.23%) | 9/13 (69.23%) |

**Denominator sensitivity, without reclassifying a unit.**

| Denominator | N | Raw refusal | Post-rewrite refusal | Post > one third |
|---|---:|---:|---:|---|
| All top-level | 354 | 191/354 (53.95%) | 152/354 (42.94%) | True |
| Non-ignored top-level | 287 | 191/287 (66.55%) | 152/287 (52.96%) | True |
| Routine PL/pgSQL AST | 333 | 210/333 (63.06%) | 201/333 (60.36%) | True |
| Authored routine PL/pgSQL | 327 | 210/327 (64.22%) | 201/327 (61.47%) | True |
| Routine PL/pgSQL + SQL bodies | 351 | 224/351 (63.82%) | 215/351 (61.25%) | True |
| Routine PL/pgSQL + DO bodies | 346 | 219/346 (63.29%) | 210/346 (60.69%) | True |
| All routine and DO body units | 364 | 233/364 (64.01%) | 224/364 (61.54%) | True |

**Rewrite work.** These are counts of rewritten source units, not counts of newly emitted statements. A bundle may touch a signature, body nodes, column and trigger; no aggregate across different denominators is used as a rate. Failed attempts stay refused.

| Registered rewrite | Top | PL/pgSQL body | Signature | Table child | SQL body |
|---|---:|---:|---:|---:|---:|
| §3.7 null-safe equality | 0 | 4 | 0 | 0 | 0 |
| §7 Astra clqfa_like_counter → generated snapback.count | 3 | 5 | 1 | 2 | 0 |
| §7 UUID identity/principal conversion | 0 | 0 | 0 | 40 | 0 |
| §7 UUID identity/principal conversion; §7 exact probe-helper inlining | 0 | 0 | 3 | 0 | 0 |
| §7 UUID identity/principal conversion; §7 exact probe-helper inlining; §7 exact probe-helper inlining | 3 | 0 | 0 | 0 | 0 |
| §7 exact probe-helper inlining | 6 | 5 | 0 | 0 | 3 |
| §7 remove redundant performance-only index | 33 | 0 | 0 | 0 | 0 |

Builder-family classification at `da443e4d44a07d275acc392e68dc765658298486`.
No other classifier's work was accessed. The instrument was not edited.
These are compatibility judgments under the frozen form table, not executions
of a SQL front end, qualification of the baseline, or conclusions about the bet.

The orientation used LLP 4001 §3.1–§3.7 and §7 as the governing instrument;
LLP 4000 §13 establishes that the first bet is shelved. LLP 3000.015 and
Snapback 5's AGENTS/JOURNAL provide background, not additional SQL spellings.
The existing engine guide's `language.rs`, `indexes.rs`, and `feeds.md` were
consulted for the mapped engine forms. The frozen §3 GAPs were not silently
upgraded based on newer engine capabilities. The user's explicit commission
authorizes this classification despite the frozen §7 prerequisite caveat.

**Counting and interpretation.**

- File order is the manifest order. Top-level indexes are 1-based Postgres
  `RawStmt` indexes. Children are 1-based within their parent: a routine's
  signature first, then its body nodes in parser preorder; a table's columns
  and constraints in source/AST order, with column constraints immediately
  after their column. `file:top[:child]` never depends on class or wording.
- Every top-level node is counted once. Routine/table classes are the worst
  non-ignored child; creation aliases affect an otherwise admitted parent.
  An executable IF owns its condition and ELSIF conditions; branch statements
  are separate units. `PLpgSQL_if_elsif` is a branch wrapper, not an additional
  statement. Block, exception-handler and declaration wrappers are not units;
  executable statements inside them are units. A refused wrapper/signature
  does not automatically make every otherwise legal scalar statement refused.
- PostgreSQL 17.4 inserts six terminal empty RETURN nodes in routines and four
  in DO blocks. They are counted and flagged `parser_inserted`; the report also
  gives the authored-only denominator. There is no semicolon-based splitting.
- The table-child denominator includes all explicit `ColumnDef` and
  `Constraint` nodes, including NULL, NOT NULL and DEFAULT. These are genuine
  nodes in the pinned parser, not extra splits of a constraint expression.
  ALTER-added columns/constraints and the explicitly dropped constraint are
  included in this denominator. No implicit primary-key NOT NULL is invented.
- Routine PL/pgSQL is the primary body denominator. SQL-language body statements
  and anonymous DO bodies are also enumerated and classified, in separate
  groups. Alternative combined body rates are given so these counting
  ambiguities cannot hide a threshold crossing. Signatures never enter the
  body denominator. Ignored top-level boilerplate remains in the all-top-level
  denominator; the non-ignored denominator is also reported.
- `raw_refused` asks whether the original unit's substantive spelling is
  admitted by §3, before registered rewrites. `post_rewrite_refused` asks
  whether the registered rewrites leave no admitted behavior-preserving form.
  A refused parent takes raw refusal from any raw-refused child. Inlining an
  already recognized exact policy-probe helper is charged as rewrite work,
  with raw refusal false on the call/body and true on its UUID signature.
  Failed attempts are still `refused`, never a sixth class.
- Each body unit is judged with its owned expressions and necessary local
  typing/authority context. An IF is not charged again for the statements in
  its arms. A signature's SECURITY DEFINER failure remains a signature failure;
  e.g. a literal assignment inside that routine can still be admitted. This
  is diagnostic compatibility, not a claim that an isolated admitted child
  makes its containing program executable.
- `{{P}}` is expanded to `clqfm_` before parsing. The source itself specifies
  prefix substitution. It is a parse preparation, not a compatibility rewrite
  or refusal charged once per token. Original bytes are hashed first; expanded
  hashes and substitution counts are in `parse-receipt.json`. AST offsets refer
  to expanded input. This does not change SQL structure, prefix equality in
  TG_TABLE_NAME strings, or ordering among names with the common prefix.

**The four named idiom answers.**

1. **Muse `is_member`: a behavior-preserving online-only rule exists.**
   `muse-supabase/db/functions.sql:1` has
   `where m.conversation_id = c and m.user_id = u and m.left_at is null`.
   `muse-supabase/db/schema.sql:12` declares
   `primary key (conversation_id, user_id)`; the probe covers that total key.
   The conversation SELECT policy is
   `using ({{P}}is_member(id, auth.uid()))` in `rls.sql:50`.
   Substitute its arguments into that full probe, retaining `left_at is null`:

   ```sql
   create policy clqfm_convo_sel on clqfm_conversations
     for select to authenticated using (
       exists (select 1 from clqfm_members m
         where m.conversation_id = clqfm_conversations.id
           and m.user_id = auth.uid() and m.left_at is null));
   ```

   The SECURITY DEFINER source bypasses the membership table's RLS; §3.3
   probes also do not recurse into the target's policies. No membership
   condition or grant is dropped. The residual prevents audience inversion,
   so this is online-only; the manifest supplies no requirement to replicate
   this rule offline. This does not rescue the separate message expiry policy,
   nested poll-policy probes, or failed table children. Nodes touched are
   the helper CreateFunctionStmt/signature (UUID → principal), its SQL
   SelectStmt/SubLink, and the policy FuncCall replaced by that SubLink.

2. **Counters: the two registered instances have different answers.**

   **Astra `clqfa_like_counter`: the registered count replacement preserves
   the manifested insert/delete counter behavior, under the explicitly
   reported A-COUNTER-SCOPE reading.** `astra-supabase/schema.sql:78` contains
   `if TG_OP='INSERT' then update clqfa_posts set like_count=like_count+1
   where id=NEW.post` and the ELSE decrements `where id=OLD.post`.
   `schema.sql:80` fires `after insert or delete on clqfa_likes`.
   The `like` arm in `scripts/mutations.sql:1` uses INSERT ON CONFLICT DO
   NOTHING for set, DELETE by `(actor,post)` for clear; it contains no retarget
   UPDATE of a like and no direct counter assignment. `schema.sql:76` seeds
   the value from `count(*)` before the trigger. Replace the counter
   declaration and trigger bundle with the §3.2 form:

   ```sql
   like_count bigint generated always as
     (snapback.count('clqfa_likes', by => 'post')) stored
   ```

   The contributor's `post` reference selects its owner; no filter is needed.
   Duplicate set intents still add one contributor; deleting an existing like
   removes one. The value remains on its original post row and inherits that
   row's visibility; this replacement grants no additional reader access.
   The column/type/default nodes at `schema.sql:75`, the function signature,
   IF/UPDATE/RETURN nodes at `:78`, and CreateTrigStmt `:80` are the rewrite
   work. The top-level backfill `:76` remains refused by §7. This answer is
   local to the counter idiom: the parent/source tables' independently refused
   id/type/authority spellings do not become a passing whole application.
   Expanding the stopping question to all SQL-owner writes, all representable
   int4 overflow states, or to require a complete admitted surrounding schema
   would change this answer; that ambiguity is recorded before unblinding.

   **Muse `bump_counters`: no behavior-preserving generated count exists for
   the authored authorized behavior.** `functions.sql:11` dispatches on likes,
   reposts and posts; deletes use `greatest(like_count - 1, 0)` (and analogous
   repost/reply values). `functions.sql:13/:15/:17` fire only
   `after insert or delete`. But `rls.sql:94` (`like_upd`) uses only
   `using (auth.uid() = user_id) with check (auth.uid() = user_id)`;
   `rls.sql:96` allows the analogous repost UPDATE. A user can move their like
   from post A to post B without changing user_id. After one like on A, source
   counts stay `(1,0)` after that UPDATE, whereas generated counts become
   `(0,1)`. `post_upd` at `rls.sql:36` also allows an author to change
   parent_id and stored counter fields. `snapback.count('likes', by =>
   'post_id')`, the analogous repost count, and a parent reference reply count
   (optionally filtered for non-null parent_id) count current contributors;
   no registered filter reproduces this history-dependent drift or arbitrary
   authorized counter patches. Adding immutability would change product
   authority. The whole named Muse bundle remains refused; the attempted
   replacement touches its three stored counter columns, function/body and
   three trigger nodes.

3. **Muse `enforce_message_windows`: no behavior-preserving fixed-interval,
   every-writer replacement is established; classify refused.**
   `functions.sql:8` begins `if NEW.purged then return NEW; end if`, loads
   `edit_s := coalesce(({{P}}cfg_windows()->>'editWindowSeconds')::int, 900)`
   and an analogous configurable `del_s`, and tests
   `extract(epoch from (now() - OLD.created_at)) > edit_s` (or `> del_s`).
   The attempted mutation form must check the OLD row, preserve the strict
   `>` boundary (exactly 900 seconds is allowed under the default), raise
   `CLQFM_EDIT_WINDOW_EXCEEDED`/`CLQFM_DELETE_WINDOW_EXCEEDED`, set edited and
   timestamps, and preserve the purge bypass. A fixed `interval '900 seconds'`
   / `interval '3600 seconds'` mutation check implements only the defaults;
   `cfg_windows` at `functions.sql:4` reads the config table before falling
   back. A configured 120-second window and an edit at 121 seconds is rejected
   by the source and allowed by that fixed-default candidate.
   Independently, `rls.sql:66` (`msg_upd`) grants direct row UPDATE to a
   sender/member, without confining writers to a named mutation. The original
   BEFORE UPDATE trigger `functions.sql:10` covers those writes and privileged
   writes. Both `rpcs.sql:4` and `migrate-m7.sql:15` contain purge writers;
   preserving their `NEW.purged` bypass is necessary. The corpus supplies no
   complete edit/delete mutation boundary through which all other updates
   can be routed. Replacing the trigger with checks only in invented RPCs
   leaves the direct policy writer uncovered; revoking that path changes
   authority. These are source-based failures, not E_SYNC. Attempted nodes:
   trigger/function, TG_OP IF, OLD/NEW comparisons, EXTRACT, config assignments,
   RAISE and NEW assignments, and checks at every UPDATE writer. See A-WINDOW.

4. **Muse `feed`: no behavior-preserving Following/page/shape spelling exists
   under the registered forms.** `rpcs.sql:6` defines `scope` using
   `select f.followee_id ... where f.follower_id = viewer union select viewer`
   and `stream as (select * from orig union all select * from repo)`.
   Its source comment expressly requires an original and each qualifying
   repost as **separate** cards. The attempted rewrite can retain that
   multiplicity with a two-branch union view, a Following view and point
   shapes; replacing UNION ALL with deduplication would fail.
   Public SELECT policies exist on posts/reposts/follows (`rls.sql:32/:44/:26`)
   and their writes are owner-conditioned. However, there are no immutable
   declarations: `post_upd` permits parent/time updates and `rep_upd` permits
   post/time updates. §3.4 Following requires immutable mapped columns and
   published public sources. Adding these restrictions changes allowed writes.
   The source accepts an explicit viewer and a caller-provided `lim`, and its
   continuation is exactly
   `before_ts is null or s.sort_ts < before_ts or (s.sort_ts = before_ts and
   s.sort_key < before_id)`, ordered by `s.sort_ts desc, s.sort_key desc`.
   Keys are `p:` plus post id versus `r:` plus user id and post id. §3.5 forbids
   this keyset predicate and supplies opaque page cursors; no registered alias
   proves identical lexical cross-branch ties/continuations or arbitrary-viewer
   behavior. Following also has background delivery/backfill rather than the
   source's current-state SQL result. CTE removal alone establishes none of
   those equalities. Attempted nodes are the CTE/UNION/joins, helper signature,
   sort/limit/keyset expressions, source publication/immutability, and shape
   projections. See A-FEED. The refusal is about these preserved behaviors,
   not a claim that UNION ALL or separate repost cards are themselves impossible.

**Ambiguity readings (the generated appendix lists every affected unit id).**

- **A-TEMPLATE / A-PARSER:** The freeze pins input bytes but does not pin a
  parser build or expand `{{P}}`. Use Postgres 17.4 via pglast 7.10 and the
  explicit source template convention; charge neither as a SQL rewrite.
- **A-CHILDREN:** Count explicit NOT NULL, NULL and DEFAULT Constraint nodes,
  along with columns and relational/check constraints. Do not mix this large
  denominator into top-level rates.
- **A-SYNTHETIC:** The literal AST includes inserted empty RETURN nodes.
  Include them, and show authored-only sensitivity separately.
- **A-DO / A-SQL-BODY:** §7 names executable PL/pgSQL and routine signatures;
  anonymous DO and SQL-language bodies are not clearly in the stop-rule body
  denominator. Report them separately and show both alternatives.
- **A-TYPES:** The exhaustive §3.1 table specifies bigint (53-bit), while §3.5
  gives varchar argument typmods. It does not register int4 ↔ bigint or
  varchar column ↔ text CHECK aliases. Refuse these unlisted stored spellings;
  do not silently add those aliases. This is a material classification reading.
- **A-KEYS:** §3.1 explicitly maps intrinsic `id snapback.id primary key`, and
  §7 explicitly registers UUID conversion. No text/numeric id conversion or
  natural/composite PRIMARY KEY → UNIQUE alias is registered. Refuse those
  units, while preserving the authored total-key facts when assessing probes.
- **A-CHECKS:** Admit only the stated constraint forms; arbitrary numeric or
  cross-column CHECK and `char_length`/regex substitutions are not invented
  aliases for registered text bounds or named formats.
- **A-UUID:** UUID identity conversion is assessed as a local identity spelling,
  preserving the same principal values; foreign-key/cascade behavior is a
  separate constraint unit. Failed surrounding routines are not used to bless
  a whole schema. The user/principal role is inferred from the named schema
  and auth.uid uses, not from any external application source.
- **A-UUID-SCOPE:** Astra replay casts incoming actor strings to uuid and builds
  dm pair keys from ordered UUID text. Read “no UUID-specific operation” across
  that identity path, so its UUID columns are refused rather than assuming an
  opaque identity-only conversion. An expression-local reading would differ.
- **A-PROBE-CLASS:** §3.3 says exact helpers are admitted/inlined, while §7 names
  inlining as rewrite work. Charge `rewritten`, with raw_refused false on the
  already recognized body/call. UUID signature conversion has raw_refused true.
- **A-REWRITE-SET:** Treat the explicit §3.7 null-safe equality rewrite as
  registered by the governing form table. Apply it only where the other
  operand is required (or the null arm already determines the result), so it
  cannot introduce a match between two nullable values. A §7-only reading of
  “following rewrites” could instead refuse these four body units.
- **A-NULL / A-NULL-OR:** Honor §3.7's uniform nullable-operand refusal. A
  nullable streamed aggregate or timestamp lacks permission to compare without
  an explicit non-null narrowing. Read `x IS NULL OR x > now()` as missing
  that explicit non-null narrowing; a flow-sensitive OR reading could admit
  it, but was not used silently.
- **A-BODY-CONTEXT:** Count child primitives independently of signature failure,
  but enforce their local type, pseudo-record, point-key, aggregate-audience,
  and read-scope constraints. A shape-only syntactic census would admit more;
  propagating every parent failure into every child would refuse more.
- **A-IN-LIST:** Read §3.7's explicit discussion of required/nullable IN operands
  as permitting required constant-list membership; do not label it an alias.
- **A-CONFLICT:** Only targetless DO NOTHING is registered; removing a target
  may absorb violations of another unique key, so no generic target-removal
  rewrite is assumed.
- **A-MULTI-VALUES:** §3.6's one-row Quarry insert does not register multi-row
  VALUES expansion. Refuse it without inventing a loop rewrite.
- **A-EXTENSION:** Treat the sole pgcrypto extension as dependency boilerplate;
  the frozen Grok SQL contains no cryptographic product use. External callers
  were deliberately not inspected.
- **A-SEARCH:** Nonunique B-tree indexes with no named merge reference are
  removable. GIN/tsvector indexes preserve a search dependency; no source
  evidence equates their token/normalization behavior to word-prefix search.
- **A-EXPIRY:** Moving the message SELECT-policy condition to expire_at changes
  more than that policy (notably update visibility/expiry behavior). Do not
  claim a behavior-preserving rewrite from the SELECT predicate alone.
- **A-NESTED-PROBE:** A key probe whose residual calls another probe is not a
  residual equality/null test in the finite §3.3 grammar; do not invent a
  chained authority rewrite for the poll policies.
- **A-BASELINE:** Follow the frozen §3 GAP marking, not later engine features.
  The actual global sequence would fail the per-parent rewrite independently.
- **A-COUNTER-SCOPE:** The named Astra idiom is assessed over observed manifested
  writers after its initialization. It passes locally; a universal SQL-owner,
  integer-range or full-surrounding-program reading can fail it. Muse fails
  even at the explicit policy-authorized product boundary. This unresolved
  reading must be settled before comparing families' totals.
- **A-WINDOW:** “Fixed intervals” does not reproduce runtime configuration,
  and the source's direct policy writer is part of coverage. A future design
  that replaces direct writes/configuration is outside the registered rewrite.
- **A-FEED:** Interpret preservation to include arbitrary viewer/limit inputs,
  exact continuation/tie behavior, mapped-column updates and current-state
  delivery, not merely a visually similar first page.

No ambiguity resolution is implied by these chosen readings. Resolve them
before unblinding the two families' totals; the frozen instrument remains
unchanged.


**Freeze verification.** Every original input hash matched before parsing; the rubric bytes occur verbatim in the RFC at the frozen commit (including its trailing blank line).

| Input | Expected = verified SHA-256 |
|---|---|
| pretest1/rubric-section7.md | `ed4b3f6136e8049d7132c11838a539caffa530aacecb6034d03bb9cfdc1fa7b5` |
| astra-supabase/schema.sql | `02431660c98991a7accaa483926696aea6d17db99ca0e49c62d9846cdfb10756` |
| astra-supabase/scripts/mutations.sql | `a84963b377a2335249e27affa592c2102eb9f93ff715bde2087a5c67d6f11a93` |
| astra-supabase/scripts/m7-migration.sql | `a5c0fd41ac8563e4736af3f6d7063e83ab72cb81c85202e0bcaf845b6efff3c6` |
| grok-supabase/server/schema.sql | `b23cece193f6159b6e4cba11dda22d4e6b5ebf645fa21d03b9897b7502cf9757` |
| muse-supabase/db/schema.sql | `0d79ea2989a573195048a2f7ce622b0eab4b9d8f7314fefaaf8a87c51c3c66ec` |
| muse-supabase/db/rls.sql | `9a377ea01ca41d62c2b94e6a350fbb4af811afba4b2755d14d6200d5cb9f3a09` |
| muse-supabase/db/functions.sql | `5695413ce5821ad53c8a69127d8b8d67e36e2257bdcd5e3fc780c64dc73cdf06` |
| muse-supabase/db/rpcs.sql | `627307bfcf8e6d0a3e3d09bb860c8bcc54073f2b49e13811e12df1e131f51423` |
| muse-supabase/db/migrate-m7.sql | `d49fad12aff4ce16af3f6a6e784ec37c9e30a60bfb258aa95f606fb3d4290034` |

Freeze descriptor SHA-256: `57823308b0f0e0b3e117fab97d8208be49903bf6206c7ae89b944e2f7ba04055`.
Full frozen RFC SHA-256: `d76a593c165809971ca9de1459af52fd25e0018ce99edeb2c1b89ea337d80dbc`.

**Verification and deliverables.** All nine files parse with PostgreSQL 17.4 via pglast 7.10. Both parser levels complete without parse errors. The ledger validates unique stable ids, legal classes, raw/post flags, required rewrite evidence, parent links and the worst-child rule. Re-running the parser/classifier/report produces identical artifact hashes. No LLP was touched; ref-check is therefore not required by this brief. No corpus/rubric, engine, other worktree, stash or remote ref was changed.

`units.jsonl`, `parse_corpus.py`, `classify.py`, `body-decisions.json`, `report.py`, `README.md`, `parse-receipt.json`, `freeze-hashes.json`, `interpretation.md`, `ambiguities.md`, and this summary are the reviewable record.
