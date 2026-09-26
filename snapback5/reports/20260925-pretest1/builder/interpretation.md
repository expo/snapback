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
