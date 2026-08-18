# LLP 0117: TypeScript type flow — inference, result contracts, and structured inputs

**Type:** Research
**Status:** Active
**Systems:** Competitive evaluation, Developer experience, Authoring, Application data API, Code generation, Client integration, Runtime
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:** 2026-08-12 (disposition update: Draft LLP 0245 takes up option C,
infer-then-freeze, and Draft LLP 0246 takes up first-class TypeScript custody
for the bounded module graph; neither update changes this Research document's
findings). 2026-07-30 (v0.3, round-2 delta review corrections — Fable
READY; Codex NOT READY on two new material items in the v0.2-added text,
with all round-1 concerns resolved. Round-2 deltas in
`reviews/0117-typescript-type-flow-parity.fable.md` and
`reviews/0117-typescript-type-flow-parity.codex.md`; 4 items applied,
all re-verified against the tree. Codex: the CV-5 carrier inventory
corrected to four — the client package's hand-authored public search
typings (`packages/snapback-client/index.d.mts:145`) were missed — and
`argsContractHash` recharacterized as an identity witness computed over
the existing argument descriptors, not a payload slot a schema reference
can ride, so the reference lane is restated through an extended
argument-contract descriptor that the hash then witnesses; option F's
carrier 3 narrowed — definition roots are fixed to
`schema.mjs`/`functions.mjs` (index.mjs:574–575) and external
`.ts`/`.mts` handler scripts refuse imports/exports (index.mjs:4915–4922),
so a first-class `.ts` carrier needs an authoring-surface change first.
Fable: the Diary 0039:25 quote made verbatim ("Convex slight edge"); the
non-generic builder cite corrected to define.d.ts:451 and 521.)
2026-07-30 (v0.2, round-1 dual-family review corrections —
reviews in `reviews/0117-typescript-type-flow-parity.fable.md` and
`reviews/0117-typescript-type-flow-parity.codex.md`; 12 findings applied
(5 Codex, 7 Fable), all re-verified against the tree, none rejected.
Codex: a scoped CV-5 section added — 0115's status board maps CV-5
analysis here, and the search AST is a structured-input instance; the
TypeScript baseline corrected (codegen already imports pinned TS 5.9.3,
admits `.ts`/`.mts` handler files, and types inline handlers
`(ctx: any, args: any) => unknown` — the gap is handler type flow, not a
missing toolchain) with options B/C/F re-scored; a conservative
fail-closed inference lane added as option H; option F's
contextual-typing carrier made concrete; the Relay-delta, info-severity,
and strictness-ordering causal claims reclassified as hypotheses with
named measurements. Fable: three diary-quote attributions corrected to
Diary 0039 (lines 22, 141–142, 25); the Relay 148 → 224 delta restated
with Diary 0033's two causes and a new decomposition open question;
option C's inference-source claim fixed (`checkJs` static inference over
bare `.mjs` exists; F enables C) with open question 5 recast; the Split
figure's plus-acceptance qualifier restored; Convex runtime
args-validation added to the background list; the value-expression IR
scalars-only parenthetical corrected (`ValueExpr::Args`); the Diary 0022
citation disambiguated to 0022-backend-bakeoff.)
**Related:** LLP 0004, LLP 0093, LLP 0108, LLP 0115, LLP 0116, LLP 0118,
LLP 0119, LLP 0245, LLP 0246, Diary 0022, Diary 0027, Diary 0032–0039

## Summary

Across two full bakeoffs, agents building the same applications on Convex and
Snapback consistently named Convex's TypeScript ergonomics as its clearest
authoring advantage. The advantage decomposes into four specific mechanisms:
Convex infers function return types from the handler's TypeScript, so precise
client types cost zero authored lines; its validator vocabulary admits nested
`v.array(v.object(...))` at mutation boundaries and in schema fields, so
structured inputs are typed and validated without hand-written checks; its
defaults never let a function silently lose result precision, because there is
no separate contract to omit; and its generated function references and typed
server contexts (`ctx.db`) make inference work *inside* server code, not just
at the client boundary.

Snapback's answer today is the explicit declared-contract model: hashed,
projected, runtime-enforced result contracts and a deliberately closed
authoring validator vocabulary. The model buys real things ordinary
inference does not provide — pre-commit egress enforcement, replay
identity, language-neutral projection to Swift and Contract, reviewable
hashes — but it charges for them in authored bulk (Relay Board's backend
grew 148 → 224 lines, partly from closing its result contract and partly
from a lost shared helper — Diary 0033 names both causes), in degraded
`unknown` inputs wherever the vocabulary stops (Split Ledger's splits,
Pantry's ingredients/tags), and in a quiet escape hatch two real apps
used to ship degraded results anyway.

Part of the LLP 0116 research series complementing LLP 0115: 0115 sequences
the work (CV-4a/4b, CV-5, and CV-6 here); this document thinks through the
comparison and the option space — eight paths, from widening the
structured-validator vocabulary through full TypeScript inference — and
makes no final call.

## What Convex does

The API shapes below are general background knowledge of Convex; the
paragraphs that follow each shape say what the 2026-07-30 rerun diaries
actually observed.

**Return-type inference.** A Convex function declares args validators and a
handler; the return type is whatever TypeScript infers for the handler:

```ts
export const ledger = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    // ...reads and derivation...
    return { group, participants, expenses, netTotalCents };
  },
});
```

The generated `api` object carries typed `FunctionReference`s, so
`useQuery(api.ledger, ...)` and `ctx.runQuery(api.ledger, ...)` receive the
inferred shape with no authored result declaration. A `returns:` validator
exists but is optional; when omitted, the return type is a compile-time claim
with no runtime check. Diary evidence: Diary 0033 — "Convex remains more
concise … and infers result types from TypeScript without an explicit
result-schema block"; Diary 0039 names "return inference" as part of the
installed loop, and all seven Convex arms passed direct `tsc --noEmit`.

**Structured argument and field validators.** Convex's `v.array`,
`v.object`, `v.union`, `v.literal`, and `v.optional` compose freely in args
*and* schema fields, are runtime-validated at the function boundary, and
produce inferred TS argument types (`Infer<typeof validator>` exposes the
same types to app code). Diary 0039 §5: Convex's `v.array(v.object(...))`
"validates and types the split vector" (0039:141–142), while Diary 0036
records the Snapback arm accepting the same vector as `v.json()` and
validating it by hand; Diary 0039's executive-table row for Split Ledger
reads "Convex slight edge from typed nested mutation input" (0039:25).

**No omission lane.** Because the result type is inference, there is no
separate artifact whose omission degrades typing — a function cannot ship
an `unknown` result by forgetting a block. The analogue failure is a badly
inferred type (an accidental `any`), invisible rather than diagnosed. This
cuts both ways and is discussed below.

**Inference inside server code.** `ctx.db.query("expenses")` is typed from
the schema (`Doc<"expenses">`, `Id<"expenses">`), `ctx.db.insert`
type-checks the inserted value, and calling or scheduling other functions
through generated references carries typed args. Diary 0039 groups this
under "Schema, validators, functions, server contexts, return inference,
generated references … feel like one product."

## What Snapback does today

Everything in this section is code-grounded on current main
(`01e94173`-era tree at the time of writing).

**Result contracts are explicit, enforced declarations.** LLP 0108's
shipped v1 lets each operation declare one closed contract
(`results.documents/records/document/value`). Codegen freezes and hashes
the schema-expanded contract (`packages/snapback-codegen/index.mjs:1943`,
`result-contracts.mjs:473`), projects it into generated TypeScript, JSON
Schema, provider introspection, and Contract bindings, and the Rust host
enforces it at egress: queries validate before publication, mutations
before their transaction commits, rolling back on failure
(`crates/snapback/src/result_contract.rs:19`; 4 MiB ceiling at line 15). Precision
therefore costs authored lines: the contract spells out every nested field,
including stored system fields, that Convex would infer.

**The validator vocabulary is split into two disjoint lanes.** The builders
in `packages/snapback-codegen/define.mjs` construct `v.array`
(define.mjs:263), `v.union` (define.mjs:276), `v.literal`, `v.null`, and
`v.finiteReal` with a `resultOnly: true` marker — but that flag is dead
metadata; nothing reads it. The operative gate is
`validateAuthoringValidator` (`packages/snapback-codegen/index.mjs:3300`),
one recursive check applied at every authoring position — schema fields
(index.mjs:681), function args (index.mjs:1242), legacy results, ephemeral
scope/value — whose closed primitive map (index.mjs:3309) admits only
`string`, `boolean`, `number`, `unknown`, and `object`. An array or union
validator in an argument fails `FUNCTION_INVALID_VALIDATOR`; in a schema
field, `SCHEMA_INVALID_VALIDATOR`. `results.*` contracts bypass that lane
entirely — they travel as `resultContract` (define.mjs:1711) into
`result-contracts.mjs`, which recurses through arrays and unions happily.
"Result-contract-only" is thus a code-structure fact: two validation lanes
with different grammars, not one vocabulary with a policy.

**Structured inputs degrade to `v.json()` plus hand-written validation.**
Split Ledger's split vector and Pantry's ingredients/tags arrays are
authored as `v.json()`; the handlers re-implement structural, integer,
membership, uniqueness, and sum checks imperatively (Diary 0036 §What
remains painful, Diary 0037). The degradation is loud downstream —
`PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED` at `severity: 'warning'`
(`packages/snapback-codegen/provider-introspection.mjs:621`) — but the
authoring-time experience is "the typed spelling refuses; use JSON and
validate by hand." One narrowing matters (LLP 0115 v0.2, re-confirmed
here): nested `v.object` *arguments already work end-to-end*. The input gap
is specifically arrays and unions.

**No server-side argument ingress validation exists at all.** Args are
typed by codegen and by plan-time expression typing, but no per-invocation
args-shape check runs in the Rust host even for scalars (no ingress
counterpart to `validate_handler_result` exists in `crates/snapback/src/`; args cross
`crates/snapback/src/handler_wire.rs` as pre-serialized JSON text). Convex validates
declared args at runtime. Closing CV-4a therefore *adds* an evidence
boundary Snapback currently lacks.

**Omitted result contracts are admitted at `severity: 'info'`.** When an
operation declares no contract, codegen emits
`SNAPBACK_HANDLER_RESULT_CONTRACT_DEGRADED` with a table-interpolating
remediation — at `severity: 'info'`
(`packages/snapback-codegen/index.mjs:1955`). Two real rerun arms shipped
degraded contracts through that gap: Cursor Garden's `updateNote` and
Pantry Search's `addRecipe` (Diary 0039 P1-6; LLP 0108 §Diary 0039 field
evidence). The mechanism works; the policy does not.

**Type flow is outward-only, and it stops at the handler boundary — not
at a missing toolchain.** A TypeScript surface already exists on both
sides of the interior: codegen imports a pinned TypeScript compiler
(index.mjs:34; `"typescript": "5.9.3"`,
`packages/snapback-codegen/package.json:56`), `.ts`/`.mts` handler files
are a declared authoring surface parsed with the pinned TS AST
(dispatch at index.mjs:4416–4419; scanner at index.mjs:4727–4730),
esbuild admits `.ts`/`.mts`/`.cts` definition dependencies
(index.mjs:7112), and `define.d.ts` ships validator inference
(`InferValidator`, define.d.ts:36) and typed builder declarations.
Generated `api.d.ts` gives clients exact phantom-typed references (LLP
0108 §Generated references). What is missing is the interior: inline
handlers are typed `(ctx: any, args: any) => unknown` (define.d.ts:305,
326, 341) on non-generic builder signatures (define.d.ts:449–452), so
nothing types `ctx.db` inside a handler and nothing compares a handler's
returned shape against its declared contract before runtime — the pinned
compiler is used for syntax and transpilation, never for handler type
flow. Codegen's emitted file set (index.mjs:2428) contains
client/provider/manifest artifacts only. The declared contract flows
*out* to consumers; nothing flows *into* the authoring interior.

## How they differ, and why agents preferred Convex

The felt difference is per-boundary friction, not total volume. Matrix-wide,
authored size is effectively tied — 2,196 Snapback lines vs 2,176 Convex
lines across the seven apps (Diary 0039 §Quantitative shape). But the cost
concentrates exactly where an agent is looking: Relay Board's backend grew
from 148 authored lines to 224 — "largely because the exact nested result
contract is verbose and the guide's inline profile steered this app away
from a shared sibling reader helper" (Diary 0033:41–45; two named causes,
no measured decomposition — the helper half is LLP 0118's subject, and the
split is open question 7) — and Split Ledger's arm grew 379 → 427 lines of
authored source plus acceptance (Diary 0036:113–114) while *deleting* its
separate handler registry ("colocation is not a line-count reduction"). A
contract block is transcription of a shape the author just produced; on
Convex that work does not exist. The asymmetry repeats at
inputs — the Convex author writes the validator once and gets typing,
runtime validation, and docs; the Snapback author writes `v.json()` and then
writes the validator anyway, as imperative code with no generated type — and
inside server code, where Convex's handler interior is fully typed and
Snapback's is untyped JavaScript against an untyped `ctx.db`.

The honest other side, which the diaries also credit:

- **Enforcement.** Convex's inferred return type is erased at runtime;
  unless the author opts into `returns:` validators, nothing checks what
  the function actually returns. Snapback validates every declared result
  at egress, before publication or commit, with rollback semantics
  (`crates/snapback/src/result_contract.rs`). An inferred type is a claim; a contract is a
  check. Diary 0039's executive-table framing — "Convex infers more,
  Snapback proves more" (0039:22) — is exactly right.
- **Reviewability and drift.** A Snapback contract change is a visible
  authored diff plus a hash change carried through every projection. A
  Convex return-shape change is whatever the code now returns — the
  contract moves silently with the implementation, which is precisely what
  makes inference cheap.
- **Portability beyond TypeScript.** The Rust-owned manifest is
  language-neutral: one contract feeds generated TypeScript, provider
  introspection, Contract bindings, and the Swift client (LLP 0093).
  Inference has no story for non-TS consumers — the contract *is* the TS
  types.
- **Vocabulary precision.** `v.integer` vs `v.real`, byte bounds,
  `maxItems`, id brands, and closed discriminated unions are richer than
  what inference naturally yields (`number`, unbounded arrays, open
  objects).

The diaries' preference is therefore not "inference is strictly better":
Snapback charges the full explicitness price at every boundary, offers no
compression and no interior typing, and still lets the biggest evidence
hole — an omitted contract — through at info severity.

## Option space

Eight paths, deliberately overlapping. Where LLP 0115 names a lead mechanism
(A, G), it is treated as one leading option, with alternatives analyzed
seriously. The two hard constraints every option is scored against are
0115's **no evidence regression** (Governing constraint 1) and LLP 0108's
**no-inference-from-source invariants** (results are never invented from
handler behavior; no `Function.prototype.toString()` authority; no runtime
capture inference).

### A. Extend structured validators to arguments, then storage (CV-4a/4b)

Widen the argument lane to admit `v.array`/`v.union` (and the other
result-only spellings where they make sense), build the missing server-side
ingress validation seam by reusing `result_contract.rs`'s recursion for
arguments, then take on stored collection fields as the separate larger
design (FieldType extension, SQLite/Postgres representation under LLP
0004's portability rules, index/`arrayContains`/live-matcher semantics,
LLP 0081 migrations).

- **Benefits.** Kills the most concrete diary pains (Split's splits,
  Pantry's ingredients/tags) at their exact location. *Strengthens*
  evidence: ingress validation is a new fail-closed boundary that does not
  exist today — one of the rare options where DX and evidence point the
  same way. Most result-side plumbing (spellings, recursion, JCS hashing,
  bounds, path diagnostics) is reusable prior art — including an
  argument-contract identity witness already computed over the authored
  args descriptors and carried through the manifest with no runtime
  consumer (`argsContractHash`, result-contracts.mjs:38; computed at
  index.mjs:1942) — and one vocabulary for args and results removes the
  two-lane surprise entirely.
- **Costs/risks.** Real new runtime surface with per-invocation hot-path
  cost; interaction with the host-plan value-expression IR (whose argument
  references already carry structured JSON — `ValueExpr::Args` yields the
  whole args object and `ValueExpr::Arg` path lookups yield whatever JSON
  sits at the path, `crates/snapback/src/value_expr.rs:121–128` — so the interaction is
  with operator and comparison semantics, not reference shape); CV-4b's
  storage design is genuinely large and not de-risked by any of this.
  Crucially, this option does nothing about authoring bulk or inference —
  it fixes (b) while leaving (a), (c), and (d) untouched.
- **Constraint fit.** Clean on both constraints. 0115's named lead, and the
  right first move on the input half regardless of what else is chosen.

### B. Full TypeScript-inference authoring (Convex-style)

Adopt a TypeScript authoring lane and make the type-checker's inferred
return type of each handler the operation's contract; codegen translates
checker output into the manifest.

- **Benefits.** Eliminates contract authoring bulk completely; matches the
  ergonomics agents demonstrably prefer; return types can never drift from
  code because they *are* the code's types.
- **Costs/risks.** Violates LLP 0108's invariant as written — the contract
  is derived by examining handler source, statically but still as authority.
  Contract identity becomes a function of compiler version: a tsc upgrade
  that changes inference changes contract hashes with no authored diff.
  Ordinary handler inference does not yield the vocabulary — an inferred
  `number` carries no integer/real split, no bounds, no byte ceilings —
  though TS is not categorically incapable here: it expresses closed
  discriminated unions directly, and branded or refinement types can carry
  richer guarantees where authors opt in. As framed here (permissive,
  Convex-style), the translation either weakens the runtime check to
  structural JSON — a direct evidence regression — or invents bounds;
  option H below is the fail-closed variant that refuses instead.
  Unsoundness leaks: an inferred `any` or widened union silently becomes a
  weak contract with no diagnostic, Convex's invisible analogue of the
  degraded-result problem. And while a pinned TS toolchain already ships
  in codegen (§What Snapback does today — syntax and transpilation only),
  this promotes the compiler from parser to build *authority* and forfeits
  the language-neutral authoring story (LLP 0093's Swift arm consumes
  contracts, not TS).
- **Constraint fit.** Conflicts with both constraints as stated. Adopting it
  would be a re-litigation of LLP 0108's core posture — a different product
  stance, not an increment. Documented seriously because it is the shape of
  the competitor's advantage, not because it is recommended.

### C. Infer-then-freeze — inference proposes, a frozen contract is authority

Run type inference (over a TS or JSDoc-annotated authoring surface) as a
*proposal* generator: tooling drafts the `results.*` block; the author
reviews and commits it; the frozen declaration remains the sole authority,
hashed and runtime-enforced exactly as today. Fresh-inference-vs-frozen
drift becomes a diagnostic, never an auto-update.

- **Benefits.** Keeps the evidence chain intact — the authored, reviewed,
  hashed contract is unchanged in kind — while removing most transcription
  cost: accepting a correct proposal is one review, not N lines of
  composition. Fits agent workflows well (agents are good at reviewing a
  proposed block against a handler they just wrote). The runtime and
  manifest never see TypeScript.
- **Costs/risks.** Two representations must be reconciled forever, and
  noisy drift diagnostics could become the next ignored info-severity lane.
  Quality proposals need good inference *input*, but not a new authoring
  surface: TypeScript's `checkJs` performs static inference over bare
  `.mjs` with no JSDoc and no execution — a returned object literal infers
  a precise shape — and static source analysis as dev-time assist is not
  the runtime-capture inference LLP 0108 forbids (though the distinction
  still needs the dated clarification below). The real limit is inference
  *quality*: with `ctx` and `args` typed `any`, fields derived from reads
  infer as `any`. That is exactly what option F's generated context types
  fix — F enables C over the existing `.mjs` surface, with no TS authoring
  lane required. Review can degenerate to rubber-stamping, at which point
  this is option B with extra steps. Needs a dated LLP 0108 clarification
  distinguishing dev-time authoring-assist from forbidden authority
  inference.
- **Constraint fit.** Compatible with the letter of both constraints if the
  frozen artifact stays authoritative; the spirit needs the 0108 amendment
  to say so explicitly. The most promising bridge if bulk remains decisive
  after A and E.

### D. Codegen-assisted contract scaffolding from declared facts

No inference from handler code at all: scaffolding derives candidate
contracts from what is *already declared* — schema shapes for
`documents`/`document`, declared reads, table field lists — via a CLI
(`snapback contract suggest <fn>`) or by upgrading the degraded diagnostic's
remediation to a paste-ready schema-derived skeleton.

- **Benefits.** Zero authority change, zero new invariants, cheap, and
  aligned with the remediation that already ships. Good for the common
  stored-row cases.
- **Costs/risks.** Can only suggest what schema knows: computed record
  shapes (Relay's assembled board view, Split's derived `netCents`) are
  exactly the shapes that made contracts long, and they are invisible to
  schema-only scaffolding. LLP 0108 already pins the ceiling — a
  field-level paste-ready suggestion would require inspecting handler
  behavior, which the invariants forbid — so this option is structurally
  capped at the template level, and the template already ships.
- **Constraint fit.** Clean, but low-yield; a complement, not an answer.

### E. Schema-referencing contract vocabulary — compression without inference

Extend the contract grammar so composite contracts can *reference* declared
schema shapes instead of respelling them: a `v.doc("cards")` value node
usable inside `results.records(...)` compositions, plus perhaps a bounded
`v.pick(table, [fields])`. Generation expands references into the same
frozen, hashed contract that exists today — shipped precedent:
`Document`/`Documents` already expand at generation/load into frozen
name-keyed structural schemas (LLP 0108 §C).

- **Benefits.** Attacks the measured bulk — on a hypothesis: Diary 0033
  names contract verbosity as one of two causes of Relay's 148 → 224
  growth (the other is helper loss, LLP 0118's half) and gives no
  decomposition, so the schema-respellable fraction E can compress is an
  empirical question (open question 7), cheaply measurable from the rerun
  app sources before any implementation. Diary 0033's own priority list
  asks for "schema-backed projection helpers that preserve exact egress
  validation." Evidence is byte-identical downstream — expanded contract,
  hash, runtime validation, projections all unchanged. Schema evolution
  flows into referencing contracts with a visible hash change. Small spec
  delta with shipped precedent.
- **Costs/risks.** Contract hashes change when a referenced table changes
  even though the function was untouched — correct, but surprising, and
  implementation-identity churn has custody consequences. Does not help
  computed fields or arguments. The grammar must stay closed or it grows
  into a projection language (`pick`/`omit`/`partial`/renames) with its own
  review burden.
- **Constraint fit.** Clean on both. Alongside A, the most promising
  near-term option — the only path that reduces authored lines while
  leaving the authority model untouched. Whether it belongs to the CV-4
  Spec or an LLP 0108 amendment is an open question below.

### F. TS language-service and check integration — typed interior

Keep `.mjs` authoring and declared contracts authoritative, but generate
the handler-facing type surface Snapback lacks: a per-app
`handler-context.d.ts` typing `ctx.db` from the schema, args parameter
types from declared validators, and — the inverse of inference — a dev-time
check that the handler's inferred return type is *assignable to* the
declared contract, so a contract/handler mismatch is a red squiggle and an
optional `tsc --checkJs` failure instead of a runtime egress refusal.

- **Mechanism.** A bare generated `handler-context.d.ts` is not enough by
  itself: contextual typing of an inline handler's parameters comes from
  the *builder's* declared parameter type, and today's builders declare
  `handler: (ctx: any, args: any) => unknown` (define.d.ts:305, 326, 341)
  on non-generic `defineJsQuery`/`defineJsMutation` signatures
  (define.d.ts:451, 521). Triple-slash references and tsconfig `include`
  patterns only make ambient names visible; they attach nothing to the
  handler's parameters. Two carriers work on today's surface: (1) a
  generated per-app typed builder module — authors import the app's
  `define` wrapper whose handler parameter and return types are projected
  from the schema and the declared contract; (2) generated per-operation
  JSDoc handler types
  (`@type {import("./generated").QueryHandler<"ledger">}`), which work
  under `checkJs` without changing imports but must be authored at each
  handler. A third — first-class `.ts` handler modules checked against a
  generated app-specific module — is *not* viable as the surface stands:
  `.ts`/`.mts` admission is handler-script-only (definition roots are
  fixed to `schema.mjs`/`functions.mjs`, index.mjs:574–575), and handler
  scripts are closed single-file programs whose imports and exports are
  refused (index.mjs:4915–4922), so this carrier first requires an
  authoring-surface change — admitting `.ts` definition roots, or a
  type-only import lane through the closed-script rule. In every carrier
  the return check is assignability of the *inferred* return to the
  *generated-from-declaration* type: the checker consumes the contract's
  projection and never mints one, so the declared contract stays
  authoritative by construction.
- **Benefits.** Directly answers (d), the half no 0115 item touches: the
  Convex-feel loop inside server code without moving authority an inch.
  Drift detection runs contract→code (allowed), never code→contract.
  Incremental, with in-repo precedent (codegen already JSDoc-self-types
  `api.mjs`, index.mjs:5870). Cheap to pilot on one workout arm.
- **Costs/risks.** TS checks structure but not bounds — the editor check is
  weaker than the runtime one, and that gap must be documented or it breeds
  false confidence. The generated d.ts is a new drift surface against the
  Rust manifest, needing the export-and-gate treatment CV-5 applies to the
  search AST. An optional check nobody runs helps nobody — the CV-6
  lesson — so it needs a slot in the local proof or acceptance rungs.
- **Constraint fit.** Clean; needs one clarification that a
  *declared-contract-checking* use of the type-checker is not forbidden
  inference (it consumes the declaration; it does not mint one).

### G. Strictness policy for degraded results (0115 CV-6 / OQ3)

Raise `SNAPBACK_HANDLER_RESULT_CONTRACT_DEGRADED` above `info`, or make
omission a refusal behind a per-app strictness toggle; either lands as an
LLP 0108 amendment, plus guide reordering so the exact forms lead.

- **Benefits.** Closes (c) with a one-line severity change; the field
  evidence is that info severity did not *prevent* omission (two shipped
  offenders in one seven-app rerun). Whether severity — rather than
  contract cost, guide ordering, or deliberate prioritization — *caused*
  the omissions is untested (open question 6). Raises fleet-wide evidence
  coverage either way.
- **Costs/risks.** Sequencing is the whole game: strictness *before* bulk
  relief (A/E, or C) raises the authoring tax on exactly the surface agents
  already dislike — the hypothesis, unmeasured, is that "write the big
  block or be refused" would score worse in the next rerun (open question
  6 names the measurement). Convex ships the opposite default and agents
  liked it; Snapback's counter (an unvalidated inferred type is a claim,
  not a check) is only persuasive once declaring the contract is cheap. A
  per-app toggle risks becoming a fleet-wide off-switch unless paved
  templates default it on.
- **Constraint fit.** Clean; pure policy. The decision is the author's
  (0115 OQ3) — this document only notes the ordering dependency.

### H. Conservative fail-closed inference — normalize, refuse on evidence loss

A genuinely distinct lane between B and C: infer handler return types
statically (over `.ts`/`.mts` sources or `checkJs` on `.mjs`), then
*normalize* the inferred type deterministically into the existing contract
vocabulary — and refuse codegen wherever normalization would lose evidence
(an inferred `any`, unsupported constructs, ambiguous numerics, unbounded
strings or arrays with no profile default), requiring a validator-backed
refinement or an explicit `results.*` block at exactly those sites. The
normalized output is hashed together with pinned compiler/toolchain
identity and enforced at egress unchanged.

- **Benefits.** Unlike B it never silently weakens a contract: evidence
  loss is a refusal, not a degradation. Unlike C there is no second
  authored representation to reconcile in the common case. Bounds are not
  invented — the existing profile maxima supply *specified* defaults for
  strings, arrays, and structural JSON, and everything else refuses. On
  simple stored-row shapes it could capture most of the zero-declaration
  ergonomics while keeping the runtime check exact and the manifest
  language-neutral (the normalized artifact, not TS types, is what
  projects to Swift and Contract).
- **Costs/risks.** Contract identity still becomes a function of compiler
  version — pinning mitigates, but where toolchain identity lands
  (`resultContractHash`, `implementationHash`, or both) is a real custody
  question, analyzable now (open question 5). Refusal frequency is
  unmeasured: if most real handlers trip the refuse conditions, H
  degenerates into C with worse diagnostics (open question 8). And the
  normalized artifact *is* minted from handler source as authority, so
  like B it crosses LLP 0108's no-inference-from-source line — failing
  closed changes the evidence outcome, not the authority question.
- **Constraint fit.** Satisfies 0115's no-evidence-regression constraint
  by construction (refusal, never weakening) but still conflicts with LLP
  0108's invariant as written, so like B it needs re-ratification. It is
  the strongest form of the inference case: any future re-litigation of
  0108 should score itself against H, not B.

**Composition.** A, E, F, and G are mutually compatible and jointly cover
(a)–(d) without touching the authority model: A fixes inputs and adds
ingress evidence, E compresses result declarations, F types the interior and
catches mismatches at dev time, G then makes precision the default once it
is cheap. C is the bridge if, after A+E, transcription cost still dominates
the rerun's scoring — and F enables C (and would feed H's inference
quality) over the existing `.mjs` surface. B is the terminal
competitor-shaped move; H is its fail-closed form, the version any LLP
0108 re-ratification debate should score against, since it buys inference
ergonomics without evidence weakening. D is a low-cost complement already
near its structural ceiling.

## CV-5: the typed search AST is a structured-input instance

LLP 0115's status board maps CV-5 — "Typed search AST: schema export +
carrier alignment" — to this document's analysis layer, and it belongs
here: it is mechanism (b), structured inputs, in its purest form.
`defineSearchQuery` authors its query argument as `query: v.json()`
(define.mjs:778), so the one place the *platform itself* ships a
structured input, it ships the same degraded spelling the diaries complain
about at app boundaries. Downstream, the generated client's
`SearchQueryAstV1`/`SearchRequestV1` interfaces are hand-authored string
literals inside codegen (index.mjs:5907–5908), not derived from a shared
artifact; the client package's public typings hand-author the same AST
shapes a second time, independently
(`packages/snapback-client/index.d.mts:145`); and `crates/snapback/src/schema_export.rs`
exports no search schema — so four carriers (the authored validator, the
codegen-emitted client types, the client package's own typings, and the
Rust parser that actually owns the grammar) describe one shape with
nothing gating their agreement.

The type-flow analysis adds one structural point to 0115's work item: the
search AST should *not* be fixed by widening the authoring validator
vocabulary (option A's move). The grammar's owner is the Rust host
(`snapback-search-parser-v1`), not the app author; respelling a host-owned
grammar in `v.*` validators would create a second authority for one shape,
exactly the drift this document scores against elsewhere. The right shape
is the argument-side analogue of option E — *reference, don't respell*: the
operation contract carries a reference to one exported, drift-gated
Rust-owned schema, and the generated client types and provider
introspection derive from or verify against that artifact. No manifest
payload slot exists for such a reference to ride today: `argsContractHash`
is an identity witness, not a carrier — a digest computed over the
existing authored argument descriptors (result-contracts.mjs:38,
canonical JSON under a `snapback:function-args:v1` domain prefix;
computed at index.mjs:1942, no runtime consumer) — so CV-4a must extend
an actual argument-contract descriptor to carry the reference, with the
hash then witnessing the extended descriptor's canonical form. This
is also why 0115's sequencing — CV-5 as the first conformance fixture for
CV-4a's argument-contract carrier — is the right order: it exercises the
reference lane end-to-end on a closed, host-owned grammar before
app-authored arrays and unions arrive. Whether the provider projection is
a byte-for-byte carrier or a Contract-owned surface is LLP 0073 open
question 12, owned there; nothing here re-litigates it.

## Findings

1. The type-flow gap decomposes into four separable mechanisms — return
   inference (a), structured inputs (b), omission policy (c), interior
   typing (d). CV-4 covers (b) at app boundaries and CV-5 covers its
   host-owned search instance; CV-6 covers (c); nothing on 0115's status
   board covers (a) or (d).
2. The felt cost is per-boundary, not total: matrix authored size is tied
   (2,196 vs 2,176 lines) while the contract-closing deltas are large and
   local (Relay 148 → 224; Split 379 → 427 with acceptance). Relay's delta
   has two diary-named causes — contract verbosity and helper loss — with
   no measured decomposition (open question 7), which gates how much of it
   boundary-compressing options (E) can win back without changing totals
   much.
3. "Result-contract-only" is a two-lane code structure, not a policy knob:
   the authoring gate is one closed primitive map
   (`packages/snapback-codegen/index.mjs:3300`, applied at index.mjs:681
   and index.mjs:1242) with no array/union entries, while `results.*`
   contracts travel a separate lane through `result-contracts.mjs`. The
   builders' `resultOnly` flag (`define.mjs:263,276`) is dead metadata.
   Widening arguments is a lane merge, not a flag flip.
4. Snapback has *no* server-side argument validation today, even for
   scalars, while Convex runtime-validates declared args. CV-4a is
   therefore an evidence addition disguised as a DX item.
5. The degraded-result escape let two of seven real arms ship degraded
   contracts with working mechanism in place: the diagnostic ships with
   remediation at `severity: 'info'`
   (`packages/snapback-codegen/index.mjs:1955`), and the provider-side
   warning fires only downstream (`provider-introspection.mjs:621`). That
   the severity level — rather than contract cost, guide ordering, or
   deliberate prioritization — caused the omissions is a hypothesis the
   next rerun tests (open question 6), not an established fact.
6. Explicit contracts hold four advantages ordinary handler inference
   does not provide: runtime egress enforcement with pre-commit rollback
   (`crates/snapback/src/result_contract.rs:19`), replay identity bound to contract hashes,
   language-neutral projection (Swift, Contract, provider introspection),
   and a value vocabulary richer than inferred TS. A normalizing,
   fail-closed inference lane (H) could recover the projection and
   identity halves at the price of compiler-version custody; permissive
   inference (B) preserves none of the four at full strength. Every
   option was scored on preserving these.
7. Permissive TS inference (B) and its fail-closed variant (H) both
   structurally conflict with LLP 0108's no-inference-from-source
   invariants, and both make contract identity a function of compiler
   version; only B additionally violates 0115's no-evidence-regression
   constraint — H refuses where it would regress. The bridge that keeps
   the frozen declaration authoritative is infer-then-freeze (C), which
   needs no new authoring surface: `checkJs` static inference over the
   existing `.mjs` files is a lawful proposal source, and F's generated
   context types are what raise its quality.
8. The interior-typing gap (d) is real, unowned, and not a toolchain gap:
   a pinned TS compiler and `.ts`/`.mts` handler admission already ship
   (index.mjs:34, 4416–4419; package.json:56), but inline handlers
   collapse to `(ctx: any, args: any) => unknown` (define.d.ts:305),
   nothing types `ctx.db`, no dev-time check compares a handler's return
   against its declared contract, and codegen emits no handler-facing
   types (index.mjs:2428). A contract-checking (not contract-minting) TS
   integration is constraint-clean and unclaimed.
9. The platform's own search boundary ships the degradation it diagnoses
   elsewhere: `defineSearchQuery` authors `query: v.json()`
   (define.mjs:778), and four unaligned carriers — authored validator,
   codegen-emitted client interfaces (index.mjs:5907–5908), the client
   package's own hand-authored typings
   (packages/snapback-client/index.d.mts:145), Rust parser — describe
   one host-owned grammar with no exported schema gating them.
   The fix lane is reference-not-respell, the argument-side analogue of E,
   which is why CV-5 is the right first fixture for CV-4a's carrier.

## Confidence

**Verified in code (this document, current main):** the closed primitive
map and its application points (index.mjs:3300, 3309, 681–682, 1242–1243);
the dead `resultOnly` flag (define.mjs:263, 276; no readers found
repo-wide); the separate result-contract lane (define.mjs:1711;
result-contracts.mjs:473); the info-severity degraded diagnostic
(index.mjs:1955–1956) and warning-severity provider degradation
(provider-introspection.mjs:621, 633); Rust egress validation, rollback
seam, and ceiling (crates/snapback/src/result_contract.rs:15–44); absence of args ingress
validation in `crates/snapback/src/`; `defineSearchQuery` authoring `query: v.json()`
(define.mjs:778); no handler-facing types in the emitted artifact list
(index.mjs:2428); the pinned TypeScript toolchain and its actual role
(`import ts from 'typescript'`, index.mjs:34; `"typescript": "5.9.3"`,
`packages/snapback-codegen/package.json:56`; `.ts`/`.mts` handler
dispatch, index.mjs:4416–4419; esbuild `.ts`/`.mts`/`.cts` admission,
index.mjs:7112) against `any`-typed inline handler signatures
(define.d.ts:305, 326, 341) and non-generic builders
(define.d.ts:449–452); structured argument references in the
value-expression IR (`ValueExpr::Args` and path lookups,
crates/snapback/src/value_expr.rs:121–128); both hand-authored search client carriers —
the codegen-emitted interfaces (index.mjs:5907–5908) and the client
package's public typings (packages/snapback-client/index.d.mts:145) —
and the absence of any search schema in `crates/snapback/src/schema_export.rs`; the
unconsumed `argsContractHash` identity witness (result-contracts.mjs:38;
computed at index.mjs:1942); fixed `.mjs` definition roots
(index.mjs:574–575) and the closed-script import/export refusal for
external `.ts`/`.mts` handler scripts (index.mjs:4915–4922).

**Diary-reported (not independently re-run):** all Convex-arm behavior and
passes; the line-count figures (148 → 224, and 379 → 427 counting authored
source plus acceptance, 2,196 vs 2,176); the two-cause, undecomposed Relay
delta (0033:41–45); the `v.json()` hand-validation experience; the two
degraded-contract offenders. Diaries 0033/0036/0037/0039, plus Diary
0022-backend-bakeoff (two diaries share the number 0022; the
backend-bakeoff one, lines 76–77) for the earlier `unknown`-degradation
record ("casts the API and normalizes unknown rows") and Diary 0027 via
0036's recap.

**General background knowledge of Convex (not re-verified against current
releases):** the optional `returns:` validator; `Infer<typeof validator>`;
generated `dataModel` typing of `ctx.db`; typed `ctx.runQuery`/scheduler
references; runtime validation of declared args at the function boundary
(the diaries show Convex arms passing, not invalid-payload refusal).
TypeScript behavior cited as background: `checkJs` static inference over
plain JavaScript, and contextual typing of function-literal parameters
flowing from the enclosing call's declared parameter types. Claims
depending only on these are labeled as background above; the load-bearing
comparative claims are the diary-observed ones.

## Open questions

1. Should the argument vocabulary be *identical* to the result vocabulary
   (one grammar, one lane), or a subset? The CV-4a Spec owns this; the
   two-lane structure found here argues for one grammar.
2. Does the schema-referencing vocabulary (option E) belong inside the
   CV-4 Spec, in an LLP 0108 amendment, or in its own Spec? It touches the
   result grammar (0108) but rides the expansion machinery the CV-4 work
   will generalize.
3. What is the ingress-validation runtime cost budget, and does argument
   validation need its own capability id and acceptance evidence the way
   `result_contract_v1` has?
4. Is a contract-*checking* use of the TypeScript checker (option F) inside
   or outside LLP 0108's no-inference invariant as written? A dated
   clarification either way is cheap and unblocks the pilot.
5. Once option F's generated context types exist, does `checkJs` proposal
   quality over the existing `.mjs` surface suffice for infer-then-freeze
   (C), or does C still want a first-class TS authoring lane? And for any
   inference lane (C's proposals, H's authority), who owns TS-toolchain
   version pinning as part of contract custody — does compiler identity
   enter `implementationHash`, `resultContractHash`, or both?
6. Which severity actually changes agent behavior for CV-6 — warning,
   error, or refusal-behind-toggle — was severity (rather than contract
   cost, guide ordering, or deliberate prioritization) even the cause of
   the two shipped omissions, and does strictness-before-cheapness worsen
   the authoring score? The next matrix rerun measures these directly.
7. What fraction of the measured contract bulk (Relay's 148 → 224, Split's
   contract block) is schema-referencable — E-compressible stored-document
   and system fields — versus computed shapes E cannot reach and
   helper-loss duplication owned by LLP 0118? Measurable from the rerun
   app sources before any implementation; it gates option E's expected
   yield and the A+E-then-C bridge test.
8. What fraction of real handlers would a fail-closed normalization (H)
   accept without annotation? Measurable by running inference over the
   rerun arms' handlers; a high refusal rate collapses H into C.

## Relationship to LLP 0115 and owning documents

LLP 0115 sequences; this document explores. Option A is 0115's CV-4a/4b and
stays owned there: the new Spec plus the dated LLP 0004 alignment own
arguments and stored fields, and nothing here respecifies them. CV-5
likewise stays owned by 0115 and its owning documents (LLP 0073, Diary
0037); this document's contribution is the reference-not-respell shape and
confirmation of the CV-4a-fixture sequencing (§CV-5). Option G is CV-6, an
LLP 0108 amendment gated on 0115's open question 3; the ordering
dependency (strictness after cheapness) is this document's contribution to
that call. Options E and F are *not* on 0115's status board and are offered
as candidate additions — E as a natural rider on the CV-4-era grammar work,
F as a small unowned pilot. Options B, C, and H are recorded as the honest
larger option space; adopting B or H would require re-ratifying LLP 0108's
invariants, and C needs a dated 0108 assist-vs-authority clarification —
this Research document does none of that. Helper reuse — the other half of
the authoring-bulk story — is LLP 0118's subject
(CV-7); reactive defaults are LLP 0119's (CV-11 and the watch item).
Retired gaps (search capability itself, colocation, exact recursive result
contracts, custody, pagination) are not re-litigated. No final call is
made: LLP 0116 indexes the series, and later owned Specs and Decisions
choose.
