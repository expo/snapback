# LLP 1017: `cap` in Quarry and the complete fan-out — a schema cardinality invariant, the mutation loop that must cover its page, and the certified bound for hoisted ranges

**Type:** RFC
**Status:** Review (revision (b) folds a blind two-family panel — codex
gpt-6-astra at xhigh, grok-4.6 at xhigh, both NOT READY on revision (a),
§8; round 2 is a cross-read of this revision. Implementation is authorized
by the author's instructions of 2026-09-05, "ok do all that stuff please"
and "once you feel good about the RFC, go ahead and implement it".)
**Systems:** the Quarry front end
(`snapback2/packages/compiler/src/quarry/{parser,schema,catalog}.ts`), the
certificate and structural policy
(`snapback2/crates/snapback2-core/src/certificate.rs`,
`certificate_policy.rs`), the engine's constraint check
(`engine/runner_ops.rs`), successor admission (`successor.rs`), the corpus
(`snapback2/corpus`, `src/bin/export_corpus/`), the diagnostics tables
(`packages/compiler/src/diagnostics.ts`, `crates/snapback2/src/protocol.rs`,
`guide/families.source.json`), the Quarry reference
(`packages/snapback2/guide/{grammar,quarry,offline}.md` and their byte
budgets in `build.mjs`), the `chat` template and its compiler fixture, LLP
1001 §3 and §9
**Author:** Claude Fable 5.1, commissioned by Charlie Cheever 2026-09-05 in
session ("What is the right/best way to fix 1 and 2?", then "ok do all that
stuff please"), from an external critique of Snapback 2 verified line by line
against origin/main `873f1eb1f` (§0)
**Implementer:** codex gpt-6-astra (xhigh), lane `s2/cap-cert`
(`~/projects/snapback-s2`), orchestrated and landed by Claude Fable 5.1 —
§1 as its own landing first, §2–§4 after the panel
**Date:** 2026-09-05
**Revised:** 2026-09-05 (b — after panel round 1)
**Related:** LLP 1001 §3 (read and write states; the 2026-08-30 hoist
amendment) §9 (schema additions; `Constraint::Cap` exists in the engine
but is undocumented there until this RFC's lane amends it), LLP 1004 (Quarry is the
surface), LLP 1007 §8 ("bounds are punctuation"), LLP 1010 (write keywords;
`where` deleted), LLP 1011 B1 (opaque cursors; a cursor needs a total index),
LLP 1012 §3 (the delivery-log recipe that carries the loop), LLP 1016 §0 (the
"fan-out past ~50" row) D1 (a job is a chunked mutation) D8 (fan-out past
the bound is a continuation — the *unbounded* form, sequenced after the
bar; this RFC is the *bounded* form, today), LLP 0329.014.004 §2 (the
constraint vocabulary names `cap`) §3 ("`take ≤ cap`" in rule existentials)
§6 (the `job` kind), `rules/NOT-DOING.md` ("no diagnostic code without a
family, a site, a rewrite, and a page")

## Summary

An outside reader of Snapback 2 made three criticisms on 2026-09-05. LLP
1016 answers the third (no administrative plane). This RFC answers the first
two, which are smaller and true:

1. **The certificate goes soft on visibility-filtered ranges.** True of the
   number it prints, not of the engine. The runtime already spends at most
   `take + 2` rows on a range whose read rule hoists over the scanned
   prefix; the certificate reports the 10,240 ceiling for it anyway, because
   one substitution was keyed on "the read rule is not public" instead of
   "the read rule is not uniform". §1 keys it on uniformity. One line of
   logic, nineteen corpus certificates move to their real reserve, and the
   certificate is a cost model again for every prefix-keyed multi-tenant
   list. The ceiling remains, deliberately, for genuinely non-uniform
   ranges (LLP 1001 §3 as ruled).
2. **The chat template's `send` silently stops at the fifty-first member.**
   True, and easier to trigger than the critic said: the template's own
   seed file inserts membership rows under the system principal and skips
   the mutation-level `require` that holds a group under fifty. The engine
   has had a per-group cardinality constraint (`Constraint::Cap`) since the
   bounded-programs spike; Quarry cannot spell it. §2 gives it the spelling
   `cap 50 by conversationId`, binds it on every writer including seeds,
   meters it, and admits it on succession. §3 then makes the *class* of bug
   a refusal: in a mutation, a `for` whose rows come from a page — directly
   or through a binding — is admitted only when the certificate can prove
   the loop covers the group (a cap over the scanned prefix, a uniform
   rule, a literal bound at least the cap). Anything else refuses
   `E_STRUCTURAL_FANOUT` with the cap pasted. §4 puts the cap line in the
   template and the reference beside the loop.

What this RFC does not do (§6): no administrative plane (LLP 1016 owns it);
no runtime one-more-row probe (on a non-uniform range that is the
cardinality oracle LLP 0329.014.004 refuses); no application code on `cap`;
no maintained-count-backed cap check (a ticket).

## 0. The critique, verified

Every line the critic cited exists on origin/main `873f1eb1f`:

| Claim | Verdict |
| --- | --- |
| `certificate.rs:289` substitutes the 10,240 ceiling for any visibility-filtered range | True. `visibility_filtered_range` is set for any range scan on a table whose read rule is not `public`/`allow`, regardless of hoisting. The rule-probe line beside it keys on `nonuniform_range` (`!hoist`). Both landed 2026-08-30 (`8b6e2f662`, `39fe0c7d5`). |
| "every multi-tenant list" | Overstated, with a grain of truth the panel found. The critic's own example, `messages[conversationId]` under `read <- exists memberships[.conversationId, viewer]`, hoists: `runner.rs` probes one row, halts on a false verdict, and *traces* at most `take + 2` on a true one. The traced cost is the page. But the SQLite fetch for a protected scan is `remaining_examined`, unclamped (only public scans clamp to `take + 2`), so the physical read was as oversized as the printed bound. §1 fixes both. |
| "deep pages cost the full ceiling and return almost nothing" | True for non-uniform rules, and LLP 1001 §3 says so: "Rows beyond a hidden run longer than that budget are unreachable in the drain; the paved escape is the existing denormalize-the-scope rewrite." A ruling, not an oversight. |
| `send` does `for m in memberships[...] first 50` guarded only by `require #memberCounts[...] < 50` in `groups.q:16` | True (`templates/chat/snapback/messages.q:19`, `groups.q:16`; also `deliveries.q` `post`/`unsend`/`edit`, and the compiler fixture). |
| "No refusal. The `for` just ends." | True. `LoopDomain::Page` returns at most `take` rows; `E_FANOUT` covers argument lists, derived arrays, argument bounds, and recursion, never a page cut; a mutation's outcome is `Committed` or `Rejected`. |
| "You cannot say that in the schema" | True for Quarry today: `after insert` takes one `exists` (`parser.ts:169`); rules refuse `<` ("move the bounded comparison into a mutation require") and refuse `#` aggregates. False for the engine: `Constraint::Cap { by, max }` exists, is enforced in `runner_ops.rs`, is carried in the certificate's constraint checks, and has a corpus case. It has no Quarry spelling and no use. |
| "add a second path that inserts a membership without that require — an admin import, a fixture, a backfill" | The fixture path is the template's own `seed.ts`: rows go in as an upsert program under `system`, past every `require`. |

## 1. C1 — the certified bound for hoisted ranges

**The code.** `certificate.rs`, the bound synthesis after the per-site
summary:

```rust
let max_examined =
    if summary.visibility_filtered_range && summary.examined <= self.ceilings.examined {
        self.ceilings.examined            // 10,240
    } else {
        summary.examined                  // calls × (take + 2)
    };
let max_index_entries = /* same test, same substitution */;
let max_rule_probes =
    if summary.nonuniform_range && ... { self.ceilings.rule_probes } else { summary.rule_probes };
let max_steps = /* keyed on visibility_filtered_range again */;
```

`summary.examined` is already `calls × reserve` with `reserve = take + 2`
(the halo row and the n2 row a uniform scan fetches to decide completeness
and mint a cursor). `hoist = certificate_policy::uniform_visibility(schema,
scan)` is true when every field the read rule reads is pinned by the scan
prefix. `nonuniform_range = !hoist`. The runtime's budget is the
certificate's number: `remaining_examined = max_examined − trace.examined`
(`runner.rs`).

**The change.** Key `max_examined`, `max_index_entries`, and `max_steps` on
`nonuniform_range`, as `max_rule_probes` already is. Delete
`visibility_filtered_range` (field, two merges, one setter); it has no other
reader. The `@ref LLP 1001#3` gloss reads "non-uniform scans spend the
certified examined/rule-probe ceilings; hoisted scans certify their
reserve".

**Two repairs the panel found in the same lines.** (1) The scan summary
first accumulates the summaries of its prefix, `after`, and `before`
expressions — a nested point read there is its own site with its own
examined count, and every expression node is a step the runtime charges —
and then *assigns* `examined`, `index_entries`, `rule_probes`, and `steps`
from the scan's own figures, discarding that work. The ceiling's step slack
hid it for protected scans; public scans were already exposed. The four
assignments become saturating additions, with witnesses: a protected
uniform scan with a ten-node prefix at `take 1` executes without
`E_STEPS`, and a nested point read in a prefix keeps its examined count.
(2) `fetch_limit` clamps to `take + 2` only for public scans; a protected
uniform scan fetches `remaining_examined` rows from SQLite and processes
`take + 2`. The clamp now applies to uniform scans as well — a uniform-true
scan cannot use more candidates, a uniform-false scan fetches nothing after
its probe, and a non-uniform scan keeps the budget-sized fetch because
hidden rows consume budget. The certificate counts traced candidates; after
(2) the fetch is bounded by the same number plus the one probe row.

**The non-change.** A program with any non-uniform site still certifies the
ceilings, program-wide. That is the author's ruling of 2026-08-30 and its
rewrite (denormalize the scope into the prefix, or read a maintained
aggregate) is already pasted by `E_STRUCTURAL_COUNT`. Per-site budgets for
programs that mix hoisted and non-uniform sites are not proposed.

**Evidence.** Two frozen corpus cases in a new `export_corpus` module:
`hoisted-list-certifies-reserve` (a `messages` scan by conversation under a
membership rule, take 50 → `max_examined = 52`) and
`nonuniform-list-certifies-ceiling` (the same table, the rule reading a
field the prefix does not pin → `10240`). A Rust test asserts the same two
numbers from a hand-built schema. Eighteen corpus case files (and the
manifest that repeats them) pin `10240`; the fifteen whose range scans
hoist move to their reserve (`named-thread`, the critic's case, among
them), and the three whose only non-uniform site is a genuine one stay.
Point reads never set `nonuniform_range` and are unaffected either way.

**The spec.** LLP 1001 §3 gains one paragraph after "A non-uniform site is
capped-only regardless…": a hoisted site certifies its reserve; only a
program with a non-uniform site certifies the ceilings; the 2026-08-30
implementation keyed the substitution on any non-public rule, the runtime
never spent more than the reserve on such a site, and the certificate now
says so.

**Why it is right to land alone.** It aligns code to a spec already
written and changes no wire and no grammar. Its one runtime effect is a
smaller SQLite fetch, never a smaller page: a non-public hoisted scan's
fetch budget is `remaining_examined` (`runner.rs`, `fetch_limit`), which
drops from the ceiling to the reserve; the admitted-row loop already stops
at `take + 2`. The observable is that `snapback2 test`'s `"ceiling"` and
`guide`'s `maxExamined` become the number the engine actually spends.

## 2. C2 — `cap N by columns`

### 2.1 The spelling

```q
table memberships:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId
  cap 50 by conversationId
```

`cap <int> by <column>[, <column>]` is a table-block line, positioned
freely among indexes, invariants, and rules like `immutable`. The integer
is a literal ≥ 1. A table may carry several caps over different column
tuples (`by conversationId` and `by conversationId, role` are different
tuples and both bind); two caps over the same tuple refuse
(`E_SCHEMA_CONSTRAINT`, "memberships already caps conversationId"). It
mirrors `maintain x = count memberships by conversationId` — the same
`by`, the same reading: "at most fifty memberships by conversation". The
design RFC's vocabulary already names the word (LLP 0329.014.004 §2, §3).
Like `immutable`, `cap` is a table-block word, so a column cannot be named
`cap`; the grammar page says so.

### 2.2 The semantics (the engine's, unchanged)

At most `N` rows share the `by` tuple. Checked on insert, and on an update
whose `by` tuple changes (the destination group). Never on delete. The
check reads up to `N` rows through an index whose leading columns are the
`by` columns in order; when `N` already exist the write refuses
`E_CONSTRAINT` ("memberships cap 50 reached"), the transaction rolls back,
and the outcome is `Rejected` like any other constraint miss. Inclusive:
the fiftieth row is admitted, the fifty-first refused.

**One grouping key.** The `by` tuple of a row is computed by one function
used by enforcement, by the group-moving comparison on update, and by
successor counting, and it agrees with index grouping: an omitted optional
column and an explicit `null` denote the same group (`index.rs` already
normalizes omission to `Null`; the engine's cap arm today reads
`new.field(field)` and errors on omission, which the lane repairs). Schema
admission validates a cap whether or not any program writes the table:
non-empty, distinct, declared, indexable grouping columns; `N` a literal
within `u32`; and the enforcement index is recorded in the certificate's
index custody like every other constraint index. The lowering is the
one the TypeScript schema lowering already accepts (`lower/schema.ts`:
`{ cap: { by, max } }` → `{ Cap: { by, max } }`); the Quarry front end
emits that object from the new line.

**Index requirement, moved to `check`.** The check reads through *any*
index whose leading columns are the `by` columns in order (the runtime
takes the first such index); the template's `unique
byConversationPrincipal: conversationId, principal` satisfies `cap 50 by
conversationId`, so the invariant is not coupled to an index name. Today a
cap with no such index raises `RuntimeError::Schema` at write time, and
`validate_schema` ignores `Cap` entirely. It becomes a certification
refusal: `E_SCHEMA_CONSTRAINT`, "cap on memberships needs an index that
begins with conversationId", rewrite pastes `by conversationId`. A cap on
a maintained target refuses the same way (targets are engine-owned).

### 2.3 Every writer

Mutations, seeds, effect `then` bodies, and the successor rebuild all reach
`check_constraints`. The product seed path is `Registry::seed` →
`seed_program`, a sequence of upserts through the ordinary write path; an
upsert of a missing row calls `insert`, which calls `check_constraints`
with `Effect::Insert`, and `seed_write` skips *rules*, not constraints. So
a seed that places fifty-one new memberships in one conversation refuses
at `snapback2 dev`/`reset` with the same `E_CONSTRAINT`, naming the table
and the cap; a re-upsert of an existing row in the same group is an
update that does not move the group and is not counted. One template test
proves it. This closes the path the critic named and the one they did not
(the fixture). The one writer that does not reach the check is
`Engine::seed`, the raw `INSERT OR REPLACE` the corpus and the Rust tests
use; it bypasses rules and constraints alike and is not a product path.
It stays test-only and is named here so nobody mistakes it for one.

### 2.4 Metering

The certificate's `max_examined` is the runtime's budget, so a read the
certificate does not reserve makes the budget a lie. Each insert, upsert,
or update site into a capped table reserves `N` examined rows and `N` index
entries per call, per cap (`write_summary` reserves none today); the
runtime charges the rows the cap scan read to `trace.examined` (today it
records them only under `constraint_inputs`), and `assert_bounds` then
holds because the reserve is there. For the chat template: `memberAdd`
reserves fifty, `groupCreate` reserves forty-nine times fifty, `send`
reserves nothing new (deliveries are uncapped). A mutation whose capped
writes times `N` exceed the examined ceiling refuses `E_BOUND` at `check`
like any other over-budget program.

**The seed exception, stated here and not left to the lane.** The seed
program already runs under `write_rows: u64::MAX` because a seed is not an
ordinary program; with metering it would otherwise refuse any seed larger
than `⌊10240 / N⌋` capped rows at `check` with a bound error instead of the
cap's `E_CONSTRAINT`. `seed_program`'s ceilings therefore exempt
`examined`, `index_entries`, and `steps` the same way. The cap check itself
still runs for every seeded row. A follow-up ticket, not this RFC: when a
`maintain … count` exists over the same `by`, the check may read the
maintained row instead (one examined row, exact).

### 2.5 Successor admission

Every cap in the successor schema is validated against the
post-transformation rows in the successor transaction, after the migration
plan's drops have run and before the additive install — mirroring the
new-unique-index scan in `successor.rs` but not limited to new or lowered
caps. The panel's counterexample says why: two rows in different groups
satisfy `cap 1 by group`; a type-change migration drops `group`'s values;
both rows now share the `null` group and the unchanged cap is violated.
Checking every cap is the simple safe rule; the cost is one indexed scan
per capped table per succession. Any group above `N` refuses `E_SUCCESSOR_CAP` (family
`successor`, page `successor/migrations`) listing up to ten `{ table, by,
key, count }` entries, rewrite "raise the cap to at least {count}, or remove
rows from the group, then retry". The entries travel in a new additive
`cap_conflicts` field on `SuccessorRefusal`, not stuffed into
`UniqueConflict`'s `{ table, index, key }`; the certificate value model is
untouched. Removing a cap is additive; raising one is additive only in the
sense that it cannot fail the scan, which still runs. Never a silent
install of an invariant the data already violates.

### 2.6 The twin

The evaluator already enforces `Cap` on predicted writes
(`packages/evaluator/src/runner.ts`, the constraint arm) and its
certificate identity carries it (`certificate-identity.ts`), so a predicted
insert into a full group is refused locally exactly as the server refuses
it. This RFC changes nothing there.

## 3. C3 — a mutation's `for` over a page covers it

### 3.1 The defect class

LLP 1001 §3 refuses a count, an emptiness branch, or any absence-dependent
result taken from a capped-only site (`E_STRUCTURAL_COUNT`, "rules do not
leak hidden population structure"). A write loop over a page is the same
defect on the write side: the set of rows written is a function of where
the page was cut, and nothing in the outcome says so. The engine cannot
catch it at runtime without fetching one row past the bound, which on a
non-uniform range is exactly the cardinality oracle the design refuses. So
it is a certification refusal, like its read-side twin.

### 3.2 The rule

In a **mutation**, a `for` whose rows come from a page is admitted if and
only if it is **complete by cap**: the scanned table declares `cap N by
b₁…bₖ`; every one of `b₁…bₖ` is among the columns the scan's prefix pins
(the first `prefix.len()` columns of its index — order-free, so a longer or
differently ordered prefix that still pins every grouping column selects a
subgroup of at most `N` rows); the read rule is uniform over that prefix
(`uniform_visibility`); the loop's bound is a literal ≥ `N`; and the
mutation contains **no non-uniform range site anywhere**. Otherwise the
program refuses `E_STRUCTURAL_FANOUT` at `check`. The loop then covers its
selected range: the whole group, or the subgroup a longer prefix names.

**Why the last condition.** The examined budget is shared across a
program: `remaining_examined = max_examined − trace.examined` at each scan.
A non-uniform scan earlier in the same mutation certifies the ceiling and
may spend all of it on hidden rows, leaving the capped loop zero
candidates, and the mutation would still commit. When every site in the
program is a hoisted range, a public range, a point read, or a metered cap
check, each reserves exactly what it can spend, so the loop's reserve is
always there when it runs. The certificate marks the loop's read site
`complete: true`; the runtime asserts it — a complete site whose fetch is
budget-cut below `take + 2` rejects the whole transaction with the
existing trace-subset family instead of committing a partial fan-out. With
the certification rule that assertion cannot fire; it is there so an
accounting mistake is a loud rejection and never a silent skip.

**"Comes from a page" follows provenance, not IR shape.** A direct `for m
in memberships[conversationId] first 50 …` lowers to `LoopDomain::Page`;
the same page bound first (`members = memberships[conversationId] first 50
…` then `for m in members:`) lowers to `LoopDomain::DerivedArray` over a
binding, and a shaped page or a `merge` is a page too. The check resolves
the loop's domain to its origin through `const`/`let`/assignment and
shapes; if the origin is a page scan the rule above applies to that scan,
and an origin the check cannot resolve to a single page scan refuses with
the same code and a reason naming the binding. A `merge` origin refuses
outright: complete lanes do not prove that the first fifty of their union
cover the union, and there is no union proof to make. A rule keyed on
`LoopDomain::Page` alone would be bypassed by one `let`.

Why a uniform rule: a non-uniform rule skips hidden rows, so the loop can
leave the group uncovered even under a cap; the rewrite is the existing
one. Why a literal bound: an argument bound can be below `N` at runtime.
Why no exemption for read-only bodies: a `require` inside the loop is
skipped for the fifty-first row exactly as an insert is. Why `break` and
`return` inside the body are not policed: an authored early exit is not a
page cut. Why queries are untouched: a returned page is the contract, and
the envelope's `next` says where it was cut. Why argument lists, literal
ranges, derived arrays that do not originate in a page, and walks are
untouched: each already refuses `E_FANOUT` past its declared maximum.

**Why there is no cursor form.** Revision (a) admitted a second form, a
loop over `memberships[conversationId] after c first 50` with `c: cursor
?`, as "one page of a caller-driven drain". The panel showed it is the
silent fifty with a dummy argument: an absent `c` is the start of the
range (`runner.rs`, `after == Some(Value::Null)` → `None`), a mutation
cannot mint `next` (`result-page.ts` attaches a result-page site to queries
only) and returns `Committed`, never a page with a cut; and it is the
pattern LLP 1016 D1 rejected for jobs, "the cursor smuggled through
arguments and no certificate row saying it loops". It is gone. A chunked
mutation that returns its cut is a wire change and belongs to LLP 1016.

### 3.3 The diagnostic

`E_STRUCTURAL_FANOUT` — family `bound`, page `bound/loop`, rule "a
mutation population loop covers its selected range". Message: "`for` over
memberships.byConversationPrincipal at `<site>` may end before its range
does: `<reason>`". Each reason has its own executable rewrite, pasted with
the loop's real names and the disambiguating index where the table has
more than one candidate:

| reason | rewrite |
| --- | --- |
| "memberships has no cap over conversationId" | `cap 50 by conversationId` on `memberships` |
| "bound 50 is below cap 100" | `first 100` on the loop |
| "the bound is an argument" | a literal bound of at least the cap |
| "the read rule is not uniform over the scanned prefix" | the existing prefix repair: denormalize the rule's inputs into the index prefix (the `E_STRUCTURAL_COUNT` rewrite), not another cap |
| "`members` is not a single page scan" | write the scan in the loop head, or bind exactly one page |
| "a merge page has no union proof" | fan in at read (LLP 1010 A5) or, when LLP 1016 J3 lands, `enqueue job` |
| "the non-uniform scan at `<site>` can spend the budget this loop needs" | the prefix repair on that site |

When LLP 1016 J3 lands, every rewrite gains its second form, `enqueue job
{ … }`, for fan-out past any cap, and §3.2 gains an explicit admission for
a job's `chunk` loop, whose continuation is represented.

The check lives in `certificate_policy::structural_errors` beside
`E_STRUCTURAL_COUNT` (a new module; the file is at 1,357 of 1,500 lines),
so `snapback2 check`, the corpus, raw IR, and the twin's certificate all
see it. Plumbing, each with its site, family, guide, and rewrite: the
compiler's code union and family/guide/rule maps (`ir.ts`,
`diagnostics.ts`, `policy.ts`), an explicit arm in
`protocol.rs::certification_family_guide` (the code matches neither
`E_STRUCTURAL_COUNT` nor the `E_BOUND` prefix and would otherwise fall to
`opaque/subset`), one `families.source.json` row, and a
`first-attempts`-style fixture. `bound/loop` is already `E_UNBOUND_LOOP`'s
page; its text covers both.

### 3.4 The census

Seven loops on origin/main, all `for m in memberships[…] first 50 by
byConversationPrincipal` in a mutation: the chat template's `messages.q`
`send` and `deliveries.q` `post`, `unsend`, `edit`; the compiler fixture
`quarry-chat/messages.q` `send`; the Expo witness's
`scripts/witness-expo/expiry.q`; and the `edit` embedded in
`crates/snapback2/tests/owner_cases/offline_replay.rs`. One `cap 50 by
conversationId` line on `memberships` satisfies all seven: the index
begins with `conversationId`, the prefix pins it, the rule `exists
memberships[.conversationId, viewer]` reads only the pinned column, and the
bound equals the cap. No other fixture or template fans out inside a
mutation; the Clique fixture's `members[conv = c] first 50` is in a query.

### 3.5 What has no spelling after this, and where it goes

An uncapped write loop — "mark all my notifications read", a backfill, an
erasure, a five-thousand-member delivery — refuses. Its home is LLP 1016:
D1's `chunk` in a `job` for bulk work, D8's `enqueue job` for fan-out past
a bound, both sequenced after the loop bar. Until then the honest form is
the cap. This RFC and LLP 1016 compose: C3 is the refusal today; D8 is the
second admitted form later, and the template's `send` may move to it when
J3 lands, as 1016 proposes. Nothing here contradicts 1016.

## 4. The template and the reference

- `templates/chat/snapback/schema.q` and the compiler fixture
  `quarry-chat/snapback/schema.q`: `cap 50 by conversationId` under
  `memberships`.
- The five loops keep `first 50`. Bounds are punctuation (LLP 1007 §8) and
  the bound is now checked against the cap, so raising the cap to 100
  without touching the loops refuses every one of them — the coupling
  catches the drift the critic described.
- `memberAdd` keeps `require #memberCounts[conversationId] < 50 else
  GROUP_FULL`: the application-level code stays the friendly refusal; the
  cap is the invariant beneath it. `groupCreate`'s `members: [principal]
  <=49` stays (forty-nine plus the creator).
- The reference (`packages/snapback2/guide/`). Byte budgets are at the
  limit — `grammar.md` 2,304 of 2,304, `quarry.md` 14,308 of 14,336,
  `offline.md` 4,087 of 4,096 — so the lane raises them in `build.mjs` with
  a comment (grammar 2,560; quarry 15,360; offline 4,352), as LLP 1011 lane
  2 raised grammar, rather than compress a reference to fit a new
  invariant. Text: `grammar.md` names `cap N by cols` among the invariants;
  `quarry.md` §Types and tables adds "`cap N by a, b` holds every group at
  N rows; every writer, seeds included, refuses past it, and a successor
  that would leave a group over N refuses with a plan"; §Absence and bounds
  adds the rule of §3.2 in two sentences and names `E_STRUCTURAL_FANOUT`;
  the `send` snippet in `quarry.md` and the `edit` snippet in `offline.md`
  gain one sentence beside them: "The loop covers the group because
  memberships is capped at 50 per conversation." The fenced `q` snippets
  stay byte-identical to the template files (the guide gate).

## 5. Migrations, enumerated

- Existing Quarry apps: none refuse from §1 or §2 (a new spelling; no
  wire, grammar, or runtime change to what they write today). §3 refuses
  any mutation `for` over an uncapped page; in this repository that is
  the seven census loops, fixed by §4.
- The corpus regenerates. §1 moves fifteen certificates, and its two
  accounting repairs may raise `max_steps`/`max_examined` on cases whose
  prefixes carried work; the lane lists each. New frozen cases: §1 the two
  bounds, a ten-node prefix at `take 1`, a nested read in a prefix, two
  protected uniform calls; §2 a cap lowered from Quarry, a metered cap
  insert, a seed over the cap refusing, an omitted optional grouping
  column landing in the `null` group; §3 complete-by-cap admitted (direct,
  through a binding, and with a longer prefix), uncapped refused, let-bound
  page of unknown origin refused, merge origin refused, bound-below-cap
  refused, argument bound refused, non-uniform-rule refused, a non-uniform
  scan elsewhere in the mutation refused, the same loop in a query
  admitted. Successor cap admission (added, lowered, and unchanged under a
  type-change drop) is a Rust test (the corpus has no successor category).
  Frozen counts (`spike.rs`) bump.
- The certificate value model and `evaluator_version` are unchanged; no
  wire field is added or renamed. `SuccessorRefusal` gains an additive,
  defaulted `cap_conflicts` field.

## 6. Non-claims

- **Not the administrative plane.** Jobs, schedules, backfill, bulk delete,
  erasure: LLP 1016, after the bar.
- **No runtime one-more-row probe** to detect a truncated mutation loop.
  Redundant under §2 + §3, and on a non-uniform range it discloses hidden
  cardinality.
- **No `else CODE` on `cap`.** Constraints carry no application code;
  `unique` and `immutable` do not, and the mutation's `require` does. The
  panel is asked to challenge this.
- **No maintained-count-backed cap check.** A ticket (§2.4).
- **No per-site certificate budgets** for programs mixing hoisted and
  non-uniform sites (§1).
- **No cursor-driven mutation page.** Revision (a)'s form (b), dropped on
  the panel's finding (§3.2).
- **No change to queries.** A page is a page.

## 7. Sequencing and landing record

1. §1 with its two panel repairs, LLP 1001 §3, and this RFC at revision
   (b) — one landing, first, claiming the number.
2. Panel round 1 (blind, two families) on revision (a); revision (b) folds
   it (§8). Round 2 is a cross-read of revision (b) with both round-1
   reviews visible; revision (c) folds it if anything material remains.
3. One codex lane for §2–§4 with LLP 1001 §9 amended (`Constraint::Cap`:
   grouping key, enforcement, metering, admission; the §3.2 rule); verify
   out of the sandbox; a blind two-family code review of the landed diff
   with fixes applied; land with this RFC at Status Implemented, the
   commits recorded here.

Landing record: (to be filled).

## 8. Panel record

**Round 1, revision (a), both blind: NOT READY from both families.**
`llp/reviews/1017-cap-and-complete-fanout.{codex,grok}.md`.

Shared by both: form (b), the cursor-driven mutation page, is the silent
fifty with a dummy argument (a mutation cannot mint or return a cursor;
LLP 1016 D1's "smuggled cursor") — dropped. The §3 rule keyed on
`LoopDomain::Page` is bypassed by one `let` — now follows provenance.
The corpus inventory was nineteen; eighteen files pin the ceiling and
fifteen move — corrected. `E_STRUCTURAL_FANOUT` as a new code in `bound`
at `bound/loop`, checked in Rust: endorsed by both. `cap N by columns`,
prefix-index satisfaction, no `else CODE`, three spellings of fifty,
raising the guide budgets: endorsed by both.

grok alone: metering collides with the seed program's default examined
ceiling — the seed exception is now stated in §2.4; `Engine::seed` is a
test-only raw writer — named in §2.3; `E_SUCCESSOR_CAP` needs its own
payload — §2.5; the census is seven loops, not five — §3.4; the twin
already enforces `Cap` — §2.6; the family-guide arm must be explicit —
§3.3.

codex alone: the scan summary overwrites its prefix work (a pre-existing
under-budget the ceiling slack hid) and a protected uniform scan fetches
its whole remaining budget — both repaired in §1 before it lands; a
non-uniform scan elsewhere in the mutation can starve a capped loop — the
§3.2 budget condition plus a runtime assertion; optional grouping columns
need one canonical key — §2.2; a type-change migration can collapse groups
under an unchanged cap — every cap validated on succession, §2.5; schema
admission and index custody for caps — §2.2; reason-specific rewrites —
§3.3; a merge origin has no union proof — refused, §3.2; "covers its
selected range" — §3.2.

Disagreements between the families: none material. Both endorsed landing
§1 first; codex conditioned it on the accounting repair, which is done.
