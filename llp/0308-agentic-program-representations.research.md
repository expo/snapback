# LLP 0308: Agentic program representations and Snapback's IR stack

**Type:** Research
**Status:** Draft
**Systems:** Live queries, Offline sync, Authorization, Code generation,
Storage, Handler runtime, Agent experience
**Author:** Claude Fable / Charlie Cheever
**Date:** 2026-08-24
**Related:** LLP 0000, LLP 0008, LLP 0051, LLP 0080, LLP 0082, LLP 0108,
LLP 0155, LLP 0173, LLP 0186, LLP 0190, LLP 0200, LLP 0209, LLP 0237,
LLP 0264, LLP 0270, LLP 0274, LLP 0276, LLP 0304

## Summary

This document evaluates a family of "agent-native programming language"
ideas — programs as content-addressed graphs of contracts, facts, proofs,
and equivalent alternatives, optimized and validated by massively parallel
search — against Snapback's actual architecture, and identifies which of
those ideas would pay here.

The source is an external design conversation ("Agentic Parallel
Language," ChatGPT, 2026-08-24,
<https://chatgpt.com/share/6a8d23ad-d6e4-83e8-8cf6-1239ab82e41a>). Its
prompt asked whether a new language designed to be *compiled by GPUs with
massive parallelism* could become a desirable target for agentic
development. Its answer relocated the value: not GPU compilation, but an
agent-facing representation with three separable layers — **contract**
(what must be true), **implementation family** (equivalent ways it could
be computed), and **schedule** (where and how it runs) — held in a
canonical, content-addressed graph, with optimization as search over
retained alternatives (e-graphs / equality saturation) and correctness by
*speculate-then-check*: creative, untrusted generation gated by a small,
deterministic validator.

**Finding in one line: Snapback already implements the representation half
of this thesis, deliberately and in shipped Rust; the useful imports are
not a new language but four mechanisms** — (1) *derived* incremental
maintenance for the closed query IR (DBSP-style) instead of hand-written
delta rules, (2) checked lowering of JS handlers into declarative plans
(translation validation) so the tier ladder becomes search instead of a
cliff, (3) lowering the table policy IR out of syntactic JavaScript
analysis into the same closed, typed representation as reads and writes,
and (4) incremental, content-addressed validation so agent candidate loops
pay per changed node rather than per full regeneration. GPU execution, a
new surface language, CRDTs, and heavyweight e-graph machinery do not pay
here today.

This is a Research document: it recommends and ranks, it does not commit.
Each import names the program that would own it.

## Source ideas, compressed

The conversation's load-bearing claims, in the form relevant to Snapback:

1. **Representation over syntax.** The winning artifact is not prettier
   parallel syntax but a canonical graph whose facts are "flatter, more
   local, and more regular" — no semantically irrelevant variation,
   stable node identities, explicit effects, no undefined behavior.
2. **Contract / implementation family / schedule.** Generalize Halide's
   algorithm-vs-schedule split: a function is a contract plus a *family*
   of validated equivalent implementations plus a placement decision.
3. **First-class alternatives.** Keep equivalent forms alive (e-graphs /
   equality saturation); optimization becomes extraction under a cost
   model rather than a brittle sequence of destructive passes.
4. **Speculate-then-check.** "Generation can be creative and unreliable;
   acceptance must be small, deterministic, and reliable" (the Alive2 /
   translation-validation division of labor).
5. **Parallelism between candidates, not within one compile.** An agent
   emits a thousand related candidates sharing nearly all their nodes;
   content-addressing makes validating them incremental over changed
   frontiers. This — not GPU lexing — is where the hardware goes.
6. **Structured diagnostics as repair input.** A failure returns the
   violated constraint, the smallest conflicting subgraph, and candidate
   repairs — not prose.

## Findings

### F1. Snapback is already a running instance of the representation thesis

The thesis did not need importing; it is the house design, stated in the
corpus and enforced in code:

- **Programs as closed, analyzable data.** LLP 0051's `ValueExpr` /
  mutation-plan IR: "one evaluator serves every consumer — mutation
  execution, the live matcher, and filter→SQL compilation — so
  matcher/SQL/mutation semantics cannot drift per call site," with pinned
  bounds (`MAX_PLAN_STEPS`, `MAX_EXPR_DEPTH`, a pinned function library)
  and a conformance corpus. LLP 0209's `graph_query_v1`: "a finite,
  acyclic, closed intermediate representation. An admitted graph is data,
  not code."
- **Dependencies as part of the IR.** LLP 0209 makes per-node captured
  read dependencies definitional, and the shipped matcher consumes
  `CapturedReadDependency` records carrying the serialized plan as the
  predicate.
- **Contracts with honest refusal.** `ExprError::Unanalyzable`,
  `ConservativeFallback`, the graph completeness `unknown` label, and
  `BROWSER_IR_ADMISSION_CLASSES = ['ready',
  'predictable-with-partial-input', 'server-only', 'refused']` are all
  first-class "I cannot analyze this" values with named reasons. The
  conversation's "no undefined behavior; feedback is authoritative" is
  the `SNAPBACK_*` refusal-register discipline.
- **Content-addressed canonical identity.** `normalizedContractId`,
  `canonicalExecutableAstDigest` (distinct from raw source evidence, so
  a comment edit does not rotate semantics), and the graph IR's
  host-recomputed plan/instance/materialization identities.
- **The schedule layer exists and is the local-first story.** The client
  ships the *same* IR evaluator the server runs
  (`packages/snapback-client/ir-evaluator.mjs`), and
  `classifyLocalMutationIrV1` is precisely a placement decision computed
  from analysis of the program: which plans may execute optimistically
  on-device, which are server-only, with closed reason codes. Optimistic
  state is recomputable presentation replayed through that evaluator
  (LLP 0155's rebase), and LLP 0270's divergence rule — a server/local
  mismatch is a content failure that disables the local lane through a
  rotation or kill switch, never a silent fallback — *is*
  speculate-then-check with a trusted comparator.
- **Agent-first is the ratified priority.** LLP 0000: agent DX wins where
  it trades against human ergonomics; agents should get "close to
  guarantees" and "complete feedback loops." The conversation's
  prediction that agents will happily emit redundant machine-checkable
  declarations is confirmed by practice here (declared reads, declared
  cost ceilings, declared refusal codes, result contracts).

Notably, the conversation's closing suggestion — don't build a new
surface language; build an agent-only semantic IR beneath a familiar
projection, and start with reactive application code — describes
Snapback's existing shape: `schema.mjs`/`functions.mjs` is the
projection, `NormalizedApplicationDefinitionV1` plus the plan/graph/value
IRs is the substrate, and live queries over server-authoritative state
are the reactive domain.

### F2. The gap is fragmentation and one escape hatch, not absence

What Snapback does *not* have is uniformity. There are roughly five
separate representations with separate identity, analysis, and precision
machinery: ~13 `HandlerPlan` arms, the `ValueExpr` mutation IR, the
`graph_query_v1` IR, the table policy carriers (read side in Rust, write
side derived in JavaScript codegen), and the migration-intent IR. The
live matcher's precision ladder is a hand-written match over plan classes
— per-node dependency matching for graphs, predicate-level for single
declarative queries, table-granular for relational v1 and for opaque JS
via declared `reads:`, conservative fallback for the rest — with each
rung's precision individually designed and individually proven.

The escape hatch is `FunctionRuntime::IbexModule`: opaque JS in the
handler VM. Every analysis fails closed against it, correctly. LLP 0209
§7 already ruled that re-run plus scheduling plus memoization is "a
legitimate stable resting point, not a waypoint" for opaque handlers —
so any import below must coexist with the hatch, not promise to close it.

### F3. Where the imports pay (ranked)

#### I1. Derive the incremental lanes instead of hand-writing them

**The one formalism the conversation missed is the most applicable one.**
For "keep live results fresh with precision," the state of the art is not
e-graphs but incremental view maintenance in the DBSP / differential
dataflow tradition: express the query algebra's operators once with their
incremental (Z-set / delta) semantics, and the incremental version of
*any* plan in the algebra follows by construction.

Today's reality, from LLP 0209's own measurements: the shipped
`live_delta` lane excludes ordered/limited (top-N), membership-gated,
and relational shapes, and on the 5.5M-row Zerobugs fixture the observed
delta-lane delivery count was **zero** — the hot queries are exactly the
excluded shapes. Meanwhile three open fronts are all blocked on the same
missing machinery:

- **LLP 0209 G3-B** — per-node-kind delta rules for the graph IR are
  designed-not-written, and the plan is to hand-derive them per node
  kind.
- **LLP 0209 §8 rung 5** — the replica continuity contract (base-version
  stamping, cumulative-vs-compositional deltas, gap-to-replace) is
  explicitly undesigned; current deltas are "not claimed
  replica-applicable."
- **LLP 0190 D3** — local query evaluation beyond `result-transform.v1`
  needs exactly a maintained local materialization.

Because the query IR is closed and tiny — seven graph node kinds, a
pinned expression library — defining incremental semantics per operator
is a bounded exercise, and per-plan delta rules, replica maintenance, and
local evaluation all become *the same derivation* consumed three ways.
The per-node captured-dependency vocabulary already in the IR is the
scaffolding such maintenance wants.

Honest caveat: the shapes the current lane excludes (top-N windows,
membership semi-joins) are also where incremental algebra needs the most
care — windows need dedicated operators and retraction handling, and
"mechanical" is relative. But deriving them from operator semantics once
still dominates proving each rung ad hoc in `live_matcher.rs`, and it
composes: a new node kind lands with its delta rule by construction
instead of joining the conservative-fallback queue.

*Owner if adopted:* the LLP 0209 program (G3-B/G3-C) and LLP 0190 D3;
LLP 0008 DK-3 is the superseded hand-written slice.

#### I2. Checked lowering: turn the tier cliff into search-plus-validation

The sharpest discontinuity in the authoring surface is binary: a function
is either a fully analyzable plan or opaque `IbexModule` JS, and
invalidation precision, local-first admission, cold retention
(`rqsEligible` is declarative-public-only today), and delta eligibility
all fall off the cliff together. LLP 0051 D2's "outgrew the IR"
taxonomy (`conditional-writes`, `filtered-read-guards`, `type-coercion`,
`general-iteration`) names the cliff edge precisely but treats it as
terminal.

The import: let codegen — or an agent pass, per the conversation's
generation/acceptance split — *attempt to derive* an equivalent
declarative plan from a JS handler, and admit the derived form only when
a small trusted checker validates equivalence (differential execution
against the conformance corpus and representative stores, or per-shape
structural proof where the subset permits). On success the function
silently gains the analyzable lane; on failure it stays honestly opaque.
Authoring cost: zero — the author keeps writing the JS they wrote.

This also closes a real soundness gap: `reads:`/`writes:` on
`defineJsQuery`/`defineJsMutation` are authored declarations, checked
non-empty and used as the invalidation key, but never verified against
handler behavior. A checked lowering (or, for handlers that don't lower,
a validated read-set observation from the handler VM) converts a
trusted declaration into a checked fact.

The existing acorn-based scanners (`write-policy.mjs` site collection,
the N+1 advisory, the LLP 0173 authorization review projection) are the
embryo of this — syntactic today, admittedly unsound under aliasing.
The house already knows the honest failure mode (`Unanalyzable` →
conservative); checked lowering extends the same shape upward.

*Owner if adopted:* the LLP 0108/0237 handler-subset line plus LLP 0051;
LLP 0304's rule that every profile lowers into
`NormalizedApplicationDefinitionV1` is the boundary the derived plan
lands behind.

#### I3. Give the policy IR a typed home

The weakest representation in the stack is the one governing
authorization. The read side (`TableVisibilityV1`) is a closed Rust
carrier, but the write side is derived by ~4,700 lines of JavaScript
codegen (`write-policy.mjs`, `visibility-governance.mjs`), only the
owner-write slice is implemented (`snapback.owner-write.v1`), and LLP
0274 §S0 concedes the site scanner "can report an exact empty site set
for aliased, computed, or helper writes." Meanwhile LLP 0274's accepted
design is, in substance, a typing discipline — discriminated-field
immutability under every posture, exact read-arm/write-authority pair
matching, an audience-narrowing comparator that refuses self-proving
claims — with no typed representation to run over.

The import is the conversation's "make the internal facts flatter and
more regular," applied at the point of maximum stakes: lower read and
write policy into the same closed IR family as plans and graphs, and run
the LLP 0274 rules and the governance comparator as analyses over that
IR rather than as AST inspection of handler source. Combined with I2,
write-site facts become checked rather than scanned.

*Owner if adopted:* the LLP 0274 implementation program (the
`snapback.write-authority.v2`/v3 rotations it already plans), with LLP
0264/0234 as the governing context and LLP 0276's workspace
rearchitecture as the natural moment to move the derivation into Rust.

#### I4. Incremental, content-addressed validation for candidate loops

The conversation's sharpest observation about parallelism: agents get
their leverage *between* candidate programs — a thousand candidate
patches share nearly all their nodes, so validation should be paid per
changed frontier, with content-addressing as the sharing mechanism.
Snapback content-addresses everything already but validates
monolithically: every candidate edit in an agent repair loop pays a full
`generate` pass — normalization, admission, governance comparison,
contract reification — regardless of how little changed.

The import: make the validation pipeline incremental over the normalized
definition's content-addressed nodes, and batchable, so `bun run
generate` on the Nth variant of one function costs proportional to that
function. This is a direct spend against the loop-cost problem LLP 0186
and LLP 0307 are chipping at, and it needs no new theory — only cache
keys the artifacts already define.

*Owner if adopted:* LLP 0186 / the LLP 0307 chip-away line (codegen
performance), independent of I1–I3.

#### Deferred: e-graph plan optimization

Retained-alternatives optimization (egg/egglog-style) over the query IR
— automatic index selection, semi-join reordering, delta-vs-replace
strategy as cost-model extraction — is real and would fit the IR
unusually well precisely because the language is closed and small enough
for complete rewrite-rule coverage. But today plan shape is authored
(and `indexed_by` is explicit by design), no measurement names plan
choice as a cost center, and the machinery is heavy. Park it until
authored plan shape is demonstrably the bottleneck; note it as the
natural growth path past I1.

### F4. What not to import

- **GPU compilation/execution.** The entire point of Snapback's closed
  IRs is that analysis is bounded and cheap (`MAX_PLAN_STEPS = 64`;
  graphs are small by admission). There is no volume to accelerate.
- **A new surface language.** The conversation itself recommends
  against one, and LLP 0304 already encodes the ruling: profiles are
  projections that must lower into the shared normalized boundary and
  "may not create profile-specific runtime, storage, authorization,
  asset, or migration behavior."
- **CRDTs / exotic convergence for ordinary rows.** Deliberately
  rejected; server-authoritative OCC over captured read sets with
  `SNAPBACK_MUTATION_CONFLICT` is a design commitment (LLP 0008, LLP
  0068's carve-out), not a gap.
- **SMT/formal proof machinery.** The closed IRs admit direct decision
  procedures; the house's receipt-and-comparator style (LLP 0270's
  divergence kill switch) buys the same trust more cheaply. Revisit only
  if I2's equivalence checker outgrows differential testing.

## Confidence

- **F1 (thesis already implemented): high.** Grounded in shipped code
  read for this document (`value_expr.rs`, `live_matcher.rs`,
  `graph.rs`/`graph_evaluator.rs`, `ir-evaluator.mjs`,
  `optimistic-rebase.mjs`) and the cited LLPs.
- **F2 (fragmentation is the gap): high** as description; **medium** as
  a claim that unification is worth its migration cost — LLP 0276's
  rearchitecture is the cheapest window, and outside such a window the
  per-arm machinery keeps working.
- **I1: high** on fit and on the three-fronts-one-derivation claim;
  **medium** on effort — windows and retraction semantics for
  membership shapes are genuinely the hard 20%. Evidence base for the
  motivating measurement is N=1 (Zerobugs fixture, LLP 0209 E-1/E-2).
- **I2: medium-high.** The subset is already bounded (LLP 0108/0237),
  which makes derivation tractable; the risk is checker soundness
  ambition creep. Scope discipline: differential validation, honest
  refusal, no completeness claim.
- **I3: high** on direction (LLP 0274 already implies it); timing
  should ride the 0274 implementation program rather than precede it.
- **I4: high**; smallest theory, most immediately measurable payoff.
- **Deferred e-graphs: medium** that it eventually pays; **high** that
  it should not start now.

## Prior art

External: DBSP (Budiu, Chajed, McSherry, Ryzhyk, Tannen — automatic
incremental view maintenance for rich query languages; Feldera) and
differential dataflow (McSherry et al.; Materialize) for I1; Alive2
(Lopes et al.) and translation validation generally for I2; egg (Willsey
et al.) and egglog (Zhang et al.) for the deferred item; Halide's
algorithm/schedule separation for the placement framing the client
admission classifier already embodies.

Internal: LLP 0082 already documented the adjacent industry design —
InstantDB's InstaQL compiling to Datalog with one query language and two
execution paths (client Datalog, server SQL) — which is I1's "same
derivation consumed by server and client" in commercial form. LLP 0080's
maintained projections are the in-house precedent for derived
materialization. The corpus has no prior e-graph or equality-saturation
discussion (grep-verified).

## Open questions

1. Should I1 be specified as an extension of LLP 0209 (G3-B done right)
   or as its own Spec that 0209, 0190, and the replica contract all
   cite? The three-consumers framing argues for the latter.
2. For I2, what is the minimum trusted checker that justifies flipping a
   function's lane — corpus-differential only, or corpus plus a bounded
   store-state enumeration per shape class?
3. Does I3 wait for LLP 0276's crates/ workspace (policy derivation
   moves to Rust once) or land a first slice inside the existing
   JavaScript derivation with the IR as its output format?
4. Is there appetite to measure I4's ceiling cheaply — e.g., instrument
   `bun run generate` for cache-hit-rate-if-keyed before building the
   cache?
