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

---

## Round 2 — revision 2 (`9bc2ea9c83`), 2026-09-25

**Mode:** blind delta review, read-only, over a detached worktree at that commit; `codex exec -m gpt-6-astra -c model_reasoning_effort=max`. **Brief:** `~/projects/snapback-sb5-reviews/4001-r2.brief.md` (reproduced in the Opus round-2 section).

### Verbatim review

**Revision 2 is not ready.** It fixes the runtime reference, chooses the correct declaration AST, and makes the experiment substantially more honest. But the normative table still contains incorrect translations, omits forms used by the targets, and promises verification that its current pipeline cannot perform.

I reviewed `9bc2ea9c83` against `8a2637efa5`, following the requested reading order, including the local Supabase lanes. This was a static source and grammar review; I did not execute the proposed compiler or database verification. The checkout remains unchanged.

What is now sound: Snapback 4 is explicitly the runtime of record; `through` and maintained extrema are excluded; the SQL parser belongs outside the device build; published tables must pass audience inversion; default-time prediction is distinguished from branching on time; jobs have an explicit declaration category; diagnostics have a bounded translation tier; and the experiment now includes a control, symmetric restriction complaints, and an actual score prediction. These are substantive corrections.

**1. The §12 dispositions are mostly partial.**

“Real” below means the text resolves the design finding, not that implementation has already been verified.

| §12 row | Disposition | Remaining issue |
|---|---|---|
| Premise overclaims | **Real** | Summary and §1 now frame an open question and acknowledge the counter-evidence. |
| Wrong runtime; no `sync` spelling | **Partial — High** | §2 and LLP 4000 §13 are corrected. The publication statement’s appended `WITH` is invalid, and the default is ambiguous for maintained views. |
| §3 cannot spell the target | **Partial — Blocker** | A table and a future verification requirement are real improvements. They do not resolve the missing forms or incorrect mappings identified below. |
| Policies, transitions, recursion, roles, omitted checks | **Partial — High** | Raw probes and a restricted grammar are stated. Update-policy composition, role semantics, trigger composition, and required probe forms remain wrong or incomplete. |
| Extrema, `latest`, in-table counts | **Partial — High** | Withdrawing `latest` and extrema is real. The count macro still lacks reference selection and admission rules. |
| Recorded attribution, day, zero groups | **Partial — High** | The named operations exist. Missing-group versus hidden-group behavior and recorded-path admission are not fully specified. |
| LLP 3000.015 additions | **Partial — High** | All three concepts have entries. The owner/audience marker composition is unspecified; sequence lacks its required reference-column spelling; none binds on this checkout’s existing AST. |
| Views, shapes, Following | **Partial — High** | Nullable point subselects and the planned/maintained distinction improve matters. The post-card expression is ill-typed, Following’s admission is incomplete, and the blanket transactional-maintenance statement is false. |
| `socialProfile`, `insights`, cursor, references | **Partial — High** | PL/pgSQL bodies and `%TYPE` offer workable building blocks. The range mapping is off by one; the cursor rule excludes #19; the social-profile row names the wrong lookup. |
| DML, statement grammar, jobs, schedules | **Partial — High** | The statement inventory and job category are real. Conflict targets, general upserts, nullable guards, heterogeneous effect keys, and sweep classification remain unresolved. |
| SQL value semantics | **Only asserted — High** | “Guard insertion” is not a compositional semantics. The expression list also misidentifies builtins and omits target expressions. |
| Exhaustive differences; wrong Quarry names | **Partial — High** | `retain` and `cap` are corrected. The three-category organization helps, but neither the categories nor their contents are exhaustive or internally consistent. |
| Immutability | **Partial — High** | Mutability is now explicit. Its complement includes engine-maintained columns and conflates role privileges with global immutability. |
| Silent device downgrade | **Real** | §5 explicitly requires `E_SYNC`; no fallback to online-only is permitted. The publication syntax still needs repair. |
| Reading-only pre-test | **Partial — High** | Corpus replay and blind writing address the right questions. Their counting units, completion requirements, and stop thresholds remain vulnerable. |
| Comparison passes by construction | **Partial — High** | The directional score prediction and symmetric class resolve important parts. Equality still satisfies the mechanism gate; masking, floors, and interpretation remain underspecified. |
| Wrong lowering target, parser, diagnostic scope | **Partial — High** | `ast::Document` and tiered diagnostics are correct choices. There is no document printer in `print.rs`; parser output is not a resolved, typed SQL program. |
| Increment D unreconciled | **Partial — High** | Shared availability is addressed. Arbitrary unlowerable PostgreSQL reads are not the authorized, store-dialect projection reads specified by LLP 3000.009 §6.2. |
| Spelling, refusal codes, API naming | **Partial — Medium** | The code family and naming direction are decided. Semantic aliasing, SQL name resolution, collisions, module names, and return-field names remain unresolved. |
| Evidence rows overstate | **Real** | §1 now records what the evidence actually supports. |

**2. The normative table needs both corrections and additional rows.**

There are three different checks here:

- **Parsing:** acceptance by PostgreSQL’s grammar.
- **Analysis:** names, types, access methods, options, and function bodies form a valid PostgreSQL program.
- **Lowering:** the proposed Quarry declaration binds and preserves the stated behavior.

§3 and §4 currently conflate them. `libpg_query` parses without a database catalog. Domains and functions do not alter its grammar. Conversely, raw parsing does not validate a composite-versus-integer `COALESCE`, an index access method, or an opaque trigger-argument string. Its PL/pgSQL output also contains embedded SQL expression strings that need further parsing. [libpg_query](https://github.com/pganalyze/libpg_query)

In the following audit, **Yes** under PostgreSQL means syntactically legal after expanding the table’s obvious abbreviations. **Conditional** under Quarry means the engine supports the intended form, but the RFC has not supplied all necessary lowering conditions. **Future** means LLP 3000.015 or increment D must first extend the shared baseline.

For §3.1:

| Row | PostgreSQL / Quarry | Assessment and smallest repair |
|---|---|---|
| Identity configuration | Yes / Yes | **Sound as a declared extension.** |
| Effect and payload type | Yes / Conditional | **Medium:** Quarry’s effect declaration has no payload-type contract. A typed SQL composite cannot silently add validation or lose it. Specify that the type is only authoring metadata, or put identical validation in the shared baseline. |
| `auth.uid()` | Yes / Yes | **Sound as a viewer alias**, subject to defining its principal type and unauthenticated behavior rather than inheriting Supabase’s implicitly. |

For §3.2:

| Row | PostgreSQL / Quarry | Assessment and smallest repair |
|---|---|---|
| Client-minted implicit ID | Yes / Yes | **Sound as an explicit difference.** |
| Text length | Yes / Yes | **Sound for the shown non-null, bounded text form.** |
| Named format | Yes / Yes | **Sound as a recognized declaration macro**, not arbitrary regex support. |
| Enum | Yes / Yes | **Sound**, with nullability handled separately. |
| Nullable column | Yes / Yes | **Sound**, once the scalar-type mapping is defined. |
| Defaults | Yes / Conditional | **Medium:** prediction is addressed, but `timestamptz` precision/range and literal conversion are not. #19 has `time default 0`. Define the time representation and literal lowering. |
| Image/video/once types | Yes / Conditional | **Medium:** ordinary domain stubs do not provide arbitrary type modifiers. Supply suitable base-type/typmod stubs or choose a domain-compatible annotation. |
| Unique key | Yes / Yes | **Sound for the supported full-column key**, including ordinary null-distinct uniqueness. |
| Coded unique | Yes / Yes | **Medium:** the custom message is disclosure-sensitive in Quarry. A collision with a hidden row does not necessarily expose `HANDLE_TAKEN`. State that exception and its existing error behavior. |
| Immutability through grants | Yes / **No as a general complement** | **High:** on `posts`, the complement includes generated `likeCount` and `repostCount`; immutable constraints over maintained columns fail validation. Exclude engine-owned fields and define how owner-written fields and system jobs interact with this declaration. |
| Search index | Yes / Yes | **Medium:** parsing is fine, but domains/functions alone do not create an access method. Either provide an access-method stub for database analysis or explicitly make this a parser-only check. Preserve the engine’s word-prefix search contract. |
| Cap | Yes / Yes | **Sound as an explicitly cross-row macro.** Add it to §3.7’s actual enumeration. |
| Retain | Yes / Yes | **Medium:** a namespaced table option parses but is not made executable by function/domain stubs. State the validation level and list it in §3.7. |
| Expiry | Yes / Yes | **Medium:** same catalog-validation problem as retain; also list it in §3.7. |
| Online-only default | Yes / Yes for ordinary tables | **Sound for ordinary tables.** It is not a correct universal default for derived maintains. |
| Publication/residency | **No with the appended `WITH`** / Conditional | **High:** `ALTER PUBLICATION … ADD TABLE` has no trailing options clause of this form. Keep the valid publication statement and put per-table horizon/recipient metadata in a separately valid declaration. |
| Generated count | Yes / Conditional | **High:** the binder infers only a unique reference from contributor to owner, rejects ambiguous references and expiring sources, and supports explicit `by`. None is specified. Add reference-column and explicit-correlation forms. |
| Public reason | Yes / Conditional | **Medium:** complete `COMMENT ON POLICY … ON table …`; require that the composed read rule is actually public. A true restrictive or role-limited policy alone does not establish that. |
| Owner-written column | Yes / Future | **High:** “in the same check” does not define the Boolean syntax of the audience opt-out, nor its interaction with the grant complement. Give exact default-private and opted-out declarations that lower to the baseline’s field authority. |
| Sequence | Yes / Future | **High:** the parent column must carry a nominal table reference, currently missing from the table. Define that spelling and exclude the generated ordinal from ordinary update-grant inference. |

Two distinctions matter particularly here:

First, `snapback.sequence(conversation_id)` is **not inherently a PostgreSQL syntax error**. PostgreSQL type-modifier processing can accept a simple identifier; it needs a suitable type implementation. Likewise, the new generated-count expression is syntactically an ordinary function call. These should not be described as grammar made valid by domains. [PostgreSQL type-modifier implementation](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/parser/parse_type.c)

Second, a generated count remains a substantial semantic extension: ordinary stored generated columns derive from the current row and do not update when another table changes. An immutable stub can help validate a fixture without implementing that behavior. The RFC now acknowledges the cross-table difference, which is progress; it still needs the macro’s precise admission rules. [Generated columns](https://www.postgresql.org/docs/18/ddl-generated-columns.html)

The publication repair must not merely change `WITH` to publication-wide `SET`: horizon and recipient belong to a particular table’s delivery declaration. [ALTER PUBLICATION](https://www.postgresql.org/docs/18/sql-alterpublication.html)

For §3.3:

| Row | PostgreSQL / Quarry | Assessment and smallest repair |
|---|---|---|
| Read policy | Yes / Conditional | **High:** raw-probe semantics are now stated, but the admitted probe grammar excludes target probes with extra equalities, such as `role = 'admin'`. Admit the binder’s actual keyed-probe grammar. |
| Insert policy | Yes / Conditional | **Medium:** the direct rule mapping works; define role filtering, default deny, and implicit RLS activation globally. |
| Delete policy | Yes / Conditional | **High:** SQL visibility requirements and Quarry write authority differ. State the interaction with SELECT policies and hidden rows, rather than marking the whole mapping exact. |
| Single-image update | Yes / Conditional | **High:** the sentence about `USING` alone is ambiguous between old-only and old-plus-next. Specify both old-row eligibility and next-row acceptance, including omitted `WITH CHECK`. |
| Transition trigger | Yes as an outer trigger statement / Conditional | **High:** the dollar-quoted body is opaque data, not a parsed PL/pgSQL trigger body. Specify `FOR EACH ROW`, the inner grammar, composition with update policies, and system-job behavior. |
| Multiple policies | Yes / Conditional | **High:** “permissive OR; restrictive AND” is insufficient. There must be an applicable permissive grant; UPDATE’s old and new policy combinations must be assembled separately. |
| Service-role policy | Yes / **No as stated** | **High:** `TO service_role` restricts a policy’s applicability; it does not identify `'service:x'` or unconditionally OR in a grant. Define named-service identity mapping and preserve the policy predicate. |
| `through` | Explicit GAP | **Sound exclusion.** |
| Public reason cross-reference | As above | Carries the same policy-composition qualification as §3.2. |

A concrete multiple-policy counterexample: one permissive update policy accepts old/new `status = 'draft'`; another accepts old/new `status = 'published'`. PostgreSQL combines old eligibility separately from new acceptance. A draft-to-published update can satisfy those two combinations, while `OR`-ing two already-paired transition predicates rejects it. Restrictive-only policies provide another counterexample: AND-ing their predicates into a grant incorrectly admits rows. The smallest fix is to write the composition algebra explicitly before lowering it to one Quarry rule. [CREATE POLICY](https://www.postgresql.org/docs/18/sql-createpolicy.html)

The trigger spelling also does not yet recognize what Muse wrote: Muse defines ordinary named trigger functions, including conditions outside Quarry’s rule grammar. A string passed to `snapback.transition` is a new macro convention. It may be a reasonable convention, but calling it the existing lane’s form overstates compatibility. PostgreSQL trigger arguments are strings, and omission of `FOR EACH ROW` selects a statement trigger. [CREATE TRIGGER](https://www.postgresql.org/docs/18/sql-createtrigger.html)

For §3.4:

| Row | PostgreSQL / Quarry | Assessment and smallest repair |
|---|---|---|
| Activity union | Yes / Conditional | **Sound in principle.** Spell the complete two branches and retain source/branch identity; ordinary SQL `UNION ALL` does not itself provide the engine cursor identity. |
| Following | Yes / Conditional | **High:** publication plus immutable mapped columns is insufficient. Import the actual public-source, edge, ownership, shape, and lifecycle restrictions from LLP 3000.013. |
| Follower count | Yes / Yes | **High semantic omission:** authorized absent groups return zero; hidden groups do not become zero. Define result-column naming and visibility separately from SQL’s absent-row behavior. |
| Recorded received likes | Yes / Conditional | **High:** require the supported immutable reference path, public target, and immutable attributed field. State missing-target capture and deletion/ID-reuse behavior. |
| Daily likes | Sketch / Conditional | **Medium:** provide the full projection, including the day key, not merely an added `GROUP BY`. The ordinal difference itself is correctly stated. |
| Row-keyed unread | Yes / Future | **Sound zero-preserving relational shape. High remaining contract gap:** explicitly inherit member-row authority, bounded admission, and pending recount/coverage behavior from LLP 3000.015. It is not an ordinary synchronous aggregate. |
| Post card | Parses; **fails type analysis** / Not the stated exact mapping | **High:** `SELECT c FROM reply_count c` returns a composite row, which cannot be coalesced with integer `0`. Select an explicitly named scalar aggregate column; preserve hidden-null versus absent-zero behavior. |
| Object spread | Yes / Conditional | **Medium:** `SELECT p.* FROM profiles p` scans a relation; spreading an already-bound record does not. Define record-variable expansion and the point-read predicate rather than relying on this fragment. |

The introductory sentence that every materialized view is maintained in the writing transaction is **High severity and false** for the advertised class. Following uses delivery/backfill machinery; LLP 3000.015’s large mark advance permits pending recount. Nor does “rule-filtered” mean every aggregate is computed separately over each reader’s visible source rows: the engine explicitly supports declared aggregate disclosure.

Smallest fix: split the contract into ordinary maintained groups, row-keyed pending counts, and Following. State each one’s visibility, readiness, update timing, and activation restrictions. The current blanket statement would teach a competent implementer the wrong observable behavior.

For §3.5:

| Row | PostgreSQL / Quarry | Assessment and smallest repair |
|---|---|---|
| Home | Yes / **Wrong source** | **High:** SQL reads `activity_card` without selecting `following`. An unfollowed actor can appear. Define the reusable card separately and apply it to Following explicitly. |
| `%TYPE` reference argument | Yes / Conditional | **Medium:** PostgreSQL copies the column’s data type; it does not preserve nominal table identity when every ID has type `snapback.id`. Resolve the original column reference before erasing `%TYPE`, and mark this an extension rather than ✓. |
| Bounded query argument | Sketch / Conditional | **Medium:** “in the body” is not a syntax rule. Specify the marker’s exact placement, mandatory execution-independent interpretation, minimum length, format, and nullable variants. |
| Matching | Yes / Yes | **Sound as a recognized search macro**, with row-variable/alias resolution defined. |
| Required point/social profile | Sketch / Conditional | **High:** the target looks up `profiles` by `handle`; the row says `posts[postId]`. Supply the actual function, record type, return shape, and narrowly recognized exception block. |
| Insights range | Yes / **Wrong bounds** | **High:** PL/pgSQL `a..b` includes `b`; Quarry `range(a,b)` excludes it. The seven-day target becomes eight days. Use `a..b-1` in the paired SQL or lower inclusive bounds explicitly, preserving once-only evaluation and overflow behavior. |
| Trending | Yes / **Wrong plan claim** | **High:** the shown predicate has only a lower time bound. The binder’s bucket expansion needs a finite upper bound too. Restore `at <= now()` and the target’s parent/removal filters. |
| Streaming count | Yes / Yes for `count(*)` | **Sound for the specified metered count.** Do not generalize this row to `count(nullable_column)`, empty `sum`, or other aggregates without defining them. |
| Server-only SQL read | Incomplete marker / Future | **High:** this is not enough to invoke increment D safely or portably. See the pipeline finding below. |

The range discrepancy is directly visible in the [Quarry loop binder](/Users/ccheever/projects/snapback-sb5-reviews/r4001b-astra/snapback4/crates/snapback4-lang/src/bind/program/control.rs:432), which constructs an exclusive end. PostgreSQL’s integer loop is inclusive. [PL/pgSQL control structures](https://www.postgresql.org/docs/18/plpgsql-control-structures.html)

The `%TYPE` choice is syntactically good. Its nominal-reference interpretation must simply be acknowledged and implemented as Snapback metadata, rather than attributed to PostgreSQL. [CREATE FUNCTION](https://www.postgresql.org/docs/18/sql-createfunction.html)

For §3.6:

| Row | PostgreSQL / Quarry | Assessment and smallest repair |
|---|---|---|
| Insert if absent | Yes / Conditional | **High:** naming a full unique key is insufficient. With two unique keys, a collision on the non-target key raises in PostgreSQL but Quarry’s `if absent` can suppress it. Restrict admission to a proven deciding-key case or state and test the broader difference. |
| Upsert | Yes / **Not for the general form** | **High:** SQL can have different insert/update expressions and refer to existing and `excluded` values. Quarry’s single patch is not that whole language. Define the exact equivalent subset and reject the rest. |
| Point update | Yes / Yes | **High omission:** `NOT_FOUND` is only part of the difference. Define hidden-row writes, readback/RETURNING, and authority behavior. |
| Conditional point update | Yes / Conditional | **High:** the condition is subject to readable-target requirements and SQL null semantics. State when failure is `NOT_FOUND`, `E_CONFLICT`, or a rule refusal. |
| Point delete | Yes / Yes | **High omission:** likewise specify hidden-row and read-rule interaction, not just missing-row failure. |
| Require | Yes / Conditional | **High:** if `cond` is SQL NULL, `IF NOT cond` does not raise. It is not generally a Quarry `require`. Require a non-null Boolean or define an explicit true-test lowering. |
| Effect once key | Yes; potentially fails type analysis / Conditional | **High:** the target key contains a principal and a time. PostgreSQL arrays require a common element type. Define a heterogeneous tuple macro, such as an explicitly admitted JSON-array constructor, preserving typed key components. |
| Procedure/job | Yes / Conditional | **High:** distinguish stable unpaged top-level sweeps from paged prelude loops; state system authority, retry/chunk behavior, and local-state lifetime. “Top-level FOR” alone is too broad. |
| Cron schedule | Yes as an outer call / Conditional | **Medium:** define UTC and exact expression admission; the command’s period variables are macro placeholders. Fixed engine periods such as 90 seconds also need a spelling or an explicit GAP. |
| Connected/effects-only branch | Yes / Yes | **Sound**, provided the existing effects-only restriction is retained. |
| After-insert | Explicit GAP | **Soundly disclosed**, rather than silently simulated by a different mutation contract. |

The insert-if-absent counterexample is implemented by the loop over **all unique indexes** in [engine/write.rs](/Users/ccheever/projects/snapback-sb5-reviews/r4001b-astra/snapback4/crates/snapback4-core/src/engine/write.rs:52). The array issue follows PostgreSQL’s common-element-type rule. [Array expressions](https://www.postgresql.org/docs/18/sql-expressions.html)

**The missing-form inventory is still a Blocker for §3’s coverage claim.**

I am counting distinct forms, not demanding a separate row for every function name.

| Source | Form without an adequate normative row | Smallest repair |
|---|---|---|
| Committed target and #19 | Ordinary `principal`, nominal table-reference columns, generic `id`, `bool`, bounded `int`, and `time` mappings | Add a scalar/reference table. `%TYPE` arguments do not declare reference columns. State that nominal references do not automatically impose PostgreSQL FK existence/cascade semantics. |
| Committed target | Nullable reference arguments; argument minimum length and `format handle` | Extend the argument declarations beyond `bound(q,100)`. |
| Committed target | `activityCard` containing a point read with reusable `postCard`, plus nested actor data | Define named shape declaration, application, and nesting independently of a view’s base relation. |
| Committed target | Filtered maintains: `originalPosts`, `dailyPosts`; complete multi-key/day projections | Add exact filtered-aggregate and multi-key projection forms. The other unfiltered counts are instances of existing rows. |
| Committed target and #19 | Optional point results, unpaged returned collections, scalar first-row reads, returned nested objects | Give complete return signatures and lowering rules, including cursor/meter/pending behavior. |
| Committed target and #19 | General program `exists`/`not exists`, beyond the narrowly described policy probe | Define program expression forms separately from policy forms. |
| #19 | Private reusable `fn` helpers, row-valued helper parameters, helper calls within shapes | Add a helper declaration/exposure rule. Currently STABLE means query and VOLATILE means client mutation. |
| #19 | Multiple mutually exclusive returned pages in `people`; page/fallback branches in `homeFeed` | Replace “one page in the body” with the existing returned-page ownership rule, or register this deliberate loss. |
| #19 | Explicit dynamic-lane `merge … by byActorTime`, named read indexes, list-built actor lanes | Add these forms or explicitly exclude #19 from the coverage claim. Replacing them with Following is not a spelling-only translation. |
| #19 | Explicit maintained-column `by post` / `by parent` | Add a count-correlation argument. |
| #19 | Maintained views explicitly `online only` | Define derived-view residency separately from ordinary-table publication absence. |
| #19 | Forced-server mutations `edit` and `deleteMessage` | Give the existing Quarry `: server` flag a spelling distinct from increment D’s unlowerable SQL read. |
| #19 | Bounded reference-list argument `ids: [messages] <=50`; optional enum/media arguments | Define argument element types, bounds, nullability, and media variants. |
| #19 | `group`, `first`, `slice`, scalar `min`/`max`, list accumulation, nested conditional expressions, media coalescing and `.duration` | Add exact expression mappings. “The IR’s builtins” is not a SQL grammar. |
| #19 | Module-qualified functions, helper lookup, and schedule target `insights.daily` | Define file/module naming and name resolution. |
| LLP 3000.015 | Exact `readable by audience` opt-out; owner-field authority composed with row authority | Supply complete declarations and an explicit inheritance of B1’s authority contract. |
| LLP 3000.015 | Parent reference and generated/immutable sequence-column treatment | Supply the reference mapping and precedence over grant inference. |
| LLP 3000.015 | Row-keyed aggregate authorization and pending recount contract | Bind the SQL row explicitly to B3’s complete contract, including the large-range case. |

The relevant targets are the [committed Clique fixture](/Users/ccheever/projects/snapback-sb5-reviews/r4001b-astra/snapback4/crates/snapback4-sim/tests/fixtures/intent-clique.q) and [#19’s program directory](/Users/ccheever/projects/snapback-sb5-reviews/r4001b-astra/benchmarks/runs/2026-09-24-snapback4-clique-astra-0.4.0/astra/source/snapback). A coverage manifest pointing every declaration and expression form to an exact paired fixture would be the smallest reliable way to close this finding.

**3. Revision 2 introduces new defects as well as leaving old ones open.**

The publication options, grant-complement failure, inclusive range, heterogeneous array, incorrect `home` source, and missing printer are new concrete problems. Several broader contracts also need correction.

**High — §3.2, §3.7: residency defaults are not uniform across declaration kinds.**  
Ordinary unpublished tables are online-only. Maintained views can inherit residency from their source unless explicitly marked online-only. #19 deliberately uses that override. Applying the RFC’s blanket “absent publication means online-only” to every declaration changes the committed target; exempting maintains without supplying an override loses #19.

**Smallest fix:** specify defaults and opt-outs separately for ordinary tables, maintained groups, row-keyed views, and Following.

**High — §3.2, §3.7: column privileges are not global immutability.**  
Beyond the maintained-column rejection, a PostgreSQL grant constrains a role. Quarry immutability constrains row changes, including changes attempted by other principals or system work. A service job that updates a field omitted from the authenticated grant is therefore another counterexample. B1’s owner-written field creates an additional precedence question.

**Smallest fix:** define this as a schema annotation over ordinary author-writable columns, with explicit treatment of engine-owned and owner-written columns. State that it is not PostgreSQL’s privilege model. [GRANT](https://www.postgresql.org/docs/18/sql-grant.html)

**High — §3.7 and §11.5: guard insertion is not yet SQL null semantics.**  
For nullable `x`, suppose equality lowers to:

```text
x != null and x = 1
```

Then lowering `NOT (x = 1)` by negating that result produces true for null, while SQL produces unknown. Similarly, `IF NOT cond THEN RAISE` skips its body when `cond` is null; a general `require cond` cannot be substituted.

`IN` and `EXISTS` also cease to be interchangeable when unknown can survive into a projection or negation. A nullable record introduces another trap: PostgreSQL row `IS NOT NULL` does not merely mean “a row was found.”

**Smallest fix:** define compositional true/false/unknown lowering and consuming contexts—policy, WHERE, IF, CHECK, returned value—then restrict unsupported cases. Preserve the resulting pin, completeness, and metering effects. Alias canonicalization must use those rules. [Comparison predicates](https://www.postgresql.org/docs/18/functions-comparison.html), [subquery expressions](https://www.postgresql.org/docs/18/functions-subquery.html)

**High — §3.7: the claimed expression inventory is not the existing language inventory.**  
`length` is not the Quarry builtin named here; scalar two-argument Quarry `min`/`max` are not PostgreSQL aggregate `min`/`max`. #19’s list grouping, slicing, media expressions, and helper calls remain outside the described grammar. The scalar contract also omits integer range, timestamp precision, ordering/null behavior, and aggregate empty-input behavior.

**Smallest fix:** enumerate SQL expression patterns with their result types and exact Quarry forms. Use `least`/`greatest` or an explicit macro for scalar extrema, and specify their null behavior. Mark unsupported expressions as actual GAPs.

**High — §4, §10: the equivalence gate can be green while the claimed equivalence is false.**  
Equal complete Quarry programs, under the same filenames, configuration, binary, and inputs, are strong evidence of equal engine behavior. That part is sound.

But the gate does not establish that the SQL source means what the table promises. Lowering inclusive `a..b` to exclusive `range(a,b)` can produce the expected Quarry bytes and still mistranslate SQL. It also covers only one pinned program, not programs written in the comparison. Front-end argument validation, effect typing, API names, or external SQL configuration can differ outside the printed source.

Conversely, two equivalent programs can fail byte comparison because of harmless local names, helper expansion, or independently authored declaration organization.

**Smallest fix:** retain the strict pinned-program gate, freeze the independent Quarry target, and add small semantic counterexample fixtures for every mapping above. Compare complete named source trees and all externally observable front-end artifacts. Require the blind-writing programs to be lowered and behavior-checked after the compiler exists; §10 currently mentions that second sample without scheduling it.

**High — §7: both pre-tests can be gamed without improving the surface.**

- In corpus replay, one large `CREATE FUNCTION` can contain most of an application’s unsupported implementation yet count as one refused statement among many admitted DDL statements. The Astra dispatcher is a concrete instance of this shape.
- Counting inner statements instead produces a different denominator; SQL and Quarry statement counts are not comparable.
- Moving difficult reads to “server-only” can lower refusal rate while losing offline or completeness behavior.
- “Refused in all three lanes” is undefined for a capability that some lanes never implemented in SQL.
- Blind writing has no mandatory feature-completion gate. A smaller or incomplete program can have fewer refusals. Predicting its own incomplete behavior correctly does not show understanding of the required application.
- The five scenario names do not fix initial state, expected outcome, or scoring of pending/unknown results.

**Smallest fix:** hash an explicit corpus manifest; classify common semantic operations/features; distinguish syntax-only rewrites from changes in execution capability; require brief coverage before computing refusal rates; and score predictions against fixed independent scenarios.

The one-third threshold currently has no stable interpretation. The zero-tolerance SQL-versus-Quarry threshold can stop on one additional error among fifteen predictions. Those may be conservative investment rules, but they are not calibrated falsification thresholds. State that distinction and justify the margins before observing results.

**High — §8: SURFACE can still pass without supporting the mechanism.**  
Equal nonzero counts satisfy reading A. Zero/zero also satisfies its inequality, despite the adjacent sentence saying it supports nothing. Thus an unrelated or noisy three-point score increase can pass while language learning burden is unchanged.

It can also fail despite a large overall improvement: treatment counts of `2,0,0` versus control `1,10,10` fail the per-pair condition.

Phrase counts additionally depend on note verbosity and how one complaint is split into phrases.

**Smallest fix:** define the unit of burden, distinguish reduction from non-inferiority, and make the no-evidence case consistent with the pass rule. If the intended mechanism is reduced learning cost, require a predeclared meaningful reduction over comparable observations; report pair regressions separately.

**Medium — §8: the masking dictionary cannot ensure that the arm is unidentifiable.**  
Remaining syntax, “RPC,” “trigger,” “foreign key,” identifier conventions, and descriptions of refusals can reveal the arm. Masking words such as “policy” and “rule” can also remove information needed to classify the complaint.

**Smallest fix:** describe masking as an attempted blinding measure, freeze the full dictionary and classification examples, test arm-guessing on held-out notes, and register adjudication. Do not assert successful blinding from the token list alone.

**High — §8: the directional prediction and floors need a reproducible statistical contract.**  
A three-point difference across three runs can occur without a real advantage; a real smaller advantage fails the rule. “One scorer sd” does not establish between-build uncertainty. Seven one-SD floors add additional opportunities for a noisy failure. Their SD values, provenance, aggregation, and control-validity rule are not given.

The phrase “where the control passes” also needs care: a broken control must not make treatment correctness failures acceptable.

**Smallest fix:** freeze numerical category margins and their calibration source, paired run/order procedure, correctness prerequisites, and uncertainty reporting. A binary shipping decision is reasonable; it should not be described as proving or falsifying the causal familiarity claim.

**4. The §4 pipeline is architecturally plausible, but not yet bounded and correct as written.**

**High — §4: the advertised document printer does not exist.**  
The current [print.rs](/Users/ccheever/projects/snapback-sb5-reviews/r4001b-astra/snapback4/crates/snapback4-lang/src/print.rs:8) prints expressions, reads, quoted strings, and scalar types. It does not serialize `ast::Document`, declarations, or complete program bodies. Its merge-expression printer is not a complete merge-program serializer.

**Smallest fix:** explicitly budget a complete serializer under `snapback5/`, preserving the no-change boundary for `snapback4-lang`. Require parse–print–parse coverage over every admitted AST form. Do not count the existing diagnostic expression printer as that component.

**High — §4: name and type resolution are missing from the pipeline.**  
A competent implementer following the current text could:

- resolve `%TYPE` to the common ID type and lose nominal references;
- confuse PL/pgSQL variables with columns;
- lowercase or camel-case names before resolving quoted identifiers;
- silently collide `read_up_to` with `"readUpTo"`;
- flatten files and change module-qualified operations;
- change JSON field names as though they were SQL identifiers;
- accept an embedded SQL string without parsing it.

The binder derives operation modules from filenames, as shown in [bind/mod.rs](/Users/ccheever/projects/snapback-sb5-reviews/r4001b-astra/snapback4/crates/snapback4-lang/src/bind/mod.rs:86). Byte-identical file contents alone therefore do not guarantee identical APIs.

**Smallest fix:** specify a SQL symbol/type-resolution phase, a version-pinned parser interface, recursive parsing of embedded expressions, collision rejection, and a named-file output contract before constructing `Document`.

**High — §3.5, §4, §6: increment D is not an automatic fallback for arbitrary PostgreSQL.**  
LLP 3000.009 §6.2 permits bounded server reads over authorized projections or database-owned keyed relations, in the store’s dialect. It does not authorize arbitrary reads of managed application storage. A PostgreSQL function over `messages` does not become a safe SQLite/store query by marking it server-only.

**Smallest fix:** define the declaration’s permitted relations, dialect, parameters, result shape, authorization channel, bounds, and live/one-shot behavior. Otherwise withdraw this row before corpus classification. Shared availability in both arms solves experimental asymmetry, not the missing access contract.

**High — §9: prerequisites are ordered after their consumers.**  
Step 2 requires unchanged-binder verification of B1–B3, but step 5 lands the baseline that supplies them. Step 5 also freezes holdouts and the rubric after compiler lanes, conflicting with the inherited preimplementation holdout requirement.

**Smallest fix:** separate baseline preparation from treatment work. Freeze the complete target, scenario contracts, holdouts, rubric, and grammar before the corresponding work or measurement depends on them.

**Medium — §2/§6 and repository instructions: the local fence still names the shelved runtime.**  
`snapback5/AGENTS.md` continues to direct work toward LLP 4000 §4–§5 and its earlier surface boundary.

**Smallest fix:** update the fence in the same design revision so an implementer receives one governing runtime and scope.

With these changes, the architecture can be bounded: PostgreSQL parsing; a deliberately limited resolver and recognizer; explicit semantic lowering; a complete Quarry serializer; and delegation to the unchanged binary. “Postgres AST → Document” currently hides most of that compiler work.

**5. Answers to §11’s questions 4–7.**

**4 — Canonicalize admitted alternatives? Yes, with semantic conditions.**  
`<>` and `!=` are straightforward. `IN`/`EXISTS` and `COALESCE`/`CASE` require null, type, context, and evaluation analysis. Register proven transformations rather than blanket equivalences.

**5 — SQL or Quarry null semantics? Prefer SQL semantics.**  
That matches the stated familiarity hypothesis. Require a compositional specification and focused counterexamples before implementation. Until then, refuse unsupported nullable expressions rather than promising that generic guard insertion handles them.

**6 — `auth.uid()` or `current_principal()`? `auth.uid()`.**  
It is the stronger prior for the targeted builders. Document the actual Snapback principal type, service identities, and unauthenticated behavior.

**7 — When should the pre-tests run? After this review and the table repairs, before compiler lanes.**  
A read-only corpus inventory can begin earlier. Counted pre-tests should not use invalid forms or mutable classification rules. They can inform whether compiler investment is worthwhile; they cannot settle Opus’s expectation about the later three-point `data_modeling` result.

**Overall verdict: NOT READY.**

---

## Round 3 — revision 3 (`b1edaa05cf`), 2026-09-25

**Mode:** blind delta review, read-only, over a detached worktree at that commit; `codex exec -m gpt-6-astra -c model_reasoning_effort=max`. **Brief:** `~/projects/snapback-sb5-reviews/4001-r3.brief.md` (the round-2 brief advanced one revision).

### Verbatim review

**NOT READY for compiler implementation.** Revision 3 fixes several substantial problems, but its form table still contains invalid or incomplete mappings, its equivalence gate names an export that does not exist, and pre-test 1 already has a known stopping case.

I reviewed `b1edaa05cf` read-only, including the requested history, implementation sources, guide cards, target programs and local Supabase files. I did not execute PostgreSQL examples or run checks that generate files. “Sound” below means supported by the specification and source inspection; it does not claim the proposed verification transcript exists.

**1. Round-2 dispositions**

These assessments follow §12’s rows in order.

| Round-2 finding | Assessment of revision 3 |
|---|---|
| Invalid typmods, reloptions, publication options and access method | **Partial.** Moving these declarations into calls/checks is real. However, “every row … parses and executes” remains unverified and is currently false for some examples: unquoted `from =>`, timestamp literal `0`, and the composite-return examples discussed below. |
| `grant update` as immutability | **Real.** `snapback.immutable` explicitly binds jobs and ordinary writers; absence means no immutable columns. The original privilege/invariant confusion is removed. |
| Missing reference/principal/scalar rows and `%type` information loss | **Partial.** Reference columns and text principals are now explicit, and preserving `%type` metadata is a legitimate compiler rule. Reference-list arguments still lose their referenced table, and the timestamp/literal mapping is incomplete. |
| Update policy, combination and transition trigger | **Partial.** Combining permissive policies separately for old and next images is correct. The trigger-only row nevertheless promises an authorizing Quarry rule while the combination formula requires permissive policies. Its arbitrary exception code also disappears during lowering. |
| Policy grammar, service principals, recursion and RLS enablement | **Partial.** Extra-column equality probes, service principals, non-recursive probes and owner behavior are materially clearer. `snapback.created(t, col)` lacks a concrete, catalog-valid spelling and a declared stub. The null-safe operators promised elsewhere are missing from the grammar. |
| Home/global, shapes, insights, endpoints, effects, presence, jobs and cron | **Partial.** The source of Home, range endpoint, heterogeneous effect key, procedure local and schedule boundary functions are corrected. Home/global still have PostgreSQL composite-type problems, and the page/shape classification remains incomplete. |
| Conditional update, `if absent`, upsert | **Partial.** The conditional-write pre-read and targetless conflict spelling are real corrections. The neighboring unconditional-update row now contradicts the engine’s authorized blind-write behavior. The upsert recognizer needs an exact insert/patch correspondence. |
| Missing expressions and #19 forms | **Only asserted as a completeness claim.** Several expressions were added, but #19’s named index, dynamic merge, grouping, procedural helpers and other forms still lack rows or explicit GAPs. |
| Null semantics | **Partial.** Refusing nullable `=`/`<>`/`IN` closes important holes. Nullable ordered comparisons under `NOT` still change meaning. Canonicalizing `col = null` also contradicts the promise to canonicalize only meaning-preserving aliases. |
| Printer, resolver and equivalence gate | **Partial.** The new printer, independent original-Quarry oracle and two-level parser are good architectural corrections. `snapback4 check --json` does not expose bound schema/program IR, so the specified gate cannot perform its stated comparison. |
| Server-only SQL relief valve | **Real.** The unsupported fallback is withdrawn, and LLP 3000.009 §6.2 is described accurately. |
| Pre-test 1 | **Partial.** Separate body/top-level denominators and per-instance stops close earlier loopholes. But the admitted subset demonstrably refuses named stopping cases in the manifest. “Server-only” also remains in one classification sentence immediately before being disallowed. |
| Pre-test 2 | **Partial.** Both cards, shared rubric, margins and mandatory edit/mark features improve symmetry. Published expected answers compromise the prediction test; no functional-coverage gate or absolute comprehension floor prevents vacuous passage. |
| Evaluation | **Partial.** Strictly lower pooled SURFACE, two primary scorers, restored floors and an explicit small-sample outcome are improvements. Counting units, masking validation, zero-charge interpretation and optional extension to N = 8 remain insufficiently specified. |
| Prerequisite order | **Partial.** Landing 3000.015 before consumers is correct. However, §9 freezes the corpus manifest and classifier rubrics in step 5, after pre-tests in step 4. §8 also points to step 4 for behavior checks actually assigned to step 6. |
| Maintained-view residency | **Real, with a small clarification needed.** `snapback.online_only` supplies the missing override, and §2 incorporates the control’s runtime contract. State explicitly that omission retains the maintained view’s inherited residency; it does not apply the unpublished-table default. |
| Quarry exposure and generated source location | **Real at the contract level.** Remaining Quarry exposure is counted and generated source belongs in the build directory. CLI integration still needs an ownership contract for watching SQL and locating assets/generated clients. |
| Evidence quotations and LLP 4000 §13 | **Real.** The correction distinguishes unrestricted PostgreSQL from the proposed subset and preserves #19’s contrary evidence. |

One earlier finding is absent from this disposition table: the Snapback 5 fence documents still instruct implementers to follow the shelved runtime design. That remains unresolved.

**2. Every normative form-table row**

In these tables:

- **Sound** means the SQL form is structurally legal with the stated declarations/stubs, the indicated Quarry construct exists, and no additional material mismatch was found.
- **Baseline-dependent** means it relies on the future shared 3000.015 baseline, not this checkout’s unchanged binder.
- A syntax-valid statement can still fail PostgreSQL type checking or execution. Those are distinguished below.
- Abbreviated rows containing `…` require complete fixtures before their executability can be claimed.

| §3.1 row | Audit |
|---|---|
| Identity | **Sound.** Configuration-call semantics are explicit. |
| Effect | **High — wrong SQL spelling.** `from =>` uses a reserved keyword as an unquoted named argument. Quote it or rename it. Also distinguish bare `effect push` from an effect with an explicitly configured worker policy. |
| Viewer | **Sound.** The deliberate text-principal interpretation is explicit. |
| Principal column | **Sound.** |
| Required/optional reference column | **Sound.** Nullability, nominal reference and absence of FK existence/deletion enforcement are stated. |
| Bare ID | **Sound**, provided this remains distinct from a reference argument and the implicit table identity. |
| Scalar types, time and duration | **High — incomplete.** Ordinary spellings parse, but `timestamptz DEFAULT 0` does not type-check merely because Snapback stubs exist. Allowed interval units, precision and conversions also need definition. |
| Named formats | **Sound** as recognition of a named constraint, not arbitrary regex lowering. |
| Enum | **Sound** for literal enum/check forms. |
| Defaults | **Sound for `now()` and correctly typed literals.** The timestamp-zero problem also affects this row. |
| Media and `once` | **Sound for column declarations.** Required columns still need `NOT NULL`. Bounded media arguments need a corresponding argument rule; the column row alone does not supply it. |

The named-argument error follows PostgreSQL’s actual argument-name grammar and keyword classification. [PostgreSQL 17 grammar](https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/parser/gram.y), [keyword table](https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/include/parser/kwlist.h).

| §3.2 row | Audit |
|---|---|
| Ordinary unique | **Sound.** |
| Commented unique refusal | **Sound.** The hidden-collision restriction is preserved. |
| Immutable columns | **Sound.** This fixes the former GRANT mapping. |
| Search | **Sound** as an explicit word-prefix declaration. |
| Cap 50 | **Sound** as a cross-row extension. |
| Cap 1/composite cap | **Low — mislabeled.** These are the same cross-row extension, so `✓` should be `≈`, with the same difference as the preceding row. |
| Retained history | **Sound** through the explicitly inherited runtime contract. |
| Expiry | **Sound.** |
| Online-only table | **Sound.** No publication call means no table sync declaration. |
| Publication/residency | **Sound in principle.** The invalid `ALTER PUBLICATION` form is gone; inferred audience and `E_SYNC` are explicit. Freeze the horizon/recipient argument grammar and table/view defaults separately. |
| Maintained count/sum columns, including filtered count | **High — partial mapping.** Unfiltered count/sum can lower. Replacing a filtered maintained **column** with a materialized **view** does not preserve the column, row shape or bound schema. |
| Public reason | **Sound**, including the requirement that the composed read rule actually be public. |
| `written by` | **Baseline-dependent; sound by incorporation of 3000.015 §1.** The private default and explicit visibility opt-out are present. |
| Sequence | **Baseline-dependent.** The SQL expression is legal with a scalar immutable stub. The stated difference must also include provisional predicted values, settlement and reordering—not merely assignment and rejection of supplied values. |
| Enable RLS | **Sound** as a required declaration with Snapback’s explicitly different owner behavior. |

| §3.3 row | Audit |
|---|---|
| Read policy | **Sound** within the admitted probe grammar; non-recursion is stated. |
| Insert policy | **Sound for the admitted non-null expressions.** Transaction-created probes still need a complete spelling. |
| Delete policy | **Partial.** Its denial behavior is stated, but the SQL requirement for SELECT access in ordinary key-filtered deletes is another difference: Quarry can authorize a delete of an unreadable row. |
| Single-image update | **Sound under the immutable-dependency restriction.** Do not apply the simplification to expressions involving mutable focal columns. |
| Transition update | **High — incomplete.** Trigger-only permission and discarded `'CODE'` are unresolved. See finding A below. |
| Multiple/restrictive/ALL policies | **Sound direction, incomplete boundary cases.** Specify empty permissive sets and evaluate restrictive USING/CHECK clauses against their respective images. |
| Service-principal disjunction | **Sound.** Explicit principal equality preserves the service identity. |
| `through` | **Honest GAP.** No invented lowering. |

PostgreSQL applies SELECT policies when UPDATE/DELETE expressions require read access, and `RETURNING` introduces further visibility checks. Those differences matter beyond replacing a zero-row result with an error. [PostgreSQL CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html).

| §3.4 row | Audit |
|---|---|
| Activity union | **Sound.** The branch predicate and branch identity are retained. |
| Following | **Sound recognition target, with implementation constraints.** The binder needs its exact feed-view shape, including the edge key in the expected positional order. Cite admission as well as lifecycle requirements from 3000.013. |
| Follower count | **Sound** as an ordinary maintain, with absent-zero/hidden-null semantics. |
| Original-post count | **Sound.** `IS NULL` supplies the intended filter. |
| Received likes/recorded attribution | **Sound.** This correctly avoids claiming a live relational join. |
| Daily likes | **Sound** with the fixed UTC ordinal helper. |
| Row-keyed unread | **Baseline-dependent; sound by incorporation.** `count(x.id)`, member-keying, writer bound and pending recount are represented. |
| Online-only maintain | **Sound.** Explicitly retain inherited residency when absent. |
| `postCard` and shared shape application | **High — incomplete.** The standalone function can be typed with a declared result composite, but classification as a shape conflicts with the general STABLE-function/query rule. `activity_card(a activity)` does not automatically accept a row of the distinct `following` composite type. |
| Spread | **Sound for a present bound record.** Add a rule for named-field replacement, which the target’s `activityCard` uses; PostgreSQL expansion plus another identically named column is not that rule. |

The paragraph before this table also promises a call for a maintain’s **read rule**, but only supplies `snapback.online_only`, which controls residency. Either name the read-rule call and grammar or remove that promise.

| §3.5 row | Audit |
|---|---|
| Home | **High — invalid completed example.** Its outer syntax parses, but the argument type and composite-return structure are wrong. It also depends on the incomplete page rule. |
| Global | **High — partial.** Its source is now correct. It shares the composite-return/page problems, though its input row type can match `activity`. |
| Thread/reference argument | **Sound.** `%type` retention is explicitly a Snapback compiler rule. |
| People/bounded text argument | **Sound for the argument.** The full #19 branching query is not covered by the page-ownership sentence. |
| Matching | **Sound** when the argument names the actual relation/alias in scope. |
| Social profile | **Sound recognition target.** The qualified parameter and admitted `no_data_found` block fix the prior issues. Complete the object-return fixture. |
| Insights | **Partial.** `a..b-1` corrects the endpoint. The fixture still needs declared composites, initialized empty arrays and a precise bounded integer-range mapping. |
| Trending | **Partial.** Both time endpoints are corrected. The committed target has no cursor argument, while the general page rule requires one. |
| Streaming aggregates | **Medium — overbroad difference.** Null on meter cut describes query results. Jobs/mutations cannot consume an incomplete total and commit on that basis. State their refusal/rollback behavior separately. |
| Helpers | **High — incomplete example.** `language sql immutable` cannot express #19’s procedural `receiptState` loop. Specify the PL/pgSQL helper form and its body grammar. |
| Server mutation marker | **Sound**, once qualified operation-name resolution is defined. |
| Server-only SQL | **Honest GAP.** The former relief-valve claim is correctly removed. |

| §3.6 row | Audit |
|---|---|
| Insert if absent | **Sound mapping**, with the declared hidden-clash behavior. Preserve the distinction between successful insertion of a hidden row and conflict/no insertion when lowering `FOUND`. |
| Upsert | **High — underspecified admission.** `excluded`-only assignments are necessary but not sufficient to show that the insert image and Quarry’s update patch coincide. |
| Point update | **High — false engine claim.** An authorized update can change an unreadable row and return null. Unreadable does not universally imply `NOT_FOUND`. |
| Conditional point update | **Sound.** The pre-read and `E_CONFLICT`/`NOT_FOUND` distinction now match the guide. |
| Point delete | **Partial.** Missing-row behavior is right; an authorized hidden-row delete and its PostgreSQL difference also belong here. |
| Require | **Sound with the non-null boolean restriction.** |
| Emit with once key | **Sound.** `row(…)` fixes heterogeneous keys. |
| `elsif exists` | **Medium — contradicts the resolver rule.** In `l.post_id = post_id`, the unqualified name collides with a column. Qualify the function parameter or use a positional parameter. |
| Job/procedure | **Sound direction, incomplete admission description.** An unpaged stable top-level scan is the adaptive sweep. An explicitly paged prelude loop is not automatically another sweep. Preserve the guide’s distinction. |
| Cron schedule | **Sound for the enumerated period/offset forms.** State UTC interpretation and provide `cron.schedule` in the verification environment. Explicitly refusing 90-second/weekday forms is honest. |
| Qualified schedule target | **Medium — name mapping unspecified.** `insights_daily` is not mechanically implied by “module = file name”; normal snake-to-camel conversion produces `insightsDaily`, not `insights.daily`. Define a qualified SQL name or an explicit registry. |
| Presence controlling only emit | **Sound.** |
| After-insert rule | **Honest GAP.** |

**Forms still lacking concrete rows**

The broad statement that #19 is “covered or marked ✗” is false. These omissions need either a mapping or an explicit GAP; they should not be silently replaced with a different program.

| Source form | Missing contract and smallest repair |
|---|---|
| #19 `by byActorTime: actor, at` | **High.** No admitted named-index declaration exists, while `create index` is refused. Add a narrow spelling or mark it unsupported. |
| #19 dynamic `merge feedEvents … by byActorTime: [a] for a in actors` | **High.** No merge-lane SQL form exists. Replacing it with Following is not IR-equivalent. Add a form or narrow the coverage claim. |
| #19 `group(rows, 'emoji') { … }` | **High.** Local-list grouping, group keys/items and the shaped result lack a row. A maintained aggregate is a different operation. |
| #19 procedural `receiptState`, `reactionList`, `otherProfile`, `unread` helpers | **High.** Supply complete helper declarations covering loops, row arguments and table reads. Merely naming them in the SQL-helper row is insufficient. |
| #19 `first(…)`, returned unpaged shaped scans, list cardinality | **Medium.** Some may fit the general grammar, but no row specifies their result/null/meter behavior. Add representative fixtures for `findGroup`, `roster`, `typingNow` and `count(actors)`. |
| Target `activityCard` and #19 nested `messageCard` shapes | **High.** Nested point-shape application and replacement of `post`/`actor` fields are not given a concrete mapping. |
| Target `trending()` without a cursor; #19 `people` with two alternative returns sharing `c` | **High.** Supply both page forms explicitly. |
| #19 `[messages] <=50` argument | **Medium.** `snapback.id[]` plus a length bound does not carry `messages` as its element reference type. Add reference-element metadata. |
| #19 bounded media arguments and media metadata reads | **Medium.** Define argument bounds and the `snapback.duration` signature/stub. |
| #19 `created chats[.chat]` / `created messages[.message]` | **High.** A grammar token is present, but no executable policy example identifies the target table and focal key unambiguously. |
| #19 `readAt: time default 0`, duration helpers and `now + shortTTL()` | **High.** Supply valid PostgreSQL epoch and interval-returning spellings that lower back to the original millisecond operations. |
| Filtered maintained column in §3.2 itself | **High.** Give a generated-column macro with a filter; a separate materialized view cannot fulfill this row. |

All three 3000.015 additions now have rows. Their remaining obligations are baseline verification and complete statement of their inherited behavior, particularly provisional sequence values.

**3. Material defects and counterexamples**

**A. High — §3.3 transition row: a constraint is still being presented as a grant.**

Take #19’s receipts rule:

```quarry
update (old, next) <- old.principal = viewer
  or exists messages[id = old.message, sender = viewer]
```

Following the transition row produces a trigger but no permissive UPDATE policy. Following the combination formula then produces an empty permissive disjunction, so no update is authorized. Treating the trigger itself as permission would instead violate that formula.

Additionally, `raise exception 'SOME_CODE'` becomes a schema rule whose denial is the engine’s rule-denial error, not `SOME_CODE`.

**Smallest fix:** show the complete canonical bundle: explicit permissive UPDATE policies plus the conjunctive trigger. Define the empty-set identities. Restrict the trigger error spelling to the engine’s actual denial contract, or explicitly document that this form cannot preserve custom error codes. Do not claim both preservation and erasure.

The `before update` spelling itself is reasonable. The problem is its incomplete composition.

**B. High — §3.7 and §11(5): the null ruling does not close the semantic boundary.**

Consider a nullable timestamp:

```sql
where not (expires_at < now())
```

For a null `expires_at`, PostgreSQL’s predicate is unknown and excludes the row. The unchanged Quarry binder guards the ordered comparison against null, making the inner comparison false; `not` then makes it true and includes the row.

The relevant implementation is [the predicate comparison lowering](/Users/ccheever/projects/snapback-sb5-reviews/r4001c-astra/snapback4/crates/snapback4-lang/src/bind/program/expr.rs:352). The new refusal rule covers nullable equality and membership, not this case.

There are two further contradictions:

- `IS NOT DISTINCT FROM` is promised but absent from the admitted expression/policy lists.
- Rewriting `col = null` into `col IS NULL` changes PostgreSQL meaning. It is not a meaning-preserving alias.

**Smallest fix:** either reject all remaining nullable-expression contexts whose SQL truth behavior is not preserved, or specify compositional true/false lowering for the admitted subset. Add both null-safe equality and inequality spellings. Reject `= NULL`/`<> NULL` with a rewrite instead of silently canonicalizing them.

An engine change is **not inherently required** to preserve three-valued filtering over a bounded subset: the compiler can represent the conditions under which an expression is true or false using existing boolean/null operations. Whether that complexity is worthwhile is a scope decision.

**C. High — §3.4–§3.5: routine classification and return behavior remain ambiguous.**

Three concrete failures:

1. `activity_card(a activity)` receives `f following`. Those are distinct named PostgreSQL composite types; identical columns do not establish an implicit conversion.
2. A PL/pgSQL function returning `SETOF activity_card_t` selects one composite-valued column with `select activity_card(f)`. That is not the expanded tuple structure expected by this `RETURN QUERY` form.
3. PostgreSQL `RETURN QUERY` appends rows and continues. Quarry `return` terminates execution. Translating two successive `RETURN QUERY` statements into two Quarry returns silently drops the second result. [PostgreSQL control structures](https://www.postgresql.org/docs/17/plpgsql-control-structures.html).

The same section labels STABLE functions as queries, while the shape example is STABLE too. An implementer can reasonably expose `post_card` in `api.ts` or try to bind its row parameter as a query argument.

**Smallest fix:** define disjoint routine classes and recognition precedence. Provide complete, type-correct Home and Global fixtures with explicit row conversion/expansion. Admit terminal page returns—such as `RETURN QUERY …; RETURN;`—and reject accumulation. Define cursor association, including alternative returns sharing a cursor and first-page operations without a cursor parameter.

**D. High — §3.6 point update/upsert: the declared write semantics disagree with the control.**

The guide expressly permits a valid update to an unreadable row and says a still-hidden result is null. The engine resolves the target privately, then checks update authority. See [the rules card](/Users/ccheever/projects/snapback-sb5-reviews/r4001c-astra/snapback4/crates/snapback4-lang/src/guide/rules.md:45) and [the update implementation](/Users/ccheever/projects/snapback-sb5-reviews/r4001c-astra/snapback4/crates/snapback4-core/src/engine/write.rs:96).

Example: a row is readable only by its recipient, but another principal has explicit authority to patch its counter. The RFC predicts `NOT_FOUND`; the engine can accept the patch.

For upsert:

```sql
insert into t(k, a, b) values (key, new_a, new_b)
on conflict(k) do update set a = excluded.a;
```

Every SET uses `excluded`, but PostgreSQL preserves existing `b`. Lowering the entire insert image as Quarry’s patch changes `b`. The phrase “differing insert values” should not leave this recognizer implicit.

**Smallest fix:** incorporate the actual write-outcome matrix. For upsert, require an exact correspondence between the supplied insert fields and update patch, with explicit treatment of key fields and defaults; refuse unmatched forms.

**E. High — §3.1, §3.5 and §3.7: scalar conversions need a finite specification.**

The timestamp-zero example does not become executable through domain/function stubs. Likewise, #19’s `shortTTL(): 180000` cannot remain a bigint-returning SQL helper if its caller performs `now() + shortTTL()`.

The admitted expression list also leaves these boundaries open:

- `substr(s,i,n)` needs an end-index conversion, not just a one-based/start-index adjustment.
- PostgreSQL `least`/`greatest` accept forms and null behavior not covered by Quarry’s scalar two-argument operations.
- Calendar intervals, sub-millisecond values and infinite timestamps cannot simply be described as “milliseconds.”
- `snapback.hour`, `snapback.duration` and `snapback.created` appear outside the exhaustive stub inventory.

**Smallest fix:** register exact signatures, units, arities, nullability and conversion formulas. Use an executable epoch literal/helper for zero and an interval-returning SQL spelling for duration helpers. Refuse everything outside that finite table.

**F. Blocker — §4 equivalence gate: the specified oracle does not export the compared objects.**

[`snapback4 check --json`](/Users/ccheever/projects/snapback-sb5-reviews/r4001c-astra/snapback4/crates/snapback4/src/verbs.rs:216) prints counts, summaries, notes, optional plans/residency data and timing. It does **not** print the bound schema and complete program IR.

A query returning `1` and one returning `2` can have identical operation counts, types, read/cost summaries and `why` output. Thus a gate implemented from the named command can be green while behavior differs.

**Smallest fix:** add a test harness under `snapback5` that calls the unchanged `snapback4_lang::compile` on both named source trees and compares the actual bound schema, full programs, argument/result types and relevant API/work metadata. Define permitted normalization precisely. Keep the original `.q` side independent of the new printer.

Also require executed semantic witnesses for every admitted form, not just `≈` rows: Home is currently marked `✓` and still has defects. Creating a PL/pgSQL function alone does not necessarily exercise its embedded queries.

**G. High — §7 pre-test 1: the current stop rule already fires.**

The manifest contains Astra’s `clqfa_like_counter`, an `AFTER INSERT OR DELETE` trigger. §3.7 refuses all triggers except the restricted before-update transition form. §7 stops if **any counter instance anywhere** is refused.

This is visible directly in [the local Astra schema](/Users/ccheever/clique-full-20260905/lanes/astra-supabase/schema.sql:87). The RFC also explicitly says Muse’s `is_member` is inadmissible and then names it as a stopping case.

This is a real, enforceable stop rule; it is not an empirical uncertainty requiring a day to discover. The quantitative replay can still measure the extent of incompatibility.

**Smallest fix:** honor the stop and report that outcome to the author. If the intended experiment permits counter-trigger-to-maintain rewrites, register a different test that measures the extent and cost of those semantic rewrites. Do not classify them as renamings or quietly admit them after observing the failure.

The one-third threshold is correctly labeled an investment threshold, not a scientific falsifier. Its statement-count denominator still needs a fixed AST counting rule: splitting or bundling PL/pgSQL statements can otherwise change the percentage.

**H. High — §7 pre-test 2: passage need not demonstrate either writing ability or understanding.**

Two counterexamples:

- A writer produces a mostly empty backend containing nominal edit-window and read-mark functions. It has few refused statements because it attempts little functionality.
- Both arms answer only 1/15 scenarios correctly. The relative prediction threshold passes.

Publishing expected answers to the same writers makes the second measurement weaker still: copying the registered answers can yield 15/15 without predicting behavior.

**Smallest fix:** require common functional coverage before scoring refusal rates; keep expected answers hidden from writers; score predictions independently; add an absolute comprehension floor. Keep the 10-point and 3/15 margins as explicitly chosen investment tolerances, with inconclusive outcomes where the sample cannot discriminate.

Freeze the manifest and classification rubric before these tests, not in §9’s subsequent step.

**I. High — §8: the gate can still pass without showing the mechanism, or fail without refuting it.**

The symmetric SURFACE class is now sensible. The remaining problem is the **unit**.

One control note can split one difficulty into three phrases while a treatment note describes the same difficulty once. The strict count test passes without reduced burden. Conversely, both arms can mention zero surface difficulties even if SQL improves actual authoring; the current rule calls that a failure of reading A rather than absence of mechanism evidence.

**Smallest fix:** define deduplicated incidents or a fixed per-run rubric, and standardize opportunities to report difficulty. Register a meaningful reduction rule. Treat zero/zero as “mechanism not shown”; retaining a no-ship rule is compatible with that interpretation.

Two additional **Medium** issues:

- The 65% masking test lacks sample size and a held-out validation protocol after dictionary revision. Reusing the same held-out notes to tune the dictionary invalidates that check. Fix with a separate final audit set and report uncertainty.
- The quoted power numbers concern one mean-difference threshold, not the complete two-scorer/floors/mechanism conjunction. Optional N = 8 also has no fully registered extension rule while several clauses still specify three runs. Freeze the extension decision and final statistic before seeing N = 3.

Restoring the floor categories is good. Freeze their numerical margins, the mean/median comparator and the expected joint noise-trip rate before counted runs; the present statement that the rate “is stated” does not supply it.

**J. Medium — §2/§9 versus the Snapback 5 fence: implementers receive conflicting authority.**

[`snapback5/AGENTS.md`](/Users/ccheever/projects/snapback-sb5-reviews/r4001c-astra/snapback5/AGENTS.md:3) still calls LLP 4000 §4–§5 the runtime design of record and directs work toward treatment hooks. [`NOT-DOING.md`](/Users/ccheever/projects/snapback-sb5-reviews/r4001c-astra/snapback5/NOT-DOING.md:3) still bans authored sync/horizons and server markers that revision 3 explicitly retains.

**Smallest fix:** update these files as part of accepting the second bet, before assigning implementation work. This is not resolved by changing the RFC alone.

**4. Is the §4 pipeline bounded and correct?**

**The architecture is now bounded and credible. Its contract is not yet correct enough to implement mechanically.**

What is sound:

- `pg_query` supplies PostgreSQL syntax, not Snapback semantics.
- A separate resolver owns names, types, scoping and admission.
- Lowering targets the existing declaration AST.
- The document printer is explicitly new work.
- Parse/print/parse testing uses original Quarry inputs.
- The production binder, planner, engine and device remain unchanged.
- Unsupported constructs are refused rather than escaping into a different execution path.

A competent implementer could still build the following wrong while following the text:

1. Treat `check --json` summaries as full equivalence evidence.
2. Classify shape functions as public queries.
3. turn accumulating `RETURN QUERY` into terminating returns.
4. lose nominal table types in list arguments.
5. lower a named Following probe without the positional key structure expected by the feed recognizer.
6. apply table residency defaults to maintains.
7. generate correct `.q` once, then delegate to a development server that watches generated Quarry but never retranspiles changed SQL.
8. relocate effect paths or generated `api.ts` relative to the build directory and break the application.

The smallest additional pipeline contract is a finite routine/statement recognizer, the real bound-object comparison harness, and a wrapper manifest defining source files, module names, asset paths, generated-client destination and SQL watch/rebuild ownership. None requires a new engine.

**5. Answers to §11 questions 4–7**

- **4 — One spelling:** Keep the finite alias list, but remove `= NULL`/`<> NULL` from automatic meaning-preserving canonicalization. Diagnose and offer the null-test rewrite. Preserve the immutable-dependency condition on update-policy simplification.

- **5 — Null semantics:** Keeping Quarry’s total equality is a defensible bounded choice. The current implementation contract is incomplete: add null-safe equality/inequality to the grammar and close nullable ordering/boolean contexts. Do not state that preserving bounded SQL truth semantics necessarily requires changing the engine.

- **6 — Viewer:** `auth.uid()` returning a text-based `snapback.principal` is sound. It preserves service principals and makes the deliberate incompatibility with UUID-based Supabase code visible.

- **7 — Pre-test order:** Verification before pre-tests, and corpus replay before compiler investment, is correct. Freeze the corpus/rubric before replay and the cards before writing. However, the current corpus rule already yields a stop; present that fact to the author instead of treating a passing replay as an open possibility.

The revision’s strongest repairs are real: explicit residency calls, global immutability, nominal references, separate policy-image composition, recorded attribution, the three distinct maintained-view behaviors, withdrawal of the SQL escape hatch, and an independent original-Quarry comparison target. Those establish a plausible front-end architecture. They do not yet establish a complete lowering contract or a discriminating experiment.

**Overall verdict: NOT READY.**

## Revision 4 disposition pointer — 2026-09-25

The implementing lead recorded this round's dispositions in
[LLP 4001 §12](../4001-snapback5-sql-front-end.rfc.md#round-3-dispositions).
This is an append-only implementation note, not a new review or a changed
verdict. Step 3 verification follows separately; no fourth review was run.
