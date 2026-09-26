# Pre-test 1 classification

Instrument: rubric-section7.md (hash matches freeze.json) and rfc-4001.md §3.1–§3.7.
Parser: pglast 6.2, libpg_query PostgreSQL 16.1. Hashes of the rubric and the nine corpus files match freeze.json (see `verified-hashes.json`).
Muse sources were parsed after replacing the placeholder `{{P}}` with `ns_`. That substitution is not a classification. Counts use the substituted AST, whose statement boundaries match the frozen text.

## Denominators

- **Top-level:** one Postgres AST statement per file. A table or alter-column statement's class is the worst non-ignored child, and also `canonicalized` when `if not exists` is the creation alias and no child is worse. `create or replace` is on the signature, so a routine's top-level class is the worst of signature and body.
- **Body:** executable plpgsql statement nodes, plus one SQL-body statement per language-sql routine statement. Block and declaration wrappers are omitted. Parser-inserted returns with no source line are omitted. Anonymous `DO` bodies are included.
- **Column and constraint children:** each column, and each primary key, unique, check, foreign key, or exclusion constraint. `NOT NULL` and `DEFAULT` stay on the column. These denominators are not added to the top-level rate.
- **Signature:** one per routine. Reported separately from the top-level rate and the body rate. The routine's top-level class already includes the signature via worst-of.
- **Raw refusal:** class is `rewritten` or `refused` (the authored spelling is not admitted, canonicalized, or ignored).
- **Post-rewrite refusal:** class is `refused`.
- Ignored boilerplate stays in the denominator. A second rate excluding ignored statements is listed because §7 says "counted" without saying whether boilerplate is in the one-third base.

## Rates

| file | tier | n | admitted | canonicalized | rewritten | refused | ignored | raw | post-rewrite |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `astra-supabase/schema.sql` | top | 83 | 23 | 10 | 15 | 34 | 1 | 49/83 (0.5904) | 34/83 (0.4096) |
| `astra-supabase/schema.sql` | body | 5 | 0 | 0 | 5 | 0 | 0 | 5/5 (1.0000) | 0/5 (0.0000) |
| `astra-supabase/schema.sql` | column_constraint | 165 | 95 | 3 | 1 | 66 | 0 | 67/165 (0.4061) | 66/165 (0.4000) |
| `astra-supabase/schema.sql` | signature | 1 | 0 | 0 | 1 | 0 | 0 | 1/1 (1.0000) | 0/1 (0.0000) |
| `astra-supabase/scripts/mutations.sql` | top | 2 | 0 | 0 | 0 | 2 | 0 | 2/2 (1.0000) | 2/2 (1.0000) |
| `astra-supabase/scripts/mutations.sql` | body | 137 | 43 | 0 | 10 | 84 | 0 | 94/137 (0.6861) | 84/137 (0.6131) |
| `astra-supabase/scripts/mutations.sql` | column_constraint | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 0/0 |
| `astra-supabase/scripts/mutations.sql` | signature | 2 | 0 | 0 | 0 | 2 | 0 | 2/2 (1.0000) | 2/2 (1.0000) |
| `astra-supabase/scripts/m7-migration.sql` | top | 20 | 2 | 1 | 1 | 12 | 4 | 13/20 (0.6500) | 12/20 (0.6000) |
| `astra-supabase/scripts/m7-migration.sql` | body | 14 | 0 | 0 | 0 | 14 | 0 | 14/14 (1.0000) | 14/14 (1.0000) |
| `astra-supabase/scripts/m7-migration.sql` | column_constraint | 16 | 8 | 0 | 0 | 8 | 0 | 8/16 (0.5000) | 8/16 (0.5000) |
| `astra-supabase/scripts/m7-migration.sql` | signature | 3 | 0 | 0 | 0 | 3 | 0 | 3/3 (1.0000) | 3/3 (1.0000) |
| `grok-supabase/server/schema.sql` | top | 43 | 0 | 0 | 21 | 22 | 0 | 43/43 (1.0000) | 22/43 (0.5116) |
| `grok-supabase/server/schema.sql` | body | 3 | 0 | 0 | 0 | 3 | 0 | 3/3 (1.0000) | 3/3 (1.0000) |
| `grok-supabase/server/schema.sql` | column_constraint | 171 | 127 | 0 | 21 | 23 | 0 | 44/171 (0.2573) | 23/171 (0.1345) |
| `grok-supabase/server/schema.sql` | signature | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 0/0 |
| `muse-supabase/db/schema.sql` | top | 27 | 0 | 0 | 9 | 18 | 0 | 27/27 (1.0000) | 18/27 (0.6667) |
| `muse-supabase/db/schema.sql` | body | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 0/0 |
| `muse-supabase/db/schema.sql` | column_constraint | 169 | 97 | 8 | 0 | 64 | 0 | 64/169 (0.3787) | 64/169 (0.3787) |
| `muse-supabase/db/schema.sql` | signature | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 0/0 |
| `muse-supabase/db/rls.sql` | top | 98 | 49 | 0 | 8 | 1 | 40 | 9/98 (0.0918) | 1/98 (0.0102) |
| `muse-supabase/db/rls.sql` | body | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 0/0 |
| `muse-supabase/db/rls.sql` | column_constraint | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 0/0 |
| `muse-supabase/db/rls.sql` | signature | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 0/0 |
| `muse-supabase/db/functions.sql` | top | 21 | 0 | 0 | 0 | 16 | 5 | 16/21 (0.7619) | 16/21 (0.7619) |
| `muse-supabase/db/functions.sql` | body | 39 | 0 | 0 | 3 | 36 | 0 | 39/39 (1.0000) | 36/39 (0.9231) |
| `muse-supabase/db/functions.sql` | column_constraint | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 0/0 |
| `muse-supabase/db/functions.sql` | signature | 11 | 0 | 0 | 0 | 11 | 0 | 11/11 (1.0000) | 11/11 (1.0000) |
| `muse-supabase/db/rpcs.sql` | top | 14 | 0 | 0 | 0 | 12 | 2 | 12/14 (0.8571) | 12/14 (0.8571) |
| `muse-supabase/db/rpcs.sql` | body | 54 | 15 | 0 | 1 | 38 | 0 | 39/54 (0.7222) | 38/54 (0.7037) |
| `muse-supabase/db/rpcs.sql` | column_constraint | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 0/0 |
| `muse-supabase/db/rpcs.sql` | signature | 11 | 0 | 0 | 0 | 11 | 0 | 11/11 (1.0000) | 11/11 (1.0000) |
| `muse-supabase/db/migrate-m7.sql` | top | 46 | 4 | 1 | 1 | 26 | 14 | 27/46 (0.5870) | 26/46 (0.5652) |
| `muse-supabase/db/migrate-m7.sql` | body | 102 | 27 | 0 | 8 | 67 | 0 | 75/102 (0.7353) | 67/102 (0.6569) |
| `muse-supabase/db/migrate-m7.sql` | column_constraint | 27 | 13 | 1 | 0 | 13 | 0 | 13/27 (0.4815) | 13/27 (0.4815) |
| `muse-supabase/db/migrate-m7.sql` | signature | 9 | 0 | 1 | 0 | 8 | 0 | 8/9 (0.8889) | 8/9 (0.8889) |
| **overall** | top | 354 | 78 | 12 | 55 | 143 | 66 | 198/354 (0.5593) | 143/354 (0.4040) |
| **overall** | body | 354 | 85 | 0 | 27 | 242 | 0 | 269/354 (0.7599) | 242/354 (0.6836) |
| **overall** | column_constraint | 548 | 340 | 12 | 22 | 174 | 0 | 196/548 (0.3577) | 174/548 (0.3175) |
| **overall** | signature | 37 | 0 | 1 | 1 | 35 | 0 | 36/37 (0.9730) | 35/37 (0.9459) |

Post-rewrite rates excluding ignored units (numerator unchanged):

| slice | tier | post-rewrite / non-ignored | exceeds one third |
| --- | --- | --- | --- |
| astra-supabase/schema.sql | top | 34/82 (0.4146) | yes |
| astra-supabase/schema.sql | body | 0/5 (0.0000) | no |
| astra-supabase/scripts/mutations.sql | top | 2/2 (1.0000) | yes |
| astra-supabase/scripts/mutations.sql | body | 84/137 (0.6131) | yes |
| astra-supabase/scripts/m7-migration.sql | top | 12/16 (0.7500) | yes |
| astra-supabase/scripts/m7-migration.sql | body | 14/14 (1.0000) | yes |
| grok-supabase/server/schema.sql | top | 22/43 (0.5116) | yes |
| grok-supabase/server/schema.sql | body | 3/3 (1.0000) | yes |
| muse-supabase/db/schema.sql | top | 18/27 (0.6667) | yes |
| muse-supabase/db/schema.sql | body | 0/0 | no |
| muse-supabase/db/rls.sql | top | 1/58 (0.0172) | no |
| muse-supabase/db/rls.sql | body | 0/0 | no |
| muse-supabase/db/functions.sql | top | 16/16 (1.0000) | yes |
| muse-supabase/db/functions.sql | body | 36/39 (0.9231) | yes |
| muse-supabase/db/rpcs.sql | top | 12/12 (1.0000) | yes |
| muse-supabase/db/rpcs.sql | body | 38/54 (0.7037) | yes |
| muse-supabase/db/migrate-m7.sql | top | 26/32 (0.8125) | yes |
| muse-supabase/db/migrate-m7.sql | body | 67/102 (0.6569) | yes |
| overall | top | 143/288 (0.4965) | yes |
| overall | body | 242/354 (0.6836) | yes |

## Named idiom instances

### Muse `is_member`

Registered rewrite: inline the full-key probe, including `left_at is null`.

The helper body is:

```sql
select exists (select 1 from {{P}}members m
  where m.conversation_id = c and m.user_id = u and m.left_at is null);
```

`{{P}}members` primary key is `(conversation_id, user_id)`, so the two equalities cover one total unique key and `left_at is null` is a residual null test. §3.3 says this probe "is admitted as a rule" and that the residual blocks audience inversion (`E_SYNC` if the table is published). The frozen rubric also says the source corpus does not by itself require device replication, online-only is allowed, and `E_SYNC` alone is not a stop. No product brief in this frozen directory requires the membership rule to hold offline.

**Answer:** yes. After inlining, the policy spelling is an admitted full-key probe plus that residual. The helper's `u uuid` parameter is a separate unit: this family also contains `user_id::text` (feed) so the conditional UUID-to-`snapback.principal` rewrite is not applied to uuid columns and parameters. That type refusal does not remove the inlined rule spelling §3.3 names.

### Muse `bump_counters` and Astra `clqfa_like_counter`

Registered rewrite: generated `snapback.count` columns, with the same insert/delete behavior and visibility; filters use the registered maintain predicate. Drift or side effects the declaration cannot express refuse the bundle.

Astra `clqfa_like_counter`:

```sql
if TG_OP='INSERT' then update clqfa_posts set like_count=like_count+1 where id=NEW.post; return NEW;
else update clqfa_posts set like_count=like_count-1 where id=OLD.post; return OLD; end if;
```

Trigger `clqfa_likes_counter` is `after insert or delete` on `clqfa_likes`. `clqfa_likes.post` references `clqfa_posts(id)`, one contributor, no filter, no `greatest` floor, no second write. Visibility is the `like_count` column on the post row.

**Astra answer:** yes. The bundle rewrites to `like_count bigint generated always as (snapback.count('clqfa_likes', by => 'post')) stored`. Ambiguity: an `UPDATE` of `clqfa_likes.post` would be maintained by `snapback.count` and is not maintained by this trigger. No such writer appears in the frozen Astra files.

Muse `bump_counters` delete path:

```sql
else update {{P}}posts set like_count = greatest(like_count - 1, 0) where id = OLD.post_id; end if;
```

The same `greatest(… - 1, 0)` floor is used for `repost_count` and `reply_count`. Reply inserts are conditional on `parent_id is not null`.

**Muse answer:** no. The floor is a side effect `snapback.count` does not express. The three triggers (`{{P}}trg_like_c`, `{{P}}trg_repost_c`, `{{P}}trg_reply_c`) and the function stay refused after the registered rewrite.

### Muse `enforce_message_windows`

Registered rewrite: mutation-side `raise` checks with fixed intervals, and `edited` assignments in every writer, including privileged or job paths the trigger covered. An uncovered writer or a changed boundary refuses.

```sql
edit_s := coalesce(({{P}}cfg_windows()->>'editWindowSeconds')::int, 900);
del_s := coalesce(({{P}}cfg_windows()->>'deleteForEveryoneWindowSeconds')::int, 3600);
if (NEW.body is distinct from OLD.body) and not NEW.deleted and not OLD.deleted then
  if extract(epoch from (now() - OLD.created_at)) > edit_s then
    raise exception 'CLQFM_EDIT_WINDOW_EXCEEDED';
  end if;
  NEW.edited := true; NEW.edited_at := now();
end if;
```

`cfg_windows()` defaults to `'{"editWindowSeconds":900,..."deleteForEveryoneWindowSeconds":3600,...}'` and otherwise reads `{{P}}config`. The trigger is `before update` on `{{P}}messages` and returns immediately when `NEW.purged`.

Writers in the frozen SQL: `expire_tick` sets `purged = true, body = '', media_path = ''` (the purge bypass), and policy `{{P}}msg_upd` allows the sender to `UPDATE` the row directly. There is no edit or delete mutation that could host the raise.

**Answer:** no. A fixed interval would change the boundary whenever `{{P}}config` differs from 900/3600, and a direct update under `msg_upd` would be an uncovered writer. `NEW.edited` / `NEW.edited_at` assignments would not run on that path.

### Muse `feed`

Registered rewrite: Following + page + shape, only if public-source admission, audience, duplicates, ranking, and continuation agree. CTE removal alone is not equivalence.

```sql
with scope as (
  select f.followee_id as who from {{P}}follows f where f.follower_id = viewer
  union select viewer
),
orig as ( … where p.parent_id is null and (tab = 'global' or p.author_id in (select who from scope)) ),
repo as ( … where p.parent_id is null and (tab = 'global' or r.user_id in (select who from scope)) ),
stream as (select * from orig union all select * from repo)
… where (before_ts is null or s.sort_ts < before_ts or (s.sort_ts = before_ts and s.sort_key < before_id))
order by s.sort_ts desc, s.sort_key desc
limit lim
```

The comment in `rpcs.sql` says an original and each qualifying repost "surface as SEPARATE cards". `union all` matches that duplicate behavior. Ranking is repost time for reposts and post time for originals.

Following admission in §3.4 requires published public sources, owner-only writes, immutable mapped columns, and the declared edge key. The frozen Muse SQL has `using (true)` select policies on posts, follows, and reposts, but no `snapback.publish` call. There is no `snapback.immutable` call, and `{{P}}post_upd` is `using (auth.uid() = author_id) with check (auth.uid() = author_id)`, so the author can update mapped columns. `feed(viewer uuid, tab text, …)` takes a caller-supplied viewer; §3.7 refuses that parameter with an `auth.uid()` rewrite, which changes results whenever `viewer` is not the session principal. `tab = 'global'` reads every public post, which is not the Following audience. Continuation is a keyset predicate; §3.5 refuses a keyset predicate on a cursor.

**Answer:** no. Duplicates can be described by `union all`, but publication, immutability, the global tab, the viewer parameter, and keyset continuation do not agree with Following + page + shape.

## Stop-rule evaluation

Post-rewrite top-level refusals: 143/354 = 0.4040. One third of 354 is 118.0000. Exceeds one third: **yes** (`refused * 3 > n` is 429 > 354).
Post-rewrite body refusals: 242/354 = 0.6836. One third of 354 is 118.0000. Exceeds one third: **yes** (`refused * 3 > n` is 726 > 354).
Excluding ignored units, top-level is 143/288 (0.4965) (exceeds: yes) and body is 242/354 (0.6836) (exceeds: yes).
Named instances without a behavior-preserving admitted spelling after the registered rewrite: Muse `bump_counters`; Muse `enforce_message_windows`; Muse `feed`. Muse `is_member` and Astra `clqfa_like_counter` have one.
The one-third comparisons and the three negative instance answers are the stop-rule predicates in §7. Raw-refusal rates are the other census and are not the stop line.

## Ambiguities

25 distinct ambiguity texts on 3678 units.

- (67) PRIMARY KEY is classified as admitted uniqueness. §3.2 lists unique (…); primary key is the intrinsic-id spelling. Composite primary keys were not refused for that wording difference. Examples: `astra-supabase/schema.sql:0:1`, `astra-supabase/schema.sql:2:1`, `astra-supabase/schema.sql:4:1`, `astra-supabase/schema.sql:6:5`, `astra-supabase/schema.sql:8:1`, `astra-supabase/schema.sql:12:5`, `astra-supabase/schema.sql:13:5`, `astra-supabase/schema.sql:14:1`, … (67 units).
- (57) UUID-specific operations were taken at family scope when a uuid column is cast or the family contains ::uuid / gen_random_uuid. Examples: `astra-supabase/schema.sql:0`, `astra-supabase/schema.sql:0:0`, `astra-supabase/schema.sql:6`, `astra-supabase/schema.sql:6:0`, `astra-supabase/schema.sql:6:2`, `astra-supabase/schema.sql:8`, `astra-supabase/schema.sql:8:2`, `astra-supabase/schema.sql:12`, … (57 units).
- (38) §3.1 names bigint as the SQL spelling of Quarry int and does not list integer/int4 as an alias. Examples: `astra-supabase/schema.sql:25:4`, `astra-supabase/schema.sql:57`, `astra-supabase/schema.sql:57:1`, `astra-supabase/schema.sql:80`, `astra-supabase/schema.sql:80:0`, `astra-supabase/scripts/m7-migration.sql:2`, `astra-supabase/scripts/m7-migration.sql:2:0`, `grok-supabase/server/schema.sql:3`, … (38 units).
- (35) A no-action REFERENCES on a text or uuid column was refused because the normative reference spelling types the column as snapback.id. The ≈ note that Snapback does not enforce existence was not read as admitting a text foreign key. Examples: `astra-supabase/schema.sql:6:1`, `astra-supabase/schema.sql:6:3`, `astra-supabase/schema.sql:8:3`, `astra-supabase/schema.sql:8:10`, `astra-supabase/schema.sql:12:1`, `astra-supabase/schema.sql:12:3`, `astra-supabase/schema.sql:13:1`, `astra-supabase/schema.sql:13:3`, … (35 units).
- (18) Argument integer was refused because §3.1 spells int as bigint; varchar typmod is the only extra argument-type rule. Examples: `muse-supabase/db/rpcs.sql:5`, `muse-supabase/db/rpcs.sql:5:0`, `muse-supabase/db/rpcs.sql:6`, `muse-supabase/db/rpcs.sql:6:0`, `muse-supabase/db/rpcs.sql:7`, `muse-supabase/db/rpcs.sql:7:0`, `muse-supabase/db/rpcs.sql:9`, `muse-supabase/db/rpcs.sql:9:0`, … (18 units).
- (17) Ordered comparisons and boolean tests on parameters and locals are refused as nullable; an earlier IF that narrows nullness is a separate statement and is not treated as narrowing. Examples: `astra-supabase/scripts/mutations.sql:0:15`, `astra-supabase/scripts/mutations.sql:0:54`, `astra-supabase/scripts/mutations.sql:0:82`, `astra-supabase/scripts/mutations.sql:0:88`, `astra-supabase/scripts/mutations.sql:0:90`, `muse-supabase/db/rpcs.sql:4:8`, `muse-supabase/db/rpcs.sql:4:12`, `muse-supabase/db/rpcs.sql:4:15`, … (17 units).
- (15) UNIQUE matches §3.2. A nullable unique column still allows multiple nulls in Postgres; that difference is not given its own class. Examples: `astra-supabase/schema.sql:0:3`, `astra-supabase/schema.sql:0:5`, `astra-supabase/schema.sql:20:9`, `grok-supabase/server/schema.sql:2:6`, `grok-supabase/server/schema.sql:2:7`, `grok-supabase/server/schema.sql:3:17`, `grok-supabase/server/schema.sql:18:5`, `muse-supabase/db/schema.sql:0:4`, … (15 units).
- (13) check (col in (…)) is the registered alias of enum(…) (§3.7). A commented unique code is not involved. Examples: `astra-supabase/schema.sql:8:5`, `astra-supabase/schema.sql:20:3`, `astra-supabase/schema.sql:21:5`, `muse-supabase/db/schema.sql:2:6`, `muse-supabase/db/schema.sql:10:3`, `muse-supabase/db/schema.sql:10:13`, `muse-supabase/db/schema.sql:11:5`, `muse-supabase/db/schema.sql:13:7`, … (13 units).
- (11) if not exists is a registered creation alias (§7). The top-level class is the worst of that alias and the non-ignored children, not the children alone. Examples: `astra-supabase/schema.sql:2`, `astra-supabase/schema.sql:4`, `astra-supabase/schema.sql:33`, `astra-supabase/schema.sql:35`, `astra-supabase/schema.sql:36`, `astra-supabase/schema.sql:39`, `astra-supabase/schema.sql:41`, `astra-supabase/schema.sql:42`, … (11 units).
- (8) No snapback.immutable call exists, so using (E) [with check (E)] is not the single-image alias; it is the composed old/next rule. Primary keys were not treated as implicitly immutable. Examples: `muse-supabase/db/rls.sql:23`, `muse-supabase/db/rls.sql:35`, `muse-supabase/db/rls.sql:77`, `muse-supabase/db/rls.sql:91`, `muse-supabase/db/rls.sql:93`, `muse-supabase/db/rls.sql:95`, `muse-supabase/db/rls.sql:97`, `muse-supabase/db/migrate-m7.sql:36`.
- (8) §3.2 admits unique (…) as a constraint. A non-partial unique index has the same catalog effect, but §7's index row does not register that conversion. Examples: `astra-supabase/schema.sql:51`, `astra-supabase/schema.sql:70`, `astra-supabase/schema.sql:82`, `grok-supabase/server/schema.sql:5`, `grok-supabase/server/schema.sql:12`, `grok-supabase/server/schema.sql:14`, `grok-supabase/server/schema.sql:25`, `grok-supabase/server/schema.sql:38`.
- (8) §3.5 honors argument typmods such as varchar(100); §3.1's column row does not. This column was classified from the column row. Examples: `muse-supabase/db/schema.sql:0:8`, `muse-supabase/db/schema.sql:0:9`, `muse-supabase/db/schema.sql:0:10`, `muse-supabase/db/schema.sql:2:4`, `muse-supabase/db/schema.sql:10`, `muse-supabase/db/schema.sql:10:4`, `muse-supabase/db/schema.sql:10:5`, `muse-supabase/db/migrate-m7.sql:0:3`.
- (6) Return integer was refused because §3.1 spells int as bigint. Examples: `muse-supabase/db/rpcs.sql:3`, `muse-supabase/db/rpcs.sql:3:0`, `muse-supabase/db/rpcs.sql:4`, `muse-supabase/db/rpcs.sql:4:0`, `muse-supabase/db/migrate-m7.sql:14`, `muse-supabase/db/migrate-m7.sql:14:0`.
- (5) The probed principal column is a separate unit and may be a refused uuid column; §3.3 names Muse's is_member probe, with left_at is null, as an admitted rule. Examples: `muse-supabase/db/rls.sql:49`, `muse-supabase/db/rls.sql:55`, `muse-supabase/db/rls.sql:57`, `muse-supabase/db/rls.sql:61`, `muse-supabase/db/rls.sql:63`.
- (5) || was refused rather than rewritten because list concatenation cannot be separated from string concatenation in this AST. Examples: `astra-supabase/scripts/mutations.sql:0:46`, `muse-supabase/db/migrate-m7.sql:14:4`, `muse-supabase/db/migrate-m7.sql:16:23`, `muse-supabase/db/migrate-m7.sql:16:27`, `muse-supabase/db/migrate-m7.sql:16:28`.
- (3) The probed principal column is a separate unit and may be a refused uuid column; §3.3 names Muse's is_member probe, with left_at is null, as an admitted rule. No snapback.immutable call exists, so using (E) [with check (E)] is not the single-image alias; it is the composed old/next rule. Primary keys were not treated as implicitly immutable. Examples: `muse-supabase/db/rls.sql:53`, `muse-supabase/db/rls.sql:59`, `muse-supabase/db/rls.sql:65`.
- (2) ALTER … DROP CONSTRAINT IF EXISTS was not classified as DROP … IF EXISTS boilerplate. The boilerplate row covers DROP statements; this ALTER changes a constraint. A later ADD may restore a different check. Examples: `muse-supabase/db/migrate-m7.sql:6`, `muse-supabase/db/migrate-m7.sql:6:0`.
- (2) For text, Postgres char_length and length both count characters. Only length(col) is the §3.1 spelling, so this check was refused. Examples: `muse-supabase/db/schema.sql:13:20`, `muse-supabase/db/migrate-m7.sql:0:6`.
- (2) for i in a..b is the inclusive spelling and is lowered as written (§3.6), not as Quarry range. Examples: `muse-supabase/db/migrate-m7.sql:16:16`, `muse-supabase/db/migrate-m7.sql:16:25`.
- (2) on conflict (key) do nothing was not rewritten to targetless do nothing, because those arbiters differ. Examples: `astra-supabase/scripts/mutations.sql:0:9`, `muse-supabase/db/migrate-m7.sql:17:12`.
- (1) A for-loop select that is not a point read was still admitted as §3.6's planned select when its expressions are in the subset. Examples: `muse-supabase/db/rpcs.sql:4:17`.
- (1) create or replace is a registered creation alias (§7) and the rest of the signature matches a routine kind. Examples: `muse-supabase/db/migrate-m7.sql:9:0`.
- (1) for all is the admitted multi-effect spelling; without snapback.immutable it is not canonicalized to a single-image update. Examples: `muse-supabase/db/rls.sql:81`.
- (1) if not exists is a creation alias for objects §3 admits. It was not applied to canonicalize a sequence the sequence row refuses. Examples: `astra-supabase/schema.sql:65`.
- (1) §7 ignores an extension supplying only UUID generation. pgcrypto can supply gen_random_uuid, but it is a general crypto extension and no call site in the frozen corpus shows that it is used only for that. Examples: `grok-supabase/server/schema.sql:0`.

## Parser and counting choices

- `NOT NULL` and `DEFAULT` are column attributes, not extra constraint units. Primary key, unique, check, and foreign key are constraint units, including column-level ones.
- Language-sql bodies are one body unit per parsed SQL statement. §7 names plpgsql statement nodes; dropping these bodies would omit `is_member` and `feed` from the body denominator.
- `DO` bodies are in the body denominator. The `DO` statement itself is one refused top-level unit.
- Integer columns are refused because §3.1's spelling is `bigint`, except Astra `like_count`, which the successful count rewrite replaces.
- `to authenticated` is ignored inside the policy and is not its own unit (§3.3). `GRANT`/`REVOKE` and `SET search_path` are ignored units (§3.7 C).
- No `snapback.immutable` call appears. `using (E) with check (E)` was not canonicalized to the single-image update alias.
