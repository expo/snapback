# LLP 0320: The plan IR as a compiler output, not an authored dialect

**Type:** RFC
**Status:** Withdrawn
**Systems:** Authoring surface, Code generation, Engine, Runtime, Sync,
Authorization, Developer experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-27
**Revised:** 2026-08-27 (b — **Withdrawn** by the author after round 1 of
`llp-super-refine`; see Withdrawal below. Both families returned NOT READY
(codex 5 MATERIAL / grok 4 MATERIAL) and the defects are not revisable without
replacing the proposal.) 2026-08-27 (a — Draft → Review at llp-super-refine
loop start, the one authorized transition)
**Related:** LLP 0003, LLP 0004, LLP 0008, LLP 0035, LLP 0118, LLP 0127,
LLP 0146, LLP 0170, LLP 0173, LLP 0209, LLP 0318, LLP 0319, LLP 0323

## Withdrawal (2026-08-27)

The performance premise is inverted and the preservation claim is
false.

LLP 0035 records that fan-out is "no longer VM-bound; it is row-bound …
the measured hand-off from DK-4 to the DK-3 revisit trigger" — the
op-log-delta trigger is armed and `live_delta` is HostPlan-only with no
VM. DK-4 closed fresh-VM-per-invocation; it made HostPlan more
load-bearing, not less. Codex added that the old fan-out fixtures were
later declared unsound with no corrected rerun, so the honest statement
is that current native-versus-handler cost is unknown.

Worse for the proposal, lifting is not semantics-preserving. HostPlan
mutations are unconditional sequences executed inside the commit
transaction against a client-supplied stale baseline, while JS handlers
capture dependencies across the read-to-commit window and validate at
commit — so translation can change race outcomes. And declarative
single-table live queries are the only public cold-retention class while
generated mutation-plan presence is the offline replayability predicate,
so functions that fail to lift lose capability rather than just
performance. "A false negative costs a VM invocation" holds only for
handlers that were already JS.

The narrower OQ4 fallback (retire the expression constructors, keep the
`table`/`filter`/`order`/`index` literal form) is not withdrawn on the
merits but is unmotivated until someone measures how many authored
functions use the expression constructors at all.

This document is retained unrevised as the record of the proposal and
its refutation. The reviews are the durable artifact:
[codex](./reviews/0318-one-authoring-profile.codex.md) /
[grok](./reviews/0318-one-authoring-profile.grok.md) for the
authoring-surface cluster,
[codex](./reviews/0322-tiered-diagnostic-codes.codex.md) /
[grok](./reviews/0322-tiered-diagnostic-codes.grok.md) for the
size-and-hygiene cluster, with the run journal at
[`0318-one-authoring-profile.run.md`](./reviews/0318-one-authoring-profile.run.md).

Everything below is the original text as reviewed. Its claims were not
corrected; several are false and are enumerated above.

## Summary

`packages/snapback-codegen/define.mjs` exports a complete expression
language as data constructors — arithmetic, comparison, boolean logic,
conditionals, string ops, field access, let-binding, and function
application — inside a product that already ships a JavaScript VM. An
author can express a mutation either as a `mutationPlan` built from these
constructors or as a JavaScript handler. Both paths exist, both are
documented, and both are load-bearing.

This RFC proposes that the plan IR stop being an **authored** surface and
become a **compiler output**: authors write JavaScript; codegen lifts the
analyzable subset into HostPlan automatically; the engine keeps every
native fast path it has today. One surface for humans and agents, the
same two execution strategies underneath.

Confidence in the direction is **0.6** — lower than the other
simplification RFCs in this batch, because the lifting compiler is real
work and because the IR's analyzability underwrites several shipped
guarantees (§3). This is the highest-value and highest-risk item in the
set.

## 1. The surface

Expression constructors currently exported:

```
add sub mul div mod neg
eq eqv ne lt lte gt gte  ltFilter lteFilter gtFilter gteFilter
and or not cond coalesce
concat record field call letBind
arg argOpt argsRoot lit literal
asc desc
authUserId authKind authActorKind authIsDelegated authActualActor
authActivityActorKind authGrantId
runtimeId runtimeNow clientMutationDigest bindingRef binding
```

Mutation-plan constructors:

```
mutationPlan insert insertEach patch del deleteWhere get guard
returnDocument returnChangedCount returnBinding returnExpr returnLiteral
runMutation allocateSequence owner existingOwner throughParent throughScope
```

That is a language. It has literals, variables, binding, application,
conditionals, and a statement sequencer. It is JavaScript's expression
grammar, re-spelled as constructor calls, in a runtime that embeds
Hermes.

## 2. Why it exists, and what has changed

The IR is not an accident. It buys:

1. **Static read/write sets** — for commit-time read-set validation
   (LLP 0003, LLP 0004).
2. **Delta candidacy** — LLP 0008's `live_delta` wire kind admits "any
   `HostPlan` single-table query with changes," per LLP 0067's
   restatement, and LLP 0209 classifies single-table HostPlan queries
   into the admitted-shapes IVM.
3. **Authorization analyzability** — LLP 0170's feasibility work and
   LLP 0173's `effectiveTablePolicies` projection lean on the single-table
   HostPlan entry, where "activation re-derives the exact restricted
   predicate from the schema."
4. **Native execution** — no VM invocation for plan-shaped work.

Two of those four have weakened as justifications for an *authored*
dialect:

**On (1), the declarations are already redundant.** The JS path declares
the same facts by hand. From `demos/todo/snapback/functions.mjs`:

```js
export const setCompleted = defineJsMutation({
  args: { id: v.string(), completed: v.boolean() },
  source: 'handlers.mjs', exportName: 'setCompleted',
  reads: ['todos'], writes: ['todos'],
});
```

`reads`/`writes`/`authScopeField`/`result` are present on the JS
constructor. So the IR is not how Snapback learns the read set on the JS
path — the author tells it. The IR's contribution is that it makes the
declaration *checkable* rather than *trusted*, which is a real and
different benefit, and one a lifting compiler also provides.

**On (4), the original performance argument was settled elsewhere.**
LLP 0035's M1 evidence drove docket DK-4 to the conclusion that fan-out
cost was VM-bound and that a warm VM per bundle hash was "the top compute
priority" and "the higher-leverage fix" — and DK-3 deliberately chose
whole-document replace *because* the cost was VM-bound rather than
delta-shaped. The warm-VM leg then shipped. The performance gap the IR
was partly justified by is the gap DK-4 closed by other means. Whether a
gap remains is a measurement nobody has re-run. `[inferred]`

(2) and (3) are unchanged and are the real reason to keep HostPlan as a
*representation*.

## 3. Proposal

**Keep HostPlan. Stop authoring it.**

1. Authors write JavaScript handlers. That is the only function-body
   surface.
2. Codegen runs a **lifting pass**: a closed, conservative analysis that
   recognizes the HostPlan-expressible subset of a handler and emits the
   equivalent plan. Recognized handlers get native execution, delta
   candidacy, and the LLP 0173 authorization projection exactly as today.
3. Handlers outside the subset execute in the VM, as today, with their
   declared read/write sets.
4. **Lifting is observable, never silent.** Generate-time output states,
   per function, whether it lifted and — when it did not — which
   construct blocked it. An author who wants the fast path can see why
   they are not on it. This is the LLP 0127 aesthetic: the convenience is
   made visible rather than magic.
5. The IR constructors move out of the public `define.mjs` export surface
   and become internal codegen types.

The lifting pass is a small, boring compiler over a deliberately narrow
grammar. It is not a general JavaScript analyzer. If a construct is not
trivially recognizable, it does not lift — a false negative costs a VM
invocation, which is the status quo.

## 4. What this does not do

- **It does not remove HostPlan from the engine.** Nothing in
  `crates/snapback-engine` changes. The engine keeps receiving plans; it
  stops mattering whether a human or the compiler wrote them.
- **It does not weaken authorization analysis.** LLP 0170/0173 consume
  plans. A lifted plan is a plan. What changes is the *provenance* of the
  plan, and provenance is exactly the thing a generate-time receipt can
  attest.
- **It does not claim the IR is worthless.** It claims the IR is a
  *compiler intermediate representation*, and that intermediate
  representations do not belong in a getting-started guide.
- **It does not resolve whether the lift rate is high enough.** §5 OQ1.

## 5. Open questions

- **OQ1 — What fraction of real handlers lift?** The decisive question.
  Measure against the existing corpus: every `defineJsQuery`/
  `defineJsMutation` in `demos/` and `tests/fixtures/`. If the lift rate
  on already-written handlers is low, either the subset is too narrow or
  authors naturally write outside it, and the RFC is dead.
- **OQ2 — What is the current cost of a VM invocation, post-warm-VM?**
  Re-run the LLP 0035 M1 fan-out measurement. If the warm-VM path is
  close enough to native, part of the IR's remaining justification is
  performance that no longer exists, and even the *engine* side could
  eventually narrow. If it is not close, the lifting compiler is
  load-bearing for performance and must be good, not merely correct.
- **OQ3 — Does delta candidacy survive lifting?** LLP 0008/0209 admit
  single-table HostPlan queries. A lifted plan should qualify identically,
  but the admission predicate is stated over plan shape, and a lifted
  plan's shape must be proven to land in the same class.
- **OQ4 — Migration for existing declarative functions.** Demos and
  fixtures use `defineQuery({ table, filter, order, index })` and
  `mutationPlan(...)` directly. Does the declarative *query* form survive
  as sugar (it is genuinely concise for a filtered scan), with only the
  general expression IR retiring? A narrower version of this RFC —
  "retire the expression constructors, keep the filter/order/index
  literal form" — is a legitimate fallback and may be the right first
  step.
- **OQ5 — Interaction with LLP 0319.** If the implementation axis
  collapses to "always JS," LLP 0319's `source` option disappears and
  that collapse gets simpler. Neither RFC blocks the other.

## 6. Cost

The lifting compiler is the cost. Everything else is deletion. A useful
scoping heuristic: build the lifting pass for the *filtered-scan* case
only, measure OQ1 against the corpus, and decide from there. That is a
bounded spike, not a program.

## 7. Why it matters

Two ways to write a function body is the deepest duplication in the
authoring surface. It doubles the guide, doubles the diagnostics, and
forces every agent to make an architecture decision — declarative or
handler? — before writing a line of app logic, on the basis of
performance and analyzability properties it has no way to evaluate. A
compiler makes that decision better than an author can, and can explain
its reasoning. LLP 0127's stated direction is "a declared contract
instead of an inferred one" — this RFC keeps the declaration and moves
the *encoding* to the machine.
