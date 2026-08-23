# Commission LLP 0209 G0 — the graph IR, identity, classification, and conformance corpus

**Opened:** 2026-08-23 · **Ruling:** author (Charlie Cheever, 2026-08-23
session): "worth commissioning G0 now" — recorded in LLP 0209's revision
history (v0.4) · **Owner seam:** LLP 0209 (D2 owner-Spec) §2–§4, §9 G0 ·
**Parent evidence anchor:** `issues/20260808-live-query-reevaluation-cost-at-scale.md` ·
**Gate:** none — drafting and the compile/corpus lane start now; the two
former author gates are converted below into lane deliverables ratified at
G0 exit.

## Why now (what G0 is and is not)

The live-query fan-out P1 is no longer minutes-scale: LLP 0200 Phases 1–4
(settlement isolation, write priority, cancellation, auth-lane split) and
LLP 0209 G1 (same-principal memoization) took six-observer burst settle p50
from 45 s → 1.65 s and sustained from 68 s → 6.8 s on the 5.5M-row harness
(N=1–2 shape evidence; LLP 0200 §6a–§6d, LLP 0209 v0.3). What remains is
the **structural floor**: every observer still re-runs its full opaque
handler (~0.9–1.15 s per turn at 5.5M rows), and one in-flight evaluation
turn is unpreemptible (LLP 0200 §2.5 forbids VM preemption). LLP 0200 H-1
(settle < 1 s, ack < 250 ms) is therefore unmet and cannot be met by
scheduling policy (`issues/20260808-p1-write-priority-scheduling.md` item 1).

Removing that floor is LLP 0209 G2 (per-node precision on admitted graphs)
and G3 (delta lanes — the actual incremental/differential evaluation). Both
are *specified* but neither can start: §9 sequences them after **G0**, the
IR/identity/vocabulary/corpus phase, and LLP 0268 (Accepted) additionally
binds its entire implementation on a *recorded G0 exit* carrying nine named
inputs (0268 §7). G0 is the unblocker.

**Honest framing, so nobody reads this as a latency fix:** G0 changes no
runtime semantics and moves no settle number. Its value is (a) it is the
sole prerequisite for G2/G3 and for LLP 0268, (b) it makes the two
author-gated inputs concrete instead of open, and (c) it produces the
conformance corpus against which every later rung's correctness is
pinned. The first measured latency payoff is G3 on the first admitted hot
shape (root window + to-one, per §7/§9 D2-H3).

## What G0 must deliver (the §9 exit, made checkable)

From LLP 0209 §9 G0 verbatim, plus the carriers and inputs other accepted
documents have since attached to it:

1. **The IR, as data.** Node kinds per §2 (one bounded root window,
   equality to-one, bounded parent-indexed to-many, exists/semi-join incl.
   bounded repeated existence and declared through-tables, principal-bound,
   admitted search membership, closed nested projection), finite/acyclic/
   closed, with the §2 exclusions normative. Types land in the crate LLP
   0276's map assigns (`snapback-types` for the IR/wire/identity leaf;
   `snapback-sync` for matching vocabulary; admission/compile in
   `packages/snapback-codegen`) — no new crate.
2. **Three-layer identity.** Content-addressed, host-recomputed **plan
   identity** (normalized shape, projection, declared bounds, authority
   classification, result-contract identity) and **instance identity**
   (plan × canonical args × window/range identity), wrapped by a contextual
   **materialization identity** (app/database/deployment/target/activation/
   exported-function inputs), per §2 and LLP 0190 §4.1's axes. Identity must
   be strong enough to imply byte-equivalent results
   (0268 G0-BCAST-IDENTITY). (amended 2026-08-23, Stage A fix round 2)
3. **Per-node authority classification, proved not trusted** (§3): every
   node declares class 1/2/3; the compiler checks it; the conformance
   corpus includes paired-world rows that falsify a wrong declaration at
   qualification, never at admission. The roll-up to an authority-partition
   identity is specified
   (OQ-3 is taken conservatively at G0: principal-scoped = partition of
   one; widening is a later amendment).
   (amended 2026-08-23, Stage A fix round 2)
4. **Completeness vocabulary bound to the IR** (§4): `unknown` /
   `complete` / `prefix` / `window` / `refused`, each claimed at an
   (materialization identity, partition, authorizationVersion, evaluationCut)
   tuple.
5. **Per-node dependency capture specified for every admitted node kind**
   (§5 "required now, with the IR"): root → predicate + boundary; to-one/
   to-many → parent-indexed edge dependencies; semi-join → membership
   (LLP 0056, unchanged); principal-bound → field-scope; search →
   table-granular until D6/OQ-4. *Specified* at G0; *executed* at G2.
6. **The Zerobugs corpus is declared, and compiles or refuses.** The
   control's issue-list (`issueListV2`) and issue-detail (`issueDetail`)
   queries (LLP 0191 §5's corpus — the "22-relation graph", today two JS
   handlers each reading 10 tables) are *declared* in the graph profile
   and compile to admitted graphs or stable-reason refusals with
   host-recomputed identities; the conformance corpus (results, labels,
   refusals, paired-world rows) is frozen against the existing JS
   handlers as oracle on the normal fixture, on the
   `tests/conformance/relational/corpus.v1.json` + Rust-runner pattern,
   and identity/label parity is spot-checked on the large fixture. Any
   corpus shape the profile cannot express is a **recorded refusal with
   reason**, which is a G0 result, not a G0 failure.
7. **Declared bound values sized from the fixtures** — see "Bounds" below.
   Carried in LLP 0267 §5's `queryCost.graph` fields (the sole
   declaration surface; no `g0Bounds` twin): `maxRootRowsPerPage`,
   `maxExaminedEntriesPerExecution`, `maxRelationshipLookupsPerExecution`,
   `maxChildrenPerParent`, `maxItems`/`maxArgumentItems`/
   `maxArgumentExpansion`, `maxPageResultBytes`, the six per-node
   `maxWindow*` fields plus the derived checked `windowRollup`, and
   `maxMaintainedWritesPerMutation`; whole-query
   `queryCost.maxResultBytes` remains outside `queryCost.graph`.
8. **The LLP 0268 §7 named inputs**, each present in the exit record by
   its label (G0-BCAST-CLASS, -SEPARATION, -SCOPE, -SCOPE-BINDING,
   -AUDIENCE, -INVALIDATION, -IDENTITY, -CORPUS, -BOUNDS). An exit that
   omits any of them does not unblock 0268 B1 (0268 §0, binding).
9. **The OQ-1 grammar-lineage ruling applied** — see below.

**Exit record:** a dated note in LLP 0209 (v0.6, "G0 exit") listing each
of 1–9 with its evidence pointer, Status moving Draft → Review for the
§2–§4 content G0 makes concrete; the corpus and its oracle digests
committed under `demos/zerobugs/control/` (or the conformance crate) with
a CI-run check; `./ref-check --verbose` green; `@ref LLP 0209#…` on the
IR types and the admission path.

**Non-deliverables (explicitly out of G0):** any server-side graph
execution (G2), delta emission (G3), memo-key widening beyond G1's
session-exact key (§6 partition sharing waits on this classification but
is G1+/G2 work), every matcher change except exactly one fail-closed
`GraphQuery` arm that returns conservative-fallback/not-executed, the local
evaluator (§8/D3), D6 search
invalidation facts (OQ-4), hosted-profile memo placement (OQ-2), replica
continuity (OQ-6), and any published capability claim (0183 §D2's gate is
untouched). (amended 2026-08-23, Stage A fix round 2)

## Author input 1 — bounds: converted from a gate into a lane deliverable

§9 said "G0 cannot exit without [declared bound values]" and LLP 0183 §D2
forbids blindly reusing current ceilings. The ruling here is: **the lane
sizes them from the two pinned fixtures and the author ratifies the table
at G0 exit** — the author does not need to produce numbers to unblock
drafting. Inputs are already frozen
(`demos/zerobugs/manifest/acceptance.v1.json`):

| Fixture | users | projects | issues | comments | labels | issueLabel edges | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `normal-seed-v1` | 14 | 1 | 516 | 924 | 30 | 603 | ~2.1k |
| `large-seed42-v1` | 100 | 100 | 1,000,000 | 2,527,886 | 4,810 | 2,000,370 | 5,533,266 |
| `hot-recent-v1` | (large) | largest project | 1,000-issue working set | | | | |

Current ceilings the sizing must *justify or replace*, not inherit:
`RELATIONAL_TAKE_CEILING = 1_024`, `SNAPSHOT_BATCH_SUMMED_TAKE_CEILING =
1_024` (`packages/snapback-contract/limits.mjs`), the 1,024 implicit
handler collection limit (`SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`,
`issues/20260822-implicit-1024-row-limit.md`), and the 1,000-row observer
windows the hot gate uses.

Sizing method the lane follows, with the first-cut derivation for author
ratification at the G0 exit (amended 2026-08-23, Stage A fix round 2):

- **root:** the hot working set is exactly 1,000 issues and every measured
  observer uses 1,000-row windows → `maxRootRowsPerPage` = 1,024 is
  *justified*, not inherited (keeps the existing take ceiling as the
  page bound; a smaller page bound would change the hot gate's shape).
- **fanout (to-many per parent):** large-fixture context means are **2.53
  comments** and **2.00 labels** per issue, normal 1.8 / 1.17; declarations
  use maxima read from the fixtures, never those means. Candidate:
  `maxChildrenPerParent` = 16 for label
  edges (bounded to-many on the list), comments on detail as a **window
  node** (paged), not a fanout node.
  (amended 2026-08-23, Stage A fix round 2)
- **per-node window / examined-entry:** this is where the current ceiling
  is *falsified by the fixtures*: even the contextual mean, a 1,000-row
  list × 2.00 labels/issue, is ~2,000 child rows, already over the 1,024
  summed-batch ceiling; the declaration itself uses the fixture maximum,
  not that mean, so the
  graph profile cannot reuse `SNAPSHOT_BATCH_SUMMED_TAKE_CEILING` as its
  graph-window bound. The lane derives logical row/fanout/result/window
  values from fixture facts and oracle results. It declares physical examined,
  relationship, window-scan, and index-range bounds analytically from the
  normalized plan and marks them **[G2 measures]**; Stage B does not represent
  a `StructuralWorkV1` value as graph-executor observation. The oracle run that
  freezes the corpus supplies the logical evidence.
  (amended 2026-08-23, Stage A fix round 2)
- **relationship / argument:** counted from the compiled corpus (lookups
  per node per execution; `maxItems` per collection argument from the
  control's filter arguments — selected labels, assignees, projects).
- **byte:** whole-query `queryCost.maxResultBytes` from the measured
  full-window frame size
  (six-observer arms delivered ~61–68 MB total ≈ ~10–11 MB per
  1,000-row window frame, LLP 0209 E-1) — the lane records the exact
  per-frame number and proposes the bound with headroom.
- **maintained-write:** `maxMaintainedWritesPerMutation` = 0 at G0 (no
  maintained graph facts exist until G3); the field is declared so G3
  raises it with evidence rather than introducing it.

Every value is recorded with its fixture derivation beside it; "current
ceiling" is never a derivation.

## Author input 2 — OQ-1 grammar lineage: ruling applied 2026-08-23 (resolved in LLP 0209)

**Facts the ruling rests on** (surveyed 2026-08-23; pointers are to
`crates/snapback-types/src/manifest/types.rs` unless noted):

- The three shipped carriers are `RelationalQueryPlan` (:8852; LLP 0080,
  **Implemented**): exactly two sources, 1..=4 join equalities,
  `FilterOp` = `Eq|In|Lt|Lte|Gt|Gte`, root-field order with `_id`
  tie-break, `take` 0..=1024, opaque top-level continuation cursor;
  `BoundedChildrenQueryPlan` (:8926; LLP 0110, **Accepted**): one parent
  point read + one forward child range, continuation inside the row;
  `SnapshotBatchPlanV2` (:9065; LLP 0135 §2 + LLP 0157, **Accepted**): a
  *static tuple* of 2..=8 relational/bounded-children nodes with **no
  edges between nodes**, summed take ≤ 1,024, `normalizedCompositePlan`
  + `planHash`. All three are `HandlerPlan` arms (:9599) with published
  capability ids (`relational_query_v1`, `bounded_children_v1`,
  `snapshot_batch_v2`), JSON-schema mirrors (`schemas/functions.manifest.
  schema.json`), a byte-pinned conformance corpus
  (`tests/conformance/relational/corpus.v1.json`, 16 cases, runner
  `crates/snapback/tests/relational_corpus_v0.rs`), and drift-gated
  publication receipts.
- **OQ-1's attribution "0080/0100/0155" is drift**: 0100 owns
  membership-addressed pages and 0155 has no snapshot-batch text; the
  code's `@ref` lineage is **0080 / 0110 / 0135+0157**. Corrected in
  LLP 0209 with this packet.
- Content-addressed identity already exists and is the §2 precedent:
  `SingleNodeIdentityV1` (:6803), `SnapshotBatchIdentityV2` (:6791),
  hash domains `snapback:node-plan:v1:` / `snapback:plan-hash:v1:`,
  `normalized_plan()` (:9047), host re-verification of manifest-supplied
  identities (:2799–2814).
- The live matcher (`crates/snapback-kernel/src/live_matcher.rs` — LLP
  0209 cites the pre-0276 path `crates/snapback/src/…`, also corrected)
  is table-granular for all three carriers *by LLP 0080 §4's explicit
  design* (:250–268, :270–282, :289–320).
- The Familiar profile (LLP 0252/0253) lowers every `query` to a JS
  handler (`packages/snapback-codegen/familiar.mjs:229`) and refuses the
  explicit relational constructors (`familiar-dispositions.mjs:87–89`);
  the Clique lane's "singleton relational state row" is an app pattern
  on a JS live query, not a plan grammar. Familiar is therefore not a
  lineage input to OQ-1; it is a *future consumer* of the graph IR.
- The Zerobugs corpus queries (`demos/zerobugs/control/snapback/
  functions.mjs`: `issueListV2` :3933, `issueDetail` :3869, each
  declaring 10 `reads` tables over a 23-table schema with three
  hand-maintained denormalized read models) are **all JS handlers** —
  `demos/zerobugs` uses none of the declarative constructors. So "the
  corpus compiles" means the lane *declares* the list and detail graphs
  in the new profile and the existing JS handlers are the oracle.

**Ruling — extend the family with a sibling arm; freeze, do not
mutate or migrate, the shipped carriers.**

1. The graph IR lands as a **new `HandlerPlan` arm** (working name
   `graph_query_v1`, capability id reserved through the LLP 0157
   registry) with its own JSON-schema mirror, authoring constructor
   (`defineGraphQuery` in `define.d.ts`/`define.mjs`), identity struct
   (`GraphPlanIdentityV1` on the `SingleNodeIdentityV1` pattern with a
   new `snapback:graph-plan:v1:` domain), and matcher arm (G2).
2. It **reuses the shipped primitives** where the node kinds coincide —
   `FilterExpr`/`FilterOp`, `OrderExpr`, `TableVisibilityV1`,
   `JoinEquality`, the keyset-cursor encoding, and the 0157 normalization
   + domain-hash machinery — and adds only what the two-source grammar
   structurally cannot express: exists/semi-join with bounded repeated
   existence and through-tables, principal-bound nodes, admitted search
   membership, closed nested projection, per-node authority class, and
   the §2 bound set.
3. The three shipped carriers are **frozen**: no widening of
   `RelationalQueryPlan` toward N sources, no edges added to the
   snapshot-batch tuple, no change to their matcher arms, corpora,
   capability ids, or LLP 0080 §4's table-granular claim. New
   graph-shaped declarations target the graph arm; the two-source
   carriers go into maintenance.
4. **No migration at G0.** A two-source relational plan is expressible as
   a degenerate graph (root window + one to-one or to-many node); the
   lane records that equivalence as a *G2 conformance row* (the 16-case
   relational corpus re-executed through the graph evaluator with
   byte-identical results), not as a carrier migration. Whether the
   shipped carriers are ever lowered onto the graph evaluator is a
   post-G2 decision with its own evidence; nothing in G0–G3 depends on
   it.

**Why this and not "extend in place" or "supersede with migration":**
mutating the shipped carriers rotates every publication receipt and
capability artifact that pins them (the LLP 0157 identity cascade — the
same trap recorded for authored-graph import rotation in the lane
manual) for zero measured payoff, and would turn LLP 0080's closed
two-source contract into an open graph, invalidating its §4 invalidation
claim and its Implemented status. Superseding with a migration front-
loads the riskiest, least-valuable work (moving five demos and a corpus
off a working surface) ahead of the rungs that carry the latency payoff.
A sibling arm is additive, lets 0183 §D2's publication gate apply to one
new capability id, and keeps G2's matcher work confined to one new arm.

## Lane plan

One lane, two stages, run under the `sbs-orchestrate` roster (codex
gpt-5.6-sol xhigh implements; codex + grok-4.6 xhigh review; the
orchestrator lands). Docs and corpus land together per repo policy.

- **Stage A — Spec tightening (docs-only landing).** LLP 0209 §2–§4
  amended to concrete: node-kind table with per-kind fields, identity
  normalization rules (what is hashed, in what order, with which
  canonicalization), classification check rules, the bound table
  skeleton with its derivation columns, the OQ-1 ruling applied, the 0268
  §7 inputs mapped to §2/§3 carriers by label, and the G0 exit checklist
  above copied into §9. Review via `llp-super-refine` (two families) since
  0268 and 0267 are Accepted consumers of these exact sections.
- **Stage B — IR types + admission compile + corpus (code landing).**
  IR types and identity hashing; the codegen admission path that compiles
  a declared graph or refuses with a stable reason; the Zerobugs issue-
  list/detail queries declared in the profile; the conformance corpus
  frozen against the opaque oracle on the normal fixture with a CI check
  (`node scripts/check-inventories.mjs` registration; paired-world rows
  via `policy-extension-v1`); large-fixture parity spot check and the
  fixture/oracle logical derivation plus normalized-plan analytical physical
  declarations that size the bounds. **No runtime path
  consumes the IR yet** — the opaque handlers keep serving; the corpus
  is the only executable deliverable. Here “sizes the bounds” means logical
  fixture/oracle derivation plus analytical physical declarations marked
  **[G2 measures]**, not graph-executor `StructuralWorkV1` observation.
  (amended 2026-08-23, Stage A fix round 2)
- **Exit:** the dated v0.6 note in LLP 0209 with the bound table for
  author ratification; this ticket records the landed SHAs and moves to
  `issues/closed/`; the parent evidence anchor and
  `issues/20260808-d2-d4-owner-specs-commission.md` get a pointer.

Traps the lane inherits (memory field manual): the control's backend
needs direct codegen (`demos/zerobugs/control/snapback` is not in the
artifact-policy registry); `volta run --node 24.18.0` for all node
tooling; worktree bootstrap via `SNAPBACK_IBEX_CHECKOUT`; generated
artifacts regenerate on the merged tree, never hand-merged; the
`guide/capabilities.md` byte budget if a GAP row is touched.

## Dependencies and consumers

- **Consumes:** LLP 0209 §2–§5, §9 (owner); LLP 0183 §D2 (charter + bound
  rule); LLP 0190 §4.1 (identity axes); LLP 0170 (authorization
  discipline made mechanical); LLP 0267 §5 (bound carrier — Accepted,
  not yet implemented: G0 populates `queryCost.graph` declarations; the
  pre-G0 opaque guardrails are 0267's own lane); LLP 0276 crate map
  (placement); LLP 0080/0110/0135+0157 carrier owners (OQ-1; attribution corrected from 0080/0100/0155).
- **Unblocks:** LLP 0209 G2 → G3 (the latency floor); LLP 0268 B1 (bound
  on the nine §7 inputs); §6 partition-level memo sharing; D3's local
  evaluator via §8.
- **Does not touch:** LLP 0200 contracts (scheduler/settlement; graph
  subscriptions ride them unchanged per §3), the 1,024 implicit handler
  limit (separate ticket — but G0's root/summed bounds are the principled
  successor to that ceiling and the ticket should cross-reference the
  ratified table).

## Status

- 2026-08-23 — commissioned; packet landed; lane not yet dispatched.
