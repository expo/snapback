# LLP 0118: Handler composition and helper reuse

**Type:** Research
**Status:** Review
**Systems:** Competitive evaluation, Developer experience, Authoring, Code
generation, Runtime, Security
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:**
**Related:** LLP 0108, LLP 0115, LLP 0116, LLP 0117, Diary 0022, Diary 0032,
Diary 0033, Diary 0036, Diary 0039

## Summary

Agents building the same seven applications on Convex and Snapback could share
ordinary TypeScript helpers between Convex functions, because Convex functions
live in ordinary ES modules with ordinary imports. Snapback's inline handlers
are deliberately narrowed to statically self-contained expressions — no
imported or sibling helper, no transitive source graph — so shared logic must
be duplicated into every handler that needs it. The Diary 0039 rerun scored
this as a real Convex authoring advantage: Streak Lab's civil-date
parser/inverse appears twice (query and mutation), and its authored volume
rose from 345 to 389 lines despite deleting a file; Relay Board duplicated its
indexed board reads between the view and summary queries.

This is the deep-comparison companion to LLP 0115's CV-7, which sequences the
work. It reconstructs both module models from primary evidence, verifies the
Snapback contract in code, recovers the history that makes "just allow
imports" a worse idea than it looks, and lays out seven option paths against
LLP 0115's no-evidence-regression constraint and LLP 0108's invariants. It
deliberately makes no final call; that belongs to the LLP 0108 follow-on.

## What Convex does

**General Convex background** (general knowledge, not re-verified against
current Convex documentation): Convex functions are exported values in
ordinary TypeScript modules under `convex/`. A helper is a plain function in
any file, imported with a normal `import`; Convex's own guidance encourages
exactly this — shared business logic in plain TS modules (the "model"
directory convention), thin exported query/mutation wrappers. At push time
the CLI bundles the `convex/` directory (esbuild-based closure over the
module graph) and deploys the bundle; argument and return types flow through
TypeScript inference across those same imports.

Convex is not unconstrained: its default runtime is a deterministic
V8-isolate environment where many Node built-ins are unavailable, and
escaping to the Node runtime takes an explicit `"use node"` directive. The
structural point is *where* each product draws its line: Convex restricts the
runtime capability surface but leaves the module graph open; Snapback
restricts both, and the DX delta the diaries measured concentrates almost
entirely in the module-graph half.

**What the diaries actually observed** (diary-reported, primary evidence):

- Diary 0039, §Where Convex is better → Input typing and helper composition:
  Convex "lets ordinary TypeScript helpers be shared … direct self-contained
  handlers trade registry wiring for helper duplication"; and P1 item 7:
  "Support safe helper reuse or bounded module bundling for inline handlers."
- Diary 0032 (Streak Lab): "Inline v1 requires the direct handler to be
  self-contained, so the civil-date parser/inverse must appear in both the
  query and mutation. The old separate module shared those helpers. The
  migration traded cross-file wiring for local duplication." Authored volume:
  345 lines / 11,636 bytes → 389 lines / 13,831 bytes, despite deleting
  `handlers.mjs`.
- Diary 0033 (Relay Board): "Inline colocation duplicated indexed board reads
  between view and summary. A documented safe helper/import pattern would help
  without restoring the old global registry." Authored backend: 148 → 224
  lines, partly result-contract verbosity, partly because "the guide's inline
  profile steered this app away from a shared sibling reader helper."
- Diary 0036 (Split Ledger): authored volume 379 → 427 lines; its headline
  pain is `v.json()` inputs, but colocation was explicitly "not a line-count
  reduction."

## What Snapback does today

### The self-containment contract (code-verified)

LLP 0108's round-3 reconciliation narrows inline v1 to "one authored function
or arrow-function expression whose complete AST is present in the
declaration's `handler` member," admitting only parameters, locals, allowed
syntax, and evaluator-supplied globals: "Inline v1 admits no imported or
sibling helper, class declaration or expression, … or transitive source
graph."

The shipped extractor (`packages/snapback-codegen/inline-handlers.mjs`)
implements exactly that:

- a closed `ALLOWED_GLOBALS` set (~32 standard built-ins); any other
  identifier not declared inside the handler expression refuses with
  `SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER` ("references identifiers outside
  its handler expression") — this is the refusal that forces duplication;
- forbidden-construct scanning: class syntax, `this`/`super`, dynamic import,
  `eval`/`Function`, and reflection property access (`constructor`/
  `prototype`/`__proto__` through direct, computed, aliased, and destructured
  paths) refuse with `SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN`; form
  violations refuse with `SNAPBACK_INLINE_HANDLER_DIRECT_LITERAL_REQUIRED`
  and `SNAPBACK_FUNCTION_HANDLER_FORM_INVALID`;
- the handler expression is replaced in the definition-evaluation graph with a
  strict-JSON marker (`sha256` over
  `snapback:inline-handler-marker:v1\n{name}\n{canonicalAst}`), so executable
  source never crosses the isolated evaluator's JSON boundary and is never
  reconstructed via `Function.prototype.toString()`;
- each admitted operation is emitted as its own runtime module registering a
  one-entry `globalThis.__snapbackHandlers` map.

Implementation identity (`packages/snapback-codegen/index.mjs`,
`snapback.function-implementation.v1`): the hash covers app, operation, kind,
`{form: 'inline', canonicalAst}`, args/result contract hashes, reads/writes,
auth, uses, and standard-pattern identity. **There is no dependency-graph
field** — the v1 hash format structurally assumes a handler has no
dependencies, which is why every sharing option below that changes executable
bytes is a v2 hash format, not an extractor tweak.

The runtime backstop is independent of the static closure: handlers execute in
the restricted no-eval VM (`ex_hermes_create_no_eval`, `src/runtime.rs`), and
the runtime probes constructor-walk escapes (`Object.constructor.constructor`,
`Reflect.apply(Function)`, `Reflect.construct(Function)`, the AsyncFunction
constructor) before application source evaluates.

One nuance the diaries do not surface: Snapback is already two-tier.
*Definition-time* modules (schema/functions files) go through a closed
literal-relative module-graph resolver — bare specifiers, dynamic import, and
CommonJS fail closed (`CODEGEN_AMBIGUOUS_IMPORT`,
`CODEGEN_DYNAMIC_IMPORT_UNHASHABLE`, `CODEGEN_COMMONJS_LOADER_UNHASHABLE`)
and every admitted file joins the attested identity. So validator-building
helpers can be shared across files today; only *handler executable* code
cannot. The admission-grade closed-graph machinery the bundling option needs
is not hypothetical — a sibling of it ships on the definitions side.

### Why it is this way

The self-containment rule is not a missing feature; it is the surviving core
of a reviewed design. LLP 0108's original "Bounded static bundling" section
specified handler imports in full — literal-relative-ESM-only resolution from
the canonical app root; bounds of 64 files, depth 16, 512 KiB source, 256 KiB
bundle; per-edge byte digests; a closed pure top-level-initializer grammar; a
capability rescan of final bundled bytes; and a group-bundle warm-pool model
with a DK-4 benchmark gate. The three-round super-refine loop ended with both
reviewer families at NOT READY, and the author narrowed v1 to self-contained
expressions to avoid implementing reviewed-but-unclosed mechanisms. The design
was demoted for review-loop timeout, not refuted — 0108's own 2026-07-30 note
designates it "the blueprint for the follow-on."

The properties the narrowing protects are the invariants any option must
keep: a closed, content-addressed executable graph (a reviewer reading the
authored declaration sees everything that executes); no
`Function.prototype.toString()` capture; no runtime inference of authority
from handler behavior; no ambient checkout access from the executable path.

### The legacy registry it replaced, and what the history teaches

Before inline v1, operations were declared in `functions.mjs` with
`source: "handlers.mjs"` / `exportName` wiring into a separate handler module.
Diary 0022 recorded the cost: "Declaring operations in `functions.mjs` and
implementing them in `handlers.mjs` duplicated names, source/export wiring,
and navigation."

Two facts about that model matter for the option space. First, it *did* share
helpers: all handlers lived in one module, so a top-level helper was visible
to every export — Diary 0032's "the old separate module shared those helpers."
Second, it was **never** an open-import model: LLP 0010 pins handler modules
to "a closed single-file runtime profile: imports are rejected before
emission, so their complete permitted graph is the declared handler source
itself."

So Snapback has never had Convex's ordinary-module model. The unit of sharing
went from *one file per app* (helpers shared, wiring and names duplicated) to
*one expression per operation* (wiring gone, helpers duplicated). Diary
0022's complaints were about registry wiring and navigation, not the closed
graph. "Just allow imports" is therefore not a return to anything Snapback
ever shipped; it would be a new, weaker contract.

## How they differ, and why agents preferred Convex

The measured gap is modest in lines and larger in feel. Authored volume across
the whole matrix is effectively tied (Diary 0039: Snapback 2,196 lines vs
Convex 2,176), and the per-app increases are confounded — exact result
contracts account for much of Relay Board's 148 → 224 growth. But the
duplication instances are unambiguous and named: a nontrivial civil-date
parser *and its inverse* maintained twice in Streak Lab; indexed board reads
maintained twice in Relay Board.

The deeper cost is not volume but drift risk. A calendar parser and its
inverse must agree exactly between the query that renders streaks and the
mutation that validates check-ins; a fix applied to one copy is a silent
correctness bug with no diagnostic, because the two copies are independent
ASTs with independent implementation hashes — nothing in the system knows
they are meant to be the same function. And the seven matrix apps are small;
helper pressure grows with app size, so the measured gap is a floor.

There is also an asymmetry of visible virtue. Convex's openness is felt
immediately (write the helper once, import it, types flow); Snapback's
closure pays off in properties agents only notice when asked — Diary 0039
credits them under "evidence and fail-closed boundaries" while still scoring
authoring for Convex. Both scores are right; they measure different layers,
and the option space below is about whether Snapback can buy the first
without selling the second.

## Option space

Every option is evaluated against LLP 0115's governing constraint 1 ("a work
item that improves ergonomics by weakening an evidence boundary is out of
scope") and LLP 0108's invariants (closed content-addressed graph, no
`toString()` capture, no runtime inference, no ambient checkout access).

### 1. Revive 0108's bounded static bundling (CV-7's designated lead)

Implement the superseded section as specified: literal-relative-ESM-only
resolution from the canonical app root, the 64-file / depth-16 / 512-KiB /
256-KiB bounds, per-edge byte digests, the closed pure-initializer grammar for
retained top-level constructs, capability rescan of final bundled bytes, and
the marker-based three-graph transform.

*Benefits.* Full generality — any app-specific helper is shareable in ordinary
ESM syntax, which is the idiom Convex-trained agents already reach for. The
invariants survive by construction: the graph stays closed and
content-addressed per edge, admission stays static, and the definitions-side
resolver proves the admission machinery is buildable here. The design is
unusually mature for an unstarted item; most of the specification work is
done.

*Costs.* (a) A v2 implementation-hash format: the v1 hash carries no
dependency graph (code-verified above), so the encoding, golden vectors, and
every consumer of implementation identity change. (b) The group-bundle model:
0108 specifies one bundle — and one warm-pool key — per original static graph
to preserve LLP 0009's four-VM bound, which means one helper edit invalidates
the implementation identity of *every* co-resident operation, with churn
consequences for review manifests and any expected-operation-style consumer.
(c) The DK-4 benchmark gate (warm reuse and memory at 1/4/16/64-operation
graphs) must pass before advertisement. (d) Every 2026-07-28
adversarial-closure refusal — alias, destructuring, computed access — must be
re-proved across module boundaries, where a helper file can now launder what a
single expression could not (`export const c = obj.constructor`).

*Risks.* The review loop already failed to converge on this once; the
three-graph transform is the most intricate machinery in the codegen path. An
execution-shape question worth deciding early: the spec's group-bundle model
is not the only way to keep the pool bounded. A *resolve-and-splice* variant
would resolve the same closed graph, then inline the admitted helper bytes
into per-operation self-contained runtime modules — keeping the shipped
one-module-per-operation runtime and warm-pool model untouched, giving precise
per-operation invalidation (only operations that actually reach the changed
helper re-hash), at the cost of duplicated bytes in generated artifacts. That
trade moves duplication from the authored tier to the generated tier, which is
exactly where LLP 0115's constraint 4 says volume is acceptable. It reopens
0108's warm-pool-key question in the opposite direction from the group-bundle
answer, so the follow-on must choose deliberately.

### 2. Declared shared-helper cells

Make helpers first-class declared artifacts rather than imports: something
like `export const calendar = defineHelper({handler: (…) => …})`, validated
under the same self-containment and adversarial rules as handlers, referenced
by handlers through an explicit `uses: [calendar]`-style declaration, and
spliced (or injected as a lexical binding) into each consuming operation's
runtime module by codegen.

*Benefits.* Sharing without any module-graph opening — the resolver never
runs, and no filesystem semantics enter identity. Each helper is its own
content-addressed artifact; the v2 hash extension is a short list of named
helper hashes instead of a path-carrying graph encoding, which is arguably a
*cleaner* identity model than option 1's. Invalidation is exact. The
declaration is inspectable evidence: a reviewer sees which operations share
which logic, which no import graph states directly.

*Costs.* It is a proprietary composition primitive at the precise moment the
parity program is about reducing proprietary surprise; Convex-trained agents
will type `import` first and hit a refusal that must teach the alternative.
Helper-to-helper references need a rule (a shallow explicit DAG, or flat-only
to start). TypeScript flow from helper signature into handler inference (LLP
0117's territory) needs real design. The authoring surface of LLP 0004 grows.

*Risks.* Moderate mechanism, novel idiom. If the guide teaches it well it may
be enough — the diaries show agents adopting `outgrewIr` and result contracts
without complaint once documented — but it competes with muscle memory.

### 3. Build-step bundling (closure capture / stock bundler at codegen time)

Let definition evaluation produce handler values and capture them, or run a
stock bundler (esbuild) over the authored module and take its output —
Convex's actual mechanism.

*Analysis.* The capture variant is a direct invariant violation: serializing
an evaluated function value *is* `Function.prototype.toString()` authority,
which 0108 forbids in its opening summary. The stock-bundler variant avoids
`toString` (it is source-level) but fails the closed-graph invariant a
different way: resolution semantics belong to the bundler, not to Snapback's
admission rules — bare specifiers, `node_modules`, conditional exports, and
tree-shaking heuristics all decide what executes, and digesting whatever the
bundler happened to read is post-hoc attestation, not admission. Refusals
degrade from authored source spans to positions in a transformed bundle, and
the bundler's own version becomes load-bearing identity.

*Verdict as research.* This is what option 1 is the disciplined version of:
Snapback-owned resolution with admission-grade rules versus delegated
resolution with evidence bolted on after. It clarifies why CV-7 points at the
former. Not viable under the invariants as stated.

### 4. Open module imports, Convex-style

Adopt the ordinary-module model wholesale: handlers import anything the
filesystem and `node_modules` provide; evidence moves to a digest of the final
bundle plus a capability rescan of final bundled bytes, with the no-eval VM
and runtime constructor-walk probes as the backstop.

*Benefits.* Maximum familiarity; the entire diary complaint disappears,
including for third-party pure libraries (date math, decimal arithmetic) that
options 1 and 2 still exclude. Honestly stated, the runtime boundary already
does much of the *security* work — the no-eval VM, denied globals, and probes
run regardless of how the bytes were assembled — and a final-bundle
capability rescan is a real, if blunt, admission gate.

*Costs.* What the static closure uniquely provides is not primarily runtime
security; it is evidence. An open graph discards reviewability (the authored
file no longer bounds what executes), bounded artifact size, deterministic
regeneration (local `node_modules` state joins executable identity, so
unchanged source no longer regenerates byte-identically across machines), and
the supply-chain boundary (a package update silently changes executable
authority with no per-edge attestation). Refusals lose span precision.

*Verdict as research.* This is the clearest candidate violation of LLP 0115's
no-evidence-regression constraint — the ergonomic gain is real and the
evidence loss is structural. The rescan-of-final-bundle model recovers a
capability floor but not the identity, review, or supply-chain properties. If
ever revisited, it should be an explicitly weaker opt-in profile with its own
capability id and nonclaims, not a change to the default contract.

### 5. Duplication as the paved answer, plus drift tooling

Accept self-containment permanently; invest in making duplication safe rather
than eliminating it. Codegen already computes a canonical AST per handler; a
subtree-hashing pass could detect identical (and near-identical) function
declarations across a backend's handlers and emit a diagnostic naming the
copies — turning silent drift, the real hazard, into a visible one. The guide
would document the copy-and-mark pattern.

*Benefits.* Zero invariant risk, zero new runtime or identity mechanism, small
and immediately landable; directly targets the correctness hazard this
document identifies as worse than the volume cost.

*Costs.* It concedes the DX point entirely — authoring still writes the helper
twice, and the diaries' comparison score does not move. Legitimately divergent
copies generate noise. And the CV-6 evidence is discouraging about advisory
diagnostics: an info-severity diagnostic with a good remediation demonstrably
failed to change behavior in two real apps.

*Interaction with 0115.* Fully compatible with the constraints, but likely
fails the plan: CV-7's exit criterion is "Streak Lab's calendar helper written
once and used by both its query and mutation," which this option cannot meet.
Its honest role is as the *interim* posture while a real option lands, and as
a permanent complement (drift detection remains useful even with sharing).

### 6. Macro/template expansion at authoring time

Restore single-source-of-truth above the artifact model: helpers live in a
template the author edits, and an expansion step (a codegen pre-pass or CLI
`expand` command) splices them textually into each handler before extraction.
The extractor, hash format, runtime, and warm pool never change.

*Benefits.* The entire 0108 machinery is untouched: no v2 hash, no benchmark
gate, no adversarial re-proof — each expanded handler is scanned as today.

*Costs.* It builds a shadow source-of-truth. Either the expansion is committed
(reviewers see the duplication anyway, and an agent editing the expansion
instead of the template silently reintroduces drift — worse than today,
because the tooling implies it cannot happen) or the template is committed
(then the authored file codegen reads is generated, inverting custody and
complicating source spans in every diagnostic). It relocates the problem
rather than solving it.

### 7. A pinned Snapback standard library of pure helpers

Grow the superseded design's "closed Snapback-owned pure-helper allowlist"
into a small versioned stdlib available inside handler expressions as ambient
admitted identifiers: civil-date/calendar arithmetic, integer-cents money
math, pagination-assembly shapes — precisely the categories the matrix
duplicated. Source and version pinned in the extractor artifact and joined to
implementation identity.

*Benefits.* For the most commonly duplicated logic, the duplication count goes
to zero without opening any graph — Streak Lab's civil-date parser is exactly
a stdlib candidate. The purity/pinning story is already specified. It
compounds with any other option.

*Costs.* Helps only generic logic; Relay Board's board reads are app-specific
and remain duplicated. Scope creep is real (a stdlib is a product surface with
its own compatibility burden), and "Snapback has a date library" is a strange
first answer to "why can't I share my function."

*Interaction.* Not a competitor to options 1/2 but a complement: it shrinks
the set of helpers that need the heavier mechanism, and its pinning model is a
rehearsal for option 2's helper-cell identity.

## Findings

1. The duplication is a designed consequence of a deliberate narrowing, not an
   oversight: LLP 0108's round-3 reconciliation cut a fully drafted bundling
   design after a timed-out review loop, and 0108 itself designates that
   superseded section the blueprint for the fix.
2. Snapback has never had open handler imports. The legacy model was a closed
   single file (LLP 0010: "imports are rejected before emission"); sharing was
   intra-file. The migration shrank the sharing unit from one file per app to
   one expression per operation, and Diary 0022's complaints targeted registry
   wiring and navigation, not the closed graph — so neither "revert" nor
   "open imports" follows from the history.
3. Snapback is already two-tier: definition-time modules resolve through a
   shipped closed literal-relative graph resolver with attested identity,
   while handler executable code admits no graph at all. The admission
   machinery option 1 needs has a working sibling in the same codebase.
4. Code-verified: the v1 implementation hash contains no dependency-graph
   field (`{form: 'inline', canonicalAst}` only). Any sharing mechanism that
   changes executable bytes is therefore a v2 hash format; option 1
   (path-carrying graph encoding) and option 2 (explicit named helper-hash
   edges) imply materially different v2 shapes.
5. The authored-volume evidence is real but confounded (Streak Lab 345→389,
   Relay Board 148→224, Split Ledger 379→427, with verbose exact result
   contracts contributing alongside duplication), and the deeper cost is
   drift, not lines: duplicated copies share no identity, so divergence is a
   silent correctness bug no diagnostic can see.
6. The runtime security backstop (no-eval VM, denied globals, constructor-walk
   probes) is independent of the static closure. The closure's distinctive
   contributions are evidence-tier — reviewability, bounded deterministic
   identity, refusal precision, the supply-chain boundary — which is why
   option 4 is an evidence regression even where arguably security-adequate.
7. Option 1's headline hidden cost is group-bundle coupling: one warm-pool key
   and one implementation-identity blast radius per source graph. A
   resolve-and-splice execution shape avoids both by moving duplication into
   generated artifacts — the tier where LLP 0115 explicitly tolerates volume —
   at the cost of departing from the spec's group-bundle text.
8. Options 5 (drift tooling) and 7 (pinned stdlib) are cheap complements that
   neither meet CV-7's exit alone nor conflict with anything; option 3 is
   research-useful mainly as the undisciplined shadow of option 1; option 6
   relocates the problem rather than solving it.
9. Attribution note: LLP 0115 CV-7 and LLP 0108's field-evidence section name
   "Campfire's indexed-read helpers," but Diary 0034 (Campfire) records no
   helper duplication; the primary-source instance is Relay Board (Diary
   0033). Cosmetic for CV-7's argument, but it should ride its next revision.

## Confidence

**Code-verified** (read in this repository at authoring time): the extractor's
closed globals set, free-identifier and forbidden-syntax refusals, marker
replacement, per-operation runtime module registration
(`packages/snapback-codegen/inline-handlers.mjs`); the dependency-graph-free
v1 implementation hash (`packages/snapback-codegen/index.mjs`); the
definitions-side closed module-graph resolver and its refusal codes; the
no-eval VM constructor and runtime constructor-walk probes
(`src/runtime.rs`); LLP 0010's single-file legacy handler profile.

**Diary-reported** (primary observational evidence, not independently rerun):
all line/byte counts, the specific duplication instances, the comparative
scoring, and every quoted agent judgment (Diaries 0022, 0032, 0033, 0036,
0039).

**General knowledge** (not re-verified against current Convex releases):
Convex's esbuild-based push bundling, the model-directory helper convention,
type inference across imports, and the default-isolate/`"use node"` runtime
split. Directionally load-bearing for §What Convex does; any follow-on that
depends on a specific Convex mechanism should re-verify it.

## Open questions

1. **Group-bundle or resolve-and-splice?** 0108's superseded text specifies
   one bundle per source graph; splicing per operation preserves the shipped
   runtime and pool model with precise invalidation but duplicates bytes in
   generated artifacts and departs from the reviewed text. This is the first
   design decision the follow-on must make, and it determines the v2 hash
   shape.
2. **Who is the composition surface for?** If the durable audience is agents
   with a guide in context, option 2's novel idiom may cost little; if human
   Convex refugees matter, ordinary `import` syntax (option 1) is worth its
   mechanism. The answer shifts the option ranking.
3. **How does helper typing flow?** Sharing without TypeScript inference
   across the shared boundary recovers only half the Convex advantage; the
   interaction belongs to LLP 0117's type-flow analysis and should be designed
   jointly.
4. **Does the stdlib (option 7) precede or follow the general mechanism?** It
   is independently landable and removes the most-cited duplication instance
   (civil-date logic), which would change the urgency evidence under CV-7
   before the heavy mechanism starts.
5. **What does drift detection owe the interim?** If CV-7 is quarters away, a
   duplicate-subtree diagnostic (option 5) may be worth landing now — but
   CV-6's evidence says advisory severity will not change behavior, and the
   severity decision is already open as LLP 0115 OQ3.

## Relationship to LLP 0115 and owning documents

LLP 0115's CV-7 sequences this work (Tranche C, size L) and already commits to
option 1's frame — "revive and close those sections as the 0108 follow-on
rather than designing from scratch" — with the exit criterion of Streak Lab's
calendar helper written once. This document supports that lead while recording
that the group-bundle execution shape is not forced by the invariants, that
options 2 and 7 are viable complements or fallbacks with cleaner identity
stories, and that options 5/7 have value regardless of the main mechanism.
The normative owner remains LLP 0108: substantive design lands there (or in
its named follow-on Spec), not here. The final call — including whether CV-7's
L-size mechanism precedes or follows the cheaper complements — is the
author's, and this document deliberately does not make it.

This is document three of the Convex-parity research series:

| LLP | Topic |
| --- | --- |
| 0116 | Convex-parity research series (overview) |
| 0117 | TypeScript type flow parity |
| 0118 | Handler composition and helper reuse (this document) |
| 0119 | Reactive-by-default and live search |
| 0120 | Relational composition and aggregation |
| 0121 | Transactional one-off scheduling |
| 0122 | Installed-product coherence and packaging |
| 0123 | Runtime readiness and operational edges |
| 0124 | Product breadth: storage and vector search |
| 0125 | Concurrency and conflict ergonomics |
