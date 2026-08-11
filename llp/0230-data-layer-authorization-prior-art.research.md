# LLP 0230: Data-layer authorization — prior art

**Type:** Research
**Status:** Review
**Systems:** Auth, Security/authorization, Storage, Live queries, Code generation, Client integration
**Author:** Charlie Cheever / Claude (Opus 5)
**Date:** 2026-08-10
**Revised:** 2026-08-11
**Related:** LLP 0011, LLP 0022, LLP 0039, LLP 0053, LLP 0056, LLP 0082, LLP 0084, LLP 0085, LLP 0116, LLP 0170, LLP 0172, LLP 0231

## Summary

Snapback's authorization obligation is uneven by surface. Search indexes fail
generation without an explicit visibility declaration; relational and
bounded-children queries require per-source visibility, carried into the
manifest (LLP 0073, LLP 0080). But the *plain filter-list* surfaces
(`defineLiveQuery` / `defineQuery` / `defineJs*`) — the large majority of
queries — carry no row-scoping obligation at all, and there the manifest
cannot distinguish a security predicate from a convenience filter.
[LLP 0172](./0172-explicit-function-authorization.rfc.md) states the
function-level boundary in its own words — it "does not claim that
`authenticated` scopes returned rows" — and
[LLP 0170](./0170-authorization-obligation-feasibility.research.md) concluded
that the obligation cannot be discharged from the current manifest, because
`authScopeField` "does not authorize a read" and "the handler must still enforce
the caller filter."

This document surveys the prior art for closing that gap. It makes no
recommendation; [LLP 0231](./0231-entity-and-permissioning-recommendation.rfc.md)
does that.

Two findings shape everything below.

**First, a coverage gap in our own research.** The corpus is thorough on sync
engines and nearly silent on authorization systems as a field. That is backwards
relative to the problem we have.

**Second, a structural mismatch that no surveyed system resolves.** Almost every
system in this literature assumes an authorization decision is *made, used, and
discarded*. Snapback holds durable subscriptions, so a decision has a lifetime
and must be invalidated by data change, policy change, **and** membership
change. The incremental-view-maintenance line, Rocicorp Zero, and Hasura
engage with that *structurally*; InstantDB and Supabase Realtime engage it by
brute force, re-evaluating policy per object or per WAL change on the live
path — the shape InstantDB's own vendor flagged as inadequate (Finding 1).
Adopting any single system wholesale is still not available:
this is a join of two literatures that have mostly not met.

## Question and scope

> What has the field learned about enforcing authorization at the data-access
> layer rather than at the endpoint, and which of it transfers to a system with
> durable live subscriptions?

Out of scope: recommending a design; re-surveying sync engines (LLP 0022, 0082,
0084, 0085, 0116 already do that); credential and session mechanics (LLP 0039,
0212, 0214, 0226, 0227).

## Finding 0 — the coverage gap

| Topic | Documents mentioning it, before this one |
| --- | ---: |
| Zanzibar | **1** — in LLP 0056's *non-goals* |
| SpiceDB / OpenFGA / Ory Keto / Permify | 0 |
| AWS Cedar | 0 |
| Noria | 0 |
| Firebase Security Rules | 0 (one passing vendor-table mention in LLP 0139) |
| OPA / Rego | 0 |

Against thorough coverage of Electric/PowerSync/Turso, InstantDB, Triplit/Ditto,
Jazz, Convex, TigerBeetle, and Serverpod. We have studied how to *move* data
exhaustively and how to *authorize* it barely at all.

*Confidence: high.* Mechanically counted over `llp/`.

## Finding 1 — we already hold the field's key negative result

[LLP 0011](./0011-auth-and-permissions.rfc.md) §462, from the InstantDB pass:

> InstantDB evaluates CEL `view` rules **post-query on every object, including
> during live invalidation**; it flagged CEL-to-`where` [pushdown]

That is the empirical case against *arbitrary per-row policy code* in a system
with live queries, observed from a shipping product. Everything in Tier 1 below
is, in effect, an explanation of why that hurts and what to do instead.

*Confidence: high.* Directly quoted from our own research.

## Tier 1 — the intersection: policy × live queries

### Blockaid (OSDI 2022)

The most directly relevant paper, because it attempts precisely what LLP 0170
concluded we could not do. Blockaid intercepts an application's SQL and verifies
against declared policy views using an SMT solver, caching decisions so
steady-state cost is low.

Be precise about its shape before citing it: Blockaid is a **runtime**
verifier — it checks each SQL query in request-trace context, caches
generalized decisions to amortize solver cost, and the paper assumes the
application keeps its own access checks. It is not a generate-time proof with
zero authoring burden; an alternative described that way is a hypothetical
stronger cousin, not this system.

Its value to us is diagnostic: 0170's negative result was stated as a property of
*our manifest*. Blockaid shows what discharging that obligation actually
requires. Reading it should settle whether 0170 found a manifest limitation or a
problem-shaped one.

*Confidence: medium-high* that it is relevant; the caching-hit-rate claims are
unverified by us.

### Rocicorp Zero — permissions as query predicates

We already bake off against Zero ([LLP 0138](./0138-zero-replicache-bakeoff.plan.md),
diaries 0042–0046), but for *throughput and authoring*, not for its permission
model. That model is the closest living relative of what our constraints imply:
rules are ZQL expressions the server composes **into** the query rather than
evaluating per returned row.

Two facts about that model bear directly on the locus and lifetime questions
and were missing from this survey's first revision. First, the earlier
RLS-style API was **table-scoped and deny-by-default, applied automatically to
every read and write, with policy stored in a live-replicated table** — the
strongest shipped precedent for the table-locus shape. Second, that API is now
**explicitly deprecated** (see Zero's deprecated-RLS documentation and the 0.15
release notes). Both halves matter: the shape it chose, and the reasons it was
retired — read those reasons before citing the shape as validated.

Round-2 review (2026-08-11) partially answered the open half from Zero's
current documentation: 0.25 removed the first-class RLS permission system;
current authorization is expressed in authenticated named-query definitions;
zero-cache re-transforms queries on reconnect/token refresh and polls on a
configurable interval for out-of-band role or membership changes. Any use of
this section should therefore distinguish four change classes: relational
permission-data changes, auth-context changes, policy-code deployment, and the
deprecated live-replicated policy-table mechanism.

*Confidence: medium.* Model shape is clear; the 0.25/current-auth facts are
reviewer-reported from Zero's documentation, not freshly read for this
document; the deprecation rationale remains unverified by us.

### Noria (OSDI 2018) and DBSP / Feldera

Partially-stateful dataflow and incremental view maintenance respectively.

The payoff is a unification — stated with a scope round-2 review forced:
**if policy is a predicate composed into the query, a change to a policy
*fact* (a membership row, a reveal bit) and a data change become the same kind
of event**, maintained by one mechanism. That holds only when the changing
fact is modeled as an input row. Changing the policy *expression* changes the
dataflow program itself — plan replacement, activation, reauthorization — and
is not an input delta; LLP 0053 already models authorization-metadata
activation as a distinct event for exactly this reason. So the unification is
the strongest technical argument for the declarative shape on the fact side,
and it also bears on read-offload (LLP 0014's designed read ceiling), but it
does not cover policy-program deployment.

*Confidence: medium.* The narrowed unification argument is sound; whether our
matcher could adopt it is unassessed.

### Hasura — table-locus row and column permissions on live subscriptions

Missing from this survey's first revision and flagged independently by both
round-2 review families. Hasura ships declarative, table/model-scoped, per-role
**row and column** permissions — relationship predicates and session variables
included — compiled into the generated SQL, and applies them to live and
streaming GraphQL subscriptions (multiplexed polling cohorted by session
variables). That is a shipped answer to both the composition question and the
decision-lifetime question, and it is arguably the closest living relative of
LLP 0231's proposed shape — closer than Zero, and the only production system
here with a *column*-level surface, which bears directly on 0231's class M.
Its limits (policy-metadata activation, offline retention, conditional cell
masking, revocation delivery) are exactly the questions this survey cares
about and should be assessed from its documentation.

*Confidence: medium.* Reviewer-reported characterization from Hasura's public
architecture material, not freshly read for this document; assess before
citing as precedent.

### Supabase Realtime (WALRUS) — the brute-force shape, second instance

Supabase enforces Postgres RLS on its realtime path by evaluating policy per
WAL change, per subscriber. This is a second independent production instance
of the per-object live-path evaluation shape that Finding 1 otherwise rests on
a single vendor's self-report — worth citing for that corroboration, and for
its documented scaling behaviour.

*Confidence: medium.* Reviewer-reported; not freshly read for this document.

### OPA data filtering and Oso — compiled policy fragments

The first revision listed OPA as a corpus gap but never surveyed it, and S1 of
the sibling RFC over-generalized from that silence. OPA ships a Compile API
and a defined data-filtering *fragment*: partial evaluation of Rego into SQL
predicates, refusing unsupported constructs rather than falling back to
per-row runtime evaluation. Oso's data-filtering does the compile-into-
predicates move as a product library. Both are existence proofs that an
authoring language can be open while its *admissible fragment* stays closed
and pushdown-compiled — the exact structure LLP 0231's grammar question
needs, and a live input to it.

*Confidence: medium.* Reviewer-reported against OPA's current documentation;
not freshly read for this document.

## Tier 2 — authorization systems proper

### Zanzibar (USENIX ATC 2019)

The field's canonical paper: relation tuples, userset rewrite rules, and a
consistency mechanism for a globally distributed ACL store.

**The part that transfers is the "new enemy problem."** Change an ACL and change
content concurrently and a reader can observe new content under the stale ACL.
Zanzibar's answer is the **zookie**: an opaque token naming a consistency point,
so a read can demand "evaluate no earlier than this."

We plausibly already hold that primitive: DK-2's **gap-free per-app commit
version** is structurally a zookie *candidate*. That is a correspondence
hypothesis, not a verified primitive — open question 3 asks whether it survives
jurisdictional/multi-object placement. If it does, systems adopting Zanzibar's
model normally have to build this and we would start with it; any design that
comes out of this should say which.

LLP 0056 scoped out "Zanzibar-style relation graphs, rewrite rules, or permission
inheritance" — defensible for that document, but the scoping-out appears to have
ended the engagement rather than started it.

*Confidence: high on the paper's content; low-medium on the Snapback
commit-version mapping,* which is a hypothesis pending open question 3 — the
first revision's single "high" conflated the two.

### SpiceDB, OpenFGA, Ory Keto, Permify

Open Zanzibar implementations. SpiceDB is the most faithful with the best
consistency documentation; OpenFGA the most approachable. Useful as existence
proofs of operating cost, less so as designs to adopt, since all are external
services and none owns a sync layer.

*Confidence: medium.*

### AWS Cedar

The system most aligned with this corpus's culture: a policy language designed
for **analyzability**, formally specified, with machine-checked proofs of core
properties and differential testing against the implementation.

If the live-query constraint forces a policy language a matcher can reason
about — and Finding 1 suggests it does — Cedar is the best-argued account of
*where to cap expressiveness and why*.

*Confidence: medium-high* on design intent; we have not evaluated fit.

### Postgres RLS, and its leak literature

Directly relevant to LLP 0046's graduation path: RLS is "policy as a predicate
the planner composes into the query." A policy model that lowers to RLS on
Postgres and to matcher predicates on SQLite would be one model with two
backends.

Read the failure literature too — side channels via error messages, `LEAKPROOF`
operator rules, and planner behaviour. It is the best available catalogue of how
predicate-based row security goes wrong once real.

*Confidence: medium-high.*

### Firebase Security Rules — a usability negative result

Worth studying as a caution. Path-scoped declarative rules with a long public
record of misconfiguration. The lesson is that a declarative policy language
*without* a clear evaluation model and good tooling yields confidently wrong
policies — pointed here, because [LLP 0187](./0187-agent-discoverability-routing.rfc.md)
found confident-and-wrong to be our agents' characteristic failure mode.

*Confidence: medium-high.*

## Tier 3 — the Meta lineage

**TAO** (ATC 2013) is the graph store and read-through cache beneath it all;
useful for context on why Ent has its shape, less applicable since our data is
not a network hop away. **Ent** itself is sparsely documented publicly, which is
plausibly why `expo/entity` exists as the legible articulation.

The most interesting item is Meta's newer **Privacy Aware Infrastructure /
policy zones** work. Meta's public material says point checks plus lineage
were inadequate for scalable *purpose-limitation* enforcement and motivated
runtime information-flow controls; reading that as a verdict on Ent-style
per-load *authorization* is this document's inference, not Meta's own claim.
The move is to data-flow-level enforcement: annotate data with policy zones,
track propagation between systems.

That is unusually available to us. Declared `reads`, declared writes, and
`EffectCeilingV1` mean we hold more static data-flow information than most
systems — and flow-level enforcement addresses what per-load checks miss: data
legitimately read and then sent somewhere it should not go.

*Confidence: medium.* Public material is engineering-blog grade, not a paper.

## Tier 4 — research, pointed but exotic

**Jeeves / Jacqueline** — faceted execution: author code as though no policy
exists; the runtime maintains high- and low-confidentiality facets and resolves
per viewer at output. Aimed squarely at *many per-viewer views of one
computation*, which is our live-query problem stated abstractly. Read for
framing.

**Qapla, Sieve, Multiverse DB, Ur/Web, Hails** — the academic line on database-
and language-level policy enforcement. Diminishing returns after Blockaid.

**Data Flow Control / Passant (arXiv 2606.05679, June 2026)** — tuple-level
flow policies with query rewriting, no materialized provenance. Preliminary
and broader than authorization, but it addresses the exact problem row
predicates and projection masks do not: a hidden value influencing derived
output. Relevant to LLP 0231's class M and D6/egress.

*Confidence: low-medium.* Known by reputation and abstract; not read closely for
this document.

## Gap — field- and column-level enforcement

Round-2 review exposed a structural hole this revision records rather than
fills: the survey contains **no field/column-level enforcement prior art** —
SQL column privileges, dynamic data masking (SQL Server, Oracle, and the
warehouse vendors), Hasura's column permissions, the GraphQL
field-authorization literature, or the masking side-channel results (a masked
column that still participates in filtering or ordering leaks; null-substitution
versus row-splitting semantics). LLP 0231 now commits to a field-masking class
whose grammar is deferred to a sibling spec *because* of this gap; that spec
must not be written until this section is a real survey rather than a reading
list.

## The structural mismatch

Stated plainly because it governs what can be adopted:

| System | Decision lifetime |
| --- | --- |
| Zanzibar, SpiceDB, OpenFGA | per request |
| Ent / expo/entity | per load |
| Cedar, OPA | per evaluation |
| Blockaid | per query |
| Postgres RLS | per statement |
| InstantDB | per object, re-evaluated on every live invalidation |
| **Snapback** | **for the life of a subscription** |

A durable subscription turns an authorization decision into retained state.
It must be invalidated by three independent event classes — data change, policy
change, and membership change — and LLP 0053 exists because of the second and
third.

**LLP 0056 already reached this conclusion independently**, and states it better
than this survey does:

> the reason to build this into Snapback rather than leave it to app code or an
> external policy engine: **revocation correctness.** Kick a co-host and their
> live subscriptions actually clear. A bolted-on authorization library cannot
> deliver that, because it does not own the sync layer.

That sentence is the answer to "why not just adopt one of these," and it was
written before this survey.

## Reading order

1. **Zanzibar** — the canonical paper; the zookie correspondence is immediately
   usable.
2. **Blockaid** — a worked answer to the question LLP 0170 abandoned.
3. **Cedar's design rationale** — where to cap expressiveness, argued well.
4. **Zero's permission model** — the closest living system to our constraints.
5. Re-read **LLP 0011 §462**, which is the negative result the other four explain.

## Open questions

1. **Does LLP 0170's negative result survive Blockaid?** Is the obstacle our
   manifest or the problem?
2. **How does Zero invalidate a live query on a permission change?** The
   unexamined half of the system we already bench against.
3. **Is our commit version usable as a zookie**, or does the correspondence break
   under jurisdictional/multi-object placement (LLP 0014)?
4. **Could one policy model lower to both RLS and matcher predicates**, or does
   the SQLite/Postgres split force two?
5. **Does the data-flow framing (Meta's policy zones) fit our declared reads and
   effect ceilings** better than per-load checks, given we already compute that
   information?

## Confidence

Overall **medium on the survey** — lowered from medium-high after round-2
review surfaced material omissions (Hasura, Supabase Realtime, OPA's filtering
fragment, the entire field/column-masking literature) — and **high on the two
findings that are about our own corpus** (the coverage gap and the LLP 0011
§462 observation, both mechanically verified). Tiers 1–4 are assessed from
knowledge of the literature rather than from a fresh reading pass; the
sections added on 2026-08-11 are reviewer-reported and individually labeled as
such; venue and date attributions should be checked before citation. No
system here has been evaluated against Snapback's manifest in detail.

## Status

Review. Survey only; the recommendation lives in LLP 0231.

Revised 2026-08-11 after round-1 review (overclaim corrections, Zero
deprecation facts, Blockaid precision, zookie hedge) and again after round-2
review — this document's single author-scoped sanity round, which both review
families ended **NOT READY** (verdicts bound to
`sha256 f74b0723…`, recorded in `llp/reviews/0231-*.{gpt-5,claude}.md`).
The round-2 revision applies their findings: per-surface obligation precision
in the summary, Hasura / Supabase Realtime / OPA-filtering / Oso sections, the
field-and-column-enforcement gap section, the Noria unification narrowed to
policy facts, the Meta inference hedged, the Zanzibar confidence split, and
overall survey confidence lowered to medium. **These post-round additions are
unreviewed**; no convergence is claimed for this document, and the new system
characterizations are reviewer-reported pending a fresh reading pass.
