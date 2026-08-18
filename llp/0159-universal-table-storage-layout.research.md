# LLP 0159: Universal-table storage layout — Convex's engine-owned tables vs Snapback's per-table mapping

**Type:** Research
**Status:** Active
**Systems:** Storage, Query, Migrations, Portability, Authorization, Competitive analysis
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-03
**Revised:** 2026-08-03 (promoted Draft → Active by the author after
the two-round dual-family super-refine loop — round-2 Fable READY
recommended Active as this document's terminal research status, with
graduation to a Decision explicitly deferred to the recorded reopen
triggers; v0.3 content otherwise unchanged; the OQ4 pinning task and
OQ5 identity-requirement question remain open); 2026-08-03 (v0.3, super-refine round 2 close-out under the
author's two-round cap — these repairs are themselves unreviewed: the
axis decomposition added (§Axes) so layout is no longer conflated with
planner ownership, version retention, or migration protocol, with the
SQL-lowered universal-layout counterfactual named; the headline narrowed
to "do not remake now" with "low probability ever" relabeled an author
prior; F4 splits the two Convex incidents and drops "atomicity" for
replacement/reconciliation scope per LLP 0074's own bound; the live
matcher claim narrowed (membership-gated queries wake and resnapshot
authoritatively — the matcher does not evaluate membership predicates);
LLP 0087 restated as a Draft, gated plan; F2 gains the MVCC
retention/compaction cost; F6 restated against actual build state
(backups shipped, copy spiked, safe forking unbuilt, as-of absent);
unique-index physical precision fixed (no trailing `_id` on unique
keys); OQ4-as-candidate-not-substitute; identity-cost judgment labeled
as such; Related reconciled) — prior: v0.2 same day, round-1 fixes
(authorization coupling restated against LLP 0011's engine-agnostic
requirement; brownfield re-homed to LLP 0007; invented 0046 quote
removed; graduation counter-benefit added; Convex facts de-backticked
and pinned as prose-source; F5 recast as hypothesis; Confidence statuses
corrected)
**Related:** LLP 0007, LLP 0011, LLP 0018, LLP 0037, LLP 0046, LLP 0057, LLP 0072, LLP 0074, LLP 0080, LLP 0081, LLP 0083, LLP 0087, LLP 0102, LLP 0158, LLP 0160, LLP 0161

> **Brainstorm-grade.** This document weighs an architecture Snapback did
> not take, asks whether it should be retaken, and records the reasoning.
> It commits nothing. If the recommendation ever hardens into a choice, it
> graduates to a Decision with LLP 0037-style ratification.

## Summary

Convex stores every application's documents in a fixed set of
engine-owned physical tables — the underlying SQL engine never sees the
application's logical schema. The SQL database is used as a durable
ordered key-value/log substrate, and everything an application would
recognize as "a database" — tables, indexes, the query planner,
constraints, transactions' read/write sets, subscriptions — is
implemented by Convex's own Rust engine above it. Snapback does the
opposite (LLP 0007): each logical table is a real SQLite table with real
columns, real B-tree indexes, real `UNIQUE` constraints, and `NOT NULL`
enforcement, and the engine's planner executes our queries.

The thesis in one line: **the universal layout buys always-on
logical/physical indirection; Snapback bought migration-time
indirection** (LLP 0081's staged generations). The corrected analytic
frame (§Axes) is that "Convex's architecture" bundles at least four
separable choices, and only one of them is the layout — so this
document credits and charges the layout only for what the layout itself
forces. Conclusion up front: **do not remake Snapback now — no present
requirement justifies a rewrite**, and the author's prior (a value
judgment recorded as such, not a finding) is that the probability this
is ever right for the paved path is low. Four falsifiable triggers
would reopen the question, and one roadmap corner (§F5's hypothesis)
could someday justify a universal store as an *additional* profile
rather than a replacement.

## Axes: what is actually being compared

"Adopt Convex's architecture" conflates four independent choices:

1. **Physical layout** — application-shaped tables vs. engine-owned
   generic tables. This is the only axis this document's title names.
2. **Planner/executor ownership** — who plans queries. A universal
   layout does *not* force a custom executor: a *SQL-lowered universal
   profile* is a live counterfactual in which Snapback's existing query
   IR lowers to SQL over generic document/index tables (the IR→SQL
   lowering discipline already exists in-tree), native
   `UNIQUE(index_id, encoded_key)` indexes keep engine-enforced
   race-freedom, and SQLite/Postgres still plan execution. Convex chose
   to own the executor; the layout permitted it, not required it.
3. **Version-retention model** — current-state storage vs. retained
   MVCC history. Independent of layout: LLP 0161 concludes historical
   representation can layer above SQLite either way.
4. **Migration protocol** — barriered maintenance-window vs. online
   dual-write. Also independent: LLP 0081's OQ4 asks the online
   question *on the per-table layout*.

Findings below mark each cost/benefit **layout-forced**,
**Convex-specific** (their choice on axes 2–4), or **available on
either layout**.

## The two layouts, precisely

### Convex: universal tables

What the public record establishes `[observed — "How Convex Works"
(stack.convex.dev/how-convex-works) and the convex-backend architecture
overview (github.com/get-convex/convex-backend), accessed 2026-08-03;
prose sources, not verified against the repository's schema source
files]`:

- The backend is a Rust engine implementing OCC serializable
  transactions, MVCC document versions, its own index maintenance, and
  read-set-based subscriptions (axes 2–3 choices). User functions run
  in V8 isolates with a typed syscall interface into that engine.
- Durability is a write-ahead log persisted through a *persistence
  abstraction*: SQLite for the local/open-source backend, Postgres or
  MySQL for self-hosting, and managed MySQL for the cloud product
  (reportedly since migrated toward PlanetScale Postgres — a
  no-analytic-weight detail). The persistence-abstraction claim *does*
  carry analytic weight in F2 and inherits this block's Medium,
  prose-source confidence; OQ4's pinning task covers it.
- The persistence layer holds a fixed, application-independent set of
  engine-owned tables — documents, indexes, and globals/log-style
  metadata (the sources describe four; exact physical names and whether
  the unit is per deployment, per persistence database, or per cluster
  are **not pinned here** — see OQ4). Logical tables, indexes, and
  schema validation exist only in Convex's layer.

### Snapback: per-table physical mapping

What LLP 0007 specifies and the SQLite implementation ships
`[confirmed — LLP 0007 (Draft document; behavior shipped in
`crates/snapback/src/storage.rs`)]`:

- Each declared table is a physical SQLite table; each portable field
  maps to exactly one physical column type via the single-sourced type
  map (the Valet lesson).
- Indexes are real engine indexes — non-unique physical indexes append
  the implicit trailing `_id` component for stable scan order, while
  unique physical indexes cover exactly the declared fields (a trailing
  `_id` would defeat uniqueness); required fields physically install
  `NOT NULL` atomically. LLP 0007's Index Contract shows the split this
  document cares about: the engine's unique index resolves the insert
  race at the serialized commit, while the cross-target portability of
  the invariant (non-optional key fields against SQL NULL-duplicate
  semantics, stable diagnostics) was Snapback specification work.
- System fields (`_id`, `_version`, `_createdAt`, `_updatedAt`) are
  columns; the commit-version stream, change journal, and changesets are
  Snapback-owned tables alongside.
- The same contract is *designed* to hold on Postgres after graduation
  (LLP 0046) — designed, not proven; see F2 and Confidence.

## Findings

### F1. The universal layout's core yield is DDL-free logical schema change

**Layout-forced benefit.** In a universal store, a schema change writes
no DDL: the logical schema is data, documents were never physically
shaped by it, and index builds are engine-managed background jobs. That
is the structural reason schema evolution with connected clients can be
Convex's normal case while LLP 0081's first profile is a
maintenance-window design. Precision matters here: universal storage
makes many logical schema changes DDL-free, but it is **neither
necessary nor sufficient for online migration** — Convex still needed
OCC/MVCC (axis 3) and background validation/backfill protocols (the
cost is relocated into engine-managed background work, not eliminated),
and Snapback's maintenance-window posture is LLP 0081's *declared* v1
scope, with OQ4 holding the online question open on the per-table
layout. `[inferred — architecture reading; consistent with diary
0029's Convex round and LLP 0074 §Priority 5]`

Note what LLP 0081 already owns: `StageTableGeneration` and the shadow
generation machinery give Snapback *logical/physical indirection exactly
when a migration needs it*, without paying for indirection on every read
the rest of the time.

### F2. The costs — split by what forces them

Snapback already runs engine-external machinery alongside SQLite — the
change journal, commit-version stream, and live matcher — so the honest
frame is "how much *more* engine we'd own," not "engine vs. no engine."

- **Query planning and execution — Convex-specific, avoidable via the
  SQL-lowered counterfactual.** Convex wrote its own executor and spent
  years of Rust optimization there; diary 0029's SpacetimeDB round
  shows the failure mode of owning this badly ("easy to write a secure
  but expensive view without a query planner explaining the cost"). A
  SQL-lowered universal profile would keep the native planner — at the
  price of every logical query becoming joins over generic tables,
  whose plan quality and latency are unmeasured (a real cost, just a
  different one).
- **Constraints — mostly avoidable.** A generic index-entry table can
  still use native `UNIQUE(index_id, encoded_key)`; what moves up is
  encoding correctness and constraint *semantics* (which writes must
  maintain which entries transactionally), not race-freedom itself.
- **The snapshot half of authorization evaluation — layout-forced in
  the custom-executor variant; restated for the SQL-lowered variant.**
  LLP 0011's requirement is deliberately engine-agnostic: rules must
  stay compilable into *the query plan* — a predicate over (document,
  resolved auth context) that the storage **and matcher** layers can
  evaluate in-plan, at snapshot and live-delta time. Today, shipped
  behavior is narrower than "the whole strategy": the snapshot path
  lowers closed filters and membership predicates into SQLite
  `WHERE`/`EXISTS` clauses; the live matcher directly evaluates
  ordinary auth-valued plan filters, while **membership-gated queries
  take dependency-aware wakeup plus authoritative SQL resnapshot** —
  the matcher does not evaluate membership predicates itself; and
  LLP 0011's general permission language is not yet built. Under a
  custom executor, the snapshot half moves into our engine (a subset of
  the planning cost above); under the SQL-lowered variant it survives
  as lowering onto generic tables — harder joins, same discipline. The
  rule IR, auth projection, and matcher semantics survive in every
  variant. `[confirmed — LLP 0011 §pushdown requirement; matcher and
  lowering behavior verified in-tree 2026-08-03]`
- **Version retention — a cost of axis 3, charged when F6's benefits
  are claimed.** Retained MVCC history brings version garbage
  collection, log compaction, storage amplification, and backup-size
  growth — engine-owned background machinery an adopter must build and
  operate. Any accounting that claims F6's benefits owes this line.
- **Inspectability — layout-forced loss at the logical layer.**
  Standard tools against a universal store still see physical tables
  and SQL transaction behavior; what they cannot interpret is the
  *logical* layer — the application's schema, index semantics, and
  query plans. That logical layer is what diary 0029's Supabase round
  praised having native access to, and what its lesson line asks
  Snapback to make "one command" (adopted as LLP 0160's Moment 7; an
  aspiration, not a shipped claim). Physical operational tooling
  (backup, replication, monitoring) transfers either way — the loss is
  logical, not operational.
- **Brownfield — layout-forced narrowing.** LLP 0007's brownfield lane
  — opening a database with foreign tables, with LLP 0057's dormant
  `_auth_*` collision rescue as its narrow sub-case — survives
  *coexistence* under a universal store, but Snapback's own data stops
  being adjacent, inspectable, ordinary SQL that brownfield tooling can
  reason about.
- **Postgres graduation — both sides, and an honest label.** The
  benefit: a universal layout shrinks LLP 0046's graduation toward a
  persistence-adapter swap (per Convex's reported abstraction —
  Medium-confidence prose-source fact), where 0046's per-table path
  requires the storage-seam extraction it calls its largest single
  engineering cost. The cost: LLP 0046's proposal maps fields and
  indexes into native, application-shaped Postgres DDL; under a
  universal layout that application-shaped outcome is abandoned and
  graduation would need re-ratification. LLP 0046's stated goals are
  portability, scale, and conformance — it does not itself declare
  application-shaped DDL an identity requirement, so **judging the
  identity cost larger than the adapter saving is this document's
  author value judgment**, recorded as such (OQ5 asks whether any
  governing LLP should own that claim explicitly).
- **Conversion — one-time but real.** Remaking the paved path means
  converting every existing Snapback database and running dual formats
  through a deprecation window — a cost class this corpus knows well
  (LLP 0081 exists because in-place rewrites are hard).

### F3. Each layout is honest about a different failure domain

Under either layout the physical engine still supplies atomic
transactions, physical isolation, durable storage of its own keys, and
crash recovery. What the custom-executor variant moves up into the
vendor's own code is the *logical* layer's correctness:
application-level serializability (their OCC choice), logical index
consistency, and logical constraints — in Convex's case, young(er) Rust
code where Snapback rents the equivalents from SQLite's decades of
hardening. (The SQL-lowered counterfactual splits the difference:
native planning and uniqueness, custom encoding and maintenance.) Our
own stress-testing gap analysis (LLP 0160 G8; migration tests never
exceed single-digit rows) cuts both ways: we do not currently have the
fault-injection infrastructure that *validating* a bespoke
index/constraint layer would demand. `[observed — test inventory,
2026-08-03]`

### F4. Deployment-global coupling is a related but separable choice

Two dated incidents, one failure class: deploying one arm's schema
removed another arm's indexes in the demo matrices (LLP 0074
§Priority 5; diaries 0016/0017), and again in the upload bakeoff
(LLP 0102 provider-limit note; diary 0048). The controlling corpus
bounds the inference — LLP 0074 states the incidents prove
**deployment-global replacement and reconciliation scope** for root
applications and explicitly do *not* prove deploy atomicity, and
LLP 0102 calls the behavior "a coherent Convex design… a method
constraint, not a product defect claim." Universal tables make
deployment-as-unit natural but do not force it. Snapback's per-target
identity discipline (LLP 0072 audiences) is independent of layout and
should be kept regardless.

### F5. A workload hypothesis where a universal store could earn its keep

**Hypothesis, not an LLP 0087 implication — and 0087 is a Draft, gated
plan whose end state is "a target, not a commitment."** LLP 0087's
direction makes app *code artifacts* data loaded at runtime; it
deliberately keeps app rows in the coordinator's existing SQLite and
excludes moving app-data ownership into facets. But the broader
apps-as-data direction could eventually produce a workload of many
small, programmatically created, high-churn schemas with low per-table
row counts — the shape universal stores are good at, and the shape
where the per-table layout's first measurable wall would be SQLite
schema-catalog scale (thousands of tables: `sqlite_master` bloat,
prepared-statement churn, per-table page overhead). No such workload is
measured or committed today. If it materializes, the right move is a
*separately named storage profile* for that workload (opt-out
vocabulary in the spirit of LLP 0081 §3's target-profile opt-outs), not
a relayout of the paved path — and LLP 0087's own current topology
(per-facet isolated SQLite as scratch) is corpus evidence for the
competing answer: many small ordinary SQLite files, which LLP 0018's
instance boundary already makes cheap. `[hypothesis]`

### F6. The benefit this analysis must not omit: versioned-log forking and time travel

An immutable MVCC document log (axis 3, which the universal layout
makes natural) also buys point-in-time reads, cheap incremental export,
and near-copy-free forking — the LLP 0158 and LLP 0161 territory. The
honest current-state comparison on the Snapback side: byte-level
backup/restore is shipped; O(1) cold-file copy is *spiked* (LLP 0158,
an experimental RFC committing no implementation); safe instance
forking (identity mint, quarantine, custody) is designed but unbuilt;
bounded per-record post-images exist in the journal; and arbitrary
database-wide as-of is absent (LLP 0161 rates it a Large gap). So the
rebuttal is **not** present feature parity — it is that (a) no measured
demand for as-of/sub-file branching exists yet, and (b) LLP 0161
concludes the agent-facing ideals can layer above SQLite when demand
arrives. If fork/as-of demand outgrows what file-level cloning and
journal retention can serve, that is exactly Trigger 4.

## Should we remake Snapback around it?

**Do not remake now — no present requirement justifies a rewrite.** The
benefits divide into (a) DDL-free schema change, where the online
half's honest pursuit is LLP 0081 OQ4 — **a candidate investigation,
not an available substitute**: no dual-write protocol is specified or
costed anywhere in the corpus today; (b) engine portability — three
tiers: portable semantics *specified* (LLP 0007), the SQLite
implementation *shipped*, second-engine portability an *untested
promise* (LLP 0046's own words: no storage abstraction exists in the
code today). A universal layout would make that promise cheaper to keep
— F2 credits it — at the price of the application-shaped outcome, a
tradeoff this document judges (as labeled author judgment) against the
layout; and (c) fork/time-travel (F6), where demand is unproven and
layering is available. The author's prior that this is *ever* right for
the paved path is low — but that is a prior, not a demonstrated bound,
and the SQL-lowered counterfactual (§Axes) is the variant any future
reopening should evaluate first, since it avoids the largest costs this
document charges to the custom-executor variant.

Triggers that would reopen this question:

1. Online, zero-downtime migration becomes a top-tier product
   requirement and the LLP 0081 OQ4 investigation *fails on the
   per-table layout* — witnessed by a failed spike recorded as an LLP
   (that artifact, not sentiment, is the trigger).
2. An apps-as-data workload (F5's hypothesis) materializes with
   measured per-app DDL churn or catalog-scale pain.
3. Hosted-target evidence shows per-table DDL is operationally worse
   than row-copy at the scales that matter (none exists today — OQ3's
   question; LLP 0160 G8's stress fixture is a prerequisite, currently
   unowned).
4. Fork/as-of demand outgrows file-level cloning and journal retention
   (F6) — e.g., a real need for fork-at-arbitrary-past-version that
   LLP 0158-style whole-file forks cannot serve.

## Confidence

**Medium** on the Convex architecture facts: prose engineering sources
accessed 2026-08-03, honestly labeled, not verified against the
open-source repository's schema files; the physical-table scope is
unpinned and the persistence-abstraction claim (which does analytic
work in F2) inherits this tier (OQ4). **High** on the shipped
Snapback-side behavior cited (SQLite layout, unique/`NOT NULL` install,
staged generations, filter/membership lowering, matcher behavior — all
verified in-tree). **Medium** on the document-level couplings:
LLP 0007, 0011, and 0046 are Draft documents (0057 Accepted; 0081
Implemented on the local profile), and LLP 0011's general permission
language is explicitly not yet built. **Low-medium** on F5 — a
hypothesis by its own terms — and on the "low probability ever" prior,
which is labeled judgment.

## Open questions

1. Should the LLP 0081 OQ4 online-profile investigation explicitly cost
   out "universal-layout-for-one-table-during-migration" (a
   per-migration overlay) as a middle path?
2. If an apps-as-data workload lands (F5), does its profile use a
   universal store, or many small ordinary SQLite files (LLP 0087's
   current per-facet scratch topology; LLP 0018's boundary makes files
   cheap)?
3. Is there measurable DDL-churn pain on the Durable Object target's
   object-local SQLite (LLP 0083) that the container-VM target does not
   share? (Same evidence stream as trigger 3 — an owner for generating
   it should be named before the trigger is actionable.)
4. Pin the Convex facts before competitive reuse: verbatim
   physical-table names, their scope (deployment vs. persistence
   database vs. cluster), and the persistence-abstraction interface,
   each to a convex-backend file + commit.
5. Is application-shaped Postgres DDL an explicit Snapback identity
   requirement, and if so which LLP should own that claim? (F2's
   graduation judgment currently rests on an author value judgment.)
6. If this document's posture holds, is Active this document's terminal
   status, with graduation to a Decision deferred until a trigger
   fires?
