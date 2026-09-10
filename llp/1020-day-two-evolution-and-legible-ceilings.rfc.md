# LLP 1020: Day two — evolution that stays additive, and ceilings a builder can read

**Type:** RFC
**Status:** Accepted (author, 2026-09-10: "ok commit those then implement all of the RFCs"; implementer: codex gpt-6-astra lanes under the orchestrator, program directory `~/projects/snapback-ri-20260910`, plan and briefs there; date 2026-09-10; per `rules/RULES.md` it binds lane by lane as each lane's code lands, and the implementation record below names each landing. Part B (`fill`) stays gated on A8.4's measured number as the RFC states.) Written on the author's request of 2026-09-09 ("write up 3 LLPs or sub-LLPs to address 1 and 2 and 3") after the elegance assessment of 2026-09-08.
**Systems:** successor admission (`snapback2/crates/snapback2-core/src/{successor,successor_narrowing,registry}.rs`), the certificate and its policy (`snapback2/crates/snapback2-core/src/{certificate,certificate_policy}.rs`, `certificate/{merge,output,diagnostic}.rs`, `retention.rs`), the engine's scan and receipt (`engine/{scan,execution_record,receipt}.rs`), the Quarry front end (`snapback2/packages/compiler/src/quarry/{catalog,direct,bound-schema}.ts`), `check` and `why` (`snapback2/crates/snapback2/src/{check,why}.rs`), the guide (`snapback2/packages/snapback2/guide/`, `snapback2/crates/snapback2/src/guide.rs`), `guide/families.source.json`, the briefs (`benchmarks/briefs/messaging-day2-evolution.md`, `benchmarks/briefs/social-messenger.md` M7)
**Author:** Claude (Fable 5.1), for the author
**Date:** 2026-09-09
**Revised:** 2026-09-10 (Accepted; implementer and date assigned); 2026-09-09 (revision (a): a blind gpt-6-astra review at maximum reasoning, `llp/reviews/1020-day-two-evolution-and-legible-ceilings.r1-astra.md`, returned NOT READY: four of revision 0's premises were already false at the pinned commit (uniform reads over an exhausted group already report `complete` by lookahead; maintained point reads lower to `Get`, not `Count`; `E_STEPS` already carries the sourced product; ids are already bounded by `identity_fits`), the regrouping guarantee was impossible as stated, and `fill`'s budget was unsound. Those items are dropped or re-scoped; the increment the code supports today is Part A; `fill` moves to Part B, gated on measured cost; both open questions are resolved by the review's rulings)
**Related:** LLP 1001 §4 (successors; the maintain rebuild's exact projected-ID ownership), §"capped-only sites", LLP 1016 D4 and J1a (narrowing, the fill job, the rename ruling), LLP 1017 (cap, complete-by-cap for a mutation's `for`, fan-out), LLP 1010 §A5 and LLP 1011 (the lazy merge; the word inventory), LLP 1012 (the twin's continuity across generations), LLP 1018 (structural moves; "move four, evolution, is evidence-led only"), LLP 1002 §5 (what `dev` does on a schema change), LLP 1019 and LLP 1021 (sibling RFCs of the same day), `issues/20260907-snapback2-quarry-gaps-from-the-m7-migration-legs.md`, `issues/20260903-snapback2-loop-carried-rebind-underpriced.md`, `issues/20260831-certified-output-ceiling-row-max-accounting.md`, `issues/closed/20260906-snapback2-following-feed-merge-ceiling-under-brief-envelope.md`

## Summary

Snapback 2 is elegant on day one and hostile on day two. The first schema
change a real app makes — adding a case to an enum — is refused as a
destructive retype, and the approved destructive plan clears every stored
value of the column. Regrouping a maintain is refused as an index drop
although the engine replaces maintained projections transactionally
anyway. And when the certificate refuses a program, the builder learns a
ceiling's name and its largest term, but cannot ask for the priced plan
before the refusal, and the cost of a loop-carried value is under-priced.

**Part A — the increment the code supports today:**

1. **Widening is additive.** A successor that only widens a type — a new
   enum case, a larger text or list bound, a required column becoming
   optional — applies in place. The classifier compares shapes for
   compatibility, not equality.
2. **Enum-case removal is checked narrowing at application.** Additive
   when no stored row holds a removed case; otherwise
   `E_SUCCESSOR_NARROWING` with samples and a job rewrite. Never a
   column-clearing retype.
3. **Projection ownership is exact.** Replacing a maintain's projection —
   the union of predecessor and successor projected ids — is never a
   destructive plan; the successor log reports the old and new grouping;
   static refusal is promised only for real name, type, or index
   incompatibilities, because a positional read like `counts[viewer]` can
   keep resolving after a regroup.
4. **`check --cost` prints the priced plan** from the analyzer that already
   exists, with the meters it actually has, shared between admitted and
   refused programs; `why` prints the trace's measured meters beside the
   certified ones, labeled as measured or unavailable.
5. **Recurrence pricing is a bound.** A loop-carried rebind is priced so
   the static bound dominates every admitted execution.
6. **`guide successor` exists**, with families for every successor refusal
   and executable rewrites.
7. **The day-two brief and Clique M7 run cold**, on populated stores, and
   their diaries are the measure.

**Part B — deferred, evidence-gated:** `fill <literal>` as a successor
repair for constant backfills, commissioned only if Part A's cold runs
measure the four-step keep-optional / apply / job / re-apply recipe as a
real cost, and only with an installation-wide repair budget (§B).

Dropped from revision 0, with the reason: complete-by-cap on reads (a
uniform read whose lookahead proves exhaustion already stops `Exhausted`
and reports `complete`, `engine/scan.rs:349-356`; a non-uniform read stays
`capped` by LLP 1001's rule, and no cap may manufacture exhaustion);
"maintained reads in shapes are never structural" (they lower to a `Get`
plus a typed zero, `quarry/direct.ts:741-748`, so the M7 refusal has
another cause — Part A carries a reproduction item instead of a ruling);
sourced `E_STEPS` (`certificate/diagnostic.rs:278-332` already builds it);
argument-id pricing (`value.rs:329` `identity_fits` already bounds ids).

## Evidence

- **Adding an enum case is a retype.** `ColumnType::Enum { variants }`
  derives `PartialEq`, so `['text','image']` and `['text','image','poll']`
  differ and `plan()` emits `Drop::TypeChange`
  (`successor.rs:159-213`); the approved migration drops the values and
  `additive_refusal` then refuses the now-required column with
  `E_SUCCESSOR_COLUMN_REQUIRED` (`successor.rs:99-112`,
  `registry.rs:1010-1031`). LLP 1001 §4 exposes the plan and rolls back on
  refusal — nothing is silent — but the outcome on 0.0.19 was still
  "making that changed column optional allowed the successor, but cleared
  the existing values to null" (the M7 ticket). The rewrite still says "a
  job once J1b lands" although jobs shipped on 2026-09-05.
- **Regrouping a maintain is a destructive plan.** The target table's
  columns and indexes change, which `plan()` classifies as
  `Drop::Column`/`Drop::Index` (M7 ticket, item 4), although LLP 1001 §4
  and `successor.rs:754` replace exactly the union of predecessor and
  successor projected ids transactionally.
- **Narrowing is four edits.** LLP 1016 J1a: refuse `E_SUCCESSOR_NARROWING`
  with `nullRows` and samples, paste a fill-job skeleton, then "declare
  `T?`, apply, run the fill job, then declare `T` and apply again"
  (`guide/operator.md:22-28`). Correct, and four times longer than the
  change. Whether that length is a measured cost is what Part A's cold runs
  decide (LLP 1016 D4's rename ruling set the same bar).
- **Ceilings refuse with a name and a term.** `Ceilings::default()`:
  examined 10,240, index entries 10,240, rule probes 10,240, steps
  1,000,000, heap 8 MiB, output 1 MiB, closure 4 MiB, write rows 2,048
  (`certificate.rs:60-72`). `E_BOUND` and `E_STEPS` print
  "`{name} {actual} exceeds ceiling {ceiling}; product: {product}`" with a
  rewrite from the largest term (`certificate/diagnostic.rs:278-332`). What
  does not exist is the plan *before* refusal: `check` exposes no partial
  certificate for a refused program (`check.rs:313`), so a builder learns
  the product only by failing.
- **One pricing is unsound.** "A variable rebound inside the loop from its
  own previous value plus a row field is priced as a single iteration: the
  reviewer's program certified at 68 output bytes and served 1,020"
  (`issues/20260903-snapback2-loop-carried-rebind-underpriced.md`; the
  ticket carries no runnable program, so the first task is a reproducer).
  Output and retention growth handling is restricted to collection prices
  (`certificate/output.rs:118`, `retention.rs:429`).
- **The feed ceiling was pricing, and it was fixed.** Before the lazy
  merge, a 500-follow feed refused at "examined 11,684 > 10,240; closure
  5,860,100 > 4,194,304" and a builder certified at 360 follows; the lazy
  k-way heap now certifies 500 follows at 1,025 examined
  (`issues/closed/20260906-snapback2-following-feed-merge-ceiling-under-brief-envelope.md`).
  A cold lane earlier shipped product caps (feed over 12 follows,
  conversation list 40, thread pages 25) to get under `E_BOUND`
  (`issues/20260831-certified-output-ceiling-row-max-accounting.md`). The
  ceilings' values are not the problem; opacity and mis-pricing are.
- **The M7 refusals whose cause is unproven.** The M7 ticket records
  "nested `#maintain` in a page shape is `E_STRUCTURAL_COUNT`" (a poll
  tally) and `E_STEPS` on a bulk job, and says of the latter that the
  receipts do not establish their cause. Neither has a reproducer in the
  repository.
- **No guide page.** `guide.rs:14-26` lists no `successor` page; LLP 1017
  §2.5 names `successor/migrations`, which does not exist; the M7 ticket
  hit `E_GUIDE_UNKNOWN`. `families.source.json` covers only
  `E_SUCCESSOR_DESTRUCTIVE` and `E_SUCCESSOR_NARROWING`.
- **The day-two brief has never run.** `benchmarks/briefs/messaging-day2-evolution.md`
  ("no run yet; not calibrated") asks for a nullable `editedAt` on live
  rows, a pinned-messages feature with authority, and a pure refactor
  recorded step by step — none of which needs an enum case or a backfill.
  M7 (`social-messenger.md:694-711`) does: it requires existing messages,
  media, receipts, and reactions to survive the transition.

## Part A — design

### A1. Widening is additive

The successor classifier gains a compatibility relation `widens(old, new)`
alongside `adding_once` and `is_narrowing`, applied both in destructive
classification (`plan()`) and in required-column admission
(`additive_refusal`), composed recursively through `Optional` and `List`.
A column whose type changes is additive when the new type accepts every
value the old type accepted:

| old | new | additive |
|---|---|---|
| `enum(a, b)` | `enum(a, b, c)` — superset, any order | yes |
| `text <=N` / `text M..N` | larger `N`; smaller `M` | yes (`N` lives in the type; `M` and `format` live in constraints and are compared there) |
| `json <=N`, `bytes <=N`, `image <=N`, `video <=N`, `[T] <=N` | larger `N` | yes |
| `image … ` | `image … once` | as today (`adding_once`); removing `once` stays destructive (LLP 1006 §2a.1) |
| `T` | `T?` | yes |
| `T?` | `T` | narrowing (unchanged: `E_SUCCESSOR_NARROWING`, or the job) |
| `enum(a, b, c)` | `enum(a, b)` | checked narrowing at application (A2) |
| `decimal S` / `money C S` | any change of scale or currency | destructive (values change meaning) |
| anything else | anything else | destructive, as today |

Widening applies in place: no row is rewritten. Adding or removing a
`format` word or a text minimum is a constraint change on writes and is
additive; stored rows are not re-validated, and the successor page says so.

### A2. Enum-case removal is checked narrowing

Enum removal is not `widens`. At installation the successor transaction
checks every affected stored value — including inside `Optional` and
`List` wrappers — against the removed cases, exactly as the
optional-to-required walker does today (`successor_narrowing.rs:36`,
LLP 1016 J1a), records the compared generations, the removed cases, and
the affected-row count including zero, and:

- with **zero** affected rows, admits the successor as additive, with the
  zero in the successor log; every other admission check (uniqueness,
  caps, maintained addresses, typed references, generation fencing) still
  runs;
- with a **nonzero** count, refuses `E_SUCCESSOR_NARROWING` (family
  `successor`, the declaration's site, at most ten sampled row ids) with a
  rewrite to an explicit job that maps or deletes the affected rows under
  the predecessor schema; the page is `successor`.

Neither this refusal nor Part B's `fill` ever substitutes a value for a
removed non-null case. Queued client intents that carry a removed case
keep their bytes and receive the existing conflict/reset behavior (LLP
1001 §"queued intents across generations"); narrowing does not promise
that old clients can still write the removed value.

### A3. Exact projection ownership

`plan()` distinguishes, for a maintained target, the rows the engine owns —
the union of predecessor and successor projected ids (LLP 1001 §4,
`successor.rs:754`) — from any other rows of that table. Replacing the
projection when a maintain's grouping, kind, or source changes is not a
destructive plan; it is the transactional replacement LLP 1001 already
specifies. Whole-table removal of a maintain, and any change to non-owned
survivors, stay destructive with a plan.

Because Quarry resolves a point read positionally by key type and arity
(`quarry/catalog.ts:241,357`), `counts[viewer]` can keep compiling after
`counts` is regrouped from `sender` to `recipient` with its meaning
changed. So the successor log states `maintain counts: by sender →
by recipient` on every regroup, `dev --status` shows it, and `check`
refuses only what it can prove — a name, type, or index that no longer
exists. That is the honest signal; revision 0's "the only signal arrives at
`check`" was not.

### A4. `check --cost`

`check --cost [<op>]` prints the analyzer's priced plan for a program
whether it is admitted or refused, from the same terms the certificate
computes (`certificate.rs:355-416`), so a refusal and the report agree:

```
messages.search (query)            examined  index  probes  steps   heap   output  closure  writes
  messages.q:18  merge messages … first 20   <terms as the analyzer prices them, one line per term, with its source line>
  messages.q:19  page { *, author: profiles[.author] }   20 point reads
ceilings                            10,240    10,240 10,240  1.0M    8 MiB  1 MiB   4 MiB    2,048
```

The table's numbers are generated from a named fixture, never hand-written
(revision 0's `50 lanes × (20 + 2)` line described the pre-L10 pricing;
the lazy merge charges discovery plus heads plus one shared page reserve,
`certificate/merge.rs:70-135`). Per-site terms reconcile with the program
total and with branch maxima the way LLP 1001 §"products" defines; the
implementation exposes a partial certificate for a refused generation
(`check.rs:313` returns none today).

`why` on a served query prints, beside the certified column, the meters
the trace actually records — examined, probes, steps, derived scratch,
writes (`engine/receipt.rs:113`) — labeled **measured**, and prints
**unavailable** for heap peak and closure bytes, which no trace measures.
A gap between a measured meter and its bound is the visible symptom of an
under-priced program.

### A5. Recurrence pricing is a bound

A value rebound inside a loop from its previous value and a row field is
priced so that the static bound dominates every admitted execution: growth
per iteration times the loop's bound, across multiple self-occurrences,
nested loops, aliases, branches, and retained intermediates
(`certificate/output.rs:118`, `retention.rs:429` today restrict growth
handling to collection prices). The first lane task is a runnable
reproducer for the ticket's 68-versus-1,020 program; the acceptance is
bound ≥ measured on it and on a family of loop-growth fixtures with
maximum-width escaped values, not equality with one observed result.

### A6. The successor page and its families

- `guide successor` — one card: what is additive (A1's table, A2,
  maintains under A3, indexes, programs, rules, caps raised), what is
  destructive and what its plan looks like, narrowing with the pasted job,
  and the `dev --status --json` / `--apply-migration` sequence
  (`operator.md` and `job.md` lose their duplicated prose to it; budgets
  hold). `guide migrations` is an alias. LLP 1017 §2.5's dangling name
  resolves.
- Families: `E_SUCCESSOR_COLUMN_REQUIRED`, `E_SUCCESSOR_UNIQUE`,
  `E_SUCCESSOR_CAP`, the enum-narrowing refusal, and `E_STEPS` each get a
  `wrong`/`right` pair in `families.source.json`, in Quarry, with the
  executable rewrites LLP 1002's 2026-09-08 revision requires; the stale
  "once J1b lands" text is deleted.
- Every successor refusal names the generation it compared against and
  the `file:line` of the declaration that caused it.

### A7. Two reproductions before any ruling

- The M7 poll-tally refusal: reproduce a nested maintained read inside a
  page shape that refuses `E_STRUCTURAL_COUNT`; since the read lowers to a
  `Get` (`direct.ts:741`), the cause is elsewhere — most likely the outer
  scan's capped-only status making every dependent sink structural (LLP
  1001 §"capped-only sites"). Decide then whether a keyed maintained read
  keyed by the page's own row may be exempted **without** granting absence
  authority: an unreadable maintained row must still yield `partial` on
  receipt-only replay, never a fabricated server zero
  (`certificate_policy.rs:327`, LLP 1011 revision "one spelling" B2).
- The M7 bulk-job `E_STEPS`: reproduce, then price or rewrite.

## Part B — `fill` (deferred)

`fill <literal>` on a column declaration is a **successor repair, never
an insertion default**: when a new required column is installed on a table
with rows, or an outer optional wrapper is removed, the successor
transaction replaces that column's stored null or absent values with the
literal before final admission. The literal must satisfy the column's type
and write constraints; existing non-null values are preserved; a retained
`fill` is otherwise inert and seeds and later inserts must still supply
the value. Computed repairs and mappings of removed enum cases keep the
job path. It is one new word in the frozen inventory (LLP 1011 revision
"one spelling", B5; the pin is implemented, so the amendment is a NOT-DOING
§ Moves line with a named offset).

Part B is commissioned only if Part A's cold runs (A8 below) record the
four-step recipe as a measured cost, and only with these settled first:

- **An installation-wide repair budget.** Successor index population
  today iterates row batches with no ceiling (`successor.rs:488-624`), and
  a per-table row count is not a write bound: two fills of 1,500 rows,
  plus the maintained applications and timer writes a source update
  produces, exceed 2,048 physical writes while each table "passes". The
  budget is one number per installation covering every physical write
  (`certificate.rs:355-416` sums amplification the same way for
  mutations), with `E_SUCCESSOR_FILL` naming the count and the rewrite
  "install the optional column, run the pasted job in chunks, then
  narrow" — which is the existing recipe (`guide/job.md:3`).
- **The installation algorithm.** Where fill sits relative to narrowing,
  cap, uniqueness, maintained-ownership, and schedule checks
  (`registry.rs:969-1163`); ordering across watcher installation, explicit
  migration, and reopening; rollback; same-clock timer reconciliation.

## What this does not do

- No rename operation: LLP 1016 D4's ruling stands ("add, fill, drop;
  reopen when a brief's migration count makes three steps a measured
  cost"). A8 produces that count.
- No change to the ceilings' values, to LLP 1001's capped-only rule for
  non-uniform scans, to the write-side complete-by-cap rule of LLP 1017
  §3.2, or to what the runtime reports as `complete`.
- No online schema branching, no multi-generation reads, no downgrade, no
  automatic destructive apply. "Never a prompt, never a silent drop, never
  a fresh database" (LLP 1001 §4) is unchanged.
- LLP 1019's delivery log does **not** inherit A3: a custody log records
  send-time audiences that current membership cannot reconstruct; A3 covers
  count and sum projections only, and LLP 1019 §3 defines its own successor
  semantics.

## A8. Acceptance

1. **Successor tests in Rust** (there is no successor category in the
   shared corpus, and administrative succession does not run on the twin):
   installation, migration, and reopening for every row of A1's table in
   both directions; enum removal with zero and nonzero counts; nested
   `Optional`/`List` cases; mixed widening plus narrowing; a regroup with
   the log line and a positional read that keeps compiling; an injected
   failure proving rows, indexes, generation, and timers roll back
   together.
2. **Client continuity**: two clients and a cold reopen across a widening
   successor, queued old-generation writes carrying a removed enum case
   (bytes preserved, explicit conflict/reset state), a removed operation
   with a retained terminal, an absent maintained group and a hidden one
   (typed zero on the server, `partial` on receipt-only replay, no false
   `complete`).
3. **Certificate truth**: admitted/refused pairs around each meter, mixed
   uniform and non-uniform reads, a `first N` argument below the cap, the
   loop-growth family with bound ≥ measured, and agreement between
   `check --cost` and the refusal text on the same program.
4. **The product journeys, cold, on the published package**: Clique M7 on
   a populated store (media, reactions, receipts, tombstones, offline
   votes) checking preservation during the transition as well as after;
   and `messaging-day2-evolution.md` from a frozen starting artifact, every
   restart, reload, and rollover step in the diary; the database is not
   dropped. Their diaries record the count and length of every migration
   step — the number LLP 1016 D4 and Part B wait for.

## Implementation (proposed lanes; sizes are the orchestrator's estimate)

| lane | scope | size |
|---|---|---|
| S1 | `widens` in classification and admission; A1 table; stale rewrite text | small–medium |
| S2 | enum removal as checked narrowing; the successor log's regroup line; exact projection ownership in `plan()` | medium |
| C1 | `check --cost` from the analyzer; partial certificate on refusal; `why` measured/unavailable columns | medium |
| C2 | recurrence reproducer and bound (A5); the two A7 reproductions | medium |
| G1 | `guide successor` card and alias; families; duplicated prose removed | small |
| R1 | the M7 and day-two cold runs and diaries (A8.4) | two builder sessions |
| B1 | `fill` (Part B), after R1's number | medium, gated |

Each lane lands with its tests and guide sentence under LLP 1002's loop.

## Open questions (author) — resolved

1. *Should enum-case removal with zero rows holding the case be additive?*
   **Resolved 2026-09-09 (r1 review, confidence 96):** yes, as checked
   narrowing at installation with a logged zero count and every other
   successor check preserved; a nonzero count refuses toward a job, and
   nothing ever substitutes a value for a removed case (A2).
2. *Is `fill` the right word, or should the literal ride on the type
   (`= 'text'`)?* **Resolved 2026-09-09 (r1 review, confidence 92):**
   `fill`, meaning an idempotent successor repair that supplies no default
   to future inserts; `=` is already binding, equality, and the named key,
   and a default-looking spelling would invite omitting required values
   from seeds (Part B).

## Implementation record

- 2026-09-10 — commissioned; lanes and landings are appended here as each lands (the orchestrator, program `~/projects/snapback-ri-20260910/plan.md`).
