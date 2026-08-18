# LLP 0118: Handler composition and helper reuse

**Type:** Research
**Status:** Active
**Systems:** Competitive evaluation, Developer experience, Authoring, Code
generation, Runtime, Security
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:** 2026-08-02 (decision-sitting propagation: OQ7 is answered — the
first mechanism admits context-reader helpers, while declared reads/writes
remain evidence rather than enforced ceilings; source:
`issues/20260802-author-decision-packet.md`). 2026-07-31 (v0.6, OQ1 answered with benchmark receipts — the
same-file splice mechanism landed at `4d72c407` (normative text: LLP 0108
§Same-file helper sharing), and the respecified benchmark ran twice on the
real fresh-per-invocation runtime path (`helper_splice`, `crates/snapback/src/bench.rs`)
against LLP 0035's fresh-invocation metric: splice duplication is
+0.5–3.1% p50 per invocation with cross-run rank inversion (noise-level)
and retains no per-invocation memory; the dated answer with the table
lives under open question 1, and finding 7 carries the measured pointer
plus 0108's completed absorption.)
2026-07-30 (v0.5, round-4 delta review corrections — Codex
NOT READY: one blocking and one detail item, both inside the v0.4-changed
sentences; Fable READY since round 2. Round-4 artifact:
`reviews/0118-handler-composition-and-helper-reuse.codex.md`. Blocking:
v0.4 still let "pure in effect" attach to deterministic-tier consumers;
the doc now claims exactly two established properties —
context-capability-freedom (statically provable over the closed graph)
and ambient-nondeterminism denial (deterministic tier only,
runtime-enforced) — and names side-effect-freedom (no mutation of
arguments, captured bindings, or module-level state) as a third, distinct
property needing its own analysis, e.g. a mutation-effect scan over the
closed graph, before any purity label; the axis, Finding 11, open
question 7, and §Confidence carry it. Detail: the ambient-clock
accounting now includes bare `Date()` — codegen's static refusals cover
`Math.random()`, `Date.now()`, and any-arity `new Date(...)` only, while
the deterministic runtime's wrapped `Date` constructor denies bare
`Date()` invocation and zero-arg `new Date()`
(`DATE_CONSTRUCTOR_DENY_SOURCE`, `crates/snapback/src/runtime.rs`), aliases falling
through to that boundary by design; actions retain both.)
2026-07-30 (v0.4, round-3 delta review correction — Codex NOT
READY on one fresh blocking item, the round-2 blocking and detail items
otherwise resolved; Fable READY since round 2. Round-3 artifact:
`reviews/0118-handler-composition-and-helper-reuse.codex.md`. The one fix:
the v0.3 "flow-pure" lane rooted its taint analysis solely in
context-derived capabilities, which cannot prove semantic purity — `Date`
and `Math` are admitted globals, and the action tier deliberately retains
their ambient clock/entropy members at runtime
(`ambient_restriction_source`, `crates/snapback/src/runtime.rs`: the deterministic tier
denies `Date.now`/`Math.random`/zero-arg `new Date()`, actions keep the
ambient-powered surface; codegen's static refusal covers direct spellings
only, aliases falling through to that tiered boundary by design). The
lane is renamed **context-capability-free** — the property the closed
graph can prove statically — with semantic purity stated as an
additional, runtime-profile-dependent question; Finding 11, open question
7, and §Confidence carry the propagation.)
2026-07-30 (v0.3, round-2 delta review corrections — Fable
READY, two phrasing details; Codex NOT READY, one blocking concern in the
v0.2-added helper-class axis with all round-1 concerns resolved or
substantially advanced. Round-2 deltas in
`reviews/0118-handler-composition-and-helper-reuse.fable.md` and
`reviews/0118-handler-composition-and-helper-reuse.codex.md`; 4 items
applied, all re-verified against the tree. Codex blocking: the
helper-class safety analysis redone on verified enforcement ground — the
pure lane redefined by capability flow rather than signature shape (a
no-`ctx`-parameter test admits `helper(ctx.db)`, destructured members,
bound methods, and module-scope stores), with what conservative taint
admission can and cannot prove under 0108's closed graph stated; the
caller-ceiling lane's "exactly as inline code is today" was wrong —
code-verified, opaque-handler enforcement is keyed to the invocation's
runtime kind and `uses` grant at the host boundary while declared
reads/writes are unenforced evidence (declared-basis ceilings in
`effect-ceiling.mjs`, `validate_effect_ceiling` returning without
checking non-HostPlan runtimes in `crates/snapback/src/manifest.rs`, no declared-table
comparison in the `db.*` dispatch in `crates/snapback/src/runtime.rs`) — so table-level
caller ceilings are recosted as a new mechanism and the axis extended to
mutation, action/egress, and aliased-capability helper classes; Finding
11, open question 7, and §Confidence carry the correction. Codex detail:
the hermetic-package analysis now distinguishes package-artifact
integrity from resolved-edge/per-file attestation. Fable details:
Finding 10 corrected — Relay Board's backend is two authored files whose
duplicated queries share one `functions.mjs`, not "one schema/functions
file"; the axis no longer says the shipped duplication "receives" the
runtime context — as shipped it is inline code using it, and only the
factored form would receive it.)
2026-07-30 (v0.2, round-1 dual-family review corrections —
reviews in `reviews/0118-handler-composition-and-helper-reuse.fable.md` and
`reviews/0118-handler-composition-and-helper-reuse.codex.md`, both NOT
READY; ten distinct concerns, all verified against the tree and applied,
none refuted. Load-bearing: option 1's costs/risks, Finding 7, and open
question 1 redone under the shipped VM lifecycle — LLP 0009 retired DK-4
warm reuse on 2026-07-27 and `crates/snapback/src/warm_vm.rs` ships a no-op pool, so the
group-bundle trade is re-analyzed for fresh-per-invocation and for the
conditional return of pooling; option 1a (same-file lexical helper closure)
added as a staged slice — both motivating instances are same-file, so it can
meet CV-7's exit alone; option 3 recast along admission-policy versus
bundler-implementation axes with the definitions-resolver description
corrected (esbuild-hosted fail-closed plugins, relative/`file:`/absolute
specifiers, a two-entry Snapback-owned bare-specifier allowlist); option 4
gains a hermetic lockfile-pinned package-closure variant as analysis; a
pure-versus-capability-bearing helper-class axis added with the
authority-expansion lane named; the CV-8/LLP 0120 dissolution parallel and
the sub-operation-composition scope boundary added; the helper-pressure
floor, "small and immediately landable," and "no diagnostic can see" claims
reclassified as hypotheses or narrowed; Finding 9 refreshed — LLP 0115 v0.4
already absorbed the Relay re-attribution, only LLP 0108 still owes it;
Convex third-party and agent-behavior claims provenance-labeled. Reviewer
suggestions applied where verified: exact 31-global count, Diary 0022 slug
disambiguation, concrete marker shape. Not applied: the optional
comparison-table suggestion, to keep the prose option analyses primary.)
**Related:** LLP 0009, LLP 0108, LLP 0115, LLP 0116, LLP 0117, LLP 0120,
Diary 0022, Diary 0032, Diary 0033, Diary 0036, Diary 0039

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
imports" a worse idea than it looks, and lays out eight option paths against
LLP 0115's no-evidence-regression constraint, LLP 0108's invariants, and —
as of v0.2 — the VM lifecycle that actually ships (LLP 0009 retired warm-VM
reuse on 2026-07-27; every invocation evaluates its handler module fresh,
which re-prices every bundling shape). It deliberately makes no final call;
that belongs to the LLP 0108 follow-on.

## What Convex does

**General Convex background** (general knowledge, not re-verified against
current Convex documentation): Convex functions are exported values in
ordinary TypeScript modules under `convex/`. A helper is a plain function in
any file, imported with a normal `import`; Convex's own guidance encourages
exactly this — shared business logic in plain TS modules (the "model"
directory convention), thin exported query/mutation wrappers. At push time
the CLI bundles the `convex/` directory (esbuild-based closure over the
module graph) and deploys the bundle; argument and return types flow through
TypeScript inference across those same imports. Convex also exposes a second,
function-level composition surface — calling one registered function from
another (the `ctx.runQuery`/`ctx.runMutation` family) and packaged components
— which is a different mechanism from helper imports; this document covers
helper-level code sharing only and scopes operation-level composition out to
LLP 0120 (see §Cross-front interactions below).

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

- a closed `ALLOWED_GLOBALS` set (31 standard built-ins); any other
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
  strict-JSON marker — concretely
  `({__snapbackInlineHandlerMarker:"<sha256>"})`, the hash taken over
  `snapback:inline-handler-marker:v1\n{name}\n{canonicalAst}` — so executable
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
the restricted no-eval VM (`ex_hermes_create_no_eval`, `crates/snapback/src/runtime.rs`), and
the runtime probes constructor-walk escapes (`Object.constructor.constructor`,
`Reflect.apply(Function)`, `Reflect.construct(Function)`, the AsyncFunction
constructor) before application source evaluates.

The VM lifecycle those handlers run under is load-bearing for the option
analysis below, and it changed three days before this document was first
authored: LLP 0009 retired DK-4 warm-VM reuse on 2026-07-27 because current
upstream Ibex binds evaluation, async-failure inspection, value release, and
destruction to the creating OS thread while Snapback's blocking workers may
change threads between invocations. `crates/snapback/src/warm_vm.rs` now ships `WarmVmPool`
as an explicit no-op (`enabled()` returns `false`), the capability manifest
reports `vmLifecycle: "fresh-per-invocation"` (`crates/snapback/src/manifest.rs`; the old
`warm-pooled-reset` survives only as a recognized historical string), and the
former four-VM pool bound lives in 0009's section marked "Historical /
retired 2026-07-27." The hosted posture was always fresh per invocation, and
the workerd conformance lane runs a fresh workerd process per invocation
(LLP 0048), so no current execution profile retains warm module reuse.
Reintroducing reuse is conditioned in 0009 on stable runtime-owner threads or
a new upstream transfer contract. Every invocation therefore re-creates its
VM and re-evaluates its handler module from source — per LLP 0035's
decomposition, evaluation is roughly 45% of the ~3.9 ms fresh-invocation
cost — which makes *bytes evaluated per invocation* a first-class cost axis
for any bundling design.

One nuance the diaries do not surface: Snapback is already two-tier.
*Definition-time* modules (schema/functions files) go through a closed
module-graph resolver that is esbuild-*hosted*: Snapback's admission rules
run as fail-closed `onResolve`/`onLoad` plugins that seize every resolution
decision (`packages/snapback-codegen/index.mjs`). Admitted specifiers are
relative, `file:`, and absolute local paths; bare specifiers refuse
(`CODEGEN_AMBIGUOUS_IMPORT`) except for a two-entry Snapback-owned allowlist
(`DEFINITION_PACKAGE_IMPORTS`: `@snapback/codegen/define` and
`…/standard-patterns`, mapped to local files); dynamic import and CommonJS
fail closed (`CODEGEN_DYNAMIC_IMPORT_UNHASHABLE`,
`CODEGEN_COMMONJS_LOADER_UNHASHABLE`); and every admitted file joins the
attested identity. So validator-building helpers can be shared across files
today; only *handler executable* code cannot. Two consequences for the
option space: the admission-grade closed-graph machinery the bundling option
needs is not hypothetical — a sibling of it ships on the definitions side —
and that sibling already demonstrates that "Snapback-owned admission" and
"stock bundler as transform host" are compatible, which matters for option 3
below.

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
designates it "the blueprint for the follow-on." One of that blueprint's
load-bearing assumptions has since expired, however: its warm-pool model and
DK-4 benchmark gate target a VM lifecycle LLP 0009 retired on 2026-07-27
(see the lifecycle paragraph above). Both 0108's blueprint note and LLP
0115's CV-7 work text still speak in warm-pool terms and owe that absorption
on their next revisions; this document analyzes the options under the
lifecycle that actually ships.

The properties the narrowing protects are the invariants any option must
keep: a closed, content-addressed executable graph — for self-contained v1
that means a reviewer reading the authored declaration sees everything that
executes; the durable form any admitted-graph option must preserve is
complete, bounded, inspectable custody, where the reviewer follows an
enumerated graph rather than a single declaration; no
`Function.prototype.toString()` capture; no runtime inference of authority
from handler behavior; no ambient checkout access from the executable path.

### The legacy registry it replaced, and what the history teaches

Before inline v1, operations were declared in `functions.mjs` with
`source: "handlers.mjs"` / `exportName` wiring into a separate handler module.
Diary 0022 (`0022-backend-bakeoff.diary.md`; the diary number collides with
`0022-catalog-lens.diary.md`, so the slug matters) recorded the cost:
"Declaring operations in `functions.mjs` and implementing them in
`handlers.mjs` duplicated names, source/export wiring, and navigation."

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
correctness bug today, because the two copies are independent ASTs with
independent implementation hashes and the current identity model records no
intended equivalence between them. (A duplicate-detection diagnostic —
option 5 — is buildable precisely because the canonical ASTs exist; none
ships, so the drift is invisible *today*, not unseeable in principle.) And
the seven matrix apps are small; it is a plausible expectation — not a
diary-measured fact — that helper pressure grows with app size, which would
make the measured gap a floor. That scaling claim is an empirical question
(open question 6), not a finding.

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

**A cross-cutting axis: pure versus capability-bearing helpers.** The two
motivating instances are not the same semantic class. Streak Lab's civil-date
parser/inverse is pure value transformation — no context, no reads, no
effects. Relay Board's duplicated logic is an indexed board *reader*: as
shipped it is inline code inside each handler that uses the runtime context,
and only the factored shared-helper form would receive that context as a
parameter. Sharing a pure helper moves bytes; sharing a capability-exercising
helper moves authority-adjacent code between operations whose declared read
sets, write sets, and runtime kinds may differ — and Snapback's no-inference
invariant requires authority to keep deriving from each operation's
declaration, never from what a shared helper's body happens to do. That opens
a distinct risk lane: a helper admitted broadly could tempt a design where
the helper's behavior, not the consuming declaration, effectively defines
reach.

The v0.2 draft of this axis defined its safe formulations on unverified
ground; the round-2 review caught both errors, and this section now states
them on code-verified facts. First, the safe lane cannot be defined by
signature shape ("no `ctx` parameter admitted," as v0.2 had it). That is not
capability closure: `helper(ctx.db)`, `const {db} = ctx; helper(db)`, a
bound method (`ctx.db.query.bind(ctx.db)`), or a module-scope store the
helper later reads all deliver capability-bearing values to a helper whose
signature never names `ctx`. The lane must be defined by capability *flow*:
no value derived from the invocation context — the context object itself,
any member reached from it, any function bound to or closing over one —
reaches the helper through any channel (argument, closure, module-scope
state, or return value). The round-3 review then named what that property
is and is not: it is **context-capability-freedom**, the property the
closed graph can actually prove statically — not semantic purity, which
fails for two independent reasons: the taint-root completeness claim
holds only for context-derived authority (ambient nondeterminism is a
separate surface, below), and capability flow says nothing about side
effects (mutation of arguments, captured bindings, or module-level
state; below). On the context side 0108's closed-graph rules do make the
roots complete: host capabilities enter handler scope only through the handler's
context parameter, because the 31 admitted globals are standard built-ins
carrying no host authority and the free-identifier refusal bars naming
anything else (`globalThis` is not on the list, so even host-bridge
globals present in the VM are unreachable from admitted source), while the
existing refusals of `eval`/`Function`, dynamic import, and the
constructor/prototype reflection walks close every channel for minting
authority outside the analysis's view. But two of those admitted globals
carry ambient *nondeterminism*, and whether it functions is
runtime-profile-dependent (code-verified). The spelling accounting:
codegen statically refuses the direct spellings `Math.random()`
(`BUNDLE_UNSUPPORTED_RANDOM`) and `Date.now()`/any-arity `new Date(...)`
(`BUNDLE_UNSUPPORTED_TIME`) in every inline JS handler regardless of
kind, steering authors to `ctx.runtime.now()`/`ctx.runtime.id()` —
context capabilities a context-rooted gate does track; bare `Date()`
invocation has no static branch, and aliased spellings deliberately fall
through with it to the runtime boundary
(`scanUnsupportedHandlerSource`, `packages/snapback-codegen/index.mjs`).
At that boundary the deterministic tier (queries and mutations) denies
`Date.now`/`Math.random` — the allowlist's `bannedEverywhere.members` —
and installs a wrapped `Date` constructor that denies bare `Date()`
invocation at any arity and zero-arg `new Date()` while keeping
explicit-timestamp construction and the `Date.parse`/`Date.UTC` statics,
all with `SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED`
(`DATE_CONSTRUCTOR_DENY_SOURCE`/`ambient_restriction_source`,
`crates/snapback/src/runtime.rs`; the workerd strip denies the same surface on the V8
leg), while actions keep the ambient-powered, nondeterministic surface by
design — the denial block is guarded on non-action mode. A
context-capability-free helper that reaches an aliased clock or entropy
read therefore refuses at runtime under deterministic-tier consumers but
runs under action consumers. What this establishes is exactly two
properties: context-capability-freedom (statically provable over the
closed graph) and, for deterministic-tier consumers only,
runtime-enforced denial of ambient nondeterminism. Neither rules out
side effects — a helper can satisfy both and still mutate its arguments,
captured bindings, or module-level state — so side-effect-freedom is a
third, distinct property, and no "pure" label is warranted in any
profile without its own effect analysis (for example a mutation-effect
scan over the closed graph) or an explicit decision to accept
benign-mutation semantics. A follow-on that wants even the
nondeterminism half for action consumers must add the ambient roots
(`Date`, `Math`) to the taint set; absent that it claims
context-capability-freedom only. A conservative dataflow
analysis over admitted source can soundly over-approximate context
derivation. What it cannot deliver cheaply is precision: aliasing, heap
stores, and higher-order flow force coarse refusals, so a sound
context-capability-freedom gate looks like coarse taint — refuse any
helper call reachable by a context-derived value and any module-scope
store of one — and will refuse some genuinely capability-free calls. That
is a real analysis to design and prove, not a reuse of the extractor's
free-identifier test. The fresh-per-invocation lifecycle bounds
module-state laundering to a single invocation (module state dies with the
VM) but does nothing for intra-invocation flows, which are the actual
question.

Second, v0.2's caller-ceiling lane claimed a helper's runtime accesses
would be "checked against each consumer's declared reads/writes exactly as
inline code is today." Inline code is not checked that way today; the tree
contradicts the premise. What ships for opaque (JS/Ibex) handlers,
code-verified: host-call enforcement is keyed to the *invocation's* runtime
kind and grants, never to code origin or declared tables — query
invocations refuse `ctx.db` writes (`SNAPBACK_HANDLER_WRITE_IN_QUERY`),
action invocations refuse `ctx.db` reads and writes entirely and route
external effects through the action host's lifecycle validation,
fetch-stream operations refuse outside action mode
(`SNAPBACK_ACTION_CONTEXT_UNAVAILABLE`), protected queries classify every
host input against a closed allowlist, and configuration access outside the
invocation's host-computed `uses` grant refuses
(`SNAPBACK_CONFIG_UNDECLARED`). Declared reads and writes, by contrast, are
evidence without a runtime ceiling: the effect-ceiling pipeline gives
opaque handlers `basis: 'declared'` — author declarations restated,
expressly without static proof
(`packages/snapback-codegen/effect-ceiling.mjs`); load-time ceiling
validation returns without checking non-HostPlan runtimes
(`validate_effect_ceiling`, `crates/snapback/src/manifest.rs`); and the dispatcher parses
the handler-supplied query plan and executes it — capturing OCC read
dependencies — without comparing the plan's table, or the targets of
`db.insert`/`db.patch`/`db.delete`, against the operation's declared read
and write sets (`handle_host_call`, `crates/snapback/src/runtime.rs`). Two consequences
follow. Kind- and grant-scoped sharing has a shipped backstop: because
enforcement keys on the invocation, a shared helper inherits its
*consumer's* boundaries automatically — a write inside a helper invoked
from a query refuses, egress inside a helper invoked from anything but an
action refuses, and a helper cannot carry its own `uses` grant. But
table-level caller ceilings have no shipped form: binding helper (or any
handler) reads and writes to the consumer's declared tables would be a
*new* enforcement mechanism — a declared-table check at the `db.*`
host-call boundary, or a static table proof over admitted handler source,
which the ceiling pipeline today claims only for closed HostPlans — and
introducing it would change behavior for the entire existing opaque-handler
tier, whose inline code can currently read and write outside its
declarations without refusal. The follow-on must price that as new work
with a migration story, not inherit it as a property.

The helper classes the follow-on must decide among, restated on that
ground: context-capability-free helpers (capability closure by
conservative taint admission, as above — ambient nondeterminism denied
under deterministic-tier consumers, retained under action consumers, and
side-effect-freedom established for neither, so no class-level purity
claim); context-reader
helpers (query-kind reads — Relay Board's factored form); mutation helpers
(buffered writes — the kind backstop already refuses them in query
consumers, and table-level containment would be the new mechanism); and
action/egress helpers (external effects and `uses`-granted configuration —
mode-gated today, with grants computed per invocation, so a helper cannot
smuggle its own). Aliased capability arguments are the cross-class hazard
the flow definition exists to catch: every class except
context-capability-free admits them by construction, which is precisely
why authority must keep deriving from the consumer's declaration rather
than the helper's body. Each option below must state which class it
admits; option 7 is pure-only by curation (Snapback authors and reviews
its source), and options 1, 1a, and 2 must choose. Which classes the first
follow-on should admit — and whether declared reads/writes remain evidence
or become an enforced ceiling — is open question 7. Note the asymmetry of
the evidence: satisfying *both* diary instances requires admitting at
least context-reader helpers, while a context-capability-free-only lane
satisfies Streak Lab alone.

### 1. Revive 0108's bounded static bundling (CV-7's designated lead)

Implement the superseded section as specified: literal-relative-ESM-only
resolution from the canonical app root, the 64-file / depth-16 / 512-KiB /
256-KiB bounds, per-edge byte digests, the closed pure-initializer grammar for
retained top-level constructs, capability rescan of final bundled bytes, and
the marker-based three-graph transform.

*Benefits.* Full generality — any app-specific helper is shareable in ordinary
ESM syntax, the idiom Convex-trained agents can be expected to reach for (an
expectation from training distribution; the diaries show agents asking for "a
documented safe helper/import pattern," not which syntax they would try
first). As specified, the invariants are preserved by design — the graph
stays closed and content-addressed per edge and admission stays static — but
the review loop that would have confirmed the construction closed ended dual
NOT READY, so "preserved by design" is the specification's intent, not a
confirmed property. The definitions-side resolver proves the admission
machinery is buildable here, and the design is unusually mature for an
unstarted item; most of the specification work is done.

*Costs.* (a) A v2 implementation-hash format: the v1 hash carries no
dependency graph (code-verified above), so the encoding, golden vectors, and
every consumer of implementation identity change. (b) The group-bundle model,
if kept as specified: 0108 specifies one bundle — and one warm-pool key —
per original static graph to preserve LLP 0009's four-VM pool bound, but
both the pool and its bound were retired with DK-4 on 2026-07-27, so the
model's original rationale is currently vacuous while its costs remain.
The identity cost stands regardless of lifecycle: one helper edit invalidates
the implementation identity of *every* co-resident operation, with churn
consequences for review manifests and any expected-operation-style consumer.
And under the shipped fresh-per-invocation lifecycle the group bundle
acquires a cost 0108's text never priced: every invocation of any member
operation re-evaluates the *entire* co-resident graph — all operations' and
all helpers' bytes — in its fresh VM, scaling the ~45%-of-invocation eval
share with total application size rather than with the invoked operation's
actual closure. (c) The DK-4 benchmark gate 0108 names (warm reuse and memory
at 1/4/16/64-operation graphs) is retired, not pending: its warm-reuse
criterion has no live referent. The follow-on must respecify the gate for the
real lifecycle — per-invocation evaluation latency and memory as a function
of bundle size and helper-duplication factor, against LLP 0035's ~3.9 ms
fresh-invocation baseline. (d) Every 2026-07-28 adversarial-closure refusal —
alias, destructuring, computed access — must be re-proved across module
boundaries, where a helper file can now launder what a single expression
could not (`export const c = obj.constructor`).

*Risks.* The review loop already failed to converge on this once; the
three-graph transform is the most intricate machinery in the codegen path.
The execution-shape question is really two separable choices — dependency
*admission* shape (which graph is admitted) and runtime *emission* shape (how
admitted code is packaged per invocation) — and the emission choice is
lifecycle-sensitive. A *resolve-and-splice* variant would resolve the same
closed graph, then inline the admitted helper bytes into per-operation
self-contained runtime modules, keeping the shipped one-module-per-operation
emission and giving precise per-operation invalidation (only operations that
actually reach the changed helper re-hash), at the cost of duplicated bytes
in generated artifacts. Under the shipped fresh-per-invocation lifecycle
that variant dominates the group bundle on the runtime axis, not just the
identity axis: each invocation evaluates exactly its own operation's closure
(one copy of each helper it actually uses), which is never more — and for
multi-operation apps is strictly less — than the group bundle's
whole-graph re-evaluation. The honest cost accounting is two-tier: the
duplicated helper *storage* lands in generated artifacts, the tier where LLP
0115's constraint 4 explicitly tolerates volume, while the *evaluation* cost
of any single invocation is the operation's own module size — a runtime-tier
quantity constraint 4 does not govern and the respecified benchmark in cost
(c) must measure. The group-bundle emission is only re-motivated in the
conditional future where pooling returns (LLP 0009 conditions that on stable
runtime-owner threads or a new upstream transfer contract): a pooled world
wants few pool keys, and per-operation splice modules would mean one key per
operation — the thrash 0108 originally designed against. So the follow-on's
emission decision should be made with the lifecycle condition explicit:
splice is the better fit for the runtime that ships today, and a later
return of pooling would reopen — not silently reverse — the choice.

### 1a. Same-file lexical helper closure (a staged slice of option 1)

Between full bounded bundling and a novel declared primitive sits a distinct,
materially smaller design this document's first draft missed: admit ordinary
top-level function declarations and `const` helpers *in the same authored
functions file*, statically validate them under the existing
self-containment and adversarial rules, and splice each operation's reachable
helpers into its per-operation runtime module. No resolver runs, no
filesystem or path semantics enter identity, and no new idiom is taught —
it is exactly the JavaScript an agent writes first (Diary 0033's "shared
sibling reader helper" is this shape, and the diary records the guide
steering the agent *away* from it, not the agent failing to think of it).
0108's superseded text already gestures at the slice: handlers "may reference
lexical constants, local helper functions, and admitted static ECMAScript
imports" — this option takes the first two clauses and defers the third.

*Benefits.* It restores precisely the legacy sharing unit — one file per app
— whose loss the history section above identifies, minus the registry wiring
Diary 0022 complained about. Both motivating instances are same-file
(Streak Lab's query and mutation share one authored file; Relay Board's
backend is "one file contains contract plus implementation" per Diary 0033),
so CV-7's exit criterion — "Streak Lab's calendar helper written once and
used by both its query and mutation" — is satisfiable by this slice alone;
the exit as written requires a helper written once, not cross-file imports.
The identity story is option-2-shaped under option-1 syntax: the v2 hash
extension is a list of named helper-content hashes (no paths, no graph
encoding), with exact per-operation invalidation. Emission stays
one-module-per-operation, which is the right emission for the shipped
fresh-per-invocation lifecycle (see option 1's risks).

*Costs.* A real but bounded subset of option 1's mechanism: static
reachability from each handler over top-level declarations (declaration
order, cycles among helpers, temporal-dead-zone edges); the closed
pure-initializer grammar for retained top-level `const`s; adversarial
re-proof at file scope, because a sibling helper can launder what a single
expression could not (`const c = obj.constructor` at top level); source-span
bookkeeping through the splice; and the helper-class decision (the
cross-cutting axis above — Relay's factored reader would take the runtime
context, so meeting both diary instances needs at least context-reader
helpers even in this slice, and with them the axis's enforcement question:
kind- and grant-keyed boundaries are what ships, declared tables are
unenforced evidence). TypeScript flow from helper into handler is the same
joint design with LLP 0117 that options 1 and 2 need.

*Risks.* Low relative to its siblings — it is a strict subset of option 1's
admission problem with option 2's identity shape. The strategic risk is
sequencing: if it ships first and satisfies the measured pressure, the
multi-file mechanism may never earn its complexity — which is either a
graceful stopping point or an under-build, depending on how helper pressure
actually scales (open question 6). It also reframes this document's open
question 1: "how much graph is needed at all" (same-file versus multi-file)
is prior to "group-bundle versus splice," and this slice is the concrete
form of the smaller answer.

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
parity program is about reducing proprietary surprise; the expectation (from
training distribution, not a diary observation — the diaries record agents
asking for a documented pattern and being steered by the guide, not their
first-keystroke syntax) is that Convex-trained agents type `import` — or a
plain sibling function, option 1a's shape — first and hit a refusal that
must teach the alternative.
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
which 0108 forbids in its opening summary. The bundler variant needs a
sharper cut than this document's first draft gave it, because "who decides
what executes" and "whose binary performs the transform" are independent
axes. The disqualifying configuration is *delegated resolution*: the
bundler's own semantics — bare specifiers, `node_modules` lookup,
conditional exports, tree-shaking heuristics — decide what executes, and
digesting whatever it happened to read is post-hoc attestation, not
admission; refusals degrade from authored source spans to positions in a
transformed bundle. But a *controlled* configuration — Snapback-owned
admission rules seizing every resolution decision through fail-closed
resolver/loader plugins, with every admitted input recorded before the
output is accepted — is not that, and it is not hypothetical: the shipped
definitions-side resolver is exactly this shape (esbuild-hosted, Snapback
plugins own all resolution; code-verified above). In the controlled
configuration the bundler is an implementation detail of option 1 (or 1a),
not a distinct policy; what it adds to option 1's cost sheet is
toolchain-version pinning — the transform host's version and configuration
join load-bearing identity — plus the stronger handler-tier initializer and
capability rules the definitions side does not need.

*Verdict as research.* Split the verdict along the real axis. Delegated
resolution is not viable under the invariants as stated — that half remains
the undisciplined shadow that clarifies why CV-7 points at Snapback-owned
admission. A controlled stock transform under Snapback-owned resolution is
viable in principle and already has a shipped sibling; whether the follow-on
hosts its transform in esbuild or in Snapback's own splicer is an
engineering choice inside option 1, not an option-level fork.

### 4. Open module imports, Convex-style

Adopt the ordinary-module model wholesale: handlers import anything the
filesystem and `node_modules` provide; evidence moves to a digest of the final
bundle plus a capability rescan of final bundled bytes, with the no-eval VM
and runtime constructor-walk probes as the backstop.

*Benefits.* Maximum familiarity; the entire diary complaint disappears, and —
as general background, not diary evidence: the diaries record duplicated
*first-party* helpers only, never a blocked third-party dependency —
third-party pure libraries (date math, decimal arithmetic) that options 1,
1a, and 2 still exclude become available. Honestly stated, the runtime
boundary already does much of the *security* work — the no-eval VM, denied
globals, and probes run regardless of how the bytes were assembled — and a
final-bundle capability rescan is a real, if blunt, admission gate.

*Costs.* What the static closure uniquely provides is not primarily runtime
security; it is evidence. An open graph discards reviewability (the authored
file no longer bounds what executes), bounded artifact size, deterministic
regeneration (local `node_modules` state joins executable identity, so
unchanged source no longer regenerates byte-identically across machines), and
the supply-chain boundary (a package update silently changes executable
authority with no per-edge attestation). Refusals lose span precision.

*The hermetic variant, analyzed rather than excluded.* The costs above
describe the *ambient* open-import design — whatever `node_modules` holds
executes — and this document's first draft let that stand for the whole
package space. It should not: a distinct design admits only
lockfile-resolved, integrity-verified, size-bounded ESM package closures,
recording package name/version, resolved export conditions, per-file
digests, and toolchain identity, and still refusing undeclared ambient
checkout state. That variant genuinely recovers deterministic regeneration
(the lockfile, not machine state, fixes the bytes) and attestation — with
one distinction the first draft blurred: lockfile integrity hashes
authenticate the *package artifact* as fetched, not each resolved import
edge, so resolved-edge and file-level attestation comes from the variant's
separately recorded resolution graph and per-file digests, not from the
lockfile itself. What it does not recover cheaply:
reviewability at package scale (an admitted closure of a real date library
is orders of magnitude more bytes than any first-party helper, and integrity
attestation is not review); conditional-export resolution semantics, which
Snapback must then own and pin; lockfile custody (the lockfile joins
executable identity, so its format and the package manager producing it
become load-bearing); source-map precision through third-party transforms;
and the difference between "this hash was pinned" and "this dependency
deserves authority" — the supply-chain question moves from mechanism to
policy but does not disappear. Whether that complexity is worth buying — or
whether vendoring-into-the-app (which reduces packages to option 1's
app-relative files) is the honest answer for the rare third-party need — is
a real open question (open question 8), not something the ambient argument
settles.

*Verdict as research.* The ambient form is the clearest candidate violation
of LLP 0115's no-evidence-regression constraint — the ergonomic gain is real
and the evidence loss is structural; the rescan-of-final-bundle model
recovers a capability floor but not the identity, review, or supply-chain
properties. If ever revisited, it should be an explicitly weaker opt-in
profile with its own capability id and nonclaims, not a change to the
default contract. The hermetic variant is a different design that this
document can only bound, not dismiss: it survives the determinism and
attestation objections, stands or falls on package-scale reviewability and
resolution-semantics custody, and belongs in the follow-on's option set only
if third-party helper pressure materializes in evidence the diaries do not
yet contain.

### 5. Duplication as the paved answer, plus drift tooling

Accept self-containment permanently; invest in making duplication safe rather
than eliminating it. Codegen already computes a canonical AST per handler; a
subtree-hashing pass could detect duplicated function declarations across a
backend's handlers and emit a diagnostic naming the copies — turning silent
drift, the real hazard, into a visible one. The guide would document the
copy-and-mark pattern. The two detection grades must be priced separately:
*exact*-duplicate detection is a plausible small increment on the existing
`canonicalAst` output, while *near*-identical detection — renamed locals,
divergence tolerance, false-positive policy, copy provenance — is a real
research problem. "Small and immediately landable" is therefore a hypothesis
about the exact-match grade only, unproven for the grade that would catch
drift *after* it has begun, which is the grade the hazard actually calls
for.

*Benefits.* Zero invariant risk, zero new runtime or identity mechanism;
directly targets the correctness hazard this document identifies as worse
than the volume cost.

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
The extractor, hash format, runtime, and emission model never change.

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

### Cross-front interactions and a scope boundary

Both motivating instances have dissolution paths that run through *other*
parity fronts, and the urgency evidence for CV-7 must be read net of both —
this document's first draft noticed only one. The Streak Lab instance is
option 7's: a pinned civil-date stdlib removes the most-cited duplication
without any graph mechanism (open question 4). The exactly parallel
observation holds for Relay Board: LLP 0115 CV-8 and LLP 0120 name Relay's
`boardView` (one parent + N declared child collections) and `boardSummary`
(bounded grouped counts) as candidate declarative shapes — precisely the two
operations whose duplicated indexed reads are this document's second primary
evidence. If CV-8's declarative promotion lands, that duplication dissolves
with no helper mechanism at all: the shared reader stops existing because
the reads stop being imperative. Neither dissolution is committed, and
helper pressure beyond the two named instances would survive both; but a
follow-on that prices CV-7's L-size mechanism should know that its two
headline exhibits each have a cheaper exit that also pays other dividends.

A scope boundary this document owes explicitly: *sub-operation composition*
— sharing logic by extracting it into a callable admitted operation and
invoking it from another operation, the shape Convex exposes as the
`ctx.runQuery` family and components, and which LLP 0120 discusses as
composition of already-admitted bounded nodes — is deliberately **out of
scope here**. It is an operation-granularity mechanism with its own
authority, transaction, and evidence questions, owned by the relational
composition front (LLP 0120 / CV-8). This document covers helper-granularity
code sharing inside a single operation's implementation; if the 0108
follow-on ever considers a callable-operation primitive, it should do so
jointly with 0120's frame, not as an eighth option in this one.

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
   shipped closed graph resolver with attested identity — esbuild-hosted,
   with Snapback's fail-closed plugins owning every resolution decision,
   admitting relative/`file:`/absolute local specifiers plus a two-entry
   Snapback-owned bare-specifier allowlist — while handler executable code
   admits no graph at all. The admission machinery option 1 needs has a
   working sibling in the same codebase, and that sibling also proves
   Snapback-owned admission can be hosted in a stock transform.
4. Code-verified: the v1 implementation hash contains no dependency-graph
   field (`{form: 'inline', canonicalAst}` only). Any sharing mechanism that
   changes executable bytes is therefore a v2 hash format; option 1
   (path-carrying graph encoding), option 1a (named helper-hash edges, no
   paths), and option 2 (explicit declared helper-hash edges) imply
   materially different v2 shapes.
5. The authored-volume evidence is real but confounded (Streak Lab 345→389,
   Relay Board 148→224, Split Ledger 379→427, with verbose exact result
   contracts contributing alongside duplication), and the deeper cost is
   drift, not lines: duplicated copies share no identity — the current
   identity model records no intended equivalence, so divergence is silent
   today. It is not unseeable in principle; option 5's detection diagnostic
   is the unbuilt remedy, and its feasibility split (exact vs.
   near-identical) is an empirical question.
6. The runtime security backstop (no-eval VM, denied globals, constructor-walk
   probes) is independent of the static closure. The closure's distinctive
   contributions are evidence-tier — reviewability, bounded deterministic
   identity, refusal precision, the supply-chain boundary — which is why
   option 4 is an evidence regression even where arguably security-adequate.
7. Option 1's group-bundle emission was designed for a VM lifecycle that no
   longer ships: LLP 0009 retired DK-4 warm reuse on 2026-07-27, the pool is
   a code-verified no-op (`crates/snapback/src/warm_vm.rs`), and no current profile — local,
   hosted, or workerd twin — retains warm module reuse. Under the real
   fresh-per-invocation lifecycle the group bundle keeps its
   implementation-identity blast radius (one helper edit re-hashes every
   co-resident operation) and gains an unpriced runtime cost (every
   invocation re-evaluates the whole co-resident graph), while its original
   pool-key rationale is vacuous. Resolve-and-splice dominates it today on
   both axes: per-invocation evaluation is bounded by the operation's own
   closure, invalidation is exact, and the duplicated helper *storage* lands
   in generated artifacts — the tier where LLP 0115 tolerates volume — while
   the per-invocation evaluation cost is a runtime-tier quantity the
   respecified benchmark must measure (measured 2026-07-31: noise-level —
   see the dated answer under open question 1). Group-bundle emission is
   re-motivated
   only if pooling returns under 0009's stated condition (stable
   runtime-owner threads or a new upstream transfer contract). Both 0108's
   blueprint note and 0115's CV-7 work text still speak in warm-pool terms
   and owe this absorption (0108's absorption landed 2026-07-31 — its
   superseded sections are marked and §Same-file helper sharing is the
   normative text).
8. Options 5 (drift tooling) and 7 (pinned stdlib) are cheap complements that
   neither meet CV-7's exit alone nor conflict with anything; option 3's
   delegated-resolution form is research-useful mainly as the undisciplined
   shadow of option 1, while its controlled form collapses into an
   implementation choice inside option 1; option 6 relocates the problem
   rather than solving it.
9. Attribution note, updated at v0.2: earlier drafts of LLP 0115 CV-7 and
   LLP 0108's field-evidence section named "Campfire's indexed-read
   helpers," but Diary 0034 (Campfire) records no helper duplication; the
   primary-source instance is Relay Board (Diary 0033). LLP 0115 v0.4 has
   already absorbed the correction (crediting this document); only LLP 0108
   (its Diary 0039 field-evidence section) still carries the misattribution
   and owes it on its next revision.
10. Both motivating duplication instances are same-file (Streak Lab's query
    and mutation share one authored file; Relay Board's backend is two
    authored files — schema plus functions — and both duplicated queries
    live in the single `functions.mjs`), so the same-file lexical slice
    (option 1a) can
    satisfy CV-7's exit criterion as written — "written once and used by
    both" requires a helper written once, not cross-file imports — at a
    fraction of option 1's mechanism. The graph-scope question (same-file
    vs. multi-file) is therefore prior to the emission question (group vs.
    splice) in the follow-on's decision order.
11. The two instances differ in semantic class — Streak Lab's helper is
    pure; Relay Board's shipped duplication is inline code using the
    runtime context, so its factored form would be a context-receiving
    reader — and the statically provable safe lane is
    context-capability-freedom, a capability-flow property, not a
    signature property: a no-`ctx`-parameter test admits `helper(ctx.db)`
    and its aliases, and even a sound context-rooted flow gate proves
    less than semantic purity, for two independent reasons. First, `Date`
    and `Math` are admitted globals whose ambient surface (`Date.now`,
    `Math.random`, bare `Date()` invocation, zero-arg `new Date()`) is
    runtime-denied only in the deterministic tier — actions retain it by
    design (`crates/snapback/src/runtime.rs`) — so an ambient-reading helper passes the
    gate yet is nondeterministic under action consumers. Second,
    capability flow rules out no side effect: a passing helper can still
    mutate its arguments, captured bindings, or module-level state in
    any profile, so side-effect-freedom is a third, distinct property
    needing its own analysis before any "pure" label. Code-verified,
    today's opaque-handler enforcement is keyed
    to the invocation's runtime kind and `uses` grant at the host
    boundary, while declared reads/writes are evidence without a runtime
    ceiling
    (declared-basis ceilings without static proof, load-time validation
    skipping non-HostPlan runtimes, no declared-table comparison in the
    dispatcher). A shared helper therefore inherits its consumer's kind
    and grant boundaries automatically, but binding helper accesses to the
    consumer's declared tables — the caller-ceiling rule — would be a new
    enforcement mechanism whose introduction changes behavior for the
    whole existing opaque-handler tier, not preservation of current
    behavior.

## Confidence

**Code-verified** (read in this repository at authoring or revision time):
the extractor's closed globals set (31 entries), free-identifier and
forbidden-syntax refusals, marker replacement, per-operation runtime module
registration (`packages/snapback-codegen/inline-handlers.mjs`); the
dependency-graph-free v1 implementation hash
(`packages/snapback-codegen/index.mjs`); the definitions-side closed
module-graph resolver, its refusal codes, its esbuild-hosted fail-closed
plugin structure, and the `DEFINITION_PACKAGE_IMPORTS` two-entry allowlist;
the no-eval VM constructor and runtime constructor-walk probes
(`crates/snapback/src/runtime.rs`); the opaque-handler enforcement facts in §the
cross-cutting axis — declared-basis effect ceilings without static proof
for JS/Ibex handlers (`packages/snapback-codegen/effect-ceiling.mjs`),
load-time ceiling validation returning without checking non-HostPlan
runtimes (`validate_effect_ceiling`, `crates/snapback/src/manifest.rs`), and mode-keyed
host-call enforcement with no declared-table comparison for
`db.query`/`db.insert`/`db.patch`/`db.delete`, plus the per-invocation
`uses` grant and its `SNAPBACK_CONFIG_UNDECLARED` refusal
(`handle_host_call`, `crates/snapback/src/runtime.rs`); the tiered ambient-nondeterminism
surface — `Date` and `Math` on the extractor's `ALLOWED_GLOBALS`,
codegen's kind-blind static refusal of the direct
`Math.random()`/`Date.now()`/any-arity `new Date(...)` spellings (bare
`Date()` invocation has no static branch) with aliases deliberately
deferred to the runtime boundary (`scanUnsupportedHandlerSource`,
`packages/snapback-codegen/index.mjs`), and the deterministic-tier-only
runtime denial of the allowlist's `bannedEverywhere.members`
(`Date.now`, `Math.random`) plus the wrapped `Date` constructor denying
bare `Date()` invocation and zero-arg `new Date()` while keeping
explicit-timestamp construction and `Date.parse`/`Date.UTC`, actions
retaining the ambient surface
(`DATE_CONSTRUCTOR_DENY_SOURCE`/`ambient_restriction_source`,
`crates/snapback/src/runtime.rs`; the matching wrapper and member denials in
`packages/snapback-harness/workerd/strip.mjs`); the retired warm pool —
`WarmVmPool` as a no-op
(`crates/snapback/src/warm_vm.rs`) with its `@ref` to LLP 0009's DK-4 retirement — and the
manifest's `vmLifecycle: "fresh-per-invocation"` default (`crates/snapback/src/manifest.rs`);
LLP 0010's single-file legacy handler profile.

**Diary-reported** (primary observational evidence, not independently rerun):
all line/byte counts, the specific duplication instances, the comparative
scoring, and every quoted agent judgment (Diaries 0022, 0032, 0033, 0036,
0039).

**General knowledge** (not re-verified against current Convex releases):
Convex's esbuild-based push bundling, the model-directory helper convention,
type inference across imports, the default-isolate/`"use node"` runtime
split, and the `ctx.runQuery`-family/components composition surface.
Directionally load-bearing for §What Convex does; any follow-on that depends
on a specific Convex mechanism should re-verify it.

**Hypotheses and expectations** (labeled where they appear, gathered here):
that helper pressure grows with app size (open question 6); that
Convex-trained agents reach for `import` or a plain sibling helper first
(the diaries record neither first-keystroke behavior nor a blocked
third-party dependency); that third-party pure libraries are a real demand
lane for option 4 (no diary evidence); and that exact-duplicate detection is
a small increment while near-identical detection is not (option 5).

## Open questions

1. **How much graph — then which emission?** The v0.2 revision reordered
   this question. The *first* design decision is graph scope: same-file
   lexical closure (option 1a) versus multi-file bounded imports (option 1),
   because both motivating instances are same-file and the two scopes imply
   different v2 hash shapes. The emission decision (group-bundle versus
   resolve-and-splice) comes second and is lifecycle-sensitive: under the
   shipped fresh-per-invocation lifecycle (LLP 0009's DK-4 retirement,
   2026-07-27) splice dominates — evaluation bounded by the invoked
   operation's own closure, exact invalidation — and 0108's group-bundle
   text is re-motivated only if pooling returns under 0009's stated
   condition (stable runtime-owner threads or a new upstream transfer
   contract). The empirical question either emission must answer:
   per-invocation evaluation latency and memory as a function of runtime
   module size and helper-duplication factor, against LLP 0035's ~3.9 ms
   fresh-invocation / ~45%-eval baseline.

   **Answered 2026-07-31 (measured).** Both halves are closed for the
   landed slice. The decisions: same-file graph scope and splice emission
   landed at `4d72c407` (LLP 0127 decision 6; normative text in LLP 0108
   §Same-file helper sharing). The empirical question: the respecified
   benchmark ran as the `helper_splice` section of the LLP 0035 harness
   (`crates/snapback/src/bench.rs`, `snapback-bench`), on the real fresh-per-invocation
   runtime path — real Hermes create+eval through `LocalSnapback`,
   pooling disabled, per-invocation `Instant` samples — over three
   per-operation modules in the exact splice-emitted byte shape (the
   three-helper module verified byte-identical to
   `renderInlineOperationModule` output for equivalent authored source),
   all computing the same civil-date record: logic inline (653 module
   bytes), one spliced helper (692 B), a three-helper chain (942 B). Two
   full-scale release runs, 400 timed invocations per variant, one Apple
   Silicon dev machine (2026-07-31):

   | Variant | run 1 p50/p95 (µs) | run 2 p50/p95 (µs) |
   | --- | --- | --- |
   | helper-free | 7 155 / 7 447 | 7 457 / 8 170 |
   | one helper | 7 193 / 7 596 | 7 690 / 8 701 |
   | three helpers | 7 316 / 7 777 | 7 662 / 8 238 |

   Splice duplication costs nothing material per invocation: the spliced
   variants sit +0.5–3.1% over the identical inline factoring at p50, and
   the ranking of one-versus-three helpers inverts between runs, so the
   deltas are at or below run-to-run noise — evaluation is bounded by the
   operation's own closure, as finding 7 projected. Memory: RSS drift
   across each 400-invocation loop is 16–32 KiB (page granularity, no
   per-invocation retention — each fresh VM is dropped); the real
   duplication cost is generated-artifact bytes, the tier LLP 0115
   constraint 4 tolerates. Machine-dependence, honestly: the same-run
   fresh baseline (`vm_cost_us`) measured 7.5–10 ms on this machine/build
   versus the ~3.9 ms of LLP 0035's dated 2026-07-01/02 tables — absolute
   digits vary by machine and the runtime has grown since — but the OQ1
   quantity is the within-run cross-variant delta, which is robust to
   that. `m1_bench_smoke` pins the property in CI (5× relative bound,
   module-size monotonicity, cross-variant equality gate). What this does
   not answer: the cost curve beyond small helper counts/module sizes
   (multi-file scale), which stays with open question 6's pressure
   evidence.
2. **Who is the composition surface for?** If the durable audience is agents
   with a guide in context, option 2's novel idiom may cost little; if human
   Convex refugees matter, ordinary syntax is worth its mechanism — and
   option 1a supplies ordinary syntax (a plain sibling function) without
   `import`, so the question is finer than import-versus-primitive. A
   related open observation from Diary 0033: the *guide* steered the agent
   away from a sibling helper; absent that steering, same-file helpers may
   be the natural first idiom, which favors 1a on muscle-memory grounds.
   The answer shifts the option ranking.
3. **How does helper typing flow?** Sharing without TypeScript inference
   across the shared boundary recovers only half the Convex advantage; the
   interaction belongs to LLP 0117's type-flow analysis and should be designed
   jointly.
4. **Does the stdlib (option 7) precede or follow the general mechanism?** It
   is independently landable and removes the most-cited duplication instance
   (civil-date logic), which would change the urgency evidence under CV-7
   before the heavy mechanism starts. The same question now has a twin on
   the other front: CV-8's declarative promotion (LLP 0120) would dissolve
   the Relay Board instance the same way (§Cross-front interactions), so the
   follow-on should price CV-7's mechanism against the possibility that
   *both* headline instances dissolve through cheaper, independently
   motivated work.
5. **What does drift detection owe the interim?** If CV-7 is quarters away, a
   duplicate-subtree diagnostic (option 5) may be worth landing now — but
   CV-6's evidence says advisory severity will not change behavior, and the
   severity decision is already open as LLP 0115 OQ3.
6. **Does helper pressure actually grow with app size?** The floor claim in
   §How they differ is an expectation, not a measurement — the seven matrix
   apps are small and the diaries record no size to helper-count
   relationship. A larger app in a future rerun (or instrumenting duplicate
   subtrees across existing demo backends) would turn this into data, and
   its answer sizes both the urgency of CV-7 and the sufficiency of the
   same-file slice.
7. **Which helper classes does the first mechanism admit, and under which
   enforcement?** Context-capability-free helpers, context-reader helpers,
   mutation helpers, action/egress helpers — each widening admits more of
   the diary evidence (Relay's factored form needs context reads) and
   enlarges the authority-analysis surface (§the cross-cutting axis). Two
   sub-decisions the axis's corrected facts expose: whether the
   context-capability-free lane's conservative flow admission is built at
   all (a new static analysis, not the extractor's free-identifier test) —
   and, if built, whether it adds the ambient roots (`Date`, `Math`) to
   the taint set for action consumers and the separate side-effect
   analysis — both prerequisites to any purity label — or claims
   context-capability-freedom only, never semantic purity — and whether
   declared reads/writes remain unenforced evidence — the shipped
   posture, under which a helper
   inherits only its consumer's kind- and grant-keyed boundaries — or
   become an enforced table-level ceiling, a new mechanism that would
   change behavior for the existing opaque-handler tier. The follow-on
   must pick a cutline and state how the chosen class provably cannot
   expand any consumer's declared authority.

   **Answered 2026-08-02.** The first mechanism admits context-reader
   helpers. Declared reads and writes remain evidence, not runtime-enforced
   table ceilings; adding ceiling enforcement is a separate future decision,
   not part of this slice. This ruling does not admit mutation helpers or
   action/egress helpers. Source:
   `issues/20260802-author-decision-packet.md`.
8. **Are hermetic lockfile-pinned package closures evaluated now, deferred,
   or excluded as a product boundary?** Option 4's hermetic variant survives
   the determinism and attestation objections but stands on package-scale
   reviewability, resolution-semantics custody, and lockfile custody; no
   diary evidence yet demands it, and vendoring reduces the known need to
   option 1's app-relative files. This wants an explicit boundary decision
   in the follow-on rather than silence.

## Relationship to LLP 0115 and owning documents

LLP 0115's CV-7 sequences this work (Tranche C, size L) and already commits to
option 1's frame — "revive and close those sections as the 0108 follow-on
rather than designing from scratch" — with the exit criterion of Streak Lab's
calendar helper written once. This document supports that lead while
recording four qualifications the follow-on inherits: the group-bundle
execution shape is not forced by the invariants and its warm-pool rationale
is currently vacuous (LLP 0009 retired DK-4 on 2026-07-27 — CV-7's work
text and 0108's blueprint note both still phrase the trade in warm-pool
terms and owe that absorption); CV-7's exit criterion is satisfiable by the
same-file slice (option 1a) without any multi-file mechanism, which bears on
its L sizing; options 2 and 7 are viable complements or fallbacks with
cleaner identity stories, and options 5/7 have value regardless of the main
mechanism; and both headline duplication instances have dissolution paths
through other fronts (option 7 for Streak Lab, CV-8/LLP 0120 for Relay
Board). The normative owner remains LLP 0108: substantive design lands there
(or in its named follow-on Spec), not here. The final call — including
whether CV-7's L-size mechanism precedes or follows the cheaper complements
— is the author's, and this document deliberately does not make it.

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
