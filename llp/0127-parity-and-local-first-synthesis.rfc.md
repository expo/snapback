# LLP 0127: Parity and local-first synthesis — few mechanisms, many fronts

**Type:** RFC
**Status:** Accepted
**Systems:** Competitive evaluation, Developer experience, Authoring, Application data API, Code generation, Runtime, Bootstrap, Packaging, Search, Relational queries, Scheduled work, Client integration, Sync, Storage, Documentation, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:** 2026-08-13 (dated familiar-profile exception: LLP 0252/0253
preserve this RFC's accepted canonical-surface decisions while authorizing one
scoped, measured familiar-alias experiment). 2026-08-12 (post-acceptance disposition update: Draft LLP 0245
owns the conditional infer-then-freeze bridge and Draft LLP 0246 owns bounded
TypeScript module custody; no accepted Move-1 or Move-2 semantic changes).
2026-08-02 (decision-sitting propagation: open-question item 6
is answered — context-reader helpers are admitted in the first mechanism and
declared reads/writes stay evidence rather than enforced ceilings; source:
`issues/20260802-author-decision-packet.md`). 2026-07-30 (v0.3 — round-2 micro-fix pass. Round-2
outcome: Fable READY with two DETAILs (N1 blocked-accounting
completeness, N2 1a locating clause;
llp/reviews/0127-parity-and-local-first-synthesis.fable.md); Codex
NOT READY on two sentence-level items, one MATERIAL and one DETAIL
(llp/reviews/0127-parity-and-local-first-synthesis.codex.md).
Applied, all four: the composition map's closing coverage claim
narrowed, with the 0126 residual exceptions enumerated where the
claim is made; the "only the 1a hybrid is pre-registered" line
re-attributed to this RFC, informed by — not selected by — 0119
finding 6; the closing what-blocks-what accounting completed for
items 7–10, with item 10 joining move 3's owner-landing exit gate;
and the 1a-erasure claim located at the function-kind surface, with
the assumed manifest-entry home of the persisting declared
subscribable fact stated.)
2026-07-30 (v0.2 — round-1 dual-family review fix pass.
Round-1 outcome: Fable NOT READY (7 concerns C1–C7, 10 details D1–D10;
llp/reviews/0127-parity-and-local-first-synthesis.fable.md) and Codex
NOT READY (2 blocking-for-bar, 3 material, 2 detail;
llp/reviews/0127-parity-and-local-first-synthesis.codex.md), with
substantial overlap. All 17 Fable items and all 7 Codex items verified
against the cited corpus texts and applied; none rejected. Applied:
0126's option D restored as two parallel platform ladders with
IR-rung-first relabeled as this RFC's resourcing proposal; the 1a
pre-registration recast as this RFC's own judgment with its
declared-fact mechanism assumption stated and 1b named; exact-vs-ANN
routed to open question 8 and sequence-primitive-first moved out of
the verified-refinements list; the 0126/0122/0117 coverage cells
corrected (protected-opaque retention, offline search, delta-resume,
option F, one-CLI/app-cli, meta-package, mechanism (a) unimplemented);
the 0125 wide-409 taxonomy folded into the 0094/0095 delegation; the
closing blocked/unblocked accounting restated per move with the
bundled first slices split and named; the "Tranche A alone" carve-out
made explicit; the move 6 → move 4 vocabulary line downgraded to
shared principle; plus the detail fixes (0081 as proposed not settled
owner, watch-item absorption item 7, restored candidate /
absence-of-regression / new-owned-Spec hedges, CV-14 and npm-gate
scope corrections, delivery-authorization axis held open).)
**Related:** LLP 0004, LLP 0008, LLP 0009, LLP 0010, LLP 0012, LLP 0013, LLP 0028, LLP 0034, LLP 0041, LLP 0043, LLP 0044, LLP 0051, LLP 0053, LLP 0059, LLP 0061, LLP 0070, LLP 0073, LLP 0074, LLP 0080, LLP 0081, LLP 0090, LLP 0093, LLP 0094, LLP 0095, LLP 0108, LLP 0110, LLP 0111, LLP 0112, LLP 0113, LLP 0114, LLP 0115, LLP 0116, LLP 0117, LLP 0118, LLP 0119, LLP 0120, LLP 0121, LLP 0122, LLP 0123, LLP 0124, LLP 0125, LLP 0126, LLP 0245, LLP 0246

## Summary

The research series (LLP 0116–0125) and the local-first deep-dive
(LLP 0126) examined ten fronts where agents building the same
applications preferred Convex, or where nobody measured anything at
all. Read together, they do not ask for ten programs. They ask for six
moves, each of which closes several fronts at once, because the fronts
share root causes: every Convex advantage the diaries recorded is a
convenience made invisible — inferred types, silent retries, ambient
reactivity, a hidden scheduler, a sealed runtime nobody thinks about —
and every corresponding Snapback answer with a future is the same
convenience made *visible*: a declared contract instead of an inferred
one, a receipt instead of a retry loop, a capability fact instead of an
ambient default, an enqueue bound to its producing write, a sealed
artifact that proves its own readiness. The aesthetic this RFC commits
to is exactly that: few mechanisms, many fronts; receipts instead of
magic; evidence never traded for ergonomics — extended, so that the
ergonomic endpoint matches Convex's while the evidence is strictly
stronger (LLP 0116 finding 4). The deepest single observation in the
corpus is LLP 0126's: the properties Snapback built for *review* —
closed handler graphs, content-addressed implementations, an enforced
deterministic tier — are the same properties *re-execution* needs, so
the parity program and the local-first program are not competitors for
attention but two consumers of one substrate.

Unlike the Research documents, this RFC makes calls — it proposes a
direction (author directive, 2026-07-30). Its discipline is unchanged:
substantive design lands in the owning documents named per move;
sequencing authority stays with LLP 0115, which absorbs the proposals
below only when the author agrees; and nothing here weakens an evidence
boundary (LLP 0115 governing constraint 1). Where a Research document
labeled something a hypothesis, it stays a hypothesis here, and the
Measurement section carries it.

## The six moves

### Move 1 — Contracts reference; nothing respells

**The idea.** One declared-contract vocabulary spans mutation
arguments, stored fields, results, and failure variants — and composite
contracts *reference* declared shapes instead of respelling them. The
felt type-flow cost is per-boundary, not total (LLP 0117 finding 2), so
the fix is to make each boundary cheap without moving authority:
widen the argument lane to the result grammar and add the missing
server-side ingress seam (0117 option A — an evidence *addition*, since
no argument validation exists today, 0117 finding 4); add
schema-referencing contract nodes (`v.doc(...)`-class) that expand into
the same frozen, hashed contracts that ship today (option E, the only
path that reduces authored lines with zero inference); generate the
handler-facing type surface from the same declared artifacts so the
interior is typed and contract/handler mismatch is a dev-time squiggle,
checker consuming — never minting — the contract (option F); and only
then raise omission strictness (option G), because strictness before
cheapness raises the tax on the surface agents already dislike (0117's
ordering dependency). The same fabric absorbs two more fronts:
declaration-closed rejection unions as result-contract variants — the
host-plan `elseError`/`guard` channel already emits app-authored codes
verbatim, and the JS lane collapses everything to
`SNAPBACK_HANDLER_FAILED` (LLP 0125 option 2, finding 4) — and the
platform's own structured surfaces, which stop hand-authoring their
shapes: the search AST becomes a reference to one exported, drift-gated
Rust-owned schema (CV-5's reference-not-respell shape, 0117 §CV-5),
and the job-status surface of move 3 is a generated *declared*
operation with an ordinary contract, not an ambient system table.

**Fronts.** The felt gaps behind all four of 0117's mechanisms — (b)
structured inputs, (c) omission policy, and (d) interior typing
directly; (a) return inference *answered* by E's declaration
compression, not implemented — mechanism (a) itself stays unadopted,
with infer-then-freeze (C) as 0117's named bridge if post-A+E
measurement still scores bulk as decisive; 0125's rejection-union
remainder; CV-4a/4b, CV-5, CV-6 on 0115's board; the two mechanisms
0115's board did not cover ((a)'s compression answer via E, interior
typing via F).

**What lands where.** The CV-4 Spec (a new numbered Spec plus the dated
LLP 0004 alignment, per 0115 OQ1's answer) owns the merged grammar, the
ingress seam, and — this RFC proposes — the schema-reference nodes
(0117 OQ2), with a dated LLP 0108 cross-amendment. CV-5 lands in
LLP 0073's frame as the *first conformance fixture* for the extended
argument-contract descriptor (`argsContractHash` witnesses the extended
descriptor; it is not itself a carrier — 0117 §CV-5). Rejection unions
land in LLP 0108's family with the generated failure union reaching
client types. Option F lands as a small pilot (generated per-app typed
builder module — the carrier 0117 verified viable on today's surface)
plus the dated LLP 0108 clarification that contract-*checking* is not
forbidden inference (0117 OQ4). Option G is 0115 OQ3, an LLP 0108
amendment, sequenced after A+E land.

**First slice.** CV-4a arguments with the extended descriptor, proved
end-to-end on the search AST (CV-5) before app-authored arrays and
unions arrive — 0115's own sequencing, confirmed by 0117.

**Decisions forced.** One grammar or a subset (0117 OQ1 — this RFC
proposes one grammar; the two-lane structure was the bug, not a
feature); E's placement (proposed: the CV-4 Spec); OQ3's severity and
its ordering; throw-shaped vs return-shaped rejections and their
carrier (LLP 0125 OQ2).

### Move 2 — The closed graph grows; custody does not shrink

**The idea.** Helper reuse without opening the module graph, staged by
what the evidence actually demands. Both motivating duplication
instances are same-file (LLP 0118 finding 10), so the first mechanism
is the same-file lexical slice (0118 option 1a): top-level helpers in
the authored functions file, statically validated under the existing
self-containment and adversarial rules, spliced into each operation's
runtime module. Emission is resolve-and-splice, which dominates the
superseded group-bundle under the shipped fresh-per-invocation
lifecycle on both the identity and runtime axes (0118 finding 7); the
duplicated helper *storage* lands in generated artifacts, the tier
where LLP 0115 constraint 4 tolerates volume. The v2 implementation
hash is a list of named helper-content hashes — no paths, no graph
encoding — with exact per-operation invalidation. The statically
provable safe lane is context-capability-freedom, not purity (0118
finding 11); meeting both diary instances requires admitting at least
context-reader helpers, which inherit their consumer's kind- and
grant-keyed runtime boundaries automatically. The cheap complements
land regardless: a pinned civil-date/money stdlib (option 7) and an
exact-duplicate drift diagnostic (option 5). Multi-file bounded imports
(option 1 proper) wait for measured pressure the seven small apps do
not yet show (0118 OQ6) — and both headline instances have dissolution
paths through other moves (the stdlib for Streak Lab; move 6 for Relay
Board), so the heavier mechanism must be priced against them.

**Fronts.** 0118 in full; CV-7; half of the authored-bulk story 0117
shares with it. It is also prerequisite ground for move 3: local
re-execution needs source/plan identity over exactly this closed,
content-addressed graph — a helper mechanism that broke closure would
forfeit execution-identity element 1 (LLP 0126 approach 9).

**What lands where.** The LLP 0108 follow-on owns everything, with the
decision order 0118 established: graph scope first (same-file), then
emission (splice) — and the follow-on absorbs the warm-pool-era text
that still phrases the trade in retired DK-4 terms. The stdlib and the
drift diagnostic are independently landable complements.

**First slice.** Option 1a with the v2 hash, adversarial re-proof at
file scope, and the respecified benchmark (per-invocation evaluation
latency and memory against LLP 0035's ~3.9 ms baseline). Scope
honesty: as specified this slice admits context-reader helpers — 0118
places that need *inside* the slice ("meeting both diary instances
needs at least context-reader helpers even in this slice") — so the
slice as specified waits on the helper-class cutline (open question
6). A capability-free-only first cut is startable today, but it
covers only the Streak Lab instance (which the stdlib independently
dissolves), not Relay's.

**Decisions forced.** The helper-class cutline and enforcement posture
— context-reader helpers admitted or capability-free only; declared
reads/writes stay evidence or become an enforced ceiling, which would
change behavior for the whole opaque-handler tier (0118 OQ7). Hermetic
lockfile-pinned package closures get an explicit boundary decision, not
silence (0118 OQ8): this RFC proposes *deferred* — no diary evidence
demands third-party helpers, and vendoring reduces the known need to
app-relative files.

### Move 3 — Deterministic re-execution is one substrate

**The idea.** The property that makes a handler reviewable — closed,
content-addressed, deterministic-tier-enforced — is the property that
makes it re-executable, and Snapback should ship re-execution in its
three demanded forms as one program, each form producing receipts where
Convex produces silence. (1) *Deferred in time:* transactional one-off
scheduling as LLP 0070's first slice (CV-9) — transactional enqueue,
`availableAt` delays, immutable job rows plus append-only attempts, a
set-based injected-clock drain — with the enqueue bound to its
producing write (the job row carries producer `mutationId` and
`snapshotVersion`, or the mutation receipt embeds its enqueues; LLP
0121 option 3) and a generated *declared* job-status query rather than
an ambient system table. That out-evidences Convex's single mutable
status row with no producing-write association and no attempt ledger
(0121 finding 10; LLP 0116 finding 4). (2) *Displaced in space:*
optimistic local execution settled by server rebase — 0126's option A
first, then option D as LLP 0126 v0.4 actually stages it: **two
parallel platform ladders**, not one sequence. Option A hardens the
cache the diaries actually score (default persistence via the shipped
`rqsStore` seam, leases, the M2 outbox, client-minted mutation
identity on the JS/React arm — every piece has a named owner and most
have code), with its reach bounded by design: protected *opaque*
queries stay non-retainable under LLP 0053's retainability invariant,
so cold retention comes to the declared/analyzable subset — and the
scored browser arms drove exactly the opaque lane. Option D's browser
ladder starts at the shared IR-evaluator rung (LLP 0051 D2) —
browser-safe, already designed, earning honest `Parity` for
IR-complete surfaces under LLP 0043's existing claim rule — and
continues to full-runtime WASM only behind its named assessment; the
desktop ladder, explicitly independent of the browser rungs (nothing
in it waits on WASM), starts with the sidecar carrying move 5's
sealed runtime artifact, then in-process embedding behind its spike;
mobile only after its spike. One resourcing choice is this RFC's
proposal, not 0126's staging: start with the shared IR rung, the
smallest independently valuable piece. This RFC deliberately
does *not* put option C (Replicache-class app-authored client mutators)
on the default ladder: same-by-convention dual implementations are the
exact drift the content address exists to remove (0126's own analysis),
and the IR rung reaches offline writes without them; C stays available
if demand for arbitrary offline client logic arrives before D matures —
an author decision, not a rung. (3) *Repeated under contention:*
settlement is the shipped conflict machinery — OCC read-set validation,
client-owned effect-free reservation retry, LWW-per-field replay with
typed conflict payloads (LLP 0008/0003/0059; LLP 0125 confirmed the
retry contract held — absence-of-regression evidence, with few direct
contention exercises in the rerun) — extended toward
retry-as-evidenced-contract (0125 option 4: attempts visible in
receipts, invisible in app code) as a later rider. Speculative
receipts carry content address plus captured environment; settlement
receipts bind them to the authoritative commit version; a locally
executed result is never presented as settlement.

**Fronts.** 0121 in full (CV-9); 0126's durable-lane program — option
A, option D's two ladders, the settlement discipline, the five
owner-landings, the ephemeral-split pin — with its residuals named
here and in the map: protected-opaque retention (out by design, LLP
0053; 0126 OQ2), offline search (unowned; 0126 OQ6), option F
(disposed in §Sequencing 5); 0125's retry-evidence direction; the
Dispatch, and offline-scored, arms of every bakeoff.

**What lands where.** LLP 0070 owns the jobs slice, with 0121's
paved-default-queue conditional and inspection-surface question
traveling on the ticket as 0121's relationship section proposes — this
RFC's proposed answer to the latter is the generated declared query
above; the receipt-association shape is 0121 OQ4, owner 0070, the
0108 family, or a new owned Spec (OQ4's three candidates).
LLP 0043/0114/0090 own option A; the lane's minimum wire surface
includes the version-based delta-resume consumer (designed in LLP
0008, unbuilt — 0008/0090/0093 territory no rung skips). LLP 0051
owns the IR rung and the execution-identity tuple's semantics
elements; LLP 0123's attestation work seeds the runtime-identity
element. The five unowned designs 0126 names must each land in an
owner before any `Parity`-by-construction claim: settle-time trust
policy for client-captured `now`/ids (0126 OQ3), the
read-satisfiability artifact (move 6; 0126 OQ4), schema-at-capture vs
schema-at-settle (0126 finding 9 records capture itself as unowned;
LLP 0081, the migration seam's owner, is this RFC's *proposed* home),
speculative/settlement receipt shapes (LLP 0043/0034/0093), and the
tuple itself.
Cheap pin, proposed: "ephemeral state does not sync offline" becomes a
named contract line via an LLP 0013 amendment (0126 OQ8) — the one
decisive rerun win rides that split and it should not remain emergent.

**First slices** — two separately named pilots of the same substrate,
each M-to-L with its own completion boundary, not one slice: *slice
3-jobs* — the CV-9 jobs slice (rolled-back mutation provably
schedules nothing; injected-clock drain), owner LLP 0070, startable
now with the callee-class decision (0121 OQ2) made inside it; and
*slice 3-offline* — option A on the JS/React arm, targeting the
diaries' GAP-row family (cold retained boot, restart-safe queue,
reconnect settlement) for the retainable subset — the scored arms'
protected opaque rows stay non-retainable by design — and gated on
open question 2's arm confirmation.

**Decisions forced.** The callee class for jobs v1 (0121 OQ2); whether
option C ever enters; which client arm carries the first hardened
offline story (0126 OQ1 — this RFC proposes the JS/React arm, the one
the diaries score and LLP 0074 names as the graduation path); the
settle-time trust policy and its owner; the local-first program's
sequencing authority (below, and 0126 OQ7).

### Move 4 — Liveness is a property of facts, not a fee on functions

**The idea.** Keep the evidence boundary — proven push, never reported
push — and remove its felt cost in the two places the diaries actually
paid it. First, finish and *measure* the client trajectory: LLP
0112/0114 generated groups, registered single-commit boot, first-class
hooks (0119 option 3), with the rerun measured through the React
surface for the first time (LLP 0115 §Sequencing 5 — the prior method
drove headless clients, so the gains were structurally invisible).
Second, give search a live path under its own capability id by coarse
re-execution on invalidation (0119 option 4): the matcher arm,
Replace lane, auth obligations, and bounded per-page-rechecked executor
exist, and the named blockers are admission/dispatch seams — that the
remainder is composition rather than invention is the option's
hypothesis, to be proven by its design in LLP 0073's frame, under
per-index subscription/concurrency budgets, with first-page-only
liveness the plausible v1 (option 5's posting-delta precision is a
later refinement of the same delivery model, not a rival). Meanwhile
`full_text_search_v1` stays non-live and says so. Third, soften the
mixed-route register cliff — one ordinary query child should degrade a
group to a gradient, not a cliff (0119 finding 8) — and diagnose
quarantine flicker before remedying it; the blank is the fail-closed
proof of revocation and must not be smoothed away (0119 finding 7).
On the classification itself, this RFC respects 0115's watch item — no
action until the post-CV-11, React-measured rerun scores the boundary
itself — but pre-registers an answer if it triggers, as this RFC's own
judgment: 0119 ranks none of the decomposed variants. The choice is
option 1a — one authored kind with split callable/subscribable
capability facts, scoped per target — on a mechanism assumption 0119
leaves unspecified: the subscribable fact must be minted from a
declaration, never classified from plan shape (which would be option
2's inference). On that assumption 1a erases the authoring decision
at the function-kind surface only — no second kind, no
callable-versus-subscribable fork in what the author writes — while
a declared subscribable-fact input persists elsewhere: this RFC
assumes it lives as the function's manifest-entry capability fact,
minted under the per-target subscription-admission scope 1a already
carries (0119's own 1a shape), not on the authored function surface.
That keeps per-function honest claims and no universal target
claim — the variant this RFC judges cheapest in evidence terms. The
unchosen alternative is 1b (live by default behind an authored escape
hatch), which 0119 notes also preserves an authored non-live fact
without any static inference.

**Fronts.** 0119 in full; CV-11; the reactive half of 0122's coherence
complaint; the client-consumption half of 0117 (typed hooks consume
move 1's contracts).

**What lands where.** LLP 0073 owns live search and its capability id
(0119 OQ2); LLP 0112/0114 own the client surface and the cliff
question (0119 OQ6); LLP 0053 owns the flicker diagnosis lane; the
1a pre-registration is recorded here and in 0115's watch item only —
no owner changes until the trigger.

**First slice.** The live-search design pass in 0073's frame (cursor
decision, budgets, capability id), landed alongside the rerun arm that
consumes the 0114 React surface and a registered 0112 group.

**Decisions forced.** Live-search v1 cursor semantics (0119 OQ1);
capability id shape (OQ2); whether the cliff softening is a 0112
amendment or a v2 profile (OQ6); acceptance of the 1a pre-registration.

### Move 5 — One sealed artifact, actually adopted

**The idea.** The first hour becomes boring by making the runtime one
sealed, attested, self-qualifying artifact — and by making the
published closure the thing Snapback itself uses. Adopters get only
the co-packaged runtime pair (binary plus engine, versioned, digested,
installed atomically — LLP 0123 option 3), qualified at the assembly
boundary by real VM creation, not launch-and-identity checks (0123
finding 7), with static linking for packaged artifacts the live
candidate split (option 5: adopter artifacts static, contributor lane
dynamic) and content-addressed engine selection where dynamic linking
remains (option 4, pending the Ibex-selector adoption question). The
serving process witnesses its own readiness — VM created, one trivial
function executed, verdict on `/health`, refuse-or-loudly-degrade —
but only after a posture-neutral handoff shape is ratified with LLP
0009's owners, because the naive probe spends the one-shot strict-Host
claim and readiness evidence must not weaken the posture it verifies
(0123 option 2's hazard, the review program's highest-value catch).
CV-2/CV-3's persisted receipts remain the contributor lane's truth.
On the adoption side: finish CV-1 exactly as specified (0122 option 1
is the required floor — the closure was public and clean-machine-proven
three days before the matrix still ran on checkout imports, 0122
finding 2); make the starter the front door (option 4), rewrite the
first hour in the installed dialect (CV-13), and land the cheap moves
whose coherence yield is disproportionate — a `types` condition on
every public subpath export (the defect three arms hit independently is
still live), total cleanup, predicate-naming refusals. Declare limits
instead of teaching them by refusal (0123 option 7's three classes),
and make the whole first hour a CI artifact with the mismatched-
framework fixture as a required failing case (option 8). The same
sealed pair double-serves move 3: it is the desktop local-first
carrier — one artifact family for the adopter's server and the app's
embedded runtime.

**Fronts.** 0122 and 0123 in full; CV-1, CV-2, CV-3, CV-13, CV-15; the
runtime-identity element of 0126's execution-identity tuple.

**What lands where.** LLP 0041 owns the closure and the
adopter/contributor lane split declaration (0123 OQ2); LLP 0010 owns
bootstrap qualification and diagnostics; LLP 0030/0031 own the
lifecycle and `/health` readiness block; LLP 0009 owns the host-install
policy any boot-witness shape must go through; LLP 0114 owns the
starter; LLP 0061 owns the guide recomposition (0122 OQ4 — corpus and
page composition, no mechanism change).

**First slices** — three separately named workstreams, not one slice:
*slice 5-qual* — CV-2's bootstrap VM qualification plus the
mismatched-framework regression fixture (already the plan's P0),
startable today; *slice 5-types* — the `types`-condition sweep,
startable today; *slice 5-rebuild* — the CV-1 external workout-arm
rebuild, blocked on the custody decisions (open question 4) and named
separately so the block stays visible instead of averaging into a
bundle.

**Decisions forced.** The npm default-channel gate (0115 OQ5 — the
single highest-leverage decision in this space, 0122 finding 7);
admin-client and test-helper custody (0122 option 6 — CV-1's exit is
unsatisfiable without both); the static-for-adopters build-policy
ratification (0123 OQ3); naming timing — the rename price rises with
every receipt bound to the alias (0122 option 7); and where
`@snapback/app-cli` fits the one-CLI story — a `snapback` subcommand
namespace, a divided-audience peer, or an internal surface not
marketed to app authors (0122 OQ6).

### Move 6 — Bounded profiles are the unit of everything

**The idea.** Declared bounded read shapes are already three things at
once — the matcher's vocabulary, the OCC validator's evidence, and the
retainability rule's admission unit (LLP 0126 finding 7, LLP 0003's
build-once intent). This move makes them the unit of two more: the
relational/aggregate surface and partial replication. Ship in
demand order, smallest first. (1) The sequence-allocation primitive —
a named, transactionally incremented monotonic counter with its
semantic surface mapped (scope identity, gap observability,
idempotency interaction, exhaustion, allocation authority) — has two
demonstrated demand sites and is also the contention primitive 0125's
burst work implicates (LLP 0120 finding 4; LLP 0125 option 5). (2)
Snapshot-batch composition of admitted bounded nodes (0120 option 3a)
gives Relay's `boardView` its single-snapshot multi-child read as a
composite of already-proved parts — with sealing-entirely partial
refusal and a coordinated-cursor answer as the new semantics. (3) The
aggregate shapes (`boardSummary`, Split's ledger) enter only with
their two contracts chosen explicitly: a result-semantics variant
(exact-or-refuse or maintained-exact are the ones that fit an exact
current ledger) and a noninterference shape for protected sources — a
count can disclose rows it does not return, so without that contract a
protected-source aggregate is an evidence regression, not an extension
(0120 findings 8, §Noninterference). (4) For shapes outside every
profile, enforced cumulative examined-entry budgets (option 2a) are
the honest general tier — the declared-budget-plus-runtime-enforcement
form, never the diagnostic-only 2b, which fails constraint 1 as a
tier; captured reads police declared budgets, never replace them
(option 4's verdict). The same profile grammar is then the
read-satisfiability artifact move 3 needs: a handler is locally
executable only if its reads are provably satisfiable from the
retained subset, and the declared bounded shapes are the only
artifacts that can prove it (0126 OQ4). One grammar; relational
parity, sync scoping, and evidence all ride it — and it is the
reviewable alternative to a general query language.

**Fronts.** 0120 in full (CV-8 piece 3); the Relay/Split arms; 0125's
sequence-scan contention; 0126's partial-replication admission and
option B2's declared-shape boundary; 0118's Relay dissolution path.

**What lands where.** The aggregate decision lands in LLP 0080's frame
(its OQ7); multi-parent/composite questions in LLP 0110; the sequence
primitive as its own small owned design (0120 OQ2 — it should not wait
for the aggregate decision); budgets in LLP 0108's family; maturity
mechanics in LLP 0113 — noting the gate: on the 0113 route a new
profile terminates at experimental until CV-8 piece 2's
stable-promotion design exists, so piece 2 precedes piece 3 unless the
0080 direct-to-stable route is ruled still available (0120 finding 9,
OQ7).

**First slice.** The sequence-allocation primitive with its mapped
semantic surface, plus the 3a composite design pass.

**Decisions forced.** Which primitive leads and the first shape
shipped (0120 OQ1 — this RFC proposes the order above); the maturity
route (OQ7); Split's required result semantics (OQ8); the
noninterference shape for the first protected-source aggregate (OQ6);
the anonymous-arm authority gap that made `write-with-activity.v1`
unusable by every workout fixture (OQ5).

## The composition map

How the moves cover the series' headline gaps. "Residual" names what
is deliberately left open, gated, or delegated — not forgotten. Where
a Fronts line says "in full," it claims exactly this: every headline
gap the source's own summary names is either covered by the move or
named in the residual column — never that every source option was
adopted.

| Front | Headline gap (post-review) | Covered by | Deliberate residual |
| --- | --- | --- | --- |
| 0117 type flow | four mechanisms: return inference, structured inputs, omission policy, interior typing | Move 1: A+E (inputs, bulk compression), F (interior), G (omission), CV-5 reference lane | mechanism (a) unimplemented — E compresses declarations, never infers; full inference (B/H) not adopted; infer-then-freeze (C) bridges only if post-A+E measurement still scores bulk as decisive |
| 0118 helpers | designed duplication; both instances same-file | Move 2: 1a + splice + stdlib + drift diagnostic | multi-file imports gated on measured pressure; hermetic package closures deferred by explicit boundary decision |
| 0119 reactive/live search | classification fee; search non-live; register cliff; flicker | Move 4: finish-and-measure 0112/0114, coarse live search under own id, cliff gradient, flicker diagnosis | classification erasure watch-gated with 1a pre-registered; option 5 precision later |
| 0120 relational/aggregation | aggregation + multi-child fan-out + sequence counters, not joins | Move 6: sequence primitive, 3a composite, contracted aggregates, 2a budgets | general query language rejected; maturity route is an author gate |
| 0121 one-off scheduling | primitive designed (0070), unbuilt; inspection unowned | Move 3: CV-9 slice + enqueue-association receipts; Move 1: declared job-status query | hosted one-off blocked-on per 0070; exactly-once not claimed (0121 finding 11) |
| 0122 packaging/coherence | published but unconsumed; five facets | Move 5: CV-1 floor, starter front door, cheap moves, first-hour gate | naming migration timed by author; single-binary pending joint spike; `@snapback/app-cli`'s one-CLI placement open (0122 OQ6); meta-package (0122 option 3) unadopted, its registry probe kept as a measurement gate |
| 0123 runtime readiness | two-artifact coherence; nothing witnesses the serving boundary | Move 5: sealed qualified pair, boot witness (posture-neutral first), CV-2/3 receipts | engine alternatives remain risk analysis; TOCTOU binding open (0123 OQ8) |
| 0124 storage/vector | storage owner stale; vector unowned | the moves' admission pattern (staged, evidence-first, receipted; delivery authorization stays an open axis — 0124 OQ7) applied by new/revived owners — sequenced under LLP 0074, not absorbed into 0115 | V3 embedding pipeline later by 0019's sequencing; external stores earn admission late |
| 0125 conflicts | remainder: rejection unions, failure-shape split, wide-409 taxonomy, burst | Move 1: unions as contract variants; Move 3: retry-as-evidenced-contract; Measurement: burst profile | wire-shape unification and the unified app-visible conflict taxonomy (0125 option 1/OQ1 — the wide-409 contract) both delegated to 0094/0095 for dated decisions; partial-effect distinction preserved in any unification |
| 0126 local-first | decisive bakeoff GAPs; rerun measured nothing | Move 3: A, then D's two parallel ladders (shared IR rung; desktop sidecar WASM-independent), riding move 2 (closed graph), move 5 (sealed artifact), move 6 (replica admission) | CRDT core and raw replica rejected; client mutators (C) conditional; mobile/WASM/in-process behind named spikes; protected-opaque retention out by design (0053; 0126 OQ2); offline search unowned (0126 OQ6); delta-resume consumer a named unbuilt prerequisite; option F a proposed successor-Plan rider (§Sequencing 5) |

The composition is the point — with its couplings named for what they
are. Hard prerequisite: move 2 is ground for move 3. Shared artifact:
move 5's artifact is move 3's desktop carrier and the tuple's
runtime-identity element; move 1's grammar carries move 3's receipts
and move 4's typed consumption. Proposed answer: move 6's profiles
are move 3's replica-admission vocabulary — this RFC's answer to 0126
OQ4, which poses it as a question. Shared principle only: move 6's
profiles and move 4's matcher ride the same declared-bounded-shape
family the live matcher, OCC validator, and retainability rule
already consume (0126 finding 7), but no single shared descriptor
artifact exists yet — minting the concrete mapping is move 6 design
work, and until it lands the move 6 → move 4 line is an architectural
rhyme, not a dependency. No move is bespoke to one front, and the
moves cover every front's headline gaps outside 0124 — narrowed by
the exceptions the 0126 residual cell names: offline search needs an
owner and a mechanism the set does not contain (0126 OQ6); the
version-based delta-resume consumer is designed (LLP 0008) but
unbuilt, a prerequisite no move ships by itself; option F's
export/restore lane is a successor-Plan rider, not a move; and
protected-opaque retention is not covered because it is excluded by
design (LLP 0053; 0126 OQ2).

## What this deliberately does not do

The consistently least-promising options across all ten fronts are the
ones that erase a boundary to erase its cost (LLP 0116 finding 5).
This RFC rejects them affirmatively, so their absence reads as a
decision rather than an omission:

- **No full TypeScript-inference authoring.** Permissive inference (0117
  option B) violates both governing constraints; even the fail-closed
  form (H) re-litigates LLP 0108's authority model and makes contract
  identity a function of compiler version. Any future re-litigation
  scores itself against H, not B (0117 finding 7).
- **No open module imports.** The ambient form is the clearest
  candidate constraint-1 violation in the corpus (0118's own hedge) —
  the evidence loss is structural, not incidental (0118 option 4).
  The hermetic variant is bounded, not dismissed, and waits for
  third-party pressure the diaries do not contain.
- **No general query/graph language.** Its honest version is "profiles
  and their composition, iterated, with an algebra" — sequenced after
  them, never instead of them; the unbounded version is a worse Convex
  (0120 option 3).
- **No live-by-default erasure.** The classification is a documented
  evidence choice (LLP 0074); erasing it requires a replacement theory
  of what a liveness claim means. The watch item's trigger condition
  stands; the only pre-registered answer is the 1a hybrid — this
  RFC's own pre-registration, informed by 0119 finding 6, which
  selects neither hybrid.
- **No capture as sole evidence.** Post-hoc read capture polices
  declared budgets; as the evidence itself it is unfalsifiable before
  production traffic (0120 option 4).
- **No cron-ledger job evidence.** Sweeper receipts where job receipts
  belong would hide per-job failures inside successful sweeps (0121
  option 2 case 2 — barred).
- **No CRDT core, no mesh authority.** The field's own retreats
  corroborate server authority; merge cannot refuse, and refusal is
  load-bearing (0126 approach 1; LLP 0074's boundary). A text-CRDT
  sidecar stays conditional on the rich-text reference app (0126 OQ9).
- **No raw client SQL replica as a default lane.** B1 bypasses the
  authorized-result unit, egress validation, and read-set capture; only
  the governed, facade-read B2 shape composes (0126 option B).
- **No simulated reactivity, no relabeled freshness.** Hint-driven
  re-issue is client convenience over an ordinary query and must be
  presented as exactly that (0119 option 6; LLP 0073's pin).
- **No permanent silent nonclaims on storage and vector.** The nonclaim
  discipline is correct and stays; choosing deferral as a *destination*
  concedes the Partiful/Research-Room class and must be a dated, owned
  decision, never a lapse (0124 options S4/V5).

## Sequencing

LLP 0115 remains the sequencing authority. This RFC proposes that 0115
absorb the following in a v0.5, and nothing before the author agrees:

1. **The move structure as the board's coherence layer.** The moves map
   onto the existing tranches rather than replacing them: move 5 is
   Tranche A plus CV-1's adoption half and Tranche E's CV-13/CV-15 —
   CV-14 is claimed by no move and rides its custody trigger exactly
   as 0115 specifies; move 1 is Tranche B (CV-4a/4b, CV-5, CV-6) plus
   its proposed additions; moves 2, 6, and 3's jobs half are Tranche C
   (CV-7, CV-8, CV-9); move 4 is Tranche D (CV-11, with CV-10/CV-12
   riding as specified). Each CV item keeps its owner and analysis
   pointer; the move names the mechanism it shares with its siblings.
   Move 5's sealed-artifact components beyond the board's scope —
   adopter-only co-packaging, assembly-boundary qualification, the
   static-for-adopters policy, the posture-neutral boot witness — are
   not sequenced by CV-1/2/3; this RFC proposes they proceed under
   their named owners (LLP 0041, 0010, 0030/0031, 0009) with 0115
   holding cross-references, not work items.
2. **Refinements to standing items, from the series' verified
   findings.** CV-7: decision order is graph scope then emission;
   the same-file slice satisfies the exit as written, which bears on
   its L sizing (0118 findings 7/10). CV-8: piece 2 (the
   stable-promotion design) gates piece 3 on the 0113 route (0120
   finding 9); the sequence-primitive-first ordering is *not* in this
   verified list — it is 0120's labeled lean (finding 4) and this
   RFC's proposal, riding open question 3. CV-9:
   the paved-default-queue conditional and the inspection-surface
   question travel with the slice ticket (0121's proposal). CV-6:
   strictness is sequenced after A+E per 0117's ordering dependency.
3. **OQ6 (unowned remainders): absorb, with one delegation.** Add a
   CV item for declaration-closed rejection unions riding the CV-4-era
   grammar work (owner: LLP 0108 family; 0125 option 2), and a small
   CV item for the typed-interior pilot (0117 option F). Delegate to
   LLP 0094/0095, for dated decisions, both the action/mutation
   wire-shape choice among 0125's option-3 paths (preserving the
   partial-effect distinction) and 0125's wide-409 remainder — the
   unified app-visible conflict taxonomy (0125 option 1; its OQ1
   already names the same owners: 0094's envelope or a 0095
   client-conformance rule). Burst profiling becomes a rerun
   precondition (below), not a CV item.
4. **OQ7 (product breadth): keep 0115's scope fixed; start the owners
   now.** Revive LLP 0044 (or supersede it by a fresh Spec — 0124 OQ1)
   with the local store first (per-request-authorized delivery is its
   natural model, but the delivery-authorization axis stays 0124
   OQ7's open decision) and the object-store seam designed; mint the
   vector owner beside LLP 0073 in its staged-adapter idiom —
   exact-k-NN-first is this RFC's labeled proposal, and the
   exact-versus-ANN base-profile order is 0124 OQ3's reserved
   adjudication, routed to open question 8 rather than assumed, with
   the float-pinning question named either way (0124 OQ2/OQ3). Both
   proceed under LLP 0074's umbrella in parallel with Tranche A (0124
   OQ5's parallel answer), because the blocked app classes do not
   wait on the parity tranches — which requires this v0.5 to amend
   §Sequencing 1's "Tranche A first, and alone" sentence with an
   explicit breadth carve-out rather than contradicting it silently.
5. **Local-first: a successor Plan, not a 0115 tranche.** 0115's board
   deliberately contains no offline item and its exit is the parity
   rerun; widening it would couple two programs with different exit
   criteria. The local-first program (move 3's staging: option A,
   then option D's two parallel platform ladders, plus the five
   owner-landings) gets its own sequencing document under 0126 OQ7's
   answer, cross-gated with 0115 where the substrate is shared: move
   5's sealed artifact, move 2's closed graph, move 6's profile
   vocabulary. The successor Plan also carries 0126 option F — the
   explicit-sync backup/export/restore lane — as a proposed cheap
   rider: evidence-positive, foreclosing nothing, packaging
   properties that are already true ("near-zero" stays a hypothesis
   until the surface is sized, per 0126). 0115 gains a
   cross-reference, and LLP 0074's graduation-path claim gets its
   consumer instead of a restatement.
6. **Rerun scope (OQ4), proposed.** Keep the seven contracts unchanged
   for diary-to-diary comparability; the new mechanisms are scoreable
   inside them (Split's splits, Dispatch's one-off path, Relay/Split
   aggregates, Pantry's search, Campfire through the React surface).
   Add offline/cold-boot scenario scoring as a new dimension on
   existing arms — the bakeoff generation scored it decisive and the
   rerun measured none of it (0126 finding 1) — and at most one new
   contract for product breadth once OQ7's owners ship something
   scoreable.
7. **The reactive watch item carries the 1a pre-registration.** Amend
   0115's reactive-by-default watch item to record move 4's
   pre-registered answer (option 1a, on the declared-fact mechanism
   assumption stated there), trigger condition unchanged — so the
   pre-registration lives where move 4's "what lands where" says it
   does.

## Measurement

The Research documents were disciplined about what is hypothesis; this
RFC inherits their gates rather than asserting past them.

**The successor rerun** (LLP 0115 §Sequencing 5) stays the program's
measurement: same contracts, both backends, aggregate serial
verification — with at least one arm consuming the 0114 React surface
and a registered 0112 group, plus the offline-scored dimension above.
Two preconditions from the series: a normalized-profile burst benchmark
before any performance claim (0125 option 5; the last numbers are stale
and machine-confounded), and option A's diary-grade offline acceptance
on the JS/React arm (0126's evidence gate for the hardening claim).

**Named empirical gates, by move:**

- *Move 1:* the E-compressible fraction of measured contract bulk —
  measurable from the rerun app sources before any implementation
  (0117 OQ7); whether severity, cost, or ordering caused the two
  shipped degraded contracts (0117 OQ6, tested by the rerun); ingress
  validation's runtime cost budget (0117 OQ3).
- *Move 2:* per-invocation evaluation latency and memory as a function
  of module size and helper-duplication factor, against the ~3.9 ms
  fresh-invocation baseline (0118 OQ1); whether helper pressure grows
  with app size (0118 OQ6 — sizes the multi-file mechanism's urgency).
- *Move 3:* interactive latency for `availableAt = now` jobs and the
  enqueue-commit wakeup (0121 OQ6); the deterministic-drive
  reproducibility bar and identity/randomness seam (0121 OQ9); the
  IR-evaluator sizing spike, client-store footprint, replica
  hydration, and local-execution latency — nothing in the local-first
  corpus is measured (0126 finding 11); the mobile spike with named
  success criteria before any mobile claim (0126 OQ10); the WASM
  assessment before the browser story is pinned (0126 OQ5).
- *Move 4:* live-search wake amplification and fanout under write
  load, type-ahead subscription churn, first-page re-execution cost,
  hint-channel cost, and the flicker diagnosis on Diary 0030's app as
  declared (0119 OQ5/OQ7); how much of the felt gap the React surface
  closes (0115 §Sequencing 5's measurement).
- *Move 5:* LLP 0122's eight empirical questions — registry-name
  probe, cold-install wall clock, strict typecheck and browser bundle
  from published artifacts only, subpath declaration resolution, the
  single-binary spike joint with 0123, provenance survival under
  consolidation or rename, docs-only discoverability, and runtime
  recovery after consolidation; the first-hour CI job's cost and
  cadence (0123 OQ6); the rsync-mtime missed-relink hypothesis
  confirmed or refuted inside CV-2 (0123 OQ1).
- *Move 6:* the sequence primitive's contention improvement — a named
  empirical expectation, not a result, including the hot-key
  serialization it introduces (0120 option 5); whether read budgets
  are generation-time validatable against builder calls or
  runtime-enforced only (0120 OQ3); how often captured-read conflicts
  survive reservation serialization (0125 OQ6).
- *Product breadth:* the vector float-pinning strategy and the
  exact-to-ANN crossover bound (0124 OQ3).

## Dated amendment — 2026-08-13: scoped familiar-profile exception

This RFC's accepted synthesis and its Move-1/1a decisions continue to govern
the canonical authoring and client surface. LLP 0252 and its executable API
Spec, LLP 0253, authorize one narrower exception: the Experimental
`snapback-familiar-ts-v1` profile may publish the measured familiar aliases
defined there, over the same canonical engine and lifecycle owners, for the
bounded comparison period and stop rule those documents define. This note does
not generalize profile proliferation, respell the canonical surface, or weaken
any evidence gate in this RFC; it makes the scoped exception discoverable from
the accepted synthesis itself.

## Open questions

The author decisions this synthesis forces, in rough order of leverage:

1. **The npm default-channel gate** (0115 OQ5; 0122 option 5): 0111's
   hosted-serialized `latest` or 0074's parallel gate. Move 5's
   packaging-shape exits — CV-1's default-channel half, the starter
   front door, naming — and the rerun's published-channel mode wait
   on it; CV-2/CV-3/CV-13/CV-15 exits do not.
2. **The local-first program's authority and first arm** (0126
   OQ1/OQ7): confirm the successor-Plan shape, the JS/React arm as
   first carrier, the two-parallel-ladder staging with this RFC's
   IR-rung-first resourcing proposal — and whether option C (client
   mutators) is ever admitted as a bridge.
3. **The aggregate lead and the maturity route** (0120 OQ1/OQ7):
   sequence primitive first, then 3a versus the third profile versus
   maintained aggregates — and whether the 0080 direct-to-stable act
   remains available or 0113's qualification route is now mandatory,
   which gates when anything in move 6 stops being bypassable.
4. **Custody of the admin client and test helpers** (0122 option 6;
   LLP 0041's open questions): CV-1's exit is unsatisfiable until both
   are decided.
5. **CV-6 strictness** (0115 OQ3), decided *after* A+E land, per the
   ordering dependency — and whether the rerun's severity-causality
   measurement changes the answer.
6. **The helper-class cutline — ANSWERED 2026-08-02** (0118 OQ7):
   context-reader helpers are admitted in the first mechanism (required to
   satisfy both diary instances), and declared reads/writes remain evidence,
   not enforced ceilings. Ceiling enforcement is a separate later decision.
   Source: `issues/20260802-author-decision-packet.md`.
7. **Confirmation of the OQ6 absorb/delegate split** proposed in
   §Sequencing 3, including which document owns the enqueue-receipt
   association shape (0121 OQ4).
8. **Product-breadth owners and the vector base profile** (0115 OQ7;
   0124 OQ1/OQ2/OQ3/OQ5): revive versus supersede LLP 0044; where the
   vector design lives; parallel start confirmed; and the exact-k-NN
   versus engine-native-ANN base-profile order — 0124 OQ3's reserved
   adjudication, on which exact-first is this RFC's labeled proposal,
   not an inherited answer.
9. **Naming** (0122 OQ3): whether and when to pay the scope-migration
   price — it rises with every receipt bound to the current alias.
10. **The settle-time trust policy** for client-captured `now` and ids
    under local execution, and its owning document (0126 OQ3) — the
    first unowned design move 3 hits once option A lands.

What can start today under the decisions now made, per move: move 1's
CV-4a+CV-5 slice; move 2's context-reader-admitting first mechanism
(item 6 is answered; declared reads/writes stay evidence); move 3's jobs slice
(0121 OQ2 decided inside it);
move 4's live-search design pass and rerun arm; move 5's slices
5-qual and 5-types; move 6's sequence-primitive and 3a design passes
(their shipping order is item 3's call). What blocks what, honestly:
item 1 blocks move 5's packaging-shape exits and the rerun's
published-channel mode; item 4 blocks slice 5-rebuild and with it
CV-1's exit; item 2 gates move 3's displaced-in-space half from arm
choice through exit; item 3 gates when move 6's surface stops being
bypassable; item 5 is move 1's own deliberately post-A+E completion
decision; item 6 now admits move 2's context-reader first slice without
adding table-ceiling enforcement;
item 7 gates no first slice — it confirms §Sequencing 3's absorption
and picks the receipt-association owner, a landing choice the jobs
slice does not wait on; item 8 gates the product-breadth starts of
§Sequencing 4, which sit outside the six moves by design, and no
move slice; item 9 gates nothing until the author elects to pay it —
only its price moves, rising with every receipt bound to the alias;
item 10 joins item 2 on move 3's displaced-in-space exit — it is one
of the five owner-landings move 3 requires before any
`Parity`-by-construction claim, and the first one option A's landing
forces. The program can still start where the evidence is already
sufficient and decide where it is not — which is the posture the
whole corpus has been building toward.
