# LLP 1020: Day two — evolution that stays additive, and ceilings a builder can read

**Type:** RFC
**Status:** Draft — proposal, binds nothing (`rules/RULES.md`: only implemented specs bind; implementer and date unassigned, the author's call). Written on the author's request of 2026-09-09 ("write up 3 LLPs or sub-LLPs to address 1 and 2 and 3") after the elegance assessment of 2026-09-08.
**Systems:** successor admission (`snapback2/crates/snapback2-core/src/successor.rs`, `successor_narrowing.rs`, `registry.rs`), the certificate and its policy (`certificate.rs`, `certificate_policy.rs`, `certificate/merge.rs`, `certificate/diagnostic.rs`), the Quarry front end (`packages/compiler/src/quarry/*`), the `why` verb (`crates/snapback2/src/why.rs`), the guide (`packages/snapback2/guide/`, `crates/snapback2/src/guide.rs`), `guide/families.source.json`, the day-two brief (`benchmarks/briefs/messaging-day2-evolution.md`)
**Author:** Claude (Fable 5.1), for the author
**Date:** 2026-09-09
**Revised:** —
**Related:** LLP 1001 §4 (successors), LLP 1016 D4 and J1a (narrowing, the fill job, the rename ruling), LLP 1017 (cap, complete-by-cap, fan-out), LLP 1010 §A5 and LLP 1011 (the merge), LLP 1018 (structural moves; "move four, evolution, is evidence-led only"), LLP 1002 §5 (what `dev` does on a schema change), `issues/20260907-snapback2-quarry-gaps-from-the-m7-migration-legs.md`, `issues/20260903-snapback2-loop-carried-rebind-underpriced.md`, `issues/20260903-snapback2-argument-ids-unbounded-in-certificate.md`, `issues/20260831-certified-output-ceiling-row-max-accounting.md`

## Summary

Snapback 2 is elegant on day one and hostile on day two. The first schema
change a real app makes — adding a case to an enum — is refused as a
destructive retype, and the paved workaround silently nulls every stored
value. Regrouping a maintain is refused as an index drop although the engine
rebuilds maintained targets transactionally anyway. A page over a capped
group reports `capped` although the cap makes it complete. And when the
certificate refuses a program, the builder learns the ceiling's name, not
where the cost came from or what to change.

This RFC proposes five rules and one instrument:

1. **Widening is additive.** A successor that only widens a type — a new
   enum case, a larger text or list bound, a required column becoming
   optional — applies in place. The classifier compares shapes for
   compatibility, not equality.
2. **Maintained targets are projections, not data.** Changing a maintain's
   grouping never produces a destructive plan; the target is rebuilt in the
   successor transaction as LLP 1001 already promises, and readers of the old
   grouping fail at `check`, which is where a type error belongs.
3. **`fill` makes the common narrowing one motion.** `col: T fill <literal>`
   backfills stored nulls in the successor transaction and then narrows; the
   four-step keep-optional / apply / job / re-apply dance stays only for
   computed fills.
4. **Complete by cap on reads.** A `first N` or `last N` over a group whose
   cap is at most `N` certifies `complete`, not `capped`.
5. **A maintained point read inside a shape is a point read.** It is priced
   as one examined row per outer row and is never `E_STRUCTURAL_COUNT`.
6. **`check --cost` prints the priced plan**, one line per read site and
   meter, each term with its source line, so a builder sees the product
   before the ceiling refuses it — and the two known unsound pricings are
   closed so the printed number is true.

The acceptance is a cold run of the day-two brief, which has never been run
against Snapback 2, plus the Clique M7 migration legs.

## Evidence

- **Adding an enum case is a retype.** `ColumnType::Enum { variants }`
  derives `PartialEq`, so `['text','image']` and `['text','image','poll']`
  differ and `plan()` emits `Drop::TypeChange`
  (`successor.rs:159-213`); the migration then drops the values and
  `additive_refusal` refuses the now-required column with
  `E_SUCCESSOR_COLUMN_REQUIRED` (`successor.rs:99-112`, `registry.rs:1010-1031`).
  The M7 ticket records the outcome on 0.0.19: "Making that changed column
  optional allowed the successor, but cleared the existing values to null."
  The rewrite still says "a job once J1b lands" although jobs shipped on
  2026-09-05.
- **Regrouping a maintain is a destructive plan.** The maintain's target
  table changes columns and indexes, which `plan()` classifies as
  `Drop::Column`/`Drop::Index` — "a destructive index drop that needs
  `--apply-migration` or a revert" (M7 ticket, item 4) — even though LLP 1001
  §4 says "any added, removed, or changed maintain causes each affected
  engine-owned target to be transactionally replaced".
- **Narrowing is four edits.** LLP 1016 J1a: refuse `E_SUCCESSOR_NARROWING`
  with `nullRows` and samples, paste a fill-job skeleton, then "declare `T?`,
  apply, run the fill job, then declare `T` and apply again"
  (`guide/operator.md:22-28`). Correct, and four times longer than the
  change.
- **`first N` over a cap-N group is `capped`.** Complete-by-cap exists only
  as a write-side rule for a mutation's `for` (LLP 1017 §3.2); nothing marks
  a read complete from the cap. The M7 ticket: "easy to mis-handle as 'no
  row'".
- **A nested maintained read in a page shape is `E_STRUCTURAL_COUNT`**
  (M7 ticket, item 2), because `Builtin::Count`/`CountCapped` are structural
  sinks (`certificate_policy.rs:308-310`) and the policy treats the read as
  a count over the scanned prefix rather than a keyed lookup per row.
- **Ceilings refuse with a name.** `Ceilings::default()`: examined 10,240,
  index entries 10,240, rule probes 10,240, steps 1,000,000, heap 8 MiB,
  output 1 MiB, closure 4 MiB, write rows 2,048 (`certificate.rs:60-72`).
  `E_BOUND`/`E_STEPS` say "`{name} {actual} exceeds ceiling {ceiling};
  product: {product}`" with a rewrite from the largest term
  (`certificate/diagnostic.rs:322-332`). Before the lazy merge landed, a
  500-follow feed refused at "examined 11,684 > 10,240; closure 5,860,100 >
  4,194,304" and a builder certified at 360 follows; a cold lane shipped
  product caps (feed over 12 follows, conversation list 40, thread pages 25)
  to get under `E_BOUND` (`issues/20260831-certified-output-ceiling-row-max-accounting.md`).
  The M7 builder's bulk job returned bare `E_STEPS`.
- **Two pricings are unsound.** A loop-carried rebind "certified at 68
  output bytes and served 1,020"; an argument id "priced at 151 bytes …
  served a 5,008-byte id" (the two 2026-09-03 tickets). A ceiling that
  under-prices is not a ceiling.
- **No guide page.** `guide.rs:14-26` lists no `successor` page; LLP 1017
  §2.5 names `successor/migrations`, which does not exist; the M7 ticket hit
  `E_GUIDE_UNKNOWN` asking for it. `families.source.json` covers only
  `E_SUCCESSOR_DESTRUCTIVE` and `E_SUCCESSOR_NARROWING`.
- **The day-two brief has never run.** `benchmarks/briefs/messaging-day2-evolution.md`
  ("no run yet; not calibrated") asks for a nullable `editedAt` on live
  rows, a pinned-messages feature with authority, and a pure refactor
  recorded step by step. The nearest evidence is a prepared diagnostic on
  0.0.14, not a builder trial.

## Design

### 1. Widening is additive

The successor classifier gains a compatibility relation `widens(old, new)`
alongside the existing `adding_once` and `is_narrowing`. A column whose type
changes is additive when the new type accepts every value the old type
accepted:

| old | new | additive |
|---|---|---|
| `enum(a, b)` | `enum(a, b, c)` — superset, any order | yes |
| `text <=N` / `text M..N` | larger `N`, smaller `M` | yes |
| `json <=N`, `bytes <=N`, `image <=N`, `video <=N`, `[T] <=N` | larger `N` | yes |
| `T` | `T?` | yes |
| `T?` | `T` | narrowing (unchanged: `E_SUCCESSOR_NARROWING`, or `fill`) |
| `enum(a, b, c)` | `enum(a, b)` | destructive: `Drop::TypeChange` with the rows holding `c` counted and sampled, the plan's rewrite "`fill`, or delete the rows" |
| `decimal S` / `money C S` | any change of scale or currency | destructive (values change meaning) |
| anything else | anything else | destructive, as today |

Widening applies in place: no row is rewritten, no index repopulated beyond
what the change touches. The corpus gains one case per row of the table,
both directions. Format words (`format handle`, `format url`) are
constraints on writes, not storage; adding or removing one is additive and
existing rows are not re-validated (a sentence on the successor page says
so).

### 2. Maintained targets are projections

`plan()` skips engine-owned maintained targets when computing drops. A
maintain whose grouping, kind, or source changes is rebuilt in the successor
transaction from the next generation's declarations — the behavior LLP 1001
§4 already specifies for added, removed, and changed maintains — and the
successor is additive. A program in the next generation that still reads
the old grouping fails at `check` with `E_QUARRY_UNKNOWN` naming the maintain
and its new keys; that is the only signal, and it arrives before any
database is touched. `E_SUCCESSOR_UNIQUE` still applies when the rebuilt
target violates a next-generation uniqueness (LLP 1001 §4's surviving-rows
validation is unchanged).

### 3. `fill`

A column declaration may carry `fill <literal>`:

```q
table messages:
  kind: enum('text', 'image', 'poll') fill 'text'
  editedAt: time ? 
```

Semantics: at successor application, every stored row whose value for the
column is null (or absent, for a new column) is written the literal in the
same transaction, before the column's type is enforced. With `fill`, `T?` →
`T` and a new required column on a table with rows are additive. The
literal must type as `T`; `fill` on an already-required column with no nulls
is a no-op and stays declared (it documents the default for the next
narrowing). The backfill is priced against `write_rows` like index
population is priced today: a table whose row count exceeds the ceiling
refuses `E_SUCCESSOR_FILL` with the count and the rewrite "run the pasted
fill job in chunks, then apply". Computed fills (a value derived from other
columns) keep the LLP 1016 J1a job path; the `E_SUCCESSOR_NARROWING` rewrite
now offers both: "`fill <literal>` for a constant, or the pasted job".

`fill` is one new word in the frozen inventory (LLP 1011 revision "one
spelling", B5); its `rules/NOT-DOING.md` § Moves line is part of the landing.
The stale "once J1b lands" text is deleted in the same change.

### 4. Complete by cap on reads

When a range read's prefix pins a group of a table with `cap N by <cols>`
and the read's bound is at least `N`, the certificate marks the site
`Completeness::All` for that group and the runtime reports `complete`. The
cap is enforced on every write (LLP 1017 §2), so the read cannot be cut
short by the bound; reporting `capped` was a lie in the safe direction. The
`why` line reads "`first 50 by byConversationPrincipal — complete (cap 50)`".
A non-uniform rule still yields `capped` (LLP 1001's rule for capped-only
sites is unchanged; the cap says nothing about visibility).

### 5. A maintained point read inside a shape is a point read

`messageCounts[.id]` inside a page shape is a keyed read of an engine-owned
row per outer row: it is priced as one examined row and one index entry per
outer row (N for a page of N), and it is never a structural sink. The policy
distinguishes a **count over a scan** (`count(range)` — still structural
when the scan is capped-only, LLP 1001 §"capped-only sites") from a **read
of a maintained aggregate**, which is total by construction (a missing group
is a typed zero, LLP 1011 revision "one spelling", B2). The Clique builder
who merged search on the client because of this refusal gets the server
answer.

### 6. Ceilings a builder can read

`check --cost [<op>]` prints, per program or per named operation, the priced
plan the certificate computed:

```
messages.search (query)                          examined  steps    heap    output  closure
  messages.q:18  merge messages … first 20        1,185     28,410   61 KiB  38 KiB  1.2 MiB
    memberships[viewer] first 50 by byPrincipalConversation   50 lanes × (20 + 2)
    heads + page reserve (LLP 1010 §A5)           (50 + 20 + 2) × (3·height + 4)
  messages.q:19  page { *, author: profiles[.author] }         20 point reads
ceilings                                          10,240    1,000,000 8 MiB  1 MiB   4 MiB
```

Each term names the source line and the declaration it came from (the
`first 50`, the cap, the shape's `*`). The same table is what `E_BOUND` and
`E_STEPS` print when they refuse, above the existing largest-term rewrite,
so the refusal and the instrument agree. `E_STEPS` gains the sourced product
`E_BOUND` already has. `why` on a served query prints the actual meter
readings beside the certified ones, so an under-priced program is visible
as a gap between the two columns.

Two pricings are closed so the table is true: a loop-carried rebind is
priced per iteration (the ticket's program certifies at its served 1,020
bytes), and argument ids are priced at the declared `id`/reference bound,
which becomes an admitted input length rather than a fixed 144 bytes.

The default ceilings do not move. The lazy merge already certifies a
500-follow feed at 1,025 examined; the remaining refusals in the evidence
are pricing errors and opacity, not a small budget.

### 7. Diagnostics and the guide page

- `guide successor` exists: one screen — what is additive (the table in §1,
  maintains, indexes, programs, rules, caps raised), what is destructive and
  what its plan looks like, `fill`, narrowing with a job, and the three-line
  `dev --status --json` / `--apply-migration` sequence. `guide migrations`
  is an alias of the same card. LLP 1017 §2.5's dangling name resolves.
- Families: `E_SUCCESSOR_COLUMN_REQUIRED`, `E_SUCCESSOR_UNIQUE`,
  `E_SUCCESSOR_CAP`, `E_SUCCESSOR_FILL`, and the enum-removal plan each
  get a `wrong`/`right` pair in `families.source.json`, in Quarry, with the
  executable rewrites LLP 1002's 2026-09-08 revision requires.
- Every successor refusal names the generation it compared against and the
  file:line of the declaration that caused it.

## What this does not do

- No rename operation: LLP 1016 D4's ruling stands ("add, fill, drop;
  reopen when a brief's migration count makes three steps a measured cost").
  `fill` makes the three steps cheaper; it does not merge them.
- No online schema branching, no multi-generation reads, no downgrade.
- No change to the ceilings' values, to the capped-only rule for
  non-uniform scans, or to the write-side complete-by-cap rule.
- No automatic destructive apply. "Never a prompt, never a silent drop, never
  a fresh database" (LLP 1001 §4) is unchanged.

## Acceptance

1. Corpus cases for every row of the widening table, both directions, with
   the engine and the twin agreeing on admission and on stored values.
2. The M7 migration legs' six items reproduce on the base and pass after:
   enum case added in place with values intact; maintain regrouped without a
   plan; `first N` over a cap-N group reports `complete`; a nested
   maintained read in a page shape certifies; `guide successor` answers.
3. `check --cost` on the chat template prints every operation under the
   ceilings, and the two ticketed programs certify at their served sizes.
4. A cold run of `benchmarks/briefs/messaging-day2-evolution.md` by one
   builder on the published package, recorded under `benchmarks/runs/`, with
   every restart, reload, and rollover step in the diary. The database is not
   dropped.

## Implementation (proposed lanes; sizes are the orchestrator's estimate)

| lane | scope | size |
|---|---|---|
| S1 | `widens` relation in `successor.rs` + corpus + the stale rewrite text | small |
| S2 | maintained targets excluded from `plan()` drops; rebuild path exercised by a corpus case | small |
| S3 | `fill`: parser, binder, IR, successor backfill, `E_SUCCESSOR_FILL`, inventory pin, NOT-DOING move line | medium |
| C1 | complete-by-cap on reads; maintained point reads in shapes | small |
| C2 | `check --cost`, sourced `E_STEPS`, `why` actual-vs-certified columns; the two pricing tickets | medium |
| G1 | `guide successor` page, families, executable rewrites | small |
| R1 | the day-two cold run and diary | one builder session |

Each lane lands with its tests and guide sentence under LLP 1002's loop;
S3 waits for LLP 1011's inventory pin so the new word is admitted
deliberately.

## Open questions (author)

1. Should enum case **removal** with zero rows holding the case be additive
   (it is safe) — or destructive on principle, because a later row could
   not be written back? Proposed: additive when the count is zero, with
   the count in the successor log.
2. Is `fill` the right word, or should the literal ride on the type
   (`enum('text','image','poll') = 'text'`)? Proposed: `fill`, because `=`
   is already binding, equality, and the named key.
