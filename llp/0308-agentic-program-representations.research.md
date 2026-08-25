# LLP 0308: Agentic program representations and Snapback's IR stack

**Type:** Research
**Status:** Review
**Systems:** Live queries, Offline sync, Authorization, Code generation,
Storage, Handler runtime, Agent experience
**Author:** Claude Fable / Charlie Cheever
**Date:** 2026-08-24
**Revised:** 2026-08-25
**Related:** LLP 0000, LLP 0008, LLP 0020, LLP 0051, LLP 0068, LLP 0080,
LLP 0082, LLP 0108, LLP 0146, LLP 0155, LLP 0186, LLP 0190, LLP 0203,
LLP 0209, LLP 0234, LLP 0237, LLP 0241, LLP 0252, LLP 0264, LLP 0270,
LLP 0274, LLP 0276, LLP 0304, LLP 0307

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

**Finding in one line: Snapback already implements a substantial part of
the representation thesis — the closed-IR substrate, the contract layer,
and the placement layer — deliberately and in shipped Rust; what it lacks is retained
implementation families and any generation-time equivalence gate, and the
useful imports are not a new language but four mechanisms:** (1)
*derived* incremental maintenance for the closed query IR (DBSP-style),
consumed by the matcher's delta lanes and by local materialization, (2)
plan derivation from JS handlers as an **explicit, checked admission** —
advisory until a sound checker exists — plus strengthening the shipped
declaration-conformance mechanism, (3) implementing LLP 0274's already
accepted typed write-authority design, whose hard residue is the
write-site census, and (4) incremental validation for agent candidate
loops, routed through LLP 0241's identity/custody decision. GPU
execution, a new surface language, CRDTs, and e-graph machinery are
dispositioned as not-now.

This is a Research document: it recommends, it does not commit. The
numbered order of the imports is **architectural leverage, not adoption
order** — §F3 states both orderings. Each import names the program that
would own it.

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
   repairs — not prose. (Dispositioned in §F3.)

## Findings

### F1. Snapback already implements the thesis's substrate, contract, and placement layers

Of the source's three layers (contract / implementation family /
schedule), the contract and schedule layers — and the canonical-graph
substrate beneath them — did not need importing; they are the house
design, stated in the corpus and enforced in code. The implementation-
family layer is the one that is absent (see the remainder map below):

- **Programs as closed, analyzable data.** LLP 0051's `ValueExpr` /
  mutation-plan IR: "one evaluator serves every consumer — mutation
  execution, the live matcher, and filter→SQL compilation — so
  matcher/SQL/mutation semantics cannot drift per call site," with pinned
  bounds (`MAX_PLAN_STEPS`, `MAX_EXPR_DEPTH`, a pinned function library)
  and a conformance corpus. LLP 0209's `graph_query_v1`: "a finite,
  acyclic, closed intermediate representation. An admitted graph is data,
  not code."
- **Dependencies as part of the profile.** LLP 0209 makes the captured
  read dependencies each node kind contributes definitional in the
  profile (the runtime captures themselves are evaluator-produced
  companion evidence), and the shipped matcher consumes
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
  ships a browser-side evaluator over the *same closed IR* the server
  executes (`packages/snapback-client/ir-evaluator.mjs` — two
  evaluators, one IR, held to agreement by conformance), and
  `classifyLocalMutationIrV1` is precisely a placement decision computed
  from analysis of the program: which plans may execute optimistically
  on-device, which are server-only, with closed reason codes. Optimistic
  state is recomputable presentation replayed through that evaluator
  (LLP 0155's rebase). LLP 0270's divergence rule — a server/local
  mismatch is a content failure that disables the local lane through a
  rotation or kill switch, never a silent fallback — is **runtime
  divergence detection between two evaluations of the same admitted
  IR**. It is *not* a generation-time equivalence gate between two
  different programs; that mechanism (the Alive2-style split) does not
  exist anywhere in the stack today and is what §I2 proposes.
- **Agent-first is the ratified priority.** LLP 0000: agent DX wins where
  it trades against human ergonomics; agents should get "close to
  guarantees" and "complete feedback loops." The conversation's
  prediction that agents will happily emit redundant machine-checkable
  declarations is confirmed by practice here (declared reads, declared
  cost ceilings, declared refusal codes, result contracts).

**The remainder map — what the stack does *not* have of the source
thesis:** retained implementation families (a function has exactly one
admitted body; alternatives are never kept — parked under deferred
e-graphs in §F3); any generation-time equivalence gate between distinct
programs (§I2's subject); and structured diagnostics at the
conflicting-subgraph-plus-candidate-repairs level (dispositioned at the
end of §F3). A consumer of this document should read F1 as "closed IR +
contracts + placement: present" and not as "the thesis is shipped."

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
machinery: ~13 `HandlerPlan` arms (the enum in
`crates/snapback-types/src/manifest/types.rs`), the `ValueExpr` mutation
IR (`crates/snapback-types/src/value_expr.rs`, whose pinned bounds F4
cites), the
`graph_query_v1` IR, the table policy carriers (read and write carriers
in Rust; the write-side *derivation* in JavaScript codegen), and the
migration-intent IR. (The migration-intent IR is deliberately out of
scope for §F3's imports: its derivation is already deterministic and
separately governed; I1–I4 do not cover it.) The live matcher's
precision ladder is a hand-written match over plan classes, with each
rung's precision individually designed and individually proven.

The escape hatch is `FunctionRuntime::IbexModule`: opaque JS in the
handler VM. The cliff is real but narrower than "everything falls off":
**static-admission lanes** (declarative-plan admission, local-first
execution, cold retention `rqsEligible`, delta eligibility) are
plan-only, while **invalidation precision is not binary** — the matcher
consults captured runtime read dependencies *before* any
runtime-specific fallback, for opaque handlers too (captured point reads
give exact positive wakes, and captured serialized query predicates can
prove disjointness; LLP 0020's capture mechanism), and the authored
`reads:` table-granular key plus a per-principal skip is the fallback
when captures cannot decide. (Authored `writes:` play no role in this
fallback — the matcher consults the read-set summary only; write
declarations matter to conformance and the census, not invalidation.)
Separately, **declaration conformance already ships**: LLP 0146 D1
defines per-invocation declaration/observation reports with opt-in
strict enforcement (`crates/snapback-kernel/src/conformance.rs`). LLP
0209 §7 ruled that re-run plus scheduling plus memoization is "a
legitimate stable resting point, not a waypoint" for opaque handlers —
so any import below must coexist with the hatch, not promise to close
it.

Lane-by-lane, for the opaque handler:

| Lane | Today | Residual gap |
|---|---|---|
| Plan admission | plan-only, static | opaque = no plan, by design |
| Invalidation | captures first, then declared-`reads:` fallback | fallback is table-granular; captures prove disjointness only where captured |
| Declaration conformance | LLP 0146 D1 reports; strict opt-in by ruling | over-declaration judgeable only in aggregate (D2 coverage); one observation ≠ completeness proof |
| Local exec / retention | plan-only (closed-inputs proof required) | opaque never eligible |
| Delta eligibility | plan-only, shape-guarded | opaque always re-run |

### F3. Where the imports pay

**Ranking criterion.** I1–I4 are ordered by **architectural leverage**:
how much of the fragmentation map in F2 each import unifies. That is
*not* adoption order. By do-now order the sequence is: the I4
measurement probe and the I1 scope spike first (cheap, decision-forcing),
I3 as the LLP 0274 implementation program starts (it is that program's
status analysis), I1's spec on its owner's schedule, and I2 last —
gated on its open checker question.

#### I1. Derive the incremental lanes instead of hand-writing them

**The one formalism the conversation missed is the most applicable one.**
For "keep live results fresh with precision," the state of the art is not
e-graphs but incremental view maintenance in the DBSP / differential
dataflow tradition: express the query algebra's operators once with their
incremental (Z-set / delta) semantics, and the incremental version of
*any* plan in the algebra follows by construction.

Today's reality, from LLP 0209's own measurements: the shipped
`live_delta` lane excludes ordered or cap-saturated windows,
membership-gated, and relational shapes (unordered limited queries under
their effective cap remain eligible), and on the 5.5M-row Zerobugs
fixture the observed delta-lane delivery count was **zero** — the hot
queries are exactly the excluded shapes. LLP 0008 DK-3 is the
load-bearing precedent here — its mechanism and decision stand; only its
historical measurements were superseded — and LLP 0209 G3-B's per-node
delta rules are designed-not-written, with the plan being to hand-derive
them per node kind.

**Scope, stated precisely.** One operator-level derivation serves two
consumers: (a) the matcher's per-plan delta rules (0209 G3-B) and (b) a
maintained local materialization for local query evaluation (LLP 0190
D3). It does **not** derive the third front: LLP 0209 §8 rung 5's
replica continuity contract (base/predecessor stamping, delivery mode,
gap detection, gap-to-replace) is a distribution-protocol problem that
remains after every operator has a delta form, and LLP 0190's authority,
completeness, absence, custody, bounds, and rebuild contracts are
likewise separate obligations that *consume* deltas rather than falling
out of them. Membership semi-joins additionally require
authority-bearing inputs the algebra alone does not supply. An I1 spec
must preserve DK-3/G3's existing wire kinds, fallback boundaries,
convergence rules, and authority contracts — the derivation slots inside
them — and, because a wrong delta is a live-data correctness failure,
must sit next to LLP 0270's divergence-comparator posture rather than
being treated as a pure matcher speedup.

Honest caveat: the excluded shapes (top-N windows, membership
semi-joins with retractions) are also where incremental algebra needs
the most care, so "mechanical" is relative. But deriving them from
operator semantics once still dominates proving each rung ad hoc in
`live_matcher.rs`, and it composes: a new node kind lands with its delta
rule by construction instead of joining the conservative-fallback queue.

*Owner if adopted:* the LLP 0209 program (G3-B/G3-C) and LLP 0190 D3
consume it; replica continuity is a separate later contract.

#### I2. Plan derivation as explicit, checked admission — and finish declaration conformance

The static-admission cliff in F2 bundles high-value lanes behind "author
wrote a plan." Two separable products would soften it; conflating them
was a defect in this document's first revision.

**(a) Declaration conformance — finish what ships, inside its ruling.**
Authored `reads:` are trusted for the invalidation fallback, but
declarations are not unverified: LLP 0146 D1's per-invocation
declaration/observation reports and opt-in strict enforcement
(`SNAPBACK_HANDLER_UNDECLARED_READ`/`_WRITE`, refused at load on
targets that cannot enforce it) exist in Rust today. Two constraints
are ratified and this document proposes changing neither: strict mode
is **per-app opt-in, not default** (author ruling recorded in LLP 0146;
a default change would be an explicit 0146 amendment carrying target
scope, compatibility, and non-enforcing-target handling), and a
per-invocation report's unwitnessed declarations are **data, not a
verdict** — over-declaration is only judgeable in aggregate. The narrow
import is therefore the aggregate rung LLP 0146 already names: D2
coverage over accumulated invocation reports, which is where
over-/under-declaration verdicts legitimately live. Owner: LLP 0146.

**(b) Plan derivation — advisory first, sound checker before any lane
flip.** Let codegen (or an agent pass) attempt to derive an equivalent
declarative plan from a subset JS handler. The first honest rung is
**advisory**: the derivation is surfaced as a suggested rewrite; if
adopted as source it enters ordinary plan admission, and nothing was
trusted. Automatic promotion — the derived plan gaining invalidation,
local-execution, retention, or delta lanes *on the handler's behalf* —
is a correctness-sensitive admission and requires a **sound refinement
check over a semantics-closed source fragment** (structural proof,
proof-producing translation, or abstract interpretation; SMT if it comes
to that). Differential execution against the conformance corpus and
representative stores is a pre-filter and a way to qualify the checker;
finite tests cannot authorize the lane, and promotion must be an
explicit, named admission with a stated soundness claim and non-silent
failure — never silent. This respects two standing rulings: LLP 0108
expressly declines to infer reads, writes, authorization, effects, or
results from behavior, and LLP 0237's bounded-syntax admissions do not
claim semantic purity; automatic promotion would need to amend them
knowingly, not bypass them.

*Owner if adopted:* the LLP 0108/0237 handler-subset line plus LLP 0051;
LLP 0252's rule that every profile lowers into
`NormalizedApplicationDefinitionV1` (applied by LLP 0304) is the
boundary a derived plan lands behind.

#### I3. Implement LLP 0274; the census is the hard residue

This document's first revision claimed the policy typing discipline had
"no typed home." That was stale twice over: Rust already carries
`TableVisibilityV1` *and* `FunctionWritePolicyV1`, and LLP 0274 —
Accepted Spec — already specifies the successor carriers
(`TableWritePostureV2`, `FunctionWritePolicyV2`,
`WriteExecutionAuthorityV1`), a closed dispatcher, and an
exact-versus-opaque write-operation census. The governance comparator
already compares canonical policy bodies, not handler ASTs. The
write-site scanner has improved past parts of §S0's self-diagnosis (it
follows named helper chains, including top-level function-valued helper
bindings), but it retains **live exact-empty false negatives** that
conflict with 0274's requirement that escaped contexts, computed
members, and unresolved call graphs become opaque absent proof: a
context alias (`const alias = ctx; alias.db.insert(...)`) or a computed
member (`ctx[key].insert(...)`) currently produces neither a site nor
an opaque marker, and mutable `let`/`var` helper bindings are accepted
as exact without reassignment analysis. §S0's diagnosis is narrowed,
not retired.

The import therefore narrows to: **implement 0274's accepted design**,
with the genuinely hard part being the census — classifying every write
site exactly or opaquely, soundly — and the scanner soundness audit
that decides how much of the census can be exact, starting from the
named holes above. Moving the derivation
itself from JavaScript codegen into Rust is *not* pending on some future
window: LLP 0276 is Accepted and structurally realized, and deliberately
retains no-build JavaScript tooling; relocating policy derivation would
be an explicit 0276 amendment, argued on its own merits.

*Owner if adopted:* the LLP 0274 implementation program (its planned
`snapback.write-authority.v2`/v3 rotations), with LLP 0264/0234 as
governing context.

#### I4. Incremental validation for candidate loops — through LLP 0241

The conversation's sharpest observation about parallelism: agents get
their leverage *between* candidate programs — a thousand candidate
patches share nearly all their nodes, so validation should be paid per
changed frontier, with content-addressing as the sharing mechanism.
Snapback's *validation path* is keyed coarsely and runs monolithically:
the codegen cache is keyed by the complete `inputsHash`, publication
verifies and replaces the complete generated graph, and
`NormalizedApplicationDefinitionV1` has whole-definition identities
while operations are ordinary array entries. (Fine-grained identities —
per-operation `implementationHash`, envelope-member digests — exist;
no validation pass consumes them incrementally.)

This document's first revision said the change "needs no new theory —
only cache keys the artifacts already define." That understated it. Safe
incrementality needs versioned pass dependencies, invalidation rules for
cross-cutting inputs (schema, policy, toolchain), cache-trust custody,
and preservation of LLP 0241's whole-generation atomicity — sub-identity
diffing is supported there, but activation is atomic and the complete
graph must verify. That is a real design, owned where identity and
custody are already decided: **LLP 0241**, with LLP 0186 sequencing the
edit-loop priorities (LLP 0307 was a bounded round, now Implemented and
closed; its successor round could carry the measurement).

The measurement-first posture survives and strengthens: instrument
`bun run generate` for the attainable cache-hit ceiling under realistic
agent edit sequences *before* designing the dependency contract (open
question 4).

#### Deferred: e-graph plan optimization

Retained-alternatives optimization (egg/egglog-style) over the query IR
— automatic index selection, semi-join reordering, delta-vs-replace
strategy as cost-model extraction — is real and would fit the IR
unusually well precisely because the language is closed and small enough
for complete rewrite-rule coverage. But today plan shape is authored
(and `indexed_by` is explicit by design), no measurement names plan
choice as a cost center, and the machinery is heavy. Park it until
authored plan shape is demonstrably the bottleneck; note it as the
natural growth path past I1. This is also where the source's "retained
implementation families" layer would enter, if it ever does.

#### Dispositioned: structured diagnostics (source idea 6)

Partially met, remainder unranked. The stack's refusal discipline
returns authoritative *reasons* — stable `SNAPBACK_*` codes with
file/line/column at generation time, per-node decision ledgers with
named dispositions in the graph matcher, declaration-conformance delta
reports — which is more than prose but less than the source's full
form: the smallest conflicting subgraph plus candidate repairs that
preserve the other constraints. That remainder is a legitimate candidate
import for the agent-experience line (LLP 0146/0186/0203), left
unranked here because no measurement yet names diagnostic quality as the
binding constraint on agent repair loops. It should not be read as
already satisfied.

### F4. What not to import

- **GPU compilation/execution.** The entire point of Snapback's closed
  IRs is that analysis is bounded and cheap (`MAX_PLAN_STEPS = 64`;
  graphs are small by admission). There is no volume to accelerate.
- **A new surface language.** The conversation itself recommends
  against one, and the corpus already encodes the ruling: profiles are
  projections that must lower into the shared normalized boundary (LLP
  0252, applied by LLP 0304) and may not create profile-specific
  runtime, storage, authorization, asset, or migration behavior.
- **CRDTs / exotic convergence for ordinary rows.** Deliberately
  rejected; server-authoritative OCC over captured read sets with
  `SNAPBACK_MUTATION_CONFLICT` is a design commitment (LLP 0008, LLP
  0068's narrow carve-out), not a gap.
- **SMT/formal proof machinery — wholesale.** The closed IRs admit
  direct decision procedures, and the house's receipt-and-comparator
  style buys runtime trust cheaply. But the disposition is now scoped by
  §I2: *automatic* lane promotion for derived plans has sound
  verification as its admission price — structural proof or abstract
  interpretation first, SMT if the fragment demands it — and the cheap
  alternative is the advisory rung, which needs no checker at all.

## Confidence

- **F1 (closed-IR/contract/placement layers implemented): high** — with
  the remainder map's absences (implementation families, generation-time
  equivalence gates, subgraph-level repair diagnostics) stated as part
  of the finding. Grounded in shipped code read for this document
  (`value_expr.rs`, `live_matcher.rs`, `graph.rs`/`graph_evaluator.rs`,
  `ir-evaluator.mjs`, `optimistic-rebase.mjs`, `conformance.rs`) and the
  cited LLPs.
- **F2 (fragmentation is the gap): high** as description; **medium** as
  a claim that unification is worth its migration cost.
- **I1: high** on fit for its two consumers (matcher deltas, local
  materialization); **medium** on effort — windows and retraction
  semantics for membership shapes are genuinely the hard 20%; replica
  continuity and 0190's custody contracts are explicitly *not* claimed.
  Evidence base for the motivating measurement is N=1 (Zerobugs, LLP
  0209 E-1/E-2).
- **I2: medium.** The advisory rung is low-risk and buildable; the open
  question is whether any sound checker over a useful fragment is worth
  its cost, and nothing here claims the declaration gap "closed" —
  conformance observation narrows it on observed paths only.
- **I3: high** that the direction is right — because it is already the
  accepted direction; this import is status analysis plus the census.
- **I4: medium-high** on payoff; feasibility honestly priced as a real
  dependency-and-custody design under LLP 0241, which is why the
  measurement probe comes first.
- **Deferred e-graphs: medium** that it eventually pays; **high** that
  it should not start now.

## Prior art

External: DBSP (Budiu, Chajed, McSherry, Ryzhyk, Tannen, VLDB 2023,
<https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf>; Feldera) and
differential dataflow (McSherry, Murray, Isaacs, Isard, CIDR 2013,
<https://www.cidrdb.org/cidr2013/Papers/CIDR13_Paper111.pdf>;
Materialize) for I1 — noting
DBSP incrementalizes a query algebra and supplies none of the
Snapback-specific replica or authority protocols; Alive2 (Lopes,
Menendez, Nagarakatte, Regehr, PLDI 2021,
<https://web.ist.utl.pt/nuno.lopes/pubs/alive2-pldi21.pdf>)
for I2 strictly as the **generation/acceptance division of labor**
(Alive2 itself is a formal refinement checker over IR semantics — the
opposite of differential testing, which is why §I2 separates the
advisory rung from sound promotion); egg (Willsey et al., POPL 2021,
<https://dl.acm.org/doi/10.1145/3434304>) and egglog (Zhang et al.,
PLDI 2023, <https://dl.acm.org/doi/10.1145/3591239>) for the deferred
item; Halide (Ragan-Kelley et al., PLDI 2013,
<https://dl.acm.org/doi/10.1145/2491956.2462176>) and its
algorithm/schedule
separation for the *placement* framing the client admission classifier
embodies — placement, not Halide's compute schedule; cost-model
extraction stays with the deferred e-graph item.

Internal: LLP 0082's InstantDB research (InstaQL compiling to Datalog,
one query language with client and server execution paths) is precedent
for **F1's shared-IR, two-evaluators posture — not for I1**: dual
execution of one representation is not incremental view maintenance.
LLP 0080's maintained projections are the in-house precedent for derived
materialization. The corpus has no prior e-graph or equality-saturation
discussion (grep-verified).

## Open questions

1. Should the I1 derivation be specified as an extension of LLP 0209
   (G3-B done right) or as its own Spec with exactly two consumers —
   0209's matcher deltas and 0190 D3's local materialization — that the
   later replica-continuity contract then references for its delta
   payloads? (The replica contract is separate work either way.)
2. For I2, is the advisory rung alone worth shipping, and if promotion
   is ever wanted: what is the largest source fragment with closed
   semantics over which a structural or abstract-interpretation
   refinement check is *sound* — and is that fragment big enough to
   matter?
3. For I3, does the census land inside the 0274 implementation program's
   first rotation, or after the scanner soundness audit bounds how much
   of it can be exact? (Any Rust relocation of the derivation is a
   separate, explicit LLP 0276 amendment.)
4. Is there appetite to measure I4's ceiling cheaply — instrument
   `bun run generate` for cache-hit-rate-if-keyed under a realistic
   agent edit sequence — before any dependency-contract design under
   LLP 0241?

## Revision history

- **r3 (2026-08-25).** Response to round-2 delta reviews (grok READY;
  codex NOT READY with two IN-DELTA MATERIALs, zero pre-existing).
  I2(a) rewritten inside LLP 0146's ratified rulings: strict mode stays
  per-app opt-in (default change = explicit 0146 amendment), the
  strengthening import is aggregate D2 coverage, per-invocation
  unwitnessed declarations are data not verdicts, and authored `writes:`
  removed from the invalidation-fallback grouping. I3's scanner status
  corrected to name the live exact-empty false negatives (context
  aliases, computed members, mutable helper bindings) instead of
  claiming unresolved paths go opaque. Also: F1 layer-count wording,
  point-read capture wording (exact positive wakes, not disjointness),
  I4 coarse-keying scoped to the validation path, numeric claims pinned
  to artifacts, stable prior-art links, Related-header hygiene.
- **r2 (2026-08-25).** Response to round-1 super-refine reviews (codex,
  grok — both NOT READY). Added F1's remainder map; reclassified LLP
  0270's comparator as runtime divergence detection, not
  speculate-then-check; corrected the opaque-handler baseline (captures
  precede the declared-reads fallback; LLP 0146 D1 conformance ships)
  and added the F2 lane matrix; narrowed I1 to two consumers and
  restored DK-3's standing; split I2 into declaration conformance vs.
  advisory-first plan derivation with sound-checker-gated promotion;
  reframed I3 as implementing Accepted LLP 0274 (typed carriers exist
  and are specified; census is the residue; 0276 relocation = explicit
  amendment); rerouted I4 through LLP 0241 with honest feasibility;
  stated the ranking criterion and do-now order; dispositioned source
  idea 6; fixed prior-art attributions (LLP 0082 → F1 precedent; LLP
  0252 owns the normalized boundary) and the ordered/limited
  delta-eligibility wording.
- **r1 (2026-08-24).** Initial version; entered Review at loop start.
