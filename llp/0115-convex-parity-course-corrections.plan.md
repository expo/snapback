# LLP 0115: Convex-parity course corrections

**Type:** Plan
**Status:** Draft
**Systems:** Competitive evaluation, Developer experience, Authoring, Application data API, Code generation, Runtime, Bootstrap, Packaging, Search, Relational queries, Scheduled work, Client integration, Documentation, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Related:** LLP 0004, LLP 0010, LLP 0028, LLP 0061, LLP 0062, LLP 0073, LLP 0074, LLP 0076, LLP 0079, LLP 0080, LLP 0086, LLP 0101, LLP 0102, LLP 0108, LLP 0110, LLP 0111, LLP 0112, LLP 0113, LLP 0114, Diary 0032–0039

## Summary

The 2026-07-30 current-main rerun of the seven-app Snapback × Convex matrix
(Diary 0039, evidence commit `45d2455d` over Snapback revision `01e94173`)
scored roughly **55/45 in Convex's favor** — four slight Convex wins, one large
Snapback win (ephemeral presence), and two near ties. That is a major
improvement over the first bakeoff, because current main already shipped the
gaps that dominated the earlier result: indexed full-text search, colocated
inline handlers, exact recursive result contracts, indexed
range/order/take pagination, table-scoped relation IDs, and manifest-only
generated custody.

This Plan sequences the work that closes the remaining gap. The diary's own
recommended order is adopted as the tranche structure:

**external install/runtime qualification → structured inputs and helper
composition → aggregate/children/scheduling primitives → live and broader
portable search → guide/review polish.**

The target is not to clone Convex. Per LLP 0074, the target is to make the
parts users feel immediately — a boring first hour, natural input typing,
reactive defaults, composable scheduling — competitive, while preserving the
properties the rerun confirmed as real differentiators: first-class ephemeral
state, fail-closed evidence boundaries, deterministic acceptance, and explicit
authority/capability contracts. Every work item below carries the constraint
that closing a DX gap must not silently discard the corresponding evidence.

## Governing constraints

1. **No evidence regression.** The rerun's Snapback wins — Cursor Garden's
   zero-durable-amplification presence, commit-version proofs, capability
   nonclaims, named fail-closed diagnostics — are load-bearing. A work item
   that improves ergonomics by weakening an evidence boundary is out of scope.
2. **Honest capability claims only.** Search stays declared non-live until a
   real reactive implementation exists (CV-11); hosted/offline/native-FTS
   targets stay nonclaims until they have their own evidence (CV-12). This is
   LLP 0073's existing posture and it held up well in the rerun.
3. **Owning documents stay owners.** This Plan does not respecify inline
   handlers (LLP 0108), relational profiles (LLP 0080/0110), search
   (LLP 0073), scheduling (LLP 0028), or packaging/publication
   (LLP 0062/0111/0113). Each work item names its owner; substantive design
   lands there (or in a new owned Spec), not here.
4. **The evidence graph is not the problem.** The rerun measured Snapback's
   full generated graph at ~7× Convex's lines, but authored size is tied and
   committed custody is now *smaller* than Convex's committed generated tree.
   The goal is fast generation, good semantic diffs, and consumers never
   needing to read internal projections — not shrinking the graph.

## Retired gaps — do not re-litigate

The first bakeoff's highest-profile complaints are fixed on current main and
must not be carried into new backlogs (Diary 0039 §What current main fixed):

- full-text search (shipped, used by the Pantry arm: schema-level index,
  `defineSearchQuery`, portable AST, rank/highlights/cursors);
- declaration/handler duplication (inline form shipped, used by five arms);
- unknown computed outputs (exact recursive result contracts shipped);
- committed generated-tree explosion (manifest-only custody shipped);
- shared pagination (indexed range/order/take path, used by Campfire);
- cron inspection ambiguity (authenticated admin inspection matches guide);
- binary/checkout identity mismatch (both identify the same commit).

Relational composition is *partly* improved — branded IDs and a narrow stable
relational query exist — and the remainder is CV-8, not a rediscovery.

## Status board

| Item | Title | Tranche | Owning doc(s) | Size | State |
| --- | --- | --- | --- | --- | --- |
| CV-1 | Public package/starter loop proven from a clean repo | A (P0) | 0062, 0111, 0113, 0114 | L | Open |
| CV-2 | Bootstrap qualifies an armed handler VM | A (P0) | 0010 | M | Open (issue filed 2026-07-30) |
| CV-3 | One recovery model for doctor/bootstrap/harness | A (P0) | 0010 | M | Open |
| CV-4 | Structured collection validators for inputs and stored fields | B (P1) | 0004 (+ new Spec) | L | Open |
| CV-5 | Typed portable search AST in introspection | B (P1) | 0073 | S | Open |
| CV-6 | Precise mutation results as the paved default | B (P1) | 0108, guide | S | Open |
| CV-7 | Safe helper reuse for inline handlers | C (P1) | 0108 follow-on | L | Open |
| CV-8 | Stabilize children/aggregate/activity relational shapes | C (P1) | 0080, 0110, 0113 | L | In flight (0110 in Review) |
| CV-9 | Transactional one-off scheduling (`runAfter`-class) | C (P1) | 0028 extension | M | Open |
| CV-10 | Numeric canonicalization at the search digest boundary | D (P1) | 0073 | S | Open (issue filed 2026-07-30) |
| CV-11 | Live/re-executing search story | D (P1) | 0073 + 0112/0114 | L | Open |
| CV-12 | Portable filter and target expansion, evidence-gated | D (P1) | 0073 | M | Open |
| CV-13 | Inline handlers primary in "Your first backend" | E (P2) | guide (0061) | S | Open (guide-gap issue filed 2026-07-30) |
| CV-14 | Semantic review summary for dense manifests | E (P2) | custody owner (confirm at start; 0062 family) | M | Open |
| CV-15 | Resolve `unpinned` harness wording for exact binaries | E (P2) | 0010 harness | S | Open |

## Work items

### Tranche A — P0: make external adoption and runtime readiness boring

The rerun's largest first-hour confidence cost was not authoring — it was the
framework/runtime edge: a native-artifact incident where link and server
launch both passed while `ex_hermes_create_no_eval()` refused the first
application function, plus checkout-relative imports into the Snapback source
tree. Convex's biggest structural advantage ("installed, coherent product
loop") lives here, and no authoring improvement matters if the first hour is
untrustworthy.

#### CV-1. Prove the public external package/starter loop

**Evidence.** All fourteen rerun arms import codegen, clients, admin clients,
and test helpers through paths into a sibling Snapback checkout and invoke its
binary directly (Diary 0039 P0-1). Convex's arms install from the public
ecosystem. LLP 0074 already carries npm publication as a parallel gate;
LLP 0111 defines the packaged-CLI product journey; LLP 0113 defines
publication authority; LLP 0114 scopes a clean-install React starter.

**Work.** Drive the existing owners to one demonstrated loop: from a clean
repository with no sibling checkout, install the published package(s) and
starter, generate bindings, run a real local backend, and pass acceptance.
Then make the workout harness itself support an install-from-published-channel
mode so future matrix runs exercise the public path, not the source tree.

**Exit.** (1) At least one full workout arm (Campfire or Streak Lab) rebuilt
in a clean external repository using only published artifacts, acceptance
green. (2) The matrix harness gains a published-channel mode. (3) No
checkout-relative import remains in that arm's authored code.

#### CV-2. Qualify a real armed handler VM during bootstrap

**Evidence.** Bootstrap's link and launch checks passed while the actual
handler VM creation failed at first use
(`issues/20260730-bootstrap-smoke-does-not-create-armed-handler-vm.md`).
Presence of files plus an exact git stamp did not prove native artifact
coherence.

**Work.** Extend the LLP 0010 bootstrap contract: after the final framework
selection, bootstrap must create and destroy the actual armed handler VM
(execute at least one trivial function through the real no-eval path), and
bind binary and framework digests into a single readiness receipt. Failure
gets a stable `SNAPBACK_*` diagnostic in LLP 0010's registry.

**Exit.** A regression fixture that reproduces the rerun's
mismatched-framework state fails bootstrap with the new named code instead of
passing; the readiness receipt binds both digests; `scripts/ibex-doctor`
reads the same receipt.

#### CV-3. One recovery model across doctor, bootstrap, and harness

**Evidence.** The rerun incident required manual native-artifact diagnosis and
an ordering-sensitive relink before JS handlers ran (Diary 0039 P0-3). Doctor,
bootstrap, and the acceptance harness currently reason about runtime health
with different evidence.

**Work.** Converge all three on the CV-2 readiness receipt: digest-based
coherence checks, one shared diagnostic vocabulary, and either an automated
relink or a doctor-emitted exact recovery sequence for the known
ordering-sensitive case.

**Exit.** Doctor detects the CV-2 fixture's incoherence read-only and names
the recovery; harness preflight refuses to run acceptance against an
incoherent runtime with the same code.

### Tranche B — P1: finish input and search type fidelity

#### CV-4. Structured collection validators for arguments and stored fields

**Evidence.** Convex's `v.array(v.object(...))` validates and types Split
Ledger's split vector at the mutation boundary; Snapback's `v.array` is
result-contract-only, so mutation arguments fall back to `v.json()` plus
manual handler validation (Diary 0039 §5, P1-4). This was the single most
repeated authoring loss across the matrix.

**Work.** Extend the application data API (LLP 0004) so structured collection
validators — arrays of objects, nested objects, unions where already
supported — work at mutation/action argument boundaries and for stored fields,
with the same generated client types and the same fail-closed refusal
semantics as scalar validators. This is a new owned Spec (claim the next
number at drafting time); the result-contract side (LLP 0108) is prior art for
the type-flow plumbing.

**Exit.** Split Ledger's split vector and Pantry's structured fields expressed
without `v.json()`; generated client types match; invalid nested payloads
refuse with a precise path-carrying diagnostic; the rerun arms updated.

#### CV-5. Type the portable search query AST

**Evidence.** The client has a concrete search AST, but provider introspection
publishes the search argument as `unknown` (Diary 0039 P1-5).

**Work.** Publish the precise AST type through LLP 0073's introspection
surface and generated bindings, consistent with the portable fixtures.

**Exit.** Introspection and generated client types agree with the AST
fixtures; no `unknown` remains at the search argument boundary.

#### CV-6. Make precise mutation results the paved default

**Evidence.** Cursor's `updateNote` and Pantry's `addRecipe` still shipped
omitted/degraded result contracts even though codegen can explain the repair
(Diary 0039 P1-6). LLP 0108 already treats omission as an explicit degraded
`unknown` contract.

**Work.** Make the degradation loud and self-repairing: codegen emits the
suggested exact contract in the diagnostic; guide pages show the exact form
first. Consider (owner's call, in LLP 0108) a per-app strictness toggle that
refuses omitted contracts outright.

**Exit.** A newly authored mutation without a result contract produces a
diagnostic containing a paste-ready repair; the two known offenders carry
exact contracts in the next rerun.

### Tranche C — P1: generalize composition without losing evidence

#### CV-7. Safe helper reuse or bounded module bundling for inline handlers

**Evidence.** LLP 0108 v1 deliberately narrowed inline handlers to statically
self-contained expressions. The cost showed up immediately: Streak Lab's
calendar helper and Campfire's indexed-read helpers are duplicated between
query and mutation handlers (Diary 0039 §1, P1-7). Convex shares ordinary
TypeScript helpers naturally.

**Work.** Design the LLP 0108 follow-on: a bounded, content-addressed way for
inline handlers to share pure helper modules — explicit imports into the
closed module graph, never `Function.prototype.toString()` capture, never
runtime inference, never ambient checkout access. The closed-graph and
no-executable-authority-from-reflection invariants of LLP 0108 are
non-negotiable inputs.

**Exit.** Streak Lab's calendar helper written once and used by both its query
and mutation, with the module graph still closed and content-addressed, and
the LLP 0108 refusal properties preserved under its existing adversarial
fixtures.

#### CV-8. Stabilize common children, aggregate, and activity shapes

**Evidence.** Relay Board's one-board/many-columns/many-cards aggregate and
Split Ledger's ledger derivation still use imperative multi-query handlers
because the stable relational surface is intentionally narrow; the more
fitting `bounded-children.v1` and `write-with-activity.v1` profiles exist but
are experimental and were correctly not claimed (Diary 0039 §2, §5, P1-8).

**Work.** Drive LLP 0110's two profiles through LLP 0113's qualification and
publication path to stable, then decide the multi-table aggregate question in
LLP 0080's frame: either specify a third bounded aggregate profile that covers
the Relay/Split shapes, or document the imperative pattern as the endorsed
answer with its evidence story. Do not widen the stable surface by
inference — every promoted profile keeps exact arguments, results, dependency
ceilings, and capability facts.

**Exit.** Relay Board and Split Ledger rebuilt on stable profiles (or on the
explicitly endorsed pattern), with no experimental capability claimed and no
imperative N+1 handler where a profile now fits.

#### CV-9. Transactional one-off scheduling

**Evidence.** Convex's `ctx.scheduler.runAfter(0, ...)` transactionally
schedules one-off durable work with almost no ceremony; Snapback's cron
surface (LLP 0028) has the stronger deterministic recurring-work proof but no
equally obvious one-off primitive (Diary 0039 §7, P1-9).

**Work.** Extend LLP 0028 with a `runAfter`-class primitive: scheduled
atomically within the enclosing mutation's transaction, durable, observable
through live queries and the authenticated inspection surface, and covered by
the same forced-tick test seam so acceptance never sleeps.

**Exit.** The Dispatch arm's one-off path uses the new primitive; a rolled-
back mutation provably schedules nothing; the run ledger and forced-tick
evidence cover one-off work exactly as they cover recurring work.

### Tranche D — P1: mature portable search

#### CV-10. Fix numeric canonicalization at the search digest boundary

**Evidence.** An integral `minutes` accepted under `v.number()`/Real and
included in stored search fields failed authoritative digest recheck as
`SNAPBACK_SEARCH_INDEX_CORRUPT`; declaring `v.integer()` stabilized it
(`issues/20260730-search-real-integral-digest-corruption.md`). An accepted
ordinary value must never surface as opaque index corruption.

**Work.** In LLP 0073's digest contract: canonicalize accepted numeric values
consistently between storage and index digesting, or refuse the declaration
early with a precise model diagnostic naming the field and the fix.
`SNAPBACK_SEARCH_INDEX_CORRUPT` must become unreachable from accepted values.

**Exit.** A regression fixture with Real-typed integral search fields passes
(or refuses early with the new named diagnostic); the Pantry arm's original
schema no longer produces corruption.

#### CV-11. A live/re-execution story for search

**Evidence.** Convex's indexed search composes with its reactive query model;
Snapback search v1 is honestly non-live, and Pantry needed an extra check just
to prove that honesty (Diary 0039 §6, P1-11).

**Work.** Design reactive search in LLP 0073's frame, composing with the live
query and query-group surfaces (LLP 0112/0114) rather than inventing a
parallel channel. Until it ships, the non-live declaration stays exactly as
is — no simulated reactivity, no capability drift.

**Exit.** Either a shipped live-search path with the same rank/highlight/
cursor contract and an eviction/invalidation evidence story, or a dated
LLP 0073 decision recording why non-live remains the claim.

#### CV-12. Expand portable filters and targets, evidence-gated

**Evidence.** Pantry's filter combination needed a client-side numeric
projection because portable filters are equality-only; hosted, offline, and
additional database targets remain nonclaims (Diary 0039 P1-12).

**Work.** Bounded range filters first, as the diary identifies them as the
first practical gap. Each new target or filter class lands only with its own
acceptance evidence, extending — never diluting — the portable contract.

**Exit.** Pantry's numeric filter expressed portably; capability claims still
match exactly what acceptance proves.

### Tranche E — P2: guide and review polish

#### CV-13. Make inline handlers primary in "Your first backend"

The intent-specific pages are current, but the getting-started page still
front-loads legacy `handlers.mjs`
(`issues/20260730-guide-gap-first-backend-front-loads-legacy-handlers.md`).
Rewrite the first-backend path around the inline form per LLP 0061's
conventions. **Exit:** guide checks green; the legacy form documented as the
compatibility lane it is.

#### CV-14. Semantic review of dense manifests

Manifest-only custody fixed source-control volume, but a reviewer facing an
85 KiB `artifacts.json` diff needs a concise semantic change summary
(operations added/removed, contracts changed, capabilities moved) over the raw
JSON (Diary 0039 P2-14). Confirm the custody owner (LLP 0062 family) when this
starts. **Exit:** a diff of the matrix's review manifests renders a summary a
reviewer can act on without reading raw JSON.

#### CV-15. Resolve `unpinned` harness wording

The harness labeled an explicitly configured exact binary `unpinned` even
though commit evidence was exact (Diary 0039 P2-15). Rename or split the label
so exact-but-explicitly-configured provenance is not misread as weak.
**Exit:** the label distinguishes the cases; harness docs updated.

## Sequencing

1. **Tranche A first, and alone.** External install and runtime readiness gate
   the credibility of everything else; the diary ranks them P0 and they are
   also prerequisites for running future matrix arms against published
   artifacts. CV-2 → CV-3 are ordered (the receipt exists before the tools
   converge on it); CV-1 proceeds in parallel through its existing owners.
2. **Tranches B and C in parallel after A.** They touch different owners
   (data API/search typing vs. handler composition/relational/scheduling).
   Within C, CV-8 continues immediately — LLP 0110 is already in Review — but
   its *stable* promotion waits on LLP 0113's path.
3. **Tranche D after CV-5.** CV-10 is a small correctness fix and may land
   any time; CV-11/CV-12 build on the typed AST.
4. **Tranche E is continuous.** CV-13 and CV-15 are small and may land
   immediately; CV-14 rides the next custody change.
5. **Rerun checkpoint.** After Tranches A–C land, rerun the seven-app matrix
   by the Diary 0032–0039 method (same contracts, both backends, aggregate
   serial verification) and write the successor diary. Tranche D/E completion
   is not gated on the rerun, but the rerun is the plan's measurement, not an
   optional extra.

## Exit criterion for the plan

The plan is done when a full matrix rerun shows:

- the four "slight Convex edge" arms (Streak Lab, Campfire, Split Ledger,
  Pantry Search) each become a near tie or a Snapback win on the diary's own
  scoring frame, with the specific mechanism named (CV-4/6/7 for authoring,
  CV-8 for aggregates, CV-9 for Dispatch's one-off path, CV-11/12 for search);
- Cursor Garden's decisive win and every evidence property in §Governing
  constraints are preserved;
- the rerun's Snapback arms build from the published channel (CV-1), and no
  first-hour runtime incident class from Diary 0039 recurs (CV-2/3); and
- the successor diary's recommendation paragraph no longer needs the clause
  "still exposes framework/runtime edges."

An honest 50/50 with intact differentiators satisfies this Plan; the
larger strategic frame (hosted profiles, commercial surface, Expo
distribution) remains LLP 0074's and is not re-scored here.

## Watch items (no action now)

- **Reactive-by-default queries.** Convex's deepest structural advantage is
  that ordinary queries are reactive without a separate live classification.
  Snapback's explicit live boundary is a deliberate evidence choice
  (LLP 0074); LLP 0112/0114's generated query groups are the current answer.
  Revisit only if the rerun still scores the boundary as a loss after CV-11
  and the query-group surface ship.
- **Graph generation speed and consumer-facing projections.** The 7× generated
  graph is fine while generation is fast and consumers never read internals;
  watch for either assumption failing.
- **Convex anonymous local mode maturing out of beta** — the port-coordination
  friction noted in the rerun is the one operational edge Convex still shows
  locally; if it disappears, Tranche A's bar rises.

## Open questions

1. **CV-4 spec placement.** New numbered Spec versus a reviewed amendment to
   LLP 0004 (which is still Draft): does the input-validator surface deserve
   its own review loop, or should it ride the data API RFC's eventual
   acceptance?
2. **CV-9 semantics.** Does `runAfter`-class work reuse the cron run-ledger
   identity model, or does one-off work get its own receipt family? (Owner:
   LLP 0028 extension.)
3. **CV-6 strictness.** Should omitted result contracts remain a loud
   degradation, or become a refusal behind a per-app strictness toggle?
4. **Rerun scope.** Should the post-A–C rerun reuse the seven contracts
   unchanged for comparability, or add an eighth contract targeting the new
   surfaces (structured inputs + one-off scheduling) at the cost of
   diary-to-diary comparability?
