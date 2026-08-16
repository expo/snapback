# LLP 0146: Agentic authoring affordances

**Type:** RFC
**Status:** Draft
**Systems:** Agent operating surface, Generated artifacts, Acceptance and
verification, Diagnostics, Schema and storage, Live queries, Developer
experience
**Author:** Charlie Cheever / Claude (Opus 5)
**Date:** 2026-08-01
**Revised:** 2026-08-16 (D1–D3 residue implementation record: the mutation
recording/settlement family now retains its exact commit dependency capture,
so successful `function.run` mutation envelopes report complete read/write
provenance; app-data query, mutation, and action invocations enter the bounded
recent-invocation ring, including unconditional incomplete reports for
failure/refusal and non-executing replay paths. D2 adds a repository
demo-catalog adapter that registers one path per proof command with honest
`unsupported` provenance until those suites emit D1 observations, plus
optional admin-token-authenticated `app.inspect` of a live served target for
admission identity, capability resolution, and capability-target/server-profile/
startup/data receipt binding. Sessions-mode targets that additionally require
an `AdminInspect` secret-read lease are an explicit unsupported live-probe
profile, not part of that claim. The 2026-08-16 completeness follow-up makes
the ring-recording chokepoints total: every recorded `function.run` refusal
materializes the six-field incomplete report, an admitted action throw is
incomplete rather than unsupported, and the live probe reads both singular
HTTP `diagnostic` and host-operation `diagnostics[]` carriers. D3's 2026-08-15 author
ruling selects a separately authenticated **BROKERED** observation artifact
for row-count magnitudes and D1 verdicts; no public app-data projection was
added, and that brokered artifact remains the tranche's only implementation
item. Nothing here claims LLP 0115 CV-14 custody or changes D4–D7.) 2026-08-10 (D2 Cloudflare adapter implementation: the
package-owned `defineCloudflareVerifyProfile` executes a bounded remote runner,
requires `snapback.cloudflare-acceptance.v1`, binds its app/schema/bundle facts
to the regenerated artifact, and carries observed target/data identities into
the verify receipt. The existing All Aboard remote runner now emits that
machine contract. The adapter is unit-qualified; no credentialed live
Cloudflare run was performed in this implementation lane.) 2026-08-08 (D2 trust-seam amendment: the conventional
`snapback.verify.config.mjs` is auto-discovered from the invoking cwd; a
zero-profile success is machine-distinct as `passed-without-acceptance`;
profile execution has bounded CLI/env/profile timeout policy; non-local
targets record an explicit non-claim instead of running the local packaged
runtime probe; and recommended actions separate runnable commands from prose
instructions. The target-specific Cloudflare acceptance adapter remains
unbuilt.) 2026-08-04 (author decision sitting #3
(`issues/closed/20260804-author-decision-sitting-3.md`), two rulings on
the D1 tranche's accumulated author questions: (1) **no escape hatch in
v1** — the boolean `strictDeclarations` opt-in ships as-is, and the
per-dependency-class vocabulary gets defined only when a real app hits a
conservative or unobservable class (evidence-driven); (2) the strict
flag is **refused at load with a named code** on targets that cannot
enforce it (Cloudflare arm today) — the flag must never ride through
unenforced; the load/ensure-time refusal with a named `SNAPBACK_*` code
plus test is added to the tranche's next steps. Ruling 2 partially
resolves OQ14 in the refuse direction — what constitutes an
authoritative capture on Cloudflare stays open. Implemented 2026-08-04 with
`SNAPBACK_STRICT_DECLARATIONS_TARGET_UNSUPPORTED` at the Cloudflare arm's
compiled-schema load and `/app/ensure` seams; the local enforcing target is
unchanged.) 2026-08-04 (D2/D3 first-tranche implementation record
(`issues/20260803-0146-d1-d3-tranche.md`): `snapback verify` is a
package-owned CLI composition in `packages/snapback-cli/verify.mjs`, not an
`acceptance.run` host operation. Its five ordered stages cover
source-regenerated artifact identity, the digest-bound LLP 0010 runtime
readiness verifier, local generated schema/function admission plus D1
coverage, generated target capabilities, and registered acceptance
profiles. `snapback.verify-receipt.v1` binds the profile set and actual config/
test bytes, target/data/authority/seed context, stage evidence and ordered
actions; `recommendedNext` exists only for one failure. D1 surface 2 uses the
minimal honest aggregate: every explicitly registered path must return the
six-field D1 report; a missing report and authoritative under-declaration fail,
while observed incomplete/unsupported provenance is retained as an honest
partial and over-declaration is the intersection across complete class
evidence for a function. It does not auto-discover unregistered repository suites, and a
zero-profile pass records `no-registered-acceptance-paths`, not coverage.
`snapback-app introspect` now emits `snapback.agent-digest.v1` with stable
static/dynamic sections, a cursor embedding the envelope identity and static
item hashes, minimal static item deltas, bare-envelope compatibility,
byte/item budgets, and explicit elisions. OQ10's visible v0 choice is coarse
dynamic replay: no observation manifest is retained, every available dynamic
item is sent whole, and unknown/structurally expired cursors degrade to a
named full digest. The public app-data projection does not expose per-table
row counts or D1 observations, so those items are explicit unavailable facts;
local artifacts use a named local projection identity rather than claiming a
served envelope. Tests are `packages/snapback-cli/verify.test.mjs` and
`packages/snapback-app-cli/digest.test.mjs`. Not claimed: live-target
admission, automatic acceptance-path discovery, dynamic observation custody,
the missing public row-count/D1 projections, `acceptance.run`, D4–D7, or
anything CV-14.) 2026-08-03 (D1 first-tranche implementation record 2026-08-03 (D1 first-tranche implementation record
(`issues/20260803-0146-d1-d3-tranche.md`): D1 surfaces 1 and 3 are
implemented on the local target — the per-invocation class-tagged report
with per-class provenance lands on the admin runner's `FunctionRunResult`
(`src/conformance.rs`, `src/local.rs`) and on the `function.run` envelope
and `app.inspect` recent-invocation ring, scoped to host-op invocations as
this decision's stated v0 fallback (the app-data plane is not wired into
the ring); the `function.run` mutation envelope seam reports `incomplete`
provenance because the recording path does not hand its captured sets back.
Strict mode is the per-app `defineSchema(..., { strictDeclarations: true })`
opt-in carried on the schema manifest and enforced at the shared Ibex
query/mutation runtime seams before any result handoff or durable effect,
refusing with the two LLP 0010-discipline platform codes
`SNAPBACK_HANDLER_UNDECLARED_READ`/`SNAPBACK_HANDLER_UNDECLARED_WRITE`
naming function, table, and declaration source span
(`src/runtime.rs`, `src/auth/invocation.rs`). Acceptance obligations
decidable at this slice are tests in `tests/conformance_v0.rs` and
`packages/snapback-codegen/authoring-validation.test.mjs`. Not claimed:
D1 surface 2 (`verify` coverage — D2), D2, D3, the per-dependency-class
escape hatch, Cloudflare-arm enforcement or capture authority (OQ14), and
anything CV-14 (OQ7 unruled — no custody claim).) 2026-08-03 (author decision sitting #2
(`issues/20260803-author-decision-sitting-2.md`): the D1–D3 first tranche
is ratified for implementation
(`issues/20260803-0146-d1-d3-tranche.md`); OQ1 ruled — D1 strict mode is
opt-in for newly generated apps; OQ8 ruled — Cloudflare fan-out stays
conservative widening for now, with no hosted claim gated on precision.
OQ7's CV-14 custody trigger is deliberately not ruled.) 2026-08-01 (implementation reconciliation outside the RFC's unratified D1 program: the independently ticketed Cloudflare live-delivery defect is fixed by conservative fan-out widening; OQ8 is narrowed to whether and how to recover precision). 2026-08-01 (v0.1, initial draft)
2026-08-01 (v0.2, round-1 dual-family reconciliation — artifacts in
`llp/reviews/0146-agentic-authoring-affordances.{fable,codex}.md`, both
NOT READY. The load-bearing correction is rebuilt: v0.1 claimed
declaration drift cannot break runtime behaviour, which is false on the
Cloudflare arm (whose live fan-out filters on manifest-declared
`fn.tables`) and too strong even locally (the local matcher falls back to
the declared read-set summary whenever no query dependency is captured).
D1 consequently becomes a correctness seam on one target rather than a
purely artifact-trust improvement. Corrects two false "shipped" baseline
rows — query explain serves only `mutationDryRun`, and checkpoint is not
a host op. Replaces D1's three-state per-invocation verdict with
independent deltas plus an evidence-provenance state; withdraws D2's
claim to close `acceptance.run`; reconciles D3 with LLP 0062's existing
`introspect --changed-since`; splits D4's blast radius into declared and
observed; disposes D5 against the LLP 0110 relation family and the
shipped last-holder guard; qualifies D6's replay guarantee to controlled
seams; and rebuilds D7's remediation schema. Open questions grew from 7
to 14.)
2026-08-01 (v0.3, round-2 dual-family reconciliation — Fable READY,
Codex NOT READY; artifacts appended to the same two files. Fable
dispositioned all eight of its round-1 findings FIXED; Codex marked five
FIXED and six PARTIALLY FIXED and raised one BLOCKING plus six MATERIAL.
Records the verified offline/RQS disposition — retention refuses opaque
JavaScript, so declaration drift has no retention effect today — instead
of leaving it open. Splits D1's deltas by read/write class, since four
collections collapsed into one union let a read/write swap cancel.
Separates D3's static envelope delta from its dynamic observation delta
after v0.2's reconciliation with LLP 0062 mistakenly keyed dynamic state
to an immutable content address. Requires paired bundles for D4's
observed-radius *change*. Moves D5's promoted-relation overlap test to
the source side, where the incarnation actually lives, and requires a
reverse index for `onTargetDelete`. Makes D6's reproduction class
transitive rather than top-level. Adds the missing preconditions to D7's
example and reassigns carrier ownership from LLP 0144 to the LLP
0094/0095 family. Corrects the search disposition — search is one-shot,
not live — and records the `functionTables` first-schema-table fallback
that both families found independently.)
2026-08-01 (v0.4, round-3 dual-family reconciliation — Fable READY,
Codex NOT READY; artifacts appended to the same two files. Both families
converged independently on the same four residues, all propagation lag
from v0.3's body edits: D5's acceptance clause still encoded the
withdrawn target-side overlap test; D1's report and acceptance prose kept
the collapsed `missing`/`extra`/`provenance` names the class split
forbids; the retention paragraph merged two distinct gates and omitted
the relational retainable arm; and D3's command still exposed only
`envelopeHash` after deciding two delta keys. Codex additionally found
v0.3's replacement overlap predicate ill-typed — it compared
`sourceFields` against `parent_table`, a table identity — now restated as
a three-term predicate, with `sourceIndex` added to the declaration so
the reverse lookup `onTargetDelete` requires is nameable. Fable
additionally found that D6's conservative fallback would leave
`deterministic` unpopulated, since every durable step touches SQLite; it
is now marked a degraded mode rather than a co-equal route. Status
narration brought current.)
2026-08-01 (v0.5, round-4 confirmation — **dual READY**, the loop's
convergence condition. Codex returned READY with no findings; Fable
returned READY with one DETAIL, which is applied here: v0.4's new
"every invocation *that carries an authoritative capture*" qualifier in
D1 surface 1 excluded exactly the invocations the provenance vocabulary
exists for — actions carry no capture by design, yet acceptance requires
them to report `unsupported` — so emission is now unconditional with the
delta fields authoritative only where provenance is `complete`. Also
states `targetIndex`'s inference rule symmetrically with `sourceIndex`'s.
Both changes are post-READY and therefore unreviewed.)
**Related:** LLP 0008, LLP 0010, LLP 0017, LLP 0019, LLP 0020, LLP 0024,
LLP 0040, LLP 0042, LLP 0054, LLP 0055, LLP 0056, LLP 0061, LLP 0062,
LLP 0073, LLP 0080, LLP 0081, LLP 0094, LLP 0095, LLP 0097, LLP 0108,
LLP 0110, LLP 0115, LLP 0127, LLP 0131, LLP 0134, LLP 0135, LLP 0144

## Summary

Snapback's agentic-authoring investment so far has produced an operating
surface (LLP 0024), its three projections — CLI, HTTP, MCP (LLP 0042) —
an agent-first guide with a witness-bearing capability index (LLP 0061),
agent principals with scoped grants (LLP 0055), and a generated per-app
CLI (LLP 0062). Mutation dry-run is implemented as the one served
`function.explain` kind (`src/host_ops.rs:1686-1725`). LLP 0019's
recommended sequence is *partly* executed: its steps 1 and 2 are built,
step 4's dry-run half is built, and its explain-denial half
(`llp/0019:333`) is not.

This RFC inventories thirteen *further* candidate affordances, adjudicates
each, and proposes seven for construction. The organizing thesis is that
the remaining agent failure modes are not gaps in what Snapback can *do*
but gaps in what an agent can *know*:

1. **Does my model of the app match reality?** (declaration/observation
   conformance, semantic change-impact)
2. **Am I done?** (a verification oracle with a receipt)
3. **What is true right now, in a budget I can carry?** (agent digest)
4. **When it broke, what is the smallest reproduction?** (scenario runner
   with shrinking)
5. **When I was refused, what may I do about it?** (typed remediations)

Seven decisions are proposed: D1 declaration/observation conformance,
D2 the `verify` done-oracle, D3 the agent digest, D4 the semantic
change-impact diff, D5 finite relational invariant profiles, D6 the
scenario runner with counterexample shrinking, and D7 typed remediations
with type-aware suggestion. Six candidates are adjudicated as declined or
deferred, including two that are attractive and wrong.

One decision moved between v0.1 and v0.2 and is worth stating up front: the
review found that live fan-out on the Cloudflare arm selected subscriptions
by manifest-declared tables, making **D1 a correctness seam on that target**,
not only a trustworthiness improvement to the artifact. The independently
ticketed product defect has since been closed by conservative widening: every
non-empty commit now considers every subscribed live-query function. D1 still
makes declaration drift observable; it is no longer required to prevent this
specific false-negative.

## Motivation

The failure modes an LLM agent exhibits against a backend are not the
failure modes a human exhibits, and the affordances that help are
correspondingly different.

A human author holds a mental model of the app across a session, notices
when a name looks unfamiliar, and knows when the feature is finished
because they can see it. An agent has none of that. It carries a lossy
compression of the app in a bounded context; it produces *plausible* code,
which is a different quality from correct code; it cannot tell a stale
artifact from a fresh one without being told; and it has no intrinsic
stopping condition, so it optimizes toward whatever oracle it is handed.

Two consequences follow.

**Plausibility is the dominant defect class.** An agent's wrong code is
rarely syntactically wrong or obviously wrong. It is code that passes the
tests it also wrote and violates an assumption nobody wrote down. The
defenses that work are the ones that make an unstated assumption into a
stated, machine-checked one — which is why this RFC proposes conformance
checking and invariant profiles rather than better documentation.

**Orientation is a product surface, not a convenience.** An agent
re-reads the world every turn. If re-reading costs 40,000 tokens, the agent
either does it and has no budget left to think, or skips it and reasons
from a stale model. A compact, stably-ordered, diffable projection of app
state is therefore load-bearing infrastructure, not a nicety.

This RFC was produced by adjudicating a candidate list against a
cross-family critique (gpt-5.6-sol, extra-high reasoning, with repository
access). Both the candidates and the critique are recorded below, including
where the critique's premise was verified false.

## What already ships

Establishing the baseline matters, because several attractive candidates
turn out to be projections over facts Snapback already computes.

| Affordance | Status | Witness |
| --- | --- | --- |
| Host-op core with CLI/HTTP/MCP projections | Shipped | `src/host_ops.rs`; LLP 0024 |
| Mutation dry-run through the real buffered path | Shipped | `dry_run` in `src/host_ops.rs`, `src/auth/invocation.rs` |
| Query explain (`queryPlan`) | **Pinned, unbuilt** | `SNAPBACK_EXPLAIN_KIND_UNIMPLEMENTED`, `src/host_ops.rs:1717-1721`; `guide/operating/host-ops.md:66` |
| Explain-denial (`permissionAllow`/`permissionDeny`/`capabilityGap`) | **Pinned, unbuilt** | same refusal arm; LLP 0019 step 4 half |
| Quiesced backup and restore | Shipped (operator, not agent-facing) | `AuthCommand::Backup`/`Restore`, `src/cli.rs:900-907` |
| Agent principals and scoped grants | Shipped | route `/auth/agents/pair`; LLP 0055 |
| Agent-first guide with witness-bearing capability index | Shipped | `guide/capabilities.md`; LLP 0061 |
| Generated per-app CLI | Partial | `snapback-app` in `packages/snapback-app-cli/cli.mjs`; LLP 0062 |
| Stable diagnostic codes | Shipped | `SNAPBACK_*`; LLP 0010 "Bootstrap diagnostic codes" |
| Declared app refusal codes | Review | LLP 0144 |
| Bounded recent-invocation ring in `app.inspect` | Shipped — **host operations only** | `RECENT_INVOCATIONS_CAPACITY = 128`, `src/host_ops.rs:57-105` |
| `acceptance.run` host operation | **Pinned but unbuilt** | `guide/operating/host-ops.md:72` |
| Captured read/write dependencies beside declared ones | Shipped, unchecked | `FunctionRunResult` in `src/local.rs:1449` |

The last row is the leverage: Snapback already computes *both* the declared
and the observed dependency sets — on the supported successful query and
mutation paths — and never compares them. (Not on *every* handler: actions
construct empty captured sets by design, `src/local.rs:1705-1740`, which is
why D1 carries a provenance state rather than assuming a capture exists.)

`acceptance.run` is also a named hole in a ratified contract, but v0.2
withdrew D2's claim to close it, so how much leverage that hole carries now
depends on OQ9's answer rather than on anything this RFC decides.

## Candidate inventory and verdicts

| # | Candidate | Verdict |
| --- | --- | --- |
| C1 | Declaration/observation conformance | **Build — D1** |
| C2 | `snapback verify` done-oracle | **Build — D2** |
| C3 | Context-budgeted agent digest | **Build — D3** |
| C4 | Semantic change-impact diff | **Build — D4** |
| C5 | Declarative invariants | **Build, narrowed — D5** |
| C6 | Multi-principal simulation | **Build, narrowed — D6** |
| C7 | Repairs carried by refusals | **Build, narrowed — D7** |
| C8 | Wrong-guess telemetry and aliasing | Partially absorbed into D7; aggregation deferred, auto-aliasing declined |
| C9 | Least-authority planning | Accepted in principle, deferred |
| C10 | Bounded causal trace | Accepted in principle, deferred |
| C11 | Agent workspace primitive | Accepted in principle, gated on LLP 0097 |
| C12 | Trajectory record and replay | Declined as specified; narrow successor deferred |
| C13 | Universal continuation tokens and token-cost estimates | Declined; replaced by per-operation bounding |

## The correction, scoped by target

The motivating critique claimed that declared `reads`/`writes` drift makes
**live invalidation silently wrong**: an agent adds a
`ctx.db.query('members')` call, forgets the declaration, and the handler
returns correct data on direct invocation while subscriptions fail to
re-fire.

v0.1 of this RFC rejected that premise outright, on the ground that the
runtime consumes captured dependencies rather than declarations. **That
rejection was itself wrong** — too strong locally, and false on the
Cloudflare arm. The corrected position is target-scoped, and it is what
sets D1's priority.

### Local target — captured first, declared as fallback

The local matcher prefers captured dependencies and consults declarations
only when the captured set cannot summarise the handler's reads.
`live_subscription_may_be_affected` (`src/live_matcher.rs:129`) first calls
`live_subscription_may_be_affected_by_dependencies` (`:195`), which answers
from `CapturedReadDependency` values — `Row`/`MissingRow` facts by exact
`(table, id)`, `Query` facts by replaying the captured predicate through
`change_may_affect_query_plan`.

But that helper returns `None` when **no `Query` dependency was captured**,
with its own comment stating why: "the captured reads do not summarize the
handler's full read set (e.g. a handler that never ran, or captured
nothing); fall back to the conservative read-set-summary arm"
(`src/live_matcher.rs:229-233`). The fallback for an inline JS handler is:

```rust
FunctionRuntime::IbexModule(_) => {
    let tables = &definition.read_set_summary.tables;   // declared
    let relevant = changes.iter()
        .filter(|change| tables.is_empty() || tables.contains(&change.table))
    if relevant.is_empty() { return false; }            // no wake-up
```

So a declared table set *does* reach the local delivery decision, on a
named path. Two qualifications keep the hazard correctly sized:

- **An empty declared set is the safe direction.** `tables.is_empty()`
  passes every change through the filter (`src/live_matcher.rs:151`), so an
  undeclared handler is woken by everything. Only a **non-empty wrong** set
  can suppress delivery.
- **The fallback is reachable on success, not only on failure.** The
  helper's comment cites "a handler that never ran, or captured nothing,"
  but the condition it actually tests is the absence of a `Query`
  dependency. A handler that ran successfully using only `ctx.db.get` point
  reads captures `Row`/`MissingRow` facts and no `Query` fact, so it lands
  on the declared arm too.
Mutation commit validation is on firmer ground: it validates
`executed.reads`, the runtime-captured set, forwarded from
`src/local.rs:11111`, `:11568`, `:11797` and reaching the validator at
`src/storage.rs:4454-4457`.

### Cloudflare arm — historical declared-table-only fan-out

At the v0.5 review cut, the critique's original claim was simply correct.
`fanOut` selected affected subscriptions with
`functionTables(fn).some((table) => changedTables.has(table))`
(`cloudflare/src/coordinator.js:5163-5167` at that cut), and `functionTables`
returned the function's declared `fn.tables` — **or, when that list is absent or
empty, `[schema.tables[0].name]`** (`:5539-5542`). The fallback is a second
and arguably worse miss on the same arm: a live query with no declared
tables fans out on whichever table happens to be first in the schema, which
is arbitrary rather than conservative, and "no declaration yet" is exactly
the state a code-first agent leaves a handler in. Captured reads were
recorded on this arm but unused by fan-out: the coordinator's own header said
"captured read sets are recorded but not yet validated"
(`cloudflare/src/coordinator.js:22-23`), with serialisation standing in for
the isolation the manifest declares.

**Therefore, before the 2026-08-01 fix, a handler that declared table A and
dynamically read table B was not woken when B changed.** That was a live
correctness defect reachable by exactly the authoring mistake an agent is
most likely to make.

**Landed interim (2026-08-01).** `fanOut` now conservatively selects every
`LiveQuery` function for every non-empty commit. The bounded indexed durable
registry queries still limit work to active subscriptions, and equal
function/argument shapes still share one re-query. This removes both the
under-declared miss and the arbitrary first-schema-table fallback without a
subscription-schema migration. The cost is delivery precision; OQ8 now asks
whether captured-read persistence or future strict-mode admission should
recover it, not how to restore correctness.

### Other arms

- **Relational and bounded-children queries** never consult captured deps
  for invalidation; they are deliberately table-granular over the *plan's*
  declared sources (`plan.root`/`plan.joined`,
  `plan.parent_table`/`plan.child_table` — `src/live_matcher.rs:170-179`).
  Because those tables come from the generated plan rather than a
  hand-written declaration, an agent cannot under-declare them; LLP 0080 §4
  records the table-granularity as intentional.
- **Search is not live at all.** Search executes as a one-shot
  `FunctionKind::Query` over `HandlerPlan::SearchQuery`
  (`src/local.rs:22591`), so it has no invalidation path to get wrong. It
  does capture a `Query` dependency without a predicate, which — were it
  ever passed to the matcher — yields a conservative `Some(true)` before any
  plan-table arm is reached (`src/live_matcher.rs:237-257`). v0.2 grouped it
  with plan-table live invalidation; that was inaccurate.
- **Offline/RQS retention has a verified current disposition, and it is
  "no effect."** Two distinct gates reach the same conclusion, and they
  should not be described as one:
  - **Declared retainable admission** (`validate_retainable_query`) is the
    *erroring* gate. It admits a `HostPlan(Query)` with a plan-consistent
    single-table summary **and** a qualifying `HostPlan(RelationalQuery)`
    with a two-table relational summary (`src/manifest.rs:2891-2971`), and
    refuses anything else — opaque JavaScript included — with
    `undeclarable_retention(function, "opaqueJavaScript")`
    (`src/manifest.rs:2981`).
  - **RQS eligibility** (`rqs_eligible_digest_kind`, `:2299-2353`) is the
    *non-erroring* derived predicate, requiring the single-table
    `HostPlan(Query)` profile; its own doc comment says a query failing the
    proof "is simply not eligible, never a load error." The Cloudflare arm
    mirrors it (`cloudflare/src/rqs-host.mjs:194-223`).

  Every admitted shape has its summary checked against its plan, and
  hand-authored drift is only possible in opaque JS handlers, which both
  gates exclude. So drift has no retention or RQS effect today. OQ12 is
  narrowed accordingly: it asks only what happens if eligibility later
  expands to admit opaque handlers.

### What is common to every target

- Declared and captured sets are carried side by side on
  `FunctionRunResult` (`src/local.rs:1449-1458`), with a doc comment naming
  the mismatch as the Valet "counts stuck at zero" failure class.
- **Nothing compares them.** The only consumers of `captured_reads` outside
  `local.rs` are secret-scope wideners — `function_run_secret_scopes`
  (`src/admin.rs:1774`) and its host-ops sibling (`src/host_ops.rs:1444`) —
  which union both sets to widen a lease, never to check one against the
  other.
- Declarations are documented as "evidence, not enforced ceilings"
  (LLP 0127 decision 6; `packages/snapback-codegen/inline-helper-sharing.test.mjs:7`).

So D1 carries **two** values, not one: on the local target it makes the
manifest — the artifact every agent, review surface, and generated
integration reasons from — checkable against behaviour; on the Cloudflare
arm it closes a reachable live-delivery defect. The second is why D1 is
first.

## Decisions

### D1. Declaration/observation conformance

**Build first**, for the reason the correction above establishes: on the
Cloudflare arm this is a live-delivery defect, not only an artifact-trust
gap. Join the two dependency sets Snapback already computes and make
divergence a named, addressable fact.

**Evidence shape.** A single invocation can be under-declared and
over-declared at once — capturing undeclared B while never exercising
declared A — so one three-valued verdict cannot represent it. And absence
from one branch's captured set does not establish global over-declaration;
a conditionally-read table is unwitnessed on every invocation that skips
its branch. Per invocation, therefore, emit two independent deltas plus a
provenance state:

**The deltas must preserve the read/write class.** `FunctionRunResult`
carries four separate collections — declared reads, declared writes,
captured reads, captured writes (`src/local.rs:1449-1458`) — and collapsing
them into one table union lets a read/write swap cancel out: a handler
declaring read A and write B while observably reading B and writing A has
identical untagged unions on both sides despite two violations. So the
report is four deltas, or equivalently class-tagged elements, with
provenance tracked **per class** (a path can capture reads authoritatively
while capturing no writes):

```
missingReads:  capturedReads  \ declaredReads    (authoritative when readProvenance = complete)
missingWrites: capturedWrites \ declaredWrites   (likewise, writeProvenance)
extraReads:    declaredReads  \ capturedReads-here    (data, not a verdict)
extraWrites:   declaredWrites \ capturedWrites-here   (data, not a verdict)
readProvenance / writeProvenance: complete | incomplete | unsupported
```

`incomplete` and `unsupported` are not decoration. Successful action results
carry empty captured sets by construction (`src/local.rs:1705-1740`) and are
therefore honestly `unsupported`; an action that throws executed partially and
is `incomplete`, as are refusal paths with no complete dependency witness. The
local matcher itself
distinguishes "captured reads summarise the handler" from "they do not"
(`src/live_matcher.rs:229-233`). A conformance surface that reports
`conformant` from an empty capture would manufacture exactly the false
confidence it exists to remove.

Three surfaces, in increasing strictness:

1. **Report (v0).** *Every* invocation emits all six class-tagged fields —
   `missingReads`, `missingWrites`, `extraReads`, `extraWrites`,
   `readProvenance`, `writeProvenance` — with the delta fields authoritative
   only where that class's provenance is `complete`. Emission is not
   conditional on an authoritative capture; an invocation with no capture is
   exactly the case the provenance vocabulary exists to report, and a
   surface that fell silent there would recreate the false confidence it is
   meant to remove. There is no collapsed `missing`/`extra`/`provenance`
   triple; naming one would reintroduce the union this split exists to
   prevent. Attach to `FunctionRunResult` and to the `app.inspect`
   recent-invocation ring. The 2026-08-16 residue tranche wires app-data query,
   mutation, and action invocations into that bounded ring and retains the
   executed commit capture through mutation recording/settlement, so successful
   `function.run` mutations report complete provenance rather than the former
   compatibility seam's `incomplete` fallback.
2. **Coverage (v0, inside D2).** `verify` aggregates across every acceptance
   path and only then reports **over-declaration**, which is the only scope
   at which that judgement is sound. Under-declaration is a failure;
   over-declaration is a warning.
3. **Strict mode (v1, opt-in per app).** Application-table reads and writes
   must be a subset of the declarations, refused at the seam with
   `SNAPBACK_HANDLER_UNDECLARED_READ` / `SNAPBACK_HANDLER_UNDECLARED_WRITE`,
   naming function, table, and the declaration's source span.

Strict mode is opt-in and per-app, not global and not default, because
LLP 0127 decision 6 deliberately admits context-reader helpers whose
declarations are evidence, and LLP 0108 sequences ceiling enforcement as
"its own later decision, decoupled" (`llp/0108`). This RFC is that later
decision, taken narrowly. The escape hatch is per-dependency-class
(explicitly conservative or unobservable classes), never a blanket disable.
(Ruled 2026-08-04, author sitting #3: **no hatch ships in v1** — the
boolean opt-in ships as-is, and the class vocabulary gets defined only when
a real app hits a conservative or unobservable class. Also ruled: the
strict flag is refused at load with a named code on targets that cannot
enforce it — see §Open questions.)

**Cloudflare disposition.** Report and coverage did not by themselves fix
the fan-out defect, so the arm independently landed conservative widening:
an under-declared or unwitnessed function is affected by every changed table.
OQ8 retains the captured-read and strict-mode shapes only as ways to recover
precision; strict mode is the one that keeps fan-out cheap without a durable
dependency read.

*Acceptance:* a handler reading an undeclared table reports non-empty
`missingReads` with `readProvenance: complete`, fails `verify` coverage, and
is refused with the named code under strict mode; a handler that swaps a
read and a write against its declaration reports both `missingReads` and
`missingWrites` rather than cancelling to empty; a successful action reports
`readProvenance`/`writeProvenance` of `unsupported` rather than any
conformant verdict, while a throwing or refused action reports `incomplete`;
a conditionally-read declared table produces no
over-declaration warning until aggregate coverage shows no path witnesses
it; and the coverage report names which of the success, failure, action,
relational, search, snapshot-bundle, and per-target paths yielded
authoritative evidence.

*Cost:* small for surfaces 1–2 (the sets are in hand; the work is the
comparison, provenance plumbing, and source-span mapping). The two refusal
codes are **platform** codes and follow the LLP 0010 diagnostic-code
discipline — not LLP 0144, which scopes itself to application-declared
codes carried under `SNAPBACK_APP_REFUSAL` and explicitly calls
platform-code registry gaps a different thing (`llp/0144:135-137`).

### D2. `snapback verify` — the done-oracle

**Build second.** Agents optimize toward whatever oracle they are handed, so
handing them a good one is the cheapest available leverage.

**What this does and does not claim about `acceptance.run`.** That host
operation is pinned and unbuilt (`guide/operating/host-ops.md:72`), and
LLP 0042 deferred its server-side runner with a named reason. D2 is a **CLI
composition, not that operation's implementation**: it does not project the
LLP 0024 result contract, and it leaves `acceptance.run` open. v0.1 claimed
D2 "closes an acknowledged hole"; it does not. Whether `verify` later
becomes the shared core that `acceptance.run` projects — with the LLP 0024
profile identity, counts, diagnostics, and artifact paths — is OQ9.

`snapback verify --json` orchestrates, in precedence order:

1. artifact freshness and identity (codegen regenerated from source; input
   hashes match; generation admitted)
2. runtime readiness (the LLP 0010 receipt, digest-bound to the binary)
3. schema/function admission and D1 conformance coverage
4. declared capability requirements resolved against the served target
5. registered acceptance profiles executed

Output is a **receipt** — plus the existing host-op `next[]` list. The
receipt binds more than the artifact generation, or it is not replayable:
the acceptance profile identity and the digest of the test bytes actually
executed, the target and data identity, the authority context, and the
seed or versioned-seed identity in force. An artifact hash alone would let
two runs over different data or different tests present as the same
evidence. A `recommendedNext`
scalar is emitted **only** when precedence makes the choice mechanically
unique; a capability gap, stale codegen, and a failed acceptance profile are
independent conditions and collapsing them into one "next step" would lie.
Its `command` is runnable or null; prose belongs in a separate `instruction`
field. The CLI auto-discovers `snapback.verify.config.mjs` in the invoking cwd.
A run that truly registers no profiles may pass platform stages, but its
receipt status is `passed-without-acceptance`, never the ordinary `passed`, and
it retains the no-coverage non-claim.

Runtime-readiness stage 2 is target-aware. It applies the digest-bound local
packaged-runtime probe only to local target profiles; a non-local profile gets
an explicit `not-applicable-non-local-target` result with `claim: false`.
That skip does not establish readiness for the remote runtime, and no hosted
capability claim may treat it as doing so. Registered profiles have a bounded
five-minute default, overridable per profile, by CLI, or by the documented
environment setting; expiration fails with
`SNAPBACK_VERIFY_PROFILE_TIMEOUT`. The target-specific Cloudflare adapter runs
a bounded receipt-producing remote profile and binds its admitted artifact
hashes plus observed target/data identities. Its unit proof does not substitute
for a credentialed run against the deployment being claimed.

**Implemented residue (2026-08-16).** `servedTarget` optionally names a live
HTTP target plus the environment variable carrying its admin credential.
Verify's live claim is scoped to the admin-token authority profile it actually
sends. It performs authenticated `app.inspect`, binds the observed app/schema/
bundle, capability target profile, server-policy profile, startup identity,
and database version, and resolves required capabilities from the live
capability manifest. A sessions-mode target requiring the additional
`AdminInspect` secret-read lease is refused as the named
`sessions-secret-read-lease-not-supported` limitation; verify does not claim
that target live. With no served target it retains the generated-only nonclaim.
The repository demo-catalog adapter registers one acceptance path per executed
catalog proof command and digest-binds only the catalog plus its designated
proof evidence. Additional inventory files are neither bound nor separately
observed as if their own commands ran. Because these suites do not yet emit D1
captures, the one executed path reports `unsupported` provenance and partial
coverage rather than inventing an authoritative verdict.

Two boundaries. Application test execution stays in the CLI orchestrator,
not inside the server, in v0. And `verify` proves "platform-ready under the
app's declared contract" — never "the product is finished" or "the tests
express the requirements." The receipt says which of those it means.

*Acceptance:* a fresh generated app passes `verify` from minute one; each of
the five conditions can be independently failed and produces a distinct,
named entry in `next[]`.

### D3. Agent digest

**Build third.** `agentDigest.v1`, a projection over `app.inspect` and app-CLI
introspection, emitted under a declared budget.

**This extends an existing proposal rather than minting a rival.** LLP 0062
already names `introspect --changed-since <envelopeHash>` — "the content
address makes 'what changed since I last looked' a cheap diff"
(`llp/0062:1521`). D3 does **not** introduce a second command with a second
hash space. It supplies the budgeting, section stability, and elision
discipline that entry lacks, under 0062's spelling:

```
snapback-app introspect --changed-since <digestCursor> --budget-bytes 32768
```

**But `envelopeHash` alone cannot key this digest, and v0.2 got that
wrong.** LLP 0062's envelope is "content-addressed and immutable"
(`llp/0062:246-260`) — a static address for generated bytes. The digest
proposed here also carries *dynamic* observation state: row-count
magnitudes, recent refusal codes, D1 conformance verdicts. Those change
repeatedly while the envelope hash stands still, so one envelope hash
cannot identify which prior digest a caller actually saw. Reusing 0062's
spelling was right; reusing its hash space as the sole delta key was not.

The digest therefore has **two sections with two delta keys**:

- **Static section** — schema, operation signatures, contracts, capability
  gaps. Keyed by `envelopeHash`; delta is exactly 0062's cheap diff.
- **Dynamic section** — counts, recent refusals, conformance verdicts.
  Keyed by a `digestCursor` bound to `(envelopeHash, observation state)`,
  which is the only thing that can say "since what."

**One flag carries both keys.** The `digestCursor` *embeds* the
`envelopeHash` it was minted against, so `--changed-since <digestCursor>`
supplies both delta bases in one opaque token and the caller never holds two.
Every digest response emits the cursor for its own state, which is what the
next call passes back. A bare `envelopeHash` remains accepted for
compatibility with LLP 0062's spelling and yields a static-only delta with
the dynamic section sent whole — stated, not silent.

**Custody remains a required decision.** Something must recover what a prior
cursor denoted: the server retains recent digest manifests, the client
presents its prior digest for server-side diffing, or the cursor resolves
only coarsely and the dynamic section is always sent whole. Each differs in
retention, expiry, and authority. An unknown or expired cursor must degrade
to a full digest with a named reason — never an error, and never an empty
delta, which reads as "nothing changed." OQ10 carries this.

**Implemented v0 disposition (2026-08-04).** The cursor carries the static
item-hash index needed for a minimal static delta, but Snapback retains no
dynamic observation manifest. The dynamic section is therefore always sent
whole at coarse resolution and names
`coarse-resolution-v0-no-observation-retention`. Cursors minted by v0 have no
expiry; an unknown cursor, or a structurally valid future/external cursor whose
declared expiry has passed, degrades to a named full digest. This is the
commissioned v0 fallback, not a claim that OQ10's longer-term custody policy is
settled.

**Author ruling (2026-08-15).** The unavailable row-count magnitudes and D1
recent-invocation verdicts are supplied to `snapback-app introspect` by a
separately authenticated **BROKERED** observation artifact, not by extending
the public app-data inspection contract and not by granting the app CLI
ambient admin authority. The carrier remains unimplemented in this tranche;
the 2026-08-16 D1 ring work is its observation source, not the broker itself.

Contents: artifact identities, schema summary, operation signatures with
argument and result contracts (LLP 0131), capability gaps, row-count
magnitudes, recent refusal codes, and D1 conformance verdicts. **No row
values by default.**

Three properties carry the value:

- **Stable sections and stable ordering**, so consecutive digests diff
  cleanly and the agent can cache.
- **`--changed-since`**, so a returning agent pulls a delta rather than a
  fresh dump. This is where most of the token saving actually lives.
- **Honest truncation.** Budget exhaustion emits an explicit elision marker
  naming what was dropped and how to request it. Silent omission reads as
  "that doesn't exist," which is worse than a bigger digest.

Budgets are declared in **bytes and item counts**, not tokens — see D-decline
5.

*Acceptance:* two digests of an unchanged app are byte-identical; a
single-field schema change produces a minimal diff; **a dynamic-only change
— new rows, a fresh refusal — produces a non-empty dynamic delta while
`envelopeHash` is unchanged**, which is the case a hash-only key could not
express; a bare `envelopeHash` yields a static-only delta and says so; an
unknown or expired cursor degrades to a full digest with a named reason; and
a budget too small to hold the schema still produces a valid digest with a
truthful elision marker.

### D4. Semantic change-impact diff

**Build fourth.** Deterministic manifests are not the same as reviewable
manifests, and this is already docketed as LLP 0115 CV-14 "Semantic review
summary for dense manifests," open and claimed by no move
(`llp/0115-convex-parity-course-corrections.plan.md:435`). D4 claims it.

**This is not greenfield.** A deterministic schema-change derivation
already exists: `MigrationIntent` derivation over a predecessor/successor
`SchemaManifest` pair, total over unambiguous semantics-free diffs and
refusing everything else with `SNAPBACK_MIGRATION_PLAN_INVALID`
(`src/migration.rs:896-923`, LLP 0081 §2), exposed as a migration preview
(`src/cli.rs:779-813`). D4 **extends** that derivation to the
function/contract/authority/capability axes rather than reimplementing the
schema axis beside it.

Given two artifact generations, emit a stable semantic diff:

- tables, fields, indexes added, removed, or narrowed *(reuses
  `src/migration.rs`)*
- migration required versus additive reload *(same)*
- functions added or removed
- argument or result contract changes (LLP 0131, LLP 0108)
- auth requirement or authority-creating status changes
- declared read/write set changes
- **declared** live-invalidation blast radius changes
- capability requirements added or degraded
- generated client surfaces made stale

**Declared blast radius is not observed blast radius**, and D4 must not
conflate them. On the local target, delivery is decided primarily by
captured dependencies, so a handler's real fan-out can change with a code
edit that leaves every declaration identical — two artifacts cannot detect
that. D4 therefore reports the *declared* radius from artifacts alone. An
**observed radius change** requires *paired, comparable* observation
bundles — one per generation, exercised under the same acceptance profile,
tests, data or seed identity, authority, and target, with the same
evidence-provenance rules. A single bundle over the new generation yields a
**current observed radius**, not a diff: absence on the old side would
otherwise be indistinguishable from "that path was never exercised." The
output must label which of the two it is.

For an agent, "what did my edit *mean*?" is at least as important as "what
exists now?" — and it is the question the agent is worst at answering for
itself, because the mechanical diff is enormous and the semantic diff is
three lines. Feeds both D2's receipt and D3's digest.

*Acceptance:* a field addition and a field narrowing produce distinct
migration verdicts identical to the existing preview's; an auth-requirement
change is never reported as additive; a handler edit that changes captured
reads without changing declarations reports **no** observed-radius claim
unless an observation bundle is supplied.

### D5. Finite relational invariant profiles

**Build fifth, narrowed.** Declared invariants are the strongest available
answer to plausible-but-wrong write paths, but not as an arbitrary predicate
DSL.

Declined shape:

```js
defineInvariant(async (db) => { /* arbitrary query */ })
```

This creates a second handler class with unresolved bounds, target
portability, static dependency declaration, conflict capture, migration,
source mapping, and Hermes execution semantics — and is trivially O(n) at
every commit.

Proposed shape — a finite, analyzable vocabulary:

```js
defineInvariant('message-author-is-room-member', existsRelation({
  source: messages,
  sourceFields: ['roomId', 'authorId'],
  target: roomMembers,
  targetIndex: 'by_room_user',      // forward: does the target row exist?
  sourceIndex: 'by_room_author',    // reverse: do source rows point at it?
  onTargetDelete: 'restrict',
}))
```

Both indexes are named because both directions are checked. Either may be
inferred where exactly one index covers the relevant fields in order —
`sourceIndex` from `sourceFields` on the source table, `targetIndex` from
the target's key fields — but neither may be silently omitted: an ambiguous
or absent cover is a generation error, not a defaulted choice.

The v1 vocabulary: required referenced row (`existsRelation`) and
conditional uniqueness.

**Two classes v0.1 listed are withdrawn, because they already ship.**
Protected-last-member is enforced today: demotion out of a protected role
captures the survivor so two concurrent demotions of the final two cannot
both commit (`src/storage.rs:13192-13203`), and `plan_membership_remove`
"refuses removing the final eligible holder of a protected role"
(`src/storage.rs:13220-13263`). Membership existence is likewise covered by
the existing resource-existence checks. Claiming them as new vocabulary
would have duplicated shipped behaviour while obscuring what is genuinely
new. If D5 later wants to *generalise* `membership.lastHolder` beyond
memberships, that is its own decision and must say how the generic rule
reuses or supersedes the shipped one — OQ11.

`onTargetDelete` is the part that is easy to miss and does most of the work:
checking message insertion is insufficient — *removing a membership* must
also refuse while dependent messages exist. Both directions, or the
invariant is decorative.

**Disposition against the bounded-relation family (LLP 0110/0134/0135).**
That family already declares relations in the manifest
(`RelationIncarnation { foreign_key_field, parent_table }`,
`src/manifest.rs:836-840`) and deliberately declines this ground:
`hide-orphans.v1` is its *only* parent-deletion policy (`llp/0110:169`,
`:329-333`), and it explicitly excludes "referential constraints, cascade
deletion, or orphan cleanup" (`llp/0110:917`). `onTargetDelete: 'restrict'`
is exactly a referential constraint on that territory, and layering restrict
over a read profile that *hides* orphans would put two deletion semantics
on one shape. **D5 therefore applies only to ad-hoc application relations,
not to promoted bounded-relation incarnations**, which keep `hide-orphans.v1`.

**The overlap test is on the source side, not the target.** v0.2 said
codegen must refuse an `existsRelation` whose *target* is a promoted
incarnation. That names the wrong side of the relationship: a
`RelationIncarnation` is a protected *field on the child/source row*,
paired with a required foreign-key field, and "the paired required
foreign-key field is the complete relationship declaration"
(`src/manifest.rs:829-840`).

v0.3's replacement was better but still ill-typed: it asked whether
`sourceFields` coincides with the `foreign_key_field`/`parent_table` pair,
and `parent_table` is a *table identity*, not a member of a field list. The
predicate relates three correctly typed terms:

```
overlaps(existsRelation E, incarnation I declared on table T) :=
      E.source            == T                  // same child table
  AND I.foreign_key_field ∈  E.sourceFields     // field ∈ field list
  AND E.target            == I.parent_table     // table == table
```

Codegen refuses `E` when `overlaps` holds for any declared incarnation.
Whether the two vocabularies should ever converge is OQ13.

Codegen must **prove boundedness in both directions**: `targetIndex` bounds
insert and update validation on the source side, but `onTargetDelete:
'restrict'` needs an indexed **reverse** lookup — "are there source rows
pointing at this target?" — which `targetIndex` does not provide. That is
why the declaration carries `sourceIndex` as well; an invariant that cannot
name or unambiguously infer both supporting indexes is a generation error,
not a slow commit.

D5 must also define three semantics v0.2 left implicit:

- **Transaction-final-state.** The invariant is evaluated once against the
  buffered final state, not per statement, so a mutation that transiently
  violates and repairs within one transaction commits.
- **Target-key updates.** Changing a target row's key is a deletion from
  the source's perspective and takes the `onTargetDelete` path.
- **Concurrency.** A concurrent source-insert and target-delete must not
  both commit. That needs captured row or range dependencies on the checked
  side — the same race contract the existing membership relations spell out
  explicitly (`llp/0056:564-588`), and the reason those guards capture a
  survivor rather than merely counting.

*Acceptance:* both directions refuse with the invariant's name in the
refusal; an invariant that can neither name nor unambiguously infer both
`targetIndex` and `sourceIndex` fails codegen; an `existsRelation` for which
`overlaps` holds against any declared incarnation — same source table, the
incarnation's `foreign_key_field` among `sourceFields`, target equal to the
incarnation's `parent_table` — fails codegen with a named reason; a
mutation that transiently violates and then repairs the invariant within one
transaction commits; commit cost stays index-bounded under a growing target
table.

### D6. Scenario runner with counterexample shrinking

**Build sixth, narrowed on two axes.**

*First narrowing — the gap is not what it appeared.* "Agents can't click two
browsers" is largely already answered: headless-first suites, separate
actor/observer clients in the comparator profile, and explicit cron/job
driving all exist (`guide/testing/acceptance.md`), and LLP 0054 already
recommends the seeded simulator with safety and liveness phases. The real
gap is a **reusable scenario language and failure minimization**.

*Second narrowing — do not claim global determinism.* Scheduling is
deterministic only at named Snapback seams: deliver or withhold a live
frame; disconnect and reconnect a logical client; advance trusted time; tick
cron or jobs; drop a mutation response; change membership; reopen a
file-backed database. Where control escapes those seams — SQLite, sockets,
threads, actions, external effects — the runner *records* the observed order
rather than claiming to control it. Calling the whole system deterministic
would manufacture false confidence, which is worse for an agent than
acknowledged nondeterminism.

The larger win over hand-written scenarios is **generating** them from the
artifacts Snapback already emits — schema validators, function manifests,
result contracts, membership declarations, capability facts — and asserting
cross-cutting properties continuously:

- a refusal never advances the durable version
- one mutation is observed atomically
- live results equal a fresh authoritative query after quiescence
- revoked authority cannot retain visible rows
- ephemeral publication does not advance durable state
- mutation settlement never executes twice

On failure, **shrink** principals, rows, and logical steps to a minimal
scenario JSON runnable by `snapback scenario replay`. This is the decisive
property: an agent can reliably fix a five-step counterexample and cannot
reliably interpret a ten-thousand-event fuzz log.

Shrinking is itself probabilistic where the run is, so it needs a **fixed
trial budget and a stated success criterion** (e.g. "reproduced in k of n
trials"). Without them, "minimal" and "reproduction rate" are unstable
across runs and an agent cannot tell a fixed bug from a lucky trial.

**Replay is guaranteed only over controlled seams**, and v0.1's acceptance
criterion overreached by requiring every shrunk violation to reproduce.
Recording an ordering the runner does not control does not make that
ordering enforceable on replay. A shrunk scenario therefore carries a
**reproduction class**: `deterministic` (replay must reproduce) or
`observed` (replay attempts it and reports a reproduction rate, never a
guarantee). An `observed` counterexample is still far more useful than a raw
log, but it must not be presented as a regression test.

**The classification test is transitive, not top-level.** "Every step is a
controlled seam" does not establish `deterministic`: a controlled top-level
step still executes *through* SQLite, sockets, threads, or an action, any
of which can supply the ordering the violation actually depended on.
Classification must therefore follow event and effect provenance through the
step — or, failing that, conservatively mark any run that touched an
uncontrolled subsystem as `observed`. **The conservative route is a degraded
mode, not a co-equal design choice**: SQLite is named among the uncontrolled
subsystems and every durable step touches it, so a blanket rule would leave
`deterministic` unpopulated and the acceptance clause below unsatisfiable.
Only provenance-following can populate the class; the fallback is what a
runner does before that provenance exists, and it must say which route it
used. LLP 0054's exact-replay proposal takes
the stricter route, requiring every nondeterministic input that affects
observable behaviour to pass through an injected interface
(`llp/0054:243-257`); D6 does not adopt that, and so must not borrow its
guarantee.

**Relationship to LLP 0054.** That document is unratified research
(`llp/0054:414-419`). D6 ratifies its controlled-seam framing and its
safety/liveness property style, and claims the scenario language,
generation, and shrinking that it left open. It does not ratify 0054's
broader simulator programme.

*Acceptance:* a seeded property violation over controlled seams only shrinks
to a minimal scenario classed `deterministic` and reproduces on replay; a
violation depending on uncontrolled ordering is classed `observed` and
reports a reproduction rate; the runner never describes as deterministic an
ordering it only observed.

### D7. Typed remediations and type-aware suggestion

**Build seventh, merging the useful halves of two candidates.**

*Remediations.* A refusal carries `remediations[]`, each typed with a
precondition and a risk class — not a single server-generated patch.
"Author is not a room member" has at least five valid repairs (add the user;
act as the correct user; target a different room; change the membership
policy; conclude the operation is invalid), and only the application knows
which is intended. A server that emits one patch for that is guessing about
authorization, which is the worst place to guess.

Four axes are encoded **independently**, because collapsing them lets a
consumer infer automation safety from the wrong field:

```json
{
  "remediations": [
    { "kind": "requestGrant",
      "riskClass": "authority-widening",
      "machineApplicable": false,
      "requiresApproval": true,
      "authorityEffect": "widens",
      "precondition": { "grantableScope": "…" } },
    { "kind": "useDifferentPrincipal",
      "riskClass": "authority-sensitive",
      "machineApplicable": false,
      "requiresApproval": true,
      "authorityEffect": "changes-effective-principal",
      "precondition": { "principalAvailable": "…" } },
    { "kind": "replaceIdentifier",
      "riskClass": "mechanical",
      "machineApplicable": true,
      "requiresApproval": false,
      "authorityEffect": "none",
      "precondition": { "artifactHash": "…" } }
  ]
}
```

v0.1's example marked `useDifferentPrincipal` as `requiresApproval: false`.
That was wrong and contradicted this decision's own safety rule: changing
the effective principal is authority-sensitive, and an artifact-hash
precondition does nothing to bound that risk. **Any principal-changing
remedy requires approval** unless separately constrained by a named,
narrower rule.

`machineApplicable: true` is a *positive* discriminator, never inferred from
`requiresApproval: false`. It is granted only to typo fixes, exact
identifier replacement, and regeneration — each carrying an artifact-hash
precondition so a stale artifact cannot silently apply a repair. Never to
authority widening, destructive schema change, or policy choices.

Every remediation carries a precondition — including the two authority
entries above, which v0.2's example omitted while the surrounding text
required them.

**Carrier ownership is not LLP 0144's.** v0.2 said it was; that is wrong.
LLP 0144 keeps the application refusal *inside diagnostic details* and
explicitly assigns first-class envelope-shape changes to LLP 0094: "This is
a wire-shape change owned by LLP 0094 (the wire-envelope contract), not this
document" (`llp/0144:323-326`). So whether `remediations[]` becomes an
envelope field, a diagnostic-details member, or a separate lookup belongs to
the LLP 0094/0095 wire-contract family, with LLP 0144's disclosure
constraints still binding on the content. OQ6 is rewritten accordingly.

*Suggestion.* Unknown operation, unknown field, and wrong-arg-shape refusals
answer with type-aware candidates drawn from the served manifest: available
functions, available fields, the expected argument contract. Plus a local
bounded miss summary so an agent that has guessed the same wrong name three
times is told so.

This subsumes the immediately useful half of C8 while declining its
strategic half (see below).

*Acceptance:* an unknown-field refusal names the candidate fields from the
served generation; applying a suggested identifier repair against a stale
artifact hash is refused, not applied.

#### D7 implementation record — 2026-08-06 (OQ6-independent substrate)

The suggestion half landed without deciding the carrier. Unknown served host
operations, functions, schema/argument fields, and wrong argument shapes now
enrich the refusal's **existing** diagnostic `details` object with bounded,
typed candidates from the exact caller-visible served generation and the
expected argument contract. A process-local 128-entry LRU retains only hashed
miss identities, caps repeat counts, and tells an agent when it is repeating
the same miss; no rejected identifier, application value, or secret is
serialized. Direct HTTP, host-operation/CLI, and generated app-data MCP tests
pin the projection, disclosure negatives, and authorization-before-existence
ordering (`src/authoring_suggestion.rs`, `src/args_contract.rs`,
`tests/host_ops_v0.rs`, `packages/snapback-cli/mcp-control.test.mjs`).

The data-only draft registry and schema are checked in as
`schemas/remediation-kinds.v0.{registry,schema}.json`, explicitly marked
`draft-pending-oq6` and consumed by no wire surface. Their executable test
keeps D7's axes independent, requires approval for principal/authority
changes, and permits machine applicability only for typo fix, identifier
replacement, and artifact regeneration with a full artifact-hash
precondition. No suggestion-consuming machine-applicable repair path exists
yet, so there is nothing that can apply a stale suggestion; the schema pins
the mandatory hash precondition for that future path. The carrier, shared
decoder, stale-hash refusal/apply operation, and LLP 0184 catalog projection
all await the author ruling requested in
`issues/20260806-llp0146-oq6-remediation-carrier-decision.md`. This record does
not change this RFC's Draft status and does not claim D7 complete.

#### OQ6 author ruling — 2026-08-10

Option B ruled: contextual typed remediations ride in a versioned
diagnostic-details member, `diagnostic.details.remediationSet`
(`schemaVersion: "snapback.remediation-set.v1"`, `registryVersion:
"snapback.remediation-kinds.v1"`, per-item artifact-hash preconditions where
machine-applicable), leaving every closed outer envelope unchanged. The kind
registry is global and versioned, not keyed solely by refusal code; offered
entries are constructed contextually at the authorization-aware refusal
site, and every machine-applicable item binds to the exact artifact hash
observed at refusal time. The full ruling, checklist, and the nine-step
implementation program live in
`issues/20260806-llp0146-oq6-remediation-carrier-decision.md`; the
`draft-pending-oq6` registry/schema drafts promote to the ruled v1 identity
as that program's step 2, and LLP 0094/0095 receive the carrier's
compatibility/fixture amendments as its step 1.

## Declined and deferred

### Declined 1 — Automatic aliasing from popular wrong guesses

C8 proposed that names agents guess repeatedly should become real aliases.
This is the weakest claim in the original list. A wrong guess can mean the
API is badly named, *or* that the agent holds stale artifacts, *or* that a
competitor's naming trained the prior, *or* that the guide's intent aliases
are missing, *or* that the operation should not exist, *or* that one demo
used an idiosyncratic domain name. Those demand different repairs, and only
the first is an aliasing case.

Auto-aliasing converts transient model priors into permanent compatibility
burden, introduces ambiguity into generated surfaces, and — worst — *masks
stale-artifact failures*, which is the exact condition an agent most needs
surfaced. An alias is an API decision and requires one.

### Declined 2 — Aggregate miss telemetry as a design signal (deferred, opt-in)

The strategic framing (where agents guess wrong is where the API is
misnamed) is genuinely interesting and should inform naming, the capability
index's intent aliases, and cold-agent retrieval evaluation. But aggregation
across demos is a separate program with its own disclosure discipline, and
it must be opt-in and value-free — normalized facts only:

```json
{ "artifactHash": "…", "missKind": "unknownFunction",
  "guess": "createMessage", "candidateIds": ["messages:send"],
  "distanceClass": "close" }
```

No arguments, no values, no principal identifiers, no free-text errors.
Deferred until D7's local summaries prove the shape.

### Declined 3 — Broad trajectory record and replay

C12 proposed recording every host-op with its authority tuple to enable
replay, diff, handoff, and "rewind N steps." Declined as specified, for
three reasons.

A host-op-only journal is **incomplete**: ordinary app-data calls,
subscriptions, offline queues, app-CLI code mode, and actions do not all
pass through host ops. A recorded authority tuple is **not replayable
authority**: grants expire and are revoked, and branch promotion correctly
requires revalidation. And "rewind N steps" has **no honest meaning** after
an email, payment, webhook, or client-visible credential action.

The narrow successor — opt-in app-CLI transcripts and failure capsules
(exact artifact identity, operation id, args digest with full args only on
explicit opt-in, deterministic runtime ledger, authority *class* and grant
identity but never credentials, result or refusal, settlement identity) —
belongs in LLP 0062, which already lists transcripts and replay as future
app-CLI work. Reads and dry-runs replay freely against the exact generation;
mutations resolve through settlement identity; re-execution requires an
isolated branch and explicit confirmation; actions never replay
automatically. Rewind is checkpoint and branch semantics, never inverse
host operations.

### Declined 4 — Universal continuation tokens and token-cost estimates

C13's principle — context is the agent's scarcest resource — is right; its
uniformity is wrong. Bounding is per-operation:

| Operation class | Rule |
| --- | --- |
| Inspection, history, logs, lists | Bounded pages; opaque continuations bound to authority, artifact identity, and snapshot version |
| Queries | Explicit result bounds or application-owned cursors |
| Mutations | One complete result or receipt, or a typed size refusal — **never** pagination, never silent truncation |
| Actions and streams | Framed incremental output under byte, item, and time budgets |
| Diagnostics | Bounded structured fields; large evidence stored as an artifact referenced by digest |
| Agent digest | Deterministic byte and item budget (D3) |

And expose exact `serializedBytes` and item counts rather than a token
estimate. Tokenization is model- and tokenizer-dependent; a number that
drifts with someone else's release is not a protocol guarantee. If an
estimate is ever offered it is labelled heuristic and carries an estimator
id.

### Deferred 1 — Least-authority planning (C9)

```
snapback-app plan-authority --function messages:send --resource room_123
```

Synthesize the smallest reviewable grant request: required target
capabilities, authentication class, function scopes, resource constraints,
authority-creating status, and anything Snapback cannot infer. Submit the
request; never approve it.

Accepted in principle and genuinely small. It turns agent principals from an
enforcement mechanism into an authoring affordance, and it is the *safe*
form of "refusal carries repair" — ask for precisely bounded authority
instead of proposing a policy-widening patch. Deferred only because D7's
`requestGrant` remediation is its natural entry point and should land first.

### Deferred 2 — Bounded causal trace (C10)

Recent refusals tell an agent what failed; live and local-first bugs are
causal. An admin-gated, value-minimized, request-id-keyed trace — handler
host-call sequence, declared versus captured dependencies, indexes and
bounded result counts, auth and capability decisions, buffered writes and
final commit or refusal, affected subscriptions with invalidation reason,
durable versus ephemeral lane, deterministic runtime inputs — is more
actionable than another log-search surface, and can reuse dry-run's captured
facts. No row values by default. Deferred behind D1, which produces the
declared-versus-captured half of it.

### Deferred 3 — Agent workspace primitive (C11)

The composition of principals, grants, versioned seeds, branches, effect
capture, budgets, and verification into one product workflow:

```
snapback agent-session start --from-seed demo-v3 \
  --grant-request agent-work.json --ttl 30m --effects capture
```

returning a credential bound to an isolated workspace with hard budgets and
expiry, ending in a semantic data and artifact diff (D4) plus a verification
receipt (D2), with promotion as a separate explicit act requiring authority
revalidation.

This is the most strategically interesting item on the list, because it
inverts the default posture from "operate carefully against the real
instance" to "work freely in a bounded disposable world, then present
evidence" — which is the posture an agent is actually good at. Gated on
LLP 0097; that RFC's own constraint is that branches cannot claim effect
isolation until egress mediation is exhaustive. The honest pre-0097 version
is a fresh ephemeral instance from a declared versioned seed with actions
disabled and no promotion path.

## Sequencing

**Wave 1 — joins and projections over existing truth.** D1 report and
coverage, D2, D3. Each consumes facts Snapback already computes; none
introduces a new evaluator, journal, or execution model. Wave 1 is where the
agent's model of the app becomes checkable against reality.

**Wave 2 — meaning and recovery.** D4, D7. Both build on Wave 1's outputs:
the change-impact diff feeds the digest and the receipt; remediations
consume conformance verdicts and the served manifest.

**Wave 3 — new machinery.** D5, D6, then D1 strict mode. These are real
subsystems with their own design risk and should not run concurrently with
Wave 1.

**One item jumped the waves.** The Cloudflare fan-out correctness disposition
was not a Wave 3 concern: it was a live-delivery defect on a shipped arm. The
conservative widening landed independently on 2026-08-01 rather than waiting
for strict mode's authoring-contract decision.

The correctness work chose shape 2, conservative widening. Captured-read
consumption remains possible Wave 1 optimization work. Shape 3 *is* strict
mode, which Sequencing otherwise places in Wave 3; it no longer needs a
target-scoped subset pulled forward merely to make Cloudflare correct.

**Deferred lane.** C9 after D7; C10 after D1; C11 when LLP 0097 becomes
implementable.

The rationale for the ordering is that exposing whether the agent's model
matches reality (Wave 1) raises success rates sooner, and with less
permanent surface area, than adding correctness primitives (Wave 3) whose
value an agent cannot exploit while its model of the app is still wrong.

## Open questions

> **2026-08-06 (sitting #4):** D7 is RATIFIED and pulled forward as the
> next construction item. D4 is RATIFIED CONTINGENT on the LLP 0115
> CV-14 custody owner's dated amendment (OQ7's boundary stands). D5/D6
> stay deferred for re-scope after Wave 1.

**Ruled 2026-08-03 — author decision sitting #2
(`issues/20260803-author-decision-sitting-2.md`).** The D1–D3 first
tranche is ratified for implementation (commissioned as
`issues/20260803-0146-d1-d3-tranche.md`). OQ1: D1 strict mode is
**opt-in** for newly generated apps — a newly generated app does not opt
in by default. OQ8: the Cloudflare fan-out stays **conservative
widening** for now; no hosted claim is gated on recovering precision.
OQ7 (CV-14 custody trigger) was deliberately **not** ruled —
implementation must not claim CV-14 custody satisfaction without the
custody owner's ratification. The remaining questions stay open.

**Ruled 2026-08-04 — author decision sitting #3
(`issues/closed/20260804-author-decision-sitting-3.md`).** Two rulings
on the D1 tranche's accumulated author questions
(`issues/20260803-0146-d1-d3-tranche.md`):

- **Escape hatch: none in v1.** The boolean `strictDeclarations`
  strict-mode opt-in ships as-is. The per-dependency-class vocabulary
  ("explicitly conservative or unobservable classes") gets defined only
  when a real app hits such a class — evidence-driven, not speculative.
- **Strict flag on non-enforcing targets: REFUSE AT LOAD** with a named
  code on targets that cannot enforce `strictDeclarations` (the
  Cloudflare arm today). The flag must never ride through unenforced.
  The implementation item (load/ensure-time refusal with a named
  `SNAPBACK_*` code, plus test) belongs to the tranche's continuation
  and is recorded in the tranche ticket's next steps. This ruling
  **partially resolves OQ14**: when strict mode is requested on a
  target without enforcement authority, the answer is refusal, not
  unenforced ride-through; OQ14's broader question — what constitutes
  an authoritative capture on Cloudflare — stays open.

**Ruled 2026-08-15 — author observation-carrier decision.** D3's redacted
row-count magnitudes and recent D1 verdicts use a separately authenticated
**BROKERED** observation artifact consumed by `snapback-app introspect`.
They do not extend the public app-data inspection contract. Implementation of
that artifact remains open in the D1–D3 tranche ticket.

1. **D1 strict-mode default.** Opt-in per app is proposed. Does a
   newly generated app opt in by default, making the *legacy* case the
   opt-out? That would make declarations enforced ceilings for all new
   authoring while honoring LLP 0127 decision 6 for existing apps.
2. **D2 test execution locus.** v0 keeps acceptance execution in the CLI
   orchestrator. Does `acceptance.run` as a host operation eventually
   execute in-server, and if so under what authority and resource envelope?
3. **D3 budget units.** Bytes and item counts are proposed. Is a
   per-section budget (schema versus operations versus diagnostics) needed,
   or does one global budget with a fixed section precedence suffice?
4. **D5 vocabulary closure.** Two invariant classes are proposed for v1
   (v0.1 proposed four; two were withdrawn as already shipped). Is that the
   right cut, and what is the extension procedure — a new declared class per
   RFC, or a bounded combinator algebra?
5. **D6 property set ownership.** The six cross-cutting properties overlap
   LLP 0054's safety and liveness phases. Does D6 claim them, or does
   LLP 0054 own the property catalogue with D6 owning generation and
   shrinking?
6. **D7 remediation carrier and registry.** Do remediation kinds live in a
   registry keyed by refusal code? The carrier is an LLP 0094/0095
   wire-contract decision, not LLP 0144's: envelope field, diagnostic-details
   member, or separate lookup — and what is the disclosure behaviour across
   the CLI, HTTP, and MCP projections?

   **Ruled 2026-08-10 (author, via the decision package in
   `issues/20260806-llp0146-oq6-remediation-carrier-decision.md`): option B
   with a global registry.** The carrier is a versioned object inside the
   existing diagnostic `details` member — `diagnostic.details.remediationSet`
   carrying `schemaVersion: "snapback.remediation-set.v1"`,
   `registryVersion: "snapback.remediation-kinds.v1"`, the exact contextual
   `artifactHash` where applicable, and bounded `items` — never a change to
   any closed outer envelope (LLP 0094 §0C.2) and never a separate lookup.
   Remediation kinds live in one **global, versioned registry** (the
   promoted `schemas/remediation-kinds` draft), not keyed by refusal code; a
   reviewed code-to-template table is an implementation aid only, and every
   offer is constructed contextually at the authorization-aware diagnostic
   construction site (LLP 0144 Axis I ordering: gates before disclosure,
   caller-visible facts only, identically across CLI, HTTP, MCP, and the
   hosted projection). Every machine-applicable item binds the artifact hash
   observed at refusal time; the repair-apply consumer owns the named
   stale-artifact refusal and performs no write on mismatch. Fixture
   obligations (positive, unknown-kind, unknown-field, stale-hash,
   disclosure-negative, approval, cross-projection parity) are assigned to
   LLP 0095's conformance corpus. Consumers use the shared typed decoder;
   ad-hoc details key-poking is out of contract.
7. **CV-14 custody.** D4 claims LLP 0115 CV-14, which rides a custody
   trigger in the 0062 family. Does claiming it here satisfy the trigger, or
   must the custody owner ratify?
8. **Cloudflare fan-out precision after the correctness fix.** Conservative
   widening landed on 2026-08-01: an under-declared or unwitnessed function is
   affected by every changed table. Should that remain the final shape, should
   `fanOut` consume a persisted captured-read witness, or should future strict
   mode recover precision on this target? The first costs delivery precision,
   the second a durable dependency read, and the third an authoring-contract
   change. Does the precision choice gate any broader hosted claim?
9. **`acceptance.run` relationship.** D2 is a CLI composition and explicitly
   does not implement the pinned operation. Does `verify` later become the
   shared core that `acceptance.run` projects, carrying the LLP 0024 result
   contract, or do the two stay separate surfaces?
10. **Digest cursor custody.** Who retains what a prior `digestCursor`
    denoted — server-side digest manifests, client-presented prior digest,
    or coarse resolution with the dynamic section always sent whole? What
    retention, expiry, and authority boundary applies? (The carrier is
    settled — one flag, cursor embeds the envelope hash; custody is not. The
    2026-08-04 v0 implementation selects coarse whole-dynamic replay with no
    retained observation manifest and records that selection in every digest;
    a longer-term custody/expiry policy remains open.)
11. **Generalising `membership.lastHolder`.** D5 withdraws
    protected-last-member because memberships already enforce it. Should a
    generic protected-cardinality invariant exist, and if so does it reuse
    or supersede the shipped rule?
12. **Offline/RQS arm, if eligibility expands.** The current disposition is
    verified and closed: retention refuses opaque JavaScript
    (`src/manifest.rs:2981`), which is the only shape where hand-authored
    drift can occur, so drift has no retention effect today. The open part
    is conditional — if eligibility ever admits opaque handlers, does
    retention consume captured dependencies, declarations, or refuse?
13. **D5 versus the bounded-relation family.** D5 applies only to ad-hoc
    relations and must refuse promoted incarnations. Should the two
    eventually converge on one relation vocabulary, and who owns that?
14. **Conformance evidence on non-local targets.** D1's provenance states
    are defined against local capture. What constitutes an authoritative
    capture on Cloudflare, where captured reads are recorded but unused?
    *Partially resolved 2026-08-04 (author sitting #3): a strict flag on a
    target that cannot enforce it is refused at load with a named code —
    never unenforced ride-through. The capture-authority question above
    stays open.*

## Status

Draft. No implementation was authorized by this document as written;
on 2026-08-03 the author ratified the D1–D3 first tranche for
implementation (author decision sitting #2, see §Open questions and
`issues/20260803-0146-d1-d3-tranche.md`) — the remaining decisions stay
unratified. The D1 report and strict-mode surfaces landed that day on the local
target; the D2/D3 v0 surfaces landed in the 2026-08-04 worktree record (see the
dated records in the Revised header). The 2026-08-16 residue record completes
mutation-envelope capture, adds app-data invocations to the diagnostic ring,
registers the repository demo catalog through a legacy-suite adapter, and lets
D2 bind admission/capabilities to an admin-token-authenticated live served
target. Sessions targets requiring an `AdminInspect` secret-read lease remain
a declared unsupported live-probe authority profile. Legacy
suite conformance stays honestly partial until those suites emit D1 evidence.
D3's public dynamic projection still reports unavailable row-count and D1
observations and uses the recorded coarse OQ10 fallback; the author-ruled
brokered observation artifact is the tranche's remaining implementation item.
D1, D2, and D3 are the intended first tranche and are the smallest of the seven; D5 and D6 are
substantial subsystems and should be re-scoped after Wave 1 lands, when the
conformance and verification surfaces will have made some of their
motivating failure classes observable rather than hypothesized.

**The review loop converged on dual READY at round 4.** Round 1 returned
NOT READY from both families and inverted the document's central claim.
Round 2 returned Fable READY / Codex NOT READY, and caught two defects that
v0.2 introduced while applying round-1 findings. Round 3 returned Fable
READY / Codex NOT READY, with both families independently converging on the
same four residues — all propagation lag from v0.3's body edits into
examples and acceptance clauses, plus one ill-typed predicate. Round 4
returned **READY from both**: Codex with no findings, Fable with one detail
that v0.5 applies.

Convergence is a statement about this document's internal coherence and the
truth of its factual claims — not a ratification of its seven decisions. The
fourteen open questions above are the honest residue, and the status stays
Draft because adjudicating them is the author's call, not the loop's.

The Cloudflare fan-out defect was the one item in this document that described
a live product defect rather than a missing affordance. It was fixed
independently of this RFC and is closed at
`issues/closed/20260801-cloudflare-live-fanout-uses-declared-tables.md`; no D1
surface or strict-mode decision is implied by that repair.
