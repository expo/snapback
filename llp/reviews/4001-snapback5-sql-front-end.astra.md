# LLP 4001 design review — Astra (gpt-6-astra), reasoning effort max

**Date:** 2026-09-25. **Revision reviewed:** initial (`8a2637efa5`, §11 ruling at `185600d8e2`). **Mode:** blind, read-only, over a detached worktree; `codex exec -m gpt-6-astra -c model_reasoning_effort=max`. **Provider/runtime:** OpenAI Codex CLI on the black M5 Max. **Redacted:** no. **Brief:** `~/projects/snapback-sb5-reviews/4001.brief.md`, shared verbatim with the Grok and Opus reviewers.

## Verbatim review

Reviewer: **GPT-6 Astra, GPT family**. Read-only review of [LLP 4001](/Users/ccheever/projects/snapback-sb5-reviews/r4001-astra/llp/4001-snapback5-sql-front-end.rfc.md) at checkout `8a2637efa5442e605f63ea85a520495e87514231`. No files changed, agents spawned, repositories cloned, or commands run on another machine.

The experiment is worth pursuing, but this revision is not ready to implement. Several advertised forms cannot reach the existing IR, several ordinary-looking SQL forms would change meaning, and the evaluation can pass when the learning charge has only been renamed.

What is sound: keeping one execution engine and one predictor; putting the parser outside the device; preserving completeness and disclosure rules; landing shared capabilities in both arms; and testing familiarity before funding the compiler. LLP 0329 supports preserving an analyzable program and its capability guarantees. SQL can provide that program’s surface. It does not require arbitrary PL/pgSQL execution.

1. **High — Summary, §1, §10: the evidence motivates an experiment, but does not isolate a language-syntax effect.**

   The record supports the quoted frequency tally and the Supabase 94 observation. It does not establish that eight charges concern unfamiliar spelling that survives unchanged semantics. The LANGUAGE examples include “restricted joins/scans,” “constrained expressiveness,” and “fewer language escape routes.” Those can describe capabilities, not vocabulary. The summary’s “targets the largest” also overstates its own tally: language is second to bounds.

   [LLP 3000.012 §2](/Users/ccheever/projects/snapback-sb5-reviews/r4001-astra/llp/3000.012-application-still-owns-derived-data.research.md:171) explicitly treats learning cost as overlapping other charges. Its explanation of the strongest categories is that declarations transfer work to the platform; “matches a prior” is an additional hypothesis introduced here.

   The Supabase evidence supports both familiarity **and composability**. The retained Astra lane used ordinary relational machinery: composite keys, joins, CTEs, `UNION ALL`, correlated aggregates, `SELECT INTO`, assignments, `FOUND`, `FOR UPDATE`, and `INSERT … SELECT`. Its canonical mutation is substantially broader than §3.5. See the [score record](/Users/ccheever/projects/snapback-sb5-reviews/r4001-astra/benchmarks/runs/2026-09-05-clique-full-3x3/holistic-scores.json) and [pre-M7 mutation source](/Users/ccheever/clique-full-20260905/lanes/astra-supabase/m7/inherited/scripts/mutations.sql:1).

   **Counterexample:** a builder recognizes SQL immediately, then cannot express their ordinary digest or feed query without learning the same structural restrictions. Familiarity improves while `data_modeling` does not.

   **Smallest fix:** state the premise as a hypothesis about transfer of prior knowledge. Publish a census of the Supabase lane’s actual forms, identifying which remain available, require a rewrite, or are refused. Treat preserved expressiveness and familiar spelling as separate explanatory variables.

2. **Blocker — §3 example, §3.2, §5: the time-based policy cannot lower to the existing rule language.**

   `messages_edit` contains `now() - at <= interval '15 minutes'`. The current rule binder admits equality, inequality, boolean composition, and indexed probes. Its `RuleTerm` has no clock or arithmetic term; `RuleExpr` has no ordered comparison. This applies to write rules too. See [rule binding](/Users/ccheever/projects/snapback-sb5-reviews/r4001-astra/snapback4/crates/snapback4-lang/src/bind/schema.rs:327) and [schema IR](/Users/ccheever/projects/snapback-sb5-reviews/r4001-astra/snapback4/crates/snapback4-core/src/schema.rs:546).

   Classifying a policy as server-only does not make an unsupported rule executable. “Any other `select` policy is admitted for online reads” similarly promises more than the rule IR admits.

   **Counterexample:** the implementer faithfully lowers `messages_edit` and must either extend the engine, reject the RFC’s example, or silently move enforcement elsewhere.

   **Smallest fix:** specify the complete admitted **policy-expression** subset separately from device admission. Express the edit deadline as an explicit mutation guard, as the existing engine supports, and preserve enforcement at every relevant mutation entry point. Do not promise arbitrary SQL policies on the server.

3. **High — §3.1–§3.2, §3.7: RLS-shaped syntax does not yet have a defined RLS-compatible meaning.**

   `WITH CHECK (read_up_to = old.read_up_to)` does not have a standard policy binding for `old`. PostgreSQL’s old-row `USING` and proposed-row `WITH CHECK` expressions are separate evaluations; they do not provide a general cross-image transition predicate. Omitting `WITH CHECK` on an UPDATE policy also reuses `USING` against the proposed row. Restrictive policies require a permissive grant. These details matter to lowering. [PostgreSQL CREATE POLICY](https://www.postgresql.org/docs/18/sql-createpolicy.html)

   Combining complete policies with OR is insufficiently precise. Two permissive UPDATE policies require the independently combined old-row and new-row gates. For example, policies admitting draft rows and published rows can collectively admit draft→published even when neither individual old/new pair does.

   There is another substantial difference: the example’s `members_read` queries `members` from its own policy. With normal RLS enforcement, this is recursive. Quarry’s rule probes explicitly inspect raw witnesses without recursively applying the probed table’s read rule. [Quarry probe implementation](/Users/ccheever/projects/snapback-sb5-reviews/r4001-astra/snapback4/crates/snapback4-core/src/engine/read.rs:120), [PostgreSQL recursion example](https://www.postgresql.org/message-id/CALgFm5hwf%3DHRFCcs7ZUyB6oNpmRRthVH0YmFm%3DZ3HxvYxCCFEQ%40mail.gmail.com)

   **Smallest fix:** define policy combination algebra, omitted-clause behavior, enforcement defaults, role handling, and probe authority. Give cross-image constraints an explicitly documented Snapback form. List raw authorization probes and automatically enforced policies as semantic extensions.

4. **High — §3.1: `REFERENCES`, general `CHECK`, and inferred immutability overpromise schema semantics.**

   Quarry references are typed IDs. They do not enforce target existence or prevent target deletion. PostgreSQL foreign keys do enforce referential integrity. [Current type guide](/Users/ccheever/projects/snapback-sb5-reviews/r4001-astra/snapback4/crates/snapback4-lang/src/guide/types.rs:36), [PostgreSQL constraints](https://www.postgresql.org/docs/18/ddl-constraints.html)

   Likewise, the engine has specific constraint forms; it does not have a general SQL row-check expression in its schema IR. Recognizing text bounds and enums does not establish support for arbitrary `CHECK`.

   Policies also are not column-update allowlists. An owner UPDATE policy that never mentions `created_at` can still admit changing it. Conversely, no user update policy does not establish immutability against system jobs, which bypass rules while remaining subject to constraints.

   **Counterexample:** lower `conversation_id … REFERENCES conversations(id)` to a Quarry reference, insert a missing parent ID, or delete the parent. The accepted program violates the SQL contract. Infer `profiles.createdAt` immutable from an owner policy and the inference is unjustified.

   **Smallest fix:** enumerate supported constraint patterns; reject everything else. Give typed references and immutable columns explicit meanings and spellings. If ordinary foreign-key semantics are required, make them shared engine work before this comparison.

5. **Blocker — §3 example, §3.3: maintained `min`/`max` and the illustrated `latest` column do not exist in the promised target engine.**

   `MaintainKind` contains **Count and Sum only**. Scalar `Builtin::Min`/`Max` does not supply maintained extrema. The maintained-column binder also refuses expiring sources, while the example derives `conversations.latest` from expiring `messages`. [Maintained-column lowering](/Users/ccheever/projects/snapback-sb5-reviews/r4001-astra/snapback4/crates/snapback4-lang/src/bind/columns.rs:14)

   The illustrated generated expression is not an ordinary PostgreSQL generated column either: it reaches another table and performs an aggregate/window computation. PostgreSQL generated expressions cannot reference other rows or use subqueries. [Generated columns](https://www.postgresql.org/docs/18/ddl-generated-columns.html)

   **Smallest fix:** restrict this bet’s maintained aggregate promise to the actual shared engine’s forms. Remove or replace `latest` in the example. Add the maintained-column extension to §3.7—it is currently referenced there by the example but absent from the table. Any maintained-extrema addition belongs in the shared baseline first.

6. **High — §3.3: the target’s attributed aggregates are not ordinary maintained SQL joins.**

   `receivedLikes`, `dailyLikes`, `receivedReplies`, and `receivedReposts` use recorded attribution. The engine captures the referenced immutable value when the contribution is inserted, including a captured null for an absent target. Deleting or recreating that target does not change prior contributions. A rebuilt SQL join ordinarily uses the current target. [Maintains guide](/Users/ccheever/projects/snapback-sb5-reviews/r4001-astra/snapback4/crates/snapback4-lang/src/guide/maintains.md:153)

   **Counterexample:** a like records Alice’s authorship; the referenced post disappears and its ID is later reused. Quarry continues crediting Alice. A materialized query joining current `posts` either drops the contribution or credits the replacement.

   There are additional required translations: `day(.at)` is a UTC epoch ordinal, not an unspecified timezone-sensitive SQL day expression; a keyed aggregate lookup returns zero for an authorized absent group, whereas selecting a missing grouped SQL row does not.

   **Smallest fix:** spell out recorded-attribution semantics as an extension, including activation and null captures. Define calendar expressions and zero-default lookups explicitly. Show SQL for all nine aggregate declarations in the committed target, not just a generic `GROUP BY` description.

7. **High — §3 example, §3.3, §3.7: the LLP 3000.015 mapping loses important parts of all three additions.**

   The additions are plausible compiler mappings once their shared implementation exists, but the SQL contract must carry their complete semantics:

   | Addition | Concrete gap | Smallest correction |
   |---|---|---|
   | `written by` | §3.7 describes write authority but omits default owner-private projection and `readable by audience`. A member’s `SELECT *`, shape, cursor, or write result must not expose another member’s private mark. | Document private projection and provide the audience-readable opt-out. Demonstrate an ordinary member advancing their own mark despite the separate admin row-update policy. |
   | `sequence by` | A reader could implement one sequence per column/table. B2 requires one counter per parent shared across `members.joinedAt` and `messages.ordinal`, with server assignment and provisional prediction. | Specify parent identity, cross-table counter sharing, supplied-value refusal, immutability, and provisional reordering. |
   | Row-keyed unread | The illustrated inner join has no group for a member with zero matching messages. B3 defines a maintained value per member. Large mark advances may settle asynchronously, contradicting an unconditional “maintained in the writing transaction.” | Use zero-preserving SQL—e.g. a left join with predicates in `ON` and `count(x.id)`—and state the pending/recount contract. |

   These are observable differences, not implementation details. [LLP 3000.015](/Users/ccheever/projects/snapback-sb5-reviews/r4001-astra/llp/3000.015-shared-baseline-for-snapback5.spec.md:31)

8. **High — §3.3–§3.4: planned views, shapes, and Following need distinct, exact mappings.**

   `activity` can map cleanly to a two-branch **`UNION ALL`**, provided the compiler retains branch identity and source ID for ordering and cursors. An ordinary `UNION` promises duplicate elimination; it is not interchangeable.

   `postCard` and `activityCard` can map to correlated point subqueries and static object construction. But a Quarry nested lookup preserves its outer row when the nested row is absent or hidden. The example’s inner join to `profiles` instead removes the message. Lowering that join merely to a shape field would change SQL meaning. A left join or scalar row subquery expresses the intended nullable relationship.

   Following additionally requires the actual recognizer’s two branches, mapped reference/actor/time/flag fields, declared edge key, public fully synced sources, and immutability constraints. “Sources readable by everyone” is incomplete. Its delivered-inbox semantics, background backfill, and populated-source activation/redefinition refusals also differ from ordinary materialized views. PostgreSQL materialized views contain the stored result populated at creation or refresh, not automatically a separate result for every reader. [Following recognizer](/Users/ccheever/projects/snapback-sb5-reviews/r4001-astra/snapback4/crates/snapback4-lang/src/bind/feed_view.rs:54), [PostgreSQL materialized views](https://www.postgresql.org/docs/current/sql-creatematerializedview.html)

   **Smallest fix:** provide separate admitted grammars for planned unions, nullable point shapes, aggregate maintenance, and per-reader Following. Make their authorization, identity, maintenance, and lifecycle differences explicit.

9. **High — §3.4: the query grammar cannot express the complete committed target.**

   The straightforward pages—`home`, `global`, `trending`, `userPosts`, `thread`, `people`, `history`, and `searchAll`—have plausible mappings through the existing planner, subject to the preceding constraints.

   Two target queries do not fit:

   - `socialProfile` performs a required point lookup with `NOT_FOUND`, then returns an enriched single object.
   - `insights` builds seven daily entries and returns a record containing scalar totals and a list.

   Neither is a `returns setof <view or table>` function containing the specified single SELECT. Mentioning `json_build_object` does not define range generation, list aggregation, scalar/composite returns, required-point refusals, or helper composition.

   Cursor mapping is also implicit: `history` never references `c`. PostgreSQL would ignore that unused argument; Snapback must attach it to a particular page site. Multiple pages, nested shapes, tie ordering, and continuation ownership need a rule.

   **Smallest fix:** specify scalar, optional-row, record, and list results, plus an analyzable read-only procedural or SQL-expression subset sufficient for both queries. Define exactly one returned page’s cursor binding and preserve the binder’s returned-shape metadata and `pending` propagation. [Target queries](/Users/ccheever/projects/snapback-sb5-reviews/r4001-astra/snapback4/crates/snapback4-sim/tests/fixtures/intent-clique.q:94), [shape contract](/Users/ccheever/projects/snapback-sb5-reviews/r4001-astra/snapback4/crates/snapback4-lang/src/guide/shapes.rs:91)

10. **High — §3.5: admitted SQL DML is broader than Quarry’s write statements, and some apparent equivalents have different outcomes.**

   The core has keyed updates/deletes and specific conflict behavior, not a generic relational UPDATE/DELETE operator. [Statement IR](/Users/ccheever/projects/snapback-sb5-reviews/r4001-astra/snapback4/crates/snapback4-core/src/ir.rs:103)

   **Counterexamples:**

   - `UPDATE messages … WHERE conversation_id = c` addresses a population; it is not one keyed `WriteTarget`.
   - `UPDATE … WHERE id = missing` ordinarily affects zero SQL rows; Quarry’s keyed update returns `NOT_FOUND`.
   - A key plus an extra predicate normally filters SQL updates; Quarry’s conditional update can refuse with `E_CONFLICT`.
   - `INSERT INTO members … ON CONFLICT(id) DO NOTHING` does not suppress a conflict on `(conversation_id, principal)`. Mapping it to generic `InsertIfAbsent` does not preserve that distinction.
   - General `DO UPDATE SET` expressions can require existing-row values and a distinct insert expression; that is more than renaming one upsert statement.

   Adding pre-reads to emulate these behaviors can change hidden-row disclosure, absence proofs, metering, and prediction. The existing write binder deliberately avoids some such pre-reads.

   **Smallest fix:** define exact admitted DML patterns and their success/refusal/return contracts. Preserve `createPost`, `setLike`, and `setFollow` using those patterns. For each non-equivalent SQL form, either implement its semantics with a demonstrated safe lowering or document and clearly mark the deviation.

11. **Blocker — §3.5–§3.6: mutation, helper, and job classification is missing, and the subset cannot write the target job.**

   Both mutations and jobs are PL/pgSQL functions. Nothing identifies which function becomes `ProgramKind::Mutation` versus `Job`. This decides whether execution is atomic as the viewer or chunked as the system, and whether the operation is client-callable.

   **Counterexample:** a `VOLATILE` function with a table loop could be a client mutation or a scheduled digest. Inferring “job” from its loop could grant system authority; inferring “mutation” from volatility could expose or refuse the digest.

   The subset also omits assignment statements. `daily` needs `unreadChats := unreadChats + 1` and `unreadMessages := unreadMessages + n`. Existing Quarry helpers, scalar bindings, and controlled reads need mappings too. The illustrative `send` additionally uses an undeclared query-loop variable `p`.

   A job’s semantics cannot be described simply as “a function with loops”: only admitted top-level stable sweeps chunk; inner loops share the transaction; loop-carried state cannot cross commits; and replayed preludes must be safe. These are substantial departures from a function’s ordinary transaction behavior. [Jobs guide](/Users/ccheever/projects/snapback-sb5-reviews/r4001-astra/snapback4/crates/snapback4-lang/src/guide/jobs.rs:29), [PostgreSQL transaction control](https://www.postgresql.org/docs/18/plpgsql-transactions.html)

   **Smallest fix:** introduce an explicit operation-kind declaration, preserving authority and API exposure. Complete the procedural grammar with assignments, planned bindings, branches, returns, and helper calls. Show the entire target `daily` function and its chunk boundaries.

12. **High — §3.6: schedules and effects lack faithful registration semantics.**

   The schedule IR stores a fixed period and offset, a target, and optional service identity. It does not store a general cron calendar or arbitrary argument expressions.

   **Counterexample:** `'0 8 1 * *'` cannot become a fixed millisecond period. Even the illustrated daily command differs: if execution starts at 08:07, `now()` supplies 08:07, whereas the engine’s `periodEnd` is the scheduled boundary. That changes digest membership and its permanent once key.

   The target’s `every 2m` is straightforward to spell, but general cron syntax needs a restricted contract. `cron.schedule` is also an extension API, with its own execution behavior. [pg_cron](https://github.com/citusdata/pg_cron)

   `CREATE TYPE push AS (…)` declares a composite type in PostgreSQL, not an effect. Its use as effect registration must be explicit, including the existing worker policy defaults. `once` must preserve canonical structured keys; string concatenation is not a general replacement for Quarry’s typed tuple key.

   **Smallest fix:** restrict schedules to periods/offsets the existing IR represents, pass persisted boundary values explicitly, and reject other cron forms. Specify effect registration and a canonical array/tuple spelling for `once`, preserving emission deduplication and worker retry semantics.

13. **High — §3.1, §3.7: SQL value semantics are an unbudgeted part of the compiler.**

   Mapping SQL types and operators directly to their similarly named IR forms is unsound.

   **Counterexample:** nullable `parent_id <> some_id` excludes null in PostgreSQL but Quarry’s total inequality can include it. `NULL = NULL` differs too. This affects filters, policies, and constraints. [PostgreSQL comparisons](https://www.postgresql.org/docs/current/functions-comparison.html)

   Other differences requiring decisions include PostgreSQL `int`/`bigint` versus the engine’s 53-bit integer domain; unbounded SQL text versus Quarry’s default bound; timestamp precision; interval/calendar/timezone behavior; JSON numeric values; nullable ordering; mixed ASC/DESC orders; and SQL CHECK’s treatment of unknown.

   **Smallest fix:** publish a value-semantics compatibility table. Implement faithful lowering where supported and reject unsupported expressions. Use `IS NULL` and `IS [NOT] DISTINCT FROM` where those express the target’s total comparisons. Do not silently reinterpret ordinary SQL operators.

14. **Medium — §3.7, §7: the claimed complete list of non-Postgres forms is neither complete nor syntactically accurate.**

   In addition to the semantic extensions above, `written by` and trailing `once` are custom grammar, not stock PostgreSQL column syntax. The maintained generated-column form is omitted from the table. Treating an exception’s message literal as a Snapback application code is another extension; the advertised `RAISE EXCEPTION '<CODE>' USING MESSAGE = …` variant is invalid PostgreSQL because that form already supplies the message. [PostgreSQL RAISE](https://www.postgresql.org/docs/18/plpgsql-errors-and-messages.html)

   The committed target also contains forms whose spelling remains unspecified:

   | Target form | Missing contract |
   |---|---|
   | `use identity password` | Identity configuration/directive |
   | `format handle`, `format url`, bounded function arguments | Exact validation/domain syntax |
   | `unique … else HANDLE_TAKEN '…'` | Application refusal code and message |
   | Inserts omitting intrinsic `id` | ID-generation declaration and fresh-ID proof; an ordinary SQL primary key supplies no default |
   | Table-reference function arguments | Preservation of nominal reference types |
   | Multi-column search, sync/horizons, aggregate read-rule overrides | Complete options and defaults |

   **Smallest fix:** make §3.7 a complete compatibility contract with three categories: custom grammar, standard syntax with Snapback semantics, and refused PostgreSQL forms. A Supabase builder would recognize this file’s organization, but could not currently rely on their PostgreSQL semantic expectations.

15. **Medium — §5: the four hard places are mostly retained correctly, but two explanations need correction.**

   The completeness example correctly preserves the non-uniform server-scan class. A familiar RLS frame does not itself explain it: PostgreSQL builders normally expect a query to completely enumerate the rows visible under RLS. The additional incomplete-result contract remains something to learn.

   Device admission is about deriving an exact delivery audience, not merely whether a predicate can execute on a device. An owner-or-flag predicate is easy to evaluate yet may not fit one admitted partition audience.

   For time, distinguish **branch decisions depending on `now()`** from timestamp values. `DEFAULT now()` can participate in prediction; a time-based edit guard cannot be proven. The effects-only presence exception does not by itself explain why timestamped `send` predicts.

   **Smallest fix:** state these distinctions directly and attach paired behavioral examples: incomplete versus empty search; device-evaluable versus audience-invertible rules; timestamped send versus time-guarded edit. Test whether SQL readers reach the correct answer with less instruction.

16. **High — §7: the pre-test is a useful screening exercise, but is not yet a fair test of the premise.**

   Three judgments that a carefully translated file “reads as SQL” can pass despite major semantic surprises. The inner-join unread example is familiar SQL precisely because it has the wrong zero-row behavior for the proposed mapping.

   Conversely, reviewers could find `snapback_sequence` visually foreign even if builders learn it immediately and save substantial work. Counting “foreign” items without severity, exposure, or a stop threshold makes either outcome discretionary. The committed fixture also explicitly abbreviates messaging; translating it does not establish full-brief coverage.

   **Smallest fix:** keep the one-day gate, but pre-register its decision rule. Include the full mapping inventory, representative SQL from the actual Supabase lane, and fresh-reader tasks requiring authors to predict behavior and make small changes. Record misconceptions, required instruction, and unresolved semantic differences beside familiarity judgments. Treat passing as permission to test the hypothesis further, not confirmation of it.

17. **High — §8, §10: the named bet can pass without reducing learning cost, and fail despite reducing it.**

   A concrete false pass under the written rule:

   | Paired run | LANGUAGE | SQL-SUBSET | Completeness | Total |
   |---|---:|---:|---:|---:|
   | Quarry | 3 | 0 | 1 | 4 |
   | SQL | 0 | 3 | 1 | 4 |

   Reading A holds. SQL-SUBSET does not **exceed** the control’s LANGUAGE count. An indistinguishable clock is permitted. Correctness and floors can pass, and `data_modeling` can remain unchanged—or decline, since it has no specific floor. The complete charge has moved, yet the named bet passes.

   A false failure is also possible: substantially lower total cost and higher `data_modeling`, but one treatment note mentions a compiler distinction classified as LANGUAGE, violating zero-in-every-run.

   **Smallest fix:** define success as a pre-registered meaningful reduction in comparable learning burden, counting LANGUAGE and SQL-SUBSET together. Fix the unit of classification so sentence splitting and narrative verbosity do not decide it. Explicitly preserve the “no charge in either arm supplies no removal evidence” rule from LLP 4000 §9.1. If improved `data_modeling` is the intended claim, require evidence of movement in that category; 94 need not be the threshold.

   Correctness, native evidence, serial interleaving, calibrated grading, and floors are good safeguards. They do not supply the missing positive mechanism test.

18. **High — §4, §9: the compiler boundary is described backwards, and parser selection leaves substantial work unspecified.**

   The existing binder consumes `Vec<ast::Document>` and produces schema/program IR. It performs view expansion, index planning, admission, residency analysis, and emission metadata along that path. It does not accept already lowered core `Program`, `Read`, `Scan`, and `Merge` values for rebinding. Those values already contain index choices and provenance. [Binder entry point](/Users/ccheever/projects/snapback-sb5-reviews/r4001-astra/snapback4/crates/snapback4-lang/src/bind/mod.rs:49)

   Choosing `sqlparser` also does not supply the specified procedural compiler. Dollar-quoted function bodies need their own parsing and validation; choosing a PostgreSQL dialect does not establish semantic PostgreSQL validity. The project must handle name resolution, aliases, quoted identifiers, function bodies, custom clauses, and source locations. The parser’s own documentation distinguishes syntax from semantics and notes incomplete source spans. [sqlparser documentation](https://github.com/apache/datafusion-sqlparser-rs), [function-body AST](https://docs.rs/sqlparser/latest/sqlparser/ast/enum.CreateFunctionBody.html)

   **Counterexample:** an implementer emits core IR directly, then discovers that the planner, presence-effect analysis, returned-shape handling, and SQL-located diagnostic rewrites were bypassed.

   **Smallest fix:** specify SQL AST → existing pre-bind AST, or an explicitly designed shared pre-bind representation → existing pipeline → core IR. Include procedural parsing and SQL source/rewrite support in the work breakdown. Pin the parser and admitted grammar. With these boundaries fixed, this is a bounded compiler project; the current text does not yet bound it.

19. **High — §2, §6, §8–§9: the normative baseline and equivalence evidence must be made explicit before implementation.**

   Blanket incorporation of LLP 4000 §4–§5 conflicts with “engine unchanged.” Those sections contain the shelved warm set, depth acquisition, acquisition records, released-page rules, and client additions—not only unchanged engine semantics. The Snapback 5 fence documents still carry first-bet instructions.

   `through` is another unresolved dependency. LLP 3000.015 explicitly excludes it. Current LLP 3000.014 defines a **whole read rule**, with lifetime and implicit insert requirements, rather than the arbitrary policy function used in §3’s INSERT conjunction. The current rule IR does not implement it.

   **Counterexample:** one lane follows the inherited acquisition design while another preserves Snapback 4 residency; another implements the older `readable` predicate instead of the current whole-rule design. All can cite this RFC.

   **Smallest fix:** name the exact shared baseline and enumerate inherited contracts, excluding shelved treatment mechanisms. Either freeze an accepted, implemented `through` contract into both arms or use existing membership policies for this experiment.

   Before dropping delivery and queueing measurements on the ground that the engine is unchanged, establish equivalent compiled schemas, plans, operation classes, and behavior. The same engine can execute different plans or receive different residency declarations. Use normalized compiler-output comparisons plus differential cases covering authorization, nulls, cursors, expiry, private fields, provisional sequences, jobs, and prediction.

   Finally, move holdout/rubric freezing ahead of implementation. §9 step 4 currently follows the compiler lanes, while the reused LLP 4000 instrument requires holdouts committed before the first slice.

For §11, my answers are:

1. **Postgres dialect only.** It is the relevant familiarity hypothesis. Adding SQLite would introduce another semantic compatibility problem.
2. **Gate compiler implementation on the revised pre-test.** First resolve the mapping contract; then test familiarity and comprehension.
3. **Use a separate experimental `snapback5` package**, sharing the exact engine and client build with the control. Decide any eventual `--sql` product mode after the experiment.

**Overall verdict: NOT READY.**