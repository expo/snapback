# LLP 0117: TypeScript type flow — inference, result contracts, and structured inputs

**Type:** Research
**Status:** Draft
**Systems:** Competitive evaluation, Developer experience, Authoring, Application data API, Code generation, Client integration, Runtime
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Related:** LLP 0004, LLP 0093, LLP 0108, LLP 0115, LLP 0116, LLP 0118, LLP 0119, Diary 0022, Diary 0027, Diary 0032–0039

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
authoring validator vocabulary. The model buys real things inference cannot
— pre-commit egress enforcement, replay identity, language-neutral
projection to Swift and Contract, reviewable hashes — but it charges for
them in authored bulk (Relay Board's backend grew 148 → 224 lines closing
its result contract), in degraded `unknown` inputs wherever the vocabulary
stops (Split Ledger's splits, Pantry's ingredients/tags), and in a quiet
escape hatch two real apps used to ship degraded results anyway.

Part of the LLP 0116 research series complementing LLP 0115: 0115 sequences
the work (CV-4a/4b, CV-6 here); this document thinks through the comparison
and the option space — seven paths, from widening the structured-validator
vocabulary through full TypeScript inference — and makes no final call.

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
same types to app code). Diary 0036: Convex "validates and types the split
vector" as `v.array(v.object(...))` while the Snapback arm accepted the
same vector as `v.json()` and validated it by hand; Diary 0039 §5 scores
Split Ledger a "slight Convex edge from typed nested mutation input."

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
(`src/result_contract.rs:19`; 4 MiB ceiling at line 15). Precision
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
counterpart to `validate_handler_result` exists in `src/`; args cross
`src/handler_wire.rs` as pre-serialized JSON text). Convex validates
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

**Type flow is outward-only.** Generated `api.d.ts` gives clients exact
phantom-typed references (LLP 0108 §Generated references), but handler
bodies are plain `.mjs` with no TypeScript in the loop: nothing types
`ctx.db` inside a handler, and nothing compares a handler's returned shape
against its declared contract before runtime. Codegen's emitted file set
(index.mjs:2428) contains client/provider/manifest artifacts only. The
declared contract flows *out* to consumers; nothing flows *into* the
authoring interior.

## How they differ, and why agents preferred Convex

The felt difference is per-boundary friction, not total volume. Matrix-wide,
authored size is effectively tied — 2,196 Snapback lines vs 2,176 Convex
lines across the seven apps (Diary 0039 §Quantitative shape). But the cost
concentrates exactly where an agent is looking: Relay Board's backend grew
from 148 authored lines to 224 closing its composite result contract (Diary
0033), and Split Ledger's arm grew 379 → 427 lines while *deleting* its
separate handler registry (Diary 0036 — "colocation is not a line-count
reduction"). A contract block is transcription of a shape the author just
produced; on Convex that work does not exist. The asymmetry repeats at
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
  (`src/result_contract.rs`). An inferred type is a claim; a contract is a
  check. Diary 0033's framing — "Convex infers more, Snapback proves
  more" — is exactly right.
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

Seven paths, deliberately overlapping. Where LLP 0115 names a lead mechanism
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
  bounds, path diagnostics) is reusable prior art, and one vocabulary for
  args and results removes the two-lane surprise entirely.
- **Costs/risks.** Real new runtime surface with per-invocation hot-path
  cost; interaction with the host-plan value-expression IR (which operates
  over scalar arg references); CV-4b's storage design is genuinely large
  and not de-risked by any of this. Crucially, this option does nothing
  about authoring bulk or inference — it fixes (b) while leaving (a), (c),
  and (d) untouched.
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
  TS types cannot express the vocabulary (integer vs real, bounds, byte
  ceilings, closed unions), so either the runtime check weakens to
  structural JSON — a direct evidence regression — or a lossy translation
  invents bounds. Unsoundness leaks: an inferred `any` or widened union
  silently becomes a weak contract with no diagnostic, Convex's invisible
  analogue of the degraded-result problem. And Snapback authoring today is
  plain `.mjs` with no TS toolchain; this imports a compiler as build
  authority and forfeits the language-neutral authoring story (LLP 0093's
  Swift arm consumes contracts, not TS).
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
  Quality proposals need something to infer *from*, which quietly implies a
  TS or JSDoc authoring surface anyway (in bare `.mjs` the only inference
  source is handler behavior, which is forbidden). Review can degenerate to
  rubber-stamping, at which point this is option B with extra steps. Needs
  a dated LLP 0108 clarification distinguishing dev-time authoring-assist
  from forbidden authority inference.
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

- **Benefits.** Attacks the *measured* bulk directly: Relay's 148 → 224
  growth was dominated by respelling nested stored-document and system
  fields the schema already declares, and Diary 0033's own priority list
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
  evidence is unambiguous that info severity fails (two shipped offenders
  in one seven-app rerun). Raises fleet-wide evidence coverage.
- **Costs/risks.** Sequencing is the whole game: strictness *before* bulk
  relief (A/E, or C) raises the authoring tax on exactly the surface agents
  already dislike — "write the big block or be refused" would score worse
  in the next rerun. Convex ships the opposite default and agents liked it;
  Snapback's counter (an unvalidated inferred type is a claim, not a check)
  is only persuasive once declaring the contract is cheap. A per-app toggle
  risks becoming a fleet-wide off-switch unless paved templates default it
  on.
- **Constraint fit.** Clean; pure policy. The decision is the author's
  (0115 OQ3) — this document only notes the ordering dependency.

**Composition.** A, E, F, and G are mutually compatible and jointly cover
(a)–(d) without touching the authority model: A fixes inputs and adds
ingress evidence, E compresses result declarations, F types the interior and
catches mismatches at dev time, G then makes precision the default once it
is cheap. C is the bridge if, after A+E, transcription cost still dominates
the rerun's scoring. B is the terminal competitor-shaped move and would
require re-ratifying LLP 0108's core invariants; D is a low-cost complement
already near its structural ceiling.

## Findings

1. The type-flow gap decomposes into four separable mechanisms — return
   inference (a), structured inputs (b), omission policy (c), interior
   typing (d). CV-4 covers (b); CV-6 covers (c); nothing on 0115's status
   board covers (a) or (d).
2. The felt cost is per-boundary, not total: matrix authored size is tied
   (2,196 vs 2,176 lines) while the contract-closing deltas are large and
   local (Relay 148 → 224; Split 379 → 427 with acceptance). Options that
   compress the boundary (E) can win the felt comparison without changing
   totals much.
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
5. The degraded-result escape is a policy failure with working mechanism:
   the diagnostic ships with remediation at `severity: 'info'`
   (`packages/snapback-codegen/index.mjs:1955`), the provider-side warning
   fires only downstream (`provider-introspection.mjs:621`), and two of
   seven real arms shipped degraded contracts through it.
6. Explicit contracts hold four advantages inference cannot replicate:
   runtime egress enforcement with pre-commit rollback
   (`src/result_contract.rs:19`), replay identity bound to contract hashes,
   language-neutral projection (Swift, Contract, provider introspection),
   and a value vocabulary richer than inferred TS. Every option was scored
   on preserving these.
7. Full TS inference (B) is the only option that structurally conflicts
   with LLP 0108's invariants and 0115's no-evidence-regression
   constraint, and it makes contract identity a function of compiler
   version. Its viable derivative is infer-then-freeze (C), which keeps
   the frozen declaration authoritative but implicitly requires a TS/JSDoc
   authoring surface to infer from.
8. The interior-typing gap (d) is real and unowned: handler bodies are
   untyped `.mjs`, nothing types `ctx.db`, no dev-time check compares a
   handler's return against its declared contract, and codegen emits no
   handler-facing types (index.mjs:2428). A contract-checking (not
   contract-minting) TS integration is constraint-clean and unclaimed.

## Confidence

**Verified in code (this document, current main):** the closed primitive
map and its application points (index.mjs:3300, 3309, 681–682, 1242–1243);
the dead `resultOnly` flag (define.mjs:263, 276; no readers found
repo-wide); the separate result-contract lane (define.mjs:1711;
result-contracts.mjs:473); the info-severity degraded diagnostic
(index.mjs:1955–1956) and warning-severity provider degradation
(provider-introspection.mjs:621, 633); Rust egress validation, rollback
seam, and ceiling (src/result_contract.rs:15–44); absence of args ingress
validation in `src/`; `defineSearchQuery` authoring `query: v.json()`
(define.mjs:778); no handler-facing types in the emitted artifact list
(index.mjs:2428).

**Diary-reported (not independently re-run):** all Convex-arm behavior and
passes; the line-count figures (148 → 224, 379 → 427, 2,196 vs 2,176); the
`v.json()` hand-validation experience; the two degraded-contract offenders.
Diaries 0033/0036/0037/0039, plus Diary 0022 for the earlier
`unknown`-degradation record ("casts the API and normalizes unknown rows")
and Diary 0027 via 0036's recap.

**General background knowledge of Convex (not re-verified against current
releases):** the optional `returns:` validator; `Infer<typeof validator>`;
generated `dataModel` typing of `ctx.db`; typed `ctx.runQuery`/scheduler
references. Claims depending only on these are labeled as background above;
the load-bearing comparative claims are the diary-observed ones.

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
5. Does infer-then-freeze (C) require a first-class TS authoring lane, and
   if so, who owns TS-toolchain version pinning as part of contract
   custody?
6. Which severity actually changes agent behavior for CV-6 — warning,
   error, or refusal-behind-toggle — and does strictness-before-cheapness
   worsen the authoring score? The next matrix rerun measures both
   directly.

## Relationship to LLP 0115 and owning documents

LLP 0115 sequences; this document explores. Option A is 0115's CV-4a/4b and
stays owned there: the new Spec plus the dated LLP 0004 alignment own
arguments and stored fields, and nothing here respecifies them. Option G is
CV-6, an LLP 0108 amendment gated on 0115's open question 3; the ordering
dependency (strictness after cheapness) is this document's contribution to
that call. Options E and F are *not* on 0115's status board and are offered
as candidate additions — E as a natural rider on the CV-4-era grammar work,
F as a small unowned pilot. Options B and C are recorded as the honest
larger option space; adopting either would require amending LLP 0108's
invariants, which this Research document cannot and does not do. Helper
reuse — the other half of the authoring-bulk story — is LLP 0118's subject
(CV-7); reactive defaults are LLP 0119's (CV-11 and the watch item).
Retired gaps (search, colocation, exact recursive result contracts,
custody, pagination) are not re-litigated. No final call is made: LLP 0116
indexes the series, and later owned Specs and Decisions choose.
